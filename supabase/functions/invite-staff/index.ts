import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const ROLE_LABELS: Record<string, string> = {
  owner: "Owner",
  supervisor: "Supervisor",
  storekeeper: "Storekeeper",
  operator: "Operator",
  accountant: "Accountant",
  staff: "Storekeeper",
};

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const envUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const envKey = Deno.env.get("SB_SECRET_KEY") ?? "";

    // Create Supabase client with service role key (has admin privileges)
    const supabaseAdmin = createClient(envUrl, envKey);

    // Get the authorization header from the request
    const authHeader = req.headers.get("Authorization")!;
    const token = authHeader.replace("Bearer ", "");

    // Verify the user making the request. This is /auth/v1/user, not
    // /auth/v1/admin/* — the Admin API is unreachable in this region
    // (AuthRetryableFetchError on every /auth/v1/admin/* call), but this
    // endpoint is a different, non-admin GoTrue route.
    const { data: { user }, error: userError } = await supabaseAdmin.auth.getUser(token);

    if (userError || !user) {
      throw new Error("Unauthorized");
    }

    const { email, tenant_id, role, inviter_id } = await req.json();

    // Verify that the inviter is an owner of this tenant. Checking inviter_id
    // against tenant_id alone isn't enough -- both are client-supplied body
    // fields, so a caller could pass ANY tenant's UUID for both and pass this
    // check. Tying it to user.id (from the verified token above) closes that.
    if (inviter_id !== tenant_id || user.id !== tenant_id) {
      throw new Error("Only owners can invite staff members");
    }

    if (!email || !EMAIL_RE.test(String(email).trim())) {
      return new Response(
        JSON.stringify({ error: "Please enter a valid email address" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 400 }
      );
    }
    const normalizedEmail = String(email).trim().toLowerCase();

    // Auth Admin API (generateLink/inviteUserByEmail/createUser) is unreachable
    // in this region — AuthRetryableFetchError on every /auth/v1/admin/* call.
    // Instead of minting an invite link, record the invite as a pending row the
    // Owner can act on (create the user manually in the Supabase dashboard —
    // the on_auth_user_created trigger picks up tenant_id/role from that user's
    // metadata) and just notify the invitee by plain email.
    const { data: existingPending } = await supabaseAdmin
      .from("p2_pending_invites")
      .select("id")
      .eq("tenant_id", tenant_id)
      .eq("status", "pending")
      .ilike("email", normalizedEmail)
      .maybeSingle();

    if (!existingPending) {
      const { error: insertError } = await supabaseAdmin
        .from("p2_pending_invites")
        .insert({
          tenant_id,
          email: normalizedEmail,
          role,
          invited_by_tenant_id: inviter_id,
        });

      if (insertError) {
        console.log("p2_pending_invites insert error:", insertError);
        return new Response(
          JSON.stringify({ error: insertError.message }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 400 }
        );
      }
    }

    const { data: tenantSettings } = await supabaseAdmin
      .from("p2_tenant_settings")
      .select("company_name")
      .eq("tenant_id", tenant_id)
      .single();

    const companyName = tenantSettings?.company_name || "Nexflow P2";
    const roleLabel = ROLE_LABELS[role] || "Staff";

    const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY") ?? "";
    if (!RESEND_API_KEY) {
      // The pending-invite row is already saved — the Owner can still see it
      // and proceed manually, so this isn't a hard failure.
      return new Response(
        JSON.stringify({ success: true, warning: "email_failed" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 }
      );
    }

    const escapeHtml = (value: string) =>
      value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

    const emailHtml = `<div style="font-family: Arial, sans-serif; max-width: 480px; margin: 0 auto;">
  <h2 style="color:#ff5c1a;">You've been invited to ${escapeHtml(companyName)} on Nexflow P2</h2>
  <p>You have been added as <strong>${escapeHtml(roleLabel)}</strong> at <strong>${escapeHtml(companyName)}</strong>.</p>
  <p>The Owner will create your login and share your password with you directly. Once your account is ready, you can log in at
    <a href="https://nexflowautomations.in" style="color:#ff5c1a; font-weight:600;">nexflowautomations.in</a>.
  </p>
  <p style="color:#888; font-size:12px; margin-top:32px;">This invite was sent by Nexflow Automations</p>
</div>`;

    try {
      const resendResponse = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${RESEND_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from: "Nexflow <noreply@nexflowautomations.in>",
          to: [normalizedEmail],
          subject: `You've been invited to ${companyName} on Nexflow P2`,
          html: emailHtml,
        }),
      });

      if (!resendResponse.ok) {
        const errText = await resendResponse.text();
        console.log("Resend API error:", errText);
        // The pending-invite row is already saved — don't hard-fail the whole
        // request just because the notification email bounced.
        return new Response(
          JSON.stringify({ success: true, warning: "email_failed" }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 }
        );
      }
    } catch (resendErr) {
      console.log("Resend fetch error:", resendErr);
      return new Response(
        JSON.stringify({ success: true, warning: "email_failed" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 }
      );
    }

    return new Response(
      JSON.stringify({ success: true }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 200,
      }
    );
  } catch (error) {
    console.log("catch block error full object:", error);
    return new Response(
      JSON.stringify({ error: error.message || error.code || String(error) }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 400,
      }
    );
  }
});
