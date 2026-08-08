const SUPABASE_URL = 'https://jhqxvpihauvhfclosuxn.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImpocXh2cGloYXV2aGZjbG9zdXhuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk3ODc5ODksImV4cCI6MjA5NTM2Mzk4OX0.cmDlCVvqeQVWeDvQkPx1dwRD7oLU7Rwy_tE3ef66AOI';

const supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
window.supabase = supabaseClient;

async function checkAuth() {
    const { data: { user } } = await window.supabase.auth.getUser();
    if (!user) {
        window.location.href = 'login.html';
        return false;
    }

    // tenant_id = user's own id for an owner, but for an invited staff member their
    // own auth user_id is NOT the tenant — the owner's id was stamped into their JWT
    // user_metadata at invite time (see invite-staff Edge Function).
    const tenantId = user.user_metadata?.tenant_id || user.id;
    localStorage.setItem('nexflow_tenant_id', tenantId);
    localStorage.setItem('supabase_tenant_id', tenantId); //

    await fetchUserRole(user.id, tenantId);

    const { data: settingsData } = await window.supabase
        .from('p2_tenant_settings')
        .select('plan')
        .eq('tenant_id', tenantId)
        .single();

    // Plan: if no row found, default to founder (SS Engineering won't break)
    const plan = settingsData?.plan || 'founder';
    localStorage.setItem('nexflow_plan', plan);

    // Demo-mode flag, read by js/utils.js into window.isDemo (used by agent-chat.js).
    try {
        const { data: tenantData } = await window.supabase
            .from('p2_tenants')
            .select('is_demo')
            .eq('id', tenantId)
            .single();
        sessionStorage.setItem('nexflow_is_demo', tenantData?.is_demo ? 'true' : 'false');
    } catch (e) {
        sessionStorage.setItem('nexflow_is_demo', 'false');
    }

    window.supabase.auth.onAuthStateChange((event, session) => {
        if (event === 'SIGNED_OUT' || !session) {
            sessionStorage.removeItem('nexflow_is_demo');
            sessionStorage.removeItem('nexflow_role');
            window.location.href = 'login.html';
        }
    });

    return true;
}

function getUserRole() {
    return sessionStorage.getItem('nexflow_role') || 'owner';
}

function isOwner() {
    return getUserRole() === 'owner';
}

function getPlan() {
    return localStorage.getItem('nexflow_plan') || 'founder';
}

function isPro() {
    const plan = getPlan();
    return plan === 'pro' || plan === 'founder' || plan === 'demo';
}

function isLite() {
    return getPlan() === 'lite';
}

function isFounder() {
    return getPlan() === 'founder';
}

// Call at top of every Pro-gated page after checkAuth()
function requirePro() {
    if (!isPro()) {
        window.location.href = 'index.html?upgrade=true';
    }
}

// Call at top of owner-only pages after checkAuth()
function requireOwner() {
    if (!isOwner()) {
        window.location.href = 'index.html?unauthorized=true';
    }
}

function showUpgradePrompt(featureName) {
    document.getElementById('nx-upgrade-modal')?.remove();

    const overlay = document.createElement('div');
    overlay.id = 'nx-upgrade-modal';
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.7);z-index:9999;display:flex;align-items:center;justify-content:center;padding:20px;';

    overlay.innerHTML = `
    <div style="background:var(--surface,#1a1d27);border:1px solid var(--orange,#ff6b2b);border-radius:10px;padding:28px 24px;max-width:380px;width:100%;text-align:center;">
      <div style="font-size:28px;margin-bottom:12px;">⚡</div>
      <div style="font-family:var(--condensed,'sans-serif');font-weight:800;font-size:18px;color:var(--orange,#ff6b2b);margin-bottom:8px;">Pro Feature</div>
      <div style="font-size:14px;color:var(--text,#e8eaf0);margin-bottom:6px;font-weight:600;">${featureName}</div>
      <div style="font-size:13px;color:var(--mid,#8892aa);margin-bottom:20px;line-height:1.5;">This feature is available on Nexflow P2 Pro.<br>Upgrade to unlock AI Copilot, multi-user access, unlimited materials, and more.</div>
      <div style="display:flex;gap:10px;">
        <button onclick="window.open('https://wa.me/917248932468?text=Hi, I want to upgrade to Nexflow P2 Pro','_blank')"
          style="flex:1;background:var(--orange,#ff6b2b);color:#fff;border:none;padding:10px;border-radius:6px;font-weight:700;font-size:13px;cursor:pointer;">
          Contact Us
        </button>
        <button onclick="document.getElementById('nx-upgrade-modal').remove()"
          style="flex:1;background:none;color:var(--mid,#8892aa);border:1px solid var(--border,#2e3347);padding:10px;border-radius:6px;font-size:13px;cursor:pointer;">
          Close
        </button>
      </div>
    </div>`;

    document.body.appendChild(overlay);
    overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
}

async function checkAuthAndTenant(requiredTenantId) {
    const { data: { user } } = await window.supabase.auth.getUser();
    if (!user) {
        window.location.href = 'login.html';
        return false;
    }
    const userTenantId = user.id;
    if (requiredTenantId && userTenantId !== requiredTenantId) {
        window.location.href = 'login.html';
        return false;
    }
    return true;
}