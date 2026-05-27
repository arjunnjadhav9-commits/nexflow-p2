-- Migration: Set up pg_cron job for daily low stock alerts
-- Date: 2026-05-26
-- Purpose: Schedule check-low-stock Edge Function to run daily at 8:00 AM IST (2:30 AM UTC)

-- Enable pg_cron extension if not already enabled
CREATE EXTENSION IF NOT EXISTS pg_cron;

-- Remove existing job if it exists (for idempotency)
SELECT cron.unschedule('check-low-stock-daily');

-- Schedule the job to run daily at 2:30 AM UTC (8:00 AM IST)
-- Invokes the check-low-stock Edge Function via HTTP POST
SELECT cron.schedule(
    'check-low-stock-daily',                    -- Job name
    '30 2 * * *',                                -- Cron schedule: 2:30 AM UTC daily
    $$
    SELECT
      net.http_post(
        url := 'https://nexflow-p2.supabase.co/functions/v1/check-low-stock',
        headers := '{"Content-Type": "application/json", "Authorization": "Bearer ' || current_setting('app.settings.service_role_key') || '"}'::jsonb,
        body := '{}'::jsonb
      ) AS request_id;
    $$
);

-- Note: Replace 'nexflow-p2.supabase.co' with your actual Supabase project URL
-- The service_role_key must be configured in Supabase settings
