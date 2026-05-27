async function checkAuth() {
    const { data: { user } } = await window.supabase.auth.getUser();
    if (!user) {
        window.location.href = 'login.html';
        return false;
    }

    // GUARD 8: Check if tenant_id exists in user metadata
    let tenantId = user.user_metadata.tenant_id;

    if (!tenantId) {
        // Tenant ID missing from metadata, try to fetch from p2_user_roles
        console.warn('Tenant ID missing from user metadata, fetching from p2_user_roles');

        try {
            const { data, error } = await window.supabase
                .from('p2_user_roles')
                .select('tenant_id')
                .eq('user_id', user.id)
                .single();

            if (error || !data || !data.tenant_id) {
                // No tenant_id found anywhere - redirect to error page
                console.error('No tenant_id found for user:', user.id);
                window.location.href = 'error.html?msg=' + encodeURIComponent('Your account is not linked to a tenant. Contact your administrator.');
                return false;
            }

            // Store tenant_id in localStorage
            tenantId = data.tenant_id;
            localStorage.setItem('nexflow_tenant_id', tenantId);
        } catch (err) {
            console.error('Error fetching tenant_id:', err);
            window.location.href = 'error.html?msg=' + encodeURIComponent('Unable to verify your account. Please try again or contact support.');
            return false;
        }
    }

    // Set up auth state change listener
    window.supabase.auth.onAuthStateChange((event, session) => {
        if (event === 'SIGNED_OUT' || !session) {
            window.location.href = 'login.html';
        }
    });

    // Fetch user role from p2_user_roles
    await fetchAndStoreUserRole(user.id);

    return true;
}

async function fetchAndStoreUserRole(userId) {
    try {
        const { data, error } = await window.supabase
            .from('p2_user_roles')
            .select('role, tenant_id')
            .eq('user_id', userId)
            .single();

        if (error) {
            console.error('Error fetching user role:', error);
            // Fallback: assume owner if no role found
            localStorage.setItem('user_role', 'owner');
            return;
        }

        // Store role and tenant_id in localStorage
        localStorage.setItem('user_role', data.role);
        localStorage.setItem('tenant_id', data.tenant_id);
    } catch (error) {
        console.error('Error in fetchAndStoreUserRole:', error);
        localStorage.setItem('user_role', 'owner');
    }
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
    const userTenantId = user.user_metadata.tenant_id;

    // If requiredTenantId is provided, check it matches user's tenant_id
    if (requiredTenantId && userTenantId !== requiredTenantId) {
        window.location.href = 'login.html';
        return false;
    }

    return true;
}