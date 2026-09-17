// Supabase Edge Function: telegram-webhook
// Receives inbound Telegram Update objects (registered via Telegram's
// setWebhook API — see the curl command in the Phase 3 sign-off message).
// Handles /start <bind_token> — the deep-link chat-binding flow from
// Settings (Phase 8) — /ack <alert_id_prefix> — founder-only, acknowledges a
// p2_ops_alerts row (Session A0) — and /reply <thread_id_prefix> <text> —
// founder-only, answers a support thread (A4 Phase 1). Everything else is
// ignored silently. Always returns 200 — Telegram retries on any non-200
// response, and there is nothing here worth retrying.

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
const REPLY_PREFIX = '/reply '

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

// A4 Phase 1 — founder-only /reply <thread_id_prefix> <text>. Answers a
// support thread from Telegram, no laptop needed. Same founder-only check
// and same prefix-match-over-a-bounded-window approach as handleAck above,
// for the identical reason: PostgREST's ilike on a uuid column throws
// ("operator does not exist: uuid ~~* unknown"), so the 500 most recent
// threads are fetched and matched client-side instead.
async function handleReply(text: string, chatId: number): Promise<Response> {
  const founderChatId = Deno.env.get('FOUNDER_TELEGRAM_CHAT_ID')
  if (!founderChatId || String(chatId) !== founderChatId) {
    return ok()
  }

  const rest = text.slice(REPLY_PREFIX.length).trim()
  const spaceIdx = rest.indexOf(' ')
  const prefix = (spaceIdx === -1 ? rest : rest.slice(0, spaceIdx)).trim()
  const replyText = (spaceIdx === -1 ? '' : rest.slice(spaceIdx + 1)).trim()

  if (!prefix || !replyText) {
    await replyToChat(chatId, 'Usage: /reply <thread_id> <message>')
    return ok()
  }

  const { data: recentThreads, error: matchError } = await supabase
    .from('p2_support_threads')
    .select('id, tenant_id, lang')
    .order('created_at', { ascending: false })
    .limit(500)

  if (matchError) {
    console.error('telegram-webhook: reply thread lookup error', matchError)
    return ok()
  }

  const lowerPrefix = prefix.toLowerCase()
  const matches = (recentThreads ?? []).filter((row) => (row.id as string).toLowerCase().startsWith(lowerPrefix))

  if (matches.length === 0) {
    await replyToChat(chatId, `No support thread found matching ${prefix}.`)
    return ok()
  }

  if (matches.length > 1) {
    await replyToChat(chatId, `Ambiguous — ${matches.length} threads match ${prefix}. Send more characters.`)
    return ok()
  }

  const thread = matches[0] as { id: string; tenant_id: string; lang: string }

  const { error: messageError } = await supabase
    .from('p2_support_messages')
    .insert({ tenant_id: thread.tenant_id, thread_id: thread.id, role: 'founder', body: replyText })

  if (messageError) {
    console.error('telegram-webhook: reply message insert error', messageError)
    return ok()
  }

  const { error: statusError } = await supabase
    .from('p2_support_threads')
    .update({ status: 'awaiting_client', updated_at: new Date().toISOString() })
    .eq('id', thread.id)

  if (statusError) {
    console.error('telegram-webhook: reply status update error', statusError)
    // Message is already saved — the client will still see it via the
    // notification below. Not worth aborting the rest of the flow over a
    // status column that only gates the next opsAlert's dedup decision.
  }

  const { data: settingsRow } = await supabase
    .from('p2_tenant_settings')
    .select('company_name')
    .eq('tenant_id', thread.tenant_id)
    .maybeSingle()
  const companyName = (settingsRow as { company_name?: string } | null)?.company_name || 'your account'

  // In-app notification to the client — the existing notify path, called
  // the exact way check-low-stock's payment_overdue_notify mode already
  // does it server-to-server. SUPABASE_ANON_KEY/SUPABASE_URL are
  // platform-injected — no new secret needed.
  const { data: notificationRow, error: notificationError } = await supabase
    .from('p2_notifications')
    .insert({
      tenant_id: thread.tenant_id,
      type: 'support_reply',
      title: 'Nexflow Support',
      body: replyText,
      metadata: { thread_id: thread.id },
    })
    .select('id')
    .single()

  if (notificationError) {
    console.error('telegram-webhook: reply notification insert error', notificationError)
  } else if (notificationRow) {
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? ''
    const notifyUrl = `${Deno.env.get('SUPABASE_URL') ?? ''}/functions/v1/notify`
    fetch(notifyUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${anonKey}` },
      body: JSON.stringify({ notification_id: (notificationRow as { id: string }).id }),
    }).catch((err) => console.error('telegram-webhook: notify fetch failed', err))
  }

  // KB accretion — the whole reason Phase 1 comes before Phase 2. The
  // question is the thread's FIRST client message, not the most recent one:
  // on a multi-message thread the most recent client message is a follow-up
  // ("any update?"), not the actual question, and pairing that with this
  // reply would draft a nonsense KB entry.
  const { data: firstClientMessage, error: firstMessageError } = await supabase
    .from('p2_support_messages')
    .select('body')
    .eq('thread_id', thread.id)
    .eq('role', 'client')
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle()

  if (firstMessageError) {
    console.error('telegram-webhook: KB question lookup error', firstMessageError)
  } else if (firstClientMessage) {
    const { error: kbError } = await supabase.from('p2_support_kb').insert({
      thread_id: thread.id,
      question: (firstClientMessage as { body: string }).body,
      answer: replyText,
      lang: thread.lang || 'en',
      status: 'unreviewed',
    })
    if (kbError) {
      console.error('telegram-webhook: KB insert error', kbError)
    }
  }

  await replyToChat(chatId, `✅ Replied to ${companyName} — thread ${prefix}.`)
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

    if (text.startsWith(REPLY_PREFIX)) {
      return await handleReply(text, chatId)
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
