// Supabase Edge Function: invoice-view
// Public, unauthenticated lookup by invoice_token for the /invoice.html page.
// Bypasses RLS via service role — the token itself is the only access control.
//
// Unlike receive-dispatch, this does NOT join p2_dispatch_items or
// p2_material_prices/p2_product_prices at read time. p2_invoices.items is a
// frozen jsonb snapshot taken at generation time (see the 20260730_create_
// invoices_table migration) — rendering always reads that snapshot, never
// re-derives rates, so a price change after the invoice was emailed can never
// cause the PDF to drift from the amounts already sent to the client.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const supabase = createClient(
  Deno.env.get('SUPABASE_URL') ?? '',
  Deno.env.get('SB_SECRET_KEY') ?? ''
)

function json(body: unknown, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  })
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS_HEADERS })
  }

  const token = new URL(req.url).searchParams.get('token')
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
  if (!token || !UUID_RE.test(token)) {
    return json({ error: 'not_found' }, 404)
  }

  try {
    const { data: invoice, error: invoiceError } = await supabase
      .from('p2_invoices')
      .select(`
        invoice_number, invoice_date:created_at, client_name, client_address,
        client_gstin, items, amount_subtotal, amount_gst, amount_total,
        gst_type, invoice_mode, date_from, date_to, status, tenant_id
      `)
      .eq('invoice_token', token)
      .limit(1)
      .maybeSingle()

    if (invoiceError) {
      console.error('invoice-view invoice lookup error:', invoiceError)
      return json({ error: 'server_error' }, 500)
    }

    if (!invoice) {
      return json({ error: 'not_found' }, 404)
    }

    const { data: settings, error: settingsError } = await supabase
      .from('p2_tenant_settings')
      .select('company_name, address_line1, address_line2, mobile, gstin, bank_name, bank_account, bank_ifsc')
      .eq('tenant_id', invoice.tenant_id)
      .maybeSingle()

    if (settingsError) {
      console.error('invoice-view settings lookup error:', settingsError)
      return json({ error: 'server_error' }, 500)
    }

    const { tenant_id: _tenantId, ...invoiceOut } = invoice

    return json({
      invoice: invoiceOut,
      tenant: {
        company_name: settings?.company_name ?? null,
        address_line1: settings?.address_line1 ?? null,
        address_line2: settings?.address_line2 ?? null,
        mobile: settings?.mobile ?? null,
        gstin: settings?.gstin ?? null,
        bank_name: settings?.bank_name ?? null,
        bank_account: settings?.bank_account ?? null,
        bank_ifsc: settings?.bank_ifsc ?? null,
      },
    }, 200)

  } catch (error) {
    console.error('invoice-view unexpected error:', error)
    return json({ error: 'server_error' }, 500)
  }
})
