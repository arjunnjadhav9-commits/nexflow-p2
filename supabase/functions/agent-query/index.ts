// Supabase Edge Function: agent-query
// Phase 5 — create_grn extraction and matching became array-based so one
// message can report multiple materials against one shared supplier.
// Haiku (Phase 3) extracts intent + raw fields only; matchEntities() (Phase 4)
// resolves those raw fields against real p2_raw_materials / p2_suppliers rows
// in code — identity resolution is never trusted to the model.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import Anthropic from 'https://esm.sh/@anthropic-ai/sdk@0.32.0'
import XLSX from 'https://esm.sh/xlsx-js-style@1.2.0?bundle'
import ExcelJS from 'https://esm.sh/exceljs@4.3.0'

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

// send_challan only — emails a challan Excel via Resend.
const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY')

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

interface ConfirmMultiGrnRequest {
  action: 'confirm_multi_grn'
  tenant_id: string
  supplier_id: string | null
  items: Array<{
    material_id: string
    quantity: number
    unit: string
    material_name: string
    material_code: string | null
  }>
}

interface ConfirmMultiGrnRpcResult {
  success: boolean
  error?: string
  grn_no?: string
  items?: Array<{
    transaction_id: string
    material_name: string
    material_code: string | null
    quantity: number
    unit: string
  }>
}

interface UpdateGrnRatesRequest {
  action: 'update_grn_rates'
  tenant_id: string
  updates: Array<{
    transaction_id: string
    rate: number | null
    invoice_no: string | null
  }>
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
// Unlike ConfirmGenerateInvoiceRequest, rates are NOT client-supplied here
// (the modal has no per-item review step) — resolved server-side from
// p2_material_prices/p2_product_prices via buildInvoiceItemsForOrder, same
// as the Haiku-driven sendInvoiceConsolidated path.
interface ConfirmConsolidatedInvoiceRequest {
  action: 'confirm_consolidated_invoice'
  tenant_id: string
  client_id: string
  client_name: string
  date_from: string
  date_to: string
  gst_type: string
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
  challanMode: string
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
  | 'create_production_issue'
  | 'create_product_dispatch'
  | 'create_rm_dispatch'
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
  | 'send_challan'
  | 'send_tally_export'
  | 'send_invoice'
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
    items?: GrnItem[] // create_grn AND create_rm_dispatch — identical shape, reused as-is
    dispatch_items?: { product_name: string; quantity: number }[] // create_product_dispatch only
    supplier_name?: string // shared: create_grn, supplier_history, supplier_delivery_check
    days?: number // recent_grn, consumption_summary, top_received, top_supplier — default varies by intent
    grn_no?: string // grn_detail only
    challan_number?: string // challan_detail, dispatch_detail, issue_detail, send_challan
    recipient_name?: string | null // send_challan only — explicit client override; null/absent means "use the order's client_name"
    product_name?: string // stock_check_product, product_code_lookup, bom_detail
    quantity?: number // stock_check_product — how many units to produce
    top_n?: number // top_consumption, top_received — how many to show, default 5
    date_from?: string // send_tally_export, send_invoice — YYYY-MM-DD, absent means all-time / single-dispatch mode
    date_to?: string // send_tally_export, send_invoice — YYYY-MM-DD; if date_from is set but this isn't, defaults to today (send_tally_export only)
    client_name?: string // send_invoice only
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

  const { data: tenantSettings, error: settingsError } = await supabaseClient
    .from('p2_tenant_settings')
    .select('challan_mode')
    .eq('tenant_id', tenantId)
    .single()

  if (settingsError) {
    return { error: `Failed to load tenant settings: ${settingsError.message}` }
  }

  return {
    materials: (materials ?? []) as RawMaterial[],
    stockBalances: (stockBalances ?? []) as StockBalance[],
    products: (products ?? []) as Product[],
    suppliers: (suppliers ?? []) as Supplier[],
    challanMode: tenantSettings?.challan_mode ?? 'unified',
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

// Re-validates every matched material via confirm_agent_grn_multi (row-locked,
// tenant-scoped, unit-checked) and records all items under ONE shared GRN
// number. Sibling to confirmGrn() above, used only when create_grn extracted
// more than one material from a single message.
async function confirmMultiGrn(
  supabaseClient: ReturnType<typeof createClient>,
  body: Partial<ConfirmMultiGrnRequest>
): Promise<Response> {
  const { tenant_id, supplier_id, items } = body

  if (!tenant_id || !items?.length) {
    return respond({ status: 'error', error: 'Missing required fields' }, 400)
  }

  const rpcItems = items.map(item => ({
    material_id: item.material_id,
    quantity: item.quantity,
    unit: item.unit,
  }))

  const { data, error } = await supabaseClient.rpc('confirm_agent_grn_multi', {
    p_tenant_id: tenant_id,
    p_supplier_id: supplier_id ?? null,
    p_items: JSON.stringify(rpcItems),
  })

  if (error) {
    void logInteraction(supabaseClient, tenant_id, '', 'confirm_multi_grn', {}, null, false, error.message)
    return respond({ status: 'error', error: error.message }, 500)
  }

  const result = data as ConfirmMultiGrnRpcResult

  if (!result.success) {
    void logInteraction(supabaseClient, tenant_id, '', 'confirm_multi_grn', {}, null, false, result.error ?? 'RPC returned success:false')
    return respond({ status: 'ok', confirmed: false, error: result.error ?? 'GRN could not be saved.' })
  }

  void logInteraction(supabaseClient, tenant_id, '', 'confirm_multi_grn', {}, null, true, null)

  return respond({
    status: 'ok',
    confirmed: true,
    result: {
      grn_no: result.grn_no,
      items: result.items,
    },
    next: 'rate_invoice',
  })
}

// Updates rate/invoice_no on already-saved GRN transaction rows — an
// optional follow-up step after confirmMultiGrn(), not itself confirm-gated
// since the write (the GRN) already happened; this only edits metadata on
// rows the same session just created. Skips any update where both fields
// are null (nothing to write).
async function updateGrnRates(
  supabaseClient: ReturnType<typeof createClient>,
  body: Partial<UpdateGrnRatesRequest>
): Promise<Response> {
  const { tenant_id, updates } = body

  if (!tenant_id || !updates?.length) {
    return respond({ status: 'error', error: 'Missing required fields' }, 400)
  }

  for (const update of updates) {
    if (!update.transaction_id) continue
    if (update.rate === null && update.invoice_no === null) continue

    const { error } = await supabaseClient
      .from('p2_stock_transactions')
      .update({
        ...(update.rate !== null ? { rate: update.rate } : {}),
        ...(update.invoice_no !== null ? { invoice_no: update.invoice_no } : {}),
      })
      .eq('id', update.transaction_id)
      .eq('tenant_id', tenant_id)

    if (error) {
      void logInteraction(supabaseClient, tenant_id, '', 'update_grn_rates', {}, null, false, error.message)
      return respond({ status: 'error', error: error.message }, 500)
    }
  }

  void logInteraction(supabaseClient, tenant_id, '', 'update_grn_rates', {}, null, true, null)
  return respond({ status: 'ok', confirmed: true })
}

// Re-validates the matched product/BOM via confirm_bom_issue (row-locked,
// tenant-scoped) and records the production issue. Mirrors confirmGrn()'s
// re-fetch-at-write-time pattern — nothing from the parse phase is trusted.
async function confirmProductionIssue(
  supabaseClient: ReturnType<typeof createClient>,
  body: Partial<ConfirmProductionIssueRequest>
): Promise<Response> {
  const { tenant_id, product_id, product_name, quantity, bom_lines } = body

  if (!tenant_id || !product_id || !product_name || !quantity || !bom_lines?.length) {
    return respond({ status: 'error', error: 'Missing required fields for production issue' }, 400)
  }

  // Re-fetch tenant settings to get challan_mode at write time
  const { data: settings, error: settingsError } = await supabaseClient
    .from('p2_tenant_settings')
    .select('challan_mode')
    .eq('tenant_id', tenant_id)
    .single()

  if (settingsError) {
    return respond({ status: 'error', error: 'Could not load tenant settings' }, 500)
  }

  const challanMode = settings?.challan_mode ?? 'unified'

  // Re-fetch product to verify still active at write time
  const { data: product, error: productError } = await supabaseClient
    .from('p2_products')
    .select('id, name, is_active')
    .eq('tenant_id', tenant_id)
    .eq('id', product_id)
    .single()

  if (productError || !product) {
    return respond({ status: 'error', error: 'Product not found' }, 400)
  }

  if (!product.is_active) {
    return respond({ status: 'error', error: `Product "${product_name}" is no longer active` }, 400)
  }

  // Re-fetch BOM at write time to verify unchanged
  const { data: bomRows, error: bomError } = await supabaseClient
    .from('p2_product_bom')
    .select('raw_material_id, qty_per_unit, unit')
    .eq('tenant_id', tenant_id)
    .eq('product_id', product_id)

  if (bomError || !bomRows?.length) {
    return respond({ status: 'error', error: 'BOM not found or empty at write time' }, 400)
  }

  // Re-fetch stock balances at write time
  const { data: stockRows, error: stockError } = await supabaseClient
    .from('v_p2_stock_balance')
    .select('raw_material_id, name, unit, current_stock, material_code')
    .eq('tenant_id', tenant_id)

  if (stockError) {
    return respond({ status: 'error', error: 'Could not verify stock at write time' }, 500)
  }

  const typedStockRows = (stockRows ?? []) as { raw_material_id: string; name: string; unit: string; current_stock: number; material_code: string | null }[]
  const stockMap = new Map(typedStockRows.map((r) => [r.raw_material_id, r]))

  // Build consumption_json from re-fetched BOM
  const consumption = bomRows.map((row: { raw_material_id: string; qty_per_unit: number; unit: string }) => {
    const stockRow = stockMap.get(row.raw_material_id)
    return {
      material_id: row.raw_material_id,
      material_name: stockRow?.name ?? 'Unknown',
      material_code: stockRow?.material_code ?? null,
      qty: Math.round(row.qty_per_unit * quantity * 10000) / 10000,
      unit: row.unit,
    }
  })

  // Get next challan number
  const { data: challanNumber, error: challanError } = await supabaseClient
    .rpc('get_next_challan_number', {
      p_tenant_id: tenant_id,
      p_type: 'bom_issue',
      p_mode: challanMode,
    })

  if (challanError || !challanNumber) {
    return respond({ status: 'error', error: 'Could not generate challan number' }, 500)
  }

  // Today's IST calendar date, via the same IST boundary math used everywhere
  // else in this file (getISTDateRange) rather than Intl-based date parsing.
  const issueDate = getISTDateRange(0).since.split('T')[0]

  // Call confirm_bom_issue RPC — 9-parameter overload
  const { data: rpcResult, error: rpcError } = await supabaseClient.rpc('confirm_bom_issue', {
    p_tenant_id: tenant_id,
    p_challan_number: challanNumber,
    p_product_name: product_name,
    p_batch_qty: quantity,
    p_issue_date: issueDate,
    p_notes: 'Created via AI Copilot',
    p_consumption_json: JSON.stringify(consumption),
    p_manual_json: '[]',
    p_force: false,
  })

  if (rpcError) {
    // Surface duplicate check error clearly
    if (rpcError.message?.includes('DUPLICATE_ISSUE')) {
      void logInteraction(supabaseClient, tenant_id, '', 'confirm_production_issue', {}, null, false, 'duplicate_issue')
      return respond({
        status: 'ok',
        confirmed: false,
        error: `${product_name} × ${quantity} aaj already issue zala aahe. Dublyane issue karayche aahe ka? (Please use the production issue form to force.)`
      })
    }
    void logInteraction(supabaseClient, tenant_id, '', 'confirm_production_issue', {}, null, false, rpcError.message)
    return respond({ status: 'error', error: rpcError.message }, 500)
  }

  // Fire-and-forget low stock alert
  void (async () => {
    try {
      await fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/check-low-stock-instant`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${Deno.env.get('SB_SECRET_KEY')}`,
        },
        body: JSON.stringify({ tenant_id }),
      })
    } catch { /* fire-and-forget, never block */ }
  })()

  void logInteraction(supabaseClient, tenant_id, '', 'confirm_production_issue', {}, null, true, null)

  return respond({
    status: 'ok',
    confirmed: true,
    result: {
      order_id: rpcResult?.order_id,
      challan_number: (rpcResult as { challan_number?: string } | null)?.challan_number ?? challanNumber,
      product_name,
      quantity,
    },
    next: 'client_info'
  })
}

// Re-fetches and re-validates every product/BOM row at write time (mirrors
// confirmProductionIssue's re-fetch-at-write-time pattern), builds the
// dispatch order + items itself (unlike confirm_bom_issue, there is no
// single all-in-one RPC for product/RM dispatch — see dispatch.html), then
// deducts stock via confirm_dispatch_transaction.
async function confirmProductDispatch(
  supabaseClient: ReturnType<typeof createClient>,
  body: Partial<ConfirmProductDispatchRequest>
): Promise<Response> {
  const { tenant_id, items } = body

  if (!tenant_id || !items?.length) {
    return respond({ status: 'error', error: 'Missing required fields for product dispatch' }, 400)
  }

  for (const item of items) {
    if (!item.product_id || !item.product_name || typeof item.quantity !== 'number' || !Number.isFinite(item.quantity) || item.quantity <= 0 || !item.bom_lines?.length) {
      return respond({ status: 'error', error: 'Invalid item in request' }, 400)
    }
  }

  // Re-fetch tenant settings to get challan_mode at write time
  const { data: settings, error: settingsError } = await supabaseClient
    .from('p2_tenant_settings')
    .select('challan_mode')
    .eq('tenant_id', tenant_id)
    .single()

  if (settingsError) {
    console.error('[confirmProductDispatch] tenant settings fetch failed:', tenant_id, settingsError.message)
    void logInteraction(supabaseClient, tenant_id, '', 'confirm_product_dispatch', {}, null, false, `settings fetch: ${settingsError.message}`)
    return respond({ status: 'error', error: `Could not load tenant settings: ${settingsError.message}` }, 500)
  }

  const challanMode = settings?.challan_mode ?? 'unified'

  const consumptionArray: { material_id: string; qty: number }[] = []
  const itemRows: { product_id: string; qty_dispatched: number; unit: string }[] = []

  for (const item of items) {
    // Re-fetch product to verify still active at write time
    const { data: product, error: productError } = await supabaseClient
      .from('p2_products')
      .select('id, name, is_active, unit')
      .eq('tenant_id', tenant_id)
      .eq('id', item.product_id)
      .single()

    if (productError || !product) {
      return respond({ status: 'error', error: 'Product not found' }, 400)
    }

    if (!product.is_active) {
      return respond({ status: 'error', error: `Product "${item.product_name}" is no longer active` }, 400)
    }

    // Re-fetch BOM at write time to verify unchanged
    const { data: bomRows, error: bomError } = await supabaseClient
      .from('p2_product_bom')
      .select('raw_material_id, qty_per_unit, unit')
      .eq('tenant_id', tenant_id)
      .eq('product_id', item.product_id)

    if (bomError || !bomRows?.length) {
      return respond({ status: 'error', error: 'BOM not found or empty at write time' }, 400)
    }

    const exploded = explodeBomQty(bomRows as { raw_material_id: string; qty_per_unit: number; unit: string }[], item.quantity)
    for (const row of exploded) {
      consumptionArray.push({ material_id: row.raw_material_id, qty: row.qty })
    }

    itemRows.push({
      product_id: item.product_id,
      qty_dispatched: item.quantity,
      unit: item.unit || product.unit || 'NOS',
    })
  }

  // Get next challan number
  const { data: challanNumber, error: challanError } = await supabaseClient
    .rpc('get_next_challan_number', {
      p_tenant_id: tenant_id,
      p_type: 'product',
      p_mode: challanMode,
    })

  if (challanError || !challanNumber) {
    console.error('[confirmProductDispatch] get_next_challan_number failed:', tenant_id, challanError?.message ?? 'no challan number returned')
    void logInteraction(supabaseClient, tenant_id, '', 'confirm_product_dispatch', {}, null, false, `challan number: ${challanError?.message ?? 'no challan number returned'}`)
    return respond({ status: 'error', error: challanError?.message ?? 'Could not generate challan number' }, 500)
  }

  const dispatchDate = getISTDateRange(0).since.split('T')[0]

  const { data: order, error: orderError } = await supabaseClient
    .from('p2_dispatch_orders')
    .insert({
      tenant_id,
      created_by: tenant_id,
      dispatch_type: 'product',
      status: 'confirmed',
      challan_number: challanNumber,
      dispatch_date: dispatchDate,
    })
    .select('id')
    .single()

  if (orderError || !order) {
    console.error('[confirmProductDispatch] p2_dispatch_orders insert failed:', tenant_id, orderError?.message ?? 'no order row returned')
    void logInteraction(supabaseClient, tenant_id, '', 'confirm_product_dispatch', {}, null, false, `order insert: ${orderError?.message ?? 'order insert failed'}`)
    return respond({ status: 'error', error: orderError?.message ?? 'Could not create dispatch order' }, 500)
  }

  const orderId = order.id as string

  const { error: itemsError } = await supabaseClient
    .from('p2_dispatch_items')
    .insert(itemRows.map((row) => ({ ...row, dispatch_order_id: orderId, tenant_id })))

  if (itemsError) {
    console.error('[confirmProductDispatch] p2_dispatch_items insert failed:', tenant_id, orderId, itemsError.message)
    void logInteraction(supabaseClient, tenant_id, '', 'confirm_product_dispatch', {}, null, false, `items insert: ${itemsError.message}`)
    return respond({ status: 'error', error: itemsError.message }, 500)
  }

  const { error: rpcError } = await supabaseClient.rpc('confirm_dispatch_transaction', {
    p_dispatch_order_id: orderId,
    p_tenant_id: tenant_id,
    p_consumption_json: JSON.stringify(consumptionArray),
    p_challan_number: challanNumber,
  })

  if (rpcError) {
    console.error('[confirmProductDispatch] confirm_dispatch_transaction RPC failed:', tenant_id, orderId, rpcError.message)
    void logInteraction(supabaseClient, tenant_id, '', 'confirm_product_dispatch', {}, null, false, `confirm_dispatch_transaction: ${rpcError.message}`)
    return respond({ status: 'error', error: rpcError.message }, 500)
  }

  // Fire-and-forget low stock alert
  void (async () => {
    try {
      await fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/check-low-stock-instant`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${Deno.env.get('SB_SECRET_KEY')}`,
        },
        body: JSON.stringify({ tenant_id }),
      })
    } catch { /* fire-and-forget, never block */ }
  })()

  void logInteraction(supabaseClient, tenant_id, '', 'confirm_product_dispatch', {}, null, true, null)

  return respond({
    status: 'ok',
    confirmed: true,
    result: { order_id: orderId, challan_number: challanNumber },
    next: 'client_info',
  })
}

// Mirrors confirmProductDispatch's structure but with no BOM explosion — the
// consumption array is built directly from the confirmed items. Re-validates
// nothing about the material row itself (matches rm-dispatch.html's own
// confirmDispatch(), which likewise never re-checks stock before calling
// confirm_dispatch_transaction).
async function confirmRmDispatch(
  supabaseClient: ReturnType<typeof createClient>,
  body: Partial<ConfirmRmDispatchRequest>
): Promise<Response> {
  const { tenant_id, items } = body

  if (!tenant_id || !items?.length) {
    return respond({ status: 'error', error: 'Missing required fields for RM dispatch' }, 400)
  }

  for (const item of items) {
    if (!item.raw_material_id || !item.material_name || typeof item.quantity !== 'number' || !Number.isFinite(item.quantity) || item.quantity <= 0 || !item.unit) {
      return respond({ status: 'error', error: 'Invalid item in request' }, 400)
    }
  }

  // Re-fetch tenant settings to get challan_mode at write time
  const { data: settings, error: settingsError } = await supabaseClient
    .from('p2_tenant_settings')
    .select('challan_mode')
    .eq('tenant_id', tenant_id)
    .single()

  if (settingsError) {
    return respond({ status: 'error', error: 'Could not load tenant settings' }, 500)
  }

  const challanMode = settings?.challan_mode ?? 'unified'

  const consumptionArray = items.map((item) => ({ material_id: item.raw_material_id, qty: item.quantity }))

  // Get next challan number
  const { data: challanNumber, error: challanError } = await supabaseClient
    .rpc('get_next_challan_number', {
      p_tenant_id: tenant_id,
      p_type: 'raw_material',
      p_mode: challanMode,
    })

  if (challanError || !challanNumber) {
    return respond({ status: 'error', error: 'Could not generate challan number' }, 500)
  }

  const dispatchDate = getISTDateRange(0).since.split('T')[0]

  const { data: order, error: orderError } = await supabaseClient
    .from('p2_dispatch_orders')
    .insert({
      tenant_id,
      created_by: tenant_id,
      dispatch_type: 'raw_material',
      status: 'confirmed',
      challan_number: challanNumber,
      dispatch_date: dispatchDate,
    })
    .select('id')
    .single()

  if (orderError || !order) {
    void logInteraction(supabaseClient, tenant_id, '', 'confirm_rm_dispatch', {}, null, false, orderError?.message ?? 'order insert failed')
    return respond({ status: 'error', error: 'Could not create dispatch order' }, 500)
  }

  const orderId = order.id as string

  const { error: itemsError } = await supabaseClient
    .from('p2_dispatch_items')
    .insert(items.map((item) => ({
      tenant_id,
      dispatch_order_id: orderId,
      raw_material_id: item.raw_material_id,
      material_name: item.material_name,
      material_code: item.material_code ?? null,
      qty_dispatched: item.quantity,
      unit: item.unit,
    })))

  if (itemsError) {
    void logInteraction(supabaseClient, tenant_id, '', 'confirm_rm_dispatch', {}, null, false, itemsError.message)
    return respond({ status: 'error', error: 'Could not save dispatch items' }, 500)
  }

  const { error: rpcError } = await supabaseClient.rpc('confirm_dispatch_transaction', {
    p_dispatch_order_id: orderId,
    p_tenant_id: tenant_id,
    p_consumption_json: JSON.stringify(consumptionArray),
    p_challan_number: challanNumber,
  })

  if (rpcError) {
    void logInteraction(supabaseClient, tenant_id, '', 'confirm_rm_dispatch', {}, null, false, rpcError.message)
    return respond({ status: 'error', error: rpcError.message }, 500)
  }

  // Fire-and-forget low stock alert
  void (async () => {
    try {
      await fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/check-low-stock-instant`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${Deno.env.get('SB_SECRET_KEY')}`,
        },
        body: JSON.stringify({ tenant_id }),
      })
    } catch { /* fire-and-forget, never block */ }
  })()

  void logInteraction(supabaseClient, tenant_id, '', 'confirm_rm_dispatch', {}, null, true, null)

  return respond({
    status: 'ok',
    confirmed: true,
    result: { order_id: orderId, challan_number: challanNumber },
    next: 'client_info',
  })
}

async function addProductionIssueClient(
  supabaseClient: ReturnType<typeof createClient<any>>,
  body: Partial<AddProductionIssueClientRequest>
): Promise<Response> {
  const { tenant_id, order_id, client_name, client_address, po_number, vehicle_number } = body

  if (!tenant_id || !order_id || !client_name?.trim()) {
    return respond({ status: 'error', error: 'tenant_id, order_id, and client_name are required' }, 400)
  }

  // Update the dispatch order with client info
  const { error: updateError } = await supabaseClient
    .from('p2_dispatch_orders')
    .update({
      client_name:    client_name.trim(),
      client_address: client_address?.trim() || null,
      po_number:      po_number?.trim()      || null,
      vehicle_number: vehicle_number?.trim() || null,
      updated_at:     new Date().toISOString()
    })
    .eq('id', order_id)
    .eq('tenant_id', tenant_id)

  if (updateError) {
    return respond({ status: 'error', error: updateError.message }, 500)
  }

  // Upsert client for future autocomplete
  await supabaseClient
    .from('p2_clients')
    .upsert(
      { tenant_id, name: client_name.trim(), address: client_address?.trim() || null },
      { onConflict: 'tenant_id,name' }
    )

  // Upsert PO number if provided
  if (po_number?.trim()) {
    await supabaseClient
      .from('p2_client_po_numbers')
      .upsert(
        { tenant_id, client_name: client_name.trim(), po_number: po_number.trim() },
        { onConflict: 'tenant_id,client_name,po_number' }
      )
  }

  void logInteraction(supabaseClient, tenant_id, '', 'add_production_issue_client', {}, null, true, null)

  return respond({ status: 'ok', confirmed: true })
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
  const todayIST = getISTDateRange(0).since.split('T')[0]

  const systemPrompt = `You classify a factory owner's message into one of the following intents. You do not match names to a database — extract text exactly as the user wrote it.

Today's date (IST): ${todayIST}

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
- "send_challan" — user wants to email a delivery challan to a client.
  extracted fields: { "challan_number": string, "recipient_name"?: string | null }
  Rules:
  - "recipient_name" is only set if the user explicitly names who to send it to. If they just say "pathav"/"send karo"/"email kar" without naming anyone, omit it or set null — the system uses the challan's own client.
  Examples:
  - "Challan 4325 KPML la pathav" -> { "challan_number": "4325", "recipient_name": "KPML" }
  - "4325 challan email kar" -> { "challan_number": "4325", "recipient_name": null }
  - "Challan 4325 pathav" -> { "challan_number": "4325", "recipient_name": null }
  IMPORTANT: This EMAILS an already-confirmed challan by number. Do not confuse with create_product_dispatch/create_rm_dispatch, which create a NEW dispatch.
- "send_tally_export" — user wants the GST/Tally CA export emailed to the CA.
  extracted fields: { "date_from"?: string (YYYY-MM-DD), "date_to"?: string (YYYY-MM-DD) }
  Rules:
  - Both fields are optional — omit both when the user gives no period at all, which means "all data".
  - If the user names an explicit date range, extract date_from and date_to directly.
  - If the user names a bare month ("July cha", "July madhla"), use the year from
    "Today's date" above and extract the full calendar month (1st to last day).
  - If the user says "last month", extract the full previous calendar month relative to "Today's date" above.
  - If the user says "aaj"/"today", set both date_from and date_to to today's date (from "Today's date" above).
  Examples (assuming Today's date above is 2026-07-27):
  - "CA la export pathav" -> {}
  - "CA la report pathav" -> {}
  - "Export CA la email kar" -> {}
  - "CA la CSV pathav" -> {}
  - "CA la 1st July te 31st July export pathav" -> { "date_from": "2026-07-01", "date_to": "2026-07-31" }
  - "CA la July cha export pathav" -> { "date_from": "2026-07-01", "date_to": "2026-07-31" }
  - "CA la last month cha report pathav" -> { "date_from": "2026-06-01", "date_to": "2026-06-30" }
  - "CA la aaj cha export pathav" -> { "date_from": "2026-07-27", "date_to": "2026-07-27" }
- "send_invoice" — user wants a client invoice (bill) generated and emailed. NOT a delivery challan (send_challan) — an invoice is what the client owes, sent after a challan already went out.
  extracted fields: { "client_name": string, "challan_number"?: string, "date_from"?: string (YYYY-MM-DD), "date_to"?: string (YYYY-MM-DD) }
  Rules:
  - "client_name" is required — extract exactly as the user said it.
  - "challan_number" — only if the user names a specific challan. Triggers a single-dispatch invoice for that challan.
  - "date_from"/"date_to" — only if the user names a date range (a period, not a single challan). Triggers a consolidated invoice covering every confirmed dispatch for that client in the range. Same date resolution rules as send_tally_export: bare month names and "last month" resolve to a full calendar range using "Today's date" above; do not set these for a plain "send the invoice" request with no period mentioned.
  - Never set both challan_number and a date range — if the user names a specific challan, that alone determines single mode.
  - If neither challan_number nor a date range is given, omit both — the system falls back to that client's latest confirmed dispatch.
  Examples (assuming Today's date above is 2026-07-30):
  - "KPML la invoice pathav" -> { "client_name": "KPML" }
  - "Last dispatch cha invoice pathav KPML la" -> { "client_name": "KPML" }
  - "Invoice 4325 challan sathi pathav KPML la" -> { "client_name": "KPML", "challan_number": "4325" }
  - "KPML la May 10 te 15 cha invoice pathav" -> { "client_name": "KPML", "date_from": "2026-05-10", "date_to": "2026-05-15" }
  - "KPML la July cha invoice pathav" -> { "client_name": "KPML", "date_from": "2026-07-01", "date_to": "2026-07-31" }
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
- "create_production_issue" — user wants to issue materials for production of a product (BOM explosion). User mentions a product name and how many units to produce.
  extracted fields: { "product_name": string, "quantity": number }
  Rules:
  - "product_name" is exactly as the user said it — do not resolve to DB.
  - "quantity" is the number of units to produce. Default to 1 if not mentioned.
  - Strip Hinglish/Marathi filler: "issue karo" = issue/do, "banva" = make/produce, "batch" = batch.
  Examples:
  - "KS4 motor 5 issue karo" -> { "product_name": "KS4 motor", "quantity": 5 }
  - "KS6-1.5HP 10 banva" -> { "product_name": "KS6-1.5HP", "quantity": 10 }
  - "3 pump assembly issue" -> { "product_name": "pump assembly", "quantity": 3 }
  IMPORTANT: Only use this intent when the user wants to ISSUE/CONSUME materials for production, not just check stock. "Enough stock aahe ka?" = stock_check_product. "Issue karo / banva" = create_production_issue.
- "create_product_dispatch" — user wants to dispatch/ship finished product(s) OUT to a client (not consume materials for internal production). User names product(s) and quantity to send.
  extracted fields: { "dispatch_items": [{ "product_name": string, "quantity": number }] }
  Rules:
  - "dispatch_items" is always an array, even for a single product.
  - "product_name" exactly as the user said it — partial/loose names are fine, do not resolve to DB.
  - "quantity" defaults to 1 if not mentioned.
  - Strip Hinglish/Marathi filler: "dispatch karo"/"pathva"/"bhejaycha aahe"/"send karo" = dispatch/send, "aani" = and (item separator).
  Examples:
  - "Panel 5 dispatch karo" -> { "dispatch_items": [{ "product_name": "Panel", "quantity": 5 }] }
  - "KS4 motor 10 ani KS6 pump 3 pathav" -> { "dispatch_items": [{ "product_name": "KS4 motor", "quantity": 10 }, { "product_name": "KS6 pump", "quantity": 3 }] }
  - "KS4 1 ani KS6 1 dispatch karo" -> { "dispatch_items": [{ "product_name": "KS4", "quantity": 1 }, { "product_name": "KS6", "quantity": 1 }] }
  - "KS4 motor ani panel dispatch karo" -> { "dispatch_items": [{ "product_name": "KS4 motor", "quantity": 1 }, { "product_name": "panel", "quantity": 1 }] }
  IMPORTANT: Only when user wants to DISPATCH/SEND products out to a client. "Issue karo"/"banva" for internal production consumption = create_production_issue. "Dispatch karo / pathav" = create_product_dispatch.
  IMPORTANT: If the user mentions names that match known products (listed above as Known products), always use create_product_dispatch, never create_rm_dispatch. create_rm_dispatch is ONLY for raw materials. When in doubt and the names could be either, prefer create_product_dispatch.
- "create_rm_dispatch" — user wants to dispatch raw material(s) OUT directly (to a client or elsewhere), not report receiving them.
  extracted fields: { "items": [{ "material_name": string, "quantity": number, "unit"?: string }] }
  Rules:
  - "items" is always an array, even for a single material.
  - "material_name" exactly as the user said it.
  - "pathva"/"dispatch karo" = dispatch.
  Examples:
  - "MS Sheet 50 kg dispatch karo" -> { "items": [{ "material_name": "MS Sheet", "quantity": 50, "unit": "kg" }] }
  - "Hex Bolt 100 ani Bearing 20 pathav" -> { "items": [{ "material_name": "Hex Bolt", "quantity": 100 }, { "material_name": "Bearing", "quantity": 20 }] }
  IMPORTANT: "aala"/"aali"/"kadun aale" = incoming = create_grn. "pathva"/"dispatch karo"/"send karo" = outgoing = create_rm_dispatch. Never confuse direction — this is the opposite of create_grn.
- "unknown" — neither intent fits.
  extracted fields: {}

Examples of correct create_grn extraction from mixed Hinglish/Marathi messages:
- Message: "copper aala 50 kg" -> extracted: { "items": [{ "material_name": "copper", "quantity": 50, "unit": "kg" }] }
- Message: "MS Sheet 3MM 1 pcs aani Hex Nut SS M6x1 1 pcs hindustan copper kadun aale" -> extracted: { "items": [{ "material_name": "MS Sheet 3MM", "quantity": 1, "unit": "pcs" }, { "material_name": "Hex Nut SS M6x1", "quantity": 1, "unit": "pcs" }], "supplier_name": "hindustan copper" }
- Message: "steel sheet 200 kg Sharma Traders ne bheja" -> extracted: { "items": [{ "material_name": "steel sheet", "quantity": 200, "unit": "kg" }], "supplier_name": "Sharma Traders" }

Respond with ONLY valid JSON, no markdown code fences, no preamble, no explanation. The response must match exactly this shape:
{ "intent": "check_stock" | "create_grn" | "create_production_issue" | "create_product_dispatch" | "create_rm_dispatch" | "recent_grn" | "consumption_summary" | "supplier_history" | "low_stock_list" | "grn_detail" | "pending_dispatches" | "grn_summary" | "top_consumption" | "material_list" | "stock_check_product" | "zero_stock_list" | "dispatch_summary" | "supplier_delivery_check" | "challan_detail" | "issue_summary" | "product_code_lookup" | "top_received" | "product_list" | "supplier_list" | "dispatch_detail" | "issue_detail" | "send_challan" | "send_tally_export" | "send_invoice" | "bom_detail" | "top_supplier" | "unknown", "extracted": { ...fields... } }`

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
  material_code?: string | null
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

interface BomLine {
  raw_material_id: string
  material_name: string
  material_code: string | null
  required_qty: number
  unit: string
  current_stock: number
  sufficient: boolean
}

interface ConfirmProductionIssueRequest {
  action: 'confirm_production_issue'
  tenant_id: string
  product_id: string
  product_name: string
  quantity: number
  bom_lines: BomLine[]
}

// Lighter than BomLine — confirmProductDispatch re-fetches BOM at write time
// and only checks bom_lines for non-empty presence (same pattern
// confirmProductionIssue already uses for its own bom_lines field), so
// material_name/current_stock/sufficient aren't needed on the wire. The full
// BomLine shape is still used internally during the parse phase to compute
// the stock-sufficiency block/pass decision and render the confirm card.
interface DispatchBomLine {
  raw_material_id: string
  qty: number
}

interface ConfirmProductDispatchItem {
  product_id: string
  product_name: string
  quantity: number
  unit: string
  bom_lines: DispatchBomLine[]
}

interface ConfirmProductDispatchRequest {
  action: 'confirm_product_dispatch'
  tenant_id: string
  items: ConfirmProductDispatchItem[]
}

interface ConfirmRmDispatchItem {
  raw_material_id: string
  material_name: string
  material_code: string | null
  quantity: number
  unit: string
}

interface ConfirmRmDispatchRequest {
  action: 'confirm_rm_dispatch'
  tenant_id: string
  items: ConfirmRmDispatchItem[]
}

interface AddProductionIssueClientRequest {
  action: 'add_production_issue_client'
  tenant_id: string
  order_id: string
  client_name: string
  client_address?: string
  po_number?: string
  vehicle_number?: string
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

// Multiplies each BOM row's qty_per_unit by the requested quantity, rounded
// to 4dp — identical math to create_production_issue's inline version, but
// factored out here so create_product_dispatch's parse-phase stock check and
// confirmProductDispatch's write-phase re-explosion can't drift from each
// other. Scoped only to the two new dispatch intents — not wired into
// confirmProductionIssue or its parse block, which keep their own inline math.
function explodeBomQty(
  bomRows: { raw_material_id: string; qty_per_unit: number; unit: string }[],
  quantity: number
): { raw_material_id: string; qty: number; unit: string }[] {
  return bomRows.map((row) => ({
    raw_material_id: row.raw_material_id,
    qty: Math.round(row.qty_per_unit * quantity * 10000) / 10000,
    unit: row.unit,
  }))
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

// send_challan only — local row/result shapes for the challan-email flow.
interface ClientRow {
  id: string
  name: string
  email: string | null
}

interface DispatchOrderForChallan {
  id: string
  challan_number: string
  client_name: string
  client_address: string | null
  status: string
  dispatch_date: string | null
  po_number: string | null
  dispatch_token: string | null
  dispatch_type: string | null
}

interface DispatchItemForChallan {
  // Null for product-dispatch rows at the raw DB level — neither write path
  // (dispatch.html, confirmProductDispatch) denormalises a name onto
  // p2_dispatch_items for those. By the time a DispatchItemForChallan exists,
  // sendChallanIntent has already resolved it from p2_products, so it reads
  // as non-optional to every consumer (challanDescription, buildChallanWorkbook).
  material_name: string
  material_code: string | null
  qty_dispatched: number
  unit: string
}

interface TenantSettingsForChallan {
  company_name: string | null
  address_line1: string | null
  address_line2: string | null
  gstin: string | null
  mobile: string | null
  email: string | null
}

interface SendChallanResult {
  text: string
  success: boolean
  matchStatus: string | null
  errorReason: string | null
}

interface SendTallyExportResult {
  text: string
  success: boolean
  errorReason: string | null
}

interface SendInvoiceResult {
  text: string
  success: boolean
  errorReason: string | null
}

// send_invoice + confirm_generate_invoice — client row shape needs gstin/
// address on top of ClientRow's id/name/email, so it's its own type rather
// than widening ClientRow (which send_challan also uses, unmodified).
interface InvoiceClientRow {
  id: string
  name: string
  address: string | null
  gstin: string | null
  email: string | null
}

// Resolves extracted.recipient_name (or order.client_name as fallback)
// against p2_clients. Unlike matchSupplierName, this is a required/blocking
// match (mirrors matchMaterialName's 3-way result shape) — a missing or
// ambiguous client must stop the send, not silently fall through.
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
        material_code: matchResult.material.material_code,
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
      material_code: string | null
      quantity: number
      unit: string
      supplier_id: string | null
      supplier_name: string | null
    }
  }>
  supplier_id: string | null
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
            material_code: item.material.material_code ?? null,
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
      supplier_id: items[0]?.data.supplier_id ?? null,
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

// Mirrors the description rule in challan.html's populateChallan(): internal
// material codes are fine on an Issue Materials or RM Dispatch challan, but a
// Product Dispatch goes to an external client and must always show a readable
// product name, never an internal SKU code.
function challanDescription(dispatchType: string | null, item: DispatchItemForChallan): string {
  if (dispatchType === 'product') return item.material_name || ''
  return item.material_code || item.material_name || ''
}

// Builds the styled challan workbook as a base64 xlsx string. Pure formatting,
// no I/O.
//
// Currently UNCALLED and kept on purpose — send_challan stopped attaching the
// Excel once the /receive link took over, but the recipient still downloads a
// workbook from that page and this is the server-side layout of record. Do not
// delete it as dead code; if a second layout is ever needed, extend this one.
function buildChallanWorkbook(params: {
  companyName: string
  addressLine1: string | null
  addressLine2: string | null
  gstin: string | null
  mobile: string | null
  clientName: string
  clientAddressLines: string[]
  challanNumber: string
  dispatchDateFormatted: string
  poNumber: string | null
  items: DispatchItemForChallan[]
  dispatchType: string | null
}): string {
  const rows: (string | number)[][] = []
  rows.push(['DELIVERY CHALLAN', '', '', '']) // row 1
  rows.push([params.companyName, '', '', '']) // row 2
  rows.push(['', '', '', '']) // row 3 — address block, value set on ws['A3'] after aoa_to_sheet
  rows.push(['', '', '', '']) // row 4 — blank
  rows.push(['TO,', '', 'Challan No.', params.challanNumber]) // row 5
  rows.push([params.clientName, '', 'Date', params.dispatchDateFormatted]) // row 6
  rows.push([params.clientAddressLines[0] ?? '', '', 'Po No.', params.poNumber || 'N/A']) // row 7
  rows.push([params.clientAddressLines[1] ?? '', '', '', '']) // row 8
  rows.push(['Please receive the following material in good condition', '', '', '']) // row 9
  rows.push(['Sr.No.', 'Description', 'Quantity', 'Unit']) // header row (row 10)
  params.items.forEach((item, i) => {
    rows.push([i + 1, challanDescription(params.dispatchType, item), item.qty_dispatched, item.unit])
  })
  const totalQty = params.items.reduce((sum, it) => sum + Number(it.qty_dispatched || 0), 0)
  rows.push(['TOTAL', '', totalQty, ''])
  rows.push(['', '', '', '']) // blank spacer row
  const sigRow1Idx = rows.length
  rows.push(["Receiver's Signature", '', `For ${params.companyName}`, ''])
  const sigRow2Idx = rows.length
  rows.push(['', '', 'Authorized Signatory', ''])

  const ws = XLSX.utils.aoa_to_sheet(rows)
  ws['!merges'] = [
    { s: { r: 0, c: 0 }, e: { r: 0, c: 3 } },
    { s: { r: 1, c: 0 }, e: { r: 1, c: 3 } },
    { s: { r: 2, c: 0 }, e: { r: 2, c: 3 } },
    { s: { r: 8, c: 0 }, e: { r: 8, c: 3 } },
    { s: { r: sigRow1Idx, c: 0 }, e: { r: sigRow1Idx, c: 1 } },
    { s: { r: sigRow1Idx, c: 2 }, e: { r: sigRow1Idx, c: 3 } },
    { s: { r: sigRow2Idx, c: 2 }, e: { r: sigRow2Idx, c: 3 } },
  ]
  ws['!cols'] = [{ wch: 8 }, { wch: 35 }, { wch: 12 }, { wch: 15 }]

  const range = XLSX.utils.decode_range(ws['!ref'] as string)
  const thinBorder = {
    top: { style: 'thin', color: { rgb: '000000' } },
    bottom: { style: 'thin', color: { rgb: '000000' } },
    left: { style: 'thin', color: { rgb: '000000' } },
    right: { style: 'thin', color: { rgb: '000000' } },
  }
  for (let R = range.s.r; R <= range.e.r; R++) {
    for (let C = range.s.c; C <= range.e.c; C++) {
      const cellRef = XLSX.utils.encode_cell({ r: R, c: C })
      if (!ws[cellRef]) ws[cellRef] = { v: '', t: 's' }
      ws[cellRef].s = { border: thinBorder }
    }
  }

  ws['A1'].s = { ...ws['A1'].s, font: { bold: true, sz: 14 }, alignment: { horizontal: 'center' } }
  ws['A2'].s = { ...ws['A2'].s, font: { bold: true, sz: 12 }, alignment: { horizontal: 'center' } }
  ws['A3'].v = `${params.addressLine1 ?? ''}\n${params.addressLine2 ?? ''}\nMobile: ${params.mobile ?? ''}\nGSTIN: ${params.gstin ?? ''}`
  ws['A3'].s = { ...ws['A3'].s, alignment: { horizontal: 'center', wrapText: true } }

  for (let C = 0; C <= 3; C++) {
    const headerRef = XLSX.utils.encode_cell({ r: 9, c: C })
    ws[headerRef].s = {
      ...ws[headerRef].s,
      font: { bold: true },
      fill: { patternType: 'solid', fgColor: { rgb: 'FFEEEEEE' } },
    }
  }

  const receiverSigRef = XLSX.utils.encode_cell({ r: sigRow1Idx, c: 0 })
  const forCompanyRef = XLSX.utils.encode_cell({ r: sigRow1Idx, c: 2 })
  ws[receiverSigRef].s = { ...ws[receiverSigRef].s, font: { bold: true } }
  ws[forCompanyRef].s = { ...ws[forCompanyRef].s, font: { bold: true } }

  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Challan')
  return XLSX.write(wb, { type: 'base64', bookType: 'xlsx', cellStyles: true }) as string
}

// Company and client names are owner-entered free text and go straight into an
// HTML email body — escaped so a stray & or < cannot break the markup.
function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

// send_challan only — sends the challan email via Resend. Mirrors
// check-low-stock-instant's sendTelegramMessage guard/fetch/catch shape.
//
// No attachment, deliberately. The /receive link carries the full challan plus
// its own Excel and PDF downloads, so an attached copy adds nothing and costs
// deliverability.
async function sendChallanEmail(params: {
  toEmail: string
  clientName: string
  challanNumber: string
  dispatchDateFormatted: string
  companyName: string
  mobile: string | null
  replyToEmail: string | null
  // Tier 4 /receive page for this dispatch. Null only when the order predates
  // dispatch_token — the link is then omitted rather than pointing nowhere.
  receiveUrl: string | null
}): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!RESEND_API_KEY) {
    console.error('[sendChallanEmail] RESEND_API_KEY not configured')
    return { ok: false, error: 'RESEND_API_KEY not configured' }
  }

  const linkBlock = params.receiveUrl
    ? `<p style="margin-top:16px;">
    <a href="${params.receiveUrl}" style="color:#ff5c1a; font-weight:600;">
      View &amp; verify this delivery online →
    </a>
  </p>`
    : ''

  const body: Record<string, unknown> = {
    from: 'Nexflow <challans@nexflowautomations.in>',
    to: [params.toEmail],
    subject: `Delivery Challan ${params.challanNumber} — ${params.companyName}`,
    text: `Dear ${params.clientName},\n\nDelivery Challan ${params.challanNumber} dated ${params.dispatchDateFormatted} has been dispatched to you.\n${params.receiveUrl ? `\nView & verify this delivery online: ${params.receiveUrl}\n` : ''}\nRegards,\n${params.companyName}\n${params.mobile ?? ''}`,
    html: `<p>Dear ${escapeHtml(params.clientName)},</p>
<p>Delivery Challan ${escapeHtml(params.challanNumber)} dated ${params.dispatchDateFormatted} has been dispatched to you.</p>
${linkBlock}
<p style="margin-top:16px;">Regards,<br>${escapeHtml(params.companyName)}<br>${escapeHtml(params.mobile ?? '')}</p>`,
  }
  if (params.replyToEmail && params.replyToEmail.trim()) {
    body.reply_to = params.replyToEmail
  }

  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    })

    if (!response.ok) {
      const errText = await response.text()
      console.error(`[sendChallanEmail] Resend API error for ${params.toEmail}:`, errText)
      return { ok: false, error: errText || `Resend API returned ${response.status}` }
    }

    return { ok: true }
  } catch (err) {
    console.error(`[sendChallanEmail] Failed to send to ${params.toEmail}:`, err)
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

const CHALLAN_ORDER_COLUMNS =
  'id, challan_number, client_name, client_address, status, dispatch_date, po_number, dispatch_token, dispatch_type'

// send_challan orchestrator — finds the confirmed challan, resolves the
// recipient client + email, builds the Excel, and sends it. Executes
// immediately, no confirm gate (this intent never writes to the DB).
async function sendChallanIntent(
  supabaseClient: ReturnType<typeof createClient>,
  tenantId: string,
  extracted: HaikuResult['extracted']
): Promise<SendChallanResult> {
  const challanNumber = (extracted.challan_number ?? '').trim()
  if (!challanNumber) {
    return { text: 'Please provide a challan number.', success: false, matchStatus: null, errorReason: 'no challan number' }
  }

  let { data: orders, error: orderError } = await supabaseClient
    .from('p2_dispatch_orders')
    .select(CHALLAN_ORDER_COLUMNS)
    .eq('tenant_id', tenantId)
    .eq('challan_number', challanNumber)
    .limit(1)

  if (orderError) {
    return { text: 'Could not fetch challan details.', success: false, matchStatus: null, errorReason: orderError.message }
  }

  if (!orders?.length) {
    const { data: likeOrders, error: likeError } = await supabaseClient
      .from('p2_dispatch_orders')
      .select(CHALLAN_ORDER_COLUMNS)
      .eq('tenant_id', tenantId)
      .ilike('challan_number', `%${challanNumber}`)
      .limit(5)

    if (likeError) {
      return { text: 'Could not fetch challan details.', success: false, matchStatus: null, errorReason: likeError.message }
    }
    orders = likeOrders
  }

  if (!orders?.length) {
    return { text: `Challan ${challanNumber} sapadla nahi`, success: false, matchStatus: null, errorReason: 'challan_not_found' }
  }

  if (orders.length > 1) {
    const nums = (orders as DispatchOrderForChallan[]).map((o) => o.challan_number).join(', ')
    return {
      text: `Multiple challans match "${challanNumber}": ${nums}. Please be more specific.`,
      success: false,
      matchStatus: null,
      errorReason: 'challan_ambiguous',
    }
  }

  const order = orders[0] as DispatchOrderForChallan

  if (order.status !== 'confirmed') {
    return { text: 'He challan confirmed nahi — pathavta yet nahi', success: false, matchStatus: null, errorReason: 'not_confirmed' }
  }

  const { data: items, error: itemsError } = await supabaseClient
    .from('p2_dispatch_items')
    .select('material_name, material_code, qty_dispatched, unit, product_id')
    .eq('tenant_id', tenantId)
    .eq('dispatch_order_id', order.id)

  if (itemsError) {
    return { text: 'Challan items load karta aale nahi.', success: false, matchStatus: null, errorReason: itemsError.message }
  }
  if (!items?.length) {
    return {
      text: `Challan ${order.challan_number} madhe items nahit — pathavta yet nahi`,
      success: false,
      matchStatus: null,
      errorReason: 'no_items',
    }
  }

  type DispatchItemRow = {
    material_name: string | null
    material_code: string | null
    qty_dispatched: number
    unit: string
    product_id: string | null
  }
  const itemRows = items as DispatchItemRow[]

  // Same gap and same fix as receive-dispatch: a product dispatch stores only
  // product_id on p2_dispatch_items, so material_name/material_code are null
  // at the row level and challanDescription() would render blank. One batched
  // .in() against p2_products for whatever's missing, not a query per row.
  //
  // Currently prep-only: buildChallanWorkbook() (the sole consumer of the
  // DispatchItemForChallan[] this produces) is not called anywhere in this
  // function — send_challan stopped attaching the Excel once the /receive
  // link took over. This resolution has to happen here regardless, since it
  // needs tenantId and the raw rows that are only in scope inside
  // sendChallanIntent. Whoever rewires the workbook call back in should use
  // `dispatchItems` below, not `items`.
  const missingProductIds = [
    ...new Set(
      itemRows
        .filter((it) => !it.material_name && it.product_id)
        .map((it) => it.product_id as string)
    ),
  ]

  const productsById = new Map<string, { name: string | null; product_code: string | null }>()

  if (missingProductIds.length) {
    const { data: products, error: productsError } = await supabaseClient
      .from('p2_products')
      .select('id, name, product_code')
      .eq('tenant_id', tenantId)
      .in('id', missingProductIds)

    if (productsError) {
      return { text: 'Product details load karta aale nahi.', success: false, matchStatus: null, errorReason: productsError.message }
    }

    for (const p of (products ?? []) as { id: string; name: string | null; product_code: string | null }[]) {
      productsById.set(p.id, { name: p.name, product_code: p.product_code })
    }
  }

  const dispatchItems: DispatchItemForChallan[] = itemRows.map((it) => {
    const product = it.product_id ? productsById.get(it.product_id) : undefined
    return {
      material_name: it.material_name ?? product?.name ?? '',
      material_code: it.material_code ?? product?.product_code ?? null,
      qty_dispatched: it.qty_dispatched,
      unit: it.unit,
    }
  })

  const { data: clients, error: clientsError } = await supabaseClient
    .from('p2_clients')
    .select('id, name, email')
    .eq('tenant_id', tenantId)

  if (clientsError) {
    return { text: 'Client list load karta aali nahi.', success: false, matchStatus: null, errorReason: clientsError.message }
  }

  const matchText = (extracted.recipient_name && extracted.recipient_name.trim()) || order.client_name
  const clientMatch = matchClientName(matchText, (clients ?? []) as ClientRow[])

  if ('error' in clientMatch) {
    return { text: clientMatch.error, success: false, matchStatus: clientMatch.errorKind, errorReason: clientMatch.errorKind }
  }

  const client = clientMatch.client

  if (!client.email || !client.email.trim()) {
    return {
      text: `${client.name} cha email Settings > Clients madhe add kara`,
      success: false,
      matchStatus: 'no_email',
      errorReason: 'client_no_email',
    }
  }

  const { data: settings, error: settingsError } = await supabaseClient
    .from('p2_tenant_settings')
    .select('company_name, address_line1, address_line2, gstin, mobile, email')
    .eq('tenant_id', tenantId)
    .single()

  if (settingsError || !settings) {
    return {
      text: 'Tenant settings load karta aale nahi.',
      success: false,
      matchStatus: 'matched',
      errorReason: settingsError?.message ?? 'no settings row',
    }
  }
  const tenantSettings = settings as TenantSettingsForChallan

  const dispatchDateObj = order.dispatch_date ? new Date(order.dispatch_date) : new Date()
  const dd = String(dispatchDateObj.getDate()).padStart(2, '0')
  const mm = String(dispatchDateObj.getMonth() + 1).padStart(2, '0')
  const yyyy = dispatchDateObj.getFullYear()
  const dispatchDateFormatted = `${dd}/${mm}/${yyyy}`

  // Not plan-gated. Verifying a delivery is utility, not a Pro feature — every
  // recipient gets the link, whatever their supplier pays us.
  const receiveUrl = order.dispatch_token
    ? `https://nexflowautomations.in/receive?token=${order.dispatch_token}`
    : null

  const emailResult = await sendChallanEmail({
    toEmail: client.email,
    clientName: order.client_name,
    challanNumber: order.challan_number,
    dispatchDateFormatted,
    companyName: tenantSettings.company_name ?? '',
    mobile: tenantSettings.mobile,
    replyToEmail: tenantSettings.email,
    receiveUrl,
  })

  if (!emailResult.ok) {
    return {
      text: `❌ Email pathavayala error aala — ${emailResult.error}`,
      success: false,
      matchStatus: 'matched',
      errorReason: emailResult.error,
    }
  }

  return {
    text: `✅ Challan ${order.challan_number} ${client.name} la pathavla (${client.email})`,
    success: true,
    matchStatus: 'matched',
    errorReason: null,
  }
}

// btoa() throws on any character outside Latin1, and only accepts a binary
// string anyway — never pass raw UTF-8 text to it. Chunked so spreading a
// large Uint8Array into String.fromCharCode in one call can't stack-overflow.
function encodeBase64(bytes: Uint8Array): string {
  let binary = ''
  const chunkSize = 0x8000
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize))
  }
  return btoa(binary)
}

function formatDDMMYYYY(dateStr: string): string {
  const d = new Date(dateStr)
  const dd = String(d.getDate()).padStart(2, '0')
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const yyyy = d.getFullYear()
  return `${dd}/${mm}/${yyyy}`
}

interface TallyExportRawMaterialJoin {
  name: string
  material_code: string | null
  hsn_sac: string | null
  gst_rate: number | null
  unit: string
}

interface TallyExportTxnRow {
  transaction_date: string
  quantity: number
  rate: number | null
  notes: string | null
  p2_raw_materials: TallyExportRawMaterialJoin
}

interface TallyExportInvoiceRow {
  invoice_number: string
  created_at: string
  client_name: string | null
  invoice_mode: string
  date_from: string | null
  date_to: string | null
  amount_subtotal: number
  amount_gst: number
  amount_total: number
  gst_type: string
}

const TALLY_EXPORT_JOIN_COLUMNS =
  'transaction_date, quantity, rate, notes, p2_raw_materials!inner(name, material_code, hsn_sac, gst_rate, unit)'

const TALLY_EXPORT_DATE_RE = /^\d{4}-\d{2}-\d{2}$/

function monthAbbr(d: Date): string {
  return d.toLocaleDateString('en-IN', { month: 'short' })
}

// send_tally_export orchestrator — builds the 17-column GST workbook (GRN,
// consumption, opening stock), optionally scoped to a date range, and emails
// it as an XLSX attachment to ca_email. Executes immediately, no confirm
// gate. Not in READ_ONLY_INTENTS on purpose (mirrors sendChallanIntent) —
// this is a write (sends an email) even though it never touches the DB
// beyond reading.
async function sendTallyExportIntent(
  supabaseClient: ReturnType<typeof createClient>,
  tenantId: string,
  context: AgentContext,
  dateFrom?: string,
  dateTo?: string
): Promise<SendTallyExportResult> {
  const { data: settings, error: settingsError } = await supabaseClient
    .from('p2_tenant_settings')
    .select('ca_email, company_name, email')
    .eq('tenant_id', tenantId)
    .single()

  if (settingsError || !settings) {
    return { text: 'Tenant settings load karta aale nahi.', success: false, errorReason: settingsError?.message ?? 'no settings row' }
  }

  const tenantSettings = settings as { ca_email: string | null; company_name: string | null; email: string | null }

  if (!tenantSettings.ca_email || !tenantSettings.ca_email.trim()) {
    return { text: '❌ CA email set nahi aahe. Settings madhe CA email add karo.', success: false, errorReason: 'no_ca_email' }
  }

  // Haiku output isn't trusted as-is — an unparseable date is treated as
  // absent rather than handed to a Postgres date filter.
  const validFrom = dateFrom && TALLY_EXPORT_DATE_RE.test(dateFrom) ? dateFrom : undefined
  const validTo = dateTo && TALLY_EXPORT_DATE_RE.test(dateTo) ? dateTo : undefined
  const todayISO = getISTDateRange(0).since.split('T')[0]
  // dateFrom alone means "from then to today" — dateTo alone (no dateFrom)
  // is not a supported combination, so it's dropped rather than guessed at.
  const effectiveFrom = validFrom
  const effectiveTo = validFrom ? (validTo ?? todayISO) : undefined

  const applyRange = <T extends { gte: (...args: unknown[]) => T; lte: (...args: unknown[]) => T }>(query: T): T => {
    let q = query
    if (effectiveFrom) q = q.gte('transaction_date', effectiveFrom)
    if (effectiveTo) q = q.lte('transaction_date', effectiveTo)
    return q
  }

  // p2_invoices has no transaction_date column — only created_at (a
  // timestamptz) — so it needs its own range helper with an IST offset
  // rather than reusing applyRange(). Same conditional shape: no range
  // resolved means no filter, so an all-time export still gets every
  // invoice, matching the other three sheets' all-time fallback.
  const applyInvoiceRange = <T extends { gte: (...args: unknown[]) => T; lte: (...args: unknown[]) => T }>(query: T): T => {
    let q = query
    if (effectiveFrom) q = q.gte('created_at', effectiveFrom + 'T00:00:00+05:30')
    if (effectiveTo) q = q.lte('created_at', effectiveTo + 'T23:59:59+05:30')
    return q
  }

  const [grnResult, consumptionResult, openingResult, invoiceResult] = await Promise.all([
    applyRange(
      supabaseClient
        .from('p2_stock_transactions')
        .select(TALLY_EXPORT_JOIN_COLUMNS)
        .eq('tenant_id', tenantId)
        .eq('transaction_type', 'grn')
    ),
    applyRange(
      supabaseClient
        .from('p2_stock_transactions')
        .select(TALLY_EXPORT_JOIN_COLUMNS)
        .eq('tenant_id', tenantId)
        .eq('transaction_type', 'consumption')
    ),
    applyRange(
      supabaseClient
        .from('p2_stock_transactions')
        .select(TALLY_EXPORT_JOIN_COLUMNS)
        .eq('tenant_id', tenantId)
        .eq('transaction_type', 'adjustment')
        .eq('notes', 'Opening Stock')
    ),
    applyInvoiceRange(
      supabaseClient
        .from('p2_invoices')
        .select('invoice_number, created_at, client_name, invoice_mode, date_from, date_to, amount_subtotal, amount_gst, amount_total, gst_type')
        .eq('tenant_id', tenantId)
        .order('created_at', { ascending: true })
    ),
  ])

  if (grnResult.error || consumptionResult.error || openingResult.error || invoiceResult.error) {
    return {
      text: '❌ Export tayar karta aala nahi.',
      success: false,
      errorReason:
        grnResult.error?.message ?? consumptionResult.error?.message ?? openingResult.error?.message ?? invoiceResult.error?.message ?? 'unknown query error',
    }
  }

  type TaggedRow = { type: 'grn' | 'consumption' | 'opening'; row: TallyExportTxnRow }
  const allRows: TaggedRow[] = [
    ...((grnResult.data ?? []) as unknown as TallyExportTxnRow[]).map((row) => ({ type: 'grn' as const, row })),
    ...((consumptionResult.data ?? []) as unknown as TallyExportTxnRow[]).map((row) => ({ type: 'consumption' as const, row })),
    ...((openingResult.data ?? []) as unknown as TallyExportTxnRow[]).map((row) => ({ type: 'opening' as const, row })),
  ]

  allRows.sort((a, b) => a.row.transaction_date.localeCompare(b.row.transaction_date))

  const workbook = new ExcelJS.Workbook()
  const worksheet = workbook.addWorksheet('CA Export')

  worksheet.columns = [
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
    { header: 'IGST Amount', key: 'igstAmount', width: 14 },
    { header: 'Total GST Amount', key: 'totalGst', width: 16, numFmt: '#,##0.00' },
    { header: 'Invoice Total', key: 'invoiceTotal', width: 14, numFmt: '#,##0.00' },
  ]

  worksheet.getRow(1).eachCell((cell: any) => {
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' } }
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFF5C1A' } }
    cell.alignment = { horizontal: 'center', vertical: 'middle' }
  })

  for (const { type, row } of allRows) {
    const rm = row.p2_raw_materials
    const date = formatDDMMYYYY(row.transaction_date)
    const materialCode = rm.material_code ?? ''
    const hsnSac = rm.hsn_sac ?? ''

    if (type === 'grn') {
      const rate = row.rate ?? 0
      const qty = row.quantity
      const amount = qty * rate
      const gstRate = rm.gst_rate ?? 0
      const cgstRate = gstRate / 2
      const sgstRate = gstRate / 2
      const cgstAmount = (amount * cgstRate) / 100
      const sgstAmount = (amount * sgstRate) / 100
      const totalGst = cgstAmount + sgstAmount
      const invoiceTotal = amount + totalGst

      worksheet.addRow({
        date, material: rm.name, materialCode, hsnSac, transactionType: 'GRN (Purchase)',
        quantity: qty, unit: rm.unit, rate, amount,
        cgstRate, cgstAmount, sgstRate, sgstAmount, igstRate: '', igstAmount: '',
        totalGst, invoiceTotal,
      })
    } else if (type === 'consumption') {
      worksheet.addRow({
        date, material: rm.name, materialCode, hsnSac, transactionType: 'Consumption (Issue)',
        quantity: Math.abs(row.quantity), unit: rm.unit, rate: '', amount: '',
        cgstRate: '', cgstAmount: '', sgstRate: '', sgstAmount: '', igstRate: '', igstAmount: '',
        totalGst: '', invoiceTotal: '',
      })
    } else {
      worksheet.addRow({
        date, material: rm.name, materialCode, hsnSac, transactionType: 'Opening Stock',
        quantity: row.quantity, unit: rm.unit, rate: '', amount: '',
        cgstRate: '', cgstAmount: '', sgstRate: '', sgstAmount: '', igstRate: '', igstAmount: '',
        totalGst: '', invoiceTotal: '',
      })
    }
  }

  worksheet.views = [{ state: 'frozen', ySplit: 1 }]

  const invoiceSheet = workbook.addWorksheet('Invoices')

  invoiceSheet.columns = [
    { header: 'Invoice No', key: 'invoiceNo', width: 18 },
    { header: 'Date', key: 'date', width: 14 },
    { header: 'Client', key: 'client', width: 28 },
    { header: 'Mode', key: 'mode', width: 14 },
    { header: 'Period From', key: 'periodFrom', width: 14 },
    { header: 'Period To', key: 'periodTo', width: 14 },
    { header: 'Subtotal (₹)', key: 'subtotal', width: 14, numFmt: '#,##0.00' },
    { header: 'CGST (₹)', key: 'cgst', width: 12, numFmt: '#,##0.00' },
    { header: 'SGST (₹)', key: 'sgst', width: 12, numFmt: '#,##0.00' },
    { header: 'IGST (₹)', key: 'igst', width: 12, numFmt: '#,##0.00' },
    { header: 'Total (₹)', key: 'total', width: 14, numFmt: '#,##0.00' },
  ]

  invoiceSheet.getRow(1).eachCell((cell: any) => {
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' } }
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFF5C1A' } }
    cell.alignment = { horizontal: 'center', vertical: 'middle' }
  })

  for (const inv of (invoiceResult.data ?? []) as unknown as TallyExportInvoiceRow[]) {
    const isConsolidated = inv.invoice_mode === 'consolidated'
    const gstAmount = Number(inv.amount_gst) || 0
    let cgst: number | string = ''
    let sgst: number | string = ''
    let igst: number | string = ''
    if (inv.gst_type === 'cgst_sgst') {
      cgst = gstAmount / 2
      sgst = gstAmount / 2
    } else if (inv.gst_type === 'igst') {
      igst = gstAmount
    }
    // 'none' — all three stay blank

    invoiceSheet.addRow({
      invoiceNo: inv.invoice_number,
      date: formatDDMMYYYY(inv.created_at),
      client: inv.client_name ?? '',
      mode: isConsolidated ? 'Consolidated' : 'Single',
      periodFrom: isConsolidated && inv.date_from ? formatDDMMYYYY(inv.date_from) : '',
      periodTo: isConsolidated && inv.date_to ? formatDDMMYYYY(inv.date_to) : '',
      subtotal: Number(inv.amount_subtotal) || 0,
      cgst, sgst, igst,
      total: Number(inv.amount_total) || 0,
    })
  }

  invoiceSheet.views = [{ state: 'frozen', ySplit: 1 }]

  const buffer = await workbook.xlsx.writeBuffer()
  const base64 = encodeBase64(new Uint8Array(buffer))

  const today = new Date()
  const dd = String(today.getDate()).padStart(2, '0')
  const mm = String(today.getMonth() + 1).padStart(2, '0')
  const yyyy = today.getFullYear()

  let filename: string
  let periodText: string | null = null

  if (!effectiveFrom && !effectiveTo) {
    filename = `CA_Export_${dd}${mm}${yyyy}.xlsx`
  } else {
    const fromStr = effectiveFrom ?? effectiveTo!
    const toStr = effectiveTo ?? effectiveFrom!
    const fromDate = new Date(fromStr)
    const toDate = new Date(toStr)
    periodText = `${formatDDMMYYYY(fromStr)} – ${formatDDMMYYYY(toStr)}`

    const sameMonth = fromDate.getFullYear() === toDate.getFullYear() && fromDate.getMonth() === toDate.getMonth()
    if (sameMonth) {
      filename = `CA_Export_${monthAbbr(fromDate)}${fromDate.getFullYear()}.xlsx`
    } else {
      const fromDD = String(fromDate.getDate()).padStart(2, '0')
      const toDD = String(toDate.getDate()).padStart(2, '0')
      filename = `CA_Export_${fromDD}${monthAbbr(fromDate)}_${toDD}${monthAbbr(toDate)}${toDate.getFullYear()}.xlsx`
    }
  }

  if (!RESEND_API_KEY) {
    console.error('[sendTallyExportIntent] RESEND_API_KEY not configured')
    return { text: '❌ Email pathavayala error aala. Please try again.', success: false, errorReason: 'RESEND_API_KEY not configured' }
  }

  const body: Record<string, unknown> = {
    from: 'Nexflow <challans@nexflowautomations.in>',
    to: [tenantSettings.ca_email],
    subject: `Nexflow CA Export — ${tenantSettings.company_name ?? ''} (${dd}/${mm}/${yyyy})`,
    html: `<p>Please find the CA export attached. Generated from Nexflow P2.</p>`,
    attachments: [{ filename, content: base64 }],
  }
  if (tenantSettings.email && tenantSettings.email.trim()) {
    body.reply_to = tenantSettings.email
  }

  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    })

    if (!response.ok) {
      const errText = await response.text()
      console.error('[sendTallyExportIntent] Resend API error:', errText)
      return { text: '❌ Email pathavayala error aala. Please try again.', success: false, errorReason: errText || `Resend API returned ${response.status}` }
    }
  } catch (err) {
    console.error('[sendTallyExportIntent] Failed to send:', err)
    return { text: '❌ Email pathavayala error aala. Please try again.', success: false, errorReason: err instanceof Error ? err.message : String(err) }
  }

  return {
    text: periodText
      ? `✅ CA export pathavla ${tenantSettings.ca_email} la. Period: ${periodText}. File: ${filename}`
      : `✅ CA export pathavla ${tenantSettings.ca_email} la. File: ${filename}`,
    success: true,
    errorReason: null,
  }
}

// Flat 18% GST split — cgst_sgst divides it 9+9, igst keeps it whole, none
// drops it. This is a proforma/billing document, not a GST filing document
// (GST scope is permanently locked to zero filing/GSTR features), so the
// flat rate is a deliberate simplification, not a stand-in for per-material
// gst_rate (which p2_raw_materials already has, used elsewhere for Tally).
function buildInvoiceTotals(items: InvoiceItem[], gstType: string): { subtotal: number; gst: number; total: number } {
  const subtotal = items.reduce((sum, it) => sum + it.amount, 0)
  const gst = gstType === 'none' ? 0 : subtotal * 0.18
  return { subtotal, gst, total: subtotal + gst }
}

// Mirrors sendChallanEmail()'s shape (orange link button, reply_to only if
// truthy) for the invoice-view link instead of receive.html.
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
}

const INVOICE_ORDER_COLUMNS = 'id, challan_number, client_name, client_address, status, dispatch_date'

// Resolves one dispatch order's items into InvoiceItem[] for the agent flow
// (send_invoice) — rates come from p2_material_prices/p2_product_prices
// (latest by effective_date), NOT from user input (that's only the Step 4 UI
// modal's path, handled separately in confirmGenerateInvoice).
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
): Promise<{ items: InvoiceItem[] } | { error: string }> {
  const { data: items, error: itemsError } = await supabaseClient
    .from('p2_dispatch_items')
    .select('material_name, material_code, qty_dispatched, unit, raw_material_id, product_id')
    .eq('tenant_id', tenantId)
    .eq('dispatch_order_id', order.id)

  if (itemsError) {
    return { error: 'Challan items load karta aale nahi.' }
  }
  if (!items?.length) {
    return { error: `Challan ${order.challan_number} madhe items nahit — invoice pathavta yet nahi` }
  }

  type ItemRow = {
    material_name: string | null
    material_code: string | null
    qty_dispatched: number
    unit: string
    raw_material_id: string | null
    product_id: string | null
  }
  const itemRows = items as ItemRow[]

  // Same batched p2_products lookup as receive-dispatch/sendChallanIntent —
  // product dispatch items have NULL material_name at the DB level.
  const missingProductIds = [
    ...new Set(itemRows.filter((it) => !it.material_name && it.product_id).map((it) => it.product_id as string)),
  ]
  const productsById = new Map<string, { name: string | null }>()
  if (missingProductIds.length) {
    const { data: products, error: productsError } = await supabaseClient
      .from('p2_products')
      .select('id, name')
      .eq('tenant_id', tenantId)
      .in('id', missingProductIds)
    if (productsError) {
      return { error: 'Product details load karta aale nahi.' }
    }
    for (const p of (products ?? []) as { id: string; name: string | null }[]) {
      productsById.set(p.id, { name: p.name })
    }
  }

  const materialIds = [...new Set(itemRows.map((it) => it.raw_material_id).filter(Boolean))] as string[]
  const materialPriceById = new Map<string, number>()
  if (materialIds.length) {
    const { data: prices } = await supabaseClient
      .from('p2_material_prices')
      .select('raw_material_id, price_per_unit, effective_date')
      .eq('tenant_id', tenantId)
      .in('raw_material_id', materialIds)
      .order('effective_date', { ascending: false })
    for (const p of (prices ?? []) as { raw_material_id: string; price_per_unit: number }[]) {
      if (!materialPriceById.has(p.raw_material_id)) materialPriceById.set(p.raw_material_id, p.price_per_unit)
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

  const invoiceItems: InvoiceItem[] = itemRows.map((it) => {
    const product = it.product_id ? productsById.get(it.product_id) : undefined
    const qty = Number(it.qty_dispatched) || 0
    const rate = it.product_id
      ? Number(productPriceById.get(it.product_id) ?? 0)
      : it.raw_material_id
        ? Number(materialPriceById.get(it.raw_material_id) ?? 0)
        : 0
    return {
      challan_number: order.challan_number,
      dispatch_date: order.dispatch_date,
      description: it.material_name ?? product?.name ?? it.material_code ?? 'Unknown Item',
      qty,
      unit: it.unit,
      rate,
      amount: qty * rate,
    }
  })

  return { items: invoiceItems }
}

// Shared insert+email tail for both send_invoice modes (and reused nowhere
// else — confirmGenerateInvoice, the UI-modal path, has its own inline
// version since its item-building differs, but the totals/insert/email
// shape is identical, factored here to avoid duplicating that part).
async function createAndSendInvoice(
  supabaseClient: ReturnType<typeof createClient>,
  tenantId: string,
  params: {
    client: InvoiceClientRow
    invoiceMode: 'single' | 'consolidated'
    dispatchOrderId: string | null
    dispatchOrderIds: string[]
    items: InvoiceItem[]
    gstType: string
    dateFrom: string | null
    dateTo: string | null
  }
): Promise<SendInvoiceResult> {
  const { subtotal, gst, total } = buildInvoiceTotals(params.items, params.gstType)

  const { data: invoiceNumber, error: invNoError } = await supabaseClient
    .rpc('get_next_invoice_number', { p_tenant_id: tenantId })

  if (invNoError || !invoiceNumber) {
    return { text: '❌ Invoice pathavayala error — invoice number generate karta aala nahi', success: false, errorReason: invNoError?.message ?? 'no invoice number returned' }
  }

  const { data: invoiceRow, error: insertError } = await supabaseClient
    .from('p2_invoices')
    .insert({
      tenant_id: tenantId,
      invoice_number: invoiceNumber,
      dispatch_order_id: params.dispatchOrderId,
      client_id: params.client.id,
      client_name: params.client.name,
      client_address: params.client.address,
      client_gstin: params.client.gstin,
      items: params.items,
      amount_subtotal: subtotal,
      amount_gst: gst,
      amount_total: total,
      gst_type: params.gstType,
      invoice_mode: params.invoiceMode,
      date_from: params.dateFrom,
      date_to: params.dateTo,
      dispatch_order_ids: params.dispatchOrderIds,
      status: 'sent',
    })
    .select('invoice_token')
    .single()

  if (insertError || !invoiceRow) {
    return { text: '❌ Invoice pathavayala error — save karta aala nahi', success: false, errorReason: insertError?.message ?? 'invoice insert failed' }
  }

  const { data: tenantSettingsRow } = await supabaseClient
    .from('p2_tenant_settings')
    .select('company_name, email')
    .eq('tenant_id', tenantId)
    .maybeSingle()

  const invoiceUrl = `https://nexflowautomations.in/invoice.html?token=${invoiceRow.invoice_token}`

  const emailResult = await sendInvoiceEmail({
    toEmail: params.client.email as string,
    clientName: params.client.name,
    invoiceNumber,
    companyName: tenantSettingsRow?.company_name ?? '',
    total,
    replyToEmail: tenantSettingsRow?.email ?? null,
    invoiceUrl,
  })

  if (!emailResult.ok) {
    return { text: `❌ Invoice pathavayala error — ${emailResult.error}`, success: false, errorReason: emailResult.error }
  }

  const totalFormatted = total.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  const periodSuffix = params.dateFrom && params.dateTo
    ? ` — Period: ${formatDDMMYYYY(params.dateFrom)} – ${formatDDMMYYYY(params.dateTo)}`
    : ''

  return {
    text: `✅ Invoice ${invoiceNumber} ${params.client.name} la pathavla — ₹${totalFormatted}${periodSuffix}`,
    success: true,
    errorReason: null,
  }
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

// Single mode: one dispatch, by challan number or "latest confirmed for this
// client" (p2_dispatch_orders has no client_id FK — client_name is the only
// link, same convention rm-dispatch.html/production-issue.html already use).
async function sendInvoiceSingle(
  supabaseClient: ReturnType<typeof createClient>,
  tenantId: string,
  client: InvoiceClientRow,
  challanNumber: string
): Promise<SendInvoiceResult> {
  let orders: InvoiceOrderRow[] | null = null

  if (challanNumber) {
    const { data: exact, error } = await supabaseClient
      .from('p2_dispatch_orders')
      .select(INVOICE_ORDER_COLUMNS)
      .eq('tenant_id', tenantId)
      .eq('challan_number', challanNumber)
      .limit(1)
    if (error) return { text: 'Could not fetch challan details.', success: false, errorReason: error.message }
    orders = exact as InvoiceOrderRow[] | null

    if (!orders?.length) {
      const { data: likeOrders, error: likeError } = await supabaseClient
        .from('p2_dispatch_orders')
        .select(INVOICE_ORDER_COLUMNS)
        .eq('tenant_id', tenantId)
        .ilike('challan_number', `%${challanNumber}`)
        .limit(5)
      if (likeError) return { text: 'Could not fetch challan details.', success: false, errorReason: likeError.message }
      orders = likeOrders as InvoiceOrderRow[] | null
    }

    if (!orders?.length) {
      return { text: `Challan ${challanNumber} sapadla nahi`, success: false, errorReason: 'challan_not_found' }
    }
    if (orders.length > 1) {
      const nums = orders.map((o) => o.challan_number).join(', ')
      return { text: `Multiple challans match "${challanNumber}": ${nums}. Please be more specific.`, success: false, errorReason: 'challan_ambiguous' }
    }
  } else {
    const { data: latest, error } = await supabaseClient
      .from('p2_dispatch_orders')
      .select(INVOICE_ORDER_COLUMNS)
      .eq('tenant_id', tenantId)
      .eq('client_name', client.name)
      .eq('status', 'confirmed')
      .order('dispatch_date', { ascending: false })
      .limit(1)
    if (error) return { text: 'Could not fetch dispatch details.', success: false, errorReason: error.message }
    if (!latest?.length) {
      return { text: `${client.name} sathi konti confirmed dispatch sapadli nahi`, success: false, errorReason: 'dispatch_not_found' }
    }
    orders = latest as InvoiceOrderRow[]
  }

  const order = orders[0]

  if (order.status !== 'confirmed') {
    return { text: 'He challan confirmed nahi — invoice pathavta yet nahi', success: false, errorReason: 'not_confirmed' }
  }

  const { data: existingInvoice, error: existingError } = await supabaseClient
    .from('p2_invoices')
    .select('invoice_number, invoice_token, amount_total')
    .eq('dispatch_order_id', order.id)
    .maybeSingle()

  if (existingError) {
    return { text: 'Invoice status check karta aala nahi.', success: false, errorReason: existingError.message }
  }
  if (existingInvoice) {
    return await resendExistingInvoice(supabaseClient, tenantId, client, existingInvoice as { invoice_number: string; invoice_token: string; amount_total: number })
  }

  const itemsResult = await buildInvoiceItemsForOrder(supabaseClient, tenantId, order)
  if ('error' in itemsResult) {
    return { text: itemsResult.error, success: false, errorReason: 'items_error' }
  }

  return await createAndSendInvoice(supabaseClient, tenantId, {
    client,
    invoiceMode: 'single',
    dispatchOrderId: order.id,
    dispatchOrderIds: [order.id],
    items: itemsResult.items,
    gstType: 'cgst_sgst',
    dateFrom: null,
    dateTo: null,
  })
}

// Consolidated mode: every confirmed dispatch for this client across all
// dispatch_types within [dateFrom, dateTo] inclusive, merged into one invoice.
async function sendInvoiceConsolidated(
  supabaseClient: ReturnType<typeof createClient>,
  tenantId: string,
  client: InvoiceClientRow,
  dateFrom: string,
  dateTo: string
): Promise<SendInvoiceResult> {
  const { data: orders, error } = await supabaseClient
    .from('p2_dispatch_orders')
    .select(INVOICE_ORDER_COLUMNS)
    .eq('tenant_id', tenantId)
    .eq('client_name', client.name)
    .eq('status', 'confirmed')
    .gte('dispatch_date', dateFrom)
    .lte('dispatch_date', dateTo)
    .order('dispatch_date', { ascending: true })

  if (error) {
    return { text: 'Dispatch details load karta aale nahi.', success: false, errorReason: error.message }
  }
  if (!orders?.length) {
    return { text: `❌ Ya period madhe ${client.name} sathi konti confirmed dispatch nahi`, success: false, errorReason: 'no_dispatches_in_range' }
  }

  const orderRows = orders as InvoiceOrderRow[]
  const orderIds = orderRows.map((o) => o.id)

  // Duplicate check: exact tenant + date_from + date_to + client_id match
  // (not an overlap check) — resend rather than recreate.
  const { data: existingInvoice, error: existingError } = await supabaseClient
    .from('p2_invoices')
    .select('invoice_number, invoice_token, amount_total')
    .eq('tenant_id', tenantId)
    .eq('client_id', client.id)
    .eq('date_from', dateFrom)
    .eq('date_to', dateTo)
    .maybeSingle()

  if (existingError) {
    return { text: 'Invoice status check karta aala nahi.', success: false, errorReason: existingError.message }
  }
  if (existingInvoice) {
    return await resendExistingInvoice(supabaseClient, tenantId, client, existingInvoice as { invoice_number: string; invoice_token: string; amount_total: number })
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
    return { text: 'Invoice status check karta aala nahi.', success: false, errorReason: singleError.message }
  }
  if (singleInvoices?.length) {
    const billedIds = new Set(singleInvoices.map((i) => i.dispatch_order_id as string))
    const billedChallans = orderRows.filter((o) => billedIds.has(o.id)).map((o) => o.challan_number).join(', ')
    return {
      text: `❌ Ya dispatches paikee kahi already individually billed aahit — ${billedChallans}. Consolidated invoice create karu nahi shaknar.`,
      success: false,
      errorReason: 'already_billed_individually',
    }
  }

  const allItems: InvoiceItem[] = []
  for (const order of orderRows) {
    const itemsResult = await buildInvoiceItemsForOrder(supabaseClient, tenantId, order)
    if ('error' in itemsResult) {
      return { text: itemsResult.error, success: false, errorReason: 'items_error' }
    }
    allItems.push(...itemsResult.items)
  }

  return await createAndSendInvoice(supabaseClient, tenantId, {
    client,
    invoiceMode: 'consolidated',
    dispatchOrderId: null,
    dispatchOrderIds: orderIds,
    items: allItems,
    gstType: 'cgst_sgst',
    dateFrom,
    dateTo,
  })
}

// send_invoice orchestrator — mode selection: a valid date range means
// consolidated, else a challan number (or the client's latest confirmed
// dispatch) means single. Executes immediately, no confirm gate (same shape
// as sendChallanIntent/sendTallyExportIntent) — not in READ_ONLY_INTENTS on
// purpose, this is a write (creates an invoice row, sends an email).
async function sendInvoiceIntent(
  supabaseClient: ReturnType<typeof createClient>,
  tenantId: string,
  extracted: HaikuResult['extracted']
): Promise<SendInvoiceResult> {
  const clientName = (extracted.client_name ?? '').trim()
  if (!clientName) {
    return { text: 'Please provide a client name.', success: false, errorReason: 'no client name' }
  }

  const { data: clients, error: clientsError } = await supabaseClient
    .from('p2_clients')
    .select('id, name, address, gstin, email')
    .eq('tenant_id', tenantId)

  if (clientsError) {
    return { text: 'Client list load karta aali nahi.', success: false, errorReason: clientsError.message }
  }

  const clientMatch = matchClientName(clientName, (clients ?? []) as InvoiceClientRow[])
  if ('error' in clientMatch) {
    return { text: clientMatch.error, success: false, errorReason: clientMatch.errorKind }
  }
  const client = clientMatch.client

  if (!client.email || !client.email.trim()) {
    return { text: `${client.name} cha email Settings > Clients madhe add kara`, success: false, errorReason: 'client_no_email' }
  }

  const challanNumber = (extracted.challan_number ?? '').trim()
  const validFrom = extracted.date_from && TALLY_EXPORT_DATE_RE.test(extracted.date_from) ? extracted.date_from : undefined
  const validTo = extracted.date_to && TALLY_EXPORT_DATE_RE.test(extracted.date_to) ? extracted.date_to : undefined

  if (validFrom && validTo) {
    return await sendInvoiceConsolidated(supabaseClient, tenantId, client, validFrom, validTo)
  }
  return await sendInvoiceSingle(supabaseClient, tenantId, client, challanNumber)
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

  if (userError || !user || user.id !== recipient_tenant_id) {
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

  const today = getISTDateRange(0).since.split('T')[0]
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
// the modal, unlike sendInvoiceIntent's agent flow which has no UI to review
// rates in and falls back to price-table lookups (zero if none found).
async function confirmGenerateInvoice(
  supabaseClient: ReturnType<typeof createClient>,
  body: Partial<ConfirmGenerateInvoiceRequest>
): Promise<Response> {
  const { tenant_id, dispatch_order_id, item_rates, gst_type } = body

  if (!tenant_id || !dispatch_order_id || !item_rates?.length) {
    return respond({ status: 'error', error: 'tenant_id, dispatch_order_id, and item_rates are required' }, 400)
  }
  const gstType = gst_type === 'igst' || gst_type === 'none' ? gst_type : 'cgst_sgst'

  const { data: order, error: orderError } = await supabaseClient
    .from('p2_dispatch_orders')
    .select('id, challan_number, dispatch_date, client_name, status')
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
    .select('id, material_name, material_code, qty_dispatched, unit, product_id')
    .eq('dispatch_order_id', dispatch_order_id)
    .eq('tenant_id', tenant_id)

  if (itemsError || !items?.length) {
    return respond({ status: 'error', error: itemsError?.message ?? 'No dispatch items found' }, 400)
  }

  type ItemRow = { id: string; material_name: string | null; material_code: string | null; qty_dispatched: number; unit: string; product_id: string | null }
  const itemRows = items as ItemRow[]

  // Same batched p2_products lookup as receive-dispatch/sendChallanIntent —
  // product dispatch items have NULL material_name at the DB level.
  const missingProductIds = [
    ...new Set(itemRows.filter((it) => !it.material_name && it.product_id).map((it) => it.product_id as string)),
  ]
  const productsById = new Map<string, { name: string | null }>()
  if (missingProductIds.length) {
    const { data: products, error: productsError } = await supabaseClient
      .from('p2_products')
      .select('id, name')
      .eq('tenant_id', tenant_id)
      .in('id', missingProductIds)
    if (productsError) {
      return respond({ status: 'error', error: productsError.message }, 500)
    }
    for (const p of (products ?? []) as { id: string; name: string | null }[]) {
      productsById.set(p.id, { name: p.name })
    }
  }

  const rateById = new Map(item_rates.map((r) => [r.dispatch_item_id, r.rate]))

  const invoiceItems: InvoiceItem[] = itemRows.map((it) => {
    const product = it.product_id ? productsById.get(it.product_id) : undefined
    const qty = Number(it.qty_dispatched) || 0
    const rate = Number(rateById.get(it.id)) || 0
    return {
      challan_number: order.challan_number,
      dispatch_date: order.dispatch_date,
      description: it.material_name ?? product?.name ?? it.material_code ?? 'Unknown Item',
      qty,
      unit: it.unit,
      rate,
      amount: qty * rate,
    }
  })

  const { subtotal, gst, total } = buildInvoiceTotals(invoiceItems, gstType)

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
      dispatch_order_id,
      client_id: client.id,
      client_name: client.name,
      client_address: client.address,
      client_gstin: client.gstin,
      items: invoiceItems,
      amount_subtotal: subtotal,
      amount_gst: gst,
      amount_total: total,
      gst_type: gstType,
      invoice_mode: 'single',
      dispatch_order_ids: [dispatch_order_id],
      // status left at its 'draft' default. This UI path no longer emails
      // the invoice (email generation is agent-only now, via
      // sendInvoiceIntent's send_invoice) — the owner reviews the link and
      // shares it manually, or sends it later via invoices.html's "Resend".
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

// invoices.html "+ New Consolidated Invoice" modal — merges every confirmed
// dispatch for one client within a date range into one invoice. Mirrors
// confirmGenerateInvoice's conventions (respond() shape, draft-then-flip
// status) but reuses the consolidated-mode guards and rate resolution
// already proven in sendInvoiceConsolidated/buildInvoiceItemsForOrder.
// Unlike the single-mode UI modal, there's no per-item rate review step
// here, so rates come from price tables with zero-fallback (never blocks
// on a missing price) — same as the Haiku-driven send_invoice path.
async function confirmConsolidatedInvoice(
  supabaseClient: ReturnType<typeof createClient>,
  body: Partial<ConfirmConsolidatedInvoiceRequest>
): Promise<Response> {
  const { tenant_id, client_id, date_from, date_to, gst_type } = body

  if (!tenant_id || !client_id || !date_from || !date_to || !gst_type) {
    return respond({ status: 'error', error: 'tenant_id, client_id, date_from, date_to, and gst_type are required' }, 400)
  }
  const gstType = gst_type === 'igst' || gst_type === 'none' ? gst_type : 'cgst_sgst'

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

  const { data: orders, error: ordersError } = await supabaseClient
    .from('p2_dispatch_orders')
    .select(INVOICE_ORDER_COLUMNS)
    .eq('tenant_id', tenant_id)
    .eq('client_name', client.name)
    .eq('status', 'confirmed')
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
  // (not an overlap check) — resend rather than recreate. Same query shape
  // and ordering as sendInvoiceConsolidated (checked before the cross-mode
  // guard below, since a resend doesn't need to re-validate billing state).
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
    allItems.push(...itemsResult.items)
  }

  const { subtotal, gst, total } = buildInvoiceTotals(allItems, gstType)

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
      Partial<Omit<ConfirmGrnRequest, 'action'>> &
      Partial<Omit<ConfirmProductionIssueRequest, 'action'>> &
      Partial<Omit<AddProductionIssueClientRequest, 'action'>> &
      Partial<Omit<ConfirmProductDispatchRequest, 'action'>> &
      Partial<Omit<ConfirmRmDispatchRequest, 'action'>> &
      Partial<Omit<ConfirmMultiGrnRequest, 'action'>> &
      Partial<Omit<UpdateGrnRatesRequest, 'action'>> &
      Partial<Omit<ConfirmReceiveGrnRequest, 'action'>> &
      Partial<Omit<ConfirmGenerateInvoiceRequest, 'action'>> &
      Partial<Omit<ResendInvoiceRequest, 'action'>> &
      Partial<Omit<ConfirmConsolidatedInvoiceRequest, 'action'>> &
      { action?: 'confirm_grn' | 'confirm_production_issue' | 'add_production_issue_client' | 'confirm_product_dispatch' | 'confirm_rm_dispatch' | 'confirm_multi_grn' | 'update_grn_rates' | 'confirm_receive_grn' | 'confirm_generate_invoice' | 'resend_invoice' | 'confirm_consolidated_invoice' } = await req.json()

    if (body.action === 'confirm_grn') {
      return await confirmGrn(supabase, body as Partial<ConfirmGrnRequest>)
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

    if (body.action === 'confirm_receive_grn') {
      return await confirmReceiveGrn(supabase, req, body as Partial<ConfirmReceiveGrnRequest>)
    }

    if (body.action === 'confirm_multi_grn') {
      return await confirmMultiGrn(supabase, body as Partial<ConfirmMultiGrnRequest>)
    }

    if (body.action === 'update_grn_rates') {
      return await updateGrnRates(supabase, body as Partial<UpdateGrnRatesRequest>)
    }

    if (body.action === 'confirm_production_issue') {
      return await confirmProductionIssue(supabase, body as Partial<ConfirmProductionIssueRequest>)
    }

    if (body.action === 'confirm_product_dispatch') {
      return await confirmProductDispatch(supabase, body as Partial<ConfirmProductDispatchRequest>)
    }

    if (body.action === 'confirm_rm_dispatch') {
      return await confirmRmDispatch(supabase, body as Partial<ConfirmRmDispatchRequest>)
    }

    if (body.action === 'add_production_issue_client') {
      return await addProductionIssueClient(supabase, body as Partial<AddProductionIssueClientRequest>)
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

    // Not in READ_ONLY_INTENTS on purpose — this is a write (sends an
    // email) even though it executes immediately with no confirm gate.
    if (haikuResult.intent === 'send_challan') {
      const result = await sendChallanIntent(supabase, tenant_id, haikuResult.extracted)
      void logInteraction(
        supabase, tenant_id, message, 'send_challan',
        haikuResult.extracted as Record<string, unknown>,
        result.matchStatus, result.success, result.errorReason
      )
      return respond({
        status: 'ok',
        intent: 'send_challan',
        confirm: { status: 'ready', confirm_text: result.text },
      })
    }

    // Not in READ_ONLY_INTENTS on purpose — this is a write (sends an
    // email) even though it executes immediately with no confirm gate.
    if (haikuResult.intent === 'send_tally_export') {
      const result = await sendTallyExportIntent(
        supabase, tenant_id, context,
        haikuResult.extracted?.date_from,
        haikuResult.extracted?.date_to
      )
      void logInteraction(
        supabase, tenant_id, message, 'send_tally_export',
        haikuResult.extracted as Record<string, unknown>, null, result.success, result.errorReason
      )
      return respond({
        status: 'ok',
        intent: 'send_tally_export',
        confirm: { status: 'ready', confirm_text: result.text },
      })
    }

    // Not in READ_ONLY_INTENTS on purpose — this is a write (creates a
    // p2_invoices row, sends an email) even though it executes immediately
    // with no confirm gate, same shape as send_challan/send_tally_export.
    if (haikuResult.intent === 'send_invoice') {
      const result = await sendInvoiceIntent(supabase, tenant_id, haikuResult.extracted)
      void logInteraction(
        supabase, tenant_id, message, 'send_invoice',
        haikuResult.extracted as Record<string, unknown>, null, result.success, result.errorReason
      )
      return respond({
        status: 'ok',
        intent: 'send_invoice',
        confirm: { status: 'ready', confirm_text: result.text },
      })
    }

    if (haikuResult.intent === 'create_production_issue') {
      const productName = haikuResult.extracted.product_name ?? ''
      const quantity = haikuResult.extracted.quantity ?? 1

      if (!productName.trim()) {
        void logInteraction(supabase, tenant_id, message, 'create_production_issue', haikuResult.extracted as Record<string, unknown>, null, false, 'no product name')
        return respond({ status: 'ok', intent: 'create_production_issue', confirm: { status: 'blocked', reason: 'Please provide a product name.' } })
      }

      const productMatches = findProductMatches(productName, context.products)

      if (productMatches.length === 0) {
        void logInteraction(supabase, tenant_id, message, 'create_production_issue', haikuResult.extracted as Record<string, unknown>, 'no_match', false, 'product not found')
        return respond({ status: 'ok', intent: 'create_production_issue', confirm: { status: 'blocked', reason: `Couldn't find a product matching "${productName}".` } })
      }

      if (productMatches.length > 1) {
        const names = productMatches.map(p => p.name).join(', ')
        void logInteraction(supabase, tenant_id, message, 'create_production_issue', haikuResult.extracted as Record<string, unknown>, 'ambiguous', false, 'ambiguous product')
        return respond({ status: 'ok', intent: 'create_production_issue', confirm: { status: 'blocked', reason: `"${productName}" is ambiguous — did you mean ${names}?` } })
      }

      const product = productMatches[0]

      // Fetch BOM
      const { data: bomRows, error: bomError } = await supabase
        .from('p2_product_bom')
        .select('raw_material_id, qty_per_unit, unit')
        .eq('tenant_id', tenant_id)
        .eq('product_id', product.id)

      if (bomError) {
        void logInteraction(supabase, tenant_id, message, 'create_production_issue', haikuResult.extracted as Record<string, unknown>, null, false, 'bom fetch error')
        return respond({ status: 'error', error: 'Could not fetch BOM.' }, 500)
      }

      if (!bomRows?.length) {
        void logInteraction(supabase, tenant_id, message, 'create_production_issue', haikuResult.extracted as Record<string, unknown>, 'no_match', false, 'empty bom')
        return respond({ status: 'ok', intent: 'create_production_issue', confirm: { status: 'blocked', reason: `${product.name} cha BOM define nahi aahe. Please products.html madhun BOM add kara.` } })
      }

      // Build BOM lines with stock sufficiency check
      const materialMap = new Map(context.materials.map(m => [m.id, m]))
      const stockMap = new Map(context.stockBalances.map(b => [b.raw_material_id, b]))

      const bomLines: BomLine[] = (bomRows as { raw_material_id: string; qty_per_unit: number; unit: string }[]).map(row => {
        const mat = materialMap.get(row.raw_material_id)
        const stock = stockMap.get(row.raw_material_id)
        const requiredQty = Math.round(row.qty_per_unit * quantity * 10000) / 10000
        const currentStock = stock?.current_stock ?? 0
        return {
          raw_material_id: row.raw_material_id,
          material_name: mat?.name ?? 'Unknown',
          material_code: mat?.material_code ?? null,
          required_qty: requiredQty,
          unit: row.unit,
          current_stock: currentStock,
          sufficient: currentStock >= requiredQty,
        }
      })

      const insufficientLines = bomLines.filter(line => !line.sufficient)

      if (insufficientLines.length > 0) {
        const shortLines = insufficientLines.map(line => {
          const codeStr = line.material_code ? ` [${line.material_code}]` : ''
          return `• ${line.material_name}${codeStr}: stock ${line.current_stock} ${line.unit}, need ${line.required_qty} ${line.unit}`
        })
        const blockedReason = `Stock insufficient for ${product.name} × ${quantity}:\n\n${shortLines.join('\n')}\n\nPlease receive the missing materials first.`
        void logInteraction(supabase, tenant_id, message, 'create_production_issue', haikuResult.extracted as Record<string, unknown>, 'no_match', false, 'insufficient_stock')
        return respond({
          status: 'ok',
          intent: 'create_production_issue',
          confirm: { status: 'blocked', reason: blockedReason }
        })
      }

      // Build confirm text
      const lines = bomLines.map(line => {
        const codeStr = line.material_code ? ` [${line.material_code}]` : ''
        const stockStr = line.sufficient
          ? '✓'
          : `⚠ (stock: ${line.current_stock} ${line.unit}, need: ${line.required_qty} ${line.unit})`
        return `• ${line.material_name}${codeStr} — ${line.required_qty} ${line.unit}  ${stockStr}`
      })

      const confirmText = `📦 Production Issue — ${product.name} × ${quantity}\n\nMaterial deductions:\n${lines.join('\n')}`

      void logInteraction(supabase, tenant_id, message, 'create_production_issue', haikuResult.extracted as Record<string, unknown>, 'matched', true, null)

      return respond({
        status: 'ok',
        intent: 'create_production_issue',
        confirm: {
          status: 'ready',
          confirm_text: confirmText,
          confirm_data: {
            product_id: product.id,
            product_name: product.name,
            quantity,
            bom_lines: bomLines,
          }
        }
      })
    }

    if (haikuResult.intent === 'create_product_dispatch') {
      const dispatchItems = haikuResult.extracted.dispatch_items ?? []

      if (dispatchItems.length === 0) {
        void logInteraction(supabase, tenant_id, message, 'create_product_dispatch', haikuResult.extracted as Record<string, unknown>, null, false, 'no dispatch items')
        return respond({ status: 'ok', intent: 'create_product_dispatch', confirm: { status: 'blocked', reason: 'Please mention at least one product to dispatch.' } })
      }

      const materialMap = new Map(context.materials.map(m => [m.id, m]))
      const stockMap = new Map(context.stockBalances.map(b => [b.raw_material_id, b]))

      const okItems: { product: Product; quantity: number; unit: string; bomLines: BomLine[] }[] = []
      const blockedReasons: string[] = []

      for (const dispatchItem of dispatchItems) {
        const productName = dispatchItem.product_name ?? ''
        const quantity = dispatchItem.quantity ?? 1

        if (!productName.trim()) {
          blockedReasons.push('No product name was found for one item.')
          continue
        }

        const productMatches = findProductMatches(productName, context.products)

        if (productMatches.length === 0) {
          blockedReasons.push(`Couldn't find a product matching "${productName}".`)
          continue
        }

        if (productMatches.length > 1) {
          const names = productMatches.map(p => p.name).join(', ')
          blockedReasons.push(`"${productName}" is ambiguous — did you mean ${names}?`)
          continue
        }

        const product = productMatches[0]

        const { data: bomRows, error: bomError } = await supabase
          .from('p2_product_bom')
          .select('raw_material_id, qty_per_unit, unit')
          .eq('tenant_id', tenant_id)
          .eq('product_id', product.id)

        if (bomError) {
          blockedReasons.push(`Could not fetch BOM for ${product.name}.`)
          continue
        }

        if (!bomRows?.length) {
          blockedReasons.push(`${product.name} cha BOM define nahi aahe. Please products.html madhun BOM add kara.`)
          continue
        }

        const exploded = explodeBomQty(bomRows as { raw_material_id: string; qty_per_unit: number; unit: string }[], quantity)

        const bomLines: BomLine[] = exploded.map(row => {
          const mat = materialMap.get(row.raw_material_id)
          const stock = stockMap.get(row.raw_material_id)
          const currentStock = stock?.current_stock ?? 0
          return {
            raw_material_id: row.raw_material_id,
            material_name: mat?.name ?? 'Unknown',
            material_code: mat?.material_code ?? null,
            required_qty: row.qty,
            unit: row.unit,
            current_stock: currentStock,
            sufficient: currentStock >= row.qty,
          }
        })

        const insufficientLines = bomLines.filter(line => !line.sufficient)

        if (insufficientLines.length > 0) {
          const shortLines = insufficientLines.map(line => `• ${line.material_name}${codeTag(line.material_code)}: stock ${line.current_stock} ${line.unit}, need ${line.required_qty} ${line.unit}`)
          blockedReasons.push(`Stock insufficient for ${product.name} × ${quantity}:\n${shortLines.join('\n')}`)
          continue
        }

        okItems.push({ product, quantity, unit: product.unit || 'NOS', bomLines })
      }

      if (blockedReasons.length > 0) {
        void logInteraction(supabase, tenant_id, message, 'create_product_dispatch', haikuResult.extracted as Record<string, unknown>, null, false, 'blocked')
        return respond({ status: 'ok', intent: 'create_product_dispatch', confirm: { status: 'blocked', reason: blockedReasons.join('\n\n') } })
      }

      const confirmLines = okItems.map(it => `• ${it.quantity} × ${it.product.name}${codeTag(it.product.product_code)} (${it.unit})`)
      const confirmText = `🚚 Product Dispatch\n\nItems:\n${confirmLines.join('\n')}\n\nClient info required after confirm.`

      void logInteraction(supabase, tenant_id, message, 'create_product_dispatch', haikuResult.extracted as Record<string, unknown>, 'matched', true, null)

      return respond({
        status: 'ok',
        intent: 'create_product_dispatch',
        confirm: {
          status: 'ready',
          confirm_text: confirmText,
          confirm_data: {
            items: okItems.map(it => ({
              product_id: it.product.id,
              product_name: it.product.name,
              quantity: it.quantity,
              unit: it.unit,
              bom_lines: it.bomLines.map(l => ({ raw_material_id: l.raw_material_id, qty: l.required_qty })),
            })),
          },
        },
      })
    }

    if (haikuResult.intent === 'create_rm_dispatch') {
      const items = haikuResult.extracted.items ?? []

      if (items.length === 0) {
        void logInteraction(supabase, tenant_id, message, 'create_rm_dispatch', haikuResult.extracted as Record<string, unknown>, null, false, 'no items')
        return respond({ status: 'ok', intent: 'create_rm_dispatch', confirm: { status: 'blocked', reason: 'Please mention at least one material to dispatch.' } })
      }

      const stockMap = new Map(context.stockBalances.map(b => [b.raw_material_id, b]))

      const okItems: { material: RawMaterial; quantity: number; unit: string }[] = []
      const blockedReasons: string[] = []

      for (const item of items) {
        if (!item.material_name || !item.material_name.trim()) {
          blockedReasons.push('No material name was found for one item.')
          continue
        }

        const matchResult = matchMaterialName(item.material_name, context.materials)

        if ('error' in matchResult) {
          blockedReasons.push(matchResult.error)
          continue
        }

        const material = matchResult.material
        const quantity = item.quantity

        if (typeof quantity !== 'number' || !Number.isFinite(quantity) || quantity <= 0) {
          blockedReasons.push(`No valid quantity was found for ${material.name}.`)
          continue
        }

        const currentStock = stockMap.get(material.id)?.current_stock ?? 0

        if (currentStock < quantity) {
          blockedReasons.push(`${material.name}${codeTag(material.material_code)}: stock ${currentStock} ${material.unit}, need ${quantity} ${material.unit}.`)
          continue
        }

        okItems.push({ material, quantity, unit: material.unit })
      }

      if (blockedReasons.length > 0) {
        void logInteraction(supabase, tenant_id, message, 'create_rm_dispatch', haikuResult.extracted as Record<string, unknown>, null, false, 'blocked')
        return respond({ status: 'ok', intent: 'create_rm_dispatch', confirm: { status: 'blocked', reason: blockedReasons.join('\n\n') } })
      }

      const confirmLines = okItems.map(it => `• ${it.quantity} ${it.unit} of ${it.material.name}${codeTag(it.material.material_code)}`)
      const confirmText = `🚚 RM Dispatch\n\nMaterials:\n${confirmLines.join('\n')}\n\nClient info required after confirm.`

      void logInteraction(supabase, tenant_id, message, 'create_rm_dispatch', haikuResult.extracted as Record<string, unknown>, 'matched', true, null)

      return respond({
        status: 'ok',
        intent: 'create_rm_dispatch',
        confirm: {
          status: 'ready',
          confirm_text: confirmText,
          confirm_data: {
            items: okItems.map(it => ({
              raw_material_id: it.material.id,
              material_name: it.material.name,
              material_code: it.material.material_code,
              quantity: it.quantity,
              unit: it.unit,
            })),
          },
        },
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
