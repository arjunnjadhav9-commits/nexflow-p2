// Supabase Edge Function: receive-dispatch
// Public, unauthenticated lookup by dispatch_token (QR scan target — Tier 4 foundation).
// Resolves a confirmed challan's details for the /receive.html page.
// Bypasses RLS via service role — the token itself is the only access control.

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
    const { data: order, error: orderError } = await supabase
      .from('p2_dispatch_orders')
      .select('id, tenant_id, challan_number, dispatch_date, dispatch_type, client_name, client_address, status')
      .eq('dispatch_token', token)
      .limit(1)
      .maybeSingle()

    if (orderError) {
      console.error('receive-dispatch order lookup error:', orderError)
      return json({ error: 'server_error' }, 500)
    }

    if (!order || order.status !== 'confirmed') {
      return json({ error: 'not_found' }, 404)
    }

    const { data: settings, error: settingsError } = await supabase
      .from('p2_tenant_settings')
      .select('company_name, address_line1, address_line2, mobile, gstin')
      .eq('tenant_id', order.tenant_id)
      .maybeSingle()

    if (settingsError) {
      console.error('receive-dispatch settings lookup error:', settingsError)
      return json({ error: 'server_error' }, 500)
    }

    const { data: items, error: itemsError } = await supabase
      .from('p2_dispatch_items')
      .select('material_name, material_code, qty_dispatched, unit')
      .eq('dispatch_order_id', order.id)
      .eq('tenant_id', order.tenant_id)

    if (itemsError) {
      console.error('receive-dispatch items lookup error:', itemsError)
      return json({ error: 'server_error' }, 500)
    }

    return json({
      dispatch: {
        challan_number: order.challan_number,
        dispatch_date: order.dispatch_date,
        dispatch_type: order.dispatch_type,
        client_name: order.client_name,
        client_address: order.client_address,
        status: order.status,
      },
      supplier: {
        company_name: settings?.company_name ?? null,
        address_line1: settings?.address_line1 ?? null,
        address_line2: settings?.address_line2 ?? null,
        mobile: settings?.mobile ?? null,
        gstin: settings?.gstin ?? null,
      },
      items: items ?? [],
    }, 200)

  } catch (error) {
    console.error('receive-dispatch unexpected error:', error)
    return json({ error: 'server_error' }, 500)
  }
})
