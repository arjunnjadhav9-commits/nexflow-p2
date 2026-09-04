-- Fix 1: Enable RLS on every table that has a policy but was never actually
-- switched on. Run in Supabase SQL Editor as postgres role. Do not use
-- `supabase db push`.
--
-- Root cause, confirmed live by the project's own Sept 2 migration comment
-- (20260902_create_supplier_advances.sql:44-49): 20260803_staff_rls_fix.sql
-- created a "staff_tenant_access" policy on 15 tables but never ran
-- ENABLE ROW LEVEL SECURITY on any of them, so every one of those policies
-- was silently inert -- any authenticated user (including a brand-new
-- signup) could read and write every other tenant's rows through the public
-- anon key. p2_stock_transactions is the worst of these: the complete
-- purchase/consumption ledger for all three live tenants.
--
-- ALTER TABLE ... ENABLE ROW LEVEL SECURITY is a safe no-op if a table
-- already has it enabled, so this migration lists all 15 tables from
-- 20260803_staff_rls_fix.sql plus p2_user_roles (has its own SELECT-own +
-- DELETE policies from 20260803_pending_invites_and_role_fixes.sql /
-- 20260803_p2_user_roles_select_own_row.sql, also never enabled) -- there is
-- no harm in re-stating the ones that may already be correctly enabled
-- elsewhere.
--
-- p2_tenants originally had ZERO policies anywhere in the migrations, so
-- enabling RLS on it bare would have denied ALL access to every non-owner
-- role -- including checkAuth()'s is_demo lookup on every single login.
-- It is included below now, bundled with the compensating policy and FK
-- drops confirmed necessary live: without a policy that also matches staff
-- (not just the owner, whose auth.uid() equals the tenant id), a staff
-- member's session cannot see its own tenant's row in p2_tenants, and
-- Postgres's foreign-key check on INSERT into p2_stock_transactions
-- (tenant_id/principal_tenant_id -> p2_tenants(id)) runs as that same
-- session -- so the FK check fails even though the referenced row exists,
-- and every GRN/stock write from a staff role is rejected.
--
-- Run this diagnostic before and after:
--   SELECT relname, relrowsecurity
--   FROM pg_class
--   WHERE relname LIKE 'p2_%'
--   ORDER BY relname;

BEGIN;

ALTER TABLE p2_agent_logs         ENABLE ROW LEVEL SECURITY;
ALTER TABLE p2_client_po_numbers  ENABLE ROW LEVEL SECURITY;
ALTER TABLE p2_clients            ENABLE ROW LEVEL SECURITY;
ALTER TABLE p2_dispatch_items     ENABLE ROW LEVEL SECURITY;
ALTER TABLE p2_dispatch_orders    ENABLE ROW LEVEL SECURITY;
ALTER TABLE p2_invoices           ENABLE ROW LEVEL SECURITY;
ALTER TABLE p2_material_prices    ENABLE ROW LEVEL SECURITY;
ALTER TABLE p2_pending_invites    ENABLE ROW LEVEL SECURITY;
ALTER TABLE p2_product_bom        ENABLE ROW LEVEL SECURITY;
ALTER TABLE p2_product_prices     ENABLE ROW LEVEL SECURITY;
ALTER TABLE p2_products           ENABLE ROW LEVEL SECURITY;
ALTER TABLE p2_raw_materials      ENABLE ROW LEVEL SECURITY;
ALTER TABLE p2_stock_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE p2_suppliers          ENABLE ROW LEVEL SECURITY;
ALTER TABLE p2_tenant_settings    ENABLE ROW LEVEL SECURITY;
ALTER TABLE p2_user_roles         ENABLE ROW LEVEL SECURITY;
ALTER TABLE p2_tenants            ENABLE ROW LEVEL SECURITY;

-- p2_tenants SELECT policy -- must cover both the owner (auth.uid() = the
-- tenant's own id) and staff (resolved via get_my_tenant_id(), which reads
-- p2_user_roles). A policy scoped to auth.uid() alone leaves every staff
-- member unable to see their own tenant's row.
DROP POLICY IF EXISTS "p2_tenants_select_policy" ON p2_tenants;
CREATE POLICY "p2_tenants_select_policy" ON p2_tenants
FOR SELECT USING (
  id = auth.uid() OR id = get_my_tenant_id()
);

-- FK constraints on p2_stock_transactions reference p2_tenants directly.
-- These block inserts for staff roles after RLS was enabled on p2_tenants.
-- RLS on p2_stock_transactions already enforces tenant isolation.
ALTER TABLE p2_stock_transactions
DROP CONSTRAINT IF EXISTS p2_stock_transactions_tenant_id_fkey;

ALTER TABLE p2_stock_transactions
DROP CONSTRAINT IF EXISTS p2_stock_transactions_principal_tenant_id_fkey;

COMMIT;

-- Verify immediately after with the same diagnostic query above -- every
-- p2_ row, including p2_tenants, should now show relrowsecurity = t.
--
-- Then spot-check as the test tenant (fe2b94fb-9668-405f-9c62-5f54b32f8c7a,
-- arjunjadhav9@gmail.com) that GRN history, materials, and settings still
-- load normally -- RLS turning on should change nothing for a tenant reading
-- its own rows, only block cross-tenant reads. Also verify as a STAFF role
-- (not owner) on the test tenant that a GRN submission succeeds -- this is
-- the exact write that was failing with a foreign-key violation before the
-- p2_tenants policy and FK drops above.
--
-- OPEN ITEM for a later session (not fixed here): grn.html queries
-- p2_tenants directly for a plan/tier check
-- (p2_tenants?select=plan&id=...), which now 400s for staff roles -- the
-- direct id= filter doesn't match the policy above for a staff session in
-- every case grn.html uses it. grn.html should read plan from
-- p2_tenant_settings instead, matching every other page in the codebase.
