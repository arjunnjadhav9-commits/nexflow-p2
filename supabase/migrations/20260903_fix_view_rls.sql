-- Fix 2: v_p2_invoice_payment_status and v_p2_wip_balance bypass RLS
-- entirely -- both run with the view owner's (postgres) privileges by
-- default, and Supabase's default grants give anon+authenticated SELECT on
-- new views, so any logged-in user of any tenant can currently read every
-- other tenant's invoice numbers, client names, amounts, receivables and WIP
-- quantities through the public anon key. Same bug class the Sept 2 audit
-- fixed in v_p2_supplier_advance_balance (20260902_create_supplier_advances.sql)
-- and did not carry across to these two siblings.
--
-- Run in Supabase SQL Editor as postgres role. Do not use `supabase db push`.
--
-- The two views get DIFFERENT fixes, not one template applied blindly,
-- because they have different consumers:

-- ─────────────────────────────────────────────────────────────────────────
-- v_p2_wip_balance -- browser-only consumer (production-issue.html, the
-- logged-in user's own session). Its only source table, p2_wip_transactions,
-- already has RLS enabled with a staff_tenant_access policy
-- (20260825_wip_state.sql:35-39). Full belt-and-suspenders pattern is safe
-- here: security_invoker = true AND an explicit tenant filter, same as
-- v_p2_supplier_advance_balance.
-- ─────────────────────────────────────────────────────────────────────────

DROP VIEW IF EXISTS v_p2_wip_balance;

CREATE VIEW v_p2_wip_balance
WITH (security_invoker = true) AS
SELECT tenant_id, product_id, owned_by, SUM(quantity) AS wip_qty
FROM p2_wip_transactions
WHERE tenant_id = get_my_tenant_id()
GROUP BY tenant_id, product_id, owned_by
HAVING SUM(quantity) <> 0;

-- ─────────────────────────────────────────────────────────────────────────
-- v_p2_invoice_payment_status -- ALSO read server-side by
-- check-low-stock/index.ts (payment_overdue_digest and payment_overdue_notify,
-- cron jobid 8) via the SERVICE ROLE key, looped once per tenant with an
-- explicit .eq('tenant_id', tenant.id) -- this powers the live
-- payment-overdue Telegram digest and in-app bell notifications for all
-- three paying tenants today.
--
-- get_my_tenant_id() resolves to NULL for a service-role call (no
-- auth.uid()). Baking WHERE tenant_id = get_my_tenant_id() into this view
-- (the literal v_p2_supplier_advance_balance pattern) would make it return
-- ZERO rows for that caller forever -- silently killing payment-overdue
-- alerts for every tenant, with no error thrown anywhere.
--
-- Correct fix instead: security_invoker = true (correct now that
-- p2_invoices and p2_payment_receipts both already enforce correct
-- per-tenant RLS -- p2_invoices has staff_tenant_access via
-- get_my_tenant_id(), p2_payment_receipts was fixed the same way in
-- 20260901_fix_payment_receipts_rls.sql) PLUS an explicit REVOKE of SELECT
-- from anon and authenticated. This makes the view completely unreachable
-- from any browser session regardless of RLS correctness on the underlying
-- tables, while service_role (untouched by the REVOKE) keeps exactly the
-- cross-tenant read check-low-stock already relies on.
-- ─────────────────────────────────────────────────────────────────────────

DROP VIEW IF EXISTS v_p2_invoice_payment_status;

CREATE VIEW v_p2_invoice_payment_status
WITH (security_invoker = true) AS
SELECT
  i.id AS invoice_id,
  i.tenant_id,
  i.client_id,
  i.client_name,
  i.invoice_number,
  i.amount_total,
  i.invoice_date,
  i.status AS invoice_status,
  COALESCE(SUM(r.net_amount), 0) AS total_received,
  i.amount_total - COALESCE(SUM(r.net_amount), 0) AS balance_due,
  CASE
    WHEN i.status != 'sent' THEN 'not_applicable'
    WHEN COALESCE(SUM(r.net_amount), 0) >= i.amount_total THEN 'paid'
    WHEN COALESCE(SUM(r.net_amount), 0) > 0 THEN 'partial'
    WHEN i.invoice_date < (now() AT TIME ZONE 'Asia/Kolkata')::date - 45 THEN 'overdue'
    ELSE 'pending'
  END AS payment_status,
  COUNT(r.id) AS receipt_count
FROM p2_invoices i
LEFT JOIN p2_payment_receipts r
  ON r.invoice_id = i.id AND r.tenant_id = i.tenant_id
GROUP BY
  i.id, i.tenant_id, i.client_id, i.client_name,
  i.invoice_number, i.amount_total, i.invoice_date, i.status;

REVOKE SELECT ON v_p2_invoice_payment_status FROM anon, authenticated;

-- ─────────────────────────────────────────────────────────────────────────
-- Verification (run as the test tenant, fe2b94fb-9668-405f-9c62-5f54b32f8c7a):
--
-- 1. From the browser (anon key + a logged-in test-tenant session):
--      supabase.from('v_p2_wip_balance').select('*')
--      supabase.from('v_p2_invoice_payment_status').select('*')
--    Second call should now fail/return nothing (permission denied) --
--    it was never meant to be browser-reachable. First call should return
--    only the test tenant's own WIP rows, zero from any other tenant.
--
-- 2. production-issue.html's WIP panel still loads and shows correct
--    balances for the test tenant.
--
-- 3. Manually invoke check-low-stock with
--    {"mode":"payment_overdue_digest"} or trigger jobid 8 and confirm it
--    still finds overdue invoices for a tenant that has one (test tenant --
--    never a live tenant) -- confirms service_role access is intact.
--
-- v_p2_stock_balance is not defined anywhere in this repo (confirmed by
-- the codebase audit) -- out of scope for this fix, not touched here.
-- ─────────────────────────────────────────────────────────────────────────
