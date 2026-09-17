// Supabase Edge Function: compliance-scan
// A2 — weekly GST compliance monitoring. Reads CBIC/GSTN publications, checks
// whether anything published touches a statutory value Nexflow has
// hardcoded (via _ai/compliance-constants.json — never the model's job, R1),
// and escalates CRITICAL hits to the founder + a GitHub issue. Never edits
// code, opens a PR, or changes a constant (R2, out of scope permanently) —
// this function produces a citation, not a patch.
//
// verify_jwt = false — cron-triggered, anon key in the Authorization header
// (never validated as a real JWT), SB_SECRET_KEY inside grants DB access.
// Same pattern as check-low-stock / notify / filing-package / schema-drift.
//
// ── BUILD STATUS: FETCH LIVE FOR BOTH CBIC SOURCES, GSTN STILL STUBBED ──────
// fetchComplianceFeed() is real for 'cbic_rate' and 'cbic_central' — two
// distinct CBIC notification series, both confirmed by hand as static HTML
// (compliance-monitoring.md §5). 'gstn' still throws FeedNotConfiguredError:
// gst.gov.in/newsandupdates was checked during planning and is JS-hydrated —
// dropped per §5's own rule ("do not add a headless browser") — and no
// static replacement has been found. Everything downstream of FETCH
// (dedupe, Haiku summarise+classify, the Opus CRITICAL gate, GitHub issue
// creation, opsAlert wiring, the failure counter) is fully wired and is also
// reachable independently of a live fetch via the {action:'test_pipeline'}
// branch in Deno.serve, for synthetic-data testing.
//
// Architecture: _ai/compliance-monitoring.md §2, §4, §5, §8.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import Anthropic from 'https://esm.sh/@anthropic-ai/sdk@0.32.0'
import { opsAlert } from '../_shared/ops.ts'

// _ai/compliance-constants.json is the single checked-in inventory of every
// statutory constant Nexflow hardcodes (Object 1 of the A2 build). Imported
// directly rather than duplicated into this function's own directory, so
// there is exactly one copy in the repo — the same reasoning that makes the
// file worth building in the first place. NEEDS VERIFICATION AT FIRST REAL
// DEPLOY: Supabase's Edge Function bundler (esbuild-based) is expected to
// follow this relative import outside supabase/functions/ and inline it at
// deploy time, matching how any other local relative import is bundled, but
// nothing in this codebase has imported a file from outside
// supabase/functions/ before now — confirm with `supabase functions deploy
// compliance-scan --dry-run` (or equivalent) before relying on it in
// production.
import complianceConstants from '../../../_ai/compliance-constants.json' with { type: 'json' }

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const supabase = createClient(
  Deno.env.get('SUPABASE_URL') ?? '',
  Deno.env.get('SB_SECRET_KEY') ?? ''
)
const anthropic = new Anthropic({ apiKey: Deno.env.get('ANTHROPIC_API_KEY') ?? '' })

const GITHUB_REPO_OWNER = 'arjunnjadhav9-commits'
const GITHUB_REPO_NAME = 'nexflow-p2'

// Hard cap per source per run, per compliance-monitoring.md §5's bound —
// an unbounded first run against a multi-year archive costs more than a
// year of scans.
const MAX_ITEMS_PER_SOURCE = 40
// First run seeds the "newer than" floor at now() - 30 days, not the epoch —
// also §5.
const FIRST_RUN_LOOKBACK_DAYS = 30

function respond(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  })
}

// ─── Types ───────────────────────────────────────────────────────────────

interface ComplianceConstantEntry {
  area: string
  const: string
  locations: string[]
  current: unknown
  authority: string
  confirmed_by_ca: string | null
  severity: 'critical' | 'important' | 'monitor'
  status?: string
  note?: string
}

const CONSTANTS = complianceConstants as ComplianceConstantEntry[]
const VALID_AREAS = new Set(CONSTANTS.map((c) => c.area))

// Three notification series, tracked independently: cbic_rate and
// cbic_central are two distinct CBIC listings (Rate vs plain Central Tax —
// see the FETCH section below for why both are needed), gstn stays
// reserved for a future static GSTN source.
type ComplianceSource = 'cbic_rate' | 'cbic_central' | 'gstn'

// What FETCH is contracted to produce, once it exists. Kept here so the
// downstream pipeline has a real interface to code and test against
// regardless of which stage is currently stubbed.
interface FeedItem {
  source: ComplianceSource
  doc_id: string // notification number, or a stable hash of the URL
  title: string
  url: string
  published_at: string | null // ISO date
  body_text: string // truncated to 2000 chars before this point, per spec
}

type Classification = 'critical' | 'important' | 'monitor'

interface HaikuSummaryResult {
  summary: string
  area: string // constrained to VALID_AREAS ∪ {'none'} after validation
  proposed_classification: Classification
  effective_date: string | null
}

// ─── Stage 1: FETCH ──────────────────────────────────────────────────────
// Both CBIC sources are real (confirmed URLs, 2026-09-17 — see
// compliance-monitoring.md §5). GSTN stays stubbed: gst.gov.in/newsandupdates
// is confirmed JS-hydrated and dropped per that section's own rule (no
// headless browser added for a Deno Edge Function). No replacement GSTN
// source was found.

class FeedNotConfiguredError extends Error {
  constructor(source: string) {
    super(`compliance-scan: FETCH stage not implemented for source '${source}'. See compliance-monitoring.md §5.`)
    this.name = 'FeedNotConfiguredError'
  }
}

// Both confirmed by hand, 2026-09-17, at their /hindi/ paths — the
// non-/hindi/ variant of the Rate URL 404s from this environment; the
// /hindi/ pages were confirmed reachable twice. Table CONTENT (notification
// number, date, subject, both PDF links) is identical between the Hindi-
// and English-language pages per direct confirmation — only the page's own
// UI chrome differs — so the Subject cell used as Haiku's SUMMARISE input
// is not actually Hindi text, and fetching the /hindi/ path costs nothing
// in classification quality.
//
// cbic_rate:    Central Tax (RATE) series — GST rate/exemption changes on
//               specific goods and services.
// cbic_central: Central Tax (PLAIN) series — the series that actually
//               carries B2CL, e-invoicing thresholds and CGST Rules
//               amendments, i.e. the constants this inventory tracks. This
//               is the series the original 12/2024-Central Tax B2CL
//               notification belongs to — cbic_rate alone would not have
//               carried it.
const CBIC_RATE_URL = 'https://cbic-gst.gov.in/hindi/central-tax-rate.html'
const CBIC_CENTRAL_URL = 'https://cbic-gst.gov.in/hindi/central-tax-notifications.html'

function stripTags(html: string): string {
  return html
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, ' ')
    .trim()
}

function extractHref(cellHtml: string): string | null {
  const match = cellHtml.match(/<a\b[^>]*href=["']([^"']+)["']/i)
  return match ? match[1] : null
}

function resolveUrl(href: string, base: string): string {
  if (/^https?:\/\//i.test(href)) return href
  if (href.startsWith('/')) return `${new URL(base).origin}${href}`
  return new URL(href, base).toString()
}

// FNV-1a — the same hashing scheme filing-package/index.ts already uses for
// its REMOTEID column, reused here as the fallback doc_id when a row's
// notification-number cell doesn't match the expected "NN/YYYY" pattern.
// doc_id must be stable across runs (it's the dedupe key), so a hash of the
// row's own text is the right fallback, not a random id.
function fnv1aHash(str: string): string {
  let hash = 0x811c9dc5
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
}

// Best-effort extraction of a notification number ("NN/YYYY") and a date
// (DD-MM-YYYY or DD/MM/YYYY) out of the first cell's free text. The exact
// byte-for-byte markup of this cell was not directly inspected before
// writing this — this session's fetch tooling summarises pages through an
// LLM pass rather than returning raw HTML, so this needs validating against
// a real invocation (the {action:'test_pipeline'} path, or a manual run)
// before being trusted blindly. A row that doesn't match either pattern is
// NOT dropped — it falls back to a hash-derived doc_id and a null
// published_at, so a markup surprise degrades gracefully instead of losing
// the row outright.
function parseNotificationCell(text: string, docIdPrefix: string): { docId: string; publishedAt: string | null } {
  const numMatch = text.match(/(\d{1,4}\/\d{4})/)
  const dateMatch = text.match(/(\d{1,2})[-/](\d{1,2})[-/](\d{4})/)
  const docId = numMatch ? `${docIdPrefix}-${numMatch[1].replace(/\//g, '-')}` : `${docIdPrefix}-${fnv1aHash(text)}`
  let publishedAt: string | null = null
  if (dateMatch) {
    const [, dd, mm, yyyy] = dateMatch
    publishedAt = `${yyyy}-${mm.padStart(2, '0')}-${dd.padStart(2, '0')}`
  }
  return { docId, publishedAt }
}

// Regex-based row/cell extraction, deliberately not a DOM-parsing library.
// This project has already hit real CPU-budget problems in Edge Functions
// from heavy esm.sh dependencies (CLAUDE.md "Architecture decisions
// (locked)" — server-side jsPDF was abandoned for exactly this reason). Both
// CBIC pages are static, structurally-identical tables ("same table
// structure, same regex parser" — confirmed by hand), so one hand-rolled
// extractor parametrized by URL/source/doc_id-prefix serves both rather
// than two near-duplicate functions.
async function fetchCbicTable(url: string, source: 'cbic_rate' | 'cbic_central', docIdPrefix: string): Promise<FeedItem[]> {
  const res = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; nexflow-compliance-scan/1.0)' },
  })
  if (!res.ok) throw new Error(`CBIC fetch failed for ${source}: HTTP ${res.status}`)
  const html = await res.text()

  const rowMatches = [...html.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)]
  const items: FeedItem[] = []

  for (const rowMatch of rowMatches) {
    const cellMatches = [...rowMatch[1].matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)]
    if (cellMatches.length < 4) continue // header row or malformed row — skip, never guess

    const [notifCell, englishCell, , subjectCell] = cellMatches.map((m) => m[1])
    const notifText = stripTags(notifCell)
    const englishHref = extractHref(englishCell)
    const subjectText = stripTags(subjectCell)
    if (!notifText || !englishHref || !subjectText) continue // not a real notification row

    const { docId, publishedAt } = parseNotificationCell(notifText, docIdPrefix)
    items.push({
      source,
      doc_id: docId,
      title: `${notifText} — ${subjectText}`.slice(0, 300),
      url: resolveUrl(englishHref, url),
      published_at: publishedAt,
      body_text: subjectText, // PDF text extraction is out of scope for v1 — subject line only
    })
  }

  return items
}

// MAX(published_at) for this source, or the 30-day floor on an empty table
// (never all-time — compliance-monitoring.md §5). Per-source, independent —
// cbic_rate and cbic_central each track their own high-water mark.
async function getLastSeenAt(source: ComplianceSource): Promise<string> {
  const { data, error } = await supabase
    .from('p2_compliance_watch')
    .select('published_at')
    .eq('source', source)
    .not('published_at', 'is', null)
    .order('published_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) console.error(`compliance-scan: getLastSeenAt(${source}) query failed, using 30-day floor`, error)

  if (data?.published_at) return data.published_at as string
  const floor = new Date()
  floor.setUTCDate(floor.getUTCDate() - FIRST_RUN_LOOKBACK_DAYS)
  return floor.toISOString().slice(0, 10)
}

// Newest-first, undated rows pushed last, so the MAX_ITEMS_PER_SOURCE cap
// (applied by the caller) keeps the most recent real-dated items on a
// table whose own row order is not guaranteed. Shared by both CBIC sources.
function boundToRecent(items: FeedItem[], lastSeenAt: string): FeedItem[] {
  const filtered = items.filter((item) => !item.published_at || item.published_at > lastSeenAt)
  filtered.sort((a, b) => (b.published_at ?? '').localeCompare(a.published_at ?? ''))
  return filtered
}

// Deliberately throws for an unconfigured source rather than returning [].
// A silent empty result would look identical to "checked and found
// nothing new" — which would let the weekly cron run forever reporting
// false all-clear for a source nobody actually implemented. Caught by the
// top-level handler and reported distinctly from a real network failure
// (see runScan below) so it never trips the "feed unreachable for 2
// consecutive weeks" alert for what is a known, deliberate build gap
// rather than an operational one.
async function fetchComplianceFeed(source: ComplianceSource): Promise<FeedItem[]> {
  if (source === 'gstn') throw new FeedNotConfiguredError(source)

  const url = source === 'cbic_rate' ? CBIC_RATE_URL : CBIC_CENTRAL_URL
  const docIdPrefix = source === 'cbic_rate' ? 'cbic-rate' : 'cbic-central'
  const all = await fetchCbicTable(url, source, docIdPrefix)
  const lastSeenAt = await getLastSeenAt(source)
  return boundToRecent(all, lastSeenAt)
}

// ─── Stage 2: FILTER (dedupe against what's already been seen) ─────────

async function filterNewItems(items: FeedItem[]): Promise<FeedItem[]> {
  if (items.length === 0) return []
  const bySource = new Map<string, Set<string>>()
  for (const item of items) {
    if (!bySource.has(item.source)) bySource.set(item.source, new Set())
  }
  for (const [source] of bySource) {
    const { data, error } = await supabase
      .from('p2_compliance_watch')
      .select('doc_id')
      .eq('source', source)
      .in('doc_id', items.filter((i) => i.source === source).map((i) => i.doc_id))
    if (error) {
      console.error('compliance-scan: filterNewItems query failed', error)
      continue // fail open on the dedupe check itself — same posture as opsAlert's own dedupe gate
    }
    for (const row of data ?? []) bySource.get(source)!.add(row.doc_id as string)
  }
  return items.filter((item) => !bySource.get(item.source)?.has(item.doc_id))
}

// ─── Stage 3+5 combined: SUMMARISE + CLASSIFY (one Haiku call) ─────────
// compliance-monitoring.md draws these as separate pipeline stages, but its
// own cost table ("Haiku summarise + classify, ~15 items/week, 3k in/500 out
// EACH") prices them as one call per item, not two — combined here to match
// the priced design and halve the real per-item Haiku cost.

function extractTextBlock(response: { content: Array<{ type: string; text?: string }> }): string {
  const block = response.content.find((b) => b.type === 'text')
  return block && block.type === 'text' && block.text ? block.text : ''
}

function parseHaikuJson(raw: string): { summary: string; area: string; proposed_classification: string; effective_date: string | null } {
  const stripped = raw.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```\s*$/i, '').trim()
  const parsed = JSON.parse(stripped) // throws if invalid — caught by caller
  if (parsed === null || typeof parsed !== 'object') throw new Error('Response is not an object')
  if (typeof parsed.summary !== 'string' || parsed.summary.trim() === '') throw new Error('summary missing or empty')
  if (typeof parsed.area !== 'string') throw new Error('area missing')
  if (typeof parsed.proposed_classification !== 'string') throw new Error('proposed_classification missing')
  return {
    summary: parsed.summary.trim(),
    area: parsed.area.trim(),
    proposed_classification: parsed.proposed_classification.trim(),
    effective_date: typeof parsed.effective_date === 'string' ? parsed.effective_date : null,
  }
}

// Deterministic — never the model's job (R1). Best-effort area guess used
// only on the Haiku-failure fallback path, where there is no model output
// to constrain in the first place. Checks the raw title against each
// inventory area's slug (underscores → spaces) as a plain substring match.
function deterministicAreaGuess(title: string): string {
  const lower = title.toLowerCase()
  for (const entry of CONSTANTS) {
    const words = entry.area.replace(/_/g, ' ')
    if (lower.includes(words)) return entry.area
  }
  return 'none'
}

async function summariseAndClassify(item: FeedItem): Promise<HaikuSummaryResult> {
  // BUG FIX (found in production, 2026-09-17): userPrompt construction used
  // to sit OUTSIDE this try block, and called item.body_text.slice(...)
  // unguarded. A caller-supplied item missing body_text (e.g. an
  // incomplete test_pipeline payload) threw a TypeError before
  // anthropic.messages.create() was ever invoked — before any external
  // call, exactly as reported — which completely bypassed the "model
  // failure" fallback below, since the throw happened before the try even
  // started. Fix: everything that reads item's fields now lives inside
  // try, and every field is defensively defaulted, so malformed/incomplete
  // input degrades to the same fallback path a real Haiku failure does,
  // rather than crashing the request. R3 ("never absent") now actually
  // holds for bad input, not just network/parse failures.
  try {
    const areaEnum = [...VALID_AREAS, 'none'].join(', ')
    const systemPrompt = `You are a GST/CBIC compliance triage assistant for an Indian SaaS product. Given one notification's title and body text, do three things: (1) summarise what changed in plain English, <= 60 words, (2) decide if it affects one of a fixed list of known constant "areas" the product hardcodes, and (3) propose a severity. You do not see the codebase and must never invent a file path or line number — that is done separately, deterministically, by code. The "area" field MUST be exactly one value from this list, or the literal string "none" if nothing matches: ${areaEnum}. Never invent a new area value. Severity guide: "critical" = this notification appears to directly change a value the product currently hardcodes; "important" = related but not a direct value change (e.g. a new form, a procedural change); "monitor" = tangentially related or unclear.`
    const bodyText = item.body_text ?? ''
    const userPrompt = `Title: ${item.title ?? 'unknown'}\nSource: ${item.source}\nPublished: ${item.published_at ?? 'unknown'}\nURL: ${item.url}\n\nBody (truncated):\n${bodyText.slice(0, 2000)}\n\nRespond with ONLY valid JSON in exactly this shape:\n{ "summary": "plain English, <= 60 words", "area": "one of the listed areas, or none", "proposed_classification": "critical | important | monitor", "effective_date": "YYYY-MM-DD or null" }`

    const response = await anthropic.messages.create({
      model: 'claude-haiku-4-5',
      max_tokens: 500,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
    })
    const parsed = parseHaikuJson(extractTextBlock(response))
    const area = VALID_AREAS.has(parsed.area) ? parsed.area : 'none'
    const classification: Classification = (['critical', 'important', 'monitor'] as const).includes(parsed.proposed_classification as Classification)
      ? (parsed.proposed_classification as Classification)
      : 'monitor'
    return { summary: parsed.summary, area, proposed_classification: classification, effective_date: parsed.effective_date }
  } catch (err) {
    // Model failure fallback: raw title + deterministic grep hit. Shorter,
    // never absent (R3) — and never more alarming than 'monitor', since a
    // degraded path must never be the thing that pages the founder. Every
    // field defensively defaulted — this block itself must never throw,
    // or the fallback has the exact same bug it exists to guard against.
    console.error('compliance-scan: Haiku summarise+classify failed, falling back', err)
    const title = item?.title ?? '(no title)'
    return {
      summary: title.slice(0, 200),
      area: deterministicAreaGuess(title),
      proposed_classification: 'monitor',
      effective_date: null,
    }
  }
}

// ─── Stage 4: LOCATE — deterministic grep only, never the model's job ──

function locateEntry(area: string): ComplianceConstantEntry | null {
  if (area === 'none') return null
  return CONSTANTS.find((c) => c.area === area) ?? null
}

// ─── Stage 5b: the Opus CRITICAL gate (rule R1a — demote-only) ─────────
// Opus is called ONLY when Haiku proposed 'critical' AND the matched
// inventory entry's own severity is 'critical' — every other combination is
// resolved by the deterministic ceiling below with no model call at all,
// which is what keeps this to ~2 calls/week against ~15 items/week (the
// cost table in both design docs), not one Opus call per item.

async function opusConfirmCritical(item: FeedItem, entry: ComplianceConstantEntry, haikuSummary: string): Promise<{ confirmed: boolean; reason: string }> {
  const systemPrompt = 'You are confirming or downgrading a proposed CRITICAL compliance alert before it pages a founder at odd hours. You will be shown one notification and the one statutory constant it was matched against — nothing else, no codebase access. Answer only whether THIS notification actually changes the value of THIS constant. You may only confirm or downgrade; you can never escalate anything to a higher severity than what was proposed.'
  const userPrompt = `Notification: ${item.title}\nSummary: ${haikuSummary}\nSource URL: ${item.url}\n\nMatched constant:\nArea: ${entry.area}\nConstant: ${entry.const}\nCurrent value: ${JSON.stringify(entry.current)}\nAuthority: ${entry.authority}\nCA-confirmed: ${entry.confirmed_by_ca ?? 'never'}\n\nDoes this notification change the value of this constant? Respond with ONLY valid JSON: { "confirmed": true | false, "reason": "one sentence" }`

  try {
    const response = await anthropic.messages.create({
      model: 'claude-opus-5',
      max_tokens: 500,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
    })
    const raw = extractTextBlock(response).replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```\s*$/i, '').trim()
    const parsed = JSON.parse(raw)
    if (typeof parsed.confirmed !== 'boolean') throw new Error('confirmed field missing or not boolean')
    return { confirmed: parsed.confirmed, reason: typeof parsed.reason === 'string' ? parsed.reason : '' }
  } catch (err) {
    // Opus failure: degrade toward less urgency, never more. Emitted as
    // IMPORTANT with opus_confirmed = null (handled by the caller).
    console.error('compliance-scan: Opus CRITICAL gate failed, demoting to IMPORTANT', err)
    throw err
  }
}

// Resolves the final classification: Haiku's proposal, capped by the
// matched entry's own severity (a hard ceiling — R1a), gated through Opus
// only in the one case where a real CRITICAL is actually possible.
async function resolveClassification(
  item: FeedItem,
  haiku: HaikuSummaryResult,
  entry: ComplianceConstantEntry | null
): Promise<{ classification: Classification; opusConfirmed: boolean | null }> {
  const ceiling: Classification = entry?.severity ?? 'monitor'
  const rank: Record<Classification, number> = { critical: 2, important: 1, monitor: 0 }
  const capped: Classification = rank[haiku.proposed_classification] > rank[ceiling] ? ceiling : haiku.proposed_classification

  if (capped !== 'critical') {
    return { classification: capped, opusConfirmed: null }
  }

  try {
    const gate = await opusConfirmCritical(item, entry!, haiku.summary)
    return { classification: gate.confirmed ? 'critical' : 'important', opusConfirmed: gate.confirmed }
  } catch {
    return { classification: 'important', opusConfirmed: null }
  }
}

// ─── Stage 6: EMIT ───────────────────────────────────────────────────────

async function createGithubIssue(item: FeedItem, entry: ComplianceConstantEntry | null, haiku: HaikuSummaryResult, classification: Classification, opusReason: string | null): Promise<{ issueUrl: string | null; tokenMissing: boolean; apiError: string | null }> {
  const body = buildIssueBody(item, entry, haiku, classification, opusReason)
  const labels = classification === 'critical' ? ['compliance/critical'] : ['compliance/important']

  const token = Deno.env.get('GITHUB_TOKEN')
  if (!token) {
    return { issueUrl: null, tokenMissing: true, apiError: null }
  }

  try {
    const res = await fetch(`https://api.github.com/repos/${GITHUB_REPO_OWNER}/${GITHUB_REPO_NAME}/issues`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'Content-Type': 'application/json',
        'User-Agent': 'nexflow-compliance-scan',
      },
      body: JSON.stringify({ title: `Compliance: ${item.title}`, body, labels }),
    })
    if (!res.ok) {
      const text = await res.text().catch(() => '')
      return { issueUrl: null, tokenMissing: false, apiError: `GitHub API ${res.status}: ${text.slice(0, 300)}` }
    }
    const json = await res.json()
    return { issueUrl: json.html_url ?? null, tokenMissing: false, apiError: null }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'unknown fetch error'
    return { issueUrl: null, tokenMissing: false, apiError: message }
  }
}

function buildIssueBody(item: FeedItem, entry: ComplianceConstantEntry | null, haiku: HaikuSummaryResult, classification: Classification, opusReason: string | null): string {
  const lines = [
    `**Effective:** ${haiku.effective_date ?? 'unknown'}   ·   **Published:** ${item.published_at ?? 'unknown'}`,
    `**Source:** ${(item.source ?? 'unknown').toUpperCase()}`,
    `**URL:** ${item.url}`,
    '',
    '### What changed',
    haiku.summary,
    '',
    '### What Nexflow hardcodes',
  ]
  if (entry) {
    lines.push(
      '| | |',
      '|---|---|',
      `| Area | \`${entry.area}\` |`,
      `| Constant | \`${entry.const}\` |`,
      `| Current value | \`${JSON.stringify(entry.current)}\` |`,
      `| Set from | ${entry.authority} |`,
      `| CA-confirmed | ${entry.confirmed_by_ca ?? '**never**'} |`,
      '',
      '### Where',
      ...entry.locations.map((l) => `- ${l}`)
    )
  } else {
    lines.push('No matching entry in `_ai/compliance-constants.json` — area was `none`.')
  }
  const proposalLine = haiku.proposed_classification === classification
    ? `Haiku proposed: ${haiku.proposed_classification.toUpperCase()}.${opusReason ? ` Opus: "${opusReason}"` : ''}`
    : `Haiku proposed: ${haiku.proposed_classification.toUpperCase()}, demoted to **${classification.toUpperCase()}**.${opusReason ? ` Opus: "${opusReason}"` : ' (severity ceiling on this area)'}`
  lines.push(
    '',
    '### Classification',
    `**Final: ${classification.toUpperCase()}**`,
    proposalLine,
    '',
    '---',
    '*Opened by compliance-scan. A2 does not change code. This issue is a citation, not a patch.*'
  )
  return lines.join('\n')
}

async function persistAndEmit(item: FeedItem, haiku: HaikuSummaryResult, entry: ComplianceConstantEntry | null, classification: Classification, opusConfirmed: boolean | null, opusReason: string | null) {
  let issueUrl: string | null = null

  if (classification === 'critical' || classification === 'important') {
    const result = await createGithubIssue(item, entry, haiku, classification, opusReason)
    issueUrl = result.issueUrl
    if (result.tokenMissing) {
      // Object 4: never fail or skip the alert just because the token is
      // absent — fold the issue text into the opsAlert body instead.
      await opsAlert({
        source: 'compliance',
        severity: classification === 'critical' ? 'critical' : 'important',
        title: `[GITHUB_TOKEN not set] ${item.title}`,
        body: buildIssueBody(item, entry, haiku, classification, opusReason),
        dedupeKey: `${item.source}:${item.doc_id}`,
      })
    } else if (result.apiError) {
      await opsAlert({
        source: 'compliance',
        severity: 'important',
        title: 'compliance-scan: GitHub issue creation failed',
        body: `${item.title} — ${result.apiError}`,
        dedupeKey: `github-issue-failed:${item.source}:${item.doc_id}`,
      })
    } else if (classification === 'critical') {
      await opsAlert({
        source: 'compliance',
        severity: 'critical',
        title: item.title,
        body: haiku.summary + (issueUrl ? `\n\n${issueUrl}` : ''),
        dedupeKey: `${item.source}:${item.doc_id}`,
      })
    }
    // 'important' classification: no immediate opsAlert — folded into the
    // weekly digest per spec (A3, not yet built). The GitHub issue above is
    // the durable record in the meantime.
  }
  // 'monitor': no issue, no alert — the p2_compliance_watch row is the
  // entire output.

  const { error } = await supabase.from('p2_compliance_watch').upsert(
    {
      source: item.source,
      doc_id: item.doc_id,
      title: item.title,
      url: item.url,
      published_at: item.published_at,
      effective_date: haiku.effective_date,
      summary: haiku.summary,
      area: entry?.area ?? 'none',
      classification,
      haiku_proposed: haiku.proposed_classification,
      opus_confirmed: opusConfirmed,
      issue_url: issueUrl,
      status: issueUrl ? 'issue_opened' : 'new',
    },
    { onConflict: 'source,doc_id' }
  )
  if (error) console.error('compliance-scan: p2_compliance_watch upsert failed', error)
}

// ─── Failure-counter handling (feed unreachable → 2-week alert) ────────

async function recordFetchOutcome(success: boolean): Promise<void> {
  const { data: state, error: readError } = await supabase
    .from('p2_compliance_scan_state')
    .select('consecutive_failures')
    .eq('id', true)
    .single()
  if (readError) {
    console.error('compliance-scan: could not read p2_compliance_scan_state', readError)
    return
  }

  if (success) {
    await supabase
      .from('p2_compliance_scan_state')
      .update({ consecutive_failures: 0, last_attempt_at: new Date().toISOString(), last_success_at: new Date().toISOString() })
      .eq('id', true)
    return
  }

  const nextCount = (state?.consecutive_failures ?? 0) + 1
  await supabase
    .from('p2_compliance_scan_state')
    .update({ consecutive_failures: nextCount, last_attempt_at: new Date().toISOString() })
    .eq('id', true)

  if (nextCount >= 2) {
    await opsAlert({
      source: 'compliance',
      severity: 'important',
      title: 'Compliance feed unreachable for 2 weeks',
      body: `compliance-scan has failed to fetch ${nextCount} weeks in a row. Check the feed URL is still valid.`,
      dedupeKey: 'compliance-feed-unreachable',
      dedupeWindowHours: 24 * 6, // once per run, not once per day, while it stays broken
    })
  }
}

// ─── Entry point ─────────────────────────────────────────────────────────

async function runScan(sources: ComplianceSource[]): Promise<{ processed: number; skippedFetchNotConfigured: string[] }> {
  const skipped: string[] = []
  const allNew: FeedItem[] = []
  let anyRealFailure = false

  for (const source of sources) {
    try {
      const raw = await fetchComplianceFeed(source)
      allNew.push(...raw.slice(0, MAX_ITEMS_PER_SOURCE))
    } catch (err) {
      if (err instanceof FeedNotConfiguredError) {
        // Known, deliberate build gap — do NOT count this toward the
        // "feed unreachable" failure counter, which exists for real
        // operational outages, not for a stage that was never wired.
        skipped.push(source)
        continue
      }
      console.error(`compliance-scan: fetch failed for ${source}`, err)
      anyRealFailure = true
    }
  }

  // Exactly one counter update per run, reflecting whether any REAL fetch
  // was attempted at all this run and whether any of those failed. Doing
  // this once here (rather than once per source, or once inline plus again
  // at the end) avoids a later "success" overwriting an earlier "failure"
  // recorded for a different source in the same run — a real bug caught
  // during self-review before this shipped.
  const anySourceActuallyAttempted = skipped.length < sources.length
  if (anySourceActuallyAttempted) {
    await recordFetchOutcome(!anyRealFailure)
  }

  if (allNew.length === 0) {
    return { processed: 0, skippedFetchNotConfigured: skipped }
  }

  const newItems = await filterNewItems(allNew)
  for (const item of newItems) {
    const haiku = await summariseAndClassify(item)
    const entry = locateEntry(haiku.area)
    const { classification, opusConfirmed } = await resolveClassification(item, haiku, entry)
    const opusReason: string | null = classification === 'critical' && entry ? 'confirmed by Opus 5' : null
    await persistAndEmit(item, haiku, entry, classification, opusConfirmed, opusReason)
  }

  return { processed: newItems.length, skippedFetchNotConfigured: skipped }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS_HEADERS })
  }

  const body = await req.json().catch(() => ({}))

  // Test path: run the full non-FETCH pipeline (dedupe → Haiku →
  // LOCATE → Opus gate → GitHub issue → opsAlert → persist) against
  // caller-supplied synthetic items, bypassing fetchComplianceFeed()
  // entirely. This is how Objects 1-2 and the non-FETCH half of Object 3
  // get verified before the feed URL is confirmed.
  if (body.action === 'test_pipeline' && Array.isArray(body.items)) {
    const items = body.items as FeedItem[]
    const newItems = await filterNewItems(items)
    for (const item of newItems) {
      const haiku = await summariseAndClassify(item)
      const entry = locateEntry(haiku.area)
      const { classification, opusConfirmed } = await resolveClassification(item, haiku, entry)
      await persistAndEmit(item, haiku, entry, classification, opusConfirmed, classification === 'critical' ? 'confirmed by Opus 5' : null)
    }
    return respond({ status: 'ok', mode: 'test_pipeline', processed: newItems.length })
  }

  const result = await runScan(['cbic_rate', 'cbic_central', 'gstn'])
  return respond({ status: 'ok', ...result, checked_at: new Date().toISOString() })
})
