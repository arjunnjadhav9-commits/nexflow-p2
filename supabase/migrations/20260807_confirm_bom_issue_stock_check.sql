-- Add server-side stock check to confirm_bom_issue: blocks the issue (raises
-- INSUFFICIENT_STOCK) instead of silently letting a BOM issue drive a material
-- balance negative. Row-locks each material's transaction rows (via a FOR UPDATE
-- subquery — aggregates cannot be combined directly with FOR UPDATE in Postgres)
-- before summing, so two concurrent issues against the same tight-stock material
-- can't both pass the check and overdraw it.

CREATE OR REPLACE FUNCTION confirm_bom_issue(
  p_tenant_id uuid,
  p_challan_number text,
  p_product_name text,
  p_batch_qty numeric,
  p_issue_date date,
  p_notes text,
  p_consumption_json text,
  p_manual_json text,
  p_force boolean DEFAULT false
)
RETURNS json
LANGUAGE plpgsql
AS $$
DECLARE
  v_order_id    uuid;
  v_consumption jsonb := COALESCE(NULLIF(p_consumption_json, '')::jsonb, '[]'::jsonb);
  v_manual      jsonb := COALESCE(NULLIF(p_manual_json, '')::jsonb, '[]'::jsonb);
  v_row         jsonb;
  v_note_str    text;
  v_dupe_count  int;
  v_balance     numeric;
  v_required    numeric;
  v_mat_name    text;
BEGIN
  v_note_str := 'Production Issue: ' || COALESCE(p_product_name, '') || ' × ' || COALESCE(p_batch_qty::text, '')
                || CASE WHEN p_notes IS NOT NULL AND p_notes <> '' THEN ' – ' || p_notes ELSE '' END;

  IF NOT p_force THEN
    SELECT COUNT(*) INTO v_dupe_count
    FROM p2_dispatch_orders
    WHERE tenant_id = p_tenant_id
      AND dispatch_type = 'bom_issue'
      AND dispatch_date = p_issue_date
      AND status != 'cancelled'
      AND challan_note LIKE ('Production Issue: ' || COALESCE(p_product_name, '') || ' × ' || COALESCE(p_batch_qty::text, '') || '%');

    IF v_dupe_count > 0 THEN
      RAISE EXCEPTION 'DUPLICATE_ISSUE: % × % already issued on % — call again with p_force := true to override', p_product_name, p_batch_qty, p_issue_date;
    END IF;
  END IF;

  -- Stock check loop — locks each material's transaction rows for update before
  -- summing, so a concurrent issue against the same material can't slip past.
  FOR v_row IN SELECT * FROM jsonb_array_elements(v_consumption)
  LOOP
    v_required := ABS((v_row->>'qty')::numeric);
    v_mat_name := v_row->>'material_name';

    SELECT COALESCE(SUM(quantity), 0)
    INTO v_balance
    FROM (
      SELECT quantity
      FROM p2_stock_transactions
      WHERE tenant_id = p_tenant_id
        AND raw_material_id = (v_row->>'material_id')::uuid
      FOR UPDATE
    ) locked_rows;

    IF v_balance < v_required THEN
      RAISE EXCEPTION 'INSUFFICIENT_STOCK: % — Need %, Available %',
        v_mat_name, v_required, v_balance;
    END IF;
  END LOOP;

  INSERT INTO p2_dispatch_orders (
    tenant_id, dispatch_type, status, challan_number,
    dispatch_date, created_by, confirmed_at, challan_note
  ) VALUES (
    p_tenant_id, 'bom_issue', 'confirmed', p_challan_number,
    p_issue_date, p_tenant_id, NOW(), v_note_str
  )
  RETURNING id INTO v_order_id;

  FOR v_row IN SELECT * FROM jsonb_array_elements(v_consumption)
  LOOP
    INSERT INTO p2_stock_transactions (
      tenant_id, raw_material_id, transaction_type,
      quantity, reference_id, transaction_date, notes, created_at
    ) VALUES (
      p_tenant_id,
      (v_row->>'material_id')::uuid,
      'consumption',
      -ABS((v_row->>'qty')::numeric),
      v_order_id,
      p_issue_date,
      v_note_str,
      NOW()
    );

    INSERT INTO p2_dispatch_items (
      tenant_id, dispatch_order_id, product_id, raw_material_id,
      material_name, material_code, qty_dispatched, unit
    ) VALUES (
      p_tenant_id, v_order_id, NULL,
      (v_row->>'material_id')::uuid,
      v_row->>'material_name',
      NULLIF(v_row->>'material_code', ''),
      (v_row->>'qty')::numeric,
      v_row->>'unit'
    );
  END LOOP;

  FOR v_row IN SELECT * FROM jsonb_array_elements(v_manual)
  LOOP
    INSERT INTO p2_dispatch_items (
      tenant_id, dispatch_order_id, product_id, raw_material_id,
      material_name, material_code, qty_dispatched, unit
    ) VALUES (
      p_tenant_id, v_order_id, NULL, NULL,
      v_row->>'name',
      NULL,
      (v_row->>'qty')::numeric,
      v_row->>'unit'
    );
  END LOOP;

  RETURN json_build_object('order_id', v_order_id, 'challan_number', p_challan_number);
EXCEPTION WHEN OTHERS THEN
  RAISE EXCEPTION 'Issue failed: %', SQLERRM;
END;
$$;
