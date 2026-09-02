-- Add a real legal invoice_date to p2_invoices.
--
-- Previously the view/PDF used created_at (aliased as invoice_date) -- a UTC DB
-- insert timestamp, not a legal invoice date. Affects GSTR-1 period, CA export,
-- Table 12 filter, 43B(h) clock, and payment overdue cron.
--
-- IMPORTANT: column is added nullable first, then backfilled, then locked down.
-- Adding it directly as `NOT NULL DEFAULT (now() AT TIME ZONE 'Asia/Kolkata')::date`
-- would make Postgres backfill every EXISTING row with TODAY's date at ALTER time
-- (the DEFAULT applies to pre-existing rows too), silently corrupting every
-- historical invoice's date before the backfill UPDATE below ever runs.
--
-- Backfill source: created_at converted to IST calendar date -- same value the
-- app has always displayed as "the invoice date" up to now, so this is
-- value-preserving for every existing invoice (no drift from what was already
-- shown/emailed).

ALTER TABLE p2_invoices ADD COLUMN IF NOT EXISTS invoice_date date;

UPDATE p2_invoices
SET invoice_date = (created_at AT TIME ZONE 'Asia/Kolkata')::date
WHERE invoice_date IS NULL;

ALTER TABLE p2_invoices
  ALTER COLUMN invoice_date SET DEFAULT (now() AT TIME ZONE 'Asia/Kolkata')::date;

ALTER TABLE p2_invoices
  ALTER COLUMN invoice_date SET NOT NULL;

-- Run this in Supabase SQL Editor as postgres role.
-- Test tenant: fe2b94fb-9668-405f-9c62-5f54b32f8c7a
-- NEVER run against SS Engineering (5ab7fb07), Datta Prasad (3b68db90),
--   Shivprasad (6fe0680a), or Demo (5f021c96) -- this ALTER runs against the
--   whole table (all tenants), which is unavoidable for a schema change, but
--   verify no other write is bundled with it.
