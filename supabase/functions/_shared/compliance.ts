// Shared module: compliance constants and helpers for Edge Function
// (Deno-to-Deno) consumers. Same pattern as _shared/ops.ts and
// _shared/s143.ts — NOT the browser<->Deno boundary, which this codebase has
// no shared module system across (no bundler, no build step, plain
// <script> tags only). Browser pages keep their own inline copies; this
// file is the canonical source for agent-query, filing-package, and future
// Edge Function consumers (W3, I1, M1) only.

// Matching key normaliser for supplier invoice numbers — verbatim from
// gstr2b-reconcile.html's normaliseInvoiceNo(), which is itself the
// specification (GSTR-2B reconciliation matches on this exact key).
// grn.html carries a byte-identical inline copy for its own duplicate-
// invoice warning; that copy is NOT replaced by this import — a plain
// <script> tag cannot import a Deno-side .ts module. Any Edge Function
// checking "is this the same invoice number" must use this function so it
// never silently disagrees with the browser-side copies.
export function normaliseInvoiceNo(str: string | null | undefined): string {
  return String(str ?? '').replace(/[\s\-/]/g, '').toUpperCase()
}

// s.143 return-clock period constants.
//
// S143_INPUT_CLOCK_DAYS mirrors js/s143-clock.js's S143_CLOCK_DAYS (also
// re-exported from _shared/s143.ts) — the GRN-side (inbound) clock, which
// treats every received lot as a 365-day input.
//
// S143_CAPITAL_GOODS_CLOCK_DAYS is NOT extracted from any existing JS/TS
// source — it exists today only as a raw `INTERVAL '3 years'` literal
// inside the set_s143_clock() Postgres trigger
// (supabase/migrations/20260825_s143_clock_population.sql), which governs
// the DISPATCH-side (outbound) clock for capital_goods_issue movements. That
// SQL trigger remains the authoritative implementation for the dispatch-side
// clock — this constant does not change its behaviour and nothing currently
// reads it. It is added here, named and documented, so a future GRN-side
// capital-goods clock (if one is ever built) has one place to get the
// number right instead of re-deriving "3 years" from scratch.
export const S143_INPUT_CLOCK_DAYS = 365
export const S143_CAPITAL_GOODS_CLOCK_DAYS = 1095
