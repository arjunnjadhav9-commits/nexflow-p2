ALTER TABLE p2_tenant_settings
  ADD COLUMN IF NOT EXISTS use_stator_stack_labels boolean NOT NULL DEFAULT false;
