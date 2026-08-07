const { createClient } = require('@supabase/supabase-js');

const ALLOWED_ORIGIN = 'https://nexflowautomations.in';
const REDIRECT_URL = 'https://nexflowautomations.in/accept-invite.html';
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const ROLE_LABELS = {
  owner: 'Owner',
  supervisor: 'Supervisor',
  storekeeper: 'Storekeeper',
  operator: 'Operator',
  accountant: 'Accountant',
  staff: 'Storekeeper',
};

function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', ALLOWED_ORIGIN);
  res.setHeader('Access-Control-Allow-Headers', 'authorization, content-type');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
}

function escapeHtml(value) {
  return String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

module.exports = async function handler(req, res) {
  setCors(res);

  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }

  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const supabaseAdmin = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  );

  try {
    const authHeader = req.headers.authorization || '';
    const token = authHeader.replace('Bearer ', '');
    if (!token) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { data: { user }, error: userError } = await supabaseAdmin.auth.getUser(token);
    if (userError || !user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
    const { email, tenant_id, role, inviter_id } = body;

    // Ownership check: the old Edge Function only compared these two client-
    // supplied body fields to each other, never to the verified caller's own
    // id -- that let any authenticated user invite staff into ANY tenant by
    // just passing that tenant's UUID in the body. Tying the check to user.id
    // (from the verified token) closes that.
    if (!tenant_id || !inviter_id || inviter_id !== tenant_id || user.id !== tenant_id) {
      res.status(403).json({ error: 'Only owners can invite staff members' });
      return;
    }

    if (!email || !EMAIL_RE.test(String(email).trim())) {
      res.status(400).json({ error: 'Please enter a valid email address' });
      return;
    }
    const normalizedEmail = String(email).trim().toLowerCase();

    const { data: existingPending } = await supabaseAdmin
      .from('p2_pending_invites')
      .select('id')
      .eq('tenant_id', tenant_id)
      .eq('status', 'pending')
      .ilike('email', normalizedEmail)
      .maybeSingle();

    // Create (or resend for) the actual Supabase Auth user. generateLink with
    // type 'invite' both creates the auth.users row (firing handle_new_user(),
    // which inserts p2_user_roles from this metadata) and returns a one-time
    // link -- unlike inviteUserByEmail, it doesn't send an email itself, so we
    // control delivery via Resend below to match this app's branding.
    let linkResult = await supabaseAdmin.auth.admin.generateLink({
      type: 'invite',
      email: normalizedEmail,
      options: {
        data: { tenant_id, role, invited_by: inviter_id },
        redirectTo: REDIRECT_URL,
      },
    });

    if (linkResult.error) {
      // Do NOT fall back to recovery — that sends a password reset link which
      // overwrites the user's credentials. If the user already exists, tell
      // the owner explicitly instead.
      res.status(400).json({
        error: 'This email has already been invited. If they need a new link, delete the pending invite and re-invite them.',
      });
      return;
    }

    if (linkResult.error) {
      res.status(400).json({ error: linkResult.error.message });
      return;
    }

    const actionLink = linkResult.data.properties.action_link;

    if (!existingPending) {
      const { error: insertError } = await supabaseAdmin
        .from('p2_pending_invites')
        .insert({
          tenant_id,
          email: normalizedEmail,
          role,
          invited_by_tenant_id: inviter_id,
        });

      if (insertError) {
        console.log('p2_pending_invites insert error:', insertError);
        res.status(400).json({ error: insertError.message });
        return;
      }
    }

    const { data: tenantSettings } = await supabaseAdmin
      .from('p2_tenant_settings')
      .select('company_name')
      .eq('tenant_id', tenant_id)
      .single();

    const companyName = tenantSettings?.company_name || 'Nexflow P2';
    const roleLabel = ROLE_LABELS[role] || 'Staff';

    const RESEND_API_KEY = process.env.RESEND_API_KEY;
    if (!RESEND_API_KEY) {
      res.status(200).json({ success: true, warning: 'email_failed' });
      return;
    }

    const emailHtml = `<div style="font-family: Arial, sans-serif; max-width: 480px; margin: 0 auto;">
  <h2 style="color:#ff5c1a;">You've been invited to ${escapeHtml(companyName)} on Nexflow P2</h2>
  <p>You have been added as <strong>${escapeHtml(roleLabel)}</strong> at <strong>${escapeHtml(companyName)}</strong>.</p>
  <p style="text-align:center; margin: 28px 0;">
    <a href="${actionLink}" style="background: linear-gradient(90deg,#ff5c1a,#ff8c42); color:#fff; padding:12px 28px; border-radius:8px; text-decoration:none; font-weight:600; display:inline-block;">Set your password &amp; log in</a>
  </p>
  <p style="color:#888; font-size:12px;">This link is single-use and will expire after a while -- if it's stopped working, ask the Owner to send a new invite.</p>
  <p style="color:#888; font-size:12px; margin-top:32px;">This invite was sent by Nexflow Automations</p>
</div>`;

    try {
      const resendResponse = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${RESEND_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: 'Nexflow <noreply@nexflowautomations.in>',
          to: [normalizedEmail],
          subject: `You've been invited to ${companyName} on Nexflow P2`,
          html: emailHtml,
        }),
      });

      if (!resendResponse.ok) {
        const errText = await resendResponse.text();
        console.log('Resend API error:', errText);
        res.status(200).json({ success: true, warning: 'email_failed' });
        return;
      }
    } catch (resendErr) {
      console.log('Resend fetch error:', resendErr);
      res.status(200).json({ success: true, warning: 'email_failed' });
      return;
    }

    res.status(200).json({ success: true });
  } catch (error) {
    console.log('catch block error full object:', error);
    res.status(400).json({ error: error.message || String(error) });
  }
};
