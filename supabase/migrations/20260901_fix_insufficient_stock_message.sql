-- Fixes the INSUFFICIENT_STOCK error message in confirm_dispatch_transaction:
-- previously showed the raw material_id UUID instead of the material name,
-- because unlike confirm_bom_issue's consumption JSON, this RPC's payload
-- (dispatch.html / rm-dispatch.html) only ever carries {material_id, qty} —
-- no material_name. Adds a p2_raw_materials lookup, scoped to p_tenant_id,
-- right before the exception is raised (only on the failure path, not on
-- every iteration of the loop).
--
-- Captured from the live function via
-- SELECT pg_get_functiondef(oid) FROM pg_proc WHERE proname = 'confirm_dispatch_transaction';
-- run by the user in the Supabase SQL Editor immediately before this file was
-- written. The last committed migration (20260817_secure_confirm_dispatch_
-- transaction.sql) predates the Step 2M (Aug 26 2026) live-only change that
-- added p_owned_by and pool-awareness, so it no longer matches the deployed
-- function. This migration captures and preserves that live version
-- byte-for-byte except for the one change described above.
--
-- Same signature (5 params, same order/defaults) as the live function, so
-- CREATE OR REPLACE updates it in place — no DROP FUNCTION, no overload
-- risk, no GRANT/REVOKE needed (grants are preserved automatically).
--
-- confirm_bom_issue is untouched — out of scope for this fix.

CREATE OR REPLACE FUNCTION public.confirm_dispatch_transaction(
  p_dispatch_order_id UUID,
  p_tenant_id UUID,
  p_consumption_json TEXT,
  p_challan_number TEXT DEFAULT NULL::TEXT,
  p_owned_by UUID DEFAULT NULL::UUID
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
AS $function$
DECLARE
    v_challan_number TEXT;
    v_consumption    JSONB;
    v_material       JSONB;
    v_caller_tenant  TEXT;
    v_balance        NUMERIC;
    v_pool_label     TEXT;
    v_material_name  TEXT;
    rec              RECORD;
BEGIN
    -- Tenant-ownership check — unchanged from 20260817_secure_confirm_dispatch_transaction.sql.
    IF auth.uid() IS NOT NULL THEN
        v_caller_tenant := COALESCE(auth.jwt() -> 'user_metadata' ->> 'tenant_id', auth.uid()::text);
        IF v_caller_tenant IS DISTINCT FROM p_tenant_id::text THEN
            RAISE EXCEPTION 'Unauthorized';
        END IF;
    END IF;

    -- Resolve the pool's display name once, up front, for the
    -- INSUFFICIENT_STOCK message below — same pattern as confirm_bom_issue v3.
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

    v_consumption := p_consumption_json::JSONB;

    -- Use the pre-generated challan number if provided,
    -- otherwise fall back to old sequence format (safety net only)
    IF p_challan_number IS NOT NULL AND p_challan_number != '' THEN
        v_challan_number := p_challan_number;
    ELSE
        DECLARE v_seq INTEGER;
        BEGIN
            SELECT COALESCE(challan_sequence, 0) + 1
            INTO   v_seq
            FROM   p2_tenant_settings
            WHERE  tenant_id = p_tenant_id;

            v_seq := COALESCE(v_seq, 1001);
            v_challan_number := 'CHAL-' || TO_CHAR(NOW(), 'YYYYMMDD') || '-' || LPAD(v_seq::TEXT, 4, '0');

            UPDATE p2_tenant_settings
            SET    challan_sequence = v_seq
            WHERE  tenant_id = p_tenant_id;
        END;
    END IF;

    -- Stock-sufficiency check, aggregated per material and locked against
    -- concurrent confirmations of the same material — same pattern as
    -- confirm_bom_issue. Scoped per (material, pool) via IS NOT DISTINCT FROM.
    FOR rec IN
        SELECT
          (elem->>'material_id')::uuid AS mat_id,
          SUM((elem->>'qty')::numeric) AS total_required
        FROM jsonb_array_elements(v_consumption) AS elem
        GROUP BY (elem->>'material_id')::uuid
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
            -- Resolve the material's display name for the error message —
            -- this RPC's consumption JSON only carries material_id/qty (no
            -- material_name, unlike confirm_bom_issue's payload), so the
            -- name has to come from p2_raw_materials, not the JSON.
            SELECT name INTO v_material_name
            FROM p2_raw_materials
            WHERE id = rec.mat_id AND tenant_id = p_tenant_id;

            RAISE EXCEPTION 'INSUFFICIENT_STOCK: % % — Need %, Available %',
              COALESCE(v_material_name, rec.mat_id::text), v_pool_label, rec.total_required, v_balance;
        END IF;
    END LOOP;

    -- Insert stock consumption transactions
    FOR v_material IN SELECT * FROM jsonb_array_elements(v_consumption)
    LOOP
        INSERT INTO p2_stock_transactions (
            tenant_id, raw_material_id, transaction_type,
            quantity, reference_id, notes, transaction_date, created_at,
            owned_by
        ) VALUES (
            p_tenant_id,
            (v_material->>'material_id')::UUID,
            'consumption',
            -(v_material->>'qty')::NUMERIC,
            p_dispatch_order_id,
            'Dispatch: Challan ' || v_challan_number,
            NOW(), NOW(),
            p_owned_by
        );
    END LOOP;

    -- Update dispatch order. owned_by is stamped here (not at the caller's
    -- initial insert) because this RPC never creates the order row itself --
    -- callers insert it first, then call this RPC -- so this is the one
    -- place responsible for the header's ownership regardless of caller.
    UPDATE p2_dispatch_orders
    SET
        status         = 'confirmed',
        challan_number = v_challan_number,
        confirmed_at   = NOW(),
        updated_at     = NOW(),
        owned_by       = p_owned_by
    WHERE id = p_dispatch_order_id;

    RETURN json_build_object('challan_number', v_challan_number);

EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION 'Transaction failed: %', SQLERRM;
END;
$function$;
