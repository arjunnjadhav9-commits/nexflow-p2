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
  email (used as reply_to for challan emails — tell owners to fill this in Settings)
- p2_raw_materials — raw material master (name, unit, min_stock_level, is_active, material_code)
- p2_suppliers — supplier master (is_active — CSV-imported suppliers default to
  is_active=false, invisible in dropdowns/matching unless checked)
- p2_stock_transactions — append-only log. transaction_type check constraint: ONLY
  'grn', 'consumption', 'adjustment' (lowercase, no other values allowed).
  Opening stock = type='adjustment', notes='Opening Stock' — not a separate type.
  reference_id links transactions to their originating dispatch/challan.
  Has rate column (what was paid on that specific GRN — NOT a standing cost rate).
- p2_products — finished goods, has product_code (unique index per tenant)
- p2_product_bom — recipe. Uses raw_material_id and qty_per_unit (not product_id-only or qty).
- p2_dispatch_orders — each dispatch = one challan. Has RPCs: confirm_bom_issue,
  cancel_challan, add_missing_challan_item, get_next_grn_number.
  dispatch_type values: bom_issue, raw_material, product.
  status values: draft, confirmed, cancelled — NO 'pending'.
  challan_number column (NOT challan_no). NO notes column — use challan_note if needed.
  dispatch_token column: uuid NOT NULL DEFAULT gen_random_uuid(), unique index — added July 26.
- p2_dispatch_items — line items in a dispatch. Columns: id, tenant_id, dispatch_order_id,
  material_name, material_code, qty_dispatched, unit, raw_material_id, product_id, notes, created_at.
  IMPORTANT: product dispatches have NULL material_name at DB level — product name must be
  resolved from p2_products via product_id in any code that displays dispatch items.
- p2_clients — client master. Columns: id, tenant_id, name, address, email, created_at,
  updated_at, po_number. NO is_active column. email added July 25 — used for send_challan.
- p2_material_prices — price history. Columns: id, tenant_id, raw_material_id, price_per_unit,
  effective_date, supplier_name, notes, created_at.
  Valuation rate = latest price_per_unit by effective_date (used in CA report, export).
  p2_stock_transactions.rate is NOT the valuation rate — it's the GRN-specific paid rate.

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
- Test tenant: fe2b94fb-9668-405f-9c62-5f54b32f8c7a (arjunjadhav9@gmail.com,
  "Shree Ganesh Engineering Works") — fully populated with realistic data,
  safe to break, use for ALL development and agent testing.
  agent_tier = 'unlimited' on test tenant (set deliberately — do not reset).

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

## Pricing (DO NOT expose in UI)
Revised July 25, 2026. All plans include AMC + retainer bundled — no separate support billing at current scale.

### P2 Lite
- Setup: ₹20,000 (one-time)
- Annual: ₹44,000/yr (includes AMC + retainer)
- Monthly billing: ₹20,000 setup + ₹5,500/mo (no lock-in, no AMC)
- Y1 total (annual): ₹64,000
- Includes: full web UI, GRN, dispatch, challans, CA export, Marathi toggle, up to 250 materials, single user
- Does NOT include: agent, challan email, QR exchange
- Agent add-on for Lite: +₹18,000/yr — 20 interactions/day, challan email via agent

### P2 Pro
- Setup: ₹35,000 (one-time)
- Annual: ₹80,000/yr = ₹6,667/mo (includes AMC + retainer)
- Monthly billing: ₹35,000 setup + ₹9,000/mo (no lock-in, no AMC)
- Y1 total (annual): ₹1,15,000
- Includes: everything in Lite + unlimited materials, multi-user, AI agent (30/day),
  challan email via agent, QR codes on challan + box (Tier 4, when shipped),
  /receive page for recipients, priority support

### Founder (clients 2–5 only)
- Setup: ₹20,000 (one-time)
- Annual: ₹44,000/yr, 2-year rate lock from signup
- Y1 total: ₹64,000
- All current Pro features + agent 30/day (permanent cap, no upgrade within founder pricing)
- QR exchange included when built
- AMC: 3 free calls/yr, ₹500/call after
- After 2 years: standard Pro pricing, 3 months notice
- Future add-ons NOT covered — priced separately
- Contract must state: founder pricing = current feature set only

### SS Engineering (client 1)
- Full Pro + agent — free, permanently. Never changes.

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
- send_challan has NO body.action — handled inline in message router, no confirm card

### All intents live (32 total)
check_stock, create_grn, create_production_issue, create_product_dispatch, create_rm_dispatch,
send_challan, send_tally_export, recent_grn, consumption_summary, supplier_history, low_stock_list, grn_detail,
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
- First message after cold start sometimes fails with "Failed to load raw materials" — known Deno cold start issue, not a code bug, second attempt always works.
- isPro() reads localStorage — can return stale plan value. Always read plan from DB-fetched settings object directly for gating logic.
- Test tenant agent_tier MUST stay 'unlimited' at all times. Never reset or change via
  migration or script. If any code touches p2_tenant_settings broadly, verify test tenant
  tier afterward: SELECT agent_tier FROM p2_tenant_settings WHERE tenant_id =
  'fe2b94fb-9668-405f-9c62-5f54b32f8c7a';

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

## GST Scope — PERMANENTLY LOCKED
Nexflow P2 is operational software only. No GST filing, no GSTR generation, no financial reporting layer.
That is Tally's job. Never revisit this decision.