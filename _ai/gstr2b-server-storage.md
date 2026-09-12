---
name: gstr2b-server-storage
description: Nexflow Session 25 — GSTR-2B server-side storage. p2_gstr2b_uploads and p2_gstr2b_rows, the parse-then-persist split, the shared matcher that must not fork, sheet 02 of the filing package, and the privacy line that decides what is stored. Read in full before building Session 25.
sources: [enterprise-strategy.md §3.2 and §9 Q3, CLAUDE.md Shipped Aug 12/Aug 17/Sept 2 and Session 15, gstr2b-reconcile.html, md-audit-report.md]
last_updated: 11 September 2026
status: design complete — not yet built. Living document: update in place as it is built.
---

# Nexflow — GSTR-2B Server-Side Storage (Session 25)

**Load order for a Session 25 session. Read in this order, in full:**

1. `_ai/CLAUDE.md` — the full GSTR-2B Reconciliation section under "Shipped August 12, 2026",
   plus the Aug 17 Excel-upload entry and the Sept 2 five-fix entry
2. `_ai/gstr2b-server-storage.md` (this file)
3. `gstr2b-reconcile.html` — the working matcher. **It is the specification.** Do not rewrite it.
4. `supabase/functions/filing-package/index.ts` — the consumer

**Status: designed, not built.** Nothing here exists in the codebase.

**Why this is its own file.** It touches three subsystems simultaneously — the reconciliation tool,
the filing package, and the CA's monthly workflow — and `enterprise-strategy.md` §9 Q3 flags it as
*"a real new requirement with a schema change and an RLS policy; it is **not** a free addition"*,
with a decision deadline (*"E2 design freeze"*) that has already passed. Session 15 shipped E2 Part 1
with the explicit known limitation: *"GSTR-2B reconciliation sheet deferred to Part 2 (requires
`p2_gstr2b_uploads` table)."*

---

## Tag convention

Inherited from `enterprise-strategy.md`, unchanged.

| Tag | Meaning |
|---|---|
| `[DECIDED]` | Decided. Build it as written. |
| `[RECOMMENDED]` | This document's recommendation. Needs founder sign-off. |
| `[VERIFIED]` | Checked against the live codebase, 11 Sept 2026. |
| `[UNVERIFIED]` | Needs a live check before code is written. Listed again in §10. |
| `[NEVER]` | Permanently out of scope. |

---

## 1. The problem in one paragraph

`gstr2b-reconcile.html` works, it is good, and it is **entirely client-side**. The owner downloads
their GSTR-2B from the portal, uploads it to the page, and the matching runs in the browser —
*"GSTR-2B JSON never sent to server"* `[VERIFIED — CLAUDE.md]`. That was the right call for a
reconciliation screen: no storage, no privacy question, no schema.

It is the wrong shape for a **server-generated monthly package**. The filing package runs on the 5th
at 08:00 IST from a cron, with no browser and no human. It has nothing to reconcile against, so
sheet 02 does not exist, and `00-READ-THIS-FIRST.html` has to tell the CA to go and run the
reconciliation themselves — which is exactly the manual step the package exists to remove.

**What Session 25 does:** persist the *parsed rows* for a period so the server can reconcile without
the browser, and so the CA gets sheet 02 without anybody asking.

**What it does not do:** change the matcher. §4.

---

## 2. The privacy line — what is stored and what is not `[DECIDED]`

`enterprise-strategy.md` §3.2 draws it and this document holds it exactly:

> add `p2_gstr2b_uploads` storing the **parsed b2b/cdnr/b2ba rows** for a period — **never the raw
> portal file.**

**Stored:** the fields the matcher actually reads — counterparty GSTIN, counterparty name, document
number, document date, taxable value, the four tax amounts, the ITC-eligibility flag, the filing
flag, the IMS status, and the document type.

**Not stored `[NEVER]`:** the raw JSON or XLSX file, in Storage or in a column. Three reasons, and
the third is the one that matters:

1. It is the taxpayer's statutory download and Nexflow has no need for the original bytes.
2. It contains sections Nexflow deliberately ignores — `SUM`, `IMPG` `[VERIFIED]` — which would be
   held with no purpose.
3. **The parsed row set is the auditable artefact.** A CA who does not trust sheet 02 wants to see
   the rows that produced it, not a file they already have. Storing the parse output makes the
   package auditable in the sense `enterprise-strategy.md` §3.2 means it; storing the file makes it
   a black box with an attachment.

**Retention.** Rows live as long as the tenant. They are small (a busy tenant is a few hundred rows a
month) and a CA asking *"what did the 2B say in August"* eighteen months later is the normal case at
assessment. **Do not add a retention sweep.** `automation-strategy.md` §10 Q6's storage-retention
concern is about multi-megabyte zips, not rows.

---

## 3. Schema

Two tables: one per upload (the period-level facts and the portal's own header), one per parsed
document row.

```sql
-- 20261215_gstr2b_uploads.sql
-- Session 25. Applied via the Supabase SQL Editor, never `supabase db push`.

CREATE TABLE p2_gstr2b_uploads (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          uuid NOT NULL,

  period             text NOT NULL,          -- 'YYYY-MM'. The 2B's own return period.
  period_source      text NOT NULL
                       CHECK (period_source IN ('file','derived')),
  -- 'file'    → the JSON declared it (rtnprd)
  -- 'derived' → an Excel upload, inferred from min/max invoice dates. §5.2.

  file_format        text NOT NULL CHECK (file_format IN ('json','xlsx')),
  file_name          text,                   -- display only, for "uploaded gstr2b_aug.xlsx"
  gstin_in_file      text,                   -- the recipient GSTIN the portal stamped
  gstin_matched      boolean,                -- NULL when the file carried none (Excel)
  gen_date           date,                   -- the 2B's generation date, JSON only

  -- Provenance
  uploaded_by        uuid REFERENCES auth.users(id),
  uploaded_at        timestamptz NOT NULL DEFAULT now(),
  superseded_by      uuid REFERENCES p2_gstr2b_uploads(id),  -- §5.3

  -- Parse summary, so the filing package can report without re-counting
  row_count          int NOT NULL DEFAULT 0,
  counts             jsonb NOT NULL DEFAULT '{}'::jsonb,  -- {b2b: 41, cdnr: 2, b2ba: 0}
  parse_warnings     jsonb NOT NULL DEFAULT '[]'::jsonb,

  created_at         timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE p2_gstr2b_rows (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  upload_id          uuid NOT NULL REFERENCES p2_gstr2b_uploads(id) ON DELETE CASCADE,
  tenant_id          uuid NOT NULL,          -- denormalised: RLS reads it directly

  doc_section        text NOT NULL CHECK (doc_section IN ('b2b','cdnr','b2ba')),
  doc_type           text,                   -- cdnr: 'C' | 'D'. NULL elsewhere.

  -- Counterparty
  ctin               text NOT NULL,          -- supplier GSTIN
  supplier_name      text,

  -- Document
  doc_number         text NOT NULL,          -- as printed
  doc_number_norm    text NOT NULL,          -- normaliseInvoiceNo(doc_number). §4.1.
  doc_date           date,

  -- Value
  taxable_value      numeric(14,2) NOT NULL DEFAULT 0,
  igst               numeric(14,2) NOT NULL DEFAULT 0,
  cgst               numeric(14,2) NOT NULL DEFAULT 0,
  sgst               numeric(14,2) NOT NULL DEFAULT 0,
  cess               numeric(14,2) NOT NULL DEFAULT 0,

  -- Portal flags
  itcavl             text,                   -- 'Y' | 'N'
  cfs                text,                   -- 'Y' | 'N' — supplier's GSTR-1 filing status
  ims_status         text,                   -- 'A' | 'R' | 'P' | 'NO_ACTION'

  created_at         timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE p2_gstr2b_uploads ENABLE ROW LEVEL SECURITY;
ALTER TABLE p2_gstr2b_rows    ENABLE ROW LEVEL SECURITY;

-- Three command-scoped policies per table, get_my_tenant_id(), NO DELETE.
-- Modelled on p2_notifications, which codebase-audit.md calls the reference
-- implementation. NEVER auth.uid() — that pattern silently blocks non-owner staff.
CREATE POLICY p2_gstr2b_uploads_select ON p2_gstr2b_uploads
  FOR SELECT USING (tenant_id = get_my_tenant_id());
CREATE POLICY p2_gstr2b_uploads_insert ON p2_gstr2b_uploads
  FOR INSERT WITH CHECK (tenant_id = get_my_tenant_id());
CREATE POLICY p2_gstr2b_uploads_update ON p2_gstr2b_uploads
  FOR UPDATE USING (tenant_id = get_my_tenant_id())
              WITH CHECK (tenant_id = get_my_tenant_id());
-- …the same three shapes for p2_gstr2b_rows.

CREATE INDEX p2_gstr2b_uploads_period_idx
  ON p2_gstr2b_uploads (tenant_id, period, uploaded_at DESC);
CREATE INDEX p2_gstr2b_rows_upload_idx
  ON p2_gstr2b_rows (upload_id);
-- The matcher's hot path: find a 2B row by supplier GSTIN + normalised doc number.
CREATE INDEX p2_gstr2b_rows_match_idx
  ON p2_gstr2b_rows (tenant_id, ctin, doc_number_norm);
```

**No `UNIQUE (tenant_id, period)`.** A tenant legitimately re-uploads — the portal regenerates the
2B, or the first upload was the wrong month. Supersession is a pointer (§5.3), not a constraint that
forces a delete.

**No DELETE policy.** A 2B upload is evidence of what the portal said on a date. Superseding it
preserves both, which is what an assessment conversation needs.

**`tenant_id` is denormalised onto the row table deliberately.** RLS reading it directly avoids a
join on every policy evaluation, and the matcher's index needs it as a leading column anyway.
`ON DELETE CASCADE` on `upload_id` covers the service-role cleanup path.

---

## 4. The matcher must not fork `[DECIDED]`

**This is the most important decision in the session.**

`gstr2b-reconcile.html` contains a working, iterated, four-bucket matcher with eighteen months of
fixes in it: the GRN grouping, the ±₹2 tolerance on both taxable value and tax amount, the `cfs`
warning, the IMS status mapping, the s.16(4) expiry badges, and the credit-note sub-bucket
`[VERIFIED — CLAUDE.md, Shipped Aug 12, Aug 14, Aug 17 and Sept 2]`.

**If Session 25 writes a second matcher in `filing-package/index.ts`, the two will disagree**, and
the day they disagree is the day a CA compares sheet 02 against the screen and stops trusting both.
This codebase's documented recurring failure is exactly this: three invoice-button implementations,
the `READ_ONLY_INTENTS` / `READ_ONLY_TEXT_INTENTS` double-update hazard, four overlapping versions of
`confirm_bom_issue` `[VERIFIED — kpml-network-plan.md §17, codebase-audit.md §5.2]`.

**`[DECIDED]` One implementation, in `supabase/functions/_shared/gstr2b-match.ts`,** consumed by
both. The browser page loads it as a plain `<script>` — there is no module system, no bundler and no
build step in this codebase `[VERIFIED]`, so the shared file is written as a bare-global IIFE in the
same style as `js/movement-purpose.js` and `js/notifications.js`, and the Deno function imports it.

**If that proves impractical**, the fallback is `bridge-agent.md` §5.8's discipline, which exists for
the identical problem: **a regression test compares both outputs on a fixed fixture set and fails
the session if they diverge.** The test is not optional; it is the thing that keeps the promise true.

### 4.1 The four primitives that must be byte-identical

| Primitive | Current definition | Where |
|---|---|---|
| `normaliseInvoiceNo` | `str.replace(/[\s\-\/]/g, '').toUpperCase()` | `gstr2b-reconcile.html:299`, `grn.html`, `js/full-export.js:73-75`, and `bridge-agent.md` §4.2 |
| GRN grouping key | `(supplier_gstin + normaliseInvoiceNo(invoice_no))` | `gstr2b-reconcile.html` |
| Amount tolerance | **±₹2** on taxable value **and** on tax amount | Sept 2 |
| GRN taxable value | `quantity × rate` — no amount column exists on `p2_stock_transactions` | Aug 12 |

**One subtlety that is easy to get wrong.** The tax comparison is **skipped entirely when the
tenant's own GST rate for that material is unknown**, so a missing `gst_rate` never reports a false
mismatch `[VERIFIED — Sept 2]`. Preserve that. Datta Prasad has 15 GRN lines at 0% against identical
18% goods; a naive server-side matcher would report fifteen mismatches that the browser correctly
stays quiet about.

### 4.2 The four buckets, unchanged

| Bucket | Meaning |
|---|---|
| ✅ **Matched** | GSTIN + normalised doc number found, taxable diff ≤ ₹2 **and** tax diff ≤ ₹2 |
| ⚠️ **Amount Mismatch** | Found, but taxable and/or tax diff > ₹2 |
| ❌ **Not in 2B — Supplier Default** | In the Nexflow GRN, absent from the 2B. Carries the s.16(4) expiry badge. |
| ❓ **Unrecorded** | In the 2B, no GRN in Nexflow. Has a credit-note sub-bucket (`cdnr`) and an "Amended" tag (`b2ba`). |

Note the naming history: the third bucket was renamed from *"ITC Blocked"* on 2 September — it
conflated supplier default with s.17(5) blocked credit — but the **internal `buckets.blocked` key is
unchanged** `[VERIFIED]`. The shared module keeps the internal key and the display string exactly as
they are.

---

## 5. Ingestion

### 5.1 Where parsing happens `[DECIDED]`

**Parsing stays in the browser. Only the parsed rows are sent.**

This preserves §2's line for free — the file never leaves the machine — and it reuses
`parseGSTR2BExcel()` and the JSON path exactly as they are, including SheetJS, which is already
loaded on that page `[VERIFIED — xlsx@0.18.5, added Aug 17]`.

New flow on `gstr2b-reconcile.html`, after a successful parse:

```
parse (unchanged)
  → run the reconciliation and render (unchanged)
  → NEW: "Save this 2B to Nexflow" — one button, explicit, never automatic
       POST { period, period_source, file_format, gstin_in_file, gen_date, rows[] }
       → gstr2b-store Edge Function (verify_jwt = true; the caller is a logged-in owner)
       → inserts p2_gstr2b_uploads + p2_gstr2b_rows in one transaction
```

**The save is explicit, not automatic.** `[DECIDED]` An owner who uploads a colleague's 2B by
mistake, or the wrong month, should not have it silently persisted. One button, one confirmation
line: *"Saved. Your CA's filing package for August will now include the reconciliation."*

### 5.2 Period, and the Excel problem

The JSON declares its own return period. **Excel does not.** The existing Excel path derives one
from the min/max invoice dates and the page deliberately displays *"Period: detected from file"* —
it never claims a specific month `[VERIFIED — Aug 17]`.

`[DECIDED]` Carry that honesty into the database: `period_source` is `'file'` or `'derived'`. The
filing package's sheet 02 header prints *"Period as declared by the portal"* or *"Period inferred
from invoice dates in the uploaded file"* accordingly. A derived period that spans two months is a
`parse_warnings` entry, and the package says so rather than silently picking one.

**Datta Prasad's 2B is Excel format** `[VERIFIED — CLAUDE.md, Aug 17]`, so the derived path is the
one that runs on a real client first, not the JSON path.

### 5.3 Re-upload

`[DECIDED]` A new upload for a period **supersedes** the previous one: the new row is inserted, and
the old row's `superseded_by` is set to the new row's id. Nothing is deleted.

Every consumer reads *"the latest non-superseded upload for this period"*:

```sql
SELECT * FROM p2_gstr2b_uploads
 WHERE tenant_id = :t AND period = :p AND superseded_by IS NULL
 ORDER BY uploaded_at DESC LIMIT 1
```

**Why not delete.** The portal regenerates a 2B when a supplier files late, and the difference
between the 5th's version and the 14th's is sometimes the whole conversation at assessment. Keeping
both costs a few hundred rows.

### 5.4 Excel-path limitations that must travel with the data

The Excel path cannot know two things, and the page already tells the user so via
`#excelFormatNote` `[VERIFIED]`:

- **`cfs` is always `'Y'`** — the portal only exports filed invoices, so the amber *"Not Filed"*
  badge can never appear for an Excel-sourced result.
- **`ims_status` is always `'NO_ACTION'`.**

These are stored as-is. **Sheet 02 must repeat the caveat**, because a CA reading *"IMS: Auto-accepted"*
on every row of an Excel-derived sheet would otherwise conclude the tenant ignored their IMS
dashboard entirely. One italic line under the table.

---

## 6. Sheet 02 of the filing package

### 6.1 Inclusion rule

```
IF a non-superseded p2_gstr2b_uploads row exists for the package's period
   → include 02-GSTR2B-Reconciliation.xlsx
   → the covering note's file list names it
ELSE
   → omit the sheet entirely
   → the covering note says so explicitly, in one sentence
```

**Omission is honest, not silent.** This is `enterprise-strategy.md` §3.2's Phase 1 behaviour and it
survives: *"the package omits sheet 02. `00-READ-THIS-FIRST` says so explicitly and tells the owner
to run the reconciliation screen and add the file."*

**The file list is built from what was actually added to the zip, never from a static template**
`[VERIFIED — Session 15]`. That property already exists and is what stops an omitted sheet appearing
as a false promise; do not regress it.

### 6.2 Workbook shape

Four sheets, mirroring the existing `downloadReport()` on `gstr2b-reconcile.html` so the CA sees the
same artefact whether the owner produced it or the cron did:

| Sheet | Contents |
|---|---|
| `Matched` | Supplier, GSTIN, invoice no, date, 2B taxable, our taxable, 2B tax, our tax, ITC available, **CFS Warning** column |
| `Amount Mismatch` | The same, plus **`Taxable Diff (₹)`** and **`Tax Diff (₹)`** |
| `Not in 2B` | Our GRN rows absent from the 2B, plus the **s.16(4) expiry** flag column |
| `Unrecorded` | 2B rows absent from our GRNs, with the `docType` tag (`Credit Note` / `Amended`) |

Plus a summary block and the disclaimer rows at the bottom, following
`downloadTable12Excel()`'s established shape — ExcelJS, orange header via `styleHeaderRow()`, real
numeric cells, never strings.

**Colour convention:** `FFD4F7DC` green, `FFFFF0B3` amber, `FFFFC9C9` red — the ARGB set already
used by the ITC-04 workbook and the HSN audit `[VERIFIED]`.

### 6.3 The covering note gets one more input

`fetchCoveringNoteData()` currently carries eight canonical count fields `[VERIFIED — Session 16]`.
Session 25 adds a ninth: `gstr2bUnmatchedCount`.

**Why it matters more than the other eight.** Under IMS, ITC in GSTR-3B is hard-locked to what flows
through into GSTR-2B, and **deemed acceptance** means an invoice nobody acts on is automatically
accepted `[VERIFIED — kpml-network-critique.md research finding 8]`. An Opus covering note that can
say *"14 invoices worth ₹3,20,000 are in your 2B with no matching GRN — these will be auto-accepted
into your ITC"* is naming a deadline, not summarising a report.

Keep it a **count plus the top 5 rows**, per the bounded-input rule. The model never receives the row
set.

---

## 7. Build sequence

**One session.** No new cron. One new Edge Function. No model calls beyond the existing covering
note.

| # | Step | Output |
|---|---|---|
| 1 | Migration `20261215_gstr2b_uploads.sql` | §3. Two tables, RLS enabled **in the same file**, 4 indexes. Test tenant first; regression snapshot diffed against the most recent prior snapshot, **not** `baseline-pre-2H.json`. |
| 2 | **Extract the matcher** to `_shared/gstr2b-match.ts` | §4. `gstr2b-reconcile.html` switches to it and **its output must be unchanged** — verify against a saved run before and after. This is the step that carries all the risk. |
| 3 | `gstr2b-store` Edge Function | `verify_jwt = true`, `verifyCallerTenant`, one transaction for upload + rows |
| 4 | `gstr2b-reconcile.html` — "Save this 2B to Nexflow" | §5.1. Explicit button. Shows the last saved period for the tenant. |
| 5 | `filing-package/index.ts` — sheet 02 | §6.1, §6.2. Reads the latest non-superseded upload for the period. |
| 6 | Covering-note ninth field | §6.3 |
| 7 | Verify on Datta Prasad's real Excel 2B | The derived-period path, on a real client's real file, is the one that runs first |

**Step 2 is the acceptance gate.** If the extracted matcher produces one different bucket assignment
on a saved fixture, stop and find out why before going further. Everything after it assumes the
matcher is the same matcher.

**Acceptance test.** Take Datta Prasad's August Excel 2B. Run it through the page, save it, then
generate the filing package for August manually via settings.html's "Generate Now". Sheet 02's four
bucket counts must equal what the screen showed, to the row, and the taxable totals must match to
the rupee.

---

## 8. Failure modes and edge cases

| Case | Behaviour |
|---|---|
| No 2B saved for the period | Sheet 02 omitted; the covering note says so in one sentence. §6.1. |
| Two uploads for one period | The later supersedes; consumers read `superseded_by IS NULL`. Both rows kept. §5.3. |
| Excel upload with a period spanning two months | Stored with `period_source='derived'` and a `parse_warnings` entry. The package prints the caveat rather than picking a month. §5.2. |
| GSTIN in the file ≠ the tenant's GSTIN | `gstin_matched = false`. Non-blocking on the page today `[VERIFIED]`; **the package must show it as a prominent warning**, because the cron has no human to notice. |
| `cdnr` / `b2ba` field names wrong | `CLAUDE.md` records these as **unverified against a real sample file** `[VERIFIED — Sept 2]`. If a section parses to zero rows on a file that visibly contains credit notes, record it in `parse_warnings` rather than reporting a clean reconciliation. §10 Q2. |
| A GRN is entered after the 2B was saved | The stored rows are a snapshot of the portal; the GRN side is read live at package time. A late GRN correctly moves a row from Unrecorded to Matched on the next run. **This is the right asymmetry** — the 2B is a dated external fact, the GRN is ours. |
| Duplicate supplier invoice in the GRNs | The grouping **sums** them and reports an Amount Mismatch rather than a duplicate — *"the operator most likely concludes the supplier filed wrong"* `[VERIFIED — CLAUDE.md Known Open Items #1]`. Inherited, not introduced. Flag any group whose row count exceeds its distinct `raw_material_id` count. |
| Principal-owned GRN rows | **Must be excluded from the GRN side.** Free-issue material has no supplier invoice and no ITC; including it creates permanent phantom entries in the Not-in-2B bucket and *"would quietly destroy the credibility of the feature that currently justifies Pro pricing"* `[VERIFIED — kpml-network-critique.md Q1]`. Verify the current page already filters `owned_by IS NULL`; if it does not, that is a live bug and this session is where it gets fixed. **§10 Q1.** |
| Upload of a 2B for a filed period | Allowed. The reconciliation is historical evidence, not a write into a return. |

---

## 9. Out of scope `[NEVER]`

1. **Storing the raw portal file.** §2.
2. **Fetching the 2B from the GST portal.** That needs portal credentials, which
   `enterprise-strategy.md` §8 item 5 makes a permanent `[NEVER]`: *"there is no plan, price or
   client for which this becomes yes."*
3. **Performing IMS actions** — accept, reject, keep pending. Nexflow surfaces the deadline; the CA
   or the owner acts on the portal. The GST Scope lock covers this.
4. **A second matcher.** §4.
5. **Reconciling anything other than purchases.** No GSTR-1 cross-check, no 3B, no annual return.
6. **Retention deletion.** §2.

---

## 10. Open questions

**Q1. Does `gstr2b-reconcile.html` filter `owned_by IS NULL` on the GRN side?** `[UNVERIFIED]`
`CLAUDE.md` documents the GRN query as reading `p2_stock_transactions` for the period and grouping
by supplier + invoice, and does not mention an ownership filter. `kpml-network-critique.md` Q1 names
this as *"the sharp one"* — free-issue material has no supplier invoice and no ITC, so it would sit
in the Not-in-2B bucket forever.
**Resolve:** read the query before step 2. If the filter is absent, it is a live bug on three
job-worker tenants and fixing it belongs in this session.
**Decide before:** step 2.

**Q2. Are the `cdnr` and `b2ba` field names right?** `[UNVERIFIED]`
`CLAUDE.md` is explicit: *"cdnr/b2ba field names are unverified against a real sample file — treat as
best-effort until tested against a live export containing actual credit notes/amendments."*
**Resolve:** get one real 2B JSON containing a credit note. Until then, a section parsing to zero
rows is a `parse_warnings` entry, not a clean result.
**Decide before:** sheet 02 is shown to a CA.

**Q3. Should saving be automatic rather than a button?** `[RECOMMENDED: button]` — §5.1.
Automatic saving of a file the owner may have picked by mistake, into a table a CA later reads, is
the wrong default.
**Decide before:** step 4.

**Q4. Should the owner be reminded to upload before the 5th?** `[RECOMMENDED: yes, reuse jobid 3]`
The 2B is available on the 14th; the package runs on the 5th. So the package on the 5th of October
can only include a 2B for a period the owner uploaded **in the previous month**. There is already a
monthly Telegram nudge on the 15th (cron jobid 3, `gstr2b_nudge`) `[VERIFIED]`. Extend its message
to say the upload also feeds the CA's package — one string change, no new cron.
**Decide before:** step 5, because it changes what a CA can expect to receive on the 5th.

**Q5. What does sheet 02 show when the 2B is one month behind?**
Given Q4's timing, the common steady state is that the package for September contains the August
reconciliation. `[RECOMMENDED]` include it, and title the sheet with its own period explicitly —
*"GSTR-2B Reconciliation — August 2026"* inside the September package — rather than letting a CA
assume it is current.
**Decide before:** step 5.

---

*Last updated: 11 September 2026. Design complete; no code written.*
*Move `[RECOMMENDED]` to `[DECIDED]` as decisions are taken, and replace §10's `[UNVERIFIED]` items
with what the live page and a real sample file actually show.*
