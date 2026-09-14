---
name: factory-os
description: Nexflow Factory OS — the layer that replaces the production supervisor's paperwork. Production orders, worker assignment without worker logins, progress tracking from a ₹8,000 Android, pass/fail quality gating, delivery estimates computed from observed variance, the 7pm owner report, and the principal-network integration. Complete schema, build sequence, cost model, pricing, and the things it genuinely cannot do. Read in full before writing any production-order code.
sources: [founder-brief-sept-2026, codebase-verification-sept-13-2026, nexflow-agent.md, CLAUDE.md, kpml-network-plan.md, kpml-network-sessions-21-22.md, automation-strategy.md, business-strategy.md, enterprise-strategy.md, bridge-agent.md]
last_updated: 13 September 2026
status: design complete — not yet built. Living document: update in place as it is built.
---

# Nexflow — Factory OS

> **`nexflow-agent.md` replaces the inventory person and the data-entry operator. This document
> replaces the supervisor's paperwork.**
>
> A supervisor in an MIDC factory does six things: decides what to make today, tells workers what
> to do, issues material from the store, tracks progress and chases delays, checks finished goods
> before they leave, and answers the owner and the principal. Five of the six are coordination and
> record-keeping. **Factory OS does those five with one confirmation each.** The sixth — standing
> on the floor and looking at the work — is not software and never will be.
>
> The owner sets direction. Workers do physical work. Nexflow handles everything in between.
>
> **The honest version of the sales line is in §0 C6, and it is not "fire your supervisor."**

**Load order for any session building this. Read in this order, in full:**

1. `_ai/CLAUDE.md`
2. `_ai/nexflow-agent.md` — **the write layer is the execution mechanism for everything here.**
   Every Factory OS action is a `propose_*` tool call, one confirmation, then an existing RPC.
   §3, §4 and §8 of that document are load-bearing here and are not restated.
3. `_ai/factory-os.md` (this file)
4. `_ai/kpml-network-plan.md` §8 and §10.5, and `_ai/kpml-network-sessions-21-22.md` §2–§3 —
   the ownership model and the scoped-access rule. §9 of this document is an application of them
   and is wrong if it drifts from them.
5. `supabase/migrations/20260825_wip_state.sql` — `confirm_bom_issue` v4 and `close_wip` in full.
   §3.4 and §3.5 build directly on both.

`_ai/automation-strategy.md` §3.1 (A0) and §3.3 (the job queue) are prerequisites for §8.
`_ai/business-strategy.md` §3 is the cost baseline §14 does arithmetic on top of.

**Status: designed, not built.** Nothing named in §3–§11 exists in the codebase. `grep -ril
"production_order\|p2_workers\|worker_id"` over the whole working tree returns **zero matches**
`[VERIFIED — 13 September 2026]`. Every codebase fact stated here was read against the working
tree on the same date and is marked `[VERIFIED]`.

**What this document is for.** A future Claude Code session must be able to build production
orders and worker assignment from this file without asking a design question. Where a decision
could not be made from here — because it needs a real worker, a real phone, or a measurement that
does not exist yet — it is tagged `[UNVERIFIED]`, repeated in §17, and given an exact procedure
for resolving it.

---

## Tag convention

Inherited from `nexflow-agent.md` and `bridge-agent.md`, unchanged.

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

Six things in the brief are wrong or incomplete against the codebase. A session that plans from
the brief without reading this section will build a double-consuming stock path, a worker table
nobody can log into, and a daily report that dies silently at sixty tenants.

### `[CORRECTION]` C1 — BOM consumption already has two entry points, and a production order's lifecycle touches both

The brief states as a fixed constraint:

> *"The existing transaction model does not change: BOM consumption happens at dispatch
> confirmation."*

**That is half of what the codebase does.** There are two consumption paths and they are
independent `[VERIFIED]`:

| Path | Where | What it consumes | When |
|---|---|---|---|
| **Production issue** | `production-issue.html` → `confirm_bom_issue` v4 | BOM × batch qty, per (material, pool) | at issue confirm |
| **Product dispatch** | `dispatch.html` → `confirm_dispatch_transaction` | BOM × dispatched qty, per (material, pool) | at dispatch confirm |

`confirm_bom_issue` creates its own `p2_dispatch_orders` row with `dispatch_type='bom_issue'`,
inserts negative `consumption` rows, **and** writes a `p2_wip_transactions` row when
`p_product_id` is non-null. `dispatch.html` separately expands `p2_product_bom` for every
dispatched product (`dispatch.html:1118-1178`) and passes the result to
`confirm_dispatch_transaction`, which inserts a second set of negative `consumption` rows
`[VERIFIED]`.

**Nothing in the schema links the two, and nothing prevents both from firing for the same batch.**
Today the tenants avoid it by convention — a factory uses one path or the other. A production
order's natural lifecycle uses *both*: issue material to a worker, then dispatch the finished
goods. Built naively, **Factory OS double-consumes every order it manages.**

This is not a reason to avoid production orders. It is the one transaction-model decision this
document has to make, and §2 F3 makes it: **consumption happens once, at issue; a dispatch that
carries a `production_order_id` never re-expands the BOM.** Existing dispatches are untouched —
the column is nullable and NULL means today's behaviour exactly, which is the Type A guarantee
shape (`kpml-network-plan.md` §2).

### `[CORRECTION]` C2 — There is no "worker" in this schema, and the obvious place to put one is broken

The brief asks for *"which worker is doing which production order"* and offers "extension of
`p2_production_orders`" as an option. Both options assume a worker is an identity the system
already has. It is not.

`p2_user_roles` is `(user_id PRIMARY KEY, tenant_id, role, email)` `[VERIFIED —
20260803_pending_invites_and_role_fixes.sql]`. Three consequences:

- **There is no name column.** The only human-readable field is an email address. A supervisor
  says "Ramesh"; the schema can only say `ramesh.k@…` or a UUID.
- **Every row requires an `auth.users` account**, and the invite flow that creates one is broken
  in this region: `supabaseAdmin.auth.admin.generateLink()` throws `AuthRetryableFetchError` on
  all `/auth/v1/admin/*` calls, which is why `p2_pending_invites` exists as a manual
  dashboard workaround `[VERIFIED]`. Onboarding thirty shop-floor workers through it is thirty
  manual founder steps.
- **A `p2_user_roles` row is an RLS identity.** `operator` can already read the dashboard, the
  dispatch pages, products and reports (`js/roles.js` `[VERIFIED]`). Giving thirty assemblers
  logins gives thirty people read access to the factory's stock position to solve a labelling
  problem.

§2 F4 and §4.1 create `p2_workers` instead — a master of people, not of users, with a nullable
link to an auth account for the minority who have one.

### `[CORRECTION]` C3 — "One voice message" needs a transcriber Nexflow does not have, and the Anthropic API does not provide one

The brief specifies worker progress as *"one tap or one voice message."*

**The Anthropic Messages API accepts text, images and documents. It does not accept audio.**
There is no speech-to-text anywhere in this stack — no vendor, no Edge Function, no client-side
library. `[VERIFIED]` — the entire AI surface in this codebase is `agent-query`, `filing-package`
and `suggest_hsn`, all of them text or image.

Worse, `nexflow-agent.md` §4.2 already marks voice input **`[NEVER]` for v1** and gives the
reason: *"a silently wrong transcription of a quantity arrives looking like clean structured
data, passes every deterministic check, and lands in the ledger."* §17 Q8 of that document sets
a measured gate — twenty real Marathi voice notes recorded on a factory floor with machine noise,
scored on numeric accuracy, ship above 98%.

**The resolution costs nothing and is better than the brief's version.** The worker does not send
audio to Nexflow. The worker taps the microphone key on their own Android keyboard — Gboard's
Marathi dictation, which they already use for WhatsApp — and the dictated **text** goes through
the ordinary propose path. No new vendor, no new cost, no new failure mode, and the worker sees
what was transcribed before they confirm it, which is precisely what a server-side transcription
would not give them. §5.3.

### `[CORRECTION]` C4 — The daily owner report is not A3, must not use A0, and is the second sequential-loop hazard

Three separate errors sit inside one sentence of the brief.

**It is not A3.** `automation-strategy.md` §4.3's daily digest is **cross-tenant and
founder-facing** — one message at 07:30 IST to `FOUNDER_TELEGRAM_CHAT_ID`, summarising every
tenant `[VERIFIED]`. The Factory OS report is **per-tenant and owner-facing**. Different
audience, different content, different channel, different cron. Building one on the other leaks a
tenant's production data into a founder digest or vice versa.

**It must not use `opsAlert()`.** `p2_ops_alerts` deliberately has **no `tenant_id`** — it is
founder-scoped infrastructure with RLS enabled and no policy at all `[VERIFIED —
automation-strategy.md §3.1]`. The owner's report belongs on the tenant-scoped path that already
exists: a `p2_notifications` row → the `notify` Edge Function → that tenant's own
`telegram_chat_id`. §8.4.

**And it is the second place the filing-package wall-clock finding applies.**
`automation-strategy.md` §1 finding 3 `[VERIFIED]`: `filing-package/index.ts` loops tenants
strictly sequentially and somewhere between ~20 and ~60 tenants the invocation is killed
mid-loop, leaving the remaining tenants with *no row, no failure status and nothing any monitor
can detect.* A daily report is the same shape — a per-tenant loop with a model call inside it —
**running thirty times more often than the filing package.** It must use A6's `p2_job_queue`
dispatcher-and-drain from day one, never a loop. §8.6, and F12.

### `[CORRECTION]` C5 — Tier 1 in the brief is the Enterprise tier, not Standard Pro

The brief's ladder reads:

> *Tier 1 — Nexflow Standard (current): Forms, CA filing, Bridge Agent. ₹1,60,000-2,00,000/yr*

**₹1,60,000 with a Bridge Agent is `enterprise-strategy.md` §7's Enterprise tier** (Pro
₹1,00,000 + Enterprise add-on ₹60,000, Year 2+), not Standard Pro — which is ₹1,00,000 today and
₹1,25,000–₹1,50,000 going forward (`business-strategy.md` §2.3) and has **no** Bridge Agent
`[VERIFIED]`.

This matters commercially, not just semantically. Read as written, the ladder implies every
Factory OS client is also an Enterprise client with a Windows agent installed on their Tally PC —
which is a PVT LTD (Segment 3) shape. A proprietor running three workers and a WhatsApp group is
a Factory OS customer and will never buy a Bridge Agent. §14 restates the ladder with the correct
base tiers and prices both paths.

### `[CORRECTION]` C6 — "Replaces the supervisor" is half true, and the other half is a reputation event

The brief's sales arithmetic — inventory person ₹18,000 + data entry ₹15,000 + supervisor
₹30,000 = ₹63,000/month against ₹35,000 — is correct arithmetic on an incorrect premise, and
**the premise is the dangerous part.**

A supervisor does two jobs. One is coordination and record-keeping: deciding the day's plan,
telling people what to do, chasing progress, checking goods, reporting upward. Factory OS does
that. The other is **being physically present on a factory floor** — hearing a machine sound
wrong, seeing a worker holding a part incorrectly, deciding on the spot that a batch is not
right. Software does none of it and this document will not pretend otherwise (§13).

An owner who fires their supervisor on a Nexflow promise and discovers in month two that nobody
is watching the floor does not blame themselves. They tell every factory owner in the district,
which is the exact market-wide reputation event `business-strategy.md` §4.3 names as **the one
thing that can actually kill this business.**

**Sell redeployment, not redundancy.** §14.4 gives the sentence to use and the arithmetic that
survives contact with month two.

---

## 1. Executive Summary

### 1.1 What it is

Four new nouns on top of the agent write layer: a **production order** (make X of product Y by
date Z), an **assignment** (worker W is doing N of it), a **progress entry** (W finished n), and
a **quality record** (p passed, f failed, here is why). Nothing else. Every one of them is
created through the existing `propose` / `confirm_proposal` protocol, and every stock movement
they cause is the same RPC the forms already call.

```
  OWNER / SUPERVISOR                                      WORKER
  ──────────────────                                      ──────
  "Make 30 KS4 for KPML by Friday"                   work.html?token=…
        │                                             ┌──────────────┐
        ▼  propose_production_order                   │ KS4 Motor    │
  ┌──────────────────────────────────────┐            │ 15 by Thu    │
  │ agent-query { action:'propose' }     │            │ done: 8      │
  │  resolve → BOM expand → stock check  │            │  [+1][+5]    │
  │  → plan → p2_agent_proposals         │            │  [Done all]  │
  └────────────┬─────────────────────────┘            └──────┬───────┘
               │ one confirm                                 │ one tap
               ▼                                             ▼
  ┌────────────────────────────┐                 ┌───────────────────────────┐
  │ create_production_order()  │                 │ record_production_progress│
  │   status = 'planned'       │                 │   append-only, no model,  │
  │   NO stock moves. §2 F2    │                 │   no stock, idempotent    │
  └────────────┬───────────────┘                 └───────────────────────────┘
               │
               ▼  "issue materials"  → one confirm
  ┌───────────────────────────────────────────────────────────┐
  │ start_production_order()  → confirm_bom_issue v4           │  ← EXISTING RPC
  │   locked per-(material,pool) check · consumption rows      │
  │   · WIP row · status = 'in_progress'                       │
  └────────────┬──────────────────────────────────────────────┘
               │
               ▼  quality: 28 passed, 2 failed → one confirm
               ▼  dispatch 28 → one confirm
  ┌────────────────────────────────────────────────────────────┐
  │ confirm_production_dispatch() → confirm_dispatch_transaction│ ← EXISTING RPC
  │   p_consumption_json = '[]'  (F3: already consumed)         │
  │   + close_wip()  + status = 'dispatched'                    │
  └────────────────────────────────────────────────────────────┘
               │
               ▼  19:00 IST, every day
        one Telegram message to the owner's own chat  (§8)
```

**Three properties fall out of that diagram and they are the design:**

- **The owner confirms four things per order, total** — create, issue, quality, dispatch — and
  three of them are the same confirmations they already make today on three separate pages.
- **The worker confirms nothing and types nothing.** A tap is a write (F5).
- **Stock moves exactly once**, through an RPC that already holds a `FOR UPDATE` lock across its
  own sufficiency check (F3).

### 1.2 Why this is a different product from the agent write layer

`nexflow-agent.md` makes the existing transactions faster. **Factory OS adds a transaction the
product does not have**, and it is the one the factory actually runs on.

Today, between a BOM issue and a dispatch, Nexflow is blind. `v_p2_wip_balance` knows that 30
units of material became "work in progress" and knows nothing else — not who is making them, not
how many are done, not whether they will be ready on Friday, not whether the two that came out
wrong were ever recorded. `kpml-network-plan.md` §8.3 built WIP specifically because that gap
*"manufactures theft accusations, automatically, every month, with the authority of software."*
WIP closed the accounting hole. It did not close the operational one.

The commercial consequence is larger than the feature. An inventory system is bought by the
person who keeps records. **A production system is bought by the person who runs the factory**,
and it is used every hour rather than at month end — which is what makes the subscription
defensible at three times the price and what makes the data good enough for everything
downstream (§13 is the honest limit on that claim).

### 1.3 What it costs

| | |
|---|---|
| Compute, per production order, end to end (create + assign + quality + dispatch proposals) | **≈ ₹2.50** (§14.2) |
| Compute, per progress entry | **₹0.00** — a tap has no model in it (F5) |
| Compute, daily owner report, per tenant | **₹0.38/day ≈ ₹10/month** |
| Compute, busy Factory OS tenant, all Factory OS traffic | **≈ ₹86/month on top of the agent layer's ₹1,000** |
| Build to production orders + workers + assignment + progress | **2 sessions** (§12) |
| Build to everything in this document | **6 sessions** |
| Founder hours per client per year, honest estimate | **6–10** `[UNVERIFIED — §17 Q5]` — **this, not compute, is the constraint** (§14.5) |

**The highest-volume interaction in this entire document is free**, because four hundred progress
taps a month are four hundred structured events and not one language problem. That inverts
`nexflow-agent.md` §9.5's conclusion — there, volume broke the "AI is never the cost" rule; here
the volume lands on the side of the system that has no model in it at all.

### 1.4 The non-negotiable properties

Two are inherited and outrank everything in this document:

1. **No ledger write executes without an explicit human confirmation of a specific,
   server-computed plan.** `nexflow-agent.md` §1.4. Factory OS adds no exception, no batching, no
   "auto-issue at 8am", no trust level. F2 explains why a production order does not need a
   confirm gate and what exactly that concession is limited to.
2. **No aggregate that spans owners ever reaches a principal.**
   `kpml-network-plan.md` §10.5. §9.6 is the single deliberate, bounded exception in this
   document and it is argued rather than assumed.

Two are new here:

3. **No worker's identity ever crosses a tenant boundary.** F10. KPML learns that an order is 28
   of 30 complete. They never learn who made them.
4. **Factory OS never computes pay.** F11, §16 item 3. This is a data-quality decision before it
   is an ethical one, and it is permanent.

---

## 2. Architecture Decisions

### F1 — Factory OS is new nouns on the existing write layer, not a new agent. `[DECIDED]`

Three new tools on `agent-query`'s existing `propose` action — `propose_production_order`,
`propose_work_assignment`, `propose_quality_check` — plus one optional field added to the
existing `propose_dispatch`, plus three new read intents. No new chat surface, no second
confirmation protocol, no second proposal store.

Everything in `nexflow-agent.md` §3 applies unchanged and is not restated: the model emits
names, never UUIDs (D4); the confirm request carries **only** `proposal_id` (D3); the confirm
path makes **zero** model calls (D2); proposals expire in 15 minutes (D9); role gating is
server-side per transaction type (D11); `p_force` is never set (§5.3).

The one thing that grows is `p2_agent_proposals.kind`'s CHECK constraint, which gains
`'production_order'`, `'work_assignment'` and `'quality_check'`. That is a `DROP CONSTRAINT` /
`ADD CONSTRAINT` pair in the Factory OS migration, and it is the entire integration surface.

**Why this and not a separate `factory-os` Edge Function.** The `suggest_hsn` precedent (Session
14) and `nexflow-agent.md` D1 both land on the same answer for the same reason: every action
here is single-tenant and caller-authenticated, so it inherits `verifyCallerTenant`, the
Anthropic client, `SB_SECRET_KEY` and `p2_agent_logs` for free. The counter-precedent —
`automation-strategy.md` §4.3's decision to give `ops-digest` its own file — applies only to
cross-tenant readers that message the founder. The one Factory OS component that *is* such a
reader, the daily report, correctly gets its own function (§8.6).

### F2 — A production order is a planning object. It moves nothing, so it does not need the confirm gate. `[DECIDED]`

This is the decision that lets a principal's PO create production orders at a vendor without
violating §1.4, and it needs stating precisely because it looks like a loophole.

**Creating a production order writes one row to `p2_production_orders` and nothing else.** No
stock transaction. No dispatch order. No challan number. No invoice. No WIP. It is a statement of
intent — the same class of object as a note on a whiteboard — and it is freely editable and
cancellable until the moment materials are issued.

The confirm gate exists to protect **the ledger**. `nexflow-agent.md` §1.4's own wording is "no
*write*", and every one of its fifteen `[NEVER]` items in §16 is about something that moves
stock, money or a statutory document. A planning row is none of those.

**Where the gate re-engages, exactly:**

| Action | Gate |
|---|---|
| Create a production order | Proposal + confirm when a human asked for it in words; **auto-created in `status='proposed'`** when a principal's PO delivered it (§9.2) |
| **Issue materials** (`start_production_order`) | **Full confirm gate. Always. No exception.** Stock leaves the store. |
| Record progress | No gate — a tap is a structured write (F5); no ledger row |
| Record a quality check | No gate for a tap; full gate for a sentence the model parsed |
| **Dispatch the output** | **Full confirm gate. Always.** A challan is a statutory document under Rule 55. |
| Cancel an order that already issued materials | **Full confirm gate**, and it does not reverse the stock (§3.7) |

The honest cost of this decision: a tenant can accumulate a hundred stale `proposed` orders that
nobody ever looked at. That is a tidiness problem, and §3.2 gives it an expiry.

### F3 — Consumption happens once, at issue. A dispatch carrying a `production_order_id` never re-expands the BOM. `[DECIDED]` — keystone decision

§0 C1 is the problem. This is the resolution, and everything in §3.4 and §3.5 depends on it.

```
  start_production_order()          confirm_production_dispatch()
  ───────────────────────           ────────────────────────────
  confirm_bom_issue v4              confirm_dispatch_transaction
    · locked per-(material,pool)      · p_consumption_json = '[]'
      sufficiency check                 → zero loops, zero stock rows
    · negative consumption rows       · status = 'confirmed'
    · WIP row (+qty)                + close_wip()  (−qty)
    · order → 'in_progress'         + order → 'dispatched'
```

**Why issue-time and not dispatch-time**, given the brief asks for the opposite:

1. **It is where the material physically moves.** Stock leaves the store when the worker collects
   it, days before anything is dispatched. A ledger that says otherwise disagrees with a physical
   count for the whole duration of the work — which is the exact complaint `reports.html`'s
   Physical Stock Count exists to settle.
2. **WIP already assumes it.** `kpml-network-plan.md` §8.3's balance identity is
   `issued = returned + scrap + raw material still held + WIP` — a statement that only holds if
   material is consumed at issue and the output has not yet returned. `confirm_bom_issue` v4
   writes the WIP row in the same transaction as the consumption rows `[VERIFIED]`. Moving
   consumption to dispatch would make `v_p2_wip_balance` meaningless.
3. **It is the only one of the two that can be pool-aware for a job worker.** `confirm_bom_issue`
   derives the pool from the order (`kpml-network-plan.md` §8.4's "derive, never ask"); a
   dispatch of finished goods to KPML under `job_work_return` has its own pool derivation for a
   different purpose. Consuming at dispatch would make one field do two jobs.

**The mechanism, and it is deliberately tiny:** one nullable column,
`p2_dispatch_orders.production_order_id uuid NULL REFERENCES p2_production_orders(id)`. When it
is NULL — every existing row, and every dispatch created any other way — behaviour is **byte
identical to today**. When it is non-null, the dispatch path skips BOM expansion entirely and
`confirm_dispatch_transaction` receives an empty consumption array, which its two loops iterate
zero times before flipping the header to `confirmed` `[VERIFIED — read against the live function
body in 20260901_fix_insufficient_stock_message.sql]`.

**Why a wrapper RPC rather than two calls from the Edge Function.** Closing WIP and confirming
the dispatch must be one transaction, or a network failure between them leaves a confirmed
challan with an open WIP balance that overstates the factory's work in progress forever.
`nexflow-agent.md` D6 already forbids the Edge-Function-does-check-then-write shape for exactly
this class of reason. §11.9 specifies `confirm_production_dispatch`.

**The trap a future session will hit:** `confirm_bom_issue` and `confirm_dispatch_transaction`
have **different security postures**. The first is plain `SECURITY INVOKER` relying on RLS; the
second is `SECURITY DEFINER` with an internal `auth.uid()`-based tenant check that is **skipped
entirely when `auth.uid()` is NULL** — which is always true for a service-role caller
`[VERIFIED]`. Both Factory OS wrappers must therefore be plain `SECURITY INVOKER`, take an
explicit `p_tenant_id`, and rely on the Edge Function's `verifyCallerTenant` as the real gate —
exactly the posture `confirm_bom_issue` already has. **Do not make a wrapper `SECURITY DEFINER`
"for safety".** It would run as `postgres`, bypass RLS on every table it touches, and silently
convert a tenant-isolation bug into a cross-tenant write.

### F4 — A worker is a person, not a user. `[DECIDED]`

New table `p2_workers`. Nullable `user_id` for the minority who also have a Nexflow login. §0 C2
is the reasoning; §4.1 is the model.

The corollary is the interesting part: **a worker with no login needs a way to see their work and
report progress, and it cannot be an app.** F5 and §4.3.

### F5 — A tap is a write. A sentence is a proposal. `[DECIDED]`

A worker tapping `+10` on a card that says "KS4 Motor — 15 assigned, 8 done" performs a direct,
structured write with **no model anywhere in its path**. It is not confirmed a second time.

This is not a weakening of §1.4 and the distinction is precise. The confirm gate exists because a
language model produced a proposal that might be wrong in ways the user cannot see. A button
labelled `+10` on a card naming one product and one quantity **is** the server-computed plan;
tapping it is the confirmation; there is nothing between the human's intent and the row.

Three further reasons this is safe here and would not be safe for a dispatch:

- **A progress row is not a ledger row.** It moves no stock, creates no document, touches no GST
  surface, and reaches no external party. `nexflow-agent.md` §14's entire error analysis is about
  errors that flow downstream into a statutory filing. This one does not.
- **Corrections are cheap and native.** `p2_production_progress` is append-only; a wrong `+10` is
  fixed by a `−10` row with a note, the same way `p2_stock_transactions` and
  `p2_wip_transactions` already handle every correction `[VERIFIED]`.
- **The alternative is worse.** A confirmation dialog on a phone held in a glove in a steel shed
  is a second tap that adds nothing, and the observable consequence of adding it is that people
  stop reporting — which destroys the data the rest of this document is built on.

**Where the bar rises again, in the same file:** a worker's *dictated sentence* (§5.3) is parsed
by Haiku and therefore produces a proposal that the worker confirms with one tap on the parsed
number. Model in the path → confirmation. No exceptions.

### F6 — Derive the pool, derive the rate, never ask on the floor. `[DECIDED]`

`kpml-network-plan.md` §8.4, applied unchanged: *"Never put a pool selector on the daily BOM
issue screen. Every place a human chooses between two physically identical piles under time
pressure is a place the wrong pile gets picked."*

For Factory OS the production order **is** the thing that knows:

| Field | Derived from | Never |
|---|---|---|
| `owned_by` (which pool the BOM issue consumes) | the order's `client_id` → `p2_clients.is_job_work_principal` → that client's id | asked at issue time |
| `movement_purpose` on the output dispatch | derived at **dispatch** time from `js/movement-purpose.js`, not stored on the order | stored days early and gone stale |
| Worker throughput | observed history (§4.6) | a typed estimate |
| Material quantities | `p2_product_bom` | a materials list the model passed |

**`movement_purpose` is deliberately not a column on `p2_production_orders`**, and this is worth
defending because it looks like an omission. It is the field that decides whether a challan can
legally be invoiced; getting it wrong is a GSTR-1 filing error (Session 6 P0 `[VERIFIED]`).
`js/movement-purpose.js` is the single definition consulted by every write path, and
`kpml-network-plan.md` §8.2 rule 3 names a second implementation of that mapping as a known,
recurring failure in this codebase. A purpose chosen when the order was created and read when the
order ships is a second source of truth separated by a week.

### F7 — Progress is an append-only ledger. Completion is derived, never stored. `[DECIDED]`

No `quantity_completed` column on `p2_production_orders`.
`SUM(p2_production_progress.quantity_done)`, through a view, exactly as `v_p2_stock_balance`,
`v_p2_wip_balance` and `v_p2_invoice_payment_status` all already work `[VERIFIED]`. `CLAUDE.md`'s
first key business rule is *"Stock balance = SUM of all `p2_stock_transactions` … never store
balance directly."*

The cost is one join on every read. The benefit is that a partial write, a double-tap, a
correction and a reassignment can never leave a stored total disagreeing with the rows beneath
it — and there is no reconciliation job to write, because there is nothing to reconcile.

### F8 — The quality gate defaults OFF. `[DECIDED]`

`p2_tenant_settings.quality_gate_enabled boolean NOT NULL DEFAULT false`.

When on, a production order's dispatch cannot exceed its passed units (§6.2). When off,
dispatchable = completed, and Factory OS treats quality records as optional notes.

**Default off, including for new tenants.** A factory that does not yet record quality checks
would otherwise find its first dispatch blocked by a feature it did not know existed, on the day
it went live. That is the same shape as every other switch in this schema — `is_job_worker`,
`separate_pool_deduction`, `agent_write_enabled` all default false and are turned on by the owner
after one screen explaining what they do `[VERIFIED]`.

**And there is no override flag.** With the gate on, the only way to dispatch an unchecked unit
is to record a quality check that passes it — which is one tap and is the audit trail. A
`p_force`-style bypass is forbidden by `nexflow-agent.md` §16 item 8 and the same reasoning
applies: a switch that lets a hurried supervisor skip the check is a switch that is always on.

### F9 — Estimates are read-only, and they quote the bad day. `[DECIDED]`

"Can you deliver 50 KS6 by Friday" produces an **answer**, not a proposal. No `proposal_id`, no
Confirm button, nothing to tap. It is a new read intent on `executeQuery()`, added to
`READ_ONLY_INTENTS` (which is the single source of truth, 28 intents today `[VERIFIED]`).

The computation quotes the **20th-percentile observed daily rate, not the mean** (§7.3). A
commitment made on an average is late half the time by construction, and a supplier who is late
half the time has a worse reputation than one who quotes two days longer and is never late.

### F10 — No worker identity crosses a tenant boundary. `[DECIDED]`

KPML sees: order, product, quantity ordered, quantity complete, projected date, quality counts on
their own material. KPML never sees: worker names, worker counts, who was slow, who rejected
what, or any per-worker metric in any form.

Three reasons, descending:

1. **It is not in scope.** `kpml-network-plan.md` §10.5's consent text enumerates what a principal
   may see and a vendor's staff is not in it. Adding a field not in the scope description is
   failure mode 6 — RPC drift — *"the one that actually happens."*
2. **It invites the principal to manage the vendor's staff**, which is the relationship the
   vendor is paying Nexflow to avoid.
3. **It would make the vendor's workers the principal's performance data**, and there is no
   consent anywhere in this product that covers that.

### F11 — Factory OS never computes pay. `[NEVER]`

No piece rate, no wage, no attendance, no payroll export, no per-worker earnings figure, and no
column a payroll system could join to. §16 item 3.

**This is a data-quality decision first.** The moment a worker's pay depends on the number they
tap, the number stops describing production and starts describing pay. Every under-report becomes
a dispute and every over-report becomes fraud, and the honest reporting this entire document
depends on evaporates in a week. The measurement becomes the target and stops being a
measurement.

It is also a liability decision. Wage computation in India carries statutory obligations —
minimum wages, overtime at double rate, records under the Payment of Wages Act — that Nexflow has
no business underwriting with a ₹35,000/month product, and `enterprise-strategy.md` §8 item 3
already refuses the smaller version of this (payroll, TDS) for the same reason.

### F12 — The daily report runs on the job queue from day one. `[DECIDED]`

Never a `for (const tenant of tenants)` loop. §0 C4, §8.6. `p2_job_queue` (A6) is a hard
prerequisite, and if A6 has not shipped when Factory OS starts, **build A6 first** — the same
instruction `bridge-agent.md` §15 gives about A0.

---

## 3. Production Orders

### 3.1 The shape

> **A production order is: make `quantity` of `product` by `due_date`, from `owned_by`'s
> material, for `client`.**

Everything else about it — who is making it, how far along it is, how many passed — lives in a
child table and is derived (F7).

`p2_production_orders` in full is §11.2. The columns that carry a decision:

| Column | Decision |
|---|---|
| `order_number` | `PO-YYMM-NNNN`, per-tenant counter, drawn at confirm. **Not a statutory document** — a gap in this series has no Rule 56(7) consequence, unlike a challan (§3.2) |
| `quantity_ordered` | `numeric(12,3)`. Not integer: a job worker measuring output in kg is a real case |
| `owned_by` | nullable FK → `p2_clients(id)`. NULL = own material. Derived (F6), never asked |
| `client_id` | nullable FK → `p2_clients(id)`. NULL = make-to-stock |
| `status` | `proposed → planned → in_progress → completed → dispatched`, plus `cancelled` |
| `bom_issue_dispatch_id` | nullable FK → `p2_dispatch_orders(id)`. The link that makes "were materials issued?" a query rather than an inference |
| `created_by` | **`auth.uid()`, and this is the first table in the schema to get it right.** `p2_dispatch_orders.created_by` holds `tenant_id`, not a user id — `CLAUDE.md` Known Open Items #9 `[VERIFIED]`. Every table created from here on writes the real user id |

**Two additions to the brief's state list, both justified.** The brief gives `planned →
in_progress → completed → dispatched`. `cancelled` is added because an abandoned order that
cannot leave `planned` distorts every capacity estimate in §7 forever. `proposed` is added
because it is what dissolves the tension between "a principal can push work" and "nothing is
created without a confirmation" — see F2 and §9.2.

**No `priority` column in v1.** `due_date` is the priority; a second ordering field that can
disagree with it is a second source of truth, and no client has asked. Add it when one does.

**No `quantity_completed` column.** F7.

### 3.2 State transitions — what triggers each, and what writes it

Every transition is written **inside the RPC that causes it**, in the same transaction. None is
written by a cron, a trigger, or the Edge Function after the fact.

| From → To | Trigger | Written by |
|---|---|---|
| — → `proposed` | A principal's PO line arrived (Session 28) and Factory OS turned it into an order nobody has accepted yet | `create_production_order(p_source := 'principal_po')` |
| — → `planned` | A human asked for it in words and confirmed the proposal | `create_production_order` |
| `proposed` → `planned` | Owner or supervisor accepts it (one tap, no model) | `accept_production_order` |
| `planned` → `in_progress` | **whichever happens first**: materials issued, or the first progress entry lands | `start_production_order` **or** `record_production_progress` |
| `in_progress` → `completed` | `SUM(quantity_done) >= quantity_ordered` after the row that crossed the line | `record_production_progress` |
| `completed` → `dispatched` | cumulative dispatched quantity leaves nothing dispatchable (§6.2) | `confirm_production_dispatch` |
| any → `cancelled` | Owner or supervisor, through a confirmed proposal | `cancel_production_order` |

**Why `in_progress` has two triggers.** Materials are often already on the floor — a worker
starts on stock issued last week for a different batch, or the store issued informally and the
paperwork follows. Refusing to accept progress on a `planned` order would either block a real
report or force a fake BOM issue, and both are worse than a status two different events can set.

**`completed` is about production, not quality.** An order with 30 made and 2 rejected is
`completed` at 30. Whether 28 or 30 can be dispatched is §6.2's question, and conflating them
would mean a rejection silently reopens a closed order.

**`proposed` orders expire.** A `proposed` order untouched for 30 days goes `cancelled` with
`cancel_reason = 'expired — never accepted'`, swept by the same drain that runs the daily report.
Without this, a principal who pushes POs weekly accumulates a permanent backlog of intentions
that distorts every capacity estimate in §7.

### 3.3 Where a production order comes from

**Three sources, one column (`source`), and the difference matters for capacity maths.**

**1. `manual` — the owner or supervisor says so.**

```
User:  Make 30 KS4 motors for KPML by Friday

Agent: Production order — 30 × KS4 Motor (KS4-4P)
       For: Kirloskar Pneumatic Co Ltd · Due: Fri 18 Sept 2026
       Material: KPML's pool (job work)

       Materials needed when you issue:
         • Stator Stack KS4        30 nos    have 210 (KPML)
         • Bearing 6205 ZZ         60 nos    have 480 (KPML)
         • Capacitor 4uF           30 nos    have  95 (KPML)
         • Copper Wire 0.90/1.20MM 7.5 kg    have 62.4 kg (KPML)
       Stock is sufficient. Nothing is issued yet.

       Your observed rate on KS4: 12/day. 30 units ≈ 3 working days.
       You have 18 KS4 already open, due Tuesday.

       [ Create order ]   [ Cancel ]
```

Three things in that card that are not decoration. **The stock check runs at creation even though
nothing is issued** — an order that cannot be started is worth knowing about on the day it is
taken, not on the day it is due. **The existing open load is stated** — otherwise the owner
commits to Friday twice. **"Nothing is issued yet" is explicit**, because the single most likely
misreading of this card is that the material has moved.

**2. `principal_po` — Session 28 delivered a PO line.** §9.2. Lands in `proposed`.

**3. `recurring` — reserved, not built.** A standing weekly order is an obvious request and it is
not in v1. The column value exists so the CHECK constraint does not need widening later; nothing
writes it. Say no until a named client asks (`kpml-network-plan.md` §9 Step 7's rule).

### 3.4 The link to BOM issue — `start_production_order`

**One BOM issue per production order in v1.** `[DECIDED]`

```
User:  Issue material for PO-2609-0042

Agent: Issue for PO-2609-0042 — 30 × KS4 Motor, KPML pool
         • Stator Stack KS4        30 nos     have 210
         • Bearing 6205 ZZ         60 nos     have 480
         • Capacitor 4uF           30 nos     have  95
         • Copper Wire 0.90/1.20MM 7.5 kg     have 62.4 kg
       This removes them from KPML's pool now.
       Issue number is drawn when you confirm.

       [ Confirm issue ]   [ Cancel ]
```

On confirm, `start_production_order` does, in one transaction:

1. Draw the issue challan number **once**, store it on the proposal row, reuse it on retry —
   `nexflow-agent.md` §5.3, closing Known Open Items #15 by construction rather than inheriting
   it (`production-issue.html` is one of the two pages where burning a number on a failed confirm
   is still open `[VERIFIED]`).
2. Call `confirm_bom_issue` v4 with all eleven parameters: `p_force := false` **always**,
   `p_product_id := <the order's product>` **always** (so the WIP row is written and
   `v_p2_wip_balance` agrees with the form path), `p_owned_by := <the order's pool>`,
   `p_issue_date := todayIST()`.
3. Write `bom_issue_dispatch_id` and flip `status` to `in_progress` on the order row.

**Partial issues are not supported in v1 and the refusal is explicit**, not silent: *"PO-2609-0042
already has materials issued. Issuing again would consume a second full set — record a stock
adjustment if material was genuinely taken twice."* A factory that issues half a batch on Monday
and half on Thursday is a real pattern and it is a second session's work: it needs
`quantity_issued` tracking, a many-to-one link, and a rule for what a partial issue does to the
WIP balance. Guessing at it now would write the wrong schema.

**The duplicate guard is already there and will fire.** `confirm_bom_issue` raises
`DUPLICATE_ISSUE` when the same product and batch quantity were issued on the same date, unless
`p_force` is true `[VERIFIED]`. Factory OS never sets `p_force`, so a genuine second batch of 30
KS4 on the same day is **blocked**. This is real, inherited friction: the correct answer is one
production order per batch with distinct quantities or dates, and if a client hits it repeatedly
the fix is a `p_production_order_id` parameter on a `confirm_bom_issue` v5 that scopes the
duplicate check to the order. `[UNVERIFIED — §17 Q3]` Do not work around it by setting `p_force`.

### 3.5 The link to dispatch — `confirm_production_dispatch`

F3 is the rule. The mechanics:

1. Compute `dispatchable` = (passed units if the quality gate is on, else completed units) minus
   already-dispatched units on this order.
2. Refuse, with the numbers, if the request exceeds it (§6.2).
3. Derive `movement_purpose` at this moment from `js/movement-purpose.js` and the client (F6),
   and for a job worker **ask if the sentence did not make it clear** — never default
   (`nexflow-agent.md` §5.1 step 3).
4. Insert `p2_dispatch_orders` as `draft` with `production_order_id` set, then
   `p2_dispatch_items`, then the RPC — reproducing `dispatch.html`'s ordering exactly so a
   failure between the insert and the RPC leaves a visible incomplete draft rather than a
   confirmed challan with nothing deducted `[VERIFIED]`.
5. `confirm_production_dispatch` calls `confirm_dispatch_transaction` with
   `p_consumption_json := '[]'`, calls `close_wip` for the dispatched quantity, and flips the
   order to `dispatched` when nothing remains — all in one transaction.

**Partial dispatch is supported.** 30 made, 28 passed, 20 shipped today and 8 on Friday is two
dispatches against one order, and the order stays `completed` until the second one clears.

**`close_wip` will raise `WIP_EXCEEDS_BALANCE` if the WIP balance is short** `[VERIFIED]`. That
happens when someone closed WIP by hand on `production-issue.html`'s WIP panel for the same
batch. The message must say so in those words rather than surfacing the raw exception — it is the
one failure in this flow a user can actually cause and fix.

**One inherited defect to be aware of, because it lands in §8's report.**
`confirm_dispatch_transaction` writes its consumption rows with `transaction_date = NOW()` — raw
UTC, not IST `[VERIFIED]`. `confirm_bom_issue` takes the date from its caller and is correct.
A dispatch confirmed between 00:00 and 05:30 IST therefore dates its consumption rows to the
previous day, while everything Factory OS writes uses `todayIST()`. The two disagree by one day
at that boundary. It is the same class `CLAUDE.md` documents at five fixed call sites; fixing it
is a one-line change to that RPC and it is **not** in Factory OS's scope, but §8.2's "dispatches
today" count must be computed from `p2_dispatch_orders.dispatch_date`, never from the consumption
rows, or the 7pm report will occasionally miscount a late-night dispatch.

### 3.6 The link to a principal's PO

§9.2. The column pair is `source_po_number text` and `source_po_line text`, both nullable, both
plain text, **neither an FK**. Session 28's PO Push table does not exist; a uuid column pointing
at nothing is a dangling reference a future session will mistake for a real relationship. When
Session 28 lands, it may add its own FK — that is a one-line `ALTER` against a table that by then
has real rows to validate against.

### 3.7 Edge cases

| Case | Behaviour |
|---|---|
| Product has no BOM | Order can be **created** (it is a plan). `start_production_order` **refuses**: *"KS4 Motor has no recipe saved, so I can't work out what to issue."* Never issue nothing and report success |
| Product has a partial BOM | Issue proceeds with the explicit card line *"Only 3 materials are on this recipe. Anything else used won't be deducted"* — `nexflow-agent.md` §5.3's rule, unchanged |
| Insufficient stock at creation | Order is still created, with an amber line naming the short material and the number. A plan you cannot start yet is a legitimate plan; a silent one is not |
| Insufficient stock at issue | **No proposal.** `confirm_bom_issue`'s locked check is authoritative; the pre-check exists only to produce a better message earlier |
| Cancel an order after materials were issued | Allowed, owner/supervisor only, and it **does not reverse the stock** — the material is physically gone. The card says so: *"The material issued on 14 Sept stays consumed. If it came back to the store, record a stock adjustment."* Silently reversing would credit stock that is sitting on a bench |
| Two orders for the same product, same day | Allowed. `confirm_bom_issue`'s `DUPLICATE_ISSUE` guard may block the second issue — §3.4 |
| Order quantity changed after issue | **Refused.** Amend by cancelling and creating a new order, or by recording actual production against the original. An order whose quantity moves after its material was consumed makes every variance figure meaningless |
| Due date in the past | Allowed, with a visible note. Backdating an order that was already made is a legitimate onboarding action |
| Product deactivated mid-order | `p2_products` has **no `is_active` column** `[VERIFIED]` — nothing to check. Deleting a product orphans BOM foreign keys and is already forbidden `[VERIFIED]` |

---

## 4. Workers and Assignment

### 4.1 What a worker is

`p2_workers` is a master of **people who do physical work**. It is not a master of software users
and it is not an extension of `p2_user_roles`. §0 C2 is the reasoning; the schema is §11.1.

| Column | Why it exists |
|---|---|
| `name` | The name the supervisor actually says. "Ramesh", not `ramesh.k@gmail.com` |
| `phone` | For sending the work link once. Optional — many workers have a shared family phone or none |
| `worker_code` | Optional. Factories with badge numbers already have an identifier and will use it |
| `user_id` | **Nullable** FK → `auth.users(id)`. Set only for a worker who is also a Nexflow user (an `operator`). Most rows are NULL |
| `access_token` | The per-worker link token. §4.4 |
| `hours_per_day` | Owner-set. Capacity input (§7), and the owner sets it because shift hours are a management decision (§10 item 2) |
| `is_active` | Never delete. Historical assignments and progress rows reference workers who have left |

**A worker with no phone is the majority case in year one**, and the design must not degrade for
them. The supervisor or owner records their progress on their behalf, `entry_source =
'supervisor'`, from the ordinary agent chat or the production screen. Everything else in this
section — the token, the page, the taps — is an upgrade, not a requirement.

**Personal data, kept minimal on purpose.** Name and phone, nothing else. No ID number, no
address, no date of birth, no photograph. The less there is, the less a leaked token is worth
(§4.4) and the less there is to explain to a client's CA.

### 4.2 The assignment model

`p2_production_assignments` — one row per (order, worker, slice of work). §11.3.

**Why a table and not `assigned_worker_id` on the order.** The brief's own example splits 30
motors across two workers, which a column cannot express. It also cannot express reassignment
(Worker B is off sick, move their 15 to Worker C) without destroying the history that §4.6's
capacity estimate is computed from.

Three rules the RPC enforces, none of which a CHECK constraint can:

1. **Assigned quantity across active slices may not exceed the order quantity.** Cross-row, so it
   is a `FOR UPDATE`-locked check inside `assign_production_work`, in the same shape
   `confirm_bom_issue` uses for stock `[VERIFIED]`. Over-assignment is not a rounding problem: it
   is two workers each believing they own the same ten units.
2. **One active slice per (order, worker).** A partial unique index does this in the database:
   `UNIQUE (production_order_id, worker_id) WHERE status = 'active'`. A second slice for the same
   worker is an amendment to the first, not a new row.
3. **Reassignment never deletes.** The old slice goes `status='reassigned'`, keeps whatever
   progress was logged against it, and a new slice carries the remainder. Progress already
   reported stays attributed to the person who did the work — which is the only version that is
   both fair and useful for §4.6.

**Under-assignment is allowed and is normal.** An order for 30 with 15 assigned means 15 are
unassigned; the daily report says so. Refusing to save an incomplete assignment would force the
supervisor to invent a second worker.

### 4.3 The worker's phone — `work.html`

**The constraint is the whole design: a ₹8,000 Android, no training, no login, one hand, possibly
in a glove, possibly in a shed with one bar of signal.**

`work.html?token=<uuid>` — a public page at the root, no navbar, no auth, served by a new
`work-view` Edge Function (`verify_jwt = false`, service role via `SB_SECRET_KEY`, UUID regex
guard before any DB query). This is exactly the `receive.html` / `invoice.html` shape that is
already live and already used by storekeepers `[VERIFIED]`, including the same three states:
valid token → the work list; missing token → "Invalid link"; unknown or revoked → "This link is
not valid any more".

What one card looks like, and every element is load-bearing:

```
   ┌──────────────────────────────────────┐
   │  रमेश                                 │
   │                                      │
   │  KS4 Motor          KS4-4P           │   ← product name AND code: the code is
   │  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━     │     what is printed on the bin
   │                                      │
   │       8 / 15                          │   ← digits, large. The only number that
   │       गुरुवार पर्यंत                    │     matters, and it needs no reading
   │                                      │
   │   ┌──────┐ ┌──────┐ ┌──────┐         │
   │   │  +1  │ │  +5  │ │ +10  │         │   ← one tap = one write (F5)
   │   └──────┘ └──────┘ └──────┘         │
   │                                      │
   │   ┌────────────────┐  ┌───────────┐  │
   │   │  सर्व पूर्ण ✓   │  │  अडचण ⚠   │  │   ← "all done" · "problem"
   │   └────────────────┘  └───────────┘  │
   └──────────────────────────────────────┘
```

**Design rules, all `[DECIDED]`:**

- **Numbers and icons first, words second.** The largest element on the card is `8 / 15`. A
  worker who cannot read either language still understands the card, and that is not a
  hypothetical in this market.
- **No free text anywhere on the happy path.** The only text input on the page is behind the
  `अडचण` (problem) button, and even that offers four pre-set reasons as buttons first: *material
  finished · machine stopped · part not fitting · something else*. "Something else" opens the
  keyboard.
- **No quantity field.** `+1 / +5 / +10` covers the reporting granularity a factory actually
  uses. A worker who made 7 taps `+5` then `+1` twice, which is three taps and zero typing.
  Long-press on a button is **not** a feature — it is undiscoverable on this device class.
- **`सर्व पूर्ण` posts the remainder in one row**, not a loop of `+1`s.
- **The page shows only that worker's active assignments.** No stock, no prices, no clients, no
  other workers, no material list, no totals for the factory. §4.4.
- **Marathi is the default on this page**, not English with a toggle. It is the one surface in
  the product whose user is least likely to read English, and it ships behind
  `tutorial-engine.md` §8.5's read-aloud gate with a real worker — not machine-translated.
  `[UNVERIFIED — §17 Q2]`

**Offline and bad signal.** Every tap is written to `localStorage` first and POSTed second, with
a retry queue drained on reconnect. The card updates from local state immediately — a worker who
taps and sees nothing happen taps again, which is exactly the double-count §5.4 prevents. This is
the same "assume the phone is bad" posture `reports.html`'s Physical Stock Count already takes
with its debounced `localStorage` autosave `[VERIFIED]`.

**The same page works for a worker who has a login.** When `p2_workers.user_id` is set, the app
links to `work.html` with no token and the Edge Function resolves the worker from the session
JWT. One page, two entry paths, no second implementation.

### 4.4 The token, and why it is not `stock-share.html`

`stock-share.html` was **cut permanently** from this product for a specific sin: *"a non-expiring,
non-revocable tenant-level token publishing a factory's whole stock position, showing the vendor's
own business to their largest customer"* `[VERIFIED — kpml-network-plan.md §7]`. A long-lived
worker token is close enough to that decision that it has to be argued, not assumed.

**Four differences, and all four are structural rather than promises:**

| | `stock-share.html` (cut) | Worker token |
|---|---|---|
| Scope | The **tenant's** entire stock position | **One worker's** active assignments |
| What it reveals | Materials, quantities, valuations — the business | "Ramesh is making 15 KS4 by Thursday" |
| Revocable | No | **Yes, one click**, and rotation is mandatory when a worker leaves |
| Writes | — | **Append-only, to one table, for its own assignments only.** No update, no delete, no other table, no other worker |

**The precedent this actually follows** is `receive.html` and `invoice.html` — per-document
public tokens, which `kpml-network-plan.md` §17 explicitly endorses in the same breath that it
forbids tenant-level ones. A worker token is per-*person* rather than per-document, which is a
genuine widening, and the mitigations above are the price of it.

**What is honestly still true:** the token lives in a URL, the URL lives in a WhatsApp thread, and
a forwarded message is a real leak of that worker's queue. The exposure is one person's work
list. Rotating on departure is therefore not optional and belongs in the client agreement, not in
a support article. `token_rotated_at` exists so the owner can see when it was last done.

**Rate limiting is required, not optional.** The endpoint is unauthenticated by construction:
cap at 60 requests/minute per token, and treat a token making thousands of requests as a signal
worth an `opsAlert` at `monitor` severity.

### 4.5 What the agent proposes when assigning

```
User:  Split PO-2609-0042 between Ramesh and Sunil

Agent: PO-2609-0042 — 30 × KS4 Motor, due Fri 18 Sept

         Ramesh   15    → finishes Wed 16 Sept  (rate 12/day, 1 order ahead)
         Sunil    15    → finishes Thu 17 Sept  (rate 9/day, nothing ahead)

       Both finish before Friday.
       [ Confirm assignment ]   [ Change ]
```

Four properties:

- **The split is proposed, not asked for.** The user said "split between Ramesh and Sunil"; the
  agent worked out the quantities from observed rates and existing load. Asking "how many each?"
  would put the supervisor's arithmetic back into the flow, which is the job being replaced.
- **Each worker's projected finish date is shown, computed from their own history** (§4.6) — not
  a shared average, because the whole point of naming two workers is that they are different.
- **An even split is not the default.** The default is the split that makes both finish on the
  same day, because that is what a supervisor actually wants. When history is thin it falls back
  to even, and says so: *"No rate history for Sunil — split evenly."*
- **It refuses to be clever about who.** If the user does not name workers, the agent asks. It
  does **not** pick workers by availability — that is a management decision about people (§10
  item 1), and an agent that assigns work to a person nobody named will be wrong about something
  it cannot see, such as who is on leave.

On confirm: the assignment rows are written, and each worker with a `phone` gets their link.
**Delivery in v1 is a one-tap share from the owner's own phone**, using the Web Share API with a
`wa.me` fallback — the identical mechanism `challan.html`'s WhatsApp share already uses
`[VERIFIED]`. The WhatsApp Business API is blocked on incorporation
(`automation-strategy.md` §5) and is not a dependency of this feature; when it arrives, the
delivery step changes and nothing else does.

### 4.6 How the agent knows what a worker can do

**Observed history, never a typed estimate, and never a hardcoded table.** This is
`nexflow-agent.md` §6.5's rule — *"the tenant's own history supplies the norm"* — applied to
people instead of quantities.

```sql
-- Units per working day for one (worker, product), trailing 90 days.
-- A "working day" is a day this worker logged any progress at all — which
-- self-calibrates around Sundays, festivals and leave with no holiday calendar.
SELECT worker_id,
       po.product_id,
       SUM(pp.quantity_done)                                        AS units,
       COUNT(DISTINCT pp.progress_date)                             AS days,
       SUM(pp.quantity_done) / NULLIF(COUNT(DISTINCT pp.progress_date), 0) AS rate
  FROM p2_production_progress pp
  JOIN p2_production_orders   po ON po.id = pp.production_order_id
 WHERE pp.tenant_id     = :tenant
   AND pp.progress_date >= CURRENT_DATE - 90
   AND pp.quantity_done > 0
 GROUP BY 1, 2;
```

**The cold-start problem is real and is answered honestly.** A tenant on day one has no history
at all. Three fallbacks, in order, and the fourth option is to refuse:

1. **Per-(worker, product) observed rate** — needs ≥ 5 working days for that pair.
2. **Per-product observed rate across all workers** — needs ≥ 10 working days.
3. **`p2_products.standard_output_per_day`** — a nullable, owner-set column (§11.7). One number
   per product that a factory owner can answer in ten seconds, and the only place in this
   document where a human estimate is accepted.
4. **Nothing.** The agent says so: *"I don't have enough history on KS6 to estimate a date. Once
   a few days of production are recorded I can."* It does **not** invent a rate, and it does not
   average across products — a motor and a pump share nothing.

**`hours_per_day` is not used to scale the rate.** The observed rate already includes however
many hours that worker actually works; multiplying it by a configured shift length would
double-count. It is used only for the overtime *scenario* in §7.4, which is explicitly a
hypothetical the owner approves (§10 item 3).

### 4.7 Edge cases

| Case | Behaviour |
|---|---|
| Worker not in `p2_workers` | Refused, named, routed: *"I don't have a worker called Sunil. Add them in Settings → Workers."* The agent **never creates masters** — `nexflow-agent.md` §11 item 3, unchanged |
| Two workers with the same first name | The match returns both and asks, with the worker code or phone last-four as the discriminator. Never guesses |
| Assigning more than the order quantity | Refused with the numbers: *"PO-2609-0042 is 30 units and 25 are already assigned. Sunil can take 5."* |
| Assigning to an inactive worker | Refused. Reactivate first — a departed worker with a live assignment is how a token that should have been rotated stays useful |
| Worker leaves mid-order | `is_active = false` **and rotate the token**, both in one action in Settings. Open slices go `reassigned`; logged progress stays attributed to them |
| A worker reports against an order they were never assigned | Accepted, `assignment_id` NULL, `worker_id` set. The floor does not always match the plan, and a rejected report is a lost fact |
| Worker opens the link on two phones | Both work. `client_event_id` makes the same tap idempotent across devices (§5.4) |

---

## 5. Progress Tracking

### 5.1 The ledger

`p2_production_progress` is append-only, in the same idiom as `p2_stock_transactions` and
`p2_wip_transactions`: positive rows add, negative rows correct, nothing is ever updated or
deleted, and the balance is a `SUM` (F7). §11.4 is the schema.

The three columns that carry a decision:

| Column | Decision |
|---|---|
| `quantity_done` | `CHECK (quantity_done <> 0)`. Negative is legal and is how a correction is made. **The worker page can only ever send positive** — negatives require owner or supervisor role and a `note` |
| `progress_date` | The **IST** date the work happened, from `todayIST()`. Separate from `reported_at` because a worker taps at 7pm for the day's work and a night-shift worker taps at 1am for yesterday's |
| `client_event_id` | The idempotency key. §5.4 |

**`progress_date` must come from `todayIST()` and never from `new Date().toISOString()`.**
`CLAUDE.md` documents that exact off-by-one at five fixed call sites, and the correct helper is
`new Date().toLocaleString('en-CA', {timeZone:'Asia/Kolkata'}).split(',')[0]` `[VERIFIED —
Session 7]`. A night-shift factory reporting at 00:30 IST would otherwise file every entry under
the previous day, and §5.6's delay detection would read it as a day of zero output.

### 5.2 One tap

`POST work-view { action: 'log_progress', token, assignment_id, quantity, client_event_id }`.

The Edge Function resolves the token to a worker, asserts the assignment belongs to that worker
and is `active`, and calls `record_production_progress`. No model, no proposal, no confirmation
(F5). The response is the new running total, which the card renders immediately.

**What it also does, in the same transaction:** flips the order to `in_progress` if it was
`planned`, and to `completed` if this row crossed the ordered quantity (§3.2). A status that is
maintained by a separate job is a status that is wrong between jobs.

**What it deliberately does not do:** touch stock, create a document, notify anyone, or call
anything downstream. A progress row is a fact about the floor, not an event with consequences.
The consequences are computed when someone asks (§7) or at 7pm (§8).

### 5.3 Dictation, not voice

§0 C3. The worker taps the microphone on their own keyboard and Gboard writes text into the box.
From Nexflow's side it is a typed sentence and goes through the ordinary propose path:

```
Worker types (by dictation):  दहा मोटर झाल्या

Agent:  10 KS4 Motor?
        [ हो ]   [ नाही ]
```

**One tap to confirm, because a model parsed it** (F5). The number is displayed as digits, which
is the entire safety mechanism: a worker who said "दहा" and sees `10` has verified the
transcription without being asked to.

**Cost:** ~800 input tokens, ~40 output on Haiku ≈ **₹0.09** per dictated entry. Negligible, and
it only occurs for the minority of entries that are not a button.

**Ship gate.** This inherits `nexflow-agent.md` §17 Q8's gate unchanged — it is not a separate
decision. Until twenty real Marathi dictations recorded on a factory floor score above 98% on
**numeric** accuracy, the dictation box is not shown and the buttons are the only path.
`[UNVERIFIED — §17 Q2]`

### 5.4 Double-tap, retry, and the offline queue

The failure this must survive: a worker taps `+10`, the request is slow, they tap again, and the
order shows 20.

**`client_event_id uuid NOT NULL`, generated by the page per tap, with
`UNIQUE (tenant_id, client_event_id)`.** A second POST carrying the same id writes nothing and
returns the first row's result. This is the same idempotency discipline
`nexflow-agent.md` §4.5 rule 7 applies to a confirm and `bridge-agent.md` §8.2 applies to a
voucher, at a much smaller scale.

It also makes the offline queue safe: a tap recorded in `localStorage` and replayed after
reconnection carries the id it was created with, so replaying a queue that partially succeeded is
free of consequence. **The id is generated at tap time, never at send time** — generating it when
the request is built defeats the entire mechanism.

**A legitimate repeat is still possible**: a worker really does complete another 10 an hour later.
That is a different tap, a different id, and it writes. The guard is against the same event twice,
not the same quantity twice.

### 5.5 Aggregation

`v_p2_production_order_status` (§11.6) is the single read surface for "how is this order going".
`security_invoker = true` **plus an explicit `WHERE tenant_id = get_my_tenant_id()`** — both, not
either. Session 1 found that `security_invoker` alone was insufficient on
`v_p2_supplier_advance_balance` because RLS on the underlying table did not fire correctly inside
the view context `[VERIFIED]`, and every view written since carries the explicit filter.

It returns, per order: ordered, done, remaining, passed, failed, dispatched, dispatchable,
assigned, unassigned, first and last progress date, distinct worker count, and the projected
completion date from §5.6.

### 5.6 Delay detection — the exact computation

**Projection, not a percentage.** "70% of the time has passed and only 50% is done" is a ratio
that fires constantly on orders that were always going to finish in a burst. The question that
matters is: *at the rate this order is actually moving, will it be finished by its due date?*

```
observed_rate   = SUM(quantity_done) / COUNT(DISTINCT progress_date)     -- this order only
remaining       = quantity_ordered - SUM(quantity_done)
days_needed     = CEIL(remaining / observed_rate)
projected_date  = today + days_needed working days
                  -- working days derived from the tenant's own observed activity
                  -- pattern over 90 days; falls back to 6/week when unknown

behind  ⟺  projected_date > due_date
```

Four cases the formula has to handle, and all four have a defined answer:

| Case | Answer |
|---|---|
| No progress at all, and the order was started ≥ 1 working day ago | **Behind.** "Not started" is the loudest kind of late and the formula must not divide by zero into silence |
| No progress, started today | Not behind. Nothing is wrong yet |
| `observed_rate` is high but the order is one big final report | Not behind. The projection uses what is observed, which is the point |
| Order has no `due_date` | Impossible — `due_date` is `NOT NULL` (§11.2). A production order without a date is a wish, not a plan |

**The working-day pattern is derived, never configured.** Counting distinct dates with any
progress over the trailing 90 days self-calibrates around Sundays, Diwali and a week the factory
was shut, with no holiday calendar to maintain and no per-tenant configuration to get wrong. The
honest limitation: a factory's *first* 90 days have a thin pattern, so the fallback of 6 days a
week applies and a Diwali week will produce a false "behind" flag. §13 owns that.

### 5.7 What triggers an alert, and what does not

| Event | Where it surfaces | Rate limit |
|---|---|---|
| An order crosses from on-track to projected-late **for the first time** | In-app notification + Telegram, to the owner | Once per order, ever. Not once per day |
| An order is still late the next day | **The 7pm report only.** No push | — |
| A worker reports zero for 2 consecutive working days on an active slice | The 7pm report | — |
| A worker taps `अडचण` (problem) | **Immediate** in-app + Telegram to the owner — this is a human asking for help | Once per assignment per 4 hours |
| An order completes | The 7pm report | — |

**The first row is the only push a delay ever generates, and that is deliberate.** An alert that
repeats every day for a week is a muted channel, which is `automation-strategy.md` §3.1's stated
failure mode for the founder channel and is exactly as true for an owner. The daily report is
where standing problems live; push is for transitions.

---

## 6. Quality

### 6.1 The record

`p2_quality_records` — pass/fail counts against a production order, with a free-text defect note.
§11.5.

**Deliberately not built:** a defect taxonomy table, a severity scale, a rework order workflow, a
CAPA record, an inspection plan, an AQL sampling rule, or anything a QMS auditor would recognise.
The brief is explicit that this is internal workflow only and §16 item 6 makes it permanent.
`enterprise-strategy.md` §8's discipline applies: the value here is a number the owner sees on a
Tuesday, not a certification.

| Column | Decision |
|---|---|
| `units_passed` / `units_failed` | Both `>= 0`, `CHECK (units_passed + units_failed > 0)`. A record of nothing is not a record |
| `defect_note` | **Required when `units_failed > 0`**, enforced by CHECK. A rejection with no reason is a number nobody can act on, and the note is the only thing the owner reads in §8's ⚠ line |
| `worker_id` | Nullable FK. Who made the units. Nullable because a mixed batch genuinely has no single author, and a forced attribution would be a guess that then appears in a rejection rate |
| `disposition` | `rework` (default) · `scrap` · `accepted_with_deviation`. Three values, because what happens to a failed unit changes what the stock ledger should eventually say |
| `checked_by` | `auth.uid()`, `NOT NULL`. **A worker cannot pass their own work** (§6.5) |
| `checked_date` | IST, `todayIST()`. Same trap as §5.1 |

**`disposition = 'scrap'` records a fact and does not create a ledger row**, and the gap is
stated rather than hidden. Scrap from a principal's material is the principal's, with a s.143(5)
tax event and an owner (`kpml-network-plan.md` §10.1) — it leaves the factory on a `scrap_return`
challan, which is an existing, confirmed dispatch with its own gate. Factory OS records that 2
units were scrapped; converting that into a `scrap_return` is a separate, human-confirmed
dispatch. Wiring the two together automatically would create a statutory document from a quality
tap, which F2's table forbids.

### 6.2 How quality gates dispatch

With `quality_gate_enabled = true` (F8):

```
dispatchable = SUM(units_passed) − already_dispatched_on_this_order
```

The dispatch proposal refuses to exceed it, with the numbers:

```
Agent:  PO-2609-0042 has 30 made, 28 passed, 2 rejected (winding loose).
        You asked to dispatch 30. I can dispatch 28.
        The 2 rejected units need a quality check that passes them,
        or they stay here.

        [ Dispatch 28 ]   [ Cancel ]
```

**A hard block with no override**, and the escape hatch is the honest one: record a quality check
that passes the units. That is one tap, it takes a second, and it leaves a row saying a named
person passed them on a date — which is precisely what a dispute with KPML six weeks later needs
(§10 item 4). An override flag would leave nothing.

With the gate off, `dispatchable = completed − dispatched` and quality records are advisory only.

### 6.3 Trends, and the ⚠ threshold

Two deterministic signals, both computed in SQL, neither involving a model:

**Per worker.** `units_failed >= 3` for the same worker within a rolling 7 days, across any
orders and any defect. Fires once per worker per 7 days.

**Per product.** A product's 30-day rejection rate above **2× its own trailing 90-day rate**, with
a floor of at least 10 units checked in the 30-day window. Self-referential, like the quantity
and rate sanity checks in `nexflow-agent.md` §6.5 — never a hardcoded percentage, which would be
wrong for the next industry.

**On "same defect type", which the brief asks for and which needs an honest answer.** `defect_note`
is free text by design (§6.4). Exact-string matching catches "winding loose" typed identically
twice and misses "loose winding" — so a threshold built on it would be silently unreliable, which
is worse than a cruder threshold that is always right.

`[DECIDED]` **The threshold fires on count alone. The report quotes the notes verbatim and the
owner does the matching.** Three rejections by one worker in a week is worth a look regardless of
whether the notes say the same thing, and three verbatim notes side by side answer "is this the
same problem?" better than any string comparison.

`[RECOMMENDED]` **Haiku may write the sentence, never the flag.** When the daily report's ⚠ line
fires, the ≤ 5 defect notes behind it go into the report prompt and the model may summarise them
as *"all three look like the same winding problem"*. That is `automation-strategy.md` §2's rule
R1 exactly — deterministic code computes, the model judges — and it is the only judgment call in
this document that a model is allowed to make.

### 6.4 What counts as a defect

**Whatever the factory says.** Free text, no dropdown, no taxonomy, no normalisation at write
time.

The reasoning is the same one that keeps `p2_raw_materials.name` free text: a fixed vocabulary
authored by a software vendor in advance is a vocabulary that does not contain the thing that
actually went wrong, and the observable consequence is that everybody picks "Other" and types the
real reason in a note — at which point the taxonomy has cost effort and delivered a column of
"Other".

If a tenant's notes turn out to cluster cleanly after six months of real data, that clustering is
computable from the notes. The reverse — recovering the real reason from a dropdown — is not.

### 6.5 What quality is not

- **Not a worker's self-assessment.** `checked_by` is an `auth.users` id, so the checker is
  someone with a login — owner or supervisor. The worker page has no quality button and will not
  get one.
- **Not an inbound inspection.** Rejecting a *supplier's* delivery at the gate is a different
  event against a GRN, and it is Session 29 (`kpml-network-plan.md` §9 Step 7 item 3, gated on a
  named request). Do not quietly extend `p2_quality_records` to cover it — the counterparty, the
  document and the remedy are all different.
- **Not a rework tracker.** `disposition = 'rework'` records the decision. Tracking the repair
  across days is `kpml-network-plan.md` §9 Step 7 item 9, which explicitly says to start with the
  rejection record because it is a strict subset and nothing is wasted.
- **Not evidence on its own.** A quality record says a named person recorded a count on a date.
  It does not say the units were actually inspected, and no software can (§13).

---

## 7. Capacity and Delivery Estimates

### 7.1 The question

> *"Can you deliver 50 KS6 motors by next Friday?"*

It is asked on the phone, it is answered by a supervisor's instinct, and the instinct is
optimistic — which is why MIDC job workers are late and why principals do not believe them. This
is the single highest-value read in Factory OS and it is read-only (F9).

### 7.2 The inputs, and exactly where each comes from

| Input | Source | Note |
|---|---|---|
| Committed load ahead of this order | `p2_production_orders` where `status IN ('planned','in_progress')`, minus progress | The new order queues behind these unless the owner reprioritises |
| Observed daily output for this product | `p2_production_progress` joined to orders, trailing 90 days, per `progress_date` | §7.3 uses the distribution, not the total |
| Who can make it | `p2_workers` joined to progress on that product in 90 days | Never "all active workers" — a worker who has never made a KS6 is not KS6 capacity |
| Material sufficiency | `v_p2_stock_balance` (own) or `v_p2_stock_balance_by_owner` (principal pool) × `p2_product_bom` | The pool comes from the client (F6) |
| Working-day pattern | Distinct `progress_date` values over 90 days | §5.6, derived not configured |
| Overtime capacity | `p2_workers.hours_per_day` | **Scenario only**, never assumed (§10 item 3) |

### 7.3 The computation — quote the bad day, not the average

```
1. daily = array of SUM(quantity_done) per progress_date for this product, last 90 days,
           counting only days on which the factory produced anything at all
2. if COUNT(daily) < 10  →  refuse to quote a date (§7.5)
3. rate_likely = percentile_cont(0.50) WITHIN GROUP (ORDER BY daily)   -- median
   rate_safe   = percentile_cont(0.20) WITHIN GROUP (ORDER BY daily)   -- a bad day
4. backlog  = open units of this product already committed
5. days_safe   = CEIL((backlog + requested) / rate_safe)
   days_likely = CEIL((backlog + requested) / rate_likely)
6. quote     = today + days_safe   working days
   best_case = today + days_likely working days
7. materials = BOM × requested, checked against the pool
```

**Why the 20th percentile and not the mean, stated plainly:** a date computed from a mean is met
roughly half the time, by construction. A job worker who quotes the mean is late every other
order and is the vendor KPML complains about. A job worker who quotes the 20th percentile is
early most of the time, and being early is not a problem anybody has.

**Why a percentile and not mean-minus-a-safety-factor:** a safety factor is a number somebody
invented; a percentile is a property of that factory's own last ninety days. It automatically
tightens for a consistent factory and widens for an erratic one, which is the correct behaviour
and needs no tuning per tenant.

**Why not a per-worker sum:** because absences, machine time and shared bottlenecks are already
inside the observed daily totals. Summing theoretical per-worker rates produces a capacity figure
the factory has never once achieved.

### 7.4 The response shape

```
User:  Can we deliver 50 KS6 1.5HP to KPML by next Friday?

Agent: 50 × KS6 1.5HP — yes, but Thursday 24th, not Friday 18th.

       Ahead of it:  18 KS4 (due Tue), 40 KS6 (due Wed)
       Your KS6 rate: 11/day typical, 8/day on a slow day
       Quoted on the slow day: 50 units = 7 working days after the queue clears
       Best case if everything runs well: Monday 21st

       Materials: enough for all 50
         • Stator Stack KS6   62 in stock, need 50
         • Bearing 6205 ZZ   480 in stock, need 100

       If you want them by the 18th: move the 40 KS6 behind this order,
       or add a second worker to KS6. Either is your call — say which and
       I'll show you what it does to the other dates.
```

Four properties:

- **It answers the question first**, in one line, before the reasoning. A supervisor on a phone
  call needs a date in the first second.
- **It names what is ahead of the order**, because the honest answer to "can you" is almost always
  "not without moving something else."
- **It gives both dates.** The commitment date and the best case. Quoting only the safe date makes
  the factory look slow; quoting only the best case makes it late.
- **It offers the overtime and re-sequencing options and refuses to choose.** Both are management
  decisions about people and customers (§10 items 1, 3 and 7).

### 7.5 What it refuses to answer

| Situation | Response |
|---|---|
| Fewer than 10 production days for that product | *"I've only got 4 days of KS6 production recorded — not enough to promise a date. I can tell you materials are sufficient for 50."* **Never extrapolate from four days** |
| No history at all, but `standard_output_per_day` is set | Quotes from it, and **says so**: *"Based on the 10/day figure in the product settings, not on observed production."* |
| No history and no standard | Refuses, and says what would fix it |
| Material is short | Names the shortfall and **refuses to quote a completion date at all**: *"Short 12 stator stacks. I can't estimate a date until they're in — Nexflow doesn't know when your supplier will deliver."* §13 |
| Asked about a product with no BOM | Quotes a production date, flags that material cannot be checked |

**The material case is the most important refusal in this section.** Nexflow has **no purchase-order
receiving model** — `p2_client_po_numbers` is outbound `[VERIFIED]` — so there is no expected
delivery date for anything, anywhere in the schema, and no observed supplier lead time to derive
one from. An agent that quotes a date which silently assumes material arrives on time is
producing the exact over-promise this feature exists to stop.

---

## 8. The Daily Owner Report

### 8.1 The message

19:00 IST, every day, to the owner's own Telegram:

```
Datta Prasad Enterprises — 16 Sept

Production
  KS4 Motor (PO-2609-0042)   28 of 30 done
    2 behind — Sunil started two hours late. Now finishing Thu, due Fri. OK.
  KS6 1.5HP (PO-2609-0039)   40 of 40 done — ready to dispatch

Dispatches   3 to KPML, challans 1244-1246
GRNs         2 received — Bharat Electricals, Supreme Bearings

Tomorrow     finish the 2 KS4, start 20 KS4 for the Nashik order.
             Stock is sufficient for both.

⚠ 1 rejection today: KS6 1.5HP, "winding loose". Ramesh.
  Third this week from the same worker — worth a look.
```

**Under 200 words, hard cap**, the same discipline `automation-strategy.md` §4.3 applies to the
founder digest: *"If the digest cannot fit, the correct response is to raise the alert threshold,
not to lengthen the message."* An owner reads this standing in a factory yard.

**Nothing in it is a link to a dashboard.** A report that requires opening something is a report
that gets opened on the third day and never again.

### 8.2 What it reads

One bounded query set, per tenant, all scoped to `todayIST()`:

| Section | Source | Filter |
|---|---|---|
| Production | `v_p2_production_order_status` | `status IN ('in_progress','completed')`, plus any order whose projection changed today |
| Delays | §5.6's projection | computed in SQL, not by the model |
| Dispatches | `p2_dispatch_orders` | `dispatch_date = todayIST() AND status='confirmed'` — **`dispatch_date`, never the consumption rows' `transaction_date`** (§3.5's UTC note) |
| GRNs | `p2_stock_transactions` | `transaction_type='grn' AND transaction_date = todayIST()`, grouped by supplier |
| Quality | `p2_quality_records` | `checked_date = todayIST()`, plus the 7-day worker threshold (§6.3) |
| Tomorrow | `p2_production_orders` | due within 3 days, plus BOM sufficiency for the next order to start |

**The input is bounded by construction.** Counts plus at most five rows per section. A tenant with
two hundred open orders produces the same shaped input as one with three, which is what keeps the
cost and the length flat as the book grows (`automation-strategy.md` §4.3's rule, unchanged).

### 8.3 Model and fallback

**Haiku 4.5**, as the brief specifies, and for the reason it gives: this is structured-data
summarisation with the judgment already done in SQL. Every number in the message was computed
deterministically; the model orders the sections, writes the sentences, and nothing else. It is
never asked whether an order is late.

**Three layers, and the report always arrives:**

1. Haiku writes it.
2. Haiku fails or returns something that fails shape validation → **a deterministic bullet list of
   the same numbers.** Less pleasant, equally correct.
3. The whole generation step throws → the notification is still sent with the deterministic list.

This is `filing-package`'s three-layer covering-note pattern, one layer shallower because there is
no Opus tier here `[VERIFIED — Session 16]`. The principle is the same and it is not optional:
**a daily report that sometimes does not arrive teaches the owner to stop expecting it**, and
then the one evening it matters they will not look.

### 8.4 Delivery — and how this channel differs from A0 and A3

§0 C4. Three channels exist and they must not be confused:

| | A0 / A3 (`opsAlert`) | Notifications (`notify`) | **Factory OS daily report** |
|---|---|---|---|
| Audience | The founder | A tenant's owner | **A tenant's owner** |
| Table | `p2_ops_alerts`, **no `tenant_id`** | `p2_notifications` | `p2_notifications` |
| Chat id from | `FOUNDER_TELEGRAM_CHAT_ID` secret | that tenant's `telegram_chat_id` | that tenant's `telegram_chat_id` |
| Scope | cross-tenant | one tenant | one tenant |

The report inserts a `p2_notifications` row with a new type `'daily_production_report'` and
fire-and-forget POSTs `{notification_id}` to `notify`, which resolves the chat id, honours quiet
hours, and flips status to sent or failed `[VERIFIED]`. **No new delivery code exists anywhere in
this feature.**

**The quiet-hours trap, and it is real.** `notify` writes `status='failed'` for a notification
suppressed by quiet hours — the three-value CHECK has no room for "postponed", which `CLAUDE.md`
Known Open Items #20 already records `[VERIFIED]`. An owner whose quiet hours start at 18:00 gets
no report at 19:00 and a `failed` row that looks like a bug.

`[DECIDED]` **Do not special-case the send. Warn at configuration time.** The Settings screen
that sets `daily_report_hour` checks it against `quiet_hours_start`/`end` and refuses to save a
combination that guarantees silence, naming both values. A send-time bypass would be a second
place that decides what quiet hours mean, and the next feature would need a third.

### 8.5 What makes the ⚠ appear

Exactly four conditions, all computed in SQL before the model sees anything. At most one ⚠ block
per report, worst first.

| Condition | Threshold |
|---|---|
| Repeat rejections, one worker | `units_failed >= 3` for one worker in a rolling 7 days (§6.3) |
| Product rejection rate spiking | 30-day rate > 2× the trailing 90-day rate, ≥ 10 units checked |
| An order will miss its due date | §5.6's projection, first time only — subsequent days are a plain line, not a ⚠ |
| Tomorrow's first order cannot start | BOM short against the correct pool |

**A day with none of them has no ⚠ and the report says so in one line.** A warning symbol that
appears every evening stops being a warning by the end of the second week.

### 8.6 Scale — the job queue, from day one

§0 C4 and F12. New Edge Function `factory-report`, two modes, mirroring A6's dispatcher-and-drain
shape exactly:

```
cron 'factory-report-dispatch'   13:25 UTC daily
   → factory-report { mode: 'dispatch' }
       one p2_job_queue row per tenant with factory_os_enabled AND daily_report_enabled
       AND a telegram_chat_id.  Writes no reports.  O(1) per tenant.  Cannot time out.

cron 'factory-report-drain'      every 2 minutes, 13:30–14:30 UTC
   → factory-report { mode: 'drain' }
       claims up to 5 jobs with FOR UPDATE SKIP LOCKED, builds and sends each, returns.
       Bounded by 5 tenants per invocation regardless of book size.
```

`dedupe_key = tenant_id || ':' || report_date` on `p2_job_queue`'s
`UNIQUE (job_type, dedupe_key)` makes a dispatcher that runs twice harmless `[VERIFIED —
automation-strategy.md §3.3]`. A job at `max_attempts` goes `dead` and raises a `critical`
`opsAlert` — **that** is the founder-facing half, and it is the only thing about this feature that
touches A0.

**Cron jobids 2, 3, 8 and 9 are in use** `[VERIFIED]`. Take the next free ones, and confirm with
`SELECT jobid, jobname, schedule FROM cron.job ORDER BY jobid;` before writing the migration
rather than assuming — the numbering in this project has been assigned by hand throughout.

**Why the drain window is an hour.** 100 tenants at 5 per invocation is 20 invocations, one every
two minutes, comfortably inside the window with room for retries. At 500 tenants, raise the batch
size or widen the window; both are configuration, and **neither is a rewrite**, which is the
entire point of not writing the loop.

### 8.7 Cost

| | Tokens | Cost |
|---|---|---|
| Input — bounded summary, ~6 sections | ~2,500 | ₹0.225 |
| Output — under 200 words | ~350 | ₹0.158 |
| **Per tenant per day** | | **₹0.38** |
| **Per tenant per month** (26 reports) | | **₹10** |
| 100 Factory OS tenants, per month | | **₹1,000** |

At Haiku 4.5's ₹0.090/₹0.450 per 1K tokens (`nexflow-agent.md` §9, and **not** the brief's
figures — §0 C1 of that document). Immaterial at every scale in `business-strategy.md` §3.1, and
it stays immaterial because the input is bounded rather than proportional to the tenant's size.

---

## 9. KPML Network Integration

Everything here is governed by `kpml-network-plan.md` §10.5 and
`kpml-network-sessions-21-22.md` §3. **This section adds a new class of data to a cross-tenant
surface, which means all six failure modes must be re-argued for it rather than assumed to be
handled.** §9.5 does that.

### 9.1 The three flows

```
  KPML (principal tenant)                    Datta Prasad (vendor tenant)
  ───────────────────────                    ────────────────────────────
  1. PO Push (Session 28)  ──────────────►   production orders, status='proposed'
                                             owner accepts → 'planned'   (§9.2)

  2.                       ◄──────────────   order progress, scoped
     principal dashboard        RPC          get_principal_vendor_production()  (§9.3)

  3. "Status of our KS4     ──────────────►  same RPC, across every linked vendor,
      order?"                                consolidated in the answer            (§9.4)
```

**Direction matters.** Flow 1 is a suggestion that the vendor accepts. Flows 2 and 3 are reads.
**Nothing in Factory OS lets a principal write into a vendor's production data**, and
`kpml-network-sessions-21-22.md` §4.1's list of what Session 22 permits — record a dispatch of
their own material, attach a challan number, cancel their own dispatch, record a receipt — does
not include anything production-related and is not extended here.

### 9.2 A principal's PO becomes proposed production orders

When Session 28 delivers a PO line — material code, description, quantity, still-to-deliver
running balance, price per piece, deadline (`kpml-network-plan.md` §9 Step 7 item 2) — Factory OS
creates one production order per line, at the vendor, with:

```
status              = 'proposed'
source              = 'principal_po'
source_po_number    = <KPML's PO number>
source_po_line      = <KPML's line reference>
client_id           = <the vendor's p2_clients row for KPML>
owned_by            = <the same row>            -- job work: KPML's material (F6)
quantity_ordered    = <still-to-deliver balance, not the original PO quantity>
due_date            = <the PO line's deadline>
```

**`quantity_ordered` comes from the still-to-deliver balance and never from the PO's original
quantity.** `kpml-network-plan.md` §9 Step 7 is explicit that the PO carries a running balance,
*"not a status enum"*, precisely because 340 of 500 delivered is the normal state. Creating an
order for 500 when 160 remain would put 340 phantom units into every capacity estimate in §7.

**The vendor sees one line in the 7pm report and one card in the app:**

```
KPML sent a new order: 160 × KS4 Motor (2WST-4471), due 30 Sept.
[ Accept ]   [ Not now ]
```

One tap to accept, which flips it to `planned` and nothing else — no stock moves, no material is
issued, no challan (F2). **"Not now" leaves it `proposed`**, where it expires after 30 days
(§3.2) and is visible until then. It is not rejected back to KPML; declining a principal's order
is a phone call, not a button, and a software "reject" that KPML sees would make Nexflow a party
to a commercial negotiation.

**A vendor with Factory OS disabled gets nothing.** `factory_os_enabled = false` means PO lines
arrive through whatever Session 28 builds for the non-Factory-OS case and no production order is
created. The feature must not switch itself on because a principal pushed something.

### 9.3 Vendor progress on the principal dashboard

One new RPC, `get_principal_vendor_production()`, and it goes **through the same single scoped
access path** as `get_principal_vendor_material()` — same resolution, same guard, same refusal
shape `[VERIFIED — 20260908_get_principal_vendor_material.sql]`:

```sql
CREATE OR REPLACE FUNCTION get_principal_vendor_production()
RETURNS TABLE (
  vendor_tenant_id   uuid,
  vendor_name        text,
  order_number       text,
  product_name       text,
  product_code       text,
  quantity_ordered   numeric,
  quantity_done      numeric,
  quantity_passed    numeric,
  quantity_failed    numeric,
  quantity_dispatched numeric,
  due_date           date,
  projected_date     date,
  status             text,
  source_po_number   text,
  source_po_line     text
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
-- Resolution, identical to get_principal_vendor_material():
--   v_caller_tenant := get_my_tenant_id();
--   caller must have p2_tenant_settings.is_principal = true, else RETURN
--     (empty, never an error -- do not leak WHY to a non-principal caller)
--   JOIN p2_network_links   nl ON nl.principal_tenant_id = v_caller_tenant
--                             AND nl.status = 'active'
--   JOIN p2_clients         vc ON vc.tenant_id = nl.vendor_tenant_id
--                             AND vc.linked_tenant_id = v_caller_tenant
--   JOIN p2_production_orders po ON po.tenant_id = nl.vendor_tenant_id
--                               AND po.owned_by  = vc.id      <-- THE scope filter
--
-- NEVER returns: worker names, worker counts, any per-worker figure, any order
-- where owned_by IS DISTINCT FROM vc.id, any order with owned_by IS NULL (the
-- vendor's own production), any aggregate spanning owners, any count of the
-- vendor's total orders, or any signal that another principal exists.
$$;
```

**`owned_by = vc.id` is the only filter, and it is the same one every other principal-facing read
already starts from.** An order the vendor is making from their own material, or from Godrej's,
is not merely filtered out of the result — it is never joined.

**Extend this function; never write a second one.** `kpml-network-plan.md` §10.5's failure mode 6
is RPC drift and is named as *"the one that actually happens."* The scope-boundary comment block
from the existing RPC is copied into this one verbatim, for the same reason it is there.

### 9.4 The principal's own query

A new read intent for principal tenants: *"What's the delivery status for our KS4 order?"*

```
Agent: Your KS4 Motor orders across 3 vendors:

       Datta Prasad     160 ordered   112 done   projected 28 Sept   (due 30 Sept)
       SS Engineering    80 ordered    80 done    40 dispatched, 40 ready
       Shivprasad       120 ordered    35 done   projected  6 Oct    (due 30 Sept)  ⚠

       Shivprasad is 6 days behind on 85 units.
```

**The cross-vendor aggregate is legitimate here**, and the distinction is exact: it spans
*vendors*, and every row in it is KPML's own material at a vendor KPML is linked to. It does not
span *principals*. `kpml-network-plan.md` §10.5's rule forbids totals that encode another
principal's quantity; this total encodes only KPML's.

Mechanically it is one call to the scoped RPC — which already returns rows from every active link
— grouped in the Edge Function. No per-vendor loop, no second path, no chance of one vendor's
query accidentally carrying another's filter.

### 9.5 The six failure modes, applied to production data

Every new principal-facing surface is tested against all six before it ships
(`kpml-network-sessions-21-22.md` §3). Production data puts new clothes on three of them.

| # | Mode | How production data could leak | Defence |
|---|---|---|---|
| 1 | **Aggregate** | "This vendor completed 340 units this month" spans every principal | No total that is not filtered by `owned_by`. §9.6 is the single argued exception |
| 2 | **Existence** | Listing products the vendor makes reveals products KPML never ordered | The query starts from `owned_by = vc.id`, never from `p2_products` |
| 3 | **Variance denominator** | A rejection *rate* whose denominator is the vendor's total output encodes other principals' volume. **The most likely leak, because a denominator feels like a detail** | Numerator **and** denominator both inside scope. KPML sees passed/failed counts **on their own orders**, never a factory-wide rate |
| 4 | **Alert** | "This vendor is overloaded" is derived from a queue spanning principals | No capacity or load signal crosses the boundary. Only a per-order projected date (§9.6) |
| 5 | **Scorecard** | An on-time-delivery percentage per vendor, benchmarked | **Not built.** When one is asked for it is computed per-principal on that principal's own orders, or it is not built |
| 6 | **RPC drift** | A future session adds `worker_name` to the RPC's select list | The scope comment block, the single-path rule, and F10 stated as a non-negotiable in §1.4 |

### 9.6 The one aggregate allowed to cross, and why

**`projected_date` is computed from information KPML is not entitled to see, and it is sent to
KPML anyway.** This is a deliberate, bounded exception and it would be dishonest to leave it
unstated.

§5.6's projection uses the order's own observed rate, which is clean. But a *useful* answer to
"when will our 160 be ready" also depends on what is queued ahead of it — and some of that queue
may be Godrej's. A date that ignores the queue is optimistic and useless; a date that includes it
**encodes the existence of other work.**

**The resolution:**

- **The date crosses the boundary. The queue composition never does.** KPML sees `projected_date`.
  KPML never sees what is ahead of it, how many orders exist, or for whom.
- **KPML cannot invert it.** A later date is consistent with a hundred explanations — a slow
  worker, a machine down, a material shortage, other work. It carries no identity and no quantity.
- **It is the one thing a principal is unambiguously entitled to.** They are asking when their own
  order will be ready. Refusing to answer that would make the dashboard useless and push KPML back
  onto phone calls, which is the problem this network exists to solve.

**And the limit on the exception:** no number that *quantifies* the load ever crosses — not "3
orders ahead", not "62% utilised", not "busy until the 24th". One date per order. If a future
session wants to add "3 orders ahead of yours" because it reads more helpfully, **that is failure
mode 1 wearing a helpful hat**, and the answer is no.

---

## 10. What Stays Manual

Honest, and short by design. Everything here is manual because automating it would require the
agent to make a judgement whose consequences it cannot see — or because the decision belongs to
a human for reasons that are not technical at all.

For each: why, and what the agent does instead. **The agent always does something.**

### 1. Hiring, firing, and who is assigned to what `[NEVER]`

**Why.** Employment decisions have legal consequences (notice, dues, statutory records), and they
rest on facts no software holds: who is reliable, who is training, who has a family emergency this
week, who the other workers will work with. A system that ranked workers by output and suggested
who to remove would be confidently wrong about a person's job on the basis of a completion rate.

**Agent instead:** surfaces the data and stops. Completion rates per worker per product,
rejection counts, the 7-day threshold. It will say *"Ramesh has 3 rejections this week, all
winding"*. It will never say who to assign, promote or remove. When asked to pick a worker, it
asks which worker (§4.5).

### 2. Setting capacity and shift hours `[DECIDED — manual]`

**Why.** Shift length, second shifts and weekend working are cost and labour decisions with
overtime obligations attached.

**Agent instead:** reads `p2_workers.hours_per_day` and `p2_products.standard_output_per_day` as
inputs, and shows what changing them would do as a **scenario** in an estimate. It never writes
them.

### 3. Approving overtime `[DECIDED — manual]`

**Why.** It costs money at a statutory premium and it is a conversation with a person.

**Agent instead:** offers it as the alternative branch of an estimate — *"or 65 by Monday the 28th
if KS6 runs a second shift"* — with the date attached, and waits. An overtime figure that appears
in a delivery promise the owner never approved is a promise made to KPML by software.

### 4. Handling a quality dispute with a principal `[DECIDED — manual]`

**Why.** It is a commercial negotiation with the factory's largest customer, and the right answer
is sometimes to absorb a cost that is not the factory's fault.

**Agent instead:** produces the **evidence pack** in ten seconds — the production order, who made
the units, the quality records with counts, dates, checker and verbatim defect notes, the
dispatch challan, and the material lot the units came from via `principal_challan_no` and
`principal_challan_date`. That is the entire argument, assembled. `kpml-network-plan.md` §9 Step 5
already names an evidence pack as the artefact that ends disputes; this is its production half.

### 5. Which customer to disappoint `[NEVER]`

**Why.** Two orders, one week, not enough capacity. The answer depends on which relationship
matters more, who was late last time, who pays on time, and what was said on a phone call in
March. None of it is in the database.

**Agent instead:** states the conflict precisely — *"Both are due Friday. You can finish KPML's
160 by Thursday or Nashik's 20 by Wednesday, not both. Which one moves?"* — and then executes
whichever the owner chooses. **Naming the conflict early is most of the value**; a supervisor
usually discovers it on Thursday.

### 6. Anything that creates a statutory document `[DECIDED — full confirm gate]`

Dispatch (a Rule 55 challan), invoice, credit note. These are not "manual" in the sense of being
outside Factory OS — they are inside it and they carry the full confirmation gate every time, with
no batching and no learned trust (F2's table, `nexflow-agent.md` §16 item 1).

### 7. Cancelling an order whose material was already issued `[DECIDED — owner or supervisor]`

**Why.** The stock is gone and the software cannot know where it went — back to the store,
half-assembled on a bench, or scrapped. Each has a different correct ledger entry.

**Agent instead:** cancels the order, states plainly that the material stays consumed, and offers
the two paths (stock adjustment, or a `scrap_return` if it belongs to a principal). §3.7.

### 8. Any decision above the client's own financial threshold `[RECOMMENDED]`

**Why.** An owner may reasonably want to personally approve a dispatch above a value, or a
write-off above one. `nexflow-agent.md` §5.5 already bands stock adjustments this way and §17 Q6
of that document leaves a two-person rule open, recommending against building it before a client
asks.

**Agent instead:** the same banding. Nothing new is built here, and when a client asks, the hook
is `p2_agent_proposals.user_id`, which already exists — a gate, not a redesign.

### 9. Piece rates, wages, attendance `[NEVER]`

F11, §16 item 3. Not manual — **absent**. Factory OS holds no field a payroll system could join
to, and the reason is that a number which sets someone's pay stops being a measurement.

---

## 11. Schema

Five new tables, one view, nine RPCs, seven columns on existing tables, three widened CHECK
constraints. **RLS is enabled in the same migration that creates the policy** — the audit's
single largest finding was fifteen tables that got a policy and never got `ENABLE ROW LEVEL
SECURITY` `[VERIFIED]`, and that must not be repeated here.

Conventions inherited without exception: `p2_` prefix · `uuid` primary keys with
`gen_random_uuid()` · `timestamptz` for instants, `date` for IST calendar days · RLS via
`get_my_tenant_id()`, **never `auth.uid()`** (the known-broken pattern that silently blocks every
non-owner staff role) · three command-scoped policies, no DELETE · `tenant_id` passed explicitly
by the caller with **no `set_tenant_id()` trigger** (a trigger deriving from `get_my_tenant_id()`
clobbers a service-role insert's explicit `tenant_id` with NULL, the reasoning already recorded
on `p2_notifications` `[VERIFIED]`).

### 11.1 `p2_workers`

```sql
-- People who do physical work. NOT software users -- see factory-os.md §0 C2.
-- p2_user_roles is (user_id, tenant_id, role, email): no name, one auth account
-- per row, and an invite flow that is broken in this region.
CREATE TABLE p2_workers (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         uuid NOT NULL REFERENCES p2_tenants(id),

  name              text NOT NULL CHECK (length(trim(name)) > 0),
  worker_code       text,                    -- optional badge/token number
  phone             text,                    -- optional. Digits as entered; not validated.
  user_id           uuid REFERENCES auth.users(id),   -- NULL for most workers

  hours_per_day     numeric(4,2) NOT NULL DEFAULT 8 CHECK (hours_per_day > 0 AND hours_per_day <= 24),
  shift             text CHECK (shift IN ('general','day','night')),

  access_token      uuid NOT NULL DEFAULT gen_random_uuid(),
  token_rotated_at  timestamptz,

  is_active         boolean NOT NULL DEFAULT true,
  notes             text,
  created_by        uuid REFERENCES auth.users(id),
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE p2_workers ENABLE ROW LEVEL SECURITY;

CREATE POLICY p2_workers_select ON p2_workers
  FOR SELECT USING (tenant_id = get_my_tenant_id());
CREATE POLICY p2_workers_insert ON p2_workers
  FOR INSERT WITH CHECK (tenant_id = get_my_tenant_id());
CREATE POLICY p2_workers_update ON p2_workers
  FOR UPDATE USING (tenant_id = get_my_tenant_id())
             WITH CHECK (tenant_id = get_my_tenant_id());
-- No DELETE policy. A worker who leaves is deactivated; their history stays.

CREATE UNIQUE INDEX p2_workers_token_idx  ON p2_workers (access_token);
CREATE UNIQUE INDEX p2_workers_user_idx   ON p2_workers (tenant_id, user_id)
  WHERE user_id IS NOT NULL;
CREATE UNIQUE INDEX p2_workers_code_idx   ON p2_workers (tenant_id, upper(trim(worker_code)))
  WHERE worker_code IS NOT NULL AND trim(worker_code) <> '';
CREATE INDEX        p2_workers_active_idx ON p2_workers (tenant_id) WHERE is_active;
```

**`access_token` is globally unique, not per tenant** — it is looked up by token alone, with no
tenant context, by an unauthenticated Edge Function. A per-tenant unique index would permit a
collision across tenants, which is a cross-tenant read.

**No unique constraint on `name`.** Two people called Ramesh is normal; §4.7 handles the
disambiguation in the matcher rather than forbidding the data.

### 11.2 `p2_production_orders`

```sql
-- "Make <quantity> of <product> by <due_date>, from <owned_by>'s material,
--  for <client>."  A PLANNING object: creating one moves no stock (§2 F2).
CREATE TABLE p2_production_orders (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id             uuid NOT NULL REFERENCES p2_tenants(id),

  order_number          text NOT NULL,              -- PO-YYMM-NNNN. Not a statutory document.
  product_id            uuid NOT NULL REFERENCES p2_products(id),
  quantity_ordered      numeric(12,3) NOT NULL CHECK (quantity_ordered > 0),
  due_date              date NOT NULL,

  client_id             uuid REFERENCES p2_clients(id),   -- NULL = make to stock
  owned_by              uuid REFERENCES p2_clients(id),   -- NULL = own material. Derived (F6).

  status                text NOT NULL DEFAULT 'planned'
                          CHECK (status IN ('proposed','planned','in_progress',
                                            'completed','dispatched','cancelled')),
  source                text NOT NULL DEFAULT 'manual'
                          CHECK (source IN ('manual','principal_po','recurring')),
  source_po_number      text,          -- Session 28. Text, not an FK -- §3.6.
  source_po_line        text,

  bom_issue_dispatch_id uuid REFERENCES p2_dispatch_orders(id),   -- set by start_production_order
  started_at            timestamptz,
  completed_at          timestamptz,
  cancelled_at          timestamptz,
  cancelled_by          uuid REFERENCES auth.users(id),
  cancel_reason         text,

  notes                 text,
  created_by            uuid REFERENCES auth.users(id),   -- auth.uid(), NOT tenant_id (§3.1)
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT p2_production_orders_cancel_reason
    CHECK (status <> 'cancelled' OR (cancel_reason IS NOT NULL AND length(trim(cancel_reason)) > 0))
);

ALTER TABLE p2_production_orders ENABLE ROW LEVEL SECURITY;

CREATE POLICY p2_production_orders_select ON p2_production_orders
  FOR SELECT USING (tenant_id = get_my_tenant_id());
CREATE POLICY p2_production_orders_insert ON p2_production_orders
  FOR INSERT WITH CHECK (tenant_id = get_my_tenant_id());
CREATE POLICY p2_production_orders_update ON p2_production_orders
  FOR UPDATE USING (tenant_id = get_my_tenant_id())
             WITH CHECK (tenant_id = get_my_tenant_id());
-- No DELETE. An order is cancelled, never removed -- it is the parent of a
-- consumption event and of every progress row beneath it.

CREATE UNIQUE INDEX p2_production_orders_number_idx ON p2_production_orders (tenant_id, order_number);
CREATE INDEX p2_production_orders_open_idx    ON p2_production_orders (tenant_id, status, due_date)
  WHERE status IN ('proposed','planned','in_progress');
CREATE INDEX p2_production_orders_product_idx ON p2_production_orders (tenant_id, product_id, due_date);
CREATE INDEX p2_production_orders_owner_idx   ON p2_production_orders (tenant_id, owned_by)
  WHERE owned_by IS NOT NULL;      -- the principal-scoped read path (§9.3)
CREATE INDEX p2_production_orders_recent_idx  ON p2_production_orders (tenant_id, created_at DESC);
```

**`quantity_completed` is absent on purpose** (F7). So is `priority`, `movement_purpose` (F6) and
`assigned_worker_id` (§4.2).

**No FK from `owned_by` to `p2_tenants`.** It points at `p2_clients`, matching
`p2_stock_transactions.owned_by` and `p2_dispatch_orders.owned_by` exactly `[VERIFIED — Step 2I]`.
A pool is a client row in the vendor's own tenant, not a tenant id; getting this wrong makes the
principal-scoped join in §9.3 impossible.

### 11.3 `p2_production_assignments`

```sql
-- Which worker is doing which slice of which order. A table, not a column (§4.2).
CREATE TABLE p2_production_assignments (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id            uuid NOT NULL REFERENCES p2_tenants(id),
  production_order_id  uuid NOT NULL REFERENCES p2_production_orders(id),
  worker_id            uuid NOT NULL REFERENCES p2_workers(id),

  quantity_assigned    numeric(12,3) NOT NULL CHECK (quantity_assigned > 0),
  assigned_date        date NOT NULL,
  due_date             date NOT NULL,          -- may be earlier than the order's

  status               text NOT NULL DEFAULT 'active'
                         CHECK (status IN ('active','completed','reassigned','cancelled')),
  notes                text,
  created_by           uuid REFERENCES auth.users(id),
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE p2_production_assignments ENABLE ROW LEVEL SECURITY;

CREATE POLICY p2_production_assignments_select ON p2_production_assignments
  FOR SELECT USING (tenant_id = get_my_tenant_id());
CREATE POLICY p2_production_assignments_insert ON p2_production_assignments
  FOR INSERT WITH CHECK (tenant_id = get_my_tenant_id());
CREATE POLICY p2_production_assignments_update ON p2_production_assignments
  FOR UPDATE USING (tenant_id = get_my_tenant_id())
             WITH CHECK (tenant_id = get_my_tenant_id());
-- No DELETE. A reassignment flips status and keeps the row (§4.2 rule 3).

-- One live slice per worker per order. This is a database guarantee, not a
-- convention -- the worker page resolves "which assignment did this tap belong
-- to" through it.
CREATE UNIQUE INDEX p2_production_assignments_active_idx
  ON p2_production_assignments (production_order_id, worker_id)
  WHERE status = 'active';

CREATE INDEX p2_production_assignments_worker_idx
  ON p2_production_assignments (tenant_id, worker_id, status);
CREATE INDEX p2_production_assignments_order_idx
  ON p2_production_assignments (production_order_id);
```

**The "assigned may not exceed ordered" rule is not here.** It spans rows and is enforced under a
`FOR UPDATE` lock inside `assign_production_work` (§4.2 rule 1). A CHECK cannot express it and a
trigger that tried would race.

### 11.4 `p2_production_progress`

```sql
-- Append-only. Balance = SUM, never stored (F7). Same idiom as
-- p2_stock_transactions and p2_wip_transactions.
CREATE TABLE p2_production_progress (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id            uuid NOT NULL REFERENCES p2_tenants(id),
  production_order_id  uuid NOT NULL REFERENCES p2_production_orders(id),
  assignment_id        uuid REFERENCES p2_production_assignments(id),  -- NULL: unassigned work
  worker_id            uuid REFERENCES p2_workers(id),                 -- NULL: owner/supervisor entry

  quantity_done        numeric(12,3) NOT NULL CHECK (quantity_done <> 0),  -- negative = correction
  progress_date        date NOT NULL,          -- IST, from todayIST(). NOT reported_at's date.
  reported_at          timestamptz NOT NULL DEFAULT now(),

  entry_source         text NOT NULL
                         CHECK (entry_source IN ('worker_tap','worker_dictation',
                                                 'supervisor','owner','agent')),
  client_event_id      uuid NOT NULL,          -- idempotency key, generated at TAP time (§5.4)
  note                 text,
  created_by           uuid REFERENCES auth.users(id),   -- NULL for a token-authenticated tap
  created_at           timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT p2_production_progress_negative_needs_note
    CHECK (quantity_done > 0 OR (note IS NOT NULL AND length(trim(note)) > 0))
);

ALTER TABLE p2_production_progress ENABLE ROW LEVEL SECURITY;

CREATE POLICY p2_production_progress_select ON p2_production_progress
  FOR SELECT USING (tenant_id = get_my_tenant_id());
CREATE POLICY p2_production_progress_insert ON p2_production_progress
  FOR INSERT WITH CHECK (tenant_id = get_my_tenant_id());
-- No UPDATE policy and no DELETE policy: append-only means append-only.
-- A wrong entry is corrected by a negative row carrying a note.

CREATE UNIQUE INDEX p2_production_progress_event_idx
  ON p2_production_progress (tenant_id, client_event_id);
CREATE INDEX p2_production_progress_order_idx
  ON p2_production_progress (production_order_id, progress_date);
CREATE INDEX p2_production_progress_worker_rate_idx
  ON p2_production_progress (tenant_id, worker_id, progress_date)
  WHERE quantity_done > 0;        -- the §4.6 rate query
```

**No UPDATE policy is a deliberate departure** from the three-policy convention used everywhere
else in this schema. Every other table permits UPDATE because rows have mutable state; a progress
row is an observation and has none. Permitting UPDATE would allow a correction that leaves no
trace of what was corrected, which is exactly what the stock ledger refuses.

### 11.5 `p2_quality_records`

```sql
-- Pass/fail per batch, free-text defect note. Internal workflow only.
-- Not a QMS. Not ISO. Not an inspection plan. (§6.1, §16 item 6.)
CREATE TABLE p2_quality_records (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id            uuid NOT NULL REFERENCES p2_tenants(id),
  production_order_id  uuid NOT NULL REFERENCES p2_production_orders(id),
  worker_id            uuid REFERENCES p2_workers(id),    -- who made them. NULL if mixed/unknown.

  batch_ref            text,                              -- the factory's own marking, free text
  units_passed         numeric(12,3) NOT NULL DEFAULT 0 CHECK (units_passed >= 0),
  units_failed         numeric(12,3) NOT NULL DEFAULT 0 CHECK (units_failed >= 0),
  defect_note          text,
  disposition          text NOT NULL DEFAULT 'rework'
                         CHECK (disposition IN ('rework','scrap','accepted_with_deviation')),

  checked_by           uuid NOT NULL REFERENCES auth.users(id),   -- never the worker (§6.5)
  checked_date         date NOT NULL,                             -- IST, todayIST()
  checked_at           timestamptz NOT NULL DEFAULT now(),
  created_at           timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT p2_quality_records_nonempty
    CHECK (units_passed + units_failed > 0),
  CONSTRAINT p2_quality_records_defect_note_required
    CHECK (units_failed = 0 OR (defect_note IS NOT NULL AND length(trim(defect_note)) > 0))
);

ALTER TABLE p2_quality_records ENABLE ROW LEVEL SECURITY;

CREATE POLICY p2_quality_records_select ON p2_quality_records
  FOR SELECT USING (tenant_id = get_my_tenant_id());
CREATE POLICY p2_quality_records_insert ON p2_quality_records
  FOR INSERT WITH CHECK (tenant_id = get_my_tenant_id());
-- No UPDATE, no DELETE. A quality record is an attestation by a named person on
-- a date; a re-check is a new record, and both stay.

CREATE INDEX p2_quality_records_order_idx  ON p2_quality_records (production_order_id);
CREATE INDEX p2_quality_records_worker_idx ON p2_quality_records (tenant_id, worker_id, checked_date)
  WHERE units_failed > 0;         -- the §6.3 threshold query
CREATE INDEX p2_quality_records_date_idx   ON p2_quality_records (tenant_id, checked_date DESC);
```

`p2_quality_records` is also **immutable** (no UPDATE), for the same reason `p2_cancelled_challans`
is `[VERIFIED]`: it is the artefact a dispute with KPML rests on (§10 item 4), and an editable
attestation is not an attestation.

### 11.6 `v_p2_production_order_status`

```sql
-- The single read surface for "how is this order going". security_invoker = true
-- AND an explicit tenant filter -- both, per the Session 1 view-RLS finding.
CREATE VIEW v_p2_production_order_status
WITH (security_invoker = true) AS
SELECT
  po.tenant_id,
  po.id                              AS production_order_id,
  po.order_number,
  po.product_id,
  po.client_id,
  po.owned_by,
  po.status,
  po.due_date,
  po.quantity_ordered,
  COALESCE(pr.qty_done, 0)           AS quantity_done,
  po.quantity_ordered - COALESCE(pr.qty_done, 0)        AS quantity_remaining,
  COALESCE(qc.units_passed, 0)       AS quantity_passed,
  COALESCE(qc.units_failed, 0)       AS quantity_failed,
  COALESCE(dp.qty_dispatched, 0)     AS quantity_dispatched,
  COALESCE(asg.qty_assigned, 0)      AS quantity_assigned,
  po.quantity_ordered - COALESCE(asg.qty_assigned, 0)   AS quantity_unassigned,
  pr.first_progress_date,
  pr.last_progress_date,
  pr.working_days,
  asg.worker_count
FROM p2_production_orders po
LEFT JOIN (
  SELECT production_order_id,
         SUM(quantity_done)                        AS qty_done,
         MIN(progress_date)                        AS first_progress_date,
         MAX(progress_date)                        AS last_progress_date,
         COUNT(DISTINCT progress_date)             AS working_days
    FROM p2_production_progress
   GROUP BY production_order_id
) pr  ON pr.production_order_id  = po.id
LEFT JOIN (
  SELECT production_order_id,
         SUM(units_passed) AS units_passed,
         SUM(units_failed) AS units_failed
    FROM p2_quality_records
   GROUP BY production_order_id
) qc  ON qc.production_order_id  = po.id
LEFT JOIN (
  SELECT production_order_id,
         SUM(quantity_assigned) AS qty_assigned,
         COUNT(*)               AS worker_count
    FROM p2_production_assignments
   WHERE status = 'active'
   GROUP BY production_order_id
) asg ON asg.production_order_id = po.id
LEFT JOIN (
  SELECT d.production_order_id,
         SUM(di.qty_dispatched) AS qty_dispatched
    FROM p2_dispatch_orders d
    JOIN p2_dispatch_items  di ON di.dispatch_order_id = d.id
   WHERE d.production_order_id IS NOT NULL
     AND d.status = 'confirmed'
   GROUP BY d.production_order_id
) dp  ON dp.production_order_id = po.id
WHERE po.tenant_id = get_my_tenant_id();
```

**Pre-aggregated subqueries, never a flat multi-table join.** Joining progress, quality,
assignments and dispatch items directly would fan out and multiply every sum by the row counts of
the others. `v_p2_supplier_advance_balance` already carries this exact structure for the same
reason `[VERIFIED]`.

**`projected_date` is deliberately not in the view.** §5.6's projection needs the tenant's derived
working-day pattern, which is a second aggregate over a different window; computing it per row
inside a view that is read on every screen is the wrong place. It is computed in the Edge Function
from `working_days`, `quantity_remaining` and the tenant pattern — one pure function, one
implementation, reused by §5.6, §7 and §8.

### 11.7 Columns on existing tables

```sql
-- p2_dispatch_orders: the F3 link. Nullable; NULL = today's behaviour exactly.
ALTER TABLE p2_dispatch_orders
  ADD COLUMN IF NOT EXISTS production_order_id uuid REFERENCES p2_production_orders(id);
CREATE INDEX p2_dispatch_orders_production_idx
  ON p2_dispatch_orders (production_order_id) WHERE production_order_id IS NOT NULL;

-- p2_products: the one place a human estimate is accepted (§4.6 fallback 3).
ALTER TABLE p2_products
  ADD COLUMN IF NOT EXISTS standard_output_per_day numeric(12,3)
    CHECK (standard_output_per_day IS NULL OR standard_output_per_day > 0);

-- p2_tenant_settings: four switches and one counter.
ALTER TABLE p2_tenant_settings
  ADD COLUMN IF NOT EXISTS factory_os_enabled        boolean  NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS quality_gate_enabled      boolean  NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS daily_report_enabled      boolean  NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS daily_report_hour         smallint NOT NULL DEFAULT 19
    CHECK (daily_report_hour BETWEEN 0 AND 23),
  ADD COLUMN IF NOT EXISTS production_order_sequence integer  NOT NULL DEFAULT 0;
```

**`factory_os_enabled` defaults to false on every tenant including existing ones**, the same
posture as `agent_write_enabled` (`nexflow-agent.md` §8.2) and `is_job_worker` `[VERIFIED]`.
Switching a live production tenant into a new operating model on the day a migration runs is
exactly the change `CLAUDE.md`'s rules forbid.

**`daily_report_enabled` defaults to true**, unlike the others, because it is inert until
`factory_os_enabled` is on — and a tenant that turns Factory OS on wants the report. §8.4's
configuration check binds `daily_report_hour` against quiet hours.

### 11.8 Widened CHECK constraints

Three, all `DROP CONSTRAINT` / `ADD CONSTRAINT` pairs, all in the same migration file:

```sql
-- 1. The agent's proposal store gains three kinds (F1).
ALTER TABLE p2_agent_proposals DROP CONSTRAINT p2_agent_proposals_kind_check;
ALTER TABLE p2_agent_proposals ADD  CONSTRAINT p2_agent_proposals_kind_check
  CHECK (kind IN ('dispatch','grn','production_issue','invoice','stock_adjustment',
                  'production_order','work_assignment','quality_check'));

-- 2. Owner-facing notification types (§5.7, §8.4).
ALTER TABLE p2_notifications DROP CONSTRAINT p2_notifications_type_check;
ALTER TABLE p2_notifications ADD  CONSTRAINT p2_notifications_type_check
  CHECK (type IN ('challan_dispatched','payment_overdue','low_stock','filing_package_ready',
                  'daily_production_report','production_delay','quality_alert','work_assigned'));

-- 3. Founder ops alerts gain a Factory source (§8.6, §15).
--    Same one-line widening bridge-agent.md §8.6 requires for 'bridge'.
ALTER TABLE p2_ops_alerts DROP CONSTRAINT p2_ops_alerts_source_check;
ALTER TABLE p2_ops_alerts ADD  CONSTRAINT p2_ops_alerts_source_check
  CHECK (source IN ('compliance','digest','filing','health','onboarding','support','billing',
                    'factory'));
```

`p2_agent_proposals` and `p2_ops_alerts` do not exist yet — they arrive with the agent write layer
and A0 respectively. **If either is missing when Factory OS is built, that dependency is not
optional and is not worked around** (§12.1).

### 11.9 RPCs

Nine — eight wrappers and one number generator. All plain `SECURITY INVOKER` with an explicit
`p_tenant_id`, matching `confirm_bom_issue`'s
posture and **never** `SECURITY DEFINER` (F3's trap). The `verifyCallerTenant` check in the Edge
Function is the real gate, as it already is for every existing write path.

| RPC | Does | Raises |
|---|---|---|
| `get_next_production_order_number(p_tenant_id)` | Row-locked counter on `p2_tenant_settings.production_order_sequence`; returns `PO-YYMM-NNNN` with `to_char(now() AT TIME ZONE 'Asia/Kolkata','YYMM')` — the IST stamp fix `get_next_invoice_number` already needed `[VERIFIED]` | — |
| `create_production_order(p_tenant_id, p_product_id, p_quantity, p_due_date, p_client_id, p_owned_by, p_source, p_source_po_number, p_source_po_line, p_notes, p_created_by)` | Draws the number, inserts the row in `planned` (or `proposed` when `p_source='principal_po'`) | `PRODUCT_NOT_FOUND` |
| `accept_production_order(p_tenant_id, p_order_id)` | `proposed` → `planned` | `NOT_PROPOSED` |
| `start_production_order(p_tenant_id, p_order_id, p_challan_number, p_issue_date, p_consumption_json, p_notes)` | Calls `confirm_bom_issue` v4 (11 args, `p_force := false`, `p_product_id` always set), writes `bom_issue_dispatch_id`, `started_at`, `status='in_progress'` | `ALREADY_ISSUED`, plus everything `confirm_bom_issue` raises (`INSUFFICIENT_STOCK`, `DUPLICATE_ISSUE`) |
| `assign_production_work(p_tenant_id, p_order_id, p_assignments_json)` | Locks the order, validates the sum against `quantity_ordered`, flips any superseded slice to `reassigned`, inserts the new ones | `OVER_ASSIGNED`, `WORKER_INACTIVE` |
| `record_production_progress(p_tenant_id, p_order_id, p_assignment_id, p_worker_id, p_quantity, p_progress_date, p_entry_source, p_client_event_id, p_note)` | Inserts; on unique violation returns the existing row's totals; flips `planned→in_progress` and `in_progress→completed` as needed | `ORDER_CANCELLED` |
| `record_quality_check(p_tenant_id, p_order_id, p_worker_id, p_passed, p_failed, p_defect_note, p_disposition, p_batch_ref, p_checked_by, p_checked_date)` | Inserts | `EXCEEDS_PRODUCED` when passed+failed would exceed produced units |
| `confirm_production_dispatch(p_tenant_id, p_order_id, p_dispatch_order_id, p_challan_number, p_quantity, p_owned_by)` | Re-checks `dispatchable` under lock, calls `confirm_dispatch_transaction` with `p_consumption_json := '[]'`, calls `close_wip`, flips `status='dispatched'` when nothing remains | `EXCEEDS_DISPATCHABLE`, plus `WIP_EXCEEDS_BALANCE` from `close_wip` |
| `cancel_production_order(p_tenant_id, p_order_id, p_reason, p_cancelled_by)` | Flips to `cancelled`, cancels active assignments. **Reverses no stock** (§3.7) | `ALREADY_DISPATCHED` |

**`record_production_progress` must catch the unique violation rather than pre-checking it.** A
`SELECT` then `INSERT` on `client_event_id` is a race between two retries of the same tap;
`INSERT … ON CONFLICT (tenant_id, client_event_id) DO NOTHING` followed by a read of the existing
row is not.

### 11.10 Edge Functions and pages

| Object | Kind | Notes |
|---|---|---|
| `agent-query` | modified | Three new `propose_*` tools, three new read intents, three new `kind` values. No new function (F1) |
| `work-view` | **new** | `verify_jwt = false`, `SB_SECRET_KEY`, UUID regex guard. GET the worker's queue, POST a progress row. Rate-limited per token (§4.4). The `receive-dispatch` shape exactly |
| `factory-report` | **new** | `dispatch` and `drain` modes, Haiku, `p2_job_queue` (§8.6) |
| `work.html` | **new page** | Public, root level, no navbar, no auth. Marathi default. §4.3 |
| `production.html` | **new page** | Owner/supervisor: order list, detail, assignment, quality. `canAccess(role,'production')` — a new permission key in `js/roles.js` |
| `settings.html` | modified | New "Workers" tab (owner only) and the Factory OS switches |
| `js/roles.js` | modified | `production` added to `owner`, `supervisor` and `operator` (read-only for operator) |

### 11.11 Agent tools and read intents

Three new tools on the existing `propose` action, one field added to an existing tool, three new
read intents. All tools `strict: true`, `additionalProperties: false`, full `required` list —
`nexflow-agent.md` §3 D2's schema discipline, unchanged. The model emits **names and codes,
never identifiers** (D4), and code resolves them with the existing `findProductMatches()` /
`matchClientName()` helpers plus one new `matchWorkerName()`.

```
propose_production_order(product_name, quantity, due_date,
                         client_name?, notes?)
    — no owned_by: the pool is derived from the client (F6)
    — no movement_purpose: derived at dispatch, never stored (F6)
    — no materials array: the BOM is authoritative (nexflow-agent.md §5.3)

propose_work_assignment(order_ref,
                        assignments[{ worker_name, quantity?, due_date? }])
    — order_ref is the order number as the user said it ("PO-2609-0042", "the KPML
      motors", "today's KS4") — resolved code-side against open orders, and
      ambiguity becomes request_clarification, never a guess
    — quantity omitted on every entry means "split them sensibly" (§4.5)

propose_quality_check(order_ref, units_passed, units_failed,
                      defect_note?, disposition?, worker_name?, batch_ref?)
    — defect_note is REQUIRED by the DB when units_failed > 0; the tool asks for it
      rather than letting the insert fail

propose_dispatch(... existing fields ...,
                 production_order_ref?)        ← ONE new optional field
    — when present, F3 applies: no BOM expansion, close_wip, order → dispatched
    — when absent, byte-identical to today
```

**Read intents, added to `READ_ONLY_INTENTS` — the single source of truth in
`agent-query/index.ts`, 28 intents today `[VERIFIED]`:**

| Intent | Answers | Notes |
|---|---|---|
| `production_status` | *"How is the KPML order going?"* · *"What's open?"* | Reads `v_p2_production_order_status`. No model arithmetic |
| `delivery_estimate` | *"Can we do 50 KS6 by Friday?"* | §7. Refuses rather than extrapolates (§7.5) |
| `worker_load` | *"What is Ramesh working on?"* | Per-worker, **on request only** — never a screen, never in the report (§13.4, §17 Q8) |

**Adding an intent means four places, all in `agent-query/index.ts`:** the `HaikuIntent` union,
the system prompt, `executeQuery()`, and `READ_ONLY_INTENTS`. `agent-chat.js` needs no copy —
every intent is read-only and is displayed identically `[VERIFIED]`.

**The write system prompt gains one paragraph**, not a section:

```
A production order is a plan, not a transaction. Creating one moves nothing.
Material only leaves the store when someone confirms an issue, and goods only
leave the factory when someone confirms a dispatch. Never say material has been
issued because an order was created.
```

### 11.12 Migration order

One file, applied **via the Supabase SQL Editor, never `supabase db push`** — the standing rule,
because push replays old migrations.

```
20261201_factory_os.sql
  1. CREATE TABLE p2_workers
  2. CREATE TABLE p2_production_orders
  3. CREATE TABLE p2_production_assignments
  4. CREATE TABLE p2_production_progress
  5. CREATE TABLE p2_quality_records
  6. ALTER TABLE ... ENABLE ROW LEVEL SECURITY   (all five, in THIS file)
  7. CREATE POLICY ×13
  8. CREATE INDEX ×16
  9. CREATE VIEW v_p2_production_order_status
 10. ALTER p2_dispatch_orders  ADD production_order_id  (+ index)
 11. ALTER p2_products         ADD standard_output_per_day
 12. ALTER p2_tenant_settings  ADD ×5
 13. Widen 3 CHECK constraints (§11.8)
 14. CREATE FUNCTION ×9        (§11.9 — the eight wrappers plus the number generator)
 15. GRANT EXECUTE ... TO authenticated;  REVOKE ALL ... FROM anon;
```

**Test tenant (`fe2b94fb-…`) first.** Then `node _ai/regression/snapshot.js` and diff against the
**most recent prior snapshot**, never `baseline-pre-2H.json` `[VERIFIED]`. This migration adds
only new objects and three nullable columns, so the diff must be empty; a non-empty diff means
something was already wrong before the session started.

**Verify the test tenant's `agent_tier` is still `'unlimited'` afterwards.** `CLAUDE.md`'s
standing check, and this migration touches `p2_tenant_settings`:

```sql
SELECT agent_tier FROM p2_tenant_settings
 WHERE tenant_id = 'fe2b94fb-9668-405f-9c62-5f54b32f8c7a';
```

**Never apply to SS Engineering, Datta Prasad or Shivprasad before the pilot decision.** All three
are live tenants and `CLAUDE.md`'s rule is absolute. The columns default to `false`, so applying
the migration is safe — but §12.5's pilot picks who gets switched on, and that is a conversation,
not a migration.

---

## 12. Build Sequence

### 12.1 Prerequisites

Four, and the first two block the build rather than the deployment.

| # | Prerequisite | Why | Blocks |
|---|---|---|---|
| **P1** | **`nexflow-agent.md` sessions 1–2** — `p2_agent_proposals`, `propose` / `confirm_proposal` / `cancel_proposal`, the closed-list confirmation matcher, the server-side role gate (D11) | Every Factory OS action is a tool on that protocol. Building a second confirmation mechanism here would be the third implementation of a pattern this codebase has already duplicated twice | **The whole build** |
| **P2** | **A6 — `p2_job_queue`** (`automation-strategy.md` §3.3) | §8's report is the second sequential-loop hazard and must never ship as a loop (F12, §0 C4) | §8 only — but §8 is half the product's daily value |
| **P3** | **A0 — the founder ops channel** | §15's founder-facing alerts are dead code without it. Same instruction `bridge-agent.md` §15 gives | §15's alerting only |
| **P4** | **Session 21 — network consent and scope** (`kpml-network-sessions-21-22.md`) | §9.3's RPC extends a scoped path that Session 21 completes with `scope`, `consented_at` and the generated visibility panel | §9 only |

**Session 28 (PO Push) is not a prerequisite.** §9.2 describes what Factory OS does *when* a PO
arrives; until it does, `source='principal_po'` is an unused code path and every other flow works.
Build it in the order that suits Session 28, not the reverse.

### 12.2 The minimum viable first version

**Production orders + workers + assignment + progress. No quality, no estimates, no daily report,
no network.** That is sessions 1 and 2 below, and it is a complete product on its own: it closes
the blind gap between issue and dispatch, and it is the first thing in Nexflow that a supervisor
uses rather than an accountant.

Deliberately **not** in the MVP, and why each can wait:

- **Quality** — a factory that does not record it today loses nothing by recording it a month
  later, and the gate defaults off anyway (F8).
- **Estimates** — need ≥ 10 production days of history to say anything (§7.5), so they are
  literally unusable in week one. Shipping them into an empty table teaches the owner the feature
  does not work.
- **The daily report** — the most visible feature and the most dependent on data quality. A report
  built on a week of half-entered progress is worse than no report.
- **Network integration** — needs Session 21 and a signed pilot.

The sequencing has a shape: **the MVP creates the data, and everything after it reads the data.**
Building a reader before there is anything to read is how a feature ships technically correct and
practically useless.

### 12.3 The sessions

**Six sessions to everything in this document. Two to the MVP.**

| # | Session | Output |
|---|---|---|
| **1** | **Orders + workers, English, owner-facing** | The whole §11 migration. `create_production_order`, `get_next_production_order_number`, `cancel_production_order`, `accept_production_order`. `propose_production_order` + the three new `kind` values. `production.html` list and detail. Settings → Workers tab. **End to end: one sentence creates a real production order on the test tenant, and the order list shows it.** |
| **2** | **Assignment + progress + the worker page** | `assign_production_work`, `record_production_progress`, `v_p2_production_order_status`. `propose_work_assignment`. `work-view` Edge Function and `work.html` with taps, the offline queue and `client_event_id`. §5.6's projection as one pure function. **End to end: a worker taps +5 on a phone and the owner's order list moves.** |
| **3** | **Material issue + output dispatch** | `start_production_order` over `confirm_bom_issue` v4. `confirm_production_dispatch` over `confirm_dispatch_transaction` + `close_wip`. `production_order_id` threaded through the dispatch path. **This is the session that touches stock, and F3 is its whole content** — the acceptance test in §18.2 is the gate. |
| **4** | **Quality + the gate** | `record_quality_check`, the dispatch gate (§6.2), the two deterministic thresholds (§6.3). Quality panel on `production.html`. |
| **5** | **The daily report + estimates** | `factory-report` with `dispatch`/`drain` on `p2_job_queue`, two crons, Haiku with the deterministic fallback. The `delivery_estimate`, `production_status` and `worker_load` read intents. The quiet-hours configuration check (§8.4). |
| **6** | **Marathi, mobile and the network** | `work.html` and every card through `tutorial-engine.md` §8.5's read-aloud gate with a real worker. `get_principal_vendor_production()` and the principal dashboard panel. The principal's consolidated query (§9.4). |

**Parallelisable:** nothing usefully. **Not negotiable:** session 1 before everything, and session
3 after session 2 — the dispatch path must not be built before there is progress data to gate it
on, or F3's acceptance test has nothing to assert against.

### 12.4 Where this sits in the roadmap

`CLAUDE.md`'s "What to build next" is a single 32-item sequence and **nothing in this document
displaces items 0, 1 or 2**, which carry a hard 5 October 2026 deadline and are a distribution
dependency (`business-strategy.md` §7.1), not an infrastructure nicety.

Factory OS sits **after the agent write layer**, which itself is `[RECOMMENDED]` for the Oct–Nov
block after Session T1 and before A1 (`nexflow-agent.md` §13.1). Concretely: items 33–38 in the
same sequence, after the write layer's six.

`[RECOMMENDED]` **Do not start Factory OS until the agent write layer has run on one live tenant
for thirty days.** Two reasons, and the second is the real one:

1. Every Factory OS action rides the write layer's confirmation protocol. A protocol bug found
   during a Factory OS pilot is two features debugged at once.
2. **The supervised month of the write-layer pilot is where the master-data problems surface**
   (`nexflow-agent.md` §10.4) — material names that nobody says out loud, 623 unaudited HSN codes,
   suppliers imported inactive. Factory OS needs *product* master data to be equally good, and the
   same visit fixes both.

### 12.5 The pilot

**One tenant, one production line, thirty days.** `[RECOMMENDED]` **Datta Prasad Enterprises**,
for the same reasons `nexflow-agent.md` §17 Q5 recommends them for the write layer: most data,
most volume, most documented data-quality problems, most to gain. Running both pilots on one
tenant also means one relationship carries the disruption instead of two.

The pilot is not a soft launch. It has an exit condition:

- Every production order's progress reconciles against a physical count of finished goods at the
  end of the month, or the gap is explained.
- The 7pm report is read. **Ask, and ask specifically — "what did Thursday's say?"** A report
  nobody reads is the failure mode this feature is most likely to have, and it is invisible in
  every metric.
- `nexflow-agent.md` §14.4's four instrumentation numbers are computed for Factory OS proposals
  too: supersession rate, clarification rate, cancel rate, confirmed-with-unresolved-warning. A
  cancel rate near zero is the alarming one, there and here.

---

## 13. The Honest Floor

What Factory OS genuinely cannot do. For each: why it is irreducible, what catches it afterwards,
what the owner sees and when.

### 13.1 It changes the shape of the error, it does not remove the error

The same framing `nexflow-agent.md` §14.1 applies to the write layer, and it is equally true here.

A paper system produces **missing** information: a progress figure nobody wrote down, a rejection
nobody recorded, a delay nobody mentioned until Friday. The gaps are visible as gaps.

Factory OS produces **complete-looking** information that may be wrong: a progress row saying 10
units were made, entered by a named worker at a timestamp, when 8 were made. There is no blank
field and no anomaly. **A self-reported number that nobody verified looks exactly like a verified
one.**

The net is strongly positive — a factory that records nothing cannot catch anything — but the
residue is qualitatively harder to spot, and it must be said to clients rather than discovered by
them. §13.6 is the reconciliation that makes the trade net-positive.

### 13.2 Physical quality problems

**Software can record that 2 motors were rejected for a loose winding. It cannot prevent the
winding being loose, cannot tell whether anyone actually inspected them, and cannot tell whether
"loose winding" is what was really wrong.**

*Catch:* the trend, not the event. Three rejections from one worker in seven days (§6.3) and a
product whose 30-day rate doubles are both computable and both appear in the 7pm report with the
verbatim notes. Neither prevents a single bad unit.

*What the owner sees, and when:* the ⚠ line, the evening it crosses the threshold. Not sooner —
there is nothing to see in one rejection.

*What no vendor should claim:* that a quality record is evidence the check happened. It is
evidence that a named person recorded a count on a date. That distinction matters the first time
KPML disputes a batch, and stating it up front is what makes the rest of the evidence pack
credible.

### 13.3 Supplier reliability

**If Bharat Electricals delivers late, Factory OS knows the stock is short and cannot make the
material arrive.**

It is worse than that, and the worse part is a schema fact rather than a limitation of ambition:
**Nexflow has no purchase-order receiving model.** `p2_client_po_numbers` is outbound
`[VERIFIED]`, there is no expected-delivery date anywhere, and there is no observed supplier lead
time to derive one from because a GRN records what arrived, never what was promised.

*Catch:* §7.5's refusal. When BOM material is short, the estimate **refuses to quote a completion
date at all** and says why. An agent that quotes a date silently assuming material arrives on
time is producing exactly the over-promise this feature exists to stop.

*What the owner sees, and when:* at the moment they ask for an estimate, and in the 7pm report's
"Tomorrow" line when the next order to start cannot start.

*What would fix it properly:* an inbound PO model — expected date, expected quantity, receipt
against it. That is a real feature, it is not in this document, and it should be built when a
client asks, not speculatively.

### 13.4 Worker motivation

**Factory OS can show that Sunil averages 9 units a day where Ramesh averages 12. It cannot make
Sunil faster, and it cannot tell you why he is slower.**

The gap between 9 and 12 might be skill, training, the machine he works on, the product mix he
gets, a bad back, or a family problem. **The data contains none of the explanations and every one
of them changes what the owner should do.**

*Catch:* there is no catch, because this is not an error. It is information handed to a human who
has context the software does not.

*What the owner sees, and when:* per-worker rates, on request, and only on request. **It is
deliberately not in the 7pm report.** A daily ranking of workers by output is a performance
management system arriving by accident, and F11 and §10 item 1 both exist to prevent that.

### 13.5 The machine, the power cut, and everything else on the floor

**Factory OS cannot see a CNC that stopped, a power cut, a jig that broke, or a worker who went
home at two.** It sees the absence of progress entries, hours later, and cannot distinguish
between "the machine is down" and "nobody tapped the button".

*Catch:* two, both weak and both honest. The `अडचण` (problem) button gives the worker one tap to
say something is wrong, which is immediate and depends entirely on them pressing it. And the
zero-progress flag fires after two consecutive working days with no entries on an active
assignment — which is two days too late for a power cut and about right for a jig nobody
mentioned.

*What the owner sees, and when:* the problem tap immediately, the zero-progress flag on the
evening of the second day.

### 13.6 A worker who reports what did not happen

**The number is self-reported and unverifiable at the moment it is entered.** A worker who taps
`+10` having made 8 has produced a clean, complete, wrong row — §13.1's failure in its purest
form.

*Catch, in order of reliability:*

1. **The quality check.** Someone counts the units to record passed and failed, and
   `record_quality_check` refuses a total that exceeds what was reported as produced
   (`EXCEEDS_PRODUCED`). A worker who over-reports creates a discrepancy the checker walks into.
2. **The dispatch.** Units that leave are counted onto a challan by a different person.
3. **The physical stock count** (`reports.html`, shipped Session 7 `[VERIFIED]`) — the backstop
   for everything physical, eventually.
4. **The WIP balance.** Material issued for 30 that produced 28 leaves a residue that
   `v_p2_wip_balance` carries until someone closes it.

*What the owner sees, and when:* nothing at entry. A discrepancy at the quality check, same day
or next. A residue at month end.

**The strongest defence is structural and it is F11.** As long as nobody's pay depends on the
number, there is no incentive to inflate it, and the observed error is carelessness rather than
fraud. Carelessness is caught by the quality check. **Fraud would not be, and that is the entire
argument for never computing pay.**

### 13.7 The gap nobody closes: nothing forces a reconciliation

`nexflow-agent.md` §14.3 makes the same observation about physical stock and it applies here with
more force. Every *financial* error in this product has a monthly forcing function — the filing
deadline, the GSTR-2B upload, the Opus covering note on the 5th. **Production has none.** An
order can sit `in_progress` at 28 of 30 forever; a worker can stop reporting; a quality check can
never be recorded.

`[RECOMMENDED]` **A weekly production reconciliation line in the Monday report**, using the rails
that already exist: for every order older than 30 days that is not `dispatched` or `cancelled`,
one line naming it and its age. No new infrastructure — it is one more section in a report that
already runs. One line a week, and it closes the only structural gap in the operational catch set.

---

## 14. Pricing

### 14.1 The corrected ladder

§0 C5. The brief's Tier 1 is the **Enterprise** tier. Restated against
`enterprise-strategy.md` §7 and `business-strategy.md` §2.3, with both base paths priced:

| | **Base** | **+ Agent** | **+ Factory OS** |
|---|---|---|---|
| **Pro path** (no Bridge Agent) | ₹1,25,000–1,50,000/yr | + ₹75,000 = **₹2,00,000–2,25,000** | + ₹1,25,000 = **₹3,25,000–3,50,000** |
| **Enterprise path** (with Bridge Agent + filing package) | ₹1,60,000–2,00,000/yr | + ₹75,000 = **₹2,35,000–2,75,000** | + ₹1,45,000 = **₹3,80,000–4,20,000** |

`[RECOMMENDED]` **The Factory OS module is ₹1,25,000–1,45,000/year**, which lands the Enterprise
path inside the brief's ₹3,60,000–4,20,000 band and gives the Pro path — a proprietor with no
Tally — a real number at ₹3,25,000.

**Monthly framing:** ₹27,000–35,000/month depending on path. The brief's ₹35,000 is the top of the
band and belongs to an Enterprise client, not to everyone.

**Setup: ₹25,000 one-time, and do not discount it.** It buys the worker master, the
`standard_output_per_day` pass over the top twenty products, the first week of supervised
proposals, and one on-site session where the owner watches a real worker use `work.html` on their
own phone. `business-strategy.md` §2.5 and `nexflow-agent.md` §10.4 both say the same thing about
the setup fees that already exist: **it is not margin, it buys the week that prevents the
expensive failure.**

### 14.2 What it costs to serve — compute

At Haiku 4.5 ₹0.090/₹0.450 per 1K tokens, ₹90/USD (`nexflow-agent.md` §9's table, **not** the
brief's figures).

| Interaction | Model | Per unit | Busy tenant/month | Cost/month |
|---|---|---|---|---|
| Create a production order | Haiku | ₹0.61 | 25 | ₹15 |
| Assignment proposal | Haiku | ₹0.65 | 30 | ₹20 |
| **Progress — a tap** | **none** | **₹0.00** | **420** | **₹0** |
| Progress — a dictated sentence | Haiku | ₹0.09 | 180 | ₹16 |
| Quality record via the agent | Haiku | ₹0.60 | 30 | ₹18 |
| Delivery estimate (read intent) | Haiku | ₹0.35 | 20 | ₹7 |
| Daily report | Haiku | ₹0.38 | 26 | ₹10 |
| **Factory OS total** | | | | **≈ ₹86** |

**Factory OS adds roughly ₹90/month to a busy tenant already spending ₹1,000/month on the agent
write layer** — a **9% increase in compute for what the brief prices as a 50%+ increase in
subscription.** That is not a rounding error argument being smuggled back in; it is the direct
consequence of F5. The highest-volume interaction in the product — 420 taps a month — has no
model in its path at all.

**Across a book of 100 tenants on Tier 3: ₹8,600/month of Factory OS compute.** Against
`business-strategy.md` §3.1's ₹1,11,510 total cost at 100 clients, it is 7.7% of cost and **0.3%
of revenue.**

### 14.3 Margin at 50, 100 and 500 Tier-3 clients

A book where every client is on Tier 3 (Enterprise path, ₹3,80,000/yr ≈ ₹31,667/month), the agent
write layer at busy volume (₹1,100/month each, `nexflow-agent.md` §9.4), and Factory OS at ₹90:

| Clients | Revenue/mo | Base cost (§3.1) | Agent compute | Factory OS | Total cost | **Margin** |
|---|---|---|---|---|---|---|
| **50** | ₹15,83,333 | ₹52,750 | ₹55,000 | ₹4,300 | ₹1,12,050 | **92.9%** |
| **100** | ₹31,66,667 | ₹1,11,510 | ₹1,10,000 | ₹8,600 | ₹2,30,110 | **92.7%** |
| **500** | ₹1,58,33,333 | ₹1,85,810 | ₹5,50,000 | ₹43,000 | ₹7,78,810 | **95.1%** |

**All three clear 90% comfortably**, which answers the brief's constraint. Two honest caveats:

- **The 100-client column includes the Supabase Team step** (₹53,910/month), which
  `business-strategy.md` §3.4 shows is what makes the *blended* margin curve dip at 100. On an
  all-Tier-3 book the revenue is three times higher, so the step is absorbed and the dip does not
  appear. **Do not use this table to argue the general margin curve is wrong** — it describes a
  book that does not exist yet.
- **A real book is mixed.** These columns are the answer to "what does Tier 3 do to margin",
  not a forecast.

### 14.4 The sales conversation, corrected

The brief's arithmetic is right and its premise is wrong (§0 C6). Both halves matter.

**The arithmetic, and it is better than the brief claims.** ₹18,000 + ₹15,000 + ₹30,000 =
₹63,000/month of stated salary. Fully loaded — PF, ESI, bonus, a seat, a PC — an Indian
manufacturing employer runs **1.25–1.35×** that, so the real number is **₹79,000–85,000/month**.
Against ₹31,667 for Tier 3, the saving is **₹47,000–53,000/month, ₹5.6–6.4 lakh a year** — nearly
double the brief's ₹3,36,000. Quote the loaded figure and quote where it comes from; an owner
knows their own PF liability and will trust the number more, not less, for being higher.

**The premise, and this is the part to get right.** Do not say "replace three people". Say:

> *"You are paying about ₹80,000 a month for three people, and about half of what they do is
> writing things down and telling each other what to do. Nexflow does that half. What you get back
> is a supervisor who spends their day on the floor instead of on the register — and if you want
> to run leaner after six months of watching it work, that will be your call with real numbers in
> front of you, not mine now."*

Three reasons this closes better than the brief's version, and the third is the one that matters:

1. **It survives month two.** A factory that fires a supervisor on a software promise and finds
   nobody watching the floor churns angrily and talks.
2. **It moves the objection.** "My people won't use it" is easier to answer when nobody's job is
   the subject of the sentence.
3. **It protects the data.** A workforce that believes the software is there to replace them does
   not report honestly into it — and every number in §7, §8 and §9 depends on honest reporting.
   **The pitch that promises redundancy destroys the product it is selling.**

### 14.5 The real constraint is founder hours, not compute

`enterprise-strategy.md` §7 reached this about the Bridge Agent — *"compute is 0.4% of the add-on
price. Support is 85% of it"* — and it is truer here.

| Cost to serve, per Tier-3 client per year | Amount |
|---|---|
| Factory OS compute | ₹1,030 |
| Agent write layer compute | ₹13,200 |
| **Founder time — setup, worker onboarding, the supervised first month, threshold tuning** | **6–10 hours ≈ ₹12,000–20,000** `[UNVERIFIED — §17 Q5]` |
| **Total** | **₹26,000–34,000** against ₹3,80,000 of revenue |

**Selling a supervisor replacement requires a supervised setup, and one founder cannot do a
hundred of them.** At 8 hours per client, 100 Tier-3 clients is 800 hours a year — five months of
full-time work, against a founder whose existing automated-ops load is already 63.5 hrs/month at
500 clients (`automation-strategy.md` §8.4).

`[RECOMMENDED]` **Cap Tier 3 at 25 clients until the support load is measured**, exactly as
`enterprise-strategy.md` §7 caps Enterprise, and for exactly the same reason. Instrument it from
the first client: hours per onboarding, support contacts in month one versus month three,
how many tenants ever change a threshold. **After ten clients, replace the estimate with the
measured number** and write it back into this section. The cap should be lifted or lowered on
data, not on optimism.

### 14.6 Who gets it, and who does not

| | Factory OS |
|---|---|
| **Lite** | **Never.** No agent at all (`plan='lite'` → limit 0) and no write layer (`nexflow-agent.md` D10) |
| **Demo tenant** | **Never.** `agent_enabled = false` and it stays that way |
| **Pro / Founder / Enterprise** | Yes, as a paid add-on, `factory_os_enabled` off until the owner turns it on |
| **SS Engineering** | Free, permanently, like everything else `[DECIDED — CLAUDE.md]`. They are also **Type A**: `is_job_worker` gating and the pool logic must be invisible to them (§18.6) |
| **Datta Prasad** | `[RECOMMENDED]` the pilot tenant, free for six months, priced at renewal (§12.5). Same recommendation `nexflow-agent.md` §17 Q5 makes, same reasoning |
| **Shivprasad** | After the pilot. Their product and price data are still incomplete `[VERIFIED]` |
| **A principal (KPML)** | **Not applicable.** A principal does not run production. They consume §9's read surface, which is part of the platform fee |

---

## 15. Failure Mode Analysis

Every way this fails, what the system does, what the **owner or worker** sees, and what the
**founder** sees on A0. Severity vocabulary is A0's: `critical` bypasses quiet hours, `important`
and `monitor` do not.

| # | Failure | System does | User sees | Founder sees |
|---|---|---|---|---|
| 1 | Worker taps with no signal | Queued in `localStorage`, card updates locally, POSTed on reconnect | Nothing — the count moved | Nothing |
| 2 | Worker double-taps | `client_event_id` unique violation → returns the first result | One increment | Nothing |
| 3 | Worker's token is wrong or rotated | 404 shape, same as `receive.html`'s | *"This link is not valid any more. Ask for a new one."* | Nothing |
| 4 | Worker's link is forwarded to someone else | Nothing — it works for them | — | `monitor` if one token exceeds the rate limit (§4.4) |
| 5 | Worker reports against a cancelled order | Refused | *"This job was cancelled. Check with your supervisor."* | Nothing |
| 6 | Worker reports more than assigned | **Accepted.** Over-production is a fact, not an error | The count, above the assigned figure | Nothing — it appears in the 7pm report |
| 7 | `start_production_order` hits `INSUFFICIENT_STOCK` | Nothing written, order stays `planned` | The RPC's own message, naming material, pool and both numbers | Nothing — the gate working |
| 8 | `start_production_order` hits `DUPLICATE_ISSUE` | Nothing written | *"A batch of 30 KS4 was already issued today. If this is a second batch, change the quantity or issue it tomorrow."* §3.4 | `monitor` if it fires more than 3×/week for one tenant — the §17 Q3 signal |
| 9 | BOM issue succeeded, order row update failed | **Impossible** — one transaction (F3) | — | — |
| 10 | Dispatch confirmed, `close_wip` failed | **Impossible** — one transaction | — | — |
| 11 | `close_wip` raises `WIP_EXCEEDS_BALANCE` | Nothing written | *"The work-in-progress for this order was already closed by hand. Nothing has been dispatched."* | `monitor` |
| 12 | Dispatch requested above `dispatchable` | No proposal | §6.2's card with all three numbers | Nothing |
| 13 | Two supervisors assign the same order at once | Row lock in `assign_production_work`; second sees the first's result | *"Ramesh already has 15 of these. Sunil can take 15."* | Nothing |
| 14 | Haiku fails writing the daily report | Deterministic bullet list sent instead | A plainer report | `monitor`, batched weekly |
| 15 | `notify` fails or quiet hours suppress it | `p2_notifications` row stays; in-app bell still shows it | The bell, not Telegram | `monitor`. §8.4's config check should have prevented the quiet-hours case |
| 16 | A `factory-report` job hits `max_attempts` | `dead` in `p2_job_queue` | No report that evening | **`critical`** — a tenant silently got nothing, which is the failure A6 exists to make visible |
| 17 | The dispatcher cron did not run | No jobs enqueued, no reports at all | No report, for everybody | **`critical`** via A3's cron heartbeat check (`automation-strategy.md` §4.3) — **not** by anything in this feature |
| 18 | Estimate asked with no history | No date quoted | §7.5's refusal, naming what would fix it | Nothing |
| 19 | A worker is deactivated with an active assignment | Assignment flips to `reassigned`, token rotated in the same action | Owner is told which orders now have unassigned units | Nothing |
| 20 | Progress recorded for a worker who left | Accepted if the worker row is still active; refused after deactivation | *"Sunil is no longer active."* | Nothing |
| 21 | Principal RPC returns a vendor's own production | **Impossible** — the join starts from `owned_by = vc.id` (§9.3) | — | **`critical`** if ever observed. It means a scope filter was removed |
| 22 | Worker name appears on a principal surface | Should be impossible (F10) | — | **`critical`** if ever observed |
| 23 | A tenant turns Factory OS on with no workers | Orders work, assignment is unavailable, progress is supervisor-entered | *"Add workers in Settings to assign work."* Everything else functions | Nothing — this is a legitimate configuration |
| 24 | 30 days of `proposed` orders nobody accepted | Swept to `cancelled` with a reason (§3.2) | One line in the report the day they expire | `monitor` if more than 20 expire at once — the principal is pushing work the vendor is not taking, which is a commercial signal worth a phone call |
| 25 | Progress stops entirely for a week on an active order | Zero-progress flag, then the weekly reconciliation line (§13.7) | Report lines on day 2 and every Monday | Nothing |
| 26 | Order `in_progress` for 90 days | §13.7's weekly line | One line, weekly | `monitor` after 120 days — this tenant has stopped using the feature properly and that is a churn signal |

**Rows 21 and 22 are the ones to design against.** They are the only two where the system does
something structurally forbidden rather than something merely wrong, and both are cross-tenant.
Everything else on this list is recoverable by a human within a day.

---

## 16. Explicitly Out of Scope `[NEVER]`

Permanent. Not a backlog, not gated on a client asking.

1. **Any write without an explicit confirmation of a specific, server-computed plan** —
   inherited unchanged from `nexflow-agent.md` §16 item 1, including its named forbidden forms:
   batch confirmation, an "always confirm" setting, auto-confirm above a confidence threshold,
   and any learned trust model. F2 defines exactly which Factory OS actions are ledger writes and
   is the only place that boundary is drawn.
2. **Auto-issuing material.** No cron, no schedule, no "start tomorrow's orders at 8am". Stock
   leaves the store only when a human confirms a specific plan. **This one will be proposed again
   — it is the obvious next feature and it is wrong every time.**
3. **Pay, piece rates, wages, attendance, overtime computation, or any per-worker earnings
   figure.** F11. No column a payroll system could join to, no export, no report.
4. **Worker performance ranking as a product surface.** Per-worker rates exist as an input to
   estimates and are available on request. There is no leaderboard, no score, no daily ranking,
   and none in the 7pm report. §13.4.
5. **Any worker identity crossing a tenant boundary.** F10. Not a name, not a count, not an
   anonymised id that could be correlated across orders.
6. **A quality management system.** No ISO surface, no CAPA, no inspection plans, no AQL sampling,
   no certification tracking, no audit trail formatted for an assessor. Pass/fail with a free-text
   note, and §6.1's list of what that deliberately excludes.
7. **Creating master data** — workers included. The agent proposes transactions against masters
   that exist and never creates a worker, product, client, supplier or BOM. `nexflow-agent.md`
   §11 item 3, extended to `p2_workers` for the same reasons.
8. **Machine, sensor, IoT or PLC integration.** No shop-floor hardware, no OEE, no downtime
   capture. It is a different product with a different installation model and a different support
   surface, and §13.5 is honest about what its absence costs.
9. **Scheduling.** No Gantt, no finite-capacity scheduler, no sequencing optimiser, no
   drag-and-drop board. Factory OS records what is committed and projects when it will be done;
   deciding the sequence is §10 item 5 and belongs to a human.
10. **Editing or deleting a progress or quality row.** Both tables have no UPDATE and no DELETE
    policy (§11.4, §11.5). A correction is a new row.
11. **Reversing stock on a cancelled order.** §3.7. The material is physically gone; a software
    reversal would credit stock that is sitting on a bench.
12. **Setting `p_force = true` on `confirm_bom_issue`**, or any other override of a stock
    sufficiency check. Inherited from `nexflow-agent.md` §16 item 8.
13. **A quality-gate override flag.** F8. With the gate on, the only way to dispatch an unchecked
    unit is a quality record that passes it.
14. **Inbound goods inspection.** Rejecting a supplier's delivery is a different event against a
    GRN — Session 29, gated on a named request. §6.5.
15. **Autonomous or scheduled proposals.** No cron creates a proposal. The single exception is a
    principal's PO creating `proposed` **orders**, which are planning rows that move nothing and
    require a human tap to become real (F2, §9.2).

---

## 17. Open Questions

Each needs a decision or a measurement **before** the session named.

### Blocking session 2 (the worker page)

**Q1. Does a worker actually use `work.html`, unprompted, without being asked to?**
`[UNVERIFIED]` — **the single most important measurement in this document.** Every number in §5,
§7, §8 and §9 is downstream of a worker tapping a button. If adoption is low, Factory OS degrades
to a supervisor-entered system, which is still useful and is a different product with a different
price.
**Resolve:** at the pilot tenant, give **three** workers the link, do not train them beyond one
sentence, and measure two things for thirty days: the share of production days on which each
worker logged at least one entry, and the share of total units that arrived by worker tap versus
supervisor entry.
**Gate:** above 60% of units by worker tap, the feature is what this document says it is. Below
30%, **reprice and repitch it as a supervisor tool** and stop describing worker self-reporting as
a feature.
**Decide before:** session 6's Marathi work, and before the first Tier-3 sale.

**Q2. The Marathi on the worker page.** `[UNVERIFIED]`
`work.html` is the surface in the whole product whose user is least likely to read English, and
`tutorial-engine.md` ADR-12's rule is absolute: **wrong Marathi is worse than English**, because
the user cannot tell it is wrong until they have acted on it.
**Resolve:** `tutorial-engine.md` §8.5's read-aloud gate — one real worker, one real ₹8,000 phone,
the real page, in the factory, with the noise. Ask them to report ten units and watch. Anything
they hesitate over comes out.
**Decide before:** session 6. Until then the page ships with digits and icons, English words, and
no dictation box (§5.3's gate is `nexflow-agent.md` §17 Q8, inherited).

### Blocking session 3 (material issue)

**Q3. Does `confirm_bom_issue`'s `DUPLICATE_ISSUE` guard block real second batches?**
`[UNVERIFIED]` — §3.4. The guard matches on product + batch quantity + issue date, and Factory OS
never sets `p_force`. A factory running two identical batches of 30 on one day is blocked.
**Resolve:** ask Datta Prasad and SS Engineering directly — *"do you ever issue the same quantity
of the same product twice in one day?"* Then count it:
```sql
SELECT dispatch_date, challan_note, count(*)
  FROM p2_dispatch_orders
 WHERE tenant_id = :t AND dispatch_type = 'bom_issue' AND status <> 'cancelled'
 GROUP BY 1,2 HAVING count(*) > 1;
```
**If it happens:** add `p_production_order_id` to a `confirm_bom_issue` **v5** so the duplicate
check scopes to the order — with a `DROP FUNCTION` on the stale overload first, the overload
hazard this codebase has been bitten by twice `[VERIFIED — Steps 2G and 2M]`. **Never by setting
`p_force`.**
**Decide before:** session 3 starts.

**Q4. Is `confirm_dispatch_transaction` with `p_consumption_json = '[]'` safe in production, not
just by inspection?** `[UNVERIFIED]`
Reading the function body says yes — both loops iterate zero times and the header flips to
`confirmed` (§3.5). That is inspection, not evidence, and this is the path that decides whether
stock is deducted twice.
**Resolve:** on the test tenant, build a production order end to end, dispatch its output, and
assert: exactly **one** set of consumption rows exists for the batch, `v_p2_stock_balance` moved
exactly once, `v_p2_wip_balance` returned to zero, and the challan is a normal Rule 55 challan.
This is acceptance test §18.2 item 5 and it is the gate on session 3.
**Decide before:** any Factory OS dispatch reaches a live tenant.

### Blocking pricing

**Q5. How many founder hours does a Factory OS client actually take?** `[UNVERIFIED]`
§14.5 estimates 6–10 hours per client per year and the 25-client cap rests on it. It is a guess.
**Resolve:** instrument from the first client — onboarding hours, support contacts in month one
versus month three, threshold changes. **After ten clients, replace the estimate with the measured
number** and rewrite §14.5.
**Decide before:** the 10th Tier-3 sale.

**Q6. Is ₹1,25,000–1,45,000 the right module price?** `[RECOMMENDED, not decided]`
§14.3's margins clear 90% with room, so the constraint is willingness to pay, not cost.
**Resolve:** in the pilot's month three, ask the owner directly what the coordination half of a
supervisor's job is worth to them. An owner who has used it for ninety days gives a better number
than any model.
**Decide before:** the first Tier-3 quote.

### Design, resolvable in-session

**Q7. Should partial material issues be supported in v1?** `[RECOMMENDED: no]` — §3.4.
A factory issuing half a batch on Monday and half on Thursday is real, and supporting it needs
`quantity_issued` tracking, a many-to-one issue link and a rule for what a partial issue does to
WIP. **Resolve by asking the pilot tenant how they actually issue**, and build it in session 3
only if the answer is "in parts, always."
**Decide before:** session 3's schema is final.

**Q8. Does the owner want a per-worker view at all?** `[RECOMMENDED: on request only]` — §13.4,
F11.
The data exists. Surfacing it as a screen is one afternoon and it changes what the product is.
**Recommendation: build no worker-performance screen.** Answer the question when asked, in the
chat, as a read intent. Revisit only if an owner asks twice.
**Decide before:** session 2's UI work, because a screen is much harder to remove than to not
build.

**Q9. What happens to an order when its product's BOM changes mid-flight?**
The BOM is read at issue time and never again, so an order issued last week consumed the old
recipe and is unaffected — which is correct. But an order in `planned` will consume the *new*
recipe when it starts, and the card that was shown at creation named the old materials.
**Recommendation:** re-expand the BOM at issue time (which the design already does) and, when it
differs from what was shown at creation, say so on the issue card: *"This recipe changed since
the order was created — copper wire is now 0.30 kg per unit, was 0.25."* One comparison, and it
prevents the only silent version of this.
**Decide before:** session 3.

**Q10. Should a production order be creatable from the dispatch side — "we shipped 30, record the
production"?** `[RECOMMENDED: no]`
It is the natural request from a factory backfilling history, and it inverts the whole model: a
production order that appears after its own dispatch has no material issue, no progress and no
quality record, and it would pollute every rate in §4.6 and §7.3 with a single-day burst that
never happened.
**Decide before:** the first client asks — and the answer is that history is backfilled by
dispatches without production orders, exactly as it works today.

---

## 18. Acceptance Tests

Factory OS is done when every one of these passes on the test tenant
(`fe2b94fb-9668-405f-9c62-5f54b32f8c7a`). Run the whole list before the first live tenant, and
again before any release that touches a wrapper RPC, the progress path, or a principal-facing
surface.

### 18.1 The planning boundary (F2)

1. Creating a production order writes **zero** rows to `p2_stock_transactions`,
   `p2_dispatch_orders`, `p2_dispatch_items`, `p2_wip_transactions` and `p2_invoices`. Snapshot
   before and after; assert byte equality.
2. A `proposed` order created from a principal PO writes nothing else either, and cannot be
   started until it is accepted.
3. `start_production_order` **cannot** be reached without a confirmed proposal. Assert there is no
   code path from a `propose` response to it.
4. A `propose` turn for any Factory OS action makes exactly one Anthropic call; the matching
   confirm makes **zero**. Instrument the client.

### 18.2 The consumption invariant (F3) — the headline test

5. **One production order, end to end, consumes its BOM exactly once.** Create → issue → progress
   → quality → dispatch. Assert: exactly one set of negative `consumption` rows for the batch;
   `v_p2_stock_balance` moved exactly once and by the right amount; `v_p2_wip_balance` returned to
   zero; the challan is a valid Rule 55 challan with a real number.
6. A dispatch with `production_order_id IS NULL` behaves **byte-identically** to today — same
   consumption rows, same challan, same stock movement. Compare against a pre-migration capture.
7. A production order dispatched in two parts closes WIP twice, totalling the full quantity, and
   flips to `dispatched` only after the second.
8. Cancelling an order after issue reverses **no** stock, and the card says so.

### 18.3 Progress and idempotency

9. The same `client_event_id` posted twice writes one row and returns the first result.
10. Fifty taps fired in the same tick from one phone produce fifty rows with fifty distinct ids
    and one row per id.
11. A tap made offline and replayed after reconnection writes exactly once.
12. A progress row's `progress_date` is the **IST** date. Run one at 01:00 IST and assert it is
    today's IST date, not yesterday's UTC date.
13. A negative progress row without a note is **rejected by the CHECK constraint**.
14. `p2_production_progress` rejects an UPDATE and a DELETE from an authenticated session — there
    is no policy for either.
15. The row that crosses `quantity_ordered` flips the order to `completed` in the same
    transaction.

### 18.4 Assignment and workers

16. Assigning more than the order quantity is refused with both numbers.
17. Two simultaneous assignments of the same order produce one consistent result. Fire both in the
    same tick.
18. A second active slice for the same (order, worker) is rejected **by the partial unique index**,
    not by application code.
19. Reassignment leaves the original slice at `status='reassigned'` with its progress intact.
20. A worker's token returns **only** that worker's active assignments. Assert the response
    contains no stock figure, no price, no client name, no other worker and no material list.
21. A rotated token 404s immediately; the new one works.
22. A deactivated worker's token 404s.

### 18.5 Quality and the gate

23. With `quality_gate_enabled = true`, dispatching more than `SUM(units_passed)` is refused with
    all three numbers.
24. With the gate false, the same dispatch proceeds.
25. `units_failed > 0` with an empty `defect_note` is rejected by the CHECK constraint.
26. A quality record whose passed + failed exceeds produced units raises `EXCEEDS_PRODUCED`.
27. Three rejections by one worker in seven days produce exactly **one** ⚠ line in the report, not
    three.

### 18.6 Isolation, roles and Type A

28. A `propose` or `confirm` carrying another tenant's `tenant_id` is refused 401 by
    `verifyCallerTenant`.
29. `p2_workers`, `p2_production_orders`, `p2_production_assignments`, `p2_production_progress`
    and `p2_quality_records` are all unreadable cross-tenant. Query as tenant B for tenant A's
    rows; expect zero from every one.
30. An `operator` can view production and **cannot** start an issue, assign work, record a quality
    check or dispatch — each refused **server-side**, before the model call. Assert zero Anthropic
    calls on the refused paths.
31. A Lite tenant's Factory OS surfaces are absent, and a direct POST with a Factory OS tool is
    refused.
32. `get_principal_vendor_production()` called by a **non-principal** returns empty, never an
    error.
33. `get_principal_vendor_production()` returns **no** row where `owned_by` is NULL or belongs to
    another principal. Plant one of each on the test tenant and confirm both are absent.
34. The principal RPC's result contains **no worker field of any kind** (F10). Inspect the
    returned column list, not just the values.
35. **The Type A test.** On a copy of SS Engineering's data, with `factory_os_enabled = false`:
    material list, stock balances, CA export, Tally export, GSTR-2B buckets, challan PDFs, invoice
    PDFs and a fixed set of agent stock answers are **byte-identical** before and after the
    migration. *Any difference means the change is wrong, not that the test needs updating*
    (`kpml-network-plan.md` §2).

### 18.7 The report and the queue

36. The dispatcher enqueues exactly one job per eligible tenant and **writes no reports**.
37. Running the dispatcher twice enqueues nothing the second time (`dedupe_key`).
38. Two drain invocations firing simultaneously never claim the same job (`FOR UPDATE SKIP
    LOCKED`).
39. With the Anthropic key removed, every tenant still receives a deterministic report.
40. A tenant whose `daily_report_hour` falls inside their quiet hours **cannot be saved** in
    Settings, and the error names both values.
41. Every number in a generated report is reproducible from SQL alone. Pick one report, recompute
    all six sections by hand, assert equality — **the model wrote no number.**

### 18.8 Regression

42. `node _ai/regression/snapshot.js` diffed against the most recent prior snapshot shows **no**
    change attributable to the migration.
43. The read layer's 28 intents behave identically. Factory OS must not alter a single existing
    answer.
44. The test tenant's `agent_tier` is still `'unlimited'` after the migration. `CLAUDE.md`'s
    standing check — run it explicitly.

---

*Last updated: 13 September 2026. Design complete; no code written.*
*This is a living document. As it is built, move `[RECOMMENDED]` to `[DECIDED]`, close open
questions, and replace every `[UNVERIFIED]` with a measured number — the same convention
`enterprise-strategy.md`, `automation-strategy.md`, `bridge-agent.md` and `nexflow-agent.md` all
use. §17 Q1's worker-adoption measurement and Q5's founder-hours figure in particular must be
written back here the day they are taken: the first decides what this product is, the second
decides how many clients it can have.*
