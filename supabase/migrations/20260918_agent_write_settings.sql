-- W2 — agent write layer plan/meter gate columns on p2_tenant_settings.
-- agent_write_enabled defaults false, including for existing Pro/Founder tenants —
-- the write layer is opt-in per tenant, switched on by the owner after reading what
-- it does. Defaulting it on would activate a write path on three live production
-- tenants the moment this migration runs. Schema per _ai/nexflow-agent.md §8.2, verbatim.
ALTER TABLE p2_tenant_settings
  ADD COLUMN IF NOT EXISTS agent_write_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS agent_writes_this_month integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS agent_writes_reset_month text;   -- 'YYYY-MM', IST
