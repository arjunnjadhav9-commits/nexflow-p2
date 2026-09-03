-- Step 3.5: Supplier Advance Ledger
-- Lump-sum advance payments to suppliers, drawn down by GRNs.
-- Append-only: no DELETE policy, no soft-delete column.

CREATE TABLE p2_supplier_advances (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES p2_tenants(id),
  supplier_id uuid NOT NULL REFERENCES p2_suppliers(id),
  payment_date date NOT NULL,
  amount numeric(12,2) NOT NULL CHECK (amount > 0),
  reference_no text,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE p2_supplier_advances ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tenant_own_select" ON p2_supplier_advances
  FOR SELECT USING (tenant_id = get_my_tenant_id());
CREATE POLICY "tenant_own_insert" ON p2_supplier_advances
  FOR INSERT WITH CHECK (tenant_id = get_my_tenant_id());
CREATE POLICY "tenant_own_update" ON p2_supplier_advances
  FOR UPDATE USING (tenant_id = get_my_tenant_id());

CREATE INDEX idx_supplier_advances_tenant_supplier
  ON p2_supplier_advances(tenant_id, supplier_id);

-- Balance view — total advanced, total drawn (own-material GRNs only),
-- and the running balance per supplier.
--
-- Pre-aggregated per side (advances, GRNs) then combined on
-- (tenant_id, supplier_id) — NOT a direct LEFT JOIN between the two
-- raw tables, which would fan out into a cartesian product (N advances
-- x M GRN rows) and inflate both sums.
--
-- security_invoker = true: a Postgres view otherwise runs underlying-table
-- access checks with the VIEW OWNER's privileges (on Supabase, the
-- postgres/service role), which can silently bypass RLS on
-- p2_supplier_advances and p2_stock_transactions for every querying
-- tenant. This forces RLS to evaluate as the actual invoking user.
--
-- Every subquery is ALSO explicitly filtered on tenant_id = get_my_tenant_id()
-- rather than relying purely on security_invoker + the underlying tables'
-- own RLS. Confirmed live: p2_stock_transactions has a CREATE POLICY
-- ("staff_tenant_access", 20260803_staff_rls_fix.sql) but RLS was never
-- actually enabled on that table (no ENABLE ROW LEVEL SECURITY was ever
-- run for it), so the policy was silently inert and every tenant's GRN
-- rows were readable through this view. The explicit filters here make
-- this view correct independent of that table's RLS state.
CREATE VIEW v_p2_supplier_advance_balance
WITH (security_invoker = true) AS
SELECT
  s.tenant_id,
  s.supplier_id,
  COALESCE(adv.total_advanced, 0) AS total_advanced,
  COALESCE(grn.total_drawn, 0)    AS total_drawn,
  COALESCE(adv.total_advanced, 0) - COALESCE(grn.total_drawn, 0) AS balance
FROM (
  SELECT tenant_id, supplier_id FROM p2_supplier_advances
  WHERE tenant_id = get_my_tenant_id()
  UNION
  SELECT tenant_id, supplier_id FROM p2_stock_transactions
  WHERE transaction_type = 'grn'
    AND rate IS NOT NULL
    AND owned_by IS NULL
    AND tenant_id = get_my_tenant_id()
) s
LEFT JOIN (
  SELECT tenant_id, supplier_id, SUM(amount) AS total_advanced
  FROM p2_supplier_advances
  WHERE tenant_id = get_my_tenant_id()
  GROUP BY tenant_id, supplier_id
) adv ON adv.tenant_id = s.tenant_id AND adv.supplier_id = s.supplier_id
LEFT JOIN (
  SELECT tenant_id, supplier_id, SUM(quantity * rate) AS total_drawn
  FROM p2_stock_transactions
  WHERE transaction_type = 'grn'
    AND rate IS NOT NULL
    AND owned_by IS NULL
    AND tenant_id = get_my_tenant_id()
  GROUP BY tenant_id, supplier_id
) grn ON grn.tenant_id = s.tenant_id AND grn.supplier_id = s.supplier_id;
