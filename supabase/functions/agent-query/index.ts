// Supabase Edge Function: agent-query
// Pure read-only supervisor — every intent Haiku can classify a message into
// answers a question from real DB rows via executeQuery(). Haiku extracts
// intent + raw text/number fields only; matchMaterialName()/findMatches()/
// findProductMatches()/matchClientName() resolve those raw fields against
// real rows in code — identity resolution is never trusted to the model.
// The five confirm_*/resend_invoice/preview_consolidated_invoice body.action
// handlers below Deno.serve are UI-triggered writes (invoices.html,
// all-dispatch-history.html, receive.html) — unrelated to the chat agent,
// kept as-is.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import Anthropic from 'https://esm.sh/@anthropic-ai/sdk@0.32.0'

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
  item_rates?: Array<{ dispatch_item_id: string; rate: number }>
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
      .neq('status', 'cancelled')

    if (validFrom) invoiceTotalQuery = invoiceTotalQuery.gte('created_at', validFrom + 'T00:00:00+05:30')
    if (validTo) invoiceTotalQuery = invoiceTotalQuery.lte('created_at', validTo + 'T23:59:59+05:30')

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
      unit: it.unit,
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
  body: Partial<ConfirmGenerateInvoiceRequest>
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
      unit: it.unit,
      rate,
      amount: qty * rate,
      hsn_sac: hsnSac ?? '',
    }
  })

  const { subtotal, gst, roundOff, total } = buildInvoiceTotals(invoiceItems, gstType)
  const docCategory = deriveDocCategory(order.dispatch_type, order.movement_purpose)
  const invoiceDate = todayIST()

  const { data: invoiceNumber, error: invNoError } = await supabaseClient
    .rpc('get_next_invoice_number', { p_tenant_id: tenant_id })

  if (invNoError || !invoiceNumber) {
    void logInteraction(supabaseClient, tenant_id, '', 'send_invoice', {}, null, false, invNoError?.message ?? 'no invoice number returned')
    return respond({ status: 'error', error: invNoError?.message ?? 'Could not generate invoice number' }, 500)
  }

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

  let ordersQuery = supabaseClient
    .from('p2_dispatch_orders')
    .select(INVOICE_ORDER_COLUMNS)
    .eq('tenant_id', tenant_id)
    .eq('client_name', client.name)
    .eq('status', 'confirmed')
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
  // an invoice that already exists.
  const { data: existingInvoice, error: existingError } = await supabaseClient
    .from('p2_invoices')
    .select('invoice_number')
    .eq('tenant_id', tenant_id)
    .eq('client_id', client_id)
    .eq('date_from', date_from)
    .eq('date_to', date_to)
    .maybeSingle()

  if (existingError) {
    return respond({ status: 'error', error: existingError.message }, 500)
  }
  if (existingInvoice) {
    return respond({
      status: 'error',
      error: `Ya client ani period sathi invoice already exists — ${existingInvoice.invoice_number}.`,
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
  body: Partial<ConfirmConsolidatedInvoiceRequest>
): Promise<Response> {
  const { tenant_id, client_id, date_from, date_to, gst_type, dispatch_type, item_rates } = body

  if (!tenant_id || !client_id || !date_from || !date_to || !gst_type) {
    return respond({ status: 'error', error: 'tenant_id, client_id, date_from, date_to, and gst_type are required' }, 400)
  }
  const gstType = gst_type === 'igst' || gst_type === 'none' ? gst_type : 'cgst_sgst'

  // item_rates is optional (invoices.html's preview step sends it; a direct
  // call without it falls back to price-table rates, same as before this
  // field existed) — same non-negative-number guard confirmGenerateInvoice
  // applies to its item_rates.
  if (item_rates) {
    const invalidRate = item_rates.find((r) => !Number.isFinite(r.rate) || r.rate < 0)
    if (invalidRate) {
      return respond({ status: 'error', error: 'rate must be a non-negative number for every item' }, 400)
    }
  }
  const rateById = new Map((item_rates ?? []).map((r) => [r.dispatch_item_id, r.rate]))

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

  let ordersQuery = supabaseClient
    .from('p2_dispatch_orders')
    .select(INVOICE_ORDER_COLUMNS)
    .eq('tenant_id', tenant_id)
    .eq('client_name', client.name)
    .eq('status', 'confirmed')
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

  // Consolidated duplicate check: exact tenant + client + date range match
  // (not an overlap check) — resend rather than recreate. Checked before the
  // cross-mode guard below, since a resend doesn't need to re-validate
  // billing state.
  const { data: existingInvoice, error: existingError } = await supabaseClient
    .from('p2_invoices')
    .select('invoice_number, invoice_token, amount_total')
    .eq('tenant_id', tenant_id)
    .eq('client_id', client_id)
    .eq('date_from', date_from)
    .eq('date_to', date_to)
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

  // Cross-mode double-billing guard: block the whole consolidated invoice
  // (not a silent partial exclusion) if any matched dispatch was already
  // billed individually via a single-mode invoice.
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

  const allItems: InvoiceItem[] = []
  for (const order of orderRows) {
    const itemsResult = await buildInvoiceItemsForOrder(supabaseClient, tenant_id, order)
    if ('error' in itemsResult) {
      return respond({ status: 'error', error: itemsResult.error }, 400)
    }
    for (const { dispatch_item_id, product_code, ...rest } of itemsResult.items) {
      // Confirmed price from the preview step wins when present; otherwise
      // keep buildInvoiceItemsForOrder's price-table default.
      const rate = rateById.has(dispatch_item_id) ? Number(rateById.get(dispatch_item_id)) : rest.rate
      allItems.push({ ...rest, rate, amount: rest.qty * rate })
    }
  }

  const { subtotal, gst, roundOff, total } = buildInvoiceTotals(allItems, gstType)
  // 'services' only if every covered dispatch is job-work/bom_issue — one
  // plain-sale dispatch in the mix defaults the whole consolidated invoice to
  // 'goods' (the stricter Rule 48(1) triplicate format), matching
  // deriveDocCategory's own "default to goods if unknown" conservatism.
  const docCategory = orderRows.every((o) => deriveDocCategory(o.dispatch_type, o.movement_purpose) === 'services')
    ? 'services'
    : 'goods'
  const invoiceDate = todayIST()

  const { data: invoiceNumber, error: invNoError } = await supabaseClient
    .rpc('get_next_invoice_number', { p_tenant_id: tenant_id })

  if (invNoError || !invoiceNumber) {
    void logInteraction(supabaseClient, tenant_id, '', 'confirm_consolidated_invoice', {}, null, false, invNoError?.message ?? 'no invoice number returned')
    return respond({ status: 'error', error: invNoError?.message ?? 'Could not generate invoice number' }, 500)
  }

  const { data: invoiceRow, error: insertError } = await supabaseClient
    .from('p2_invoices')
    .insert({
      tenant_id,
      invoice_number: invoiceNumber,
      invoice_date: invoiceDate,
      dispatch_order_id: null,
      dispatch_order_ids: orderIds,
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

  const { data: tenantSettingsRow } = await supabaseClient
    .from('p2_tenant_settings')
    .select('company_name, email')
    .eq('tenant_id', tenant_id)
    .maybeSingle()

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
      { action?: 'confirm_receive_grn' | 'confirm_generate_invoice' | 'resend_invoice' | 'confirm_consolidated_invoice' | 'preview_consolidated_invoice' } = await req.json()

    // Cross-tenant auth guard: every action below (and the plain-message path
    // further down) takes tenant_id from this same body — verify it against
    // the caller's real identity before dispatching to any handler.
    // confirm_receive_grn is exempt: it already runs its own equivalent check
    // against recipient_tenant_id below, since receive.html's caller is
    // deliberately a DIFFERENT tenant than the dispatch's own sender.
    if (body.action !== 'confirm_receive_grn') {
      const authCheck = await verifyCallerTenant(supabase, req, (body as { tenant_id?: string }).tenant_id)
      if (!authCheck.ok) return authCheck.response
    }

    if (body.action === 'confirm_generate_invoice') {
      return await confirmGenerateInvoice(supabase, body as Partial<ConfirmGenerateInvoiceRequest>)
    }

    if (body.action === 'resend_invoice') {
      return await resendInvoiceAction(supabase, body as Partial<ResendInvoiceRequest>)
    }

    if (body.action === 'confirm_consolidated_invoice') {
      return await confirmConsolidatedInvoice(supabase, body as Partial<ConfirmConsolidatedInvoiceRequest>)
    }

    if (body.action === 'preview_consolidated_invoice') {
      return await previewConsolidatedInvoice(supabase, body as Partial<PreviewConsolidatedInvoiceRequest>)
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

    const haikuResult = await callHaiku(anthropic, context, message)

    if (haikuResult.intent === 'unknown') {
      void logInteraction(supabase, tenant_id, message, 'unknown', haikuResult.extracted as Record<string, unknown>, null, false, 'unknown intent')
      return respond({ status: 'ok', intent: 'unknown' })
    }

    // Every intent Haiku can return is read-only — single source of truth,
    // no second list anywhere (agent-chat.js reads confirm.confirm_text
    // unconditionally, no allow-list needed there).
    const READ_ONLY_INTENTS: HaikuIntent[] = [
      'check_stock',
      'recent_grn',
      'consumption_summary',
      'supplier_history',
      'low_stock_list',
      'grn_detail',
      'pending_dispatches',
      'grn_summary',
      'top_consumption',
      'material_list',
      'stock_check_product',
      'zero_stock_list',
      'dispatch_summary',
      'supplier_delivery_check',
      'challan_detail',
      'issue_summary',
      'product_code_lookup',
      'top_received',
      'product_list',
      'supplier_list',
      'dispatch_detail',
      'issue_detail',
      'bom_detail',
      'top_supplier',
      'invoice_total',
      'invoice_detail',
      'grn_completeness',
      'gstr2b_status',
    ]

    if (READ_ONLY_INTENTS.includes(haikuResult.intent)) {
      const answer = await executeQuery(supabase, tenant_id, haikuResult, context)
      // Treat as failure if answer starts with "Couldn't" or "Could not" — these are error responses
      const isError = answer.startsWith("Couldn't") || answer.startsWith('Could not') || answer.startsWith('Please provide')
      void logInteraction(supabase, tenant_id, message, haikuResult.intent, haikuResult.extracted as Record<string, unknown>, null, !isError, isError ? answer : null)
      return respond({
        status: 'ok',
        intent: haikuResult.intent,
        confirm: { status: 'ready', confirm_text: answer },
      })
    }

    // Unreachable in practice — every HaikuIntent other than 'unknown' is in
    // READ_ONLY_INTENTS (verified above), but TypeScript can't prove that
    // from a runtime .includes() check, so this keeps every path returning.
    void logInteraction(supabase, tenant_id, message, haikuResult.intent, haikuResult.extracted as Record<string, unknown>, null, false, 'intent not in READ_ONLY_INTENTS')
    return respond({ status: 'error', error: 'Unrecognized intent.' }, 500)
  } catch (error) {
    return respond(
      { status: 'error', error: error instanceof Error ? error.message : 'Invalid request body' },
      400
    )
  }
})
