-- Step 4 — Notifications (Phase 6)
-- New cron: daily 9AM IST (4:00 UTC) call to check-low-stock's new
-- payment_overdue_notify mode. Additive — does not touch jobid 2
-- (check-low-stock-daily) or jobid 3 (gstr2b-nudge-monthly).
-- Anon key in the Authorization header, same pattern confirmed live for
-- jobid 2/3 — check-low-stock has verify_jwt = false, so this header is
-- never validated as a real JWT; SUPABASE_SERVICE_ROLE_KEY inside the
-- function itself is what grants DB access.

CREATE EXTENSION IF NOT EXISTS pg_cron;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'payment-overdue-notify-daily') THEN
    PERFORM cron.unschedule('payment-overdue-notify-daily');
  END IF;
END $$;

SELECT cron.schedule(
    'payment-overdue-notify-daily',
    '0 4 * * *',
    $$
    SELECT
      net.http_post(
        url := 'https://jhqxvpihauvhfclosuxn.supabase.co/functions/v1/check-low-stock',
        headers := '{"Content-Type": "application/json", "Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImpocXh2cGloYXV2aGZjbG9zdXhuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk3ODc5ODksImV4cCI6MjA5NTM2Mzk4OX0.cmDlCVvqeQVWeDvQkPx1dwRD7oLU7Rwy_tE3ef66AOI"}'::jsonb,
        body := '{"mode": "payment_overdue_notify"}'::jsonb
      ) AS request_id;
    $$
);
