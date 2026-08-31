-- Step 2K — s.143 clock population
-- Adds s143_extension_until + is_exempt_tooling to p2_dispatch_orders, and a
-- trigger that populates s143_clock_start / s143_clock_deadline on the
-- transition into status = 'confirmed', for job_work_issue and
-- capital_goods_issue dispatches only. All other movement_purpose values,
-- including rework_return, are left untouched (NULL) — "original clock
-- continues" is satisfied by inaction, not by this migration.
--
-- Apply manually via the Supabase SQL Editor. Do not run via `supabase db
-- push` — it replays old migrations against this project.

ALTER TABLE p2_dispatch_orders
  ADD COLUMN IF NOT EXISTS s143_extension_until timestamptz NULL;

ALTER TABLE p2_dispatch_orders
  ADD COLUMN IF NOT EXISTS is_exempt_tooling boolean NOT NULL DEFAULT false;

CREATE OR REPLACE FUNCTION set_s143_clock()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  -- Only fire on the transition into 'confirmed' — covers both shapes seen in
  -- this codebase: insert-as-draft-then-update-to-confirmed (dispatch.html,
  -- rm-dispatch.html confirmDispatch()), and insert-already-confirmed
  -- (confirm_bom_issue RPC, agent-query's direct inserts). Re-saving an
  -- already-confirmed row (e.g. editing challan_note) never recomputes the
  -- clock, by design — the clock is tied to the original dispatch event.
  IF NEW.status = 'confirmed'
     AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'confirmed') THEN

    IF NEW.movement_purpose = 'job_work_issue' THEN
      NEW.s143_clock_start := COALESCE(NEW.dispatch_date, now());
      NEW.s143_clock_deadline := CASE
        WHEN NEW.is_exempt_tooling THEN NULL
        ELSE NEW.s143_clock_start + INTERVAL '1 year'
      END;

    ELSIF NEW.movement_purpose = 'capital_goods_issue' THEN
      NEW.s143_clock_start := COALESCE(NEW.dispatch_date, now());
      NEW.s143_clock_deadline := CASE
        WHEN NEW.is_exempt_tooling THEN NULL
        ELSE NEW.s143_clock_start + INTERVAL '3 years'
      END;

    END IF;
    -- all other purposes (sale, job_work_return, unused_material_return,
    -- scrap_return, rework_return, rework_dispatch, inter_jobworker_transfer,
    -- direct_supply_from_jobworker): clock columns untouched, stay NULL.
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_s143_clock_population ON p2_dispatch_orders;

CREATE TRIGGER trg_s143_clock_population
  BEFORE INSERT OR UPDATE ON p2_dispatch_orders
  FOR EACH ROW
  EXECUTE FUNCTION set_s143_clock();
