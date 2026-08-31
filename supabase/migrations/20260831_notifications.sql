-- Step 4 — Notifications (Phase 1)
-- Telegram deep-link binding token + quiet hours on p2_tenant_settings,
-- new p2_notifications table with RLS via get_my_tenant_id() (not auth.uid() —
-- that pattern is already known-broken for staff on p2_payment_receipts).

ALTER TABLE p2_tenant_settings
  ADD COLUMN IF NOT EXISTS telegram_bind_token uuid DEFAULT NULL;

-- Quiet hours: IST hour 0-23. Both NULL = disabled (default: always deliver).
ALTER TABLE p2_tenant_settings
  ADD COLUMN IF NOT EXISTS quiet_hours_start smallint DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS quiet_hours_end smallint DEFAULT NULL;

CREATE TABLE p2_notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES p2_tenants(id),
  type text NOT NULL CHECK (type IN ('challan_dispatched', 'payment_overdue', 'low_stock')),
  title text NOT NULL,
  body text NOT NULL,
  metadata jsonb DEFAULT '{}',
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'sent', 'failed')),
  error_reason text DEFAULT NULL,
  read_at timestamptz DEFAULT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE p2_notifications ENABLE ROW LEVEL SECURITY;

-- get_my_tenant_id() (defined in 20260803_staff_rls_fix.sql) resolves both the
-- owner case (auth.uid() IS a p2_tenants.id) and the staff case (looked up via
-- p2_user_roles) in one place — same pattern as p2_wip_transactions. Deliberately
-- NOT tenant_id = auth.uid(): that pattern is already live (and known-broken for
-- non-owner staff) on p2_payment_receipts.
--
-- Three separate command-scoped policies (not FOR ALL) so DELETE stays
-- unreachable — no DELETE policy exists anywhere below, per spec.
CREATE POLICY "notifications_select" ON p2_notifications
  FOR SELECT USING (tenant_id = get_my_tenant_id());

CREATE POLICY "notifications_insert" ON p2_notifications
  FOR INSERT WITH CHECK (tenant_id = get_my_tenant_id());

CREATE POLICY "notifications_update" ON p2_notifications
  FOR UPDATE USING (tenant_id = get_my_tenant_id())
  WITH CHECK (tenant_id = get_my_tenant_id());

CREATE INDEX idx_p2_notifications_tenant_created
  ON p2_notifications (tenant_id, created_at DESC);

CREATE INDEX idx_p2_notifications_unread
  ON p2_notifications (tenant_id, read_at) WHERE read_at IS NULL;
