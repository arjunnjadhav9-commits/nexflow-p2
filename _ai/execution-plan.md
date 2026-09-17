---
name: execution-plan
description: Nexflow master execution plan — what the product is becoming, current state, locked pricing, the complete ordered session list from A0 to Session 31 with load orders and gates, Claude Code usage rules, parallel tracks, milestones, and the exit story. Read this file first, every morning, before starting any session.
sources: [CLAUDE.md, business-strategy.md, automation-strategy.md, nexflow-agent.md, factory-os.md, nexflow-intelligence.md, bridge-agent.md, tutorial-engine.md, nexflow-mcp.md, p1-factory.md, onboarding-engine.md, product-polish-p1.md, supplier-payables-register.md, kpml-network-sessions-21-22.md, md-audit-report.md]
last_updated: 16 September 2026
status: living document — update in place. This file replaces every build order pasted into a chat.
---

# Nexflow — Execution Plan

**This is the file you read at 8am before starting a session.** It tells you what to build, in
what order, with which files loaded, and what has to be true before it ships.

**Every session starts by reading this file.** Nothing else is the build order. `CLAUDE.md`'s
"What to build next" is the source this was reconciled from and stays authoritative on codebase
facts; where the two disagree on *order*, this file wins.

---

## 1. What Nexflow Is Becoming

Nexflow is the operating system for a MIDC factory. Not an inventory tracker with AI bolted on —
a system where the factory owner describes what happened, or photographs the paper that says what
happened, and the software resolves it against their real materials, BOMs, clients and stock,
shows them exactly what it will do, and writes it on one confirmation. Four layers sit on one
Edge Function: a **read layer** that answers questions about the factory (live), a **write layer**
that executes transactions from a sentence (designed), **Factory OS** that adds production orders,
workers, progress and quality — the transactions the factory actually runs on and that no
inventory product has (designed), and an **Intelligence layer** that aggregates the tenant's own
rows in Postgres and answers business questions the owner currently guesses at (designed).
Underneath all four is the thing that makes it defensible: every statutory surface a job-work
factory needs — s.143 clocks, ITC-04 working papers, GSTR-1 Table 12/13, GSTR-2B reconciliation,
43B(h) exposure, a monthly filing package their CA opens and trusts — built from the same rows,
and eventually written straight into the client's own Tally through the Bridge Agent. The forms
stay; they become the fallback. That is the difference between a better form-based system and a
different category of product, and it is the whole thesis.

**P1 and P2 are the two halves of the complete product.** P2 covers everything that touches money,
stock, GST, and the CA — it is what is built today. P1 covers everything that happens on the
factory floor — production orders, worker assignment, attendance, payroll, machines, scrap,
visitors, assets, energy, safety. **P1 Part 1** (`factory-os.md`) is designed and ready to build.
**P1 Part 2** (`p1-factory.md`) is designed and triggered by validation. **P1 + P2 = Nexflow
Factory OS.**

---

## 2. Current State — as of 13 September 2026

### Revenue

| Client | Plan | Terms | Status |
|---|---|---|---|
| **SS Engineering** | Founder (`plan='founder'`) | **Free, permanently. Never changes.** `[DECIDED]` | Live, ₹0 |
| **Datta Prasad Enterprises** | Converting to Pro | **₹1,35,000 upfront** (₹35K setup + ₹1,00,000 Year 1). 3-year no-increase guarantee after Year 1. | Payment was due **10 Sep 2026**. `plan` stays `'founder'` in the DB until money lands, then `UPDATE p2_tenant_settings SET plan='pro'` — `agent_tier` stays `'standard'`. **Confirm receipt before quoting this as revenue.** |
| **Shivprasad Industries** | Founder, assumed Pro | ₹1,00,000/yr, same 3-year lock `[UNVERIFIED]` | **Terms are recorded nowhere.** `business-strategy.md` §10 Q7: confirm and write into `CLAUDE.md` in the same shape as Datta Prasad's entry before the next revenue figure is quoted to anyone. |

**Three live clients. Two of them paying. ₹2,00,000/year recurring = ₹16,667/month** — and one
third of that is `[UNVERIFIED]`.

### Burn

**₹16,750/month total run cost at 3 clients** (`business-strategy.md` §3.1, `[VERIFIED]`):

| Line | ₹/month |
|---|---|
| Infrastructure (Supabase Pro $25, storage, domain) | 2,650 |
| Development (**Claude Max $100 — 54% of the whole bill**) | 9,000 |
| AI running costs | 250 |
| Founder hidden costs (travel, CA fees, phone, equipment) | 4,850 |
| PVT LTD compliance | 0 |
| **Total** | **16,750** |

### Cash runway

**Net recurring burn is ₹83/month.** ₹16,667 in, ₹16,750 out — break-even, not the 17.6% margin
`business-strategy.md` §3.1's 3-client column shows, because that column assumes a third paying
subscription and SS Engineering is free forever (§3.6 `[CORRECTION]`).

**Runway in months cannot be stated, because no document in the set records a cash balance.**
What *can* be stated, and matters more: **there is no burn to run out of.** Datta Prasad's
₹1,35,000 alone covers eight months of total run cost. Fixed costs stay at ₹21,050/month even at
10 clients. `business-strategy.md` §4.3: *"There is no cash burn problem, at any point, in any
scenario in this document."* The downside is time, not money.

> **Action:** write your actual bank balance into this section. Until then the only honest
> statement is the structural one above.

### What is built

| # | Session | Shipped | What |
|---|---|---|---|
| 1–4 | Sessions 1–4 | 3–4 Sep 2026 | RLS/security (`set_tenant_id()` trigger fix, 13 tables' write policies, view RLS), financial accuracy, compliance gaps (UQC, `p2_challan_links`, tooling register), structural gaps (`v_p2_stock_balance_by_owner`) |
| 5 | Session 5 | 5 Sep 2026 | Return dispatch pool fix, `separate_pool_deduction`, pool dropdowns |
| 6 | Session 6 (Phase 0) | 5 Sep 2026 | Role/permission audit, P0 GSTR-1 invoice compliance holes |
| 7 | Session 7 (Phase 1) | 6 Sep 2026 | Physical stock count screen |
| 8 | Session 8 (Phase 3) | 8 Sep 2026 | s.143 clock from `principal_challan_date`, ITC-04 working paper export |
| 9 | Session 9 (Phase 2) | 8 Sep 2026 | KPML principal dashboard, `p2_network_links`, `get_principal_vendor_material()` |
| 10 | — | — | Scope absorbed into Session 11 |
| 11 | Session 11 | 9 Sep 2026 | KPML demo blockers, dashboard v2 (vendor list → detail), `get_principal_vendor_invoices()` |
| **12** | **Session 12** | **9 Sep 2026** | **✅ s.143 clock verification + GRN duplicate invoice guard** |
| **13** | **Session 13 (E4)** | **9 Sep 2026** | **✅ One-click full export** |
| **14** | **Session 14 (E3)** | **9 Sep 2026** | **✅ AI HSN audit tool** |
| **15** | **Session 15 (E2 pt 1)** | **9 Sep 2026** | **✅ Monthly AI filing package — pipeline, `p2_filing_packages`, cron** |
| **16** | **Session 16 (E2 pt 2)** | **10 Sep 2026** | **✅ Opus covering note** |
| **17** | **Session 17 + strategy** | **11–14 Sep 2026** | **✅ Invoice number format; 13 design documents written** |

Plus: challan/invoice generation, consolidated invoices, payment ledger, supplier advances,
notifications + Telegram, 28 read intents on the agent, GSTR-2B reconciliation, CA/Tally/Zoho
exports, QR receive flow, scanner, physical stock count, ITC-04.

### What is not built

Everything in §4 from item 1 onward. Concretely, and in order of how much it matters:

- **A0 and A6** — the founder ops channel and the filing-package queue. **Three weeks late is
  fatal; see below.**
- **The agent write layer** (`nexflow-agent.md`) — 6 sessions. The moat that changes what the
  product is.
- **Factory OS** (`factory-os.md`) — 6 sessions. The transaction the factory runs on.
- **The Intelligence layer** (`nexflow-intelligence.md`) — 6 sessions.
- **The Bridge Agent** (`bridge-agent.md`) — Sessions 18–19. Blocked on incorporation for
  *deployment*, not for build.
- **The tutorial engine** (T1–T3), **onboarding ingestion** (A1), **the MCP server** (M1–M6),
  **compliance monitoring** (A2), **the daily digest** (A3), **support** (A4), **billing and
  provisioning** (A5, A7), **codebase health** (A8).
- **Sessions 20–31** — credit/debit notes, KPML cross-tenant upgrade, notification centre v2,
  supplier payables, GSTR-2B storage, audit trail, and the five network features gated on a
  named client asking.
- **Product polish P1** — a submit button a user physically cannot reach on a 6-item invoice.

### The October 5 deadline — why it is non-negotiable

The `filing-package-monthly` cron fires `30 2 5 * *`. `filing_package_enabled` defaults to
`true`. **5 October 2026 is the first production run across live tenants**, and today nothing
watches it.

Three things make the date a hard gate rather than an ops task:

1. **The failure is silent.** `filing-package/index.ts` processes tenants strictly sequentially
   inside one invocation (`for (const tenant of tenants)`, line 2060), 45–90 seconds each.
   Somewhere between ~20 and ~60 tenants the invocation is killed mid-loop and the tenants after
   the cutoff get **nothing** — no `p2_filing_packages` row, no `failed` status, no
   `error_reason`. Nothing keyed on `status='failed'` can detect them, because the evidence of
   the failure is the absence of the evidence.
2. **Nothing can report it even if it were detected.** Every Telegram path in the codebase
   resolves `telegram_chat_id` from `p2_tenant_settings` — tenant-scoped by construction. There
   is no route that reaches you. That is A0.
3. **It is the only path to March 2027.** `business-strategy.md` §7.1: a CA who receives **three
   clean monthly packages** refers. October, November and December are those three. The
   Tally-integration channel cannot deliver three clean CA months before ~August 2027. **If the
   October–December runs are not clean, the first referral does not happen in March 2027 and the
   happy path slips a year at its steepest segment (10 → 100 clients).** A6 is the cheapest
   ₹1.3 Cr of 2027 ARR available.

And the three live tenants have no `filing_recipient`, `accountant_email` or
`filing_package_enabled` columns yet. **That migration is item 0 and it is half a session.**

---

## 3. Pricing — Locked

All products live on one platform, one login. Each is complete and excellent on its own.
Together they form the Nexflow Operating System.

### Nexflow Inventory (P2)

Entry point. Any MIDC factory.

| Tier | Setup | Annual | Who |
|---|---|---|---|
| **Inventory Lite** | ₹20,000 | ₹56,000 – 75,000 | Basic stock + GRN + dispatch + challan. 250-material cap, 1 user |
| **Inventory Pro** | ₹35,000 | ₹1,25,000 – 1,50,000 | + Filing package + HSN audit + GSTR-2B + multi-user + unlimited materials |
| **Inventory Enterprise** | ₹60,000 | ₹1,60,000 – 2,00,000 | Pro + Bridge Agent (Tally auto-sync) |

**Sales line:** *"Your GST filing is automatic. Your CA gets a package on the 5th. Never worry
about compliance again."*

### Nexflow Production (P1)

Requires Inventory Pro minimum. Cannot be bought standalone.

| Tier | Setup | Annual | Who |
|---|---|---|---|
| **Production Lite** | ₹25,000 | ₹75,000 – 90,000 | Production orders + worker assignment + progress tracking + quality gates. P1 Part 1 only |
| **Production Pro** | ₹40,000 | ₹1,40,000 – 1,60,000 | Everything in Lite + attendance + payroll + machines + scrap + visitors + assets + energy + safety. Full P1. **GATE:** CA statutory confirmation required before payroll sessions |

**Sales line:** *"Your factory floor is digital. Every register replaced. Payslips calculated
correctly every month. Inspection report in 30 seconds."*

### Nexflow Agent

Requires Inventory Pro minimum.

| Setup | Annual | Included | Overage |
|---|---|---|---|
| ₹15,000 | ₹75,000 | 900 transactions/month | ₹4/transaction, quarterly, never blocks |

**Sales line:** *"Photograph the delivery challan. Say what to dispatch. One confirmation. Done."*

### Nexflow Intelligence

Requires Inventory Pro minimum.

| Setup | Annual | Included | Overage |
|---|---|---|---|
| ₹10,000 | ₹60,000 | 150 queries + 8 reports/month | ₹8/query, ₹40/report |

**Sales line:** *"Ask it a question about your own factory. Get a real answer in 10 seconds.
Generate an inspection report in 30 seconds."*

### Nexflow Operating System

All four products. One bundle. One price. Inventory Enterprise + Production Pro + Agent +
Intelligence.

| Setup | Annual | Monthly |
|---|---|---|
| ₹1,00,000 | ₹4,20,000 – 4,50,000 | ₹35,000 – 37,500 |

Discount vs buying separately: individual total ₹4,95,000. **Nexflow OS** saves ₹45,000 –
75,000/year against buying every product on its own.

**Sales line:** *"You are paying ₹98,000/month for people and software to run your factory.
Nexflow OS: ₹37,500/month. You save ₹60,500/month. That is ₹7,26,000/year back in your pocket."*

### KPML Principal — pricing `[DECIDED 11 Sept 2026]`

| | |
|---|---|
| **Platform fee** | ₹2,75,000/year, includes 20 vendors |
| **Pilot fee** | ₹75,000 one-time, credited to Year 1 |
| **Overage** | ₹5,000 – 6,000/vendor/year beyond 20 |
| **Vendor requirement** | Each vendor must have Inventory Pro minimum |
| **At 30 vendors** | ₹3,30,000 platform + 30 × ₹1,25,000 vendor subscriptions = **₹40,80,000/year** total Nexflow revenue from one KPML relationship |

### Free forever, every plan

One-click full export · AI HSN audit · MCP read tools · CA Tally (one CA per tenant).

**Never upsell these. Never gate these.**

### Never, permanently

- **Never charge the CA.**
- **Never discount the ₹25,000 Bridge Agent setup.**
- **Never bundle Enterprise into the Principal fee.**
- **Never accept bespoke custom builds.**
- **Never quote the OS price before Inventory has run cleanly for 60 days on that account.**

### Current clients

| Client | Plan | Terms |
|---|---|---|
| **SS Engineering** | Inventory Lite equivalent | Free permanently. Founder plan. Never changes |
| **Datta Prasad** | Inventory Pro | ₹1,35,000/year, 3-year rate lock. Short invoice format |
| **Shivprasad** | Inventory Pro (assumed) | ₹1,00,000/year, 3-year rate lock `[UNVERIFIED — confirm and record terms]` |

---

## 4. Complete Session List

**Units.** 1 session ≈ 1 build day unless the source document gives calendar time, in which case
that number is used and marked. Pilots are calendar time, not build time, and run in parallel
with other work.

**Load order principle.** Load only what directly affects this session's build decisions. Never
all 22 MD files. `_ai/CLAUDE.md` is always first and is often the *only* strategy file needed —
where a section is named, read that section, not the whole file.

**Status key.** ❌ Not started · 🔄 In progress · ✅ Done

---

### PHASE 0 — Shipped

Sessions 1–17. See §2 "What is built". **Sessions 12–17: ✅ Done.**

---

### PHASE 1 — Before 5 October 2026 · non-negotiable

| # | Session | What it builds | Why it matters | Days | Status |
|---|---|---|---|---|---|
| **0** | **Live-tenant filing-package migration** | Apply Session 15's migrations to SS Engineering, Datta Prasad, Shivprasad — `filing_recipient`, `accountant_email`, `filing_package_enabled`, a `p2_filing_packages` row each | Without it the 5 Oct cron selects on a column that does not exist on those tenants and either errors or silently returns nothing | 0.5 | ✅ Done. |
| **1** | **A0 — Founder ops channel** | `p2_ops_alerts`, `supabase/functions/_shared/ops.ts`, `opsAlert()`, `FOUNDER_TELEGRAM_CHAT_ID` secret, `/ack` branch on `telegram-webhook` | **Four automations (A2, A3, A6, A8) are dead code without it.** No route in the codebase reaches you | 0.5 | ✅ Done |
| **2** | **A6 — Filing dispatcher + drain queue** | `p2_job_queue`, `dispatch` mode, drain cron every 2 min on the 5th–7th, `FOR UPDATE SKIP LOCKED` claim, monitor crons at 04:30 and 08:30, `resend-webhook` bounce detection | Replaces the sequential loop that silently drops tenants past ~20. **This is the March 2027 referral date** | 1 | ✅ Done |
| **3** | **A8-drift — schema-drift guard** | The four-line `rowsecurity = false` check from `automation-strategy.md` §4.8 | Guards the most consequential bug class this codebase has actually shipped (RLS never enabled on 15 tables) | 0.03 | ✅ Done |

| # | Load order (fresh chat) | Prerequisites | Gate before it ships |
|---|---|---|---|
| 0 | `_ai/CLAUDE.md` → "Shipped Sept 9, 2026 — Session 15" only · `_ai/md-audit-report.md` C7 | None | Run the cron by hand against one live tenant and confirm a package lands. Do **not** wait for the 5th to find out |
| 1 | `_ai/CLAUDE.md` → "Proactive Telegram layer" + "Database Tables" · `_ai/automation-strategy.md` §3.1, §3.2 · `supabase/functions/notify/index.ts` · `supabase/functions/telegram-webhook/index.ts` | None | `opsAlert()` never throws · dedupe on `(source, dedupe_key)` works within the window · **the secret is set by hand** — Claude cannot read secret values back; if unset, `opsAlert` still writes the row with `error_reason='no_founder_chat_id'` so the misconfiguration is visible |
| 2 | `_ai/CLAUDE.md` → "Shipped Sept 9, 2026 — Session 15" · `_ai/automation-strategy.md` §3.3, §4.6 · `supabase/functions/filing-package/index.ts` | Item 0, A0 | Every `filing_package_enabled=true` tenant has a queue row for the period · no job `running` >30 min · no job `dead` unreported. **Measure the real October 5 wall-clock and write the number into `automation-strategy.md` §3.3 Q1** |
| 3 | `_ai/automation-strategy.md` §4.8 only | None | A table with RLS off fires a `critical` alert |

> **Build item 0, then A0, then A6. Nothing else until all three are done.** Nothing in any other
> document displaces them — not the agent write layer, not Factory OS, not Intelligence, not the
> MCP. Every one of those documents says so in its own build-sequence section.

---

### PHASE 2 — After the KPML meeting · Oct–Nov 2026

| # | Session | What it builds | Why it matters | Days | Status |
|---|---|---|---|---|---|
| **4** | **FIX-1 — Correctness fix block** | GRN duplicate-invoice partial unique index + UI warning · server-side role check on invoice write handlers · `invoice_total` → `invoice_date` + `status='sent'` · extract `_shared/s143.ts` and `_shared/compliance.ts` | Five prerequisites that four later documents each list separately. Doing them once is under a session; doing them three times is three | 1 | ✅ Done, DB index is deferred |
| **5** | **A2 — Compliance monitoring** | CBIC scan, `compliance-constants.json`, Haiku + Opus gate, ops alerts | The B2CL threshold was wrong in production for 22 months and was caught by a CA conversation, not by any process. ₹90/month, flat, forever | 1.5 | ✅ Done |
| **6** | **A3 — Daily operations digest** | Haiku digest to the founder channel | It is the **delivery surface** for A6 and A8. Building the reporters without the report leaves their output in a table nobody reads | 1 | ✅ Done |
| **7** | **A4 Phase 1 — Support relay** | Escalation + bug capture, KB starts accreting | Every month delayed is a month of answered questions not captured | 1.5 | ✅ Done |
| **8** | **T1 — Tutorial engine + dispatch (English)** | `js/tutorial-engine.js`, `tutorials/dispatch.tutorial.js`, `p2_tutorial_progress`, 12 `data-tutorial-target` attributes on `dispatch.html`, Settings selector | Data quality is a filing outcome. Also a **free audit of the dispatch flow** — it forces someone to walk every field and name it, which is exactly the inventory the write layer's resolver needs | 1 | ❌ |
| **9** | **P1 — Product polish** | Shared `.nx-modal` rule (six copies deleted), five feedback idioms → one, mobile at 390px, Marathi on the money pages, empty states, global search, CA features menu, print stylesheets | **A user physically cannot submit a 6-item Generate Invoice modal today.** One CSS rule closes it across six modals | 1.6 | ❌ |
| **10** | **Challan line editing** | `add_challan_line` / `remove_challan_line`, inline edit on `challan.html` detail, reversal rows never deletes | Requested by Datta Prasad. Today the only path is delete-and-recreate, which breaks the challan number | 1 | ❌ |
| **11** | **Staff activity log** | Fix `p2_dispatch_orders.created_by` write path (`auth.uid()`, not `tenantId`), `v_p2_activity_log`, Activity tab in `settings.html` | Requested by the PVT LTD owner. Owners need to know who confirmed what | 1 | ❌ |
| **12** | **Consolidated invoice double-billing fix** | Overlap check on `dispatch_order_ids` against every other non-cancelled consolidated invoice for that client | Two overlapping date ranges each sweep the same dispatch today. Fully double-billed, no error, no warning | 0.5 | ❌ |
| **13** | **W1 — Write layer: foundation + dispatch** | `p2_agent_proposals` + RLS + partial unique index, `propose`/`confirm_proposal`/`cancel_proposal`, system prompt, `propose_dispatch` + `request_clarification`, resolution, BOM expansion, stock pre-check, closed-list confirmation matcher, confirmation card | **One sentence creates one real challan.** This alone is the strongest ninety seconds in the product and a complete demo | 1 | ❌ |
| **14** | **W2 — Production issue + stock adjustment + gating** | `propose_production_issue` → `confirm_bom_issue` v4, `confirm_agent_stock_adjustment` with threshold bands, role gate (D11), plan gate (D10), the monthly write meter, Settings → Agent tab | Closes the second and third transaction types and puts the meter in before any client can run up an invoice | 1 | ❌ |
| **15** | **W3 — GRN, text path** | `confirm_agent_grn_v3`, duplicate-invoice advisory, `purchase_type` from GSTIN state codes, rate/GST sanity checks, principal-pool selection, **QR interception** | GRN is the highest-volume transaction and the QR interception fixes ownership correctness for the whole KPML vendor wave | 1 | ❌ |
| **16** | **W4 — GRN, photo path** | Client-side image prep, Sonnet 5 extraction with the strict schema, four-route candidate matching, green/amber/ask banding, Opus 5 escalation, two-round clarification cap, `agent-uploads` bucket with 90-day retention | *"Photograph the paper"* is the sentence that makes the tutorial engine's P0 modules stop being the first thing a new user meets | 1 | ❌ |
| **17** | **W5 — Marathi, mobile, invoice** | Marathi confirmation cards and refusals through the read-aloud gate, affirmation list trimmed, `propose_invoice` with the zero-rate hard block, mobile card layout, camera capture, one-handed confirm | A storekeeper on a ₹8,000 phone is the actual user. English on a desktop is a demo | 1 | ❌ |
| **18** | **W6 — Supervised pilot** | Test tenant, then **one** live tenant, **one** user, `agent_write_enabled=true`. Every proposal reviewed against what the user meant. Acceptance tests in full. Error-floor instrumentation live | **30 days of calendar time, not build time.** This is where master-data problems surface and where the four instrumentation numbers get measured | 30 cal | ❌ |

| # | Load order (fresh chat) | Prerequisites | Gate before it ships |
|---|---|---|---|
| 4 | `_ai/CLAUDE.md` → Known Open Items #1, #18 · `_ai/nexflow-agent.md` §13.2, §5.2 · `_ai/nexflow-mcp.md` §0 C6 · `_ai/nexflow-intelligence.md` §14.1 · `grn.html` · `gstr2b-reconcile.html` (for `normaliseInvoiceNo`) · `supabase/functions/agent-query/index.ts` | A6 | The GRN index must **permit** multi-material GRNs and **block** the same material twice under one supplier invoice. Normalisation byte-identical to `normaliseInvoiceNo()` or the guard and 2B reconciliation disagree about what "same invoice" means |
| 5 | `_ai/CLAUDE.md` · `_ai/automation-strategy.md` §4.2 · `_ai/compliance-monitoring.md` (full) · `export.html` | A0 | Every constant in the inventory traces to a notification number. Opus gate never auto-changes a constant |
| 6 | `_ai/CLAUDE.md` → "Proactive Telegram layer" · `_ai/automation-strategy.md` §4.3, §3.1 · `supabase/functions/check-low-stock/index.ts` | A0 | Sends nothing when all clear. Never a second daily message |
| 7 | `_ai/CLAUDE.md` · `_ai/automation-strategy.md` §4.4 · `supabase/functions/_shared/ops.ts` · `supabase/functions/telegram-webhook/index.ts` | A0 | Every answered question lands in the KB. **Done Sept 17 2026** — `agent-query/index.ts` also needed touching (not in §4.4's Phase 1 object list; opsAlert is Deno-only, a browser widget needs an existing Edge Function's body.action to reach it) |
| 8 | `_ai/CLAUDE.md` → "Language Toggle" section · `_ai/tutorial-engine.md` (full) · `dispatch.html` | None | Full run start-to-finish creating a **real challan** on the test tenant. Delete a `data-tutorial-target` deliberately and confirm the step skips rather than hangs. **Do not build against `js/lang.js`** |
| 9 | `_ai/CLAUDE.md` → Language Toggle + plan gating + `challan.html` gotchas · `_ai/product-polish-p1.md` · `_ai/codebase-audit.md` §5 · `css/nexflow-design.css` | None | Generate Invoice modal, 8 line items, 390px — **the submit button must be reachable.** Regression diff must be empty; P1 touches no write path. Syntax-check each file after each pass |
| 10 | `_ai/CLAUDE.md` → Known Open Items #8 · `all-dispatch-history.html` · `challan.html` · `dispatch.html` | None | Locked once invoiced. Stock check fail-closed. Reversal rows reference the original `dispatch_order_id`. Challan number never changes |
| 11 | `_ai/CLAUDE.md` → Known Open Items #9 · `_ai/md-audit-report.md` C4 · `dispatch.html` · `rm-dispatch.html` · `settings.html` | None | **`created_by` already exists on `p2_dispatch_orders` and holds `tenant_id`.** Fix the write path; do not `ADD COLUMN`. Join target is `p2_user_roles`, **not `p2_staff`** (no such table) |
| 12 | `_ai/CLAUDE.md` → Known Open Items #6 · `supabase/functions/agent-query/index.ts` | None | Two consolidated invoices with overlapping ranges must refuse the second, naming the overlap. Preview warns before confirm |
| 13 | `_ai/CLAUDE.md` · `_ai/nexflow-agent.md` §§3, 4, 7, 8, 13 · `supabase/functions/agent-query/index.ts` · `js/agent-chat.js` | FIX-1, T1 | **No write executes without an explicit human confirmation of a specific, server-computed plan.** The confirm turn makes no model call. A proposal expires in 15 minutes |
| 14 | `_ai/nexflow-agent.md` §5.3, §5.5, §10.1, D10, D11 | W1 | Operator cannot reach a write their role forbids. Lite never sees the write layer. The meter never returns 429 on a write |
| 15 | `_ai/nexflow-agent.md` §5.2, §5.6 · `grn.html` | W1, W2, **FIX-1's GRN index** | A duplicate supplier invoice warns with the prior GRN number and date, with an explicit override |
| 16 | `_ai/nexflow-agent.md` §6 (full) | W3 | **Gated on a 50-challan bench passing before any live tenant** (`nexflow-agent.md` §17 Q2). Illegible field → clarification, never a guess |
| 17 | `_ai/nexflow-agent.md` §5.4, §4.2 · `_ai/tutorial-engine.md` §8.5 | W1–W4, T2 preferred | The read-aloud gate: a real storekeeper, a real phone, the real page. Zero-rate invoice is a hard block |
| 18 | `_ai/nexflow-agent.md` §14, §17, §18 | W1–W5 | Acceptance tests in full. Four instrumentation numbers computed: supersession rate, clarification rate, cancel rate, confirmed-with-unresolved-warning. **A cancel rate near zero is the alarming one.** Pilot tenant: Datta Prasad |

---

### PHASE 3 — Pre-KPML vendor wave · Dec 2026 – Feb 2027

| # | Session | What it builds | Why it matters | Days | Status |
|---|---|---|---|---|---|
| **19** | **A1 — Onboarding ingestion** | `p2_onboarding_submissions` + files table, `onboard-ingest`, deterministic validation, `onboarding-review.html`, `import_onboarding_submission` RPC, Opus column mapping + duplicate adjudication, `suggest_hsn` integration, Haiku vision for PDFs, batch mode | **Must precede the vendor wave.** 20 vendors at 3–6 founder-hours each is 60–120 hours that do not exist during a pilot. Takes onboarding to ~30 minutes | 4 | ❌ |
| **20** | **T2 — Marathi + mobile + GRN** | Bottom sheet, `visualViewport` keyboard handling, `nexflow:langchange` in `js/navbar.js`, Marathi for dispatch through the read-aloud gate, the glossary, `grn.html` tutorial in both languages, resume/progress | The storekeeper is Marathi-speaking and on a phone. Also fixes `grn.html`'s Invoice No header carrying `data-mr="चलान क्र"` — which reads as *challan number*, on the field GSTR-2B keys off | 1.5 | ❌ |
| **21** | **I1 — Intelligence: aggregation layer** | 8 Postgres aggregate functions, `_shared/intelligence.ts` with the `AggregateResult`/`Coverage` contract, `intelligence_query` action, Haiku classifier, `NARRATION_MODEL` table, three-layer fallback, role/plan gates, meter | **One typed question returns a narrated answer, and every figure in it is reproducible from one SQL call.** The contract every later consumer addresses | 1 | ❌ |
| **22** | **I2 — Point-in-time + inspection report** | `compliance_exposure`, `p2_intelligence_reports`, render pipeline, two-phase build, the internal compliance report with its unremovable disclaimer, `intelligence.html` | **This is the demo, and it works on a tenant with three weeks of data** — unlike the trend half, which needs six periods | 1 | ❌ |
| **23** | **M1 — MCP read tools (local stdio)** | `@nexflow/mcp` npm package, `login`/`status`/`logout`, keychain storage, refresh-token rotation, all nine read tools, Settings → Connections with Revoke, `agent_mcp_enabled` default off | **The owner asks their own Claude a question and gets a real answer from their own tenant, alongside a web search.** External intelligence + internal data is the thing no Nexflow-only agent can do | 1 | ❌ |
| **24** | **M2 — Remote transport + OAuth 2.1** | `supabase/functions/mcp/index.ts`, Streamable HTTP without SSE, authorization-server facade, `p2_mcp_connections`, consent screen generated from the scope manifest, privacy policy and terms | **Use Case 1 wants the owner on a phone, and a phone is remote transport.** Without it M1 is a laptop trick | 1 | ❌ |
| **25** | **M5 — MCP write tools** | Four `propose_*` forwards, `source='mcp'` CHECK widening, `origin_connection_id`, autonomous-loop guards, propose rate limit, role gating | The second-most valuable thing the server does: the owner writes a transaction while away from the factory. **`confirm_proposal` is never an MCP tool** | 1 | ❌ |

| # | Load order (fresh chat) | Prerequisites | Gate before it ships |
|---|---|---|---|
| 19 | `_ai/CLAUDE.md` · `_ai/onboarding-engine.md` (full) · `_ai/automation-strategy.md` §3.3, §4.1 · `onboarding.html` | A0, A6 (`p2_job_queue` + `opsAlert`) | **Datta Prasad's original files reach a review page with correct bands in under 10 founder-minutes and import cleanly into a scratch tenant.** If you open Excel at any point, A1 has not replaced the adapter. `hsn_source='imported'`, **never `'ai_suggested'`** — it violates the live CHECK and rolls back the whole import |
| 20 | `_ai/CLAUDE.md` → Language Toggle · `_ai/tutorial-engine.md` §4.8, §4.11, §8 · `grn.html` · `js/navbar.js` | T1 | **Tested on a real ₹8,000 Android handset**, not devtools. Marathi through the read-aloud gate — if it slips, ship English-only for that module; that is a working feature, not a failure |
| 21 | `_ai/CLAUDE.md` · `_ai/nexflow-intelligence.md` §§2, 3, 4, 14 · `supabase/functions/agent-query/index.ts` | FIX-1 (P1 + P2 extractions), W6 pilot complete | **The model wrote no number.** Every figure computed by deterministic code before a model is called. Every correlation stated as a correlation, naming the confounder it cannot see |
| 22 | `_ai/nexflow-intelligence.md` §6.1, §6.2, §7 · `export.html` (for `challanSeriesKey()` + `computeTable13Buckets()`) | I1 | The gap detector is the **extracted** one — a second implementation would disagree with the GSTR-1 workbook on a document register. Disclaimer block verbatim and unremovable |
| 23 | `_ai/nexflow-mcp.md` §§3, 4.1, 4.1a, 5, 12 · `_ai/nexflow-intelligence.md` §3.1 | **I1** (the `nx_*` aggregators), FIX-1's `invoice_total` fix | **No model anywhere in the MCP path.** Tool names and response shapes are public the moment M4 lands and cannot be renamed after |
| 24 | `_ai/nexflow-mcp.md` §3.3, §9 | M1 | The MCP never holds a service-role key and never talks to Postgres. It holds a refresh token, never a password |
| 25 | `_ai/nexflow-mcp.md` §4.2–4.6 · `_ai/nexflow-agent.md` §13 | **W1–W5 + one clean pilot (item 18)** | A write tool returns a proposal and the sentence **"Nothing has been recorded."** `confirm_proposal` is not reachable as a tool and cannot become one by accident |

---

### PHASE 4 — Post-incorporation

| # | Session | What it builds | Why it matters | Days | Status |
|---|---|---|---|---|---|
| **26** | **A5 — Billing reminders** | Reminder scheduler, grace-period logic, plan-state machine, **manual payment trigger — no Razorpay** | Chasing invoices by hand stops scaling around 25 clients. Razorpay KYC binds to the legal entity, so building it pre-incorporation means building it twice | 1 | ❌ |
| **27** | **A7 — Provisioning** | Admin page, founder-triggered provisioning after manual payment confirmation | 40 minutes per signup, and it is the same 40 minutes every time | 1 | ❌ |
| **28** | **T3 — Tutorial coverage + demo mode** | `production-issue.html`, `index.html` orientation, `scanner.html`, staff progress column, demo narration mode, `tutorial-lint.js`, `?tutorialdebug=1`, rollout to the three live tenants | Demo mode is easy to forget until the tutorial hangs forever on the landing-page demo account in front of a prospect | 1 | ❌ |
| **29** | **A8 — Codebase health (full)** | Synthetic tests, quota monitoring, drift checks | Learning about an outage from a client is the failure this prevents | 1 | ❌ |
| **30** | **Session 18 — Bridge Agent, factory profile (E1)** | `_shared/tally-remoteid.ts`, `_shared/tally-voucher.ts` + parity test, `tally-bridge` Edge Function (7 modes), enqueue hooks + 15-min sweeper, the .NET 10 tray agent (poll/post/report, probe, pre-flight, legacy adoption, journal, pairing + DPAPI, auto-update), Inno Setup installer + six-page wizard, Settings → Tally Sync panel | **The strongest lock-in in the product.** Vouchers land in the client's own statutory books, which makes switching a bookkeeping migration rather than a software decision | 15–20 cal | ❌ |
| **31** | **Session 19 — Bridge Agent, CA profile** | Consent UI, `target='ca'` grant resolution, per-company iteration, per-client queues with **no cross-client totals**, "View what your CA receives" screen, CA usage undertaking, per-grant `filed_through`, verification scan | The CA channel with vouchers instead of a zip. Multiplies every Session 18 bug by that CA's client count — hence the gate | 5–8 cal | ❌ |
| **32** | **Session 20 — Credit/Debit Notes** | `p2_credit_notes`, Rule 53 numbering, invoice link + value guard, PDF and public view, GSTR-1 `cdnr` mapping | Monthly event — returned goods, price corrections, short deliveries. Today the only path is cancel-and-re-raise, which breaks the invoice sequence. **Session 18 ships the Tally `CRN`/`DRN` handler with the source table absent** | 1 | ❌ |

| # | Load order (fresh chat) | Prerequisites | Gate before it ships |
|---|---|---|---|
| 26 | `_ai/CLAUDE.md` · `_ai/automation-strategy.md` §4.5 · `_ai/business-strategy.md` §9 | A0, incorporation | No Razorpay. Manual trigger only |
| 27 | `_ai/automation-strategy.md` §4.7 | A5 | Founder confirms payment, then provisions. No self-serve webhook yet |
| 28 | `_ai/tutorial-engine.md` §4.9, §9.2, §10 | T1, T2 | **Demo mode verified on the demo tenant.** The lint script checks every module with a config has a matching `pageReady()` call |
| 29 | `_ai/automation-strategy.md` §4.8 | A0 | The synthetic test for `filing-package` must not email a real CA every morning (`md-audit-report.md` I9) |
| 30 | `_ai/CLAUDE.md` · `_ai/bridge-agent.md` (full — read §0's five corrections first) · `_ai/enterprise-strategy.md` §3.1 · `js/full-export.js` | **FIX-1's GRN index**, incorporation for *deployment* only | **Steps 1–4 must not be reordered.** The parity test against `js/full-export.js` is the acceptance criterion for the voucher builder. **A confirmed dispatch must never produce a Sales voucher** — sync is driven from `p2_invoices` only. Build unsigned, then sign; the certificate is a distribution gate, not a development one |
| 31 | `_ai/bridge-agent.md` §14, §17.4 | **Session 18 stable for one month on ≥1 real client** | **No cross-client totals, ever.** Parallel-run month with one CA, then three clean months before a second CA |
| 32 | `_ai/CLAUDE.md` → `p2_invoices` schema + "Shipped Sept 2, 2026" · `_ai/credit-debit-notes.md` (full) · `_ai/bridge-agent.md` §5.5 · `js/invoice-pdf.js` · `invoice.html` | None (Session 18 makes it more valuable, not required) | Value guard: a credit note can never exceed the invoice it references |

---

### PHASE 5 — P1 PART 1 (Production + Workers + Quality) and Intelligence completion

> **NAMING NOTE.** **"P1" in this document refers to the factory floor management product**
> (`factory-os.md` + `p1-factory.md`). **"P1 product polish" (item 9 above) is a different thing —
> a UI polish session.** When instructing Claude Code, always specify which P1. **All new tables
> use the `p2_` prefix regardless — `CLAUDE.md`'s convention is absolute.** See `p1-factory.md`
> §0 C9.

| # | Session | What it builds | Why it matters | Days | Status |
|---|---|---|---|---|---|
| **33** | **P1A-1 — Production orders + workers** | Full `factory-os.md` §11 migration, `create_production_order`, `get_next_production_order_number`, `cancel_production_order`, `accept_production_order`, `propose_production_order`, `production.html` list + detail, Settings → Workers tab | **One sentence creates a real production order.** A production order is a planning object — it moves nothing, so it needs no confirm gate | 1 | ❌ |
| **34** | **P1A-2 — Assignment + progress + worker page** | `assign_production_work`, `record_production_progress`, `v_p2_production_order_status`, `propose_work_assignment`, `work-view` Edge Function, `work.html` with taps, offline queue, `client_event_id` | **A worker taps +5 on a phone and the owner's order list moves.** The worker confirms nothing and types nothing. 420 taps a month with no model in the path — the highest-volume interaction in the product is free | 1 | ❌ |
| **35** | **P1A-3 — Material issue + output dispatch** | `start_production_order` over `confirm_bom_issue` v4, `confirm_production_dispatch` over `confirm_dispatch_transaction` + `close_wip`, `production_order_id` threaded through the dispatch path | **The session that touches stock.** F3 — consumption happens exactly once, at issue; a dispatch carrying a `production_order_id` never re-expands the BOM — is its whole content | 1 | ❌ |
| **36** | **P1A-4 — Quality + the gate** | `record_quality_check`, dispatch gate, two deterministic thresholds, quality panel | The gate defaults **off**. A factory that does not record quality today loses nothing by recording it a month later | 1 | ❌ |
| **37** | **P1A-5 — Daily owner report + estimates** | `factory-report` with dispatch/drain on `p2_job_queue`, two crons, Haiku with deterministic fallback, `delivery_estimate` / `production_status` / `worker_load` read intents, quiet-hours check | One Telegram message at 7pm that answers *"is Friday going to happen."* **Runs on the job queue from day one — never a loop** | 1 | ❌ |
| **38** | **P1A-6 — Marathi, mobile, network** | `work.html` and every card through the read-aloud gate with a real worker, `get_principal_vendor_production()`, principal dashboard panel, the principal's consolidated query | The worker page in English is not a worker page | 1 | ❌ |
| **39** | **P1A-pilot — Factory OS supervised pilot** | One tenant, one production line, 30 days. Datta Prasad | Every production order's progress reconciles against a physical count, or the gap is explained. **Ask specifically: "what did Thursday's report say?"** A report nobody reads is the failure mode this feature is most likely to have | 30 cal | ❌ |
| **40** | **I3 — Bank stock statement + working capital** | Bank stock statement with principal-material exclusion, unvalued-row refusal, stated basis; working capital summary with the payables upper bound and its verbatim caveat | The document a bank asks for, produced in 30 seconds instead of a day | 1 | ❌ |
| **41** | **I4 — Trend + bottleneck finder** | Changepoint detection (self-referential, never a constant), the nine dated candidate events, three rendering rules, the completeness signal | **Not demonstrable on a live tenant before ~Feb 2027** — no tenant has six complete periods until then. Develop against synthetic history on the test tenant | 1 | ❌ |
| **42** | **I5 — Proactive alerts** | `p2_intelligence_alerts`, widened notification CHECK, `intelligence-sweep` with dispatch/drain, two crons, eight Wave-1 conditions, five fatigue mechanisms | Alerts are deterministic. The model phrases them and never decides them | 1 | ❌ |
| **43** | **I6 — Capacity + supervised pilot** | Historical output report with its refusal language, then 30 days on Datta Prasad | **The owner asks their own questions, unprompted, in week three.** A layer nobody asks a second question of has failed, and it fails invisibly in every usage metric | 1 + 30 cal | ❌ |

| # | Load order (fresh chat) | Prerequisites | Gate before it ships |
|---|---|---|---|
| 33 | `_ai/CLAUDE.md` · `_ai/factory-os.md` (full — read §0's six corrections first) · `_ai/nexflow-agent.md` §3, §4 | **W1–W2 + the write layer running 30 days on one live tenant** (item 18), A6's `p2_job_queue`, A0 | **Read the live `p2_notifications_type_check` and `p2_ops_alerts_source_check` definitions before writing the widening.** See §10 item 3 |
| 34 | `_ai/factory-os.md` §4, §5, §11.4 | P1A-1 | Double-tap is idempotent via `client_event_id`. Offline queue drains without duplicating |
| 35 | `_ai/factory-os.md` §3.4, §3.5, F3 | P1A-2 | **The consumption invariant is the acceptance test.** Issue 30, dispatch 28, dispatch 2 — stock moves exactly once, at issue |
| 36 | `_ai/factory-os.md` §6 | P1A-3 | Gate defaults off. A quality record never blocks a dispatch unless the owner turned the gate on |
| 37 | `_ai/factory-os.md` §8 · `_ai/automation-strategy.md` §3.3 | A6, P1A-2 | Dispatch/drain, never a loop. Deterministic fallback if Haiku is unavailable |
| 38 | `_ai/factory-os.md` §9 · `_ai/tutorial-engine.md` §8.5 · `_ai/kpml-network-sessions-21-22.md` §2 | **Session 21** (for the network half only) | **No worker identity crosses a tenant boundary.** KPML learns an order is 28 of 30 complete; they never learn who made them |
| 39 | `_ai/factory-os.md` §12.5, §13 | P1A-1–P1A-6 | Progress reconciles against a physical count. The four instrumentation numbers computed |
| 40 | `_ai/nexflow-intelligence.md` §6.3, §6.4 | I2 | Three safeguards on the bank statement: principal-material exclusion, unvalued-row refusal, stated basis. **Not `v_p2_supplier_advance_balance`** for payables |
| 41 | `_ai/nexflow-intelligence.md` §5, §12.8 | I2 | Build §12.8's completeness signal **in this session, not later** — it is the guard on everything this session adds |
| 42 | `_ai/nexflow-intelligence.md` §8, §9.3, §9.4 · `_ai/automation-strategy.md` §3.3 | A6, I1 | Digest sections append to the existing 8am message — **never a second daily message.** Read the live CHECK first |
| 43 | `_ai/nexflow-intelligence.md` §6.5, §14.4, §14.5 | I1–I5 | Five answers checked against **what the owner already knows to be true** — not against the database. Unbacked-figure rate must be zero |

> **Intelligence Wave 2** — production efficiency, quality trend, routing `capacity_available` to
> Factory OS's `delivery_estimate` — is one further session, gated entirely on P1A-1–P1A-4.

---

### PHASE 5B — P1 PART 2 (HR + Facility Management)

**Trigger:** P1 Part 1 live and validated on 3+ clients **AND** at least one client has explicitly
asked for attendance + payroll. Both, not either.

**Design document:** `_ai/p1-factory.md` — complete, 3,000+ lines, 38 table schemas, ready to build
from when the trigger fires.

> **CRITICAL before building.** Confirm all 11 statutory parameters in `p1-factory.md` §5.9 with a
> CA **in writing**. Payroll that computes wrong statutory deductions is worse than no payroll.
> **This CA consultation is a hard gate — no payroll session starts without it.**

**MVP — 8 sessions, build these first:**

| # | Session | What it builds |
|---|---|---|
| **P1B-1** | Attendance foundation | `p2_shifts`, `p2_workers` extension, `p2_attendance`, `p2_attendance_exceptions` |
| **P1B-2** | Shift management + leave types | `p2_leave_types`, `p2_leave_balances`, `p2_leave_requests` |
| **P1B-3** | Leave approval flow + overtime recording | The approval path, and overtime recorded rather than computed from output |
| **P1B-4** | Attendance input — supervisor path + geo-QR | Rotating code, accuracy-budget geofence — **not a hard 100m block** |
| **P1B-5** | Attendance input — ZKTeco device webhook | Fingerprint, RFID and face on one endpoint, same protocol. **Matrix COSEC deferred** |
| **P1B-6** | Payroll wages structure | `p2_payroll_policies`, `p2_wage_components`, `p2_payroll_periods`, `p2_payroll_lines` |
| **P1B-7** | Payroll statutory deductions | PF with wage ceiling, ESI with period-lock, PT with February top-up, advance deductions, minimum bonus liability |
| **P1B-8** | Payslip generation + approval + disbursement | The payslip, its approval, and recording that the money moved |

**After the MVP — 16 more sessions:**

| # | What it builds |
|---|---|
| **P1B-9 – P1B-12** | Machine register + maintenance + breakdown log + utilization |
| **P1B-13 – P1B-14** | Scrap recording + yield variance |
| **P1B-15 – P1B-16** | Visitor/vehicle log + gate pass |
| **P1B-17 – P1B-18** | Asset register + depreciation |
| **P1B-19 – P1B-20** | Energy tracking |
| **P1B-21 – P1B-22** | Safety records + compliance calendar |
| **P1B-23 – P1B-24** | P1↔P2 integration + Intelligence extensions + filing package additions |

**Load order for every P1B session, in this order:**

```
_ai/CLAUDE.md → _ai/factory-os.md → _ai/p1-factory.md (full) → session-specific section
```

> **NEVER load all MD files.** Load only what that session needs, per the load order above.

**Prerequisites before any P1B session:** §10 item 8.
---

### PHASE 6 — KPML pilot live

| # | Session | What it builds | Why it matters | Days | Status |
|---|---|---|---|---|---|
| **44** | **Session 21 — KPML cross-tenant upgrade** | `p2_network_links` ALTER (scope, `consented_at`, `granted_by`, `revoked_at`), `get_network_scope_description()`, Settings → Network tab, `preview_as_principal_material()` / `..._invoices()`, **"View as principal"** | A vendor whose data becomes visible to their largest customer should see the panel that says what is visible **before** it is. "View as principal" is the strongest trust feature available | 1 | ❌ |
| **45** | **Session 22 — Principal write access** | The correction model **first**, `principal_create_dispatch()`, `principal_cancel_dispatch()` (reversal, never delete), principal dashboard write UI, cross-tenant notification | KPML dispatches material and the vendor's GRN appears with the right `owned_by`, `principal_challan_no` and clock start. **Gated on the pilot signature** | 1 | ❌ |
| **46** | **M6 — KPML network MCP** | Transport over the existing `SECURITY DEFINER` RPCs plus whatever Session 21's `scope` permits. **Read-only, no write tool** | KPML's purchase team asks *"status of our KS4 order across all vendors?"* — N tool calls, each independently authorised, consolidated by **their** Claude, on the far side of the boundary | 1 | ❌ |
| **47** | **Session 23 — Notification Centre v2** | `notifications.html` Gmail-style (filters, pagination, read/unread, search), navbar dropdown becomes a preview, Telegram deep link | Step 5 adds principal-side events (s.143 warnings, vendor stock alerts) that make three notification types into enough to justify a page | 1 | ❌ |

| # | Load order (fresh chat) | Prerequisites | Gate before it ships |
|---|---|---|---|
| 44 | `_ai/CLAUDE.md` → "Shipped Sept 8, 2026 — Session 9" + "Shipped Sept 9, 2026 — Session 11" · `_ai/kpml-network-sessions-21-22.md` (full — read §0 first) · `_ai/kpml-network-plan.md` §2, §8, §10.5 | None | **Create a second fake principal holding different material. Open "View as principal" for principal A. Principal B's existence must be unreachable** — not in a count, not in a total, not in a material list, not in a challan-number gap. If any surface reveals it, the session is not done |
| 45 | `_ai/kpml-network-sessions-21-22.md` §4 · `_ai/kpml-network-critique.md` Q3, Q7 | Session 21, **pilot signature** | The correction model lands **before any write path.** Six-failure-mode test pass again — write paths leak differently from read paths |
| 46 | `_ai/nexflow-mcp.md` §1.0 C8, §12.0 · `_ai/kpml-network-sessions-21-22.md` §2 | **Sessions 21–22**, M1, M2 | **A principal reaches a vendor through `p2_network_links`, never through `p2_ca_grants`.** One scoped access path per relationship, and never a second. No server-side cross-vendor aggregate |
| 47 | `_ai/CLAUDE.md` → Backlog "Notification Centre v2" · `js/navbar.js` · `supabase/functions/notify/index.ts` | Session 21 | No schema change needed. Telegram message gains one link line |

---

### PHASE 7 — Compliance complete

| # | Session | What it builds | Why it matters | Days | Status |
|---|---|---|---|---|---|
| **48** | **A4 Phase 2 — KB-backed support agent** | Haiku over the populated KB, Opus escalation | Below ~40 clients, answering directly is better product **and** free market research. Automating earlier automates away the signal before it has been read | 2 | ❌ |
| **49** | **Session 24 — Supplier Payables Register** | MSME fields on `p2_suppliers`, `p2_supplier_payments`, bill derivation from GRN groups, register table, 31-March disallowance figure, Excel export, **`v_p2_supplier_advance_balance` fix** | **The 43B(h) risk is on payables, not receivables.** The shipped surface measures the wrong side and says so. This is the number the client's own CA asks for in March | 1 | ❌ |
| **50** | **Session 25 — GSTR-2B server-side storage** | `p2_gstr2b_uploads`, `p2_gstr2b_rows`, parse-then-persist split, the shared matcher, sheet 02 of the filing package | Session 15 shipped E2 Part 1 with the reconciliation sheet explicitly deferred pending this table | 1 | ❌ |
| **51** | **Session 26 — Audit trail + partnership polish** | Full audit trail surface, partnership-segment items | Due-diligence readiness, built years early | 1 | ❌ |
| **52** | **M3 — MCP CA multi-tenancy** | `mcp_read_v1` scope, `resolveCaTenants()`, `UNIQUE (tenant_id, ca_email, scope)`, per-client consent and revoke, CA-side tenant selector | **Last, deliberately.** The CA already receives the filing package and does not need stock or production data | 1 | ❌ |
| **53** | **M4 — MCP directory submission** | Directory checklist, listing copy, security review | A free connector is a materially better listing than a paid one, and the listing is the distribution mechanism | 0.5 | ❌ |
| **54** | **A5 + A7 — Razorpay integration** | Webhook, automatic provisioning on `payment.captured` | **Gate: 50+ clients AND manual payment management >3 hrs/month AND incorporation complete.** At current scale manual confirmation takes <5 minutes per payment | 1.5 | ❌ |

| # | Load order (fresh chat) | Prerequisites | Gate before it ships |
|---|---|---|---|
| 48 | `_ai/automation-strategy.md` §4.4 | A4 Phase 1, ~40 clients | Escalates rather than guesses |
| 49 | `_ai/CLAUDE.md` → `p2_suppliers`, `p2_supplier_advances`, "Shipped Aug 28, 2026" · `_ai/supplier-payables-register.md` (full) · `_ai/compliance-and-field-report.md` §3.1 · `export.html` | **CA answer on the 15-vs-45-day question** (§3 of that file) before the client-facing figure ships | Three test bills: Micro+Udyam+45d+60 days old (counts), Medium 90 days old (**excluded**), trading-registered Small (**excluded**). Banner names both exclusions. Excel reconciles to the rupee. **Verify bill grouping matches `gstr2b-reconcile.html` on the same period** |
| 50 | `_ai/CLAUDE.md` → GSTR-2B sections (Aug 12, Aug 17, Sept 2) · `_ai/gstr2b-server-storage.md` (full) · `gstr2b-reconcile.html` · `supabase/functions/filing-package/index.ts` | A6 | **`gstr2b-reconcile.html` is the specification. Do not rewrite it.** The matcher must not fork |
| 51 | `_ai/CLAUDE.md` · `_ai/enterprise-strategy.md` §2 | Item 11 (staff activity log) | — |
| 52 | `_ai/nexflow-mcp.md` §6 · `_ai/bridge-agent.md` §8.3, §14.3 | Session 18's `p2_ca_grants`, **Use Cases 1 and 2 validated** | `mcp_read_v1` covers **five** tools, not nine. A CA checking an invoice number does not need days of cover and revenue by client |
| 53 | `_ai/nexflow-mcp.md` §9.2, §9.3 | Incorporation | Tool names are frozen once listed |
| 54 | `_ai/automation-strategy.md` §4.5, §4.7 · `_ai/business-strategy.md` §9 | Incorporation, 50+ clients, >3 hrs/month manual | — |

---

### PHASE 8 — Network features · named client request only

**Do not build any of these speculatively.** They exist because a specific client asked, or they
do not exist.

| # | Session | What it builds | Days | Status |
|---|---|---|---|---|
| **55** | Session 27 — Job work agreement record | Per-relationship agreement terms, the 45-day clock's legal basis | 1 | ❌ |
| **56** | Session 28 — PO Push | Principal pushes a PO; it becomes proposed production orders vendor-side | 1 | ❌ |
| **57** | Session 29 — Rejection at gate + rework | Rejection recording at the principal's gate, rework dispatch/return | 1 | ❌ |
| **58** | Session 30 — Yield variance | Expected vs actual consumption per production order, per vendor | 1 | ❌ |
| **59** | Session 31 — Dispute register | Quantity/quality disputes between principal and vendor, with an audit trail | 1 | ❌ |

Load order for any of them: `_ai/CLAUDE.md` → `_ai/kpml-network-plan.md` §9 Step 7 → the named
client's written request. **Session 28 is not a prerequisite for Factory OS** — `factory-os.md`
§9.2 describes what happens *when* a PO arrives; until one does, `source='principal_po'` is an
unused code path.

---

### Scheduling notes on this list

- **A8 (full) placement differs between sources.** `CLAUDE.md` puts it post-incorporation (item
  16); `automation-strategy.md` §7 Wave 2 puts it Dec 2026–Feb 2027. This file follows
  `CLAUDE.md`. Pull it forward if a client reports an outage before you do.
- **Factory OS could start earlier than Phase 5.** Its hard gates are W1–W2 plus 30 days of write
  layer on a live tenant, `p2_job_queue`, and A0 — all satisfied at the end of Phase 3. It is
  placed after the Bridge Agent because `CLAUDE.md` sequences it there. **If a Tier-3 prospect
  appears, P1A-1–P1A-2 (the MVP) is two sessions and the placement is a convention, not a law** —
  the same reasoning `bridge-agent.md` §17.6 applies to the 40-client gate on E1.
- **Every pilot is calendar time that runs in parallel with the next session.** W6, the Factory
  OS pilot and I6's pilot are 30 days each of watching, not 30 days of not building.

---

## 5. Claude Code Usage Rules

### Model selection

| Use | Model | Why |
|---|---|---|
| **MD documents, architecture, strategy, planning, audits** | **Opus 5** | Judgment across a large document set, catching contradictions between files, writing specifications another session will build from |
| **All coding sessions** | **Sonnet 5** | Every session in §4. Faster, and the specification already contains the judgment |
| **In-product model choices** | See the relevant MD file | Haiku 4.5 for extraction/classification/narration; Sonnet 5 for vision; Opus 5 for vision escalation, column mapping, duplicate adjudication and covering notes |

**Opus writes the plan. Sonnet builds it.** If a coding session needs a judgment call that is not
in the MD file, that is a signal the MD file is incomplete — stop and fix the MD file in an Opus
session rather than improvising in a Sonnet one.

### Session start ritual

Paste this at the start of **every** fresh chat, filling the two blanks:

```
Read _ai/execution-plan.md in full first.

I am building: [SESSION ID AND NAME from §4]

Load, in this order, in full:
[THE LOAD ORDER FROM THAT SESSION'S ROW — nothing else]

Then:
1. Confirm every prerequisite in that row is actually done. If one is not,
   stop and tell me which.
2. Read the live definition of any CHECK constraint or column you intend to
   change, in the SQL Editor, before writing the migration.
3. Write a plan. Do not write any code yet. Paste the plan here for review.

Rules that apply to every session:
- Never test writes against SS Engineering, Datta Prasad or Shivprasad.
  Test tenant only: fe2b94fb-9668-405f-9c62-5f54b32f8c7a
- Test tenant agent_tier stays 'unlimited'. Never reset it.
- PowerShell: no &&. Separate git commands on their own lines.
- New migrations go through the Supabase SQL Editor, never `supabase db push`.
- Syntax-check each file after each pass.
- Run the regression snapshot diff afterwards, against the most recent prior
  snapshot — never baseline-pre-2H.json.
- Direct, zero sugarcoating, brutal verdict on design/scope/pricing decisions.
```

### Plan approval rule

**Plan first. Paste it here. Never build without an approved plan.**

This is not process for its own sake. Three of the four largest defects in this codebase's
history — the `set_tenant_id()` trigger writing `auth.uid()` for staff, RLS never enabled on 15
tables, `todayIST()` silently wrong at five call sites — were single decisions taken inside a
build that nobody reviewed until much later. A plan is ten minutes and it is the only point at
which a wrong decision is cheap.

Specifically, the plan must name: every file it will touch, every migration it will write, every
CHECK constraint or RPC signature it will change, and what it will run to verify. **If the plan
does not name a verification step, it is not a plan.**

### Load order principle

**Load only the files that directly affect this session's build decisions.**

There are 22 MD files in `_ai/` totalling ~37,000 lines. Loading all of them costs context that
the session needs for the actual code, and buries the three paragraphs that matter. Every session
row in §4 carries a minimal load order. Use it literally.

Three rules that follow from it:

1. **`_ai/CLAUDE.md` is always first, and often the only strategy file.** Where §4 names a
   section ("→ Language Toggle"), read that section, not the file.
2. **A design document is read in full the first time and by section afterwards.** T1 reads all
   of `tutorial-engine.md`; T2 reads §4.8, §4.11 and §8.
3. **Never load a document because it might be relevant.** If a session turns out to need a file
   that is not in its load order, load it then — and add it to that row in this file.

---

## 6. Parallel Tracks

These run alongside the coding sessions. None of them is a session; all of them block one.

### 1. PVT LTD incorporation — **start this week**

**The single most blocking non-technical item in any Nexflow document, and it has no owner and no
date.** It simultaneously blocks: the WhatsApp Business API (A1 Phase 2), the code-signing
certificate (Sessions 18–19 deployment), Razorpay KYC, the KPML pilot signature (KPML is a PVT
LTD and cannot contract with a proprietorship), and every Segment 3 sale.

~1 month to contracting-ready, ~2 months to fully migrated. **Working backwards from a November
2026 KPML meeting and a December 2026 pilot signature, the last safe start is early October.
Starting in September removes the risk entirely.**

Two things that ride along with it:
- **Novation or assignment letters for all three live clients.** They signed with the
  proprietorship, and Datta Prasad's ₹1,35,000 will have been paid to it. Do not let the new
  entity invoice against an old entity's agreement.
- **Pin the "no cost increase for 3 years after Year 1" wording.** It reads either as through
  Sept 2029 or through Sept 2030 — a full year of pricing headroom on two of three founding
  clients. Do it in the same legal pass, not separately.

### 2. CA consultation on LTCG — **this week**

Three questions, and **do not issue any shares until they are answered**:

1. The current LTCG rate for unlisted PVT LTD shares. The planning assumption is 20–23%; the
   2024 regime change suggests ~15% effective. **On a ₹400 Cr exit the difference is ₹60–80 Cr.**
2. Optimal shareholding structure before a second director is added.
3. The exact date incorporation should happen to maximise LTCG treatment at exit — **the
   holding-period clock starts when shares are issued, so every month before incorporation is a
   month of holding period lost.**

This interacts directly with "who is the second director and what do they hold", which sits on
the SPICe+ Part B form and therefore cannot be deferred past incorporation.

### 3. Datta Prasad — 78 uninvoiced challans

Found by the Opus covering note on their August data. **These are workflow issues, not Nexflow
bugs**, and they need owner action before the October filing:

- **78 dispatch challans to KPML marked `'sale'` with no corresponding sales invoice.** Tax
  invoices must be raised before GSTR-1 can be filed.
- **15 GRN lines at 0% GST against identical 18% goods.** Likely capture errors; ITC
  reconciliation with GSTR-2B at risk.
- **1 orphan GRN** (27 Aug, 50 units STATOR STACK KS100-4P CL200) with no supplier name and no
  invoice number.
- **623 materials with no HSN audit, 50 dispatched items with no HSN code.**

Also outstanding on this tenant: their 97 `p2_product_prices` rows are **KPML SAP purchase rates,
not job work charges**. Correct rates are needed from the client before any invoice is generated
from them. And confirm the ₹1,35,000 landed on 10 September.

### 4. KPML meeting — already demo-ready

The principal dashboard is live on real data, v2 with vendor list → detail and payment
visibility. **What the meeting needs that is not a build:**

- **Quote the right vendor pricing number.** It is decided (overage beyond 20) but four files
  still say otherwise, so the number you quote at 30 vendors is **₹3.0–3.7L, not ₹6.1–8.4L.**
- **Decide: does the data migration rewrite history, or start from a cutover date?**
  `[RECOMMENDED]` **cutover.** Set `is_job_work_principal` and `linked_tenant_id` now, attribute
  new GRNs from that date, and show KPML an honest *"records begin 1 November 2026"*. **Rewriting
  history on a live tenant to make a demo look fuller is the one thing that turns a reference
  customer into a detractor.**
- **Three per-client conversations before any vendor data becomes visible to KPML** — three
  owners, three calls, not a script. The framing is *"your principal will ask you for these
  numbers repeatedly, and today you cannot produce them. Be the vendor who answers in ten seconds
  and never gets accused"* — never *"we are giving KPML visibility."*
- **The consent panel (Session 21) ships before the migration.** Defensible technically to do it
  the other way; indefensible in the conversation that follows.

### 5. New client acquisition — target 2–4 during the build sprint

**Never stop selling while building.** The pitch available today, with zero new code, is Pro to
any MIDC factory: *"GST automation, challans, invoices, CA export, and your storekeeper on their
own phone."*

Concrete reasons to add clients now rather than later:
- The 3-client column is break-even. **A fourth paying client is the difference between "we are
  funded by setup fees" and "we have margin."**
- `business-strategy.md` §3.6 cannot be corrected until a fourth client signs.
- **Every new client at ₹1,00,000–1,25,000 is signed cheap, deliberately** — signing a reference
  client now is worth more than ₹25,000 of ARR later.
- **Offer the CA Tally integration free to all three existing clients' CAs immediately.** It is
  the fastest route to the first CA relationship and therefore to the three-clean-months gate.

---

## 7. Milestones and What They Unlock

| Milestone | The sentence you can say | What changes |
|---|---|---|
| **Today** | *"GST automation for your factory — challans, invoices, CA export, from one place."* | Pro to any MIDC factory. This is the sale that is live right now and it needs no new code |
| **After Tutorial Engine (T1–T3)** | *"No training needed. Your storekeeper opens it in Marathi and records a correct GRN on the first try."* | Removes the largest objection and the largest founder-hour cost. Onboarding stops requiring a site visit |
| **After Onboarding Engine (A1)** | *"Send me your files in whatever shape they are in. Twenty vendors onboarded in a day."* | The KPML vendor wave becomes possible. 3–6 founder-hours per client → ~30 minutes |
| **After the Agent pilot (W6)** | *"Stop paying for a data entry person."* — **and prove it** | **The first time in this product's history that sentence is honest.** ₹12.80/transaction human vs ₹0.77 compute, with 30 days of one live tenant's data behind it. Unlocks the ₹75,000 add-on |
| **After Production Lite (P1A-1–P1A-6)** | *"Your factory runs itself — you approve four things per order and the rest is taps."* | The buyer changes from the person who records things to the person who **runs** the factory. Used every hour instead of at month end. Unlocks the ₹1,25,000–1,45,000 add-on and the ₹3,80,000 Tier-3 price |
| **After Intelligence (I1–I6)** | *"Your factory runs smarter."* Ask a question about your own business, get an answer in ten seconds | Unlocks ₹60,000/year **at renewal**. Also the strongest reason a Year-2 client pays more, and the weakest cold pitch — the demo needs months of data |
| **After the Bridge Agent (Sessions 18–19)** | *"Your Tally fills itself."* | **Switching becomes impossible.** Leaving is no longer a software decision, it is a bookkeeping migration their CA has to sign off. Also the second CA channel, from ~Aug 2027 |
| **After KPML Sessions 21–22** | *"Your principal sees exactly what you want them to see, and you can show them what that looks like before you turn it on."* | **The network effect goes live.** Each principal brings 20–50 vendors, each a Pro subscription. Ten principals is 200–500 clients |

**Two further milestones, gated on Phase 5B:**

**After P1 Part 2 MVP (attendance + payroll):** *"Every register in your factory is digital. Your
muster roll is never written up the morning before an inspection. Your payslips are calculated
correctly with all statutory deductions. Your CA gets the payroll liability statement
automatically."*

**After P1 Part 2 Complete (all 8 modules):** *"Nothing in your factory is on paper. Nothing is in
a spreadsheet. Every non-physical activity — from GST to payroll to safety records to machine
maintenance — is in one system. The only competition is running a factory manually."*

**P1 + P2 fully integrated = Nexflow Factory OS.** At this point no competitor covers this ground,
and no MIDC factory that depends on this system will ever willingly switch.

---

## 8. What Nexflow Looks Like When Complete

The platform has four products on one login. Inventory handles compliance and stock. Production
handles the floor. Agent makes both conversational. Intelligence makes both smart. Together:
**Nexflow Operating System** — one platform for everything in an MIDC factory, nothing on paper,
nothing in a spreadsheet, nothing in WhatsApp.

### The full product

**Base — every plan, including Lite:** GRN, dispatch, challans, production issue, invoices
(single and consolidated), stock dashboard, CA export, Tally export, Zoho export, GSTR-2B
reconciliation, GSTR-1 Table 12/13, ITC-04 working paper, physical stock count, payment ledger,
supplier advances, notifications, one-click full export, AI HSN audit, CA Tally integration, and
the MCP read tools.

**Pro adds:** the AI copilot (50 queries/day), multi-user with roles, unlimited materials, QR
scanner, owner visibility.

**Enterprise adds:** the Bridge Agent writing vouchers into the client's own TallyPrime, and the
monthly AI filing package their CA opens on the 5th.

**Principal adds:** cross-vendor material visibility, s.143 clocks per lot, reconciliation gap,
per-vendor payment position, and — after Session 22 — the ability to dispatch material and have
the vendor's GRN appear correctly attributed.

**Four paid add-ons on top:** the Agent (describe or photograph a transaction, confirm once),
**P1 Part 1** — Factory OS (production orders, workers, taps, quality, a 7pm report) — **P1 Part 2**
(attendance, leave, payroll with every statutory deduction, machines and maintenance, scrap and
yield variance, visitors and gate passes, the asset register, energy, and safety records with the
compliance calendar), and Intelligence (ask your own business questions, get bank statements and
working capital summaries and a compliance inspection report).

**Stated once, as a whole:** P2 (compliance + inventory) + P1 Part 1 (production + workers +
quality) + P1 Part 2 (attendance + payroll + machines + scrap + visitors + assets + energy +
safety) + Intelligence + the Bridge Agent + the MCP server. **That is Nexflow Factory OS** — and
at that point nothing in the factory that is not physical is on paper or in a spreadsheet.

**In two languages, on a ₹8,000 phone, with a tutorial that teaches each flow in one sentence per
field.**

### The demo for a new prospect

Ninety seconds, on a phone, on their own data after one onboarding:

> Type *"30 KS4 motors to KPML today"*. The card names the four raw materials that will come out
> of stock, with current balances. Tap Confirm. Open the stock dashboard — the four balances have
> moved. Open the challan — it is a real Rule 55 challan with a real number.
>
> Photograph a supplier's delivery challan. The GRN comes back filled in, with the material names
> matched to their master and the invoice number read off the paper. Confirm.
>
> Switch to Tally. Open the Day Book. The voucher is there, with the right ledgers, the right GST
> split.
>
> Ask *"what are we about to run out of, and who owes us the most?"* Get an answer with days of
> cover per material against their own consumption rate, and an ageing list with the MSME flags
> on it.
>
> **Say nothing while it happens.**

### Why competitors cannot replicate it

- **Tally, Busy, Zoho and SAP are uniformly form-based, and the form is the product.** Moving the
  human from operator to approver is not a feature they can add — it is a different architecture
  with a different correctness bar. A form-based system with an AI assistant is a better
  form-based system. A system where the forms are the fallback is a different category.
- **Nexflow sits upstream of Tally.** It captures the transaction at the moment it happens, on
  the factory floor, in Marathi, on a phone — and feeds Tally one-way. That position cannot be
  reached from inside an accounting package.
- **The job-work ownership dimension took twelve sub-steps to build** (`owned_by`, `held_by`,
  `movement_purpose`, `principal_tenant_id`, s.143 clocks, WIP state, pool-aware consumption,
  `p2_challan_links`, UQC codes, ITC-04). No inventory product has it, because it only matters in
  a market nobody large is serving.
- **The CA channel is a distribution asset, not a feature.** A channel with 50–100 active
  referrers is the thing an acquirer cannot replicate with engineering.
- **A general-purpose AI tool cannot replace it** because it has no write path into the client's
  ledger, no confirmation protocol, no RPC that holds a `FOR UPDATE` lock across its own
  sufficiency check, and no statutory surfaces. It can advise. It cannot record.

### Why clients cannot leave

Ranked by strength:

1. **The Bridge Agent.** Their statutory books are being written by Nexflow. Leaving is a
   bookkeeping migration their CA has to sign off, not a software switch.
2. **Their CA prefers it.** The CA receives a clean package on the 5th and their month is three
   hours shorter. A client who leaves makes their own CA's job worse.
3. **Their principal is on it.** A KPML vendor who leaves goes back to being the vendor who
   cannot answer.
4. **Their storekeeper knows it.** In Marathi, with the tutorial, on their own phone. Retraining
   on anything else is a real cost.
5. **The owner thinks in it.** An owner who has wired Nexflow into the Claude they already use
   does not churn quietly.

And — deliberately — **the one-click full export is free on every plan, forever.** Every table as
CSV, a documented schema, a manifest with per-file hashes, the whole transaction history as
portable XML. **The lock-in is worth more when leaving is genuinely easy**, because then staying
is a judgment about the product rather than a hostage situation. It is also due-diligence
readiness built years early.

---

## 9. The Exit Story

**Target: ₹300 crore post-tax, from a single exit. Minimum acceptable: ₹150 crore post-tax.**

**When: 2032–2034.** Not 2031 — the happy path at end-2031 (2,500 clients, ₹37.5 Cr ARR, 8×)
produces ₹234 Cr post-tax and **misses the target by 22%**. Every scenario that clears ₹300 Cr is
2032 or later. The single highest-leverage decision available is **not taking the 2031 exit.**

**What it has to be: ₹385–390 Cr pre-tax** at the 22% planning rate — which is ~3,200 clients at
8×, ~2,570 at 10×, or ~1,710 at a 15× strategic premium.

**To whom**, in ascending order of what they would pay:

| Buyer | What they are buying | Multiple |
|---|---|---|
| **Zoho** | A product gap — no manufacturing job-work module, no regional-language onboarding | Lowest; their default is to build |
| **ClearTax / Defmacro** | A CA referral network plus the upstream factory-floor data capture they structurally lack | Mid |
| **Tally Solutions** | Distribution, an MSME base already in their ecosystem, the job-work dimension their inventory module never had — and **the elimination of the one product category that could become a front-end in front of them.** Defensive acquisitions price above financial ones | **8–10×** |
| **A large Indian bank** (HDFC, ICICI, Kotak) | Underwriting data. Real-time inventory, dispatch, GRN, invoice and payment behaviour from 2,000+ MSME factories is a better credit signal than any loan application, because it is **observed rather than reported** | **15–20×+** — and not anchored to ARR at all |

**Build the business Tally would want to buy.** It is the same business. Treat the bank as upside
that arrives or does not — it depends on a bank's strategy at a moment years away, not on
anything Nexflow does.

**What the business looks like at exit:** ~3,000 clients, ₹45 Cr+ ARR, 95%+ gross margin, **3–4
people**, ~100 active CA referrers, a principal network of 10+ mother factories each bringing
20–50 vendors, and a Bridge Agent writing into several thousand sets of statutory books. That
headcount-to-ARR ratio is the whole business.

**Four rules that constrain decisions years before the exit:**

1. **Never accept funding that restricts the acquirer pool.** A Tally-adjacent investor kills the
   bank outcome; a bank investor kills Tally's defensive motive. There is no cash need in any
   scenario, so there is no forced trade. **The default answer is no**, until someone can name
   which acquirer it removes and why that is worth it.
2. **Keep the data architecture clean and exportable.** It already is. It needs **not breaking.**
3. **Build the CA channel explicitly as a distribution asset, and instrument it.** Count active
   referrers, referred clients, clean filing months per CA. **A channel you cannot measure is a
   channel you cannot sell.**
4. **Protect gross margin above every other financial metric.** No per-client human labour that
   scales linearly. No bespoke customer-specific builds, however large the cheque. Support never
   becomes the cost centre.

**And the permanent constraint that none of this overrides:** nothing here licences selling,
sharing or monetising client data before an exit. The data isolation guarantees, the scoped
access rule, and the consent language shown to every tenant are permanent. What a buyer inherits
under a change of control is not a data business Nexflow runs in the meantime.

**The one thing that can actually kill this business is not cost and not slow growth. It is a
reputation event** — one CA whose client filed wrong numbers from a Nexflow package, in a
district where every factory owner knows every other one. Protect the data quality and the
financial downside takes care of itself.

---

## 10. Known Open Items That Affect Build Order

Each of these produces a wrong result in a specific session if it is not resolved first. **Check
the relevant row before starting that session.**

### 1. `hsn_source` enum mismatch — **before A1 (item 19)**

Three documents define this column three ways. **Only the shipped definition is real:**

```sql
hsn_source text CHECK (hsn_source IN ('manual','imported','ai_verified','ai_corrected'))
```

`automation-strategy.md` §4.1 tells A1 to write `'ai_suggested'`. **That value raises a CHECK
violation**, and in A1 the insert happens inside `import_onboarding_submission()` — a single
all-or-nothing transaction across ten tables — so **one HSN row rolls back the entire client
import** with a message the review page cannot explain. `enterprise-strategy.md` §3.3 specifies a
fourth set again plus a `hsn_suggested_at` column **that does not exist**.

**Correct behaviour:** A1 writes `hsn_source = 'imported'` for every material and product it
creates, regardless of where the HSN came from. Provenance of the *suggestion* lives on
`p2_onboarding_submissions.flags`, not on the master record.

**Second trap in the same session:** `suggest_hsn` returns
`{id, verdict, reason, suggested_hsn}` — **there is no `confidence` field**, and Session 14's
client flow splits blanks out *before* calling Haiku, so **the blank-`hsn_sac` path may never have
been exercised. Test it first.**

### 2. `created_by` column situation — **before the staff activity log (item 11)**

`CLAUDE.md` Known Open Items #9 says to *add* `created_by` to `p2_dispatch_orders`. **It already
exists, and it holds `tenant_id`, not `user_id`** — written as `tenantId` at `dispatch.html:1047`
and `rm-dispatch.html:1043`. It records nothing useful about who created the dispatch.

**This needs a write-path fix and a backfill decision, not an `ADD COLUMN`.** Existing rows have
no recoverable attribution — leaving them NULL is the honest option.

**Second error in the same item:** it specifies joining to `p2_staff`. **There is no `p2_staff`
table.** Staff live in `p2_user_roles`, whose SELECT policy was widened to tenant-wide read in
Session 3 precisely so staff names could be resolved.

**Confirm column existence on `p2_stock_transactions`, `p2_invoices` and `p2_dispatch_items`
before writing any migration.** Add only where genuinely missing, nullable, no backfill.

### 3. CHECK constraint collision risk — **before P1A-1 (item 33) and I5 (item 42)**

**Two documents widen `p2_notifications.type`, and the second to land will drop the first's values
unless it includes them.**

| Document | Adds |
|---|---|
| `factory-os.md` §11.8 | `daily_production_report`, `production_delay`, `quality_alert`, `work_assigned` |
| `nexflow-intelligence.md` §9.4 | `intelligence_alert`, `intelligence_digest` |

Both also assume `filing_package_ready`, which is not in the shipped CHECK
(`challan_dispatched`, `payment_overdue`, `low_stock`).

**Whichever lands second must read the live definition first:**

```sql
SELECT pg_get_constraintdef(oid) FROM pg_constraint
WHERE conname = 'p2_notifications_type_check';
```

A `DROP` + `ADD` pair that silently narrows a CHECK breaks every insert of the dropped type — and
it breaks them **at send time, in production, on a path that is fire-and-forget and swallows its
own errors** (`js/notifications.js`). Nothing would surface it.

**`p2_ops_alerts.source` has the same problem, four ways.** A0 creates it with
`('compliance','digest','filing','health','onboarding','support','billing')`. `bridge-agent.md`
needs `'bridge'`, `nexflow-agent.md` needs `'agent'`, `factory-os.md` needs `'factory'`,
`nexflow-intelligence.md` needs `'intelligence'`. **Read the live definition before each
widening.** The cheapest fix is to include all four values in A0's original CHECK — it costs
nothing now and removes the collision entirely.

### 4. GRN duplicate DB index — **before the Bridge Agent (item 30), and before W3 (item 15)**

No uniqueness check of any kind exists on `(tenant_id, supplier_id, normalised invoice_no)`. A
duplicated supplier invoice today double-counts stock and double-claims ITC. Worse:
`gstr2b-reconcile.html` groups by `(supplier_gstin + normalised invoice_no)` and **sums the
duplicates**, reporting an "Amount Mismatch" against GSTR-2B — so the operator concludes the
supplier filed wrong. **With the Bridge Agent running it becomes two Purchase vouchers in the
client's real statutory books.**

**There are no `p2_grn_items` or `p2_grn_headers` tables.** A GRN is N rows in
`p2_stock_transactions` sharing one `grn_no`, with `invoice_no` set **per row**.

**Do not implement the constraint as literally specified.** A plain
`UNIQUE (tenant_id, supplier_id, normalised invoice_no)` would reject every legitimate
multi-material GRN and break GRN entry for all three live tenants on day one.

Correct shape, two layers:

```sql
-- DB backstop: include the material.
UNIQUE (tenant_id, supplier_id,
        upper(regexp_replace(invoice_no,'[\s\-/]','','g')),
        raw_material_id)
WHERE transaction_type = 'grn' AND invoice_no IS NOT NULL;
```

Plus the **UI warning, which is the real guard**: on GRN confirm, if
`(supplier_id, normalised invoice_no)` already exists under a *different* `grn_no`, warn
*"Invoice INV-123 was already received under GRN-0042 on 12 Aug"* with an explicit override.

**Normalisation must be byte-identical to `normaliseInvoiceNo()` in `gstr2b-reconcile.html`**
(`str.replace(/[\s\-\/]/g,'').toUpperCase()`), or the guard and the 2B reconciliation will
disagree about what counts as the same invoice.

Scheduled as part of **FIX-1 (item 4)**.

### 5. `invoice_total` bug — **before the MCP read tools (item 23) and Intelligence (item 21)**

`executeQuery`'s `invoice_total` branch has two divergences from every other invoice surface:

1. **It filters on `created_at`, not `invoice_date`.** The 2 Sept 2026 compliance pass moved
   `invoices.html`, `export.html` Sheet 2, Table 12 and 43B(h) to the real `invoice_date` column.
   `agent-query` was not included in that pass.
2. **It includes `draft` invoices** (`.neq('status','cancelled')`). `export.html` Sheet 2
   filters `status='sent'` deliberately — draft invoices never appear in a GST summary.

Today it is a chat answer a factory owner reads casually. **Through the MCP it becomes a number a
CA puts in a working paper**, and it will not tie to the filing package, the GSTR-1 workbook or
`invoices.html`. **A CA who finds two Nexflow numbers that disagree stops recommending Nexflow.**

Two lines, one branch. Scheduled as part of **FIX-1 (item 4)** — it is a prerequisite named
independently by both `nexflow-mcp.md` §0 C6 and `nexflow-intelligence.md` §14.1, with the
instruction *"do it in whichever session arrives first, not in three."* The chat surface gets the
fix for free.

### 6. `js/lang.js` dead file — **before T1 (item 8) and any Marathi work**

`js/lang.js` exists in the repo, is **loaded by no page** (zero `lang.js` script tags across all
30 HTML files), and **would fail if loaded** — `js/lang.js:3` uses `export function`, a syntax
error in a classic `<script>` tag. Two documents verify this independently
(`tutorial-engine.md` §4.11, `codebase-audit.md` §5.2).

**Do not build against it, and do not "fix" it as part of tutorial work.** Every page defines its
own `applyLang()`; `js/navbar.js:319–327` calls `window.applyLang` with a cruder inline fallback
that does not handle `<option>` or `title` attributes. The correct hook is the
**`nexflow:langchange` event**, which T2 adds to `js/navbar.js`.

Also, dynamically rendered content cannot rely on `applyLang()` at all — it runs once at load.
Use the `t(en, mr)` helper inline in every render function, reading
`localStorage.getItem('nexflow_lang')` fresh at render time.

### 7. Smaller items that block a specific session

| Item | Blocks | What |
|---|---|---|
| No DB uniqueness on `invoice_number` | Any session touching invoice numbering | `p2_invoices` has unique indexes on `dispatch_order_id` and `invoice_token` only. If `invoice_sequence` is ever hand-edited backward, two invoices silently share a number. Fix: `CREATE UNIQUE INDEX ON p2_invoices (tenant_id, invoice_number)` |
| Blank invoice rate persists as ₹0 | W5 (item 17), any invoice work | Not blocked client-side or server-side; silently lands on a legally-formatted tax invoice. Needs validation at the modal submit **and** in `confirmGenerateInvoice`/`confirmConsolidatedInvoice` |
| `v_p2_supplier_advance_balance.total_drawn` sums every GRN ever | Session 24 (item 49) | Not scoped to GRNs since the advance, so a new advance against a supplier with history reads as massively overdrawn immediately. Fixed **inside** Session 24 |
| Failed confirm burns a challan number | Item 10 (challan line editing) | `dispatch.html`'s version was fixed in Session 2; `rm-dispatch.html:1134` and `production-issue.html:1541` still have it |
| `get_next_challan_number` concurrency `[UNVERIFIED]` | Any high-volume session (W1, W3, P1A-3) | Needs a `pg_proc` inspection in the SQL Editor to confirm the live function is a row-locked counter, not a plain `MAX+1` read |
| `rm-dispatch.html` unchecked `.delete()` | Item 9 (P1 polish) sits next to it | `:1057-1060`, `:1173-1176`. A failed delete followed by a successful insert duplicates every line item on the challan. **Correctness work — do not half-fix it inside P1** |
| No server-side role check on invoice write handlers | W1 (item 13) | Operator can generate tax invoices; the gate is plan-only. `verifyCallerTenant` checks tenant, not role. Four lines. Scheduled in **FIX-1** |
| `check-low-stock` is an unauthenticated all-tenant fan-out | A3 (item 6) | `verify_jwt = false` with no auth inside. Fix: a shared-secret header on cron jobids 2, 3, 8, 9 (~1 hour) |
| `get-user-email` returns any user's email to any caller | Any session touching it | Cross-tenant email disclosure. `get-user-email/index.ts:33-36` |
| Filing package plan gating is undecided | A6 (item 2) | `enterprise-strategy.md` §3.2 says "Enterprise only"; `filing_package_enabled` defaults `true` for everyone. **They disagree while the cron runs.** `[RECOMMENDED]` keep it on for everyone at ~₹28/tenant/month — but ratify it before the October run, because it changes the cost table |
| `js/supabase-client.js:30-38` defaults `plan` to `'founder'` | Item 9 sits next to it | An unchecked settings fetch grants Pro features to a Lite tenant on any network blip. Should default to `'lite'` — least privilege |

### 8. P1 Part 2 prerequisites — **before any P1B session (Phase 5B)**

- **CA confirmation of all 11 statutory parameters in `p1-factory.md` §5.9, in writing.** Hard
  gate, no exceptions. At least four of the eleven have been revised in the last decade, and a
  wrong PF ceiling or PT slab is wrong on every payslip, every month, retrospectively.
- **`factory-os.md` F11 must be narrowed — not deleted — before P1B-6 (the payroll wages
  session).** F11 heading: add *"from production output"*. F11 body: replace *"no attendance, no
  payroll"* with *"no piece rate, no per-worker earnings from production rows"*. The exact
  amendment text, for all five locations, is in `p1-factory.md` §0 C1. **Do not delete F11** — a
  future session proposing piece rates must still find a `[NEVER]` with a reason attached.
- **Matrix COSEC attendance integration is deferred** until a client has that hardware. P1B-5
  covers ZKTeco only — one webhook for fingerprint, RFID and face.
- **Gratuity (Payment of Gratuity Act): `[NEVER]`** — it requires actuarial valuation and is out
  of scope.

---

## 11. The Platform Page

When a client logs into Nexflow, they see a product dashboard showing which modules they have
active. Each module has its own nav and its own quality standard.

Active modules show: plan, usage this month, quick stats.
Inactive modules show: what they do, price, upgrade button.
**"Upgrade to Nexflow OS"** appears for clients with 2+ modules but not all 4.

**This page does not exist yet. Build it in Session P1 — Product Polish (item 9 in Phase 2) as
the new `index.html` after login, replacing the current dashboard.**

**Design principle:** each module feels like a complete, premium product. Not a tab in a
cluttered interface. A product.

---

## 12. Standing Rules

These apply to every session and are repeated here so a fresh chat can be pointed at one section.

- **Never test writes against SS Engineering, Datta Prasad or Shivprasad.** Test tenant only:
  `fe2b94fb-9668-405f-9c62-5f54b32f8c7a`.
- **Test tenant `agent_tier` stays `'unlimited'` at all times.** If any code touches
  `p2_tenant_settings` broadly, verify it afterwards.
- **New migrations go through the Supabase SQL Editor, never `supabase db push`** — it replays
  old migrations.
- **Read the live definition of any CHECK constraint before changing it.**
- **PowerShell: never use `&&`.** Separate git commands on their own lines.
- **Syntax-check each file after each pass.** This is the discipline the 9-pass `export.html`
  session used and it is why that session landed cleanly.
- **Run `node _ai/regression/snapshot.js` and `diff.js` after every session**, against the **most
  recent prior snapshot** — never `baseline-pre-2H.json`.
- **The Type A guarantee.** SS Engineering is standalone. Job-work gating, pool logic and
  principal UI must be invisible to them, and material list, stock balances, CA export, Tally
  export, Zoho export, GSTR-2B buckets, challan PDFs and invoice PDFs must stay **byte-identical**
  across any change. **Any difference means the change is wrong — not that the test needs
  updating.**
- **GST scope is permanently locked.** Nexflow generates tax invoices and CA-facing exports. It
  does **not** perform GST filing or submission. Never revisit this boundary.
- **No write ever executes without an explicit human confirmation of a specific, server-computed
  plan.** No exceptions, no batching, no "always confirm" setting, no learned trust, no
  autopilot. This outranks every feature in every document.
- **Direct, zero sugarcoating, brutal verdict on design, scope and pricing decisions.**

---

*Last updated: 16 September 2026. This is a living document — update it in place as sessions
ship. Flip a status to ✅ the day it lands, correct a day estimate with the measured number, and
move a resolved item out of §10 rather than leaving it to be re-derived.*
