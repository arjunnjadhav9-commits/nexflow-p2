-- Drops the Session 18 challan line-editing RPCs. That approach (arbitrary
-- add/remove of challan lines) is being replaced with a narrower fix scoped
-- to quantity edits only on product dispatches -- see
-- 20260918_edit_product_dispatch_qty.sql. Known Open Items #8 is reopened
-- until that migration lands.
--
-- Apply via Supabase SQL Editor -- never `supabase db push` (replays old
-- migrations).

DROP FUNCTION IF EXISTS add_challan_line(uuid, uuid, uuid, numeric, text, text);
DROP FUNCTION IF EXISTS remove_challan_line(uuid, uuid);
