-- Secures confirm_dispatch_transaction (bug-scan fixes A3 + A4, corrected):
--
-- 1. Tenant-ownership check (A3, corrected approach). The original plan was
--    to revoke EXECUTE from `authenticated` and restrict this SECURITY
--    DEFINER function to service_role only — but dispatch.html/rm-dispatch.html
--    call it DIRECTLY from the browser via window.supabase.rpc(...) using
--    the logged-in user's own session (Postgres role `authenticated`, not
--    service_role), confirmed via pg_get_functiondef on the live function
--    before writing this migration. Revoking EXECUTE from `authenticated`
--    would have broken dispatch/RM-dispatch confirmation for every tenant.
--    The real fix: verify p_tenant_id against the calling user's actual
--    identity inside the function body — same resolution
--    confirm-dispatch/index.ts and agent-query's confirmReceiveGrn already
--    use (owner: auth.uid(); invited staff: the tenant_id stamped into
--    their JWT user_metadata at invite time). Only enforced when there IS a
--    real user JWT (auth.uid() is not null) — service-role callers (e.g.
--    confirm-dispatch/index.ts, which now does its own equivalent check
--    before calling this RPC) have no JWT context here and are trusted at
--    that higher layer instead, since holding the service-role key already
--    implies full DB access regardless of what this function checks.
--
-- 2. Locked, aggregated stock-sufficiency check (A4). This function
--    previously had NO stock check of its own — the only check was an
--    unlocked, client-side JS read in dispatch.html/rm-dispatch.html before
--    calling this RPC, purely informational. Two concurrent confirmations
--    consuming the same material could both read the same starting
--    balance, both pass, and both deduct, taking stock negative. Mirrors
--    the exact aggregate-per-material + FOR UPDATE subquery pattern already
--    shipped in confirm_bom_issue's v2 fix
--    (20260807_confirm_bom_issue_stock_check_v2.sql).
--
-- Everything else (challan number generation/fallback, stock transaction
-- notes format, dispatch order update) is unchanged from the live function,
-- captured via `SELECT pg_get_functiondef(oid) FROM pg_proc WHERE proname =
-- 'confirm_dispatch_transaction'` immediately before writing this file.
-- CREATE OR REPLACE preserves existing grants, so no GRANT/REVOKE statement
-- is needed here.

CREATE OR REPLACE FUNCTION public.confirm_dispatch_transaction(
  p_dispatch_order_id UUID,
  p_tenant_id UUID,
  p_consumption_json TEXT,
  p_challan_number TEXT DEFAULT NULL::TEXT
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
    rec              RECORD;
BEGIN
    -- Tenant-ownership check — see migration header comment above.
    IF auth.uid() IS NOT NULL THEN
        v_caller_tenant := COALESCE(auth.jwt() -> 'user_metadata' ->> 'tenant_id', auth.uid()::text);
        IF v_caller_tenant IS DISTINCT FROM p_tenant_id::text THEN
            RAISE EXCEPTION 'Unauthorized';
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
    -- confirm_bom_issue v2. Runs before any consumption rows are inserted.
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
            FOR UPDATE
        ) locked_rows;

        IF v_balance < rec.total_required THEN
            RAISE EXCEPTION 'INSUFFICIENT_STOCK: % — Need %, Available %',
              rec.mat_id, rec.total_required, v_balance;
        END IF;
    END LOOP;

    -- Insert stock consumption transactions
    FOR v_material IN SELECT * FROM jsonb_array_elements(v_consumption)
    LOOP
        INSERT INTO p2_stock_transactions (
            tenant_id, raw_material_id, transaction_type,
            quantity, reference_id, notes, transaction_date, created_at
        ) VALUES (
            p_tenant_id,
            (v_material->>'material_id')::UUID,
            'consumption',
            -(v_material->>'qty')::NUMERIC,
            p_dispatch_order_id,
            'Dispatch: Challan ' || v_challan_number,
            NOW(), NOW()
        );
    END LOOP;

    -- Update dispatch order
    UPDATE p2_dispatch_orders
    SET
        status         = 'confirmed',
        challan_number = v_challan_number,
        confirmed_at   = NOW(),
        updated_at     = NOW()
    WHERE id = p_dispatch_order_id;

    RETURN json_build_object('challan_number', v_challan_number);

EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION 'Transaction failed: %', SQLERRM;
END;
$function$;
