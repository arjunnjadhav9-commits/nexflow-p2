-- Phase 2 (KPML Principal Dashboard) — cross-tenant scoped access link table.
--
-- Brings forward the load-bearing part of _ai/kpml-network-plan.md Step 6
-- ("cross-tenant upgrade" — see §10.5 "Principal visibility isolation" and §17
-- "Cross-tenant access: SECURITY DEFINER RPCs only, never open RLS"). The
-- read-only principal dashboard requires this table now; the plan's own
-- precedent (Phase 3 shipping before Phase 2 completes) already treats
-- phase/step numbering as non-binding when a dependency forces reordering.
--
-- Deliberately minimal for this phase: no self-serve consent/revocation UI on
-- either side yet (that stays Step 6). Rows are inserted by hand (postgres
-- role) only — see the production-linking checkpoint in the Phase 2 plan.
--
-- Run in Supabase SQL Editor as postgres role. Do not use `supabase db push`.

CREATE TABLE p2_network_links (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  principal_tenant_id uuid NOT NULL REFERENCES p2_tenants(id),
  vendor_tenant_id    uuid NOT NULL REFERENCES p2_tenants(id),
  status              text NOT NULL DEFAULT 'active' CHECK (status IN ('active','revoked')),
  granted_at          timestamptz NOT NULL DEFAULT now(),
  revoked_at          timestamptz,
  UNIQUE (principal_tenant_id, vendor_tenant_id)
);

ALTER TABLE p2_network_links ENABLE ROW LEVEL SECURITY;

-- Either side of the link may read it — a vendor being able to see who has an
-- active link to them is Step 6 groundwork and costs nothing to allow now.
-- No INSERT/UPDATE/DELETE policy for `authenticated` in this phase: rows are
-- written directly via the SQL Editor (postgres role bypasses RLS), never
-- from the browser. Self-serve consent/revocation is Step 6.
CREATE POLICY p2_network_links_select_policy
  ON p2_network_links
  FOR SELECT
  USING (
    principal_tenant_id = get_my_tenant_id()
    OR vendor_tenant_id = get_my_tenant_id()
  );
