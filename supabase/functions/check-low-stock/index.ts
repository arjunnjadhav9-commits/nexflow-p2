// Supabase Edge Function: check-low-stock
// Runs daily to send a morning digest: low stock, stale GRN logging,
// yesterday's GRNs, and pending (unconfirmed) dispatches — via Telegram.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const TELEGRAM_BOT_TOKEN = Deno.env.get('TELEGRAM_BOT_TOKEN')

interface Tenant {
  id: string
  telegram_chat_id?: string
  company_name: string
}

interface StockBalanceRow {
  raw_material_id: string
  name: string
  unit: string
  min_stock_level: number
  current_stock: number
}

interface GRNRow {
  grn_no: string
  supplier_name: string | null
  quantity: number
  raw_material_id: string
}

interface DispatchRow {
  id: string
  challan_number: string | null
  created_at: string
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
      console.error(`Telegram API error for chat ${chatId}:`, error)
      return false
    }

    return true
  } catch (error) {
    console.error(`Failed to send Telegram message to ${chatId}:`, error)
    return false
  }
}

Deno.serve(async (req) => {
  try {
    // Initialize Supabase client with service role key for admin access
    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? ''
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''

    const supabase = createClient(supabaseUrl, supabaseServiceKey)

    // Step 1: Fetch all tenants with their settings
    const { data: tenants, error: tenantsError } = await supabase
      .from('p2_tenants')
      .select(`
        id,
        p2_tenant_settings (
          company_name,
          telegram_chat_id
        )
      `)

    if (tenantsError) {
      throw new Error(`Failed to fetch tenants: ${tenantsError.message}`)
    }

    const alerts: Array<{ tenant: string; count: number; success: boolean }> = []

    // Step 2: Process each tenant
    for (const tenant of tenants || []) {
      const tenantId = tenant.id
      const settings = Array.isArray(tenant.p2_tenant_settings)
        ? tenant.p2_tenant_settings[0]
        : tenant.p2_tenant_settings

      const companyName = settings?.company_name || 'Unknown Company'
      const telegramChatId = settings?.telegram_chat_id

      // Skip if no Telegram chat ID configured
      if (!telegramChatId) {
        console.log(`Skipping tenant ${tenantId} - no Telegram chat ID configured`)
        continue
      }

      // Stock balance — single query against the view, no per-material loop.
      const { data: stockRows, error: stockError } = await supabase
        .from('v_p2_stock_balance')
        .select('raw_material_id, name, unit, min_stock_level, current_stock')
        .eq('tenant_id', tenantId)
        .not('min_stock_level', 'is', null)

      if (stockError) {
        console.error(`Error fetching stock balance for tenant ${tenantId}:`, stockError)
        continue
      }

      const materialMap = new Map<string, { name: string; unit: string }>(
        (stockRows || []).map((r: StockBalanceRow) => [r.raw_material_id, { name: r.name, unit: r.unit }])
      )

      const lowStockItems = (stockRows || []).filter(
        (r: StockBalanceRow) => r.current_stock < r.min_stock_level
      )

      // Yesterday's GRNs
      const yesterday = new Date()
      yesterday.setDate(yesterday.getDate() - 1)
      const yesterdayStr = yesterday.toISOString().split('T')[0]
      const todayStr = new Date().toISOString().split('T')[0]

      const { data: recentGRNs } = await supabase
        .from('p2_stock_transactions')
        .select('grn_no, supplier_name, quantity, raw_material_id')
        .eq('tenant_id', tenantId)
        .eq('transaction_type', 'grn')
        .gte('transaction_date', yesterdayStr)
        .lt('transaction_date', todayStr)

      // No GRN logged in 3+ days
      const threeDaysAgo = new Date()
      threeDaysAgo.setDate(threeDaysAgo.getDate() - 3)

      const { data: recentAnyGRN } = await supabase
        .from('p2_stock_transactions')
        .select('id')
        .eq('tenant_id', tenantId)
        .eq('transaction_type', 'grn')
        .gte('transaction_date', threeDaysAgo.toISOString().split('T')[0])
        .limit(1)

      const noRecentGRN = !recentAnyGRN || recentAnyGRN.length === 0

      // Pending dispatches — draft challans not yet confirmed, sitting 2+ days
      const twoDaysAgo = new Date()
      twoDaysAgo.setDate(twoDaysAgo.getDate() - 2)

      const { data: pendingDispatches } = await supabase
        .from('p2_dispatch_orders')
        .select('id, challan_number, created_at')
        .eq('tenant_id', tenantId)
        .eq('status', 'draft')
        .lt('created_at', twoDaysAgo.toISOString())

      const hasLowStock = lowStockItems.length > 0
      const hasRecentGRNs = (recentGRNs || []).length > 0
      const hasPendingDispatches = (pendingDispatches || []).length > 0

      // Nothing to report — don't send a message, that becomes noise the owner ignores
      if (!hasLowStock && !noRecentGRN && !hasRecentGRNs && !hasPendingDispatches) {
        continue
      }

      const todayDisplay = new Date().toLocaleString('en-IN', {
        timeZone: 'Asia/Kolkata',
        day: '2-digit',
        month: 'short',
        year: 'numeric'
      })

      let message = `🏭 <b>Good Morning — ${companyName}</b>\n📅 ${todayDisplay}\n`

      if (hasLowStock) {
        message += `\n🚨 <b>Low Stock (${lowStockItems.length} items)</b>\n`
        lowStockItems.forEach((item: StockBalanceRow) => {
          const stock = Number.isInteger(item.current_stock) ? item.current_stock : item.current_stock.toFixed(2)
          message += `• <b>${item.name}</b>: ${stock} ${item.unit} (min: ${item.min_stock_level} ${item.unit})\n`
        })
      }

      if (noRecentGRN) {
        message += `\n📦 <b>No GRN logged in 3+ days</b> — remember to record incoming stock.\n`
      }

      if (hasRecentGRNs) {
        // Group by material, sum quantities
        const grnByMaterial = new Map<string, { total: number; unit: string }>()
        for (const grn of (recentGRNs || []) as GRNRow[]) {
          const mat = materialMap.get(grn.raw_material_id)
          if (!mat) continue
          const existing = grnByMaterial.get(mat.name)
          if (existing) {
            existing.total += grn.quantity ?? 0
          } else {
            grnByMaterial.set(mat.name, { total: grn.quantity ?? 0, unit: mat.unit })
          }
        }

        let grnSection = `\n✅ <b>Yesterday's GRNs (${(recentGRNs || []).length} entries, ${grnByMaterial.size} material${grnByMaterial.size !== 1 ? 's' : ''})</b>\n`
        for (const [name, data] of grnByMaterial) {
          const total = Number.isInteger(data.total) ? data.total : data.total.toFixed(2)
          grnSection += `• <b>${name}</b>: ${total} ${data.unit}\n`
        }
        message += grnSection
      }

      if (hasPendingDispatches) {
        message += `\n⏳ <b>Pending Dispatches (${(pendingDispatches || []).length})</b>\n`
        ;(pendingDispatches || []).forEach((dispatch: DispatchRow) => {
          const daysPending = Math.floor(
            (Date.now() - new Date(dispatch.created_at).getTime()) / (1000 * 60 * 60 * 24)
          )
          message += `• Challan #${dispatch.challan_number || dispatch.id} — pending for ${daysPending} days\n`
        })
      }

      const success = await sendTelegramMessage(telegramChatId, message)

      const totalCount =
        lowStockItems.length + (recentGRNs || []).length + (pendingDispatches || []).length

      alerts.push({
        tenant: companyName,
        count: totalCount,
        success
      })
    }

    return new Response(
      JSON.stringify({
        success: true,
        message: `Processed ${tenants?.length || 0} tenants`,
        alerts,
        timestamp: new Date().toISOString()
      }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      }
    )

  } catch (error) {
    console.error('Edge function error:', error)
    return new Response(
      JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      }
    )
  }
})
