# Nexflow — Job Work Network Strategy & Build Plan
*Nexflow Automations · Single source of truth · August 23, 2026*

> Supersedes all earlier versions of this plan. Incorporates the full critique in
> `kpml-network-critique.md`, the job work confirmation from Shivprasad's material list and KPML's SAP
> purchase order, and the generic product model decision.
>
> **Load order for a new session:** `CLAUDE.md` → this file → `kpml-network-critique.md` (for the
> reasoning behind every decision here).

> **Sept 2026 update:** SS Engineering, Datta Prasad Enterprises, and Shivprasad Industries are all
> live as KPML job workers on Nexflow. One-sided mode (Step 5) is no longer the first KPML
> deliverable — the priority is a read-only principal dashboard showing KPML their material across
> all three vendors. See Section 16 for revised timeline.

> **Sept 4 2026 update — Sessions 1–4 complete.** Infrastructure is done.
> All RLS policies fixed, ownership layer working, principal pool GRN built.
> Three KPML vendors (SS Engineering, Datta Prasad, Shivprasad) live with real data.
> One critical bug remaining: return dispatch deducts from wrong pool (see open items).
> Next build target: KPML read-only principal dashboard (October 2026).
> Revised timeline: dashboard Oct → KPML meeting Nov → pilot Dec.

---

## 1. The Core Insight

This is not an inventory software problem. It is a **job work compliance and trust problem**, and the
compliance half is what makes it a business.

Every KPML vendor keeps their own records independently. KPML keeps theirs in SAP. Neither side can prove
anything to the other, so every month ends in a reconciliation argument that nobody can win with
evidence. That is the visible problem.

The invisible problem is larger. **Under Section 143 of the CGST Act, KPML never stops owning the
material they send out.** They carry the statutory obligation to account for it, the one-year return
clock on every challan, the deemed-supply liability if it breaches, and the ITC-04 filing. Their vendors
hold that material physically and have no system that even distinguishes it from their own stock.

Nexflow, implemented correctly across a network, produces **one set of records both sides can stand
behind** — and produces it as a by-product of work the vendor was doing anyway. That is a category shift,
not a feature.

**The line that explains the product in one sentence:**

> *You don't need a separate rack. You need a separate ledger.*

Commingling a principal's material with your own in the same physical store is legally permitted. What is
required is **separate records** — and separate records is exactly what no factory in this cluster
currently has.

---

## 2. The Product Model — Four Client Types *(non-negotiable)*

Nexflow is **not** built for KPML. KPML is the first target network. The product must serve four client
types in one codebase, one schema, with zero customer-specific logic anywhere.

| Type | Who | What they do | Network role |
|---|---|---|---|
| **A — Standalone** | SS Engineering | Buys material, makes product, sells independently | None |
| **B — Job worker** | Shivprasad, Datta Prasad | Holds a principal's material under s.143 **and** buys their own; one or many principals | Job worker |
| **C — Principal** | KPML, Godrej, TATA, any MIDC factory | Sends material to job workers, receives finished goods | Principal |
| **D — Hybrid** | Future clients | Job work for one or more principals **and** independent selling from own stock | Both |

### The Type A guarantee — the hardest constraint in this document

**SS Engineering must be completely unaffected by every feature in this plan.**

The guarantee is specific and testable:

- **Schema:** all new attributes are nullable or defaulted. NULL ownership = "mine". Movement purpose
  defaults to `sale`. Invoice type defaults to `goods_sale`. No backfill, no NOT NULL, no migration on any
  live tenant.
- **UI:** two switches (*"do you do job work for another company?"*, *"do you send material out to job
  workers?"*), both default **off**. Off means no ownership columns, no pool selectors, no principal
  fields, no job work navigation, no s.143 panel. **And no upsell** — a standalone client should not learn
  these features exist.
- **Verification:** a written acceptance test run against a copy of a standalone tenant's data, before and
  after, asserting **byte-identical** output for: material list, stock balances, CA export, Tally export,
  Zoho export, GSTR-2B reconciliation buckets, challan PDFs, invoice PDFs, and a fixed set of agent stock
  questions.

> **Any difference means the change is wrong — not that the test needs updating.**

SS Engineering is client one, live, and free permanently. Breaking them is the worst commercially
available outcome in this entire plan.

### Roles are per-relationship, not per-tenant

A tenant is not "a mother factory" or "a vendor." SS Engineering could be a job worker for KPML **and**
send material out to a plating shop, simultaneously. Role is a property of each **link**, never of the
tenant. This kills any tenant-level "mother factory" flag and any pricing tier that assumes one.

---

## 3. The Current Pain

### From KPML's side (Type C — the principal)

**Statutory exposure they cannot see or discharge:**
- s.143(2) places the obligation to keep proper accounts of material sent for job work **on KPML**, not on
  the vendor. They carry it today with no system for it.
- Every challan runs a clock — one year for inputs, three for capital goods. On breach the dispatch is a
  **deemed supply on its original date**, with GST plus 18% interest running retrospectively. Nobody is
  counting.
- ITC-04 must reconcile to the challan register and to GSTR-1. It is compiled by hand.
- Under **Section 43B(h)**, job work charges owed to Udyam-registered Micro/Small vendors and unpaid past
  45 days on 31 March are **disallowed as an income tax deduction**. KPML's CA is already tracking this
  manually, on a spreadsheet, badly.

**Operational blindness:**
- No real-time view of their own material at any vendor — must call, wait, get wrong numbers.
- Cannot tell scrap from theft, because there is no agreed yield and no declared scrap figure.
- Dispatch to 30+ vendors is paper challans and driver signatures with no confirmation loop.
- Receiving finished goods is manual; storekeeper and accountant reconcile different records.
- Vendor payments cannot be processed until three people agree three registers. Takes days.
- No early warning when a vendor is about to run out mid-production.
- Communicating production targets to 30 vendors takes half a week across phone, WhatsApp and paper.
  KPML creates a perfectly good PO in SAP — the vendor never sees the screen.
- Year-end audit needs physical visits to every vendor, and still produces disputes.
- Rejected and reworked units have no formal record on either side.

### From the vendor's side (Type B / D — the job worker)

- **The principal's material and their own sit in the same store with no way to tell them apart in any
  system they own.** This is the root cause of everything below.
- KPML is slow to communicate BOM lines, stock and targets — production is delayed before it starts.
- Stock mismatches become accusations of theft, followed by penalty charges **with no basis for
  calculation**.
- No clean audit trail with which to defend themselves.
- Rework returns arrive with no documented defect information.
- Material consumed during rework is untracked and appears as unexplained consumption.
- Work-in-progress is invisible, so at any month end the material "missing" from the store is really
  sitting on the shop floor half-finished — and looks exactly like theft.
- Payment from KPML is unpredictable; chasing it means a phone call or waiting for the next meeting.
- They have no idea they are owed statutory interest on late payment, or that KPML has a tax reason to
  pay them on time.

### What each side must be told — and what must never be said

| Audience | The honest pitch |
|---|---|
| **KPML (principal)** | *"Section 143 record-keeping is **your** statutory obligation and you have no system for it. Here is your live exposure in rupees, and here is your 31 March 43B(h) position."* |
| **Vendor (job worker)** | *"Your principal will ask you for these numbers repeatedly, and today you cannot produce them. Be the vendor who answers in ten seconds and never gets accused."* Plus what genuinely is theirs: own stock, own invoices, own GSTR-1 tables, own 43B(h) receivable position. |

> **Never pitch s.143 compliance to a job worker as their legal requirement.** It is the principal's
> obligation under s.143(2). Overstating a statutory duty in front of a client's CA costs more credibility
> than the feature is worth.

---

## 4. The Network Structure

```
KPML  (Type C — principal, owns all raw material throughout)
├── Issues raw material → job workers          [job_work_issue, ownership never transfers]
├── Receives finished goods ← job workers      [job_work_return, still KPML's goods]
├── Receives job charge invoices ← job workers [SAC 9988, charges only — not material value]
├── Sells finished goods → end buyer           [sale — KPML's own outward supply]
└── Carries: s.143 clocks · ITC-04 · 43B(h) exposure · the accounting obligation

Job workers  (Type B/D — Shivprasad, Datta Prasad, SS Engineering)
├── Hold KPML's material                       [owned_by = KPML, held_by = NULL]
├── Hold their own purchased material          [owned_by = NULL, held_by = NULL]
├── May hold a second principal's material     [owned_by = Godrej — invisible to KPML]
├── May sell independently from own stock      [Type D]
└── Invoice KPML for job charges only          [SAC 9988, per-piece rate from KPML's PO]
```

**The material never changes owner anywhere in this diagram.** That single fact drives the entire data
model in Section 7.

---

## 5. The Moat Logic

The old version of this plan argued the moat was data lock-in: *"switching means every node loses its
history."* That is weak, and a competent CFO hears it as hostage-taking and asks for an export.

**The real moat is that the vendor's account is theirs, and it accrues value from every principal they
work for.**

- Shivprasad's Nexflow account holds KPML's work **and** any future principal's work. KPML cannot force
  them off it, because leaving costs Shivprasad a relationship KPML does not control.
- Every documented cause of supplier-portal failure is *"the portal serves the buyer, not me."* Nexflow
  inverts that: the vendor bought it for their own stock, GST and invoicing, and the network is what they
  get on top.
- **The moment Nexflow asks a vendor to log into something purely for KPML's benefit, it becomes a
  supplier portal and inherits every one of those failure modes.** This is why non-Nexflow vendors confirm
  by WhatsApp link, never by account.
- Multi-principal features — a consolidated production queue across principals, a substitution ledger, a
  per-principal compliance calendar — are **structurally impossible for any principal's ERP to provide**,
  because each ERP sees exactly one relationship.

Supporting lock-in, in descending order of strength: the counterparty is on the same system · years of
challan and clock history · the CA's workflow depends on it · switching costs both sides simultaneously.

**And publish a clean full export anyway.** It costs a day, it removes the objection, and it makes the
moat argument credible rather than defensive.

---

## 6. KPML's Role — The Keystone

**KPML needs one account, not 100 logins** — with roles inside it, because the accounts manager, the
storekeeper, the purchase head and the CA must not all see the same things.

From that account:

- Issue raw material to any job worker → the vendor auto-GRNs by QR, into a **KPML-owned pool** on their
  books
- Receive finished goods from any job worker → KPML auto-GRNs by QR
- **See their own material across every vendor** — from KPML's own records, not by reaching into the
  vendor's tenant
- See s.143 exposure **in rupees, with dates** — not a day count
- See their 31 March **43B(h) disallowance exposure**, per vendor
- Push production targets from the same data their SAP PO already holds — material code, description,
  quantity, still-to-deliver balance, price per piece, deadline
- Compare actual consumption against an **agreed yield with a tolerance band**, not against a guess
- Manage rework: reject on receipt, track status, release payment when closed
- Track payment status per vendor invoice — due, overdue, paid
- Dispatch consolidated finished goods to the end buyer
- Receive Telegram alerts for events that matter, digested — not 200 buzzes a day

**Critically: all of this works before a single vendor is on Nexflow.** See one-sided mode in Section 9,
Step 5.

---

## 7. Full Feature Map — Every Pain, Every Feature

| Pain | Feature | Prerequisite | When |
|---|---|---|---|
| Principal's material indistinguishable from own | **Ownership columns** (`owned_by` / `held_by`) | — | **Step 2** |
| Month-end phantom shortfall that looks like theft | **WIP state** | Ownership | **Step 2** |
| Wrong pool consumed by accident | **Pool-aware consumption** + pool-blind RPC fix | Ownership | **Step 2** |
| Sale vs job work indistinguishable on a dispatch | **Movement purpose** | — | **Step 2** |
| Vendor's stock figures include material they don't own | Ownership filter across all stock reads | Ownership | **Step 2** |
| CA counts challan ranges by hand | **GSTR-1 Table 13 register** | — | **Step 1** |
| HSN/SAC summary spanning job charges + own sales | **GSTR-1 Table 12 summary** | — | **Step 1** |
| Challan not Rule 55 compliant for job work | HSN, taxable value, place of supply, triplicate | — | **Step 1** |
| KPML loses income tax deduction on 31 March | **43B(h) exposure report** | Udyam fields | **Step 1 / 3** |
| Payment arrives net of TDS, ledger can't express it | **Receipts ledger** (gross/TDS/net, partials) | — | **Step 3** |
| Deemed supply exposure invisible | **s.143 timer, in rupees** | Ownership + purpose | **Step 2** |
| Scrap unverifiable, reconciliation can't close | **Scrap declaration, pool-attributed** | Ownership | **Step 2** |
| Job charge invoice raised at full product value | **Invoice type → SAC 9988** | Purpose | **Step 2–3** |
| Nobody sees events in time | **Notifications** (3 types, Edge Function) | — | **Step 4** |
| KPML has 30 vendors, 3 on Nexflow | **One-sided mode, both directions** | Ownership | **Step 2 / 5** |
| Vendor can't prove what happened | **Evidence pack** + named confirmation | One-sided | **Step 5** |
| Disputes take 3 days | **Document verification surface** | One-sided | **Step 5 / 6** |
| One principal can see another's existence | **Single scoped access path** | Designed Step 2 | **Step 6** |
| Vendor fears exposure to their biggest customer | **Consent + "view as principal"** | Scoped path | **Step 6** |
| Terms live in memory | **Job work agreement record** | — | **Step 7** |
| SAP PO never reaches the vendor | **PO push** (running balance, not status) | Item codes | **Step 7** |
| Rejection at the gate has no record | **Accepted / rejected / short on receipt** | Purpose | **Step 7** |
| Variance flags honest vendors | **Yield spec + tolerance band** | Agreement | **Step 7** |
| ITC-04 compiled by hand | **ITC-04 working paper** | Everything above | **Step 7** |
| Month-end takes weeks | **Per-challan mutual close** | Balances | **Step 7** |
| E-way bill rules misunderstood | Field with **corrected** thresholds | — | **Step 7** |

**Cut permanently:** `stock-share.html` and the `stock-share` Edge Function. A non-expiring,
non-revocable tenant-level token publishing a factory's whole stock position, showing the vendor's own
business to their largest customer. Wrong data, wrong token model, unsellable to the vendor. Replaced by
the scoped principal view (Step 6).

---

## 8. Data Model Foundations

**Read this section before building any feature above it.** Every network feature depends on these four
changes, and building any of them on the current model means migrating live client data later.

### 8.1 Ownership — two nullable columns

Two nullable counterparty references on the stock ledger, carried through dispatch lines:

| Column | Question it answers | NULL means |
|---|---|---|
| `owned_by` | Whose material is this? | Mine |
| `held_by` | Who is physically holding it? | Me |

Four states from two flags, covering every client type:

| Situation | `owned_by` | `held_by` |
|---|---|---|
| **Type A — SS Engineering, every row, always** | NULL | NULL |
| Shivprasad's own purchased copper | NULL | NULL |
| KPML's copper held by Shivprasad | KPML | NULL |
| KPML's view of that same copper | NULL | Shivprasad |
| Second principal's material at the same vendor | Godrej | NULL |
| Multi-hop — KPML's material sent onward to a plating shop | KPML | Plating shop |

**Ownership lives on the ledger, not on the material master.** A material record per owner would duplicate
masters (3 principals × 200 materials = 600 records), break BOM (which `raw_material_id` does the recipe
point at?), and collide with the per-tenant unique code index. It is the same physical copper; the ledger
says who owns each part of the pile.

**NULL rather than a `'self'` sentinel** means every historical row across three live tenants is already
correct with no backfill, and the balance view's grouping collapses to today's exact output for any tenant
that never writes a non-NULL value. **This is the Type A guarantee expressed in the schema rather than in
a promise.**

#### The retrofit — the largest single piece of work in this plan

Principal-owned material must be **excluded by default** from almost every existing surface on the
vendor's side, because it is not their asset and has no purchase behind it:

- Stock valuation and closing stock — not theirs; including it inflates their balance sheet
- CA export / Tally export / Zoho export — no purchase invoice, so it must not appear as a purchase
- **GSTR-2B reconciliation** — free-issue material has **no supplier invoice and no ITC**. If it flows in,
  it becomes a permanent phantom in the "ITC Blocked" bucket and destroys the credibility of the feature
  that currently justifies Pro pricing
- Low-stock alerts — the vendor does not reorder the principal's material; the principal does
- Stock dashboard, reports, zero-stock lists, material lists
- **The agent** — `buildContext()` fetches `stockBalances`, and many of the 33 intents read stock
  (`check_stock`, `low_stock_list`, `zero_stock_list`, `stock_check_product`, `consumption_summary`).
  Every one needs the ownership filter, or the AI confidently reports stock the client does not own

This produces **no visible new feature for a Type A client**. It is the price of the generic model. Do it
once, deliberately — not surface by surface as clients report wrong numbers.

#### Two consequences to handle at the same time

- **Min-stock thresholds split.** For principal-owned material the reorder decision is the *principal's*,
  and the shortfall alert routes to them. The vendor may still want their own "production stops tomorrow"
  warning. Two thresholds, two recipients, one physical material.
- **The 250-material Lite cap must count owned materials only.** A Lite vendor with two principals could
  otherwise blow the cap on material they do not own and be shown an upgrade prompt for someone else's
  data. Fix in the Aug 17 DB trigger, not only the UI check.

#### Plan gating decision

Job work tracking is **not** Pro-only. Recording material you hold for a principal is basic operational
hygiene and most of this market are job workers — gating it makes Lite useless to them. Gate the
**principal side** (managing job workers, network dashboards, cross-tenant corroboration) as Pro, where
the orchestration value and the larger customer sit.

### 8.2 Movement purpose

One attribute on every dispatch, describing the economic nature of the movement. Direction comes from who
sent it, not from the name.

| Purpose | Ownership changes? | Custody changes? | Notes |
|---|---|---|---|
| `sale` | **Yes** | Yes | **The default.** Every existing row reads as this |
| `job_work_issue` | No | Yes | Principal → job worker. Starts the s.143 clock |
| `job_work_return` | No | Yes | Processed goods back to the principal |
| `unused_material_return` | No | Yes | Unconsumed free-issue back, **no processing, no job charge** |
| `scrap_return` | No | Yes | Declared waste back to the principal |
| `rework_return` | No | Yes | Principal → job worker, rejected goods |
| `rework_dispatch` | No | Yes | Job worker → principal, after repair |
| `capital_goods_issue` | No | Yes | Tooling — 3-year clock, or **no clock** for exempt classes |
| `inter_jobworker_transfer` | No | Yes | Job worker → another job worker. ITC-04 Table 5B |
| `direct_supply_from_jobworker` | **Yes** | Yes | s.143(1)(b). **Closes the clock without physical return** |

Three rules:

1. **`sale` is the default.** Every historical dispatch across three live tenants keeps its current
   meaning. Any other default silently rewrites history.
2. **The purpose carries the owning principal reference.** "Job work return" is meaningless without "of
   whose material."
3. **The purpose→stock-effect mapping lives in ONE definition** consulted by every write path — not
   re-implemented on `dispatch.html`, `rm-dispatch.html` and `production-issue.html` independently. This
   codebase already has that failure pattern twice (three separate invoice-button implementations; the
   "update BOTH `READ_ONLY_INTENTS` and `READ_ONLY_TEXT_INTENTS`" hazard). A third instance, this time
   silently corrupting cross-tenant stock ownership, is the worst version of it.

### 8.3 Work-in-progress — the missing state

**Current flow: GRN → consumption → dispatch. There is no state between consumption and return.**

When a vendor consumes 400 kg of KPML's copper into 180 half-finished stators, that material has left the
store and not yet returned. It is **WIP, owned by the principal, held by the vendor.** Today it exists
nowhere.

**Why this is the most damaging gap in the product:**

The monthly material statement must balance:

```
issued  =  returned  +  scrap declared  +  raw material still held  +  WIP
```

Without a WIP term, **every statement shows a phantom shortfall exactly equal to work in progress.** To
KPML that shortfall is indistinguishable from theft.

> **Nexflow exists to eliminate false theft accusations. Without WIP tracking, it manufactures them —
> automatically, every month, with the authority of software.**

That is not a refinement. It is the difference between the product working and the product being actively
harmful. WIP is a Step 2 requirement, not a later enhancement.

**Ownership must flow through production.** Finished goods made from KPML's copper are **KPML's goods**,
not the vendor's inventory. If the BOM explosion credits output to the vendor's own finished-goods stock —
which is what it does today — the vendor's FG valuation inflates with goods they do not own, and the
principal cannot see their own WIP or FG at the vendor. The retrofit therefore spans stock reads **and**
production **and** dispatch **and** finished goods **and** scrap.

### 8.4 Pool-aware consumption — derive, never ask

**The rule: the production order already knows whose material it is.**

- Production against **KPML's PO** → consume from `owned_by = KPML`. Automatic.
- Production for **own sale** → consume from `owned_by = NULL`. Automatic.

**Never put a pool selector on the daily BOM issue screen.** Every place a human chooses between two
physically identical piles under time pressure is a place the wrong pile gets picked. Derive it from the
order; show it as confirmation text, never as an input.

#### ⚠ The pool-blind RPC hole — fix before ownership goes live

**`confirm_bom_issue` v2 aggregates required quantity per material and checks it against the balance.**
That check is correct for one pool and **silently wrong across pools**: it will pass on aggregate stock and
then consume the wrong owner's material — atomically, with a green toast, no error.

The check must become per **(material, pool)**, and the existing error message must name the pool:

> `INSUFFICIENT_STOCK: KPML's copper — need 240 kg, available 200 kg (you also hold 180 kg of your own)`

That message is the whole feature. It converts an invisible data-integrity failure into an explicit
decision.

#### When the pool is genuinely short: make substitution deliberate and recorded

The vendor's real options: request more material from the principal · record a substitution · stop
production.

**Substitution must be possible, one tap, and permanently recorded — never silent, never impossible.**
Making it impossible guarantees the vendor does it in the physical world and lies to the software, which
is the worst outcome: the pile is wrong *and* the ledger says it isn't. The record is two linked ledger
rows plus a recovery amount, visible on the principal's statement within their own scope.

#### GST consequences if cross-pool consumption goes undetected

| Direction | Consequence |
|---|---|
| Principal's material consumed for the vendor's **own sale** | Material never returns → s.143 clock breaches → **deemed supply on the original dispatch date, GST + 18% interest retrospectively**, payable by the principal, recovered from the vendor. Vendor has sold goods containing material they never purchased — no ITC, unexplainable stock-to-purchase mismatch |
| Vendor's **own material** consumed for the principal's order | Vendor has supplied goods without invoicing — understated outward supply. Principal's material sits unconsumed, making their ITC-04 quantities wrong |

Either way **both parties' records are wrong in opposite directions and neither can prove anything** —
the exact dispute the product exists to end.

**Scrap carries a pool too.** Scrap from KPML's copper is KPML's; scrap from the vendor's copper is
theirs. One physical bin, two owners. Without pool attribution the s.143(5) question of who supplies the
scrap and pays GST on it cannot be answered.

### 8.5 Three smaller model corrections

**Invoice type.** `goods_sale` (default) or `job_work_charge`. Drives line description, HSN vs **SAC
9988**, quantity basis, rate source (the principal's PO price per piece, not `p2_product_prices`), and
value (job charges only). Default preserves every existing invoice. **Job charges bill per PO per period**
— the consolidated dedup key (tenant + date_from + date_to + client_id) has no PO dimension and will
collide across two POs in one period.

**Counterparty identity.** In job work the same company is **both** client and supplier — KPML sends
material (supplier) and receives goods and invoices (client). Today that is two records in `p2_clients`
and `p2_suppliers` with no link. Every counterparty-grouped report splits KPML in half, and the s.143
clock cannot join its two legs. Needs one identity with roles, or at minimum a hard link.

**Material identity across principals.** Code uniqueness per tenant is wrong for a multi-principal vendor:
identity is (owning principal, principal's code). The vendors have already adopted the principal's codes —
Shivprasad's own list is headed *"Job Work Material Code"* with KPML's `2WST-` / `2VWST-` / `2VWCIST-`
prefixes. **So the principal's code is the canonical identity**, with the vendor's internal code as an
optional alias. Materially less work than a negotiated bidirectional map.

---

## 9. The Plan — Steps, In Order

Ordered by two tests, applied in this order: **(1) does it work with zero cooperation from anyone else?**
and **(2) does it close the next sale or make current clients harder to leave?**

**Every step before Step 5 has standalone value even if KPML never answers the phone.**

### Step 0 — Decide. Build nothing. *(this week, one day)*

1. **⚠ P0 — are existing clients issuing wrong invoices today?** Nexflow's invoice module produces a
   flat-18% invoice on **full product value with the product's HSN**. A job worker's invoice on their
   principal must be **job charges only under SAC 9988**. If SS Engineering, Datta Prasad or Shivprasad
   have raised any Nexflow invoice on KPML, their GSTR-1 outward supply is overstated by the entire
   material value — inflating turnover, risking thresholds they have not actually crossed, and creating a
   mismatch KPML's IMS dashboard will surface from the other side. **Five-minute check; correct with their
   CA if it has happened.**
2. **Ask a client's CA two questions** — free, motivated, ten minutes: *(a)* confirm the s.143 / ITC-04 /
   Rule 55 / e-way bill rules in Section 10 against the bare Act; *(b)* what records must a **job worker**
   keep in their own right, given s.143(2) places the accounting obligation on the principal? The answer
   decides whether the vendor pitch is compliance-led or relationship-led.
3. **Fix the `p2_tenants` contradiction in CLAUDE.md.** It states as a CRITICAL invariant that no tenant
   table exists; the Aug 17 notes say a row is upserted into one. Resolve before anything depends on it.
4. **Define the mother-factory number** (Section 12) — before Phase 1 is designed, not before the meeting.

### Step 1 — Ship to the clients you already have *(1–2 weeks)*

Nothing here needs KPML, a network link, or a second tenant. All four are **CA-facing**, and in this
market the CA is the referral channel.

1. **GSTR-1 Table 13 challan register** — serial range issued, cancelled, net issued, per month. Nexflow
   already holds the sequence and cancelled state. Same-day build.
2. **GSTR-1 Table 12 HSN/SAC summary** — mandatory, split B2B/B2C since May 2025. For a Type D vendor this
   spans **both** SAC 9988 job charge lines and product HSN sale lines in one aggregation — two code
   systems, two value bases, exactly the arithmetic that goes wrong in a spreadsheet at 11pm on the 10th.
   All inputs already held.
3. **Rule 55 challan compliance** — add HSN, taxable value, place of supply, and Original/Duplicate/
   Triplicate marking. For job work **the challan is the only document accompanying the goods.**
   `hsn_sac` and the price tables already exist; only the document is missing them.
4. **43B(h) fields and the vendor-side receivable view** — Udyam number, enterprise class, registration
   activity on the counterparty; overdue-with-interest report.
5. **Audit `challan_sequence` for gaps** — a query, not a feature. Table 13 assumes a continuous series;
   find the hole before an officer does.

### Step 2 — The foundation *(3–4 weeks — larger than it looks)*

Everything in Section 8, in one deliberate pass:

- Ownership columns + the retrofit across every stock-reading surface, including the agent
- Movement purpose, defaulting to `sale`, with the single stock-effect mapping
- **WIP state** — without it the statement manufactures theft accusations
- Ownership through production to WIP and finished goods
- **Pool-aware consumption + the `confirm_bom_issue` fix** — before ownership ships, not after
- Substitution event with recovery
- Scrap declaration, pool-attributed
- Challan-level running balance — issued, returned, scrap, still held, WIP
- **Corrected s.143 clock** (Section 10.1)
- The two onboarding switches (UI-only, never data semantics)
- **The standalone regression test as a blocking gate**
- **Vendor-side one-sided mode** — a job worker records a principal who is not on Nexflow

**Design here, ship at Step 6:** the single scoped access path for principal-facing reads (Section 10.5).
Retrofitting scope enforcement across six existing RPCs is exactly the drift that causes a leak.

#### The demo that comes out of Step 2

Shivprasad's stock screen, on the day it ships:

> ### KPML's copper: 400 kg  ·  Your copper: 180 kg

**No system they have today shows this** — not Tally, not a register, not KPML's SAP. It is one line, it
is the legally required separate record, and it solves the entire mixed-stock problem visibly.

**This is the KPML meeting opener.** Not a slide — a live screen on a real vendor's account.

It also reframes the whole step: ownership columns are not scaffolding for a hypothetical KPML deal. They
fix **wrong numbers on three paying clients' screens today** — Datta Prasad and Shivprasad have KPML's
material in their factories right now, counted as their own.

### Step 3 — Payment ledger, built properly *(1–2 weeks)*

- **Obligations separate from receipts.** Each receipt carries gross, **TDS**, other deduction, net, mode,
  reference, date, proof. Status is *derived* from the sum of receipts, never stored.
- **Why:** KPML deducts TDS on job work charges — 1% for individual/HUF vendors, 2% for firms and
  companies (s.194C, renumbered s.393(1) from FY 2026-27). Invoice ₹1,00,000 → payment ₹98,000. A
  single-row `amount` + status column is **wrong on the very first invoice** and unreconcilable against
  Form 26AS at year end. Partial payments, retention and debit notes break it the same way.
- **Overdue stamped server-side** by the existing 8am IST cron — a status computed only in a browser fires
  nothing for the user who isn't looking, which is the entire population a reminder exists for.
- **43B(h) both directions** (Section 10.4).

**Why here:** fully valuable to a single tenant with no counterparty, and by now the invoice it hangs off
carries a movement purpose, so a job charge invoice and a goods invoice are distinguishable.

### Step 4 — Notifications, scoped hard *(1–2 weeks)*

- In-app notification centre + Supabase Realtime bell. This part of the original plan was right.
- **Telegram fired from a Supabase Edge Function — not a Vercel `/api/notify` behind a Supabase webhook.**
  This codebase already fires Telegram from Edge Functions in two proven places (pg_net cron jobids 2 and
  3, and fire-and-forget from `agent-query`). The Vercel route adds a second runtime, a second deploy
  target, a second home for the bot token, and a webhook whose failures are invisible. The "swappable
  pipe" argument is satisfied equally by an Edge Function.
- **Three types only to start:** `challan_dispatched`, `payment_overdue`, `low_stock`. Not sixteen.
  Fifteen of the original sixteen fire on features that do not exist yet. Add a type when the event that
  generates it ships.
- **Chat binding by deep-link start payload**, not by retyping a chat ID. A `t.me/<bot>?start=<token>`
  link generated in Settings delivers the token to the bot as the first message and binds chat→tenant
  server-side. One tap, nothing typed, nothing mistypeable. The alternative — "read a ten-digit number off
  a chat bubble and retype it into a browser form" — is five steps on a phone for a 55-year-old factory
  owner, and a mistyped digit fails silently.
- **One fan-out point, one message catalogue.** Not a notification insert in every write path.
- **Delivery status on every notification row** (queued / sent / failed + error). Telegram `sendMessage`
  fails routinely — blocked bot, stale chat_id, rate limits. A buzz assumed delivered and never sent is
  worse than none, because the whole moat claim is "nobody misses an event."
- **Digest mode and quiet hours from day one for the principal account.** KPML × 30 vendors × every event
  = 200 buzzes a day. Within a week they mute the bot, and then the "instant alert" moat is *a muted bot*.
- **Migrate the existing `telegram_chat_id`** wiring rather than creating a second home for it.

### Step 5 — Principal-side one-sided mode. **This is the KPML pilot.** *(2–3 weeks)*

KPML runs the complete model against vendors who are **not** Nexflow tenants:

- Vendors are records in KPML's own tenant; dispatches recorded; material in `held_by` buckets
- **s.143 exposure in rupees**, not days: *"₹14,20,000 of GST plus interest becomes payable if these six
  challans are not closed by 12 September"*
- Material-held statement per vendor, per month — the paper artefact both sides sign
- Evidence pack: challan, confirmation with **typed name and timestamp**, GRN, rejection record,
  notification delivery log — one PDF, sent in sixty seconds when the accusation is made
- Vendors confirm through the **existing public `receive.html` link over WhatsApp** — no account, no
  login, no password
- `receive.html` must become **direction-neutral**: a principal's storekeeper confirming goods returned
  *to* them is the mirror case, and the page's language currently assumes only inbound receipt

**Why this is the pilot and not a fallback:**

1. Demonstrable in week one instead of after thirty sales
2. Works at 30 vendors on day one — the alternative shows KPML three populated rows and twenty-seven
   blanks, which reads as a broken product, not a partial rollout
3. Immune to vendor churn
4. **It turns KPML into the distribution channel.** Thirty prospects start using Nexflow's UI, introduced
   by their own largest customer, at zero acquisition cost. Every vendor who later records their own
   principal creates a *pending link* — a named company with real volumes and a warm introduction. That is
   a lead engine the old plan did not have.

Onboarding must be **self-serve**. A generic principal has no relationship with Nexflow and will never
take a sales call to enable a vendor's paperwork.

### Step 6 — The cross-tenant upgrade *(only for vendors who are Nexflow tenants)*

- **The single scoped access path** (Section 10.5) — designed at Step 2, shipped here
- `p2_network_links` carrying **explicit versioned scope + consent record + revocation timestamp** — not
  just `active`/`inactive`, and **not** a third home for a Telegram chat ID
- **Consent and visibility panel** on the vendor's side (Section 10.5)
- **"View as principal" preview** — let the vendor see exactly what KPML sees, on demand
- Scoped corroboration reads: *"your figure says 2,500 kg, theirs says 2,480 kg, here are the three
  challans that differ"* — two independent records that agree beats one record both sides are told to trust
- Unified document verification surface — one page whose detail level varies by requester, not a separate
  `challan-verify.html` alongside `receive.html`
- **The correction model** — reversing entries linked to the original, both sides notified, clocks
  re-based. This must land **before** any cross-tenant write exists, not after the first bad one

`p2_network_links` is created early (it is nearly free) but is **load-bearing only here.** Demoting it
from "enables everything" to "enables the upgrade" is the single biggest structural change from the
original plan.

### Step 7 — Everything else, each gated on a named person asking

In rough order of likely demand:

1. **Job work agreement record** — rate per unit, payment days, agreed process-loss tolerance, scrap
   ownership, rejection policy. Versioned, both sides acknowledge changes. Converts *"you're stealing"*
   into *"the agreed tolerance is 2%, you're at 2.4%, explain 0.4%."*
2. **PO push** — mirrors KPML's SAP PO exactly: material code, short text, quantity, **still-to-deliver
   running balance**, net price per piece, deadline. Note: **a running balance, not a status enum.** The
   original `sent/confirmed/fulfilled/cancelled` cannot express *"340 of 500 delivered."*
3. **Rejection at the gate** — accepted / rejected / short quantities with a defect note on the receiving
   side. The most common quality event, currently unrepresentable because the rework flow starts after a
   full receipt has been recorded.
4. **Variance with agreed tolerance and a yield spec.** Real process loss runs 1–3% and is normal. Goods
   change identity across job work — bar goes out, machined housing comes back — so a yield spec per
   (product, vendor) is required or the dashboard flags every honest vendor every month.
5. **Per-challan mutual close** — both sides agree issued = returned + scrap + held + WIP. A month closes
   when its challans do. No cross-tenant locking protocol, no all-or-nothing blockage.
6. **Dispute register** — makes the product's value *measurable*, which is the strongest thing to put in
   front of client 4.
7. **ITC-04 working paper** — Tables 4 / 5A / 5B / 5C with challan references, UQC quantities and declared
   losses. Per principal, on each principal's own filing cycle.
8. **Consolidated production queue across principals** — vendor-side only. Structurally impossible for any
   principal's ERP to provide.
9. **Rework order** — only if volume justifies tracking a repair cycle across weeks. Start with the
   rejection record; it is a strict subset, so nothing is wasted.
10. **Vendor scorecard** · **consolidated dispatch pool** · **e-way bill field** with corrected thresholds.

**The gate is literal:** a named person at a named client asks for it. Not *"KPML would probably want
this."*

---

## 10. Compliance Reference

> Everything here is from secondary sources — tax portals, CA firm writeups, practitioner articles. Good
> enough to design against. **Not good enough to ship a compliance feature on.** Get a CA to confirm
> against the bare Act and current notifications before any of this goes live (Step 0).

### 10.1 Section 143 — the timer, corrected

The original plan said *"1-year window, red flag at 330 days, computed from dispatch timestamps."* That is
wrong in four ways:

| # | Rule | Consequence of the original version |
|---|---|---|
| 1 | **Inputs: 1 year. Capital goods: 3 years. Moulds, dies, jigs, fixtures and tools: NO time limit at all** — they may stay permanently | A tooling dispatch flagged red at 330 days is a false alarm, and false alarms teach users to ignore the feature |
| 2 | Where goods go **directly from supplier to job worker** (s.19), the clock runs from the **job worker's date of receipt** | No dispatch date exists for these; the clock would never start |
| 3 | The **Commissioner may extend** — up to 1 further year (inputs), 2 (capital goods). **A field is needed for the extension order** | The timer screams about a legally extended challan |
| 4 | The obligation is discharged by return **OR by supply direct from the job worker's premises** (s.143(1)(b)) — which is what a consolidated pool dispatch is | The clock never closes on a legitimate direct supply |

On breach: **deemed supply on the original dispatch date, GST plus 18% interest running retrospectively
from that date.**

**Two failure modes, both bad.** A timer that cries wolf gets muted, then misses the real breach. And a
**false all-clear is worse than no feature** — if Nexflow says "all compliant" while challans have
quietly breached, Nexflow owns that conversation and the client's liability. Be conservative and loud;
never suppress uncertainty.

**s.143(2): the accounting obligation lies with the principal.** The job worker is not required to keep
these records in their own right. This drives the pitch split in Section 3.

**s.143(5):** waste and scrap generated at the job worker's premises may be supplied by the job worker
directly on payment of tax if registered, or by the principal if not. Scrap has both a tax event and a
revenue event — and an owner.

### 10.2 ITC-04

Thresholds unchanged for FY 2026-27: turnover above ₹5 crore → **half-yearly** (Apr–Sep due 25 Oct;
Oct–Mar due 25 Apr). Up to ₹5 crore → **annual**, due 25 Apr.

| Table | Contents |
|---|---|
| **4** | Goods sent for job work, including goods sent **directly to the job worker's premises** |
| **5A** | Received back from the **same** job worker — **and losses and wastes** |
| **5B** | Received back from a **different** job worker — multi-hop |
| **5C** | Goods **supplied directly from the job worker's premises** |

Common columns: job worker GSTIN, **original challan number and date issued by the principal**, challan
number/date issued by the job worker, nature of job work, description, **UQC and quantity**, and **losses
and waste (UQC and quantity)**.

**The form is a specification for the data model.** Table 5B proves multi-hop is normal. Table 5C proves
supply-from-premises is normal. Losses-and-waste columns in every return table prove scrap must be a
first-class, pool-attributed field.

### 10.3 Documents — challan and e-way bill

**Rule 55 delivery challan must contain:** serial number, date and place of issue; consignor name/address/
GSTIN; consignee name/address/GSTIN; **HSN code and description**; quantity; **taxable value**; tax rate
and amount where applicable; **place of supply where inter-state**; signature. Issued in **triplicate** —
Original for Consignee, Duplicate for Transporter, Triplicate for Consigner.

Nexflow's challan today: `SR NO | PO NO | DESCRIPTION | QUANTITY | UNIT`. Missing HSN, taxable value,
place of supply, triplicate marking. **For job work the challan is the only document accompanying the
goods** — an incomplete one turns a legitimate movement into an unexplained movement of goods.

**E-way bill — the original plan's ₹50,000 rule is wrong in both directions:**

| Movement | Threshold |
|---|---|
| **Intra-state, Maharashtra** | **₹1,00,000** (since 1 July 2018) — not ₹50,000 |
| **Inter-state, job work** | **Required irrespective of value** — even ₹5,000 |

Karad / Satara / MIDC is intra-state for essentially everything KPML does. The original rule would nag on
₹60K intra-state dispatches needing nothing, and stay silent on the ₹20K inter-state dispatch where
absence means detention and penalty.

**GST rate on job work services: 18%** for mechanical and engineering job work since the 22 September 2025
rationalisation, under **SAC 9988**. Concessional slabs remain for specified sectors (5% food/textiles/
printing/leather; 1.5% diamond). Nexflow's flat 18% is correct for these clients and **will break for a
textile or food job worker** — a known limitation to fix on the agreement record, not a schema redesign.

### 10.4 Money — TDS and 43B(h)

**TDS on job work charges:** 1% for individual/HUF vendors, 2% for firms and companies. s.194C, renumbered
**s.393(1)** under the Income-tax Act 2025 from FY 2026-27. Thresholds ₹30,000 single / ₹1,00,000
aggregate per year — every vendor here is over it. s.206AB repealed by Finance Act 2025.

**Section 43B(h) — the primary payment ledger pitch:**

Payment to an **Udyam-registered Micro or Small** enterprise beyond the agreed period — **45 days maximum
where there is a written agreement, 15 days where there is not** — that is still outstanding on **31
March** is **disallowed as an income tax deduction** for that year, allowed only in the year of actual
payment. **MSMED s.16** interest runs at **three times the RBI bank rate, compounded with monthly rests**,
and is itself non-deductible. Escalation route: MSME Samadhaan / MSEFC, adjudication within 90 days.

**Scope limits — get these wrong in front of a CA and you lose credibility on everything else:**
Micro and Small **only** (Medium excluded) · **Udyam-registered only** · **not** where the registration is
for **trading**. Hence three fields on the counterparty: Udyam number, enterprise class, registration
activity.

> **This is a CA sale, not a vendor convenience feature.** KPML's CA is already tracking 43B(h) manually
> on a spreadsheet. Nexflow's payment ledger produces **audit-ready 43B(h) proof automatically**, as a
> by-product of operational data nobody had to re-enter.
>
> Framed as "vendors are chasing you," KPML's accounts head buries it. Framed as *"₹18,60,000 of vendor
> bills will be disallowed on 31 March — roughly ₹5,60,000 of extra tax"*, their CA asks for it by name.
> Complete inversion of the adoption dynamic, and it ships to existing clients before KPML is ever
> contacted.

### 10.5 Principal visibility isolation — **the top product risk**

Above security in the conventional sense. In Scenario C — a vendor serving KPML **and** Godrej — the
scoping rule is absolute:

> **A `p2_network_links` row for KPML resolves to exactly one filter: `owned_by = KPML`. Every
> principal-facing read starts from that filter and can never widen it.**
>
> Not "the vendor's stock." Not "the vendor's copper." **KPML's copper, at the vendor's premises.**

**Six failure modes:**

1. **Aggregate leak** — any total spanning owners encodes the other principal's quantity. Sums leak
   because they look innocuous.
2. **Existence leak** — a material list scoped to the vendor rather than the link reveals materials KPML
   never sent. **Inference is disclosure.**
3. **Variance-denominator leak** — variance computed against *total* consumption rather than KPML's pool.
   The most likely leak in practice, because a denominator feels like a detail.
4. **Alert leak** — low-stock or capacity signals derived from the vendor's overall position.
5. **Scorecard leak** — metrics computed across principals or benchmarked revealingly.
6. **RPC drift** — scope lives in each function's select list; someone adds a column later and the filter
   is not extended. *This is the one that actually happens.*

**The cost is not embarrassment.** If KPML learns the vendor works for Godrej, KPML may pull work and the
vendor may be in breach of a confidentiality term — caused by software they pay for. In a district where
every factory owner knows every other, that is a market-wide reputation event and the end of the network
story. **Unrecoverable.**

**The architectural answer to failure mode 6:** enforce scope in **one parameterised access path** that
every principal-facing read goes through, taking the link as input and returning only in-scope rows. Then
it cannot be forgotten, because there is no other way to reach the data. Cheap to decide now; expensive to
retrofit across six RPCs.

**What the vendor consents to, in plain language on their own screen:**

> **KPML can see:** material they sent you and its current quantity · what you consumed against their
> orders · scrap you declared on their material · challans between you · their finished goods you hold ·
> invoices you raised on them.
>
> **KPML cannot see:** your own materials or stock · any other company's material · **whether you work for
> anyone else at all** · your own sales, clients or prices · your suppliers · your total production volume.

Three rules: **generate the panel from the same filter that governs the query** (or prose and enforcement
drift apart, and a customer finds it) · **revocation must not destroy history** — the principal keeps
their own one-sided records and loses only live corroboration · **give the vendor a "view as principal"
preview**, which makes a leak self-reporting.

### 10.6 GSTR-1 for a Type D vendor

A correction worth stating plainly, because the intuitive version is wrong:

- The **return of goods** to a principal is **not an outward supply at all.** It is a non-supply movement
  under a delivery challan, with no taxable value anywhere in GSTR-1. It appears only as a **document
  count in Table 13.**
- The **job charge invoice** *is* an outward supply and goes in **Table 4 (B2B) — the same table as own
  sales.** Not different tables. Different rows, distinguished by SAC 9988 vs product HSN and by value.

| Table | What a Type D vendor reports |
|---|---|
| **4 (B2B)** | Job charge invoices (SAC 9988, charges only) **and** own sale invoices (product HSN, full value) |
| **12 (HSN/SAC summary)** | Both code systems aggregated together. Mandatory; B2B/B2C split since May 2025 |
| **13 (documents issued)** | Serial ranges, issued and cancelled counts, for tax invoices **and** job work delivery challans as separate document classes |

**Captured at transaction time:** invoice type (drives SAC vs HSN in Table 12) · per-line HSN/SAC
(already exists) · challan purpose (drives the Table 13 document class — comes free from movement
purpose) · cancelled state (already exists).

**Document series:** support an optional separate series per purpose — many CAs prefer contiguous ranges
per document class — but do not force it. A single series with per-row purpose is arithmetically
sufficient, and simpler for a Type A client who will never have a second class.

---

## 11. What Can Kill This

| Risk | Mitigation |
|---|---|
| **Principal visibility leak** *(top risk)* | One scoped access path (10.5). Unrecoverable if it happens — treat as existential, not as a bug class |
| **Breaking SS Engineering** | The Type A guarantee (Section 2) with a blocking regression test. Client one, live, free permanently |
| **WIP omitted, statement manufactures theft accusations** | WIP is a Step 2 requirement (8.3), not an enhancement |
| **Pool-blind consumption ships with ownership** | Fix `confirm_bom_issue` before ownership goes live (8.4) |
| **A false all-clear on compliance** | Be conservative and loud. Never suppress uncertainty. CA sign-off at Step 0 |
| **Weeks of KPML-speculative work, then a no** | Every step before 5 stands alone. Steps 1–3 ship to existing clients |
| **KPML internal politics blocking adoption** | Approach the person carrying GST and 43B(h) risk — the CA or accounts head — not procurement or IT |
| **Mother-factory pricing undefined** | Section 12. Define before Phase 1 is designed, not before the meeting |
| **Pool selection becomes friction on a daily operation** | Derive, never ask (8.4). A selector on BOM issue is a tax on every production run |
| **Bus factor — one developer, 100-node ambitions** | A clean documented full export. *"Nothing happens, your data exports cleanly and the system keeps running"* is a good answer; no answer loses the deal |
| **Vendor churn breaks the principal's experience** | The principal's numbers come from their own records (8.1), so a churned vendor degrades from two-sided to one-sided rather than breaking |

---

## 12. Pricing — The Mother Factory Account

> **[DECIDED Sept 11 2026 — SUPERSEDES THIS SECTION]**
> Pricing model: platform fee covers up to 20 vendors, ₹5,000-6,000/vendor/year overage beyond 20.
> See CLAUDE.md §Pricing for the full table.
> The sponsored-seat model described below was the original proposal and is no longer the plan.

**Still undefined. Must be settled at Step 0.** What follows is a structure to react to, not a decision.

**Price on active principal-side links, never on a tenant-level "mother factory" flag** — roles are
per-relationship (Section 2), and a binary tier breaks the first time a vendor sends something out for
plating.

| Component | Range | Covers |
|---|---|---|
| Setup | ₹1,25,000 – ₹1,50,000 | Item-code mapping, vendor master, opening balances per vendor, agreement records |
| Platform / year | ₹2,50,000 – ₹3,00,000 | Dashboards, s.143 exposure, ITC-04 working paper, 43B(h) report, reconciliation, dispute register |
| Sponsored vendor seat / year | ₹12,000 – ₹18,000 | Below Lite, deliberately — the principal buys in volume and removes your entire cost of sale |

At 30 vendors ≈ **₹7–8 lakh/year**.

**Anchor on exposure avoided, and say the numbers out loud:** one 43B(h) disallowance on ₹40 lakh of
unpaid vendor bills ≈ ₹12 lakh of additional tax. One s.143 breach on a ₹10 lakh challan ≈ ₹1.8 lakh GST
plus 18% interest running from the dispatch date. One month of three people reconciling three registers
exceeds the monthly fee on its own.

**Pilot offer so the meeting has a small yes available:** 5 vendors, 90 days, ₹75,000, fully credited
against the annual fee if they proceed. **This is only deliverable because of one-sided mode** — no vendor
onboarding required.

**Sponsored onboarding** converts thirty separate sales into one commercial conversation with the party
that has both the budget and the motive — and it solves vendor churn, since the seat is paid by the party
who needs it to exist. The vendor still gets a full account for their own business, not a stripped portal
seat. That distinction matters: portal seats get abandoned, real accounts get used.

**What would sharpen the number:** KPML's actual vendor count, their annual job work spend, and whether
they have ever taken a GST notice on job work. All three are askable through Datta Prasad and Shivprasad
without ever contacting KPML.

---

## 13. Scale Beyond KPML

The model is generic by construction (Section 2), so scaling is a sales problem, not an engineering one.

- `p2_network_links` links **any** principal to **any** job worker. Same product, same schema, zero
  KPML-specific logic.
- One-sided mode means a new principal can start **without any of their vendors on Nexflow**, and a new
  job worker can record **a principal who will never join**.
- **Networks form bottom-up.** Every job worker who records their principal creates a pending link — a
  named company, real volumes, and a vendor willing to introduce you. Over time Nexflow accumulates a map
  of who supplies whom in the Karad/Satara cluster, which tells you which principal to approach next and
  when a network has reached the density where the pitch writes itself.
- Handle that map carefully: it is aggregate data derived from customers' records. Use it to decide who to
  call. Never expose it, never surface it in the product.

**The generic story makes the KPML meeting easier, not harder.** *"We built this for you"* invites
procurement to demand customisation and price it as bespoke. *"Three factories in your own vendor base
already run this, here is your s.143 exposure"* is a product sale with references.

---

## 14. Current Status — August 29, 2026 (updated 11 Sept 2026 — see `md-audit-report.md` I1)

| Item | Status |
|---|---|
| SS Engineering (Type A) | Live, Founder plan, free permanently |
| Datta Prasad Enterprises (Type B) | Onboarded Aug 17, Pro conversion agreed ₹1,35,000, payment due 10 Sep 2026 |
| Shivprasad Industries (Type B) | Onboarding Aug 19 |
| **Job work relationship confirmed** | ✅ Shivprasad material list + KPML SAP PO |
| Auto-GRN via QR (`receive.html`) | Live |
| GSTR-2B reconciliation | Live (Pro/Founder) |
| CA export | Live |
| **P0 — invoice type check on existing clients** | ✅ Done — no live client had raised a Nexflow invoice on KPML as of Aug 24 2026. Zero exposure confirmed. |
| **CA confirmation of compliance rules** | ⚠️ **Not done — this week** |
| **`confirm_bom_issue` pool-blind fix** | ✅ Done (Step 2A, v3, Aug 25 2026) |
| `p2_tenants` contradiction in CLAUDE.md | ✅ Resolved — CLAUDE.md now states in bold that it EXISTS with 10 FK dependents |
| GSTR-1 Table 13 register | ✅ Built Aug 25 2026 |
| GSTR-1 Table 12 summary | ✅ Built Aug 25 2026 |
| Rule 55 challan compliance | Neither built nor open — explicitly dropped from scope, 2 Sept 2026, by request |
| 43B(h) fields + report | Udyam fields built Aug 25 2026; receivables report built Aug 28 2026; payables report still missing |
| Ownership columns + retrofit | ✅ COMPLETE (Aug 26 2026) |
| WIP state | ✅ COMPLETE (Aug 26 2026) |
| Movement purpose | ✅ COMPLETE (Aug 26 2026) |
| Pool-aware consumption + substitution | ✅ COMPLETE (Aug 26 2026) |
| Corrected s.143 timer | ✅ COMPLETE (Aug 26 2026) |
| Vendor-side one-sided mode | ✅ COMPLETE (Aug 26 2026) |
| Standalone regression test | ✅ COMPLETE (Aug 26 2026) |
| Payment ledger (receipts model, Step 3) | ✅ COMPLETE (Aug 28 2026) — p2_payment_receipts, payment UI on invoices.html, 43B(h) report on export.html, Telegram overdue digest |
| Supplier advance ledger (Step 3.5) | ✅ COMPLETE (2 Sept 2026) |
| Notifications (3 types, Edge Function) | ✅ COMPLETE (Aug 31 2026, Step 4) |
| Principal-side one-sided mode (Step 5) | ✅ COMPLETE (Session 9, 8 Sept 2026) — principal-dashboard.html live |
| `p2_network_links` + scoped access path (Step 6) | ✅ Built 8 Sept 2026 (Session 9) — `get_principal_vendor_material()` is the scoped access path |
| Everything in Step 7 | Not built, and gated on a named request |
| `stock-share.html` | ❌ **Cut permanently** |
| Mother factory pricing | ✅ [DECIDED Sept 11 2026] — overage-only beyond 20 vendors, ₹5,000-6,000/vendor/year. See CLAUDE.md §Pricing and §12 above. |
| KPML direct contact | Not established |

---

## 15. Open Questions — Answered

1. **Job work or purchase-and-sale?** ✅ **Job work, confirmed.** Shivprasad's list is headed "Job Work
   Material Code" with KPML's `2WST-` / `2VWST-` / `2VWCIST-` codes; KPML's SAP PO shows those codes with
   short text, quantity, still-to-deliver, net price per piece, and storage location SFG.
2. **KPML contact:** no direct contact. Reach the accounts/GST-risk owner through existing vendor
   relationships.
3. **KPML plants:** one location. Multi-plant not a priority.
4. **KPML's current software:** SAP for the PO, Tally for GST. Nexflow complements, never replaces.
5. **Mother factory pricing:** [DECIDED Sept 11 2026] — see Section 12.
6. **Payment ledger scope:** all tenants, and pitched via 43B(h) (10.4).
7. **Notification channel:** Telegram for push, in-app centre for history and detail. No email.
   **Decision final.** Runtime is a Supabase Edge Function, not Vercel.
8. **Notification independence:** all data in `p2_notifications`, owned by Nexflow. Telegram is a
   swappable pipe.
9. **Product scope:** generic — four client types, one schema, zero customer-specific logic. **Final.**
10. **Is job work tracking Pro-only?** No. Job work basics are available to Lite; the **principal side**
    is Pro.

---

## 16. Realistic Timeline

**The mental model: KPML is the destination, not the next step. The next step is always the next paying
client.**

**Revised (Sept 2026):** Step 5 one-sided mode is superseded for the immediate term. Three KPML
vendors — SS Engineering, Datta Prasad Enterprises, and Shivprasad Industries — are already live on
Nexflow, so the demo exists today on real data, not a hypothetical. Revised path: KPML read-only
dashboard (Oct) → KPML meeting with a live vendor demo (Nov) → paid pilot agreement (Dec) → full
cross-tenant write access after the pilot.

| Timeframe | Goal |
|---|---|
| **Now – 1 month** | Steps 1, 2, 3 complete. Step 4 notifications in progress. Datta Prasad Pro conversion due 10 Sep 2026 |
| **October 2026** | KPML read-only principal dashboard — material at each of the three live vendors, s.143 clock status, reconciliation gap |
| **November 2026** | KPML meeting with a **live demo on all three real vendor accounts**, not a slide |
| **December 2026** | Paid pilot agreement |
| **After the pilot** | Full principal-side write access · Step 6 cross-tenant upgrade for vendors converted during the pilot |
| **12 months+** | Step 7, each item gated on a named request |

This is **not slower** than the original plan. It front-loads work that pays regardless of KPML, and the
pilot is now anchored to three vendors' real data already live on the platform, not a hypothetical
one-sided build.

---

## 17. For Claude Code — Technical Context

### Non-negotiables

1. **Job work, not purchase-and-sale.** KPML owns all raw material throughout. Ownership never transfers.
   Vendor invoices are **job charges only, SAC 9988** — never full product value.
2. **Type A guarantee.** SS Engineering must be byte-identical across all exports, PDFs, reconciliation
   buckets and agent answers. **Any difference means the change is wrong, not the test.**
3. **`sale` and NULL are the defaults.** No backfill, no NOT NULL, no migration on any live tenant.
4. **Roles are per-relationship, never per-tenant.** No "mother factory" flag anywhere.
5. **One scoped access path** for every principal-facing read. No exceptions, no aggregates spanning
   owners.
6. **Derive the pool, never ask.** No pool selector on the BOM issue screen.

### Data model summary

- **`owned_by`** (nullable) — whose material. NULL = mine.
- **`held_by`** (nullable) — who holds it. NULL = me.
- Both on the stock ledger, carried through dispatch lines. Ownership on the **ledger**, not the material
  master.
- **Movement purpose** — 10 values (8.2), default `sale`, carries the owning principal reference.
  Stock-effect mapping in **one** definition.
- **WIP** — the missing state between consumption and return. `issued = returned + scrap + raw held + WIP`.
- **Invoice type** — `goods_sale` (default) / `job_work_charge`.

### Immediate actions before any ownership work ships

- ⚠️ **`confirm_bom_issue` v2 is pool-blind.** Its aggregate per-material check passes on total stock and
  will consume the wrong owner's material atomically, with a green toast, no error. Must become per
  (material, pool) with the pool named in the `INSUFFICIENT_STOCK` message.
- ⚠️ **P0 invoice check** — are existing clients raising full-product-value invoices on KPML?
- ⚠️ **Disable "Generate Invoice" on job-work-purpose dispatches** the day purpose lands, until the SAC
  9988 path exists. A missing button is a support question; a wrong tax invoice is a filing problem.
- ⚠️ **250-material Lite cap** must count owned materials only — fix the Aug 17 DB trigger, not just the
  UI check.
- ⚠️ **`p2_tenants` contradiction** in CLAUDE.md — resolve before writing anything that depends on it.

### Corrected compliance constants

| Rule | Correct value |
|---|---|
| s.143 — inputs | 1 year |
| s.143 — capital goods | 3 years |
| s.143 — **moulds, dies, jigs, fixtures, tools** | **No time limit** |
| s.143 — extension | Commissioner may extend (+1 yr inputs / +2 yrs capital goods) — **needs a field** |
| s.143 — clock closes on | Return **or** direct supply from job worker premises (143(1)(b)) |
| s.143 — direct supplier→job worker (s.19) | Clock starts at the **job worker's receipt date** |
| s.143(2) — accounting obligation | **The principal's**, not the job worker's |
| E-way bill — intra-state Maharashtra | **₹1,00,000** (not ₹50,000) |
| E-way bill — inter-state job work | **Any value** |
| Job work GST rate (engineering) | **18%**, SAC 9988, since 22 Sep 2025 |
| TDS on job charges | 1% individual/HUF · 2% firms/companies (s.194C → s.393(1)) |
| 43B(h) | 45 days with written agreement / 15 without · **Udyam Micro & Small only, not Medium, not traders** |
| ITC-04 | >₹5cr half-yearly (25 Oct / 25 Apr) · ≤₹5cr annual (25 Apr) |
| GSTR-1 | Job charge invoice → Table 4 · HSN/SAC summary → Table 12 · challan counts → Table 13 |

### Existing patterns to reuse (and traps to avoid)

- **Telegram:** fire from a Supabase **Edge Function** — the pattern already works in pg_net cron jobids 2
  and 3 and in `agent-query`. **Do not** add a Vercel `/api/notify` + Supabase webhook.
- **Telegram chat binding:** `t.me/<bot>?start=<token>` deep link. Never "copy your chat ID."
- **Public pages:** `receive.html` and `invoice.html` use **per-document** tokens. Never a tenant-level
  token (this is why `stock-share.html` is cut). `receive.html` must become direction-neutral.
- **Cross-tenant access:** SECURITY DEFINER RPCs only, never open RLS — and all of them behind the single
  scoped path.
- **`p2_network_links`:** carries scope + consent + revocation. **Not** a third home for
  `telegram_chat_id`.
- **Counterparty duality:** in job work the same company is both client and supplier. `p2_clients` and
  `p2_suppliers` currently split them with no link — every counterparty-grouped report is wrong until this
  is fixed.
- **Material identity:** the **principal's code is canonical** (vendors have already adopted it). Vendor's
  internal code is an optional alias. Per-tenant code uniqueness is wrong for multi-principal vendors.
- **PO push:** mirror the SAP PO — material code, short text, quantity, **still-to-deliver running
  balance**, net price per piece. A running balance, **not** a status enum.
- **Known repeated-implementation hazard in this codebase:** three dispatch pages with three invoice-button
  implementations; the "update BOTH `READ_ONLY_INTENTS` and `READ_ONLY_TEXT_INTENTS`" rule. **Do not create
  a third instance** with the purpose→stock-effect mapping.
- **`.contains()` on jsonb throws in Deno Edge Functions** — use `.filter('col', 'cs', JSON.stringify([…]))`.
- **Agent:** `buildContext()`'s `stockBalances` and every stock-reading intent need the ownership filter,
  or the AI reports stock the client does not own.

### Build sequence

**Step 0** decisions → **Step 1** Table 13 · Table 12 · Rule 55 challan · 43B(h) fields · sequence audit →
**Step 2** ownership · purpose · WIP · pool-aware consumption · s.143 timer · scrap · onboarding switches ·
vendor-side one-sided · regression test → **Step 3** payments (receipts model, TDS) → **Step 4**
notifications (3 types, Edge Function) → **Step 5** principal-side one-sided mode *(the pilot)* →
**Step 6** cross-tenant upgrade + scoped path + consent → **Step 7** gated on named requests.

---

*Last updated: August 23, 2026*
*Load `CLAUDE.md` + this file + `kpml-network-critique.md` to resume full context in a new session.*

