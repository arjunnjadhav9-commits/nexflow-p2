-- Migration: One-time challan number override
-- Bypasses get_next_challan_number's GREATEST(MAX(existing)+1, floor) logic
-- for exactly ONE dispatch, so an owner can force-reuse a cancelled challan
-- number (e.g. cancel 3000, want the next dispatch to be literally 3000)
-- even when a later dispatch already exists at a higher number (e.g. 3035)
-- -- something the existing challan_sequence "floor" field cannot do, since
-- GREATEST() silently ignores a floor below MAX(existing)+1. See
-- settings.html's "One-time Override" field (Challan Settings tab) and the
-- "Challan Starting Number" field's helper text for the user-facing
-- explanation of why these are two separate mechanisms.
--
-- consume_challan_override() atomically reads AND clears the column in one
-- call -- SELECT ... FOR UPDATE then UPDATE, both inside one plpgsql function
-- body (= one implicit transaction, so the FOR UPDATE row lock spans both
-- statements) -- so two concurrent dispatch creations can never both consume
-- the same override. Mirrors get_next_invoice_number's SELECT-FOR-UPDATE-
-- then-UPDATE idiom (see 20260730_create_invoices_table.sql), except the
-- UPDATE here is skipped when there was nothing to clear, since this
-- function runs on the hot path of EVERY dispatch/issue creation (not just
-- invoice generation) and an unconditional write would dirty the tenant
-- settings row on every single dispatch even when no override is set.
--
-- IMPORTANT: this migration does NOT modify get_next_challan_number itself.
-- That RPC's live source is unavailable to us (only a stale 1-arg reference
-- copy exists at sql/get_next_challan_number.sql, wrong signature vs. the
-- live 3-arg version actually deployed). All override logic lives in NEW
-- code that runs BEFORE get_next_challan_number is called -- this RPC, plus
-- js/utils.js getNextChallanNumber and agent-query/index.ts
-- getNextChallanNumberOrOverride, both of which call this RPC first and
-- fall through to the existing get_next_challan_number call unchanged when
-- it returns NULL.

ALTER TABLE p2_tenant_settings ADD COLUMN IF NOT EXISTS challan_next_override integer DEFAULT NULL;

CREATE OR REPLACE FUNCTION consume_challan_override(p_tenant_id uuid)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE v_override integer;
BEGIN
  SELECT challan_next_override INTO v_override
  FROM p2_tenant_settings
  WHERE tenant_id = p_tenant_id FOR UPDATE;

  IF v_override IS NOT NULL THEN
    UPDATE p2_tenant_settings SET challan_next_override = NULL
    WHERE tenant_id = p_tenant_id;
  END IF;

  RETURN v_override;
END;$$;

-- Grant execute to authenticated, matching get_next_challan_number's existing
-- posture (sql/get_next_challan_number.sql grants only to `authenticated`,
-- no additional JWT/tenant-ownership check -- that pattern was never applied
-- to any of the sibling numbering RPCs either, e.g. get_next_invoice_number).
-- agent-query's service-role client can still call this: Supabase projects
-- grant EXECUTE on all public routines to service_role via default
-- privileges set at project bootstrap, which is why agent-query's existing
-- calls to get_next_challan_number already work today despite that RPC only
-- explicitly granting to `authenticated`.
GRANT EXECUTE ON FUNCTION consume_challan_override(uuid) TO authenticated;
