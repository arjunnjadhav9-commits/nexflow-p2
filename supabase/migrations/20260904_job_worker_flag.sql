-- Fix 0a — Job worker toggle (prerequisite for all other Sept 4 fixes)
--
-- is_job_worker already exists live in the DB (settings.html's Advanced Settings
-- toggle already reads/writes it, per _ai/CLAUDE.md Step 2F) but no migration file
-- for it exists anywhere in supabase/migrations/ — this is an idempotent safety
-- net so a fresh or out-of-sync environment is never missing the column.
--
-- Run in Supabase SQL Editor as postgres role. Do not use `supabase db push`.

ALTER TABLE p2_tenant_settings
ADD COLUMN IF NOT EXISTS is_job_worker boolean NOT NULL DEFAULT false;
