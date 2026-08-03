-- Fix: a non-owner staff member (e.g. role='supervisor') could not read
-- their own p2_user_roles row.
--
-- fetchUserRole() in js/auth.js queries this table filtered by
-- user_id = <them> AND tenant_id = <owner>. The table's original SELECT
-- policy (created outside this repo's migrations, likely via the dashboard)
-- is scoped to tenant_id = auth.uid() -- true only for the owner, whose own
-- auth id doubles as tenant_id. For a staff member, auth.uid() = their own
-- user_id, which never equals tenant_id, so RLS silently returns zero rows.
-- .single() then errors (PGRST116, "no rows returned"), data is null, and
-- fetchUserRole() defaults to 'storekeeper' regardless of the real DB role --
-- this is why a supervisor was ending up with storekeeper-level access.
--
-- Adding this as a second permissive SELECT policy is safe regardless of
-- what the existing one covers -- Postgres ORs multiple permissive policies
-- for the same command together, so this can only widen a user's own read
-- access to their own row, never narrow anything.
CREATE POLICY "p2_user_roles_select_own_row" ON p2_user_roles FOR SELECT
  USING (user_id = auth.uid());
