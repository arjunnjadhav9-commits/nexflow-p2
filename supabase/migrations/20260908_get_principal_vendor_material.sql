-- Phase 2 (KPML Principal Dashboard) — the single scoped access path.
--
-- Before writing this file: the exact SELECT list below was reviewed and
-- confirmed column-by-column (see Session 9 plan discussion) with one
-- addition — hsn_sac, for the Monthly AI Filing Package (enterprise-strategy.md
-- §3.2) to consume later without a second schema change.
--
-- NOTE ON THE COMMENT BELOW: the brief asked for "the scope-boundary text you
-- provided above, verbatim." Re-checking this session's own transcript, no
-- such verbatim text was actually supplied earlier — the closest source is
-- _ai/kpml-network-plan.md §10.5 ("Principal visibility isolation"), quoted
-- directly below rather than paraphrased. If a different exact wording was
-- intended, swap it in before running this in the SQL Editor.
--
-- ============================================================================
-- SCOPE BOUNDARY — READ THIS BEFORE ADDING ANY QUERY THAT TOUCHES
-- p2_stock_transactions FOR A PRINCIPAL-FACING SURFACE.
--
-- Source: _ai/kpml-network-plan.md §10.5, "Principal visibility isolation —
-- the top product risk":
--
--   "A p2_network_links row for KPML resolves to exactly one filter:
--    owned_by = KPML. Every principal-facing read starts from that filter
--    and can never widen it."
--
--   "Not 'the vendor's stock.' Not 'the vendor's copper.' KPML's copper,
--    at the vendor's premises."
--
-- This function is THE single enforcement point for that rule. Per
-- kpml-network-plan.md §17: "Cross-tenant access: SECURITY DEFINER RPCs
-- only, never open RLS — and all of them behind the single scoped path."
--
-- Do not add a second RPC, view, or ad-hoc query that lets a principal
-- tenant read another tenant's p2_stock_transactions, p2_clients,
-- p2_dispatch_orders, or p2_raw_materials rows. If a new principal-facing
-- field is needed, extend THIS function's SELECT list — do not create a
-- parallel path. A second route to the same data is explicitly named in
-- §10.5 as failure mode 6 ("RPC drift") and is the one the document says
-- "actually happens."
--
-- This function NEVER returns, under any circumstance:
--   - any row where owned_by IS DISTINCT FROM the resolved vendor_client_id
--     (the vendor's own stock, or any other principal's material at that
--     vendor)
--   - any aggregate that sums across owners
--   - any signal that another principal relationship exists at that vendor
--   - anything from p2_dispatch_orders, p2_invoices, p2_suppliers, or any
--     other vendor business data not listed in the SELECT below
--   - any column not required by the read-only Phase 2 dashboard (no
--     reconciliation-gap fields — see the Phase 2 plan's scope decision)
-- ============================================================================
--
-- Run in Supabase SQL Editor as postgres role. Do not use `supabase db push`.
-- Depends on: 20260908_network_links.sql (p2_network_links),
-- p2_clients.linked_tenant_id (Step 2I groundwork, _ai/CLAUDE.md),
-- get_my_tenant_id() (existing).

CREATE OR REPLACE FUNCTION get_principal_vendor_material()
RETURNS TABLE (
  vendor_tenant_id      uuid,
  vendor_name           text,
  raw_material_id       uuid,
  material_name         text,
  material_code         text,
  unit                  text,
  uqc                   text,
  hsn_sac               text,
  current_stock         numeric,
  principal_challan_no  text,
  principal_challan_date date,
  transaction_date      date
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

  -- Branch 1 — one row per (vendor, material): the current owned_by-scoped
  -- balance. GROUP BY, not a window function, so each material appears once
  -- with its true summed total — same aggregation shape as
  -- v_p2_stock_balance_by_owner (20260904_stock_balance_by_owner.sql).
  RETURN QUERY
  SELECT
    nl.vendor_tenant_id,
    vts.company_name,
    st.raw_material_id,
    rm.name,
    rm.material_code,
    rm.unit,
    rm.uqc,
    rm.hsn_sac,
    SUM(st.quantity) AS current_stock,
    NULL::text,
    NULL::date,
    NULL::date
  FROM p2_network_links nl
  JOIN p2_tenant_settings vts ON vts.tenant_id = nl.vendor_tenant_id
  JOIN p2_clients vc ON vc.tenant_id = nl.vendor_tenant_id
                    AND vc.linked_tenant_id = v_caller_tenant
  JOIN p2_stock_transactions st ON st.tenant_id = nl.vendor_tenant_id
                               AND st.owned_by = vc.id
  JOIN p2_raw_materials rm ON rm.id = st.raw_material_id
                          AND rm.tenant_id = nl.vendor_tenant_id
  WHERE nl.principal_tenant_id = v_caller_tenant
    AND nl.status = 'active'
  GROUP BY nl.vendor_tenant_id, vts.company_name, st.raw_material_id,
           rm.name, rm.material_code, rm.unit, rm.uqc, rm.hsn_sac

  UNION ALL

  -- Branch 2 — one row per GRN transaction: raw clock inputs
  -- (principal_challan_date / transaction_date) for js/s143-clock.js's
  -- computeS143Clock() to run client-side, unaggregated, same shape
  -- itc04-workingpaper.html already queries.

  SELECT
    nl.vendor_tenant_id,
    vts.company_name,
    st.raw_material_id,
    rm.name,
    rm.material_code,
    rm.unit,
    rm.uqc,
    rm.hsn_sac,
    NULL::numeric,
    st.principal_challan_no,
    st.principal_challan_date,
    st.transaction_date
  FROM p2_network_links nl
  JOIN p2_tenant_settings vts ON vts.tenant_id = nl.vendor_tenant_id
  JOIN p2_clients vc ON vc.tenant_id = nl.vendor_tenant_id
                    AND vc.linked_tenant_id = v_caller_tenant
  JOIN p2_stock_transactions st ON st.tenant_id = nl.vendor_tenant_id
                               AND st.owned_by = vc.id
  JOIN p2_raw_materials rm ON rm.id = st.raw_material_id
                          AND rm.tenant_id = nl.vendor_tenant_id
  WHERE nl.principal_tenant_id = v_caller_tenant
    AND nl.status = 'active'
    AND st.transaction_type = 'grn';
END;
$$;

REVOKE ALL ON FUNCTION get_principal_vendor_material() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION get_principal_vendor_material() TO authenticated;
