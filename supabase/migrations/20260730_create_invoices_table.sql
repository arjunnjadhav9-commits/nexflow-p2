-- Migration: Client Invoice Generation
-- p2_invoices stores a fully frozen snapshot per invoice (client details +
-- line items via `items` jsonb) so the public invoice-view Edge Function
-- never has to re-derive rates from p2_material_prices/p2_product_prices at
-- view time — those prices can change after the invoice is generated and
-- emailed, and re-deriving would silently drift from the stored header
-- totals. `items` shape: [{challan_number, dispatch_date, description, qty,
-- unit, rate, amount}] — challan_number/dispatch_date are always present per
-- item so single-mode and consolidated-mode invoices share one item shape
-- (single mode just doesn't render those two columns).
--
-- invoice_mode 'single' = one dispatch (dispatch_order_id set,
-- dispatch_order_ids is a 1-element array). invoice_mode 'consolidated' =
-- a date range covering multiple confirmed dispatches for one client
-- (dispatch_order_id NULL, dispatch_order_ids holds all covered ids,
-- date_from/date_to set). dispatch_order_ids is audit-trail only — nothing
-- ever re-joins through it to render the PDF.

CREATE TABLE p2_invoices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  invoice_number text NOT NULL,
  dispatch_order_id uuid REFERENCES p2_dispatch_orders(id),
  client_id uuid REFERENCES p2_clients(id),
  client_name text,
  client_address text,
  client_gstin text,
  items jsonb,
  amount_subtotal numeric DEFAULT 0,
  amount_gst numeric DEFAULT 0,
  amount_total numeric DEFAULT 0,
  gst_type text DEFAULT 'cgst_sgst',
  invoice_mode text DEFAULT 'single',
  date_from date,
  date_to date,
  dispatch_order_ids uuid[] DEFAULT '{}',
  invoice_token uuid NOT NULL DEFAULT gen_random_uuid(),
  status text DEFAULT 'draft',
  created_at timestamptz DEFAULT now()
);

ALTER TABLE p2_invoices ENABLE ROW LEVEL SECURITY;

-- No public_token/USING(true) policy: invoice-view reads via service role
-- (SB_SECRET_KEY), which bypasses RLS entirely. A public SELECT policy here
-- would let anyone with the anon key read every tenant's invoice data.
CREATE POLICY "tenant_own" ON p2_invoices
  USING (tenant_id = auth.uid());

-- Enforces "one invoice per dispatch" for single-mode rows. Postgres does
-- not enforce uniqueness across NULLs, so consolidated rows (dispatch_order_id
-- IS NULL) are unaffected — their dedup is the tenant_id+date_from+date_to+
-- client_id check done in application code (agent-query), not this index.
CREATE UNIQUE INDEX p2_invoices_dispatch_order_id_idx
  ON p2_invoices (dispatch_order_id);

-- Public lookup key for invoice-view — must be unique.
CREATE UNIQUE INDEX p2_invoices_invoice_token_idx
  ON p2_invoices (invoice_token);

CREATE OR REPLACE FUNCTION get_next_invoice_number(p_tenant_id uuid)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE v_seq integer;
BEGIN
  SELECT invoice_sequence + 1 INTO v_seq
  FROM p2_tenant_settings
  WHERE tenant_id = p_tenant_id FOR UPDATE;
  UPDATE p2_tenant_settings SET invoice_sequence = v_seq
  WHERE tenant_id = p_tenant_id;
  RETURN 'INV-' || to_char(now(), 'YYYYMM') || '-' || lpad(v_seq::text, 3, '0');
END;$$;

-- Grant execute to service_role — agent-query invokes this using SB_SECRET_KEY.
GRANT EXECUTE ON FUNCTION get_next_invoice_number TO service_role;
