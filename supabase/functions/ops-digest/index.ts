// Supabase Edge Function: ops-digest
// A3 — Daily Operations Digest. One Telegram message a day, to the founder
// only, summarising ops health across every tenant. Not a new detector — A0
// (opsAlert), A2 (compliance-scan) and A6 (filing-package) already detect and
// alert on their own failures. This function's job is to (a) re-surface
// anything still unacknowledged and (b) fold in the "important but not urgent
// enough to page for" tier those automations explicitly deferred here — see
// compliance-scan/index.ts's persistAndEmit(), which says so directly.
//
// verify_jwt = false, same as every other cron-triggered function in this
// codebase — but unlike those, this one also checks a shared-secret header
// (see below) before running any query. It reads across every tenant's
// p2_agent_logs, p2_notifications and p2_job_queue in one call, which makes
// an unauthenticated hit here a worse target than check-low-stock's existing
// gap (tracked separately, execution-plan.md §10 item 7, not fixed by this
// function).
//
// _ai/automation-strategy.md §4.3.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import Anthropic from 'https://esm.sh/@anthropic-ai/sdk@0.32.0'
import { opsAlert, type OpsSeverity } from '../_shared/ops.ts'

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-cron-secret',
}

const supabase = createClient(
  Deno.env.get('SUPABASE_URL') ?? '',
  Deno.env.get('SB_SECRET_KEY') ?? ''
)
const anthropic = new Anthropic({ apiKey: Deno.env.get('ANTHROPIC_API_KEY') ?? '' })
const CRON_SHARED_SECRET = Deno.env.get('CRON_SHARED_SECRET')

function respond(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  })
}

// Byte-for-byte the same fix as agent-query/index.ts's todayIST() — do not
// use getISTDateRange(0).since.split('T')[0] or toISOString().split('T')[0]
// directly on now(); both were confirmed off-by-one for late-evening IST.
function todayIST(): string {
  const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000
  return new Date(Date.now() + IST_OFFSET_MS).toISOString().split('T')[0]
}

const SHORT_MONTHS = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
]

// Built from explicit day/month parts, not a locale-formatted string — en-IN
// renders September as "Sept" (4 letters) and en-US orders it "Sep 17"
// (month first). Neither matches the "17 Sep" / "6 Oct" shape
// automation-strategy.md's own examples use, and no locale string reliably
// gives day-first-plus-3-letter-month without depending on ICU data that can
// differ between Deno versions. Computing it directly removes the ambiguity.
function dayLabelIST(): string {
  const parts = new Date().toLocaleString('en-US', {
    timeZone: 'Asia/Kolkata',
    day: 'numeric',
    month: 'numeric',
  }).split('/') // en-US gives "M/D"
  const month = parseInt(parts[0], 10)
  const day = parseInt(parts[1], 10)
  return `${day} ${SHORT_MONTHS[month - 1]}`
}

// ─── Stage 1: GATHER — bounded queries, no raw table ever reaches Haiku ───
// automation-strategy.md §4.3 draws this as "ONE SQL aggregation pass." There
// is no natural join key across these tables (most don't even carry
// tenant_id), and no precedent in this codebase for one cross-domain SQL
// statement — compliance-scan and filing-package both orchestrate several
// small bounded queries in TypeScript instead. This does the same: one
// orchestration step, N independent count()/limit(5) queries.

interface OpsAlertRow {
  id: string
  title: string
  body: string
  created_at: string
}

interface ComplianceRow {
  title: string
  issue_url: string | null
  created_at: string
}

interface HeartbeatRow {
  job_name: string
  last_success_at: string | null
  last_status: string
  expected_interval_min: number
  stale: boolean
}

interface OpsDigestData {
  tenantCount: number
  criticalOpen: OpsAlertRow[]
  importantOpen: OpsAlertRow[]
  monitorCount24h: number
  jobQueue: { dead: number; stuck: number; queued: number }
  agentLogs: { total24h: number; errors24h: number }
  notificationsFailed24h: number
  complianceImportant: ComplianceRow[]
  heartbeats: HeartbeatRow[]
}

// deno-lint-ignore no-explicit-any
async function countRows(table: string, build: (q: any) => any): Promise<number> {
  const query = build(supabase.from(table).select('id', { count: 'exact', head: true }))
  const { count, error } = await query
  if (error) {
    console.error(`ops-digest: count failed for ${table}`, error)
    return 0
  }
  return count ?? 0
}

async function gatherOpsDigestData(): Promise<OpsDigestData> {
  const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
  const stuckSince = new Date(Date.now() - 30 * 60 * 1000).toISOString()

  const [
    tenantCount,
    criticalOpenRes,
    importantOpenRes,
    monitorCount24h,
    deadJobs,
    stuckJobs,
    queuedJobs,
    agentTotal24h,
    agentErrors24h,
    notificationsFailed24h,
    complianceRes,
    heartbeatRes,
  ] = await Promise.all([
    countRows('p2_tenants', (q) => q),
    supabase
      .from('p2_ops_alerts')
      .select('id, title, body, created_at')
      .eq('severity', 'critical')
      .is('acknowledged_at', null)
      .order('created_at', { ascending: false })
      .limit(5),
    supabase
      .from('p2_ops_alerts')
      .select('id, title, body, created_at')
      .eq('severity', 'important')
      .is('acknowledged_at', null)
      .gte('created_at', since24h)
      .order('created_at', { ascending: false })
      .limit(5),
    countRows('p2_ops_alerts', (q) => q.eq('severity', 'monitor').gte('created_at', since24h)),
    countRows('p2_job_queue', (q) => q.eq('status', 'dead')),
    countRows('p2_job_queue', (q) => q.eq('status', 'running').lt('claimed_at', stuckSince)),
    countRows('p2_job_queue', (q) => q.eq('status', 'queued')),
    countRows('p2_agent_logs', (q) => q.gte('created_at', since24h)),
    countRows('p2_agent_logs', (q) => q.eq('success', false).gte('created_at', since24h)),
    countRows('p2_notifications', (q) => q.eq('status', 'failed').gte('created_at', since24h)),
    supabase
      .from('p2_compliance_watch')
      .select('title, issue_url, created_at')
      .eq('classification', 'important')
      .eq('status', 'issue_opened')
      .gte('created_at', since24h)
      .order('created_at', { ascending: false })
      .limit(5),
    supabase
      .from('p2_cron_heartbeat')
      .select('job_name, last_success_at, last_status, expected_interval_min'),
  ])

  if (criticalOpenRes.error) console.error('ops-digest: criticalOpen query failed', criticalOpenRes.error)
  if (importantOpenRes.error) console.error('ops-digest: importantOpen query failed', importantOpenRes.error)
  if (complianceRes.error) console.error('ops-digest: compliance query failed', complianceRes.error)
  if (heartbeatRes.error) console.error('ops-digest: heartbeat query failed', heartbeatRes.error)

  const nowMs = Date.now()
  const heartbeats: HeartbeatRow[] = ((heartbeatRes.data ?? []) as Array<{
    job_name: string
    last_success_at: string | null
    last_status: string
    expected_interval_min: number
  }>).map((row) => {
    const staleThresholdMs = row.expected_interval_min * 2 * 60 * 1000
    const stale = !row.last_success_at || nowMs - new Date(row.last_success_at).getTime() > staleThresholdMs
    return { ...row, stale }
  })

  return {
    tenantCount,
    criticalOpen: (criticalOpenRes.data ?? []) as OpsAlertRow[],
    importantOpen: (importantOpenRes.data ?? []) as OpsAlertRow[],
    monitorCount24h,
    jobQueue: { dead: deadJobs, stuck: stuckJobs, queued: queuedJobs },
    agentLogs: { total24h: agentTotal24h, errors24h: agentErrors24h },
    notificationsFailed24h,
    complianceImportant: (complianceRes.data ?? []) as ComplianceRow[],
    heartbeats,
  }
}

// ─── Severity — deterministic, never the model's job ──────────────────────

function computeSeverity(data: OpsDigestData): OpsSeverity {
  if (data.criticalOpen.length > 0) return 'critical'
  const staleCount = data.heartbeats.filter((h) => h.stale).length
  const actionable =
    data.importantOpen.length +
    data.jobQueue.dead +
    data.jobQueue.stuck +
    data.notificationsFailed24h +
    data.complianceImportant.length +
    staleCount
  return actionable > 0 ? 'important' : 'monitor'
}

// ─── Deterministic fallback — never absent, never more alarming than the
// counts actually support. Same posture as compliance-scan's fallback path. ──

function buildDeterministicNarrative(data: OpsDigestData): string {
  const lines: string[] = []
  if (data.criticalOpen.length) {
    lines.push(`${data.criticalOpen.length} critical alert(s) still unacknowledged.`)
  }
  if (data.importantOpen.length) {
    lines.push(`${data.importantOpen.length} important alert(s) in the last 24h.`)
  }
  if (data.jobQueue.dead) lines.push(`${data.jobQueue.dead} dead job(s) in the filing queue.`)
  if (data.jobQueue.stuck) lines.push(`${data.jobQueue.stuck} job(s) stuck running over 30 minutes.`)
  if (data.notificationsFailed24h) {
    lines.push(`${data.notificationsFailed24h} failed tenant notification(s) in the last 24h.`)
  }
  if (data.complianceImportant.length) {
    lines.push(`${data.complianceImportant.length} compliance item(s) awaiting review.`)
  }
  const staleJobs = data.heartbeats.filter((h) => h.stale).map((h) => h.job_name)
  if (staleJobs.length) lines.push(`Cron(s) overdue: ${staleJobs.join(', ')}.`)

  const summary = `${data.tenantCount} tenant(s). Agent: ${data.agentLogs.total24h} queries, ${data.agentLogs.errors24h} errors (24h).`

  if (lines.length === 0) return `All good. ${summary}`
  return `${lines.join(' ')} ${summary}`
}

// ─── Stage 2: NARRATE — Haiku, fixed input shape, no judgment ─────────────
// Mirrors compliance-scan/index.ts's summariseAndClassify() call mechanics:
// same model, same JSON-in/JSON-out shape, same fence-stripping, same
// try/catch-to-fallback.

function extractTextBlock(response: { content: Array<{ type: string; text?: string }> }): string {
  const block = response.content.find((b) => b.type === 'text')
  return block && block.type === 'text' && block.text ? block.text : ''
}

async function callHaikuNarrative(data: OpsDigestData): Promise<string> {
  try {
    const systemPrompt = `You write a daily operations digest for the founder of a small SaaS product. You are given a JSON summary of counts and short item lists gathered from the database — never raw logs, and you must never invent a number, a tenant name, or a cause that is not present in the input. Write the message BODY only — no title line, no signature, those are added separately by code. Rules: (1) If nothing needs attention (no critical or important items, no stale crons), start with "All good." and give one or two lines covering tenant count, agent usage, and cron health. (2) If something needs attention, start with "⚠ N item(s) need you." (N = count of critical + important items + stale crons), then a numbered list, each line starting with CRITICAL or IMPORTANT in capitals, naming the specific item using only the facts given. Follow the numbered list with one "Everything else:" line covering tenant count, agent queries/errors, and cron health. (3) Plain text only, no markdown, no asterisks, no headers. (4) Maximum 200 words, prefer the shortest accurate phrasing.`
    const userPrompt = `Date: ${dayLabelIST()}\n\nData:\n${JSON.stringify(data)}\n\nRespond with ONLY valid JSON in exactly this shape:\n{ "narrative": "the message body, plain text, <= 200 words" }`

    const response = await anthropic.messages.create({
      model: 'claude-haiku-4-5',
      max_tokens: 500,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
    })

    const raw = extractTextBlock(response)
      .replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```\s*$/i, '').trim()
    const parsed = JSON.parse(raw)
    if (typeof parsed.narrative !== 'string' || parsed.narrative.trim() === '') {
      throw new Error('narrative missing or empty')
    }
    let narrative = parsed.narrative.trim()

    // Word cap enforced in code, not trusted from the model (§2 test 1: this
    // is a hard design constraint, not a suggestion). Truncate at the last
    // full sentence before 200 words rather than mid-sentence.
    const words = narrative.split(/\s+/)
    if (words.length > 220) {
      const truncated = words.slice(0, 200).join(' ')
      const lastPeriod = truncated.lastIndexOf('.')
      narrative = lastPeriod > 0 ? truncated.slice(0, lastPeriod + 1) : truncated
      console.error('ops-digest: Haiku narrative exceeded word cap, truncated', { originalWords: words.length })
    }

    return narrative
  } catch (err) {
    console.error('ops-digest: Haiku narrative failed, falling back to deterministic', err)
    return buildDeterministicNarrative(data)
  }
}

// ─── Entry point ────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS_HEADERS })
  }

  // Auth gate — checked before any query runs. This function reads across
  // every tenant's p2_agent_logs/p2_notifications/p2_job_queue/p2_ops_alerts/
  // p2_compliance_watch in one call; unlike the five pre-existing
  // verify_jwt=false cron functions in this codebase, this one is new, so
  // there is no retrofit cost to paying for real inbound auth from day one.
  if (!CRON_SHARED_SECRET || req.headers.get('x-cron-secret') !== CRON_SHARED_SECRET) {
    return respond({ status: 'error', error: 'unauthorized' }, 401)
  }

  const body = await req.json().catch(() => ({} as Record<string, unknown>))
  const dryRun = (body as Record<string, unknown>).action === 'dry_run'

  const data = await gatherOpsDigestData()
  const narrative = await callHaikuNarrative(data)
  const severity = computeSeverity(data)
  const title = `Nexflow ops — ${dayLabelIST()}`

  if (dryRun) {
    // Computes everything, sends nothing, writes nothing — lets the two
    // output shapes be verified without burning the daily dedupe slot.
    return respond({
      status: 'ok',
      dry_run: true,
      severity,
      title,
      body: narrative,
      data,
    })
  }

  // dedupeKey pinned to today's IST calendar date, not a random/per-run key —
  // this is what makes "never a second daily message" hold even if the cron
  // double-fires (retry, manual trigger, overlapping invocation). A rolling
  // 24h window naturally rolls over once a day at the IST date boundary.
  await opsAlert({
    source: 'digest',
    severity,
    title,
    body: narrative,
    dedupeKey: `daily-${todayIST()}`,
    dedupeWindowHours: 20,
  })

  return respond({ status: 'ok', severity, title, body: narrative })
})
