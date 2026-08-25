-- Hard delete for dispatch challans (draft/cancelled only).
--
-- Two new RPCs, both SECURITY DEFINER:
--
-- 1. get_dispatch_delete_eligibility(p_dispatch_order_id, p_tenant_id) -- read-only,
--    used by the UI to render the confirm/blocked state of the delete modal before the
--    user commits. Returns {eligible, reasons[], challan_number} instead of raising, so a
--    blocked reason can be displayed rather than surfaced as an error toast.
--
-- 2. hard_delete_dispatch(p_dispatch_order_id, p_tenant_id) -- does the actual delete.
--    Re-checks every rule itself (never trusts an earlier eligibility call) and raises on
--    any failure, same wrapping convention as confirm_bom_issue/confirm_dispatch_transaction
--    (RAISE EXCEPTION 'Hard delete failed: %', SQLERRM at the end re-wraps whatever inner
--    RAISE fired, but the inner code string -- INVALID_STATUS, INVOICE_LINKED, GRN_LINKED,
--    OWNER_ONLY -- is still present in the wrapped message for client-side matching).
--
-- Both functions must be SECURITY DEFINER because the GRN check has to scan OTHER
-- tenants' p2_stock_transactions: there is no p2_grn_records table and no structured
-- column linking a GRN back to a sending dispatch. The only place that link exists is
-- agent-query's confirmReceiveGrn, which stamps 'dispatch_token:<uuid>' into the
-- free-text notes column of a transaction_type='grn' row ON THE RECIPIENT TENANT'S SIDE.
-- Normal RLS (staff_tenant_access, tenant_id = get_my_tenant_id()) would hide that from
-- the sending tenant's own session entirely, so this check requires bypassing RLS.
--
-- Because these are SECURITY DEFINER, table-level RLS does not govern what happens
-- inside them -- the explicit auth.uid()-vs-p_tenant_id check below (only enforced when
-- a real user JWT is present, exactly mirroring
-- 20260817_secure_confirm_dispatch_transaction.sql) is the actual tenant-isolation
-- enforcement, plus an owner-role check on top (get_my_role(), from
-- 20260803_get_my_role_rpc.sql) since hard delete is meant to be owner-only.
--
-- Stock ledger note: p2_stock_transactions is an append-only log (see CLAUDE.md). This
-- migration never deletes existing rows from it -- only inserts one offsetting
-- 'adjustment' row per (raw_material_id, owned_by) group if that group's net quantity
-- for this dispatch isn't already zero. For a properly cancelled challan this is already
-- zero (cancel_challan's own reversal), and a draft never had any stock transaction in
-- the first place (stock is only decremented at confirm time in this app) -- so in both
-- expected cases this loop is a no-op; it exists only as a safety net.
--
-- Challan number reuse: parses the first digit run out of challan_number (same technique
-- as export.html's challanNumKey()) and writes it into the existing single-slot
-- p2_tenant_settings.challan_next_override column, consumed by consume_challan_override()
-- on the tenant's next dispatch/issue creation (20260822_challan_next_override.sql). This
-- is a single slot, not a real free-list -- if several challans are hard-deleted before
-- the next dispatch is created, only the most recent one's number is offered. Accepted,
-- documented limitation; no other reuse mechanism exists in this codebase.

CREATE OR REPLACE FUNCTION get_dispatch_delete_eligibility(
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
  v_reasons       text[] := '{}';
BEGIN
  IF auth.uid() IS NOT NULL THEN
    v_caller_tenant := COALESCE(auth.jwt() -> 'user_metadata' ->> 'tenant_id', auth.uid()::text);
    IF v_caller_tenant IS DISTINCT FROM p_tenant_id::text THEN
      RAISE EXCEPTION 'Unauthorized';
    END IF;

    v_is_owner := (auth.uid() = p_tenant_id) OR (get_my_role(p_tenant_id) = 'owner');
    IF NOT v_is_owner THEN
      RETURN json_build_object('eligible', false, 'reasons', ARRAY['OWNER_ONLY'], 'challan_number', NULL);
    END IF;
  END IF;

  SELECT id, status, challan_number, dispatch_token
  INTO v_order
  FROM p2_dispatch_orders
  WHERE id = p_dispatch_order_id AND tenant_id = p_tenant_id;

  IF NOT FOUND THEN
    RETURN json_build_object('eligible', false, 'reasons', ARRAY['NOT_FOUND'], 'challan_number', NULL);
  END IF;

  IF v_order.status NOT IN ('draft', 'cancelled') THEN
    v_reasons := array_append(v_reasons, 'STATUS');
  END IF;

  IF EXISTS (SELECT 1 FROM p2_invoices WHERE dispatch_order_id = p_dispatch_order_id) THEN
    v_reasons := array_append(v_reasons, 'INVOICE_SINGLE');
  END IF;

  IF EXISTS (SELECT 1 FROM p2_invoices WHERE dispatch_order_ids @> ARRAY[p_dispatch_order_id]::uuid[]) THEN
    v_reasons := array_append(v_reasons, 'INVOICE_CONSOLIDATED');
  END IF;

  IF EXISTS (
    SELECT 1 FROM p2_stock_transactions
    WHERE transaction_type = 'grn'
      AND notes ILIKE '%dispatch_token:' || v_order.dispatch_token::text || '%'
  ) THEN
    v_reasons := array_append(v_reasons, 'GRN_LINKED');
  END IF;

  RETURN json_build_object(
    'eligible', (array_length(v_reasons, 1) IS NULL),
    'reasons', v_reasons,
    'challan_number', v_order.challan_number
  );
EXCEPTION WHEN OTHERS THEN
  RAISE EXCEPTION 'Eligibility check failed: %', SQLERRM;
END;
$$;

GRANT EXECUTE ON FUNCTION get_dispatch_delete_eligibility(uuid, uuid) TO authenticated;


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

  -- Stock reversal safety net -- see migration header. Defensive no-op for a
  -- properly cancelled challan or an unconfirmed draft; guards against an
  -- incomplete cancel_challan reversal or any other edge case leaving a
  -- non-zero net effect behind before the dispatch row disappears.
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

  -- Free the challan number for reuse -- see migration header.
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

GRANT EXECUTE ON FUNCTION hard_delete_dispatch(uuid, uuid) TO authenticated;
