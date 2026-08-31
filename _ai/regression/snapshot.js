// 2L Type A regression harness — read-only snapshot of SS Engineering's live state.
// No writes anywhere: only .select() calls against tables/views, no RPC, no insert/update/upsert.
const fs = require('fs')
const path = require('path')
const { createClient } = require('@supabase/supabase-js')

const EXPECTED_SS_UUID = '5ab7fb07-2557-42e7-8a8a-5d9fd59048ac'
const NAME_PATTERN = /s\.?\s*s\.?\s*engineering/i

function loadEnv(filePath) {
  const env = {}
  if (!fs.existsSync(filePath)) return env
  const content = fs.readFileSync(filePath, 'utf8')
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue
    const eqIdx = line.indexOf('=')
    if (eqIdx === -1) continue
    const key = line.slice(0, eqIdx).trim()
    let value = line.slice(eqIdx + 1).trim()
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1)
    }
    env[key] = value
  }
  return env
}

// IST is UTC+5:30 — matches the project's existing IST convention (8am cron etc.),
// computed via UTC getters so the machine's local timezone never leaks in.
function nowIST() {
  const istDate = new Date(Date.now() + 5.5 * 60 * 60 * 1000)
  const yyyy = istDate.getUTCFullYear()
  const mm = String(istDate.getUTCMonth() + 1).padStart(2, '0')
  const dd = String(istDate.getUTCDate()).padStart(2, '0')
  const hh = String(istDate.getUTCHours()).padStart(2, '0')
  const min = String(istDate.getUTCMinutes()).padStart(2, '0')
  return {
    fileStamp: `${yyyy}-${mm}-${dd}-${hh}-${min}`,
    display: `${yyyy}-${mm}-${dd} ${hh}:${min} IST`,
  }
}

// Resolves SS Engineering's tenant_id live from p2_tenant_settings.company_name —
// never hardcoded. The documented UUID is only used as a post-hoc sanity cross-check.
async function resolveTenant(supabase) {
  const { data, error } = await supabase.from('p2_tenant_settings').select('tenant_id, company_name')

  if (error) {
    console.error(`Failed to read p2_tenant_settings: ${error.message}`)
    process.exit(1)
  }

  const matches = (data || []).filter((row) => row.company_name && NAME_PATTERN.test(row.company_name))

  if (matches.length === 0) {
    console.error('No tenant found matching "S.S. Engineering" / "SS Engineering" in p2_tenant_settings.company_name. Aborting — refusing to hardcode a tenant_id.')
    process.exit(1)
  }

  if (matches.length > 1) {
    console.error('Multiple tenants matched the SS Engineering name pattern — ambiguous, aborting:')
    for (const row of matches) console.error(`  ${row.company_name} (${row.tenant_id})`)
    process.exit(1)
  }

  const row = matches[0]

  if (row.tenant_id !== EXPECTED_SS_UUID) {
    console.warn(`WARNING: Resolved tenant UUID ${row.tenant_id} does not match expected ${EXPECTED_SS_UUID}. Confirm this is SS Engineering before proceeding. Aborting.`)
    process.exit(1)
  }

  console.log(`Resolved tenant: ${row.company_name} (${row.tenant_id})`)
  return row
}

async function main() {
  const env = loadEnv(path.join(__dirname, '..', '..', '.env'))
  const SUPABASE_URL = env.SUPABASE_URL
  const SUPABASE_SERVICE_ROLE_KEY = env.SUPABASE_SERVICE_ROLE_KEY

  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    console.error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must both be set in .env at the repo root.')
    process.exit(1)
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  const tenant = await resolveTenant(supabase)
  const tenantId = tenant.tenant_id

  // Same select shape as supabase/functions/agent-query/index.ts's own v_p2_stock_balance query.
  const { data: stockBalances, error: stockError } = await supabase
    .from('v_p2_stock_balance')
    .select('raw_material_id, name, unit, min_stock_level, current_stock, material_code')
    .eq('tenant_id', tenantId)
    .order('name')

  if (stockError) {
    console.error(`Failed to read v_p2_stock_balance: ${stockError.message}`)
    process.exit(1)
  }

  const { data: activeMaterials, error: materialsError } = await supabase
    .from('p2_raw_materials')
    .select('id, name, unit, min_stock_level, material_code, is_active')
    .eq('tenant_id', tenantId)
    .eq('is_active', true)
    .order('name')

  if (materialsError) {
    console.error(`Failed to read p2_raw_materials: ${materialsError.message}`)
    process.exit(1)
  }

  const { data: dispatchRows, error: dispatchError } = await supabase
    .from('p2_dispatch_orders')
    .select('status')
    .eq('tenant_id', tenantId)

  if (dispatchError) {
    console.error(`Failed to read p2_dispatch_orders: ${dispatchError.message}`)
    process.exit(1)
  }

  const dispatchCounts = {}
  for (const row of dispatchRows || []) {
    dispatchCounts[row.status] = (dispatchCounts[row.status] || 0) + 1
  }

  const { fileStamp, display } = nowIST()
  const snapshot = {
    meta: {
      tenant_id: tenantId,
      company_name: tenant.company_name,
      captured_at_ist: display,
    },
    stockBalances: stockBalances || [],
    activeMaterials: activeMaterials || [],
    dispatchCounts,
  }

  const snapshotsDir = path.join(__dirname, 'snapshots')
  fs.mkdirSync(snapshotsDir, { recursive: true })
  const outFile = path.join(snapshotsDir, `${fileStamp}.json`)
  fs.writeFileSync(outFile, JSON.stringify(snapshot, null, 2))

  console.log(outFile)
}

main().catch((err) => {
  console.error(`Unexpected error: ${err.message}`)
  process.exit(1)
})
