-- Migration: Admin cross-tenant read for the internal Agent Dashboard
-- (admin-agent.html).
--
-- p2_agent_logs already has an "admin_read_all_logs" policy (added in a
-- prior session) granting the internal admin account cross-tenant SELECT.
-- Per-tenant cards on the dashboard also need company_name from
-- p2_tenant_settings, which only has a tenant-scoped SELECT policy
-- (tenant_id = auth.uid()) — so the admin session could only ever read its
-- own tenant's settings row. This mirrors the same admin-UID pattern onto
-- p2_tenant_settings. Permissive policy, ORs with the existing tenant-scoped
-- SELECT policy, so normal tenant sessions are unaffected.
CREATE POLICY "admin_read_all_tenant_settings" ON p2_tenant_settings
  FOR SELECT
  USING (auth.uid() = 'fe2b94fb-9668-405f-9c62-5f54b32f8c7a');
