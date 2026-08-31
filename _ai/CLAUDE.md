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
- **CRITICAL: p2_tenants EXISTS and is load-bearing — 10 core tables have FK constraints
  pointing to it (p2_tenant_settings, p2_suppliers, p2_stock_transactions, p2_products,
  p2_product_bom, p2_dispatch_orders x2, p2_dispatch_items, p2_user_roles,
  p2_raw_materials). It is the FK anchor for the entire schema, not a settings store.
  For auth purposes, tenant_id = auth.uid() for owner-role users. tenant_id is NOT
  reliably read from user_metadata in all contexts — some RLS INSERT policies
  (e.g. p2_dispatch_orders) read tenant_id from JWT user_metadata, not auth.uid().
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
  is_job_worker boolean NOT NULL DEFAULT false — Step 2F onboarding switch.
  is_principal boolean NOT NULL DEFAULT false — Step 2F onboarding switch.
  is_job_work_setup_seen boolean NOT NULL DEFAULT false — Step 2I. Generic
  "⚙ Advanced settings" gate. True once the tenant has expanded the section.
  Prevents standalone tenants from seeing job-work UI (Type A guarantee).
  Also added: p2_clients gains is_job_work_principal boolean NOT NULL DEFAULT
  false and linked_tenant_id uuid nullable (Step 2I principal groundwork).
  owned_by on p2_stock_transactions and p2_dispatch_orders now has FK →
  p2_clients(id) (added Step 2I, was unconstrained in 2B).
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
  movement_purpose text NOT NULL DEFAULT 'sale' CHECK IN (10 values — see
  kpml-network-plan.md §8.2) — Step 2E.
  principal_tenant_id uuid nullable, FK → p2_tenants(id) — Step 2E.
  owned_by uuid nullable — whose material. NULL = mine.
  held_by uuid nullable — who physically holds it. NULL = me.
  FK → p2_clients(id) — added Step 2I.
- p2_products — finished goods, has product_code (unique index per tenant), hsn_sac text
  (added Aug 7 — HSN/SAC, optional, for CA export)
- p2_product_bom — recipe. Uses raw_material_id and qty_per_unit (not product_id-only or qty).
- p2_wip_transactions — append-only WIP ledger (Step 2G). Columns: id, tenant_id,
  product_id FK → p2_products(id), owned_by uuid nullable FK → p2_clients(id),
  quantity (+ open, − close), reference_id (bom_issue dispatch_order_id),
  transaction_date, notes, created_at. Balance = SUM — never stored directly.
  v_p2_wip_balance is the view.
- p2_dispatch_orders — each dispatch = one challan. Has RPCs: confirm_bom_issue,
  cancel_challan, add_missing_challan_item, get_next_grn_number.
  confirm_bom_issue (v2, Aug 7): server-side stock check aggregates required qty per
  material_id across all BOM lines (GROUP BY) before checking balance, using a FOR UPDATE
  subquery lock; raises INSUFFICIENT_STOCK: {material} — Need {x}, Available {y}.
  production-issue.html catches this and shows a clean toast.
  confirm_bom_issue (v3, Aug 25 2026 — Step 2H): now accepts p_owned_by uuid DEFAULT
  NULL. Sufficiency check uses IS NOT DISTINCT FROM p_owned_by (covers both NULL
  own-stock and non-null principal pool in one expression). Consumption rows and
  dispatch header both write owned_by = p_owned_by. Pool label in INSUFFICIENT_STOCK
  message resolved via scoped p2_clients lookup.
  dispatch_type values: bom_issue, raw_material, product.
  status values: draft, confirmed, cancelled — NO 'pending'.
  challan_number column (NOT challan_no). NO notes column — use challan_note if needed.
  dispatch_token column: uuid NOT NULL DEFAULT gen_random_uuid(), unique index — added July 26.
  movement_purpose text NOT NULL DEFAULT 'sale' CHECK IN (10 values — see
  kpml-network-plan.md §8.2) — Step 2E.
  principal_tenant_id uuid nullable, FK → p2_tenants(id) — Step 2E.
  s143_clock_start timestamptz nullable — set on job_work_issue and capital_goods_issue
  only — Step 2E.
  s143_clock_deadline timestamptz nullable — clock_start +1yr (inputs) / +3yr (capital
  goods) / NULL (exempt tooling, via is_exempt_tooling flag added Step 2K — no UI yet)
  — Step 2E.
  s143_extension_until timestamptz nullable — Commissioner extension field,
  write-only stub (Step 2K).
  is_exempt_tooling boolean NOT NULL DEFAULT false — exempt tooling flag, nulls
  the deadline (Step 2K). No UI yet.
  trg_s143_clock_population trigger: sets s143_clock_start and s143_clock_deadline
  on confirm transition for job_work_issue (+1yr) and capital_goods_issue (+3yr)
  only.
  owned_by uuid nullable — whose material this dispatch moves. NULL = own material.
  FK → p2_clients(id) — added Step 2I.
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
- p2_invoices — client billing tax invoice — legally formatted with SAC/HSN, GSTIN, CGST/SGST split, Original/Duplicate/Triplicate copies, Reverse Charge field. NOT a GST filing tool — invoice generation is in scope, GSTR-1/GSTR-3B submission is not. — see GST
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
- p2_payment_receipts — payment ledger against p2_invoices (Step 3, Aug 28 2026). Columns: id,
  tenant_id, invoice_id (FK → p2_invoices), payment_date, gross_amount, tds_amount,
  other_deductions, net_amount (GENERATED ALWAYS AS gross_amount - tds_amount -
  other_deductions, STORED — never include in INSERT payloads), payment_mode
  (neft/rtgs/cheque/upi/cash/adjustment), reference_no, notes, created_at. RLS: tenant_own
  (tenant_id = auth.uid()), same as p2_invoices. Obligations (the invoice) stay separate from
  receipts (each actual money movement) — payment status is derived by summing receipts, never
  stored on the invoice itself. v_p2_invoice_payment_status is the view (paid/partial/overdue/
  pending/not_applicable, 45-day hardcoded overdue threshold) — read server-side only
  (check-low-stock); never queried from the browser.
- p2_notifications — durable per-event notification record (Step 4, Aug 31 2026). Columns: id,
  tenant_id, type CHECK IN ('challan_dispatched','payment_overdue','low_stock'), title, body,
  metadata jsonb DEFAULT '{}', status CHECK IN ('queued','sent','failed') DEFAULT 'queued',
  error_reason, read_at, created_at. RLS: three command-scoped policies (SELECT/INSERT/UPDATE,
  no DELETE) on tenant_id = get_my_tenant_id() — deliberately NOT auth.uid() (that pattern is
  the known-broken one live on p2_payment_receipts, silently failing for non-owner staff).
  No auto-stamp trigger — tenant_id is always passed explicitly by the inserting caller
  (js/notifications.js client-side, or check-low-stock server-side), since a trigger deriving
  from get_my_tenant_id() would clobber a service-role insert's explicit tenant_id with NULL
  (no auth.uid() in that context). Indexes: (tenant_id, created_at DESC) and (tenant_id,
  read_at) WHERE read_at IS NULL (unread badge count). Realtime enabled via ALTER PUBLICATION
  supabase_realtime ADD TABLE p2_notifications — required for the navbar bell's live badge
  update. See "Shipped Aug 31, 2026" below for the full notify/telegram-webhook/bell pipeline.

## Key Business Rules
- Stock balance = SUM of all p2_stock_transactions for that material — never store
  balance directly. v_p2_stock_balance is the view for this; it has NO is_active column —
  filter using context.materials (active-only) client-side, not on the view directly.
  v_p2_stock_balance already filters owned_by IS NULL in its JOIN condition — it returns
  own-stock-only balances by construction. The view does NOT expose owned_by as an output
  column. Never add .is('owned_by', null) as a PostgREST filter on this view — the column
  does not exist in the view's output and will cause a 500 error. The ownership filter is
  baked into the view definition itself.
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
- Live clients — all three are job workers for KPML (Type B). KPML's material
  is physically present in all three factories right now with no correct ownership
  record. This is the core problem Step 2 solves.

- S.S. Engineering: tenant_id 5ab7fb07-2557-42e7-8a8a-5d9fd59048ac, Founder tier.
  Job worker for KPML (confirmed Aug 24 2026). NEVER test writes against this tenant.
  agent_enabled = true, agent_tier = 'standard' (30/day), plan = 'founder'.

- Datta Prasad Enterprises: tenant_id 3b68db90-a07c-491e-8913-c829ca969620,
  plan = 'founder', onboarded Aug 17 2026. Type B job worker for KPML under s.143.
  264 materials imported. 28 suppliers with GSTINs. 97 product price records loaded
  from KPML SAP PO rates — THESE ARE WRONG for invoicing. Correct job work charge
  rates needed from client before any invoice is generated.
  NEVER test writes against this tenant.
  Pro conversion agreed: ₹1,35,000 upfront (Standard Pro Year 1 — ₹35K setup +
  ₹1,00,000/yr), payment expected 10 Sep 2026. Guarantee: no cost increase for
  3 years after Year 1; all new features included at no extra cost. plan stays
  'founder' in DB until payment is confirmed — do NOT change plan value before
  payment is received. See Pricing section below for full agreement detail.

- Shivprasad Industries: tenant_id 6fe0680a-c53d-4e4f-b851-308ca905bb3c,
  plan = 'founder', onboarded Aug 19 2026. Type B job worker for KPML under s.143.
  Products, materials, prices not yet fully loaded.
  NEVER test writes against this tenant.

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

### Founder plan (clients 1–5 only)
- Year 1: ₹20,000 setup + ₹44,000/yr = ₹64,000 total
- Payment: ₹20K day 1 · ₹15K day 30 · ₹15K day 60 · ₹14K day 90 · 9 months free
- Monthly option: ₹20K setup + ₹6,500/month, 3-month minimum
- Agent: 30/day (permanent for this tier)
- Rate locked 2 years. After 2 years → standard Pro pricing.
- Agreement: Nexflow_Founder_Agreement_v5.1.docx

### Standard Lite (client 6+)
- Year 1: ₹20,000 setup + ₹56,000/yr = ₹76,000 total
- Payment: ₹20K day 1 · ₹20K day 30 · ₹16K day 90 · 9 months free
- Monthly option: ₹20K setup + ₹6,500/month, 3-month minimum
- Features: GRN, dispatch, challan, invoice generation, CA export,
  250 material limit, single user, no agent
- Agreement: Nexflow_Standard_Agreement_v1.2.docx

### Standard Pro (client 6+)
- Year 1: ₹35,000 setup + ₹1,00,000/yr = ₹1,35,000 total
- Payment: ₹35K day 1 · ₹35K day 30 · ₹35K day 60 · ₹30K day 90 · 9 months free
- Monthly option: ₹35K setup + ₹11,500/month, 3-month minimum
- Features: everything in Lite + AI Copilot 50/day, multi-user,
  unlimited materials, owner visibility, QR scanner
- Agreement: Nexflow_Standard_Agreement_v1.2.docx

### Principal account — KPML model (client 6+, network principals only)
- Setup: ₹1,25,000 – ₹1,50,000 (item-code mapping, vendor master,
  opening balances per vendor, agreement records)
- Platform fee: ₹2,50,000 – ₹3,00,000/year (dashboards, s.143 exposure,
  ITC-04 working paper, 43B(h) report, reconciliation, dispute register)
- Vendor overage: ₹5,000 – ₹7,000/vendor/year for every vendor
  beyond 20 shown in the principal account
- Pilot offer: 5 vendors, 90 days, ₹75,000 — fully credited against
  annual fee if they proceed. Deliverable via one-sided mode
  (no vendor onboarding required)
- Pricing anchor: one 43B(h) disallowance on ₹40L unpaid vendor bills
  ≈ ₹12L extra tax. One s.143 breach on a ₹10L challan ≈ ₹1.8L GST
  plus 18% interest from dispatch date. One month of manual
  reconciliation across three departments exceeds the monthly fee.
- Price on active principal-side links, never on a tenant-level flag —
  roles are per-relationship, not per-tenant

### Vendor network revenue model (how KPML multiplies revenue)
- Each KPML vendor is a separate Nexflow tenant paying their own
  Standard Pro subscription (₹1,00,000/year)
- Pro is mandatory for all KPML vendors — 250-material Lite cap is
  hit immediately by any serious job worker
- KPML mandates adoption; Nexflow does not need to sell to each vendor
  individually — KPML is the distribution channel
- Vendor value proposition independent of KPML: own stock tracking,
  own GST exports, own CA reports, own invoices, own 43B(h) receivable
  position — vendors pay because the software is valuable to them,
  not only because KPML requires it
- Revenue ceiling at 70+ vendors: ₹70L+/year in vendor subscriptions
  alone, plus ₹2.5–3L principal platform fee, plus vendor overages
- Compounding growth: as Nexflow makes KPML's reconciliation cleaner,
  KPML can manage more vendors with the same headcount — each new
  vendor is automatically a warm Nexflow prospect introduced by KPML

### SS Engineering (client 1)
- Full Pro + agent — free, permanently. Never changes.

### Datta Prasad Enterprises (client 2)
- Agreed: Standard Pro — ₹1,35,000 upfront
  (₹35K setup + ₹1,00,000 Year 1)
- Payment expected: 10 September 2026
- Guarantee: no price increase for 3 years
  after Year 1; all new features at no
  extra cost (non-Founder agreement variant)
- plan in DB: stays 'founder' until payment
  received, then update to 'pro'
- agent_tier: stays 'standard' (30/day —
  same as founder tier, no change needed)
- Agreement: Nexflow_Standard_Agreement_v1.2.docx
  (with 3-year price lock addendum —
  draft before 10 Sep)

### Demo account (5f021c96-2ed4-41f8-9fbc-7db517fc840b)
- plan = 'pro', agent_enabled = false
- Landing page demo — do not change plan or enable agent

## Plan gating (August 2026)

p2_tenant_settings.plan values:
- 'founder': clients 1-5, full Pro access, agent 30/day (agent_tier='standard')
- 'pro': client 6+ Pro, full Pro access, agent 50/day (agent_tier='standard', limit from plan)
- 'lite': client 6+ Lite, limited features, no agent, 250 material cap, single user
- 'demo': landing page demo, Pro features visible, no agent (agent_enabled=false)

Plan helper functions — all live in js/supabase-client.js (NOT js/roles.js):
- getPlan(): returns raw plan string from localStorage nexflow_plan, default 'lite'
- isPro(): returns true for plan IN ('pro', 'founder', 'demo')
- isLite(): returns true for plan = 'lite' only
- isFounder(): returns true for plan = 'founder' only
- showUpgradePrompt(featureName): orange modal overlay, WhatsApp CTA to +91 72489 32468

Agent daily limit — enforced server-side in check_and_increment_agent_usage RPC:
- agent_tier = 'unlimited' → 999999 (test tenant, wins over everything)
- plan = 'lite' → 0 (no agent access)
- plan = 'demo' → 20
- plan = 'pro' → 50
- plan = 'founder' → 30
- agent_tier = 'power' → 100
- agent_tier = 'standard' → 30 (fallback)

Pro-only features (Lite is blocked):
- AI Copilot agent FAB — silently hidden for Lite in js/agent-chat.js
- Agent tab in settings.html — hidden for Lite (no point configuring what they don't have)
- QR Scanner (scanner.html) — shows Pro gate panel, Scanner link stays in nav as upsell
- Staff Members tab in settings.html — hidden for Lite (single user plan)
- 250 material cap — blocked at insert with showUpgradePrompt()

Lite gets full access to:
- GRN, dispatch, challan, production issue
- invoices.html — full access including consolidated invoice (no gate)
- Invoice generation from dispatch history
- CA export via export.html
- Stock dashboard, reports
- Settings: company details, challan settings, telegram alerts, materials,
  suppliers, clients, products, stock adjustment, prices
- Scanner link visible in nav (shows Pro gate when clicked — intentional upsell)

Key decisions:
- Scanner nav link stays visible for Lite — clicking it shows the Pro gate,
  which is intentional upsell friction
- Agent tab in settings hidden for Lite — no config for a feature they don't have
- invoices.html fully open for Lite — consolidated invoice is not a meaningful
  differentiator, locking it away frustrates Lite clients
- showUpgradePrompt() never called on scanner.html or agent FAB — those use
  their own existing gate UI (scanner has inline panel, FAB just silently hides)
- showUpgradePrompt() IS called for: material cap at 250

invoice generation note:
- Lite clients generate invoices from all-dispatch-history.html (Generate Invoice button)
- Lite clients view/manage all invoices at invoices.html (full access)
- Agent-triggered invoice sending (send_invoice intent) requires Pro/Founder —
  agent is not available to Lite

## AI Agent — Architecture

**Agent redesign — COMPLETE (Aug 31 2026).** The chat agent (agent-query + agent-chat.js) was
converted from a mixed read/write system into a pure read-only supervisor. All 7 chat-reachable
write intents (create_grn, create_production_issue, create_product_dispatch, create_rm_dispatch,
send_challan, send_tally_export, send_invoice) and their 7 chat-exclusive body.action handlers
(confirm_grn, confirm_multi_grn, update_grn_rates, confirm_production_issue,
add_production_issue_client, confirm_product_dispatch, confirm_rm_dispatch) are gone —
matchEntities()/buildConfirmData() and every confirm-card function in agent-chat.js were deleted
along with them. The chat widget now only ever sends `{tenant_id, message}` and displays
`confirm.confirm_text` — no action branching, no confirm/cancel buttons.
check-low-stock-instant (the agent's fire-and-forget low-stock alert after a chat-driven write)
was deleted as a Supabase Edge Function once its three call sites went with the write intents —
see "Proactive Telegram layer" below.

### Edge Function: agent-query
1. Deno.serve first checks body.action — the 5 UI-only write handlers below route here; anything
   else falls through to the plain-message flow.
2. checkAndIncrementUsage() — atomic, row-locked, lazy daily reset, returns 429 on exceed
3. buildContext() — fetches materials (is_active=true, includes material_code), stockBalances,
   products (includes unit), suppliers (is_active=true), all tenant-scoped via SB_SECRET_KEY
4. callHaiku() — extraction only. Returns intent + raw fields as typed by user. Never matches to DB rows.
5. Every non-'unknown' intent → executeQuery() — direct DB queries, plain text answer, always
   `{status:'ok', intent, confirm:{status:'ready', confirm_text}}` — no confirm gate, nothing writes.
6. logInteraction() — fire-and-forget at every exit point

### body.action handlers — UI-only, NOT reachable from chat
These 5 exist purely because independent HTML pages POST straight to this Edge Function; the
Haiku/message flow above never touches them and agent-chat.js has no code path that sends an
`action` field.
- confirm_generate_invoice — all-dispatch-history.html "Generate Invoice" modal, single-mode only.
  Only `rate` is client-supplied per item; qty/unit/description always re-fetched server-side.
- resend_invoice — invoices.html "Resend" button, re-sends an existing invoice's email.
- confirm_consolidated_invoice / preview_consolidated_invoice — invoices.html "+ New Consolidated
  Invoice" modal (Step 1 preview, Step 2 confirm+generate).
- confirm_receive_grn — receive.html "Auto-fill GRN" (Tier 4 Phase 2), the one exception to
  trusting the caller's tenant_id — verified against a real JWT since the caller is a different
  tenant than the dispatch's sender.

### READ_ONLY_INTENTS — the single source of truth (28 total)
Lives only in agent-query/index.ts. agent-chat.js needs no copy — every intent is read-only, so
it just displays `confirm.confirm_text` unconditionally, no allow-list required there.

check_stock, recent_grn, consumption_summary, supplier_history, low_stock_list, grn_detail,
pending_dispatches, grn_summary, top_consumption, material_list, stock_check_product,
zero_stock_list, dispatch_summary, supplier_delivery_check, challan_detail, issue_summary,
product_code_lookup, top_received, product_list, supplier_list, dispatch_detail, issue_detail,
bom_detail, top_supplier, invoice_total, invoice_detail, grn_completeness, gstr2b_status

check_stock is the one intent that used to live outside this list (it went through the
create_grn-era matchEntities()/buildConfirmData() confirm-gate machinery purely to reuse material
matching) — migrated into executeQuery() during the redesign, same matchMaterialName() helper
recent_grn/consumption_summary already used.

top_consumption/top_received/top_supplier all default to top 10 (was 5), user-overridable via
Haiku's `top_n` field. supplier_history returns every matching GRN, no `.limit()` (was 5).

**Intentionally deferred (do not build yet):**
- stock_value — needs p2_material_prices populated; SS Engineering has 0 price records

### Critical agent gotchas
- Adding a new intent: add it to HaikuIntent, the system prompt, executeQuery(), and
  READ_ONLY_INTENTS — one list, all in agent-query/index.ts. agent-chat.js needs no copy since
  every intent is read-only and displayed the same way.
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
- Chips fetch ALL materials (no .limit) — top 6 displayed, full list for search.
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
- gstr2b-reconcile.html: not in navbar, not in js/roles.js ROLE_PERMISSIONS,
  not in js/navbar.js NAV_LINKS. Role and plan checked directly in page init().
- GSTR-2B JSON: parse b2b array only — ignore SUM, CDNR, IMPG sections entirely.
- GRN grouping: must GROUP BY (supplier_gstin + normalised invoice_no) before
  matching — one supplier invoice can span multiple GRN rows (multi-material batch).
- normaliseInvoiceNo: str.replace(/[\s\-\/]/g, '').toUpperCase() — apply to both
  sides before any comparison, never match on raw strings.
- Blocked ITC shows '—' not ₹0 when gst_rate is null on the material.
- check-low-stock mode branch: {"mode":"gstr2b_nudge"} must be checked BEFORE
  the existing digest logic — early return, existing logic unchanged.
- Cron jobid 3 uses anon key (not service role key) — confirmed by reading
  live cron.job table. current_setting('app.settings.service_role_key') is NOT
  configured in this project — never use it.
- challan.html PO column: showPoCol flag gates ALL changes (thead, tfoot colspan, row cells, Excel
  indices/merges) — if adding any new challan column in future, update both the static=false and
  showPoCol=true paths.
- challan.html downloadExcel(): the UNIT column value is read back out of the already-rendered
  on-screen `<td>` text (cells[...].textContent), not from item.unit/settings directly — e.g. the
  Stator/Stack label toggle (use_stator_stack_labels) works in the Excel export for free, but this
  is a fragile coupling with nothing enforcing it in code. Any future change to how the UNIT `<td>`
  is rendered in populateChallan() must be re-verified against the Excel export by hand.

### Proactive Telegram layer
- Daily briefing (check-low-stock): 8am IST via pg_net cron (jobid 2, 30 2 * * *)
  Sections: low stock, yesterday's GRNs (grouped by material), draft dispatches >2 days,
  no GRN in 3 days. Sends nothing if all clear. All bullets use • not -.
- Instant alert (check-low-stock-instant): DELETED (agent redesign, Aug 31 2026) — its only
  callers were confirm_production_issue/confirm_product_dispatch/confirm_rm_dispatch inside
  agent-query, all removed along with the chat write intents. The three HTML dispatch pages
  (dispatch.html, production-issue.html, rm-dispatch.html) were already migrated to
  p2_notifications in Step 4, so no functionality was lost — this just removed the last dead
  Supabase Edge Function pointing at the old flow. js/notifications.js still has two comments
  referencing it by name (describing the pattern it replaced) — harmless, not a live call.
- p2_notifications fan-out (Step 4, Aug 31 2026): single insert-then-fan-out pipeline —
  js/notifications.js's sendNotification() inserts a queued p2_notifications row, then
  fire-and-forget POSTs {notification_id} to the notify Edge Function, which delivers to
  Telegram (respecting quiet_hours_start/end) and flips status to sent/failed. Covers
  challan_dispatched (dispatch.html, production-issue.html, rm-dispatch.html — replacing
  check-low-stock-instant on those three pages only, see above) and low_stock
  (checkAndNotifyLowStock() helper) client-side; payment_overdue server-side via
  check-low-stock's payment_overdue_notify mode (jobid 8, daily 9am IST, dedup'd per
  invoice per 24h — distinct from and additive to the older payment_overdue_digest mode/
  message). In-app delivery: navbar bell (js/navbar.js) with unread badge + Realtime live
  update. Chat binding: telegram-webhook Edge Function handles /start <telegram_bind_token>
  deep links from settings.html's Connect Telegram flow. Full detail: "Shipped Aug 31, 2026".

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
  (Correction Aug 25 2026: button was only ever in all-dispatch-history.html Detail modal —
  never shipped on the three dispatch pages.)
- **Agent side**: see "send_invoice — critical implementation notes" and
  "confirm_generate_invoice" above for the full write-path breakdown (two invoice modes,
  zero-fallback rates in the agent flow only, cross-mode double-billing guard, duplicate/resend
  handling, status flips to 'sent' only after the email actually succeeds).

## Rules for this session
- p2_tenants confirmed to exist with 10 FK dependents — never write code assuming it does not exist.
- ALL THREE current clients (SS Engineering, Datta Prasad, Shivprasad) are Type B job workers for KPML. KPML owns all raw material throughout. This is confirmed job work under s.143, not purchase-and-sale.
- Vendor invoices on KPML must be job charges only under SAC 9988 — never full product value, never product HSN. Datta Prasad already uses SAC 998898 on all products correctly.
- Datta Prasad p2_product_prices has 97 records loaded from KPML SAP PO rates. These are KPML purchase rates, NOT Datta Prasad job work charges. Do not use these for invoice generation until correct rates are loaded.
- s.143(2) confirmed: accounting obligation lies with the principal (KPML), not the job worker. Do not pitch s.143 compliance to a job worker as their legal requirement.
- "Generate Invoice" button must be DISABLED (not hidden) on job-work-return dispatches once movement purpose lands. A wrong job work invoice is a GSTR-1 filing error.
- No live client has raised a Nexflow invoice on KPML as of Aug 24 2026. Zero exposure confirmed.
- Consolidated invoice (date range) confirmed working for Datta Prasad use case.
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

## Shipped August 12, 2026

### CA Export Phase 1 — Four improvements to exportTallyTransactions() in export.html
All four changes mirrored into sendTallyExportIntent() in agent-query/index.ts.

**Commits: 7e89229, 3e6f6d9, 74fb508, 165c457**

1. GST Summary title now shows actual date range:
   - export.html: `GST SUMMARY — ${fmtDDMMYYYY(from)} to ${fmtDDMMYYYY(to)}`
   - agent-query: same, with `effectiveFrom && effectiveTo ? ... : 'GST SUMMARY — All Time'` fallback

2. "Total ITC Claimable" renamed to "Input GST Recorded (Potential ITC)"
   - One string change in both files

3. Invoices sheet exploded from one-row-per-invoice to one-row-per-line-item (19 columns):
   - New columns: Invoice No | Invoice Date | Client | Client GSTIN | B2B / B2C |
     Place of Supply | Invoice Mode | Period From | Period To | Item Description |
     HSN/SAC | Qty | Unit | Rate | Taxable Amount | CGST (₹) | SGST (₹) | IGST (₹) | Item Total (₹)
   - Per-item GST proportional: (item.amount / inv.amount_subtotal) * inv.amount_gst
   - gst_type 'cgst_sgst' → CGST/SGST split; 'igst' → IGST; 'none' → all blank
   - Fallback for invoices with items === null or items.length === 0: one row per invoice
   - Running totals accumulated per item, not per invoice
   - Helper added: getPlaceOfSupply(gstin) — maps state code (first 2 chars of GSTIN)
     to state name. Map: 27→Maharashtra, 29→Karnataka, 06→Haryana, 07→Delhi,
     24→Gujarat, 33→Tamil Nadu, 36→Telangana, 32→Kerala, 19→West Bengal, 08→Rajasthan

4. Place of Supply column added to Sheet 1 (Purchases GRN) after Supplier GSTIN
   - Value: getPlaceOfSupply(row.p2_suppliers?.gstin)
   - Opening stock rows: blank

### CA Export Phase 2 — GSTR-2B Reconciliation

**Commits: 4937789, a80ae63, 36ceb93**

**New file: gstr2b-reconcile.html (root level)**
- Access: owner and accountant roles only (direct getUserRole() check, NOT canAccess())
- Plan gate: Pro and Founder only (fresh fetch from p2_tenant_settings.plan, never isPro())
- Not in navbar — reached only via link in export.html (CA/accounting tools stay together)
- No js/lang.js — English only, matching export.html precedent for CA-facing GST terms
- No new tables, no schema changes, no new Edge Functions
- All matching runs client-side — GSTR-2B JSON never sent to server

**How it works:**
1. Owner downloads GSTR-2B JSON from GST portal (available 14th of each month)
2. Uploads JSON to gstr2b-reconcile.html
3. Page parses b2b array only (ignores SUM, CDNR, IMPG sections)
4. Fetches GRN rows from p2_stock_transactions for the period in the JSON
5. Groups GRN rows by (supplier_gstin + normalised invoice_no) — multi-material
   batch GRNs under one invoice are summed before matching
6. Matches against JSON on normalised key: ctin + normaliseInvoiceNo(inum)
7. Shows four buckets, exports XLSX with 4 sheets

**Normalisation:** `str.replace(/[\s\-\/]/g, '').toUpperCase()`
**Amount tolerance:** ±₹2 (rounding differences don't trigger mismatch)
**GRN taxable value:** quantity * rate (no amount column on p2_stock_transactions)
**Blocked ITC estimate:** quantity * rate * gst_rate/100 — shows '—' if gst_rate is null

**Four buckets:**
- ✅ Matched — supplier GSTIN + normalised invoice_no found in JSON, taxable diff ≤ ₹2
- ⚠️ Amount Mismatch — keys match but taxable diff > ₹2
- ❌ ITC Blocked — in Nexflow GRN but not in JSON (supplier hasn't filed GSTR-1)
- ❓ Unrecorded — in JSON but no GRN in Nexflow (unrecorded purchase or fraudulent IMS auto-accept)

**cfs:N warning (shipped August 14, 2026):**
- `cfs` field is read from each supplier block (ctin level) in the b2b array and stored on
  every invoice entry in the match map
- Matched rows where `cfs === 'N'` get `cfs_warning: true` flag
- Matched table shows amber `⚠ Not Filed` badge (`.gstr-cfs-badge`) with tooltip on supplier
  name cell
- Matched stat card shows `#statMatchedCfsWarning` div when any matched row has cfs_warning
- XLSX Matched sheet has `CFS Warning` column — "Not Filed" or blank
- These rows stay in Matched bucket — do NOT move them to a separate bucket

**Error messages — all plain English, no generic errors:**
- Plan gate: "GSTR-2B Reconciliation is available on the Pro and Founder plan..."
- Role gate: "Only the owner or accountant can access this page."
- Invalid JSON: "This doesn't look like a valid GSTR-2B file. Download it from the GST portal under Returns → View GSTR-2B → Download JSON."
- GSTIN mismatch: non-blocking warning showing both GSTINs
- No GRN data: non-blocking notice, reconciliation still runs

**IMS auto-accept risk:** Unrecorded rows with ims_status === 'NO_ACTION' highlighted
red — these are auto-accepted by the portal via IMS and most urgent for CA to review.

**GSTR-2B JSON format (action=B2B):**
- ctin: supplier GSTIN (match against p2_suppliers.gstin)
- inum: invoice number (match against p2_stock_transactions.invoice_no)
- itcavl: Y/N — portal's ITC eligibility flag
- ims_status: A=Accepted, R=Rejected, P=Pending, NO_ACTION=auto-accepted
- itms[].txval: taxable value per line item
- itms[].iamt/camt/samt/csamt: IGST/CGST/SGST/Cess

**Agent intent: gstr2b_status**
- Added to HaikuIntent union, system prompt, executeQuery, READ_ONLY_INTENTS,
  READ_ONLY_TEXT_INTENTS (js/agent-chat.js)
- No DB query — returns nudge text pointing owner to export page
- Example triggers: "GSTR-2B madhe kiti match zale?", "Last reconciliation status?"

**Monthly Telegram nudge: cron jobid 3**
- Schedule: 30 2 15 * * (2:30 AM UTC = 8:00 AM IST, 15th of each month)
- Calls check-low-stock Edge Function with body {"mode":"gstr2b_nudge"}
- check-low-stock/index.ts branches early on mode === 'gstr2b_nudge' before
  existing digest logic — no new Edge Function file
- Sends to all tenants where agent_enabled = true AND telegram_chat_id is not null
- Migration: supabase/migrations/20260812_setup_cron_gstr2b_nudge.sql
  (uses anon key in Authorization header — same pattern as jobid 2)

**Why Phase 2 is urgent (not deferred):**
July 2026 regulatory change: GST 2.0 hard system-level matching — unmatched ITC
is auto-blocked, manual correction in GSTR-3B no longer possible. This is a
retention risk for existing clients, not a future growth feature.

**Pricing:** GSTR-2B reconciliation is Pro/Founder only — the feature that
justifies the ₹1L/year Pro pricing over Lite. One blocked ITC claim can cost
a factory ₹50K+ in working capital; the software pays for itself twice over.

**Phase 3 (deferred):** Draft P&L sheet — build only after Phase 2 is proven
with 5+ clients AND a CA explicitly requests it. Gate not met yet.

**Test JSON for gstr2b-reconcile.html:**
Saved locally as gstr2b-test-august-2026.json (not committed — contains test data only).
Tests: HCL-2608-001 (Matched), TSL-2608-012 (Amount Mismatch — txval 9600 vs 9450),
BEL-2608-041 (Matched, multi-row GRN), KFP-2608-099 (Unrecorded + NO_ACTION).

## Shipped Aug 17, 2026

**Bug scan P0 — security + data integrity:**
- agent-query: all confirm_* handlers now verify caller JWT + tenant_id match before executing (was trusting client-supplied tenant_id against service role client — full cross-tenant read/write hole)
- confirm-dispatch Edge Function: added JWT auth (was completely unauthenticated)
- confirm_dispatch_transaction RPC: EXECUTE revoked from authenticated, service_role only
- Stock deduction race: sufficiency check + deduction now in same locked RPC transaction
- importMaterials() / submitBulkImport(): root cause found — duplicate name within file spanning 50-row batch chunks caused batch 3+ to conflict with rows already committed by batch 1-2. Fix: deduplicate names in previewMaterials()/previewBulkData() before chunking. Additional fix: single-statement insert replaces batch loop (eliminates race entirely), double-invocation guard added, confirm() guard before delete, retry re-enables button on failure.
- dispatch.html / rm-dispatch.html: orphaned "confirmed" order fixed — status set to confirmed only AFTER RPC succeeds, not before. Double-submit guard added.
- grn.html: double-submit guard added — was creating duplicate GRN entries on double-click.

**Bug scan P1 — staff tenant resolution + feature correctness:**
- 7 files used raw user.id instead of user.user_metadata?.tenant_id || user.id — broke every non-owner staff role silently (export.html, reports.html, js/supabase-client.js, receive.html x2, js/agent-chat.js, index.html)
- export.html: missing role gate added (storekeeper/operator could download full GST export)
- createAndSendInvoice(): invoice now inserts as draft, flips to sent only after email succeeds
- confirmMultiGrn(): quantity validation added (was accepting zero/negative qty)
- dispatch.html showConsumptionModal(): double-subtraction bug fixed — was showing false low-stock warnings after every dispatch
- all-dispatch-history.html: request-token guard added to openDetail() + openInvoiceModal() — race could show/submit wrong order's invoice data

**Bug scan P2 — listener leaks, double-submit, silent errors, validation:**
- Window scroll/resize listener leaks fixed: grn.html, production-issue.html, dispatch.html, rm-dispatch.html (leaked on every row add/remove and every amend modal open)
- Double-submit guards: products.html BOM add, accept-invite.html password form, Cancel Challan across 4 history pages
- challan.html: note-edit failure now toasts instead of silent console.error
- gstr2b-reconcile.html: real error message surfaced instead of hardcoded generic string
- reports.html: overlapping-fetch guard added to Generate Report
- js/agent-chat.js addConfirmCard(): keeps card on transient network error (was discarding, forcing full retype + quota spend to retry)
- settings.html: submitBulkImport uses fresh tenantPlan not stale isPro(); deleteClient() blocks if invoices reference client; 6 mutations now filter by tenant_id explicitly
- invite-staff: role field whitelisted against known roles before DB insert
- agent-query confirmGenerateInvoice(): negative/non-finite rate now rejected
- New migrations (run manually): 20260817_invoice_consolidated_dedup_index.sql (partial unique index for consolidated invoice dedup), 20260817_enforce_material_cap_lite.sql (DB trigger backing 250-material Lite cap)

**Per-product PO number:**
- p2_products.default_po_number: TEXT nullable — standing PO per product, auto-fills dispatch
- p2_dispatch_items.po_number: TEXT nullable — actual PO used per line item, editable at dispatch time
- products.html: Default PO field in add/edit form, grey subtitle in product list when set
- dispatch.html: PO No. inline input per dispatch line item, pre-fills from product default, editable
- challan.html: PO No column rendered conditionally — only when ≥1 item has po_number set. SS Engineering challans completely unchanged. Excel export updated to match.
- Migration: 20260817_product_po_numbers.sql — run manually

**Product search on dispatch + production-issue:**
- dispatch.html: plain <select> replaced with searchable typeahead widget (mirrors rm-dispatch.html pattern)
- production-issue.html: same — product_code mapped into search badge slot so users can search by code

**Tax invoice scope clarification (CLAUDE.md correction):**
- p2_invoices generates legally-formatted tax invoices (SAC/HSN, GSTIN, CGST/SGST split, Original/Duplicate/Triplicate, Reverse Charge field) — NOT proforma
- Scope boundary: invoice generation is IN scope. GSTR-1/GSTR-3B submission is NOT (Tally's job)
- All marketing copy updated to say "Tax Invoice" not "Proforma Invoice"

**Onboarding tool fixes:**
- importMaterials() now uses single-statement insert (no batch loop), running-flag guard, confirm() before delete when materials exist, retry re-enables button on failure

**GSTR-2B Excel upload (gstr2b-reconcile.html):**
- Accepts .json OR .xlsx/.xls — same file input, format auto-detected by extension
- SheetJS (xlsx@0.18.5) added to page for Excel parsing
- parseGSTR2BExcel(): reads Sheet1, skips header rows by GSTIN validation,
  maps columns to same {b2b:[...]} shape as JSON path
- derivePeriodFromExcel(): derives period from min/max invoice dates in file
- Period display shows "Period: detected from file" for Excel (no specific month claimed)
- cfs always "Y" for Excel (portal only exports filed invoices)
- ims_status always "NO_ACTION" for Excel
- #excelFormatNote shown for Excel uploads explaining cfs/IMS limitations
- itcavl="No" rows land in Matched with ₹0 ITC (not Blocked) — same as JSON path
- Unrecorded rows show real Invoice Date from Excel column [4]
- runReconciliation(), renderTables(), downloadReport() untouched

**GSTR-2B Excel upload (gstr2b-reconcile.html):**
- Accepts .json OR .xlsx/.xls — same file input, format auto-detected by extension
- SheetJS (xlsx@0.18.5) added to page for Excel parsing
- parseGSTR2BExcel(): reads Sheet1, skips header rows by GSTIN validation (15-char check), maps columns [0]=GSTIN, [1]=name, [2]=invoice_no, [4]=date DD/MM/YYYY text, [8]=txval, [9]=igst, [10]=cgst, [11]=sgst, [15]=itcavl
- derivePeriodFromExcel(): derives period from min/max invoice dates — firstOfMonth/lastOfMonth spans full invoice date range
- Period display shows "Period: detected from file" for Excel — never claims a specific month
- cfs always "Y" for Excel (portal only exports filed invoices) — no amber Not Filed badge ever shown for Excel-sourced results
- ims_status always "NO_ACTION" for Excel
- #excelFormatNote shown for Excel uploads explaining cfs/IMS limitations
- itcavl="No" rows land in Matched with ₹0 ITC (not Blocked) — same as JSON path, intentional
- Unrecorded rows show real Invoice Date from Excel column [4]
- runReconciliation(), renderTables(), downloadReport() untouched
- Confirmed: GST portal exports column [4] as plain DD/MM/YYYY text string, not Excel date serial

**Product search on dispatch + production-issue:**
- dispatch.html: plain select replaced with searchable typeahead widget (mirrors rm-dispatch.html pattern — buildMatTypeahead factory + .mat-search-*/.mat-dropdown-* CSS classes)
- production-issue.html: same — product_code mapped into search badge slot so users can search by code
- Both pass JS syntax check

**Tax invoice scope clarification:**
- p2_invoices generates legally-formatted tax invoices (SAC/HSN, GSTIN, CGST/SGST split, Original/Duplicate/Triplicate, Reverse Charge field) — NOT proforma
- Scope boundary: invoice generation IN scope. GSTR-1/GSTR-3B submission NOT in scope (Tally's job)
- All marketing copy updated to say Tax Invoice not Proforma Invoice

**Onboarding tool fixes:**
- saveCompanyAndPlan() now upserts p2_tenants row before p2_tenant_settings — fixes FK violation for users who signed up before Aug 3 trigger fix
- importMaterials() rewritten: single-statement insert (no batch loop — eliminates constraint race), running-flag double-invocation guard, confirm() before delete when materials already exist, button re-enables on any failure path

**Per-product PO number:**
- p2_products.default_po_number: TEXT nullable — standing PO per product, auto-fills dispatch
- p2_dispatch_items.po_number: TEXT nullable — actual PO used per line item, editable at dispatch time
- products.html: Default PO field in add/edit form, grey subtitle in product list when set
- dispatch.html: PO No. inline input per dispatch line item, pre-fills from product default, editable
- challan.html: PO No column rendered conditionally — only when ≥1 item has po_number set. SS Engineering challans completely unchanged. Excel export column indices updated to match.
- Migration: 20260817_product_po_numbers.sql — run manually

**Datta Prasad Enterprises onboarding (tenant: 3b68db90-a07c-491e-8913-c829ca969620):**
- Materials: 264 rows imported via direct SQL (importMaterials() UI had batch-race bug — fixed after)
- Suppliers: 28 suppliers with GSTINs imported from GSTR-2B Excel via SQL
- Plan: Founder
- GSTIN: 27CVZPS9110H1ZS
- Note: their GSTR-2B is Excel format (portal download) — tested and working with new Excel upload feature

**cfs:N warning on GSTR-2B reconciliation:**
- Matched rows where supplier cfs === 'N' show amber ⚠ Not Filed badge (.gstr-cfs-badge)
- Matched stat card warns when any matched supplier has cfs_warning
- XLSX Matched sheet has CFS Warning column
- Rows stay in Matched bucket — never moved to Blocked

## Shipped Aug 19, 2026

**Challan print polish — challan.html + js/challan-pdf.js:**
- Tighter gap between "DELIVERY CHALLAN" heading and company block: new
  `.ch-title-band`/`.ch-company` padding (8px screen, 4px print), mirrored in
  js/challan-pdf.js as a smaller post-title `y` offset.
- Signature area (footer "For [company]" → the line above "Authorized
  Signatory") was too cramped to actually sign in print — the
  `#ch-signature-section [style*="margin-top:40px"]` print override raised
  from 10px to 20px; js/challan-pdf.js's `ruleY` bumped from `y + 22` to
  `y + 24` for parity (still inside the 34mm `SIG_HEIGHT` reserve).
- General one-page tightening: `#challan-content` print padding `5mm 8mm` →
  `4mm 6mm`, `.ch-meta-table td` print padding `4px 8px` → `3px 8px`. The PDF
  already paginates automatically on overflow, so no equivalent change was
  needed there.

**QR code toggle — challan.html + receive.html + js/challan-pdf.js:**
- challan.html: QR1 (the meta-block QR next to Challan No/Date/PO) is always
  shown once the tenant is Pro/Founder with a `dispatch_token` — unaffected
  by the toggle. Only QR2 (the "Cut and paste on delivery box" cut-out
  section) is hidden by default, revealed by a screen-only "Show QR"/"Hide
  QR" button (`no-print`). `renderQrSections()` still pre-builds both QR
  canvases up front; only QR2's reveal is gated behind `toggleQr()`.
- receive.html: had no QR anywhere before this — its only "print" surface is
  the downloaded PDF (js/challan-pdf.js), which previously hardcoded
  `dispatchToken: null, plan: null` specifically to never show a QR ("the
  visitor just scanned one to reach this page"). A new "Show QR" toggle
  overrides that: when on, `downloadPdf()` passes the real `dispatchToken`
  plus a new `forceShowQr: true`, which bypasses the sender's Pro/Founder
  plan check entirely in `buildChallanPdf()`
  (`showQr = (p.forceShowQr || isQrEligible(p.plan)) && !!p.dispatchToken`).
  Deliberate: the token is already public in receive.html's own URL, so
  gating this on the sender's plan would need a backend change for no real
  security benefit — the use case is a recipient wanting to forward the
  challan on with a verifiable link, independent of what plan the sender is on.

**PO NO column in the receive.html challan PDF — js/challan-pdf.js +
receive.html + supabase/functions/receive-dispatch:**
- js/challan-pdf.js's items table gained a PO NO column matching
  challan.html's own: SR NO | PO NO | DESCRIPTION | QUANTITY | UNIT. Same
  gate as challan.html's `showPoCol` — only appears when ≥1 item in the
  payload has a `po_number`; a dispatch with none renders byte-identical to
  before this column existed. Values render exactly as stored (`sanitize()`
  only, which is charset-safety for jsPDF's WinAnsi font — not formatting).
- `drawItemsHeader()` and the item-row/total-row drawing (previously
  hardcoded `M + COL_SR + COL_DESC + ...` offsets) were refactored to walk a
  running x-cursor over a `cols` object (`{SR, PO, DESC, QTY, UNIT,
  showPoCol}`) computed once per build, so header/rows/total agree on the
  same layout in both modes without duplicating the column math.
- `receive-dispatch` Edge Function didn't select or return `po_number` on
  `p2_dispatch_items` at all — added to both the `.select()` and the
  `resolvedItems` response shape. **Needs a manual redeploy**
  (`supabase functions deploy receive-dispatch`) — not done as part of this
  change, by request.
- receive.html's `downloadPdf()` now passes `po_number` through into the
  `buildChallanPdf()` payload alongside the existing description/qty/unit
  fields.
- Confirmed via search: no `formatPO()` function exists anywhere in the
  codebase — PO numbers already rendered as-is in challan.html before this
  change, nothing to remove there.

## Shipped Aug 25, 2026

### GSTR-1 Table 13 — Challan Register (export.html)
- New section on export.html, after existing CA Export
- Reads p2_dispatch_orders filtered by dispatch_date (NOT created_at) and tenant_id
- Working set: status IN ('confirmed', 'cancelled') only — drafts excluded
- Computes: challan_from (MIN of confirmed), challan_to (MAX of confirmed),
  total_issued (confirmed + cancelled), total_cancelled, net_issued
- Gap detection: walks integers between from and to, flags missing numbers in working set
- Challan numbers parsed via regex digit extraction — handles unified and split formats
- Numeric key = 0 or NaN excluded from range and gap logic entirely
- Orange warning box if gaps detected
- Download Excel: single sheet, orange header, one data row
- Access: owner, accountant, supervisor — all plans

### GSTR-1 Table 12 — HSN/SAC Summary (export.html)
- New section on export.html, immediately after Table 13
- Reads p2_invoices filtered by created_at (IST offset) and tenant_id
- Only status = 'sent' invoices — draft invoices never appear in GST summary
- Iterates items JSONB array per invoice, groups by hsn_sac × B2B/B2C
- B2B = client_gstin non-empty after trim; B2C = null or empty
- GST computed flat-rate per line item: igst = amount × 0.18,
  cgst = sgst = amount × 0.09 (matches how amount_gst is computed at invoice creation)
- Renders two stacked tables: B2B Supplies + B2C Supplies, each with totals row
- Missing hsn_sac grouped under "(Blank)" with a warning
- Download Excel: two sheets (B2B Supplies, B2C Supplies), orange header, real numeric cells
- Access: owner, accountant, supervisor — all plans (reuses TABLE13_ROLES const)

### p2_clients schema addition
- udyam_number text — Udyam registration number
- enterprise_class text CHECK IN ('micro', 'small', 'medium')
- registration_activity text CHECK IN ('manufacturing', 'trading', 'services')
- Added via ALTER TABLE in SQL editor (no migration file — added directly)
- Required for 43B(h) report (Step 3)

### Step 2G — WIP State
- New table p2_wip_transactions (append-only ledger, tenant_id, product_id, owned_by
  FK → p2_clients, quantity, reference_id, transaction_date, notes, created_at). RLS
  via get_my_tenant_id().
- New view v_p2_wip_balance: SUM(quantity) GROUP BY tenant_id, product_id, owned_by,
  HAVING <> 0 (fully-closed batches drop out).
- p2_dispatch_orders gains product_id uuid nullable FK → p2_products(id).
- confirm_bom_issue v4: adds p_product_id uuid DEFAULT NULL. Inserts WIP row when
  non-null. Stale 9-param overload from pre-2H dropped via DROP FUNCTION.
- New close_wip RPC: row-locks WIP balance, raises WIP_EXCEEDS_BALANCE if over-close
  attempted, inserts negative row.
- production-issue.html: WIP panel (product/pool/qty/close action), close modal,
  role-gated (owner/supervisor). p_product_id threaded through submitIssue().
- agent-query: p_product_id threaded through confirmProductionIssue().
- Out of scope: CA/Tally/GSTR exports, auto-close from dispatch, scrap attribution,
  agent WIP intent.

### Step 2J — Purpose selector on dispatch
- New file js/movement-purpose.js — single source of truth for 10 movement purpose
  values with ownershipChanges/custodyChanges flags. kpml-network-plan.md §8.2 rule 3.
- dispatch.html — Purpose selector in Client Information card, visible only when
  isJobWorker() or isPrincipal() = true. Writes movement_purpose to p2_dispatch_orders
  at insert time.
- rm-dispatch.html — same. Both saveDraft() and confirmDispatch() orderData objects
  updated (dual-payload fix).
- all-dispatch-history.html — Generate Invoice disabled (not hidden) when
  movement_purpose != 'sale'. Visible reason text shown. Correction: button was only
  ever in all-dispatch-history.html, not on dispatch.html/rm-dispatch.html as
  CLAUDE.md previously stated.
- SS Engineering: selector hidden, 'sale' always written at insert.

### Step 2K — s.143 Clock Population
- ADD COLUMN s143_extension_until timestamptz NULL to p2_dispatch_orders
  (write-only stub — no UI yet).
- ADD COLUMN is_exempt_tooling boolean NOT NULL DEFAULT false to
  p2_dispatch_orders (stub — no UI yet; when true, s143_clock_deadline is
  NULL regardless of purpose).
- New trigger trg_s143_clock_population (BEFORE INSERT OR UPDATE, FOR EACH
  ROW) via set_s143_clock() function. Fires only on transition into
  status = 'confirmed'. Sets s143_clock_start = COALESCE(dispatch_date, now())
  and s143_clock_deadline = clock_start + 1yr (job_work_issue) or + 3yrs
  (capital_goods_issue), NULL if is_exempt_tooling. All other purposes
  including rework_return leave clock columns untouched.
- No display surface in this step — data written, nothing shown yet.
- Known gap: capital_goods_issue always gets +3yr deadline until
  is_exempt_tooling gets a UI — false alarms on exempt tooling are harmless
  until a breach-detection surface reads these columns.

## Shipped Aug 26, 2026

### Step 2M — Pool-aware product dispatch
- confirm_dispatch_transaction RPC: added p_owned_by uuid DEFAULT NULL
  (5th param). Sufficiency check now uses IS NOT DISTINCT FROM p_owned_by.
  Consumption rows and dispatch header both write owned_by = p_owned_by.
  Pool label in INSUFFICIENT_STOCK message resolved via scoped p2_clients
  lookup. Stale 4-arg overload dropped via DROP FUNCTION before recreating
  (same overload hazard fix as Step 2G). GRANT EXECUTE restated after DROP.
  TODO: INSUFFICIENT_STOCK message shows mat_id not mat_name — fix when
  dispatch consumption JSON carries material_name.
- agent-query: confirmProductDispatch() now auto-derives pool via
  getJobWorkPrincipals() (reusing Step 2H helper), threads p_owned_by
  into RPC, re-validates owned_by at write time. Parse phase uses
  pool-aware stockMap when ownedBy != null. principal_name extraction
  added to create_product_dispatch Haiku block.
- js/agent-chat.js bug fixed: addDispatchConfirmCard and
  addProductionIssueConfirmCard were not forwarding owned_by from
  confirm_data to the confirm POST body. Both now include
  owned_by: confirmData.owned_by. This was silently breaking pool
  attribution for agent-driven production issues since Step 2H.
- dispatch.html / rm-dispatch.html UI changes deferred to Step 5.
- confirmRmDispatch() in agent-query does not pass p_owned_by —
  intentionally deferred to Step 5 alongside rm-dispatch.html UI.

## Shipped Aug 28, 2026

### Step 3 — Payment Ledger
- **Schema**: p2_payment_receipts table (migration: 20260828_payment_ledger.sql) — gross_amount,
  tds_amount, other_deductions, net_amount (GENERATED ALWAYS AS gross_amount - tds_amount -
  other_deductions, STORED — never sent in INSERT payloads), payment_date, payment_mode
  (neft/rtgs/cheque/upi/cash/adjustment), reference_no, notes. RLS: tenant_own (tenant_id =
  auth.uid()), same pattern as p2_invoices. Indexed on tenant_id and invoice_id. Obligations (the
  invoice) stay separate from receipts (each actual money movement) — TDS-aware, partial-payment
  safe.
- **v_p2_invoice_payment_status view**: derives payment_status (paid/partial/overdue/pending/
  not_applicable) from SUM(net_amount) vs amount_total, 45-day hardcoded overdue threshold on
  created_at — status is never stored, always derived. Read server-side only (check-low-stock);
  never queried from the browser — invoices.html/export.html derive the same CASE logic
  client-side from a batched p2_payment_receipts query instead.
- **invoices.html**: batched p2_payment_receipts query in loadInvoices() (Map<invoice_id,
  receipt[]>, no per-row queries). Payment status badge next to the existing status badge (green
  Paid / orange Partial / red Overdue / grey Pending), shown only when status='sent'. "Record
  Payment" button gated on status='sent' AND payment_status != 'paid' AND a fresh
  p2_tenant_settings.plan fetch (Pro/Founder only, never isPro()/localStorage) — this page has no
  page-wide plan gate today (removed for Lite access, see July 30 entry), so the gate is scoped
  to the new button/modal only. Per-row "▼ Receipts" expand toggle, built from scratch — no prior
  per-row-expand pattern existed in this codebase. #recordPaymentModal follows the existing
  .nx-modal-overlay/.nx-modal structure; live net-amount calculation; toast() newly used on this
  page (loaded via js/utils.js but previously unused here — existing alert() calls elsewhere in
  the file untouched).
- **export.html**: new "Section 43B(h) — MSME Payment Compliance" card after Table 12, gated by
  the existing TABLE13_ROLES (owner/accountant/supervisor, all plans — no plan gate, matching
  Table 12/13). Filters: enterprise_class IN (micro, small), registration_activity IN
  (manufacturing, services), udyam_number required — excludes Medium and trading registrations.
  Warning banner counts clients missing Udyam data across all sent invoices in the period, before
  the eligibility filter. Per-row due_date = invoice_date + 45 days (hardcoded — no
  agreement_days column exists); interest estimated at 3× RBI bank rate (6.5%, simple interest,
  not compounded); 31-March disallowance computed against the FY containing the selected month.
  Disclaimer covers both the simple-vs-compounded-interest gap (MSMED s.16 actually compounds
  monthly) and the 45-day-assumes-a-written-agreement gap (kpml-network-plan.md §10.4: 15 days
  without one). Client join uses a separate batched p2_clients query + Map, not a PostgREST
  embed — no precedent for embedding relationships in this codebase's client-side queries.
  Excel download mirrors downloadTable12Excel()'s shape (ExcelJS, orange header, sheet "43B(h)
  MSME Compliance", summary + disclaimer rows at the bottom).
- **check-low-stock/index.ts**: new payment_overdue_digest mode branch, checked before the
  existing gstr2b_nudge and main digest logic — same early-return pattern. Reads
  v_p2_invoice_payment_status server-side — the one place that view is meant to be read from.
  Skips tenants with no telegram_chat_id; skips tenants with zero overdue invoices (no message
  sent). Message caps at 5 invoices, "+N more" beyond that. No new cron entry, no new Edge
  Function file.
- Supplier advance ledger (p2_supplier_advances): scoped and deferred to Step 3.5,
  after Step 4. Datta Prasad confirmed need — lump-sum supplier prepayments drawn down
  by GRNs over time.

## Shipped Aug 31, 2026

### Step 4 — Notifications
Three types only: challan_dispatched, payment_overdue, low_stock. Runtime is Supabase Edge
Functions exclusively — no Vercel API routes, no Supabase-to-Vercel webhooks. Single fan-out
point, single message catalogue, per kpml-network-plan.md §9 Step 4.

- **Schema** (migration 20260831_notifications.sql): p2_notifications table — see Database
  Tables section above for full column/RLS/index detail. p2_tenant_settings gains
  telegram_bind_token uuid DEFAULT NULL (deep-link binding), quiet_hours_start smallint DEFAULT
  NULL, quiet_hours_end smallint DEFAULT NULL (IST hour 0-23, both NULL = disabled, the
  default). RLS deliberately uses get_my_tenant_id() instead of the spec's original
  tenant_id = auth.uid() — that literal pattern is the one already live (and known-broken for
  non-owner staff) on p2_payment_receipts; using it here would have silently blocked
  supervisor/storekeeper-triggered notifications, since Phase 5 fires after dispatch/BOM-issue
  confirms staff routinely perform.
- **notify Edge Function** (supabase/functions/notify/index.ts, verify_jwt=false, SB_SECRET_KEY):
  the single fan-out point. Takes {notification_id}, fetches the row, resolves
  telegram_chat_id + quiet_hours from p2_tenant_settings, checks quiet hours
  (midnight-wraparound aware: start<end → hour in [start,end); start>end → hour>=start OR
  hour<end; start===end or either null → disabled), sends plain text (title + '\n' + body, no
  parse_mode) via Telegram sendMessage, flips status to sent/failed with error_reason. Always
  returns HTTP 200 (except OPTIONS→204) — every caller is fire-and-forget and must never see a
  request "fail". Called only by js/notifications.js (after its own insert) and
  check-low-stock's payment_overdue_notify mode.
- **telegram-webhook Edge Function** (supabase/functions/telegram-webhook/index.ts,
  verify_jwt=false, SB_SECRET_KEY): receives Telegram's inbound Updates. Handles
  /start <bind_token> only — validates UUID format, looks up p2_tenant_settings WHERE
  telegram_bind_token = token, on match sets telegram_chat_id = chat_id::text and clears the
  bind token, replies with a connected confirmation naming company_name. Everything else
  ignored silently. Always returns 200 (Telegram retries on non-200). Webhook registration
  (setWebhook curl with TELEGRAM_BOT_TOKEN) is a manual step — Claude cannot read Edge Function
  secret values back (supabase secrets list only returns digests), so this must be run by hand.
- **js/notifications.js**: bare global functions (no ES modules anywhere in this codebase —
  matches js/movement-purpose.js's convention, not the spec's literal "named export" wording).
  sendNotification(supabase, type, title, body, metadata) resolves tenant_id client-side
  (user.user_metadata?.tenant_id || user.id, same as checkAuth()) and passes it explicitly on
  insert — no auto-stamp trigger, see p2_notifications schema note above — then fire-and-forget
  POSTs to notify with the bare SUPABASE_ANON_KEY (same pattern the three dispatch pages already
  used for check-low-stock-instant). checkAndNotifyLowStock(supabase, materialIds) replicates
  check-low-stock-instant's exact v_p2_stock_balance query/comparison and always re-queries
  fresh rather than trusting a page-local materials array (rm-dispatch.html's/
  production-issue.html's local stock state is stale at the point a dispatch/issue confirms).
- **Wired into dispatch.html, production-issue.html, rm-dispatch.html only** — the check-low-
  stock-instant fetch was removed from these three pages' confirm flows (dispatch.html's
  showConsumptionModal() low-stock check, plus a new sendNotification() call placed in
  handleSaveWorkflow() *before* resetWorkspaceForm() — the old fetch fired after the reset had
  already wiped clientName, which would have made challan_dispatched notifications silently
  lose client_name). agent-query's own three check-low-stock-instant call sites (lines 748, 922,
  1040, after confirm_grn/confirm_production_issue/confirm_rm_dispatch) were NOT touched — see
  Proactive Telegram layer note above. check-low-stock-instant itself was not deleted or
  modified in this step.
- **check-low-stock/index.ts**: new payment_overdue_notify mode branch, checked immediately
  before the existing gstr2b_nudge check (both before the main digest fallthrough). Distinct
  from and additive to the existing payment_overdue_digest mode (Aug 28) — that one sends a
  single combined Telegram-only digest message and writes nothing to p2_notifications; this one
  creates a durable, deduped p2_notifications row per overdue invoice (dedup key: type +
  tenant_id + metadata->>invoice_id + created_at within the last 24h) so overdue payments also
  show in the in-app bell. Uses amount_total from v_p2_invoice_payment_status (not balance_due —
  the two are numerically identical for payment_status='overdue' rows, since total_received is
  always 0 at that point). New cron jobid 8, 'payment-overdue-notify-daily', 0 4 * * * (9am
  IST), anon key in the Authorization header — same pattern confirmed live for jobid 2/3
  (check-low-stock has verify_jwt=false, so the header is never validated as a real JWT;
  SUPABASE_SERVICE_ROLE_KEY inside the function is what actually grants DB access). Migration:
  20260831_setup_cron_payment_overdue_notify.sql.
- **js/navbar.js**: notification bell + unread badge + anchored dropdown panel, added to
  .nx-right before .nx-user-badge. First use of Supabase Realtime (supabase.channel(...)) and
  first anchored-dropdown-popover component anywhere in this codebase — no prior pattern to
  extend, both built net-new (the only prior "panel" pattern was the mobile slide-in drawer,
  which this does not reuse). Channel 'notifications:' + tenantId, subscribes to INSERT on
  p2_notifications, only refreshes the badge count — never auto-opens the dropdown. Dropdown:
  10 most recent rows, type icon (🔔 challan / ⚠️ low_stock / 💰 payment_overdue), title, body
  truncated to 60 chars, relative time; opening it marks visible unread rows read; "Mark all
  read" button. Full-width panel below 480px. Requires ALTER PUBLICATION supabase_realtime ADD
  TABLE p2_notifications (migration 20260831_notifications_realtime.sql) for the live badge
  update — without it the bell still works fully, just not live until next page load.
- **settings.html**: #content-telegram panel replaced entirely. Old single telegram-chat-id
  text field + manual BotFather/userinfobot instructions removed. New: connection status
  (green/grey dot, Connect Telegram / Disconnect buttons), Connect generates
  crypto.randomUUID() as bind_token, upserts it to p2_tenant_settings, shows the
  t.me/nexflow_alerts_bot4?start={token} link, polls p2_tenant_settings every 3s for up to 2
  minutes until telegram_chat_id is set. Disconnect confirms then nulls both
  telegram_chat_id and telegram_bind_token. Quiet hours: enable checkbox + From/Until hour
  inputs (0-23), saved to quiet_hours_start/end. All new handlers resolve tenant_id via
  user.user_metadata?.tenant_id || user.id — the old handler upserted tenant_id: user.id
  directly (an owner-only assumption never caught before since only owners had used this tab).
  No telegram_bot_token field existed in the prior UI to remove — it was always a
  server-only Edge Function secret, never user-configurable.
- **Not built in this step** (explicitly out of scope per kpml-network-plan.md §9 Step 4):
  email notifications, push notifications, per-type notification preferences.

## GST Scope — PERMANENTLY LOCKED
Nexflow P2 generates tax invoices for client billing. It does NOT handle GST filing, GSTR
generation, or financial reporting. GSTR-1/GSTR-3B submission is Tally's job. Never revisit
this boundary.

Clarification (August 2026): CA-facing aggregation and export reports are IN scope — Table 12
HSN/SAC summary, Table 13 challan register, and GSTR-2B reconciliation are Excel extracts for
the owner/CA to use, never submitted by the app. What is permanently out of scope is performing
GST filing or submission on the client's behalf.

## Job Work Network Plan (August 2026)

Single source of truth: _ai/kpml-network-plan.md
Critique and reasoning: _ai/kpml-network-critique.md
Load these files alongside CLAUDE.md for any network feature work.

All three current clients are KPML job workers. KPML's material is in all three
factories today with no correct ownership record. Step 2 fixes this.

Build sequence:
- Step 0 — COMPLETE (Aug 24 2026)
- Step 1 — COMPLETE (Aug 25 2026): GSTR-1 Table 13 challan register + Table 12 HSN/SAC
  summary shipped to export.html. 43B(h) deferred to Step 3 — requires payment ledger first.
  Table 12 and Table 13 test data added to test tenant via SQL (Aug 25 2026).
  Udyam fields (udyam_number, enterprise_class, registration_activity) added to p2_clients.
- Step 2 — COMPLETE (Aug 26 2026)
           ✅ 2A confirm_bom_issue pool-aware (prerequisite only — not full pool-awareness)
           ✅ 2B owned_by + held_by columns (owned_by missing from p2_dispatch_orders — fixed Aug 25)
           ✅ 2C v_p2_stock_balance ownership-aware
           ✅ 2D all direct stock_transactions reads filtered
           ✅ 2E movement_purpose + principal_tenant_id + s143 clock columns
           ✅ 2F onboarding switches (is_job_worker, is_principal)
           ✅ 2I vendor-side onboarding UI + principal groundwork
           ✅ 2H pool-aware consumption
           ✅ 2G WIP state
           ✅ 2J purpose selector on dispatch
           ✅ 2K s.143 clock population
           ✅ 2M pool-aware product dispatch (backend only — UI deferred to Step 5)
           ✅ 2L Type A regression harness (build before 2H, run after each step)
  Reordering rationale: 2I precedes 2H (needs the principal list for auto-derive);
  2H precedes 2G (WIP attribution needs real pool data, or every WIP row is hollow);
  2J needs 2I's gating flags; 2K needs 2J's movement_purpose. 2L's harness is built
  first and re-run after each step, not treated as a single terminal gate.
  2L baseline snapshot: _ai/regression/snapshots/baseline-pre-2H.json
  — captured Aug 25 2026 before 2H lands. Run diff against this after
  every remaining Step 2 sub-step.
- Step 3 — payment ledger (receipts model, TDS)
- Step 4 — COMPLETE (Aug 31 2026): p2_notifications table, notify + telegram-webhook Edge
  Functions, js/notifications.js, in-app bell (js/navbar.js), Telegram deep-link binding +
  quiet hours (settings.html), payment_overdue_notify cron (jobid 8). check-low-stock-instant
  was retired separately, as part of the agent redesign (see "AI Agent — Architecture" above
  and "Proactive Telegram layer" note) — not part of Step 4 itself. See "Shipped
  Aug 31, 2026" for full detail. Deferred to post-Step-5: Notification Centre v2
  (notifications.html, Gmail-style, Telegram deep link) — see Backlog.
- Step 5 — principal-side one-sided mode (KPML pilot)
- Step 6 — cross-tenant upgrade + scoped access path
- Step 7 — gated on named requests only

Step 0 decisions locked:
- Job work confirmed for all three clients (not purchase-and-sale)
- p2_tenants exists and is load-bearing
- s.143(2) obligation is the principal's (KPML), not the job worker's
- SAC 9988 job charges only on vendor invoices to principal
- confirm_bom_issue pool-blind fix is Step 2 prerequisite #1
- Mother-factory pricing: UNDEFINED — settle before Step 5 design begins

Sales strategy:
- Pitch new clients (job workers) during Step 1 and Step 2
- Never stop selling while building
- Pitch to new job worker vendors: "Your principal will ask you for stock numbers,
  challan records and payment history. Today you cannot answer in less than a day.
  With this you answer in ten seconds and never get accused."

## Backlog — Deferred Features

### Step 3.5 — Supplier Advance Ledger
- Requested by: Datta Prasad Enterprises
- What: lump-sum advance payments to suppliers,
  drawn down by GRNs. Balance = advance paid
  minus sum of (qty × rate) on GRNs from that
  supplier in the same period.
- New table needed: p2_supplier_advances
  (tenant_id, supplier_id, payment_date,
  amount, reference_no, notes)
- UI: new tab or section, likely in
  suppliers area of settings.html
- Dependency: GRNs must have rate filled in
  for drawdown math to work — verify Datta
  Prasad's GRN data before building
- Build after Step 4 is complete

### Coil Winder Sub-contracting Flow
- Requested by: Datta Prasad Enterprises
- What: wire dispatched to external coil winder
  via inter_jobworker_transfer, finished coils
  received back via GRN, separate product
  variants (outsourced BOM) for motors where
  winding is outsourced vs in-house
- Current workaround: Option A — two separate
  product variants per motor model
  (in-house BOM uses wire, outsourced BOM
  uses finished coil)
- Not urgent — Datta Prasad has already
  dispatched wire for current batch,
  next review in ~1 month
- Build after Step 3.5
- KPML direct contact only after Step 2 is complete and demo exists on real vendor account

### Notification Centre v2
- What: replace the current navbar bell dropdown with a full
  notifications.html page (Gmail-style — filters, pagination,
  mark read/unread, search, all notification types)
- Navbar dropdown becomes a preview: latest 5 notifications +
  "View all" link to notifications.html
- Telegram messages get a link to notifications.html at the bottom
  of every message — one tap from Telegram lands on the full centre
- Telegram message format change: title\nbody\n\n🔔 View alerts:
  https://<app-url>/notifications.html (one-line change in notify
  Edge Function — trivial, deferred until the page exists)
- Build after Step 5 — current 3 notification types don't justify
  a full page yet; Step 5 adds principal-side events (s.143 clock
  warnings, vendor stock alerts) that will change that
- Dependency: notify Edge Function already built,
  p2_notifications table already exists — no schema changes needed