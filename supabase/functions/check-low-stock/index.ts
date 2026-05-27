// Supabase Edge Function: check-low-stock
// Runs daily to check stock levels and send Telegram alerts

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const TELEGRAM_BOT_TOKEN = Deno.env.get('TELEGRAM_BOT_TOKEN')

interface Tenant {
  id: string
  telegram_chat_id?: string
  company_name: string
}

interface Material {
  id: string
  name: string
  unit: string
  min_stock_level: number
}

interface StockBalance {
  raw_material_id: string
  current_stock: number
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

      // Fetch all raw materials for this tenant
      const { data: materials, error: materialsError } = await supabase
        .from('p2_raw_materials')
        .select('id, name, unit, min_stock_level')
        .eq('tenant_id', tenantId)

      if (materialsError) {
        console.error(`Error fetching materials for tenant ${tenantId}:`, materialsError)
        continue
      }

      // Compute current stock for each material by summing stock_transactions
      const lowStockItems: Array<{ name: string; currentStock: number; unit: string; minLevel: number }> = []

      for (const material of materials || []) {
        const { data: stockData, error: stockError } = await supabase
          .from('p2_stock_transactions')
          .select('quantity')
          .eq('tenant_id', tenantId)
          .eq('raw_material_id', material.id)

        if (stockError) {
          console.error(`Error fetching stock for material ${material.id}:`, stockError)
          continue
        }

        // Calculate current stock
        const currentStock = (stockData || []).reduce((sum, txn) => sum + (txn.quantity || 0), 0)

        // Check if below minimum level
        if (currentStock < material.min_stock_level) {
          lowStockItems.push({
            name: material.name,
            currentStock: currentStock,
            unit: material.unit,
            minLevel: material.min_stock_level
          })
        }
      }

      // Send Telegram alert if there are low stock items
      if (lowStockItems.length > 0) {
        let message = `🚨 <b>Low Stock Alert — ${companyName}</b>\n\n`

        lowStockItems.forEach(item => {
          message += `• <b>${item.name}</b>: ${item.currentStock.toFixed(2)} ${item.unit} (min: ${item.minLevel} ${item.unit})\n`
        })

        message += `\n📅 ${new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}`

        const success = await sendTelegramMessage(telegramChatId, message)

        alerts.push({
          tenant: companyName,
          count: lowStockItems.length,
          success
        })
      }
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
