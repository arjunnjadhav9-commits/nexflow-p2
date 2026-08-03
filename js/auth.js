async function fetchUserRole(userId, tenantId) {
    if (userId === tenantId) {
        sessionStorage.setItem('nexflow_role', 'owner');
        return 'owner';
    }

    const cached = sessionStorage.getItem('nexflow_role');
    if (cached) return cached;

    const { data } = await window.supabase
        .from('p2_user_roles')
        .select('role')
        .eq('user_id', userId)
        .eq('tenant_id', tenantId)
        .single();

    // No row for a non-owner user is a misconfiguration — default to least privilege,
    // never to 'owner' (that would be a privilege-escalation bug).
    const role = data?.role || 'storekeeper';
    sessionStorage.setItem('nexflow_role', role);
    return role;
}
