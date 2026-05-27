// Supabase Edge Function: confirm-dispatch
// Confirms a dispatch order, deducts stock via BOM, generates challan number

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const TELEGRAM_BOT_TOKEN = Deno.env.get('TELEGRAM_BOT_TOKEN')

interface ConfirmDispatchRequest {
  dispatch_order_id: string
}

interface DispatchItem {
  product_id: string
  quantity: number
}

interface BOMRow {
  raw_material_id: string
  qty_per_unit: number
  p2_raw_materials: {
    name: string
    unit: string
    min_stock_level: number
  }
}

interface MaterialConsumption {
  material_id: string
  material_name: string
  unit: string
  qty: number
  min_stock_level: number
}

interface StockTransaction {
  quantity: number
}

async function sendTelegramMessage(chatId: string, message: string): Promise<boolean> {
  if (!TELEGRAM_BOT_TOKEN) {
    console.error('TELEGRAM_BOT_TOKEN not configured')
    return false
  }

  try {
    const response = await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text: message,
        parse_mode: 'HTML'
      })
    })

    if (!response.ok) {
      const error = await response.text()
      console.error(`Telegram API error:`, error)
      return false
    }

    return true
  } catch (error) {
    console.error(`Failed to send Telegram message:`, error)
    return false
  }
}

Deno.serve(async (req) => {
  try {
    // Parse request body
    const body: ConfirmDispatchRequest = await req.json()
    const { dispatch_order_id } = body

    if (!dispatch_order_id) {
      return new Response(
        JSON.stringify({ success: false, error: 'dispatch_order_id is required' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      )
    }

    // Initialize Supabase client with service role key
    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? ''
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    const supabase = createClient(supabaseUrl, supabaseServiceKey)

    // (1) Check dispatch status — if already confirmed, return early (idempotent)
    const { data: dispatchOrder, error: dispatchError } = await supabase
      .from('p2_dispatch_orders')
      .select('id, tenant_id, status, challan_number')
      .eq('id', dispatch_order_id)
      .single()

    if (dispatchError || !dispatchOrder) {
      return new Response(
        JSON.stringify({ success: false, error: 'Dispatch order not found' }),
        { status: 404, headers: { 'Content-Type': 'application/json' } }
      )
    }

    if (dispatchOrder.status === 'confirmed') {
      return new Response(
        JSON.stringify({
          success: true,
          message: 'Already confirmed',
          challan_number: dispatchOrder.challan_number,
          consumed: []
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      )
    }

    const tenantId = dispatchOrder.tenant_id

    // (2) Fetch all dispatch items
    const { data: dispatchItems, error: itemsError } = await supabase
      .from('p2_dispatch_items')
      .select('product_id, quantity')
      .eq('dispatch_order_id', dispatch_order_id)

    if (itemsError || !dispatchItems || dispatchItems.length === 0) {
      return new Response(
        JSON.stringify({ success: false, error: 'No dispatch items found' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      )
    }

    // (3) For each item, fetch BOM and calculate consumption
    const materialConsumptionMap = new Map<string, MaterialConsumption>()

    for (const item of dispatchItems) {
      const { data: bomRows, error: bomError } = await supabase
        .from('p2_product_bom')
        .select(`
          raw_material_id,
          qty_per_unit,
          p2_raw_materials (
            name,
            unit,
            min_stock_level
          )
        `)
        .eq('product_id', item.product_id)
        .eq('tenant_id', tenantId)

      if (bomError) {
        return new Response(
          JSON.stringify({ success: false, error: `Failed to fetch BOM: ${bomError.message}` }),
          { status: 500, headers: { 'Content-Type': 'application/json' } }
        )
      }

      // (4) Aggregate consumption
      for (const bomRow of (bomRows as unknown as BOMRow[]) || []) {
        const materialId = bomRow.raw_material_id
        const consumedQty = bomRow.qty_per_unit * item.quantity
        const material = bomRow.p2_raw_materials

        if (materialConsumptionMap.has(materialId)) {
          const existing = materialConsumptionMap.get(materialId)!
          existing.qty += consumedQty
        } else {
          materialConsumptionMap.set(materialId, {
            material_id: materialId,
            material_name: material.name,
            unit: material.unit,
            qty: consumedQty,
            min_stock_level: material.min_stock_level
          })
        }
      }
    }

    const consumptionList = Array.from(materialConsumptionMap.values())

    // (5) STOCK CHECK — verify sufficient stock before any inserts
    for (const consumption of consumptionList) {
      const { data: stockData, error: stockError } = await supabase
        .from('p2_stock_transactions')
        .select('quantity')
        .eq('tenant_id', tenantId)
        .eq('raw_material_id', consumption.material_id)

      if (stockError) {
        return new Response(
          JSON.stringify({ success: false, error: `Stock check failed: ${stockError.message}` }),
          { status: 500, headers: { 'Content-Type': 'application/json' } }
        )
      }

      const currentStock = (stockData as StockTransaction[] || []).reduce((sum, txn) => sum + (txn.quantity || 0), 0)

      if (currentStock < consumption.qty) {
        const shortfall = consumption.qty - currentStock
        return new Response(
          JSON.stringify({
            success: false,
            error: 'Insufficient stock',
            material: consumption.material_name,
            shortfall: shortfall.toFixed(2),
            unit: consumption.unit
          }),
          { status: 400, headers: { 'Content-Type': 'application/json' } }
        )
      }
    }

    // (6) Begin transaction: insert stock transactions, get challan number, update status
    // Using Postgres transaction via RPC
    const { data: transactionResult, error: txnError } = await supabase.rpc('confirm_dispatch_transaction', {
      p_dispatch_order_id: dispatch_order_id,
      p_tenant_id: tenantId,
      p_consumption_json: JSON.stringify(consumptionList)
    })

    if (txnError) {
      console.error('Transaction error:', txnError)
      return new Response(
        JSON.stringify({ success: false, error: `Transaction failed: ${txnError.message}` }),
        { status: 500, headers: { 'Content-Type': 'application/json' } }
      )
    }

    const challanNumber = transactionResult?.challan_number

    // (7) Check stock levels and send Telegram alerts if below minimum
    const { data: tenantSettings } = await supabase
      .from('p2_tenant_settings')
      .select('telegram_chat_id, company_name')
      .eq('tenant_id', tenantId)
      .single()

    if (tenantSettings?.telegram_chat_id) {
      const lowStockAlerts: string[] = []

      for (const consumption of consumptionList) {
        // Recalculate stock after consumption
        const { data: stockData } = await supabase
          .from('p2_stock_transactions')
          .select('quantity')
          .eq('tenant_id', tenantId)
          .eq('raw_material_id', consumption.material_id)

        const currentStock = (stockData as StockTransaction[] || []).reduce((sum, txn) => sum + (txn.quantity || 0), 0)

        if (currentStock < consumption.min_stock_level) {
          lowStockAlerts.push(
            `• <b>${consumption.material_name}</b>: ${currentStock.toFixed(2)} ${consumption.unit} (min: ${consumption.min_stock_level} ${consumption.unit})`
          )
        }
      }

      if (lowStockAlerts.length > 0) {
        const message = `🚨 <b>Low Stock Alert — ${tenantSettings.company_name || 'Nexflow'}</b>\n\n` +
          `After dispatch ${challanNumber}:\n\n` +
          lowStockAlerts.join('\n') +
          `\n\n📅 ${new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}`

        await sendTelegramMessage(tenantSettings.telegram_chat_id, message)
      }
    }

    // (8) Return success response
    return new Response(
      JSON.stringify({
        success: true,
        challan_number: challanNumber,
        consumed: consumptionList.map(c => ({
          material: c.material_name,
          qty: c.qty.toFixed(2),
          unit: c.unit
        }))
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    )

  } catch (error) {
    console.error('Edge function error:', error)
    return new Response(
      JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    )
  }
})
