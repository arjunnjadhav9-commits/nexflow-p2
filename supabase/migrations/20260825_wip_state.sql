-- Step 2G — WIP state. Run in Supabase SQL Editor. Do not use `supabase db push`.
--
-- Pre-flight checks run 2026-08-25, confirmed against the live DB:
--   SELECT proname FROM pg_proc WHERE proname = 'get_my_tenant_id';      -> exists
--   SELECT pronargs FROM pg_proc WHERE proname = 'confirm_bom_issue';    -> 9 AND 10 (two live overloads)
--   set_tenant_id trigger function confirmed via p2_stock_transactions   -> set_tenant_id()

-- 0. Clean up the stale 9-param confirm_bom_issue overload left behind by 2H.
--    CREATE OR REPLACE with an added parameter creates a second overload rather
--    than replacing the first; the old 9-arg (non-pool-aware) version was still
--    live and callable — any 9-arg call silently bypassed pool-awareness with
--    no error. Confirmed live via the pronargs check above.
DROP FUNCTION IF EXISTS confirm_bom_issue(uuid, text, text, numeric, date, text, text, text, boolean);

-- 1. product_id on the dispatch header — bom_issue orders only. Nullable, no
--    backfill, zero effect on existing rows/other dispatch types.
ALTER TABLE p2_dispatch_orders
  ADD COLUMN product_id uuid NULL REFERENCES p2_products(id);

-- 2. WIP ledger — append-only, same idiom as p2_stock_transactions (balance =
--    SUM, never stored directly). No `unit` column, same convention as
--    p2_stock_transactions (unit lives only on the master — here p2_products).
CREATE TABLE p2_wip_transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES p2_tenants(id),
  product_id uuid NOT NULL REFERENCES p2_products(id),
  owned_by uuid NULL REFERENCES p2_clients(id),   -- NULL = own production
  quantity numeric NOT NULL,                      -- + = WIP created, − = WIP closed
  reference_id uuid NULL,                         -- the bom_issue dispatch_order_id (NULL on close rows)
  transaction_date date NOT NULL,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE p2_wip_transactions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "staff_tenant_access" ON p2_wip_transactions
  AS PERMISSIVE FOR ALL TO authenticated
  USING (tenant_id = get_my_tenant_id());

CREATE TRIGGER set_tenant_id_p2_wip_transactions
  BEFORE INSERT ON p2_wip_transactions
  FOR EACH ROW EXECUTE FUNCTION set_tenant_id();

-- 3. Balance view — open WIP only; fully-closed batches drop out of the list.
CREATE VIEW v_p2_wip_balance AS
SELECT tenant_id, product_id, owned_by, SUM(quantity) AS wip_qty
FROM p2_wip_transactions
GROUP BY tenant_id, product_id, owned_by
HAVING SUM(quantity) <> 0;

-- 4. confirm_bom_issue v4 — adds optional p_product_id (DEFAULT NULL, same
--    optionality pattern as p_owned_by). Omitting it reproduces exactly
--    today's v3/2H behavior: no WIP row, product_id left NULL on the header.
--    Body is otherwise byte-identical to the live 10-param version, plus the
--    two additions marked NEW below.
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
  p_owned_by uuid DEFAULT NULL,
  p_product_id uuid DEFAULT NULL          -- NEW
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
  v_pool_label    text;
  rec             record;
BEGIN
  v_note_str := 'Production Issue: ' || COALESCE(p_product_name, '') || ' × ' || COALESCE(p_batch_qty::text, '')
                || CASE WHEN p_notes IS NOT NULL AND p_notes <> '' THEN ' – ' || p_notes ELSE '' END;

  IF p_owned_by IS NULL THEN
    v_pool_label := '(own stock)';
  ELSE
    SELECT '(' || name || ')' INTO v_pool_label
    FROM p2_clients
    WHERE id = p_owned_by AND tenant_id = p_tenant_id;
    IF v_pool_label IS NULL THEN v_pool_label := '(unknown pool)'; END IF;
  END IF;

  IF NOT p_force THEN
    SELECT COUNT(*) INTO v_dupe_count
    FROM p2_dispatch_orders
    WHERE tenant_id = p_tenant_id AND dispatch_type = 'bom_issue' AND dispatch_date = p_issue_date
      AND status != 'cancelled'
      AND challan_note LIKE ('Production Issue: ' || COALESCE(p_product_name, '') || ' × ' || COALESCE(p_batch_qty::text, '') || '%');
    IF v_dupe_count > 0 THEN
      RAISE EXCEPTION 'DUPLICATE_ISSUE: % × % already issued on % — call again with p_force := true to override', p_product_name, p_batch_qty, p_issue_date;
    END IF;
  END IF;

  FOR rec IN
    SELECT (elem->>'material_id')::uuid AS mat_id, elem->>'material_name' AS mat_name,
           SUM(ABS((elem->>'qty')::numeric)) AS total_required
    FROM jsonb_array_elements(v_consumption) AS elem
    GROUP BY (elem->>'material_id')::uuid, elem->>'material_name'
  LOOP
    SELECT COALESCE(SUM(quantity), 0) INTO v_balance
    FROM (
      SELECT quantity FROM p2_stock_transactions
      WHERE tenant_id = p_tenant_id AND raw_material_id = rec.mat_id
        AND (owned_by IS NOT DISTINCT FROM p_owned_by)
      FOR UPDATE
    ) locked_rows;
    IF v_balance < rec.total_required THEN
      RAISE EXCEPTION 'INSUFFICIENT_STOCK: % % — Need %, Available %', rec.mat_name, v_pool_label, rec.total_required, v_balance;
    END IF;
  END LOOP;

  INSERT INTO p2_dispatch_orders (
    tenant_id, dispatch_type, status, challan_number, dispatch_date, created_by, confirmed_at, challan_note, owned_by, product_id
  ) VALUES (
    p_tenant_id, 'bom_issue', 'confirmed', p_challan_number, p_issue_date, p_tenant_id, NOW(), v_note_str, p_owned_by, p_product_id  -- product_id NEW
  )
  RETURNING id INTO v_order_id;

  FOR v_row IN SELECT * FROM jsonb_array_elements(v_consumption)
  LOOP
    INSERT INTO p2_stock_transactions (
      tenant_id, raw_material_id, transaction_type, quantity, reference_id, transaction_date, notes, created_at, owned_by
    ) VALUES (
      p_tenant_id, (v_row->>'material_id')::uuid, 'consumption',
      -ABS((v_row->>'qty')::numeric), v_order_id, p_issue_date, v_note_str, NOW(), p_owned_by
    );

    INSERT INTO p2_dispatch_items (
      tenant_id, dispatch_order_id, product_id, raw_material_id, material_name, material_code, qty_dispatched, unit
    ) VALUES (
      p_tenant_id, v_order_id, NULL,
      (v_row->>'material_id')::uuid, v_row->>'material_name', NULLIF(v_row->>'material_code', ''),
      (v_row->>'qty')::numeric, v_row->>'unit'
    );
  END LOOP;

  FOR v_row IN SELECT * FROM jsonb_array_elements(v_manual)
  LOOP
    INSERT INTO p2_dispatch_items (
      tenant_id, dispatch_order_id, product_id, raw_material_id, material_name, material_code, qty_dispatched, unit
    ) VALUES (
      p_tenant_id, v_order_id, NULL, NULL, v_row->>'name', NULL, (v_row->>'qty')::numeric, v_row->>'unit'
    );
  END LOOP;

  -- NEW: WIP row, only when the caller identifies the product being produced.
  IF p_product_id IS NOT NULL THEN
    INSERT INTO p2_wip_transactions (
      tenant_id, product_id, owned_by, quantity, reference_id, transaction_date, notes
    ) VALUES (
      p_tenant_id, p_product_id, p_owned_by, p_batch_qty, v_order_id, p_issue_date, v_note_str
    );
  END IF;

  RETURN json_build_object('order_id', v_order_id, 'challan_number', p_challan_number);
EXCEPTION WHEN OTHERS THEN
  RAISE EXCEPTION 'Issue failed: %', SQLERRM;
END;
$$;

-- 5. close_wip — the only way a WIP balance decreases in this step. Row-locks
--    the same way confirm_bom_issue locks stock; same INSUFFICIENT_STOCK-style
--    naming for the error. Plain SECURITY INVOKER, relying on RLS —
--    confirm_bom_issue itself has no SECURITY DEFINER, so this introduces no
--    new security pattern.
CREATE OR REPLACE FUNCTION close_wip(
  p_tenant_id uuid,
  p_product_id uuid,
  p_qty numeric,
  p_close_date date,
  p_owned_by uuid DEFAULT NULL,
  p_notes text DEFAULT NULL
)
RETURNS json
LANGUAGE plpgsql
AS $$
DECLARE
  v_balance numeric;
BEGIN
  SELECT COALESCE(SUM(quantity), 0) INTO v_balance
  FROM (
    SELECT quantity FROM p2_wip_transactions
    WHERE tenant_id = p_tenant_id AND product_id = p_product_id
      AND (owned_by IS NOT DISTINCT FROM p_owned_by)
    FOR UPDATE
  ) locked_rows;

  IF p_qty > v_balance THEN
    RAISE EXCEPTION 'WIP_EXCEEDS_BALANCE: Have %, Requested %', v_balance, p_qty;
  END IF;

  INSERT INTO p2_wip_transactions (
    tenant_id, product_id, owned_by, quantity, reference_id, transaction_date, notes
  ) VALUES (
    p_tenant_id, p_product_id, p_owned_by, -p_qty, NULL, p_close_date, p_notes
  );

  RETURN json_build_object('product_id', p_product_id, 'closed_qty', p_qty, 'remaining_wip', v_balance - p_qty);
EXCEPTION WHEN OTHERS THEN
  RAISE EXCEPTION 'Close failed: %', SQLERRM;
END;
$$;
