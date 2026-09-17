// Supabase Edge Function: telegram-webhook
// Receives inbound Telegram Update objects (registered via Telegram's
// setWebhook API — see the curl command in the Phase 3 sign-off message).
// Handles /start <bind_token> — the deep-link chat-binding flow from
// Settings (Phase 8) — and /ack <alert_id_prefix> — founder-only,
// acknowledges a p2_ops_alerts row (Session A0). Everything else is ignored
// silently. Always returns 200 — Telegram retries on any non-200 response,
// and there is nothing here worth retrying.

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
const START_PREFIX = '/start '
const ACK_PREFIX = '/ack '

function ok() {
  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  })
}

async function replyToChat(chatId: number | string, text: string) {
  const token = Deno.env.get('TELEGRAM_BOT_TOKEN') ?? ''
  try {
    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text }),
    })
  } catch (err) {
    console.error('telegram-webhook: reply failed', err)
  }
}

// Session A0 — founder-only /ack <alert_id_prefix>. Only a message from
// FOUNDER_TELEGRAM_CHAT_ID is honoured; anyone else's /ack is ignored
// silently, same as every other unrecognised message. Always returns ok() —
// preserves the existing always-200 contract.
async function handleAck(text: string, chatId: number): Promise<Response> {
  const founderChatId = Deno.env.get('FOUNDER_TELEGRAM_CHAT_ID')
  if (!founderChatId || String(chatId) !== founderChatId) {
    return ok()
  }

  const prefix = text.slice(ACK_PREFIX.length).trim()
  if (!prefix) {
    return ok()
  }

  // PostgREST's ilike against a uuid column needs an explicit cast that
  // .filter('id::text', ...) does not reliably produce (confirmed live:
  // "operator does not exist: uuid ~~* unknown"). Filtering client-side
  // sidesteps it — p2_ops_alerts is low-volume, founder-only, so fetching a
  // bounded recent window and matching in JS is simpler than fighting
  // PostgREST cast syntax.
  const { data: recent, error: matchError } = await supabase
    .from('p2_ops_alerts')
    .select('id, title, acknowledged_at')
    .order('created_at', { ascending: false })
    .limit(500)

  const lowerPrefix = prefix.toLowerCase()
  const matches = (recent ?? []).filter((row) => row.id.toLowerCase().startsWith(lowerPrefix))

  if (matchError) {
    console.error('telegram-webhook: ack lookup error', matchError)
    return ok()
  }

  if (!matches || matches.length === 0) {
    await replyToChat(chatId, `No alert found matching ${prefix}.`)
    return ok()
  }

  if (matches.length > 1) {
    await replyToChat(chatId, `Ambiguous — ${matches.length} alerts match ${prefix}. Send more characters.`)
    return ok()
  }

  const alert = matches[0]

  if (alert.acknowledged_at) {
    await replyToChat(chatId, `Already acknowledged at ${alert.acknowledged_at}.`)
    return ok()
  }

  const { error: updateError } = await supabase
    .from('p2_ops_alerts')
    .update({ acknowledged_at: new Date().toISOString() })
    .eq('id', alert.id)

  if (updateError) {
    console.error('telegram-webhook: ack update error', updateError)
    return ok()
  }

  await replyToChat(chatId, `✅ Acknowledged: ${alert.title}`)
  return ok()
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS_HEADERS })
  }

  try {
    const update = await req.json().catch(() => null)
    const text: string | undefined = update?.message?.text
    const chatId: number | undefined = update?.message?.chat?.id

    if (!text || !chatId) {
      return ok()
    }

    if (text.startsWith(ACK_PREFIX)) {
      return await handleAck(text, chatId)
    }

    if (!text.startsWith(START_PREFIX)) {
      return ok()
    }

    const token = text.slice(START_PREFIX.length).trim()
    if (!UUID_RE.test(token)) {
      // Not a well-formed bind token — ignore silently, per spec.
      return ok()
    }

    const { data: settingsRow, error: fetchError } = await supabase
      .from('p2_tenant_settings')
      .select('tenant_id, company_name, telegram_bind_token_expires_at')
      .eq('telegram_bind_token', token)
      .maybeSingle()

    if (fetchError) {
      console.error('telegram-webhook: bind token lookup error', fetchError)
      return ok()
    }

    if (!settingsRow) {
      await replyToChat(chatId, 'Link expired or invalid. Generate a new link from Nexflow Settings.')
      return ok()
    }

    if (settingsRow.telegram_bind_token_expires_at && new Date(settingsRow.telegram_bind_token_expires_at) < new Date()) {
      await replyToChat(chatId, 'Link expired or invalid. Generate a new link from Nexflow Settings.')
      return ok()
    }

    const { error: updateError } = await supabase
      .from('p2_tenant_settings')
      .update({ telegram_chat_id: String(chatId), telegram_bind_token: null })
      .eq('tenant_id', settingsRow.tenant_id)

    if (updateError) {
      console.error('telegram-webhook: bind update error', updateError)
      return ok()
    }

    const companyName = settingsRow.company_name || 'your company'
    await replyToChat(
      chatId,
      `✅ Nexflow alerts connected for ${companyName}. You will receive stock, dispatch and payment alerts here.`
    )
    return ok()

  } catch (error) {
    console.error('telegram-webhook: unexpected error', error)
    return ok()
  }
})
