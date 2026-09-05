// Supabase Edge Function: telegram-webhook
// Receives inbound Telegram Update objects (registered via Telegram's
// setWebhook API — see the curl command in the Phase 3 sign-off message).
// Only handles /start <bind_token> — the deep-link chat-binding flow from
// Settings (Phase 8). Everything else is ignored silently. Always returns
// 200 — Telegram retries on any non-200 response, and there is nothing here
// worth retrying.

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

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS_HEADERS })
  }

  try {
    const update = await req.json().catch(() => null)
    const text: string | undefined = update?.message?.text
    const chatId: number | undefined = update?.message?.chat?.id

    if (!text || !chatId || !text.startsWith(START_PREFIX)) {
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
