-- A6 — resend-webhook bounce detection.
-- ca_email_invalid / accountant_email_invalid: set by resend-webhook on a
-- confirmed bounce/complaint. Deliberately does NOT null the email itself —
-- nulling it would make resolveRecipients() (filing-package/index.ts) skip
-- the tenant silently every month with no visible reason. The flag is
-- cleared by settings.html whenever the owner re-saves that email field.

ALTER TABLE p2_tenant_settings ADD COLUMN ca_email_invalid boolean NOT NULL DEFAULT false;
ALTER TABLE p2_tenant_settings ADD COLUMN accountant_email_invalid boolean NOT NULL DEFAULT false;

-- Live definition read before this change (Sept 17 2026):
-- CHECK ((type = ANY (ARRAY['challan_dispatched','payment_overdue','low_stock','filing_package_ready'])))
-- Widening keeps every existing value and adds exactly one. Per
-- execution-plan.md §10 item 3, any later session widening this same CHECK
-- is responsible for reading its own live definition at that time.
ALTER TABLE p2_notifications DROP CONSTRAINT p2_notifications_type_check;
ALTER TABLE p2_notifications ADD CONSTRAINT p2_notifications_type_check
  CHECK (type IN ('challan_dispatched','payment_overdue','low_stock','filing_package_ready','email_bounced'));
