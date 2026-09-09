-- Phase 2 (KPML Principal Dashboard), Session 10 Goal 2 — principal-side
-- payment visibility. Same single-scoped-access-path pattern as
-- get_principal_vendor_material() (20260908_get_principal_vendor_material.sql)
-- — do not add a second query against another tenant's p2_invoices,
-- p2_payment_receipts, or p2_clients anywhere else. Extend this function's
-- SELECT list if a new principal-facing invoice field is ever needed.
--
-- ============================================================================
-- SCOPE BOUNDARY — READ THIS BEFORE ADDING ANY QUERY THAT TOUCHES
-- p2_invoices OR p2_payment_receipts FOR A PRINCIPAL-FACING SURFACE.
--
-- Source: _ai/kpml-network-plan.md §10.5, "Principal visibility isolation —
-- the top product risk":
--
--   "A p2_network_links row for KPML resolves to exactly one filter:
--    owned_by = KPML. Every principal-facing read starts from that filter
--    and can never widen it."
--
-- For invoices there is no owned_by column, so the equivalent filter is:
-- only invoices where the vendor's OWN p2_clients row representing this
-- principal (linked_tenant_id = caller) is the invoice's client_id. That is
-- exactly "the invoice is addressed to this principal" — never another of
-- the vendor's clients, never another principal's invoices at that vendor.
--
-- This function NEVER returns, under any circumstance:
--   - any invoice whose client_id is not the vendor's linked-to-caller
--     p2_clients row (another client's invoice, or a job-work-material row
--     that never should have had a job-charge invoice at all)
--   - any p2_payment_receipts row not belonging to an invoice already in
--     scope by the rule above
--   - any aggregate that sums across vendors
--   - anything from p2_dispatch_orders, p2_stock_transactions, p2_suppliers,
--     p2_material_prices, or any other vendor business data not listed below
--   - draft invoices (status='draft') — not yet addressed to anyone
-- ============================================================================
--
-- Run in Supabase SQL Editor as postgres role. Do not use `supabase db push`.
-- Depends on: p2_network_links (20260908_network_links.sql), p2_clients.
-- linked_tenant_id (Step 2I groundwork, _ai/CLAUDE.md), get_my_tenant_id()
-- (existing), p2_payment_receipts (20260828_payment_ledger.sql).

CREATE OR REPLACE FUNCTION get_principal_vendor_invoices()
RETURNS TABLE (
  vendor_tenant_id   uuid,
  vendor_name        text,
  invoice_id         uuid,
  invoice_number     text,
  invoice_date       date,
  amount_total       numeric,
  status             text,
  payment_status     text,
  amount_paid        numeric,
  amount_outstanding numeric,
  days_since_invoice integer,
  risk_43b_h         boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller_tenant uuid;
  v_caller_is_principal boolean;
BEGIN
  v_caller_tenant := get_my_tenant_id();

  SELECT ts.is_principal INTO v_caller_is_principal
  FROM p2_tenant_settings ts
  WHERE ts.tenant_id = v_caller_tenant;

  IF v_caller_tenant IS NULL OR v_caller_is_principal IS NOT TRUE THEN
    RETURN; -- empty result, never an error — do not leak *why* to a non-principal caller
  END IF;

  -- vc: the vendor's own p2_clients row representing KPML — this is what
  -- p2_invoices.client_id points at, since the vendor bills KPML through
  -- that row. Same join get_principal_vendor_material() uses for owned_by.
  --
  -- pc: the REVERSE-direction row — KPML's own p2_clients row representing
  -- this vendor (linked_tenant_id = vendor_tenant_id). LEFT JOIN because a
  -- vendor may not be classified yet. Supplies enterprise_class for the
  -- 43B(h) MSME test only — never used for invoice scoping.
  RETURN QUERY
  SELECT
    nl.vendor_tenant_id,
    vts.company_name,
    i.id,
    i.invoice_number,
    i.invoice_date,
    i.amount_total,
    i.status,
    CASE
      WHEN COALESCE(SUM(r.net_amount), 0) >= i.amount_total THEN 'paid'
      WHEN COALESCE(SUM(r.net_amount), 0) > 0                THEN 'partial'
      ELSE 'unpaid'
    END,
    COALESCE(SUM(r.net_amount), 0),
    i.amount_total - COALESCE(SUM(r.net_amount), 0),
    ((now() AT TIME ZONE 'Asia/Kolkata')::date - i.invoice_date),
    (
      i.status = 'sent'
      AND ((now() AT TIME ZONE 'Asia/Kolkata')::date - i.invoice_date) > 45
      AND COALESCE(SUM(r.net_amount), 0) < i.amount_total
      AND pc.enterprise_class IN ('micro', 'small')
    )
  FROM p2_network_links nl
  JOIN p2_tenant_settings vts ON vts.tenant_id = nl.vendor_tenant_id
  JOIN p2_clients vc  ON vc.tenant_id = nl.vendor_tenant_id
                     AND vc.linked_tenant_id = v_caller_tenant
  JOIN p2_invoices i  ON i.tenant_id = nl.vendor_tenant_id
                     AND i.client_id = vc.id
  LEFT JOIN p2_clients pc ON pc.tenant_id = v_caller_tenant
                         AND pc.linked_tenant_id = nl.vendor_tenant_id
  LEFT JOIN p2_payment_receipts r ON r.invoice_id = i.id AND r.tenant_id = i.tenant_id
  WHERE nl.principal_tenant_id = v_caller_tenant
    AND nl.status = 'active'
    AND i.status IN ('sent', 'cancelled')
  GROUP BY nl.vendor_tenant_id, vts.company_name, i.id, i.invoice_number,
           i.invoice_date, i.amount_total, i.status, pc.enterprise_class;
END;
$$;

REVOKE ALL ON FUNCTION get_principal_vendor_invoices() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION get_principal_vendor_invoices() TO authenticated;

-- ============================================================================
-- Data setup — KPML's own classification of the test-tenant vendor, so
-- risk_43b_h is testable. This inserts into KPML's OWN p2_clients table
-- (cc23eb60), not the vendor's — no vendor tenant is touched. Real vendors
-- (SS Engineering, Datta Prasad, Shivprasad) get an equivalent row only when
-- actually linked via p2_network_links — deferred, same as real vendor
-- linking generally (see _ai/CLAUDE.md, "Real vendor linking ... deferred").
-- ============================================================================
INSERT INTO p2_clients (tenant_id, name, linked_tenant_id, enterprise_class, registration_activity)
VALUES (
  'cc23eb60-329b-40ac-8d4a-0667c28546a5',        -- KPML tenant
  'Shree Ganesh Engineering Works',               -- test tenant's company name
  'fe2b94fb-9668-405f-9c62-5f54b32f8c7a',        -- test tenant id
  'small',
  'manufacturing'
);
