// Supabase Edge Function: schema-drift
// A8-drift — the four-line rowsecurity guard from automation-strategy.md
// §4.8, pulled forward out of the full A8 session (Phase 4) because it
// guards the most consequential bug class this codebase has actually
// shipped: policies created without ENABLE ROW LEVEL SECURITY, undetected
// until the Session 1 audit found 15 p2_* tables silently exposed
// (20260803_staff_rls_fix.sql). Migrations here are applied by hand through
// the SQL Editor, never `supabase db push`, so the live schema is the only
// authoritative record — this is the cheapest possible check on that.
//
// verify_jwt = false — cron-triggered only, same pattern as check-low-stock /
// notify / filing-package / resend-webhook. No request body is read; any
// invocation runs the same check.
//
// pg_tables is a system catalog, not reachable through PostgREST's exposed
// schemas (public/storage/graphql_public per config.toml) — so the query
// lives in get_tables_with_rls_disabled(), a SECURITY DEFINER RPC granted to
// service_role only (20260917_schema_drift_rpc.sql), and this function just
// calls it and decides what to do with the result.
//
// Two outcomes only, per spec: rows back → critical opsAlert. Zero rows →
// silent, nothing written, nothing logged. An RPC-call failure (the query
// itself erroring) is neither of those — it's console.error'd so it's
// visible in Edge Function logs, not folded into either alerting branch.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { opsAlert } from '../_shared/ops.ts'

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const supabase = createClient(
  Deno.env.get('SUPABASE_URL') ?? '',
  Deno.env.get('SB_SECRET_KEY') ?? ''
)

function respond(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  })
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS_HEADERS })
  }

  const { data, error } = await supabase.rpc('get_tables_with_rls_disabled')

  if (error) {
    console.error('schema-drift: get_tables_with_rls_disabled failed', error)
    return respond({ status: 'error', error: error.message }, 200)
  }

  const exposed = ((data ?? []) as Array<{ tablename: string }>).map((row) => row.tablename)

  if (exposed.length > 0) {
    await opsAlert({
      source: 'health',
      severity: 'critical',
      title: 'RLS disabled on live table',
      body: exposed.join(', '),
    })
  }

  return respond({ status: 'ok', checked_at: new Date().toISOString(), exposed_count: exposed.length })
})
