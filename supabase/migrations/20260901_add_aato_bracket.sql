-- AATO (Annual Aggregate Turnover) bracket on p2_tenant_settings, driving the
-- e-invoicing soft-gate warning on invoice generation (all-dispatch-history.html).
-- Nexflow does not generate IRN/e-invoices -- this is advisory only, never
-- blocking. Default 'below_5cr' matches every current client's actual bracket
-- and means the warning banner is silent for them until they explicitly change it.

ALTER TABLE p2_tenant_settings
  ADD COLUMN IF NOT EXISTS aato_bracket text NOT NULL DEFAULT 'below_5cr'
    CHECK (aato_bracket IN ('below_5cr', '5cr_to_10cr', 'above_10cr'));

-- Run this in Supabase SQL Editor as postgres role.
-- Test tenant: fe2b94fb-9668-405f-9c62-5f54b32f8c7a
-- NEVER run against SS Engineering (5ab7fb07), Datta Prasad (3b68db90),
--   Shivprasad (6fe0680a), or Demo (5f021c96).
--
-- This ALTER runs against the whole p2_tenant_settings table (all tenants
-- get the default) -- unavoidable for a schema change, and harmless: every
-- tenant lands on 'below_5cr', the no-warning default, until they change it
-- themselves in Settings.
--
-- After running, verify the test tenant's agent_tier is still 'unlimited'
-- (broad ALTERs on this table have accidentally clobbered it before):
--   SELECT agent_tier FROM p2_tenant_settings
--   WHERE tenant_id = 'fe2b94fb-9668-405f-9c62-5f54b32f8c7a';
