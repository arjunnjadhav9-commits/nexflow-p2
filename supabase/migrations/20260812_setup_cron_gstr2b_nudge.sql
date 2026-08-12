-- Migration: Set up pg_cron job for the monthly GSTR-2B nudge
-- Date: 2026-08-12
-- Purpose: On the 15th of every month, remind tenants with the AI agent
-- enabled to upload this month's GSTR-2B JSON and run reconciliation
-- before filing GSTR-3B. Reuses the check-low-stock Edge Function via a
-- `mode` flag in the POST body (see sendGstr2bNudge in that function) —
-- no new Edge Function deployed just for a fixed reminder message.

CREATE EXTENSION IF NOT EXISTS pg_cron;

-- Remove existing job if it exists (for idempotency) — cron.unschedule errors
-- if the job doesn't already exist, so guard it with an existence check.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'gstr2b-nudge-monthly') THEN
    PERFORM cron.unschedule('gstr2b-nudge-monthly');
  END IF;
END $$;

-- Schedule the job to run at 2:30 AM UTC (8:00 AM IST) on the 15th of every month
SELECT cron.schedule(
    'gstr2b-nudge-monthly',                     -- Job name
    '30 2 15 * *',                               -- Cron schedule: 2:30 AM UTC on the 15th
    $$
    SELECT
      net.http_post(
        url := 'https://nexflow-p2.supabase.co/functions/v1/check-low-stock',
        headers := '{"Content-Type": "application/json", "Authorization": "Bearer YOUR_ANON_KEY"}'::jsonb,
        body := '{"mode": "gstr2b_nudge"}'::jsonb
      ) AS request_id;
    $$
);

-- Before running this in the SQL Editor, replace YOUR_ANON_KEY above with the
-- project's actual anon public key (Supabase Dashboard -> Project Settings ->
-- API -> anon public — same value already hardcoded as SUPABASE_ANON_KEY in
-- js/supabase-client.js). check-low-stock has verify_jwt = false in
-- config.toml, so this header isn't validated as a real JWT — it's the same
-- pattern the live jobid 2 cron already uses, confirmed by reading the live
-- cron.job table directly (the checked-in 20260526_setup_cron_low_stock.sql
-- migration's current_setting('app.settings.service_role_key') reference does
-- NOT reflect how jobid 2 actually runs — that Postgres setting isn't
-- configured in this project).
