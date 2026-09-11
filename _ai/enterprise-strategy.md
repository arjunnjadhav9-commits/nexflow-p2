---
name: enterprise-strategy
description: Nexflow Enterprise tier — Bridge Agent, AI Filing Package, HSN autofill, full export, CA Tally integration, data sovereignty, PVT LTD structure, build sequence and pricing. Read before executing any Enterprise feature.
sources: [founder-decisions-sept-2026, midc-pvt-ltd-owner-feedback, tally-xml-gateway-research, gstn-offline-tool-template-v2.0]
last_updated: 7 September 2026
status: living document — update in place, do not fork
---

# Nexflow — Enterprise Strategy

**Load order for a new session:** `_ai/CLAUDE.md` → this file → `_ai/kpml-network-plan.md` → `_ai/codebase-audit.md`.

This document is the build spec for everything Nexflow does *beyond* the operational core.
It exists because a PVT LTD factory owner in MIDC looked at the product, said "this is
perfect for proprietors and partnerships," and then explained — accurately — why his own
company could never buy it. Everything here is the answer to that sentence.

## Tag convention

| Tag | Meaning |
|---|---|
| `[DECIDED]` | The founder has decided this. Do not relitigate. Build it as written. |
| `[RECOMMENDED]` | This document's recommendation. Needs founder sign-off before build. |
| `[VERIFIED]` | Technical fact confirmed against primary sources (7 Sept 2026). Safe to build on. |
| `[UNVERIFIED]` | Needs a live check before code is written. Every instance is listed again in §9. |
| `[NEVER]` | Permanently out of scope. See §8. |

---

## 1. What Nexflow Is Becoming

Nexflow started as a raw-material and inventory tracker for one MIDC factory. It is becoming
**the operational system of record for a manufacturing cluster, with a compliance layer bolted
to it and a one-way pipe into whatever accounting software the client already owns.**

That sentence contains the whole strategy, and each clause is load-bearing.

**Operational system of record.** Nexflow owns what happens on the floor: material in,
material consumed, material moved, material owned by someone else, work in progress, finished
goods out, challans, invoices, physical counts. This is the layer Tally has never served well
and never will — Tally is an accounting system with an inventory module attached, and its
inventory module has no concept of *whose material this is*, which is the single fact that
matters in a job-work cluster.

**Compliance layer.** Because Nexflow holds the transactions at source, it can produce GSTR-1
Table 12 and Table 13, GSTR-2B reconciliation, ITC-04 working papers, s.143 clocks and 43B(h)
exposure as a by-product of work already done. Nobody re-keys anything. This is the CA-facing
half of the product and it is what makes a CA recommend it.

**One-way pipe into the incumbent.** Nexflow never asks a client to leave Tally. Ten years of
a PVT LTD's books do not migrate, should not migrate, and the request to migrate them is what
ends the sale. Instead Nexflow pushes the four document types that matter — sales, purchase,
credit note, debit note — into Tally automatically, and leaves everything else alone. Nexflow
is upstream of Tally, not a replacement for it.

### The four segments

Nexflow serves four segments out of one codebase, one schema, and zero customer-specific
logic. That constraint is inherited unchanged from `kpml-network-plan.md` §2 and is
non-negotiable.

```
                          NEXFLOW CORE
       (GRN · dispatch · challan · invoice · stock · BOM · WIP ·
        ownership pools · movement purpose · CA exports · payments)
                                |
        +-----------------------+-----------------------+
        |                       |                       |
  +-----v------+         +------v-------+        +------v-------+
  | SEGMENT 1  |         |  SEGMENT 3   |        |  SEGMENT 4   |
  | Sole prop  |         |   PVT LTD    |        |  Principal   |
  | SEGMENT 2  |         |              |        |    (KPML)    |
  | Partnership|         |  = CORE      |        |              |
  |            |         |  + ENTERPRISE|        |  = CORE      |
  | = CORE     |         |              |        |  + PRINCIPAL |
  | (no Tally) |         | Bridge Agent |        |    DASHBOARD |
  |            |         | AI Filing    |        |  + s.143     |
  |            |         | HSN autofill |        |  + ITC-04    |
  |            |         | Full export  |        |  + vendor net|
  +------------+         +--------------+        +--------------+
        |                       |                       |
        +--------- CA TALLY INTEGRATION (§3.5) ----------+
               optional, free, one CA per tenant
```

### How Core and Enterprise relate

Enterprise is **not a different product and not a different codebase.** It is Core plus four
additive capabilities, three of which live inside the existing Supabase/Vercel stack and one
of which is a small Windows binary the client installs. Nothing in Enterprise changes a single
Core behaviour. A Core client who never buys Enterprise sees no difference — exactly as
SS Engineering must see no difference from any job-work feature (the Type A guarantee,
`kpml-network-plan.md` §2).

| | Core | Enterprise |
|---|---|---|
| Everything in Lite / Pro | yes | yes |
| One-click full export | yes (free, all plans) | yes |
| AI HSN autofill | yes (free, all plans) | yes |
| Monthly AI Filing Package | no | yes |
| Bridge Agent → their own Tally | no | yes |
| CA Tally integration | yes (free, opt-in) | yes |
| Requires Pro | — | yes |

Two of the four Enterprise-labelled features ship to **everyone**, free. That is deliberate.
Full export is the answer to the bus-factor objection and it is worthless as a paid upsell — a
client who has to pay to get their data out has not been reassured. HSN autofill is a
correctness feature; a wrong HSN is a filing error whether the tenant pays ₹56,000 or
₹1,00,000 a year, and gating it would mean knowingly shipping worse filing data to the cheaper
tier. What Enterprise actually sells is **the Bridge Agent and the monthly filing package** —
the two things that cost real money and real support hours to run.

### Why this positioning is defensible

Four reasons, in descending order of strength.

1. **Nexflow holds the data at the moment it is created; Tally receives it after the fact.**
   A GRN happens at the gate on a storekeeper's phone. An invoice happens when a dispatch is
   confirmed. Tally receives that hours or weeks later, retyped by somebody. Whoever captures
   the transaction at source owns the truth, and no accounting package is going to be installed
   at a factory gate. This is a structural position, not a feature.

2. **The ownership dimension is invisible to every accounting system in this market.**
   `owned_by` — whose material this is — has no equivalent in Tally, Busy, Zoho, or SAP's
   vendor view. It is the entire basis of s.143 compliance, ITC-04, and the KPML network. A
   competitor cannot bolt it on without rebuilding their inventory model.

3. **Nexflow makes the CA's month shorter, and the CA is the referral channel in this market.**
   A factory owner asks their CA before buying software. A CA who saves three hours per client
   per month recommends the software to every client they have. Nothing about that channel is
   available to a vendor who competes with Tally; it is only available to a vendor who *feeds*
   Tally. This is why §3.5 exists.

4. **The network effect is real but slow, and should not be leaned on yet.** Every job worker
   who records a principal creates a pending link; every principal who joins brings a warm
   vendor list. That compounds — over years. It is not what closes the next sale. Do not put it
   in a pitch as if it were.

**The one-sentence version, for a sales conversation:**

> *"We don't touch your books. We fix the two hours before your books — the part where somebody
> types your challans and invoices into Tally by hand, and gets one HSN code wrong, and your
> filing is wrong for the month."*

---

## 2. Market Segments and Product Fit

All four segments live in MIDC industrial estates in Maharashtra — Karad, Satara, and the
surrounding cluster. Every observation below is grounded in the three live tenants
(SS Engineering, Datta Prasad Enterprises, Shivprasad Industries), the KPML relationship, and
the PVT LTD owner's demo feedback.

### Segment 1 — Sole proprietors

**Who they are.** One owner, GST-registered, 5–25 workers, turnover typically ₹50 lakh to
₹3 crore. The owner is usually also the production planner, the buyer and the salesman. The
books are a part-time CA's problem and the owner sees them once a year. Frequently there is no
accounting software in the factory at all — the CA holds Tally at their own office. The
owner's actual tools are a paper challan book, WhatsApp, and a diary.

**Their pain.**
- No idea what stock they hold until somebody physically walks the store.
- Challan books with hand-written serials, gaps nobody can explain, and no retained copy.
- A month-end ritual of collecting purchase bills into a plastic folder, sending them to the
  CA, and waiting to be told what they owe.
- Material dispatched and never invoiced, because the invoice depended on somebody remembering.
- Payment chasing done from memory.

**What Nexflow gives them.** The whole of Core, and it needs no Enterprise anything. GRN on a
phone, dispatch with a printed challan that is Rule 55-shaped, invoice generated from the
dispatch, a stock balance that is a real sum of a real ledger, physical stock count with
variance posting, Telegram alerts, Marathi UI, CA export, and GSTR-2B reconciliation on Pro.
`is_job_worker = false` keeps every job-work surface hidden.

**What it does NOT give them.** No accounting. No P&L, balance sheet, trial balance, ledgers,
bank reconciliation, TDS or payroll. No GST filing — Nexflow produces the data, the CA files
it. No income tax anything. If a proprietor asks Nexflow to replace their CA, the answer is no.

### Segment 2 — Partnerships

**Who they are.** Two to four partners, usually family. Structurally almost identical to
Segment 1 in operations, with two differences that matter: partners argue about numbers, and a
partnership deed creates a formal profit-sharing obligation that makes "who took what out of
the business" a live question.

**Their pain.** Everything in Segment 1, plus: partners cannot agree on what the factory
actually holds or produced, because there is no shared record. Disputes are settled by whoever
shouts. A partner joining or leaving means reconstructing history nobody wrote down.

**What Nexflow gives them.** Core, plus multi-user with roles (Pro) — which is the real
differentiator for this segment. Two partners with `owner` and `supervisor` roles looking at
the same stock screen ends a category of argument. Audit-visible transactions with an actor
and a timestamp matter more here than anywhere else.

**What it does NOT give them.** Partner capital accounts, drawings, profit allocation, Form
3CD — all Tally/CA territory. `[NEVER]`, see §8.

> **Flag for a future session:** `p2_dispatch_orders.created_by` currently stores the *tenant*
> id, not the user id (`codebase-audit.md` §6.2). For this segment that is a real gap, not a
> nit — "which partner confirmed this dispatch" is the exact question multi-user is sold on.
> Fix it before pitching multi-user to a partnership.

### Segment 3 — PVT LTD companies

**Who they are.** The segment that produced this document. Incorporated under the Companies
Act: CIN, board of directors, statutory audit, ROC filings, a real CA firm on retainer and
often a full-time accountant on the payroll. Turnover typically ₹5 crore and up. In MIDC these
are the tier-1 and tier-2 suppliers to the OEMs — the companies KPML buys from, and the kind
of company KPML *is*.

**They run TallyPrime and they have ten years of data in it.** This is not negotiable, not
soft, and not an opening position in a negotiation. Tally holds their audited financials,
their ROC-relevant books, their statutory audit trail under Rule 3(1) of the Companies
(Accounts) Rules, and their GST filing history. Their auditor works in it. Their bank asks for
reports out of it. It handles **both** their inventory and their GST filing today.

**Their pain — and it is a different pain from Segments 1 and 2.**
- Tally's inventory module cannot express job work. Free-issue material from a principal
  appears as either nothing or as owned stock. Both are wrong.
- Somebody — usually an accountant earning ₹25,000/month — spends the first ten days of every
  month typing challans and invoices into Tally that already exist on paper.
- HSN codes get typed from memory. **A wrong HSN destroys filing data**, and the mismatch
  surfaces at the buyer's end, in their GSTR-2B, as the supplier's problem.
- GSTR-2B reconciliation is done by eye, in Excel, against a downloaded JSON nobody can read.
- s.143 clocks on outbound job work are not counted by anything.
- The factory floor has no system at all. Tally lives in the accounts office; the store runs on
  a register.

**What Nexflow gives them.** Core **plus Enterprise**: the Bridge Agent, so the ten days of
typing become zero; the monthly AI Filing Package, so GSTR-1 arrives as a GSTN-format Excel
their CA loads into the offline tool; AI HSN autofill, so codes are right at the point of
material creation rather than at the point of filing; and the full export, so "what if you
disappear" has a thirty-second answer.

**What it does NOT give them, and this is the sale.** Nexflow does not touch their books.
No ROC. No MCA. No AOC-4, MGT-7, DIR-3 KYC, board minutes or statutory registers. No financial
statements. No audit-trail claims. No payroll, TDS returns, depreciation, bank reconciliation
or journal entries. **Nexflow never files anything on their behalf and never holds their GST
portal credentials.** Their statutory obligations stay exactly where they are, with their CA
and CS, and the contract says so in writing.

The pitch to this segment is subtraction, not addition:

> *"You keep Tally. You keep your CA. You keep your auditor. We take away the ten days of
> typing and the wrong HSN codes."*

### Segment 4 — Principal companies (the KPML model)

**Who they are.** The buyer at the top of the job-work chain. KPML is the first target; the
same shape applies to any OEM or tier-1 that sends material out. They own the material
throughout (`kpml-network-plan.md` §4), carry the s.143(2) accounting obligation, file ITC-04,
and carry the 43B(h) exposure on unpaid MSME vendor bills. They run SAP for purchase orders and
Tally for GST.

**Their pain.** Fully documented in `kpml-network-plan.md` §3 — statutory exposure they cannot
see, no real-time view of their own material at any vendor, reconciliation that takes three
people and three registers, and a 31-March disallowance number their CA tracks on a spreadsheet.

**What Nexflow gives them.** The read-only principal dashboard (Phase 2, October 2026): their
material at each vendor, s.143 clock status, reconciliation gap, ITC-04 working paper, 43B(h)
exposure per vendor. Plus — orthogonally — Enterprise, if they want their vendor invoices
flowing into their own Tally automatically. That is a separate decision and a separate line
item, not part of the platform fee.

**What it does NOT give them.** No SAP integration `[NEVER]` — SAP is their system, it is
enormous, and any integration would be bespoke work priced as bespoke work, which is exactly
the trap `kpml-network-plan.md` §13 warns against. No visibility into anything a vendor did not
send them — the scoped-access rule of `kpml-network-plan.md` §10.5 is absolute and Enterprise
creates no exception to it. No write access into vendor tenants before the pilot.

### Segment comparison

| | Sole prop | Partnership | PVT LTD | Principal |
|---|---|---|---|---|
| Runs Tally on site | Rarely | Sometimes | **Always** | Always (+ SAP) |
| Years of data to protect | 0–2 | 0–3 | **10+** | 10+ |
| Buying decision made by | Owner's gut | Partner consensus | **CA + board** | CA / accounts head |
| Will it contract with a sole proprietor? | Yes | Yes | **No** | **No** |
| Needs Bridge Agent | No | No | **Yes** | Optional |
| Needs AI Filing Package | Via their CA | Via their CA | **Yes** | Yes |
| Needs full export | Yes | Yes | **Yes (contractual)** | **Yes (contractual)** |
| Needs job work / s.143 | If job worker | If job worker | If job worker | **Always** |
| Nexflow tier | Lite / Pro | Pro | **Enterprise** | Principal account |

---

## 3. Enterprise Architecture

Four components. Built in the order given in §6, not the order given here.

---

### 3.1 Bridge Agent

A small Windows application, installed on the machine that runs TallyPrime, that pushes
confirmed Nexflow transactions into Tally automatically. **One-way only: Nexflow → Tally.
Nexflow is the source of truth.** `[DECIDED]`

#### How it works

```
  Supabase (cloud)                    Client's Windows PC (MIDC factory)
  ┌──────────────────┐                ┌─────────────────────────────────┐
  │ p2_invoices      │                │                                 │
  │ p2_stock_trans.  │                │   Nexflow Bridge Agent          │
  │        │         │   HTTPS poll   │   (system tray, user session)   │
  │        v         │<───────────────│         │                       │
  │ p2_tally_sync_log│   every 60s    │         │ builds XML            │
  │        ^         │                │         v                       │
  │        └─────────│───────────────>│   POST http://127.0.0.1:9000    │
  │   status update  │  outbound only │         │                       │
  └──────────────────┘                │         v                       │
                                      │   TallyPrime  (HTTP server on)  │
                                      │   Company: "ACME ENGG PVT LTD"  │
                                      └─────────────────────────────────┘
```

**Verified technical facts** — confirmed 7 Sept 2026 against Tally Solutions' developer
documentation and the TallyPrime XML gateway:

- `[VERIFIED]` TallyPrime runs an HTTP server on **port 9000** by default (`ServerPort=9000` in
  `tally.ini`), enabled at **F1 (Help) → Settings → Connectivity / Advanced Configuration →
  TallyPrime acts as: Both** (or Server).
- `[VERIFIED]` External applications POST XML to it to create vouchers and masters directly in
  Tally's database. No user interaction with the Tally UI is required.
- `[VERIFIED]` **Tally must be running and the target company must be loaded** for port 9000 to
  answer. If Tally is closed, the connection is refused.
- `[VERIFIED]` The target company is selected by `<SVCURRENTCOMPANY>` inside `<STATICVARIABLES>`
  in the request. **It must match the company name in Tally exactly.** A mismatch either errors
  or is silently ignored — both are failure modes the agent must detect.
- `[VERIFIED]` TallyPrime can load **multiple companies simultaneously** (F1 → Settings →
  Startup → *Load companies on startup*, or Alt+F3 *Select Company*). `SVCURRENTCOMPANY` picks
  among the loaded set. This is what makes §3.5 possible.
- `[VERIFIED]` **Tally.NET Remote Access explicitly blocks data import.** There is therefore no
  cloud-to-Tally write path. A local agent is not one option among several; it is the only
  architecture that works.
- `[VERIFIED]` Import failures are logged by Tally to `Tally.imp` in the TallyPrime installation
  folder, with a per-voucher rejection reason.

#### The XML envelope

Two envelope shapes circulate in the wild. Use the `IMPORTDATA` / `REQUESTDESC` / `REQUESTDATA`
form below — it is the shape Tally's own documentation specifies and the shape Tally itself
emits on export.

> **Build instruction, and this is not optional.** Before writing one line of the XML generator:
> create a scratch company in TallyPrime, enter **one Sales voucher and one Purchase voucher by
> hand** with GST, then export them (Gateway of Tally → Export → Vouchers, format XML). **That
> file is the specification.** Mirror it field for field. The template below is correct as
> researched, but Tally's tag set varies by release and by which GST features are enabled in the
> company, and a hand-made export is the only way to be certain. `[UNVERIFIED — verify per
> installation]`

**Sales voucher (accounting view, no inventory):**

```xml
<ENVELOPE>
 <HEADER>
  <TALLYREQUEST>Import Data</TALLYREQUEST>
 </HEADER>
 <BODY>
  <IMPORTDATA>
   <REQUESTDESC>
    <REPORTNAME>Vouchers</REPORTNAME>
    <STATICVARIABLES>
     <SVCURRENTCOMPANY>DATTA PRASAD ENTERPRISES</SVCURRENTCOMPANY>
    </STATICVARIABLES>
   </REQUESTDESC>
   <REQUESTDATA>
    <TALLYMESSAGE xmlns:UDF="TallyUDF">
     <VOUCHER REMOTEID="nexflow-3b68db90-inv-9f2c41ab"
              VCHTYPE="Sales" ACTION="Create"
              OBJVIEW="Accounting Voucher View">
      <DATE>20260831</DATE>
      <EFFECTIVEDATE>20260831</EFFECTIVEDATE>
      <VOUCHERTYPENAME>Sales</VOUCHERTYPENAME>
      <VOUCHERNUMBER>INV-202608-014</VOUCHERNUMBER>
      <REFERENCE>INV-202608-014</REFERENCE>
      <REFERENCEDATE>20260831</REFERENCEDATE>
      <PARTYLEDGERNAME>Kirloskar Pneumatic Co Ltd</PARTYLEDGERNAME>
      <PARTYNAME>Kirloskar Pneumatic Co Ltd</PARTYNAME>
      <PARTYGSTIN>27AAACK1234M1Z5</PARTYGSTIN>
      <PLACEOFSUPPLY>Maharashtra</PLACEOFSUPPLY>
      <STATENAME>Maharashtra</STATENAME>
      <COUNTRYOFRESIDENCE>India</COUNTRYOFRESIDENCE>
      <GSTREGISTRATIONTYPE>Regular</GSTREGISTRATIONTYPE>
      <PERSISTEDVIEW>Accounting Voucher View</PERSISTEDVIEW>
      <NARRATION>Nexflow INV-202608-014 | challans 1041,1042 | src:nexflow-3b68db90-inv-9f2c41ab</NARRATION>

      <!-- Dr party  (debit  = ISDEEMEDPOSITIVE Yes, AMOUNT negative) -->
      <ALLLEDGERENTRIES.LIST>
       <LEDGERNAME>Kirloskar Pneumatic Co Ltd</LEDGERNAME>
       <ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE>
       <ISPARTYLEDGER>Yes</ISPARTYLEDGER>
       <AMOUNT>-118000.00</AMOUNT>
      </ALLLEDGERENTRIES.LIST>

      <!-- Cr taxable value (credit = ISDEEMEDPOSITIVE No, AMOUNT positive) -->
      <ALLLEDGERENTRIES.LIST>
       <LEDGERNAME>Job Work Charges @ 18%</LEDGERNAME>
       <ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE>
       <AMOUNT>100000.00</AMOUNT>
      </ALLLEDGERENTRIES.LIST>

      <!-- Cr output tax -->
      <ALLLEDGERENTRIES.LIST>
       <LEDGERNAME>Output CGST</LEDGERNAME>
       <ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE>
       <AMOUNT>9000.00</AMOUNT>
      </ALLLEDGERENTRIES.LIST>
      <ALLLEDGERENTRIES.LIST>
       <LEDGERNAME>Output SGST</LEDGERNAME>
       <ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE>
       <AMOUNT>9000.00</AMOUNT>
      </ALLLEDGERENTRIES.LIST>

      <!-- Cr/Dr round off — emit only when p2_invoices.round_off != 0 -->
     </VOUCHER>
    </TALLYMESSAGE>
   </REQUESTDATA>
  </IMPORTDATA>
 </BODY>
</ENVELOPE>
```

**Purchase voucher** is the same envelope with `VCHTYPE="Purchase"`,
`<VOUCHERTYPENAME>Purchase</VOUCHERTYPENAME>`, and the signs inverted:

| Ledger | ISDEEMEDPOSITIVE | AMOUNT |
|---|---|---|
| Purchase @ 18% | `Yes` | `-100000.00` |
| Input CGST | `Yes` | `-9000.00` |
| Input SGST | `Yes` | `-9000.00` |
| Supplier (party) | `No` | `118000.00` |

For an **interstate** transaction (`p2_stock_transactions.purchase_type = 'interstate'`, or an
invoice with `gst_type = 'igst'`) replace the two half-tax ledgers with a single IGST ledger at
the full rate.

**Credit note** → `VCHTYPE="Credit Note"`, **debit note** → `VCHTYPE="Debit Note"`, both with
the party sign reversed relative to the document they amend. *Not buildable yet — Nexflow has no
credit/debit note feature (`CLAUDE.md` Backlog). The Bridge Agent must be written with the
handler present and the source table absent, so it lights up the day CDNs ship.*

**Party ledger creation** (only ever party ledgers — see Limitations):

```xml
<ENVELOPE>
 <HEADER><TALLYREQUEST>Import Data</TALLYREQUEST></HEADER>
 <BODY><IMPORTDATA>
  <REQUESTDESC>
   <REPORTNAME>All Masters</REPORTNAME>
   <STATICVARIABLES>
    <SVCURRENTCOMPANY>DATTA PRASAD ENTERPRISES</SVCURRENTCOMPANY>
   </STATICVARIABLES>
  </REQUESTDESC>
  <REQUESTDATA>
   <TALLYMESSAGE xmlns:UDF="TallyUDF">
    <LEDGER NAME="Kirloskar Pneumatic Co Ltd" ACTION="Create">
     <NAME>Kirloskar Pneumatic Co Ltd</NAME>
     <PARENT>Sundry Debtors</PARENT>
     <ISBILLWISEON>Yes</ISBILLWISEON>
     <PARTYGSTIN>27AAACK1234M1Z5</PARTYGSTIN>
     <GSTREGISTRATIONTYPE>Regular</GSTREGISTRATIONTYPE>
     <COUNTRYNAME>India</COUNTRYNAME>
     <LEDSTATENAME>Maharashtra</LEDSTATENAME>
    </LEDGER>
   </TALLYMESSAGE>
  </REQUESTDATA>
 </IMPORTDATA></BODY>
</ENVELOPE>
```

`PARENT` is `Sundry Debtors` for a client, `Sundry Creditors` for a supplier.

#### The response, and what counts as success

`[VERIFIED]` Tally replies with an `IMPORTRESULT` envelope:

```xml
<ENVELOPE>
 <HEADER><VERSION>1</VERSION><STATUS>1</STATUS></HEADER>
 <BODY><DATA><IMPORTRESULT>
   <CREATED>1</CREATED>
   <ALTERED>0</ALTERED>
   <LASTVCHID>119</LASTVCHID>
   <LASTMID>0</LASTMID>
   <COMBINED>0</COMBINED>
   <IGNORED>0</IGNORED>
   <ERRORS>0</ERRORS>
 </IMPORTRESULT></DATA></BODY>
</ENVELOPE>
```

**Success is `ERRORS = 0` AND `(CREATED + ALTERED) >= 1`. Nothing else.** In particular:

- **HTTP 200 is not success.** Tally returns 200 on failure too.
- `IGNORED > 0` is a failure for our purposes — the voucher did not land.
- A failure response carries a `<LINEERROR>` element with the reason. Store it verbatim in
  `last_error`; it is the only diagnostic the client will ever have.
- **An out-of-balance voucher imports successfully.** Tally accepts it and flags it internally
  rather than rejecting it. The agent must therefore assert
  `sum(AMOUNT) == 0` (to the paisa) **before posting**, and refuse to post otherwise. This is
  the single most damaging silent failure available and it must be guarded client-side.

#### Source tables and voucher mapping

| Nexflow source | Filter | Tally voucher | Trigger |
|---|---|---|---|
| `p2_invoices` | `status = 'sent'` | **Sales** | on status flip to `sent` |
| `p2_invoices` | `status = 'cancelled'` | **Sales**, `ACTION="Alter"` + `<ISCANCELLED>Yes</ISCANCELLED>` | on cancel |
| `p2_stock_transactions` | `transaction_type = 'grn'` **AND `owned_by IS NULL`**, grouped by `(supplier_id, normaliseInvoiceNo(invoice_no))` | **Purchase** | on GRN confirm |
| credit / debit notes | — | Credit Note / Debit Note | blocked: feature not built |
| `p2_payment_receipts` | — | Receipt | **deferred**, see §9 Q7 |
| `p2_supplier_advances` | — | Payment | **deferred**, see §9 Q7 |

**Two hard invariants. Violating either corrupts a real company's statutory books.**

1. **`owned_by IS NOT NULL` GRN rows must NEVER become Purchase vouchers.** Principal-owned
   free-issue material under s.143 has no supplier invoice, no purchase, and no ITC. Pushing it
   to Tally inflates purchases and claims input credit that does not exist. This is the most
   dangerous possible bug in the entire Bridge Agent. Assert it in the query, assert it again in
   the builder, and add a regression test.

2. **Job-work dispatches must never become Sales vouchers.** This is already enforced upstream —
   `SALE_INVOICEABLE_PURPOSES` in `agent-query/index.ts` (Session 6 P0) restricts invoice
   generation to `sale` and `direct_supply_from_jobworker`. Syncing **from `p2_invoices`, never
   from `p2_dispatch_orders`,** inherits that guard for free. That is the reason for the choice.
   Do not "optimise" it into a dispatch-driven sync.

**GRN grouping.** One supplier invoice can span several `p2_stock_transactions` rows (a
multi-material delivery). One supplier invoice must become exactly **one** Purchase voucher.
Group by `(supplier_id, normaliseInvoiceNo(invoice_no))` before building — the same
normalisation the GSTR-2B reconciliation uses: `str.replace(/[\s\-\/]/g, '').toUpperCase()`.

#### Sync state design — `[RECOMMENDED]` a log table, not a boolean flag

Do **not** add a `tally_synced boolean` column to `p2_invoices` and `p2_stock_transactions`.
Three reasons:

- A boolean cannot express *attempted, failed, retry 3, last error was "Ledger does not exist"*.
- The GRN source is not a row but a **group** of rows. There is no single row on which a boolean
  would be correct.
- Adding write paths to `p2_stock_transactions` — the largest and most heavily-flagged table in
  the audit — for bookkeeping metadata is the wrong trade.

**New table:**

```sql
CREATE TABLE p2_tally_sync_log (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL,
  target        text NOT NULL CHECK (target IN ('factory','ca')),
  doc_type      text NOT NULL CHECK (doc_type IN ('sales','purchase','credit_note','debit_note')),
  source_table  text NOT NULL,          -- 'p2_invoices' | 'p2_stock_transactions'
  source_key    text NOT NULL,          -- invoice uuid, or 'supplier_id|NORMALISEDINVNO'
  remote_id     text NOT NULL,          -- the REMOTEID sent to Tally. Stable forever.
  company_name  text NOT NULL,          -- exact SVCURRENTCOMPANY used
  period        text NOT NULL,          -- 'YYYY-MM' of the document date, for period locking
  status        text NOT NULL DEFAULT 'pending'
                CHECK (status IN ('pending','sent','failed','skipped','conflict')),
  attempts      int  NOT NULL DEFAULT 0,
  last_error    text,
  tally_vch_id  text,                   -- LASTVCHID from IMPORTRESULT
  payload_hash  text,                   -- sha256 of the XML; detects source drift after send
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, target, source_table, source_key)
);
```

```sql
CREATE TABLE p2_tally_targets (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         uuid NOT NULL,
  target            text NOT NULL CHECK (target IN ('factory','ca')),
  company_name      text NOT NULL,      -- exact Tally company name
  ledger_map        jsonb NOT NULL,     -- see below
  filed_through     date,               -- period lock: never write on or before this
  enabled           boolean NOT NULL DEFAULT true,
  agent_token_hash  text NOT NULL,
  last_seen_at      timestamptz,        -- agent heartbeat
  created_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, target)
);
```

`ledger_map` names the client's own chart of accounts and is filled once at install:

```json
{
  "sales_taxable":  "Job Work Charges @ 18%",
  "sales_goods":    "Sales @ 18%",
  "purchase":       "Purchase @ 18%",
  "output_cgst":    "Output CGST",
  "output_sgst":    "Output SGST",
  "output_igst":    "Output IGST",
  "input_cgst":     "Input CGST",
  "input_sgst":     "Input SGST",
  "input_igst":     "Input IGST",
  "round_off":      "Round Off",
  "debtors_parent": "Sundry Debtors",
  "creditors_parent": "Sundry Creditors"
}
```

**RLS:** both tables use `get_my_tenant_id()`, three command-scoped policies (SELECT / INSERT /
UPDATE), no DELETE — modelled on `p2_notifications`, which the audit calls the reference
implementation. **Enable RLS explicitly in the same migration** — the audit's single largest
finding is fifteen tables that got a policy and never got `ENABLE ROW LEVEL SECURITY`.

**`remote_id` format:** `nexflow-<tenant_id first 8>-<doctype>-<source_key hash first 8>`.
It must be **deterministic and permanent** — regenerating it turns an update into a duplicate.

#### Idempotency and duplicate prevention

`[VERIFIED]` Tally's own mechanism: a voucher carrying a `REMOTEID` is matched on re-import when
**F12 → Configure → "Overwrite Vouchers during import (where voucher Remote GUID matches)"** is
enabled. Same `REMOTEID` → altered in place. Different or absent → a new voucher.

This gives three layers, and all three are required:

1. **Nexflow side.** The `UNIQUE (tenant_id, target, source_table, source_key)` constraint means
   a document can be queued exactly once. The agent can crash, restart, or run twice with no
   double-post.
2. **Tally side.** A stable `REMOTEID` plus the overwrite setting makes re-posting idempotent.
   **The installer must verify that setting is on and refuse to proceed if it is off.**
3. **Pre-flight.** Before the first sync of any period, the agent issues an **export** request
   for existing vouchers in that date range and compares voucher numbers. Anything already
   present *without* a matching `REMOTEID` is a human-typed duplicate: mark the row
   `status = 'conflict'`, never overwrite, and surface it for a decision.

#### Queue and retry strategy

```
poll every 60s (configurable 30–300s)
  → SELECT * FROM p2_tally_sync_log
      WHERE tenant_id = :t AND target = 'factory'
        AND status IN ('pending','failed') AND attempts < 5
        AND period > COALESCE(:filed_through_period, '0000-00')
      ORDER BY created_at ASC LIMIT 25
  → for each row:
       build XML → assert sum(AMOUNT) == 0 → POST 127.0.0.1:9000 (10s timeout)
       parse IMPORTRESULT
         ERRORS=0 && CREATED+ALTERED>=1 → status='sent', tally_vch_id=LASTVCHID
         otherwise                       → classify (below)
```

**Failure classification is the core of the design.** Treating everything as one kind of failure
either spams the client or hides real errors.

| Class | Examples | attempts++ | Backoff | Alert |
|---|---|---|---|---|
| **Environmental** | connection refused, Tally closed, company not loaded, timeout | **No** | fixed 60s | only after 24h with a non-empty queue |
| **Transient** | Tally busy, mid-backup, HTTP 5xx | Yes | 1m → 5m → 15m → 1h → 6h | at attempts = 5 |
| **Permanent** | `LINEERROR: Ledger 'X' does not exist`, invalid date, company in educational mode | Yes, straight to 5 | none | immediately |
| **Conflict** | pre-flight found a human-typed voucher with the same number | n/a → `conflict` | none | immediately |

Environmental failures **must not** consume retry attempts. Tally being closed overnight is the
normal state of the world, not an error, and a design that burns five attempts every night is
useless by morning.

#### What happens when Tally is closed

The connection to `127.0.0.1:9000` is refused. That is the expected state for roughly sixteen
hours a day.

- Status stays `pending`. No attempt is consumed. No alert.
- The tray icon shows amber with a count: *"14 documents waiting — Tally is not running."*
- Only when Tally has been unreachable for **more than 24 continuous hours** *and* the queue is
  non-empty does the agent raise one Telegram notification through the existing `notify` Edge
  Function, and one in-app `p2_notifications` row:
  > *Tally has not been reachable since 4 Sep. 14 documents are waiting to sync. Open TallyPrime
  > and load "ACME ENGG PVT LTD".*
- **The alert is rate-limited to one per 24 hours per tenant.** The notification pipeline
  currently has zero retries and six silent-failure points (`codebase-audit.md` §4.5) — do not
  add a chatty producer to it.

#### Error handling and alerting

- **Per-document errors** appear on a new **Tally Sync** panel in `settings.html` (owner and
  accountant only): document, date, status, attempts, the verbatim `LINEERROR`, and a Retry
  button. This is the only diagnostic surface the client gets and it must be plain English above
  the raw error, not instead of it.
- **Ledger-does-not-exist** is the single most common permanent failure and it has a specific
  remedy: the panel shows *"Tally has no ledger named 'Output CGST'. Ask your accountant for the
  exact name and update it in Tally Settings."*, linking straight to the `ledger_map` editor.
- **Agent heartbeat.** The agent PATCHes `p2_tally_targets.last_seen_at` every poll. If it goes
  stale for 48 hours, the panel shows *"The Bridge Agent has not checked in since ..."* — this
  catches an uninstalled or crashed agent, which otherwise looks identical to a quiet month.
- Never surface a raw Postgres or HTTP error to the client. That habit is already flagged
  repeatedly in the audit.

#### Windows installer approach — `[RECOMMENDED]`

**A system-tray application in the user's session, not a Windows Service.**

The instinct is a service. It is wrong here. Tally only runs in an interactive logged-in
session, so a `LocalSystem` service running at 3 a.m. cannot reach a Tally that is not running
either — it buys nothing. Meanwhile a tray app: needs no administrator rights to install (which
matters enormously on an MIDC factory PC that nobody administers), gives the owner a visible
green/amber/red status they can point at, and can be quit and restarted by a human without
`services.msc`.

| Concern | Choice |
|---|---|
| Runtime | Node.js single-file executable (Node SEA or `pkg`) — reuses the codebase's language, no new toolchain |
| Auto-start | `HKCU\Software\Microsoft\Windows\CurrentVersion\Run` — per-user, no admin |
| Installer | Inno Setup, one `.exe`, no admin required |
| Credentials | Windows Credential Manager (DPAPI), never a plaintext file |
| UI | Tray icon + a small window: status, queue count, last sync, error list, Retry, Pause |
| Config | Pairing code, Tally host/port (default `127.0.0.1:9000`), company name **chosen from a dropdown the installer populates by probing Tally**, and the `ledger_map` |
| Auto-update | **Required from v1.** Version check on start and daily; download, verify, self-replace, restart. A solo developer cannot support forty factories on six agent versions. |
| Code signing | Required, or SmartScreen will block every install. An EV/OV certificate needs a registered legal entity — **another reason PVT LTD incorporation comes first** (§5) |

**Pairing and auth.** The agent must never hold the tenant's password. In Settings the owner
generates a short-lived pairing code; the agent exchanges it once for a long-lived, revocable
**agent token** scoped to exactly one tenant, with permission to read `p2_tally_sync_log` and
write its status columns and `p2_tally_targets.last_seen_at` — nothing else. Stored via DPAPI.
Revocable from Settings with one click. This is also the answer to "the factory PC was stolen."

**Network posture, and it is not negotiable.** The agent is **outbound-only**. It polls Supabase
over HTTPS and posts to `127.0.0.1`. It opens no listening port. **Port 9000 is never exposed to
the internet or to the LAN beyond the Tally host, and no client is ever asked to port-forward
it** — the Tally XML gateway is entirely unauthenticated, so anyone who can reach it can read
and rewrite the company's books.

#### Limitations — state these honestly, in the sales meeting

- Tally must be **running**, with the target company **loaded**. Nothing syncs while it is closed.
- `SVCURRENTCOMPANY` must match exactly. **Renaming the company in Tally breaks the link** until
  the mapping is updated. The pre-flight probe detects this and pauses rather than failing per
  document.
- Ledger names must pre-exist and be mapped. The agent creates **party ledgers only** — it never
  invents a sales, purchase, tax or round-off ledger. Guessing at a CA's chart of accounts is how
  you corrupt somebody's books.
- **Accounting vouchers only, no inventory.** Tally receives values, not stock items. Nexflow
  remains the inventory system of record. See §3.5 for why this boundary is deliberate.
- **TallyPrime only.** Tally.ERP 9 speaks a similar dialect but its GST tags differ. Do not
  support it.
- Tally in **educational mode** restricts voucher dates. The agent must detect this on the
  pre-flight probe and refuse to sync rather than post garbage. `[UNVERIFIED — confirm the probe
  response shape]`
- Multi-user Tally (Gold / Server) exposes one gateway per running instance. The agent points at
  exactly one instance. Two accountants' PCs both running the agent against the same company is a
  configuration error the pairing flow must prevent (one `factory` target per tenant, enforced by
  the UNIQUE constraint).
- No transactional guarantee across documents. Each voucher is independent; a batch can land
  half-complete. The sync log is the reconciliation record.

#### Explicitly out of scope for the Bridge Agent `[NEVER]`

- **Reading Tally data into Nexflow.** Read requests are permitted *only* for verification —
  company list, pre-flight duplicate check, educational-mode probe. **No Tally data is ever
  written into any Nexflow table.** One-way means one-way.
- Stock items, inventory vouchers, godowns, batches, cost centres.
- Journal entries, contra, payroll, TDS, depreciation, bank reconciliation.
- Opening balances or migration of historical data. The client's ten years stay where they are.
- Creating or altering any non-party master.
- Writing into a period on or before `filed_through`. Once the CA has filed a month, that month
  is frozen.
- Deleting anything in Tally, ever, under any circumstance.

---

### 3.2 Monthly AI Filing Package

Once a month, per tenant, Nexflow produces a zip file that contains everything the client's CA
needs to file GSTR-1 and GSTR-3B — in the exact formats the CA already works with — plus a
plain-English note about what will go wrong if they file it as-is.

**Model: Claude Opus (`claude-opus-5`).** `[DECIDED]`

#### The design rule that makes this safe

**Deterministic code computes every number. The model never does arithmetic.**

This split is the difference between a useful product and a liability, and it must not be
softened in implementation:

| Job | Who does it |
|---|---|
| Aggregate invoices into b2b / b2cl / b2cs rows | **Code** — reuses the existing `computeHsnSummary` and `computeTable13Buckets` from `export.html`, so the package can never numerically diverge from what Table 12/13 show on screen |
| HSN summary, document register, tax totals | **Code** |
| GSTR-2B bucket matching | **Code** — the existing `gstr2b-reconcile.html` logic |
| ITC-04 Tables 4 / 5A / 5B / 5C | **Code** — Phase 3 |
| Write the exceptions report and the covering note | **Opus** |
| Judge whether a line is misclassified (product HSN on a job-work charge, wrong POS, malformed GSTIN, missing HSN, a challan that looks like an invoice) | **Opus** |
| Rank the exceptions by what would actually cause a filing problem | **Opus** |

The model reads computed totals and a bounded set of flagged rows. It never sees a month of raw
invoice lines and is never asked to add anything up.

#### Why Opus and not Haiku

Haiku 4.5 is correct for `agent-query`, where the task is "pull three fields out of one Marathi
sentence." This is a different task:

- It reasons across a whole month of heterogeneous rows and three independent aggregations that
  must tie out to the rupee.
- It has to *notice* things nobody asked about — an invoice described as "stator winding charges"
  carrying product HSN 8501 instead of SAC 998898, a B2B invoice whose GSTIN state code does not
  match its place of supply, a job-work challan sitting in a series that also contains tax
  invoices.
- It writes something a chartered accountant will read and act on. Register and precision matter.
- **It runs once per tenant per month.** Cost is a rounding error against the cost of one wrong
  filing. Choosing the cheaper model here to save ₹20 would be an unforced error.

#### Trigger

- **Automatic:** pg_net cron, **08:00 IST on the 5th of each month** for the month just ended
  (after the month closes, well before the 11th GSTR-1 deadline). New Edge Function
  `filing-package`. New cron jobid; the existing pattern from jobids 2/3/8 applies — anon key in
  the Authorization header, `verify_jwt = false`, service role inside.
- **Manual:** a "Generate Filing Package" button on `export.html`, roles
  `['owner','accountant','supervisor']`, any month.
- **Delivery:** Supabase Storage, private bucket, signed URL valid 7 days. Notification to the
  owner (in-app bell + Telegram) and — if `ca_email` is set — an email via Resend, reusing the
  existing `send_tally_export` mail path.
- Enterprise plans only. Core tenants get the same underlying data through `export.html`
  manually; what Enterprise buys is that it arrives without anybody asking.

#### What is in the zip

```
Nexflow-Filing-Package-<COMPANY>-<YYYY-MM>.zip
├── 00-READ-THIS-FIRST.html         Opus-written covering note for the CA
├── 01-GSTR1-<GSTIN>-<MMYYYY>.xlsx  GSTN Excel Workbook Template format (below)
├── 02-GSTR2B-Reconciliation.xlsx   4 buckets — only if a 2B was uploaded for the period
├── 03-ITC-04-Working-Paper.xlsx    Tables 4 / 5A / 5B / 5C — job workers only, needs Phase 3
├── 04-Purchase-Register.xlsx       supplier-wise, for the GSTR-3B ITC figure
├── 05-Exceptions-and-Actions.xlsx  every anomaly, ranked, with the source row
├── 06-Tally-Vouchers.xml           the same month as Tally import XML (fallback if no agent)
└── 07-Source-Data/                 raw CSV of every row the package was built from
```

`07-Source-Data/` is not padding. It makes the package **auditable**: a CA who does not trust a
number can find the row that produced it in under a minute. Without it, the package is a black
box asking for trust, which is precisely what a CA will not give it.

#### 01 — the GSTR-1 workbook, exact structure

`[VERIFIED]` The structure below was read directly out of **GSTR1_Excel_Workbook_Template
V2.0**, the GSTN-published template consumed by the Returns Offline Tool. Sheet names, column
headers, header row position and dropdown vocabularies are transcribed from the file itself, not
from documentation about it.

**Workbook shape.** 21 worksheets in this order — `Help Instruction`, `b2b,sez,de`, `b2ba`,
`b2cl`, `b2cla`, `b2cs`, `b2csa`, `cdnr`, `cdnra`, `cdnur`, `cdnura`, `exp`, `expa`, `at`, `ata`,
`atadj`, `atadja`, `exemp`, `hsn`, `docs`, `master`. **Generate all of them**, populating only
those that apply; the offline tool's group-import path expects the full standard shape. Note the
V2.0 names: the first sheet is **`b2b,sez,de`** (comma included) and the last data sheet is
**`docs`**, not `doc`.

**Row layout on every data sheet:** rows 1–3 are the summary block, **row 4 is the header row**,
data starts at **row 5**. Do not move it.

**Sheets Nexflow populates:**

`b2b,sez,de` — Table 4A/4B/6B/6C, B2B invoices

| Col | Header |
|---|---|
| A | `GSTIN/UIN of Recipient` |
| B | `Receiver Name` |
| C | `Invoice Number` |
| D | `Invoice date` |
| E | `Invoice Value` |
| F | `Place Of Supply` |
| G | `Reverse Charge` |
| H | `Applicable % of Tax Rate` |
| I | `Invoice Type` |
| J | `E-Commerce GSTIN` |
| K | `Rate` |
| L | `Taxable Value` |
| M | `Cess Amount` |

`b2cl` — Table 5, B2C large (interstate, above threshold)

| Col | Header |
|---|---|
| A | `Invoice Number` |
| B | `Invoice date` |
| C | `Invoice Value` |
| D | `Place Of Supply` |
| E | `Applicable % of Tax Rate` |
| F | `Rate` |
| G | `Taxable Value` |
| H | `Cess Amount` |
| I | `E-Commerce GSTIN` |

`b2cs` — Table 7, B2C small (rate-and-POS summary, not per invoice)

| Col | Header |
|---|---|
| A | `Type` |
| B | `Place Of Supply` |
| C | `Applicable % of Tax Rate` |
| D | `Rate` |
| E | `Taxable Value` |
| F | `Cess Amount` |
| G | `E-Commerce GSTIN` |

`cdnr` — Table 9B, credit/debit notes to registered persons

| Col | Header |
|---|---|
| A | `GSTIN/UIN of Recipient` |
| B | `Receiver Name` |
| C | `Note Number` |
| D | `Note Date` |
| E | `Note Type` |
| F | `Place Of Supply` |
| G | `Reverse Charge` |
| H | `Note Supply Type` |
| I | `Note Value` |
| J | `Applicable % of Tax Rate` |
| K | `Rate` |
| L | `Taxable Value` |
| M | `Cess Amount` |

`hsn` — Table 12, HSN/SAC summary

| Col | Header |
|---|---|
| A | `HSN` |
| B | `Description` |
| C | `UQC` |
| D | `Total Quantity` |
| E | `Total Value` |
| F | `Rate` |
| G | `Taxable Value` |
| H | `Integrated Tax Amount` |
| I | `Central Tax Amount` |
| J | `State/UT Tax Amount` |
| K | `Cess Amount` |

`docs` — Table 13, documents issued

| Col | Header |
|---|---|
| A | `Nature of Document` |
| B | `Sr. No. From` |
| C | `Sr. No. To` |
| D | `Total Number` |
| E | `Cancelled` |

`cdnur`, `exemp`, `exp`, `at`, `atadj` — present, headers correct, **empty** unless the tenant
actually has such supplies. Every `*a` amendment sheet is present and empty.

**Formatting rules — every one of these is a hard requirement, not a preference:**

| Field | Rule |
|---|---|
| All dates | `DD-MMM-YYYY`, e.g. `31-Aug-2026`. Written as a **text string**, not an Excel date serial |
| Invoice / note number | alphanumeric, only `/` and `-` allowed, **maximum 16 characters** |
| All amounts | at most **2 decimal places** |
| `Place Of Supply` | exact string from the 38-value list: `27-Maharashtra`, `29-Karnataka`, `24-Gujarat`, `97-Other Territory`, … |
| `Reverse Charge` | `Y` or `N` |
| `Invoice Type` | one of `Regular B2B`, `SEZ supplies with payment`, `SEZ supplies without payment`, `Deemed Exp`, `Intra-State supplies attracting IGST`. Nexflow emits **`Regular B2B`** for everything it produces today |
| `Applicable % of Tax Rate` | **blank**. Only used for the 65% concessional case, which does not apply |
| `Rate` | the **combined** rate (`18`), never the CGST/SGST halves |
| `b2cs.Type` | `OE` (other than e-commerce) |
| `Note Type` | `C` (credit) or `D` (debit) |
| `UQC` | exact string from the 45-value list: `NOS-NUMBERS`, `KGS-KILOGRAMS`, `MTR-METERS`, `LTR-LITRES`, `PCS-PIECES`, `SQM-SQUARE METERS`, `CBM-CUBIC METERS`, `OTH-OTHERS` |
| `Cess Amount` | `0` |

**UQC mapping.** Nexflow stores a bare code in `p2_raw_materials.uqc` / `p2_products.uqc`
(`NOS`, `KGS`, `MTR`, `LTR`, `PCS`, `SQM`, `CBM`, `OTH`). The workbook needs the full
`CODE-NAME` string. Build a lookup table; every Nexflow code has an exact counterpart, including
`OTH-OTHERS`. A material with `uqc IS NULL` is an **exception**, not a blank cell — the HSN
sheet's UQC column is mandatory for goods.

**`Nature of Document` mapping — this is where Nexflow's `movement_purpose` pays off.** The
permitted values are a fixed 12-item list, and three of them map exactly onto Nexflow's existing
Table 13 buckets:

| Nexflow source | `Nature of Document` |
|---|---|
| `p2_invoices`, `movement_purpose IN ('sale','direct_supply_from_jobworker')` | `Invoices for outward supply` |
| Credit notes (when built) | `Credit Note` |
| Debit notes (when built) | `Debit Note` |
| Dispatches with any job-work purpose — `job_work_issue`, `job_work_return`, `rework_dispatch`, `rework_return`, `unused_material_return`, `scrap_return`, `inter_jobworker_transfer`, `capital_goods_issue` | **`Delivery Challan for job work`** |
| Any other non-sale challan | `Delivery Challan in case other than by way of supply (excluding at S no. 9 to 11)` |

`export.html`'s Table 13 already produces exactly these three buckets (*Tax Invoices*, *Delivery
Challans (Job Work)*, *Delivery Challans (Other)*). Rename the labels to the GSTN strings in the
workbook writer only; do not change the on-screen table.

> **Blocking prerequisite.** Legacy `CHAL-YYYYMMDD-NNNN` challan numbers are **18 characters**
> (over the 16-character cap) and `challanSeriesKey()` in `export.html:1377` **cannot parse them
> at all**, so they are silently dropped from series and gap detection
> (`codebase-audit.md` §6.4). The `docs` sheet is built from exactly that logic. **Fix both
> before the filing package ships**, or the document register will be quietly wrong for any
> tenant with legacy rows.

#### 02 — GSTR-2B reconciliation

The four buckets are already correct and shipped in `gstr2b-reconcile.html`: **Matched**,
**Amount Mismatch**, **Not in 2B — Supplier Default** (with s.16(4) expiry badges), and
**Unrecorded** (with a credit-note sub-bucket and amendment tags).

**The problem:** that matching runs entirely client-side and the uploaded 2B file is never sent
to the server, so a server-generated monthly package has nothing to reconcile against.

**Two phases:** `[RECOMMENDED]`

- **Phase 1 (ship first):** the package omits sheet 02. `00-READ-THIS-FIRST` says so explicitly
  and tells the owner to run the reconciliation screen and add the file. Honest, and it ships a
  month earlier.
- **Phase 2:** add `p2_gstr2b_uploads` storing the **parsed b2b/cdnr/b2ba rows** for a period —
  never the raw portal file. The package then includes sheet 02 automatically. This is a real new
  requirement with a schema change and an RLS policy; it is not a free addition.

#### 03 — ITC-04 working paper

Built in **Phase 3 (Session 8)**, not here. The filing package *includes* it once it exists;
it does not build it. Tables 4 / 5A / 5B / 5C with challan references, UQC quantities and
declared losses, per principal, on that principal's filing cycle. Prerequisites already shipped:
`p2_challan_links`, `principal_challan_no` / `principal_challan_date`, UQC codes. Still open: the
s.143 clock currently starts from `dispatch_date` rather than `principal_challan_date`, which
makes ageing slightly wrong (`CLAUDE.md` Known Open Items).

#### 06 — Tally vouchers XML

The same month's sales and purchase documents rendered as a Tally import file (§3.1 format),
which the CA can import by hand: Gateway of Tally → Import → Vouchers.

This exists for two reasons and both matter. It is the **fallback** when the Bridge Agent is not
installed or has been failing. And it is the **proof** behind the data-sovereignty promise
(§4) — the client can see, every single month, that their data leaves in a format their existing
software eats.

#### The CA workflow, end to end

`[VERIFIED]` This is the workflow that actually exists in Indian CA practice today. Nexflow
inserts itself at step 1 and changes nothing after step 3.

```
1. CA receives Nexflow-Filing-Package-ACME-2026-08.zip      (email / signed link, 5th of month)
2. CA opens 00-READ-THIS-FIRST.html                          reads the exceptions, decides what to fix
3. CA opens 01-GSTR1-<GSTIN>-082026.xlsx                     reviews, corrects anything wrong
4. CA opens the GSTN Returns Offline Tool (java)             the tool they already have
5. Import → Excel workbook  (or section-by-section CSV)      tool validates and reports errors
6. Tool generates the .json payload
7. CA uploads the .json to the GST Portal                    Returns → GSTR-1 → Prepare Offline
8. CA verifies the summary on the portal
9. CA files GSTR-1 with DSC / EVC                            ← Nexflow is nowhere near this step
10. CA prepares GSTR-3B from the 2B reconciliation + purchase register
11. CA files GSTR-3B                                         ← Nexflow is nowhere near this step
```

**Nexflow does steps 1–3. The CA does 4–11.** `[NEVER]` — Nexflow does not run the offline tool,
does not generate the JSON, does not touch the portal, does not hold a DSC and does not hold an
EVC OTP. The output is **Excel**, because Excel is what the CA's workflow consumes. Producing
JSON directly would skip the tool the CA uses to validate, which is the step that catches
Nexflow's own mistakes.

#### Cost model

`[VERIFIED]` API pricing as at 7 Sept 2026: **Opus 5 — $5.00 / MTok input, $25.00 / MTok
output.** Batch API is 50% off; prompt caching reads are ~0.1x.

Because the model receives computed aggregates and a bounded set of flagged rows — never the raw
month — **input size is bounded by construction**, not by the tenant's transaction volume.

| | Typical tenant | Busy tenant | Notes |
|---|---|---|---|
| Input tokens | ~25,000 | ~80,000 | summaries + exception candidates + system prompt |
| Output tokens | ~5,000 | ~12,000 | covering note + ranked exceptions |
| Cost per run | ~$0.25 (**₹22**) | ~$0.70 (**₹63**) | at ₹90/USD |
| With Batch API (50%) | ~₹11 | ~₹32 | the package is not latency-sensitive — **use it** |

**At 40 Enterprise tenants: 480 runs/year ≈ ₹5,300–₹10,800/year across the entire book.**
Against a ₹60,000/tenant/year add-on, compute is roughly **0.4% of revenue**. Compute is not the
cost of this feature and must not drive any design decision about it. `[RECOMMENDED]` run the
monthly batch through the Batch API overnight on the 5th; use prompt caching for the system
prompt and the GSTN rule text, which are identical across every tenant.

**Guardrails:**
- Hard cap `max_tokens`; stream the response.
- If the model's output fails schema validation, **ship the package without the note** rather
  than shipping a malformed one. The Excel files are the product; the note is the polish.
- Log every run to `p2_agent_logs` with `intent = 'filing_package'`.
- Never let a filing-package run consume the tenant's daily agent quota.

---

### 3.3 AI HSN Autofill

Suggest an HSN/SAC code from a material or product name, at the moment the material is created.

**Model: Claude Haiku 4.5.** `[DECIDED]` Correct choice here — a short classification with a
strong prior, run interactively, where latency matters and the answer is eight digits.

#### Why this matters more than it looks

The PVT LTD owner raised it unprompted: **wrong HSN codes destroy filing data.** The mechanism is
specific. HSN has been mandatory in GSTR-1 Table 12 since May 2021. A wrong code produces a wrong
Table 12, which produces a mismatch at the buyer's end in *their* GSTR-2B — surfacing as the
supplier's error, in front of the supplier's customer. Datta Prasad has **264 materials**; many
have no HSN at all today, and the ones that do were typed from memory. The filing package's `hsn`
sheet is only as good as this field.

#### Where it appears in the UI

| Surface | Behaviour |
|---|---|
| `settings.html` → Raw Materials tab, add and inline-edit rows | *"Suggest HSN"* button beside the `hsn_sac` field |
| `products.html` → add form and edit modal | same |
| `settings.html` → Raw Materials tab, header | **"Suggest HSN for all blank"** — batch action over materials with `hsn_sac IS NULL`, showing a review table before anything is written |
| `onboarding.html` → post-import CA checklist | the existing "fill material HSN" item gains a one-tap bulk suggest |

**Available on every plan including Lite.** A wrong HSN is a filing error regardless of what the
tenant pays.

#### API design

`[RECOMMENDED]` A new `body.action` handler — **`suggest_hsn`** — on the existing `agent-query`
Edge Function. It inherits `verifyCallerTenant`, CORS, the Anthropic key, and `p2_agent_logs`
logging. No new function to deploy, secure or monitor.

**Request**
```json
{ "action": "suggest_hsn",
  "tenant_id": "…",
  "items": [ { "id": "uuid", "name": "Copper Winding Wire 1.2mm", "unit": "kg", "kind": "raw_material" } ] }
```
Batched, maximum **25 items per call**.

**Response**
```json
{ "status": "ok",
  "suggestions": [ { "id": "uuid", "hsn": "85444911", "confidence": "high",
                     "reason": "Insulated copper winding wire for electrical machines",
                     "alternatives": ["74081190"] } ] }
```

- `confidence` is `high` | `medium` | `low`.
- **Does not consume the daily agent quota.** That quota exists for the chat copilot; spending it
  on data-entry help is wrong, and it would lock Lite out entirely (`plan = 'lite'` → limit 0).
  Use a separate counter or an uncapped per-request item limit.
- Prompt includes: material name, unit, and the tenant's **existing HSN codes for similar
  materials** — a factory's materials cluster into a handful of chapters, and prior codes are the
  strongest available signal.
- Job-work service lines: the model must return **SAC 9988 / 998898**, not a product HSN. Feed
  `is_job_worker` into the prompt.

#### Fallback when Haiku is wrong — five rules, all mandatory

It **will** be wrong sometimes. The design assumes it, rather than hoping otherwise.

1. **It is a suggestion, never a write.** The field is pre-filled; the user must accept. Nothing
   auto-saves. No exception, including the bulk action, which posts only what is ticked.
2. **Shape validation before display.** 4, 6 or 8 digits (or `99xxxx` for SAC); the 2-digit
   chapter must exist in a bundled chapter list. Anything malformed is **discarded, not shown**.
3. **Confidence gates the UI.** `high` → pre-filled. `medium` → pre-filled with an amber note.
   `low` → **not pre-filled**; shown greyed as *"Not confident — please check with your CA."*
4. **Provenance is stored.** New columns on `p2_raw_materials` and `p2_products`:
   ```sql
   hsn_source text CHECK (hsn_source IN ('manual','ai_suggested','ai_accepted'))
   hsn_suggested_at timestamptz
   ```
   This is the real safety net. The filing package's exceptions sheet can then say *"12 HSN codes
   were AI-suggested and never verified by a human — please review before filing."* An unverified
   AI code that nobody ever looks at is the actual risk; provenance makes it visible.
5. **The label is honest.** *"AI suggestion — verify with your CA"* sits next to the field, always.
   Nexflow does not certify HSN codes and must never appear to.

#### Cost

`[VERIFIED]` Haiku 4.5 — $1.00 / MTok input, $5.00 / MTok output.

~400 input + ~150 output tokens per material ≈ **$0.00115 ≈ ₹0.10 per material**. Batching 25 per
call cuts it further by amortising the prompt.

**Backfilling all 264 of Datta Prasad's materials costs about ₹27.** Across every tenant in the
book, forever, this feature costs less than one month of the Supabase bill. Do not gate it, do
not meter it, do not think about it again.

---

### 3.4 One-Click Full Export

Every table, every document, one zip, any time, on any plan, with no gate and no support ticket.
`[DECIDED]`

#### What it contains

```
nexflow-export-<company>-<YYYY-MM-DD>.zip
├── README.txt                      what this is, how to read it, schema version, contact
├── manifest.json                   table list, row counts, sha256 per file, timestamp, version
├── data/
│   ├── p2_tenant_settings.csv
│   ├── p2_raw_materials.csv
│   ├── p2_products.csv
│   ├── p2_product_bom.csv
│   ├── p2_suppliers.csv
│   ├── p2_clients.csv
│   ├── p2_stock_transactions.csv        ← the ledger. The one that actually matters.
│   ├── p2_dispatch_orders.csv
│   ├── p2_dispatch_items.csv
│   ├── p2_challan_links.csv
│   ├── p2_wip_transactions.csv
│   ├── p2_invoices.csv
│   ├── p2_invoice_items.csv             ← items jsonb flattened to one row per line
│   ├── p2_payment_receipts.csv
│   ├── p2_supplier_advances.csv
│   ├── p2_material_prices.csv
│   ├── p2_product_prices.csv
│   ├── p2_cancelled_challans.csv
│   ├── p2_user_roles.csv
│   ├── p2_notifications.csv
│   ├── p2_agent_logs.csv
│   └── p2_tally_sync_log.csv            ← Enterprise only
├── documents/
│   ├── invoices/INV-202608-001.pdf …
│   └── challans/1041.pdf …
└── tally/
    └── vouchers-FY2026-27.xml           entire history as Tally import XML
```

**Three deliberate inclusions:**

- **`documents/`.** Data without documents is not a handover. A GST officer asks for the invoice,
  not the row. PDFs regenerate client-side from the existing `js/invoice-pdf.js` and
  `js/challan-pdf.js`.
- **`tally/vouchers-*.xml`.** This is what turns the export from a gesture into a capability.
  "If Nexflow disappears tomorrow, this one file loads your entire history into the Tally you
  already own." Nothing else in the zip makes that sentence true.
- **`manifest.json` with per-file sha256.** It makes the export verifiable, which is what an
  auditor or a suspicious CFO will ask for.

#### Format decisions

| Decision | Choice | Reason |
|---|---|---|
| Format | **CSV per table**, UTF-8 **with BOM** | Excel mangles ₹ and Devanagari without the BOM. CSV opens anywhere, forever, with no library |
| JSON columns | flattened to their own CSV **and** kept raw | `p2_invoices.items` is a frozen snapshot; both shapes have consumers |
| Where it runs | **client-side**, in the browser | Matches the locked architecture decision (`CLAUDE.md`: server-side PDF generation abandoned, 400ms Edge Function CPU budget). JSZip + paged PostgREST reads, streamed into the zip |
| Access | `settings.html`, **owner only**, **every plan** | It is a right, not a feature |
| Large tenants | page at 1,000 rows, show a progress bar, stream into the zip | avoids holding a year of `p2_stock_transactions` in memory |

#### What it solves

It converts the bus-factor objection from an unanswerable question into a thirty-second live
demo. The MIDC owner's exact concern — *"our previous vendor was solo, he quit, our data was at
risk"* — and KPML had the same experience. `kpml-network-plan.md` §11 already names this as a
risk with the mitigation *"a clean documented full export … no answer loses the deal."*

**Do not describe this feature. Run it in the meeting.** Open Settings, click the button, open
the zip in front of them, open `p2_stock_transactions.csv` in Excel, open the Tally XML. The
demo is the argument.

---

### 3.5 CA Tally Integration (Core Client GST Automation)

*This section sits between §3 (Enterprise Architecture) and §4 (Data Sovereignty Promise)
because it is architecturally part of the Bridge Agent and strategically part of the go-to-market.
It is the highest-leverage item in this document that nobody has asked for yet.*

#### The problem it solves

Every month, a Core client — a proprietor or a partnership with no Tally of their own — collects
purchase bills and copies of sales invoices into a plastic folder or a WhatsApp thread and sends
them to their part-time CA. The CA then **retypes every transaction into their own TallyPrime**,
at their own office, to prepare GSTR-1 and GSTR-3B. Both sides lose hours. Errors enter at the
retyping step and are discovered, if ever, at reconciliation.

Nexflow already holds every one of those transactions, correctly, at source.

#### Feasibility verdict

**Technically feasible. Architecturally identical to the factory Bridge Agent. Strategically the
most valuable thing in this document. Do not build it first.** `[RECOMMENDED]`

The reasoning, question by question.

**1. Is it technically feasible with TallyPrime's XML/HTTP integration?**

Yes, with exactly one constraint, and that constraint decides the whole architecture.

`[VERIFIED]` TallyPrime's XML gateway on port 9000 accepts voucher imports from any process that
can reach it. There is no separate "CA edition" of the protocol — the CA's Tally is just Tally.
The constraint is that **Tally must be running with the target company loaded**, and
`[VERIFIED]` **Tally.NET Remote Access explicitly blocks data import** to prevent data
corruption. There is therefore **no cloud-to-Tally write path of any kind**. Anyone who claims
otherwise is describing a hosted-Tally VM, which is still a Windows machine running an agent —
just somebody else's Windows machine.

This kills the appealing idea of Nexflow pushing to a CA's Tally from the cloud. An agent on a
machine that can reach port 9000 is not one option; it is the only one.

**2. How does a CA manage multiple clients in one TallyPrime installation?**

`[VERIFIED]` Each client is a **separate Company** in the CA's Tally — its own GSTIN, its own
books, its own data directory. A CA firm with twenty factory clients has twenty companies in one
installation. TallyPrime can **load several companies simultaneously** (F1 → Settings → Startup →
*Load companies on startup*, or Alt+F3 *Select Company*), and switch between them without
restarting.

This is precisely the structure the integration needs. Nothing about the CA's existing setup has
to change.

**3. Can Nexflow push into a specific company inside the CA's Tally?**

`[VERIFIED]` Yes — `<SVCURRENTCOMPANY>` inside `<STATICVARIABLES>` selects the target company on
every single request. Two consecutive POSTs can land in two different clients' books.

**The catch, and it is the main operational risk of the whole feature: the name must match
exactly.** A mismatch either errors or is silently ignored — and a silent ignore looks
identical to success at the HTTP layer. Design consequences, all mandatory:

- The CA→tenant mapping (`p2_tally_targets.company_name`) is **explicit configuration confirmed
  by a human**, never inferred from the tenant's company name in Nexflow. CAs name companies
  things like `ACME ENGG (2024-25)`.
- Before every sync cycle the agent runs a **company-list export probe** and posts only to
  companies currently loaded. Everything else stays `pending`. A company that is configured but
  never loaded raises a specific error: *"Company 'ACME ENGG PVT LTD' is not open in Tally."*
- After every post the agent checks `IMPORTRESULT`. `CREATED + ALTERED == 0` is a failure even
  with `ERRORS = 0`.

**4. What is the correct voucher type?**

| Document | Tally voucher | Party ledger under | Party side |
|---|---|---|---|
| Client's **sales invoice** (outward supply) | **Sales** | `Sundry Debtors` | Debit |
| Client's **purchase invoice** (inward supply, ITC) | **Purchase** | `Sundry Creditors` | Credit |
| Credit note issued | **Credit Note** | `Sundry Debtors` | reversed |
| Debit note issued | **Debit Note** | `Sundry Creditors` | reversed |

Identical to §3.1. Same XML, same envelope, same ledger-entry sign convention, same
`IMPORTRESULT` parsing.

**Accounting vouchers only — no inventory. `[RECOMMENDED]`, and it is a real decision, not a
shortcut.** An item invoice would require every stock item to exist as a master in the CA's
books, which means duplicating the factory's entire material list into an accounting system that
has no business holding it, and rebuilding it whenever a material is added.

The consequence has to be handled rather than ignored: **an accounting-only voucher carries no
per-line quantity, so the CA cannot build GSTR-1 Table 12 (HSN summary) out of Tally.** The
answer is that they do not need to — **Nexflow supplies the `hsn` sheet directly** in the filing
package (§3.2), computed from the real quantities and UQCs that only Nexflow holds. This is a
better Table 12 than the one Tally would have produced from retyped data.

Say this to the CA explicitly at setup. It is the one place where the integration changes their
habit, and it changes it for the better.

**5. How does the CA agent differ from the factory agent?**

Same binary. Same protocol. Same installer. **Different profile.** One codebase, a `target`
column, and a scope filter.

| | Factory profile (`target = 'factory'`) | CA profile (`target = 'ca'`) |
|---|---|---|
| Installed on | Factory owner's Tally PC | **CA's own Tally PC** (or their hosted-Tally VM) |
| Tenants served | 1 | **N** — every client who consented |
| Tally companies targeted | 1 | **N**, one per tenant |
| Data scope | Sales, purchase, CDN — and later receipts/payments | **GST-relevant documents only.** Sales, purchase, CDN. Nothing else, ever |
| Inventory | never | never |
| Auth | one tenant-scoped agent token | one **CA-scoped** token carrying a list of per-client grants |
| Who consents | the tenant (their own machine) | **the tenant, explicitly, per CA** — and revocable |
| Period lock | `filed_through` | `filed_through`, per client |

The CA profile is a **superset of accounts and a subset of data**. That asymmetry is the whole
design.

**6. What does the CA do after the data lands?**

Everything they do today except the typing. Their judgement work is untouched; only the
mechanical part disappears.

```
   BEFORE                                  AFTER
   ────────────────────────────────────    ────────────────────────────────────
1. Chase client for bills (2–5 days)       1. Data is already in the company
2. Retype 60–200 vouchers  (2–4 hrs)       2. Open Daybook, review what landed
3. Fix HSN / rates / POS   (30 min)        3. Fix HSN / rates / POS   (10 min)
4. Reconcile against 2B    (1–2 hrs)       4. Reconcile against 2B — Nexflow's
                                              4-bucket sheet is already done
5. File GSTR-1 from Tally                  5. File GSTR-1 from Tally  (unchanged)
6. File GSTR-3B from Tally                 6. File GSTR-3B from Tally (unchanged)
```

Steps 5 and 6 are **untouched and must stay untouched.** The CA files, from Tally, with their
own DSC, exactly as they always have. `[NEVER]` — Nexflow does not file, does not generate the
JSON, does not touch the portal and does not hold a credential.

The honest pitch to a CA is not "this replaces your work." It is: *"the two hours of typing
disappear; the forty minutes of judgement stay yours."*

**7. Duplicate entry and conflict — the real operational risk**

This is the failure mode that would burn the CA relationship, so it gets the most defensive
design in the document.

The dangerous case is not re-sending: `REMOTEID` plus Tally's overwrite-on-matching-Remote-GUID
setting makes re-sending idempotent. The dangerous case is **the CA typed the invoice manually
before the sync ran.** That voucher has no `REMOTEID`, will not be matched, and a sync creates a
second copy — doubling that month's outward supply in a real client's books.

Five defences, all required:

1. **Pre-flight duplicate scan.** Before the first sync into any (company, period), the agent
   exports the existing vouchers for that date range and compares voucher numbers. A match
   without a corresponding `REMOTEID` becomes `status = 'conflict'` — **never overwritten,
   never posted** — and is surfaced for a human decision.
2. **Period lock.** `p2_tally_targets.filed_through` is set by the CA (or the owner) once a
   month is filed. The agent refuses to write into that period or any earlier one. Filed months
   are frozen, permanently.
3. **Parallel-run month.** The first month after install runs in **preview mode**: the agent
   builds and displays the vouchers it *would* post, and posts nothing until the CA presses a
   button. This is how the mapping errors get found — on a month nobody has filed yet.
4. **Never delete.** A correction is a new voucher or a `REMOTEID`-keyed alteration. The agent
   has no delete path.
5. **The convention, agreed at setup and written into the consent form:** *from the day the
   integration goes live, the CA stops typing that client's sales and purchase vouchers.* A
   technical guard is necessary but the social contract is what actually prevents the problem.

**8. Network — where the agent has to run**

The CA's Tally is at the CA's office, on the CA's LAN. The factory is somewhere else entirely.

| Option | Verdict |
|---|---|
| Agent on the **CA's PC**, outbound HTTPS to Supabase, POST to `127.0.0.1:9000` | ✅ **This is the design.** No inbound firewall rule, no exposed port, no VPN |
| Agent inside the CA's **hosted-Tally Windows VM** | ✅ Works identically. Install it in the VM; it is still a Windows machine with Tally on it |
| Cloud → CA's Tally directly over the internet | ❌ **Impossible.** No public API; Tally.NET blocks import |
| Port-forward 9000 from the CA's router | ❌ **Never propose this.** The gateway is unauthenticated — anyone reaching it can read and rewrite every client's books. This would be the single worst security decision available |
| Agent on the **factory's** PC writing to the CA's Tally over the internet | ❌ Same objection, plus the factory has no reason to reach the CA's LAN |

**9. Pricing — who pays**

`[RECOMMENDED]` **The factory pays, as part of their existing plan. The CA pays nothing. The
feature is sold to the CA and billed to nobody.**

Four reasons:

- **The CA has no budget line for a client's software** and is not a buyer of record. Turning
  them into one adds a sales cycle to a feature whose entire value is that it removes friction.
- **Charging the CA turns Nexflow into a CA-practice product** — a different market, different
  competitors, different support expectations, and a customer segment that buys on price per
  seat. That is a strategic detour, not a revenue line.
- **The value lands on the factory.** Accurate filing, no bill-collection ritual, no month-end
  chase. They are already paying ₹56,000–₹1,00,000/year; this makes that money go further and
  makes them harder to churn.
- **A free thing the CA didn't ask for and doesn't pay for is the easiest possible thing for
  them to recommend.** The moment there is an invoice attached, the recommendation becomes a
  sales pitch and the CA's credibility with their client is on the line.

Terms: **bundled into Core and Enterprise at ₹0. One CA per tenant.** Setup — install, company
mapping, ledger mapping, parallel-run month — is done by Nexflow at no charge for the first
twenty CAs, then folded into the standard setup fee.

A **paid CA Console** — a multi-client dashboard for the CA's own practice — is a plausible
future product. `[NEVER build it speculatively.]` Gate it on ten CAs actively using the free
integration and one of them asking for it by name, per the `kpml-network-plan.md` §9 Step 7 rule.

**10. CA as an acquisition channel — strategic assessment**

**This is the cheapest customer-acquisition channel available to Nexflow, and it is worth more
than the feature that creates it.**

The arithmetic is unusually favourable. One CA firm in a MIDC cluster carries fifteen to thirty
manufacturing clients. Retyping one client's month costs the CA two to four hours. Twenty
clients is **40–80 hours a month** — a full-time salary, spent on the least valuable work in
their practice, in the ten days when they are least able to spare it. Nexflow removes it for
free. Then, when a factory owner asks their CA *"should I buy this?"* — which in this market is
the question that actually decides the sale — the CA has already been using it for six months
and it makes their own month shorter.

Compare that to the alternatives: cold-calling MIDC factories, or waiting for KPML to mandate
adoption across a vendor base Nexflow does not control.

**But the risk is symmetric and it is severe.** A CA's recommendation is worth something only
while the data landing in their Tally is right. One month of double-counted purchases or wrong
HSN codes and the same CA becomes the loudest anti-referrer in a district where every factory
owner knows every other one. That is the same market-wide reputation event
`kpml-network-plan.md` §10.5 identifies as unrecoverable, arriving through a different door.

**The gate, therefore, is literal and must not be softened:**

> **Do not offer the CA integration to a second CA until one CA has filed three consecutive
> months from Nexflow-pushed data with zero corrections attributable to Nexflow.**

Three months, one CA, measured. Then scale.

#### Data isolation guarantee

The CA's agent holds a token that can reach several tenants. That is a genuine cross-tenant
surface — the first one in the product outside the principal dashboard — and it needs the same
seriousness `kpml-network-plan.md` §10.5 applies to principal visibility.

**Five guarantees, enforced in this order:**

1. **Consent is per (tenant, CA), explicit, and revocable.** A new table:
   ```sql
   CREATE TABLE p2_ca_grants (
     id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
     tenant_id    uuid NOT NULL,
     ca_email     text NOT NULL,
     company_name text NOT NULL,        -- exact Tally company name in the CA's install
     scope        text NOT NULL DEFAULT 'gst_documents_v1',
     granted_at   timestamptz NOT NULL DEFAULT now(),
     granted_by   uuid NOT NULL REFERENCES auth.users(id),
     revoked_at   timestamptz,
     UNIQUE (tenant_id, ca_email)
   );
   ```
   RLS via `get_my_tenant_id()`. A tenant sees and revokes only their own grant. Revocation is
   immediate and does not delete anything already in the CA's Tally — that data is the client's
   own books.

2. **One scoped access path.** Every read the CA agent makes goes through **one**
   `SECURITY DEFINER` RPC that takes the agent token, resolves it to the set of active grants,
   and returns only `p2_tally_sync_log` rows for those tenants with `target = 'ca'`. There is no
   second way to reach the data. This is the direct application of
   `kpml-network-plan.md` §10.5's answer to RPC drift: *scope cannot be forgotten if there is no
   other route.*

3. **The queue carries only what the voucher needs.** The CA agent's payload is the finished
   document — party name, GSTIN, state, document number, date, taxable value, tax split, HSN
   where relevant. **It never carries stock levels, consumption, BOM, WIP, job-work internals,
   principal pool ownership, s.143 clocks, challan internals, material costs, margins, supplier
   lists beyond the party on the invoice, or any other client's anything.** Enforce this by
   building the payload once, server-side, at enqueue time — the agent renders XML from a
   payload it cannot widen.

4. **No aggregates spanning tenants.** The agent's own UI shows a per-client queue and per-client
   errors. It never shows a total across clients, because a total across clients tells CA staff
   something about client A derived from client B. Same failure mode as
   `kpml-network-plan.md` §10.5's aggregate leak; same rule.

5. **"View what your CA receives."** A screen on the tenant's side showing exactly the documents
   and fields that go to their CA — generated from the same payload builder that feeds the
   queue, so the prose and the enforcement cannot drift apart. This is the direct analogue of
   the "view as principal" preview, and it makes a leak self-reporting.

**What the tenant consents to, in plain language on their own screen:**

> **Your CA receives:** your sales invoices · your purchase bills · your credit and debit notes
> — document number, date, the other party's name and GSTIN, taxable value, and the GST split.
>
> **Your CA does not receive:** your stock levels · what you consumed · your BOM or recipes ·
> your job work or any principal's material · your material costs or margins · your production
> volumes · anything belonging to any other Nexflow customer.

#### What is out of scope for the CA integration `[NEVER]`

- Inventory, stock items, quantities as stock, godowns, batches.
- Job work of any kind: principal pool, `owned_by`, s.143 clocks, challan internals, ITC-04
  detail, WIP. None of it is GST-relevant to the CA's filing and all of it is commercially
  sensitive.
- Pricing, margin, cost, supplier lists beyond the invoice party.
- Payments, receipts, TDS, bank entries, journals, payroll — Phase-2 candidates at best on the
  *factory* profile, never on the CA profile.
- **Any read-back from the CA's Tally into Nexflow.** Reads are permitted only for the company
  probe and the pre-flight duplicate scan, and nothing read is ever persisted to a Nexflow table.
- **Any other client's data.** Structurally impossible by design, not merely prohibited.
- Filing. The CA files. Always.
- A CA-side dashboard, multi-client reporting, practice management, or billing. Not until §9 Q8
  is answered and a named CA asks.

---

## 4. Data Sovereignty Promise

The objection is real, it is correct, and it has been raised twice by two different companies:
*"our previous vendor was a solo developer, he quit, our data was at risk."* KPML had the same
experience. A PVT LTD board is right to ask it and wrong to accept a reassuring answer.

**The answer is three layers, and they must be given in this order — strongest and most
demonstrable first.** The instinct is to lead with incorporation. Do not. A CIN is the weakest
of the three and leading with it invites the follow-up question it cannot survive.

### Layer 1 — The data is not in Nexflow's custody

The client's data lives in **Supabase (PostgreSQL on AWS, Mumbai region)**, under their own
tenant, with row-level security isolating it. Nexflow Automations is the **operator** of that
system, not the vault.

If Nexflow the company stops existing, Supabase does not. AWS does not. The database does not
evaporate — it keeps running until somebody stops paying for it, and the contract names who gets
the keys if that happens.

This reframes the question. The client is not asking a one-man company to be their safe. They
are asking a one-man company to be their operator, on infrastructure that outlives the operator.

### Layer 2 — The export is unconditional, complete, and continuous

**This is the strongest layer because it is the only one that can be demonstrated in the
meeting.**

- Every table. Every document. One zip. Any time. On any plan. No gate, no request, no notice
  period, no support ticket. (§3.4)
- Including the PDFs, not just the rows.
- Including **`vouchers.xml` — the entire transaction history as a Tally import file**. Not
  merely readable: *loadable, into the software they already own and already trust.*
- The client can run it today, next month, and the day after a hypothetical shutdown notice.
- It is written into the agreement as a contractual right, not a feature that could be removed
  in a future release.

**Demonstrate it. Do not describe it.** Open Settings in front of them, click the button, open
the zip, open the ledger CSV in Excel, open the Tally XML. Ninety seconds. Every sentence after
that demo is heard differently.

### Layer 3 — Corporate continuity

Weakest layer. Necessary, but must not be oversold, because a board will test it.

- **Nexflow Automations Private Limited** — an incorporated entity with its own PAN, GST, bank
  account and contracts. The contract is with a company, and it survives the individual (§5).
- **A second director.** A company with one director has one point of failure with extra steps.
- **A written continuity clause** in every Enterprise agreement:
  1. On cessation of operations, a **final full export** is delivered to every client within
     30 days.
  2. **90 days of hosting is paid forward**, so nothing goes dark while the client migrates.
  3. **Source code escrow**, released to clients on a defined trigger.
- **Documented schema.** The export ships with a data dictionary, so a successor developer — or
  the client's own IT contractor — can read it without Nexflow's help.

### What to say, word for word, in a sales conversation

When the objection lands — and it will, usually from the CA or the finance director, usually
right after the demo goes well — say this:

> *"You are right to ask, and the honest answer is that I am one person. I am not going to tell
> you that's not a risk. Let me tell you what we've done so it isn't your risk.*
>
> *First — your data isn't with me. It's in a PostgreSQL database on Amazon's Mumbai servers,
> under your own account. I operate it. I don't hold it. If I stop working tomorrow, that
> database doesn't go anywhere.*
>
> *Second — and this is the part I'd rather show you than describe. Can I have your laptop for
> thirty seconds?"*
>
> *[Open Settings → Export All Data → the zip downloads → open it]*
>
> *"Every table. Every invoice PDF, every challan PDF. And this file here — that's your entire
> transaction history as a Tally import file. If Nexflow disappeared tonight, you'd import that
> into the TallyPrime you already have, and you'd have lost nothing.*
>
> *You can click that button today, next month, and on the day I ever send you bad news. It's in
> your agreement as a right, not as a feature. There's no plan where it's turned off, and there's
> no situation where you have to ask me for it.*
>
> *Third — the company. Nexflow Automations Private Limited, not me personally. Your contract is
> with a company, with a second director, and it has a continuity clause: if the company ever
> winds up, you get a final export, ninety days of hosting already paid for, and the source code
> is released from escrow.*
>
> *And here's what I'd say about the vendor who left you stranded. He probably had all your data
> in a format only his software could read, and when he stopped answering the phone, that was
> that. That's the actual failure — not that he was one person. Every month, whether or not you
> ever call me again, your data is sitting in your Tally in your office. I'm not asking you to
> trust that I'll still be here in five years. I'm making it so it doesn't matter much either
> way."*

**Three rules for delivering this:**

1. **Concede the premise immediately.** "You are right to ask" and "I am one person." Any
   attempt to argue the risk away loses the room. The objection is correct; only its
   *consequence* is negotiable.
2. **The demo is the argument.** Talk less, click more.
3. **Never overclaim layer 3.** Do not say "escrow" until an escrow agreement exists. Do not say
   "second director" until there is one. A board will check, and one unverifiable claim
   retroactively discredits layers 1 and 2 — which were true.

---

## 5. Legal Structure

### Why PVT LTD registration is mandatory

`[DECIDED]` Register Nexflow Automations as a Private Limited company before the KPML pilot is
signed.

This is not a growth aspiration or a tax optimisation. It is a **gate**, and it was identified
by the customer, not by the founder:

- **PVT LTD companies will not sign with a sole proprietor.** Vendor onboarding at an
  incorporated company routinely requires an incorporated counterparty — CIN, GST and PAN in the
  company's name, a board-approvable contract, and an entity that survives an individual. A
  proprietorship fails that checklist at the form, before anyone evaluates the software. The
  MIDC owner said this directly.
- **KPML is a PVT LTD.** The pilot agreement (5 vendors, 90 days, ₹75,000 —
  `kpml-network-plan.md` §12) is a contract with a company. It cannot be signed by a
  proprietorship.
- **Every Segment 3 client is a PVT LTD.** The segment Enterprise exists to serve is the segment
  that structurally cannot buy from a proprietorship.
- **Code signing needs a legal entity.** An OV/EV certificate — without which the Bridge Agent
  installer trips SmartScreen on every machine — requires a registered organisation with
  verifiable identity. Incorporation is a *technical* prerequisite for §3.1, not only a
  commercial one.

### What incorporation changes

| Changes | Detail |
|---|---|
| Contracting entity | Agreements are with Nexflow Automations Private Limited |
| Invoicing entity | New GSTIN, new PAN, new bank account, new invoice series |
| Contract survivorship | The agreement survives the individual — the actual thing a board is buying |
| Second director | Becomes possible, and Layer 3 of §4 depends on it |
| Vendor registration | Passes the checklist at KPML and every Segment 3 prospect |
| Code signing | An OV/EV certificate becomes obtainable |
| Escrow | A source-escrow agreement becomes signable by a party that exists |
| Hiring / equity | Employment contracts and ESOPs become possible later |

### What incorporation does NOT change

**State this plainly and internally, because it is the thing most likely to be quietly
misunderstood:**

> **It is still one developer.** A CIN adds no redundancy, no support hours, no second pair of
> hands, and no bus-factor mitigation whatsoever. The bus factor is mitigated by **the export
> and the escrow** (§4 Layers 1 and 2), not by the certificate of incorporation.

Incorporation removes a *procurement* blocker. It does not remove an *operational* risk. Anyone —
founder or future session — who treats the CIN as the answer to the solo-developer objection has
misread both the objection and this document. Layer 3 is listed third for a reason.

It also **adds** obligations, and they are the exact obligations §8 promises never to build
software for: ROC annual filings (AOC-4, MGT-7), a statutory audit, board meetings and minutes,
DIR-3 KYC, and statutory registers. Nexflow will be hiring a CS for its own compliance while
telling clients it will never touch theirs. That is consistent, and it is worth saying out loud
in a sales conversation — *"I have exactly the same obligations you do, and I outsource them to a
CS, same as you."*

### Timeline

`[UNVERIFIED — confirm every duration with a CA/CS before committing to a date.]` Indicative,
based on the standard SPICe+ route:

| Step | Indicative duration |
|---|---|
| DSC for both directors | 1–2 days |
| Name reservation (SPICe+ Part A) | 2–4 days |
| SPICe+ Part B, MOA/AOA, AGILE-PRO | 3–5 days |
| Certificate of Incorporation, PAN, TAN | 5–10 days |
| Current account opened | 3–7 days after COI |
| GST registration on the new entity | 7–15 days |
| Contracts re-papered / novated | parallel |
| **Contracting-ready** | **~1 month from start** |
| **Fully migrated** (billing, GST, payment gateway, vendor accounts) | **~2 months from start** |

**Start immediately. It runs in parallel with every build phase in §6 and blocks none of them.**
It blocks only the signature. Working backwards from a **November 2026 KPML meeting and a
December 2026 pilot signature**, the last safe start is early October — and starting in
September removes the risk entirely.

**Loose ends to close, none of which are code:**

- **The three live clients signed with the proprietorship.** Datta Prasad's ₹1,35,000 Pro
  conversion is due 10 September 2026 and will be paid to the proprietorship. Novation or
  assignment letters are needed for all three. Do not let the new entity invoice against an old
  entity's agreement.
- **Vendor accounts to migrate:** Supabase, Vercel, Resend, Anthropic, the Telegram bot, the
  domain, and the payment gateway. Some require re-verification under the new PAN.
- **`Nexflow_Founder_Agreement_v5.1.docx` and `Nexflow_Standard_Agreement_v1.2.docx`** need a
  new party block and the §4 Layer-3 continuity clause added. Do this once, properly, with the
  Enterprise addendum drafted at the same time.
- **Who is the second director**, and what do they hold? See §9 Q13. This is a real decision with
  real consequences and it should not be made hurriedly in the week before a meeting.

---

## 6. Build Sequence

### The sequence, as decided

`[DECIDED]` — reproduced exactly as given. **Do not reorder.**

| Phase | What | Status |
|---|---|---|
| **Phase 0** | Security / role fixes | ✅ Complete (Session 6, 5 Sept 2026) |
| **Phase 1** | Physical Stock Count | ✅ Complete (Session 7, 6 Sept 2026) |
| **Phase 2** | KPML Principal Dashboard | October 2026 |
| **Phase 3** | ITC-04 Working Paper | **Session 8 — next** |
| **Phase 4–5** | Defined in `CLAUDE.md` | See note below |
| **ENTERPRISE BLOCK** | Bridge Agent · AI Filing Package · HSN Autofill · Full Export | **After Phase 2, before KPML pilot signing** |
| **After all of the above** | Nexflow serves all four segments | — |

Note that Phase 3 executes *before* Phase 2 completes. That is deliberate and correct: the
ITC-04 working paper is a **deliverable shown inside** the principal dashboard, so it has to
exist before the dashboard is demonstrable. Session order and phase numbering are not the same
thing here, and neither is wrong.

> `[UNVERIFIED]` **Phases 4 and 5 are referenced but not bound to specific items in
> `CLAUDE.md`.** The nearest candidates in the Backlog are: Principal Material Passbook, Supplier
> Payables Register, Credit/Debit Notes, Notification Centre v2, and Coil Winder
> Sub-contracting. Bind the labels before Session 9 so a future session does not guess. §9 Q10.

### Enterprise block — internal order and reasoning

The four Enterprise items are **not** interchangeable. Build them in this order.

**E4 — One-Click Full Export.  ~3–5 days.  Build first.**
Smallest, and it unblocks the *sales conversation* rather than a feature. It is a prerequisite
for the §4 pitch, it is demonstrable in the November KPML meeting, and it removes the single
objection most likely to end an Enterprise sale. Highest value per day of work in this document.

**E3 — AI HSN Autofill.  ~3–4 days.  Build second.**
Small, cheap (₹27 to backfill 264 materials), and — critically — **a prerequisite for E2**. The
filing package's `hsn` sheet is worthless if HSN codes are blank or wrong, and many of Datta
Prasad's 264 materials have no code today. Fixing the data before building the report that
consumes it is the right order.

**E2 — Monthly AI Filing Package.  ~2–3 weeks.  Build third.**
Depends on E3 for data quality, on Phase 3 for the ITC-04 sheet, and on two `codebase-audit.md`
fixes (below). The largest compliance surface in the product and the one a CA judges Nexflow by.

**E1 — Bridge Agent.  ~3–4 weeks + a one-machine field pilot.  Build last.**
Biggest, riskiest, and the only one that introduces a **new artefact class** — a signed Windows
binary with an update channel and a support surface on machines Nexflow does not control. It is
also the only one that is not needed to *win* the KPML pilot; it is needed to win **PVT LTD
job-worker conversions**. Deferring it costs the least.

### Dependency graph

```
  Phase 0 ✅ ─────────────────────────────────────────────────┐
  Phase 1 ✅ ─────────────────────────────────────────────────┤
                                                              │
  Phase 3 (ITC-04) ──────────────┬──────────────────────────► E2
     needs: s.143 clock from     │                            │
     principal_challan_date      │                            │
                                 v                            │
  Phase 2 (KPML dashboard) ──► [KPML demo, Nov 2026]          │
     needs: Phase 3 output                                    │
                                                              │
  E4 Full Export ──────────────► [§4 sales pitch] ────────────┤
     needs: nothing                                           │
                                                              │
  E3 HSN Autofill ───────────────────────────────────────────►┤
     needs: nothing                                           │
                                                              v
  AUDIT FIX: CHAL- 18-char + challanSeriesKey()  ───────────► E2  (BLOCKING)
  DECISION:  B2CL threshold ₹1L vs ₹2.5L        ───────────► E2  (BLOCKING)
                                                              │
  AUDIT FIX: GRN duplicate-invoice guard ───────────────────► E1  (BLOCKING)
  PVT LTD incorporation ──────────────► code-signing cert ──► E1  (BLOCKING)
                                                              │
  E1 Bridge Agent (factory) ─── 1 month stable ─────────────► §3.5 CA Agent
                                                              │
  §3.5 CA Agent ─── 3 clean months, 1 CA ───────────────────► CA channel scale-up
```

### Blocking dependencies — read these before starting any Enterprise work

These are genuine blockers, not nice-to-haves. Each one, unfixed, produces a wrong number in a
real client's statutory filing.

1. **`CHAL-YYYYMMDD-NNNN` is 18 characters and invisible to gap detection.**
   `codebase-audit.md` §6.4. It exceeds the Rule 46(b)/55 16-character cap, **and**
   `challanSeriesKey()` (`export.html:1377`) cannot parse it, so legacy rows are silently dropped
   from series and gap logic. The filing package's `docs` sheet is built from exactly that logic.
   **Blocks E2.**

2. **GRN duplicate-invoice guard.** `codebase-audit.md` finding #13 — there is no uniqueness check
   of any kind on `(tenant_id, supplier_id, normalised invoice_no)`. Today a duplicated supplier
   invoice double-counts stock and double-claims ITC *inside Nexflow*. With the Bridge Agent
   running, it becomes **two Purchase vouchers in the client's real books**, which is a materially
   worse outcome. **Blocks E1.** Schedule it into Phase 3 or as a standalone fix before E1 starts.

3. **B2CL threshold.** The GSTN V2.0 template and `export.html`'s `B2CL_THRESHOLD` both say
   ₹2.5 lakh; Notification 12/2024 dropped the portal threshold to ₹1 lakh effective 1 Nov 2024.
   One line of code, one CA question. **Blocks E2.** §9 Q1.

4. **PVT LTD incorporation → code-signing certificate.** Without a signed installer, SmartScreen
   blocks every Bridge Agent install and the feature is undeployable in practice. **Blocks E1.**

5. **s.143 clock starts from `dispatch_date`, not `principal_challan_date`.** `CLAUDE.md` Known
   Open Items. Makes ITC-04 ageing slightly wrong. **Blocks Phase 3**, and therefore the ITC-04
   sheet in E2.

### When the KPML pilot can be signed

Three things must all be true. Two are already scheduled; one has not started.

| Prerequisite | Status |
|---|---|
| Phase 2 — read-only principal dashboard, live on all three real vendor accounts | October 2026 |
| KPML meeting with a live demo on real data (not a slide) | November 2026 |
| **Nexflow Automations Private Limited incorporated and contracting-ready** | **Not started — §5** |

**The pilot is a principal-side sale.** KPML buys the dashboard, the s.143 exposure number and
the 43B(h) position. **Enterprise is not what closes it** — Enterprise closes *Segment 3
job-worker conversions*, which is a different sale to different companies.

> **Timeline tension, flagged not resolved.** The decided sequence places the entire Enterprise
> block before pilot signing. Taken literally, that adds roughly 6–8 weeks after Phase 2 and
> pushes the December signature into late January. The sequence is `[DECIDED]` and this document
> does not change it — but the founder should decide explicitly whether E1 (the Bridge Agent, the
> long pole, and the item least relevant to a principal-side sale) must land before the
> signature, or whether E4/E3/E2 before it and E1 during the pilot achieves the same commercial
> effect six weeks earlier. **§9 Q11. Decide before Phase 2 ships, not after.**

---

## 7. Pricing

### The four segments, plus Enterprise

All Core figures below are `[DECIDED]` and reproduced unchanged from `CLAUDE.md`. Enterprise is
the only new number and it is `[RECOMMENDED]`, not decided.

#### Segment 1 & 2 — Sole proprietors and partnerships (Core)

**Founder plan — clients 1–5 only** `[DECIDED]`
- Year 1: **₹20,000 setup + ₹44,000/yr = ₹64,000**
- Payment: ₹20K day 1 · ₹15K day 30 · ₹15K day 60 · ₹14K day 90 · 9 months free
- Monthly option: ₹20,000 setup + ₹6,500/month, 3-month minimum
- Agent 30/day. Rate locked 2 years, then standard Pro pricing.
- Agreement: `Nexflow_Founder_Agreement_v5.1.docx`

**Standard Lite — client 6+** `[DECIDED]`
- Year 1: **₹20,000 setup + ₹56,000/yr = ₹76,000**
- Payment: ₹20K day 1 · ₹20K day 30 · ₹16K day 90 · 9 months free
- Monthly option: ₹20,000 setup + ₹6,500/month, 3-month minimum
- GRN, dispatch, challan, invoice generation, CA export, 250-material cap, single user, no agent
- Agreement: `Nexflow_Standard_Agreement_v1.2.docx`

**Standard Pro — client 6+** `[DECIDED]`
- Year 1: **₹35,000 setup + ₹1,00,000/yr = ₹1,35,000**
- Payment: ₹35K day 1 · ₹35K day 30 · ₹35K day 60 · ₹30K day 90 · 9 months free
- Monthly option: ₹35,000 setup + ₹11,500/month, 3-month minimum
- Everything in Lite + AI Copilot 50/day, multi-user, unlimited materials, owner visibility,
  QR scanner, GSTR-2B reconciliation
- Agreement: `Nexflow_Standard_Agreement_v1.2.docx`

**Included free on every plan:** one-click full export, AI HSN autofill, CA Tally integration
(one CA per tenant).

#### Segment 3 — PVT LTD (Enterprise) `[RECOMMENDED — NOT YET DECIDED]`

**Enterprise = Standard Pro + Enterprise add-on. It requires Pro; it is not available on Lite.**
The filing package depends on unlimited materials, multi-user and GSTR-2B reconciliation, all of
which are Pro.

| Component | Amount | Covers |
|---|---|---|
| Pro setup | ₹35,000 one-time | Existing onboarding |
| **Bridge Agent setup** | **₹25,000 one-time** | Install, Tally company + ledger mapping, F12 overwrite config, one **parallel-run month** verified against their accountant's own entries |
| Pro annual | ₹1,00,000/yr | Core Pro |
| **Enterprise add-on** | **₹60,000/yr** | Bridge Agent licence + updates, monthly AI Filing Package, priority support during the 1st–11th filing window |
| **Year 1 total** | **₹2,20,000** | |
| **Year 2+** | **₹1,60,000/yr** | |

**Cost structure behind the ₹60,000.**

The instinct is to price this off compute. That would be wrong by two orders of magnitude.

| Cost to serve, per Enterprise client per year | Amount |
|---|---|
| Opus filing package — 12 runs (Batch API) | **₹130–₹380** |
| Haiku HSN autofill — ongoing | **< ₹50** |
| Marginal Supabase / Vercel / Storage | negligible |
| **Total compute** | **≈ ₹400** |
| **Bridge Agent support — 4–8 founder-hours/yr** | **₹8,000–₹16,000** (opportunity cost) |
| Amortised code-signing certificate | ₹500–₹900 |
| Amortised escrow (if used) | ₹1,000–₹2,000 |
| **Realistic cost to serve** | **₹10,000–₹19,000** |

**Compute is 0.4% of the add-on price. Support is 85% of it.** The Bridge Agent runs on machines
Nexflow does not control, in factories with no IT staff, alongside a Tally that gets renamed,
upgraded, moved and closed. Every hour of that is founder time — the genuinely scarce resource.

**Price for support, not for tokens.** Three consequences that follow directly:

1. The ₹25,000 setup fee is not margin; it buys the parallel-run month that prevents the
   expensive failure. Do not discount it to close a deal.
2. **Cap Enterprise at 25 clients** until either a support engineer is hired or the agent's
   telemetry proves the support load is lower than estimated. Forty Bridge Agent installs is
   roughly 320 founder-hours a year, which is a full month of build time gone.
3. The Enterprise price does **not** need to rise as compute costs change. It moves when the
   support model changes.

**Value anchors for the sales conversation** — say the numbers out loud:
- One accountant spending ten days a month retyping ≈ **₹1,00,000/year** of salary, recovered.
- One blocked ITC claim under GST 2.0's hard matching ≈ **₹50,000+** of working capital.
- One wrong-HSN month and the resulting amendment and buyer dispute ≈ multiple days of CA time.
- A bespoke Tally integration quoted by a Tally partner: multiples of ₹2,20,000, with no filing
  package and no inventory system attached.

#### Segment 4 — Principal accounts (KPML model) `[DECIDED]`

Unchanged from `CLAUDE.md` and `kpml-network-plan.md` §12:

| Component | Amount |
|---|---|
| Setup | ₹1,25,000 – ₹1,50,000 |
| Platform fee | ₹2,50,000 – ₹3,00,000/year |
| Vendor overage | ₹5,000 – ₹7,000/vendor/year beyond 20 |
| **Pilot offer** | **5 vendors, 90 days, ₹75,000 — fully credited against the annual fee** |

Priced on **active principal-side links, never on a tenant-level flag** — roles are
per-relationship (`kpml-network-plan.md` §2).

**Enterprise is orthogonal and additive for a principal.** If KPML wants their vendor invoices
flowing into their own Tally, that is the same ₹25,000 setup + ₹60,000/year, on top of the
platform fee. Do not bundle it into the platform fee — it has a real support cost and bundling
it hides that.

**Vendor network revenue is unchanged:** each KPML vendor is a separate tenant on their own
Standard Pro subscription (₹1,00,000/yr), Pro mandatory because the 250-material Lite cap is hit
immediately by any serious job worker.

### Summary

| | Segment 1–2 Lite | Segment 1–2 Pro | Segment 3 Enterprise | Segment 4 Principal |
|---|---|---|---|---|
| Year 1 | ₹76,000 | ₹1,35,000 | **₹2,20,000** | ₹3,75,000 – ₹4,50,000 |
| Year 2+ | ₹56,000 | ₹1,00,000 | **₹1,60,000** | ₹2,50,000 – ₹3,00,000 |
| Full export | free | free | free | free |
| HSN autofill | free | free | free | free |
| CA Tally integration | free | free | free | free |
| AI Filing Package | — | — | ✅ | ✅ (add-on) |
| Bridge Agent | — | — | ✅ | ✅ (add-on) |

---

## 8. What Is Never Built

**Permanent. Not a backlog, not a "later", not gated on a client asking.** Each entry states what
it is, why Nexflow will never build it, and what handles it instead.

### 1. ROC / MCA / statutory company compliance
**What:** AOC-4, MGT-7, DIR-3 KYC, board minutes, statutory registers, share transfers, annual
returns, director appointments.
**Why never:** It is company-secretarial practice, not a factory-floor system. The liability is
personal to directors and carries penalties Nexflow cannot underwrite. Nexflow holds no data that
touches any of it. Entering this space would mean advising on the Companies Act with a
₹1,60,000/year product.
**Handled by:** the client's CS and CA. Nexflow has the identical obligations for itself and
outsources them the same way (§5).

### 2. Bidirectional Tally sync (Tally → Nexflow)
**What:** reading vouchers, ledgers, stock or balances out of Tally and writing them into Nexflow.
**Why never:** two writers, one truth, guaranteed divergence. Nexflow's model has a dimension
Tally's does not (`owned_by`), so any inbound row arrives without the one field that makes it
meaningful, and something would have to guess. It would also make Nexflow's ledger depend on data
Nexflow cannot validate, which destroys every compliance surface built on that ledger. **Nexflow
is the source of truth; Tally receives.** One-way, permanently.
**Handled by:** Nexflow for operations, Tally for accounts, one-way push between them.

### 3. PVT LTD accounting that Tally already does
**What:** ledgers, trial balance, P&L, balance sheet, journal vouchers, contra, bank
reconciliation, depreciation and fixed-asset registers, cost centres, budgets, payroll,
TDS/TCS computation and returns, Form 26AS reconciliation, partner capital accounts, drawings,
audit-trail attestations under Rule 3(1).
**Why never:** it is Tally's job, Tally does it well, the client has ten years of it, and their
auditor works in it. Competing here means asking a PVT LTD to migrate its audited books — the
request that ends the sale.
**Handled by:** TallyPrime, the client's CA, and their statutory auditor.

### 4. GST filing or submission of any kind
**What:** filing GSTR-1 or GSTR-3B, generating the GSTN JSON, uploading to the portal,
GSP/ASP integration, e-invoice IRN generation, e-way bill generation.
**Why never:** already **permanently locked** in `CLAUDE.md` ("GST Scope — PERMANENTLY LOCKED").
Filing is a legal act performed on the taxpayer's behalf, with consequences Nexflow cannot carry.
An IRN, once generated, cannot be un-generated. Nexflow produces the file; the CA files it —
and the offline tool's validation step, which the CA runs, is the control that catches Nexflow's
own errors. Removing that step to "help" would remove the safety net.
**Handled by:** the CA, via the GSTN Returns Offline Tool and the portal. E-invoicing via Tally
or the IRP portal — Nexflow's AATO banner warns, and never blocks.

### 5. Storing GST portal credentials, DSC, or EVC OTP
**What:** any credential that could be used to file on a client's behalf.
**Why never:** this is the natural next request after "make filing easier," and it is the line
that converts a software vendor into a party with access to a taxpayer's statutory identity. The
answer is no, in every conversation, permanently. There is no plan, price or client for which
this becomes yes.
**Handled by:** the CA holds the credentials, as they do today.

### 6. Replacing Tally
**What:** positioning, pitching, or building Nexflow as an accounting system.
**Why never:** ten years of data, a working auditor relationship, and a mature product with
decades of accumulated compliance handling. Nexflow's entire defensible position (§1) is being
*upstream* of Tally. A vendor who feeds Tally gets recommended by CAs; a vendor who competes with
it gets blocked by them.
**Handled by:** Tally.

### 7. SAP integration for principal accounts
**What:** reading POs, material masters or GRNs out of a principal's SAP.
**Why never:** it is bespoke work for one customer, priced as bespoke work, in a system Nexflow
does not control — the exact trap `kpml-network-plan.md` §13 warns against, and it breaks the
"zero customer-specific logic" rule that makes the product generic.
**Handled by:** PO push modelled on the SAP PO's *shape* (material code, short text, quantity,
still-to-deliver running balance, net price per piece) as a Nexflow-native feature —
`kpml-network-plan.md` §9 Step 7, gated on a named request.

### 8. Reading a CA's other clients' data
**What:** any Nexflow surface that reaches data belonging to a CA's non-Nexflow clients, or
aggregates across a CA's book.
**Why never:** structurally prohibited by §3.5's scoped access path, and the aggregate-leak
failure mode of `kpml-network-plan.md` §10.5 applies unchanged.
**Handled by:** nothing. It does not exist and will not.

### 9. Writing into a filed period
**What:** any Tally write, by either agent profile, into a month on or before `filed_through`.
**Why never:** a filed month is a legal record. Altering it silently after filing creates a
mismatch between the client's books and their return that surfaces at assessment.
**Handled by:** a corrective entry in the current period, made by the CA, as normal practice.

### 10. `stock-share.html` and tenant-level share tokens
**What:** already cut permanently in `kpml-network-plan.md` §7. Restated here because
Enterprise's new sharing surfaces are exactly where it would try to come back.
**Why never:** a non-expiring, non-revocable tenant-level token publishing a factory's whole
stock position to their largest customer. Wrong data, wrong token model, unsellable to the vendor.
**Handled by:** per-document tokens (`receive.html`, `invoice.html`) and the scoped principal
view.

---

## 9. Open Questions

Every one of these needs a decision **before** the phase named. Flagged now so they are not
discovered mid-build.

### Blocking E2 — Monthly AI Filing Package

**Q1. B2CL threshold — ₹2.5 lakh or ₹1 lakh?**
The GSTN V2.0 template and `export.html`'s `B2CL_THRESHOLD` both say ₹2.5 lakh. Notification
12/2024 dropped the portal threshold to ₹1 lakh effective 1 Nov 2024. `CLAUDE.md` already flags
this as a deliberate named constant. Almost certainly nil-impact today (all clients are B2B job
workers) but it must be right before a package is sent to a CA.
**Recommendation:** ₹1,00,000, confirmed by a CA. Fix `export.html` in the same change.
**Decide before:** E2 starts.

**Q2. Full workbook or section CSVs?**
The offline tool accepts both a 21-sheet group import and section-by-section CSV. §3.2 specifies
the full workbook. The tool's accepted shape changes between releases.
**Action:** download the current Returns Offline Tool, generate a package for the test tenant,
and import it end-to-end before shipping to a real CA. **Do this once per financial year.**
**Decide before:** E2 ships.

**Q3. Where does GSTR-2B data live?**
Today the uploaded 2B never reaches the server, so a server-generated package cannot include the
reconciliation sheet. Phase 1 omits it; Phase 2 needs a new `p2_gstr2b_uploads` table holding
parsed rows (never the raw portal file), with RLS.
**Decide before:** E2 design freeze. It is a schema change, not an addition.

**Q4. Does the filing package touch `p2_agent_logs`, and does it count against anything?**
Recommendation: log it with `intent = 'filing_package'`, never charge it to the tenant's daily
agent quota.
**Decide before:** E2 build.

### Blocking E1 — Bridge Agent

**Q5. Runtime and code-signing certificate.**
§3.1 recommends a Node single-file executable in a tray app. The certificate is OV or EV, costs
roughly ₹15,000–₹35,000/year, and **requires the PVT LTD to exist first**. Which CA/vendor, and
what identity verification do they need?
**Decide before:** E1 starts. Order the certificate the week incorporation completes.

**Q6. Ledger creation policy.**
§3.1 says the agent creates **party ledgers only** and never sales/purchase/duty ledgers, which
must pre-exist and be named in `ledger_map`. Is that too strict for a client with no accountant?
Get one CA's opinion — the cost of being wrong in the permissive direction is a corrupted chart
of accounts.
**Recommendation:** keep it strict.
**Decide before:** E1 design freeze.

**Q7. Does the factory agent ever push receipts and payments?**
`p2_payment_receipts` and `p2_supplier_advances` exist and are complete enough to post as Receipt
and Payment vouchers. Doing so takes Nexflow from "GST documents" into "sub-ledger", which is a
different promise and edges toward §8 item 3. Deferred in §3.1 pending a decision.
**Recommendation:** never on the CA profile; on the factory profile only if a client asks by name.
**Decide before:** E1 v2, not v1.

**Q8. Is the CA agent one install for many tenants, or one per tenant?**
§3.5 assumes one install with a CA-scoped token carrying per-client grants. The alternative —
one install per client on the same machine — is simpler to secure and far worse to operate at
twenty clients. Affects the token model, the consent record and the agent UI.
**Recommendation:** one install, CA-scoped token, per-client grants.
**Decide before:** the CA agent is designed (after E1 is stable for a month).

**Q9. Who signs the CA data-sharing consent?**
The tenant owns the data, so the tenant must grant. But the CA controls the machine and needs to
accept obligations about it. One-sided or two-sided consent?
**Recommendation:** tenant grants in-app (`p2_ca_grants`); CA accepts a short usage undertaking
at install. Both recorded.
**Decide before:** the CA agent ships.

### Sequencing and scope

**Q10. What exactly are Phase 4 and Phase 5?**
Referenced in the decided sequence but not bound to specific `CLAUDE.md` items. Candidates:
Principal Material Passbook, Supplier Payables Register, Credit/Debit Notes, Notification
Centre v2, Coil Winder Sub-contracting.
**Note:** Credit/Debit Notes is the one with an Enterprise dependency — the Bridge Agent's CDN
handler and the filing package's `cdnr` sheet are both dead code until it exists.
**Decide before:** Session 9.

**Q11. Must the Bridge Agent land before the KPML pilot signature?**
The decided sequence says the whole Enterprise block precedes signing, which pushes December into
late January. E1 is the long pole and the item least relevant to a principal-side sale.
**Options:** (a) keep the sequence as decided; (b) E4/E3/E2 before signing, E1 during the pilot.
**Decide before:** Phase 2 ships, not after.

**Q12. Does KPML itself want Tally sync?**
They run SAP for POs and Tally for GST. Enterprise may be an additional ₹85,000 Year 1 on the
principal account — or entirely unwanted. Nobody has asked.
**Action:** ask at the November meeting. Do not build for it beforehand.

### Company and operations

**Q13. Who is the second director, and what do they hold?**
§4 Layer 3 depends on there being one. Equity, liability, and role all need deciding, and it
should not be decided in the week before the KPML meeting.
**Decide before:** SPICe+ Part B is filed — it is on the form.

**Q14. What is the support model at 25 Bridge Agent installs?**
The §7 cost model estimates 4–8 founder-hours per client per year. At 25 clients that is 100–200
hours; at 40 it is a month of build time gone. The binding constraint on Enterprise is founder
hours, not code.
**Action:** instrument the agent from v1 — every error, every retry, every support-triggering
event reported back — so the real number replaces the estimate before the cap is hit.
**Decide before:** the 10th Enterprise sale.

**Q15. Is escrow real, and with whom?**
§4 Layer 3 mentions source escrow. **Do not say the word "escrow" in a sales conversation until
an agreement exists.** An unverifiable claim retroactively discredits Layers 1 and 2, which are
true and demonstrable.
**Decide before:** the first Enterprise contract is drafted.

**Q16. Do the three existing clients get Enterprise, and at what price?**
All three are proprietorships or partnerships and none needs the Bridge Agent. But Datta Prasad
has 264 materials and a live KPML filing exposure, so the filing package has real value to them.
SS Engineering is free permanently and that never changes.
**Recommendation:** offer the CA Tally integration (free) to all three immediately — it is the
fastest route to the first CA relationship and the three-clean-months gate.
**Decide before:** the CA agent is first offered.

---

*Last updated: 7 September 2026.*
*This is a living document. Update it in place as decisions are made — move items from
`[RECOMMENDED]` to `[DECIDED]`, close open questions, and record what was actually built.*
*Load `CLAUDE.md` + this file to resume full Enterprise context in a new session.*
