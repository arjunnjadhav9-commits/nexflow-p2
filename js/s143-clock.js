// Pure, timezone-safe s.143 return-clock math. No DOM, no Supabase calls.
// Bare globals — matches js/movement-purpose.js's no-module convention.
//
// Design decision (Session 8): the s143_clock_start/deadline columns +
// trigger on p2_dispatch_orders (supabase/migrations/20260825_s143_clock_population.sql)
// fire only when THIS tenant is the principal issuing material out
// (job_work_issue/capital_goods_issue) — that direction is dormant for all
// three live tenants, who are job WORKERS receiving KPML's material via GRN.
// There is no stored clock for that direction. Rather than add a second
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
// for this fix.

const S143_CLOCK_DAYS = 365;
const S143_GREEN_MAX_DAYS = 270;
const S143_WARNING_MAX_DAYS = 330;

// Parses a bare 'YYYY-MM-DD' string as UTC midnight and adds N days in pure
// UTC calendar arithmetic. Anchoring both parse and serialize in UTC keeps
// the result independent of the browser/OS timezone — the same class of bug
// todayIST() exists to prevent, one level removed (date-plus-N-days rather
// than "what is today").
function s143AddDays(isoDateStr, days) {
    const d = new Date(isoDateStr + 'T00:00:00Z');
    d.setUTCDate(d.getUTCDate() + days);
    return d.toISOString().split('T')[0];
}

// Whole days between two 'YYYY-MM-DD' strings (b - a), same UTC-anchored
// safety as s143AddDays.
function s143DaysBetween(isoDateStrA, isoDateStrB) {
    const a = new Date(isoDateStrA + 'T00:00:00Z');
    const b = new Date(isoDateStrB + 'T00:00:00Z');
    return Math.round((b - a) / 86400000);
}

// row: { principal_challan_date: string|null, transaction_date: string }
// todayIsoDate: an IST calendar date string, from todayIST()
// returns: { clockStart, deadlineDate, daysElapsed, status } or null if
// neither date is available (defensive only — transaction_date is NOT NULL
// in the schema, so this should not occur in practice).
function computeS143Clock(row, todayIsoDate) {
    const clockStart = row.principal_challan_date || row.transaction_date;
    if (!clockStart) return null;

    const deadlineDate = s143AddDays(clockStart, S143_CLOCK_DAYS);
    const daysElapsed = s143DaysBetween(clockStart, todayIsoDate);

    let status;
    if (daysElapsed <= S143_GREEN_MAX_DAYS) status = 'within_limit';
    else if (daysElapsed <= S143_WARNING_MAX_DAYS) status = 'warning';
    else if (daysElapsed <= S143_CLOCK_DAYS) status = 'breach_warning';
    else status = 'breached';

    return { clockStart, deadlineDate, daysElapsed, status };
}
