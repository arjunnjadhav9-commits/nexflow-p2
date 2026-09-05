-- Fix 2 — v_p2_stock_balance_by_owner: exposes owned_by as an output column,
-- unlike v_p2_stock_balance which hard-filters owned_by IS NULL by design
-- (see _ai/CLAUDE.md — that view is deliberately left untouched). Powers the
-- pool tabs (All / Own Stock / [Principal]) on index.html, gated behind
-- isJobWorker().
--
-- DEPENDS ON 20260904_uqc_codes.sql having already been run — this view
-- selects rm.uqc, which that migration adds to p2_raw_materials. Run that
-- migration first if it hasn't been applied yet.
--
-- Deviation from the original spec: rm.material_code is added to the SELECT/
-- GROUP BY (not in the original column list). Without it, index.html's
-- existing "Code" column would silently go blank for every row rendered from
-- this view — a visible regression versus v_p2_stock_balance, which does
-- carry material_code. Same materials, same code, so this is purely additive.
--
-- Run in Supabase SQL Editor as postgres role. Do not use `supabase db push`.

CREATE VIEW v_p2_stock_balance_by_owner
WITH (security_invoker = true) AS
SELECT
  t.tenant_id,
  t.raw_material_id,
  t.owned_by,
  c.name AS owner_name,
  rm.name AS material_name,
  rm.material_code,
  rm.unit,
  rm.uqc,
  rm.min_stock_level,
  SUM(t.quantity) AS current_stock
FROM p2_stock_transactions t
JOIN p2_raw_materials rm ON rm.id = t.raw_material_id AND rm.tenant_id = t.tenant_id
LEFT JOIN p2_clients c ON c.id = t.owned_by AND c.tenant_id = t.tenant_id
WHERE t.tenant_id = get_my_tenant_id()
GROUP BY t.tenant_id, t.raw_material_id, t.owned_by, c.name, rm.name, rm.material_code, rm.unit, rm.uqc, rm.min_stock_level
HAVING SUM(t.quantity) != 0;
