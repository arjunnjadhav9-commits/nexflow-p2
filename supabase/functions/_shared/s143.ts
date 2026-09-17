// Shared module: computeS143Clock() — verbatim port of js/s143-clock.js for
// Edge Function (Deno-to-Deno) consumers. Deno-to-Deno import between Edge
// Functions, same as _shared/ops.ts — NOT the browser<->Deno boundary
// CLAUDE.md says has no shared module system; that boundary is unaffected.
// js/s143-clock.js (the browser copy) is untouched and stays the source for
// every HTML page — this file exists so filing-package/index.ts and future
// Edge Function consumers (W3, I1, M1) stop each carrying their own copy.
//
// Design decision (Session 8, carried over verbatim): the
// s143_clock_start/deadline columns + trigger on p2_dispatch_orders
// (supabase/migrations/20260825_s143_clock_population.sql) fire only when
// THIS tenant is the principal issuing material out (job_work_issue/
// capital_goods_issue) — that direction is dormant for all three live
// tenants, who are job WORKERS receiving KPML's material via GRN. There is
// no stored clock for that direction. Rather than add a second
// trigger/column pair to p2_stock_transactions, the clock is computed at
// READ TIME from data already captured on the GRN row by grn.html's
// Material Owner selector:
//
//   clockStart = COALESCE(principal_challan_date, transaction_date)
//
// Simplification, explicitly flagged: every row is treated as an "input"
// (365-day clock). Nexflow's schema has no capital-goods-vs-input
// classification on the GRN side, so the 3-year capital-goods band and the
// is_exempt_tooling no-deadline case cannot be derived here. Out of scope
// for this fix. (The dispatch-side outbound clock DOES have a 3-year
// capital-goods band — see set_s143_clock() in that same migration — but
// that is a different code path, computed in SQL at write time, not here.)

export const S143_CLOCK_DAYS = 365
export const S143_GREEN_MAX_DAYS = 270
export const S143_WARNING_MAX_DAYS = 330

export type S143Status = 'within_limit' | 'warning' | 'breach_warning' | 'breached'

export interface S143ClockRow {
  principal_challan_date: string | null
  transaction_date: string
}

export interface S143ClockResult {
  clockStart: string
  deadlineDate: string
  daysElapsed: number
  status: S143Status
}

// Parses a bare 'YYYY-MM-DD' string as UTC midnight and adds N days in pure
// UTC calendar arithmetic. Anchoring both parse and serialize in UTC keeps
// the result independent of the runtime's timezone — the same class of bug
// todayIST() exists to prevent, one level removed (date-plus-N-days rather
// than "what is today").
export function s143AddDays(isoDateStr: string, days: number): string {
  const d = new Date(isoDateStr + 'T00:00:00Z')
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().split('T')[0]
}

// Whole days between two 'YYYY-MM-DD' strings (b - a), same UTC-anchored
// safety as s143AddDays.
export function s143DaysBetween(isoDateStrA: string, isoDateStrB: string): number {
  const a = new Date(isoDateStrA + 'T00:00:00Z')
  const b = new Date(isoDateStrB + 'T00:00:00Z')
  return Math.round((b.getTime() - a.getTime()) / 86400000)
}

// todayIsoDate: an IST calendar date string, from todayIST().
// returns null if neither date is available (defensive only —
// transaction_date is NOT NULL in the schema, so this should not occur in
// practice).
export function computeS143Clock(row: S143ClockRow, todayIsoDate: string): S143ClockResult | null {
  const clockStart = row.principal_challan_date || row.transaction_date
  if (!clockStart) return null

  const deadlineDate = s143AddDays(clockStart, S143_CLOCK_DAYS)
  const daysElapsed = s143DaysBetween(clockStart, todayIsoDate)

  let status: S143Status
  if (daysElapsed <= S143_GREEN_MAX_DAYS) status = 'within_limit'
  else if (daysElapsed <= S143_WARNING_MAX_DAYS) status = 'warning'
  else if (daysElapsed <= S143_CLOCK_DAYS) status = 'breach_warning'
  else status = 'breached'

  return { clockStart, deadlineDate, daysElapsed, status }
}
