-- E2 — Monthly AI Filing Package, Part 1
-- New cron: 8:00 AM IST (2:30 UTC) on the 5th of each month, calling the new
-- filing-package Edge Function for the month just ended. Same anon-key-in-
-- header pattern confirmed live for jobid 2/3/8 — filing-package has
-- verify_jwt = false, so this header is never validated as a real JWT;
-- SB_SECRET_KEY inside the function itself is what grants DB/Storage access.

CREATE EXTENSION IF NOT EXISTS pg_cron;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'filing-package-monthly') THEN
    PERFORM cron.unschedule('filing-package-monthly');
  END IF;
END $$;

SELECT cron.schedule(
    'filing-package-monthly',
    '30 2 5 * *',
    $$
    SELECT
      net.http_post(
        url := 'https://jhqxvpihauvhfclosuxn.supabase.co/functions/v1/filing-package',
        headers := '{"Content-Type": "application/json", "Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImpocXh2cGloYXV2aGZjbG9zdXhuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk3ODc5ODksImV4cCI6MjA5NTM2Mzk4OX0.cmDlCVvqeQVWeDvQkPx1dwRD7oLU7Rwy_tE3ef66AOI"}'::jsonb,
        body := '{"mode": "monthly_cron"}'::jsonb
      ) AS request_id;
    $$
);
