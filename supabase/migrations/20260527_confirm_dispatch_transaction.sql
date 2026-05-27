-- Migration: Confirm Dispatch Transaction
-- Creates RPC function to handle dispatch confirmation in a transaction

CREATE OR REPLACE FUNCTION confirm_dispatch_transaction(
  p_dispatch_order_id UUID,
  p_tenant_id UUID,
  p_consumption_json TEXT
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_challan_number TEXT;
  v_consumption JSONB;
  v_material JSONB;
  v_current_sequence INTEGER;
BEGIN
  -- Parse consumption JSON
  v_consumption := p_consumption_json::JSONB;

  -- Get next challan number
  SELECT challan_sequence INTO v_current_sequence
  FROM p2_tenant_settings
  WHERE tenant_id = p_tenant_id;

  -- Default to 1 if NULL
  v_current_sequence := COALESCE(v_current_sequence, 0) + 1;

  -- Format: CHAL-YYYYMMDD-NNNN
  v_challan_number := 'CHAL-' || TO_CHAR(NOW(), 'YYYYMMDD') || '-' || LPAD(v_current_sequence::TEXT, 4, '0');

  -- Update challan sequence
  UPDATE p2_tenant_settings
  SET challan_sequence = v_current_sequence
  WHERE tenant_id = p_tenant_id;

  -- Insert negative stock transactions for each material
  FOR v_material IN SELECT * FROM jsonb_array_elements(v_consumption)
  LOOP
    INSERT INTO p2_stock_transactions (
      tenant_id,
      raw_material_id,
      transaction_type,
      quantity,
      reference_id,
      transaction_date,
      created_at
    ) VALUES (
      p_tenant_id,
      (v_material->>'material_id')::UUID,
      'consumption',
      -(v_material->>'qty')::NUMERIC,  -- NEGATIVE value
      p_dispatch_order_id,
      NOW(),
      NOW()
    );
  END LOOP;

  -- Update dispatch order status and challan number
  UPDATE p2_dispatch_orders
  SET
    status = 'confirmed',
    challan_number = v_challan_number,
    confirmed_at = NOW(),
    updated_at = NOW()
  WHERE id = p_dispatch_order_id;

  -- Return challan number
  RETURN json_build_object('challan_number', v_challan_number);

EXCEPTION WHEN OTHERS THEN
  RAISE EXCEPTION 'Transaction failed: %', SQLERRM;
END;
$$;

-- Grant execute to authenticated users (RLS will be enforced by Edge Function using service role)
GRANT EXECUTE ON FUNCTION confirm_dispatch_transaction TO authenticated, service_role;
