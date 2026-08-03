async function fetchUserRole(userId, tenantId) {
    if (userId === tenantId) {
        sessionStorage.setItem('nexflow_role', 'owner');
        return 'owner';
    }

    const cached = sessionStorage.getItem('nexflow_role');
    if (cached) return cached;

    // get_my_role is SECURITY DEFINER and bypasses RLS entirely -- querying
    // p2_user_roles directly here caused infinite recursion (a policy on that
    // table subqueries the table itself to check the caller's role).
    const { data, error } = await window.supabase.rpc('get_my_role', { p_tenant_id: tenantId });

    console.log('fetchUserRole: get_my_role result', { data, error });

    // No row for a non-owner user is a misconfiguration — default to least privilege,
    // never to 'owner' (that would be a privilege-escalation bug).
    const role = data || 'storekeeper';
    sessionStorage.setItem('nexflow_role', role);
    return role;
}
