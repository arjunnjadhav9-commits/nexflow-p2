-- Switch v_p2_invoice_payment_status from created_at (UTC insert timestamp) to
-- the real invoice_date column added in 20260901_add_invoice_date.sql.
--
-- This view is read server-side only by check-low-stock's payment_overdue_notify
-- mode (Step 4) for the 45-day overdue threshold -- check-low-stock/index.ts
-- itself needs no code change, since it already selects `invoice_date` from this
-- view by column name; only the view's own definition was computing that alias
-- from the wrong source column.
--
-- Column list, join, and the paid/partial/pending branches of the CASE are
-- otherwise unchanged -- only the invoice_date alias source and the overdue
-- predicate move from created_at to invoice_date.

CREATE OR REPLACE VIEW v_p2_invoice_payment_status AS
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

-- Run this in Supabase SQL Editor as postgres role.
-- Test tenant: fe2b94fb-9668-405f-9c62-5f54b32f8c7a
-- NEVER run against SS Engineering (5ab7fb07), Datta Prasad (3b68db90),
--   Shivprasad (6fe0680a), or Demo (5f021c96).
