-- Fix 2 — parent_challan_id: link returns to original challans.
-- ITC-04 Table 5 columns 2-3 require the principal's original challan
-- number and date on every return row. A return challan can settle
-- several outward challans partially, so this is a link table with a
-- quantity rather than a single FK on p2_dispatch_orders
-- (_ai/compliance-and-field-report.md §1.2, §3.4).
--
-- RLS via get_my_tenant_id() — no auth.uid() anywhere, matching every
-- other table added since 20260803_staff_rls_fix.sql.
--
-- Run in Supabase SQL Editor as postgres role. Do not use `supabase db push`
-- (it replays old migrations against this project).

CREATE TABLE p2_challan_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES p2_tenants(id),
  return_dispatch_id uuid NOT NULL REFERENCES p2_dispatch_orders(id),
  original_dispatch_id uuid NOT NULL REFERENCES p2_dispatch_orders(id),
  quantity_settled numeric(12,3) NOT NULL CHECK (quantity_settled > 0),
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT no_self_link CHECK (return_dispatch_id != original_dispatch_id)
);

ALTER TABLE p2_challan_links ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tenant_own" ON p2_challan_links
FOR ALL
USING (tenant_id = get_my_tenant_id())
WITH CHECK (tenant_id = get_my_tenant_id());

CREATE INDEX idx_challan_links_return ON p2_challan_links(tenant_id, return_dispatch_id);
CREATE INDEX idx_challan_links_original ON p2_challan_links(tenant_id, original_dispatch_id);
