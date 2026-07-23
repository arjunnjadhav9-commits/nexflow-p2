# Telegram Alerts — Setup Guide

Nexflow P2 sends two types of Telegram alerts: a daily morning briefing and instant
low-stock alerts after production events. Both are production-ready and live as of July 2026.

---

## Overview

| Alert | Function | Trigger |
|-------|----------|---------|
| Daily briefing | `check-low-stock` | 8:00 AM IST daily (pg_net cron) |
| Instant alert | `check-low-stock-instant` | After production issue / dispatch confirm / RM dispatch |

The instant alert is fire-and-forget — it never blocks the UI action that triggered it.

---

## Step 1: Create a Telegram Bot

1. Open Telegram and search for **@BotFather**
2. Send `/newbot`
3. Choose a display name (e.g. "Nexflow Stock Alerts") and username ending in `bot`
4. BotFather replies with your **Bot Token** — save it securely

> ⚠️ Never share your bot token publicly.

---

## Step 2: Get Your Chat ID

### Personal chat
1. Search for **@userinfobot** on Telegram
2. Send any message — it replies with your Chat ID (a number like `123456789`)

### Group chat
1. Add your bot to the group
2. Send a message in the group
3. Visit: `https://api.telegram.org/botYOUR_BOT_TOKEN/getUpdates`
4. Find `"chat":{"id":-1001234567890}` — the negative number is the group Chat ID

---

## Step 3: Configure Supabase Secrets

Go to Supabase Dashboard → Settings → Edge Functions → Secrets. Add:

| Secret name | Value |
|-------------|-------|
| `TELEGRAM_BOT_TOKEN` | Your bot token from Step 1 |
| `SUPABASE_SERVICE_ROLE_KEY` | Your project service role key |

> ⚠️ `check-low-stock` and `check-low-stock-instant` use `SUPABASE_SERVICE_ROLE_KEY`.
> The `agent-query` function uses a different secret: `SB_SECRET_KEY`. Do not mix them up.

---

## Step 4: Deploy Edge Functions

```
supabase functions deploy check-low-stock
supabase functions deploy check-low-stock-instant
```

---

## Step 5: Set Up the pg_net Cron Job

Run this in Supabase SQL Editor (already live — only needed for new projects):

```sql
SELECT cron.schedule(
  'check-low-stock-daily',
  '30 2 * * *',  -- 2:30 AM UTC = 8:00 AM IST
  $$
  SELECT net.http_post(
    url := 'https://YOUR_PROJECT_REF.supabase.co/functions/v1/check-low-stock',
    headers := '{"Content-Type": "application/json", "Authorization": "Bearer YOUR_SERVICE_ROLE_KEY"}'::jsonb,
    body := '{}'::jsonb
  ) AS request_id;
  $$
);
```

Current live cron: jobid 2, schedule `30 2 * * *`. Verify with:
```sql
SELECT * FROM cron.job WHERE jobname = 'check-low-stock-daily';
```

---

## Step 6: Configure Chat ID in App

1. Log in to Nexflow P2
2. Go to **Settings** → **Telegram Alerts** tab
3. Enter your Chat ID from Step 2
4. Save

---

## Daily Briefing Format

Sent at 8:00 AM IST. Sends **nothing** if all signals are clear (no noise).

Sections included when relevant:
- Low stock materials (below min_stock_level)
- Yesterday's GRNs (grouped by material, total quantity — not per GRN row)
- Draft dispatches pending more than 2 days
- Warning if no GRN received in 3 days

Format rules:
- All bullets use `•` not `-`
- Low stock format: `• **Name**: 14 PCS (min: 100 PCS)` — no unnecessary decimals
- GRNs grouped by material with total quantity

Example message:
```
⚠️ Low Stock Alert — SS Engineering

Low stock (2):
• Hex Bolt SS M6x20 [BOLT-001]: 14 PCS (min: 100 PCS)
• Insulation Paper NMN 0.25MM [INS-001]: 21 MTR (min: 30 MTR)

Yesterday's GRNs:
• PVC Coated Copper Wire 1.40/1.80MM: 101 KG (2 GRNs)

📅 23/07/2026, 08:00:12 am
```

---

## Instant Alert

Fires after:
- Production issue confirmed (`production-issue.html`)
- Dispatch confirmed (`dispatch.html`)
- RM dispatch confirmed (`rm-dispatch.html`)

Checks if any material just dropped below min_stock_level and sends immediately.
Fire-and-forget — never blocks or delays the page action.

---

## Wiring Instant Alerts (for new pages)

Add this after any action that deducts stock:

```javascript
// Fire-and-forget — do not await, do not block UI
fetch('https://YOUR_PROJECT_REF.supabase.co/functions/v1/check-low-stock-instant', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${SUPABASE_ANON_KEY}`
  },
  body: JSON.stringify({ tenant_id: tenantId })
}).catch(() => {}) // swallow errors silently
```

> Note: `SUPABASE_ANON_KEY` is a bare global from `js/supabase-client.js` — no `window.` prefix.

---

## Troubleshooting

**Not receiving alerts:**
1. Verify Chat ID is saved in Settings → Telegram Alerts
2. Check `TELEGRAM_BOT_TOKEN` exists in Supabase Secrets
3. Start the bot on Telegram (search for it, click Start) — bots can't message you until you do
4. Check Edge Function logs: Supabase Dashboard → Edge Functions → check-low-stock → Logs
5. Verify cron job exists: `SELECT * FROM cron.job WHERE jobname = 'check-low-stock-daily';`

**Getting multiple alerts:**
Check for duplicate cron jobs: `SELECT * FROM cron.job;`
Remove duplicates if found.

**Testing manually:**
Supabase Dashboard → Edge Functions → check-low-stock → Invoke Function → empty body `{}`

---

## Changing Alert Time

```sql
SELECT cron.unschedule('check-low-stock-daily');
SELECT cron.schedule('check-low-stock-daily', 'NEW_CRON_EXPRESSION', $$...$$);
```

Cron format: `minute hour day month weekday` (UTC)
- `30 2 * * *` = 8:00 AM IST (current)
- `0 1 * * *` = 6:30 AM IST
- `30 3 * * *` = 9:00 AM IST

---

**Last Updated**: July 23, 2026