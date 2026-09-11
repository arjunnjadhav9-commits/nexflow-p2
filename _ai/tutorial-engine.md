---
name: tutorial-engine
description: Nexflow guided tutorial system — in-app step-by-step teaching layer for dispatch, GRN and every operational module, English + Marathi. Architecture, step schema, module step outlines, Marathi content rules, build sequence, maintenance rules. Read in full before writing any tutorial code.
sources: [founder-brief-sept-2026, codebase-verification-sept-10-2026, manual.html, enterprise-strategy.md]
last_updated: 10 September 2026
status: design complete — not yet built. Living document: update in place as it is built.
---

# Nexflow — Guided Tutorial Engine

**Load order for a session building this:** `_ai/CLAUDE.md` → this file → the target page's source.
`_ai/enterprise-strategy.md` is context, not a dependency.

**Status: designed, not built.** Nothing in this document exists in the codebase yet. Every
codebase fact stated here was verified against the working tree on 10 September 2026 and is
marked `[VERIFIED]` where it contradicts something a session might otherwise assume.

## Tag convention

Inherited from `enterprise-strategy.md`, unchanged.

| Tag | Meaning |
|---|---|
| `[DECIDED]` | Decided. Build it as written. Do not relitigate. |
| `[RECOMMENDED]` | This document's recommendation. Needs founder sign-off. |
| `[VERIFIED]` | Checked against the live codebase 10 Sept 2026. Safe to build on. |
| `[NEVER]` | Permanently out of scope. |

---

## 1. Executive Summary

### What this is

A guided tutorial layer built into Nexflow P2. When active, it dims the page, spotlights one
control at a time, tells the user in one sentence what to put there and why it matters, waits
until they have actually done it, and moves on. It is a game tutorial for a factory floor, in
English and Marathi.

The target is specific and it is the acceptance test for the whole feature:

> **A storekeeper with no software experience opens `grn.html` for the first time on a ₹8,000
> Android phone, in Marathi, and records a correct GRN — supplier, quantity, rate, invoice
> number, purchase type — without training, without the manual, and without phoning anyone.**

Not "can find their way around." **Correct on the first attempt.**

### Why it matters

Four reasons, in descending order of strength. The first is the only one that is also a
compliance argument, and it is the reason this is worth a real build.

1. **Data quality is a filing outcome, not a nicety.** Every downstream surface Nexflow sells —
   the CA export, GSTR-2B reconciliation, Table 12/13, the ITC-04 working paper, the Monthly AI
   Filing Package, and eventually the Bridge Agent writing into a client's statutory books — is
   built on rows a shopkeeper typed. `invoice_no` missing on a GRN row breaks GSTR-2B matching.
   A wrong `movement_purpose` on a dispatch either blocks a legitimate invoice or lets a job-work
   challan get billed as a sale. A backdated `dispatch_date` moves a challan into the wrong
   filing month. The Session 16 Opus covering note on Datta Prasad's August data found 78
   uninvoiced challans, 15 GRN lines at a 0% rate against identical 18% goods, and 1 orphan GRN
   with no supplier and no invoice number. **None of those were Nexflow bugs. Every one of them
   was a data-entry problem that a guided first entry would have prevented.** The tutorial is
   the cheapest available fix for the single largest source of wrong numbers in the product.

2. **Zero training cost, and training is the real cost of this product.** Onboarding a tenant
   today means the founder physically explaining GRN and dispatch to whoever will do it, and
   re-explaining it to their replacement six months later. That is founder time — the resource
   `enterprise-strategy.md` §7 already identifies as the binding constraint on the whole
   business. A software product that teaches itself removes an onboarding call per tenant and a
   support message per new hire, permanently.

3. **Market differentiation nobody in this segment has.** Tally requires training. Busy requires
   training. Both assume an accountant is driving. Nexflow's user is a storekeeper at a gate.
   "Your storekeeper will be doing GRNs correctly in ten minutes, and I don't have to be there"
   is a sentence no competitor in MIDC can say, and it is aimed at exactly the objection that
   kills floor-level software adoption: *"my people won't use it."*

4. **Retention through competence.** A user who learned the software inside the software owns it.
   This is the weakest of the four and should not be leaned on in a pitch — but it is real, and
   it compounds with the KPML vendor network, where every new vendor is a fresh cohort of
   untrained staff.

### The one non-negotiable property

**The tutorial can never break the page.** It runs on top of the flows that create challans,
deduct stock and generate invoices. Every engine entry point is wrapped; any internal failure
exits the tutorial silently and leaves the page fully functional. A page must behave identically
whether the engine loaded, failed to load, or crashed mid-step. This constraint outranks every
feature in this document.

### What it will cost

Three sessions to a proven engine plus the two P0 modules in both languages. Roughly one further
session per two additional modules. No new Edge Function, no new external dependency, no build
step, one small migration. Detail in §9.

---

## 2. Design Principles

These are the rules the rest of the document is derived from. A future session that finds itself
arguing with the spec should check these first — the spec is downstream of them.

1. **Teach by doing, on real data.** The tutorial walks the user through a *real* GRN and a
   *real* dispatch. No sandbox, no fake tenant, no practice mode. Rationale in ADR-9.
2. **One instruction per step. One sentence. One control.** If a step needs two sentences of
   instruction, it is two steps — or the UI is wrong and the UI should be fixed instead.
3. **Explain the consequence, not the mechanic.** "Type the client name" teaches nothing. "Type
   the client name — this is what gets printed on the challan and what the invoice is raised
   against" teaches why it must be right. The consequence line is where the data-quality value
   lives.
4. **Never re-implement validation.** The page validates. The tutorial observes. The tutorial
   never blocks a submit, never marks a value wrong, never disables a page control.
5. **Never trap the user.** Exit is visible at every step. Clicks outside the spotlight are not
   blocked by default. A user who wanders off keeps their work.
6. **Degrade to shorter, never to broken.** A step whose target cannot be found is skipped and
   logged. A tutorial whose config drifted out of date gets shorter, not wrong.
7. **Marathi is a first-class language, not a translation pass.** See §8.
8. **The engine knows nothing about which languages exist.** See ADR-3.

---

## 3. Architecture Decision Records

### ADR-1 — Declarative config, one file per page, registered as JS (not fetched JSON)

**Decision `[DECIDED]`:** each page's tutorial is a declarative array of step objects living in
`tutorials/<page>.tutorial.js`, loaded by a normal `<script>` tag and self-registering into a
global registry. Not hardcoded step sequences inside the page. Not a fetched `.json`.

**Why declarative and not hardcoded per page.** Hardcoding a step sequence into `dispatch.html`
means the tutorial logic lives inside a 1,696-line file that already carries the dispatch form,
a typeahead factory, four modals and the save workflow. Every page would reimplement spotlight
positioning, progress counting and mobile behaviour. The content and the mechanism must be
separable or this feature does not survive its second module.

**Why JS and not JSON.** Three reasons, and the third is decisive:

- A fetched `tutorials/dispatch.json` adds a round trip on factory 4G and a new failure mode
  (404 or a slow fetch → the tutorial silently never starts, with no diagnosable cause).
- A `<script>` tag matches how every other shared module in this codebase loads — there is no
  module system, no bundler and no build step `[VERIFIED]`. A new loading mechanism is a new
  thing to debug at 8am in a factory.
- **JSON cannot hold a predicate, and this app is full of conditional UI.** `#purposeFieldRow` is
  hidden unless `isJobWorker() || isPrincipal()`. `#poolFieldRow` is hidden unless
  `isJobWorker() && isSeparatePoolDeduction()`. `#ownerFieldGroup` on `grn.html` is hidden unless
  the tenant is a job worker with principals. `#challanLinksSection` appears only for return
  movement purposes `[VERIFIED — all four]`. A step targeting a hidden control must be skipped,
  and the skip condition is a live call into `js/supabase-client.js`. Expressing that in JSON
  requires inventing a mini expression language, which is strictly worse than a JavaScript
  arrow function.

**Shape:**

```js
// tutorials/dispatch.tutorial.js
NexflowTutorial.register('dispatch', {
  version: 1,
  roles: ['owner', 'supervisor', 'operator'],
  steps: [ /* … */ ]
});
```

### ADR-2 — Targeting is by `data-tutorial-target`, never by `#id` or CSS class

**Decision `[DECIDED]`:** every step targets a stable `data-tutorial-target="<module>-<thing>"`
attribute added to the page for this purpose. Configs never reference an `id`, a class, or a
structural selector.

**Why.** IDs in this codebase are functional — they are what the page's own JS queries. They get
renamed when a field is repurposed, and nothing signals that a tutorial depended on the old name.
Classes are worse: `.mat-search-input` and `.grn-row-input` are shared by many elements.
Structural selectors (`#grnRowsBody tr:first-child td:nth-child(5) input`) break on any layout
change and are unreadable.

A dedicated attribute makes the dependency **visible in the markup**. A developer editing
`grn.html` sees `data-tutorial-target="grn-row-invoice-no"` sitting on the input and knows
something depends on it. That is the entire mechanism by which this survives maintenance, and it
is why §10 can state a hard rule instead of a hope.

Two elements in the P0 scope have no markup to attach to, because they are built in JavaScript
`[VERIFIED]`:

- `dispatch.html`'s product selector is created by `buildMatTypeahead()` and mounted into
  `#productSelectMount`; the actual `<input>` has class `mat-search-input` and no id.
- `grn.html`'s material/qty/rate/invoice/purchase-type inputs are created inside
  `renderGRNRows()`, which does `tbody.innerHTML = ''` and rebuilds every row from scratch on
  every add or remove.

For these the attribute is set **at creation time in the page's own JS** (`input.dataset.tutorialTarget
= 'dispatch-product-search'`), not by the engine. The engine never mutates page DOM.

### ADR-3 — Language-agnostic content bundles, keyed by language code

**Decision `[DECIDED]`:** all human-readable content in a step is a bundle object keyed by
language code. The engine resolves it through one function and never names a language.

```js
text: { en: 'Type the client name.', mr: 'ग्राहकाचे नाव टाका.' }
```

```js
// The only place language resolution happens. Adding Hindi = adding an `hi` key.
const FALLBACK_LANG = 'en';
function tr(bundle) {
  if (bundle == null) return '';
  if (typeof bundle === 'string') return bundle;      // tolerate a bare string
  const lang = NexflowTutorial.getLang();             // localStorage 'nexflow_lang'
  return bundle[lang] ?? bundle[FALLBACK_LANG] ?? Object.values(bundle)[0] ?? '';
}
```

**This is a deliberate departure from the existing codebase pattern, and the departure is the
point.** `js/movement-purpose.js` uses flat suffixed keys — `label_en` / `label_mr` — and every
consumer writes `lang === 'mr' ? p.label_mr : p.label_en` `[VERIFIED]`. That pattern hardcodes
"there are exactly two languages" into every call site. There are today roughly a dozen such
ternaries across the HTML pages. Adding Hindi under that pattern means editing every one of them.

Under the bundle pattern, adding Hindi means:

1. adding an `hi` key to each step's `text` / `title` / `why` bundle;
2. adding an `hi` key to the engine's `UI_STRINGS` bundle (Next / Back / Skip / Exit / progress);
3. adding `'hi'` to the language toggle in `js/navbar.js`.

**Zero lines of engine code change.** `SUPPORTED_LANGS` exists in exactly one place — the lint
script (§10.3) — for completeness checking, never in the runtime resolution path.

This is a design note about future-proofing, **not a licence to build Hindi now.** Hindi is out
of scope. The requirement is that the engine does not have to be reopened when it arrives.

### ADR-4 — Completion detection observes the DOM first, page events only where it must

**Decision `[DECIDED]`:** a step advances on an observable signal, preferred in this order:

1. **A DOM effect** the page already produces (a row appears in `#productsTableBody`, a modal's
   `display` flips to `flex`, an input holds a value). Requires zero page changes.
2. **A native event** on the target (`click`, `change`, `input`).
3. **A page-emitted lifecycle signal** — one line added to the page, used only where no DOM
   effect exists (typically "the async save actually succeeded").

**Why DOM-first.** `#addProductBtn`'s click handler validates and returns early if no product is
selected `[VERIFIED]`. A step that advanced on the click would advance on a failed click and
leave the user staring at an error with the tutorial already moved on. A step that advances on
"a new `<tr>` appeared in `#productsTableBody`" advances only when the product actually landed.
**Observe the outcome, not the attempt.** Apply this rule to every step where the two differ.

**The one event contract.** Pages that need it emit exactly one event type, with the milestone in
`detail.name`:

```js
document.dispatchEvent(new CustomEvent('nexflow:tutorial-signal', {
  detail: { name: 'dispatch:confirmed', meta: { challan_number: challanNumber } }
}));
```

One event name means one listener in the engine and one thing for a page author to remember.
Emitting it when no tutorial is running costs nothing.

### ADR-5 — Anchors are re-resolved continuously, not captured once

**Decision `[DECIDED]`:** the engine holds the target's *selector string*, never a node
reference. Position is recomputed from a fresh `document.querySelector` on every reposition tick.

**Why.** `grn.html`'s `renderGRNRows()` destroys and recreates every row input on every add-row
`[VERIFIED]`. A captured node reference would point at a detached element the moment the user
adds a second material — the spotlight would freeze over empty space with no error. Because
targeting is by attribute (ADR-2), re-querying transparently finds the replacement node.

Repositioning is driven by a single coalesced loop fed by: one `MutationObserver` on
`document.body` (`childList` + `subtree` + relevant `attributes`), one `ResizeObserver` on the
current anchor, and `scroll` / `resize` / `visualViewport.resize` listeners — **all owned by one
teardown registry that is emptied on every step transition and on exit.**

This is not a theoretical concern. Listener leaks on exactly these pages — `grn.html`,
`dispatch.html`, `rm-dispatch.html`, `production-issue.html`, leaking on every row add/remove and
every modal open — were a shipped P2 bug fixed on 17 Aug 2026 `[VERIFIED, CLAUDE.md]`. The engine
must not reintroduce the same class of bug on the same four pages.

### ADR-6 — Spotlight by box-shadow ring; clicks pass through by default

**Decision `[DECIDED]`:** one absolutely-positioned `<div>` sized to the target's rect, with
`pointer-events: none` and `box-shadow: 0 0 0 100vmax rgba(0,0,0,0.62)`. The shadow dims the
entire viewport; the div's own area stays clear.

**Why not `clip-path`.** A polygon `clip-path` with `evenodd` achieves the same visual, but
repaints are heavier on the low-end Android GPUs this product actually runs on, and support on
old WebViews is less certain. `box-shadow` is universally supported and cheap.

**Why clicks pass through by default.** The user is *performing a real dispatch*. They must be
able to reach any control at any time — to fix a typo three fields back, to scroll, to close an
accidental modal. A modal tutorial that traps a factory worker inside a step is worse than no
tutorial. Per-step opt-in `blockOutside: true` is available for the rare step where a stray click
genuinely destroys the flow; it renders four `pointer-events: auto` blocker rects around the hole
rather than one full-screen blocker, so the hole stays live.

Reduced motion is already handled globally — `css/nexflow-design.css` carries a
`@media (prefers-reduced-motion: reduce)` block that neutralises all transitions `[VERIFIED]`.
The engine adds no looping animation; the entry pulse fires once per step.

### ADR-7 — Three-layer state: tenant default, per-user progress row, localStorage cache

**Decision `[DECIDED]`:**

| Layer | Where | Holds | Written |
|---|---|---|---|
| Tenant default | `p2_tenant_settings.tutorial_mode` | `auto` \| `always` \| `off` | Owner, in Settings |
| Per-user progress | **new** `p2_tutorial_progress` | status, last step, completion count | On start / complete / exit |
| In-flight position | `localStorage` | current step id, timestamp | Every step transition |

**Why not localStorage alone.** It is per-device. A storekeeper who uses the shop phone and then
their own gets the tutorial twice. Clearing browser data loses it. Most importantly it cannot
express the actual business requirement — *the owner decides that a new hire gets tutorials* —
because a per-device flag has no idea who the owner is or that a new hire exists.

**Why not `p2_tenant_settings` alone.** One row per tenant. Five staff would overwrite each
other's progress. It is correct for the tenant-wide *default* and wrong for per-user state.

**Why not `p2_user_roles`.** It is the natural per-user row, and it is the wrong answer.
`p2_user_roles` has SELECT (tenant-wide), INSERT and DELETE policies and **no UPDATE policy at
all** `[VERIFIED — 20260803_pending_invites_and_role_fixes.sql, 20260904_fix_staff_rls_write_policies.sql:181]`.
Adding one to store tutorial state would open an UPDATE path on the table that holds `role`.
Unless that write were funnelled through a column-restricted `SECURITY DEFINER` RPC, a staff
member could rewrite their own role — a privilege-escalation hole opened for a progress counter.
The cost/benefit is not close. **Do not add an UPDATE policy to `p2_user_roles` for this or any
other convenience.**

**Why localStorage is still in the design.** Writing a DB row on every step transition puts
network latency between a user tapping Next and the next instruction appearing — on the exact
connection where that latency is worst. The in-flight position is cached locally and flushed to
the DB three times per run (start, complete/exit). This mirrors an existing precedent: the
Physical Stock Count screen autosaves counts to
`nexflow_stockcount_${tenantId}_${todayIST()}_${poolKey}` and writes to the DB only on post
`[VERIFIED, Session 7]`. Same shape, same reasoning.

### ADR-8 — The engine injects its own CSS; no new stylesheet file

**Decision `[DECIDED]`:** `js/tutorial-engine.js` injects a `<style>` block once on first
activation, exactly as `js/navbar.js` does `[VERIFIED]`. `css/nexflow-design.css` is not touched.
All colours come from the existing custom properties (`--orange`, `--surface`, `--border2`,
`--text`, `--mid`) so the tutorial inherits the design system for free and cannot drift from it.

### ADR-9 — The tutorial operates on real data. No sandbox mode. `[DECIDED]`

A guided dispatch creates a real challan and deducts real stock. A guided GRN creates real
inventory.

**Rejected alternative:** a practice mode writing to a throwaway tenant. Rejected because it
doubles the surface area (every write path needs a sandbox branch — the exact "customer-specific
logic" shape the product forbids), and because it destroys the value: the point is that *the
first real dispatch is correct*, not that a fake one was. A practice run also teaches a user that
their entries do not matter, which is precisely the wrong lesson for the data-quality goal in §1.

**Consequence, and it is mandatory:** step 1 of any write-flow tutorial says so plainly.
*"We'll do a real dispatch together. At the end this will print a real challan and reduce your
stock."* / *"आपण खरोखरचा एक डिस्पॅच करू. शेवटी खरे चलान छापले जाईल आणि स्टॉक कमी होईल."*

### ADR-10 — Tutorial-enabled pages emit one readiness call; the engine never guesses

**Decision `[DECIDED]`:** a page ends its successful `init()` with one line:

```js
NexflowTutorial.pageReady('dispatch');
```

**Why not `DOMContentLoaded`.** `dispatch.html`'s `init()` is async and races a 10-second timeout
against four parallel loads, then mounts the product typeahead, then shows the form, then calls
`setupEventHandlers()` `[VERIFIED]`. At `DOMContentLoaded` the form is still `display:none`, the
typeahead does not exist, and no handler is bound. Auto-starting there guarantees a tutorial
pointing at nothing. `pageReady()` is called only on the success path, so a page that failed to
load never starts a tutorial — which is also the correct behaviour.

### ADR-11 — Layer at z-index 9000/9001; the 9999 tier is explicitly out of reach

**Decision `[DECIDED]`.** Verified z-index map of the running app:

| Layer | z-index |
|---|---|
| Page content, sticky bars | ≤ 300 |
| Drawer overlay / drawer / navbar / notif panel | 398 / 399 / 400 / 401 |
| Page modal overlays (`.nx-modal-overlay`), agent FAB + panel | 500 |
| Toast wrap | 999 |
| **Tutorial dim + blockers / bubble** | **9000 / 9001** |
| Nested modals: amend, hard-delete, `showUpgradePrompt()` | 9999–10000 |

9000 puts the tutorial above page modals — required, since dispatch's confirm and consumption
modals and GRN's supplier and duplicate-invoice modals are all steps — and above toasts.

**Stated limitation:** the tutorial cannot guide *inside* a 9999-tier modal. Those are the amend,
hard-delete and Pro-upgrade flows — advanced or terminal actions, none of which are in any planned
tutorial. If a 9999 modal appears while a tutorial is running (most plausibly
`#nx-upgrade-modal`), the engine detects it and **exits the tutorial cleanly** rather than sitting
invisibly underneath it.

**Toast collision:** on viewports under 600px the bubble is a bottom sheet and `.nx-toast-wrap`
is bottom-right. The engine sets `document.body.classList.add('nxt-active')` and its injected CSS
lifts the toast wrap above the sheet for the duration. Errors must stay visible — they are how
the user learns.

### ADR-12 — Marathi is authored, reviewed and read aloud; never machine-translated `[DECIDED]`

See §8 for the full rules. Recorded here because it is an architecture-level constraint on the
build schedule, not a content preference: **a module ships in English first and in Marathi only
after a native speaker in the MIDC context has written and voiced the strings.** The build
sequence in §9 is shaped around that gate.

---

## 4. Technical Specification

### 4.1 Files

| Path | New? | Purpose |
|---|---|---|
| `js/tutorial-engine.js` | new | The engine. Bare-global IIFE exposing `window.NexflowTutorial`. Self-contained: no dependency on any other Nexflow JS except optional reads of `getUserRole()` / `isJobWorker()` from configs. |
| `tutorials/dispatch.tutorial.js` | new | Dispatch step config. |
| `tutorials/grn.tutorial.js` | new | GRN step config. |
| `tutorials/<page>.tutorial.js` | new, per module | One per covered page. |
| `_ai/regression/tutorial-lint.js` | new | Config↔markup consistency checker (§10.3). |
| `supabase/migrations/20260911_tutorial_engine.sql` | new | `tutorial_mode` column + `p2_tutorial_progress` table. |

Page-side changes per covered page: script tags, `data-tutorial-target` attributes, one
`pageReady()` call, a "Show me how" button, and zero-to-two `nexflow:tutorial-signal` emissions.
**No page's existing behaviour changes.**

Load order in `<head>`, after `js/navbar.js`:

```html
<script src="js/tutorial-engine.js"></script>
<script src="tutorials/dispatch.tutorial.js"></script>
```

The config file may load before or after the engine — `NexflowTutorial.register()` queues into a
pre-created global if the engine has not yet defined itself. Keep the engine first anyway.

### 4.2 Public API

```js
window.NexflowTutorial = {
  register(moduleId, config),        // called by tutorials/*.tutorial.js
  pageReady(moduleId),               // called by the page at the end of a successful init()
  start(moduleId, { resume=true }),  // manual launch — the "Show me how" button
  exit(reason),                      // 'user' | 'error' | 'blocked' | 'navigate'
  isActive(),
  getLang(),                         // localStorage 'nexflow_lang', default 'en'
  onLanguageChange(lang),            // re-renders current step in the new language
  signal(name, meta)                 // convenience wrapper over the CustomEvent
};
```

### 4.3 Lifecycle

```
page init() succeeds
  └─ NexflowTutorial.pageReady('dispatch')
       ├─ config registered for this module?          no → return silently
       ├─ user's role in config.roles?                no → return (still allow manual start)
       ├─ window.isDemo === true?                     yes → demo mode (§4.9)
       ├─ resolve state:
       │    tenant_mode  = p2_tenant_settings.tutorial_mode     (cached from checkAuth)
       │    progress     = p2_tutorial_progress row for (user, module)
       │    local        = localStorage in-flight position
       ├─ tenant_mode === 'off'                        → return
       ├─ tenant_mode === 'auto' && progress.completed → return   (power-user state)
       ├─ sessionStorage guard already set this tab?   → return
       └─ wait 600ms for layout to settle → start()

start()
  ├─ build applicable step list  (filter by when(), see §4.5)
  ├─ resume offer if local position < 24h old and status === 'in_progress'
  ├─ write p2_tutorial_progress {status:'in_progress'}   (fire-and-forget)
  ├─ inject CSS + DOM (once), set body.nxt-active
  └─ enterStep(0)

enterStep(i)
  ├─ teardown previous step's listeners/observers   (single registry, always)
  ├─ resolve target  (retry loop, §4.4)
  │     not found within budget → log, skip to i+1
  ├─ run step.onEnter?.()
  ├─ scroll target into view (mobile: upper third; desktop: centred)
  ├─ position hole + bubble, render text in current language
  ├─ arm advanceOn watchers
  └─ write localStorage position

advance()  → enterStep(i+1)   |   last step → complete()

complete()
  ├─ render completion card
  ├─ write p2_tutorial_progress {status:'completed', completed_at, times_completed+1}
  ├─ clear localStorage position
  └─ teardown everything, remove body.nxt-active

exit(reason)
  ├─ write p2_tutorial_progress {status:'exited', last_step_id}
  ├─ keep localStorage position (enables resume)
  └─ teardown everything
```

Every one of these is individually wrapped. A throw anywhere calls `exit('error')`, logs to
`console.warn`, and leaves the page untouched.

### 4.4 Target resolution

```js
function resolveTarget(step) {
  const sel = `[data-tutorial-target="${step.target}"]`;
  const el = document.querySelector(sel);
  if (!el) return null;
  const r = el.getBoundingClientRect();
  if (r.width === 0 && r.height === 0) return null;   // present but hidden
  return el;
}
```

If it returns null, retry on `requestAnimationFrame` for up to **5 seconds** (configurable per
step via `waitFor.timeoutMs` for genuinely slow loads). On timeout:

- log `[tutorial] step "<id>" target "<target>" not found — skipping`;
- record a skip in the run's telemetry;
- advance to the next step.

**Never** show an error to the user, and **never** stall. A stale config produces a shorter
tutorial. This is the property that makes the maintenance rule in §10 survivable.

### 4.5 Applicability — `when`

`when` is evaluated at `start()` to build the initial list, and **re-evaluated on every
transition**, because a user action can make a later step applicable. Concrete case: selecting a
return `movement_purpose` on `dispatch.html` reveals `#challanLinksSection`, which is a step that
did not apply when the tutorial started `[VERIFIED — toggleChallanLinksSection()]`.

Consequence: the denominator in "Step 3 of 9" can grow mid-run. That is correct and preferable to
either hiding a now-relevant step or showing an unreachable one. The progress rail animates the
change rather than snapping.

### 4.6 Advancement — `advanceOn` types

| `type` | Fires when | Auto-advances? |
|---|---|---|
| `manual` | User presses Next | n/a — Next always enabled |
| `input` | Target's value is non-empty (`minLength` respected), on `input`/`change`/`blur`, debounced 250ms | **No** — shows a green tick, enables Next |
| `change` | Target `select`'s value differs from its value at step entry | Yes, 350ms beat |
| `click` | `click` on target | Yes, 350ms beat |
| `dom` | `selector` matches `condition` (`exists`, `visible`, `countAtLeast: n`) | Yes, 350ms beat |
| `event` | `nexflow:tutorial-signal` with matching `detail.name` | Yes, immediate |

**Why `input` never auto-advances.** Auto-advancing per keystroke means typing "Kirloskar" jumps
the tutorial after "K". The green tick plus an enabled Next gives the user control and still
feels responsive. Click and DOM steps auto-advance because the action is discrete and the user
has already committed.

**Prefer `dom` over `click` wherever the outcome and the attempt differ.** Both P0 modules have
this case: `#addProductBtn` and `#addRowBtn` both validate and can no-op.

### 4.7 Dynamic content

| Situation | Mechanism |
|---|---|
| Element created after page load (typeahead mount) | Retry loop (§4.4) + `MutationObserver` |
| Element destroyed and recreated (`renderGRNRows()` wiping `tbody`) | Attribute targeting + continuous re-resolve (ADR-5) |
| Row added, so the target moves down the page | `MutationObserver` → coalesced reposition |
| Modal opens over the page | Modal contents carry their own `data-tutorial-target`; the step targets them directly. Engine z-index 9000 sits above the 500-tier overlay (ADR-11) |
| Async fetch completes | `dom` advanceOn watching the effect, or an `event` signal |
| Element scrolled out of view | `scroll` listener → reposition; if the target leaves the viewport entirely, the bubble docks and gains a "↓ Scroll to it" affordance rather than following off-screen |

All observers are coalesced through a single `requestAnimationFrame` tick — never one callback
per mutation. `grn.html` re-renders every row on every keystroke-free row add; an uncoalesced
observer would fire dozens of times per interaction.

### 4.8 Mobile

**Correction to a common assumption, verified:** Nexflow has **no mobile bottom nav.** The mobile
layout is a fixed top navbar (56px, 52px below 480px) plus a **left slide-in drawer** opened by a
hamburger, at the `max-width: 900px` breakpoint. Overlay z-398, drawer z-399, navbar z-400
`[VERIFIED — js/navbar.js]`. Any design that assumed a bottom bar is wrong.

Rules:

1. **Bubble becomes a bottom sheet below 600px.** Full-width minus 12px gutters, rounded top
   corners, max-height 45vh, its own scroll. A floating tooltip beside a full-width input on a
   360px screen has nowhere to go.
2. **Scroll target to the upper third, not the centre**, so the sheet does not cover it.
3. **Clamp the bubble's top edge to `navbarHeight + 8px`** in desktop/floating mode. The navbar is
   fixed; a bubble placed above an element near the top of the page would render underneath it.
4. **Keyboard handling.** When an `input`-type step is active and `window.visualViewport` reports
   a viewport shorter than 65% of `window.innerHeight`, the keyboard is open: the sheet moves to
   the **top slot** (directly under the navbar) and the target scrolls to just below it. Listen to
   `visualViewport.resize`; fall back to a `focus`/`blur` heuristic where `visualViewport` is
   absent.
5. **Steps that target navigation** set `onEnter` to open the drawer on mobile only, and
   `onExit` to close it.
6. **Tap targets in the bubble are ≥44px.** Buttons stack full-width below 400px.
7. **Test on a real device.** Android WebView keyboard behaviour is not reproducible in desktop
   devtools. This is flagged as the highest-risk unknown in §9.3.

### 4.9 Demo mode

`js/utils.js` sets `window.isDemo` from `sessionStorage.nexflow_is_demo`, and
`applyDemoModeToForms()` attaches a capture-phase handler that `preventDefault()`s **every** form
submit and disables save/add/confirm buttons `[VERIFIED]`.

A write-flow tutorial in demo mode would wait forever on a click that is blocked before it
happens. The engine must detect `window.isDemo === true` and switch to **demo narration mode**:

- every step's `advanceOn` is downgraded to `manual`;
- the bubble shows a persistent chip: *"Demo — nothing will be saved."*;
- action steps say *"On a real account you'd press this"* instead of *"Press this"*;
- no progress row is written.

This makes the tutorial a genuinely good product demo on the landing-page demo account, at
almost zero cost. Do not skip it — it is the cheapest sales asset in this document.

### 4.10 Failure modes

| Failure | Behaviour |
|---|---|
| Engine script fails to load | Configs queue into a stub; nothing happens; page unaffected |
| Config has a syntax error | That module has no tutorial; every other page unaffected |
| Target never resolves | Step skipped and logged (§4.4) |
| Page throws mid-tutorial | Unrelated — engine keeps running; user can exit |
| Engine throws | `exit('error')`, silent to the user, `console.warn` with the step id |
| `p2_tutorial_progress` write fails | Swallowed. localStorage still holds position. Tutorial unaffected |
| 9999-tier modal appears | `exit('blocked')` |
| User navigates away | `beforeunload` → `exit('navigate')`, position preserved |
| Language toggled mid-step | Current step re-renders in the new language, position preserved |

### 4.11 Language switching mid-tutorial

`js/navbar.js`'s language toggle calls `window.applyLang(lang)` when the page defines it, and
falls back to a generic `[data-en]` loop otherwise `[VERIFIED]`. There is no event.

`[RECOMMENDED]` **Add one line to `js/navbar.js`'s toggle handler:**

```js
document.dispatchEvent(new CustomEvent('nexflow:langchange', { detail: { lang: next } }));
```

The engine listens for it. This is a one-line, zero-risk change to a shared file and it is the
clean solution.

**Zero-touch fallback** if that change is deferred: the engine wraps the global on activation —

```js
const prevApplyLang = window.applyLang;
window.applyLang = function (l) { try { prevApplyLang?.(l); } finally { NexflowTutorial.onLanguageChange(l); } };
```

Safe, because navbar guards with `if (window.applyLang)`. Ugly, because it monkey-patches a
global. Prefer the event. A `localStorage` poll on each render is the last-resort backstop and
catches the case where neither hook fires.

**Note for whoever wires this:** `js/lang.js` exists in the repo and is **loaded by no page**
**[VERIFIED — zero `lang.js` script tags across all 30 HTML files]**. It is a dead file with an ES
`export` in a codebase that has no module system. Every page defines its own `applyLang`. Do not
build against `js/lang.js`, and do not "fix" it as part of this work.

---

## 5. Step Definition Schema

### 5.1 Full schema

```js
{
  // ── identity ────────────────────────────────────────────────────────────
  id: 'client-name',              // REQUIRED. Stable forever. Used for resume + telemetry.
                                  // Never renumber. Inserting a step must not shift ids.

  // ── targeting ───────────────────────────────────────────────────────────
  target: 'dispatch-client-name', // REQUIRED unless kind:'card'. Value of data-tutorial-target.
  placement: 'auto',              // 'auto'|'top'|'bottom'|'left'|'right'. Ignored on mobile sheet.
  padding: 6,                     // px of spotlight padding around the rect.
  kind: 'step',                   // 'step' | 'card' (card = centred panel, no target: intro/outro)

  // ── content (all language bundles) ───────────────────────────────────────
  title: { en: 'Client name',      mr: 'ग्राहकाचे नाव' },
  text:  { en: 'Type who you are sending these goods to.',
           mr: 'हा माल तुम्ही कोणाला पाठवत आहात ते टाका.' },
  why:   { en: 'This name is printed on the challan and is who the invoice is raised against.',
           mr: 'हेच नाव चलानावर छापले जाते आणि याच नावावर इनव्हॉइस निघते.' },
  onError: { en: '…', mr: '…' },  // optional. Shown if the action was attempted but did not land.
  audio: { mr: 'audio/mr/dispatch-01.mp3' },  // RESERVED. Ignored by v1. See §8.5.

  // ── behaviour ───────────────────────────────────────────────────────────
  advanceOn: { type: 'input', minLength: 2 },
  optional: false,                // true → 'Optional' chip + a 'Skip this' button
  blockOutside: false,            // true → clicks outside the spotlight are blocked
  when: () => isJobWorker(),      // optional predicate; false → step omitted entirely
  waitFor: { timeoutMs: 5000 },   // optional; overrides the default resolve budget

  // ── hooks (optional, must not throw) ─────────────────────────────────────
  onEnter: () => {},
  onExit:  () => {}
}
```

### 5.2 `advanceOn` variants

```js
{ type: 'manual' }
{ type: 'input',  minLength: 2 }                                  // on the step's own target
{ type: 'change' }                                                // select changed from entry value
{ type: 'click' }
{ type: 'dom', selector: '#productsTableBody tr', condition: 'countAtLeast', value: 1 }
{ type: 'dom', selector: '#confirmModal',         condition: 'visible' }
{ type: 'event', name: 'dispatch:confirmed' }
```

### 5.3 Module config

```js
NexflowTutorial.register('dispatch', {
  version: 1,                                       // bump when steps change materially
  roles: ['owner', 'supervisor', 'operator'],       // who may auto-start; others manual-only
  title: { en: 'Sending goods out', mr: 'माल बाहेर पाठवणे' },
  intro: { en: "We'll do a real dispatch together. At the end this prints a real challan and reduces your stock.",
           mr: 'आपण खरोखरचा एक डिस्पॅच करू. शेवटी खरे चलान छापले जाईल आणि स्टॉक कमी होईल.' },
  steps: [ /* … */ ]
});
```

### 5.4 A complete worked step, with the two hard cases

```js
// Case A — element built by JS at runtime (dispatch.html buildMatTypeahead).
// dispatch.html must set the attribute at creation:
//     input.dataset.tutorialTarget = 'dispatch-product-search';
// inside buildMatTypeahead(), guarded by an opts flag so rm-dispatch's and the
// amend modal's typeaheads do not all claim the same target name.
{
  id: 'product-search',
  target: 'dispatch-product-search',
  title: { en: 'Pick the product',  mr: 'उत्पादन निवडा' },
  text:  { en: 'Start typing the product name or its code, then tap it in the list.',
           mr: 'उत्पादनाचे नाव किंवा कोड टाईप करा, मग यादीतून त्यावर टॅप करा.' },
  why:   { en: 'Picking from the list links the dispatch to the right BOM, so the right raw materials come out of stock.',
           mr: 'यादीतून निवडल्यावरच बरोबर BOM जोडले जाते आणि योग्य कच्चा माल स्टॉकमधून कमी होतो.' },
  advanceOn: { type: 'input', minLength: 1 }
},

// Case B — the outcome differs from the attempt. Watch the outcome (ADR-4).
// #addProductBtn's handler validates and returns early with an error toast if
// no product is selected, so a click-advance would advance on a failed click.
{
  id: 'add-product',
  target: 'dispatch-add-product',
  title: { en: 'Add it to the list', mr: 'यादीत जोडा' },
  text:  { en: 'Press "उत्पादन जोडा" to add this product to the challan.',
           mr: '"उत्पादन जोडा" दाबा — हे उत्पादन चलानाच्या यादीत जाईल.' },
  onError: { en: 'Nothing was added — pick a product from the list first, then enter a quantity.',
             mr: 'काहीच जोडले गेले नाही — आधी यादीतून उत्पादन निवडा, मग परिमाण टाका.' },
  advanceOn: { type: 'dom', selector: '#productsTableBody tr', condition: 'countAtLeast', value: 1 }
}
```

Note in Case B: the English `text` names the button by the label the user is *currently seeing*.
That is the single most important Marathi rule and it is stated properly in §8.2.

---

## 6. Data Model, Toggle and Auto-start

### 6.1 Migration

`supabase/migrations/20260911_tutorial_engine.sql`

```sql
-- Guided tutorial engine. Tenant-wide default + per-user per-module progress.
-- Deliberately NOT stored on p2_user_roles: that table has no UPDATE policy
-- (20260904_fix_staff_rls_write_policies.sql:181 — INSERT only, by design),
-- and adding one would open a write path on the column that holds `role`.
-- RLS shape copied from p2_notifications, the reference implementation:
-- three command-scoped policies on get_my_tenant_id(), no DELETE, RLS
-- explicitly enabled in this same migration.

ALTER TABLE p2_tenant_settings
  ADD COLUMN IF NOT EXISTS tutorial_mode text NOT NULL DEFAULT 'auto'
    CHECK (tutorial_mode IN ('auto','always','off'));

CREATE TABLE IF NOT EXISTS p2_tutorial_progress (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid NOT NULL,
  user_id          uuid NOT NULL REFERENCES auth.users(id),
  module_id        text NOT NULL,          -- 'dispatch' | 'grn' | …
  status           text NOT NULL DEFAULT 'in_progress'
                     CHECK (status IN ('in_progress','completed','exited')),
  last_step_id     text,
  times_completed  integer NOT NULL DEFAULT 0,
  completed_at     timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, user_id, module_id)
);

ALTER TABLE p2_tutorial_progress ENABLE ROW LEVEL SECURITY;

CREATE POLICY p2_tutorial_progress_select ON p2_tutorial_progress
  FOR SELECT USING (tenant_id = get_my_tenant_id());
CREATE POLICY p2_tutorial_progress_insert ON p2_tutorial_progress
  FOR INSERT WITH CHECK (tenant_id = get_my_tenant_id());
CREATE POLICY p2_tutorial_progress_update ON p2_tutorial_progress
  FOR UPDATE USING (tenant_id = get_my_tenant_id())
             WITH CHECK (tenant_id = get_my_tenant_id());
-- No DELETE policy, deliberately. Same as p2_notifications.

CREATE INDEX IF NOT EXISTS p2_tutorial_progress_tenant_user_idx
  ON p2_tutorial_progress (tenant_id, user_id);

-- tenant_id is passed EXPLICITLY by the client on every insert. No set_tenant_id()
-- trigger is attached to this table — same decision and same reasoning as
-- p2_notifications (CLAUDE.md, Step 4).

-- Run in the Supabase SQL Editor as the postgres role — never `supabase db push`.
-- Test tenant first: fe2b94fb-9668-405f-9c62-5f54b32f8c7a
-- Do NOT run against SS Engineering (5ab7fb07), Datta Prasad (3b68db90),
-- Shivprasad (6fe0680a) or Demo (5f021c96) until verified on the test tenant.
```

`tutorial_mode` is added to the `select` list in `checkAuth()` (`js/supabase-client.js`) alongside
`plan`, `is_job_worker`, `is_principal`, `separate_pool_deduction`, and exposed as
`getTutorialMode()` — same shape as the existing `isJobWorker()` accessor, cached per page load,
never persisted to localStorage (same anti-staleness reasoning as those flags).

### 6.2 The three modes

| Mode | Behaviour | For |
|---|---|---|
| `auto` **(default)** | Auto-starts a module's tutorial the first time that user opens that page; stops once they complete it. Manual launch always available. | Everybody, normally |
| `always` | Auto-starts every time, regardless of completion. | Training weeks; the demo tenant; a tenant with high staff churn |
| `off` | Never auto-starts. The "Show me how" button remains. | Experienced tenants who asked |

**`off` never removes the manual launcher.** Turning off auto-start and removing help are
different requests and must not be conflated.

### 6.3 Who sets it

- **Owner, tenant-wide**, on the Settings → Company Details tab: a three-way selector. Placed
  under the existing **"⚙ Advanced settings"** gate once the owner's own tutorials are complete —
  the same "hide it once it's understood" pattern `is_job_work_setup_seen` already establishes
  `[VERIFIED]`.
- **Per staff member**, on the existing Settings → Staff Members table: one added column showing
  progress (`— / In progress / ✓ Done`, per module) and a per-row **"Reset tutorials"** action
  that deletes… no: that sets every row for that user to `in_progress` with a null `last_step_id`
  (there is no DELETE policy, deliberately). This is the concrete answer to *"my new storekeeper
  starts Monday."*
- **The user themselves** cannot turn tutorials off tenant-wide. They can exit any run and use
  "Don't show this again" on the completion card, which writes their own completion row. That is
  the right split: the owner owns the policy, the user owns their own progress.

### 6.4 Auto-start guard rails

All must hold, or auto-start does not fire:

1. `pageReady()` was called (i.e. the page loaded successfully) — ADR-10.
2. `tutorial_mode !== 'off'`.
3. `mode === 'always'` **or** no `completed` row for this (user, module).
4. The user's role is in `config.roles` — never auto-start a tutorial for an action the role
   cannot perform. `js/roles.js` `ROLE_PERMISSIONS` is the source of truth.
5. No sessionStorage guard `nxt_started_<module>` for this tab — one auto-start per module per
   tab, so a refresh mid-form does not restart the tutorial.
6. No 9999-tier modal is open.
7. 600ms have passed since `pageReady()` — lets the fade-in and any late layout settle.

### 6.5 Resume

On manual `start()` or auto-start, if localStorage holds an in-flight position for this
(user, module) that is **less than 24 hours old** and status is `in_progress`, the engine offers a
card: *"Continue from step 4?" / "Start from the beginning"*. Past 24 hours the position is
discarded silently — a half-finished dispatch form is long gone by then, so resuming into step 9
would spotlight an empty field.

---

## 7. Module Coverage and Priority

### 7.1 Ranking

Ranked by *(daily frequency) × (steps to get wrong) × (cost of getting it wrong) × (how
inexperienced the operator is)*.

| Pri | Module | Who | Why here |
|---|---|---|---|
| **P0** | `dispatch.html` | supervisor, operator, owner | Highest step count, most conditional UI, feeds challan + invoice + Table 13 + Bridge Agent Sales vouchers. Also the hardest page in the app — building it first proves the engine against the worst case. |
| **P0** | `grn.html` | **storekeeper** | Least experienced user in the building, on a phone, at the gate. Owns `invoice_no` and `purchase_type`, the two fields GSTR-2B reconciliation and the CA export key off. **Highest data-integrity stakes of any page.** |
| **P1** | `production-issue.html` | supervisor, operator | Daily. Consumption is where stock silently goes wrong. WIP panel is genuinely non-obvious. |
| **P1** | `index.html` (orientation) | everyone | 3–4 steps, no writes. The first screen anyone sees; teaches the navbar, the stock table and where to go next. Cheap and high-leverage. |
| **P1** | `scanner.html` | storekeeper | Pro only, mobile-only workflow, entirely gesture-driven. Note its own-stock-only constraint must be *taught*, not just enforced. |
| **P2** | `rm-dispatch.html` | supervisor, operator | Mirrors dispatch; most steps are a near-copy. Cheap once dispatch exists. |
| **P2** | `invoices.html` | owner, accountant | Record Payment / TDS field order is genuinely confusing and was reworked in Session 2 for that reason. |
| **P2** | `products.html` | owner, supervisor | BOM entry. Low frequency, but a wrong BOM silently corrupts every consumption calculation downstream. |
| **P3** | `settings.html` onboarding | owner | One-time. Overlaps `onboarding.html`; sequence that first. |
| **P3** | `reports.html` → Physical Stock Count | owner, supervisor | Periodic; the overlay is already fairly guided. |
| **P3** | `all-dispatch-history.html` | owner, supervisor | Cancel/amend/generate-invoice are consequential but infrequent and role-gated. |
| **`[NEVER]`** | `export.html`, `gstr2b-reconcile.html`, `itc04-workingpaper.html`, `principal-dashboard.html`, `ca-report.html` | CA / accountant | CA-facing, expert users, **English-only by standing decision** (`CLAUDE.md`: "export.html is deliberately EXCLUDED from translation"). Building a Marathi tutorial for a GSTR-1 workbook is effort spent in the wrong place. These pages get manual documentation, not tutorials. |

**A note on P0 ordering.** Building `dispatch.html` first is right *for the engine* — it has the
JS-mounted typeahead, two conditional field rows, a dynamically-rendered item table, two chained
modals and an async save, so it exercises every mechanism in §4. But **`grn.html` is the page
where a mistake costs the most money**, and it belongs to the least experienced user. Ship them in
the same fortnight. Do not let GRN slip to "later."

### 7.2 `dispatch.html` — step outline

Verified against the live DOM. Conditional steps are marked; a plain non-job-worker tenant sees
**9 steps**, a KPML job worker with separate pool deduction sees **12**.

| # | id | target | Type | Instruction (EN) | Why (EN) |
|---|---|---|---|---|---|
| 0 | `intro` | — (card) | manual | We'll send goods to a customer and print a challan together. About 9 steps. | This creates a real challan and reduces your stock. |
| 1 | `client-name` | `dispatch-client-name` | input | Type who you're sending the goods to. If you've sent to them before, pick them from the list. | This name is printed on the challan and is who the invoice is raised against. |
| 2 | `client-address` | `dispatch-client-address` | input | Check the address. If this client is saved, it filled in by itself — read it before moving on. | A wrong address on a challan is a problem at the customer's gate, not yours. |
| 3 | `po-number` | `dispatch-po-number` | input, **optional** | If the customer gave you a PO number, put it here. | Their store matches your challan against this number. No PO, no gate entry, at most factories. |
| 4 | `date-transport` | `dispatch-date` | manual | Today's date is already filled. Change it only if the truck actually left on a different day. | The date decides which month this challan is counted in for GST. |
| 5 | `purpose` | `dispatch-purpose` | change — `when: isJobWorker() \|\| isPrincipal()` | Choose why this material is going out. | **This is the most important box on this page.** "Sale" means you can raise an invoice. Job-work purposes mean you cannot — and Nexflow will stop you, to keep your GSTR-1 correct. |
| 6 | `pool` | `dispatch-pool` | change — `when: isJobWorker() && isSeparatePoolDeduction()` | Choose whose stock this comes out of — your own, or your principal's. | Deducting from the wrong pool breaks your ITC-04 and the principal's s.143 position. |
| 7 | `product-search` | `dispatch-product-search` | input | Type the product name or code, then tap it in the list. | Picking from the list links the right BOM, so the right raw materials come out of stock. |
| 8 | `qty` | `dispatch-qty` | input | How many are you sending? | Nexflow will deduct raw material for exactly this many. |
| 9 | `add-product` | `dispatch-add-product` | **dom** `#productsTableBody tr ≥ 1` | Press "Add Product". | Adding it to the list is what puts it on the challan. Nothing is sent until it is in this list. |
| 10 | `items-table` | `dispatch-items-table` | manual | Here's your challan list. You can set a PO per line, or remove a line with ✕. Add more products the same way. | Everything in this list goes on one challan with one challan number. |
| 11 | `challan-links` | `dispatch-challan-links` | manual, **optional** — `when:` return purpose selected | Link this return to the original challan it came in on. | Without this link, your ITC-04 cannot show which outward challan this return settles. |
| 12 | `confirm-btn` | `dispatch-confirm` | **dom** `#confirmModal visible` | Press "Confirm Dispatch". | Nothing has been saved yet — this opens a check screen first. |
| 13 | `confirm-modal` | `dispatch-confirm-modal-confirm` | **event** `dispatch:confirmed` | Read the list once. If it's right, press "Confirm". | This is the last stop. After this, stock is deducted and the challan number is used up — it cannot be undone. |
| 14 | `consumption` | `dispatch-consumption-print` | manual | This shows what came out of stock, and warns you if anything dropped below its minimum. Press "Print Challan". | This is your proof of what left the factory. Print it before the truck goes. |
| 15 | `done` | — (card) | complete | Done — challan {n} is created. | — |

Page changes required for this module:

- 12 `data-tutorial-target` attributes in the markup.
- 1 attribute set in JS: `buildMatTypeahead()` must accept a `tutorialTarget` option and stamp it
  on the input — the same factory is used by the amend modal, so it must be opt-in per call site.
- 1 `pageReady('dispatch')` at the end of `init()`'s success path.
- 1 `NexflowTutorial.signal('dispatch:confirmed', { challan_number })` inside
  `handleSaveWorkflow()`, after the RPC succeeds and **before** `resetWorkspaceForm()` — the same
  ordering trap that was fixed for `challan_dispatched` notifications in Step 4 `[VERIFIED,
  CLAUDE.md Aug 31]`; the reset wipes the values the signal wants to carry.
- 1 "▶ Show me how" button in the page header.

### 7.3 `grn.html` — step outline

A plain tenant sees **10 steps**; a job worker receiving principal material sees **13**.

| # | id | target | Type | Instruction (EN) | Why (EN) |
|---|---|---|---|---|---|
| 0 | `intro` | — (card) | manual | Material has arrived at your gate. We'll record it together — about 10 steps. | This adds real stock. Only record what physically arrived. |
| 1 | `grn-no` | `grn-number` | manual | Leave this empty. Nexflow gives the GRN number itself when you submit. | One number, given once, in order — so nothing is missing when your CA checks the series. |
| 2 | `owner` | `grn-owner` | change — `when: isJobWorker()` | Whose material is this — yours, or your principal's? | Principal material is **not** a purchase. Recording it as yours claims ITC that doesn't exist and breaks your ITC-04. |
| 3 | `principal-challan` | `grn-principal-challan-no` | input — `when:` a principal is selected | Type the challan number printed on the principal's delivery note, and its date. | The s.143 one-year clock starts from **this** date, not from the day you enter it. |
| 4 | `supplier` | `grn-supplier` | change | Pick the supplier. Not in the list? Press **+** to add them. | The supplier's GSTIN is what matches your purchase to their GST filing. |
| 5 | `date` | `grn-date` | manual | The date the material actually arrived. | Today is already filled. Change it only if it came in earlier. |
| 6 | `material` | `grn-row-material` | input | Type the material name or its code, then tap it in the list. | Picking from the list is what links this to the right stock item. Typing a new name does nothing. |
| 7 | `qty` | `grn-row-qty` | input | How much arrived? Count it, don't copy the invoice. | Your stock balance is the sum of every one of these. One wrong number is wrong forever. |
| 8 | `unit` | `grn-row-unit` | manual | The unit fills in by itself from the material. | If it's the wrong unit, the material master is wrong — tell the owner, don't work around it. |
| 9 | `rate` | `grn-row-rate` | input | The rate per unit on the supplier's bill. | This is what values your stock and what your CA sees as the purchase amount. |
| 10 | `invoice-no` | `grn-row-invoice-no` | input | **Type the supplier's invoice number exactly as printed on the bill.** | **The single most important box on this page.** Your CA matches this against what the supplier filed with GST. If it's missing or different, your input credit gets blocked. |
| 11 | `purchase-type` | `grn-row-purchase-type` | change | Is the supplier in Maharashtra (Intrastate) or another state (Interstate)? | This decides CGST+SGST versus IGST. Wrong here means a wrong GST return. |
| 12 | `add-row` | `grn-add-row` | manual, **optional** | More materials on the same bill? Press "+ Add Row" and fill the next line. | One bill can cover several materials — keep them under one GRN. |
| 13 | `submit` | `grn-submit` | **event** `grn:submitted` | Press "Submit All Materials". | Now the GRN number is issued and the stock goes in. |
| 14 | `duplicate` | `grn-duplicate-modal` | manual — **shown only if it appears** | Nexflow has seen this invoice number from this supplier before. Check the bill. If it really is a second delivery, continue. | A bill entered twice doubles your stock and doubles your ITC claim. This check exists to stop that. |
| 15 | `done` | — (card) | complete | Done — GRN {n} recorded. | — |

Page changes required:

- 11 markup attributes; 5 set in JS inside `renderGRNRows()` (row inputs are built there and
  destroyed on every re-render — ADR-5 covers the consequence).
- Row-level attributes are stamped **only on the first row**
  (`data-tutorial-target="grn-row-qty"` on row index 0, nothing on later rows), so the target
  stays unique. The tutorial teaches row one; the user repeats the pattern.
- `pageReady('grn')`, one `signal('grn:submitted')`, one "Show me how" button.

**A real bug this outline surfaced — fix it in the GRN tutorial session `[VERIFIED]`.** The
Invoice No column header carries `data-mr="चलान क्र"` (`grn.html:217`), which reads in Marathi as
*challan number* — a different document entirely, and one that also appears on this page. The same
concept is labelled `बिल क्र` in `grn-history.html:166` and `इनव्हॉइस क्र` in `invoices.html:218`.
Three labels, one of them wrong, on the field that GSTR-2B reconciliation, the CA export and the
Bridge Agent's Purchase vouchers all key off. **Standardise on `इनव्हॉइस क्रमांक`** (which is what
`manual.html` already uses) across all three pages before writing the Marathi for step 10. §8.3
makes this a general rule.

### 7.4 Smaller modules — outline only

- **`index.html` orientation (4 steps):** the navbar / drawer → the stat cards → the stock table
  and its Low/OK filter → where to go next for your role. No writes, no `advanceOn` beyond
  `manual`. Build it with P1; it is half a session.
- **`production-issue.html` (~9 steps):** product → quantity → pool (conditional) → BOM preview →
  confirm → WIP panel. The BOM preview step is the teaching moment: *"this is what will come out
  of stock — if it looks wrong, the recipe is wrong, stop and tell the owner."*
- **`scanner.html` (~5 steps):** camera permission → scan → what the screen shows → confirm. Must
  state plainly that a QR-scanned GRN is **always recorded as your own stock**, so a principal's
  delivery has to go through `grn.html` instead `[VERIFIED — scanner.html writes `owned_by: null`
  explicitly, by design]`. Teaching the constraint is cheaper than building around it.

---

## 8. Marathi Content Guidelines

Marathi is not a translation pass over English strings. It is the language a majority of the
intended users think in. Everything below is a rule, not a preference.

### 8.1 Register

Write the way a foreman explains a job to a new worker on the floor.

- **Imperative, present tense, second-person polite plural** — `टाका`, `निवडा`, `दाबा`, `तपासा`.
  Not the literary/formal register (`प्रविष्ट करावे`), not the intimate (`टाक`).
- **One instruction per sentence. Maximum ~12 words.** No subordinate clauses, no "after which",
  no parentheticals inside the instruction. The `why` line can be a second sentence; the
  instruction cannot.
- **Use the verb people actually say.** `टाईप करा` is normal factory Marathi and is fine.
  `एंटर करा` is not — `टाका` covers it. `प्रविष्ट करा` is form-filling officialese.
- **Never write a sentence you would not say out loud to a person standing next to you.** If it
  needs to be read twice, rewrite it.

### 8.2 The naming rule — the one that matters most

> **A control is named in the instruction by exactly the label that control is currently showing
> on screen, in the language the instruction is in.**

Every button and label in Nexflow is bilingual via `data-en` / `data-mr`. When the UI is in
Marathi, `#addProductBtn` reads **उत्पादन जोडा**. So the Marathi instruction must say
`"उत्पादन जोडा" दाबा` — because the user is scanning the screen for those exact characters. An
instruction that says "press the Add Product button" while the button reads उत्पादन जोडा makes
the user hunt. An instruction that invents a third phrasing (`"वस्तू टाका" दाबा`) makes it
impossible.

**This is mechanically checkable and §10.3's lint script checks it:** for any step whose `text`
names a control, the named string must be byte-identical to that element's `data-mr` (for the
`mr` bundle) or `data-en` (for `en`). Quote the control name so the lint can find it.

Corollary: **fixing a bad `data-mr` is part of writing that step's Marathi**, not a separate
task. See the `चलान क्र` finding in §7.3.

### 8.3 The glossary is a deliverable

Terminology drift across the app is already real and already harmful (§7.3). The tutorial work
produces `tutorials/glossary.md`: one row per domain term, with the agreed EN string, the agreed
MR string, and every page that displays it. Any tutorial string using a glossary term uses the
agreed form. Any page displaying a different form gets corrected.

Starting rows, from what is already in the codebase:

| Concept | EN | MR (agreed) | Note |
|---|---|---|---|
| Supplier invoice number | Invoice No | **इनव्हॉइस क्रमांक** | Currently `चलान क्र` / `बिल क्र` / `इनव्हॉइस क्र` on three pages. Standardise. |
| Delivery challan | Challan | **चलान** | Never use चलान for an invoice. |
| GRN | GRN | **GRN** | Keep the acronym. It is what people say. |
| Quantity | Quantity | **परिमाण** | Already consistent. |
| Rate | Rate | **दर** | Already consistent. |
| Stock | Stock | **स्टॉक** | Already consistent; `साठा` also appears — pick one. |
| Purchase type | Purchase Type | **खरेदी प्रकार** | Keep `Intrastate (CGST+SGST)` / `Interstate (IGST)` untranslated (§8.4). |
| Job work | Job Work | **जॉब वर्क** | Per `js/movement-purpose.js`. |
| Principal | Principal | **प्रिन्सिपल** | Do not translate to मुख्य — it means nothing here. |

### 8.4 What stays in English inside Marathi text

Verified against `manual.html`, which already does this correctly and is the house style:

> *"grn.html वर, पुरवठादार निवडा किंवा जोडा, तारीख सेट करा … आणि त्या रांगेसाठी Intrastate
> (CGST+SGST) किंवा Interstate (IGST) निवडा. GRN क्रमांक सबमिट केल्यावर आपोआप दिला जातो."*

Keep in Latin script, always:

- Statutory and tax terms: **GST, GSTIN, HSN, SAC, ITC, CGST, SGST, IGST, ITC-04, GSTR-1,
  GSTR-2B, s.143, 43B(h)**.
- Document and code formats: **INV-202608-014**, **CH-260910-0042**, material codes, PO numbers.
- Any UI string the app itself renders in English (Intrastate / Interstate, page filenames when
  referenced).
- **Latin digits everywhere** — `12`, `500`, `10/09/2026`. Not Devanagari numerals. A factory
  keyboard produces Latin digits, every printed invoice shows Latin digits, and the stock number
  on screen is in Latin digits. The progress indicator reads **पायरी 3 / 9**.

### 8.5 Process — how the strings actually get written

1. **English first, by the building session.** Write both `text` and `why` in English, complete
   and final.
2. **Marathi by a native speaker in this context** — the founder, or a client's own supervisor.
   Not a machine, not a general translator. The domain vocabulary (जॉब वर्क, प्रिन्सिपल, चलान)
   is workplace jargon that a general translator will "correct" into words nobody uses.
3. **Read it aloud.** Literally. To one real storekeeper, on a phone, on the actual page.
   Anything they ask you to repeat gets rewritten. **This is a shipping gate, not a nice-to-have**
   — it is the only test that catches register problems, and it takes ten minutes.
4. **Lint** (§10.3) for missing keys and control-name mismatches.
5. Only then does the module ship in Marathi. English-only shipping first is acceptable and
   expected; wrong Marathi is not.

### 8.6 Audio — future consideration, not current scope

Some Marathi-speaking users read Devanagari slowly or not at all. Spoken instructions would help
them more than any amount of text tuning.

**Not in scope now.** Two notes so that adding it later does not require a redesign:

- The step schema already reserves an `audio` key, keyed by language code, ignored by v1. Adding
  audio needs no schema migration.
- When it is built, use **pre-recorded human audio**, not browser speech synthesis. Marathi TTS
  quality on the Android WebViews this product runs on is poor enough to be counterproductive, and
  a recording in a familiar voice carries more authority. Roughly 15 clips per module, ~10 seconds
  each; served as static files from `audio/mr/`, lazy-loaded per step, with a persistent mute
  control. Gate the build on a client asking for it.

---

## 9. Build Sequence

### 9.1 Engine core first, or first tutorial first?

**Both, in one session, together.** `[DECIDED]`

An engine with no content is unfalsifiable — every hard problem in §4 (typeahead mounted after
load, row inputs destroyed on re-render, chained modals, the mobile keyboard) only reveals itself
against real markup. A tutorial with no engine is not a thing. Building "engine core" as a
standalone session produces a plausible-looking module that is wrong in ways nobody can see yet.

The correct unit of work is **engine + exactly one hard module, end to end, English only.**
Dispatch is that module (§7.1).

### 9.2 Sessions

**Session T1 — engine + dispatch, English (1 session)**

1. Migration applied to the **test tenant only**, via the SQL Editor.
2. `js/tutorial-engine.js`: registry, lifecycle, target resolution, the six `advanceOn` types,
   spotlight, bubble, progress rail, desktop positioning, teardown registry, `tr()`, failure
   wrapping.
3. `tutorials/dispatch.tutorial.js` — English strings only, `mr` keys present but empty.
4. `dispatch.html`: 12 attributes, the `buildMatTypeahead` option, `pageReady()`, the signal
   emission, the "Show me how" button.
5. `getTutorialMode()` in `js/supabase-client.js`; the Settings selector.
6. Verify on the test tenant: full run start-to-finish creating a real challan; every failure mode
   in §4.10 exercised deliberately (delete a `data-tutorial-target` and confirm the step skips).

**Session T2 — Marathi, mobile, and GRN (1 session, possibly 1.5)**

1. Mobile: bottom sheet, keyboard/`visualViewport` handling, drawer steps, toast lift. **Tested on
   a real low-end Android**, not devtools.
2. `nexflow:langchange` in `js/navbar.js`; live language switch mid-step.
3. Marathi for dispatch, through the §8.5 process including the read-aloud gate.
4. The glossary file, and the `चलान क्र` → `इनव्हॉइस क्रमांक` correction across three pages.
5. `grn.html` attributes + `tutorials/grn.tutorial.js`, both languages.
6. Resume, progress persistence, completion card, "Don't show again".

**Session T3 — coverage, owner controls, tooling (1 session)**

1. `production-issue.html`, `index.html` orientation, `scanner.html`.
2. Staff Members progress column + per-staff reset.
3. Demo narration mode (§4.9), verified on the demo tenant.
4. `_ai/regression/tutorial-lint.js` + the `?tutorialdebug=1` overlay.
5. Migration rolled out to the three live tenants.

**After T3:** roughly **half a session per additional P2/P3 module**, since the engine is done and
the work is attributes plus content plus the Marathi gate.

**Total to P0 + P1 in both languages: 3 sessions.** Plus content time outside the sessions for
Marathi authoring and the read-aloud test, which is calendar time, not build time.

### 9.3 Risks and unknowns, ranked

1. **The mobile keyboard is the highest-risk unknown.** Android WebView `visualViewport`
   behaviour varies by device and browser, and the tutorial's entire value proposition is on a
   phone. Mitigation: build the desktop path first in T1, treat mobile as its own T2 workstream,
   and test on a real ₹8,000 handset before declaring it done. If `visualViewport` proves
   unreliable, the fallback is the fixed top slot for every input step on mobile — less elegant,
   always correct.

2. **Touching two high-traffic files.** `dispatch.html` and `grn.html` handle money. The changes
   are additive (attributes, one options flag, two one-line emissions) but they are still edits.
   Mitigation: attributes only, no logic changes; syntax-check each file after each pass, the same
   discipline the 9-pass `export.html` session used; run the existing `_ai/regression` snapshot
   diff against the most recent pre-session snapshot afterwards.

3. **Marathi quality is a human bottleneck, not a code one.** The read-aloud gate cannot be
   compressed and cannot be done by a session. If it slips, ship English-only for that module —
   that is a working feature, not a failure.

4. **Auto-start racing page init.** Mitigated by ADR-10, but every new covered page must remember
   the `pageReady()` call. A page that forgets it simply never auto-starts — a silent, benign
   failure that is easy to miss in review. The lint script should check that every module with a
   config has a matching `pageReady()` call in its page.

5. **Demo mode.** Easy to forget until the tutorial hangs forever on the landing-page demo
   account in front of a prospect. Handled in §4.9; verify it explicitly in T3.

6. **Scope creep into a help system.** The tutorial teaches a *flow*. It is not a glossary, not a
   FAQ, not a replacement for `manual.html`. If a step's `why` starts wanting three paragraphs,
   that content belongs in the manual with a link, not in a bubble.

7. **Steps drifting out of date.** The whole of §10.

---

## 10. Maintenance

### 10.1 The rule

> **The session that changes the UI of a tutorial-covered page updates that page's tutorial
> config in the same session and the same commit. Not the next session. Not a follow-up. The same
> commit.**

Add this verbatim to `CLAUDE.md`'s "Rules for this session" when T1 ships, and list which pages
are tutorial-covered so a session knows whether the rule applies before it starts editing.

This rule is enforceable because of two supporting properties:

- **Visibility.** `data-tutorial-target` sits in the markup next to the control being edited
  (ADR-2). A developer changing that field sees the dependency.
- **Graceful degradation.** An unresolved target is skipped and logged, never fatal (§4.4). So a
  session that forgets produces a tutorial with a gap, discovered on the next run — not a broken
  page discovered by a client.

### 10.2 What breaks, and how much

| Change | Blast radius |
|---|---|
| A button's `id` changes | **Zero.** Configs never reference ids. |
| A field moves elsewhere on the page | **Zero.** Position is recomputed from the element. |
| A field's label / `data-mr` changes | The step's Marathi may now name a control by a label it no longer shows. Caught by lint (§10.3). |
| A `data-tutorial-target` is deleted or renamed | Exactly one step, skipped and logged. |
| A field is removed entirely | Exactly one step, skipped and logged. Delete the step. |
| A new required field is added | **The one genuinely dangerous case.** Nothing breaks and nothing warns — the tutorial simply never mentions the new field, so a guided user leaves it blank and the tutorial has now actively taught bad data entry. This is the reason the rule in §10.1 is a rule and not a guideline. |
| A validation rule changes | Nothing, by design — the tutorial never re-implements validation (Principle 4). |

### 10.3 `_ai/regression/tutorial-lint.js`

A Node script, no dependencies, run manually and before any tutorial-touching commit. It fails
loudly on:

1. **Missing target** — a `target` value in any `tutorials/*.tutorial.js` with no matching
   `data-tutorial-target="<value>"` in that module's HTML **or** in the page's JS as a
   `dataset.tutorialTarget` assignment.
2. **Orphan attribute** — a `data-tutorial-target` in markup that no config step references.
   Warning, not an error (it may be staged for a future step).
3. **Missing language key** — any `text` / `title` / `why` bundle lacking a key present in
   `SUPPORTED_LANGS`. This is the **only** place `SUPPORTED_LANGS` is enumerated (ADR-3).
4. **Control-name mismatch** — any quoted control name inside a bundle string that does not appear
   as that element's `data-en` / `data-mr` (§8.2).
5. **Missing `pageReady`** — a registered module whose page contains no
   `NexflowTutorial.pageReady('<module>')`.
6. **Duplicate step id** within a module, or a step id changed since the last committed config
   (progress rows key off step ids — renaming one silently invalidates saved resume positions).

### 10.4 `?tutorialdebug=1`

Append it to any covered page's URL to get: every `data-tutorial-target` on the page outlined and
labelled; a floating list of the module's configured steps with resolved/unresolved status and
`when` results; and a step-jump control. Turns "is the tutorial still accurate?" from a five-minute
manual run into a ten-second look. Owner/dev-only; no gating needed since it renders nothing a
user could act on, but keep it out of the auto-start path.

### 10.5 Content ownership

- **Step sequence and English strings:** the session shipping the feature.
- **Marathi strings:** the founder or a named native speaker, per §8.5. A session may draft
  Marathi but must mark it `// UNREVIEWED` and it must not ship to a live tenant in that state.
- **The glossary (`tutorials/glossary.md`):** append-only, reviewed whenever a new domain term
  first appears in a tutorial string.

---

## 11. Out of Scope

`[NEVER]`, unless a named client asks and this document is updated first.

1. **A sandbox / practice mode.** ADR-9.
2. **Tutorials for CA-facing pages** (`export.html`, `gstr2b-reconcile.html`,
   `itc04-workingpaper.html`, `principal-dashboard.html`, `ca-report.html`). §7.1.
3. **The tutorial performing actions for the user** — auto-filling a field, auto-clicking a
   button, submitting a form. It guides; it never acts. A tutorial that types for you teaches
   nothing and would be writing to `p2_stock_transactions` on the user's behalf.
4. **Blocking or overriding page validation.** Principle 4.
5. **A tutorial authoring UI.** Configs are code, edited by whoever edits the page. A CMS for
   fifteen JS files is the wrong shape.
6. **Analytics beyond completion state.** `p2_tutorial_progress` records status, last step and
   completion count, per user per module. Not per-step timing, not funnels, not drop-off
   dashboards. If a genuine question arises about where people get stuck, the skip log answers it.
7. **Replacing `manual.html`.** The tutorial teaches a flow at the moment of doing it. The manual
   is the reference for everything else. They are complementary and both stay.
8. **Hindi, or any third language.** ADR-3 makes it cheap later. It is not scope now.
9. **Audio.** §8.6.

---

## 12. Open Questions

**Q1. Is `auto` the right default for the three existing live tenants?**
SS Engineering, Datta Prasad and Shivprasad have staff who already know the software. Defaulting
them to `auto` means their next page open starts a tutorial they do not need — mildly annoying,
and it arrives without warning.
**Recommendation:** ship with the column defaulting to `'auto'` (correct for every future tenant),
then immediately `UPDATE p2_tenant_settings SET tutorial_mode='off'` for the three live tenants in
the same SQL Editor session, and tell each owner it exists and how to switch it on for new staff.
**Decide before:** the migration is applied to live tenants (T3).

**Q2. Should the storekeeper role be forced to `always` for GRN?**
GRN is the highest-stakes entry by the least experienced user, and storekeeper turnover in MIDC
factories is high. A per-role override (`always` for storekeeper, `auto` for everyone else) is a
small addition to the schema.
**Recommendation:** do not build it yet. Watch whether owners actually use the per-staff reset in
§6.3 first — if they do, a role override is unnecessary; if they never find it, that is the
signal.
**Decide before:** T3.

**Q3. Does the dispatch tutorial run to the end on a return-purpose dispatch?**
The challan-link step (§7.2 #11) is genuinely complex and, for the three current KPML vendors,
usually resolves to "Not Linked" because KPML is not a Nexflow tenant, so no matching original
challan exists `[VERIFIED — Session 8 known limitation]`. Teaching a step whose honest answer is
usually "you can't do this yet" may do more harm than skipping it.
**Recommendation:** include the step but write it honestly — *"if the original challan isn't in
this list, leave it. It means the material came from outside Nexflow."*
**Decide before:** the dispatch Marathi is written (T2).

**Q4. Where does the "Show me how" button live on mobile?**
The page header is fine on desktop. On a 360px screen the header is already tight, and the
bottom-right corner is taken by the agent FAB at z-500.
**Recommendation:** page header on both, as a compact ghost button next to the title; explicitly
**not** a second FAB. Re-open only if field use shows nobody finds it.
**Decide before:** T2's mobile pass.

**Q5. Should completing a tutorial be visible to the owner as a training record?**
`p2_tutorial_progress` already holds enough for "Ramesh completed GRN on 14 Oct." That is
genuinely useful to a factory owner and costs nothing beyond the Settings column in §6.3. It is
also, in a small way, employee monitoring.
**Recommendation:** show completion status and date, nothing more. No timings, no attempt counts,
no "stuck at step 6" — that crosses from a training record into surveillance of a specific worker
and would poison adoption by the exact people the feature is for.
**Decide before:** T3 builds the Staff Members column.

---

*Last updated: 10 September 2026. Design complete; no code written.*
*This is a living document. As it is built, move items to `[DECIDED]`, close open questions, and
record what actually shipped — same convention as `enterprise-strategy.md`.*
