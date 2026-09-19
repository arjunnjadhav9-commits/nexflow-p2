// Supabase Edge Function: agent-query
// Pure read-only supervisor — every intent Haiku can classify a message into
// answers a question from real DB rows via executeQuery(). Haiku extracts
// intent + raw text/number fields only; matchMaterialName()/findMatches()/
// findProductMatches()/matchClientName() resolve those raw fields against
// real rows in code — identity resolution is never trusted to the model.
// The five confirm_*/resend_invoice/preview_consolidated_invoice body.action
// handlers below Deno.serve are UI-triggered writes (invoices.html,
// all-dispatch-history.html, receive.html) — unrelated to the chat agent,
// kept as-is. suggest_hsn (export.html HSN Audit, E3) is a sixth body.action
// handler, also unrelated to chat — it's a read + Haiku classification, not
// a write, and deliberately does NOT consume the daily agent quota (see
// suggestHsn() below).

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import Anthropic from 'https://esm.sh/@anthropic-ai/sdk@0.32.0'
// Not yet called anywhere in this file — W2 (GRN write path) is the first
// caller. Imported now so the GRN duplicate-invoice check it will need
// shares the one canonical implementation instead of a fresh copy.
import { normaliseInvoiceNo } from '../_shared/compliance.ts'
import { opsAlert } from '../_shared/ops.ts'

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// SB_SECRET_KEY (not anon/publishable) — buildContext() must bypass RLS and
// filter by tenant_id manually, since this function serves every tenant.
const supabase = createClient(
  Deno.env.get('SUPABASE_URL') ?? '',
  Deno.env.get('SB_SECRET_KEY') ?? ''
)

const anthropic = new Anthropic({
  apiKey: Deno.env.get('ANTHROPIC_API_KEY') ?? '',
})

// Emails a challan/invoice via Resend — used by sendInvoiceEmail (invoice
// flow) and the five kept UI-write handlers below.
const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY')

interface AgentQueryRequest {
  tenant_id: string
  message: string
}

// Dispatch-page "Generate Invoice" modal — always single-mode, one dispatch.
// Only `rate` is client-supplied per item; qty/unit/description are always
// re-fetched server-side from p2_dispatch_items (never trust client-sent
// quantities for a billing amount).
interface ConfirmGenerateInvoiceRequest {
  action: 'confirm_generate_invoice'
  tenant_id: string
  dispatch_order_id: string
  item_rates: Array<{ dispatch_item_id: string; rate: number }>
  gst_type: string
}

// invoices.html "Resend" button — re-sends an existing invoice's email,
// never creates a new row (no invoice_sequence bump).
interface ResendInvoiceRequest {
  action: 'resend_invoice'
  tenant_id: string
  invoice_id: string
}

// invoices.html "+ New Consolidated Invoice" modal — merges every confirmed
// dispatch for one client within [date_from, date_to] into one invoice.
// Rates default to p2_material_prices/p2_product_prices via
// buildInvoiceItemsForOrder, but item_rates lets the invoices.html preview step (Preview Line
// Items -> edit price -> Confirm) override them per dispatch_item_id, same
// "trust rate, verify everything else" posture as ConfirmGenerateInvoiceRequest.
interface ConfirmConsolidatedInvoiceRequest {
  action: 'confirm_consolidated_invoice'
  tenant_id: string
  client_id: string
  client_name: string
  date_from: string
  date_to: string
  gst_type: string
  dispatch_type?: 'product' | 'raw_material' | 'both'
  // When present and non-empty, this is the AUTHORITATIVE inclusion list, not just a
  // rate override — only dispatch_item_ids present here are billed; every matching
  // dispatch in [date_from, date_to] is no longer swept in unconditionally. Lets
  // invoices.html's preview step both edit rates AND exclude specific removed rows,
  // and lets it split one date range into several invoices (each call sends only its
  // batch's item ids). Omitted/empty falls back to the pre-existing include-everything
  // behavior (no real caller does this today, but kept for safety).
  item_rates?: Array<{ dispatch_item_id: string; rate: number }>
  // Disambiguates multiple consolidated invoices for the same
  // (tenant_id, client_id, date_from, date_to) — see p2_invoices_consolidated_dedup_idx.
  // 0 (default) = normal single/unsplit invoice, byte-identical to pre-split behavior.
  // 1..N = split batch sequence number when invoices.html divides a large sweep into
  // multiple invoices (Max Lines Per Invoice setting). Never surfaced in any UI.
  consolidated_batch_seq?: number
}

// invoices.html "+ New Consolidated Invoice" modal, Step 1 -> Step 2 —
// returns the same computed line items confirm_consolidated_invoice would
// use, without creating anything, so the owner can review/edit prices first.
interface PreviewConsolidatedInvoiceRequest {
  action: 'preview_consolidated_invoice'
  tenant_id: string
  client_id: string
  date_from: string
  date_to: string
  gst_type: string
  dispatch_type?: 'product' | 'raw_material' | 'both'
}

// export.html HSN Audit — checks whether an EXISTING hsn_sac looks correct
// for the material/product it's on (contrast with §3.3's original "suggest a
// code for a blank field" design, which this is not). hsn_sac is always
// non-null here — the caller pre-filters blank codes into an immediate
// 'no_code' verdict client-side and never sends them here.
interface SuggestHsnItem {
  id: string
  name: string
  unit: string
  kind: 'raw_material' | 'product'
  hsn_sac: string
}
interface SuggestHsnRequest {
  action: 'suggest_hsn'
  tenant_id: string
  items: SuggestHsnItem[]
}
interface HsnAuditVerdict {
  id: string
  verdict: 'correct' | 'likely_wrong' | 'definitely_wrong'
  reason: string
  suggested_hsn: string | null
}

// A4 Phase 1 — support relay entry points. Both are pure plumbing: create or
// continue a p2_support_threads row and page the founder via opsAlert()
// (_shared/ops.ts) — no knowledge base, no model call, no cost. Neither
// consumes the daily agent quota, same reasoning as suggest_hsn: this isn't
// the chat copilot's quota, and plan='lite' maps to a limit of 0, which
// would lock out exactly the clients most likely to need support.
interface SubmitSupportMessageRequest {
  action: 'submit_support_message'
  tenant_id: string
  thread_id?: string | null
  message: string
  lang: 'en' | 'mr'
}

// js/agent-chat.js's "Report a bug" mode. page/browser are auto-filled
// client-side (location.pathname / navigator.userAgent); role and plan are
// never trusted from the client — resolved server-side below, same as every
// other handler in this file.
interface SubmitBugReportRequest {
  action: 'submit_bug_report'
  tenant_id: string
  page: string
  action_taken: string
  expected: string
  actual: string
  browser?: string
}

// Frozen line-item snapshot stored in p2_invoices.items — challan_number/
// dispatch_date are always present (even in single mode) so single and
// consolidated invoices share one shape; invoice-view and invoice-pdf.js
// just don't render those two columns outside consolidated mode.
interface InvoiceItem {
  challan_number: string | null
  dispatch_date: string | null
  description: string
  qty: number
  unit: string
  rate: number
  amount: number
  hsn_sac: string
}

interface RawMaterial {
  id: string
  name: string
  unit: string
  min_stock_level: number
  material_code: string | null
}

interface StockBalance {
  raw_material_id: string
  name: string
  unit: string
  min_stock_level: number
  current_stock: number
  material_code: string | null
}

interface Product {
  id: string
  product_code: string
  name: string
  unit: string
}

interface Supplier {
  id: string
  name: string
}

interface AgentContext {
  materials: RawMaterial[]
  stockBalances: StockBalance[]
  products: Product[]
  suppliers: Supplier[]
}

interface ContextError {
  error: string
}

interface UsageAllowed {
  allowed: true
  remaining: number
}

interface UsageDenied {
  allowed: false
  error: string
}

type UsageResult = UsageAllowed | UsageDenied

type HaikuIntent =
  | 'check_stock'
  | 'recent_grn'
  | 'consumption_summary'
  | 'supplier_history'
  | 'low_stock_list'
  | 'grn_detail'
  | 'pending_dispatches'
  | 'grn_summary'
  | 'top_consumption'
  | 'material_list'
  | 'stock_check_product'
  | 'zero_stock_list'
  | 'dispatch_summary'
  | 'supplier_delivery_check'
  | 'challan_detail'
  | 'issue_summary'
  | 'product_code_lookup'
  | 'top_received'
  | 'product_list'
  | 'supplier_list'
  | 'dispatch_detail'
  | 'issue_detail'
  | 'bom_detail'
  | 'top_supplier'
  | 'invoice_total'
  | 'invoice_detail'
  | 'grn_completeness'
  | 'gstr2b_status'
  | 'unknown'

interface HaikuResult {
  intent: HaikuIntent
  extracted: {
    material_name?: string // shared: check_stock, recent_grn, consumption_summary
    supplier_name?: string // shared: supplier_history, supplier_delivery_check
    days?: number // recent_grn, consumption_summary, top_received, top_supplier — default varies by intent
    grn_no?: string // grn_detail only
    challan_number?: string // challan_detail, dispatch_detail, issue_detail
    product_name?: string // stock_check_product, product_code_lookup, bom_detail
    quantity?: number // stock_check_product — how many units to produce
    top_n?: number // top_consumption, top_received, top_supplier — how many to show, default 10
    date_from?: string // invoice_total, grn_completeness — YYYY-MM-DD, absent means all-time (grn_completeness: absent means current calendar month)
    date_to?: string // invoice_total, grn_completeness — YYYY-MM-DD
    client_name?: string // invoice_total
    invoice_number?: string // invoice_detail only
  }
  error?: string
}

// Wraps a Response with consistent CORS headers and JSON body.
function respond(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...CORS_HEADERS,
      'Content-Type': 'application/json',
    },
  })
}

// Every handler below trusts a client-supplied tenant_id to scope reads/writes
// issued through the service-role client (bypasses RLS). Verify it against the
// caller's real identity before any handler runs — same auth.getUser(token)
// pattern confirmReceiveGrn already uses for recipient_tenant_id. tenant_id is
// the caller's own auth uid for an owner, but for an invited staff member it's
// stamped into user_metadata.tenant_id instead (see invite-staff/index.ts) —
// resolve the same way js/supabase-client.js's checkAuth() does.
async function verifyCallerTenant(
  supabaseClient: ReturnType<typeof createClient>,
  req: Request,
  claimedTenantId: string | undefined
): Promise<{ ok: true; userId: string } | { ok: false; response: Response }> {
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

  return { ok: true, userId: user.id }
}

// Fetches all tenant-scoped data the model needs to answer stock/product
// questions. Every query is tenant_id-filtered by hand since this client
// uses the secret key and bypasses RLS.
async function buildContext(
  supabaseClient: ReturnType<typeof createClient>,
  tenantId: string
): Promise<AgentContext | ContextError> {
  const { data: materials, error: materialsError } = await supabaseClient
    .from('p2_raw_materials')
    .select('id, name, unit, min_stock_level, material_code')
    .eq('tenant_id', tenantId)
    .eq('is_active', true)

  if (materialsError) {
    return { error: `Failed to load raw materials: ${materialsError.message}` }
  }

  const { data: stockBalances, error: stockError } = await supabaseClient
    .from('v_p2_stock_balance')
    .select('raw_material_id, name, unit, min_stock_level, current_stock, material_code')
    .eq('tenant_id', tenantId)

  if (stockError) {
    return { error: `Failed to load stock balances: ${stockError.message}` }
  }

  const { data: products, error: productsError } = await supabaseClient
    .from('p2_products')
    .select('id, product_code, name, unit')
    .eq('tenant_id', tenantId)

  if (productsError) {
    return { error: `Failed to load products: ${productsError.message}` }
  }

  // is_active filter required — CSV-imported suppliers default to
  // is_active=false and must stay invisible to matching/dropdowns.
  const { data: suppliers, error: suppliersError } = await supabaseClient
    .from('p2_suppliers')
    .select('id, name')
    .eq('tenant_id', tenantId)
    .eq('is_active', true)

  if (suppliersError) {
    return { error: `Failed to load suppliers: ${suppliersError.message}` }
  }

  return {
    materials: (materials ?? []) as RawMaterial[],
    stockBalances: (stockBalances ?? []) as StockBalance[],
    products: (products ?? []) as Product[],
    suppliers: (suppliers ?? []) as Supplier[],
  }
}

// Atomically checks and increments the tenant's daily agent interaction
// counter via RPC (row-locked, lazy daily reset server-side). Must run
// before buildContext() so an over-quota request never pays for that query.
async function checkAndIncrementUsage(
  supabaseClient: ReturnType<typeof createClient>,
  tenantId: string
): Promise<UsageResult> {
  const { data, error } = await supabaseClient.rpc('check_and_increment_agent_usage', {
    p_tenant_id: tenantId,
  })

  if (error) {
    return { allowed: false, error: `Failed to check agent usage: ${error.message}` }
  }

  return data as UsageResult
}

// Extraction-only call to Claude Haiku. Haiku classifies intent and pulls
// raw text/number fields exactly as the user wrote them — it must NEVER
// match a name to a real p2_raw_materials/p2_suppliers/p2_products row
// (that's matchMaterialName()/findMatches()/findProductMatches(), code-side,
// inside executeQuery()) and NEVER author the answer text shown to the user
// (that's built server-side from real DB rows).
async function callHaiku(
  anthropicClient: Anthropic,
  context: AgentContext,
  message: string
): Promise<HaikuResult> {
  // Condensed context: names only. Haiku doesn't need IDs or stock numbers —
  // those are for executeQuery()'s match helpers to resolve later.
  const materialNames = context.materials.map((m) => m.name)
  const productNames = context.products.map((p) => p.name)
  const todayIST_ = todayIST()

  const systemPrompt = `You classify a factory owner's message into one of the following intents. You do not match names to a database — extract text exactly as the user wrote it.

Today's date (IST): ${todayIST_}

Known raw materials (for context only, do not require an exact match):
${JSON.stringify(materialNames)}

Known products (for context only, do not require an exact match):
${JSON.stringify(productNames)}

Classify the message as one of:
- "check_stock" — the user is asking about stock/inventory level of a raw material.
  extracted fields: { "material_name": string }  // exactly as the user said it
- "recent_grn" — user asks about recent GRN receipts for a material.
  extracted fields: { "material_name": string, "days"?: number }
  Default days to 7 if no timeframe mentioned.
  Examples:
  - "Last week Hex Bolt cha GRN aala ka?" -> { "material_name": "Hex Bolt", "days": 7 }
  - "MS Sheet cha last 30 days madhe kitna aala?" -> { "material_name": "MS Sheet", "days": 30 }
- "consumption_summary" — user asks how much of a material was consumed.
  extracted fields: { "material_name": string, "days"?: number }
  Default days to 30 if no timeframe mentioned.
  Examples:
  - "This month copper kitna consume zala?" -> { "material_name": "copper", "days": 30 }
  - "Last week Bearing kitna gela?" -> { "material_name": "Bearing", "days": 7 }
- "supplier_history" — user asks about deliveries from a specific supplier.
  extracted fields: { "supplier_name": string }
  Examples:
  - "Tata Steel kadun last delivery keva aali?" -> { "supplier_name": "Tata Steel" }
  - "Sharma Traders ne last keva pathavla?" -> { "supplier_name": "Sharma Traders" }
- "low_stock_list" — user asks which materials are running low or below minimum.
  extracted fields: {}
  Examples:
  - "Kadhle materials low aahit?" -> {}
  - "Konti materials minimum khali aahit?" -> {}
  - "Stock alert kadhle aahit?" -> {}
- "grn_detail" — user asks about a specific GRN by its number.
  extracted fields: { "grn_no": string }
  Examples:
  - "GRN-202607-054 madhe kay hota?" -> { "grn_no": "GRN-202607-054" }
  - "GRN-202607-001 details" -> { "grn_no": "GRN-202607-001" }
- "pending_dispatches" — user asks about dispatches that are pending or not yet confirmed.
  extracted fields: {}
  Examples:
  - "Kadhle dispatch pending aahit?" -> {}
  - "Konti challans abhi pending aahit?" -> {}
- "grn_summary" — user asks about total GRNs received across ALL materials for a time period. No specific material mentioned.
  extracted fields: { "days"?: number }
  Default days to 0 if "aaj"/"today" mentioned, 1 if "kal"/"yesterday" mentioned, 7 if "this week"/"last week", 30 if "this month".
  Examples:
  - "Aaj kitne GRNs aale?" -> { "days": 0 }
  - "Kalche GRNs kitne aale?" -> { "days": 1 }
  - "This week total kitna stock aala?" -> { "days": 7 }
  - "Is month kitne GRNs aale?" -> { "days": 30 }
  IMPORTANT: Only use this intent when NO specific material is mentioned. If a material is mentioned, use "recent_grn" instead.
- "top_consumption" — user asks which materials were consumed the most, or ranking of consumption. No specific material.
  extracted fields: { "days"?: number, "top_n"?: number }
  Default days to 30, top_n to 10. Use 0 for "aaj"/"today", 1 for "kal"/"yesterday".
  Examples:
  - "Kaal sarvat jast konta material consume zala?" -> { "days": 1, "top_n": 10 }
  - "This week konti materials jast geli top 3?" -> { "days": 7, "top_n": 3 }
  - "Last month sarvat jast consume zaleye konti?" -> { "days": 30, "top_n": 10 }
  - "Kal kiti materials vaparle?" -> { "days": 1, "top_n": 10 }
  - "Aaj kitna material gela?" -> { "days": 0, "top_n": 10 }
  IMPORTANT: If the user asks about total/all materials consumed with NO specific material name, always use "top_consumption", never "consumption_summary". "consumption_summary" is ONLY for one specific named material.
- "material_list" — user asks for a list of all materials or wants to see what materials exist.
  extracted fields: {}
  Examples:
  - "Kadhle materials aahit?" -> {}
  - "Samplelya material chi list" -> {}
  - "samplelya material chi list" -> {}
  - "Konti raw materials aahit?" -> {}
  - "All materials dikhao" -> {}
  - "Materials dikhao" -> {}
- "stock_check_product" — user asks if there is enough stock to produce a specific product and quantity.
  extracted fields: { "product_name": string, "quantity"?: number }
  Default quantity to 1 if not mentioned.
  Examples:
  - "KS4 motor 5 banvayala enough stock aahe ka?" -> { "product_name": "KS4 motor", "quantity": 5 }
  - "10 pumps banvu shakto ka?" -> { "product_name": "pumps", "quantity": 10 }
  - "Motor assembly cha stock check karo" -> { "product_name": "Motor assembly", "quantity": 1 }
- "zero_stock_list" — user asks which materials are completely out of stock (zero or negative).
  extracted fields: {}
  Examples:
  - "Konti materials out of stock aahit?" -> {}
  - "Konta material zero aahe?" -> {}
  - "Stock nahi konala?" -> {}
- "dispatch_summary" — user asks about dispatches that were confirmed/sent, not pending ones.
  extracted fields: { "days"?: number }
  Default days to 0 if "aaj"/"today" mentioned, 1 if "kal"/"yesterday" mentioned.
  Examples:
  - "Aaj konti dispatch confirm zali?" -> { "days": 0 }
  - "This week kitni dispatch geli?" -> { "days": 7 }
  - "Kal konti challan geli?" -> { "days": 1 }
- "challan_detail" — user asks about a specific challan by its number (when created, dispatched, client, status).
  extracted fields: { "challan_number": string }
  Examples:
  - "challan 4309 kevha zaala?" -> { "challan_number": "4309" }
  - "Challan 4302 status kay aahe?" -> { "challan_number": "4302" }
  - "4309 challan keva confirm zala?" -> { "challan_number": "4309" }
  - "DC 4309 details" -> { "challan_number": "4309" }
- "issue_summary" — user asks how many production issues were done for a time period.
  extracted fields: { "days"?: number }
  Default days to 0 if "aaj"/"today" mentioned, 1 if "kal"/"yesterday" mentioned.
  Examples:
  - "Kal issue kiti kele?" -> { "days": 1 }
  - "Aaj kitne issues kele?" -> { "days": 0 }
  - "This week kitne production issues kele?" -> { "days": 7 }
  - "Yesterday kitna issue zaala?" -> { "days": 1 }
- "product_code_lookup" — user asks for the product code of a specific product.
  extracted fields: { "product_name": string }
  Examples:
  - "MOTOR ASSEMBLY KS6 3PH 4HP CL135 cha code kay aahe?" -> { "product_name": "MOTOR ASSEMBLY KS6 3PH 4HP CL135" }
  - "KS4 motor cha product code?" -> { "product_name": "KS4 motor" }
  - "Pump assembly code dikhao" -> { "product_name": "Pump assembly" }
- "supplier_delivery_check" — user asks if a specific supplier delivered today or recently.
  extracted fields: { "supplier_name": string, "days"?: number }
  Default days to 0 if "aaj"/"today" mentioned, 1 if "kal"/"yesterday" mentioned.
  Examples:
  - "Tata Steel kadun aaj aala ka?" -> { "supplier_name": "Tata Steel", "days": 0 }
  - "Sharma Traders ne this week pathavla ka?" -> { "supplier_name": "Sharma Traders", "days": 7 }
- "top_received" — user asks which materials were received the most by quantity, or ranking of GRN receipts. No specific material.
  extracted fields: { "days"?: number, "top_n"?: number }
  Default days to 30, top_n to 10.
  Examples:
  - "Kal sarvat jast konty material che GRN aale?" -> { "days": 1, "top_n": 10 }
  - "This week konti materials jast aali?" -> { "days": 7, "top_n": 10 }
  - "This month top 3 received materials?" -> { "days": 30, "top_n": 3 }
  - "Aaj sarvat jast GRN konty material che aale?" -> { "days": 0, "top_n": 10 }
  IMPORTANT: Use this when user asks about received/arrived materials ranked by quantity. Use "top_consumption" only for consumed materials.
- "product_list" — user asks for a list of all products.
  extracted fields: {}
  Examples:
  - "Konti products aahit?" -> {}
  - "Amchi product list dikhao" -> {}
  - "Kadhle products banvto amhi?" -> {}
  - "All products show karo" -> {}
- "supplier_list" — user asks for a list of all suppliers.
  extracted fields: {}
  Examples:
  - "Konti suppliers aahit?" -> {}
  - "Amche suppliers kadhle aahit?" -> {}
  - "Supplier list dikhao" -> {}
  - "All suppliers show karo" -> {}
- "gstr2b_status" — user asks about GSTR-2B reconciliation status or ITC matching.
  extracted fields: {}
  Examples:
  - "GSTR-2B madhe kiti match zale?" -> {}
  - "Last reconciliation status?" -> {}
  - "ITC block zala ka?" -> {}
- "dispatch_detail" — user asks what was inside a specific dispatch challan (line items, not just header).
  extracted fields: { "challan_number": string }
  Examples:
  - "Challan 4309 madhe kay hota?" -> { "challan_number": "4309" }
  - "DC 4302 madhe konti materials hoti?" -> { "challan_number": "4302" }
  - "4309 challan cha details" -> { "challan_number": "4309" }
  IMPORTANT: Use "challan_detail" when user asks WHEN/STATUS of a challan. Use "dispatch_detail" when user asks WHAT WAS IN a challan.
- "issue_detail" — user asks what materials were issued in a specific production issue challan.
  extracted fields: { "challan_number": string }
  Examples:
  - "Issue challan 4310 madhe konti materials geli?" -> { "challan_number": "4310" }
  - "Production issue 4310 madhe kay hota?" -> { "challan_number": "4310" }
- "invoice_total" — user asks for the total amount billed/invoiced to a specific client, optionally for a period. This is a READ — it only reports a number.
  extracted fields: { "client_name": string, "date_from"?: string (YYYY-MM-DD), "date_to"?: string (YYYY-MM-DD) }
  Rules:
  - "client_name" is required — extract exactly as the user said it.
  - "date_from"/"date_to" — only if the user names a period. Bare month names ("July"), "this month", "last month" resolve to a full calendar range using "Today's date" above. Omit both for an all-time total.
  Examples (assuming Today's date above is 2026-08-01):
  - "KPML cha is month total bill kitna?" -> { "client_name": "KPML", "date_from": "2026-08-01", "date_to": "2026-08-31" }
  - "This month KPML la kitna billed kela?" -> { "client_name": "KPML", "date_from": "2026-08-01", "date_to": "2026-08-31" }
  - "Srushti Chavan cha July total invoice amount?" -> { "client_name": "Srushti Chavan", "date_from": "2026-07-01", "date_to": "2026-07-31" }
  - "KPML cha total billing kitna aajparyant?" -> { "client_name": "KPML" }
- "invoice_detail" — user asks what's inside a specific invoice, by invoice number.
  extracted fields: { "invoice_number": string }
  Rules:
  - Extract exactly as said — full ("INV-202607-003") or partial ("003") are both valid; exact-match-then-fuzzy-match happens server-side, same as challan_detail.
  Examples:
  - "INV-202607-003 madhe kay hota?" -> { "invoice_number": "INV-202607-003" }
  - "Invoice 003 cha amount kitna?" -> { "invoice_number": "003" }
  - "INV-202607-003 detail dakav" -> { "invoice_number": "INV-202607-003" }
- "bom_detail" — user asks what the bill of materials is for a specific product.
  extracted fields: { "product_name": string }
  Examples:
  - "KS4 motor cha BOM kay aahe?" -> { "product_name": "KS4 motor" }
  - "KS6-1.5HP banvayala konti materials lagtat?" -> { "product_name": "KS6-1.5HP" }
  - "PANEL-STD cha bill of materials dikhao" -> { "product_name": "PANEL-STD" }
- "top_supplier" — user asks which supplier delivered the most this month/week/period.
  extracted fields: { "days"?: number, "top_n"?: number }
  Default days to 30, top_n to 10.
  Examples:
  - "Sarvat jast konty supplier ne pathavle this month?" -> { "days": 30, "top_n": 10 }
  - "This week konty supplier ne jast delivery keli?" -> { "days": 7, "top_n": 10 }
  - "Konty supplier ne sarvat jast maal dila?" -> { "days": 30, "top_n": 10 }
  - "Top 3 suppliers this month?" -> { "days": 30, "top_n": 3 }
- "grn_completeness" — user asks whether this month's (or another period's) GRNs have all their supplier invoice numbers filled in / are complete for CA export. This is a READ — it only reports counts.
  extracted fields: { "date_from"?: string (YYYY-MM-DD), "date_to"?: string (YYYY-MM-DD) }
  Rules:
  - Bare month names ("July"), "this month", "last month" resolve to a full calendar range using "Today's date" above (same rule as invoice_total, above).
  - If the user names no period at all, omit both fields — the system defaults to the current calendar month.
  Examples (assuming Today's date above is 2026-08-07):
  - "This month cha GRN complete aahe ka?" -> {}
  - "GRN complete aahe ka?" -> {}
  - "July cha GRN complete aahe ka?" -> { "date_from": "2026-07-01", "date_to": "2026-07-31" }
  - "Last month cha GRN sagle invoice number aahet ka?" -> { "date_from": "2026-06-01", "date_to": "2026-06-30" }
- "unknown" — neither intent fits.
  extracted fields: {}

Respond with ONLY valid JSON, no markdown code fences, no preamble, no explanation. The response must match exactly this shape:
{ "intent": "check_stock" | "recent_grn" | "consumption_summary" | "supplier_history" | "low_stock_list" | "grn_detail" | "pending_dispatches" | "grn_summary" | "top_consumption" | "material_list" | "stock_check_product" | "zero_stock_list" | "dispatch_summary" | "supplier_delivery_check" | "challan_detail" | "issue_summary" | "product_code_lookup" | "top_received" | "product_list" | "supplier_list" | "dispatch_detail" | "issue_detail" | "bom_detail" | "top_supplier" | "invoice_total" | "invoice_detail" | "grn_completeness" | "gstr2b_status" | "unknown", "extracted": { ...fields... } }`

  try {
    const response = await anthropicClient.messages.create({
      model: 'claude-haiku-4-5',
      max_tokens: 500,
      system: systemPrompt,
      messages: [{ role: 'user', content: message }],
    })

    const textBlock = response.content.find(
      (block: { type: string; text?: string }) => block.type === 'text'
    )
    const rawText = textBlock && textBlock.type === 'text' ? textBlock.text : ''

    // Haiku sometimes wraps JSON in ```json ... ``` fences despite instructions not to.
    let cleanedText = rawText.trim()
    if (cleanedText.startsWith('```')) {
      cleanedText = cleanedText
        .replace(/^```(?:json)?\s*/, '')
        .replace(/```\s*$/, '')
        .trim()
    }

    try {
      const parsed = JSON.parse(cleanedText)
      return {
        intent: parsed.intent ?? 'unknown',
        extracted: parsed.extracted ?? {},
      }
    } catch {
      return { intent: 'unknown', extracted: {}, error: 'Failed to parse model response' }
    }
  } catch (error) {
    return {
      intent: 'unknown',
      extracted: {},
      error: error instanceof Error ? error.message : 'Failed to parse model response',
    }
  }
}

// Tier 4 Phase 2 — public receive.html "Auto-fill GRN" button. Unlike every
// other confirm_* action, recipient_tenant_id comes from a public page and
// must be verified against the caller's real JWT (see confirmReceiveGrn),
// not just trusted like the rest of this file trusts tenant_id.
interface ConfirmReceiveGrnRequest {
  action: 'confirm_receive_grn'
  dispatch_token: string
  recipient_tenant_id: string
  invoice_no?: string | null
  item_rates?: (number | null)[]
}

// Tax invoice line items should never print internal unit labels like
// 'Stator'/'Stack' — those map to NOS for invoicing purposes only. Product
// master, dispatch items, and challan display all stay untouched.
function normaliseInvoiceUnit(unit: string): string {
  const u = (unit || '').toLowerCase().trim()
  if (u === 'stator' || u === 'stack') return 'NOS'
  return unit
}

// Case-insensitive substring match in either direction (extracted text is
// often a partial/loose version of the real name, or vice versa).
function findMatches<T extends { name: string }>(query: string, candidates: T[]): T[] {
  const normalizedQuery = query.toLowerCase().trim()
  if (!normalizedQuery) {
    return []
  }
  return candidates.filter((candidate) => {
    const normalizedName = candidate.name.toLowerCase()
    return normalizedName.includes(normalizedQuery) || normalizedQuery.includes(normalizedName)
  })
}

// Product lookups also need to match against product_code, not just name.
function findProductMatches(query: string, products: Product[]): Product[] {
  const q = query.toLowerCase().trim()
  if (!q) return []
  return products.filter((p) => {
    const name = p.name.toLowerCase()
    const code = (p.product_code ?? '').toLowerCase()
    return name.includes(q) || q.includes(name) || code.includes(q) || q.includes(code)
  })
}

// Returns " [CODE]" suffix if material_code exists, empty string otherwise.
function codeTag(code: string | null | undefined): string {
  return code ? ` [${code}]` : ''
}

// Resolves a single extracted material name against context.materials.
// Shared by check_stock, recent_grn, consumption_summary, and confirmReceiveGrn.
function matchMaterialName(
  materialName: string,
  materials: RawMaterial[]
): { material: RawMaterial } | { error: string } {
  // Match on name first, then fall back to material_code
  let materialMatches = findMatches(materialName, materials)
  if (materialMatches.length === 0) {
    const q = materialName.toLowerCase().trim()
    materialMatches = materials.filter(m => {
      const code = (m.material_code ?? '').toLowerCase()
      return code === q || code.includes(q) || q.includes(code)
    })
  }

  if (materialMatches.length === 0) {
    return { error: `Couldn't find a material matching "${materialName}".` }
  }

  if (materialMatches.length > 1) {
    const candidateNames = materialMatches.map((m) => m.name).join(', ')
    return {
      error: `"${materialName}" is ambiguous — did you mean ${candidateNames}?`,
    }
  }

  return { material: materialMatches[0] }
}

// Resolves a free-text supplier name against a supplier list — a missing or
// ambiguous match returns null (never blocks the caller). Used by
// confirmReceiveGrn to best-effort match the sending tenant's company name
// against the recipient's own supplier list.
function matchSupplierName(supplierName: string | undefined, suppliers: Supplier[]): Supplier | null {
  if (!supplierName || !supplierName.trim()) {
    return null
  }
  const supplierMatches = findMatches(supplierName, suppliers)
  if (supplierMatches.length === 1) {
    return { id: supplierMatches[0].id, name: supplierMatches[0].name }
  }
  return null
}

interface SendInvoiceResult {
  text: string
  success: boolean
  errorReason: string | null
}

// Client row shape for invoice flows — needs gstin/address on top of the
// plain id/name/email used elsewhere.
interface InvoiceClientRow {
  id: string
  name: string
  address: string | null
  gstin: string | null
  email: string | null
}

// Resolves a free-text client name against a client list. Unlike
// matchSupplierName, this is a required/blocking match (mirrors
// matchMaterialName's 3-way result shape) — a missing or ambiguous client
// must stop the caller, not silently fall through. Used by invoice_total
// (executeQuery) and the invoice UI-write handlers below.
function matchClientName<T extends { name: string }>(
  clientName: string,
  clients: T[]
): { client: T } | { error: string; errorKind: 'no_match' | 'ambiguous' } {
  const matches = findMatches(clientName, clients)

  if (matches.length === 0) {
    return { error: 'Client sapadla nahi — Settings > Clients madhe check kara', errorKind: 'no_match' }
  }

  if (matches.length > 1) {
    return { error: 'Konti client la pathavayche? More specific sanga', errorKind: 'ambiguous' }
  }

  return { client: matches[0] }
}

// Returns [startISO, endISO] for a calendar-day range in IST (UTC+5:30).
// days=1 → yesterday 00:00 IST to today 00:00 IST (closed range)
// days>1 → N calendar days ago 00:00 IST to now (open-ended, includes today so far)
function getISTDateRange(days: number): { since: string; until?: string } {
  const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000

  const nowUTC = Date.now()
  const nowIST = nowUTC + IST_OFFSET_MS
  const todayMidnightIST = nowIST - (nowIST % 86400000)
  const todayMidnightUTC = todayMidnightIST - IST_OFFSET_MS

  if (days === 1) {
    const yesterdayMidnightUTC = todayMidnightUTC - 86400000
    return {
      since: new Date(yesterdayMidnightUTC).toISOString(),
      until: new Date(todayMidnightUTC).toISOString(),
    }
  }

  return {
    since: new Date(todayMidnightUTC - days * 86400000).toISOString(),
  }
}

// Correct IST "today" as YYYY-MM-DD. getISTDateRange(0).since is the UTC
// instant marking today's IST midnight (e.g. 2 Sep IST -> "2026-09-01T18:30:00Z")
// — its own ISO date portion is YESTERDAY's UTC calendar date, not today's
// IST one. Shifting "now" itself by the IST offset before reading the date
// portion avoids that trap.
function todayIST(): string {
  const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000
  return new Date(Date.now() + IST_OFFSET_MS).toISOString().split('T')[0]
}

// 'YYYY-MM-DD' -> 'DD/MM/YYYY', for the overlap error message only (Item 12).
// Server-side only — invoices.html has its own independent copy for client-side
// rendering, since this Edge Function and the browser share no code.
function fmtDdMmYyyy(iso: string): string {
  const [y, m, d] = iso.split('-')
  return `${d}/${m}/${y}`
}

// Item 12 (Known Open Item #6) — two consolidated invoices for the same client with
// overlapping-but-not-identical date ranges must not both sweep the same dispatches.
// Excludes cancelled invoices (a cancelled invoice doesn't hold its dates — same
// .neq('status', 'cancelled') filter as invoices.html's fetchInvoicedOrderIdSet()) and
// excludes exact-same-range rows: an exact (date_from, date_to) repeat is a sibling batch
// of the SAME sweep (invoices.html's Max Lines Per Invoice split calls confirm multiple
// times with the identical range, disambiguated only by consolidated_batch_seq — see
// migration 20260912_consolidated_invoice_batch_seq.sql) or a legitimate retry — both
// already governed by p2_invoices_consolidated_dedup_idx / the exact-duplicate checks in
// previewConsolidatedInvoice/confirmConsolidatedInvoice, not this check. The
// .or('date_from.neq.X,date_to.neq.Y') is the same De Morgan date-exclusion pattern
// invoices.html already uses for carryover challans (dispatch_date outside a range).
async function findOverlappingConsolidatedInvoice(
  supabaseClient: ReturnType<typeof createClient>,
  tenantId: string,
  clientId: string,
  dateFrom: string,
  dateTo: string
): Promise<{ invoice_number: string; date_from: string; date_to: string } | null> {
  const { data, error } = await supabaseClient
    .from('p2_invoices')
    .select('invoice_number, date_from, date_to')
    .eq('tenant_id', tenantId)
    .eq('client_id', clientId)
    .eq('invoice_mode', 'consolidated')
    .neq('status', 'cancelled')
    .lte('date_from', dateTo)
    .gte('date_to', dateFrom)
    .or(`date_from.neq.${dateFrom},date_to.neq.${dateTo}`)
    .limit(1)
    .maybeSingle()

  if (error) throw error
  return data as { invoice_number: string; date_from: string; date_to: string } | null
}

// Handles every intent — all read-only. Each returns a plain-text answer
// built from real DB rows; nothing here ever writes.
async function executeQuery(
  supabaseClient: ReturnType<typeof createClient>,
  tenantId: string,
  haikuResult: HaikuResult,
  context: AgentContext
): Promise<string> {
  const { intent, extracted } = haikuResult

  if (intent === 'check_stock') {
    const materialName = extracted.material_name ?? ''
    if (!materialName.trim()) return 'Please provide a material name.'

    const matchResult = matchMaterialName(materialName, context.materials)
    if ('error' in matchResult) return matchResult.error
    const material = matchResult.material

    const balance = context.stockBalances.find((b) => b.raw_material_id === material.id)
    const stock = balance?.current_stock ?? 0

    return `${material.name}${codeTag(material.material_code)}: ${stock} ${material.unit} in hand.`
  }

  if (intent === 'recent_grn') {
    const materialName = extracted.material_name ?? ''
    const days = extracted.days ?? 7

    const matchResult = matchMaterialName(materialName, context.materials)
    if ('error' in matchResult) return matchResult.error
    const material = matchResult.material

    const { since: sinceISO, until: untilISO } = getISTDateRange(days)
    const sinceStr = sinceISO.split('T')[0]

    let recentGrnQuery = supabaseClient
      .from('p2_stock_transactions')
      .select('grn_no, quantity, supplier_name, transaction_date')
      .eq('tenant_id', tenantId)
      .eq('raw_material_id', material.id)
      .eq('transaction_type', 'grn')
      .gte('transaction_date', sinceStr)

    if (untilISO) {
      recentGrnQuery = recentGrnQuery.lt('transaction_date', untilISO.split('T')[0])
    }

    const { data, error } = await recentGrnQuery.order('transaction_date', { ascending: false })

    if (error) return 'Could not fetch GRN data.'
    if (!data?.length) return `No GRNs found for ${material.name} in the last ${days} days.`

    const total = data.reduce((sum, r) => sum + (r.quantity ?? 0), 0)
    const lines = data.map(
      (r) =>
        `• ${r.grn_no} — ${r.quantity} ${material.unit} on ${r.transaction_date}${r.supplier_name ? ` from ${r.supplier_name}` : ''}`
    )
    return `${material.name}${codeTag(material.material_code)} — last ${days} days\nTotal received: ${total} ${material.unit}\n\n${lines.join('\n')}`
  }

  if (intent === 'consumption_summary') {
    const materialName = extracted.material_name ?? ''
    const days = extracted.days ?? 30

    const matchResult = matchMaterialName(materialName, context.materials)
    if ('error' in matchResult) return matchResult.error
    const material = matchResult.material

    const { since: sinceISO, until: untilISO } = getISTDateRange(days)
    const sinceStr = sinceISO.split('T')[0]

    let consumptionQuery = supabaseClient
      .from('p2_stock_transactions')
      .select('quantity, transaction_date')
      .eq('tenant_id', tenantId)
      .eq('raw_material_id', material.id)
      .eq('transaction_type', 'consumption')
      .gte('transaction_date', sinceStr)

    if (untilISO) {
      consumptionQuery = consumptionQuery.lt('transaction_date', untilISO.split('T')[0])
    }

    const { data, error } = await consumptionQuery

    if (error) return 'Could not fetch consumption data.'
    if (!data?.length) return `No consumption recorded for ${material.name} in the last ${days} days.`

    const total = data.reduce((sum, r) => sum + Math.abs(r.quantity ?? 0), 0)
    return `${material.name}${codeTag(material.material_code)}: ${total.toFixed(2)} ${material.unit} consumed in the last ${days} days (${data.length} entries).`
  }

  if (intent === 'supplier_history') {
    const supplierName = extracted.supplier_name ?? ''

    const matches = findMatches(supplierName, context.suppliers)
    if (matches.length === 0) return `Couldn't find a supplier matching "${supplierName}".`
    if (matches.length > 1)
      return `"${supplierName}" is ambiguous — did you mean ${matches.map((s) => s.name).join(', ')}?`
    const supplier = matches[0]

    const { data, error } = await supabaseClient
      .from('p2_stock_transactions')
      .select('grn_no, quantity, supplier_name, transaction_date, raw_material_id')
      .eq('tenant_id', tenantId)
      .eq('supplier_id', supplier.id)
      .eq('transaction_type', 'grn')
      .order('transaction_date', { ascending: false })

    if (error) return 'Could not fetch supplier history.'
    if (!data?.length) return `No GRNs found from ${supplier.name}.`

    const materialMap = new Map(context.materials.map((m) => [m.id, m]))
    const lines = data.map((r) => {
      const mat = materialMap.get(r.raw_material_id)
      return `• ${r.grn_no ?? '(no GRN no.)'} — ${r.quantity} ${mat?.unit ?? ''} of ${mat?.name ?? 'Unknown'} on ${r.transaction_date}`
    })
    return `GRNs from ${supplier.name}:\n\n${lines.join('\n')}`
  }

  if (intent === 'invoice_total') {
    const clientName = (extracted.client_name ?? '').trim()
    if (!clientName) return 'Please provide a client name.'

    const { data: clients, error: clientsError } = await supabaseClient
      .from('p2_clients')
      .select('id, name')
      .eq('tenant_id', tenantId)
    if (clientsError) return 'Could not fetch client list.'

    const clientMatch = matchClientName(clientName, (clients ?? []) as { id: string; name: string }[])
    if ('error' in clientMatch) return clientMatch.error
    const client = clientMatch.client

    const validFrom = extracted.date_from && TALLY_EXPORT_DATE_RE.test(extracted.date_from) ? extracted.date_from : undefined
    const validTo = extracted.date_to && TALLY_EXPORT_DATE_RE.test(extracted.date_to) ? extracted.date_to : undefined

    let invoiceTotalQuery = supabaseClient
      .from('p2_invoices')
      .select('amount_total')
      .eq('tenant_id', tenantId)
      .eq('client_id', client.id)
      .eq('status', 'sent')

    if (validFrom) invoiceTotalQuery = invoiceTotalQuery.gte('invoice_date', validFrom)
    if (validTo) invoiceTotalQuery = invoiceTotalQuery.lte('invoice_date', validTo)

    const { data, error } = await invoiceTotalQuery
    if (error) return 'Could not fetch invoice totals.'

    // Same "full calendar month" detection drives the header label as the
    // query range itself — not a clean month means a raw date range, no
    // range at all means the suffix is omitted entirely.
    let periodLabel = ''
    if (validFrom && validTo) {
      const from = new Date(validFrom + 'T00:00:00+05:30')
      const to = new Date(validTo + 'T00:00:00+05:30')
      const lastDayOfMonth = new Date(from.getFullYear(), from.getMonth() + 1, 0).getDate()
      const isFullMonth = from.getDate() === 1 && to.getDate() === lastDayOfMonth &&
        to.getMonth() === from.getMonth() && to.getFullYear() === from.getFullYear()
      periodLabel = isFullMonth
        ? ` — ${from.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' })}`
        : ` — ${formatDDMMYYYY(validFrom)} – ${formatDDMMYYYY(validTo)}`
    }

    const rows = (data ?? []) as { amount_total: number }[]
    if (!rows.length) return `💰 ${client.name}${periodLabel}\nNo invoices found.`

    const total = rows.reduce((sum, r) => sum + (Number(r.amount_total) || 0), 0)
    const totalFormatted = total.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

    return `💰 ${client.name}${periodLabel}\nTotal Billed: ₹${totalFormatted}\nInvoices: ${rows.length}`
  }

  if (intent === 'grn_completeness') {
    const validFrom = extracted.date_from && TALLY_EXPORT_DATE_RE.test(extracted.date_from) ? extracted.date_from : undefined
    const validTo = extracted.date_to && TALLY_EXPORT_DATE_RE.test(extracted.date_to) ? extracted.date_to : undefined

    // No period given -> default to the current calendar month (IST), same
    // first/last-of-month computation grn.html's Month-End Check modal uses.
    const todayISO = todayIST()
    const [todayYear, todayMonth] = todayISO.split('-').map(Number)
    const firstOfMonth = `${todayYear}-${String(todayMonth).padStart(2, '0')}-01`
    const lastDay = new Date(todayYear, todayMonth, 0).getDate()
    const lastOfMonth = `${todayYear}-${String(todayMonth).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`

    const dateFrom = validFrom ?? firstOfMonth
    const dateTo = validTo ?? lastOfMonth

    const { data, error } = await supabaseClient
      .from('p2_stock_transactions')
      .select('invoice_no')
      .eq('tenant_id', tenantId)
      .eq('transaction_type', 'grn')
      .gte('transaction_date', dateFrom)
      .lte('transaction_date', dateTo)

    if (error) return 'Could not fetch GRN completeness.'

    const rows = (data ?? []) as { invoice_no: string | null }[]
    const total = rows.length
    const missing = rows.filter((r) => !r.invoice_no || !r.invoice_no.trim()).length
    // timeZone explicit: the edge runtime's default local zone is not IST,
    // and toLocaleDateString without it renders the wrong calendar month
    // whenever the IST midnight instant crosses a UTC day boundary.
    const monthLabel = new Date(dateFrom + 'T00:00:00+05:30').toLocaleDateString('en-IN', { month: 'long', year: 'numeric', timeZone: 'Asia/Kolkata' })

    if (total === 0) return `ℹ️ ${monthLabel} madhe konta GRN nahi.`
    if (missing === 0) return `✅ ${monthLabel} madhe ${total} GRNs aahit — sagle invoice numbers entered aahit. CA export pathavayala ready aahe.`
    return `⚠️ ${monthLabel} madhe ${total} GRNs aahit, ${missing} rows la invoice number nahi. CA export pathavnyapurvi Month-End Check madhe bagha.`
  }

  if (intent === 'low_stock_list') {
    // Reuses context.stockBalances/context.materials already fetched by
    // buildContext() instead of re-querying v_p2_stock_balance — also
    // sidesteps that view's known missing is_active filter by intersecting
    // with context.materials, which IS active-only.
    const activeIds = new Set(context.materials.map((m) => m.id))
    const low = context.stockBalances.filter(
      (b) => activeIds.has(b.raw_material_id) && b.current_stock < b.min_stock_level
    )

    if (!low.length) return 'All materials are above minimum stock levels. ✅'

    const lines = low.map((r) => `• ${r.name}${codeTag(r.material_code)}: ${r.current_stock} ${r.unit} (min: ${r.min_stock_level} ${r.unit})`)
    return `${low.length} material${low.length > 1 ? 's' : ''} below minimum:\n\n${lines.join('\n')}`
  }

  if (intent === 'grn_detail') {
    const grnNo = (extracted.grn_no ?? '').trim()
    if (!grnNo) return 'Please provide a GRN number.'

    const { data, error } = await supabaseClient
      .from('p2_stock_transactions')
      .select('grn_no, quantity, supplier_name, transaction_date, raw_material_id, invoice_no')
      .eq('tenant_id', tenantId)
      .eq('grn_no', grnNo)
      .eq('transaction_type', 'grn')

    if (error) return 'Could not fetch GRN details.'
    if (!data?.length) return `GRN "${grnNo}" not found.`

    const materialMap = new Map(context.materials.map((m) => [m.id, m]))
    const first = data[0]
    const lines = data.map((r) => {
      const mat = materialMap.get(r.raw_material_id)
      return `• ${r.quantity} ${mat?.unit ?? ''} of ${mat?.name ?? 'Unknown'}${codeTag(mat?.material_code)}`
    })
    return `${grnNo} — ${first.transaction_date}${first.supplier_name ? `, from ${first.supplier_name}` : ''}${first.invoice_no ? `, Invoice: ${first.invoice_no}` : ''}:\n\n${lines.join('\n')}`
  }

  if (intent === 'pending_dispatches') {
    const { data, error } = await supabaseClient
      .from('p2_dispatch_orders')
      .select('challan_number, client_name, created_at, dispatch_type')
      .eq('tenant_id', tenantId)
      .eq('status', 'draft')
      .order('created_at', { ascending: false })

    if (error) return 'Could not fetch pending dispatches.'
    if (!data?.length) return 'No pending dispatches. ✅'

    const lines = data.map((r) => {
      const days = Math.floor((Date.now() - new Date(r.created_at).getTime()) / 86400000)
      return `• ${r.challan_number} — ${r.client_name} (${days} day${days !== 1 ? 's' : ''} pending)`
    })
    return `${data.length} pending dispatch${data.length > 1 ? 'es' : ''}:\n\n${lines.join('\n')}`
  }

  if (intent === 'grn_summary') {
    const days = extracted.days ?? 0

    const { since: sinceISO, until: untilISO } = getISTDateRange(days)
    const sinceStr = sinceISO.split('T')[0]

    let grnSummaryQuery = supabaseClient
      .from('p2_stock_transactions')
      .select('grn_no, quantity, supplier_name, transaction_date, raw_material_id')
      .eq('tenant_id', tenantId)
      .eq('transaction_type', 'grn')
      .gte('transaction_date', sinceStr)

    if (untilISO) {
      grnSummaryQuery = grnSummaryQuery.lt('transaction_date', untilISO.split('T')[0])
    }

    const { data, error } = await grnSummaryQuery.order('transaction_date', { ascending: false })

    const periodLabel = days === 0 ? 'today' : days === 1 ? 'yesterday' : `last ${days} days`

    if (error) return 'Could not fetch GRN data.'
    if (!data?.length) return `No GRNs received ${periodLabel}.`

    const materialMap = new Map(context.materials.map((m) => [m.id, m]))
    const rows = data as { grn_no: string; quantity: number; supplier_name: string | null; transaction_date: string; raw_material_id: string }[]
    const uniqueGrns = new Set(rows.map((r) => r.grn_no)).size
    const lines = rows.map((r) => {
      const mat = materialMap.get(r.raw_material_id)
      return `• ${r.grn_no} — ${r.quantity} ${mat?.unit ?? ''} of ${mat?.name ?? 'Unknown'}${codeTag(mat?.material_code)}${r.supplier_name ? ` from ${r.supplier_name}` : ''} on ${r.transaction_date}`
    })
    return `${uniqueGrns} GRN${uniqueGrns !== 1 ? 's' : ''} received ${periodLabel} (${rows.length} line${rows.length !== 1 ? 's' : ''}):\n\n${lines.join('\n')}`
  }

  if (intent === 'top_consumption') {
    const days = extracted.days ?? 30
    const topN = extracted.top_n ?? 10

    const { since: sinceISO, until: untilISO } = getISTDateRange(days)
    const sinceStr = sinceISO.split('T')[0]

    let topConsumptionQuery = supabaseClient
      .from('p2_stock_transactions')
      .select('raw_material_id, quantity')
      .eq('tenant_id', tenantId)
      .eq('transaction_type', 'consumption')
      .gte('transaction_date', sinceStr)

    if (untilISO) {
      topConsumptionQuery = topConsumptionQuery.lt('transaction_date', untilISO.split('T')[0])
    }

    const { data, error } = await topConsumptionQuery

    const periodLabel = days === 0 ? 'today' : days === 1 ? 'yesterday' : `last ${days} days`

    if (error) return 'Could not fetch consumption data.'
    if (!data?.length) return `No consumption recorded ${periodLabel}.`

    // Aggregate by material client-side
    const materialMap = new Map(context.materials.map((m) => [m.id, m]))
    const totals = new Map<string, { name: string; unit: string; total: number; code: string | null }>()

    for (const row of data) {
      const mat = materialMap.get(row.raw_material_id)
      if (!mat) continue
      const existing = totals.get(row.raw_material_id)
      if (existing) {
        existing.total += Math.abs(row.quantity ?? 0)
      } else {
        totals.set(row.raw_material_id, { name: mat.name, unit: mat.unit, total: Math.abs(row.quantity ?? 0), code: mat.material_code ?? null })
      }
    }

    const sorted = Array.from(totals.values())
      .sort((a, b) => b.total - a.total)
      .slice(0, topN)

    const lines = sorted.map((r, i) => `${i + 1}. ${r.name}${codeTag(r.code)}: ${r.total.toFixed(2)} ${r.unit}`)
    return `Top ${sorted.length} consumed materials (${periodLabel}):\n\n${lines.join('\n')}`
  }

  if (intent === 'material_list') {
    const activeIds = new Set(context.materials.map((m) => m.id))
    const withStock = context.stockBalances
      .filter(b => activeIds.has(b.raw_material_id))
      .sort((a, b) => a.name.localeCompare(b.name))

    if (!withStock.length) return 'No materials found.'

    const lines = withStock.map(r => {
      const code = r.material_code ? ` [${r.material_code}]` : ''
      const status = r.current_stock <= 0 ? ' ⚠️ OUT' : r.min_stock_level && r.current_stock < r.min_stock_level ? ' ⚠️ LOW' : ''
      return `• ${r.name}${code}: ${r.current_stock} ${r.unit}${status}`
    })
    return `${withStock.length} materials:\n\n${lines.join('\n')}`
  }

  if (intent === 'stock_check_product') {
    const productName = extracted.product_name ?? ''
    const quantity = extracted.quantity ?? 1

    // Match product
    const productMatches = findProductMatches(productName, context.products)
    if (productMatches.length === 0) return `Couldn't find a product matching "${productName}".`
    if (productMatches.length > 1) return `"${productName}" is ambiguous — did you mean ${productMatches.map(p => p.name).join(', ')}?`
    const product = productMatches[0]

    // Fetch BOM for this product
    const { data: bomRows, error: bomError } = await supabaseClient
      .from('p2_product_bom')
      .select('raw_material_id, qty_per_unit, unit')
      .eq('tenant_id', tenantId)
      .eq('product_id', product.id)

    if (bomError) return 'Could not fetch product BOM.'
    if (!bomRows?.length) return `No BOM found for ${product.name}. Please set up the bill of materials first.`

    const materialMap = new Map(context.materials.map((m) => [m.id, m]))
    const stockMap = new Map(context.stockBalances.map((b) => [b.raw_material_id, b.current_stock]))

    const shortfalls: string[] = []
    const sufficient: string[] = []

    for (const row of bomRows) {
      const mat = materialMap.get(row.raw_material_id)
      if (!mat) continue
      const required = row.qty_per_unit * quantity
      const available = stockMap.get(row.raw_material_id) ?? 0
      if (available < required) {
        shortfalls.push(`• ${mat.name}: need ${required} ${mat.unit}, have ${available} ${mat.unit} ❌`)
      } else {
        sufficient.push(`• ${mat.name}: need ${required} ${mat.unit}, have ${available} ${mat.unit} ✅`)
      }
    }

    if (shortfalls.length === 0) {
      return `✅ Enough stock to produce ${quantity} × ${product.name}.\n\n${sufficient.join('\n')}`
    }

    return `❌ Cannot produce ${quantity} × ${product.name} — ${shortfalls.length} material${shortfalls.length > 1 ? 's' : ''} short:\n\n${shortfalls.join('\n')}\n\nSufficient:\n${sufficient.join('\n')}`
  }

  if (intent === 'zero_stock_list') {
    const activeIds = new Set(context.materials.map((m) => m.id))
    const zero = context.stockBalances.filter(
      b => activeIds.has(b.raw_material_id) && b.current_stock <= 0
    )

    if (!zero.length) return 'No materials are out of stock. ✅'

    const lines = zero.map(r => `• ${r.name}${codeTag(r.material_code)}: ${r.current_stock} ${r.unit}`)
    return `${zero.length} material${zero.length > 1 ? 's' : ''} out of stock:\n\n${lines.join('\n')}`
  }

  if (intent === 'dispatch_summary') {
    const days = extracted.days ?? 0

    const { since: sinceISO, until: untilISO } = getISTDateRange(days)

    let dispatchSummaryQuery = supabaseClient
      .from('p2_dispatch_orders')
      .select('challan_number, client_name, confirmed_at, dispatch_type')
      .eq('tenant_id', tenantId)
      .eq('status', 'confirmed')
      .gte('confirmed_at', sinceISO)

    if (untilISO) {
      dispatchSummaryQuery = dispatchSummaryQuery.lt('confirmed_at', untilISO)
    }

    const { data, error } = await dispatchSummaryQuery.order('confirmed_at', { ascending: false })

    const periodLabel = days === 0 ? 'today' : days === 1 ? 'yesterday' : `last ${days} days`

    if (error) return 'Could not fetch dispatch data.'
    if (!data?.length) return `No dispatches confirmed ${periodLabel}.`

    const rows = data as { challan_number: string; client_name: string }[]
    const lines = rows.map((r) => `• ${r.challan_number} — ${r.client_name ?? 'Unknown client'}`)
    return `${rows.length} dispatch${rows.length !== 1 ? 'es' : ''} confirmed ${periodLabel}:\n\n${lines.join('\n')}`
  }

  if (intent === 'supplier_delivery_check') {
    const supplierName = extracted.supplier_name ?? ''
    const days = extracted.days ?? 0

    const matches = findMatches(supplierName, context.suppliers)
    if (matches.length === 0) return `Couldn't find a supplier matching "${supplierName}".`
    if (matches.length > 1) return `"${supplierName}" is ambiguous — did you mean ${matches.map(s => s.name).join(', ')}?`
    const supplier = matches[0]

    const { since: sinceISO, until: untilISO } = getISTDateRange(days)
    const sinceStr = sinceISO.split('T')[0]

    let supplierDeliveryQuery = supabaseClient
      .from('p2_stock_transactions')
      .select('grn_no, quantity, transaction_date, raw_material_id')
      .eq('tenant_id', tenantId)
      .eq('supplier_id', supplier.id)
      .eq('transaction_type', 'grn')
      .gte('transaction_date', sinceStr)

    if (untilISO) {
      supplierDeliveryQuery = supplierDeliveryQuery.lt('transaction_date', untilISO.split('T')[0])
    }

    const { data, error } = await supplierDeliveryQuery.order('transaction_date', { ascending: false })

    if (error) return 'Could not fetch delivery data.'

    const periodLabel = days === 0 ? 'today' : days === 1 ? 'yesterday' : `last ${days} days`
    if (!data?.length) return `No delivery from ${supplier.name} ${periodLabel}.`

    const materialMap = new Map(context.materials.map((m) => [m.id, m]))
    const rows = data as { grn_no: string; quantity: number; transaction_date: string; raw_material_id: string }[]
    const lines = rows.map((r) => {
      const mat = materialMap.get(r.raw_material_id)
      return `• ${r.grn_no} — ${r.quantity} ${mat?.unit ?? ''} of ${mat?.name ?? 'Unknown'} on ${r.transaction_date}`
    })
    return `${rows.length} ${rows.length !== 1 ? 'deliveries' : 'delivery'} from ${supplier.name} ${periodLabel}:\n\n${lines.join('\n')}`
  }

  if (intent === 'challan_detail') {
    const challanNumber = (extracted.challan_number ?? '').trim()
    if (!challanNumber) return 'Please provide a challan number.'

    let { data, error } = await supabaseClient
      .from('p2_dispatch_orders')
      .select('challan_number, client_name, status, created_at, confirmed_at, dispatch_type')
      .eq('tenant_id', tenantId)
      .eq('challan_number', challanNumber)
      .limit(1)

    if (error) return 'Could not fetch challan details.'

    if (!data?.length) {
      const { data: likeData, error: likeError } = await supabaseClient
        .from('p2_dispatch_orders')
        .select('challan_number, client_name, status, created_at, confirmed_at, dispatch_type')
        .eq('tenant_id', tenantId)
        .ilike('challan_number', `%${challanNumber}`)
        .limit(5)

      if (likeError) return 'Could not fetch challan details.'
      data = likeData
    }

    if (!data?.length) return `Challan "${challanNumber}" not found.`
    if (data.length > 1) {
      const nums = (data as { challan_number: string }[]).map(r => r.challan_number).join(', ')
      return `Multiple challans match "${challanNumber}": ${nums}. Please be more specific.`
    }

    const r = data[0] as {
      challan_number: string
      client_name: string
      status: string
      created_at: string
      confirmed_at: string | null
      dispatch_type: string
    }
    const createdDate = new Date(r.created_at).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
    const statusLabel = r.status === 'confirmed' ? '✅ Confirmed' : r.status === 'draft' ? '⏳ Pending' : '❌ Cancelled'
    const confirmedLine = r.confirmed_at
      ? `\nConfirmed: ${new Date(r.confirmed_at).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}`
      : ''
    const typeLabel = r.dispatch_type === 'bom_issue' ? 'Production Issue' : r.dispatch_type === 'raw_material' ? 'RM Dispatch' : 'Product Dispatch'

    return `Challan ${r.challan_number}\nClient: ${r.client_name}\nType: ${typeLabel}\nStatus: ${statusLabel}\nCreated: ${createdDate}${confirmedLine}`
  }

  if (intent === 'invoice_detail') {
    const invoiceNumber = (extracted.invoice_number ?? '').trim()
    if (!invoiceNumber) return 'Please provide an invoice number.'

    const invoiceDetailColumns =
      'invoice_number, client_name, created_at, invoice_mode, status, items, amount_subtotal, amount_gst, amount_total, gst_type'

    let { data, error } = await supabaseClient
      .from('p2_invoices')
      .select(invoiceDetailColumns)
      .eq('tenant_id', tenantId)
      .eq('invoice_number', invoiceNumber)
      .limit(1)

    if (error) return 'Could not fetch invoice details.'

    if (!data?.length) {
      const { data: likeData, error: likeError } = await supabaseClient
        .from('p2_invoices')
        .select(invoiceDetailColumns)
        .eq('tenant_id', tenantId)
        .ilike('invoice_number', `%${invoiceNumber}`)
        .limit(5)

      if (likeError) return 'Could not fetch invoice details.'
      data = likeData
    }

    if (!data?.length) return `Invoice "${invoiceNumber}" not found.`
    if (data.length > 1) {
      const nums = (data as { invoice_number: string }[]).map((r) => r.invoice_number).join(', ')
      return `Multiple invoices match "${invoiceNumber}": ${nums}. Please be more specific.`
    }

    const inv = data[0] as {
      invoice_number: string
      client_name: string | null
      created_at: string
      invoice_mode: string
      status: string
      items: InvoiceItem[]
      amount_subtotal: number
      amount_gst: number
      amount_total: number
      gst_type: string
    }

    const createdDate = new Date(inv.created_at).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
    const modeLabel = inv.invoice_mode === 'consolidated' ? 'Consolidated' : 'Single'
    const statusLabel = inv.status === 'cancelled' ? 'Cancelled' : inv.status === 'sent' ? 'Sent' : 'Draft'

    const fmtAmt = (n: number) => (Number(n) || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

    const itemLines = (inv.items ?? []).map(
      (it) => `${it.description} × ${it.qty} ${it.unit} — ₹${fmtAmt(it.amount)}`
    )

    const gstAmount = Number(inv.amount_gst) || 0
    const gstLines: string[] = []
    if (inv.gst_type === 'cgst_sgst') {
      gstLines.push(`CGST 9%: ₹${fmtAmt(gstAmount / 2)}`, `SGST 9%: ₹${fmtAmt(gstAmount / 2)}`)
    } else if (inv.gst_type === 'igst') {
      gstLines.push(`IGST 18%: ₹${fmtAmt(gstAmount)}`)
    }

    return [
      `🧾 ${inv.invoice_number}`,
      `Client: ${inv.client_name ?? '-'}`,
      `Date: ${createdDate}`,
      `Mode: ${modeLabel}`,
      `Status: ${statusLabel}`,
      `─────────────────`,
      ...itemLines,
      `─────────────────`,
      `Subtotal: ₹${fmtAmt(inv.amount_subtotal)}`,
      ...gstLines,
      `Total: ₹${fmtAmt(inv.amount_total)}`,
    ].join('\n')
  }

  if (intent === 'issue_summary') {
    const days = extracted.days ?? 0

    const { since: sinceISO, until: untilISO } = getISTDateRange(days)

    let issueSummaryQuery = supabaseClient
      .from('p2_dispatch_orders')
      .select('challan_number, client_name, created_at, status')
      .eq('tenant_id', tenantId)
      .eq('dispatch_type', 'bom_issue')
      .gte('created_at', sinceISO)

    if (untilISO) {
      issueSummaryQuery = issueSummaryQuery.lt('created_at', untilISO)
    }

    const { data, error } = await issueSummaryQuery.order('created_at', { ascending: false })

    if (error) return 'Could not fetch production issue data.'

    const periodLabel = days === 0 ? 'today' : days === 1 ? 'yesterday' : `last ${days} days`
    if (!data?.length) return `No production issues recorded ${periodLabel}.`

    const rows = data as { challan_number: string; client_name: string; status: string }[]
    const lines = rows.map(r => {
      const statusIcon = r.status === 'confirmed' ? '✅' : r.status === 'draft' ? '⏳' : '❌'
      return `• ${r.challan_number} — ${r.client_name} ${statusIcon}`
    })
    return `${rows.length} production issue${rows.length !== 1 ? 's' : ''} ${periodLabel}:\n\n${lines.join('\n')}`
  }

  if (intent === 'product_code_lookup') {
    const productName = extracted.product_name ?? ''
    if (!productName.trim()) return 'Please provide a product name.'

    const productMatches = findProductMatches(productName, context.products)
    if (productMatches.length === 0) return `Couldn't find a product matching "${productName}".`
    if (productMatches.length > 1) {
      return `"${productName}" is ambiguous — did you mean ${productMatches.map(p => p.name).join(', ')}?`
    }

    const product = productMatches[0]
    return `${product.name}\nCode: ${product.product_code ?? 'No code assigned'}`
  }

  if (intent === 'top_received') {
    const days = extracted.days ?? 30
    const topN = extracted.top_n ?? 10

    const { since: sinceISO, until: untilISO } = getISTDateRange(days)
    const sinceStr = sinceISO.split('T')[0]

    let topReceivedQuery = supabaseClient
      .from('p2_stock_transactions')
      .select('raw_material_id, quantity')
      .eq('tenant_id', tenantId)
      .eq('transaction_type', 'grn')
      .gte('transaction_date', sinceStr)

    if (untilISO) {
      topReceivedQuery = topReceivedQuery.lt('transaction_date', untilISO.split('T')[0])
    }

    const { data, error } = await topReceivedQuery

    const periodLabel = days === 0 ? 'today' : days === 1 ? 'yesterday' : `last ${days} days`

    if (error) return 'Could not fetch GRN data.'
    if (!data?.length) return `No materials received ${periodLabel}.`

    const materialMap = new Map(context.materials.map((m) => [m.id, m]))
    const totals = new Map<string, { name: string; unit: string; total: number; code: string | null }>()

    for (const row of data) {
      const mat = materialMap.get(row.raw_material_id)
      if (!mat) continue
      const existing = totals.get(row.raw_material_id)
      if (existing) {
        existing.total += row.quantity ?? 0
      } else {
        totals.set(row.raw_material_id, { name: mat.name, unit: mat.unit, total: row.quantity ?? 0, code: mat.material_code ?? null })
      }
    }

    const sorted = Array.from(totals.values())
      .sort((a, b) => b.total - a.total)
      .slice(0, topN)

    if (!sorted.length) return `No GRN data found for ${periodLabel}.`

    const lines = sorted.map((r, i) => `${i + 1}. ${r.name}${codeTag(r.code)}: ${r.total.toFixed(2)} ${r.unit}`)
    return `Top ${sorted.length} received materials (${periodLabel}):\n\n${lines.join('\n')}`
  }

  if (intent === 'product_list') {
    const sorted = [...context.products].sort((a, b) => a.name.localeCompare(b.name))
    if (!sorted.length) return 'No products found.'

    const lines = sorted.map((p) => `• ${p.name}${p.product_code ? ` [${p.product_code}]` : ''}`)
    return `${sorted.length} product${sorted.length !== 1 ? 's' : ''}:\n\n${lines.join('\n')}`
  }

  if (intent === 'supplier_list') {
    const sorted = [...context.suppliers].sort((a, b) => a.name.localeCompare(b.name))
    if (!sorted.length) return 'No suppliers found.'

    const lines = sorted.map((s) => `• ${s.name}`)
    return `${sorted.length} supplier${sorted.length !== 1 ? 's' : ''}:\n\n${lines.join('\n')}`
  }

  if (intent === 'gstr2b_status') {
    // Reconciliation results aren't persisted (client-side only, stateless per
    // upload) — this intent can't query a live result, so it nudges instead.
    return "GSTR-2B reconciliation is done on the export page. Upload this month's JSON to see matched vs blocked ITC. GSTR-2B is available from the 14th — file by the 20th."
  }

  if (intent === 'dispatch_detail') {
    const challanNumber = (extracted.challan_number ?? '').trim()
    if (!challanNumber) return 'Please provide a challan number.'

    let { data: orders, error: orderError } = await supabaseClient
      .from('p2_dispatch_orders')
      .select('id, challan_number, client_name, dispatch_type, status, dispatch_date')
      .eq('tenant_id', tenantId)
      .eq('challan_number', challanNumber)
      .limit(1)

    if (orderError) return 'Could not fetch challan details.'

    if (!orders?.length) {
      const { data: likeOrders, error: likeError } = await supabaseClient
        .from('p2_dispatch_orders')
        .select('id, challan_number, client_name, dispatch_type, status, dispatch_date')
        .eq('tenant_id', tenantId)
        .ilike('challan_number', `%${challanNumber}`)
        .limit(5)

      if (likeError) return 'Could not fetch challan details.'
      orders = likeOrders
    }

    if (!orders?.length) return `Challan "${challanNumber}" not found.`
    if (orders.length > 1) {
      const nums = (orders as { challan_number: string }[]).map((o) => o.challan_number).join(', ')
      return `Multiple challans match "${challanNumber}": ${nums}. Please be more specific.`
    }

    const order = orders[0] as {
      id: string
      challan_number: string
      client_name: string
      dispatch_type: string
      status: string
      dispatch_date: string | null
    }

    const { data: items, error: itemsError } = await supabaseClient
      .from('p2_dispatch_items')
      .select('material_name, qty_dispatched, unit')
      .eq('tenant_id', tenantId)
      .eq('dispatch_order_id', order.id)

    if (itemsError) return 'Could not fetch challan items.'
    if (!items?.length) return `Challan ${order.challan_number} found but has no line items.`

    const typeLabel = order.dispatch_type === 'bom_issue' ? 'Production Issue' : order.dispatch_type === 'raw_material' ? 'RM Dispatch' : 'Product Dispatch'
    const rows = items as { material_name: string; qty_dispatched: number; unit: string }[]
    const lines = rows.map((r) => `• ${r.material_name}: ${r.qty_dispatched} ${r.unit}`)
    return `${order.challan_number} — ${order.client_name} (${typeLabel}):\n\n${lines.join('\n')}`
  }

  if (intent === 'issue_detail') {
    const challanNumber = (extracted.challan_number ?? '').trim()
    if (!challanNumber) return 'Please provide a challan number.'

    let { data: orders, error: orderError } = await supabaseClient
      .from('p2_dispatch_orders')
      .select('id, challan_number, client_name, created_at')
      .eq('tenant_id', tenantId)
      .eq('dispatch_type', 'bom_issue')
      .eq('challan_number', challanNumber)
      .limit(1)

    if (orderError) return 'Could not fetch issue details.'

    if (!orders?.length) {
      const { data: likeOrders, error: likeError } = await supabaseClient
        .from('p2_dispatch_orders')
        .select('id, challan_number, client_name, created_at')
        .eq('tenant_id', tenantId)
        .eq('dispatch_type', 'bom_issue')
        .ilike('challan_number', `%${challanNumber}`)
        .limit(5)

      if (likeError) return 'Could not fetch issue details.'
      orders = likeOrders
    }

    if (!orders?.length) return `Production issue challan "${challanNumber}" not found.`
    if (orders.length > 1) {
      const nums = (orders as { challan_number: string }[]).map((o) => o.challan_number).join(', ')
      return `Multiple issue challans match "${challanNumber}": ${nums}. Please be more specific.`
    }

    const order = orders[0] as { id: string; challan_number: string; client_name: string; created_at: string }

    const { data: items, error: itemsError } = await supabaseClient
      .from('p2_dispatch_items')
      .select('material_name, qty_dispatched, unit')
      .eq('tenant_id', tenantId)
      .eq('dispatch_order_id', order.id)

    if (itemsError) return 'Could not fetch issue items.'
    if (!items?.length) return `Issue challan ${order.challan_number} found but has no line items.`

    const rows = items as { material_name: string; qty_dispatched: number; unit: string }[]
    const lines = rows.map((r) => `• ${r.material_name}: ${r.qty_dispatched} ${r.unit}`)
    const createdDate = new Date(order.created_at).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
    return `${order.challan_number} — ${order.client_name} (${createdDate}):\n\n${lines.join('\n')}`
  }

  if (intent === 'bom_detail') {
    const productName = extracted.product_name ?? ''
    if (!productName.trim()) return 'Please provide a product name.'

    const productMatches = findProductMatches(productName, context.products)
    if (productMatches.length === 0) return `Couldn't find a product matching "${productName}".`
    if (productMatches.length > 1) {
      return `"${productName}" is ambiguous — did you mean ${productMatches.map((p) => p.name).join(', ')}?`
    }
    const product = productMatches[0]

    const { data: bomRows, error: bomError } = await supabaseClient
      .from('p2_product_bom')
      .select('raw_material_id, qty_per_unit, unit')
      .eq('tenant_id', tenantId)
      .eq('product_id', product.id)

    if (bomError) return 'Could not fetch BOM.'
    if (!bomRows?.length) return `No BOM set up for ${product.name}. Please configure it first.`

    const materialMap = new Map(context.materials.map((m) => [m.id, m]))
    const rows = bomRows as { raw_material_id: string; qty_per_unit: number; unit: string }[]
    const lines = rows.map((r) => {
      const mat = materialMap.get(r.raw_material_id)
      return `• ${mat?.name ?? 'Unknown'}${codeTag(mat?.material_code)}: ${r.qty_per_unit} ${r.unit}`
    })
    return `BOM for ${product.name} (${product.product_code}):\n\n${lines.join('\n')}`
  }

  if (intent === 'top_supplier') {
    const days = extracted.days ?? 30
    const topN = extracted.top_n ?? 10

    const { since: sinceISO, until: untilISO } = getISTDateRange(days)
    const sinceStr = sinceISO.split('T')[0]

    let topSupplierQuery = supabaseClient
      .from('p2_stock_transactions')
      .select('supplier_id, supplier_name, quantity')
      .eq('tenant_id', tenantId)
      .eq('transaction_type', 'grn')
      .not('supplier_id', 'is', null)
      .gte('transaction_date', sinceStr)

    if (untilISO) {
      topSupplierQuery = topSupplierQuery.lt('transaction_date', untilISO.split('T')[0])
    }

    const { data, error } = await topSupplierQuery

    const periodLabel = days === 0 ? 'today' : days === 1 ? 'yesterday' : `last ${days} days`

    if (error) return 'Could not fetch supplier data.'
    if (!data?.length) return `No supplier deliveries found ${periodLabel}.`

    const rows = data as { supplier_id: string; supplier_name: string | null; quantity: number }[]
    const totals = new Map<string, { name: string; total: number }>()

    for (const row of rows) {
      const existing = totals.get(row.supplier_id)
      if (existing) {
        existing.total += row.quantity ?? 0
      } else {
        totals.set(row.supplier_id, { name: row.supplier_name ?? 'Unknown', total: row.quantity ?? 0 })
      }
    }

    const sorted = Array.from(totals.values())
      .sort((a, b) => b.total - a.total)
      .slice(0, topN)

    const lines = sorted.map((s, i) => `${i + 1}. ${s.name}: ${s.total.toFixed(2)} units received`)
    return `Top ${sorted.length} suppliers by quantity received (${periodLabel}):\n\n${lines.join('\n')}`
  }

  return 'Unrecognized query.'
}

// Company and client names are owner-entered free text and go straight into an
// HTML email body — escaped so a stray & or < cannot break the markup.
function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function formatDDMMYYYY(dateStr: string): string {
  const d = new Date(dateStr)
  const dd = String(d.getDate()).padStart(2, '0')
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const yyyy = d.getFullYear()
  return `${dd}/${mm}/${yyyy}`
}

const TALLY_EXPORT_DATE_RE = /^\d{4}-\d{2}-\d{2}$/

// Flat 18% GST split — cgst_sgst divides it 9+9, igst keeps it whole, none
// drops it. This is a proforma/billing document, not a GST filing document
// (GST scope is permanently locked to zero filing/GSTR features), so the
// flat rate is a deliberate simplification, not a stand-in for per-material
// gst_rate (which p2_raw_materials already has, used elsewhere for Tally).
function buildInvoiceTotals(items: InvoiceItem[], gstType: string): {
  subtotal: number; gst: number; cgst: number; sgst: number; igst: number; roundOff: number; total: number
} {
  const subtotal = items.reduce((sum, it) => sum + it.amount, 0)
  const gstExact = gstType === 'none' ? 0 : subtotal * 0.18

  // Section 170 CGST: CGST/SGST/IGST rounded to the nearest paisa (2
  // decimals) each, independently — so invoice.html's displayed halves
  // (amount_gst / 2) always re-sum exactly instead of drifting from a single
  // rounded whole. total is rounded to the nearest whole rupee (the legal
  // minimum); round_off is whatever residual is needed to reconcile the two,
  // so the invoice still nets to exactly subtotal + gst + round_off = total.
  let cgst = 0, sgst = 0, igst = 0
  if (gstType === 'cgst_sgst') {
    cgst = Math.round((gstExact / 2) * 100) / 100
    sgst = Math.round((gstExact / 2) * 100) / 100
  } else if (gstType === 'igst') {
    igst = Math.round(gstExact * 100) / 100
  }
  const gst = cgst + sgst + igst

  const total = Math.round(subtotal + gst)
  const roundOff = Math.round((total - (subtotal + gst)) * 100) / 100

  return { subtotal, gst, cgst, sgst, igst, roundOff, total }
}

// Job-work purposes from js/movement-purpose.js's MOVEMENT_PURPOSES list,
// minus 'sale' (the only purpose that is a plain goods transaction).
// Duplicated here rather than imported because movement-purpose.js is a
// browser <script> global with no module exports — agent-query is a Deno
// Edge Function and cannot load it. Keep in sync if that file's purpose list
// changes.
const JOB_WORK_MOVEMENT_PURPOSES = new Set([
  'job_work_issue', 'job_work_return', 'unused_material_return', 'scrap_return',
  'rework_return', 'rework_dispatch', 'capital_goods_issue',
  'inter_jobworker_transfer', 'direct_supply_from_jobworker',
])

// The two movement purposes with ownershipChanges: true in
// js/movement-purpose.js — the only ones where a client tax invoice (billing
// for the goods themselves) is the legally correct document. Duplicated here
// for the same reason as JOB_WORK_MOVEMENT_PURPOSES above (no shared module
// system between the browser script and this Deno Edge Function).
const SALE_INVOICEABLE_PURPOSES = new Set(['sale', 'direct_supply_from_jobworker'])

// Rule 48(1) (goods — triplicate: Original for Recipient / Duplicate for
// Transporter / Triplicate for Supplier) vs Rule 48(2) (services/job work —
// duplicate: Original for Recipient / Duplicate for Supplier) copy markings.
// Decided once at generation time and stored on the invoice row
// (doc_category) so invoice.html/invoice-pdf.js never have to re-derive it
// from a dispatch that may no longer exist (hard-deleted draft/cancelled
// challans) or re-fetch movement_purpose at render time.
function deriveDocCategory(dispatchType: string | null, movementPurpose: string | null): 'goods' | 'services' {
  if (dispatchType === 'bom_issue') return 'services'
  if (movementPurpose && JOB_WORK_MOVEMENT_PURPOSES.has(movementPurpose)) return 'services'
  return 'goods'
}

// p2_tenant_settings.invoice_number_format ('full' | 'short', default 'full').
// get_next_invoice_number returns both the pre-formatted INV-YYYYMM-NNN string
// and the raw sequence integer — 'short' rebuilds from the raw integer, no
// prefix (just the number), 'full' (or missing/null) keeps the RPC's own
// formatted string unchanged.
function resolveInvoiceNumber(
  format: string | null | undefined,
  seqRow: { invoice_number: string; sequence_number: number }
): string {
  return format === 'short' ? `${seqRow.sequence_number}` : seqRow.invoice_number
}

// Orange link button, reply_to only if truthy, pointing at the invoice-view
// link instead of receive.html.
async function sendInvoiceEmail(params: {
  toEmail: string
  clientName: string
  invoiceNumber: string
  companyName: string
  total: number
  replyToEmail: string | null
  invoiceUrl: string
}): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!RESEND_API_KEY) {
    console.error('[sendInvoiceEmail] RESEND_API_KEY not configured')
    return { ok: false, error: 'RESEND_API_KEY not configured' }
  }

  const totalFormatted = params.total.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

  const body: Record<string, unknown> = {
    from: 'Nexflow <challans@nexflowautomations.in>',
    to: [params.toEmail],
    subject: `Invoice ${params.invoiceNumber} — ${params.companyName}`,
    text: `Dear ${params.clientName},\n\nPlease find your invoice ${params.invoiceNumber} for Rs. ${totalFormatted}.\n\nView and download: ${params.invoiceUrl}\n\nRegards,\n${params.companyName}`,
    html: `<p>Dear ${escapeHtml(params.clientName)},</p>
<p>Please find your invoice ${escapeHtml(params.invoiceNumber)} for ₹${totalFormatted}.</p>
<p style="margin-top:16px;">
  <a href="${params.invoiceUrl}" style="color:#ff5c1a; font-weight:600;">
    View &amp; download this invoice →
  </a>
</p>
<p style="margin-top:16px;">Regards,<br>${escapeHtml(params.companyName)}</p>`,
  }
  if (params.replyToEmail && params.replyToEmail.trim()) {
    body.reply_to = params.replyToEmail
  }

  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })

    if (!response.ok) {
      const errText = await response.text()
      console.error(`[sendInvoiceEmail] Resend API error for ${params.toEmail}:`, errText)
      return { ok: false, error: errText || `Resend API returned ${response.status}` }
    }

    return { ok: true }
  } catch (err) {
    console.error(`[sendInvoiceEmail] Failed to send to ${params.toEmail}:`, err)
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

interface InvoiceOrderRow {
  id: string
  challan_number: string
  client_name: string
  client_address: string | null
  status: string
  dispatch_date: string | null
  dispatch_type: string
  movement_purpose: string | null
}

const INVOICE_ORDER_COLUMNS = 'id, challan_number, client_name, client_address, status, dispatch_date, dispatch_type, movement_purpose'

// Resolves one dispatch order's items into InvoiceItem[] — rates come from
// p2_material_prices/p2_product_prices (latest by effective_date), NOT from
// user input (that's only confirmGenerateInvoice's item_rates path, which
// trusts a client-supplied rate per line and never calls this function).
// Used by previewConsolidatedInvoice/confirmConsolidatedInvoice as the
// default rate before the owner edits it in the preview step.
//
// No price row found -> rate 0, amount 0 for that item. Never block or error
// — blocking a whole invoice (especially a consolidated one covering several
// dispatches) over one unpriced material would make this feature useless for
// any client with even one unpriced item, which is the current state of SS
// Engineering. The owner sees the zero-rate line on the invoice and follows
// up manually.
async function buildInvoiceItemsForOrder(
  supabaseClient: ReturnType<typeof createClient>,
  tenantId: string,
  order: Pick<InvoiceOrderRow, 'id' | 'challan_number' | 'dispatch_date'>
): Promise<{ items: (InvoiceItem & { dispatch_item_id: string; product_code: string })[] } | { error: string }> {
  const { data: items, error: itemsError } = await supabaseClient
    .from('p2_dispatch_items')
    .select('id, material_name, material_code, qty_dispatched, unit, raw_material_id, product_id')
    .eq('tenant_id', tenantId)
    .eq('dispatch_order_id', order.id)

  if (itemsError) {
    return { error: 'Challan items load karta aale nahi.' }
  }
  if (!items?.length) {
    return { error: `Challan ${order.challan_number} madhe items nahit — invoice pathavta yet nahi` }
  }

  type ItemRow = {
    id: string
    material_name: string | null
    material_code: string | null
    qty_dispatched: number
    unit: string
    raw_material_id: string | null
    product_id: string | null
  }
  const itemRows = items as ItemRow[]

  // Same batched p2_products lookup as receive-dispatch/sendChallanIntent —
  // product dispatch items have NULL material_name at the DB level. All
  // product items (not just those missing a name) need this for hsn_sac.
  const productIdsForLookup = [...new Set(itemRows.map((it) => it.product_id).filter(Boolean))] as string[]
  const productsById = new Map<string, { name: string | null; hsn_sac: string | null; product_code: string | null }>()
  if (productIdsForLookup.length) {
    const { data: products, error: productsError } = await supabaseClient
      .from('p2_products')
      .select('id, name, hsn_sac, product_code')
      .eq('tenant_id', tenantId)
      .in('id', productIdsForLookup)
    if (productsError) {
      return { error: 'Product details load karta aale nahi.' }
    }
    for (const p of (products ?? []) as { id: string; name: string | null; hsn_sac: string | null; product_code: string | null }[]) {
      productsById.set(p.id, { name: p.name, hsn_sac: p.hsn_sac, product_code: p.product_code })
    }
  }

  const materialIds = [...new Set(itemRows.map((it) => it.raw_material_id).filter(Boolean))] as string[]
  const materialPriceById = new Map<string, number>()
  const hsnByMaterialId = new Map<string, string | null>()
  if (materialIds.length) {
    const [{ data: prices }, { data: materials, error: materialsError }] = await Promise.all([
      supabaseClient
        .from('p2_material_prices')
        .select('raw_material_id, price_per_unit, effective_date')
        .eq('tenant_id', tenantId)
        .in('raw_material_id', materialIds)
        .order('effective_date', { ascending: false }),
      supabaseClient
        .from('p2_raw_materials')
        .select('id, hsn_sac')
        .eq('tenant_id', tenantId)
        .in('id', materialIds),
    ])
    if (materialsError) {
      return { error: 'Material details load karta aale nahi.' }
    }
    for (const p of (prices ?? []) as { raw_material_id: string; price_per_unit: number }[]) {
      if (!materialPriceById.has(p.raw_material_id)) materialPriceById.set(p.raw_material_id, p.price_per_unit)
    }
    for (const m of (materials ?? []) as { id: string; hsn_sac: string | null }[]) {
      hsnByMaterialId.set(m.id, m.hsn_sac)
    }
  }

  const productIds = [...new Set(itemRows.map((it) => it.product_id).filter(Boolean))] as string[]
  const productPriceById = new Map<string, number>()
  if (productIds.length) {
    const { data: prices } = await supabaseClient
      .from('p2_product_prices')
      .select('product_id, price, effective_date')
      .eq('tenant_id', tenantId)
      .in('product_id', productIds)
      .order('effective_date', { ascending: false })
    for (const p of (prices ?? []) as { product_id: string; price: number }[]) {
      if (!productPriceById.has(p.product_id)) productPriceById.set(p.product_id, p.price)
    }
  }

  const invoiceItems = itemRows.map((it) => {
    const product = it.product_id ? productsById.get(it.product_id) : undefined
    const qty = Number(it.qty_dispatched) || 0
    const rate = it.product_id
      ? Number(productPriceById.get(it.product_id) ?? 0)
      : it.raw_material_id
        ? Number(materialPriceById.get(it.raw_material_id) ?? 0)
        : 0
    const hsnSac = it.product_id
      ? product?.hsn_sac ?? ''
      : it.raw_material_id
        ? hsnByMaterialId.get(it.raw_material_id) ?? ''
        : ''
    // product_code is preview/edit-flow metadata only (invoices.html Step 2
    // table + item_rates keying) — stripped before anything is persisted to
    // p2_invoices.items, same as dispatch_item_id.
    const productCode = it.product_id ? product?.product_code ?? '' : it.material_code ?? ''
    return {
      dispatch_item_id: it.id,
      product_code: productCode ?? '',
      challan_number: order.challan_number,
      dispatch_date: order.dispatch_date,
      description: it.material_name ?? product?.name ?? it.material_code ?? 'Unknown Item',
      qty,
      unit: normaliseInvoiceUnit(it.unit),
      rate,
      amount: qty * rate,
      hsn_sac: hsnSac ?? '',
    }
  })

  return { items: invoiceItems }
}

// An invoice already exists for this dispatch/period — resend its link
// rather than creating a duplicate (no new insert, no invoice_sequence bump).
async function resendExistingInvoice(
  supabaseClient: ReturnType<typeof createClient>,
  tenantId: string,
  client: InvoiceClientRow,
  existing: { invoice_number: string; invoice_token: string; amount_total: number }
): Promise<SendInvoiceResult> {
  const { data: tenantSettingsRow } = await supabaseClient
    .from('p2_tenant_settings')
    .select('company_name, email')
    .eq('tenant_id', tenantId)
    .maybeSingle()

  const invoiceUrl = `https://nexflowautomations.in/invoice.html?token=${existing.invoice_token}`

  const emailResult = await sendInvoiceEmail({
    toEmail: client.email as string,
    clientName: client.name,
    invoiceNumber: existing.invoice_number,
    companyName: tenantSettingsRow?.company_name ?? '',
    total: existing.amount_total,
    replyToEmail: tenantSettingsRow?.email ?? null,
    invoiceUrl,
  })

  if (!emailResult.ok) {
    return { text: `❌ Invoice pathavayala error — ${emailResult.error}`, success: false, errorReason: emailResult.error }
  }

  return {
    text: `Invoice ${existing.invoice_number} already exists — resent to ${client.email}`,
    success: true,
    errorReason: null,
  }
}


async function logInteraction(
  supabaseClient: ReturnType<typeof createClient>,
  tenantId: string,
  message: string,
  intent: string,
  extracted: Record<string, unknown>,
  matchStatus: string | null,
  success: boolean,
  errorReason: string | null
): Promise<void> {
  try {
    await supabaseClient.from('p2_agent_logs').insert({
      tenant_id: tenantId,
      message,
      intent,
      extracted,
      match_status: matchStatus,
      success,
      error_reason: errorReason,
    })
  } catch {
    // Logging must never throw — swallow all errors silently
  }
}

// Tier 4 Phase 2 — receive.html "Auto-fill GRN". Called from a PUBLIC page,
// so unlike every other confirm_* handler in this file, recipient_tenant_id
// cannot be trusted from the body alone: it's verified against the real
// caller identity via the Authorization header (same auth.getUser(token)
// pattern used in invite-staff/index.ts and get-user-email/index.ts).
// Everything else re-fetches at write time, same discipline as the other
// confirm_* handlers above.
async function confirmReceiveGrn(
  supabaseClient: ReturnType<typeof createClient>,
  req: Request,
  body: Partial<ConfirmReceiveGrnRequest>
): Promise<Response> {
  const { dispatch_token, recipient_tenant_id, invoice_no, item_rates } = body

  if (!dispatch_token || !recipient_tenant_id) {
    return respond({ status: 'error', error: 'dispatch_token and recipient_tenant_id are required' }, 400)
  }

  const invoiceNo = typeof invoice_no === 'string' && invoice_no.trim() ? invoice_no.trim() : null

  const authHeader = req.headers.get('Authorization') ?? ''
  const token = authHeader.replace('Bearer ', '')
  const { data: { user }, error: userError } = await supabaseClient.auth.getUser(token)

  // Owner: user.id IS the tenant. Invited staff (the shopkeeper/storekeeper
  // use case this feature was built for) have their own auth uid stamped as
  // user_metadata.tenant_id instead — comparing against raw user.id here
  // rejected every non-owner caller receive.html now correctly resolves the
  // tenant for. Must stay in sync with receive.html's own resolution.
  const callerTenantId = (user?.user_metadata as { tenant_id?: string } | null)?.tenant_id || user?.id

  if (userError || !user || callerTenantId !== recipient_tenant_id) {
    return respond({ status: 'error', error: 'Unauthorized' }, 401)
  }

  const { data: order, error: orderError } = await supabaseClient
    .from('p2_dispatch_orders')
    .select('id, tenant_id, challan_number, status')
    .eq('dispatch_token', dispatch_token)
    .limit(1)
    .maybeSingle()

  if (orderError || !order || order.status !== 'confirmed') {
    return respond({ status: 'error', error: 'Delivery not found or not confirmed' }, 404)
  }

  const { data: existing, error: existingError } = await supabaseClient
    .from('p2_stock_transactions')
    .select('id')
    .eq('tenant_id', recipient_tenant_id)
    .eq('transaction_type', 'grn')
    .ilike('notes', `%dispatch_token:${dispatch_token}%`)
    .limit(1)

  if (existingError) {
    return respond({ status: 'error', error: existingError.message }, 500)
  }

  if (existing && existing.length > 0) {
    return respond({ status: 'already_done' })
  }

  const { data: senderSettings } = await supabaseClient
    .from('p2_tenant_settings')
    .select('company_name')
    .eq('tenant_id', order.tenant_id)
    .maybeSingle()

  const senderCompanyName = (senderSettings as { company_name: string | null } | null)?.company_name ?? ''

  const { data: items, error: itemsError } = await supabaseClient
    .from('p2_dispatch_items')
    .select('material_name, qty_dispatched, product_id')
    .eq('dispatch_order_id', order.id)
    .eq('tenant_id', order.tenant_id)

  if (itemsError) {
    return respond({ status: 'error', error: itemsError.message }, 500)
  }

  type ReceiveGrnItemRow = { material_name: string | null; qty_dispatched: number; product_id: string | null }
  const itemRows = (items ?? []) as ReceiveGrnItemRow[]

  // Same product-name resolution as receive-dispatch/index.ts — duplicated
  // inline since Edge Functions don't share code and that file isn't
  // touched here. Product dispatches leave material_name null at the DB
  // level; the name only exists on p2_products.
  const missingProductIds = [
    ...new Set(
      itemRows
        .filter((it) => !it.material_name && it.product_id)
        .map((it) => it.product_id as string)
    ),
  ]

  const productNameById = new Map<string, string | null>()

  if (missingProductIds.length) {
    const { data: products } = await supabaseClient
      .from('p2_products')
      .select('id, name')
      .eq('tenant_id', order.tenant_id)
      .in('id', missingProductIds)

    for (const p of (products ?? []) as { id: string; name: string | null }[]) {
      productNameById.set(p.id, p.name)
    }
  }

  const resolvedItems = itemRows.map((it) => ({
    material_name: it.material_name ?? (it.product_id ? productNameById.get(it.product_id) ?? null : null),
    qty_dispatched: it.qty_dispatched,
  }))

  // Supplier match is best-effort — no match just means supplier_id stays
  // null on the inserted rows, it never blocks the GRN.
  const { data: recipientSuppliers } = await supabaseClient
    .from('p2_suppliers')
    .select('id, name')
    .eq('tenant_id', recipient_tenant_id)
    .eq('is_active', true)

  const matchedSupplier = matchSupplierName(senderCompanyName, (recipientSuppliers ?? []) as Supplier[])

  const { data: recipientMaterials } = await supabaseClient
    .from('p2_raw_materials')
    .select('id, name, unit, min_stock_level, material_code')
    .eq('tenant_id', recipient_tenant_id)
    .eq('is_active', true)

  const matchedItems: { raw_material_id: string; quantity: number; rate: number | null }[] = []
  const unmatchedItems: string[] = []

  for (let i = 0; i < resolvedItems.length; i++) {
    const item = resolvedItems[i]
    const name = item.material_name ?? ''
    if (!name.trim()) {
      unmatchedItems.push('(unnamed item)')
      continue
    }
    // matchMaterialName treats an ambiguous match as an error too — we
    // never guess which material to credit, so ambiguous falls into
    // unmatched just like no-match.
    const matchResult = matchMaterialName(name, (recipientMaterials ?? []) as RawMaterial[])
    if ('error' in matchResult) {
      unmatchedItems.push(name)
    } else {
      const rawRate = item_rates?.[i]
      const rate = typeof rawRate === 'number' && isFinite(rawRate) && rawRate > 0 ? rawRate : null
      matchedItems.push({ raw_material_id: matchResult.material.id, quantity: item.qty_dispatched, rate })
    }
  }

  if (matchedItems.length === 0) {
    void logInteraction(supabaseClient, recipient_tenant_id, '', 'receive_grn', { dispatch_token }, 'no_match', false, 'no materials matched')
    return respond({ status: 'ok', grn_number: null, matched_count: 0, unmatched_items: unmatchedItems })
  }

  const { data: grnNo, error: grnError } = await supabaseClient
    .rpc('get_next_grn_number', { p_tenant_id: recipient_tenant_id })

  if (grnError || !grnNo) {
    void logInteraction(supabaseClient, recipient_tenant_id, '', 'receive_grn', { dispatch_token }, null, false, grnError?.message ?? 'no grn number returned')
    return respond({ status: 'error', error: grnError?.message ?? 'Could not generate GRN number' }, 500)
  }

  const today = todayIST()
  const notes = invoiceNo
    ? `Auto GRN via Nexflow receive | dispatch_token:${dispatch_token} | Challan ${order.challan_number} | Supplier: ${senderCompanyName} | Invoice: ${invoiceNo}`
    : `Auto GRN via Nexflow receive | dispatch_token:${dispatch_token} | Challan ${order.challan_number} | Supplier: ${senderCompanyName}`

  const { error: insertError } = await supabaseClient
    .from('p2_stock_transactions')
    .insert(matchedItems.map((m) => ({
      tenant_id: recipient_tenant_id,
      raw_material_id: m.raw_material_id,
      transaction_type: 'grn',
      quantity: m.quantity,
      transaction_date: today,
      notes,
      grn_no: grnNo,
      supplier_id: matchedSupplier?.id ?? null,
      supplier_name: senderCompanyName,
      rate: m.rate,
      invoice_no: invoiceNo,
      reference_id: null,
      // Item 11 (Staff Activity Log): user.id is already the verified caller
      // (extracted above via supabaseClient.auth.getUser(token) to check
      // callerTenantId === recipient_tenant_id) — reuse it rather than
      // re-deriving identity.
      created_by: user.id,
    })))

  if (insertError) {
    void logInteraction(supabaseClient, recipient_tenant_id, '', 'receive_grn', { dispatch_token, grn_no: grnNo }, null, false, insertError.message)
    return respond({ status: 'error', error: insertError.message }, 500)
  }

  void logInteraction(supabaseClient, recipient_tenant_id, '', 'receive_grn', { dispatch_token, grn_no: grnNo, matched_count: matchedItems.length }, null, true, null)

  return respond({
    status: 'ok',
    grn_number: grnNo,
    matched_count: matchedItems.length,
    unmatched_items: unmatchedItems,
  })
}

// Dispatch-page "Generate Invoice" modal (Step 4 UI) — always single-mode,
// one dispatch. Only `rate` is client-supplied per item; qty/unit/description
// are always re-fetched server-side from p2_dispatch_items here (never trust
// client-sent quantities for a billing amount). Rates are NOT resolved from
// price tables in this path — the owner has already confirmed/edited them in
// the modal (contrast buildInvoiceItemsForOrder, which does fall back to
// price-table lookups — zero if none found — for the consolidated-invoice
// flows that have no per-line rate review step).
async function confirmGenerateInvoice(
  supabaseClient: ReturnType<typeof createClient>,
  body: Partial<ConfirmGenerateInvoiceRequest>,
  callerUserId: string | null
): Promise<Response> {
  const { tenant_id, dispatch_order_id, item_rates, gst_type } = body

  if (!tenant_id || !dispatch_order_id || !item_rates?.length) {
    return respond({ status: 'error', error: 'tenant_id, dispatch_order_id, and item_rates are required' }, 400)
  }
  // rate is the one client-supplied field on this path (qty/unit/description
  // are always re-fetched server-side above/below) — `Number(x) || 0` only
  // guarded against NaN/0, not a negative or absurdly large value, which
  // would flow straight into amount/amount_total on a persisted, publicly-
  // served invoice.
  const invalidRate = item_rates.find((r) => !Number.isFinite(r.rate) || r.rate < 0)
  if (invalidRate) {
    return respond({ status: 'error', error: 'rate must be a non-negative number for every item' }, 400)
  }
  const gstType = gst_type === 'igst' || gst_type === 'none' ? gst_type : 'cgst_sgst'

  const { data: order, error: orderError } = await supabaseClient
    .from('p2_dispatch_orders')
    .select('id, challan_number, dispatch_date, client_name, status, dispatch_type, movement_purpose')
    .eq('id', dispatch_order_id)
    .eq('tenant_id', tenant_id)
    .single()

  if (orderError || !order) {
    return respond({ status: 'error', error: 'Dispatch order not found' }, 404)
  }
  if (order.status !== 'confirmed') {
    return respond({ status: 'error', error: 'Dispatch is not confirmed yet' }, 400)
  }
  if (!SALE_INVOICEABLE_PURPOSES.has(order.movement_purpose)) {
    return respond({
      status: 'error',
      error: 'This challan is a job-work movement, not a sale — a client tax invoice cannot be generated for it.',
    }, 400)
  }

  const { data: client, error: clientError } = await supabaseClient
    .from('p2_clients')
    .select('id, name, address, gstin, email')
    .eq('tenant_id', tenant_id)
    .eq('name', order.client_name)
    .maybeSingle()

  if (clientError) {
    return respond({ status: 'error', error: clientError.message }, 500)
  }
  // Client email is NOT required here — this UI path no longer emails the
  // invoice (see confirmGenerateInvoice's comment at insert time below), so
  // an invoice must be creatable regardless of whether the client has an
  // email on file. Only existence of the client record is required.
  if (!client) {
    return respond({ status: 'error', error: `${order.client_name} client record not found — check Settings > Clients` }, 404)
  }

  // App-layer duplicate guard, mirrors the DB unique index on dispatch_order_id.
  const { data: existingInvoice } = await supabaseClient
    .from('p2_invoices')
    .select('id')
    .eq('dispatch_order_id', dispatch_order_id)
    .maybeSingle()

  if (existingInvoice) {
    return respond({ status: 'error', error: 'Invoice already generated for this dispatch' }, 400)
  }

  // Cross-mode double-billing guard (reverse direction): block if this challan
  // is already inside a consolidated invoice's items jsonb snapshot. Mirrors
  // confirmConsolidatedInvoice's single-mode guard below in the opposite
  // direction — consolidated invoices have dispatch_order_id NULL, so the
  // only way to detect this challan's presence is jsonb containment on
  // items, not a dispatch_order_id match.
  if (order.challan_number) {
    const { data: consolidatedMatch, error: consolidatedMatchError } = await supabaseClient
      .from('p2_invoices')
      .select('invoice_number')
      .eq('tenant_id', tenant_id)
      .is('dispatch_order_id', null)
      .filter('items', 'cs', JSON.stringify([{ challan_number: order.challan_number }]))
      .maybeSingle()

    if (consolidatedMatchError) {
      return respond({ status: 'error', error: consolidatedMatchError.message }, 500)
    }
    if (consolidatedMatch) {
      return respond({
        status: 'error',
        error: `This challan has already been billed as part of consolidated invoice ${consolidatedMatch.invoice_number}`,
      }, 400)
    }
  }

  const { data: items, error: itemsError } = await supabaseClient
    .from('p2_dispatch_items')
    .select('id, material_name, material_code, qty_dispatched, unit, raw_material_id, product_id')
    .eq('dispatch_order_id', dispatch_order_id)
    .eq('tenant_id', tenant_id)

  if (itemsError || !items?.length) {
    return respond({ status: 'error', error: itemsError?.message ?? 'No dispatch items found' }, 400)
  }

  type ItemRow = { id: string; material_name: string | null; material_code: string | null; qty_dispatched: number; unit: string; raw_material_id: string | null; product_id: string | null }
  const itemRows = items as ItemRow[]

  // Same batched p2_products lookup as receive-dispatch/sendChallanIntent —
  // product dispatch items have NULL material_name at the DB level. All
  // product items (not just those missing a name) need this for hsn_sac.
  const productIdsForLookup = [...new Set(itemRows.map((it) => it.product_id).filter(Boolean))] as string[]
  const productsById = new Map<string, { name: string | null; hsn_sac: string | null }>()
  if (productIdsForLookup.length) {
    const { data: products, error: productsError } = await supabaseClient
      .from('p2_products')
      .select('id, name, hsn_sac')
      .eq('tenant_id', tenant_id)
      .in('id', productIdsForLookup)
    if (productsError) {
      return respond({ status: 'error', error: productsError.message }, 500)
    }
    for (const p of (products ?? []) as { id: string; name: string | null; hsn_sac: string | null }[]) {
      productsById.set(p.id, { name: p.name, hsn_sac: p.hsn_sac })
    }
  }

  const rawMaterialIdsForLookup = [...new Set(itemRows.map((it) => it.raw_material_id).filter(Boolean))] as string[]
  const hsnByMaterialId = new Map<string, string | null>()
  if (rawMaterialIdsForLookup.length) {
    const { data: materials, error: materialsError } = await supabaseClient
      .from('p2_raw_materials')
      .select('id, hsn_sac')
      .eq('tenant_id', tenant_id)
      .in('id', rawMaterialIdsForLookup)
    if (materialsError) {
      return respond({ status: 'error', error: materialsError.message }, 500)
    }
    for (const m of (materials ?? []) as { id: string; hsn_sac: string | null }[]) {
      hsnByMaterialId.set(m.id, m.hsn_sac)
    }
  }

  const rateById = new Map(item_rates.map((r) => [r.dispatch_item_id, r.rate]))

  const invoiceItems: InvoiceItem[] = itemRows.map((it) => {
    const product = it.product_id ? productsById.get(it.product_id) : undefined
    const qty = Number(it.qty_dispatched) || 0
    const rate = Number(rateById.get(it.id)) || 0
    const hsnSac = it.product_id
      ? product?.hsn_sac ?? ''
      : it.raw_material_id
        ? hsnByMaterialId.get(it.raw_material_id) ?? ''
        : ''
    return {
      challan_number: order.challan_number,
      dispatch_date: order.dispatch_date,
      description: it.material_name ?? product?.name ?? it.material_code ?? 'Unknown Item',
      qty,
      unit: normaliseInvoiceUnit(it.unit),
      rate,
      amount: qty * rate,
      hsn_sac: hsnSac ?? '',
    }
  })

  const { subtotal, gst, roundOff, total } = buildInvoiceTotals(invoiceItems, gstType)
  const docCategory = deriveDocCategory(order.dispatch_type, order.movement_purpose)
  const invoiceDate = todayIST()

  const { data: tenantSettingsRow } = await supabaseClient
    .from('p2_tenant_settings')
    .select('invoice_number_format')
    .eq('tenant_id', tenant_id)
    .maybeSingle() as { data: { invoice_number_format: string | null } | null }

  const { data: seqRows, error: invNoError } = await supabaseClient
    .rpc('get_next_invoice_number', { p_tenant_id: tenant_id })

  const seqRow = seqRows?.[0]
  if (invNoError || !seqRow) {
    void logInteraction(supabaseClient, tenant_id, '', 'send_invoice', {}, null, false, invNoError?.message ?? 'no invoice number returned')
    return respond({ status: 'error', error: invNoError?.message ?? 'Could not generate invoice number' }, 500)
  }
  const invoiceNumber = resolveInvoiceNumber(tenantSettingsRow?.invoice_number_format, seqRow)

  const { data: invoiceRow, error: insertError } = await supabaseClient
    .from('p2_invoices')
    .insert({
      tenant_id,
      invoice_number: invoiceNumber,
      invoice_date: invoiceDate,
      dispatch_order_id,
      client_id: client.id,
      client_name: client.name,
      client_address: client.address,
      client_gstin: client.gstin,
      items: invoiceItems,
      amount_subtotal: subtotal,
      amount_gst: gst,
      amount_total: total,
      round_off: roundOff,
      doc_category: docCategory,
      gst_type: gstType,
      invoice_mode: 'single',
      dispatch_order_ids: [dispatch_order_id],
      // Item 11 (Staff Activity Log): the caller's identity, already verified
      // by verifyCallerTenant() in the dispatcher above this function.
      created_by: callerUserId,
      // status left at its 'draft' default. This UI path never emails the
      // invoice — the owner reviews the link and shares it manually, or
      // sends it later via invoices.html's "Resend".
    })
    .select('invoice_token')
    .single()

  if (insertError || !invoiceRow) {
    void logInteraction(supabaseClient, tenant_id, '', 'send_invoice', {}, null, false, insertError?.message ?? 'invoice insert failed')
    return respond({ status: 'error', error: insertError?.message ?? 'Could not save invoice' }, 500)
  }

  const invoiceUrl = `https://nexflowautomations.in/invoice.html?token=${invoiceRow.invoice_token}`

  void logInteraction(supabaseClient, tenant_id, '', 'send_invoice', {}, 'matched', true, null)

  return respond({ status: 'ok', invoice_number: invoiceNumber, invoice_url: invoiceUrl, total })
}

// invoices.html "+ New Consolidated Invoice" modal, Step 1 -> Step 2 (Preview
// Line Items) — computes the same line items/totals confirmConsolidatedInvoice
// would use, without creating or emailing anything, so the owner can review
// and edit prices before confirming. Reuses confirmConsolidatedInvoice's
// exact guard sequence (client resolution, dispatch-order query, duplicate
// check, cross-mode double-billing guard) so a preview never shows line
// items for an invoice that couldn't actually be created.
async function previewConsolidatedInvoice(
  supabaseClient: ReturnType<typeof createClient>,
  body: Partial<PreviewConsolidatedInvoiceRequest>
): Promise<Response> {
  const { tenant_id, client_id, date_from, date_to, gst_type, dispatch_type } = body

  if (!tenant_id || !client_id || !date_from || !date_to || !gst_type) {
    return respond({ status: 'error', error: 'tenant_id, client_id, date_from, date_to, and gst_type are required' }, 400)
  }
  const gstType = gst_type === 'igst' || gst_type === 'none' ? gst_type : 'cgst_sgst'

  const { data: client, error: clientError } = await supabaseClient
    .from('p2_clients')
    .select('id, name')
    .eq('id', client_id)
    .eq('tenant_id', tenant_id)
    .maybeSingle()

  if (clientError) {
    return respond({ status: 'error', error: clientError.message }, 500)
  }
  if (!client) {
    return respond({ status: 'error', error: 'Client not found' }, 404)
  }

  // Item 12 (Known Open Item #6) — warn before the owner even sees line items if this
  // range overlaps another live consolidated invoice for the same client. Checked before
  // the orders query: cheapest possible early-out, and the whole point is to warn before
  // Confirm is reachable.
  const overlap = await findOverlappingConsolidatedInvoice(supabaseClient, tenant_id, client_id, date_from, date_to)
  if (overlap) {
    return respond({
      status: 'error',
      error: 'overlap',
      conflicting_invoice: overlap.invoice_number,
      conflicting_from: overlap.date_from,
      conflicting_to: overlap.date_to,
      message: `Date range overlaps with existing invoice ${overlap.invoice_number} (${fmtDdMmYyyy(overlap.date_from)} – ${fmtDdMmYyyy(overlap.date_to)})`,
    }, 400)
  }

  let ordersQuery = supabaseClient
    .from('p2_dispatch_orders')
    .select(INVOICE_ORDER_COLUMNS)
    .eq('tenant_id', tenant_id)
    .eq('client_name', client.name)
    .eq('status', 'confirmed')
    // Silently exclude job-work movements from the consolidated sweep — they
    // are never billable as a client sale. Matches confirmGenerateInvoice's
    // SALE_INVOICEABLE_PURPOSES gate on the single-invoice path, except here
    // non-matching rows are just never fetched rather than rejected, since a
    // consolidated sweep should skip ineligible dispatches, not error out.
    .in('movement_purpose', Array.from(SALE_INVOICEABLE_PURPOSES))
  if (dispatch_type === 'raw_material') {
    ordersQuery = ordersQuery.eq('dispatch_type', 'raw_material')
  } else if (dispatch_type === 'both') {
    ordersQuery = ordersQuery.in('dispatch_type', ['product', 'raw_material'])
  } else {
    // 'product', or omitted/unrecognized — default to product-only. Never skip
    // this filter: p2_dispatch_orders.dispatch_type also has a 'bom_issue'
    // value (internal production issues), which must never land on a client
    // invoice regardless of what dispatch_type the request sends.
    ordersQuery = ordersQuery.eq('dispatch_type', 'product')
  }
  const { data: orders, error: ordersError } = await ordersQuery
    .gte('dispatch_date', date_from)
    .lte('dispatch_date', date_to)
    .order('dispatch_date', { ascending: true })

  if (ordersError) {
    return respond({ status: 'error', error: ordersError.message }, 500)
  }
  if (!orders?.length) {
    return respond({ status: 'error', error: 'Ya period madhe koi confirmed dispatch nahi' }, 400)
  }

  const orderRows = orders as InvoiceOrderRow[]
  const orderIds = orderRows.map((o) => o.id)

  // Same duplicate check as confirmConsolidatedInvoice, but blocks here
  // instead of silently resending — no point previewing/editing prices for
  // an invoice that already exists. Unlike confirmConsolidatedInvoice (which
  // scopes to one consolidated_batch_seq — the specific batch it's
  // confirming), preview has no batch number yet, so this intentionally
  // checks the whole (tenant_id, client_id, date_from, date_to) range across
  // every batch. The Max Lines Per Invoice auto-split feature can legitimately
  // leave more than one p2_invoices row on that exact range (one per
  // consolidated_batch_seq), so this must NOT use .maybeSingle() — it throws
  // "JSON object requested, multiple (or no) rows returned" as soon as a
  // second batch exists.
  const { data: existingInvoices, error: existingError } = await supabaseClient
    .from('p2_invoices')
    .select('invoice_number')
    .eq('tenant_id', tenant_id)
    .eq('client_id', client_id)
    .eq('date_from', date_from)
    .eq('date_to', date_to)

  if (existingError) {
    return respond({ status: 'error', error: existingError.message }, 500)
  }
  if (existingInvoices?.length) {
    const invoiceNumbers = existingInvoices.map((i: { invoice_number: string }) => i.invoice_number).join(', ')
    return respond({
      status: 'error',
      error: `Ya client ani period sathi invoice already exists — ${invoiceNumbers}.`,
    }, 400)
  }

  // Same cross-mode double-billing guard as confirmConsolidatedInvoice.
  const { data: singleInvoices, error: singleError } = await supabaseClient
    .from('p2_invoices')
    .select('dispatch_order_id')
    .eq('invoice_mode', 'single')
    .in('dispatch_order_id', orderIds)

  if (singleError) {
    return respond({ status: 'error', error: singleError.message }, 500)
  }
  if (singleInvoices?.length) {
    const billedIds = new Set(singleInvoices.map((i: { dispatch_order_id: string | null }) => i.dispatch_order_id as string))
    const billedChallans = orderRows.filter((o) => billedIds.has(o.id)).map((o) => o.challan_number).join(', ')
    return respond({
      status: 'error',
      error: `Ya dispatches paikee kahi already individually billed aahit — ${billedChallans}. Consolidated invoice create karu nahi shaknar.`,
    }, 400)
  }

  const allItems: (InvoiceItem & { dispatch_item_id: string; product_code: string })[] = []
  for (const order of orderRows) {
    const itemsResult = await buildInvoiceItemsForOrder(supabaseClient, tenant_id, order)
    if ('error' in itemsResult) {
      return respond({ status: 'error', error: itemsResult.error }, 400)
    }
    allItems.push(...itemsResult.items)
  }

  const { subtotal, gst, roundOff, total } = buildInvoiceTotals(allItems, gstType)

  // round_off included so the preview step shows the exact same rounded
  // total confirmConsolidatedInvoice will actually persist — nothing here
  // computes totals independently of buildInvoiceTotals.
  return respond({ status: 'ok', client_name: client.name, items: allItems, subtotal, gst, round_off: roundOff, total })
}

// invoices.html "+ New Consolidated Invoice" modal, Step 2 (Confirm & Generate
// Invoice) — merges every confirmed dispatch for one client within a date
// range into one invoice. Mirrors confirmGenerateInvoice's conventions
// (respond() shape, draft-then-flip status, item_rates overrides a
// price-table default) and shares previewConsolidatedInvoice's guard
// sequence and buildInvoiceItemsForOrder for the price-table default rate.
// item_rates is optional — a missing entry (or a direct call with no
// item_rates at all) falls back to the price-table rate with zero-fallback
// (never blocks on a missing price).
async function confirmConsolidatedInvoice(
  supabaseClient: ReturnType<typeof createClient>,
  body: Partial<ConfirmConsolidatedInvoiceRequest>,
  callerUserId: string | null
): Promise<Response> {
  const { tenant_id, client_id, date_from, date_to, gst_type, dispatch_type, item_rates, consolidated_batch_seq } = body

  if (!tenant_id || !client_id || !date_from || !date_to || !gst_type) {
    return respond({ status: 'error', error: 'tenant_id, client_id, date_from, date_to, and gst_type are required' }, 400)
  }
  const gstType = gst_type === 'igst' || gst_type === 'none' ? gst_type : 'cgst_sgst'
  // 0 = normal/unsplit invoice (identical to every pre-existing call). 1..N = a split
  // batch's sequence number, sent by invoices.html when Max Lines Per Invoice is
  // exceeded — see p2_invoices_consolidated_dedup_idx.
  const batchSeq = Number.isInteger(consolidated_batch_seq) ? (consolidated_batch_seq as number) : 0

  // item_rates is optional (invoices.html's preview step always sends it; a direct
  // call without it falls back to price-table rates, same as before this field
  // existed) — same non-negative-number guard confirmGenerateInvoice applies to its
  // item_rates. When present and non-empty it is ALSO the authoritative inclusion
  // list (see includeIds below) — not just a rate override.
  if (item_rates) {
    const invalidRate = item_rates.find((r) => !Number.isFinite(r.rate) || r.rate < 0)
    if (invalidRate) {
      return respond({ status: 'error', error: 'rate must be a non-negative number for every item' }, 400)
    }
  }
  const rateById = new Map((item_rates ?? []).map((r) => [r.dispatch_item_id, r.rate]))
  // null = no filter (legacy/no item_rates sent — include everything, exactly as
  // before this change). Non-null = only these dispatch_item_ids are billed; lets the
  // caller exclude specific removed rows or send just one batch's slice.
  const includeIds = item_rates && item_rates.length ? new Set(item_rates.map((r) => r.dispatch_item_id)) : null

  // Client is resolved server-side from client_id, not trusted from the
  // request's client_name — same "never trust client input for billing"
  // posture confirmGenerateInvoice takes with item_rates' qty/description.
  const { data: client, error: clientError } = await supabaseClient
    .from('p2_clients')
    .select('id, name, address, gstin, email')
    .eq('id', client_id)
    .eq('tenant_id', tenant_id)
    .maybeSingle()

  if (clientError) {
    return respond({ status: 'error', error: clientError.message }, 500)
  }
  if (!client) {
    return respond({ status: 'error', error: 'Client not found' }, 404)
  }

  // Item 12 (Known Open Item #6) — hard block, no override. Checked before the orders
  // query and before the exact-duplicate/cross-mode guards below, so an overlapping
  // range never reaches the insert regardless of how it got here (preview bypass, direct
  // API call, etc.). Excludes exact-same-range rows (sibling Max Lines Per Invoice split
  // batches, or an idempotent retry) — see findOverlappingConsolidatedInvoice's own
  // comment for why that exclusion is safe and necessary.
  const overlap = await findOverlappingConsolidatedInvoice(supabaseClient, tenant_id, client_id, date_from, date_to)
  if (overlap) {
    return respond({
      status: 'error',
      error: 'overlap',
      conflicting_invoice: overlap.invoice_number,
      conflicting_from: overlap.date_from,
      conflicting_to: overlap.date_to,
      message: `Date range overlaps with existing invoice ${overlap.invoice_number} (${fmtDdMmYyyy(overlap.date_from)} – ${fmtDdMmYyyy(overlap.date_to)})`,
    }, 400)
  }

  let ordersQuery = supabaseClient
    .from('p2_dispatch_orders')
    .select(INVOICE_ORDER_COLUMNS)
    .eq('tenant_id', tenant_id)
    .eq('client_name', client.name)
    .eq('status', 'confirmed')
    // Silently exclude job-work movements from the consolidated sweep — they
    // are never billable as a client sale. Matches confirmGenerateInvoice's
    // SALE_INVOICEABLE_PURPOSES gate on the single-invoice path, except here
    // non-matching rows are just never fetched rather than rejected, since a
    // consolidated sweep should skip ineligible dispatches, not error out.
    .in('movement_purpose', Array.from(SALE_INVOICEABLE_PURPOSES))
  if (dispatch_type === 'raw_material') {
    ordersQuery = ordersQuery.eq('dispatch_type', 'raw_material')
  } else if (dispatch_type === 'both') {
    ordersQuery = ordersQuery.in('dispatch_type', ['product', 'raw_material'])
  } else {
    // 'product', or omitted/unrecognized — default to product-only. Never skip
    // this filter: p2_dispatch_orders.dispatch_type also has a 'bom_issue'
    // value (internal production issues), which must never land on a client
    // invoice regardless of what dispatch_type the request sends.
    ordersQuery = ordersQuery.eq('dispatch_type', 'product')
  }
  // includeIds (from item_rates) is the authoritative inclusion list when present — the UI
  // always sends it. invoices.html's Carryover Challans feature lets the owner pull in
  // dispatches outside [date_from, date_to] (e.g. a challan skipped from an earlier invoice),
  // so the date bound only applies to the legacy/no-item_rates fallback path; includeIds does
  // the real narrowing below (see the `if (includeIds && ...)` filter after buildInvoiceItemsForOrder).
  if (!includeIds) {
    ordersQuery = ordersQuery.gte('dispatch_date', date_from).lte('dispatch_date', date_to)
  }
  const { data: orders, error: ordersError } = await ordersQuery
    .order('dispatch_date', { ascending: true })

  if (ordersError) {
    return respond({ status: 'error', error: ordersError.message }, 500)
  }
  if (!orders?.length) {
    return respond({ status: 'error', error: 'Ya period madhe koi confirmed dispatch nahi' }, 400)
  }

  const orderRows = orders as InvoiceOrderRow[]

  // Consolidated duplicate check: exact tenant + client + date range + batch
  // sequence match (not an overlap check) — resend rather than recreate. Checked
  // before the cross-mode guard below, since a resend doesn't need to re-validate
  // billing state. consolidated_batch_seq is part of the match (and of
  // p2_invoices_consolidated_dedup_idx) so that a retry of ONE split batch is
  // idempotent while a DIFFERENT batch for the same date range is not mistaken for
  // a duplicate.
  const { data: existingInvoice, error: existingError } = await supabaseClient
    .from('p2_invoices')
    .select('invoice_number, invoice_token, amount_total')
    .eq('tenant_id', tenant_id)
    .eq('client_id', client_id)
    .eq('date_from', date_from)
    .eq('date_to', date_to)
    .eq('consolidated_batch_seq', batchSeq)
    .maybeSingle()

  if (existingError) {
    return respond({ status: 'error', error: existingError.message }, 500)
  }
  if (existingInvoice) {
    return respond({
      status: 'ok',
      invoice_number: existingInvoice.invoice_number,
      invoice_token: existingInvoice.invoice_token,
      invoice_url: `https://nexflowautomations.in/invoice.html?token=${existingInvoice.invoice_token}`,
      total: existingInvoice.amount_total,
      already_exists: true,
    })
  }

  const allItems: InvoiceItem[] = []
  const includedOrderIds = new Set<string>()
  for (const order of orderRows) {
    const itemsResult = await buildInvoiceItemsForOrder(supabaseClient, tenant_id, order)
    if ('error' in itemsResult) {
      return respond({ status: 'error', error: itemsResult.error }, 400)
    }
    for (const { dispatch_item_id, product_code, ...rest } of itemsResult.items) {
      // includeIds null = no filter (legacy path, include everything). Non-null =
      // only bill items the caller actually asked for — lets a removed preview row
      // or a different split batch's items be genuinely excluded, not just given a
      // default rate.
      if (includeIds && !includeIds.has(dispatch_item_id)) continue
      // Confirmed price from the preview step wins when present; otherwise
      // keep buildInvoiceItemsForOrder's price-table default.
      const rate = rateById.has(dispatch_item_id) ? Number(rateById.get(dispatch_item_id)) : rest.rate
      allItems.push({ ...rest, rate, amount: rest.qty * rate })
      includedOrderIds.add(order.id)
    }
  }

  // allItems is assembled order-by-order above, in whatever order orderRows/
  // p2_dispatch_items came back from the DB — not necessarily challan order.
  // invoices.html's preview sorts by challan_number before the owner confirms,
  // so the stored p2_invoices.items jsonb (and the printed invoice) must match
  // that same order, independent of DB query order.
  allItems.sort((a, b) => {
    const aChallan = parseInt(String(a.challan_number || '0'))
    const bChallan = parseInt(String(b.challan_number || '0'))
    return aChallan - bChallan
  })

  if (allItems.length === 0) {
    return respond({ status: 'error', error: 'No line items matched — nothing to bill.' }, 400)
  }

  // Cross-mode double-billing guard: block this invoice if any dispatch it actually
  // covers was already billed individually via a single-mode invoice. Scoped to
  // includedOrderIds (orders that contributed at least one item to THIS call), not
  // the full date-range sweep — an order excluded here (removed row, or belongs to a
  // different split batch) must not block an unrelated invoice.
  const includedOrderIdList = Array.from(includedOrderIds)
  const { data: singleInvoices, error: singleError } = await supabaseClient
    .from('p2_invoices')
    .select('dispatch_order_id')
    .eq('invoice_mode', 'single')
    .in('dispatch_order_id', includedOrderIdList)

  if (singleError) {
    return respond({ status: 'error', error: singleError.message }, 500)
  }
  if (singleInvoices?.length) {
    const billedIds = new Set(singleInvoices.map((i: { dispatch_order_id: string | null }) => i.dispatch_order_id as string))
    const billedChallans = orderRows.filter((o) => billedIds.has(o.id)).map((o) => o.challan_number).join(', ')
    return respond({
      status: 'error',
      error: `Ya dispatches paikee kahi already individually billed aahit — ${billedChallans}. Consolidated invoice create karu nahi shaknar.`,
    }, 400)
  }

  const includedOrders = orderRows.filter((o) => includedOrderIds.has(o.id))
  const { subtotal, gst, roundOff, total } = buildInvoiceTotals(allItems, gstType)
  // 'services' only if every covered dispatch is job-work/bom_issue — one
  // plain-sale dispatch in the mix defaults the whole consolidated invoice to
  // 'goods' (the stricter Rule 48(1) triplicate format), matching
  // deriveDocCategory's own "default to goods if unknown" conservatism. Scoped to
  // includedOrders, not the full sweep — an excluded order's type must not
  // influence this invoice's classification.
  const docCategory = includedOrders.every((o) => deriveDocCategory(o.dispatch_type, o.movement_purpose) === 'services')
    ? 'services'
    : 'goods'
  const invoiceDate = todayIST()

  // Fetched here (before the number is generated) rather than later, so
  // invoice_number_format is available to resolveInvoiceNumber below.
  // Reused again after the insert for the email step (company_name/email) —
  // still one query, not two.
  const { data: tenantSettingsRow } = await supabaseClient
    .from('p2_tenant_settings')
    .select('company_name, email, invoice_number_format')
    .eq('tenant_id', tenant_id)
    .maybeSingle() as { data: { company_name: string | null; email: string | null; invoice_number_format: string | null } | null }

  const { data: seqRows, error: invNoError } = await supabaseClient
    .rpc('get_next_invoice_number', { p_tenant_id: tenant_id })

  const seqRow = seqRows?.[0]
  if (invNoError || !seqRow) {
    void logInteraction(supabaseClient, tenant_id, '', 'confirm_consolidated_invoice', {}, null, false, invNoError?.message ?? 'no invoice number returned')
    return respond({ status: 'error', error: invNoError?.message ?? 'Could not generate invoice number' }, 500)
  }
  const invoiceNumber = resolveInvoiceNumber(tenantSettingsRow?.invoice_number_format, seqRow)

  const { data: invoiceRow, error: insertError } = await supabaseClient
    .from('p2_invoices')
    .insert({
      tenant_id,
      invoice_number: invoiceNumber,
      invoice_date: invoiceDate,
      dispatch_order_id: null,
      dispatch_order_ids: includedOrderIdList,
      client_id: client.id,
      client_name: client.name,
      client_address: client.address,
      client_gstin: client.gstin,
      items: allItems,
      amount_subtotal: subtotal,
      amount_gst: gst,
      amount_total: total,
      round_off: roundOff,
      doc_category: docCategory,
      gst_type: gstType,
      invoice_mode: 'consolidated',
      date_from,
      date_to,
      consolidated_batch_seq: batchSeq,
      // Item 11 (Staff Activity Log): the caller's identity, already verified
      // by verifyCallerTenant() in the dispatcher above this function.
      created_by: callerUserId,
      // status left at its 'draft' default — only flipped to 'sent' after
      // the email actually succeeds below (or skipped entirely if the
      // client has no email on file), same failure-safety as
      // confirmGenerateInvoice.
    })
    .select('invoice_token')
    .single()

  if (insertError || !invoiceRow) {
    void logInteraction(supabaseClient, tenant_id, '', 'confirm_consolidated_invoice', {}, null, false, insertError?.message ?? 'invoice insert failed')
    return respond({ status: 'error', error: insertError?.message ?? 'Could not save invoice' }, 500)
  }

  const invoiceUrl = `https://nexflowautomations.in/invoice.html?token=${invoiceRow.invoice_token}`

  if (!client.email || !client.email.trim()) {
    // No email on file — invoice still created, status stays 'draft'.
    // Recoverable later via the existing "Resend" button on invoices.html.
    void logInteraction(supabaseClient, tenant_id, '', 'confirm_consolidated_invoice', {}, 'matched', true, null)
    return respond({ status: 'ok', invoice_number: invoiceNumber, invoice_token: invoiceRow.invoice_token, invoice_url: invoiceUrl, total, already_exists: false })
  }

  const emailResult = await sendInvoiceEmail({
    toEmail: client.email,
    clientName: client.name,
    invoiceNumber,
    companyName: tenantSettingsRow?.company_name ?? '',
    total,
    replyToEmail: tenantSettingsRow?.email ?? null,
    invoiceUrl,
  })

  if (!emailResult.ok) {
    void logInteraction(supabaseClient, tenant_id, '', 'confirm_consolidated_invoice', {}, 'matched', false, emailResult.error)
    return respond({ status: 'error', error: emailResult.error }, 500)
  }

  void supabaseClient.from('p2_invoices').update({ status: 'sent' }).eq('invoice_token', invoiceRow.invoice_token)
  void logInteraction(supabaseClient, tenant_id, '', 'confirm_consolidated_invoice', {}, 'matched', true, null)

  return respond({ status: 'ok', invoice_number: invoiceNumber, invoice_token: invoiceRow.invoice_token, invoice_url: invoiceUrl, total, already_exists: false })
}

// invoices.html "Resend" button — re-sends an existing invoice's email via
// the same resendExistingInvoice() helper the Haiku message-path duplicate
// check already uses. No new p2_invoices row, no invoice_sequence bump.
async function resendInvoiceAction(
  supabaseClient: ReturnType<typeof createClient>,
  body: Partial<ResendInvoiceRequest>
): Promise<Response> {
  const { tenant_id, invoice_id } = body

  if (!tenant_id || !invoice_id) {
    return respond({ status: 'error', error: 'tenant_id and invoice_id are required' }, 400)
  }

  const { data: invoice, error: invoiceError } = await supabaseClient
    .from('p2_invoices')
    .select('id, invoice_number, invoice_token, amount_total, client_id')
    .eq('id', invoice_id)
    .eq('tenant_id', tenant_id)
    .maybeSingle()

  if (invoiceError) {
    return respond({ status: 'error', error: invoiceError.message }, 500)
  }
  if (!invoice) {
    return respond({ status: 'error', error: 'Invoice not found' }, 404)
  }

  const { data: client, error: clientError } = await supabaseClient
    .from('p2_clients')
    .select('id, name, address, gstin, email')
    .eq('id', invoice.client_id)
    .maybeSingle()

  if (clientError) {
    return respond({ status: 'error', error: clientError.message }, 500)
  }
  if (!client?.email || !client.email.trim()) {
    return respond({ status: 'error', error: `${client?.name ?? 'Client'} cha email Settings > Clients madhe add kara` }, 400)
  }

  const result = await resendExistingInvoice(supabaseClient, tenant_id, client as InvoiceClientRow, {
    invoice_number: invoice.invoice_number,
    invoice_token: invoice.invoice_token,
    amount_total: invoice.amount_total,
  })

  void logInteraction(supabaseClient, tenant_id, '', 'resend_invoice', {}, null, result.success, result.errorReason)

  if (!result.success) {
    return respond({ status: 'error', error: result.errorReason ?? 'Could not resend invoice' }, 500)
  }

  void supabaseClient.from('p2_invoices').update({ status: 'sent' }).eq('id', invoice_id)

  const invoiceUrl = `https://nexflowautomations.in/invoice.html?token=${invoice.invoice_token}`
  return respond({ status: 'ok', invoice_number: invoice.invoice_number, invoice_url: invoiceUrl })
}

// A suggested code must be 4/6/8 digits (standard HSN depth) or a 6-digit
// SAC starting '99'. Chapter (first two digits) must be a real HS chapter
// (01-97) or 99 (services). Anything else is discarded, never shown.
function isValidHsnSuggestion(code: string): boolean {
  if (!/^\d{4}$/.test(code) && !/^\d{6}$/.test(code) && !/^\d{8}$/.test(code) && !/^99\d{4}$/.test(code)) {
    return false
  }
  const chapter = parseInt(code.slice(0, 2), 10)
  return chapter === 99 || (chapter >= 1 && chapter <= 97)
}

// export.html HSN Audit — checks whether an EXISTING hsn_sac on a raw
// material or product looks correct, rather than suggesting one for a blank
// field (that's a different, not-yet-built feature — see
// enterprise-strategy.md §3.3). Clones callHaiku()'s exact low-level call
// mechanics (model, text-block extraction, ```json fence stripping) since
// the audit's system/user prompt and output shape are unrelated to the chat
// classification prompt callHaiku() itself sends.
async function auditHsnCodes(
  anthropicClient: Anthropic,
  items: SuggestHsnItem[],
  isJobWorker: boolean
): Promise<{ results: HsnAuditVerdict[] } | { error: string }> {
  const systemPrompt = 'You are a GST HSN/SAC classification expert for Indian manufacturing. Return ONLY valid JSON — no preamble, no markdown, no explanation outside the JSON structure.'

  const userPrompt = `Tenant is_job_worker: ${isJobWorker}

For each item below, evaluate whether the provided hsn_sac is a correct HSN (goods) or SAC (services) code for that material/product name and unit.

Verdict tiers:
- "correct" — the code is a plausible match for this material/product.
- "likely_wrong" — chapter mismatch or imprecise, but in the same general area.
- "definitely_wrong" — a structural error: wrong code type entirely (e.g. a product HSN on a job-work service line, a goods HSN on a service, or a completely wrong chapter with no plausible connection).

Special rule: if is_job_worker is true AND an item's kind is "product" AND its hsn_sac does NOT start with "99", the verdict MUST be "definitely_wrong" and the reason MUST say that job-work charges must use SAC 998898, not a product HSN.

Items:
${JSON.stringify(items)}

Respond with ONLY valid JSON matching exactly this shape, one entry per item id, in any order:
{ "results": [ { "id": string, "verdict": "correct" | "likely_wrong" | "definitely_wrong", "reason": string, "suggested_hsn": string | null } ] }
suggested_hsn must be populated only when verdict is "likely_wrong" or "definitely_wrong" — omit or null it for "correct".`

  try {
    const response = await anthropicClient.messages.create({
      model: 'claude-haiku-4-5',
      max_tokens: 3000,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
    })

    const textBlock = response.content.find(
      (block: { type: string; text?: string }) => block.type === 'text'
    )
    const rawText = textBlock && textBlock.type === 'text' ? textBlock.text : ''

    let cleanedText = rawText.trim()
    if (cleanedText.startsWith('```')) {
      cleanedText = cleanedText
        .replace(/^```(?:json)?\s*/, '')
        .replace(/```\s*$/, '')
        .trim()
    }

    let parsed: { results?: unknown }
    try {
      parsed = JSON.parse(cleanedText)
    } catch {
      return { error: 'Failed to parse model response' }
    }

    if (!Array.isArray(parsed.results)) {
      return { error: 'Model response missing results array' }
    }

    const byId = new Map(items.map((it) => [it.id, it]))
    const seen = new Set<string>()
    const results: HsnAuditVerdict[] = []

    for (const raw of parsed.results as Array<Record<string, unknown>>) {
      const id = typeof raw.id === 'string' ? raw.id : null
      if (!id || !byId.has(id) || seen.has(id)) continue
      seen.add(id)

      let verdict = raw.verdict
      let reason = typeof raw.reason === 'string' && raw.reason ? raw.reason : 'No reason given'
      if (verdict !== 'correct' && verdict !== 'likely_wrong' && verdict !== 'definitely_wrong') {
        verdict = 'likely_wrong'
        reason = 'Unrecognised verdict from model'
      }

      let suggestedHsn = typeof raw.suggested_hsn === 'string' ? raw.suggested_hsn.trim() : null
      if (verdict === 'correct' || !suggestedHsn || !isValidHsnSuggestion(suggestedHsn)) {
        suggestedHsn = null
      }

      results.push({ id, verdict: verdict as HsnAuditVerdict['verdict'], reason, suggested_hsn: suggestedHsn })
    }

    // Model dropped an item entirely — never silently treat a missing
    // response as 'correct'. Same conservative posture as the shape
    // validation above.
    for (const it of items) {
      if (!seen.has(it.id)) {
        results.push({ id: it.id, verdict: 'likely_wrong', reason: 'No response from model', suggested_hsn: null })
      }
    }

    return { results }
  } catch (error) {
    return { error: error instanceof Error ? error.message : 'Anthropic API request failed' }
  }
}

async function suggestHsn(
  supabaseClient: ReturnType<typeof createClient>,
  anthropicClient: Anthropic,
  body: Partial<SuggestHsnRequest>
): Promise<Response> {
  const { tenant_id, items } = body

  if (!tenant_id) {
    return respond({ status: 'error', error: 'tenant_id is required' }, 400)
  }
  if (!Array.isArray(items) || items.length === 0) {
    return respond({ status: 'error', error: 'items is required and must be a non-empty array' }, 400)
  }
  if (items.length > 25) {
    return respond({ status: 'error', error: 'Maximum 25 items per call' }, 400)
  }
  const invalidItem = items.find((it) =>
    !it || typeof it.id !== 'string' || !it.id ||
    typeof it.name !== 'string' || !it.name ||
    typeof it.unit !== 'string' || !it.unit ||
    typeof it.hsn_sac !== 'string' || !it.hsn_sac.trim() ||
    (it.kind !== 'raw_material' && it.kind !== 'product')
  )
  if (invalidItem) {
    return respond({ status: 'error', error: 'Every item requires id, name, unit, kind (raw_material|product), and a non-blank hsn_sac' }, 400)
  }

  const { data: settings } = await supabaseClient
    .from('p2_tenant_settings')
    .select('is_job_worker')
    .eq('tenant_id', tenant_id)
    .maybeSingle()
  const isJobWorker = (settings as { is_job_worker?: boolean } | null)?.is_job_worker ?? false

  const audit = await auditHsnCodes(anthropicClient, items, isJobWorker)

  if ('error' in audit) {
    void logInteraction(supabaseClient, tenant_id, '', 'hsn_audit', { item_count: items.length }, null, false, audit.error)
    return respond({ status: 'error', error: audit.error }, 500)
  }

  void logInteraction(supabaseClient, tenant_id, '', 'hsn_audit', { item_count: items.length }, null, true, null)
  return respond({ status: 'ok', results: audit.results })
}

async function submitSupportMessage(
  supabaseClient: ReturnType<typeof createClient>,
  body: Partial<SubmitSupportMessageRequest>
): Promise<Response> {
  const { tenant_id, thread_id, message, lang } = body

  if (!tenant_id) {
    return respond({ status: 'error', error: 'tenant_id is required' }, 400)
  }
  if (typeof message !== 'string' || !message.trim()) {
    return respond({ status: 'error', error: 'message is required' }, 400)
  }
  const resolvedLang: 'en' | 'mr' = lang === 'mr' ? 'mr' : 'en'

  let threadId = thread_id ?? null
  let previousStatus: string | null = null

  if (threadId) {
    const { data: existingThread, error: threadError } = await supabaseClient
      .from('p2_support_threads')
      .select('id, tenant_id, status')
      .eq('id', threadId)
      .maybeSingle()

    if (threadError) {
      return respond({ status: 'error', error: 'Failed to load thread' }, 500)
    }
    const existing = existingThread as { id: string; tenant_id: string; status: string } | null
    if (!existing || existing.tenant_id !== tenant_id) {
      return respond({ status: 'error', error: 'Thread not found' }, 400)
    }

    previousStatus = existing.status
    const { error: updateError } = await supabaseClient
      .from('p2_support_threads')
      .update({ status: 'awaiting_founder', updated_at: new Date().toISOString() })
      .eq('id', threadId)

    if (updateError) {
      return respond({ status: 'error', error: 'Failed to update thread' }, 500)
    }
  } else {
    const { data: newThread, error: insertError } = await supabaseClient
      .from('p2_support_threads')
      .insert({ tenant_id, kind: 'question', status: 'awaiting_founder', lang: resolvedLang })
      .select('id')
      .single()

    if (insertError || !newThread) {
      return respond({ status: 'error', error: 'Failed to create thread' }, 500)
    }
    threadId = (newThread as { id: string }).id
  }

  const { error: messageError } = await supabaseClient
    .from('p2_support_messages')
    .insert({ tenant_id, thread_id: threadId, role: 'client', body: message })

  if (messageError) {
    return respond({ status: 'error', error: 'Failed to save message' }, 500)
  }

  void logInteraction(supabaseClient, tenant_id, message, 'support_message', { thread_id: threadId }, null, true, null)

  // Alert only on a genuine transition into "founder needs to look at this"
  // — a brand-new thread (previousStatus === null) or a message arriving
  // after the founder already replied (previousStatus was 'awaiting_client'
  // or 'closed'). A follow-up sent while the founder still hasn't answered
  // the last one does not re-alert: the status-gate here is the anti-spam
  // mechanism, deliberately not opsAlert's own (source, dedupeKey) window —
  // that dedupe is a dumb time-window check with no notion of thread status,
  // and reusing it here would silently swallow a second legitimate
  // escalation on the same thread within the window. Protection against a
  // literal double-click belongs client-side (a double-submit guard on the
  // Send button), same as every other write form in this codebase.
  if (previousStatus !== 'awaiting_founder') {
    const { data: settingsRow } = await supabaseClient
      .from('p2_tenant_settings')
      .select('company_name')
      .eq('tenant_id', tenant_id)
      .maybeSingle()
    const companyName = (settingsRow as { company_name?: string } | null)?.company_name || 'A client'

    await opsAlert({
      source: 'support',
      severity: 'important',
      title: `Support — ${companyName}`,
      body: message,
      meta: { thread_id: threadId, tenant_id },
    })
  }

  return respond({ status: 'ok', thread_id: threadId })
}

const SUPPORT_GITHUB_REPO_OWNER = 'arjunnjadhav9-commits'
const SUPPORT_GITHUB_REPO_NAME = 'nexflow-p2'

// Duplicated from compliance-scan/index.ts's createGithubIssue rather than
// extracted into _shared/ — this is a 20-line GitHub POST, not the large,
// identically-shared dedupe/quiet-hours logic _shared/ops.ts exists for.
// Same repo, same GITHUB_TOKEN secret, different label so support bugs never
// mix with compliance/critical or compliance/important in the issue list.
async function createSupportGithubIssue(
  title: string,
  body: string
): Promise<{ issueUrl: string | null; tokenMissing: boolean; apiError: string | null }> {
  const token = Deno.env.get('GITHUB_TOKEN')
  if (!token) {
    return { issueUrl: null, tokenMissing: true, apiError: null }
  }

  try {
    const res = await fetch(`https://api.github.com/repos/${SUPPORT_GITHUB_REPO_OWNER}/${SUPPORT_GITHUB_REPO_NAME}/issues`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'Content-Type': 'application/json',
        'User-Agent': 'nexflow-agent-query-support',
      },
      body: JSON.stringify({ title, body, labels: ['support/bug'] }),
    })
    if (!res.ok) {
      const text = await res.text().catch(() => '')
      return { issueUrl: null, tokenMissing: false, apiError: `GitHub API ${res.status}: ${text.slice(0, 300)}` }
    }
    const json = await res.json()
    return { issueUrl: json.html_url ?? null, tokenMissing: false, apiError: null }
  } catch (err) {
    return { issueUrl: null, tokenMissing: false, apiError: err instanceof Error ? err.message : 'GitHub request failed' }
  }
}

async function submitBugReport(
  supabaseClient: ReturnType<typeof createClient>,
  callerUserId: string,
  body: Partial<SubmitBugReportRequest>
): Promise<Response> {
  const { tenant_id, page, action_taken, expected, actual, browser } = body

  if (!tenant_id) {
    return respond({ status: 'error', error: 'tenant_id is required' }, 400)
  }
  const fields: Record<string, unknown> = { page, action_taken, expected, actual }
  const missing = Object.entries(fields).find(([, v]) => typeof v !== 'string' || !(v as string).trim())
  if (missing) {
    return respond({ status: 'error', error: `${missing[0]} is required` }, 400)
  }

  // Role/plan resolved server-side, never trusted from the client — same
  // owner-shortcut pattern confirm_generate_invoice already uses (owner is
  // userId === tenantId and is never queried against p2_user_roles, which
  // has no row for owners).
  const role = callerUserId === tenant_id
    ? 'owner'
    : ((await supabaseClient.from('p2_user_roles').select('role').eq('user_id', callerUserId).eq('tenant_id', tenant_id).maybeSingle()).data as { role?: string } | null)?.role ?? 'unknown'

  const { data: settingsRow } = await supabaseClient
    .from('p2_tenant_settings')
    .select('company_name, plan')
    .eq('tenant_id', tenant_id)
    .maybeSingle()
  const settings = settingsRow as { company_name?: string; plan?: string } | null
  const companyName = settings?.company_name || 'A client'
  const plan = settings?.plan || 'unknown'

  const { data: newThread, error: threadError } = await supabaseClient
    .from('p2_support_threads')
    .insert({ tenant_id, kind: 'bug', status: 'awaiting_founder' })
    .select('id')
    .single()

  if (threadError || !newThread) {
    return respond({ status: 'error', error: 'Failed to create thread' }, 500)
  }
  const threadId = (newThread as { id: string }).id

  const reportText = [
    'Bug report',
    `Page: ${page}`,
    `Action: ${action_taken}`,
    `Expected: ${expected}`,
    `Actual: ${actual}`,
    `Role: ${role} · Plan: ${plan} · Browser: ${browser || 'not reported'}`,
  ].join('\n')

  const { error: messageError } = await supabaseClient
    .from('p2_support_messages')
    .insert({ tenant_id, thread_id: threadId, role: 'client', body: reportText })

  if (messageError) {
    return respond({ status: 'error', error: 'Failed to save report' }, 500)
  }

  const issueResult = await createSupportGithubIssue(
    `Bug report — ${companyName}: ${page}`,
    `${reportText}\n\nThread: ${threadId}`
  )

  if (issueResult.issueUrl) {
    await supabaseClient.from('p2_support_threads').update({ github_issue_url: issueResult.issueUrl }).eq('id', threadId)
  }

  void logInteraction(
    supabaseClient,
    tenant_id,
    reportText,
    'bug_report',
    { thread_id: threadId, github_issue_url: issueResult.issueUrl },
    null,
    !issueResult.apiError,
    issueResult.apiError
  )

  // Never lose the report if GitHub is unavailable or the token is unset —
  // same fallback compliance-scan already uses: fold the full text into the
  // opsAlert body instead of failing silently.
  const alertBody = issueResult.issueUrl
    ? `${reportText}\n\nIssue: ${issueResult.issueUrl}`
    : issueResult.tokenMissing
      ? `[GITHUB_TOKEN not set]\n${reportText}`
      : `${reportText}\n\n[GitHub issue creation failed: ${issueResult.apiError}]`

  await opsAlert({
    source: 'support',
    severity: 'important',
    title: `Bug report — ${companyName}`,
    body: alertBody,
    meta: { thread_id: threadId, tenant_id },
  })

  return respond({ status: 'ok', thread_id: threadId, github_issue_url: issueResult.issueUrl })
}

// ============================================================================
// W2 — Agent write layer: GRN photo path. The only write intent the agent has.
// §references below are to _ai/nexflow-agent.md. Three new body.action values:
// 'propose', 'confirm_proposal', 'cancel_proposal'. No new Edge Function (D1) —
// this extends agent-query exactly like suggest_hsn/submit_support_message did.
// ============================================================================

interface ProposeRequest {
  action: 'propose'
  tenant_id: string
  message?: string
  image?: string             // base64, no "data:" prefix
  image_media_type?: 'image/jpeg' | 'image/png' | 'image/webp'
  // Owner-selector amendment (js/agent-chat.js's addConfirmCard dropdown) —
  // the new owner is already known exactly, so this patches the live
  // proposal's plan directly instead of round-tripping through Haiku (see
  // the handling in proposeAction for why the free-text version of this
  // was unreliable). owned_by: null means "Own Stock".
  owner_amendment?: { owned_by: string | null }
  // W5 — client-sourced from localStorage.getItem('nexflow_lang'), same
  // pattern as SubmitSupportMessageRequest.lang. No server-side language
  // column exists or is needed (CLAUDE.md Known Open Items #24).
  lang?: 'en' | 'mr'
}

interface ConfirmProposalRequest {
  action: 'confirm_proposal'
  tenant_id: string
  proposal_id: string
  // The ONE exception to "confirm reads from the stored plan only" (§18.1
  // #3) — these two are genuinely unknown server-side at propose time when
  // a photo doesn't show the principal's own paper challan. Only used (and
  // only trusted) when the stored plan doesn't already have them; see
  // confirmProposalAction.
  principal_challan_no?: string
  principal_challan_date?: string
  lang?: 'en' | 'mr'
}

interface CancelProposalRequest {
  action: 'cancel_proposal'
  tenant_id: string
  proposal_id: string
  lang?: 'en' | 'mr'
}

// W5 — voice input, read-only (nexflow-agent.md §4.2/§16 item 10/§17 Q8).
// Client records with MediaRecorder and sends the whole clip as base64; this
// action only transcribes it and returns text — the client puts that text in
// the input box for the user to review and send themselves. There is no path
// from here into confirm_proposal/cancel_proposal.
interface TranscribeRequest {
  action: 'transcribe'
  tenant_id: string
  audio_base64: string
  audio_mime_type: string
  lang?: 'en' | 'mr'
}

type GrnBand = 'green' | 'amber'

interface GrnPlanItem {
  raw_material_id: string
  material_name: string
  material_code: string | null
  quantity: number
  unit: string
  rate: number | null
  invoice_no: string
  purchase_type: 'intrastate' | 'interstate'
  band: GrnBand
  band_reasons: string[]
}

interface GrnPlan {
  kind: 'grn'
  supplier_id: string
  supplier_name: string
  grn_date: string                  // YYYY-MM-DD, IST
  owned_by: string | null
  owner_name: string | null
  principal_challan_no: string | null
  principal_challan_date: string | null
  items: GrnPlanItem[]
  duplicate_warning: { grn_no: string; transaction_date: string; invoice_no: string } | null
}

// §4.2, verbatim. Evaluated BEFORE any model call. Marathi entries are
// // UNREVIEWED until tutorial-engine.md §8.5's read-aloud gate clears them
// with a real storekeeper (§17 Q1) — do not expand or "clean up" this list.
const GRN_AFFIRM = new Set([
  'yes', 'y', 'ok', 'okay', 'yep', 'yeah', 'yes please', 'go', 'go ahead', 'confirm', 'do it', 'done',
  'ho', 'hoy', 'होय', 'हो', 'haan', // UNREVIEWED
  'हा', // UNREVIEWED — Marathi affirmation / Hinglish filler hazard, §4.2 rule 6
  'ha', // UNREVIEWED
  'barobar', 'बरोबर', // UNREVIEWED
  'theek', 'ठीक', 'ठीक आहे', // UNREVIEWED
  'karo', 'करा', // UNREVIEWED
])
const GRN_DECLINE = new Set([
  'no', 'n', 'nope', 'cancel', 'stop', 'dont', 'don\'t',
  'nahi', 'नाही', // UNREVIEWED
  'nako', 'नको', 'naka', 'नका', // UNREVIEWED
  'rahu de', 'राहू दे', // UNREVIEWED
])

// §4.2 rule 1: normalise, then match the WHOLE message. Never substring.
function normaliseConfirmationText(s: string): string {
  return s.toLowerCase().trim().replace(/\s+/g, ' ').replace(/[.!।]+$/, '')
}

function classifyConfirmation(message: string): 'affirm' | 'decline' | null {
  const norm = normaliseConfirmationText(message)
  if (!norm) return null
  if (GRN_AFFIRM.has(norm)) return 'affirm'
  if (GRN_DECLINE.has(norm)) return 'decline'
  return null
}

// D11 role gate — direct p2_user_roles query via the service-role client
// (bypasses RLS entirely, no recursion risk), owner-shortcut. Matches the
// established, working pattern already live in confirmGenerateInvoice/
// confirmConsolidatedInvoice/submitBugReport — NOT get_my_role(), which reads
// auth.uid() internally and returns nothing from a service-role caller (see
// 20260803_get_my_role_rpc.sql; verified against the live function).
async function resolveCallerRole(
  supabaseClient: ReturnType<typeof createClient>,
  tenantId: string,
  callerUserId: string
): Promise<string> {
  if (callerUserId === tenantId) return 'owner'
  const { data } = await supabaseClient
    .from('p2_user_roles')
    .select('role')
    .eq('user_id', callerUserId)
    .eq('tenant_id', tenantId)
    .maybeSingle()
  return (data as { role?: string } | null)?.role ?? 'unknown'
}

const GRN_ALLOWED_ROLES = new Set(['owner', 'supervisor', 'storekeeper'])

// §7.3, verbatim. Two tools only, both strict: true. propose_dispatch/
// propose_production_issue/propose_invoice/propose_stock_adjustment are
// dropped along with the flows they served — never add them back (§16 items
// 16-19).
const PROPOSE_TOOLS = [
  {
    name: 'propose_grn',
    description: "Material arriving from a supplier, from a photograph of a delivery challan or invoice, or a QR-scanned delivery. Use for goods received into stock. Do NOT use for goods leaving the factory, material consumed in production, billing a client, or correcting a stock count — none of those are things you do; say so and name the page instead.",
    strict: true,
    input_schema: {
      type: 'object',
      additionalProperties: false,
      required: ['supplier_name', 'invoice_no', 'items'],
      properties: {
        supplier_name: { type: 'string', description: 'Exactly as read or said. Do not expand abbreviations.' },
        invoice_no: { type: 'string', description: 'Mandatory — the GSTR-2B matching key. Never omit or default; ask if unreadable.' },
        items: {
          type: 'array', minItems: 1,
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['material_name', 'quantity', 'unit'],
            properties: {
              material_name: { type: 'string', description: 'Name or code, as said or read.' },
              item_code: { type: 'string' },
              quantity: { type: 'number', description: 'Omit the whole item rather than guessing.' },
              unit: { type: 'string' },
              rate: { type: 'number', description: 'Omit if not stated or not legible.' },
            },
          },
        },
        grn_date: { type: 'string', description: 'YYYY-MM-DD. Only if stated or printed. Omit for today.' },
        challan_no: { type: 'string', description: "The supplier's own delivery-challan number, if separate from invoice_no." },
        purchase_type: { enum: ['intrastate', 'interstate'], description: 'Only if derivable from a known GSTIN state code. Never guess — ask if either GSTIN is missing.' },
        material_owner: { type: 'string', description: "The principal's name, if this delivery is job-work material for a known principal. Omit for own stock." },
        principal_challan_no: { type: 'string' },
        principal_challan_date: { type: 'string' },
      },
    },
  },
  {
    name: 'request_clarification',
    description: 'You are missing something you must not guess, or the message could mean two different things. Ask about everything you need in ONE call.',
    strict: true,
    input_schema: {
      type: 'object',
      additionalProperties: false,
      required: ['questions'],
      properties: {
        likely_intent: { enum: ['grn', 'unknown'] },
        // §7.3 specifies maxItems: 3 on this array — live-tested against the
        // Messages API on 18 Sept 2026 and rejected: "tools.1.custom: For
        // 'array' type, property 'maxItems' is not supported" (minItems is
        // fine; maxItems is not, at least under strict:true). The "at most
        // 3 questions" constraint is enforced code-side instead (see the
        // slice(0, 3) in proposeAction) plus the prompt's "ONE call"
        // instruction — not schema-enforced, since the schema can't express it.
        questions: {
          type: 'array', minItems: 1,
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['field', 'question'],
            properties: {
              field: { type: 'string', description: "Which field is missing, e.g. 'quantity'." },
              question: { type: 'string', description: 'One sentence, in the user\'s language.' },
              options: { type: 'array', items: { type: 'string' }, description: 'Renders as buttons. Use whenever the answer is a short closed set.' },
            },
          },
        },
      },
    },
  },
]

// §6.4, verbatim.
const EXTRACT_DELIVERY_DOCUMENT_TOOL = {
  name: 'extract_delivery_document',
  strict: true,
  input_schema: {
    type: 'object',
    additionalProperties: false,
    required: ['document_type', 'legibility', 'items'],
    properties: {
      document_type: { enum: ['delivery_challan', 'tax_invoice', 'both', 'unclear'] },
      legibility: { enum: ['clear', 'partial', 'poor'] },
      handwritten: { type: 'boolean' },
      // Not in `required` deliberately — a genuinely supplier-less document
      // should still omit this rather than guess — but live-tested 18 Sept
      // 2026: leaving this field bare (no description) produced repeated
      // omissions even on a document where the name was clearly legible and
      // separately confirmed readable via a plain-text query against the
      // same image. The description below, plus the prompt's explicit
      // "look for these four things" list above, are the fix.
      supplier_name: { type: 'string', description: "The issuing company's name, normally the largest text in the header/letterhead at the top of the page. Almost every real document has one — read it even if the rest of the page is hard to read." },
      supplier_gstin: { type: 'string' },
      invoice_no: { type: 'string' },
      challan_no: { type: 'string' },
      document_date: { type: 'string' },
      vehicle_number: { type: 'string' },
      items: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['description', 'quantity'],
          properties: {
            description: { type: 'string' },
            item_code: { type: 'string' },
            quantity: { type: 'number' },
            unit: { type: 'string' },
            rate: { type: 'number' },
            amount: { type: 'number' },
            hsn: { type: 'string' },
            // quantity/rate confidence is inherently per-line (§6.6 needs to
            // escalate individual shaky lines, not the whole document) — a
            // single line-level confidence covering both, rather than a
            // separate quantity_confidence/rate_confidence pair, since in
            // practice a line worth escalating is escalated as a whole.
            confidence: { enum: ['high', 'medium', 'low'] },
          },
        },
      },
      // §6.4's own schema literally wrote a free-form `{"...": {}}` map here
      // to mean "confidence per top-level field name" — live-tested and
      // rejected: "Empty schema ({}) that accepts any JSON value is not
      // supported. Please specify a concrete type." A JSON Schema object
      // can't express a truly dynamic key set under strict validation
      // anyway, so this enumerates the actual top-level fields that can
      // carry it (excludes items — see the per-line `confidence` above, and
      // excludes document_type/legibility/handwritten, which aren't
      // transcription reads with a plausible-alternative failure mode).
      field_confidence: {
        type: 'object',
        additionalProperties: false,
        description: 'Confidence for each field actually present; omit a field to mean high.',
        properties: {
          supplier_name: { enum: ['high', 'medium', 'low'] },
          supplier_gstin: { enum: ['high', 'medium', 'low'] },
          invoice_no: { enum: ['high', 'medium', 'low'] },
          challan_no: { enum: ['high', 'medium', 'low'] },
          document_date: { enum: ['high', 'medium', 'low'] },
          vehicle_number: { enum: ['high', 'medium', 'low'] },
        },
      },
    },
  },
}

const EXTRACTION_PROMPT = `You are reading a photograph of a supplier delivery challan or purchase invoice from an
Indian manufacturing supplier. Transcribe what is printed or written. Do not interpret,
do not convert units, do not calculate, do not correct what looks like a mistake.

Return your answer by calling extract_delivery_document exactly once.

Before you call the tool, look for these four things specifically — real delivery
challans and invoices almost always have all four, so a response missing one of them
is very likely an incomplete read, not a genuinely blank document:
1. The issuing company's name — normally the largest text at the top of the page, in a
   letterhead or header. This is supplier_name. Read it even if nothing else on the page
   is legible.
2. An invoice or challan number.
3. A date.
4. At least one line item, with a description and quantity.
Only omit one of these four if you have actually looked for it and it is genuinely not
printed anywhere on the document — never because the rest of the document was harder to
read, and never to keep your answer short.

Rules:
- Transcribe every value EXACTLY as it appears, including leading zeros, slashes and
  hyphens in document numbers. "BE/4521-A" is not "BE4521A".
- Numbers: digits only, decimal point, no thousands separators, no currency symbol.
- Dates: DD-MM-YYYY as printed. If the year is two digits, expand to 20YY. If the date
  is ambiguous between DD-MM and MM-DD, set date_confidence to "low" and transcribe what
  is printed.
- If a value is not present on the document, omit the field. Do not infer it from
  another field and do not guess a typical value.
- If a value is present but you cannot read it with confidence, include it with your
  best reading and set that field's confidence to "low".
- Do not translate Devanagari material names into English. Transcribe them as written.
- The document may have a supplier's challan number AND a separate invoice number.
  These are different. If only one number is present, put it in invoice_no and set
  invoice_no_confidence to "low".
- Ignore stamps, signatures, terms and conditions, and any printed footer.

Per-field confidence:
  "high"   — clearly printed or clearly written, no plausible alternative reading
  "medium" — legible but with a plausible alternative (5/6, 1/7, 0/8, a smudge)
  "low"    — you are guessing, or the field is partly obscured
Use "low" freely. A field marked low is shown to a human. A field wrongly marked high
is not.`

// §7.2, verbatim, with placeholders substituted. Products and Clients are
// dropped from context (§7.2) — GRN and QR interception use only Materials,
// Suppliers and the principal list.
function buildWriteSystemPrompt(opts: {
  todayIST: string
  companyName: string
  isJobWorker: boolean
  isPrincipal: boolean
  separatePool: boolean
  role: string
  materials: RawMaterial[]
  suppliers: Supplier[]
  principals: { id: string; name: string }[]
}): string {
  const materialsBlock = opts.materials.map((m) => `${m.name}${m.material_code ? ` — ${m.material_code}` : ''}`).join(', ')
  const suppliersBlock = opts.suppliers.map((s) => s.name).join(', ')
  const principalsBlock = opts.principals.map((p) => p.name).join(', ') || 'none'

  return `You are the Nexflow agent. You run a factory's inventory for them.

The person talking to you is a factory owner, supervisor, storekeeper or operator in an
MIDC engineering factory in Maharashtra. They are describing something that happened on
the floor, or something they want to happen. Your job is to turn that into exactly one
proposed transaction, or into exactly one question.

You never perform a transaction. You propose one. A human confirms it. That is the whole
contract and you must never imply otherwise — never say "done", "recorded", "I've
updated" or "saved" about something that has not been confirmed yet.

## How to respond

Call exactly one tool per message:
  propose_grn                 material arriving from a supplier
  request_clarification       you are missing something, or it could mean two things

If none of these fits — the user asked a question, or wants something you cannot do —
do not call a tool. Answer in plain text.

## Rules

1. ASK, DO NOT GUESS. If a quantity, a client, a supplier, a material or an invoice
   number is missing or could mean two things, call request_clarification. A wrong
   proposal that gets confirmed is a wrong number in a GST filing. A question costs
   five seconds. There is no situation in which guessing is the better trade.

2. USE NAMES, NOT IDS. Pass material, product, client and supplier names and codes
   exactly as the user said them. Never invent an identifier. The system matches names
   to real records itself and will tell the user if there is no match.

3. NEVER INVENT A NUMBER. If the user did not say a quantity, a rate or a date, leave
   the field out. Do not default a quantity to 1. Do not assume today's date if they
   described something that happened earlier. Do not carry a rate over from a previous
   message unless the user said to.

4. ONE TRANSACTION PER PROPOSAL. "Bharat Electricals sent copper wire and Kirloskar sent
   bearings" is two GRNs from two suppliers. Propose the first and say you will do the
   second next.

5. AMENDMENTS ARE COMPLETE. If the user changes something about a proposal you just
   made, call the same tool again with EVERY argument filled in, not only what changed.

6. YOU CANNOT CREATE MASTER DATA. You cannot add a material, product, client or
   supplier. If one is missing, say so plainly and tell them it is added in Settings.
   Do not propose a transaction that depends on something that does not exist.

7. NEVER CONFIRM ON THE USER'S BEHALF. You have no tool that executes anything. If the
   user seems to be agreeing to something, propose it again rather than assuming.

8. THINGS YOU DO NOT DO. You do not record a dispatch, generate an invoice, issue
   material for production, or adjust stock — those stay on their own pages. You do not
   cancel invoices, delete anything, create or edit master data, change settings, file
   GST returns, email anyone, or touch any month that has already been filed. If asked,
   say so in one sentence and name the page that does it.

## Language

Reply in the language the user wrote in. Most users write Marathi, Hinglish, or a mix of
Marathi and English — "Bharat Electricals kadun 50 kg copper wire ala" and "50 kg copper
wire receive zala Bharat Electricals kadun" both mean the same delivery. Understand them
all.

Keep these in Latin script even in Marathi: GST, GSTIN, HSN, SAC, ITC, CGST, SGST, IGST,
GRN, ITC-04, all document numbers, all material and product codes, and all digits. A
factory keyboard produces Latin digits and every printed invoice shows them.

Write the way a foreman talks to a colleague. Short sentences. No English business
register in a Marathi sentence, no Marathi literary register anywhere.

## Style

Never more than four lines before a tool call. The user is standing on a factory floor.

Do not explain what you are about to do before doing it. Do not restate the user's
message back to them. Do not apologise. Do not thank them. Do not offer a summary of
your capabilities unless asked.

When you refuse something, say what you cannot do and what does it instead, in one
sentence, and stop.

## Today

Today's date (IST): ${opts.todayIST}
This tenant: ${opts.companyName}
Job worker: ${opts.isJobWorker}   Principal: ${opts.isPrincipal}
Separate pool deduction: ${opts.separatePool}
The person talking to you has the role: ${opts.role}

Materials (name — code):        ${materialsBlock}
Suppliers:                      ${suppliersBlock}
Job work principals:            ${principalsBlock}`
}

// Fetches the job-work principal client list for GRN's material-owner
// resolution. The equivalent helper (getJobWorkPrincipals, Step 2M) no longer
// exists in this file — it was removed with confirmProductDispatch in the
// Aug 31 2026 redesign. Small fresh duplicate, per this codebase's own
// "small per-function duplication over cross-function coupling" convention
// (see createSupportGithubIssue's comment above).
async function resolvePrincipalClients(
  supabaseClient: ReturnType<typeof createClient>,
  tenantId: string
): Promise<{ id: string; name: string }[]> {
  const { data: settings } = await supabaseClient
    .from('p2_tenant_settings')
    .select('is_job_worker')
    .eq('tenant_id', tenantId)
    .maybeSingle()
  if (!(settings as { is_job_worker?: boolean } | null)?.is_job_worker) return []

  const { data: clients } = await supabaseClient
    .from('p2_clients')
    .select('id, name')
    .eq('tenant_id', tenantId)
    .eq('is_job_work_principal', true)
  return (clients ?? []) as { id: string; name: string }[]
}

// §6.5 candidate generation, routes 1/2/4 (exact material_code, exact
// normalised-name, matchMaterialName()'s existing fuzzy pass — reused so the
// agent and read layer never disagree about what a material name means).
// Route 3 (token-subset + numeric-token match) is not implemented as a
// separate route in this session — matchMaterialName()'s substring match
// covers the common case in the interim; a dedicated token-subset matcher is
// a follow-up once §17 Q2's real-challan bench exists to validate it against.
function normaliseForExactMatch(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, '')
}

interface MaterialCandidateResult {
  candidates: RawMaterial[]
  exactRoute: boolean   // true if the candidate(s) came from route 1 or 2
}

function findMaterialCandidates(
  materialName: string,
  itemCode: string | undefined,
  materials: RawMaterial[]
): MaterialCandidateResult {
  const normName = normaliseForExactMatch(materialName)
  const normCode = itemCode ? normaliseForExactMatch(itemCode) : null

  // Route 1: exact material_code match, either from the extracted item_code
  // field or from material_name itself (a spoken/read code with no separate
  // name, e.g. "KS4").
  const codeMatches = materials.filter((m) => {
    if (!m.material_code) return false
    const mc = normaliseForExactMatch(m.material_code)
    return (normCode && mc === normCode) || mc === normName
  })
  if (codeMatches.length === 1) return { candidates: codeMatches, exactRoute: true }

  // Route 2: normalised-name exact match.
  const nameMatches = materials.filter((m) => normaliseForExactMatch(m.name) === normName)
  if (nameMatches.length === 1) return { candidates: nameMatches, exactRoute: true }
  if (codeMatches.length > 1) return { candidates: codeMatches, exactRoute: false }
  if (nameMatches.length > 1) return { candidates: nameMatches, exactRoute: false }

  // Route 4: existing fuzzy pass, reused unchanged.
  const fuzzy = findMatches(materialName, materials)
  return { candidates: fuzzy, exactRoute: false }
}

// GSTIN state code is the first two characters. Returns null (never a
// default) if either GSTIN is missing or malformed — §5.2 step 5: "if either
// GSTIN is missing, ask — do not default."
function derivePurchaseType(tenantGstin: string | null, supplierGstin: string | null): 'intrastate' | 'interstate' | null {
  if (!tenantGstin || tenantGstin.length < 2 || !supplierGstin || supplierGstin.length < 2) return null
  return tenantGstin.slice(0, 2) === supplierGstin.slice(0, 2) ? 'intrastate' : 'interstate'
}

// §5.2 step 4 — advisory duplicate-invoice check, reusing normaliseInvoiceNo
// byte-identically with grn.html/gstr2b-reconcile.html. This is a same-transaction
// preview only, kept alongside the real DB-level backstop (trg_grn_dupe_invoice_check,
// a BEFORE INSERT trigger on p2_stock_transactions, migration
// 20260918_grn_dupe_invoice_flag.sql) so the confirmation card can warn before the
// RPC is ever called, rather than the tenant only finding out at confirm time. Skipped
// entirely by the caller when allowDuplicateGrnInvoice is true (see CLAUDE.md Known
// Open Items #1 — S.S. Engineering's coil-by-coil GRN entry would otherwise see a
// false-positive warning on every normal batch). Fails open on a query error —
// advisory only, never blocks even for a non-flagged tenant; the trigger is what
// actually blocks.
async function checkDuplicateInvoiceForAgent(
  supabaseClient: ReturnType<typeof createClient>,
  tenantId: string,
  supplierId: string,
  invoiceNo: string
): Promise<{ grn_no: string; transaction_date: string; invoice_no: string } | null> {
  const target = normaliseInvoiceNo(invoiceNo)
  if (!target) return null

  const { data, error } = await supabaseClient
    .from('p2_stock_transactions')
    .select('grn_no, invoice_no, transaction_date')
    .eq('tenant_id', tenantId)
    .eq('supplier_id', supplierId)
    .eq('transaction_type', 'grn')
    .not('invoice_no', 'is', null)

  if (error) return null
  const match = (data ?? []).find((row: { invoice_no: string | null }) => normaliseInvoiceNo(row.invoice_no) === target)
  return match as { grn_no: string; transaction_date: string; invoice_no: string } | undefined ?? null
}

type GrnResolutionResult =
  | { kind: 'plan'; plan: GrnPlan; confirmText: string; warnings: string[] }
  | { kind: 'clarification'; questions: { field: string; question: string; options?: string[] }[] }
  | { kind: 'refusal'; text: string }

// The code-side resolution §5.2 describes: matchSupplierName()/candidate
// generation (never the model), invoice_no mandatory, duplicate-invoice
// advisory, purchase_type derivation, material-owner resolution, and the
// §6.5 deterministic demotions that can only ever move green -> amber (R1a):
// unit mismatch, qty > 20x median of the material's last 20 GRNs, rate
// outside 3x/(1/3) of latest p2_material_prices, qty*rate != amount within
// ₹2, duplicate invoice_no.
async function resolveGrnPlan(
  supabaseClient: ReturnType<typeof createClient>,
  tenantId: string,
  toolInput: Record<string, unknown>,
  context: AgentContext,
  principals: { id: string; name: string }[],
  tenantGstin: string | null,
  grnDateOverride: string | null,   // photo path: extracted document_date once confirmed; null = today
  allowDuplicateGrnInvoice: boolean,   // tenant opt-out of the duplicate-invoice guard (coil-by-coil workflow)
  lang: 'en' | 'mr'   // W5 — selects which string is returned at each site below; never affects matching/banding logic
): Promise<GrnResolutionResult> {
  const questions: { field: string; question: string; options?: string[] }[] = []
  const warnings: string[] = []

  const supplierName = typeof toolInput.supplier_name === 'string' ? toolInput.supplier_name : ''
  const invoiceNo = typeof toolInput.invoice_no === 'string' ? toolInput.invoice_no.trim() : ''
  const items = Array.isArray(toolInput.items) ? toolInput.items as Record<string, unknown>[] : []

  if (!supplierName.trim()) {
    // Kept permanently (small, fire-and-forget): confirms an empty name
    // arrived here from the caller (extraction/escalation) rather than from
    // a matching failure below — the two look identical from confirm_text
    // alone. Query p2_agent_logs WHERE intent='propose_grn_diag' to inspect.
    void logInteraction(supabaseClient, tenantId, '', 'propose_grn_diag', { stage: 'resolve_supplier', result: 'empty_name' }, null, true, null)
    return { kind: 'refusal', text: lang === 'mr' ? 'या डिलिव्हरीसाठी पुरवठादाराचे नाव नाही.' : "I don't have a supplier name for this delivery." }
  }
  const supplierMatches = findMatches(supplierName, context.suppliers)
  if (supplierMatches.length === 0) {
    // Kept permanently: normalised forms on both sides, so a mismatch that
    // looks identical to the eye (trailing space, smart quote, Ltd./Limited)
    // is visible rather than guessed at.
    void logInteraction(supabaseClient, tenantId, '', 'propose_grn_diag', {
      stage: 'resolve_supplier',
      result: 'zero_matches',
      extracted_name: supplierName,
      extracted_name_normalised: supplierName.toLowerCase().trim(),
      known_suppliers_normalised: context.suppliers.map((s) => s.name.toLowerCase().trim()),
    }, null, true, null)
    return {
      kind: 'refusal',
      text: lang === 'mr'
        ? `${supplierName} नावाचा पुरवठादार सापडला नाही. Settings → Suppliers मध्ये त्यांचे GSTIN टाकून जोडा, मग मी हे GRN नोंदवू शकेन.`
        : `I don't have a supplier called ${supplierName}. Add them in Settings → Suppliers with their GSTIN, then I can record this GRN.`,
    }
  }
  if (supplierMatches.length > 1) {
    const list = supplierMatches.map((s) => s.name).join(', ')
    return {
      kind: 'refusal',
      text: lang === 'mr' ? `"${supplierName}" नेमके कोणते आहे — तुम्हाला ${list} म्हणायचे आहे का?` : `"${supplierName}" is ambiguous — did you mean ${list}?`,
    }
  }
  const supplier = supplierMatches[0]

  if (!invoiceNo) {
    questions.push({
      field: 'invoice_no',
      question: lang === 'mr' ? 'पुरवठादाराचा चलान/इनव्हॉइस क्रमांक काय आहे?' : 'What is the supplier invoice number?',
    })
  }
  if (items.length === 0) {
    return { kind: 'refusal', text: lang === 'mr' ? 'या डिलिव्हरीसाठी कोणताही माल नाही.' : "I don't have any materials for this delivery." }
  }

  // Supplier GSTIN, tenant GSTIN, latest prices, last-20-GRN medians — fetched
  // once up front rather than per item.
  const { data: supplierRow } = await supabaseClient
    .from('p2_suppliers')
    .select('gstin')
    .eq('id', supplier.id)
    .maybeSingle()
  const supplierGstin = (supplierRow as { gstin?: string } | null)?.gstin ?? null

  let purchaseType = toolInput.purchase_type === 'interstate' ? 'interstate' as const
    : toolInput.purchase_type === 'intrastate' ? 'intrastate' as const
    : derivePurchaseType(tenantGstin, supplierGstin)
  if (!purchaseType) {
    questions.push({
      field: 'purchase_type',
      question: lang === 'mr'
        ? `${supplier.name} राज्यांतर्गत की आंतरराज्य आहे हे कळत नाही — त्यांचे GSTIN Settings मध्ये नाही का?`
        : `I can't tell if ${supplier.name} is intrastate or interstate — is their GSTIN missing in Settings?`,
    })
    purchaseType = 'intrastate'   // placeholder only if there are no other blocking questions; see gating below
  }

  // Material owner (principal pool) — only asked when the tenant is a job
  // worker with at least one principal.
  let ownedBy: string | null = null
  let ownerName: string | null = null
  const materialOwnerName = typeof toolInput.material_owner === 'string' ? toolInput.material_owner.trim() : ''
  if (materialOwnerName) {
    const ownerMatch = matchClientName(materialOwnerName, principals)
    if ('error' in ownerMatch) {
      const optionsList = principals.map((p) => p.name).join(', ') || (lang === 'mr' ? 'कोणतेही कॉन्फिगर केलेले नाहीत' : 'none configured')
      questions.push({
        field: 'material_owner',
        question: lang === 'mr' ? `"${materialOwnerName}" कोणता प्रिन्सिपल आहे? पर्याय: ${optionsList}` : `Which principal is "${materialOwnerName}"? Options: ${optionsList}`,
      })
    } else {
      ownedBy = ownerMatch.client.id
      ownerName = ownerMatch.client.name
    }
  }
  // principal_challan_no/date are NEVER a blocking clarification (§0 note
  // in confirmProposalAction) — a photo frequently doesn't show the
  // principal's own paper challan number/date at all, and there's no reason
  // to stall the whole proposal over it. The confirmation card's inline
  // Principal Challan No./Date inputs (js/agent-chat.js's addConfirmCard)
  // collect them at confirm time instead; confirm_proposal patches the plan
  // with whatever's typed there before executing.
  const principalChallanNo = typeof toolInput.principal_challan_no === 'string' ? toolInput.principal_challan_no.trim() : ''
  const principalChallanDate = typeof toolInput.principal_challan_date === 'string' ? toolInput.principal_challan_date.trim() : ''

  const planItems: GrnPlanItem[] = []
  let duplicateWarning: { grn_no: string; transaction_date: string; invoice_no: string } | null = null

  for (const rawItem of items) {
    const materialName = typeof rawItem.material_name === 'string' ? rawItem.material_name : ''
    const itemCode = typeof rawItem.item_code === 'string' ? rawItem.item_code : undefined
    const quantity = typeof rawItem.quantity === 'number' ? rawItem.quantity : NaN
    const unit = typeof rawItem.unit === 'string' ? rawItem.unit : ''
    const rate = typeof rawItem.rate === 'number' ? rawItem.rate : null

    if (!materialName.trim()) {
      questions.push({
        field: 'material_name',
        question: lang === 'mr' ? 'एका ओळीत मालाचे नाव नाही — कोणता माल आहे?' : 'One line is missing a material name — which material is it?',
      })
      continue
    }
    if (!Number.isFinite(quantity) || quantity <= 0) {
      questions.push({
        field: 'quantity',
        question: lang === 'mr' ? `${materialName} किती आले?` : `How much ${materialName} arrived?`,
      })
      continue
    }

    const { candidates, exactRoute } = findMaterialCandidates(materialName, itemCode, context.materials)
    if (candidates.length === 0) {
      return {
        kind: 'refusal',
        text: lang === 'mr'
          ? `"${materialName}" नावाचा माल सापडला नाही. आधी Settings → Raw Materials मध्ये तो जोडा, किंवा स्पेलिंग तपासा.`
          : `I don't have a material called "${materialName}". Add it in Settings → Raw Materials first, or check the spelling.`,
      }
    }
    if (candidates.length > 1) {
      const list = candidates.map((c) => c.name).join(', ')
      questions.push({
        field: 'material_name',
        question: lang === 'mr' ? `"${materialName}" नेमके कोणते आहे — तुम्हाला ${list} म्हणायचे आहे का?` : `"${materialName}" is ambiguous — did you mean ${list}?`,
      })
      continue
    }
    const material = candidates[0]
    const bandReasons: string[] = []
    let band: GrnBand = exactRoute ? 'green' : 'amber'
    if (!exactRoute) bandReasons.push('fuzzy material match')

    // Deterministic demotions (R1a — can only ever move green -> amber).
    const resolvedUnit = unit || material.unit
    if (unit && unit.toLowerCase().trim() !== material.unit.toLowerCase().trim()) {
      band = 'amber'
      bandReasons.push(`unit mismatch: read "${unit}", tracked in ${material.unit}`)
    }

    const { data: recentGrns } = await supabaseClient
      .from('p2_stock_transactions')
      .select('quantity')
      .eq('tenant_id', tenantId)
      .eq('raw_material_id', material.id)
      .eq('transaction_type', 'grn')
      .order('transaction_date', { ascending: false })
      .limit(20)
    const recentQtys = ((recentGrns ?? []) as { quantity: number }[]).map((r) => Math.abs(r.quantity)).sort((a, b) => a - b)
    if (recentQtys.length >= 3) {
      const median = recentQtys[Math.floor(recentQtys.length / 2)]
      if (median > 0 && quantity > median * 20) {
        band = 'amber'
        bandReasons.push(`quantity ${quantity} is more than 20× this material's recent median (${median})`)
      }
    }

    if (rate !== null) {
      const { data: priceRows } = await supabaseClient
        .from('p2_material_prices')
        .select('price_per_unit, effective_date')
        .eq('tenant_id', tenantId)
        .eq('raw_material_id', material.id)
        .order('effective_date', { ascending: false })
        .limit(1)
      const latestPrice = (priceRows ?? [])[0] as { price_per_unit: number } | undefined
      if (latestPrice && latestPrice.price_per_unit > 0) {
        if (rate > latestPrice.price_per_unit * 3 || rate < latestPrice.price_per_unit / 3) {
          band = 'amber'
          bandReasons.push(`rate ₹${rate} is far from the last recorded rate of ₹${latestPrice.price_per_unit}`)
        }
      }
    }

    const amount = typeof rawItem.amount === 'number' ? rawItem.amount : null
    if (amount !== null && rate !== null && Math.abs(quantity * rate - amount) > 2) {
      band = 'amber'
      bandReasons.push(`quantity × rate (₹${(quantity * rate).toFixed(2)}) does not match the printed amount (₹${amount.toFixed(2)})`)
    }

    planItems.push({
      raw_material_id: material.id,
      material_name: material.name,
      material_code: material.material_code,
      quantity,
      unit: resolvedUnit,
      rate,
      invoice_no: invoiceNo,
      purchase_type: purchaseType,
      band,
      band_reasons: bandReasons,
    })
  }

  if (invoiceNo && planItems.length > 0 && !allowDuplicateGrnInvoice) {
    duplicateWarning = await checkDuplicateInvoiceForAgent(supabaseClient, tenantId, supplier.id, invoiceNo)
    if (duplicateWarning) {
      warnings.push(`Invoice ${invoiceNo} was already received under ${duplicateWarning.grn_no} on ${duplicateWarning.transaction_date}.`)
    }
  }

  // Any blocking question (missing invoice_no, ambiguous/unresolved material
  // owner, missing principal challan fields, unresolved purchase_type,
  // per-line missing name/quantity/ambiguity) stops a proposal from being
  // built at all — never a proposal with a guessed value in it.
  if (questions.length > 0 || planItems.length === 0) {
    return {
      kind: 'clarification',
      questions: questions.length > 0 ? questions : [{ field: 'items', question: lang === 'mr' ? 'कोणता माल आला?' : 'Which materials arrived?' }],
    }
  }

  for (const item of planItems) if (item.band_reasons.length) warnings.push(`${item.material_name}: ${item.band_reasons.join('; ')}`)

  const grnDate = grnDateOverride ?? todayIST()
  const plan: GrnPlan = {
    kind: 'grn',
    supplier_id: supplier.id,
    supplier_name: supplier.name,
    grn_date: grnDate,
    owned_by: ownedBy,
    owner_name: ownerName,
    principal_challan_no: ownedBy && principalChallanNo ? principalChallanNo : null,
    principal_challan_date: ownedBy && principalChallanDate ? principalChallanDate : null,
    items: planItems,
    duplicate_warning: duplicateWarning,
  }

  const confirmText = renderGrnConfirmText(plan, warnings, lang)
  return { kind: 'plan', plan, confirmText, warnings }
}

// W5 — presentation-only Marathi mapping for band_reasons/warnings strings.
// These are pre-composed English sentences with interpolated diagnostics
// (resolveGrnPlan's bandReasons.push(...) sites); translating them word for
// word would mean touching resolution-adjacent code, which is out of scope
// this session. Recognise the category by substring instead and emit the
// short Marathi label; anything unrecognised falls back to the original
// English string unchanged rather than disappearing.
function translateGrnWarning(warning: string): string {
  if (warning.includes('fuzzy material match')) return 'अंदाजे मिळालेला माल'
  if (warning.includes('unit mismatch')) return 'युनिट जुळत नाही'
  if (warning.includes('more than 20×') || warning.includes('recent median')) return 'प्रमाण असामान्यपणे जास्त'
  if (warning.includes('is far from the last recorded rate')) return 'दर अपेक्षित सीमेबाहेर'
  if (warning.includes('does not match the printed amount')) return 'रक्कम जुळत नाही'
  if (warning.includes('was already received under')) return 'डुप्लिकेट चलान असण्याची शक्यता'
  return warning
}

function renderGrnConfirmText(plan: GrnPlan, warnings: string[], lang: 'en' | 'mr' = 'en'): string {
  const lines: string[] = []
  lines.push(
    lang === 'mr'
      ? `${plan.supplier_name} कडून GRN, चलान/इनव्हॉइस ${plan.items[0]?.invoice_no ?? '—'}, ${plan.grn_date}:`
      : `GRN from ${plan.supplier_name}, invoice ${plan.items[0]?.invoice_no ?? '—'}, ${plan.grn_date}:`
  )
  for (const item of plan.items) {
    const amount = item.rate !== null ? ` = ₹${(item.quantity * item.rate).toFixed(2)}` : ''
    const rateText = item.rate !== null ? ` @ ₹${item.rate.toFixed(2)}${amount}` : ''
    const marker = item.band === 'amber' ? ' ⚠' : ''
    lines.push(`• ${item.material_name}${item.material_code ? ` [${item.material_code}]` : ''}   ${item.quantity} ${item.unit}${rateText}${marker}`)
  }
  const purchaseLabel = lang === 'mr'
    ? (plan.items[0]?.purchase_type === 'interstate' ? 'आंतरराज्य (IGST)' : 'राज्यांतर्गत (CGST+SGST)')
    : (plan.items[0]?.purchase_type === 'interstate' ? 'Interstate (IGST)' : 'Intrastate (CGST+SGST)')
  const ownerLabel = plan.owner_name ? plan.owner_name : (lang === 'mr' ? 'स्वतःचा माल' : 'Own stock')
  lines.push(`${purchaseLabel} · ${ownerLabel}`)
  // Shown so the person confirming can actually see what's in the plan
  // before approving it — free text, never validated against any Nexflow
  // record. Absent until the confirmation card's inline Principal Challan
  // No./Date inputs (js/agent-chat.js's addConfirmCard) fill them in;
  // confirm_proposal patches these onto the plan before executing (the one
  // deliberate exception to "confirm reads from the stored plan only").
  if (plan.owned_by && plan.principal_challan_no && plan.principal_challan_date) {
    lines.push(
      lang === 'mr'
        ? `प्रिन्सिपल चलान ${plan.principal_challan_no}, ${plan.principal_challan_date}`
        : `Principal challan ${plan.principal_challan_no}, ${plan.principal_challan_date}`
    )
  }
  if (warnings.length) lines.push('', ...warnings.map((w) => `⚠ ${lang === 'mr' ? translateGrnWarning(w) : w}`))
  lines.push('', lang === 'mr' ? 'GRN क्रमांक तुम्ही मंजूर केल्यावर दिला जाईल.' : 'GRN number is issued when you confirm.')
  return lines.join('\n')
}

// Text-turn tool-use call. Separate from callHaiku() — that one classifies
// intent from raw text; this one is tool use against a fixed schema (D2).
// No thinking config (§3 D5 — schema-constrained extraction has nothing to
// reason about). tool_choice is always 'auto', never 'any' — "answer in
// words" must stay reachable (D2 point 4).
//
// priorProposalText carries the live proposal's confirm_text into context for
// an amendment turn (Correction 4 — this stack has no conversation state;
// §4.3's "the model sees the prior turn" is approximated by folding the
// rendered card into the new user turn instead of a message history array).
async function callHaikuPropose(
  anthropicClient: Anthropic,
  systemPrompt: string,
  message: string,
  priorProposalText: string | null
): Promise<{ toolName: string | null; toolInput: Record<string, unknown> | null; text: string | null }> {
  const userContent = priorProposalText
    ? `Current pending proposal (not yet confirmed):\n${priorProposalText}\n\nUser's follow-up: ${message}`
    : message

  const response = await anthropicClient.messages.create({
    model: 'claude-haiku-4-5',
    max_tokens: 1500,
    system: systemPrompt,
    tools: PROPOSE_TOOLS,
    // disable_parallel_tool_use: the system prompt's own Rule ("Call exactly
    // one tool per message") was only a prompt instruction with nothing
    // structurally enforcing it — live-tested and confirmed the same failure
    // class as the extraction bug below can happen here too (the model
    // calling two tools, or the same tool twice, in one turn; code that
    // reads only the first tool_use block then silently drops whatever the
    // other one carried). Forcing at most one call removes the ambiguity
    // rather than post-hoc merging two tool calls with different names.
    tool_choice: { type: 'auto', disable_parallel_tool_use: true },
    messages: [{ role: 'user', content: userContent }],
  } as Anthropic.MessageCreateParamsNonStreaming)

  if (response.stop_reason === 'tool_use') {
    const toolBlock = response.content.find((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use')
    if (toolBlock) {
      return { toolName: toolBlock.name, toolInput: toolBlock.input as Record<string, unknown>, text: null }
    }
  }
  const textBlock = response.content.find((b): b is Anthropic.TextBlock => b.type === 'text')
  return { toolName: null, toolInput: null, text: textBlock?.text ?? null }
}

// Merges N extract_delivery_document tool calls into one object. Live-tested
// 18 Sept 2026: Sonnet 5 called this tool TWICE in a single turn on a clean,
// unambiguous synthetic tax invoice (stop_reason: 'tool_use',
// content_block_types: ['tool_use','tool_use']) — apparently splitting
// header fields (supplier_name, supplier_gstin, challan_no) into one call
// and the line-item table + invoice_no into the other. Code that reads only
// the first block (response.content.find(...)) silently drops whichever
// fields ended up in the block it didn't pick — this is what caused
// "I don't have a supplier name for this delivery" on a photo where the
// supplier name was clearly legible and correctly read. `tool_choice:
// {type:'auto', disable_parallel_tool_use:true}` on both call sites below
// is the real fix (forces at most one call, so this function's multi-block
// path should be unreachable in normal operation) — kept as defence in
// depth in case a future model/API change reintroduces parallel calls
// despite the flag.
function mergeExtractionToolBlocks(blocks: Record<string, unknown>[]): Record<string, unknown> | null {
  if (blocks.length === 0) return null
  if (blocks.length === 1) return blocks[0]
  const merged: Record<string, unknown> = {}
  for (const block of blocks) {
    for (const [key, value] of Object.entries(block)) {
      if (key === 'items') continue
      const existing = merged[key]
      const existingEmpty = existing === undefined || existing === null || existing === ''
      const valueEmpty = value === undefined || value === null || value === ''
      if (existingEmpty && !valueEmpty) merged[key] = value
    }
  }
  // The block with the most items is taken as-is (never concatenated —
  // concatenating risks duplicating a line two calls both happened to read).
  let bestItems: unknown[] = []
  for (const block of blocks) {
    const items = Array.isArray(block.items) ? block.items : []
    if (items.length > bestItems.length) bestItems = items
  }
  merged.items = bestItems
  return merged
}

// §6.4 — Sonnet 5 extraction. Vision transcribes; it does not match, decide,
// or interpret (§6.1). thinking: adaptive, no budget_tokens (rejected with a
// 400 on Sonnet 5/Opus 5). No assistant prefill anywhere in this pipeline
// (also a 400 on both models).
async function extractDeliveryDocument(
  anthropicClient: Anthropic,
  imageBase64: string,
  mediaType: string
): Promise<Record<string, unknown> | null> {
  const response = await anthropicClient.messages.create({
    model: 'claude-sonnet-5',
    max_tokens: 2048,
    thinking: { type: 'adaptive' },
    system: EXTRACTION_PROMPT,
    tools: [EXTRACT_DELIVERY_DOCUMENT_TOOL],
    // See mergeExtractionToolBlocks's comment — forces exactly one call.
    tool_choice: { type: 'auto', disable_parallel_tool_use: true },
    messages: [{
      role: 'user',
      content: [
        { type: 'image', source: { type: 'base64', media_type: mediaType, data: imageBase64 } },
        { type: 'text', text: 'Extract this delivery document.' },
      ],
    }],
  } as Anthropic.MessageCreateParamsNonStreaming)

  const toolBlocks = response.content.filter((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use')
  return mergeExtractionToolBlocks(toolBlocks.map((b) => b.input as Record<string, unknown>))
}

// §6.6 escalation — same image, reduced instruction naming only the flagged
// fields, prior reading shown. Promotes low -> medium only, NEVER to green
// (R1a) — the caller (resolveGrnPlan via the photo-path banding below) is
// responsible for keeping an escalated field at amber even on agreement.
async function escalateWithOpus(
  anthropicClient: Anthropic,
  imageBase64: string,
  mediaType: string,
  flaggedFields: string[],
  priorReading: Record<string, unknown>
): Promise<Record<string, unknown> | null> {
  const prompt = `The first reading of this document's ${flaggedFields.join(', ')} was low-confidence or failed a
consistency check. Prior reading: ${JSON.stringify(priorReading)}.
Look again at exactly these fields and confirm or correct them. Call extract_delivery_document
with your best reading of the whole document, but focus your attention on: ${flaggedFields.join(', ')}.`

  const response = await anthropicClient.messages.create({
    model: 'claude-opus-5',
    max_tokens: 2048,
    thinking: { type: 'adaptive' },
    output_config: { effort: 'medium' },
    system: EXTRACTION_PROMPT,
    tools: [EXTRACT_DELIVERY_DOCUMENT_TOOL],
    // See mergeExtractionToolBlocks's comment above extractDeliveryDocument.
    tool_choice: { type: 'auto', disable_parallel_tool_use: true },
    messages: [{
      role: 'user',
      content: [
        { type: 'image', source: { type: 'base64', media_type: mediaType, data: imageBase64 } },
        { type: 'text', text: prompt },
      ],
    }],
  } as Anthropic.MessageCreateParamsNonStreaming)

  const toolBlocks = response.content.filter((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use')
  return mergeExtractionToolBlocks(toolBlocks.map((b) => b.input as Record<string, unknown>))
}

// §6.6: escalate when ANY of — quantity/rate/invoice_no confidence < high,
// legibility partial/poor, handwritten, or a deterministic check demoted a
// qty/rate (checked after a first resolveGrnPlan() pass over the raw
// extraction, so this reads the confidence map only, before resolution).
function fieldsNeedingEscalation(extracted: Record<string, unknown>): string[] {
  const confidence = (extracted.field_confidence ?? {}) as Record<string, string>
  const flagged: string[] = []
  if (confidence.invoice_no === 'low' || confidence.invoice_no === 'medium') flagged.push('invoice_no')
  // Quantity/rate confidence lives per-line (see the tool schema's per-item
  // `confidence` field) — any non-high line escalates the whole document
  // pass, since Opus re-reads the same image regardless of which line
  // triggered it.
  const items = Array.isArray(extracted.items) ? extracted.items as Record<string, unknown>[] : []
  if (items.some((it) => it.confidence === 'low' || it.confidence === 'medium')) flagged.push('quantity', 'rate')
  if (extracted.legibility === 'partial' || extracted.legibility === 'poor') flagged.push('legibility')
  if (extracted.handwritten === true) flagged.push('handwritten')
  return flagged
}

// Converts a Sonnet/Opus extract_delivery_document tool input into a
// propose_grn-shaped object, built in code (Correction 3 — the photo path
// never makes a second Haiku call just to re-author the same tool call it
// would otherwise produce from text).
function extractedDocumentToProposeGrnInput(extracted: Record<string, unknown>): Record<string, unknown> {
  const items = Array.isArray(extracted.items) ? extracted.items as Record<string, unknown>[] : []
  return {
    supplier_name: extracted.supplier_name ?? '',
    invoice_no: extracted.invoice_no ?? '',
    grn_date: extracted.document_date,
    challan_no: extracted.challan_no,
    items: items.map((it) => ({
      material_name: it.description,
      item_code: it.item_code,
      quantity: it.quantity,
      unit: it.unit,
      rate: it.rate,
    })),
  }
}

// Meter (§10.1) — never a gate. Lazy month rollover on IST 'YYYY-MM', same
// pattern as the existing daily counter's lazy reset.
async function currentIstMonth(): Promise<string> {
  return todayIST().slice(0, 7)
}

async function bumpMonthlyAgentWrites(
  supabaseClient: ReturnType<typeof createClient>,
  tenantId: string
): Promise<void> {
  const month = await currentIstMonth()
  const { data: settings } = await supabaseClient
    .from('p2_tenant_settings')
    .select('agent_writes_this_month, agent_writes_reset_month')
    .eq('tenant_id', tenantId)
    .maybeSingle()
  const row = settings as { agent_writes_this_month?: number; agent_writes_reset_month?: string | null } | null
  const isNewMonth = row?.agent_writes_reset_month !== month
  await supabaseClient
    .from('p2_tenant_settings')
    .update({
      agent_writes_this_month: isNewMonth ? 1 : (row?.agent_writes_this_month ?? 0) + 1,
      agent_writes_reset_month: month,
    })
    .eq('tenant_id', tenantId)
}

// D10 plan gate + demo exclusion — fresh fetch, never localStorage/isPro().
// Applies ONLY to the write path (a fresh GRN proposal, photo or text) — a
// tenant with agent_write_enabled=false (the default, including for every
// existing Pro/Founder tenant post-migration) must still be able to ask
// ordinary read questions through this same endpoint. Gating reads here would
// be a silent regression of the entire read layer for every tenant until its
// owner opts in, which is not what D10 asks for.
function checkWriteGate(settings: Record<string, unknown>, lang: 'en' | 'mr' = 'en'): { ok: true } | { ok: false; reason: string } {
  if (settings.plan === 'lite') {
    return { ok: false, reason: lang === 'mr' ? 'एजंट राइट सुविधा Lite प्लॅनवर उपलब्ध नाही.' : 'The agent write layer is not available on the Lite plan.' }
  }
  if (!settings.agent_enabled) {
    return { ok: false, reason: lang === 'mr' ? 'या खात्यासाठी एजंट सुरू केलेला नाही.' : 'The agent is not enabled for this account.' }
  }
  if (!settings.agent_write_enabled) {
    return { ok: false, reason: lang === 'mr' ? 'मालकाने अजून एजंट राइट सुरू केलेले नाही — Settings → Agent मध्ये सुरू करा.' : 'The owner has not turned on agent writes yet — enable it in Settings → Agent.' }
  }
  return { ok: true }
}

async function proposeAction(
  supabaseClient: ReturnType<typeof createClient>,
  anthropicClient: Anthropic,
  req: Request,
  body: Partial<ProposeRequest>,
  callerUserId: string
): Promise<Response> {
  const { tenant_id, message, image, image_media_type } = body
  const lang: 'en' | 'mr' = body.lang === 'mr' ? 'mr' : 'en'
  if (!tenant_id) return respond({ status: 'error', error: lang === 'mr' ? 'tenant_id आवश्यक आहे.' : 'tenant_id is required' }, 400)
  const trimmedMessage = (message ?? '').trim()
  if (!trimmedMessage && !image) return respond({ status: 'error', error: lang === 'mr' ? 'संदेश किंवा फोटो आवश्यक आहे.' : 'message or image is required' }, 400)

  const { data: settingsRow } = await supabaseClient
    .from('p2_tenant_settings')
    .select('plan, agent_write_enabled, agent_enabled, is_job_worker, is_principal, separate_pool_deduction, company_name, gstin, allow_duplicate_grn_invoice')
    .eq('tenant_id', tenant_id)
    .maybeSingle()
  const settings = (settingsRow ?? {}) as Record<string, unknown>

  // Look up this user's current live proposal (the §4.2 typed-confirmation
  // path and the §4.3 amendment path both need this).
  const { data: liveProposalRow } = await supabaseClient
    .from('p2_agent_proposals')
    .select('id, confirm_text, source, plan, warnings, model_input')
    .eq('tenant_id', tenant_id)
    .eq('user_id', callerUserId)
    .eq('status', 'awaiting_confirmation')
    .maybeSingle()
  const liveProposal = liveProposalRow as {
    id: string; confirm_text: string; source: 'photo' | 'qr'
    plan: GrnPlan; warnings: string[]; model_input: Record<string, unknown>
  } | null

  // Owner-selector amendment — a direct dropdown pick, never a Haiku
  // round-trip. Folding the new owner into free text and hoping Haiku
  // reconstructs the ENTIRE propose_grn call (supplier, invoice_no, every
  // item) from just the rendered confirm_text card proved unreliable
  // live-tested 18 Sept 2026: "Owner: <name>" sometimes produced no tool
  // call at all, landing on the generic unknown-intent fallback instead of
  // an updated proposal. This patches the STORED plan's owner fields
  // directly and re-renders confirm_text with the same renderGrnConfirmText()
  // the normal path uses, so the two can never disagree on formatting.
  // Checked before AFFIRM/DECLINE and before the read pipeline — this is
  // unambiguously a write action against a specific live proposal, never a
  // read question or a plain yes/no.
  if (body.owner_amendment !== undefined) {
    if (!liveProposal) {
      return respond({ status: 'ok', intent: 'propose_grn', confirm: { status: 'refused', confirm_text: lang === 'mr' ? 'अपडेट करण्यासाठी कोणतेही पेंडिंग GRN नाही — डिलिव्हरीचा फोटो पुन्हा घ्या.' : 'No pending GRN to update — photograph the delivery again.' } })
    }

    // §4.5 rule 5 equivalent — role re-checked, not inherited, same as confirm/cancel.
    const amendRole = await resolveCallerRole(supabaseClient, tenant_id, callerUserId)
    if (!GRN_ALLOWED_ROLES.has(amendRole)) {
      return respond({ status: 'ok', intent: 'propose_grn', confirm: { status: 'refused', confirm_text: lang === 'mr' ? 'फक्त मालक, सुपरवायझर किंवा स्टोअरकीपर GRN नोंदवू शकतात.' : 'Only the owner, a supervisor or a storekeeper can record a GRN.' } })
    }
    const amendGate = checkWriteGate(settings, lang)
    if (!amendGate.ok) {
      return respond({ status: 'ok', intent: 'propose_grn', confirm: { status: 'refused', confirm_text: amendGate.reason } })
    }

    const amendPrincipals = await resolvePrincipalClients(supabaseClient, tenant_id)
    const requestedOwnedBy = body.owner_amendment.owned_by
    let newOwnedBy: string | null = null
    let newOwnerName: string | null = null
    if (requestedOwnedBy) {
      const match = amendPrincipals.find((p) => p.id === requestedOwnedBy)
      if (!match) {
        return respond({ status: 'ok', intent: 'propose_grn', confirm: { status: 'refused', confirm_text: lang === 'mr' ? 'तो प्रिन्सिपल आता उपलब्ध नाही — रिफ्रेश करून पुन्हा प्रयत्न करा.' : 'That principal is no longer available — refresh and try again.' } })
      }
      newOwnedBy = match.id
      newOwnerName = match.name
    }

    const priorPlan = liveProposal.plan
    const amendedWarnings = liveProposal.warnings ?? []
    // Keep the existing principal challan info only if it's still for the
    // SAME principal — switching away from, or to a different, principal
    // means that challan number/date no longer applies.
    const samePrincipalAsBefore = !!newOwnedBy && priorPlan.owned_by === newOwnedBy
    const amendedPlan: GrnPlan = {
      ...priorPlan,
      owned_by: newOwnedBy,
      owner_name: newOwnerName,
      principal_challan_no: samePrincipalAsBefore ? priorPlan.principal_challan_no : null,
      principal_challan_date: samePrincipalAsBefore ? priorPlan.principal_challan_date : null,
    }

    // Principal challan number/date are never required to finalize an
    // owner amendment — if this proposal doesn't already have them (e.g.
    // switching to a principal the document didn't have that info for, or
    // switching away from one), the confirmation card's inline Principal
    // Challan No./Date inputs (js/agent-chat.js's addConfirmCard) collect
    // them at confirm time instead. No chat clarification turn at all.
    const amendedConfirmText = renderGrnConfirmText(amendedPlan, amendedWarnings, lang)
    await supabaseClient.from('p2_agent_proposals').update({ status: 'superseded', updated_at: new Date().toISOString() }).eq('id', liveProposal.id)

    const amendedProposalId = crypto.randomUUID()
    const amendedExpiresAt = new Date(Date.now() + 15 * 60000).toISOString()
    const { error: amendInsertError } = await supabaseClient.from('p2_agent_proposals').insert({
      id: amendedProposalId,
      tenant_id,
      user_id: callerUserId,
      kind: 'grn',
      status: 'awaiting_confirmation',
      model_input: liveProposal.model_input ?? {},
      plan: amendedPlan,
      confirm_text: amendedConfirmText,
      warnings: amendedWarnings,
      source: liveProposal.source,
      model_used: 'deterministic',
      escalated: false,
      expires_at: amendedExpiresAt,
    })
    if (amendInsertError && amendInsertError.code !== '23505') {
      void logInteraction(supabaseClient, tenant_id, trimmedMessage, 'propose_grn', { owner_amendment: body.owner_amendment }, null, false, amendInsertError.message)
      return respond({ status: 'error', error: amendInsertError.message }, 500)
    }

    void logInteraction(supabaseClient, tenant_id, trimmedMessage, 'propose_grn', { owner_amendment: body.owner_amendment }, 'matched', true, null)
    return respond({
      status: 'ok',
      intent: 'propose_grn',
      proposal_id: amendedProposalId,
      expires_at: amendedExpiresAt,
      confirm: { status: 'ready', confirm_text: amendedConfirmText },
      is_job_worker: !!settings.is_job_worker,
      principals: amendPrincipals.map((p) => ({ id: p.id, name: p.name })),
      owned_by: amendedPlan.owned_by,
      owner_name: amendedPlan.owner_name,
      principal_challan_no: amendedPlan.principal_challan_no,
      principal_challan_date: amendedPlan.principal_challan_date,
    })
  }

  // §4.2 — AFFIRM/DECLINE, evaluated before any model call and before any
  // write gate (confirm/cancel re-validate their own role at §4.5 rule 5;
  // the plan-enablement gate belongs at proposal CREATION time only — once a
  // proposal exists, turning the flag off mid-flight doesn't retroactively
  // invalidate it, matching §4.5's own re-validation list, which does not
  // include re-checking agent_write_enabled). Only when exactly one proposal
  // is live — a match short-circuits straight to confirm/cancel.
  if (!image && trimmedMessage && liveProposal) {
    const classification = classifyConfirmation(trimmedMessage)
    if (classification === 'affirm') {
      return await confirmProposalAction(supabaseClient, { tenant_id, proposal_id: liveProposal.id, lang }, callerUserId)
    }
    if (classification === 'decline') {
      return await cancelProposalAction(supabaseClient, { tenant_id, proposal_id: liveProposal.id, lang }, callerUserId)
    }
  }

  const context = await buildContext(supabaseClient, tenant_id)
  if ('error' in context) return respond({ status: 'error', error: context.error }, 500)
  const principals = await resolvePrincipalClients(supabaseClient, tenant_id)

  // Text, no image: try the read pipeline BEFORE any write gate, regardless
  // of whether a proposal is currently live — a pending GRN must never block
  // an unrelated read question, and reads have no role/plan restriction
  // today. Only once this returns null (not a recognised read intent) do the
  // D11/D10 write gates apply, right before the write-tool-use call. The
  // daily read quota governs this attempt only (§0 C4); the write layer's
  // monthly meter is separate and is never checked here.
  if (!image && trimmedMessage) {
    const usage = await checkAndIncrementUsage(supabaseClient, tenant_id)
    if (!usage.allowed) return respond({ status: 'error', error: usage.error }, 429)
    const readResponse = await tryReadClassification(supabaseClient, anthropicClient, tenant_id, trimmedMessage, context)
    if (readResponse) return readResponse
  }

  // D11 role gate — before any WRITE-attempting model call (§18.3 #17).
  const role = await resolveCallerRole(supabaseClient, tenant_id, callerUserId)
  if (!GRN_ALLOWED_ROLES.has(role)) {
    void logInteraction(supabaseClient, tenant_id, trimmedMessage, 'propose_grn', {}, null, false, 'role_denied')
    return respond({ status: 'ok', intent: 'propose_grn', confirm: { status: 'refused', confirm_text: lang === 'mr' ? 'फक्त मालक, सुपरवायझर किंवा स्टोअरकीपर GRN नोंदवू शकतात.' : 'Only the owner, a supervisor or a storekeeper can record a GRN.' } })
  }

  // D10 plan gate — before any WRITE-attempting model call.
  const gate = checkWriteGate(settings, lang)
  if (!gate.ok) {
    void logInteraction(supabaseClient, tenant_id, trimmedMessage, 'propose_grn', {}, null, false, 'write_gate_denied')
    return respond({ status: 'ok', intent: 'propose_grn', confirm: { status: 'refused', confirm_text: gate.reason } })
  }

  let toolName: string | null = null
  let toolInput: Record<string, unknown> | null = null
  let plainText: string | null = null
  let modelUsed = 'claude-haiku-4-5'
  let escalated = false
  const imagePaths: string[] = []
  const proposalId = crypto.randomUUID()

  if (image) {
    // Photo path (§6) — bypasses Haiku entirely (Correction 3). Upload first
    // so the path can include the pre-generated proposal id (Correction 5).
    const mediaType = image_media_type ?? 'image/jpeg'
    const uploadPath = `${tenant_id}/${proposalId}/1.jpg`
    const bytes = Uint8Array.from(atob(image), (c) => c.charCodeAt(0))
    const { error: uploadError } = await supabaseClient.storage
      .from('agent-uploads')
      .upload(uploadPath, bytes, { contentType: mediaType })
    if (!uploadError) imagePaths.push(uploadPath)

    let extracted = await extractDeliveryDocument(anthropicClient, image, mediaType)
    modelUsed = 'claude-sonnet-5'
    if (!extracted) {
      void logInteraction(supabaseClient, tenant_id, trimmedMessage, 'propose_grn', {}, null, false, 'extraction_failed')
      return respond({ status: 'ok', intent: 'propose_grn', confirm: { status: 'refused', confirm_text: lang === 'mr' ? 'हा फोटो वाचता आला नाही. जास्त उजेडात पुन्हा प्रयत्न करा, किंवा GRN पेज वापरा.' : "I can't read this photo. Try again with more light, or use the GRN page." } })
    }

    const flagged = fieldsNeedingEscalation(extracted)
    if (flagged.length > 0) {
      const escalatedReading = await escalateWithOpus(anthropicClient, image, mediaType, flagged, extracted)
      escalated = true
      modelUsed = 'claude-opus-5'
      if (escalatedReading) {
        // Merge, don't replace: the escalation prompt asks the model to
        // "focus attention on" specific fields, and a model taking that
        // literally can return a minimal object that omits everything else
        // it isn't being asked about (supplier_name included) — a prior bug
        // report showed exactly this: a clean SKF Bearings India invoice
        // lost its supplier_name after escalation triggered on an unrelated
        // field. Prefer escalatedReading's own keys (it's the more careful
        // second read for whatever it does return), but fall back to the
        // original extraction for anything escalatedReading left out. items
        // is handled separately: only trust escalatedReading's array if it's
        // the same length as the original — a shorter array is far more
        // likely to be a narrowed subset (dropped lines) than a genuine
        // re-count, and silently dropping a real line is worse than keeping
        // a possibly-stale one (which still goes through §6.5's own
        // deterministic re-validation downstream).
        const originalItems = Array.isArray(extracted.items) ? extracted.items : []
        const escalatedItems = Array.isArray(escalatedReading.items) ? escalatedReading.items : []
        const mergedItems = escalatedItems.length > 0 && escalatedItems.length === originalItems.length
          ? escalatedItems
          : originalItems
        extracted = { ...extracted, ...escalatedReading, items: mergedItems }
      }
      // R1a: escalation can promote low -> medium, never -> green. The
      // banding in resolveGrnPlan() only ever assigns green via an EXACT
      // material-code/name route with high field confidence, so an escalated
      // (still non-high) confidence field can never reach green regardless —
      // structural, not a flag that could be flipped.
    }

    toolInput = extractedDocumentToProposeGrnInput(extracted)
    toolName = 'propose_grn'
  } else {
    // Text-only turn, not a recognised read intent (checked above) — try the
    // write-tool-use path. Fresh (non-amendment) GRN descriptions in plain
    // text are refused below
    // (§5.2 — photo only for a new GRN); this path exists for amendments to
    // a live photo-derived proposal, clarification answers, and everything
    // else Haiku might reasonably say plain text about.
    const systemPrompt = buildWriteSystemPrompt({
      todayIST: todayIST(),
      companyName: (settings.company_name as string) ?? '',
      isJobWorker: !!settings.is_job_worker,
      isPrincipal: !!settings.is_principal,
      separatePool: !!settings.separate_pool_deduction,
      role,
      materials: context.materials,
      suppliers: context.suppliers,
      principals,
    })
    const haikuResult = await callHaikuPropose(anthropicClient, systemPrompt, trimmedMessage, liveProposal?.confirm_text ?? null)
    toolName = haikuResult.toolName
    toolInput = haikuResult.toolInput
    plainText = haikuResult.text

    const looksLikeFreshGrnAttempt = toolName === 'propose_grn' ||
      (toolName === 'request_clarification' && toolInput?.likely_intent === 'grn')
    if (looksLikeFreshGrnAttempt && !liveProposal) {
      // §5.2 — the typed GRN text path is dropped; a fresh (non-amendment)
      // text description is routed to the form, never resolved — whether
      // Haiku would have called propose_grn directly or needed to ask a
      // clarifying question first (likely_intent: 'grn' on
      // request_clarification exists in the §7.3 schema for exactly this:
      // live-tested 18 Sept 2026, a message like "50 kg copper wire from X
      // invoice Y" with an ambiguous material name made Haiku call
      // request_clarification instead of propose_grn — that's still a text
      // GRN attempt and must redirect the same way, not fall through to a
      // resolved clarification question).
      void logInteraction(supabaseClient, tenant_id, trimmedMessage, 'propose_grn', {}, null, false, 'text_path_dropped')
      return respond({ status: 'ok', intent: 'propose_grn', confirm: { status: 'refused', confirm_text: lang === 'mr' ? 'डिलिव्हरी चलानाचा फोटो घ्या, मी तो वाचेन — टाइप केलेले GRN तपशील GRN पेजवर टाका.' : 'Photograph the delivery challan and I\'ll read it — typed GRN details go on the GRN page instead.' } })
    }
  }

  if (toolName === 'request_clarification' && toolInput) {
    // §7.3's maxItems: 3 isn't schema-enforceable (see the tool definition's
    // comment) — enforced here instead.
    const questions = ((toolInput.questions ?? []) as { field: string; question: string; options?: string[] }[]).slice(0, 3)
    void logInteraction(supabaseClient, tenant_id, trimmedMessage, 'request_clarification', toolInput, null, true, null)
    return respond({ status: 'ok', intent: 'request_clarification', confirm: { status: 'question', confirm_text: questions.map((q) => q.question).join(' '), questions } })
  }

  if (toolName !== 'propose_grn' || !toolInput) {
    void logInteraction(supabaseClient, tenant_id, trimmedMessage, 'unknown', {}, null, true, null)
    return respond({ status: 'ok', intent: 'unknown', confirm: { status: 'ready', confirm_text: plainText ?? (lang === 'mr' ? 'त्याबद्दल माहिती नाही.' : "I don't have information on that.") } })
  }

  const resolution = await resolveGrnPlan(
    supabaseClient, tenant_id, toolInput, context, principals,
    (settings.gstin as string) ?? null,
    typeof toolInput.grn_date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(toolInput.grn_date) ? toolInput.grn_date : null,
    !!settings.allow_duplicate_grn_invoice,
    lang
  )

  if (resolution.kind === 'refusal') {
    void logInteraction(supabaseClient, tenant_id, trimmedMessage, 'propose_grn', toolInput, null, false, resolution.text)
    return respond({ status: 'ok', intent: 'propose_grn', confirm: { status: 'refused', confirm_text: resolution.text } })
  }
  if (resolution.kind === 'clarification') {
    // If this clarification came from amending a live proposal (e.g. the
    // owner selector switching to a principal, which then needs a challan
    // number/date the document didn't have), that proposal is now KNOWN
    // stale — the human just said something that contradicts its stored
    // plan. Leaving it confirmable would let a tap on the old card silently
    // write the pre-amendment version (e.g. "own stock") after the human
    // explicitly said otherwise. Supersede it; the clarification's own
    // answer becomes a fresh amendment with no live proposal to fold in,
    // same as any other first-time answer.
    if (liveProposal) {
      await supabaseClient.from('p2_agent_proposals').update({ status: 'superseded', updated_at: new Date().toISOString() }).eq('id', liveProposal.id)
    }
    void logInteraction(supabaseClient, tenant_id, trimmedMessage, 'propose_grn', toolInput, null, true, null)
    return respond({ status: 'ok', intent: 'request_clarification', confirm: { status: 'question', confirm_text: resolution.questions.map((q) => q.question).join(' '), questions: resolution.questions }, superseded_proposal_id: liveProposal?.id ?? null })
  }

  // Store the proposal. supersede any existing live one for this user first —
  // the unique index (tenant_id, user_id) WHERE status='awaiting_confirmation'
  // enforces "exactly one live proposal" even under a race; catch a violation
  // as a benign supersede rather than a hard error.
  if (liveProposal) {
    await supabaseClient.from('p2_agent_proposals').update({ status: 'superseded', updated_at: new Date().toISOString() }).eq('id', liveProposal.id)
  }

  // §8.1: source is 'photo' or 'qr' only ('text' was deliberately dropped —
  // a typed amendment doesn't change a proposal's origin). A fresh image
  // turn is 'photo'; a text amendment to a live proposal inherits that
  // proposal's own source; there is no third case reaching this line (a
  // fresh, non-amendment text GRN attempt was already refused above).
  const source: 'photo' | 'qr' = image ? 'photo' : liveProposal?.source ?? 'photo'
  const expiresAt = new Date(Date.now() + 15 * 60000).toISOString()

  const { error: insertError } = await supabaseClient.from('p2_agent_proposals').insert({
    id: proposalId,
    tenant_id,
    user_id: callerUserId,
    kind: 'grn',
    status: 'awaiting_confirmation',
    model_input: toolInput,
    plan: resolution.plan,
    confirm_text: resolution.confirmText,
    warnings: resolution.warnings,
    source,
    image_paths: imagePaths.length ? imagePaths : null,
    model_used: modelUsed,
    escalated,
    expires_at: expiresAt,
  })

  if (insertError) {
    // A unique-violation here means a concurrent propose won the race —
    // benign, not a failure worth surfacing as an error.
    if (insertError.code !== '23505') {
      void logInteraction(supabaseClient, tenant_id, trimmedMessage, 'propose_grn', toolInput, null, false, insertError.message)
      return respond({ status: 'error', error: insertError.message }, 500)
    }
  }

  void logInteraction(supabaseClient, tenant_id, trimmedMessage, 'propose_grn', toolInput, 'matched', true, null)
  return respond({
    status: 'ok',
    intent: 'propose_grn',
    proposal_id: proposalId,
    expires_at: expiresAt,
    confirm: { status: 'ready', confirm_text: resolution.confirmText },
    // Lets the card offer an Own Stock / Principal selector — only when the
    // tenant actually has that dimension. Never asked for a non-job-worker
    // tenant (D11/§5.2 step 6: "own stock" is the only concept it has).
    // owned_by/owner_name are the plan's RESOLVED value (from the document or
    // defaulted to own stock) so the selector can default to what will
    // actually be written, not force every job-worker photo through an
    // extra tap when the document already said whose material it is.
    is_job_worker: !!settings.is_job_worker,
    principals: principals.map((p) => ({ id: p.id, name: p.name })),
    owned_by: resolution.plan.owned_by,
    owner_name: resolution.plan.owner_name,
    // Pre-fills the card's inline Principal Challan No./Date inputs when
    // the document already had them legibly — null otherwise, leaving
    // those inputs blank (and Confirm disabled) until typed in.
    principal_challan_no: resolution.plan.principal_challan_no,
    principal_challan_date: resolution.plan.principal_challan_date,
  })
}

// confirm_proposal — ZERO model calls, by construction (no
// anthropicClient/anthropic.messages.create anywhere in this function or
// anything it calls). §3 D2, §18.1 #2.
async function confirmProposalAction(
  supabaseClient: ReturnType<typeof createClient>,
  body: Partial<ConfirmProposalRequest>,
  callerUserId: string
): Promise<Response> {
  const { tenant_id, proposal_id } = body
  const lang: 'en' | 'mr' = body.lang === 'mr' ? 'mr' : 'en'
  if (!tenant_id || !proposal_id) return respond({ status: 'error', error: lang === 'mr' ? 'tenant_id आणि proposal_id आवश्यक आहेत.' : 'tenant_id and proposal_id are required' }, 400)

  const { data: proposalRow, error: fetchError } = await supabaseClient
    .from('p2_agent_proposals')
    .select('*')
    .eq('id', proposal_id)
    .eq('tenant_id', tenant_id)
    .maybeSingle()

  if (fetchError) return respond({ status: 'error', error: fetchError.message }, 500)
  if (!proposalRow) return respond({ status: 'error', error: lang === 'mr' ? 'प्रपोजल सापडले नाही.' : 'Proposal not found.' }, 404)

  type ProposalRow = {
    id: string; user_id: string; status: string; plan: GrnPlan; expires_at: string
    confirm_text: string; warnings: string[]
  }
  const proposal = proposalRow as ProposalRow

  // §4.5 rule 2 — same user only. A supervisor cannot confirm an operator's...
  // wait, only owner/supervisor/storekeeper ever raise a proposal (D11), but
  // the rule is symmetric regardless of who raised it.
  if (proposal.user_id !== callerUserId) {
    return respond({ status: 'ok', confirm: { status: 'refused', confirm_text: lang === 'mr' ? 'हे दुसऱ्या युजरने सुरू केले आहे — त्यांनीच कन्फर्म करावे लागेल.' : 'This was raised by another user — they need to confirm it.' } })
  }

  // §4.5 rule 3 — status must be awaiting_confirmation.
  if (proposal.status !== 'awaiting_confirmation') {
    const messages: Record<string, string> = lang === 'mr' ? {
      executed: 'हे GRN आधीच नोंदवले गेले आहे.',
      cancelled: 'हा प्लॅन रद्द केला आहे.',
      superseded: 'तो प्लॅन नवीन प्लॅनने बदलला आहे — नवीनतम कार्ड वापरा.',
      expired: 'तो प्लॅन 15 मिनिटांपेक्षा जुना आहे आणि स्टॉक बदलला असू शकतो. पुन्हा सांगा, मी पुन्हा तपासेन.',
      executing: 'हे आधीच नोंदवले जात आहे.',
      failed: 'तो प्लॅन नोंदवता आला नाही — डिलिव्हरीचा फोटो पुन्हा घ्या.',
    } : {
      executed: 'This GRN has already been recorded.',
      cancelled: 'This plan was cancelled.',
      superseded: 'That plan was replaced by a newer one — use the latest card.',
      expired: 'That plan is more than 15 minutes old and stock may have moved. Say it again and I\'ll recheck.',
      executing: 'This is already being recorded.',
      failed: 'That plan could not be recorded — photograph the delivery again.',
    }
    return respond({ status: 'ok', confirm: { status: 'refused', confirm_text: messages[proposal.status] ?? (lang === 'mr' ? 'हा प्लॅन आता सक्रिय नाही.' : 'This plan is no longer active.') } })
  }

  // §4.5 rule 4 / §3 D9 — expiry checked server-side, not client.
  if (new Date(proposal.expires_at).getTime() <= Date.now()) {
    await supabaseClient.from('p2_agent_proposals').update({ status: 'expired', updated_at: new Date().toISOString() }).eq('id', proposal_id)
    return respond({ status: 'ok', confirm: { status: 'refused', confirm_text: lang === 'mr' ? 'तो प्लॅन 15 मिनिटांपेक्षा जुना आहे आणि स्टॉक बदलला असू शकतो. पुन्हा सांगा, मी पुन्हा तपासेन.' : 'That plan is more than 15 minutes old and stock may have moved. Say it again and I\'ll recheck.' } })
  }

  // §4.5 rule 5 — role still permitted, re-checked (not inherited).
  const role = await resolveCallerRole(supabaseClient, tenant_id, callerUserId)
  if (!GRN_ALLOWED_ROLES.has(role)) {
    return respond({ status: 'ok', confirm: { status: 'refused', confirm_text: lang === 'mr' ? 'फक्त मालक, सुपरवायझर किंवा स्टोअरकीपर GRN नोंदवू शकतात.' : 'Only the owner, a supervisor or a storekeeper can record a GRN.' } })
  }

  // The ONE exception to "confirm reads from the stored plan only" (§18.1
  // #3): principal_challan_no/date are genuinely unknown server-side at
  // propose time when the photo doesn't show the principal's own paper
  // challan, and are only ever collected here — via the confirmation
  // card's inline Principal Challan No./Date inputs (js/agent-chat.js's
  // addConfirmCard) — never through chat. If the stored plan already has
  // them (the document had them, or an amendment carried them over), the
  // request body's copies are ignored entirely; if it doesn't, both are
  // required here or confirmation is refused outright.
  let plan = proposal.plan
  if (plan.owned_by && (!plan.principal_challan_no || !plan.principal_challan_date)) {
    const suppliedNo = typeof body.principal_challan_no === 'string' ? body.principal_challan_no.trim() : ''
    const suppliedDate = typeof body.principal_challan_date === 'string' ? body.principal_challan_date.trim() : ''
    if (!suppliedNo || !suppliedDate) {
      return respond({ status: 'ok', confirm: { status: 'refused', confirm_text: lang === 'mr' ? 'ही प्रिन्सिपल डिलिव्हरी आहे — नोंदवण्याआधी चलान क्रमांक आणि तारीख आवश्यक आहे.' : "This is a principal delivery — the challan number and date are required before this can be recorded." } })
    }
    plan = { ...plan, principal_challan_no: suppliedNo, principal_challan_date: suppliedDate }
  }
  const finalConfirmText = renderGrnConfirmText(plan, proposal.warnings ?? [], lang)

  // §4.5 rule 7 — idempotency. Conditional UPDATE; zero rows means a
  // concurrent confirm already won (§18.1 #6 — two simultaneous confirms
  // produce one write). Also persists the patched plan/confirm_text above
  // (a no-op when nothing was patched) so the stored audit record — "what
  // exactly did my supervisor approve" — reflects what was actually sent to
  // confirm_agent_grn_v3, not a stale pre-challan-info snapshot.
  const { data: claimedRows, error: claimError } = await supabaseClient
    .from('p2_agent_proposals')
    .update({ status: 'executing', updated_at: new Date().toISOString(), plan, confirm_text: finalConfirmText })
    .eq('id', proposal_id)
    .eq('status', 'awaiting_confirmation')
    .select('id')

  if (claimError) return respond({ status: 'error', error: claimError.message }, 500)
  if (!claimedRows || claimedRows.length === 0) {
    // Lost the race — re-read and return whatever the winner produced.
    const { data: after } = await supabaseClient.from('p2_agent_proposals').select('status, result, confirm_text').eq('id', proposal_id).maybeSingle()
    const afterRow = after as { status: string; result: unknown; confirm_text: string } | null
    return respond({ status: 'ok', confirm: { status: afterRow?.status === 'executed' ? 'ready' : 'refused', confirm_text: afterRow?.confirm_text ?? (lang === 'mr' ? 'आधीच हाताळले गेले आहे.' : 'Already handled.') }, result: afterRow?.result ?? null })
  }

  // §4.5 rule 6 — re-validate every referenced row is still active. The RPC
  // re-checks this too (locked, inside the transaction) — this produces a
  // better message before paying for the RPC call.
  const { data: supplierCheck } = await supabaseClient.from('p2_suppliers').select('is_active').eq('id', plan.supplier_id).maybeSingle()
  if (!(supplierCheck as { is_active?: boolean } | null)?.is_active) {
    await supabaseClient.from('p2_agent_proposals').update({ status: 'failed', error_reason: 'supplier_inactive', updated_at: new Date().toISOString() }).eq('id', proposal_id)
    return respond({
      status: 'ok',
      confirm: {
        status: 'refused',
        confirm_text: lang === 'mr'
          ? `${plan.supplier_name} आता निष्क्रिय दिसत आहे — Settings तपासा, किंवा हे चुकीचे असल्यास पुन्हा सांगा.`
          : `${plan.supplier_name} looks inactive now — check Settings, or say it again if that's wrong.`,
      },
    })
  }

  // Step 8 — call confirm_agent_grn_v3 with the STORED (now possibly
  // challan-patched) plan. proposal_id plus, only when the plan needed
  // them, principal_challan_no/date are the only things read from the
  // request (§18.1 #3's rule holds for every other field — quantities,
  // rates, supplier, items are never re-read from the client here).
  const itemsPayload = plan.items.map((it) => ({
    material_id: it.raw_material_id,
    quantity: it.quantity,
    unit: it.unit,
    rate: it.rate,
    invoice_no: it.invoice_no,
    purchase_type: it.purchase_type,
  }))

  const { data: rpcResult, error: rpcError } = await supabaseClient.rpc('confirm_agent_grn_v3', {
    p_tenant_id: tenant_id,
    p_supplier_id: plan.supplier_id,
    p_grn_date: plan.grn_date,
    p_owned_by: plan.owned_by,
    p_principal_challan_no: plan.principal_challan_no,
    p_principal_challan_date: plan.principal_challan_date,
    p_created_by: callerUserId,
    p_items: JSON.stringify(itemsPayload),
  })

  if (rpcError) {
    // §15 row 12 — a failed write RPC is always a bug, critical, no dedupe.
    await supabaseClient.from('p2_agent_proposals').update({ status: 'failed', error_reason: rpcError.message, updated_at: new Date().toISOString() }).eq('id', proposal_id)
    await opsAlert({ source: 'agent', severity: 'critical', title: 'confirm_agent_grn_v3 failed', body: `${rpcError.message}\nproposal_id: ${proposal_id}, tenant_id: ${tenant_id}`, meta: { proposal_id, tenant_id } })
    void logInteraction(supabaseClient, tenant_id, '', 'confirm_proposal', {}, null, false, rpcError.message)
    return respond({ status: 'ok', confirm: { status: 'refused', confirm_text: lang === 'mr' ? 'ते नोंदवता आले नाही — काहीही बदलले नाही. Support ला कळवले आहे.' : "Couldn't record that — nothing has been changed. Support has been told." } })
  }

  // Step 7 & 9 — success. Meter increments here (on confirm), per this
  // session's task brief — a deliberate deviation from nexflow-agent.md
  // §10.1's "increments on each proposal" text (see the plan file's
  // Correction 2 for the reasoning: this meters completed writes, not
  // attempts).
  await supabaseClient.from('p2_agent_proposals').update({ status: 'executed', result: rpcResult, updated_at: new Date().toISOString() }).eq('id', proposal_id)
  await bumpMonthlyAgentWrites(supabaseClient, tenant_id)
  void logInteraction(supabaseClient, tenant_id, '', 'confirm_proposal', {}, 'matched', true, null)

  const resultObj = rpcResult as { grn_no?: string } | null
  return respond({
    status: 'ok',
    confirm: {
      status: 'ready',
      confirm_text: lang === 'mr'
        ? `नोंदवले — ${resultObj?.grn_no ?? 'GRN'} सेव्ह झाले.\n\n${finalConfirmText}`
        : `Recorded — ${resultObj?.grn_no ?? 'GRN'} saved.\n\n${finalConfirmText}`,
    },
    result: rpcResult,
  })
}

// Every intent Haiku can return is read-only — single source of truth, no
// second list anywhere (agent-chat.js reads confirm.confirm_text
// unconditionally, no allow-list needed there).
const READ_ONLY_INTENTS: HaikuIntent[] = [
  'check_stock', 'recent_grn', 'consumption_summary', 'supplier_history', 'low_stock_list',
  'grn_detail', 'pending_dispatches', 'grn_summary', 'top_consumption', 'material_list',
  'stock_check_product', 'zero_stock_list', 'dispatch_summary', 'supplier_delivery_check',
  'challan_detail', 'issue_summary', 'product_code_lookup', 'top_received', 'product_list',
  'supplier_list', 'dispatch_detail', 'issue_detail', 'bom_detail', 'top_supplier',
  'invoice_total', 'invoice_detail', 'grn_completeness', 'gstr2b_status',
]

// Shared by the legacy plain-message path (bottom of Deno.serve, untouched
// callers) and proposeAction()'s text branch — extracted so the two entry
// points can never diverge on what a read query answers (§18.7 #39: "the
// write layer must not alter a single read answer"). Returns null when the
// message doesn't classify as a known read intent, meaning the caller should
// fall through to the write-tool-use path.
async function tryReadClassification(
  supabaseClient: ReturnType<typeof createClient>,
  anthropicClient: Anthropic,
  tenantId: string,
  message: string,
  context: AgentContext
): Promise<Response | null> {
  const haikuResult = await callHaiku(anthropicClient, context, message)

  if (haikuResult.intent === 'unknown') {
    void logInteraction(supabaseClient, tenantId, message, 'unknown', haikuResult.extracted as Record<string, unknown>, null, false, 'unknown intent')
    return null
  }

  if (READ_ONLY_INTENTS.includes(haikuResult.intent)) {
    const answer = await executeQuery(supabaseClient, tenantId, haikuResult, context)
    const isError = answer.startsWith("Couldn't") || answer.startsWith('Could not') || answer.startsWith('Please provide')
    void logInteraction(supabaseClient, tenantId, message, haikuResult.intent, haikuResult.extracted as Record<string, unknown>, null, !isError, isError ? answer : null)
    return respond({ status: 'ok', intent: haikuResult.intent, confirm: { status: 'ready', confirm_text: answer } })
  }

  // Unreachable in practice — every HaikuIntent other than 'unknown' is in
  // READ_ONLY_INTENTS, but TypeScript can't prove that from a runtime
  // .includes() check.
  void logInteraction(supabaseClient, tenantId, message, haikuResult.intent, haikuResult.extracted as Record<string, unknown>, null, false, 'intent not in READ_ONLY_INTENTS')
  return respond({ status: 'error', error: 'Unrecognized intent.' }, 500)
}

async function cancelProposalAction(
  supabaseClient: ReturnType<typeof createClient>,
  body: Partial<CancelProposalRequest>,
  callerUserId: string
): Promise<Response> {
  const { tenant_id, proposal_id } = body
  const lang: 'en' | 'mr' = body.lang === 'mr' ? 'mr' : 'en'
  if (!tenant_id || !proposal_id) return respond({ status: 'error', error: lang === 'mr' ? 'tenant_id आणि proposal_id आवश्यक आहेत.' : 'tenant_id and proposal_id are required' }, 400)

  const { data: proposalRow } = await supabaseClient
    .from('p2_agent_proposals')
    .select('id, user_id, status')
    .eq('id', proposal_id)
    .eq('tenant_id', tenant_id)
    .maybeSingle()
  const proposal = proposalRow as { id: string; user_id: string; status: string } | null

  if (!proposal) return respond({ status: 'error', error: lang === 'mr' ? 'प्रपोजल सापडले नाही.' : 'Proposal not found.' }, 404)
  if (proposal.user_id !== callerUserId) {
    return respond({ status: 'ok', confirm: { status: 'refused', confirm_text: lang === 'mr' ? 'हे दुसऱ्या युजरने सुरू केले आहे.' : 'This was raised by another user.' } })
  }
  if (proposal.status !== 'awaiting_confirmation') {
    return respond({ status: 'ok', confirm: { status: 'refused', confirm_text: lang === 'mr' ? 'हा प्लॅन आता सक्रिय नाही.' : 'This plan is no longer active.' } })
  }

  await supabaseClient.from('p2_agent_proposals').update({ status: 'cancelled', updated_at: new Date().toISOString() }).eq('id', proposal_id)
  void logInteraction(supabaseClient, tenant_id, '', 'cancel_proposal', {}, null, true, null)
  return respond({ status: 'ok', confirm: { status: 'cancelled', confirm_text: lang === 'mr' ? 'रद्द केले — काहीही नोंदवले गेले नाही.' : 'Cancelled — nothing was recorded.' } })
}

// W5 — voice input, read-only. Transcribes a recorded clip via OpenAI
// Whisper and returns text only; never touches a proposal. Plan gate checks
// only settings.plan === 'lite' (not checkWriteGate's agent_write_enabled —
// that flag gates the WRITE layer specifically and won't be true for any
// tenant until the W6 pilot, which would make voice permanently refused for
// everyone if reused here). verifyCallerTenant already ran in the dispatcher
// above (transcribe is not the confirm_receive_grn exemption).
async function transcribeAction(
  supabaseClient: ReturnType<typeof createClient>,
  body: Partial<TranscribeRequest>
): Promise<Response> {
  const { tenant_id, audio_base64, audio_mime_type } = body
  const lang: 'en' | 'mr' = body.lang === 'mr' ? 'mr' : 'en'
  if (!tenant_id || !audio_base64 || !audio_mime_type) {
    return respond({
      status: 'error',
      error: lang === 'mr' ? 'tenant_id, audio_base64 आणि audio_mime_type आवश्यक आहेत.' : 'tenant_id, audio_base64 and audio_mime_type are required',
    }, 400)
  }

  const { data: settingsRow } = await supabaseClient
    .from('p2_tenant_settings')
    .select('plan')
    .eq('tenant_id', tenant_id)
    .maybeSingle()
  const settings = (settingsRow ?? {}) as Record<string, unknown>
  if (settings.plan === 'lite') {
    return respond({
      status: 'error',
      error: lang === 'mr' ? 'एजंट राइट सुविधा Lite प्लॅनवर उपलब्ध नाही.' : 'The agent write layer is not available on the Lite plan.',
    })
  }

  const apiKey = Deno.env.get('OPENAI_API_KEY')
  if (!apiKey) {
    return respond({ status: 'error', error: 'Voice transcription is not configured — type your question instead' })
  }

  try {
    const bytes = Uint8Array.from(atob(audio_base64), (c) => c.charCodeAt(0))
    const blob = new Blob([bytes], { type: audio_mime_type })
    const formData = new FormData()
    formData.append('file', blob, audio_mime_type.includes('webm') ? 'audio.webm' : 'audio.mp4')
    formData.append('model', 'whisper-1')

    const res = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}` },
      body: formData,
    })

    if (!res.ok) {
      const errText = await res.text().catch(() => '')
      console.error(`[transcribeAction] OpenAI API ${res.status}:`, errText)
      void logInteraction(supabaseClient, tenant_id, '', 'transcribe', {}, null, false, `OpenAI API ${res.status}`)
      return respond({
        status: 'error',
        error: lang === 'mr' ? 'आवाज ओळखता आला नाही — पुन्हा प्रयत्न करा किंवा टाइप करा.' : 'Voice transcription failed — try again or type your question.',
      })
    }

    const json = await res.json()
    void logInteraction(supabaseClient, tenant_id, '', 'transcribe', {}, null, true, null)
    return respond({ status: 'ok', text: json.text ?? '' })
  } catch (err) {
    void logInteraction(supabaseClient, tenant_id, '', 'transcribe', {}, null, false, err instanceof Error ? err.message : String(err))
    return respond({
      status: 'error',
      error: lang === 'mr' ? 'काहीतरी चूक झाली — कनेक्शन तपासा आणि पुन्हा प्रयत्न करा.' : 'Something went wrong — check your connection and try again.',
    })
  }
}

Deno.serve(async (req) => {
  // CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: CORS_HEADERS,
    })
  }

  if (req.method !== 'POST') {
    return respond({ status: 'error', error: 'Method not allowed' }, 405)
  }

  try {
    const body: Partial<AgentQueryRequest> &
      Partial<Omit<ConfirmReceiveGrnRequest, 'action'>> &
      Partial<Omit<ConfirmGenerateInvoiceRequest, 'action'>> &
      Partial<Omit<ResendInvoiceRequest, 'action'>> &
      Partial<Omit<ConfirmConsolidatedInvoiceRequest, 'action'>> &
      Partial<Omit<PreviewConsolidatedInvoiceRequest, 'action'>> &
      Partial<Omit<SuggestHsnRequest, 'action'>> &
      Partial<Omit<SubmitSupportMessageRequest, 'action'>> &
      Partial<Omit<SubmitBugReportRequest, 'action'>> &
      Partial<Omit<ProposeRequest, 'action'>> &
      Partial<Omit<ConfirmProposalRequest, 'action'>> &
      Partial<Omit<CancelProposalRequest, 'action'>> &
      Partial<Omit<TranscribeRequest, 'action'>> &
      { action?: 'confirm_receive_grn' | 'confirm_generate_invoice' | 'resend_invoice' | 'confirm_consolidated_invoice' | 'preview_consolidated_invoice' | 'suggest_hsn' | 'submit_support_message' | 'submit_bug_report' | 'propose' | 'confirm_proposal' | 'cancel_proposal' | 'transcribe' } = await req.json()

    // Cross-tenant auth guard: every action below (and the plain-message path
    // further down) takes tenant_id from this same body — verify it against
    // the caller's real identity before dispatching to any handler.
    // confirm_receive_grn is exempt: it already runs its own equivalent check
    // against recipient_tenant_id below, since receive.html's caller is
    // deliberately a DIFFERENT tenant than the dispatch's own sender.
    // callerUserId is captured here (not just used inline) because
    // submit_bug_report needs it below, after this block closes, to resolve
    // role server-side.
    let callerUserId: string | null = null
    if (body.action !== 'confirm_receive_grn') {
      const authCheck = await verifyCallerTenant(supabase, req, (body as { tenant_id?: string }).tenant_id)
      if (!authCheck.ok) return authCheck.response
      callerUserId = authCheck.userId

      // D11 / Known Open Items #18: operator/storekeeper can reach these two
      // actions with a valid tenant but no business generating a tax invoice.
      // owner is identified by userId === tenantId and is never queried
      // against p2_user_roles — that table has no row for owners
      // (invite-staff only ever inserts supervisor/storekeeper/operator/
      // accountant), matching js/auth.js's fetchUserRole() short-circuit.
      // Querying the table first and treating "no row" as "no access" would
      // lock every owner out.
      if (body.action === 'confirm_generate_invoice' || body.action === 'confirm_consolidated_invoice') {
        const tenantId = (body as { tenant_id?: string }).tenant_id as string
        const role = authCheck.userId === tenantId
          ? 'owner'
          : (await supabase.from('p2_user_roles').select('role').eq('user_id', authCheck.userId).eq('tenant_id', tenantId).maybeSingle()).data?.role
        if (!['owner', 'supervisor', 'accountant'].includes(role ?? '')) {
          return respond({ error: 'INSUFFICIENT_ROLE' }, 403)
        }
      }
    }

    // W2 — agent write layer. callerUserId is always set here (propose/
    // confirm_proposal/cancel_proposal are not confirm_receive_grn's
    // exemption, so verifyCallerTenant already ran above).
    if (body.action === 'propose') {
      return await proposeAction(supabase, anthropic, req, body as Partial<ProposeRequest>, callerUserId as string)
    }
    if (body.action === 'confirm_proposal') {
      return await confirmProposalAction(supabase, body as Partial<ConfirmProposalRequest>, callerUserId as string)
    }
    if (body.action === 'cancel_proposal') {
      return await cancelProposalAction(supabase, body as Partial<CancelProposalRequest>, callerUserId as string)
    }
    if (body.action === 'transcribe') {
      return await transcribeAction(supabase, body as Partial<TranscribeRequest>)
    }

    if (body.action === 'confirm_generate_invoice') {
      return await confirmGenerateInvoice(supabase, body as Partial<ConfirmGenerateInvoiceRequest>, callerUserId)
    }

    if (body.action === 'resend_invoice') {
      return await resendInvoiceAction(supabase, body as Partial<ResendInvoiceRequest>)
    }

    if (body.action === 'confirm_consolidated_invoice') {
      return await confirmConsolidatedInvoice(supabase, body as Partial<ConfirmConsolidatedInvoiceRequest>, callerUserId)
    }

    if (body.action === 'preview_consolidated_invoice') {
      return await previewConsolidatedInvoice(supabase, body as Partial<PreviewConsolidatedInvoiceRequest>)
    }

    if (body.action === 'suggest_hsn') {
      return await suggestHsn(supabase, anthropic, body as Partial<SuggestHsnRequest>)
    }

    if (body.action === 'submit_support_message') {
      return await submitSupportMessage(supabase, body as Partial<SubmitSupportMessageRequest>)
    }

    if (body.action === 'submit_bug_report') {
      // callerUserId is always set here — every action other than
      // confirm_receive_grn runs verifyCallerTenant above, and this one is
      // not that exemption.
      return await submitBugReport(supabase, callerUserId as string, body as Partial<SubmitBugReportRequest>)
    }

    if (body.action === 'confirm_receive_grn') {
      return await confirmReceiveGrn(supabase, req, body as Partial<ConfirmReceiveGrnRequest>)
    }

    const { tenant_id, message } = body

    if (!tenant_id || !message) {
      return respond(
        { status: 'error', error: 'tenant_id and message are required' },
        400
      )
    }

    const usage = await checkAndIncrementUsage(supabase, tenant_id)

    if (!usage.allowed) {
      return respond({ status: 'error', error: usage.error }, 429)
    }

    const context = await buildContext(supabase, tenant_id)

    if ('error' in context) {
      return respond({ status: 'error', error: context.error }, 500)
    }

    const readResponse = await tryReadClassification(supabase, anthropic, tenant_id, message, context)
    if (readResponse) return readResponse
    return respond({ status: 'ok', intent: 'unknown' })
  } catch (error) {
    return respond(
      { status: 'error', error: error instanceof Error ? error.message : 'Invalid request body' },
      400
    )
  }
})
