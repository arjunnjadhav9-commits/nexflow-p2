-- Fix 1 — Principal pool inbound path on GRN
--
-- grn.html currently records every GRN as owned_by = NULL (own stock) with no
-- way to record material that physically arrived but belongs to a principal
-- (e.g. KPML). These two columns capture the principal's own delivery
-- document reference, set only when a GRN row is attributed to a principal's
-- pool (grn.html's new Material Owner selector, gated behind isJobWorker()).
--
-- Run in Supabase SQL Editor as postgres role. Do not use `supabase db push`.

ALTER TABLE p2_stock_transactions
ADD COLUMN IF NOT EXISTS principal_challan_no text,
ADD COLUMN IF NOT EXISTS principal_challan_date date;
