-- Lets a large consolidated invoice sweep be auto-split into multiple invoices
-- (invoices.html "Max Lines Per Invoice" setting) by adding a disambiguator to the
-- consolidated-invoice dedup key.
--
-- p2_invoices_consolidated_dedup_idx (20260817_invoice_consolidated_dedup_index.sql)
-- is a hard unique index on (tenant_id, client_id, date_from, date_to) for
-- invoice_mode='consolidated'. It has to stay a hard DB constraint (it exists to
-- close a real race condition — see that migration's own comment), but as written it
-- also makes it impossible for two DISTINCT invoices (one per split batch) to share
-- the same client + exact date range, which is exactly what the split feature needs.
--
-- Fix: add consolidated_batch_seq (0 = normal/unsplit invoice — every existing row
-- backfills to this via DEFAULT, so today's one-invoice-per-range rule is completely
-- unchanged for every pre-existing and every future non-split invoice; 1..N = a split
-- batch's sequence number, written by confirmConsolidatedInvoice in
-- supabase/functions/agent-query/index.ts). Replace the index to include it, so a
-- retry of ONE batch is still idempotent (same tenant/client/range/batch_seq = same
-- row) while different batches of the same range can coexist.
--
-- IMPORTANT — deployment order: apply this migration BEFORE (or atomically with)
-- deploying the updated agent-query Edge Function. The function reads/writes
-- consolidated_batch_seq unconditionally; deploying it against a DB that doesn't yet
-- have the column will break every consolidated invoice confirm (split or not) with
-- an "unknown column" error until this migration runs.
--
-- Known, accepted, out-of-scope gap: this does NOT protect against re-running the
-- exact same date range for a client after changing the lines-per-page limit (e.g. an
-- existing batch_seq=0 invoice, then later split into batch_seq=1..N covering
-- overlapping dispatches) — same class of gap as Known Open Item #6 in _ai/CLAUDE.md
-- (overlapping consolidated date ranges aren't cross-checked). Void/cancel the
-- original invoice before re-running a range whose limit has changed.

ALTER TABLE p2_invoices
  ADD COLUMN IF NOT EXISTS consolidated_batch_seq integer NOT NULL DEFAULT 0;

DROP INDEX IF EXISTS p2_invoices_consolidated_dedup_idx;

CREATE UNIQUE INDEX p2_invoices_consolidated_dedup_idx
  ON p2_invoices (tenant_id, client_id, date_from, date_to, consolidated_batch_seq)
  WHERE invoice_mode = 'consolidated';
