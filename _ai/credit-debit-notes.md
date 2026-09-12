---
name: credit-debit-notes
description: Nexflow Session 20 — credit and debit notes. p2_credit_notes schema, numbering under Rule 53, the invoice link and value guard, PDF and public view, GSTR-1 cdnr mapping, and the Bridge Agent handler that is already built waiting for it. Read in full before building Session 20.
sources: [CLAUDE.md Backlog, bridge-agent.md §4 and §5.5, enterprise-strategy.md §3.2 and §9 Q10, kpml-network-plan.md §10.6, md-audit-report.md]
last_updated: 11 September 2026
status: design complete — not yet built. Living document: update in place as it is built.
---

# Nexflow — Credit and Debit Notes (Session 20)

**Load order for a Session 20 session. Read in this order, in full:**

1. `_ai/CLAUDE.md` — the `p2_invoices` schema entry and "Shipped Sept 2, 2026"
2. `_ai/credit-debit-notes.md` (this file)
3. `_ai/bridge-agent.md` §5.5 — the Tally voucher side, **already specified and waiting**
4. `js/invoice-pdf.js` and `invoice.html` — the document this one is a sibling of

**Status: designed, not built.** Nothing here exists in the codebase.

**Why this is its own file.** A credit note touches three subsystems at once: invoicing (a new
document type with its own statutory numbering), the Bridge Agent (whose `CRN`/`DRN` handler,
REMOTEID derivation and `doc_type` CHECK all ship in Session 18 **with the source table absent**),
and the filing package (whose `cdnr` sheet is dead code until this exists). `enterprise-strategy.md`
§9 Q10 names it as *"the one with an Enterprise dependency."* The spec for it today is four lines in
`CLAUDE.md`'s Backlog:

> **Credit/Debit Notes.** Monthly event — returned goods, price corrections, short deliveries. No
> path today except cancel and re-raise (breaks invoice sequence, confuses CA).

That is a correct problem statement and not a buildable spec.

---

## Tag convention

Inherited from `enterprise-strategy.md`, unchanged.

| Tag | Meaning |
|---|---|
| `[DECIDED]` | Decided. Build it as written. |
| `[RECOMMENDED]` | This document's recommendation. Needs founder sign-off. |
| `[VERIFIED]` | Checked against the live codebase or a primary source, 11 Sept 2026. |
| `[LAW]` | Traced to the bare Act or Rule. A CA should still confirm before shipping. |
| `[UNVERIFIED]` | Needs a live check before code is written. Listed again in §10. |
| `[NEVER]` | Permanently out of scope. |

---

## 1. The problem

Three events happen monthly at every one of the three live clients and have no representation:

1. **Returned goods.** A client rejects 15 of 400 pieces after the invoice was raised and paid.
2. **Price correction.** The rate on the invoice was wrong — a stale `p2_product_prices` row, or a
   rate agreed after dispatch.
3. **Short delivery.** The challan says 400, the client received 385, the invoice billed 400.

**The only path today is cancel and re-raise.** That does three bad things: it consumes an invoice
number that then has no document behind it (a Rule 46(b) series gap with no explanation), it
requires the client to destroy an invoice they may already have entered in their own books, and
`cancelInvoice()` writes no audit row — the `cancelled_at` / `cancelled_by` / `cancel_reason`
columns were added in Session 6 but *"`cancelInvoice()` itself is not yet extended to write them"*
`[VERIFIED — CLAUDE.md, Session 6]`.

**A credit note is the correct instrument and it is the one the law provides for.** `[LAW]` CGST
s.34(1): where the taxable value or tax charged in a tax invoice *exceeds* what is payable, the
supplier **may** issue a credit note. s.34(3): where it *falls short*, a debit note.

---

## 2. What ships, and what does not

| | Session 20 |
|---|---|
| Credit note against a sent invoice | ✅ |
| Debit note against a sent invoice | ✅ |
| Public token view + PDF, mirroring `invoice.html` | ✅ |
| GSTR-1 `cdnr` rows in the filing package | ✅ |
| Table 13 document-class counts | ✅ |
| Bridge Agent `CRN` / `DRN` lighting up | ✅ — handler already built, §7 |
| Credit note **not** against an invoice (unregistered/B2C — `cdnur`) | ❌ `[NEVER until a client asks]` |
| Quantity write-back to stock | ❌ §2.1 |
| Agent (chat) intent | ❌ Read-only agent; a write intent is out of scope |
| Automatic generation from a return dispatch | ❌ §2.2 |

### 2.1 A credit note does not move stock `[DECIDED]`

This is the decision most likely to be argued with, so it is stated first.

A credit note is a **financial** document. It corrects value and tax. If goods physically came back,
that is a separate inventory event with its own document — a GRN, or a return dispatch carrying the
right `movement_purpose` — and it already has a path.

**Why not couple them.** Three of the five common reasons for a credit note involve **no physical
movement at all** (price correction, short delivery already reflected in stock, post-invoice
discount). Coupling would mean either inventing a stock movement that did not happen, or gating
credit notes on one that did. Both are wrong, and the first corrupts the ledger the whole product
rests on.

**The UI says so plainly**, because the owner will expect otherwise: *"This corrects the bill only.
If goods came back, record a GRN separately."*

### 2.2 A return dispatch does not auto-generate a credit note `[DECIDED]`

Same reasoning inverted. Most return dispatches on these tenants are `job_work_return` — KPML's own
material coming back — and those are **not a supply at all** `[LAW — kpml-network-plan.md §10.6]`;
they carry no taxable value anywhere in GSTR-1 and appear only as a document count in Table 13.
Auto-generating a credit note from one would create a financial document for a non-financial event
on every single return, on all three live tenants.

---

## 3. Schema

One table, modelled deliberately on `p2_invoices` so that every existing idiom transfers.

```sql
-- Session 20 — credit and debit notes under CGST s.34.
-- Modelled column-for-column on p2_invoices where the concepts match, so that
-- invoice-view/invoice-pdf patterns transfer without reinvention.
CREATE TABLE p2_credit_notes (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         uuid NOT NULL,

  note_type         text NOT NULL CHECK (note_type IN ('credit','debit')),
  note_number       text NOT NULL,                    -- CN-YYYYMM-NNN / DN-YYYYMM-NNN
  note_date         date NOT NULL
                      DEFAULT (now() AT TIME ZONE 'Asia/Kolkata')::date,

  -- The document being corrected. NOT NULL: v1 is registered-recipient only (cdnr).
  invoice_id        uuid NOT NULL REFERENCES p2_invoices(id),
  original_invoice_number text NOT NULL,              -- frozen snapshot
  original_invoice_date   date NOT NULL,              -- frozen snapshot

  -- Party, frozen at issue — same philosophy as p2_invoices
  client_id         uuid REFERENCES p2_clients(id),
  client_name       text NOT NULL,
  client_address    text,
  client_gstin      text,

  -- Value
  reason            text NOT NULL
                      CHECK (reason IN ('goods_returned','price_correction',
                                        'short_delivery','post_sale_discount','other')),
  reason_note       text,
  items             jsonb NOT NULL,                   -- frozen line snapshot, §3.1
  amount_subtotal   numeric(14,2) NOT NULL,
  amount_gst        numeric(14,2) NOT NULL,
  round_off         numeric(14,2) NOT NULL DEFAULT 0,
  amount_total      numeric(14,2) NOT NULL,
  gst_type          text NOT NULL CHECK (gst_type IN ('cgst_sgst','igst','none')),
  doc_category      text NOT NULL DEFAULT 'goods' CHECK (doc_category IN ('goods','services')),

  -- Lifecycle, mirroring p2_invoices exactly
  note_token        uuid NOT NULL DEFAULT gen_random_uuid(),
  status            text NOT NULL DEFAULT 'draft'
                      CHECK (status IN ('draft','sent','cancelled')),
  cancelled_at      timestamptz,
  cancelled_by      uuid REFERENCES auth.users(id),
  cancel_reason     text,

  created_by        uuid REFERENCES auth.users(id),
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE p2_credit_notes ENABLE ROW LEVEL SECURITY;

-- Three command-scoped policies, get_my_tenant_id(), NO DELETE.
-- NEVER auth.uid() — that is the known-broken pattern that silently blocks staff
-- (CLAUDE.md, RLS Fixes, Sessions 1-2).
CREATE POLICY p2_credit_notes_select ON p2_credit_notes
  FOR SELECT USING (tenant_id = get_my_tenant_id());
CREATE POLICY p2_credit_notes_insert ON p2_credit_notes
  FOR INSERT WITH CHECK (tenant_id = get_my_tenant_id());
CREATE POLICY p2_credit_notes_update ON p2_credit_notes
  FOR UPDATE USING (tenant_id = get_my_tenant_id())
              WITH CHECK (tenant_id = get_my_tenant_id());

CREATE UNIQUE INDEX p2_credit_notes_token_idx  ON p2_credit_notes (note_token);
CREATE UNIQUE INDEX p2_credit_notes_number_idx ON p2_credit_notes (tenant_id, note_number);
CREATE INDEX p2_credit_notes_invoice_idx       ON p2_credit_notes (invoice_id);
CREATE INDEX p2_credit_notes_tenant_date_idx   ON p2_credit_notes (tenant_id, note_date);

-- Two sequence counters on p2_tenant_settings, mirroring invoice_sequence.
ALTER TABLE p2_tenant_settings
  ADD COLUMN IF NOT EXISTS credit_note_sequence int NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS debit_note_sequence  int NOT NULL DEFAULT 0;
```

**`UNIQUE (tenant_id, note_number)` ships from day one.** `p2_invoices` has unique indexes on
`dispatch_order_id` and `invoice_token` but **nothing enforces `invoice_number` uniqueness, not even
per tenant** `[VERIFIED — CLAUDE.md Known Open Items #7]`. Correctness there rests entirely on the
counter never being hand-edited backward, which is a routine direct-SQL pattern in this project. Do
not inherit that gap.

**`invoice_id` is `NOT NULL`.** v1 is `cdnr` only — notes against a registered recipient with a
traceable original. `cdnur` (unregistered/B2C) is a different GSTR-1 sheet, a different value basis
and a different UI, and no client has asked. `[NEVER until named]`

**No DELETE policy.** A note is a statutory document. Cancellation is a status flip with an audit
trail — and unlike `cancelInvoice()`, this one **writes** `cancelled_at` / `cancelled_by` /
`cancel_reason` from day one.

### 3.1 `items` shape

Frozen at issue. `invoice-view`-style consumers read **only** this and never re-join price tables at
view time — the same reasoning as `p2_invoices.items`, so a later price change can never drift a
PDF from the totals already sent.

```json
[
  { "description": "Stator Stack KS100-4P CL200",
    "hsn_sac": "998898",
    "qty": 15, "unit": "NOS", "rate": 620.00, "amount": 9300.00,
    "original_invoice_line": 2 }
]
```

`original_invoice_line` is the 0-based index into the source invoice's own `items` array. It is what
lets the review UI show the original line beside the credited one, and it is what a CA checks.

---

## 4. Numbering `[LAW]`

`[LAW]` CGST **Rule 53(1A)** — a revised tax invoice, credit note and debit note each require *"a
consecutive serial number not exceeding sixteen characters, in one or multiple series… unique for a
financial year."*

**Format `[DECIDED]`:** `CN-YYYYMM-NNN` and `DN-YYYYMM-NNN`. Thirteen characters — inside the cap,
and the same shape as `INV-YYYYMM-NNN` (14) so a CA reading a document register sees one convention.

**Separate series from invoices, and separate from each other.** `[LAW]` Rule 53 permits multiple
series; GSTR-1 Table 13 reports credit notes and debit notes as **distinct document classes** from
tax invoices, so a shared series would make the document register unanswerable.

**RPC — one per series, mirroring `get_next_invoice_number` exactly:**

```sql
get_next_credit_note_number(p_tenant_id uuid) RETURNS text
get_next_debit_note_number(p_tenant_id uuid)  RETURNS text
```

Same row-locked-counter shape: `SELECT … FOR UPDATE` then `UPDATE`, both inside one plpgsql body so
the lock spans them and concurrent callers serialise `[VERIFIED — codebase-audit.md §3.7 confirms
this shape produces no duplicates on `get_next_invoice_number`]`.

**Two defects in `get_next_invoice_number` that must not be inherited** `[VERIFIED —
codebase-audit.md §3.7]`:

1. **A NULL sequence bricks the function permanently.** `NULL + 1` is NULL, the UPDATE writes NULL
   back, `lpad(NULL,3,'0')` makes the whole concatenation NULL, and the tenant can never invoice
   again with no diagnostic. **Use `COALESCE(credit_note_sequence, 0) + 1`** and insert a settings
   row if none exists, mirroring `get_next_challan_number` rather than `get_next_invoice_number`.
2. **The IST fix.** Stamp the `YYYYMM` segment via
   `to_char(now() AT TIME ZONE 'Asia/Kolkata', 'YYYYMM')`, never raw `now()` — the exact bug
   `20260901_fix_invoice_number_ist.sql` closed on invoices.

**Allocate the number inside the insert transaction.** `get_next_invoice_number` is called over
PostgREST and commits its bump in its own transaction, with the `p2_invoices` insert a **separate**
HTTP request — so any failure between them consumes a number permanently with no document
`[VERIFIED — codebase-audit.md §3.7, "Gaps on any post-allocation failure"]`. Do it in one
`SECURITY DEFINER` RPC here: allocate and insert together, or neither.

---

## 5. Value rules

### 5.1 A credit note may not exceed what remains creditable `[DECIDED]`

**Guard, enforced server-side:**

```
sum(amount_total of all non-cancelled CREDIT notes against this invoice)
  + this note's amount_total
  <= invoice.amount_total
```

A debit note has no upper bound — s.34(3) exists precisely because the original undercharged.

**Why server-side and not only in the UI.** `codebase-audit.md` §3.2 records the same class of gap
on invoices: the job-work purpose block was *"client-side only… there is no server-side rejection,"*
so a direct POST could raise a tax invoice on a `job_work_return` challan. Do not repeat it. The
guard lives in the RPC; the UI mirrors it for responsiveness.

### 5.2 GST follows the original `[DECIDED]`

`gst_type` and the rate are **copied from the source invoice**, never recomputed. A credit note
against an `igst` invoice is `igst`. A credit note against a `doc_category='services'` invoice is
`services`.

`amount_gst` uses the same flat-18% split as `buildInvoiceTotals` — CGST/SGST halves rounded to
paisa, total rounded to rupee, residual pushed into `round_off` `[VERIFIED — CLAUDE.md, Shipped
Sept 2]`. **Reuse `buildInvoiceTotals` itself rather than writing a second implementation.**
`kpml-network-plan.md` §17 names repeated implementation as this codebase's recurring failure
pattern — three invoice-button implementations, the `READ_ONLY_INTENTS` double-update hazard. A
second GST calculator would be the third instance, on a statutory document.

### 5.3 The time limit `[LAW]`

`[LAW]` CGST s.34(2) — the details of a credit note must be declared **no later than 30 November
following the end of the financial year** in which the supply was made, or the date of the annual
return, whichever is earlier. After that the note can still be issued commercially but the **tax
adjustment is not available**.

**Surface it, do not block on it.** A note against an invoice past the window shows an amber banner:
*"This invoice is from FY 2025-26. The GST adjustment window closed on 30 November 2026 — your CA
cannot claim this reduction. The note will still be issued as a commercial document."* Blocking
would be wrong; a silent issue would be worse.

This is the same posture as the existing s.16(4) ITC-expiry badge on `gstr2b-reconcile.html`
`[VERIFIED — Shipped Sept 2]` — badge, never block.

---

## 6. Surfaces

| Surface | Page | Gate |
|---|---|---|
| **Issue a note** | `invoices.html` → Detail modal → *"Issue Credit Note"* / *"Issue Debit Note"* | `status='sent'`, role `['owner','supervisor','accountant']`, Pro/Founder |
| **List** | `invoices.html` → new "Credit / Debit Notes" tab | Same role gate as the invoice list |
| **Public view + PDF** | `credit-note.html?token=…` | Public, token-scoped |
| **Cancel** | Detail modal | **Owner only** — same as Cancel Invoice after Session 6 |

**Why the Detail modal and not a new page.** `invoices.html` already refactored to a single Detail
button per row with an `#invoiceDetailModal` overlay `[VERIFIED — Shipped Sept 2]`. A note is always
*against* an invoice, so the affordance belongs where the invoice already is. This is the same
reasoning that moved the Generate Invoice button into `all-dispatch-history.html`'s Detail modal.

**Role gate — note the correction.** `all-dispatch-history.html`'s Generate Invoice was flipped in
Session 6 from *"not accountant"* to an explicit `['owner','supervisor','accountant']` allow-list,
blocking operator `[VERIFIED]`. Use the allow-list shape, not the exclusion shape.

**Modal `max-height`.** `.nx-modal` carries no `max-height` on `invoices.html` and a tall modal
clips its submit button off-screen at 390px `[VERIFIED — codebase-audit.md §5.4, and `invoices.html`
is named as the second-worst offender]`. The note modal grows one row per credited line. Give it
`max-height: 90vh; overflow-y: auto` — or better, fix `.nx-modal` in `css/nexflow-design.css` and
delete the per-page copies, which closes the bug for six modals at once.

### 6.1 The public view

`credit-note.html`, root level, no navbar, no auth — the same three-state shape as `invoice.html`
(no token → *"Invalid link"*; 404 → *"not valid or expired"*; other failure → generic retry)
`[VERIFIED]`.

Served by extending the **existing** `invoice-view` Edge Function with a `?type=credit_note`
parameter rather than deploying a second function. It already has the UUID regex guard, the
service-role read via `SB_SECRET_KEY`, and the strip-`tenant_id`-from-the-response discipline
`[VERIFIED — codebase-audit.md §4.10 rates its input validation "Good"]`.

**PDF:** `js/credit-note-pdf.js`, a sibling of `js/invoice-pdf.js`, not an extension of it — same
reasoning `js/invoice-pdf.js` itself records for not extending `challan-pdf.js`. It reuses
`window.invoiceAmountInWords` (already exported separately and synchronous with no jsPDF dependency)
and `loadPdfLibs`.

**Copies.** `[LAW]` Rule 48's Original/Duplicate/Triplicate requirement is for **tax invoices**.
Rule 53 prescribes no copy marking for notes. `[RECOMMENDED]` **one copy**, and print the legend
*"Credit Note under Section 34(1) of the CGST Act"* on the face. `[UNVERIFIED — confirm with a CA
whether their clients expect triplicate on notes by convention. §10 Q2.]`

---

## 7. The Bridge Agent side — already built, waiting

`bridge-agent.md` §5.5 ships the `CRN` / `DRN` handler in **Session 18**, with the source table
absent `[VERIFIED]`:

> *"Build the handler anyway, in Session 18, with the source table absent. The envelope, the
> `ACTION`/`VCHTYPE` mapping, the doc codes `CRN`/`DRN`, the REMOTEID derivation and the sync-log
> `doc_type` CHECK constraint all ship in v1. When Session 20 adds the feature, the Bridge Agent
> lights up with a query change and no new design."*

**What Session 20 must therefore satisfy, exactly:**

| Bridge Agent expects | Session 20 provides |
|---|---|
| A row id for the REMOTEID `source_key` | `p2_credit_notes.id`, lowercase UUID with hyphens |
| `doc` code `CRN` / `DRN` | Derived from `note_type` |
| `<REFERENCE>` pointing at the original document number | `original_invoice_number` — **do not omit it**, it is what makes the note reportable in GSTR-1 `cdnr` |
| Party side reversed vs the source voucher | Credit note: party **Credit** (`ISDEEMEDPOSITIVE=No`, positive). Debit note: party **Debit** (`Yes`, negative) |
| Contra ledger | `ledger_map.sales_taxable` / `sales_goods` by `doc_category`, exactly as Sales |
| Tax ledgers | `Output CGST/SGST/IGST` for a credit note; `Input …` for a debit note |
| A status flip that triggers enqueue | `status` `draft → sent`, same hook shape as `confirmGenerateInvoice` |

**The REMOTEID for the worked example** `bridge-agent.md` §6.3 already computes, so it can be
verified the day this ships:

```
note id  : 5d7e1f80-3c94-41a2-9b6e-08f27c15ae33  (Datta Prasad)
REMOTEID : NXF-3b68db90-CRN-66b2f31f2a689f04
```

**Do not change the canonical source-key formula to accommodate this table.** `bridge-agent.md` §6.6
rule 1: the id is written once at enqueue and never recomputed.

---

## 8. The filing package side

`enterprise-strategy.md` §3.2 specifies the GSTN V2.0 `cdnr` sheet headers, which are currently dead
code because no source exists:

| Col | Header |
|---|---|
| A | `GSTIN/UIN of Recipient` |
| B | `Receiver Name` |
| C | `Note Number` |
| D | `Note Date` |
| E | `Note Type` — `C` or `D` |
| F | `Place Of Supply` |
| G | `Reverse Charge` |
| H | `Note Supply Type` |
| I | `Note Value` |
| J | `Applicable % of Tax Rate` — **blank** |
| K | `Rate` — the **combined** rate (`18`), never the halves |
| L | `Taxable Value` |
| M | `Cess Amount` — `0` |

**Formatting rules that apply here as to every other sheet:** dates `DD-MMM-YYYY` as a **text
string**, note number alphanumeric with only `/` and `-`, **max 16 characters** (`CN-YYYYMM-NNN` is
13 ✓), amounts at most 2 decimals.

**Two integration points, both one-liners once the table exists:**

1. `filing-package/index.ts` — populate `cdnr` from `p2_credit_notes` where
   `status='sent'` and `note_date` falls in the period.
2. `export.html` — `computeTable13Buckets()` gains two document classes, **Credit Notes** and
   **Debit Notes**, with their own series ranges and cancelled counts. `challanSeriesKey()` already
   parses a `PREFIX-digits` shape, and `CN-YYYYMM-NNN` matches the same embedded-date branch added
   for legacy `CHAL-` rows in Session 11 `[VERIFIED]` — **verify this rather than assuming it**, §10 Q3.

**Also update `computeHsnSummary()`.** `[LAW]` A credit note reduces outward supply, so Table 12's
HSN summary must net it off. Today Table 12 reads `p2_invoices` with `status='sent'` only. Omitting
notes overstates HSN-wise outward supply by the full credited value — which is the same class of
error the `status='sent'` filter was added on 2 September to fix.

---

## 9. Build sequence

**One session.** No model calls, no new Edge Function, no cron.

| # | Step | Output |
|---|---|---|
| 1 | Migration `20261201_credit_debit_notes.sql` | One table, RLS enabled **in the same file**, 4 indexes, 2 sequence columns. Test tenant first; regression snapshot diffed against the most recent prior snapshot, not `baseline-pre-2H.json`. |
| 2 | `get_next_credit_note_number` / `get_next_debit_note_number` | §4, with **both** `get_next_invoice_number` defects avoided |
| 3 | `issue_credit_note()` RPC | Allocate + insert in one transaction; enforce §5.1's value guard and §5.2's GST copy; reuse `buildInvoiceTotals` |
| 4 | `invoices.html` — Detail modal action + new tab | §6. Role allow-list, not exclusion. Modal `max-height`. |
| 5 | `invoice-view` extension + `credit-note.html` + `js/credit-note-pdf.js` | §6.1 |
| 6 | `export.html` — Table 13 classes + Table 12 netting | §8 |
| 7 | `filing-package/index.ts` — `cdnr` sheet | §8 |
| 8 | Bridge Agent query change | §7. **Only if Session 18 has shipped**; otherwise the handler is already waiting and this is a no-op |
| 9 | Marathi | `invoices.html` is at 5/21 labels translated `[VERIFIED — codebase-audit.md §5.5]`. Do not make it worse: `data-en`/`data-mr` on every new label, `t(en, mr)` on every rendered row. |

**Acceptance test.** Issue a ₹9,300 credit note against a ₹1,18,000 Datta Prasad job-charge invoice.
Confirm: the number is `CN-202612-001`; a second note against the same invoice for ₹1,10,000 is
**rejected** by the server, not just the UI; the PDF renders with the original invoice number on its
face; Table 12's HSN total for `998898` drops by ₹9,300; Table 13 shows a Credit Notes class with
range 001–001; and — if Session 18 has shipped — the Tally voucher balances to zero with the party
on the credit side.

---

## 10. Failure modes and edge cases

| Case | Behaviour |
|---|---|
| Note against a **draft** invoice | Blocked. Edit the draft instead. The action only appears on `status='sent'`. |
| Note against a **cancelled** invoice | Blocked, with the reason stated. A cancelled invoice has nothing to credit. |
| Note that would exceed the invoice total | **Server-side rejection** (§5.1), with the remaining creditable amount in the message. |
| Note against an invoice past the s.34(2) window | Allowed, amber banner (§5.3). Never blocked. |
| Invoice cancelled **after** a note was issued against it | The note stands — it is a separate statutory document with its own number. Show both on the Detail modal. `[RECOMMENDED]` block invoice cancellation when a non-cancelled note references it, the same way `deleteClient()` blocks when invoices reference the client `[VERIFIED — precedent exists, Shipped Aug 17]`. |
| Cancelling a note | Owner only. Writes `cancelled_at` / `cancelled_by` / `cancel_reason` — **unlike `cancelInvoice()`**, which has the columns and does not write them. The number stays consumed, which is correct and is what Table 13's cancelled count reports. |
| Concurrent issue of two notes | The row-locked counter serialises. `UNIQUE (tenant_id, note_number)` is the backstop. |
| Note on a job-work invoice | Fine. The invoice was `SALE_INVOICEABLE_PURPOSES`-gated at creation; the note inherits its `doc_category='services'` and its SAC. |
| Bridge Agent posts the note, then the invoice is corrected | Different documents, different REMOTEIDs. Tally alters each in place. Nothing to reconcile. |
| `filed_through` covers the note's period | The Bridge Agent marks it `blocked_period` and never posts. The note still exists in Nexflow and still appears in the filing package — the period lock governs writes into Tally, not the document's existence. |

---

## 11. Open questions

**Q1. Is `cdnur` (unregistered recipient) ever needed?** `[RECOMMENDED: not until named]`
All three live tenants invoice a registered principal. `cdnur` is a different sheet, a different
value basis and a `NULL`-able `invoice_id`.
**Decide before:** the first B2C client.

**Q2. Do CAs expect triplicate copies on a note?** `[UNVERIFIED]`
Rule 48's copy requirement is for tax invoices; Rule 53 prescribes none for notes. Convention may
differ from the rule.
**Resolve:** ask in the same CA conversation as `compliance-monitoring.md` §7.
**Decide before:** step 5.

**Q3. Does `challanSeriesKey()` parse `CN-YYYYMM-NNN`?** `[UNVERIFIED]`
Its base regex is `/^(\D*)(\d+)$/`, which cannot parse digits in the middle. Session 11 added a
legacy branch for `CHAL-YYYYMMDD-NNNN`. `CN-202612-001` has the same shape problem.
**Resolve:** test before writing step 6. If the legacy branch does not generalise, extend it — do
not add a third parser.
**Decide before:** step 6.

**Q4. Should issuing a note be available to `accountant`?** `[RECOMMENDED: yes]`
§6 grants it. An accountant raising a credit note is normal practice, and Session 6 already
established the precedent by adding accountant to Generate Invoice. Note that `invoices.html`
currently **hides** New Consolidated Invoice from accountant, which `codebase-audit.md` §2.4 flags as
*"questionable — an accountant raising consolidated invoices is a normal workflow."* Be consistent
with the answer given there.
**Decide before:** step 4.

**Q5. Does a credit note ever need to reference more than one invoice?** `[RECOMMENDED: no]`
`[LAW]` s.34 permits one note against multiple invoices, and GSTR-1's `cdnr` accommodates it. But a
one-to-one link is what makes §5.1's value guard computable and what a CA reconciles most easily.
**Decide before:** a client asks. Build one-to-one; the schema can gain a link table later without
migrating what exists.

---

*Last updated: 11 September 2026. Design complete; no code written.*
*Move `[RECOMMENDED]` to `[DECIDED]` as decisions are taken, and record the §10 answers the day the
CA gives them.*
