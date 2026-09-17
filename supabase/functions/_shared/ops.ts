// Shared module: opsAlert() — the one route founder-facing server code uses to
// reach the founder. Deno-to-Deno import between Edge Functions (this is NOT
// the browser<->Deno boundary CLAUDE.md says has no shared module system —
// that boundary is unaffected; this is ordinary Supabase Edge Function layout).
//
// Contract, all load-bearing:
// - NEVER THROWS. Every caller is fire-and-forget. An alerting path that can
//   fail a business operation is worse than no alerting path — same contract
//   `notify/index.ts` already honours by always returning HTTP 200.
// - Deduplicates on (source, dedupeKey) within a rolling window BEFORE writing
//   anything — a repeat within the window produces no new row and no send.
// - `critical` severity bypasses founder quiet hours. `important` and
//   `monitor` do not, and are NOT retried once quiet hours end — see the
//   accepted-gap note on FOUNDER_QUIET_HOURS_START below.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

export type OpsSeverity = 'critical' | 'important' | 'monitor'

export type OpsSource =
  | 'compliance'
  | 'digest'
  | 'filing'
  | 'health'
  | 'onboarding'
  | 'support'
  | 'billing'
  | 'bridge'
  | 'agent'
  | 'factory'
  | 'intelligence'

export interface OpsAlertOptions {
  source: OpsSource
  severity: OpsSeverity
  title: string
  body: string
  dedupeKey?: string
  dedupeWindowHours?: number
  meta?: Record<string, unknown>
}

const supabase = createClient(
  Deno.env.get('SUPABASE_URL') ?? '',
  Deno.env.get('SB_SECRET_KEY') ?? ''
)

// Founder's own quiet-hours window, IST, hardcoded — not tenant quiet_hours,
// not a secret. Shifted earlier than a plain "sleep window" guess: A6's
// filing-package dispatch cron fires at 08:00 IST but its drain cron runs
// every 2 minutes across the 5th-7th, so an `important` problem surfacing in
// the 06:00-08:00 stretch is exactly the kind of thing worth seeing before
// the day's main run. Ending the window at 06:00 instead of 07:00 buys that.
//
// Accepted gap: alerts suppressed here are terminal, not retried. No
// deliver_after column, no drain — most `important` conditions come from
// periodic scans that will re-fire and get through in daylight hours anyway.
// A one-off `important` failure that happens exactly once at night is
// genuinely invisible until someone queries p2_ops_alerts by hand.
const FOUNDER_QUIET_HOURS_START: number = 22 // 10pm IST
const FOUNDER_QUIET_HOURS_END: number = 6 // 6am IST

const DEFAULT_DEDUPE_WINDOW_HOURS = 24

function getIstHour(): number {
  const istString = new Date().toLocaleString('en-US', {
    timeZone: 'Asia/Kolkata',
    hour: '2-digit',
    hour12: false,
  })
  return parseInt(istString, 10) % 24 // toLocaleString can return "24" for midnight
}

// Byte-for-byte the same wraparound logic as notify/index.ts's isInQuietHours,
// ported here because the founder's window is a different pair of numbers
// than any tenant's quiet_hours_start/end.
function isInFounderQuietHours(hour: number): boolean {
  const start = FOUNDER_QUIET_HOURS_START
  const end = FOUNDER_QUIET_HOURS_END
  if (start === end) return false
  if (start < end) return hour >= start && hour < end
  return hour >= start || hour < end
}

async function sendTelegramMessage(
  chatId: string,
  text: string
): Promise<{ ok: boolean; description?: string }> {
  const token = Deno.env.get('TELEGRAM_BOT_TOKEN') ?? ''
  const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text }),
  })
  const data = await res.json().catch(() => ({}))
  return { ok: data?.ok === true, description: data?.description }
}

async function markAlert(
  id: string,
  fields: { delivered?: boolean; error_reason?: string | null }
) {
  await supabase.from('p2_ops_alerts').update(fields).eq('id', id)
}

export async function opsAlert(opts: OpsAlertOptions): Promise<void> {
  try {
    const dedupeWindowHours = opts.dedupeWindowHours ?? DEFAULT_DEDUPE_WINDOW_HOURS

    // 1. Dedupe gate — pre-insert. A hit means no new row and no send.
    if (opts.dedupeKey) {
      const since = new Date(Date.now() - dedupeWindowHours * 60 * 60 * 1000).toISOString()
      const { data: existing, error: dedupeError } = await supabase
        .from('p2_ops_alerts')
        .select('id')
        .eq('source', opts.source)
        .eq('dedupe_key', opts.dedupeKey)
        .gte('created_at', since)
        .limit(1)

      if (dedupeError) {
        console.error('opsAlert: dedupe check failed', dedupeError)
        // Fail open on the dedupe check itself — a broken dedupe query must
        // never silently swallow a real alert.
      } else if (existing && existing.length > 0) {
        return
      }
    }

    // 2. Write the row.
    const { data: inserted, error: insertError } = await supabase
      .from('p2_ops_alerts')
      .insert({
        source: opts.source,
        severity: opts.severity,
        title: opts.title,
        body: opts.body,
        dedupe_key: opts.dedupeKey ?? null,
        meta: opts.meta ?? {},
      })
      .select('id')
      .single()

    if (insertError || !inserted) {
      console.error('opsAlert: insert failed', insertError)
      return
    }

    const alertId = inserted.id as string

    // 3. No founder chat configured — write the row, make the gap visible,
    // stop. This is today's real state until FOUNDER_TELEGRAM_CHAT_ID is set
    // by hand (secret values cannot be read back to confirm).
    const founderChatId = Deno.env.get('FOUNDER_TELEGRAM_CHAT_ID')
    if (!founderChatId) {
      await markAlert(alertId, { error_reason: 'no_founder_chat_id' })
      return
    }

    // 4. Quiet hours — critical bypasses entirely.
    if (opts.severity !== 'critical') {
      const hour = getIstHour()
      if (isInFounderQuietHours(hour)) {
        await markAlert(alertId, { error_reason: 'quiet_hours_suppressed' })
        return
      }
    }

    // 5. Compose and send. The id prefix is what makes /ack usable.
    const text = `${opts.title}\n${opts.body}\n\nAck: /ack ${alertId.slice(0, 8)}`

    try {
      const result = await sendTelegramMessage(founderChatId, text)
      if (result.ok) {
        await markAlert(alertId, { delivered: true, error_reason: null })
      } else {
        await markAlert(alertId, { error_reason: result.description ?? 'telegram_send_failed' })
      }
    } catch (sendError) {
      const message = sendError instanceof Error ? sendError.message : 'telegram_exception'
      await markAlert(alertId, { error_reason: message })
    }
  } catch (error) {
    console.error('opsAlert: unexpected error', error)
    // Never throw — swallow and move on.
  }
}
