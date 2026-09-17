-- A8-drift — schema drift guard (automation-strategy.md §4.8, the rowsecurity
-- check only — the full A8 session, with synthetic tests/quota/deployment
-- health, is Phase 4 and not built here).
--
-- pg_tables lives in pg_catalog, which PostgREST does not expose
-- (config.toml api.schemas = ["public", "storage", "graphql_public"]) — so
-- the check is wrapped in a SECURITY DEFINER RPC in public and called via
-- supabase.rpc() from the schema-drift Edge Function, same shape as every
-- other cross-cutting RPC in this codebase (get_principal_vendor_material,
-- get_my_tenant_id, etc). service_role only — this is founder-scoped
-- infrastructure, not tenant data.
CREATE OR REPLACE FUNCTION public.get_tables_with_rls_disabled()
RETURNS TABLE(tablename text)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
  SELECT pg_tables.tablename::text
  FROM pg_tables
  WHERE schemaname = 'public'
    AND tablename LIKE 'p2\_%'
    AND NOT rowsecurity;
$$;

GRANT EXECUTE ON FUNCTION public.get_tables_with_rls_disabled() TO service_role;

-- Run this in the Supabase SQL Editor as the postgres role — never
-- `supabase db push` (replays old migrations).
