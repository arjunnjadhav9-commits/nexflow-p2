-- Migration: fix invite-staff flow (Auth Admin API unreachable in this region)
--
-- Replaces the invite-staff Edge Function's dependency on
-- supabaseAdmin.auth.admin.generateLink() (broken: AuthRetryableFetchError on all
-- /auth/v1/admin/* calls in this project's region) with a p2_pending_invites table
-- the Owner can act on manually via the Supabase dashboard.
--
-- Also fixes three pre-existing, currently-live bugs in p2_user_roles /
-- handle_new_user() discovered via read-only inspection while verifying this
-- migration was safe to write (see plan doc for the exact queries run):
--   1. handle_new_user()'s ON CONFLICT (user_id, tenant_id) targets a composite key
--      with no matching unique index (only unique index is the plain PK on user_id).
--      This throws at runtime the moment tenant_id metadata is present, rolling back
--      the whole auth.users insert -- i.e. it was silently guaranteed to break the
--      exact case this whole flow depends on.
--   2. p2_user_roles_role_check only allowed ('owner','staff'), but js/roles.js's
--      RBAC (shipped this session) defines 5 roles. No supervisor/storekeeper/
--      operator/accountant row has ever been able to persist, through any path.
--   3. p2_user_roles has no DELETE policy, so settings.html's removeStaff() has
--      never actually been able to remove anyone (RLS default-deny).

-- 1. Widen role constraint to the live 5-role RBAC (keep 'staff' for the one
--    existing legacy row / js/roles.js's documented legacy fallback).
ALTER TABLE p2_user_roles DROP CONSTRAINT p2_user_roles_role_check;
ALTER TABLE p2_user_roles ADD CONSTRAINT p2_user_roles_role_check
  CHECK (role = ANY (ARRAY['owner','supervisor','storekeeper','operator','accountant','staff']));

-- 2. email column + one-time backfill. Read-only join against auth.users (never
--    writes to it) -- lets settings.html read email directly instead of calling
--    get-user-email, which itself calls the broken admin.getUserById().
ALTER TABLE p2_user_roles ADD COLUMN IF NOT EXISTS email text;

UPDATE p2_user_roles ur SET email = au.email
  FROM auth.users au
  WHERE au.id = ur.user_id AND ur.email IS NULL;

-- 3. Missing DELETE policy -- owner of the tenant can remove any staff row except
--    their own (matches settings.html's existing "(You)" guard, enforced here too).
CREATE POLICY "p2_user_roles_delete_policy" ON p2_user_roles FOR DELETE
  USING (tenant_id = auth.uid() AND user_id <> tenant_id);

-- 4. Fix handle_new_user(): correct ON CONFLICT target, add email to the insert.
--    Rest of the function body is unchanged from the live version.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  IF NEW.raw_user_meta_data->>'tenant_id' IS NOT NULL THEN
    INSERT INTO public.p2_user_roles (user_id, tenant_id, role, email)
    VALUES (
      NEW.id,
      (NEW.raw_user_meta_data->>'tenant_id')::uuid,
      COALESCE(NEW.raw_user_meta_data->>'role', 'staff'),
      NEW.email
    )
    ON CONFLICT (user_id) DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$;

-- 5. Pending invites table -- the record the Owner acts on to finish setup in the
--    Supabase dashboard, and what settings.html's Staff tab renders as "Pending setup".
CREATE TABLE p2_pending_invites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  email text NOT NULL,
  role text NOT NULL,
  invited_by_tenant_id uuid NOT NULL,
  invited_at timestamptz NOT NULL DEFAULT now(),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'cancelled'))
);

ALTER TABLE p2_pending_invites ENABLE ROW LEVEL SECURITY;

-- Single ALL-command policy (same shape as p2_invoices' "tenant_own" policy) --
-- Postgres reuses USING as WITH CHECK when the latter is omitted. Settings is an
-- owner-only route, so auth.uid() === tenant_id for whoever can reach this table.
CREATE POLICY "tenant_own" ON p2_pending_invites
  USING (tenant_id = auth.uid());

-- Prevents duplicate concurrent pending invites for the same person; invite-staff
-- treats a hit here as a resend rather than inserting a second row.
CREATE UNIQUE INDEX p2_pending_invites_tenant_email_pending_idx
  ON p2_pending_invites (tenant_id, lower(email)) WHERE status = 'pending';
