-- Item 11: Staff Activity Log
--
-- p2_dispatch_orders.created_by already exists (uuid, NOT NULL) — confirmed live via
-- information_schema before writing this migration. It currently holds tenantId, not
-- auth.uid(); the write-path fix for that is in dispatch.html/rm-dispatch.html, not here.
--
-- p2_stock_transactions and p2_invoices confirmed MISSING created_by (information_schema
-- query returned zero rows for both, same check, same session). p2_dispatch_items is
-- deliberately NOT touched — nothing in v_p2_activity_log or any write path needs it.
--
-- Both new columns: nullable, no default, no backfill. Existing rows have no recoverable
-- attribution (created_by would have to have been auth.uid() from day one to backfill
-- honestly) — they stay NULL and v_p2_activity_log's WHERE created_by IS NOT NULL simply
-- excludes them.

ALTER TABLE p2_stock_transactions ADD COLUMN created_by uuid REFERENCES auth.users(id);
ALTER TABLE p2_invoices ADD COLUMN created_by uuid REFERENCES auth.users(id);

-- v_p2_activity_log — joins the three created_by-bearing tables to p2_user_roles for
-- staff email/role. security_invoker = true + an explicit tenant_id = get_my_tenant_id()
-- filter per branch (not a view "SELECT policy" — Postgres views cannot carry RLS
-- policies; CREATE POLICY only applies to tables). Matches the pattern already proven for
-- v_p2_wip_balance / v_p2_stock_balance_by_owner / v_p2_supplier_advance_balance.
--
-- The explicit filter matters here specifically because p2_invoices' own RLS is
-- tenant_id = auth.uid() (not get_my_tenant_id() — deliberate, no public/anon policy), so
-- security_invoker alone would silently return zero invoice rows for any non-owner caller
-- regardless of this view's own filter. Baking the filter in here makes the view correct
-- on its own terms rather than relying on that coincidence.
--
-- GRN's "detail" column uses supplier_name, not transaction_type — the WHERE clause below
-- already pins transaction_type = 'grn', so transaction_type would just repeat the literal
-- string 'grn' on every row.
CREATE OR REPLACE VIEW v_p2_activity_log WITH (security_invoker = true) AS
SELECT
  'dispatch' AS action_type,
  d.created_at,
  d.created_by,
  ur.email AS staff_email,
  ur.role AS staff_role,
  d.tenant_id,
  d.challan_number AS reference,
  d.dispatch_type AS detail
FROM p2_dispatch_orders d
LEFT JOIN p2_user_roles ur ON ur.user_id = d.created_by AND ur.tenant_id = d.tenant_id
WHERE d.created_by IS NOT NULL
  AND d.tenant_id = get_my_tenant_id()

UNION ALL

SELECT
  'grn' AS action_type,
  st.created_at,
  st.created_by,
  ur.email AS staff_email,
  ur.role AS staff_role,
  st.tenant_id,
  st.grn_no AS reference,
  st.supplier_name AS detail
FROM p2_stock_transactions st
LEFT JOIN p2_user_roles ur ON ur.user_id = st.created_by AND ur.tenant_id = st.tenant_id
WHERE st.transaction_type = 'grn' AND st.created_by IS NOT NULL
  AND st.tenant_id = get_my_tenant_id()

UNION ALL

SELECT
  'invoice' AS action_type,
  i.created_at,
  i.created_by,
  ur.email AS staff_email,
  ur.role AS staff_role,
  i.tenant_id,
  i.invoice_number AS reference,
  i.invoice_mode AS detail
FROM p2_invoices i
LEFT JOIN p2_user_roles ur ON ur.user_id = i.created_by AND ur.tenant_id = i.tenant_id
WHERE i.created_by IS NOT NULL
  AND i.tenant_id = get_my_tenant_id();
