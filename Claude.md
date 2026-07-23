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
- Email: Resend (for future export/agent features)
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
  challan_mode, agent_tier, agent_interactions_today, agent_reset_date, ca_email, agent_enabled
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
  challan_number column (NOT challan_no).
- p2_dispatch_items — line items in a dispatch. Columns: id, tenant_id, dispatch_order_id,
  material_name, material_code, qty_dispatched, unit, raw_material_id, product_id, notes, created_at.
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

## Pricing (DO NOT expose in UI)
Current live tiers (July 2026) — verify against latest master doc before quoting:
- Lite: ₹64,000 Y1 / ₹44,000 renewal — full web UI, no agent
- Pro: ₹1,20,000 Y1 / ₹85,000 renewal — web UI + Agent (30 interactions/day)
- Founder tier (first 5 clients only): 2-year rate lock, contract wording scope
  not yet confirmed — do not assume it covers agent add-on pricing.
S.S. Engineering signed at ₹64,000/year (₹40,000 upfront + ₹24,000 at 6 months).
Agent add-on price: TBD after SS Engineering pilot data.
First 5 founders get agent free, 30/day cap — not a permanent entitlement.

## Pages
- index.html — dashboard (stock overview)
- grn.html — receive materials
- production-issue.html — production challan (BOM explosion, editable table,
  manual rows for non-stock items, Marathi toggle)
- rm-dispatch.html / rm-dispatch-history.html — raw material dispatch
- challan.html — printable delivery challan (?id=dispatch_order_id)
- products.html — manage products + BOM
- grn-history.html — standalone GRN history page
- export.html — Tally/Zoho CSV export (UTF-8 BOM, per-vendor-per-date grouping)
- onboarding.html — internal 6-step tool, gated by owner UUID, for new tenant setup
- ca-report.html — CA audit report (?from=DATE&to=DATE)
- settings.html — tenant settings, logo upload, Agent tab (status, tier, usage, ca_email)
- admin-agent.html — URL-only internal tool, gated by owner UUID
  (fe2b94fb-9668-405f-9c62-5f54b32f8c7a). Shows cross-tenant agent usage,
  intent breakdown, success rates, recent failures with actual message text.

## AI Agent — Architecture (locked, do not regress)

### Edge Function: supabase/functions/agent-query/index.ts
### Widget: js/agent-chat.js (floating drawer, FAB button)

### Locked architecture principles
- Haiku's ONLY job is extraction (intent + raw text fields) — it NEVER resolves
  database identity and NEVER authors the confirmation text shown to the user.
- All fuzzy-matching against p2_raw_materials / p2_suppliers / p2_products happens
  in code (matchMaterialName, matchSupplierName, findProductMatches), never by the model.
- confirm_data and confirmation messages are built server-side from fixed templates
  + real matched DB fields only — never from Haiku's free-text reply.
- Re-fetch and re-validate matched rows at confirm-time before executing any write.
- Confirm gate is non-negotiable on every write action. No chaining two writes.
- No delete/cancel/pricing changes via the agent, ever.
- Future send_document: recipient must match a tenant-level saved contacts list
  (Settings), never a free-text email extracted from chat.

### Identity matching
- matchMaterialName() — matches on name (substring both directions) first,
  falls back to material_code if no name match. Case-insensitive.
- findProductMatches() — matches on name OR product_code. Case-insensitive.
- matchSupplierName() — name only, substring both directions.
- CSV-imported suppliers default is_active=false — invisible to all matching.

### Date filtering — getISTDateRange(days)
All days-based queries use IST calendar-day boundaries, not rolling 24h windows.
- days=0 → today 00:00 IST to now (open, no upper bound)
- days=1 → yesterday 00:00 IST to today 00:00 IST (closed range)
- days>1 → N days ago 00:00 IST to now (open)
- Haiku extracts days:0 for "aaj/today", days:1 for "kal/yesterday" — never conflate.
- transaction_date is a date column — use .split('T')[0] on getISTDateRange output.
- confirmed_at / created_at are timestamptz — use ISO string directly.

### Live intents (25 total as of July 23, 2026)

**Write (confirm-gated):**
| Intent | Description |
|--------|-------------|
| create_grn | Record material receipt — multi-material, shared supplier |

**Read-only:**
| Intent | Example query |
|--------|--------------|
| check_stock | "MS Sheet kiti aahe?" |
| recent_grn | "Last week Hex Bolt cha GRN aala ka?" |
| consumption_summary | "This month Bearing kitna consume zala?" |
| supplier_history | "Tata Steel kadun last delivery keva aali?" |
| low_stock_list | "Kadhle materials low aahit?" |
| grn_detail | "GRN-202607-054 madhe kay hota?" |
| pending_dispatches | "Kadhle dispatch pending aahit?" |
| grn_summary | "Aaj kitne GRNs aale?" |
| top_consumption | "Kal sarvat jast konta material consume zala?" |
| material_list | "Kadhle materials aahit?" |
| stock_check_product | "KS4-0.8HP 5 banvayala enough stock aahe ka?" |
| zero_stock_list | "Konti materials out of stock aahit?" |
| dispatch_summary | "Aaj konti dispatch confirm zali?" |
| supplier_delivery_check | "Tata Steel kadun aaj aala ka?" |
| challan_detail | "Challan 1001 kevha zaala?" |
| issue_summary | "Kal issue kiti kele?" |
| product_code_lookup | "KS4-0.8HP cha product code?" |
| top_received | "Kal sarvat jast konty material che GRN aale?" |
| product_list | "Konti products aahit?" |
| supplier_list | "Konti suppliers aahit?" |
| dispatch_detail | "Challan 1001 madhe kay hota?" |
| issue_detail | "Issue challan 1001 madhe konti materials geli?" |
| bom_detail | "KS6-1.5HP cha BOM kay aahe?" |
| top_supplier | "This month sarvat jast konty supplier ne pathavle?" |

**Intentionally deferred (do not build yet):**
- stock_value — needs p2_material_prices populated; SS Engineering has 0 price records
- Tier 2 writes: production issue + RM dispatch via agent (wait 2+ weeks usage data)
- Tier 3: send_document — email challan/CSV (Resend API, after Tier 2)

### Critical agent gotchas
- Adding new intent: MUST update BOTH READ_ONLY_INTENTS (Edge Function) AND
  READ_ONLY_TEXT_INTENTS (agent-chat.js) — missing either = silent blank response.
- v_p2_stock_balance has NO is_active — filter via context.materials intersection.
- SB_SECRET_KEY (agent-query) ≠ SUPABASE_SERVICE_ROLE_KEY (check-low-stock functions).
- SUPABASE_ANON_KEY is a bare global from js/supabase-client.js — no window. prefix.
- CORS/OPTIONS 204 must have no body — new Response(null, {status: 204, headers}).
- p2_dispatch_orders.challan_number not challan_no.
- p2_dispatch_orders.status only: draft, confirmed, cancelled — no pending.
- p2_dispatch_orders.dispatch_type only: bom_issue, raw_material, product.
- p2_stock_transactions has NO unit column — unit lives only on p2_raw_materials.
- One sequence generator per counter — no client-side GRN number preview logic.
- challan_detail does exact match first, then suffix ilike fallback.
- dispatch_detail vs challan_detail: challan_detail = when/status, dispatch_detail = what's inside.
- confirm_grn write path logs message:'' — original logged at create_grn parse step.
- Chips fetch ALL materials (no .limit) — top 6 displayed, full list for search.

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

## Rules for this session
- Direct, zero sugarcoating, brutal verdict on design/scope/pricing decisions.
- PowerShell: never use &&, separate git commands on their own lines.
- Never test writes against the live S.S. Engineering tenant — test tenant only.
- Badminton questions → answer as a professional coach.