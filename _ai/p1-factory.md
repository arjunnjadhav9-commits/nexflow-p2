---
name: p1-factory
description: Nexflow P1 Part 2 — the rest of the factory floor. Attendance and shifts, leave, payroll to the point of a liability statement, the asset and machine register, scrap and yield variance, the gate and visitor register, energy tracking, and the safety and compliance calendar. Complete schemas for 38 new tables, the P1↔P2 integration spec with exact column references, pricing that survives arithmetic, a 24-session build sequence with an 8-session MVP, and an honest account of the statutory rates that must be confirmed with a CA before a line of payroll code is written. Read in full, with factory-os.md, before building any of it.
sources: [founder-brief-sept-2026, CLAUDE.md, factory-os.md, nexflow-agent.md, nexflow-intelligence.md, business-strategy.md, enterprise-strategy.md, automation-strategy.md, kpml-network-plan.md, execution-plan.md, bridge-agent.md]
last_updated: 14 September 2026
status: design complete — not yet built. Living document: update in place as it is built.
---

# Nexflow — P1 Part 2: The Rest of the Factory Floor

> **`factory-os.md` is P1 Part 1. This is P1 Part 2. Together they are P1.**
> **P1 + P2 = Nexflow Factory OS, the complete product.**
>
> `nexflow-agent.md` replaces the inventory person. `factory-os.md` replaces the supervisor's
> paperwork. `nexflow-intelligence.md` replaces the consultant. **This document replaces the
> registers** — the muster roll, the wage sheet, the leave card, the gate book, the machine
> history card, the asset list, the meter diary and the fire-extinguisher tag.
>
> Every one of them is a bound paper book sitting in an MIDC factory office right now. Most are
> written up on the morning an inspector is expected. **One of them — the wage sheet — is the only
> record in the entire factory that somebody chases if it is late.**
>
> That last fact is the most important sentence in this document and §1.4 builds on it.

**Load order for any session building this. Read in this order, in full:**

1. `_ai/CLAUDE.md`
2. `_ai/factory-os.md` — **P1 Part 1, and this document is unbuildable without it.** `p2_workers`
   (§11.1), `p2_production_orders` (§11.2) and `p2_production_progress` (§11.4) are addressed here
   by name. **§0 C1 below amends F11 of that document**; read the amendment before reading F11, or
   you will find a `[NEVER]` that contradicts a shipped module.
3. `_ai/p1-factory.md` (this file)
4. `_ai/nexflow-agent.md` §3 (D1–D12) and §5 — every write surface here that a human can describe
   in a sentence is a `propose_*` tool on the existing protocol. It is not restated.
5. `_ai/nexflow-intelligence.md` §2 (I2, I4, I11) and §3 — §9 and §11.1 item 5 add aggregators to
   `_shared/intelligence.ts` and must obey its contract exactly.
6. `supabase/functions/filing-package/index.ts` — `fetchCoveringNoteData` and `processTenant`.
   §11.1 items 1, 2 and 4 add files to that zip.

`_ai/automation-strategy.md` §3.1 (A0) and §3.3 (`p2_job_queue`) are prerequisites for §10.4 and
§9.5. `_ai/execution-plan.md` §3 is the pricing table §13 extends. `_ai/business-strategy.md` §3 is
the cost baseline §13.3 does arithmetic on top of.

**Status: designed, not built.** Nothing named in §3–§12 exists in the codebase.
`grep -ril "attendance\|payroll\|p2_shifts\|p2_assets\|gate_log"` over the whole working tree
returns **zero matches** `[VERIFIED — 14 September 2026]`. Every codebase fact stated here was read
against the working tree on the same date and is marked `[VERIFIED]`.

**What this document is for.** A future Claude Code session must be able to build P1 Part 2 from
this file plus `factory-os.md` without asking a design question. Where a decision could not be made
from here — because it needs a real biometric device, a real payslip checked against a real wage
sheet, or a statutory rate only a practising CA can confirm — it is tagged `[UNVERIFIED]`, repeated
in §18, and given an exact procedure for resolving it.

**The one thing that must not be skipped.** §5.9 is a table of eleven statutory parameters. Every
one of them is a number a payroll depends on, several of them have been revised more than once, and
**this document is not a legal source.** Confirm the whole table with a practising CA, in writing,
before writing a line of payroll code. `[UNVERIFIED — §18 Q1]`

---

## Tag convention

Inherited from `factory-os.md`, `nexflow-agent.md` and `nexflow-intelligence.md`, unchanged.

| Tag | Meaning |
|---|---|
| `[DECIDED]` | Decided. Build it as written. Do not relitigate. |
| `[RECOMMENDED]` | This document's recommendation. Needs founder sign-off before build. |
| `[VERIFIED]` | Confirmed against the live working tree or a primary source, 14 Sept 2026. |
| `[UNVERIFIED]` | Needs a live check, a measurement, or a CA's confirmation before code is written. Repeated in §18. |
| `[CORRECTION]` | The brief that commissioned this document, or an existing Nexflow document, states something the codebase or the statute contradicts. Read the correction before planning around the older text. |
| `[NEVER]` | Permanently out of scope. |

---

## 0. Corrections to the brief — read these first

Ten. One resolves a direct contradiction with a `[NEVER]` in a sibling document, five are statutory
figures that are wrong in the direction that produces a wrong payslip, two change what can be built,
one changes the session count, and one is a naming collision that will produce tables no RLS policy
in this codebase can see.

**A session that plans from the brief without reading this section will ship a payroll that
under-deducts professional tax for every worker in Maharashtra, over-states employer PF for anyone
above the wage ceiling, pays overtime below the statutory floor, and creates a table called
`p1_attendance` that no tenant can read.**

### `[CORRECTION]` C0 — This is the whole of the brief that is right, and it is worth saying first

The eight modules are the right eight. The MVP guess in the brief — *"probably attendance + payroll"*
— is correct, and §14.2 reaches it independently from a different direction. The integration
directions are right. The instinct that scrap and yield variance belong next to production rather
than next to inventory is right, and §8.3 shows it is worth more than the brief claims because
`scrap_return` and ITC-04 Table 5B already exist `[VERIFIED]`.

Everything below is a correction to a detail. **None of it is a correction to the shape.**

### `[CORRECTION]` C1 — `factory-os.md` F11 forbids this document's second module by name. The conflict is real, and here is the exact boundary.

`factory-os.md` F11 is `[NEVER]` and is unambiguous `[VERIFIED]`:

> **F11 — Factory OS never computes pay.** *"No piece rate, no wage, no attendance, no payroll
> export, no per-worker earnings figure, and no column a payroll system could join to."*

§16 item 3 of that document repeats it (*"Pay, piece rates, wages, attendance, overtime
computation, or any per-worker earnings figure"*) and §10 item 9 repeats it again (*"Not manual —
**absent**"*). `enterprise-strategy.md` §8 item 3 refuses *"payroll, TDS/TCS computation and
returns"* as part of **"PVT LTD accounting that Tally already does."**

**This document builds attendance and payroll. Pretending otherwise would be dishonest, and
leaving F11 standing unamended would leave a future session with a `[NEVER]` that contradicts a
shipped module.** So: the conflict is named, F11's argument is separated into its two legs, and
each leg is answered separately.

**F11's leg 1 — the data-quality argument — is correct, and it is preserved in full.**

> *"The moment a worker's pay depends on the number they tap, the number stops describing
> production and starts describing pay. Every under-report becomes a dispute and every over-report
> becomes fraud … The measurement becomes the target and stops being a measurement."*

That argument is about **piece rates**: pay computed from `p2_production_progress.quantity_done`.
It is not an argument about time-based pay, and time-based pay does not touch it — a worker's tap on
`+10` changes nothing about what they are owed for the day.

**W1 makes that structural rather than a promise:** no foreign key, no join, no view, no report and
no code path connects `p2_production_progress`, `p2_production_assignments` or
`p2_quality_records` to any payroll table. **Piece rate remains `[NEVER]`** (§17 item 2), and §19.1
item 3 is a test that greps for it.

**F11's leg 2 — the liability argument — is a scope boundary, and the founder is now drawing it in
a different place.** F11 says wage computation *"carries statutory obligations … that Nexflow has
no business underwriting with a ₹35,000/month product."* The obligations it names — minimum wages,
overtime, records under the Payment of Wages Act — are obligations of **the employer**, and they
exist whether or not Nexflow computes anything. A factory running payroll in Excel carries all of
them today, less accurately.

**W2 draws the new line precisely, and it is narrower than "payroll":** Nexflow computes what each
worker is owed and what the employer owes each statute, and hands both over. It never files a
return, never generates an IRN-equivalent, never touches a portal credential, never computes TDS
under s.192, never issues a Form 16, and never moves money. That is the same boundary
`enterprise-strategy.md` §8 item 4 already draws for GST — *"Nexflow produces the file; the CA files
it"* — applied to a second statute, and it does not reopen item 3's actual concern, which was
competing with Tally for a PVT LTD's audited books.

**Required amendments to `factory-os.md`, in writing, in the session that builds §5.** These are
not optional and they are not this document's to make silently:

| Location | Current text | Amended to |
|---|---|---|
| `factory-os.md` F11 heading | *"Factory OS never computes pay. `[NEVER]`"* | *"Factory OS never computes pay **from production output**. `[NEVER]` — see `p1-factory.md` §0 C1 and W1"* |
| `factory-os.md` F11 body | *"no wage, no attendance, no payroll export"* | *"no piece rate and no per-worker earnings figure derived from production. Time-based payroll is `p1-factory.md` §5 and is firewalled from this data by W1."* |
| `factory-os.md` §16 item 3 | *"Pay, piece rates, wages, attendance, overtime computation…"* | *"Piece rates, and any per-worker earnings figure computed from a production, progress or quality row."* |
| `factory-os.md` §10 item 9 | *"Piece rates, wages, attendance `[NEVER]` … Not manual — **absent**."* | *"Piece rates `[NEVER]`. Attendance and time-based pay are `p1-factory.md` §3 and §5."* |
| `factory-os.md` §4.1 personal-data note | *"Name and phone, nothing else. No ID number…"* | Unchanged, and **reinforced** — see W6. Payroll identifiers live in a different table with a narrower policy and are never reachable from the worker token. |

**Do not delete F11. Narrow it.** The sentence that survives is the one worth keeping, and a future
session proposing piece rates must still find a `[NEVER]` with a reason attached.

### `[CORRECTION]` C2 — Overtime at *"1.5x or 2x — factory decides"* is not a choice a factory has

The Factories Act 1948, s.59: where a worker works more than nine hours in a day or forty-eight in a
week, they are entitled to wages at **twice the ordinary rate**. A factory cannot elect 1.5×; that
is below the statutory floor, and a Nexflow that computed it would be computing an underpayment with
an audit trail attached.

Three further constraints the brief omits and payroll must carry:

- **s.51 / s.54 / s.56**: 48 hours a week, 9 hours a day, and a spread-over of 10.5 hours including
  rest. Overtime is the excess over these, not over whatever the shift happens to be.
- **s.64 / s.65 quarterly cap**: total overtime in a quarter is capped. The base figure is 75
  hours; **Maharashtra has raised it by notification more than once** and the current figure must be
  confirmed `[UNVERIFIED — §18 Q1]`. Nexflow warns as a worker approaches the cap; it does not
  silently let a factory book 200 hours.
- **s.59(2)**: "ordinary rate of wages" is basic plus allowances, **excluding** overtime itself and
  bonus. The OT base is therefore a defined subset of the wage structure, not "salary ÷ hours" —
  which is why §5.3 defines wages component-by-component rather than as one number.

`[DECIDED]` The multiplier is a tenant policy field with a **statutory floor enforced in the
database**: `CHECK (overtime_multiplier >= 2.0)` on `p2_payroll_policies`, with the floor itself
read from `p2_statutory_rates` so it survives a change in the law. A factory that genuinely pays
more than 2× — some do, for Sundays — sets a higher number. A factory that wants 1.5× is refused,
by name, with the section cited.

### `[CORRECTION]` C3 — The Maharashtra professional tax slab in the brief is wrong, and the error compounds monthly

The brief states: *"Professional tax: Maharashtra slab (₹200/month for ₹10,001-15,000, ₹300/month
above ₹15,000)."*

**There is no ₹300 income slab.** Professional tax is capped at **₹2,500 per person per year** by
Article 276(2) of the Constitution — no state may levy more, at any income. Maharashtra reaches that
cap with ₹200 a month for eleven months and **₹300 in February only**. The ₹300 is an arithmetic
top-up to hit ₹2,500 in the last month of the financial year, not a higher band.

The structure, as last known `[UNVERIFIED — §18 Q1]`:

| Monthly salary | Male | Female |
|---|---|---|
| Up to ₹7,500 | Nil | Nil |
| ₹7,501 – ₹10,000 | ₹175 | Nil |
| ₹10,001 – ₹25,000 | ₹200/month, **₹300 in February** | Nil |
| Above ₹25,000 | ₹200/month, **₹300 in February** | ₹200/month, **₹300 in February** |

Three things follow:

- **The February top-up must be a rule, not a slab.** A slab table alone produces ₹2,400 a year and
  a short remittance for every worker, every year.
- **The female exemption threshold is a separate axis** and was raised materially in the 2023
  Maharashtra budget. A payroll that ignores gender over-deducts from every woman below the
  threshold, which is a recoverable error the worker will never notice and the factory will never
  refund.
- **There are two professional taxes.** The employee deduction sits under the employer's
  *Registration Certificate*; the employer's own ₹2,500/year sits under its *Enrolment Certificate*.
  They are separate liabilities with separate returns. Nexflow computes the first; the second is a
  flat annual line in the liability statement (§5.7).

### `[CORRECTION]` C4 — *"PF: 12% employee + 13.15% employer"* produces a wrong number for several common cases

13.15% decomposes as 12% + 0.50% EDLI + 0.65% administration. Every part of that carries a condition
the brief drops:

| Component | Rate | The condition the brief omits |
|---|---|---|
| Employee | 12% of PF wages | — |
| Employer → EPS | 8.33% | **Capped at ₹15,000 of wages — ₹1,250/month maximum.** Above the ceiling the whole 12% goes to EPF, not 3.67% |
| Employer → EPF | 3.67% | Absorbs whatever EPS does not take |
| EDLI | 0.50% | **Capped at ₹15,000 — ₹75/month maximum** |
| EPF administration | 0.65% | **Minimum ₹500/month per establishment, not per member.** For a small factory this floor binds and the charge stops being a percentage at all |
| EDLI administration | 0% | Waived. Do not carry a legacy 0.01% |

The administration rate has been revised more than once (1.10% → 0.85% → 0.65%) and **must be
confirmed** `[UNVERIFIED — §18 Q1]`. A single wrong digit here is wrong on every payslip until
somebody notices, and nobody notices an administration charge.

Two further points that decide schema rather than arithmetic:

- **"12% of basic salary" is not the statutory base.** Following *RPFC v. Vivekananda Vidyamandir*
  (Supreme Court, 2019), an allowance paid universally to all workers forms part of PF wages. A
  factory that splits ₹15,000 into ₹8,000 basic and ₹7,000 "special allowance" to shrink PF is
  exposed, and Nexflow must not encode that split as correct by assuming the PF base is a column
  called `basic`. **§5.3 makes the PF base a per-component flag** — a factory declares which of its
  own wage components count, and the default is *all of them*.
- **Applicability is 20 employees**, and the ₹15,000 ceiling makes coverage optional for higher-paid
  joiners who were never members. A factory below the threshold that voluntarily covers its workers
  is a real case. All three are policy fields, not constants.

### `[CORRECTION]` C5 — ESI's ₹21,000 ceiling is not a monthly test, and treating it as one breaks the return

The brief: *"ESI: 0.75% employee + 3.25% employer (only for workers earning ≤₹21,000/month)."*

The rates are right. **The eligibility test is not.** ESI runs on two fixed contribution periods —
**1 April to 30 September** and **1 October to 31 March**. A worker who is covered at the start of a
period stays covered **to the end of that period**, even if their wages rise above ₹21,000 in the
middle of it. A payroll that re-tests every month drops them in the month of the increase, and the
half-yearly return then fails to reconcile against contributions already remitted.

Two further conditions:

- **Workers whose average daily wage is at or below ₹176 are exempt from the employee share.** The
  employer still pays 3.25%. A payroll that deducts from them is deducting unlawfully from the
  lowest-paid people in the factory.
- **Applicability is 10 employees in most states**, and coverage is geographic — only in
  ESIC-implemented areas. An MIDC estate almost certainly is one, but it is a per-factory fact, not
  an assumption.

`[DECIDED]` ESI eligibility is computed **once per contribution period and frozen on the worker's
payroll record for that period**, in `p2_payroll_lines.esi_eligibility_basis`, with the wage that
decided it. That makes a disputed contribution six months later a lookup rather than a
reconstruction.

### `[CORRECTION]` C6 — Statutory bonus is not 8.33% of annual salary

The brief: *"Bonus tracking (statutory bonus: 8.33% of annual salary for eligible workers)."*

The Payment of Bonus Act 1965 has **two different wage ceilings and they are not the same number**:

- **Eligibility ceiling ₹21,000/month.** A worker earning more is not entitled at all under the Act.
- **Calculation ceiling ₹7,000/month, or the minimum wage for the scheduled employment, whichever
  is higher.** A worker on ₹18,000 who is eligible receives 8.33% of the *ceiling*, not of ₹18,000.

Two more:

- **8.33% is the minimum, 20% the maximum.** The actual percentage depends on the allocable surplus
  computed from the audited accounts — which Nexflow does not hold and will never hold.
- **Eligibility requires 30 working days in the accounting year**, and the establishment threshold
  is 20 employees.

`[DECIDED]` Nexflow computes and accrues the **minimum bonus liability** — 8.33% of the calculation
ceiling for every eligible worker — labels it *"minimum liability under the Act; the actual
percentage is computed by your CA from the allocable surplus"*, and lets the owner record the
declared percentage once the CA supplies it. It never asserts that 8.33% is the amount payable.

**Gratuity is not in this document at all.** The Payment of Gratuity Act 1972 creates a real,
larger, actuarially-shaped liability that a factory should be provisioning for, and it is §17 item
9 `[NEVER]` — it requires an actuarial valuation for the accounts, which is a different profession.
The asset register tracks insurance; it does not track employee benefit obligations.

### `[CORRECTION]` C7 — A 100 m GPS geofence will reject workers who are standing inside the factory

The brief specifies *"only valid within 100m of factory GPS coordinates."*

Inside a steel-clad MIDC shed, GNSS is usually unavailable. Android falls back to network and Wi-Fi
positioning, and `GeolocationPosition.coords.accuracy` on a ₹8,000 handset indoors routinely reports
**500 m to 2 km**. A hard 100 m radius therefore fails the honest worker standing at their own
machine, and it does nothing at all to the dishonest one — **mock location is a developer-options
toggle on every Android**, and `coords` carries no attestation of any kind.

`[DECIDED]` Geo-QR is redesigned around what the mechanism can actually deliver:

1. **The rotating code is the primary control, not the geofence.** A server-generated code with a
   short TTL, displayed on a screen at the gate. §3.6 sets the window.
2. **The geofence carries an accuracy budget.** A reading whose own reported `accuracy` exceeds the
   radius is not evidence of anything and is treated as *"location unavailable"*, not as
   *"outside"*. Records it, does not reject on it.
3. **It records and flags; it does not hard-block.** A punch outside the radius, or with unusable
   accuracy, is accepted with `geo_status` set and lands on the supervisor's exception list for the
   day. A worker refused entry to their own attendance by a satellite is a worker who stops using
   the system in week one.
4. **It is described honestly in the sales conversation as a deterrent**, because that is what it
   is. §15.1.

### `[CORRECTION]` C8 — The four attendance input methods are three integrations, and that changes the session count

The brief lists four methods as if they were four builds. They are not:

- **eSSL, BioMax and most Realtime devices are ZKTeco-lineage hardware** and speak the same
  push/ADMS protocol: the device POSTs attendance records over plain HTTP to a server address
  configured on the device itself. One endpoint receives all of them.
- **RFID on those same devices is a *verify mode* on the same punch record**, not a separate
  system. A ZK-family device configured for card-only produces a punch row identical in shape to a
  fingerprint punch, with `verify_mode = 'card'`. **It is the same integration.**
- Matrix COSEC is the common exception — a genuine REST API, a different shape, and materially more
  expensive hardware than an MIDC unit typically buys. It is `[RECOMMENDED: defer]` until a client
  has one.

So the real build is **three paths**: one device webhook (§3.5, covering fingerprint, card and face
on ZK-family hardware), one geo-QR path (§3.6), one supervisor path (§3.4). The RFID *option*
becomes a hardware recommendation and a `verify_mode` value rather than a session.

**And the supervisor path is the one that must always work**, because it is the only one that needs
no hardware, no smartphone, no internet at the gate and no enrolment. W8.

### `[CORRECTION]` C9 — "P1" already means something else in this repository, and every new table is still `p2_`

Two naming hazards, both of which produce broken code rather than confusion:

- **`_ai/product-polish-p1.md` exists, and `execution-plan.md` §4 item 9 is "P1 — Product polish"**
  `[VERIFIED]`. That "P1" is a UI polish session and has nothing to do with this document. A session
  told to "do P1" must be told which one.
- **Every table in this document carries the `p2_` prefix.** `CLAUDE.md`'s convention is absolute
  and is not a phase marker — it is the prefix the entire RLS, tenancy and export surface is built
  around. `js/full-export.js` enumerates `p2_*` tables `[VERIFIED — Session 13]`; `get_my_tenant_id()`
  policies are written against `p2_*`; the regression harness snapshots `p2_*`. **A table called
  `p1_attendance_days` would have no policy, no export row, no snapshot coverage and no tenant
  isolation.** There is no `p1_` prefix and there will not be one.

### `[CORRECTION]` C10 — Four documents now widen the same three CHECK constraints, and the last to land silently drops the others

`p2_notifications.type` is widened by `factory-os.md` §11.8 (adding `daily_production_report`,
`production_delay`, `quality_alert`, `work_assigned`), by `nexflow-intelligence.md` §9.4 (adding
`intelligence_alert`, `intelligence_digest`) and by this document (§12.12). The same applies to
`p2_ops_alerts.source` and `p2_agent_proposals.kind`.

Each is written as a `DROP CONSTRAINT` / `ADD CONSTRAINT` pair. **Whichever lands last wins, and it
wins by deleting the others' values.** The failure is invisible: `js/notifications.js` inserts
fire-and-forget and swallows its own errors `[VERIFIED]`, so the first symptom is a notification type
that silently stops being delivered.

`[DECIDED]` **Before writing any of the three statements, read the live definition:**

```sql
SELECT conname, pg_get_constraintdef(oid)
  FROM pg_constraint
 WHERE conname IN ('p2_notifications_type_check',
                   'p2_ops_alerts_source_check',
                   'p2_agent_proposals_kind_check');
```

Include every value already present, then add yours. §19.5 item 45 asserts the full set.
`nexflow-intelligence.md` §9.4 already carries this warning for two documents; this is the third and
fourth.

---
## 1. Executive Summary

### 1.1 What it is

**Eight registers, thirty-eight tables, and one number a worker will come and ask for.**

`factory-os.md` gave the factory four nouns — an order, an assignment, a progress entry, a quality
record. This document gives it the rest of what a factory writes down:

```
  WHO WAS HERE            shift -> punch -> day -> leave            §3, §4
  WHAT THEY ARE OWED      wage structure -> run -> payslip          §5
                          -> employer liability statement -> CA
  WHAT WE OWN             asset -> insurance -> depreciation        §6
                          -> custodian -> physical verification
  WHAT IT RUNS ON         machine -> service due -> breakdown       §7
                          -> downtime -> hours against an order
  WHAT WE WASTED          issued vs output vs scrap vs unexplained  §8
                          -> scrap sale, or scrap return to KPML
  WHAT IT CONSUMED        meter -> reading -> bill -> per unit      §9
  WHO CAME THROUGH        vehicle · visitor · gate pass             §10
  WHAT EXPIRES            licence · consent · policy · extinguisher §10
```

Every one of them is a paper register today. Four of them — the muster roll, the wage sheet, the
leave card and the accident register — are **statutory** registers under the Factories Act, which
means an inspector is entitled to ask for them and a factory that cannot produce them has a problem
that is not a software problem.

### 1.2 Why this is a different product from Part 1, commercially

`factory-os.md` §1.2 argues that production orders are bought by **the person who runs the
factory**, where inventory is bought by the person who keeps records. That is right, and it holds.

**This module is bought by neither. It is bought because a worker is standing in the office on the
5th of the month asking why their wages are short.** Nobody buys a muster roll for insight. They buy
it because the alternative is a dispute they cannot win, a PF inspection they cannot answer, and two
days of somebody's month spent in Excel.

That makes P1 Part 2 the least glamorous and most *renewable* thing in the product set. Nobody
cancels payroll.

It also makes it the module with the **shortest path to a reputation event**, and that cuts the
other way: `business-strategy.md` §4.3 names a market-wide reputation event as the one thing that
can kill this business, and *"Nexflow calculated my workers' wages wrong"* travels through an MIDC
estate faster than any other sentence available. §15 and §19 exist because of that asymmetry, and
§14.7's parallel-run month is not optional.

### 1.3 What it costs

| | |
|---|---|
| Compute — attendance punch, device or supervisor | **₹0.00** — no model in the path (W5) |
| Compute — a full payroll run, 40 workers | **₹0.00** — arithmetic, in Postgres |
| Compute — the monthly payroll exceptions note, Opus over bounded counts | **₹4.95** |
| Compute — added sections on the existing daily report | **₹0.12/day ≈ ₹3.16/month** |
| **Compute, per tenant per month, everything in this document** | **≈ ₹8** |
| Compute, 100 tenants, per month | **≈ ₹800** |
| Storage — attendance punches, 40 workers | ~2,100 rows/month. **The first table in this schema whose row count grows with headcount × days** (§13.4) |
| Build — MVP: attendance + payroll a factory can actually run | **8 sessions**, ≈11.5 session-units (§14.2) |
| Build — everything in this document | **24 sessions**, ≈32 session-units — **five times Part 1** (§14.1) |
| Founder hours per client, year 1, honest estimate | **12–20** `[UNVERIFIED — §18 Q4]` — roughly double Factory OS Part 1, and **this, not compute, is the whole cost** |

**The compute number is not a rounding error being smuggled in — it is the correct answer, and it is
boring for a reason.** `nexflow-agent.md` §9.5 found the one place in the product where AI stops
being free, and it found it on volume: fifty model calls a day. This module makes **one model call a
month** and a few sentences on a report that already runs. Payroll is arithmetic over a rate table.
There is nothing here for a language model to do and giving it something to do would be a defect.

### 1.4 Payroll is the first module in Nexflow with a forcing function stronger than the filing deadline

Three sibling documents independently identify the same structural weakness and none of them can
fix it:

- `nexflow-agent.md` §14.3: *"nothing forces a physical count … the strongest catch is the one most
  likely never to run."*
- `factory-os.md` §13.7: *"Every financial error in this product has a monthly forcing function …
  **Production has none.**"*
- `nexflow-intelligence.md` §12.8: an incomplete ledger produces *"a confident, specific,
  well-evidenced wrong answer"*, and the only defence is a completeness signal.

**Attendance has a forcing function, and it is the strongest one available anywhere in a factory: a
person who was not paid comes and asks.** Not at month end, not at filing time — the same week, in
person, about a specific day they remember working. That is a reconciliation with a human attached,
running every month, at zero cost to Nexflow, initiated by the party with the strongest possible
incentive to get it right.

Three consequences, and they reorder the roadmap:

1. **Attendance data will be the highest-quality data in the system**, by a distance, because it is
   the only dataset with an adversarial auditor who checks it for free.
2. **It is therefore the right foundation for everything that needs a denominator** — energy per
   worked day, machine hours against a shift, output per worked hour. Not per calendar day, which is
   what every other module has had to fall back to (`nexflow-intelligence.md` §3.2's
   `nx_working_day_rate` derives a working-day pattern from transaction activity precisely because
   no attendance record existed. **Once §3 ships, that helper should read attendance instead** —
   §11.1 item 6).
3. **It makes `factory-os.md` §5.6's delay projection materially better.** "No progress for two
   working days" currently cannot distinguish *the worker was absent* from *the worker did not tap
   the button*. With attendance, it can, and that is the difference between a useful flag and a
   noisy one.

**The counterweight, stated in the same breath:** the same forcing function means an error here is
noticed immediately and personally, by the person least able to absorb it. There is no quiet period
in which to find a payroll bug.

### 1.5 The non-negotiable properties

Six. The first three are inherited and outrank everything in this document.

1. **No ledger write executes without an explicit human confirmation of a specific, server-computed
   plan.** `nexflow-agent.md` §1.4. A payroll run is a plan until a human finalises it, and
   finalisation is the confirmation (W4). An attendance punch is not a ledger write and does not
   need one (W5) — the same distinction `factory-os.md` F5 draws for a progress tap, for the same
   reason.
2. **No aggregate spanning owners reaches a principal, and no worker identity crosses a tenant
   boundary in any form.** `kpml-network-plan.md` §10.5, `factory-os.md` F10. **This document adds
   the sharpest version of that rule anywhere in the product set: a principal never learns anything
   about a vendor's people** — not a headcount, not a shift pattern, not an attendance rate, not a
   wage figure, not a training record. §11.4.
3. **Every number is computed by deterministic code before a model sees it.**
   `nexflow-intelligence.md` I2. In this module the rule is nearly free, because almost nothing here
   is narrated at all.
4. **Pay is computed from time. It is never computed from output.** W1, and it is the structural
   preservation of `factory-os.md` F11. §19.1 item 3 tests it.
5. **A worker token reveals work, never money.** W6. `factory-os.md` §4.4 already concedes that a
   worker's link leaks through a forwarded WhatsApp message; a leaked work list is one person's
   queue, and a leaked payslip is a different order of harm.
6. **Nexflow computes the liability and hands it over. It never files, never pays, and never holds
   a credential that could do either.** W2.

---

## 2. Architecture Decisions

### W1 — Pay is computed from time. It is never computed from output. `[DECIDED]` — keystone decision

§0 C1 is the problem. This is the resolution, and it is structural rather than a rule somebody has
to remember.

**No foreign key, no join, no view, no report, no RPC and no Edge Function code path connects any
of these:**

```
  p2_production_progress        p2_production_assignments        p2_quality_records
  p2_production_orders          v_p2_production_order_status
```

**…to any of these:**

```
  p2_wage_structures    p2_payroll_runs    p2_payroll_lines    p2_worker_advances
  p2_statutory_rates    p2_payroll_policies
```

The only table both halves may touch is `p2_workers` — a person, which is legitimately the subject
of both an assignment and a wage.

**Three things this forbids by name**, all of which will be proposed:

- **Piece rate.** Pay per unit produced. `[NEVER]`, §17 item 2.
- **Production-linked incentive or bonus.** A "productivity allowance" computed from
  `quantity_done` is a piece rate with a different label.
- **An attendance record derived from a progress entry.** *"Ramesh tapped +5 at 10am, so he was
  present"* is attractive, cheap, and it silently makes presence a function of reporting. A worker
  who does not tap becomes absent; a worker who wants a paid day taps. **The tap is not evidence of
  attendance and must never be treated as any.**

**What is permitted, and it is the escape valve that makes the rule survivable:** an owner may look
at both halves side by side, in a report, with the numbers labelled and no arithmetic joining them.
*"Ramesh worked 24 days and produced 310 units"* is two facts on one page. *"Ramesh earned ₹4.20 per
unit"* is the forbidden thing. The distinction is whether a number in one half determines a number
in the other.

**The test is a grep, and it runs in CI if there ever is one.** §19.1 item 3: the payroll module's
source contains zero occurrences of the five production table names, and
`information_schema.table_constraints` contains no FK between the two sets.

### W2 — Nexflow computes the liability and hands it over. It never files, never pays, never holds a credential. `[DECIDED]`

The line, stated exactly, because *"we do payroll"* is the kind of sentence that grows.

| In scope | Out of scope, permanently |
|---|---|
| Gross-to-net per worker, per period | Filing the EPF ECR, the ESI return, or the PT return |
| Statutory deduction computation (PF, ESI, PT, LWF) | Uploading anything to EPFO, ESIC or the Maharashtra PT portal |
| Employer contribution computation | Holding an EPFO, ESIC or PT portal credential, DSC or OTP |
| A per-statute liability statement with due dates | Making a payment, generating a bank file, or initiating a transfer |
| Payslip generation | TDS under s.192, investment declarations, Form 12BB, Form 16, Form 24Q |
| Minimum statutory bonus accrual | The actual bonus percentage from allocable surplus |
| A payroll register the CA imports | Posting a salary journal into Tally or anywhere else |
| Leave encashment computation on exit | Gratuity valuation, superannuation, actuarial anything |

**Why this line and not a different one.** It is the same boundary `enterprise-strategy.md` §8 item
4 already draws for GST, and the reasoning transfers exactly: *"Nexflow produces the file; the CA
files it — and the offline tool's validation step, which the CA runs, is the control that catches
Nexflow's own errors. Removing that step to 'help' would remove the safety net."* The EPFO ECR upload
validates the same way. The CA is not an inconvenience in the loop; the CA **is** the loop's error
detection.

`[RECOMMENDED]` **A draft ECR text file is in scope by the same analogy, and is not in the MVP.**
Generating the file the CA uploads is the GST precedent exactly. But the ECR format is strict and
version-dependent, a malformed one wastes the CA's afternoon rather than failing safely, and nothing
about it is needed to prove the module works. Session 16 at the earliest, gated on a CA confirming
the current format against a real upload. `[UNVERIFIED — §18 Q2]`

**`[NEVER]`, and this one will be asked for within a month of the first client going live:** a
"pay now" button, a bank payment file, or an integration with any payment rail. Nexflow does not move
money and `automation-strategy.md` §4.5's Razorpay deferral is about receiving it, not sending it.
The moment Nexflow can cause a salary to be paid, a Nexflow bug is a salary that was not.

### W3 — Every statutory rate is an effective-dated row, global rather than tenant-scoped, and every payroll run pins the version it used. `[DECIDED]`

This is the single most important engineering decision in §5, and it is not about flexibility.

Of the eleven parameters in §5.9, **at least four have been revised in the last decade**: the EPF
administration charge twice, ESI's rates in 2019, the bonus ceilings in 2015, and the Maharashtra PT
women's threshold in 2023. A rate hardcoded in TypeScript is a wrong payslip for **every client
simultaneously** on the day it changes, and it is wrong silently — nobody reads an administration
charge.

Three parts, and all three are required:

1. **`p2_statutory_rates` is global.** No `tenant_id`. One row set, seeded and maintained by the
   founder, read by every tenant. A statutory rate is not a tenant's business decision and giving
   each tenant a copy guarantees that ninety-nine of a hundred are stale.
2. **`p2_payroll_policies` is tenant-scoped and holds only what is genuinely the factory's choice** —
   the overtime multiplier above the statutory floor, whether PF is restricted to the ₹15,000
   ceiling, the wage-days basis, the pay period start day, rounding, leave entitlements above the
   statutory minimum. **Two tables, two owners, and the boundary between them is "would a different
   factory legitimately answer this differently?"**
3. **A payroll run pins `rate_set_version`.** The run stores the identifier of the rate set it read,
   and `p2_payroll_lines` freezes every applied rate and every computed component. **A payslip issued
   in April must reproduce byte-identically in October after a rate change**, because a worker
   querying a six-month-old deduction is the normal case and "we've since updated the rates" is not
   an answer.

That is the same frozen-snapshot discipline as `p2_invoices.items`, `p2_agent_proposals.confirm_text`
and `p2_intelligence_reports.html` `[VERIFIED]` — and here it is load-bearing for a different
reason: this snapshot is the evidence in a wage dispute.

### W4 — A finalised payroll run is immutable and it locks the attendance it consumed. Corrections are arrears in the next run. `[DECIDED]`

```
  draft  ->  computed  ->  approved  ->  finalised          (no path back)
                                             |
                                             +-> locks p2_attendance_days for the period
                                             +-> locks p2_leave_ledger rows consumed
                                             +-> freezes every rate and component on every line
```

**Once finalised, an attendance edit for that period cannot change a payslip that was already handed
to a worker and paid.** It is refused, by name, with the run number: *"March is finalised. Record
this as an arrear on April's run."*

**Why this and not a recompute.** A recompute is attractive and it is how a naive payroll gets
built. It fails the moment cash has moved: the factory paid ₹18,400 on the 5th, a supervisor fixes an
attendance row on the 9th, and the system now says ₹18,900 was owed for a month that is closed —
with no record of the ₹500 gap, no arrear line, and a payslip that no longer matches the money. Real
payroll works in arrears for exactly this reason and every accounting system that has tried to be
cleverer has produced a set of books that does not tie.

**Arrears are a first-class line type**, not a note: `p2_payroll_lines.line_type = 'arrear'` with
`arrear_for_period` naming the month it corrects. A CA reading April's register sees ₹500 of March
arrears as a separate, traceable figure.

**`approved` exists as a separate state from `finalised`** so that a run can be reviewed and
rejected without burning anything. `finalised` is the irreversible act and it is the confirmation
`nexflow-agent.md` §1.4 requires — one human, one explicit act, on a specific server-computed plan
they can see in full.

### W5 — Attendance is two layers: a punch is a fact, a day is a decision. `[DECIDED]`

```
  p2_attendance_punches     append-only. Raw events. Never edited, never deleted.
        |                   A device said this. A phone said this. Nobody judged it.
        v
  p2_attendance_days        one row per (worker, date). The DECIDED status.
                            present / absent / half_day / leave / holiday / weekly_off
                            carries source, decided_by, and an audit trail of changes
                            LOCKED once a payroll run covering that date is finalised
```

**A day's status is not derivable from punches and pretending otherwise is the defect that makes
biometric attendance hated in every factory that has it.** A worker punches in and forgets to punch
out. A card fails. A device is down for an hour. A worker works a genuine double shift. Somebody
comes in on a Sunday to finish a batch. Every one of those is a normal Tuesday, and every one of
them requires a person to decide what the day was.

So the punches are the evidence, the day is the finding, and **the system's job is to propose the
day and make the exceptions cheap to resolve** — not to pretend the evidence is the finding.

Three rules that follow:

- **A day row always exists for every active worker for every date in an open period**, defaulted
  from the shift calendar. A missing row is ambiguous between "absent" and "nobody looked"; an
  explicit `absent` is not.
- **A correction to a day writes an audit row**, never an in-place overwrite with no trace.
  `p2_attendance_day_changes` carries who, when, from, to and why — because this is the record a
  worker disputes, and "the supervisor changed it" is the answer they are owed.
- **Punches are never edited.** A punch recorded by a device with a wrong clock stays in the ledger
  with its skew flagged, and the *day* is corrected. Same discipline as `p2_stock_transactions`.

### W6 — A worker token reveals work. It never reveals money. `[DECIDED]`

`factory-os.md` §4.4 argues carefully for the per-worker `access_token` on `work.html`, and concedes
the residual honestly: *"the token lives in a URL, the URL lives in a WhatsApp thread, and a
forwarded message is a real leak of that worker's queue. The exposure is one person's work list."*

**A wage figure is not one person's work list.** It is the single most socially consequential number
in a factory — workers do not discuss it, owners do not publish it, and a leaked wage sheet causes
disputes between people who now know what each other earn. The same token cannot carry both.

`[DECIDED]` **Three separations, all structural:**

1. **Payroll identity lives in `p2_worker_payroll_identity`, a separate 1:1 table** — UAN, ESIC IP
   number, PAN, bank account, date of birth, gender. **RLS restricted to owner and accountant only**,
   narrower than `p2_workers` itself. This preserves `factory-os.md` §4.1's minimal-data decision
   exactly: `p2_workers` still holds only a name and a phone, and the identifiers a payroll needs sit
   somewhere a leaked work token cannot reach.
2. **`work-view` — the unauthenticated token Edge Function — never selects from any payroll table.**
   Asserted by §19.6 item 46 on the function's own source, not on its output.
3. **A payslip requires a second factor.** Opening a payslip inside `work.html` asks for the
   worker's date of birth in `DDMM` form, checked server-side against
   `p2_worker_payroll_identity.date_of_birth`, rate-limited, with a lockout. It is weak
   authentication and it is not pretending to be strong — it is the difference between *a forwarded
   link exposes a wage* and *a forwarded link exposes a wage to someone who also knows the worker's
   birthday*. For the majority of workers, whose birthday is known to their colleagues, the honest
   answer is that this is a speed bump; §15.4 says so rather than claiming otherwise, and the
   recommended default is that **payslips are handed over on paper** and the link is opt-in per
   tenant.

**WhatsApp delivery of payslips is `[NEVER]` in v1**, and not for a design reason: the WhatsApp
Business API is blocked on incorporation (`automation-strategy.md` §5, `factory-os.md` §4.5
`[VERIFIED]`). The brief's *"worker can scan QR to receive on WhatsApp"* becomes, in v1, the owner
sharing a link from their own phone via the Web Share API — the identical mechanism `challan.html`
already uses `[VERIFIED]` — and it inherits every caveat above.

### W7 — Leave balance is a ledger. Entitlement is derived from attendance, never typed. `[DECIDED]`

`SUM(p2_leave_ledger)`, exactly as `v_p2_stock_balance`, `v_p2_wip_balance` and
`v_p2_supplier_advance_balance` already work `[VERIFIED]`. Four row kinds — `accrual`, `consumption`,
`lapse`, `encashment` — and a balance that is never stored.

**The part that is not a convention:** earned leave under Factories Act s.79 is **computed from the
attendance ledger**, not entered by a person. One day for every twenty days worked by an adult,
available in the following calendar year, subject to having worked 240 days in the preceding one,
carried forward to a cap.

That means:

- **§4 cannot be built before §3.** Leave entitlement is a function of days worked and there is no
  other source for it.
- **The annual accrual is an explicit RPC run in January, not a trigger.** A trigger firing on every
  attendance row recomputes an annual entitlement 8,000 times a year and gets it wrong at the
  boundary. One dated, auditable, re-runnable job.
- **Casual and sick leave are policy, not statute, for a factory.** The Factories Act creates the
  earned-leave entitlement; CL and SL in an MIDC factory come from standing orders or from custom.
  Nexflow must not present them as statutory, and `p2_leave_types.statutory_basis` records which is
  which so the leave card can say so. (The Maharashtra Shops and Establishments Act 2017 does create
  casual leave — but it governs shops and commercial establishments, **not factories**, and applying
  it to a factory is a category error. `[UNVERIFIED — §18 Q1]`, confirm which Act each client is
  actually under; a unit can be under both for different premises.)

### W8 — Four input methods are three integrations, and the supervisor path is the one that must always work. `[DECIDED]`

§0 C8 collapses fingerprint and RFID into one device webhook. This decision is about what happens
when all the clever paths fail.

**The supervisor path is not the fallback. It is the default, and the others are upgrades.**

`factory-os.md` §4.1 reaches the same conclusion for progress reporting — *"a worker with no phone is
the majority case in year one, and the design must not degrade for them"* — and attendance is worse,
because attendance must be complete. A production entry that is missing is a gap in a report; **an
attendance row that is missing is a worker who does not get paid.**

So:

| Path | Needs | Fails when | Degrades to |
|---|---|---|---|
| Device (fingerprint / card / face) | ₹8–15k device, mains power, internet at the gate | power cut, device down, wet or worn fingerprint, internet out | supervisor |
| Geo-QR | worker smartphone, a display at the gate, a usable GPS fix | no smartphone, indoor GPS, shared handset | supervisor |
| RFID | reader + cards, and a card the worker actually carries | card left at home, card lent to a colleague | supervisor |
| **Supervisor marks** | **a phone, or a browser, or nothing but the next morning** | — | **it is the floor** |

`[DECIDED]` **Ship the supervisor path first, in session 2, and make it complete** — a single screen
listing today's rostered workers with present defaulted, one tap per exception, one save. Everything
else in §3 writes into the same two tables and changes only *who decided*. A factory can run payroll
on day one with no hardware at all, and that is what makes the 8-session MVP real rather than
aspirational.

### W9 — One asset master. A machine is an asset with an operational extension, never a second row. `[DECIDED]`

The brief specifies a machine register (module 3) and an asset register (module 6) as separate
things. **A CNC machine is one physical object and it belongs in both**, which is the classic
duplicate-master problem this codebase has already paid for once — `nexflow-agent.md` §11 item 3:
*"a material created from a misheard name is a permanent duplicate ledger … two spellings of copper
wire is two stock balances, both wrong, forever."*

`[DECIDED]` **`p2_assets` is the single master.** `asset_category` includes `machinery`, and the
machine-specific operational columns (`location_on_floor`, `rated_kw`, `is_production_machine`) are
nullable columns on it. The three child tables key on `asset_id`:

```
  p2_assets  (the master — every moveable and fixed asset, machines included)
      |
      +-- p2_asset_maintenance_schedules   preventive rules: every X days OR X run-hours
      +-- p2_asset_events                  service, breakdown, inspection, calibration
      +-- p2_asset_runtime                 hours run per day, optionally per production order
      +-- p2_asset_assignments             which department or person holds it, over time
      +-- p2_asset_verifications           the annual physical count
```

**`p2_asset_events` is one table with an `event_type`, not separate maintenance and breakdown
tables.** A service and a breakdown record the same six facts — date, what was done, downtime,
cost, vendor, parts — and the only difference is whether it was planned. Two tables would mean two
places to query for a machine's history and two chances for a cost total to disagree with itself.

**The one thing this deliberately does not unify: safety equipment.** A ₹1,500 fire extinguisher is
technically an asset and nobody depreciates one individually, but it carries a monthly inspection
obligation and a refill date that no other asset has. §10.5 keeps `p2_safety_equipment` separate,
with a nullable `asset_id` for the rare item that is genuinely both (a fire tender, a gas detection
system).

### W10 — Depreciation is computed and handed over. It is never posted, and Tally's figure wins. `[DECIDED]`

`enterprise-strategy.md` §8 item 3 refuses *"depreciation and fixed-asset registers"* as Tally's job,
and the refusal is correct for the reason it gives: competing there means asking a PVT LTD to
migrate its audited books.

**But the two registers answer different questions and only one of them is in Tally.**

| Nexflow's asset register | Tally's fixed asset register |
|---|---|
| Where is it, physically, on the floor | Cost, accumulated depreciation, WDV |
| Who is it assigned to | The block it sits in |
| When was it last serviced, when is it due | — |
| When does its insurance expire | — |
| When was it last physically verified, by whom | — |
| Serial number, model, supplier, warranty | — |
| **Hours run, downtime, breakdown history** | — |

Nexflow computes depreciation because the rows are already there and the CA needs the schedule — not
because it is an accounting system. `[DECIDED]` **Three rules:**

1. **Two schedules, both labelled, never merged.** Income Tax (s.32 / Rule 5 Appendix I — WDV on
   blocks of assets) and, only for a company, Companies Act 2013 Schedule II (useful lives, SLM or
   WDV). These are different regimes with different answers and a factory legitimately needs both.
   The brief's *"straight-line or WDV — factory decides"* is under-specified: **the method is
   determined by the regime, not by preference.**
2. **Nothing is posted.** No journal, no Tally voucher, no `p2_*` financial row. The Bridge Agent
   (`bridge-agent.md`) syncs invoices and GRNs and **must not** be extended to depreciation.
3. **Tally's figure is authoritative on any disagreement**, and the report says so on its face.
   Nexflow's schedule is an input to the CA's computation, not a competing answer.

**`p2_tenant_settings` has no entity-type column today** `[VERIFIED]`, and Schedule II applies only
to companies. §12.11 adds `entity_type text CHECK IN ('proprietorship','partnership','llp','private_limited','public_limited')`,
defaulting to `proprietorship` — which is right for every live tenant today and wrong for KPML.

### W11 — A meter reading is a fact. A cost per unit is a labelled estimate with its method recorded. `[DECIDED]`

**An electricity bill is not units × rate**, and a module that assumes it is will produce a cost per
motor that is wrong by 20–40% and confidently specific. An MSEDCL industrial bill carries, at
minimum: energy charges by kWh, **demand charges by contracted or recorded kVA**, time-of-day
differentials, a power-factor incentive or penalty, electricity duty, fuel adjustment, and wheeling.
Demand charges alone are a fixed monthly cost that has nothing to do with how many units were made.

`[DECIDED]` **Three separations:**

1. **`p2_meter_readings` holds readings. `p2_utility_bills` holds money.** They are reconciled and
   the gap is reported, never silently closed. Metered units will not equal billed units — different
   read dates, sub-meters that do not sum to the main, a DG set that produces units no bill mentions.
2. **Cost per unit produced carries its apportionment method on every figure**, ranked:
   `sub_meter` (measured, exact) > `machine_runtime` (runtime × rated kW, good) > `output_prorata`
   (crude, and labelled crude). `nexflow-intelligence.md` I2's rule — deterministic code computes,
   the model narrates — applies, and the *method* is part of the number, not a footnote.
3. **The anomaly threshold is self-referential**, per the standing rule `nexflow-agent.md` §6.5
   states and this codebase applies everywhere: the norm is this factory's own trailing history for
   comparable days, never a hardcoded 3×. §9.5.

### W12 — Nexflow records that a certificate expires. It never says a factory is compliant. `[DECIDED]`

The brief asks for a *"factory license and compliance document tracker."* One step from that is a
green tick that says COMPLIANT, and that step must not be taken.

`nexflow-intelligence.md` §12.4 draws the identical line for observations and its table transfers
directly:

| Nexflow may say | Nexflow may not say |
|---|---|
| *"Consent to Operate expires in 34 days."* | *"Your MPCB compliance is in order."* |
| *"No fire-extinguisher inspection is recorded since 11 March."* | *"You are compliant with s.38."* |
| *"3 of 14 extinguishers have no refill date recorded."* | *"Your fire safety is adequate."* |
| *"The factory licence on record expires 31 December 2026."* | *"Your factory licence is valid."* |

The right-hand column is a professional's conclusion drawn from a physical inspection Nexflow did
not perform, about a statute Nexflow does not interpret. **Nexflow tracks dates.** The disclaimer is
a code constant on every compliance surface, never model-authored, exactly as
`nexflow-intelligence.md` §7.4 requires.

### W13 — Every module defaults off, independently. `[DECIDED]`

Not one `factory_floor_enabled` flag but one per module, all `NOT NULL DEFAULT false`, including on
existing tenants the day the migration runs.

The same posture as `agent_write_enabled`, `factory_os_enabled`, `intelligence_enabled`,
`is_job_worker`, `separate_pool_deduction` and `quality_gate_enabled` `[VERIFIED]`, and here the
per-module granularity is not fussiness: **a factory will take attendance and payroll and want
nothing to do with a visitor register**, and a product that makes them turn on eight things to get
two is a product with six unused screens in the navigation on day one.

Nine flags (§12.11). The Settings screen groups them with one line each explaining what turning it
on puts in the navigation.

### W14 — The daily report gains sections. The product does not gain a second message. `[DECIDED]`

P1 Part 2 generates a great deal that *could* push: a leave request awaiting approval, a machine
service due, a certificate expiring, a gate entry left open overnight, an energy anomaly, a worker
approaching the overtime cap, a payroll run not yet finalised on the 4th.

**If each of those pushes, the channel is dead by the end of the second week.**
`automation-strategy.md` §3.1 names it, `factory-os.md` §5.7 applies it (*"push is for transitions;
the daily report is where standing problems live"*), and `nexflow-intelligence.md` §8.3 applies it
again (*"an owner receiving two Telegram messages a day from Nexflow reads neither"*).

`[DECIDED]` **Exactly four things in this document may push, and each pushes once per object:**

| Push | Why it earns a push |
|---|---|
| A statutory or insurance document expiring within 30 days | A lapsed Consent to Operate closes the factory. There is no recovering from missing it |
| A reportable incident recorded | Factories Act s.88 has a notice period measured in hours, not days |
| A payroll run not finalised by the tenant's own pay-by date | The Payment of Wages Act deadline, and the one date a worker enforces |
| A machine breakdown that has open production orders assigned to it | `factory-os.md` §5.7's "transition" test — a projection just changed |

**Everything else is a section on the 7pm report or a line in the 8am digest.** Leave requests, service
dues, energy anomalies, gate exceptions, overtime-cap warnings, verification dues — all of them are
standing states and standing states do not push.

---
## 3. Attendance and Shifts

### 3.1 The shape

> **A shift says when people are expected. A punch says a device saw somebody. A day says what a
> named person decided happened.** W5.

```
  p2_shifts                 name, start, end, days of week, break, grace, half-day rule
      |                     crosses_midnight, overtime_after_minutes
      v
  p2_shift_assignments      worker -> shift, effective-dated. A worker can move shifts.
      |
      v
  p2_attendance_punches     APPEND-ONLY. device | qr | supervisor | manual
      |                     punched_at, device_time, received_at, verify_mode,
      |                     geo_lat/lng/accuracy, trust
      v
  p2_attendance_days        ONE ROW PER (worker, date). The decision.
      |                     status, worked_minutes, ot_minutes, late_minutes,
      |                     early_minutes, source, decided_by
      +-- p2_attendance_day_changes    every edit, with a reason
      |
      v
  p2_payroll_runs           consumes days; finalising LOCKS them (W4)
```

### 3.2 Shifts

A shift is a **schedule**, and the reason it is a table rather than three columns on a worker is
that the Factories Act cares about it: **s.61 requires a notice of periods of work for adults to be
displayed and notified**, and s.63 forbids a worker working otherwise than in accordance with it.
A factory that changes shift timings without changing the notice has a problem the software should
at least be able to evidence.

| Column | Decision |
|---|---|
| `start_time` / `end_time` | `time`, not timestamps. A shift is a daily pattern |
| `crosses_midnight` | Derived on save from `end_time <= start_time`, stored so queries need no CASE |
| `days_of_week` | `smallint[]`, ISO 1–7. A six-day factory is `{1,2,3,4,5,6}` |
| `break_minutes` | Unpaid, deducted from worked time. **s.55 requires a half-hour interval after five hours** — Nexflow warns if a shift over 5 hours has none |
| `grace_minutes` | Late arrival tolerated before a late mark. Typically 10–15 |
| `half_day_after_minutes` | Worked minutes below this and above zero → half day |
| `full_day_minutes` | Worked minutes at or above this → full day |
| `late_marks_for_half_day` | 3 is the common Indian factory rule. NULL = the rule is off |
| `overtime_after_minutes` | Minutes worked before OT accrues. **Defaults from the statutory daily limit, not from the shift length** (§0 C2) |
| `is_night_shift` | Drives the s.66 check below |

**Night shifts date to the day they start.** A shift beginning 22:00 Monday and ending 06:00 Tuesday
produces one `p2_attendance_days` row dated **Monday**. This has to be stated because
`factory-os.md` §5.1 makes the opposite choice for production progress — *"the IST date the work
happened … a night-shift worker taps at 1am for yesterday's"* — and the two are both correct for
their own purpose. Progress is about output, which happened on a physical day. Attendance is about a
shift, which is one unit of work however many calendar dates it touches. **A payroll that splits a
night shift across two days pays two half days for one shift**, which is the bug this rule exists to
prevent. `p2_attendance_days.attendance_date` is always the shift's start date.

**`[UNVERIFIED — §18 Q1]` Women on night shifts.** Factories Act s.66(1)(b) restricts women's working
hours, and Maharashtra has relaxed it by notification subject to conditions — transport, security,
written consent, minimum group size. Nexflow's position: when `is_night_shift` is true and a rostered
worker's `gender = 'female'`, show a one-line notice naming the conditions and record an
acknowledgement. **It does not block**, because the relaxation is real and the conditions are
physical facts Nexflow cannot verify. Confirm the current notification with a CA before writing the
notice text.

### 3.3 How a day gets decided

Every active worker gets a row for every date in an open period, defaulted from their shift
assignment. The default is then overwritten in exactly one of four ways:

```
  1. PUNCHES RESOLVE CLEANLY     in-punch and out-punch, worked minutes computed,
                                 status derived from the shift's thresholds
                                 -> source = 'device' | 'qr',  no human touched it

  2. PUNCHES ARE AMBIGUOUS       missing out-punch, three punches, a punch 40 minutes
                                 from a device with clock skew
                                 -> lands on the DAY EXCEPTIONS list (3.4), status
                                    stays at its default until a human resolves it

  3. NO PUNCH EXISTS             the whole method failed, or the worker has no device
                                 enrolment at all
                                 -> supervisor marks it (3.4), source = 'supervisor'

  4. LEAVE WAS APPROVED          4.4 writes the day directly, status = 'leave'
                                 -> source = 'leave', and it cannot be overwritten by
                                    a later punch without an explicit override
```

**The exceptions list is the product.** A factory with 40 workers and a working biometric device
produces perhaps three exceptions a day, and resolving three exceptions is a ninety-second job. The
failure mode of every biometric attendance system in this market is that it produces forty
exceptions a day and somebody stops looking — which is why §3.5's clock-skew handling and §3.7's
single-punch rule matter more than they look.

### 3.4 The supervisor path — build this first

One screen. Today's date, the shift, the rostered workers, present pre-selected.

```
   16 September · General Shift · 38 rostered

   Ramesh Pawar          [ P ]  A   HD   L        ← one tap changes it
   Sunil Kadam           [ P ]  A   HD   L
   Anita Shinde           P   [ A ]  HD   L    ← absent, reason optional
   Balu More              P    A   HD  [ L ]   ← leave: picks from approved leave only
   ...

   3 exceptions from the device today  ▸
   [ Save 38 days ]
```

Four rules:

- **Present is the default and it is pre-selected.** A screen that starts blank makes the supervisor
  do 38 taps to record a normal day, and a screen that takes 38 taps is a screen that gets filled in
  on Friday for the whole week from memory.
- **Marking `L` offers only leave the worker actually has approved.** A supervisor cannot grant leave
  from this screen — that is §4.4's flow, with its own approval — because attendance and entitlement
  are different decisions made by different people.
- **A day already locked by a finalised payroll run is read-only**, shown greyed, with the run number
  (W4).
- **Bulk actions exist for the real cases**: mark a whole shift absent (a shutdown day), mark a
  holiday, copy yesterday. Copy-yesterday is deliberately **not** offered for more than one day at a
  time — a "copy last week" button is a muster roll written on Friday.

**Role gate:** `owner`, `supervisor`. Not `operator`, not `storekeeper`. Server-side, per
`nexflow-agent.md` D11, checked before any write.

**This screen makes payroll possible with zero hardware**, and §14.2's MVP depends on that being
true.

### 3.5 The device path — one webhook for fingerprint, card and face

§0 C8: eSSL, BioMax and most Realtime hardware are ZKTeco-lineage and push over plain HTTP. One Edge
Function, `attendance-ingest`, `verify_jwt = false`, service role via `SB_SECRET_KEY` — the same
shape as `receive-dispatch` and `notify`, both live `[VERIFIED]`.

**The protocol, as understood, and every line of it needs a real device before code ships**
`[UNVERIFIED — §18 Q3]`:

```
  handshake   GET  /iclock/cdata?SN=<serial>&options=all&pushver=<v>
              -> server replies with a plain-text options block:
                 GET OPTION FROM: <serial>
                 Stamp=<n>  ErrorDelay=30  Delay=10  TransInterval=1  Realtime=1

  attendance  POST /iclock/cdata?SN=<serial>&table=ATTLOG&Stamp=<n>
              body: one record per line, TAB separated
                 <pin> \t <YYYY-MM-DD HH:MM:SS> \t <status> \t <verify> \t <workcode> \t ...
              -> server MUST reply exactly:  OK: <count>

  commands    GET  /iclock/getrequest?SN=<serial>     -> "OK" when nothing to send
  ack         POST /iclock/devicecmd?SN=<serial>
  enrolments  POST /iclock/cdata?SN=<serial>&table=OPERLOG
```

**Six implementation rules, each closing a specific failure:**

1. **Never return a 4xx or 5xx to a device.** Firmware behaviour on an error response ranges from a
   sane retry to wiping the local buffer to hammering the endpoint every second. Always `200` with
   the expected body; record the problem server-side. This is the same posture the `notify` Edge
   Function already takes for a different reason — *"every caller is fire-and-forget and must never
   see a request fail"* `[VERIFIED]`.
2. **An unregistered serial is accepted, stored nowhere, and raises an `opsAlert` at `monitor`.** A
   device pointed at the wrong tenant's URL is a real support call and it should be visible to the
   founder, not silently dropped.
3. **Authenticate on a path token, not on the serial.** The serial is printed on the device and
   appears in every request; it is an identifier, not a secret. The device's "server address" field
   takes a path on most firmware, so register devices at
   `/attendance-ingest/<device_token>?SN=<serial>` and require both to match.
   **`[UNVERIFIED — §18 Q3]`: some firmware accepts only host and port.** If a client's device
   cannot take a path, fall back to serial plus an IP allowlist
   (`p2_attendance_devices.allowed_ip_cidr`) — and then every punch from it lands with
   `trust = 'unverified'`, which §3.7 rule 5 says cannot by itself mark a day present.
4. **Record both clocks and flag the skew.** `device_time` is what the device said; `received_at` is
   the server's. A device whose clock has drifted forty minutes marks the entire shift late, every
   day, until somebody notices — and nobody notices, they just stop trusting the late column.
   `|skew| > 5 minutes` flags the punch and raises a digest line naming the device.
5. **Idempotency is a natural key.** `UNIQUE (tenant_id, device_id, device_user_id, punched_at)`.
   Devices resend an entire buffer when an acknowledgement is lost, which is the normal case on a
   factory internet connection. Two punches by one person in the same second is physically
   impossible, so the key is safe.
6. **The device user id is not the worker id.** `p2_workers.biometric_id` carries the PIN enrolled on
   the device, unique per tenant. A punch for an unknown `biometric_id` is stored with
   `worker_id = NULL` and appears on the exceptions list as *"unrecognised enrolment 0041"* — never
   discarded, because it is usually a new joiner whose enrolment was never mapped.

**`verify_mode` and `status` integers vary by firmware and must be captured from the real device**,
not assumed. Store the raw integer **and** a mapped label; when the mapping is unknown, the label is
`unknown` and the raw value survives for later interpretation. This is the same discipline
`gstr2b-reconcile.html` uses for IMS status codes `[VERIFIED]`.

**The USB fallback is worth one afternoon and buys a lot.** Every one of these devices exports
`attlog.dat` to a pen drive in the identical tab-separated format. A file-upload box that parses it
means a factory with a device on an isolated network, or no network at all, still gets device-grade
attendance — and it is the same parser as the webhook body. Session 3.

**Matrix COSEC is a genuine REST API and a different integration.** `[RECOMMENDED: defer]` until a
client owns one. It is materially more expensive hardware than this segment buys.

### 3.6 The geo-QR path — a deterrent, described as one

§0 C7 redesigns this around what the mechanism can deliver. The flow:

```
  GATE DISPLAY                        WORKER PHONE
  ------------                        ------------
  a tablet, an old phone, or a         opens the camera, scans
  printed screen on the wall           |
  |                                    v
  polls for the current code           GET attendance-qr?c=<code>
  every <window> seconds               |
  |                                    +-- code expired      -> "Scan again"
  v                                    +-- code already used
  p2_attendance_qr_windows                 by this worker    -> "Already marked"
  one row per window, with a               in this window
  scan count                           +-- valid             -> geolocation requested
                                                              -> punch written
```

Five decisions:

- **The rotating code is the control; the geofence is corroboration.** `[RECOMMENDED]` a **60-second
  window**. Short enough that a photographed code is stale before it reaches a WhatsApp group,
  long enough that a worker walking up to the display can scan it. `[UNVERIFIED — §18 Q5]` — this is
  a guess about human speed at a gate and the pilot should measure the failed-scan rate.
- **One punch per worker per window**, enforced by `UNIQUE (window_id, worker_id)`. A code shared
  with five people produces five punches in one window — which is not blocked, it is **recorded and
  visible**: a window with an anomalous scan count is the signature of photo-and-share and it lands
  in the digest.
- **The accuracy budget.** A reading whose own `coords.accuracy` exceeds the geofence radius is
  recorded as `geo_status = 'unusable'`, not `'outside'`. §0 C7: indoors, on this device class, that
  is the *common* case and treating it as a failure fails the honest worker.
- **It records and flags. It does not block.** `geo_status IN ('inside','outside','unusable','denied')`
  lands on the day's exception list. A worker who declines the location permission still gets a
  punch, flagged.
- **Mock location is undetectable from a browser and the sales conversation says so.** §15.1. A
  worker determined to punch from home can, on any Android, in thirty seconds. Geo-QR raises the
  effort from *forwarding a photo* to *installing a mock-location app and knowing the factory's
  coordinates*, which is a real increase and is not a control.

**The gate display needs no login and no app** — a public page, `attendance-display.html?token=…`,
polling a public Edge Function, same three-state shape as `receive.html` `[VERIFIED]`. An old Android
taped to the wall in kiosk mode is the intended hardware.

### 3.7 Late, early, half-day, and overtime

All five figures are computed from worked minutes against the shift, in code, with no judgment:

```
  worked_minutes  = sum of paired in/out intervals  -  break_minutes
  late_minutes    = max(0, first_in - shift_start - grace_minutes)
  early_minutes   = max(0, shift_end - last_out)
  ot_minutes      = max(0, worked_minutes - shift.overtime_after_minutes)
  status          = worked_minutes >= full_day_minutes      -> present
                    worked_minutes >= half_day_after_minutes -> half_day
                    worked_minutes > 0                       -> half_day + exception
                    worked_minutes = 0                       -> absent
```

Five rules on top of the arithmetic:

1. **`late_marks_for_half_day` is applied at period close, not per day.** Three late marks becoming
   a half day is a *policy* deduction applied once when the payroll run computes, and it produces its
   own visible line — never a silent rewrite of a day that was genuinely worked. A worker who sees
   `present` on the 4th, the 11th and the 18th and a half day's deduction in the payslip can follow
   the arithmetic. A worker whose 18th silently became `half_day` cannot.
2. **Overtime is recorded in minutes and a reason, and it is not the same thing as paying it.**
   `p2_attendance_days.ot_minutes` is a fact; whether it is paid, and at what multiplier, is §5.4
   step 6 under §0 C2's floor. A factory that grants compensatory time off instead records
   `ot_disposition = 'comp_off'` and §4 credits a leave row.
3. **The quarterly overtime cap is tracked and warned on.** §0 C2. A running total per worker per
   statutory quarter, with a digest line as a worker passes 80% of the cap. It does not block —
   Nexflow does not know what exemption the factory holds.
4. **A single punch is an exception, never a full day and never an absence.** The most common device
   failure in the field is a worker who punches in and leaves without punching out. Guessing the
   shift end pays for hours nobody worked; marking absent denies a day that was worked. **It goes to
   the supervisor with both facts shown.**
5. **A `trust = 'unverified'` punch cannot mark a day present on its own.** §3.5 rule 3. It records,
   it appears, and it requires a supervisor confirmation to become a paid day.

### 3.8 Edge cases

| Case | Behaviour |
|---|---|
| Worker punches at two devices | Both stored. Worked minutes computed across all punches for the day, ordered by time |
| Device offline all day, buffers, uploads at 8pm | Normal. `received_at` is far from `device_time`; skew flagging is on the *clock*, not on the delay. Days for that date are recomputed on arrival if not locked |
| Punch arrives for a date in a finalised period | Stored in `p2_attendance_punches` — it is a fact. **The day is not changed** (W4). Appears on the arrears exceptions list for the next run |
| Worker has no shift assignment | Day row still created, defaulted `weekly_off`, flagged *"no shift assigned"*. Never silently absent |
| Worker is inactive (`p2_workers.is_active = false`) | No day rows generated from the day after `date_of_leaving`. A punch after that is stored and flagged — it is usually a card that was not collected |
| Two punches one second apart | Both stored; interval pairing ignores intervals under a configurable minimum (default 60s) |
| Holiday and a worker attends | `status = 'present'` on a `holiday` day. §5.4 step 6 pays it at the shift's holiday multiplier if set; otherwise it is ordinary time and a compensatory off under s.53 is the factory's to grant |
| A worker works a double shift | Worked minutes exceed a single shift; status `present`, `ot_minutes` large, and it lands on the exceptions list because **s.56's 10.5-hour spread-over is a legal ceiling, not a preference** |
| Clock change / DST | India has none. `Asia/Kolkata` is fixed at +05:30, which removes an entire class of bug this module would otherwise have |

---

## 4. Leave

### 4.1 The ledger

`p2_leave_ledger` is append-only, balance is `SUM`, nothing is stored. W7, and the same idiom as
`p2_stock_transactions`, `p2_wip_transactions` and `p2_production_progress` `[VERIFIED]`.

```
  accrual      +12.0   "EL accrual for calendar 2026, 247 days worked"
  consumption   -2.0   "Approved leave 14-15 Mar, request #88"
  lapse        -3.0    "Carry-forward above 30-day cap, 31 Dec 2026"
  encashment   -9.0    "Paid on exit, run 2026-11"
  --------------------
  balance      = SUM, per (worker, leave_type), never stored
```

### 4.2 Leave types, and which of them are statutory

**This distinction is the whole reason `p2_leave_types` exists as a table rather than an enum**, and
it is the thing most payroll software in this market gets wrong by presenting CL/SL/EL as a uniform
trio.

| Type | For a factory | Basis |
|---|---|---|
| **Earned / privilege leave** | **Statutory.** Factories Act s.79 | Accrued from days worked (§4.3). Encashable. Carries forward to a cap |
| **Casual leave** | **Not statutory under the Factories Act.** Standing orders or custom | Whatever the factory grants. Typically lapses annually |
| **Sick leave** | **Not statutory under the Factories Act.** For ESI-covered workers, sickness benefit comes from ESIC, not from the employer | Policy |
| **Maternity** | **Statutory.** Maternity Benefit Act 1961 — 26 weeks for the first two children. `[UNVERIFIED — §18 Q1]` and interacts with ESI coverage | Statute |
| **Compensatory off** | Arises from s.53 where a weekly holiday is worked | Credited by §3.7 rule 2 |
| **Leave without pay** | Not leave. The absence of it | Derived, never granted |

`p2_leave_types.statutory_basis text` records which, and the leave card prints it. A factory that
grants 8 casual days is granting them; a factory that grants earned leave is discharging an
obligation, and the two must not look the same on a screen an inspector might read.

**The Maharashtra Shops and Establishments Act 2017 does create casual leave — and it does not apply
to factories.** A unit with a factory and a separate sales office may be under both Acts for
different premises. `[UNVERIFIED — §18 Q1]`: confirm per client which Act each premises is under
before configuring their leave types. Getting this backwards means telling a factory owner they owe
leave they do not, or the reverse.

### 4.3 Earned leave accrual — computed, never typed

Factories Act s.79, as understood `[UNVERIFIED — §18 Q1]`:

```
  eligible       <=>  days_worked_in_calendar_year >= 240
  accrual        =   floor(days_worked / 20)            for an adult
  available      in the FOLLOWING calendar year
  carry_forward  capped (30 days is the common figure); the excess LAPSES
  on exit        the balance is encashed at the last-drawn rate
```

Four implementation notes:

- **"Days worked" includes days the Act deems worked** — a layoff period, maternity leave, and the
  leave itself, subject to conditions. A naive `COUNT(status='present')` under-accrues, which is the
  error that is never reported because it is in the worker's disfavour and they do not know the
  formula. `p2_leave_types.counts_as_worked_for_el boolean` makes it explicit per type, and the
  defaults ship set per a CA's confirmation, not per this document's reading.
- **It is one RPC, `accrue_annual_leave(p_tenant_id, p_year)`, run in January**, idempotent, writing
  one `accrual` row per eligible worker with the computation in `notes`. Re-running it writes
  nothing new. **Not a trigger** — a trigger on attendance recomputes an annual entitlement eight
  thousand times a year and is wrong at every boundary.
- **The lapse row is written by the same RPC**, dated 31 December, so the balance is correct on 1
  January rather than correct-once-somebody-looks.
- **It runs for the *preceding* year.** January 2027's run accrues entitlement earned across 2026,
  available through 2027. Off-by-one here gives a worker a year of leave they have not earned.

### 4.4 Request and approval

```
  worker or supervisor raises       p2_leave_requests  status = 'pending'
        |                            from_date, to_date, half_day flags, reason
        v
  BALANCE CHECK, at request time    warns if it would exceed balance; does NOT block
        |                            (an owner may grant leave in advance, and does)
        v
  owner or supervisor approves      status = 'approved'
        |
        +-- writes p2_leave_ledger consumption rows
        +-- writes p2_attendance_days rows, status = 'leave', source = 'leave'
        +-- REFUSES if any date is locked by a finalised payroll run (W4)
        +-- REFUSES if any date is already 'present' with worked minutes, naming the conflict
```

Four rules:

- **The approver may not be the requester.** Same-person approval defeats the point of the flow, and
  the check is server-side. An owner raising their own leave is the one exception, recorded as such.
- **A balance warning is not a block.** Leave in advance of accrual is normal and refusing it would
  make the software wrong about a decision that is the owner's.
- **Half days are a flag on the first and last date**, not fractional dates, because that is how
  factories actually request them and it keeps `p2_attendance_days` one row per date.
- **Cancellation reverses**: an approved request cancelled before the period is locked writes
  compensating ledger rows and reverts the day rows to their shift default. After the lock, it is an
  arrear (W4).

### 4.5 Edge cases

| Case | Behaviour |
|---|---|
| Leave spanning a weekly off or holiday | The intervening non-working days are **not** consumed. Ledger rows are written per *working* day in the range |
| Leave spanning a month boundary into a locked period | The unlocked part is written; the locked part is refused, named, and offered as an arrear |
| Balance goes negative | Allowed, shown in red, and §5.4 step 8 treats negative-balance days as **LWP** unless the owner explicitly marks them paid. A negative leave balance silently paid is a gift nobody decided to give |
| Worker leaves mid-year | `accrue_annual_leave` is run for the part-year on exit; the balance is encashed at the last-drawn rate as an `encashment` row and a payroll line |
| A worker on ESI is sick | ESIC pays sickness benefit; the employer does not. The leave type's `is_paid_by_employer = false` keeps the day unpaid in payroll **and** visible on the leave card, which is the honest representation |

---

## 5. Payroll

### 5.1 The boundary, restated on the page a session will be reading

**Nexflow computes what each worker is owed, and what the employer owes each statute. It hands both
over. It files nothing, pays nothing, and holds no credential.** W2, and the full table is there.

If a session is about to write code that uploads, submits, authenticates against a government portal,
computes TDS, or moves money — **it is outside this document and the answer is no.**

### 5.2 The run lifecycle

```
  draft        created for (tenant, period). Nothing computed.
   |           Shows: which workers are in scope, what is missing before it can compute
   v
  computed     every line computed from attendance + wage structure + rate set
   |           NOTHING IS LOCKED. Recompute freely. This is where the work happens.
   v
  approved     a named human has reviewed the register. Still reversible.
   |
   v
  finalised    IRREVERSIBLE (W4).
               - locks p2_attendance_days for the period
               - freezes every rate and component on every line
               - pins rate_set_version
               - payslips become issuable
               - corrections from here are ARREARS on the next run
```

**`computed` can be re-run any number of times and each run replaces every line.** That is the point
of the state: a payroll is wrong the first three times it is computed, because somebody's attendance
was wrong, somebody's wage structure was out of date, and somebody's advance was not recorded.
Making that cheap is what makes the module usable.

**Finalisation is the confirmation** `nexflow-agent.md` §1.4 requires, and it must look like one: a
full register on screen, totals, the count of workers, the net payable, the employer liability, and
an explicit statement of what finalising locks. Not a toast.

### 5.3 The wage structure — components, not a number

**`p2_wage_structures` is effective-dated and holds components, and this is not over-engineering.**
§0 C4 and §0 C2 both turn on it: PF wages, ESI wages, the overtime base and the bonus base are four
*different* subsets of a worker's pay, and a single `base_salary` column cannot express any of them.

```
  p2_wage_structures        worker_id, effective_from, effective_to (NULL = current)
       |                    wage_basis: monthly | daily
       v
  p2_wage_components        one row per component on that structure
                            name          'Basic' | 'DA' | 'HRA' | 'Conveyance' | ...
                            amount        monthly or daily per the structure's basis
                            is_pf_wage    counts toward the PF base    (C4)
                            is_esi_wage   counts toward the ESI base
                            is_ot_base    counts toward "ordinary rate" (C2, s.59(2))
                            is_bonus_wage counts toward the bonus base (C6)
                            prorates      reduced for unpaid days, or fixed
```

**Defaults ship conservative and the reason is legal, not cautious.** Every component defaults
`is_pf_wage = true` — because after *RPFC v. Vivekananda Vidyamandir* a universally-paid allowance is
PF wages, and the safe default is inclusion. A factory that excludes something is making a decision,
in a field, that is visible to their CA. A factory that discovers Nexflow silently excluded their
"special allowance" discovers it at a PF inspection.

**`wage_basis = 'daily'` is a first-class case, not an afterthought.** A large share of MIDC factory
workers are on a daily rate. On a daily basis, monthly earnings are `rate × paid_days` and the
wage-days question in §5.4 step 1 does not arise. On a monthly basis it very much does.

**A structure is never edited. A change is a new effective-dated row**, which means a payslip from
March reproduces with March's structure after an April increment — the same reason W3 pins the rate
set.

### 5.4 What a run computes, in order

Every step is SQL or bounded TypeScript. **No model is called anywhere in this sequence.**

```
 1. PERIOD AND WAGE DAYS
    period_start_day from policy (1 = calendar month; 26 = a 26th-to-25th factory)
    wage_days_basis: calendar | fixed_26 | fixed_30
    -> this single choice moves every per-day rate. It is policy, it is visible on
       the payslip, and it is never inferred.

 2. WORKERS IN SCOPE
    active for any part of the period, joined/left dates respected pro rata

 3. WAGE STRUCTURE
    the row effective on each date in the period. A mid-month increment splits the
    period and each part is computed on its own structure.

 4. ATTENDANCE
    paid_days   = present + half_day(0.5) + paid_leave + weekly_off + holiday
    unpaid_days = absent + unpaid_leave + negative-balance leave (4.5)
    ot_minutes  = SUM, where ot_disposition = 'pay'
    late_marks  = COUNT, for the policy rule (3.7 rule 1)

 5. EARNINGS
    per component: prorates ? amount x paid_days / wage_days : amount
    -> LWP is the ABSENCE of earnings, never a separate deduction line.
       Showing a full salary and a "LWP deduction" is how a payslip becomes
       an argument.

 6. OVERTIME
    ot_base_monthly = SUM(components WHERE is_ot_base)
    hourly          = ot_base_monthly / (wage_days x shift_hours)
    ot_amount       = (ot_minutes / 60) x hourly x policy.overtime_multiplier
    -> multiplier >= the statutory floor from the rate set. C2.

 7. GROSS = earnings + overtime + arrears + one-off additions

 8. STATUTORY DEDUCTIONS AND CONTRIBUTIONS     -> 5.5, and it is the hard part

 9. OTHER DEDUCTIONS
    advance recovery, capped by policy AND by the statutory cap in step 11

10. NET PAYABLE = gross - employee deductions

11. DEDUCTION CAP CHECK
    Payment of Wages Act s.7(3): total deductions may not exceed 50% of wages
    (75% where they include payments to a co-operative society).
    [UNVERIFIED - 18 Q1]
    -> a line breaching it is BLOCKED, named, with the advance recovery reduced
       to the cap and the remainder carried forward. Never silently paid at zero.

12. EMPLOYER SIDE (not a deduction; a liability)
    employer PF, EPS, EDLI, employer ESI, employer LWF, minimum bonus accrual
    -> 5.7's statement

13. ESTABLISHMENT-LEVEL FIGURES
    PF administration charge: 0.65% of total PF wages, MINIMUM Rs 500 for the
    whole establishment. This is the one figure that CANNOT be computed per
    worker and summed -- it lives on p2_payroll_runs, not on p2_payroll_lines.
```

**Step 13 is small and it is the sort of thing that gets found in production.** A per-worker
apportionment of a ₹500 establishment minimum produces per-worker figures that do not exist and a
total that is right by accident.

### 5.5 The statutory deductions, one at a time

Every rate, cap and threshold below is read from `p2_statutory_rates` (W3), effective-dated. The
numbers are here to make the shape checkable, **not** to be typed into code — §5.9 is the gate.

**Provident Fund** (§0 C4)

```
  pf_wages      = SUM(components WHERE is_pf_wage)
                  if policy.restrict_pf_to_ceiling: MIN(pf_wages, 15000)
  employee_pf   = 12% x pf_wages                          rounded to the rupee
  eps           = 8.33% x MIN(pf_wages, 15000)            capped at 1250
  employer_epf  = (12% x pf_wages) - eps
  edli          = 0.50% x MIN(pf_wages, 15000)            capped at 75
  -- establishment level, step 13:
  pf_admin      = MAX(0.65% x SUM(pf_wages), 500)
```

- Applicability threshold: 20 employees. A smaller factory may cover voluntarily.
- A worker above the ceiling who was never a member may be an *excluded employee*.
  `p2_worker_payroll_identity.pf_status IN ('member','excluded','voluntary')` records the decision
  rather than deriving it, because the decision was made at joining and is not recoverable from the
  wage.
- **EPS stops at 58 and there are conditions on new members above the ceiling.**
  `[UNVERIFIED — §18 Q1]`.

**Employees' State Insurance** (§0 C5)

```
  contribution_period = Apr-Sep | Oct-Mar
  eligible            = wages at the START of the period <= 21000
                        -> FROZEN for the whole period on p2_payroll_lines
  employee_esi        = 0.75% x esi_wages    rounded UP to the rupee
                        -> SKIPPED where average daily wage <= 176; employer still pays
  employer_esi        = 3.25% x esi_wages    rounded UP to the rupee
```

- ESI wages include overtime. **PF wages do not.** This asymmetry is real, it is easy to get
  backwards, and getting it backwards is wrong in both directions at once.
- Applicability: 10 employees in most states, and only in implemented areas.

**Professional tax — Maharashtra** (§0 C3)

```
  slab lookup on the policy-defined base (gross, typically), by gender
  February: the slab amount is replaced by the February amount (300, not 200)
  annual total per person is capped at 2500 by Article 276(2)
  -> the cap is asserted at year end; a worker who joined mid-year cannot exceed it
```

The employer's own enrolment-certificate liability (a flat annual figure) is a line on §5.7's
statement, not a per-worker deduction.

**Labour Welfare Fund — Maharashtra** `[UNVERIFIED — §18 Q1]`

Half-yearly, June and December, a small fixed employee and employer amount with the employer's share
a multiple of the employee's. **The amounts and the eligibility band have been revised and this
document does not state a figure.** Rate-table driven, defaulting to zero until a CA supplies the
current notification — **a zero that is visible is better than a number that is wrong.**

**Minimum bonus accrual** (§0 C6)

```
  eligible   = wages <= 21000 AND worked_days_in_year >= 30
  base       = MIN(wages, MAX(7000, minimum_wage_for_the_scheduled_employment))
  accrual    = 8.33% x base, per month, provisioned
  -> labelled "minimum liability under the Act". The actual percentage comes from
     the CA's allocable surplus computation and is entered, not derived.
```

**Minimum wages: Nexflow warns and does not know.** Maharashtra notifies minimum wages per scheduled
employment, per zone, revised half-yearly, across hundreds of employments. `[DECIDED]` Nexflow does
**not** maintain that table — it is a data-maintenance commitment with a half-yearly failure mode and
a per-client correctness question. `p2_payroll_policies.minimum_wage_monthly` is entered by the
tenant, and a computed gross below it produces a loud, unmissable warning on the register naming the
worker. The screen says plainly that this is a warning against a number the factory supplied.

### 5.6 Advances, arrears and recovery

**`p2_worker_advances` is a ledger**, same idiom as everything else: positive rows are advances paid,
negative rows are recoveries, balance is `SUM`.

```
  advance      +15000   "Advance paid 4 Mar, cash"
  recovery      -3000   "Recovered on run 2026-03"
  recovery      -3000   "Recovered on run 2026-04"
  ------------------
  outstanding  =  9000
```

Four rules:

- **Recovery is capped twice**: by the factory's own policy (`advance_recovery_max_pct_of_net`) and
  by the statutory deduction ceiling in §5.4 step 11. The tighter of the two binds.
- **A recovery is never larger than the outstanding balance**, and a run that would over-recover
  reduces itself and says so.
- **Advances survive a worker leaving.** The final run recovers what it can within the cap; the
  residue stays on the ledger as an outstanding balance with `worker.is_active = false`, visible,
  because it is a real debt and writing it off is the owner's decision, not the software's.
- **An advance is not a loan with interest.** Interest on a salary advance opens questions under the
  Payment of Wages Act that this product is not going to answer. `[NEVER]`, §17 item 8.

**Arrears** are a line type (W4), carrying `arrear_for_period`, and they appear on the payslip as
their own line naming the month they correct.

### 5.7 The employer liability statement — the actual deliverable

This is the artefact the CA acts on, and it is the reason the module is defensible under W2.

```
  NEXFLOW PAYROLL - STATUTORY LIABILITY
  Datta Prasad Enterprises        March 2026        Rate set v2026.1

  PROVIDENT FUND                     due by the 15th of April
    Employee contribution (A/c 1)                    Rs   42,120
    Employer EPF        (A/c 1)                      Rs   13,224
    Employer EPS        (A/c 10)                     Rs   28,896
    EDLI                (A/c 21)                     Rs    2,550
    Administration      (A/c 2)   0.65%, min Rs 500  Rs    2,281
                                                     -----------
    Total remittable                                 Rs   89,071
    38 members. ECR detail attached.

  EMPLOYEES' STATE INSURANCE          due by the 15th of April
    Employee 0.75%                                   Rs    3,014
    Employer 3.25%                                   Rs   13,062
                                                     -----------
    Total remittable                                 Rs   16,076
    31 of 38 covered. 7 above the Rs 21,000 ceiling at period start.

  PROFESSIONAL TAX                    due per your liability band
    Deducted from 38 employees                       Rs    7,600
    Employer enrolment certificate (annual)          see note 3

  LABOUR WELFARE FUND                 next due: June
    Not applicable this month.

  PROVISIONS (not remittable this month)
    Minimum statutory bonus accrued, March           Rs   19,684
    -> minimum liability under the Act. Your CA computes the
       actual percentage from the allocable surplus.

  NOTES
  1. Nexflow computes these figures. It does not file or pay any of them.
  2. Rates applied are rate set v2026.1, effective 1 April 2025. Every rate
     used is listed on the attached sheet.
  3. The employer's own professional tax under the Enrolment Certificate is a
     separate annual liability and is not computed here.
  4. Confirm all figures with your CA before remitting.
```

**Four properties, each doing work:**

- **It names the account heads** (A/c 1, 2, 10, 21) because that is how the remittance is actually
  made and a CA should not have to re-derive the split.
- **It states the rate set version and attaches the rates.** W3. A CA who disagrees can see exactly
  what was applied without asking.
- **It separates remittable from provisioned.** Bonus is a liability, not a payment due on the 15th,
  and a statement that mixes them causes a payment that should not be made.
- **Note 1 is not boilerplate.** It is the boundary in W2, printed on the artefact, every month.

**Due dates come from the rate table, not from code**, for the same reason the rates do.
`[UNVERIFIED — §18 Q1]`: PF and ESI are commonly the 15th of the following month; PT due dates
depend on a liability band. Confirm all three.

### 5.8 Payslips

Client-side PDF, always. `CLAUDE.md`'s standing rule: server-side jsPDF was abandoned at 221ms CPU
against a 400ms budget `[VERIFIED]`, and `js/invoice-pdf.js` / `js/challan-pdf.js` are the pattern
to follow — `js/payslip-pdf.js` is a sibling, not an extension.

**What a payslip must carry**, because a payslip that cannot be checked is a payslip that gets
disputed: the period and the wage-days basis, paid days and unpaid days **with the arithmetic
visible**, every earning component by name, overtime hours and the multiplier applied, every
deduction by name, the employer contributions (shown, not deducted), UAN and ESIC IP number, net
payable in figures and in words, and the leave balance.

**Bulk generation is one job, not forty.** A run's payslips are generated together, and the owner
gets a single multi-page PDF for the printer plus individual files. The printer is the primary
delivery channel and W6 explains why.

### 5.9 The eleven parameters that must be confirmed with a CA before any payroll code is written

**This is the gate. `[UNVERIFIED — §18 Q1]`.** Every figure below is stated as last understood, is
not a legal source, and several have been revised more than once. Take this table to a practising
CA, get it confirmed **in writing**, and seed `p2_statutory_rates` from their answer — not from this
document.

| # | Parameter | Stated as | Why it must be checked |
|---|---|---|---|
| 1 | EPF employee / employer rate | 12% / 12% | Stable, but confirm the PF-wage definition post-2019 |
| 2 | EPS share and cap | 8.33%, capped at ₹15,000 wages = ₹1,250 | Confirm the ceiling and new-member conditions |
| 3 | EDLI rate and cap | 0.50%, capped at ₹75 | Confirm |
| 4 | **EPF administration charge** | **0.65%, minimum ₹500/establishment** | **Revised twice (1.10 → 0.85 → 0.65). Highest-risk line in the table** |
| 5 | PF wage ceiling | ₹15,000 | Long-discussed for revision |
| 6 | ESI employee / employer | 0.75% / 3.25% | Changed in 2019; confirm current |
| 7 | ESI wage ceiling and exemption | ₹21,000; employee share exempt at ≤₹176/day | Confirm both, and the contribution-period rule |
| 8 | **Maharashtra PT slabs** | §0 C3's table, **₹300 in February**, ₹2,500 annual cap | **Women's threshold revised 2023. Confirm the whole table** |
| 9 | Bonus ceilings | Eligibility ₹21,000; calculation ₹7,000 or minimum wage | Revised 2015; confirm both, separately |
| 10 | Maharashtra LWF | **No figure stated in this document** | Revised; defaults to zero until supplied |
| 11 | Overtime multiplier floor, quarterly cap | 2× (s.59); quarterly cap raised by Maharashtra notification | Confirm the cap and any exemption the client holds |

Plus four rules, not rates, that are equally load-bearing: the Payment of Wages Act s.7(3) deduction
ceiling (§5.4 step 11), the s.5 pay-by date, the rounding convention per statute (PF to the nearest
rupee, ESI rounded up — confirm), and which Act each client's premises falls under (§4.2).

**The parallel-run month in §14.7 is the real gate.** A CA's written confirmation gets the rates
right; running Nexflow's register beside the factory's own manual sheet for one full month, and
reconciling every worker to the rupee, is what catches the rule that was applied correctly to the
wrong base.

### 5.10 Edge cases

| Case | Behaviour |
|---|---|
| Worker joins mid-period | Pro rata on paid days. PF and ESI apply from the joining date; PT applies for the whole month (it is a monthly tax, not a daily one) `[UNVERIFIED — §18 Q1]` |
| Worker leaves mid-period | Pro rata, plus leave encashment, plus advance recovery within the cap. Final settlement is a payroll line, **not** a separate document type |
| Increment backdated two months | New effective-dated wage structure; the two closed months become **arrears** on the next run (W4), never a recompute |
| Two structures overlap in the period | The period splits at the boundary and each part computes on its own structure. §5.4 step 3 |
| Zero paid days | A line is still produced, at zero, with the reason. A missing line is indistinguishable from a forgotten worker |
| Gross below the entered minimum wage | Loud warning on the register, naming the worker. Does not block — §5.5 |
| Deductions exceed the statutory cap | **Blocked** at step 11. Recovery reduced, remainder carried |
| A finalised run must be corrected | Arrears. There is no unlock, and asking for one is §17 item 5 |
| No wage structure for an active worker | The run refuses to reach `computed` and names every such worker. **Never computes them at zero** |
| Rate set has no row effective for the period | The run refuses to compute, naming the missing rate. A payroll computed on a guessed rate is the failure this whole section is built to prevent |

---
## 6. The Asset Register

### 6.1 What it is for, and what it is not for

**Nexflow's asset register answers where a thing is, who has it, when it was last looked at, and
when its papers expire. Tally's answers what it cost and what it is worth.** W10 has the table; this
section builds the first half and computes the second as a handover.

`p2_assets` is the single master (W9) and every physical object the factory owns is a row in it:
machinery, vehicles, computers, furniture, tools, moulds, dies, jigs, fixtures, and the electrical
and safety installations that carry inspection obligations.

| Column | Decision |
|---|---|
| `asset_code` | Per-tenant unique, the factory's own tag number if they have one. Generated `AST-NNNN` if not |
| `asset_category` | `machinery · vehicle · computer · furniture · tool · mould · electrical · building · other` |
| `purchase_date` / `purchase_value` | Nullable. **A factory will not have these for half its assets on day one** and refusing the row until they do is how a register never gets built |
| `supplier_id` | Nullable FK → `p2_suppliers`. Links an asset to the GRN that brought it in, where one exists |
| `serial_number`, `model`, `make` | Free text. §6.7 on why there is no uniqueness constraint |
| `location_on_floor` | Free text. *"Bay 2, next to the press"* is how a factory actually says it |
| `insurance_policy_id` | Nullable FK → `p2_insurance_policies` |
| `depreciation_block` | The Income Tax block this asset sits in. §6.6 |
| `useful_life_years` | Companies Act Schedule II, only for a company. NULL otherwise |
| `is_production_machine`, `rated_kw` | Machine-specific, nullable. W9 — no second table |
| `status` | `in_use · idle · under_repair · disposed · written_off`. Never deleted |

**`p2_moulds` is deliberately not a table, and the reason is already in the codebase.**
`p2_dispatch_orders` already carries `asset_tag`, `last_confirmed_at` and `confirmed_by` for the
Tooling Register — dies and jigs sent out to a job worker under an exempt-tooling dispatch
`[VERIFIED — Session 3]`. A mould that lives in this factory is a `p2_assets` row; a mould that has
been *sent out* is a dispatch with a clock. §11.2 item 5 links them.

### 6.2 Insurance — the single highest-value field in this module

`p2_insurance_policies`: insurer, policy number, type, period, sum insured, premium, and a nullable
`asset_id`. **NULL means the policy covers the factory rather than an item** — a fire policy, a
public liability policy, a burglary policy — which is the majority case and a schema that requires a
specific asset cannot express it.

**A lapsed factory fire policy is the single largest uninsured exposure an MIDC unit carries**, and
it lapses because a renewal notice arrived at an address nobody checks. §10.4's expiry tracker reads
this table, and it is why §14.4 recommends pulling that tracker forward out of the safety module.

### 6.3 Custody and physical verification

`p2_asset_assignments` is effective-dated: which department or which named person holds an asset,
from when, to when. Never overwritten — a laptop that moved between three people has three rows and
the question *"who had it in March"* has an answer.

`p2_asset_verifications` is **the same concept as the Physical Stock Count screen shipped in Session
7** `[VERIFIED]`, and it should look the same and reuse its shape: a session, a list, a found/not-found
/ found-elsewhere marking per asset, a variance report, and a posted result that is append-only.

`[DECIDED]` **The differences from a stock count, and they are the whole design:**

- **An asset is found or it is not.** There is no quantity, so there is no variance arithmetic — the
  finding is a *state*, not a number.
- **"Found, but not where the register says"** is the most common real outcome and it must be a
  first-class option that updates `location_on_floor` in the same tap. A verification screen that
  only offers found/missing produces a register that is still wrong after the verification.
- **Nothing is auto-written-off.** An asset not found in a verification becomes `status = 'idle'`
  with a verification note, and writing it off is an explicit, separate, owner-only act. An
  annual count that silently disposes of assets is an annual count that destroys a fixed-asset
  register.

### 6.4 Depreciation — two schedules, neither posted

W10. `v_p2_depreciation_schedule` computes both regimes, side by side, labelled:

```
  INCOME TAX (s.32, Rule 5 Appendix I)          COMPANIES ACT (Schedule II)
  ---------------------------------------       ---------------------------
  WDV, on BLOCKS of assets                      per asset, on useful life
  rate per block from p2_statutory_rates        SLM or WDV per policy
  half-rate where used < 180 days in the        pro rata from date of
    year of acquisition                           capitalisation
  no individual asset WDV -- the block is       residual value 5% unless
    the unit                                      justified
  computed for EVERY tenant                     computed ONLY where
                                                  entity_type is a company
```

Three rules:

1. **Income Tax depreciation is computed on blocks, not on assets**, and a schedule that shows a WDV
   per asset is showing a number that does not exist in the Act. The per-asset allocation is
   presentational and the report says so.
2. **The 180-day half-rate rule is applied from `purchase_date` and `put_to_use_date`** — two
   different dates, and the Act cares about the second. `put_to_use_date` is a nullable column
   defaulting to `purchase_date`, which is right for nearly everything and wrong for a machine
   bought in March and commissioned in May.
3. **The schedule ships in the March filing package and on demand**, never posted, never synced by
   the Bridge Agent (§11.1 item 4).

**`[UNVERIFIED — §18 Q1]`: the block rates.** Appendix I rates have been revised — notably the cap on
the general plant and machinery rate. Seed them from the CA's confirmation with the rest of §5.9's
table, in the same `p2_statutory_rates` structure.

### 6.5 Edge cases

| Case | Behaviour |
|---|---|
| No purchase value | Row allowed. Depreciation shows *"not computed — no cost on record"*, never ₹0 |
| Two assets with the same serial | Allowed. **No uniqueness constraint on `serial_number`** — a factory records the motor serial on both the motor and the machine it is inside, and refusing that is refusing the register |
| Asset sold or scrapped | `status = 'disposed'`, `disposal_date`, `disposal_value`. The IT block reduces by the sale consideration; **a block that goes negative is a short-term capital gain and Nexflow flags it, does not compute it** (§17 item 10) |
| Asset is also safety equipment | Both rows, linked by `p2_safety_equipment.asset_id`. W9 |
| Asset moves to a different factory of the same owner | Out of scope. Nexflow is single-site per tenant and a second site is a second tenant `[VERIFIED — CLAUDE.md tenancy model]` |

---

## 7. Machines and Maintenance

### 7.1 Preventive maintenance — days or hours, whichever comes first

The brief specifies *"service every X days or X hours of operation — whichever comes first"*, and
that is exactly right. `p2_asset_maintenance_schedules`:

```
  asset_id, schedule_name         "Monthly greasing" | "2000-hour overhaul"
  interval_days        nullable
  interval_run_hours   nullable    -> at least one of the two is NOT NULL
  last_done_date, last_done_hours
  next_due_date        = last_done_date + interval_days
  next_due_hours       = last_done_hours + interval_run_hours
  -> DUE when today >= next_due_date  OR  cumulative_hours >= next_due_hours
```

**The hours leg only works if runtime is recorded**, and §7.3 is honest that most factories will not
record it on day one. `[DECIDED]` **A schedule with an hours interval and no runtime data falls back
to the days interval and says so on the screen** — it does not silently never fire, which is what a
naive `cumulative_hours >= next_due_hours` does when `cumulative_hours` is always zero.

### 7.2 Events — one table, one type column

`p2_asset_events` covers `preventive · breakdown · inspection · calibration · modification`, because
all five record the same six facts and splitting them means two places to look for a machine's
history. W9.

| Column | Note |
|---|---|
| `event_type` | The five above |
| `started_at` / `ended_at` | `timestamptz`. **Downtime is derived, never typed** — a typed downtime figure disagrees with its own timestamps within a week |
| `downtime_minutes` | Generated from the timestamps, stored for query convenience, never independently editable |
| `failure_description` | Free text. §6.4's reasoning — no taxonomy, for the same reason `factory-os.md` §6.4 refuses a defect taxonomy |
| `work_done` | Free text |
| `cost`, `vendor_name`, `parts_used` | Nullable. `parts_used` is free text, **not** a link to `p2_raw_materials` — see below |
| `schedule_id` | Nullable FK. Set when the event closes a preventive schedule, which advances `last_done_*` |

**`parts_used` is text and not a stock consumption, and that is a deliberate limitation.** A spare
consumed from stores *should* deduct inventory, and wiring that up means a maintenance event
becoming a stock transaction with a pool, a rate and a GST consequence. `[RECOMMENDED: not in v1]` —
it is a real feature, it is one session on its own, and no client has asked. §18 Q7.

### 7.3 Runtime, and the link to a production order

`p2_asset_runtime`: one row per (asset, date, optional production order), hours run.

**Three sources, in descending order of how likely they are to exist:**

1. **Nobody records it.** The common case. Maintenance falls back to calendar intervals (§7.1) and
   energy falls back to output pro-rata (§9.3). Everything still works, less precisely, and the
   screens say so.
2. **The supervisor enters hours per machine per shift.** One number per machine per day on the same
   screen as attendance. This is the realistic target and it is enough for both consumers.
3. **An hour meter on the machine**, read like an electricity meter. Best, rare.

`production_order_id` is nullable and is the join that makes §9.3's energy attribution and
`factory-os.md`'s bottleneck analysis possible. **It requires `p2_production_orders.asset_id`**,
which is a new column on a Part 1 table — §11.2 item 2 names the amendment.

### 7.4 Downtime and a delayed order — a stated confounder, never a cause

When a breakdown's window overlaps an open production order assigned to that machine, the
relationship is reported and **it is never asserted as the reason**:

```
  PO-2609-0042 is projected to finish Thursday 24th, due Friday 18th.
  The press it is assigned to was down 6.5 hours on the 14th and 3 hours
  on the 15th.
```

`nexflow-intelligence.md` §5.5 rule 1 is binding here and it is not a style preference: **the words
"caused", "because of" and "due to" do not appear.** The machine being down is a fact. That it is
why the order is late is a conclusion, and the order might equally be late because two workers were
on leave — which §3 now knows, and `nexflow-intelligence.md` §5.5 rule 2 requires that
be named as a confounder.

**This flows into `factory-os.md` §8's 7pm report as a line, and into W14's push list only when an
order is assigned to the machine** (W14).

### 7.5 Edge cases

| Case | Behaviour |
|---|---|
| Breakdown still open at report time | `ended_at` NULL, downtime shown as *"ongoing, 4h 20m so far"*. A NULL end is the normal state of a live breakdown |
| Two overlapping events on one machine | Allowed. A breakdown during a scheduled service is real |
| Machine has no schedule | No due dates, no alerts. Not an error |
| Hours-based schedule, no runtime | Falls back to days, visibly (§7.1) |
| Machine disposed with an open schedule | Schedules deactivate with the asset. No alerts for a machine that is gone |

---

## 8. Scrap and Yield Variance

### 8.1 The three numbers, and why the third is the product

```
  ISSUED             what left the store for this order
                     -> p2_stock_transactions consumption rows, reference_id = the
                        bom_issue dispatch, written by confirm_bom_issue at
                        start_production_order.  factory-os.md F3: consumption
                        happens ONCE, at issue.

  EXPECTED           BOM qty_per_unit x ACTUAL OUTPUT
                     -> p2_product_bom  x  SUM(p2_production_progress.quantity_done)

  ACCOUNTED FOR      recorded scrap + material returned to store
                     -> p2_scrap_records + positive adjustment rows on the order

  UNEXPLAINED  =  ISSUED - EXPECTED - ACCOUNTED FOR
```

**The unexplained figure is the entire point of this module.** Issued-versus-expected on its own is
a yield number every factory already half-knows. Issued minus expected minus *what was actually
recorded as scrapped or returned* is a number nobody has, and it is the one that says material left
the store and did not become product, scrap or stock.

**It is called unexplained and never "loss" or "shortfall".** `kpml-network-plan.md` §8.3 built WIP
precisely because a bad number here *"manufactures theft accusations, automatically, every month,
with the authority of software."* The three explanations — waste, mis-entry, theft — look identical
in the data, §15.5 says so, and the word on the screen must not pick one.

**Note on W1:** this module reads `p2_production_progress`. That is permitted and is not a breach —
W1 firewalls production data out of **payroll**, not out of yield. The rule is about what determines
a person's pay.

### 8.2 Scrap categories, and where the expected rate comes from

`scrap_category IN ('process','defect','moisture','rework_loss','setup')`:

- **`process`** — expected. Turnings, offcuts, runners, the sprue. It has a normal rate.
- **`defect`** — unexpected. A part made wrong. **This is the one that links to quality**: a
  `p2_quality_records` row with `disposition = 'scrap'` should produce a scrap record, and §8.6 says
  why that link is offered rather than automatic.
- **`moisture`** — evaporation, drying loss. Real for coatings, chemicals and some resins.
- **`rework_loss`** — material consumed making a part twice.
- **`setup`** — first-off pieces, machine set-up waste. Frequently the largest category on short runs
  and the one most often blamed on the operator.

**The expected rate, in the standing three-tier shape** `factory-os.md` §4.6 establishes:

```
  1. observed: trailing 90 days for this (product, material), >= 5 completed runs
  2. owner-set: p2_product_bom.expected_scrap_pct        <- a NEW nullable column
  3. none: variance is reported as an absolute quantity with no % judgement
```

`expected_scrap_pct` on `p2_product_bom` is an amendment to a live table. **Nullable, no default,
never backfilled** — NULL means today's behaviour exactly, which is the Type A guarantee shape
(`kpml-network-plan.md` §2).

### 8.3 Whose scrap is it — the most important rule in this document's integration surface

**For all three live tenants, the material in the factory is KPML's** `[VERIFIED — CLAUDE.md]`. Scrap
generated from it is not automatically the vendor's to sell, and getting this wrong produces a sale
invoice on somebody else's property and a GST position that does not hold.

`[DECIDED]` `p2_scrap_records.owned_by` is **derived from the production order's `owned_by`, never
asked** — F6's "derive the pool, never ask on the floor", applied unchanged.

Then the disposal path branches, and **Nexflow presents both and requires an explicit choice**:

| `owned_by` | Paths offered | Note shown |
|---|---|---|
| NULL — own material | **Sale.** Ordinary dispatch, ordinary tax invoice, ordinary revenue | — |
| A principal | **(a) Return to the principal** on a `scrap_return` challan — an existing movement purpose that already feeds **ITC-04 Table 5B** `[VERIFIED — Session 8]`. **(b) Direct supply by the job worker** | *"Under s.143(5), waste and scrap from job work may be supplied directly by the job worker on payment of tax if the job worker is registered, or by the principal if not. Which applies is a contract and tax question — confirm with your CA before choosing."* `[UNVERIFIED — §18 Q1]` |

**There is no default and there is no guess.** A principal's scrap disposed of down the wrong path is
either an unrecorded supply or somebody else's revenue on your books, and the two errors are not
symmetrical.

**This is why §0 C0 says the scrap module is worth more than the brief claims.** The `scrap_return`
movement purpose, `p2_challan_links`, and ITC-04 Table 5B all already exist and are already wired
`[VERIFIED — Session 8]`. Path (a) costs almost nothing to build and it closes a real hole: today a
vendor's scrap returns to KPML are either unrecorded or recorded as a dispatch with no quantity
provenance.

### 8.4 Valuation — two rates for two purposes, never merged

The brief says *"scrap value calculation (using last GRN rate)"*. **That is the wrong rate for this
codebase and it is worth correcting precisely**, because `CLAUDE.md` is explicit: *"Valuation rate =
latest `price_per_unit` by `effective_date` … `p2_stock_transactions.rate` is NOT the valuation rate
— it's the GRN-specific paid rate"* `[VERIFIED]`.

`[DECIDED]` **Two numbers, both computed, never combined:**

| Figure | Rate used | Answers |
|---|---|---|
| **Scrap at input value** | `p2_material_prices.price_per_unit`, latest by `effective_date` | *"What did the material we wasted cost us?"* — the yield-variance number |
| **Scrap realised** | The actual price on the disposal | *"What did we get for it?"* — the revenue number |

They are different by design and by a large factor — scrap sells at a fraction of input cost — and a
single "scrap value" that silently means one of them will be read as the other. The variance report
shows input value; the disposal shows realised; the gap between them is not a loss and is not
reported as one.

**Where no price row exists, the value is NULL and counted, never zero.** SS Engineering has **zero
`p2_material_prices` rows** `[VERIFIED]`, which is the same trap `nexflow-intelligence.md` §3.4
decision 5 documents for stock value.

### 8.5 Edge cases

| Case | Behaviour |
|---|---|
| Quality record with `disposition='scrap'` | Offers to create a scrap record, pre-filled. **Not automatic** — `factory-os.md` §6.1 is explicit that a quality tap must not create a statutory consequence, and a scrap record on a principal's material is one step from a challan |
| Scrap recorded with no production order | Allowed, `production_order_id` NULL. Sweeping the floor at month end is real. It appears in the material's total and **not** in any order's yield |
| Unexplained variance is negative | More product than material should allow. Usually an under-recorded issue or an over-recorded output. Flagged with both, never silently zeroed |
| Scrap exceeds material issued | Refused, with both numbers. This is always a data-entry error |
| Order still open | Variance computed on output so far, labelled provisional. A yield figure on an incomplete order is meaningless without that label |
| Job-work tenant with `separate_pool_deduction = false` | Pool attribution is unavailable by configuration `[VERIFIED — Session 5]`. `owned_by` is NULL, §8.3's branch cannot be evaluated, and the disposal screen says so rather than defaulting to sale |

---

## 9. Energy and Utilities

### 9.1 Meters and readings

`p2_utility_meters` — the main incomer, sub-meters, a DG set, a compressor, a water meter — each with
a `utility_type`, a `multiplier` (CT ratio, for anything HT), and a parent for sub-meters.
`p2_meter_readings` is append-only: reading, timestamp, who read it, and a derived
`units_consumed` from the previous reading on the same meter.

Three rules that prevent the usual mess:

- **A rollover is a fact, not an error.** A five-digit meter passing 99999 produces a negative delta
  unless the rollover is handled. `p2_meter_readings.is_rollover` plus the meter's `digit_count`.
- **A meter replacement closes the old meter and opens a new one.** Never edit the reading history to
  make it continuous.
- **Readings are entered by a human, so they are wrong sometimes.** A delta more than `k ×` the
  trailing median for that meter is flagged at entry, before it is saved, with both numbers. Digit
  transposition is the single most common error and it is catchable at the keyboard.

### 9.2 Per-shift consumption

Where a reading is taken at each shift change, consumption per shift falls out. Where it is taken
once a day — the realistic case — **per-shift consumption is not available and the screen says so
rather than dividing by the number of shifts.** A daily figure split evenly across three shifts is a
fabricated number that looks like a measurement.

### 9.3 Energy per unit produced — an apportionment, with its method attached

W11. Three methods, ranked, and **the method is stored on every figure**:

```
  1. sub_meter        a meter on the machine or the line.
                      Units are MEASURED against the work. Exact.

  2. machine_runtime  p2_asset_runtime.hours x p2_assets.rated_kw, apportioned
                      across the orders that ran on that machine.
                      Good. Needs runtime (7.3) and a rated kW.

  3. output_prorata   period units / period output.
                      Crude. Charges a simple part the same as a hard one, and
                      charges an idle day's demand to whatever happened to run.
                      LABELLED CRUDE, on the figure, every time.
```

**Every method is an estimate and the report says the word.** `nexflow-intelligence.md` §12.4's rule
transfers: Nexflow may say *"about 4.2 units per motor, apportioned by machine runtime"*; it may not
say *"each motor costs ₹38 of electricity."*

### 9.4 Bill reconciliation — reporting the gap, not closing it

**An electricity bill is not units × rate** (W11). The reconciliation shows, side by side: billed
units against metered units for the overlapping window, and the bill's own cost decomposition —
energy charges, demand charges by kVA, time-of-day differentials, power-factor incentive or penalty,
electricity duty, fuel adjustment, wheeling.

**Billed and metered units will not match**, and the reasons are structural rather than suspicious:
the meter read date is not the bill period boundary, sub-meters do not sum to the main, and DG units
appear on no bill at all. `[DECIDED]` **The gap is reported with its likely reasons listed and it is
never explained away.** A reconciliation that always balances is a reconciliation that is adjusting
something.

**The one genuinely actionable line is the power factor.** A PF penalty is a pure avoidable cost with
a known fix (capacitors), it is often several thousand rupees a month, and most small factory owners
do not read that line of the bill. Surfacing it is worth more than the energy-per-unit figure and it
costs one column.

### 9.5 Anomaly detection

The brief's example — *"Saturday consumption was 3x normal with zero production logged"* — is exactly
right in shape and wrong in threshold. `[DECIDED]` **Self-referential, per the standing rule**
(`nexflow-agent.md` §6.5: *"the tenant's own history supplies the norm … never a hardcoded
plausibility table"*):

```
  for each meter, each day:
    peer_set   = the trailing 90 days of days with the SAME production status
                 (produced / did not produce) AND the same day-of-week class
                 (working / weekly-off / holiday)
    baseline   = median(peer_set)
    dispersion = median absolute deviation(peer_set)
    anomaly   <=> |units - baseline| > 3 x dispersion
                  AND |units - baseline| > 0.25 x baseline
```

Two conditions, both required — the same two-test shape `nexflow-intelligence.md` §5.3 uses, and for
the same reason: a dispersion test alone fires constantly on a very steady meter.

**The zero-production case is the one worth naming separately** because it is the one with a plausible
explanation an owner can act on: consumption on a day with no `p2_production_progress`, no `present`
attendance and no `p2_asset_runtime`. That is either a machine left running, a load nobody knows
about, or someone in the building — and all three are worth a look.

**It is a digest line, not a push** (W14). And it is phrased by the model and decided by SQL —
`nexflow-intelligence.md` I11, unchanged.

### 9.6 Edge cases

| Case | Behaviour |
|---|---|
| Reading missed for three days | The delta spans three days and is attributed across them **pro rata, labelled estimated**, never dumped on the day of the reading |
| Sub-meters exceed the main | Reported as a reconciliation exception. Usually a CT-ratio multiplier entered wrong |
| No `rated_kw` on a machine | Method 2 unavailable for that machine; falls to method 3 for anything it ran |
| Solar or captive generation | `utility_type = 'solar'` meter, netted in the reconciliation. Not modelled further — net metering settlement is a tariff question `[NEVER]`, §17 item 18 |
| Bill covers two months | Split pro rata by metered units where readings exist; otherwise by days, labelled |

---

## 10. Gate, Safety and Compliance Registers

### 10.1 Why these are one section

They are the registers **an inspector reads**, and they share one property that none of the other
modules has: **their value is almost entirely at a moment nobody chose.** Nobody opens a visitor
register on a Tuesday. Nobody reviews extinguisher inspections for pleasure. They matter on the day
someone from the Directorate of Industrial Safety and Health, the MPCB or the fire department walks
in — and on that day they matter completely.

`nexflow-intelligence.md` §7 already builds the report that assembles this for an inspection. **This
section supplies four of the sections that report currently cannot fill**, and §11.1 item 7 names the
amendment.

### 10.2 Vehicle and visitor log — one table, two registers

`[DECIDED]` **One `p2_gate_log` table with `entry_type IN ('vehicle','visitor','both')`, rendered as
two registers by two views.**

A truck driver is a visitor who arrived in a vehicle. Forcing two rows for one arrival means two
sign-outs, two chances to leave one open, and a pair of registers that disagree about when the truck
left. **One physical event, one row.** The two registers an inspector expects are
`v_p2_vehicle_register` and `v_p2_visitor_register` over the same rows.

| Column | Note |
|---|---|
| `entry_type` | vehicle · visitor · both |
| `in_at` / `out_at` | `out_at` NULL means still inside. **The count of NULLs is the useful number** |
| `vehicle_number`, `driver_name`, `transporter` | Vehicle side |
| `visitor_name`, `visitor_company`, `purpose`, `whom_meeting`, `id_proof_type`, `id_proof_last4` | Visitor side. **Last four digits only** — §10.8 |
| `goods_description`, `direction` | `inward · outward · none` |
| `grn_no`, `dispatch_order_id`, `gate_pass_id` | The document this movement belongs to. All nullable |
| `recorded_by` | `auth.uid()` |

**An entry left open overnight is a digest line**, because that is what actually happens: a truck
leaves and nobody signs it out. A register full of vehicles that never left is a register nobody
believes.

### 10.3 Gate passes — a numbered document, because gaps in it matter

A gate pass is what goes out **without a challan**: a sample to a customer, a machine to a repairer,
a returnable die, a tool a contractor brought in and is taking back.

`[DECIDED]` **`p2_gate_passes` carries its own per-tenant number series**, drawn from a row-locked
counter in the same shape as `get_next_grn_number` and `get_next_invoice_number` `[VERIFIED]`, with
`GP-YYMM-NNNN` and the IST stamp fix `get_next_invoice_number` already needed `[VERIFIED]`.

**Why a real series and not a uuid:** an inspector counts them, and a gap in a document series is a
question. The same gap detection `export.html`'s Table 13 already performs for challans applies
`[VERIFIED — Session 11]`, and §11.1 item 7 extends the shared extraction
`nexflow-intelligence.md` §14.1 P3 already requires.

`is_returnable` plus `expected_return_date` produces the only alert this register generates: **a
returnable item past its return date.** That is a real and frequently expensive loss — a die at a
vendor for eight months is a die nobody remembers.

### 10.4 The expiry tracker — the cheapest high-value thing in this document

`p2_compliance_documents`: one row per document the factory must hold, with an expiry date.

```
  factory_licence          Factories Act s.6, renewed periodically
  consent_to_operate       Water Act 1974 s.25/26, Air Act 1981 s.21, MPCB
  consent_to_establish     MPCB
  fire_noc                 Maharashtra Fire Prevention and Life Safety Measures Act 2006
  hazardous_waste_auth     Hazardous Waste Rules 2016, where applicable
  electrical_inspection    CEA periodic certificate  [UNVERIFIED - 18 Q1]
  pressure_vessel_cert     Factories Act s.31
  lifting_tackle_cert      Factories Act s.29
  hoist_lift_cert          Factories Act s.28
  weighing_scale_stamping  Legal Metrology, annual
  pollution_analysis       periodic stack / effluent analysis reports
  insurance                from p2_insurance_policies (6.2)
  other                    free text, because this list is not complete anywhere
```

**One table, one cron, one report section, three alert thresholds — 60, 30 and 7 days.** It is a
fraction of a session and it is the only thing in this module that can prevent a factory being shut.

`[RECOMMENDED]` **Build it in session 10, with the asset register, not in session 16 with the rest of
safety.** §14.3 orders it that way. A lapsed Consent to Operate is an immediate closure and it is the
single highest-consequence date in an MIDC factory's year.

**This is one of the four things that may push** (W14), and the reason is in the rule: there is no
recovering from having missed it.

### 10.5 Safety equipment and inspections

`p2_safety_equipment` — extinguishers by type and location, first-aid boxes, PPE stock, eyewash
stations, fire hydrants, alarms — each with an inspection interval and, where it applies, a refill or
expiry date.

`p2_safety_inspections` — one row per inspection of one item or one round, with the result and who
did it.

Two statutory anchors worth encoding as defaults `[UNVERIFIED — §18 Q1]`:

- **First aid: one box per 150 workers, and an ambulance room above 500** (Factories Act s.45). The
  count is derivable from `p2_workers` and a factory below the ratio should be told.
- **Fire extinguishers: monthly visual inspection is the accepted practice** (IS 2190), with refill
  and hydrostatic-test intervals by type. Encode the intervals per type in the rate table, not in
  code.

**The most useful single screen is a location map in text**: extinguishers by bay, with their next
due date. That is what an inspector walks around with.

### 10.6 Incidents and accidents

`p2_incidents` — date and time, location, description, the person injured (nullable — a near miss has
none), injury type, whether work was lost and for how long, immediate action, and the investigation.

**One field carries the statutory weight: `is_reportable`.** Factories Act s.88 requires notice to
the Inspector of an accident causing death or bodily injury preventing a worker from working for
**48 hours or more**, and s.89 covers notifiable dangerous occurrences and diseases. `[UNVERIFIED —
§18 Q1]` on the exact current thresholds and forms.

`[DECIDED]` **Nexflow computes a `reportable_suggested` flag from the recorded facts, shows it
prominently, and never files anything.** W12 and W2 together: it says *"this looks reportable under
s.88 — the notice period is short"* and it does not say *"reported"*, because reporting is an act
performed by the occupier.

**This is the second of the four things that may push** (W14), and it is the only one where the
push is measured in hours.

**Near misses are recorded and are worth more than accidents**, because they are the only leading
indicator in this entire document. `incident_type IN ('near_miss','first_aid','lost_time','reportable','dangerous_occurrence')`,
and a near-miss row is one tap.

### 10.7 Safety training

`p2_safety_trainings` and `p2_safety_training_attendees` — topic, date, trainer, duration, and who
attended. A worker's training history is one query and it is what an inspector asks for when
something has gone wrong.

`next_due_date` per training type per worker gives the one useful alert: **a worker operating a
machine whose training has lapsed.**

**§15.6 is honest about what this is worth:** a training record says a name was on a list. It does
not say anybody learned anything, and no register has ever prevented an accident.

### 10.8 What this section does not claim, and one thing it deliberately does not store

**W12 governs all of it.** Nexflow records dates and events. It does not certify, does not interpret
a regulation, does not assert compliance, and does not file a statutory notice. The disclaimer is a
code constant on every screen in this section, never model-authored — the same rule
`nexflow-intelligence.md` §7.4 applies to the inspection report.

**And one deliberate omission: a visitor's full identity document number is not stored.**
`id_proof_last4` only, plus the type. A visitor register holding several thousand full Aadhaar or
driving licence numbers is a personal-data liability an MIDC factory has no way to discharge and no
reason to accept, and the register's actual purpose — proving who was on site — is served by a name,
a company, a time and a partial identifier. **This is the same minimal-data reasoning
`factory-os.md` §4.1 applies to workers**, extended to people who are not even employees.

---
## 11. The P1 ↔ P2 Integration Spec

**P2 is the shipped product** — inventory, challans, invoices, GST surfaces, the filing package, the
`p2_` codebase that has been live since 2026. **P1 is the factory floor** — `factory-os.md` Part 1
and this document. The two halves talk through named columns, and this section names all of them.

**Every integration below is optional at the column level.** Each new FK is nullable and NULL means
today's behaviour exactly. That is the Type A guarantee (`kpml-network-plan.md` §2) and §19.7 item
55 tests it.

### 11.1 Data that flows P1 → P2

**1. Monthly salary payable → the filing package**

```
  SOURCE   p2_payroll_runs WHERE status='finalised' AND period_month = <package month>
           .total_gross  .total_net_payable  .total_employee_deductions
           .worker_count .rate_set_version
  ALSO     p2_payroll_lines, per worker, for the register sheet

  TARGET   supabase/functions/filing-package/index.ts -> processTenant()
           new zip entry:  payroll-register-{YYYY-MM}.xlsx
           gated on p2_tenant_settings.payroll_enabled AND a finalised run existing
```

**`[DECIDED]` This is a CA input for the books. It is not a GST surface and it must never touch
one.** Salary is not an inward supply, carries no ITC, and appears in no GSTR. Three consequences
that are easy to get wrong:

- It goes in the zip as its own file. **It does not go into `gstr1-reference-{YYYY-MM}.xlsx`, the
  purchase register, or the Tally XML's Purchase vouchers.**
- `fetchCoveringNoteData` gains payroll fields for the Opus note — but only **exception** counts
  (workers with no wage structure, lines that hit the deduction cap, a period with no finalised
  run). Not the payroll itself. `nexflow-intelligence.md` I6's bounding rule.
- The covering note must not compute anything about payroll. `nexflow-intelligence.md` I2.

**2. PF / ESI / PT liability → the filing package**

```
  SOURCE   p2_payroll_runs  .total_employee_pf .total_employer_epf .total_eps
                            .total_edli .employer_pf_admin      <- run-level (5.4 step 13)
                            .total_employee_esi .total_employer_esi
                            .total_pt .total_lwf
                            .rate_set_version
  TARGET   new zip entry:  statutory-liability-{YYYY-MM}.xlsx
           one sheet per statute, §5.7's shape, with due dates from p2_statutory_rates
```

**Two rules.** The rate set version and the full applied-rate list ship in the file, so a CA who
disagrees can see what was used without asking. And **the employer's own professional tax under its
Enrolment Certificate is a separate annual line**, not a per-worker deduction — §0 C3.

**3. Scrap sale → a revenue entry**

```
  p2_scrap_disposals.dispatch_order_id  -> p2_dispatch_orders  -> the existing
                                           invoice path, unchanged
  p2_scrap_disposals.disposal_route     -> 'sale' | 'scrap_return' | 'direct_supply_s143_5'
```

**The branch in §8.3 is enforced here, in code, not by convention.** A disposal whose
`p2_scrap_records.owned_by IS NOT NULL` and whose `disposal_route = 'sale'` is **refused**, naming
the principal, with §8.3's s.143(5) note. Route `scrap_return` produces a dispatch with
`movement_purpose = 'scrap_return'`, which flows unchanged into **ITC-04 Table 5B**, already built
`[VERIFIED — Session 8]`.

**4. Asset depreciation → the CA's annual accounts**

```
  SOURCE   v_p2_depreciation_schedule  (6.4)  -- both regimes, side by side
  TARGET   the MARCH filing package only, plus an on-demand download on export.html
           new zip entry:  depreciation-schedule-FY{YYYY-YY}.xlsx
  NEVER    posted, journalised, or synced by the Bridge Agent
```

`bridge-agent.md`'s sync is driven from `p2_invoices` only `[VERIFIED — its §0 corrections]`. **Adding
depreciation to it is out of scope and stays that way** — §17 item 6.

**5. Energy cost → Intelligence's contribution analysis**

```
  NEW AGGREGATOR  nx_energy_cost_per_unit(p_tenant_id, p_from, p_to)
                  in supabase/functions/_shared/intelligence.ts  (its own contract, I4)
                  returns: units, cost, apportionment_method, per-product estimate

  AMENDS          nexflow-intelligence.md §3.9  nx_client_contribution
                  RETURNS TABLE gains:
                      energy_value_estimate  numeric
                      energy_basis           text   -- 'sub_meter'|'machine_runtime'|'output_prorata'
  AMENDS          nexflow-intelligence.md §12.4's exclusion string
                  "labour, power, machine time, consumables, overhead, rent"
                    -> "labour, machine time, consumables, overhead, rent"
                  and the header becomes "after material and energy only"
```

**The estimate label travels with the number** (W11) and is carried on `coverage.caveats`, per that
document's §3.1 — *"a disclaimer chosen by the renderer is a disclaimer that goes missing when a new
renderer is added."*

**6. Attendance → the working-day rate**

`nexflow-intelligence.md` §3.2's `nx_working_day_rate` derives a working-day pattern from *distinct
dates with any stock transaction*, explicitly because no attendance record existed. §1.4: once §3
ships, there is a real one.

```
  AMENDS  nx_working_day_rate(p_tenant_id, p_as_of)
          IF p2_tenant_settings.attendance_enabled AND >= 30 days of attendance_days:
              rate from COUNT(DISTINCT attendance_date WHERE status <> 'weekly_off')
          ELSE: today's transaction-derived fallback, unchanged
          -> and coverage.caveats says which was used
```

This makes every days-of-cover, consumption-rate and capacity figure in
`nexflow-intelligence.md` §3 more accurate, for free, on the day attendance goes live.

**7. Gate, safety and compliance → the inspection report**

`nexflow-intelligence.md` §7.2 defines six sections and **section 6 currently ships empty**, saying
quality is not recorded digitally. This document fills four more:

```
  AMENDS nexflow-intelligence.md §7.2's section list, adding:
    7. Gate and visitor register, period-scoped   p2_gate_log        never a model
    8. Gate passes issued, with gap detection     p2_gate_passes     never a model
    9. Statutory documents and expiry dates       p2_compliance_documents
   10. Safety: equipment, inspections, incidents  p2_safety_*        never a model
  AND extends §14.1 P3's shared gap-detection extraction to cover the
      gate-pass series alongside the challan series.
```

**8. Payroll and attendance → the 7pm owner report**

New sections on `factory-os.md` §8's existing message (W14). No new message, no second cron.

### 11.2 Data that flows P2 → P1

**1. A GRN arrival pre-fills, and is pre-filled by, the gate log**

```
  AT THE GATE   p2_gate_log row, direction='inward', vehicle + driver + transporter,
                supplier_id where the gatekeeper knows it, out_at NULL

  AT THE GRN    grn.html offers OPEN inward gate entries for the same day.
                Selecting one pre-fills supplier, vehicle number, arrival time.
                On submit, writes p2_gate_log.grn_no.

  TOUCH POINTS  grn.html          submitGrnTransactions()   [VERIFIED - grn.html:825]
                scanner.html      confirmGRN()
                agent-query       confirm_agent_grn_v3  gains p_gate_log_id uuid
                                  DEFAULT NULL   (nexflow-agent.md §5.2)
```

**Nullable everywhere. A GRN with no gate entry behaves exactly as today**, which matters because
`scanner.html`'s path is used by storekeepers on phones and must not gain a required field.

**2. A production order is assigned to a machine**

```
  AMENDS factory-os.md §11.2:
    ALTER TABLE p2_production_orders
      ADD COLUMN asset_id uuid REFERENCES p2_assets(id);      -- nullable
    CREATE INDEX p2_production_orders_asset_idx
      ON p2_production_orders (tenant_id, asset_id) WHERE asset_id IS NOT NULL;

  CONSUMERS  p2_asset_runtime.production_order_id  (7.3)
             §7.4's downtime-overlap line on the daily report
             §9.3's machine_runtime energy apportionment
```

**3. A dispatch pre-fills an outward gate entry**

```
  ON CONFIRM   offer a p2_gate_log row, direction='outward', pre-filled with
               client_name, challan_number, dispatch_order_id
  TOUCH POINTS dispatch.html, rm-dispatch.html, production-issue.html
               confirm_production_dispatch  (factory-os.md §11.9)
```

**`[UNVERIFIED — §18 Q6]` `p2_dispatch_orders` may have no `vehicle_number` column.**
`nexflow-agent.md` §7.3's `propose_dispatch` tool schema carries a `vehicle_number` field, which
suggests it is planned rather than present. **Confirm before building:**

```sql
SELECT column_name FROM information_schema.columns
 WHERE table_name = 'p2_dispatch_orders' AND column_name = 'vehicle_number';
```

If absent, the gate row holds the vehicle number alone and the dispatch does not gain a column for
it — a gate log is the right place for a truck number and adding it to a challan header is a
separate decision with a Rule 55 dimension.

**4. Attendance gates worker assignment**

```
  AMENDS factory-os.md §4.5 / assign_production_work:
    when attendance_enabled, assigning work to a worker marked 'absent' or 'leave'
    for that date WARNS with the status. It does NOT block.
```

**It warns and does not block, deliberately.** A supervisor assigning tomorrow's work today is the
normal case and tomorrow has no attendance yet. And a worker marked absent who then turns up is a
Tuesday.

**5. The Tooling Register links to the asset register**

`p2_dispatch_orders.asset_tag` already exists for exempt tooling sent out `[VERIFIED — Session 3]`.
`[RECOMMENDED]` match it to `p2_assets.asset_code` on display, so *"where is die KS4-D2"* is answered
by one screen whether the die is on the floor or at a vendor. **Display-only matching, no FK** — the
existing column is free text with live data in it and constraining it retroactively would fail on
rows nobody can now correct.

### 11.3 Shared tables

**`p2_workers`** — defined in `factory-os.md` §11.1, used by both halves.

```
  FACTORY OS PART 1        assignment, progress attribution, the work.html token
  P1 PART 2                attendance, leave, payroll, training, incidents
```

**`[DECIDED]` `p2_workers` moves into a shared foundation migration** so that §3 and §5 can ship
without §11 of `factory-os.md`. It is the same DDL; only the file it lives in changes. Whichever
document's session runs first creates it, and the second checks for it — the migration is written
`CREATE TABLE IF NOT EXISTS` with the columns below added by a separate idempotent `ALTER`.

**Columns this document adds to `p2_workers`** (amending `factory-os.md` §11.1):

```sql
ALTER TABLE p2_workers
  ADD COLUMN IF NOT EXISTS date_of_joining date,
  ADD COLUMN IF NOT EXISTS date_of_leaving date,
  ADD COLUMN IF NOT EXISTS biometric_id    text,     -- the PIN enrolled on the device
  ADD COLUMN IF NOT EXISTS department      text,
  ADD COLUMN IF NOT EXISTS designation     text,
  ADD COLUMN IF NOT EXISTS employment_type text
    CHECK (employment_type IS NULL OR employment_type IN
           ('permanent','contract','apprentice','trainee','casual'));

CREATE UNIQUE INDEX IF NOT EXISTS p2_workers_biometric_idx
  ON p2_workers (tenant_id, biometric_id) WHERE biometric_id IS NOT NULL;
```

**And what it deliberately does NOT add: UAN, ESIC IP number, PAN, bank account, date of birth,
gender.** Those go to `p2_worker_payroll_identity` under W6, with a narrower policy, unreachable
from the `work-view` token endpoint. `factory-os.md` §4.1's minimal-data decision survives intact.

**`p2_production_orders`** — `factory-os.md` §11.2. Gains `asset_id` (§11.2 item 2). Read by §8's
yield variance and §9.3's energy attribution. **Never read by anything in §5** (W1).

**`p2_product_bom`** — live table. Gains `expected_scrap_pct numeric NULL` (§8.2). Nullable, no
default, never backfilled.

### 11.4 What never crosses to a principal — the sharpest boundary in the product

`factory-os.md` F10 forbids worker identity crossing a tenant boundary. **This document makes that
rule carry far more weight**, because it introduces wages, attendance rates, training records and
incident reports — and every one of them is something a principal would find useful and has no right
to.

`[DECIDED]` **`get_principal_vendor_production()` and every other principal-facing RPC return
nothing from any table in this document. Not filtered — not joined.**

| A principal must never learn | Not even as |
|---|---|
| How many people work at a vendor | A headcount, a shift size, a "capacity" figure |
| Whether a vendor's workers were present | An attendance rate, an absenteeism figure, a "reliability" score |
| What a vendor pays anybody | Any wage figure, aggregate or otherwise |
| A vendor's safety or incident history | An incident count, a training record, a compliance status |
| A vendor's machine breakdowns | A downtime figure, a utilisation percentage |
| A vendor's energy cost | Any per-unit cost — it is a cost structure |

**`factory-os.md` §9.6's single argued exception — `projected_date` — is not widened by this
document.** A date may cross. Nothing that explains the date may cross, and **every new table here
is an explanation.** A future session proposing *"show KPML whether the vendor had staff this week,
it explains the delay"* is proposing failure mode 1 in `factory-os.md` §9.5 wearing a helpful hat,
and the answer is no.

§19.6 item 47 asserts it on the RPC's returned column list, not on its values.

### 11.5 Every amendment this document requires to a sibling document

**A session that builds any part of this must make these edits in the same session.** A design
document that contradicts a shipped module is worse than no design document.

| Document | Section | Amendment | Required by |
|---|---|---|---|
| `factory-os.md` | F11, §16 item 3, §10 item 9 | Narrow "never computes pay" to "never computes pay **from production output**" | §0 C1 |
| `factory-os.md` | §4.1 | Reinforce the minimal-data note, pointing at `p2_worker_payroll_identity` | W6 |
| `factory-os.md` | §11.1 | `p2_workers` gains six columns and moves to a shared migration | §11.3 |
| `factory-os.md` | §11.2 | `p2_production_orders` gains `asset_id` | §11.2 item 2 |
| `factory-os.md` | §11.8 | The three widened CHECKs must include this document's values | §0 C10 |
| `factory-os.md` | §4.5 | Assignment warns on an absent worker | §11.2 item 4 |
| `factory-os.md` | §8.2 | The 7pm report gains payroll, attendance, machine and expiry sections | §11.1 item 8 |
| `nexflow-intelligence.md` | §3.2 | `nx_working_day_rate` reads attendance when available | §11.1 item 6 |
| `nexflow-intelligence.md` | §3.9 | `nx_client_contribution` gains energy columns | §11.1 item 5 |
| `nexflow-intelligence.md` | §12.4 | The exclusion string drops "power" | §11.1 item 5 |
| `nexflow-intelligence.md` | §7.2 | The inspection report gains sections 7–10 | §11.1 item 7 |
| `nexflow-intelligence.md` | §14.1 P3 | The shared gap detector covers the gate-pass series | §10.3 |
| `nexflow-agent.md` | §5.2 | `confirm_agent_grn_v3` gains `p_gate_log_id` | §11.2 item 1 |
| `execution-plan.md` | §3 | The add-on table gains this module's SKU and price | §13 |
| `execution-plan.md` | §4 | The session list gains 24 items | §14 |
| `CLAUDE.md` | Database Tables | 38 new tables documented | §12 |

---

## 12. Schema

**Thirty-eight new tables, four views, fourteen RPCs, four columns on existing tables, three widened
CHECK constraints, and eight new flags on `p2_tenant_settings`.**

**That is larger than the entire existing product's core schema, and §14.1 is honest about what that
means for the session count.**

### 12.1 Conventions — inherited without exception

`p2_` prefix on every table (§0 C9) · `uuid` primary keys with `gen_random_uuid()` · `timestamptz`
for instants and `date` for IST calendar days · **RLS enabled in the same migration that creates the
policy** — the audit's single largest finding was fifteen tables that got a policy and never got
`ENABLE ROW LEVEL SECURITY` `[VERIFIED]` · RLS via `get_my_tenant_id()`, **never `auth.uid()`**, the
known-broken pattern that silently blocks every non-owner staff role · `tenant_id` passed explicitly
by the caller with **no `set_tenant_id()` trigger**, since a trigger deriving from
`get_my_tenant_id()` clobbers a service-role insert's explicit `tenant_id` with NULL `[VERIFIED —
the reasoning already recorded on `p2_notifications`]` · `created_by` holds **`auth.uid()`**, not
`tenant_id` — `CLAUDE.md` Known Open Items #9 is a write-path bug on `p2_dispatch_orders` and every
table created from here on gets it right.

**The standard policy block**, referred to below as `[STANDARD RLS]`, is three command-scoped
policies and no DELETE:

```sql
ALTER TABLE <t> ENABLE ROW LEVEL SECURITY;
CREATE POLICY <t>_select ON <t> FOR SELECT USING (tenant_id = get_my_tenant_id());
CREATE POLICY <t>_insert ON <t> FOR INSERT WITH CHECK (tenant_id = get_my_tenant_id());
CREATE POLICY <t>_update ON <t> FOR UPDATE USING (tenant_id = get_my_tenant_id())
                                          WITH CHECK (tenant_id = get_my_tenant_id());
```

`[APPEND-ONLY RLS]` is the same **without the UPDATE policy** — used where a row is an observation
rather than a state, per `p2_production_progress` and `p2_quality_records` `[VERIFIED]`.

### 12.2 Attendance and shifts — 7 tables

```sql
-- Shift patterns. A schedule, not a timestamp. Factories Act s.61 requires the
-- notice of periods of work to be displayed; this is the data behind it.
CREATE TABLE p2_shifts (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                uuid NOT NULL REFERENCES p2_tenants(id),
  name                     text NOT NULL CHECK (length(trim(name)) > 0),
  start_time               time NOT NULL,
  end_time                 time NOT NULL,
  crosses_midnight         boolean NOT NULL DEFAULT false,   -- derived on save
  days_of_week             smallint[] NOT NULL DEFAULT '{1,2,3,4,5,6}',  -- ISO 1-7
  break_minutes            integer NOT NULL DEFAULT 30 CHECK (break_minutes >= 0),
  grace_minutes            integer NOT NULL DEFAULT 10 CHECK (grace_minutes >= 0),
  full_day_minutes         integer NOT NULL DEFAULT 480 CHECK (full_day_minutes > 0),
  half_day_after_minutes   integer NOT NULL DEFAULT 240 CHECK (half_day_after_minutes > 0),
  late_marks_for_half_day  smallint,          -- NULL = rule off. 3 is common.
  overtime_after_minutes   integer NOT NULL DEFAULT 540,   -- s.54's 9 hours
  holiday_multiplier       numeric(4,2),      -- NULL = ordinary time on a holiday
  is_night_shift           boolean NOT NULL DEFAULT false,
  is_active                boolean NOT NULL DEFAULT true,
  created_by               uuid REFERENCES auth.users(id),
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT p2_shifts_halfday_lt_full CHECK (half_day_after_minutes <= full_day_minutes)
);
-- [STANDARD RLS]
CREATE UNIQUE INDEX p2_shifts_name_idx ON p2_shifts (tenant_id, lower(trim(name)));

-- Worker -> shift, effective-dated. A worker moves shifts; history is preserved.
CREATE TABLE p2_shift_assignments (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES p2_tenants(id),
  worker_id       uuid NOT NULL REFERENCES p2_workers(id),
  shift_id        uuid NOT NULL REFERENCES p2_shifts(id),
  effective_from  date NOT NULL,
  effective_to    date,                       -- NULL = current
  created_by      uuid REFERENCES auth.users(id),
  created_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT p2_shift_assignments_range CHECK (effective_to IS NULL OR effective_to >= effective_from)
);
-- [STANDARD RLS]
CREATE UNIQUE INDEX p2_shift_assignments_current_idx
  ON p2_shift_assignments (worker_id) WHERE effective_to IS NULL;
CREATE INDEX p2_shift_assignments_lookup_idx
  ON p2_shift_assignments (tenant_id, worker_id, effective_from DESC);

-- Registered attendance hardware. A device is a trusted source only after it is
-- registered here -- 3.5 rule 2.
CREATE TABLE p2_attendance_devices (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         uuid NOT NULL REFERENCES p2_tenants(id),
  name              text NOT NULL,            -- "Main gate", "Shed 2 door"
  serial_number     text NOT NULL,            -- printed on the device. NOT a secret.
  device_token      uuid NOT NULL DEFAULT gen_random_uuid(),   -- the path secret (3.5 rule 3)
  vendor            text CHECK (vendor IN ('essl','biomax','realtime','zkteco','matrix','other')),
  protocol          text NOT NULL DEFAULT 'zk_push'
                      CHECK (protocol IN ('zk_push','usb_file','manual')),
  allowed_ip_cidr   cidr,                     -- fallback auth when firmware takes no path
  last_seen_at      timestamptz,
  last_clock_skew_s integer,
  is_active         boolean NOT NULL DEFAULT true,
  created_by        uuid REFERENCES auth.users(id),
  created_at        timestamptz NOT NULL DEFAULT now()
);
-- [STANDARD RLS]
-- Globally unique: the endpoint is unauthenticated and resolves by token alone,
-- with no tenant context. Same reasoning as p2_workers.access_token
-- (factory-os.md §11.1) and p2_dispatch_orders.dispatch_token [VERIFIED].
CREATE UNIQUE INDEX p2_attendance_devices_token_idx  ON p2_attendance_devices (device_token);
CREATE UNIQUE INDEX p2_attendance_devices_serial_idx ON p2_attendance_devices (tenant_id, serial_number);

-- APPEND-ONLY raw events. A device said this. Nobody judged it yet. (W5)
CREATE TABLE p2_attendance_punches (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid NOT NULL REFERENCES p2_tenants(id),
  worker_id        uuid REFERENCES p2_workers(id),   -- NULL = unrecognised enrolment (3.5 rule 6)
  device_id        uuid REFERENCES p2_attendance_devices(id),
  device_user_id   text,                             -- the PIN the device sent
  source           text NOT NULL CHECK (source IN ('device','qr','supervisor','usb_import')),
  punched_at       timestamptz NOT NULL,             -- normalised to the server's view
  device_time      timestamptz,                      -- what the device's own clock said
  received_at      timestamptz NOT NULL DEFAULT now(),
  clock_skew_s     integer,                          -- device_time - received_at
  punch_direction  text CHECK (punch_direction IN ('in','out','unknown')),
  verify_mode_raw  integer,                          -- firmware-specific (3.5)
  verify_mode      text CHECK (verify_mode IN
                     ('fingerprint','card','face','password','qr','manual','unknown')),
  trust            text NOT NULL DEFAULT 'verified'
                     CHECK (trust IN ('verified','unverified')),   -- 3.5 rule 3, 3.7 rule 5
  qr_window_id     uuid,
  geo_lat          numeric(9,6),
  geo_lng          numeric(9,6),
  geo_accuracy_m   numeric(8,1),
  geo_status       text CHECK (geo_status IN ('inside','outside','unusable','denied')),
  raw_payload      text,                             -- the original line, for diagnosis
  created_at       timestamptz NOT NULL DEFAULT now()
);
-- [APPEND-ONLY RLS]  -- no UPDATE, no DELETE. A punch is a fact. (W5)
-- Natural idempotency key: devices resend whole buffers on a lost ack (3.5 rule 5).
CREATE UNIQUE INDEX p2_attendance_punches_dedupe_idx
  ON p2_attendance_punches (tenant_id, device_id, device_user_id, punched_at)
  WHERE device_id IS NOT NULL;
CREATE INDEX p2_attendance_punches_worker_idx
  ON p2_attendance_punches (tenant_id, worker_id, punched_at);
CREATE INDEX p2_attendance_punches_unmatched_idx
  ON p2_attendance_punches (tenant_id, received_at) WHERE worker_id IS NULL;

-- ONE ROW PER (worker, date). The DECISION. (W5)
CREATE TABLE p2_attendance_days (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         uuid NOT NULL REFERENCES p2_tenants(id),
  worker_id         uuid NOT NULL REFERENCES p2_workers(id),
  attendance_date   date NOT NULL,             -- the SHIFT START date (3.2)
  shift_id          uuid REFERENCES p2_shifts(id),
  status            text NOT NULL DEFAULT 'absent'
                      CHECK (status IN ('present','absent','half_day','leave',
                                        'holiday','weekly_off','on_duty')),
  leave_type_id     uuid,                      -- set only when status = 'leave'
  is_paid           boolean NOT NULL DEFAULT true,   -- false = LWP / unpaid leave
  first_in_at       timestamptz,
  last_out_at       timestamptz,
  worked_minutes    integer NOT NULL DEFAULT 0 CHECK (worked_minutes >= 0),
  ot_minutes        integer NOT NULL DEFAULT 0 CHECK (ot_minutes >= 0),
  ot_disposition    text NOT NULL DEFAULT 'pay' CHECK (ot_disposition IN ('pay','comp_off','none')),
  ot_reason         text,
  late_minutes      integer NOT NULL DEFAULT 0 CHECK (late_minutes >= 0),
  early_minutes     integer NOT NULL DEFAULT 0 CHECK (early_minutes >= 0),
  source            text NOT NULL DEFAULT 'default'
                      CHECK (source IN ('device','qr','supervisor','leave','default','import')),
  is_exception      boolean NOT NULL DEFAULT false,   -- lands on 3.3's list
  exception_reason  text,
  locked_by_run_id  uuid,                      -- set on payroll finalisation (W4)
  decided_by        uuid REFERENCES auth.users(id),
  notes             text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT p2_attendance_days_leave_type
    CHECK (status <> 'leave' OR leave_type_id IS NOT NULL)
);
-- [STANDARD RLS]
CREATE UNIQUE INDEX p2_attendance_days_key_idx
  ON p2_attendance_days (tenant_id, worker_id, attendance_date);
CREATE INDEX p2_attendance_days_period_idx
  ON p2_attendance_days (tenant_id, attendance_date, status);
CREATE INDEX p2_attendance_days_exceptions_idx
  ON p2_attendance_days (tenant_id, attendance_date) WHERE is_exception;
CREATE INDEX p2_attendance_days_unlocked_idx
  ON p2_attendance_days (tenant_id, attendance_date) WHERE locked_by_run_id IS NULL;

-- Every edit to a decided day. This is the record a worker disputes. (W5)
CREATE TABLE p2_attendance_day_changes (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         uuid NOT NULL REFERENCES p2_tenants(id),
  attendance_day_id uuid NOT NULL REFERENCES p2_attendance_days(id),
  changed_from      jsonb NOT NULL,
  changed_to        jsonb NOT NULL,
  reason            text,
  changed_by        uuid REFERENCES auth.users(id),
  created_at        timestamptz NOT NULL DEFAULT now()
);
-- [APPEND-ONLY RLS]
CREATE INDEX p2_attendance_day_changes_day_idx ON p2_attendance_day_changes (attendance_day_id);

-- Rotating geo-QR windows. A row per window makes photo-and-share visible (3.6).
CREATE TABLE p2_attendance_qr_windows (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES p2_tenants(id),
  code          text NOT NULL,
  valid_from    timestamptz NOT NULL,
  valid_until   timestamptz NOT NULL,
  geofence_lat  numeric(9,6),
  geofence_lng  numeric(9,6),
  geofence_m    integer NOT NULL DEFAULT 150,
  scan_count    integer NOT NULL DEFAULT 0,
  created_at    timestamptz NOT NULL DEFAULT now()
);
-- [STANDARD RLS]
CREATE UNIQUE INDEX p2_attendance_qr_windows_code_idx ON p2_attendance_qr_windows (code);
CREATE INDEX p2_attendance_qr_windows_live_idx
  ON p2_attendance_qr_windows (tenant_id, valid_until DESC);
```

### 12.3 Leave — 3 tables

```sql
-- Tenant-configured. statutory_basis is the column that stops CL/SL/EL looking
-- identical on a screen an inspector might read (4.2).
CREATE TABLE p2_leave_types (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                uuid NOT NULL REFERENCES p2_tenants(id),
  code                     text NOT NULL,          -- 'EL','CL','SL','ML','COMP'
  name                     text NOT NULL,
  statutory_basis          text CHECK (statutory_basis IN
                             ('factories_act_s79','maternity_benefit_act',
                              'shops_establishments_act','factories_act_s53','policy')),
  accrual_method           text NOT NULL DEFAULT 'annual_grant'
                             CHECK (accrual_method IN ('annual_grant','earned_from_attendance',
                                                       'monthly_grant','none')),
  annual_days              numeric(5,2),
  is_paid_by_employer      boolean NOT NULL DEFAULT true,   -- false for ESI sickness (4.5)
  counts_as_worked_for_el  boolean NOT NULL DEFAULT false,  -- 4.3
  carry_forward_cap_days   numeric(5,2),
  is_encashable            boolean NOT NULL DEFAULT false,
  is_active                boolean NOT NULL DEFAULT true,
  created_at               timestamptz NOT NULL DEFAULT now()
);
-- [STANDARD RLS]
CREATE UNIQUE INDEX p2_leave_types_code_idx ON p2_leave_types (tenant_id, upper(trim(code)));

-- Append-only. Balance = SUM. (W7)
CREATE TABLE p2_leave_ledger (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES p2_tenants(id),
  worker_id       uuid NOT NULL REFERENCES p2_workers(id),
  leave_type_id   uuid NOT NULL REFERENCES p2_leave_types(id),
  entry_type      text NOT NULL CHECK (entry_type IN ('accrual','consumption','lapse','encashment','opening')),
  days            numeric(6,2) NOT NULL CHECK (days <> 0),   -- + adds, - consumes
  effective_date  date NOT NULL,
  leave_year      smallint NOT NULL,
  request_id      uuid,
  payroll_run_id  uuid,
  notes           text,                                      -- carries the computation
  created_by      uuid REFERENCES auth.users(id),
  created_at      timestamptz NOT NULL DEFAULT now()
);
-- [APPEND-ONLY RLS]
CREATE INDEX p2_leave_ledger_balance_idx
  ON p2_leave_ledger (tenant_id, worker_id, leave_type_id, leave_year);
CREATE UNIQUE INDEX p2_leave_ledger_accrual_idx
  ON p2_leave_ledger (tenant_id, worker_id, leave_type_id, leave_year)
  WHERE entry_type = 'accrual';      -- accrue_annual_leave is idempotent (4.3)

CREATE TABLE p2_leave_requests (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES p2_tenants(id),
  worker_id       uuid NOT NULL REFERENCES p2_workers(id),
  leave_type_id   uuid NOT NULL REFERENCES p2_leave_types(id),
  from_date       date NOT NULL,
  to_date         date NOT NULL,
  from_half_day   boolean NOT NULL DEFAULT false,
  to_half_day     boolean NOT NULL DEFAULT false,
  days_requested  numeric(5,2) NOT NULL CHECK (days_requested > 0),
  reason          text,
  status          text NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending','approved','rejected','cancelled')),
  decided_by      uuid REFERENCES auth.users(id),
  decided_at      timestamptz,
  decision_note   text,
  requested_by    uuid REFERENCES auth.users(id),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT p2_leave_requests_range CHECK (to_date >= from_date)
);
-- [STANDARD RLS]
CREATE INDEX p2_leave_requests_pending_idx
  ON p2_leave_requests (tenant_id, status, from_date) WHERE status = 'pending';
CREATE INDEX p2_leave_requests_worker_idx ON p2_leave_requests (tenant_id, worker_id, from_date DESC);
```

### 12.4 Payroll — 8 tables

```sql
-- W6: narrower than p2_workers. Owner and accountant only. NEVER read by work-view.
CREATE TABLE p2_worker_payroll_identity (
  worker_id        uuid PRIMARY KEY REFERENCES p2_workers(id),
  tenant_id        uuid NOT NULL REFERENCES p2_tenants(id),
  date_of_birth    date,
  gender           text CHECK (gender IN ('male','female','other')),   -- PT slab (C3), s.66
  uan              text,                    -- PF Universal Account Number
  pf_status        text NOT NULL DEFAULT 'member'
                     CHECK (pf_status IN ('member','excluded','voluntary','not_applicable')),
  esic_ip_number   text,
  pan              text,
  bank_account_no  text,
  bank_ifsc        text,
  bank_name        text,
  created_by       uuid REFERENCES auth.users(id),
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE p2_worker_payroll_identity ENABLE ROW LEVEL SECURITY;
-- NOT the standard block. Narrower by design (W6): the role check is inside the
-- policy because this table carries a worker's bank account.
CREATE POLICY p2_worker_payroll_identity_select ON p2_worker_payroll_identity
  FOR SELECT USING (tenant_id = get_my_tenant_id()
                    AND get_my_role() IN ('owner','accountant'));
CREATE POLICY p2_worker_payroll_identity_insert ON p2_worker_payroll_identity
  FOR INSERT WITH CHECK (tenant_id = get_my_tenant_id()
                         AND get_my_role() IN ('owner','accountant'));
CREATE POLICY p2_worker_payroll_identity_update ON p2_worker_payroll_identity
  FOR UPDATE USING (tenant_id = get_my_tenant_id()
                    AND get_my_role() IN ('owner','accountant'))
             WITH CHECK (tenant_id = get_my_tenant_id());
CREATE INDEX p2_worker_payroll_identity_tenant_idx ON p2_worker_payroll_identity (tenant_id);

-- GLOBAL. NO tenant_id. One row set, maintained by the founder. (W3)
CREATE TABLE p2_statutory_rates (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rate_set        text NOT NULL,            -- 'v2026.1'
  jurisdiction    text NOT NULL DEFAULT 'IN',   -- 'IN' | 'IN-MH'
  parameter       text NOT NULL,            -- 'epf.employee_pct', 'pt.mh.slab', ...
  value_numeric   numeric(14,4),
  value_json      jsonb,                    -- slab tables, block rates, due-date rules
  unit            text,                     -- 'pct' | 'inr' | 'inr_per_month' | 'days'
  effective_from  date NOT NULL,
  effective_to    date,
  source_note     text NOT NULL,            -- the notification or section it comes from
  confirmed_by    text,                     -- the CA who signed it off (5.9)
  confirmed_on    date,
  created_at      timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE p2_statutory_rates ENABLE ROW LEVEL SECURITY;
-- Read by every tenant, written by nobody through the app.
CREATE POLICY p2_statutory_rates_select ON p2_statutory_rates FOR SELECT USING (true);
REVOKE INSERT, UPDATE, DELETE ON p2_statutory_rates FROM authenticated, anon;
CREATE UNIQUE INDEX p2_statutory_rates_key_idx
  ON p2_statutory_rates (rate_set, jurisdiction, parameter, effective_from);
CREATE INDEX p2_statutory_rates_lookup_idx
  ON p2_statutory_rates (parameter, jurisdiction, effective_from DESC);

-- Tenant-scoped. ONLY what is genuinely the factory's choice. (W3 part 2)
CREATE TABLE p2_payroll_policies (
  tenant_id                     uuid PRIMARY KEY REFERENCES p2_tenants(id),
  period_start_day              smallint NOT NULL DEFAULT 1 CHECK (period_start_day BETWEEN 1 AND 28),
  wage_days_basis               text NOT NULL DEFAULT 'calendar'
                                  CHECK (wage_days_basis IN ('calendar','fixed_26','fixed_30')),
  overtime_multiplier           numeric(4,2) NOT NULL DEFAULT 2.00,   -- floor enforced (C2)
  restrict_pf_to_ceiling        boolean NOT NULL DEFAULT true,
  pf_applicable                 boolean NOT NULL DEFAULT false,
  esi_applicable                boolean NOT NULL DEFAULT false,
  pt_applicable                 boolean NOT NULL DEFAULT true,
  pt_jurisdiction               text NOT NULL DEFAULT 'IN-MH',
  lwf_applicable                boolean NOT NULL DEFAULT false,
  bonus_applicable              boolean NOT NULL DEFAULT false,
  minimum_wage_monthly          numeric(12,2),        -- tenant-supplied (5.5)
  advance_recovery_max_pct_net  numeric(5,2) NOT NULL DEFAULT 25.00,
  pay_by_day_of_month           smallint NOT NULL DEFAULT 7,   -- Payment of Wages Act s.5
  rounding_net                  text NOT NULL DEFAULT 'nearest'
                                  CHECK (rounding_net IN ('nearest','up','down','none')),
  active_rate_set               text NOT NULL DEFAULT 'v2026.1',
  updated_by                    uuid REFERENCES auth.users(id),
  updated_at                    timestamptz NOT NULL DEFAULT now(),
  -- The statutory floor, in the database. C2.
  CONSTRAINT p2_payroll_policies_ot_floor CHECK (overtime_multiplier >= 2.00)
);
-- [STANDARD RLS], keyed on tenant_id as the PK.

-- Effective-dated. Never edited; a change is a new row. (5.3)
CREATE TABLE p2_wage_structures (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES p2_tenants(id),
  worker_id       uuid NOT NULL REFERENCES p2_workers(id),
  wage_basis      text NOT NULL DEFAULT 'monthly' CHECK (wage_basis IN ('monthly','daily')),
  effective_from  date NOT NULL,
  effective_to    date,
  notes           text,
  created_by      uuid REFERENCES auth.users(id),
  created_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT p2_wage_structures_range CHECK (effective_to IS NULL OR effective_to >= effective_from)
);
-- [STANDARD RLS]
CREATE UNIQUE INDEX p2_wage_structures_current_idx
  ON p2_wage_structures (worker_id) WHERE effective_to IS NULL;
CREATE INDEX p2_wage_structures_lookup_idx
  ON p2_wage_structures (tenant_id, worker_id, effective_from DESC);

-- The four different wage bases, as flags. C4, C2, C6.
CREATE TABLE p2_wage_components (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          uuid NOT NULL REFERENCES p2_tenants(id),
  wage_structure_id  uuid NOT NULL REFERENCES p2_wage_structures(id),
  name               text NOT NULL,          -- 'Basic', 'DA', 'HRA', 'Conveyance'
  amount             numeric(12,2) NOT NULL CHECK (amount >= 0),
  sequence           smallint NOT NULL DEFAULT 0,
  is_pf_wage         boolean NOT NULL DEFAULT true,    -- conservative default. C4.
  is_esi_wage        boolean NOT NULL DEFAULT true,
  is_ot_base         boolean NOT NULL DEFAULT true,    -- s.59(2)
  is_bonus_wage      boolean NOT NULL DEFAULT true,
  prorates           boolean NOT NULL DEFAULT true,
  created_at         timestamptz NOT NULL DEFAULT now()
);
-- [STANDARD RLS]
CREATE UNIQUE INDEX p2_wage_components_name_idx
  ON p2_wage_components (wage_structure_id, lower(trim(name)));

-- One per (tenant, period). Finalising is irreversible. (W4)
CREATE TABLE p2_payroll_runs (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                uuid NOT NULL REFERENCES p2_tenants(id),
  period_month             text NOT NULL,        -- 'YYYY-MM', IST
  period_from              date NOT NULL,
  period_to                date NOT NULL,
  status                   text NOT NULL DEFAULT 'draft'
                             CHECK (status IN ('draft','computed','approved','finalised','cancelled')),
  rate_set_version         text,                 -- PINNED at compute. W3.
  wage_days_basis          text,                 -- frozen from policy at compute
  wage_days                numeric(5,2),
  worker_count             integer NOT NULL DEFAULT 0,
  total_gross              numeric(14,2) NOT NULL DEFAULT 0,
  total_employee_deductions numeric(14,2) NOT NULL DEFAULT 0,
  total_net_payable        numeric(14,2) NOT NULL DEFAULT 0,
  total_employee_pf        numeric(14,2) NOT NULL DEFAULT 0,
  total_employer_epf       numeric(14,2) NOT NULL DEFAULT 0,
  total_eps                numeric(14,2) NOT NULL DEFAULT 0,
  total_edli               numeric(14,2) NOT NULL DEFAULT 0,
  employer_pf_admin        numeric(14,2) NOT NULL DEFAULT 0,   -- RUN-LEVEL. 5.4 step 13.
  total_employee_esi       numeric(14,2) NOT NULL DEFAULT 0,
  total_employer_esi       numeric(14,2) NOT NULL DEFAULT 0,
  total_pt                 numeric(14,2) NOT NULL DEFAULT 0,
  total_lwf_employee       numeric(14,2) NOT NULL DEFAULT 0,
  total_lwf_employer       numeric(14,2) NOT NULL DEFAULT 0,
  total_bonus_accrued      numeric(14,2) NOT NULL DEFAULT 0,
  total_ot_amount          numeric(14,2) NOT NULL DEFAULT 0,
  total_arrears            numeric(14,2) NOT NULL DEFAULT 0,
  computed_at              timestamptz,
  approved_by              uuid REFERENCES auth.users(id),
  approved_at              timestamptz,
  finalised_by             uuid REFERENCES auth.users(id),
  finalised_at             timestamptz,
  exception_count          integer NOT NULL DEFAULT 0,
  notes                    text,
  created_by               uuid REFERENCES auth.users(id),
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now()
);
-- [STANDARD RLS]  -- no DELETE. A run is an artefact.
CREATE UNIQUE INDEX p2_payroll_runs_period_idx ON p2_payroll_runs (tenant_id, period_month)
  WHERE status <> 'cancelled';
CREATE INDEX p2_payroll_runs_recent_idx ON p2_payroll_runs (tenant_id, period_from DESC);

-- One per (run, worker, line_type). Every rate FROZEN. (W3)
CREATE TABLE p2_payroll_lines (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id               uuid NOT NULL REFERENCES p2_tenants(id),
  payroll_run_id          uuid NOT NULL REFERENCES p2_payroll_runs(id),
  worker_id               uuid NOT NULL REFERENCES p2_workers(id),
  line_type               text NOT NULL DEFAULT 'regular'
                            CHECK (line_type IN ('regular','arrear','final_settlement')),
  arrear_for_period       text,                 -- 'YYYY-MM' when line_type='arrear'
  paid_days               numeric(5,2) NOT NULL DEFAULT 0,
  unpaid_days             numeric(5,2) NOT NULL DEFAULT 0,
  ot_minutes              integer NOT NULL DEFAULT 0,
  earnings                jsonb NOT NULL DEFAULT '[]',   -- frozen component snapshot
  gross                   numeric(12,2) NOT NULL DEFAULT 0,
  ot_amount               numeric(12,2) NOT NULL DEFAULT 0,
  pf_wages                numeric(12,2) NOT NULL DEFAULT 0,
  employee_pf             numeric(12,2) NOT NULL DEFAULT 0,
  employer_epf            numeric(12,2) NOT NULL DEFAULT 0,
  eps                     numeric(12,2) NOT NULL DEFAULT 0,
  edli                    numeric(12,2) NOT NULL DEFAULT 0,
  esi_wages               numeric(12,2) NOT NULL DEFAULT 0,
  esi_eligibility_basis   jsonb,                -- the wage and date that decided it. C5.
  employee_esi            numeric(12,2) NOT NULL DEFAULT 0,
  employer_esi            numeric(12,2) NOT NULL DEFAULT 0,
  professional_tax        numeric(12,2) NOT NULL DEFAULT 0,
  lwf_employee            numeric(12,2) NOT NULL DEFAULT 0,
  lwf_employer            numeric(12,2) NOT NULL DEFAULT 0,
  advance_recovered       numeric(12,2) NOT NULL DEFAULT 0,
  other_deductions        jsonb NOT NULL DEFAULT '[]',
  total_deductions        numeric(12,2) NOT NULL DEFAULT 0,
  net_payable             numeric(12,2) NOT NULL DEFAULT 0,
  bonus_accrued           numeric(12,2) NOT NULL DEFAULT 0,
  rates_applied           jsonb NOT NULL DEFAULT '{}',   -- every rate used. W3.
  warnings                jsonb NOT NULL DEFAULT '[]',   -- min-wage, deduction-cap, ...
  created_at              timestamptz NOT NULL DEFAULT now()
);
-- [APPEND-ONLY RLS]  -- a recompute DELETES and reinserts at 'computed' only;
-- after 'finalised' the rows are immutable. The delete is done inside the
-- recompute RPC, which is the only holder of that right.
CREATE UNIQUE INDEX p2_payroll_lines_key_idx
  ON p2_payroll_lines (payroll_run_id, worker_id, line_type,
                       COALESCE(arrear_for_period, ''));
CREATE INDEX p2_payroll_lines_worker_idx ON p2_payroll_lines (tenant_id, worker_id, created_at DESC);

-- Advance ledger. Balance = SUM. (5.6)
CREATE TABLE p2_worker_advances (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES p2_tenants(id),
  worker_id       uuid NOT NULL REFERENCES p2_workers(id),
  entry_type      text NOT NULL CHECK (entry_type IN ('advance','recovery','write_off')),
  amount          numeric(12,2) NOT NULL CHECK (amount <> 0),  -- + advance, - recovery
  entry_date      date NOT NULL,
  payroll_run_id  uuid REFERENCES p2_payroll_runs(id),
  payment_mode    text CHECK (payment_mode IN ('cash','bank','upi','adjustment')),
  reason          text,
  created_by      uuid REFERENCES auth.users(id),
  created_at      timestamptz NOT NULL DEFAULT now()
);
-- [APPEND-ONLY RLS]
CREATE INDEX p2_worker_advances_balance_idx ON p2_worker_advances (tenant_id, worker_id);
```

### 12.5 Assets and machines — 7 tables

```sql
-- The single asset master. A machine is a row here, not a second table. (W9)
CREATE TABLE p2_assets (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id             uuid NOT NULL REFERENCES p2_tenants(id),
  asset_code            text NOT NULL,
  name                  text NOT NULL CHECK (length(trim(name)) > 0),
  asset_category        text NOT NULL CHECK (asset_category IN
                          ('machinery','vehicle','computer','furniture','tool',
                           'mould','electrical','building','other')),
  make                  text,
  model                 text,
  serial_number         text,                  -- NO unique constraint. 6.5.
  purchase_date         date,
  put_to_use_date       date,                  -- 6.4 rule 2
  purchase_value        numeric(14,2),
  supplier_id           uuid REFERENCES p2_suppliers(id),
  location_on_floor     text,
  is_production_machine boolean NOT NULL DEFAULT false,
  rated_kw              numeric(8,2),          -- 9.3 method 2
  depreciation_block    text,                  -- Income Tax block key
  useful_life_years     numeric(5,2),          -- Schedule II, companies only
  depreciation_method   text CHECK (depreciation_method IN ('wdv','slm')),
  insurance_policy_id   uuid,
  warranty_until        date,
  status                text NOT NULL DEFAULT 'in_use'
                          CHECK (status IN ('in_use','idle','under_repair','disposed','written_off')),
  disposal_date         date,
  disposal_value        numeric(14,2),
  notes                 text,
  created_by            uuid REFERENCES auth.users(id),
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);
-- [STANDARD RLS]  -- no DELETE. An asset is disposed, never removed.
CREATE UNIQUE INDEX p2_assets_code_idx ON p2_assets (tenant_id, upper(trim(asset_code)));
CREATE INDEX p2_assets_category_idx ON p2_assets (tenant_id, asset_category, status);
CREATE INDEX p2_assets_machines_idx ON p2_assets (tenant_id) WHERE is_production_machine;

CREATE TABLE p2_insurance_policies (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid NOT NULL REFERENCES p2_tenants(id),
  asset_id       uuid REFERENCES p2_assets(id),   -- NULL = covers the factory (6.2)
  insurer        text NOT NULL,
  policy_number  text NOT NULL,
  policy_type    text CHECK (policy_type IN
                   ('fire','burglary','machinery_breakdown','marine','vehicle',
                    'public_liability','workmen_compensation','group_health','other')),
  sum_insured    numeric(14,2),
  premium        numeric(14,2),
  valid_from     date NOT NULL,
  valid_until    date NOT NULL,
  broker_contact text,
  document_url   text,
  created_by     uuid REFERENCES auth.users(id),
  created_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT p2_insurance_policies_range CHECK (valid_until >= valid_from)
);
-- [STANDARD RLS]
CREATE INDEX p2_insurance_policies_expiry_idx ON p2_insurance_policies (tenant_id, valid_until);

CREATE TABLE p2_asset_maintenance_schedules (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          uuid NOT NULL REFERENCES p2_tenants(id),
  asset_id           uuid NOT NULL REFERENCES p2_assets(id),
  schedule_name      text NOT NULL,
  interval_days      integer CHECK (interval_days IS NULL OR interval_days > 0),
  interval_run_hours numeric(10,2) CHECK (interval_run_hours IS NULL OR interval_run_hours > 0),
  last_done_date     date,
  last_done_hours    numeric(12,2),
  next_due_date      date,
  next_due_hours     numeric(12,2),
  instructions       text,
  is_active          boolean NOT NULL DEFAULT true,
  created_at         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT p2_asset_maintenance_schedules_one_interval
    CHECK (interval_days IS NOT NULL OR interval_run_hours IS NOT NULL)
);
-- [STANDARD RLS]
CREATE INDEX p2_asset_maintenance_schedules_due_idx
  ON p2_asset_maintenance_schedules (tenant_id, next_due_date) WHERE is_active;

-- ONE table for service, breakdown, inspection, calibration. (W9)
CREATE TABLE p2_asset_events (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id            uuid NOT NULL REFERENCES p2_tenants(id),
  asset_id             uuid NOT NULL REFERENCES p2_assets(id),
  event_type           text NOT NULL CHECK (event_type IN
                         ('preventive','breakdown','inspection','calibration','modification')),
  schedule_id          uuid REFERENCES p2_asset_maintenance_schedules(id),
  started_at           timestamptz NOT NULL,
  ended_at             timestamptz,                -- NULL = ongoing (7.5)
  downtime_minutes     integer GENERATED ALWAYS AS
                         (CASE WHEN ended_at IS NULL THEN NULL
                               ELSE GREATEST(0, (EXTRACT(EPOCH FROM (ended_at - started_at)) / 60)::int)
                          END) STORED,
  failure_description  text,
  work_done            text,
  parts_used           text,                       -- text, NOT a stock link (7.2)
  cost                 numeric(12,2),
  vendor_name          text,
  run_hours_at_event   numeric(12,2),
  recorded_by          uuid REFERENCES auth.users(id),
  created_at           timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT p2_asset_events_range CHECK (ended_at IS NULL OR ended_at >= started_at)
);
-- [STANDARD RLS]
CREATE INDEX p2_asset_events_asset_idx ON p2_asset_events (tenant_id, asset_id, started_at DESC);
CREATE INDEX p2_asset_events_open_idx   ON p2_asset_events (tenant_id, asset_id) WHERE ended_at IS NULL;
CREATE INDEX p2_asset_events_breakdown_idx
  ON p2_asset_events (tenant_id, started_at) WHERE event_type = 'breakdown';

CREATE TABLE p2_asset_runtime (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           uuid NOT NULL REFERENCES p2_tenants(id),
  asset_id            uuid NOT NULL REFERENCES p2_assets(id),
  runtime_date        date NOT NULL,
  shift_id            uuid REFERENCES p2_shifts(id),
  production_order_id uuid,                   -- FK added in the same migration as asset_id
  hours_run           numeric(8,2) NOT NULL CHECK (hours_run >= 0),
  source              text NOT NULL DEFAULT 'manual'
                        CHECK (source IN ('manual','hour_meter','derived')),
  recorded_by         uuid REFERENCES auth.users(id),
  created_at          timestamptz NOT NULL DEFAULT now()
);
-- [STANDARD RLS]
CREATE INDEX p2_asset_runtime_asset_idx ON p2_asset_runtime (tenant_id, asset_id, runtime_date);
CREATE INDEX p2_asset_runtime_order_idx ON p2_asset_runtime (production_order_id)
  WHERE production_order_id IS NOT NULL;

CREATE TABLE p2_asset_assignments (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid NOT NULL REFERENCES p2_tenants(id),
  asset_id       uuid NOT NULL REFERENCES p2_assets(id),
  department     text,
  worker_id      uuid REFERENCES p2_workers(id),
  user_id        uuid REFERENCES auth.users(id),
  effective_from date NOT NULL,
  effective_to   date,
  notes          text,
  created_by     uuid REFERENCES auth.users(id),
  created_at     timestamptz NOT NULL DEFAULT now()
);
-- [STANDARD RLS]
CREATE UNIQUE INDEX p2_asset_assignments_current_idx
  ON p2_asset_assignments (asset_id) WHERE effective_to IS NULL;

CREATE TABLE p2_asset_verifications (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          uuid NOT NULL REFERENCES p2_tenants(id),
  verification_date  date NOT NULL,
  asset_id           uuid NOT NULL REFERENCES p2_assets(id),
  result             text NOT NULL CHECK (result IN
                       ('found','found_elsewhere','not_found','unusable')),
  found_location     text,                    -- 6.3: updates the asset in the same tap
  remarks            text,
  verified_by        uuid REFERENCES auth.users(id),
  created_at         timestamptz NOT NULL DEFAULT now()
);
-- [APPEND-ONLY RLS]
CREATE UNIQUE INDEX p2_asset_verifications_key_idx
  ON p2_asset_verifications (tenant_id, verification_date, asset_id);
```

### 12.6 Scrap and yield — 2 tables

```sql
CREATE TABLE p2_scrap_records (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           uuid NOT NULL REFERENCES p2_tenants(id),
  production_order_id uuid,                   -- nullable: floor sweep has none (8.5)
  raw_material_id     uuid NOT NULL REFERENCES p2_raw_materials(id),
  owned_by            uuid REFERENCES p2_clients(id),   -- DERIVED from the order. 8.3.
  quantity            numeric(12,3) NOT NULL CHECK (quantity > 0),
  unit                text,
  scrap_category      text NOT NULL CHECK (scrap_category IN
                        ('process','defect','moisture','rework_loss','setup')),
  scrap_date          date NOT NULL,
  input_value         numeric(14,2),          -- at p2_material_prices. NULL if unpriced (8.4)
  quality_record_id   uuid,                   -- nullable link (8.5)
  disposed            boolean NOT NULL DEFAULT false,
  notes               text,
  recorded_by         uuid REFERENCES auth.users(id),
  created_at          timestamptz NOT NULL DEFAULT now()
);
-- [STANDARD RLS]
CREATE INDEX p2_scrap_records_order_idx    ON p2_scrap_records (production_order_id);
CREATE INDEX p2_scrap_records_material_idx ON p2_scrap_records (tenant_id, raw_material_id, scrap_date);
CREATE INDEX p2_scrap_records_undisposed_idx
  ON p2_scrap_records (tenant_id, owned_by) WHERE NOT disposed;

CREATE TABLE p2_scrap_disposals (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          uuid NOT NULL REFERENCES p2_tenants(id),
  disposal_date      date NOT NULL,
  disposal_route     text NOT NULL CHECK (disposal_route IN
                       ('sale','scrap_return','direct_supply_s143_5','written_off')),
  buyer_client_id    uuid REFERENCES p2_clients(id),
  buyer_name         text,
  quantity           numeric(12,3) NOT NULL CHECK (quantity > 0),
  rate               numeric(12,2),
  realised_value     numeric(14,2),           -- the ACTUAL price. Not input value. 8.4.
  dispatch_order_id  uuid REFERENCES p2_dispatch_orders(id),
  invoice_id         uuid REFERENCES p2_invoices(id),
  scrap_record_ids   uuid[] NOT NULL DEFAULT '{}',
  owned_by           uuid REFERENCES p2_clients(id),   -- copied from the records. 11.1 item 3.
  notes              text,
  created_by         uuid REFERENCES auth.users(id),
  created_at         timestamptz NOT NULL DEFAULT now()
);
-- [STANDARD RLS]
CREATE INDEX p2_scrap_disposals_date_idx ON p2_scrap_disposals (tenant_id, disposal_date DESC);
```

### 12.7 Gate — 2 tables

```sql
-- ONE physical event, ONE row. Two registers are two views. (10.2)
CREATE TABLE p2_gate_log (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          uuid NOT NULL REFERENCES p2_tenants(id),
  entry_type         text NOT NULL CHECK (entry_type IN ('vehicle','visitor','both')),
  in_at              timestamptz NOT NULL,
  out_at             timestamptz,             -- NULL = still inside
  vehicle_number     text,
  driver_name        text,
  transporter        text,
  visitor_name       text,
  visitor_company    text,
  visitor_phone      text,
  purpose            text,
  whom_meeting       text,
  id_proof_type      text,
  id_proof_last4     text CHECK (id_proof_last4 IS NULL OR length(id_proof_last4) <= 4),  -- 10.8
  persons_count      smallint NOT NULL DEFAULT 1,
  direction          text NOT NULL DEFAULT 'none'
                       CHECK (direction IN ('inward','outward','both','none')),
  goods_description  text,
  supplier_id        uuid REFERENCES p2_suppliers(id),
  client_id          uuid REFERENCES p2_clients(id),
  grn_no             text,
  dispatch_order_id  uuid REFERENCES p2_dispatch_orders(id),
  gate_pass_id       uuid,
  remarks            text,
  recorded_by        uuid REFERENCES auth.users(id),
  closed_by          uuid REFERENCES auth.users(id),
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT p2_gate_log_range CHECK (out_at IS NULL OR out_at >= in_at)
);
-- [STANDARD RLS]
CREATE INDEX p2_gate_log_open_idx ON p2_gate_log (tenant_id, in_at) WHERE out_at IS NULL;
CREATE INDEX p2_gate_log_date_idx ON p2_gate_log (tenant_id, in_at DESC);
CREATE INDEX p2_gate_log_grn_idx  ON p2_gate_log (tenant_id, grn_no) WHERE grn_no IS NOT NULL;

-- A NUMBERED document, because a gap in the series is a question. (10.3)
CREATE TABLE p2_gate_passes (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id            uuid NOT NULL REFERENCES p2_tenants(id),
  pass_number          text NOT NULL,          -- GP-YYMM-NNNN, row-locked counter
  pass_date            date NOT NULL,
  pass_type            text NOT NULL CHECK (pass_type IN
                         ('returnable','non_returnable','repair','sample','contractor_tool')),
  issued_to_name       text NOT NULL,
  issued_to_company    text,
  client_id            uuid REFERENCES p2_clients(id),
  items                jsonb NOT NULL DEFAULT '[]',   -- description, qty, unit, asset_id
  is_returnable        boolean NOT NULL DEFAULT false,
  expected_return_date date,
  actual_return_date   date,
  vehicle_number       text,
  gate_log_id          uuid REFERENCES p2_gate_log(id),
  status               text NOT NULL DEFAULT 'open'
                         CHECK (status IN ('open','returned','closed','cancelled')),
  approved_by          uuid REFERENCES auth.users(id),
  created_by           uuid REFERENCES auth.users(id),
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now()
);
-- [STANDARD RLS]
CREATE UNIQUE INDEX p2_gate_passes_number_idx ON p2_gate_passes (tenant_id, pass_number);
CREATE INDEX p2_gate_passes_overdue_idx
  ON p2_gate_passes (tenant_id, expected_return_date)
  WHERE is_returnable AND status = 'open';
```

### 12.8 Energy and utilities — 3 tables

```sql
CREATE TABLE p2_utility_meters (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid NOT NULL REFERENCES p2_tenants(id),
  name             text NOT NULL,
  utility_type     text NOT NULL CHECK (utility_type IN
                     ('electricity','dg','solar','water','compressed_air','fuel','gas')),
  meter_number     text,
  parent_meter_id  uuid REFERENCES p2_utility_meters(id),   -- sub-metering
  asset_id         uuid REFERENCES p2_assets(id),           -- 9.3 method 1
  multiplier       numeric(10,4) NOT NULL DEFAULT 1,        -- CT ratio
  digit_count      smallint NOT NULL DEFAULT 6,             -- rollover handling (9.1)
  unit             text NOT NULL DEFAULT 'kWh',
  is_active        boolean NOT NULL DEFAULT true,
  created_at       timestamptz NOT NULL DEFAULT now()
);
-- [STANDARD RLS]
CREATE UNIQUE INDEX p2_utility_meters_name_idx ON p2_utility_meters (tenant_id, lower(trim(name)));

CREATE TABLE p2_meter_readings (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES p2_tenants(id),
  meter_id        uuid NOT NULL REFERENCES p2_utility_meters(id),
  reading_at      timestamptz NOT NULL,
  reading_date    date NOT NULL,              -- IST
  shift_id        uuid REFERENCES p2_shifts(id),
  reading_value   numeric(14,3) NOT NULL CHECK (reading_value >= 0),
  units_consumed  numeric(14,3),              -- computed from the previous reading
  is_rollover     boolean NOT NULL DEFAULT false,
  is_estimated    boolean NOT NULL DEFAULT false,   -- 9.6 missed-reading case
  is_anomaly      boolean NOT NULL DEFAULT false,
  recorded_by     uuid REFERENCES auth.users(id),
  created_at      timestamptz NOT NULL DEFAULT now()
);
-- [APPEND-ONLY RLS]
CREATE UNIQUE INDEX p2_meter_readings_key_idx ON p2_meter_readings (meter_id, reading_at);
CREATE INDEX p2_meter_readings_date_idx ON p2_meter_readings (tenant_id, reading_date);

CREATE TABLE p2_utility_bills (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id             uuid NOT NULL REFERENCES p2_tenants(id),
  meter_id              uuid REFERENCES p2_utility_meters(id),
  utility_type          text NOT NULL,
  provider              text,                 -- MSEDCL, MIDC, ...
  consumer_number       text,
  bill_number           text,
  period_from           date NOT NULL,
  period_to             date NOT NULL,
  billed_units          numeric(14,3),
  metered_units         numeric(14,3),        -- from readings, for the reconciliation (9.4)
  energy_charges        numeric(14,2),
  demand_charges        numeric(14,2),        -- kVA. NOT a function of output.
  recorded_demand_kva   numeric(10,2),
  contracted_demand_kva numeric(10,2),
  power_factor          numeric(5,3),
  pf_incentive_penalty  numeric(14,2),        -- the actionable line (9.4)
  tod_charges           numeric(14,2),
  electricity_duty      numeric(14,2),
  fuel_adjustment       numeric(14,2),
  other_charges         numeric(14,2),
  total_amount          numeric(14,2) NOT NULL,
  due_date              date,
  paid_on               date,
  created_by            uuid REFERENCES auth.users(id),
  created_at            timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT p2_utility_bills_range CHECK (period_to >= period_from)
);
-- [STANDARD RLS]
CREATE INDEX p2_utility_bills_period_idx ON p2_utility_bills (tenant_id, period_to DESC);
```

### 12.9 Safety and compliance — 6 tables

```sql
CREATE TABLE p2_safety_equipment (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id             uuid NOT NULL REFERENCES p2_tenants(id),
  equipment_type        text NOT NULL CHECK (equipment_type IN
                          ('fire_extinguisher','fire_hydrant','first_aid_box','eyewash',
                           'ppe_stock','alarm','sprinkler','emergency_light','other')),
  identifier            text,                 -- the tag number on the extinguisher
  sub_type              text,                 -- ABC / CO2 / foam / water
  capacity              text,
  location              text NOT NULL,
  asset_id              uuid REFERENCES p2_assets(id),   -- rare both-cases (W9)
  quantity              numeric(10,2) NOT NULL DEFAULT 1,
  inspection_interval_days integer,
  last_inspected_on     date,
  next_inspection_due   date,
  refill_due_on         date,
  pressure_test_due_on  date,
  status                text NOT NULL DEFAULT 'ok'
                          CHECK (status IN ('ok','due','expired','missing','condemned')),
  is_active             boolean NOT NULL DEFAULT true,
  created_at            timestamptz NOT NULL DEFAULT now()
);
-- [STANDARD RLS]
CREATE INDEX p2_safety_equipment_due_idx
  ON p2_safety_equipment (tenant_id, next_inspection_due) WHERE is_active;

CREATE TABLE p2_safety_inspections (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid NOT NULL REFERENCES p2_tenants(id),
  equipment_id   uuid REFERENCES p2_safety_equipment(id),   -- NULL = a general round
  inspection_type text NOT NULL,
  inspected_on   date NOT NULL,
  result         text NOT NULL CHECK (result IN ('pass','fail','needs_attention')),
  findings       text,
  action_taken   text,
  next_due_on    date,
  inspected_by   uuid REFERENCES auth.users(id),
  inspector_name text,                        -- for an external inspector
  created_at     timestamptz NOT NULL DEFAULT now()
);
-- [APPEND-ONLY RLS]
CREATE INDEX p2_safety_inspections_equipment_idx ON p2_safety_inspections (equipment_id, inspected_on DESC);
CREATE INDEX p2_safety_inspections_date_idx      ON p2_safety_inspections (tenant_id, inspected_on DESC);

CREATE TABLE p2_incidents (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id             uuid NOT NULL REFERENCES p2_tenants(id),
  occurred_at           timestamptz NOT NULL,
  incident_date         date NOT NULL,        -- IST
  incident_type         text NOT NULL CHECK (incident_type IN
                          ('near_miss','first_aid','lost_time','reportable','dangerous_occurrence')),
  location              text,
  asset_id              uuid REFERENCES p2_assets(id),
  worker_id             uuid REFERENCES p2_workers(id),   -- NULL for a near miss
  injured_person_name   text,                 -- a contractor or visitor
  description           text NOT NULL,
  injury_description    text,
  days_lost             integer,
  work_stopped_hours    numeric(8,2),
  immediate_action      text,
  root_cause            text,
  corrective_action     text,
  reportable_suggested  boolean NOT NULL DEFAULT false,   -- computed. 10.6.
  reported_to_authority boolean NOT NULL DEFAULT false,   -- recorded, never performed
  reported_on           date,
  reported_reference    text,
  recorded_by           uuid REFERENCES auth.users(id),
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);
-- [STANDARD RLS]
CREATE INDEX p2_incidents_date_idx ON p2_incidents (tenant_id, incident_date DESC);
CREATE INDEX p2_incidents_reportable_idx
  ON p2_incidents (tenant_id, incident_date) WHERE reportable_suggested;

CREATE TABLE p2_safety_trainings (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES p2_tenants(id),
  topic         text NOT NULL,
  training_date date NOT NULL,
  duration_mins integer,
  trainer_name  text,
  is_external   boolean NOT NULL DEFAULT false,
  revalidation_months smallint,               -- drives next_due per attendee
  notes         text,
  created_by    uuid REFERENCES auth.users(id),
  created_at    timestamptz NOT NULL DEFAULT now()
);
-- [STANDARD RLS]
CREATE INDEX p2_safety_trainings_date_idx ON p2_safety_trainings (tenant_id, training_date DESC);

CREATE TABLE p2_safety_training_attendees (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL REFERENCES p2_tenants(id),
  training_id  uuid NOT NULL REFERENCES p2_safety_trainings(id),
  worker_id    uuid NOT NULL REFERENCES p2_workers(id),
  attended     boolean NOT NULL DEFAULT true,
  next_due_on  date,
  created_at   timestamptz NOT NULL DEFAULT now()
);
-- [STANDARD RLS]
CREATE UNIQUE INDEX p2_safety_training_attendees_key_idx
  ON p2_safety_training_attendees (training_id, worker_id);
CREATE INDEX p2_safety_training_attendees_due_idx
  ON p2_safety_training_attendees (tenant_id, worker_id, next_due_on);

-- The expiry tracker. The cheapest high-value table in this document. (10.4)
CREATE TABLE p2_compliance_documents (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES p2_tenants(id),
  document_type   text NOT NULL,              -- 10.4's list, plus 'other'
  document_name   text NOT NULL,
  issuing_authority text,
  reference_number text,
  issued_on       date,
  valid_from      date,
  valid_until     date,                       -- NULL = perpetual, e.g. a registration
  renewal_lead_days integer NOT NULL DEFAULT 60,
  responsible_user_id uuid REFERENCES auth.users(id),
  document_url    text,
  status          text NOT NULL DEFAULT 'valid'
                    CHECK (status IN ('valid','expiring','expired','under_renewal','not_applicable')),
  notes           text,
  created_by      uuid REFERENCES auth.users(id),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
-- [STANDARD RLS]
CREATE INDEX p2_compliance_documents_expiry_idx
  ON p2_compliance_documents (tenant_id, valid_until)
  WHERE valid_until IS NOT NULL AND status <> 'not_applicable';
```

### 12.10 Views — 4

All four `WITH (security_invoker = true)` **plus an explicit `WHERE tenant_id = get_my_tenant_id()`**
— both, never either. Session 1 found `security_invoker` alone was insufficient on
`v_p2_supplier_advance_balance` because RLS on the underlying table did not fire inside the view
context `[VERIFIED]`, and every view written since carries the explicit filter.

**All four use pre-aggregated subqueries, never a flat multi-table join**, for the fan-out reason
`v_p2_supplier_advance_balance` and `v_p2_production_order_status` both already document `[VERIFIED]`.

| View | Returns |
|---|---|
| `v_p2_leave_balance` | `SUM(days)` per (worker, leave_type, leave_year), with `HAVING <> 0` |
| `v_p2_worker_advance_balance` | `SUM(amount)` per worker, outstanding only |
| `v_p2_yield_variance` | Per (production_order, material, owned_by): issued, expected, scrap, returned, **unexplained** (§8.1), and `is_provisional` where the order is open |
| `v_p2_depreciation_schedule` | Per asset and per block, both regimes side by side (§6.4), with `regime` as an output column so the two can never be summed by accident |

### 12.11 Columns on existing tables

```sql
-- The F3 link's sibling: a production order runs on a machine. (11.2 item 2)
ALTER TABLE p2_production_orders
  ADD COLUMN IF NOT EXISTS asset_id uuid REFERENCES p2_assets(id);
CREATE INDEX IF NOT EXISTS p2_production_orders_asset_idx
  ON p2_production_orders (tenant_id, asset_id) WHERE asset_id IS NOT NULL;

-- The cold-start expected scrap rate. Nullable, no default, never backfilled. (8.2)
ALTER TABLE p2_product_bom
  ADD COLUMN IF NOT EXISTS expected_scrap_pct numeric(6,3)
    CHECK (expected_scrap_pct IS NULL OR (expected_scrap_pct >= 0 AND expected_scrap_pct < 100));

-- Six columns on the shared worker master. (11.3)
-- See §11.3 for the full ALTER and for what it deliberately does NOT add.

-- Entity type: Schedule II applies only to a company. (W10)
ALTER TABLE p2_tenant_settings
  ADD COLUMN IF NOT EXISTS entity_type text NOT NULL DEFAULT 'proprietorship'
    CHECK (entity_type IN ('proprietorship','partnership','llp','private_limited','public_limited'));

-- Eight module flags, all default false. (W13)
ALTER TABLE p2_tenant_settings
  ADD COLUMN IF NOT EXISTS attendance_enabled  boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS leave_enabled       boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS payroll_enabled     boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS assets_enabled      boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS maintenance_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS scrap_enabled       boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS gate_enabled        boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS energy_enabled      boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS safety_enabled      boolean NOT NULL DEFAULT false;
```

**`safety_enabled` makes nine, not eight, and the ninth is deliberate** — the §10.4 expiry tracker
ships under `safety_enabled` but is recommended for session 10, separately from the rest of §10
(§14.3).

### 12.12 The three widened CHECK constraints — read the live definition first

**§0 C10.** Four documents now widen these. Run the `pg_get_constraintdef` query in §0 C10 and
include every value already present before adding:

```sql
-- p2_notifications.type gains four:
--   'compliance_expiry', 'incident_reported', 'payroll_due', 'machine_breakdown'
--   -- and MUST retain factory-os.md §11.8's four and nexflow-intelligence.md §9.4's two.

-- p2_ops_alerts.source gains one:  'factory_floor'

-- p2_agent_proposals.kind gains three:
--   'attendance_day', 'leave_request', 'gate_entry'
--   -- and MUST retain factory-os.md §11.8's three.
```

**Only three `p2_agent_proposals.kind` values are added, and payroll is not among them.** A payroll
run is finalised on a screen showing the full register, not through a chat proposal — the plan is
too large to render in a confirmation card and too consequential to approve from one. §17 item 4.

### 12.13 RPCs — 14

All plain `SECURITY INVOKER` with an explicit `p_tenant_id`, matching `confirm_bom_issue`'s posture,
and **never `SECURITY DEFINER`** — `factory-os.md` F3's trap: a `DEFINER` wrapper runs as `postgres`,
bypasses RLS on every table it touches, and converts a tenant-isolation bug into a cross-tenant
write. `verifyCallerTenant` in the Edge Function is the real gate.

| RPC | Does | Raises |
|---|---|---|
| `generate_attendance_days(p_tenant_id, p_from, p_to)` | Creates default day rows from shift assignments. Idempotent; never touches locked rows | — |
| `resolve_attendance_day(p_tenant_id, p_worker_id, p_date)` | Pairs punches, computes minutes, sets status or flags the exception (§3.3) | `DAY_LOCKED` |
| `mark_attendance_bulk(p_tenant_id, p_date, p_entries_json)` | The §3.4 screen's single write. Writes day changes for every edit | `DAY_LOCKED`, `WORKER_INACTIVE` |
| `record_qr_punch(p_tenant_id, p_code, p_worker_id, p_geo_json)` | Validates the window, enforces one-per-worker-per-window, writes the punch | `WINDOW_EXPIRED`, `ALREADY_PUNCHED` |
| `approve_leave_request(p_tenant_id, p_request_id, p_decided_by)` | Ledger rows + day rows, in one transaction (§4.4) | `DAY_LOCKED`, `SELF_APPROVAL`, `DAY_CONFLICT` |
| `accrue_annual_leave(p_tenant_id, p_year)` | s.79 accrual + lapse, idempotent (§4.3) | — |
| `compute_payroll_run(p_tenant_id, p_run_id)` | §5.4 steps 1–13. Deletes and reinserts lines. Pins `rate_set_version` | `RATE_SET_MISSING`, `NO_WAGE_STRUCTURE`, `RUN_NOT_DRAFT` |
| `finalise_payroll_run(p_tenant_id, p_run_id, p_finalised_by)` | Locks days, freezes lines, writes advance recoveries and leave encashments — **one transaction** | `RUN_NOT_APPROVED`, `DEDUCTION_CAP_BREACH` |
| `record_asset_event(p_tenant_id, p_asset_id, ...)` | Writes the event; advances `last_done_*` when it closes a schedule | `ASSET_DISPOSED` |
| `record_scrap(p_tenant_id, p_order_id, p_material_id, p_qty, ...)` | **Derives `owned_by` from the order** (§8.3); values at the material price | `EXCEEDS_ISSUED`, `ORDER_NOT_FOUND` |
| `dispose_scrap(p_tenant_id, p_disposal_json)` | Enforces §8.3's branch; refuses `sale` on principal-owned scrap | `PRINCIPAL_SCRAP_SALE_REFUSED` |
| `get_next_gate_pass_number(p_tenant_id)` | Row-locked counter, `GP-YYMM-NNNN`, `to_char(now() AT TIME ZONE 'Asia/Kolkata','YYMM')` | — |
| `record_meter_reading(p_tenant_id, p_meter_id, p_value, p_at)` | Computes the delta, handles rollover, flags anomalies at entry (§9.1) | `READING_BEFORE_PREVIOUS` |
| `close_gate_entry(p_tenant_id, p_gate_log_id, p_out_at)` | Sets `out_at` | `ALREADY_CLOSED` |

### 12.14 Migration order

**One file per session block, applied via the Supabase SQL Editor, never `supabase db push`** — the
standing rule, because push replays old migrations.

```
20261201_factory_floor_foundation.sql     session 1
   p2_workers (IF NOT EXISTS) + 6 columns · p2_worker_payroll_identity
   p2_statutory_rates (GLOBAL) + seed of the CONFIRMED rate set
   entity_type + 9 module flags on p2_tenant_settings

20261210_attendance.sql                   sessions 2-4
   p2_shifts · p2_shift_assignments · p2_attendance_devices
   p2_attendance_punches · p2_attendance_days · p2_attendance_day_changes
   p2_attendance_qr_windows · 4 RPCs

20261220_leave.sql                        session 5
   p2_leave_types · p2_leave_ledger · p2_leave_requests
   v_p2_leave_balance · 2 RPCs

20270105_payroll.sql                      sessions 6-8
   p2_payroll_policies · p2_wage_structures · p2_wage_components
   p2_payroll_runs · p2_payroll_lines · p2_worker_advances
   v_p2_worker_advance_balance · 2 RPCs

20270120_assets.sql                       sessions 9-11
   p2_assets · p2_insurance_policies · p2_asset_maintenance_schedules
   p2_asset_events · p2_asset_runtime · p2_asset_assignments
   p2_asset_verifications · p2_compliance_documents
   v_p2_depreciation_schedule · ALTER p2_production_orders ADD asset_id

20270201_scrap_gate_energy.sql            sessions 12-15
   p2_scrap_records · p2_scrap_disposals · ALTER p2_product_bom
   p2_gate_log · p2_gate_passes
   p2_utility_meters · p2_meter_readings · p2_utility_bills
   v_p2_yield_variance · 4 RPCs

20270215_safety.sql                       session 16
   p2_safety_equipment · p2_safety_inspections · p2_incidents
   p2_safety_trainings · p2_safety_training_attendees

20270220_factory_floor_checks.sql         session 17
   the THREE widened CHECK constraints -- LAST, and only after reading the
   live definitions (§0 C10). Doing this last means every other document's
   values are already in place to be preserved.
```

**Test tenant (`fe2b94fb-…`) first, always.** Then `node _ai/regression/snapshot.js` and diff against
the **most recent prior snapshot**, never `baseline-pre-2H.json` `[VERIFIED]`. Every one of these
migrations adds only new objects and nullable or defaulted columns, so **the diff must be empty**; a
non-empty diff means something was already wrong before the session started.

**Run `CLAUDE.md`'s standing check after every migration that touches `p2_tenant_settings`** — which
is the foundation one:

```sql
SELECT agent_tier FROM p2_tenant_settings
 WHERE tenant_id = 'fe2b94fb-9668-405f-9c62-5f54b32f8c7a';   -- must still be 'unlimited'
```

**Never apply to SS Engineering, Datta Prasad or Shivprasad before the pilot decision.** Every flag
defaults false so applying is technically safe — but §14.7's pilot picks who gets switched on, and
that is a conversation, not a migration.

### 12.15 Edge Functions and pages

| Object | Kind | Notes |
|---|---|---|
| `attendance-ingest` | **new** | `verify_jwt = false`, `SB_SECRET_KEY`, path token + serial. **Always 200.** §3.5 |
| `attendance-qr` | **new** | `verify_jwt = false`. Serves the current window to the gate display; accepts a scan. §3.6 |
| `work-view` | modified | Gains a payslip route **behind W6's second factor**. Must not select from any payroll table |
| `factory-report` | modified | `factory-os.md` §8.6's function gains this document's sections. **No new cron** |
| `filing-package` | modified | Three new zip entries (§11.1 items 1, 2, 4) |
| `agent-query` | modified | Three new `propose_*` kinds (§12.12); `confirm_agent_grn_v3` gains `p_gate_log_id` |
| `attendance.html` | **new page** | The §3.4 screen, the exceptions list, the device register |
| `payroll.html` | **new page** | Run lifecycle, register, liability statement, payslips. **Owner and accountant only** |
| `workforce.html` | **new page** | Workers, shifts, leave, wage structures. Owner and supervisor |
| `assets.html` | **new page** | Register, maintenance, insurance, verification, compliance documents |
| `gate.html` | **new page** | Gate log and passes. Deliberately usable by a `storekeeper` role |
| `js/payslip-pdf.js` | **new** | Client-side, sibling to `invoice-pdf.js` (§5.8) |
| `js/roles.js` | modified | New permission keys: `attendance`, `payroll`, `workforce`, `assets`, `gate` |

**`payroll` is a new permission granted to `owner` and `accountant` only** — not supervisor, not
operator, not storekeeper. `attendance` goes to `owner` and `supervisor`. `gate` goes to `owner`,
`supervisor` and `storekeeper`, because the person at the gate is the storekeeper and a register
they cannot write is a register that stays on paper.

---
## 13. Pricing

### 13.1 What it actually replaces — the arithmetic, both ways

The brief gives the replacement set: HR/attendance software ₹15,000–30,000/year, payroll either
outsourced at ₹3,000–5,000/month or done manually in ten hours a month, asset management in Excel,
everything else on paper, and **20+ hours a month of manual work** in total.

**Putting a rupee value on the hours.** An MIDC factory's accountant or admin earns ₹18,000–25,000
a month; fully loaded at the 1.25–1.35× an Indian manufacturing employer actually pays (PF, ESI,
bonus, a seat, a PC — the same multiplier `factory-os.md` §14.4 uses), that is ₹23,400–32,500 a
month for roughly 200 working hours: **₹117–163 an hour.**

**Two cases, and they land in different places:**

| | **Case A — payroll is outsourced** | **Case B — payroll is manual** |
|---|---|---|
| Attendance software | ₹15,000 – 30,000 | ₹15,000 – 30,000 |
| Payroll outsourcing | ₹36,000 – 60,000 | — |
| Manual hours replaced | ~10/month = ₹14,040 – 19,560 | ~20/month = ₹28,080 – 39,120 |
| **Total replaced** | **₹65,040 – ₹1,09,560** | **₹43,080 – ₹69,120** |

**That difference is the whole pricing problem and the brief's ₹60,000–90,000 figure straddles it.**
A factory that outsources payroll can be sold this as a straight cost swap with better records. **A
factory doing it manually in Excel spends less today than any sensible price for this module**, and
the sale is made on risk — a PF inspection they cannot answer, an ESI default they did not know
about, a wage dispute with no muster roll, and a lapsed Consent to Operate that closes the gate.

**Say that out loud in the room rather than hiding it.** An owner who works out for themselves that
the savings do not cover the price stops listening to the rest of the pitch.

### 13.2 The recommendation — two SKUs, and the reason is not pricing

`[RECOMMENDED]`

| SKU | Annual | Setup | Covers | Requires |
|---|---|---|---|---|
| **Nexflow Workforce** | **₹65,000** | **₹20,000** | §3 attendance · §4 leave · §5 payroll | **Pro, Founder or Enterprise. Nothing else.** |
| **Nexflow Factory Floor** | **₹45,000** | **₹10,000** | §6 assets · §7 machines · §8 scrap and yield · §9 energy · §10 gate, safety and compliance | **Factory OS** (`factory-os.md`) |
| Both | ₹1,10,000 | ₹30,000 | All of P1 Part 2 | as above |

**The brief specifies one add-on requiring Factory OS.** That is buildable and §13.6 prices it. But
splitting it is better, and the reason is technical before it is commercial:

**Attendance and payroll do not depend on `factory-os.md` at all.** They depend on `p2_workers`,
which is one table, and §11.3 already moves it to a shared foundation migration for exactly this
reason. Nothing in §3, §4 or §5 reads a production order, a progress row, an assignment or a quality
record — **W1 forbids it.** The dependency, if kept, is a commercial decision with no engineering
content.

**And keeping it costs a great deal.** The entry price for a factory that wants to stop doing payroll
in Excel becomes:

```
  Pro                     1,25,000
  + Agent add-on            75,000      (Factory OS requires it)
  + Factory OS            1,35,000
  + P1 Part 2               85,000
  ------------------------------------
                          4,20,000/year        = Rs 35,000/month
```

**₹4,20,000 to get a muster roll.** Against ₹65,040–₹1,09,560 of replaced cost (§13.1), that is a
sale nobody makes. Whereas:

```
  Pro                     1,25,000
  + Workforce               65,000
  ------------------------------------
                          1,90,000/year        = Rs 15,833/month
```

— which is inside the band `nexflow-agent.md` §10.2 already targets, and is a conversation a factory
owner can have.

**The Factory Floor half genuinely does depend on Factory OS** — yield variance needs production
orders, machine-to-order linking needs them, energy-per-unit needs them. Keeping *that* dependency
is correct and it is priced accordingly.

**`[RECOMMENDED]` and needing founder sign-off**, because it changes the SKU count in
`execution-plan.md` §3 from five to six and the brief said one.

### 13.3 Margin

`nexflow-agent.md` §9's rates: Haiku ₹0.090/₹0.450 per 1K tokens, Opus ₹0.450/₹2.250, at ₹90/USD.

| Line | Per tenant per month |
|---|---|
| Attendance punches — device, QR or supervisor | **₹0.00** — no model in the path |
| Payroll computation — 40 workers, every statutory figure | **₹0.00** — SQL |
| Payslip PDFs — client-side | **₹0.00** |
| Payroll exceptions note — Opus, 6,000 in / 1,000 out, once a month | ₹4.95 |
| Added sections on the existing daily report — Haiku, 600 in / 150 out × 26 | ₹3.16 |
| **Total** | **≈ ₹8** |

| SKU | Revenue/month | Compute | **Gross margin** |
|---|---|---|---|
| Workforce, ₹65,000 | ₹5,417 | ₹7 | **99.9%** |
| Factory Floor, ₹45,000 | ₹3,750 | ₹1 | **99.97%** |
| Both, ₹1,10,000 | ₹9,167 | ₹8 | **99.9%** |
| Single SKU, ₹85,000 | ₹7,083 | ₹8 | **99.9%** |

**The 90% constraint is met by three orders of magnitude and quoting that as an achievement would be
misleading.** It is met because almost nothing here has a model in it, which is a property of
payroll being arithmetic, not of anything clever in the design. **Margin is not the binding
constraint on this module and treating it as one produces a price that is too high.** §13.1 is the
binding constraint.

**Two costs that are real and are not compute:**

**Storage — and this is the first module in the product where it is worth naming.** 40 workers × 2
punches × 26 days = 2,080 punch rows a month, plus 1,040 day rows, plus payroll lines, gate entries,
meter readings and asset events: roughly **42,000 rows and ~15 MB per tenant per year.** At 100
tenants with five years of history that is **~7.5 GB** — approximately the whole of Supabase Pro's
included allowance, and the first Nexflow table set whose size grows with headcount × days rather
than with transactions.

**It cannot be deleted.** Factories Act registers and Payment of Wages Act records carry statutory
retention periods `[UNVERIFIED — §18 Q1]`, and a muster roll deleted to save disk is a muster roll
that cannot be produced. `[DECIDED]` **No retention policy. The growth is accepted and named.** At
Supabase's marginal storage rate it is roughly ₹0.85 per tenant per month at that scale — immaterial
to the P&L, material to know about before it appears.

**Founder hours — and this is the whole cost.**

| Per client, year 1 | Hours |
|---|---|
| Worker master, wage structures for 30–40 people, PF/ESI/PT numbers | 4 – 6 |
| Opening leave and advance balances | 1 – 2 |
| Device enrolment, or shift and roster setup if there is no device | 2 – 3 |
| **The parallel payroll run — Nexflow beside their own sheet, reconciled to the rupee** | **3 – 5** |
| Month-two and month-three support | 2 – 4 |
| **Total** | **12 – 20** `[UNVERIFIED — §18 Q4]` |

At roughly ₹2,000 an hour that is **₹24,000–40,000 per client in year one** — against ₹65,000 of
Workforce revenue, a true first-year contribution of **38–63%**, and against ₹1,10,000 for both,
**64–78%**.

`[RECOMMENDED]` **Cap this module at 15 clients until the parallel-run hours are measured** — tighter
than `factory-os.md` §14.5's 25, because payroll support is heavier and its failures are same-week
and personal. **After ten clients, replace the estimate with the measured number and rewrite this
section.**

### 13.4 The sales conversation

**For a factory that outsources payroll — the easy one:**

> *"You pay someone ₹4,000 a month to run payroll from a WhatsApp photo of your attendance register,
> and ₹20,000 a year for a biometric machine whose software only does attendance. This does both,
> from the same machine, and your CA gets the PF and ESI figures with the account heads already
> split. ₹65,000 a year. You will be paying less and your register will survive an inspection."*

**For a factory that does it in Excel — the honest one, and do not soften it:**

> *"This will cost you more than you spend today, because today you spend two days of somebody's
> month and no cash. What you are buying is the two days back, and the answer to four questions you
> currently cannot answer: who was here on the 14th of March, what did we deduct and why, when does
> the Consent to Operate expire, and where is the die we sent out in June. If none of those four has
> cost you anything yet, wait — and call me the first time one of them does."*

**The second pitch closes less often and it closes better**, and the reason is the same one
`factory-os.md` §14.4 gives for refusing to say "replace three people": **a client who bought on
arithmetic that does not hold churns in month four and talks.** `business-strategy.md` §4.3 names
that as the one thing that can kill this business.

**What not to say, ever:** that Nexflow makes a factory compliant (W12), that it files anything
(W2), that the biometric machine prevents buddy-punching (§15.1), or that the geofence stops anyone
(§0 C7).

### 13.5 Who gets it

| | P1 Part 2 |
|---|---|
| **Lite** | **Never.** No agent, no write layer, single user `[VERIFIED]` |
| **Demo tenant** | **Never.** `agent_enabled = false` and it stays that way |
| **Pro / Founder / Enterprise** | Paid add-on, every module flag off until the owner turns it on (W13) |
| **SS Engineering** | Free, permanently, like everything else `[DECIDED — CLAUDE.md]`. **And they are Type A** — every flag must stay false and §19.7 item 55's byte-identical test is the gate |
| **Datta Prasad** | `[RECOMMENDED]` the pilot tenant (§14.7) |
| **Shivprasad** | After the pilot |
| **A principal (KPML)** | **Not applicable, and not partially applicable.** A principal does not run a factory floor, and §11.4 means there is nothing here they could be shown even if they did |

### 13.6 If the founder keeps the single-SKU packaging

`[RECOMMENDED]` **₹85,000/year, ₹20,000 setup, requiring Factory OS**, exactly as the brief
specifies. It sits between the two split prices, clears 90% margin trivially (§13.3), and lands the
full Pro ladder at **₹4,20,000** and the Enterprise ladder at **₹4,65,000** (§13.2).

**The arithmetic works. The objection in §13.2 is not about the price, it is about the entry
price**, and it does not go away by choosing a number.

---

## 14. Build Sequence

### 14.1 How big this actually is — read this before planning a sprint

| | `factory-os.md` (P1 Part 1) | **This document (P1 Part 2)** |
|---|---|---|
| New tables | 5 | **38** |
| New views | 1 | 4 |
| New RPCs | 9 | 14 |
| New Edge Functions | 2 | 2 |
| New pages | 2 | 5 |
| Amendments to other documents | — | **16** (§11.5) |
| **Sessions** | **6** | **24, ≈32 session-units** |

**P1 Part 2 is roughly five times P1 Part 1, and it is larger than the entire remaining roadmap in
`execution-plan.md` §4.** A founder planning from the brief's implicit symmetry — Part 1 was six
sessions, so Part 2 is about six — will be wrong by a factor of five, and will discover it in month
three.

`[RECOMMENDED]` **Build the MVP, sell it, and build the remaining sixteen sessions only against
demand** — the "gated on a named request" rule `kpml-network-plan.md` §9 Step 7 already applies to
network features, applied here. §14.5 ranks what to build next when a client asks.

### 14.2 The minimum viable P1 Part 2

**The brief's guess is right: attendance + payroll.** Reached independently here from a different
direction — those two are the only modules in this document with a forcing function (§1.4), the only
ones a factory will pay for on their own, and the only ones whose absence costs the owner money
every month.

**Eight sessions: 1, 2, 6, 7, 8, 9, 10, 11. ≈11.5 session-units.**

```
  IN     supervisor-marked attendance, shifts, the day record and its audit trail,
         wage structures with per-component statutory flags, the full run lifecycle,
         PF / ESI / PT / LWF / bonus, advances, arrears, the deduction cap,
         payslips, and the employer liability statement

  OUT    biometric devices (session 3)   -> the supervisor path is complete without
                                             them, and W8 says it must be
         geo-QR (session 4)              -> a deterrent, not a control (C7)
         leave (session 5)               -> unapproved absence is LWP, which is how
                                             a lot of small factories actually run.
                                             Leave BALANCES are the feature; leave
                                             DEDUCTIONS work without them
         everything in §6 to §10         -> none of it is why a factory buys this
```

**Add session 3 — the device webhook — as soon as the first client owns a machine**, which will be
most of them. Nine sessions, ≈13 units, and it is the point at which the module stops needing a
supervisor's ten minutes every morning.

**The MVP is a complete product.** A factory can run its full payroll on it, produce a muster roll an
inspector will accept, and hand its CA a liability statement. Nothing in it is a stub.

### 14.3 The sessions

| # | Session | Units | Output |
|---|---|---|---|
| **1** | **Foundation** | 1 | `p2_workers` moved to a shared migration + 6 columns · `p2_worker_payroll_identity` with its narrower policy · **`p2_statutory_rates` seeded from the CA's written confirmation (§5.9)** · `entity_type` · 9 module flags |
| **2** | **Shifts + the supervisor path** | 1.5 | `p2_shifts`, `p2_shift_assignments`, `p2_attendance_days`, `p2_attendance_day_changes` · `generate_attendance_days`, `mark_attendance_bulk` · `attendance.html`. **End to end: a supervisor marks 38 workers in ninety seconds and the muster roll prints** |
| **3** | **Device ingest** | 1.5 | `attendance-ingest` · `p2_attendance_devices`, `p2_attendance_punches` · `resolve_attendance_day` · the exceptions list · clock-skew flagging · the USB `attlog.dat` importer |
| **4** | **Geo-QR** | 1 | `attendance-qr`, `p2_attendance_qr_windows`, `record_qr_punch` · `attendance-display.html` · the accuracy budget and the scan-count signal |
| **5** | **Leave** | 1.5 | `p2_leave_types`, `p2_leave_ledger`, `p2_leave_requests` · `v_p2_leave_balance` · `approve_leave_request`, `accrue_annual_leave` |
| **6** | **Payroll foundation** | 1.5 | `p2_payroll_policies`, `p2_wage_structures`, `p2_wage_components`, `p2_payroll_runs`, `p2_payroll_lines` · the run lifecycle · `payroll.html` |
| **7** | **The compute engine** | 1.5 | `compute_payroll_run` steps 1–7: period, scope, structure, attendance, earnings, overtime, gross. **Not statutory yet** |
| **8** | **PF and ESI** | 1.5 | §5.5's first two, including the EPS cap, the EDLI cap, the establishment-level admin minimum, and ESI's frozen contribution-period eligibility |
| **9** | **PT, LWF, bonus, the deduction cap** | 1.5 | §5.5's remainder, the February top-up, the Article 276(2) annual cap, and step 11's Payment of Wages Act ceiling |
| **10** | **Advances, arrears, finalisation** | 1.5 | `p2_worker_advances` · `finalise_payroll_run` and the attendance lock (W4) · arrear lines |
| **11** | **Payslips and the liability statement** | 1.5 | `js/payslip-pdf.js` · §5.7's statement · the `work-view` payslip route behind W6's second factor. **MVP COMPLETE** |
| **12** | **Asset register** | 1 | `p2_assets`, `p2_insurance_policies` · `assets.html` |
| **13** | **The expiry tracker** | 1 | `p2_compliance_documents` · the 60/30/7-day alerts · **pulled forward out of §10 deliberately (§10.4)** |
| **14** | **Custody, verification, depreciation** | 1.5 | `p2_asset_assignments`, `p2_asset_verifications` · `v_p2_depreciation_schedule`, both regimes |
| **15** | **Machines** | 1.5 | `p2_asset_maintenance_schedules`, `p2_asset_events`, `p2_asset_runtime` · `ALTER p2_production_orders ADD asset_id` · the downtime-overlap line |
| **16** | **Scrap** | 1 | `p2_scrap_records` · `record_scrap` with the derived `owned_by` · `expected_scrap_pct` on the BOM |
| **17** | **Yield variance and disposal** | 1.5 | `v_p2_yield_variance` · `dispose_scrap` with §8.3's branch · the `scrap_return` path into ITC-04 Table 5B |
| **18** | **The gate** | 1.5 | `p2_gate_log`, `p2_gate_passes` · `get_next_gate_pass_number` · GRN and dispatch pre-fill · `gate.html` |
| **19** | **Meters** | 1.5 | `p2_utility_meters`, `p2_meter_readings` · `record_meter_reading` with rollover and entry-time anomaly checks · §9.5's detector |
| **20** | **Bills and per-unit energy** | 1.5 | `p2_utility_bills` · the reconciliation · the three apportionment methods · `nx_energy_cost_per_unit` |
| **21** | **Safety equipment** | 1 | `p2_safety_equipment`, `p2_safety_inspections` |
| **22** | **Incidents and training** | 1 | `p2_incidents` with `reportable_suggested` · `p2_safety_trainings` + attendees |
| **23** | **Integration** | 2 | §11.1's eight flows: three filing-package files, the report sections, the four pushes, and the three `nexflow-intelligence.md` aggregator amendments |
| **24** | **Constraints, regression, acceptance** | 1 | The three widened CHECKs **last** (§12.14) · the full §19 pass · the Type A test on an SS Engineering copy |
| **—** | **Supervised pilot** | 30 days | §14.7. **Calendar time, not build time** |

**Not negotiable:** session 1 before everything — the statutory rate set is what every payroll figure
reads, and seeding it wrong means every later session is built against a wrong number. Session 2
before 3 and 4 — the day record is what the punches resolve *into*. Sessions 7 through 10 in order —
the compute engine's steps are sequential by construction. Session 24 last, because §12.14's CHECK
widening must see every other document's values already in place.

**Genuinely parallelisable, if two people existed:** 12–14 (assets) against 16–17 (scrap), and 18
(gate) against anything. They share no table. They do not exist.

### 14.4 What depends on what

```
  1 Foundation
   |
   +-- 2 Attendance days ------+-- 3 Device      (needs the day record to resolve into)
   |                           +-- 4 Geo-QR
   |                           +-- 5 Leave       (s.79 accrual needs days worked)
   |                           |
   |                           v
   +-- 6..11 PAYROLL   <-- needs 2. Uses 5 if present; treats absence as LWP if not.
   |                   <-- NEVER reads anything from factory-os.md (W1)
   |
   +-- 12 Assets --+-- 13 Expiry tracker    (standalone; reads insurance from 12)
   |               +-- 14 Depreciation
   |               +-- 15 Machines ---------+-- 20 per-unit energy (needs runtime)
   |                                        |
   +-- 16 Scrap ---- 17 Yield variance      |   BOTH need factory-os.md
   |     ^                  ^               |   p2_production_orders
   |     +------------------+---------------+
   |
   +-- 18 Gate      STANDALONE. Needs nothing from this document.
   |
   +-- 19 Meters -- 20 Bills and per-unit energy
   |
   +-- 21 Safety equipment -- 22 Incidents and training    STANDALONE
```

**Four modules are genuinely standalone and can ship in any order at any time:** the gate log (18),
the expiry tracker (13, once 12 exists for insurance), safety (21–22), and meters (19). None of them
reads a production order, an attendance row or a payroll line.

**Three need `factory-os.md` Part 1 and cannot be built without it:** scrap (16), yield variance
(17), and the machine-to-order link inside 15 and 20. That is the real dependency the §13.2 SKU
split follows.

### 14.5 What to build next, when a client asks

Ranked by value per session-unit, which is not the same as the brief's order:

| Rank | Module | Sessions | Why here |
|---|---|---|---|
| 1 | **Expiry tracker** (13) | 1 | One table, one cron, one report section. **It is the only thing in this document that can prevent a factory being shut**, and it is a fraction of a session |
| 2 | **Gate log and passes** (18) | 1.5 | Cheap, standalone, and it is a register an inspector actually opens. The returnable-item alert alone finds a die nobody remembered |
| 3 | **Scrap and yield** (16–17) | 2.5 | Higher than the brief implies: `scrap_return`, `p2_challan_links` and ITC-04 Table 5B all already exist `[VERIFIED]`, so path (a) in §8.3 closes a real hole cheaply |
| 4 | **Assets, custody, depreciation** (12, 14) | 2.5 | The CA wants the schedule; the owner wants the insurance date. Two buyers, one module |
| 5 | **Machines** (15) | 1.5 | Moderate on its own; it is the input to §9.3 and to `factory-os.md`'s bottleneck work |
| 6 | **Safety** (21–22) | 2 | Low owner value, real inspection value. The near-miss log is the only leading indicator anywhere in this document |
| 7 | **Energy** (19–20) | 3 | Interesting, and the hardest to do well. The power-factor line is worth more than the per-unit figure (§9.4) |

### 14.6 Where this sits in the roadmap

`CLAUDE.md`'s "What to build next" is a single 32-item sequence, and **nothing in this document
displaces items 0, 1 and 2** — the live-tenant filing-package migration, A0 and A6 — which carry a
hard **5 October 2026** deadline and are a distribution dependency rather than infrastructure.
`CLAUDE.md` is explicit: *"Build item 0, then A0, then A6. Nothing else until all three are done."*
`[VERIFIED]`

`[RECOMMENDED]` **P1 Part 2 sits after `factory-os.md`'s six sessions**, which themselves sit after
the agent write layer, which `nexflow-agent.md` §13.1 places after Session T1 and before A1.

**Two reasons it must not be pulled earlier, and the second is the real one:**

1. **`p2_workers` comes from `factory-os.md` §11.1** and §11.3 moves it. Building the move before the
   table has a definition is building against a document rather than a schema.
2. **Payroll is the highest-consequence module in the product and it should not be the first thing a
   tenant meets.** A factory that has run the agent write layer and Factory OS for three months has
   a supervisor who trusts the software, master data that has been cleaned once, and a founder who
   knows the client. **Starting a relationship with payroll means the first thing that goes wrong is
   somebody's wages.**

### 14.7 The pilot, and the parallel run that is not optional

**One tenant, one full payroll month, run twice.** `[RECOMMENDED]` **Datta Prasad Enterprises**, for
the reasons `nexflow-agent.md` §17 Q5, `factory-os.md` §12.5 and `nexflow-intelligence.md` §14.4 all
give — most data, most volume, most documented problems, most to gain — and one specific to this
module: they are the largest of the three, so their payroll exercises PF, ESI, PT and overtime
simultaneously rather than one at a time.

**The parallel run is the gate and it has a pass mark:**

```
  MONTH 1   the factory runs its own payroll exactly as it does today.
            Nexflow runs it too, in parallel, and nobody is paid from Nexflow.
            EVERY WORKER IS RECONCILED TO THE RUPEE.
            Every difference is explained before month 2 begins -- and the
            explanation is as likely to be that the factory's sheet was wrong
            as that Nexflow was.

  MONTH 2   Nexflow's register is the one used. The old sheet is still produced
            and spot-checked on five workers.

  MONTH 3   Nexflow only.
```

**Exit conditions, and they are not "it seems fine":**

- **Every worker reconciles to the rupee in month 1**, or the difference is understood and one of
  the two is corrected. **A single unexplained rupee stops the pilot.**
- **A worker queries a payslip and the answer is found in under two minutes**, from the app, without
  a spreadsheet. That is the real test of `p2_attendance_day_changes` and of W3's frozen rates.
- **The muster roll is shown to the factory's own consultant or CA** and the question asked
  directly: *"if an inspector asked for the register, is this it?"*
- **§5.9's eleven parameters are confirmed in writing before month 1 starts.** Not during.
- **The founder hours are counted**, per §13.3, and written back into this section.

---

## 15. The Honest Floor

What this module genuinely cannot do. For each: why it is irreducible, what catches it afterwards,
and what the owner sees and when.

### 15.1 Buddy punching

**A biometric device prevents it. A card does not. A QR code does not. A supervisor marking a
register certainly does not.**

An RFID card lent to a colleague produces a punch indistinguishable from a real one. A rotating QR
code photographed and sent to a WhatsApp group produces several punches in one window — **which §3.6
makes visible as an anomalous scan count, and visible is not prevented.** Mock location on Android
defeats the geofence in thirty seconds (§0 C7).

*Catch:* the scan-count signal, and a supervisor who is physically present. That is all.

*What the owner sees, and when:* a digest line when a QR window has an implausible number of scans.
Nothing at all for a lent card.

*What no vendor should claim, including this one:* **that attendance hardware stops attendance
fraud.** Fingerprint hardware stops it at the moment of the punch and stops nothing else — a worker
who punches in and leaves is a fingerprint record of somebody who was not there. §13.4 says so in the
sales conversation, deliberately.

### 15.2 A supervisor-marked muster roll is a supervisor's opinion

**§3.4's screen is the floor of the design (W8) and it is also the weakest link in it.** If the
supervisor is complicit, or careless, or filling the week in on Friday, nothing in software knows.

*Catch, and it is a genuinely strong one:* **the worker.** §1.4 — a person marked absent who was
present comes and asks, that week, about a day they remember. That is an adversarial audit running
every month for free, and it is why attendance data will be the best data in the system.

*What it does not catch:* a worker marked **present** who was absent. Nobody complains about that,
and it is the direction fraud actually runs. **The only defences are a device, or an owner who looks
at the register.**

### 15.3 A wrong wage structure is wrong for a year and nobody notices

A `basic` entered as ₹9,000 when it should be ₹12,000 produces a wrong PF contribution every month
for twelve months. It is arithmetically correct on every payslip. It is caught at a PF inspection,
by an EPFO notice, or never.

*Catch:* the parallel run in month one (§14.7), and nothing after it.

*What the owner sees:* nothing. This is §15.7's failure in its purest form.

*The mitigation that exists:* §5.3's conservative defaults — every component counts toward PF wages
unless a human turns it off, so the error direction is over-contribution rather than under. **An
over-contribution is a worker's money in their account. An under-contribution is a demand notice
with interest and damages.** Where a wrong default is inevitable, it should be wrong in the direction
that is recoverable.

### 15.4 The payslip link is a speed bump

W6's second factor is a date of birth. For a worker whose colleagues know their birthday, it is
close to no protection at all, and stating otherwise would be dishonest.

*What it does buy:* a link forwarded to a WhatsApp group does not open into a wage figure for
somebody who scrolls past it. That is worth having and it is not security.

*The recommended default:* **payslips on paper, generated in bulk, handed over.** The link is opt-in
per tenant, off by default, and the Settings screen says exactly this.

### 15.5 Unexplained variance names a quantity and nothing else

§8.1's figure says material left the store and did not become product, scrap or stock. **It cannot
distinguish waste from mis-entry from theft, and the three look identical in the data.**

*Catch:* trend, not event. A material with persistent unexplained variance across many runs is worth
looking at; a single run's figure is noise plus somebody's arithmetic.

*What the owner sees:* a figure, labelled unexplained, with no adjective. **The word on the screen
must not pick an explanation** — `kpml-network-plan.md` §8.3's warning that a bad number here
*"manufactures theft accusations, automatically, every month, with the authority of software"* is the
reason.

### 15.6 A register is not the thing it records

- **A training record says a name was on a list.** It does not say anyone learned anything.
- **A gate log records who signed in.** It does not record who walked in, and every factory has a
  side gate.
- **A safety inspection marked `pass` says someone ticked a box.** IS 2190 does not enforce itself.
- **A compliance document row says a certificate existed on a date.** It does not say the conditions
  attached to it are being met.
- **An asset verification marked `found` says somebody said they found it.**

*Catch:* none, from software, for any of them. **These registers are worth building because their
absence is a problem and their presence is a defence — not because they are evidence of the
underlying reality.** W12 exists so the product never claims otherwise.

### 15.7 The forcing function cuts both ways

§1.4 is the strongest argument in this document: payroll has an auditor with an incentive, and
attendance data will be the best data in the system because of it.

**The same fact means there is no quiet period in which to find a payroll bug.** Every other module
in Nexflow fails slowly and is caught at month end by a CA. This one fails on the 5th, in the
office, in front of the person it failed.

**And the auditor only audits one direction.** A worker checks that they were not short-paid. Nobody
checks that they were not over-paid, that the employer's PF share was right, that ESI eligibility was
frozen correctly, or that the professional tax hit ₹2,500 for the year. **Those are the errors this
module will actually make**, and the only things that catch them are §5.9's confirmed rate table,
§14.7's parallel run, and a CA who reads §5.7's statement.

That is why §5.9 is a gate and not a checklist.

---

## 16. Failure Mode Analysis

Every way this fails, what the system does, what the **owner or worker** sees, and what the
**founder** sees on A0. Severity vocabulary is A0's: `critical` bypasses quiet hours, `important`
and `monitor` do not.

| # | Failure | System does | User sees | Founder sees |
|---|---|---|---|---|
| 1 | Device offline for a day | Buffers locally, uploads later. Days recompute on arrival if unlocked | Nothing, or a one-day delay in the exceptions list | `monitor` if a registered device is silent > 48h |
| 2 | Device clock drifts 40 minutes | Punches flagged on skew; days still resolve | A digest line naming the device | `monitor` |
| 3 | Device points at the wrong tenant's URL | Accepted, stored nowhere, `opsAlert` | Nothing | `monitor` — this is a support call waiting to happen |
| 4 | Unrecognised enrolment id | Punch stored with `worker_id` NULL, on the exceptions list | *"Unrecognised enrolment 0041 — is this a new worker?"* | Nothing |
| 5 | Worker punches in, never out | Day is an **exception**, never guessed (§3.7 rule 4) | The supervisor decides, with both facts shown | Nothing |
| 6 | Geo-QR: indoor GPS unusable | `geo_status='unusable'`, punch accepted | Nothing — the punch worked | Nothing. **This is the common case, by design (C7)** |
| 7 | One QR code shared with five workers | Five punches, one window, scan count anomalous | A digest line | `monitor` |
| 8 | Supervisor fills the week in on Friday | Accepted. Nothing detects it | — | Nothing. **§15.2 — there is no catch** |
| 9 | Leave approved over a locked period | Refused, naming the run | *"March is finalised. Record this as an arrear on April."* | Nothing — W4 working |
| 10 | Payroll run with a missing wage structure | **Refuses to compute**, names every worker | The list, before anything is calculated | Nothing |
| 11 | Rate set has no row effective for the period | **Refuses to compute**, names the parameter | *"No PF rate is on record for March 2027."* | **`important`** — the rate table is the founder's to maintain (W3) |
| 12 | Deductions exceed the s.7(3) cap | Line **blocked**; recovery reduced to the cap, remainder carried | The worker's line, flagged, with both numbers | Nothing |
| 13 | Computed gross below the entered minimum wage | Warning on the register, does not block | A loud line naming the worker | Nothing — Nexflow does not know the real minimum (§5.5) |
| 14 | A statutory rate was wrong in the rate table | **Every payslip is wrong, arithmetically correctly** | Nothing, for months | **`critical` when discovered.** §5.9 is the gate; §14.7 is the catch |
| 15 | Attendance edited after finalisation | Punch stored, day unchanged, arrear flagged | *"This affects a finalised period — it will appear as an arrear."* | Nothing |
| 16 | Somebody asks to unlock a finalised run | **Refused. There is no unlock** | §17 item 5's sentence | Nothing |
| 17 | A payslip link is forwarded | Second factor required (W6) | Whoever has it sees a birthday prompt | Nothing. **§15.4 — a speed bump** |
| 18 | `work-view` selects from a payroll table | **Must be impossible** | — | **`critical`** if ever observed. §19.6 item 46 asserts it on the source |
| 19 | Production data reaches a payroll figure | **Must be impossible** (W1) | — | **`critical`** if ever observed. §19.1 item 3 |
| 20 | A principal-facing RPC returns a worker figure | **Must be impossible** (§11.4) | — | **`critical`** if ever observed |
| 21 | Scrap from a principal's material sold as own revenue | **Refused** by `dispose_scrap` | §8.3's s.143(5) note and both routes | `monitor` if the refusal fires repeatedly — it means the workflow is confusing |
| 22 | Gate entry left open overnight | Stays open, appears in the digest | One line, the next morning | Nothing |
| 23 | Returnable gate pass overdue | Digest line | *"Die KS4-D2 out since 14 June, due back 30 June."* | Nothing |
| 24 | Compliance document expires unnoticed | **Should be impossible** — 60, 30 and 7-day pushes | Three pushes | `monitor` if one expires with `status='valid'` — the cron did not run |
| 25 | Reportable incident recorded | Push within the hour, `reportable_suggested` set | *"This looks reportable under s.88 — the notice period is short."* | `monitor` |
| 26 | Meter reading transposed | Flagged at entry, before saving, with both numbers | *"Last reading 48,210. This is 84,210. Is that right?"* | Nothing |
| 27 | Sub-meters exceed the main | Reconciliation exception | A line naming the likely CT-ratio error | Nothing |
| 28 | Payroll not finalised by the pay-by date | Push on the day (W14) | *"March payroll is not finalised. Wages are due by the 7th."* | Nothing |
| 29 | An attendance table grows past expectation | Nothing — there is no retention policy | Nothing | `monitor` at a tenant-level row-count threshold. §13.3 |
| 30 | Two documents widen the notification CHECK | Inserts of the dropped type fail **silently** | Missing notifications, no error | **`critical`** if observed. §0 C10 exists for this |

**Rows 18, 19 and 20 are the ones to design against.** They are the only three where the system does
something structurally forbidden rather than merely wrong, and all three are asserted in §19 on
source or on a column list, never on a value.

**Rows 8 and 14 are the ones to worry about.** Neither has a software catch. Row 8 is caught by a
worker or not at all; row 14 is caught by §14.7's parallel run or not for a year. Everything else on
this list is recoverable within a day.

---

## 17. Explicitly Out of Scope `[NEVER]`

Permanent. Not a backlog, not gated on a client asking.

1. **Filing, submitting or uploading anything to EPFO, ESIC, a professional-tax portal or any other
   government system.** W2. There is no plan, price or client for which this becomes yes.
2. **Piece rates, production-linked incentives, or any per-worker earnings figure computed from a
   production, progress or quality row.** W1, and `factory-os.md` F11's surviving half. **This will
   be proposed again — it is the obvious next feature and it is wrong every time.**
3. **Moving money.** No bank payment file, no payment rail, no "pay now". A Nexflow bug that can
   cause a salary not to be paid is a category of bug this product will not have.
4. **Finalising a payroll run through a chat proposal.** §12.12. The plan is a full register; a
   confirmation card cannot render it and a human cannot approve what they cannot see.
5. **Unlocking a finalised payroll run.** W4. *"March is finalised. The correction goes on April as
   an arrear, and it will show as one."* There is no admin override and building one would destroy
   the only property that makes the numbers reconcile.
6. **Posting depreciation, salary or any payroll journal — to Tally, to the Bridge Agent, or
   anywhere.** W10. `bridge-agent.md`'s sync is driven from `p2_invoices` only `[VERIFIED]`.
7. **TDS under s.192, Form 16, Form 24Q, investment declarations, Form 12BB, or perquisite
   valuation.** `enterprise-strategy.md` §8 item 3, unchanged.
8. **Interest on a salary advance.** §5.6.
9. **Gratuity valuation, superannuation, or any actuarial computation.** §0 C6. It requires a
   profession Nexflow does not have.
10. **Computing a capital gain on an asset disposal.** §6.5 — a negative block is flagged, never
    computed. It is a tax position.
11. **Maintaining the Maharashtra minimum wage notifications.** §5.5. A half-yearly, per-employment,
    per-zone data commitment with a silent failure mode.
12. **Asserting that a factory is compliant, or interpreting any regulation.** W12.
13. **Filing a statutory notice of an accident, or any other notice.** §10.6. Nexflow records that
    one was filed; the occupier files it.
14. **Storing a full identity document number for a visitor.** §10.8. Last four digits and the type.
15. **Machine condition monitoring, IoT, PLC or sensor integration.** `factory-os.md` §16 item 8,
    inherited. Preventive maintenance here is a calendar, not a prediction.
16. **Any worker figure of any kind crossing a tenant boundary.** §11.4, and it is stricter than
    `factory-os.md` F10 because there is more to leak.
17. **Deducting a maintenance spare from stock.** §7.2 — `[RECOMMENDED: not in v1]` rather than
    `[NEVER]`, but it is not a small feature and it is not this document's.
18. **Net-metering settlement, or any tariff computation.** §9.6.
19. **A second daily message.** W14. Sections on the existing report, always.
20. **A "compliant" badge, score, percentage or traffic light anywhere in §10.** W12, and this is the
    specific form the violation will take.

---

## 18. Open Questions

Each needs a decision, a measurement or a CA's written confirmation **before** the session named.

### Blocking session 1 — and therefore blocking everything

**Q1. The eleven statutory parameters, plus the four rules.** `[UNVERIFIED]` — **the single most
important item in this document.**
§5.9's table, plus the Payment of Wages Act s.7(3) deduction ceiling, the s.5 pay-by date, the
per-statute rounding conventions, the Factories Act s.79 accrual and 240-day qualification, the
s.64/65 quarterly overtime cap as notified in Maharashtra, the Maharashtra LWF rates, the s.88
reportable threshold, the Income Tax Appendix I block rates, the statutory retention period for
these registers, and which Act each client's premises falls under (§4.2).
**Resolve:** take §5.9's table and this paragraph to a practising CA with a manufacturing book. Get
it back **in writing**, with a date. Seed `p2_statutory_rates` from their answer and record their
name in `confirmed_by`.
**Decide before:** session 1's migration. **Not before session 7, and not "we'll check it later" —
every session from 7 to 11 is built against these numbers.**

**Q2. Is a draft ECR file in scope?** `[RECOMMENDED: yes, session 16+, not in the MVP]` — W2.
The GST precedent says Nexflow produces the file and the CA uploads it. The ECR format is strict and
version-dependent.
**Resolve:** ask the pilot tenant's CA to supply one real ECR file they have uploaded, and match the
format against it before writing a generator.
**Decide before:** any ECR work is scheduled.

### Blocking session 3 — the device

**Q3. The ZK push protocol, on real hardware.** `[UNVERIFIED]`
§3.5's endpoint paths, the exact body format, the required response strings, the `verify_mode` and
`status` integer mappings, and **whether the firmware's server-address field accepts a path** (§3.5
rule 3) are all stated from understanding, not from a device.
**Resolve:** buy one eSSL or BioMax device — they are ₹8,000–15,000 — point it at a logging endpoint,
and capture every request it makes over a full day including a buffered replay after a network
outage. **One device answers every question in §3.5 in an afternoon.**
**Decide before:** session 3 starts. Do not write the parser from this document.

### Blocking pricing

**Q4. How many founder hours does a payroll client actually take?** `[UNVERIFIED]`
§13.3 estimates 12–20 and the 15-client cap rests on it. It is a guess, and the parallel-run line
(3–5 hours) is the least certain part of it.
**Resolve:** instrument from the first client. **After ten clients, replace the estimate with the
measured number and rewrite §13.3.**
**Decide before:** the 10th sale.

**Q5. Is the two-SKU split right, and are ₹65,000 and ₹45,000 the right numbers?**
`[RECOMMENDED, not decided]` — §13.2.
The margin arithmetic clears at any of these prices (§13.3), so the constraint is willingness to pay
and the entry price, not cost.
**Resolve:** in the pilot's month three, ask the owner two questions separately — what the payroll
half is worth to them per month, and what the registers half is worth. **Ask them separately, or the
answer is one number for both.**
**Decide before:** the first quote.

### Design, resolvable in-session

**Q6. Does `p2_dispatch_orders` have a `vehicle_number` column?** `[UNVERIFIED]` — §11.2 item 3.
`nexflow-agent.md` §7.3's tool schema suggests it is planned rather than present.
**Resolve:** the one-line `information_schema` query in §11.2.
**Decide before:** session 18.

**Q7. Should a maintenance spare deduct from stock?** `[RECOMMENDED: not in v1]` — §7.2.
It is the right thing eventually and it turns a maintenance event into a stock transaction with a
pool, a rate and a GST consequence — a session on its own.
**Decide before:** a client asks, and then build it as its own session rather than widening §7.

**Q8. Is the 60-second QR window right?** `[UNVERIFIED]` — §3.6.
It is a guess about how fast a person walks up to a display and scans.
**Resolve:** measure the failed-scan rate in the pilot. Above ~10%, lengthen the window; the
photo-and-share risk is already handled by the scan-count signal rather than by the duration.
**Decide before:** geo-QR reaches a second tenant.

**Q9. Should attendance exceptions be a push or a screen?** `[RECOMMENDED: a screen, plus one digest
line]` — W14.
A supervisor who gets a push per exception gets six pushes a morning. A supervisor who gets none may
not look.
**Decide before:** session 3, because a push is much harder to remove than to not build.

**Q10. What happens to payroll data when a tenant leaves?** `[UNVERIFIED]`
E4's One-Click Full Export ships 20 CSVs of every `p2_*` table `[VERIFIED — Session 13]` — **it will
not include 38 tables that did not exist when it was written.** And payslips are documents a former
client may need for years.
**Resolve:** add all 38 tables to `js/full-export.js`'s list in session 24, and the payslip PDFs to
the zip's `documents/` folder alongside the invoices and challans. **The same gap
`nexflow-intelligence.md` §17 Q8 identifies for its own tables** — fix both in one pass.
**Decide before:** the first live tenant finalises a payroll run.

---

## 19. Acceptance Tests

P1 Part 2 is done when every one of these passes on the test tenant
(`fe2b94fb-9668-405f-9c62-5f54b32f8c7a`). Run the whole list before the first live tenant, and again
before any release that touches the payroll engine, the attendance resolver, or a principal-facing
surface.

### 19.1 The firewall — the headline tests

1. **A payroll figure is never a function of a production figure.** Compute a run; change
   `p2_production_progress` for every worker in the period; recompute. **Every line is byte-identical.**
2. **A production figure is never a function of a payroll figure.** The reverse, against
   `v_p2_production_order_status`.
3. **The grep, and it is the real test.** The payroll module's source and migrations contain **zero**
   occurrences of `p2_production_progress`, `p2_production_assignments`, `p2_quality_records`,
   `p2_production_orders` and `v_p2_production_order_status`. And:
   ```sql
   SELECT * FROM information_schema.referential_constraints rc
     JOIN information_schema.key_column_usage k ON k.constraint_name = rc.constraint_name
    WHERE k.table_name LIKE 'p2_payroll%' OR k.table_name LIKE 'p2_wage%';
   -- must return no row referencing any production table
   ```
4. **A progress entry never marks a day present.** Plant progress rows for a worker with no punch and
   no supervisor mark; assert the day stays `absent`. W1's third forbidden thing.

### 19.2 Payroll correctness

5. **A payslip reproduces byte-identically after a rate change.** Finalise March on rate set
   v2026.1; add v2026.2 with different PF rates; regenerate March's payslip. **Identical.** W3.
6. **A finalised run cannot be recomputed.** `compute_payroll_run` on a finalised run raises and
   writes nothing.
7. **An attendance edit after finalisation does not change a payslip**, and the punch is still
   stored. W4.
8. **Arrears appear as their own line**, with `arrear_for_period` set, and are visible separately on
   the register and the payslip.
9. **EPS is capped.** A worker on ₹40,000 of PF wages produces `eps = 1250` exactly, and
   `employer_epf = 12% × pf_wages − 1250`. §0 C4.
10. **EDLI is capped at ₹75.** Same worker.
11. **The PF administration charge is establishment-level and respects the ₹500 floor.** A run with
    ₹60,000 of total PF wages produces `employer_pf_admin = 500`, not ₹390, and it is on
    `p2_payroll_runs`, **not summed from `p2_payroll_lines`.** §5.4 step 13.
12. **ESI eligibility is frozen for the contribution period.** A worker at ₹20,000 in April who
    reaches ₹23,000 in July still contributes through September, and
    `esi_eligibility_basis` records the April wage. §0 C5.
13. **The ESI employee share is skipped below the daily-wage threshold**, and the employer share is
    not.
14. **Professional tax totals ₹2,500 for a full-year worker**, with ₹300 in February and ₹200 in the
    other eleven months — **not ₹2,400.** §0 C3.
15. **A female worker below the exemption threshold has zero professional tax**, for every month.
16. **Statutory bonus uses the calculation ceiling, not the wage.** A worker on ₹18,000 accrues
    8.33% of the ceiling. §0 C6.
17. **The overtime multiplier cannot be saved below 2.0.** The CHECK rejects 1.5, and the error names
    s.59. §0 C2.
18. **Overtime is computed on the `is_ot_base` subset**, not on gross. Flip one component's flag and
    assert the OT amount moves.
19. **A line breaching the s.7(3) deduction cap is blocked**, the recovery is reduced to the cap, and
    the remainder stays on the advance ledger. §5.4 step 11.
20. **A run with a missing wage structure refuses to compute** and names every affected worker.
    **It never computes them at zero.**
21. **A run with no effective rate row refuses to compute** and names the parameter.

### 19.3 Attendance

22. **A night shift produces one day row, dated to the shift start.** A 22:00–06:00 shift across a
    month boundary does not split. §3.2.
23. **`attendance_date` is an IST date.** Resolve a day at 01:00 IST and assert it is today's IST
    date, not yesterday's UTC one.
24. **A device resending its whole buffer writes no duplicate.** Post the same 200 records twice;
    assert 200 rows. §3.5 rule 5.
25. **An unregistered serial gets a 200 and writes nothing**, and an `opsAlert` is raised.
26. **A device is never sent a 4xx or 5xx.** Fire malformed bodies, an unknown table, an empty body;
    assert every response is 200. §3.5 rule 1.
27. **A punch with clock skew > 5 minutes is flagged and still stored.**
28. **A single punch produces an exception, not a full day and not an absence.** §3.7 rule 4.
29. **A `trust='unverified'` punch alone does not mark a day present.** §3.7 rule 5.
30. **A QR code cannot be used twice by one worker in one window**, and the window's `scan_count`
    increments for every attempt including refused ones.
31. **An unusable GPS accuracy does not refuse the punch.** Submit `accuracy: 1800`; assert the punch
    lands with `geo_status='unusable'`. §0 C7.
32. **Every edit to a decided day writes a `p2_attendance_day_changes` row** with from, to and who.
33. **`p2_attendance_punches` rejects an UPDATE and a DELETE** from an authenticated session — there
    is no policy for either.

### 19.4 Leave, scrap and the registers

34. **Leave accrual is idempotent.** Run `accrue_annual_leave` three times; assert one accrual row
    per worker per type per year. §4.3.
35. **Leave spanning a weekly off consumes only working days.** §4.5.
36. **Approving leave over a locked period is refused**, naming the run.
37. **A worker cannot approve their own leave request.**
38. **Scrap on a principal's material cannot be disposed of as a sale.** `dispose_scrap` with
    `disposal_route='sale'` on a record with `owned_by IS NOT NULL` raises
    `PRINCIPAL_SCRAP_SALE_REFUSED` and names the principal. §8.3.
39. **A `scrap_return` disposal produces a dispatch with `movement_purpose='scrap_return'`** and it
    appears in the existing ITC-04 Table 5B output unchanged.
40. **`owned_by` on a scrap record is derived from the order and cannot be supplied by the caller.**
41. **Unexplained variance is labelled unexplained.** String-scan the rendered output for "loss",
    "shortfall", "missing" and "theft"; assert none appears. §15.5.
42. **A gate pass number series has no gaps**, and the gap detector agrees with the one
    `export.html`'s Table 13 uses for challans. §10.3, §11.1 item 7.
43. **A compliance document 61 days from expiry produces no push; at 60 it produces exactly one.**
    Run the sweep three days running; assert one notification. W14.

### 19.5 Notifications and the job queue

44. **Only the four permitted things push.** Generate every alert condition in this document; assert
    exactly four notification types are created and the rest are digest sections. W14.
45. **`p2_notifications.type` accepts this document's four values and every value that was there
    before** — `factory-os.md` §11.8's four and `nexflow-intelligence.md` §9.4's two. Read the live
    constraint and assert the full set. §0 C10.

### 19.6 Isolation, roles and the boundaries

46. **`work-view` selects from no payroll table.** Assert on the **function's source**, not on its
    output: zero occurrences of `p2_payroll`, `p2_wage`, `p2_worker_payroll_identity`,
    `p2_worker_advances`. W6.
47. **No principal-facing RPC returns any column from any table in this document.** Inspect
    `get_principal_vendor_production()`'s and `get_principal_vendor_material()`'s returned column
    lists — not their values. §11.4.
48. **`p2_worker_payroll_identity` is unreadable by a supervisor.** Query it as a supervisor session;
    expect zero rows, not an error. W6.
49. **A payslip link without the second factor returns nothing.** And the second factor is
    rate-limited and locks out. W6.
50. **All 38 tables are unreadable cross-tenant.** Query as tenant B for tenant A's rows; expect zero
    from every one.
51. **An `operator` is refused payroll server-side, before any computation.** §12.15.
52. **A `storekeeper` can write the gate log and cannot read payroll.**
53. **A Lite tenant's surfaces are absent**, and a direct POST is refused. §13.5.
54. **A tenant with every module flag false sees no new navigation.** W13.

### 19.7 Regression against the live product

55. **The Type A test.** On a copy of SS Engineering's data with every module flag false: material
    list, stock balances, CA export, Tally export, GSTR-2B buckets, challan PDFs, invoice PDFs, the
    filing package zip's file list, and a fixed set of agent answers are **byte-identical** before
    and after every migration in §12.14. *Any difference means the change is wrong, not that the test
    needs updating* (`kpml-network-plan.md` §2).
56. **`node _ai/regression/snapshot.js` diffed against the most recent prior snapshot shows no change
    attributable to any migration here.** Not `baseline-pre-2H.json` `[VERIFIED]`.
57. **The read layer's 28 intents behave identically.**
58. **`factory-os.md`'s acceptance tests still pass in full**, in particular §18.2's consumption
    invariant — this document adds `asset_id` to `p2_production_orders` and must not touch F3.
59. **The test tenant's `agent_tier` is still `'unlimited'`** after every migration. `CLAUDE.md`'s
    standing check — run it explicitly.
60. **A dispatch, a GRN and an invoice created with every module flag false are byte-identical to one
    created before the migrations.** The gate-log link, the `asset_id` column and
    `expected_scrap_pct` are all nullable and NULL must mean exactly today's behaviour.

---

*Last updated: 14 September 2026. Design complete; no code written.*

*This is a living document. As it is built, move `[RECOMMENDED]` to `[DECIDED]`, close open
questions, and replace every `[UNVERIFIED]` with a measured or confirmed value — the same convention
`enterprise-strategy.md`, `automation-strategy.md`, `bridge-agent.md`, `nexflow-agent.md`,
`factory-os.md`, `nexflow-mcp.md` and `nexflow-intelligence.md` all use.*

*Three things in particular must be written back here the day they are known. **§18 Q1's eleven
statutory parameters** are the gate on every session from 7 to 11 and the document is deliberately
useless without them — a CA's written confirmation, with a date and a name, seeded into
`p2_statutory_rates`. **§18 Q3's device capture** answers every question in §3.5 in one afternoon
with one ₹10,000 device, and writing the parser from this document instead is how a session spends
two days on a protocol it could have observed. And **§13.3's founder hours** decide how many clients
this module can have — the compute cost is ₹100 a year and irrelevant; the twelve to twenty hours
are the entire cost of goods, and the 15-client cap stands or falls on them.*

*And one thing that must not be forgotten in the first session that touches `factory-os.md`:
**§11.5's sixteen amendments.** A design document that contradicts a shipped module is worse than no
design document, and F11 is the one that matters — narrow it, do not delete it, and leave the
sentence about piece rates standing with its reason attached.*
