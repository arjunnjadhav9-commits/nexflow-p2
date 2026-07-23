// Supabase Edge Function: agent-query
// Phase 5 — create_grn extraction and matching became array-based so one
// message can report multiple materials against one shared supplier.
// Haiku (Phase 3) extracts intent + raw fields only; matchEntities() (Phase 4)
// resolves those raw fields against real p2_raw_materials / p2_suppliers rows
// in code — identity resolution is never trusted to the model.

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

interface AgentQueryRequest {
  tenant_id: string
  message: string
}

interface ConfirmGrnRequest {
  action: 'confirm_grn'
  tenant_id: string
  material_id: string
  supplier_id: string | null
  quantity: number
  unit: string
}

interface ConfirmAgentGrnRpcResult {
  success: boolean
  error?: string
  transaction_id?: string
  grn_no?: string
  material_name?: string
  quantity?: number
  unit?: string
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
  | 'create_grn'
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
  | 'unknown'

interface GrnItem {
  material_name: string
  quantity: number
  unit?: string
}

interface HaikuResult {
  intent: HaikuIntent
  extracted: {
    material_name?: string // shared: check_stock, recent_grn, consumption_summary
    items?: GrnItem[] // create_grn only
    supplier_name?: string // shared: create_grn, supplier_history, supplier_delivery_check
    days?: number // recent_grn, consumption_summary, top_received, top_supplier — default varies by intent
    grn_no?: string // grn_detail only
    challan_number?: string // challan_detail, dispatch_detail, issue_detail
    product_name?: string // stock_check_product, product_code_lookup, bom_detail
    quantity?: number // stock_check_product — how many units to produce
    top_n?: number // top_consumption, top_received — how many to show, default 5
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

// Fetches all tenant-scoped data the model needs to answer stock/product
// questions or draft a GRN. Every query is tenant_id-filtered by hand since
// this client uses the secret key and bypasses RLS.
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
    .select('id, product_code, name')
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

// Re-validates the matched material/supplier via confirm_agent_grn (row-locked,
// tenant-scoped) and records the GRN. Separate branch from the message-based
// query flow above — does not touch callHaiku, matchEntities, or buildConfirmData.
async function confirmGrn(
  supabaseClient: ReturnType<typeof createClient>,
  body: Partial<ConfirmGrnRequest>
): Promise<Response> {
  const { tenant_id, material_id, supplier_id, quantity, unit } = body

  if (!tenant_id || !material_id || !unit) {
    return respond(
      { status: 'error', error: 'tenant_id, material_id, and unit are required' },
      400
    )
  }

  if (typeof quantity !== 'number' || !Number.isFinite(quantity) || quantity <= 0) {
    return respond({ status: 'error', error: 'quantity must be a positive number' }, 400)
  }

  const { data, error } = await supabaseClient.rpc('confirm_agent_grn', {
    p_tenant_id: tenant_id,
    p_material_id: material_id,
    p_supplier_id: supplier_id ?? null,
    p_quantity: quantity,
    p_unit: unit,
  })

  if (error) {
    return respond({ status: 'error', error: error.message }, 500)
  }

  const result = data as ConfirmAgentGrnRpcResult

  if (!result.success) {
    void logInteraction(supabaseClient, tenant_id, '', 'confirm_grn', {}, null, false, result.error ?? 'RPC returned success:false')
    return respond({ status: 'ok', confirmed: false, error: result.error })
  }

  void logInteraction(supabaseClient, tenant_id, '', 'confirm_grn', {}, null, true, null)
  return respond({ status: 'ok', confirmed: true, result })
}

// Extraction-only call to Claude Haiku. Haiku classifies intent and pulls
// raw text/number fields exactly as the user wrote them — it must NEVER
// match a name to a real p2_raw_materials/p2_suppliers row (that's
// matchEntities(), code-side, Phase 4) and NEVER author the confirmation
// text shown to the user (that's built server-side from a fixed template).
async function callHaiku(
  anthropicClient: Anthropic,
  context: AgentContext,
  message: string
): Promise<HaikuResult> {
  // Condensed context: names only. Haiku doesn't need IDs or stock numbers —
  // those are for matchEntities() to resolve against the real rows later.
  const materialNames = context.materials.map((m) => m.name)
  const productNames = context.products.map((p) => p.name)

  const systemPrompt = `You classify a factory owner's message into one of the following intents. You do not match names to a database — extract text exactly as the user wrote it.

Known raw materials (for context only, do not require an exact match):
${JSON.stringify(materialNames)}

Known products (for context only, do not require an exact match):
${JSON.stringify(productNames)}

Classify the message as one of:
- "check_stock" — the user is asking about stock/inventory level of a raw material.
  extracted fields: { "material_name": string }  // exactly as the user said it
- "create_grn" — the user is reporting that materials were received.
  extracted fields: {
    "items": [{ "material_name": string, "quantity": number, "unit"?: string }],
    "supplier_name"?: string
  }
  Rules:
  - "items" is always an array, even for a single material.
  - "supplier_name" is shared across all items in the message — one supplier per message.
  - Strip Hinglish/Marathi filler from material_name: "aala"/"aali" = arrived, "kadun aale" = came from, "bheja" = sent, "aani" = and (use as item separator).
  - "unit" is optional per item — omit if not mentioned.
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
  Default days to 30, top_n to 5. Use 0 for "aaj"/"today", 1 for "kal"/"yesterday".
  Examples:
  - "Kaal sarvat jast konta material consume zala?" -> { "days": 1, "top_n": 5 }
  - "This week konti materials jast geli top 3?" -> { "days": 7, "top_n": 3 }
  - "Last month sarvat jast consume zaleye konti?" -> { "days": 30, "top_n": 5 }
  - "Kal kiti materials vaparle?" -> { "days": 1, "top_n": 5 }
  - "Aaj kitna material gela?" -> { "days": 0, "top_n": 5 }
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
  Default days to 30, top_n to 5.
  Examples:
  - "Kal sarvat jast konty material che GRN aale?" -> { "days": 1, "top_n": 5 }
  - "This week konti materials jast aali?" -> { "days": 7, "top_n": 5 }
  - "This month top 3 received materials?" -> { "days": 30, "top_n": 3 }
  - "Aaj sarvat jast GRN konty material che aale?" -> { "days": 0, "top_n": 5 }
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
- "bom_detail" — user asks what the bill of materials is for a specific product.
  extracted fields: { "product_name": string }
  Examples:
  - "KS4 motor cha BOM kay aahe?" -> { "product_name": "KS4 motor" }
  - "KS6-1.5HP banvayala konti materials lagtat?" -> { "product_name": "KS6-1.5HP" }
  - "PANEL-STD cha bill of materials dikhao" -> { "product_name": "PANEL-STD" }
- "top_supplier" — user asks which supplier delivered the most this month/week/period.
  extracted fields: { "days"?: number }
  Default days to 30.
  Examples:
  - "Sarvat jast konty supplier ne pathavle this month?" -> { "days": 30 }
  - "This week konty supplier ne jast delivery keli?" -> { "days": 7 }
  - "Konty supplier ne sarvat jast maal dila?" -> { "days": 30 }
- "unknown" — neither intent fits.
  extracted fields: {}

Examples of correct create_grn extraction from mixed Hinglish/Marathi messages:
- Message: "copper aala 50 kg" -> extracted: { "items": [{ "material_name": "copper", "quantity": 50, "unit": "kg" }] }
- Message: "MS Sheet 3MM 1 pcs aani Hex Nut SS M6x1 1 pcs hindustan copper kadun aale" -> extracted: { "items": [{ "material_name": "MS Sheet 3MM", "quantity": 1, "unit": "pcs" }, { "material_name": "Hex Nut SS M6x1", "quantity": 1, "unit": "pcs" }], "supplier_name": "hindustan copper" }
- Message: "steel sheet 200 kg Sharma Traders ne bheja" -> extracted: { "items": [{ "material_name": "steel sheet", "quantity": 200, "unit": "kg" }], "supplier_name": "Sharma Traders" }

Respond with ONLY valid JSON, no markdown code fences, no preamble, no explanation. The response must match exactly this shape:
{ "intent": "check_stock" | "create_grn" | "recent_grn" | "consumption_summary" | "supplier_history" | "low_stock_list" | "grn_detail" | "pending_dispatches" | "grn_summary" | "top_consumption" | "material_list" | "stock_check_product" | "zero_stock_list" | "dispatch_summary" | "supplier_delivery_check" | "challan_detail" | "issue_summary" | "product_code_lookup" | "top_received" | "product_list" | "supplier_list" | "dispatch_detail" | "issue_detail" | "bom_detail" | "top_supplier" | "unknown", "extracted": { ...fields... } }`

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

interface MatchedMaterial {
  id: string
  name: string
  unit: string
  current_stock?: number
}

interface MatchedSupplier {
  id: string
  name: string
}

// check_stock match result — unchanged shape from Phase 4.
interface MatchEntitiesResultStock {
  status: 'matched' | 'no_match' | 'ambiguous'
  material?: MatchedMaterial
  supplier?: MatchedSupplier | null
  error?: string
}

interface MatchedGrnItem {
  material: MatchedMaterial
  quantity: number
  unit: string // always from material's real stored unit, never from extracted
  supplier: MatchedSupplier | null
}

// create_grn match result — array-based, one entry per extracted item.
interface MatchEntitiesResultGrn {
  status: 'matched' | 'partial' | 'no_match'
  items?: MatchedGrnItem[]
  blocked_items?: { material_name: string; reason: string }[]
}

type MatchEntitiesResult = MatchEntitiesResultStock | MatchEntitiesResultGrn

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
// Shared by both the check_stock and create_grn matching paths below.
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

// Resolves extracted.supplier_name against context.suppliers. A missing or
// ambiguous supplier match must not block the material match(es) — it's
// optional context, not a required field.
function matchSupplierName(supplierName: string | undefined, suppliers: Supplier[]): MatchedSupplier | null {
  if (!supplierName || !supplierName.trim()) {
    return null
  }
  const supplierMatches = findMatches(supplierName, suppliers)
  if (supplierMatches.length === 1) {
    return { id: supplierMatches[0].id, name: supplierMatches[0].name }
  }
  return null
}

// Resolves Haiku's free-text extraction against real DB rows. Haiku's text
// is only ever a search key here, never treated as identity — a single
// unambiguous match is required before anything downstream can act on it.
function matchEntities(context: AgentContext, haikuResult: HaikuResult): MatchEntitiesResult {
  const { intent, extracted } = haikuResult

  if (intent === 'check_stock') {
    const materialName = extracted.material_name ?? ''

    if (!materialName.trim()) {
      return { status: 'no_match', error: 'No material name was found in the message.' }
    }

    const matchResult = matchMaterialName(materialName, context.materials)

    if ('error' in matchResult) {
      return {
        status: matchResult.error.includes('ambiguous') ? 'ambiguous' : 'no_match',
        error: matchResult.error,
      }
    }

    const matchedMaterial = matchResult.material
    const balance = context.stockBalances.find((b) => b.raw_material_id === matchedMaterial.id)

    return {
      status: 'matched',
      material: {
        id: matchedMaterial.id,
        name: matchedMaterial.name,
        unit: matchedMaterial.unit,
        current_stock: balance?.current_stock,
      },
    }
  }

  // create_grn — loop over every extracted item, matching each independently.
  // Supplier is shared context and matched once, not per item.
  const items = extracted.items ?? []
  const supplier = matchSupplierName(extracted.supplier_name, context.suppliers)

  const matchedItems: MatchedGrnItem[] = []
  const blockedItems: { material_name: string; reason: string }[] = []

  for (const item of items) {
    if (!item.material_name || !item.material_name.trim()) {
      blockedItems.push({ material_name: item.material_name ?? '', reason: 'No material name was found for this item.' })
      continue
    }

    const matchResult = matchMaterialName(item.material_name, context.materials)

    if ('error' in matchResult) {
      blockedItems.push({ material_name: item.material_name, reason: matchResult.error })
      continue
    }

    matchedItems.push({
      material: {
        id: matchResult.material.id,
        name: matchResult.material.name,
        unit: matchResult.material.unit,
      },
      quantity: item.quantity,
      unit: matchResult.material.unit, // never item.unit — real stored unit only
      supplier,
    })
  }

  if (matchedItems.length === 0) {
    return { status: 'no_match', blocked_items: blockedItems }
  }

  if (blockedItems.length > 0) {
    return { status: 'partial', items: matchedItems, blocked_items: blockedItems }
  }

  return { status: 'matched', items: matchedItems }
}

interface ConfirmDataBlocked {
  status: 'blocked'
  reason: string
}

interface ConfirmDataReadyGrn {
  status: 'ready'
  items: Array<{
    confirm_text: string
    data: {
      material_id: string
      material_name: string
      quantity: number
      unit: string
      supplier_id: string | null
      supplier_name: string | null
    }
  }>
  blocked_items?: Array<{ material_name: string; reason: string }>
}

interface ConfirmDataReadyStock {
  status: 'ready'
  confirm_text: string
}

type ConfirmData = ConfirmDataBlocked | ConfirmDataReadyGrn | ConfirmDataReadyStock

// Builds the payload shown to the user before any write happens. Identity
// fields (material/unit/supplier names) come ONLY from matchResult — the
// real DB rows matchEntities() already resolved. The only field pulled from
// haikuResult.extracted is quantity, and only as a plain number.
function buildConfirmData(haikuResult: HaikuResult, matchResult: MatchEntitiesResult): ConfirmData {
  const { intent } = haikuResult

  if (intent === 'create_grn') {
    const grnMatch = matchResult as MatchEntitiesResultGrn

    if (grnMatch.status === 'no_match' || !grnMatch.items || grnMatch.items.length === 0) {
      const reason =
        grnMatch.blocked_items && grnMatch.blocked_items.length > 0
          ? grnMatch.blocked_items.map((b) => b.reason).join(' ')
          : 'No matching material was found.'
      return { status: 'blocked', reason }
    }

    const items = grnMatch.items
      .filter((item) => typeof item.quantity === 'number' && Number.isFinite(item.quantity) && item.quantity > 0)
      .map((item) => {
        const supplierClause = item.supplier
          ? ` from ${item.supplier.name}`
          : ' — no supplier matched, will save without one'

        return {
          confirm_text: `Record GRN: ${item.quantity} ${item.unit} of ${item.material.name}${supplierClause}.`,
          data: {
            material_id: item.material.id,
            material_name: item.material.name,
            quantity: item.quantity,
            unit: item.unit,
            supplier_id: item.supplier ? item.supplier.id : null,
            supplier_name: item.supplier ? item.supplier.name : null,
          },
        }
      })

    if (items.length === 0) {
      return { status: 'blocked', reason: 'No valid quantity was found in the message.' }
    }

    return {
      status: 'ready',
      items,
      blocked_items: grnMatch.blocked_items && grnMatch.blocked_items.length > 0 ? grnMatch.blocked_items : undefined,
    }
  }

  if (intent === 'check_stock') {
    const stockMatch = matchResult as MatchEntitiesResultStock

    if (stockMatch.status !== 'matched' || !stockMatch.material) {
      return { status: 'blocked', reason: stockMatch.error ?? 'No matching material was found.' }
    }

    const material = stockMatch.material
    const stock = material.current_stock ?? 0

    return {
      status: 'ready',
      confirm_text: `${material.name}: ${stock} ${material.unit} in hand.`,
    }
  }

  return { status: 'blocked', reason: 'Unrecognized request.' }
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

// Handles the read-only intents. Each returns a plain-text answer built
// from real DB rows — no confirm gate needed since nothing is written.
// Bypasses matchEntities()/buildConfirmData() entirely; those are check_stock
// and create_grn specific.
async function executeQuery(
  supabaseClient: ReturnType<typeof createClient>,
  tenantId: string,
  haikuResult: HaikuResult,
  context: AgentContext
): Promise<string> {
  const { intent, extracted } = haikuResult

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
      .limit(5)

    if (error) return 'Could not fetch supplier history.'
    if (!data?.length) return `No GRNs found from ${supplier.name}.`

    const materialMap = new Map(context.materials.map((m) => [m.id, m]))
    const lines = data.map((r) => {
      const mat = materialMap.get(r.raw_material_id)
      return `• ${r.grn_no} — ${r.quantity} ${mat?.unit ?? ''} of ${mat?.name ?? 'Unknown'} on ${r.transaction_date}`
    })
    return `Last 5 GRNs from ${supplier.name}:\n\n${lines.join('\n')}`
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
    const topN = extracted.top_n ?? 5

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
    const topN = extracted.top_n ?? 5

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
      .slice(0, 5)

    const lines = sorted.map((s, i) => `${i + 1}. ${s.name}: ${s.total.toFixed(2)} units received`)
    return `Top suppliers by quantity received (${periodLabel}):\n\n${lines.join('\n')}`
  }

  return 'Unrecognized query.'
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
    const body: Partial<AgentQueryRequest & ConfirmGrnRequest> = await req.json()

    if (body.action === 'confirm_grn') {
      return await confirmGrn(supabase, body)
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

    // New read-only intents bypass matchEntities/buildConfirmData entirely —
    // no write happens, so no confirm gate is needed.
    const READ_ONLY_INTENTS: HaikuIntent[] = [
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

    const matchResult = matchEntities(context, haikuResult)
    const confirmData = buildConfirmData(haikuResult, matchResult)

    // Determine log fields from confirmData
    const logSuccess = confirmData.status === 'ready'
    const logError = confirmData.status === 'blocked' ? (confirmData as ConfirmDataBlocked).reason : null
    const logMatchStatus = 'status' in matchResult ? matchResult.status : null

    void logInteraction(
      supabase,
      tenant_id,
      message,
      haikuResult.intent,
      haikuResult.extracted as Record<string, unknown>,
      logMatchStatus,
      logSuccess,
      logError
    )

    return respond({
      status: 'ok',
      intent: haikuResult.intent,
      extracted: haikuResult.extracted,
      match: matchResult,
      confirm: confirmData,
    })
  } catch (error) {
    return respond(
      { status: 'error', error: error instanceof Error ? error.message : 'Invalid request body' },
      400
    )
  }
})
