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
  aato_bracket text NOT NULL DEFAULT 'below_5cr' CHECK IN ('below_5cr', '5cr_to_10cr',
  'above_10cr') — added Sept 2 2026. Set on the Company Details tab in settings.html; drives
  a non-blocking amber e-invoicing-applicability banner in all-dispatch-history.html's
  Generate Invoice modal for 5cr_to_10cr/above_10cr. Never blocks generation.
- p2_raw_materials — raw material master (name, unit, min_stock_level, is_active, material_code,
  hsn_sac, gst_rate — both already existed, confirmed present here for reference)
  uqc text — added Session 3 (Sept 4 2026, migration 20260904_uqc_codes.sql). GSTN Unique
  Quantity Code (NOS/KGS/MTR/LTR/PCS/SQM/CBM/OTH), distinct from unit which stays free text
  for on-screen/challan display. Backfilled: KGS for kg/kgs, NOS for nos/pcs/pieces, MTR for
  mtr/mts, LTR for ltr/ltrs; anything else set to OTH (not left NULL — OTH means "checked,
  doesn't map cleanly", NULL means "never set"). Required for ITC-04 Table 4/5. UI: UQC
  dropdown in settings.html Raw Materials tab; warning banner shown when any material has
  uqc IS NULL.
  hsn_source text CHECK IN ('manual','imported','ai_verified','ai_corrected') — added Session 14
  (Sept 9 2026, migration 20260909_hsn_audit_source.sql). Nullable, no default, never
  backfilled — existing rows stay NULL. Written only by export.html's HSN Audit ('ai_verified'
  on Haiku-confirmed-correct rows) and, in a future session, settings.html on manual correction
  ('ai_corrected') — never by a trigger. See "Shipped Sept 9, 2026 — Session 14 (E3)".
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
  principal_challan_no text, principal_challan_date date — added Fix 1 (Sept 4 2026,
  migration 20260904_grn_principal_pool.sql). Set only on GRN rows attributed to a
  principal's pool via grn.html's Material Owner selector (gated behind isJobWorker()).
  NOT set anywhere else. scanner.html's independent GRN-confirm path (confirmGRN())
  is own-stock only by design — always writes owned_by: null explicitly, no Material
  Owner UI — a principal delivery must go through grn.html instead. If field use shows
  storekeepers commonly receive principal deliveries via the QR-scan flow, extending
  the same selector to scanner.html is a natural follow-up, not yet built.
- p2_products — finished goods, has product_code (unique index per tenant), hsn_sac text
  (added Aug 7 — HSN/SAC, optional, for CA export)
  uqc text — added Session 3 (Sept 4 2026, migration 20260904_uqc_codes.sql). Same GSTN
  UQC code and backfill logic as p2_raw_materials.uqc above. UI: UQC dropdown in
  products.html add/edit form; warning banner shown when any product has uqc IS NULL.
  hsn_source text CHECK IN ('manual','imported','ai_verified','ai_corrected') — added Session 14
  (Sept 9 2026, migration 20260909_hsn_audit_source.sql). Same shape/provenance rules as
  p2_raw_materials.hsn_source above.
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
  challan_number column (NOT challan_no). Fallback format changed Sept 9 2026 from
  CHAL-YYYYMMDD-NNNN (18 chars, over cap) to CH-YYMMDD-NNNN (14 chars). CHECK constraint
  chk_challan_number_length (length <= 16, NOT VALID) added same date.
  NO notes column — use challan_note if needed.
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
  asset_tag text, last_confirmed_at timestamptz, confirmed_by uuid REFERENCES auth.users(id)
  — added Session 3 (Sept 4 2026, migration 20260904_tooling_register.sql). Backs the
  Tooling Register: is_exempt_tooling = true dispatches have no s.143 return deadline, so
  these back a periodic-attestation surface instead of a clock. asset_tag is a free-text
  identifier for the physical die/jig/fixture; last_confirmed_at/confirmed_by are stamped
  by the "Confirm Still Here" action in all-dispatch-history.html (owner/supervisor only).
- p2_challan_links — new table (Session 3, Sept 4 2026, migration 20260904_parent_challan.sql).
  Links a return dispatch to one or more original outward challans — a return can settle
  several outward challans partially, so this is a link table with a quantity rather than a
  single FK on p2_dispatch_orders. Columns: id, tenant_id, return_dispatch_id FK →
  p2_dispatch_orders(id), original_dispatch_id FK → p2_dispatch_orders(id),
  quantity_settled numeric(12,3) CHECK > 0, notes text, created_at. CHECK
  no_self_link (return_dispatch_id != original_dispatch_id). RLS via get_my_tenant_id(),
  FOR ALL — no separate DELETE restriction. Indexes: (tenant_id, return_dispatch_id),
  (tenant_id, original_dispatch_id). Required for ITC-04 Table 5 columns 2–3 — without this
  link, return dispatches cannot be matched to their original outward challan. Written by
  dispatch.html's insertChallanLinks() only on a successful confirm of a RETURN_PURPOSES
  dispatch (job_work_return, unused_material_return, scrap_return); UI is the "Link to
  Original Challan" section on dispatch.html and the Detail modal on
  all-dispatch-history.html.
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
  invoice_date date NOT NULL, DEFAULT (now() AT TIME ZONE 'Asia/Kolkata')::date (added Sept 2
  2026) — a real column, not a created_at alias; invoice-view/index.ts returns it as its own
  field. round_off numeric NOT NULL DEFAULT 0 and doc_category text NOT NULL DEFAULT 'goods'
  CHECK IN ('goods','services') also added Sept 2 2026 — see Shipped Sept 2, 2026.
- p2_cancelled_challans — Rule 56(7) audit log for hard-deleted cancelled challans (added Sept 2
  2026). Columns: id, tenant_id, challan_number, movement_purpose text NULL (NULL means the row
  predates the movement_purpose migration and the original dispatch is gone — treat as
  "unknown", never default to a sale/job-work bucket), cancelled_at, created_at. RLS via
  get_my_tenant_id(), SELECT + INSERT only (no UPDATE/DELETE — immutable audit trail). Written
  from inside hard_delete_dispatch (SECURITY DEFINER), same transaction as the delete, only for
  status='cancelled' orders with a challan_number. Read by export.html's Table 13 and the
  GSTR-1 Workbook's doc sheet to keep cancelled-challan counts alive after the row they
  describe is gone.
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
- p2_supplier_advances — lump-sum advance payments to suppliers (Step 3.5, Sept 2 2026).
  Columns: id, tenant_id, supplier_id (FK → p2_suppliers), payment_date, amount, reference_no,
  notes, created_at. No DELETE policy — append-only financial record. RLS via get_my_tenant_id().
  v_p2_supplier_advance_balance is the view: pre-aggregated subqueries on both sides to avoid
  fan-out, explicit get_my_tenant_id() filter in every subquery (security_invoker = true alone
  was insufficient — RLS on p2_stock_transactions did not fire correctly inside the view context
  without explicit tenant scoping). owned_by IS NULL filter on GRN side excludes principal-owned
  material. Balance = total_advanced - total_drawn. Negative balance renders red in UI.
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
- p2_tenants — the FK anchor for the entire schema (see Supabase Config above for full detail).
  EXISTS and is load-bearing: 10 core tables carry FK constraints to it. RLS SELECT: USING
  (id = auth.uid() OR id = get_my_tenant_id()) — staff need to read their tenant row for FK
  validation and plan checks (see RLS Fixes below). DELETE/UPDATE remain owner-only via
  id = auth.uid() (intentional, not a staff-write gap). The earlier contradiction between
  CLAUDE.md and kpml-network-plan.md over whether this table exists is resolved in favour of
  EXISTS — never write code assuming it does not exist.
- p2_network_links — links a principal tenant to a vendor tenant (Session 9, Sept 8 2026).
  Columns: principal_tenant_id, vendor_tenant_id (both FK → p2_tenants(id)), status CHECK IN
  ('active','revoked') — never deleted, history preserved via status flip. UNIQUE
  (principal_tenant_id, vendor_tenant_id). RLS: tenant can SELECT rows where it is either side.
  INSERT is manual-only in this phase — no self-serve UI yet. No scope/consent/revocation-
  timestamp columns — the single enforcement point is get_principal_vendor_material() instead
  (SECURITY DEFINER, scope boundary written as a comment inside the function), see Session 9
  below.
- p2_filing_packages — one row per tenant per month for the automatic filing package (Session
  15, Sept 9 2026). Columns: id, tenant_id FK → p2_tenants(id), period_month text, status CHECK
  IN ('pending','generating','uploaded','emailed','failed'), storage_path, signed_url,
  signed_url_expires_at, error_reason, created_at, updated_at. RLS: three command-scoped
  policies (SELECT/INSERT/UPDATE, no DELETE) on tenant_id = get_my_tenant_id() — NOT
  auth.uid(). UNIQUE index on (tenant_id, period_month) — one package per tenant per month,
  upsert via onConflict: 'tenant_id,period_month'. See "Shipped Sept 9, 2026 — Session 15"
  below for the full pipeline.

## RLS Fixes — Sessions 1 and 2 (Sept 3–4 2026)

### set_tenant_id() trigger — CRITICAL FIX
The trigger function public.set_tenant_id() was using auth.uid() to set tenant_id
on INSERT. For staff users, auth.uid() = their own user ID, not the tenant ID.
Every staff INSERT across 10 tables was silently rejected by RLS.

Fixed: auth.uid() → get_my_tenant_id() in the trigger function body.
Affects: p2_dispatch_items, p2_dispatch_orders, p2_stock_transactions,
p2_suppliers, p2_tenant_settings, p2_user_roles, p2_raw_materials,
p2_product_bom, p2_products, p2_wip_transactions.

Applied directly in the SQL Editor via CREATE OR REPLACE FUNCTION
public.set_tenant_id() — no migration file for this one (named explicitly in the
Session 2&3 commit message; not captured as a .sql file, consistent with a few other
direct-DDL fixes in this project's history).

### Write policy fixes (auth.uid() → get_my_tenant_id())
All INSERT/UPDATE/DELETE policies across 13 tables were using auth.uid() in
WITH CHECK / USING clauses. This silently blocked all non-owner staff writes.
Fixed in migration 20260904_fix_staff_rls_write_policies.sql.

Tables fixed: p2_agent_logs, p2_client_po_numbers, p2_clients, p2_invoices,
p2_material_prices, p2_pending_invites, p2_product_bom, p2_product_prices,
p2_products, p2_raw_materials, p2_suppliers, p2_tenant_settings, p2_user_roles (INSERT only).

Deliberately excluded:
- p2_tenants: id = auth.uid() is correct (owner-only writes, id IS the tenant's own auth uid)
- p2_user_roles DELETE: tenant_id = auth.uid() AND user_id <> tenant_id is intentional
  owner-only staff removal — swapping to get_my_tenant_id() would let any staff member
  delete any other staff member.

### p2_user_roles SELECT policy — widened to tenant-wide read
Confirmed live: p2_user_roles_select_policy now uses get_my_tenant_id(), so any staff
member can read every role row for their own tenant, not just their own row. Three
redundant SELECT policies ("Users can read own role", "Users can view own role", "Users
can view tenant members") were dropped as part of the same cleanup — superseded by the
single p2_user_roles_select_policy. Required for the Tooling Register's "Confirmed By"
display (all-dispatch-history.html resolves confirmed_by uuids via a p2_user_roles
lookup, which needs to see rows belonging to staff other than the current viewer).

### RLS enablement
20260803_staff_rls_fix.sql created policies on 15 tables but never ran
ENABLE ROW LEVEL SECURITY. Fixed in 20260903_enable_rls_all_tables.sql.
p2_tenants was already correctly enabled with proper policies — excluded from this migration.

### p2_stock_transactions FK constraints dropped
p2_stock_transactions_tenant_id_fkey and p2_stock_transactions_principal_tenant_id_fkey
were both referencing p2_tenants directly. After RLS was enabled on p2_tenants,
staff users could not insert GRNs — the FK check ran outside RLS context and failed.
Both constraints dropped. RLS on p2_stock_transactions already enforces tenant isolation.

### p2_tenants SELECT policy updated
Staff users need to read their tenant row for FK validation and plan checks.
Policy updated: USING (id = auth.uid() OR id = get_my_tenant_id())

### View RLS fixes (Session 1, Sept 3 2026)
v_p2_wip_balance: recreated WITH (security_invoker = true) + explicit
  WHERE tenant_id = get_my_tenant_id() — browser-only consumer (production-issue.html).
v_p2_invoice_payment_status: recreated WITH (security_invoker = true) +
  REVOKE SELECT FROM anon, authenticated — service-role-only consumer
  (check-low-stock). Browser access blocked entirely.
  No explicit tenant filter — service role calls it cross-tenant per tenant loop.
v_p2_supplier_advance_balance: already fixed Sept 2 2026 (security_invoker = true +
  explicit get_my_tenant_id() in every subquery).

## Key Business Rules
- Stock balance = SUM of all p2_stock_transactions for that material — never store
  balance directly. v_p2_stock_balance is the view for this; it has NO is_active column —
  filter using context.materials (active-only) client-side, not on the view directly.
  v_p2_stock_balance already filters owned_by IS NULL in its JOIN condition — it returns
  own-stock-only balances by construction. The view does NOT expose owned_by as an output
  column. Never add .is('owned_by', null) as a PostgREST filter on this view — the column
  does not exist in the view's output and will cause a 500 error. The ownership filter is
  baked into the view definition itself.
- v_p2_stock_balance_by_owner — new view (Session 4, Sept 4 2026, migration
  20260904_stock_balance_by_owner.sql). Sibling to v_p2_stock_balance above, built to
  expose the dimension that view deliberately hides. WITH (security_invoker = true) plus an
  explicit WHERE tenant_id = get_my_tenant_id(). Groups p2_stock_transactions by
  (tenant_id, raw_material_id, owned_by), LEFT JOINs p2_clients for owner_name (NULL
  owned_by = own stock, no join needed), includes material_name, material_code, unit, uqc,
  min_stock_level, current_stock. HAVING SUM(quantity) != 0 — zero-balance rows excluded.
  Depends on p2_raw_materials.uqc (20260904_uqc_codes.sql) already existing. Powers
  index.html's pool tabs (All / Own Stock / [Principal]), gated behind isJobWorker().
  v_p2_stock_balance itself is untouched — every existing consumer is unaffected.
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
  payment is received.
  Payment expected 10 Sep 2026. On confirmation: UPDATE p2_tenant_settings SET
  plan = 'pro' WHERE tenant_id = '3b68db90-a07c-491e-8913-c829ca969620';
  agent_tier stays 'standard' — do not touch it.
  See Pricing section below for full agreement detail.
  NOTE: flip plan = 'pro' immediately on payment confirmation. agent_tier stays 'standard'.

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
- Static elements: data-en/data-mr attributes, applied by each page's own applyLang() on
  DOMContentLoaded. js/lang.js EXISTS in the repo but is DEAD — loaded by no page, uses ES
  export syntax incompatible with classic script tags. [VERIFIED — tutorial-engine.md §4.11 +
  codebase-audit.md §5.2]. Do not build against it. The nexflow:langchange event specified in
  tutorial-engine.md §4.11 is the correct hook.
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

KPML Principal pricing [DECIDED Sept 11 2026]:
- Platform fee: ₹2,50,000-3,00,000/year (includes up to 20 vendors)
- Pilot fee: ₹75,000 one-time (credited against year 1 platform fee)
- Overage: ₹5,000-6,000/vendor/year for every vendor beyond 20
- At 30 vendors: ₹2,75,000 platform + 10 × ₹5,500 = ₹3,30,000/year total
- At 50 vendors: ₹2,75,000 + 30 × ₹5,500 = ₹4,40,000/year total
- Model: overage-only beyond 20, NOT sponsored seats. kpml-network-plan.md §12's
  sponsored-seat model is superseded by this decision.

- Deliverable via one-sided mode (no vendor onboarding required)
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
These 6 exist purely because independent HTML pages POST straight to this Edge Function; the
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
- suggest_hsn — export.html "HSN Audit" (E3, Session 14). Read + Haiku classification, not a
  write. Does NOT call checkAndIncrementUsage — deliberately outside the daily agent quota. See
  "Shipped Sept 9, 2026 — Session 14 (E3)".

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
- send_challan, send_invoice, send_tally_export — planned Pro-only features, not yet restored.
  Gate behind plan === 'pro' || plan === 'founder' when restoring.

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
- Today's IST date: always call todayIST() (agent-query/index.ts, added Sept 2 2026). NEVER
  use getISTDateRange(0).since.split('T')[0] — that value is the UTC instant marking today's
  IST midnight, and its own ISO date portion is always YESTERDAY's UTC calendar date, not
  today's IST one. This was silently wrong at 5 call sites before the Sept 2 2026 fix (LLM
  system-prompt "today" context, grn_completeness's month default, confirmReceiveGrn's
  auto-GRN date, confirmGenerateInvoice/confirmConsolidatedInvoice's invoice_date).
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
- GSTR-2B JSON: b2b, cdnr, and b2ba arrays are now all parsed (Sept 2 2026) — SUM and IMPG
  still ignored entirely. cdnr/b2ba field names are unverified against a real sample file
  (see Shipped Sept 2, 2026) — treat as best-effort until tested against a live export
  containing actual credit notes/amendments.
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
- ✅ Matched — supplier GSTIN + normalised invoice_no found in JSON, taxable diff ≤ ₹2 AND
  tax-amount diff ≤ ₹2 (tax comparison added Sept 2 2026, skipped when our own GST rate is
  unknown — see Shipped Sept 2, 2026)
- ⚠️ Amount Mismatch — taxable diff > ₹2 and/or tax-amount diff > ₹2
- ❌ "Not in 2B — Supplier Default" (renamed Sept 2 2026, was "ITC Blocked" — internal
  buckets.blocked key unchanged) — in Nexflow GRN but not in JSON (supplier hasn't filed
  GSTR-1). Section 16(4) expiry badge added here Sept 2 2026.
- ❓ Unrecorded — in JSON but no GRN in Nexflow (unrecorded purchase or fraudulent IMS
  auto-accept). Gained a "Credit Notes — Unrecorded" sub-bucket (cdnr rows) and an "Amended"
  docType tag (b2ba rows) Sept 2 2026.

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

**IMS status display (relabelled Sept 2 2026):** NO_ACTION → grey "Auto-accepted" (was a red ⚠
alarm with a tinted row — downgraded, since NO_ACTION is IMS's normal default-accept outcome,
not something urgent), PENDING → amber "Pending", A → green "Accepted", REJECTED/R → red
"Rejected". renderImsBadge() in gstr2b-reconcile.html is the single source for this mapping.

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

## Shipped Sept 2, 2026

### CA Export & Invoice Compliance Overhaul — 8-prompt GST/compliance pass
Full pass fixing legal-correctness defects across the GST/CA-facing surfaces: invoices now
carry a real invoice date instead of an insert timestamp, the audit trail for hard-deleted
cancelled challans survives the delete, the CA export stops mixing draft/cancelled invoices
into GST figures, place-of-supply is correct for purchases and covers all 37 states, Table
12/13 gained the columns the GST portal actually needs, GSTR-2B reconciliation stops
conflating supplier default with s.17(5) blocked credit, and rounding/copy-marking/AATO gaps
are closed. Rule 55 challan fields (consignee GSTIN, HSN, taxable value, copy markings on
challan.html) were explicitly dropped from scope by request — challan.html itself untouched.

**7 new migrations** (applied via SQL Editor, never `supabase db push`):
- `20260901_add_invoice_date.sql` — `p2_invoices.invoice_date date`, added nullable,
  backfilled from `(created_at AT TIME ZONE 'Asia/Kolkata')::date`, then `SET DEFAULT` +
  `SET NOT NULL`. (Backfill done as a separate UPDATE after adding the column nullable —
  adding it `NOT NULL DEFAULT ...` in one statement would have pre-filled every existing row
  with *today's* date at ALTER time, silently corrupting history.)
- `20260901_payment_status_invoice_date.sql` — `v_p2_invoice_payment_status` view rebuilt
  (DROP + recreate, not CREATE OR REPLACE — Postgres can't change a view column's type in
  place) to read `i.invoice_date` instead of aliasing `i.created_at AS invoice_date`; overdue
  predicate now `i.invoice_date < (now() AT TIME ZONE 'Asia/Kolkata')::date - 45`.
- `20260901_invoice_roundoff_and_doc_type.sql` — `p2_invoices.round_off numeric NOT NULL
  DEFAULT 0`, `p2_invoices.doc_category text NOT NULL DEFAULT 'goods' CHECK IN ('goods',
  'services')`.
- `20260901_fix_invoice_number_ist.sql` — `get_next_invoice_number` now stamps the YYYYMM
  segment via `to_char(now() AT TIME ZONE 'Asia/Kolkata', 'YYYYMM')`, not raw `now()`.
- `20260901_cancelled_challan_log.sql` — new `p2_cancelled_challans` table (Rule 56(7) audit
  trail — see Database Tables above); `hard_delete_dispatch` re-emitted with one added block
  that inserts an audit row before deleting a cancelled challan's items.
- `20260901_add_aato_bracket.sql` — `p2_tenant_settings.aato_bracket` (see Database Tables
  above).
- `20260901_cancelled_challan_movement_purpose.sql` — `p2_cancelled_challans.movement_purpose`
  added; `hard_delete_dispatch` re-emitted again to also log it at cancel time.

**2 Edge Function redeploys:**
- `invoice-view` — select now returns `invoice_date` as its own field (was aliased from
  `created_at`), plus `round_off`, `doc_category`.
- `agent-query` — `buildInvoiceTotals` rounds CGST/SGST halves to paisa and total to rupee,
  deriving `round_off` from the residual; `confirmGenerateInvoice`/`confirmConsolidatedInvoice`
  insert `invoice_date`/`round_off`/`doc_category`; `deriveDocCategory()` new helper (services
  when every covered order is job-work/bom_issue, else goods); plus the `todayIST()` fix below
  (second redeploy, same day).

**export.html — 9 sequential passes** (single file, 1,862→2,452 lines, each pass syntax-checked
before the next):
1. `GST_STATE_CODES` — full 37-state map + 38 (Ladakh) + 97 (Other Territory), was 10 entries.
2. Purchase Register place-of-supply now always the tenant's own state (was wrongly using the
   supplier's state); Sheet 2 B2C rows fall back to tenant state too.
3. `invoice_date` used throughout (Sheet 2, Table 12, 43B(h)) instead of `created_at`.
4. `status='sent'` filter added to Sheet 2's query, placed before the line-item explosion —
   fixes Sheet 2 *and* Sheet 3 at once, since Sheet 3's totals accumulate inside Sheet 2's own
   loop. Sheet 3 relabeled "Indicative Net GST" (was the misleading "NET GST PAYABLE /
   (REFUNDABLE)") with a disclaimer row underneath.
5. Sheet 2 gained `Round Off` and `B2C Type` (B2CL/B2CS) columns; `B2CL_THRESHOLD` (₹2.5L per
   spec — GST Notification 12/2024 actually dropped the real portal threshold to ₹1L effective
   1 Nov 2024; a named constant so that's a one-line change if it needs matching later).
6. Table 12 (HSN/SAC) rewritten: groups by HSN + a derived effective rate (`rate =
   round(amount_gst / amount_subtotal * 100)`, 0 when subtotal ≤ 0 or gst_type='none' — no
   schema change, no reopening the flat-18% lock), adds Description/UQC/Quantity columns,
   blank-HSN rows excluded with an invoice-count warning (was a hard `throw`).
7. Table 13 (Challan Register) rewritten: three document rows (Tax Invoices, Delivery
   Challans (Job Work), Delivery Challans (Other)); cancelled counts come from both
   `p2_dispatch_orders` (not-yet-hard-deleted) and `p2_cancelled_challans` (hard-deleted); gap
   detection scans the full financial year containing the picked month, per challan-number
   series (prefix-aware — `RM-1001` and `1001` are independent sequences); From/To *display*
   is scoped to the picked month's rows with a real `dispatch_date` only — rows sourced from
   `p2_cancelled_challans` (dated only by `cancelled_at`, which can be long after the
   challan's real issue month) are excluded from the range display so an ancient challan
   number doesn't drag the "From" back across the tenant's whole history just because it was
   purged this month; they still count correctly in Total Issued/Cancelled.
8. New "GSTR-1 Excel Workbook" download (README/b2b/b2cs/b2cl/hsn/doc sheets) — the `hsn` and
   `doc` sheets call the exact same grouping functions Table 12/13 use (`computeHsnSummary`,
   `computeTable13Buckets`), so the workbook can never numerically diverge from what's shown
   on screen.
9. 43B(h) section retitled "Buyer Payment Compliance (Your Receivables)"; fixed two genuine
   "vendor"→"client" wording bugs found while verifying scope; new always-visible orange
   notice box.

**invoices.html** — overdue-status CASE and the Date column both switched from `created_at`
to `invoice_date`.

**invoices.html changes (Sept 2, 2026):**
- Detail modal refactor: single Detail button per row replacing inline action buttons,
  `#invoiceDetailModal` overlay matching all-dispatch-history.html pattern.
- Record Payment now available on Draft invoices — flips status to 'sent' on first payment,
  single toast "Payment recorded. Invoice marked as sent."
- Status filter expanded: added Pending Payment, Partial, Overdue options (client-side, no new
  query, reuses `derivePaymentStatus` + `receiptsByInvoice`).
- Mobile: DATE/MODE/PERIOD columns hidden below 768px, Detail button always visible.

**invoice.html + js/invoice-pdf.js** — round-off line added to totals (on-screen and PDF);
invoices now print/download in the correct number of physical copies per Rule 48(1)/48(2) — 3
for goods (Original for Recipient / Duplicate for Transporter / Triplicate for Supplier), 2
for services (Original for Recipient / Duplicate for Supplier) — one label per page, replacing
the old single page with all labels stacked on it. `invoice.html` clones its rendered
`#content` into N `.invoice-copy` pages for browser print; `invoice-pdf.js`'s
`buildInvoicePdf()` now calls a new `drawInvoiceCopy()` once per label via `doc.addPage()`.
CANCELLED watermark switched to `position: fixed` in print CSS so it repeats on every physical
page instead of landing on only one. Script tag cache-busted (`invoice-pdf.js?v=2`) after a
verification round showed a browser serving a stale cached copy of the old code.

**settings.html** — "Annual Turnover (AATO)" dropdown on the Company Details tab, saved to
`aato_bracket`.

**all-dispatch-history.html** — `aato_bracket` fetched alongside `plan`; non-blocking amber
e-invoicing banner shown in the Generate Invoice modal for `5cr_to_10cr`/`above_10cr` brackets
(never blocks generation). Separately: **fixed a real pre-existing auth bug** — the Generate
Invoice button was sending the public anon key as `Authorization` instead of the logged-in
user's session JWT (present since the invoice feature shipped July 31). This silently worked
only because the older deployed `agent-query` never verified caller identity; the redeploy
above activated `verifyCallerTenant` (a P0 security fix from an earlier, unrelated commit) in
production for the first time, correctly rejecting the invalid credential and surfacing as
"Unauthorized" on Generate Invoice. Fixed client-side only — fetch a real
`window.supabase.auth.getSession().access_token` at page init, same pattern invoices.html
already used correctly; `verifyCallerTenant` itself was not touched or weakened.

**gstr2b-reconcile.html** — five fixes (see also the GSTR-2B Reconciliation section above,
which has been updated in place):
- "ITC Blocked" bucket renamed to "Not in 2B — Supplier Default" everywhere (stat card, tab,
  empty state, tooltips, Excel sheet/column) — presentation only, internal `buckets.blocked`
  key unchanged.
- Tax-amount comparison added (±₹2 tolerance) alongside the existing taxable-value comparison
  — new `Taxable Diff (₹)` / `Tax Diff (₹)` columns on the Amount Mismatch table/sheet.
  Skipped entirely when the tenant's own GST rate for that material is unknown, so a missing
  rate never reports a false mismatch.
- `cdnr`/`b2ba` parsing added — see the corrected GSTR-2B JSON note above. Unverified against
  a real sample; test before trusting in production.
- IMS status relabelled — see the corrected IMS status display note above.
- Section 16(4) ITC-expiry badges added to the Not-in-2B bucket only (30 Nov following the
  FY-end, ignoring the earlier-annual-return-filing carve-out Nexflow can't know). Per-row
  badge, summary count line, Excel flag column. Uses
  `p2_stock_transactions.transaction_date` (GRN date) as the invoice-date proxy — there is no
  supplier invoice date column.

**Bug found and fixed during verification: `todayIST()` off-by-one.** See the "Today's IST
date" gotcha above for the mechanism. Fixed at 5 call sites in `agent-query/index.ts` by
centralizing into one `todayIST()` helper.

**2L regression harness note**: `node _ai/regression/snapshot.js` + `diff.js` against
`baseline-pre-2H.json` (Aug 25) shows real drift on SS Engineering (stock levels, dispatch
count) — expected, since that baseline predates a full week of live production usage plus the
entire Step 2H–2M rollout. Diffing against the most recent pre-session snapshot instead
(`2026-08-31-17-26.json`) shows only 4 small stock increases (2 days of normal GRN activity),
zero dispatch-count change — nothing in this session's diff touches `p2_stock_transactions`,
`v_p2_stock_balance`, or dispatch-status logic. When checking "did today's changes touch a
live tenant," always diff against the most recent prior snapshot, not the Step-2 baseline.

## Shipped Sept 3–4, 2026 — Sessions 1–4

### Security and RLS (Session 1)
- set_tenant_id() trigger: auth.uid() → get_my_tenant_id() (10 tables)
- Write policies: auth.uid() → get_my_tenant_id() across 13 tables
- handle-new-user Edge Function: deleted (unauthenticated privilege escalation —
  arbitrary (user_id, tenant_id, role) insert with service role. DB trigger handles
  new user setup. Zero callers confirmed before deletion.)
- RLS enabled on 16 p2_* tables (was created but never enabled)
- Two FK constraints dropped from p2_stock_transactions (blocked staff GRN inserts)
- View RLS: v_p2_wip_balance and v_p2_invoice_payment_status fixed

### Financial accuracy (Session 2)
- Payment modal: field order changed to Net first → TDS → Deductions → Gross (computed).
  Balance due display added at top (Invoice Total / Already Received / Balance Due).
  Over-payment guard: blocks if net > remaining balance.
  Marathi: all 8 labels, both buttons, all 6 payment mode options translated.
- Accountant role: dashboard permission added to js/roles.js
- navbar.js: plan query changed from p2_tenants (wrong table, broke for staff) to
  p2_tenant_settings. This was causing 400 errors on every page load for staff roles.
- production-issue.html: issue number no longer burned on failed confirm —
  pendingIssueChallanNumber reused across retry attempts
- dispatch.html: draft mode removed entirely. All saves go straight to confirmed.
  .neq('status','draft') added to loadRecentDispatches(). Existing draft rows hidden.
- Error handling: fail-closed stock check in dispatch.html (was fail-open — a query
  error let the dispatch through as if stock were sufficient). Price-prefill queries
  in all-dispatch-history.html now surface errors instead of silently showing blank rates.
- js/auth.js and settings.html: 2 production console.log statements removed

### Compliance gaps (Session 3)
- Tooling register: asset_tag, last_confirmed_at, confirmed_by columns added to
  p2_dispatch_orders. all-dispatch-history.html shows Tooling Register section
  (gated behind isJobWorker()). EXEMPT badge shown on exempt tooling rows.
  "Confirm Still Here" button stamps attestation. Owner/supervisor only.
- p2_challan_links: new table linking return dispatches to original outward challans.
  dispatch.html shows "Link to Original Challan" section for return movement purposes.
  all-dispatch-history.html Detail modal shows linked challans.
- UQC codes: uqc column added to p2_raw_materials and p2_products. Backfilled.
  UQC dropdown in settings.html and products.html. Warning banner for null UQC.
- 43B(h) report: renamed receivables section to "Client Payment Status".
  New "Supplier Payment Compliance — 43B(h)" card with explanation and placeholder.
  (Actual payables register not yet built — see Backlog.)
- p2_user_roles SELECT policy: widened to tenant-wide read (get_my_tenant_id())
  so staff can see other staff members within their own tenant. Required for
  tooling register "Confirmed By" display. Three redundant SELECT policies dropped
  in the same cleanup (see RLS Fixes section above).

### Structural gaps (Session 4)
- is_job_worker gate: wiring completed across all job-worker UI. isJobWorker() function
  in js/supabase-client.js is the single source. All gated features check this before rendering.
- Principal pool GRN (grn.html): Material Owner selector shown when isJobWorker() = true
  and p2_clients has is_job_work_principal = true entries. Three-way: 0 principals = hidden,
  1 principal = radio toggle, 2+ = dropdown. Principal's Challan No + Date required when
  principal selected. owned_by, principal_challan_no, principal_challan_date written to
  p2_stock_transactions. scanner.html explicitly writes owned_by: null — own-stock only
  by design. A principal delivery must go through grn.html.
- v_p2_stock_balance_by_owner: new view (see Database Tables section).
- index.html pool tabs: shown when isJobWorker() = true. All/Own Stock/[Principal Name].
  Client-side filter on cached allStockLevels. Stat cards reflect active pool.
  Non-job-worker path: unchanged, still queries v_p2_stock_balance.
- WhatsApp challan share: button on challan.html. Web Share API with wa.me fallback.
  Shares link (not PDF). URL appears once — text and url params separated.
  Available to all plans. Hidden on print.
- Marathi: invoices.html, production-issue.html, all-dispatch-history.html fully translated.
  Dynamic content re-renders on language toggle (applyLang() now calls render functions).
- grn-history.html: .is('owned_by', null) filter removed. All GRNs shown regardless of
  ownership. Owner column added (hidden for non-job-worker tenants). Batch-resolves
  principal names via p2_clients lookup.
- all-dispatch-history.html: invoice rate pre-fill warning + checkbox guard for Datta
  Prasad's 97 KPML SAP PO rates (Fix 4 from Session 1, carried forward).

### Known open items (not yet fixed)
- Return dispatch pool bug: dispatch.html's confirm_dispatch_transaction RPC call never
  passes p_owned_by for any movement type — the parameter is omitted entirely, so it
  always defaults to NULL (own stock), including for the three RETURN_PURPOSES
  (job_work_return, scrap_return, unused_material_return). Returns deduct from own stock
  instead of principal's pool. FIXED (Session 5, Sept 5 2026).
- s.143 clock: starts from dispatch_date (KPML's send date) not principal_challan_date
  (vendor's receive date). These differ. ITC-04 ageing slightly wrong until fixed.
  ESCALATED Sept 7 2026 — now a Phase 3 blocker, see "Known Open Items / Blocking Issues"
  below.
- Scanner own-stock design: scanner.html always writes owned_by = null. If storekeepers
  receive principal material via QR scan, it records as own stock. Acceptable for now.
  Extend to scanner only after field use confirms this is a real workflow.
- Per-material pool override (Type E): one production run consuming from two different
  pools simultaneously is not supported. Build when first client requests it.
- F3: confirmConsolidatedInvoice has no movement_purpose filter — sweeps job_work_return
  challans into consolidated invoices. Fix before first KPML invoice is raised.
  FIXED (Session 6 code; deployment verified Session 11, Sept 9 2026).
- F9: settings.html client creation writes user.id instead of tenantId — staff cannot
  create principal clients. FIXED (Session 6; verified Session 11, Sept 9 2026).

## Shipped Sept 5, 2026

- **Return dispatch pool fix**: dispatch.html now derives and passes p_owned_by for return
  movements via a form-page dropdown, not modal derivation. rm-dispatch.html same.
- **F1 fix**: stock pre-check now filters on derivedOwnedBy, not hardcoded own stock.
- **F2 fix**: rm-dispatch pool derivation now gates on ownershipChanges === false in
  addition to isJobWorker().
- **separate_pool_deduction setting**: new boolean column on p2_tenant_settings (migration
  20260905_separate_pool_deduction.sql). isSeparatePoolDeduction() helper in
  js/supabase-client.js. Toggle in Settings Advanced section. Mode 1 (false, default) =
  unified inventory, no pool attribution. Mode 2 (true) = separate pool deduction,
  existing behavior.
- **Always-visible "Deduct stock from" dropdown** on dispatch.html, rm-dispatch.html,
  production-issue.html. Shown when isJobWorker() && isSeparatePoolDeduction(). Defaults
  per ownershipChanges flag from movement-purpose.js. Always overridable by user.
- **Stock in Inventory tab on dashboard**: replaces ALL tab. Sums stock across all pools
  per material, no status badge, history shows all transactions regardless of owned_by.
- **F5 fix**: grn.html and production-issue.html now gate on isJobWorker() as primary
  condition, not principal count. 0-principal job-worker gets "Own Stock only" state with
  orange hint pointing to Settings.

## Shipped Sept 5, 2026 — Session 6 (Phase 0)

Role/permission audit fixes and the P0 GSTR-1 compliance holes from `_ai/codebase-audit.md`
and `_ai/compliance-and-field-report.md`, plus the two items Session 5 left open in its own
Known Open Items list — F3 and F9, both resolved below. Grouped P0/P1/P2 per the execution
plan. All five migrations applied directly via Supabase SQL Editor — no migration files for
any of them, same as the set_tenant_id() precedent above.

### P0 — Invoice generation compliance (live GSTR-1 exposure)
- **confirmGenerateInvoice** (agent-query/index.ts): new `SALE_INVOICEABLE_PURPOSES`
  constant (`sale`, `direct_supply_from_jobworker` — the two `ownershipChanges: true`
  values in js/movement-purpose.js). Rejects with a 400 + clear error string when
  `order.movement_purpose` isn't one of these, checked immediately after the existing
  status check, before any client lookup or item work. Duplicated-constant convention
  matches the existing `JOB_WORK_MOVEMENT_PURPOSES` set (no shared module system between
  the browser script and this Deno function).
- **confirmConsolidatedInvoice + previewConsolidatedInvoice** (agent-query/index.ts): both
  dispatch-order sweep queries now add `.in('movement_purpose', ['sale',
  'direct_supply_from_jobworker'])`. Job-work dispatches are silently excluded from the
  sweep (never fetched, no error surfaced) — fixes F3 (consolidated invoices could sweep
  job_work_return challans into a client bill). Applied to both preview and confirm so the
  two can never disagree on what's billable.

### P1 — Role and permission fixes
- **Cancel/Amend buttons**: gated to `['owner','supervisor']` on all-dispatch-history.html
  (row + Detail modal, both Cancel and Amend), dispatch-history.html, issue-history.html,
  rm-dispatch-history.html (row + Detail modal Cancel only — no separate Amend button
  exists on these three). Operator previously saw and could use all of these.
- **Generate Invoice** (all-dispatch-history.html): role check flipped from
  `currentRole !== 'accountant'` to `['owner','supervisor','accountant'].includes(currentRole)`
  — accountant now allowed, operator now blocked. Plan gate (`canInvoice`) unchanged.
- **Cancel Invoice** (invoices.html): restricted to `currentRole === 'owner'` only (was:
  any role except accountant, i.e. supervisor could cancel a tax invoice with no audit
  trail). Audit-trail columns (cancelled_at/cancelled_by/cancel_reason) added to the schema
  this session — see Migrations below — but cancelInvoice() itself is not yet extended to
  write them; that's a follow-up, not blocked on this fix.
- **challan.html**: page-level role gate added (previously none — any authenticated role,
  including storekeeper, could open and edit any challan by URL). Read access:
  `canAccess(role,'dispatch_history')` — extends automatically to accountant now that
  P2's roles.js grant (below) adds dispatch_history to that role. Edit access (Edit Client
  / Edit Text buttons, plus their handlers `toggleEditMode()`/`openEditClientModal()`):
  `['owner','supervisor']` only, checked both at button-visibility and inside the handlers
  themselves. Required adding `<script src="js/roles.js">` to the file — it was missing
  entirely, so `canAccess()` was never callable here before.
- **products.html**: all 6 BOM/product mutation entry points (`add-product-form`,
  `add-ingredient-form`, `edit-product-form` submit handlers, `deleteIngredient()`,
  `editProduct()`, `deactivateProduct()`) now check `['owner','supervisor'].includes(getUserRole())`
  and return early otherwise. Corresponding Edit/Deactivate/Remove buttons and the two Add
  forms hidden from operator at render/init time — operator can still view products/BOM.
- **export.html**: page-level gate tightened from `canAccess(role,'reports')` (included
  operator) to a direct `['owner','supervisor','accountant']` check — operator no longer
  reaches the Tally/Zoho export, Purchase Register or GST Summary sheet. `TABLE13_ROLES`
  (unchanged) is now a redundant subset of the page gate. Also fixed in the same pass:
  `#gstr1WorkbookSection` had no `display:none` default, unlike its four sibling
  TABLE13_ROLES-gated sections, so it was visible by default regardless of role — added
  the missing CSS rule.
- **Invite-staff role whitelist**: ported from the dead `supabase/functions/invite-staff/index.ts`
  (lines 71-77) into the live `api/invite-staff.js`, which had no whitelist at all and
  passed `role` straight into the invite unchecked. Rejects any role except `supervisor,
  storekeeper, operator, accountant` with a 400. `settings.html`'s invite dropdown no
  longer offers "Owner" as an option (an owner could previously mint a second full owner).

### P2 — Lower-risk fixes
- **js/roles.js**: accountant gains `grn` and `dispatch_history` (was: `dashboard, reports,
  invoices` only) — read access to grn-history.html and all-dispatch-history.html.
  Sequenced after the P1 Cancel/Amend/Generate-Invoice fixes above — grn-history.html has
  zero write paths (pure read), and all-dispatch-history.html's write buttons were already
  re-gated by P1 before this landed.
- **Telegram bind-token expiry**: `telegram_bind_token_expires_at` set to now+10min on
  generate (settings.html), checked in telegram-webhook/index.ts before completing a bind
  (rejects with the same "expired or invalid" message as a not-found token). Previously a
  bind token never expired server-side — only a 2-minute client-side poll gave up on it.
- **check-low-stock/index.ts**: low-stock alert list now excludes deactivated materials.
  NOT implemented as `.eq('is_active', true)` on `v_p2_stock_balance` — that view has no
  such column and would 500 (same trap already documented for `owned_by` on this view).
  Instead fetches active `p2_raw_materials` ids separately and intersects client-side,
  same pattern as agent-query's `buildContext()`. The GRN-name-resolution map used lower in
  the same function is deliberately left unfiltered, so yesterday's GRNs still resolve a
  name even for a since-deactivated material.
- **challan.html**: `saveClientInfo()`'s two autofill upserts (`p2_clients`,
  `p2_client_po_numbers`) now resolve `tenant_id = user.user_metadata?.tenant_id || user.id`
  instead of raw `user.id` — this function had no tenantId resolution at all before (a
  supervisor editing client info on a challan wrote an orphan row).
- **settings.html**: `add-client-form` handler now resolves `tenantId` the same way
  instead of `user.id` — fixes F9 (staff couldn't create principal clients because the
  insert targeted the wrong tenant). Latent in practice since this page is owner-only
  today, but removes the footgun for if that ever changes.

### Migrations applied (SQL Editor, no migration files)
- `p2_invoices`: added `cancelled_at timestamptz`, `cancelled_by uuid REFERENCES
  auth.users(id)`, `cancel_reason text`; added `CHECK (status IN ('draft','sent','cancelled'))`
  (the column previously had no CHECK constraint at all).
- `p2_stock_transactions(tenant_id, transaction_type, transaction_date)` — new index.
- `p2_stock_transactions(tenant_id, raw_material_id)` — new index.
- `p2_invoices(tenant_id, invoice_date)` — new index.
- `p2_tenant_settings`: added `telegram_bind_token_expires_at timestamptz`.

## Shipped Sept 6, 2026 — Session 7 (Phase 1)

### Physical Stock Count Screen
- Entry point: card on reports.html, visible to owner/supervisor only
  (layered on top of the existing canAccess(role,'reports') gate).
  No new nav link, no new page, no migrations, no Edge Functions.
- Full-screen count overlay (z-index 600, above navbar) with:
  - Per-pool independent sessions: Own Stock tab + one tab per
    is_job_work_principal=true client. No "All" tab — cross-pool
    counts cannot be posted to one owned_by value unambiguously.
  - Non-job-worker tenants see no tabs (implicit own-stock session).
  - System qty from v_p2_stock_balance (own) and
    v_p2_stock_balance_by_owner (principal pools). Both queried once
    on overlay open, never re-queried during the session.
  - All active materials shown; zero-balance materials show 0 (not
    missing) — source of truth for material list is p2_raw_materials,
    balance views only supply the qty.
  - In-place variance/value updates per keystroke (no full re-render
    — preserves mobile input focus/cursor).
  - localStorage autosave debounced 500ms.
    Key: nexflow_stockcount_${tenantId}_${todayIST()}_${poolKey}
    poolKey = 'own' or principal's p2_clients.id.
    Value: {counts: {raw_material_id: "typed string"}, savedAt: ISO}.
    Old keys (wrong date) are never read — natural daily expiry.
    Cleared only on successful post.
- Post Variances modal (z-index 700) with verification checkbox and
  double-submit guard. Batch inserts signed adjustment rows to
  p2_stock_transactions:
    transaction_type: 'adjustment'
    notes: 'Physical Stock Count — YYYY-MM-DD'
    transaction_date: todayIST() — IST date, confirmed 2026-09-06
    owned_by: null (own) or principal's p2_clients.id
    rate: latest price_per_unit from p2_material_prices (null if none)
  Verified in DB: transaction_date IST-correct, owned_by null for own
  stock, quantity sign correct (shrinkage = negative).
- ExcelJS variance report (cdnjs 4.3.0, newly added script tag to
  reports.html): orange header, all counted materials including
  zero-variance rows (proves completeness), columns: Code | Material |
  UQC | System Qty | Physical Qty | Variance | Rate (₹) |
  Variance Value (₹) | Pool | Posted At (IST).
- Marathi translations: all static labels via data-en/data-mr,
  all dynamic strings via local t(en,mr) helper.
- todayIST() implemented as:
  new Date().toLocaleString('en-CA',{timeZone:'Asia/Kolkata'}).split(',')[0]
  Never toISOString().split('T')[0].

## Shipped Sept 8, 2026 — Session 8 (Phase 3)

### s.143 Clock Fix
- Clock is computed at READ TIME from p2_stock_transactions GRN rows where
  owned_by IS NOT NULL
- clockStart = COALESCE(principal_challan_date, transaction_date)
- principal_challan_date lives on p2_stock_transactions (added by
  20260904_grn_principal_pool.sql), NOT on p2_challan_links (that table has
  no such column)
- The existing set_s143_clock() trigger fires for the OPPOSITE direction
  (this tenant acting as principal issuing material out) and was left
  untouched — it is correct for its own use case
- Pure helper in js/s143-clock.js (no DOM, no Supabase calls)
- Known simplification: all GRN receipts treated as 365-day inputs — no
  capital goods 3-year band, no tooling exemption on the GRN side (those
  flags exist on dispatch-side only)
- Commits: 969cb3a (js/s143-clock.js), 4c66ea7 (Excel polish)

### ITC-04 Working Paper Export
- New page: itc04-workingpaper.html
- Entry card added to export.html
- Role gate: owner, accountant, supervisor
- Plan gate: Pro and Founder only (matches GSTR-2B precedent)
- English-only (matches CA-facing export.html precedent)
- Tables 4 / 5A / 5B / 5C per GSTN ITC-04 structure
- Table 4 source: p2_stock_transactions GRN rows, owned_by IS NOT NULL,
  movement implied by GRN receipt
- Table 5A source: p2_dispatch_orders, movement_purpose IN
  (job_work_return, rework_return, unused_material_return)
- Table 5B source: scrap_return movement_purpose
- Table 5C source: direct_supply_from_jobworker dispatches
- Original challan link via p2_challan_links join —
  0 links → "Not Linked" (honest, never fabricated)
  1 link → challan no + time taken computed
  >1 link → "Multiple challans linked (N)", time blank
- Excel: orange headers, status cell colour coding
  (green/amber/light-red/strong-red), Summary sheet with section headers,
  balance mini-table (Material | Balance), amber disclaimer row, italic
  disclaimer text
- Table 5A Purpose column: human-readable labels in Excel only
  (Job Work Return, Rework Return, Unused Material Return)
- Warning banner when separate_pool_deduction = false (Tables 5A/5B/5C
  will be empty in that mode)
- Known limitation: Table 5A/5B returns will show Not Linked for all real
  KPML returns because p2_challan_links only offers this tenant's own
  prior dispatches as candidates — KPML is not a Nexflow tenant so no
  matching original exists
- This page becomes Part 1 of the Monthly AI Filing Package (E2) per
  enterprise-strategy.md §3.2

### Commits
- 969cb3a — js/s143-clock.js (standalone, Part A)
- 1221834 — itc04-workingpaper.html + export.html card (Part B)
- 4c66ea7 — Excel Summary sheet polish (Fix 1-6)

## Shipped Sept 8, 2026 — Session 9 (Phase 2)

### KPML Principal Dashboard

**Three design questions answered:**
- Q1: KPML is a normal p2_tenants row with is_principal=true,
  is_job_worker=false. No separate table.
- Q2: Same Supabase Auth flow as vendors. Same signup,
  same roles, same staff-invite.
- Q3: KPML sees ONLY owned_by=KPML rows at each vendor.
  Never vendor own stock, never other principals' material.
  Enforced in a single SECURITY DEFINER RPC, not RLS.

**New table: p2_network_links**
  principal_tenant_id, vendor_tenant_id, status
  (active/revoked — never delete, history preserved)
  UNIQUE(principal_tenant_id, vendor_tenant_id)
  RLS: tenant can SELECT rows where it is either side
  Insert: manual only in this phase, no self-serve UI yet

**New RPC: get_principal_vendor_material()**
  SECURITY DEFINER, no tenant-id parameter (resolved
  internally via get_my_tenant_id())
  Returns: vendor_tenant_id, vendor_name, raw_material_id,
  material_name, material_code, unit, uqc, hsn_sac,
  current_stock (balance branch, null on clock rows),
  principal_challan_no, principal_challan_date,
  transaction_date (clock branch, null on balance rows)
  Scope boundary comment in function — never returns
  vendor own stock (owned_by IS NULL), other principals'
  material, or any aggregate spanning vendors.
  This function is the single enforcement point for Q3.

**New page: principal-dashboard.html**
  Gate: checkAuth() + isPrincipal() + role
  ['owner','accountant','supervisor']
  No plan gate. No Marathi. English-only.
  Entry: banner on index.html when isPrincipal() is true
  Current layout: one card per vendor, current stock table
  + s.143 clock table per lot using js/s143-clock.js
  All four s.143 status bands verified: within_limit,
  warning, breach_warning, breached
  Known limitation: does not scale beyond ~3 vendors —
  needs vendor list → detail navigation for production use
  (planned for Session 10)

**checkAuth() fix in js/supabase-client.js**
  When user_metadata.tenant_id is absent (user created
  directly in Auth dashboard, not via invite flow),
  now calls get_my_tenant_id() RPC instead of falling
  back to user.id directly.
  Previous behaviour: user.id used as tenantId when
  metadata absent → p2_tenant_settings query used wrong
  UUID → settingsData null → cachedIsPrincipal false.
  Also poisoned fetchUserRole() in js/auth.js — that
  function short-circuits to 'owner' when userId===tenantId
  (line 2), so the wrong tenantId also caused role cache
  corruption. Fix lands before fetchUserRole() is called.
  Direct p2_user_roles query avoided — that pattern causes
  infinite recursion (documented in js/auth.js comments,
  same reason fetchUserRole uses get_my_role RPC).
  get_my_tenant_id() is SECURITY DEFINER, already GRANT
  EXECUTE'd to authenticated (20260803_staff_rls_fix.sql).
  Zero behaviour change for existing owner accounts —
  user_metadata.tenant_id is present for all invited
  staff and normal signups, new branch never executes.

**KPML production setup**
  KPML tenant id: cc23eb60-329b-40ac-8d4a-0667c28546a5
  KPML login: kpml@nexflowautomations.in (owner role)
  Auth user id: ba17a756-986c-428b-9e21-49269aaedc60
  p2_user_roles row links ba17a756 → cc23eb60 as owner
  Linked vendor for demo: test tenant fe2b94fb with 5
  seeded GRN rows covering all four s.143 clock bands
  Real vendor linking (SS Eng, Datta Prasad, Shivprasad)
  deferred — those tenants have no owned_by data yet
  (is_job_work_principal was false on their KPML client
  rows, so GRNs were never recorded with owned_by set)

**Known open items for Session 10:**
  1. Principal dashboard needs vendor list → click →
     isolated vendor detail view. Current card layout
     does not scale to 30+ vendors / 100+ materials.
     Design: vendor list page (name, material count,
     breach count, total value at risk) → click →
     full detail page for that vendor only (current
     stock + s.143 clock table).
  2. Principal-side payment visibility: KPML needs to
     see outstanding invoices per vendor and record
     payments against them on the principal dashboard.
     Vendor-side payment ledger already shipped
     (p2_payment_receipts, invoices.html modal, Aug 28).
     What's missing: a cross-tenant RPC that reads
     vendor invoice + payment status for the principal,
     scoped exactly like get_principal_vendor_material().
     43B(h) angle is the commercial hook — if KPML fails
     to pay an MSME vendor within 45 days of agreed
     credit period, KPML cannot deduct that expense in
     income tax. Dashboard showing outstanding payables
     per vendor + days overdue is a direct tax compliance
     tool for KPML's CA. This was planned since Aug 2026
     (kpml-network-plan.md N1) but not yet built on the
     principal side.
  3. Real vendor data: SS Engineering, Datta Prasad,
     Shivprasad need their KPML client rows updated to
     is_job_work_principal=true and past GRNs re-recorded
     with owned_by set before the November demo can show
     real vendor data. This is a data migration task,
     not a code task — discuss with each client before
     touching their records.

## Shipped Sept 9, 2026 — Session 11

### Session 11 — Bug fixes (KPML demo blockers)

**F8 fixed — GSTR-1 Table 13 job-work bucket (export.html)**
computeTable13Buckets() now correctly buckets all 8 job-work-family
movement purposes into "Delivery Challans (Job Work)":
job_work_issue, job_work_return, unused_material_return, scrap_return,
rework_return, rework_dispatch, capital_goods_issue, inter_jobworker_transfer.
sale, direct_supply_from_jobworker, and NULL stay in their existing buckets.
Both the on-screen Table 13 and the GSTR-1 Excel Workbook doc sheet are fixed
in one change since both call computeTable13Buckets().
Local constant JOB_WORK_BUCKET_PURPOSES (Set) defined inside the function —
matches codebase convention, no shared module needed.

**F3 verified deployed — confirmConsolidatedInvoice movement_purpose filter**
Fixed in Session 6 code, deployment confirmed via live test Sept 9 2026:
three job_work_return dispatches (challans 3057–3059) on test tenant correctly
excluded from consolidated invoice sweep. No code change this session.

**F9 verified fixed — settings.html client creation tenant resolution**
Fixed in Session 6. settings.html:2178 confirmed using correct pattern
(user.user_metadata?.tenant_id || user.id). No code change this session.

**Challan number format fixed — two-part**
Part A (DB, SQL Editor): confirm_dispatch_transaction fallback branch changed
from CHAL-YYYYMMDD-NNNN (18 chars, over Rule 46(b)/55 cap) to
CH-YYMMDD-NNNN (14 chars). Date now uses AT TIME ZONE 'Asia/Kolkata'
(was bare NOW() = UTC, would give yesterday's date for late-evening IST
dispatches). Verified: 0 CHAL- rows on test tenant before change.
ALTER TABLE p2_dispatch_orders ADD CONSTRAINT chk_challan_number_length
CHECK (length(challan_number) <= 16) NOT VALID — enforces cap on new
rows only, does not touch any existing rows (NOT VALID is required here,
not optional — a plain CHECK would fail on any existing CHAL- rows on
other tenants).
Part B (export.html): challanSeriesKey() extended with a legacy-format
branch — CHAL-YYYYMMDD-NNNN rows are now parsed and folded into the
bare-number series (prefix '') instead of being silently dropped from
gap detection. Purely additive — all previously-matching inputs
unchanged.
CA confirmation still needed: confirm CH-YYMMDD-NNNN is acceptable
under Rule 55 before deploying Part A to live tenants. Test tenant only
for now.

**Principal Dashboard v2 — complete**
Vendor list → detail navigation, payment visibility,
get_principal_vendor_invoices RPC, 43B(h) risk surface.

## Shipped Sept 9, 2026 — Session 12

### Session 12 — s.143 clock verification + GRN duplicate invoice guard

**FIX 1 — s.143 clock (doc correction only)**
js/s143-clock.js already implements clockStart = row.principal_challan_date
|| row.transaction_date (shipped Session 8, commit 969cb3a). Both
principal-dashboard.html and itc04-workingpaper.html already pass
principal_challan_date through correctly. CLAUDE.md "Known Open Items"
had not been updated after Session 8 shipped — corrected now.
No code change.

**FIX 2 — GRN duplicate invoice guard (grn.html, UI only)**
No DB index — SS Engineering's coil-by-coil workflow (multiple rows of
the same material under one invoice number, all in one batch, identical
created_at) is legitimate and indistinguishable from a duplicate at the
DB level. UI warning is the correct and sufficient guard.

Added normaliseInvoiceNo() — byte-identical to gstr2b-reconcile.html:299.
Added checkDuplicateInvoice() — queries existing GRN rows for the
selected supplier before the get_next_grn_number RPC call (so no GRN
number is burned on a cancelled submission). Fails open on query error
(advisory only, never a hard block).
Added #duplicateInvoiceModal — "Invoice X was already received under
GRN-Y on [date]. Are you sure this is a different delivery?" Cancel
aborts cleanly. "Yes, this is a different delivery" proceeds to
submitGrnTransactions() unchanged.
RPC-then-insert logic extracted into submitGrnTransactions() — shared
by clean path and confirmed-duplicate path, no behavioral change to
the insert itself.

No migration. No DB index. scanner.html's own confirmGRN() path also
writes invoice_no per row (from its own entryInvoice field) with no
duplicate check at all — untouched this session, known gap, out of
scope. "Own-stock only by design" (scanner.html's existing property)
does not imply "no invoice-duplicate risk" — the two are unrelated;
a scanner-entered GRN can still duplicate a supplier invoice already
keyed via grn.html or another scanner session, silently.

## Shipped Sept 9, 2026 — Session 13 (E4)

### E4 — One-Click Full Export (settings.html)

New file js/full-export.js. Settings.html Company Details tab gains "Export All Data" card —
owner-only, every plan including Lite.

Zip contains: 20 CSVs (all p2_* tables, UTF-8 BOM, paged 1000 rows), manifest.json
(schema_version 1.0, row counts per table), README.txt (Tally import instructions, ledger
remap note, Bridge Agent warning, WhatsApp support contact),
documents/tally/vouchers-FY2026-27.xml (current FY Sales + Purchase vouchers, §3.1 envelope
format, balance assertion per voucher, owned_by IS NULL enforced in query for purchases,
multi-rate purchase grouping), documents/invoices/ and documents/challans/ (current FY PDFs,
headless buildInvoicePdf/buildChallanPdf).

Verified Sept 9 2026: 18 vouchers all net zero, BOM working, PDFs render correctly. Filename:
nexflow-export-<company>-<YYYY-MM-DD>.zip

p2_tenant_settings uses orderColumn: 'tenant_id' (no id column). p2_user_roles uses
orderColumn: 'user_id' (no id column). sha256 per file deferred to v2 (async, needs
restructure). REMOTEID uses FNV-1a hash — NOT the canonical Bridge Agent REMOTEID (Session 18
will use a different, permanent hash). README warns: treat XML as one-time historical import
if Bridge Agent is planned.

## Shipped Sept 9, 2026 — Session 14 (E3)

### E3 — HSN Audit Tool (export.html)

Audits EXISTING hsn_sac codes on p2_raw_materials/p2_products with Haiku — different from
enterprise-strategy.md §3.3's original "AI HSN Autofill" design (which suggests a code for a
*blank* field; not built). New "HSN Audit" card on export.html, after the GSTR-1 Excel Workbook
card. Access: TABLE13_ROLES (owner/accountant/supervisor), all plans including Lite, no plan
gate. No new page, no new Edge Function.

Migration `20260909_hsn_audit_source.sql`: `hsn_source text CHECK IN ('manual','imported',
'ai_verified','ai_corrected')` added to both tables, nullable, no default, never backfilled —
existing rows stay NULL (display logic treats NULL as 'manual'). Written client-side only:
export.html's audit sets `'ai_verified'` on `verdict='correct'` rows (silent, fire-and-forget,
no toast). `'ai_corrected'` (a user manually fixing a flagged code in settings.html/
products.html) is **not built yet** — noted as a follow-up.

New `suggest_hsn` body.action handler on agent-query (sixth body.action handler alongside the
five confirm_*/resend_invoice/preview_consolidated_invoice ones — see AI Agent — Architecture
above). Verifies caller tenant like the other five. Max 25 items/call (400 if exceeded).
Deliberately does **not** call `checkAndIncrementUsage`/consume the daily agent quota — same
reasoning as §3.3: this is data-quality tooling, not the chat copilot, and Lite's 0-quota would
otherwise lock it out entirely. `auditHsnCodes()` clones `callHaiku()`'s exact low-level call
mechanics (model `claude-haiku-4-5`, text-block extraction, \`\`\`json fence stripping) with its
own system/user prompt — unrelated to the chat classification prompt. Shape-validates every
returned verdict/suggested_hsn (bad verdict → forced to `likely_wrong`; malformed or
wrong-chapter `suggested_hsn` → discarded; an id the model dropped entirely → synthesized
`likely_wrong`/"No response from model", never silently treated as correct). Special rule:
`is_job_worker=true` + product kind + `hsn_sac` not starting `'99'` → prompt instructs
`definitely_wrong`/SAC 998898 (prompt-level only, not re-enforced server-side). Logs to
`p2_agent_logs` with `intent='hsn_audit'`, fire-and-forget.

export.html client flow: fetches active `p2_raw_materials` (`is_active=true`) and all
`p2_products` (no `is_active` column on that table), splits client-side into `no_code`
(blank/whitespace `hsn_sac`, immediate verdict, never sent to Haiku) and `to_audit`, calls
`suggest_hsn` in **sequential** batches of 25 (never parallel), progress line "Auditing X of Y
items...". A batch failure partway through still renders whatever batches already succeeded
(`noCodeRows`/`auditedRows` hoisted above the try block for this reason) — toast on error, not
a blocking full-page failure. Results table: Type | Name | Code | Current HSN | Verdict |
Reason | Suggested HSN | Action, left-border colour per verdict (green/amber/red/grey via
`var(--green)`/`var(--orange)`/`var(--red)`/`var(--mid)` on the row's first `<td>` — `<tr>`
itself can't carry a border under `.nx-table`'s `border-collapse:collapse`), sorted worst-first
(`definitely_wrong` → `likely_wrong` → `no_code` → `correct`). Disclaimer ("HSN codes are
AI-assessed. Verify all flagged codes with your CA before filing.") always shown with results.
"Download Report" (ExcelJS, reuses the page's existing `exceljs@4.3.0` script tag — no second
one added): filename `nexflow-hsn-audit-<YYYY-MM-DD>.xlsx`, one sheet, orange header via the
existing `styleHeaderRow()`, row fill per verdict (reusing itc04-workingpaper.html's
green/amber/red ARGB convention — `FFD4F7DC`/`FFFFF0B3`/`FFFFC9C9`, plus `FFE8E8E8` grey for
no_code), summary rows + italic disclaimer row at the bottom.

**Action-column access gap (deliberate):** settings.html is owner-only (redirects every other
role to index.html); products.html requires the `products` permission, which `accountant`
doesn't have (js/roles.js `ROLE_PERMISSIONS`). A "Fix →" link to either page for a role that
can't actually edit there would be a dead-end redirect, so the Action cell is role-aware: owner
always gets a real "Fix →" link to `settings.html?tab=materials` (raw material rows) or
`products.html` (product rows); supervisor gets the products.html link but plain grey text for
raw-material rows ("Ask the owner to fix in Settings"); accountant gets grey text for both
("Ask the owner..."/"Ask the owner or supervisor to fix"). `correct` rows have no Action cell.

**settings.html gained a small `?tab=` deep link** (new, not previously existing) so the
raw-material Fix link actually lands on the Raw Materials tab — settings.html always defaulted
to the Company Details tab on load before this, with no URL-based tab switching at all. Only
`?tab=materials` is handled (the only value any caller sends); anything else/missing falls
through to the pre-existing `switchToTab('company')` default. Calls the same
`switchToTab('materials'); loadMaterials();` pair the existing Materials tab click handler uses.

Corrected two details from the original task spec against the live schema before building:
p2_raw_materials' name column is `name`, not `material_name`; the results table needs a `Code`
column (material_code/product_code) distinct from `Current HSN`, fetched even though the
original field list for the fetch step didn't name it.

Migration applied to all four tenants (test + SS Engineering + Datta Prasad + Shivprasad)
Sept 9 2026. agent-query deployed with suggest_hsn as sixth body.action handler.
Verified on test tenant: verdicts correct, quota untouched, ai_verified write-back confirmed
in DB, p2_agent_logs has intent='hsn_audit' entries.

NOTE: enterprise-strategy.md §3.3 specifies 'ai_suggested'/'ai_accepted' but the shipped
constraint uses 'ai_verified'/'ai_corrected'. A1 must use the shipped values only.

## Shipped Sept 9, 2026 — Session 15 (E2 Part 1)

### E2 — Monthly AI Filing Package, Part 1

Automatic monthly filing package: runs on the 5th of each month (cron 30 2 5 * *,
8:00 AM IST), generates a zip per tenant, uploads to Supabase Storage (private bucket),
emails a 7-day signed download link to the CA/accountant, sends an in-app + Telegram
notification to the owner. No owner action required.

New Edge Function: `supabase/functions/filing-package/index.ts` (~1,720 lines).
`verify_jwt=false`. Uses `SB_SECRET_KEY` for all DB/Storage access.
Two trigger modes:
- `{ mode: 'monthly_cron' }` — cron path, always returns HTTP 200, per-tenant failures
  caught and recorded, never thrown up to the response, tenants processed strictly
  sequentially (never parallel).
- `{ action: 'generate', tenant_id, period_month? }` — manual path from settings.html
  "Generate Now" button, verifyCallerTenant check applied.

Zip contents (what's inside per tenant):
- `gstr1-reference-{YYYY-MM}.xlsx` — 5-sheet GSTR-1 reference workbook (b2b/b2cs/b2cl/
  hsn/doc), labeled explicitly as reference/cross-check data, NOT a GSTN Offline Tool
  import file. CAs use Tally/ClearTax/GSPs for actual filing. B2CL_THRESHOLD = 100000
  (Notification 12/2024, confirmed by CA Sept 9 2026).
- `purchase-register-{YYYY-MM}.xlsx` — GRN purchases this period, for GSTR-3B ITC figure.
- `itc04-workingpaper-{principal}-{YYYY-MM}.xlsx` — one file per job-work principal,
  only when `is_job_worker = true`. Omitted silently for non-job-worker tenants.
  Multiple principals → one file each (loop, not merged). Zero principals with
  `is_job_worker=true` → omitted, noted in README.
- `hsn-audit-{YYYY-MM}.xlsx` — last HSN audit result snapshot. Included only when
  p2_raw_materials or p2_products has rows with `hsn_source IN ('ai_verified',
  'ai_corrected')`. Never re-runs the audit automatically.
- `tally-vouchers-{YYYY-MM}.xml` — period-filtered Tally XML (Sales + Purchase vouchers).
  Same format as E4/Session 13 but scoped to the single month. Unbalanced vouchers
  skipped with count reported in README.
- `exceptions-{YYYY-MM}.txt` — Haiku 4.5 exceptions summary (6 counts in, ≤10 bullets
  out). Does NOT consume daily agent quota. Logged to p2_agent_logs with
  `intent='filing_exceptions'`. Falls back to a deterministic count-listing on Haiku
  failure — package still ships.
- `README.txt` — static template: period, file list, CA instructions, HSN-AI-assessed
  disclaimer, WhatsApp +91 72489 32468.

Email: via Resend, `from: 'Nexflow <filing@nexflowautomations.in>'` (same verified domain
as existing send_challan sender). `reply_to`: tenant's `p2_tenant_settings.email`.
Subject: "Nexflow Filing Package — {company_name} — {Month} {Year}".
File list in email body is built from what was actually added to the zip — never a
static template (so an omitted ITC-04 or HSN file never appears as a false promise).
Recipients resolved from `filing_recipient` column (ca_only/accountant_only/both).
'both' requires BOTH `ca_email` AND `accountant_email` present — skips silently otherwise.

New table: `p2_filing_packages`
id, tenant_id FK → p2_tenants(id), period_month text, status CHECK IN
('pending','generating','uploaded','emailed','failed'), storage_path, signed_url,
signed_url_expires_at, error_reason, created_at, updated_at.
RLS: three command-scoped policies (SELECT/INSERT/UPDATE, no DELETE) on
tenant_id = get_my_tenant_id() — NOT auth.uid() (that pattern is known-broken
for non-owner staff). RLS explicitly enabled in the migration.
UNIQUE index on (tenant_id, period_month) — one package per tenant per month.
Upsert uses `onConflict: 'tenant_id,period_month'`.
Cron skips a tenant with status='emailed' for the current period.
Manual "Generate Now" always overwrites and re-sends.

New columns on p2_tenant_settings:
- `filing_recipient text NOT NULL DEFAULT 'ca_only' CHECK IN ('ca_only','accountant_only','both')`
- `accountant_email text` (nullable)
- `filing_package_enabled boolean NOT NULL DEFAULT true`

New Supabase Storage bucket: `filing-packages` (PRIVATE — never public).
Path: `{tenant_id}/{period_month}/nexflow-filing-{slug}-{YYYY-MM-DD}.zip`
Signed URL expiry: 7 days. All access via service role or pre-signed URL only.

p2_notifications.type CHECK constraint updated to include `'filing_package_ready'`
(was: 'challan_dispatched','payment_overdue','low_stock').

Cron: jobid 9, 'filing-package-monthly', schedule '30 2 5 * *' (8:00 AM IST, 5th of
month). Anon key in Authorization header — same confirmed-live pattern as jobid 2/3/8.
Body: `{"mode":"monthly_cron"}`. Migration: `20260910_setup_cron_filing_package.sql`.

settings.html: new owner-only "Filing Package" tab. Fields: `filing_package_enabled`
toggle, `filing_recipient` selector, `accountant_email` field (shown only when
`filing_recipient != 'ca_only'`), "Generate Now" button (fetches fresh JWT via
`window.supabase.auth.getSession()` — same pattern as export.html's `runHsnAudit()`),
last-package status (badge + period + Download link if `signed_url` exists and
`signed_url_expires_at` is in the future).

Known limitations (not blockers):
- Exceptions summary uses Haiku, not Opus. The Opus-powered covering note
  (00-READ-THIS-FIRST.html, raw-row judgment, misclassification detection) is
  Session 16 scope.
- GSTR-1 reference workbook uses the informal 5-sheet shape, not the GSTN Offline
  Tool V2.0 template. CAs use Tally/ClearTax/GSPs anyway — V2.0 format is Session
  16 scope if needed.
- GSTR-2B reconciliation sheet deferred to Part 2 (requires p2_gstr2b_uploads table).

Verified Sept 9 2026 (test tenant fe2b94fb-9668-405f-9c62-5f54b32f8c7a):
Email delivered to inbox, subject correct, download link live, all 6 files in zip.
status='emailed', error_reason=null, notification status='sent' (Telegram delivered).
agent_interactions_today unchanged (quota untouched). Signed URL expires 7 days out.
Haiku exceptions caught 1 missing supplier invoice number correctly.
Migration applied to test tenant. Pending: apply to all three live tenants before
the 5th of October.

## Shipped Sept 10, 2026 — Session 16 (E2 Part 2)

### E2 — Monthly AI Filing Package, Part 2: Opus Covering Note

Replaced the static README.txt and narrow Haiku exceptions summary from Session 15
with a single Opus-written 00-READ-THIS-FIRST.html covering note. This is the one
deliberate place in the codebase where claude-opus-5 is used (not Haiku) — per
enterprise-strategy.md §3.2 [DECIDED].

Only one file changed: supabase/functions/filing-package/index.ts.
No migrations, no new Edge Functions, no settings.html changes.

Removed from Session 15:
computeExceptionCounts(), callHaikuExceptions(), fallbackExceptionsText(),
buildReadmeText(), ExceptionCounts interface, README.txt zip entry,
exceptions-{YYYY-MM}.txt zip entry.

Added:
`fetchCoveringNoteData(tenantId, monthFrom, monthTo, isJobWorker, tenant)` —
fetches raw invoice/GRN/dispatch/HSN/payment/job-work data for the period.
Carries both raw rows (for Opus) and eight canonical count fields (for Haiku
fallback): missingInvoiceNoCount, missingHsnLineCount, interstateCount,
overdueInvoiceCount, msmeRiskCount, s143BreachCount, wrongInvoiceOnJobWorkCount,
neverAuditedMaterialCount. Overdue invoices NOT period-scoped — queries all
currently overdue invoices regardless of invoice_date (an invoice from 3 months
ago still unpaid is flagged every month until resolved). s.143 lookback: trailing
400-day window on transaction_date, filtered to breach_warning/breached before
reaching Opus — bounded regardless of tenant history length. Uses
v_p2_invoice_payment_status directly (service-role only view — filing-package
already uses SB_SECRET_KEY so it can read it). Reuses existing
fetchJobWorkPrincipals() and computeS143Clock() from Session 15 — not re-ported.

`callOpusCoveringNote(data)` — three-layer fallback chain, never throws:
Layer 1: claude-opus-5, max_tokens=6000, raw rows as input. System prompt: GST
filing assistant, CA-grade, specific, actionable, never invent data, plain prose
no markdown, 200-400 words. User prompt instructs JSON output: {covering_note,
action_items}. parseCoveringNoteJson() validates: non-null object, covering_note
is non-empty string, action_items is array. action_items elements filtered to
typeof string only. stripMarkdown() applied to covering_note. Logs
intent='filing_covering_note', success=true to p2_agent_logs.
Layer 2: claude-haiku-4-5, counts-only input (the eight canonical fields +
companyName + periodLabel + isJobWorker). Same JSON output shape. Logs
success=false, error_reason='opus_failed: <message>'.
Layer 3: deterministic pure function, cannot fail. Walks the eight count fields,
emits plain-text bullets. action_items is one imperative line per non-zero flag.
Logs success=false, error_reason='opus_and_haiku_failed: <message>'.
Never calls checkAndIncrementAgentUsage — not a chat interaction.

`buildCoveringNoteHtml(opts)` — pure function, returns self-contained HTML. No
external CSS, no CDN, no images — renders offline in any browser. Nexflow orange
#ff5c1a. Sections: header (company/GSTIN/date), file list, covering note (prose
paragraphs), action items (numbered ol), footer. @media print block included.
Receives filesForHtml = [...filesIncluded] snapshot — never the live array
reference — so section (b) cannot include itself regardless of future reordering.

Updated:
processTenant() — replaces README+exceptions block with: fetchCoveringNoteData →
callOpusCoveringNote → filesForHtml snapshot → buildCoveringNoteHtml →
zip.file('00-READ-THIS-FIRST.html', html) → filesIncluded.unshift('00-READ-THIS-
FIRST.html — covering note...'). unshift (not push) so it reads first in the
email file list.
sendFilingEmail() — exceptionsText: string replaced with actionItems: string[].
Body renders numbered list when non-empty, "No action items for this period."
when empty.

Dead code removed: stripJsonFence() (was superseded by inline fence-stripping
inside parseCoveringNoteJson()).

Known issue resolved during build: max_tokens was initially 2000, raised to 6000
after Opus truncated at 4660 chars ("Unexpected end of JSON input"). The user
prompt's "300-600 words" instruction was reconciled with the system prompt's
"200-400 words" ceiling — both now say 200-400 words. Shape validation was
initially over-strict (rejected valid Opus responses due to a per-element typeof
check on action_items). Rewritten to exactly four conditions: JSON.parse throws,
not an object, covering_note missing/empty, action_items not an array.

Verified Sept 10 2026:
Test tenant (fe2b94fb): success=true, error_reason=null. Covering note correctly
identified 1 missing GRN invoice number, 1 interstate GRN, 1 overdue invoice, 1
MSME 43B(h) risk, 1 s.143 breach, 2 wrong-invoice dispatches, 6 unaudited
materials.
Datta Prasad (3b68db90): Opus independently caught 78 dispatch challans with
zero sales invoices (named challan range 1103-1177 + parallel series 978/982/
984/985 + 4 missing challan numbers 1145/1150/1160/1174), 15 GRN lines at 0%
rate against identical 18% goods (named all 12 invoice numbers individually), 1
orphan GRN with no supplier/invoice, 623 unaudited materials, 50 dispatched
items with no HSN blocking Table 12. Correctly skipped job-work section (Datta
Prasad is not a job worker).
Both runs: filing_covering_note logged, quota untouched.

## Session 17 additions and strategy sessions (Sept 11 2026)

Post-Session-17 strategic planning. No code shipped — three design documents written, all
`status: design complete — not yet built`.

- **Tutorial engine designed:** `_ai/tutorial-engine.md` (1,329 lines). Three-session build
  plan (T1–T3). Tutorial configs as JS not JSON — the UI is conditional (`#purposeFieldRow`,
  `#poolFieldRow`, `#ownerFieldGroup`, `#challanLinksSection` are each gated on a live
  `isJobWorker()` / `isSeparatePoolDeduction()` call, which JSON cannot express).
  `data-tutorial-target` attributes for targeting, never `#id` or CSS class. New
  `p2_tutorial_progress` table. Marathi-first design. Dispatch + GRN are the P0 modules.
- **Automation strategy designed:** `_ai/automation-strategy.md` (2,281 lines). 8 automations
  (A0–A8), 4 waves. **CRITICAL: A0 + A6 must ship before October 5 2026.**
  A6 finding: `filing-package/index.ts` processes tenants strictly sequentially inside one
  invocation (`for (const tenant of tenants)`, line 2060). Somewhere between ~20 and ~60
  tenants the invocation is killed mid-loop, and the tenants after the cutoff get nothing at
  all — no `p2_filing_packages` row, no failure status, no `error_reason` — so nothing keyed
  on `status='failed'` can detect them. Needs a dispatcher + drain queue before the first
  multi-tenant run.
  A0 finding: no founder-facing Telegram channel exists. Every Telegram path resolves
  `telegram_chat_id` from `p2_tenant_settings` — tenant-scoped by construction. Four
  automations (A2, A3, A6, A8) are silently blocked without it.
- **Business strategy documented:** `_ai/business-strategy.md` (1,249 lines).
  Exit target ₹300Cr post-tax in 7–9 years; ₹150Cr minimum acceptable.
  90% margin threshold: ~65 clients — or ~105 if Supabase Team is bought at the first
  Enterprise signature rather than on load.
  Break-even on recurring revenue: ~3 clients, already passed but only narrowly — with
  SS Engineering free permanently, the three live tenants produce ~₹16,667/month against
  ~₹16,750/month of cost (§3.6).
  Claude Max (₹9,000/month) is the largest single cost line at current scale — 54% of total
  run cost at 3 clients, 7.3% at 1,000.
  Razorpay deferred — see Known Open Items 10.
- Challan line editing and staff activity log added to the product roadmap (Known Open
  Items 8 and 9).
- **Hindi translation: build only on first client request, never speculatively.** Both the
  tutorial engine and the automation layer are designed language-agnostic from day one —
  adding a language is adding keys plus one migration, never engine code.

## Shipped Sept 12, 2026 — Invoice Number Format

Per-tenant invoice number format setting. `p2_tenant_settings.invoice_number_format` (`'full'` |
`'short'`, `NOT NULL DEFAULT 'full'`, migration `20260912_invoice_number_format.sql`) —
`'full'` = today's `INV-YYYYMM-NNN` (unchanged, every existing tenant's default), `'short'` =
`INV-<n>`, no date segment. Historical `invoice_number` values are never rewritten — this only
changes what gets generated going forward.

**`get_next_invoice_number` signature changed**: `RETURNS text` → `RETURNS TABLE(invoice_number
text, sequence_number integer)`. The formatted string alone wasn't enough to build the `'short'`
format safely — `lpad(v_seq::text, 3, '0')` only pads, never truncates, so once
`invoice_sequence` reaches 1000+ the string's tail is 4+ digits and a naive "parse the last 3
characters" approach would silently misread it (e.g. sequence 1001 → last-3 `"001"` → collides
with the real sequence-1 invoice). The RPC now returns the raw integer alongside the formatted
string instead. Both call sites in `agent-query/index.ts` (`confirmGenerateInvoice`,
`confirmConsolidatedInvoice`) updated to read `data?.[0]` instead of a bare string, via new
shared helper `resolveInvoiceNumber(format, seqRow)` (placed next to `deriveDocCategory`).
**Deployment order matters**: apply the migration before redeploying `agent-query` — old
code + new function reads the row array as if it were a string; new code + old function reads
the bare string's first character via `[0]`. Neither fails loudly.

Both invoice-generating handlers now read `p2_tenant_settings.invoice_number_format` before
calling the RPC — neither one had this settings row available beforehand despite the original
task assuming it did. `confirmGenerateInvoice` had no `p2_tenant_settings` fetch at all;
`confirmConsolidatedInvoice` had one, but only *after* the invoice insert and only for the email
step (`company_name`/`email`), too late to gate the number format. That fetch was relocated
earlier (before the RPC call) and widened to include `invoice_number_format`, rather than adding
a second query — the email step below reuses the same relocated row.

`settings.html` (Challan Settings tab): new "Invoice Number Format" dropdown, immediately after
Invoice Starting Number, standalone save button (`toast()` feedback, no fresh-read guard needed
— same simple shape as `invoice_lines_per_page`, unlike Invoice Starting Number's backward-
collision guard). `invoices.html`: `invoiceNumberFormat` piggybacks on the existing
`plan`/`invoice_lines_per_page`/`invoice_sequence` fetch at init; the consolidated-invoice
preview's predicted number (`openConsPreviewModal`) branches on it — cosmetic only, the server
applies the real saved format independently at confirm time.

**Follow-up bug fix, same day**: "Preview Line Items" in the consolidated invoice modal threw
"JSON object requested, multiple (or no) rows returned" — a pre-existing bug in
`previewConsolidatedInvoice`'s duplicate-invoice check (`agent-query/index.ts`), not caused by
the change above. That check queries `p2_invoices` on `(tenant_id, client_id, date_from,
date_to)` via `.maybeSingle()`, but the Max Lines Per Invoice auto-split feature (prior session,
`consolidated_batch_seq`) can legitimately leave more than one row on that exact tuple — one per
split batch — which `.maybeSingle()` rejects as soon as a second batch exists.
`confirmConsolidatedInvoice`'s equivalent check already scopes to one `consolidated_batch_seq`
(the batch it's confirming) and was never affected; preview has no batch number yet, so it
correctly needs to check the whole range across every batch instead. Fixed by fetching the
duplicate check as a plain array instead of `.maybeSingle()` (`existingInvoices?.length`,
joining every matching invoice_number in the error message) rather than narrowing the filter —
narrowing would have silently stopped detecting real duplicates on already-split ranges.

## Known Open Items / Blocking Issues

### Blocking — Enterprise Build Prerequisites
(Identified Sept 7 2026, source: `_ai/enterprise-strategy.md` §6)

E1 = Bridge Agent. E2 = Monthly AI Filing Package. Each item below, left unfixed, produces a
wrong number in a real client's statutory filing or statutory books — these are blockers, not
backlog.

**1. GRN duplicate-invoice guard — BLOCKS E1 (Bridge Agent)**

No uniqueness check of any kind exists on (tenant_id, supplier_id, normalised invoice_no).
A duplicated supplier invoice today double-counts stock and double-claims ITC inside Nexflow.
Worse, gstr2b-reconcile.html groups GRN rows by (supplier_gstin + normalised invoice_no) and
therefore SUMS the duplicates, reporting an "Amount Mismatch" against GSTR-2B rather than a
duplicate — so the operator most likely concludes the supplier filed wrong. With the Bridge
Agent running it becomes two Purchase vouchers in the client's real statutory books.

**Schema correction (verified Sept 7 2026): there are no `p2_grn_items` or `p2_grn_headers`
tables.** Neither exists anywhere in the repo; `20260825_hard_delete_dispatch.sql:18` states
it explicitly ("there is no p2_grn_records table and no structured..."). A GRN is N rows in
`p2_stock_transactions` sharing one `grn_no` (grn.html:805-829): one `get_next_grn_number` RPC
call per submission, then one row per material, all carrying the same grn_no, supplier_id,
transaction_date and owned_by — with `invoice_no` set PER ROW.

**Trap — do not implement the constraint as literally specified.** Because invoice_no is
per-row and one supplier invoice legitimately spans several rows (multi-material delivery), a
plain UNIQUE (tenant_id, supplier_id, normalised invoice_no) would REJECT every legitimate
multi-material GRN and break GRN entry for all three live tenants on day one.

Correct shape — two layers:
- **DB backstop**, partial unique index that includes the material:
  `UNIQUE (tenant_id, supplier_id, upper(regexp_replace(invoice_no,'[\s\-/]','','g')),
  raw_material_id) WHERE transaction_type = 'grn' AND invoice_no IS NOT NULL`.
  Blocks the same material twice under one supplier invoice; permits multi-material.
- **UI warning (the real guard)**: on GRN confirm, if (supplier_id, normalised invoice_no)
  already exists under a DIFFERENT grn_no, warn "Invoice INV-123 was already received under
  GRN-0042 on 12 Aug" with an explicit override. This is the semantically correct rule and the
  one that catches the real-world case.

Normalisation must be byte-identical to `normaliseInvoiceNo()` in gstr2b-reconcile.html
(`str.replace(/[\s\-\/]/g,'').toUpperCase()`), or the guard and the 2B reconciliation will
disagree about what counts as the same invoice.

Schedule: Phase 3, or a standalone fix before E1 starts.

**2. Challan number length — BLOCKS E2 (AI Filing Package)**

**STATUS: FULLY RESOLVED (Session 11 + CA confirmed Sept 9 2026)**
CH-YYMMDD-NNNN (14 chars) confirmed compliant under Rule 55 by CA Sept 9 2026 —
alphanumeric + hyphens valid, fits Rule 46(b)/55 16-char cap, E-Way Bill portal compatible.
RPC fallback already correct on all tenants. chk_challan_number_length NOT VALID constraint
in place. Rolled out to all live tenants. No longer a blocker. Original diagnosis preserved
below for reference.

`CHAL-YYYYMMDD-NNNN` is 18 characters, exceeding the Rule 46(b)/55 16-character cap. It also
breaks `challanSeriesKey()` (export.html:1377), whose `/^(\D*)(\d+)$/` regex cannot parse a
format with digits in the middle — it returns null and the rows are filtered out, so legacy
`CHAL-` challans are silently dropped from series and gap logic. The filing package's `docs`
sheet (GSTR-1 Table 13) is built from exactly that logic, so the document register would be
quietly wrong for any tenant holding legacy rows.

Generated at `20260901_fix_insufficient_stock_message.sql:82`, reachable only via the fallback
branch (all three UI paths pass an explicit p_challan_number). `p2_dispatch_orders.challan_number`
has no length CHECK.

Fix: shorten the fallback format (e.g. `CH-YYMMDD-NNNN`, 14 chars) AND fix the
`challanSeriesKey()` parser to handle an embedded date segment so historical rows are counted.
Both, not either. Add `CHECK (length(challan_number) <= 16)`.
Run first, per live tenant, to size the exposure:
`SELECT count(*), max(length(challan_number)) FROM p2_dispatch_orders WHERE challan_number LIKE 'CHAL-%';`

Schedule: before E2 build starts.

**3. B2CL threshold — FIXED (Sept 9 2026)**

Confirmed ₹1 lakh per Notification 12/2024 (effective Aug 1 2024) by CA Sept 9 2026.
B2CL_THRESHOLD in export.html updated from 250000 → 100000. No longer a blocker for E2.

**4. PVT LTD incorporation + code-signing certificate — BLOCKS E1**

Without a signed Windows installer, SmartScreen blocks every Bridge Agent install and E1 cannot
be deployed in practice. An OV/EV certificate requires a registered legal entity with verifiable
identity, so incorporation is a technical prerequisite for E1, not only a commercial one for
contracting with PVT LTD clients.

Schedule: incorporation runs in parallel now, blocks no build phase
(`_ai/enterprise-strategy.md` §5). Order the certificate the week incorporation completes.

**5. s.143 clock from principal_challan_date — FIXED (Session 8, Sept 8 2026, commit 969cb3a)**

Was: the clock started from `dispatch_date` (KPML's send date), not `principal_challan_date`
(the vendor's receive date). See "Shipped Sept 8, 2026 — Session 8 (Phase 3)" above —
`js/s143-clock.js`'s `computeS143Clock()` now does `clockStart = row.principal_challan_date ||
row.transaction_date`, and both `principal-dashboard.html` and `itc04-workingpaper.html` pass
`principal_challan_date` through to it. Re-verified Sept 9 2026 (Session 12): all three call
sites confirmed correct, no code change needed.

**Session 16 follow-up — Datta Prasad data quality**

Opus covering note (Sept 10 2026) surfaced the following in Datta Prasad's August
data that need owner action before October filing:
- 78 dispatch challans to KPML marked 'sale' with no corresponding sales invoices.
  Tax invoices must be raised before GSTR-1 can be filed.
- 15 GRN lines recorded at 0% GST against identical 18% goods — likely capture
  errors, ITC reconciliation with GSTR-2B at risk.
- 1 orphan GRN (27 Aug, 50 units STATOR STACK KS100-4P CL200) with no supplier
  name and no invoice number.
- 623 materials with no HSN audit, 50 dispatched items with no HSN code.
These are workflow/data-entry issues, not Nexflow bugs. Flag to Datta Prasad
owner before October 5th cron run.

**6. Consolidated invoice double-billing gap — NOT YET FIXED (found Sept 10 2026, invoices.html
audit, Session 17)**

`confirmConsolidatedInvoice` (agent-query/index.ts)'s cross-mode double-billing guard only checks
already-billed dispatches against **single**-mode invoices (`.eq('invoice_mode', 'single')`). It
never checks against other **consolidated** invoices' `dispatch_order_ids`. Two consolidated
invoices for the same client with overlapping-but-not-identical date ranges (e.g. Jan 1–15, then
Jan 10–31) each independently sweep confirmed dispatches in their own window — a dispatch
confirmed Jan 12 lands in both, fully double-billed, no error, no warning. The DB's
`p2_invoices_consolidated_dedup_idx` unique index only blocks an exact repeat of `(tenant_id,
client_id, date_from, date_to)`, so it does not catch this. Distinct from the already-fixed F3
(job-work-purpose leaking into the sweep). Same applies symmetrically to `previewConsolidatedInvoice`
(no such check there either, so the preview itself won't warn before the owner confirms).
Fix direction (not yet built): before insert, check `dispatch_order_ids && orderIds` overlap
against every other non-cancelled invoice_mode='consolidated' row for the same client, not just
exact date-range matches.

**7. No DB uniqueness constraint on invoice_number — NOT YET FIXED (found Sept 10 2026, same audit)**

`p2_invoices` has unique indexes on `dispatch_order_id` and `invoice_token` only — nothing
enforces `invoice_number` uniqueness at the DB level, not even per-tenant. Correctness today
relies entirely on `get_next_invoice_number`'s row-locked `p2_tenant_settings.invoice_sequence`
counter never being hand-edited backward (a routine direct-SQL-Editor pattern elsewhere in this
codebase per the RLS-fix history above). If that counter is ever reset/edited, two invoices could
silently share one `invoice_number` for a tenant with nothing in the schema to catch it. Fix
direction (not yet built): `CREATE UNIQUE INDEX ON p2_invoices (tenant_id, invoice_number)`.

**8. Challan line-item editing — Product Roadmap**

Requested by Datta Prasad (Sept 10 2026).
Owners need to add or remove individual line items on a confirmed dispatch challan without
deleting and recreating the whole challan.

Add a line: dispatch an additional product/material, consume stock from ledger, increment the
challan line count, reflect in invoice.
Remove a line: insert a stock reversal transaction (append-only ledger — never delete the
original consumption row), remove the line from the challan display.

Hard rules:
- Only allowed on challans with `status='confirmed'` AND no linked invoice (`dispatch_order_ids`
  not referenced in any `p2_invoices` row). Once invoiced, the challan is locked — editing would
  mismatch the invoice. Show a clear error if the owner tries to edit a locked challan.
- Stock check required before adding a line — same fail-closed check as
  `confirm_dispatch_transaction`. Insufficient stock = hard block.
- Reversal transaction must reference the original `dispatch_order_id` so the audit trail is
  complete.
- Challan number does not change on edit — the document stays the same challan, just with
  corrected lines.

UI surface: `challan.html` detail view — "Edit Lines" button, visible only when the challan is
unlocked (no invoice). Opens an inline edit mode with add/remove per line.

Backend: new RPC or new `body.action` handler on `agent-query` — `add_challan_line` /
`remove_challan_line`. Do not modify `confirm_dispatch_transaction`.

Schedule: post-KPML meeting, own session.

**9. Staff activity log — created_by columns — Product Roadmap**

Requested by PVT LTD owner (Sept 10 2026).
Owners need visibility into who did what in the software — which staff member confirmed a GRN,
created a dispatch, generated an invoice.

`p2_dispatch_orders.created_by` ALREADY EXISTS but holds `tenant_id` not `user_id` (written as
`tenantId` at `dispatch.html:1047`, `rm-dispatch.html:1043`) — needs a write-path fix, not
`ADD COLUMN`.
`p2_stock_transactions`, `p2_invoices`, `p2_dispatch_items` — confirm column existence before
adding anything.
Join target is `p2_user_roles`, NOT `p2_staff` (that table does not exist).

Infrastructure needed:
- Fix the write path on `p2_dispatch_orders.created_by` so it records `auth.uid()`, not
  `tenantId`. Decide a backfill policy for existing rows (or leave them NULL — no retroactive
  attribution is possible for past rows).
- Confirm whether `created_by uuid REFERENCES auth.users(id)` already exists on
  `p2_stock_transactions`, `p2_invoices`, `p2_dispatch_items` before writing any migration; add
  it (nullable, no backfill) only where it is actually missing.
- Populate `created_by` at action time from `auth.uid()` in the relevant RPC or Edge Function
  call site. One call site per table.
- New view or query: `v_p2_activity_log` joining the above tables with `p2_user_roles` (email,
  role) on `created_by`, ordered by `created_at desc`. Filterable by staff member, action type,
  date range.

UI surface: new "Activity" tab in `settings.html` (owner-only). Shows a filterable table:
Date | Staff Member | Action | Details.
No new page needed — `settings.html` tab pattern already established.

Schedule: post-KPML meeting, own session. One session.

**10. Razorpay — deferred to 50+ clients [DECIDED Sept 11 2026]**

Payments are manual bank transfers confirmed by the founder via direct SQL
(`UPDATE p2_tenant_settings SET plan='pro' WHERE tenant_id='...'`). `grep -ril razorpay`
returns zero matches — there is no webhook, no subscription table, no payment event log and no
plan-expiry field anywhere in the codebase.

Razorpay integration is deferred until all three are true:
- PVT LTD incorporation complete — Razorpay KYC binds to the legal entity (PAN, bank account,
  business proof), all of which change at incorporation
- Manual payment management takes >3 hours/month
- ~50+ clients

At current scale manual confirmation takes <5 minutes per payment. Building against the
proprietorship means doing the integration twice and migrating live subscriptions between two
merchant accounts. Setup fees are collected manually anyway — one consistent process.

Note on the fee argument: Razorpay's ~2% is 2% of revenue at every scale (₹1,392/month at 10
clients, ₹9,580/month at 50). As a share of the cost base it *rises* with the book — 6.6% at 10
clients, 18.2% at 50 — so fee ratio is not a reason to defer. The entity binding is.
See `_ai/business-strategy.md` §9.3.

Revisit at 50 clients. Source: `_ai/automation-strategy.md` §1 finding 2, §4.5.

**11. New MD files added Sept 11 2026**

- `_ai/tutorial-engine.md` — guided tutorial system design, 1,329 lines, designed not yet
  built. Read in full before any tutorial session.
- `_ai/automation-strategy.md` — 8 operational automations (A0–A8), 2,281 lines. Wave 0
  (A0 + A6) carries a hard October 5 2026 deadline. Read before any automation or ops work.
- `_ai/business-strategy.md` — costs, margins, exit strategy, revenue projections, competitive
  moats, distribution and hiring strategy. Read before any pricing, hiring or commercial
  decision.
- `_ai/bridge-agent.md` — Bridge Agent (E1) full build spec: Tally XML contract, the canonical
  REMOTEID scheme, `p2_tally_targets` / `p2_tally_sync_log` / `p2_ca_grants`, security model,
  failure analysis, installer, code signing, CA profile. ~3,400 lines, designed not yet built.
  **Read in full before Session 18 or 19.** Load order for a Bridge Agent session:
  `_ai/CLAUDE.md` → `_ai/bridge-agent.md` → `_ai/enterprise-strategy.md` §3.1 → `js/full-export.js`.
  Carries five `[CORRECTION]` items in its §0 that supersede text in this file and in
  `enterprise-strategy.md` — in particular: **EV code-signing certificates no longer bypass
  SmartScreen** (Microsoft removed that in 2024, so Known Open Items #4 above overstates what the
  certificate buys, and OV is the right purchase), and **a confirmed dispatch must never produce a
  Sales voucher** (sync is driven from `p2_invoices` only). §6.5 also replaces the
  `full-export.js` REMOTEID warning below with a legacy-adoption mechanism, so a client who
  hand-imported `vouchers-FY….xml` gets zero duplicates.

Load order for a session touching any of these: `_ai/CLAUDE.md` → the relevant strategy file →
the target source file. `_ai/enterprise-strategy.md` remains the Enterprise build spec.

**12. Exit tax structure — urgent CA consultation needed**

Current assumption: 20–23% effective LTCG tax on a PVT LTD share sale
(`_ai/business-strategy.md` §5.3). **This may be wrong** — the unlisted-share LTCG regime
changed in Budget 2024. On a ₹400Cr exit the difference is ₹60–80Cr.

Additionally: the holding-period clock starts when shares are issued. Every month before
incorporation is a month of holding period lost.

Action — consult a CA this week on:
1. The current LTCG rate for unlisted PVT LTD shares
2. Optimal shareholding structure before the first additional director is added
3. The exact date incorporation should happen to maximise LTCG treatment at exit

**Do not issue any shares until this is answered.** Interacts directly with
`_ai/enterprise-strategy.md` §9 Q13 (who is the second director, and what do they hold) — that
question sits on the SPICe+ Part B form, so it cannot be deferred past incorporation.

**13. Blank invoice rate persists as ₹0 — no validation on either side**

`[BUG]` `[COMPLIANCE]`, High. Source: `codebase-audit.md` priority list #7.
Location: `all-dispatch-history.html:916`; `agent-query/index.ts:2238-2241`, `:2363`.
A blank rate in the Generate Invoice modal is not blocked client-side or server-side — it
silently persists as ₹0 on a legally-formatted tax invoice. Needs validation at both the modal
submit and `confirmGenerateInvoice`/`confirmConsolidatedInvoice`.

**14. `v_p2_supplier_advance_balance.total_drawn` sums every GRN ever, not since the advance**

`[BUG]`, High. Source: `codebase-audit.md` priority list #9.
Location: `20260902_create_supplier_advances.sql:74-81`.
A new advance against a supplier with existing GRN history reads as massively overdrawn
immediately — `total_drawn` is an all-time sum, not scoped to GRNs recorded since the advance.

**15. Failed confirm burns a challan number — `rm-dispatch.html` / `production-issue.html`**

`[COMPLIANCE]` `[BUG]`, High. Source: `codebase-audit.md` priority list #11.
Location: `rm-dispatch.html:1134`; `production-issue.html:1541`, Cancel path at `:1573-1577`.
`dispatch.html`'s equivalent bug was fixed (draft mode removed, Session 2) but the same pattern
survives on the other two dispatch pages.

**16. `get_next_challan_number` may produce duplicates under concurrency `[UNVERIFIED]`**

`[COMPLIANCE]` `[BUG]`, High. Source: `codebase-audit.md` priority list #12.
Location: live source unavailable — `20260822_challan_next_override.sql:2` documents
`GREATEST(MAX+1, floor)`; stale copy at `sql/get_next_challan_number.sql`. Needs a `pg_proc`
inspection in the SQL Editor to confirm the live function is a row-locked counter, not a plain
MAX+1 read.

**17. `rm-dispatch.html` unchecked `.delete()` duplicates challan line items**

`[BUG]`, High. Source: `codebase-audit.md` priority list #15.
Location: `rm-dispatch.html:1057-1060`, `:1173-1176`.

**18. No server-side role check on invoice write handlers**

`[SECURITY]`, High. Source: `codebase-audit.md` priority list #19.
Location: `all-dispatch-history.html:316-328`, `:632`; `agent-query/index.ts:227-251`.
Operator can generate tax invoices — the gate is plan-only. `verifyCallerTenant` checks tenant
but not role. The Session 6 P1 role-gate fixes (cancel/amend challans, GST export download,
etc.) were client-side page gates only and did not cover this handler.

**19. `check-low-stock` is an unauthenticated all-tenant Telegram fan-out**

`[SECURITY]`, High. Source: `codebase-audit.md` priority list #23.
Location: `supabase/config.toml` (`verify_jwt = false`) + no auth inside
`check-low-stock/index.ts`. Fix direction: a shared-secret header on cron jobids 2, 3, 8, 9
(~1 hour).

**20. Notification pipeline: 6 silent-failure points, zero retries**

`[BUG]`, High. Source: `codebase-audit.md` priority list #28.
Location: `js/notifications.js:25`, `:31`; `notify/index.ts:112-121`, `:125-137`; call sites
`dispatch.html:1170`, `production-issue.html:1615`, `rm-dispatch.html:1229`. Quiet hours also
writes `status='failed'` for a notification that was postponed, not failed — the three-value
CHECK has no room for a correct value.

**21. `get-user-email` returns any user's email to any authenticated caller**

`[SECURITY]`, High. Source: `codebase-audit.md` priority list #29.
Location: `supabase/functions/get-user-email/index.ts:33-36`. Cross-tenant email disclosure —
any authenticated user of any tenant can look up any other user's email.

**22. Tall modals clip their submit button off-screen at 390px**

`[UX]` `[BUG]`, High. Source: `codebase-audit.md` priority list #32.
Location: `.nx-modal` has no `max-height` — `invoices.html:34-40`,
`all-dispatch-history.html:26-31`, worst on the Generate Invoice modal. Fix direction: move
`.nx-modal` into `css/nexflow-design.css` with `max-height: 90vh; overflow-y: auto` and delete
the six per-page copies.

**23. Telegram HTML injection kills the whole morning digest**

`[BUG]`, Medium. Source: `codebase-audit.md` priority list #35.
Location: `check-low-stock/index.ts:63-70` with raw interpolation at `:449`, `:498`,
`:518-521`. A material/client name containing HTML-significant characters breaks Telegram's
parse_mode and the entire digest silently fails to send.

**GRN duplicate DB index** — already tracked as Known Open Items #1 above (partial unique index
on `p2_stock_transactions`); confirmed present in this document, not duplicated here.

## What to build next (priority order)

**CRITICAL CONTEXT (Sept 11 2026):**
The October 5, 6, and 7 filing package runs are not just an ops task — they are the primary
distribution event that determines whether the first CA referrals arrive in March 2027 or slip
to late 2027. A6 (filing package dispatcher + drain queue) is a sales dependency, not an
infrastructure nicety. If A6 is not built before October 5, the March 2027 first-referral
target is at risk. Build item 0, then A0, then A6. Nothing else until all three are done.

Reconciled Sept 11 2026 (`_ai/md-audit-report.md` C1) — A-series and numbered sessions are one
single sequence, 32 items, in the order below. The sprint brief's "31 sessions" count excludes
item 0 (the live-tenant migration), which was missing from every prior list.

### IMMEDIATE — before October 5 2026

0. **Apply Session 15's filing-package migrations to all 3 live tenants** (SS Engineering,
   Datta Prasad, Shivprasad) — without `filing_recipient`/`accountant_email`/
   `filing_package_enabled` and a `p2_filing_packages` row, the October 5 cron either errors or
   silently returns nothing for them. See Session 15 above and `_ai/md-audit-report.md` C7.
1. **Session A0 — Founder ops channel** (0.5 session)
   `p2_ops_alerts` table, `supabase/functions/_shared/ops.ts`, `opsAlert()`,
   `FOUNDER_TELEGRAM_CHAT_ID` secret, `/ack` branch on `telegram-webhook`.
   The secret must be set by hand — Claude cannot read Edge Function secret values back
   (`supabase secrets list` returns digests only), same manual step as `setWebhook`
   registration. If it is unset, `opsAlert` still writes the row with
   `error_reason = 'no_founder_chat_id'` so the misconfiguration is visible.
2. **Session A6 — Filing package dispatcher + drain queue** (1 session)
   `p2_job_queue` table, `dispatch` mode, drain cron every 2 min on the 5th–7th, replacing the
   sequential loop. Claim with `FOR UPDATE SKIP LOCKED`.
   Measure the October 5 run timing and write the real number into
   `_ai/automation-strategy.md` — §3.3 carries the SQL and the open question (Q1).

### AFTER KPML MEETING — Oct–Nov 2026

3. Session A2 — Compliance monitoring (1.5 sessions)
4. Session A3 — Daily digest (1 session)
5. Session A4 Phase 1 — Support relay (1.5 sessions)
6. Session T1 — Tutorial engine + dispatch (English)
7. Session P1 — Product polish (`_ai/product-polish-p1.md`)
8. Challan line editing (1 session) — Known Open Items 8
9. Staff activity log (1 session) — Known Open Items 9
10. Double-billing fix on overlapping consolidated invoices — Known Open Items 6

### PRE-KPML VENDOR WAVE — Dec 2026 – Feb 2027

11. Session A1 — Onboarding ingestion (3–4 sessions, `_ai/onboarding-engine.md`).
    **Must precede the vendor wave** — 20 vendors at 3–6 founder-hours each is 60–120 hours
    that do not exist during a pilot.
12. Session T2 — Marathi + mobile + GRN

### POST-INCORPORATION

13. Session A5 — Billing reminders (manual trigger, no Razorpay)
14. Session A7 — Provisioning (manual trigger)
15. Session T3 — Tutorial coverage + demo mode
16. Session A8 — Codebase health (50+ clients)
17. Session 18 — E1 Bridge Agent factory profile (`_ai/bridge-agent.md`)
18. Session 19 — E1 Bridge Agent CA profile (`_ai/bridge-agent.md`)
19. Session 20 — Credit/Debit Notes (`_ai/credit-debit-notes.md`)

### KPML PILOT LIVE

20. Session 21 — KPML cross-tenant upgrade (`_ai/kpml-network-sessions-21-22.md`)
21. Session 22 — Principal write access (`_ai/kpml-network-sessions-21-22.md`)
22. Session 23 — Notification Centre v2

### COMPLIANCE COMPLETE

23. Session A4 Phase 2 — KB-backed support agent
24. Session 24 — Supplier Payables Register (`_ai/supplier-payables-register.md`)
25. Session 25 — GSTR-2B server-side storage (`_ai/gstr2b-server-storage.md`)
26. Session 26 — Audit trail + partnership polish
27. Session A5 + A7 — Razorpay integration (gate is 50+ clients — Known Open Items 10)

### NETWORK FEATURES — named client request only

28. Session 27 — Job work agreement record
29. Session 28 — PO Push
30. Session 29 — Rejection at gate + rework
31. Session 30 — Yield variance
32. Session 31 — Dispute register

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
- Step 3.5 — COMPLETE (02 Sept 2026): Supplier Advance Ledger. New tab in invoices.html.
  p2_supplier_advances table, v_p2_supplier_advance_balance view (fan-out safe,
  security_invoker=true, explicit get_my_tenant_id() filter in every subquery).
- Step 4 — COMPLETE (Aug 31 2026): p2_notifications table, notify + telegram-webhook Edge
  Functions, js/notifications.js, in-app bell (js/navbar.js), Telegram deep-link binding +
  quiet hours (settings.html), payment_overdue_notify cron (jobid 8). check-low-stock-instant
  was retired separately, as part of the agent redesign (see "AI Agent — Architecture" above
  and "Proactive Telegram layer" note) — not part of Step 4 itself. See "Shipped
  Aug 31, 2026" for full detail. Deferred to post-Step-5: Notification Centre v2
  (notifications.html, Gmail-style, Telegram deep link) — see Backlog.
- Step 5 — REVISED: One-sided mode is no longer the priority. Three KPML vendors (SS Engineering,
  Datta Prasad, Shivprasad) are already live on Nexflow. Build target is a KPML read-only principal
  dashboard instead — their material at each vendor, s.143 clock status, reconciliation gap. Full
  principal-side write access follows after KPML meeting.
- Step 6 — cross-tenant upgrade + scoped access path
- Step 7 — gated on named requests only

Step 0 decisions locked:
- Job work confirmed for all three clients (not purchase-and-sale)
- p2_tenants exists and is load-bearing
- s.143(2) obligation is the principal's (KPML), not the job worker's
- SAC 9988 job charges only on vendor invoices to principal
- confirm_bom_issue pool-blind fix is Step 2 prerequisite #1
- Mother-factory pricing: [DECIDED Sept 11 2026] — see §Pricing above, "Principal account —
  KPML model"

Sales strategy:
- Pitch new clients (job workers) during Step 1 and Step 2
- Never stop selling while building
- Pitch to new job worker vendors: "Your principal will ask you for stock numbers,
  challan records and payment history. Today you cannot answer in less than a day.
  With this you answer in ten seconds and never get accused."

## Backlog — Deferred Features

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

### Return Dispatch Pool Fix (CRITICAL — do first)
dispatch.html must pass the correct p_owned_by to confirm_dispatch_transaction
for job_work_return, unused_material_return, scrap_return movements.
Currently the parameter is never passed at all, so it defaults to null → deducts
from own stock instead of principal's pool.
Source for p_owned_by: p2_challan_links → original_dispatch_id →
p2_dispatch_orders.owned_by. If no link, require user to select principal from dropdown.

### Physical Stock Count (follow-ups)
Core screen SHIPPED Sept 6, 2026 — see "Shipped Sept 6, 2026 — Session 7 (Phase 1)" above.
Remaining items, none blocking:
- Blind count mode (hide system qty to prevent anchoring bias) —
  build only when a client explicitly requests it.
- Count history screen (who ran what count, when) — build when asked.
- Scanner-driven counting (barcode → count field) — natural next step
  after scanner.html field usage is confirmed.
- Known limitation: system qty is a point-in-time snapshot from when
  the overlay opens. A GRN or dispatch posted during a long count
  session will make system qty appear stale. The posted adjustment
  corrects for it. Document to clients if they notice.

### ITC-04 Working Paper Export
The CA channel unlock. Makes a CA recommend Nexflow to every factory client.
Format: flat Excel, one row per challan line, paste-ready into GSTN utility.
Sheet 0: reconciliation summary + ageing (the product — two days of CA work in
10 minutes). Sheets 1–4: Table 4, 5A, 5B, 5C paste-ready.
Prerequisites already built: p2_challan_links, principal_challan_no/date, UQC codes,
s.143 clock from principal_challan_date (Session 8).
Still needed: pre-export validation screen.

### Principal Material Passbook
The KPML demo closer. Per-principal, per-material ledger showing:
In (with KPML challan no + date), Out (consumed against which production order),
Returned (on which return challan), Balance remaining, s.143 clock per lot.
Exportable as ITC-04 working paper for that principal.
70% built: ownership columns, s.143 clock, consumption path all exist.
Missing: passbook screen itself.

### Supplier Payables Register
p2_supplier_advances tracks advances paid. Missing: a payables register showing
what the factory owes its MSME suppliers, days outstanding, 43B(h) breach risk.
The actual 43B(h) legal risk is on payables (who you owe) not receivables (who owes you).
The 43B(h) surface in export.html currently measures receivables — placeholder only.

### Credit/Debit Notes
Monthly event — returned goods, price corrections, short deliveries.
No path today except cancel and re-raise (breaks invoice sequence, confuses CA).

### KPML Read-Only Principal Dashboard (Step 5 — build October 2026)
One screen. KPML logs in, sees their material across all three vendors.
Per-vendor, per-material: current stock balance, s.143 clock status, reconciliation gap.
New tenant type: principal account (is_principal = true, is_job_worker = false).
This is the KPML demo. Build before the November meeting.
Dependencies: Session 4 pool tabs (done), return dispatch fix (pending).

### send_challan / send_invoice / send_tally_export (Pro-only restore)
Already tracked as "intentionally deferred" under AI Agent — Architecture above.
Restore as Pro-only agent intents, gated on plan === 'pro' || plan === 'founder',
same canRecordPayment pattern. Do not restore without the plan gate.