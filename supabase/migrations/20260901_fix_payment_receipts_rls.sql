-- Fixes the RLS policy on p2_payment_receipts: the single "tenant_own"
-- policy used tenant_id = auth.uid(), which resolves correctly only for
-- the tenant owner. Non-owner staff (supervisor, storekeeper, accountant)
-- authenticate as their own auth.uid(), which is never equal to
-- tenant_id — so every staff request against this table silently returns
-- zero rows / fails its WITH CHECK, with no error surfaced. This is the
-- exact known-broken pattern already documented in CLAUDE.md and already
-- fixed on p2_notifications (20260831_notifications.sql) via
-- get_my_tenant_id(), which resolves both the owner case (auth.uid() IS a
-- p2_tenants.id) and the staff case (looked up via p2_user_roles).
--
-- Mirrors p2_notifications' policy shape exactly: three separate
-- command-scoped policies (SELECT/INSERT/UPDATE), not a single FOR ALL.
-- No DELETE policy — deliberately, same as p2_notifications, so DELETE
-- stays unreachable via RLS (a payment ledger row should not be
-- deletable by anyone through the client).
--
-- NOTE / behavior change: today's single "tenant_own" FOR ALL policy also
-- covers DELETE for the owner (tenant_id = auth.uid() would let an owner
-- delete their own tenant's receipts). Dropping it in favor of the three
-- policies below removes that DELETE capability entirely, for owner and
-- staff alike. Confirmed acceptable — matches the p2_notifications
-- precedent this migration is modeled on.
--
-- Verified against the live pg_policies row before writing this file:
-- policyname=tenant_own, cmd=ALL, qual=(tenant_id = auth.uid()), with_check=null.
--
-- No columns, indexes, or other policies on this table are touched.

DROP POLICY "tenant_own" ON p2_payment_receipts;

CREATE POLICY "payment_receipts_select" ON p2_payment_receipts
  FOR SELECT USING (tenant_id = get_my_tenant_id());

CREATE POLICY "payment_receipts_insert" ON p2_payment_receipts
  FOR INSERT WITH CHECK (tenant_id = get_my_tenant_id());

CREATE POLICY "payment_receipts_update" ON p2_payment_receipts
  FOR UPDATE USING (tenant_id = get_my_tenant_id())
  WITH CHECK (tenant_id = get_my_tenant_id());

-- Run this in Supabase SQL Editor as postgres role.
-- Test tenant: fe2b94fb-9668-405f-9c62-5f54b32f8c7a
-- NEVER run against SS Engineering (5ab7fb07),
--   Datta Prasad (3b68db90), or Shivprasad (6fe0680a).
