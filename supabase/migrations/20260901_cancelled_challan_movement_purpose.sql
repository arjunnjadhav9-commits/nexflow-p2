-- Adds movement_purpose to p2_cancelled_challans so Table 13's Job Work vs
-- Other document-type split (export.html) can be computed for CANCELLED
-- challans too, not just confirmed ones. Without this column, a job-work
-- challan that is cancelled and then hard-deleted has no surviving record
-- of what it was for -- p2_cancelled_challans (20260901_cancelled_challan_log.sql)
-- only ever stored tenant_id/challan_number/cancelled_at/created_at.
--
-- Nullable: existing rows inserted before this migration (if any) have no
-- way to backfill their movement_purpose (the p2_dispatch_orders row is
-- already gone by the time a p2_cancelled_challans row exists) -- they stay
-- NULL and Table 13 must treat NULL as "unknown", never silently as 'sale'.

ALTER TABLE p2_cancelled_challans
  ADD COLUMN IF NOT EXISTS movement_purpose text NULL;

-- hard_delete_dispatch re-emitted whole (SECURITY DEFINER). Body is the
-- exact function you confirmed live after 20260901_cancelled_challan_log.sql
-- (table + audit-log IF block), with exactly one change: the audit-log
-- INSERT now also writes movement_purpose. v_order.movement_purpose was
-- already fetched by this function's own `SELECT * INTO v_order` at the
-- top -- no new query, no new column read.

CREATE OR REPLACE FUNCTION hard_delete_dispatch(
  p_dispatch_order_id uuid,
  p_tenant_id uuid
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_caller_tenant text;
  v_is_owner      boolean;
  v_order         record;
  v_num           text;
  rec             record;
BEGIN
  IF auth.uid() IS NOT NULL THEN
    v_caller_tenant := COALESCE(auth.jwt() -> 'user_metadata' ->> 'tenant_id', auth.uid()::text);
    IF v_caller_tenant IS DISTINCT FROM p_tenant_id::text THEN
      RAISE EXCEPTION 'Unauthorized';
    END IF;

    v_is_owner := (auth.uid() = p_tenant_id) OR (get_my_role(p_tenant_id) = 'owner');
    IF NOT v_is_owner THEN
      RAISE EXCEPTION 'OWNER_ONLY: only the account owner can permanently delete a challan';
    END IF;
  END IF;

  SELECT * INTO v_order
  FROM p2_dispatch_orders
  WHERE id = p_dispatch_order_id AND tenant_id = p_tenant_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'NOT_FOUND: dispatch order does not exist for this tenant';
  END IF;

  IF v_order.status NOT IN ('draft', 'cancelled') THEN
    RAISE EXCEPTION 'INVALID_STATUS: only draft or cancelled challans can be permanently deleted';
  END IF;

  IF EXISTS (SELECT 1 FROM p2_invoices WHERE dispatch_order_id = p_dispatch_order_id) THEN
    RAISE EXCEPTION 'INVOICE_LINKED: a single-mode invoice already references this challan';
  END IF;

  IF EXISTS (SELECT 1 FROM p2_invoices WHERE dispatch_order_ids @> ARRAY[p_dispatch_order_id]::uuid[]) THEN
    RAISE EXCEPTION 'INVOICE_LINKED: a consolidated invoice already references this challan';
  END IF;

  IF EXISTS (
    SELECT 1 FROM p2_stock_transactions
    WHERE transaction_type = 'grn'
      AND notes ILIKE '%dispatch_token:' || v_order.dispatch_token::text || '%'
  ) THEN
    RAISE EXCEPTION 'GRN_LINKED: a GRN has already been recorded against this challan';
  END IF;

  FOR rec IN
    SELECT raw_material_id, owned_by, SUM(quantity) AS net_qty
    FROM p2_stock_transactions
    WHERE reference_id = p_dispatch_order_id AND tenant_id = p_tenant_id
    GROUP BY raw_material_id, owned_by
    HAVING SUM(quantity) != 0
  LOOP
    INSERT INTO p2_stock_transactions (
      tenant_id, raw_material_id, transaction_type, quantity,
      reference_id, notes, transaction_date, created_at, owned_by
    ) VALUES (
      p_tenant_id, rec.raw_material_id, 'adjustment', -rec.net_qty,
      p_dispatch_order_id,
      'Hard delete reversal — Challan ' || COALESCE(v_order.challan_number, ''),
      NOW(), NOW(), rec.owned_by
    );
  END LOOP;

  -- Audit log: record cancelled challan before deletion (Rule 56(7))
  IF v_order.status = 'cancelled' AND v_order.challan_number IS NOT NULL THEN
    INSERT INTO p2_cancelled_challans (tenant_id, challan_number, movement_purpose)
    VALUES (p_tenant_id, v_order.challan_number, v_order.movement_purpose);
  END IF;

  v_num := substring(v_order.challan_number from '\d+');
  IF v_num IS NOT NULL THEN
    UPDATE p2_tenant_settings
    SET challan_next_override = v_num::integer
    WHERE tenant_id = p_tenant_id;
  END IF;

  DELETE FROM p2_dispatch_items
  WHERE dispatch_order_id = p_dispatch_order_id AND tenant_id = p_tenant_id;

  DELETE FROM p2_dispatch_orders
  WHERE id = p_dispatch_order_id AND tenant_id = p_tenant_id;

  RETURN json_build_object('deleted', true, 'freed_challan_number', v_order.challan_number);
EXCEPTION WHEN OTHERS THEN
  RAISE EXCEPTION 'Hard delete failed: %', SQLERRM;
END;
$$;

-- Run this in Supabase SQL Editor as postgres role.
-- Test tenant: fe2b94fb-9668-405f-9c62-5f54b32f8c7a
-- NEVER run against SS Engineering (5ab7fb07), Datta Prasad (3b68db90),
--   Shivprasad (6fe0680a), or Demo (5f021c96).
