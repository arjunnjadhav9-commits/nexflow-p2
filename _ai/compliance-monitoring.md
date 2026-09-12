---
name: compliance-monitoring
description: Nexflow A2 — automated GST compliance monitoring. CBIC/GSTN feed ingestion, the statutory constants inventory, Haiku summarisation with an Opus gate on CRITICAL, GitHub issue creation, and the CA-confirmation register for every [INFERRED] rule already hardcoded in the product. Read in full before building A2.
sources: [automation-strategy.md §4.2, compliance-and-field-report.md, kpml-network-plan.md §10, CLAUDE.md, md-audit-report.md]
last_updated: 11 September 2026
status: design complete — not yet built. Living document: update in place as it is built.
---

# Nexflow — Compliance Monitoring (A2)

**Load order for an A2 session. Read in this order, in full:**

1. `_ai/CLAUDE.md`
2. `_ai/compliance-monitoring.md` (this file)
3. `_ai/automation-strategy.md` §3.1 (A0 — `opsAlert`, which A2 depends on) and §4.2
4. `_ai/compliance-and-field-report.md` — the source of §7's confirmation register

**Status: designed, not built.** Nothing here exists in the codebase. A0 must ship first — every
founder-facing line in this document routes through `opsAlert()`.

**Why this file exists rather than building from `automation-strategy.md` §4.2.** §4.2 is
architecturally right and is inherited wholesale below. Three things it does not carry, each of
which would otherwise be re-derived or got wrong: the feed is unspecified (no URL, no format, no
auth), its sample constants inventory contains two entries the codebase contradicts, and the
`[INFERRED]`-rule confirmation register — the thing that decides whether A2's alarms mean anything —
does not exist anywhere. §7 is that register.

---

## Tag convention

Inherited from `enterprise-strategy.md`, unchanged.

| Tag | Meaning |
|---|---|
| `[DECIDED]` | Decided. Build it as written. |
| `[RECOMMENDED]` | This document's recommendation. Needs founder sign-off. |
| `[VERIFIED]` | Checked against the live codebase or a primary source, 11 Sept 2026. |
| `[UNVERIFIED]` | Needs a live check before code is written. Listed again in §9. |
| `[DECIDE BEFORE BUILDING]` | A human decision A2 cannot make. Listed again in §9. |
| `[NEVER]` | Permanently out of scope. |

---

## 0. Corrections to `automation-strategy.md` §4.2 — read first

### `[CORRECTION]` X1 — the sample inventory's `s143_periods` entry is wrong

§4.2's sample says:

```json
{ "area": "s143_periods", "const": "inputs 365d / capital goods 3y",
  "locations": ["js/s143-clock.js", "supabase/functions/filing-package/index.ts"],
  "current": [365, 1095], "authority": "CGST s.143(1)" }
```

`CLAUDE.md` Session 8 records the actual state: *"Known simplification: all GRN receipts treated as
365-day inputs — **no capital goods 3-year band, no tooling exemption on the GRN side** (those flags
exist on dispatch-side only)."* `[VERIFIED]`

**The 1095 is not in `js/s143-clock.js`.** It exists only in the `set_s143_clock()` trigger
(`20260825_s143_clock_population.sql`), which runs on the *opposite* direction — this tenant acting
as principal issuing material out. The correct entry names both locations and both values
separately, and records that the read-side clock has no capital-goods band at all. §3.2 has it.

### `[CORRECTION]` X2 — `gst_state_codes` is counted three ways across the document set

`automation-strategy.md` §4.2 says *"38 states + 97"*. `CLAUDE.md` line 1531 says export.html's map
is *"full **37**-state map + 38 (Ladakh) + 97 (Other Territory)"*. `enterprise-strategy.md` §3.2 says
*"the exact string from the **38**-value list"*. The inventory entry must record the **count of map
entries**, not a description, and the first task of the session is to `grep` the real length.
`[UNVERIFIED — count the entries in export.html's GST_STATE_CODES]`

### `[CORRECTION]` X3 — the RBI bank rate is a statutory constant and is missing entirely

`export.html`'s 43B(h) card computes interest at *"3× RBI bank rate (6.5%)"* `[VERIFIED — CLAUDE.md,
Shipped Aug 28]`. That 6.5% is a rate the RBI changes, embedded in a compliance figure, and it does
not appear in §4.2's sample inventory. It is one of the highest-churn constants in the product.
§3.2 adds it.

---

## 1. What A2 is, and what it is not

**What it is.** One Edge Function, on a weekly cron, that reads the CBIC notification feed and the
GSTN updates page, decides whether anything published since the last run touches a value Nexflow has
hardcoded, and — when it does — opens a GitHub issue naming the constant, its current value, its
`file:line` locations and the authority it was set from.

**What it is not.** `[NEVER]` A2 does not edit code, open a pull request, change a constant, or file
anything. It produces an issue and a citation. **The fix is founder judgment.**
`automation-strategy.md` §9 is explicit and this document does not soften it: *"A2 says the law
changed and points at `export.html:1377`. Deciding what it means for Nexflow's schema, whether it
affects one surface or four, and what the migration looks like is founder work."*

**Why it is worth 1.5 sessions at three clients.** The B2CL threshold was ₹2,50,000 in
`export.html` against a statutory ₹1,00,000 from 1 November 2024, and it stayed wrong for
**twenty-two months** `[VERIFIED — CLAUDE.md Known Open Items #3]`. It was caught by a CA
conversation on 9 September 2026, not by any process, at a client count of three, with an attentive
founder reading this material. The cost is ~₹92/month, flat at every client count, forever.

**The asymmetry that makes it a moat rather than insurance.** One fix reaches every client
simultaneously. A competitor with ten employees fixes compliance once and then spends the month
propagating it. That is only an advantage if the change is noticed — A2 is what converts a
structural property into a real one.

---

## 2. Architecture

```
  cron 'compliance-scan-weekly'   Mon 03:00 UTC / 08:30 IST
        │
        ▼
  compliance-scan   (new Edge Function, verify_jwt = false, SB_SECRET_KEY)
        │
        ├─ 1. FETCH      CBIC notifications + GSTN updates
        │                bounded: published_at > last_seen_at, hard cap 40 items
        │
        ├─ 2. DEDUPE     code: drop any doc_id already in p2_compliance_watch
        │
        ├─ 3. SUMMARISE  Haiku 4.5, one call per item
        │                → { what_changed, affects[], area, effective_date }
        │
        ├─ 4. LOCATE     code: match `area` against _ai/compliance-constants.json
        │                → file:line references + current value + authority
        │                NEVER the model's job (R1)
        │
        ├─ 5. CLASSIFY   Haiku proposes CRITICAL | IMPORTANT | MONITOR
        │                Opus 5 confirms any proposed CRITICAL before it alarms
        │
        └─ 6. EMIT       CRITICAL  → opsAlert(critical) + GitHub issue, immediately
                         IMPORTANT → GitHub issue + folded into the weekly digest
                         MONITOR   → p2_compliance_watch row only
```

**Rule R1 applies throughout** (`automation-strategy.md` §2): *deterministic code computes, the
model judges*. The model says *"this notification concerns HSN digit requirements"*; **code** greps
the inventory for `area = 'hsn_digits'` and produces the file references. The model never sees the
codebase and never produces a line number.

**Rule R1a applies to the classification:** the Opus gate may only **lower** a Haiku-proposed
CRITICAL to IMPORTANT. It may never raise an IMPORTANT to CRITICAL. A model may reduce urgency; only
deterministic matching against a `severity` field on the inventory row may create it. See §4.

---

## 3. The constants inventory

### 3.1 Why this is a deliverable in its own right

`_ai/compliance-constants.json` is the first written record of where Nexflow hardcodes the law.
Building it will surface constants duplicated between `export.html` and
`supabase/functions/filing-package/index.ts` that can silently diverge — which is a finding worth the
session independently of the automation.

**Standing rule, to be added to `CLAUDE.md` "Rules for this session" when A2 ships:**

> **A session that hardcodes a statutory value adds a row to `_ai/compliance-constants.json` in the
> same commit.**

Same enforcement shape as `tutorial-engine.md` §10.1's same-commit rule, and enforceable for the
same reason: the dependency is visible at the point of the edit.

### 3.2 The file

`_ai/compliance-constants.json`. One object per statutory constant. Corrected against the codebase;
the two `automation-strategy.md` §4.2 errors are fixed and two constants it omits are added.

```json
[
  {
    "area": "b2cl_threshold",
    "const": "B2CL_THRESHOLD",
    "locations": ["export.html", "supabase/functions/filing-package/index.ts"],
    "current": 100000,
    "authority": "Notification 12/2024-Central Tax, effective 2024-11-01",
    "confirmed_by_ca": "2026-09-09",
    "severity": "critical",
    "note": "Was 250000 for 22 months. The reason A2 exists."
  },
  {
    "area": "challan_number_length",
    "const": "chk_challan_number_length",
    "locations": [
      "p2_dispatch_orders CHECK constraint (SQL Editor, no migration file)",
      "export.html challanSeriesKey()"
    ],
    "current": 16,
    "authority": "CGST Rule 46(b) / Rule 55(1)",
    "confirmed_by_ca": "2026-09-09",
    "severity": "critical"
  },
  {
    "area": "s143_input_period_readside",
    "const": "365-day input clock",
    "locations": ["js/s143-clock.js"],
    "current": 365,
    "authority": "CGST s.143(1)(a)",
    "confirmed_by_ca": null,
    "severity": "critical",
    "note": "READ-SIDE ONLY. No capital-goods band and no tooling exemption exist here — all GRN receipts are treated as 365-day inputs (CLAUDE.md, Session 8). See §7 item 4."
  },
  {
    "area": "s143_periods_writeside",
    "const": "+1yr inputs / +3yr capital goods",
    "locations": ["set_s143_clock() — 20260825_s143_clock_population.sql"],
    "current": [365, 1095],
    "authority": "CGST s.143(1)(a)",
    "confirmed_by_ca": null,
    "severity": "critical",
    "note": "Trigger fires only when THIS tenant is the principal issuing out. is_exempt_tooling nulls the deadline but has no UI — see §7 item 5."
  },
  {
    "area": "msme_payment_days",
    "const": "43B(h) 45-day threshold",
    "locations": [
      "export.html 43B(h) card",
      "supabase/migrations/20260901_payment_status_invoice_date.sql (v_p2_invoice_payment_status)"
    ],
    "current": 45,
    "authority": "MSMED s.15 / IT s.43B(h)",
    "confirmed_by_ca": null,
    "severity": "critical",
    "note": "Applied universally. Statute is 45 days WITH a written agreement, 15 WITHOUT. Nexflow has no agreement record. See §7 item 1."
  },
  {
    "area": "msme_interest_rate",
    "const": "3x RBI bank rate, simple",
    "locations": ["export.html 43B(h) card"],
    "current": { "rbi_bank_rate": 6.5, "multiplier": 3, "compounding": "none" },
    "authority": "MSMED s.16",
    "confirmed_by_ca": null,
    "severity": "important",
    "note": "s.16 compounds with MONTHLY RESTS. Nexflow computes simple interest. The RBI bank rate itself changes. See §7 items 2 and 3."
  },
  {
    "area": "uqc_codes",
    "const": "GSTN UQC list",
    "locations": ["settings.html", "products.html", "supabase/functions/filing-package/index.ts"],
    "current": ["NOS", "KGS", "MTR", "LTR", "PCS", "SQM", "CBM", "OTH"],
    "authority": "GSTN UQC master",
    "confirmed_by_ca": null,
    "severity": "important",
    "note": "GSTR-1 workbook needs the full CODE-NAME string (NOS-NUMBERS etc). Mapping lives in filing-package."
  },
  {
    "area": "gst_state_codes",
    "const": "GST_STATE_CODES",
    "locations": ["export.html", "supabase/functions/filing-package/index.ts"],
    "current": null,
    "authority": "GSTN state code master",
    "confirmed_by_ca": null,
    "severity": "important",
    "note": "UNVERIFIED — count the actual map entries. CLAUDE.md says 37 states + 38 + 97; enterprise-strategy says a 38-value list. Fix `current` in the first session."
  },
  {
    "area": "gst_rate_flat",
    "const": "flat 18% invoice split",
    "locations": ["supabase/functions/agent-query/index.ts buildInvoiceTotals"],
    "current": 18,
    "authority": "GST Scope lock — deliberate simplification",
    "confirmed_by_ca": null,
    "severity": "monitor",
    "note": "Correct for engineering job work (SAC 9988) since 22 Sep 2025. WILL BREAK for a textile (5%) or diamond (1.5%) job worker. Deliberate; see kpml-network-plan.md §10.3. A2 must NOT alarm on a rate change that does not affect current clients."
  },
  {
    "area": "eway_bill_thresholds",
    "const": "intra-state MH / inter-state job work",
    "locations": ["NOT IMPLEMENTED — no e-way bill surface exists"],
    "current": { "intra_state_mh": 100000, "inter_state_jobwork": 0 },
    "authority": "MH Notification 15E/2018-State Tax; second proviso to CGST Rule 138(1)",
    "confirmed_by_ca": null,
    "severity": "monitor",
    "note": "Tracked ahead of the feature so the constant is right when it is built. compliance-and-field-report.md §6.3."
  },
  {
    "area": "itc04_frequency_threshold",
    "const": "half-yearly above / annual up to",
    "locations": ["itc04-workingpaper.html period selector"],
    "current": 50000000,
    "authority": "Notification 35/2021-Central Tax, effective 2021-10-01",
    "confirmed_by_ca": null,
    "severity": "important",
    "note": "Driven by the TENANT's aato_bracket. For a vendor generating KPML's paper the relevant turnover is KPML's. See §7 item 6."
  },
  {
    "area": "einvoice_threshold",
    "const": "AATO banner brackets",
    "locations": ["settings.html aato_bracket", "all-dispatch-history.html invoice modal banner"],
    "current": ["below_5cr", "5cr_to_10cr", "above_10cr"],
    "authority": "e-invoicing mandate, currently 5cr",
    "confirmed_by_ca": null,
    "severity": "critical",
    "note": "kpml-network-critique.md research finding 9 records that sources CONFLICT on whether the threshold dropped to 2cr from 1 Oct 2025. Unresolved. If a client crosses it, an invoice without an IRN is not a valid tax invoice. Highest-value open question in this inventory."
  }
]
```

### 3.3 How `area` is matched

Haiku returns an `area` string constrained to the enum of `area` values present in the inventory
file, supplied in the system prompt. It may also return `"none"`. **It may not invent an area.** A
returned value not in the enum is coerced to `"none"` and the item is classified MONITOR — the
model's failure mode is "no match", never "wrong match".

Matching is then a plain lookup, in code. Zero matches → MONITOR. One or more → the issue body
carries every location, the current value, the authority, and the `confirmed_by_ca` date or `null`.

---

## 4. Model choice and the Opus gate

| Job | Model | Why |
|---|---|---|
| Summarise one notification in plain English | **Haiku 4.5** | Bounded summarisation of one document. Exactly what Haiku is for. |
| Propose a classification | **Haiku 4.5** | First-pass triage against the affected-area list |
| **Confirm a proposed CRITICAL** | **Opus 5** | ~2 calls/week |
| Locate affected code | **Neither** | `grep` over the inventory. R1. |

**Why the Opus gate.** A CRITICAL alarm says *fix within 48 hours* and creates real urgency. A false
one, weekly, trains the founder to ignore the channel — which is how alerting systems die. The cost
is asymmetric: a missed CRITICAL costs a wrong filing; a false CRITICAL costs the channel's
credibility. ₹14/week buys down the second.

**What Opus sees:** the notification text, the matched inventory row (current value, authority,
`confirmed_by_ca`), and nothing else. It does not see the codebase. It answers one question:
*does this notification change the value of this constant, or not?*

**R1a is enforced structurally:** Opus's response is parsed into `{ confirmed: boolean, reason:
string }`. `confirmed: false` **demotes** to IMPORTANT. There is no code path by which a model
raises severity. An inventory row's own `severity` field is the ceiling — a `monitor`-severity area
can never produce a CRITICAL regardless of what either model says. This is what stops a rate-change
notification for textile job work (where Nexflow's flat 18% is a documented deliberate
simplification) from waking the founder at 3 a.m.

---

## 5. The feed `[UNVERIFIED — resolve in step 2]`

This is the part `automation-strategy.md` §4.2 leaves open, and it is the only genuinely unknown
piece of A2.

**Candidates, in preference order:**

1. **CBIC's own notification listing** — `https://www.cbic.gov.in/entities/cbic-content-mst/...`
   GST notifications are published as dated PDF links on a paginated HTML page. No API, no RSS
   advertised. Scrape the listing, not the PDFs: **title + notification number + date + URL is
   enough** for Haiku to classify, and the PDF is linked in the issue for the founder to read.
2. **GSTN updates page** — `https://www.gst.gov.in/newsandupdates` — carries portal and utility
   changes (offline tool versions, IMS behaviour, workbook template revisions) that CBIC does not.
   This is where the GSTR-1 V2.0 template change would appear.
3. **A commercial GST-update API.** Not recommended: adds a vendor, a key and a bill for something
   two scrapes cover.

**Resolution procedure, step 2 of the build:**

- Fetch each candidate URL once by hand. Record the actual HTML shape, whether the listing is
  server-rendered or JS-hydrated, and whether an RSS/Atom endpoint exists that is not advertised.
- If a page is JS-hydrated, it cannot be scraped from a Deno Edge Function without a headless
  browser — **do not add one**. Fall back to the printable or paginated variant, or drop that source
  and record why.
- Write the working selector and the exact URL into this section.

**Hard bounds regardless of source:**

- `published_at > last_seen_at`, hard cap **40 items** per run. An unbounded first run against a
  five-year archive would cost more than a year of scans.
- First run seeds `last_seen_at = now() - 30 days`, not the epoch.
- `[NEVER]` A2 does not fetch or parse the PDFs. Title, number, date and URL only.

---

## 6. Schema

One table. Service-role only, no `tenant_id` — this is founder infrastructure, not client data, and
the same RLS shape A0's `p2_ops_alerts` uses.

```sql
-- A2 — compliance notifications seen and what was decided about them.
-- Deliberately has NO tenant_id: statutory change is global, not per-tenant.
CREATE TABLE p2_compliance_watch (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source          text NOT NULL CHECK (source IN ('cbic','gstn')),
  doc_id          text NOT NULL,        -- notification number, or a stable hash of the URL
  title           text NOT NULL,
  url             text NOT NULL,
  published_at    date,
  effective_date  date,                 -- often later than published_at, and it is what matters

  -- Model output
  summary         text,                 -- Haiku, plain English, <= 60 words
  area            text,                 -- matched inventory area, or 'none'
  classification  text NOT NULL DEFAULT 'monitor'
                    CHECK (classification IN ('critical','important','monitor')),
  haiku_proposed  text,                 -- what Haiku said before the Opus gate
  opus_confirmed  boolean,              -- NULL when no CRITICAL was proposed
  opus_reason     text,

  -- Outcome
  issue_url       text,
  status          text NOT NULL DEFAULT 'new'
                    CHECK (status IN ('new','issue_opened','actioned','dismissed')),
  dismissed_reason text,

  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),

  UNIQUE (source, doc_id)
);

ALTER TABLE p2_compliance_watch ENABLE ROW LEVEL SECURITY;
-- No policy. Service role bypasses RLS; nothing else may read it.
REVOKE ALL ON p2_compliance_watch FROM anon, authenticated;

CREATE INDEX p2_compliance_watch_recent_idx
  ON p2_compliance_watch (published_at DESC);
CREATE INDEX p2_compliance_watch_open_idx
  ON p2_compliance_watch (classification, status)
  WHERE status IN ('new','issue_opened');
```

`UNIQUE (source, doc_id)` is the dedupe guard: a re-scan that re-reads the same listing cannot
double-issue.

**`effective_date` is a separate column and it is the one that matters.** Notification 12/2024 was
published in 2024 and effective 1 November 2024; the B2CL miss was a miss against the effective
date. An issue body leads with `effective_date`, not `published_at`.

**Migration:** `20261115_compliance_watch.sql`, applied via the Supabase SQL Editor, never
`supabase db push`. Adds one table and two indexes; touches nothing existing, so the regression
snapshot diff must be empty.

**One CHECK widening in the same file:** `p2_ops_alerts.source` must gain `'compliance'`. Per
`automation-strategy.md` §3.1 the enum already includes it — `('compliance','digest','filing',
'health','onboarding','support','billing')` — so **verify before writing the ALTER**; if it is
already there, this step is a no-op. `[VERIFIED — the enum as designed includes 'compliance']`

---

## 7. The CA confirmation register `[DECIDE BEFORE BUILDING]`

**This is the section that makes A2 worth building rather than a news feed.**

A2 alarms when a notification moves a constant away from the value in the inventory. If the value in
the inventory was never right, A2 produces a scanner that is confidently wrong in the same direction
indefinitely — which is exactly the twenty-two-month failure it exists to prevent, reintroduced at
the point of design.

Every row below is a rule **already built into the product** on an `[INFERRED]` or unconfirmed
basis. Each needs a CA answer written into the `confirmed_by_ca` field of its inventory row before
A2 goes live.

| # | Claim as built | Where | The question for the CA | Severity if wrong |
|---|---|---|---|---|
| 1 | **45-day 43B(h) threshold applied to every client** | `export.html` 43B(h) card; `v_p2_invoice_payment_status` overdue predicate | The statute is 45 days *with a written agreement*, 15 *without*. Nexflow has no agreement record and no `agreement_days` column. For a client with no written agreement, is our 45-day figure defensible as an estimate with the disclaimer we print, or does it need to default to 15? | **High** — understates exposure on every client without a written agreement |
| 2 | **Interest simple, not compounded** | `export.html` 43B(h) card | MSMED s.16 compounds with monthly rests. We compute simple interest and disclose the gap. Is the disclosed simple figure acceptable to show a client, or is an understated interest figure worse than none? | Medium |
| 3 | **RBI bank rate 6.5% hardcoded** | same | What is the current bank rate, and where should we read it from so it does not go stale? | Medium — silently stale |
| 4 | **All GRN receipts treated as 365-day inputs** | `js/s143-clock.js` (Session 8) | The read-side clock has no capital-goods 3-year band and no tooling exemption. A vendor receiving a die or a fixture from KPML sees a 365-day countdown on an item with no statutory limit. How wrong is this in practice, and does it need fixing before the November KPML demo? | **High** — this clock is rendered to a principal on `principal-dashboard.html` |
| 5 | **`is_exempt_tooling` has no UI** | Step 2K stub; Tooling Register reads it | Moulds, dies, jigs, fixtures and tools have **no** return limit under the proviso to s.143. The flag exists and nulls the deadline correctly, but nothing can set it. Confirm the exempt classes so the UI offers the right list. | **High** |
| 6 | **ITC-04 frequency driven by the tenant's own `aato_bracket`** | `itc04-workingpaper.html` | The filing obligation is the *principal's*, so the relevant turnover is KPML's, not the vendor's. Confirm, then add `aato_bracket` or `itc04_frequency` to `p2_clients` for principals. | Medium — a vendor under ₹5cr defaults to annual while KPML files half-yearly |
| 7 | **s.122(1) — ₹10,000 or tax evaded, whichever is higher** | Not in the product; in the CA-facing narrative | `compliance-and-field-report.md` §1.3(b) carries an explicit `[VERIFY]`: *"I am confident of the substance but have not re-read the clause text."* Confirm the clause number and amount. | Low in product, **high in credibility** — do not quote it until confirmed |
| 8 | **e-invoicing threshold currently ₹5 crore** | `aato_bracket` brackets; the amber banner | `kpml-network-critique.md` research finding 9 records that sources conflict on a possible reduction to ₹2 crore from 1 Oct 2025, with no notification reference found. If a client crossed it, an invoice without an IRN is not a valid tax invoice and the buyer's ITC is at risk. **This is the single most valuable question in this table.** | **Critical** |
| 9 | **Flat 18% on SAC 9988 for engineering job work** | `buildInvoiceTotals` | Confirm post the 22 Sep 2025 rationalisation. Carried forward unverified from `kpml-network-plan.md` §10.3. | Medium |

**Closed already — do not re-ask:** B2CL ₹1,00,000 (confirmed 9 Sept 2026) and `CH-YYMMDD-NNNN`
under Rule 55 (confirmed 9 Sept 2026).

**How to run it.** One hour, one CA — ideally a live client's, which doubles as the relationship the
CA channel depends on (`enterprise-strategy.md` §9 Q16 already recommends approaching all three).
Write each answer into `confirmed_by_ca` on the inventory row **and** into this table's rightmost
column. An inventory row with `confirmed_by_ca: null` and `severity: "critical"` should make the
weekly digest say so: *"3 critical constants have never been CA-confirmed."*

---

## 8. Trigger, output and failure handling

| | |
|---|---|
| **Trigger** | `cron.schedule('compliance-scan-weekly', '0 3 * * 1', …)` — Monday 08:30 IST. Anon key in the Authorization header, `verify_jwt = false`, service role inside — the pattern confirmed live for jobids 2, 3, 8 and 9 `[VERIFIED]`. |
| **CRITICAL** | Immediate `opsAlert({ source:'compliance', severity:'critical' })` **and** a GitHub issue labelled `compliance/critical` |
| **IMPORTANT** | GitHub issue labelled `compliance/important`; folded into the weekly digest |
| **MONITOR** | `p2_compliance_watch` row only. No issue, no alert. Visible when asked. |
| **Feed unreachable** | Increment a failure counter; retry next run. **Two consecutive failures → `important` alert: "Compliance feed unreachable for 2 weeks."** A scanner that silently stops is worse than no scanner (R3) — this is the specific case that rule exists for. |
| **Haiku fails** | Fall back to raw notification titles plus deterministic `area` grep hits. Shorter, never absent. |
| **Opus fails** | The proposed CRITICAL is emitted as **IMPORTANT** with `opus_confirmed = null` and a note. Degrade toward less urgency, never toward more. |
| **GitHub token invalid** | Row still written, `status='new'`, `important` alert naming the failure. Never lose the finding because the issue tracker was unreachable. |

### 8.1 The GitHub issue body

Fixed template. Every field comes from the inventory row or the feed item — nothing is model-written
except `summary`.

```markdown
**Effective:** 2024-11-01   ·   **Published:** 2024-09-10
**Source:** CBIC Notification 12/2024-Central Tax
**URL:** https://…

### What changed
{Haiku summary, <= 60 words}

### What Nexflow hardcodes
| | |
|---|---|
| Area | `b2cl_threshold` |
| Constant | `B2CL_THRESHOLD` |
| Current value | `250000` |
| Set from | Notification 12/2024-Central Tax, effective 2024-11-01 |
| CA-confirmed | **never** |

### Where
- `export.html`
- `supabase/functions/filing-package/index.ts`

### Classification
Haiku proposed: CRITICAL. Opus confirmed: yes — "{opus_reason}"

---
*Opened by compliance-scan. A2 does not change code. This issue is a citation, not a patch.*
```

---

## 9. Build sequence

**1.5 sessions.** Depends on **A0** (`opsAlert`, `p2_ops_alerts`, `FOUNDER_TELEGRAM_CHAT_ID`) and
**P4** (a GitHub repo with issues enabled and a scoped token — `issues:write` on one repository and
nothing else).

| # | Step | Output | Notes |
|---|---|---|---|
| 1 | **Build `_ai/compliance-constants.json`** | The file in §3.2, with `gst_state_codes.current` filled from a real count | Grep every location. Record any constant found duplicated between `export.html` and `filing-package/index.ts` as a finding in its own right. |
| 2 | **Resolve the feed** `[UNVERIFIED]` | The working URL and selector, written into §5 | Fetch by hand first. If a source is JS-hydrated, drop it and record why — do not add a headless browser. |
| 3 | Migration `20261115_compliance_watch.sql` | One table, two indexes, RLS enabled, no policy | Test tenant first; regression snapshot diff must be empty. |
| 4 | `compliance-scan` Edge Function — fetch, dedupe, persist | Rows in `p2_compliance_watch`, no model calls yet | Run it manually against the last 30 days and read the rows. This alone tells you whether the feed shape is right. |
| 5 | Haiku summarise + classify | `summary`, `area`, `haiku_proposed` populated | Constrain `area` to the inventory enum. Coerce anything else to `'none'`. |
| 6 | Opus CRITICAL gate | `opus_confirmed`, `opus_reason` | R1a: demote-only. |
| 7 | GitHub issue creation | `issue_url` populated | Fail soft — never lose a row because the tracker is down. |
| 8 | `opsAlert` wiring + the weekly digest section | Founder gets one message | Include the *"N critical constants never CA-confirmed"* line from §7. |
| 9 | Cron `compliance-scan-weekly` | Live | |
| 10 | **The CA conversation** (§7) | `confirmed_by_ca` filled on every critical row | Calendar time, not build time. Can run in parallel with steps 1–9. |

**Steps 1 and 2 must not be reordered after step 4.** The inventory is what makes the output useful;
a scanner shipped before it is a news feed.

---

## 10. Cost

| Component | Per run | Per month |
|---|---|---|
| Haiku summarise + classify, ~15 items/week (3k in, 500 out each) | ₹7.40 | ₹32 |
| Opus CRITICAL confirmation, ~2/week (8k in, 1.5k out) | ₹14.00 | ₹60 |
| **Total** | | **≈ ₹92/month** |

**Flat at 10 clients and flat at 1,000.** One scan serves the whole book. Per-client cost falls from
₹9.20 at ten clients to ₹0.09 at a thousand; the founder-hours cost does not rise at all.

At ₹90/USD, Haiku 4.5 `$1.00`/MTok in and `$5.00`/MTok out; Opus 5 `$5.00`/`$25.00`
`[VERIFIED — automation-strategy.md §8, 11 Sept 2026]`.

---

## 11. Founder vs automation

| Automation does | Founder does |
|---|---|
| Watches CBIC and GSTN weekly, without fail | Reads one weekly digest |
| Summarises each change in plain English | Decides what it means for Nexflow's schema |
| Locates the exact constant, file and current value | **Writes the fix** |
| Escalates a confirmed CRITICAL within a day | Overrides the classification when it disagrees |
| Opens the issue with the full citation | Asks the CA when the law is ambiguous |
| Reports which critical constants were never CA-confirmed | **Has the CA conversation** (§7) |

**~4 hrs/month → ~2 hrs/month.** The saved time is the *searching*; the remaining time is the
*judging*. The real return is not the two hours — it is the twenty-two-month miss not happening
again.

---

## 12. Out of scope `[NEVER]`

1. **Editing code, opening a PR, or changing a constant.** A2 produces an issue and a citation.
2. **Fetching or parsing notification PDFs.** Title, number, date and URL only.
3. **Filing, submitting, or touching a GST portal.** `CLAUDE.md`'s GST Scope is permanently locked.
4. **Alarming on a constant whose `severity` is `monitor`.** The inventory row's severity is a
   ceiling, not a suggestion.
5. **Any per-tenant behaviour.** Statutory change is global. `p2_compliance_watch` has no
   `tenant_id` and must not gain one.
6. **A client-facing compliance feed.** Nexflow does not tell clients the law changed; it fixes the
   software and the client sees correct numbers. Telling a client about a change we have not yet
   handled creates an obligation we cannot meet.

---

## 13. Open questions

**Q1. What is the actual CBIC feed shape?** `[UNVERIFIED]`
**Resolve:** step 2. Fetch by hand, record the selector here.
**Decide before:** step 4.

**Q2. Is the e-invoicing threshold still ₹5 crore?** `[UNVERIFIED]`
Sources conflict (`kpml-network-critique.md` research finding 9). This is §7 item 8 and it is the
highest-consequence unknown in the inventory — a client over the threshold is issuing invalid tax
invoices from Nexflow and would not know.
**Decide before:** A2 ships, and ideally before the next client onboards.

**Q3. Should A2 track constants for features that do not exist yet?**
The inventory above includes `eway_bill_thresholds` with `locations: ["NOT IMPLEMENTED"]`.
`[RECOMMENDED]` **Yes** — it costs one row, and it means the constant is already right on the day
the feature is built, which is the cheapest possible time to be right.
**Decide before:** step 1.

**Q4. Who owns a CRITICAL issue that arrives while the founder is mid-session?**
No process exists. `[RECOMMENDED]` a CRITICAL bypasses quiet hours (A0's severity vocabulary) and
otherwise waits for the current session to finish. A statutory change with a future `effective_date`
is almost never a same-day fix.
**Decide before:** A0 ships, since it is A0's quiet-hours behaviour.

---

*Last updated: 11 September 2026. Design complete; no code written.*
*Move `[RECOMMENDED]` to `[DECIDED]` as decisions are taken, fill `confirmed_by_ca` as the CA
answers §7, and replace §5's `[UNVERIFIED]` with the real feed shape the day it is found.*
