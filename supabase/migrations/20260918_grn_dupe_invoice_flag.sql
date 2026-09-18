-- Per-tenant duplicate GRN invoice flag.
--
-- Context: CLAUDE.md Known Open Items #1 documents that a plain partial unique index on
-- (tenant_id, supplier_id, normalised invoice_no, raw_material_id) was rejected -- S.S.
-- Engineering's coil-by-coil GRN workflow legitimately writes multiple rows sharing that
-- exact tuple (one row per physical coil under one supplier invoice, quantities differ per
-- coil). This migration adds a per-tenant opt-in flag instead: tenants without this workflow
-- keep the hard block, S.S. Engineering (confirmed against live data, see below) is exempted.
--
-- Enforcement is a BEFORE INSERT trigger, not a unique index. A partial unique index's WHERE
-- predicate cannot contain a subquery referencing another table (Postgres: "cannot use
-- subquery in index predicate"), which rules out `WHERE tenant_id NOT IN (SELECT ... FROM
-- p2_tenant_settings ...)` as originally specified. A trigger has no such restriction, checks
-- the flag live on every insert (no migration needed for future tenant opt-ins), and --
-- unlike an index scoped only to whichever RPC someone remembers to update -- covers every
-- write path that inserts GRN rows today: confirm_agent_grn_v3, grn.html's direct browser
-- insert, and scanner.html's confirmGRN(). None of those three have any duplicate protection
-- at the DB level before this migration.
--
-- Live checkpoint (run before Run 2 below, read-only, via a throwaway Node script mirroring
-- this grouping query):
--   SELECT tenant_id, supplier_id,
--          upper(regexp_replace(invoice_no,'[\s\-/]','','g')) AS inv, raw_material_id, count(*)
--   FROM p2_stock_transactions
--   WHERE transaction_type = 'grn' AND invoice_no IS NOT NULL
--   GROUP BY 1,2,3,4 HAVING count(*) > 1;
-- Result (584 GRN rows scanned): 6 duplicate-look groups. S.S. Engineering accounted for 5,
-- every one sharing a single grn_no with quantities that differ meaningfully row-to-row (real
-- coil-to-coil weight variation on copper wire/cable) -- confirms the documented pattern.
-- Datta Prasad Enterprises accounted for 1: two identical qty=2 rows of a discrete motor part
-- (3SRA-KS160-4P-11E3, not a coil commodity) under one invoice/grn_no -- no quantity variation,
-- reads as an accidental duplicate row rather than the coil-by-coil pattern. Owner decision
-- (2026-09-18): flag S.S. Engineering only; Datta Prasad's row stays blocked/unflagged and is
-- left for its owner to review and correct.
--
-- IMPORTANT -- run each block below as a SEPARATE Supabase SQL Editor execution, in order.
-- CREATE INDEX CONCURRENTLY cannot run inside a transaction block, so it cannot be pasted
-- together with the other statements. Apply via SQL Editor only -- never `supabase db push`
-- (it replays old migrations against this project).

-- =====================================================================================
-- RUN 1 -- add the column. Default false: every existing tenant keeps the hard block until
-- explicitly opted in.
-- =====================================================================================
ALTER TABLE p2_tenant_settings
  ADD COLUMN IF NOT EXISTS allow_duplicate_grn_invoice boolean NOT NULL DEFAULT false;

-- =====================================================================================
-- RUN 2 -- set the flag for the tenant(s) confirmed above. S.S. Engineering only.
-- =====================================================================================
UPDATE p2_tenant_settings
SET allow_duplicate_grn_invoice = true
WHERE tenant_id = '5ab7fb07-2557-42e7-8a8a-5d9fd59048ac'; -- S.S. Engineering

-- =====================================================================================
-- RUN 3 -- trigger function + trigger. This is the enforcement point (replaces the
-- originally-specified unique index).
-- =====================================================================================
CREATE OR REPLACE FUNCTION public.trg_check_grn_dupe_invoice()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant_id      uuid;
  v_allow          boolean;
  v_existing_grn_no text;
BEGIN
  IF NEW.transaction_type IS DISTINCT FROM 'grn' OR NEW.invoice_no IS NULL THEN
    RETURN NEW;
  END IF;

  -- COALESCE, not a bare NEW.tenant_id read: set_tenant_id() (applied directly in the SQL
  -- Editor, no migration file for it -- see CLAUDE.md) is a sibling BEFORE INSERT trigger on
  -- this same table, and Postgres fires same-event row triggers in name order, not creation
  -- order. This makes the check correct regardless of which trigger happens to fire first.
  v_tenant_id := COALESCE(NEW.tenant_id, get_my_tenant_id());

  SELECT allow_duplicate_grn_invoice INTO v_allow
  FROM p2_tenant_settings
  WHERE tenant_id = v_tenant_id;

  IF COALESCE(v_allow, false) THEN
    RETURN NEW;
  END IF;

  SELECT grn_no INTO v_existing_grn_no
  FROM p2_stock_transactions
  WHERE tenant_id = v_tenant_id
    AND supplier_id = NEW.supplier_id
    AND raw_material_id = NEW.raw_material_id
    AND transaction_type = 'grn'
    AND invoice_no IS NOT NULL
    AND upper(regexp_replace(invoice_no, '[\s\-/]', '', 'g'))
      = upper(regexp_replace(NEW.invoice_no, '[\s\-/]', '', 'g'))
  LIMIT 1;

  IF v_existing_grn_no IS NOT NULL THEN
    RAISE EXCEPTION 'DUPLICATE_GRN_INVOICE: invoice % for this material was already received under %',
      NEW.invoice_no, v_existing_grn_no;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_grn_dupe_invoice_check ON p2_stock_transactions;
CREATE TRIGGER trg_grn_dupe_invoice_check
  BEFORE INSERT ON p2_stock_transactions
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_check_grn_dupe_invoice();

-- =====================================================================================
-- RUN 4 -- supporting index for the trigger's own lookup. Own-table-only predicate (valid --
-- the subquery restriction only applies to referencing OTHER tables). Must run standalone;
-- CONCURRENTLY cannot run inside a transaction block.
-- =====================================================================================
CREATE INDEX CONCURRENTLY IF NOT EXISTS p2_stock_transactions_grn_dupe_lookup_idx
  ON p2_stock_transactions (tenant_id, supplier_id, raw_material_id)
  WHERE transaction_type = 'grn' AND invoice_no IS NOT NULL;
