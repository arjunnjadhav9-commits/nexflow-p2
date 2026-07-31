ALTER TABLE p2_tenant_settings
  ADD COLUMN IF NOT EXISTS invoice_sequence integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS bank_name text,
  ADD COLUMN IF NOT EXISTS bank_account text,
  ADD COLUMN IF NOT EXISTS bank_ifsc text;
