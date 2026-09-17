-- A2 — weekly compliance-scan cron. Same anon-key-in-header pattern
-- confirmed live for jobid 2/3/8/9, filing-package's dispatch/drain/monitor
-- crons, and schema-drift-weekly — verify_jwt = false on compliance-scan, so
-- this header is never validated as a real JWT; SB_SECRET_KEY inside the
-- function is what grants DB access.
--
-- Monday 03:00 UTC = Monday 08:30 IST, per automation-strategy.md §4.2 and
-- _ai/compliance-monitoring.md §8.

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'compliance-scan-weekly') THEN
    PERFORM cron.unschedule('compliance-scan-weekly');
  END IF;
END $$;

SELECT cron.schedule(
    'compliance-scan-weekly',
    '0 3 * * 1',
    $$
    SELECT
      net.http_post(
        url := 'https://jhqxvpihauvhfclosuxn.supabase.co/functions/v1/compliance-scan',
        headers := '{"Content-Type": "application/json", "Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImpocXh2cGloYXV2aGZjbG9zdXhuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk3ODc5ODksImV4cCI6MjA5NTM2Mzk4OX0.cmDlCVvqeQVWeDvQkPx1dwRD7oLU7Rwy_tE3ef66AOI"}'::jsonb,
        body := '{"mode":"weekly_cron"}'::jsonb
      ) AS request_id;
    $$
);

-- Run this in the Supabase SQL Editor as the postgres role — never
-- `supabase db push` (replays old migrations).
