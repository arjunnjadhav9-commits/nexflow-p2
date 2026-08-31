-- 1. p2_payment_receipts table
CREATE TABLE p2_payment_receipts (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES p2_tenants(id),
  invoice_id uuid NOT NULL REFERENCES p2_invoices(id),
  payment_date date NOT NULL,
  gross_amount numeric(12,2) NOT NULL CHECK (gross_amount > 0),
  tds_amount numeric(12,2) NOT NULL DEFAULT 0 CHECK (tds_amount >= 0),
  other_deductions numeric(12,2) NOT NULL DEFAULT 0 CHECK (other_deductions >= 0),
  net_amount numeric(12,2) GENERATED ALWAYS AS
    (gross_amount - tds_amount - other_deductions) STORED,
  payment_mode text CHECK (payment_mode IN
    ('neft','rtgs','cheque','upi','cash','adjustment')),
  reference_no text,
  notes text,
  created_at timestamptz DEFAULT now()
);

-- 2. RLS
ALTER TABLE p2_payment_receipts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tenant_own" ON p2_payment_receipts
  FOR ALL USING (tenant_id = auth.uid());

-- 3. Indexes
CREATE INDEX p2_payment_receipts_tenant_id_idx
  ON p2_payment_receipts(tenant_id);
CREATE INDEX p2_payment_receipts_invoice_id_idx
  ON p2_payment_receipts(invoice_id);

-- 4. Payment status view
CREATE VIEW v_p2_invoice_payment_status AS
SELECT
  i.id AS invoice_id,
  i.tenant_id,
  i.client_id,
  i.client_name,
  i.invoice_number,
  i.amount_total,
  i.created_at AS invoice_date,
  i.status AS invoice_status,
  COALESCE(SUM(r.net_amount), 0) AS total_received,
  i.amount_total - COALESCE(SUM(r.net_amount), 0) AS balance_due,
  CASE
    WHEN i.status != 'sent' THEN 'not_applicable'
    WHEN COALESCE(SUM(r.net_amount), 0) >= i.amount_total THEN 'paid'
    WHEN COALESCE(SUM(r.net_amount), 0) > 0 THEN 'partial'
    WHEN i.created_at < now() - INTERVAL '45 days' THEN 'overdue'
    ELSE 'pending'
  END AS payment_status,
  COUNT(r.id) AS receipt_count
FROM p2_invoices i
LEFT JOIN p2_payment_receipts r
  ON r.invoice_id = i.id AND r.tenant_id = i.tenant_id
GROUP BY
  i.id, i.tenant_id, i.client_id, i.client_name,
  i.invoice_number, i.amount_total, i.created_at, i.status;

-- Run this in Supabase SQL Editor as postgres role.
-- Test tenant: fe2b94fb-9668-405f-9c62-5f54b32f8c7a
-- NEVER run against SS Engineering (5ab7fb07),
--   Datta Prasad (3b68db90), or Shivprasad (6fe0680a).
