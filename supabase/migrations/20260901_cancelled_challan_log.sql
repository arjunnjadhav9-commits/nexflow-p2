-- Immutable audit log for hard-deleted cancelled challans (Rule 56(7) CGST
-- Rules -- audit trail for deleted records). Hard delete of cancelled challans
-- stays intentional (clients need to reuse challan numbers after mistakes);
-- this table is what lets Table 13 still count them after the row is gone.

CREATE TABLE p2_cancelled_challans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES p2_tenants(id),
  challan_number text NOT NULL,
  cancelled_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE p2_cancelled_challans ENABLE ROW LEVEL SECURITY;

-- get_my_tenant_id() (20260803_staff_rls_fix.sql), not tenant_id = auth.uid() --
-- same reasoning as p2_notifications: the auth.uid() pattern is already known-
-- broken for non-owner staff on p2_payment_receipts. hard_delete_dispatch is
-- owner-only today, but this keeps the RLS pattern consistent with the rest
-- of the schema regardless.
--
-- SELECT + INSERT only -- no UPDATE, no DELETE policy exists, so this table
-- is immutable at the RLS layer even for the owner role.
CREATE POLICY "cancelled_challans_select" ON p2_cancelled_challans
  FOR SELECT USING (tenant_id = get_my_tenant_id());

CREATE POLICY "cancelled_challans_insert" ON p2_cancelled_challans
  FOR INSERT WITH CHECK (tenant_id = get_my_tenant_id());

CREATE INDEX idx_p2_cancelled_challans_tenant_cancelled
  ON p2_cancelled_challans (tenant_id, cancelled_at);


-- hard_delete_dispatch: re-emitted whole (SECURITY DEFINER, so CREATE OR
-- REPLACE is the only way to change it). Body verified byte-identical to the
-- live pg_get_functiondef output (diffed against 20260825_hard_delete_dispatch.sql
-- -- no logic drift; two explanatory comments present in the original migration
-- are absent from the live function and are deliberately NOT reintroduced here,
-- to keep this migration a true match of what is live plus exactly one addition).
--
-- The only change from the live body: one new block after the stock-reversal
-- FOR loop, before the challan-number-reuse bookkeeping, inserting an audit row
-- into p2_cancelled_challans for every challan that reaches this function in
-- 'cancelled' status (drafts never had a real document, so they are not logged).
-- This runs inside the same SECURITY DEFINER transaction as the delete itself,
-- so the audit row and the deletion are atomic -- either both happen or neither does.

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
    INSERT INTO p2_cancelled_challans (tenant_id, challan_number)
    VALUES (p_tenant_id, v_order.challan_number);
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
