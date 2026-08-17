-- Fixes a race in the consolidated-invoice duplicate check (agent-query's
-- sendInvoiceConsolidated/confirmConsolidatedInvoice): both functions guard
-- against re-billing the same client/period with a plain SELECT-then-insert
-- check, but per the comment on p2_invoices_dispatch_order_id_idx (added in
-- 20260730_create_invoices_table.sql), consolidated rows have
-- dispatch_order_id IS NULL, so that unique index provides no protection for
-- them — their dedup was application-code-only, with no DB constraint behind
-- it. Two near-simultaneous requests for the same client/period could both
-- pass the check before either inserted, producing two invoices (two
-- invoice numbers, two emails) for the same billing period.
--
-- If this fails with a uniqueness violation on existing data, there are
-- already duplicate consolidated invoices for some tenant/client/period —
-- find and resolve those (e.g. cancel/merge the extras) before re-running.

CREATE UNIQUE INDEX p2_invoices_consolidated_dedup_idx
  ON p2_invoices (tenant_id, client_id, date_from, date_to)
  WHERE invoice_mode = 'consolidated';
