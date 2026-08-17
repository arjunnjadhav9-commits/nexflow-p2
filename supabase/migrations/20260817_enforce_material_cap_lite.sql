-- Backs the Lite-plan 250-material cap with a real DB constraint. Previously
-- this was enforced only in client-side JS (settings.html's single-add
-- handler and submitBulkImport()) — a modified client, a direct API call, or
-- two concurrent imports/tabs each computing their own count independently
-- could all exceed 250 rows for a Lite tenant with nothing server-side to
-- stop them.
--
-- Only guards INSERT (matching the existing client-side checks, which are
-- also insert/import-only — there's no material-reactivation flow in the
-- app today). Counts is_active = true rows only, matching the same
-- client-side count. NEW.tenant_id is relied on here — every insert path in
-- this codebase already sets tenant_id explicitly in the payload (this is
-- not a substitute for that; it's a floor under it), so this doesn't depend
-- on trigger firing order relative to the existing set_tenant_id trigger.
-- Already covered by the documented `DISABLE TRIGGER ALL` bulk-insert
-- workflow (see CLAUDE.md) for admin/onboarding seeding.

CREATE OR REPLACE FUNCTION enforce_material_cap_for_lite()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_plan  TEXT;
  v_count INTEGER;
BEGIN
  SELECT plan INTO v_plan FROM p2_tenant_settings WHERE tenant_id = NEW.tenant_id;

  IF v_plan = 'lite' THEN
    SELECT COUNT(*) INTO v_count
    FROM p2_raw_materials
    WHERE tenant_id = NEW.tenant_id AND is_active = true;

    IF v_count >= 250 THEN
      RAISE EXCEPTION 'MATERIAL_CAP_EXCEEDED: Lite plan is limited to 250 active materials';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_material_cap ON p2_raw_materials;
CREATE TRIGGER trg_enforce_material_cap
  BEFORE INSERT ON p2_raw_materials
  FOR EACH ROW
  EXECUTE FUNCTION enforce_material_cap_for_lite();
