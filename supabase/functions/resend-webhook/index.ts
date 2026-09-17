// Supabase Edge Function: resend-webhook
// A6 — CA email bounce detection (automation-strategy.md §4.6).
//
// Handles Resend's email.bounced and email.complained webhook events.
// verify_jwt = false (this is Resend calling us, not a logged-in user) —
// authenticity instead comes from verifying the request signature.
//
// Resend's webhook signing is Svix under the hood: svix-id / svix-timestamp /
// svix-signature headers, HMAC-SHA256 over the raw body string (never the
// parsed JSON), secret is "whsec_" + base64. Verified here with Deno's native
// Web Crypto (crypto.subtle) rather than the `svix` npm package — no
// dependency to trust, and this codebase already avoids esm.sh packages
// where a same-runtime primitive does the job (see js/challan-pdf.js's own
// "why not a library" precedent in spirit, not letter).
//
// On a confirmed bounce/complaint of an address matching a tenant's ca_email
// or accountant_email (checked case-insensitively — this Resend account also
// sends challan/invoice/tally-export emails to client addresses that have
// nothing to do with a tenant's own CA, so no match is the common case, not
// an error):
//   1. Flag the matching column invalid on p2_tenant_settings — the address
//      itself is NOT nulled (that would make resolveRecipients() in
//      filing-package/index.ts skip the tenant silently forever with no
//      visible reason). settings.html clears the flag when the owner
//      re-saves that email field.
//   2. Notify the tenant OWNER (not just the founder) — in-app
//      (p2_notifications, type='email_bounced') and via Telegram (existing
//      notify Edge Function). The founder cannot fix a wrong CA email; only
//      the client can.
//   3. important ops alert to the founder.
//
// Language note: the task asked for this in the owner's "preferred_lang".
// No such column or concept exists anywhere server-side — p2_tenant_settings
// has zero %lang% columns, and CLAUDE.md's own "Language Toggle" section
// says index.ts (Edge Functions) has NO language toggle, every string is
// single hardcoded Hinglish. Matching that existing precedent here rather
// than inventing a new column. See CLAUDE.md Known Open Items for the
// preferred_lang gap this surfaced.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { opsAlert } from '../_shared/ops.ts'

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, svix-id, svix-timestamp, svix-signature',
}

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY') ?? ''
const supabase = createClient(SUPABASE_URL, Deno.env.get('SB_SECRET_KEY') ?? '')

function respond(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  })
}

// ─── Signature verification (Svix scheme, raw HMAC-SHA256, no svix package) ─
const WEBHOOK_TOLERANCE_SECONDS = 5 * 60

function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i])
  return btoa(binary)
}

// Constant-time string compare — avoids leaking signature-match progress via
// timing. Both inputs are already base64 signature strings of similar length
// in the normal case; a length mismatch short-circuits to false (returning
// early here is safe — it doesn't leak byte-level content, only presence of
// a length difference, which base64-encoded HMAC output doesn't vary anyway).
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let result = 0
  for (let i = 0; i < a.length; i++) result |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return result === 0
}

async function verifyResendSignature(
  rawBody: string,
  svixId: string | null,
  svixTimestamp: string | null,
  svixSignature: string | null
): Promise<boolean> {
  const secretRaw = Deno.env.get('RESEND_WEBHOOK_SECRET') ?? ''
  if (!secretRaw || !svixId || !svixTimestamp || !svixSignature) return false

  // Replay guard — reject requests whose timestamp is stale or from the
  // future, same tolerance Svix's own SDKs use.
  const ts = parseInt(svixTimestamp, 10)
  if (!Number.isFinite(ts) || Math.abs(Date.now() / 1000 - ts) > WEBHOOK_TOLERANCE_SECONDS) return false

  const secretB64 = secretRaw.startsWith('whsec_') ? secretRaw.slice('whsec_'.length) : secretRaw
  let keyBytes: Uint8Array
  try {
    keyBytes = base64ToBytes(secretB64)
  } catch {
    return false
  }

  // `as BufferSource` — Deno's lib.dom types Uint8Array's buffer generically
  // as ArrayBufferLike, which SubtleCrypto's DOM typings don't accept
  // directly even though the runtime value is a perfectly ordinary
  // ArrayBuffer-backed view.
  const key = await crypto.subtle.importKey('raw', keyBytes as BufferSource, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const signedContent = `${svixId}.${svixTimestamp}.${rawBody}`
  const sigBuffer = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(signedContent) as BufferSource)
  const expected = bytesToBase64(new Uint8Array(sigBuffer))

  // svix-signature can carry multiple space-separated "v1,<base64>" tokens
  // during key rotation — a match against any one is valid.
  const candidates = svixSignature.split(' ').map((tok) => tok.split(',')[1]).filter((v): v is string => !!v)
  return candidates.some((candidate) => timingSafeEqual(candidate, expected))
}

// ─── Event shape (confirmed against Resend's docs) ──────────────────────────
interface ResendBounceEvent {
  type: string
  created_at: string
  data: {
    to: string[]
    bounce?: { type: string; subType: string; message: string }
  }
}

interface TenantMatchRow {
  tenant_id: string
  company_name: string | null
  ca_email: string | null
  accountant_email: string | null
}

function norm(s: string | null | undefined): string {
  return String(s || '').trim().toLowerCase()
}

async function notifyOwner(tenantId: string, title: string, body: string): Promise<void> {
  const { data: notifRow } = await supabase.from('p2_notifications').insert({
    tenant_id: tenantId, type: 'email_bounced', title, body, status: 'queued',
  }).select('id').single()
  if (notifRow) {
    fetch(`${SUPABASE_URL}/functions/v1/notify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${ANON_KEY}` },
      body: JSON.stringify({ notification_id: notifRow.id }),
    }).catch(() => {})
  }
}

async function handleBounceOrComplaint(event: ResendBounceEvent): Promise<void> {
  const addresses = (event.data.to || []).map(norm).filter(Boolean)
  if (!addresses.length) return

  // Small tenant count today — fetching every row with either email set and
  // matching case-insensitively in JS avoids needing an RPC for a
  // lower(trim(...)) comparison PostgREST can't express directly. Revisit
  // with an RPC if the book grows large enough for this to matter.
  const { data: tenants } = await supabase
    .from('p2_tenant_settings')
    .select('tenant_id, company_name, ca_email, accountant_email')
    .or('ca_email.not.is.null,accountant_email.not.is.null')

  const reasonLabel = event.type === 'email.complained' ? 'marked as spam' : 'bounced'

  for (const tenant of (tenants || []) as TenantMatchRow[]) {
    const fields: Array<{ column: 'ca_email_invalid' | 'accountant_email_invalid'; label: string; value: string | null }> = [
      { column: 'ca_email_invalid', label: 'CA email', value: tenant.ca_email },
      { column: 'accountant_email_invalid', label: 'accountant email', value: tenant.accountant_email },
    ]

    for (const field of fields) {
      if (!field.value || !addresses.includes(norm(field.value))) continue

      await supabase.from('p2_tenant_settings').update({ [field.column]: true }).eq('tenant_id', tenant.tenant_id)

      await notifyOwner(
        tenant.tenant_id,
        'Filing package email problem',
        `Your ${field.label} (${field.value}) ${reasonLabel}. The filing package was not delivered. Please check the address in Settings → Filing Package.`
      )

      await opsAlert({
        source: 'filing', severity: 'important', title: `${field.label} ${reasonLabel}`,
        body: `${tenant.company_name || tenant.tenant_id} — ${field.value}`,
        dedupeKey: `bounce:${tenant.tenant_id}:${field.column}`,
      })
    }
  }
}

// ─── Deno.serve ──────────────────────────────────────────────────────────────
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS_HEADERS })
  }
  if (req.method !== 'POST') {
    return respond({ status: 'error', error: 'Method not allowed' }, 405)
  }

  // Raw body text is required for signature verification — must not
  // JSON.parse first and re-serialize, the signature is over the exact
  // bytes Resend sent.
  const rawBody = await req.text()

  const verified = await verifyResendSignature(
    rawBody,
    req.headers.get('svix-id'),
    req.headers.get('svix-timestamp'),
    req.headers.get('svix-signature')
  )
  if (!verified) {
    return respond({ status: 'error', error: 'Signature verification failed' }, 401)
  }

  let event: ResendBounceEvent
  try {
    event = JSON.parse(rawBody)
  } catch {
    return respond({ status: 'error', error: 'Invalid JSON' }, 400)
  }

  if (event.type === 'email.bounced' || event.type === 'email.complained') {
    try {
      await handleBounceOrComplaint(event)
    } catch (err) {
      console.error('resend-webhook: handleBounceOrComplaint failed', err)
      // Still 200 — Resend retries on non-200, and a caught internal error
      // here is not something a retry fixes.
    }
  }

  return respond({ status: 'ok' }, 200)
})
