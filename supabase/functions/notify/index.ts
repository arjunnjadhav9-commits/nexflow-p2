// Supabase Edge Function: notify
// Single fan-out point for p2_notifications delivery (Step 4 — Notifications).
// Receives a notification_id for a row already inserted into p2_notifications
// (by js/notifications.js from the browser, or by check-low-stock's
// payment_overdue_notify mode server-side), delivers it to Telegram if the
// tenant has a telegram_chat_id configured, and updates the row's status to
// 'sent' or 'failed'. Never called from the browser directly with an
// arbitrary id in a way that matters — it only ever mutates a row that is
// already 'queued', so there is nothing to forge beyond re-triggering delivery
// of an already-queued message.
//
// Always returns 200 — every caller is fire-and-forget (`.catch(() => {})`,
// no await at the call site) and must never see a request "fail".

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const supabase = createClient(
  Deno.env.get('SUPABASE_URL') ?? '',
  Deno.env.get('SB_SECRET_KEY') ?? ''
)

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function json(body: unknown) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  })
}

// IST hour (0-23) at the moment this function runs.
function getIstHour(): number {
  const istString = new Date().toLocaleString('en-US', {
    timeZone: 'Asia/Kolkata',
    hour: '2-digit',
    hour12: false,
  })
  return parseInt(istString, 10) % 24 // toLocaleString can return "24" for midnight
}

// Handles the midnight-wraparound case (e.g. start=22, end=7 spans 10pm-7am).
// Equal or either-null → disabled (never quiet).
function isInQuietHours(start: number | null, end: number | null, hour: number): boolean {
  if (start === null || end === null || start === end) return false
  if (start < end) return hour >= start && hour < end
  return hour >= start || hour < end
}

async function sendTelegramMessage(chatId: string, text: string): Promise<{ ok: boolean; description?: string }> {
  const token = Deno.env.get('TELEGRAM_BOT_TOKEN') ?? ''
  const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text }),
  })
  const data = await res.json().catch(() => ({}))
  return { ok: data?.ok === true, description: data?.description }
}

async function markStatus(id: string, status: 'sent' | 'failed', errorReason: string | null) {
  await supabase
    .from('p2_notifications')
    .update({ status, error_reason: errorReason })
    .eq('id', id)
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS_HEADERS })
  }

  try {
    const body = await req.json().catch(() => null)
    const notificationId = body?.notification_id

    if (!notificationId || typeof notificationId !== 'string' || !UUID_RE.test(notificationId)) {
      return json({ error: 'invalid_notification_id' })
    }

    const { data: notification, error: fetchError } = await supabase
      .from('p2_notifications')
      .select('id, tenant_id, type, title, body, status')
      .eq('id', notificationId)
      .maybeSingle()

    if (fetchError) {
      console.error('notify: fetch error', fetchError)
      return json({ error: 'server_error' })
    }

    if (!notification || notification.status !== 'queued') {
      return json({ skipped: true })
    }

    const { data: settings, error: settingsError } = await supabase
      .from('p2_tenant_settings')
      .select('telegram_chat_id, quiet_hours_start, quiet_hours_end')
      .eq('tenant_id', notification.tenant_id)
      .maybeSingle()

    if (settingsError) {
      console.error('notify: settings fetch error', settingsError)
      return json({ error: 'server_error' })
    }

    if (!settings?.telegram_chat_id) {
      await markStatus(notification.id, 'failed', 'no_telegram_chat_id')
      return json({ delivered: false, reason: 'no_telegram_chat_id' })
    }

    const istHour = getIstHour()
    if (isInQuietHours(settings.quiet_hours_start, settings.quiet_hours_end, istHour)) {
      await markStatus(notification.id, 'failed', 'quiet_hours')
      return json({ delivered: false, reason: 'quiet_hours' })
    }

    const text = `${notification.title}\n${notification.body}`

    try {
      const result = await sendTelegramMessage(settings.telegram_chat_id, text)
      if (result.ok) {
        await markStatus(notification.id, 'sent', null)
        return json({ delivered: true })
      }
      await markStatus(notification.id, 'failed', result.description ?? 'telegram_send_failed')
      return json({ delivered: false, reason: result.description ?? 'telegram_send_failed' })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'telegram_exception'
      await markStatus(notification.id, 'failed', message)
      return json({ delivered: false, reason: message })
    }

  } catch (error) {
    console.error('notify: unexpected error', error)
    return json({ error: 'server_error' })
  }
})
