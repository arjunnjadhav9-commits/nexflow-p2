-- Challan line-item editing: add/remove individual lines on an already-confirmed
-- challan without deleting and recreating the whole document (Known Open Item #8).
--
-- Two SECURITY DEFINER RPCs, following the exact conventions established in
-- 20260825_hard_delete_dispatch.sql: JWT-based tenant check (auth.jwt() user_metadata,
-- falling back to auth.uid() for the owner), get_my_role() role check, FOR UPDATE row
-- lock on the parent dispatch order, RAISE EXCEPTION 'CODE: message' convention for
-- client-side error matching, outer EXCEPTION WHEN OTHERS wrapper, GRANT EXECUTE TO
-- authenticated. Applied manually via Supabase SQL Editor -- never `supabase db push`
-- (replays old migrations).
--
-- Both are owner/supervisor only (storekeeper/operator/accountant blocked). Both are
-- blocked once status != 'confirmed' or an invoice (single or consolidated) already
-- references the dispatch order -- checked server-side, never trusting the caller.
--
-- add_challan_line: fail-closed stock check (same locked-aggregate pattern as
-- confirm_dispatch_transaction, see 20260901_fix_insufficient_stock_message.sql) runs
-- BEFORE any insert, so a rejected add never creates a p2_dispatch_items row or a
-- stock_transactions row -- no burned line slot on failure.
--
-- remove_challan_line: p2_stock_transactions is an append-only ledger (see CLAUDE.md)
-- -- the original consumption row from confirm_dispatch_transaction/add_challan_line is
-- NEVER deleted, only offset by a new positive reversal row referencing the same
-- dispatch_order_id. The p2_dispatch_items row itself IS deleted (it's the display
-- row, not the ledger) so the line disappears from the challan. Only raw-material-
-- linked lines can be removed -- a 'product' dispatch_type line has no 1:1
-- p2_stock_transactions row to reverse (its stock impact was BOM-derived across the
-- whole order at confirm time, not per line item), so removal is blocked rather than
-- silently skipping the reversal and losing the audit trail.

CREATE OR REPLACE FUNCTION public.add_challan_line(
  p_dispatch_order_id uuid,
  p_tenant_id          uuid,
  p_raw_material_id    uuid,
  p_qty                numeric,
  p_unit               text,
  p_notes              text DEFAULT NULL
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_caller_tenant text;
  v_is_owner      boolean;
  v_role          text;
  v_order         record;
  v_material      record;
  v_balance       numeric;
  v_item_id       uuid;
BEGIN
  IF p_qty IS NULL OR p_qty <= 0 THEN
    RAISE EXCEPTION 'INVALID_QTY: quantity must be greater than zero';
  END IF;
  IF p_unit IS NULL OR btrim(p_unit) = '' THEN
    RAISE EXCEPTION 'INVALID_UNIT: unit is required';
  END IF;

  IF auth.uid() IS NOT NULL THEN
    v_caller_tenant := COALESCE(auth.jwt() -> 'user_metadata' ->> 'tenant_id', auth.uid()::text);
    IF v_caller_tenant IS DISTINCT FROM p_tenant_id::text THEN
      RAISE EXCEPTION 'Unauthorized';
    END IF;

    v_is_owner := (auth.uid() = p_tenant_id);
    v_role     := get_my_role(p_tenant_id);
    IF NOT (v_is_owner OR v_role = 'supervisor') THEN
      RAISE EXCEPTION 'ROLE_DENIED: only owner or supervisor can edit challan lines';
    END IF;
  END IF;

  SELECT * INTO v_order
  FROM p2_dispatch_orders
  WHERE id = p_dispatch_order_id AND tenant_id = p_tenant_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'NOT_FOUND: dispatch order does not exist for this tenant';
  END IF;

  IF v_order.status != 'confirmed' THEN
    RAISE EXCEPTION 'INVALID_STATUS: only a confirmed challan can have lines added';
  END IF;

  IF EXISTS (
    SELECT 1 FROM p2_invoices
    WHERE tenant_id = p_tenant_id
      AND invoice_mode = 'single'
      AND dispatch_order_id = p_dispatch_order_id
  ) THEN
    RAISE EXCEPTION 'INVOICE_LINKED: this challan is invoiced and cannot be edited';
  END IF;

  IF EXISTS (
    SELECT 1 FROM p2_invoices
    WHERE tenant_id = p_tenant_id
      AND dispatch_order_ids @> ARRAY[p_dispatch_order_id]::uuid[]
  ) THEN
    RAISE EXCEPTION 'INVOICE_LINKED: this challan is invoiced and cannot be edited';
  END IF;

  SELECT id, name, material_code, unit AS default_unit INTO v_material
  FROM p2_raw_materials
  WHERE id = p_raw_material_id AND tenant_id = p_tenant_id AND is_active = true;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'MATERIAL_NOT_FOUND: selected material is not active for this tenant';
  END IF;

  -- Locked, aggregated stock-sufficiency check -- same pattern as
  -- confirm_dispatch_transaction (20260901_fix_insufficient_stock_message.sql).
  -- Scoped to the dispatch's own pool via IS NOT DISTINCT FROM, so a job-worker's
  -- principal-owned pool is checked correctly, not own-stock by mistake.
  SELECT COALESCE(SUM(quantity), 0)
  INTO v_balance
  FROM (
    SELECT quantity
    FROM p2_stock_transactions
    WHERE tenant_id = p_tenant_id
      AND raw_material_id = p_raw_material_id
      AND (owned_by IS NOT DISTINCT FROM v_order.owned_by)
    FOR UPDATE
  ) locked_rows;

  IF v_balance < p_qty THEN
    RAISE EXCEPTION 'INSUFFICIENT_STOCK: % — Need %, Available %',
      v_material.name, p_qty, v_balance;
  END IF;

  INSERT INTO p2_dispatch_items (
    tenant_id, dispatch_order_id, material_name, material_code,
    qty_dispatched, unit, raw_material_id, product_id, notes, created_at
  ) VALUES (
    p_tenant_id, p_dispatch_order_id, v_material.name, v_material.material_code,
    p_qty, btrim(p_unit), p_raw_material_id, NULL, p_notes, NOW()
  )
  RETURNING id INTO v_item_id;

  INSERT INTO p2_stock_transactions (
    tenant_id, raw_material_id, transaction_type, quantity,
    reference_id, notes, transaction_date, created_at, owned_by
  ) VALUES (
    p_tenant_id, p_raw_material_id, 'consumption', -p_qty,
    p_dispatch_order_id,
    'Dispatch: Challan ' || COALESCE(v_order.challan_number, '') || ' (line added)',
    NOW(), NOW(), v_order.owned_by
  );

  RETURN json_build_object(
    'item_id', v_item_id,
    'challan_number', v_order.challan_number
  );
EXCEPTION WHEN OTHERS THEN
  RAISE EXCEPTION 'Add line failed: %', SQLERRM;
END;
$$;

GRANT EXECUTE ON FUNCTION public.add_challan_line(uuid, uuid, uuid, numeric, text, text) TO authenticated;


CREATE OR REPLACE FUNCTION public.remove_challan_line(
  p_dispatch_item_id uuid,
  p_tenant_id         uuid
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_caller_tenant text;
  v_is_owner      boolean;
  v_role          text;
  v_item          record;
  v_order         record;
BEGIN
  IF auth.uid() IS NOT NULL THEN
    v_caller_tenant := COALESCE(auth.jwt() -> 'user_metadata' ->> 'tenant_id', auth.uid()::text);
    IF v_caller_tenant IS DISTINCT FROM p_tenant_id::text THEN
      RAISE EXCEPTION 'Unauthorized';
    END IF;

    v_is_owner := (auth.uid() = p_tenant_id);
    v_role     := get_my_role(p_tenant_id);
    IF NOT (v_is_owner OR v_role = 'supervisor') THEN
      RAISE EXCEPTION 'ROLE_DENIED: only owner or supervisor can edit challan lines';
    END IF;
  END IF;

  SELECT * INTO v_item
  FROM p2_dispatch_items
  WHERE id = p_dispatch_item_id AND tenant_id = p_tenant_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'NOT_FOUND: challan line does not exist for this tenant';
  END IF;

  SELECT * INTO v_order
  FROM p2_dispatch_orders
  WHERE id = v_item.dispatch_order_id AND tenant_id = p_tenant_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'NOT_FOUND: parent dispatch order does not exist for this tenant';
  END IF;

  IF v_order.status != 'confirmed' THEN
    RAISE EXCEPTION 'INVALID_STATUS: only a confirmed challan can have lines removed';
  END IF;

  IF EXISTS (
    SELECT 1 FROM p2_invoices
    WHERE tenant_id = p_tenant_id
      AND invoice_mode = 'single'
      AND dispatch_order_id = v_order.id
  ) THEN
    RAISE EXCEPTION 'INVOICE_LINKED: this challan is invoiced and cannot be edited';
  END IF;

  IF EXISTS (
    SELECT 1 FROM p2_invoices
    WHERE tenant_id = p_tenant_id
      AND dispatch_order_ids @> ARRAY[v_order.id]::uuid[]
  ) THEN
    RAISE EXCEPTION 'INVOICE_LINKED: this challan is invoiced and cannot be edited';
  END IF;

  -- See migration header -- a line with no raw_material_id (a 'product' dispatch_type
  -- item) has no 1:1 stock_transactions row to reverse. Block rather than delete the
  -- line with its stock impact silently unreversed.
  IF v_item.raw_material_id IS NULL THEN
    RAISE EXCEPTION 'NOT_REMOVABLE: this line has no linked raw material and cannot be removed here';
  END IF;

  INSERT INTO p2_stock_transactions (
    tenant_id, raw_material_id, transaction_type, quantity,
    reference_id, notes, transaction_date, created_at, owned_by
  ) VALUES (
    p_tenant_id, v_item.raw_material_id, 'consumption', v_item.qty_dispatched,
    v_order.id, 'Line reversal', NOW(), NOW(), v_order.owned_by
  );

  DELETE FROM p2_dispatch_items
  WHERE id = p_dispatch_item_id AND tenant_id = p_tenant_id;

  RETURN json_build_object('removed', true, 'challan_number', v_order.challan_number);
EXCEPTION WHEN OTHERS THEN
  RAISE EXCEPTION 'Remove line failed: %', SQLERRM;
END;
$$;

GRANT EXECUTE ON FUNCTION public.remove_challan_line(uuid, uuid) TO authenticated;
