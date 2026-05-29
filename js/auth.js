async function checkAuth() {
    const { data: { user } } = await window.supabase.auth.getUser();
    if (!user) {
        window.location.href = 'login.html';
        return false;
    }

    // Get tenant_id from user metadata
    let tenantId = user.id;

    if (!tenantId) {
        // Fallback: use user.id as tenant_id
        console.warn('Tenant ID missing from user metadata, using user.id as tenant_id');
        tenantId = user.id;
    }

    // Store tenant_id and role in localStorage
    localStorage.setItem('nexflow_tenant_id', tenantId);
    localStorage.setItem('user_role', 'owner');

    // Set up auth state change listener
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

async function checkAuthAndTenant(requiredTenantId) {
    const { data: { user } } = await window.supabase.auth.getUser();

    // Check if user is logged in
    if (!user) {
        window.location.href = 'login.html';
        return false;
    }

    // Get user's tenant_id from metadata
    const userTenantId = user.id;

    // If requiredTenantId is provided, check it matches user's tenant_id
    if (requiredTenantId && userTenantId !== requiredTenantId) {
        window.location.href = 'login.html';
        return false;
    }

    return true;
}
