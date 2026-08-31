// 2L Type A regression harness — diffs two snapshot.js outputs, human-readable report.
// Usage: node diff.js <old.json> <new.json>  (bare filenames resolve against ./snapshots/)
const fs = require('fs')
const path = require('path')

function resolveSnapshotPath(arg) {
  if (fs.existsSync(arg)) return arg
  const inSnapshots = path.join(__dirname, 'snapshots', arg)
  if (fs.existsSync(inSnapshots)) return inSnapshots
  console.error(`Snapshot file not found: ${arg}`)
  process.exit(1)
}

function indexById(arr, idKey) {
  const map = new Map()
  for (const item of arr) map.set(item[idKey], item)
  return map
}

// Keyed by a stable id (never array position) so reordering never looks like a change.
function diffKeyedSection(oldArr, newArr, idKey, fields, label, out) {
  const oldMap = indexById(oldArr, idKey)
  const newMap = indexById(newArr, idKey)

  for (const [id, newItem] of newMap) {
    if (!oldMap.has(id)) out.push(`  [${label}] ${newItem.name}: added (new)`)
  }

  for (const [id, oldItem] of oldMap) {
    if (!newMap.has(id)) out.push(`  [${label}] ${oldItem.name}: removed`)
  }

  for (const [id, oldItem] of oldMap) {
    const newItem = newMap.get(id)
    if (!newItem) continue

    if (oldItem.name !== newItem.name) {
      out.push(`  [${label}] renamed: "${oldItem.name}" → "${newItem.name}"`)
    }

    const displayName = newItem.name || oldItem.name
    for (const field of fields) {
      if (oldItem[field] !== newItem[field]) {
        out.push(`  [${label}] ${displayName}: ${field} ${oldItem[field]} → ${newItem[field]}`)
      }
    }
  }
}

function diffDispatchCounts(oldCounts, newCounts, out) {
  const statuses = new Set([...Object.keys(oldCounts), ...Object.keys(newCounts)])
  for (const status of statuses) {
    const oldVal = oldCounts[status] ?? 0
    const newVal = newCounts[status] ?? 0
    if (oldVal !== newVal) out.push(`  [dispatch] status '${status}': ${oldVal} → ${newVal}`)
  }
}

function main() {
  const [, , oldArg, newArg] = process.argv
  if (!oldArg || !newArg) {
    console.error('Usage: node diff.js <old.json> <new.json>')
    process.exit(1)
  }

  const oldPath = resolveSnapshotPath(oldArg)
  const newPath = resolveSnapshotPath(newArg)
  const oldSnap = JSON.parse(fs.readFileSync(oldPath, 'utf8'))
  const newSnap = JSON.parse(fs.readFileSync(newPath, 'utf8'))

  if (oldSnap.meta.tenant_id !== newSnap.meta.tenant_id) {
    console.error(`Cannot diff snapshots from different tenants: ${oldSnap.meta.tenant_id} vs ${newSnap.meta.tenant_id}`)
    process.exit(1)
  }

  const diffs = []
  diffKeyedSection(
    oldSnap.stockBalances || [],
    newSnap.stockBalances || [],
    'raw_material_id',
    ['current_stock', 'unit', 'min_stock_level', 'material_code'],
    'stock',
    diffs
  )
  diffKeyedSection(
    oldSnap.activeMaterials || [],
    newSnap.activeMaterials || [],
    'id',
    ['unit', 'min_stock_level', 'material_code'],
    'materials',
    diffs
  )
  diffDispatchCounts(oldSnap.dispatchCounts || {}, newSnap.dispatchCounts || {}, diffs)

  console.log('Comparing:')
  console.log(`  old: ${oldPath} (${oldSnap.meta.captured_at_ist})`)
  console.log(`  new: ${newPath} (${newSnap.meta.captured_at_ist})`)
  console.log('')

  if (diffs.length === 0) {
    console.log('PASS: no differences found.')
    process.exit(0)
  }

  console.log('FAIL:')
  for (const line of diffs) console.log(line)
  process.exit(1)
}

main()
