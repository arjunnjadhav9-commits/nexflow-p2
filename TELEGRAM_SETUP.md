# Telegram Low Stock Alerts - Setup Guide

This guide explains how to set up Telegram notifications for low stock alerts in Nexflow P2.

## Overview

The system automatically checks stock levels daily at **8:00 AM IST** and sends Telegram alerts when any raw material falls below its minimum stock level.

---

## Step 1: Create a Telegram Bot

1. Open Telegram and search for **@BotFather**
2. Send the command: `/newbot`
3. Follow the prompts:
   - Choose a **display name** for your bot (e.g., "Nexflow Stock Alerts")
   - Choose a **username** ending in `bot` (e.g., "nexflow_stock_bot")
4. BotFather will reply with your **Bot Token** (looks like `123456789:ABCdefGhIJKlmNoPQRsTUVwxyZ`)
5. **Save this token securely** — you'll need it for Step 3

> ⚠️ **Never share your bot token publicly!** Anyone with the token can control your bot.

---

## Step 2: Get Your Telegram Chat ID

### Option A: Using @userinfobot
1. Search for **@userinfobot** on Telegram
2. Start the bot and send any message (e.g., "hi")
3. The bot will reply with your user info including your **Chat ID** (a number like `123456789`)
4. Copy this Chat ID

### Option B: For Group Chats
1. Add your bot to the Telegram group
2. Send a message in the group
3. Visit this URL in your browser (replace `YOUR_BOT_TOKEN` with your actual token):
   ```
   https://api.telegram.org/botYOUR_BOT_TOKEN/getUpdates
   ```
4. Look for `"chat":{"id":-1001234567890}` in the response
5. The negative number (e.g., `-1001234567890`) is your group's Chat ID

---

## Step 3: Configure Supabase

### 3.1 Add Bot Token as Supabase Secret

1. Open your Supabase project dashboard
2. Go to **Settings** → **Edge Functions** → **Secrets**
3. Add a new secret:
   - **Name**: `TELEGRAM_BOT_TOKEN`
   - **Value**: Your bot token from Step 1
4. Click **Save**

### 3.2 Run Database Migrations

You need to run two SQL migrations to set up the system:

#### Migration 1: Add telegram_chat_id column
```sql
-- File: supabase/migrations/20260526_add_telegram_chat_id.sql

ALTER TABLE p2_tenant_settings
ADD COLUMN IF NOT EXISTS telegram_chat_id TEXT;

COMMENT ON COLUMN p2_tenant_settings.telegram_chat_id IS 'Telegram chat ID for receiving low stock alerts';
```

#### Migration 2: Set up pg_cron job
```sql
-- File: supabase/migrations/20260526_setup_cron_low_stock.sql

CREATE EXTENSION IF NOT EXISTS pg_cron;

SELECT cron.unschedule('check-low-stock-daily');

SELECT cron.schedule(
    'check-low-stock-daily',
    '30 2 * * *',  -- 2:30 AM UTC = 8:00 AM IST
    $$
    SELECT
      net.http_post(
        url := 'https://YOUR_PROJECT_REF.supabase.co/functions/v1/check-low-stock',
        headers := '{"Content-Type": "application/json", "Authorization": "Bearer ' || current_setting('app.settings.service_role_key') || '"}'::jsonb,
        body := '{}'::jsonb
      ) AS request_id;
    $$
);
```

**Important**: Replace `YOUR_PROJECT_REF` with your actual Supabase project reference (e.g., `nexflow-p2`).

**To run migrations:**
- Option A: Use Supabase CLI: `supabase db push`
- Option B: Copy-paste the SQL into Supabase Dashboard → SQL Editor → Run

### 3.3 Deploy the Edge Function

1. Install Supabase CLI if you haven't:
   ```bash
   npm install -g supabase
   ```

2. Link your project:
   ```bash
   supabase link --project-ref YOUR_PROJECT_REF
   ```

3. Deploy the Edge Function:
   ```bash
   supabase functions deploy check-low-stock
   ```

---

## Step 4: Configure in Nexflow P2 App

1. Log in to your Nexflow P2 account
2. Go to **Settings** page
3. Click on the **Telegram Alerts** tab
4. Enter your **Chat ID** from Step 2
5. Click **Save Telegram Settings**

---

## Testing the Setup

### Manual Test
You can manually trigger the alert to test if everything works:

1. Go to Supabase Dashboard → **Edge Functions** → **check-low-stock**
2. Click **Invoke Function**
3. Use empty body: `{}`
4. Click **Invoke**
5. Check your Telegram for an alert (if any stock is below minimum)

### Create Test Low Stock
1. In Nexflow P2, set a material's **min_stock_level** higher than current stock
2. Wait for the next scheduled run (8:00 AM IST) OR manually invoke the function
3. You should receive a Telegram alert

---

## Alert Message Format

When stock is low, you'll receive a message like:

```
🚨 Low Stock Alert — ABC Manufacturing

• Steel Rods: 45.00 KG (min: 100 KG)
• Lubricant Oil: 8.50 L (min: 20 L)

📅 26/05/2026, 08:00:15 am
```

---

## Troubleshooting

### Not Receiving Alerts?

1. **Check if Chat ID is saved**:
   - Go to Settings → Telegram Alerts tab
   - Verify your Chat ID is displayed

2. **Verify bot token is configured**:
   - Supabase Dashboard → Settings → Edge Functions → Secrets
   - Ensure `TELEGRAM_BOT_TOKEN` exists

3. **Check if you've started the bot**:
   - Search for your bot on Telegram
   - Click **Start** button
   - Bots cannot message you until you start them first

4. **For group chats**:
   - Ensure the bot is a member of the group
   - Ensure the bot has permission to send messages

5. **Check Edge Function logs**:
   - Supabase Dashboard → Edge Functions → check-low-stock → Logs
   - Look for errors

6. **Verify pg_cron is running**:
   ```sql
   SELECT * FROM cron.job WHERE jobname = 'check-low-stock-daily';
   ```

### Alerts Sent Too Often?

The cron job runs **once daily** at 8:00 AM IST. If you're getting multiple alerts:
- Check if there are duplicate cron jobs:
  ```sql
  SELECT * FROM cron.job;
  ```
- Delete duplicates if needed

---

## Changing Alert Time

To change the alert time, modify the cron schedule in the migration:

```sql
'30 2 * * *'  -- Current: 2:30 AM UTC = 8:00 AM IST
```

Cron format: `minute hour day month weekday`

Examples:
- `0 1 * * *` = 1:00 AM UTC = 6:30 AM IST
- `30 3 * * *` = 3:30 AM UTC = 9:00 AM IST
- `0 12 * * *` = 12:00 PM UTC = 5:30 PM IST

After changing, re-run the migration or use:
```sql
SELECT cron.unschedule('check-low-stock-daily');
-- Then create new schedule with updated time
```

---

## Security Notes

1. **Never commit** your Bot Token to version control
2. **Store** the Bot Token only in Supabase Secrets
3. **Rotate** your Bot Token if it's ever exposed (via @BotFather → `/revoke`)
4. **Limit** bot permissions (bots don't need admin rights in groups)

---

## Support

For issues specific to:
- **Telegram API**: Check [Telegram Bot API docs](https://core.telegram.org/bots/api)
- **Supabase Edge Functions**: Check [Supabase docs](https://supabase.com/docs/guides/functions)
- **Nexflow P2**: Contact support at your company

---

**Last Updated**: 26 May 2026
