-- A3 — ops-digest-daily cron.
--
-- 02:00 UTC = 07:30 IST, 30 minutes ahead of check-low-stock's existing
-- 02:30 UTC (08:00 IST) tenant-facing digest, per automation-strategy.md
-- §4.3. Both functions read p2_agent_logs/p2_notifications read-only — no
-- write contention — so the 30-minute gap is a timing note, not a race risk;
-- see the ops-digest build plan for the full reasoning.
--
-- Unlike every other cron in this codebase, the request here also carries an
-- X-Cron-Secret header — ops-digest checks it before running any query
-- (unauthorized requests get 401, no DB read happens). The anon key in
-- Authorization is still present for parity with every other cron entry
-- (verify_jwt=false on the function means it is never validated as a real
-- JWT either way) but it is not what gates this function.
--
-- Run this in the Supabase SQL Editor as the postgres role — never
-- `supabase db push` (replays old migrations). Replace
-- <SET-CRON_SHARED_SECRET-VALUE> below with the exact value already set via
-- `supabase secrets set CRON_SHARED_SECRET=...` this session (2026-09-17) —
-- deliberately NOT committed here, same convention as every other
-- secret-bearing step in this codebase (do not put the real value in a file
-- that reaches git). If the secret is ever rotated, this header must be
-- updated to match or the cron starts getting 401'd silently (net.http_post
-- does not surface the response body anywhere visible — a stale
-- p2_cron_heartbeat / p2_ops_alerts row is how you'd notice).

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'ops-digest-daily') THEN
    PERFORM cron.unschedule('ops-digest-daily');
  END IF;
END $$;

SELECT cron.schedule(
    'ops-digest-daily',
    '0 2 * * *',
    $$
    SELECT
      net.http_post(
        url := 'https://jhqxvpihauvhfclosuxn.supabase.co/functions/v1/ops-digest',
        headers := '{"Content-Type": "application/json", "Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImpocXh2cGloYXV2aGZjbG9zdXhuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk3ODc5ODksImV4cCI6MjA5NTM2Mzk4OX0.cmDlCVvqeQVWeDvQkPx1dwRD7oLU7Rwy_tE3ef66AOI", "X-Cron-Secret": "<SET-CRON_SHARED_SECRET-VALUE>"}'::jsonb,
        body := '{}'::jsonb
      ) AS request_id;
    $$
);
