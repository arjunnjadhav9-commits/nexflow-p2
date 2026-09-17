-- A6 — Filing package dispatcher + drain queue.
--
-- Unschedules jobid 9 (filing-package-monthly, 30 2 5 * *) and replaces it
-- with dispatch + drain + monitor x2. This is NOT optional cleanup: the new
-- filing-package-dispatch cron fires at the exact same instant
-- (30 2 5 * * = 02:30 UTC on the 5th) the old cron did. Leaving jobid 9
-- scheduled would mean 5 October runs the old full sequential loop AND the
-- new dispatch+drain queue at the same moment — both calling processTenant()
-- for the same tenants, double Opus calls, double CA emails, racing writes
-- on the same p2_filing_packages row. The mode:'monthly_cron' code path in
-- filing-package/index.ts is untouched and stays reachable by direct
-- invocation, same as action:'generate' already is — only its scheduled
-- trigger is removed.
--
-- Same anon-key-in-header pattern confirmed live for jobid 2/3/8/9 —
-- verify_jwt = false on filing-package, so this header is never validated as
-- a real JWT; SB_SECRET_KEY inside the function is what grants DB access.

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'filing-package-monthly') THEN
    PERFORM cron.unschedule('filing-package-monthly');
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'filing-package-dispatch') THEN
    PERFORM cron.unschedule('filing-package-dispatch');
  END IF;
END $$;

SELECT cron.schedule(
    'filing-package-dispatch',
    '30 2 5 * *',
    $$
    SELECT
      net.http_post(
        url := 'https://jhqxvpihauvhfclosuxn.supabase.co/functions/v1/filing-package',
        headers := '{"Content-Type": "application/json", "Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImpocXh2cGloYXV2aGZjbG9zdXhuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk3ODc5ODksImV4cCI6MjA5NTM2Mzk4OX0.cmDlCVvqeQVWeDvQkPx1dwRD7oLU7Rwy_tE3ef66AOI"}'::jsonb,
        body := '{"mode": "dispatch"}'::jsonb
      ) AS request_id;
    $$
);

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'filing-package-drain') THEN
    PERFORM cron.unschedule('filing-package-drain');
  END IF;
END $$;

SELECT cron.schedule(
    'filing-package-drain',
    '*/2 * 5-7 * *',
    $$
    SELECT
      net.http_post(
        url := 'https://jhqxvpihauvhfclosuxn.supabase.co/functions/v1/filing-package',
        headers := '{"Content-Type": "application/json", "Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImpocXh2cGloYXV2aGZjbG9zdXhuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk3ODc5ODksImV4cCI6MjA5NTM2Mzk4OX0.cmDlCVvqeQVWeDvQkPx1dwRD7oLU7Rwy_tE3ef66AOI"}'::jsonb,
        body := '{"mode": "drain"}'::jsonb
      ) AS request_id;
    $$
);

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'filing-package-monitor-1') THEN
    PERFORM cron.unschedule('filing-package-monitor-1');
  END IF;
END $$;

SELECT cron.schedule(
    'filing-package-monitor-1',
    '30 4 5 * *',
    $$
    SELECT
      net.http_post(
        url := 'https://jhqxvpihauvhfclosuxn.supabase.co/functions/v1/filing-package',
        headers := '{"Content-Type": "application/json", "Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImpocXh2cGloYXV2aGZjbG9zdXhuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk3ODc5ODksImV4cCI6MjA5NTM2Mzk4OX0.cmDlCVvqeQVWeDvQkPx1dwRD7oLU7Rwy_tE3ef66AOI"}'::jsonb,
        body := '{"mode": "monitor", "summary": false}'::jsonb
      ) AS request_id;
    $$
);

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'filing-package-monitor-2') THEN
    PERFORM cron.unschedule('filing-package-monitor-2');
  END IF;
END $$;

SELECT cron.schedule(
    'filing-package-monitor-2',
    '30 8 5 * *',
    $$
    SELECT
      net.http_post(
        url := 'https://jhqxvpihauvhfclosuxn.supabase.co/functions/v1/filing-package',
        headers := '{"Content-Type": "application/json", "Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImpocXh2cGloYXV2aGZjbG9zdXhuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk3ODc5ODksImV4cCI6MjA5NTM2Mzk4OX0.cmDlCVvqeQVWeDvQkPx1dwRD7oLU7Rwy_tE3ef66AOI"}'::jsonb,
        body := '{"mode": "monitor", "summary": true}'::jsonb
      ) AS request_id;
    $$
);
