# KPML Network Plan — Critique, Gaps & Revised Sequence
*Deep review of kpml-network-plan.md against CLAUDE.md and external research — August 23, 2026*

---

## The One-Paragraph Verdict

The strategic read is right: this is a network problem, not an inventory problem, and the hub-and-spoke
insight is correct. But the plan is built on a transaction model that does not match what is actually
happening between KPML and its vendors, and almost every compliance feature in it is specified from
memory rather than from the statute — the Section 143 timer, the e-way bill threshold, and the challan
format are all wrong in ways that will produce false alarms and false all-clears. Separately, Phase 0
commits three-plus weeks of work to features nobody has asked for, in a month where the stated goal is
"onboard the next paying client." The single highest-value thing in this document is not in the plan at
all: **Section 43B(h)** turns the payment ledger from a tool vendors want and KPML resists into a tool
KPML's own CA will demand. Fix the data model, correct the compliance rules, lead with 43B(h), and
build the one-sided mode so KPML can pilot without onboarding 30 vendors first.

---

# FLAWS — What's Wrong in the Current Plan

## F1. The plan never decides whether this is job work or purchase-and-sale. Everything downstream is built on the wrong shape.

**What it is.** Under GST, s.2(68), job work is a process on goods *belonging to another registered
person* — ownership never transfers to the job worker. That is the single fact that separates job work
from contract manufacturing. The plan's entire narrative ("KPML sends raw materials → vendors produce →
vendors dispatch finished goods → KPML") describes job work. But every mechanic in the plan and in the
existing product describes purchase-and-sale.

**Why it's a problem.** The two models are not variations. They are different documents, different
stock treatment, different invoices, different returns:

| | Job work (free-issue) | Purchase-and-sale |
|---|---|---|
| Material ownership at vendor | KPML's | Vendor's |
| Vendor's outward document | Delivery challan for goods + tax invoice for **job charges only**, SAC 9988 | Tax invoice for **full product value**, product HSN |
| Vendor's books | Material never enters as owned stock | Material is a purchase, ITC claimed |
| KPML's books | Material stays in closing stock as "with job worker" | Material is a sale, then a repurchase |
| Statutory clock | s.143 — 1 yr inputs / 3 yrs capital goods | None |
| Returns | ITC-04, GSTR-1 Table 13 | Normal GSTR-1 |

**What breaks in practice.** Nexflow today does purchase-and-sale: a dispatch decrements the sender's
stock, a GRN increments the receiver's, and `p2_invoices` carries full product value at a flat 18% with
the product's HSN. If the real relationship is job work, then:

- The vendor's stock register shows hundreds of tonnes of material they do not own. Their closing stock
  is inflated, their CA cannot tie it to any purchase invoice, and there is no matching ITC in GSTR-2B.
  That combination — stock with no corresponding inward supply — is exactly what a s.61 scrutiny picks up.
- KPML's stock register shows material gone that they legally still own and must report.
- Every invoice Nexflow generates for that vendor is for the wrong amount, on the wrong SAC/HSN, and the
  wrong value gets reported in GSTR-1.
- Section 143, ITC-04 and the whole compliance moat are meaningless, because the plan has modelled a
  transaction to which they don't apply.

Note the classification risk cuts the other way too: if a vendor adds significant raw material of their
own, GST officers may hold it is *not* job work but a composite supply of goods. Minor additions
(consumables, fasteners) don't break it.

**Fix.** Before anything else, add a **movement purpose** dimension to every dispatch —
sale / job-work issue / job-work return / rework return / capital-goods issue / scrap return. This one
attribute decides: does stock leave the sender's *ownership*, does a s.143 clock start, is the invoice
for goods or for job charges, does the line belong in ITC-04. It must be decided before
`p2_network_links`, before the payment ledger, before notifications — all three link to dispatches and
invoices whose meaning changes.

**How to settle it in an hour, not a meeting:** look at one actual invoice Datta Prasad has raised on
KPML. If it says SAC 9988 and a per-piece job charge, it's job work. If it's full product value with a
product HSN, it's a sale. Ask their accountant, not KPML.

---

## F2. There is no "stock at job worker" bucket. Stock is modelled as single-location, single-owner.

**What it is.** `v_p2_stock_balance` is a sum of transactions per material per tenant. One bucket, one
owner, one place. SAP has carried a distinct special stock category for "material provided to vendor"
for thirty years, because it is the only correct answer to "where is my material?"

**Why it's a problem.** KPML cannot answer *"how much of my steel is at Datta Prasad right now?"* from
their own books — and that is the single question the entire plan exists to answer. The plan's answer is
to reach across into the vendor's tenant with a SECURITY DEFINER RPC.

**What breaks in practice.**
- The answer depends on the vendor being a Nexflow tenant. On day one, 27 of KPML's 30 vendors are not.
- The answer depends on the vendor's data being right — so KPML's compliance position depends on
  somebody else's data hygiene. That is not a position a CFO accepts.
- KPML's own closing stock, balance sheet, and s.143 exposure all become uncomputable from KPML's own
  records.
- Every reconciliation is a *cross-tenant negotiation* rather than a lookup.

**Fix.** Model stock as (material, ownership/location bucket): own premises · at job worker X · in
transit · held for principal Y. A job-work-purpose dispatch moves quantity between buckets instead of
destroying it. Then the mother-factory RM dashboard, the s.143 timer, ITC-04, and month-end
reconciliation all become queries on **KPML's own data**, and the cross-tenant read demotes from
source-of-truth to *corroboration* — which is what it should always have been. This is the largest
architectural change I would recommend, and it is far cheaper now than after the payment ledger and
notification system are wired into the current shape.

---

## F3. The Section 143 timer is wrong in four separate ways.

The plan: *"1-year window, computed from dispatch timestamps, red flag at 330 days, orange at 300."*

1. **Inputs are 1 year. Capital goods are 3 years. Moulds, dies, jigs, fixtures and tools have no time
   limit at all** — they may stay with the job worker permanently. A tooling dispatch flagged red at 330
   days is a false alarm, and false alarms are how you teach a user to ignore a compliance feature.
2. **When goods go directly from the supplier to the job worker** (permitted, with full ITC, under s.19),
   the clock runs from the **job worker's date of receipt**, not KPML's dispatch date. Nexflow cannot
   even represent that dispatch (see G2).
3. **The Commissioner can extend** — by up to 1 further year for inputs, 2 for capital goods. There is no
   field for an extension order, so the timer will scream about a legally extended challan.
4. **The obligation is discharged by return *or* by supply direct from the job worker's premises**
   (s.143(1)(b)) — which is precisely what the Phase 2A "consolidated dispatch pool" is. The timer must
   close on either event.

**What breaks in practice.** Two failure modes, both bad. A timer that cries wolf gets muted, and then
misses the challan that actually breached. And a *false all-clear* is worse than no feature: if Nexflow
tells KPML "all challans compliant" while 41 have quietly crossed the line — the exact scenario
documented in the Terra Insight auto-component case — Nexflow owns that conversation, and the liability
is GST plus 18% interest running retrospectively from the original dispatch date.

---

## F4. The e-way bill rule in the plan is wrong for the actual geography.

The plan: *"prompted when dispatch value > ₹50,000."*

- **Maharashtra's intra-state threshold is ₹1,00,000**, not ₹50,000 — in force since 1 July 2018.
  Karad / Satara / MIDC is intra-state for essentially everything KPML does.
- **Inter-state movement for job work requires an e-way bill irrespective of value** — even ₹5,000.

**What breaks in practice.** The prompt fires on every ₹60K intra-state dispatch where none is legally
needed (so users learn to dismiss it), and stays silent on the ₹20,000 inter-state job work dispatch
where its absence means detention and penalty at the check post. Precisely inverted.

Secondary: an e-way bill for a job work movement is generated *from the delivery challan* and needs a
consignment value. Nexflow's challan has no value column (F5).

---

## F5. Nexflow's challan is not a Rule 55-compliant delivery challan.

Rule 55(1) requires: serial number and date, consignor name/address/GSTIN, consignee name/address/GSTIN,
**HSN code and description of goods**, quantity, **taxable value**, tax rate and amount where applicable,
**place of supply where the movement is inter-state**, and signature. Issued in triplicate — *Original
for Consignee, Duplicate for Transporter, Triplicate for Consigner*.

Nexflow's challan columns, per CLAUDE.md: `SR NO | PO NO | DESCRIPTION | QUANTITY | UNIT`. No HSN. No
taxable value. No place of supply. No triplicate marking. (The *invoice* PDF has Original/Duplicate/
Triplicate. The challan does not.)

**What breaks in practice.** For a straight product sale accompanied by a tax invoice, this is largely
cosmetic. For **job work movement the delivery challan is the only document** — and an incomplete one
converts a legitimate job work movement into an unexplained movement of goods at a check post or in an
audit. This is the cheapest high-severity fix in the entire review: `hsn_sac` already exists on
`p2_raw_materials` and `p2_products`, and `p2_material_prices` / `p2_product_prices` already give a
value. The data is there; only the document is missing it.

---

## F6. The consumption-variance feature will manufacture the exact accusations it exists to prevent.

**What it is.** `expected_consumption jsonb` on the PO, compared to actual at month end, with a
vendor-logged reason code for variance and a charge for "actual material loss."

**Why it's naive.**
- **No tolerance band.** Real process loss in machining and forging runs 1–3% and is normal, unavoidable
  and priced into the job. The plan treats any variance as a signal.
- **No normal/abnormal distinction.** Normal loss is a product cost borne by the good units. Abnormal
  loss (theft, fire, careless handling) is a separate accounting event. Charging for both is the
  "blanket penalty" the plan says it is replacing.
- **Goods change identity across the job work step.** "MS round bar 40mm" goes out; "machined housing"
  comes back. Nexflow matches on material identity. There is nothing that says *one housing consumes
  2.4 kg of bar plus 0.3 kg of normal loss*.

**What breaks in practice.** A dashboard that flags 30 vendors as variant every month is noise; KPML
stops looking within two months. Worse, the vendors who were being *falsely* accused by a human are now
being falsely accused *by software*, which is more damaging because it looks objective and neutral. The
plan's stated benefit — "honest vendors benefit, only vendors who were stealing lose" — inverts exactly.

**Fix.** A per-product yield spec with an agreed tolerance band, agreed **once, by both parties, in-app,
versioned with an effective date** (see N3). Flag only breaches of the agreed band. And capture scrap
explicitly (F7), because otherwise the variance is always non-zero by the scrap amount.

---

## F7. Scrap and waste are completely absent — and that is where the actual money is.

- **ITC-04 requires losses and waste to be declared**, with UQC and quantity, in Tables 5A / 5B / 5C.
- **s.143(5):** waste and scrap generated at the job worker's premises may be supplied by the job worker
  directly on payment of tax if he is registered, or by the principal if he isn't. So scrap has both a
  tax event and a revenue event, and someone owns that revenue.

**What breaks in practice.** Today, "where did my 400 kg go?" is answered with "scrap" and nobody can
verify it. The plan's answer is a variance percentage — still unverifiable. The correct answer is a
**scrap quantity declared on the return challan**, plus a scrap disposal record if the vendor sells it.

Critically: **the Phase 2B month-end reconciliation lock cannot mathematically close without this.**
Material sent ≠ material returned + material still held, permanently, by exactly the scrap quantity. The
plan specifies a Phase 2 feature that depends on a Phase 0 data field that doesn't exist.

---

## F8. The payment ledger will be wrong on the first invoice, because of TDS.

KPML deducts TDS on job work / contractor payments — **1% for individual/HUF vendors, 2% for firms and
companies** — under s.194C (renumbered s.393(1) under the Income-tax Act 2025 from FY 2026-27).
Thresholds: ₹30,000 per single payment / ₹1,00,000 aggregate per year. Every one of these vendors is
over it.

The proposed ledger has `amount`, `payment_date`, and `status ∈ pending/overdue/paid`. There is no TDS
field, no partial payment, no debit note.

**What breaks in practice.** Invoice ₹1,00,000 → KPML pays ₹98,000 → the vendor either marks it paid and
silently loses ₹2,000 from the ledger, or leaves ₹2,000 open forever. Twelve months later the "KPML owes
me" figure is garbage and nothing ties to Form 26AS. This is the single most likely reason the payment
feature gets quietly abandoned in month two.

Also missing and equally common: **partial payments** (three tranches against one invoice is the norm),
**retention**, **debit notes for rejected material**, and GST TDS under s.51 where applicable.

**Fix.** Payments must be a *many-to-one receipts ledger* against an invoice — each receipt carrying
gross, TDS, other deduction, net, mode, reference, date — not a single-row status flag on the invoice.

---

## F9. The payment ledger is framed adversarially, which is why KPML will block it.

As specified, the vendor gets a chase-your-money tool, and KPML gets a dashboard of everything they
haven't paid. KPML's accounts head has no reason to adopt that and every reason to bury it. The plan even
identifies that person as the wedge — and then hands them a tool whose only visible function is to make
their delays public.

**What's missing is the fact that makes it KPML's own feature: Section 43B(h).**

Payment to an **Udyam-registered Micro or Small enterprise** beyond the agreed period — **45 days max
where there is a written agreement, 15 days where there isn't** — that is still outstanding on **31
March** is **disallowed as a deduction for that financial year**. KPML pays income tax on it, and gets
the deduction only in the year of actual payment. On top of that, MSMED s.16 interest runs at **three
times the RBI bank rate, compounded with monthly rests**, and is itself non-deductible.

**Consequence of leaving it out:** a payment feature nobody at KPML wants.
**Consequence of putting it in:** a 31-March exposure report that KPML's *own CA* will ask for by name.
This is the strongest single lever in the entire document, and it is a complete flip in the adoption
dynamic — from "vendors are nagging us" to "this stops us losing a deduction."

Model it correctly or it backfires: applies to **Micro and Small only** (Medium is out of scope), only to
**Udyam-registered** suppliers, and **not** where the Udyam registration is for **trading**. So the
counterparty record needs three fields: Udyam number, enterprise class, and registration activity type.

---

## F10. "Deploy payment ledger + full notification stack to all tenants this week" is the wrong Phase 0 for a three-client company.

Three paying clients. Nothing in either document says any of them asked for either feature. The stated
build trigger for both is literally "**Deploy to all tenants immediately**" — that is not a trigger, that
is enthusiasm.

The "this week" list is eleven items: two new tables with settings UI, a Realtime subscription, a new
Telegram bot, a Vercel serverless function, a Supabase webhook, a Storage bucket, a public Edge Function,
a new public page, plus wiring event types one by one. Honestly estimated for a sole developer six days
after a P0 security remediation pass: **three to four weeks**, not a week.

The plan's own timeline says the next step is "onboard the next paying client" and puts first KPML
contact 3–4 months out. Phase 0 as written closes zero sales. That violates the builder's own stated
rule: *every feature must close the next sale.*

**What breaks in practice.** Three weeks gone, a notification system with one live event type, a payment
ledger with a TDS bug, no new client — and if KPML says no in month five, the whole thing was speculative.

---

## F11. The mixed network — a few vendors on Nexflow, most not — is the actual day-one state, and there is no design for it.

KPML has 30–100 vendors. Three are on Nexflow. If KPML pilots tomorrow, **95% of their vendor traffic is
with non-Nexflow vendors.**

Every Phase 1 feature — RM dashboard, FG dashboard, dispute scanner, cross-tenant notification, PO push
with confirmation — returns nothing for those vendors. KPML opens the dashboard and sees three rows and
twenty-seven blanks. That does not read as "partial rollout." It reads as a broken product.

The implicit answer is "so onboard all 30" — thirty sales, thirty onboardings, thirty sets of master
data, by one person, before the pilot demonstrates anything.

**Fix, and it is the most important structural change in this review:** KPML must be able to run the
entire model against a **non-Nexflow vendor from their own side alone.** The vendor is a record in KPML's
tenant; dispatches are recorded; the s.143 clock runs; the material-at-vendor statement prints; the
reconciliation is one-sided. The vendor confirms receipt through the **existing public `receive.html`
link over WhatsApp** — no account, no login, no portal. When a vendor later becomes a Nexflow tenant, the
link *upgrades an existing relationship* instead of creating one.

This also does something the plan never names: it turns **KPML into the distribution channel**. Every one
of their 30 vendors starts receiving Nexflow links, seeing Nexflow challans, and confirming in Nexflow's
UI before they have ever paid for anything. That is the growth engine, and it is currently invisible in
the plan.

---

## F12. Cross-tenant stock visibility as specified is commercially unsellable to the vendor.

The plan gives KPML a live view of *the vendor's raw material stock*. But the plan itself states that
vendors "may also supply to other clients outside the KPML network," from partly the same materials.

**What breaks in practice.** KPML can infer the vendor's non-KPML business volume, their other
customers' order sizes, and how much capacity is uncommitted — which is direct negotiating leverage on
rates. No vendor knowingly agrees to that. And if a vendor discovers it *after* agreeing, the trust that
Nexflow sells is destroyed at both nodes simultaneously.

**Fix.** The unit of sharing is not "the vendor's stock." It is **"KPML-owned material at this vendor"** —
which is exactly the ownership bucket from F2. Scoped, defensible, contains zero information about the
vendor's own business, and happens to be precisely what KPML actually needs. The plan's version is
simultaneously more invasive and less useful.

Add an explicit, in-app, per-link **consent record** with a visible "KPML can see / cannot see" panel on
the vendor's side and the ability to revoke. Cross-tenant data sharing without a visible consent trail is
a reputation event waiting to happen, and under DPDP Act 2023 the trail matters wherever individuals are
identifiable in that data.

---

## F13. The mother factory is modelled as a tenant like any other, and it isn't. Plus: who at KPML sees what?

KPML plays two roles — a tenant with its own stock and GRNs, and a network operator reading across N
tenants. `p2_network_links` + SECURITY DEFINER RPCs handles the second adequately. What is never
addressed is **who at KPML sees what**. KPML has an accounts manager, a storekeeper, a purchase head and
a CA. The plan's own wedge strategy is "find the accounts manager who gets accused every month" — and
that person must not have the same access as the purchase head.

Nexflow has roles (`js/roles.js`, `ROLE_PERMISSIONS`) but no concept of *network* roles.

**What breaks in practice.** "KPML needs exactly one account" plus four people who need it equals one
shared password, which is exactly how the audit trail — the entire product promise — dies. Then Phase 3
says "KPML's CA gets one login," contradicting the one-account premise anyway. Decide now whether the
mother account is one login with roles or a tenant with staff seats; it directly affects the pricing tier
the plan admits is undefined.

---

## F14. The notification design has no deduplication, no digest, no delivery status, and no failure handling.

- **Failure:** Telegram `sendMessage` fails routinely — bot blocked, stale chat_id, rate limits. There is
  no retry, no dead-letter, and no delivery status on `p2_notifications`. A notification the plan believes
  was delivered and wasn't is worse than none, because the whole moat argument is "no one misses an event."
- **Volume:** KPML × 30 vendors × every dispatch, GRN, PO, payment and rework event = a phone buzzing
  200 times a day. Within a week KPML mutes the bot. Then the "instant alert" moat is *a muted bot.*
  The plan's own architecture note — "Telegram = the doorbell" — only holds if the doorbell rings rarely.
  At network scale it rings constantly.
- **Missing:** per-type digest-vs-instant, quiet hours, and an important-only default for the mother
  account.

---

## F15. `p2_notification_settings.tenant_id REFERENCES p2_tenants(id)` contradicts CLAUDE.md, and CLAUDE.md contradicts itself.

CLAUDE.md states as a CRITICAL invariant: *"tenant_id = user.id directly. There is NO separate tenant
table."* But the Aug 17 shipped notes say *"saveCompanyAndPlan() now upserts p2_tenants row before
p2_tenant_settings."* So `p2_tenants` exists and the central documented invariant is stale.

The plan then writes an FK against a table whose existence the project's own instruction file denies.
Resolve this in CLAUDE.md *before* anything depends on it — this is exactly the class of contradiction
that costs a day of debugging at 11pm.

Related: `telegram_chat_id` already exists (check-low-stock sends "to all tenants where agent_enabled =
true AND telegram_chat_id is not null"). The plan introduces a **second home** for the same value in a new
table, with `telegram_enabled DEFAULT false`. Depending on migration order, existing clients get either
double-notified or silently un-notified. Nothing in the plan addresses migrating the existing wiring.

---

## F16. "Payment status computed client-side" contradicts the payment_due / payment_overdue notifications.

The technical notes say status is *"computed client-side from due_date vs now()"* — "no cron." But
`payment_due` and `payment_overdue` are listed as notification types. A status that only exists at render
time in a browser fires nothing when nobody opens the page — which is exactly the case where a reminder
matters. Two sections of the same document contradict each other. The server needs the clock; the daily
8am IST cron already exists.

---

## F17. There is no reversal or correction path anywhere in the network flows.

Real operations: the storekeeper GRNs 100 instead of 10; a challan is raised against the wrong vendor; a
rework quantity is wrong. Nexflow's ledger is append-only (correct), but the plan layers cross-tenant
events on top with no defined correction semantics. Once one bad dispatch has a counterparty GRN, a s.143
clock, a payment record and three notifications keyed off it, "just cancel it" is not a one-table
operation.

Define the correction model — reversing entries linked to the original, both sides notified, the clock
re-based — **before** there are cross-tenant writes, not after the first bad one.

---

## F18. The mother-factory price is flagged as undefined, and then the whole plan is written as if it isn't.

Every Phase 1 and Phase 2 feature is KPML-specific engineering. If the number lands at ₹2L and KPML says
no, the entire investment is dead. The number must exist before Phase 1 is *designed*, not before the
meeting. And it should be anchored on what KPML **avoids**, which this research now makes quantifiable
(see N15): one 43B(h) disallowance on ₹40L of unpaid vendor bills ≈ ₹12L of extra tax; one s.143 breach on
a ₹10L challan ≈ ₹1.8L of GST plus 18% interest running from the dispatch date. Price against that, not
against seats.

---

# GAPS — Real Pain Points Not Yet Addressed

These are not errors in the plan. They are operational realities the plan has no representation for at
all — which means the first time each one occurs, the network silently produces a wrong number and
nobody knows why.

## G1. Nothing represents "what went out" versus "what should come back."

**Scenario.** KPML sends 1,000 kg of MS round bar 40mm to Datta Prasad. Six weeks later Datta Prasad
returns 380 machined housings. Somebody has to answer: is that right?

**Who feels it.** KPML's accounts manager, monthly, in the meeting where the accusation happens. And the
vendor, who has no way to prove the answer is yes.

**Consequence.** Nexflow matches on material identity, and the identity changed during the job work step.
There is nothing in the system that says one housing consumes 2.4 kg of bar plus 0.3 kg of normal loss.
So the reconciliation is arithmetic nobody can perform, which is exactly the state the network is
supposed to end. The plan's `expected_consumption jsonb` on the PO is a per-order guess typed by whoever
raised the PO, not a stable specification — it will be typed differently on the next PO for the same
part, and then two months are not comparable.

**What Nexflow should do.** A **job work yield specification** per (product, vendor): input material,
quantity per finished unit, agreed normal-loss tolerance, effective date, versioned. This is the vendor's
BOM inverted and owned by the principal. Once it exists, "is 380 housings right for 1,000 kg?" is a
lookup, the variance dashboard has a baseline that survives across months, and `expected_consumption`
becomes derived rather than typed.

---

## G2. Material bought by KPML and delivered straight to the vendor cannot be represented at all.

**Scenario.** KPML orders steel from Tata and has it delivered directly to Datta Prasad's premises. It
never touches KPML's factory. This is routine — it saves freight and double handling, and s.19 of the
CGST Act explicitly permits it with full ITC to KPML.

**Who feels it.** KPML's purchase head does it because it is cheaper. KPML's accountant then cannot
record it anywhere sensible.

**Consequence.** Nexflow has no way to express "a GRN for material I own that never arrived at my
premises." The options available today are all wrong: record a GRN at KPML (a receipt that never
happened, and the stock is not there), or record nothing (KPML's ITC has no supporting stock movement,
and the material at the vendor has no origin). Worse, the s.143 clock for these goods legally starts on
**the job worker's date of receipt**, not KPML's dispatch date — and there is no dispatch date, because
there was no dispatch.

**What Nexflow should do.** Once the ownership-bucket model exists (F2), this becomes natural: a GRN
against a purchase invoice that lands directly in the "at job worker X" bucket, with the clock anchored
to the vendor's confirmation date. Without the bucket model, there is no clean way to build it at all.

---

## G3. Multi-hop job work — vendor to vendor — has no representation.

**Scenario.** A part goes KPML → Datta Prasad (machining) → a plating shop → back to KPML. Or Datta
Prasad sub-contracts the heat treatment because their furnace is down.

**Who feels it.** Everyone, at audit. ITC-04 has **Table 5B specifically for goods received back from a
job worker other than the one they were sent to**, which exists because this is normal, not exotic. In an
industrial cluster like Karad/Satara, specialised operations (plating, heat treatment, grinding) are
almost always a different shop.

**Consequence.** The plan's model is strictly hub-and-spoke. The moment a part takes a second hop, the
challan trail has a hole exactly where an auditor looks, and KPML's "material at vendor" figure is wrong
for both vendors — over-stated at the first, absent at the second. The s.143 clock keeps running against
the wrong party.

**What Nexflow should do.** At minimum, represent it honestly: a job-work-issue dispatch from a vendor
to a third party, tagged with the principal it belongs to, so the material stays attributed to KPML
through the chain. Full multi-hop reconciliation is a later problem; silently mis-attributing the
material is a now problem.

---

## G4. Partial receipt against a challan.

**Scenario.** KPML sends 1,000 kg. Datta Prasad returns 600 units' worth this week and the balance next
month. Or returns 380 good pieces and 20 that failed inspection.

**Who feels it.** Both sides, on almost every challan. This is the normal case, not the edge case — SAP
supports partial challan reconciliation precisely because it has to.

**Consequence.** Nexflow's dispatch → GRN relationship is 1:1. With no partial model there are only two
behaviours available, and both are wrong: leave the challan fully open (the s.143 exposure figure
over-states, and the reconciliation never closes) or close it on first receipt (exposure under-states,
and the balance material becomes invisible). At scale — the practitioner benchmark is 200–400 challans a
month for a manufacturer with 20–30 job workers — this is not a rounding error. It is the difference
between the compliance number being usable and being decorative.

**What Nexflow should do.** Challan-level running balance: quantity sent, quantity returned to date,
scrap declared to date, quantity still held. Close on balance reaching zero, not on the first GRN. This
is also the natural close event for the s.143 clock (F3) and the natural unit for month-end
reconciliation (B11).

---

## G5. Rejection at the gate, before any GRN exists.

**Scenario.** The truck arrives at KPML. The storekeeper opens a box, sees the finish is wrong on 15
pieces, and sends them straight back on the same truck. Nothing is unloaded. Nothing is recorded.

**Who feels it.** KPML's storekeeper and the vendor's driver, weekly.

**Consequence.** The plan's rework flow (`p2_rework_orders`, `original_dispatch_id` referencing a
dispatch) begins *after* KPML has received and recorded the goods. But the single most common quality
event happens before that, and leaves no record on either side. The vendor's dispatch says 400 shipped;
KPML's GRN says 385 received; the 15 have no document, no defect note, and no agreed status. That
difference is then argued about at month end — which is precisely the dispute genre the network is meant
to eliminate.

**What Nexflow should do.** Quantity accepted / rejected / short-received as first-class fields on the
receiving side of a challan, with a defect note, captured at the gate. The rework order (if any) then
hangs off a real recorded rejection rather than requiring a fictional full receipt first.

---

## G6. The vendor's own material and KPML's free-issue material are the same SKU in the same rack.

**Scenario.** Datta Prasad holds 4,000 kg of MS round bar 40mm. 2,500 kg came free-issue from KPML;
1,500 kg they bought themselves for a non-KPML customer. Physically it is one pile.

**Who feels it.** The vendor, immediately and severely.

**Consequence.** This is the single most likely way Nexflow creates a *new* false accusation. The
variance dashboard sees consumption against a stock balance that mixes both sources, so material the
vendor legitimately consumed for their own customer, from their own purchased stock, appears as
unexplained consumption of KPML's material. KPML now has an automated, objective-looking report accusing
an honest vendor of theft. The tool sold as the end of accusations becomes the source of one — and the
vendor's only defence is the paperwork they already couldn't produce.

The mirror problem: KPML's stock-visibility view (F12) shows the vendor's *total* holding, revealing the
volume of their non-KPML business.

**What Nexflow should do.** Ownership is a dimension of the stock ledger, not an inference (F2). Same
material, two buckets: "own" and "held for KPML." Consumption is booked against a specific bucket,
driven by which order it was for. This one change resolves G6 and F12 together, and it is the difference
between the variance feature being trustworthy and being defamatory.

---

## G7. Nothing in the system holds the commercial terms.

**Scenario.** What is the rate per piece? Payment in 30, 45 or 60 days? What process loss is accepted
without question? Who owns the scrap? Who pays when a piece is rejected after the vendor has already
consumed the material?

**Who feels it.** Both sides, in every dispute. Every single pain point in the plan's own list traces
back to a term that lives in somebody's memory or in a WhatsApp message from 2024.

**Consequence.** Without agreed terms recorded, every disagreement is a negotiation from zero, and the
larger party wins by default. That is the mechanism behind "heavy penalty charges with no basis for
calculation" in the plan's own vendor-side pain list. Software that records events but not terms can tell
you *what happened*; it cannot tell you *whether that was allowed*, which is the actual question.

**What Nexflow should do.** A one-screen **job work agreement record** per (mother, vendor, product):
rate, payment days, agreed loss tolerance, scrap ownership, rejection policy. Versioned with effective
dates. Both sides see it; changes require both to acknowledge. This is the cheapest dispute-prevention
feature in the entire document, it is a spreadsheet's worth of data, and it converts "you're stealing"
into "the agreed tolerance is 2%, you're at 2.4%, explain the 0.4%."

---

## G8. GSTR-1 Table 13 — the challan register report nobody has built.

**Scenario.** Every month, every tenant issuing delivery challans must report in Table 13 of GSTR-1 the
serial number range of documents issued, the number cancelled, and the net issued. Today the CA counts
them by hand or estimates.

**Who feels it.** The CA, monthly, for every existing client — and the CA is the referral channel in this
market.

**Consequence of not having it.** A monthly manual task with a guessing step, on a number that must
reconcile to a continuous serial series. It is also a live risk: Table 13 assumes an unbroken sequence.
If `challan_sequence` has ever gapped — a failed insert that consumed a number — there is an
unexplainable hole in the series that surfaces at audit and nobody can account for. Worth checking
against the live data before a CA finds it.

**What Nexflow should do.** Build the report. Nexflow already holds the sequence and the cancelled state
(`cancel_challan` RPC). This is a same-day feature, it benefits all three existing paying clients, it
requires nothing from KPML, and it puts something CA-facing and visibly useful in front of the exact
person who generates referrals. It is a better Phase 0 "afternoon win" than the stock-share link by a
wide margin.

---

## G9. IMS changed how ITC actually works, and the GSTR-2B feature hasn't caught up.

**Scenario.** The Invoice Management System became mandatory from 1 October 2025, extended to all
GSTR-3B filers from 1 April 2026. From July 2026, GSTR-3B ITC is hard-locked to what flows through IMS
into GSTR-2B. The critical mechanic is **deemed acceptance**: take no action on an invoice sitting in
your IMS dashboard and it is automatically accepted into your GSTR-2B.

**Who feels it.** Every client, every month, with a hard deadline.

**Consequence.** Nexflow's reconciliation tells the owner what matched and what didn't — a retrospective
report. But under IMS the question that carries money is prospective: *which records must I accept,
reject, or keep pending before the cut-off?* An invoice a supplier filed wrongly, or a fraudulent one,
that the owner never looks at, is auto-accepted and becomes their problem. The existing feature already
highlights `ims_status === 'NO_ACTION'` rows in red — that instinct was right, but it is buried as a
highlight inside a four-bucket report rather than being the headline.

**What Nexflow should do.** Promote it: "**N invoices worth ₹X will be auto-accepted on <date> unless you
act.**" Same data, already computed, reframed as the deadline it actually is. Note also that Nexflow's
current model — reconcile GSTR-2B against GRN records — is now a step behind where the compliance action
happens. That is worth watching, though the GST-filing scope lock correctly keeps Nexflow out of actually
performing IMS actions.

---

## G10. Nothing distinguishes a job work charge invoice from a goods invoice.

**Scenario.** If this is job work (F1), the vendor's invoice on KPML is for **job charges only**, under
**SAC 9988**, at **18% for engineering and mechanical job work** since the 22 September 2025 rate
rationalisation. Not the full product value, and not the product's HSN.

**Who feels it.** The vendor's CA, at every GSTR-1 filing.

**Consequence.** Nexflow's invoice module produces a flat-18% invoice on full product value with the
product's HSN. For a sale that is right. For job work it overstates the vendor's outward supply by the
entire material value — inflating their turnover, potentially pushing them over thresholds they haven't
actually crossed (e-invoicing at ₹5 crore, ITC-04 half-yearly at ₹5 crore), and misreporting in GSTR-1.

**What Nexflow should do.** The data model can already express this — `sac_code` on tenant settings,
per-item `hsn_sac` on invoice items. What is missing is the *decision*: an invoice raised against a
job-work-purpose dispatch should default to job charges on SAC 9988, priced from the agreed rate in the
job work agreement (G7), not from `p2_product_prices`. This is a routing change, not a schema change.

---

## G11. There is no story for the one moment connectivity matters.

**Scenario.** Gate-side GRN on a phone, at a factory gate in Karad, with a truck waiting and the driver
impatient. Signal drops.

**Who feels it.** The storekeeper — the single user whose behaviour the entire moat depends on.

**Consequence.** Every claim in the moat argument depends on the record being created *at the moment of
the event*. If the fallback is "write it on paper and enter it later," then the timestamp is fiction, the
one-tap QR GRN is theatre, and the audit trail that resolves disputes is reconstructed from memory —
which is the status quo the product is sold against. The plan adds more real-time cross-tenant events on
top of this assumption without ever testing it.

**What Nexflow should do.** At minimum, know the failure mode: does the QR auto-fill GRN flow fail
loudly, or does it appear to succeed? A queued-write with a visible pending state is the honest answer,
but even a hard, unmistakable failure with a retry is better than a silent one. Worth 30 minutes of
testing at an actual client gate before building anything in Phase 1.

---

## G12. There is no dispute object — in a product whose headline feature is dispute resolution.

**Scenario.** KPML says a challan never arrived. The vendor opens the scanner, shows it was dispatched
and GRN'd, and the matter closes.

**Who feels it.** Both sides — and then nobody, because nothing is recorded.

**Consequence.** The plan's marquee claim is "resolved in 30 seconds, not 3 days," but there is no record
that a dispute occurred, who raised it, what the evidence was, or how it closed. So there is no data on
which vendor, material or route generates disputes — meaning no way to fix the *cause*, only to win each
argument faster. There is also no artefact to show a CA at year end, and no way to demonstrate to a
prospective client that the network reduced disputes, because nothing counted them.

**What Nexflow should do.** A lightweight dispute record: raised by, against what document, claim,
evidence, outcome, closed date. It costs almost nothing, it makes the value of the product *measurable*
(the strongest thing you can put in front of client 4), and it feeds the vendor scorecard with something
more meaningful than delivery dates.

---

## G13. Nothing defines what happens when a vendor stops paying.

**Scenario.** Datta Prasad churns, or their card fails, or they decide ₹64K is too much this year.

**Who feels it.** KPML — a paying customer — instantly loses a node from their dashboard, their s.143
tracking for that vendor goes dark, and the reconciliation they rely on stops.

**Consequence.** The network model creates an obligation the plan never acknowledges: KPML's product
quality depends on third parties continuing to pay. Left undefined, the first vendor churn breaks the
mother factory's experience and there is no answer in the room.

**What Nexflow should do.** Define the degraded state explicitly, and design for it once: KPML always
keeps their own side (which the ownership-bucket model guarantees — see F2), and the vendor's
confirmation loop falls back to the public link. Then a churned vendor degrades the network from
two-sided to one-sided rather than breaking it. This is another argument for building the one-sided mode
first (F11).

---

## G14. There is no exit story, and the moat argument makes one necessary.

**Scenario.** KPML's IT or their CFO asks: "if we stop paying, what happens to our data?"

**Who feels it.** You, in the KPML meeting, if you haven't got an answer.

**Consequence.** The plan's switching-cost argument is stated as: "switching means every node loses its
history, loses synchronisation, loses the dispute-free flow." Read from the buyer's side of the table
that is not a moat, it is hostage-taking, and any sophisticated buyer will hear it that way and ask the
question. Having no answer costs the deal; having a bad answer costs it louder.

**What Nexflow should do.** A documented, one-click full export — stock ledger, challans, GRNs, invoices,
payments, compliance registers — in a format a CA can actually use. It costs a day, most of the export
machinery already exists, and it makes the sale *easier*, not harder. The real moat was never the data
lock-in; it is that the counterparty is also on the system. Say that instead.

---

# BETTER IMPLEMENTATIONS — Simpler or More Robust Approaches

## B1. Ownership buckets on the stock ledger, instead of cross-tenant reads as the primary mechanism.

**Plan proposes.** `p2_network_links` + SECURITY DEFINER RPCs so KPML can read into each vendor's tenant
to see stock, consumption and challan status. This is listed as the enabling mechanism for the entire
Phase 1.

**Why it's suboptimal.** It makes the *answer* dependent on the *counterparty's software subscription*.
Three consequences follow, all bad: the feature is empty for the 90% of vendors not on Nexflow (F11), the
mother factory's compliance position depends on someone else's data hygiene (F2), and it requires an
authorization surface (link table, per-RPC checks, consent, revocation, audit) before a single useful
number appears on screen.

**Better.** Add ownership/location as a dimension on the existing append-only stock ledger. Material
KPML issues for job work moves from "own premises" to "at Datta Prasad" — it does not leave existence.
Then:

- KPML's RM dashboard, s.143 timer, ITC-04 working paper, closing-stock figure and month-end
  reconciliation are all **single-tenant queries against KPML's own data**. No RPC, no link, no consent
  needed for the core value.
- It works identically for a vendor who has never heard of Nexflow.
- The cross-tenant read demotes to what it should be — **corroboration**: "your figure says 2,500 kg,
  their figure says 2,480 kg, here are the three challans that differ." That is a genuinely better
  product than a single shared number, because in a dispute what you need is *two independent records
  that agree*, not one record both parties are told to trust.

One dimension on one ledger replaces a whole authorization architecture as the critical path. Build the
link table anyway — it is nearly free and enables the upgrade — but stop treating it as the thing that
unlocks Phase 1.

---

## B2. Fire Telegram from the existing Edge Function path, not from a new Vercel function behind a Supabase webhook.

**Plan proposes.** Insert into `p2_notifications` → Supabase Webhook → Vercel `/api/notify` → fetch
settings → Telegram Bot API. Justified as "clean, testable, swappable."

**Why it's suboptimal.** It introduces a second runtime (Vercel serverless alongside Supabase Edge
Functions), a second deploy target, a second place the Telegram token lives, and a webhook whose failures
are invisible unless you go looking for them. Meanwhile this codebase already fires Telegram from Edge
Functions in two proven places — the pg_net cron digest (jobid 2, jobid 3) and fire-and-forget calls out
of `agent-query`. The plan adds a third pattern for the same job.

**Better.** One `notify` Edge Function, called directly by whichever RPC or handler creates the
notification. Same secrets store as `RESEND_API_KEY` and the existing bot wiring, same local test story
as every other function in the project, one fewer vendor in the path, and no silent webhook failure mode.
The "swappable pipe" argument the plan makes for the Vercel function is satisfied exactly as well by an
Edge Function — the point was to isolate Telegram behind one boundary, not to isolate it *on a different
host*.

Add what the plan omits regardless of host: a delivery-status column on the notification row (queued /
sent / failed, with the error), so an undelivered buzz is visible rather than assumed.

---

## B3. Bind the Telegram chat via a deep-link start payload, not by making the owner copy a number.

**Plan proposes.** "Search @NexflowBot on Telegram, send /start, the bot replies with your Chat ID, paste
it into Settings, save." Described as one minute.

**Why it's suboptimal.** That is five steps on a phone, and step three is *read a ten-digit number off a
chat bubble and retype it into a browser form*, for a 55-year-old factory owner who is doing this once
and has no idea what a chat ID is. A mistyped digit fails silently — notifications go to nobody, or
worse, to a stranger's chat. Expect a low completion rate and a support call for every client.

**Better.** Settings generates a one-time token and renders a `t.me/<bot>?start=<token>` link (and a QR
for desktop→phone). Tapping it opens Telegram and sends the token to the bot as the first message; the
bot resolves the token server-side and binds that chat to that tenant. One tap, nothing typed, nothing
mistypeable, and the binding is confirmed back in the UI. This is a standard Telegram bot pattern and it
is the difference between the notification system being *adopted* and being *configured for two clients*.

---

## B4. One notification fan-out point, not notification code in every write path.

**Plan proposes.** "Notifications for vendor are inserted by SECURITY DEFINER RPC when an event fires on
either side" — i.e. every write path grows its own notification insert.

**Why it's suboptimal.** With sixteen notification types across dispatch, GRN, PO, rework, payment, stock
and compliance flows, the message catalogue ends up scattered across a dozen functions, and the day
someone adds a new dispatch type they forget one. This project already documents exactly this failure
class as a standing hazard — the "you must remember to update BOTH `READ_ONLY_INTENTS` and
`READ_ONLY_TEXT_INTENTS` or you get a silent blank response" rule. Do not create a third instance of the
same trap, with cross-tenant blast radius.

**Better.** A single notify entry point taking (recipient tenant, type, payload, related record), with
the title/body/action-link templates for all types living in one file. Every write path calls that one
function. Adding a type is a one-file change; auditing what fires when is reading one list. This also
makes the digest/quiet-hours logic (F14) implementable in one place rather than sixteen.

---

## B5. Compute payment status server-side.

**Plan proposes.** "Payment status computed client-side from `due_date` vs `now()` — no cron."

**Why it's suboptimal.** It directly contradicts the `payment_due` and `payment_overdue` notification
types in the same document (F16). A status that only exists when a browser renders it cannot trigger
anything for the user who isn't looking — which is the entire population the reminder exists for.

**Better.** The 8am IST cron already runs. Stamping overdue state and emitting the due/overdue
notifications there costs nothing extra and makes the feature real. Keep the client-side computation for
display responsiveness if you like; just don't let it be the only clock. The same daily pass is where the
s.143 warnings and the 43B(h) 45-day alerts should fire — one job, three high-value signals.

---

## B6. Payments as a receipts ledger against invoices, not a status column.

**Plan proposes.** One `p2_payment_records` row per obligation with `amount`, `payment_date`, and a
three-value status.

**Why it's suboptimal.** Covered in F8 — TDS, partial payments, retention and debit notes all break the
one-row model, and TDS breaks it on the very first invoice.

**Better.** Keep the obligation (what is owed, by when, against which invoice) separate from the receipts
(each actual money movement: gross applied, TDS, other deduction, net, mode, reference, date, proof).
Status becomes *derived* from the sum of receipts versus the obligation, which is both correct and
self-healing. This is the standard shape and it is not meaningfully more work than the proposed one —
it is one extra table and a sum, decided now instead of migrated painfully in six months once three
clients have live data in the wrong shape.

---

## B7. Don't build `stock-share.html`. Build the Table 13 report in that afternoon instead.

**Plan proposes.** A public, tokenised, read-only page exposing a tenant's full stock position, as the
Phase 0 "give KPML a first look" win. One afternoon.

**Why it's suboptimal.** Three reasons.

1. **What it publishes.** A factory's complete raw material position, to anyone holding the URL, forever.
   That reveals order volumes, buying patterns and capacity. For a factory owner this is competitively
   sensitive in a way a single challan is not.
2. **How it's scoped.** The token sits on `p2_tenant_settings`, so it is one token per tenant — it cannot
   be issued per-recipient, cannot expire, and cannot be revoked for one party without revoking for all.
   `receive.html` and `invoice.html` are safe precisely because their tokens are *per-document*; this
   inverts that property at the moment it matters most.
3. **What it demonstrates.** It shows KPML the vendor's whole stock, which is exactly the thing the
   vendor will object to (F12) and not the thing KPML actually needs.

**Better.** If the goal is a fast, visible win: **GSTR-1 Table 13** (G8). Same effort, benefits all three
existing paying clients rather than a prospect who hasn't been contacted, lands in front of the CA who
generates referrals, and adds zero public attack surface. If the goal is specifically a KPML teaser:
the scoped "your material at this vendor" view, per-recipient and expiring — which is the same thing you
need for Phase 1 anyway, so the afternoon isn't throwaway.

---

## B8. Purchase orders must reference real items, with an explicit per-vendor item-code map.

**Plan proposes.** `p2_purchase_orders.product_name text` and `expected_consumption jsonb` holding
material names as strings.

**Why it's suboptimal.** Free-text item names will not match across two tenants. KPML calls it
"KOSI-40"; Datta Prasad's master says "Kosi 40mm". This project has already learned this lesson twice and
written it down both times — product names being NULL at DB level and needing resolution through
`p2_products`, and client matching being done by exact `client_name` string equality "same convention
already used" elsewhere. A PO whose lines can't resolve to items on the vendor's side cannot pre-fill a
dispatch, cannot drive expected consumption, and cannot be compared to actuals — which removes every
reason to push it.

**Better.** An explicit item-code mapping per (mother, vendor): KPML's code ↔ the vendor's item. Built
once, at network onboarding, as a deliberate step — twenty minutes per vendor with a matching UI. Then
POs, expected consumption, dispatch pre-fill, variance and reconciliation all key off resolved IDs.

This is unglamorous, it is the least interesting table in the entire design, and it is the difference
between the network working and not working. Every failed enterprise supplier-integration project in
history died here.

---

## B9. One document-verification surface, not a second one for disputes.

**Plan proposes.** A new `challan-verify.html` page plus a `verify_challan_cross_tenant` RPC, alongside
the existing public `receive.html` + `receive-dispatch` function.

**Why it's suboptimal.** Both answer the same question — *does this document exist, what is its status,
has the other side recorded it* — with two implementations, two auth models and two places to fix a bug.
The codebase's own doc comments already warn about repeated reimplementation of the challan surface.

**Better.** One verification surface whose *detail level varies by requester*: anonymous holder of a
token sees existence, status and line items (what `receive.html` does today); a linked mother tenant
additionally sees the counterparty's GRN state; the issuing tenant sees everything. Same page, same
function, one branch on caller identity. It also then works for non-Nexflow vendors, which
`verify_challan_cross_tenant` structurally cannot.

---

## B10. Rework: a rejection record on the receipt, not a four-state machine plus two dispatch types.

**Plan proposes.** A `p2_rework_orders` table with a four-state status, two new `dispatch_type` values,
FKs to both the original and the rework dispatch, plus a payment flag on the vendor's invoice.

**Why it's suboptimal.** It is a lot of new surface — new table, new states, new dispatch types, new
notification types, a cross-tenant status machine and an invoice side-effect — for something that in
Phase 1 will be used a handful of times a month, and whose most common form (rejection at the gate)
the design can't even represent (G5).

**Better.** Start with quantity accepted / rejected / short on the *receiving* side of a challan line,
plus a defect note (G5). That single addition captures the most frequent event, gives the scorecard its
rejection rate, and gives the payment ledger its deduction reason — with no new state machine. A return
movement is then just a dispatch with a rework purpose (F1), linked to the rejection. Add the formal
rework order later *if* the volume justifies tracking a repair cycle across weeks; the data captured by
the lighter version is a strict subset, so nothing is wasted.

---

## B11. Close month-end per challan, not per month.

**Plan proposes.** A month-level reconciliation lock per vendor: KPML initiates, vendor explains
variance, both acknowledge, month locks, backdating prevented.

**Why it's suboptimal.** A month-level mutual lock across two tenants means one unresolved line blocks
the entire month for both parties, and "unlock" becomes an administrative favour that KPML grants —
recreating the power asymmetry the product is meant to remove. It also needs a genuine cross-tenant
agreement protocol (proposed/accepted/disputed/locked, with race conditions) which is real distributed-
systems work for a sole developer.

**Better.** Mutual close at the **challan** level: both sides agree this challan's material is fully
accounted for — returned + scrap declared + still held = sent. That is a small, concrete,
easily-understood agreement about a document both parties already hold. A month is closed when all its
challans are closed; the report writes itself. No locking protocol, no all-or-nothing blockage, and it
gives the s.143 clock (F3) and the partial-receipt balance (G4) their natural close event. Same audit
outcome, a fraction of the coordination.

---

## B12. `p2_network_links` should carry scope and consent, and should not become the third home for a Telegram chat ID.

**Plan proposes.** A link row with mother tenant, vendor tenant, an active/inactive status, and
`mother_alert_telegram_chat_id`.

**Why it's suboptimal.** Two problems. First, the link is binary — linked or not — but what a vendor is
actually consenting to is a *specific scope* ("KPML may see their own material at my premises and
documents between us"). With no scope on the link, the scope lives implicitly in whatever each RPC
happens to select, which means it drifts silently every time an RPC is edited. That is the wrong place
for a promise you made in a sales meeting.

Second, `mother_alert_telegram_chat_id` puts a Telegram chat ID on the link table — while
`p2_tenant_settings` already has one and the plan adds a third in `p2_notification_settings`. Three
copies of one identifier, updated in three places, is a guaranteed inconsistency.

**Better.** The link carries the relationship and an explicit, versioned scope plus a consent record
(who agreed, when, from where) and a revocation timestamp. Every cross-tenant RPC checks the scope, not
just the existence of the link. And Telegram routing resolves through the recipient tenant's own
notification settings — one home for the chat ID, always.

---

# NEW ADDITIONS — Features or Decisions Not Yet Considered

## N1. MSME 43B(h) exposure report — both directions. **Phase 0.**

**What it is.** Counterparty records gain three fields — Udyam number, enterprise class (Micro / Small /
Medium), and registration activity (manufacturing vs trading). From those, two reports.

*Vendor side:* "You are a registered Small enterprise. KPML owes you ₹6,40,000, of which ₹4,10,000 is
past 45 days. Statutory interest at three times the RBI bank rate, compounded monthly, is ₹X and
accruing."

*Mother side:* "₹18,60,000 of vendor bills will be **disallowed as a deduction** for FY 2025-26 if unpaid
on 31 March. At your tax rate that is roughly ₹5,60,000 of additional tax, and the deduction only returns
in the year you actually pay."

**What pain it solves.** The vendor-side pain in the plan's own list — "payment from KPML is
unpredictable, chasing it requires a phone call" — but from the only angle that makes the buyer act.

**Why it belongs here.** This is the strongest single lever in the entire strategy and it is currently
absent. As the plan stands, the payment ledger is a nag tool: vendors want it, KPML's accounts head has
every reason to bury it, and he is the person you were planning to wedge through. 43B(h) inverts that
completely — it stops being "your vendors are complaining" and becomes "you are about to lose a tax
deduction on 31 March." KPML's own CA will ask for this report by name. It is also the rare feature that
is *equally* valuable to a vendor with no KPML relationship at all, so it ships to all three existing
clients immediately and earns its keep before KPML is ever contacted.

**Watch the eligibility rules or it backfires:** Micro and Small only (Medium is out of scope), Udyam
registration required, and it does **not** apply where the counterparty's Udyam registration is for
trading. Getting this wrong in front of a CA destroys credibility on everything else in the product.

---

## N2. GSTR-1 Table 13 challan register report. **Phase 0.**

**What it is.** A monthly report: delivery challan serial range issued, number cancelled, net issued —
the exact three numbers Table 13 of GSTR-1 requires, for the selected month.

**What pain it solves.** Every client's CA currently counts these by hand or estimates them, every month.

**Why it belongs here.** Nexflow already holds the sequence and the cancelled state. It is a same-day
build, it needs nothing from KPML, it benefits all three paying clients on the day it ships, and it puts
something visibly useful in front of the CA — who is the referral channel in this market and the person
whose opinion decides whether client 4 says yes. This is a far better use of the Phase 0 afternoon than
`stock-share.html` (B7).

**Bonus that pays for itself:** building it will tell you whether `challan_sequence` has ever gapped.
Table 13 assumes a continuous series; an unexplained hole surfaces at audit. Better you find it than the
officer does.

---

## N3. A job work agreement record between mother and vendor. **Data model Phase 0, UI Phase 1.**

**What it is.** One screen per (mother, vendor, product): rate per unit, payment terms in days, agreed
process-loss tolerance, who owns the scrap, rejection and rework policy. Versioned with effective dates.
Both sides see it. Changes require both to acknowledge.

**What pain it solves.** "Stock mismatches lead to accusations and heavy penalty charges **with no basis
for calculation**" — the plan's own words, and the phrase "no basis for calculation" is the whole
problem. Terms live in memory and in 2024 WhatsApp messages, so every disagreement restarts from zero and
the larger party wins by default.

**Why it belongs here.** Software that records events but not terms can tell you *what happened*. It
cannot tell you *whether that was permitted* — which is the actual question in every dispute. It is also
the prerequisite that makes the variance feature safe (F6): without an agreed tolerance, variance
reporting is just automated accusation. And it makes the invoice correct (G10), because the job work rate
lives somewhere real instead of being typed each time.

Cheapest dispute-prevention feature in this document. A spreadsheet's worth of data.

---

## N4. Scrap declaration on the return leg, and a scrap disposal record. **Phase 1.**

**What it is.** Quantity of waste/scrap generated, declared by the vendor on the return challan; plus a
record of what happened to it — returned to the principal, sold by the vendor, or retained.

**What pain it solves.** "Raw material consumed during rework is untracked — appears as unexplained
consumption." More broadly, it is the answer to "where did my 400 kg go," which is currently answered
with the word "scrap" and no number.

**Why it belongs here.** Three separate things need it and none can work without it. **(a)** ITC-04
requires losses and waste declared with UQC and quantity in Tables 5A/5B/5C. **(b)** The month-end
reconciliation cannot arithmetically close without it — sent ≠ returned + held, permanently, by exactly
the scrap quantity (F7). **(c)** Scrap has real money and a real tax event attached: under s.143(5) a
registered job worker may supply scrap directly on payment of tax, so somebody is earning that revenue
and the agreement (N3) should say who.

---

## N5. A "material held at job worker" statement — printable, per vendor, per month. **Phase 1.**

**What it is.** One page: opening balance, material sent (challan by challan), material returned, scrap
declared, closing balance held at the vendor. Signed by both.

**What pain it solves.** "Year-end audit requires physical visits to every vendor — weeks of CA time,
still produces disputes."

**Why it belongs here.** This is the paper artefact of the trust the product sells, and in this market
paper is what people actually believe. Three things fall out of one document: it is the monthly
mutual-agreement instrument that makes disputes impossible in arrears, it is the ITC-04 working paper,
and it is what the CA asks for at year end instead of getting in a car. It is also the single most
demonstrable thing in a KPML meeting — you can put it on the table.

Only possible once ownership buckets exist (F2). Which is another reason to do those first.

---

## N6. Section 143 exposure expressed in rupees, not days. **Phase 1.**

**What it is.** Not "CH-0021 is 312 days old." Instead: "**₹14,20,000 of GST plus interest becomes
payable if these six challans are not closed by 12 September.**" Broken down by challan, with the
interest clock shown running from each original dispatch date.

**What pain it solves.** Nobody acts on a day count. Every CFO acts on a rupee figure with a date.

**Why it belongs here.** It is the same data, computed once, and it is the difference between a
compliance widget and the line item that justifies a mother-factory price tag. It is also the honest
framing of the risk — the liability genuinely is GST at the applicable rate plus 18% interest accruing
retrospectively from dispatch, and expressing it any other way understates it.

Build it only on top of a *correct* clock (F3) — right material class, right start date, extensions
honoured, closing on either return or supply-from-premises. A rupee figure computed from a wrong clock is
worse than no figure, because people will act on it.

---

## N7. Non-Nexflow vendor mode — one-sided operation. **Phase 1. This is the pilot.**

**What it is.** KPML can run the complete model against a vendor who has no Nexflow account: the vendor
is a record in KPML's tenant, dispatches are recorded, material sits in that vendor's ownership bucket,
the s.143 clock runs, the statement prints, the reconciliation is one-sided. The vendor confirms receipt
through the **existing public `receive.html` link, sent over WhatsApp** — no account, no login, no
portal, no password.

**What pain it solves.** The gap between "KPML has 30 vendors" and "three of them are Nexflow tenants."
Without this, a KPML pilot shows three populated rows and twenty-seven blanks, which reads as a broken
product rather than a partial rollout (F11).

**Why it belongs here.** Two reasons, and the second is the important one.

First, it makes a pilot possible in week one rather than after thirty sales.

Second — and this is not in the plan at all — **it turns KPML into your distribution channel.** Every one
of their vendors starts receiving Nexflow links, seeing Nexflow challans, and confirming in Nexflow's UI
before they have paid a rupee. That is a warm introduction to thirty prospects, delivered by their own
largest customer, at zero acquisition cost. Compare that to the plan's current growth model, which is one
person driving to MIDC units. The research on supplier-portal failure is unanimous that vendors abandon
portals they are forced into; this design never forces one — the vendor taps a WhatsApp link and is done,
and only upgrades to a full tenant when *they* want the stock, GST and payment features for their own
business.

---

## N8. A non-repudiation trail on public confirmations. **Phase 1.**

**What it is.** When someone confirms receipt through a public token link, capture and display who
confirmed (name typed at confirmation), when, and from what session — and show that trail on both sides'
copy of the document.

**What pain it solves.** "Disputed challan — did it arrive?" The plan's dispute scanner answers *what our
records say*. This answers *who said so, and when* — which is what makes the record evidence rather than
an assertion.

**Why it belongs here.** In the non-Nexflow vendor mode (N7), the public confirmation *is* the entire
evidentiary basis of the relationship. If it is just a token click with no attribution, then in a real
dispute the other side says "anyone with the link could have clicked that," and they are right. A typed
name and timestamp costs one input field and converts a click into a signature. This is also what makes
the evidence pack (N10) worth anything.

---

## N9. A consent and visibility panel on the vendor's side. **Ships with the first cross-tenant feature.**

**What it is.** One screen on the vendor's account: "**KPML can see:** material they own at your
premises · challans between you and them · invoices you raised on them. **KPML cannot see:** your other
clients · your other materials · your prices · your stock levels for anything they didn't send you."
Plus who agreed, when, and a revoke button.

**What pain it solves.** The objection that will end the vendor conversation: *"so my biggest customer
can see my whole business?"* (F12).

**Why it belongs here.** It is a screenshot you can put in a sales conversation that kills the objection
before it is raised, and it is the honest counterpart to asking a vendor to link their data to their
largest customer. It also forces the scope to be *stated*, which stops it drifting silently every time
someone edits an RPC (B12). Under DPDP Act 2023 a recorded consent trail matters wherever individuals
are identifiable in shared data — but the commercial reason is sufficient on its own.

---

## N10. A one-click evidence pack for a single dispute. **Phase 1.**

**What it is.** One PDF for one challan: the challan itself, the receipt confirmation with name and
timestamp (N8), the GRN as recorded on the other side, any photos (N11), the rejection record if any, and
the notification delivery log showing when each side was told.

**What pain it solves.** The moment the accusation is actually made — which happens over the phone or in
a meeting, not inside the app. What you need then is something you can send in sixty seconds that ends
the conversation.

**Why it belongs here.** It is the most demonstrable artefact in the product and it is nearly free once
the underlying data exists — it is an assembly job, not a feature. It is also what makes the dispute
register (G12) worth keeping: each dispute closes with an attached pack.

---

## N11. Photo capture at dispatch and at receipt. **Phase 1 — optional, judge it against the sales test.**

**What it is.** Attach photos to a dispatch and to a GRN. Storage already planned for payment proofs.

**What pain it solves.** Condition, quantity, packaging and damage disputes — which today are settled by
WhatsApp photos that nobody can find three months later.

**Why it might belong here.** It matches exactly what people already do, it makes the evidence pack (N10)
substantially more convincing, and it demos extremely well.

**Honest counter-argument:** it is the one item in this section that does not obviously close the next
sale. Storage costs money, photo upload on a bad gate connection is the least reliable thing in the
product (G11), and it can wait. Include it if a client asks; do not build it speculatively. Flagging it
because it is cheap and high-perceived-value, not because it is urgent.

---

## N12. ITC-04 working paper export. **Phase 2.**

**What it is.** The quarterly/annual return data laid out in the shape the form actually takes —
Table 4 (sent), 5A (received back from the same job worker), 5B (received from a different job worker),
5C (supplied direct from job worker premises), each with challan references, UQC quantities, and declared
losses and waste.

**What pain it solves.** Manufacturers above ₹5 crore turnover file this half-yearly (25 October and
25 April); below that, annually by 25 April. It is compiled by hand from challan books today, and
mismatches between the challan register and ITC-04 are the most common audit query on job work.

**Why it belongs here.** It is the natural output of everything else in this list — buckets (F2), scrap
(N4), partial receipts (G4), multi-hop (G3) — and it requires no new data collection once those exist.
It is also the CA-facing deliverable that makes the mother-factory account defensible at ₹3 lakh, since
it replaces days of a CA's time per filing.

**Phase 2, deliberately.** It depends on all the foundations, and it is worthless if built on incomplete
data — a wrong ITC-04 is worse than a hand-compiled one.

---

## N13. Sponsored vendor onboarding — KPML buys the seats. **Phase 1 commercial mechanic.**

**What it is.** KPML pays a reduced per-vendor annual fee for each vendor they want fully linked. The
vendor gets a full Nexflow tenant at no cost to themselves; KPML gets a populated network.

**What pain it solves.** The chicken-and-egg problem that kills every network product: the mother factory
gets value only when vendors are on, and each vendor has to be sold individually by one person.

**Why it belongs here.** It converts thirty separate sales — each requiring a drive, a demo, a
negotiation and an onboarding — into **one** commercial conversation, with the party that has both the
budget and the motive. It also solves the churn problem (G13), since the seat is paid by the party who
needs it to exist. And it prices honestly: below the Lite rate, because KPML is buying in volume and
removing your entire cost of sale.

The vendor still gets full value for their own business — GST, stock, invoices, payments — so this is not
a stripped "portal seat." That distinction matters: portal seats get abandoned, real accounts get used.

---

## N14. Decide the mother-factory number now, and anchor it on exposure avoided. **This week, not before the meeting.**

**What it is.** The plan flags this as undefined and then writes two phases of KPML-specific engineering
anyway (F18). Here is a defensible structure to react to.

**Structure:** a network platform fee + sponsored vendor seats, not per-user.

- **Setup:** ₹1,25,000–₹1,50,000 — includes item-code mapping (B8), vendor master, opening balances per
  vendor, and agreement records. This is real work and it is the work that makes everything else function.
- **Platform:** ₹2,50,000–₹3,00,000/year for the mother account — dashboards, s.143 exposure, ITC-04
  working paper, 43B(h) report, reconciliation, dispute register.
- **Vendor seats:** ₹12,000–₹18,000/vendor/year, sponsored by KPML (N13). Below Lite, deliberately.

At 30 vendors that is roughly ₹7–8 lakh/year. **Anchor it against what it prevents**, and say the numbers
out loud in the meeting: one 43B(h) disallowance on ₹40 lakh of unpaid vendor bills is roughly ₹12 lakh
of additional tax. One s.143 breach on a ₹10 lakh challan is ~₹1.8 lakh of GST plus 18% interest running
from the dispatch date. One month of three people reconciling three registers is more than the monthly
fee on its own.

**Pilot offer, so the meeting has a small yes available:** five vendors, ninety days, ₹75,000, fully
credited against the annual fee if they proceed. This is what makes N7 (one-sided mode) commercially
essential — you can deliver a pilot without onboarding anyone.

**What would sharpen this:** KPML's actual vendor count, their approximate annual job work spend, and
whether they have ever taken a GST notice on job work. Any one of those moves the number materially, and
all three are askable through the existing vendor relationships before the meeting ever happens.

---

# RESEARCH FINDINGS — What External Research Revealed

**Read this caveat first.** Everything below is from public secondary sources — tax portals, CA firm
writeups, practitioner blogs. It is good enough to *design* against and to tell you where the plan is
wrong. It is **not** good enough to ship a compliance feature on. Before any of the s.143, ITC-04, e-way
bill or 43B(h) logic goes live, one CA needs to confirm the specific rules against the bare Act and the
current notifications — an hour of a professional's time, ideally KPML's or a client's CA, which
doubles as a relationship-building conversation. Where sources conflict I have said so rather than
picking one.

---

## 1. Section 143 — the timer is more complicated than the plan assumes

- **Inputs: 1 year. Capital goods: 3 years.** Extendable by the Commissioner by up to a further 1 year
  (inputs) and 2 years (capital goods) on application.
- **Moulds, dies, jigs, fixtures and tools are excluded from the return requirement entirely** — they may
  remain with the job worker permanently. This is explicit in s.143 and is the single most commonly
  mis-implemented part of it.
- On non-return, the dispatch is **deemed a supply on the day the goods were originally sent out**, with
  GST plus **interest at 18% p.a. running retrospectively from that original dispatch date** — not from
  the date the breach was noticed.
- The obligation is discharged by return **or** by supplying the goods directly from the job worker's
  premises under s.143(1)(b). Direct supply requires the principal to declare the job worker's place as
  an additional place of business — **unless the job worker is registered**, which all of KPML's vendors
  are. This makes the "consolidated dispatch pool" (Phase 2A) legally cleaner than the plan realises, and
  it means the clock must close on that event too.
- **Waste and scrap** generated at the job worker's premises may be supplied by the job worker directly
  on payment of tax if he is registered, or by the principal if he is not (s.143(5)).

Sources: [TaxGuru — Job Work Procedure under GST, s.143](https://taxguru.in/goods-and-service-tax/job-work-procedure-gst-section-143-cgst-act-2017.html) · [CAclubindia — s.143 CGST: Facilitating Job Work With Discipline](https://www.caclubindia.com/articles/-section-143-of-the-cgst-act-facilitating-job-work-with-discipline-54817.asp) · [ITRnGST — Job Work and ITC Rules: the 1-Year and 3-Year Mandate](https://itrngst.com/guides/gst/job-work-itc-rules-gst-2026/)

**Impact on the plan:** F3 in full. The Phase 2C timer as specified would produce false red flags on
tooling, wrong clocks on direct dispatches, false alarms on legally extended challans, and would fail to
close on supply-from-premises.

---

## 2. Section 19 — material can go straight from the supplier to the job worker, with full ITC

The principal may claim ITC on inputs and capital goods **sent directly from the supplier to the job
worker without ever entering the principal's premises**, provided the movement is covered by the
principal's challan. Critically, in that case the one-year clock runs from **the date of receipt of the
goods by the job worker**, not from any dispatch by the principal.

Sources: [GST Gyaan — Guide on Section 19](https://gstgyaan.com/section-19-taking-of-input-tax-credit-on-inputs-and-capital-goods-sent-for-job-work) · [Income Tax Management — ITC on inputs/capital goods sent for job work (s.19)](https://incometaxmanagement.com/Pages/Tax-Ready-Reckoner/GST-India/16-how-to-take-input-tax-credit-itc-in-respect-of-inputs-capital-goods-sent-for-job-work-section-19.html)

**Impact on the plan:** G2 — Nexflow cannot represent this movement at all, and it is common because it
saves freight and double handling.

---

## 3. ITC-04 — the form's shape tells you exactly what data model you need

- **Thresholds and frequency are unchanged for FY 2026-27.** Aggregate turnover above ₹5 crore →
  half-yearly (April–September due 25 October; October–March due 25 April). Up to ₹5 crore → annual, due
  25 April.
- **Table 4** — goods sent for job work, including goods sent directly to the job worker's premises.
- **Table 5A** — received back from the *same* job worker, **and losses and wastes**.
- **Table 5B** — received back from a **different** job worker than the one originally sent to.
- **Table 5C** — goods **supplied directly from the job worker's premises**, and losses and wastes.
- Common columns across the tables: job worker GSTIN (or state if unregistered), **original challan
  number and date issued by the principal**, challan number and date issued by the job worker, nature of
  job work, description of goods, **UQC and quantity**, and **losses and waste (UQC and quantity)**.
- No late fee is prescribed for ITC-04 itself, but portal cross-checks now flag unreconciled job work
  data, and mismatches between the challan register and ITC-04 are a standard audit query.

Sources: [GST Portal — Manual: Form GST ITC-04](https://tutorial.gst.gov.in/userguide/inputtaxcredit/Manual_itc04.htm) · [Form GST ITC-04 (PDF)](https://caalley.com/forms/gstforms/FORMGSTITC-04.pdf) · [TaxGuru — Job Work under GST & ITC-04 Filing Guide](https://taxguru.in/goods-and-service-tax/job-work-gst-itc-04-filing-detailed-compliance-guide.html) · [Oxyzo — ITC-04 Filing FY 2026-27](https://www.oxyzo.in/blogs/itc-04-filing-process-benefit-exemption-and-penalties)

**Impact on the plan:** this is the most useful single artefact in the research. The form is effectively
a specification for the data model the plan is missing — **Table 5B proves multi-hop vendor-to-vendor
movement is normal (G3), Table 5C proves supply-from-premises is normal (F3/Phase 2A), and losses-and-
waste columns in every return table prove scrap must be a first-class field (F7/N4).** Design against
the form and ITC-04 export (N12) becomes nearly free later.

---

## 4. GSTR-1 Table 13 — a monthly obligation Nexflow already has the data for

Delivery challans issued for job work must be reported monthly in **Table 13 of GSTR-1**: serial number
**from** and **to**, total issued, number **cancelled**, and net issued. The series is expected to be
continuous.

Sources: [CAclubindia — Job work in GSTR-1](https://www.caclubindia.com/forum/job-work-in-gstr-1-467106.asp) · [TaxTMI — Job work delivery challan return](https://www.taxtmi.com/forum/issue?id=117071) · [CAclubindia — Delivery challan in GSTR-1](https://www.caclubindia.com/forum/delivery-challan-in-gstr-1--578015.asp)

**Impact on the plan:** G8/N2 — a same-day report off `challan_sequence` and the cancelled state, useful
to all three existing clients, CA-facing, zero KPML dependency. And a live risk to check: any historical
gap in the challan series is an audit hole with no explanation.

---

## 5. Rule 55 — what a delivery challan must actually contain

Required contents: serial number, date and place of issue; consignor name, address and GSTIN; consignee
name, address and GSTIN/UIN; **HSN code and description of goods**; quantity; **taxable value**; tax rate
and amount where applicable; **place of supply where the movement is inter-state**; signature.

Issued in **triplicate** — Original for Consignee, Duplicate for Transporter, Triplicate for Consigner.
For job work specifically: original to the job worker, duplicate to the transporter, triplicate retained.

Sources: [Pice — Delivery Challan under GST Rule 55](https://piceapp.com/blogs/delivery-challan-under-gst-rule-55/) · [Taxwink — Delivery Challan under GST: when to issue, manner and format](https://www.taxwink.com/blog/delivery-challan-under-gst-when-to-issue-and-format) · [SAG Infotech — Delivery Challan under GST](https://blog.saginfotech.com/delivery-challan-under-gst)

**Impact on the plan:** F5 — Nexflow's challan is missing HSN, taxable value, place of supply and the
triplicate marking. For job work the challan is the *only* document accompanying the goods.

---

## 6. E-way bill — the plan's ₹50,000 rule is wrong for Maharashtra and wrong for inter-state

- **Maharashtra intra-state threshold is ₹1,00,000**, in force since 1 July 2018 — not the ₹50,000
  national default.
- **Inter-state movement for job work requires an e-way bill irrespective of consignment value.**
- Maharashtra additionally exempts hank, yarn, fabric and garments moved for job work within 50 km of
  any value — not relevant to engineering, but it confirms that job work has its own carve-outs.

Sources: [Taxscan — No e-way bill in Maharashtra for intra-state supply below ₹1 lakh](https://www.taxscan.in/e-way-bill-maharashtra-intra-state-supply-goods-rs-1-lakh/25286) · [TaxGuru — Maharashtra: no intra-state e-way bill up to ₹1 lakh](https://taxguru.in/goods-and-service-tax/maharashtra-intra-state-eway-bill-upto-rs-1-lakh-1st-july.html) · [TaxGuru — E-waybill provisions for job work](https://taxguru.in/goods-and-service-tax/ewaybill-provisions-job-work.html)

**Impact on the plan:** F4 — Phase 2F's threshold logic is inverted in both directions. It would nag on
intra-state dispatches that need nothing and stay silent on the inter-state dispatch that does.

---

## 7. GST rate on job work services — 18% for engineering since 22 September 2025

The GST 2.0 rate rationalisation effective **22 September 2025** collapsed most job work entries into a
three-slab structure. **Residual job work, including mechanical and engineering job work, is 18%** — the
earlier 12% entries were rationalised away. Concessional slabs remain for specified sectors (food,
textiles, printing, leather, pharma, handicrafts at 5%; diamond job work at 1.5%). Job work services fall
under **SAC 9988**.

Sources: [Busy — Job Work HSN Code 9988 guide](https://busy.in/hsn/job-work-hsn-code/) · [GimBooks — Manufacturing Services HSN 9988 and GST rates](https://www.gimbooks.com/blog/manufacturing-services-hsn-code-9988-and-gst-rates/) · [Taxscan — GST rates for job work services, sector-wise](https://www.taxscan.in/top-stories/gst-rates-for-job-work-services-sector-wise-guide-pdf-download-1448490)

**Impact on the plan:** convenient news — 18% matches Nexflow's existing flat rate. But the *base* is
wrong: a job work invoice is raised on **job charges only under SAC 9988**, not on full product value
under the product's HSN (G10). Nexflow's schema can express this; nothing routes it.

---

## 8. IMS and GSTR-3B hard-locking — the ITC game changed underneath the existing GSTR-2B feature

- **GSTR-3B outward liability (Tables 3.1, 3.2) became non-editable from the July 2025 period**,
  auto-populated from GSTR-1/1A/IFF.
- **IMS became mandatory from 1 October 2025**, and applies to all regular taxpayers filing GSTR-3B from
  **1 April 2026**.
- **From July 2026, ITC in GSTR-3B is driven by IMS → GSTR-2B.** Only records accepted (or deemed
  accepted) in IMS flow through as eligible ITC.
- **Deemed acceptance is the trap:** take no action on a record and it is automatically accepted into
  your GSTR-2B.

Sources: [TaxUpdate India — GSTR-3B hard-locking and IMS](https://taxupdate.in/gst/783/gstr-3b-hard-locking-ims-gstr-1a-input-tax-credit-table-4-july-2026/) · [Tax Garden — IMS is now mandatory](https://taxgarden.in/blog/ims-invoice-management-system-mandatory-gst-2026) · [ClearTax Advisors — GSTR-3B hard locking + IMS guide 2025-26](https://cleartaxadvisors.in/gstr-3b-hard-locking-ims-guide/) · [IndiaFilings — Invoice Management System under GST](https://www.indiafilings.com/gst/invoice-management-system)

**Impact on the plan:** G9. This *validates* the urgency argument written into CLAUDE.md for the GSTR-2B
feature — that was a correct call. But it also means the highest-value output is no longer "here is what
matched," it is "**these N invoices worth ₹X will be auto-accepted on <date> unless you act.**" Nexflow
already computes the `NO_ACTION` rows; they are buried as a highlight instead of being the headline.

---

## 9. E-invoicing threshold — **unresolved, and a genuine risk to the invoice module**

Sources conflict, and I could not settle it:

- Multiple sources state the mandatory threshold **remains ₹5 crore** aggregate turnover (in force since
  1 August 2023), with a **30-day IRN reporting limit** for taxpayers at ₹10 crore and above from
  1 April 2025.
- At least one source claims a **reduction to ₹2 crore from 1 October 2025**, with further discussion of
  ₹1 crore or universal applicability. A direct fetch of a detailed threshold guide showed **no such
  reduction** and no notification reference.

**Why this matters more than it looks.** If any client crosses the applicable threshold, an invoice
without an IRN and signed QR is not a valid tax invoice — the buyer's ITC is at risk and the supplier
faces penalty. Nexflow's invoice module would silently become a liability rather than a feature, and the
client would not know until their buyer refused the invoice. Neither CLAUDE.md nor the plan mentions
e-invoicing anywhere.

**Action:** confirm the current threshold with a CA, then add a turnover field per tenant and a hard
warning at 80% of the applicable threshold — "you are approaching e-invoicing; Nexflow does not generate
IRNs, you will need to route invoices through an IRP." That is an honest limitation disclosed early,
which is far better than being discovered.

Sources: [GimBooks — e-invoice limit in India, updated guide](https://www.gimbooks.com/blog/e-invoice-limit-in-india/) · [IndiaFilings — mandatory e-invoicing above ₹5 crore](https://www.indiafilings.com/learn/mandatory-gst-e-invoicing-for-taxpayers-exceeds-threshold-limit-of-inr-5-crore) · [IncorpX — e-invoice limit changes April 2026](https://www.incorpx.io/blog/gst-e-invoice-turnover-limit-2026)

---

## 10. TDS on job work — the payment ledger's first bug

- **s.194C: 1% for individual/HUF contractors, 2% for other residents.** Thresholds: ₹30,000 for a single
  payment, ₹1,00,000 aggregate in a financial year.
- Renumbered **s.393(1) under the Income-tax Act 2025**, effective FY 2026-27 — rates and thresholds
  unchanged; section number, return forms and codes change.
- s.206AB (higher TDS for non-filers) was **repealed by the Finance Act 2025**, reducing one layer of
  complexity.

Sources: [Busy — s.194C TDS: rates, thresholds, composite contracts](https://busy.in/tds/section-194c-contractors-subcontractors/) · [TDSMAN — TDS on payments to contractors, s.393(1)](https://blog.tdsman.com/2026/06/tds-on-payments-to-contractors-section-3931-section-194c/) · [Batchwise — s.194C FY 2025-26 rates and s.206AB removal](https://batchwise.ai/tds/section-194c-contractor-payments/)

**Impact on the plan:** F8. Every KPML payment arrives net of 2%. A single-row `amount` + status ledger
is wrong on the first invoice and unreconcilable against Form 26AS by year end.

---

## 11. MSME 43B(h) and MSMED s.16 — the strongest commercial lever available

- **s.43B(h):** payments to suppliers registered as **Micro or Small** enterprises under Udyam must be
  made within the agreed period — **maximum 45 days where there is a written agreement, 15 days where
  there is not**. Amounts still outstanding on **31 March are disallowed as a deduction** for that year,
  and allowed only in the year of actual payment.
- **Scope limits that matter:** Micro and Small only — **Medium enterprises are excluded**. And a supplier
  whose Udyam registration is for **trading** is not a "supplier" for this purpose, so the rule does not
  apply to them.
- **MSMED s.16:** on delayed payment the buyer owes compound interest with **monthly rests at three times
  the RBI bank rate**. This interest is itself not deductible.
- **MSME Samadhaan / MSEFC:** the supplier's escalation route; disputes are to be adjudicated within 90
  days of filing.
- From FY 2026-27 these provisions consolidate into **s.37 of the Income-tax Act 2025**.

Sources: [ClearTax Advisors — s.43B(h) 45-day MSME payment rule](https://cleartaxadvisors.in/section-43bh-msme-45-day-payment-rule/) · [Busy — s.43B(h) MSME payment rule](https://busy.in/tds/section-43bh-msme-payment-rule-and-45-day-limit-explained/) · [TaxUpdate India — CBDT FAQ deep-dive on 43B(h) and s.37 transition](https://taxupdate.in/income-tax/771/cbdt-faq-deep-dive-7-section-43b-43bh-msme-section-37-income-tax-act-2025-actual-payment-tax-audit/) · [ClearTax — MSME Samadhaan](https://cleartax.in/s/msme-samadhan) · [MSME Samadhaan portal](https://samadhaan.msme.gov.in/)

**Impact on the plan:** F9/N1. This is the finding that most changes the strategy — it converts the
payment ledger from something KPML resists into something KPML's CA requests.

---

## 12. SAP MM subcontracting — what to steal, what to beat

**What SAP does right, and Nexflow should copy:**

- **Material provided to vendor is a distinct special stock category** on the principal's own books.
  Ownership never leaves the principal; the material simply sits in a different bucket. This is the
  concept the entire Nexflow plan is missing (F2).
- **Challan-to-goods-receipt reconciliation is a first-class, named process** (J1IGSUBCON / J1IFQ to
  create, J1IFR / J1IGRECON to reconcile) — the challan is not just a printed document, it is an object
  with a lifecycle that must be closed.
- **Partial reconciliation is explicitly supported**, because at any real volume it is the normal case
  (G4).
- The 541 (issue to subcontractor) / 543 (consume from subcontractor stock on receipt) pairing means
  receiving the finished good **automatically** relieves the components at the vendor — one event, both
  effects, no separate reconciliation step for the common path.

**What SAP does badly, and Nexflow can beat it on:**

- Challan generation silently fails on configuration issues (company code/plant not GST-enabled, movement
  type groups misconfigured), and the failure mode is "no challan number appeared" with no explanation —
  a recurring theme across SAP community threads.
- **Partial-quantity reversal is a known trap:** in some states the whole quantity has to be reversed
  rather than the balance, inflating stock. Reconciliation correctness depends on config nobody at the
  factory understands.
- It requires a consultant. Every one of these threads is a practitioner asking another practitioner why
  the standard process didn't work. A ₹64,000/year product that a factory owner operates from a phone
  wins on exactly this axis — **not** on features.

Sources: [SAP Help Portal — Reconciling Subcontracting Challans](https://help.sap.com/docs/SAP_S4HANA_CLOUD/634261119fec4d58970471f2c4a9a740/5dc59d1f7c4645d7ab6ca43ffaccb346.html) · [ERPVITS — Subcontracting process in SAP MM: GST and accounting entries](https://www.erpvits.com/blog/subcontracting-process-in-sap-mm/) · [SAP Community — J1IF01 subcontracting challan create](https://community.sap.com/t5/enterprise-resource-planning-q-a/j1if01-subcontracting-challan-create/qaq-p/7089709) · [SAP Community — J1IGSUBCON movement type 101 issue](https://community.sap.com/t5/enterprise-resource-planning-q-a/in-india-gst-subcontracting-process-j1igsubcon-why-movement-type-101/qaq-p/12412356)

---

## 13. Practitioner data on how job work reconciliation actually fails at scale

From a practitioner writeup on s.143 reconciliation for auto-component manufacturers — the closest
available analogue to KPML:

- **A mid-size manufacturer running 20–30 active job workers dispatches 200–400 challans a month.** That
  is the volume KPML is at. It is far past what a register and a memory can hold.
- The control is **four-way** — dispatch challan register ↔ return challan ↔ ITC-04 ↔ TDS records — and
  it "breaks at scale" beyond a few hundred challans a month.
- **Goods change form during job work** (a forging becomes a machined housing), which makes name-based
  matching unreliable. This is exactly the flaw in Nexflow's material-identity matching (G1).
- **Process loss of 1–3% requires explicit tolerance bands**, otherwise every reconciliation shows a
  variance (F6).
- A documented case: **41 challans crossed the one-year deadline with no booked return**, triggering
  deemed supply with 18% interest accruing retrospectively from dispatch.
- Persistent gaps between the challan register and ITC-04 surface as audit findings and can escalate to
  notices under s.73/74.

Sources: [Terra Insight — Sub-contractor and job work reconciliation under s.143](https://www.terra-insight.com/insights/subcontractor-job-work-reconciliation-section-143/) · [Terra Insight — ITC-04 filing for auto-component manufacturers](https://www.terra-insight.com/insights/itc-04-filing-auto-component-step-by-step-india/) · [GSTHero — GST compliance challenges manufacturers face in ITC reconciliation](https://gsthero.com/blog/2-common-gst-compliance-challenges-faced-by-manufacturers-in-itc/)

**Impact on the plan:** this is the best available external validation that the *problem* is real and
expensive at exactly KPML's scale — useful in the meeting. It also independently confirms three separate
design flaws (G1, G4, F6) and the value of the s.143 timer.

---

## 14. Enforcement climate — notices are being issued at pace

GST officers issued ASMT-10 scrutiny notices (s.61) at unprecedented volume ahead of the **31 March 2026**
expiry of the limitation period for FY 2021-22. Common triggers are system-driven: ITC claimed in GSTR-3B
exceeding GSTR-2B, and GSTR-1 versus GSTR-3B mismatches. Replies require producing the primary records —
invoices, e-way bills, ledgers, contracts.

Sources: [TaxNoticeAI — ASMT-10 reply guide, March 2026 deadline](https://taxnoticeai.app/blog/gst-asmt-10-notice-reply-guide-march-2026) · [Accorg Consulting — how to respond to ASMT-10](https://accorgconsulting.in/insights/gst-asmt-10-notice-reply)

**Impact on the plan:** the ability to produce primary records instantly is a genuine, current selling
point — and it argues for the evidence pack (N10) and the exit export (G14) being real, tested features
rather than aspirations.

---

## 15. Competitive landscape — the lane Nexflow is in is emptier than it looks

**Indian vendor-network players are financing and marketplace plays, not SaaS:**

- **Bizongo** (Mumbai, founded 2013) runs vendor digitisation plus **embedded financing** through Partner
  Hub / Procure Live, serving 1,500+ SME manufacturers for enterprise brands in packaging, apparel and
  contract manufacturing. The product is the on-ramp; the money is in financing.
- **Zetwerk** (founded 2018) is a **marketplace** — 10,000+ vetted suppliers, project management and
  payments layered on top of brokered manufacturing.

Neither sells operational job work compliance software to the vendor as the primary product. That lane —
the vendor pays for software that runs their own factory, and the network is the second-order effect —
is comparatively open.

**The cautionary tale, and it is directly on point:** Khatabook and OkCredit built exactly the two-sided
ledger the payment ledger proposes, reached enormous scale by giving it away, and **could not monetise
it**. Bookkeeping margins are thin, the lending thesis needed data they did not reliably have, and their
digital-storefront attempts were shut. The lesson is not "don't build the ledger." It is: **the ledger is
a feature, not a business.** Nexflow already charges for the operational software up front, which is the
right structure — but it means the payment ledger must earn its build cost by closing a sale (43B(h),
N1), not by accumulating users.

**Supplier-portal adoption research is unanimous, and it is the core risk to Phase 1:**

- **Portal fatigue** — suppliers already juggle a portal per customer, each with its own login, format
  and rules.
- **No value for the supplier** — a portal that serves only the buyer gets abandoned.
- **Suppliers default to the lowest-friction channel** — email, or in India, WhatsApp. If the portal is
  more work than sending a photo, they send the photo.
- Small vendors specifically lack the bandwidth for one more login.

Sources: [YourStory — Bizongo's vendor digitisation](https://yourstory.com/smbstory/bizongos-vendor-digitisation-is-reshaping-supply-chain-msme-india-large-enterprises) · [Bizongo — vendor platform](https://bizongo.com/platform/vendors) · [Zetwerk technology](https://www.zetwerk.com/technology/) · [The Ken — why Khatabook and OkCredit's kiranatech failed](https://the-ken.com/story/why-khatabook-okcredits-kiranatech-failed-to-fly-off-the-shelves/) · [Saison Capital — the shuttering of digital storefronts](https://medium.com/saison-capital/the-shuttering-of-digital-storefronts-ba0f3145a6c5) · [Blue Meteor — why most supplier portals fail](https://bluemeteor.com/why-do-most-supplier-portals-fail/) · [ecosio — web EDI portals and the supplier adoption problem](https://ecosio.com/en/blog/web-edi-portals-supplier-adoption/) · [SourceDay — supplier portal problems](https://sourceday.com/blog/supplier-portal-problems/)

**Impact on the plan — and this is the most important competitive finding.** Nexflow has a structural
advantage that the plan never states and should: **its vendors are not portal users, they are paying
customers using it as their own primary system.** Every documented cause of supplier-portal failure is
"the portal serves the buyer, not me." Nexflow inverts that — the vendor bought it for their own GST,
stock and invoicing, and the network is what they get on top. That is the real moat, and it is a far
stronger sales line than "you lose your history if you leave" (G14).

The corollary is the warning: **the moment Nexflow asks a vendor to log into something for KPML's
benefit, it becomes a supplier portal and inherits every one of those failure modes.** That is precisely
what the plan's Phase 1 does for the 27 vendors who are not customers — and precisely why the
non-Nexflow vendor mode must be a WhatsApp link with no login (N7), not an account.

---

# REVISED PRIORITY ORDER — What to Build and When

## The principle that drives the reorder

The current plan sequences by **feature ambition** — network table first, then payments, then
notifications, then cross-tenant dashboards. The revised sequence orders by two tests applied to every
item, in this order:

1. **Does it work with zero cooperation from anyone else?** Features that need only one tenant ship
   sooner, are worth something on the day they land, and are not hostage to a sales cycle.
2. **Does it close the next sale — or make the current clients harder to leave?**

Applied honestly, this moves the compliance work forward, moves the network plumbing back, and cuts two
things entirely. It also happens to de-risk the KPML bet: **every step up to Step 5 has standalone
value even if KPML never answers the phone.** That is the property the current plan does not have.

---

## Step 0 — Decide three things. Build nothing. **This week, one day.**

**(a) Job work or purchase-and-sale?** (F1) Get one invoice Datta Prasad raised on KPML. SAC 9988 and a
per-piece charge means job work; full product value on a product HSN means a sale. Ask their accountant.
This single document determines the data model, the invoice logic, whether s.143 and ITC-04 apply at all,
and therefore whether half of this review is relevant. Everything downstream is guesswork until it is
answered.

**(b) The mother-factory number.** (F18/N14) Not before the meeting — before Phase 1 is *designed*, so
you know what you are building toward and can walk away early if it is uneconomic.

**(c) Reconcile the `p2_tenants` contradiction in CLAUDE.md.** (F15) The file's most prominent CRITICAL
invariant says there is no tenant table; the Aug 17 notes say a row is upserted into one. Fix the
document before anything new depends on it.

*Why this is a step at all:* three decisions, one day, and they change what gets built in every step
below. Skipping them is how you end up migrating live client data in month four.

---

## Step 1 — Ship to the clients you already have. **1–2 weeks.**

Nothing here needs KPML, a network link, or a second tenant.

1. **GSTR-1 Table 13 challan register report** (N2) — same-day build off data you already hold.
2. **Rule 55 challan compliance upgrade** (F5) — HSN, taxable value, place of supply, triplicate marking.
   `hsn_sac` and the price tables already exist; only the document is missing them.
3. **MSME / 43B(h) fields and the overdue-with-interest view, vendor side only** (N1) — three fields on
   the counterparty record plus one report.
4. **Audit `challan_sequence` for gaps** (N2) — a query, not a feature. Find the hole before an officer
   does.

**Why first.** All four are CA-facing, and in this market **the CA is the referral channel** — the person
whose opinion decides whether client 4 signs. All four benefit SS Engineering, Datta Prasad and
Shivprasad on the day they ship. And 43B(h) is the same code that later becomes the strongest thing you
put in front of KPML — built once, used twice.

**Against the current plan:** this step does not exist. Phase 0 as written ships nothing to an existing
client.

---

## Step 2 — Movement purpose and ownership buckets. **2–3 weeks. The foundation.**

- **Movement purpose on every dispatch** (F1): sale · job-work issue · job-work return · rework return ·
  capital-goods issue · scrap return.
- **Ownership/location dimension on the stock ledger** (F2/B1): own premises · at job worker X · held for
  principal Y.
- **Correct s.143 clock** on top of it (F3): input vs capital-goods vs exempt-tooling class, extension
  field, closing on return *or* supply-from-premises, start date from the counterparty's receipt where
  the goods went direct (G2).
- **Challan-level running balance** — sent, returned, scrap declared, still held (G4).
- **Scrap declaration** on the return leg (N4).

**Why here, before payments and notifications.** Both of those link to dispatches and invoices whose
*meaning* changes with movement purpose. Building them first means migrating live client data later,
which is the most expensive mistake available in this sequence. This step also silently resolves three
of the brief's edge cases: partial receipt (G4), the vendor's own material versus KPML's free-issue
material in the same rack (G6), and material that never entered the principal's premises (G2).

**What it delivers immediately, single-tenant:** "material I hold that belongs to someone else" and
"my material held elsewhere," a correct s.143 exposure figure, and the material-at-job-worker statement
(N5). All of that works with a vendor who has never heard of Nexflow.

**Against the current plan:** this step does not exist at all, and everything in Phases 1 and 2 quietly
assumes it does.

---

## Step 3 — Payment ledger, built properly. **1–2 weeks.**

Obligations separate from receipts; TDS, partial payments and deductions modelled (F8/B6); status derived
from the sum of receipts, not stored; overdue stamped server-side by the existing 8am cron (F16/B5);
43B(h) exposure on both sides (N1).

**Why here.** It is genuinely valuable to a single tenant with no counterparty — a vendor tracking what
KPML owes them gets full value alone. And by now the invoice it hangs off has a correct movement purpose,
so a job work charge invoice and a goods invoice are distinguishable (G10).

**Against the current plan:** same feature, moved back two steps and materially re-shaped. The plan's
one-row-with-a-status-column version is wrong on the first invoice.

---

## Step 4 — Notifications, scoped hard. **1–2 weeks.**

- In-app centre plus Realtime bell — as planned, this part is right.
- Telegram via an **Edge Function**, not a Vercel function behind a webhook (B2).
- Chat binding by **deep-link start payload**, not by retyping a chat ID (B3).
- **One fan-out point**, one message catalogue (B4).
- Delivery status on each notification row (F14).
- **Three event types only** to start: challan dispatched, payment overdue, s.143 warning. Digest and
  quiet hours from day one for the mother account (F14).
- Migrate the existing `telegram_chat_id` wiring rather than creating a second home for it (F15).

**Why here and why small.** Notifications are connective tissue — they are worth building when there are
events worth connecting. Three types that fire on things that already exist beats sixteen types where
fifteen fire on features that don't. Add a type when the event that generates it ships.

**Against the current plan:** same position in principle (early), but roughly a third of the scope, one
fewer runtime, one fewer vendor, and an onboarding flow that people will actually complete.

---

## Step 5 — One-sided mother mode. **This is the KPML pilot. 2–3 weeks.**

KPML runs the entire model against vendors who are not Nexflow tenants (N7): vendors as records in their
own tenant, dispatches recorded, ownership buckets, s.143 exposure in rupees (N6), material-at-vendor
statement (N5), evidence pack (N10), confirmation by public `receive.html` link over WhatsApp with a
typed name and timestamp (N8).

**Why this is the pilot and not a fallback.** It is demonstrable in week one instead of after thirty
sales. It works at 30 vendors on day one. It is immune to vendor churn (G13). And it is the growth
engine: thirty prospects begin using Nexflow's UI, introduced by their own largest customer, at zero
acquisition cost — which is a better answer to "how do I find client 6?" than driving to MIDC units.

**Against the current plan:** this replaces the entire Phase 1 as the first thing KPML sees. The plan's
Phase 1 is cross-tenant from the first line and therefore cannot be demonstrated until vendors are
onboarded.

---

## Step 6 — The cross-tenant upgrade. **Only for vendors who are Nexflow tenants.**

`p2_network_links` with explicit scope and consent (B12), the vendor-side visibility panel (N9), scoped
corroboration reads limited to *KPML-owned material at that vendor* (F12), cross-tenant confirmation
loops, the unified document-verification surface (B9).

**Why last among the network work.** By now it is an *upgrade to a working relationship* rather than a
prerequisite for any relationship. The value proposition to the vendor is concrete and provable, because
KPML is already operating and the vendor can see what changes. And the correction model (F17) must land
here, before any cross-tenant write exists.

**Against the current plan:** `p2_network_links` still gets created early (it is nearly free), but it is
demoted from "enables everything" to "enables the upgrade." That demotion is the single biggest
structural change in this sequence.

---

## Step 7 — Everything else, each gated on a named person asking for it.

In rough order of likely demand: job work agreement record (N3) → PO push with resolved item codes (B8) →
rejection-at-gate capture (G5) → variance with agreed tolerance (F6/G1) → per-challan month-end close
(B11) → dispute register (G12) → ITC-04 working paper (N12) → rework order (B10) → vendor scorecard →
consolidated pool → e-way bill field with the *corrected* thresholds (F4).

**The gate is literal:** a named person at a named client asks for it. Not "KPML would probably want
this."

---

## Side-by-side with the current plan

| Item | Current plan | Revised | Why |
|---|---|---|---|
| `stock-share.html` + Edge Function | Phase 0, this week | **Cut** | Publishes a factory's whole stock position on a non-expiring, non-revocable tenant-level token; shows the vendor's own business to their largest customer (B7/F12) |
| GSTR-1 Table 13 report | Absent | **Step 1** | Same afternoon, benefits all three paying clients, CA-facing, zero dependencies (N2) |
| Rule 55 challan fix | Absent | **Step 1** | The document the whole network rests on is not compliant for job work (F5) |
| 43B(h) / MSME fields | Absent | **Step 1** | Strongest commercial lever in the strategy; ships to existing clients immediately (N1) |
| Movement purpose + ownership buckets | Absent | **Step 2** | Everything else is built on it; migrating later is the expensive path (F1/F2) |
| `p2_payment_records` | Phase 0, this week | **Step 3, re-shaped** | Wrong on the first invoice without TDS and partial payments (F8) |
| Notification system (16 types) | Phase 0, this week | **Step 4, 3 types** | Build types when the events exist; one runtime, not two (B2/B4) |
| `p2_network_links` | Phase 0 — "enables everything" | Created early, **load-bearing at Step 6** | The one-sided mode is what makes a pilot possible (F11/N7) |
| One-sided mother mode | Absent | **Step 5 — the pilot** | 27 of 30 vendors are not tenants on day one; also the growth engine (N7) |
| Mother RM/FG dashboards | Phase 1, cross-tenant | **Step 2 (own data) + Step 6 (corroboration)** | The core numbers should come from KPML's own books (B1) |
| s.143 timer | Phase 2C | **Step 2** | Highest-value compliance feature, needs no cross-tenant anything, makes the CA an ally (F3/N6) |
| Challan dispute scanner | Phase 1C | **Step 6, merged** | Same question `receive.html` already answers; one surface, not two (B9) |
| Rework order flow | Phase 1D | **Step 7, lighter** | Heavy state machine for a low-frequency event that can't represent the common case (B10/G5) |
| Month-end reconciliation lock | Phase 2B | **Step 7, per-challan** | Month-level mutual locking recreates the power asymmetry it's meant to remove (B11) |
| E-way bill field | Phase 2F | **Step 7, thresholds corrected** | ₹1 lakh intra-state in Maharashtra; any value inter-state (F4) |
| Mother-factory pricing | "Before the KPML meeting" | **Step 0, this week** | Two phases of KPML-specific engineering are being designed against an unknown number (F18) |

---

## What I would cut outright

- **`stock-share.html`.** (B7) Wrong data, wrong token model, wrong audience.
- **Thirteen of the sixteen notification types**, for now. (F14/B4) They notify about features that don't
  exist yet.
- **The Vercel `/api/notify` function and the Supabase webhook.** (B2) A second runtime for a job an Edge
  Function already does in this codebase, twice.

---

## Revised timeline, against the plan's own

The plan's timeline is honest about KPML — destination, not next step — and then contradicts itself by
putting three weeks of KPML-shaped work in "this week." This version keeps the plan's timeline and
changes what fills it.

| Timeframe | Current plan | Revised |
|---|---|---|
| Now – 1 month | Stock share, network links, payment ledger, full notification stack | **Steps 0–2**: decisions, CA-facing wins to existing clients, the data-model foundation |
| 1–3 months | Referrals, clients 4 and 5 | **Steps 3–4** alongside the same sales push — and now Step 1's work is *what you show* on those sales calls |
| 3–4 months | First KPML contact | **Step 5 built first**, so first contact can include a live demo on their own vendor names |
| 4–6 months | KPML meeting, demo with vendor data | Same — but the demo runs whether or not any KPML vendor is onboarded |
| 6–9 months | Pilot, Phase 0, populate network links | **Paid pilot** (₹75K / 5 vendors / 90 days), one-sided, no vendor onboarding required |
| 9–12 months | Phase 1 features | **Step 6** — cross-tenant upgrade for vendors who converted during the pilot |
| 12 months+ | Phase 2 | **Step 7**, each item gated on a named request |

The revised sequence is not slower. It front-loads the work that pays regardless of KPML, and it makes
the KPML pilot deliverable **months earlier**, because it no longer waits on thirty vendor onboardings.

---

## What can kill this — additions to the plan's own list

The plan names two risks (KPML internal politics; undefined pricing). Both are real. Four more:

1. **Building three weeks of KPML-speculative work and getting a no.** Mitigated entirely by the
   sequencing above — every step before 5 stands alone.
2. **A false all-clear on compliance.** If Nexflow shows "all challans compliant" and a breach has
   occurred, you own that conversation and the client's ₹1.8 lakh. This is the one place where being
   *conservative and loud* beats being clever: flag uncertainty, never suppress it, and get the rules
   confirmed by a CA before the feature goes live (see the caveat opening the research section).
3. **A vendor discovering KPML saw something they never agreed to.** Kills trust at both nodes at once
   and is unrecoverable in a district-sized market where everyone knows each other. The consent panel
   (N9) and scoping to KPML-owned material only (F12) are not nice-to-haves.
4. **Bus factor.** One developer, no team, and a plan that talks about 100-node networks and TATA. KPML's
   IT or a professional CFO will ask what happens if you are unavailable. "Nothing, because their data
   exports cleanly and the system keeps running" is a good answer; having no answer is a lost deal. This
   is the second commercial reason for the exit export (G14).

---

## The three questions to answer before writing any code

1. **Is the KPML relationship job work or purchase-and-sale?** One invoice settles it. Nothing in Step 2
   onward is safe to build until it is answered. *(F1)*
2. **What is the mother-factory number, and what does KPML actually spend on job work annually?** The
   second makes the first defensible. Both are askable through Datta Prasad and Shivprasad today, without
   ever contacting KPML. *(N14)*
3. **Would a CA pay for the s.143 exposure report and the ITC-04 working paper?** Ask one — a client's CA
   is free, motivated, and will tell you the truth in ten minutes. If the answer is yes, the mother
   factory is a compliance sale rather than an operations sale, which changes who you approach at KPML,
   what you demo, and how you price. That is worth knowing before you build for the wrong buyer.

---

---

# REVISED FOR GENERIC PRODUCT MODEL
*Added after confirmation of job work status and the generic-product scope decision — August 23, 2026*

## What the confirmation changes

**F1 is answered: this is job work.** Shivprasad's "Job Work Material Code" list carrying KPML's own
material codes (2WST-, 2VWST-, 2VWCIST- prefixes), matched against KPML's SAP purchase order showing
those same codes with short text, ordered quantity, a *still to be delivered* column, net price per
piece and storage location SFG, settles it. KPML is the principal under s.143; the vendors are job
workers; ownership never transfers; vendor invoices are job charges under SAC 9988; ITC-04, the return
window and the challan discipline all apply.

Two things follow immediately, and one of them is urgent.

### ⚠️ P0 — verify this week: are existing clients issuing wrong invoices *today*?

Nexflow's invoice module produces a flat-18% tax invoice on **full product value** with the **product's
HSN**. A job worker's invoice on their principal must be for **job charges only, under SAC 9988**.

If SS Engineering, Datta Prasad or Shivprasad have raised any Nexflow invoice on KPML, their GSTR-1
outward supply is overstated by the entire material value. Consequences, in order of severity: inflated
turnover that can push them across thresholds they have not actually crossed (e-invoicing, ITC-04
half-yearly filing frequency), a GSTR-1 that will not reconcile to their books, and a mismatch KPML's
own IMS dashboard will surface from the other side.

**This is a live compliance exposure on paying clients, not a design flaw in a future feature.** Check
it before building anything else. If they invoice KPML through Tally and use Nexflow only for challans,
the exposure is nil and this is a five-minute check. If they don't, it needs correcting with their CA.

The same defect blocks the "Generate Invoice" button on any job-work-return dispatch: until movement
purpose routes it, that button produces a legally wrong document. Consider disabling it on job work
dispatches the day purpose lands, before the correct SAC 9988 path is built.

### The SAP PO is a free specification — use it

The PO fields tell you exactly what PO Push must carry, and two of them correct the plan:

- **"Still to be delivered" is a running balance.** KPML already thinks in partial fulfilment. The
  plan's `p2_purchase_orders.status` enum (sent / confirmed / fulfilled / cancelled) **cannot express
  "340 of 500 delivered"** — it is a status where the source system has a quantity. PO fulfilment must
  be a running balance, not a state machine. This independently confirms G4 from the principal's side.
- **Net price per piece is the job charge**, which is the rate field the job work agreement record (N3)
  needs — and it already exists in KPML's system, so it can be pushed rather than negotiated in-app.
- **Storage location SFG** confirms the principal tracks semi-finished goods at a distinct location,
  which is the ownership-bucket concept (F2) appearing in KPML's own ERP.

**And it simplifies B8.** The vendors have already adopted the principal's material codes — Shivprasad's
own product list is headed "Job Work Material Code." So the item-code map does not need to be a
negotiated bidirectional mapping in the common case: **the principal's code is the canonical identity on
the shared object**, with the vendor's internal code as an optional alias. That is materially less work
than B8 assumed.

---

## Q1 — Does the ownership bucket model change for the generic case?

**Yes. It becomes two orthogonal dimensions instead of one enum, and that is both more correct and
simpler.**

The KPML-shaped version I proposed in F2 ("own premises · at job worker X · held for principal Y") is a
single enum that conflates two independent facts. It breaks in three places the generic model must
handle: multi-hop movement, the job worker's own view of the same material, and a tenant who is a
principal in one relationship and a job worker in another.

### The correct shape: ownership × custody

Two independent attributes on every stock movement:

| | **Custody: self** | **Custody: counterparty X** |
|---|---|---|
| **Owned by: self** | Ordinary owned stock — *the only state a standalone factory ever uses* | My material out at a job worker — **principal's view** |
| **Owned by: principal P** | Free-issue material I am holding — **job worker's view** | Material of P's that I have passed on to another job worker — **multi-hop (G3)** |

Four states from two flags. It covers every case in the brief, including the one the single-enum version
could not express: the bottom-right cell is exactly ITC-04 Table 5B, and it is unreachable with a single
location enum.

### The design test that protects existing clients

**Both dimensions default to self.** A tenant with no network relationships — SS Engineering standing
alone, or any new client — produces stock rows identical to today's, and every existing screen returns
identical numbers. The generic model must be *invisible* to a standalone factory. If it isn't, it is
wrong.

This is not a nice property, it is the migration safety guarantee for three live tenants.

### The real cost, named honestly: this is a retrofit, not an addition

Here is the thing that is easy to miss and expensive to discover late. **Principal-owned material must be
excluded, by default, from almost every existing stock-consuming surface on the job worker's side** —
because it is not their asset and has no purchase behind it:

- **Stock valuation and closing stock** — it is not theirs; including it inflates their balance sheet.
- **CA export / Tally export** — it has no purchase invoice, so it must not appear as a purchase.
- **GSTR-2B reconciliation** — this is the sharp one. Free-issue material has **no supplier invoice and
  no ITC**. If it flows into the reconciliation it appears as an unmatched purchase forever, generating
  permanent phantom entries in the "ITC Blocked" bucket. That would quietly destroy the credibility of
  the feature that currently justifies Pro pricing.
- **Low-stock alerts** — the job worker does not reorder the principal's material; the *principal* does.
  Same physical material, two different thresholds, owned by two different parties (see below).
- **Stock dashboard, reports, zero-stock and material lists.**
- **The agent.** `buildContext()` fetches `stockBalances`, and a large share of the 33 intents read stock
  — `check_stock`, `low_stock_list`, `zero_stock_list`, `stock_check_product`, `consumption_summary` and
  others. Every one needs an ownership filter, or the AI will confidently report stock the client does
  not own. An agent that gives a wrong stock number is worse than one that refuses.

**This is the single largest piece of work in the entire revised plan, and it produces no visible new
feature for a standalone factory.** It is the price of the generic model. It should be budgeted as such
and not discovered halfway through — and it argues for doing it *once, deliberately, early*, rather than
patching surfaces as bugs surface in front of clients.

### Three consequential details

**Min-stock thresholds split.** For principal-owned material, the reorder decision belongs to the
principal, and the shortfall alert should route to *them* (this is the plan's 1E low-stock-alert feature,
but arrived at correctly — it is not a special cross-tenant alert, it is simply whose material it is).
The job worker may still want their own "I am about to run out and production stops" warning. Two
thresholds, two recipients, one physical material.

**The material master needs an ownership class.** A job worker must hold principal-supplied items in
their master without those items polluting their own catalogue. Which surfaces a live gating bug:

> **The 250-material Lite cap must not count principal-owned materials.** A Lite vendor working for two
> principals could blow the cap on material they do not own, and be shown an upgrade prompt for somebody
> else's data. That is a support call and a justified refund request. The cap counts *owned* materials
> only — and this needs fixing in the DB trigger added on Aug 17, not only in the UI check.

**A plan-gating decision you now have to make.** Is job work tracking Pro-only? My recommendation: **no.**
Recording material you hold for a principal is basic operational hygiene, and most of this market are job
workers — gating it makes Lite useless to them and hands the segment to a competitor. Gate the
*principal side* (managing job workers, network dashboards, cross-tenant corroboration) as Pro, since
that is where the orchestration value and the larger customer sits. Lite job workers still get correct
stock, correct challans, correct s.143 data for their principal, and the 43B(h) payment view — all of
which makes them better prospects for the principal-side upgrade later.

---

## Q2 — Does movement purpose change for the generic case?

**Yes — three refinements, all small, one of them important for migration safety.**

### 1. Purpose describes the economic nature; direction comes from who sent it

Do not encode direction into the purpose name from one party's viewpoint. The same physical event is
"issue" to the principal and "receipt" to the job worker. Purpose says *what kind of movement this is*;
the sender and the ownership reference supply the rest.

The generic set needs more members than the KPML-shaped list in F1:

- `sale` — ordinary outright supply. **The default.**
- `job_work_issue` — principal → job worker, free-issue material.
- `job_work_return` — processed goods back to the principal.
- `unused_material_return` — unconsumed free-issue coming back **without** processing. Distinct from the
  above: it closes challan balance and s.143 exposure but has no job charge and no yield implication.
  Currently unrepresentable, and common at the end of a job.
- `scrap_return` — declared waste going back (N4).
- `rework_return` — principal → job worker, rejected goods.
- `rework_dispatch` — job worker → principal, after repair.
- `capital_goods_issue` — tooling, moulds, dies, jigs, fixtures. Drives the 3-year clock, or **no clock
  at all** for the exempt classes (F3).
- `inter_jobworker_transfer` — job worker → another job worker, material still owned by the principal.
  ITC-04 Table 5B. Required for multi-hop (G3).
- `direct_supply_from_jobworker` — job worker ships straight to the principal's customer under
  s.143(1)(b). ITC-04 Table 5C, and it **closes the s.143 clock without a physical return**.

Resist adding more until an actual client asks. Ten is already at the edge of what a dropdown on a phone
should hold; consider surfacing only the two or three valid for the current context rather than all ten.

### 2. `sale` must be the default, and every existing row must read as `sale`

This is the migration safety property. With `sale` as the default, every historical dispatch across three
live tenants keeps its current meaning, every existing report produces identical output, and the feature
is additive rather than a data migration. Any other default silently rewrites history.

### 3. The purpose must declare its own stock effect, in one place

Each purpose carries a fixed answer to two questions: *does this change ownership?* and *does this change
custody?* `sale` changes both. `job_work_issue` changes custody only. `scrap_return` changes both, in the
opposite direction. That mapping belongs in **one** definition consulted by every write path — not
re-implemented on dispatch.html, rm-dispatch.html and production-issue.html independently.

This codebase has a documented history of exactly that failure: three dispatch pages each with their own
invoice-button implementation, and the standing "update BOTH `READ_ONLY_INTENTS` and
`READ_ONLY_TEXT_INTENTS` or get a silent blank response" hazard. A third instance of the same trap, this
time silently corrupting stock ownership across tenants, is the worst version of it.

**One addition to the purpose record:** it must carry the **owning principal reference** alongside the
purpose. "Job work return" is meaningless without "of whose material." In a multi-principal vendor this
is not optional.

---

## Q3 — What emerges because a vendor can serve MULTIPLE principals at once?

This is where the generic model produces genuinely new requirements rather than generalised ones. Eight
findings, roughly in order of severity.

### M1. Material identity collides across principals

KPML's code is `2VWST-PG-L30W30T`. Principal B has their own codes, and nothing stops two principals
using the *same* code string for different physical items.

`p2_products.product_code` currently carries a unique index per tenant, and materials have
`material_code`. In a multi-principal vendor, code uniqueness per tenant is **wrong** — the identity is
(owning principal, principal's code), and the vendor's own code is a separate optional field that is
unique only across their *own* materials.

**Consequence if unfixed:** the second principal's onboarding fails on a duplicate-code constraint, or
worse, silently attaches their material to the first principal's record and every subsequent movement is
attributed to the wrong owner. That corrupts two s.143 clocks at once.

### M2. Physically identical material from two principals in the same rack — the substitution problem

KPML sends 40mm bar. Principal B sends 40mm bar. Same spec, same rack. The vendor consumes 500 kg on a
KPML order and — because it is physically indistinguishable and the KPML pile was further away — takes it
from Principal B's stock.

**This happens constantly, and it is the single biggest multi-principal risk.** Under job work it breaks
both challan trails simultaneously: KPML's material shows unconsumed while their parts were produced,
Principal B's shows consumed against nothing, and both s.143 clocks are now wrong in opposite directions.
At year end the two principals' figures cannot both be right, and the vendor cannot explain either.

**What Nexflow should do.** Force an explicit ownership choice at consumption time — which principal's
material is this coming from — and make it a one-tap default rather than a form field, because the
storekeeper will not think about it. Then support an explicit **material substitution** event: "consumed
500 kg of Principal B's stock against KPML's order," which nets off against a documented inter-principal
adjustment. Both principals see the substitution on their own statement, in their own scope, without
seeing each other.

This is a feature no ERP gives a job worker, because ERPs are built from the principal's side and each
principal's ERP is blind to the others.

### M3. Confidentiality between principals is stricter than the single-network case

KPML must not learn that the vendor also works for Principal B — **not the volumes, not the deadlines,
not the stock, not even the existence of the relationship.** N9's consent panel was written for one
principal; multi-principal makes leakage a structural risk rather than a policy one.

Specific leak channels to design against:

- **Consumption variance computed against total consumption.** If KPML's variance report divides by the
  vendor's total material consumption rather than KPML's own, it directly encodes Principal B's volume.
  This is F12 and G6 escalated to a hard requirement: every principal-facing number must be computed
  **within that principal's ownership scope only**.
- **Any aggregate at all** — total stock, capacity utilisation, "materials past expected consumption
  date" across the vendor, a network-wide scorecard percentile. Aggregates leak by construction.
- **Low-stock alerts** that fire on the vendor's total position rather than the principal's material.
- **The vendor performance scorecard** (Phase 2D) if it is ever computed across principals or benchmarked
  network-wide. Benchmarking one principal's vendors against each other is fine; benchmarking a vendor's
  KPML performance against their Principal B performance is a disclosure.

**Design rule to write down and never break:** a principal-facing query may only touch rows whose
ownership reference is that principal. No exceptions, no aggregates that span owners, no "total" columns.

### M4. Capacity and priority conflict — and the vendor-side feature that comes out of it

Two principals push POs with deadlines into the same vendor account. Nothing coordinates them; whichever
the vendor confirms first takes the shop floor.

**The opportunity:** a single consolidated production queue across all principals, visible only to the
vendor — every open PO, every deadline, ranked. **No principal would ever build this**, because each
principal's system sees only their own orders. It is the clearest example of a feature that exists only
because the vendor owns their account rather than being issued a portal login by a customer.

It is also a strong answer to "why should I pay for this rather than use my customer's portal": because
your customer's portal cannot show you your other customer's deadlines, and this can.

### M5. Whose compliance calendar? Per-principal ITC-04 obligations

ITC-04 is the **principal's** return, but the data comes from the job worker: return challan numbers,
quantities, declared scrap. Each principal has their own filing frequency — half-yearly above ₹5 crore
turnover, annual below — so a vendor with three principals owes three different data packs on up to three
different deadlines.

**Feature:** a per-principal compliance calendar on the vendor's side. *"KPML needs your ITC-04 data by
25 October. Principal B by 25 April."* Recurring, calendar-driven, and it makes the vendor the reliable
party in every relationship — which is exactly the reputation a job worker sells on.

### M6. A tenant's role is per-relationship, not a property of the tenant

SS Engineering can be a job worker for KPML **and simultaneously a principal** sending material to a
plating shop. This is normal in an industrial cluster, not exotic.

**Consequences.** The plan's `mother_tenant_id` / `vendor_tenant_id` naming bakes in a fixed identity;
generic naming (principal / job worker as *roles on a link*) is required. More importantly, **no
tenant-level "mother factory" flag, and no "mother factory plan tier"** — role is a property of each
relationship, and a tier that assumes otherwise breaks the first time a vendor sends something out for
plating.

**This refines N14's pricing structure.** Do not price on "are you a mother factory." Price on **the
number of active principal-side links** — how many job workers you manage — because that is what scales
both the cost to serve and the value delivered. It also degrades gracefully: a vendor who manages one
plating shop pays a little; KPML managing thirty pays a lot; nobody is on the wrong side of a binary.

### M7. One-sided mode is needed from the **vendor's** side too — and that is a *today* problem

My N7 designed one-sided operation from the principal's side: KPML records everything, vendors confirm
by link. Multi-principal exposes the mirror case, and it is more urgent:

**Datta Prasad and Shivprasad have KPML's material physically in their factories right now, and no
correct way to record it, because KPML is not on Nexflow and may never be.**

That reframes the entire foundation. Ownership buckets are not scaffolding for a hypothetical KPML deal
— they are **the fix for a wrong number on three paying clients' screens today**. Those clients' stock
figures currently include material they do not own, and their CA cannot reconcile it.

**Design requirement:** a job worker can record a principal who is not a Nexflow tenant — receive their
material into a principal-owned bucket, run the challan balance, declare scrap, produce the
material-held statement, and hand the principal their ITC-04 numbers — with **zero participation from the
principal.** The principal confirms by public link if they wish, and if they never do, the vendor's own
records are still correct and defensible.

### M8. Payment and 43B(h) across multiple buyers

Straightforward but worth stating: the vendor's payment ledger already spans buyers; the 43B(h) clock
runs **per buyer**, since each buyer's 45 days start from their own acceptance. A vendor with three
principals wants one view ranked by exposure and interest accruing. Small feature, no new concepts.

---

## Q4 — Does one-sided mode change for a generic principal?

**Yes, in four ways — and one of them fixes a modelling wart that already exists.**

### 1. It must run from both ends (M7)

Principal-side one-sided *and* vendor-side one-sided, as separate supported modes. The vendor-side case
is the one with paying customers waiting for it.

### 2. The counterparty must be a first-class object that upgrades in place

One-sided data has to become two-sided **without re-keying history**. The counterparty record starts as a
name and a GSTIN, and later gains a tenant reference when that company joins — same object, same id,
history intact, every challan and clock still attached.

If instead the counterparty is "a row in `p2_clients`" that gets replaced by "a network link" on
conversion, every conversion is a data migration performed by hand on a live tenant. At thirty vendors
that is thirty opportunities to corrupt a client's history.

### 3. It forces you to fix the client/supplier duality — and you should

**In a job work relationship the same company is both.** KPML sends the vendor material (supplier
behaviour) and receives finished goods and invoices (client behaviour). Today that is `p2_clients` **and**
`p2_suppliers` — two records, two tables, no link between them.

**What breaks:** every report that groups by counterparty splits KPML in half. The payment ledger sees a
client. The GRN sees a supplier. The s.143 clock needs both legs and cannot join them. The 43B(h) view
needs the buyer identity that lives on the client record while the material came in on the supplier
record. Any "statement of account with KPML" is unbuildable.

**Fix:** one counterparty identity with roles attached (customer / supplier / principal / job worker), or
at minimum a hard link between the two existing records for the same party. This is unglamorous, it is
not on anyone's roadmap, and every downstream network feature quietly depends on it.

### 4. Public confirmation must be symmetric and self-serve

`receive.html` today is written for one direction: a recipient confirming inbound goods. In generic
one-sided mode a **principal's storekeeper** taps a WhatsApp link to confirm goods returned *to* them.
Same surface, opposite direction — the page's language and framing must stop assuming who is receiving
from whom.

And onboarding must be self-serve. A generic principal has no relationship with you and will never take
a sales call to enable a vendor's paperwork. If adding a principal requires anything from Nexflow, it
will not happen at scale.

---

## Q5 — New risks and opportunities from the generic model

### Risks

**R1. The retrofit is expensive and invisible.** The ownership dimension touches every stock read in the
product and delivers no new feature to a standalone factory. It is the largest single cost in the plan
and the least demonstrable. Budget it honestly; do it once, deliberately; do not discover it surface by
surface as clients report wrong numbers.

**R2. Regression risk to three live tenants.** SS Engineering must never break. The default-to-self
property (Q1) is the guarantee, and it needs an explicit before/after check on a tenant with no network
relationships — same materials, same balances, same CA export, same agent answers.

**R3. The agent will confidently lie.** Stock-reading intents that ignore ownership will report the
principal's material as the client's own. A wrong number from a chat interface is trusted more than a
wrong number in a table, which makes this worse than a normal bug.

**R4. Support burden for a sole developer.** A Lite vendor with three principals and mis-assigned
material is a genuinely hard support call. Mitigation is design-side: make the ownership choice
one-tap-defaulted at consumption, make substitution (M2) an explicit recorded event rather than something
to be untangled later, and make the material-held statement (N5) the self-service diagnostic.

**R5. Scope discipline is now under more pressure, not less.** "Generic" is a licence to build
abstractions nobody asked for. The rule stands: each item ships when a named client needs it. The generic
model changes *how* things are built, not *how many*.

### Opportunities

**O1. The moat is stronger than the plan claimed — and it is a better argument.** In a multi-principal
world the **vendor** is the hub of their own relationships. Datta Prasad's account holds KPML's work
*and* Principal B's work; KPML cannot force them off it, because leaving costs them a relationship KPML
does not control. That is a far better moat than "you lose your history if you leave" (G14) — it is
positive rather than punitive, and it survives the CFO question.

**O2. Networks can form bottom-up, with no principal ever signing.** Because vendor-side one-sided works
(M7), every job worker who records their principal creates a *pending link*: a named company, real
volumes, and a vendor with a working relationship who can introduce you. The current plan's growth model
is one person driving to MIDC units. This one accumulates warm leads as a by-product of clients using the
product correctly.

**O3. You accumulate a map of who supplies whom in the Karad/Satara cluster.** Every recorded principal
relationship is a node. That is a genuinely valuable strategic asset for sequencing sales — you will know
which principal has the most Nexflow vendors already recording their material, and that principal is the
easiest one to approach, whether or not it is KPML. It also tells you when a network has reached the
density where the principal-side pitch writes itself.

Handle it with care: it is aggregate data derived from customers' records. Use it to decide who to call,
never expose it, and never let it appear in a product surface.

**O4. The generic story makes the KPML meeting easier, not harder.** "We built this for you" invites
procurement to demand customisation and price it as bespoke software. "Three factories in your own vendor
base already run this; here is what it does; here is your s.143 exposure" is a product sale with
references. The generic model is a stronger commercial position, not a compromise.

**O5. Multi-principal features are defensible against ERP.** The consolidated production queue (M4), the
substitution ledger (M2) and the per-principal compliance calendar (M5) are all structurally impossible
for a principal's ERP to provide, because each ERP sees one relationship. These are the features that
make the vendor's account *theirs*, and they are the direct antidote to the supplier-portal failure mode
in the research section.

---

## Per-section deltas — what changes in the rest of this document

**FLAWS.**
`F1` is answered — replace "decide which model" with "implement job work correctly," and note that
purpose defaults to `sale`. `F2` is superseded by the two-dimension ownership × custody model above, and
is now urgent for existing clients rather than foundational for KPML (M7). `F11` and `F12` generalise
unchanged but harden: confidentiality is now a multi-principal structural requirement (M3), not a
single-consent policy. `F13`'s network roles become per-relationship roles (M6). **New flaw class:** the
250-material Lite cap and the plan-gating question both interact badly with principal-owned material
(Q1), and the DB trigger added on Aug 17 needs the same fix as the UI check.

**GAPS.**
`G3` (multi-hop) is promoted — it is now reachable in the data model rather than unrepresentable, and
ITC-04 Table 5B names it. `G6` (vendor's own material vs the principal's) becomes M2, upgraded from a
reporting hazard to a data-integrity event with a designed resolution. `G10` (job charge invoice) becomes
a **P0 live-client check**, not a future gap. `G2` (direct supplier → job worker) is unchanged and still
needed. **New gaps:** M1 code collision, M3 confidentiality, M4 capacity conflict, M5 per-principal
compliance calendar, and the client/supplier duality in Q4.

**BETTER IMPLEMENTATIONS.**
`B1` is restated as ownership × custody, and its justification strengthens: it now serves four tenant
shapes rather than one. `B8` gets *simpler* — the principal's code is canonical, since vendors have
already adopted it. `B12`'s link scoping becomes mandatory rather than advisable (M3), and the link's
role naming must be generic (M6). **New:** the purpose→stock-effect mapping must live in one definition
(Q2.3).

**NEW ADDITIONS.**
`N1` (43B(h)) generalises to any buyer and gains a per-buyer ranking (M8). `N5` (material-held statement)
becomes **per principal** and doubles as the vendor's self-service diagnostic. `N7` splits into two modes,
with the vendor-side one first and urgent (M7). `N9`'s consent panel must state that other principals are
invisible. `N12` (ITC-04) becomes per-principal and calendar-driven (M5). `N14` prices on **active
principal-side links**, not on a mother-factory flag (M6). **New additions:** consolidated production
queue (M4), substitution ledger (M2), per-principal compliance calendar (M5).

**RESEARCH FINDINGS.**
Unchanged and now more load-bearing — the job work confirmation means every s.143, ITC-04, Rule 55 and
SAC 9988 finding applies directly to three paying clients today rather than to a prospective deal. The
CA verification recommended at the top of that section is now more urgent, not less. Finding 12 (SAP)
gains weight: KPML's own SAP PO confirms the storage-location and partial-delivery concepts independently.

**REVISED PRIORITY ORDER.**
The sequence holds. Three changes:

1. **Add to Step 0:** the P0 invoice check. It is a phone call, and it may be a live compliance exposure.
2. **Step 2 is re-justified and moves up in importance.** It was "foundation for a KPML deal." It is now
   "three paying clients' stock numbers are wrong today." Same work, entirely different urgency, and it
   is now defensible to a client rather than speculative. Budget the retrofit (R1) explicitly.
3. **Step 5 splits.** Vendor-side one-sided mode (M7) moves *into* Step 2, because it is the same work and
   it is what makes Step 2 visible to existing clients. Principal-side one-sided mode stays at Step 5 as
   the pilot vehicle for any principal, KPML or otherwise.

Everything else — Steps 1, 3, 4, 6, 7, the cuts, and the risk list — stands as written.

---

## The one-line summary of this revision

The generic model does not add features; it changes the shape of the foundation from a single enum to two
orthogonal dimensions, and in doing so converts the ownership work from **speculative KPML scaffolding**
into **a correction of wrong numbers on three paying clients' screens today** — while making the moat the
vendor's multi-principal account rather than data lock-in.

---

---

# REVISED FOR GENERIC PRODUCT MODEL + MIXED STOCK REALITY
*Added after confirmation of the five real client scenarios — August 23, 2026*

## Two corrections before the answers

**Correction 1 — to your Q5 premise.** Job work returns do **not** go in Table 13 while own sales go in
Table 4. That framing conflates two different things:

- The **return of goods** to the principal is **not an outward supply at all**. It is a non-supply
  movement under a Rule 55 delivery challan. It has no taxable value anywhere in GSTR-1. It appears
  only as a *document count* in Table 13.
- The **job charge invoice** *is* an outward supply, and it goes in **Table 4 (B2B)** — the **same table
  as own sales**. They are not different tables. They are different rows in the same table,
  distinguished by SAC 9988 versus the product HSN, and by value (job charge versus full product value).

The real split a Type D vendor needs is across **Table 4** (both invoice kinds, different rows),
**Table 12** (HSN/SAC summary spanning both), and **Table 13** (document counts spanning invoices and
job work challans). Detail in Q5 below.

**Correction 2 — to something I wrote earlier in F1.** I noted that a job worker adding significant own
material risks reclassification as a composite supply of goods. The rulings lean the other way: the test
is whether the process is performed on goods belonging to another registered person, and there is **no
minimum-material threshold** the job worker must observe. Using own material or consumables does not by
itself break job work status. Scenario B is therefore safer than I implied — a job worker adding their
own consumables is still doing job work. What *does* break it is ownership: if the vendor buys the main
material themselves, it is a sale, not job work.

---

## The finding that changes who you sell this to

**Section 143(2): "The responsibility for keeping proper accounts for the inputs or capital goods shall
lie with the principal."** The job worker is not required to maintain those records under s.143(2).

Read that carefully, because it cuts both ways and neither is obvious:

**Commercially, the compliance buyer is the principal.** KPML carries the legal obligation, the deemed-
supply liability, the interest exposure and the ITC-04 filing. The s.143 dashboard, the challan register
and the ITC-04 working paper are *their* statutory problem. This confirms the mother-factory account
should be priced as a compliance product (N14) and approached through whoever owns GST risk, not through
procurement.

**But the data originates entirely at the job worker**, who has no legal obligation to produce it. That
asymmetry is the network gap stated in one line, and it explains why the two sides need different pitches:

- **To the principal:** "this is your liability and you cannot currently see it."
- **To the job worker:** *not* "you must comply" — that is false and a CA will say so. The honest pitch is
  **"your principal will ask you for these numbers, repeatedly, and you cannot produce them today. Be the
  vendor who answers in ten seconds and never gets accused."** Plus the parts that genuinely are their
  own obligation: their own stock, their own invoices, their own GSTR-1 tables, their own 43B(h) position.

Do not oversell s.143 to a job worker as their compliance requirement. Getting caught overstating a
statutory obligation in front of a client's CA would cost more credibility than the feature is worth.

**Also confirmed:** commingling principal and own material in the same physical store **is permitted**.
What is required is **separate stock records** to substantiate ITC and classification. That is precisely
what Nexflow would provide — and it is a clean, true sales line: *"you do not need a separate rack. You
need a separate ledger. That is what this is."*

---

## Q1 — Minimal ownership design that serves all five scenarios

### The design: two nullable counterparty references on the stock ledger

**`owned_by`** — whose material is this? NULL means mine.
**`held_by`** — who is physically holding it? NULL means me.

That is the entire mechanism. Two nullable columns, both defaulting NULL, on the stock ledger and
carried through dispatch lines.

| Scenario | `owned_by` | `held_by` | Meaning |
|---|---|---|---|
| **D — SS Engineering** | NULL | NULL | Ordinary owned stock. **Every row, always.** |
| **A/B — Shivprasad, own copper** | NULL | NULL | Identical to a standalone factory |
| **A/B — Shivprasad, KPML's copper** | KPML | NULL | Free-issue material I hold |
| **E — KPML's view** | NULL | Shivprasad | My material out at a job worker |
| **C — multi-principal** | KPML / Godrej | NULL | Two pools, same material, same store |
| **Multi-hop (G3)** | KPML | Plating shop | KPML's material I passed onward |

**Why ownership belongs on the ledger, not the material master.** The alternative — a separate material
record per owner — duplicates masters (three principals × 200 materials = 600 records), breaks BOM
(which material_id does the recipe point at?), and collides with the per-tenant unique code index. One
master record with an ownership dimension on the *balance* is both smaller and more correct: it is the
same physical copper, and the ledger says who owns each part of the pile.

**Why NULL rather than a 'self' sentinel.** NULL means every historical row across three live tenants is
already correct with no backfill, and the balance view's GROUP BY collapses to today's exact output for
any tenant that never writes a non-NULL value. That is the standalone guarantee expressed in the schema
rather than in a promise (Q8).

**What the standalone client sees:** nothing. No column, no selector, no concept. Both flags are off in
Settings (Q6), the grouping is a no-op, and every screen and export is byte-identical.

**One consequence to design for now, not later:** ownership must flow through **production**, not just
storage — see NF1 below. Finished goods made from KPML's copper are KPML's goods, not the vendor's
inventory.

---

## Q2 — Production order attribution and cross-pool prevention

### The rule: derive the pool, never ask for it

A production run always happens *against something* — a principal's PO, or the vendor's own order. That
something already knows the pool:

- Production against **KPML's PO** → consume from `owned_by = KPML`. Automatic.
- Production for **own sale** → consume from `owned_by = NULL`. Automatic.

**The storekeeper should never see a pool selector in the normal case.** Every place you ask a human to
choose between two physically identical piles under time pressure is a place the wrong pile gets picked.
Derive it from the order and show it as confirmation text, not as an input.

### What prevents accidental cross-pool consumption

**The stock check must become pool-aware — and this is a concrete change to shipped code.**
`confirm_bom_issue` v2 currently aggregates required quantity per material across BOM lines and checks it
against the balance. With pools, an aggregate check **passes on total stock and then consumes from the
wrong pool** — silently, atomically, with a green toast. The check must be per (material, pool), and the
existing `INSUFFICIENT_STOCK: {material} — Need {x}, Available {y}` message must name the pool:
*"KPML's copper — need 240 kg, available 200 kg (you also hold 180 kg of your own)."*

That message is the whole feature. It turns an invisible error into an explicit decision.

### When the pool genuinely is short: make substitution deliberate and recorded

The vendor's real options at that moment:
1. **Request more material** from the principal (this is the plan's 2E material request, arriving with a
   trigger rather than as a menu item).
2. **Record a substitution** — consume own material against the principal's order, deliberately, with a
   recovery claim attached.
3. **Stop production.**

Substitution must be **possible, one tap, and permanently recorded** — never silent, never impossible.
Making it impossible guarantees the vendor does it in the physical world and lies to the software, which
is the worst outcome: the pile is wrong *and* the ledger says it isn't.

The substitution record is two linked ledger rows (out of one pool, into the other) plus a recovery
amount, visible on the principal's statement within their own scope.

### GST consequences when it happens undetected

**Vendor consumes the principal's material for their own sale.** The principal's material never returns.
The s.143 clock runs to breach → **deemed supply on the original dispatch date, GST plus 18% interest
accruing retrospectively**, payable by the principal, who will then recover it from the vendor. On the
vendor's own side, they have sold goods containing material they never purchased — no ITC, no purchase
invoice, and a stock-to-purchase mismatch that cannot be explained at scrutiny. This is the expensive
direction.

**Vendor consumes their own material for the principal's order.** The vendor has effectively supplied
goods to the principal without invoicing for them — understated outward supply — while the principal's
material sits unconsumed, making the principal's ITC-04 quantities wrong. Less costly, still wrong on
both sides, and it surfaces as an unexplainable variance at year end.

Either way, **both parties' records are wrong in opposite directions and neither can prove anything.**
That is the exact dispute the whole product exists to end, so the pool check is not a nicety — it is the
mechanism.

### Detection, if prevention is bypassed

Per-challan balance (G4) stops reconciling: issued ≠ consumed + returned + scrap + still held. The
material-held statement (N5) shows the gap per principal per month. Neither requires new machinery once
pools exist — which is a good sign the model is right.

---

## Q3 — Multi-principal visibility isolation

### The scoping rule

`p2_network_links` gives KPML a link to Shivprasad. That link resolves to exactly one filter:
**`owned_by = KPML`**. Every principal-facing read starts from that filter and can never widen it.

Not "Shivprasad's stock." Not "Shivprasad's copper." **KPML's copper, at Shivprasad's premises.**

### Six failure modes, and what each one costs

1. **Aggregate leak.** Any total that spans owners — "total copper at this vendor," "network-wide stock"
   — encodes Godrej's quantity and Shivprasad's own purchases. Sums are the most common accidental leak
   because they look innocuous.
2. **Existence leak.** A material list scoped to the vendor rather than to the link reveals that
   Shivprasad holds materials KPML never sent. KPML now knows there is another principal, without ever
   seeing a name. *Inference is disclosure.*
3. **Variance-denominator leak.** Consumption variance computed against the vendor's **total**
   consumption rather than KPML's own pool directly encodes the other principal's volume. This is the
   most likely leak in practice because the denominator feels like a detail.
4. **Alert leak.** Low-stock or capacity signals derived from the vendor's overall position.
5. **Scorecard leak.** On-time delivery or rejection rates computed across all principals, or benchmarked
   in a way that exposes a vendor's performance on work KPML has nothing to do with.
6. **RPC drift.** The scope lives in each cross-tenant function's select list; someone adds a column six
   months later and the filter is not extended. This is the failure mode that actually happens.

**The cost is not embarrassment.** If KPML learns Shivprasad works for Godrej, KPML may pull work, and
Shivprasad may be in breach of a confidentiality term with Godrej — caused by software they pay for. In a
district where every factory owner knows every other, that is a market-wide reputation event and the end
of the network story. **Treat inter-principal isolation as the top product risk, above security in the
conventional sense.**

### The architectural answer to failure mode 6

Do not enforce scope in each RPC. Enforce it in **one** parameterised access path that every
principal-facing read goes through, taking the link as input and returning only in-scope rows. Then the
scope cannot be forgotten, because there is no other way to reach the data. This is the single most
important structural decision in the cross-tenant layer, and it is cheap if made before there are six
RPCs rather than after.

**Corollary that falls out for free:** because the principal's material codes are canonical (previous
section), KPML sees only their own codes. There is no vocabulary through which the other principal's
items could even be named.

---

## Q4 — Invoice type determination

### What changes

`p2_invoices` needs an **invoice type**: `goods_sale` (default) or `job_work_charge`. It drives four
things, all currently hardcoded to the sale case:

| | `goods_sale` | `job_work_charge` |
|---|---|---|
| Line description | Product name | Job work on <principal's material code> |
| HSN/SAC | Product `hsn_sac` | **SAC 9988** |
| Quantity | Units sold | Pieces processed |
| Rate source | `p2_product_prices` | **The principal's PO net price per piece** |
| Value | Full product value | **Job charges only** |
| Linked dispatch purpose | `sale` | `job_work_return` |

### Does it affect Scenario D (standalone)?

**No — provided `goods_sale` is the default.** Same principle as movement purpose: every existing invoice
across three tenants reads as `goods_sale`, every existing PDF renders identically, no migration.

But it **does** affect Type B and Type D clients correctively — that is the P0 raised at the top of the
previous section. Until this exists, the "Generate Invoice" button on a job work return produces a
legally wrong document. Consider disabling that button on job-work-purpose dispatches the day purpose
lands, ahead of the SAC 9988 path being built. A missing button is a support question; a wrong tax
invoice is a filing problem.

### Two structural issues this exposes

**The billing unit is wrong for job work.** Job charges are billed for all pieces delivered against a PO
in a period — not per challan. Nexflow's single-mode invoice is bound to one `dispatch_order_id` with a
unique index enforcing one invoice per dispatch. Consolidated mode is closer, but its dedup key
(tenant + date_from + date_to + client_id, per the Aug 17 partial index) has **no PO dimension**, so two
different POs billed for the same period against the same principal would collide. Job work billing
needs PO as part of the key.

**The flat 18% is fine here, and will not always be.** Engineering job work is 18% since 22 September
2025, so today's flat rate happens to be correct for these clients. A textile, food or printing job
worker is at 5%. Name this as a known limitation now rather than discovering it during an onboarding —
the fix is a rate on the agreement record (N3), not a schema redesign.

---

## Q5 — GSTR-1 split for a Type D vendor

Restating correctly (see Correction 1 above), a Type D vendor's outward-supply reporting lands in three
places:

**Table 4 (B2B) — both invoice kinds, as separate rows.**
Job charge invoices (SAC 9988, job charge value) and own sale invoices (product HSN, full value) sit in
the same table. Nothing special is needed here beyond each invoice carrying its correct SAC/HSN and
value, which the invoice type (Q4) delivers.

**Table 12 (HSN/SAC summary) — the one that is genuinely painful by hand.**
A consolidated summary of all outward supplies grouped by HSN/SAC. For a Type D vendor this must span
**both** SAC 9988 job charge lines **and** product HSN sale lines, in one aggregation. It is mandatory,
and since May 2025 it is split into B2B and B2C tabs on the portal. A vendor doing both activities is
aggregating two different code systems across two different value bases — exactly the kind of arithmetic
that gets done wrong in a spreadsheet at 11pm on the 10th.

**Nexflow already holds every input for this.** It is a genuinely valuable new report and a natural
sibling to Table 13 (N2).

**Table 13 (documents issued) — counts and ranges, now purpose-aware.**
A Type D vendor issues at least two document classes that Table 13 distinguishes: tax invoices, and
delivery challans issued for job work. Both need serial range, issued count and cancelled count.

### What must be captured at transaction time

1. **Invoice type** (Q4) — determines whether a line aggregates under SAC 9988 or a product HSN in
   Table 12.
2. **Per-line HSN/SAC** — already exists on invoice items.
3. **Challan purpose** — a job work return challan and a sale challan are different document classes in
   Table 13. This comes free from movement purpose.
4. **Cancelled state** — already exists.

### A document-series decision worth making deliberately

Nexflow has one `challan_sequence`. A Type D vendor issuing both job work challans and sale challans from
a single series can still produce correct Table 13 counts *if* purpose is recorded per row and the report
derives the classes. But many CAs prefer separate series per document class, because it makes the return
self-evidently correct and the ranges contiguous within each class.

**Recommendation:** support a separate series per purpose, but do not force it — a single series with
per-row purpose is arithmetically sufficient and simpler for a standalone client who will never have a
second class. Make it a setting that appears only when the job worker flag is on.

---

## Q6 — Onboarding flow consequence

**Neither "ask the type once" nor "show everything." Two reversible switches, UI-only.**

Asking for a fixed type at onboarding fails because types change: Shivprasad adds a second principal, SS
Engineering starts doing job work for someone, a job worker starts selling independently. A type baked in
at signup is wrong within a year, and correcting it becomes a migration on a live tenant.

Showing everything fails because it violates the standalone guarantee at the UI level and buries a
one-product factory in concepts they will never use.

**The design:**

Two independent yes/no settings, both default **off**, both changeable at any time:

- *"Do you do job work for another company?"* → reveals principal-owned pools, material-held statements,
  per-principal views, job charge invoicing.
- *"Do you send material out to job workers?"* → reveals at-vendor tracking, s.143 exposure, ITC-04
  working paper, job worker management.

Type A has both off. Type B has the first on. Type C has the second on. Type D has both on. Scenario C's
multi-principal case needs nothing extra — it is the first switch with more than one counterparty.

**The non-negotiable rule:** these switches control **UI surface only, never data semantics.** The
columns exist for every tenant, always nullable, always defaulted. Never derive the meaning of a row from
a tenant-level flag, or you will eventually have a tenant whose flag says "standalone" holding
principal-owned rows, and every report will disagree about what that means. **The flag shows and hides;
the row-level attribute is the truth.** Flipping a switch on reveals UI with zero migration, precisely
because the model never depended on it.

**One addition to onboarding:** ask who their principals and job workers are, by name and GSTIN. That
creates counterparty records and pending links — which is the bottom-up lead engine from the previous
section, captured as a by-product of normal onboarding rather than as a separate exercise.

---

## Q7 — What exactly does the vendor consent to?

**Precisely this: "KPML may see material that KPML owns, at my premises, and the documents between us."**
Nothing else. Rendered in plain language on the vendor's own screen:

> **KPML can see:** material they sent you and its current quantity · what you consumed against their
> orders · scrap you declared on their material · challans between you and them · their finished goods
> you are holding · invoices you raised on them.
>
> **KPML cannot see:** your own materials or stock · material belonging to any other company ·
> **whether you work for anyone else at all** · your own sales, clients or prices · your suppliers ·
> your total production volume.

That third exclusion is the one that matters in Scenario C, and it must be stated explicitly. Shivprasad
is not merely hiding Godrej's quantities — they are hiding **Godrej's existence**.

### Three design consequences

**Generate the panel from the same filter that governs the query.** If the visibility panel is hardcoded
prose and the scope is code, they will diverge, and the divergence will be discovered by a customer. Both
should derive from the single access path in Q3 — then the promise and the enforcement cannot drift.

**Revocation must not destroy history.** When a link is revoked, KPML keeps their own records — they
always had them, one-sidedly — and loses only the live corroboration view. That is the clean answer to
"what if we fall out," and it is only possible because the principal's data lives in the principal's own
tenant (F2/B1). A design where KPML's numbers come *from* the vendor cannot answer this question at all.

**Give the vendor a "view as KPML" preview.** Let Shivprasad see exactly what KPML sees, on demand. It is
nearly free once scoping is a single function, it converts an abstract promise into something checkable,
and it is the single strongest trust feature available in a product asking a small vendor to link data to
their largest customer. It also makes a leak self-reporting: the vendor notices before the principal
does.

---

## Q8 — The standalone client guarantee, stated exactly

For SS Engineering — and any future client with both switches off — the guarantee is:

**At schema level**
1. `owned_by`, `held_by`, movement purpose and invoice type are all **nullable or defaulted**, and every
   existing row already satisfies them. No backfill, no NOT NULL, no data migration on any live tenant.
2. NULL ownership and NULL custody mean "mine, here." Balance views group by these columns; for an
   all-NULL tenant the grouping collapses and output is **row-for-row identical** to today.
3. Movement purpose defaults to `sale`, so every historical dispatch retains its current meaning and every
   stock effect is unchanged.
4. Invoice type defaults to `goods_sale`, so every historical invoice renders identically.

**At UI level**
5. Both switches default off. No ownership columns, no pool selectors, no principal fields, no job work
   navigation, no s.143 panel.
6. **No upsell.** A standalone client should not learn these features exist. No prompt, no greyed menu
   item, no "unlock job work tracking." Nothing in this workstream is a Pro upgrade lever — mixing
   monetisation into it is how the guarantee gets quietly broken.

**At verification level — and this is the part that actually protects them**
7. A written acceptance test run against a copy of a standalone tenant's data, before and after the
   change, asserting identical output for: material list, stock balances, CA export, Tally export, Zoho
   export, GSTR-2B reconciliation buckets, challan PDFs, invoice PDFs, and a fixed set of agent stock
   questions. **Any difference means the change is wrong**, not that the test needs updating.

SS Engineering is client one, live, and free permanently. Breaking them is the worst commercially
available outcome in this entire plan, and the only real defence is that the test exists and is run —
not that the design intended safety.

---

## New flaws discovered while working through these scenarios

**NF1. Finished goods produced from a principal's material have no owner.**
KPML's copper becomes a wound stator. The stator is still KPML's. If Nexflow credits the finished product
to the vendor's own FG stock — which is what the current BOM explosion does — the vendor's finished goods
valuation and balance sheet inflate with goods they do not own, and the principal cannot see their own
WIP or FG at the vendor. **Ownership must flow through production, not just storage.** This widens the
retrofit from stock reads into the production and dispatch paths, and it was not named in the previous
section.

**NF2. `confirm_bom_issue` v2's stock check is pool-blind.**
Detailed in Q2. The v2 fix (aggregate per material with a FOR UPDATE lock) is correct for a single pool
and silently wrong across pools — it will pass on aggregate stock and consume the wrong owner's material,
atomically, with no error. A shipped, working RPC that becomes a data-integrity hazard the moment pools
exist.

**NF3. Work-in-progress does not exist in the model at all.**
Nexflow goes GRN → consumption → dispatch. Between consumption and return, the material is WIP *owned by
the principal and held by the vendor* — a real balance that neither party can see today. The material-held
statement (N5) **cannot arithmetically close without it**: issued = returned + scrap + raw still held +
**WIP**. Without a WIP term, every monthly statement shows a phantom shortfall equal to work in progress,
which is exactly the "unexplained consumption" accusation the product is meant to eliminate. This is a
foundational gap, not a refinement.

**NF4. Scrap in mixed stock has no owner either.**
Scrap from KPML's copper is KPML's; scrap from the vendor's copper is the vendor's. One physical scrap
bin. Without pool attribution on the scrap declaration (N4), scrap revenue attribution is unresolvable and
the s.143(5) question of who supplies it and pays GST cannot be answered.

**NF5. The consolidated-invoice dedup key has no PO dimension.**
Detailed in Q4. Two POs billed for the same period against the same principal collide under the Aug 17
partial unique index.

**NF6. My earlier composite-supply warning in F1 was too cautious.** Corrected above.

**NF7. s.143(2) puts the record obligation on the principal.** Corrected above — this changes the pitch
to job workers and should change the sales script before the next client conversation.

---

## New features this section requires

| Feature | Why | Placement |
|---|---|---|
| Pool-aware production issue with derived pool | Prevents the GST disaster in Q2 | Step 2, with ownership |
| Substitution event (deliberate cross-pool consumption + recovery) | Makes the unavoidable case honest instead of hidden | Step 2 |
| Ownership carry-through to WIP and finished goods (NF1, NF3) | Statements cannot close without it | Step 2 |
| Pool attribution on scrap (NF4) | ITC-04 and scrap revenue | Step 2 |
| Single scoped access path for all principal-facing reads (Q3) | The only durable defence against inter-principal leakage | Step 6, designed at Step 2 |
| "View as KPML" preview for the vendor (Q7) | Strongest available trust feature; makes leaks self-reporting | Step 6 |
| Invoice type routing to SAC 9988 (Q4) | Live compliance correctness for Type B/D | Step 2–3 |
| **GSTR-1 Table 12 HSN/SAC summary** | Mandatory, painful by hand for Type D, all data already held | Step 1, alongside Table 13 |
| Purpose-aware Table 13 with optional per-purpose series (Q5) | Correct document classes for a mixed vendor | Step 1 |
| Two onboarding switches, UI-only (Q6) | Standalone guarantee at the UI level | Step 2 |
| Standalone regression acceptance test (Q8) | Protects client one | Step 2, blocking |

---

## Revised risk assessment

**New top risk: inter-principal disclosure.** Previously I ranked the retrofit as the largest risk. It is
the largest *cost*; this is the largest *risk*. A leak that reveals Godrej's existence to KPML can breach
the vendor's confidentiality obligations, cost them work, and end Nexflow's standing in a district-sized
market — all at once, from a single unfiltered SUM. Mitigation is architectural (one scoped access path),
not procedural.

**Upgraded: the retrofit is larger than stated in the previous section.** It now spans stock reads *and*
production *and* dispatch *and* finished goods *and* scrap (NF1, NF3, NF4). Budget accordingly, and
resist the temptation to ship it partially — a half-retrofit produces numbers that are wrong in ways
nobody can predict.

**New: friction on the most frequent operation.** Production issue is a daily action. If the pool becomes
a question rather than a derivation, the feature is a tax on every run and will be worked around. The
derive-never-ask rule in Q2 is a hard requirement, not a preference.

**Reduced: composite-supply reclassification.** NF6 — this was overstated. A job worker using their own
consumables remains a job worker.

**Unchanged and still real:** standalone regression (Q8), the agent reporting stock it should not see, and
support burden from mis-assigned pools.

---

## What this changes in the build sequence

The seven-step sequence holds. Four adjustments:

**Step 0 gains one CA question.** Alongside the P0 invoice check: confirm what records a *job worker*
must maintain in their own right, given that s.143(2) places the accounting obligation on the principal.
The answer determines whether the job-worker pitch is compliance-led or relationship-led, and you are
speaking to a CA this week anyway.

**Step 1 gains Table 12.** It is mandatory, it is aggregation over data already held, it benefits every
client including standalone ones, and it is the natural sibling of the Table 13 report already in Step 1.

**Step 2 grows, and gets a better justification.** It now includes pool-aware consumption, ownership
through WIP and finished goods, scrap attribution, the two onboarding switches, and the standalone
regression test as a blocking gate. Larger than previously scoped — but it now delivers something
Shivprasad can see on day one and cannot get anywhere else today:

> **"KPML's copper: 400 kg. Your copper: 180 kg."**
>
> No system they have — not Tally, not a register, not KPML's SAP — tells them that. It is one line, it
> is legally required as a *record* (even where the accounting obligation sits with the principal), and
> it is the entire mixed-stock problem solved visibly.

That is the demo for Step 2, and it is worth more to an existing client than anything in the original
Phase 0.

**Step 6 gains its architectural constraint up front.** The single scoped access path (Q3) and the
"view as principal" preview (Q7) are designed at Step 2 even though they ship at Step 6 — because
retrofitting scope enforcement across six existing RPCs is exactly the drift failure mode that causes the
leak.

---

*End of critique. Companion to kpml-network-plan.md and CLAUDE.md — load all three to resume this
context in a new session.*
