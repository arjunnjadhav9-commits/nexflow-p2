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

    const tenantId = user.id;
    localStorage.setItem('nexflow_tenant_id', tenantId);
    localStorage.setItem('supabase_tenant_id', tenantId); //

    // Fetch role and plan from DB
    const { data: roleData, error: roleError } = await window.supabase
        .from('p2_user_roles')
        .select('role')
        .eq('user_id', user.id)
        .single();

    const { data: settingsData, error: settingsError } = await window.supabase
        .from('p2_tenant_settings')
        .select('plan')
        .eq('tenant_id', tenantId)
        .single();

    // Role: if no row found, treat as owner (existing clients won't break)
    const role = roleData?.role || 'owner';
    // Plan: if no row found, default to founder (SS Engineering won't break)
    const plan = settingsData?.plan || 'founder';

    localStorage.setItem('user_role', role);
    localStorage.setItem('nexflow_plan', plan);

    window.supabase.auth.onAuthStateChange((event, session) => {
        if (event === 'SIGNED_OUT' || !session) {
            window.location.href = 'login.html';
        }
    });

    return true;
}

function getUserRole() {
    return localStorage.getItem('user_role') || 'owner';
}

function isOwner() {
    return getUserRole() === 'owner';
}

function getPlan() {
    return localStorage.getItem('nexflow_plan') || 'founder';
}

function isPro() {
    const plan = getPlan();
    return plan === 'pro' || plan === 'founder';
}

// Call at top of every Pro-gated page after checkAuth()
function requirePro() {
    if (!isPro()) {
        window.location.href = 'dashboard.html?upgrade=true';
    }
}

// Call at top of owner-only pages after checkAuth()
function requireOwner() {
    if (!isOwner()) {
        window.location.href = 'dashboard.html?unauthorized=true';
    }
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