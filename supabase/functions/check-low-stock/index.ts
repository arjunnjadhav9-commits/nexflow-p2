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

interface NudgeTenantSettings {
  company_name: string
  telegram_chat_id?: string
  agent_enabled?: boolean
}

interface PaymentTenantSettings {
  company_name: string
  telegram_chat_id?: string
}

interface OverdueInvoiceRow {
  invoice_id: string
  invoice_number: string
  client_name: string
  balance_due: number
  invoice_date: string
  payment_status: string
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

// Monthly GSTR-2B nudge (jobid 3, 15th of every month) — reuses this function
// via a `mode` flag on the cron's POST body instead of a dedicated Edge
// Function, so no new function needs deploying just for a fixed reminder text.
// deno-lint-ignore no-explicit-any
async function sendGstr2bNudge(supabase: any): Promise<Response> {
  const { data: tenants, error: tenantsError } = await supabase
    .from('p2_tenants')
    .select(`
      id,
      p2_tenant_settings (
        company_name,
        telegram_chat_id,
        agent_enabled
      )
    `)

  if (tenantsError) {
    return new Response(
      JSON.stringify({ success: false, error: `Failed to fetch tenants: ${tenantsError.message}` }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    )
  }

  const message = '📋 GSTR-2B is now available on the GST portal. Upload it to Nexflow and run reconciliation before filing GSTR-3B on the 20th.'
  const results: Array<{ tenant: string; success: boolean }> = []

  for (const tenant of tenants || []) {
    const settings = (Array.isArray(tenant.p2_tenant_settings)
      ? tenant.p2_tenant_settings[0]
      : tenant.p2_tenant_settings) as NudgeTenantSettings | undefined

    const telegramChatId = settings?.telegram_chat_id
    if (!settings?.agent_enabled || !telegramChatId) continue

    const success = await sendTelegramMessage(telegramChatId, message)
    results.push({ tenant: settings.company_name || 'Unknown Company', success })
  }

  return new Response(
    JSON.stringify({
      success: true,
      message: `GSTR-2B nudge sent to ${results.length} tenant(s)`,
      results,
      timestamp: new Date().toISOString()
    }),
    { status: 200, headers: { 'Content-Type': 'application/json' } }
  )
}

// Payment overdue digest — triggered manually or by a future cron extension
// (cron wiring is out of scope here), same `mode` flag pattern as
// sendGstr2bNudge above. Reads v_p2_invoice_payment_status server-side —
// the one place that view is meant to be read from.
// deno-lint-ignore no-explicit-any
async function sendPaymentOverdueDigest(supabase: any): Promise<Response> {
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
    return new Response(
      JSON.stringify({ success: false, error: `Failed to fetch tenants: ${tenantsError.message}` }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    )
  }

  const results: Array<{ tenant: string; success: boolean }> = []

  for (const tenant of tenants || []) {
    const settings = (Array.isArray(tenant.p2_tenant_settings)
      ? tenant.p2_tenant_settings[0]
      : tenant.p2_tenant_settings) as PaymentTenantSettings | undefined

    const telegramChatId = settings?.telegram_chat_id
    if (!telegramChatId) continue

    const { data: overdueRows, error: overdueError } = await supabase
      .from('v_p2_invoice_payment_status')
      .select('invoice_id, invoice_number, client_name, balance_due, invoice_date, payment_status')
      .eq('tenant_id', tenant.id)
      .eq('payment_status', 'overdue')
      .eq('invoice_status', 'sent')

    if (overdueError) {
      console.error(`Error fetching overdue invoices for tenant ${tenant.id}:`, overdueError)
      continue
    }

    const overdueInvoices = (overdueRows || []) as OverdueInvoiceRow[]
    if (overdueInvoices.length === 0) continue

    const companyName = settings?.company_name || 'Unknown Company'

    let message = `💰 <b>Overdue Payments — ${companyName}</b>\n${overdueInvoices.length} invoice(s) are overdue:\n`
    overdueInvoices.slice(0, 5).forEach((inv) => {
      const daysOverdue = Math.floor((Date.now() - new Date(inv.invoice_date).getTime()) / (1000 * 60 * 60 * 24)) - 45
      message += `• Invoice ${inv.invoice_number} — ${inv.client_name} — ₹${Number(inv.balance_due).toLocaleString('en-IN')} overdue by ${daysOverdue} days\n`
    })
    if (overdueInvoices.length > 5) {
      message += `+ ${overdueInvoices.length - 5} more\n`
    }

    const success = await sendTelegramMessage(telegramChatId, message)
    results.push({ tenant: companyName, success })
  }

  return new Response(
    JSON.stringify({
      success: true,
      message: `Payment overdue digest sent to ${results.length} tenant(s)`,
      results,
      timestamp: new Date().toISOString()
    }),
    { status: 200, headers: { 'Content-Type': 'application/json' } }
  )
}

// payment_overdue_notify (Step 4) — per-invoice p2_notifications rows fanned
// out through the notify Edge Function, distinct from sendPaymentOverdueDigest
// above (which sends one combined Telegram-only message and writes nothing to
// p2_notifications). This one is additive — both continue to run — and gives
// overdue payments a durable record + in-app bell entry, deduped per invoice
// per 24h so the daily cron doesn't re-notify on an invoice that's still
// overdue tomorrow. amount_total (not balance_due) per spec: for rows where
// payment_status = 'overdue', total_received is always 0, so the two are
// numerically identical here anyway.
// deno-lint-ignore no-explicit-any
async function sendPaymentOverdueNotify(supabase: any): Promise<Response> {
  const { data: tenants, error: tenantsError } = await supabase
    .from('p2_tenants')
    .select('id')

  if (tenantsError) {
    return new Response(
      JSON.stringify({ success: false, error: `Failed to fetch tenants: ${tenantsError.message}` }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    )
  }

  const anonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? ''
  const notifyUrl = `${Deno.env.get('SUPABASE_URL') ?? ''}/functions/v1/notify`
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()

  let inserted = 0
  let deduped = 0

  for (const tenant of tenants || []) {
    const { data: overdueRows, error: overdueError } = await supabase
      .from('v_p2_invoice_payment_status')
      .select('invoice_id, invoice_number, client_name, amount_total')
      .eq('tenant_id', tenant.id)
      .eq('payment_status', 'overdue')
      .eq('invoice_status', 'sent')

    if (overdueError) {
      console.error(`payment_overdue_notify: error fetching overdue invoices for tenant ${tenant.id}:`, overdueError)
      continue
    }

    for (const inv of (overdueRows || []) as { invoice_id: string; invoice_number: string; client_name: string; amount_total: number }[]) {
      const { data: existing, error: existingError } = await supabase
        .from('p2_notifications')
        .select('id')
        .eq('tenant_id', tenant.id)
        .eq('type', 'payment_overdue')
        .eq('metadata->>invoice_id', inv.invoice_id)
        .gte('created_at', since)
        .limit(1)

      if (existingError) {
        console.error(`payment_overdue_notify: dedup check failed for invoice ${inv.invoice_id}:`, existingError)
        continue
      }
      if (existing && existing.length > 0) { deduped++; continue }

      const { data: row, error: insertError } = await supabase
        .from('p2_notifications')
        .insert({
          tenant_id: tenant.id,
          type: 'payment_overdue',
          title: 'Payment overdue',
          body: `Invoice ${inv.invoice_number} for ${inv.client_name} — ₹${Number(inv.amount_total).toLocaleString('en-IN')} overdue.`,
          metadata: {
            invoice_id: inv.invoice_id,
            invoice_number: inv.invoice_number,
            client_name: inv.client_name,
            amount_total: inv.amount_total
          },
          status: 'queued'
        })
        .select('id')
        .single()

      if (insertError || !row) {
        console.error(`payment_overdue_notify: insert failed for invoice ${inv.invoice_id}:`, insertError)
        continue
      }

      inserted++
      fetch(notifyUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${anonKey}` },
        body: JSON.stringify({ notification_id: row.id })
      }).catch(() => {})
    }
  }

  return new Response(
    JSON.stringify({
      success: true,
      message: `payment_overdue_notify: ${inserted} notification(s) created, ${deduped} deduped`,
      timestamp: new Date().toISOString()
    }),
    { status: 200, headers: { 'Content-Type': 'application/json' } }
  )
}

Deno.serve(async (req) => {
  try {
    // Initialize Supabase client with service role key for admin access
    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? ''
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''

    const supabase = createClient(supabaseUrl, supabaseServiceKey)

    // jobid 3 (monthly GSTR-2B nudge) posts {"mode":"gstr2b_nudge"} to this
    // same function instead of getting its own — see sendGstr2bNudge above.
    const body = await req.json().catch(() => ({} as Record<string, unknown>))
    if (body && (body as Record<string, unknown>).mode === 'payment_overdue_notify') {
      return await sendPaymentOverdueNotify(supabase)
    }
    if (body && (body as Record<string, unknown>).mode === 'gstr2b_nudge') {
      return await sendGstr2bNudge(supabase)
    }
    if (body && (body as Record<string, unknown>).mode === 'payment_overdue_digest') {
      return await sendPaymentOverdueDigest(supabase)
    }

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

    const anonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? ''
    const notifyUrl = `${Deno.env.get('SUPABASE_URL') ?? ''}/functions/v1/notify`

    const alerts: Array<{ tenant: string; count: number; lowStockNotified: boolean; digestSent: boolean }> = []

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
      const hasDigestContent = noRecentGRN || hasRecentGRNs || hasPendingDispatches

      // Nothing to report — don't send a message, that becomes noise the owner ignores
      if (!hasLowStock && !hasDigestContent) {
        continue
      }

      // Low stock: insert into p2_notifications and hand off to the notify Edge
      // Function (quiet-hours-aware, flips status to sent/failed with a reason)
      // instead of calling the Telegram API directly — same pattern as
      // sendPaymentOverdueNotify above. One combined row per tenant per run
      // (not one row per material), so this stays a single Telegram message
      // like the digest always was.
      let lowStockNotified = false
      if (hasLowStock) {
        const MAX_ITEMS = 20
        const shown = lowStockItems.slice(0, MAX_ITEMS)
        const remaining = lowStockItems.length - MAX_ITEMS

        const lowStockLines = shown.map((item: StockBalanceRow) => {
          const stock = Number.isInteger(item.current_stock) ? item.current_stock : item.current_stock.toFixed(2)
          return `• ${item.name}: ${stock} ${item.unit} (min: ${item.min_stock_level} ${item.unit})`
        })
        const lowStockBody = `${lowStockItems.length} item(s) below minimum stock level:\n${lowStockLines.join('\n')}${remaining > 0 ? `\n...and ${remaining} more. Check the app for the full list.` : ''}`

        const { data: notifRow, error: notifInsertError } = await supabase
          .from('p2_notifications')
          .insert({
            tenant_id: tenantId,
            type: 'low_stock',
            title: '⚠️ Low Stock Alert',
            body: lowStockBody,
            metadata: {
              materials: lowStockItems.map((item: StockBalanceRow) => ({
                raw_material_id: item.raw_material_id,
                name: item.name,
                current_stock: item.current_stock,
                min_stock_level: item.min_stock_level,
                unit: item.unit
              }))
            },
            status: 'queued'
          })
          .select('id')
          .single()

        if (notifInsertError || !notifRow) {
          console.error(`Error inserting low_stock notification for tenant ${tenantId}:`, notifInsertError)
        } else {
          lowStockNotified = true
          fetch(notifyUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${anonKey}` },
            body: JSON.stringify({ notification_id: notifRow.id })
          }).catch(() => {})
        }
      }

      // Everything else stays a single direct Telegram message — none of these
      // have a matching p2_notifications type, so they can't move to the
      // insert-then-notify pipeline without a schema change.
      let digestSent = false
      if (hasDigestContent) {
        const todayDisplay = new Date().toLocaleString('en-IN', {
          timeZone: 'Asia/Kolkata',
          day: '2-digit',
          month: 'short',
          year: 'numeric'
        })

        let message = `🏭 <b>Good Morning — ${companyName}</b>\n📅 ${todayDisplay}\n`

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

        digestSent = await sendTelegramMessage(telegramChatId, message)
      }

      const totalCount =
        lowStockItems.length + (recentGRNs || []).length + (pendingDispatches || []).length

      alerts.push({
        tenant: companyName,
        count: totalCount,
        lowStockNotified,
        digestSent
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
