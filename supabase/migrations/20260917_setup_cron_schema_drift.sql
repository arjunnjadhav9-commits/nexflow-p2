-- A8-drift — weekly schema-drift cron. Same anon-key-in-header pattern
-- confirmed live for jobid 2/3/8/9 and filing-package's dispatch/drain/
-- monitor crons — verify_jwt = false on schema-drift, so this header is
-- never validated as a real JWT; SB_SECRET_KEY inside the function is what
-- grants DB access.
--
-- Sunday 08:00 IST (30 2 * * 0) — matches the "schema-drift-weekly" cron
-- name automation-strategy.md §4.8 already specifies.

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'schema-drift-weekly') THEN
    PERFORM cron.unschedule('schema-drift-weekly');
  END IF;
END $$;

SELECT cron.schedule(
    'schema-drift-weekly',
    '30 2 * * 0',
    $$
    SELECT
      net.http_post(
        url := 'https://jhqxvpihauvhfclosuxn.supabase.co/functions/v1/schema-drift',
        headers := '{"Content-Type": "application/json", "Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImpocXh2cGloYXV2aGZjbG9zdXhuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk3ODc5ODksImV4cCI6MjA5NTM2Mzk4OX0.cmDlCVvqeQVWeDvQkPx1dwRD7oLU7Rwy_tE3ef66AOI"}'::jsonb,
        body := '{}'::jsonb
      ) AS request_id;
    $$
);

-- Run this in the Supabase SQL Editor as the postgres role — never
-- `supabase db push` (replays old migrations).
