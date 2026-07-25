-- Migration: Confirm Agent GRN (multi-material, single shared GRN number)
-- Creates RPC function to atomically re-validate and record a multi-material
-- GRN created via the AI Copilot (agent-query create_grn intent, >1 item).
-- Mirrors confirm_agent_grn (20260721_confirm_agent_grn.sql) but calls
-- get_next_grn_number() ONCE for the whole batch instead of once per item —
-- that's the actual fix this migration exists for.
--
-- p2_stock_transactions has NO unit column — unit only lives on
-- p2_raw_materials. Each item's unit is validated against the material's
-- real unit and then discarded, never stored on the transaction row (same
-- guard confirm_agent_grn already has).
--
-- get_next_grn_number(p_tenant_id uuid) already exists in the DB (returns
-- text) — not redefined here, only called.
--
-- p_items is TEXT, not jsonb, matching confirm_dispatch_transaction's
-- p_consumption_json convention: agent-query's Deno client sends
-- JSON.stringify(rpcItems) as the param value, so a jsonb-typed param would
-- receive a double-encoded scalar JSON string (jsonb_array_elements then
-- fails with "cannot extract elements from a scalar") instead of an array.

DROP FUNCTION IF EXISTS public.confirm_agent_grn_multi(uuid, uuid, jsonb);

CREATE OR REPLACE FUNCTION public.confirm_agent_grn_multi(
  p_tenant_id uuid,
  p_supplier_id uuid,
  p_items TEXT
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_grn_no TEXT;
  v_supplier p2_suppliers%ROWTYPE;
  v_supplier_name TEXT;
  v_items_json JSONB := p_items::JSONB;
  v_item JSONB;
  v_material p2_raw_materials%ROWTYPE;
  v_transaction_id UUID;
  v_results JSONB := '[]'::JSONB;
BEGIN
  -- Validate supplier if provided
  v_supplier_name := NULL;
  IF p_supplier_id IS NOT NULL THEN
    SELECT * INTO v_supplier
    FROM p2_suppliers
    WHERE id = p_supplier_id AND tenant_id = p_tenant_id AND is_active = true
    FOR UPDATE;
    IF NOT FOUND THEN
      RETURN jsonb_build_object('success', false, 'error', 'Supplier is no longer active.');
    END IF;
    v_supplier_name := v_supplier.name;
  END IF;

  -- Generate ONE GRN number for all items
  v_grn_no := get_next_grn_number(p_tenant_id);

  -- Insert one transaction per item
  FOR v_item IN SELECT * FROM jsonb_array_elements(v_items_json)
  LOOP
    SELECT * INTO v_material
    FROM p2_raw_materials
    WHERE id = (v_item->>'material_id')::UUID
      AND tenant_id = p_tenant_id
      AND is_active = true
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Material % is no longer active.', v_item->>'material_id';
    END IF;

    IF lower(trim(v_item->>'unit')) IS DISTINCT FROM lower(trim(v_material.unit)) THEN
      RAISE EXCEPTION 'Unit mismatch for %: tracked in %, not %.', v_material.name, v_material.unit, v_item->>'unit';
    END IF;

    INSERT INTO p2_stock_transactions (
      tenant_id, raw_material_id, transaction_type,
      quantity, supplier_id, supplier_name,
      grn_no, notes, transaction_date
    ) VALUES (
      p_tenant_id,
      v_material.id,
      'grn',
      (v_item->>'quantity')::NUMERIC,
      p_supplier_id,
      v_supplier_name,
      v_grn_no,
      'Created via AI Copilot',
      CURRENT_DATE
    )
    RETURNING id INTO v_transaction_id;

    v_results := v_results || jsonb_build_array(jsonb_build_object(
      'transaction_id', v_transaction_id,
      'material_name', v_material.name,
      'material_code', v_material.material_code,
      'quantity', (v_item->>'quantity')::NUMERIC,
      'unit', v_material.unit
    ));
  END LOOP;

  RETURN jsonb_build_object(
    'success', true,
    'grn_no', v_grn_no,
    'items', v_results
  );

EXCEPTION WHEN OTHERS THEN
  RAISE EXCEPTION 'GRN failed: %', SQLERRM;
END;
$$;

-- Grant execute to service_role — agent-query invokes this using SB_SECRET_KEY.
GRANT EXECUTE ON FUNCTION confirm_agent_grn_multi TO service_role;
