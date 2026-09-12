---
name: supplier-payables-register
description: Nexflow Session 24 — the supplier payables register and Section 43B(h) exposure on the side the law actually bites. Supplier bill derivation from GRN groups, MSME fields on p2_suppliers, the p2_supplier_payments ledger, the 15-vs-45-day agreement problem, and the 31-March disallowance figure. Read in full before building Session 24.
sources: [CLAUDE.md Backlog and Shipped Aug 28/Sept 3, compliance-and-field-report.md §3.1 and §11, kpml-network-plan.md §10.4, codebase-audit.md §6.6, md-audit-report.md]
last_updated: 11 September 2026
status: design complete — not yet built. Blocked on CA confirmation of §3. Living document: update in place as it is built.
---

# Nexflow — Supplier Payables Register (Session 24)

**Load order for a Session 24 session. Read in this order, in full:**

1. `_ai/CLAUDE.md` — `p2_suppliers`, `p2_supplier_advances`, `p2_stock_transactions`, and
   "Shipped Aug 28, 2026" (the receivables-side 43B(h) card this one mirrors)
2. `_ai/supplier-payables-register.md` (this file)
3. `_ai/compliance-and-field-report.md` §3.1 — the legal chain, and the Rule 56(11) correction
4. `export.html` — the existing 43B(h) card, which measures the **wrong side** and says so

**Status: designed, not built.** Nothing here exists in the codebase.

**Blocked on a CA answer.** §3 carries the single question that decides whether the headline number
this feature produces is right or understated by two-thirds. Do not ship the client-facing figure
before it is answered. Everything else in the build can proceed.

---

## Tag convention

Inherited from `enterprise-strategy.md`, unchanged.

| Tag | Meaning |
|---|---|
| `[DECIDED]` | Decided. Build it as written. |
| `[RECOMMENDED]` | This document's recommendation. Needs founder sign-off. |
| `[VERIFIED]` | Checked against the live codebase, 11 Sept 2026. |
| `[LAW]` | Traced to the bare Act or Rule. A CA should still confirm before shipping. |
| `[UNVERIFIED]` | Needs a live check before code is written. Listed again in §11. |
| `[DECIDE BEFORE BUILDING]` | A human or CA decision. Listed again in §11. |
| `[NEVER]` | Permanently out of scope. |

---

## 1. Why this exists

`CLAUDE.md`'s Backlog states the problem in one sentence and it is exactly right:

> **The actual 43B(h) legal risk is on payables (who you owe) not receivables (who owes you). The
> 43B(h) surface in `export.html` currently measures receivables — placeholder only.**

What shipped on 28 August is a **receivables** report: it reads `p2_invoices`, filters `p2_clients`
by Udyam eligibility, and tells the tenant which of *their customers* are late paying *them*
`[VERIFIED — CLAUDE.md, Shipped Aug 28]`. On 2 September it was honestly retitled *"Buyer Payment
Compliance (Your Receivables)"*, and in Session 3 a second card — *"Supplier Payment Compliance —
43B(h)"* — was added carrying **an explanation and a placeholder** `[VERIFIED]`.

That is the correct sequence of honest half-steps. This session fills the placeholder.

### 1.1 What the law actually does

`[LAW]` **Income Tax s.43B(h)**: a payment to a supplier registered as a **Micro or Small**
enterprise under Udyam, outstanding beyond the permitted period on **31 March**, is **disallowed as
a deduction** for that financial year, and allowed only in the year of actual payment.

`[LAW]` **MSMED s.15**: the permitted period is **45 days where there is a written agreement, 15
days where there is not.**

`[LAW]` **MSMED s.16**: on delayed payment the buyer owes compound interest at **three times the RBI
bank rate, with monthly rests**, and that interest is **itself not deductible**.

`[LAW]` **Scope limits, and getting these wrong in front of a CA costs credibility on everything
else**: **Micro and Small only** — Medium is excluded. **Udyam-registered only.** And **not** where
the registration is for **trading**.

**The direction of the risk.** The receivables report tells a tenant that *someone else* has a tax
problem. The payables register tells the tenant that **they** do. One is a nice-to-have; the other
is the number their own CA will ask for in March.

### 1.2 It is also the KPML pitch, inverted

`kpml-network-plan.md` §10.4 makes the commercial case and it is the strongest single lever in the
network strategy:

> Framed as *"vendors are chasing you,"* KPML's accounts head buries it. Framed as **"₹18,60,000 of
> vendor bills will be disallowed on 31 March — roughly ₹5,60,000 of extra tax"**, their CA asks for
> it by name.

That figure is a **payables** figure. The principal dashboard cannot produce it today because the
payables register does not exist. Session 24 is what makes the KPML compliance pitch demonstrable
rather than described.

---

## 2. The schema problem: there is no supplier bill

This is the finding that shapes the whole build, and it is easy to miss.

**Nexflow has no supplier invoice table.** `[VERIFIED]` There is no `p2_purchase_invoices`, no
`p2_supplier_bills`. `CLAUDE.md` is explicit that there are also no `p2_grn_items` or
`p2_grn_headers` tables — *"a GRN is N rows in `p2_stock_transactions` sharing one `grn_no`… with
`invoice_no` set PER ROW."*

So a supplier bill is a **derived group**, not a row:

```
bill = GROUP BY (supplier_id, normaliseInvoiceNo(invoice_no))
       OVER p2_stock_transactions
       WHERE transaction_type = 'grn' AND owned_by IS NULL
```

Three properties follow, each of which matters:

1. **`owned_by IS NULL` is mandatory.** Principal-owned free-issue material under s.143 has **no
   supplier invoice, no purchase and no ITC** — it is not a payable at all. Including it would
   invent a debt to KPML that does not exist, on all three live tenants. This is the same invariant
   `bridge-agent.md` §4.1 enforces in three places for Purchase vouchers, for the same reason.
2. **Taxable value is `quantity × rate`.** There is no amount column on `p2_stock_transactions`
   `[VERIFIED — CLAUDE.md, GSTR-2B section]`. The `rate` column is the GRN-specific paid rate, **not**
   the valuation rate from `p2_material_prices`.
3. **The normalisation must be byte-identical** to `normaliseInvoiceNo()` in
   `gstr2b-reconcile.html:299`, `grn.html`, and `js/full-export.js:73-75`:

```js
const normaliseInvoiceNo = (s) => String(s || '').replace(/[\s\-\/]/g, '').toUpperCase();
```

If it diverges, the payables register, the GSTR-2B reconciliation and the Bridge Agent will disagree
about what counts as one bill — and the register's whole value is that a CA can tie it to the
purchase register.

### 2.1 Bill date — and why it is not the GRN date `[DECIDED]`

The 43B(h) clock runs from **acceptance of the goods or services**, not from when the buyer got
round to entering them.

`p2_stock_transactions` has `transaction_date` (the GRN date) and **no supplier invoice date
column** `[VERIFIED — the s.16(4) expiry badge in `gstr2b-reconcile.html` uses `transaction_date` as
an explicit invoice-date proxy, and says so]`.

`[DECIDED]` **Use `MIN(transaction_date)` across the group as the bill date, and label it honestly.**
The register's column header reads *"Received (GRN date)"*, not *"Invoice date"*. Where the two
differ — a bill entered a week late — the register **understates** days outstanding, which is the
safe direction for a compliance figure a client acts on.

`[RECOMMENDED]` Add `supplier_invoice_date date` to `p2_stock_transactions` in the same migration,
nullable, no backfill, captured on the GRN form beside the already-mandatory `invoice_no`. It is one
field on a form the storekeeper already fills, and it removes the proxy permanently. **§11 Q2.**

---

## 3. The 15-versus-45-day problem `[DECIDE BEFORE BUILDING]`

**This is the question that decides whether the headline number is right.**

Today the receivables card hardcodes **45 days** everywhere: `due_date = invoice_date + 45` per row,
and `v_p2_invoice_payment_status`'s overdue predicate is `invoice_date < today - 45`
`[VERIFIED — CLAUDE.md, Shipped Aug 28 and 20260901_payment_status_invoice_date.sql]`. The
disclaimer discloses the gap; the number does not reflect it.

`[LAW]` The statute is **45 days with a written agreement, 15 without.** Nexflow has no agreement
record and no `agreement_days` column. A factory buying from twenty small suppliers on purchase
orders and verbal terms very plausibly has **no written agreement with most of them** — in which
case the permitted period is 15 days and the true disallowance figure is **substantially larger than
45 days produces.**

**Three options:**

| Option | Behaviour | Verdict |
|---|---|---|
| A — keep 45 universally | Today's behaviour, extended to payables | Understates on every supplier without an agreement. Wrong in the dangerous direction for a figure a client's CA will file against. |
| B — default 15, override to 45 per supplier | `agreement_days` on `p2_suppliers`, default 15 | Conservative and loud. More alarming until the data is filled. |
| **C — per-supplier, unset until answered** | `agreement_days smallint NULL CHECK IN (15, 45)`. A supplier with NULL is **excluded from the headline figure and listed separately** as *"terms not recorded"* | **`[RECOMMENDED]`** |

**Why C.** `kpml-network-plan.md` §10.1's rule for the s.143 timer applies unchanged here: *"a false
all-clear is worse than no feature."* Option A produces a confident understatement. Option B produces
a confident overstatement on any supplier who does have an agreement. **Option C refuses to produce a
number it cannot justify**, shows the gap as a count the owner can close in ten minutes, and gets
more accurate as they fill it — which is the same shape as the existing *"N clients missing Udyam
data"* warning banner that already works on the receivables card.

**The CA question, exactly as to ask it:**

> *"For a manufacturer buying from small suppliers on a purchase order with no separate signed
> agreement — is the 43B(h) period 15 days or 45? Does a PO with printed payment terms count as a
> written agreement for MSMED s.15?"*

**Decide before:** the headline disallowance figure is shown to any client. The register itself can
be built and tested in the meantime with `agreement_days` present and unset.

---

## 4. Schema

Three changes. One adds MSME fields to suppliers, one adds a payment ledger, one adds the invoice
date from §2.1.

```sql
-- 20261215_supplier_payables.sql
-- Session 24. Applied via the Supabase SQL Editor, never `supabase db push`.

-- 1. MSME eligibility on suppliers. Mirrors the three fields added to p2_clients
--    on 25 Aug 2026 for the receivables side — same names, same CHECKs, so one
--    eligibility helper serves both directions.
ALTER TABLE p2_suppliers
  ADD COLUMN IF NOT EXISTS udyam_number          text,
  ADD COLUMN IF NOT EXISTS enterprise_class      text
    CHECK (enterprise_class IN ('micro','small','medium')),
  ADD COLUMN IF NOT EXISTS registration_activity text
    CHECK (registration_activity IN ('manufacturing','trading','services')),
  ADD COLUMN IF NOT EXISTS agreement_days        smallint
    CHECK (agreement_days IN (15, 45));            -- §3. NULL = terms not recorded.

-- 2. The supplier payment ledger. Obligations (the bill, derived from GRN groups)
--    stay separate from receipts (each actual money movement) — the same model
--    p2_payment_receipts uses on the sales side, and for the same reason: TDS,
--    partials and deductions all break a single-amount-plus-status column.
CREATE TABLE p2_supplier_payments (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          uuid NOT NULL,
  supplier_id        uuid NOT NULL REFERENCES p2_suppliers(id),

  -- Which bill. The bill is a derived group, so the key is the group key.
  bill_key           text NOT NULL,          -- normaliseInvoiceNo(invoice_no)
  bill_invoice_no    text NOT NULL,          -- as printed on the supplier's bill

  payment_date       date NOT NULL,
  gross_amount       numeric(14,2) NOT NULL CHECK (gross_amount > 0),
  tds_amount         numeric(14,2) NOT NULL DEFAULT 0 CHECK (tds_amount >= 0),
  other_deductions   numeric(14,2) NOT NULL DEFAULT 0 CHECK (other_deductions >= 0),
  net_amount         numeric(14,2) GENERATED ALWAYS AS
                       (gross_amount - tds_amount - other_deductions) STORED,

  payment_mode       text NOT NULL
                       CHECK (payment_mode IN ('neft','rtgs','cheque','upi','cash',
                                               'adjustment','advance_drawdown')),
  reference_no       text,
  advance_id         uuid REFERENCES p2_supplier_advances(id),  -- §5.2
  notes              text,

  created_by         uuid REFERENCES auth.users(id),
  created_at         timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE p2_supplier_payments ENABLE ROW LEVEL SECURITY;

-- Three command-scoped policies, get_my_tenant_id(), NO DELETE — append-only
-- financial record, same as p2_supplier_advances.
-- NEVER auth.uid(): that is the known-broken pattern live on p2_payment_receipts
-- which silently fails for non-owner staff (CLAUDE.md, RLS Fixes).
CREATE POLICY p2_supplier_payments_select ON p2_supplier_payments
  FOR SELECT USING (tenant_id = get_my_tenant_id());
CREATE POLICY p2_supplier_payments_insert ON p2_supplier_payments
  FOR INSERT WITH CHECK (tenant_id = get_my_tenant_id());
CREATE POLICY p2_supplier_payments_update ON p2_supplier_payments
  FOR UPDATE USING (tenant_id = get_my_tenant_id())
              WITH CHECK (tenant_id = get_my_tenant_id());

CREATE INDEX p2_supplier_payments_bill_idx
  ON p2_supplier_payments (tenant_id, supplier_id, bill_key);
CREATE INDEX p2_supplier_payments_date_idx
  ON p2_supplier_payments (tenant_id, payment_date);

-- 3. §2.1 — the supplier's own invoice date, so the 43B(h) clock stops using
--    the GRN date as a proxy. Nullable, no backfill.
ALTER TABLE p2_stock_transactions
  ADD COLUMN IF NOT EXISTS supplier_invoice_date date;

-- 4. The index the register's hot path needs. p2_stock_transactions has no
--    (tenant_id, supplier_id) index and it is the largest table in the product
--    (codebase-audit.md §6.3).
CREATE INDEX IF NOT EXISTS p2_stock_transactions_tenant_supplier_idx
  ON p2_stock_transactions (tenant_id, supplier_id)
  WHERE transaction_type = 'grn';
```

**`net_amount` is a generated column — never include it in an INSERT payload.** This is the exact
trap `p2_payment_receipts` already documents `[VERIFIED — CLAUDE.md]`, and the same mistake here
would be rejected by Postgres with a message the UI cannot explain.

**No DELETE policy.** A payment record is a financial fact. A correction is a new row with a negative
`other_deductions` or an explicit reversal, never an erase.

**`bill_key` is denormalised deliberately.** The bill has no row to reference, so the payment carries
the group key. `bill_invoice_no` is kept alongside it because the key is normalised and the human
needs to see what was printed on the paper.

---

## 5. Derivation

### 5.1 The register query

```
FOR each (supplier_id, bill_key) group over p2_stock_transactions
    WHERE transaction_type = 'grn'
      AND owned_by IS NULL                    -- never principal-owned material
      AND invoice_no IS NOT NULL AND invoice_no <> ''
      AND tenant_id = <tenant>

  bill_amount      = SUM(quantity * rate)              -- taxable value
  bill_gst         = SUM(quantity * rate * gst_rate/100)  -- from p2_raw_materials.gst_rate
  bill_total       = bill_amount + bill_gst
  bill_date        = MIN(COALESCE(supplier_invoice_date, transaction_date))
  paid             = SUM(net_amount) FROM p2_supplier_payments for this (supplier, bill_key)
  outstanding      = bill_total - paid
  permitted_days   = p2_suppliers.agreement_days        -- NULL → excluded from the figure
  due_date         = bill_date + permitted_days
  days_overdue     = GREATEST(0, today - due_date)
```

**Rows with no `supplier_id` or a blank `invoice_no` are listed separately, never guessed.** Datta
Prasad's August data contains exactly one such orphan — *"1 orphan GRN (27 Aug, 50 units STATOR
STACK KS100-4P CL200) with no supplier name and no invoice number"* `[VERIFIED — CLAUDE.md, Session
16 follow-up]` — so this path fires on real data in the first month. The register shows it under
*"Cannot assess — GRN missing supplier or invoice number"* with a link to fix it.

**GST rate note.** Datta Prasad has *"15 GRN lines recorded at 0% GST against identical 18% goods"*
`[VERIFIED — Session 16]`. Those will compute a lower `bill_total` than the supplier actually
billed. The register must **not** silently correct it — it reflects what Nexflow holds, which is
wrong data — but it should flag the group, because a 0%-rate purchase against 18% goods is a
data-quality signal the Opus covering note already catches monthly and this is a second, earlier
detector.

### 5.2 Advances, and the view that is currently wrong

`p2_supplier_advances` already tracks lump-sum prepayments `[VERIFIED — Step 3.5, 2 Sept]`. A
payment with `payment_mode = 'advance_drawdown'` and an `advance_id` draws one down against a
specific bill.

**`v_p2_supplier_advance_balance` has a real arithmetic bug that Session 24 should fix, because it
is the same surface.** `[VERIFIED — codebase-audit.md §6.6]`:

> `total_drawn = SUM(quantity * rate)` over **every GRN that tenant has ever recorded from that
> supplier**, with no date bound and no link to any specific advance. Record a ₹2,00,000 advance to a
> supplier the tenant has bought ₹18,00,000 from over two years, and the balance immediately reads
> **−₹16,00,000** — rendered red as if massively overdrawn. Datta Prasad, the client who asked for
> this feature, has 28 suppliers with existing GRN history.

`[RECOMMENDED]` Once `p2_supplier_payments` exists, `total_drawn` becomes
`SUM(net_amount) WHERE payment_mode = 'advance_drawdown' AND advance_id = <advance>` — an explicit
link rather than an inference over history. That is the fix the audit recommends and it falls out of
this session's schema for free.

### 5.3 Interest `[LAW]`

`[LAW]` MSMED s.16: **three times the RBI bank rate, compounded with monthly rests.**

The receivables card computes **simple** interest and discloses the gap `[VERIFIED — CLAUDE.md,
Shipped Aug 28]`. That understates.

`[RECOMMENDED]` **Compute it properly here**, because this is the side where the tenant pays it:

```
months = floor(days_overdue / 30)
interest = outstanding × ((1 + (3 × bank_rate / 100) / 12) ^ months − 1)
```

Show simple and compounded side by side for one release so the difference is visible, then keep
compounded. And **do not hardcode the bank rate** — it belongs in
`_ai/compliance-constants.json` under `msme_interest_rate`, which `compliance-monitoring.md` §3.2
already reserves for it, so A2 flags an RBI change.

---

## 6. The 31 March number

This is the figure the whole feature exists to produce.

```
disallowance = SUM(outstanding)
               WHERE supplier is MSME-eligible (§6.1)
                 AND agreement_days IS NOT NULL
                 AND due_date <= 31-March of the selected FY
                 AND still outstanding on that date

extra_tax    = disallowance × effective_tax_rate
```

**`effective_tax_rate` is an input, not an assumption.** `[DECIDED]` A proprietorship, a partnership
and a PVT LTD pay different rates, and Nexflow does not know the tenant's slab. Show a selector
defaulting to **25%** (the common domestic-company rate) with the figure recomputing live, and label
it *"at your tax rate"*. `kpml-network-plan.md` §10.4's worked example uses ~30% (₹18.6L → ₹5.6L);
that is a plausible number for a PVT LTD and a wrong one to hardcode.

### 6.1 Eligibility — the filter that must not be got wrong

```
enterprise_class      IN ('micro', 'small')          -- Medium EXCLUDED
registration_activity IN ('manufacturing', 'services') -- trading EXCLUDED
udyam_number          IS NOT NULL AND <> ''
```

Byte-identical to the receivables card's filter `[VERIFIED — CLAUDE.md, Shipped Aug 28]`. **Extract
it into one helper used by both directions** rather than writing it twice — this codebase's
documented recurring failure is repeated implementation, and an eligibility rule that drifts between
two 43B(h) surfaces is exactly the kind a CA catches.

**The warning banner comes first.** Count suppliers missing Udyam data **before** the eligibility
filter and show it above the figure: *"23 of 28 suppliers have no Udyam details. The figure below
covers 5."* The receivables card already does this and it is the right pattern — a compliance number
computed over a fifth of the book, presented without that sentence, is a lie of omission.

### 6.2 What to say, and what never to say

`[NEVER]` Do not call the output a tax computation, a filing figure, or advice. Nexflow produces
data; the CA decides.

The disclaimer, mirroring the receivables card's and extending it:

> This is an estimate from the bills and payments recorded in Nexflow. It covers only suppliers
> whose Udyam details you have entered and whose payment terms you have recorded. Interest is
> computed at three times the RBI bank rate compounded monthly per MSMED s.16. **Your CA must
> confirm the disallowance before it is relied on for filing.**

---

## 7. Surfaces

| Surface | Where | Gate |
|---|---|---|
| **Payables register** | `export.html` → replaces the *"Supplier Payment Compliance — 43B(h)"* placeholder card | `TABLE13_ROLES` = `['owner','accountant','supervisor']`, all plans |
| **Record a payment** | Same card, per bill row | `['owner','accountant']` |
| **MSME fields on a supplier** | `settings.html` → Suppliers tab, the existing inline edit row | Owner only (page-level) |
| **Excel download** | Same card | Same as the card |

**Why `export.html` and not a new page.** The receivables card is already there, `TABLE13_ROLES` is
the established gate for every CA-facing tool on that page, and `gstr2b-reconcile.html`'s precedent
is that *"CA/accounting tools stay together"* `[VERIFIED]`. A CA opening one page for the purchase
register, Table 12, Table 13, the receivables card and the payables register is the workflow; a
sixth page is not.

**Page-level gate reminder.** `export.html`'s gate was tightened in Session 6 from
`canAccess(role,'reports')` — which included operator — to a direct
`['owner','supervisor','accountant']` check `[VERIFIED]`. `TABLE13_ROLES` is now a redundant subset.
Use it anyway, for consistency with the four sibling sections.

**The supplier inline edit row already exists.** It was built from scratch on 7 August with
name/mobile/address/gstin `[VERIFIED]`. The four MSME fields extend it — do not build a second
editor.

**English only.** `export.html` is deliberately excluded from translation, CA-facing column names
stay English `[VERIFIED — CLAUDE.md]`. Follow the precedent; do not add `data-mr` here.

### 7.1 Register columns

| Column | Source |
|---|---|
| Supplier | `p2_suppliers.name` |
| Udyam | number, class badge (Micro/Small/**Medium — not eligible**) |
| Bill No | `bill_invoice_no` as printed |
| Received | `bill_date`, labelled as the GRN date where `supplier_invoice_date` is null |
| Bill Total | `bill_total` |
| Paid | `SUM(net_amount)` |
| **Outstanding** | `bill_total − paid` |
| Terms | `agreement_days`, or **"not recorded"** in amber |
| Due | `bill_date + agreement_days`, blank when terms are unrecorded |
| **Days Overdue** | red beyond 0 |
| Interest (est.) | §5.3, compounded |
| 31-Mar Risk | ✅ / ⚠️ / ❌ against the selected FY |

Sorted **worst first** — highest `days_overdue`, then highest `outstanding`. The same worst-first
convention the HSN audit and the ITC-04 workbook already use.

**Colour convention — reuse, do not invent.** `FFD4F7DC` green, `FFFFF0B3` amber, `FFFFC9C9` red in
the Excel; on screen, the left border of the row's first `<td>`, because `<tr>` cannot carry a
border under `.nx-table`'s `border-collapse: collapse` — a trap Session 14 already hit and
documented `[VERIFIED]`.

---

## 8. Build sequence

**One session**, plus calendar time for the §3 CA answer, which runs in parallel.

| # | Step | Output |
|---|---|---|
| 1 | Migration `20261215_supplier_payables.sql` | §4. Test tenant first; regression snapshot diffed against the most recent prior snapshot, **not** `baseline-pre-2H.json`. |
| 2 | Shared MSME eligibility helper | §6.1. Extract from the receivables card; both directions call it. |
| 3 | `settings.html` — four fields on the supplier inline edit row | Udyam number, class, activity, agreement days |
| 4 | Bill derivation | §5.1. **Verify the grouping matches `gstr2b-reconcile.html`'s output on the same period** — if the two disagree on bill count, one of them is wrong and it matters which. |
| 5 | Register table + the missing-Udyam banner | §7.1 |
| 6 | Record Payment modal | `max-height: 90vh; overflow-y: auto` — `.nx-modal` has none on most pages and tall modals clip their submit button at 390px `[VERIFIED — codebase-audit.md §5.4]`. Net-first field order, per the Session 2 fix to the receipts modal. |
| 7 | 31-March figure + tax-rate selector | §6 |
| 8 | Excel download | Mirrors `downloadTable12Excel()`'s shape — ExcelJS, orange header via `styleHeaderRow()`, summary + disclaimer rows at the bottom |
| 9 | `v_p2_supplier_advance_balance` fix | §5.2. Same surface, real bug, one session. |
| 10 | **CA conversation** | §3, §11. Calendar time. Fill `agreement_days` for the live tenants once answered. |

**Acceptance test.** On the test tenant, create three supplier bills: one from a Micro manufacturing
supplier with Udyam and 45-day terms, 60 days old, unpaid; one from a Medium supplier, 90 days old
(must be **excluded**); one from a trading-registered Small supplier (must be **excluded**). The
headline figure must equal the first bill's outstanding, the banner must name the two exclusions,
and the Excel must reconcile to the on-screen total to the rupee.

---

## 9. Failure modes and edge cases

| Case | Behaviour |
|---|---|
| Supplier has no Udyam data | Excluded from the figure, counted in the banner. Never assumed eligible. |
| `agreement_days` is NULL | Excluded from the figure, listed under *"terms not recorded"*. **Never defaulted silently.** §3. |
| GRN has no `supplier_id` or blank `invoice_no` | Listed under *"Cannot assess"*, with a link to fix. Fires on Datta Prasad's real orphan row in month one. |
| Bill is principal-owned (`owned_by` not null) | **Never appears.** Not a payable. Enforced in the query, and asserted again in the builder. |
| Overpayment recorded against a bill | Allowed — retention releases and rounding happen — but flagged amber. Never blocked. |
| Payment recorded before the bill exists | Allowed. `bill_key` is a string, not an FK. The register shows a negative outstanding and flags it. |
| Bill spans two GRN batches on different days | One bill. `bill_date = MIN(...)`. This is the split-delivery case `bridge-agent.md` §6.4 also handles. |
| Supplier renamed | `supplier_id` is the key; the name is display only. |
| 0% GST on an 18% material | `bill_total` understates. Flagged, not corrected. §5.1. |
| Same invoice number from two different suppliers | Different `supplier_id` → different group. Correct. |
| Duplicate GRN entry of one supplier invoice | **Both rows land in the same group and the bill total doubles.** This is the known GRN duplicate-invoice gap — UI guard shipped Session 12, DB partial unique index still open `[VERIFIED — CLAUDE.md Known Open Items #1]`. The register inherits it. Flag any group whose row count exceeds its distinct `raw_material_id` count. |

---

## 10. Out of scope `[NEVER]`

1. **Filing, or computing a tax liability.** Nexflow produces the exposure; the CA computes the tax.
2. **Paying anybody.** No payment gateway, no bank integration, no payment file export.
3. **A supplier portal.** Suppliers do not log in. `kpml-network-plan.md` §5's warning applies: the
   moment Nexflow asks a counterparty to log in for someone else's benefit it becomes a supplier
   portal and inherits every one of that category's failure modes.
4. **Auto-creating supplier bills from GSTR-2B.** The 2B is the counterparty's claim, not the
   tenant's record. `gstr2b-reconcile.html`'s "Unrecorded" bucket already surfaces the gap and the
   answer is to enter the GRN, not to synthesise one.
5. **Medium enterprises, or trading registrations.** Excluded by law, and including them to make the
   number bigger would be the exact credibility failure `compliance-and-field-report.md` §3.1 warns
   about.

---

## 11. Open questions

**Q1. Is the period 15 days or 45 for a purchase on a PO with no separate signed agreement?**
`[DECIDE BEFORE BUILDING]` — §3. This decides whether the headline figure is right or understated by
roughly two-thirds on most suppliers.
**Decide before:** the figure is shown to any client.

**Q2. Should `supplier_invoice_date` be captured on the GRN form?** `[RECOMMENDED: yes]` — §2.1.
One field beside the already-mandatory `invoice_no`. Removes the GRN-date proxy permanently, and the
same column would let `gstr2b-reconcile.html` stop using `transaction_date` as its s.16(4)
invoice-date proxy — two fixes from one field.
**Decide before:** step 1.

**Q3. Compounded or simple interest?** `[RECOMMENDED: compounded]` — §5.3. The statute compounds.
The receivables card computes simple and discloses it. Showing a client a smaller number than they
owe is the wrong direction for a figure they will act on.
**Decide before:** step 7.

**Q4. What effective tax rate?** `[RECOMMENDED: a selector, default 25%]` — §6. Nexflow does not
know the tenant's slab and should not guess it into a compliance figure.
**Decide before:** step 7.

**Q5. Does the principal dashboard get this per vendor?** `[RECOMMENDED: yes, Session 22]`
This is the KPML pitch (§1.2) — *"₹18,60,000 of vendor bills will be disallowed on 31 March."* It is
a **cross-tenant aggregate**, so it must go through the single scoped access path and must never
span principals. See `_ai/kpml-network-sessions-21-22.md` §3 failure mode 1.
**Decide before:** Session 22.

---

*Last updated: 11 September 2026. Design complete; no code written.*
*Move `[RECOMMENDED]` to `[DECIDED]` as decisions are taken, and write the §3 CA answer into this
file and into `_ai/compliance-constants.json` the day it is given.*
