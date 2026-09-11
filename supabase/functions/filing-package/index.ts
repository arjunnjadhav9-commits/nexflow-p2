// Supabase Edge Function: filing-package
// E2 — Monthly AI Filing Package, Parts 1 + 2.
//
// Generates a monthly zip of GST-relevant documents per tenant (GSTR-1
// reference sheet, purchase register, ITC-04 working paper for job workers,
// last HSN audit snapshot, Tally XML, an Opus-written covering note), uploads
// it to Storage, emails a 7-day signed link to the CA/accountant, and
// notifies the owner in-app/Telegram. No shared Deno module system exists in
// this codebase, so every helper below is duplicated from its browser source
// rather than imported — see the file/line citations in each section.
//
// Part 2 (Session 16) replaced Part 1 (Session 15)'s static README.txt and
// narrow Haiku count-summary (exceptions-*.txt) with a single
// 00-READ-THIS-FIRST.html covering note. Model is claude-opus-5 per
// enterprise-strategy.md §3.2 ("Model: Claude Opus (claude-opus-5). [DECIDED]")
// — the one place in this codebase where Opus, not Haiku, is correct: judging
// misclassification across a month of raw rows is reasoning, not extraction.
// Three-layer guarantee so the zip never fails to ship because of this step:
// Opus -> a narrow Haiku fallback (counts only) -> a pure deterministic
// fallback (no LLM call, cannot fail). See fetchCoveringNoteData/
// callOpusCoveringNote/buildCoveringNoteHtml below.
//
// One remaining deliberate divergence from enterprise-strategy.md §3.2:
// gstr1-reference-*.xlsx reuses export.html's informal 5-sheet shape
// (b2b/b2cs/b2cl/hsn/doc), not the exact GSTN Offline Tool V2.0 template
// §3.2 verifies. Framed explicitly as reference/cross-check data, not a
// direct-import file — see the covering note and email copy.
//
// Triggered two ways:
//   { mode: 'monthly_cron' }              — pg_net cron, 5th of month, 8am IST
//   { action: 'generate', tenant_id }     — settings.html "Generate Now" button
// Always returns HTTP 200 for the cron path — per-tenant failures are caught
// and recorded on the row, never thrown up to the response (cron retries on
// non-200, and this function must never trigger that). Tenants are processed
// strictly sequentially, never in parallel — same conservative pattern as
// check-low-stock.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import Anthropic from 'https://esm.sh/@anthropic-ai/sdk@0.32.0'
// esm.sh's generated .d.ts for these two packages omits a default export even
// though the runtime module has one (confirmed via a deployed smoke test —
// ExcelJS.Workbook/JSZip both work) — @ts-ignore suppresses the type-only
// false positive (TS1192) without affecting the actual bundle/runtime.
// @ts-ignore
import ExcelJS from 'https://esm.sh/exceljs@4.3.0'
// @ts-ignore
import JSZip from 'https://esm.sh/jszip@3.10.1'

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY') ?? ''
const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY')

// SB_SECRET_KEY (service role) — same env var name agent-query uses. Every
// query below is tenant_id-filtered by hand since this bypasses RLS.
const supabase = createClient(SUPABASE_URL, Deno.env.get('SB_SECRET_KEY') ?? '')

const anthropic = new Anthropic({ apiKey: Deno.env.get('ANTHROPIC_API_KEY') ?? '' })

function respond(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  })
}

function escapeHtml(s: unknown): string {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

// ─── Auth (agent-query/index.ts:254-278) ────────────────────────────────────
// deno-lint-ignore no-explicit-any
async function verifyCallerTenant(
  supabaseClient: any,
  req: Request,
  claimedTenantId: string | undefined
): Promise<{ ok: true } | { ok: false; response: Response }> {
  if (!claimedTenantId) {
    return { ok: false, response: respond({ status: 'error', error: 'tenant_id is required' }, 400) }
  }
  const authHeader = req.headers.get('Authorization') ?? ''
  const token = authHeader.replace('Bearer ', '')
  const { data: { user }, error: userError } = await supabaseClient.auth.getUser(token)
  if (userError || !user) {
    return { ok: false, response: respond({ status: 'error', error: 'Unauthorized' }, 401) }
  }
  const callerTenantId = (user.user_metadata as { tenant_id?: string } | null)?.tenant_id || user.id
  if (callerTenantId !== claimedTenantId) {
    return { ok: false, response: respond({ status: 'error', error: 'Unauthorized' }, 401) }
  }
  return { ok: true }
}

// ─── Period helpers ──────────────────────────────────────────────────────────
// todayIST() — agent-query/index.ts:782-785.
function todayIST(): string {
  const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000
  return new Date(Date.now() + IST_OFFSET_MS).toISOString().split('T')[0]
}

function previousPeriodMonth(): string {
  const [y, m] = todayIST().split('-').map(Number)
  const prevMonth = m === 1 ? 12 : m - 1
  const prevYear = m === 1 ? y - 1 : y
  return `${prevYear}-${String(prevMonth).padStart(2, '0')}`
}

// export.html:2306-2314 (downloadGstr1Workbook's month-bounds calc).
function monthBounds(periodMonth: string): { monthFrom: string; monthTo: string } {
  const [yearStr, monthStr] = periodMonth.split('-')
  const year = parseInt(yearStr, 10)
  const month = parseInt(monthStr, 10)
  const lastDay = new Date(year, month, 0).getDate()
  return { monthFrom: `${yearStr}-${monthStr}-01`, monthTo: `${yearStr}-${monthStr}-${String(lastDay).padStart(2, '0')}` }
}

// export.html:1449-1452 (financialYearRange), adapted to take a period string.
function financialYearRangeForPeriod(periodMonth: string): { fyFrom: string; fyTo: string } {
  const [yearStr, monthStr] = periodMonth.split('-')
  const year = parseInt(yearStr, 10)
  const month = parseInt(monthStr, 10)
  const fyStartYear = month >= 4 ? year : year - 1
  return { fyFrom: `${fyStartYear}-04-01`, fyTo: `${fyStartYear + 1}-03-31` }
}

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
function periodLabel(periodMonth: string): string {
  const [y, m] = periodMonth.split('-').map(Number)
  return `${MONTH_NAMES[m - 1]} ${y}`
}

// export.html:592-599.
function fmtDDMMYYYY(dateStr: string | null | undefined): string {
  if (!dateStr) return ''
  const d = new Date(dateStr)
  const dd = String(d.getDate()).padStart(2, '0')
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  return `${dd}/${mm}/${d.getFullYear()}`
}

// ─── GST helpers (export.html:601-642) ──────────────────────────────────────
const GST_STATE_CODES: Record<string, string> = {
  '01': 'Jammu and Kashmir', '02': 'Himachal Pradesh', '03': 'Punjab',
  '04': 'Chandigarh', '05': 'Uttarakhand', '06': 'Haryana', '07': 'Delhi',
  '08': 'Rajasthan', '09': 'Uttar Pradesh', '10': 'Bihar', '11': 'Sikkim',
  '12': 'Arunachal Pradesh', '13': 'Nagaland', '14': 'Manipur', '15': 'Mizoram',
  '16': 'Tripura', '17': 'Meghalaya', '18': 'Assam', '19': 'West Bengal',
  '20': 'Jharkhand', '21': 'Odisha', '22': 'Chhattisgarh', '23': 'Madhya Pradesh',
  '24': 'Gujarat', '25': 'Daman and Diu', '26': 'Dadra and Nagar Haveli and Daman and Diu',
  '27': 'Maharashtra', '28': 'Andhra Pradesh (Old)', '29': 'Karnataka', '30': 'Goa',
  '31': 'Lakshadweep', '32': 'Kerala', '33': 'Tamil Nadu', '34': 'Puducherry',
  '35': 'Andaman and Nicobar Islands', '36': 'Telangana', '37': 'Andhra Pradesh',
  '38': 'Ladakh', '97': 'Other Territory',
}
function getPlaceOfSupply(gstin: string | null | undefined): string {
  if (!gstin) return ''
  const code = gstin.slice(0, 2)
  const name = GST_STATE_CODES[code]
  return name ? `${name} (${code})` : ''
}
function gstinStateNameBare(gstin: string | null | undefined): string {
  if (!gstin) return ''
  return GST_STATE_CODES[String(gstin).slice(0, 2)] || ''
}
const B2CL_THRESHOLD = 100000

// export.html:636-642 / itc04-workingpaper.html:905-911.
function styleHeaderRow(row: ExcelJS.Row) {
  row.eachCell((cell: ExcelJS.Cell) => {
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' } }
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFF5C1A' } }
    cell.alignment = { horizontal: 'center', vertical: 'middle' }
  })
}

// js/full-export.js:73-75, 86-88.
function normaliseInvoiceNo(str: string | null | undefined): string {
  return String(str || '').replace(/[\s\-\/]/g, '').toUpperCase()
}
function slugify(str: string | null | undefined): string {
  return (String(str || 'export').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')) || 'export'
}

// ─── s.143 clock (js/s143-clock.js, verbatim) ───────────────────────────────
const S143_CLOCK_DAYS = 365
const S143_GREEN_MAX_DAYS = 270
const S143_WARNING_MAX_DAYS = 330

function s143AddDays(isoDateStr: string, days: number): string {
  const d = new Date(isoDateStr + 'T00:00:00Z')
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().split('T')[0]
}
function s143DaysBetween(isoDateStrA: string, isoDateStrB: string): number {
  const a = new Date(isoDateStrA + 'T00:00:00Z')
  const b = new Date(isoDateStrB + 'T00:00:00Z')
  return Math.round((b.getTime() - a.getTime()) / 86400000)
}
function computeS143Clock(
  row: { principal_challan_date: string | null; transaction_date: string },
  todayIsoDate: string
): { clockStart: string; deadlineDate: string; daysElapsed: number; status: string } | null {
  const clockStart = row.principal_challan_date || row.transaction_date
  if (!clockStart) return null
  const deadlineDate = s143AddDays(clockStart, S143_CLOCK_DAYS)
  const daysElapsed = s143DaysBetween(clockStart, todayIsoDate)
  let status: string
  if (daysElapsed <= S143_GREEN_MAX_DAYS) status = 'within_limit'
  else if (daysElapsed <= S143_WARNING_MAX_DAYS) status = 'warning'
  else if (daysElapsed <= S143_CLOCK_DAYS) status = 'breach_warning'
  else status = 'breached'
  return { clockStart, deadlineDate, daysElapsed, status }
}

// ─── GSTR-1 reference sheet (export.html downloadGstr1Workbook, 2299-2522, +
// its helpers computeHsnSummary/mergeHsnRows/computeTable13Buckets) ─────────
// UOM_MAP — export.html:535-544.
const UOM_MAP: Record<string, { tally: string } | string> = {
  KG: { tally: 'KGS' }, L: { tally: 'LTR' }, M: { tally: 'MTR' }, PC: { tally: 'PCS' },
  NOS: { tally: 'NOS' }, PCS: { tally: 'PCS' }, Stack: 'OTH', Stator: 'OTH',
}

// export.html:1798-1804.
function deriveInvoiceRate(inv: Record<string, unknown>): number {
  const invSubtotal = Number(inv.amount_subtotal) || 0
  const invGst = Number(inv.amount_gst) || 0
  return (inv.gst_type === 'none' || invSubtotal <= 0) ? 0 : Math.round((invGst / invSubtotal) * 100)
}

interface HsnRow {
  hsn: string; rate: number; description: string; uqc: string
  qty: number; taxableValue: number; integratedTax: number; centralTax: number; stateTax: number
}

// export.html:1806-1861.
function computeHsnSummary(invoices: Array<Record<string, unknown>>): { b2bRows: HsnRow[]; b2cRows: HsnRow[] } {
  const b2bMap = new Map<string, HsnRow>()
  const b2cMap = new Map<string, HsnRow>()

  invoices.forEach((inv) => {
    const items = Array.isArray(inv.items) ? (inv.items as Array<Record<string, unknown>>) : []
    const isB2B = !!(inv.client_gstin && String(inv.client_gstin).trim())
    const map = isB2B ? b2bMap : b2cMap
    const rate = deriveInvoiceRate(inv)

    items.forEach((item) => {
      const hsn = String(item.hsn_sac || '').trim()
      if (!hsn) return
      const key = `${hsn}|${rate}`
      const amount = Number(item.amount) || 0
      const qty = Number(item.qty) || 0

      let integratedTax = 0, centralTax = 0, stateTax = 0
      if (rate > 0) {
        if (inv.gst_type === 'igst') integratedTax = amount * (rate / 100)
        else if (inv.gst_type === 'cgst_sgst') { centralTax = amount * (rate / 200); stateTax = amount * (rate / 200) }
      }

      const unitEntry = UOM_MAP[String(item.unit)]
      const uqc = (typeof unitEntry === 'object' ? unitEntry?.tally : undefined) || 'OTH'
      const existing = map.get(key) || { hsn, rate, description: String(item.description || ''), uqc, qty: 0, taxableValue: 0, integratedTax: 0, centralTax: 0, stateTax: 0 }
      existing.qty += qty
      existing.taxableValue += amount
      existing.integratedTax += integratedTax
      existing.centralTax += centralTax
      existing.stateTax += stateTax
      map.set(key, existing)
    })
  })

  const sortRows = (rows: HsnRow[]) => rows.sort((a, b) => a.hsn.localeCompare(b.hsn) || a.rate - b.rate)
  return { b2bRows: sortRows(Array.from(b2bMap.values())), b2cRows: sortRows(Array.from(b2cMap.values())) }
}

// export.html:1868-1884.
function mergeHsnRows(rowsA: HsnRow[], rowsB: HsnRow[]): HsnRow[] {
  const map = new Map<string, HsnRow>()
  ;[...rowsA, ...rowsB].forEach((r) => {
    const key = `${r.hsn}|${r.rate}`
    const existing = map.get(key) || { hsn: r.hsn, rate: r.rate, description: r.description, uqc: r.uqc, qty: 0, taxableValue: 0, integratedTax: 0, centralTax: 0, stateTax: 0 }
    existing.qty += r.qty
    existing.taxableValue += r.taxableValue
    existing.integratedTax += r.integratedTax
    existing.centralTax += r.centralTax
    existing.stateTax += r.stateTax
    map.set(key, existing)
  })
  return Array.from(map.values()).sort((a, b) => a.hsn.localeCompare(b.hsn) || a.rate - b.rate)
}

// export.html:1459-1522 — series-key + gap-detection helpers for the doc sheet.
function invoiceSeriesKey(invoiceNumber: unknown): number | null {
  const match = String(invoiceNumber ?? '').match(/-(\d+)$/)
  if (!match) return null
  const num = parseInt(match[1], 10)
  return Number.isFinite(num) && num >= 1 ? num : null
}
function challanSeriesKey(challanNumber: unknown): { prefix: string; num: number } | null {
  const str = String(challanNumber ?? '')
  const legacyMatch = str.match(/^CHAL-\d{8}-(\d+)$/)
  if (legacyMatch) {
    const num = parseInt(legacyMatch[1], 10)
    return Number.isFinite(num) && num >= 1 ? { prefix: '', num } : null
  }
  const match = str.match(/^(\D*)(\d+)$/)
  if (!match) return null
  const num = parseInt(match[2], 10)
  if (!Number.isFinite(num) || num < 1) return null
  return { prefix: match[1], num }
}
function countGapsInFlatSeries(nums: number[]): { min: number | null; max: number | null; gapCount: number } {
  if (!nums.length) return { min: null, max: null, gapCount: 0 }
  const keySet = new Set(nums)
  let min = nums[0], max = nums[0]
  for (const n of nums) { if (n < min) min = n; if (n > max) max = n }
  let gapCount = 0
  for (let i = min; i <= max; i++) { if (!keySet.has(i)) gapCount++ }
  return { min, max, gapCount }
}
function countGapsBySeries(entries: Array<{ prefix: string; num: number }>): { gapCount: number } {
  const byPrefix = new Map<string, number[]>()
  entries.forEach(({ prefix, num }) => {
    if (!byPrefix.has(prefix)) byPrefix.set(prefix, [])
    byPrefix.get(prefix)!.push(num)
  })
  let gapCount = 0
  byPrefix.forEach((nums) => { gapCount += countGapsInFlatSeries(nums).gapCount })
  return { gapCount }
}

interface Table13Row {
  invoice_number?: string; invoice_date?: string; status?: string
  challan_number?: string; dispatch_date?: string; movement_purpose?: string | null; cancelled_at?: string
}

// export.html:1526-1564.
async function fetchTable13Data(tenantId: string, fyFrom: string, fyTo: string) {
  const [invoiceResult, dispatchResult, cancelledLogResult] = await Promise.all([
    supabase.from('p2_invoices').select('invoice_number, invoice_date, status').eq('tenant_id', tenantId).in('status', ['sent', 'cancelled']).gte('invoice_date', fyFrom).lte('invoice_date', fyTo),
    supabase.from('p2_dispatch_orders').select('challan_number, status, dispatch_date, movement_purpose').eq('tenant_id', tenantId).in('status', ['confirmed', 'cancelled']).gte('dispatch_date', fyFrom).lte('dispatch_date', fyTo),
    supabase.from('p2_cancelled_challans').select('challan_number, cancelled_at, movement_purpose').eq('tenant_id', tenantId),
  ])
  if (invoiceResult.error) throw new Error(`Table13 invoices: ${invoiceResult.error.message}`)
  if (dispatchResult.error) throw new Error(`Table13 dispatches: ${dispatchResult.error.message}`)
  if (cancelledLogResult.error) throw new Error(`Table13 cancelled log: ${cancelledLogResult.error.message}`)
  return {
    invoiceRows: (invoiceResult.data || []) as Table13Row[],
    dispatchRows: (dispatchResult.data || []) as Table13Row[],
    cancelledLogRows: (cancelledLogResult.data || []) as Table13Row[],
  }
}

// export.html:1572-1635.
const JOB_WORK_BUCKET_PURPOSES = new Set([
  'job_work_issue', 'job_work_return', 'unused_material_return', 'scrap_return',
  'rework_return', 'rework_dispatch', 'capital_goods_issue', 'inter_jobworker_transfer',
])
function computeTable13Buckets(invoiceRows: Table13Row[], dispatchRows: Table13Row[], cancelledLogRows: Table13Row[], monthFrom: string, monthTo: string) {
  const inMonth = (dateStr: string | undefined) => !!dateStr && dateStr >= monthFrom && dateStr <= monthTo

  function buildInvoiceBucket() {
    const monthRows = invoiceRows.filter((r) => inMonth(r.invoice_date))
    const totalIssued = monthRows.length
    const totalCancelled = monthRows.filter((r) => r.status === 'cancelled').length
    const monthKeys = monthRows.map((r) => invoiceSeriesKey(r.invoice_number)).filter((k): k is number => k !== null)
    const fyKeys = invoiceRows.map((r) => invoiceSeriesKey(r.invoice_number)).filter((k): k is number => k !== null)
    const { gapCount } = countGapsInFlatSeries(fyKeys)
    const fromDisplay = monthKeys.length ? Math.min(...monthKeys) : null
    const toDisplay = monthKeys.length ? Math.max(...monthKeys) : null
    return { label: 'Tax Invoices', fromDisplay, toDisplay, totalIssued, totalCancelled, netIssued: totalIssued - totalCancelled, gapCount }
  }

  function buildChallanBucket(label: string, matchesPurpose: (p: string | null | undefined) => boolean) {
    const dRows = dispatchRows.filter((r) => matchesPurpose(r.movement_purpose))
    const cRows = cancelledLogRows.filter((r) => matchesPurpose(r.movement_purpose))

    const monthConfirmed = dRows.filter((r) => r.status === 'confirmed' && inMonth(r.dispatch_date))
    const monthCancelledFromOrders = dRows.filter((r) => r.status === 'cancelled' && inMonth(r.dispatch_date))
    const monthCancelledFromLog = cRows.filter((r) => inMonth(r.cancelled_at))

    const totalIssued = monthConfirmed.length + monthCancelledFromOrders.length + monthCancelledFromLog.length
    const totalCancelled = monthCancelledFromOrders.length + monthCancelledFromLog.length

    const monthKeys = [...monthConfirmed, ...monthCancelledFromOrders].map((r) => challanSeriesKey(r.challan_number)).filter((k): k is { prefix: string; num: number } => k !== null)
    const flatMonthNums = monthKeys.map((k) => k.num)
    const fromDisplay = flatMonthNums.length ? Math.min(...flatMonthNums) : null
    const toDisplay = flatMonthNums.length ? Math.max(...flatMonthNums) : null

    const fyEntries = [...dRows, ...cRows].map((r) => challanSeriesKey(r.challan_number)).filter((k): k is { prefix: string; num: number } => k !== null)
    const { gapCount } = countGapsBySeries(fyEntries)

    return { label, fromDisplay, toDisplay, totalIssued, totalCancelled, netIssued: totalIssued - totalCancelled, gapCount }
  }

  return [
    buildInvoiceBucket(),
    buildChallanBucket('Delivery Challans (Job Work)', (p) => !!p && JOB_WORK_BUCKET_PURPOSES.has(p)),
    buildChallanBucket('Delivery Challans (Other)', (p) => !p || !JOB_WORK_BUCKET_PURPOSES.has(p)),
  ]
}

// export.html:2299-2522, minus the browser-only month/DOM plumbing. Diverges
// from export.html in one place: never throws on zero invoices — an
// automated monthly run has no toast to show, so it ships empty sheets
// instead (see plan's "zero invoices" interpretation).
async function buildGstr1ReferenceWorkbook(
  tenantId: string, periodMonth: string, monthFrom: string, monthTo: string, tenantGstin: string
): Promise<{ workbook: ExcelJS.Workbook; invoiceCount: number }> {
  const { fyFrom, fyTo } = financialYearRangeForPeriod(periodMonth)

  const [invoiceResult, table13Data] = await Promise.all([
    supabase.from('p2_invoices')
      .select('invoice_number, invoice_date, client_name, client_gstin, gst_type, amount_subtotal, amount_gst, amount_total, round_off, items, status')
      .eq('tenant_id', tenantId).eq('status', 'sent').gte('invoice_date', monthFrom).lte('invoice_date', monthTo),
    fetchTable13Data(tenantId, fyFrom, fyTo),
  ])
  if (invoiceResult.error) throw new Error(`GSTR-1 reference invoices: ${invoiceResult.error.message}`)

  const invoices = (invoiceResult.data || []) as Array<Record<string, unknown>>
  const tenantPlaceOfSupply = getPlaceOfSupply(tenantGstin) || 'Maharashtra (27)'

  const hsnSummary = computeHsnSummary(invoices)
  const hsnRows = mergeHsnRows(hsnSummary.b2bRows, hsnSummary.b2cRows)
  const docBuckets = computeTable13Buckets(table13Data.invoiceRows, table13Data.dispatchRows, table13Data.cancelledLogRows, monthFrom, monthTo)

  const b2bRows: Array<Record<string, unknown>> = []
  const b2csMap = new Map<string, { placeOfSupply: string; rate: number; taxableValue: number; cess: number }>()
  const b2clRows: Array<Record<string, unknown>> = []

  invoices.forEach((inv) => {
    const clientGstin = String(inv.client_gstin || '').trim()
    const isB2B = !!clientGstin
    const rate = deriveInvoiceRate(inv)
    const placeOfSupply = isB2B ? (getPlaceOfSupply(clientGstin) || tenantPlaceOfSupply) : tenantPlaceOfSupply
    const invoiceValue = Number(inv.amount_total) || 0
    const taxableValue = Number(inv.amount_subtotal) || 0

    if (isB2B) {
      const items = Array.isArray(inv.items) ? (inv.items as Array<Record<string, unknown>>) : []
      items.forEach((item) => {
        b2bRows.push({
          gstin: clientGstin, receiverName: inv.client_name || '', invoiceNo: inv.invoice_number,
          invoiceDate: fmtDDMMYYYY(inv.invoice_date as string), invoiceValue, placeOfSupply,
          reverseCharge: 'N', applicableTaxRatePct: '', invoiceType: 'Regular', ecommerceGstin: '',
          rate, taxableValue: Number(item.amount) || 0, cess: 0,
        })
      })
    } else if (invoiceValue > B2CL_THRESHOLD && inv.gst_type === 'igst') {
      b2clRows.push({
        invoiceNo: inv.invoice_number, invoiceDate: fmtDDMMYYYY(inv.invoice_date as string), invoiceValue, placeOfSupply,
        applicableTaxRatePct: '', rate, taxableValue, cess: 0, ecommerceGstin: '',
      })
    } else {
      const key = `${placeOfSupply}|${rate}`
      const existing = b2csMap.get(key) || { placeOfSupply, rate, taxableValue: 0, cess: 0 }
      existing.taxableValue += taxableValue
      b2csMap.set(key, existing)
    }
  })

  const b2csRows = Array.from(b2csMap.values()).sort((a, b) => a.placeOfSupply.localeCompare(b.placeOfSupply) || a.rate - b.rate)

  const workbook = new ExcelJS.Workbook()

  const readmeSheet = workbook.addWorksheet('README')
  readmeSheet.columns = [{ key: 'text', width: 100 }]
  readmeSheet.addRow({ text: 'Generated by Nexflow — reference data for verification only. Your accounting software (Tally/ClearTax/GSP) generates the actual GSTR-1 filing from your books; use this workbook to cross-check totals before filing.' })
  readmeSheet.getRow(1).alignment = { wrapText: true, vertical: 'top' }
  readmeSheet.getRow(1).font = { italic: true }

  const b2bSheet = workbook.addWorksheet('b2b')
  b2bSheet.columns = [
    { header: 'GSTIN/UIN of Recipient', key: 'gstin', width: 18 },
    { header: 'Receiver Name', key: 'receiverName', width: 24 },
    { header: 'Invoice Number', key: 'invoiceNo', width: 18 },
    { header: 'Invoice date', key: 'invoiceDate', width: 14 },
    { header: 'Invoice Value', key: 'invoiceValue', width: 14, numFmt: '#,##0.00' },
    { header: 'Place Of Supply', key: 'placeOfSupply', width: 20 },
    { header: 'Reverse Charge', key: 'reverseCharge', width: 12 },
    { header: 'Applicable % of Tax Rate', key: 'applicableTaxRatePct', width: 16 },
    { header: 'Invoice Type', key: 'invoiceType', width: 14 },
    { header: 'E-Commerce GSTIN', key: 'ecommerceGstin', width: 16 },
    { header: 'Rate', key: 'rate', width: 8 },
    { header: 'Taxable Value', key: 'taxableValue', width: 14, numFmt: '#,##0.00' },
    { header: 'Cess Amount', key: 'cess', width: 12, numFmt: '#,##0.00' },
  ]
  styleHeaderRow(b2bSheet.getRow(1))
  b2bRows.forEach((r) => b2bSheet.addRow(r))
  b2bSheet.views = [{ state: 'frozen', ySplit: 1 }]

  const b2csSheet = workbook.addWorksheet('b2cs')
  b2csSheet.columns = [
    { header: 'Type', key: 'type', width: 8 },
    { header: 'Place Of Supply', key: 'placeOfSupply', width: 20 },
    { header: 'Applicable % of Tax Rate', key: 'applicableTaxRatePct', width: 16 },
    { header: 'Rate', key: 'rate', width: 8 },
    { header: 'Taxable Value', key: 'taxableValue', width: 14, numFmt: '#,##0.00' },
    { header: 'Cess Amount', key: 'cess', width: 12, numFmt: '#,##0.00' },
    { header: 'E-Commerce GSTIN', key: 'ecommerceGstin', width: 16 },
  ]
  styleHeaderRow(b2csSheet.getRow(1))
  b2csRows.forEach((r) => b2csSheet.addRow({ type: 'OE', placeOfSupply: r.placeOfSupply, applicableTaxRatePct: '', rate: r.rate, taxableValue: r.taxableValue, cess: r.cess, ecommerceGstin: '' }))
  b2csSheet.views = [{ state: 'frozen', ySplit: 1 }]

  const b2clSheet = workbook.addWorksheet('b2cl')
  b2clSheet.columns = [
    { header: 'Invoice Number', key: 'invoiceNo', width: 18 },
    { header: 'Invoice date', key: 'invoiceDate', width: 14 },
    { header: 'Invoice Value', key: 'invoiceValue', width: 14, numFmt: '#,##0.00' },
    { header: 'Place Of Supply', key: 'placeOfSupply', width: 20 },
    { header: 'Applicable % of Tax Rate', key: 'applicableTaxRatePct', width: 16 },
    { header: 'Rate', key: 'rate', width: 8 },
    { header: 'Taxable Value', key: 'taxableValue', width: 14, numFmt: '#,##0.00' },
    { header: 'Cess Amount', key: 'cess', width: 12, numFmt: '#,##0.00' },
    { header: 'E-Commerce GSTIN', key: 'ecommerceGstin', width: 16 },
  ]
  styleHeaderRow(b2clSheet.getRow(1))
  b2clRows.forEach((r) => b2clSheet.addRow(r))
  b2clSheet.views = [{ state: 'frozen', ySplit: 1 }]

  const hsnSheet = workbook.addWorksheet('hsn')
  hsnSheet.columns = [
    { header: 'HSN', key: 'hsn', width: 14 },
    { header: 'Description', key: 'description', width: 28 },
    { header: 'UQC', key: 'uqc', width: 8 },
    { header: 'Total Quantity', key: 'qty', width: 14, numFmt: '#,##0.##' },
    { header: 'Total Value', key: 'totalValue', width: 16, numFmt: '#,##0.00' },
    { header: 'Taxable Value', key: 'taxableValue', width: 16, numFmt: '#,##0.00' },
    { header: 'Integrated Tax Amount', key: 'integratedTax', width: 18, numFmt: '#,##0.00' },
    { header: 'Central Tax Amount', key: 'centralTax', width: 16, numFmt: '#,##0.00' },
    { header: 'State/UT Tax Amount', key: 'stateTax', width: 16, numFmt: '#,##0.00' },
    { header: 'Cess Amount', key: 'cess', width: 12, numFmt: '#,##0.00' },
  ]
  styleHeaderRow(hsnSheet.getRow(1))
  hsnRows.forEach((r) => hsnSheet.addRow({
    hsn: r.hsn, description: r.description, uqc: r.uqc, qty: r.qty,
    totalValue: r.taxableValue + r.integratedTax + r.centralTax + r.stateTax,
    taxableValue: r.taxableValue, integratedTax: r.integratedTax, centralTax: r.centralTax, stateTax: r.stateTax, cess: 0,
  }))
  hsnSheet.views = [{ state: 'frozen', ySplit: 1 }]

  const docSheet = workbook.addWorksheet('doc')
  docSheet.columns = [
    { header: 'Nature of Document', key: 'label', width: 30 },
    { header: 'Sr. No. From', key: 'from', width: 16 },
    { header: 'Sr. No. To', key: 'to', width: 16 },
    { header: 'Total Number', key: 'total', width: 14 },
    { header: 'Cancelled', key: 'cancelled', width: 12 },
  ]
  styleHeaderRow(docSheet.getRow(1))
  docBuckets.forEach((b) => docSheet.addRow({ label: b.label, from: b.fromDisplay ?? '', to: b.toDisplay ?? '', total: b.totalIssued, cancelled: b.totalCancelled }))
  docSheet.views = [{ state: 'frozen', ySplit: 1 }]

  return { workbook, invoiceCount: invoices.length }
}

// ─── Purchase register (export.html exportTallyTransactions Sheet 1,
// 938-1030) ───────────────────────────────────────────────────────────────
async function buildPurchaseRegisterWorkbook(
  tenantId: string, monthFrom: string, monthTo: string, tenantGstin: string
): Promise<{ workbook: ExcelJS.Workbook; rowCount: number }> {
  const JOIN_COLUMNS = 'transaction_date, quantity, rate, notes, invoice_no, supplier_id, supplier_name, purchase_type, p2_raw_materials!inner(name, material_code, hsn_sac, gst_rate, unit), p2_suppliers(gstin)'

  const [grnResult, openingResult] = await Promise.all([
    supabase.from('p2_stock_transactions').select(JOIN_COLUMNS).eq('tenant_id', tenantId).eq('transaction_type', 'grn').is('owned_by', null).gte('transaction_date', monthFrom).lte('transaction_date', monthTo),
    supabase.from('p2_stock_transactions').select(JOIN_COLUMNS).eq('tenant_id', tenantId).eq('transaction_type', 'adjustment').eq('notes', 'Opening Stock').is('owned_by', null).gte('transaction_date', monthFrom).lte('transaction_date', monthTo),
  ])
  if (grnResult.error) throw new Error(`Purchase register GRN: ${grnResult.error.message}`)
  if (openingResult.error) throw new Error(`Purchase register opening stock: ${openingResult.error.message}`)

  const tenantPlaceOfSupply = getPlaceOfSupply(tenantGstin) || 'Maharashtra (27)'
  const grnRows = (grnResult.data || []) as Array<Record<string, any>>
  const openingRows = (openingResult.data || []) as Array<Record<string, any>>

  const workbook = new ExcelJS.Workbook()
  const purchasesSheet = workbook.addWorksheet('Purchases (GRN)')
  purchasesSheet.columns = [
    { header: 'Date', key: 'date', width: 14 },
    { header: 'Material', key: 'material', width: 35 },
    { header: 'Material Code', key: 'materialCode', width: 16 },
    { header: 'HSN/SAC', key: 'hsnSac', width: 12 },
    { header: 'Transaction Type', key: 'transactionType', width: 20 },
    { header: 'Quantity', key: 'quantity', width: 12, numFmt: '#,##0.##' },
    { header: 'Unit', key: 'unit', width: 8 },
    { header: 'Rate', key: 'rate', width: 12, numFmt: '#,##0.##' },
    { header: 'Amount', key: 'amount', width: 14, numFmt: '#,##0.00' },
    { header: 'CGST Rate (%)', key: 'cgstRate', width: 14 },
    { header: 'CGST Amount', key: 'cgstAmount', width: 14, numFmt: '#,##0.00' },
    { header: 'SGST Rate (%)', key: 'sgstRate', width: 14 },
    { header: 'SGST Amount', key: 'sgstAmount', width: 14, numFmt: '#,##0.00' },
    { header: 'IGST Rate (%)', key: 'igstRate', width: 14 },
    { header: 'IGST Amount', key: 'igstAmount', width: 14, numFmt: '#,##0.00' },
    { header: 'Total GST Amount', key: 'totalGst', width: 16, numFmt: '#,##0.00' },
    { header: 'Invoice Total', key: 'invoiceTotal', width: 14, numFmt: '#,##0.00' },
    { header: 'Supplier Name', key: 'supplierName', width: 20 },
    { header: 'Supplier GSTIN', key: 'supplierGstin', width: 16 },
    { header: 'Place of Supply', key: 'placeOfSupply', width: 16 },
    { header: 'Supplier Invoice No', key: 'supplierInvoiceNo', width: 18 },
  ]
  styleHeaderRow(purchasesSheet.getRow(1))

  const allRows = [
    ...grnRows.map((row) => ({ type: 'grn' as const, row })),
    ...openingRows.map((row) => ({ type: 'opening' as const, row })),
  ]
  allRows.sort((a, b) => String(a.row.transaction_date).localeCompare(String(b.row.transaction_date)))

  allRows.forEach(({ type, row }) => {
    const rm = row.p2_raw_materials
    const date = fmtDDMMYYYY(row.transaction_date)
    const materialCode = rm?.material_code || ''
    const hsnSac = rm?.hsn_sac || ''

    if (type === 'grn') {
      const rate = row.rate || 0
      const qty = row.quantity
      const amount = qty * rate
      const gstRate = rm?.gst_rate || 0
      const isInterstate = row.purchase_type === 'interstate'

      let cgstRate: number | string = '', cgstAmount: number | string = '', sgstRate: number | string = '', sgstAmount: number | string = '', igstRate: number | string = '', igstAmount: number | string = ''

      if (isInterstate) {
        igstRate = gstRate
        igstAmount = (amount * gstRate) / 100
      } else {
        cgstRate = gstRate / 2
        sgstRate = gstRate / 2
        cgstAmount = (amount * (cgstRate as number)) / 100
        sgstAmount = (amount * (sgstRate as number)) / 100
      }

      const totalGst = (Number(cgstAmount) || 0) + (Number(sgstAmount) || 0) + (Number(igstAmount) || 0)
      const invoiceTotal = amount + totalGst
      const supplierGstin = (row.p2_suppliers && row.p2_suppliers.gstin) || ''

      purchasesSheet.addRow({
        date, material: rm?.name || '', materialCode, hsnSac, transactionType: 'GRN (Purchase)',
        quantity: qty, unit: rm?.unit || '', rate, amount,
        cgstRate, cgstAmount, sgstRate, sgstAmount, igstRate, igstAmount,
        totalGst, invoiceTotal, supplierName: row.supplier_name || '', supplierGstin, placeOfSupply: tenantPlaceOfSupply,
        supplierInvoiceNo: row.invoice_no || '',
      })
    } else {
      purchasesSheet.addRow({
        date, material: rm?.name || '', materialCode, hsnSac, transactionType: 'Opening Stock',
        quantity: row.quantity, unit: rm?.unit || '', rate: '', amount: '',
        cgstRate: '', cgstAmount: '', sgstRate: '', sgstAmount: '', igstRate: '', igstAmount: '',
        totalGst: '', invoiceTotal: '', supplierName: '', supplierGstin: '', placeOfSupply: '', supplierInvoiceNo: '',
      })
    }
  })

  purchasesSheet.views = [{ state: 'frozen', ySplit: 1 }]
  return { workbook, rowCount: allRows.length }
}

// ─── ITC-04 working paper (itc04-workingpaper.html, 445-724 for the data
// fetches, 904-1145 for the Excel build) — only called when is_job_worker,
// once per job-work principal. ────────────────────────────────────────────
interface Principal { id: string; name: string }

async function fetchJobWorkPrincipals(tenantId: string): Promise<Principal[]> {
  const { data, error } = await supabase.from('p2_clients').select('id, name').eq('tenant_id', tenantId).eq('is_job_work_principal', true).order('name')
  if (error) throw new Error(`Job-work principals: ${error.message}`)
  return data || []
}

async function fetchTable4(tenantId: string, principalId: string, dateFrom: string, dateTo: string) {
  const { data, error } = await supabase
    .from('p2_stock_transactions')
    .select('id, raw_material_id, quantity, rate, grn_no, transaction_date, principal_challan_no, principal_challan_date, p2_raw_materials ( name, material_code, uqc )')
    .eq('tenant_id', tenantId).eq('transaction_type', 'grn').eq('owned_by', principalId)
    .gte('transaction_date', dateFrom).lte('transaction_date', dateTo)
    .order('transaction_date', { ascending: true })
  if (error) throw new Error(`ITC-04 Table 4: ${error.message}`)

  const today = todayIST()
  return (data || []).map((row: any) => {
    const clock = computeS143Clock({ principal_challan_date: row.principal_challan_date, transaction_date: row.transaction_date }, today)
    return {
      materialName: row.p2_raw_materials?.name || '(deleted material)',
      uqc: row.p2_raw_materials?.uqc || 'OTH',
      quantity: Number(row.quantity),
      estValue: row.rate ? Number(row.quantity) * Number(row.rate) : null,
      grnNo: row.grn_no, transactionDate: row.transaction_date,
      principalChallanNo: row.principal_challan_no, principalChallanDate: row.principal_challan_date,
      daysElapsed: clock?.daysElapsed ?? 0, status: clock?.status || 'within_limit',
    }
  })
}

function resolveItemDescription(item: any, materialsById: Map<string, any>, productsById: Map<string, any>) {
  if (item.raw_material_id && materialsById.has(item.raw_material_id)) {
    const m = materialsById.get(item.raw_material_id)
    return { description: m.name, uqc: m.uqc || 'OTH' }
  }
  if (item.product_id && productsById.has(item.product_id)) {
    const p = productsById.get(item.product_id)
    return { description: p.name, uqc: p.uqc || 'OTH' }
  }
  return { description: item.material_name || '(unresolved item)', uqc: 'OTH' }
}

const TABLE_5A_PURPOSES = ['job_work_return', 'rework_return', 'unused_material_return']
const TABLE_5B_PURPOSES = ['scrap_return']

async function fetchReturnTable(tenantId: string, principalId: string, purposes: string[], dateFrom: string, dateTo: string) {
  const { data: orders, error: ordersErr } = await supabase
    .from('p2_dispatch_orders').select('id, challan_number, dispatch_date, movement_purpose')
    .eq('tenant_id', tenantId).eq('status', 'confirmed').eq('owned_by', principalId)
    .in('movement_purpose', purposes).gte('dispatch_date', dateFrom).lte('dispatch_date', dateTo)
    .order('dispatch_date', { ascending: true })
  if (ordersErr) throw new Error(`ITC-04 return table orders: ${ordersErr.message}`)
  if (!orders || orders.length === 0) return [] as any[]

  const orderIds = orders.map((o: any) => o.id)
  const [{ data: items, error: itemsErr }, { data: links, error: linksErr }] = await Promise.all([
    supabase.from('p2_dispatch_items').select('dispatch_order_id, raw_material_id, product_id, material_name, qty_dispatched').in('dispatch_order_id', orderIds),
    supabase.from('p2_challan_links').select('return_dispatch_id, original_dispatch_id, quantity_settled').eq('tenant_id', tenantId).in('return_dispatch_id', orderIds),
  ])
  if (itemsErr) throw new Error(`ITC-04 return table items: ${itemsErr.message}`)
  if (linksErr) throw new Error(`ITC-04 return table links: ${linksErr.message}`)

  const rawMaterialIds = [...new Set((items || []).map((i: any) => i.raw_material_id).filter(Boolean))]
  const productIds = [...new Set((items || []).map((i: any) => i.product_id).filter(Boolean))]
  const [{ data: materials }, { data: products }] = await Promise.all([
    rawMaterialIds.length ? supabase.from('p2_raw_materials').select('id, name, uqc').in('id', rawMaterialIds) : Promise.resolve({ data: [] as any[] }),
    productIds.length ? supabase.from('p2_products').select('id, name, uqc').in('id', productIds) : Promise.resolve({ data: [] as any[] }),
  ])
  const materialsById = new Map((materials || []).map((m: any) => [m.id, m]))
  const productsById = new Map((products || []).map((p: any) => [p.id, p]))

  const originalIds = [...new Set((links || []).map((l: any) => l.original_dispatch_id))]
  let originalsById = new Map<string, any>()
  if (originalIds.length) {
    const { data: originals, error: origErr } = await supabase.from('p2_dispatch_orders').select('id, challan_number, dispatch_date').in('id', originalIds)
    if (origErr) throw new Error(`ITC-04 return table originals: ${origErr.message}`)
    originalsById = new Map((originals || []).map((o: any) => [o.id, o]))
  }
  const linksByReturnId = new Map<string, any[]>()
  ;(links || []).forEach((l: any) => {
    if (!linksByReturnId.has(l.return_dispatch_id)) linksByReturnId.set(l.return_dispatch_id, [])
    linksByReturnId.get(l.return_dispatch_id)!.push(l)
  })
  const itemsByOrderId = new Map<string, any[]>()
  ;(items || []).forEach((it: any) => {
    if (!itemsByOrderId.has(it.dispatch_order_id)) itemsByOrderId.set(it.dispatch_order_id, [])
    itemsByOrderId.get(it.dispatch_order_id)!.push(it)
  })

  const rows: any[] = []
  orders.forEach((order: any) => {
    const orderItems = itemsByOrderId.get(order.id) || []
    const orderLinks = linksByReturnId.get(order.id) || []

    let originalRef = '— Not Linked —'
    let timeTaken: number | null = null
    if (orderLinks.length === 1) {
      const orig = originalsById.get(orderLinks[0].original_dispatch_id)
      if (orig) {
        const displayNo = (orig.challan_number || '').replace(/^CHAL-\d{8}-/, '')
        originalRef = `${displayNo} — ${fmtDDMMYYYY(orig.dispatch_date)}`
        timeTaken = s143DaysBetween(orig.dispatch_date, order.dispatch_date)
      }
    } else if (orderLinks.length > 1) {
      originalRef = `Multiple challans linked (${orderLinks.length})`
    }

    if (orderItems.length === 0) {
      rows.push({ challanNo: (order.challan_number || '').replace(/^CHAL-\d{8}-/, ''), dispatchDate: order.dispatch_date, movementPurpose: order.movement_purpose, description: '(no line items)', uqc: '—', quantity: null, originalRef, timeTaken })
      return
    }
    orderItems.forEach((item: any) => {
      const resolved = resolveItemDescription(item, materialsById, productsById)
      rows.push({ challanNo: (order.challan_number || '').replace(/^CHAL-\d{8}-/, ''), dispatchDate: order.dispatch_date, movementPurpose: order.movement_purpose, description: resolved.description, uqc: resolved.uqc, quantity: Number(item.qty_dispatched), originalRef, timeTaken })
    })
  })
  return rows
}

async function fetchTable5C(tenantId: string, principalId: string, dateFrom: string, dateTo: string) {
  const { data: orders, error: ordersErr } = await supabase
    .from('p2_dispatch_orders').select('id, challan_number, dispatch_date, client_name')
    .eq('tenant_id', tenantId).eq('status', 'confirmed').eq('owned_by', principalId)
    .eq('movement_purpose', 'direct_supply_from_jobworker').gte('dispatch_date', dateFrom).lte('dispatch_date', dateTo)
    .order('dispatch_date', { ascending: true })
  if (ordersErr) throw new Error(`ITC-04 Table 5C orders: ${ordersErr.message}`)
  if (!orders || orders.length === 0) return [] as any[]

  const orderIds = orders.map((o: any) => o.id)
  const challanNumberByOrderId = new Map(orders.map((o: any) => [o.id, o.challan_number]))

  const [{ data: items, error: itemsErr }, { data: singleInvoices, error: singleErr }, { data: consolInvoices, error: consolErr }] = await Promise.all([
    supabase.from('p2_dispatch_items').select('dispatch_order_id, raw_material_id, product_id, material_name, qty_dispatched').in('dispatch_order_id', orderIds),
    supabase.from('p2_invoices').select('dispatch_order_id, invoice_number, invoice_date, status, client_name, client_gstin, amount_subtotal').eq('tenant_id', tenantId).eq('invoice_mode', 'single').in('dispatch_order_id', orderIds),
    supabase.from('p2_invoices').select('dispatch_order_ids, invoice_number, invoice_date, status, client_name, client_gstin, items').eq('tenant_id', tenantId).eq('invoice_mode', 'consolidated').overlaps('dispatch_order_ids', orderIds),
  ])
  if (itemsErr) throw new Error(`ITC-04 Table 5C items: ${itemsErr.message}`)
  if (singleErr) throw new Error(`ITC-04 Table 5C single invoices: ${singleErr.message}`)
  if (consolErr) throw new Error(`ITC-04 Table 5C consolidated invoices: ${consolErr.message}`)

  const rawMaterialIds = [...new Set((items || []).map((i: any) => i.raw_material_id).filter(Boolean))]
  const productIds = [...new Set((items || []).map((i: any) => i.product_id).filter(Boolean))]
  const [{ data: materials }, { data: products }] = await Promise.all([
    rawMaterialIds.length ? supabase.from('p2_raw_materials').select('id, name, uqc').in('id', rawMaterialIds) : Promise.resolve({ data: [] as any[] }),
    productIds.length ? supabase.from('p2_products').select('id, name, uqc').in('id', productIds) : Promise.resolve({ data: [] as any[] }),
  ])
  const materialsById = new Map((materials || []).map((m: any) => [m.id, m]))
  const productsById = new Map((products || []).map((p: any) => [p.id, p]))

  const invoiceByOrderId = new Map<string, any>()
  ;(singleInvoices || []).forEach((inv: any) => {
    invoiceByOrderId.set(inv.dispatch_order_id, { invoiceNo: inv.invoice_number, invoiceDate: inv.invoice_date, status: inv.status, buyerName: inv.client_name, buyerGstin: inv.client_gstin, value: inv.amount_subtotal })
  })
  ;(consolInvoices || []).forEach((inv: any) => {
    ;(inv.dispatch_order_ids || []).forEach((orderId: string) => {
      const challanNo = challanNumberByOrderId.get(orderId)
      if (!challanNo) return
      const matchingItems = (inv.items || []).filter((it: any) => it.challan_number === challanNo)
      if (!matchingItems.length) return
      const value = matchingItems.reduce((sum: number, it: any) => sum + Number(it.amount || 0), 0)
      invoiceByOrderId.set(orderId, { invoiceNo: inv.invoice_number, invoiceDate: inv.invoice_date, status: inv.status, buyerName: inv.client_name, buyerGstin: inv.client_gstin, value })
    })
  })

  const itemsByOrderId = new Map<string, any[]>()
  ;(items || []).forEach((it: any) => {
    if (!itemsByOrderId.has(it.dispatch_order_id)) itemsByOrderId.set(it.dispatch_order_id, [])
    itemsByOrderId.get(it.dispatch_order_id)!.push(it)
  })

  const rows: any[] = []
  orders.forEach((order: any) => {
    const orderItems = itemsByOrderId.get(order.id) || []
    const inv = invoiceByOrderId.get(order.id) || null
    const singleItem = orderItems.length === 1

    if (orderItems.length === 0) {
      rows.push({ challanNo: (order.challan_number || '').replace(/^CHAL-\d{8}-/, ''), dispatchDate: order.dispatch_date, buyerName: order.client_name || inv?.buyerName, buyerGstin: inv?.buyerGstin, description: '(no line items)', uqc: '—', quantity: null, invoiceNo: inv?.invoiceNo, invoiceDate: inv?.invoiceDate, invoiceStatus: inv?.status, value: inv?.value ?? null })
      return
    }
    orderItems.forEach((item: any) => {
      const resolved = resolveItemDescription(item, materialsById, productsById)
      rows.push({ challanNo: (order.challan_number || '').replace(/^CHAL-\d{8}-/, ''), dispatchDate: order.dispatch_date, buyerName: order.client_name || inv?.buyerName, buyerGstin: inv?.buyerGstin, description: resolved.description, uqc: resolved.uqc, quantity: Number(item.qty_dispatched), invoiceNo: inv?.invoiceNo, invoiceDate: inv?.invoiceDate, invoiceStatus: inv?.status, value: (singleItem && inv) ? inv.value : null })
    })
  })
  return rows
}

async function fetchAggregateBalance(tenantId: string, principalId: string) {
  const { data, error } = await supabase.from('v_p2_stock_balance_by_owner').select('material_name, current_stock, uqc').eq('tenant_id', tenantId).eq('owned_by', principalId)
  if (error) return [] as any[]
  return data || []
}

const STATUS_META: Record<string, { label: string }> = {
  within_limit: { label: 'Within Limit' }, warning: { label: 'Warning' },
  breach_warning: { label: 'Breach Warning' }, breached: { label: 'Breached' },
}
const STATUS_FILL: Record<string, string> = { within_limit: 'FFD4F7DC', warning: 'FFFFF0B3', breach_warning: 'FFFFC9C9', breached: 'FFFF4D4D' }
const SUMMARY_SECTION_FILL = 'FFE8E8E8'
const SUMMARY_STATUS_FILL: Record<string, string> = { within_limit: 'FFD4F7DC', warning: 'FFFFF3CD', breach_warning: 'FFFFE0E0', breached: 'FFFF4444' }
const SUMMARY_DISCLAIMER_FILL = 'FFFFF3CD'
const PURPOSE_LABELS: Record<string, string> = { job_work_return: 'Job Work Return', rework_return: 'Rework Return', unused_material_return: 'Unused Material Return' }

function addSummarySectionHeader(sheet: ExcelJS.Worksheet, label: string) {
  const row = sheet.addRow([label, ''])
  row.eachCell({ includeEmpty: true }, (cell: ExcelJS.Cell) => { cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: SUMMARY_SECTION_FILL } }; cell.font = { bold: true } })
  return row
}
function addSummaryLabelRow(sheet: ExcelJS.Worksheet, label: string, value: unknown) {
  const row = sheet.addRow([label, value])
  row.getCell(1).font = { bold: true }
  return row
}
function addSummaryStatusRow(sheet: ExcelJS.Worksheet, label: string, value: number, statusKey: string) {
  const row = sheet.addRow([label, value])
  const fillArgb = SUMMARY_STATUS_FILL[statusKey]
  row.getCell(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: fillArgb } }
  row.getCell(2).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: fillArgb } }
  row.getCell(1).font = { bold: true }
  if (statusKey === 'breached') {
    row.getCell(1).font = { bold: true, color: { argb: 'FFFFFFFF' } }
    row.getCell(2).font = { bold: true, color: { argb: 'FFFFFFFF' } }
  }
  return row
}
function addSummaryBalanceHeaderRow(sheet: ExcelJS.Worksheet) {
  const row = sheet.addRow(['Material', 'Balance'])
  row.eachCell((cell: ExcelJS.Cell) => { cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: SUMMARY_SECTION_FILL } }; cell.font = { bold: true } })
  return row
}
function addSummaryDisclaimerRow(sheet: ExcelJS.Worksheet, label: string, text: string) {
  const row = sheet.addRow([label, text])
  row.getCell(1).font = { bold: true, italic: true }
  row.getCell(2).font = { italic: true }
  row.getCell(2).alignment = { wrapText: true, vertical: 'top' }
  row.eachCell((cell: ExcelJS.Cell) => { cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: SUMMARY_DISCLAIMER_FILL } } })
  return row
}

async function buildItc04Workbook(tenantId: string, principal: Principal, tenantGstin: string, companyName: string, dateFrom: string, dateTo: string): Promise<{ workbook: ExcelJS.Workbook }> {
  const [t4, t5a, t5b, t5c, aggregateBalance] = await Promise.all([
    fetchTable4(tenantId, principal.id, dateFrom, dateTo),
    fetchReturnTable(tenantId, principal.id, TABLE_5A_PURPOSES, dateFrom, dateTo),
    fetchReturnTable(tenantId, principal.id, TABLE_5B_PURPOSES, dateFrom, dateTo),
    fetchTable5C(tenantId, principal.id, dateFrom, dateTo),
    fetchAggregateBalance(tenantId, principal.id),
  ])

  const workbook = new ExcelJS.Workbook()

  const summarySheet = workbook.addWorksheet('Summary')
  summarySheet.columns = [{ key: 'label', width: 40 }, { key: 'value', width: 60 }]

  const titleRow = summarySheet.addRow(['ITC-04 WORKING PAPER', ''])
  summarySheet.mergeCells('A1:B1')
  titleRow.getCell(1).font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 13 }
  titleRow.getCell(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFF5C1A' } }
  titleRow.getCell(1).alignment = { horizontal: 'center', vertical: 'middle' }

  addSummarySectionHeader(summarySheet, 'Filing Details')
  addSummaryLabelRow(summarySheet, 'Tenant GSTIN', tenantGstin)
  addSummaryLabelRow(summarySheet, 'Tenant Name', companyName)
  addSummaryLabelRow(summarySheet, 'Principal', principal.name)
  addSummaryLabelRow(summarySheet, 'Period', `${fmtDDMMYYYY(dateFrom)} to ${fmtDDMMYYYY(dateTo)}`)

  summarySheet.addRow([''])
  addSummarySectionHeader(summarySheet, 'Status Summary')
  addSummaryStatusRow(summarySheet, 'Within Limit (Green)', t4.filter((r) => r.status === 'within_limit').length, 'within_limit')
  addSummaryStatusRow(summarySheet, 'Warning (Amber)', t4.filter((r) => r.status === 'warning').length, 'warning')
  addSummaryStatusRow(summarySheet, 'Breach Warning (Red)', t4.filter((r) => r.status === 'breach_warning').length, 'breach_warning')
  addSummaryStatusRow(summarySheet, 'Breached (Red)', t4.filter((r) => r.status === 'breached').length, 'breached')

  summarySheet.addRow([''])
  addSummarySectionHeader(summarySheet, 'Quantity Summary')
  addSummaryLabelRow(summarySheet, 'Total quantity sent (Table 4, this period)', t4.reduce((s, r) => s + r.quantity, 0))
  addSummaryLabelRow(summarySheet, 'Total quantity returned (Tables 5A+5B, this period)', t5a.reduce((s: number, r: any) => s + (r.quantity || 0), 0) + t5b.reduce((s: number, r: any) => s + (r.quantity || 0), 0))
  addSummaryLabelRow(summarySheet, 'Total value — direct supply (Table 5C, this period)', t5c.reduce((s: number, r: any) => s + (r.value || 0), 0))

  summarySheet.addRow([''])
  addSummarySectionHeader(summarySheet, 'Net Outstanding Balance (All-Time, From Stock Ledger)')
  addSummaryBalanceHeaderRow(summarySheet)
  aggregateBalance.forEach((b: any) => summarySheet.addRow([b.material_name, `${b.current_stock} ${b.uqc || 'OTH'}`]))

  summarySheet.addRow([''])
  addSummarySectionHeader(summarySheet, 'Notes & Disclaimers')
  addSummaryDisclaimerRow(summarySheet, 'Disclaimers', 'All receipts treated as "inputs" (365-day clock) — no capital-goods/exempt-tooling distinction. Table 4 rows keep running the full 365 days regardless of returns elsewhere (no lot-level matching) — the net outstanding balance above is the true current exposure. Table 5B captures scrap_return movements only; verify with your CA whether inter_jobworker_transfer movements should also be included before filing ITC-04. Original-challan links in Tables 5A/5B are shown only where actually recorded in Nexflow — otherwise marked Not Linked, never estimated.')

  const t4Sheet = workbook.addWorksheet('Table 4')
  t4Sheet.columns = [
    { header: 'GSTIN of Job Worker', key: 'gstin', width: 18 },
    { header: 'Name of Job Worker', key: 'name', width: 24 },
    { header: 'Principal Challan No.', key: 'pChallanNo', width: 20 },
    { header: 'Principal Challan Date', key: 'pChallanDate', width: 18 },
    { header: 'Nexflow GRN Ref (not for filing)', key: 'grnRef', width: 24 },
    { header: 'Description of Goods', key: 'desc', width: 28 },
    { header: 'UQC', key: 'uqc', width: 10 },
    { header: 'Quantity', key: 'qty', width: 12, numFmt: '#,##0.###' },
    { header: 'Estimated Value (₹)', key: 'value', width: 16, numFmt: '#,##0.00' },
    { header: 'Days Elapsed', key: 'days', width: 12 },
    { header: 'Status', key: 'status', width: 16 },
  ]
  styleHeaderRow(t4Sheet.getRow(1))
  t4.forEach((r) => {
    const row = t4Sheet.addRow({
      gstin: tenantGstin, name: companyName, pChallanNo: r.principalChallanNo || '', pChallanDate: r.principalChallanDate || '',
      grnRef: `${r.grnNo} / ${r.transactionDate}`, desc: r.materialName, uqc: r.uqc, qty: r.quantity,
      value: r.estValue, days: r.daysElapsed, status: STATUS_META[r.status].label,
    })
    row.getCell('status').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: STATUS_FILL[r.status] } }
    if (r.status === 'breached') row.getCell('status').font = { bold: true, color: { argb: 'FFFFFFFF' } }
  })
  t4Sheet.views = [{ state: 'frozen', ySplit: 1 }]

  const buildReturnSheet = (name: string, rows: any[], includePurposeCol: boolean) => {
    const sheet = workbook.addWorksheet(name)
    const cols: any[] = [
      { header: 'Return Challan No.', key: 'challanNo', width: 18 },
      { header: 'Return Date', key: 'date', width: 14 },
    ]
    if (includePurposeCol) cols.push({ header: 'Purpose', key: 'purpose', width: 20 })
    cols.push(
      { header: 'Description', key: 'desc', width: 28 },
      { header: 'UQC', key: 'uqc', width: 10 },
      { header: 'Quantity', key: 'qty', width: 12, numFmt: '#,##0.###' },
      { header: 'Original Challan', key: 'orig', width: 26 },
      { header: 'Time Taken (days)', key: 'timeTaken', width: 16 },
    )
    sheet.columns = cols
    styleHeaderRow(sheet.getRow(1))
    rows.forEach((r) => {
      const rowData: any = { challanNo: r.challanNo, date: r.dispatchDate, desc: r.description, uqc: r.uqc, qty: r.quantity, orig: r.originalRef, timeTaken: r.timeTaken ?? '' }
      if (includePurposeCol) rowData.purpose = PURPOSE_LABELS[r.movementPurpose] || r.movementPurpose
      sheet.addRow(rowData)
    })
    sheet.views = [{ state: 'frozen', ySplit: 1 }]
  }
  buildReturnSheet('Table 5A', t5a, true)
  buildReturnSheet('Table 5B', t5b, false)

  const t5cSheet = workbook.addWorksheet('Table 5C')
  t5cSheet.columns = [
    { header: 'Challan No.', key: 'challanNo', width: 18 },
    { header: 'Challan Date', key: 'date', width: 14 },
    { header: 'Buyer Name', key: 'buyer', width: 24 },
    { header: 'Buyer GSTIN', key: 'buyerGstin', width: 18 },
    { header: 'Description', key: 'desc', width: 28 },
    { header: 'UQC', key: 'uqc', width: 10 },
    { header: 'Quantity', key: 'qty', width: 12, numFmt: '#,##0.###' },
    { header: 'Invoice No.', key: 'invNo', width: 18 },
    { header: 'Invoice Date', key: 'invDate', width: 14 },
    { header: 'Invoice Status', key: 'invStatus', width: 14 },
    { header: 'Value (₹)', key: 'value', width: 16, numFmt: '#,##0.00' },
  ]
  styleHeaderRow(t5cSheet.getRow(1))
  t5c.forEach((r) => t5cSheet.addRow({ challanNo: r.challanNo, date: r.dispatchDate, buyer: r.buyerName || '', buyerGstin: r.buyerGstin || '', desc: r.description, uqc: r.uqc, qty: r.quantity, invNo: r.invoiceNo || '', invDate: r.invoiceDate || '', invStatus: r.invoiceStatus || '', value: r.value }))
  t5cSheet.views = [{ state: 'frozen', ySplit: 1 }]

  return { workbook }
}

// ─── HSN audit snapshot — last export.html HSN Audit result only, never
// re-run automatically (migration 20260909_hsn_audit_source.sql). ─────────
async function buildHsnAuditWorkbook(tenantId: string): Promise<{ workbook: ExcelJS.Workbook } | null> {
  const [materialsResult, productsResult] = await Promise.all([
    supabase.from('p2_raw_materials').select('name, material_code, hsn_sac, hsn_source').eq('tenant_id', tenantId).in('hsn_source', ['ai_verified', 'ai_corrected']),
    supabase.from('p2_products').select('name, product_code, hsn_sac, hsn_source').eq('tenant_id', tenantId).in('hsn_source', ['ai_verified', 'ai_corrected']),
  ])
  if (materialsResult.error) throw new Error(`HSN audit materials: ${materialsResult.error.message}`)
  if (productsResult.error) throw new Error(`HSN audit products: ${productsResult.error.message}`)

  const rows = [
    ...(materialsResult.data || []).map((m: any) => ({ type: 'Raw Material', name: m.name, code: m.material_code || '', hsnSac: m.hsn_sac || '', source: m.hsn_source })),
    ...(productsResult.data || []).map((p: any) => ({ type: 'Product', name: p.name, code: p.product_code || '', hsnSac: p.hsn_sac || '', source: p.hsn_source })),
  ]
  if (!rows.length) return null

  const workbook = new ExcelJS.Workbook()
  const sheet = workbook.addWorksheet('HSN Audit Snapshot')
  sheet.columns = [
    { header: 'Type', key: 'type', width: 14 },
    { header: 'Name', key: 'name', width: 32 },
    { header: 'Code', key: 'code', width: 16 },
    { header: 'HSN/SAC', key: 'hsnSac', width: 14 },
    { header: 'Source', key: 'source', width: 16 },
  ]
  rows.forEach((r) => sheet.addRow(r))
  // .columns rewrites row 1 as the header — insert the intro row AFTER, which
  // shifts everything down one row (same ExcelJS quirk itc04-workingpaper.html
  // documents for its own Summary sheet title row).
  sheet.insertRow(1, ['This reflects the last HSN Audit run in export.html — not re-run automatically. Verify all AI-assessed codes with your CA before filing.'])
  sheet.mergeCells('A1:E1')
  sheet.getRow(1).font = { italic: true }
  sheet.getRow(1).alignment = { wrapText: true, vertical: 'top' }
  styleHeaderRow(sheet.getRow(2))
  sheet.views = [{ state: 'frozen', ySplit: 2 }]

  return { workbook }
}

// ─── Tally XML (js/full-export.js:246-436, period-scoped instead of
// current-FY-scoped, queried fresh rather than reusing an in-memory CSV
// dump). ────────────────────────────────────────────────────────────────
const LEDGERS = {
  salesTaxable: 'Job Work Charges @ 18%', outputCgst: 'Output CGST', outputSgst: 'Output SGST', outputIgst: 'Output IGST',
  inputCgst: 'Input CGST', inputSgst: 'Input SGST', inputIgst: 'Input IGST', roundOff: 'Round Off',
}

function xmlEscape(s: unknown): string {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}
function ymd(isoDate: string | null | undefined): string {
  return String(isoDate || '').slice(0, 10).replace(/-/g, '')
}
function fnv1aHex(str: string): string {
  let hash = 0x811c9dc5
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
}
// NOT the canonical Bridge Agent REMOTEID (Session 18+ per enterprise-strategy.md
// §3.1) — same synchronous placeholder hash js/full-export.js already uses and
// already discloses to the client in its own README.
function buildRemoteId(tenantId: string, doctype: string, sourceKey: string): string {
  return `nexflow-${String(tenantId).slice(0, 8)}-${doctype}-${fnv1aHex(String(sourceKey)).slice(0, 8)}`
}
function isBalanced(entries: Array<{ amount: number }>): boolean {
  const sum = entries.reduce((s, e) => s + e.amount, 0)
  return Math.abs(sum) < 0.01
}

interface VoucherEntry { ledger: string; amount: number; isParty?: boolean }
interface Voucher {
  remoteId: string; vchType: string; voucherNumber: string; date: string
  partyLedgerName: string; partyGstin: string; placeOfSupply: string; stateName: string
  narration: string; entries: VoucherEntry[]
}

function renderVoucherEntries(entries: VoucherEntry[]): string {
  return entries.map((e) => {
    const partyTag = e.isParty ? '\n     <ISPARTYLEDGER>Yes</ISPARTYLEDGER>' : ''
    return `
    <ALLLEDGERENTRIES.LIST>
     <LEDGERNAME>${xmlEscape(e.ledger)}</LEDGERNAME>
     <ISDEEMEDPOSITIVE>${e.amount < 0 ? 'Yes' : 'No'}</ISDEEMEDPOSITIVE>${partyTag}
     <AMOUNT>${e.amount.toFixed(2)}</AMOUNT>
    </ALLLEDGERENTRIES.LIST>`
  }).join('')
}
function renderVoucher(v: Voucher): string {
  return `
   <TALLYMESSAGE xmlns:UDF="TallyUDF">
    <VOUCHER REMOTEID="${xmlEscape(v.remoteId)}" VCHTYPE="${v.vchType}" ACTION="Create" OBJVIEW="Accounting Voucher View">
     <DATE>${v.date}</DATE>
     <EFFECTIVEDATE>${v.date}</EFFECTIVEDATE>
     <VOUCHERTYPENAME>${v.vchType}</VOUCHERTYPENAME>
     <VOUCHERNUMBER>${xmlEscape(v.voucherNumber)}</VOUCHERNUMBER>
     <REFERENCE>${xmlEscape(v.voucherNumber)}</REFERENCE>
     <REFERENCEDATE>${v.date}</REFERENCEDATE>
     <PARTYLEDGERNAME>${xmlEscape(v.partyLedgerName)}</PARTYLEDGERNAME>
     <PARTYNAME>${xmlEscape(v.partyLedgerName)}</PARTYNAME>
     <PARTYGSTIN>${xmlEscape(v.partyGstin)}</PARTYGSTIN>
     <PLACEOFSUPPLY>${xmlEscape(v.placeOfSupply)}</PLACEOFSUPPLY>
     <STATENAME>${xmlEscape(v.stateName)}</STATENAME>
     <COUNTRYOFRESIDENCE>India</COUNTRYOFRESIDENCE>
     <GSTREGISTRATIONTYPE>Regular</GSTREGISTRATIONTYPE>
     <PERSISTEDVIEW>Accounting Voucher View</PERSISTEDVIEW>
     <NARRATION>${xmlEscape(v.narration)}</NARRATION>${renderVoucherEntries(v.entries)}
    </VOUCHER>
   </TALLYMESSAGE>`
}
function renderEnvelope(vouchers: Voucher[], companyName: string): string {
  const messages = vouchers.map((v) => renderVoucher(v)).join('')
  return `<ENVELOPE>
 <HEADER>
  <TALLYREQUEST>Import Data</TALLYREQUEST>
 </HEADER>
 <BODY>
  <IMPORTDATA>
   <REQUESTDESC>
    <REPORTNAME>Vouchers</REPORTNAME>
    <STATICVARIABLES>
     <SVCURRENTCOMPANY>${xmlEscape(companyName)}</SVCURRENTCOMPANY>
    </STATICVARIABLES>
   </REQUESTDESC>
   <REQUESTDATA>${messages}
   </REQUESTDATA>
  </IMPORTDATA>
 </BODY>
</ENVELOPE>`
}

function buildSalesVouchers(invoices: Array<Record<string, any>>, tenantId: string): { vouchers: Voucher[]; skipped: number } {
  const vouchers: Voucher[] = []
  let skipped = 0
  for (const inv of invoices) {
    const total = Number(inv.amount_total) || 0
    const subtotal = Number(inv.amount_subtotal) || 0
    const gstAmt = Number(inv.amount_gst) || 0
    const roundOff = Number(inv.round_off) || 0

    const entries: VoucherEntry[] = [
      { ledger: inv.client_name || 'Unknown Party', isParty: true, amount: -total },
      { ledger: LEDGERS.salesTaxable, amount: subtotal },
    ]
    if (inv.gst_type === 'cgst_sgst') {
      entries.push({ ledger: LEDGERS.outputCgst, amount: gstAmt / 2 })
      entries.push({ ledger: LEDGERS.outputSgst, amount: gstAmt / 2 })
    } else if (inv.gst_type === 'igst') {
      entries.push({ ledger: LEDGERS.outputIgst, amount: gstAmt })
    }
    if (roundOff) entries.push({ ledger: LEDGERS.roundOff, amount: roundOff })

    const remoteId = buildRemoteId(tenantId, 'inv', inv.id)
    const dateStr = ymd(inv.invoice_date)
    const voucher: Voucher = {
      remoteId, vchType: 'Sales', voucherNumber: inv.invoice_number || inv.id, date: dateStr,
      partyLedgerName: inv.client_name || 'Unknown Party', partyGstin: inv.client_gstin || '',
      placeOfSupply: (inv.gst_type === 'igst' ? gstinStateNameBare(inv.client_gstin) : '') || 'Maharashtra',
      stateName: 'Maharashtra', narration: `Nexflow ${inv.invoice_number || ''} | src:${remoteId}`, entries,
    }
    if (isBalanced(entries)) vouchers.push(voucher); else skipped++
  }
  return { vouchers, skipped }
}

function buildPurchaseVouchers(grnRows: Array<Record<string, any>>, suppliersById: Map<string, any>, materialsById: Map<string, any>, tenantId: string): { vouchers: Voucher[]; skipped: number } {
  const groups = new Map<string, any[]>()
  for (const row of grnRows) {
    const norm = normaliseInvoiceNo(row.invoice_no)
    if (!row.supplier_id || !norm) continue
    const key = row.supplier_id + '|' + norm
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key)!.push(row)
  }

  const vouchers: Voucher[] = []
  let skipped = 0

  for (const [key, rows] of groups) {
    const supplier = suppliersById.get(rows[0].supplier_id) || {}
    const isInterstate = rows[0].purchase_type === 'interstate'

    const byRate = new Map<number, number>()
    for (const row of rows) {
      const material = materialsById.get(row.raw_material_id)
      const rate = Number(material?.gst_rate) || 0
      const amount = (Number(row.quantity) || 0) * (Number(row.rate) || 0)
      byRate.set(rate, (byRate.get(rate) || 0) + amount)
    }

    const entries: VoucherEntry[] = []
    let grandTotal = 0
    for (const [rate, taxable] of byRate) {
      entries.push({ ledger: `Purchase @ ${rate}%`, amount: -taxable })
      const taxAmt = (taxable * rate) / 100
      if (isInterstate) {
        entries.push({ ledger: LEDGERS.inputIgst, amount: -taxAmt })
      } else {
        entries.push({ ledger: LEDGERS.inputCgst, amount: -taxAmt / 2 })
        entries.push({ ledger: LEDGERS.inputSgst, amount: -taxAmt / 2 })
      }
      grandTotal += taxable + taxAmt
    }
    entries.push({ ledger: supplier.name || 'Unknown Supplier', isParty: true, amount: grandTotal })

    const earliestDate = rows.reduce((min: string, r: any) => (r.transaction_date < min ? r.transaction_date : min), rows[0].transaction_date)
    const remoteId = buildRemoteId(tenantId, 'pur', key)
    const voucher: Voucher = {
      remoteId, vchType: 'Purchase', voucherNumber: rows[0].invoice_no || key, date: ymd(earliestDate),
      partyLedgerName: supplier.name || 'Unknown Supplier', partyGstin: supplier.gstin || '',
      placeOfSupply: 'Maharashtra', stateName: 'Maharashtra',
      narration: `Nexflow GRN ${rows[0].invoice_no || ''} | src:${remoteId}`, entries,
    }
    if (isBalanced(entries)) vouchers.push(voucher); else skipped++
  }
  return { vouchers, skipped }
}

async function buildTallyXml(tenantId: string, companyName: string, monthFrom: string, monthTo: string): Promise<{ xml: string; skippedVouchers: number; voucherCount: number }> {
  const [invoicesResult, grnResult] = await Promise.all([
    supabase.from('p2_invoices').select('id, invoice_number, invoice_date, client_name, client_gstin, gst_type, amount_subtotal, amount_gst, amount_total, round_off, status').eq('tenant_id', tenantId).eq('status', 'sent').gte('invoice_date', monthFrom).lte('invoice_date', monthTo),
    supabase.from('p2_stock_transactions').select('id, transaction_date, quantity, rate, invoice_no, supplier_id, raw_material_id, purchase_type, owned_by').eq('tenant_id', tenantId).eq('transaction_type', 'grn').is('owned_by', null).gte('transaction_date', monthFrom).lte('transaction_date', monthTo),
  ])
  if (invoicesResult.error) throw new Error(`Tally XML invoices: ${invoicesResult.error.message}`)
  if (grnResult.error) throw new Error(`Tally XML GRN rows: ${grnResult.error.message}`)

  const invoices = invoicesResult.data || []
  const grnRows = (grnResult.data || []) as Array<Record<string, any>>
  // Second assertion (query-level .is('owned_by', null) is the first) — see
  // js/full-export.js:189-201 and enterprise-strategy.md §3.1's hard invariant.
  const leaked = grnRows.filter((r) => r.owned_by !== null)
  if (leaked.length) throw new Error(`${leaked.length} principal-owned GRN row(s) leaked past the owned_by filter`)

  const supplierIds = [...new Set(grnRows.map((r) => r.supplier_id).filter(Boolean))]
  const materialIds = [...new Set(grnRows.map((r) => r.raw_material_id).filter(Boolean))]
  const [{ data: suppliers }, { data: materials }] = await Promise.all([
    supplierIds.length ? supabase.from('p2_suppliers').select('id, name, gstin').in('id', supplierIds) : Promise.resolve({ data: [] as any[] }),
    materialIds.length ? supabase.from('p2_raw_materials').select('id, gst_rate').in('id', materialIds) : Promise.resolve({ data: [] as any[] }),
  ])
  const suppliersById = new Map((suppliers || []).map((s: any) => [s.id, s]))
  const materialsById = new Map((materials || []).map((m: any) => [m.id, m]))

  const salesResult = buildSalesVouchers(invoices, tenantId)
  const purchaseResult = buildPurchaseVouchers(grnRows, suppliersById, materialsById, tenantId)
  const allVouchers = salesResult.vouchers.concat(purchaseResult.vouchers)
  const skippedVouchers = salesResult.skipped + purchaseResult.skipped

  const xml = renderEnvelope(allVouchers, (companyName || '').toUpperCase())
  return { xml, skippedVouchers, voucherCount: allVouchers.length }
}

function isBlank(v: unknown): boolean {
  return !v || !String(v).trim()
}

// ─── Covering note data (§2 / enterprise-strategy.md §3.2) — raw rows for Opus
// judgment plus a fixed set of server-computed counts for the Haiku/
// deterministic fallback layers below. Deliberately NOT a repeat of Session
// 15's computeExceptionCounts() shape: Opus needs to see actual rows (invoice
// line items, GRN rows, dispatch purposes) to judge misclassification, not
// just pre-aggregated counts — enterprise-strategy.md §3.2's design rule is
// "the model reads computed totals and a bounded set of flagged rows... never
// asked to add anything up"; here it's asked to judge, not add, so it gets
// the rows. ──────────────────────────────────────────────────────────────────

// Two movement purposes where a client tax invoice is the legally correct
// document — agent-query/index.ts:1772. Duplicated here for the same
// no-shared-module reason as every other agent-query constant already
// replicated in this file (computeS143Clock, JOIN_COLUMNS, etc.).
const SALE_INVOICEABLE_PURPOSES = new Set(['sale', 'direct_supply_from_jobworker'])

interface CoveringNoteInvoiceLine {
  description: string; hsnSac: string; qty: number; unit: string; rate: number; amount: number
}
interface CoveringNoteInvoice {
  invoiceNumber: string; invoiceDate: string; clientName: string; clientGstin: string | null
  gstType: string; amountSubtotal: number; amountGst: number; amountTotal: number
  invoiceMode: string; items: CoveringNoteInvoiceLine[]
}
interface CoveringNoteGrnRow {
  supplierName: string; supplierGstin: string | null; invoiceNo: string | null
  transactionDate: string; materialName: string; quantity: number; rate: number | null
  purchaseType: string; gstRate: number | null
}
interface CoveringNoteDispatch {
  challanNumber: string; dispatchDate: string; clientName: string | null
  movementPurpose: string; itemCount: number
}
interface WrongInvoiceDispatch { challanNumber: string; movementPurpose: string; invoiceNumbers: string[] }
interface OverdueInvoice { invoiceNumber: string; clientName: string; balanceDue: number; invoiceDate: string }
interface PrincipalReceipt { principalName: string; materialName: string; quantity: number }
interface S143RiskLot { principalName: string; materialName: string; daysElapsed: number; status: string; deadlineDate: string }
interface JobWorkReturnDispatch { challanNumber: string; dispatchDate: string; movementPurpose: string }
interface NoHsnDispatchItem { name: string; kind: 'raw_material' | 'product' }

interface CoveringNoteCounts {
  missingInvoiceNoCount: number
  missingHsnLineCount: number
  interstateCount: number
  overdueInvoiceCount: number
  msmeRiskCount: number
  s143BreachCount: number
  wrongInvoiceOnJobWorkCount: number
  neverAuditedMaterialCount: number
}

interface CoveringNoteData {
  tenant: { companyName: string; gstin: string; isJobWorker: boolean; periodMonth: string; periodLabelText: string; caEmail: string | null }
  invoices: CoveringNoteInvoice[]
  grnRows: CoveringNoteGrnRow[]
  dispatches: CoveringNoteDispatch[]
  wrongInvoiceDispatches: WrongInvoiceDispatch[]
  hsnAudit: { aiVerifiedCount: number; aiCorrectedCount: number; neverAuditedCount: number; dispatchedNoHsn: NoHsnDispatchItem[] }
  overdueInvoices: OverdueInvoice[]
  msmeRiskClients: string[]
  jobWork: { principalReceipts: PrincipalReceipt[]; s143RiskLots: S143RiskLot[]; returnDispatches: JobWorkReturnDispatch[] } | null
  counts: CoveringNoteCounts
}

async function fetchCoveringNoteData(
  tenantId: string,
  monthFrom: string,
  monthTo: string,
  isJobWorker: boolean,
  tenant: TenantRow,
  periodMonth: string
): Promise<CoveringNoteData> {
  // b. Invoices this period — full items jsonb kept per line (trimmed), not
  // collapsed to a boolean, so Opus can judge misclassification directly
  // (e.g. a product HSN on a job-work SAC line), per enterprise-strategy.md
  // §3.2's job list ("Judge whether a line is misclassified... Opus").
  const { data: invoiceRows, error: invErr } = await supabase
    .from('p2_invoices')
    .select('invoice_number, invoice_date, client_name, client_gstin, gst_type, amount_subtotal, amount_gst, amount_total, invoice_mode, items')
    .eq('tenant_id', tenantId).eq('status', 'sent')
    .gte('invoice_date', monthFrom).lte('invoice_date', monthTo)
  if (invErr) throw new Error(`Covering note invoices: ${invErr.message}`)

  let missingHsnLineCount = 0
  const invoices: CoveringNoteInvoice[] = (invoiceRows || []).map((inv: any) => {
    const items: CoveringNoteInvoiceLine[] = (Array.isArray(inv.items) ? inv.items : []).map((it: any) => {
      if (isBlank(it.hsn_sac)) missingHsnLineCount++
      return {
        description: it.description || '', hsnSac: it.hsn_sac || '', qty: Number(it.qty) || 0,
        unit: it.unit || '', rate: Number(it.rate) || 0, amount: Number(it.amount) || 0,
      }
    })
    return {
      invoiceNumber: inv.invoice_number, invoiceDate: inv.invoice_date, clientName: inv.client_name,
      clientGstin: inv.client_gstin || null, gstType: inv.gst_type,
      amountSubtotal: Number(inv.amount_subtotal), amountGst: Number(inv.amount_gst), amountTotal: Number(inv.amount_total),
      invoiceMode: inv.invoice_mode, items,
    }
  })

  // c. GRN rows this period.
  const { data: grnRowsRaw, error: grnErr } = await supabase
    .from('p2_stock_transactions')
    .select('supplier_name, invoice_no, transaction_date, quantity, rate, purchase_type, p2_raw_materials(name, gst_rate), p2_suppliers(gstin)')
    .eq('tenant_id', tenantId).eq('transaction_type', 'grn')
    .gte('transaction_date', monthFrom).lte('transaction_date', monthTo)
  if (grnErr) throw new Error(`Covering note GRN rows: ${grnErr.message}`)

  const grnRows: CoveringNoteGrnRow[] = (grnRowsRaw || []).map((r: any) => ({
    supplierName: r.supplier_name || '', supplierGstin: r.p2_suppliers?.gstin || null,
    invoiceNo: r.invoice_no || null, transactionDate: r.transaction_date,
    materialName: r.p2_raw_materials?.name || '(deleted material)',
    quantity: Number(r.quantity), rate: r.rate === null ? null : Number(r.rate),
    purchaseType: r.purchase_type,
    gstRate: r.p2_raw_materials?.gst_rate === null || r.p2_raw_materials?.gst_rate === undefined ? null : Number(r.p2_raw_materials.gst_rate),
  }))
  const missingInvoiceNoCount = grnRows.filter((r) => isBlank(r.invoiceNo)).length
  const interstateCount = grnRows.filter((r) => r.purchaseType === 'interstate').length

  // d. Dispatch data this period, plus batched item counts/lookups (one query
  // reused for both the item-count and the no-HSN-dispatched check below).
  const { data: orders, error: ordersErr } = await supabase
    .from('p2_dispatch_orders')
    .select('id, challan_number, dispatch_date, client_name, movement_purpose')
    .eq('tenant_id', tenantId).eq('status', 'confirmed')
    .gte('dispatch_date', monthFrom).lte('dispatch_date', monthTo)
  if (ordersErr) throw new Error(`Covering note dispatch orders: ${ordersErr.message}`)

  const orderIds = (orders || []).map((o: any) => o.id)
  let dispatchItems: Array<{ dispatch_order_id: string; raw_material_id: string | null; product_id: string | null }> = []
  if (orderIds.length) {
    const { data: itemRows, error: itemsErr } = await supabase
      .from('p2_dispatch_items').select('dispatch_order_id, raw_material_id, product_id').in('dispatch_order_id', orderIds)
    if (itemsErr) throw new Error(`Covering note dispatch items: ${itemsErr.message}`)
    dispatchItems = itemRows || []
  }
  const itemCountByOrder = new Map<string, number>()
  for (const it of dispatchItems) itemCountByOrder.set(it.dispatch_order_id, (itemCountByOrder.get(it.dispatch_order_id) || 0) + 1)

  const dispatches: CoveringNoteDispatch[] = (orders || []).map((o: any) => ({
    challanNumber: o.challan_number, dispatchDate: o.dispatch_date, clientName: o.client_name || null,
    movementPurpose: o.movement_purpose, itemCount: itemCountByOrder.get(o.id) || 0,
  }))

  // Wrong-invoice-on-job-work-dispatch: non-sale-purpose orders this period
  // that still have an invoice attached. dispatch_order_ids (uuid[]) is
  // populated by BOTH single and consolidated invoice modes
  // (agent-query/index.ts:2464), so one .overlaps() query covers both — no
  // separate dispatch_order_id equality check needed.
  const nonSaleOrders = (orders || []).filter((o: any) => !SALE_INVOICEABLE_PURPOSES.has(o.movement_purpose))
  const wrongInvoiceDispatches: WrongInvoiceDispatch[] = []
  if (nonSaleOrders.length) {
    const nonSaleOrderIds = nonSaleOrders.map((o: any) => o.id)
    const { data: badInvoices, error: badInvErr } = await supabase
      .from('p2_invoices').select('invoice_number, dispatch_order_ids')
      .eq('tenant_id', tenantId).overlaps('dispatch_order_ids', nonSaleOrderIds)
    if (badInvErr) throw new Error(`Covering note wrong-invoice check: ${badInvErr.message}`)
    const orderById = new Map(nonSaleOrders.map((o: any) => [o.id, o]))
    const grouped = new Map<string, WrongInvoiceDispatch>()
    for (const inv of badInvoices || []) {
      for (const oid of (inv.dispatch_order_ids || []) as string[]) {
        const order = orderById.get(oid)
        if (!order) continue
        if (!grouped.has(oid)) grouped.set(oid, { challanNumber: order.challan_number, movementPurpose: order.movement_purpose, invoiceNumbers: [] })
        grouped.get(oid)!.invoiceNumbers.push(inv.invoice_number)
      }
    }
    wrongInvoiceDispatches.push(...grouped.values())
  }

  // e. HSN audit status.
  const [materialsResult, productsResult] = await Promise.all([
    supabase.from('p2_raw_materials').select('id, name, hsn_sac, hsn_source').eq('tenant_id', tenantId).eq('is_active', true),
    supabase.from('p2_products').select('id, name, hsn_sac, hsn_source').eq('tenant_id', tenantId),
  ])
  if (materialsResult.error) throw new Error(`Covering note materials: ${materialsResult.error.message}`)
  if (productsResult.error) throw new Error(`Covering note products: ${productsResult.error.message}`)
  const materials = materialsResult.data || []
  const products = productsResult.data || []
  const allSources = [...materials.map((m: any) => m.hsn_source), ...products.map((p: any) => p.hsn_source)]
  const aiVerifiedCount = allSources.filter((s) => s === 'ai_verified').length
  const aiCorrectedCount = allSources.filter((s) => s === 'ai_corrected').length
  const neverAuditedCount = allSources.filter((s) => !s || s === 'manual').length

  const materialsById = new Map(materials.map((m: any) => [m.id, m]))
  const productsById = new Map(products.map((p: any) => [p.id, p]))
  const noHsnSet = new Map<string, NoHsnDispatchItem>()
  for (const item of dispatchItems) {
    if (item.raw_material_id) {
      const m = materialsById.get(item.raw_material_id) as any
      if (m && isBlank(m.hsn_sac)) noHsnSet.set(`rm:${m.id}`, { name: m.name, kind: 'raw_material' })
    }
    if (item.product_id) {
      const p = productsById.get(item.product_id) as any
      if (p && isBlank(p.hsn_sac)) noHsnSet.set(`pd:${p.id}`, { name: p.name, kind: 'product' })
    }
  }
  const dispatchedNoHsn = [...noHsnSet.values()]

  // f. Payment status — NOT period-scoped: every currently-overdue invoice
  // regardless of invoice_date, since an old unpaid invoice stays relevant
  // every month until resolved (confirmed design decision during planning).
  const { data: overdueRows, error: overdueErr } = await supabase
    .from('v_p2_invoice_payment_status')
    .select('invoice_number, client_name, balance_due, invoice_date, client_id')
    .eq('tenant_id', tenantId).eq('payment_status', 'overdue').eq('invoice_status', 'sent')
  if (overdueErr) throw new Error(`Covering note overdue invoices: ${overdueErr.message}`)
  const overdueInvoices: OverdueInvoice[] = (overdueRows || []).map((r: any) => ({
    invoiceNumber: r.invoice_number, clientName: r.client_name, balanceDue: Number(r.balance_due), invoiceDate: r.invoice_date,
  }))

  const overdueClientIds = [...new Set((overdueRows || []).map((r: any) => r.client_id).filter(Boolean))]
  let msmeRiskClients: string[] = []
  if (overdueClientIds.length) {
    const { data: msmeClients, error: msmeErr } = await supabase
      .from('p2_clients').select('name').in('id', overdueClientIds)
      .in('enterprise_class', ['micro', 'small']).not('udyam_number', 'is', null)
    if (msmeErr) throw new Error(`Covering note MSME check: ${msmeErr.message}`)
    msmeRiskClients = (msmeClients || []).map((c: any) => c.name)
  }

  // g. Job-work data — only when is_job_worker=true.
  let jobWork: CoveringNoteData['jobWork'] = null
  let s143BreachCount = 0
  if (isJobWorker) {
    const principals = await fetchJobWorkPrincipals(tenantId)
    const principalNameById = new Map(principals.map((p) => [p.id, p.name]))

    const { data: receiptsRaw, error: receiptsErr } = await supabase
      .from('p2_stock_transactions').select('owned_by, quantity, p2_raw_materials(name)')
      .eq('tenant_id', tenantId).eq('transaction_type', 'grn').not('owned_by', 'is', null)
      .gte('transaction_date', monthFrom).lte('transaction_date', monthTo)
    if (receiptsErr) throw new Error(`Covering note principal receipts: ${receiptsErr.message}`)
    const principalReceipts: PrincipalReceipt[] = (receiptsRaw || []).map((r: any) => ({
      principalName: principalNameById.get(r.owned_by) || '(unknown principal)',
      materialName: r.p2_raw_materials?.name || '(deleted material)', quantity: Number(r.quantity),
    }))

    // s.143 risk — trailing ~400-day window (365-day clock + margin), not the
    // tenant's full history, filtered to breach_warning/breached before it
    // ever reaches the payload — keeps the query bounded and the Opus input
    // small regardless of tenant age (confirmed design decision).
    const lookbackFrom = s143AddDays(todayIST(), -400)
    const { data: clockRowsRaw, error: clockErr } = await supabase
      .from('p2_stock_transactions')
      .select('owned_by, transaction_date, principal_challan_date, p2_raw_materials(name)')
      .eq('tenant_id', tenantId).eq('transaction_type', 'grn').not('owned_by', 'is', null)
      .gte('transaction_date', lookbackFrom)
    if (clockErr) throw new Error(`Covering note s.143 clock: ${clockErr.message}`)
    const today = todayIST()
    const s143RiskLots: S143RiskLot[] = []
    for (const row of (clockRowsRaw || []) as any[]) {
      const clock = computeS143Clock({ principal_challan_date: row.principal_challan_date, transaction_date: row.transaction_date }, today)
      if (clock && (clock.status === 'breach_warning' || clock.status === 'breached')) {
        s143RiskLots.push({
          principalName: principalNameById.get(row.owned_by) || '(unknown principal)',
          materialName: row.p2_raw_materials?.name || '(deleted material)',
          daysElapsed: clock.daysElapsed, status: clock.status, deadlineDate: clock.deadlineDate,
        })
      }
    }
    s143BreachCount = s143RiskLots.length

    const { data: returnOrders, error: returnErr } = await supabase
      .from('p2_dispatch_orders').select('challan_number, dispatch_date, movement_purpose')
      .eq('tenant_id', tenantId).eq('status', 'confirmed')
      .in('movement_purpose', ['job_work_return', 'unused_material_return', 'scrap_return'])
      .gte('dispatch_date', monthFrom).lte('dispatch_date', monthTo)
    if (returnErr) throw new Error(`Covering note return dispatches: ${returnErr.message}`)
    const returnDispatches: JobWorkReturnDispatch[] = (returnOrders || []).map((o: any) => ({
      challanNumber: o.challan_number, dispatchDate: o.dispatch_date, movementPurpose: o.movement_purpose,
    }))

    jobWork = { principalReceipts, s143RiskLots, returnDispatches }
  }

  return {
    tenant: {
      companyName: tenant.company_name || 'Nexflow Export', gstin: tenant.gstin || '',
      isJobWorker, periodMonth, periodLabelText: periodLabel(periodMonth), caEmail: tenant.ca_email,
    },
    invoices, grnRows, dispatches, wrongInvoiceDispatches,
    hsnAudit: { aiVerifiedCount, aiCorrectedCount, neverAuditedCount, dispatchedNoHsn },
    overdueInvoices, msmeRiskClients, jobWork,
    counts: {
      missingInvoiceNoCount, missingHsnLineCount, interstateCount,
      overdueInvoiceCount: overdueInvoices.length, msmeRiskCount: msmeRiskClients.length,
      s143BreachCount, wrongInvoiceOnJobWorkCount: wrongInvoiceDispatches.length,
      neverAuditedMaterialCount: neverAuditedCount,
    },
  }
}

// ─── Opus covering note (§2 / enterprise-strategy.md §3.2) — the one place in
// this codebase where Opus, not Haiku, is the correct model: judging
// misclassification across a month of heterogeneous rows is reasoning, not
// extraction. Three-layer guarantee: Opus -> a narrow Haiku fallback (counts
// only, never the raw rows) -> a pure deterministic fallback (no LLM call,
// cannot fail). The zip must never fail to ship because of this step. Never
// consumes the daily agent quota — checkAndIncrementAgentUsage is an
// agent-query-only concept and is never called anywhere in this file. ──────
interface CoveringNoteResult { coveringNote: string; actionItems: string[] }

function extractTextBlock(response: { content: Array<{ type: string; text?: string }> }): string {
  const block = response.content.find((b) => b.type === 'text')
  return block && block.type === 'text' && block.text ? block.text : ''
}

// Fence-stripping/parse/shape-validate — clones agent-query/index.ts:2926
// auditHsnCodes()'s exact pattern for handling a markdown-fenced JSON reply.
function stripJsonFence(rawText: string): string {
  let cleaned = rawText.trim()
  if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```(?:json)?\s*/, '').replace(/```\s*$/, '').trim()
  }
  return cleaned
}

// Strips the markdown formatting Opus sometimes uses despite being asked for
// plain prose (**bold**, *italic*, ### headers) — applied to covering_note
// only, never to action_items (already plain strings). Order matters: bold
// is stripped before italic so a **bold** run doesn't get half-matched by
// the single-asterisk italic pattern first.
function stripMarkdown(text: string): string {
  return text
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/\*(.+?)\*/g, '$1')
}

function parseCoveringNoteJson(raw: string): { coveringNote: string; actionItems: string[] } {
  // Strip markdown fences
  const stripped = raw.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```\s*$/i, '').trim()

  // Parse
  const parsed = JSON.parse(stripped) // throws if invalid — caught by caller

  // Validate — exactly four conditions
  if (parsed === null || typeof parsed !== 'object') throw new Error('Response is not an object')
  if (typeof parsed.covering_note !== 'string' || parsed.covering_note.trim() === '') throw new Error('covering_note missing or empty')
  if (!Array.isArray(parsed.action_items)) throw new Error('action_items missing or not an array')

  return {
    coveringNote: stripMarkdown(parsed.covering_note.trim()),
    actionItems: parsed.action_items.filter((i: unknown) => typeof i === 'string'),
  }
}

// Layer 1 — Opus. Gets the raw rows (data) and does judgment: misclassified
// HSN/SAC lines, wrong invoices on job-work dispatches, s.143 risk, 43B(h)
// exposure. max_tokens=2000 per the task's cost/latency budget.
async function callOpusPrimary(data: CoveringNoteData): Promise<CoveringNoteResult> {
  const systemPrompt = 'You are a GST filing assistant writing a covering note for a Chartered Accountant in India. The CA will use this note to prepare the client\'s GSTR-1, GSTR-3B, and ITC-04 filing for the period. Write in clear, professional English. Be specific — name invoice numbers, amounts, supplier names where relevant. Be actionable — every observation must have a consequence or a required action. Do not pad. Do not repeat yourself. Never invent data not present in the input. If a section has nothing to report, say so in one line and move on. Do not use markdown formatting. No bold, no italics, no headers, no bullet points in the covering_note field. Plain prose paragraphs only. Keep the covering_note between 200 and 400 words. Be concise. Do not repeat the same point in different sections. Use line breaks between paragraphs.'
  const userPrompt = `Filing period data (JSON):\n${JSON.stringify(data)}\n\nRespond with ONLY valid JSON in exactly this shape:\n{ "covering_note": "prose, 200-400 words, CA-grade, plain text no markdown", "action_items": ["numbered action item 1", "numbered action item 2"] }`

  const response = await anthropic.messages.create({
    model: 'claude-opus-5',
    max_tokens: 6000,
    system: systemPrompt,
    messages: [{ role: 'user', content: userPrompt }],
  })
  return parseCoveringNoteJson(extractTextBlock(response))
}

// Layer 2 — a fresh, narrow Haiku call. Deliberately fed ONLY the eight
// server-computed counts (never invoice line items, GRN rows, or dispatch
// rows) — this is the hard line between the two models: Opus gets raw rows
// and does judgment, Haiku gets counts and does phrasing. Same spirit as
// Session 15's deleted callHaikuExceptions(), rebuilt against the new
// {covering_note, action_items} JSON shape.
async function callHaikuCoveringNoteFallback(data: CoveringNoteData): Promise<CoveringNoteResult> {
  const systemPrompt = 'You are a GST filing assistant. Given exception counts for an Indian manufacturing tenant, write a short plain covering note (150-300 words) for a Chartered Accountant, plus a short list of action items. Be specific about what the counts mean, but never invent details beyond what the counts describe. If every count is zero, say there is nothing to report.'
  const counts = data.counts
  const lines = [
    `Company: ${data.tenant.companyName}, period: ${data.tenant.periodLabelText}, job worker: ${data.tenant.isJobWorker}`,
    `GRN rows missing a supplier invoice number: ${counts.missingInvoiceNoCount}`,
    `Invoice line items missing an HSN/SAC code: ${counts.missingHsnLineCount}`,
    `Interstate GRN rows this period (IGST, not CGST/SGST): ${counts.interstateCount}`,
    `Currently overdue invoices: ${counts.overdueInvoiceCount}`,
    `MSME clients at 43B(h) disallowance risk: ${counts.msmeRiskCount}`,
    `Job-work lots within 30 days of s.143 breach or already breached: ${counts.s143BreachCount}`,
    `Dispatches with a movement purpose that should not carry an invoice, but do: ${counts.wrongInvoiceOnJobWorkCount}`,
    `Materials/products never HSN-audited: ${counts.neverAuditedMaterialCount}`,
  ]
  const userPrompt = `${lines.join('\n')}\n\nRespond with ONLY valid JSON in exactly this shape:\n{ "covering_note": "plain prose, 150-300 words", "action_items": ["action item 1", "action item 2"] }`

  const response = await anthropic.messages.create({
    model: 'claude-haiku-4-5',
    max_tokens: 800,
    system: systemPrompt,
    messages: [{ role: 'user', content: userPrompt }],
  })
  return parseCoveringNoteJson(extractTextBlock(response))
}

// Layer 3 — pure deterministic text, no LLM call, cannot fail. Direct
// successor to Session 15's deleted fallbackExceptionsText(), rebuilt against
// the richer counts shape since the old function/aggregator is gone.
function buildDeterministicCoveringNote(data: CoveringNoteData): CoveringNoteResult {
  const c = data.counts
  const paragraphs: string[] = [
    `This covering note for ${data.tenant.companyName} (${data.tenant.periodLabelText}) was generated automatically because Nexflow's AI reviewer was unavailable this month. It lists only the counts below — for named invoices, suppliers, and challans, see the source files in this package.`,
  ]
  const actionItems: string[] = []

  if (c.missingInvoiceNoCount > 0) {
    paragraphs.push(`${c.missingInvoiceNoCount} GRN row(s) this period are missing a supplier invoice number.`)
    actionItems.push(`Obtain and record the missing supplier invoice number(s) for ${c.missingInvoiceNoCount} GRN row(s).`)
  }
  if (c.missingHsnLineCount > 0) {
    paragraphs.push(`${c.missingHsnLineCount} invoice line item(s) this period are missing an HSN/SAC code.`)
    actionItems.push(`Add the missing HSN/SAC code to ${c.missingHsnLineCount} invoice line item(s).`)
  }
  if (c.interstateCount > 0) {
    paragraphs.push(`${c.interstateCount} GRN row(s) this period are interstate purchases (IGST, not CGST/SGST) — confirm these are taxed correctly.`)
  }
  if (c.wrongInvoiceOnJobWorkCount > 0) {
    paragraphs.push(`${c.wrongInvoiceOnJobWorkCount} dispatch(es) this period have a job-work movement purpose but also carry a client invoice — this is very likely a filing error.`)
    actionItems.push(`Review ${c.wrongInvoiceOnJobWorkCount} job-work dispatch(es) that incorrectly have an invoice attached.`)
  }
  if (c.overdueInvoiceCount > 0) {
    paragraphs.push(`${c.overdueInvoiceCount} invoice(s) are currently overdue.`)
  }
  if (c.msmeRiskCount > 0) {
    paragraphs.push(`${c.msmeRiskCount} MSME client(s) have overdue invoices, carrying section 43B(h) disallowance risk.`)
    actionItems.push(`Prioritise collection from ${c.msmeRiskCount} MSME client(s) to reduce 43B(h) risk.`)
  }
  if (c.s143BreachCount > 0) {
    paragraphs.push(`${c.s143BreachCount} job-work lot(s) are within 30 days of their section 143 return deadline or have already breached it.`)
    actionItems.push(`Arrange the return of ${c.s143BreachCount} job-work lot(s) at risk of s.143 breach.`)
  }
  if (c.neverAuditedMaterialCount > 0) {
    paragraphs.push(`${c.neverAuditedMaterialCount} material(s)/product(s) have never been through an HSN audit.`)
  }
  if (paragraphs.length === 1) paragraphs.push('No exceptions were found for this period.')

  return { coveringNote: paragraphs.join('\n\n'), actionItems }
}

async function callOpusCoveringNote(data: CoveringNoteData, tenantId: string): Promise<CoveringNoteResult> {
  try {
    const result = await callOpusPrimary(data)
    void logAgentInteraction(tenantId, 'filing_covering_note', { counts: data.counts }, true, null)
    return result
  } catch (opusErr) {
    const opusMessage = opusErr instanceof Error ? opusErr.message : String(opusErr)
    try {
      const result = await callHaikuCoveringNoteFallback(data)
      void logAgentInteraction(tenantId, 'filing_covering_note', { counts: data.counts }, false, `opus_failed: ${opusMessage}`)
      return result
    } catch (haikuErr) {
      const haikuMessage = haikuErr instanceof Error ? haikuErr.message : String(haikuErr)
      void logAgentInteraction(tenantId, 'filing_covering_note', { counts: data.counts }, false, `opus_and_haiku_failed: opus=${opusMessage} haiku=${haikuMessage}`)
      return buildDeterministicCoveringNote(data)
    }
  }
}

// ─── 00-READ-THIS-FIRST.html — self-contained, no external CSS/fonts/images
// (must render correctly offline), Nexflow orange #ff5c1a. ─────────────────
function renderProseParagraphs(text: string): string {
  return text.split(/\n\s*\n/).map((p) => `<p>${escapeHtml(p.trim()).replace(/\n/g, '<br>')}</p>`).join('')
}

function buildCoveringNoteHtml(opts: {
  companyName: string; gstin: string; periodLabelText: string
  filesIncluded: string[]; note: CoveringNoteResult
}): string {
  const filesHtml = opts.filesIncluded.map((f) => `<li>${escapeHtml(f)}</li>`).join('')
  const actionItemsHtml = opts.note.actionItems.length
    ? `<ol>${opts.note.actionItems.map((a) => `<li>${escapeHtml(a)}</li>`).join('')}</ol>`
    : '<p>No specific action items for this period.</p>'

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Filing Package — ${escapeHtml(opts.companyName)} — ${escapeHtml(opts.periodLabelText)}</title>
<style>
  body { font-family: Arial, Helvetica, sans-serif; color: #222; background: #fff; margin: 0; padding: 24px; line-height: 1.5; }
  .nx-header { border-bottom: 3px solid #ff5c1a; padding-bottom: 12px; margin-bottom: 20px; }
  .nx-wordmark { font-size: 20px; font-weight: 700; color: #ff5c1a; letter-spacing: 0.5px; }
  h1 { font-size: 18px; margin: 8px 0 4px; }
  .nx-meta { font-size: 12px; color: #666; }
  h2 { font-size: 15px; color: #ff5c1a; border-bottom: 1px solid #eee; padding-bottom: 4px; margin-top: 28px; }
  ul, ol { padding-left: 20px; }
  li { margin-bottom: 4px; }
  p { margin: 0 0 12px; }
  .nx-footer { margin-top: 32px; padding-top: 12px; border-top: 1px solid #eee; font-size: 11px; color: #888; }
  @media print { body { padding: 10mm; } }
</style>
</head>
<body>
  <div class="nx-header">
    <div class="nx-wordmark">NEXFLOW AUTOMATIONS</div>
    <h1>Filing Package — ${escapeHtml(opts.companyName)} — ${escapeHtml(opts.periodLabelText)}</h1>
    <div class="nx-meta">Generated: ${escapeHtml(todayIST())} &nbsp;|&nbsp; GSTIN: ${escapeHtml(opts.gstin || '—')}</div>
  </div>

  <h2>What's in this package</h2>
  <ul>${filesHtml}</ul>

  <h2>Covering note</h2>
  ${renderProseParagraphs(opts.note.coveringNote)}

  <h2>Action items before filing</h2>
  ${actionItemsHtml}

  <div class="nx-footer">
    Generated by Nexflow Automations. This document is a filing aid, not a legal opinion.
    HSN codes are AI-assessed — verify with your CA before filing.
    Questions? WhatsApp +91 72489 32468
  </div>
</body>
</html>`
}

// ─── Email (Resend) — sender domain/body shape mirrors agent-query's
// sendInvoiceEmail (agent-query/index.ts:1789-1841), the only currently-live
// Resend call site in this codebase. ────────────────────────────────────────
async function sendFilingEmail(opts: {
  toEmails: string[]; replyTo: string | null; companyName: string; periodLabel: string
  signedUrl: string; filesIncluded: string[]; actionItems: string[]
}): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!RESEND_API_KEY) return { ok: false, error: 'RESEND_API_KEY not configured' }

  const hasActionItems = opts.actionItems.length > 0
  const actionItemsSection = hasActionItems
    ? `⚠ Action items before filing:\n${opts.actionItems.map((a, i) => `${i + 1}. ${a}`).join('\n')}`
    : '✓ No action items for this period.'
  const filesList = opts.filesIncluded.map((f) => `- ${f}`).join('\n')

  const text = `Your filing package for ${opts.periodLabel} is ready.

Download (link expires in 7 days): ${opts.signedUrl}

What's inside:
${filesList}

${actionItemsSection}

This package was generated automatically by Nexflow. Questions? WhatsApp +91 72489 32468

Disclaimer: HSN codes are AI-assessed. Verify flagged codes with your CA.`

  const filesListHtml = opts.filesIncluded.map((f) => `<li>${escapeHtml(f)}</li>`).join('')
  const actionItemsHtml = hasActionItems
    ? `<p><strong>⚠ Action items before filing:</strong></p><ol>${opts.actionItems.map((a) => `<li>${escapeHtml(a)}</li>`).join('')}</ol>`
    : '<p>✓ No action items for this period.</p>'
  const html = `<p>Your filing package for ${escapeHtml(opts.periodLabel)} is ready.</p>
<p style="margin:16px 0;">
  <a href="${opts.signedUrl}" style="color:#ff5c1a; font-weight:600;">Download the filing package →</a><br>
  <span style="font-size:12px; color:#666;">This link expires in 7 days.</span>
</p>
<p><strong>What's inside:</strong></p>
<ul>${filesListHtml}</ul>
${actionItemsHtml}
<p style="margin-top:16px; font-size:13px; color:#666;">This package was generated automatically by Nexflow. Questions? WhatsApp +91 72489 32468</p>
<p style="font-size:12px; color:#999;">HSN codes are AI-assessed. Verify flagged codes with your CA.</p>`

  const body: Record<string, unknown> = {
    from: 'Nexflow <filing@nexflowautomations.in>',
    to: opts.toEmails,
    subject: `Nexflow Filing Package — ${opts.companyName} — ${opts.periodLabel}`,
    text, html,
  }
  if (opts.replyTo && opts.replyTo.trim()) body.reply_to = opts.replyTo

  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    if (!response.ok) {
      const errText = await response.text()
      return { ok: false, error: errText || `Resend API returned ${response.status}` }
    }
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

// ─── Per-tenant orchestration ────────────────────────────────────────────────
interface TenantRow {
  tenant_id: string
  company_name: string | null
  ca_email: string | null
  accountant_email: string | null
  filing_recipient: string
  filing_package_enabled: boolean
  is_job_worker: boolean
  email: string | null
  gstin: string | null
}

// 'both' requires BOTH emails present — a partial send on a config gap would
// go unnoticed by whichever side didn't get it (plan's documented interpretation
// of the task's ambiguous "skip silently if either condition fails" wording).
function resolveRecipients(tenant: TenantRow): string[] {
  const ca = (tenant.ca_email || '').trim()
  const acct = (tenant.accountant_email || '').trim()
  if (tenant.filing_recipient === 'accountant_only') return acct ? [acct] : []
  if (tenant.filing_recipient === 'both') return (ca && acct) ? [ca, acct] : []
  return ca ? [ca] : [] // 'ca_only' and any unrecognised value
}

async function logAgentInteraction(tenantId: string, intent: string, extracted: Record<string, unknown>, success: boolean, errorReason: string | null): Promise<void> {
  try {
    await supabase.from('p2_agent_logs').insert({ tenant_id: tenantId, message: '', intent, extracted, match_status: null, success, error_reason: errorReason })
  } catch {
    // Logging must never throw — swallow all errors silently.
  }
}

async function processTenant(tenant: TenantRow, periodMonth: string, opts: { isManual: boolean }): Promise<{ status: 'skipped' | 'emailed' | 'failed'; error?: string }> {
  const companyName = tenant.company_name || 'Nexflow Export'

  // a. Eligibility — skip silently, no row, no log.
  if (!tenant.filing_package_enabled) return { status: 'skipped' }
  const recipients = resolveRecipients(tenant)
  if (!recipients.length) return { status: 'skipped' }

  try {
    // b. Upsert row. Cron skips a tenant already 'emailed' this month; manual
    // "Generate Now" always proceeds and overwrites the existing row.
    const { data: existing } = await supabase
      .from('p2_filing_packages').select('id, status').eq('tenant_id', tenant.tenant_id).eq('period_month', periodMonth).maybeSingle()
    if (existing?.status === 'emailed' && !opts.isManual) return { status: 'skipped' }

    const { data: upserted, error: upsertErr } = await supabase
      .from('p2_filing_packages')
      .upsert({ tenant_id: tenant.tenant_id, period_month: periodMonth, status: 'generating', error_reason: null }, { onConflict: 'tenant_id,period_month' })
      .select('id').single()
    if (upsertErr || !upserted) throw new Error(upsertErr?.message || 'Failed to create/update filing package row')
    const rowId = upserted.id

    // c. Period bounds.
    const { monthFrom, monthTo } = monthBounds(periodMonth)

    // d/e. Build the zip.
    const zip = new JSZip()
    const filesIncluded: string[] = []

    const gstr1 = await buildGstr1ReferenceWorkbook(tenant.tenant_id, periodMonth, monthFrom, monthTo, tenant.gstin || '')
    zip.file(`gstr1-reference-${periodMonth}.xlsx`, (await gstr1.workbook.xlsx.writeBuffer()) as ArrayBuffer)
    filesIncluded.push(`gstr1-reference-${periodMonth}.xlsx — GSTR-1 reference data for verification. Your accounting software (Tally/ClearTax/GSP) generates the actual filing from your books — use this sheet to cross-check totals before filing.`)

    const purchaseReg = await buildPurchaseRegisterWorkbook(tenant.tenant_id, monthFrom, monthTo, tenant.gstin || '')
    zip.file(`purchase-register-${periodMonth}.xlsx`, (await purchaseReg.workbook.xlsx.writeBuffer()) as ArrayBuffer)
    filesIncluded.push(`purchase-register-${periodMonth}.xlsx — GRN purchases this period, for your GSTR-3B ITC figure.`)

    let hasItc04 = false
    if (tenant.is_job_worker) {
      const principals = await fetchJobWorkPrincipals(tenant.tenant_id)
      for (const principal of principals) {
        const itc04 = await buildItc04Workbook(tenant.tenant_id, principal, tenant.gstin || '', companyName, monthFrom, monthTo)
        const principalSlug = principal.name.replace(/[^a-zA-Z0-9]+/g, '_')
        zip.file(`itc04-workingpaper-${principalSlug}-${periodMonth}.xlsx`, (await itc04.workbook.xlsx.writeBuffer()) as ArrayBuffer)
        filesIncluded.push(`itc04-workingpaper-${principalSlug}-${periodMonth}.xlsx — ITC-04 working paper for ${principal.name} (Tables 4/5A/5B/5C).`)
        hasItc04 = true
      }
    }

    const hsnAudit = await buildHsnAuditWorkbook(tenant.tenant_id)
    if (hsnAudit) {
      zip.file(`hsn-audit-${periodMonth}.xlsx`, (await hsnAudit.workbook.xlsx.writeBuffer()) as ArrayBuffer)
      filesIncluded.push(`hsn-audit-${periodMonth}.xlsx — last HSN Audit result (AI-assessed — verify with your CA).`)
    }

    const tally = await buildTallyXml(tenant.tenant_id, companyName, monthFrom, monthTo)
    zip.file(`tally-vouchers-${periodMonth}.xml`, tally.xml)
    filesIncluded.push(`tally-vouchers-${periodMonth}.xml — this period's sales and purchase vouchers as a Tally import file.`)

    const coveringNoteData = await fetchCoveringNoteData(tenant.tenant_id, monthFrom, monthTo, tenant.is_job_worker, tenant, periodMonth)
    const note = await callOpusCoveringNote(coveringNoteData, tenant.tenant_id)

    // Explicit snapshot BEFORE the covering-note file's own entry is added —
    // passed by value so later reordering of this block can never make the
    // HTML's own "what's in this package" section list itself.
    const filesForHtml = [...filesIncluded]
    const html = buildCoveringNoteHtml({
      companyName, gstin: tenant.gstin || '', periodLabelText: periodLabel(periodMonth),
      filesIncluded: filesForHtml, note,
    })
    zip.file('00-READ-THIS-FIRST.html', html)
    // unshift (not push) so it reads first in the EMAIL's file list, matching
    // the 00- prefix — happens only after the snapshot above was taken.
    filesIncluded.unshift('00-READ-THIS-FIRST.html — covering note and action items for this period, written by Nexflow AI.')

    const companySlug = slugify(companyName)
    const zipFilename = `nexflow-filing-${companySlug}-${todayIST()}.zip`
    const storagePath = `${tenant.tenant_id}/${periodMonth}/${zipFilename}`
    const zipBytes = await zip.generateAsync({ type: 'uint8array' })

    // f. Upload.
    const { error: uploadErr } = await supabase.storage.from('filing-packages').upload(storagePath, zipBytes, { contentType: 'application/zip', upsert: true })
    if (uploadErr) throw new Error(`Storage upload failed: ${uploadErr.message}`)
    await supabase.from('p2_filing_packages').update({ status: 'uploaded', storage_path: storagePath, updated_at: new Date().toISOString() }).eq('id', rowId)

    // g. Signed URL (7-day expiry).
    const { data: signedData, error: signedErr } = await supabase.storage.from('filing-packages').createSignedUrl(storagePath, 7 * 24 * 60 * 60)
    if (signedErr || !signedData) throw new Error(`Failed to create signed URL: ${signedErr?.message || 'unknown error'}`)
    const signedUrlExpiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()
    await supabase.from('p2_filing_packages').update({ signed_url: signedData.signedUrl, signed_url_expires_at: signedUrlExpiresAt, updated_at: new Date().toISOString() }).eq('id', rowId)

    // i. Email.
    const emailResult = await sendFilingEmail({
      toEmails: recipients, replyTo: tenant.email, companyName, periodLabel: periodLabel(periodMonth),
      signedUrl: signedData.signedUrl, filesIncluded, actionItems: note.actionItems,
    })
    if (!emailResult.ok) throw new Error(`Email failed: ${emailResult.error}`)
    await supabase.from('p2_filing_packages').update({ status: 'emailed', updated_at: new Date().toISOString() }).eq('id', rowId)

    // j. Notification + Telegram fan-out (fire-and-forget, same contract as
    // check-low-stock/index.ts and notify/index.ts).
    const { data: notifRow } = await supabase.from('p2_notifications').insert({
      tenant_id: tenant.tenant_id, type: 'filing_package_ready', title: 'Filing package ready',
      body: `Your filing package for ${periodLabel(periodMonth)} is ready — check your email.`, status: 'queued',
    }).select('id').single()
    if (notifRow) {
      fetch(`${SUPABASE_URL}/functions/v1/notify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${ANON_KEY}` },
        body: JSON.stringify({ notification_id: notifRow.id }),
      }).catch(() => {})
    }

    return { status: 'emailed' }
  } catch (err) {
    // k. Never throw — record the failure on the row and move on.
    const message = err instanceof Error ? err.message : String(err)
    try {
      await supabase.from('p2_filing_packages')
        .upsert({ tenant_id: tenant.tenant_id, period_month: periodMonth, status: 'failed', error_reason: message }, { onConflict: 'tenant_id,period_month' })
    } catch {
      // Best-effort only — the error path itself must never throw.
    }
    return { status: 'failed', error: message }
  }
}

// ─── Deno.serve ──────────────────────────────────────────────────────────────
const TENANT_SELECT = 'tenant_id, company_name, ca_email, accountant_email, filing_recipient, filing_package_enabled, is_job_worker, email, gstin'

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS_HEADERS })
  }
  if (req.method !== 'POST') {
    return respond({ status: 'error', error: 'Method not allowed' }, 405)
  }

  let body: Record<string, unknown> = {}
  try {
    body = await req.json()
  } catch {
    body = {}
  }

  // Cron path — never throws, always 200, tenants processed strictly
  // sequentially (never Promise.all — same conservative pattern as
  // check-low-stock).
  if (body.mode === 'monthly_cron') {
    const periodMonth = previousPeriodMonth()
    const { data: tenants, error: tenantsErr } = await supabase
      .from('p2_tenant_settings').select(TENANT_SELECT).eq('filing_package_enabled', true)

    if (tenantsErr) {
      return respond({ status: 'ok', message: `Failed to fetch tenants: ${tenantsErr.message}` }, 200)
    }

    const results: Array<{ tenant_id: string; status: string }> = []
    for (const tenant of (tenants || []) as TenantRow[]) {
      const result = await processTenant(tenant, periodMonth, { isManual: false })
      results.push({ tenant_id: tenant.tenant_id, status: result.status })
    }
    return respond({ status: 'ok', period_month: periodMonth, results }, 200)
  }

  // Manual path — settings.html "Generate Now" button, owner-only via the
  // page's own gate; server-side this only verifies the caller belongs to
  // the claimed tenant (same as every other body.action handler in
  // agent-query/index.ts).
  if (body.action === 'generate') {
    const tenantId = body.tenant_id as string | undefined
    const authCheck = await verifyCallerTenant(supabase, req, tenantId)
    if (!authCheck.ok) return authCheck.response

    const { data: tenant, error: tenantErr } = await supabase
      .from('p2_tenant_settings').select(TENANT_SELECT).eq('tenant_id', tenantId).maybeSingle()
    if (tenantErr || !tenant) {
      return respond({ status: 'error', error: 'Tenant settings not found' }, 404)
    }

    const periodMonth = (body.period_month as string | undefined) || previousPeriodMonth()
    const result = await processTenant(tenant as TenantRow, periodMonth, { isManual: true })

    if (result.status === 'skipped') {
      return respond({ status: 'error', error: 'Filing package is disabled, or no recipient email is configured for the selected recipient setting.' }, 400)
    }
    if (result.status === 'failed') {
      return respond({ status: 'error', error: result.error || 'Filing package generation failed' }, 500)
    }
    return respond({ status: 'ok', period_month: periodMonth, result: result.status }, 200)
  }

  return respond({ status: 'error', error: 'Unknown request — expected {mode:"monthly_cron"} or {action:"generate", tenant_id}' }, 400)
})
