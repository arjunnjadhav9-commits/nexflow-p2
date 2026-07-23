-- Migration: Confirm Agent GRN
-- Creates RPC function to atomically re-validate and record a GRN created
-- via the AI Copilot (agent-query create_grn intent). Re-fetches + locks
-- every matched row at confirm-time — state may have changed since Haiku's
-- match was resolved earlier in the chat.
--
-- p2_stock_transactions has NO unit column — unit only lives on
-- p2_raw_materials. p_unit is validated against the material's real unit
-- and then discarded, never stored on the transaction row.
--
-- get_next_grn_number(p_tenant_id uuid) already exists in the DB (returns
-- text) — not redefined here, only called.

CREATE OR REPLACE FUNCTION confirm_agent_grn(
  p_tenant_id UUID,
  p_material_id UUID,
  p_supplier_id UUID,
  p_quantity NUMERIC,
  p_unit TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_material p2_raw_materials%ROWTYPE;
  v_supplier p2_suppliers%ROWTYPE;
  v_supplier_id UUID;
  v_supplier_name TEXT;
  v_grn_no TEXT;
  v_transaction_id UUID;
BEGIN
  IF p_quantity IS NULL OR p_quantity <= 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'Invalid quantity.');
  END IF;

  -- Re-fetch and lock the material — state may have changed since Haiku's
  -- match was resolved (renamed, deactivated) between parse and confirm.
  SELECT * INTO v_material
  FROM p2_raw_materials
  WHERE id = p_material_id
    AND tenant_id = p_tenant_id
    AND is_active = true
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'This material is no longer active — please start over.');
  END IF;

  IF lower(trim(p_unit)) IS DISTINCT FROM lower(trim(v_material.unit)) THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', format('Unit mismatch: this material is tracked in %s, not %s. Please start over.', v_material.unit, p_unit)
    );
  END IF;

  v_supplier_id := NULL;
  v_supplier_name := NULL;

  IF p_supplier_id IS NOT NULL THEN
    SELECT * INTO v_supplier
    FROM p2_suppliers
    WHERE id = p_supplier_id
      AND tenant_id = p_tenant_id
      AND is_active = true
    FOR UPDATE;

    IF NOT FOUND THEN
      RETURN jsonb_build_object('success', false, 'error', 'This supplier is no longer active — please start over.');
    END IF;

    v_supplier_id := v_supplier.id;
    v_supplier_name := v_supplier.name;
  END IF;

  v_grn_no := get_next_grn_number(p_tenant_id);

  INSERT INTO p2_stock_transactions (
    tenant_id,
    raw_material_id,
    transaction_type,
    quantity,
    supplier_id,
    supplier_name,
    grn_no,
    notes,
    transaction_date
  ) VALUES (
    p_tenant_id,
    v_material.id,
    'grn',
    p_quantity,
    v_supplier_id,
    v_supplier_name,
    v_grn_no,
    'Created via AI Copilot',
    CURRENT_DATE
  )
  RETURNING id INTO v_transaction_id;

  RETURN jsonb_build_object(
    'success', true,
    'transaction_id', v_transaction_id,
    'grn_no', v_grn_no,
    'material_name', v_material.name,
    'quantity', p_quantity,
    'unit', v_material.unit
  );
END;
$$;

-- Grant execute to service_role — agent-query invokes this using SB_SECRET_KEY.
GRANT EXECUTE ON FUNCTION confirm_agent_grn TO service_role;
