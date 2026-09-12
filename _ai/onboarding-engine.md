---
name: onboarding-engine
description: Nexflow A1 — client onboarding data ingestion. Any-format intake, deterministic validation, Opus column mapping and duplicate adjudication, confidence bands, the review page, the atomic import RPC, and KPML batch mode. Read in full before building A1.
sources: [automation-strategy.md §4.1 and §5, CLAUDE.md, codebase-audit.md, enterprise-strategy.md §3.3, md-audit-report.md]
last_updated: 11 September 2026
status: design complete — not yet built. Living document: update in place as it is built.
---

# Nexflow — Onboarding Engine (A1)

**Load order for an A1 session. Read in this order, in full:**

1. `_ai/CLAUDE.md`
2. `_ai/onboarding-engine.md` (this file)
3. `_ai/automation-strategy.md` §3.3 (the job queue A1 reuses) and §4.1
4. `onboarding.html` — the existing 7-step manual tool. **The manual path stays.** A1 is an
   additional entry point beside it, never a replacement.

**Status: designed, not built.** Nothing here exists in the codebase.

**Dependencies.** `p2_job_queue` (built in A6, §3.3 of `automation-strategy.md`) and `opsAlert()`
(A0). A1 reuses both rather than building its own. If either is absent when A1 starts, build it
first — A1's parse worker has exactly the shape A6's drain already solves.

**Why this file exists rather than building from `automation-strategy.md` §4.1.** §4.1 is
architecturally right and is inherited below almost unchanged. What it does not carry: the table
columns, the import RPC's signature and ordering, the review page's structure, and — critically —
it contains **two errors that would fail at runtime** (§0). At 3–4 sessions this is the largest
single block in the sprint; it should not start with a spec that raises a CHECK violation on the
first real client.

---

## Tag convention

Inherited from `enterprise-strategy.md`, unchanged.

| Tag | Meaning |
|---|---|
| `[DECIDED]` | Decided. Build it as written. |
| `[RECOMMENDED]` | This document's recommendation. Needs founder sign-off. |
| `[VERIFIED]` | Checked against the live codebase, 11 Sept 2026. |
| `[UNVERIFIED]` | Needs a live check before code is written. Listed again in §11. |
| `[NEVER]` | Permanently out of scope. |

---

## 0. Corrections to `automation-strategy.md` §4.1 — read first

### `[CORRECTION]` X1 — `hsn_source = 'ai_suggested'` violates the live CHECK constraint

§4.1 says: *"an AI-derived HSN is never auto-imported… and `hsn_source` is written as
`'ai_suggested'` so the filing package's exceptions section can later say how many codes no human
ever confirmed."*

The shipped constraint `[VERIFIED — CLAUDE.md, Session 14, 20260909_hsn_audit_source.sql]` is:

```sql
hsn_source text CHECK (hsn_source IN ('manual','imported','ai_verified','ai_corrected'))
```

`'ai_suggested'` is **not a permitted value.** `enterprise-strategy.md` §3.3 rule 4 specifies a
different set again (`'manual','ai_suggested','ai_accepted'` plus `hsn_suggested_at`) and is
superseded by what shipped; `hsn_suggested_at` does not exist.

**Why this is not a one-word fix.** A1's import is a single all-or-nothing transaction across ten
tables (§6). One HSN row with a rejected enum value **rolls back the entire client import** with a
constraint-violation message the review page cannot explain.

**Correct behaviour `[DECIDED]`:** A1 writes `hsn_source = 'imported'` for every material and
product it creates, regardless of where the HSN came from. Provenance of the *suggestion* lives on
the submission row (§5's `flags` jsonb), not on the master record. Rationale: `'imported'` is
exactly what the enum was built to mean — a code that arrived with the data rather than being typed
or AI-verified — and it keeps the master-data enum from growing a value only one caller writes.

If the filing package later needs "N codes came from an AI suggestion at onboarding and no human has
confirmed them since", that is a query over `p2_onboarding_submissions.flags`, not a fifth enum
value. §11 Q3.

### `[CORRECTION]` X2 — `suggest_hsn` does not return a confidence field

§4.1 says: *"Call the **existing** `suggest_hsn` handler on `agent-query`… **Confidence maps
directly onto the band**: `high` → amber (pre-filled, tick to accept), `medium`/`low` → amber with
the 'verify with your CA' label, never green."*

`enterprise-strategy.md` §3.3 designed a handler returning `confidence: high | medium | low`. **That
is not what shipped.** Session 14 built an *audit of existing codes*, and `suggest_hsn` returns
`[VERIFIED — CLAUDE.md, Session 14]`:

```
{ id, verdict: 'correct' | 'likely_wrong' | 'definitely_wrong' | 'no_code',
  reason, suggested_hsn }
```

There is no `confidence`. There is also no "suggest a code for a blank field" path anywhere in the
product — §3.3's autofill was never built, and A1 is the first caller that needs it.

**Correct behaviour `[DECIDED]`:** A1 sends every material with a blank `hsn_sac` to `suggest_hsn`
with an empty `hsn_sac`, and maps the response:

| `suggest_hsn` returns | A1 band | Review row shows |
|---|---|---|
| `verdict='no_code'` **with** a `suggested_hsn` that passes shape validation | **amber** | Pre-filled, tick to accept, label *"AI suggestion — verify with your CA"* |
| `verdict='no_code'` with no usable `suggested_hsn` | **amber** | Blank, label *"No HSN — add before your first filing"* |
| any other verdict (the material already had a code) | **amber** if the verdict is `likely_wrong` / `definitely_wrong`, **green** if `correct` | The existing code, with the verdict's `reason` when flagged |

**An AI-derived HSN is never green and never auto-imported.** Inherited unchanged from
`enterprise-strategy.md` §3.3 rule 1, which survives the divergence intact.

`[UNVERIFIED — confirm that suggest_hsn accepts an item with a blank hsn_sac and returns
'no_code' with a usable suggestion, rather than short-circuiting. Session 14's client flow splits
blanks out BEFORE calling Haiku (CLAUDE.md: "splits client-side into no_code … immediate verdict,
never sent to Haiku"), so the handler may never have been exercised on a blank. Test first; if it
short-circuits, A1 needs a second prompt mode on the same handler, not a second handler.]`

---

## 1. The problem, timed

Onboarding is the only operational task whose per-client cost is measured in hours, and it arrives
in bursts.

| Step | Today | Time |
|---|---|---|
| Receive files, work out what they are | WhatsApp / email, mixed formats | 20–40 min |
| Reshape client data into the template's columns | By hand in Excel | 60–150 min |
| Chase missing HSN, UQC, GSTIN, units | Phone calls | 30–90 min |
| Import via `onboarding.html` steps 3–6 | 4 sequential CSV imports | 20–40 min |
| Reconcile BOM against material names | By eye | 30–90 min |
| Fix what the import rejected | Direct SQL, sometimes | 20–60 min |
| **Total** | | **3–6 hours** |

The evidence this is real, not projected `[VERIFIED — CLAUDE.md]`: Datta Prasad's 264 materials had
to go in **via direct SQL** because `importMaterials()` had a batch-race bug at the time. Shivprasad
is still recorded as *"products, materials, prices not yet fully loaded"* — three weeks after
onboarding. That is the honest state of the manual process at three clients.

**`onboarding.html` is a real and working tool** — 7 steps, template downloads, preview tables,
dedupe before chunking `[VERIFIED]`. What it is not is *tolerant of the input clients actually send*.
It requires the client's data to already be in Nexflow's column shape. **The founder is the adapter,
and the adapter is the three to six hours.**

**The forcing function is KPML.** Twenty vendors at 3–6 hours each is 60–120 founder-hours in the
same window the founder is running a pilot. It cannot be done manually, and the pilot's credibility
depends on it being done well. `business-strategy.md` §7.2 reaches the same conclusion: **A1 must
ship before the vendor wave, not during it.**

---

## 2. Architecture

```
  Excel · CSV · PDF · photo · plain text   (WhatsApp added later, §10)
                      │
                      ▼
        ┌─────────────────────────────┐
        │  onboard-ingest             │  new Edge Function, verify_jwt = false
        │  { action: 'submit' }       │  raw file → private Storage bucket
        └─────────────┬───────────────┘  writes p2_onboarding_submissions (status 'received')
                      │                  enqueues p2_job_queue (job_type 'onboarding_parse')
                      ▼
        ┌─────────────────────────────┐
        │  onboard-ingest             │  drained by cron, ONE submission per invocation
        │  { mode: 'drain' }          │
        └─────────────┬───────────────┘
                      │
      ┌───────────────┼────────────────────────────────┐
      ▼               ▼                                ▼
   EXTRACT      NORMALISE + VALIDATE              ADJUDICATE
   (code +      (code only — R1)                  (Opus — judgment only)
    Haiku OCR)   · GSTIN format + state code       · column → schema mapping
                 · unit conversion table           · duplicate candidate pairs
   xlsx/csv →    · BOM arithmetic bounds           · ambiguous unit semantics
   SheetJS       · duplicate CANDIDATE generation  · what a free-text row means
   pdf/photo →   · HSN via existing suggest_hsn
   Haiku vision                │
                               ▼
                  ┌────────────────────────────┐
                  │ p2_onboarding_submissions  │  parsed jsonb + flags jsonb
                  │ status = 'review'          │  green / amber / red per row
                  └────────────┬───────────────┘
                               ▼
            onboarding-review.html?token=<review_token>
            (public read via token; import requires an authenticated session)
                               ▼
            RPC import_onboarding_submission()  — one transaction, all or nothing
```

### 2.1 Why the split is exactly here

**Extraction — code, plus Haiku for pixels.** `.xlsx` / `.csv` parse deterministically with SheetJS,
already loaded in this codebase by `gstr2b-reconcile.html` `[VERIFIED]`. PDFs and photographs of
handwritten registers need a vision model; Haiku 4.5 is correct — bounded transcription, latency
matters, no judgment.

**Haiku transcribes to a grid. It does not interpret the grid.** A handwritten register becomes rows
of strings and nothing more; every subsequent decision runs through the same path as an uploaded
spreadsheet. One pipeline, many transports.

**Normalisation and validation — code only (R1).** See §4.

**Adjudication — Opus.** Column mapping, duplicate pairs, outlier interpretation. See §4.4.

---

## 3. Confidence bands `[DECIDED]`

| Band | Meaning | Import behaviour |
|---|---|---|
| **green** | Every deterministic validation passed and **no model judgment was required** | Included in "Approve all green" |
| **amber** | A judgment was made, a value was derived, or an outlier was detected | One tick each, or "accept all amber in this section" |
| **red** | Deterministic validation failed | **Blocks import of the whole submission** until resolved or the row is dropped |

**Red is always deterministic and never model-judged.** A model must never be the thing that decides
an import is safe. Model output can only ever *add* an amber (R1a — a model may lower confidence,
never raise it). Every green in a review table is green because deterministic validation passed, not
because Opus was confident.

---

## 4. Validation rules

### 4.1 GSTIN

15 characters, checksum, state code present in the 38-value map `export.html` already carries
`[VERIFIED — GST_STATE_CODES, expanded to 37 states + 38 + 97 on 2 Sept 2026]`. State and place of
supply derive from characters 1–2.

Malformed → **red**, never guessed. A wrong GSTIN on a client record produces a wrong place of
supply on every future invoice and a GSTR-2B mismatch at the counterparty.

### 4.2 Unit conversion

A fixed table: `kg↔g↔mg`, `m↔cm↔mm`, `l↔ml`, and `nos`/`pcs`/`pieces` as identity.

The model may *identify* that "200 grams" means value 200 in unit `g`; **code** does `200 g → 0.2
kg`. A unit outside the table is **red**, never inferred.

**Hard rule:** *any row that required a conversion is **amber** even when the arithmetic is
unambiguous.* A wrong assumption about which unit the client meant is unrecoverable once it is in
`p2_product_bom` — `p2_stock_transactions` is append-only and every future consumption inherits the
error.

### 4.3 UQC

Map to the GSTN codes already in use — `NOS` / `KGS` / `MTR` / `LTR` / `PCS` / `SQM` / `CBM` / `OTH`
— reusing the Session 3 backfill logic. An unmappable unit gets `OTH` and an **amber** flag.

`CLAUDE.md`'s existing distinction holds and must be preserved: **`OTH` means "checked, doesn't map
cleanly"; `NULL` means "never set."** A1 never writes `NULL` — every material it creates has been
checked.

### 4.4 Duplicate detection — the part that needs both halves

The brief's own example proves why neither alone works: *"Copper Wire 0.9mm"* and *"CW-0.90"*
normalise to `COPPERWIRE09MM` and `CW090`. **String distance fails on this pair.** So recall comes
from code, precision from the model.

**Code generates candidates** by three independent routes:

1. Normalised exact match — `upper(regexp_replace(name, '[^A-Z0-9]', '', 'g'))`.
2. Shared numeric tokens **plus** token-subset overlap: `0.9` / `0.90` match, and `CW` is a subset of
   the initials of "Copper Wire".
3. `material_code` cross-reference against rows already in the tenant.

**Opus adjudicates each candidate pair** — genuine judgment, and cheap because it sees only the
pairs, never the 264 rows.

**Every merge is amber.** A merge decision is never auto-applied. Merging two materials that were
actually distinct silently fuses two stock ledgers with no clean undo.

### 4.5 BOM validation

*"Wrong quantities corrupt stock forever."* Four deterministic checks and one model check.

| # | Check | Band on failure |
|---|---|---|
| 1 | `qty_per_unit > 0` and finite | **red** |
| 2 | Every BOM ingredient resolves to a material in the same submission or already in the tenant | **red** — the single most common real failure, and trivially detectable |
| 3 | Every product has ≥ 1 BOM line | **red** — a product with no recipe consumes nothing on dispatch, and the error surfaces months later as stock that never moves |
| 4 | **Order-of-magnitude outlier.** Per material, compute `qty_per_unit` across every product using it; flag any value more than **20× the median** for that material | **amber** |
| 5 | Opus reads only the flagged outliers plus their product context and says whether it looks like a unit error, a genuine bulk item, or a typo | **changes the amber explanation text. Cannot clear the flag.** |

Check 4 is what catches *"500 kg copper wire per motor"* — **not** a hardcoded plausibility table,
which would be customer-specific logic (R2) and wrong for the next industry. The client's own data
supplies the norm.

**Say the limitation in the review UI rather than implying more assurance than exists.** Where a
product's unit weight is known a mass-sum sanity check is worth adding; in practice it is usually
unknown, and the honest statement is that Nexflow can validate *internal consistency*, not absolute
plausibility.

### 4.6 HSN

Per §0 X2. Call the existing `suggest_hsn` `body.action` on `agent-query` — it already exists, is
shape-validated, logs to `p2_agent_logs` with `intent='hsn_audit'`, caps at 25 items per call and
sits **outside the daily agent quota** `[VERIFIED — Session 14]`. **Do not write a second HSN path.**

Sequential batches of 25, never parallel — matching `export.html`'s own client flow.

---

## 5. Schema

Two new tables. Both `tenant_id`-nullable, because parsing and review legitimately precede the
tenant existing (§7).

```sql
-- A1 — one row per submission. A submission is one client's data, from one channel,
-- in one sitting. A KPML batch of 20 vendor sheets produces 20 rows (§7).
CREATE TABLE p2_onboarding_submissions (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id               uuid,                 -- NULLABLE. Set when the tenant exists.
  batch_id                uuid,                 -- groups sheets from one KPML workbook
  batch_label             text,                 -- 'KPML vendor wave, Nov 2026'

  -- Provenance
  source                  text NOT NULL DEFAULT 'upload'
                            CHECK (source IN ('upload','whatsapp','email')),
  source_ref              text,                 -- WhatsApp sender, email message-id
  submitted_by            uuid REFERENCES auth.users(id),
  client_name_hint        text,                 -- what the founder called it at submit time

  -- Review access
  review_token            uuid NOT NULL DEFAULT gen_random_uuid(),
  review_token_expires_at timestamptz NOT NULL DEFAULT (now() + interval '30 days'),
  preferred_lang          text NOT NULL DEFAULT 'en' CHECK (preferred_lang IN ('en','mr')),

  -- Pipeline state
  status                  text NOT NULL DEFAULT 'received'
                            CHECK (status IN ('received','parsing','review',
                                              'importing','imported','failed')),
  error_reason            text,

  -- Payload
  parsed                  jsonb NOT NULL DEFAULT '{}'::jsonb,   -- §5.1
  flags                   jsonb NOT NULL DEFAULT '{}'::jsonb,   -- §5.2
  counts                  jsonb NOT NULL DEFAULT '{}'::jsonb,   -- {green:241, amber:18, red:5}

  -- Model accounting
  opus_called             boolean NOT NULL DEFAULT false,
  model_degraded          boolean NOT NULL DEFAULT false,       -- true when Opus was unavailable

  imported_at             timestamptz,
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now()
);

-- One row per uploaded file. A WhatsApp submission of six photos has six rows.
CREATE TABLE p2_onboarding_files (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  submission_id   uuid NOT NULL REFERENCES p2_onboarding_submissions(id) ON DELETE CASCADE,
  storage_path    text NOT NULL,        -- onboarding-uploads/{submission_id}/{filename}
  original_name   text NOT NULL,
  mime_type       text,
  size_bytes      bigint,
  sheet_name      text,                 -- for a multi-sheet workbook
  extract_status  text NOT NULL DEFAULT 'pending'
                    CHECK (extract_status IN ('pending','extracted','failed','unsupported')),
  extract_error   text,
  created_at      timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE p2_onboarding_submissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE p2_onboarding_files       ENABLE ROW LEVEL SECURITY;

-- Three command-scoped policies, get_my_tenant_id(), no DELETE.
-- Modelled on p2_notifications, which codebase-audit.md calls the reference implementation.
-- NEVER auth.uid() — that pattern silently blocks every non-owner staff role.
CREATE POLICY p2_onboarding_submissions_select ON p2_onboarding_submissions
  FOR SELECT USING (tenant_id = get_my_tenant_id());
CREATE POLICY p2_onboarding_submissions_insert ON p2_onboarding_submissions
  FOR INSERT WITH CHECK (tenant_id = get_my_tenant_id());
CREATE POLICY p2_onboarding_submissions_update ON p2_onboarding_submissions
  FOR UPDATE USING (tenant_id = get_my_tenant_id())
              WITH CHECK (tenant_id = get_my_tenant_id());
-- …the same three shapes for p2_onboarding_files, joined through submission_id.

CREATE INDEX p2_onboarding_submissions_token_idx
  ON p2_onboarding_submissions (review_token);
CREATE INDEX p2_onboarding_submissions_batch_idx
  ON p2_onboarding_submissions (batch_id) WHERE batch_id IS NOT NULL;
CREATE INDEX p2_onboarding_submissions_status_idx
  ON p2_onboarding_submissions (status, created_at);
CREATE INDEX p2_onboarding_files_submission_idx
  ON p2_onboarding_files (submission_id);
```

**A row with `tenant_id IS NULL` is invisible to every RLS policy.** That is correct and deliberate:
a pre-tenant submission is reachable only by `review_token` through the service-role Edge Function,
and by the founder through service role. It cannot leak into a tenant surface.

**`review_token_expires_at` ships with the table.** `telegram_bind_token` shipped without an expiry
and had to have one retrofitted in Session 6 `[VERIFIED]`. Do not repeat that.

**New private Storage bucket: `onboarding-uploads`.** Modelled on `filing-packages` — **private,
never public**, all access via service role or a pre-signed URL. Path
`{submission_id}/{original_name}`.

### 5.1 `parsed` shape

```json
{
  "company":   { "name": "…", "gstin": "…", "address": "…", "state_code": "27" },
  "materials": [ { "row_id": "uuid", "name": "…", "unit": "kg", "uqc": "KGS",
                   "material_code": "…", "hsn_sac": "…", "gst_rate": 18,
                   "min_stock_level": 100 } ],
  "products":  [ { "row_id": "uuid", "name": "…", "product_code": "…",
                   "hsn_sac": "…", "uqc": "NOS" } ],
  "bom":       [ { "row_id": "uuid", "product_row_id": "uuid",
                   "material_row_id": "uuid", "qty_per_unit": 2.4 } ],
  "suppliers": [ { "row_id": "uuid", "name": "…", "gstin": "…", "mobile": "…" } ],
  "clients":   [ { "row_id": "uuid", "name": "…", "gstin": "…", "address": "…",
                   "is_job_work_principal": false } ],
  "prices":    [ { "row_id": "uuid", "material_row_id": "uuid",
                   "price_per_unit": 620, "effective_date": "2026-04-01" } ]
}
```

`row_id` is minted by the parser and is what the review page ticks and the import RPC accepts. It is
**not** a database id — nothing exists in the database until import.

### 5.2 `flags` shape

```json
{
  "<row_id>": {
    "band": "amber",
    "reasons": [
      { "code": "unit_converted", "detail": "200 g → 0.2 kg",
        "source": "deterministic" },
      { "code": "hsn_ai_suggested", "detail": "85444911 — insulated copper winding wire",
        "source": "model" }
    ]
  }
}
```

`source` is `"deterministic"` or `"model"` and is what enforces R1a mechanically: a `band` of
`"red"` with any `source: "model"` reason is a bug, and the review page asserts it.

---

## 6. The atomic import

One `SECURITY DEFINER` RPC, one transaction:

```sql
import_onboarding_submission(
  p_submission_id     uuid,
  p_accepted_row_ids  uuid[]
) RETURNS jsonb
```

**FK-ordered inserts:** materials → products → BOM (needs both) → suppliers → clients → prices →
settings. Any failure rolls the whole thing back and stamps `error_reason`.

**Do not implement this as a sequence of PostgREST inserts from the browser.** That is what
`onboarding.html` does today and it is exactly why the 17 August 2026 bug scan found duplicate-name
conflicts spanning 50-row batch chunks, fixed by dropping the batch loop entirely `[VERIFIED]`. One
statement per table, one transaction, one outcome.

**The RPC is called by the owner's authenticated session, not by service role.** `[DECIDED]` Two
independent reasons:

1. A review token that could write into a tenant is a capability token for the tenant's entire
   master data. **Read and write must not share a credential.**
2. It makes `get_my_tenant_id()` return the right value, so the `set_tenant_id()` trigger on all ten
   target tables behaves correctly **without needing P2** (`automation-strategy.md` §3.4). P2
   remains worth doing; A1 does not block on it.

**Returns** `{ inserted: { materials: 241, products: 38, bom: 412, … }, skipped: [...] }` so the
review page can show what actually landed rather than a bare success.

**Red rows block.** The RPC re-validates: if any `row_id` in the submission has `band = 'red'` and
is not in a `p_dropped_row_ids` set, it raises. The review page cannot be the only guard — a stale
tab could submit an old accepted set.

---

## 7. Batch mode — the KPML case `[DECIDED]`

One Excel with 20 vendor sheets. **Each sheet becomes its own submission row**, sharing a
`batch_id`, with its own `review_token`, its own review link, and its own atomic import. Nothing is
shared except the batch id and a founder-facing progress view.

**Sheet-per-submission is not a convenience, it is the isolation boundary.** The tempting
alternative — one giant submission with a vendor column — is wrong three ways:

1. One vendor's red row would block nineteen other vendors' imports.
2. A vendor reviewing the batch would see nineteen competitors' cost structures — the cross-tenant
   leak `kpml-network-plan.md` §10.5 treats as **unrecoverable** in a district where every factory
   owner knows every other.
3. The twenty imports must land in twenty different tenants under twenty different authenticated
   sessions anyway.

**Sequencing.** The import step needs each vendor's tenant to exist and their owner to be able to
sign in. Either A7 provisions them first, or the founder provisions manually and the review links go
out afterwards. **Parsing and review work before the tenant exists** (`tenant_id` is nullable);
only import is gated.

**Founder-facing batch view.** A simple table on the admin surface: vendor, status, green/amber/red
counts, review link, imported-at. This is the only cross-vendor aggregate that exists, it is
founder-only, and it never reaches a vendor's screen.

---

## 8. The review page

New page, `onboarding-review.html`, root level, no navbar — the same three-state shape as
`receive.html` and `invoice.html` (valid token → content; missing token → *"Invalid link"*;
bad/expired → *"not valid or expired"*) `[VERIFIED]`. Read access is by `review_token` through a
public Edge Function with a UUID regex guard and a service-role read: the established pattern this
codebase already runs twice (`receive-dispatch`, `invoice-view`). **Zero new auth design.**

**But the import button requires an authenticated session for that tenant** (§6).

**Sections:** Company · Materials · Products · BOM · Suppliers · Clients · Prices · Settings.

Each section shows a count row (`241 green · 18 amber · 5 red`), **worst-first ordering within the
section**, and inline editing for amber and red.

**Colour convention — reuse, do not invent.** `FFD4F7DC` green, `FFFFF0B3` amber, `FFFFC9C9` red,
already established by the HSN audit and the ITC-04 workbook `[VERIFIED]`. On-screen, the left
border of the row's first `<td>` carries the colour — `<tr>` itself cannot hold a border under
`.nx-table`'s `border-collapse: collapse`, a trap Session 14 already hit and documented.

**All client-facing strings are language bundles** (`automation-strategy.md` §3.2), resolved through
`_shared/i18n.ts`'s `tr()`. The page reads `preferred_lang` off the submission, not `localStorage` —
the server chose the language when it sent the link.

**Mobile.** `.nx-modal` has no `max-height` anywhere in this codebase except two pages, and tall
modals clip their submit button off-screen at 390px `[VERIFIED — codebase-audit.md §5.4]`. This page
has no modals; if one is added, give it `max-height: 90vh; overflow-y: auto`.

---

## 9. Model choice

| Job | Model | Why |
|---|---|---|
| Column → schema mapping | **Opus 5** | Reads a stranger's mental model of their own factory from headers like `WT/PC`, `RM CODE`, `QTY REQD`. Cross-references across sheets. **This is the judgment the three-to-six hours actually consists of.** |
| Duplicate pair adjudication | **Opus 5** | *"CW-0.90 is plausibly Copper Wire 0.9mm"* requires domain inference, and a wrong merge is unrecoverable |
| BOM outlier interpretation | **Opus 5** | Same call, same context — no extra request |
| Handwritten / PDF transcription | **Haiku 4.5** | Bounded transcription, latency matters, no judgment |
| HSN suggestion | **Haiku 4.5** | Already built (`suggest_hsn`) |

**Bound the input by construction.** Opus sees the column headers, a **20-row sample per sheet**,
the Nexflow target schema, the deterministic validation results, and the flagged candidates. It does
**not** see 264 rows of material master. This keeps cost flat regardless of client size — the same
discipline that keeps the filing package's input bounded.

An onboarding runs **once per client, ever**. Choosing the cheaper model to save ₹30 against a
₹35,000 setup fee would be an unforced error.

### 9.1 Cost

At Opus 5 `$5`/`$25` per MTok and Haiku 4.5 `$1`/`$5`, ₹90/USD:

| Component | Tokens | Cost |
|---|---|---|
| Opus mapping + adjudication | ~20k in, ~10k out | ₹31.50 |
| Haiku HSN, 264 materials (11 calls of 25) | — | ₹27.00 |
| Haiku transcription / parse assists | ~15k in, ~5k out | ₹3.60 |
| **Typical total** | | **≈ ₹62** |
| Worst case (messy, two Opus passes, photographed registers) | | ≈ ₹110 |

Against a ₹1,000 budget from the ₹35,000 setup fee: **16× headroom.** Twenty KPML vendors
simultaneously cost about **₹1,240, one time.**

---

## 10. Trigger, output, error handling

| | |
|---|---|
| **Trigger** | `{action:'submit'}` from `onboarding.html`, the review page, or the WhatsApp webhook (§10.1). **Parsing is queued, never inline.** |
| **Drain cron** | `onboarding-parse-drain`, every 2 minutes, `{mode:'drain'}`, **one submission per invocation** |
| **Output** | `parsed` + `flags` + `counts`, status `review`, a review link sent in the client's `preferred_lang`, and `opsAlert('onboarding','monitor', …)` summarising counts |
| **Parse failure** | Status `failed`, `error_reason` stored verbatim, `important` ops alert, client told *"we could not read this file — here is what we need"* in their language. **Never a raw parser error to a client.** |
| **Import failure** | Transaction rolls back; nothing written; status returns to `review`; `error_reason` shown inline; **`critical`** ops alert |
| **Model failure** | **Degrade, do not fail.** Opus unavailable → deterministic validation still runs, every judgment-requiring row becomes **amber** with *"needs review — automatic mapping unavailable"*, `model_degraded = true`, and the submission still reaches review. Same three-layer philosophy as `callOpusCoveringNote`'s Opus → Haiku → deterministic chain `[VERIFIED]`. **The review page is the product; the mapping is the polish.** |
| **Expiry** | `review_token_expires_at`, 30 days, shipped with the table |

### 10.1 WhatsApp — A1 Phase 2, blocked on P3

`[RECOMMENDED]` Build after the upload path is proven. Blocked on WhatsApp Business Cloud API
access, which needs a verified Meta Business account and in practice wants the legal entity — so it
trails incorporation.

**The design rule: WhatsApp is a transport, not a second pipeline.** It normalises into the same
`p2_onboarding_submissions` shape and shares every downstream stage. `source='whatsapp'` and
`source_ref` record provenance; nothing else in the pipeline knows or cares.

Three mechanics that matter:

- **Multi-message submissions.** An open submission for a sender stays open for a **30-minute idle
  window**, extended by each message. The client closes it explicitly (`done` / `झालं`) or the
  window expires. Without this, six photos become six submissions and six review links, and the
  client gives up.
- **Unknown senders are prospects, not tenants.** A message from an unrecognised number creates a
  submission with `tenant_id = NULL` and alerts the founder. It never creates a tenant and never
  gets a review link until the founder associates it.
- **Never send client data outbound beyond a link.** A review link, never a data dump.

**Voice notes are out of scope for v1.** Claude does not transcribe audio; the language is Marathi
in a factory with machine noise; and a *silently wrong* transcription of a quantity is the worst
failure available in this pipeline — it would arrive looking like clean structured data, pass
deterministic validation, and land in a BOM. Gate a revisit on twenty real Marathi voice notes
scored specifically on **numeric** accuracy, below 98% do not ship.

---

## 11. Build sequence

**3–4 sessions.** Depends on A6's `p2_job_queue` and A0's `opsAlert`.

| # | Step | Session | Output |
|---|---|---|---|
| 1 | Migration `20261201_onboarding_engine.sql` | 1 | Two tables, RLS enabled in the same file, 4 indexes, Storage bucket. Test tenant first; regression snapshot diff must be empty. |
| 2 | `onboard-ingest` — `submit` mode | 1 | File → Storage, submission row, queue row. No parsing yet. |
| 3 | Extraction: SheetJS for xlsx/csv | 1 | `p2_onboarding_files.extract_status` moves to `extracted`. Raw grids in `parsed`. |
| 4 | **Deterministic validation, complete** | 1–2 | §4.1–4.5 minus the model halves. `flags` populated with `source:"deterministic"` only. **This is the acceptance gate for session 1** — the engine must be useful with no model at all. |
| 5 | `onboarding-review.html` + the public read function | 2 | Token flow, sections, bands, inline edit. Read-only. |
| 6 | `import_onboarding_submission` RPC | 2 | FK-ordered, atomic, re-validates red. Called from the review page with an authenticated session. |
| 7 | **End-to-end on Datta Prasad's real files** | 2 | 264 materials, 28 suppliers, 97 prices. Import into a scratch tenant, not Datta Prasad. Compare against what is live. |
| 8 | Opus: column mapping | 3 | `opus_called = true`. Degraded path tested by disabling the key. |
| 9 | Opus: duplicate adjudication + outlier interpretation | 3 | Candidates from code, verdicts from Opus, every merge amber. |
| 10 | `suggest_hsn` integration | 3 | Per §0 X2. **Test the blank-`hsn_sac` path first** — it may never have been exercised. |
| 11 | Haiku vision for PDF/photo | 3–4 | Grid only, no interpretation. |
| 12 | Batch mode + the founder batch view | 4 | §7. Test with a 20-sheet workbook. |
| 13 | Language bundles + Marathi review page | 4 | Through `tutorial-engine.md` §8.5's process including the read-aloud gate. English ships first. |
| 14 | WhatsApp channel | later | §10.1. Blocked on P3. |

**Steps 1–4 must not be reordered.** The deterministic layer is what makes the model layer safe to
add; building them together produces a system where nobody can tell which half made a decision.

**Acceptance test for the whole feature:** Datta Prasad's original files, in their original shape,
reach a review page with correct bands in under ten minutes of founder time, and import cleanly into
a scratch tenant. If the founder has to open Excel at any point, A1 has not replaced the adapter.

---

## 12. Founder vs automation

| Automation does | Founder does |
|---|---|
| Accepts any format, any channel | Sends the client the link |
| Maps columns to the schema | **Reviews red rows — the only mandatory touch** |
| Validates GSTIN, units, BOM arithmetic | Decides an ambiguous merge the model flagged low-confidence |
| Suggests HSN, flags outliers | Calls the client when data is genuinely missing |
| Generates 20 review links for a batch | Confirms the batch went out |
| Imports atomically on approval | Nothing |

**3–6 hours → ~30 minutes per client.** At 100 clients and 8 new clients/month: **saves ~32
hours/month.**

---

## 13. Out of scope `[NEVER]`

1. **Replacing `onboarding.html`.** The manual path stays, as the fallback and as the thing that
   works when a model is down.
2. **Auto-applying a merge.** Every merge is amber. Merging two materials fuses two append-only
   ledgers with no clean undo.
3. **A model clearing a red flag.** R1a. Red is deterministic, always.
4. **Importing without an authenticated session for the target tenant.** §6.
5. **One submission spanning multiple vendors.** §7. It is the isolation boundary.
6. **Writing anything into a live tenant before the owner approves it.** Nothing exists in the
   database until `import_onboarding_submission` is called.
7. **Voice note transcription in v1.** §10.1.
8. **Guessing a unit, a GSTIN or a BOM quantity.** Red, every time.

---

## 14. Open questions

**Q1. Does `suggest_hsn` handle a blank `hsn_sac`?** `[UNVERIFIED]`
Session 14's client flow splits blanks out before calling Haiku, so the handler may never have seen
one. **Resolve:** POST one item with `hsn_sac: ''` and read the response. If it short-circuits, A1
needs a second prompt mode on the same handler — not a second handler.
**Decide before:** step 10.

**Q2. What is the CBIC-of-onboarding — where do the 20 KPML vendor files actually come from?**
The batch design assumes one Excel with 20 sheets. If KPML instead sends 20 separate files, or the
vendors each send their own, `batch_id` still works but the founder-facing flow differs.
**Action:** ask through Datta Prasad or Shivprasad before building §7.
**Decide before:** step 12.

**Q3. Should `hsn_source` gain a fifth value for AI-suggested-at-onboarding?** `[RECOMMENDED: no]`
§0 X1 writes `'imported'` and keeps provenance on the submission. A fifth enum value has exactly one
writer and complicates a constraint on two live master tables.
**Decide before:** step 10.

**Q4. Does A1 create the tenant, or only fill it?** `[RECOMMENDED: only fill it]`
Provisioning is A7's job. A1 parses and reviews with `tenant_id IS NULL` and imports once someone
else has created the tenant. Merging them would put tenant creation behind a public token.
**Decide before:** step 6.

**Q5. What happens to a submission that is never reviewed?**
`review_token_expires_at` is 30 days. After that the link dies but the row and the Storage objects
remain. `[RECOMMENDED]` a monthly sweep moves submissions older than 90 days with
`status='review'` to `failed` with `error_reason='abandoned'`, and deletes the Storage objects.
Nothing is deleted while a client might still act.
**Decide before:** the first real client.

---

*Last updated: 11 September 2026. Design complete; no code written.*
*Move `[RECOMMENDED]` to `[DECIDED]` as decisions are taken, and replace §0's `[UNVERIFIED]` on
`suggest_hsn` with what the handler actually returned the day it is tested.*
