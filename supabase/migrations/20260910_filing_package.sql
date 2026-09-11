-- E2 — Monthly AI Filing Package, Part 1
-- New p2_filing_packages table (one row per tenant per month), three new
-- p2_tenant_settings columns for recipient configuration, 'filing_package_ready'
-- added to p2_notifications.type, and the private 'filing-packages' Storage
-- bucket. Apply via Supabase SQL Editor only — never `supabase db push`
-- (replays every earlier migration against a project that was never bootstrapped
-- from migration 0001).

-- ── p2_filing_packages ───────────────────────────────────────────────────────
CREATE TABLE p2_filing_packages (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id              uuid NOT NULL REFERENCES p2_tenants(id),
  period_month           text NOT NULL, -- 'YYYY-MM'
  status                 text NOT NULL DEFAULT 'pending'
                           CHECK (status IN ('pending','generating','uploaded','emailed','failed')),
  storage_path           text,
  signed_url             text,
  signed_url_expires_at  timestamptz,
  error_reason           text,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE p2_filing_packages ENABLE ROW LEVEL SECURITY;

-- get_my_tenant_id() pattern (not auth.uid()) — same reference implementation
-- as p2_notifications (20260831_notifications.sql). Three command-scoped
-- policies, no DELETE policy — this table is an append/update-only audit
-- trail of what was generated and sent.
CREATE POLICY "filing_packages_select" ON p2_filing_packages
  FOR SELECT USING (tenant_id = get_my_tenant_id());

CREATE POLICY "filing_packages_insert" ON p2_filing_packages
  FOR INSERT WITH CHECK (tenant_id = get_my_tenant_id());

CREATE POLICY "filing_packages_update" ON p2_filing_packages
  FOR UPDATE USING (tenant_id = get_my_tenant_id())
  WITH CHECK (tenant_id = get_my_tenant_id());

-- One package per tenant per month.
CREATE UNIQUE INDEX idx_p2_filing_packages_tenant_period
  ON p2_filing_packages (tenant_id, period_month);

-- ── p2_tenant_settings — recipient configuration ────────────────────────────
ALTER TABLE p2_tenant_settings
  ADD COLUMN IF NOT EXISTS filing_recipient text NOT NULL DEFAULT 'ca_only'
    CHECK (filing_recipient IN ('ca_only','accountant_only','both'));

ALTER TABLE p2_tenant_settings
  ADD COLUMN IF NOT EXISTS accountant_email text;

ALTER TABLE p2_tenant_settings
  ADD COLUMN IF NOT EXISTS filing_package_enabled boolean NOT NULL DEFAULT true;

-- ── p2_notifications — new notification type ────────────────────────────────
-- Constraint was declared inline/unnamed on the original CREATE TABLE
-- (20260831_notifications.sql:17), so Postgres auto-named it
-- p2_notifications_type_check. Confirmed via schema inspection before writing
-- this ALTER.
ALTER TABLE p2_notifications DROP CONSTRAINT p2_notifications_type_check;
ALTER TABLE p2_notifications ADD CONSTRAINT p2_notifications_type_check
  CHECK (type IN ('challan_dispatched','payment_overdue','low_stock','filing_package_ready'));

-- ── Storage bucket ───────────────────────────────────────────────────────────
-- Private — signed URLs only, never public. No storage RLS policies needed:
-- every write goes through the filing-package Edge Function's service-role
-- client (bypasses RLS entirely), and every read is via a pre-signed URL
-- handed out by that same service-role client. No end user ever addresses
-- this bucket directly with the anon key.
INSERT INTO storage.buckets (id, name, public)
VALUES ('filing-packages', 'filing-packages', false)
ON CONFLICT (id) DO NOTHING;
