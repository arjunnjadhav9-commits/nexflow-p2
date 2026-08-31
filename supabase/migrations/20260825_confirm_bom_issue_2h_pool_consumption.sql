-- Step 2H: pool-aware consumption for confirm_bom_issue.
--
-- 2A shipped the prerequisite only: the sufficiency check filtered
-- AND (owned_by IS NULL), and the consumption insert wrote owned_by = NULL
-- unconditionally — deliberately hardcoded to "own stock only" until
-- production orders could carry a real pool. 2H makes both sides parametric
-- on which pool (own stock vs a specific job-work principal) this BOM issue
-- draws from.
--
-- p_owned_by NULL means own stock (today's behavior — byte-identical for
-- any tenant that never passes a non-NULL value, i.e. the Type A
-- guarantee). A non-NULL p_owned_by must be a p2_clients.id where that
-- client has is_job_work_principal = true for this tenant; the caller
-- (production-issue.html / agent-query) is responsible for only ever
-- passing a validated id — this function additionally scopes its own
-- p2_clients lookup to p_tenant_id so a cross-tenant id can never leak a
-- name into the error message.
--
-- IS NOT DISTINCT FROM (not =) so a single expression covers both the
-- own-stock case (p_owned_by IS NULL) and the principal-pool case
-- (p_owned_by = some uuid) without branching.
--
-- Also sets owned_by on the p2_dispatch_orders header row (not just the
-- consumption rows) — the column exists for exactly this (Step 2B/2I) and
-- Step 2G (WIP state) needs a real pool signal on the dispatch itself to
-- attribute WIP to.

CREATE OR REPLACE FUNCTION confirm_bom_issue(
  p_tenant_id uuid,
  p_challan_number text,
  p_product_name text,
  p_batch_qty numeric,
  p_issue_date date,
  p_notes text,
  p_consumption_json text,
  p_manual_json text,
  p_force boolean DEFAULT false,
  p_owned_by uuid DEFAULT NULL
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
  v_pool_label    text;
  rec             record;
BEGIN
  v_note_str := 'Production Issue: ' || COALESCE(p_product_name, '') || ' × ' || COALESCE(p_batch_qty::text, '')
                || CASE WHEN p_notes IS NOT NULL AND p_notes <> '' THEN ' – ' || p_notes ELSE '' END;

  -- Resolve the pool's display name once, up front, for the
  -- INSUFFICIENT_STOCK message below.
  IF p_owned_by IS NULL THEN
    v_pool_label := '(own stock)';
  ELSE
    SELECT '(' || name || ')' INTO v_pool_label
    FROM p2_clients
    WHERE id = p_owned_by AND tenant_id = p_tenant_id;

    IF v_pool_label IS NULL THEN
      v_pool_label := '(unknown pool)';
    END IF;
  END IF;

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

  -- Aggregate required qty per material across all BOM lines, then check
  -- each unique material once against ITS POOL'S balance only.
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
        AND (owned_by IS NOT DISTINCT FROM p_owned_by)
      FOR UPDATE
    ) locked_rows;

    IF v_balance < rec.total_required THEN
      RAISE EXCEPTION 'INSUFFICIENT_STOCK: % % — Need %, Available %',
        rec.mat_name, v_pool_label, rec.total_required, v_balance;
    END IF;
  END LOOP;

  INSERT INTO p2_dispatch_orders (
    tenant_id, dispatch_type, status, challan_number,
    dispatch_date, created_by, confirmed_at, challan_note,
    owned_by
  ) VALUES (
    p_tenant_id, 'bom_issue', 'confirmed', p_challan_number,
    p_issue_date, p_tenant_id, NOW(), v_note_str,
    p_owned_by
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
      p_owned_by
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
