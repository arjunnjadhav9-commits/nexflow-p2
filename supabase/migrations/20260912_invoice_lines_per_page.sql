-- Adds the "Max Lines Per Invoice" tenant setting (settings.html, Challan Settings
-- tab). Nullable, no default — blank/NULL means no limit (single consolidated
-- invoice always), matching the existing behaviour for every tenant that hasn't set
-- one. When set, invoices.html auto-splits a consolidated invoice sweep exceeding
-- this many line items into multiple invoices (see confirmConsolidatedInvoice's
-- consolidated_batch_seq change in the companion migration
-- 20260912_consolidated_invoice_batch_seq.sql — apply that one too).

ALTER TABLE p2_tenant_settings
  ADD COLUMN IF NOT EXISTS invoice_lines_per_page integer;
