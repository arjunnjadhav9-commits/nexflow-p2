-- Migration: RBAC staff RLS fix
-- Adds get_my_tenant_id() SECURITY DEFINER function and additive permissive
-- policies on all p2_ tables with tenant_id.
-- Does NOT touch or remove any existing policies.
-- Does NOT add policy to p2_user_roles (recursion risk).

BEGIN;

CREATE OR REPLACE FUNCTION get_my_tenant_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE
    WHEN EXISTS (
      SELECT 1 FROM p2_tenants WHERE id = auth.uid()
    )
    THEN auth.uid()
    ELSE (
      SELECT tenant_id FROM p2_user_roles WHERE user_id = auth.uid() LIMIT 1
    )
  END;
$$;

GRANT EXECUTE ON FUNCTION get_my_tenant_id() TO authenticated;

CREATE POLICY "staff_tenant_access" ON p2_agent_logs
  AS PERMISSIVE FOR ALL TO authenticated
  USING (tenant_id = get_my_tenant_id());

CREATE POLICY "staff_tenant_access" ON p2_client_po_numbers
  AS PERMISSIVE FOR ALL TO authenticated
  USING (tenant_id = get_my_tenant_id());

CREATE POLICY "staff_tenant_access" ON p2_clients
  AS PERMISSIVE FOR ALL TO authenticated
  USING (tenant_id = get_my_tenant_id());

CREATE POLICY "staff_tenant_access" ON p2_dispatch_items
  AS PERMISSIVE FOR ALL TO authenticated
  USING (tenant_id = get_my_tenant_id());

CREATE POLICY "staff_tenant_access" ON p2_dispatch_orders
  AS PERMISSIVE FOR ALL TO authenticated
  USING (tenant_id = get_my_tenant_id());

CREATE POLICY "staff_tenant_access" ON p2_invoices
  AS PERMISSIVE FOR ALL TO authenticated
  USING (tenant_id = get_my_tenant_id());

CREATE POLICY "staff_tenant_access" ON p2_material_prices
  AS PERMISSIVE FOR ALL TO authenticated
  USING (tenant_id = get_my_tenant_id());

CREATE POLICY "staff_tenant_access" ON p2_pending_invites
  AS PERMISSIVE FOR ALL TO authenticated
  USING (tenant_id = get_my_tenant_id());

CREATE POLICY "staff_tenant_access" ON p2_product_bom
  AS PERMISSIVE FOR ALL TO authenticated
  USING (tenant_id = get_my_tenant_id());

CREATE POLICY "staff_tenant_access" ON p2_product_prices
  AS PERMISSIVE FOR ALL TO authenticated
  USING (tenant_id = get_my_tenant_id());

CREATE POLICY "staff_tenant_access" ON p2_products
  AS PERMISSIVE FOR ALL TO authenticated
  USING (tenant_id = get_my_tenant_id());

CREATE POLICY "staff_tenant_access" ON p2_raw_materials
  AS PERMISSIVE FOR ALL TO authenticated
  USING (tenant_id = get_my_tenant_id());

CREATE POLICY "staff_tenant_access" ON p2_stock_transactions
  AS PERMISSIVE FOR ALL TO authenticated
  USING (tenant_id = get_my_tenant_id());

CREATE POLICY "staff_tenant_access" ON p2_suppliers
  AS PERMISSIVE FOR ALL TO authenticated
  USING (tenant_id = get_my_tenant_id());

CREATE POLICY "staff_tenant_access" ON p2_tenant_settings
  AS PERMISSIVE FOR ALL TO authenticated
  USING (tenant_id = get_my_tenant_id());

COMMIT;
