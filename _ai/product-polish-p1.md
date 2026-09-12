---
name: product-polish-p1
description: Nexflow Session P1 — product polish. The shared modal fix, five feedback idioms reduced to one, global search, dashboard and empty states, mobile nav, the CA features menu on export.html, print stylesheets, and the Marathi coverage gaps on the pages that handle money. A checklist, ordered so nothing is missed. Read in full before building P1.
sources: [codebase-audit.md §5, tutorial-engine.md §7.3 and §8.3, CLAUDE.md, md-audit-report.md]
last_updated: 11 September 2026
status: design complete — not yet built. Living document: update in place as it is built.
---

# Nexflow — Product Polish (Session P1)

**Load order for a P1 session. Read in this order, in full:**

1. `_ai/CLAUDE.md` — the Language Toggle section, the plan-gating rules, and the challan.html gotchas
2. `_ai/product-polish-p1.md` (this file)
3. `_ai/codebase-audit.md` §5 — every finding below traces to it, with line numbers
4. `css/nexflow-design.css` — the file three of the six workstreams change

**Status: designed, not built.** P1 has **no spec anywhere in the document set** — it is not named in
`CLAUDE.md`'s build order, not in `enterprise-strategy.md`, not in any Backlog entry. This file is
the first one.

**What P1 is.** A single session that fixes the accumulated inconsistencies a factory-floor user hits
daily, ordered so a session cannot miss things. It is deliberately a **checklist, not an essay** —
every item names a file and a line, and every item is independently shippable.

**What P1 is not.** It is not a redesign, not a refactor, and not a place to fix logic bugs. Where a
polish item sits next to a correctness bug, the bug is named and pointed at its own session. §9.

---

## Tag convention

Inherited from `enterprise-strategy.md`, unchanged.

| Tag | Meaning |
|---|---|
| `[DECIDED]` | Decided. Build it as written. |
| `[RECOMMENDED]` | This document's recommendation. Needs founder sign-off. |
| `[VERIFIED]` | Traced to a specific finding in `codebase-audit.md` or `CLAUDE.md`, 11 Sept 2026. |
| `[UNVERIFIED]` | Needs a live check. Listed again in §10. |
| `[NEVER]` | Out of scope for P1. |

---

## 0. The ordering principle

P1 has six workstreams. They are ordered by **how many people hit the problem, how often, and
whether it stops them completing a task** — not by how visible the fix is.

| # | Workstream | Why here | Est. |
|---|---|---|---|
| **1** | The shared modal fix | **A user physically cannot submit a form.** One CSS rule closes it across six modals. | 0.5 h |
| **2** | Feedback idioms: five → one | `alert()` blocks the page and is untranslated, on a Marathi-first product | 2 h |
| **3** | Mobile at 390px | Every storekeeper, every day, on a ₹8,000 phone | 3 h |
| **4** | Marathi coverage on the money pages | 0/17 strings on the most financially consequential form in the product | 3 h |
| **5** | Empty states, dashboard, global search | The first thing a new tenant sees is a blank table | 3 h |
| **6** | CA features menu + print stylesheets | Discoverability and the artefacts a CA actually handles | 2 h |

**Workstream 1 first, always.** It is thirty minutes and it unblocks a submit button.

---

## 1. The shared modal fix

### 1.1 The bug

`[VERIFIED — codebase-audit.md §5.4]` `.nx-modal` sets **no `max-height` and no `overflow-y`** in
`invoices.html:34-40`, `all-dispatch-history.html:26-31`, or any history page. The overlay is
`position: fixed; inset: 0; display: flex; align-items: center`, so **a modal taller than the
viewport is vertically centred with both ends clipped and no scroll.**

Only two modals in the entire codebase are safe: `grn.html:261` (`max-height: 85vh; overflow-y:
auto`) and `settings.html:117` (`max-height: 90vh`).

Affected, worst first:

1. **Generate Invoice modal** (`all-dispatch-history.html:244-284`) — the items table grows one row
   per line item. **A 6+ item dispatch pushes the "Generate Invoice" / "Cancel" buttons at
   `:281-282` below the fold. The user physically cannot submit.**
2. **Record Payment modal** (`invoices.html:385-443`) — ~490px of content. Fits portrait on a
   390×844 phone; clips in landscape and on anything smaller.
3. **New Consolidated Invoice preview** (`invoices.html`) — same variable-height problem.
4. **Hard Delete modal** (`all-dispatch-history.html:229-238`) and **Amend modal** (`:223`).

### 1.2 The fix `[DECIDED]`

`.nx-modal` is **not in `css/nexflow-design.css` at all** — only its entrance animation is, at
`:719-735`. Each page re-declares it: `invoices.html:27-40`, `all-dispatch-history.html:21-31`,
`settings.html:105-120` (as `.nx-modal-lg`, the only copy with a `max-height`), plus fully inline
styles in `challan.html:952` and `grn.html:261`. **That is how this bug happened** — two copies got
the property and four did not.

```css
/* css/nexflow-design.css — add beside the existing .nx-modal entrance animation */
.nx-modal {
  max-height: 90vh;
  overflow-y: auto;
}
```

Then **delete the six per-page copies.** One rule, six modals, permanently.

**Verify after deleting**, because the copies are not byte-identical: each carries its own
`max-width`, `padding` and `border-radius`. Move those into the shared rule first, diff each modal
visually at 1440px and 390px, then delete.

### 1.3 The CSS syntax error next door

`[VERIFIED — codebase-audit.md §5.4]` `all-dispatch-history.html:24-25` has an `.amend-badge{…}`
rule pasted **inside** the `.nx-modal-overlay` declaration block, with the block's own
`padding: 20px` trailing after it on the same line:

```css
.nx-modal-overlay {
    position: fixed; inset: 0; background: rgba(0,0,0,0.65);
    z-index: 500; display: flex; align-items: center; justify-content: center;
/* amend-badge */
.amend-badge{display:inline-block;…;margin-left:6px;} padding: 20px;
}
```

The parser consumes `.amend-badge{…}` as one invalid declaration and discards it. **`.amend-badge` is
never defined**, so the amber "Amended" badge renders as unstyled text. Move the rule outside the
block. Two-line fix, same file, same session.

---

## 2. Feedback idioms: five to one

`[VERIFIED — codebase-audit.md §5.3]` The codebase has **five ways of telling a user something
happened**:

| Idiom | Where |
|---|---|
| `toast()` from `js/utils.js` | Most pages — **the target** |
| `alert()` | `dispatch.html:1041`, `invoices.html:872`, `production-issue.html` duplicate-issue confirm |
| `showStatus()` | `settings.html` |
| `showError()` / `#successMessage` banners | `dispatch.html`, `rm-dispatch.html` |
| Inline `#…Error` divs | `all-dispatch-history.html:891` |

### 2.1 Kill `alert()` first `[DECIDED]`

`alert()` does two things that are wrong on this product specifically:

1. **It blocks the page.** On a phone it is a modal the user must dismiss before they can read the
   form behind it.
2. **It is untranslated, always.** There is no way to put `data-mr` on a browser alert. On a
   Marathi-first product, every `alert()` is an English-only interruption.

`dispatch.html:1041`'s is the worst of the three: it fires on the pre-confirm stock check, so a
storekeeper mid-dispatch gets an English blocking dialog at the moment they are least able to parse
it. Replace all three with `toast()` and a `t(en, mr)` string.

### 2.2 Then converge the rest `[RECOMMENDED]`

`toast()` is already loaded on nearly every page via `js/utils.js` and is the established idiom.
Convert `showStatus()` and the `#successMessage` banners; **leave the inline `#…Error` divs where
they sit inside a modal**, because a toast fired from inside an open modal can render behind it —
and `all-dispatch-history.html:891`'s is exactly that case.

**The one rule to write down:** a message that must persist while the user acts on it is an inline
element; everything else is a toast. Put it in `CLAUDE.md`'s Rules section when P1 ships.

### 2.3 Remove the two production `console.log`s

`[VERIFIED — codebase-audit.md §5.1]` Only two exist in client code, and one of them is noisy:

- `js/auth.js:15` — `console.log('fetchUserRole: get_my_role result', { data, error })` fires on
  **every page load for every non-owner user**, printing their resolved role and any RPC error.
- `settings.html:3372` — `console.log('settings.html plan check:', tenantPlan)`.

Delete both. `console.error` / `console.warn` counts are high but all are legitimate error paths,
most paired with a user-facing `toast()` — **do not touch those.**

---

## 3. Mobile at 390px

The shared stylesheet already handles the common cases well `[VERIFIED — codebase-audit.md §5.4]`:
`.nx-table-wrap { overflow-x: auto }` at `:500-503`, `.nx-table { min-width: 420px }` at ≤480px
(`:861`) and `380px` at ≤380px (`:902`), `.nx-btn { min-height: 44px }` at ≤480px (`:866`),
full-width toasts (`:891-893`), and a full-width notification panel below 480px
(`js/navbar.js:190`). The items below are what falls outside it.

### 3.1 Three amount inputs in one row

`invoices.html:407` — Gross / TDS / Other Deductions as `flex: 1` siblings. At 390px, minus 20px
overlay padding, minus 28px × 2 modal padding, minus 2 × 12px gaps ≈ **100px per field**, with a
two-to-three-line wrapped label above each. Same pattern at `invoices.html:390` (Date + Mode) and in
the Record Advance modal.

**Fix:** `flex-wrap: wrap` with `min-width: 140px` on each group, or stack below 480px.

### 3.2 `onboarding.html` preview tables crush

`onboarding.html:439`, `:487`, `:539`, `:603` are `<table class="ob-preview-table">` with **no
`.nx-table-wrap`** and `width: 100%` with no `min-width` (`:151`). Unlike `.nx-table`, these
**compress instead of scrolling**. A 5–6 column material-import preview at 390px is unreadable, and
`body { overflow-x: hidden }` (`css/nexflow-design.css:76`) means anything that does overflow is
silently clipped rather than scrollable.

**Fix:** wrap each in `.nx-table-wrap` and give `.ob-preview-table` a `min-width`.

### 3.3 `challan.html` at 390px

`challan.html:237` (`.ch-outer`) and its items table (`:289`) have no `.nx-table-wrap`; the layout
targets A4. The mobile case **was** thought about — `checkMobileDevice()` and `handlePrint()`
(`:724-728`) detect mobile and swap the Print button for a "use a desktop" message — but the challan
itself still renders squeezed rather than scrollable.

**Fix:** wrap `.ch-outer` in a horizontal-scroll container with `min-width: 700px` **for screen media
only**, leaving print untouched.

**Care required here.** `CLAUDE.md` carries two standing warnings about this file: the PO column's
`showPoCol` flag gates thead, tfoot colspan, row cells **and Excel indices/merges** together; and
`downloadExcel()` reads the UNIT column value **back out of the rendered `<td>` text**, not from
`item.unit` — *"a fragile coupling with nothing enforcing it in code"* `[VERIFIED]`. A screen-only
wrapper does not touch either, but verify the Excel export by hand afterwards anyway.

### 3.4 `invoices.html` nested receipts table

`invoices.html:710` renders a 5-column receipts table inside a `<td colspan="8">` of the main table.
Base CSS gives it `min-width: 420px` at ≤480px, widening the parent row and forcing horizontal
scroll on the **whole** table to read one receipt breakdown.

**Fix:** render receipts as stacked key/value rows below 480px.

### 3.5 Untappable targets

| Target | Location | Fix |
|---|---|---|
| Rate input, fixed `width: 100px` in a 4-column table inside an already-cramped modal | `all-dispatch-history.html:878-880` | `min-width: 88px`, `flex: 1`, `font-size: 16px` (prevents iOS zoom-on-focus) |
| `−` / `+` adjustment-sign buttons, no explicit minimum size, not covered by the `.nx-btn` 44px rule | `settings.html:934-936` (`.adj-sign-btn`) | `min-width: 44px; min-height: 44px` |
| `.nx-table th { font-size: 9px }` at ≤480px — **below the practical legibility floor for a factory-floor phone in daylight** | `css/nexflow-design.css:862` | Raise to 11px and let the table scroll; `.nx-table-wrap` already handles the overflow |

### 3.6 Mobile nav

`[VERIFIED — tutorial-engine.md §4.8]` **Nexflow has no mobile bottom nav.** The mobile layout is a
fixed top navbar (56px; 52px below 480px) plus a **left slide-in drawer** opened by a hamburger, at
the `max-width: 900px` breakpoint. Overlay z-398, drawer z-399, navbar z-400.

Any design that assumed a bottom bar is wrong. P1's scope here is narrow and the constraint is
deliberate:

- **The drawer closes on navigation.** Verify it does; a drawer left open over the destination page
  is the single most common mobile-nav complaint.
- **The active page is marked in the drawer.** A storekeeper who taps GRN and lands on GRN should see
  which item is current.
- **The agent FAB sits at z-500, bottom-right** `[VERIFIED — tutorial-engine.md §4.11's z-index map]`.
  Do not add a second floating control there. `tutorial-engine.md` §12 Q4 already ruled on the
  analogous case: *"page header on both, as a compact ghost button next to the title; explicitly
  **not** a second FAB."*

`[NEVER in P1]` A bottom tab bar. It is a navigation redesign, it collides with the FAB, and nobody
has asked.

---

## 4. Marathi coverage on the pages that handle money

`[VERIFIED — codebase-audit.md §5.5]` Ranked by financial consequence:

| Rank | Surface | Labels | Buttons | Headers | `t()` | State |
|---|---|---|---|---|---|---|
| **1** | **Payment modal** (`invoices.html:385-443`) | **0/8** | **0/2** | — | 0 | Plus the title, 6 mode options and 5 validation toasts. **0/17 strings.** |
| **2** | **Generate Invoice modal** (`all-dispatch-history.html:244-284`) | 0/10 page-wide | 0/23 | 0/14 | 0 | Rate entry, GST-type selector and the e-invoicing banner all English-only |
| 3 | `invoices.html` overall | 5/21 | 8/18 | 11/29 | 12 | 16 labels, 10 buttons, 18 headers missing |
| 4 | `dispatch.html` | 9/13 | 5/18 | 9/14 | **0** | 13 buttons untranslated on a core daily page; **no `t()` helper at all**, so every rendered row is English |
| 5 | `grn.html` | **7/7** | 4/7 | 12/14 | 0 | Labels complete; no `t()` for dynamic rows |
| 6 | `settings.html` | 43/47 | 42/51 | 46/55 | 7 | Best-covered page |

**The Record Advance Payment modal directly below the Payment modal (`invoices.html:460+`) carries
`data-en`/`data-mr` on every field.** The pattern was available and simply not applied. That makes
rank 1 a mechanical fix, not a design question.

### 4.1 Two rules that must hold

**Static elements** use `data-en` / `data-mr`, applied once by the page's own `applyLang()`.

**Dynamically rendered content cannot rely on `applyLang()`** — it runs once at load. Use the
`t(en, mr)` helper inline in every render function, reading `localStorage.getItem('nexflow_lang')`
**fresh at render time** `[VERIFIED — CLAUDE.md]`.

`dispatch.html` has **zero** `t()` calls, so adding `data-en`/`data-mr` to its static labels fixes
half the page and leaves every rendered dispatch row in English. Both halves, or the page is not
done.

### 4.2 Fix the wrong Marathi label while here

`[VERIFIED — tutorial-engine.md §7.3]` `grn.html:217`'s Invoice No column header carries
`data-mr="चलान क्र"` — which reads as **challan number**, a different document entirely, and one that
also appears on the same page.

The same concept is labelled three ways:

| Page | Current | |
|---|---|---|
| `grn.html:217` | `चलान क्र` | **Wrong — means challan number** |
| `grn-history.html:166` | `बिल क्र` | Inconsistent |
| `invoices.html:218` | `इनव्हॉइस क्र` | Abbreviated |
| `manual.html` | `इनव्हॉइस क्रमांक` | **The agreed form** |

**Standardise on `इनव्हॉइस क्रमांक` across all three pages.** This is the field GSTR-2B
reconciliation, the CA export and the Bridge Agent's Purchase vouchers all key off; a storekeeper
who reads "challan number" and types the challan number has broken every one of them.

### 4.3 What stays English `[DECIDED]`

- **`export.html` and `gstr2b-reconcile.html`** — deliberately excluded; CA-facing column names stay
  English `[VERIFIED — CLAUDE.md]`. `ca-report.html`, `itc04-workingpaper.html`,
  `principal-dashboard.html` and `invoice.html` follow the same precedent.
- **Inside Marathi text**, always in Latin script `[VERIFIED — tutorial-engine.md §8.4]`: GST, GSTIN,
  HSN, SAC, ITC, CGST, SGST, IGST, ITC-04, GSTR-1, GSTR-2B, s.143, 43B(h); document numbers
  (`INV-202608-014`, `CH-260910-0042`); `Intrastate (CGST+SGST)` / `Interstate (IGST)`; and **Latin
  digits everywhere** — never Devanagari numerals.

### 4.4 The pages P1 does **not** translate

`[VERIFIED — codebase-audit.md §5.5]` `login.html`, `onboarding.html`, `accept-invite.html` and
`receive.html` are all zero-translation and all flagged Medium. `receive.html` in particular is *"used
by a storekeeper at a factory gate on a phone."*

**They are out of P1's scope on purpose.** Marathi is authored and read aloud by a native speaker in
the MIDC context, never machine-translated `[VERIFIED — tutorial-engine.md ADR-12]`, and that gate is
calendar time. P1 fixes the four surfaces where the pattern already exists next door and the strings
are mechanical. A four-page translation pass is its own session with a human in it. **§10 Q2.**

---

## 5. Empty states, dashboard, global search

### 5.1 Empty states `[RECOMMENDED]`

A new tenant's first experience is a series of blank tables. Every list surface needs three states,
not one: **loading**, **empty**, **populated**.

Surfaces, and what each empty state should say and offer:

| Page | Empty message | Action |
|---|---|---|
| `index.html` stock table | "No stock yet. Record your first GRN to see material here." | → `grn.html` |
| `grn-history.html` | "No GRNs recorded yet." | → `grn.html` |
| `all-dispatch-history.html` | "No dispatches yet." | → `dispatch.html` |
| `invoices.html` | "No invoices yet. Generate one from a confirmed dispatch." | → `all-dispatch-history.html` |
| `products.html` | "No products yet. Add one, then set its recipe." | → the add form |
| `settings.html` → Materials | "No materials yet. Import from a file, or add them one at a time." | → `onboarding.html` |
| `reports.html` | "Nothing to report yet." | — |

**One shared component**, not seven implementations — `.nx-empty` in `css/nexflow-design.css` with an
icon slot, a line of text and an optional button. Seven copies is how `.nx-modal` ended up with the
bug in §1.

**Distinguish empty from failed.** A fetch that errored must not render "No GRNs recorded yet" — that
is a lie the user will act on. `[VERIFIED — codebase-audit.md §5.7]` several list loaders destructure
`const { data: x } = await …` without checking `error`, so a network failure currently renders as an
empty list. P1 fixes the **rendering** (show a retry state); the **unchecked destructures** are
listed in §9 as correctness work.

### 5.2 Dashboard `[RECOMMENDED]`

`index.html` already carries stat cards, the stock table with a Low/OK filter, and — for job workers
— pool tabs (All / Own Stock / [Principal]) `[VERIFIED — CLAUDE.md, Session 4]`. P1's scope is
narrow:

- **A role-appropriate landing.** An accountant currently lands on the dashboard with a navbar
  showing only Reports and Invoices `[VERIFIED — codebase-audit.md §2.2]`. Once `js/roles.js` grants
  accountant `dashboard` (done in Session 2), the dashboard should surface what an accountant
  actually needs — pending invoices, overdue payments — rather than stock levels.
- **Today's activity.** GRNs received, dispatches confirmed, invoices raised, in one line. All three
  counts are already queried by surfaces elsewhere.
- **Do not add another chart.** `[NEVER in P1]` The dashboard's job is "what needs attention",
  not analytics.

### 5.3 Global search `[RECOMMENDED]`

**One search box in the navbar that resolves a document number.** That is the whole feature, and its
scope is deliberately small because the alternative — a cross-entity fuzzy search — is a session on
its own with an index behind it.

Resolve, in order:

| Input shape | Resolves to |
|---|---|
| `INV-YYYYMM-NNN` | `invoice.html?token=…` via `p2_invoices.invoice_number` |
| `CH-YYMMDD-NNNN`, `RM-1001`, or a bare number | the challan on `challan.html?id=…` via `p2_dispatch_orders.challan_number` |
| `GRN-…` | `grn-history.html` filtered to that GRN |
| A supplier or client name | the matching row in `settings.html` |

**Three constraints.** It is **tenant-scoped** by RLS and must also carry an explicit
`.eq('tenant_id', tenantId)` — `codebase-audit.md` §1.2 counts dozens of queries relying on RLS
alone, and a new one should not join them. It is **role-gated** — a storekeeper searching an invoice
number gets "not found", not a redirect to a page they cannot open. And it **never returns a list
spanning tenants**, obviously, but state it in the code comment because search is exactly where that
kind of mistake gets made.

`[NEVER in P1]` Full-text search across notes, narrations or material descriptions.

---

## 6. CA features menu and print stylesheets

### 6.1 The CA features card menu

`export.html` has accumulated seven CA-facing surfaces with no organising structure
`[VERIFIED — CLAUDE.md]`: the Tally/Zoho export, the Purchase Register, the GST Summary sheet,
GSTR-1 Table 13, GSTR-1 Table 12, the GSTR-1 Excel Workbook, the 43B(h) card, the HSN Audit, plus
entry cards to `gstr2b-reconcile.html` and `itc04-workingpaper.html` — and, after Session 24, the
payables register.

**`gstr2b-reconcile.html` is not in the navbar, not in `js/roles.js` `ROLE_PERMISSIONS`, and not in
`js/navbar.js` `NAV_LINKS`** — it is reachable only via a link on `export.html` `[VERIFIED]`. That
was a deliberate choice ("CA/accounting tools stay together") and it is right. But it means
`export.html` is the index page for eleven tools presented as a flat scroll.

**Fix `[RECOMMENDED]`:** group the cards under three headings, in the order a CA actually works:

| Heading | Cards |
|---|---|
| **Monthly filing** | GSTR-1 Excel Workbook · Table 12 (HSN/SAC) · Table 13 (Challan Register) · GSTR-2B Reconciliation |
| **Accounting handover** | Tally Transactions · Zoho Bills · Purchase Register · Filing Package status |
| **Compliance checks** | 43B(h) receivables · 43B(h) payables (Session 24) · ITC-04 Working Paper · HSN Audit |

Headings and ordering only. **Do not move a tool to another page** — the reason they are together is
the reason they should stay together.

**Role gate reminder.** `export.html`'s page gate was tightened in Session 6 from
`canAccess(role,'reports')` — which included operator — to a direct
`['owner','supervisor','accountant']` check, and `#gstr1WorkbookSection` was found **visible by
default regardless of role** because it had no `display: none` default unlike its four siblings
`[VERIFIED]`. When adding headings, verify every card still carries its default-hidden rule.

### 6.2 Print stylesheets

Three documents print, and they are in three different states `[VERIFIED — CLAUDE.md]`:

| Document | State |
|---|---|
| `challan.html` | **Good.** Tuned 19 Aug — `.ch-title-band`/`.ch-company` padding 8px screen / 4px print, signature area raised 10px → 20px, `#challan-content` print padding `5mm 8mm` → `4mm 6mm`, `.ch-meta-table td` `4px 8px` → `3px 8px`, whole challan including the QR cut-out fits one A4 page, "Powered by" footer hidden |
| `invoice.html` | **Good.** `@media print` modelled on challan's — forces white bg / black text since `nexflow-design.css` is dark-themed, `print-color-adjust: exact` to keep `.nx-table thead`'s grey, `@page A4 10mm`. Prints N physical copies per Rule 48 — 3 for goods, 2 for services — and the CANCELLED watermark is `position: fixed` so it repeats on every page |
| **Everything else** | **No print stylesheet at all** |

**P1's scope is the third row, for two surfaces only:**

- **`export.html`'s on-screen tables** (Table 12, Table 13, 43B(h)). A CA prints these. Today they
  print dark-themed with the navbar, the agent FAB and every button.
- **`reports.html`.**

**The pattern to copy is `invoice.html`'s**, not to invent: force white background and black text,
`print-color-adjust: exact` on table headers, `@page A4 10mm`, and a `.no-print` class on the navbar,
the FAB, the language toggle and every button.

`[NEVER in P1]` A print stylesheet for `index.html`, `dispatch.html`, `grn.html` or `settings.html`.
Nobody prints an operational screen, and each one is a maintenance surface for no reader.

---

## 7. Build sequence

**One session, ~13 hours of work.** No migrations. No Edge Functions. No new tables. No model calls.

| # | Step | Files | Verify |
|---|---|---|---|
| 1 | `.nx-modal` shared rule; delete six copies; fix `.amend-badge` | `css/nexflow-design.css`, 5 pages | Generate Invoice modal with 8 line items at 390px — **the submit button must be reachable** |
| 2 | Kill 3 `alert()`s; delete 2 `console.log`s | `dispatch.html`, `invoices.html`, `production-issue.html`, `js/auth.js`, `settings.html` | Trigger the stock-check path on `dispatch.html` and confirm a translated toast |
| 3 | Converge `showStatus()` / banners → `toast()` | `settings.html`, `dispatch.html`, `rm-dispatch.html` | Leave in-modal inline errors alone |
| 4 | Mobile: §3.1–3.5 | `invoices.html`, `onboarding.html`, `challan.html`, `all-dispatch-history.html`, `settings.html`, `css/nexflow-design.css` | **On a real ₹8,000 Android handset**, not devtools |
| 5 | Marathi: Payment modal (0/17), Generate Invoice modal, `dispatch.html` buttons + a `t()` helper | `invoices.html`, `all-dispatch-history.html`, `dispatch.html` | Toggle to Marathi and walk a full dispatch |
| 6 | `इनव्हॉइस क्रमांक` standardisation | `grn.html:217`, `grn-history.html:166`, `invoices.html:218` | Three pages, one string |
| 7 | `.nx-empty` component + 7 empty states | `css/nexflow-design.css`, 7 pages | Empty must be distinguishable from failed |
| 8 | Dashboard: role-appropriate landing + today's activity | `index.html` | Log in as accountant |
| 9 | Global search in the navbar | `js/navbar.js` | Tenant-scoped, role-gated, explicit `.eq('tenant_id', …)` |
| 10 | `export.html` card headings | `export.html` | Every card keeps its `display: none` default |
| 11 | Print stylesheets for `export.html`, `reports.html` | both | Print to PDF at A4 |

**Syntax-check each file after each pass.** This is the discipline the 9-pass `export.html` session
used (1,862 → 2,452 lines, each pass checked before the next) `[VERIFIED — CLAUDE.md, Sept 2]` and
it is why that session landed cleanly.

**Run the regression harness afterwards.** `node _ai/regression/snapshot.js` and `diff.js` against
**the most recent prior snapshot**, never `baseline-pre-2H.json` `[VERIFIED — CLAUDE.md's standing
instruction]`. P1 touches no write path, so the diff must be empty; a non-empty diff means something
in step 2 or 3 changed behaviour, not presentation.

---

## 8. The Type A guarantee applies here too

`[VERIFIED — kpml-network-plan.md §2]` SS Engineering is client one, live, free permanently, and
*"breaking them is the worst commercially available outcome."* The guarantee is testable and it
covers presentation as well as data:

> A written acceptance test against a copy of a standalone tenant's data, before and after, asserting
> **byte-identical** output for: material list, stock balances, CA export, Tally export, Zoho export,
> GSTR-2B reconciliation buckets, challan PDFs, invoice PDFs, and a fixed set of agent stock
> questions. **Any difference means the change is wrong — not that the test needs updating.**

Two P1 steps come close to that line:

- **Step 1** changes modal CSS on pages SS Engineering uses daily.
- **Step 11** adds a print stylesheet to `export.html`, and *"SS Engineering challans completely
  unchanged"* is a property `CLAUDE.md` asserts explicitly about the PO-column work.

Neither should change a single exported byte. **Verify it rather than assuming it.**

---

## 9. Explicitly not P1 — correctness bugs that live next door

Each of these sits beside a polish item and will be tempting. **They are correctness work with their
own consequences and they belong in their own session**, named here so P1 does not half-fix them.

| Bug | Where | Why not P1 |
|---|---|---|
| `rm-dispatch.html:1057-1060`, `:1173-1176` — **unchecked `.delete()`** on `p2_dispatch_items`; a failed delete followed by a successful insert **duplicates every line item on the challan** | `codebase-audit.md` §5.7 | Data corruption, visible on the printed challan, the invoice line items and the consumption math |
| `js/supabase-client.js:30-38` — unchecked settings fetch **defaults `plan` to `'founder'`**, granting Pro features to a Lite tenant on any network blip | `codebase-audit.md` §1.4, §5.7 | Plan gating. Should default to `'lite'` — least privilege |
| `settings.html:2453-2480` — **stock adjustment insert with no double-submit guard**; a double-tap silently doubles the correction | `codebase-audit.md` §5.6 | A direct stock-quantity write with no idempotency and no downstream check |
| `settings.html:3010`, `:3036` — price inserts with no guard; a double-tap creates two identical price rows on one `effective_date`, making "latest by effective_date" **order-dependent** | `codebase-audit.md` §5.6 | Silently changes every future invoice pre-fill |
| Date formatting: `toISOString().split('T')[0]` (UTC) at ~15 sites vs `toLocaleDateString('en-IN')` vs `fmtDDMMYYYY()` vs `todayIST()` (agent-query only) | `codebase-audit.md` §5.3 | This is the same class as the Sept 2 `todayIST()` off-by-one that was silently wrong at five call sites. It needs a careful pass, not a polish pass |
| `index.html` has **no `canAccess()` gate** | `codebase-audit.md` §2.1 | Must be fixed **together** with `js/roles.js`, or accountants hit an infinite redirect loop |

**If a P1 step surfaces one of these, note it and move on.** Fixing a data-integrity bug inside a
presentation session is how a presentation session becomes the thing that broke stock.

---

## 10. Open questions

**Q1. Does the mobile drawer close on navigation?** `[UNVERIFIED]` — §3.6.
**Resolve:** open the drawer on a 390px viewport, tap a nav item, observe.
**Decide before:** step 4.

**Q2. Should P1 translate `receive.html`?** `[RECOMMENDED: no]` — §4.4.
It is a storekeeper at a gate on a phone and it is the strongest argument for translating it. But
Marathi goes through the read-aloud gate with a native speaker, which is calendar time, and
`receive.html` is a public page where a wrong string reaches a counterparty's staff.
**Decide before:** step 5. If the founder can do the read-aloud pass in the same week, add it.

**Q3. Does global search need an index?** `[UNVERIFIED]`
`p2_invoices` has **no `tenant_id` index at all**, and `p2_dispatch_orders(tenant_id, dispatch_date)`
is missing `[VERIFIED — codebase-audit.md §6.3]`. An exact-match lookup on `invoice_number` or
`challan_number` will full-scan.
**Resolve:** measure on the test tenant. At three clients it will be fine; write the index into
`codebase-audit.md`'s existing missing-index list either way.
**Decide before:** step 9.

**Q4. Is `.nx-modal-lg` in `settings.html:105-120` a genuinely different component?** `[UNVERIFIED]`
It is the only copy with a `max-height`, which suggests it was the one someone fixed. If it differs
only in `max-width`, fold it into the shared rule with a modifier class.
**Decide before:** step 1.

**Q5. Should the dashboard's "today's activity" line be role-aware?** `[RECOMMENDED: yes]`
A storekeeper cares about GRNs received; an accountant cares about invoices raised and payments
overdue. Same query, different three numbers.
**Decide before:** step 8.

---

*Last updated: 11 September 2026. Design complete; no code written.*
*Move `[RECOMMENDED]` to `[DECIDED]` as decisions are taken, and tick §7's steps as they ship. When
P1 is done, add the §2.2 feedback rule and the §4.1 translation rule to `CLAUDE.md`'s Rules section
so the next session inherits them.*
