// Supabase Edge Function: check-low-stock-instant
// Called fire-and-forget from production-issue.html, dispatch.html, and
// rm-dispatch.html right after a stock deduction. Checks only the materials
// just consumed and sends an instant Telegram alert if any dropped below
// min_stock_level — a same-minute complement to the daily check-low-stock digest.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const TELEGRAM_BOT_TOKEN = Deno.env.get('TELEGRAM_BOT_TOKEN')

interface StockBalanceRow {
  raw_material_id: string
  name: string
  unit: string
  min_stock_level: number
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
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: CORS_HEADERS,
    })
  }

  try {
    const body = await req.json().catch(() => ({}))
    const tenantId: string | undefined = body?.tenant_id
    const materialIds: string[] = Array.isArray(body?.material_ids) ? body.material_ids : []

    if (!tenantId || materialIds.length === 0) {
      return new Response(JSON.stringify({ success: true, skipped: 'missing tenant_id or material_ids' }), {
        status: 200,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' }
      })
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? ''
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    const supabase = createClient(supabaseUrl, supabaseServiceKey)

    const { data: settings, error: settingsError } = await supabase
      .from('p2_tenant_settings')
      .select('telegram_chat_id, company_name')
      .eq('tenant_id', tenantId)
      .single()

    if (settingsError || !settings?.telegram_chat_id) {
      return new Response(JSON.stringify({ success: true, skipped: 'no telegram_chat_id configured' }), {
        status: 200,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' }
      })
    }

    const telegramChatId = settings.telegram_chat_id
    const companyName = settings.company_name || 'Unknown Company'

    const { data: stockRows, error: stockError } = await supabase
      .from('v_p2_stock_balance')
      .select('raw_material_id, name, current_stock, unit, min_stock_level')
      .eq('tenant_id', tenantId)
      .in('raw_material_id', materialIds)
      .not('min_stock_level', 'is', null)

    if (stockError) {
      throw new Error(`Failed to fetch stock balance: ${stockError.message}`)
    }

    const lowStockItems = (stockRows || []).filter(
      (r: StockBalanceRow) => r.current_stock < r.min_stock_level
    )

    if (lowStockItems.length === 0) {
      return new Response(JSON.stringify({ success: true, skipped: 'no low stock items' }), {
        status: 200,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' }
      })
    }

    const todayDisplay = new Date().toLocaleString('en-IN', {
      timeZone: 'Asia/Kolkata',
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    })

    let message = `⚠️ <b>Low Stock Alert — ${companyName}</b>\n<i>Triggered after stock dispatch</i>\n`
    lowStockItems.forEach((item: StockBalanceRow) => {
      message += `\n• <b>${item.name}</b>: ${item.current_stock.toFixed(2)} ${item.unit} (min: ${item.min_stock_level} ${item.unit})`
    })
    message += `\n\n📅 ${todayDisplay}`

    const success = await sendTelegramMessage(telegramChatId, message)

    return new Response(JSON.stringify({ success, alerted: lowStockItems.length }), {
      status: 200,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' }
    })

  } catch (error) {
    console.error('Edge function error:', error)
    return new Response(
      JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      }),
      {
        status: 500,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' }
      }
    )
  }
})
