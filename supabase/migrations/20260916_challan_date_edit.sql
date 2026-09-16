-- Edit dispatch date on a confirmed challan (owner-only, pre-invoice only).
-- Applied manually via Supabase SQL Editor — never `supabase db push` (replays old migrations).
--
-- Nullable, no default, never backfilled. Stays NULL until the first date edit on a given
-- challan; once set it is never overwritten again (challan.html's saveDispatchDate() uses
-- COALESCE semantics client-side) — always holds the true original date, even across
-- multiple later corrections, so the audit trail shows "what it really was" rather than
-- "what it was one edit ago."

ALTER TABLE p2_dispatch_orders
  ADD COLUMN IF NOT EXISTS original_dispatch_date date;
