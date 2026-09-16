-- GRN Correction Flow — auditable field corrections on p2_stock_transactions
-- GRN rows, plus the two schema gaps needed to support it.
-- Applied manually via Supabase SQL Editor — never `supabase db push` (replays old migrations).
-- Test tenant only first: fe2b94fb-9668-405f-9c62-5f54b32f8c7a

-- ─────────────────────────────────────────────────────────────────────────
-- 1. Per-GRN-line GST rate override. NULL means "use the material's own
-- gst_rate" (p2_raw_materials.gst_rate, shared across every GRN of that
-- material) — a non-null value here overrides it for this one line only.
-- Nullable, no default, never backfilled. Written only by a correction —
-- grn.html's own submission path never sets this column.
-- ─────────────────────────────────────────────────────────────────────────
ALTER TABLE p2_stock_transactions
  ADD COLUMN IF NOT EXISTS gst_rate numeric;

-- ─────────────────────────────────────────────────────────────────────────
-- 2. Manual, owner-set "filed through" date. Corrections are blocked for any
-- GRN dated on or before this date. Real enforcement from actual GSTR-2B
-- reconciliation data waits for Session 25 (_ai/gstr2b-server-storage.md);
-- this is a deliberately simple manual gate until then.
-- ─────────────────────────────────────────────────────────────────────────
ALTER TABLE p2_tenant_settings
  ADD COLUMN IF NOT EXISTS gstr2b_filed_through date;

-- ─────────────────────────────────────────────────────────────────────────
-- 3. p2_grn_corrections — immutable audit log, modeled directly on
-- p2_cancelled_challans (20260901_cancelled_challan_log.sql). One row per
-- (original_grn_id, field_name) correction. Quantity corrections never
-- touch this row's own transaction_date field — the compensating adjustment
-- row (inserted separately by the app) carries the date; this table only
-- ever records what changed and why.
--
-- No original_transaction_date column for the date-guard's "true original" —
-- derived at read time from the oldest field_name = 'date' correction row for
-- a given original_grn_id (its old_value), falling back to the row's current
-- transaction_date when no correction exists yet. Same idiom as challan.html's
-- original_dispatch_date (20260916_challan_date_edit.sql) without a redundant
-- column, since this table already records every prior value.
-- ─────────────────────────────────────────────────────────────────────────
CREATE TABLE p2_grn_corrections (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  original_grn_id  uuid NOT NULL REFERENCES p2_stock_transactions(id),
  tenant_id        uuid NOT NULL,
  corrected_by     uuid REFERENCES auth.users(id),
  corrected_at     timestamptz NOT NULL DEFAULT now(),
  field_name       text NOT NULL CHECK (field_name IN
                     ('invoice_no','rate','quantity','supplier','gst_rate','date')),
  old_value        text,
  new_value        text,
  reason           text NOT NULL,
  created_at       timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE p2_grn_corrections ENABLE ROW LEVEL SECURITY;

-- get_my_tenant_id(), NOT auth.uid() — the auth.uid() pattern is documented
-- as broken for non-owner staff (p2_payment_receipts, pre-fix). SELECT +
-- INSERT only, no UPDATE/DELETE policy at all — same immutability-by-omission
-- as p2_cancelled_challans.
CREATE POLICY "grn_corrections_select" ON p2_grn_corrections
  FOR SELECT USING (tenant_id = get_my_tenant_id());

CREATE POLICY "grn_corrections_insert" ON p2_grn_corrections
  FOR INSERT WITH CHECK (tenant_id = get_my_tenant_id());

CREATE INDEX idx_p2_grn_corrections_grn ON p2_grn_corrections (original_grn_id);
CREATE INDEX idx_p2_grn_corrections_tenant_date ON p2_grn_corrections (tenant_id, corrected_at DESC);

-- p2_stock_transactions already has a FOR ALL ... USING (tenant_id =
-- get_my_tenant_id()) policy (20260803_staff_rls_fix.sql), so no RLS change
-- is needed there to allow the in-place field updates or the compensating-
-- row insert this feature performs.

-- ─────────────────────────────────────────────────────────────────────────
-- Verification (test tenant only, fe2b94fb-9668-405f-9c62-5f54b32f8c7a):
--   SELECT column_name FROM information_schema.columns
--     WHERE table_name = 'p2_stock_transactions' AND column_name = 'gst_rate';
--   SELECT column_name FROM information_schema.columns
--     WHERE table_name = 'p2_tenant_settings' AND column_name = 'gstr2b_filed_through';
--   SELECT * FROM p2_grn_corrections LIMIT 1; -- should return zero rows, no error
--   SELECT tablename, policyname FROM pg_policies WHERE tablename = 'p2_grn_corrections';
--     -- should show exactly grn_corrections_select, grn_corrections_insert
-- ─────────────────────────────────────────────────────────────────────────
