---
name: md-audit-report
description: Cross-document consistency and correctness audit of the ten Nexflow MD files, performed 11 September 2026 before the 1.5-month build sprint. Findings ranked by whether they would cause a session to build the wrong thing. Read before planning the sprint; do not read as a build spec.
sources: [CLAUDE.md, enterprise-strategy.md, automation-strategy.md, tutorial-engine.md, business-strategy.md, bridge-agent.md, kpml-network-plan.md, kpml-network-critique.md, codebase-audit.md, compliance-and-field-report.md]
last_updated: 11 September 2026
status: audit complete — findings not yet applied. Each fix is a targeted follow-up prompt.
---

# Nexflow — MD File Audit Report

**Scope.** All ten files, read in full: 20,606 lines plus `bridge-agent.md`'s 3,436. Every
financial table recomputed. Every schema claim cross-checked against `CLAUDE.md`'s Database Tables
section and `codebase-audit.md`'s findings. No code was read; where a claim could only be settled
against the working tree it is marked so.

**What this file is not.** It is not a build spec and must not be read as one. It records what is
wrong with the documents a session will build from.

---

## Executive Summary

The document set is in better shape than its size suggests, and the four newest files
(`bridge-agent.md`, `tutorial-engine.md`, `business-strategy.md`, `automation-strategy.md`) are
genuinely buildable — `bridge-agent.md` in particular is the strongest technical document in the
set and Sessions 18–19 can start from it without a design conversation. Every financial table in
`business-strategy.md` recomputes exactly from its own rows; I checked all of them. The problem is
not the new files. It is that **the three oldest files describe a product that no longer exists**,
and one of them (`codebase-audit.md`) instructs every session to read it first while its body
declares fourteen already-fixed defects "still present" and its priority list is roughly 60% stale.
A session obeying that instruction would spend a day re-fixing Session 1–6 work, or worse, would
believe RLS is disabled on the live financial ledger when it was enabled on 3 September.

Three things must be fixed before the sprint starts. **First, the 31-session build order in the
sprint brief does not exist in any file** — `CLAUDE.md`'s authoritative "What to build next" has 17
items, Sessions 18/19/20 are named only inside `bridge-agent.md`, and Sessions 21–31 and "P1 polish"
appear nowhere at all; the sprint will run out of written scope at roughly session 20. **Second,
`codebase-audit.md` must be re-statused or have its "read before any build session" instruction
revoked.** **Third, the October 5 filing-package run has an undocumented prerequisite** — Session
15's migration was applied to the test tenant only, with "pending: apply to all three live tenants
before the 5th of October" recorded in a Shipped entry and in no build-order item. A0 and A6 are
correctly prioritised by four independent files, but they supervise a feature that is not yet
installed on the tenants they are meant to supervise it for.

Verdict: **FIX FIRST.** Eight critical issues, resolvable in two focused sessions.

---

## Critical Issues

*Issues that would cause a session to build the wrong thing. Fix before any session starts.*

### C1 — The 31-session build order does not exist

**Files:** `CLAUDE.md` §"What to build next" (lines 2728–2778); `bridge-agent.md` §17.3/§17.4.

**Issue.** The sprint brief describes "31 sessions (A0–A8, T1–T3, Sessions 18–31, P1 polish)".
`CLAUDE.md`'s authoritative build order contains **17 numbered items** and no session numbers above
17. Sessions 18 and 19 exist only inside `bridge-agent.md`. Session 20 (Credit/Debit Notes) is named
only in `bridge-agent.md` §4 and §5.5. **Sessions 21–31 and "Session P1 — Product Polish" appear in
no file.** `grep -n "Session 2[0-9]\|Session 3[01]\|Session P1"` across `_ai/*.md` returns only
`bridge-agent.md`'s Session 20 references.

**Correct information.** The documented order is: A0 → A6 → (after KPML meeting) A2 → A3 → A4 Ph1 →
T1 → challan line editing → staff activity log → (pre-vendor-wave) A1 → T2 → consolidated
double-billing fix → (post-incorporation) A5 → A7 → T3 → (40+ clients) A4 Ph2 → E1 → Razorpay.
Session 18/19 = E1. Session 20 = Credit/Debit Notes. Everything else is unwritten.

**Sessions affected.** All of them, from roughly session 20 onward. A sprint planned against a list
that half-exists will stall when it reaches the undocumented half. Seven new spec files were written
in this session to close the largest gaps (see *Missing Specs*), but the **numbering itself must be
reconciled** — decide whether A-series and numbered sessions are one sequence or two, and write the
result into `CLAUDE.md` as the single list.

---

### C2 — `codebase-audit.md` contradicts itself and instructs every session to trust the stale half

**File:** `codebase-audit.md`. Frontmatter: *"Read before starting any build session."*

**Issue.** The file carries two irreconcilable statuses.

- Header block (lines 15–46), added after Sessions 1–4: lists ~15 items as **FIXED**.
- Part 7 (lines 1328–1345): *"**Score: 0 of 14 fixed. 14 still present**, 3 worse than reported."*
- Priority fix list (lines 1349–1414): 35 items presented as open, headed *"Do today — before the
  next build session."*

The body was never updated after Sessions 1–6, 11 and 12 shipped. At minimum these Priority-list
items are already fixed and are listed as urgent:

| # | Priority-list claim | Actually |
|---|---|---|
| 1 | RLS never enabled on `p2_stock_transactions` — **Critical, do today** | Fixed Session 1, `20260903_enable_rls_all_tables.sql` |
| 2 | Audit RLS on all 15 tables | Fixed Session 1 — 16 tables |
| 3 | `v_p2_invoice_payment_status` / `v_p2_wip_balance` bypass RLS | Fixed Session 1 |
| 4 | `handle-new-user` privilege escalation | Function **deleted** Session 1 |
| 5 | `grn.html:662/728` wrong tenant_id | Fixed Session 1 |
| 6 | Invoice rate pre-fill, no warning | Fixed Session 4 (warning + checkbox guard) |
| 8 | Payment modal: field order, balance due, over-payment, Marathi | Fixed Session 2 (all four) |
| 10 | `dispatch.html` burns a challan number per save | Fixed Session 2 — draft mode removed entirely |
| 13 | No GRN duplicate-invoice guard | UI guard shipped Session 12 (DB index still open) |
| 16 | Job-work invoice block is client-side only | Fixed Session 6 P0 — `SALE_INVOICEABLE_PURPOSES` |
| 17 | Principal pool inbound path absent | Fixed Session 4 — grn.html Material Owner selector |
| 18 | Operator can cancel/amend challans | Fixed Session 6 P1 |
| 20 | Operator can download the GST export | Fixed Session 6 P1 |
| 21 | Supervisor can cancel a tax invoice | Fixed Session 6 P1 — owner-only |
| 22 | Any role can open and edit any challan | Fixed Session 6 P1 — page gate added |
| 25 | 18-char `CHAL-` numbers | Fixed Session 11 + CA-confirmed 9 Sept |
| 26 | Accountant missing dashboard permission | Fixed Session 2 |
| 27 | `manual.html` teaches 7 deleted agent commands | Fixed (header block) |
| 30 | `api/invite-staff.js` has no role whitelist | Fixed Session 6 P1 |
| 31 | Telegram bind tokens never expire | Expiry fixed Session 6 P2 (webhook secret still open) |
| 33 | `dispatch.html` stock check fails open | Fixed Session 2 |
| 34 | Low-stock alerts on deactivated materials | Fixed Session 6 P2 |

**Genuinely still open** and worth keeping: #7 (blank rate → ₹0 on a persisted tax invoice), #9
(`v_p2_supplier_advance_balance.total_drawn` sums every GRN ever — a new advance reads as massively
overdrawn), #11 (failed confirm burns a challan number on `rm-dispatch.html` / `production-issue.html`),
#12 (`get_next_challan_number` concurrency, `[UNVERIFIED]`), #14 (invoice sequence gaps), #15
(`rm-dispatch.html` unchecked `.delete()` duplicates line items), #19 (no **server-side** role check
on the invoice write handlers — the Session 6 fix was client-side), #23 (`check-low-stock` is an
unauthenticated all-tenant Telegram fan-out), #28 (notification pipeline, six silent-failure points,
zero retries), #29 (`get-user-email` cross-tenant email disclosure), #32 (tall modals clip their
submit button at 390px), #35 (Telegram HTML injection kills the whole digest).

Also note line 12: *"Ground truth for intent: `_ai/CLAUDE.md` (**1610 lines**, read in full)."*
`CLAUDE.md` is now **2,952 lines**. The audit was performed against 55% of the current file.

**Fix.** Re-status Part 7 and the priority list against Sessions 1–17, or — cheaper and safer —
change the frontmatter to *"historical audit, 4 Sept 2026. Statuses superseded by CLAUDE.md's
Shipped entries. Read for the still-open list only."* and move the 12 genuinely-open items into
`CLAUDE.md` Known Open Items where sessions already look.

**Sessions affected.** Every session, because the file instructs itself to be read first.

---

### C3 — `hsn_source` enum mismatch: A1's spec writes a value the CHECK constraint rejects

**Files:** `automation-strategy.md` §4.1 (line 692); `enterprise-strategy.md` §3.3 rule 4 (line 1162);
`CLAUDE.md` lines 72–76 and 2176–2181.

**Issue.** Three different definitions of one column.

| Source | Definition |
|---|---|
| `enterprise-strategy.md` §3.3 | `CHECK (hsn_source IN ('manual','ai_suggested','ai_accepted'))` + `hsn_suggested_at timestamptz` |
| `automation-strategy.md` §4.1 | A1 writes `hsn_source = 'ai_suggested'` |
| **Shipped** (Session 14, `20260909_hsn_audit_source.sql`) | `CHECK (hsn_source IN ('manual','imported','ai_verified','ai_corrected'))`, **no** `hsn_suggested_at` |

**Correct information.** Only `manual`, `imported`, `ai_verified`, `ai_corrected` are permitted.
`'ai_suggested'` raises a CHECK violation. In A1 that insert happens inside
`import_onboarding_submission()` — a single all-or-nothing transaction across ten tables — so one
HSN row **rolls back the entire client import**. `hsn_suggested_at` does not exist; anything reading
it will error.

**Sessions affected.** A1 (3–4 sessions). Also any session reading `enterprise-strategy.md` §3.3 as
the HSN specification.

---

### C4 — `p2_dispatch_orders.created_by` already exists and holds the wrong value; the spec says to add it

**Files:** `CLAUDE.md` Known Open Items #9 (line 2647); `codebase-audit.md` §6.2 (line 1145);
`enterprise-strategy.md` §2 (lines 199–202).

**Issue.** `CLAUDE.md` Known Open Items #9 says to *"Add `created_by uuid REFERENCES auth.users(id)`
(nullable, no backfill) to: `p2_stock_transactions`, `p2_dispatch_orders`, `p2_invoices`,
`p2_dispatch_items`."*

`codebase-audit.md` §6.2 records that on `p2_dispatch_orders` the column **already exists** and is
*"Written as `tenantId` (`dispatch.html:1047`, `rm-dispatch.html:1043`), i.e. **the tenant, not the
user** — so it records nothing useful about who created the dispatch."* `enterprise-strategy.md` §2
repeats this as a flag for the partnership segment. It is also absent from `CLAUDE.md`'s Database
Tables entry for `p2_dispatch_orders`.

**Second error in the same item.** #9 specifies a view *"joining the above tables with `p2_staff`
(name, role)"*. **There is no `p2_staff` table.** Staff live in `p2_user_roles`, which gained an
`email` column on 3 August and whose SELECT policy was widened to tenant-wide read in Session 3
precisely so staff names could be resolved.

**Correct information.** On `p2_dispatch_orders`, `created_by` needs a **backfill decision and a
write-path fix**, not an `ADD COLUMN`. On the other three tables, confirm before adding. The join
target is `p2_user_roles`.

**Sessions affected.** Staff activity log (build order item 8).

---

### C5 — `CLAUDE.md` contradicts itself on principal pricing, and the two KPML models differ by 2×

**Files:** `CLAUDE.md` lines 423–438 vs line 2850; `kpml-network-plan.md` §12, §14, §15;
`enterprise-strategy.md` §7; `business-strategy.md` §2.1.

**Issue 1 — internal contradiction.** `CLAUDE.md` lines 423–438 state the Principal account pricing
in full and in settled form (₹1,25,000–1,50,000 setup; ₹2,50,000–3,00,000/yr platform;
₹5,000–7,000/vendor/yr beyond 20; ₹75,000 pilot). `CLAUDE.md` line 2850, under *"Step 0 decisions
locked"*, states: **"Mother-factory pricing: UNDEFINED — settle before Step 5 design begins."**
`kpml-network-plan.md` says undefined in four separate places (§11, §12, §14, §15 item 5).
`business-strategy.md` §2.1 lists it as `[DECIDED]`.

**Issue 2 — two incompatible commercial models.** `kpml-network-plan.md` §12 prices vendors as
**sponsored seats at ₹12,000–18,000/vendor/year**, all vendors, and states *"At 30 vendors ≈ ₹7–8
lakh/year."* `CLAUDE.md`, `enterprise-strategy.md` §7 and `business-strategy.md` §2.1 all price
**overage at ₹5,000–7,000/vendor/year only beyond 20**. Recomputed at 30 vendors:

| Model | Platform | Vendor component | Total |
|---|---|---|---|
| `kpml-network-plan.md` §12 — sponsored seats | ₹2.5–3.0L | 30 × ₹12–18K = ₹3.6–5.4L | **₹6.1L – ₹8.4L** |
| `CLAUDE.md` / enterprise / business — overage >20 | ₹2.5–3.0L | 10 × ₹5–7K = ₹0.5–0.7L | **₹3.0L – ₹3.7L** |

That is a 2× difference in the headline number for a meeting the documents describe as imminent.

**Sessions affected.** The KPML meeting itself; Sessions 21–22; `business-strategy.md` §4's revenue
projections, which assume the network multiplies through per-vendor Pro subscriptions rather than
sponsored seats.

---

### C6 — `enterprise-strategy.md` §3.2's filing-package spec differs from what shipped on five points

**Files:** `enterprise-strategy.md` §3.2; `CLAUDE.md` Sessions 15 and 16.

| §3.2 says | Shipped (Sessions 15–16) |
|---|---|
| 8 files, including `02-GSTR2B-Reconciliation.xlsx`, `05-Exceptions-and-Actions.xlsx`, `07-Source-Data/` | 6 files. No 02 (needs `p2_gstr2b_uploads`), no 05 (removed in S16), no 07 |
| `01-GSTR1-<GSTIN>-<MMYYYY>.xlsx` in the **GSTN V2.0 21-sheet** template | `gstr1-reference-{YYYY-MM}.xlsx`, informal **5-sheet** shape, labelled reference-only |
| Manual trigger on **`export.html`**, roles `owner/accountant/supervisor` | **`settings.html`** → Filing Package tab, **owner-only** |
| **"Enterprise plans only"** | `filing_package_enabled` defaults **`true` for every tenant** |
| Log with `intent = 'filing_package'` | `intent='filing_covering_note'` |

The plan-gating row is not a documentation nit — it is an undecided commercial question.
`automation-strategy.md` §10 Q3 flags it explicitly (*"They disagree and nobody has decided…
**Decide before: the October run.** It changes the cost table and the §8 projections"*) and
recommends keeping it on for everyone at ~₹28/tenant/month. That recommendation is sound; it has
simply never been ratified, and today the two documents say opposite things while the cron runs.

**Sessions affected.** A6 (supervises this feature, Wave 0, October deadline); Session 25 (GSTR-2B
storage, which §3.2 Phase 2 defines); any session reading §3.2 as the E2 spec.

---

### C7 — The October 5 run has a prerequisite that is in no build-order item

**File:** `CLAUDE.md` lines 2340–2341 (Session 15) vs §"What to build next" (lines 2737–2751).

**Issue.** Session 15's Shipped entry ends: *"Migration applied to test tenant. **Pending: apply to
all three live tenants before the 5th of October.**"* The IMMEDIATE build-order section lists only
A0 (0.5 session) and A6 (1 session). The live-tenant migration is not an item anywhere.

Without it, SS Engineering, Datta Prasad and Shivprasad have no `filing_recipient`,
`accountant_email` or `filing_package_enabled` columns and no `p2_filing_packages` rows. The 5
October cron selects on `.eq('filing_package_enabled', true)` — a column that does not exist on
those tenants — and either errors or silently returns nothing for them.

**Why this is critical rather than important.** `business-strategy.md` §7.1 makes the October,
November and December runs the **only** path to the March 2027 first CA referral, and §6 moat 3
calls a silently non-delivering filing package *"the reputation event §4.3 identifies as the one
thing that can actually kill this business."* The prerequisite is half a session; missing it costs
the distribution event that A6 exists to protect.

**Sessions affected.** A0/A6 sprint. Schedule it as the first item, before A0.

---

### C8 — `js/lang.js`: `CLAUDE.md` says it is the shared language mechanism; two files say it is dead and would not even load

**Files:** `CLAUDE.md` §"Language Toggle" (lines 386–387); `tutorial-engine.md` §4.11 (lines 651–654);
`codebase-audit.md` §5.2 (lines 847–853).

**Issue.**

- `CLAUDE.md`: *"Static elements: `data-en` / `data-mr` attributes, applied once by `applyLang()` on
  DOMContentLoaded **via shared `js/lang.js`** (`initLang()` call per page)."*
- `tutorial-engine.md` §4.11: *"`js/lang.js` exists in the repo and is **loaded by no page**
  `[VERIFIED — zero lang.js script tags across all 30 HTML files]`. It is a dead file with an ES
  `export` in a codebase that has no module system. **Do not build against `js/lang.js`, and do not
  'fix' it as part of this work.**"*
- `codebase-audit.md` §5.2, independently: same finding, plus *"it would also fail if loaded:
  `js/lang.js:3` uses `export function`, which is a syntax error in a classic `<script>` tag."*
  Lists eight per-page `applyLang()` copies plus an inline fallback in `js/navbar.js:319–327`.

**Correct information.** Two files with independent verification beat one stale line. Every page
defines its own `applyLang()`; `js/navbar.js` calls `window.applyLang` with a cruder inline
fallback that does not handle `<option>` or `title` attributes.

**Sessions affected.** T1 and T2 (the tutorial engine must hook the language toggle — `tutorial-engine.md`
§4.11 specifies adding a `nexflow:langchange` event to `js/navbar.js` precisely because `lang.js`
is not there), A1's review page, and any Marathi work.

---

## Important Issues

*Fix before the affected session, not before the sprint.*

### I1 — `kpml-network-plan.md` §14 "Current Status" is dated 29 August and wrong on eleven rows

| Row | Says | Actually |
|---|---|---|
| P0 invoice-type check on live clients | ⚠️ Not done — do first | Done — *"No live client has raised a Nexflow invoice on KPML as of Aug 24 2026. Zero exposure confirmed."* |
| `confirm_bom_issue` pool-blind fix | ⚠️ Not done — blocks ownership | Done (Step 2A, v3 Aug 25) |
| `p2_tenants` contradiction in CLAUDE.md | ⚠️ Unresolved | Resolved — CLAUDE.md now states in bold that it EXISTS with 10 FK dependents |
| GSTR-1 Table 13 register | Not built — Step 1 | Built Aug 25 |
| GSTR-1 Table 12 summary | Not built — Step 1 | Built Aug 25 |
| Rule 55 challan compliance | Not built — Step 1 | Neither: **explicitly dropped from scope**, 2 Sept, by request |
| 43B(h) fields + report | Not built — Step 1 | Udyam fields Aug 25; receivables report Aug 28; **payables still missing** |
| Notifications | 🔄 Next — starting now | COMPLETE Aug 31 (Step 4) |
| Supplier advance ledger | ⏳ Deferred | COMPLETE 2 Sept (Step 3.5) |
| `p2_network_links` + scoped access path | Not built — Step 6 | **Built 8 Sept (Session 9)**, with `get_principal_vendor_material()` as the scoped path |
| Mother factory pricing | ⚠️ Undefined — Step 0 | See C5 |

§16's timeline (*"October 2026 — KPML read-only principal dashboard"*) is also stale: shipped 8
September.

**Affected:** Sessions 21–22, KPML meeting prep.

### I2 — `p2_network_links` as built lacks the scope, consent and revocation columns both KPML files require

`kpml-network-plan.md` §9 Step 6 and §17, and `kpml-network-critique.md` B12, all specify a link
carrying *"explicit versioned scope + consent record + revocation timestamp — not just
active/inactive"*, with B12's reasoning: *"with no scope on the link, the scope lives implicitly in
whatever each RPC happens to select, which means it drifts silently every time an RPC is edited."*

Shipped (`CLAUDE.md` lines 1957–1962): `principal_tenant_id`, `vendor_tenant_id`,
`status (active/revoked)`, `UNIQUE(principal_tenant_id, vendor_tenant_id)`. No scope, no consent
record, no revocation timestamp, no `granted_by`.

**Mitigating fact, and it matters:** `get_principal_vendor_material()` **is** the single scoped
access path the critique demanded, with the scope boundary written as a comment inside the function.
Failure mode 6 (RPC drift) is currently defended by construction. What is missing is the *consent
record*, not the scoping. Sessions 21–22 will need an `ALTER` on a table that already carries live
KPML↔test-tenant rows.

### I3 — The consent panel and "view as principal" preview do not exist, and the principal dashboard is already live

Both KPML files treat these as prerequisites for any cross-tenant surface (`kpml-network-plan.md`
§10.5: *"give the vendor a 'view as principal' preview, which makes a leak self-reporting"*;
critique N9 and Q7). Neither exists, and neither is in the build order.

Exposure today is nil — `CLAUDE.md` Session 9 records that only the test tenant is linked, because
the three real vendors *"have no `owned_by` data yet"*. It becomes real the moment Session 9's own
open item 3 (link SS Engineering, Datta Prasad, Shivprasad) is executed, which is a prerequisite for
the November demo. **Sequence the consent panel before that data migration, not after.**

### I4 — `automation-strategy.md` carries three different cost tables and does not say which wins

| Source | 10 | 50 | 100 | 500 | 1,000 |
|---|---|---|---|---|---|
| `automation-strategy.md` §1 headline | ₹4,600 | ₹17,800 | ₹65,400 | ₹1,28,500 | ₹1,87,000 |
| `automation-strategy.md` §8.1 (infra only, self-declared "pre-correction") | ₹4,550 | ₹16,000 | ₹62,500 | ₹1,06,000 | ₹1,53,500 |
| `automation-strategy.md` §8.3 (totals) | ₹20,650 | ₹55,350 | ₹1,14,110 | ₹1,81,410 | ₹2,41,000 |
| **`business-strategy.md` §3.1 `[DECIDED]`** | **₹21,050** | **₹52,750** | **₹1,11,510** | **₹1,85,810** | **₹2,45,400** |

Authority chain: `business-strategy.md` §3.1 supersedes `automation-strategy.md` §8.3, which
supersedes §8.1 and §1. Only the first link is stated, and it is stated in `business-strategy.md`,
not in `automation-strategy.md`. A session reading only `automation-strategy.md` — which its own
load-order note invites — gets the wrong numbers twice.

Verified: §8.3 and `business-strategy.md` §3.2 both recompute exactly from their own rows.
`business-strategy.md` §3.2's claim that its infrastructure row *"reconciles line-for-line against
`automation-strategy.md` §8.1"* is **false** — it reconciles against §8.3. §8.1 charges Vercel Pro
₹1,800 at 10 clients where §3.2 charges ₹0 (Hobby), and §8.1 has no Domain line.

### I5 — Claude Max cost line disagrees between files

`automation-strategy.md` §8.2 puts Claude Max at ₹9,000 through **500** clients and concludes
*"3.7% at 1,000 clients"*. `business-strategy.md` §3.2 puts it at ₹18,000 from 500, and both it and
`CLAUDE.md` (line 2463) say **7.3%** at 1,000. Recomputed: 18,000/2,45,400 = 7.3%;
9,000/2,41,000 = 3.7%. `automation-strategy.md` is the outlier. (The 54%-at-3-clients figure is
correct in all three: 9,000/16,750 = 53.7%.)

### I6 — A4's session split and trigger are stated three ways inside one file

`automation-strategy.md` §1 table: *"2 + 1.5 sessions"*, critical at 40 clients. §4.4 header:
*"Phase 1 — 1.5 sessions. Phase 2 — 2 sessions. Phase 1 at ~25 clients"*, body: *"Useful from client
five."* §7: Phase 1 in Wave 1 (3–20 clients) at 1.5 sessions. `CLAUDE.md` build order item 5 says
1.5 sessions, agreeing with §4.4 and §7. §1's "2 + 1.5" is reversed.

### I7 — Wave 3's gate is stated both ways

`automation-strategy.md` §7 heads Wave 3 *"after incorporation completes"*, while §4.5 and §4.7 both
say their Wave 3 scope is *"build now"* and *"fully functional and unblocked"*, and §7's own Total
paragraph says *"Wave 3 items 9 and 10 are now unblocked."* `CLAUDE.md` files A5 and A7 under
**POST-INCORPORATION**. Either the gate is real or it is not; today the documents say both. Since
the Wave 3 versions use a manual trigger and touch no gateway, the unblocked reading is correct —
`CLAUDE.md`'s build order should move them.

### I8 — A6's "report monthly Opus spend" cannot be computed from the table it names

`automation-strategy.md` §4.6 specifies reporting *"total Opus spend this month, computed from
`p2_agent_logs` rows with `intent='filing_covering_note'` `[VERIFIED — that intent is already
logged]`."* The intent is logged. But `p2_agent_logs`'s columns (`CLAUDE.md` line 693) are
`tenant_id, message, intent, extracted jsonb, match_status, success, error_reason, created_at` —
**no token counts, no cost, no model**. A row count is not a spend figure. Either drop the line item
or add the columns in the same session. A6 is Wave 0 with an October deadline; decide now.

### I9 — A8's synthetic test for `filing-package` would email a real CA every morning

`automation-strategy.md` §4.8 lists the probe as *"`filing-package` | `{action:'generate'}` dry-run |
200 with a file manifest."* Session 15 records that `{ action: 'generate', tenant_id, period_month? }`
is the **manual** path with `verifyCallerTenant` applied, and that it generates, uploads to Storage
**and sends the email**. There is no dry-run mode. Two failures: a cron-invoked probe with an anon
key fails `verifyCallerTenant`; and if made to pass, it would send the test tenant's CA a package
daily and overwrite `p2_filing_packages` each time. A8 needs a real dry-run mode added to
`filing-package`, or a different probe.

### I10 — A2's proposed constants inventory has two wrong entries

`automation-strategy.md` §4.2's `_ai/compliance-constants.json` sample:

- **`s143_periods`** — *"locations: [`js/s143-clock.js`, `filing-package/index.ts`], current: [365, 1095]"*.
  But `CLAUDE.md` Session 8 records a *"Known simplification: all GRN receipts treated as 365-day
  inputs — **no capital goods 3-year band**, no tooling exemption on the GRN side."* The 1095 is not
  in `js/s143-clock.js`.
- **`gst_state_codes`** — *"current: 38 states + 97"*. `CLAUDE.md` line 1531 says export.html's map is
  *"full **37**-state map + 38 (Ladakh) + 97"*. `enterprise-strategy.md` §3.2 says *"the **38**-value
  list"*. Three counts of one constant.

The inventory is A2's deliverable and its whole value is being the authoritative record of where the
law is hardcoded. Seeding it with wrong locations defeats it.

### I11 — The invoice-purpose gate disagrees between client and server

Client (`CLAUDE.md` Step 2J, lines 1296–1298): `all-dispatch-history.html` disables Generate Invoice
when `movement_purpose != 'sale'`. Server (Session 6 P0, lines 1755–1760):
`SALE_INVOICEABLE_PURPOSES = ('sale', 'direct_supply_from_jobworker')`.

So `direct_supply_from_jobworker` — the s.143(1)(b) route that legitimately closes the clock without
a physical return, and the source of ITC-04 Table 5C — is blocked in the UI and permitted by the
server. Small fix; real consequence for any KPML vendor doing direct supply.

### I12 — `enterprise-strategy.md` §6 and §9 are overdue by six or more sessions

- §6 table: *"Phase 2 | KPML Principal Dashboard | **October 2026**"* — shipped 8 Sept.
  *"Phase 3 | ITC-04 Working Paper | **Session 8 — next**"* — shipped 8 Sept.
- §6 blocking dependencies: #1 (CHAL- 18-char) fixed Session 11; #3 (B2CL) fixed 9 Sept, CA-confirmed;
  #5 (s.143 clock from `principal_challan_date`) fixed Session 8, re-verified Session 12. Only #2
  (GRN duplicate guard — DB half) and #4 (incorporation) remain.
- §3.2's *"Still open: the s.143 clock currently starts from `dispatch_date`"* — fixed Session 8.
- §3.2's "Blocking prerequisite" box on legacy `CHAL-` numbers — resolved Session 11.
- §9 Q1 (B2CL) — answered. Q4 (filing-package logging) — answered differently from the recommendation.
- **§9 Q10** (*"What exactly are Phase 4 and Phase 5? **Decide before: Session 9**"*) — Session 9
  shipped; still unanswered.
- **§9 Q11** (*"Must the Bridge Agent land before the KPML pilot signature? **Decide before: Phase 2
  ships, not after**"*) — Phase 2 shipped; still unanswered. `bridge-agent.md` §17.6 re-raises it.

### I13 — The export's per-file sha256 is promised in a sales script and was never built

`enterprise-strategy.md` §3.4: *"`manifest.json` with per-file sha256. It makes the export
**verifiable**, which is what an auditor or a suspicious CFO will ask for."* §4 Layer 2 and
`business-strategy.md` §5.4 rule 2 both lean on it (*"technical DD asks exactly what that feature
already produces: … a manifest with per-file hashes"*).

Shipped (Session 13): *"sha256 per file **deferred to v2** (async, needs restructure)."* This is a
claim in the word-for-word sales script in §4 that the product does not support. §4's own rule 3
says *"never overclaim layer 3… one unverifiable claim retroactively discredits layers 1 and 2."*
The same logic applies here.

### I14 — AI HSN Autofill (§3.3) was never built; a different feature was, and A1 depends on the unbuilt one

`enterprise-strategy.md` §3.3 designs autofill **on a blank field at material-creation time**, with
`confidence: high|medium|low` gating the UI and a *"Suggest HSN for all blank"* batch action.
Session 14 shipped an **audit of existing codes** returning verdicts
(`correct`/`likely_wrong`/`definitely_wrong`/`no_code`). `CLAUDE.md` flags the divergence;
`enterprise-strategy.md` does not, and §1's comparison table still lists *"AI HSN autofill | yes
(free, all plans)"* as shipped.

This bites A1 directly. `automation-strategy.md` §4.1 says: *"Call the **existing** `suggest_hsn`
handler… **Confidence maps directly onto the band**: `high` → amber, `medium`/`low` → amber with the
'verify with your CA' label."* `suggest_hsn` does not return a confidence field. A1 must either map
verdicts to bands or build the autofill path §3.3 designed.

### I15 — `'ai_corrected'` is a permitted enum value with no writer

`CLAUDE.md` Session 14: *"`'ai_corrected'` (a user manually fixing a flagged code in settings.html /
products.html) is **not built yet** — noted as a follow-up."* It is not in the build order. Without
it the filing package cannot honestly report how many AI-assessed codes a human has since corrected,
which is the provenance argument §3.3 rule 4 makes the safety net.

---

## Minor Issues

*A session can handle these inline.*

- **`CLAUDE.md`'s Database Tables section omits tables that exist:** `p2_network_links` (Session 9),
  `p2_filing_packages` (Session 15), `p2_agent_logs` (documented only under "Usage logging"),
  `p2_user_roles`, `p2_pending_invites`, `p2_client_po_numbers`, and `p2_tenants` itself. A session
  looking up the schema section will not find them.
- **No `Session 10` heading exists in `CLAUDE.md`.** Principal Dashboard v2 is documented under the
  Session 11 heading (line 2099); git commit `aadc1e5` says "(Session 10)"; Session 9's own open-items
  list calls it Session 10 work; `business-strategy.md` §6 moat 2 says "Sessions 9 and 11". Four
  numberings for one deliverable.
- **`CLAUDE.md` Backlog lists three shipped items as pending:** "Return Dispatch Pool Fix (CRITICAL —
  do first)" (fixed Session 5), "ITC-04 Working Paper Export" (shipped Session 8), "KPML Read-Only
  Principal Dashboard (Step 5 — build October 2026)" (shipped Sessions 9/11).
- **Job Work build sequence markers:** Step 5 is not marked COMPLETE although the dashboard shipped;
  Step 3 has no COMPLETE marker although Steps 3.5 and 4 do.
- **`READ_ONLY_INTENTS` count:** `CLAUDE.md` says 28 and correctly lists 28. `kpml-network-plan.md`
  §8.1 and `kpml-network-critique.md` Q1 both say *"many of the 33 intents"*. Stale by five.
- **The July 30 entry still describes the Generate Invoice button as shipped on all three dispatch
  pages.** An inline Aug 25 correction (lines 772–773, 1298–1299) says it was only ever in
  `all-dispatch-history.html`. A reader skimming the July 30 entry gets the wrong picture.
- **`codebase-audit.md` frontmatter** says `last_updated: Sept 2026`; the body says "Audit date: 4
  September 2026" in one place and "Audit date: Sept 3 2026" in the resolution header.
- **`p2_stock_transactions.held_by`** is documented in `CLAUDE.md` and is half the ownership model in
  `kpml-network-plan.md` §8.1, but `codebase-audit.md` §6.2 marks its FK `[UNVERIFIED]` and no Shipped
  entry writes it. The multi-hop case (ITC-04 Table 5B) depends on it.
- **Three load orders, none authoritative:** `enterprise-strategy.md:11`, `CLAUDE.md:2707`,
  `bridge-agent.md:11`, `automation-strategy.md:11` each give a different one. All reasonable; pick one
  and put it in `CLAUDE.md`.

---

## Verified and Correct

*What a session can build from with confidence.*

1. **`bridge-agent.md` — the strongest document in the set.** Its five `[CORRECTION]` items in §0 are
   each right and each materially changes the plan: EV certificates no longer bypass SmartScreen (so
   buy OV, ~₹20,000/yr not ₹30–45,000); a confirmed dispatch must never produce a Sales voucher; no
   inventory in any voucher; bidirectional sync narrowed to a bounded name-only configuration echo;
   and the `full-export.js` REMOTEID overlap fixed by a legacy-adoption path rather than a README
   warning. Both worked voucher examples balance to zero — I recomputed them. §8's schema enables RLS
   in the same migration as the policies, uses `get_my_tenant_id()`, and creates no DELETE policy.
   §19's fourteen open questions each carry a resolution procedure. **Sessions 18 and 19 are buildable
   from this file without a design conversation.**
2. **`tutorial-engine.md`.** Internally consistent. Its central architectural argument — JSON cannot
   hold a predicate, and four gates in this app are live `isJobWorker()` / `isSeparatePoolDeduction()`
   calls — is correct and correctly sourced. ADR-5's listener-leak reasoning matches the real 17 Aug
   bug on the same four pages. It also surfaced a genuine product bug: `grn.html:217` labels the
   supplier invoice number `चलान क्र` (challan number) in Marathi, against `बिल क्र` and
   `इनव्हॉइस क्र` on two other pages. T1–T3 are buildable.
3. **`business-strategy.md` — trust this file on money.** Every table recomputes from its own rows; I
   verified §3.1 margins, §3.2 column sums, the infrastructure sub-table, §3.4's threshold arithmetic,
   §4.1/§4.2 ARR, §5.3 gross-ups and all eight of §5.4's post-tax figures. It documents four of its own
   corrections and records rather than smooths its contradiction with `automation-strategy.md` §8.4 on
   whether support is ever a hire.
4. **`CLAUDE.md`'s schema detail and agent gotchas** for the tables it does list. The RLS Fixes section,
   the `todayIST()` gotcha, `v_p2_stock_balance` not exposing `owned_by`, `challan_number` not
   `challan_no`, and the `status` / `dispatch_type` enums are all accurate and were independently
   confirmed by `codebase-audit.md`.
5. **The E4 → E3 → E2 → E1 Enterprise order.** Stated in `enterprise-strategy.md` §6, executed exactly
   (Sessions 13, 14, 15/16, 18), restated in `bridge-agent.md` §17.6. No conflict anywhere.
6. **A0 → A6 as the immediate priority.** Agreed by `CLAUDE.md`'s build order, `automation-strategy.md`
   §7 Wave 0, `business-strategy.md` §6 moat 3 and §7.1, and `bridge-agent.md` §15's dependency note —
   four files, one answer, same reasoning (5 October date plus a silent-failure mode no monitor keyed
   on `status='failed'` can detect).
7. **The two Bridge Agent hard invariants.** `owned_by IS NOT NULL` never becomes a Purchase voucher;
   a job-work dispatch never becomes a Sales voucher. Identical in `enterprise-strategy.md` §3.1 and
   `bridge-agent.md` §4.1, with three enforcement points and a named regression test.
8. **The `[LAW]`-tagged compliance core.** s.143(1) periods, s.143(2) principal obligation, s.143(5)
   scrap, Rule 55(1)'s nine particulars and the 16-character cap, Rule 45(1)/(2)/(3), Rule
   56(5)(c)/(6)/(12), Maharashtra e-way bill (₹1,00,000 intra-state; any value inter-state), ITC-04
   frequency thresholds, and 43B(h)'s Micro/Small + Udyam + non-trading scope. Each carries a section
   number and is consistent across `compliance-and-field-report.md`, `kpml-network-plan.md` §10 and the
   critique. The Rule 56(11) correction (it is the *agency* rule and does not apply to job workers) is
   a real and useful catch.
9. **The Razorpay deferral.** `[DECIDED Sept 11]`, consistent across `CLAUDE.md` #10,
   `automation-strategy.md` §1/§4.5/§7 and `business-strategy.md` §9 — including the correction that
   the fee-ratio argument is backwards and the entity binding is the actual reason.
10. **The Type A guarantee.** Identical in `kpml-network-plan.md` §2 and the critique Q8, implemented as
    NULL-defaulting columns with a regression harness (`_ai/regression/`) and a standing instruction to
    diff against the most recent snapshot rather than `baseline-pre-2H.json`.

---

## Missing Specs

| Session | Spec state | Decision |
|---|---|---|
| **A1 — Onboarding ingestion** (3–4 sessions) | `automation-strategy.md` §4.1 is architecturally complete but has no table columns, no RPC signature, and two live errors (C3, I14) | **NEW FILE created** — `_ai/onboarding-engine.md` |
| **A2 — Compliance monitoring** (1.5 sessions) | §4.2 good on architecture; feed unspecified; inventory has two wrong entries; the `[INFERRED]`→CA list does not exist | **NEW FILE created** — `_ai/compliance-monitoring.md` |
| **Sessions 21–22 — KPML network** | `kpml-network-plan.md` Steps 6–7 are gated on named requests and predate the shipped dashboard; consent model absent; principal write access undesigned | **NEW FILE created** — `_ai/kpml-network-sessions-21-22.md` |
| **Session 20 — Credit/Debit Notes** | Tally side fully specified in `bridge-agent.md` §5.5; Nexflow side has no schema, no numbering, no UI | **NEW FILE created** — `_ai/credit-debit-notes.md` |
| **Session 24 — Supplier Payables Register** | Four sentences in `CLAUDE.md` Backlog; legal chain in `compliance-and-field-report.md` §3.1; no schema, no 15-vs-45-day handling | **NEW FILE created** — `_ai/supplier-payables-register.md` |
| **Session 25 — GSTR-2B server-side storage** | `enterprise-strategy.md` §3.2 Phase 2 and §9 Q3 name the table and the constraint; no columns, no dedup key, no integration point | **NEW FILE created** — `_ai/gstr2b-server-storage.md` |
| **Session P1 — Product Polish** | **No spec anywhere.** Not named in any file. | **NEW FILE created** — `_ai/product-polish-p1.md` |
| **Session 23 — Notification Centre v2** | `CLAUDE.md` Backlog gives page, preview dropdown, Telegram deep link, the one-line `notify` change, and "no schema changes needed" | **EXISTING SPEC SUFFICIENT** — read `CLAUDE.md` §Backlog → Notification Centre v2 |
| **Challan line editing** (item 7) | `CLAUDE.md` Known Open Items #8 — hard rules, lock condition, reversal semantics, UI surface, backend shape, explicit "do not modify `confirm_dispatch_transaction`" | **EXISTING SPEC SUFFICIENT** |
| **Staff activity log** (item 8) | `CLAUDE.md` Known Open Items #9, with two schema errors (C4) | **EXPAND IN PLACE** — correct #9; do not create a file |
| **Sessions 26–31** | Do not exist | Nothing to spec. See C1. |

**A note on the seven new files.** They are written to be built from, and each names the specific
tables, columns, RPCs and file paths it touches, with a build sequence and failure modes. They are
**not** written to `bridge-agent.md`'s depth — that file is 3,436 lines and represents a session's
work on its own. Each new file is honest about what it leaves `[UNVERIFIED]`, and each carries its
open questions in a closing section rather than burying an assumption.

---

## Financial Consistency Check

| Figure | Appears in | Consistent? |
|---|---|---|
| Founder plan ₹20,000 + ₹44,000 | CLAUDE.md, enterprise §7, business §2.1 | ✅ |
| Standard Lite ₹20,000 + ₹56,000 | CLAUDE.md, enterprise §7, business §2.1 | ✅ |
| Standard Pro ₹35,000 + ₹1,00,000 | CLAUDE.md, enterprise §7, business §2.1 | ✅ |
| Enterprise ₹60,000 setup + ₹1,60,000/yr | enterprise §7, business §2.1 | ✅ (business §2.3 extends the range upward, stated as such) |
| Principal platform ₹2.5–3.0L/yr | CLAUDE.md, enterprise §7, kpml-plan §12, business §2.1 | ✅ |
| Principal setup ₹1.25–1.5L | same four | ✅ |
| **Per-vendor charge** | CLAUDE.md / enterprise §7 / business §2.1: **overage ₹5–7K beyond 20**. kpml-plan §12: **sponsored seat ₹12–18K, all vendors** | ❌ **C5** — ₹3.0–3.7L vs ₹6.1–8.4L at 30 vendors |
| Pilot 5 vendors / 90 days / ₹75,000 | CLAUDE.md, enterprise §7, kpml-plan §12, business §7.2 | ✅ |
| Datta Prasad ₹1,35,000 due 10 Sep | CLAUDE.md ×3, enterprise §5, business §2.2 | ✅ consistent — **but no file records whether it arrived** (A1 below) |
| Shivprasad terms | business §2.2 `[UNVERIFIED]`, §10 Q7 | ⚠️ Not recorded in CLAUDE.md at all; §3.6 nonetheless counts ₹1,00,000 from them |
| Infrastructure by scale | automation §8.1 vs §8.3 vs business §3.2 | ❌ **I4** — three tables, one supersession stated |
| Total cost by scale | automation §1 vs §8.3 vs business §3.1 | ❌ **I4** |
| Claude Max at 500 clients | automation §8.2: ₹9,000. business §3.2: ₹18,000 | ❌ **I5** |
| Claude Max share at 1,000 | automation §8.2: 3.7%. business §3.2 + CLAUDE.md: 7.3% | ❌ **I5** — both arithmetically correct for their own input |
| Claude Max share at 3 clients | 54% — all files | ✅ (53.7%) |
| AI running cost | automation §8.2 modelled vs §8.3 budgeted | ⚠️ ~2× gap; explained in business §3.2 ("~2× headroom, deliberately"), unexplained in automation |
| business §3.2 column sums | all six columns | ✅ verified exact |
| automation §8.3 column sums | all five columns | ✅ verified exact |
| business §3.1 margins | 17.6 / 69.7 / 89.0 / 89.7 / 97.0 / 98.3% | ✅ all recompute from their own rows |
| 90% margin crossing ~65 clients (~105 if Team bought early) | business §3.4, CLAUDE.md line 2459 | ✅ and the non-monotonic dip at 100 is correctly flagged |
| Break-even ~3 clients, actually −0.5% | business §3.6, CLAUDE.md line 2460 | ✅ arithmetic correct — assumes both Datta Prasad and Shivprasad at ₹1L (see A1) |
| Happy-path ARR 2026–2031 | business §4.1 | ✅ every row recomputes from clients × ARPU |
| Worst-case ARR | business §4.2 | ✅ and the ₹157.5 Cr pre-tax/post-tax error is caught and corrected in place |
| Exit gross-ups at 20/22/23% | business §5.3 | ✅ |
| All eight §5.4 post-tax figures | business §5.4 | ✅ verified at 22% |
| **₹3,34,000 collected; 3 paying + 1 new this month** | the sprint brief | ❌ **appears in no file** — `grep` returns zero matches across all ten |
| Opus filing package ₹22 typical / ₹63 busy | enterprise §3.2, automation §4.6 (blended ₹28) | ✅ |
| A2 ₹92/month flat | automation §1 (~₹90) and §4.2 (₹92) | ✅ |

---

## Compliance Verification Needed

*`[INFERRED]` claims already built into the product, or that A2 will encode as authoritative. A2
scans for the law moving away from a constant — so a constant that was never right produces a
scanner that is confidently wrong in the same direction indefinitely. That is precisely the
twenty-two-month B2CL failure A2 exists to prevent, reintroduced at the point of design.*

**Must be CA-confirmed before A2 is built:**

| # | Claim | Where it is built | Why it matters |
|---|---|---|---|
| 1 | **45-day 43B(h) threshold applied universally** | `export.html` per-row `due_date = invoice_date + 45`; `v_p2_invoice_payment_status`'s overdue predicate | `[LAW]` is **45 days with a written agreement, 15 without** (compliance report §11, kpml-plan §10.4). Nexflow has no agreement record and no `agreement_days` column, so it applies 45 to everyone. The disclaimer discloses the gap; the number is still wrong for any client without a written agreement. A2 will inventory this as one constant. |
| 2 | **Interest simple, not compounded** | `export.html` 43B(h) card — 3× RBI bank rate, simple | MSMED s.16 `[LAW]` compounds **with monthly rests**. Understates exposure. |
| 3 | **RBI bank rate 6.5% hardcoded** | same | Not in A2's proposed inventory at all, and it changes. |
| 4 | **All GRN receipts treated as 365-day inputs** | `js/s143-clock.js` (Session 8) | No capital-goods 3-year band; no tooling exemption on the GRN side. Both are `[LAW]` distinctions. This clock is rendered to KPML on `principal-dashboard.html` and into `itc04-workingpaper.html`. |
| 5 | **`is_exempt_tooling` has no UI** | Step 2K stub | Moulds, dies, jigs, fixtures and tools have **no time limit** under the proviso to s.143 `[LAW]`. They cannot be marked, so `capital_goods_issue` always gets +3yr. `CLAUDE.md` called the false alarms harmless in Step 2K; they are now on a principal's dashboard. Compliance report §1.6 is emphatic that the right surface is a register with periodic attestation, not a nulled deadline — the Tooling Register shipped in Session 3, but the flag that feeds it has no way to be set. |
| 6 | **ITC-04 frequency driven by the *tenant's* `aato_bracket`** | `itc04-workingpaper.html` | Compliance report §1.1: *"for a vendor generating a working paper for KPML, the relevant turnover is **KPML's**, not the vendor's. That is a new field on the principal record."* Not built. A vendor under ₹5cr generating KPML's paper will default to annual when KPML files half-yearly. |
| 7 | **s.122(1) — ₹10,000 or tax evaded** | Not in the product; in the CA-facing narrative | Carries an explicit `[VERIFY]` in its own source: *"I am confident of the substance but have not re-read the clause text this session."* Do not quote to a client. |
| 8 | **Flat 18% invoice split** | `buildInvoiceTotals` in `agent-query` | `[LAW]`-correct for engineering job work post-22 Sep 2025, and the limitation is named (5% textile/food, 1.5% diamond). A2's inventory calls it a "deliberate simplification", which is right — but it means A2 will never flag a rate change that matters for a future textile client. Record that as intentional. |
| 9 | **s.19 direct supplier → job worker** | Not modelled | The clock runs from the **job worker's receipt date**, not any dispatch. `clockStart = principal_challan_date \|\| transaction_date` is accidentally right for this case and wrong in principle. |
| 10 | **s.168A COVID extension reaching s.143 periods** | Not in the product | `[INFERRED]` from an exclusion list. Only matters for a historical position. Low priority. |
| 11 | **Commissioner extension process** | `s143_extension_until`, write-only stub, no order-reference field | `[INFERRED]`; *"no published instance of an extension being granted."* Compliance report §1.5 is right that an extension with no order reference **converts a visible exposure into an invisible one**. Do not give the field a UI without the mandatory reference. |
| 12 | **Rule 56(11) does not apply to job workers** | Correctly absent from all product copy | `[LAW]`. Flag it so it never enters marketing — the compliance report gives the exact correct response if a CA cites it. |

**Already CA-confirmed and safe:** B2CL ₹1,00,000 (9 Sept) and `CH-YYMMDD-NNNN` under Rule 55
(9 Sept). Both are closed.

**Recommended ask:** one hour with a CA covering items 1, 2, 4, 5, 6 and 7 before A2 starts, and
write the answers into `_ai/compliance-monitoring.md` §7, which is laid out to receive them.

---

## Additional Findings

**A1 — The current revenue base is unverified in both directions.** Datta Prasad's ₹1,35,000 was due
**10 September 2026**; today is the 11th. `CLAUDE.md` gives the exact `UPDATE` to run on
confirmation and says `plan` stays `'founder'` until then. No file records whether it arrived.
`business-strategy.md` §2.2 flags Shivprasad's Pro conversion as `[UNVERIFIED]` and *"not recorded
anywhere in CLAUDE.md"* — yet §3.6 computes the break-even position from ₹2,00,000/year, which
requires **both** at ₹1L. And the brief's *"₹3,34,000 collected, 3 paying clients + 1 new this
month"* appears in no file. Before any figure is quoted: confirm the Datta Prasad payment, flip the
plan, and record Shivprasad's actual terms in `CLAUDE.md` in the same shape.

**A2 — Where E1 sits is contradicted, and the question that would settle it is overdue.**
`enterprise-strategy.md` §6: *"ENTERPRISE BLOCK … After Phase 2, **before KPML pilot signing**."*
`CLAUDE.md`'s build order: E1 is item 16, gated on **40+ clients**. `bridge-agent.md` §17.6 names the
tension and declines to resolve it: *"the founder should decide explicitly rather than by default."*
That decision is `enterprise-strategy.md` §9 Q11, whose own deadline (*"before Phase 2 ships"*)
passed on 8 September.

**A3 — `scanner.html`'s GRN path has no duplicate-invoice check at all,** and `bridge-agent.md` §4.4
identifies the consequence more precisely than `CLAUDE.md` does: because a duplicate groups into the
**same** `(supplier_id, normalised invoice_no)` key, it produces the **same REMOTEID**, so Tally
alters in place and the client's books end up with **one voucher at double the correct amount** —
worse than two vouchers, because two are visible in a Day Book and one wrong amount is not. The DB
partial unique index is `bridge-agent.md` §17.3 **step 1**, before anything else in Session 18.

**A4 — Dead Edge Functions are unowned.** `codebase-audit.md` flags `confirm-dispatch` (zero callers,
queries a non-existent column, would pass every stock check as `NaN`), `get-user-email` (cross-tenant
email disclosure), and `supabase/functions/invite-staff/` (superseded by `api/invite-staff.js`, and
the two have diverged). `CLAUDE.md` records only `handle-new-user` as deleted. No build-order item
owns the cleanup.

**A5 — `check-low-stock` is an unauthenticated all-tenant Telegram fan-out** (`verify_jwt = false`,
zero auth in the function, four modes including one that writes `p2_notifications` rows for every
tenant). This is `codebase-audit.md` #23, still genuinely open, and it will matter more as the book
grows. The fix is a shared-secret header on cron jobids 2, 3 and 8 — roughly an hour.

---

## Recommended Fix Order

**Session F1 — document truth (1 session).** Nothing here touches code.

1. **C7** — add "apply Session 15's filing-package migration to all three live tenants" as build-order
   item 0, before A0. Half a session of its own; schedule it this week.
2. **C2** — re-status `codebase-audit.md`: change the frontmatter instruction, mark Part 7 and the
   priority list historical, and move the 12 still-open items into `CLAUDE.md` Known Open Items.
3. **C1** — reconcile session numbering. Decide whether A-series and numbered sessions are one
   sequence, then write the single authoritative list into `CLAUDE.md` "What to build next".
4. **C5** — settle principal pricing. Pick one vendor model, delete the other from
   `kpml-network-plan.md` §12, and remove the "UNDEFINED" line from `CLAUDE.md`'s Step 0 block.
5. **C6** — decide the filing-package plan gate (`automation-strategy.md` §10 Q3 recommends "on for
   everyone"; take the decision explicitly) and bring `enterprise-strategy.md` §3.2 into line with
   what shipped on all five points.
6. **C8** — correct `CLAUDE.md`'s Language Toggle section to match the two verified findings.
7. **A1 (additional finding)** — confirm the Datta Prasad payment, flip `plan`, record Shivprasad's
   terms.

**Session F2 — spec corrections (1 session).** Also documentation-only.

8. **C3** — correct the `hsn_source` enum in `automation-strategy.md` §4.1 and
   `enterprise-strategy.md` §3.3 to the four shipped values; delete `hsn_suggested_at`.
9. **C4** — rewrite `CLAUDE.md` Known Open Items #9: `created_by` needs a value fix on
   `p2_dispatch_orders`, not an `ADD COLUMN`; the join target is `p2_user_roles`, not `p2_staff`.
10. **I1** — re-status `kpml-network-plan.md` §14 and §16.
11. **I4, I5, I6, I7** — add a one-line supersession note to `automation-strategy.md` §8 pointing at
    `business-strategy.md` §3.1; fix the Claude Max row; fix A4's session split; move A5/A7 out of
    POST-INCORPORATION in `CLAUDE.md`.
12. **I12** — re-status `enterprise-strategy.md` §6 and close or re-date §9 Q10 and Q11.
13. **I13, I14, I15** — mark the sha256 claim unbuilt, mark §3.3 as superseded by what Session 14
    shipped, and add `'ai_corrected'` to the build order.

**Then:** the per-session issues (I2, I3, I8, I9, I10, I11) are handled inside the sessions they
affect, and each is named in the relevant new spec file.

**Estimate: 2 sessions to clear everything critical.** Neither touches code, so both can run in
parallel with incorporation and neither blocks A0.

---

## Verdict

**FIX FIRST — 8 critical issues, estimated 2 sessions to resolve.**

None of the eight is a design failure; all eight are the documents having fallen behind a codebase
that shipped eleven sessions in six days. The newest four files are strong enough to build from
today, and `bridge-agent.md` in particular is ready. But three of the eight would cause a session to
build the wrong thing on contact — C3 would roll back an entire client import, C4 would run an
`ADD COLUMN` on a column that already exists, and C2 would send a session re-fixing twenty items
that were fixed a week ago — and two more (C1, C7) mean the sprint would run out of written scope
around session 20 while the October distribution event went unprepared.

The two fix sessions are documentation-only. They do not block A0, they do not block incorporation,
and they should run before the first build session rather than alongside it.

---

*Audit performed 11 September 2026. Findings not yet applied — each fix is a targeted follow-up.
Seven new spec files were created in the same session; they are listed under Missing Specs and are
not covered by this audit's own findings.*
