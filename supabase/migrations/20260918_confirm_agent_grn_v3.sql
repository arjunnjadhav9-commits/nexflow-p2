-- W2 — confirm_agent_grn_v3: the GRN write RPC the agent's confirm_proposal handler
-- calls. Replaces confirm_agent_grn_multi (20260725_confirm_agent_grn_multi.sql) for
-- the agent write layer only -- that function is NOT modified or dropped (overload
-- hazard precedent: Step 2G/2M both needed DROP FUNCTION before recreate). This is a
-- new function, built alongside.
--
-- Ground truth for the column list: grn.html's submitGrnTransactions() (grn.html:839),
-- which writes tenant_id, raw_material_id, transaction_type='grn', quantity, rate,
-- supplier_id, supplier_name, transaction_date, invoice_no, purchase_type, grn_no,
-- created_by, owned_by, principal_challan_no, principal_challan_date on every row --
-- confirm_agent_grn_multi is missing invoice_no, rate, purchase_type, owned_by,
-- principal_challan_no/date entirely (see _ai/nexflow-agent.md §0 C3), which is
-- disqualifying: invoice_no is the mandatory GSTR-2B match key, rate values the
-- stock, purchase_type routes CGST+SGST vs IGST, owned_by/principal_challan_* drive
-- the s.143 clock and principal-pool attribution.
--
-- p_items is TEXT, not jsonb -- matching confirm_agent_grn_multi's own convention:
-- the Deno client sends JSON.stringify(items), which a jsonb-typed parameter receives
-- as a double-encoded scalar string (jsonb_array_elements then fails with "cannot
-- extract elements from a scalar").
--
-- p_grn_date is computed by the CALLER (agent-query's todayIST(), or the extracted/
-- confirmed challan date once clarified) and passed in explicitly -- never
-- CURRENT_DATE, which is UTC on Supabase and produces an off-by-one for any GRN
-- confirmed between 00:00 and 05:30 IST (the same class of bug the todayIST() fix
-- documents at five call sites in agent-query/index.ts).
--
-- Only ever called from agent-query's confirm_proposal handler via the SB_SECRET_KEY
-- service-role client -- there is no auth.uid() in that context, so the standard
-- "IF auth.uid() IS NOT NULL THEN ... check tenant/role" guard (as seen in
-- 20260918_edit_product_dispatch_qty.sql) would be a permanent no-op here and is
-- deliberately omitted; role and tenant are already verified in the Edge Function at
-- both propose time (D11) and confirm time (§4.5), before this RPC is ever reached.
-- GRANT EXECUTE is service_role only -- no browser ever calls this directly.

CREATE OR REPLACE FUNCTION public.confirm_agent_grn_v3(
  p_tenant_id              uuid,
  p_supplier_id            uuid,
  p_grn_date               date,
  p_owned_by               uuid,      -- NULL = own stock
  p_principal_challan_no   text,
  p_principal_challan_date date,
  p_created_by             uuid,      -- the confirming user's auth.uid(), resolved by the
                                       -- Edge Function (verifyCallerTenant) -- this RPC has
                                       -- no auth.uid() of its own (service-role caller), and
                                       -- grn.html writes this on every row (Item 11, Staff
                                       -- Activity Log); the byte-identical test (§18.2 #8)
                                       -- does not exclude this column.
  p_items                  text       -- JSON array: [{material_id, quantity, unit, rate, invoice_no, purchase_type}]
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_grn_no      TEXT;
  v_supplier    p2_suppliers%ROWTYPE;
  v_items_json  JSONB := p_items::JSONB;
  v_item        JSONB;
  v_material    p2_raw_materials%ROWTYPE;
  v_transaction_id UUID;
  v_results     JSONB := '[]'::JSONB;
  v_quantity    NUMERIC;
  v_rate        NUMERIC;
  v_invoice_no  TEXT;
  v_purchase_type TEXT;
BEGIN
  IF jsonb_array_length(v_items_json) = 0 THEN
    RAISE EXCEPTION 'NO_ITEMS: at least one item is required';
  END IF;

  -- Supplier: locked, must be active. Own stock is the only case with no supplier
  -- concept in this schema, but GRN always has a real external supplier -- unlike
  -- confirm_agent_grn_multi, p_supplier_id is never NULL on the agent write path.
  SELECT * INTO v_supplier
  FROM p2_suppliers
  WHERE id = p_supplier_id AND tenant_id = p_tenant_id AND is_active = true
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'SUPPLIER_INACTIVE: supplier is no longer active or does not exist';
  END IF;

  -- Principal pool: if p_owned_by is set, the client must exist, belong to this
  -- tenant, and be flagged as a job-work principal -- mirrors grn.html's own
  -- Material Owner selector, which only ever offers is_job_work_principal=true
  -- clients.
  IF p_owned_by IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM p2_clients
      WHERE id = p_owned_by AND tenant_id = p_tenant_id AND is_job_work_principal = true
    ) THEN
      RAISE EXCEPTION 'PRINCIPAL_INVALID: material owner is not a valid job-work principal for this tenant';
    END IF;
    IF p_principal_challan_no IS NULL OR trim(p_principal_challan_no) = '' OR p_principal_challan_date IS NULL THEN
      RAISE EXCEPTION 'PRINCIPAL_CHALLAN_REQUIRED: principal_challan_no and principal_challan_date are required for a principal delivery';
    END IF;
  END IF;

  -- One GRN number for the whole batch -- the confirm_agent_grn_multi fix, preserved.
  v_grn_no := get_next_grn_number(p_tenant_id);

  FOR v_item IN SELECT * FROM jsonb_array_elements(v_items_json)
  LOOP
    SELECT * INTO v_material
    FROM p2_raw_materials
    WHERE id = (v_item->>'material_id')::UUID
      AND tenant_id = p_tenant_id
      AND is_active = true
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'MATERIAL_INACTIVE: material % is no longer active or does not exist', v_item->>'material_id';
    END IF;

    -- Unit validated against the material's real unit, then discarded --
    -- p2_stock_transactions has no unit column (unit lives only on
    -- p2_raw_materials), same guard confirm_agent_grn_multi already has.
    IF lower(trim(v_item->>'unit')) IS DISTINCT FROM lower(trim(v_material.unit)) THEN
      RAISE EXCEPTION 'UNIT_MISMATCH: % is tracked in %, not %', v_material.name, v_material.unit, v_item->>'unit';
    END IF;

    v_quantity := (v_item->>'quantity')::NUMERIC;
    IF v_quantity IS NULL OR v_quantity <= 0 THEN
      RAISE EXCEPTION 'INVALID_QUANTITY: quantity for % must be greater than 0', v_material.name;
    END IF;

    v_invoice_no := NULLIF(trim(v_item->>'invoice_no'), '');
    IF v_invoice_no IS NULL THEN
      RAISE EXCEPTION 'INVOICE_NO_REQUIRED: invoice number is required for %', v_material.name;
    END IF;

    v_purchase_type := COALESCE(NULLIF(trim(v_item->>'purchase_type'), ''), 'intrastate');
    IF v_purchase_type NOT IN ('intrastate', 'interstate') THEN
      RAISE EXCEPTION 'INVALID_PURCHASE_TYPE: % is not a valid purchase_type', v_purchase_type;
    END IF;

    v_rate := CASE WHEN v_item ? 'rate' AND v_item->>'rate' IS NOT NULL
                   THEN (v_item->>'rate')::NUMERIC ELSE NULL END;

    INSERT INTO p2_stock_transactions (
      tenant_id, raw_material_id, transaction_type, quantity, rate,
      supplier_id, supplier_name, transaction_date, invoice_no, purchase_type,
      grn_no, created_by, owned_by, principal_challan_no, principal_challan_date
    ) VALUES (
      p_tenant_id, v_material.id, 'grn', v_quantity, v_rate,
      p_supplier_id, v_supplier.name, p_grn_date, v_invoice_no, v_purchase_type,
      v_grn_no, p_created_by, p_owned_by, p_principal_challan_no, p_principal_challan_date
    )
    RETURNING id INTO v_transaction_id;

    v_results := v_results || jsonb_build_array(jsonb_build_object(
      'transaction_id', v_transaction_id,
      'material_name', v_material.name,
      'material_code', v_material.material_code,
      'quantity', v_quantity,
      'rate', v_rate,
      'unit', v_material.unit,
      'invoice_no', v_invoice_no,
      'purchase_type', v_purchase_type
    ));
  END LOOP;

  RETURN jsonb_build_object(
    'success', true,
    'grn_no', v_grn_no,
    'supplier_name', v_supplier.name,
    'transaction_date', p_grn_date,
    'items', v_results
  );

EXCEPTION WHEN OTHERS THEN
  RAISE EXCEPTION '%', SQLERRM;
END;
$$;

-- Unlike confirm_agent_grn_multi / confirm_bom_issue / confirm_dispatch_transaction /
-- edit_product_dispatch_qty (all of which do their own internal auth.uid()/role
-- checks because a browser session calls them directly), this function has NO
-- internal authorization check by design -- it is only ever called from
-- agent-query's confirm_proposal handler via the service-role client, after
-- verifyCallerTenant + role/status/expiry checks have already run there. Postgres
-- grants EXECUTE to PUBLIC by default on CREATE FUNCTION; every sibling RPC above
-- was verified to still carry that default (anon + authenticated can call all four
-- directly via PostgREST today) -- tolerable there because of their internal checks,
-- not here. Revoke explicitly so this RPC is unreachable except via service_role.
REVOKE EXECUTE ON FUNCTION public.confirm_agent_grn_v3(uuid, uuid, date, uuid, text, date, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.confirm_agent_grn_v3(uuid, uuid, date, uuid, text, date, uuid, text) TO service_role;
