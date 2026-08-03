-- get_my_role: SECURITY DEFINER, bypasses RLS entirely. Direct SELECTs
-- against p2_user_roles from a non-owner session hit infinite recursion --
-- a policy on that table subqueries the table itself to check the caller's
-- role, and RLS re-evaluates that same policy set to satisfy the subquery,
-- looping forever. This function sidesteps RLS instead of trying to fix the
-- recursive policy expression.
--
-- Scoped to auth.uid() internally (not a passed-in user id) so a caller can
-- only ever read their own role for a given tenant, never anyone else's --
-- SECURITY DEFINER widens what the function can read, not what the caller
-- can ask it for.
CREATE OR REPLACE FUNCTION public.get_my_role(p_tenant_id uuid)
RETURNS text
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT role FROM p2_user_roles
  WHERE user_id = auth.uid() AND tenant_id = p_tenant_id
  LIMIT 1;
$$;

GRANT EXECUTE ON FUNCTION public.get_my_role(uuid) TO authenticated;
