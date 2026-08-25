-- Step 2 prerequisite #1: pool-blind fix for confirm_bom_issue.
--
-- confirm_bom_issue's stock sufficiency check currently sums the tenant's
-- full p2_stock_transactions balance with no ownership filter. Once an
-- owned_by column is added to p2_stock_transactions to track
-- principal-supplied free-issue material, that unfiltered check would let
-- this RPC silently consume the wrong owner's stock -- atomically, with a
-- successful response, no error. This fix must be in place before that
-- column goes live.
--
-- IMPORTANT -- deployment order: this file adds "AND (owned_by IS NULL)"
-- to the sufficiency check, so it references a column that does not exist
-- on p2_stock_transactions yet. Do NOT apply this migration until AFTER
-- the migration that adds owned_by to p2_stock_transactions has been run
-- (via the Supabase SQL Editor) -- applying this one first will fail at
-- CREATE FUNCTION time with "column owned_by does not exist". Despite the
-- filename date, real apply order is: (1) add owned_by column, (2) this file.
--
-- The "(own stock)" label on INSUFFICIENT_STOCK is a placeholder: it will
-- be updated to name the actual pool once ownership columns exist and
-- production orders carry a pool reference.

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
  v_order_id      uuid;
  v_consumption   jsonb := COALESCE(NULLIF(p_consumption_json, '')::jsonb, '[]'::jsonb);
  v_manual        jsonb := COALESCE(NULLIF(p_manual_json, '')::jsonb, '[]'::jsonb);
  v_row           jsonb;
  v_note_str      text;
  v_dupe_count    int;
  v_balance       numeric;
  v_mat_required  numeric;
  rec             record;
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

  -- Aggregate required qty per material across all BOM lines, then check each
  -- unique material once — a material split across multiple BOM lines must be
  -- checked against its combined total, not line-by-line against the full balance.
  FOR rec IN
    SELECT
      (elem->>'material_id')::uuid AS mat_id,
      elem->>'material_name'       AS mat_name,
      SUM(ABS((elem->>'qty')::numeric)) AS total_required
    FROM jsonb_array_elements(v_consumption) AS elem
    GROUP BY (elem->>'material_id')::uuid, elem->>'material_name'
  LOOP
    SELECT COALESCE(SUM(quantity), 0)
    INTO v_balance
    FROM (
      SELECT quantity
      FROM p2_stock_transactions
      WHERE tenant_id = p_tenant_id
        AND raw_material_id = rec.mat_id
        AND (owned_by IS NULL)
      FOR UPDATE
    ) locked_rows;

    IF v_balance < rec.total_required THEN
      RAISE EXCEPTION 'INSUFFICIENT_STOCK: % (own stock) — Need %, Available %',
        rec.mat_name, rec.total_required, v_balance;
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
      quantity, reference_id, transaction_date, notes, created_at,
      owned_by
    ) VALUES (
      p_tenant_id,
      (v_row->>'material_id')::uuid,
      'consumption',
      -ABS((v_row->>'qty')::numeric),
      v_order_id,
      p_issue_date,
      v_note_str,
      NOW(),
      NULL  -- consuming own stock; principal-owned pool gets separate path
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
