-- Known Open Items #7 (_ai/CLAUDE.md, found Sept 10 2026 invoices.html audit):
-- p2_invoices has unique indexes on dispatch_order_id and invoice_token only —
-- nothing enforces invoice_number uniqueness at the DB level, not even per
-- tenant. Correctness today relies entirely on get_next_invoice_number's
-- row-locked p2_tenant_settings.invoice_sequence counter never being
-- hand-edited backward (a routine direct-SQL-Editor pattern elsewhere in this
-- codebase). This adds the missing constraint, scoped per tenant.
--
-- Postgres has no "ADD CONSTRAINT IF NOT EXISTS" (unlike ADD COLUMN), and a
-- plain ALTER TABLE gives no way to report which rows are duplicated before
-- failing — so this is a DO block: check for duplicates first and abort with
-- a full report if any exist (nothing is added), otherwise add the
-- constraint only if it isn't already there (safe to re-run any number of
-- times).
--
-- Run this in Supabase SQL Editor as postgres role — never `supabase db push`.
-- Optional sanity check first (same query the block below runs internally):
--   SELECT tenant_id, invoice_number, COUNT(*)
--   FROM p2_invoices
--   GROUP BY tenant_id, invoice_number
--   HAVING COUNT(*) > 1;

DO $$
DECLARE
  dup_count integer;
  dup_report text;
BEGIN
  SELECT count(*) INTO dup_count FROM (
    SELECT tenant_id, invoice_number
    FROM p2_invoices
    GROUP BY tenant_id, invoice_number
    HAVING COUNT(*) > 1
  ) d;

  IF dup_count > 0 THEN
    SELECT string_agg(
      'tenant_id=' || tenant_id::text || ' invoice_number=' || invoice_number || ' (' || cnt || ' rows)',
      E'\n'
    ) INTO dup_report
    FROM (
      SELECT tenant_id, invoice_number, COUNT(*) AS cnt
      FROM p2_invoices
      GROUP BY tenant_id, invoice_number
      HAVING COUNT(*) > 1
    ) d;

    RAISE EXCEPTION 'Aborting: % duplicate (tenant_id, invoice_number) pair(s) in p2_invoices — resolve before re-running:%',
      dup_count, E'\n' || dup_report;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'p2_invoices_tenant_id_invoice_number_key'
  ) THEN
    ALTER TABLE p2_invoices
      ADD CONSTRAINT p2_invoices_tenant_id_invoice_number_key UNIQUE (tenant_id, invoice_number);
  END IF;
END $$;
