-- T1 — Guided tutorial engine. Tenant-wide default + per-user per-module progress.
-- Deliberately NOT stored on p2_user_roles: that table has no UPDATE policy
-- (20260904_fix_staff_rls_write_policies.sql:181 — INSERT only, by design),
-- and adding one would open a write path on the column that holds `role`.
-- RLS shape copied from p2_notifications, the reference implementation:
-- three command-scoped policies on get_my_tenant_id(), no DELETE, RLS
-- explicitly enabled in this same migration.
--
-- Run in the Supabase SQL Editor as the postgres role — never `supabase db push`.
-- Confirmed live before writing this: neither p2_tutorial_progress nor
-- p2_tenant_settings.tutorial_mode exist yet (PGRST205 / 42703).
--
-- IMPORTANT — run the live-tenant UPDATE at the bottom of this file in the SAME
-- SQL Editor session as the ALTER/CREATE below, before dispatch.html is deployed.
-- This is one shared database for every tenant (RLS-based multi-tenancy, not
-- separate databases per tenant) — the moment the ALTER TABLE below runs, SS
-- Engineering, Datta Prasad and Shivprasad all get tutorial_mode='auto' by
-- default too. There is no way to scope the DDL itself to the test tenant only;
-- the UPDATE at the bottom is the actual scoping mechanism and must not be
-- deferred to a later session.

ALTER TABLE p2_tenant_settings
  ADD COLUMN IF NOT EXISTS tutorial_mode text NOT NULL DEFAULT 'auto'
    CHECK (tutorial_mode IN ('auto','always','off'));

CREATE TABLE IF NOT EXISTS p2_tutorial_progress (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid NOT NULL,
  user_id          uuid NOT NULL REFERENCES auth.users(id),
  module_id        text NOT NULL,          -- 'dispatch' | 'grn' | …
  status           text NOT NULL DEFAULT 'in_progress'
                     CHECK (status IN ('in_progress','completed','exited')),
  last_step_id     text,
  times_completed  integer NOT NULL DEFAULT 0,
  completed_at     timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, user_id, module_id)
);

ALTER TABLE p2_tutorial_progress ENABLE ROW LEVEL SECURITY;

CREATE POLICY p2_tutorial_progress_select ON p2_tutorial_progress
  FOR SELECT USING (tenant_id = get_my_tenant_id());
CREATE POLICY p2_tutorial_progress_insert ON p2_tutorial_progress
  FOR INSERT WITH CHECK (tenant_id = get_my_tenant_id());
CREATE POLICY p2_tutorial_progress_update ON p2_tutorial_progress
  FOR UPDATE USING (tenant_id = get_my_tenant_id())
             WITH CHECK (tenant_id = get_my_tenant_id());
-- No DELETE policy, deliberately. Same as p2_notifications.

CREATE INDEX IF NOT EXISTS p2_tutorial_progress_tenant_user_idx
  ON p2_tutorial_progress (tenant_id, user_id);

-- tenant_id is passed EXPLICITLY by the client on every insert. No set_tenant_id()
-- trigger is attached to this table — same decision and same reasoning as
-- p2_notifications (CLAUDE.md, Step 4).

-- ── Live-tenant opt-out — run now, in this same session ─────────────────────
-- dispatch.html is one static file served to every tenant from the same
-- deployment; there is no way to ship the tutorial code to the test tenant
-- only. This UPDATE is the real scoping mechanism, not the ALTER/CREATE above.
-- Demo tenant (5f021c96-2ed4-41f8-9fbc-7db517fc840b) deliberately left on
-- 'auto' — the tutorial doubles as a sales demo (see tutorial-engine.md §4.9).
UPDATE p2_tenant_settings SET tutorial_mode = 'off'
  WHERE tenant_id IN (
    '5ab7fb07-2557-42e7-8a8a-5d9fd59048ac', -- SS Engineering
    '3b68db90-a07c-491e-8913-c829ca969620', -- Datta Prasad
    '6fe0680a-c53d-4e4f-b851-308ca905bb3c'  -- Shivprasad
  );

-- Test tenant fe2b94fb-9668-405f-9c62-5f54b32f8c7a keeps the 'auto' default —
-- this is where all interactive verification happens.
