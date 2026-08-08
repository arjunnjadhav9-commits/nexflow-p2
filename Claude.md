# Nexflow Automations — P2 Raw Material & Inventory Tracker

## Project Overview
SaaS product for MIDC factory owners (Maharashtra, India).
Multi-tenant: each factory owner is one tenant with isolated data.
Language: English UI with toggle for Marathi (localStorage key 'nexflow_lang').
Mobile-first: owners use phones. Must work on mobile browser.

## Tech Stack
- Frontend: Plain HTML + vanilla CSS + ES6+ JS — NO frameworks, NO build tools
- Backend: Supabase (PostgreSQL + Edge Functions + Storage + Auth)
- Hosting: Vercel (static HTML files)
- Notifications: Telegram Bot API (daily 8AM IST alert, pg_net cron, jobid 2, fires 2:30 UTC)
- Email: Resend (send_challan live; send_tally_export live)
- AI/Automation: Claude Haiku 4.5 via Anthropic API, in a Supabase Edge Function only.
  No n8n, no middleware, no separate agent service.

## Supabase Config
- All tables use prefix: p2_
- Multi-tenancy via tenant_id column + Row Level Security (RLS) on all tables
- Auth: Supabase Auth (email/password)
- **CRITICAL: tenant_id = user.id directly. There is NO separate tenant table, and
  tenant_id is NOT reliably read from user_metadata in all contexts — some RLS INSERT
  policies (e.g. p2_dispatch_orders) read tenant_id from JWT user_metadata, not auth.uid().
  Check which pattern applies per-table before writing new insert logic.**

## Brand
- Company: Nexflow Automations
- Colors: Orange gradient #ff5c1a → #ff8c42 (NOT teal/green — that's the old deprecated palette)
- Logo: /assets/nexflow_logo_transparent.png — MUST be in root-level assets/ folder,
  NOT inside a folder literally named public/ (Vercel treats public/ as static output root,
  breaks asset paths)

## Database Tables (all with p2_ prefix)
- p2_tenant_settings — company name, address, logo_url, challan_sequence, GSTIN,
  challan_mode, agent_tier, agent_interactions_today, agent_reset_date, ca_email, agent_enabled,
  email (used as reply_to for challan emails — tell owners to fill this in Settings),
  invoice_sequence, bank_name, bank_account, bank_ifsc (added July 30 — invoice feature),
  sac_code (added Aug 7 — SAC code printed on every invoice PDF line item, tax invoice format),
  plan text (values: 'founder' [clients 1-5], 'pro' [client 6+ Pro], 'lite' [client 6+ Lite],
  'demo' [landing page demo account] — drives feature gating, see Plan gating section below),
  agent_tier CHECK constraint: only 'standard', 'power', 'unlimited' (never 'founder' or any
  other value) — standard = 30/day (founder clients), power = not yet used, unlimited = test
  tenant only, never reset. New Pro clients (plan='pro') get 50/day via a plan check in
  agent-query, not via agent_tier.
- p2_raw_materials — raw material master (name, unit, min_stock_level, is_active, material_code,
  hsn_sac, gst_rate — both already existed, confirmed present here for reference)
- p2_suppliers — supplier master (is_active — CSV-imported suppliers default to
  is_active=false, invisible in dropdowns/matching unless checked), gstin text
  (added Aug 7 — supplier GSTIN, optional, printed on CA export GRN sheet)
- p2_stock_transactions — append-only log. transaction_type check constraint: ONLY
  'grn', 'consumption', 'adjustment' (lowercase, no other values allowed).
  Opening stock = type='adjustment', notes='Opening Stock' — not a separate type.
  reference_id links transactions to their originating dispatch/challan.
  Has rate column (what was paid on that specific GRN — NOT a standing cost rate).
  purchase_type text NOT NULL DEFAULT 'intrastate' CHECK IN ('intrastate','interstate')
  (added Aug 7 — routes GRN GST math to CGST/SGST vs IGST across CA export, Tally export,
  and Zoho export). invoice_no text — already existed, now mandatory on the GRN form
  (grn.html, added Aug 7).
- p2_products — finished goods, has product_code (unique index per tenant), hsn_sac text
  (added Aug 7 — HSN/SAC, optional, for CA export)
- p2_product_bom — recipe. Uses raw_material_id and qty_per_unit (not product_id-only or qty).
- p2_dispatch_orders — each dispatch = one challan. Has RPCs: confirm_bom_issue,
  cancel_challan, add_missing_challan_item, get_next_grn_number.
  confirm_bom_issue (v2, Aug 7): server-side stock check aggregates required qty per
  material_id across all BOM lines (GROUP BY) before checking balance, using a FOR UPDATE
  subquery lock; raises INSUFFICIENT_STOCK: {material} — Need {x}, Available {y}.
  production-issue.html catches this and shows a clean toast.
  dispatch_type values: bom_issue, raw_material, product.
  status values: draft, confirmed, cancelled — NO 'pending'.
  challan_number column (NOT challan_no). NO notes column — use challan_note if needed.
  dispatch_token column: uuid NOT NULL DEFAULT gen_random_uuid(), unique index — added July 26.
- p2_dispatch_items — line items in a dispatch. Columns: id, tenant_id, dispatch_order_id,
  material_name, material_code, qty_dispatched, unit, raw_material_id, product_id, notes, created_at.
  IMPORTANT: product dispatches have NULL material_name at DB level — product name must be
  resolved from p2_products via product_id in any code that displays dispatch items.
- p2_clients — client master. Columns: id, tenant_id, name, address, email, created_at,
  updated_at, po_number, gstin (added July 30). NO is_active column. email added July 25 —
  used for send_challan.
- p2_material_prices — raw material price history. Columns: id, tenant_id, raw_material_id,
  price_per_unit, effective_date, supplier_name, notes, created_at.
  Valuation rate = latest price_per_unit by effective_date (used in CA report, export, invoices).
  p2_stock_transactions.rate is NOT the valuation rate — it's the GRN-specific paid rate.
- p2_product_prices — finished-goods selling price history (previously undocumented here,
  but real and actively used — settings.html "Prices" tab, ca-report.html). Columns: id,
  tenant_id, product_id, price, effective_date, notes, created_at. Same "latest by
  effective_date" idiom as p2_material_prices — order by effective_date desc, keep first
  hit per id. Note the column is `price`, not `price_per_unit` (unlike p2_material_prices).
- p2_invoices — client billing invoice (proforma, NOT a GST filing document — see GST
  Scope below). Columns: id, tenant_id, invoice_number, dispatch_order_id (single mode only,
  NULL for consolidated), client_id, client_name/client_address/client_gstin (frozen snapshot,
  same philosophy as challan's client fields), items jsonb (frozen line-item snapshot —
  [{challan_number, dispatch_date, description, qty, unit, rate, amount}] — invoice-view and
  invoice-pdf.js read ONLY this, never re-join p2_dispatch_items/price tables at view time, so
  a later price change can never drift a PDF from the totals already emailed), amount_subtotal,
  amount_gst, amount_total, gst_type ('cgst_sgst' | 'igst' | 'none' — flat 18% split, not
  per-material gst_rate, deliberate simplification per GST Scope lock below), invoice_mode
  ('single' | 'consolidated'), date_from/date_to (consolidated only), dispatch_order_ids
  uuid[] (audit trail only — rendering never re-joins through it), invoice_token (public
  lookup key, unique index), status ('draft' until the email actually succeeds, then 'sent'),
  created_at. RLS: tenant_own only (tenant_id = auth.uid()) — deliberately NO public/anon
  SELECT policy; invoice-view reads via SB_SECRET_KEY service role, which bypasses RLS, so a
  public policy would only leak all tenants' invoices to anyone holding the anon key.
  Unique index on dispatch_order_id enforces one single-mode invoice per dispatch — NULL
  values (consolidated rows) are exempt since Postgres doesn't enforce uniqueness across NULLs.
  get_next_invoice_number(tenant_id) RPC — same row-locked-counter shape as get_next_grn_number,
  format INV-YYYYMM-NNN.

## Key Business Rules
- Stock balance = SUM of all p2_stock_transactions for that material — never store
  balance directly. v_p2_stock_balance is the view for this; it has NO is_active column —
  filter using context.materials (active-only) client-side, not on the view directly.
- On dispatch CONFIRM: reads BOM, inserts negative-qty consumption transactions,
  sets reference_id atomically with the dispatch order header.
- Challan header: 100% from p2_tenant_settings — zero hardcoded client details.
- Telegram alert when stock < min_stock_level after any deduction.
- CA Report: opening stock + GRN - consumption = closing stock (must reconcile).
  Uses p2_material_prices.price_per_unit (latest by effective_date) for valuation.
- Deleting raw materials orphans BOM foreign keys — update/deactivate, don't delete.
- Supabase SQL Editor runs as postgres role — DISABLE TRIGGER ALL before bulk
  inserts (set_tenant_id trigger overwrites tenant_id otherwise), re-enable after.

## Tenants
- Live client: S.S. Engineering, tenant_id 5ab7fb07-2557-42e7-8a8a-5d9fd59048ac,
  Founder tier. NEVER test writes or run experimental code against this tenant.
  agent_enabled = true (was incorrectly false — fixed Aug 8), agent_tier = 'standard'
  (30/day), plan = 'founder'.
- Demo account: 5f021c96-2ed4-41f8-9fbc-7db517fc840b, plan='pro', agent_enabled=false.
  Company: Nexflow Demo Factory — DO NOT change plan or enable agent.
- Test tenant: fe2b94fb-9668-405f-9c62-5f54b32f8c7a (arjunjadhav9@gmail.com,
  "Shree Ganesh Engineering Works") — fully populated with realistic data,
  safe to break, use for ALL development and agent testing.
  agent_tier = 'unlimited', plan = 'founder', agent_enabled = true — NEVER reset agent_tier.

## Language Toggle
- Static elements: data-en="..." / data-mr="..." attributes, applied once by
  applyLang() on DOMContentLoaded via shared js/lang.js (initLang() call per page).
- Dynamically rendered content (JS-injected rows, cards, etc.) CANNOT rely on
  applyLang() — it only runs once at load. Use the t(en, mr) helper inline in
  every render function instead, reading localStorage.getItem('nexflow_lang')
  fresh at render time.
- export.html is deliberately EXCLUDED from translation — Tally/Zoho column
  headers must stay in English (CA-facing field names).
- index.ts (Edge Function) has NO language toggle — every string is single hardcoded
  Hinglish. Bilingual support across all intents is a future pass, not per-intent.

## Pricing (August 2026)

Founder plan (clients 1-5 only):
- Year 1: ₹20,000 setup + ₹44,000/yr = ₹64,000 total
- Payment: ₹20K day 1 · ₹15K day 30 · ₹15K day 60 · ₹14K day 90 · 9 months free
- Monthly option: ₹20K setup + ₹6,500/month, 3-month minimum
- Agent: 30/day (permanent for this tier)
- Rate locked 2 years. After 2 years → standard Pro pricing.
- Agreement: Nexflow_Founder_Agreement_v5.1.docx

Standard Lite (client 6+):
- Year 1: ₹20,000 setup + ₹56,000/yr = ₹76,000 total
- Payment: ₹20K day 1 · ₹20K day 30 · ₹16K day 90 · 9 months free
- Monthly option: ₹20K setup + ₹6,500/month, 3-month minimum
- Features: GRN, dispatch, challan, invoice generation, CA export, 250 material limit, single user
- No agent access
- Agreement: Nexflow_Standard_Agreement_v1.2.docx

Standard Pro (client 6+):
- Year 1: ₹35,000 setup + ₹1,00,000/yr = ₹1,35,000 total
- Payment: ₹35K day 1 · ₹35K day 30 · ₹35K day 60 · ₹30K day 90 · 9 months free
- Monthly option: ₹35K setup + ₹11,500/month, 3-month minimum
- Features: everything in Lite + AI Copilot 50/day, multi-user, unlimited materials,
  owner visibility, QR scanner
- Agreement: Nexflow_Standard_Agreement_v1.2.docx

Demo account (5f021c96-2ed4-41f8-9fbc-7db517fc840b):
- plan = 'pro', agent_enabled = false
- Landing page demo — do not change plan or enable agent

### SS Engineering (client 1)
- Full Pro + agent — free, permanently. Never changes.

## Plan gating (added August 2026)

p2_tenant_settings.plan values and what they unlock:
- 'founder': full Pro access, agent 30/day (agent_tier='standard')
- 'pro': full Pro access, agent 50/day (agent_tier='standard', limit overridden by plan)
- 'lite': limited features, no agent, 250 material cap
- 'demo': Pro features visible, no agent

Agent daily limit logic (agent-query Edge Function):
- agent_tier = 'unlimited' → 999999 (test tenant only)
- plan = 'lite' → 0 (no agent)
- plan = 'demo' → 20
- plan = 'pro' → 50
- plan = 'founder' OR agent_tier = 'standard' → 30

isPro() — js/roles.js: returns true for plan IN ('pro', 'founder', 'demo')
isLite() — js/roles.js: returns true for plan = 'lite'
isFounder() — js/roles.js: returns true for plan = 'founder'
getPlan() — js/roles.js: returns raw plan string, default 'lite'
showUpgradePrompt(featureName) — js/roles.js: shows upgrade modal for Lite users

Pro-only features (Lite blocked):
- AI Copilot agent FAB
- invoices.html (full invoice management)
- scanner.html (QR scanner)
- Staff Members tab in settings.html (multi-user is Pro only)

Lite CAN access:
- GRN, dispatch, challan, stock dashboard, reports
- Invoice generation from dispatch history (Generate Invoice button)
- CA export via export.html
- Settings: materials, suppliers, clients, products

Lite limits:
- 250 active materials maximum — blocked at insert with upgrade prompt
- Single user — no staff invite

## AI Agent — Architecture

### Edge Function: agent-query
1. Deno.serve routes on body.action — plain message vs write actions
2. checkAndIncrementUsage() — atomic, row-locked, lazy daily reset, returns 429 on exceed
3. buildContext() — fetches materials (is_active=true, includes material_code), stockBalances,
   products (includes unit), suppliers (is_active=true), tenant settings (including challan_mode),
   all tenant-scoped via SB_SECRET_KEY
4. callHaiku() — extraction only. Returns intent + raw fields as typed by user. Never matches to DB rows.
5. Read-only intents → executeQuery() — direct DB queries, plain text answer, no confirm gate
6. send_challan → sendChallanIntent() — inline handler, no confirm card, returns result string directly
7. Write intents (parse phase) → match entities → build confirm card → return to widget
8. Write intents (confirm phase, body.action present) → confirm function → RPC call → fire-and-forget Telegram → log
9. logInteraction() — fire-and-forget at every exit point

### Write intent routing (body.action values)
- confirm_grn — single-material GRN
- confirm_multi_grn — multi-material GRN, calls confirm_agent_grn_multi RPC
- update_grn_rates — updates rate/invoice_no on p2_stock_transactions by transaction_id
- confirm_production_issue — BOM explosion issue
- add_production_issue_client — client info for production issue challan
- confirm_product_dispatch — product dispatch, BOM explosion
- confirm_rm_dispatch — raw material dispatch
- confirm_generate_invoice — dispatch-page "Generate Invoice" modal, always single-mode. Only
  `rate` is client-supplied per item; qty/unit/description always re-fetched server-side from
  p2_dispatch_items (never trust client-sent quantities for a billing amount).
- send_challan has NO body.action — handled inline in message router, no confirm card

### All intents live (33 total)
check_stock, create_grn, create_production_issue, create_product_dispatch, create_rm_dispatch,
send_challan, send_tally_export, send_invoice, recent_grn, consumption_summary, supplier_history, low_stock_list, grn_detail,
pending_dispatches, grn_summary, top_consumption, material_list, stock_check_product,
zero_stock_list, dispatch_summary, supplier_delivery_check, challan_detail, issue_summary,
product_code_lookup, top_received, product_list, supplier_list, dispatch_detail, issue_detail,
bom_detail, top_supplier

**Intentionally deferred (do not build yet):**
- stock_value — needs p2_material_prices populated; SS Engineering has 0 price records

### send_challan — critical implementation notes
- NO confirm card — executes and returns result immediately like a read intent
- NOT in READ_ONLY_INTENTS (Edge Function) — it's a write (sends email)
- NOT in READ_ONLY_TEXT_INTENTS (agent-chat.js) — same reason
- Haiku extracts: { challan_number: string, recipient_name?: string | null }
- recipient_name optional — if absent, uses order.client_name to match p2_clients
- p2_clients fetched inline in sendChallanIntent, NOT in buildContext() — pay-per-use
- Excel built server-side: import XLSX from 'https://esm.sh/xlsx-js-style@1.2.0?bundle'
  CRITICAL: must be DEFAULT import (import XLSX from ...), NOT (import * as XLSX from ...)
  — xlsx-js-style is CJS; import * silently returns undefined for named exports via esm.sh
- XLSX.write(wb, { type: 'base64', bookType: 'xlsx', cellStyles: true }) — cellStyles required
- challanDescription() resolves product name from p2_products for product dispatches
  (material_name is NULL at DB level for product dispatch items)
- CHALLAN_ORDER_COLUMNS const shared between exact-match and ilike queries
- Email: NO attachment — HTML body only with orange "View & verify this delivery online" link
- Link always included when dispatch_token not null (no plan gate — utility for all tenants)
- Body copy: "Delivery Challan X dated DD/MM/YYYY has been dispatched to you."
- escapeHtml() defined locally in sendChallanEmail()
- buildChallanWorkbook() still defined in file (uncalled — comment explains why, do not delete)
- reply_to set to tenantSettings.email only if truthy — omitted entirely if null
- Sending address: challans@nexflowautomations.in (verified on Resend)
- RESEND_API_KEY secret (not 'Nexflow-P2-API' — that's the old name, both exist, code uses RESEND_API_KEY)

### send_tally_export — critical implementation notes
- NO confirm card — executes and sends immediately, same pattern as send_challan
- NOT in READ_ONLY_INTENTS (Edge Function) — it's a write (sends email)
- NOT in READ_ONLY_TEXT_INTENTS (agent-chat.js) — same reason
- Haiku extracts: { date_from?: string (YYYY-MM-DD), date_to?: string (YYYY-MM-DD) } — both
  optional, absent means all-time. Bare month names ("July cha") and "last month" are resolved
  by Haiku itself into a full calendar range, "aaj"/"today" into a single-day range.
  This requires the systemPrompt to tell Haiku today's date (`Today's date (IST): ...`,
  computed via getISTDateRange(0).since.split('T')[0]) — there is no other date anchor
  available to the model, unlike the "days"-based read intents which resolve relative to
  real "now" in code, never via a calendar date the model has to compute itself.
- date_from/date_to are re-validated in sendTallyExportIntent with a YYYY-MM-DD regex before
  use — an unparseable value from Haiku is treated as absent, not passed to a Postgres filter.
  date_from alone means "from then to today"; date_to alone (no date_from) is dropped.
- ca_email/company_name/email fetched inline in sendTallyExportIntent, NOT in buildContext()
- Three separate p2_stock_transactions queries (grn / consumption / adjustment+notes='Opening Stock')
  joined to p2_raw_materials(name, material_code, hsn_sac, gst_rate, unit), each with optional
  .gte/.lte('transaction_date', ...) when a date range is resolved — combined client-side,
  sorted by transaction_date ascending, into one 17-column XLSX workbook (sheet "CA Export")
- GST computed on GRN rows only (cgst_rate = sgst_rate = gst_rate/2, igst blank) — same split
  logic as export.html's exportTallyTransactions(); consumption/opening-stock rows are GST-blank
  (blank cells are '' not 0, so Excel doesn't sum them as zero)
- Consumption quantity shown via Math.abs() — stored negative in p2_stock_transactions
- Workbook built with ExcelJS (import ExcelJS from 'https://esm.sh/exceljs@4.3.0', default
  import) — NOT the xlsx-js-style import send_challan uses (that one is uncalled/dormant here).
  Header row styled: bold white font, solid orange fill (FFFF5C1A), centered; header row frozen
  via worksheet.views = [{ state: 'frozen', ySplit: 1 }]. Numeric columns (Quantity, Rate,
  Amount, CGST/SGST/Total GST Amount, Invoice Total) hold real numbers with numFmt, not strings
  — so SUM formulas work in Excel/Sheets.
- Sent as a Resend attachment (unlike send_challan, which has no attachment) — filename varies:
  no range -> CA_Export_DDMMYYYY.xlsx; same-month range -> CA_Export_MonYYYY.xlsx; cross-month
  range -> CA_Export_DDMon_DDMonYYYY.xlsx
- encodeBase64(bytes: Uint8Array) chunks bytes before btoa() to avoid a stack overflow on a
  large workbook — local helper, not a new import (deliberately avoids adding a second remote
  host beyond esm.sh just for base64 encoding)
- Success message includes "Period: DD/MM/YYYY – DD/MM/YYYY" when a range was resolved
- reply_to set to tenantSettings.email only if truthy — same as send_challan

### send_invoice — critical implementation notes
- NO confirm card — executes and sends immediately, same pattern as send_challan/send_tally_export
- NOT in READ_ONLY_INTENTS (Edge Function) — it's a write (creates a p2_invoices row, sends email)
- NOT in READ_ONLY_TEXT_INTENTS (agent-chat.js) — same reason; needs its own else-if branch
- Haiku extracts: { client_name: string, challan_number?: string, date_from?: string (YYYY-MM-DD),
  date_to?: string (YYYY-MM-DD) }. Same "Today's date (IST)" system-prompt anchor as
  send_tally_export for resolving bare month names/"last month"/relative ranges.
- **Two modes**, selected in sendInvoiceIntent by which fields Haiku returned:
  1. date_from + date_to both present/valid → **consolidated** — every confirmed dispatch for
     that client across ALL dispatch_types within the range, merged into one invoice.
  2. Else challan_number present → **single**, that specific dispatch.
  3. Else → **single**, client's latest confirmed dispatch.
  Consolidated mode is agent-only — the dispatch-page UI modal (confirm_generate_invoice) is
  always single-mode, since it's tied to one confirmed dispatch on one page.
- date_from/date_to re-validated against TALLY_EXPORT_DATE_RE before use (reused from
  send_tally_export) — unparseable Haiku output is treated as absent, never hits Postgres.
- matchClientName() is now generic (`<T extends {name:string}>`) so both ClientRow (send_challan)
  and InvoiceClientRow (send_invoice — needs address/gstin too) can share it without a duplicate.
- p2_dispatch_orders has no client_id FK — client matching for "latest dispatch"/consolidated
  range queries is by exact client_name string equality, same convention already used in
  rm-dispatch.html/production-issue.html's own client queries.
- Rate resolution in the agent flow (buildInvoiceItemsForOrder): p2_product_prices for product
  dispatch items, p2_material_prices for raw_material/bom_issue items, both "latest by
  effective_date". **No price row found → rate 0, amount 0 — NEVER block or error.** Blocking a
  whole invoice (especially consolidated, covering several dispatches) over one unpriced material
  would make the feature useless for any client with even one unpriced item — the current state
  of SS Engineering. This zero-fallback is agent-flow only; the Step 4 UI modal shows an empty
  rate input instead and lets the owner fill it in before submitting.
- Duplicate check: single mode keys on dispatch_order_id (backed by a DB unique index);
  consolidated mode keys on exact tenant_id + date_from + date_to + client_id match (not an
  overlap check). Either hit → resendExistingInvoice() re-sends the existing invoice_token's
  link, no new insert, no invoice_sequence bump.
- Cross-mode double-billing guard (consolidated only): before creating a consolidated invoice,
  checks whether any matched dispatch already has a single-mode invoice against it. If so,
  blocks the WHOLE consolidated invoice (never silently drops just those dispatches) and names
  the offending challan numbers in the error message.
- p2_invoices.status starts unset (DB default 'draft') at insert time and is only flipped to
  'sent' via a follow-up UPDATE after the Resend call actually succeeds — never set 'sent' in
  the same insert as the email send, or a Resend failure leaves a row falsely marked delivered.
- sendInvoiceEmail() mirrors sendChallanEmail()'s shape (orange link button, reply_to only if
  tenantSettings.email is truthy) but points at /invoice?token=... instead of /receive.
- confirmGenerateInvoice (UI path) and sendInvoiceIntent (agent path) share buildInvoiceTotals()
  (flat 18% GST split) and createAndSendInvoice()'s insert+email tail, but do NOT share item
  resolution — the UI path trusts client-supplied rates (matched by dispatch_item_id, qty/unit/
  description always re-fetched server-side), the agent path resolves rates from price tables.

### Critical agent gotchas
- Adding new intent: MUST update BOTH READ_ONLY_INTENTS (Edge Function) AND
  READ_ONLY_TEXT_INTENTS (agent-chat.js) for read intents — missing either = silent blank response.
  Write intents go in NEITHER — routed via body.action (confirm-gated) or inline handler (send_challan).
- v_p2_stock_balance has NO is_active — filter via context.materials intersection.
- SB_SECRET_KEY (agent-query) ≠ SUPABASE_SERVICE_ROLE_KEY (check-low-stock functions).
- SUPABASE_ANON_KEY is a bare global from js/supabase-client.js — no window. prefix.
- CORS/OPTIONS 204 must have no body — new Response(null, {status: 204, headers}).
- p2_dispatch_orders.challan_number not challan_no.
- p2_dispatch_orders.status only: draft, confirmed, cancelled — no pending.
- p2_dispatch_orders.dispatch_type only: bom_issue, raw_material, product.
- p2_dispatch_orders has NO notes column — use challan_note or omit.
- p2_stock_transactions has NO unit column — unit lives only on p2_raw_materials.
- One sequence generator per counter — no client-side GRN number preview logic.
- challan_detail does exact match first, then suffix ilike fallback.
- dispatch_detail vs challan_detail: challan_detail = when/status, dispatch_detail = what's inside.
- confirm_grn write path logs message:'' — original logged at create_grn parse step.
- Chips fetch ALL materials (no .limit) — top 6 displayed, full list for search.
- create_product_dispatch and create_rm_dispatch: neither in READ_ONLY_INTENTS nor READ_ONLY_TEXT_INTENTS.
- send_tally_export: neither in READ_ONLY_INTENTS nor READ_ONLY_TEXT_INTENTS — write intent (sends
  email), same pattern as send_challan. Needs its own agent-chat.js else-if branch (not a generic
  fallback) or the result is silently swallowed — there is no catch-all in that if/else chain.
- send_invoice: same as above — neither in READ_ONLY_INTENTS nor READ_ONLY_TEXT_INTENTS, own
  agent-chat.js else-if branch required. confirm_generate_invoice (the UI-modal action) is a
  separate code path entirely — routed via body.action before the Haiku/message flow even runs.
- First message after cold start sometimes fails with "Failed to load raw materials" — known Deno cold start issue, not a code bug, second attempt always works.
- isPro() reads localStorage — can return stale plan value. Always read plan from DB-fetched settings object directly for gating logic.
- Test tenant agent_tier MUST stay 'unlimited' at all times. Never reset or change via
  migration or script. If any code touches p2_tenant_settings broadly, verify test tenant
  tier afterward: SELECT agent_tier FROM p2_tenant_settings WHERE tenant_id =
  'fe2b94fb-9668-405f-9c62-5f54b32f8c7a';
- agent_tier CHECK constraint: only 'standard', 'power', 'unlimited' — never use
  'founder' or any other value.
- plan field drives feature gating in UI; agent_tier drives legacy daily limit; new limit
  logic checks plan first, falls back to agent_tier.
- isPro() reads from localStorage nexflow_settings.plan — can be stale if settings
  changed without re-login. Always read plan from DB-fetched settings object on pages
  where plan accuracy matters.
- Lite clients: invoice generation from dispatch IS allowed; invoices.html IS NOT.
- 250 material limit: check count BEFORE insert, not after.
- purchase_type on p2_stock_transactions: default 'intrastate'; 'interstate' triggers
  IGST column in CA export instead of CGST/SGST.
- p2_invoices items JSONB now includes hsn_sac field (added Aug 7 2026) — old invoices
  have blank hsn_sac, this is expected, do not backfill.

### Proactive Telegram layer
- Daily briefing (check-low-stock): 8am IST via pg_net cron (jobid 2, 30 2 * * *)
  Sections: low stock, yesterday's GRNs (grouped by material), draft dispatches >2 days,
  no GRN in 3 days. Sends nothing if all clear. All bullets use • not -.
- Instant alert (check-low-stock-instant): fires after production issue, dispatch confirm,
  RM dispatch. Wired into production-issue.html, dispatch.html, rm-dispatch.html.
  Fire-and-forget, never blocks UI.

### Usage logging
- Table: p2_agent_logs (tenant_id, message, intent, extracted jsonb, match_status,
  success, error_reason, created_at)
- Logged at every exit point — fire-and-forget, swallows all errors.
- success=false when answer starts with "Couldn't" / "Could not" / "Please provide".

### Usage limits
| Tier | Daily limit |
|------|-------------|
| Standard | 30 |
| Power | 100 |
| Unlimited | 999999 |
Stored in p2_tenant_settings (agent_interactions_today, agent_reset_date, agent_tier).
Reset via: UPDATE p2_tenant_settings SET agent_interactions_today=0, agent_reset_date=CURRENT_DATE WHERE tenant_id='...';

## Tier 4 — Inter-company data exchange + QR codes (gate: 5+ paying clients)

### What's live (July 26, 2026)
- dispatch_token uuid NOT NULL DEFAULT gen_random_uuid() on p2_dispatch_orders
  Migration: 20260726_add_dispatch_token.sql, unique index p2_dispatch_orders_dispatch_token_idx
- receive-dispatch Edge Function: public (verify_jwt=false in config.toml), GET ?token=uuid,
  service role via SB_SECRET_KEY, UUID regex guard before DB query, returns {dispatch, supplier, items}
  Product dispatch items resolved via p2_products batched lookup (material_name is NULL at DB level)
  Guards: token not found / status != confirmed / missing → 404 {"error":"not_found"}
- receive.html: live at nexflowautomations.in/receive (pushed to git + Vercel)
  Public page, no navbar. Three states: valid token → full challan data; missing token → "Invalid link";
  bad/cancelled → "not valid or expired"
  Items table: MATERIAL | CODE | QTY | UNIT
  Download Challan (PDF) button — powered by js/challan-pdf.js (lazy-loads jsPDF + qrcodejs)
  Download Challan (Excel) button — powered by ExcelJS cdnjs 4.3.0
  Auth-aware: if logged in → "Auto-fill GRN" button shown — LIVE (Tier 4 Phase 2, shipped
  July 27; full flow under Shipped July 27, 2026 below). Shopkeeper role use case: store
  person logs in with shopkeeper role on phone, scans QR or opens link, confirms GRN one-tap.
- js/challan-pdf.js: browser-side jsPDF builder. Lazy-loads jsPDF + qrcodejs on first use.
  Powers receive.html PDF download only. NOT used in agent email flow. NOT loaded on challan.html.
- QR codes in challan.html: client-side, Pro/Founder gate via settings?.plan check
  (NOT isPro() — localStorage caches stale plan value)
  QR Code 1: top-right of meta block; QR Code 2: dashed cut-out below ch-outer
  NOT pushed to git yet — awaiting 5-client gate before deploying to production

### Architecture decisions (locked)
- Server-side PDF generation (jsPDF via esm.sh) — ABANDONED. 221ms CPU hits EarlyDrop
  even on Supabase Pro (400ms total budget). All PDF generation is client-side only.
- Supabase plan: Pro ($25/month) — upgraded July 26 for CPU headroom
- 20260527_dispatch_tables.sql is STALE — do not use as schema reference

## Client Invoice Generation (shipped July 30, 2026)
Proforma/billing invoice — "here's what you owe" — sent after a dispatch is confirmed. NOT a
GST tax invoice for filing (see GST Scope lock below); the flat 18% CGST+SGST/IGST split is a
deliberate simplification for that reason.

- **Schema**: p2_invoices table, plus bank_name/bank_account/bank_ifsc on p2_tenant_settings and
  gstin on p2_clients — see Database Tables section above for full column detail.
- **invoice-view Edge Function**: public (verify_jwt=false in config.toml), GET ?token=uuid,
  service role via SB_SECRET_KEY, UUID regex guard. Returns `{ invoice, tenant }` — no
  dispatch_items/price-table joins at all, since `invoice.items` is a frozen jsonb snapshot
  (see p2_invoices in Database Tables). This is deliberately simpler than receive-dispatch,
  which does need to resolve product names live.
- **invoice.html**: public page (root level, no navbar/auth), same three-state shape as
  receive.html (no token → "Invalid link"; 404 → "not valid or expired"; other failure →
  generic retry). PDF-only download (no Excel) — the codebase already has one too many
  Excel reimplementations of the challan layout per js/challan-pdf.js's own doc comment;
  not repeating that mistake for invoices.
- **js/invoice-pdf.js**: sibling to js/challan-pdf.js, NOT an extension of it (same reasoning:
  a fourth challan-layout reimplementation is explicitly discouraged, but an invoice is a
  different document anyway — rate/amount columns, GST rows, amount-in-words, bank details, no
  signature block, no QR). Duplicates challan-pdf.js's `loadPdfLibs`/`sanitize` primitives since
  there's no shared module system. `window.invoiceAmountInWords` is exported separately from
  `buildInvoicePdf` — it's synchronous with no jsPDF dependency, so invoice.html can call it
  immediately on render without triggering the lazy jsPDF load just to show the words line.
  Mode-aware item columns: single = Sr|Description|Qty|Unit|Rate|Amount; consolidated adds
  Challan No|Date columns — one column-config function, not two separate table layouts.
- **Dispatch-page UI**: "Generate Invoice" button + modal on ALL THREE dispatch pages —
  dispatch.html (product), rm-dispatch.html (raw_material), production-issue.html (bom_issue),
  not just dispatch.html — a job-work/contractor dispatch can also need billing. Plan-gated:
  `settings?.plan === 'pro' || settings?.plan === 'founder'`, fetched fresh into a module-level
  `tenantSettings` variable on page load (NEVER isPro() — stale localStorage). Modal rate
  pre-fill: p2_product_prices for product dispatch, p2_material_prices for raw_material/
  bom_issue, both "latest by effective_date" — blank (not zero) if no price row, since a human
  is reviewing this one before it goes out.
- **Agent side**: see "send_invoice — critical implementation notes" and
  "confirm_generate_invoice" above for the full write-path breakdown (two invoice modes,
  zero-fallback rates in the agent flow only, cross-mode double-billing guard, duplicate/resend
  handling, status flips to 'sent' only after the email actually succeeds).

## Rules for this session
- Direct, zero sugarcoating, brutal verdict on design/scope/pricing decisions.
- PowerShell: never use &&, separate git commands on their own lines.
- Never test writes against the live S.S. Engineering tenant — test tenant only.
- Badminton questions → answer as a professional coach.

## Shipped July 24, 2026
- export.html (Tally Transactions): 17-column GST layout with HSN/SAC, CGST/SGST/IGST rates and amounts, Invoice Total.
- challan.html: "⬇ Excel" button via ExcelJS (cdnjs 4.3.0).
- nexflow-design.css: orange vignette, stat card depth, nx-stat-red/nx-stat-green, warmer hover.
- admin-agent.html: test tenant excluded permanently via .neq().
- p2_agent_logs: cleared July 24 — fresh start.

## Shipped July 25, 2026
- Agent Tier 2 complete: create_production_issue, create_product_dispatch, create_rm_dispatch.
- confirm_dispatch_transaction RPC: writes notes = 'Dispatch: Challan {challan_number}' on stock transactions.
- Multi-material GRN: one GRN number per batch via confirm_agent_grn_multi RPC.
- p2_clients.email column (migration: 20260725_add_client_email.sql).
- Clients tab in settings.html with email field and "No email" badge.
- send_challan (Tier 3): emails HTML body with orange receive.html link. No attachment. No confirm card.

## Shipped July 26, 2026
- dispatch_token column on p2_dispatch_orders (migration: 20260726_add_dispatch_token.sql)
- receive-dispatch Edge Function (public, deployed)
- receive.html + js/challan-pdf.js (live on nexflowautomations.in)
- QR codes in challan.html — local only, not pushed

## Shipped July 27, 2026
- send_tally_export intent (Tier 3, agent): "CA la export pathav" emails the 17-column GST CA
  export (GRN + consumption + opening stock) as an XLSX attachment (ExcelJS, orange header,
  frozen row, real numeric cells) to ca_email via Resend. Optional date range — "July cha
  export", "1st te 27th July" — extracted by Haiku and applied to all three queries.
  Executes immediately, no confirm card — same shape as send_challan. Pulled forward from
  "intentionally deferred" — see send_tally_export critical implementation notes above.
- Auto-fill GRN on receive.html (Tier 4 Phase 2): logged-in recipient clicks "Auto-fill GRN"
  → duplicate check → pre-fill card with supplier/date/challan/items + Rate per item column
  + Invoice No field → inline warning if rate/invoice missing → confirm_receive_grn action
  in agent-query creates GRN in recipient's tenant. Material matching fuzzy — unmatched items
  reported. supplier_name always written from sender's company_name regardless of supplier_id
  match.
- challan.html print fix: entire challan including QR cut-out now fits one A4 page. Tighter
  row padding, reduced font in print CSS, "Powered by" footer hidden in print.
- grn.html material search fix: dropdown min-width 300px, names no longer truncated, material
  code badge now orange bg / white text, selected material name + code shown in info line
  below input after selection.

## Shipped July 30, 2026
- Client Invoice Generation — see the "Client Invoice Generation" section above for full detail.
  New: p2_invoices table + get_next_invoice_number RPC (migration:
  20260730_create_invoices_table.sql), bank_name/bank_account/bank_ifsc on p2_tenant_settings
  (migration: 20260730_add_invoice_bank_details.sql), gstin on p2_clients (migration:
  20260730_add_client_gstin.sql), invoice-view Edge Function, invoice.html, js/invoice-pdf.js,
  "Generate Invoice" button + modal on dispatch.html/rm-dispatch.html/production-issue.html,
  confirm_generate_invoice action + send_invoice agent intent (single + consolidated modes) in
  agent-query, matchClientName() made generic to share between send_challan and send_invoice.
- settings.html: Bank Name/Account No/IFSC fields on Company Details tab; GSTIN field on
  Clients tab (add form, list column, inline edit row).
- CLAUDE.md: documented p2_product_prices (was real but previously undocumented here).
- **Invoice print, invoices.html, and dispatch-history invoice status** (follow-up pass):
  - invoice.html: @media print block modeled on challan.html's (force white bg/black text
    since nexflow-design.css is dark-themed, print-color-adjust:exact to keep .nx-table
    thead's grey background, @page A4 10mm). "Print Invoice" button added next to "Download
    PDF" (both wrapped `.no-print`, hidden in the print block) — calls window.print()
    directly, no mobile-detection dance like challan.html's handlePrint().
  - invoices.html (new page, root level): lists all of a tenant's p2_invoices, Pro/Founder
    plan-gated (fresh `p2_tenant_settings.plan` fetch, never isPro()/localStorage — whole
    page content is gated, not just a button; Lite tenants see an upgrade notice instead of
    the table). Columns: Invoice No | Date | Client | Mode | Period | Amount | Status |
    Actions. "View / Print" opens invoice.html?token=... in a new tab. "Resend" POSTs
    `{action:'resend_invoice', invoice_id, tenant_id}` to agent-query. Added to
    js/navbar.js's NAV_LINKS, right after Dispatch.
  - agent-query: new `resend_invoice` body.action handler (`resendInvoiceAction()`) — looks
    up the p2_invoices row by id+tenant_id, resolves the client via `p2_invoices.client_id`
    (a real FK, simpler than confirm_generate_invoice's client_name string-match), and reuses
    the existing `resendExistingInvoice()` helper (previously only reachable from the Haiku
    message-path duplicate-invoice check) to send the email — no new email template code.
    Flips status to 'sent' unconditionally on success, same idempotent pattern
    confirm_generate_invoice uses. NOT in READ_ONLY_INTENTS (only relevant to Haiku-derived
    HaikuIntent, not body.action), NOT in agent-chat.js (UI-driven action, not a chat intent)
    — same reasoning as confirm_generate_invoice.
  - dispatch.html / rm-dispatch.html / production-issue.html: each dispatch-history loader
    (`loadRecentDispatches()` / `loadRecentIssues()`) now does one batched
    `p2_invoices` query per page load (`.in('dispatch_order_id', orderIds)`,
    `invoice_mode='single'`) instead of a per-row query, builds a
    `Map<dispatch_order_id, invoice>`, and swaps the row's action button: "View Invoice"
    (opens invoice.html?token=...) if an invoice already exists, else the existing
    "Generate Invoice" modal button (unchanged, Pro/Founder gated as before).
  - challan.html untouched — it has no dispatch-history table (single-challan print/view
    page only, driven by `?id=`); the history tables live on the three dispatch pages above.

## Shipped July 31, 2026
- all-dispatch-history.html invoice button relocated from list rows into the Detail modal.
  This page (unlike dispatch.html/rm-dispatch.html/production-issue.html, which each keep
  their own row-level invoice button per the July 30 entry above) has no separate detail
  page — clicking "Detail" opens an in-page modal (`#detailModal` / `openDetail()`), which
  is where the invoice affordance now lives instead.
  - Removed: `invoiceByOrder` batch `p2_invoices` query that used to run on every
    `loadHistory()` page load, plus the row-level invoice button. Actions column is back
    to Detail | Challan | Cancel.
  - Added: `#detailInvoiceSection` inside `#detailModal`, populated by
    `refreshDetailInvoiceSection(orderId)` — a per-dispatch, on-demand `p2_invoices` lookup
    that only fires when a user opens that dispatch's Detail modal (never on page load).
    Shows "View Invoice →" + invoice number/status if one exists; "Generate Invoice"
    (opens the existing rate/GST modal, unchanged internals) if Pro/Founder (`canInvoice`,
    fetched once at page load, reused here — never `isPro()`); nothing for Lite or for
    draft/cancelled dispatches.
  - `openDetail()` is now async. On successful invoice generation, the rate/GST modal's
    success handler calls `refreshDetailInvoiceSection()` directly instead of the old
    `loadHistory()` reload — the still-open Detail modal flips to "View Invoice →" in place.

## Shipped August 7, 2026
- CA Export & GST Reliability upgrade — full pitch for replacing in-house CA at MIDC factories:
  - p2_suppliers: gstin text column added
  - p2_products: hsn_sac text column added
  - p2_stock_transactions: purchase_type text NOT NULL DEFAULT 'intrastate' CHECK IN ('intrastate','interstate') added
  - settings.html: Supplier inline edit row built from scratch (name/mobile/address/gstin) — suppliers had no edit capability before
  - products.html: hsn_sac field added to Add form and Edit modal
  - grn.html: invoice_no now mandatory per-row with validation; per-row Intrastate/Interstate selector writing to purchase_type; Month-End GRN Reconciliation modal (role-gated owner/supervisor) — grouped by supplier, shows invoice numbers, red dash on missing, orange Unknown Supplier group
  - confirmReceiveGrn (Tier 4 auto-fill GRN): fixed invoice_no not being written to the column (was only buried in notes free-text)
  - agent-query sendTallyExportIntent: GRN sheet gets Supplier Name + Supplier GSTIN + Supplier Invoice No columns; purchase_type-aware GST math (IGST branch for interstate, CGST/SGST for intrastate); Invoice sheet gets Client GSTIN + B2B/B2C + Invoice Mode columns; new GST Summary sheet (Sheet 4) with ITC/output-tax/net-payable totals
  - export.html: Zoho Bills and Tally transactions updated for purchase_type — interstate rows get IGST tax names and blank Source of Supply
- confirm_bom_issue RPC v2: stock check now aggregates required qty per material_id across
  all BOM lines before checking balance — v1 checked each line independently and could pass
  when same material appeared in multiple BOM lines with combined qty exceeding stock. Fix
  uses GROUP BY material_id with SUM before the balance check.

## Shipped August 8, 2026
- CA export: consumption rows removed — CA only needs GRN purchases and invoices.
- grn_completeness agent intent: READ, added to both READ_ONLY_INTENTS and
  READ_ONLY_TEXT_INTENTS. Queries p2_stock_transactions for grn type, counts total
  vs missing invoice_no. Defaults to current month. IST timezone fix applied.
- invoice_total period label: IST timezone fix applied (was using machine timezone,
  wrong on Supabase edge runtime).
- invoice.html + invoice-pdf.js: per-item hsn_sac from items snapshot used for SAC CODE
  column, falls back to tenant sac_code.
- confirm_bom_issue v2: stock check aggregates by material_id GROUP BY before checking
  balance — fixes bug where same material in multiple BOM lines passed check individually
  but combined qty exceeded stock.
- onboarding.html: supplier GSTIN added to template and import, post-onboarding CA
  checklist added (fill supplier GSTIN, material HSN, material prices).
- Test tenant reset: clean data — 6 suppliers, 18 materials, 4 motor products with BOM,
  3 clients, opening stock, July+August GRNs all with invoice_no, Tata Steel = interstate.

## GST Scope — PERMANENTLY LOCKED
Nexflow P2 is operational software only. No GST filing, no GSTR generation, no financial reporting layer.
That is Tally's job. Never revisit this decision.