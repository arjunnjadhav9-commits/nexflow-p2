-- Fix staff RLS write policies: replace auth.uid() with get_my_tenant_id() on
-- INSERT/UPDATE/DELETE (and ALL) policies where auth.uid() only resolves
-- correctly for the tenant owner, silently mis-scoping writes for every
-- non-owner staff role (supervisor, storekeeper, operator, accountant).
--
-- Every DROP POLICY IF EXISTS below targets a real, currently-live policy
-- name confirmed against a live `pg_policies` dump taken immediately before
-- writing this file -- each replacement CREATE POLICY reproduces the
-- existing qual/with_check exactly except for the auth.uid() ->
-- get_my_tenant_id() swap (and, on the three ALL policies noted below, an
-- added explicit WITH CHECK matching the existing USING).
--
-- Deliberately excluded:
--   - p2_tenants: id = auth.uid() is correct there (owner-only writes, id
--     IS the tenant's own auth uid).
--   - p2_user_roles_delete_policy: tenant_id = auth.uid() AND
--     user_id <> tenant_id is intentional owner-only staff removal (see
--     _ai/codebase-audit.md). Swapping to get_my_tenant_id() would let any
--     staff member delete any other staff member -- confirmed NOT wanted.
--     Only p2_user_roles' INSERT policy is fixed below (staff invite flow
--     needs to insert role rows).
--   - All SELECT policies -- already covered by the staff_tenant_access
--     policy present on every one of these tables.
--
-- Note on p2_invoices: its old "tenant_own" policy was FOR ALL (covering
-- SELECT too), so the replacement below also grants staff read access to
-- invoices via get_my_tenant_id(), not just write -- correct, since roles
-- like accountant need invoice visibility.
--
-- NOTE (follow-up, not fixed here -- pre-existing gap, not introduced by
-- this migration): a permissive "staff_tenant_access" FOR ALL policy
-- (USING (tenant_id = get_my_tenant_id()), no is_demo_user() check) already
-- exists on every table below except p2_user_roles. Permissive policies OR
-- together, so a demo-tenant user can still write to p2_material_prices/
-- p2_product_bom/p2_product_prices/p2_products/p2_raw_materials/
-- p2_suppliers/p2_tenant_settings via staff_tenant_access alone, regardless
-- of the AND NOT is_demo_user() added below to their named per-command
-- policies. Blocking the demo tenant for real requires separately narrowing
-- or dropping staff_tenant_access on these tables -- a separate fix.
--
-- Run in Supabase SQL Editor as postgres role. Do not use `supabase db push`
-- (it replays old migrations against this project).

BEGIN;

-- ── p2_agent_logs ──────────────────────────────────────────────────────────
-- Was: tenant_isolation ALL, USING (tenant_id = auth.uid()), with_check null.
DROP POLICY IF EXISTS "tenant_isolation" ON p2_agent_logs;
CREATE POLICY "tenant_isolation" ON p2_agent_logs
FOR ALL USING (tenant_id = get_my_tenant_id())
WITH CHECK (tenant_id = get_my_tenant_id());

-- ── p2_client_po_numbers ───────────────────────────────────────────────────
DROP POLICY IF EXISTS "tenant_delete" ON p2_client_po_numbers;
CREATE POLICY "tenant_delete" ON p2_client_po_numbers
FOR DELETE USING (tenant_id = get_my_tenant_id());

DROP POLICY IF EXISTS "tenant_insert" ON p2_client_po_numbers;
CREATE POLICY "tenant_insert" ON p2_client_po_numbers
FOR INSERT WITH CHECK (tenant_id = get_my_tenant_id());

-- ── p2_clients ─────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "p2_clients_delete_policy" ON p2_clients;
CREATE POLICY "p2_clients_delete_policy" ON p2_clients
FOR DELETE USING (tenant_id = get_my_tenant_id());

DROP POLICY IF EXISTS "p2_clients_insert_policy" ON p2_clients;
CREATE POLICY "p2_clients_insert_policy" ON p2_clients
FOR INSERT WITH CHECK (tenant_id = get_my_tenant_id());

DROP POLICY IF EXISTS "p2_clients_update_policy" ON p2_clients;
CREATE POLICY "p2_clients_update_policy" ON p2_clients
FOR UPDATE USING (tenant_id = get_my_tenant_id());

-- ── p2_invoices ────────────────────────────────────────────────────────────
-- Was: tenant_own ALL, USING (tenant_id = auth.uid()), with_check null.
DROP POLICY IF EXISTS "tenant_own" ON p2_invoices;
CREATE POLICY "tenant_own" ON p2_invoices
FOR ALL USING (tenant_id = get_my_tenant_id())
WITH CHECK (tenant_id = get_my_tenant_id());

-- ── p2_material_prices ─────────────────────────────────────────────────────
DROP POLICY IF EXISTS "p2_material_prices_delete_policy" ON p2_material_prices;
CREATE POLICY "p2_material_prices_delete_policy" ON p2_material_prices
FOR DELETE USING (tenant_id = get_my_tenant_id() AND NOT is_demo_user());

DROP POLICY IF EXISTS "p2_material_prices_insert_policy" ON p2_material_prices;
CREATE POLICY "p2_material_prices_insert_policy" ON p2_material_prices
FOR INSERT WITH CHECK (tenant_id = get_my_tenant_id() AND NOT is_demo_user());

DROP POLICY IF EXISTS "p2_material_prices_update_policy" ON p2_material_prices;
CREATE POLICY "p2_material_prices_update_policy" ON p2_material_prices
FOR UPDATE USING (tenant_id = get_my_tenant_id() AND NOT is_demo_user());

-- ── p2_pending_invites ─────────────────────────────────────────────────────
-- Was: tenant_own ALL, USING (tenant_id = auth.uid()), with_check null.
DROP POLICY IF EXISTS "tenant_own" ON p2_pending_invites;
CREATE POLICY "tenant_own" ON p2_pending_invites
FOR ALL USING (tenant_id = get_my_tenant_id())
WITH CHECK (tenant_id = get_my_tenant_id());

-- ── p2_product_bom ─────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "p2_product_bom_delete_policy" ON p2_product_bom;
CREATE POLICY "p2_product_bom_delete_policy" ON p2_product_bom
FOR DELETE USING (tenant_id = get_my_tenant_id() AND NOT is_demo_user());

DROP POLICY IF EXISTS "p2_product_bom_insert_policy" ON p2_product_bom;
CREATE POLICY "p2_product_bom_insert_policy" ON p2_product_bom
FOR INSERT WITH CHECK (tenant_id = get_my_tenant_id() AND NOT is_demo_user());

DROP POLICY IF EXISTS "p2_product_bom_update_policy" ON p2_product_bom;
CREATE POLICY "p2_product_bom_update_policy" ON p2_product_bom
FOR UPDATE USING (tenant_id = get_my_tenant_id() AND NOT is_demo_user());

-- ── p2_product_prices ──────────────────────────────────────────────────────
DROP POLICY IF EXISTS "p2_product_prices_delete_policy" ON p2_product_prices;
CREATE POLICY "p2_product_prices_delete_policy" ON p2_product_prices
FOR DELETE USING (tenant_id = get_my_tenant_id() AND NOT is_demo_user());

DROP POLICY IF EXISTS "p2_product_prices_insert_policy" ON p2_product_prices;
CREATE POLICY "p2_product_prices_insert_policy" ON p2_product_prices
FOR INSERT WITH CHECK (tenant_id = get_my_tenant_id() AND NOT is_demo_user());

DROP POLICY IF EXISTS "p2_product_prices_update_policy" ON p2_product_prices;
CREATE POLICY "p2_product_prices_update_policy" ON p2_product_prices
FOR UPDATE USING (tenant_id = get_my_tenant_id() AND NOT is_demo_user());

-- ── p2_products ────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "p2_products_delete_policy" ON p2_products;
CREATE POLICY "p2_products_delete_policy" ON p2_products
FOR DELETE USING (tenant_id = get_my_tenant_id() AND NOT is_demo_user());

DROP POLICY IF EXISTS "p2_products_insert_policy" ON p2_products;
CREATE POLICY "p2_products_insert_policy" ON p2_products
FOR INSERT WITH CHECK (tenant_id = get_my_tenant_id() AND NOT is_demo_user());

DROP POLICY IF EXISTS "p2_products_update_policy" ON p2_products;
CREATE POLICY "p2_products_update_policy" ON p2_products
FOR UPDATE USING (tenant_id = get_my_tenant_id() AND NOT is_demo_user());

-- ── p2_raw_materials ───────────────────────────────────────────────────────
DROP POLICY IF EXISTS "p2_raw_materials_delete_policy" ON p2_raw_materials;
CREATE POLICY "p2_raw_materials_delete_policy" ON p2_raw_materials
FOR DELETE USING (tenant_id = get_my_tenant_id() AND NOT is_demo_user());

DROP POLICY IF EXISTS "p2_raw_materials_insert_policy" ON p2_raw_materials;
CREATE POLICY "p2_raw_materials_insert_policy" ON p2_raw_materials
FOR INSERT WITH CHECK (tenant_id = get_my_tenant_id() AND NOT is_demo_user());

DROP POLICY IF EXISTS "p2_raw_materials_update_policy" ON p2_raw_materials;
CREATE POLICY "p2_raw_materials_update_policy" ON p2_raw_materials
FOR UPDATE USING (tenant_id = get_my_tenant_id() AND NOT is_demo_user());

-- ── p2_suppliers ───────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "p2_suppliers_delete_policy" ON p2_suppliers;
CREATE POLICY "p2_suppliers_delete_policy" ON p2_suppliers
FOR DELETE USING (tenant_id = get_my_tenant_id() AND NOT is_demo_user());

DROP POLICY IF EXISTS "p2_suppliers_insert_policy" ON p2_suppliers;
CREATE POLICY "p2_suppliers_insert_policy" ON p2_suppliers
FOR INSERT WITH CHECK (tenant_id = get_my_tenant_id() AND NOT is_demo_user());

DROP POLICY IF EXISTS "p2_suppliers_update_policy" ON p2_suppliers;
CREATE POLICY "p2_suppliers_update_policy" ON p2_suppliers
FOR UPDATE USING (tenant_id = get_my_tenant_id() AND NOT is_demo_user());

-- ── p2_tenant_settings ─────────────────────────────────────────────────────
DROP POLICY IF EXISTS "p2_tenant_settings_delete_policy" ON p2_tenant_settings;
CREATE POLICY "p2_tenant_settings_delete_policy" ON p2_tenant_settings
FOR DELETE USING (tenant_id = get_my_tenant_id() AND NOT is_demo_user());

DROP POLICY IF EXISTS "p2_tenant_settings_insert_policy" ON p2_tenant_settings;
CREATE POLICY "p2_tenant_settings_insert_policy" ON p2_tenant_settings
FOR INSERT WITH CHECK (tenant_id = get_my_tenant_id() AND NOT is_demo_user());

DROP POLICY IF EXISTS "p2_tenant_settings_update_policy" ON p2_tenant_settings;
CREATE POLICY "p2_tenant_settings_update_policy" ON p2_tenant_settings
FOR UPDATE USING (tenant_id = get_my_tenant_id() AND NOT is_demo_user());

-- ── p2_user_roles ──────────────────────────────────────────────────────────
-- INSERT only. p2_user_roles_delete_policy is deliberately left untouched --
-- tenant_id = auth.uid() there is intentional owner-only staff removal,
-- confirmed not to be widened to all staff.
DROP POLICY IF EXISTS "p2_user_roles_insert_policy" ON p2_user_roles;
CREATE POLICY "p2_user_roles_insert_policy" ON p2_user_roles
FOR INSERT WITH CHECK (tenant_id = get_my_tenant_id());

COMMIT;

-- Verification after applying:
--   SELECT tablename, policyname, cmd, qual, with_check FROM pg_policies
--   WHERE schemaname = 'public' AND tablename LIKE 'p2_%'
--   ORDER BY tablename, cmd, policyname;
-- Every policy touched above should now show get_my_tenant_id() instead of
-- auth.uid(), with is_demo_user() preserved exactly where it existed before.
-- Then spot-check as a non-owner staff role on the test tenant
-- (fe2b94fb-9668-405f-9c62-5f54b32f8c7a) that a write to each affected table
-- still succeeds -- RLS changes should be invisible to a tenant working its
-- own rows. NEVER test writes against SS Engineering, Datta Prasad, or
-- Shivprasad (live paying tenants).
