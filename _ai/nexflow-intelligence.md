---
name: nexflow-intelligence
description: The Nexflow Intelligence layer — read-only reasoning over one tenant's real data. Business advisor queries, the bottleneck finder, instant report generation (inspection, bank stock statement, working capital, capacity), the internal compliance report, proactive alerts, the aggregation architecture and its backing SQL, cost and pricing at the ₹60,000/year add-on, and an honest account of what it cannot do. No writes, no confirm gate. Read in full before writing any aggregation or report code.
sources: [founder-brief-sept-2026, codebase-verification-sept-13-2026, CLAUDE.md, nexflow-agent.md, factory-os.md, nexflow-mcp.md, business-strategy.md, enterprise-strategy.md, automation-strategy.md, bridge-agent.md, kpml-network-plan.md]
last_updated: 13 September 2026
status: design complete — not yet built. Living document: update in place as it is built.
---

# Nexflow — The Intelligence Layer

> **`nexflow-agent.md` replaces the inventory person. `factory-os.md` replaces the supervisor's
> paperwork. This document replaces the management consultant nobody in MIDC could afford to hire
> in the first place.**
>
> Nexflow already records what happens in a factory. The Intelligence layer is the answer to the
> only question that follows: *now that you hold all of it, what can you do with it that the
> factory owner cannot do for themselves?*
>
> The answer is not a dashboard. A dashboard shows a number and leaves the thinking to a person
> who is already out of time. The answer is **reasoning over this factory's actual rows** — 264
> specific materials, a real dispatch history, real payment behaviour — producing statements
> grounded in fact and specific enough to act on.
>
> **The proof that this works already exists and it is unusually concrete.** On Datta Prasad's
> August data, unprompted, `claude-opus-5` identified 78 dispatch challans with zero sales
> invoices (naming the challan range, a parallel series, and four missing numbers individually),
> 15 GRN lines at 0% GST against identical 18% goods (naming all 12 invoice numbers), one orphan
> GRN with no supplier and no invoice number, 623 unaudited materials and 50 dispatched items with
> no HSN. **None of them were Nexflow bugs** `[VERIFIED — CLAUDE.md Session 16]`. That happened
> once a month, in a zip file, addressed to a CA. **This document makes it a conversation,
> addressed to the owner, available on a Tuesday afternoon.**

**Load order for any session building this. Read in this order, in full:**

1. `_ai/CLAUDE.md`
2. `_ai/nexflow-agent.md` — **§0 C6 (the read discipline) and §3 D4 are load-bearing here and are
   not restated.** The model classifies and narrates; deterministic code queries and computes. The
   model never touches the database and never authors a number.
3. `_ai/nexflow-intelligence.md` (this file)
4. `_ai/factory-os.md` — **the data half of this layer's ceiling.** Every production, quality,
   worker and capacity answer in §4 and §6 is unreachable until that document is built, and §0 C2
   is the consequence.
5. `supabase/functions/filing-package/index.ts` — `fetchCoveringNoteData`, `callOpusCoveringNote`,
   `buildCoveringNoteHtml`. **The working precedent for everything in §6.** Read the three-layer
   fallback chain before designing a fourth one.
6. `supabase/functions/agent-query/index.ts` — 3,298 lines `[VERIFIED]`. `executeQuery()` at
   `:802`, `buildContext()` at `:296`, `verifyCallerTenant()` at `:267`, `todayIST()` at `:795`.

`_ai/nexflow-mcp.md` §5.2 is the sibling consumer of §3's aggregators — a CA's own Claude reads the
same numbers with no model on Nexflow's side. `_ai/business-strategy.md` §6 ranks the moats this
layer completes. `_ai/automation-strategy.md` §2's rule R1 and §3.3's job queue are inherited
without restating their justification.

**Status: designed, not built.** Nothing named in §3–§9 exists in the codebase. Every codebase fact
below was read against the working tree on 13 September 2026 and is marked `[VERIFIED]`.

**What this document is for.** A future Claude Code session must be able to build **Intelligence
Session 1 — the data aggregation layer** (§14.3) from this file without asking a design question.
Where a decision could not be made from here — because it needs a measurement, a live tenant with
enough history, or a table that does not exist yet — it is tagged `[UNVERIFIED]`, repeated in §17,
and given an exact procedure for resolving it.

---

## Tag convention

Inherited from `nexflow-agent.md`, `factory-os.md` and `bridge-agent.md`, unchanged.

| Tag | Meaning |
|---|---|
| `[DECIDED]` | Decided. Build it as written. Do not relitigate. |
| `[RECOMMENDED]` | This document's recommendation. Needs founder sign-off before build. |
| `[VERIFIED]` | Confirmed against the live working tree or a primary source, 13 Sept 2026. |
| `[UNVERIFIED]` | Needs a live check or a measurement before code is written. Repeated in §17. |
| `[CORRECTION]` | The brief that commissioned this document, or an existing Nexflow document, states something the codebase contradicts. Read the correction before planning around the older text. |
| `[NEVER]` | Permanently out of scope. |

---

## 0. Corrections to the brief — read these first

Nine. Two change what can be built at all, four change what an answer is allowed to say, and three
change the architecture. A session that plans from the brief without reading this section will
write queries against tables that do not exist, and will ship a number that is confidently wrong
in a direction a factory owner would act on.

### `[CORRECTION]` C1 — "Never Sonnet for cost" is backwards, and the right reason to skip Sonnet is not cost

The brief instructs: *"Which model? (Haiku for simple lookups, Opus for multi-data reasoning —
never Sonnet for cost.)"*

The outcome is right. **The reason given is the opposite of true**, and a reason is what a future
session applies to a case this document did not anticipate. Current pricing, confirmed three ways
in `nexflow-agent.md` §0 C1 `[VERIFIED]`:

| Model | Model ID | Input $/MTok | Output $/MTok |
|---|---|---|---|
| Claude Haiku 4.5 | `claude-haiku-4-5` | 1.00 | 5.00 |
| Claude Sonnet 5 | `claude-sonnet-5` | 2.00 | 10.00 |
| Claude Opus 5 | `claude-opus-5` | 5.00 | 25.00 |

**Sonnet 5 is 2.5× cheaper than Opus 5 on both input and output.** "Never Sonnet for cost" would,
applied literally, force every non-Haiku call onto the *more* expensive model. Anyone reasoning
from that sentence reaches a worse answer than its own author intended.

**The correct justification, and it survives the next price change:** the routing decision here is
between *one aggregate* and *several aggregates that must be weighed against each other*. That is
a real, statable distinction and it maps cleanly onto two models. There is no third distinction for
Sonnet to sit on, and **a middle tier whose boundary nobody can state is a tier that gets chosen
wrongly.** If a measurement later shows Opus is overkill for a named intent, the fix is to move
that intent to Haiku — not to introduce a third band. §2 I5 makes this `[DECIDED]`.

Cost is genuinely not the constraint here, and §10 shows why: Intelligence runs a handful of times
per tenant per *day*, not fifty times, so it never crosses the volume line `nexflow-agent.md` §9.5
identifies for the write layer.

### `[CORRECTION]` C2 — The flagship bottleneck example cannot be computed. Two of its three legs do not exist.

The brief's canonical statement of what "intelligence" means:

> *"Your KS6 rejection rate is 8% vs 2% for KS4, adding 1.4 days per order, and the pattern started
> in August when you changed copper wire supplier."*

Broken into its data dependencies:

| Claim | Needs | Status |
|---|---|---|
| "KS6 rejection rate 8%" | `p2_quality_records` | **Does not exist.** `factory-os.md` §11.5, designed, not built |
| "adding 1.4 days per order" | `p2_production_orders` + `p2_production_progress` + a due date | **Do not exist.** `factory-os.md` §11.2, §11.4 |
| "started in August when you changed copper wire supplier" | `p2_stock_transactions.supplier_id` over time | **Exists today** ✓ |

`grep -ril "production_order\|p2_workers\|quality_record"` over the whole working tree returns
**zero matches** `[VERIFIED — 13 September 2026]`, the same check `factory-os.md` records for
itself.

**This does not kill the bottleneck finder. It splits this entire document into two waves**, and
the split is the single most important structural fact in it:

| | **Wave 1 — buildable today** | **Wave 2 — gated on Factory OS** |
|---|---|---|
| Data | stock, GRN, consumption, dispatch, challan, invoice, payment, supplier, s.143, HSN, movement purpose | production orders, progress, workers, assignments, quality records |
| Advisor intents | `sales_trend`, `inventory_health`, `payment_risk`, `material_cost_analysis`, `compliance_exposure`, `supplier_performance` | `production_efficiency`, `quality_trend`, `capacity_available` |
| Bottleneck finder | **cash and material flow** — stock-outs, invoice lag, payment lag, GRN cadence, rate drift | **production and quality** — the brief's example |
| Reports | inspection, bank stock statement, working capital, capacity (degraded, §6.5) | production efficiency |
| Alerts | missing invoice numbers, payment risk, days-of-cover, s.143, uninvoiced dispatches, GST-rate anomalies | worker rejection rate |

**The honest consequence for a session plan:** the Production Efficiency Report (the brief's report
(e)) and the Bottleneck Finder's headline example are **Wave 2, gated on `factory-os.md` sessions
1–4.** A session that builds them in Wave 1 will write SQL against five tables that do not exist
and will not discover it until deploy.

**And Wave 1 is not the consolation prize.** It contains the highest-value single artefact in this
document — the inspection report (§7) — and every alert the brief names except one. Roughly 70% of
the value and 100% of the demo.

### `[CORRECTION]` C3 — No live tenant has enough history for trend analysis, and none will until early 2027

Changepoint detection needs a baseline. §5.3 sets the floor at **six complete monthly periods**,
and the floor is not negotiable — a "trend" from two months is a line through two points, and
naming a cause for it is fabrication with arithmetic attached.

Against the live book `[VERIFIED — CLAUDE.md Tenants]`:

| Tenant | Onboarded | Complete months as of 13 Sept 2026 |
|---|---|---|
| Datta Prasad Enterprises | 17 Aug 2026 | **0** |
| Shivprasad Industries | 19 Aug 2026 | **0** |
| S.S. Engineering | client 1, live since at least July 2026 | 1–2 |

**No live tenant can demonstrate a trend feature today, and the earliest any of them can is roughly
February 2027.** This is a scheduling fact, not a limitation of the design, and it reorders the
build:

- **Point-in-time features work on day one and are demonstrable on day one.** The inspection
  report, the bank stock statement, the working capital summary, every alert, and the whole of
  `compliance_exposure` need one moment, not a series.
- **Trend and changepoint features are correct and undemonstrable until 2027.** They must be built
  — the data accumulates whether or not anything reads it — but they cannot carry a demo, a pilot
  or a sales conversation before then.

§14.3 orders the sessions accordingly: **point-in-time first.** The brief's own first example
(*"our sales dropped this month, what happened?"*) is therefore split in §4.2 — the period
comparison ships in Wave 1 at two periods; the attribution half refuses until six exist.

### `[CORRECTION]` C4 — "Which clients are most profitable?" is unanswerable for every current client, and the reason is not the query

The brief specifies: *"Invoiced amounts vs material cost of BOM for dispatched products. Real
margin analysis."*

Three independent problems, any one of which is disqualifying:

1. **All three live tenants are job workers for KPML** `[VERIFIED — CLAUDE.md]`. The material in
   their factories is KPML's. Its cost is **not their cost**, and subtracting it from their job
   charges produces a number that is not a margin in any sense. `movement_purpose` and `owned_by`
   exist precisely to preserve that distinction, and a margin calculation that ignores them throws
   it away.
2. **Datta Prasad's 97 `p2_product_prices` rows are KPML SAP purchase rates, not job-work
   charges**, and `CLAUDE.md` forbids using them for invoicing `[VERIFIED]`. Any per-product
   revenue figure built on them is wrong by construction.
3. **Nexflow holds no labour, overhead, power, machine-time or consumable cost anywhere in the
   schema.** There is no column for any of them and none is planned. Even for a tenant who owns
   their material, "invoice minus BOM" is contribution after material — not profit, and not close
   enough to call profit to an owner who will act on it.

`[DECIDED]` **The words "profit" and "margin" never appear in an Intelligence answer.** What ships
instead is `client_contribution` (§4.5): revenue recognised per client, material consumed against
that client's dispatches valued at the tenant's own purchase rates, and the difference **labelled
"after material only"** with the excluded cost categories named in the same sentence. For a job
worker the material line is suppressed entirely and the answer is revenue and volume, with one
sentence saying why there is no cost side.

This is one of the few places Intelligence is deliberately less impressive than the brief asks, and
it is the right trade. **An owner who reprices a customer on a fake margin loses money on a Nexflow
number.**

### `[CORRECTION]` C5 — "Should we stock up on copper wire?" needs a supplier lead time that exists nowhere in the schema

The brief's input list is *"consumption trend + current stock + typical reorder lead time +
upcoming production orders."* Two of the four are unavailable, for different reasons:

- **Reorder lead time.** `factory-os.md` §13.3 establishes it and this document inherits it
  unchanged `[VERIFIED]`: **Nexflow has no purchase-order receiving model.** `p2_client_po_numbers`
  is outbound; there is no expected-delivery date anywhere in the schema, and no observed lead time
  to derive one from, because **a GRN records what arrived and never what was promised.**
- **Upcoming production orders.** `p2_production_orders` does not exist (C2).

What *can* be computed honestly, today, and is genuinely useful:

| Available | Source |
|---|---|
| Consumption rate per material, per working day | `p2_stock_transactions` type `consumption` — §3.4 |
| Current balance, own pool | `v_p2_stock_balance` |
| Days of cover at the observed rate | §3.4 |
| **Observed interval between GRNs** for this (supplier, material) | `p2_stock_transactions` type `grn` — §3.7 |
| Rate direction over the last N receipts | §3.6 |

**The observed GRN interval is a reorder *cadence*, not a lead time**, and the difference is the
whole point: cadence says how often this factory has historically bought; lead time says how long
the supplier takes after being asked. Nexflow knows the first and cannot know the second.

`[DECIDED]` The answer names the cadence, labels it as such in the same sentence, and **never
states or implies a delivery date.** §12.3 carries the disclaimer text.

### `[CORRECTION]` C6 — The working capital report's payables leg is a number the codebase already knows is wrong

The brief specifies: *"outstanding payables (GRNs without payment recorded)."*

There is no payables register. `CLAUDE.md`'s Backlog is explicit: *"Supplier Payables Register —
`p2_supplier_advances` tracks advances paid. Missing: a payables register showing what the factory
owes its MSME suppliers, days outstanding, 43B(h) breach risk"* `[VERIFIED]`. It is Session 24 on
the build sequence.

Worse, the one existing surface that looks like it answers this is a known-broken number:
`v_p2_supplier_advance_balance.total_drawn` **sums every GRN ever recorded for that supplier, not
GRNs since the advance** — `CLAUDE.md` Known Open Items #14, High, still open `[VERIFIED —
20260902_create_supplier_advances.sql:74-81`, confirmed by reading the view body]. A report built
on it shows every supplier as massively overdrawn the moment a first advance is recorded.

`[DECIDED]` §6.4's payables section computes **GRN value in the period minus advances recorded in
the period, both date-scoped**, presents it as an **upper bound**, and states in the report itself:
*"Nexflow records supplier advances but not individual supplier payments. This figure is what was
purchased less what was advanced — an upper bound on what is owed, not a reconciled payables
balance."* It must not read `v_p2_supplier_advance_balance` until Known Open Items #14 is fixed.
§12.5.

### `[CORRECTION]` C7 — The 43B(h) risk direction in the brief's alert example is the opposite of the tenant's own exposure

The brief's third proactive alert: *"Nashik Motor Traders invoice 82 is 52 days outstanding. MSME
payment risk."*

Invoice 82 is a **receivable** — a client owes the tenant. Section 43B(h) disallows **the buyer's**
income-tax deduction when they fail to pay an MSME supplier within the agreed period. On a
receivable the 43B(h) exposure sits with **the client**, not the tenant. The tenant's exposure is
cash flow.

This is not pedantry. `CLAUDE.md`'s Backlog states it directly: *"The actual 43B(h) legal risk is on
payables (who you owe) not receivables (who owes you). The 43B(h) surface in export.html currently
measures receivables — placeholder only"* `[VERIFIED]`. The existing surface was already retitled
once for this reason, from "Section 43B(h) — MSME Payment Compliance" to "Client Payment Status"
`[VERIFIED — Session 3]`.

`[DECIDED]` §8.4's payment alerts carry **two labels that are never merged**:

- **Receivable overdue** → *"₹X from <client> is N days outstanding."* Cash-flow framing. If the
  tenant is itself an MSME, one further line notes the client's own 43B(h) position is the lever —
  genuinely useful to know before making the call.
- **Payable to an MSME supplier** → *"₹X to <supplier> may be past the agreed period. If they are a
  registered micro or small enterprise, this is a 43B(h) disallowance risk on your own return."*
  Conditional, because Nexflow does not hold supplier Udyam data — `udyam_number`,
  `enterprise_class` and `registration_activity` are on `p2_clients`, **not** on `p2_suppliers`
  `[VERIFIED — confirmed against export.html:2134]`.

That last fact is a real gap and §12.5 owns it: **Intelligence cannot confirm a supplier is an
MSME, because the columns that would say so exist only on the client side.**

### `[CORRECTION]` C8 — Intelligence must not be built on `mcp_read`, and the reason decides the whole factoring

The brief asks: *"New action type `intelligence_query` or extend existing `mcp_read` from
nexflow-mcp.md."*

**Neither, exactly — and the answer is more interesting than either option.**

`nexflow-mcp.md` D3 is a keystone decision: *"No model anywhere in the MCP path. Neither adapter
nor `mcp_read` calls Anthropic. Not for classification, not for formatting, not for
summarisation"* `[VERIFIED]`. Intelligence **is** a model call. Routing Intelligence through
`mcp_read` would void D3 for that path and remove the four properties it buys — zero inference
cost, zero added latency, zero classification error, and a deterministic response that §17 of that
document asserts with byte-equality tests.

But the two share something real, and seeing it correctly is the architectural decision of this
document:

```
                    ┌──────────────────────────────────┐
                    │  THE AGGREGATORS  (§3)           │
                    │  SQL + bounded TypeScript.       │
                    │  Deterministic. No model. Ever.  │
                    └───────┬──────────────────┬───────┘
                            │                  │
        action:'intelligence_query'     action:'mcp_read'
                            │                  │
                            ▼                  ▼
              Haiku classify → Opus/       returned raw
              Haiku narrate                (the CA's own Claude
              (Nexflow pays)                reasons — mcp D3)
                            │                  │
                            ▼                  ▼
                  the owner's answer      the CA's answer
```

`[DECIDED]` **The aggregators are shared. The narration is not.** New action `intelligence_query`
on `agent-query` for the owner-facing path; the same aggregator functions exposed to `mcp_read` for
the CA-facing path with no model on Nexflow's side.

Three consequences, and the third is commercial:

1. **One implementation of every number**, which is the discipline `nexflow-mcp.md` §5.2 states as
   *"`executeQuery()` is called, not copied — a second one is two answers to one question."*
2. **A CA and an owner asking the same question get the same figure.** `nexflow-mcp.md` §17.4 item
   20 makes that its headline test; Intelligence inherits it (§18.2 item 9).
3. **It resolves the apparent conflict between Intelligence and the MCP.** A CA can already point
   their own Claude at this data for free. Intelligence is therefore not sold on "an AI can reason
   over your factory" — the MCP gives that away deliberately, as distribution. **Intelligence is
   sold on the aggregators**: the SQL that turns 264 materials and eighteen months of transactions
   into six numbers worth reasoning over. §13.2.

### `[CORRECTION]` C9 — "A formatted document in 30 seconds" is achievable, but only if the model is optional

An Opus call producing 600–1,200 words of narrative over a bounded input is realistically 20–40
seconds. `filing-package` had to raise `max_tokens` from 2,000 to 6,000 after Opus truncated at
4,660 characters `[VERIFIED — Session 16]`; that is not a fast call. Add aggregation and the brief's
30 seconds is optimistic for a narrated report and comfortable for a deterministic one.

**Two facts make this a non-problem if the report is structured correctly:**

- **The valuable half of the inspection report needs no model at all.** A stock register, a GRN
  register, a challan register and an s.143 clock table are exact ledger output. Nothing is
  interpreted; nothing should be.
- **Supabase's Edge Function limit is a CPU budget, not a wall-clock one.** `CLAUDE.md` records
  server-side jsPDF being abandoned because *"221ms CPU hits EarlyDrop even on Supabase Pro (400ms
  total budget)"* `[VERIFIED]`. An awaited network call burns no CPU — `filing-package` already runs
  Opus calls and builds zips inside an Edge Function without trouble.

`[DECIDED]` §6.2's two-phase build: **deterministic sections render first and completely; the
narrative arrives after and is never load-bearing.** If Opus fails, times out or returns malformed
output, the report ships with every register intact and one line where the narrative would be. This
is `filing-package`'s three-layer guarantee applied to a document instead of a zip, and the
reasoning is identical: *"a daily report that sometimes does not arrive teaches the owner to stop
expecting it."*

The CPU finding has a second, load-bearing consequence for §3: **an aggregation whose scanned row
count grows with tenant history must run in Postgres, never as a PostgREST fetch reduced in
TypeScript.** §2 I4.

---

## 1. Executive Summary

### 1.1 What it is

**A fourth layer on the same Edge Function, and the only one that never writes.**

```
  READ LAYER          agent-query, shipped           28 intents, one record each
  WRITE LAYER         nexflow-agent.md, designed     propose -> confirm -> RPC
  FACTORY OS          factory-os.md, designed        production nouns
  INTELLIGENCE        this document                  aggregate -> reason -> answer
```

The owner asks a business question, or asks for a document. Nexflow aggregates the tenant's real
rows in Postgres, computes every figure deterministically, and hands a bounded summary to a model
whose only job is to order the facts and write the sentences.

```
  "Our sales dropped this month. What happened?"
        |
        v
  +---------------------------------------------------------------+
  | agent-query  { action: 'intelligence_query' }                  |
  |                                                                |
  |  1. verifyCallerTenant()      unchanged                        |  <- existing
  |  2. plan + intelligence gate  fresh DB read, never isPro()     |
  |  3. Haiku classify            question -> intent + params      |  <- model: intent only
  |  4. AGGREGATE                 SQL. Every number decided here.  |  <- code
  |  5. Opus or Haiku narrate     from the computed numbers only   |  <- model: prose only
  |  6. log to p2_agent_logs      fire-and-forget                  |
  +---------------------------------------------------------------+
        |
        v
  "Sale challans fell from 34 in August to 11 in September. All 23 of the
   drop is KPML: they took 31 in August and 8 so far. Every other client is
   flat. Two things happened in the same window and I cannot tell you which
   matters -- Stator Stack KS4 was at zero stock for 6 days from the 4th,
   and KPML's own order pattern may simply have changed. Nexflow can see
   the first and cannot see the second."
```

**Three properties in that answer, and each is a design rule rather than a flourish:**

- **Every number is traceable to one SQL result.** "34", "11", "23", "31", "8", "6 days" were all
  computed before the model was called. §2 I2 makes it structural and §18.1 asserts it.
- **The attribution names a confounder it cannot see.** §5.5. Nexflow observes stock-outs; it does
  not observe a customer changing their mind, and the second is more often the real cause.
- **It does not offer to do anything about it.** Intelligence has no write path at all. §2 I1.

### 1.2 Why this is a different product from the three layers below it

The write layer and Factory OS both make an existing action cheaper. **Intelligence makes an action
possible that the owner has never taken**, and that is a different sale.

An MIDC factory owner today decides on gut feel and a WhatsApp thread. Not because they are
careless, but because the alternative costs money they do not have: a management consultant who
would spend three weeks assembling what Nexflow already holds, and charge more than a year of
subscription to do it once. **The data was never the obstacle. Assembling it was.**

There is a second, sharper reason this is a different product, and it is the commercial one.
Everything below this layer is bought by the person who *records* things — a storekeeper, a
supervisor, an accountant. **Intelligence is bought by the person who decides things**, and that
person has a budget, a reason to renew, and nobody else offering them anything.

### 1.3 What it costs

| | |
|---|---|
| Simple advisor query, Haiku narrate | **₹0.40** (§10.1) |
| Complex advisor query, Opus narrate | **₹3.30** |
| Generated report, Opus narrative over bounded input | **₹8.00** |
| Proactive alert, per tenant per day | **₹0.10** (fires ~40% of days) |
| Realistic Intelligence client, per month | **≈ ₹156** |
| Heavy client at the §11 fair-use ceiling | **≈ ₹388** |
| Margin at ₹60,000/year, realistic use | **96.9%** |
| Margin at ₹60,000/year, at the ceiling, 60% Opus mix | **92.2%** |
| Build to a usable advisor + inspection report | **3 sessions** (§14.3) |

**Intelligence does not repeat the write layer's cost problem, and the reason is arithmetic rather
than luck.** `nexflow-agent.md` §9.5's finding — that AI stops being a rounding error at the write
layer — rests on volume: fifty transactions a day, roughly 1,500× more often than any per-tenant
per-month workload. **Intelligence runs three to six times a day.** It is two orders of magnitude
below the line that broke the old rule, so the old rule holds here and §10.4 shows the working.

### 1.4 The non-negotiable properties

Four. The first two are inherited and outrank everything in this document.

1. **No write, ever, by any path.** Not a proposal, not a draft, not a "helpful" correction to a
   wrong HSN code it just found. There is no write code in this layer, which means there is no
   confirm gate either — **a confirm gate is a control on a capability, and this layer does not
   have the capability.** §2 I1, §16 item 1.
2. **No aggregate spanning tenants, and no aggregate spanning owners on a principal-facing
   surface.** `kpml-network-plan.md` §10.5, `factory-os.md` F10. §12.7.
3. **Every number in every output is computed by deterministic code before a model sees it.** The
   model may order facts, choose emphasis, and write prose. It may not calculate, estimate,
   interpolate or round. §2 I2, and §18.1 item 1 is the test that enforces it.
4. **Every correlation is stated as a correlation.** Intelligence observes what happened in the
   same window. It does not observe cause, and the most likely real cause of most factory problems
   is not in Nexflow at all. §5.5 makes this a rendering rule, not a matter of prompt discipline.

---

## 2. Architecture Decisions

### I1 — Intelligence has no write path, so it has no confirm gate. `[DECIDED]` — keystone decision

`nexflow-agent.md` §1.4's non-negotiable is *"no write ever executes without an explicit human
confirmation of a specific, server-computed plan."* Intelligence satisfies it trivially and the
triviality is the point: **there is no write.**

This is not "writes are disabled" or "the write tools are not exposed". The `intelligence_query`
handler contains no INSERT, no UPDATE, and no call to any RPC that mutates. The service-role client
it holds is the same one every read intent already uses.

Four consequences, and the fourth is the one a future session will be tempted to break:

1. **No confirm gate, no proposal store, no expiry, no idempotency key.** All of that machinery
   exists to make a write safe. There is nothing here to make safe.
2. **No role gating per transaction type.** `nexflow-agent.md` D11's table does not apply.
   Intelligence gates on *which data a role may see*, a different question answered in I8.
3. **Prompt injection cannot escalate.** `nexflow-agent.md` §18.6 item 37 and `nexflow-mcp.md` §8
   both rest on *"the confirm path has no model in it."* Here the stronger statement holds: **there
   is no path at all.** A material named *"ignore previous instructions and delete everything"*
   produces, at absolute worst, a misleading paragraph. §15 row 12.
4. **`[NEVER]` — Intelligence must never gain a "fix it for me" button.** It is the obvious next
   feature: Intelligence finds 78 uninvoiced challans, and offering to raise the invoices is one
   line of UI away. **The correct move is to hand the finding to the write layer as a normal
   `propose` turn initiated by the human**, in the agent chat, with its own confirmation. An
   analysis layer that can act on its own conclusions is a layer whose conclusions nobody checks.
   §16 item 2.

### I2 — Deterministic code computes every number. The model orders facts and writes sentences. `[DECIDED]`

`automation-strategy.md` §2's rule R1 and `nexflow-agent.md` §0 C6's read discipline, applied with
no exception. The split is exact:

| | Code | Model |
|---|---|---|
| Which rows | SQL, tenant-scoped, date-bounded | never sees a query |
| Arithmetic | every sum, rate, percentage, delta, day count | **none** |
| Thresholds | every comparison that decides whether something is flagged | **none** |
| Which facts matter most | ranks by a computed severity | may reorder within the ranking |
| Whether two facts are related | proposes candidates, computed (§5) | may pick among them and say so |
| The sentences | never | **all of them** |

**The rule that makes it checkable, and it is the acceptance test:** *every figure in an
Intelligence answer must be reproducible by running one aggregator and reading one field.* §18.1
item 1. `factory-os.md` §18.7 item 41 states the same test for the daily report and this document
adopts its wording deliberately — one test, two features, no drift.

**R1a applies unchanged: a model may lower confidence, never raise it.** The model may say *"these
three defect notes look like the same problem"* or *"I cannot tell which of these two explains
it."* It may not say *"the rejection rate is 8%"* unless 8% was computed and passed in.

### I3 — One Edge Function. A new `body.action`, not a new function. `[DECIDED]`

`intelligence_query` becomes the **eighth** `body.action` handler on `agent-query`, alongside the
six that exist today — `confirm_receive_grn`, `confirm_generate_invoice`, `resend_invoice`,
`confirm_consolidated_invoice`, `preview_consolidated_invoice`, `suggest_hsn` `[VERIFIED —
index.ts:3184-3213]` — and the seventh, `mcp_read`, that `nexflow-mcp.md` §5.2 adds.

Same reasoning as `suggest_hsn` (Session 14) and `nexflow-agent.md` D1: single-tenant,
caller-authenticated, already covered by `verifyCallerTenant`, already holding the Anthropic client,
`SB_SECRET_KEY` and `p2_agent_logs`. *"No new page, no new Edge Function."*

**The one exception, and it follows `automation-strategy.md` §4.3's counter-precedent exactly:**
§8's proactive alert sweep is **cross-tenant, scheduled, and loops with a model call inside it.**
That gets its own function, `intelligence-sweep`, for the same reason `ops-digest` did. §8.6.

`agent-query/index.ts` is 3,298 lines `[VERIFIED]` and this adds to it. The honest trade is
unchanged from `nexflow-agent.md` D1 — one deploy target, one auth path, one log path against a
longer file. **If the file must be split, split `executeQuery()`'s read switch, not this.**

### I4 — An aggregation whose scanned rows grow with tenant history runs in Postgres. `[DECIDED]`

§0 C9. The rule is crisp and checkable:

> **If the number of rows scanned is proportional to the tenant's history rather than to the size
> of the answer, it is a Postgres function. Otherwise it is TypeScript.**

| Aggregator | Scans | Where |
|---|---|---|
| `sales_trend` | every invoice + dispatch in N months | **SQL** |
| `inventory_health` | every consumption row in the window, across 264 materials | **SQL** |
| `material_cost_analysis` | every GRN row in N months | **SQL** |
| `supplier_performance` | every GRN row, grouped | **SQL** |
| `payment_risk` | one row per open invoice — bounded by open invoices, not by history | **TypeScript** over `v_p2_invoice_payment_status` |
| `compliance_exposure` | several already-bounded queries | **TypeScript**, reusing §3.8's shared module |
| Report assembly | joins already-small result sets | **TypeScript** |

Three reasons, in descending order:

1. **The CPU budget.** `CLAUDE.md`'s abandoned server-side jsPDF at 221ms of CPU against a 400ms
   budget `[VERIFIED]`. Reducing 40,000 `p2_stock_transactions` rows in Deno is exactly that shape
   of work; a `GROUP BY` in Postgres is not.
2. **PostgREST pages.** A tenant with eighteen months of transactions exceeds the default page size,
   and a session that does not notice writes an aggregator that is silently wrong on exactly the
   tenants that matter most.
3. **One implementation, three callers.** `intelligence_query`, `mcp_read` (§0 C8) and the §8 sweep
   all call the same function. A TypeScript aggregator inside `agent-query` is not reachable from
   `intelligence-sweep` without a copy.

**Every Postgres aggregator is `SECURITY INVOKER` with an explicit `p_tenant_id` parameter** — the
posture `confirm_bom_issue` already has, and the trap `factory-os.md` F3 spells out: `SECURITY
DEFINER` would run as `postgres`, bypass RLS on every table it touches, and convert a
tenant-isolation bug into a cross-tenant read. The Edge Function's `verifyCallerTenant` is the real
gate, as it already is for every existing path.

### I5 — Haiku classifies. Haiku or Opus narrates, chosen by intent, in a lookup table, in code. `[DECIDED]`

§0 C1. Two models, one deterministic routing table:

| Stage | Model | Why |
|---|---|---|
| Question → intent + params | **`claude-haiku-4-5`** | Exactly the read layer's existing job. Fixed intent set, code-side entity matching, nothing to reason about. |
| Narrate a **single** aggregate | **`claude-haiku-4-5`** | One result set, obvious shape. *"Stock fell from X to Y"* is phrasing, not judgment. |
| Narrate **several** aggregates that must be weighed against each other | **`claude-opus-5`** | The judgment `filing-package` Session 16 proved Opus does and a smaller model does not — Opus independently found 78 uninvoiced challans, 15 wrong-rate GRN lines and one orphan GRN in one pass over Datta Prasad's raw rows `[VERIFIED]`. |

**The routing is a constant, not a decision the model makes.** `NARRATION_MODEL: Record<Intent,
'haiku' | 'opus'>`, read before the call.

> A model that can escalate itself to Opus is a model that can spend money.
> A model that can de-escalate itself to Haiku is a model that can degrade an answer silently.
> **Neither direction is acceptable, so neither is available.**

Two API facts, both `[VERIFIED]` in `nexflow-agent.md` D5 and both easy to get wrong here:

- **Assistant prefill returns 400 on Opus 5 and Sonnet 5.** Do not use it to force JSON shape. The
  shape is enforced by `parseIntelligenceJson()` (§4.7), cloned from `filing-package`'s
  `parseCoveringNoteJson()`.
- **Opus 5 and Sonnet 5 take `thinking: {type:'adaptive'}`; `budget_tokens` is rejected with a
  400.** `[RECOMMENDED]` For report narration use adaptive thinking with `output_config: { effort:
  'medium' }` — the task is bounded synthesis over supplied figures, and `high` buys nothing but
  latency on a path an owner is watching.

**Sonnet 5 is not used and the reason is not cost.** §0 C1.

### I6 — Every aggregator returns a bounded summary, never raw rows. `[DECIDED]`

The input to a narration call is **counts, aggregates, and at most N named exemplar rows per
section** — never a table dump. This is `automation-strategy.md` §4.3's bounding rule and
`filing-package`'s `CoveringNoteData` shape, and it does three things at once:

1. **Cost stays flat as a tenant grows.** A tenant with 264 materials and one with 2,000 produce
   the same-shaped input. §10's figures do not move with the book.
2. **The narration cannot invent a row it was not given.** A model handed 8 exemplar invoices
   cannot name a ninth.
3. **It forces the ranking into code.** "The five worst" is a computed decision with a stated
   ordering, which is I2.

`[DECIDED]` **Caps: 10 exemplar rows per section, 12 monthly periods per series, 6 sections per
narration call.** A section with more than 10 qualifying rows passes 10 plus an exact count of the
remainder, and the narrative is **required** to state the remainder — *"and 63 others"* — so the
owner never mistakes a sample for a total. §18.3 item 14.

### I7 — Intelligence is opt-in per tenant and defaults off. `[DECIDED]`

`p2_tenant_settings.intelligence_enabled boolean NOT NULL DEFAULT false`, including for existing Pro
and Founder tenants.

The same posture as `agent_write_enabled` (`nexflow-agent.md` §8.2), `factory_os_enabled`
(`factory-os.md` §11.7), `agent_mcp_enabled` (`nexflow-mcp.md` §13), `is_job_worker` and
`separate_pool_deduction` `[VERIFIED]`. A migration must never switch on a new capability across
three live production tenants on the day it runs.

**Plan gate: Pro, Founder and Enterprise. Never Lite, never the demo tenant.** Read from a **fresh**
`p2_tenant_settings` row on every call — never `isPro()`, which reads `localStorage` and returns a
stale plan after a change without re-login, a trap `CLAUDE.md` documents twice `[VERIFIED]`. The
demo tenant `5f021c96-2ed4-41f8-9fbc-7db517fc840b` is excluded by id as well as by flag; it backs
the public landing page and `agent_enabled = false` there is deliberate `[VERIFIED]`.

### I8 — Role gating is about visibility, and it filters the aggregate, not the answer. `[DECIDED]`

Intelligence has no transactions to gate, but it does surface figures not every role should see.
`js/roles.js`'s existing `ROLE_PERMISSIONS` is the source of truth and Intelligence adds no new
role `[VERIFIED]`.

| Intent / report | Roles |
|---|---|
| `inventory_health`, `supplier_performance`, `compliance_exposure` | owner, supervisor, accountant |
| `sales_trend`, `payment_risk`, `client_contribution`, `material_cost_analysis` | owner, accountant |
| Inspection report, working capital, bank stock statement | **owner only** |
| Capacity report | owner, supervisor |
| Anything Wave 2 (production, quality) | owner, supervisor |

Two rules that make this more than a list:

- **The gate runs before the model call, and a refused request makes zero Anthropic calls.**
  `factory-os.md` §18.6 item 30's assertion, adopted here as §18.4 item 19. A refusal that costs
  ₹3.30 is a refusal that can be used as a denial-of-wallet.
- **The gate filters the aggregate, not the sentence.** An operator who somehow reaches
  `payment_risk` is refused the aggregator — never handed the figures with a model instructed to
  omit them. **A model told to withhold a number it can see is one prompt away from disclosing
  it.**

Resolved via `get_my_role` — **never a direct `p2_user_roles` read**, which recurses under RLS
`[VERIFIED — documented in js/auth.js]`.

### I9 — Intelligence is metered and never blocked. `[DECIDED]`

`check_and_increment_agent_usage` — the 30/50/day counter — is **not** called. Three reasons, the
first two inherited:

- `nexflow-agent.md` §0 C4: *"A meter that can refuse to record a dispatch at 4pm because the day's
  allowance ran out is not a quota, it is an outage with an invoice attached."* An owner refused an
  answer about their own business on the 30th of the month learns not to ask.
- `nexflow-mcp.md` §0 C4 reaches the same conclusion and notes **the live bug beside that counter**:
  it resets on `CURRENT_DATE`, which on Supabase is **UTC**, while its own error string claims
  *"Resets at midnight IST"* `[VERIFIED — 20260808_agent_usage_plan_aware.sql:33, :56]`. The real
  reset is 05:30 IST. Not a blocker here — Intelligence does not use it — but a wrong sentence shown
  to paying clients today, and it should be fixed by whichever session touches that file next.
- Intelligence's cost per call is high enough to matter and its volume low enough that a *daily* cap
  is the wrong instrument entirely. §11's monthly fair-use ceiling with billed overage is the right
  one.

`intelligence_queries_this_month` increments on every classified query and every report. Reset is
lazy on first use of a new **IST** month, computed with `todayIST()` — never `CURRENT_DATE`, the
mistake live in the counter beside it.

### I10 — Reports are stored, not regenerated. `[DECIDED]`

A generated report is written to `p2_intelligence_reports` with its computed data, its narrative and
its rendered HTML, verbatim.

**Re-rendering from stored data at read time would show what the report *would say today*, not what
it said when the owner printed it and handed it to an inspector.** That is the same frozen-snapshot
discipline as `p2_invoices.items` (which the PDF renderer reads and never re-joins) and
`p2_agent_proposals.confirm_text` `[VERIFIED]` — and here it is stronger, because **the inspection
report is an artefact that was shown to a third party.** *"What did you show them?"* is a question
that must have an exact answer three months later.

**Stored in the table, not in Storage.** `filing-package` uses a Storage bucket because it ships a
zip of binaries; Intelligence ships one self-contained HTML document of roughly 50–150KB. A `text`
column avoids a bucket, a retention policy, a signed-URL expiry and a second failure mode. §9.2.

### I11 — Alerts are deterministic. The model phrases them and never decides them. `[DECIDED]`

Every alert condition in §8 is a SQL predicate. The model is called **only** when something has
already fired, and only to write the sentence.

This is `factory-os.md` §8.5's rule (*"exactly four conditions, all computed in SQL before the model
sees anything"*), and it is what makes alert volume predictable, testable and — critically —
**explainable to the owner.** An alert a person cannot get an exact reason for is an alert they
learn to dismiss.

`[DECIDED]` **One alert per condition per object, once — not once per day.** An alert re-fires only
after its condition has cleared and recurred. §9.3's `p2_intelligence_alerts` exists to make that a
database fact rather than a fragile query over notification history.

### I12 — Alerts run on the job queue from day one. Never a loop. `[DECIDED]`

`automation-strategy.md` §1 finding 3 `[VERIFIED]`: `filing-package/index.ts` loops tenants strictly
sequentially and somewhere between ~20 and ~60 tenants the invocation is killed mid-loop, leaving
the remaining tenants with **no row, no failure status, and nothing any monitor can detect.**

`factory-os.md` F12 applies that to a daily report; this document applies it to a daily sweep, which
is the same shape again — a per-tenant loop with a model call inside it. **A6's `p2_job_queue` is a
hard prerequisite. If A6 has not shipped when Intelligence's alert session starts, build A6 first**
— the instruction `bridge-agent.md` §15 and `factory-os.md` F12 both give.

§8.6 specifies the dispatcher-and-drain shape.

---

## 3. The Aggregation Layer

**This section is Intelligence Session 1 and it is the whole of it.** Everything after it — the
advisor, the bottleneck finder, the reports, the alerts — is a consumer. Build this correctly and
the rest is assembly; build it loosely and every consumer inherits the looseness.

### 3.1 The contract

```ts
// supabase/functions/_shared/intelligence.ts
//
// The single implementation of every Intelligence figure. Called by:
//   agent-query        action 'intelligence_query'   (owner path, narrated)
//   agent-query        action 'mcp_read'             (CA path, raw -- nexflow-mcp.md D3)
//   intelligence-sweep alert conditions              (cross-tenant, scheduled)
//
// NO MODEL CALL IS EVER MADE FROM THIS MODULE. It computes; it does not judge.
// Shared-module directory follows automation-strategy.md A0's _shared/ops.ts
// and nexflow-mcp.md 5.4's _shared/s143.ts precedent.

export interface AggregateWindow {
  tenantId: string
  from: string          // YYYY-MM-DD, IST calendar date, inclusive
  to: string            // YYYY-MM-DD, IST calendar date, inclusive
}

export interface AggregateResult<T> {
  intent: string
  window: { from: string; to: string; periods: number }
  rows: T[]                       // capped -- see I6
  omitted: number                 // exact count of rows beyond the cap, 0 when none
  coverage: Coverage              // what this answer is allowed to claim
  computedAt: string              // todayIST()
}

export interface Coverage {
  periodsAvailable: number        // complete monthly periods with any data
  sufficientForTrend: boolean     // periodsAvailable >= 2
  sufficientForAttribution: boolean // periodsAvailable >= 6   -- section 5.3
  poolScope: 'own' | 'principal' | 'both'
  excluded: string[]              // human-readable, e.g. "principal-owned material"
  caveats: string[]               // rendered verbatim -- section 12
}
```

**`coverage` is not metadata. It is the half of the result that stops the answer being wrong**, and
it is passed to the narration call alongside the rows. Three of its fields do load-bearing work:

- `sufficientForTrend` / `sufficientForAttribution` implement §0 C3's two different thresholds on
  the same intent. When false, the narration prompt receives an explicit instruction not to make
  the corresponding claim, **and** the consumer refuses before the model is called (§4.4).
- `excluded` names what the query deliberately left out. A job worker's answer that silently
  omitted KPML's material is an answer they will misread.
- `caveats` carries §12's disclaimer strings from the aggregator that knows they apply. **A
  disclaimer chosen by the renderer is a disclaimer that goes missing when a new renderer is
  added.**

### 3.2 Conventions every aggregator obeys without exception

| Convention | Rule |
|---|---|
| **Dates** | IST calendar dates throughout. `todayIST()` at `agent-query/index.ts:795` on the TypeScript side; `(now() AT TIME ZONE 'Asia/Kolkata')::date` in SQL. **Never `CURRENT_DATE`, never `new Date().toISOString()`** — the off-by-one `CLAUDE.md` documents at five fixed call sites `[VERIFIED]`. |
| **Periods** | Monthly buckets keyed `to_char(<date>, 'YYYY-MM')` on an **IST** date column. A month is complete only if `to` is on or after its last day; an incomplete current month is labelled and never compared like-for-like against a complete one. |
| **Tenant scope** | Every function takes `p_tenant_id` explicitly and filters on it. `SECURITY INVOKER`, never `DEFINER` (I4). |
| **Pool scope** | Own-material figures filter `owned_by IS NULL`. **A principal's material never enters a cost, valuation or revenue figure.** §12.2. |
| **Dispatch dates** | `p2_dispatch_orders.dispatch_date`, **never the consumption rows' `transaction_date`** — `confirm_dispatch_transaction` writes those with raw `NOW()` (UTC), so a dispatch confirmed between 00:00 and 05:30 IST dates its consumption a day early `[VERIFIED — factory-os.md §3.5]`. |
| **Invoice figures** | `invoice_date` and `status = 'sent'`. Never `created_at`, never including drafts. §3.9 and the prerequisite in §14.2 P1. |
| **Movement purpose** | `NULL` means the row predates the migration. Treat as **`unknown`**, never as `sale` — the rule `CLAUDE.md` states for `p2_cancelled_challans` `[VERIFIED]`. Every bucketing query carries an explicit third bucket. |
| **Working days** | Derived from the tenant's own observed activity over the trailing 90 days — distinct dates with any transaction — never a configured calendar. `factory-os.md` §5.6's rule, inherited. Falls back to 6/week when fewer than 30 days of history exist, **and says so in `caveats`**. |
| **Thresholds** | Self-referential against the tenant's own history. **Never a hardcoded plausibility constant** — `nexflow-agent.md` §6.5's rule: *"the tenant's own history supplies the norm … never a hardcoded plausibility table, which would be customer-specific logic and wrong for the next industry."* |
| **Empty results** | An aggregator with no qualifying rows returns `rows: []` with a populated `coverage`. It never returns null, and the consumer must distinguish *"nothing qualified"* from *"not enough data to ask"* — they produce different sentences (§4.4). |

**The working-day helper, written once:**

```sql
-- Distinct days on which this tenant recorded ANY stock movement, trailing 90.
-- Self-calibrates around Sundays, Diwali and a shut week with no calendar to
-- maintain -- factory-os.md 5.6. Returns NULL when history is too thin;
-- callers fall back to 6/week and set a caveat.
CREATE OR REPLACE FUNCTION nx_working_day_rate(p_tenant_id uuid, p_as_of date)
RETURNS numeric LANGUAGE sql STABLE AS $$
  SELECT CASE WHEN COUNT(DISTINCT transaction_date) >= 30
              THEN COUNT(DISTINCT transaction_date)::numeric / 90
              ELSE NULL END
    FROM p2_stock_transactions
   WHERE tenant_id = p_tenant_id
     AND transaction_date > p_as_of - 90
     AND transaction_date <= p_as_of;
$$;
```

### 3.3 `sales_trend` — Wave 1

**Answers:** *"Our sales dropped this month, what happened?"* · *"How did September compare to
August?"* · *"Which client fell away?"*

**The correction that shapes the whole aggregator:** for a job worker, rupees and reality diverge.
Datta Prasad had **78 confirmed sale dispatches and zero sales invoices** in August `[VERIFIED —
Session 16]`. An answer that says *"your sales were ₹0"* is worse than no answer. So this aggregator
returns **two parallel series — challans and rupees — and the consumer is required to lead with
the divergence when it exists** (§4.2).

```sql
-- 3.3a  Invoiced value per IST month. invoice_date + status='sent' ONLY.
--       Ties exactly to invoices.html and export.html Sheet 2 by construction.
CREATE OR REPLACE FUNCTION nx_sales_value_by_period(
  p_tenant_id uuid, p_from date, p_to date)
RETURNS TABLE (
  period text, invoice_count bigint, taxable_value numeric,
  gst_value numeric, invoiced_total numeric, client_count bigint)
LANGUAGE sql STABLE SECURITY INVOKER AS $$
  SELECT to_char(i.invoice_date, 'YYYY-MM'),
         COUNT(*),
         COALESCE(SUM(i.amount_subtotal), 0),
         COALESCE(SUM(i.amount_gst), 0),
         COALESCE(SUM(i.amount_total), 0),
         COUNT(DISTINCT i.client_id)
    FROM p2_invoices i
   WHERE i.tenant_id = p_tenant_id
     AND i.status = 'sent'                    -- never draft, never cancelled
     AND i.invoice_date BETWEEN p_from AND p_to
   GROUP BY 1 ORDER BY 1;
$$;

-- 3.3b  Physical outward movement per IST month, bucketed by purpose.
--       dispatch_date, never the consumption rows' transaction_date (3.2).
--       NULL movement_purpose is its own bucket -- never folded into 'sale'.
CREATE OR REPLACE FUNCTION nx_dispatch_volume_by_period(
  p_tenant_id uuid, p_from date, p_to date)
RETURNS TABLE (
  period text, sale_challans bigint, jobwork_challans bigint,
  unknown_purpose_challans bigint, total_challans bigint, client_count bigint)
LANGUAGE sql STABLE SECURITY INVOKER AS $$
  SELECT to_char(d.dispatch_date, 'YYYY-MM'),
         COUNT(*) FILTER (WHERE d.movement_purpose IN ('sale','direct_supply_from_jobworker')),
         COUNT(*) FILTER (WHERE d.movement_purpose IS NOT NULL
                            AND d.movement_purpose NOT IN ('sale','direct_supply_from_jobworker')),
         COUNT(*) FILTER (WHERE d.movement_purpose IS NULL),
         COUNT(*),
         COUNT(DISTINCT d.client_name)
    FROM p2_dispatch_orders d
   WHERE d.tenant_id = p_tenant_id
     AND d.status = 'confirmed'
     AND d.dispatch_date BETWEEN p_from AND p_to
   GROUP BY 1 ORDER BY 1;
$$;

-- 3.3c  Per-client movement, so "which client fell away" is answered by data
--       and not by a model comparing two totals. Capped by the caller (I6).
CREATE OR REPLACE FUNCTION nx_sales_by_client_period(
  p_tenant_id uuid, p_from date, p_to date)
RETURNS TABLE (
  period text, client_name text, sale_challans bigint,
  invoiced_total numeric)
LANGUAGE sql STABLE SECURITY INVOKER AS $$
  WITH challans AS (
    SELECT to_char(d.dispatch_date,'YYYY-MM') AS period,
           d.client_name, COUNT(*) AS sale_challans
      FROM p2_dispatch_orders d
     WHERE d.tenant_id = p_tenant_id AND d.status = 'confirmed'
       AND d.movement_purpose IN ('sale','direct_supply_from_jobworker')
       AND d.dispatch_date BETWEEN p_from AND p_to
     GROUP BY 1,2),
  billed AS (
    SELECT to_char(i.invoice_date,'YYYY-MM') AS period,
           i.client_name, SUM(i.amount_total) AS invoiced_total
      FROM p2_invoices i
     WHERE i.tenant_id = p_tenant_id AND i.status = 'sent'
       AND i.invoice_date BETWEEN p_from AND p_to
     GROUP BY 1,2)
  SELECT COALESCE(c.period, b.period),
         COALESCE(c.client_name, b.client_name),
         COALESCE(c.sale_challans, 0),
         COALESCE(b.invoiced_total, 0)
    FROM challans c FULL OUTER JOIN billed b
      ON b.period = c.period AND b.client_name = c.client_name
   ORDER BY 1, 4 DESC;
$$;
```

**Three details that are not obvious and are each load-bearing:**

- **`client_name` joins the two halves, not `client_id`.** `p2_dispatch_orders` carries a frozen
  `client_name` snapshot and no `client_id`; `p2_invoices` carries both. A `FULL OUTER JOIN` on the
  name is the only bridge available today. **It is imperfect** — a renamed client splits into two
  rows — and `coverage.caveats` says so when the join produces a name present on only one side.
- **`FULL OUTER`, not `LEFT`.** A client billed this month with no challans (a consolidated invoice
  covering an earlier period) and a client dispatched-to but never billed (Datta Prasad's whole
  August) are both real, and both are exactly what the question is asking about.
- **The incomplete current month is returned, flagged, and never used as a trend point.** §3.2.

### 3.4 `inventory_health` — Wave 1

**Answers:** *"What are we about to run out of?"* · *"Should we stock up on copper wire?"* · *"What
is sitting dead?"*

```sql
-- Consumption rate, days of cover, and dead stock in one pass.
-- own pool only: owned_by IS NULL. A principal's material is not ours to
-- reorder and not ours to value (3.2, 12.2).
CREATE OR REPLACE FUNCTION nx_inventory_health(
  p_tenant_id uuid, p_as_of date, p_window_days int DEFAULT 90)
RETURNS TABLE (
  raw_material_id uuid, material_name text, material_code text, unit text,
  current_stock numeric, min_stock_level numeric,
  consumed_qty numeric, consuming_days bigint,
  rate_per_working_day numeric, days_of_cover numeric,
  last_consumed date, last_received date, latest_rate numeric,
  stock_value numeric)
LANGUAGE sql STABLE SECURITY INVOKER AS $$
  WITH consumption AS (
    SELECT st.raw_material_id,
           SUM(-st.quantity)                  AS consumed_qty,
           COUNT(DISTINCT st.transaction_date) AS consuming_days,
           MAX(st.transaction_date)            AS last_consumed
      FROM p2_stock_transactions st
     WHERE st.tenant_id = p_tenant_id
       AND st.transaction_type = 'consumption'
       AND st.owned_by IS NULL
       AND st.transaction_date >  p_as_of - p_window_days
       AND st.transaction_date <= p_as_of
     GROUP BY 1),
  receipts AS (
    SELECT st.raw_material_id, MAX(st.transaction_date) AS last_received
      FROM p2_stock_transactions st
     WHERE st.tenant_id = p_tenant_id
       AND st.transaction_type = 'grn'
       AND st.owned_by IS NULL
     GROUP BY 1),
  price AS (
    SELECT DISTINCT ON (mp.raw_material_id)
           mp.raw_material_id, mp.price_per_unit
      FROM p2_material_prices mp
     WHERE mp.tenant_id = p_tenant_id
     ORDER BY mp.raw_material_id, mp.effective_date DESC),
  wd AS (SELECT COALESCE(nx_working_day_rate(p_tenant_id, p_as_of), 6.0/7.0) AS r)
  SELECT rm.id, rm.name, rm.material_code, rm.unit,
         COALESCE(b.current_stock, 0),
         rm.min_stock_level,
         COALESCE(c.consumed_qty, 0),
         COALESCE(c.consuming_days, 0),
         CASE WHEN COALESCE(c.consumed_qty,0) > 0
              THEN c.consumed_qty / (p_window_days * (SELECT r FROM wd))
              ELSE NULL END,
         CASE WHEN COALESCE(c.consumed_qty,0) > 0
              THEN COALESCE(b.current_stock,0)
                   / NULLIF(c.consumed_qty / (p_window_days * (SELECT r FROM wd)), 0)
              ELSE NULL END,
         c.last_consumed, r.last_received, p.price_per_unit,
         CASE WHEN p.price_per_unit IS NOT NULL
              THEN COALESCE(b.current_stock,0) * p.price_per_unit ELSE NULL END
    FROM p2_raw_materials rm
    LEFT JOIN v_p2_stock_balance b ON b.raw_material_id = rm.id
    LEFT JOIN consumption c ON c.raw_material_id = rm.id
    LEFT JOIN receipts    r ON r.raw_material_id = rm.id
    LEFT JOIN price       p ON p.raw_material_id = rm.id
   WHERE rm.tenant_id = p_tenant_id AND rm.is_active = true;
$$;
```

**Five decisions inside that query, each of which is wrong if done the obvious way:**

1. **`days_of_cover` is NULL, never infinity, when nothing was consumed.** A material with stock and
   no movement is not "covered forever" — it is **dead stock**, which is a different finding with a
   different action. The consumer splits them: `days_of_cover IS NULL AND current_stock > 0` is the
   dead-stock bucket, and `last_consumed` says how long it has been dead.
2. **The rate is per *working* day, not per calendar day.** A six-day-week factory's calendar-day
   rate understates by 14% and every cover figure built on it is optimistically wrong.
   `nx_working_day_rate` derives the pattern from the tenant's own activity (§3.2).
3. **`v_p2_stock_balance` is joined, not `v_p2_stock_balance_by_owner`.** The former filters
   `owned_by IS NULL` inside its own definition and **does not expose `owned_by` as an output
   column** — `CLAUDE.md` warns twice that adding `.is('owned_by', null)` as a filter on it causes a
   500 `[VERIFIED]`. Own-pool scoping here is structural, not a predicate.
4. **The material list is driven by `p2_raw_materials`, not by the balance view.** A material at
   zero balance is absent from `v_p2_stock_balance` (it has a `HAVING SUM <> 0` sibling) but is
   exactly what a stock-out question is about. `LEFT JOIN` and `COALESCE(...,0)`. This is the same
   rule the Physical Stock Count screen already follows — *"all active materials shown; zero-balance
   materials show 0 (not missing)"* `[VERIFIED — Session 7]`.
5. **`stock_value` is NULL, not zero, when no price row exists.** SS Engineering has **0 price
   records** `[VERIFIED — CLAUDE.md]`, which is precisely why `stock_value` as an agent intent was
   deferred. A zero would silently understate a bank statement. §6.3 refuses rather than renders.

### 3.5 `payment_risk` — Wave 1

**Answers:** *"Who owes us and for how long?"* · *"What is at 43B(h) risk?"* · *"How is our
collection trending?"*

**TypeScript, not SQL** (I4): the row count is bounded by open invoices, not by history.

```ts
// Reads v_p2_invoice_payment_status -- SERVICE ROLE ONLY.
// Session 1's view-RLS fix did REVOKE SELECT FROM anon, authenticated on it
// deliberately: "service-role-only consumer (check-low-stock). Browser access
// blocked entirely." [VERIFIED]. agent-query holds SB_SECRET_KEY so it can
// read it; a session that writes this as a browser query gets a permission
// error and will wrongly conclude the view is broken.
const { data } = await supabase
  .from('v_p2_invoice_payment_status')
  .select('invoice_id, invoice_number, client_id, client_name, amount_total, ' +
          'balance_due, invoice_date, payment_status, total_received, receipt_count')
  .eq('tenant_id', tenantId)
  .eq('invoice_status', 'sent')
  .in('payment_status', ['pending', 'partial', 'overdue'])

// MSME eligibility -- byte-identical to export.html's 43B(h) filter so the two
// surfaces can never disagree about who qualifies:
//   enterprise_class IN ('micro','small')
//   AND registration_activity IN ('manufacturing','services')
//   AND udyam_number is present after trim
// Medium enterprises and trading registrations are excluded. [VERIFIED]
const { data: clients } = await supabase
  .from('p2_clients')
  .select('id, name, udyam_number, enterprise_class, registration_activity')
  .eq('tenant_id', tenantId)
```

**Computed per row, all in code:**

| Field | Rule |
|---|---|
| `days_outstanding` | `todayIST() − invoice_date`. Never `created_at` — the 2 Sept 2026 compliance pass moved every other invoice surface off it `[VERIFIED]`. |
| `msme_eligible` | The three-part filter above. `false` when Udyam data is missing, plus a separate `missing_udyam_count` so the gap is visible rather than silently excluded — the same warning banner `export.html` already shows. |
| `agreed_days` | **45, with the caveat always attached.** `CLAUDE.md`: the 45-day figure assumes a written agreement; without one MSMED s.16 gives **15 days** (`kpml-network-plan.md` §10.4). No `agreement_days` column exists on any table `[VERIFIED]`. |
| `interest_estimate` | 3× RBI bank rate, **simple, not compounded**, matching `export.html`'s existing 43B(h) card exactly. MSMED s.16 actually compounds monthly; the disclaimer that already ships on that card ships here too. |
| `exposure_side` | `'receivable'` always, for this aggregator. §0 C7. |

**`payment_risk` never reports a 43B(h) risk to the tenant on a receivable.** §0 C7. It reports days
outstanding, the amount, and — only when the tenant is itself MSME-registered — one line noting
that the client's own deduction is at stake, because that is a lever worth knowing about before
making the call. The payable side is §3.8's `compliance_exposure` and it is a different, weaker
number by construction (§0 C6).

### 3.6 `material_cost_analysis` — Wave 1

**Answers:** *"What has copper wire cost us over the year?"* · *"Which supplier is cheapest for
this material?"* · *"Where did our material spend go up?"*

```sql
CREATE OR REPLACE FUNCTION nx_material_cost_by_period(
  p_tenant_id uuid, p_from date, p_to date, p_material_id uuid DEFAULT NULL)
RETURNS TABLE (
  period text, raw_material_id uuid, material_name text, material_code text,
  supplier_id uuid, supplier_name text,
  qty_received numeric, value_received numeric,
  weighted_avg_rate numeric, min_rate numeric, max_rate numeric,
  grn_lines bigint, lines_missing_rate bigint)
LANGUAGE sql STABLE SECURITY INVOKER AS $$
  SELECT to_char(st.transaction_date, 'YYYY-MM'),
         st.raw_material_id, rm.name, rm.material_code,
         st.supplier_id, COALESCE(s.name, st.supplier_name, 'Unknown supplier'),
         SUM(st.quantity),
         SUM(st.quantity * COALESCE(st.rate, 0)),
         SUM(st.quantity * st.rate) FILTER (WHERE st.rate IS NOT NULL)
           / NULLIF(SUM(st.quantity) FILTER (WHERE st.rate IS NOT NULL), 0),
         MIN(st.rate), MAX(st.rate),
         COUNT(*),
         COUNT(*) FILTER (WHERE st.rate IS NULL)
    FROM p2_stock_transactions st
    JOIN p2_raw_materials rm
      ON rm.id = st.raw_material_id AND rm.tenant_id = st.tenant_id
    LEFT JOIN p2_suppliers s
      ON s.id = st.supplier_id AND s.tenant_id = st.tenant_id
   WHERE st.tenant_id = p_tenant_id
     AND st.transaction_type = 'grn'
     AND st.owned_by IS NULL            -- a principal's material has no cost to us
     AND st.transaction_date BETWEEN p_from AND p_to
     AND (p_material_id IS NULL OR st.raw_material_id = p_material_id)
   GROUP BY 1,2,3,4,5,6 ORDER BY 1,3;
$$;
```

**Four things this gets right:**

- **`owned_by IS NULL` is the difference between a cost figure and a fiction.** All three live
  tenants receive KPML material on GRNs, sometimes with a rate on the row. That rate is KPML's
  purchase price, not the vendor's cost. Including it would report a job worker's material spend as
  several times its real value.
- **`lines_missing_rate` is returned, not hidden.** A weighted average over the rows that *have* a
  rate, presented without saying how many did not, is a number with an invisible hole. The consumer
  states it.
- **`supplier_name` falls back through three sources.** `p2_suppliers.name`, then the frozen
  `st.supplier_name` snapshot, then a literal. Datta Prasad has **one orphan GRN with no supplier
  name and no invoice number** `[VERIFIED — Session 16]`; it must appear in the output, labelled,
  not vanish from a join.
- **`weighted_avg_rate` uses `FILTER`, not `COALESCE(rate,0)`.** Treating a missing rate as zero
  drags the average down and makes a data-entry gap look like a price drop — the precise shape of
  wrong number this document exists to prevent.

### 3.7 `supplier_performance` — Wave 1

**Answers:** *"Which supplier has been slipping?"* · *"When did we switch supplier for this
material?"* · *"How often do we actually buy this?"*

This aggregator exists for two consumers: the "should we stock up" answer (§0 C5) and the
bottleneck finder's supplier-change candidate event (§5.4).

```sql
CREATE OR REPLACE FUNCTION nx_supplier_cadence(
  p_tenant_id uuid, p_from date, p_to date)
RETURNS TABLE (
  supplier_id uuid, supplier_name text,
  raw_material_id uuid, material_name text,
  grn_events bigint, first_receipt date, last_receipt date,
  median_gap_days numeric, qty_total numeric,
  first_rate numeric, last_rate numeric, rate_change_pct numeric,
  lines_missing_invoice_no bigint)
LANGUAGE sql STABLE SECURITY INVOKER AS $$
  WITH events AS (
    -- One GRN is N rows sharing a grn_no (CLAUDE.md: there is no p2_grn_headers
    -- table; a GRN is rows in p2_stock_transactions). Collapse to one event per
    -- (grn_no, material) before measuring intervals, or a five-material delivery
    -- reads as five receipts one day apart.
    SELECT st.supplier_id, st.raw_material_id, st.grn_no,
           MIN(st.transaction_date) AS event_date,
           SUM(st.quantity)         AS qty,
           AVG(st.rate)             AS rate,
           BOOL_OR(st.invoice_no IS NULL OR trim(st.invoice_no) = '') AS missing_inv
      FROM p2_stock_transactions st
     WHERE st.tenant_id = p_tenant_id
       AND st.transaction_type = 'grn'
       AND st.owned_by IS NULL
       AND st.transaction_date BETWEEN p_from AND p_to
     GROUP BY 1,2,3),
  gaps AS (
    SELECT supplier_id, raw_material_id,
           event_date - LAG(event_date) OVER (
             PARTITION BY supplier_id, raw_material_id ORDER BY event_date) AS gap_days
      FROM events)
  SELECT e.supplier_id,
         COALESCE(s.name, 'Unknown supplier'),
         e.raw_material_id, rm.name,
         COUNT(*), MIN(e.event_date), MAX(e.event_date),
         (SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY g.gap_days)
            FROM gaps g
           WHERE g.supplier_id = e.supplier_id
             AND g.raw_material_id = e.raw_material_id
             AND g.gap_days IS NOT NULL),
         SUM(e.qty),
         (array_agg(e.rate ORDER BY e.event_date))[1],
         (array_agg(e.rate ORDER BY e.event_date DESC))[1],
         CASE WHEN (array_agg(e.rate ORDER BY e.event_date))[1] > 0
              THEN 100.0 * ((array_agg(e.rate ORDER BY e.event_date DESC))[1]
                          - (array_agg(e.rate ORDER BY e.event_date))[1])
                         / (array_agg(e.rate ORDER BY e.event_date))[1]
              ELSE NULL END,
         COUNT(*) FILTER (WHERE e.missing_inv)
    FROM events e
    LEFT JOIN p2_suppliers s ON s.id = e.supplier_id AND s.tenant_id = p_tenant_id
    JOIN p2_raw_materials rm ON rm.id = e.raw_material_id AND rm.tenant_id = p_tenant_id
   GROUP BY 1,2,3,4 ORDER BY 4, 7 DESC;
$$;
```

**`median_gap_days` is a reorder cadence and must be labelled as one.** §0 C5. It is how often this
factory has historically received this material from this supplier. It is **not** a lead time, and
Nexflow cannot compute one because a GRN records what arrived and never what was promised
`[VERIFIED — factory-os.md §13.3]`. The word "cadence" appears in the rendered sentence; the words
"lead time" and "delivery date" never do.

**The `GROUP BY grn_no` collapse is not tidiness.** A five-material delivery under one supplier
invoice is five `p2_stock_transactions` rows on one date `[VERIFIED — CLAUDE.md Known Open Items #1,
which documents exactly this shape]`. Measuring intervals without collapsing first reports a median
gap of zero days for every multi-material supplier, which is both wrong and plausible-looking.

### 3.8 `compliance_exposure` — Wave 1, and it shares an implementation

**Answers:** *"What will bite us at filing?"* · *"Are we clean?"* · everything in §7's inspection
report, and five of §8's alerts.

**Do not write this from scratch.** `filing-package/index.ts`'s `fetchCoveringNoteData(tenantId,
monthFrom, monthTo, isJobWorker, tenant)` already computes eight canonical counts **plus the raw
rows behind them**, and has run in production against real tenant data since 10 September 2026
`[VERIFIED — Session 16]`:

```
missingInvoiceNoCount      missingHsnLineCount       interstateCount
overdueInvoiceCount        msmeRiskCount             s143BreachCount
wrongInvoiceOnJobWorkCount neverAuditedMaterialCount
```

`[DECIDED]` **Extract it to `supabase/functions/_shared/compliance.ts` and have `filing-package`,
`agent-query` and `intelligence-sweep` all import it.** This is the same instruction
`nexflow-mcp.md` §5.4 gives for the s.143 clock, for the same reason: that clock is already
implemented twice — `js/s143-clock.js:50` in the browser and a Deno port at
`filing-package/index.ts:204` `[VERIFIED]` — and `filing-package/index.ts:1299` already carries a
comment acknowledging the replication problem. **A third copy is a third thing to fix when the
exemption bands change.**

Two changes the extraction needs, and they are the entire diff:

1. **Arbitrary date windows, not just a calendar month.** The signature becomes
   `(tenantId, from, to, opts)`. `filing-package` passes its month; Intelligence passes whatever the
   question asked for.
2. **Two deliberate non-windowed behaviours are preserved exactly.** Overdue invoices are **not**
   period-scoped — *"an invoice from 3 months ago still unpaid is flagged every month until
   resolved"* — and the s.143 lookback stays a **trailing 400-day window on `transaction_date`**, so
   a tenant with five years of history cannot produce an unbounded scan `[VERIFIED — Session 16]`.
   **Both are correct and both look like bugs to someone reading the code cold.** The extracted
   module carries the comment explaining why.

**What Intelligence adds on top**, because a covering note needed counts and an advisor needs rows:
each count gains a capped list of exemplar rows (I6) — the actual invoice numbers, the actual GRN
lines, the actual challans. That is the difference between *"15 GRN lines at 0% GST"* and *"15 GRN
lines at 0% GST, invoices BE-4488, BE-4501, …"*, and it is the whole reason the Session 16 output
was actionable.

**The payable side is added here, weakly and honestly.** §0 C6: GRN value in the period minus
advances recorded in the period, both date-scoped, **never read from
`v_p2_supplier_advance_balance`** while Known Open Items #14 is open. Returned as
`payables_upper_bound` with a mandatory caveat, and `msme_supplier_unknown: true` always, because
Udyam columns exist only on `p2_clients` (§0 C7).

### 3.9 `client_contribution` — Wave 1, and deliberately not called "profitability"

§0 C4. The brief asks for margin analysis; this is what the data actually supports.

```sql
-- Revenue per client, and the material consumed against that client's dispatches
-- valued at the TENANT'S OWN purchase rates. Never called margin, never called
-- profit. Suppressed entirely for a job-work client -- see below.
CREATE OR REPLACE FUNCTION nx_client_contribution(
  p_tenant_id uuid, p_from date, p_to date)
RETURNS TABLE (
  client_name text, invoiced_total numeric, sale_challans bigint,
  material_consumed_value numeric, material_rows_unpriced bigint,
  jobwork_challans bigint, owned_material_present boolean)
LANGUAGE sql STABLE SECURITY INVOKER AS $$
  WITH billed AS (
    SELECT i.client_name, SUM(i.amount_subtotal) AS invoiced_total
      FROM p2_invoices i
     WHERE i.tenant_id = p_tenant_id AND i.status = 'sent'
       AND i.invoice_date BETWEEN p_from AND p_to
     GROUP BY 1),
  price AS (
    SELECT DISTINCT ON (mp.raw_material_id) mp.raw_material_id, mp.price_per_unit
      FROM p2_material_prices mp WHERE mp.tenant_id = p_tenant_id
     ORDER BY mp.raw_material_id, mp.effective_date DESC),
  consumed AS (
    SELECT d.client_name,
           COUNT(DISTINCT d.id) FILTER (
             WHERE d.movement_purpose IN ('sale','direct_supply_from_jobworker')) AS sale_challans,
           COUNT(DISTINCT d.id) FILTER (
             WHERE d.movement_purpose IS NOT NULL
               AND d.movement_purpose NOT IN ('sale','direct_supply_from_jobworker')) AS jobwork_challans,
           BOOL_OR(d.owned_by IS NOT NULL) AS owned_material_present,
           SUM(-st.quantity * p.price_per_unit) FILTER (WHERE p.price_per_unit IS NOT NULL) AS mat_value,
           COUNT(*) FILTER (WHERE p.price_per_unit IS NULL) AS unpriced
      FROM p2_dispatch_orders d
      LEFT JOIN p2_stock_transactions st
             ON st.reference_id = d.id AND st.transaction_type = 'consumption'
            AND st.owned_by IS NULL
      LEFT JOIN price p ON p.raw_material_id = st.raw_material_id
     WHERE d.tenant_id = p_tenant_id AND d.status = 'confirmed'
       AND d.dispatch_date BETWEEN p_from AND p_to
     GROUP BY 1)
  SELECT COALESCE(b.client_name, c.client_name),
         COALESCE(b.invoiced_total, 0), COALESCE(c.sale_challans, 0),
         c.mat_value, COALESCE(c.unpriced, 0),
         COALESCE(c.jobwork_challans, 0), COALESCE(c.owned_material_present, false)
    FROM billed b FULL OUTER JOIN consumed c ON c.client_name = b.client_name
   ORDER BY 2 DESC;
$$;
```

**Three rendering rules the consumer must enforce, and they are not optional:**

1. **`owned_material_present = true` suppresses the material column entirely.** That client's
   dispatches moved somebody else's material. Subtracting its value from job charges produces a
   number with no meaning. The answer becomes revenue and volume, plus one sentence: *"This is job
   work on KPML's material, so there is no material cost of yours to set against it."*
2. **`material_rows_unpriced > 0` forces the figure to be labelled incomplete**, with the count.
   `p2_material_prices` is sparsely populated in practice — SS Engineering has **zero rows**
   `[VERIFIED]`.
3. **The difference is rendered as "after material only" and never as margin.** The excluded
   categories are named in the same sentence: labour, power, machine time, consumables, overhead,
   rent. §12.4 carries the exact string.

### 3.10 Wave 2 aggregators — specified, gated, not buildable

These are written here so the Wave 2 session does not redesign them, and **flagged so a Wave 1
session does not attempt them.** Each names the table that blocks it.

| Aggregator | Answers | Blocked on |
|---|---|---|
| `production_efficiency` | planned vs actual output, material yield vs BOM, per-product throughput | `p2_production_orders`, `p2_production_progress` — `factory-os.md` §11.2, §11.4 |
| `quality_trend` | rejection rate by product, by worker, over time; disposition mix | `p2_quality_records` — `factory-os.md` §11.5 |
| `capacity_available` | *"can we take 50 KS6 by Friday?"* | **Already fully designed elsewhere — do not build a second one.** `factory-os.md` §7 specifies it as the `delivery_estimate` read intent, including the 20th-percentile rule, the four refusal cases and the ≥10-production-day floor. |

**`capacity_available` is the one to be careful about.** The brief asks Intelligence to answer
*"Can we take an order for 50 KS6 by Friday?"*, and `factory-os.md` §7 already answers it — in
detail, with a computation this document has no business reimplementing. `factory-os.md` F9 also
makes it **read-only by design**, which is exactly Intelligence's posture.

`[DECIDED]` **Intelligence does not implement capacity estimation. It calls `delivery_estimate`.**
When Factory OS ships, Intelligence's advisor routes the question to that intent and narrates its
result. Until then it refuses with the reason (§4.4) and offers §6.5's degraded historical-output
report instead. Two implementations of a delivery promise is two dates quoted to the same customer.

### 3.11 Migration order for Session 1

One file, applied via the **Supabase SQL Editor, never `supabase db push`** — the standing rule,
because push replays old migrations.

```
20261101_intelligence_aggregates.sql
  1. CREATE FUNCTION nx_working_day_rate                 (3.2)
  2. CREATE FUNCTION nx_sales_value_by_period            (3.3a)
  3. CREATE FUNCTION nx_dispatch_volume_by_period        (3.3b)
  4. CREATE FUNCTION nx_sales_by_client_period           (3.3c)
  5. CREATE FUNCTION nx_inventory_health                 (3.4)
  6. CREATE FUNCTION nx_material_cost_by_period          (3.6)
  7. CREATE FUNCTION nx_supplier_cadence                 (3.7)
  8. CREATE FUNCTION nx_client_contribution              (3.9)
  9. GRANT EXECUTE ON ... TO authenticated;  REVOKE ALL ... FROM anon;
 10. CREATE INDEX p2_stock_transactions_intel_idx
       ON p2_stock_transactions (tenant_id, transaction_type, transaction_date)
       -- already exists as of Session 6; confirm before creating [VERIFIED]
 11. CREATE INDEX p2_dispatch_orders_intel_idx
       ON p2_dispatch_orders (tenant_id, status, dispatch_date)
```

**Every function is `STABLE SECURITY INVOKER`** (I4). None of them writes. None takes a
model-supplied identifier — the Edge Function resolves names to ids with the existing
`matchMaterialName()` / `matchClientName()` / `matchSupplierName()` helpers before calling
(`nexflow-agent.md` D4).

**Test tenant `fe2b94fb-9668-405f-9c62-5f54b32f8c7a` first.** Then `node _ai/regression/snapshot.js`
and diff against the **most recent prior snapshot**, never `baseline-pre-2H.json` `[VERIFIED]`. This
migration creates only new functions and at most one index, so the diff must be empty; a non-empty
diff means something was already wrong before the session started.

**Verify the test tenant's `agent_tier` is still `'unlimited'` afterwards** — `CLAUDE.md`'s standing
check. This migration does not touch `p2_tenant_settings`, but §9.2's does.

---

## 4. Business Advisor Queries

### 4.1 The shape of a turn

```
 POST agent-query { action:'intelligence_query', tenant_id, message }
   verifyCallerTenant                          unchanged
   plan gate + intelligence_enabled            fresh read, never isPro()   (I7)
   meter++                                     never blocks                (I9)
        |
        v
   HAIKU CLASSIFY  ->  { intent, params, period }          ~1,200 in / 100 out
        |
        +-- intent 'unknown' or out of scope -> plain text, NO aggregator, NO Opus
        +-- role not permitted               -> refusal, ZERO model calls after this
        |
        v
   RESOLVE params   matchMaterialName / matchClientName / matchSupplierName
                    -- code-side, existing helpers, model never sees a uuid (D4)
        |
        v
   AGGREGATE        section 3. Every number decided here.
        |
        +-- coverage insufficient -> refusal naming what is missing (4.4)
        |                            NO narration call is made
        v
   NARRATE          NARRATION_MODEL[intent] -> haiku | opus       (I5)
                    input = bounded summary + coverage            (I6)
        |
        v
   { status:'ok', intent, answer, figures, coverage }
   log to p2_agent_logs  intent = 'intelligence:<intent>'
```

**Two properties of that flow are the whole safety argument:**

- **A refusal costs one Haiku call and nothing else.** The aggregate is not fetched and Opus is
  never reached. §18.4 item 19 asserts it.
- **`figures` is returned alongside `answer`.** The client renders the prose, but the raw computed
  values travel with it — which is what makes §18.1's "the model wrote no number" test runnable
  against a live response rather than against a mock.

### 4.2 *"Our sales dropped this month, what happened?"*

Intent `sales_trend`. Narration model: **Opus** — it weighs three aggregates (value, volume,
per-client) against each other and must decide which explains the others.

**The divergence rule (§3.3) fires first.** When invoiced value and sale-challan count move in
opposite directions, or when challans exist with no invoices at all, the answer leads with that and
nothing else:

```
You raised no sales invoices in September, so the rupee figure is zero -- but
23 sale challans went out, 21 of them to KPML. The drop you are seeing is in
billing, not in dispatch.

78 challans from August are also still uninvoiced. Until those are raised,
GSTR-1 for both months will not reflect what actually left the factory.
```

That is not a hypothetical shape. It is Datta Prasad's real August and September position
`[VERIFIED — Session 16 found the 78]`, and it is the single most valuable sentence Intelligence can
say to that tenant.

**When value and volume agree, the answer is a period comparison with a per-client decomposition:**

```
Sale challans fell from 34 in August to 11 in September, and invoiced value
from Rs 8,42,150 to Rs 2,71,400 (down 68%).

All of the fall is one client. KPML took 31 challans in August and 8 in
September. Shree Ganesh (2 -> 2) and Nashik Motor Traders (1 -> 1) are flat.
```

**And then it stops, unless `coverage.sufficientForAttribution` is true.** §0 C3: attribution needs
six complete periods. With two, the honest ending is one sentence:

> *"I have two months of data, which is enough to show the change and not enough to tell you what
> changed it. Ask me again in a few months and I will be able to compare this against a normal
> pattern."*

§5 is what happens when six periods do exist.

### 4.3 *"Can we take an order for 50 KS6 by Friday?"*

**Wave 2, and it is answered by `factory-os.md` §7, not by this document.** §3.10.

Until Factory OS ships, the advisor refuses precisely and offers what it does have:

```
I cannot promise a date. Nexflow does not yet track production orders, so I
have no view of what is already committed or how fast KS6 actually runs.

What I can tell you: you have shipped KS6 in 4 of the last 6 months, 38 units
in the best month and 12 in the slowest. Materials for 50 are sufficient today
-- Stator Stack KS6 62 in stock against 50 needed, Bearing 6205 ZZ 480 against
100. Copper Wire 0.90/1.20MM is the one to watch: 62.4 kg, and 50 units needs
12.5 kg.
```

**Three things that refusal does right**, and they are the template for every Wave 2 refusal in
§4.4: it says what is missing, it does not substitute a worse number for the missing one, and it
delivers the part it genuinely knows — which here is the material check, and is often what the
owner actually needed.

### 4.4 Refusals — the six shapes, and why each is a different sentence

A refusal is a product surface, not an error path. `nexflow-agent.md` §4.4 makes the same argument
for the write layer. Six distinct cases, each with a defined answer:

| Case | Detected by | Response |
|---|---|---|
| **Not enough periods for a trend** | `coverage.periodsAvailable < 2` | *"I have 3 weeks of data. A trend needs at least two complete months."* Names when it will be answerable. |
| **Enough for a trend, not for a cause** | `sufficientForTrend && !sufficientForAttribution` | Shows the change in full. Refuses the cause in one sentence. §4.2. |
| **Nothing qualified** | `rows.length === 0`, coverage fine | *"No invoices are outstanding."* **This is an answer, not a failure** — and it must not be phrased as one. |
| **The table does not exist** (Wave 2) | intent in the Wave 2 set | §4.3's shape: name the gap, deliver the adjacent thing that is real. |
| **The figure exists but is not trustworthy** | `material_rows_unpriced > 0`, `lines_missing_rate > 0`, `missing_udyam_count > 0` | Give the figure, state the hole with its exact count. Never silently drop the incomplete rows. |
| **Role not permitted** | I8 | *"Payment figures are limited to the owner and the accountant."* **Before any aggregate is fetched.** |

**The third row is the one that gets built wrong.** An empty result rendered through an error path
produces *"Could not find any data"*, which an owner reads as a Nexflow fault rather than as good
news about their receivables. The read layer already has this distinction and gets it right —
`agent-query` treats an answer starting `"Couldn't"` / `"Could not"` / `"Please provide"` as a
failure for logging `[VERIFIED — index.ts:3282]`. Intelligence inherits that convention exactly, and
therefore must not begin a legitimate empty-set answer with those words.

### 4.5 *"Which clients are most profitable?"*

§0 C4. The question is asked; the word is not used in the reply.

**For a job worker — every live tenant today:**

```
I can show what each client is worth to you, but not what you make on them.
You are doing job work: the material in those dispatches is KPML's, so there
is no material cost of yours to set against the job charges. Nexflow also
holds no labour, power, machine time or overhead figures.

By billed value, April to September:
  Kirloskar Pneumatic Co Ltd     Rs 41,20,500     186 sale challans
  Shree Ganesh Engineering       Rs  3,84,000      14 sale challans
  Nashik Motor Traders           Rs  1,12,400       6 sale challans
```

**For a tenant who owns their material:**

```
Revenue and material, April to September. This is after material only --
it excludes labour, power, machine time, consumables and overhead, none of
which Nexflow holds.

  Shree Ganesh    Rs 12,40,000 billed    Rs 7,15,200 material    Rs 5,24,800
  Nashik Motors   Rs  4,80,000 billed    Rs 3,90,100 material    Rs   89,900

Nashik Motors is the one to look at: 39% of the revenue and 55% of the
material. 4 of its 31 consumed lines had no price on record, so the material
figure is an understatement.
```

**Note what the second example does and does not do.** It points at the outlier, because that is
the finding. It does not say Nashik is unprofitable, does not recommend repricing, and states the
four unpriced lines rather than quietly averaging over them. §12.4.

### 4.6 *"Should we stock up on copper wire?"*

§0 C5. Intent `inventory_health` scoped to one material, plus `supplier_cadence` for that material.
Narration model: **Haiku** — it is one material and two aggregates that do not need weighing
against each other.

```
Copper Wire 0.90/1.20MM: 62.4 kg in hand.

You have used 418 kg in the last 90 days -- about 5.4 kg per working day at
your observed pattern of 6 days a week. That is roughly 11 working days of
cover.

You buy it from Bharat Electricals, typically every 21 days (median across
9 receipts this year). The last receipt was 17 days ago, at Rs 742/kg, up
from Rs 698/kg in April.

Nexflow does not know how long Bharat Electricals takes to deliver -- it
records what arrived, never what was promised -- so treat 21 days as your
own buying rhythm, not as their lead time.
```

**The last paragraph is mandatory and is rendered from `coverage.caveats`, not composed by the
model.** §3.1. A cadence figure presented without it reads as a delivery promise, and an owner who
plans against it will be short.

### 4.7 The classification prompt and the narration prompt

**Two calls, two prompts, and they must not be merged.** A single call that both classifies and
narrates would have to be given the data before it decided what data it wanted, which means
fetching everything for every question — the cost profile this document exists to avoid.

**Classification (Haiku).** Small, because the intent set is closed and entity matching is
code-side:

```
You turn a factory owner's business question into one structured query.

Return exactly one intent from this list, with its parameters:
  sales_trend            revenue or dispatch volume over time, or a period comparison
  inventory_health       stock levels, consumption, days of cover, dead stock
  payment_risk           who owes money, how long, collection position
  material_cost_analysis what a material has cost, supplier price comparison
  supplier_performance   supplier buying cadence, rate movement, reliability of records
  compliance_exposure    filing risk, missing invoice numbers, HSN gaps, s.143 lots
  client_contribution    revenue by client, and material against it where it is ours
  bottleneck             "why is X happening" -- a metric plus a request for a cause
  report                 a request for a document rather than an answer
  unknown                anything else

Rules:
1. Names and codes exactly as the user said them. Never an identifier of any
   kind. The system matches names to real records itself.
2. Periods: resolve relative language to YYYY-MM-DD. "this month", "last
   quarter", "since April". Omit the period entirely if none was implied --
   do not default to a range the user did not ask for.
3. Never invent a number, a client, a material or a supplier.
4. If the question asks about production, workers, quality, rejections or
   delivery capacity, return the intent anyway with the right parameters.
   The system knows those are not available yet and will say so.
5. If it is not a question about this factory's own data, return unknown.
```

Rule 4 is deliberate: **classification must not become the place Wave 2 is refused.** If the model
silently maps a quality question to `unknown`, the owner gets *"I don't understand"* instead of
*"that needs production tracking, which isn't built yet"* — and the second is both true and a
roadmap signal worth logging.

**Narration (Haiku or Opus, per I5).** The system prompt is the same for both models and its
opening constraint is the load-bearing one:

```
You are writing an answer for the owner of an engineering factory in
Maharashtra, from figures that have already been calculated for you.

EVERY NUMBER YOU NEED IS IN THE INPUT. You must not calculate, estimate,
round, interpolate or infer any figure that is not there. If a number you
want does not exist in the input, say what is missing instead of producing
one.

Lead with the answer. The owner is busy and may be on a phone.
Name specific documents, clients, materials and suppliers -- never "some
invoices" or "certain materials".
State a limitation where one applies; the input's `caveats` field carries
limitations that must appear in your answer verbatim in meaning.
Where the input says a list was capped, say how many more there are.
Plain prose. No markdown, no bold, no headers, no bullet symbols.
Do not offer to perform any action -- you cannot change anything.
150-350 words for an answer; up to 600 for a report narrative.
```

Then `stripMarkdown()` and `parseIntelligenceJson()` — both cloned from `filing-package`, which
needed them because *"Opus sometimes uses markdown despite being asked for plain prose"*
`[VERIFIED]`. Shape validation is exactly four conditions, the same four Session 16 settled on after
an over-strict version rejected valid responses:

```
JSON.parse throws          -> fail
not an object              -> fail
answer missing or empty    -> fail
figures_used not an array  -> fail
```

`figures_used` is new to this document and it is not decoration: **the model is asked to list the
input figures it relied on.** The consumer cross-checks each against the aggregate it was handed.
A figure claimed but absent is logged as `success=false` with `error_reason='unbacked_figure'` and
the answer falls back a layer. It is a cheap detector for the one failure that matters (§15 row 3),
and it is the reason §18.1's test can run in production and not just in a suite.

**Three-layer fallback, `filing-package`'s exact shape** `[VERIFIED — Session 16]`:

```
Layer 1   Opus or Haiku per NARRATION_MODEL, full bounded summary
Layer 2   Haiku, counts only, never the exemplar rows
Layer 3   deterministic sentence assembly from the same figures -- cannot fail
```

Layer 3 is not a placeholder. It walks the aggregate and emits one plain sentence per non-empty
section, in the computed severity order. **It is less pleasant and equally correct**, which is the
right trade for the day the API is down — and it is what makes the §7 inspection report's promise
survivable when the owner has two hours and no second chance.

---

## 5. The Bottleneck Finder

### 5.1 What it is, and what the brief's version needs that does not exist

The brief's question is *"Why are we consistently delivering late to KPML?"* and its answer needs a
due date, a rejection rate and a per-order day count. **None of the three exists** (§0 C2): there is
**no commitment date anywhere in today's schema.** `p2_dispatch_orders` has `dispatch_date` — when
something left — and nothing that says when it was promised. Lateness is not computable, and no
amount of query cleverness makes it so.

`[DECIDED]` **Wave 1's bottleneck finder is a cash-and-material-flow bottleneck finder. Wave 2's is
the production one the brief describes.** The reframing is not a consolation: for every live tenant
today, the binding constraints are cash and compliance, not throughput. Datta Prasad's real
bottleneck in August was 78 dispatches that were never invoiced — a working-capital problem worth
more than any production insight Nexflow could have offered.

**What Wave 1 can find, all computable from shipped tables:**

| Bottleneck | Metric | Where it comes from |
|---|---|---|
| **Billing lag** | days from confirmed dispatch to invoice raised, per client | `p2_dispatch_orders.dispatch_date` → `p2_invoices.invoice_date` via `dispatch_order_id` / `dispatch_order_ids` |
| **Collection lag** | days from invoice to receipt, per client | `p2_invoices` → `p2_payment_receipts.payment_date` |
| **Stock-out days** | days a material sat at or below zero | running balance over `p2_stock_transactions` |
| **Material idle time** | days from GRN to first consumption, per material | `p2_stock_transactions` grn → consumption |
| **Purchase cadence break** | a supplier's median gap exceeded by more than 2× | §3.7 |
| **Rate drift** | weighted average rate moving beyond the material's own history | §3.6 |

### 5.2 The method — code proposes, the model selects, neither invents

```
1. SERIES      code computes the target metric in monthly buckets      (section 3)
2. CHANGEPOINT code finds the month it moved abnormally                (5.3)
3. CANDIDATES  code computes which recordable events occurred in that
               same window -- from a FIXED list, nothing else          (5.4)
4. NARRATE     Opus ranks the candidates and writes the sentence,
               naming the coincidence and the confounders              (5.5)
```

**Step 3 is the one that keeps this honest.** The model is handed only events that **actually
occurred**, each with its own date and magnitude. It cannot propose a cause of its own, because it
is never asked an open question — it is asked to choose among a computed list or to say that none
of them fits. When step 3 returns nothing, the model is told so explicitly and the answer says the
cause is not in the data (§5.5).

### 5.3 Changepoint detection — self-referential, never a constant

```
series        = monthly values of the target metric, complete periods only
if COUNT(series) < 6            -> refuse. No changepoint, no candidates.  (0 C3)
baseline      = median(series excluding the candidate month)
dispersion    = median absolute deviation of the same set
changepoint  <=> |value - baseline| > 2 x dispersion
                 AND |value - baseline| > 0.15 x baseline
```

**Four decisions in five lines:**

- **Median and MAD, not mean and standard deviation.** One catastrophic month in a six-month series
  moves a mean enough to hide itself. MAD does not.
- **Two conditions, both required.** The dispersion test alone fires constantly on a very steady
  series, where any wobble is large relative to near-zero deviation. The 15% floor stops a
  three-challan move on a stable 20-challan month being reported as a collapse.
- **Six complete periods minimum, and it is a hard floor.** §0 C3. With fewer, the aggregator sets
  `sufficientForAttribution: false` and the consumer refuses before the model is called.
- **No hardcoded plausibility threshold anywhere.** `nexflow-agent.md` §6.5's rule: the tenant's own
  history supplies the norm, because a constant tuned for a motor factory is wrong for the next
  industry. `factory-os.md` §6.3 applies the identical rule to rejection rates.

### 5.4 The candidate event list — fixed, closed, and dated

Nine event types. **The list is closed by design**, and widening it is a code change with a test,
never a prompt change:

| # | Event | Detected by | Passed with |
|---|---|---|---|
| 1 | Supplier changed for a material | a material's dominant `supplier_id` differs from the prior period | both supplier names, the month |
| 2 | Purchase rate moved > 30% | §3.6 weighted average vs the trailing 6-month average | both rates, the month |
| 3 | Material hit zero | running balance crossed 0 and stayed ≤ 0 for ≥ 1 day | material, first day, days at zero |
| 4 | Purchase cadence broke | §3.7 median gap exceeded by > 2× | supplier, material, expected gap, actual |
| 5 | A client's volume moved | §3.3c per-client challans changed beyond the §5.3 test | client, both counts |
| 6 | A new product or material first appeared | first-ever dispatch or GRN row | name, first date |
| 7 | Invoicing stopped for a client | sale challans > 0 and invoices = 0 in a period | client, challan count |
| 8 | GST rate anomaly on receipts | GRN lines at 0% where the same material was 18% before | count, invoice numbers |
| 9 | A pool changed | `owned_by` distribution for a material shifted | material, both pools |

**Events 7 and 8 are on this list because Opus already found both of them, unprompted, on real
data** — the 78 uninvoiced challans and the 15 zero-rate GRN lines `[VERIFIED — Session 16]`.
Codifying them as computed candidates means the finding no longer depends on a model noticing it
in a month where a hundred other things were also true.

**Every candidate carries its own date and magnitude.** A candidate without a date cannot be
checked for coincidence, and a candidate without a magnitude gives the model nothing to rank by.

### 5.5 How the insight is expressed — correlation, stated as correlation

`[DECIDED]` **Three rendering rules, enforced in the narration prompt and asserted in §18.3.**

**Rule 1 — the words "caused", "because of" and "due to" never appear in an attribution
sentence.** The permitted forms are *"in the same month"*, *"coincides with"*, *"started when"*,
*"the only recorded change in that window was"*.

**Rule 2 — the confounder sentence is mandatory when candidates exist.** Every attribution ends by
naming what Nexflow could not see. This is not hedging; it is the single most accurate statement
the system can make about its own reach:

> *"Nexflow records material, documents and money. It does not record machine downtime, a worker
> leaving, a power cut, a customer changing a specification, or a phone call. Any of those could be
> the real reason and none of them is in the data."*

**Rule 3 — zero candidates produces a specific answer, not silence.** *"Challans to KPML fell by
23 in September. Nothing else in your Nexflow data changed in that window — no stock-out, no
supplier change, no rate movement, no pattern break. Whatever is behind it is not something Nexflow
sees."* That is a genuinely useful answer: it tells the owner to stop looking in the software.

**A full Wave 1 example, on the shape of data a live tenant actually has:**

```
Billing is the bottleneck, not dispatch.

Across April to September, a confirmed sale challan to KPML takes a median of
41 days to reach an invoice. Every other client is at 3 days. 78 August
challans have no invoice at all.

Two things changed in the same window and I cannot tell you which matters.
KPML dispatches moved from 'sale' purpose to a mix of 'sale' and
'job_work_return' from 14 August, and job-work returns cannot be invoiced as
sales -- so some of that 41 days is challans that were never meant to be
billed. Separately, the last invoice raised against KPML was on 9 August.

The 78 uninvoiced challans are the part with a deadline. Until they are
raised, GSTR-1 does not reflect what left the factory.

Nexflow sees material, documents and money. It does not see whether KPML
disputed something, whether a rate was still being negotiated, or a decision
taken on a phone call. Any of those could be the real reason.
```

**Note what that answer does not do.** It does not conclude that the purpose change caused the
billing delay, although the coincidence is striking. It separates the part that is a compliance
deadline (the 78) from the part that is an explanation (the purpose mix), because only one of them
is actionable this week.

### 5.6 What the bottleneck finder cannot find — the honest limits

| Limit | Why it is irreducible |
|---|---|
| **Anything sub-monthly** | Buckets are months (§3.2). A three-day machine stoppage that cost a week's output is invisible at this granularity, and shortening the bucket makes the §5.3 dispersion test fire on noise. |
| **Multiple simultaneous causes** | One changepoint, a ranked candidate list, no decomposition. Two real causes in one month are reported as two coincidences, correctly and unhelpfully. |
| **Anything not in the nine events** | §5.4's list is closed. A tenth cause is a code change. |
| **Anything not in Nexflow at all** | **The most likely real cause of most factory problems.** Rule 2 exists because of this. |
| **Direction of causation** | Stock ran out and output fell — or output plans changed and stock was not bought. The data is identical. |
| **Anything before 6 complete periods** | §5.3, and §0 C3 means that is early 2027 for every live tenant. |
| **Lateness of any kind, in Wave 1** | No commitment date exists in the schema. §5.1. |

**The fifth row deserves its own sentence, because it is the one an impressive-sounding answer
hides.** Nexflow observes that two things moved together. Which one moved first is often visible;
which one moved the other is not. An Intelligence answer that picks a direction is producing
narrative, and §18.3 item 12 tests that it does not.

---

## 6. Report Generation

### 6.1 The pattern — template plus data fill, with the model optional

Every report is built the same way, and the shape is `filing-package`'s
`buildCoveringNoteHtml()` generalised `[VERIFIED — Session 16]`:

```
1. AGGREGATE     section 3's functions. Every figure. No model.
2. RENDER        pure function: data -> self-contained HTML.
                 No external CSS, no CDN, no fonts, no images -- it must
                 render offline in any browser, on a phone, in a shed,
                 and print correctly to A4.
3. NARRATE       Opus writes the interpreted sections ONLY. Optional.
4. ASSEMBLE      narrative inserted into reserved slots. If step 3 failed,
                 the slots carry one honest line and the report ships.
5. STORE         p2_intelligence_reports: data, narrative, html, verbatim (I10)
```

**Which sections are deterministic and which are interpreted is fixed per report, never a judgement
call at render time:**

| Section kind | Example | Model |
|---|---|---|
| **Register** — exact ledger output | stock register, GRN register, challan register, s.143 lot table | **never** |
| **Computed summary** — arithmetic over registers | totals, counts, valuations, days outstanding | **never** |
| **Interpretation** — what the numbers suggest | *"the three oldest lots are all from one principal challan"* | **Opus** |
| **Action list** | *"raise invoices for the 78 August challans before filing"* | **Opus**, from computed flags only |

**A register is never paraphrased.** `filing-package`'s system prompt already forbids inventing
data; here the stronger structural rule applies — **the model is not given the register rows at
all, only the summary and the flags.** It cannot paraphrase a table it never received.

### 6.2 The 30-second promise, kept honestly

§0 C9. Two phases:

| Phase | Content | Time | Fails how |
|---|---|---|---|
| **1** | Every register, every total, the full document skeleton | **2–4s** | Only if the DB is down — and then nothing works |
| **2** | Narrative and action list | **15–40s** | Falls through §4.7's three layers |

The client renders phase 1 immediately and fills phase 2 in place. **The print button is live after
phase 1.** An owner with two hours and a printer never waits on a model, and if Opus, Haiku *and*
the deterministic assembler all somehow fail, the document is still complete in every part a third
party will actually read.

### 6.3 Bank stock statement

> *"The bank needs a stock statement for the working capital limit."*

**Data:** §3.4's `nx_inventory_health`, valued at latest `p2_material_prices.price_per_unit`.

**Deterministic: every row.** Material, code, UQC, quantity, unit, rate, value, valuation date.
**Narrative: none.** A bank statement is a register and a model has nothing useful to add to it.
This is the one report with **no model call at all** — it costs ₹0.00 and takes two seconds.

**Three safeguards, and the first matters most:**

1. **Principal-owned material is excluded, structurally.** `v_p2_stock_balance` filters
   `owned_by IS NULL` inside its own definition `[VERIFIED]`, so the exclusion cannot be forgotten
   by a future edit. **All three live tenants are job workers holding KPML's material right now**
   `[VERIFIED — CLAUDE.md]`, and **presenting a principal's material to a bank as security for a
   working-capital limit is a misrepresentation with consequences well beyond Nexflow.** The report
   states the exclusion on its face: *"This statement covers material owned by the company.
   Material held on behalf of a principal under job work is excluded and is not available as
   security."*
2. **Unvalued rows are listed with a blank value and counted, never valued at zero.** SS Engineering
   has **0 `p2_material_prices` rows** `[VERIFIED]`. If **every** row is unvalued the report
   **refuses to generate**: *"No purchase prices are recorded, so this statement would show a stock
   value of zero. Add prices in Settings → Prices first."* A ₹0 stock statement sent to a bank is
   worse than no statement.
3. **Valuation basis is stated, not assumed.** *"Valued at the latest recorded purchase rate per
   material — not at cost of acquisition and not at net realisable value. Your CA may require a
   different basis."* §12.6.

### 6.4 Working capital summary

> *"What's our working capital position?"*

Three legs, and **they are not of equal quality. The report says so rather than presenting one tidy
number.**

| Leg | Source | Quality |
|---|---|---|
| **Stock value** | §3.4, own pool, latest rates | **Good**, with the unvalued count stated |
| **Receivables** | §3.5 over `v_p2_invoice_payment_status`, `status='sent'` | **Good.** Ageing buckets 0–30 / 31–45 / 46–90 / 90+ |
| **Payables** | §3.8's `payables_upper_bound` | **Weak, and labelled weak.** §0 C6 |

The payables section carries this text verbatim, in the report body, not in a footnote:

> *"Nexflow records supplier advances but not individual supplier payments. This figure is what you
> purchased in the period less what you advanced — an upper bound on what is owed, not a reconciled
> payables balance. A supplier payables register is not yet built."*

**It must not read `v_p2_supplier_advance_balance`** while Known Open Items #14 is open — that
view's `total_drawn` sums every GRN ever recorded for the supplier rather than GRNs since the
advance `[VERIFIED]`, so every supplier reads as massively overdrawn the moment a first advance
exists.

**Narrative: Opus**, over three aggregates that must be weighed against each other — exactly I5's
criterion. The useful sentence is rarely the total; it is *"₹8.4L of your ₹11.2L receivables is one
client, and ₹6.1L of that is past 45 days."*

### 6.5 Capacity report — degraded in Wave 1, and honest about it

> *"KPML wants to know our Q1 capacity."*

**Wave 2 computes this properly.** `factory-os.md` §7's `delivery_estimate` quotes the 20th
percentile of observed daily output against committed load, refuses below ten production days, and
refuses entirely when material is short `[VERIFIED]`. §3.10: **Intelligence does not reimplement
it.**

**Wave 1 ships a historical output report, correctly named.** Per product, per month: units
dispatched, challan count, months active, best and worst month. Deterministic throughout, narrative
from Opus.

It states what it is on its face, and that sentence is the point:

> *"This is what you have shipped, month by month. It is not a capacity figure and it is not a
> commitment. It does not account for what is already committed, for material availability, or for
> how fast a line actually runs — Nexflow does not yet track production orders."*

**A capacity number sent to a principal is a promise.** `factory-os.md` §7.3 exists because quoting
an average makes a vendor late half the time by construction. Wave 1 must not let an owner send
KPML a figure that looks like a commitment and was computed from nothing but history.

### 6.6 Production efficiency report — Wave 2 entirely

> *"How efficient were we this month?"*

Planned vs actual, quality pass rates, material yield vs BOM, worker productivity. **All four need
tables that do not exist** (§0 C2): `p2_production_orders`, `p2_production_progress`,
`p2_quality_records`, `p2_workers`.

Two constraints it inherits the day Factory OS ships, neither of them Intelligence's to relax:

- **No worker performance ranking as a product surface.** `factory-os.md` §16 item 4 and §13.4 —
  per-worker rates are an input and are answerable on request, but there is no leaderboard and no
  daily ranking. An efficiency *report* that ranks workers is precisely the surface that decision
  forbids.
- **Nothing that computes pay.** `factory-os.md` F11, `[NEVER]`: *"the moment a worker's pay depends
  on the number they tap, the number stops describing production and starts describing pay."*

### 6.7 Delivery, format and storage

| Concern | Decision |
|---|---|
| **Format** | **Self-contained HTML.** No external CSS, no CDN, no webfont, no image. Nexflow orange `#ff5c1a`, a `@media print` block, A4. The exact constraints `buildCoveringNoteHtml()` already meets — *"renders offline in any browser"* `[VERIFIED]`. |
| **PDF** | The browser's own print-to-PDF. **Never server-side.** `CLAUDE.md`: server-side jsPDF was abandoned at 221ms CPU against a 400ms budget `[VERIFIED]`. `js/invoice-pdf.js` and `js/challan-pdf.js` are client-side for the same reason. |
| **Where it renders** | A new page, `intelligence.html`, root level, role-gated per I8. Reports open in a new tab so a print dialogue never loses the chat. |
| **Storage** | `p2_intelligence_reports`, HTML verbatim in a `text` column. Not Supabase Storage — §I10. |
| **Retention** | **Kept.** A report shown to a third party is an audit artefact. ~100KB each; 200 reports is 20MB. No retention job, and none needed. |
| **Email** | **Not in v1.** `filing-package` already owns the emailing path (Resend, `filing@nexflowautomations.in`, `reply_to` the tenant's own address) `[VERIFIED]`. If a report needs emailing, reuse that sender — never add a second. |

---

## 7. The Internal Compliance Report

The single highest-value artefact in this document, and the reason the whole layer sells.

### 7.1 The situation it is built for

An inspection is coming. The owner has two hours. Today those two hours are spent pulling papers
from three places, calling the accountant, calling the storekeeper, and assembling a folder by
hand — and the folder is incomplete, because the person assembling it is guessing at what will be
asked.

**With Intelligence: one request, one document, thirty seconds.**

**What it is not, and this must be said in the product and not only here:** it is **not a statutory
filing, not a legal submission, and not a substitute for records the inspector is entitled to
examine directly.** It is a presentation of what is already in the system, organised the way an
inspector expects to see it.

### 7.2 What it contains

Six sections, in this order, because it is the order an inspection tends to follow:

| # | Section | Source | Model |
|---|---|---|---|
| 1 | **Company and registration** | `p2_tenant_settings` — name, address, GSTIN, AATO bracket | never |
| 2 | **Stock register, as at today** | §3.4 — every active material, quantity, unit, UQC, min level, value where priced | never |
| 3 | **Goods received, last 90 days** | `p2_stock_transactions` type `grn` — date, GRN no, supplier, supplier GSTIN, invoice no, material, quantity, rate, intrastate/interstate | never |
| 4 | **Delivery challan register** | `p2_dispatch_orders` — number, date, client, purpose, status; cancelled challans from `p2_cancelled_challans`; **gap detection over the number series** | never |
| 5 | **Job-work position (s.143)** | §3.8's clock — principal, challan no and date, material, quantity, days held, band | never |
| 6 | **Quality records** | **Wave 2.** In Wave 1 the section is present and states plainly that quality checks are not recorded digitally | never |
| — | **Observations** | Computed flags from §3.8, narrated | **Opus** |

**Section 6 is present even though it is empty, and that is deliberate.** An inspector who asks
about quality records and finds no section assumes the report is hiding something. A section that
says *"Quality inspection records are not maintained in Nexflow. Any physical inspection registers
are held separately"* is accurate, and it tells the owner what to have on the desk beside the
printout.

**Section 4's gap detection is not new code.** `export.html`'s Table 13 already walks the challan
number series per prefix, folds the legacy `CHAL-YYYYMMDD-NNNN` format into the bare-number series,
counts cancelled challans from both `p2_dispatch_orders` and `p2_cancelled_challans`, and scopes
the From/To display to rows with a real `dispatch_date` `[VERIFIED — Session 11 + Shipped Sept 2]`.
`[DECIDED]` **Extract `challanSeriesKey()` and `computeTable13Buckets()` to a shared module and
call them.** A second gap detector would disagree with the GSTR-1 workbook, and a CA comparing the
two would find Nexflow contradicting itself on a document register — the exact outcome
`nexflow-mcp.md` §0 C6 fixes in the invoice figures.

### 7.3 The accuracy claim, stated precisely

The brief says 85–90% of what an inspector checks. **That number should not be printed anywhere**,
because it invites the reader to treat the remaining 10–15% as rounding. What ships instead is a
statement of which parts are exact and which are not:

| Part | Status |
|---|---|
| Document registers — challans, GRNs, invoices, numbers, dates, gaps | **Exact.** These are the ledger. |
| Stock quantities | **Exact as recorded.** Equal to physical stock only if every movement was entered. |
| Stock values | Exact where a price exists; **blank and counted where none does**. |
| s.143 lot ageing | Exact, with one stated simplification (§12.7). |
| Quality records | **Absent.** Wave 1. |
| Physical verification of anything | **Absent, permanently.** §12.1. |

### 7.4 The disclaimer, verbatim and unremovable

Rendered at the **top** of the report, not the bottom, in a bordered block:

> **This report is based on digitally recorded data. Physical verification is recommended before
> presenting to authorities.**
>
> It is a presentation of records already held in Nexflow, organised for review. It is not a
> statutory filing, not a legal submission, and not a substitute for the records themselves.
> Quantities are exact as recorded and will differ from physical stock wherever a movement was not
> entered. Nexflow Automations accepts no liability for its use in any proceeding.

**Four rules about it, all `[DECIDED]`:**

1. **Top, not bottom.** A disclaimer under a six-page register is a disclaimer nobody read.
2. **It is a constant in code and is not model-authored.** `nexflow-mcp.md` §8 mitigation 3: tenant
   strings never reach an instruction-shaped field, and a disclaimer a model writes is a disclaimer
   that varies.
3. **It survives print.** Inside the `@media print` block, on the first page, never
   `display: none`.
4. **There is no setting to hide it**, and the report is generated with it or not at all.

### 7.5 The Observations section — the only interpreted part

Opus receives the computed flags from §3.8 and writes 150–300 words. It is given **counts and
exemplar rows, never the registers** (§6.1), so it cannot restate a table and cannot contradict one.

```
Observations

Three things in this period are worth having an answer ready for.

Twelve GRN lines between 4 August and 22 August carry no supplier invoice
number -- suppliers Bharat Electricals (7 lines), Supreme Bearings (4) and one
line with no supplier recorded at all, dated 27 August, 50 units of STATOR
STACK KS100-4P CL200. An inspector asking to trace a purchase to a supplier
invoice will not be able to on these.

Four challan numbers are missing from the 1103-1177 series -- 1145, 1150, 1160
and 1174. Nexflow has no record of them as issued or cancelled. Under Rule
56(7) a gap in a document series needs an explanation.

Two job-work lots from KPML are past 335 days against the one-year section 143
limit: challan 2WST-4471 dated 12 October 2025 and 2WST-4498 dated 24 October
2025.
```

**Four properties of that text, each a prompt rule with a test behind it:**

- **Every number came from a flag.** 12, 7, 4, 1103–1177, 1145/1150/1160/1174, 335, the two challan
  numbers. §18.1 item 1.
- **It names documents, never categories.** *"Twelve GRN lines"* with the suppliers and the dates
  beats *"some purchases are missing invoice numbers"* by the entire value of the feature.
- **It says what an inspector will do with each finding**, which is what turns an observation into
  a preparation.
- **It offers no remedy it cannot support and proposes no action Nexflow would take.** I1 item 4.

### 7.6 What this report is deliberately not

| Not | Why |
|---|---|
| A GST filing or any part of one | `CLAUDE.md`'s GST Scope lock, permanent `[VERIFIED]` |
| A legal opinion on any finding | §12.4 |
| A claim that records are complete | §7.3 |
| A substitute for the physical registers | §7.4 |
| Automatically generated or scheduled | An inspection-preparation document produced on a cron is a document nobody asked for on the day it mattered. Owner-initiated, always. §16 item 5. |
| Emailed anywhere by Intelligence | §6.7 |

---

## 8. Proactive Alerts

### 8.1 The principle

Some findings are worth pushing without being asked. **Most are not**, and the difference is
whether there is a deadline the owner can still act before.

`[DECIDED]` **Push is for transitions with a deadline. Standing states go in the daily digest.**
This is `factory-os.md` §5.7's rule and `automation-strategy.md` §3.1's failure mode for the founder
channel — *"an alert that repeats every day for a week is a muted channel"* — and it applies to an
owner with exactly the same force.

### 8.2 The alert catalogue

Every condition is a SQL predicate (I11). The model phrases; it never decides.

| # | Alert | Fires when | Delivery | Wave |
|---|---|---|---|---|
| 1 | **GRN missing supplier invoice number** | a GRN line ≥ 3 days old with `invoice_no` null or blank | digest | 1 |
| 2 | **Days of cover below reorder cadence** | §3.4 `days_of_cover` < §3.7 `median_gap_days` for that material's usual supplier | **push, once** | 1 |
| 3 | **s.143 lot entering the breach window** | clock crosses into `breach_warning` (≤ 30 days) or `breached` | **push, once per lot** | 1 |
| 4 | **Receivable past the agreed period** | `payment_status = 'overdue'`, invoice_date + 45 days | **push, once per invoice** | 1 |
| 5 | **Confirmed sale dispatches with no invoice** | ≥ 5 sale-purpose challans older than 30 days with no invoice | digest, weekly | 1 |
| 6 | **GST rate anomaly on receipts** | GRN lines at 0% for a material whose other lines are 18% | digest | 1 |
| 7 | **Challan number gap** | §7.2 section 4's detector finds a gap in the current FY | digest, weekly | 1 |
| 8 | **Invoice sequence anomaly** | an `invoice_number` reused, or the sequence moving backwards | **push, once** | 1 |
| 9 | **Worker rejection rate rising** | `factory-os.md` §6.3's two thresholds | digest | **2** |

**Alert 2 is the brief's *"copper wire stock at 3 days remaining"*, made self-referential.** A fixed
three-day threshold is wrong for a material bought weekly and wrong again for one bought quarterly.
Comparing cover against **that material's own observed buying cadence** is the same
tenant-supplies-the-norm rule as everywhere else (§3.2), and it is the difference between an alert
that fires usefully and one an owner turns off in week two.

**Alert 8 is not in the brief and belongs on this list.** `CLAUDE.md` Known Open Items #7
`[VERIFIED]`: `p2_invoices` has unique indexes on `dispatch_order_id` and `invoice_token` only —
**nothing enforces `invoice_number` uniqueness at the database level, not even per tenant.**
Correctness relies entirely on a row-locked counter never being hand-edited backward, which is a
routine direct-SQL-Editor pattern in this project's own history. **A duplicate invoice number is a
GSTR-1 filing error that nothing currently detects**, and a daily read is the cheapest detector
available until the unique index lands.

### 8.3 Avoiding alert fatigue

Five mechanisms, in order of how much each actually does:

1. **One alert per condition per object, once — not once per day** (I11). §9.3's
   `p2_intelligence_alerts` makes it a database fact: `(tenant_id, alert_key)` unique, with
   `cleared_at`. An alert re-fires only after its condition has cleared and recurred.
2. **Push is reserved for deadlines.** Four of nine alerts push. The rest wait for the digest.
3. **One digest, at one time, reusing the channel that already exists.** The 8am `check-low-stock`
   digest is live on cron jobid 2 `[VERIFIED]`. **Intelligence adds sections to it; it does not add
   a second daily message.** An owner receiving two Telegram messages a day from Nexflow reads
   neither.
4. **A hard cap on digest length.** `automation-strategy.md` §4.3's rule, inherited verbatim: *"if
   the digest cannot fit, the correct response is to raise the alert threshold, not to lengthen the
   message."* Five items maximum per section, worst first, with an exact count of the remainder.
5. **A quiet day says so in one line.** `factory-os.md` §8.5: *"a warning symbol that appears every
   evening stops being a warning by the end of the second week."*

**And the measurement that decides whether any of this worked** `[UNVERIFIED — §17 Q3]`: the share
of pushed alerts that are still unresolved 14 days later. Above roughly 50%, the thresholds are
wrong and the correct response is to raise them, not to add a reminder.

### 8.4 Delivery — the existing rails, and the two traps on them

**Telegram and in-app, through `p2_notifications` → the `notify` Edge Function.** No new delivery
code exists in this feature.

`notify` takes `{notification_id}`, resolves `telegram_chat_id` and quiet hours from
`p2_tenant_settings`, sends plain text, and flips status to sent or failed `[VERIFIED — Step 4]`.
The in-app bell with its unread badge and Realtime update is already live in `js/navbar.js`
`[VERIFIED]`.

`p2_notifications.type`'s CHECK gains `'intelligence_alert'` and `'intelligence_digest'`. §9.4 —
**and note the interaction there, because two documents widen the same constraint.**

**Trap 1 — never `opsAlert()`.** `p2_ops_alerts` deliberately has **no `tenant_id`**; it is
founder-scoped infrastructure with RLS enabled and no policy at all `[VERIFIED —
automation-strategy.md §3.1]`. `factory-os.md` §0 C4 makes the same correction for the daily report.
An owner-facing alert on the founder channel is a cross-tenant leak with a friendly interface.

**Trap 2 — quiet hours write `status='failed'`.** `notify` records a notification suppressed by
quiet hours as *failed*; the three-value CHECK has no room for "postponed" — `CLAUDE.md` Known Open
Items #20 `[VERIFIED]`. `[DECIDED]` **Do not special-case the send. Check at configuration time**,
exactly as `factory-os.md` §8.4 decides: the settings screen refuses to save a digest hour that
falls inside quiet hours and names both values. A send-time bypass is a second place that decides
what quiet hours mean, and the next feature would need a third.

**The `[NEVER]`:** Intelligence never emails an alert and never sends a WhatsApp message. Email
belongs to `filing-package` (§6.7); WhatsApp Business is blocked on incorporation
`[VERIFIED — automation-strategy.md §5]`.

### 8.5 What an alert looks like

Push, single condition, Haiku phrasing over computed values:

```
Copper Wire 0.90/1.20MM -- 11 working days of cover

62.4 kg left. You are using about 5.4 kg per working day, and you normally
buy this from Bharat Electricals every 21 days. Last receipt was 17 days ago.
```

Digest, appended to the existing 8am message:

```
Nexflow -- 16 Sept

Low stock
  - Bearing 6205 ZZ   42 nos, below minimum 100

Worth a look
  - 12 GRN lines have no supplier invoice number. Oldest is 9 Aug.
    This will block ITC on those purchases.
  - 78 sale challans to KPML have no invoice. Oldest is 3 Aug.
  - 4 challan numbers missing from the 1103-1177 series.
```

**Every figure there was computed before the model was called**, and the Haiku call exists only to
order the sections and write connecting words. On a day with nothing to report, the Intelligence
sections are absent entirely and the digest is unchanged from today's.

### 8.6 Running the sweep — dispatcher and drain, from day one

§I12. New Edge Function `intelligence-sweep`, two modes, mirroring A6's shape exactly:

```
cron 'intelligence-sweep-dispatch'   02:00 UTC daily (07:30 IST)
   -> intelligence-sweep { mode: 'dispatch' }
        one p2_job_queue row per tenant with intelligence_enabled
        AND intelligence_alerts_enabled. Writes no alerts.
        O(1) per tenant. Cannot time out.

cron 'intelligence-sweep-drain'      every 2 minutes, 02:05-03:00 UTC
   -> intelligence-sweep { mode: 'drain' }
        claims up to 5 jobs with FOR UPDATE SKIP LOCKED, evaluates
        conditions, writes p2_intelligence_alerts and p2_notifications
        rows, returns. Bounded by 5 tenants per invocation regardless
        of book size.
```

`dedupe_key = tenant_id || ':' || sweep_date` on `p2_job_queue`'s `UNIQUE (job_type, dedupe_key)`
makes a dispatcher that runs twice harmless `[VERIFIED — automation-strategy.md §3.3]`. A job at
`max_attempts` goes `dead` and raises a **`critical`** `opsAlert` — that is the founder-facing half
and the only part of this feature that touches A0.

**The drain finishes before the 8am digest.** Sweep at 07:30 IST, digest at 08:00 — the alerts
exist before the message that carries them is built. If the sweep has not finished for a tenant,
**the digest sends without the Intelligence sections rather than waiting.** A late digest is worse
than an incomplete one.

**Cron jobids 2, 3, 8 and 9 are in use** `[VERIFIED]`. Take the next free ones, and confirm with
`SELECT jobid, jobname, schedule FROM cron.job ORDER BY jobid;` before writing the migration —
numbering in this project has been assigned by hand throughout.

---

## 9. Schema

Two new tables, eight Postgres functions (§3.11), four columns on `p2_tenant_settings`, one widened
CHECK. **No change to any existing table's shape.**

Conventions inherited without exception: `p2_` prefix · `uuid` primary keys with
`gen_random_uuid()` · `timestamptz` for instants, `date` for IST calendar days · RLS via
`get_my_tenant_id()`, **never `auth.uid()`** (the known-broken pattern that silently blocks every
non-owner staff role) · **RLS enabled in the same migration that creates the policy** — the audit's
single largest finding was fifteen tables that got a policy and never got `ENABLE ROW LEVEL
SECURITY` `[VERIFIED]` · `tenant_id` passed explicitly by the caller with **no `set_tenant_id()`
trigger**, since a trigger deriving from `get_my_tenant_id()` clobbers a service-role insert's
explicit `tenant_id` with NULL `[VERIFIED — the reasoning already recorded on p2_notifications]`.

### 9.1 Advisor queries are logged, not tabled

Advisor turns go to **`p2_agent_logs`**, which already exists and is written fire-and-forget at
every exit point `[VERIFIED]`. `intent` carries an `intelligence:` prefix —
`intelligence:sales_trend` — so Intelligence traffic is separable from chat traffic and from
`[mcp]` traffic in one table with **no schema change**. The same convention `nexflow-mcp.md` §5.2
adopts.

**No new table for queries.** An advisor answer is not an artefact anybody comes back to; the
question and the intent are enough to instrument §14.5's four numbers.

### 9.2 `p2_intelligence_reports`

```sql
-- One row per generated report. Holds the computed data, the narrative and the
-- rendered HTML VERBATIM -- never re-rendered at read time (I10). A report shown
-- to an inspector is an artefact, and "what did you show them?" must have an
-- exact answer months later.
CREATE TABLE p2_intelligence_reports (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid NOT NULL REFERENCES p2_tenants(id),

  kind           text NOT NULL CHECK (kind IN
                   ('inspection','bank_stock','working_capital',
                    'capacity_history','production_efficiency')),
  period_from    date,
  period_to      date,
  params         jsonb NOT NULL DEFAULT '{}',

  data           jsonb NOT NULL,   -- every computed figure. The audit answer to
                                   -- "where did this number come from?"
  narrative      text,             -- NULL when the model failed and phase 1 shipped alone
  action_items   jsonb NOT NULL DEFAULT '[]',
  html           text NOT NULL,    -- rendered, verbatim, self-contained (6.7)

  narration_model text,            -- 'claude-opus-5' | 'claude-haiku-4-5' | 'deterministic'
  narration_layer smallint,        -- 1 | 2 | 3 -- which fallback layer produced it (4.7)
  input_tokens    integer,
  output_tokens   integer,

  generated_by   uuid REFERENCES auth.users(id),   -- auth.uid(), NOT tenant_id
  created_at     timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE p2_intelligence_reports ENABLE ROW LEVEL SECURITY;

CREATE POLICY p2_intelligence_reports_select ON p2_intelligence_reports
  FOR SELECT USING (tenant_id = get_my_tenant_id());
CREATE POLICY p2_intelligence_reports_insert ON p2_intelligence_reports
  FOR INSERT WITH CHECK (tenant_id = get_my_tenant_id());
-- No UPDATE policy and no DELETE policy. A generated report is an observation
-- about a moment; a corrected one is a new report, and both stay. Same posture
-- as p2_quality_records (factory-os.md 11.5) and p2_cancelled_challans.

CREATE INDEX p2_intelligence_reports_tenant_idx
  ON p2_intelligence_reports (tenant_id, kind, created_at DESC);
```

**`generated_by` holds `auth.uid()`, and this is the second table in the schema to get it right.**
`p2_dispatch_orders.created_by` holds `tenant_id` rather than a user id — `CLAUDE.md` Known Open
Items #9, a write-path bug, not a missing column `[VERIFIED]`. `factory-os.md` §3.1 makes the same
commitment for `p2_production_orders`. **Every table created from here on writes the real user id.**

**`narration_layer` exists so §14.5 can measure fallback rate without parsing logs.** A tenant whose
reports are routinely produced by layer 3 is a tenant whose reports are correct and unimpressive,
and that is worth knowing before they say so.

### 9.3 `p2_intelligence_alerts`

```sql
-- Alert state, so "fires once, re-fires only after clearing" is a database fact
-- and not a fragile query over notification history (I11).
CREATE TABLE p2_intelligence_alerts (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid NOT NULL REFERENCES p2_tenants(id),

  alert_type     text NOT NULL,    -- section 8.2's catalogue key
  alert_key      text NOT NULL,    -- stable identity of the OBJECT, e.g.
                                   -- 'grn_no_invoice:GRN-0042:<material_id>'
                                   -- 'cover_low:<raw_material_id>'
                                   -- 's143:<stock_transaction_id>'
                                   -- 'receivable_overdue:<invoice_id>'
  severity       text NOT NULL CHECK (severity IN ('push','digest')),

  payload        jsonb NOT NULL DEFAULT '{}',   -- computed figures, for the phrasing call
  first_fired_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at   timestamptz NOT NULL DEFAULT now(),
  cleared_at     timestamptz,
  notification_id uuid,            -- the p2_notifications row, when one was sent
  created_at     timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE p2_intelligence_alerts ENABLE ROW LEVEL SECURITY;

CREATE POLICY p2_intelligence_alerts_select ON p2_intelligence_alerts
  FOR SELECT USING (tenant_id = get_my_tenant_id());
CREATE POLICY p2_intelligence_alerts_insert ON p2_intelligence_alerts
  FOR INSERT WITH CHECK (tenant_id = get_my_tenant_id());
CREATE POLICY p2_intelligence_alerts_update ON p2_intelligence_alerts
  FOR UPDATE USING (tenant_id = get_my_tenant_id())
             WITH CHECK (tenant_id = get_my_tenant_id());
-- No DELETE. An alert that fired is history -- section 14.5 measures resolution
-- time from it.

-- The mechanism. One LIVE alert per object, enforced by the database rather
-- than by application code -- the same posture as p2_agent_proposals' live
-- index (nexflow-agent.md 8.1) and factory-os.md's active-assignment index.
CREATE UNIQUE INDEX p2_intelligence_alerts_live_idx
  ON p2_intelligence_alerts (tenant_id, alert_key)
  WHERE cleared_at IS NULL;

CREATE INDEX p2_intelligence_alerts_open_idx
  ON p2_intelligence_alerts (tenant_id, alert_type, first_fired_at)
  WHERE cleared_at IS NULL;
```

**The sweep's per-alert logic is three lines and the unique index carries it:**

```
condition true,  no live row  -> INSERT. Push if severity='push'. Notify.
condition true,  live row     -> UPDATE last_seen_at. NOTHING IS SENT.
condition false, live row     -> UPDATE cleared_at. Nothing is sent.
```

**`INSERT ... ON CONFLICT DO NOTHING` then read**, never `SELECT` then `INSERT` — two drain
invocations racing on the same tenant is exactly the shape `factory-os.md` §11.9 warns about for
progress rows, and `FOR UPDATE SKIP LOCKED` on the job makes it unlikely rather than impossible.

### 9.4 Columns and a widened CHECK

```sql
ALTER TABLE p2_tenant_settings
  ADD COLUMN IF NOT EXISTS intelligence_enabled            boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS intelligence_alerts_enabled     boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS intelligence_queries_this_month integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS intelligence_reset_month        text;   -- 'YYYY-MM', IST
```

`intelligence_enabled` defaults **false** on every tenant including the live ones (I7).
`intelligence_alerts_enabled` defaults **true**, unlike the others, because it is inert until
`intelligence_enabled` is on — and a tenant who turns Intelligence on wants the alerts. The same
asymmetry `factory-os.md` §11.7 applies to `daily_report_enabled`, for the same reason.

```sql
ALTER TABLE p2_notifications DROP CONSTRAINT p2_notifications_type_check;
ALTER TABLE p2_notifications ADD  CONSTRAINT p2_notifications_type_check
  CHECK (type IN ('challan_dispatched','payment_overdue','low_stock',
                  'filing_package_ready',
                  'intelligence_alert','intelligence_digest'));
```

> **⚠ Two documents widen this same CHECK, and the second to land will drop the first's values
> unless it includes them.** `factory-os.md` §11.8 adds `'daily_production_report'`,
> `'production_delay'`, `'quality_alert'` and `'work_assigned'`. **Before writing this statement,
> read the live constraint** —
> `SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conname = 'p2_notifications_type_check';`
> — and include every value already present. A `DROP` + `ADD` pair that silently narrows a CHECK
> breaks every insert of the dropped type, and it breaks them at send time, in production, on a path
> that is fire-and-forget and swallows its own errors `[VERIFIED — js/notifications.js]`.

### 9.5 Migration order

```
20261101_intelligence_aggregates.sql     -- section 3.11, Session 1
20261115_intelligence_reports.sql
  1. CREATE TABLE p2_intelligence_reports  + ENABLE RLS + 2 policies + 1 index
  2. ALTER p2_tenant_settings ADD x4
20261201_intelligence_alerts.sql
  3. CREATE TABLE p2_intelligence_alerts   + ENABLE RLS + 3 policies + 2 indexes
  4. Widen p2_notifications type CHECK     -- READ THE LIVE DEFINITION FIRST (9.4)
```

Applied via the **Supabase SQL Editor, never `supabase db push`** — the standing rule, because push
replays old migrations.

**Test tenant `fe2b94fb-9668-405f-9c62-5f54b32f8c7a` first.** Then `node _ai/regression/snapshot.js`
and diff against the **most recent prior snapshot**, never `baseline-pre-2H.json` `[VERIFIED]`. These
migrations add only new objects and four defaulted columns, so the diff must be empty.

**Then run `CLAUDE.md`'s standing check**, because `20261115` touches `p2_tenant_settings`:

```sql
SELECT agent_tier FROM p2_tenant_settings
 WHERE tenant_id = 'fe2b94fb-9668-405f-9c62-5f54b32f8c7a';   -- must still be 'unlimited'
```

**Never apply to SS Engineering, Datta Prasad or Shivprasad before the pilot decision.** The columns
default to off, so applying is safe — but §14.4's pilot picks who gets switched on, and that is a
conversation, not a migration.

---

## 10. Cost Model

₹90/USD, the convention `enterprise-strategy.md` §3.2 and `automation-strategy.md` §8 both use.
Model pricing per §0 C1 — **not the brief's figures.**

| Model | Input ₹/1K tok | Output ₹/1K tok |
|---|---|---|
| `claude-haiku-4-5` | ₹0.090 | ₹0.450 |
| `claude-opus-5` | ₹0.450 | ₹2.250 |

### 10.1 Per interaction

| Interaction | Stages | In | Out | Cost |
|---|---|---|---|---|
| **Simple advisor query** | Haiku classify + Haiku narrate | 1,200 + 1,500 | 100 + 250 | **₹0.40** |
| **Complex advisor query** | Haiku classify + **Opus** narrate | 1,200 + 4,000 | 100 + 600 | **₹3.30** |
| **Bottleneck query** | Haiku classify + Opus over candidates | 1,200 + 5,000 | 100 + 700 | **₹4.03** |
| **Report with Opus narrative** | aggregate (₹0) + Opus | 10,000 | 1,500 | **₹7.88** |
| **Bank stock statement** | aggregate only — **no model** (§6.3) | — | — | **₹0.00** |
| **Refusal** (coverage, role, Wave 2) | Haiku classify only | 1,200 | 100 | **₹0.15** |
| **Alert sweep, per tenant per day** | SQL (₹0) + Haiku phrasing when something fired | 1,200 | 300 | **₹0.25 when it fires** |

**The classification call is charged on every turn including refusals, and that is deliberate.**
§4.4: a refusal must be a good sentence, and a good refusal has to know what was asked.

### 10.2 Per client per month

Three profiles. "Queries" counts advisor turns including refusals and bottleneck questions.

| Profile | Queries/mo | Opus share | Reports/mo | **Monthly compute** |
|---|---|---|---|---|
| **Light** — an owner who asks occasionally | 25 | 40% | 1 | **₹40** |
| **Realistic** — 3 questions a working day | 78 | 40% | 4 | **₹156** |
| **Heavy** — at §11's ceiling | 150 | 60% | 8 | **₹388** |

Realistic, worked: 31 complex × ₹3.30 = ₹102 · 47 simple × ₹0.40 = ₹19 · 4 reports × ₹7.88 = ₹32 ·
alerts 26 days × 40% firing × ₹0.25 = ₹3. **₹156.**

Heavy, worked: 90 complex × ₹3.30 = ₹297 · 60 simple × ₹0.40 = ₹24 · 8 reports × ₹7.88 = ₹63 ·
alerts ₹3. **₹387.**

### 10.3 Margin at the ₹60,000/year add-on

₹60,000/year is **₹5,000/month** of revenue per client. The brief's constraint is 90%+.

| Profile | Compute/mo | Revenue/mo | **Gross margin** |
|---|---|---|---|
| Light | ₹40 | ₹5,000 | **99.2%** |
| **Realistic** | **₹156** | ₹5,000 | **96.9%** |
| Heavy, 40% Opus | ₹301 | ₹5,000 | 94.0% |
| **Heavy, at the ceiling, 60% Opus** | **₹388** | ₹5,000 | **92.2%** |

**The constraint is met with real headroom, and the binding case is the heavy one at 92.2%.** §11
sets the fair-use ceiling exactly where that arithmetic would otherwise stop clearing 90% — which
is the only reason the ceiling exists.

**Across a book**, at 60% adoption among Pro/Founder/Enterprise clients on a realistic mix:

| Clients on Intelligence | Compute/mo | Revenue/mo | Effect |
|---|---|---|---|
| 10 | ₹1,560 | ₹50,000 | +7% on `business-strategy.md` §3.1's cost base |
| 60 (of 100) | ₹9,360 | ₹3,00,000 | +8% cost at 100 clients, +₹36L/yr revenue |
| 300 (of 500) | ₹46,800 | ₹15,00,000 | +25% cost, strongly accretive |

### 10.4 Why Intelligence does not repeat the write layer's cost problem

`nexflow-agent.md` §9.5's finding is the most important cost conclusion in the document set: the
write layer *"breaks the margin target at exactly the client count where it is already tightest"*,
pushing the 90% crossing from ~105 clients to ~130–150. **Intelligence does not, and the reason is
arithmetic rather than luck.**

| | Write layer | **Intelligence** |
|---|---|---|
| Per interaction | ₹0.77 | ₹0.40–₹7.88 — **higher** |
| Interactions/tenant/month | **1,300** | **~80** |
| Monthly compute | ₹1,000 | **₹156** |
| Add-on price | ₹75,000/yr | ₹60,000/yr |
| Compute as % of price | **16%** | **3.1%** |

**Intelligence costs more per call and six times less per month, because a factory has fifty
transactions a day and three questions.** The write layer sits on the volume side of the line
`nexflow-agent.md` §9.5 identifies; Intelligence sits two orders of magnitude below it, where the
old *"AI is never the cost"* rule still holds.

### 10.5 Prompt caching — worth less here than in the write layer, which is counterintuitive

`nexflow-agent.md` §9.3 declines to plan on caching because factory transaction cadence is slower
than the 5-minute TTL. **Intelligence has the opposite cadence — an owner asks three questions in
four minutes while thinking about one problem — and still gets less from caching, for a different
reason.**

The cacheable prefix here is the **system prompt plus the intent list**, about 900 tokens. Everything
expensive is the *aggregated data* in the input and the *narrative* in the output, and **neither
caches**: the data differs on every call by construction, and output tokens never cache at all.

Best case on a complex query: 900 × 0.9 × ₹0.450/1,000 = **₹0.36 saved out of ₹3.30, about 11%.**

`[DECIDED]` **Build the prompt cache-correctly from day one — static instructions first, intent
definitions next, the aggregate and `todayIST()` last — and plan on nothing.** The ordering costs
nothing now and is expensive to retrofit. **Every figure in §10.2 and §10.3 assumes zero caching.**

---

## 11. Pricing

### 11.1 The number

`[RECOMMENDED]`

| | |
|---|---|
| **Nexflow Intelligence** | **₹60,000/year**, add-on, requires Pro, Founder or Enterprise |
| Included | **150 advisor queries + 8 reports per month** |
| Overage | **₹8 per query, ₹40 per report**, billed quarterly, shown live in Settings |
| Setup | **₹10,000 one-time** — the data-quality pass in §11.3 |
| Not available on | Lite, demo |

**Where that lands a client.** Pro at ₹1,25,000 + Intelligence ₹60,000 = **₹1,85,000/year ≈
₹15,400/month.** With the agent add-on as well (₹75,000) it is ₹2,60,000 ≈ ₹21,700/month — above
`nexflow-agent.md`'s ₹12,000–20,000 band, which is correct: that band is priced against replacing one
junior employee, and this replaces something the factory was never buying at all.

### 11.2 Why the ceiling is 150 and 8, and why overage is ₹8 and ₹40

**The ceiling is set where the margin arithmetic stops clearing 90%, not where usage is expected.**
§10.3: 150 queries at a 60% Opus mix plus 8 reports is ₹388/month and **92.2%**. Push it to 200
queries and the same mix is ₹495 and **90.1%** — technically clearing, with no room left for a bad
assumption about the Opus share.

**150 queries is roughly six a working day.** The realistic profile is three. **The ceiling is 2×
expected use, so the overwhelming majority of clients never see it** — the principle
`nexflow-agent.md` §10.2 applies to the agent's 900/month: *"it exists to convert the genuinely heavy
tail into revenue rather than to shape behaviour."*

**Overage at ₹8 per query against a blended cost of about ₹2.20 is 73% margin** — close enough to the
base plan that going over is not dilutive. ₹40 per report against ₹7.88 is 80%. **₹1.50, the figure
an instinct reaches for, would be 32% margin and would drag the blend down every time a client
engaged more deeply with the product** — the opposite of what pricing should reward.

**And it never blocks.** I9. At 90% of the ceiling the owner gets one in-app notification and one
Telegram message; at 100% Intelligence keeps working and the overage accrues, visible in Settings.
*"Bill for overage; never refuse a dispatch"* — and never refuse an owner an answer about their own
business.

### 11.3 What the setup fee buys, and why it is not optional

**Intelligence is only as good as the data underneath it**, and on the live book that data has
documented, specific problems — every one of them found by the system itself:

- **623 materials with no HSN audit and 50 dispatched items with no HSN code** at Datta Prasad
  `[VERIFIED — Session 16]`. Every compliance answer understates until these are cleared.
- **SS Engineering has zero `p2_material_prices` rows** `[VERIFIED]`. Without them there is no stock
  value, no bank statement, no working capital report and no material side to §3.9.
- **15 GRN lines at 0% GST against identical 18% goods** at Datta Prasad `[VERIFIED]`. These will be
  reported as an anomaly every month until corrected — correctly, and annoyingly, if nobody acts.
- **One orphan GRN with no supplier and no invoice number** `[VERIFIED]`. It appears in every
  supplier aggregate as "Unknown supplier" until fixed.

The ₹10,000 covers: an HSN audit pass (`export.html`, already built, free on every plan), a
material-price population pass over the top forty materials by movement, clearing the flagged GRN
anomalies, and **one supervised session where the owner asks their own five real questions and the
answers are checked against what they already know to be true.**

**Do not discount it**, for the reason `business-strategy.md` §2.5, `nexflow-agent.md` §10.4 and
`factory-os.md` §14.1 all give about the setup fees that already exist: **it is not margin, it buys
the week that prevents the expensive failure.** Here the expensive failure is specific — **an owner
who catches Intelligence being wrong once, for a data reason, stops trusting every answer after
it.**

### 11.4 Who gets it

| | Intelligence |
|---|---|
| **Lite** | **Never.** No agent at all (`plan='lite'` → limit 0) and no write layer `[VERIFIED]` |
| **Demo tenant** | **Never.** `agent_enabled = false` and it stays that way |
| **Pro / Founder / Enterprise** | Paid add-on, `intelligence_enabled` off until the owner turns it on |
| **SS Engineering** | Free, permanently, like everything else `[DECIDED — CLAUDE.md]`. **But zero price rows means every valuation surface refuses (§6.3) until the setup pass runs.** |
| **Datta Prasad** | `[RECOMMENDED]` the pilot tenant — most data, most volume, most documented problems, most to gain. §14.4 |
| **Shivprasad** | After the pilot. Product and price data still incomplete `[VERIFIED]` |
| **A principal (KPML)** | **Not applicable as an add-on.** A principal's analytical surface is `factory-os.md` §9's scoped RPC, inside the platform fee, and **§12.7's boundary applies without exception** |

### 11.5 The commercial reading

**Intelligence is the first Nexflow add-on whose value an owner can state without being taught the
product.** The agent replaces a person they already pay. Factory OS replaces paperwork they already
do. Intelligence answers questions they already have and currently guess at — and the demonstration
is one question about their own factory, answered in ten seconds, on their own data, in front of
them.

**That makes it the strongest add-on for a renewal conversation and the weakest for a cold one**,
because the demo needs data that only exists after months of use. §14.2 and §0 C3 point at the same
consequence: **Intelligence sells to existing clients, not to new ones**, and it should be priced and
positioned as the reason a Year-2 client pays more — never as an acquisition tool.

---

## 12. What Intelligence Cannot Do

Honest, and specific. For each: why it is irreducible, **what Nexflow shows instead**, and **the
disclaimer that appears**. The disclaimers are strings in code, carried on `coverage.caveats` from
the aggregator that knows they apply (§3.1) — never composed by a model, never chosen by a renderer.

### 12.1 Physical inventory

**Intelligence knows what was recorded. It does not know what is on the shelf, and the two diverge
continuously.**

Every unrecorded movement, every miscount at a GRN, every part taken from a bin without an issue
widens the gap. Nexflow cannot detect any of them, because the only evidence they leave is an
absence.

**Shown instead:** recorded balances, labelled as recorded; the date of the last physical count from
`p2_stock_transactions` rows with `notes LIKE 'Physical Stock Count%'`; and **how long ago that
was.**

**Disclaimer:** *"Stock figures are what Nexflow has recorded. They match physical stock only where
every movement was entered. Last physical count: {date} ({n} days ago)."* When no count has ever been
posted, the sentence says so plainly.

**And the structural gap, stated once because both sibling documents state it too:**
`nexflow-agent.md` §14.3 and `factory-os.md` §13.7 each observe that **nothing forces a physical
count.** Every financial error has a monthly forcing function — the filing deadline. Physical
inventory has none, so the strongest catch is the one most likely never to run. `[RECOMMENDED]`
Intelligence adds one line to the existing digest when no count has been posted in 90 days, naming
the five materials with the largest movement since. One line a quarter, on rails that already exist.

### 12.2 A principal's material, in any cost, value or revenue figure

**A job worker holds material they do not own, and every valuation that includes it is wrong in a
direction that matters.**

`v_p2_stock_balance` filters `owned_by IS NULL` inside its own definition and does not expose the
column `[VERIFIED]` — so own-pool scoping is structural rather than a predicate a future edit can
drop. §3.2, §6.3.

**Shown instead:** own-pool figures by default; the principal pool available separately through
`v_p2_stock_balance_by_owner`, clearly labelled, **and never summed with own stock into a single
"stock value".**

**Disclaimer, on every valuation surface for a job-work tenant:** *"Excludes material held on behalf
of a principal under job work. That material is not owned by the company and is not available as
security or as inventory value."*

### 12.3 Supplier reliability, and any future date

**Intelligence can describe what a supplier has done. It cannot predict what they will do, and it
cannot compute a lead time from data that does not record one.**

§0 C5. `factory-os.md` §13.3 `[VERIFIED]`: there is no purchase-order receiving model, no expected
delivery date anywhere in the schema, and no observed lead time to derive one from, **because a GRN
records what arrived and never what was promised.**

**Shown instead:** observed receipt cadence (§3.7), rate history, and record completeness per
supplier — how often their GRN lines arrive without an invoice number, which is a real and checkable
reliability signal about the *paperwork*.

**Disclaimer:** *"This is how often you have received this material, not how long the supplier takes
to deliver. Nexflow records what arrived, never what was promised."*

**And the honest extension:** even with a purchase-order model, past delay would not predict future
delay. It would make the question answerable, not the answer reliable.

### 12.4 Legal, tax and accounting judgment

**Intelligence produces figures and observations. It does not produce opinions, positions or
advice**, and the distinction is not stylistic.

`CLAUDE.md`'s GST Scope lock is permanent and unambiguous: Nexflow generates tax invoices and
CA-facing exports. **It does not file, does not submit, and does not advise.**
`enterprise-strategy.md` §8 refuses payroll and TDS for the same reason.

| Intelligence may say | Intelligence may not say |
|---|---|
| *"12 GRN lines have no supplier invoice number."* | *"Your ITC claim is invalid."* |
| *"This lot is 335 days old against the one-year limit."* | *"You are in breach of section 143."* |
| *"₹6.1L is past 45 days from a micro enterprise client."* | *"You will be disallowed under 43B(h)."* |
| *"Stock at the latest recorded purchase rate is ₹18.4L."* | *"Your closing stock value is ₹18.4L."* |

The right-hand column is a professional's conclusion drawn from the left. **Intelligence supplies the
input to a judgment and never the judgment itself.**

**Disclaimer, on every compliance surface:** *"These are observations from your recorded data, not
legal or tax advice. Confirm anything you intend to act on with your CA."*

### 12.5 Payables, and whether a supplier is an MSME

§0 C6, §0 C7. Two separate gaps landing on one answer.

**There is no payables register** — Session 24 on the build sequence `[VERIFIED]` — and the one view
that resembles one carries a known-wrong `total_drawn` (Known Open Items #14). **And Udyam columns
exist only on `p2_clients`, never on `p2_suppliers`** `[VERIFIED]`, so Nexflow cannot confirm that a
supplier is a micro or small enterprise at all.

**Shown instead:** GRN value less advances, date-scoped, labelled an upper bound; and a
**conditional** 43B(h) sentence that names its condition rather than asserting it.

**Disclaimer:** *"Nexflow records supplier advances but not individual supplier payments, and does
not hold supplier MSME registration details. This is an upper bound on what is owed. If any of these
suppliers is a registered micro or small enterprise, section 43B(h) may apply to your own return —
your CA can confirm which."*

### 12.6 Valuation basis

**Nexflow values stock at the latest recorded purchase rate. That is one basis among several and not
necessarily the one an auditor wants.**

`p2_material_prices.price_per_unit`, latest by `effective_date`, is the convention used by the CA
report, the exports and the invoices `[VERIFIED]`. `p2_stock_transactions.rate` is a GRN-specific
paid rate and is **not** the valuation rate — a distinction `CLAUDE.md` states explicitly and which
is easy to get backwards.

**Shown instead:** the figure, the basis, the valuation date, and the count of rows with no price.

**Disclaimer:** *"Valued at the latest recorded purchase rate per material — not FIFO, not weighted
average, not cost of acquisition, not net realisable value. {n} materials have no recorded price and
are shown without a value."*

### 12.7 Anything that crosses a tenant or an owner boundary

**Permanent and inherited.** `kpml-network-plan.md` §10.5, `factory-os.md` F10 and §9.5,
`nexflow-mcp.md` §6.3.

- **No cross-tenant aggregate exists in any form.** A CA with twenty clients makes twenty calls
  (`nexflow-mcp.md` §6.3). Intelligence has no multi-tenant query and no code path that could produce
  one.
- **No aggregate spanning owners reaches a principal.** KPML sees their own material at a vendor and
  nothing else — not a total, not a count of the vendor's other work, not a rate, and not a
  denominator computed over it. **The variance-denominator leak is the subtle one**
  (`factory-os.md` §9.5 mode 3): a rejection *rate* whose denominator is the vendor's whole output
  encodes another principal's volume, and it looks like a detail.
- **No worker identity, in any form, ever crosses a tenant boundary.** `factory-os.md` F10, binding
  Wave 2's quality reporting without exception.

**There is no disclaimer for this one, because there is no surface.** The boundary is enforced by the
absence of a query, which is the only way `bridge-agent.md` §14.5 guarantee 2 can hold: *"scope
cannot be forgotten if there is no other way to reach the data."*

### 12.8 The failure with no catch — a confident answer built on incomplete entry

**Intelligence's answers are only as complete as the data entry underneath them, and an incomplete
ledger produces a confident, specific, well-evidenced wrong answer.**

This is `nexflow-agent.md` §14.1's framing and `factory-os.md` §13.1's, applied to analysis: a paper
system produces *missing* information, visible as gaps. Intelligence produces **complete-looking**
information — named documents, exact counts, a precise date — that is wrong because a week of GRNs
was never entered.

*"Sale challans fell 68% in September"* is indistinguishable, in the output, from *"nobody entered
September's challans."*

`[DECIDED]` **Every trend answer carries a completeness signal computed alongside it**: the count of
days in the period with at least one recorded transaction, against the tenant's own observed working
pattern (§3.2). When a period has materially fewer active days than its neighbours, the answer says
so **first**:

> *"September has 6 recording days against a usual 24. Either very little happened, or entries are
> behind. Check that before reading anything else here."*

**That single check is the most valuable defensive feature in this document**, because it is the only
one that catches the failure mode with no other catch.

---

## 13. Competitive Moat

### 13.1 Why a factory owner cannot get this from ChatGPT

The brief's framing is right and the list is worth stating exactly, because each item is a fact
about *this* tenant that a general model cannot hold:

- that there are **62.4 kg of Copper Wire 0.90/1.20MM** in the store right now
- that **KPML invoice 79 has been outstanding 52 days**
- that the **s.143 clock on lot 2WST-4471 expires in 23 days**
- that **78 August challans to KPML were never invoiced**

But the list understates the argument, because it suggests the gap is *data access* — and data
access is solvable. A determined owner could export a CSV and paste it into a chat window.

**Three things survive that, and they are the actual moat:**

**1. The aggregators, not the reasoning.** §0 C8. The reasoning is a commodity — the MCP
(`nexflow-mcp.md`) gives it away deliberately, for free, on every plan including Lite, because
handing a CA's own Claude the numbers is distribution. **What is not a commodity is §3: the SQL that
turns 264 materials and eighteen months of append-only transactions into six numbers worth reasoning
over.** Every one of those queries encodes a statutory decision someone had to get wrong first —
that stock balance is `SUM(p2_stock_transactions)` and never stored; that own material is
`owned_by IS NULL`; that the s.143 clock starts at `principal_challan_date` and not `dispatch_date`
(shipped wrong, escalated to a Phase 3 blocker, fixed in Session 8 `[VERIFIED]`); that invoice
figures must use `invoice_date` and `status='sent'` or they will not tie to the filing package.
A CSV in a chat window has none of it.

**2. The answer is reproducible and the owner can check it.** Every figure traces to one aggregator
(I2), and `figures_used` is cross-checked against what was supplied (§4.7). **A pasted CSV gives a
plausible paragraph that nobody can audit** — which is fine for a thought experiment and
disqualifying for a document handed to an inspector.

**3. The data is at source, and it is continuous.** `enterprise-strategy.md` §1: *"a GRN happens at
the gate on a storekeeper's phone … whoever captures the transaction at source owns the truth."* An
export is a photograph of a moment. Intelligence reasons over a ledger that was written as the
factory ran.

### 13.2 Why the incumbents cannot build it

`nexflow-agent.md` §12.1's nine reasons apply unchanged and are not restated. **Three are sharper
for an analysis layer than for a write layer:**

**Their data arrives after the fact, and analysis is worse than a transaction when it is late.** A
Tally agent can analyse what was retyped into Tally last week. A dispatch that has not been entered
cannot be analysed at all, and the most valuable finding Nexflow has ever produced — 78 uninvoiced
challans `[VERIFIED]` — is precisely a finding about **the gap between what happened and what was
recorded.** A system downstream of the recording step is structurally blind to it.

**No ownership dimension, and it is not addable.** `enterprise-strategy.md` §1: `owned_by` has no
equivalent in Tally, Busy, Zoho or SAP's vendor view, and *"a competitor cannot bolt it on without
rebuilding their inventory model."* For a job worker, **an analysis layer without it computes a stock
value that includes the principal's material** — §6.3's bank statement, wrong, in a document sent to
a bank.

**Their AI efforts are read-only analytics, which is where everyone is safe and nobody is
differentiated.** `nexflow-agent.md` §12.1 reason 9 observes that every incumbent's AI work is in
read-only reporting because writing carries asymmetric blame. **Intelligence is read-only too** — so
this is the one Nexflow layer the incumbents can, in principle, compete on. What they cannot match
is what it reads: `movement_purpose`, `principal_challan_date`, `p2_challan_links`, `uqc`,
`hsn_source`, `purchase_type`, the s.143 bands, the 43B(h) eligibility filter. **The moat is the
schema, and it is in front of the analysis rather than inside it.**

### 13.3 Where this sits in `business-strategy.md` §6's ranking

§6 ranks six moats. Intelligence does not add a seventh — **it completes the third and strengthens
the first.**

| # | Moat | Status | What Intelligence does to it |
|---|---|---|---|
| 1 | **CA distribution channel** | strongest, building, first referrals March 2027 | **Strengthens it.** A CA whose client can answer a question in ten seconds is a CA whose month is shorter. And §0 C8's shared aggregators mean the CA's own Claude reads the same numbers through the MCP — at ₹0.0004 a call. |
| 2 | Principal network (KPML) | highest leverage, gated on the pilot | Neutral. §12.7's boundary means Intelligence adds nothing a principal sees. |
| 3 | **Opus filing package with judgment** | **SHIPPED — the only moat in the field today** | **Completes it.** Same capability — Opus reasoning over one tenant's real rows — moved from monthly and CA-facing to on-demand and owner-facing. |
| 4 | Marathi tutorial engine | uncontested, unbuilt | Neutral in Wave 1. §17 Q5 asks whether Intelligence should speak Marathi at all. |
| 5 | Bridge Agent | strongest lock-in, latest | Neutral, and mutually reinforcing: Intelligence finds the errors before they become vouchers. |
| 6 | MSME data infrastructure | not a moat yet; the acquisition thesis | **Raises its value.** An acquirer buying underwriting signal is buying aggregates, and §3 is the aggregation layer over that data. |

**Row 3 is the argument.** `business-strategy.md` §6 calls the filing package *"the only moat
currently in the field"* and explains why no competitor produces it: *"it requires holding the
transactions at source … and being willing to run a frontier model per tenant per month on data most
vendors never see."*

**Intelligence changes "per month" to "per question", and that is the whole product.** The capability
is proven, the cost is known (§10), and the reasoning quality was demonstrated on a real client's
real data before a line of this document was written.

### 13.4 The honest counter-argument

**Someone could build an MCP server over a Postgres schema and point Claude at it.**
`nexflow-agent.md` §12.2 names this as *"the actual competitive threat — not Tally"*, and for an
analysis layer it is a stronger threat than for a write layer, because there is no confirm gate to
build, no RPC to get right, and no audit trail to maintain. **Analysis is the easiest thing to
copy.**

Four things stand in the way, and only the last is durable:

1. The aggregators are 2,000 lines of statutory judgment, not 200 lines of SQL (§13.1).
2. The compliance surfaces — ITC-04, Table 12/13, 43B(h), the s.143 bands, GSTR-2B — are years of
   accumulated detail a generic schema does not have and cannot infer.
3. The user is a factory owner who will not configure anything, and whose data lives in Nexflow
   because a storekeeper put it there at a gate.
4. **Whoever builds it has to build Nexflow's schema first** — and the schema is the moat.

**Therefore the strategic instruction is inherited unchanged: never compete on the model, never
compete on the protocol.** Compete on the schema, the aggregators and the compliance surfaces. If a
better model arrives next year, every answer in this document gets cheaper and more accurate for
free — which is the correct exposure to have.

---

## 14. Build Sequence

### 14.1 Prerequisites

Five. The first two block the build; the rest block one feature each.

| # | Prerequisite | Why | Blocks |
|---|---|---|---|
| **P1** | **`invoice_total` → `invoice_date` + `status='sent'`** | `nexflow-mcp.md` §0 C6 `[VERIFIED]`: that branch filters on `created_at` and includes drafts, while `invoices.html`, `export.html` Sheet 2, Table 12 and 43B(h) all moved to `invoice_date`/`status='sent'` on 2 Sept 2026. **Every revenue figure Intelligence reports must tie to those surfaces.** Two lines. | **Every revenue figure** |
| **P2** | **Extract `fetchCoveringNoteData` to `_shared/compliance.ts`** | §3.8. Also extract `computeS143Clock` to `_shared/s143.ts` — `nexflow-mcp.md` §5.4's instruction, same reason: the clock is implemented twice and `filing-package/index.ts:1299` already carries a comment acknowledging it `[VERIFIED]`. | `compliance_exposure`, §7, five alerts |
| **P3** | **Extract `challanSeriesKey()` + `computeTable13Buckets()` from `export.html`** | §7.2. A second gap detector would disagree with the GSTR-1 workbook on a document register. | §7 section 4, alert 7 |
| **P4** | **A6 — `p2_job_queue`** | I12, §8.6. The sweep is the same shape as the finding that kills `filing-package` past ~20 tenants. | §8 only |
| **P5** | **A0 — the founder ops channel** | §15's founder column is dead code without it. Needs `'intelligence'` added to `p2_ops_alerts.source`'s CHECK — the same widening `bridge-agent.md` §10.4 needs for `'bridge'`. | §15's alerting |

**P1 is small and urgent beyond this document.** It is already a prerequisite for
`nexflow-mcp.md`'s `get_invoice_status`, and it fixes a wrong number the chat surface shows paying
clients today. **Do it in whichever session arrives first, not in three.**

### 14.2 Where this sits in the roadmap

`CLAUDE.md`'s "What to build next" is a single 32-item sequence, and **nothing here displaces items
0, 1 and 2** — the live-tenant filing-package migration, A0 and A6 — which carry a hard **5 October
2026** deadline and are a distribution dependency rather than infrastructure. `CLAUDE.md` is
explicit: *"Build item 0, then A0, then A6. Nothing else until all three are done."* `[VERIFIED]`

`[RECOMMENDED]` **Intelligence sits after the agent write layer, with Wave 2 gated on
`factory-os.md` sessions 1–4.**

**Three reasons, and the third decides it:**

1. **P1 and P2 are shared with the MCP**, itself recommended for after A6. Doing the extractions
   once, for both, is materially cheaper than twice.
2. **The write layer's supervised pilot is where master-data problems surface**
   (`nexflow-agent.md` §10.4). **Intelligence is more sensitive to them than the write layer is**,
   because a bad master corrupts an aggregate silently rather than producing a visible clarification
   question. The same visit fixes both (§11.3).
3. **§0 C3 is the binding constraint and it is calendar time, not build time.** No live tenant has
   six complete periods before roughly February 2027, and building the trend half earlier does not
   make it demonstrable earlier. **The point-in-time half works on day one**, and §14.3 front-loads
   exactly that.

### 14.3 The sessions

**Three sessions to a usable advisor plus the inspection report. Six to everything in Wave 1.**

**Session 1 — the aggregation layer, §3, and nothing else.**
P1 and P2 first. Migration `20261101_intelligence_aggregates.sql`: the eight Postgres functions with
their grants. `_shared/intelligence.ts` carrying the `AggregateResult` / `Coverage` contract and the
six Wave-1 aggregators. The `intelligence_query` action on `agent-query` with the Haiku classifier,
the `NARRATION_MODEL` table, §4.7's three-layer fallback, role and plan gates, and the meter.
**End to end: one typed question returns a narrated answer on the test tenant, and every figure in
it is reproducible from one SQL call.** No reports, no alerts, no bottleneck finder.

**Session 2 — point-in-time answers and the inspection report.**
P3. `compliance_exposure` wired to §3.8's extracted module. `p2_intelligence_reports` and the four
settings columns. §6.1's render pipeline and §6.2's two-phase build. The inspection report (§7)
complete, with §7.4's disclaimer block and §7.2's shared gap detector. `intelligence.html`.
**This is the demo, and it works on a tenant with three weeks of data.**

**Session 3 — bank stock statement and working capital.**
§6.3 and §6.4. §6.3's three safeguards: the principal-material exclusion, the unvalued-row refusal,
the stated basis. §6.4's payables upper bound with its verbatim caveat — and **not**
`v_p2_supplier_advance_balance`.

**Session 4 — trend and the bottleneck finder.**
§5 in full: changepoint detection, the nine candidate events, §5.5's three rendering rules. Plus
§12.8's completeness signal — **build it in this session, not later; it is the guard on everything
session 4 adds.** `[UNVERIFIED]` Not demonstrable on a live tenant before ~Feb 2027 (§0 C3); develop
against synthetic history on the test tenant.

**Session 5 — proactive alerts.**
P4. `p2_intelligence_alerts` and the widened notification CHECK (read the live definition first,
§9.4). `intelligence-sweep` with dispatch/drain on `p2_job_queue`, two crons. The eight Wave-1
conditions. §8.3's five fatigue mechanisms. Digest sections appended to the existing 8am message —
**never a second daily message.**

**Session 6 — capacity (degraded) and the supervised pilot.**
§6.5's historical output report with its refusal language. Then **thirty days on one live tenant**,
§14.4. §14.5's four numbers instrumented and read.

**Wave 2** — production efficiency, quality trend, and routing `capacity_available` to Factory OS's
`delivery_estimate` — is one further session, gated entirely on `factory-os.md` sessions 1–4.

**Not negotiable:** session 1 before everything. The `AggregateResult` / `Coverage` contract is what
every later consumer addresses, and changing it once reports and alerts both depend on it is a
rewrite of three sessions.

### 14.4 The pilot

**One tenant, thirty days.** `[RECOMMENDED]` **Datta Prasad Enterprises**, for the reasons
`nexflow-agent.md` §17 Q5 and `factory-os.md` §12.5 both give — most data, most volume, most
documented data-quality problems, most to gain — and one specific to this layer: **every finding
Intelligence would surface for them has already been independently confirmed by Opus in a filing
package** `[VERIFIED — Session 16]`. That is a ground truth no other tenant offers.

The pilot is not a soft launch. It has an exit condition:

- **The owner asks their own questions, unprompted, in week three.** A layer nobody asks a second
  question of has failed, and it fails invisibly in every usage metric.
- **Five answers are checked against what the owner already knows to be true.** Not against the
  database — against the person. A figure right in SQL and wrong in the factory is the §12.8
  failure, and the owner is the only detector.
- **One inspection report is produced and read end to end by the owner**, with the question asked
  directly: *"if an inspector had this, what would they still ask for?"* The answer goes into §7.2's
  section list.
- **§14.5's four numbers are computed**, and the unbacked-figure rate is zero.

### 14.5 Instrumentation — measure it, do not assume it

From session 1, four numbers monthly, from `p2_agent_logs` and `p2_intelligence_reports`:

| Metric | What a bad number means |
|---|---|
| **Unbacked-figure rate** — `figures_used` entries with no matching aggregate field (§4.7) | **Must be zero.** Anything above it means I2 is broken and every answer is suspect. Check this one first. |
| **Refusal rate, by cause** | High coverage-refusals is §0 C3 working as designed. High Wave-2 refusals is a roadmap signal — it says what the owner actually wants. |
| **Fallback layer distribution** — `narration_layer` | Layer 2 or 3 appearing routinely means Opus is failing shape validation and nobody noticed, because the report still shipped. |
| **Second-question rate** — a query within 10 minutes of a prior one | **The engagement measure that matters.** Near zero is the alarming number. |

**The fourth deserves the emphasis `nexflow-agent.md` §14.4 gives its cancel rate.** Query volume
looks healthy when an owner asks one thing a day out of habit. **A follow-up question is evidence
the first answer was worth building on**, and it is the only signal here that distinguishes a useful
layer from a decorative one.

---

## 15. Failure Mode Analysis

Every way this fails, what the system does, what the **owner** sees, and what the **founder** sees on
A0. Severity vocabulary is A0's: `critical` bypasses quiet hours, `important` and `monitor` do not.

| # | Failure | System does | Owner sees | Founder sees |
|---|---|---|---|---|
| 1 | Haiku returns `unknown` | Plain text; no aggregate, no Opus | *"I don't have a way to answer that from your data."* | Nothing — normal |
| 2 | Intent needs a Wave 2 table | Refusal before any aggregate | §4.3's shape: gap named, adjacent real thing delivered | `monitor`, aggregated — **the roadmap signal** (§14.5) |
| 3 | **Model states a figure it was not given** | `figures_used` check fails; falls to the next layer | A plainer answer | **`critical`.** I2 is the safety argument; a breach means every answer is suspect |
| 4 | Opus returns malformed JSON | Layer 2 (Haiku, counts only), then layer 3 | A plainer answer, same numbers | `monitor`; **`important`** above ~5% |
| 5 | Anthropic API down or 5xx | Layer 3 — deterministic, no model | Sentences from the same figures, less fluent | `important` if sustained > 15 min |
| 6 | API 429 | Retry once with backoff, then layer 3 | As #5 | `important` if sustained |
| 7 | Cold start, first call fails | Retry once, silently | Nothing | Nothing. Known Deno behaviour `[VERIFIED]` |
| 8 | Aggregator times out or errors | No narration call; error mapped, never raw | *"Nexflow could not read that right now. Nothing has changed."* | **`important`** — an aggregator failing is a bug, not a data condition |
| 9 | Not enough periods for a trend | Refusal, zero Opus calls | §4.4 row 1 — names when it becomes answerable | Nothing — by design (§0 C3) |
| 10 | Nothing qualified | Renders as an **answer** | *"No invoices are outstanding."* | Nothing. §4.4 row 3 — never an error path |
| 11 | Role not permitted | Refused **before** the aggregate | *"Payment figures are limited to the owner and the accountant."* | Nothing |
| 12 | Prompt injection in a material name | Returned byte-identical, wrapped as data | Possibly a misleading paragraph | `monitor`. **No write is possible — there is no write path** (I1) |
| 13 | **Data entry weeks behind** | §12.8's completeness signal fires | *"September has 6 recording days against a usual 24…"* **first** | `monitor` after 3 periods — a churn signal |
| 14 | Every material unpriced | Valuation reports **refuse** (§6.3) | *"No purchase prices are recorded…"* with the fix named | `monitor` — the §11.3 setup conversation, surfaced |
| 15 | Report phase 2 fails | `narrative` NULL, `narration_layer` set | The full report, one line where the narrative would be | `monitor` |
| 16 | Owner prints mid-generation | Phase 1 is complete and printable by design (§6.2) | A complete document without observations | Nothing |
| 17 | Alert fires daily for one object | **Impossible** — the live unique index (§9.3) | One alert | **`critical`** if observed; dedup has failed |
| 18 | Sweep job hits `max_attempts` | `dead` in `p2_job_queue` | No alerts that day | **`critical`** — a tenant silently got nothing, the failure A6 exists to expose |
| 19 | Sweep dispatcher did not run | No jobs, no alerts for anybody | No alerts | **`critical`** via A3's cron heartbeat — **not** by anything in this feature |
| 20 | Quiet hours suppress the digest | Row stays; the bell still shows it | The bell, not Telegram | `monitor`. §8.4's config check should have prevented it |
| 21 | Both docs widen the notification CHECK | Inserts of the dropped type fail silently | Missing notifications, no error | **`critical`** if observed. §9.4's warning exists for this |
| 22 | A principal's material enters a valuation | **Structurally prevented** — the view filters in its own definition | — | **`critical`** if ever observed; the view was changed |
| 23 | Cross-tenant figure in an answer | **Impossible** — no multi-tenant query exists | — | **`critical`** if ever observed |
| 24 | Fair-use ceiling exceeded | Keeps working; overage accrues | One notification at 90%, one at 100% | `monitor` |
| 25 | Owner asks once and never returns | Nothing to detect at request level | — | **`important`** — §14.5's second-question rate |

**Rows 3, 22 and 23 are the ones to design against.** They are the only three where the system does
something structurally forbidden rather than merely unhelpful, and all three are asserted in §18.

**Row 25 is the one to worry about.** Everything above it is a malfunction with a signal. Row 25 is
the feature working exactly as built and being useless anyway — and it appears in no error log, no
alert and no uptime metric, only in §14.5's fourth number. That is why that number is on the list.

---

## 16. Explicitly Out of Scope `[NEVER]`

Permanent. Not a backlog, not gated on a client asking.

1. **Any write, by any path, in any form.** No INSERT, no UPDATE, no mutating RPC, no call to
   `propose`. I1.
2. **A "fix it for me" action on a finding.** Intelligence finds 78 uninvoiced challans; offering to
   raise them is one line of UI away and it is wrong. The finding goes to the write layer as a normal
   `propose` turn **initiated by the human**, with its own confirmation. **This will be proposed
   again — it is the obvious next feature and it is wrong every time.** I1 item 4.
3. **A model computing, estimating, rounding or interpolating any figure.** I2 — including *"roughly"*
   or *"about"* applied to a number the model derived rather than received.
4. **Stating a cause.** §5.5. Correlation, named as correlation, with confounders stated.
5. **Scheduled or automatic report generation.** An inspection-preparation document produced on a
   cron is a document nobody asked for on the day it mattered. Owner-initiated, always. §7.6.
6. **Any cross-tenant aggregate, and any aggregate spanning owners on a principal surface.** §12.7.
7. **Worker identity, or any per-worker figure, crossing a tenant boundary.** `factory-os.md` F10.
8. **A worker performance ranking as a product surface.** `factory-os.md` §16 item 4, §13.4.
9. **Anything computing pay.** `factory-os.md` F11.
10. **The words "profit" and "margin" in any answer.** §0 C4.
11. **The words "caused", "because of" or "due to" in an attribution sentence.** §5.5 rule 1.
12. **Legal, tax or accounting opinions.** §12.4, and `CLAUDE.md`'s permanent GST Scope lock.
13. **GST filing, portal credentials, DSC, EVC, IRN, e-way bills.** Same lock.
14. **A delivery date, a lead time, or any forward-looking supplier commitment.** §12.3.
15. **A capacity figure presented as a commitment.** §6.5.
16. **Editing or deleting a generated report.** `p2_intelligence_reports` has no UPDATE and no DELETE
    policy. A corrected report is a new report. §9.2.
17. **Emailing anything.** `filing-package` owns the sending path. §6.7.
18. **A second daily message.** Intelligence adds sections to the existing 8am digest. §8.3.
19. **Reading `v_p2_supplier_advance_balance`** while Known Open Items #14 is open. §0 C6.
20. **A service-role key, or any credential, outside Supabase's runtime.** `nexflow-agent.md` §16
    item 12.
21. **Intelligence on Lite or the demo tenant.** I7.
22. **Suppressing or shortening §7.4's disclaimer.** There is no setting, and the report generates
    with it or not at all.

---

## 17. Open Questions

Each needs a decision or a measurement **before** the session named.

### Blocking session 1

**Q1. Are the six Wave-1 aggregators the right six?** `[RECOMMENDED, not decided]`
§3 picks them from the brief plus two the brief does not name — `compliance_exposure` and
`supplier_performance` — which §7 and §8 both depend on.
**Resolve:** before session 1 writes SQL, ask the pilot owner for **ten real questions they have
asked themselves in the last month** — not ten questions about software. Map each to an intent. Any
question mapping to nothing is either a seventh aggregator or an honest §4.4 refusal, and knowing
which is worth an hour.
**Decide before:** session 1's migration, because adding a function later is easy and changing
`AggregateResult` later is not.

**Q2. Does the `client_name` join in §3.3c hold on real data?** `[UNVERIFIED]`
`p2_dispatch_orders` carries a frozen `client_name` and no `client_id`; `p2_invoices` carries both.
The `FULL OUTER JOIN` on name is the only bridge available, and a renamed or re-typed client splits
into two rows.
**Resolve:** on Datta Prasad's real data, count names appearing on exactly one side:
```sql
SELECT d.client_name, count(*) FROM p2_dispatch_orders d
 WHERE d.tenant_id = :t AND d.status = 'confirmed'
   AND NOT EXISTS (SELECT 1 FROM p2_invoices i
                    WHERE i.tenant_id = d.tenant_id AND i.client_name = d.client_name)
 GROUP BY 1;
```
A handful is normal and is the 78-uninvoiced finding. **Dozens of near-duplicate spellings is a
different problem** and means §3.3c needs a normalised join key before it ships.
**Decide before:** session 1.

### Blocking session 4

**Q3. Is the §5.3 changepoint test right, and is the alert threshold sensible?** `[UNVERIFIED]`
2× MAD plus a 15% floor is reasoned, not measured, and **no live tenant has six periods to measure it
against** (§0 C3).
**Resolve:** build a synthetic eighteen-month history on the test tenant with three known injected
changepoints and two deliberate near-misses. Assert all three fire and neither near-miss does. Then
**re-run against Datta Prasad's real data the month they reach six periods**, and check the output
against what the owner says actually happened.
**Alert-threshold half:** §8.3's measure — the share of pushed alerts still unresolved after 14 days.
Above ~50%, raise the thresholds; do not add a reminder.
**Decide before:** session 4 ships to a live tenant, and re-decide at the first six-period tenant.

### Blocking pricing

**Q4. Is ₹60,000 right, and is 150 queries the right ceiling?** `[RECOMMENDED, not decided]`
§10.3 clears 90% at every profile and §11.2 sets the ceiling where the arithmetic stops clearing.
**The unknown is not cost — it is willingness to pay**, and the honest position is that nobody has
ever sold this to an MIDC factory owner.
**Resolve:** in the pilot's month three, ask the owner what an answer they trust is worth per month.
Then plot actual query counts and set the ceiling near the 85th percentile.
**Decide before:** the first Intelligence quote.

**Q5. Should Intelligence answer in Marathi?** `[UNVERIFIED]`
The read layer is single hardcoded Hinglish and `CLAUDE.md` records that bilingual support across
intents is *"a future pass, not per-intent"* `[VERIFIED]`. But Intelligence's user is the **owner**,
not the storekeeper, and owners in this segment read English business terms fluently.
**The specific hazard:** `tutorial-engine.md` ADR-12's rule is absolute — **wrong Marathi is worse
than English**, because the reader cannot tell it is wrong until they have acted on it. That applies
with unusual force to a sentence containing a rupee figure and a compliance consequence.
**Recommendation: English only in Wave 1**, with GST/HSN/SAC/ITC and every document number in Latin
script regardless — the convention `nexflow-agent.md` §7.2 already sets. Revisit only if the pilot
owner asks, and then through `tutorial-engine.md` §8.5's read-aloud gate with a real person.
**Decide before:** session 2's report templates. A bilingual template is far harder to retrofit than
a bilingual sentence.

### Design, resolvable in-session

**Q6. Should an accountant be able to generate the inspection report?**
`[RECOMMENDED: owner only, for now]` — I8.
The accountant is often the person who would actually assemble it. But it is the one report that
leaves the building and is shown to a third party, and **an owner who did not know it was produced
is an owner who cannot answer questions about it.**
**Recommendation:** owner only in v1. If the pilot owner asks for accountant access, the change is
one row in I8's table, not a redesign.
**Decide before:** session 2.

**Q7. Should an Intelligence finding be linkable into the write layer's chat?**
`[RECOMMENDED: yes, as a link, never as an action]`
§16 item 2 forbids a "fix it" button. A **link** that opens the agent chat pre-filled with the
owner's own sentence — *"raise invoices for the August KPML challans"* — is different: the human
still types or edits it, still reads a proposal, still confirms.
**The line to hold:** Intelligence may hand over a **question**, never a proposal. The moment it
hands over a pre-built proposal, the confirmation becomes a formality on a plan nobody composed.
**Decide before:** any UI work linking the two layers.

**Q8. What happens to reports when a tenant leaves?** `[UNVERIFIED]`
`p2_intelligence_reports` holds documents shown to inspectors and banks. E4's One-Click Full Export
ships 20 CSVs of every `p2_*` table `[VERIFIED — Session 13]` — **it will not include a table that
did not exist when it was written.**
**Resolve:** add `p2_intelligence_reports` to `js/full-export.js`'s table list in session 2, and its
HTML documents to the zip's `documents/` folder alongside the invoices and challans.
**Decide before:** the first live tenant generates a report they might later need after leaving.

---

## 18. Acceptance Tests

Intelligence is done when every one of these passes on the test tenant
(`fe2b94fb-9668-405f-9c62-5f54b32f8c7a`). Run the whole list before the first live tenant, and again
before any release that touches an aggregator, a prompt, or the narration routing.

### 18.1 The model wrote no number — the headline tests

1. **Every figure in a generated answer is reproducible from one aggregator call.** Take one
   narrated answer, extract every numeral, and match each against a field in the `AggregateResult`
   that was passed in. **Zero unmatched numerals.** This is I2, and it is the test the whole design
   exists to pass. `factory-os.md` §18.7 item 41 states the same assertion for the daily report.
2. **`figures_used` cross-check is live in production, not only in the suite.** Plant a response
   naming a figure absent from the input; assert the answer falls to the next layer and
   `p2_agent_logs` records `error_reason='unbacked_figure'`.
3. **A report's registers are byte-identical to the same query run directly.** Generate an
   inspection report; independently run §3.4's aggregator and `export.html`'s Table 13 logic; assert
   equality row for row.
4. **With the Anthropic key removed, every answer and every report still returns**, from layer 3,
   with the same figures. §4.7.
5. **The bank stock statement makes zero Anthropic calls.** Instrument the client. §6.3.

### 18.2 Correctness of what is read

6. **`sales_trend` revenue ties exactly to `invoices.html` and to `export.html` Sheet 2** for the
   same client and period — `invoice_date`, `status='sent'`. Run against Datta Prasad's August data,
   where the divergence from `created_at` is largest. §14.1 P1.
7. **`inventory_health` stock figures equal `v_p2_stock_balance` exactly**, and a zero-balance active
   material appears with 0 rather than being absent. §3.4 decision 4.
8. **Days of cover is NULL, never infinity, for a material with stock and no consumption**, and that
   material appears in the dead-stock bucket with its `last_consumed` date. §3.4 decision 1.
9. **An Intelligence answer and the equivalent `mcp_read` call return the same number.** §0 C8, and
   `nexflow-mcp.md` §17.4 item 20's headline test, inherited. **This is what proves the aggregators
   are shared rather than duplicated.**
10. **`compliance_exposure` counts equal the filing package's** for the same month. Same extracted
    module, so any divergence means the extraction changed behaviour. §3.8, §14.1 P2.
11. **The s.143 bands match `principal-dashboard.html`** for the same lots, and every response
    states the all-receipts-are-365-day simplification `[VERIFIED — Session 8]`.
12. **`material_cost_analysis` excludes principal-owned GRN rows.** Plant a priced `owned_by IS NOT
    NULL` GRN row; assert it appears in no cost figure. §12.2.
13. **Every date is an IST calendar date.** Run an aggregation at 01:00 IST and assert the period
    boundaries are today's IST month, not yesterday's UTC one. §3.2.

### 18.3 Refusals, bounds and honesty

14. **A section with more than 10 qualifying rows passes 10 plus an exact remainder count, and the
    narrative states the remainder.** I6. Assert the phrase appears.
15. **With fewer than 6 complete periods, no attribution is produced and no Opus call is made.**
    §0 C3, §5.3. Assert zero Opus calls on a 3-period tenant asking "why".
16. **With fewer than 2 complete periods, no trend is produced.** §4.4 row 1.
17. **An empty result renders as an answer, not an error**, and does not begin with "Couldn't",
    "Could not" or "Please provide" — the strings `agent-query` treats as failures `[VERIFIED]`.
    §4.4 row 3.
18. **A Wave 2 question names the gap and delivers the adjacent real thing.** §4.3. Assert the
    response contains the material check and no date.
19. **A role-refused request makes zero Anthropic calls after classification.** I8, and
    `factory-os.md` §18.6 item 30's assertion.
20. **No attribution sentence contains "caused", "because of" or "due to".** §5.5 rule 1. String-scan
    every attribution response in the suite.
21. **Every attribution with candidates carries the confounder sentence.** §5.5 rule 2.
22. **Zero candidates produces the specific answer, not silence.** §5.5 rule 3.
23. **A period with materially fewer recording days than its neighbours is flagged first.** §12.8.
    Delete a week of transactions on a copy and assert the completeness sentence leads the answer.
24. **No answer contains the words "profit" or "margin".** §0 C4. String-scan.
25. **A job-work client's contribution answer suppresses the material column entirely.** §3.9 rule 1.
26. **A supplier cadence answer never contains "lead time" or a delivery date**, and always carries
    the §12.3 caveat. §0 C5.

### 18.4 Reports

27. **The inspection report's disclaimer appears at the top, in print, on the first page**, and no
    setting removes it. §7.4.
28. **Section 6 (quality records) is present and states that quality is not recorded**, rather than
    being omitted. §7.2.
29. **The challan gap detector agrees with `export.html`'s Table 13 exactly**, including the legacy
    `CHAL-` format folding and cancelled challans from `p2_cancelled_challans`. §7.2, §14.1 P3.
30. **The bank statement excludes principal-owned material**, states the exclusion on its face, and
    **refuses entirely when no material has a price.** §6.3.
31. **The working capital payables section reads the date-scoped computation, never
    `v_p2_supplier_advance_balance`**, and carries its caveat verbatim. §0 C6.
32. **Phase 1 renders and is printable before phase 2 completes.** Stub the Anthropic client with a
    30-second delay; assert the registers are complete and the print button is live at 5 seconds.
    §6.2.
33. **A stored report's HTML is served verbatim and is never re-rendered.** Change a price, re-open
    an old report, assert the figure is unchanged. I10.
34. **`p2_intelligence_reports` rejects UPDATE and DELETE** from an authenticated session — there is
    no policy for either. §9.2.

### 18.5 Alerts

35. **The same condition on the same object fires once, not once per day.** Run the sweep three days
    running with the condition true; assert one `p2_intelligence_alerts` row, one notification, and
    `last_seen_at` advancing. I11, §9.3.
36. **An alert re-fires after clearing and recurring**, and not before.
37. **The unique live index rejects a second open alert for the same `alert_key`** — asserted at the
    database level, not in application code. §9.3.
38. **The dispatcher enqueues one job per eligible tenant and writes no alerts.** §8.6.
39. **Running the dispatcher twice enqueues nothing the second time** (`dedupe_key`).
40. **Two drain invocations never claim the same job** (`FOR UPDATE SKIP LOCKED`).
41. **Intelligence adds sections to the existing 8am digest and sends no second message.** Assert one
    Telegram send per tenant per day. §8.3.
42. **A day with nothing to report produces no Intelligence sections**, and the digest is unchanged
    from today's. §8.3 mechanism 5.
43. **`intelligence_alert` and `intelligence_digest` are accepted by `p2_notifications.type`'s CHECK,
    and so is every value that was there before.** §9.4's warning — read the live definition and
    assert the full set.

### 18.6 Isolation, roles and gating

44. **A request carrying another tenant's `tenant_id` is refused 401 by `verifyCallerTenant`.**
45. **`p2_intelligence_reports` and `p2_intelligence_alerts` are unreadable cross-tenant.** Query as
    tenant B for tenant A's rows; expect zero from both.
46. **No answer, report or alert contains a figure spanning two tenants.** There is no query that
    could produce one — assert on the aggregator signatures, which all take a single `p_tenant_id`.
    §12.7.
47. **A Lite tenant is refused, and the demo tenant is refused by id as well as by flag.** I7.
48. **A tenant with `intelligence_enabled = false` is refused**, including an existing Pro tenant the
    day the migration runs.
49. **Plan is read fresh from the database on every call, never from `localStorage`.** Change plan in
    the DB without re-login; assert the next call reflects it. I7.
50. **An operator is refused `payment_risk` at the aggregate**, not handed figures with an
    instruction to omit them. I8.

### 18.7 Regression against the live product

51. **`node _ai/regression/snapshot.js` diffed against the most recent prior snapshot shows no change
    attributable to any Intelligence migration.** Not `baseline-pre-2H.json` `[VERIFIED]`.
52. **The read layer's 28 chat intents behave identically** — **except `invoice_total`**, which
    §14.1 P1 fixes deliberately and which must be re-verified against `invoices.html` rather than
    against its own previous output. The same carve-out `nexflow-mcp.md` §17.7 item 33 makes.
53. **The write layer and Factory OS are unaffected.** No Intelligence code path reaches `propose`,
    `confirm_proposal`, or any RPC that writes. Assert on the imports.
54. **The test tenant's `agent_tier` is still `'unlimited'`** after every migration. `CLAUDE.md`'s
    standing check — run it explicitly.
55. **The Type A guarantee holds.** On a copy of SS Engineering's data with `intelligence_enabled =
    false`: material list, stock balances, CA export, Tally export, GSTR-2B buckets, challan PDFs,
    invoice PDFs and a fixed set of agent answers are **byte-identical** before and after the
    migrations. *Any difference means the change is wrong, not that the test needs updating*
    (`kpml-network-plan.md` §2).

---

*Last updated: 13 September 2026. Design complete; no code written.*

*This is a living document. As it is built, move `[RECOMMENDED]` to `[DECIDED]`, close open
questions, and replace every `[UNVERIFIED]` with a measured number — the same convention
`enterprise-strategy.md`, `automation-strategy.md`, `bridge-agent.md`, `nexflow-agent.md`,
`factory-os.md` and `nexflow-mcp.md` all use.*

*Three things in particular must be written back here the day they are known. **§17 Q1's ten real
questions** decide whether §3 aggregated the right six things — everything downstream inherits that
choice. **§17 Q3's changepoint calibration** cannot be taken before a live tenant reaches six
complete periods (§0 C3), which is roughly February 2027, and until then §5 is reasoned rather than
measured. And **§14.5's second-question rate** is the only number that distinguishes a layer an owner
relies on from one they tried twice — it appears in no error log and no uptime metric, and if it is
near zero, the correct response is to change what the answers say, not to send more of them.*
