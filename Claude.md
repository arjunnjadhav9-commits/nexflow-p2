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
- Email: Resend (send_challan live; CA export planned Tier 3 next)
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
- p2_dispatch_items — line items in a dispatch. Columns: id, tenant_id, dispatch_order_id,
  material_name, material_code, qty_dispatched, unit, raw_material_id, product_id, notes, created_at.
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
  Has "⬇ Excel" export via ExcelJS (cdnjs 4.3.0) — styled, bordered, merged cells.
- products.html — manage products + BOM
- grn-history.html — standalone GRN history page
- export.html — Tally/Zoho CSV export (UTF-8 BOM, per-vendor-per-date grouping)
- onboarding.html — internal 6-step tool, gated by owner UUID, for new tenant setup
- ca-report.html — CA audit report (?from=DATE&to=DATE)
- settings.html — tenant settings, logo upload, Agent tab (status, tier, usage, ca_email),
  Clients tab (Add/Edit/Delete clients with email field — owner-only for mutations)
- admin-agent.html — URL-only internal tool, gated by owner UUID
  (fe2b94fb-9668-405f-9c62-5f54b32f8c7a). Shows cross-tenant agent usage,
  intent breakdown, success rates, recent failures with actual message text.

## AI Agent — Architecture (locked, do not regress)

### Edge Function: supabase/functions/agent-query/index.ts
### Widget: js/agent-chat.js (floating drawer, FAB button)

### Locked architecture principles
- Haiku's ONLY job is extraction (intent + raw text fields) — it NEVER resolves
  database identity and NEVER authors the confirmation text shown to the user.
- All fuzzy-matching against p2_raw_materials / p2_suppliers / p2_products / p2_clients
  happens in code (matchMaterialName, matchSupplierName, findProductMatches,
  matchClientName), never by the model.
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
- matchClientName() — blocking three-way result: single match / no_match / ambiguous.
  Reuses findMatches<T extends {name:string}>. "No email" check is caller's job.
- CSV-imported suppliers default is_active=false — invisible to all matching.

### Date filtering — getISTDateRange(days)
All days-based queries use IST calendar-day boundaries, not rolling 24h windows.
- days=0 → today 00:00 IST to now (open, no upper bound)
- days=1 → yesterday 00:00 IST to today 00:00 IST (closed range)
- days>1 → N days ago 00:00 IST to now (open)
- Haiku extracts days:0 for "aaj/today", days:1 for "kal/yesterday" — never conflate.
- transaction_date is a date column — use .split('T')[0] on getISTDateRange output.
- confirmed_at / created_at are timestamptz — use ISO string directly.

### Live intents (31 total as of July 25, 2026)

**Write (confirm-gated):**
| Intent | Description |
|--------|-------------|
| create_grn | Record material receipt — multi-material, shared supplier |
| create_production_issue | Issue materials for production via BOM explosion — single product |
| create_product_dispatch | Dispatch finished products to client — multi-product, BOM stock check |
| create_rm_dispatch | Dispatch raw materials to client — multi-material, stock check |

**Write (no confirm card — executes immediately):**
| Intent | Description |
|--------|-------------|
| send_challan | Email confirmed challan as Excel to stored client email via Resend |

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
- send_tally_export — email CA export CSV to ca_email via Resend (gate: 2 weeks SS Engineering usage data)

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
- Description column uses material_code || material_name (material_code first)
- client_address split on '\n' for address rows — uses frozen order value, not live p2_clients.address
- reply_to set to tenantSettings.email only if truthy — omitted entirely if null
- Sending address: challans@nexflowautomations.in (verified on Resend)
- RESEND_API_KEY secret (not 'Nexflow-P2-API' — that's the old name, both exist, code uses RESEND_API_KEY)
- Known cosmetic issue: Row 3 address wrap (mobile/GSTIN) not expanding row height visually — deferred

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
- First message after cold start sometimes fails with "Failed to load raw materials" — known Deno cold start issue, not a code bug, second attempt always works.

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

## Shipped July 24, 2026
- export.html (Tally Transactions): 17-column GST layout — HSN/SAC, CGST Rate (%), CGST Amount, SGST Rate (%), SGST Amount, IGST Rate (%) (blank — intrastate), IGST Amount, Total GST Amount, Invoice Total. Join extended to `p2_raw_materials!inner(name, material_code, gst_rate, hsn_sac)`. GRN rows computed; consumption rows blank. Zoho exports unchanged.
- challan.html: "⬇ Excel" button via ExcelJS (cdnjs 4.3.0). Formatted challan with borders, bold headers, shaded header row, merged title rows, signature section. Reads DOM only — no new Supabase calls. Filename: `Challan_[no]_[date].xlsx`.
- nexflow-design.css: Radial orange vignette on body (grid lines removed), stat card box-shadow depth, `.nx-stat-red` / `.nx-stat-green` tinted backgrounds, warmer table hover, nav active glow, stat value text-shadow.
- admin-agent.html: Test tenant (`fe2b94fb`) excluded from all queries permanently via `.neq()`.
- p2_agent_logs: Cleared July 24 — fresh start for real SS Engineering owner usage.

## Shipped July 25, 2026
- Agent Tier 2 complete: create_production_issue, create_product_dispatch, create_rm_dispatch — all confirm-gated, re-validate at write time, mandatory client info card after dispatch confirms, all-or-nothing multi-item blocking.
- confirm_dispatch_transaction RPC: now writes notes = 'Dispatch: Challan {challan_number}' on p2_stock_transactions rows — reference column now populated for all dispatches (manual and agent).
- addDispatchConfirmCard: shared widget function for both dispatch types, mandatory client info card (no Skip), mirrors production issue confirm flow.
- Multi-material GRN via agent now shares ONE GRN number: confirm_agent_grn_multi RPC calls get_next_grn_number() once for the whole batch. New edge actions confirm_multi_grn and update_grn_rates; widget adds addMultiGrnConfirmCard + addGrnRateCard.
- p2_clients.email column added (migration: 20260725_add_client_email.sql).
- Clients tab in settings.html: Add/Edit/Delete clients with email field, Yellow "No email" badge. Owner-only mutations, list visible to all roles.
- SS Engineering onboarding visit: July 25. Owner shown agent for first time.
- Agent Tier 3: send_challan shipped July 25. Emails confirmed challan as styled Excel to stored client email via Resend. No confirm card. challans@nexflowautomations.in verified sending domain. Tested end-to-end — email delivered with correct attachment.

## GST Scope — PERMANENTLY LOCKED
Nexflow P2 is operational software only. No GST filing, no GSTR generation, no financial reporting layer. That is Tally's job. The CA export provides clean structured data for the CA to work with in Tally — that is the full extent of financial output. Never revisit this decision.