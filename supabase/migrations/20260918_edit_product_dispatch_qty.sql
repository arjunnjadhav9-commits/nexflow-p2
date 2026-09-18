-- Quantity edit on a single line of a confirmed 'product' dispatch, replacing the
-- Session 18 add/remove-line approach (dropped in
-- 20260918_drop_challan_line_editing.sql). Follows the exact conventions established
-- in 20260825_hard_delete_dispatch.sql: JWT-based tenant check, get_my_role() role
-- check, FOR UPDATE row lock on the parent dispatch order, RAISE EXCEPTION 'CODE:
-- message' convention for client-side error matching, outer EXCEPTION WHEN OTHERS
-- wrapper, GRANT EXECUTE TO authenticated. Applied manually via Supabase SQL Editor
-- -- never `supabase db push` (replays old migrations).
--
-- Scope: 'product' dispatch_type only. 'raw_material' and 'bom_issue' dispatches are
-- untouched by this RPC (WRONG_TYPE). Owner/supervisor only, confirmed challans only,
-- blocked once an invoice (single or consolidated, excluding cancelled invoices --
-- see invoices.html's fetchInvoicedOrderIdSet()) references the dispatch order.
--
-- Deliberately does NOT write p2_wip_transactions. WIP is exclusively a
-- bom_issue/production-issue.html concept (confirm_bom_issue / close_wip).
-- confirm_dispatch_transaction -- the RPC that actually confirms 'product' dispatches
-- -- never writes WIP either, so there is no WIP debit here to adjust; inserting one
-- would create a phantom ledger entry with no corresponding close path.
--
-- Stock adjustment mirrors confirm_dispatch_transaction's BOM-expansion pattern: the
-- qty delta is expanded through p2_product_bom, and p2_stock_transactions gets a
-- negative consumption row per BOM line on an increase (after a locked-aggregate
-- sufficiency check across ALL lines, so a rejected increase never inserts anything),
-- or a positive restoring row per BOM line on a decrease (no check needed -- this is
-- returning stock, not consuming it). p2_stock_transactions is an append-only ledger
-- (see CLAUDE.md) -- the original consumption rows from confirm_dispatch_transaction
-- are never touched, only offset.

CREATE OR REPLACE FUNCTION public.edit_product_dispatch_qty(
  p_dispatch_order_id uuid,
  p_tenant_id         uuid,
  p_dispatch_item_id  uuid,
  p_new_qty           numeric
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
  v_item          record;
  v_delta         numeric;
  v_bom_count     int;
  v_balance       numeric;
  v_material_name text;
  rec             record;
BEGIN
  IF auth.uid() IS NOT NULL THEN
    v_caller_tenant := COALESCE(auth.jwt() -> 'user_metadata' ->> 'tenant_id', auth.uid()::text);
    IF v_caller_tenant IS DISTINCT FROM p_tenant_id::text THEN
      RAISE EXCEPTION 'Unauthorized';
    END IF;

    v_is_owner := (auth.uid() = p_tenant_id);
    v_role     := get_my_role(p_tenant_id);
    IF NOT (v_is_owner OR v_role = 'supervisor') THEN
      RAISE EXCEPTION 'ROLE_DENIED: only owner or supervisor can edit dispatch quantities';
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
    RAISE EXCEPTION 'INVALID_STATUS: only a confirmed challan can have its quantity edited';
  END IF;

  IF v_order.dispatch_type != 'product' THEN
    RAISE EXCEPTION 'WRONG_TYPE: this RPC is for product dispatches only';
  END IF;

  IF EXISTS (
    SELECT 1 FROM p2_invoices
    WHERE tenant_id = p_tenant_id
      AND invoice_mode = 'single'
      AND dispatch_order_id = p_dispatch_order_id
      AND status != 'cancelled'
  ) THEN
    RAISE EXCEPTION 'INVOICE_LINKED: this challan is invoiced and cannot be edited';
  END IF;

  IF EXISTS (
    SELECT 1 FROM p2_invoices
    WHERE tenant_id = p_tenant_id
      AND dispatch_order_ids @> ARRAY[p_dispatch_order_id]::uuid[]
      AND status != 'cancelled'
  ) THEN
    RAISE EXCEPTION 'INVOICE_LINKED: this challan is invoiced and cannot be edited';
  END IF;

  SELECT qty_dispatched, product_id INTO v_item
  FROM p2_dispatch_items
  WHERE id = p_dispatch_item_id AND dispatch_order_id = p_dispatch_order_id AND tenant_id = p_tenant_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'ITEM_NOT_FOUND: dispatch item does not exist on this challan';
  END IF;

  IF p_new_qty IS NULL OR p_new_qty <= 0 THEN
    RAISE EXCEPTION 'ZERO_QTY: quantity must be at least 1 — cancel the challan instead';
  END IF;

  IF p_new_qty = v_item.qty_dispatched THEN
    RAISE EXCEPTION 'NO_CHANGE: new quantity is the same as current';
  END IF;

  v_delta := p_new_qty - v_item.qty_dispatched;

  SELECT COUNT(*) INTO v_bom_count
  FROM p2_product_bom
  WHERE product_id = v_item.product_id AND tenant_id = p_tenant_id;

  IF v_bom_count = 0 THEN
    RAISE EXCEPTION 'MISSING_BOM: no BOM found for this product, cannot adjust stock';
  END IF;

  IF v_delta > 0 THEN
    -- Sufficiency check across ALL BOM lines before any insert -- a rejected
    -- increase must never leave a partial consumption behind.
    FOR rec IN
      SELECT raw_material_id, qty_per_unit
      FROM p2_product_bom
      WHERE product_id = v_item.product_id AND tenant_id = p_tenant_id
    LOOP
      SELECT COALESCE(SUM(quantity), 0)
      INTO v_balance
      FROM (
        SELECT quantity
        FROM p2_stock_transactions
        WHERE tenant_id = p_tenant_id
          AND raw_material_id = rec.raw_material_id
          AND (owned_by IS NOT DISTINCT FROM v_order.owned_by)
        FOR UPDATE
      ) locked_rows;

      IF v_balance < (v_delta * rec.qty_per_unit) THEN
        SELECT name INTO v_material_name
        FROM p2_raw_materials
        WHERE id = rec.raw_material_id AND tenant_id = p_tenant_id;

        RAISE EXCEPTION 'INSUFFICIENT_STOCK: % — Need %, Available %',
          COALESCE(v_material_name, rec.raw_material_id::text), (v_delta * rec.qty_per_unit), v_balance;
      END IF;
    END LOOP;

    FOR rec IN
      SELECT raw_material_id, qty_per_unit
      FROM p2_product_bom
      WHERE product_id = v_item.product_id AND tenant_id = p_tenant_id
    LOOP
      INSERT INTO p2_stock_transactions (
        tenant_id, raw_material_id, quantity, transaction_type,
        reference_id, owned_by, transaction_date, notes, created_at
      ) VALUES (
        p_tenant_id, rec.raw_material_id, -(v_delta * rec.qty_per_unit), 'consumption',
        p_dispatch_order_id, v_order.owned_by, (NOW() AT TIME ZONE 'Asia/Kolkata')::date,
        'Qty edit — challan ' || COALESCE(v_order.challan_number, ''), NOW()
      );
    END LOOP;
  ELSE
    FOR rec IN
      SELECT raw_material_id, qty_per_unit
      FROM p2_product_bom
      WHERE product_id = v_item.product_id AND tenant_id = p_tenant_id
    LOOP
      INSERT INTO p2_stock_transactions (
        tenant_id, raw_material_id, quantity, transaction_type,
        reference_id, owned_by, transaction_date, notes, created_at
      ) VALUES (
        p_tenant_id, rec.raw_material_id, (ABS(v_delta) * rec.qty_per_unit), 'consumption',
        p_dispatch_order_id, v_order.owned_by, (NOW() AT TIME ZONE 'Asia/Kolkata')::date,
        'Qty edit reversal — challan ' || COALESCE(v_order.challan_number, ''), NOW()
      );
    END LOOP;
  END IF;

  UPDATE p2_dispatch_items
  SET qty_dispatched = p_new_qty
  WHERE id = p_dispatch_item_id;

  RETURN json_build_object(
    'success', true,
    'challan_number', v_order.challan_number,
    'old_qty', v_item.qty_dispatched,
    'new_qty', p_new_qty,
    'delta', v_delta
  );
EXCEPTION WHEN OTHERS THEN
  RAISE EXCEPTION 'Qty edit failed: %', SQLERRM;
END;
$$;

GRANT EXECUTE ON FUNCTION public.edit_product_dispatch_qty(uuid, uuid, uuid, numeric) TO authenticated;
