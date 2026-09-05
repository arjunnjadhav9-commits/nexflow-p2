---
name: compliance-and-field-report
description: GST compliance depth (ITC-04, Rule 55, s.143), field intelligence (storekeeper reality, CA channel, competitor post-install), and product implications for Nexflow P2
sources: [research]
last_updated: Sept 2026
---

# Compliance and Field Report — Nexflow P2

## How to read this file

Every claim below carries one of three markers. Do not build a compliance feature on anything that is not
`[LAW]` or `[SOURCED]` without a CA confirming it first.

| Marker | Meaning |
|---|---|
| `[LAW]` | Traced to the bare Act, Rule, notification or a court order. Section/rule/notification number given. Still secondary-source — a CA should confirm against the current bare text before shipping a compliance feature. |
| `[SOURCED]` | Traced to a named practitioner article, review site, vendor price list, or user comment. Not law. Good enough to design against. |
| `[INFERRED]` | My reasoning from the above plus what the codebase and the existing plan already establish. **Not a fact.** Where a cheap way to verify exists, it is stated. |

**Sourcing honesty for Parts 4 and 5.** Indian factory-floor ethnography is not published. There is no
survey of what a storekeeper in Karad writes on paper at 9:40am, no forum thread where a Satara CA explains
his software recommendation logic. What *is* published is vendor marketing, review-site aggregation
(Trustpilot / Capterra / G2 / Techjockey / SoftwareSuggest), price lists, and a handful of practitioner
comments. Parts 4 and 5 are therefore mostly `[INFERRED]`, built on the `[SOURCED]` fragments that do
exist plus the operational facts already established in `_ai/kpml-network-plan.md`. Each subsection ends
with **Cheapest verification** — a specific question to ask a specific person. Treat those parts as a
research *plan* with a strong prior, not as findings.

**Relationship to `_ai/kpml-network-plan.md`.** That file's §10 already carries a compliance reference.
This file goes deeper and, in three places, **corrects it**. Those corrections are collected in the
Appendix so they do not get lost.

---

# Part 1 — ITC-04 in practice

## 1.1 What the CA actually collects before filing

### The statutory position

`[LAW]` **Section 143(2) CGST Act** — *"The responsibility for keeping proper accounts for the inputs or
capital goods shall lie with the principal."* The accounting obligation is KPML's, not SS Engineering's.
This is already recorded in `_ai/CLAUDE.md:649` and it is the single most important fact for how Nexflow
is positioned: **you cannot sell s.143 compliance to a job worker as their own legal requirement.** You
sell it to the job worker as *"KPML's CA will ask you for this, and you will produce it in ten minutes
instead of three days."*

`[LAW]` **Rule 45(1) CGST Rules** — inputs, semi-finished goods or capital goods go to the job worker
under cover of a **challan issued by the principal**, including where goods are sent directly from a
supplier to the job worker, and where the job worker sends them on to another job worker. The job worker
may **endorse** the principal's challan when passing goods on or returning them.

`[LAW]` **Rule 45(2)** — the challan must contain the particulars specified in **Rule 55**.

`[LAW]` **Rule 45(3)** — the details of *challans* (not invoices, not stock reports — challans) in respect
of goods dispatched to or received from a job worker during the period go into **FORM GST ITC-04**, due by
the **25th of the month succeeding the period**.

`[LAW]` **Filing frequency — amended by Notification No. 35/2021-Central Tax dated 24.09.2021, effective
01.10.2021:**

| Principal's aggregate annual turnover | Frequency | Due dates |
|---|---|---|
| **Above ₹5 crore** | Half-yearly | Apr–Sep → **25 October** · Oct–Mar → **25 April** |
| **Up to ₹5 crore** | Annual (FY) | **25 April** |

This matches `kpml-network-plan.md` §10.2 and `:1052`. **KPML is above ₹5 crore, so KPML files
half-yearly.** Nexflow's ITC-04 working paper must therefore be generatable for an arbitrary date range,
not hard-coded to a quarter.

> **Product implication →** The ITC-04 period selector must offer Apr–Sep / Oct–Mar / full FY / custom
> range, and must default from the principal's `aato_bracket`. Nexflow already stores `aato_bracket` on
> `p2_tenant_settings` (added Sept 2 2026, values `below_5cr` / `5cr_to_10cr` / `above_10cr`) — reuse it.
> Note the bracket is stored for the *tenant*; for a vendor generating a working paper for KPML, the
> relevant turnover is **KPML's**, not the vendor's. That is a new field on the principal record.

### What he collects manually today

`[SOURCED]` The failure mode is well documented in the practitioner literature: challans get raised, but
the outstanding balance lives in a separate Excel sheet, the one-year and three-year clocks are tracked by
memory, and the deemed-supply liability surfaces only when an officer asks why goods sent years ago never
came back.

`[SOURCED]` Practitioners report that **most accountants cannot fill ITC-04, and many CAs skip filing it
on behalf of clients altogether.** That is not a slur — it is the market. It means the ITC-04 working
paper is a feature with almost no incumbent competition, and it also means a large share of principals are
sitting on unquantified deemed-supply exposure.

`[INFERRED]` The collection list, reconstructed from what the form demands and what a job work factory
physically holds:

1. **Outward challan book** — every delivery challan issued to each job worker in the period, in serial
   order, with gaps explained. This is the spine of Table 4.
2. **Inward challan / DC book** — the job worker's own return challans, plus the principal's endorsed
   copies coming back.
3. **Gate register / security register** — used to prove a movement happened on a date when the challan
   book and the stock ledger disagree.
4. **Stock ledger or Tally stock summary** — to prove the closing quantity lying with each job worker.
5. **Purchase invoices** for the inputs, to establish taxable value per unit for the Table 4 value column.
6. **Job work invoices** received from the job worker (SAC 9988), to cross-tie the return dates.
7. **E-way bills** generated in the period, where any.
8. **A quantity reconciliation the factory has usually never done**: sent = returned + scrap declared +
   still lying with the job worker + process loss.

`[INFERRED]` **Time per client per quarter: 1–3 working days** for a factory with 40–150 challans in the
period, of which the vast majority is (a) chasing the return challan for each outward challan and (b)
resolving unit-of-measure and quantity mismatches where a bar went out in KG and a machined housing came
back in NOS. The filing itself is under an hour once the working paper exists. **This estimate is
inference, not a measured figure** — it is the number to test.

> **Cheapest verification.** One question to KPML's CA, or to the CA of any of the three live clients:
> *"For your job work clients, roughly how many hours does the ITC-04 working paper take you per period,
> and what do you ask the factory for?"* Ten minutes of his time. `kpml-network-plan.md:477` already flags
> this as a Step 0 action — this is the exact question to ask.

## 1.2 The exact fields, and where CAs go wrong

### Table 4 — goods sent to the job worker

`[SOURCED]` Columns of the notified form, Table 4 (*"Details of inputs/capital goods sent for job work
(includes inputs/capital goods directly sent to place of business/premises of job worker)"*):

| # | Column |
|---|---|
| 1 | **GSTIN / State** (State where the job worker is unregistered) |
| 2 | **Challan no.** |
| 3 | **Challan date** |
| 4 | **Description of goods** |
| 5 | **UQC** (Unique Quantity Code — dropdown, from the GSTN list) |
| 6 | **Quantity** |
| 7 | **Taxable value** |
| 8 | **Type of goods** — Inputs / Capital goods |
| 9–12 | **Rate of tax (%)** — Central tax · State/UT tax · Integrated tax · Cess |

`[SOURCED]` The older offline utility's outward sheet (`Mfg_to_JW`) carried: GSTIN of Job Worker, State,
Challan Number, Challan Date, Description of Goods, UQC, Quantity, Taxable Value, Types of Goods,
Integrated Tax Rate, Central Tax Rate, State/UT Tax Rate, Cess. The current GSTN offline utility has
**separate worksheets for Table 4, 5A, 5B and 5C**.

### Table 5 — goods received back

`[SOURCED]` Three sub-tables, all carrying losses-and-wastes columns:

| Sub-table | Scope |
|---|---|
| **5A** | Received back **from the same job worker** goods were sent to; and losses and wastes |
| **5B** | Received back **from a different job worker** than the one originally sent to (multi-hop); and losses and wastes |
| **5C** | Sent to a job worker and **subsequently supplied from the job worker's premises**; and losses and wastes |

`[SOURCED]` Columns common to 5A / 5B / 5C:

| # | Column |
|---|---|
| 1 | **GSTIN of job worker**, or State if unregistered |
| 2 | **Original challan number issued by the principal** |
| 3 | **Original challan date** |
| 4 | **Challan number issued by the job worker** |
| 5 | **Challan date issued by the job worker** |
| 6 | **Nature of job work done** |
| 7 | **Description of goods** |
| 8 | **UQC** |
| 9 | **Quantity** |
| 10–11 | **Losses and wastes** — UQC · Quantity |

`[SOURCED]` **Table 5C's original challan details are non-mandatory** where *"one on one correspondence
between goods sent for job work and received back after the job work is not possible."* This is the
statutory escape hatch for exactly the case Nexflow's KPML clients live in — bar goes out in KG, machined
housing comes back in NOS, and no per-challan lineage exists. It is an escape hatch on Table 5C only.

> **Product implication →** The working paper must model **the pairing between the principal's outward
> challan and the job worker's return challan as a first-class link**, not as a report-time join guess.
> Nexflow's `p2_dispatch_orders` has `movement_purpose` covering `job_work_return`, `scrap_return`,
> `unused_material_return`, `inter_jobworker_transfer` and `direct_supply_from_jobworker` — those map
> cleanly to 5A / 5B / 5C. What is missing is a **`parent_challan_id`** (or a link table, since a return
> can settle several outward challans partially). Without it the export cannot fill columns 2–3, which are
> mandatory for 5A and 5B.
>
> **Product implication →** `Nature of job work done` is a free-text column with no home in the schema
> today. It belongs on the **job work agreement record** (already planned, `kpml-network-plan.md:629`) as
> a default per (principal, product), overridable per challan.
>
> **Product implication →** **UQC, not the factory's unit string.** Nexflow stores `unit` as free text
> ("Nos", "KG", "Mtr"). ITC-04 needs the GSTN UQC codes (`NOS`, `KGS`, `MTR`, `PCS`…) from a controlled
> dropdown. A `uqc` column on `p2_raw_materials` and `p2_products`, with a mapping table and a one-time
> backfill, is a prerequisite for the export. This is a small, cheap, unglamorous change that gates the
> entire feature.

### Utility mechanics that decide the export format

`[SOURCED]` The GSTN offline utility requires that you **enter the challan number in every row, start
writing data from ROW 7, and skip no rows.** A multi-line challan is represented as multiple rows
repeating the same challan number.

`[SOURCED]` Practitioners on the older utility complained there was *"no option to give detail of more
than one material in same challan… big issue with itc04 offline excel sheet"* (Manoj Kumar, echoed by
Savita Patil). The repeat-the-challan-number convention is the answer, but it is not obvious, and it is
still a common source of confusion.

> **Product implication →** The Nexflow ITC-04 export must be **one flat sheet per table, one row per
> challan line, challan number repeated on every row, zero merged cells, zero blank rows, zero decorative
> header block, no totals row inside the data range.** Anything a human would call "a nice report" breaks
> the paste into the utility. Put the pretty version on a second worksheet if you want one.

### Common CA errors

`[INFERRED]` from the form's structure plus the reconciliation failures documented in the case law below:

1. **Filing Table 4 and leaving Table 5 empty** because return challans were never collected. This looks
   to the system like 100% of goods still lying out.
2. **UQC mismatch between Table 4 and Table 5** — sent in KGS, returned in NOS, with no conversion
   declared. There is no place on the form to explain it, so it silently becomes an unreconciled quantity.
3. **Not declaring losses and wastes**, so the arithmetic never closes. 1–3% process loss is normal and
   there is a column for it; leaving it blank converts normal loss into apparent non-return.
4. **Treating the job worker's own return challan number as the original challan number** in Table 5
   columns 2–3, destroying the linkage the department reconciles on.
5. **Omitting moulds/dies/jigs/fixtures/tools** entirely, on the reasoning that they have no time limit —
   see §1.6. The time limit and the reporting obligation are different things.
6. **Missing Table 5C** where the finished goods were billed directly from the job worker's premises,
   which is common and which is the only lawful way to close the clock without a physical return.
7. **Ignoring goods sent before the period** whose return falls inside it — Table 5 is keyed to the
   *original* challan, which may be a year old.

### What triggers a notice

`[LAW]` **Rule 45(4)** — where inputs or capital goods are not returned within the s.143 time, *"it shall
be deemed that such inputs or capital goods had been supplied by the principal to the job worker"* and the
principal declares the supply and pays tax. The system-side trigger is arithmetic: **Table 4 quantities
minus Table 5 quantities, aged past the deadline, is an unpaid deemed supply on the face of the return.**

`[SOURCED]` Practitioner consensus on the trigger set: non-filing or long gaps in ITC-04; Table 4 with no
matching Table 5; quantity or value mismatch against GSTR-1 / GSTR-3B; job work charges appearing in
GSTR-2B from a job worker with no corresponding ITC-04 entries; and scrutiny of movements between
related parties or sister concerns.

`[LAW]` **Related-party movements get closer scrutiny** — the Madras High Court order at §1.4 concerned
goods sent to a sister concern, and the reported ratio is that informality between group entities does not
relax the record requirement.

> **Product implication →** Build the **pre-export reconciliation check** as a blocking screen, not a
> footnote. See §6.1 for the exact check list. The single most valuable line in the whole export is
> *"Table 4 total 12,480 KGS · Table 5 total 11,930 KGS · declared waste 240 KGS · still with job worker
> 310 KGS · unexplained 0"* — because that is the line the officer computes himself.

## 1.3 Consequence of late or incorrect filing, for KPML

`[LAW]` **There is no late fee prescribed for ITC-04.** It is not a return under s.39, so the s.47 late
fee machinery does not reach it. Three separate exposures do:

**(a) General penalty — Section 125 CGST.** `[LAW]` Contravention of any provision of the Act or rules for
which no separate penalty is provided attracts a penalty **up to ₹25,000**. `[SOURCED]` Practitioners
uniformly read this as the ITC-04 penalty. `[INFERRED]` Because SGST mirrors CGST, the practical worst
case is **₹25,000 + ₹25,000 = ₹50,000 per default**. This is a nuisance number, not a business risk. It is
not the pitch.

**(b) Failure to maintain books — Section 122(1).** `[LAW]` `[VERIFY]` Failure to keep, maintain or retain
books of account and documents as required attracts a penalty of **₹10,000 or the tax evaded, whichever is
higher**. I am confident of the substance but have not re-read the clause text this session — have the CA
confirm the clause number before you quote it to a client.

**(c) The one that matters — deemed supply plus interest.** `[LAW]` s.143(3)/(4) read with Rule 45(4):
tax on the full value of the goods, with the **date of supply backdated to the day the goods were
originally sent out**, and interest under **s.50 at 18% p.a.** running from that backdated due date.

`[SOURCED]` A worked illustration from the practitioner literature, for goods valued ₹10,00,000 at 18%:

| Component | Amount |
|---|---|
| GST payable | ₹1,80,000 |
| Interest @18% p.a. to date of payment | ≈ ₹96,490 |
| **Total** | **≈ ₹2,76,490** |

That is **27.6% of the goods' value**, and the interest component grows every month the omission goes
unnoticed. Note the perverse structure: the longer the failure stays hidden, the worse it gets, and
nothing in a normal accounting system surfaces it.

`[LAW]` **Section 74 extended limitation** applies where self-assessment records fail — see §1.4. That
takes the reachable period from three years to **five**.

> **Product implication →** The s.143 timer must be denominated **in rupees, not in days**. `₹4.2L of
> KPML material breaches in 38 days` is a number a factory owner acts on at 11pm; `3 challans ageing` is
> not. `kpml-network-plan.md:236` already says this — this section is the arithmetic that justifies it:
> **tax at the applicable rate on the taxable value of the un-returned quantity, plus 18% simple interest
> from the original dispatch date to today.** Show the interest separately; it is the number that grows
> while you watch.

## 1.4 Material not returned in time — the step-by-step

`[LAW]` **Section 143(1)(a)** — the principal must bring back inputs within **one year** and capital goods
within **three years** of their being sent out (or of the date of receipt by the job worker, where goods
were sent directly from the supplier to the job worker).

`[LAW]` **Section 143(1)(b)** — alternatively the principal may **supply the goods from the job worker's
premises**, on payment of tax within India or as an export. This closes the clock with no physical return.
The principal must have declared the job worker's place as an additional place of business, **unless** the
job worker is registered, or the goods are of a class notified by the Commissioner.

`[LAW]` **Sections 143(3) and 143(4)** — where the goods are not returned or supplied within the period,
**it shall be deemed that such inputs or capital goods had been supplied by the principal to the job worker
on the day they were sent out.**

### What KPML (the principal) has to do

1. **Identify the breach date** — one year (or three) from the original challan date, per challan line,
   per un-returned quantity.
2. **Issue a tax invoice** to the job worker for the un-returned goods. `[SOURCED]` Circular 38/12/2018:
   *"the principal would issue an invoice for the same and declare such supplies in his return for that
   particular month."*
3. **Backdate the supply.** `[LAW]` The date of supply is the **original dispatch date**, not the breach
   date. This is the trap: the invoice is issued now, the liability arose a year ago.
4. **Declare it in GSTR-1** for the current period `[LAW]` (Rule 45(4)), and pay the tax in GSTR-3B.
5. **Pay interest under s.50 at 18% p.a.** from the date the tax on that backdated supply was due — i.e.
   roughly from the GSTR-3B due date of the month the goods originally went out.
6. **Report it in ITC-04** in the appropriate table for the period.

### What the job worker (SS Engineering / Shivprasad / Datta Prasad) has to do

`[SOURCED]` The job worker becomes the **recipient of a taxable supply**. Practically:

1. **Receive KPML's tax invoice** for material he never bought and may still be holding.
2. **Take ITC on it** if he is otherwise eligible — which is why the position is often described as
   revenue-neutral. `[SOURCED]` Revenue-neutrality claims require detailed proof; general assertions fail
   before the department.
3. `[SOURCED]` **If the goods are later returned after the deadline, the job worker is liable for GST as
   the supplier** — he must raise his own tax invoice back to KPML. What was one movement of material has
   become two taxable supplies and two invoices, with cash-flow and ITC-timing consequences for both
   sides, over goods that never changed owner.
4. **The commercial consequence is worse than the tax consequence.** A vendor who causes a backdated
   deemed supply on KPML's books, with interest, has created a finance-department problem at his largest
   customer. That is a relationship event, not an accounting event.

> **Product implication →** This is the whole vendor-side pitch, in one sentence: *"Nexflow tells you
> which of KPML's material is about to breach, in rupees, before KPML's CA finds it."* The vendor does not
> own the legal obligation (s.143(2)), but he owns the **consequence**. Build the alert to name the
> principal, the challan, the quantity, the days remaining, and the rupee exposure — and fire it at
> **60 / 30 / 7 days** before the deadline, not on the day.

### The case that makes this concrete

`[LAW]` **Tvl. Technocast Foundry v. State Tax Officer, Coimbatore — 2026-VIL-582-MAD, order dated
08.06.2026 (Madras High Court).** Reported facts and ratio, from the practitioner writeups:

- The petitioner sent goods to its **sister concern** (Tvl. Unitech Couplers India Pvt Ltd) for job work
  without maintaining the records required by **s.143 and Rule 45**.
- It **could not establish that the goods came back** within the prescribed period.
- The department treated the movements as **deemed supplies**, with tax, interest and penalty under
  **Section 74** — the extended-limitation, five-year provision.
- The Court recorded that the petitioner **itself admitted** it had been unable to maintain the records,
  and declined to interfere beyond granting 30 days to reply.
- Reported takeaways: **s.143(2) puts accountability on the principal even though the goods physically sit
  with the job worker**; technical upload glitches in ITC-04 **do not excuse** missing underlying
  documentation; **related-party informality is not a defence**; and GST's self-assessment architecture
  makes **s.74 easier to invoke** than under the previous indirect tax regime.

> **Product implication →** This case is the single best artefact you have for the CA channel and for a
> KPML conversation. It is recent (June 2026), it is a High Court, and its facts are *exactly* KPML's
> shape: a principal, a captive/related job worker, informal record-keeping, and a five-year demand. Put a
> one-paragraph summary and the citation on the ITC-04 working paper's cover sheet. Do not overstate it —
> the Court remanded on procedure; it did not lay down new law. Its value is that it shows the department
> is actively running this play in 2026.

## 1.5 The Commissioner extension

`[LAW]` **Proviso to Section 143(1)** — the one-year and three-year periods *may, on sufficient cause
being shown, be extended by the Commissioner for a further period not exceeding **one year** and **two
years** respectively.* Effective maximum retention: **two years for inputs, five years for capital goods**,
with approval.

`[SOURCED]` This proviso came in through the **Finance Act, 2020**, notified into force from
**01.01.2021 by Notification No. 92/2020-Central Tax dated 22.12.2020**.

**Process.** `[INFERRED]` The Act says only "on sufficient cause being shown… by the Commissioner." There
is no prescribed form, no portal workflow, and no published SOP. In practice this means a **written
application to the jurisdictional Commissioner before the period expires**, setting out the challan
references, quantities, the reason (customer deferral, plant shutdown, tooling under long-cycle work,
supply chain disruption), and the extension sought. It is a discretionary, manual, case-by-case order.
**I have found no published instance of an extension being granted, and no data on how often it is
applied for.** Treat it as a real but rarely-used safety valve.

**COVID.** `[LAW]` The 1-year clock was **not** extended by a job-work-specific notification. What
happened instead was a blanket extension under **s.168A**: **Notification No. 35/2020-Central Tax dated
03.04.2020**, as amended by **Notification No. 55/2020-Central Tax dated 27.06.2020**, extended the time
limit for completion or compliance of any action falling due between **20.03.2020 and 30.08.2020** to
**31.08.2020**. `[INFERRED]` s.143 is not in that notification's exclusion list, so a return deadline
falling in that window was covered — but this is a reading, not a clarification, and a CA should confirm
before it is relied on for a historical position.

`[SOURCED]` The **ITC-04 due dates** were separately and repeatedly extended during COVID (the Jul–Sep
2020 period was pushed to 30 November 2020, for instance). And earlier, **Notification No. 38/2019-Central
Tax dated 31.08.2019 waived ITC-04 filing entirely for July 2017 to March 2019**, requiring only that
goods dispatched and not received back as on 31.03.2019 be declared in the following return. That waiver
is itself the strongest available evidence that **the government knows this form is unfillable from the
records most factories keep.**

> **Product implication →** Add `s143_extension_until` to the timer arithmetic, not just the schema. The
> column exists (`20260825_s143_clock_population.sql`, "write-only stub, no UI yet"). Give it a UI: a date
> field plus a **mandatory reference note** for the Commissioner's order number and date. A deadline
> silently pushed out with no order reference behind it is worse than no field at all — it converts a
> visible exposure into an invisible one. Show extended challans in a distinct state
> ("Extended to 12 Mar 2027 — order ref ___"), never merged into "compliant".

## 1.6 Moulds, dies, jigs, fixtures and tools

`[LAW]` **Proviso to Section 143** — *nothing contained in sub-section (3) or sub-section (4) shall apply
to **moulds and dies, jigs and fixtures, or tools** sent out to a job worker for job work.* No one-year
limit, no three-year limit, no deemed supply on non-return. Tooling can lawfully sit at a vendor
indefinitely.

**What this does and does not mean.** `[SOURCED]` The exemption is **only from the time limit**. It is not
an exemption from:

- the **challan** requirement under Rule 45(1) / Rule 55 — the movement still needs a valid document;
- the **ITC-04 reporting** requirement under Rule 45(3) — Rule 45(3) is keyed to *challans*, not to
  time-limited goods, so a tooling challan is still a challan whose details go into the return;
- **s.143(2)** — the principal still has to account for where the tooling is;
- **Rule 56(5)(c)/(6)** on the job worker's side — see Part 3.

`[INFERRED]` **What it means for a factory like KPML in practice.** Tooling is where the money and the
disputes are, and it has no clock forcing anyone to look at it. A fixture worth ₹3–8 lakh sits at a vendor
for six years. The vendor's plant manager who knew whose it was has left. It gets modified for a different
part, or cannibalised, or scrapped as a slow-moving item, or simply cannot be found. Nobody notices,
because no return-date report ever flags it. When the part goes end-of-life or the vendor relationship
ends, the asset is unrecoverable and there is no document trail establishing that KPML ever owned it.

**The tooling risk is a custody and asset risk, not a tax risk. It is the opposite shape from raw material,
and it needs the opposite treatment.**

| | Raw material / inputs | Tooling (moulds, dies, jigs, fixtures, tools) |
|---|---|---|
| Clock | 1 year, hard | **None** |
| Failure mode | Deemed supply + 18% interest | **Asset quietly lost; no tax event ever fires** |
| What surfaces it | A deadline | **Nothing** — this is the whole problem |
| Right UI | Countdown, red at 30 days | **Register with periodic attestation** |
| Right cadence | Continuous | **Annual or half-yearly confirmation** |

> **Product implication →** `is_exempt_tooling` exists on `p2_dispatch_orders` and correctly nulls the
> deadline, but **has no UI** and, more importantly, **has no replacement surface**. Nulling the deadline
> currently means the item disappears from the compliance view entirely — the exempt item becomes the
> invisible item. Build:
>
> 1. A **Tooling Register** as a distinct screen from the s.143 timer: every `capital_goods_issue` with
>    `is_exempt_tooling = true`, grouped by (principal, holder), showing asset description, identifying
>    mark/number, original challan, date sent, days held, and **date last confirmed**.
> 2. A **`last_confirmed_at` / `confirmed_by`** pair on the tooling record, set by an explicit
>    "Confirm still on site" action. Age it: green under 6 months, amber to 12, red beyond.
> 3. **An asset identifier field.** Raw material has a material code; a fixture has a punch-marked number
>    and no home in the schema. Add `asset_tag` to the dispatch line for tooling movements.
> 4. **Still include tooling in ITC-04 Table 4** with `Type of goods = Capital goods`. Excluding it from
>    the export because it has no clock is error #5 from §1.2.

## 1.7 The perfect ITC-04 working paper

The target: **a CA opens one file, runs his eye down a reconciliation block, pastes four ranges into the
GSTN offline utility, and files.** Ten minutes, not two days.

### Structure — six sheets

**Sheet 0 — Cover / Reconciliation.** The only sheet the CA reads carefully. Everything else he pastes.

```
Principal          : Karad Projects and Motors Ltd — GSTIN 27XXXXXXXXXXXZX
Job worker         : SS Engineering — GSTIN 27XXXXXXXXXXXZX
Period             : 01-Apr-2026 to 30-Sep-2026   (half-yearly — principal AATO > ₹5 cr)
Generated          : 03-Sep-2026 11:42 IST  ·  Nexflow P2  ·  data as at generation time

CHALLAN CONTINUITY
  Outward series   : DC/26-27/0001 to DC/26-27/0184
  Issued           : 184     Cancelled : 3 (0042, 0091, 0155)     Missing : 0
  Gaps             : NONE

QUANTITY RECONCILIATION                        (per UQC — one block per UQC)
  KGS   Opening with job worker   1,240.000
      + Sent in period (Table 4) 12,480.000
      − Returned  (Table 5A)     11,930.000
      − Returned  (Table 5B)          0.000
      − Supplied from premises (5C)   0.000
      − Waste / loss declared       240.000   (1.9% of sent — spec 2.0%, within tolerance)
      = Closing with job worker   1,550.000
        Unexplained                   0.000   ✅

  NOS   ... second block ...

AGEING — MATERIAL OUT BEYOND THE s.143 LIMIT
  Breached                    : 0 challans, ₹0
  Breaching within 90 days    : 2 challans, 310 KGS, taxable value ₹2,48,000
                                → exposure if unreturned: ₹44,640 tax + interest from dispatch date
  Extended by Commissioner    : 0
  Exempt tooling (no limit)   : 4 items — see Sheet 5, not reported in ageing by design

CHECKS RUN                                        RESULT
  Every Table 5 row links to a Table 4 challan      PASS
  No UQC changes between sent and returned          PASS
  No challan number appears twice                   PASS
  Every challan has HSN and taxable value           PASS
  Every job worker GSTIN is 15 chars, valid state   PASS
  Sent-before-period returns included               PASS  (6 rows, oldest challan 12-Nov-2025)
```

**Sheets 1–4 — Table 4, Table 5A, Table 5B, Table 5C.** Paste-ready. Column order **exactly** as §1.2,
data starting at row 1 with a single header row, challan number repeated on every line, no merged cells,
no blank rows, no totals inside the range, UQC codes not unit strings, GSTIN or State in one column per
the form's convention.

**Sheet 5 — Tooling register.** Exempt items, excluded from ageing, included in Table 4. Present because
the CA will ask why the challan count on Sheet 1 exceeds the ageing count on Sheet 0.

**Sheet 6 — Evidence index.** For every challan: challan number, date, e-way bill number where one exists,
vehicle number, return challan number, and a link or a document reference. This is the sheet that answers
an audit query without the factory reopening a file cupboard.

### Grouping

**Per principal, then per period, then per UQC.** Not per material. `[INFERRED]` A CA reconciles a job
work account the way he reconciles any account: one counterparty, one period, quantities that must
balance. Grouping by material fragments the balance into forty little reconciliations none of which he can
sign off. Materials are the *rows*; the UQC block is the *unit of reconciliation*.

> **Product implication →** Sheet 0 is the product. Sheets 1–4 are a CSV any competent developer could
> emit; **the reconciliation block is what turns two days into ten minutes**, because it is the arithmetic
> the CA would otherwise do by hand and the arithmetic the officer will do to him. If you build only one
> thing from this file, build Sheet 0.

---

# Part 2 — Rule 55 challan compliance

## 2.1 Mandatory fields, and Nexflow's current gap

`[LAW]` **Rule 55(1) CGST Rules 2017** — the consignor shall issue a delivery challan, **serially numbered
not exceeding sixteen characters, in one or multiple series**, containing:

| # | Rule 55(1) particular | On Nexflow's challan today? |
|---|---|---|
| (i) | date and number of the delivery challan | ✅ `challan-no`, `challan-date` |
| (ii) | name, address and GSTIN of the **consigner**, if registered | ✅ from `p2_tenant_settings` — name, address_line1/2, mobile, gstin |
| (iii) | name, address and GSTIN or UIN of the **consignee**, if registered | ⚠️ **name and address only — GSTIN is NOT printed** |
| (iv) | **HSN code and description of goods** | ❌ **description only — no HSN** |
| (v) | quantity (provisional where the exact quantity is not known) | ✅ quantity + unit |
| (vi) | **taxable value** | ❌ **absent** |
| (vii) | tax rate and tax amount — CGST / SGST / IGST / UTGST / cess — where the transportation is for supply to the consignee | ❌ **absent** |
| (viii) | **place of supply, in case of inter-State movement** | ❌ **absent** |
| (ix) | signature | ✅ "Receivers Signature" + "For \<company\> / Authorized Signatory" |

`[LAW]` **Rule 55(2)** — where the transport is for supply to the consignee, the challan is prepared in
**triplicate**:

- **ORIGINAL FOR CONSIGNEE**
- **DUPLICATE FOR TRANSPORTER**
- **TRIPLICATE FOR CONSIGNER**

❌ **Nexflow prints no copy marking at all.**

`[LAW]` **Rule 55(3)** — where goods move on a delivery challan, the declaration under Rule 138 (e-way
bill) applies.
`[LAW]` **Rule 55(4)** — where the invoice could not be issued at the time of removal, the supplier issues
a tax invoice after delivery.
`[LAW]` **Rule 55(5)** — for goods moved in **semi-knocked-down or completely-knocked-down condition, or
in batches or lots**: the complete invoice is issued before the first consignment; each subsequent
consignment moves on a delivery challan referring to that invoice; the original invoice travels with the
last consignment.

`[SOURCED]` Circular 38/12/2018 adds a practical refinement the bare rule does not: the principal prepares
the challan in triplicate, **two copies go to the job worker with the goods**, and the job worker **sends
one copy back with the returning goods**. Some practitioners recommend **four copies** in practice (one
principal, one transporter, two job worker).

`[SOURCED]` Circular 38/12/2018 also confirms: for job-worker-to-job-worker movement the challan may be
issued by either the principal or the job worker, or the principal's challan may be **endorsed** by the
job worker showing the quantity and description; and where goods return **in piecemeal lots**, *"a fresh
challan is required to be issued by the job worker."*

> **Product implication → the Rule 55 gap list, concrete.** Six changes to `challan.html` and its
> data path:
>
> 1. **Consignee GSTIN.** `p2_clients.gstin` already exists (added July 30). It is simply not rendered —
>    `challan.html:444` prints `client_name` and `client_address` only. **One-line fix; do it first.**
> 2. **HSN per line.** `p2_raw_materials.hsn_sac` and `p2_products.hsn_sac` already exist (added Aug 7,
>    `20260807_add_product_hsn.sql`). Add an HSN column to the items table. **Data already present.**
> 3. **Taxable value per line + challan total.** Nothing to source it from on a job work issue, where no
>    sale price exists. Use, in order: the line's own declared rate → `p2_material_prices` latest → last
>    GRN `rate` on `p2_stock_transactions`. **Store the value used on the dispatch line** — do not
>    recompute it at print time, or the challan and the ITC-04 export will disagree a year later.
> 4. **Tax rate columns.** `p2_raw_materials.gst_rate` exists. Print rate and amount. For a job work issue
>    this is arguably outside Rule 55(1)(vii) (it is not a supply to the consignee) — but **ITC-04 Table 4
>    demands taxable value and rate of tax regardless**, so capture it either way and print it under a
>    heading that does not assert a supply, e.g. *"Value declared for e-way bill / ITC-04 purposes — not a
>    supply"*.
> 5. **Place of supply**, shown when the consignee's state code ≠ the consignor's state code. Derive from
>    the first two digits of the two GSTINs.
> 6. **Triplicate marking.** Three print copies with ORIGINAL / DUPLICATE / TRIPLICATE headers.
>    `[INFERRED]` For job work specifically, offer a **four-copy mode** per Circular 38/12/2018 practice.
>
> **Plus two that are not Rule 55 but are audit-practical** `[INFERRED]`: a **movement-purpose declaration
> on the face of the challan** ("Sent for job work under Section 143 — not a supply", or "Returned after
> job work against your challan DC/26-27/0121 dated 14-Jul-2026"), and an **e-way bill number field**.
> The first is the single cheapest thing you can print to make an officer's question go away; the second
> is covered in §6.3.

## 2.2 Serial numbers

`[LAW]` **"serially numbered not exceeding sixteen characters, in one or multiple series."** That is the
entire statutory format requirement for a delivery challan. There is **no prescribed format**, no mandated
financial-year token, and **no statutory FY reset** for challans.

`[INFERRED]` However — the analogous invoice rule (Rule 46(b)) requires a *"consecutive serial number not
exceeding sixteen characters… unique for a financial year"*, and universal practice, every CA's
expectation, and GSTR-1 Table 13's document-series reporting all assume a **financial-year-scoped,
gap-free, non-reused series**. Deviating from that convention costs you credibility with the CA even where
it does not breach Rule 55.

### Nexflow's numbering — three concrete problems

**Problem 1 — the stored number is 18 characters, over the 16-character limit.** `[LAW]` + code. The
format is `CHAL-YYYYMMDD-NNNN` (`AGENTS.md:30`, and the `CHAL-\d{8}-` strip repeated across
`challan.html`, `export.html`, `all-dispatch-history.html`, `dispatch-history.html`). Count:
`CHAL-` (5) + `20260903` (8) + `-` (1) + `1234` (4) = **18**. The printed challan strips the prefix and
shows only `NNNN`, so **the document is fine and the database is not** — but the ITC-04 export, the GSTR-1
Table 13 register and any audit extract report the *stored* value.

**Problem 2 — no financial-year reset, and an integer sequence with no series token.** `challan_sequence`
on `p2_tenant_settings` is a monotonically incrementing integer that never resets. Two consequences:
`[INFERRED]` (a) the CA cannot state a clean per-FY document range in GSTR-1 Table 13 without deriving it
from dates; (b) the number carries no signal about which series it belongs to when `challan_mode` is
`split`.

**Problem 3 — `challan_next_override` can move the sequence backwards, enabling reuse.**
`hard_delete_dispatch` sets `challan_next_override` to the deleted challan's number so it can be reissued
(`20260901_cancelled_challan_movement_purpose.sql`). The mitigation — logging the number to
`p2_cancelled_challans` before deletion — is already in place and is good design. But
`[INFERRED]` **a reissued number is a materially different fact from a cancelled number**, and if the
original was ever printed and handed to a driver, two physical documents now bear the same serial. That is
exactly the anomaly an audit is designed to catch.

### What a gap in the sequence actually causes

`[INFERRED]` No specific penalty attaches to a gap. What it causes is **evidentiary**: an unexplained gap
invites the presumption that a document was issued and suppressed, which is the standard route to
unaccounted-supply allegations. The defence is a **cancellation register** — the number, the date, the
reason, retained. `[LAW]` Rule 56 requires registers of delivery challans to be maintained, and
`p2_cancelled_challans` was built for exactly this (the migration comment cites Rule 56(7)).

> **Product implication →**
> 1. **Shorten the stored challan number to ≤16 characters** and adopt an FY-scoped, series-bearing
>    format. Suggested: `JW/26-27/0184` (13 chars) for job work and `DC/26-27/0184` for other movements —
>    the series token also solves `challan_mode: split`. **This is a migration touching three live tenants
>    and every historical row; do not rewrite history.** Change the generator forward from a cutover date,
>    keep old numbers as they are, and make every reader tolerate both shapes (the code already strips a
>    `CHAL-\d{8}-` prefix in five places — that becomes the legacy branch).
> 2. **Reset the sequence at each financial year** (1 April, IST — note `20260901_fix_invoice_number_ist.sql`
>    already established the IST-boundary pattern for invoices; reuse it).
> 3. **Make `challan_next_override` re-issue an explicitly cancelled number only, never a printed one.**
>    Record whether a challan was ever rendered/printed/emailed; if it was, forbid reuse and burn the
>    number.
> 4. **Surface a challan continuity report** — issued / cancelled / missing / gaps — per FY per series.
>    This is Sheet 0's continuity block, and it doubles as GSTR-1 Table 13 (already Step 1 in the plan,
>    `kpml-network-plan.md:234`).

## 2.3 E-way bill thresholds for job work

`[LAW]` **Intra-state, Maharashtra: ₹1,00,000.** Maharashtra **Notification No. 15E/2018-State Tax dated
29 June 2018** — no e-way bill required for intra-state movement where the consignment value does not
exceed ₹1 lakh, for any goods. Effective 1 July 2018. **Confirmed.** The ₹50,000 figure in circulating
literature is the *central default* under Rule 138(1) and is wrong for Maharashtra intra-state.

`[LAW]` **Inter-state job work: any value.** Second proviso to Rule 138(1): *"Where goods are sent by a
principal located in one State or Union territory to a job worker located in any other State or Union
territory, the e-way bill shall be generated **either by the principal or the job worker, if registered,
irrespective of the value of the consignment**."* A ₹4,000 inter-state job work movement needs an e-way
bill. This confirms `kpml-network-plan.md:1047–1048`.

### Job-work-specific exemptions above the threshold

`[LAW]` **There is no general job work exemption from the e-way bill.** Rule 138(14) lists the exemptions
(a)–(o): specified goods in the annexure; non-motorised conveyance; movement from port/airport/land
customs station to an ICD/CFS for customs clearance; notified areas within a State; goods in the relevant
State's Schedule (other than de-oiled cake); alcoholic liquor, petroleum crude, HSD, petrol, natural gas,
ATF; goods treated as no supply under Schedule III; goods under customs bond/seal; transit cargo to or
from Nepal or Bhutan; exempt goods; movement caused by defence formations; empty cargo containers; rail
transport where the consignor is Government; movement to or from a weighbridge within 20 km with a
delivery challan; and empty LPG cylinders moved for reasons other than supply.

**None of these covers engineering job work.** `[INFERRED]` The Schedule III / "no supply" clause is the
one people reach for and it does not apply — job work movement is not a supply, but it is not a
**Schedule III** activity either, and Rule 138(14) is keyed to Schedule III specifically.

`[LAW]` The **one** job-work exemption Maharashtra actually granted, in the same Notification 15E/2018, is
narrow and sectoral: **hank, yarn, fabric and garments transported for job work within Maharashtra, of any
value, for a distance up to 50 km.** Textile only. It does not reach a machined casting.

`[LAW]` Two related mechanics worth building around:

- **Rule 138(3)** — for movement up to **50 km within the State** from the consignor's place of business
  to the transporter's place of business for further transportation, **Part B (conveyance details) need
  not be furnished**. Part A is still required. This is not an exemption from the e-way bill.
- **Validity** — one day per **200 km** (over-dimensional cargo: one day per 20 km).

`[LAW]` **Consignment value** for the threshold test is the value declared in the invoice, bill of supply
**or delivery challan**, including tax. For a job work challan there is no invoice — **the challan's own
declared taxable value is the number the threshold is tested against.**

> **Product implication →** This closes a loop with §2.1. Nexflow **cannot evaluate the e-way bill
> threshold at all today**, because the challan carries no taxable value. Rule 55(1)(vi) and the e-way bill
> rule are the same missing field. Build the value field once and both problems close.
>
> The rule Nexflow should implement:
>
> ```
> if (consignor_state != consignee_state)        → e-way bill REQUIRED, any value
> else if (challan_taxable_value > 100000)       → e-way bill REQUIRED   (Maharashtra)
> else                                            → not required on value grounds
> ```
>
> …with the consignor's state read from the tenant's own GSTIN, not hard-coded to 27. Two of the three
> live clients could take an out-of-state principal tomorrow, and a hard-coded Maharashtra rule would then
> be silently wrong in the dangerous direction.

## 2.4 Surviving a challan challenge in an audit

`[SOURCED]` From the Madras High Court order at §1.4 and the practitioner analysis around it, what the
department demands alongside the challan:

1. **The challan itself**, for every movement, in both directions.
2. **The stock register and the job-work reconciliation account** — quantities sent against quantities
   returned.
3. **Evidence of return, or of onward supply with the correct tax treatment.**
4. **Form ITC-04** for the relevant periods, and consistency between it and the challans.
5. **Tax-paid supply invoices**, where the goods did not return in the same form.
6. **Internal accounts** showing the job work transactions.

`[SOURCED]` The framing from the same source: *"In GST, documentation is not a mere formality; it is often
the evidence that keeps a beneficial statutory facility alive."* And: technical glitches uploading ITC-04
**do not excuse** missing underlying documents.

`[INFERRED]` What a factory in Karad can produce alongside the challan, that actually persuades an officer:
the **e-way bill** where the value crossed the threshold; the **transporter's LR / consignment note**; the
**gate inward and outward register** with the vehicle number and time; the **weighment slip** where the
material is weighed; the **job work invoice** for the processing charges, which independently proves work
was done on that quantity; and the **acknowledged copy of the challan bearing the receiver's signature**.
The last one matters more than its formality suggests: an unsigned challan proves an intention, a signed
one proves a receipt.

> **Product implication →** Sheet 6 of the working paper (§1.7) is this list, machine-generated. Beyond
> that, **the QR verification already on Nexflow's challan is a better audit artefact than it currently
> gets credit for** — a scannable, timestamped, tenant-scoped record that this exact document existed on
> this date, independent of the paper. Consider what the QR resolves to: today it verifies delivery. Make
> it resolve to a **read-only challan facsimile with the movement purpose, both GSTINs, the line items and
> the acknowledgement state** — that is a document an officer can check on his own phone at the gate.
>
> **Second implication →** add a **receiver acknowledgement capture**: date received, name, and either a
> scanned signed copy or an in-app confirmation from the counterparty tenant. In the KPML network case,
> where both sides are on Nexflow, this is free — the counterparty's GRN *is* the acknowledgement.

## 2.5 Is a digitally generated challan valid without a wet signature?

**Short answer: yes, provided it is authenticated — and Nexflow does not currently authenticate anything.**

`[LAW]` Rule 55(1)(ix) requires **"signature"**, with no qualifier and no e-invoice-style carve-out. (Note
the contrast: Rule 46, for tax invoices, has an explicit proviso dispensing with the signature for an
electronic invoice issued under the Information Technology Act, 2000. Rule 55 has no equivalent proviso.)

`[LAW]` **Rule 26(1) CGST Rules** provides for documents to be authenticated by **digital signature
certificate (DSC), or e-signature as specified under the Information Technology Act, 2000, or such other
mode of verification as notified**.

`[LAW]` **Rule 56(15)** — records may be maintained in **electronic form**, authenticated by means of a
**digital signature**. `[LAW]` **Rule 56(18)** — books must be produced on demand.

`[LAW]` **IT Act 2000 sections 4 and 5** give legal recognition to electronic records and electronic
signatures: where a law requires information in writing, or authentication by signature, the electronic
form satisfies it.

`[SOURCED]` The practitioner position: **GST does not mandate a fixed printed layout for a delivery
challan** — a PDF or Word format is valid as long as it carries every Rule 55(1) particular; and a
delivery challan may be signed digitally using a DSC.

`[INFERRED]` **The practical answer for Nexflow's three clients.** In the real world, the challan is
printed, physically signed by the authorised signatory, and handed to the driver, because the driver needs
paper and the receiver's storekeeper signs the same paper on receipt. That path is unambiguously valid and
is what these factories already do. The purely-digital path (no paper, no wet ink) is *legally* available
but requires an actual DSC or IT-Act-compliant e-signature — **an image of a signature pasted into a PDF is
neither**, and no Indian factory is going to buy a DSC for a delivery challan.

> **Product implication →** **Do not build DSC signing.** It is a real feature with a real cost and no
> demand at this tier. Do three cheaper things instead:
>
> 1. **Keep the printed signature blocks** exactly as they are — that is the compliant path in use.
> 2. **Add a footer line asserting the document's provenance**: *"System-generated delivery challan.
>    Generated by Nexflow on 03-Sep-2026 11:42 IST. Document ID a4f1…"* This is what makes an officer
>    treat an unsigned photocopy as a system record rather than a loose paper.
> 3. **Make the QR the authentication story** (see §2.4). A verifiable link back to an immutable record is
>    more persuasive in 2026 than a scanned signature, and you already have the mechanism.

---

# Part 3 — Multi-principal stock segregation

## 3.1 Is separate record-keeping legally required?

**The honest answer is that there is no rule that says "a job worker shall maintain separate stock records
per principal" in those words. The obligation is assembled from four provisions, and it lands in the same
place.**

`[LAW]` **Section 143(2)** — accounting responsibility for the inputs and capital goods lies with the
**principal**. So the *primary* obligation is KPML's, and each principal maintains his own account of his
own material. That structure by itself produces per-principal records at the principal end.

`[LAW]` **Section 35(1)** — every registered person shall keep at his principal place of business a true
and correct account of, among other things, **production or manufacture of goods, inward and outward
supply, and stock of goods**. A registered job worker is a registered person. This is his own obligation,
independent of s.143(2).

`[LAW]` **Section 35(6)** — where a registered person **fails to account for the goods**, the proper
officer shall determine the tax payable on them **as if such goods had been supplied by such person**, and
s.73 or s.74 applies. This is the provision that bites the *job worker*, not the principal.

`[LAW]` **Rule 56(5)(c)** — every registered person shall keep the particulars of *"the complete address
of the premises where goods are stored by him, including goods stored during transit, along with the
particulars of the stock stored therein."* Note the wording: **goods stored by him**, not goods owned by
him. Principal-owned material lying in the job worker's shed is within this.

`[LAW]` **Rule 56(6)** — if taxable goods are found stored at a place **not declared under sub-rule (5)**
and **without the cover of any valid documents**, the officer *"shall determine the amount of tax payable
on such goods as if such goods have been supplied by the registered person."* Two conditions, and the
second is the one Nexflow addresses: **valid documents**. The job worker's defence against a deemed supply
on someone else's material sitting in his factory is the challan under which it arrived.

`[LAW]` **Rule 56(12)** — every registered person **manufacturing goods** shall maintain **monthly
production accounts** showing quantitative details of raw materials used and of goods manufactured,
**including waste and by-products**. A job worker is manufacturing. This is a quantity-reconciliation
obligation, monthly, on the job worker himself — and it is the rule Nexflow's production-issue / BOM
explosion module already substantially satisfies.

### One correction, because CAs get this wrong

`[LAW]` **Rule 56(11) — the "separate particulars for each principal" rule — applies to *agents* under
section 2(5), not to job workers.** It requires an agent to maintain, separately for each principal, the
particulars of authorisation, description/value/quantity of goods received and supplied on that
principal's behalf, accounts furnished to each principal, and tax paid. It is frequently cited in
job-work articles. **A job worker is not an agent** — he does not supply on the principal's behalf, he
performs a process on the principal's goods.

> Do not put "Rule 56(11)" on a Nexflow marketing page or in a CA conversation. If a CA cites it at you,
> the correct and credibility-building response is: *"That's the agency rule under s.2(5) — for a job
> worker the chain is s.35(1) and s.35(6), Rule 56(5)(c) and 56(6), and Rule 56(12) for the production
> account."* Getting this right in one conversation is worth more than any feature.

**Conclusion.** `[INFERRED]` A job worker is not *expressly* commanded to keep a per-principal stock
ledger. He is commanded to account for all goods stored at his premises with valid documents, to keep a
monthly production account with quantitative detail, and he is liable under s.35(6) for anything he cannot
account for. **With one principal, an aggregate stock account discharges that. With two principals holding
the same material at the same premises, only a per-principal, per-material, per-document account can.**
The legal requirement is de facto, and it arrives with the second principal.

> **Product implication →** This is the sales line for the multi-principal feature and it is a *legal*
> line, not a convenience line: *"With one principal you could get away with one stock figure. With two,
> s.35(6) means anything you cannot attribute is treated as your own supply."*

## 3.2 Audit risk when the vendor cannot prove whose material is whose

`[LAW]` **Section 35(6)** is the mechanism: unaccounted goods → deemed supplied *by the job worker* → tax
under s.73 or s.74. `[LAW]` **Rule 56(6)** is the parallel mechanism for undeclared storage without valid
documents.

`[INFERRED]` **The specific failure that follows from commingling.** Suppose Shivprasad holds 8 tonnes of
EN8 round bar. 5 t is KPML's, 3 t is Principal B's. Both arrived on job work challans. Physical stock is in
one rack. Now:

- **KPML's ITC-04 says 5 t is with Shivprasad.** Principal B's says 3 t. Both are right.
- **Shivprasad's books show 8 t of material he does not own.** If his stock account shows one line
  ("EN8 round bar — 8 t") with no owner attribution, the officer's question is: *which challan covers
  which tonne?*
- **Consumption is where it breaks.** If Shivprasad machined 200 housings for KPML but drew the bar from
  the commingled rack, and the paperwork attributes the draw to nothing in particular, **neither
  principal's reconciliation closes.** KPML's ITC-04 shows material sent and not returned; Principal B's
  shows the same; and Shivprasad cannot demonstrate which.
- **The doubling risk.** `[INFERRED]` In the worst case the same physical material is claimed as covered
  by two different principals' challans, and the officer treats the *excess* — the quantity present with
  no valid document uniquely attributable to it — as Shivprasad's own unaccounted stock under s.35(6).

`[SOURCED]` The department's actual posture, from the Technocast Foundry line of reasoning: it is not the
commingling that creates the demand, it is **the inability to produce a record establishing the statutory
path of the goods.** Revenue neutrality is a defence but requires detailed proof; general assertions fail.
Related-party informality is not a defence.

`[INFERRED]` **No case specifically on job-worker multi-principal commingling surfaced in this research.**
I looked; the reported job work cases are principal-side non-return cases. Present this to a CA as a risk
analysis, not as a decided position.

> **Product implication →** The demo that sells this feature is one screen: **the same material, two
> owners, two balances, one physical rack, and a per-principal challan trail behind each balance.** Show a
> vendor his own stock figure split by owner for the first time and the feature explains itself.
>
> **Second implication → the wrong-pool-consumed error is now a legal error, not just a data error.**
> `kpml-network-plan.md:229` already lists "Wrong pool consumed by accident" as a Step 2 pain. §3.2 is why
> it is a compliance pain: consuming Principal B's bar against KPML's order corrupts both principals'
> ITC-04 reconciliations and leaves an unattributable quantity on the floor.

## 3.3 What MIDC factories actually do today

`[INFERRED]` — **no published source.** This is a strong prior from how the constraints stack up, and it is
the highest-value thing in this file to verify by walking into a factory.

**The likely spectrum, most to least common at 10–50 person MIDC units:**

1. **Physical separation by rack, bay or floor-marking, with the principal's name in paint or on a
   laminated card.** This is the honest, low-tech answer and it works — until the rack overflows, or a
   part is common to both principals, or material moves to the machine and back.
2. **A separate paper register per principal**, usually a bound "Inward/Outward Register", maintained by
   the storekeeper. Reconciled to the challan file on demand, i.e. when the principal's team visits.
3. **Nothing but the challan file.** Material is commingled; the answer to "whose is this?" is
   reconstructed from the challan bundle when someone asks. `[INFERRED]` This is probably the modal case,
   because it is the path of least resistance and nothing forces the issue until an audit.
4. **A shared Excel sheet**, maintained by whoever is most comfortable with a computer, usually incomplete
   after three months.

**Why the honest ones still fail.** `[INFERRED]` Even a factory that separates racks scrupulously loses
attribution at three points: (a) **at the machine** — material drawn to the shop floor loses its rack
identity; (b) **in WIP** — a part half-machined belongs to a principal but sits in no owner's rack, which
is exactly the "month-end phantom shortfall that looks like theft" already identified in
`kpml-network-plan.md:227`; (c) **in scrap and offcut** — turnings and rejected pieces from two principals
go into one bin, and s.143(5) says scrap has an owner and a tax event.

> **Cheapest verification.** On the next site visit to Shivprasad or Datta Prasad, ask the storekeeper
> three questions and photograph the answer: *"Show me where material from a second customer would go."*
> *"If two customers sent the same grade of bar, how would you know which is which next month?"* *"Show me
> the register you write in when a truck comes."* Fifteen minutes, and it settles Part 4.1 as well.

## 3.4 What Nexflow's data model needs

**The good news: the hard part is already done and done correctly.**

`owned_by` on `p2_stock_transactions`, `p2_dispatch_orders` and `p2_wip_transactions` is **`uuid NULL
REFERENCES p2_clients(id)`** — not a boolean, not an enum. NULL means own material; a UUID means *that
specific client's* material. **The schema is already multi-principal.** `confirm_bom_issue` v3 and
`confirm_dispatch_transaction` both take `p_owned_by` and use `IS NOT DISTINCT FROM p_owned_by` for the
sufficiency check, which handles the NULL pool and any named pool in one expression. `p2_clients` carries
`is_job_work_principal` and `linked_tenant_id`. `v_p2_wip_balance` groups by `owned_by`.

So the answer to *"if Shivprasad works for both KPML and Principal B, what does the ownership model need to
track that it doesn't today?"* is **not a new ownership column**. It is these seven things:

**1. An inbound path. This is the biggest single gap in the product.**
There is no way to record principal-owned material *arriving*. Every pool balance today must have been
created by an adjustment or by the vendor's own GRN, and `v_p2_stock_balance` **filters `owned_by IS NULL`
in its JOIN and does not expose `owned_by` as an output column** (`_ai/CLAUDE.md:207–209`). Until an
inbound job-work GRN exists, the principal pool can only ever be depleted, never filled.

> **Build:** a **job-work-inward GRN** — a receipt whose `movement_purpose` is the inbound counterpart of
> `job_work_issue`, which records the **principal's challan number and date**, the principal (→ `owned_by`),
> quantity, UQC, HSN, declared taxable value, the e-way bill number if any, and the s.143 clock start
> **from the principal's challan date, not from the receipt date**. This last point is not cosmetic:
> s.143(1)(a) runs from the day the goods were *sent out*, and Nexflow's trigger currently starts the clock
> from `dispatch_date` on the vendor's own outward row — which does not exist on the inbound side at all.

**2. A per-principal stock view.** `v_p2_stock_balance` is own-stock-only by construction, and
`CLAUDE.md:209` explicitly warns never to add an `owned_by` PostgREST filter to it. Correct — do not
change that view. **Add a sibling view** (`v_p2_stock_balance_by_owner`) that groups by
`(tenant_id, raw_material_id, owned_by)` and exposes `owned_by`, and let the UI choose. Every stock read
in the app then has to declare which one it wants, which is the right forcing function.

**3. A per-principal challan series.** `[INFERRED]` Rule 55 permits multiple series. With two principals,
one series makes both principals' ITC-04 continuity blocks show gaps — KPML sees `0184, 0186, 0189` and
asks where 0185 and 0187 went, and the answer is "another customer you're not allowed to know about." That
is a confidentiality problem as much as a compliance one. **Give each principal its own series token**
(`JW/KPML/26-27/0042`), or at minimum make the continuity report per-series so KPML's view is gap-free.

**4. Per-principal ITC-04 periods.** KPML files half-yearly (AATO > ₹5 cr); Principal B may file annually.
Nexflow's `aato_bracket` is on the tenant. **Add `aato_bracket` (or a direct `itc04_frequency`) to
`p2_clients` for principals**, and drive the working paper's period selector from the principal, not the
tenant.

**5. Per-principal agreement terms.** Yield tolerance, rate, nature of job work, payment terms, rejection
policy. The plan already has a job work agreement record at Step 7 — with two principals it stops being a
Step 7 nicety and becomes the thing that keeps `Nature of job work done` and the variance tolerance from
being global constants.

**6. Confidentiality between principals — a schema concern, not just a UI one.** `kpml-network-plan.md:243`
already names *"One principal can see another's existence"* as a Step 6 item with a single scoped access
path. Note the sharper version: KPML must not be able to infer Principal B **from a challan number gap, a
stock total, a scrap figure, or a dashboard count**. That is a constraint on aggregates, not just on rows.

**7. Scrap attribution per principal.** `[LAW]` s.143(5): waste and scrap generated during job work may be
supplied by the job worker directly on payment of tax if he is registered, or by the principal if not.
`[LAW]` ITC-04 Tables 5A/5B/5C each carry losses-and-wastes UQC and quantity. **Scrap has an owner, a tax
event and a return-line in the ITC-04.** With two principals in one scrap bin, unattributed scrap breaks
both reconciliations. Make `owned_by` mandatory on any `scrap_return`.

> **Product implication → UI changes, minimal set.** A **pool selector** on every material-touching screen
> (GRN, dispatch, RM dispatch, production issue) that is *invisible* when the tenant has zero principals,
> *pre-selected and locked* when it has exactly one, and *a required choice* when it has two or more. This
> preserves the Type A guarantee (`is_job_work_setup_seen`) for standalone tenants, keeps today's
> single-principal clients unchanged, and only introduces friction where the law introduces it.

---

# Part 4 — Field intelligence: what factories actually do

> **Sourcing warning.** Everything in Part 4 marked `[INFERRED]` is reasoning, not reporting. The
> published record on Indian factory-floor practice is close to empty. Each subsection ends with a
> verification step that costs under an hour.

## 4.1 A storekeeper's day, gate to GRN

`[INFERRED]` Reconstructed from the document flow the law and the codebase require. Treat as a hypothesis
to test, not as observation.

| Time | What happens | Where it breaks |
|---|---|---|
| ~09:15 | Truck at the MIDC gate. Watchman notes vehicle number and driver name in the **gate register** — a bound book, ballpoint, no carbon. | The gate register is the only record for the next 40 minutes and it is never reconciled to anything. |
| ~09:20 | Driver hands over the **challan set** — 2 or 3 copies. Storekeeper checks the **consignee name** and the **PO number**, in that order. He does not check HSN, taxable value, or the GSTIN. | If the challan is short a copy, he takes the goods anyway and the acknowledged copy is never returned to the principal. Circular 38/12/2018's "job worker sends one copy back" fails silently, right here. |
| ~09:25 | **Unloading.** Count by piece, or weigh if the material is by weight. Weighment slip if there is a weighbridge; eyeball if not. | Weight-to-piece conversion. Bar received in KG, issued to the machine in NOS, and nobody records the conversion factor. This is UQC error #2 from §1.2, and it originates here. |
| ~09:40 | **Physical check** — grade marking, heat number, visible damage, count vs challan. Discrepancy → he calls **the purchase person or the owner**, not the principal. | A short quantity is resolved by phone and the challan is signed for the full quantity anyway, because the driver is waiting. **The signed challan then proves a receipt that did not happen.** |
| ~09:45 | **He writes it on paper first.** A bound inward register, or the back of the challan, or a loose slip. Material name, quantity, vehicle, date, supplier. | This slip is the real record for the next several hours to several days. It is the source of every GRN backlog. |
| ~09:50 | Material goes to a rack. Marking varies: a chalked customer name, a tied tag, or nothing. | Where the multi-principal attribution is won or lost — see §3.3. |
| 10:00–17:00 | **He does not touch the computer.** He is issuing material to machines, chasing shortages, and handling three more trucks. | |
| ~17:30, or tomorrow, or Saturday | **GRN entry** — from the slips, in a batch. | **Everything upstream compounds here.** Dates are entered as the entry date, not the receipt date. A slip is missing. A quantity is remembered. This is where the challan-date-vs-receipt-date error that breaks the s.143 clock is born. |

`[INFERRED]` **The three highest-value interventions, in order:**

1. **Make the paper slip the input, not the enemy.** A photo of the challan, taken at 09:20 at the gate,
   attached to a stub record. Entry can happen at 17:30 — but the **date, vehicle and challan number are
   captured at the gate** and cannot drift.
2. **Never default the GRN date to today.** Default it to the **challan date on the document**, with the
   entry timestamp recorded separately. This one default is worth more to s.143 accuracy than any report.
3. **Make short-receipt a first-class outcome.** `kpml-network-plan.md:632` already has "Rejection at the
   gate — accepted / rejected / short" at Step 7. §4.1 argues it belongs earlier: a signed-for-full,
   received-short challan is the most common single corruption of the whole chain, and it happens before
   any other data exists.

> **Cheapest verification.** Stand at Shivprasad's gate for one morning. Two hours. Photograph the gate
> register, the inward register, and one challan set. That single visit resolves §4.1, §3.3, and half of
> §4.5.

## 4.2 Why factories leave Tally

`[SOURCED]` What is documented, from ERP-vendor and comparison sources — read with the bias in mind, since
most of it is written by competitors:

- **Tally handles ledgers, GST returns and basic inventory.** Manufacturers get no real-time visibility
  into production status, per-SKU cost, scrap rate, machine downtime, or **job-work pendency**.
- **Manufacturing MSMEs need BOM, job-work tracking, multi-unit inventory and GST simultaneously**, and
  Tally requires significant customisation to reach that.
- **Accountant dependency is structural**, not incidental — Tally's installed base is concentrated in
  businesses that have run it for a decade with a dedicated accountant or CA.
- **Cloud platforms are the growth segment** among Indian MSMEs in 2025–26, driven by e-invoicing mandates
  and the need for access from more than one desk.
- `[SOURCED]` On job work specifically: challans get raised, the outstanding balance lives in a **separate
  Excel sheet**, the 1-year and 3-year clocks are **tracked by memory**, and the s.143 liability surfaces
  only when an officer asks.

`[INFERRED]` **What actually breaks first, in order.** Tally does not fail at accounting — it is excellent
at accounting. It fails at the boundary where a *physical* fact must be recorded by a *non-accountant*:

1. **Job work pendency.** The first thing to move to Excel, because Tally's job work costing module needs
   configuration nobody at a 20-person unit will do, and because the question ("what's still with the
   vendor?") is asked by the owner, not the accountant.
2. **The shop floor cannot enter data.** Tally is a keyboard-driven desktop application on one PC in the
   accounts room. The storekeeper does not use it, so the paper slip → batch entry loop of §4.1 is
   *architecturally required*, not a bad habit.
3. **Multi-user costs a step change.** `[SOURCED]` Silver is single-user; Gold is a **LAN concurrent-user**
   licence; genuine multi-location working needs Tally Server at ₹2,70,000. There is no cheap second seat
   in a different building.
4. **Ownership of stock has no expression.** `[INFERRED]` Tally's inventory is *your* inventory. Free-issue
   material belonging to a principal is either not entered at all, or entered as your stock and then
   manually excluded from every report — which is exactly the "vendor's stock figures include material they
   don't own" pain at `kpml-network-plan.md:230`.

`[INFERRED]` **What the accountant takes with him when he quits.** Not the data — the data is in the
company file. He takes: which ledger group each party sits under and why; the voucher-class shortcuts;
which reports were customised and how; the un-reconciled suspense entries and what they really are; the
TDS and 43B(h) working papers that live on his personal Excel; and the *convention* — the naming pattern
for challan narrations, the way partial payments are recorded. `[INFERRED]` A replacement accountant needs
**two to four months** to be as fast, and during that window the factory is flying on the owner's memory.
**This is the single most acute moment to sell a system whose knowledge lives in the system, and it is
unpredictable and unmarketable-to in advance.**

> **Product implication →** The migration wedge is not "replace Tally." It is **"the things that already
> left Tally."** Job work pendency is already in Excel. The s.143 clock is already in someone's head. The
> stock-ownership split does not exist anywhere. Nexflow does not have to win the ledger — it has to win
> the Excel sheets that Tally pushed out, and to hand the accountant a clean export back into Tally.
> Nexflow already has a Tally export path; **treat it as a strategic asset, not a checkbox.**

> **Cheapest verification.** Ask each of the three live clients' accountants one question: *"Which things
> do you keep in Excel rather than in Tally, and why?"* The answer is the roadmap.

## 4.3 Marg ERP after installation

`[SOURCED]` From Trustpilot, Capterra, G2, Techjockey and SoftwareSuggest reviews — real users, though
review sites skew toward the aggrieved:

- **Dealer economics are the complaint, more than the software.** *"Dealers are only taking money and not
  giving service and not receiving calls."* Support is repeatedly described as very poor **after the
  sale**; several reviewers describe systems down for days with unresolved tickets.
- **Training does not happen.** *"Once product is sold their team don't care much about customer problems
  nor provide sufficient training."*
- **Feature volume is itself the problem.** *"Tons of features but creates confusion sometimes, which
  creates more issues than solutions."* The UI is described as not intuitive, with a steep learning curve
  driven by many industry-specific functions.
- **Integration with anything else is hard**, compounded by the support gap.

`[INFERRED]` **What this means post-installation at an MIDC unit.** Marg is sold through a local dealer who
earns on the licence and on AMC, not on adoption. He installs, configures billing and GST returns because
those are what the buyer will check in week one, gives a half-day of training to whoever is in the room,
and leaves. Six months later the factory is using **billing, GST returns, party ledgers and basic stock**.
Turned off or never configured: **job work, BOM/production, multi-godown, barcode, and the analytics
module.** What they hate: the dealer not picking up; needing the dealer for a change they should be able
to make themselves; and the reporting being unreachable without knowing where it lives.

> **Product implication →** *"What a factory switching from Marg to Nexflow would lose"* is a short list —
> and it is honest to say it out loud in a sales conversation: **the full accounting ledger, purchase and
> sales accounting, party ledgers, GST return preparation, and the local dealer who can be shouted at.**
> That last one is real and Nexflow's answer has to be better, not dismissive. What they gain is the four
> things Marg's dealer never turned on, delivered as the *default* path rather than as a module.
>
> **Sharper implication →** the reviews are a specification for how *not* to onboard. Nexflow's advantage
> against Marg is not features; it is that a sole developer who answers the phone beats a dealer who does
> not. **Make responsiveness the explicit product promise**, because it is the exact thing the incumbent
> is documented as failing at, and it is free for you to provide at three clients.

## 4.4 The CA recommendation channel

`[INFERRED]` — no published source on how a Satara or Kolhapur CA chooses. The reasoning below follows
from what a CA is actually optimising for, and every point is testable in one conversation.

**What a CA optimises for, in priority order:** (1) not being blamed when a notice arrives; (2) hours saved
per client, because his practice scales on staff time; (3) data he can rely on without re-checking;
(4) not having to learn a new tool; (5) client retention.

**What makes him actively recommend a tool:**

- **It produces a working paper in his format**, not a dashboard he has to read. A CA does not want a
  screen; he wants a file he can attach to his working papers and defend in an audit.
- **It reduces a task he currently dreads.** `[SOURCED]` Many CAs skip ITC-04 entirely. A tool that makes
  ITC-04 fillable turns a task he avoids into one he can bill for.
- **It makes the client's data arrive without chasing.** The chasing is the cost, not the filing.
- **It does not threaten his fee.** Anything positioned as "file your own returns" makes him an enemy.
  Anything positioned as "your CA gets a clean file" makes him an ally.

**What makes him actively warn against it:**

- **One wrong compliance statement.** Cite Rule 56(11) at a job worker, put ₹50,000 as the Maharashtra
  e-way bill threshold, or call ITC-04 quarterly for a ₹5-crore-plus principal, and he will conclude the
  software does not know the law. He will not check the other 40 things that are right.
- **Numbers that disagree with the books.** If Nexflow's stock value and Tally's stock value differ and
  nobody can explain why, he blames Nexflow.
- **Anything that looks like it files returns on the client's behalf**, or holds the client's GST portal
  credentials.
- **A tool the client bought without telling him.** `[INFERRED]` Being surprised is the fastest route to
  a negative recommendation, independent of quality.

> **Product implication →** Build the **CA-facing artefact**, not a CA-facing login. `ca-report.html`
> already exists and `ca_email` is already a field on `p2_tenant_settings` — the infrastructure is there.
> The minimum build to unlock the channel is in §6.6.
>
> **And a rule for the whole product:** every compliance number Nexflow displays must be traceable to a
> section, rule or notification, shown on hover or in a footnote. Not for the factory owner — **for the CA
> reading over his shoulder.** It converts "this software claims" into "this software cites," which is the
> difference between a recommendation and a warning.

> **Cheapest verification.** `kpml-network-plan.md:477` already schedules this as Step 0. Add a third
> question to the two already planned: *"If a client showed you this file, would you recommend the
> software to another factory client? What would stop you?"*

## 4.5 Phones, networks and WhatsApp on the factory floor

`[SOURCED]` India smartphone market, 2025–26: **Android ~92.4% share**; the **4–8 GB RAM band is the
largest segment at ~42.3%**; the **$100–200 (≈₹8,500–17,000) price band is the largest at ~30.5%**; and
sub-₹10,000 devices now ship with 5G as standard.

`[INFERRED]` **The device Nexflow must actually run on:** a ₹8,000–14,000 Android — Redmi / Realme / POCO /
Samsung M-series — with **4 GB RAM**, a **6.5–6.7" display at 720×1600 (HD+)**, Chrome or the Xiaomi/Samsung
default browser, 32–128 GB storage that is nearly full, and a screen with a cracked corner and low
brightness read under a factory skylight or a sodium lamp.

`[INFERRED]` **Network:** Jio or Airtel 4G/5G, generally fine in Karad and Satara MIDC, but **dead or
one-bar inside a steel-clad shed** — which is precisely where the storekeeper stands. Assume: good signal
in the office, none at the rack.

`[INFERRED]` **What makes a web app unusable on that device**, ranked by how often it will bite:

1. **A page that must fully load before anything is usable** on a one-bar connection inside a shed.
2. **Losing typed input on a network drop.** The single most trust-destroying failure. A storekeeper who
   loses a half-entered GRN once will go back to paper permanently.
3. **Tap targets under ~44 px, and dense tables** — the man is wearing gloves or has oil on his hands.
4. **Low-contrast text.** Grey-on-white is invisible under a skylight. `[INFERRED]` Nexflow should be
   testing at 720p width with the brightness at 40%.
5. **Memory.** 4 GB with 12 Chrome tabs open means the tab gets evicted and reloads on return. **State
   must survive a tab reload**, which is another argument for local draft persistence.
6. **Anything requiring a desktop-class print dialog.** `challan.html` already handles this correctly with
   an explicit mobile message (*"use your browser's Share button → Print"*) — that instinct is right and
   should be the pattern elsewhere.

`[SOURCED]` **WhatsApp is already the document rail for Indian SMEs.** Invoices, delivery challans and GST
confirmations arrive on WhatsApp from vendors and logistics partners; billing tools across the Indian
market (Vyapar, Swipe, Zoho, myBillBook, Tally integrations) embed WhatsApp sharing directly into the
invoice workflow to remove the export-attach-send steps.

`[INFERRED]` **The workflows that already exist at these three factories, that Nexflow must plug into
rather than replace:**

- **A group per customer**, or per customer's purchase person, where PO changes and schedule pulls arrive
  as forwarded messages and voice notes.
- **A photo of the challan sent to the office** the moment the truck leaves the gate. This *is* the
  dispatch notification.
- **The owner's personal chat with the accountant**, where the day's totals and payment questions live.
- **A photo of the signed, acknowledged challan** sent back as proof of delivery — the informal
  precursor to §2.4's acknowledgement capture.
- **Payment confirmation screenshots** — a UPI or NEFT screenshot forwarded as the receipt.

> **Product implication →** **Never ask anyone to stop using WhatsApp.** Two features follow:
> 1. **One-tap share of the challan PDF to WhatsApp** from the challan screen — the Web Share API with a
>    file, falling back to download-then-share. This replaces "photograph the paper" with "share the
>    document," which is the same gesture and a better artefact.
> 2. **Accept a WhatsApp-shaped input.** The gate-photo capture in §4.1 should produce something the
>    storekeeper would have sent on WhatsApp anyway. If Nexflow is more work than the photo he was already
>    taking, it loses to WhatsApp — every time.

> **Cheapest verification.** Ask each client's storekeeper to hand you his phone. Note the model, free
> storage, and browser. Open Nexflow on it, in the shed, not in the office. Thirty minutes, three clients.

## 4.6 The owner's real pain at 11pm

`[INFERRED]` — reasoning from the structure of a job-work business, not from interviews. But note that the
structure is unusually determinative here: a job worker's business has almost no pricing power, almost no
customer diversification, and a working capital cycle set by someone else.

**Ranked by what actually keeps a 10–50 person MIDC job work owner awake:**

1. **"Will KPML pay this month, and how much?"** Payment timing, not profit, is the whole game. Payroll is
   the 7th, the payment came on the 22nd last month, and a partial payment net of an unexplained deduction
   is worse than no payment because it cannot be planned around. **This is why the payment ledger and
   43B(h) work is the correct Step 3 priority.**
2. **"Am I about to lose the schedule?"** A missed delivery or a rejection batch means the next PO goes to
   another vendor in the same MIDC. He knows the other vendors by name. This is existential in a way that
   a tax notice is not.
3. **"Where is the shortage?"** Month-end stock does not tie, and he does not know whether it is theft,
   scrap not recorded, WIP, or a wrong entry. `[INFERRED]` **The fear here is specifically about people** —
   suspecting a long-serving storekeeper is corrosive, and being unable to rule it out is worse than
   knowing. The WIP-state feature is emotionally about this, not about accounting.
4. **"Did the material we sent back get accepted?"** An unacknowledged return is money not yet earned and
   a dispute not yet started.
5. **"Is there something in my paperwork that will cost me later?"** Present but **vague and distant** —
   the notice is not on the table, so it is not tonight's problem. `[INFERRED]` **Compliance is not the
   11pm fear.** It becomes the fear the day KPML's CA sends an email, and then it is the *only* fear.
6. **"Is my accountant / storekeeper going to leave?"** — the key-person risk of §4.2, viewed from the
   owner's side.

> **Product implication →** **The home screen must answer #1, #2 and #3, in that order. Compliance belongs
> on the home screen only as a rupee number with a date** — `₹4.2L breaches in 38 days` — because that is
> the one form in which a distant fear becomes tonight's action.
>
> **And the pitch order follows:** lead with money and schedule, land the sale on stock truth, and let
> compliance be the reason the CA blesses it. Leading with ITC-04 sells to the wrong fear at the wrong
> hour.

---

# Part 5 — Competitive field reality

## 5.1 Marg vs Tally in western Maharashtra

`[INFERRED]` — no regional dealer-density data is published for Satara/Kolhapur/Karad.

**The structural difference.** `[SOURCED]` Tally is a **perpetual licence** (₹22,500 Silver / ₹67,500 Gold,
plus 18% GST) with an annual TSS subscription (₹4,500 / ₹13,500 + GST) that is nominally optional and
practically mandatory, since TSS delivers the statutory updates that keep GST filing compliant. Marg is
dealer-led with a heavier AMC relationship and a documented post-sale service problem (§4.3).

`[INFERRED]` **CA acceptance is where Tally wins and it is not close.** Every CA's staff can read a Tally
company file. A Marg file, or a Nexflow export, has to be converted. **This is the real switching cost and
it is a cost imposed by the CA, not by the factory.** Any competitor's realistic position in western
Maharashtra is *alongside* Tally, feeding it, not replacing it.

`[INFERRED]` **Marg's regional strength is distribution and retail** (its pharma/FMCG distribution heritage),
not discrete manufacturing. In an engineering MIDC cluster, Marg is more likely to be found at the trading
and distribution units than at the machining job workers.

> **Product implication →** Position Nexflow as **the operations layer that feeds the accounting layer**,
> permanently, not as a transitional step toward replacing Tally. A factory switching from Marg to Nexflow
> **loses** full accounting, party ledgers, purchase/sales accounting and a shoutable local dealer; it
> **gains** ownership-aware stock, job work pendency with a rupee-denominated clock, a Rule 55-complete
> challan, an ITC-04 working paper, and a phone the storekeeper can actually use. **Say the losses out
> loud in the sales conversation** — it is what makes the gains credible, and the CA will find them anyway.

## 5.2 Vyapar's ceiling

`[SOURCED]` Vyapar markets BOM and raw-material consumption tracking, and e-way bill generation against a
sale. Its own materials concede that *"certain features for manufacturing industry is still in making."*
Its migration story is explicitly **Tally → Vyapar**, not the reverse.

`[INFERRED]` **Where a job work factory hits the ceiling.** Vyapar is a **billing app with inventory
attached**, and it models one world: *my goods, my customer, my invoice.* A job work factory needs four
things that are outside that model:

1. **Stock it does not own.** Free-issue principal material has no representation. This is the wall, and
   it is hit on day one of the first job work relationship — not gradually.
2. **A movement that is not a supply.** A delivery challan carrying goods that are not being sold. Vyapar
   can print a delivery challan; it cannot express a movement that must *return*.
3. **A clock.** Nothing in a billing app counts down one year from a document date and prices the breach.
4. **A reconciliation between two parties' quantity records.** Billing apps reconcile money, not
   quantities.

`[INFERRED]` **The specific forcing event.** Not turnover, not user count. It is **the first time a
principal's CA asks for the job work reconciliation** — an ITC-04 data request from KPML, or an ASMT-10 /
audit query landing at the principal that gets pushed down to the vendor. On that day the factory needs a
per-principal, per-challan quantity account it has never had, and no billing app can produce one.

> **Product implication →** **That moment is Nexflow's highest-intent sales trigger and it is
> observable.** It is a *dated, external* event, not a gradual dissatisfaction. Two things follow:
> (a) the CA channel (§4.4, §6.6) is not one channel among several — **it is the channel that sits at the
> trigger point**; (b) a "first ITC-04 request" onboarding path, which imports historical challans from a
> spreadsheet and produces a working paper for a past period, is worth more than any feature that only
> helps going forward. **The buyer arrives needing last year, not next year.**

## 5.3 Turning the Tally accountant into an advocate

`[INFERRED]` The accountant is the gatekeeper and, by default, the blocker — a new system means his
knowledge advantage falls and his workload rises during the transition. Both are rational fears. Reversing
it requires giving him something he wants that he cannot get today:

1. **Clean, complete data arriving without chasing.** His day is 40% chasing the factory for the missing
   challan, the missing bill, the unexplained payment. A system where those exist and are searchable is
   *his* win before it is anyone else's.
2. **A Tally-shaped export he trusts.** Nexflow already has Tally, Zoho and CA export paths with the
   intrastate/interstate GST routing handled (`20260807_add_purchase_type.sql`). **Guard that with
   regression tests as if it were the core product**, because for him it is.
3. **Removing ITC-04 from his desk.** `[SOURCED]` Many CAs skip it. Handing him a working paper turns a
   task he avoids into a deliverable he can bill for. That is not neutral to him — it is upside.
4. **Making him look right.** The 43B(h) exposure report (`kpml-network-plan.md:1082`, Step 1/3) is the
   clearest case: he is already maintaining that spreadsheet by hand, on data he had to ask for. Automating
   *his* spreadsheet, and letting him present it, is advocacy-generating in a way that automating the
   owner's dashboard is not.
5. **Never touching his fee or his portal credentials.** Nexflow prepares; he files. Say it explicitly and
   early, in those words.

> **Product implication →** Add an **accountant role** distinct from owner and staff: read-most, export-all,
> no operational writes, with a landing page that is a **list of exports and working papers** rather than a
> dashboard. Nexflow already has a role system (`get_my_role`, `p2_user_roles`) and `ca_email` on tenant
> settings. The accountant's home screen should be a filing cabinet, not a cockpit — that difference is the
> whole relationship.

## 5.4 Pricing anchors

`[SOURCED]` **The only firmly verified anchor is Tally**, from 2026 price lists:

| Item | Price (before 18% GST) | With GST |
|---|---|---|
| TallyPrime **Silver** (single user), perpetual | ₹22,500 | ₹26,550 |
| TallyPrime **Gold** (unlimited users on a LAN), perpetual | ₹67,500 | ₹79,650 |
| **TSS renewal Silver**, per year | ₹4,500 | ₹5,310 |
| **TSS renewal Gold**, per year | ₹13,500 | ₹15,930 |
| TallyPrime **Server** | ₹2,70,000 | ₹3,18,600 |

`[VERIFY]` **Marg and Vyapar list prices were not confirmed in this session.** Do not quote figures for
them from memory in a client conversation — pull the current price lists first.

`[INFERRED]` **What a 20-person MIDC unit is already paying, per year, across everything:**

| Line | Typical annual `[INFERRED]` |
|---|---|
| Tally TSS renewal (Gold) | ~₹16,000 |
| CA retainer — GST returns, TDS, books, ITR | **₹60,000 – ₹1,80,000** |
| Internet + a mobile plan or two | ~₹15,000 |
| Antivirus, backup, a Zoho or Google Workspace seat | ~₹10,000 |
| Occasional Tally customisation via the dealer | ₹5,000 – ₹25,000 |

`[INFERRED]` **Is ₹1 lakh/year shocking?** **Against the software line, yes. Against the compliance line,
no.** A ₹1 lakh annual software fee is roughly **6× the TSS renewal**, and that comparison will be the
owner's first instinct and will feel outrageous. The same ₹1 lakh is **within or below the CA retainer**,
and CA retainers get paid without a negotiation because the alternative is a notice.

**So the anchoring choice determines the outcome, and it is a choice you control:**

- Anchored as *software*, ₹1 lakh loses to "Tally costs me ₹16,000."
- Anchored as *compliance and working capital*, ₹1 lakh sits beside a CA retainer and against a **single
  s.143 breach on ₹10 lakh of material costing ≈₹2.76 lakh in tax and interest** (§1.3). One avoided
  breach pays for nearly three years.
- Anchored as *a share of what the relationship is worth*, it is a fraction of one month's job work
  billing to KPML.

`[INFERRED]` **Highest annual software fee a 20-person MIDC unit has paid without hard negotiation:** I
have no data and will not invent one. The defensible statement is narrower and still useful: **the ceiling
is not set by the number, it is set by which budget line the buyer books it against.** Note that
`kpml-network-plan.md:868` already prices the principal platform at ₹2.5–3 lakh/year — that is a KPML-side
number, anchored against KPML's compliance exposure and its 30-vendor network, and it is a different
conversation from the vendor-side price.

> **Product implication →** Never present the price next to a software comparison. Present it next to
> **(a)** the rupee s.143 exposure the product removes, **(b)** the CA hours it saves, and **(c)** the
> receivables it makes visible. And put the exposure number **in the product**, continuously — an owner who
> has watched "₹4.2L breaches in 38 days" on his phone for six months has already priced the product
> himself before you quote.

> **Cheapest verification.** Ask the three live clients what they pay their CA annually and what they paid
> for Tally. They will tell you; it is not sensitive. That single data point replaces this entire
> subsection's inference.

---

# Part 6 — Product implications

> **Status as of Sept 4 2026:** The following implications have been acted on:
> - UQC codes: built (p2_raw_materials.uqc, p2_products.uqc, backfilled)
> - parent_challan_id: built (p2_challan_links table)
> - principal_challan_no/date: built (p2_stock_transactions columns)
> - Tooling register: built (asset_tag, last_confirmed_at, confirmed_by)
> - v_p2_stock_balance_by_owner: built
> - 43B(h) direction: relabelled (placeholder — payables register not yet built)
>
> Still to build: ITC-04 working paper export, s.143 clock from principal_challan_date,
> physical stock count screen, Rule 55 compliance (client GSTIN etc — deferred until CA asks).

## 6.1 The ITC-04 export — exact spec

**Grouping:** per principal → per period → per UQC. **Sheets:** as §1.7 — Cover/Reconciliation, Table 4,
Table 5A, Table 5B, Table 5C, Tooling, Evidence index.

**Table 4 columns, in order:**

```
GSTIN of job worker (or State, if unregistered) | Challan No. | Challan Date |
Description of Goods | UQC | Quantity | Taxable Value | Type of Goods (Inputs/Capital goods) |
Rate of tax - Central | Rate of tax - State/UT | Rate of tax - Integrated | Cess
```

**Table 5A / 5B / 5C columns, in order:**

```
GSTIN of job worker (or State) | Original Challan No. (principal's) | Original Challan Date |
Challan No. issued by job worker | Challan Date issued by job worker | Nature of job work done |
Description of Goods | UQC | Quantity | Losses & Wastes - UQC | Losses & Wastes - Quantity
```

**Formatting rules — these are utility constraints, not preferences:** one header row; data from row 2;
challan number repeated on **every** line of a multi-line challan; **no** merged cells, blank rows,
sub-totals inside the range, or decorative headers; UQC as GSTN codes; GSTIN uppercase 15 characters;
dates in a single consistent format.

**Reconciliation checks to run before allowing export.** Block on the first four; warn on the rest.

| # | Check | Severity |
|---|---|---|
| 1 | Every Table 5 row resolves to a Table 4 challan (or an explicitly flagged pre-period challan) | **Block** |
| 2 | Every row has a UQC, and the UQC is unchanged between the sent and returned rows of the same lineage | **Block** |
| 3 | Every Table 4 row has HSN, taxable value and tax rate | **Block** |
| 4 | Every job worker GSTIN is 15 characters with a valid state code, or a State is given for unregistered | **Block** |
| 5 | Challan continuity — no gaps in the series for the period other than logged cancellations | Warn |
| 6 | Sent − returned − waste − closing = 0, per UQC | Warn, and print the residual on Sheet 0 |
| 7 | Declared waste as a % of sent, against the agreed yield tolerance per (product, vendor) | Warn |
| 8 | No challan number appears twice in the period | **Block** |
| 9 | Any challan past its s.143 deadline with an un-returned quantity | Warn **loudly** — this is a live liability |
| 10 | Returns in the period against challans issued before it are included | Warn if none found and prior-period balance > 0 |
| 11 | Exempt tooling excluded from ageing but present in Table 4 | Warn |
| 12 | Any `job_work_return` with no `parent_challan_id` | **Block** — cannot fill Table 5 columns 2–3 |

**What the CA validates it against:** his own challan file; the principal's GSTR-1 (for goods supplied from
the job worker's premises, Table 5C); GSTR-2B (job work charge invoices from the job worker, confirming
work was done in the period); the closing stock in the principal's books against Sheet 0's closing-with-
job-worker figure; and the prior period's closing against this period's opening.

> **Therefore: carry an opening balance.** A working paper that starts at zero every period is a working
> paper the CA cannot tie to anything. **Opening balance with job worker, per material, per UQC, per
> principal, is a required output** and it is the check that makes the file trustworthy.

## 6.2 The passbook screen

**What it must show beyond a running balance,** given Parts 1–3:

| Field / behaviour | Why | Source |
|---|---|---|
| **Per (principal × material × UQC) balance** — not per material | The UQC block is the CA's unit of reconciliation | §1.7 |
| **Opening balance for the period** | Otherwise it cannot tie to the prior ITC-04 | §6.1 |
| **The principal's own challan number and date** on every inward line | ITC-04 Table 5 columns 2–3 are mandatory | §1.2 |
| **Clock start = the principal's challan date**, not the receipt date | s.143 runs from when goods were *sent out* | `[LAW]` s.143(1)(a) |
| **Days remaining and the rupee exposure** per open line | The only form in which the owner acts on it | §4.6 |
| **HSN and taxable value** per line | Rule 55(1)(iv)/(vi) and ITC-04 Table 4 both need them | §2.1 |
| **Waste / loss declared**, pool-attributed | ITC-04 losses-and-wastes columns; s.143(5) | §3.4 |
| **WIP quantity, shown separately from stock** | Otherwise month-end looks like theft | `v_p2_wip_balance` |
| **The four closing components, explicitly** — returned · supplied from premises · waste · still held | This is the reconciliation identity; showing it as one net number hides the error | §1.7 |
| **Extension state** — extended-to date **and** the Commissioner's order reference | An extension with no order reference hides an exposure | §1.5 |
| **Exempt-tooling lines in a separate section**, never merged into the ageing | Exempt ≠ compliant ≠ invisible | §1.6 |
| **Evidence links per line** — challan PDF, e-way bill no., vehicle, acknowledgement | This is what an audit asks for | §2.4 |

**Legal fields that must be present for the passbook to serve as an ITC-04 working paper:** GSTIN of the
counterparty; the principal's original challan number and date; the job worker's return challan number and
date; description; **UQC** (not the free-text unit); quantity; taxable value; type of goods (inputs vs
capital goods); rate of tax; nature of job work done; and losses/wastes with their own UQC and quantity.
**Anything absent from that list makes the passbook a nice screen and not a working paper.**

> The passbook and the ITC-04 export should be **the same data at two altitudes** — the screen is the
> reconciliation the CA would do; the export is that reconciliation pasted into the utility. If they are
> built from different queries they will disagree, and the day they disagree in front of a CA is the day
> the CA channel closes.

## 6.3 The e-way bill question

**Recommendation: capture the number. Do not generate. Do not integrate — yet.**

**Minimum viable, and it is genuinely sufficient for compliance:**

1. **A `taxable_value` on every challan line** — required by Rule 55(1)(vi) anyway, and it is the input to
   the threshold test (`[LAW]` consignment value is the value declared in the delivery challan).
2. **An automatic requirement verdict** on the dispatch screen, before confirmation:
   - inter-state → **"E-way bill REQUIRED — any value"**
   - intra-state and value > ₹1,00,000 → **"E-way bill REQUIRED — Maharashtra threshold ₹1 lakh"**
   - otherwise → **"Not required on value grounds"**
   …with the state comparison derived from the two GSTINs, never hard-coded to 27 (§2.3).
3. **An e-way bill number field** (12 digits) plus generation date, printed on the challan and carried
   into the working paper's evidence index. Make it **required-to-confirm** when the verdict says
   REQUIRED, with an explicit override that records a reason — because there will be legitimate
   exceptions and a hard block will make people enter fake numbers.
4. **A validity reminder** — 1 day per 200 km `[LAW]` — for anything not delivered same-day.

**Why not generate.** `[INFERRED]` NIC e-way bill API access is gated and is normally reached through a
GSP, with credentials, whitelisting and a per-transaction cost; eligibility rules change. `[VERIFY]`
Confirm the current NIC/GSP eligibility terms before revisiting. Against that cost: **the factory's
existing workflow already generates e-way bills** — the transporter or the office generates them on the
NIC portal today, and it works. Nexflow generating them replaces a working process; Nexflow *telling the
user one is needed and capturing the number* fixes the actual failure, which is not generation but
**omission** — nobody realised one was required, especially on the small inter-state consignment where the
₹50,000/₹1,00,000 intuition says "too small to bother."

> **The whole value here is the verdict, not the integration.** The rule is counter-intuitive in both
> directions (§2.3), and the two mistakes it prevents — nagging on a ₹60K intra-state movement that needs
> nothing, and staying silent on a ₹20K inter-state movement whose absence means detention and penalty —
> are exactly the two mistakes the field makes.

## 6.4 Multi-principal handling

**Schema — additive, no rewrites.** `owned_by uuid → p2_clients(id)` already does the ownership work.

| Change | Table | Note |
|---|---|---|
| `parent_challan_id` / link table | `p2_dispatch_orders` or a new `p2_challan_links` | Return → original challan. **A return can settle several originals partially, so prefer a link table with a quantity.** Gates ITC-04 Table 5. |
| `principal_challan_no`, `principal_challan_date` | inbound GRN row | The principal's document, which Nexflow does not create. Drives Table 5 cols 2–3 **and** the s.143 clock start. |
| `uqc` | `p2_raw_materials`, `p2_products` | GSTN code, distinct from the display `unit`. Backfill required. |
| `taxable_value` | `p2_dispatch_items` | Rule 55(1)(vi) + e-way bill threshold + ITC-04 Table 4. Store the value used; never recompute at print. |
| `asset_tag`, `last_confirmed_at`, `confirmed_by` | tooling movements | §1.6 |
| `challan_series` | `p2_dispatch_orders` | Per-principal series. Also fixes `challan_mode: split`. |
| `aato_bracket` / `itc04_frequency`, `nature_of_job_work` | `p2_clients` (principals) | Per-principal filing cycle and Table 5 col 6 default. |
| `v_p2_stock_balance_by_owner` | new view | Grouped by `(tenant_id, raw_material_id, owned_by)`, exposing `owned_by`. **Leave `v_p2_stock_balance` alone** — `CLAUDE.md:207–209`. |
| **Inbound job-work GRN** | `movement_purpose` + GRN path | The largest single gap. §3.4. |

**UI.**

- **Pool selector** on every material-touching screen: hidden at zero principals, locked at one, required
  at two or more. Preserves the Type A guarantee.
- **Stock screens gain an owner dimension** — "My stock / KPML / Principal B / All", with the pool named
  everywhere a quantity appears.
- **Physical count screen** (currently missing) must count **per pool**, and its variance must post to the
  correct pool. A count that collapses two owners into one number is worse than no count — it manufactures
  exactly the unattributable quantity that s.35(6) punishes.
- **Confidentiality:** no screen, export, count or aggregate visible to one principal may reveal another's
  existence — including through a challan-number gap. This is why the per-principal series matters.
- **Scrap declaration** requires a pool. No default.

> **The single highest-leverage item on this list is the inbound job-work GRN.** Without it the ownership
> layer is a half-circuit: material can leave a principal pool but can never enter one. Every other item
> here is an improvement; this one is the precondition.

## 6.5 The Rule 55 gap list

**Must add to be Rule 55(1) compliant** — full detail and data sources in §2.1:

1. **Consignee GSTIN** on the printed challan — `p2_clients.gstin` exists, just render it. *One line.*
2. **HSN code per line** — `hsn_sac` exists on both masters. *Column + join.*
3. **Taxable value per line and challan total** — new field, new sourcing logic, **stored not computed**.
4. **Tax rate and amount** — `gst_rate` exists; label it so it does not assert a supply on a job work
   movement.
5. **Place of supply** when the consignee's state ≠ the consignor's state.
6. **Triplicate marking** — ORIGINAL FOR CONSIGNEE / DUPLICATE FOR TRANSPORTER / TRIPLICATE FOR CONSIGNER,
   with an optional four-copy job work mode.

**Must fix in numbering** — §2.2:

7. **Stored challan number ≤ 16 characters.** `CHAL-YYYYMMDD-NNNN` is **18**. Cut over forward; keep
   history; make readers tolerate both.
8. **Financial-year reset** at 1 April IST, with a per-series token.
9. **Never re-issue a number that was ever printed or emailed.**

**Not Rule 55, but build them with it:**

10. **Movement-purpose declaration on the face** — *"Sent for job work under Section 143 — not a supply"*
    or *"Returned after job work against your challan \<no\> dated \<date\>"*. The cheapest audit-defence
    line in the product.
11. **E-way bill number field** — §6.3.
12. **Receiver acknowledgement capture** — §2.4. Free when both parties are on Nexflow.

> **Sequence them 1 → 2 → 10 → 3/4/5 → 6 → 7/8/9.** Items 1, 2 and 10 are hours of work against data that
> already exists and they close the most visible gaps. Item 3 is the keystone — it unblocks Rule 55(1)(vi),
> the e-way bill verdict, and ITC-04 Table 4 simultaneously, which is three features from one field.

## 6.6 The CA as a distribution channel

**The artefact that gets you recommended is the ITC-04 working paper — specifically Sheet 0.** Not the app,
not a dashboard, not a login. A file that arrives in his inbox and saves him a day.

**Minimum build to unlock the channel:**

1. **The working paper, generated per principal per period, as one .xlsx**, with Sheet 0's reconciliation
   and continuity blocks and paste-ready Tables 4 / 5A / 5B / 5C. §1.7 and §6.1.
2. **Emailed to `ca_email` on a schedule**, on the 5th of the month following the period close, without
   anyone asking. `ca_email` exists on `p2_tenant_settings`; the notifications pipeline and cron
   infrastructure already exist (`20260831_notifications.sql`,
   `20260831_setup_cron_payment_overdue_notify.sql`). **The chasing is his cost; removing it is the gift.**
3. **A citation footer on every compliance figure** — section, rule or notification number. §4.4.
4. **An accountant role** whose landing page is a list of exports, not a dashboard. §5.3.
5. **A one-page cover note** he can forward to his own client, carrying the reconciliation summary, the
   exposure in rupees, and the Technocast Foundry citation (§1.4).

**Then bundle the two reports he is already doing by hand:** the **43B(h) exposure report** (already Step
1/3) and the **GSTR-1 Table 13 challan-series register** (already Step 1). `[INFERRED]` Both are on his
personal spreadsheet today. Automating a CA's own spreadsheet is a different act from automating his
client's operations — it makes him the beneficiary, and beneficiaries recommend.

**What makes him warn against it, restated as build rules:**

- **Never claim a rule you have not verified.** One wrong threshold and nothing else you say is checked.
- **Never hold portal credentials or file anything.** Nexflow prepares; he files. Say so in the product.
- **Never let two Nexflow numbers disagree.** The passbook and the export must come from one query.
- **Never let him be surprised.** If a client signs up, the CA should hear from the product before he
  hears from the client.

> **The channel opens at a specific, observable moment** — the first ITC-04 or audit data request landing
> on one of his job work clients (§5.2). Being the thing he reaches for at that moment is worth more than
> any amount of general marketing, and it requires exactly one artefact to exist and be good.

---

# Appendix A — Corrections and confirmations to `_ai/kpml-network-plan.md`

**Confirmed by this research:**

- §10.2 ITC-04 frequency — **correct.** Above ₹5 cr half-yearly (25 Oct / 25 Apr); up to ₹5 cr annual
  (25 Apr). Notification 35/2021-CT, effective 01.10.2021.
- §10.2 Table 4 / 5A / 5B / 5C descriptions and common columns — **correct.**
- Line 1047–1048 and §10.3 e-way bill thresholds — **correct.** Maharashtra intra-state ₹1,00,000
  (Notification 15E/2018-State Tax, 29.06.2018); inter-state job work at any value (second proviso to
  Rule 138(1)).
- `CLAUDE.md:649` — s.143(2) accounting obligation lies with the principal — **correct**, and now backed by
  a 2026 Madras High Court order (§1.4).
- §10.3 — Nexflow's challan missing HSN, taxable value, place of supply and triplicate marking —
  **correct**, and §2.1 adds **consignee GSTIN** to that list.

**Corrections:**

1. **§10.3 lists "place of issue" as a Rule 55 particular. It is not.** Rule 55(1) has nine particulars and
   place of issue is not among them (§2.1). Harmless to print, but do not cite it as a legal requirement to
   a CA.
2. **§10.3's Rule 55 list omits the 16-character serial-number limit**, which Nexflow's stored
   `CHAL-YYYYMMDD-NNNN` format **breaches at 18 characters** (§2.2). This is a live non-compliance in the
   data, not a missing feature.
3. **The Rule 55 gap list is incomplete: consignee GSTIN is missing from the printed challan** even though
   `p2_clients.gstin` has existed since July 30 (§2.1). Cheapest item on the entire list.

**Additions not in the plan:**

- **§1.6 tooling** needs a register with periodic attestation, not merely a nulled deadline. `is_exempt_tooling`
  today makes exempt items *invisible*.
- **§3.1's legal chain** for a job worker's own record obligation (s.35(1), s.35(6), Rule 56(5)(c), 56(6),
  56(12)) — and the warning that **Rule 56(11) is the agency rule and does not apply to job workers.**
- **§6.1 check #12** — a `job_work_return` with no parent challan link cannot fill ITC-04 Table 5 columns
  2–3. This makes `parent_challan_id` a **prerequisite** for the Step 7 working paper, not a companion to
  it.
- **§1.5** — the Commissioner extension field needs a mandatory order reference, or it hides exposure.

# Appendix B — Open items for the CA (Step 0)

1. Confirm **s.122(1)** clause number and amount for failure to maintain books (§1.3(b)).
2. Confirm whether **Circular 38/12/2018-GST** stands as amended by **Circular 88/07/2019-GST**, and
   whether the amendment touches the challan-copy or endorsement paragraphs (§2.1).
3. Confirm that the **s.168A COVID extension** (Notifications 35/2020 as amended by 55/2020) reached the
   **s.143 return periods** — i.e. that s.143 is not within that notification's exclusions (§1.5).
4. Confirm the **process for a Commissioner extension** under the proviso to s.143(1) — is there a
   jurisdictional format, and has he ever seen one granted? (§1.5)
5. Confirm the **18% GST rate on SAC 9988** for mechanical/engineering job work post the September 2025
   rationalisation — carried forward from `kpml-network-plan.md` §10.3 and **not verified in this
   research**.
6. Confirm **current NIC / GSP e-way bill API eligibility**, if e-way bill generation is ever revisited
   (§6.3).
7. Ask the two questions already scheduled at `kpml-network-plan.md:477`, plus: *"How many hours does an
   ITC-04 working paper take you per client per period, and what do you ask the factory for?"* and
   *"If a client showed you this file, would you recommend the software? What would stop you?"*

# Appendix C — Sources

**Law and official**
- [CGST Rule 45 — inputs and capital goods sent to job worker (GSTZen)](https://gstzen.in/a/conditions-and-restrictions-in-respect-of-inputs-and-capital-goods-sent-to-the-job-worker-cgst-rule-45.html)
- [CGST Rule 55 — transportation of goods without issue of invoice (GSTZen)](https://gstzen.in/a/transportation-of-goods-without-issue-of-invoice-cgst-rule-55.html)
- [CGST Rule 56 — maintenance of accounts by registered persons (GSTZen)](https://gstzen.in/a/maintenance-of-accounts-by-registered-persons-cgst-rule-56.html)
- [CGST Rule 26 — method of authentication (GSTZen)](https://gstzen.in/a/method-of-authentication-cgst-rule-26.html)
- [CGST Rule 138 — e-way bill (GSTZen)](https://gstzen.in/a/information-to-be-furnished-prior-to-commencement-of-movement-of-goods-and-generation-of-e-way-bill-cgst-rule-138.html)
- [GSTN Manual — Form GST ITC-04](https://tutorial.gst.gov.in/userguide/inputtaxcredit/Manual_itc04.htm)
- [GSTN — preparing ITC-04 using the offline utility (user manual)](https://gstzen.in/a/gst-manuals-user-manuals-preparing-itc-04-using-offline-utility.html)
- [Circular No. 38/12/2018-GST, 26.03.2018 (CBIC)](https://cbic-gst.gov.in/pdf/circularno-38-cgst.pdf)
- [Maharashtra Notification No. 15E/2018-State Tax, 29.06.2018 (mahagst.gov.in)](https://mahagst.gov.in/en/notification-no15e2018-state-tax-no-requirement-e-way-bill-or-after-1st-july-2017-intra-state-0)
- [Notification No. 35/2020-Central Tax — s.168A COVID extensions (GST Gyaan)](https://gstgyaan.com/notification-no-35-2020-central-tax-dated-03-04-2020-extension-of-various-time-limit-due-to-covid-19)
- [Notification No. 55/2020-Central Tax — extension to 31.08.2020 (IRIS GST)](https://irisgst.com/notification-55-2020-hereby-amends-time-limit-from-june-to-august-of-notification-35-2020-gst-notification-55-2020/)
- [Section 143 CGST — job work with discipline (CAclubindia)](https://www.caclubindia.com/articles/-section-143-of-the-cgst-act-facilitating-job-work-with-discipline-54817.asp)
- [Notification No. 92/2020-Central Tax summary — Finance Act 2020 provisions from 01.01.2021 (Masters India)](https://www.mastersindia.co/blog/summary-of-notification-no-92-2020/)
- [ICAI Handbook on Job Work under GST](https://idtc-icai.s3.ap-southeast-1.amazonaws.com/download/pdf20/Handbook-on-Job-Work-under-GST.pdf)

**Case law**
- [From Job Work to Deemed Supply: how weak records trigger GST demand — analysis of Tvl. Technocast Foundry, 2026-VIL-582-MAD (CAclubindia)](https://www.caclubindia.com/articles/from-job-work-to-deemed-supply-how-weak-records-can-trigger-gst-demand-55750.asp)
- [No records to prove return of goods sent for job work, s.74 invoked — Madras HC (Taxscan)](https://www.taxscan.in/top-stories/no-records-to-prove-return-of-goods-sent-for-job-work-s-74-invoked-madras-hc-grants-30-days-for-reply-1448458)
- [Madras HC remands GST job work demand for verification of revenue neutrality (TaxGuru)](https://taxguru.in/goods-and-service-tax/madras-hc-remands-gst-job-work-demand-verification-revenue-neutrality.html)

**ITC-04 form structure and practice**
- [ITC-04 column headings and practitioner comments (KnowyourGST)](https://www.knowyourgst.com/blog/gst-form-itc-04-job-work-supplies-109/)
- [Analysis of Circular 38/12/2018 (TaxGuru)](https://taxguru.in/goods-and-service-tax/analysis-cbec-circular-no-38-12-2018-related-job-work.html)
- [Understanding GST Form ITC-04 (TaxGuru)](https://taxguru.in/goods-and-service-tax/gst-form-itc-04-goods-sent-job-worker.html)
- [Treatment of job work in GST and Form ITC-04 (TaxReply)](https://taxreply.com/gst/Treatment_of_Job_Work_in_GST_and_Form_ITC-04-680.html)
- [ITC-04 penalties under s.125 (Oxyzo)](https://www.oxyzo.in/blogs/itc-04-filing-process-benefit-exemption-and-penalties/74490)
- [ITC-04 filing waived for Jul 2017 – Mar 2019, Notification 38/2019 (TaxTMI)](https://www.taxtmi.com/article/detailed?id=8703)
- [Job work and ITC-04: a 2026 guide for Indian manufacturers (OEMUp)](https://www.oemup.app/blog/job-work-itc04)

**Documents and e-way bill**
- [Delivery challan format — GST-compliant template 2026 (AI Accountant)](https://www.aiaccountant.com/blog/delivery-challan-format)
- [No e-way bill in Maharashtra for intra-state supply below ₹1 lakh (Taxscan)](https://www.taxscan.in/e-way-bill-maharashtra-intra-state-supply-goods-rs-1-lakh/25286)
- [Maharashtra: no intra-state e-way bill up to ₹1 lakh from 1 July (TaxGuru)](https://taxguru.in/goods-and-service-tax/maharashtra-intra-state-eway-bill-upto-rs-1-lakh-1st-july.html)

**Market, competitors, pricing**
- [TallyPrime price list 2026 — Silver ₹22,500 / Gold ₹67,500 (Tally Support)](https://tallysupport.in/guides/tallyprime-price-list-2026.php)
- [Tally TSS renewal charges 2026 (Markit Solutions)](https://www.markitsolutions.in/services/tally-renewal)
- [Marg ERP customer reviews (Trustpilot)](https://www.trustpilot.com/review/margcompusoft.com)
- [MARG ERP 9+ reviews (Capterra)](https://www.capterra.com/p/151832/Erp-Software-9/reviews/)
- [Marg ERP 9+ reviews — pros and cons (Techjockey)](https://www.techjockey.com/reviews/margerp-9)
- [When Tally stops being enough (QuoteERP)](https://blog.quoteerp.com/when-tally-stops-being-enough)
- [Best manufacturing ERP for Indian MSMEs 2026 (ERPDrive)](https://erpdrive.in/best-manufacturing-erp-india.html)
- [Vyapar — manufacturing software for small business](https://vyaparapp.in/manufacturing)
- [India smartphone market size and share (IMARC Group)](https://www.imarcgroup.com/india-smartphone-market)
- [WhatsApp invoicing guide for Indian MSMEs 2026 (Tally Solutions)](https://tallysolutions.com/business-guides/whatsapp-invoicing-payments-india-2026/)
