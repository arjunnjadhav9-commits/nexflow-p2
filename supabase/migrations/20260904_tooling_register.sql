-- Fix 1 — Tooling register: exempt tooling visible, not invisible.
-- is_exempt_tooling = true currently nulls the s.143 deadline with no
-- replacement surface (_ai/compliance-and-field-report.md §1.6). These
-- columns back a periodic-attestation register instead of a clock.
--
-- p2_dispatch_orders already has is_exempt_tooling boolean (default false,
-- Step 2K, 20260825_s143_clock_population.sql) and RLS enabled with a
-- staff_tenant_access FOR ALL policy scoped to get_my_tenant_id()
-- (20260803_staff_rls_fix.sql + 20260903_enable_rls_all_tables.sql) — that
-- policy already covers the new columns below for SELECT/UPDATE, so no new
-- policy is added here.
--
-- Run in Supabase SQL Editor as postgres role. Do not use `supabase db push`
-- (it replays old migrations against this project).

ALTER TABLE p2_dispatch_orders
ADD COLUMN IF NOT EXISTS asset_tag text,
ADD COLUMN IF NOT EXISTS last_confirmed_at timestamptz,
ADD COLUMN IF NOT EXISTS confirmed_by uuid REFERENCES auth.users(id);

-- Backs the Tooling Register's is_exempt_tooling = true filter
-- (all-dispatch-history.html loadToolingRegister()).
CREATE INDEX IF NOT EXISTS idx_p2_dispatch_orders_exempt_tooling
  ON p2_dispatch_orders(tenant_id, is_exempt_tooling)
  WHERE is_exempt_tooling = true;
