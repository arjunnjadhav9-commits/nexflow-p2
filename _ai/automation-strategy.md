---
name: automation-strategy
description: Nexflow operational automation — client onboarding ingestion, compliance monitoring, daily ops digest, support, billing (manual-trigger first, Razorpay deferred to 50+ clients), filing-package supervision, provisioning, codebase health. Architecture, models, costs including Claude Max development cost, build sequence, WhatsApp as distribution.
sources: [founder-brief-sept-2026, codebase-verification-sept-11-2026, enterprise-strategy.md, tutorial-engine.md, CLAUDE.md]
last_updated: 11 September 2026
status: design complete — not yet built. Living document: update in place as it is built.
---

# Nexflow — Automation Strategy

**Load order for a session building any automation:** `_ai/CLAUDE.md` → this file → the target
Edge Function or page source. `_ai/enterprise-strategy.md` is context for A1/A6 and a dependency
for nothing else. `_ai/tutorial-engine.md` is the reference for the language-bundle contract (§3.2).

**Status: designed, not built.** Nothing named `A0`–`A8` in this document exists in the codebase
today. Every codebase fact stated here was verified against the working tree on 11 September 2026
and is marked `[VERIFIED]` where it contradicts something a session might otherwise assume — or
`[CORRECTION]` where it contradicts the founder brief that commissioned this document.

## Tag convention

Inherited from `enterprise-strategy.md`, unchanged, plus one addition.

| Tag | Meaning |
|---|---|
| `[DECIDED]` | Decided. Build it as written. Do not relitigate. |
| `[RECOMMENDED]` | This document's recommendation. Needs founder sign-off. |
| `[VERIFIED]` | Checked against the live codebase 11 Sept 2026. Safe to build on. |
| `[UNVERIFIED]` | Needs a live check before code is written. Every instance is listed again in §10. |
| `[CORRECTION]` | The founder brief states something the codebase contradicts. Read the correction before planning around the brief. |
| `[NEVER]` | Permanently out of scope. |

---

## 1. Executive Summary

### What this is

The build spec for the operational layer that lets one person run Nexflow for a thousand
factories. `enterprise-strategy.md` covers what Nexflow *sells*. `tutorial-engine.md` covers how
clients *learn* it. This document covers what happens every day, every month, and every time a
client signs up — and how none of it lands on a calendar.

The distinction that organises everything below: **product work compounds, operational work
repeats.** An hour spent on the Bridge Agent is an asset. An hour spent onboarding the fourteenth
vendor is gone. At three clients the repeating hours are invisible. At a hundred they are the
entire job, and the product stops moving. Every automation here exists to convert a repeating
hour into a one-time hour.

### The eight automations at a glance

| ID | Automation | Model | What it replaces | Build | Critical at |
|---|---|---|---|---|---|
| **A0** | Founder ops channel | — | Nothing — it is the missing primitive four others assume | 0.5 session | **now** |
| **A1** | Onboarding data ingestion | Opus + Haiku | 3–6 founder-hours per client | 3–4 sessions | 15 clients |
| **A2** | Compliance monitoring | Haiku + Opus gate | Reading CBIC by hand, badly | 1.5 sessions | **now** |
| **A3** | Daily operations digest | Haiku | 20 min/day of dashboard checking | 1 session | 20 clients |
| **A4** | Customer support | Haiku + Opus escalation | 12 min per repeated question | 2 + 1.5 sessions | 40 clients |
| **A5** | Billing and renewal | — (deterministic) | Invoice chasing, access management | 2 sessions | 25 clients |
| **A6** | Filing package supervision | — (deterministic) | Nothing yet — the failure is currently silent | 1 session | **5 Oct 2026** |
| **A7** | Signup and provisioning | — (deterministic) | 40 min per signup | 1.5 sessions | 25 clients |
| **A8** | Codebase health | — (deterministic) | Learning about outages from clients | 1 session | 50 clients |

### Four findings that change the plan

These emerged from verifying the brief against the working tree. Each one moves something in the
build order, and a session that plans from the brief alone will plan around a stack that does not
exist.

**1. There is no founder-facing channel. `[VERIFIED]`**
Four of the eight automations (A2, A3, A6, A8) are specified as "founder gets a Telegram
message." Every Telegram path in the codebase today resolves `telegram_chat_id` from
`p2_tenant_settings` — it is *tenant*-scoped, by construction. `notify/index.ts` takes a
`notification_id`, looks up that row's tenant, and messages that tenant. There is no route that
reaches the founder, no table that holds a founder-scoped alert, and no secret holding a founder
chat id (`grep -rn "FOUNDER_TELEGRAM\|ADMIN_CHAT\|p2_ops"` returns nothing). This is half a
session of work that four automations each silently assume exists. It is **A0**, and it is first.

**2. Razorpay is not in the codebase, and will not be integrated until 50+ clients.
`[CORRECTION] [DECIDED]`**
The brief listed "Razorpay (payments)" in the current stack. `grep -ril razorpay` returns zero
matches `[VERIFIED]`. Payments today are manual bank transfers confirmed by the founder via a
direct SQL update to `p2_tenant_settings` (`plan`, `agent_tier`). This is the correct approach
until manual payment confirmation takes more than 2–3 hours per month — approximately 50+ clients.

Decision (Sept 11 2026): Do NOT integrate Razorpay until manual payment overhead becomes real
friction. Reasons:

- Razorpay KYC binds to a legal entity — building against the proprietorship means rebuilding
  after PVT LTD incorporation
- At <50 clients, 2% Razorpay fees are disproportionately high relative to revenue (21.5% of costs
  at 10 clients when included)
- Manual confirmation takes <5 minutes per payment at current scale
- Setup fees are collected manually anyway — one consistent process

A5 (billing automation) is therefore split:

- The reminder scheduler, plan-state machine, and grace-period logic can be built in Wave 3
  without Razorpay (manual trigger replaces the webhook)
- Razorpay webhook integration is deferred until 50+ clients or until manual payment management
  takes >3 hours/month
- A7 (provisioning) similarly: manual provisioning via founder SQL stays until A5's Razorpay
  integration exists

**3. The filing-package cron will time out before 100 clients. `[VERIFIED — architecture;
UNVERIFIED — the exact ceiling]`**
`filing-package/index.ts` processes tenants **strictly sequentially** inside one Edge Function
invocation (`for (const tenant of tenants)`, line 2060), and each tenant builds four to six
ExcelJS workbooks, a Tally XML, and makes an Opus call. Wall-clock per tenant is on the order of
45–90 seconds. Total invocation time therefore grows linearly with the book, and an Edge Function
invocation has a finite execution ceiling. Somewhere between roughly 20 and 60 tenants the 5th-of-
the-month run stops finishing, and the tenants at the end of the loop silently never get a
package. This is not a future problem to schedule — the function is **already live**, with
`filing_package_enabled` defaulting to `true`, and the first real multi-tenant production run is
**5 October 2026**. A6 is therefore not "retry failures"; it is the supervisor for a queue
architecture that has to replace the loop. §3.3 specifies it.

**4. The B2CL threshold was wrong in production for twenty-two months.**
Notification 12/2024 dropped the B2CL threshold to ₹1 lakh effective 1 November 2024.
`export.html`'s `B2CL_THRESHOLD` said ₹2,50,000 until it was corrected on 9 September 2026
`[VERIFIED — CLAUDE.md, Known Open Items #3]`. That is the manual compliance process, measured:
it missed a numeric constant in a statutory filing surface for nearly two years, at a client count
of three, with a founder who reads this material attentively. It was caught by a CA conversation,
not by the process. **A2 is not insurance against a hypothetical. It is a fix for a demonstrated
failure**, and its cost — about ₹90/month, flat, forever, at any client count — is the cheapest
line in this document.

### What it costs and what it saves

Full tables in §8. The headline:

| Book size | Total run cost / month | Per client / month | Founder ops hrs/month, automated | Hours saved |
|---|---|---|---|---|
| 10 | ₹4,600 | ₹460 | 9 | 13 |
| 50 | ₹17,800 | ₹356 | 15 | 38 |
| 100 | ₹65,400 | ₹654 | 22 | **71** |
| 500 | ₹1,28,500 | ₹257 | 64 | 291 |
| 1,000 | ₹1,87,000 | ₹187 | ~95 | ~600 |

Two honest notes on that table, because both cut against the brief's framing:

- **Infrastructure does not "barely move" from 100 to 1,000.** It roughly triples, ₹62,500 →
  ₹1,61,000/month. What collapses is *per-client* cost — ₹625 to ₹161. The correct claim is that
  infrastructure is strongly sublinear and becomes a rounding error against revenue (7.8% of
  revenue at 100 clients, 2.2% at 1,000), not that it is flat.
- **AI is never the cost.** At 1,000 clients every model call in this document totals about
  ₹20,000/month against ₹1,61,000 of infrastructure and roughly ₹83,00,000 of revenue. No design
  decision in this document should be made to save tokens. `enterprise-strategy.md` §7 reached the
  same conclusion about Enterprise pricing and it holds here: **design for founder hours, not for
  compute.**

---

## 2. The Solo-Founder Operating Model

### The arithmetic

An operational task has a per-event cost and a frequency. Multiply, and the answer is a calendar.

| Task | Per event | Frequency | At 100 clients |
|---|---|---|---|
| Onboard a client | 3–6 hrs | per new client | 36 hrs/mo at 8 new/mo |
| Answer a support question | 12 min | ~1 per client per month | 20 hrs/mo |
| Verify a filing package | 2 min | monthly, per client | 3.3 hrs/mo + failures |
| Chase a renewal | 25 min | annual, per client | 6 hrs/mo |
| Provision a signup | 40 min | per new client | 5 hrs/mo |
| Check dashboards | 20 min | daily | 10 hrs/mo |
| Read compliance news | 4 hrs | monthly | 4 hrs/mo |
| Respond to an incident | 2–4 hrs | ~2/mo | 6 hrs/mo |
| **Total** | | | **~90 hrs/month** |

Ninety hours a month is more than half of everything available, spent entirely on work that
produces nothing durable. And it is the *good* case — it assumes nothing goes wrong and every
client is easy. The same table at 500 clients is 354 hours, which is not a workload, it is a
refusal.

The automated column is §8.3. The number that matters there is that ops work becomes **sublinear
in client count** rather than linear. That is the whole objective. Not zero — sublinear.

### The four rules

Every automation in this document obeys all four. A session that finds itself arguing with a spec
below should check these first; the spec is downstream of them.

**R1 — Deterministic code computes. The model judges.**
Inherited verbatim from `enterprise-strategy.md` §3.2, where it is the rule that makes the filing
package safe rather than a liability. It generalises. A model may classify, map, summarise,
adjudicate an ambiguity, and rank by severity. A model may **never** perform arithmetic, decide
that a write is safe, or be the only thing standing between bad input and a table. Concretely: in
A1, the model decides that a column headed `WT/PC` means `qty_per_unit`; code does the gram-to-
kilogram conversion. In A2, the model says a notification concerns HSN digit requirements; code
greps the constant inventory. In A3, SQL computes every count; the model writes the sentence.

**R1a — A model may only lower confidence, never raise it.**
The corollary, and the one that actually prevents damage. Model output can demote a row from green
to amber, or amber to red. It can never promote. Every green in an A1 review table is green
because deterministic validation passed, not because Opus was confident. This is the same shape as
the HSN autofill rule "it is a suggestion, never a write" (`enterprise-strategy.md` §3.3, rule 1),
generalised to every automation.

**R2 — Multi-tenant by construction, never by retrofit.**
Adding a client must require **zero changes to any automation**. Test: if onboarding client 101
requires editing a file, the automation is wrong. In practice this means three prohibitions — no
tenant id in any config or constant; no per-tenant branch anywhere (`if tenant === 'kpml'` is the
shape the product already forbids, per `kpml-network-plan.md` §2's zero-customer-specific-logic
rule); and no unbounded per-tenant loop inside a single invocation (§3.3). Every automation
discovers its tenants by querying `p2_tenant_settings` with a flag predicate, exactly as
`filing-package` already does with `.eq('filing_package_enabled', true)` `[VERIFIED]`.

**R3 — Fail visible, never fail silent.**
An automation that stops working must announce it. The failure mode this product has repeatedly
shipped is the quiet one: fifteen tables with RLS policies and no `ENABLE ROW LEVEL SECURITY`; a
`set_tenant_id()` trigger silently rejecting every staff insert; `challanSeriesKey()` silently
dropping legacy challans from gap detection; `#gstr1WorkbookSection` visible to every role because
one CSS default was missing. All four were found by audit, none by an alarm. Therefore: every
automation writes a heartbeat, and **absence of a heartbeat is itself an alert** (§4.3). A cron
that stops firing must be as loud as a cron that fails.

**R4 — Client-facing strings are language bundles. Founder-facing strings are English.**
§3.2 in full. The short version: the split is not cosmetic, it is what keeps the bundle machinery
out of the six automations that will never need it.

### What "an operating system, not a job" means concretely

It means the founder's inbox is one Telegram channel and one review queue, and everything else is
a database row that resolved itself. Three tests for whether an automation has achieved this:

1. **Does it require a decision, or does it require attention?** Attention is the enemy. An
   automation that reports "47 things happened" has moved the work, not removed it. A3's 200-word
   cap is a design constraint for exactly this reason: a digest long enough to skim is a digest
   nobody reads.
2. **What happens when it fails at 3 a.m.?** If the answer involves the founder being awake, it is
   not finished. Every automation here has a defined degraded mode that is *shorter*, not broken —
   the principle `tutorial-engine.md` Design Principle 6 applies to steps, applied to jobs.
3. **Does the next client cost anything?** R2, restated as a question to ask in review.

---

## 3. Shared Foundations

Three things every automation depends on, none of which exist. Build them first, or build each
automation twice.

### 3.1 A0 — The Founder Ops Channel

**Build: 0.5 session. Blocks A2, A3, A6, A8. `[DECIDED]` — build first, before anything else.**

**What it is.** One route by which server-side code reaches the founder, one table that records
what was sent, and one severity vocabulary shared by every automation.

**Why it does not already exist.** The notification pipeline built in Step 4 (31 Aug 2026) is
correct and complete for what it was for: a tenant event reaching that tenant's owner.
`js/notifications.js` inserts a `p2_notifications` row with an explicit `tenant_id`, then
fire-and-forget POSTs `{notification_id}` to `notify`, which resolves `telegram_chat_id` and
`quiet_hours` **from that tenant's settings row** and delivers `[VERIFIED]`. Every field in that
path is tenant-scoped. There is no tenant whose owner is the founder, and inventing one — a fake
tenant row holding a founder chat id — would put ops alerts inside RLS-governed, client-visible
infrastructure. Build the separate thing.

**Architecture.**

```
  A2 compliance-scan ─┐
  A3 ops-digest      ─┤                     ┌─► Telegram (founder chat, env secret)
  A6 filing monitor  ─┼─► opsAlert(...) ───►│
  A8 health-check    ─┘         │           └─► p2_ops_alerts  (durable record)
  A1/A4/A5/A7 (exceptions only) │
                                └─► dedupe on (source, dedupe_key) within window
```

**New shared module: `supabase/functions/_shared/ops.ts`.** `[VERIFIED — no `_shared/` directory
exists today; creating it is new for this codebase.]` Supabase Edge Functions support a `_shared/`
import path between Deno functions. Note this is *not* contradicted by `CLAUDE.md`'s "no shared
module system between the browser script and this Deno function" — that statement is about the
browser↔Deno boundary, which remains real. Deno↔Deno sharing is available and is the standard
Supabase layout.

```ts
// supabase/functions/_shared/ops.ts
export type OpsSeverity = 'critical' | 'important' | 'monitor'

export async function opsAlert(opts: {
  source: 'compliance' | 'digest' | 'filing' | 'health' | 'onboarding' | 'support' | 'billing'
  severity: OpsSeverity
  title: string              // English. Founder-facing. Never a bundle — see §3.2.
  body: string               // English. Plain text. No parse_mode.
  dedupeKey?: string         // suppresses a repeat within dedupeWindowHours
  dedupeWindowHours?: number // default 24
  meta?: Record<string, unknown>
}): Promise<void>
```

Three properties, all load-bearing:

- **Never throws.** Every caller is fire-and-forget. An alerting path that can fail a business
  operation is worse than no alerting path. Same contract `notify` already honours by always
  returning HTTP 200 `[VERIFIED]`.
- **Deduplicates.** `(source, dedupe_key)` within a rolling window, modelled on the existing
  `payment_overdue_notify` dedup (type + tenant + `invoice_id` within 24h) `[VERIFIED]`. Without
  this, one stuck cron sends 1,440 messages a day and the founder mutes the channel — which is the
  real failure mode, not the noise itself.
- **`critical` bypasses quiet hours; `important` and `monitor` do not.** The tenant-facing
  quiet-hours logic in `notify` (midnight-wraparound aware) is reused with a founder-configured
  window, and `critical` ignores it. Filing packages failing for every tenant at 2 a.m. is worth
  waking up for; a `monitor`-class HSN notification is not.

**New table.**

```sql
-- A0 — founder ops alerts. Deliberately has NO tenant_id: this is founder-scoped
-- infrastructure, not client data, and must never appear in any tenant surface.
CREATE TABLE p2_ops_alerts (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source          text NOT NULL CHECK (source IN
                    ('compliance','digest','filing','health','onboarding','support','billing')),
  severity        text NOT NULL CHECK (severity IN ('critical','important','monitor')),
  title           text NOT NULL,
  body            text NOT NULL,
  dedupe_key      text,
  meta            jsonb NOT NULL DEFAULT '{}',
  delivered       boolean NOT NULL DEFAULT false,
  error_reason    text,
  acknowledged_at timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE p2_ops_alerts ENABLE ROW LEVEL SECURITY;
-- No policy is created. Service role bypasses RLS; every other caller sees nothing.
REVOKE ALL ON p2_ops_alerts FROM anon, authenticated;

CREATE INDEX p2_ops_alerts_dedupe_idx ON p2_ops_alerts (source, dedupe_key, created_at DESC);
CREATE INDEX p2_ops_alerts_recent_idx ON p2_ops_alerts (created_at DESC);
```

**On the RLS shape, because it differs from every other table in this schema and the difference is
deliberate.** The codebase has an existing admin pattern — `USING (auth.uid() =
'fe2b94fb-9668-405f-9c62-5f54b32f8c7a')`, used by `admin_read_all_tenant_settings` and
`admin_read_all_logs` for `admin-agent.html` `[VERIFIED]`. Do **not** reuse it here. That UID is
the **test tenant**, which `CLAUDE.md` simultaneously designates "safe to break" and uses for all
development. Binding the ops alert table's only read path to a UID that is also a disposable test
fixture is a latent hazard for no benefit — nothing needs to read these rows from a browser.
Enable RLS, create no policy, revoke from `anon` and `authenticated`. This is the
`v_p2_invoice_payment_status` pattern (service-role-only, browser access blocked entirely)
`[VERIFIED]`, and it is the right one.

**Secrets.** `FOUNDER_TELEGRAM_CHAT_ID` as an Edge Function secret, reusing the existing
`TELEGRAM_BOT_TOKEN`. **Note the operational constraint documented in `CLAUDE.md`: Claude cannot
read Edge Function secret values back (`supabase secrets list` returns digests only), so setting
this is a manual founder step, exactly like the `setWebhook` registration for `telegram-webhook`.**
Put it in the build checklist or it will be forgotten and every alert will silently no-op — which
A0's own design must therefore catch: if `FOUNDER_TELEGRAM_CHAT_ID` is unset, `opsAlert` still
writes the row and sets `error_reason = 'no_founder_chat_id'`, so the misconfiguration is visible
in the table even when the channel is dead.

**Founder-side inbound.** `telegram-webhook/index.ts` currently handles `/start <bind_token>` only
and ignores everything else silently `[VERIFIED]`. A0 adds one branch: a message from
`FOUNDER_TELEGRAM_CHAT_ID` beginning `/ack <alert_id_prefix>` stamps `acknowledged_at`. That is the
entire founder-inbound surface until A4 adds support replies (§4.4), and it preserves the webhook's
existing always-return-200 contract.

### 3.2 The language bundle contract

**`[DECIDED]` — inherited from `tutorial-engine.md` ADR-3, extended to server-side automations.**

The requirement: **adding Hindi must mean adding keys, never editing logic.** Same principle,
different runtime — the tutorial engine resolves in the browser, automations resolve in Deno.

**First, the split that keeps this cheap.**

| Surface | Language | Why |
|---|---|---|
| A1 review page, its emails, its WhatsApp replies | **bundle** | The client reads it |
| A4 support responses | **bundle** | The client reads it |
| A5 renewal / dunning emails, in-app notifications | **bundle** | The client reads it |
| A7 welcome email | **bundle** | The client reads it |
| A2, A3, A6, A8 — every founder-facing string | **bare English string** | One reader, who reads English |
| Anything CA-facing (filing package, exports) | **bare English string** | Standing decision: `export.html` is deliberately excluded from translation `[VERIFIED, CLAUDE.md]` |

Six of the eight automations carry **no** bundle machinery at all. Wrapping a founder Telegram
alert in `{ en: '...' }` would be cargo-culting the pattern into the one place it costs something
and buys nothing. Say this in review when someone proposes it.

**Second, the missing column. `[VERIFIED]`** Language preference today lives *only* in
`localStorage` under `nexflow_lang`. A server-side automation sending an email, a WhatsApp message
or a Telegram notification has **no way to know what language the recipient wants.** Every
client-facing automation needs this and none can have it. Migration:

```sql
-- Recipient language for server-initiated communication. Distinct from the browser's
-- localStorage 'nexflow_lang', which the server cannot see.
ALTER TABLE p2_tenant_settings
  ADD COLUMN IF NOT EXISTS preferred_lang text NOT NULL DEFAULT 'en'
    CHECK (preferred_lang IN ('en','mr'));
```

Adding Hindi is then one `DROP CONSTRAINT` / `ADD CONSTRAINT ... IN ('en','mr','hi')` plus `hi`
keys — a migration and content, never engine code. **The resolver must fall back rather than throw
on an unrecognised code**, so a row carrying `'hi'` written before the constraint is widened
degrades to English instead of failing a send. That defensive ordering is the whole point: the
failure mode of a language rollout must be "the email went out in English," never "the email did
not go out."

**Third, the resolver. One function, one place, never names a language.**

```ts
// supabase/functions/_shared/i18n.ts — the ONLY place language resolution happens.
// Adding Hindi = adding an `hi` key to bundles. This file does not change.
const FALLBACK_LANG = 'en'
export type Bundle = string | Record<string, string>

export function tr(bundle: Bundle | null | undefined, lang: string): string {
  if (bundle == null) return ''
  if (typeof bundle === 'string') return bundle          // tolerate a bare string
  return bundle[lang] ?? bundle[FALLBACK_LANG] ?? Object.values(bundle)[0] ?? ''
}
```

Byte-for-byte the same resolution order as `tutorial-engine.md`'s `tr()`, deliberately — one mental
model across client and server. `SUPPORTED_LANGS` is enumerated in **exactly one place**, the lint
script (§10 Q7), for completeness checking. It never appears in a runtime path.

**Fourth, what this replaces.** The existing codebase pattern is flat suffixed keys — `label_en` /
`label_mr` in `js/movement-purpose.js`, with every consumer writing
`lang === 'mr' ? p.label_mr : p.label_en` `[VERIFIED]`. That ternary hardcodes "there are exactly
two languages" into every call site. Do not extend it into server code. New automation content is
bundles from day one; `movement-purpose.js` is **not** in scope to migrate and should be left
alone.

**Fifth, the model prompt is not a bundle.** An A4 support answer is generated, not translated. The
system prompt instructs the model to answer *in the language of the question*, and the KB article
it cites carries per-language bodies. Adding Hindi to A4 means adding Hindi KB bodies and one value
to an allow-list — not a new prompt, not a new code path, and never a machine translation of the
Marathi. `tutorial-engine.md` ADR-12's rule holds unchanged: a language ships when a native speaker
in the MIDC context has written and read it aloud. **Wrong Marathi in an automated support reply is
worse than English**, because the client cannot tell it is wrong until they have acted on it.

### 3.3 The multi-tenant job queue — and the filing-package wall-clock finding

**`[RECOMMENDED]` — build as part of A6. Blocks nothing else, but silently breaks the live filing
package somewhere between 20 and 60 clients.**

**The finding.** `filing-package/index.ts`, `Deno.serve`, `mode: 'monthly_cron'`:

```ts
for (const tenant of (tenants || []) as TenantRow[]) {
  const result = await processTenant(tenant, periodMonth, { isManual: false })   // line 2060
}
```

Strictly sequential, by deliberate design — the Session 15 notes say "tenants processed strictly
sequentially (never parallel)," which was the right call for a two-tenant verification run and is
the wrong shape at scale. `processTenant` builds a 5-sheet GSTR-1 workbook, a purchase register,
one ITC-04 workbook **per principal**, an HSN audit snapshot and a Tally XML, makes an Opus call
with `max_tokens: 6000`, then zips, uploads and emails. Per-tenant wall clock is dominated by the
Opus call and the ExcelJS construction.

**The consequence.** Total invocation time is `N × t`. An Edge Function invocation has a finite
execution ceiling. At some N the run is killed mid-loop, and because `processTenant` catches
per-tenant failures and never throws, **the tenants after the cutoff get nothing at all — no
`p2_filing_packages` row, no failure status, no `error_reason`, and therefore nothing for any
monitor keyed on `status='failed'` to find.** A monitor that only inspects rows cannot see a tenant
that never got a row. This is precisely the silent-failure shape R3 exists to prohibit.

**Measure it before designing around a guess. `[UNVERIFIED — measure on the 5 Oct 2026 run]`**

```sql
-- Per-tenant wall clock for the October run. Run on 5 Oct, after the cron has fired.
SELECT tenant_id, status, created_at, updated_at,
       EXTRACT(EPOCH FROM (updated_at - created_at)) AS seconds
FROM p2_filing_packages
WHERE period_month = '2026-09'
ORDER BY created_at;
```

Take the max and the median. `ceiling ≈ invocation_limit / median_seconds` is the tenant count at
which the October architecture stops working. Write the number into this document when it is known.

**The fix — dispatcher plus drain.** Two crons, one new table, no new Edge Function.

```
cron 'filing-package-dispatch'   (5th, 02:30 UTC / 08:00 IST)
   → filing-package { mode: 'dispatch' }
       enqueues one p2_job_queue row per eligible tenant. Writes no workbooks.
       Bounded, fast, O(1) per tenant. Cannot time out.

cron 'filing-package-drain'      (every 2 min, 5th–7th)
   → filing-package { mode: 'drain' }
       claims up to 3 queued jobs with FOR UPDATE SKIP LOCKED,
       runs processTenant on each, marks done/failed, returns.
       Each invocation is bounded by 3 tenants regardless of book size.
```

```sql
CREATE TABLE p2_job_queue (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_type     text NOT NULL,          -- 'filing_package' | 'onboarding_parse' | ...
  tenant_id    uuid,                   -- nullable: A1 submissions can precede a tenant
  payload      jsonb NOT NULL DEFAULT '{}',
  status       text NOT NULL DEFAULT 'queued'
                 CHECK (status IN ('queued','running','done','failed','dead')),
  attempts     int NOT NULL DEFAULT 0,
  max_attempts int NOT NULL DEFAULT 3,
  claimed_at   timestamptz,
  error_reason text,
  dedupe_key   text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (job_type, dedupe_key)
);
ALTER TABLE p2_job_queue ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON p2_job_queue FROM anon, authenticated;   -- service-role only, as p2_ops_alerts
CREATE INDEX p2_job_queue_claim_idx ON p2_job_queue (job_type, status, created_at)
  WHERE status = 'queued';
```

Claim with `FOR UPDATE SKIP LOCKED` so two overlapping drain invocations cannot take the same job —
the same row-locking discipline `confirm_bom_issue` already uses for stock sufficiency
`[VERIFIED]`. `UNIQUE (job_type, dedupe_key)` with `dedupe_key = tenant_id || ':' || period_month`
makes enqueueing idempotent, so a dispatcher that runs twice cannot double-generate. A job stuck in
`running` past a timeout is reclaimed by the next drain and counts an attempt; at `max_attempts` it
goes `dead` and raises a `critical` ops alert.

**Why this belongs to A6 rather than standing alone.** A6's entire job is "did every tenant get
their package, and if not, why." Once the queue exists that question is a `SELECT` over
`p2_job_queue` rather than an inference over `p2_filing_packages`, and the un-enqueued-tenant blind
spot closes: the dispatcher writes a row per *eligible tenant*, so a tenant with no row is a
dispatcher bug and a tenant with a `dead` row is a generation bug. Two distinguishable failures
instead of one invisible one.

**Reuse.** A1 uses the same queue for `onboarding_parse` jobs, which have an identical shape —
long-running, per-unit-of-work, must not block a request. Build it once, in A6, because A6 needs it
first and needs it by October.

### 3.4 Prerequisites that are not automations

Four items that block automations and are not themselves automation work. None should be discovered
mid-build.

**P1 — PVT LTD incorporation.** Blocks Razorpay KYC for A5/A7 Wave 4 integration. Does NOT block
Wave 3 versions of A5/A7 which use manual payment triggers. Start incorporation immediately — it
still gates WhatsApp Business API (P3) and the code-signing certificate.

**P2 — `set_tenant_id()` must fill, not clobber. `[UNVERIFIED — read the live function body
first]`** A1's import is one `SECURITY DEFINER` RPC writing to ten trigger-bearing tables in one
transaction (§4.1). `CLAUDE.md` documents the hazard explicitly: "a trigger deriving from
`get_my_tenant_id()` would clobber a service-role insert's explicit `tenant_id` with NULL (no
`auth.uid()` in that context)" — which is why `p2_notifications` has no such trigger. The general
fix is to make the trigger conditional:

```sql
-- Verify the current body first — it was applied directly in the SQL Editor
-- and has NO migration file (CLAUDE.md, RLS Fixes, Session 1–2).
SELECT prosrc FROM pg_proc WHERE proname = 'set_tenant_id';

-- Target shape: fill when absent, never overwrite an explicit value.
IF NEW.tenant_id IS NULL THEN
  NEW.tenant_id := get_my_tenant_id();
END IF;
```

This touches a trigger attached to **ten tables** `[VERIFIED — CLAUDE.md lists them]`. It is a
one-line change with a wide blast radius: apply on the test tenant, then run
`node _ai/regression/snapshot.js` and diff against the most recent prior snapshot — **not** against
`baseline-pre-2H.json`, per `CLAUDE.md`'s standing instruction. If the change is judged too risky,
the fallback is for A1's import RPC to be invoked by the owner's authenticated session rather than
by service role, which makes `get_my_tenant_id()` correct. §4.1 specifies that path anyway for
independent security reasons, so P2 is an improvement rather than a hard blocker.

**P3 — WhatsApp Business Cloud API access.** Blocks A1's WhatsApp channel (§5) and A4's WhatsApp
surface. Requires a verified Meta Business account, which in practice wants the legal entity — so
it trails P1. Order it the week incorporation completes, alongside the code-signing certificate
`enterprise-strategy.md` §9 Q5 already schedules there.

**P4 — A GitHub repository with issues enabled, and a scoped token.** A2 and A4 both auto-create
issues. Confirm `git remote -v` and the issue tracker state before A2 is built; the token is an
Edge Function secret with `issues:write` on one repository and nothing else.

---

## 4. The Automations

Each section states: the problem, the manual process and its real duration, the architecture, the
model and why, the trigger, the output, error handling, cost, build classification, the
founder/automation split, and founder time saved per month at 100 clients.

### 4.1 A1 — Client Onboarding: Data Ingestion

**Build: 3–4 sessions. New Edge Function + new tables + new page + changes to `onboarding.html`.
Critical at ~15 clients, and before any KPML vendor wave.**

#### The problem

Onboarding is the only operational task whose per-client cost is measured in hours rather than
minutes, and it arrives in bursts. Datta Prasad took 264 materials, 28 suppliers and 97 price
records; `CLAUDE.md` records that the materials had to go in "via direct SQL" because
`importMaterials()` had a batch-race bug at the time. Shivprasad is still recorded as "products,
materials, prices not yet fully loaded" — **three weeks after onboarding** `[VERIFIED]`. That is
the honest state of the manual process at three clients.

The forcing function is KPML. Twenty vendors onboarding together at 3–6 hours each is 60–120
founder-hours in a window where the founder is also running a pilot. It cannot be done, and the
pilot's credibility depends on it being done well.

#### The manual process today, timed

| Step | Today | Time |
|---|---|---|
| Receive files, work out what they are | WhatsApp / email, mixed formats | 20–40 min |
| Reshape client data into the template's columns | By hand in Excel | 60–150 min |
| Chase missing HSN, UQC, GSTIN, units | Phone calls | 30–90 min |
| Import via `onboarding.html` steps 3–6 | 4 sequential CSV imports | 20–40 min |
| Reconcile BOM against material names | By eye | 30–90 min |
| Fix what the import rejected | Direct SQL, sometimes | 20–60 min |
| **Total** | | **3–6 hours** |

`onboarding.html` is a real and working tool — 7 steps, 1,668 lines, template downloads, preview
tables, dedupe before chunking `[VERIFIED]`. What it is not is *tolerant of the input clients
actually send*. It requires the client's data to already be in Nexflow's column shape. The founder
is the adapter, and the adapter is the three to six hours.

#### Architecture

```
  Excel · CSV · PDF · photo · text · WhatsApp
                    │
                    ▼
        ┌───────────────────────────┐
        │  onboard-ingest           │  new Edge Function, verify_jwt = false
        │  { action: 'submit' }     │  stores raw file → private Storage bucket
        └───────────┬───────────────┘  writes p2_onboarding_submissions (status 'received')
                    │                  enqueues p2_job_queue (job_type 'onboarding_parse')
                    ▼
        ┌───────────────────────────┐
        │  onboard-ingest           │  drained by cron, one submission per invocation
        │  { mode: 'drain' }        │
        └───────────┬───────────────┘
                    │
      ┌─────────────┼─────────────────────────────────┐
      ▼             ▼                                 ▼
  EXTRACT       NORMALISE + VALIDATE             ADJUDICATE
  (code +       (code only — R1)                 (Opus — judgment only)
   Haiku OCR                                      · column → schema mapping
   assist)       · GSTIN format + state code      · duplicate candidate pairs
                 · unit conversion table          · ambiguous unit semantics
   xlsx/csv →    · BOM arithmetic bounds          · what a free-text row means
   SheetJS      · duplicate CANDIDATE generation  · ranking issues by severity
   pdf/image →   · HSN via existing suggest_hsn
   Haiku vision                  │
                                 ▼
                    ┌────────────────────────┐
                    │ p2_onboarding_submissions │  parsed jsonb + flags jsonb
                    │ status = 'review'         │  green / amber / red per row
                    └────────────┬──────────────┘
                                 ▼
              onboarding-review.html?token=<review_token>
              (public read via token; import requires an authenticated session)
                                 ▼
              RPC import_onboarding_submission()  — one transaction, all or nothing
```

#### What each layer does, and why the split is exactly here

**Extraction (code, plus Haiku for pixels).** `.xlsx`/`.csv` parse deterministically with SheetJS,
already loaded in this codebase by `gstr2b-reconcile.html` `[VERIFIED]`. PDFs and photographs of
handwritten registers need a vision model; Haiku 4.5 is correct — a bounded transcription task with
latency that matters. **Haiku transcribes to a grid. It does not interpret the grid.** A
handwritten register becomes rows of strings and nothing more; every subsequent decision runs
through the same path as an uploaded spreadsheet. One pipeline, many transports (§5 makes the same
argument for WhatsApp).

**Normalisation and validation (code only — R1).**

- **GSTIN.** 15 characters, checksum, state code in the 38-value map `export.html` already carries
  `[VERIFIED — GST_STATE_CODES, expanded to 37 states + 38 + 97 on 2 Sept 2026]`. State and place
  of supply derive from characters 1–2. Malformed → **red**, never guessed.
- **Unit conversion.** A fixed table: kg↔g↔mg, m↔cm↔mm, l↔ml, nos/pcs/pieces as identity. The model
  may *identify* that "200 grams" means value 200 in unit `g`; **code** does `200 g → 0.2 kg`. A
  unit outside the table is **red**, never inferred. And the hard rule: **any row that required a
  conversion is amber even when the arithmetic is unambiguous**, because a wrong assumption about
  which unit the client meant is unrecoverable once it is in `p2_product_bom`.
- **UQC.** Map to the GSTN codes already in use (`NOS`/`KGS`/`MTR`/`LTR`/`PCS`/`SQM`/`CBM`/`OTH`),
  reusing the Session 3 backfill logic. An unmappable unit gets `OTH` and an amber flag —
  `CLAUDE.md`'s existing distinction holds: `OTH` means "checked, doesn't map cleanly," `NULL`
  means "never set."
- **HSN.** Call the **existing** `suggest_hsn` handler on `agent-query` — it already exists, is
  already shape-validated, already logs to `p2_agent_logs` with `intent='hsn_audit'`, already caps
  at 25 items per call, and already sits outside the daily agent quota `[VERIFIED — Session 14]`.
  Do not write a second HSN path. Confidence maps directly onto the band: `high` → amber
  (pre-filled, tick to accept), `medium`/`low` → amber with the "verify with your CA" label, never
  green. An AI-derived HSN is **never** auto-imported, per `enterprise-strategy.md` §3.3 rule 1,
  and `hsn_source` is written as `'ai_suggested'` so the filing package's exceptions section can
  later say how many codes no human ever confirmed.

**Duplicate detection — the part that needs both halves.** The brief's own example proves why:
"Copper Wire 0.9mm" and "CW-0.90" normalise to `COPPERWIRE09MM` and `CW090`. **String distance
fails on this pair.** So recall comes from code, precision from the model:

- *Code generates candidates* by three independent routes: normalised exact match; shared numeric
  tokens plus token-subset overlap (`0.9`/`0.90` matches, `CW` is a subset of the initials of
  "Copper Wire"); and `material_code` cross-reference against existing rows.
- *Opus adjudicates each candidate pair* — genuine judgment, and cheap because it sees only the
  pairs, never the 264 rows.
- *Every merge is amber.* A merge decision is never auto-applied. Merging two materials that were
  actually distinct silently fuses two stock ledgers, and `p2_stock_transactions` is append-only —
  there is no clean undo.

**BOM validation — "wrong quantities corrupt stock forever."** Four deterministic checks and one
model check:

1. `qty_per_unit > 0` and finite. Otherwise **red**.
2. Every BOM ingredient resolves to a material in the same submission or already in the tenant.
   Otherwise **red** — this is the single most common real failure and it is trivially detectable.
3. Every product has ≥ 1 BOM line. Zero lines → **red** (a product with no recipe consumes nothing
   on dispatch, and the error surfaces months later as stock that never moves).
4. **Order-of-magnitude outlier check.** For each material, compute `qty_per_unit` across every
   product using it; flag any value more than 20× the median for that material as **amber**. This
   is what catches "500 kg copper wire per motor" — not a hardcoded plausibility table, which would
   be customer-specific logic (R2) and wrong for the next industry. The client's own data supplies
   the norm.
5. Opus reads only the flagged outliers plus their product context and says whether the outlier
   looks like a unit error, a genuine bulk item, or a typo. **Its answer changes the amber
   explanation text. It cannot clear the flag.** (R1a.)

Where a product's unit weight is known, a mass-sum sanity check is worth adding; in practice it is
usually unknown, and the honest statement is that Nexflow cannot validate absolute plausibility —
only internal consistency. Say so in the review UI rather than implying more assurance than exists.

#### Confidence bands

| Band | Meaning | Import behaviour |
|---|---|---|
| **green** | Every deterministic validation passed and no model judgment was required | Included in "Approve all green" |
| **amber** | A judgment was made, a value was derived, or an outlier was detected | One tick each, or "accept all amber in this section" |
| **red** | Deterministic validation failed | **Blocks import of the whole submission** until resolved or the row is dropped |

**Red is always deterministic and never model-judged.** A model must never be the thing that
decides an import is safe (R1a). Model output can only ever add an amber.

#### Review UI

New page, `onboarding-review.html`, root level, no navbar — the same three-state shape as
`receive.html` and `invoice.html` (valid token → content; missing token → "Invalid link";
bad/expired → "not valid or expired") `[VERIFIED]`. Read access is by `review_token` through a
public Edge Function with a UUID regex guard and service-role read, which is the established
pattern this codebase already runs twice (`receive-dispatch`, `invoice-view`). Zero new auth
design.

**But the import button requires an authenticated session for that tenant.** Two reasons, and both
matter:

1. A review token that could write into a tenant is a capability token for the tenant's entire
   master data. Read and write must not share a credential.
2. The import RPC's correctness depends on it (below).

Sections: Company · Materials · Products · BOM · Suppliers · Clients · Staff · Settings. Each shows
a count row (`241 green · 18 amber · 5 red`), worst-first ordering within the section, and inline
editing for amber and red. Reuse the verdict colour convention already established by the HSN audit
and the ITC-04 workbook — `FFD4F7DC` green, `FFFFF0B3` amber, `FFFFC9C9` red `[VERIFIED]`. All
client-facing strings are bundles (§3.2).

#### Atomic write

One `SECURITY DEFINER` RPC, one transaction:

```sql
import_onboarding_submission(p_submission_id uuid, p_accepted_row_ids uuid[])
```

FK-ordered inserts: materials → products → BOM (needs both) → suppliers → clients → staff →
settings. Any failure rolls the whole thing back and stamps `error_reason`. **Do not implement this
as a sequence of PostgREST inserts from the browser** — that is what `onboarding.html` does today
and it is exactly why the 17 Aug 2026 bug scan found duplicate-name conflicts spanning 50-row batch
chunks, fixed by dropping the batch loop entirely `[VERIFIED]`. One statement per table, one
transaction, one outcome.

**The RPC is called by the owner's authenticated session, not by service role.** This makes
`get_my_tenant_id()` return the right value, so the `set_tenant_id()` trigger on all ten target
tables behaves correctly without needing P2 (§3.4). P2 remains worth doing, but A1 does not block
on it.

#### Batch mode — the KPML case

One Excel with 20 vendor sheets. Each sheet becomes **its own submission row** sharing a
`batch_id`, its own `review_token`, its own review link, and its own atomic import. Nothing is
shared except the batch id and a founder-facing progress view.

This falls straight out of R2 and is worth stating explicitly because the tempting alternative — one
giant submission with a vendor column — is wrong three ways: one vendor's red row would block
nineteen other vendors' imports; a vendor reviewing the batch would see nineteen competitors' cost
structures, which is the cross-tenant leak `kpml-network-plan.md` §10.5 treats as unrecoverable;
and the twenty imports must land in twenty different tenants under twenty different sessions
anyway. **Sheet-per-submission is not a convenience, it is the isolation boundary.**

Sequencing note: the import step needs each vendor's tenant to exist and their owner to be able to
sign in. Either A7 provisions them first, or the founder provisions manually and the review links
go out after. Parsing and review can begin before the tenant exists (`tenant_id` is nullable on the
submission); only import is gated.

#### Model choice

| Job | Model | Why |
|---|---|---|
| Column → schema mapping | **Opus 5** | Reads a stranger's mental model of their own factory from headers like `WT/PC`, `RM CODE`, `QTY REQD`. Cross-references across sheets. This is the judgment the three-to-six hours actually consists of. |
| Duplicate pair adjudication | **Opus 5** | "CW-0.90 is plausibly Copper Wire 0.9mm" requires domain inference, and a wrong merge is unrecoverable |
| BOM outlier interpretation | **Opus 5** | Same call, same context — no extra request |
| Handwritten / PDF transcription | **Haiku 4.5** | Bounded transcription, latency matters, no judgment |
| HSN suggestion | **Haiku 4.5** | Already built (`suggest_hsn`), already correct per `enterprise-strategy.md` §3.3 |

Opus, not Haiku, for the mapping — and the reasoning is the same as
`enterprise-strategy.md` §3.2's "Why Opus and not Haiku": the task is to *notice things nobody
asked about*, across heterogeneous rows, where being wrong corrupts a ledger. An onboarding runs
**once per client, ever.** Choosing the cheaper model to save ₹30 on a ₹35,000 setup fee would be
an unforced error.

**Bound the input by construction.** Opus sees the column headers, a 20-row sample per sheet, the
Nexflow target schema, the deterministic validation results, and the flagged candidates. It does
**not** see 264 rows of material master. This keeps cost flat regardless of client size and is the
same discipline that keeps the filing package's input bounded.

#### Trigger, output, error handling

| | |
|---|---|
| **Trigger** | `{action:'submit'}` from `onboarding.html`, the review page, or the WhatsApp webhook (§5). Parsing is queued, never inline. |
| **Drain cron** | `onboarding-parse-drain`, every 2 minutes, `{mode:'drain'}`, one submission per invocation |
| **Output** | `p2_onboarding_submissions.parsed` + `.flags`, status `review`, a review link emailed/WhatsApped to the client in their `preferred_lang`, and an `opsAlert('onboarding', 'monitor', …)` to the founder summarising counts |
| **On parse failure** | Status `failed`, `error_reason` stored verbatim, `important` ops alert, client told "we could not read this file — here is what we need" in their language. **Never a raw parser error to a client.** |
| **On import failure** | Transaction rolls back; nothing written; status returns to `review`; `error_reason` shown inline; `critical` ops alert |
| **On model failure** | Degrade, do not fail. Opus unavailable → deterministic validation still runs, every judgment-requiring row becomes **amber with "needs review — automatic mapping unavailable"**, and the submission still reaches review. Same three-layer philosophy as `callOpusCoveringNote`'s Opus → Haiku → deterministic chain `[VERIFIED]`. The review page is the product; the mapping is the polish. |
| **Expiry** | `review_token_expires_at`, 30 days. Ship with expiry — the `telegram_bind_token` shipped without it and had to have it retrofitted in Session 6 `[VERIFIED]`. Do not repeat that. |

#### Cost

Per onboarding, Opus 5 at $5/$25 per MTok and Haiku 4.5 at $1/$5, ₹90/USD:

| Component | Tokens | Cost |
|---|---|---|
| Opus mapping + adjudication | ~20k in, ~10k out | ₹31.50 |
| Haiku HSN, 264 materials (11 calls of 25) | — | ₹27.00 |
| Haiku transcription / parse assists | ~15k in, ~5k out | ₹3.60 |
| **Typical total** | | **≈ ₹62** |
| Worst case (messy, two Opus passes, photographed registers) | | ≈ ₹110 |

Against the ₹1,000 budget from the ₹35,000 setup fee: **16× headroom.** Twenty KPML vendors
simultaneously cost about **₹1,240, one time.** The brief's ₹67 estimate is accurate.

#### Founder vs automation

| Automation does | Founder does |
|---|---|
| Accepts any format, any channel | Sends the client the link (or A5/A7 does) |
| Maps columns to schema | Reviews red rows — the only mandatory touch |
| Validates GSTIN, units, BOM arithmetic | Decides an ambiguous merge the model flagged low-confidence |
| Suggests HSN, flags outliers | Calls the client when data is genuinely missing |
| Generates 20 review links for a batch | Confirms the batch went out |
| Imports atomically on client approval | Nothing |

**Founder time: 3–6 hours → ~30 minutes per client.** At 100 clients and 8 new clients/month:
**saves ~32 hours/month.**

#### New objects

New Edge Function `onboard-ingest` (`verify_jwt = false`) · new tables
`p2_onboarding_submissions`, `p2_onboarding_files` · new RPC `import_onboarding_submission` · new
page `onboarding-review.html` · new private Storage bucket `onboarding-uploads` (modelled on
`filing-packages`, never public) · new cron `onboarding-parse-drain` · changes to
`onboarding.html` (an "AI import" entry point alongside the existing manual steps — **the manual
path stays**, as the fallback and as the thing that works when a model is down).

### 4.2 A2 — Compliance Monitoring

**Build: 1.5 sessions. New Edge Function + new cron + new table + a constants inventory.
Critical now. Cost is flat at every client count.**

#### The problem

GST rules change, and a change Nexflow misses is wrong for **every client at once**. The B2CL
threshold is the proof (§1, finding 4): ₹2.5 lakh in `export.html` against a statutory ₹1 lakh from
1 November 2024, corrected 9 September 2026. Twenty-two months. The manual process is not
theoretically fragile; it has already failed, at a client count of three, and was caught by
conversation rather than by process.

The asymmetry is what makes this worth building early: **one fix reaches every client
simultaneously.** A competitor with ten employees fixes compliance once and then spends the rest of
the month propagating it. Nexflow fixes it once and is done. That is not a marketing line, it is a
structural property of single-tenant-codebase SaaS, and A2 is what converts it from a property into
an advantage — because the advantage is worthless if the change is never noticed.

#### The manual process today

Reading CBIC notifications, GSTN portal updates and CA WhatsApp groups, irregularly, when something
prompts it. Roughly 4 hours a month when it happens, zero when it does not, and no record of what
was reviewed. Miss rate: demonstrably non-zero.

#### Architecture

```
  cron 'compliance-scan-weekly'  (Mon 03:00 UTC / 08:30 IST)
        │
        ▼
  compliance-scan  (new Edge Function, verify_jwt = false)
        │
        ├─ 1. FETCH     CBIC notification feed + GSTN downloads page
        │               (bounded: items newer than last_seen_at, max 40)
        │
        ├─ 2. FILTER    code: drop anything already in p2_compliance_watch by doc id
        │
        ├─ 3. SUMMARISE Haiku, per notification → { what_changed, affects, area }
        │
        ├─ 4. LOCATE    code: grep _ai/compliance-constants.json for `area`
        │               → concrete file:line references. NEVER the model's job.
        │
        ├─ 5. CLASSIFY  Haiku proposes CRITICAL | IMPORTANT | MONITOR
        │               Opus confirms any proposed CRITICAL before it alarms
        │
        └─ 6. EMIT      GitHub issue + opsAlert(critical → now, else → weekly digest)
```

**Step 4 is the part that makes this useful rather than a news feed.** A new checked-in file,
`_ai/compliance-constants.json`, is the inventory of every statutory constant in the codebase, with
its location and the area it belongs to:

```json
[
  { "area": "b2cl_threshold", "const": "B2CL_THRESHOLD",
    "locations": ["export.html", "supabase/functions/filing-package/index.ts"],
    "current": 100000, "authority": "Notification 12/2024, eff. 2024-11-01" },
  { "area": "uqc_codes", "const": "UQC list",
    "locations": ["settings.html", "products.html", "supabase/functions/filing-package/index.ts"],
    "current": ["NOS","KGS","MTR","LTR","PCS","SQM","CBM","OTH"], "authority": "GSTN UQC master" },
  { "area": "s143_periods", "const": "inputs 365d / capital goods 3y",
    "locations": ["js/s143-clock.js", "supabase/functions/filing-package/index.ts"],
    "current": [365, 1095], "authority": "CGST s.143(1)" },
  { "area": "msme_payment_days", "const": "45-day 43B(h) threshold",
    "locations": ["export.html", "supabase/migrations/20260901_payment_status_invoice_date.sql"],
    "current": 45, "authority": "MSMED s.15 / IT s.43B(h)" },
  { "area": "challan_number_length", "const": "chk_challan_number_length",
    "locations": ["supabase/migrations (SQL Editor)", "export.html challanSeriesKey()"],
    "current": 16, "authority": "CGST Rule 46(b) / 55" },
  { "area": "gst_state_codes", "const": "GST_STATE_CODES",
    "locations": ["export.html", "supabase/functions/filing-package/index.ts"],
    "current": "38 states + 97", "authority": "GSTN state code master" },
  { "area": "gst_rate_flat", "const": "flat 18% invoice split",
    "locations": ["supabase/functions/agent-query/index.ts buildInvoiceTotals"],
    "current": 18, "authority": "GST Scope lock — deliberate simplification" }
]
```

**This file is a deliverable in its own right**, independent of the automation: it is the first
written inventory of where Nexflow hardcodes the law. Building it will surface duplicated constants
across `export.html` and `filing-package/index.ts` that today can silently diverge — which is
itself a finding worth the session. Maintaining it becomes a rule: **a session that hardcodes a
statutory value adds a row to this file in the same commit** (the same enforcement shape
`tutorial-engine.md` §10.1 uses for tutorial configs).

#### Model choice

| Job | Model | Why |
|---|---|---|
| Summarise a notification in plain English | **Haiku 4.5** | Bounded summarisation of one document. Exactly what Haiku is for. |
| Propose a classification | **Haiku 4.5** | First-pass triage against the affected-area list |
| Confirm a proposed CRITICAL | **Opus 5** | A CRITICAL alarm says "fix within 48 hours" and creates real urgency. A false one, weekly, trains the founder to ignore the channel — which is how alerting systems die. Opus sees the notification, the affected constant's current value, its authority, and the code context, and confirms or downgrades. **~2 calls/week.** |
| Locate affected code | **Neither** | `grep` over the inventory. R1. |

The Opus gate is a deliberate addition to the brief, and the justification is asymmetric cost: a
missed CRITICAL costs a wrong filing; a false CRITICAL costs the channel's credibility. Both are
expensive, and ₹14/week buys down the second.

#### Trigger, output, error handling

| | |
|---|---|
| **Trigger** | `cron.schedule('compliance-scan-weekly', '0 3 * * 1', …)` — Monday 08:30 IST. Anon key in the Authorization header, `verify_jwt = false`, service role inside: the pattern confirmed live for jobnames `check-low-stock-daily`, `gstr2b-nudge-monthly`, `payment-overdue-notify-daily` and `filing-package-monthly` `[VERIFIED]`. |
| **Output — CRITICAL** | Immediate `opsAlert(severity:'critical')` **and** a GitHub issue labelled `compliance/critical` containing the notification text, the affected constant, its `file:line` references, its current value, and the authority citation |
| **Output — IMPORTANT** | GitHub issue, `important` alert folded into the weekly digest |
| **Output — MONITOR** | Row in `p2_compliance_watch` only. No issue, no alert. Visible when asked. |
| **Feed unreachable** | `attempts++`, retry next run. Two consecutive failures → `important` alert: *"Compliance feed unreachable for 2 weeks."* **A scanner that silently stops is worse than no scanner** (R3) — this is the specific case that rule exists for. |
| **Model failure** | Fall back to raw notification titles plus deterministic grep hits. Shorter, never absent. |
| **Never** | A2 does not edit code, open a PR, or change a constant. It produces an issue and a citation. The fix is founder judgment (§9). |

#### Cost

| Component | Per run | Per month |
|---|---|---|
| Haiku summarise + classify, ~15 items/week (3k in, 500 out each) | ₹7.40 | ₹32 |
| Opus CRITICAL confirmation, ~2/week (8k in, 1.5k out) | ₹14.00 | ₹60 |
| **Total** | | **≈ ₹92/month** |

**Flat at 10 clients and flat at 1,000.** One scan serves the entire book. This is the moat
quantified: the per-client cost of compliance monitoring falls from ₹9.20 at ten clients to ₹0.09
at a thousand, and the founder-hours cost does not rise at all.

#### Founder vs automation

| Automation does | Founder does |
|---|---|
| Watches CBIC and GSTN weekly, without fail | Reads one weekly digest |
| Summarises each change in plain English | Decides what the change means for Nexflow's schema |
| Locates the exact constant and file | **Writes the fix** |
| Classifies and escalates CRITICAL within a day | Confirms the classification when it disagrees |
| Opens the issue with full context | Asks the CA when the law is ambiguous |

**Founder time: ~4 hrs/month → ~2 hrs/month**, with the saved time being the *searching*, and the
remaining time being the *judging*. **Saves ~2 hours/month at any client count** — and the real
return is not hours, it is the twenty-two-month miss not happening again.

#### New objects

New Edge Function `compliance-scan` · new table `p2_compliance_watch` (doc id, source, title, url,
published_at, area, classification, summary, issue_url, status, created_at — service-role only, no
tenant_id) · new cron `compliance-scan-weekly` · new file `_ai/compliance-constants.json` · GitHub
token secret (P4).

### 4.3 A3 — Daily Operations Digest

**Build: 1 session. New Edge Function + new cron. Depends on A0. Critical at ~20 clients.**

#### The problem

Knowing what happened overnight currently means opening `admin-agent.html`, the Supabase logs, the
`p2_filing_packages` table and the Telegram history — about 20 minutes a day, done inconsistently,
and impossible to do at all across 100 tenants.

#### Architecture, and why it is a new function

```
  cron 'ops-digest-daily'  (02:00 UTC / 07:30 IST)
        │
        ▼
  ops-digest  (new Edge Function)
        │
        ├─ ONE SQL aggregation pass, cross-tenant, bounded output:
        │    · p2_filing_packages     — failed / generating / emailed, last 24h
        │    · p2_job_queue           — dead, stuck-running, queue depth
        │    · p2_agent_logs          — error rate, quota breaches, intent mix
        │    · p2_ops_alerts          — unacknowledged critical/important
        │    · p2_notifications       — status='failed' count
        │    · p2_onboarding_submissions — completed / failed / awaiting review
        │    · auth + p2_tenant_settings — first logins, 14-day-inactive tenants
        │    · p2_subscriptions       — renewals at 7/30d, grace, failed (once A5 exists)
        │    · HEARTBEATS             — last successful run of every cron (R3)
        │
        ├─ Haiku: narrate the aggregate. ≤200 words. Ranked by urgency.
        │
        └─ opsAlert('digest', severity by worst item, …)
```

**Why not a fifth mode on `check-low-stock`.** The codebase precedent points the other way —
`gstr2b_nudge`, `payment_overdue_digest` and `payment_overdue_notify` all went in as modes on that
function, each explicitly noted as "no new Edge Function file" `[VERIFIED]`. That precedent is good
and should normally be followed. It does not apply here, for one specific reason: **every existing
mode iterates tenants and messages *that tenant*. The digest reads across all tenants and messages
*the founder*.** A bug in a cross-tenant reader living inside a per-tenant messaging function could
send one tenant another tenant's data — the failure `kpml-network-plan.md` §10.5 treats as
market-wide and unrecoverable. `check-low-stock` is already 598 lines with four modes. Isolation is
worth one file. Note the divergence from precedent in the commit message so a future session knows
it was considered.

**The input is bounded by construction (R1).** SQL produces counts and at most the top 5 rows per
category. The model receives a JSON summary of fixed shape and never sees a log table. This is what
keeps the digest's cost and length flat from 10 clients to 1,000 — at a thousand tenants the
aggregate is *the same shape*, just with larger numbers.

**Heartbeats are the highest-value section and are easy to omit.** Every cron writes its last
successful run to `p2_ops_alerts` (or a small `p2_cron_heartbeat` table). The digest asserts each
one ran within its expected window. **A cron that silently stopped is the failure this codebase is
most likely to actually have** — `pg_cron` jobs are invisible until someone looks, and nobody looks.
R3 exists for this case.

#### Model choice

**Haiku 4.5.** Log summarisation with a fixed input shape and no judgment — the canonical Haiku
task. The urgency *ranking* is deterministic (severity, then age, then blast radius); the model
writes the prose. If Haiku fails, emit the deterministic bullet list. The digest must arrive every
morning, in some form, forever — and a plain list of counts is a perfectly good digest.

#### Output

Telegram, 07:30 IST, under 200 words, plain text. Two shapes:

```
Nexflow ops — 11 Sep

All good. 3 tenants, 0 failures.
Agent: 14 queries, 0 errors. Filing: n/a (next run 5 Oct).
All 5 crons ran on schedule.
```

```
Nexflow ops — 6 Oct

⚠ 2 items need you.
1. CRITICAL — filing package failed for Shivprasad Industries
   (storage upload timeout). Auto-retry at 11:00 failed. Queue row is dead.
2. Datta Prasad has not logged in for 16 days. Last activity 20 Sep.

Everything else: 98/100 packages emailed, 3 retried and succeeded.
Agent 412 queries, 1.2% errors. All 6 crons on schedule. Opus spend this
month ₹2,430.
```

The 200-word cap is a hard design constraint, not a preference (§2, test 1). If the digest cannot
fit, the correct response is to raise the alert threshold, **not** to lengthen the message.

#### Cost

8k input, 400 output on Haiku = **₹0.90/day ≈ ₹27/month** at 10–100 clients; ~₹50/month at 500–1,000
as the bounded aggregate grows modestly. Negligible at every scale.

#### Founder vs automation

| Automation does | Founder does |
|---|---|
| Reads 8 tables across every tenant, daily | Reads 200 words with coffee |
| Confirms every cron actually ran | Acts on the 1–2 flagged items |
| Ranks by urgency | Decides whether a flagged item is real |
| Surfaces inactivity before it becomes churn | Makes the retention call (§9) |

**Founder time: 10 hrs/month → 2.5 hrs/month at 100 clients. Saves ~7.5 hours/month.**

#### New objects

New Edge Function `ops-digest` · new cron `ops-digest-daily` · optional `p2_cron_heartbeat` table ·
`opsAlert` calls added to every existing cron entry point for heartbeat coverage.

### 4.4 A4 — Customer Support

**Build: Phase 1 — 1.5 sessions. Phase 2 — 2 sessions. Phase 1 at ~25 clients, Phase 2 at ~40.**

#### The problem

Eighty percent of support is the same twenty questions. At three clients the founder answers them
on WhatsApp in a minute. At a hundred clients that is ~20 hours a month of retyping, in two
languages, during the 1st–11th filing window when the founder is least able to spare it.

#### Why this splits into two phases

The brief specifies one automation. It is really two, with very different cost/value profiles, and
merging them delays the cheap half by months:

- **Phase 1 — the escalation and capture layer.** Pure plumbing, no knowledge base, no new model
  work. It makes support *observable* and gives the founder a Telegram-native way to answer without
  opening a laptop. Useful from client five.
- **Phase 2 — the KB-backed agent.** The thing that actually deflects questions. Needs a knowledge
  base, and a knowledge base needs answered questions to exist — **which Phase 1 produces.**

Phase 1 is therefore not a stepping stone for schedule reasons; it is the data source Phase 2 is
built on. Build it early so the KB is already accreting by the time Phase 2 starts.

#### Phase 1 architecture

```
  Client (in-app chat / WhatsApp)
        │
        ▼
  p2_support_threads  (tenant_id, channel, status, lang, created_at)
  p2_support_messages (thread_id, role, body, created_at)
        │
        ├─► opsAlert('support', 'important', …) with full thread context
        │
        └─► Founder replies in Telegram:  /reply <thread_id> <text>
                  │
                  ▼
            telegram-webhook  (extended — second branch after /start)
                  │
                  ├─► p2_support_messages (role 'founder')
                  ├─► in-app notification to the client (existing notify path)
                  └─► p2_support_kb draft row, status 'unreviewed'   ◄── the accretion
```

**Bug reports.** A client describing a bug gets one structured capture — page, action, expected,
actual, role, plan, browser — written to the thread, turned into a GitHub issue, and alerted. The
structure is what makes it actionable; a free-text "it's not working" costs the founder a round
trip that the capture form removes. Reuses P4's token.

**The knowledge base accretes automatically.** Every founder reply drafts a `p2_support_kb` row
carrying the question, the answer, the tenant's plan and role context, and `status='unreviewed'`.
Reviewing a draft is a 30-second action in a weekly batch. **This is the whole reason Phase 1 comes
first:** by the time Phase 2 ships, the KB is populated with real questions in the real words
clients used, rather than twenty articles the founder imagined.

#### Phase 2 architecture

A new `body.action` on the **existing** `agent-query` Edge Function — `support_query` — following
the exact precedent of `suggest_hsn` (Session 14): it inherits `verifyCallerTenant`, CORS, the
Anthropic key and `p2_agent_logs` logging, and requires no new function to deploy, secure or
monitor `[VERIFIED]`.

Five decisions, each with a reason:

1. **It does not consume the daily agent quota.** Same reasoning that took `suggest_hsn` outside
   it: the quota exists for the chat copilot. Charging a client's quota to ask why their invoice
   button is greyed out is wrong, and `plan='lite'` maps to a limit of **0** `[VERIFIED]`, which
   would lock Lite tenants — the tenants most likely to need help — out of support entirely.
2. **It is available on every plan, including Lite and demo.** Support is not a feature.
3. **The KB is the context, not the schema.** `support_query` retrieves matching KB articles and
   answers from them. It does **not** get the read-only intent surface — a support question is
   "why can't I do X," not "what is my stock." Those are different jobs and `agent-query`'s existing
   28 read-only intents already do the second one.
4. **It answers in the language of the question**, with KB articles carrying per-language bodies
   (§3.2). Marathi articles go through `tutorial-engine.md` §8.5's authoring process including the
   read-aloud gate. **An unreviewed Marathi answer must not ship** — mark it `// UNREVIEWED` and
   fall back to English until a native speaker has passed it.
5. **Low confidence escalates rather than guesses.** Below threshold, or on any question touching
   money, filing correctness or data loss, the agent says so plainly and escalates to Phase 1's
   path. The honest sentence — *"I'm not sure, and this one matters. I've sent it to Arjun, you'll
   hear back within two hours"* — is a better product than a confident wrong answer, and it is the
   same instinct as the ITC-04 export's "Not Linked" honesty.

**Hard escalation triggers, never model-judged (R1a):** anything mentioning a filing deadline; any
question about a specific rupee amount; any request to change or delete data; any mention of a
principal, s.143 or ITC-04; any second unresolved message in the same thread.

#### The two-hour promise

The brief requires no client waiting more than two hours during 9am–6pm IST. Implementation: a cron
(`support-sla-check`, hourly during business hours) scans open threads with no response older than
90 minutes and raises a `critical` ops alert. **The SLA is enforced by a watchdog, not by
intention.** Outside business hours the client gets an immediate automated acknowledgement stating
when a human will see it — an honest wait beats silence.

#### Cost

| | Per conversation |
|---|---|
| First turn (KB uncached, 8k in, 400 out, Haiku) | ₹0.90 |
| Turns 2–5 (KB cached at ~0.1× input) | ₹1.65 |
| **Haiku total, ~5 turns** | **≈ ₹2.55** |
| Opus escalation drafting, ~10% of threads | ₹9.00 each |

**Prompt caching matters here and nowhere else in this document.** The KB block is identical across
every request; caching it drops input cost roughly 90% on turns after the first. Put the KB and
system prompt *before* the last cache breakpoint and the tenant-specific context after it — a
`tenant_id` or timestamp placed in the cached prefix silently invalidates the cache on every
request, and the symptom is a bill, not an error. Verify with `usage.cache_read_input_tokens`; if
it is zero across repeated requests, something volatile is in the prefix.

| Clients | Conversations/mo | Haiku | Opus escalation | **Total** |
|---|---|---|---|---|
| 10 | 15 | ₹38 | ₹14 | **₹52** |
| 50 | 60 | ₹153 | ₹54 | **₹207** |
| 100 | 100 | ₹255 | ₹90 | **₹345** |
| 500 | 450 | ₹1,148 | ₹405 | **₹1,553** |
| 1,000 | 850 | ₹2,168 | ₹765 | **₹2,933** |

#### Founder vs automation

| Automation does | Founder does |
|---|---|
| Answers the 20 repeated questions, in 2 languages | Answers what the KB does not cover |
| Captures structured bug reports → GitHub | Fixes the bug |
| Enforces the 2-hour SLA with a watchdog | Replies via Telegram, from anywhere |
| Turns every founder reply into a KB draft | Approves KB drafts weekly (~20 min) |
| Escalates anything touching money or filing | **Every escalated answer** — by design |

**Founder time at 100 clients: 20 hrs/month → 4 hrs/month. Saves ~16 hours/month**, rising steeply
with client count — this is the automation whose value scales hardest.

#### New objects

Phase 1: tables `p2_support_threads`, `p2_support_messages`, `p2_support_kb` · changes to
`telegram-webhook` (a `/reply` branch) · a support entry point in `js/agent-chat.js`.
Phase 2: `support_query` action on `agent-query` · KB retrieval · cron `support-sla-check` · a KB
review surface in `settings.html` (owner-only).

### 4.5 A5 — Billing and Renewal

**Build: Wave 3 (1 session, manual trigger) + Wave 4 (1 session, Razorpay webhook). Wave 3 version
is unblocked. Wave 4 blocked on PVT LTD incorporation. `[DECIDED Sept 11 2026]`**

**Wave 3 scope (build now, manual trigger):** reminder scheduler, grace-period logic, plan-state
machine. Payment confirmation remains a founder SQL action. The reminder emails fire automatically;
only the payment capture is manual. This version is fully functional and unblocked.

**Wave 4 scope (50+ clients, post-incorporation):** replace the manual trigger with a Razorpay
`payment.captured` webhook. The schema, reminder logic, and state machine built in Wave 3 remain
unchanged — only the trigger mechanism changes. The existing body text below describes the Wave 4
architecture for reference; do not build it until manual payment management takes >3 hours/month.

#### The correction that sets the schedule

`[CORRECTION]` Razorpay does not exist in the codebase (§1, finding 2). There is no webhook, no
subscription table, no payment event log, no plan-expiry field. `p2_tenant_settings.plan` is a text
column a human edits — `CLAUDE.md` literally records the instruction "flip `plan = 'pro'`
immediately on payment confirmation" as a manual SQL statement for Datta Prasad `[VERIFIED]`.

So A5 is two projects: **integrate a gateway**, then **automate around it**. And the gateway binds
to a legal entity — Razorpay KYC needs PAN, bank account and business proof, all of which change at
incorporation, and `enterprise-strategy.md` §5 already lists the payment gateway among the accounts
requiring re-verification under the new PAN. **Building it against the proprietorship means doing
the integration twice and migrating live subscriptions between two merchant accounts.**

**Recommendation `[RECOMMENDED]`:** manual billing is entirely survivable to ~25 clients (8
renewals a month, 25 minutes each, ~3 hrs/month). Incorporation is on a ~2-month path and already
scheduled. **Wait for it.** Meanwhile build the parts that do not touch the gateway — the
subscription schema, the reminder scheduler and the plan-state machine — so that A5 is a webhook
handler away from done when the merchant account exists.

#### Architecture

```
  Razorpay webhook ──► billing-webhook  (new Edge Function, verify_jwt = false)
        │                    │  HMAC signature verification — mandatory, first thing
        │                    ├─► p2_payment_events  (append-only, raw payload retained)
        │                    ├─► p2_subscriptions   (state transition)
        │                    └─► A7 provision-tenant, on first successful payment
        │
  cron 'billing-reminders-daily' (03:30 UTC / 09:00 IST)
        └─► billing-reminders
              ├─ renewal at T-30 / T-14 / T-7 / T-1   → email + in-app notification
              ├─ expiry reached                        → grace period starts (7 days)
              ├─ grace exceeded                        → plan drops to 'lite'
              ├─ in lite-downgrade                     → reminder every 2 days
              ├─ setup-fee instalment due              → reminder
              └─ rate lock expiring in 60 days         → opsAlert to founder
```

#### The plan state machine — the design decision that matters

The brief's rule — **never cancel a client** — is correct and it is a *schema* decision, not a
policy one. Encode it so cancellation is not expressible:

```
  trialing ─► active ──► grace (7d) ──► lite_downgrade ──┐
                ▲           │                            │
                └───────────┴────────────────────────────┘
                        payment received → active, immediately
```

There is no `cancelled` state. A lapsed client keeps Lite: their data stays, their exports work,
their challans print, and they can return with one payment. This is not generosity — it is the
`enterprise-strategy.md` §4 data-sovereignty promise made operational. A client locked out of their
own ledger because a card failed is the exact vendor behaviour that produced the objection Nexflow
sells against.

**Downgrade to Lite is a real product state that already exists and is already enforced**, which is
why this works: `plan='lite'` gates the agent, the scanner, staff members and the 250-material cap,
all server-side `[VERIFIED]`. A5 sets a column; the gating is already built. **But note the
250-material cap is enforced at insert by a DB trigger** (`20260817_enforce_material_cap_lite.sql`)
`[VERIFIED]` — a downgraded tenant with 264 materials keeps all of them and simply cannot add the
265th. Verify that behaviour explicitly before the first downgrade; a trigger that rejected
*existing* rows would be a data-loss event on a paying customer's bad week.

#### Renewal confirmation — deterministic, not AI `[RECOMMENDED]`

The brief suggests an annual "what you got this year" summary. Build it as a **template with real
numbers**, not a model call:

> This year Nexflow generated **312 challans**, **47 tax invoices** worth **₹38,42,100**, sent
> **12 filing packages** to your CA, and flagged **₹4,20,000** of MSME payments approaching the
> 43B(h) 45-day limit.

The numbers *are* the argument. A model would add adjectives and subtract credibility, and it
introduces a failure mode (a hallucinated figure in a retention email) with no upside. This is R1
applied to marketing copy. Bundle the template per §3.2.

#### Error handling

| Failure | Behaviour |
|---|---|
| Webhook signature invalid | Reject 401, log, `critical` ops alert. **Never process an unverified payment webhook.** |
| Duplicate webhook | `UNIQUE (provider, provider_event_id)` on `p2_payment_events`. Razorpay retries; idempotency is mandatory, not optional. |
| Webhook arrives for unknown subscription | Store the event, alert, do not guess. Never auto-create a tenant from an unrecognised payload. |
| Reminder email bounces | Resend webhook (shared with A6) → mark address invalid → `important` alert. **A renewal reminder nobody received is indistinguishable from a client who ignored it** — that distinction is worth the webhook. |
| Payment succeeds during grace | Restore to `active` immediately, same invocation |
| Cron fails | A3 heartbeat catches it next morning (R3) |

#### Cost

**₹0 in AI.** Razorpay charges ~2% + GST per transaction, which is revenue cost, not automation
cost. Email volume folds into the Resend tier already counted in §8.

#### Founder vs automation

| Automation does | Founder does |
|---|---|
| Creates the subscription on first payment | Sets the price |
| Sends 4 renewal reminders on schedule | Has the pricing conversation when a rate lock expires |
| Manages grace → Lite → restore | Decides on a discount or an extension |
| Tracks setup-fee instalments | Handles a client who says they will not renew (§9) |
| Warns 60 days before a rate lock expires | Everything relationship-shaped |

**Founder time at 100 clients: 6 hrs/month → 1 hr/month. Saves ~5 hours/month.**

#### New objects

New Edge Functions `billing-webhook`, `billing-reminders` · tables `p2_subscriptions`,
`p2_payment_events` · new cron `billing-reminders-daily` · email templates (bundled) · a Billing tab
in `settings.html`.

### 4.6 A6 — Filing Package Supervision

**Build: 1 session. Changes to an existing Edge Function + 2 new crons + the job queue (§3.3).
CRITICAL — needed before 5 October 2026.**

#### Why this is the most time-urgent item in the document

`filing-package` shipped 9–10 September 2026 and is verified on two tenants. `filing_package_enabled`
defaults to `true`. Cron `filing-package-monthly` fires `30 2 5 * *` `[VERIFIED]`. **The first
production run across live tenants is 5 October 2026** — roughly three weeks out — and today there
is nothing watching it. A failure means a client's CA does not receive their filing data in the
window before the 11th GSTR-1 deadline, and nobody finds out until the client asks.

Three distinct failure modes, only one of which the brief anticipates:

1. **A row with `status='failed'`** — the brief's case. Detectable, retryable.
2. **A row stuck in `generating`** — detectable by age.
3. **A tenant with no row at all** — the invocation died mid-loop before reaching them (§3.3). **Not
   detectable by any monitor that only reads `p2_filing_packages`**, because the evidence of the
   failure is the absence of the evidence. This is the one that needs the architecture change, and
   it is the one that will actually happen first as the book grows.

#### Architecture

§3.3's dispatcher/drain queue, plus a supervisor:

```
  5th 02:30 UTC  'filing-package-dispatch'   → enqueue one job per eligible tenant
  5th–7th /2min  'filing-package-drain'      → claim ≤3, process, mark done/failed
  5th 04:30 UTC  'filing-package-monitor'    → first supervision pass
  5th 08:30 UTC  'filing-package-monitor'    → second pass + monthly summary
```

The monitor asserts four things:

| Assertion | Failure action |
|---|---|
| Every tenant with `filing_package_enabled = true` has a queue row for this period | `critical` alert — dispatcher bug, names the missing tenants |
| No job `running` for more than 30 minutes | Reclaim, count an attempt, `important` alert |
| No job `failed` with attempts remaining | Re-queue (the brief's "auto-retry once after 1 hour" — the queue generalises it to 3 attempts with backoff) |
| No job `dead` | `critical` alert with `error_reason` and the tenant name |

Then the monthly summary to the founder: X emailed, Y retried and succeeded, Z need attention, and
**total Opus spend this month**, computed from `p2_agent_logs` rows with
`intent='filing_covering_note'` `[VERIFIED — that intent is already logged]`.

#### CA email bounce detection

New Edge Function `resend-webhook` (`verify_jwt = false`, signature-verified) handling
`email.bounced` and `email.complained`. On a bounce of a filing package email:

1. Mark the address invalid on `p2_tenant_settings`.
2. Notify the **tenant owner** in-app and via Telegram, in their language: *"Your CA's email address
   bounced. The filing package was not delivered. Please check the address in Settings."*
3. `important` ops alert to the founder.

**The owner is notified, not just the founder.** The founder cannot fix a wrong CA email; only the
client can. An alert that reaches only the person who cannot act on it is a design error — and this
one is easy to make, because every other alert in A6 is founder-only.

#### A finding worth surfacing: scope divergence

`enterprise-strategy.md` §3.2 says the filing package is "Enterprise plans only." The shipped code
defaults `filing_package_enabled` to `true` for **every** tenant `[VERIFIED]`. Those disagree, and
the cost difference at 100 clients is ~₹2,800/month versus a few hundred.

**Recommendation `[RECOMMENDED]`: keep it on for everyone, and update the Enterprise doc rather
than the code.** At ~₹28/tenant/month it is the cheapest retention feature in the product, it makes
every tenant's CA a Nexflow advocate (`enterprise-strategy.md` §3.5 §10 identifies the CA as the
cheapest acquisition channel available), and gating it would mean knowingly sending worse filing
data to cheaper tiers — the same argument that already made HSN autofill free on every plan. Take
the decision explicitly; do not let it stay an accident. §10 Q3.

#### Cost

**Monitoring: ₹0** — pure SQL and Telegram. The Opus covering note it supervises costs ~₹28/tenant
(blended from `enterprise-strategy.md`'s verified ₹22 typical / ₹63 busy).

**Use the Batch API once the book passes ~50 tenants.** The package is generated at 08:00 IST on the
5th for a deadline on the 11th; it is not latency-sensitive, and Batch is 50% off. At 1,000 clients
that is ₹14,000/month saved for a scheduling change. Prompt-cache the system prompt too — it is
byte-identical across every tenant. `enterprise-strategy.md` §3.2 already recommends both; the queue
architecture makes batching natural, since jobs are already decoupled from invocations.

#### Founder vs automation

| Automation does | Founder does |
|---|---|
| Confirms every eligible tenant was enqueued | Reads one monthly summary |
| Retries transient failures automatically | Fixes a genuine generation bug |
| Escalates dead jobs with the error and tenant name | Contacts the client when their data is the problem |
| Detects and routes CA email bounces to the owner | Nothing, for a bounce |
| Reports monthly Opus spend | Decides on Batch/caching when spend justifies it |

**Founder time at 100 clients: 6 hrs/month → 1 hr/month. Saves ~5 hours/month** — and prevents a
class of failure that would otherwise be discovered by a client's CA during filing week.

#### New objects

Changes to `filing-package/index.ts` (`dispatch`, `drain`, `monitor` modes alongside the existing
`monthly_cron`, which stays for manual/small-book use) · `p2_job_queue` (§3.3) · new Edge Function
`resend-webhook` · new crons `filing-package-dispatch`, `filing-package-drain`,
`filing-package-monitor`.

### 4.7 A7 — Signup and Provisioning

**Build: Wave 3 (1 session, manual trigger) + Wave 4 (0.5 session, Razorpay webhook). Wave 3 version
is unblocked. Wave 4 blocked on PVT LTD incorporation. `[DECIDED Sept 11 2026]`**

**Wave 3 scope (build now):** a simple founder-facing admin page that provisions a new tenant on
manual confirmation — creates the Supabase auth user, writes the `p2_tenant_settings` row, sends the
welcome email, triggers the tutorial. The founder visits this page after confirming payment
manually. Survivable to 50 clients.

**Wave 4 scope (post-incorporation):** replace the manual admin page trigger with an automatic
Razorpay `payment.captured` webhook. The provisioning logic is identical; only the trigger changes.
The existing body text below describes the full webhook architecture for Wave 4 reference.

#### The problem

Creating a tenant today means: create the auth user, create the `p2_tenants` row, create
`p2_tenant_settings`, set the plan, set flags, send credentials, and walk them through first login.
About 40 minutes, every step manual, every step a place to forget something — and `CLAUDE.md`
records the consequence of getting it wrong: `saveCompanyAndPlan()` had to be fixed to upsert
`p2_tenants` before `p2_tenant_settings` "for users who signed up before the Aug 3 trigger fix"
`[VERIFIED]`. Manual provisioning produces exactly that class of orphan.

#### Architecture

```
  Razorpay payment.captured
        │
        ▼
  billing-webhook (A5)  ── signature verified ──► provision-tenant  (new Edge Function)
        │
        ├─ 1. Idempotency check — p2_payment_events.provider_event_id
        ├─ 2. GSTIN lookup → company name, address, state   [UNVERIFIED — provider, §10 Q5]
        ├─ 3. Create auth user (Supabase Admin API)
        ├─ 4. Create p2_tenants row          ◄── FK anchor. FIRST. Always.
        ├─ 5. Create p2_tenant_settings      ◄── plan from the amount paid
        ├─ 6. Create p2_user_roles (owner)
        ├─ 7. Send welcome email (bundled, §3.2) with a magic link
        ├─ 8. tutorial_mode = 'auto' so the tutorial self-starts (tutorial-engine.md §6.2)
        └─ 9. opsAlert: "New client: <name>, <plan>, <state>. Setup ₹XX,XXX."
```

**Order 4 before 5 is not stylistic.** `p2_tenants` is the FK anchor for ten tables and `CLAUDE.md`
flags it in bold as "load-bearing" `[VERIFIED]`. Getting this backwards is the documented Aug 3 bug.

**Every step is idempotent and the whole thing is resumable.** Razorpay retries webhooks; a partial
provision must be completable, not restarted. Each step checks whether its object already exists.
A provision that dies at step 5 leaves an auth user and a tenant row, and re-running completes it
rather than creating a second user.

**Plan assignment from the amount paid, via a table, never a hardcoded map in code.** A
`p2_plan_catalog` row per Razorpay plan id → `plan` value. Adding a price means adding a row (R2). A
`match (amount) { case 135000: 'pro' }` in an Edge Function is the shape that breaks the first time
a discount is given.

**Deleted-function warning.** `handle-new-user` was **deleted** in Session 1 (3 Sept 2026) as an
unauthenticated privilege-escalation hole — it accepted an arbitrary `(user_id, tenant_id, role)`
insert with service role `[VERIFIED]`. `provision-tenant` is superficially the same shape and must
not repeat it: it is callable **only** from `billing-webhook` after HMAC verification, never
directly from a browser, and it derives every identifier from the verified payload — never from
request input. Put that constraint in a comment at the top of the file so the next session reading
it understands why it is not exposed.

#### GSTIN lookup

`[UNVERIFIED — choose a provider, §10 Q5]` Options are the GSTN public search API via a GSP, or a
commercial aggregator. Cost is ₹0.50–₹2 per lookup. Three rules regardless of provider:

1. **Never block provisioning on it.** Timeout at 5 seconds; on failure create the tenant with the
   GSTIN and empty company fields, and let the client fill them in. A signup that fails because a
   third-party API was slow is an own goal.
2. **Validate the format and state code locally first** — reuse A1's deterministic validator and
   `export.html`'s `GST_STATE_CODES`. A malformed GSTIN never reaches the API.
3. **Treat the response as a suggestion**, pre-filled and editable, not as truth. The GSTN's
   registered trade name is frequently not what the factory calls itself.

#### Error handling

| Failure | Behaviour |
|---|---|
| Auth user already exists | Reuse it — an existing client buying a second plan is a real case |
| GSTIN lookup fails/times out | Proceed with empty fields, `monitor` alert |
| Welcome email fails | Tenant is live; retry via queue; `important` alert. **Never roll back a paid provision because an email bounced.** |
| Any step throws | Record progress, `critical` alert with the exact step, leave state resumable |
| Payment succeeds, provision fails entirely | `critical`, immediate. A client who paid and has no account is the worst state in this document. |

#### Cost

**₹0 in AI.** ₹1–2 per GSTIN lookup: about ₹16/month at 100 clients, ₹100/month at 1,000.

#### Founder vs automation

| Automation does | Founder does |
|---|---|
| Everything, for a standard signup | **Nothing** — that is the acceptance test |
| Notifies the founder with name, plan, state, fee | Reads the notification |
| Leaves a resumable state on partial failure | Intervenes only on a `critical` |
| Starts the tutorial on first login | — |

**Founder time at 100 clients: 5 hrs/month → 0.5 hrs/month. Saves ~5 hours/month.**

#### New objects

New Edge Function `provision-tenant` · table `p2_plan_catalog` · welcome email template (bundled) ·
GSTIN lookup secret.

### 4.8 A8 — Codebase Health Monitoring

**Build: 1 session. New Edge Function + 2 crons + a schema snapshot. Depends on A0. Critical at ~50
clients; the synthetic-test half is worth pulling earlier.**

#### The problem

At 100 clients a broken Edge Function affects everyone at once, and the current detection mechanism
is a client noticing. Nexflow's specific risk profile makes this sharper than usual: **migrations
are applied by hand through the SQL Editor, never `supabase db push`** — that is a standing
instruction with a good reason (push replays old migrations) but it means the live schema is
authoritative and the migration folder is only a partial record. `CLAUDE.md` documents several
changes applied with *no migration file at all*: the `set_tenant_id()` fix, five Session 6
migrations, the `p2_clients` Udyam columns `[VERIFIED]`. **Drift is not hypothetical here; it is the
documented normal.**

#### Four checks

**1. Synthetic tests (daily, 02:45 UTC).** Call each critical Edge Function with known-safe test
input against the **test tenant** (`fe2b94fb-…`, designated safe to break) and assert the response
*shape*, not the values:

| Function | Probe | Assert |
|---|---|---|
| `agent-query` | `check_stock` on a known material | `{status:'ok', intent, confirm:{status, confirm_text}}` |
| `receive-dispatch` | GET with a known token | `{dispatch, supplier, items}` |
| `invoice-view` | GET with a known token | `{invoice, tenant}` with `invoice_date` present |
| `notify` | a test notification row | 200, status flips to `sent` |
| `filing-package` | `{action:'generate'}` dry-run | 200 with a file manifest |

**Shape, not values** — values change as the test tenant is used for development; shape changing is
the regression. This catches the exact failure the 2 Sept 2026 session hit in production, where
`verifyCallerTenant` activating on redeploy turned the Generate Invoice button into "Unauthorized"
for every user `[VERIFIED]` — a synthetic test asserting a 200 would have caught it before a client
did.

**One known false-positive source to handle explicitly:** `CLAUDE.md` records that the first message
after a cold start sometimes fails with "Failed to load raw materials" — a Deno cold-start issue,
not a code bug, where the second attempt always works `[VERIFIED]`. **The probe must retry once
before alerting**, or A8 will cry wolf every morning and be muted within a week.

**2. Schema drift (weekly).** Snapshot expected columns, constraints, indexes and RLS enablement to
a checked-in `_ai/regression/schema-snapshot.json`; compare live weekly. Alert on any missing
column, missing constraint, or — specifically — **any `p2_*` table with `rowsecurity = false`**.
That last check exists because it has already happened: fifteen tables got policies in
`20260803_staff_rls_fix.sql` and never got `ENABLE ROW LEVEL SECURITY`, undetected until the Session
1 audit `[VERIFIED]`. One query would have caught it:

```sql
SELECT tablename FROM pg_tables
WHERE schemaname = 'public' AND tablename LIKE 'p2\_%' AND NOT rowsecurity;
```

**A8's schema check should run this on day one, before anything else in the automation exists.** It
is four lines and it protects against the most consequential class of bug this codebase has
actually shipped.

**3. Quota monitoring (daily).** Database size, Edge Function invocations, storage, egress, against
plan limits. Alert at 80%. Storage matters more than it looks: filing packages are zips retained per
tenant per month, so storage grows as `tenants × months` and nothing currently expires them.
**Recommend a retention policy** — signed URLs expire in 7 days, but the objects live forever.
Twelve months at 1,000 tenants is 12,000 zips. §10 Q6.

**4. Deployment health (on demand + daily).** Vercel deployment status and error rate; alert on a
failed deployment or an error-rate step change.

#### Output

Every alert carries enough to diagnose without opening a dashboard — the function, the probe, the
expected shape, the actual response, and the timestamp. `CLAUDE.md`'s standing rule against raw
errors applies to *clients*; the founder channel is the opposite — verbatim errors, always.

#### Cost

**₹0 in AI.** Assertions are deterministic. Optionally Haiku to turn a failed assertion into a
plain-English line in the A3 digest (~₹1/day); not required, and the raw diff is usually clearer.

#### Founder vs automation

| Automation does | Founder does |
|---|---|
| Probes every critical function daily | Fixes what breaks |
| Detects schema drift from hand-applied SQL | Applies the corrective migration |
| Warns at 80% of any quota | Decides when to upgrade the plan |
| Reports before clients notice | **Diagnoses the novel bug** (§9) |

**Founder time at 100 clients: 6 hrs/month of incident response → 3 hrs/month. Saves ~3 hours/month
directly**, and considerably more in avoided client-trust damage, which does not appear in an hours
table.

#### New objects

New Edge Function `health-check` · crons `health-check-daily`, `schema-drift-weekly` ·
`_ai/regression/schema-snapshot.json` · optional Vercel API token.

---

## 5. WhatsApp Ingestion as a Distribution Channel

**`[RECOMMENDED]` — build as A1 Phase 2, after the upload path is proven. Blocked on P3.**

### Why this is a distribution question, not an onboarding feature

A factory owner who can onboard their whole team by forwarding a WhatsApp number is using a
different product from one who needs a laptop, a template download and a CSV upload. The difference
is not convenience. It is **who can say yes**.

In MIDC the person with the data is often not the person with the computer. The storekeeper has the
register. The owner has WhatsApp and a phone. The accountant has Tally at a different office. An
onboarding flow requiring a desktop browser and a correctly-shaped spreadsheet implicitly requires
the owner to become a data-entry clerk first — which is the step where onboarding stalls, and it is
precisely why Shivprasad's materials are still not loaded three weeks in `[VERIFIED]`.

And Nexflow already lives on WhatsApp. `showUpgradePrompt()` opens a WhatsApp CTA to
+91 72489 32468. The challan share button uses the Web Share API with a `wa.me` fallback. The full
export README and the filing package README both list WhatsApp as the support contact
`[VERIFIED — all three]`. **The channel is already the product's front door; it is just not
programmable.** P3 makes it programmable.

For the KPML wave this compounds: KPML mandates adoption across 20–70 vendors, most of them smaller
than the three current clients, several with no PC in the office at all. "Send your material list to
this number, any format, we'll set it up and send you a link to check" is a fundamentally easier ask
than anything involving a template — and it is made to the vendor by KPML, not by Nexflow, which is
the whole distribution model.

### Architecture — WhatsApp is a transport, not a second pipeline

```
  Client's phone
        │  photo of a register · Excel · PDF · text · voice note
        ▼
  Meta WhatsApp Business Cloud API
        │  webhook
        ▼
  whatsapp-inbound  (new Edge Function, verify_jwt = false)
        ├─ verify X-Hub-Signature-256   ── mandatory, first thing
        ├─ resolve sender → tenant / prospect  (phone → p2_tenant_settings.mobile) [VERIFIED]
        ├─ download media via Graph API → private Storage bucket
        ├─ append to the CURRENT open submission, or create one
        └─ reply in the sender's language, from a bundle
                │
                ▼
        p2_onboarding_submissions   ◄── the SAME table the upload path writes
                │
                ▼
        the SAME parse → validate → review → import pipeline (§4.1)
```

**The design rule, and everything else follows from it: WhatsApp normalises into the existing
submission shape and shares every downstream stage.** No second parser, no second validator, no
second review UI, no second import path. `source='whatsapp'` and `source_ref` record provenance;
nothing else in the pipeline knows or cares. This is R2 applied to channels rather than tenants, and
it is what makes adding email-in or a Telegram upload later cost nearly nothing.

### Multi-message submissions

A client sends six photos over ten minutes. Each is a separate webhook. The pipeline must treat them
as one submission:

- An open submission for a sender stays open for a **30-minute idle window**, extended by each new
  message.
- Each message appends a `p2_onboarding_files` row.
- The client closes it explicitly (`done` / `झालं`) or the window expires.
- On close, one parse job is enqueued for the whole set.

Without this, six photos become six submissions and six review links, and the client gives up. It is
a small piece of state with a large effect on whether the channel works at all.

### Voice notes — the honest answer

`[RECOMMENDED]` **Out of scope for v1.** Claude does not transcribe audio, so this needs a separate
speech-to-text service, and the language is Marathi in a factory with machine noise. Marathi STT
quality on that input is the open question, and a *silently wrong* transcription of a quantity is
the worst possible failure in this entire pipeline — it would arrive looking like clean structured
data, pass deterministic validation, and land in a BOM.

This is the same call `tutorial-engine.md` §8.6 makes about Marathi TTS — the quality is not there,
and shipping it would be counterproductive. v1 replies:

> *"I can't listen to voice notes yet. Please send a photo of the register, or type the list."*
> *"मला अजून व्हॉइस नोट ऐकता येत नाही. रजिस्टरचा फोटो पाठवा, किंवा यादी टाईप करा."*
> `// UNREVIEWED — needs the §8.5 read-aloud gate before shipping`

Revisit only after a measured test: twenty real Marathi voice notes from an actual factory, scored
for numeric accuracy. **Gate it on numeric accuracy specifically** — a transcript that gets the
material name wrong is caught at review; one that gets the quantity wrong may not be.

### Cost

`[UNVERIFIED — confirm the current Meta India rate card before budgeting]` Meta's model bills
business-initiated template conversations and leaves user-initiated service conversations free
within a 24-hour window. Onboarding is almost entirely user-initiated — the client sends first — so
most traffic falls in the free window. Order of magnitude: single-digit rupees per client onboarded,
with business-initiated templates (the review link reminder) the only paid component.

Budget **₹500/month at 100 clients, ₹6,000/month at 1,000**, and verify against the live rate card
before relying on it. Even a 10× error here does not change any decision in §8.

### Rules

1. **Never send client data outbound over WhatsApp beyond a link.** A review link, never a data
   dump. Same payload-minimisation reasoning as `enterprise-strategy.md` §3.5's CA queue: the
   channel carries a pointer, the authenticated surface carries the content.
2. **Verify the webhook signature before anything else.** An unauthenticated inbound webhook that
   creates database rows is a spam vector and worse.
3. **Rate-limit per sender.** 20 messages / 10 minutes, then a polite stop. Protects the Storage
   bucket and the parse queue.
4. **Unknown senders are prospects, not tenants.** A message from an unrecognised number creates a
   submission with `tenant_id = NULL` and alerts the founder. It never creates a tenant, never
   guesses an identity, and never gets a review link until the founder associates it.
5. **The number is shared with A4 support.** One number, two intents, routed by whether the sender
   has an open onboarding submission. Two WhatsApp numbers would be a worse product and twice the
   Meta compliance surface.

---

## 6. Integration Map

How the automations connect. Arrows are data or control flow; **A0 is the shared sink for every
founder-facing path.**

```
                         ┌──────────────────────────────────────┐
                         │  A0  FOUNDER OPS CHANNEL             │
                         │  _shared/ops.ts → p2_ops_alerts      │
                         │              → Telegram (founder)    │
                         └───▲────▲────▲────▲────▲────▲────▲────┘
                             │    │    │    │    │    │    │
        ┌────────────────────┘    │    │    │    │    │    └────────────────┐
        │         ┌───────────────┘    │    │    │    └──────────┐          │
        │         │        ┌───────────┘    │    └────┐          │          │
        │         │        │                │         │          │          │
   ┌────┴───┐ ┌───┴────┐ ┌─┴──────┐  ┌──────┴──┐ ┌────┴───┐ ┌────┴───┐ ┌────┴───┐
   │A2 comp │ │A3 diges│ │A6 filing│  │A8 health│ │A1 onbrd│ │A4 supp │ │A5/A7   │
   │ liance │ │  t     │ │ monitor │  │        │ │        │ │        │ │billing │
   └────┬───┘ └───▲────┘ └────┬────┘  └────┬───┘ └───┬────┘ └───┬────┘ └───┬────┘
        │         │           │            │         │          │          │
        │         │  reads    │            │         │          │          │
        │         └───────────┴────────────┴─────────┴──────────┴──────────┘
        │              A3 is the aggregator: every other automation's
        │              state is a section in the daily digest
        │
        └──► GitHub issues ◄──── A4 (bug reports)

  ── data spine ────────────────────────────────────────────────────────────
   p2_job_queue      A6 (filing) · A1 (onboarding parse)     — §3.3
   p2_agent_logs     A1 · A4 · A6 covering note              — existing table
   _shared/i18n.ts   A1 · A4 · A5 · A7 (client-facing only)  — §3.2
   p2_ops_alerts     every automation, founder-facing only   — §3.1

  ── causal chains ─────────────────────────────────────────────────────────
   Razorpay webhook ──► A5 (subscription) ──► A7 (provision) ──► tenant exists
                                                   │
                                                   ▼
                                  A1 import becomes possible for that tenant
                                                   │
                                                   ▼
                                  tutorial-engine auto-starts on first login

   A4 founder reply ──► p2_support_kb draft ──► A4 Phase 2 answers it next time
                                                   (the accretion loop)

   A2 finds a change ──► founder fixes one constant ──► every tenant fixed
                                                   (the moat)

   A8 schema drift ──► A3 digest ──► founder applies migration
   A6 dead job     ──► A0 critical ──► founder investigates
   A6 CA bounce    ──► tenant owner (they alone can fix it) + A0
```

**Four dependency facts a session must not get wrong:**

1. **A0 before A2, A3, A6, A8.** Without it they have nowhere to report. Half a session.
2. **A6's queue (§3.3) before A1's parse worker.** A1 reuses `p2_job_queue`; building it in A6 first
   means A1 inherits it.
3. **A7 before A1's *import* step** for any tenant that does not exist yet. Parse and review work
   without a tenant; import does not.
4. **A4 Phase 1 before A4 Phase 2.** Phase 1 generates the knowledge base Phase 2 needs. Reversing
   them means writing a KB from imagination.

---

## 7. Priority and Build Sequence

### The reasoning, not just the order

Four factors, weighted in this order: **(a)** what breaks a real client if it is absent; **(b)** what
is dependency-blocking; **(c)** what the current pain actually is, as opposed to the projected pain;
**(d)** build cost. The answer is emphatically not "build everything now" — three of the eight are
premature today and two are blocked on a legal process.

### Wave 0 — now (3 clients)

| | Item | Cost | Why now |
|---|---|---|---|
| 1 | **A0 Founder ops channel** | 0.5 session | Blocks four automations. Nothing else can report until it exists. |
| 2 | **A6 Filing supervision + job queue** | 1 session | **Hard deadline: 5 October 2026.** First real multi-tenant run of a live feature with zero supervision and a silent-failure mode (§3.3). This is the most time-urgent item in the document. |
| 3 | **A8 schema-drift query only** | 30 minutes | The four-line `rowsecurity = false` check (§4.8). Do it before the rest of A8 — it guards the most consequential bug class this codebase has actually shipped. |

**Wave 0 is ~1.5 sessions and it is not optional.** Item 2 has a calendar deadline that is three
weeks out.

### Wave 1 — Oct–Nov 2026 (3–20 clients)

| | Item | Cost | Why here |
|---|---|---|---|
| 4 | **A2 Compliance monitoring** | 1.5 sessions | The twenty-two-month B2CL miss is the business case, and the cost is flat forever. Also produces `compliance-constants.json`, a deliverable in its own right. |
| 5 | **A3 Daily digest** | 1 session | Cheap once A0 exists, and it is the *delivery surface* for A6 and A8. Building the reporters without the report leaves their output in a table nobody reads. |
| 6 | **A4 Phase 1 (escalation + bug capture)** | 1.5 sessions | Small, and it starts the KB accreting. Every month it is delayed is a month of answered questions not captured. |

**Not in Wave 1, deliberately:** A1. It is the biggest lever and the longest build, and at 3–10
clients the founder can still absorb onboarding. Starting it in November means it lands before the
KPML vendor wave, which is when it is actually needed — and by then A0/A6's queue exists for it to
reuse.

### Wave 2 — Dec 2026–Feb 2027 (10–30 clients, pre-KPML-wave)

| | Item | Cost | Why here |
|---|---|---|---|
| 7 | **A1 Onboarding ingestion** | 3–4 sessions | **Must precede any KPML vendor wave.** 20 vendors × 4 hours is 80 hours that do not exist. Build it with slack before the pilot signature, not during it. |
| 8 | **A8 Codebase health (full)** | 1 session | Synthetic tests and quota monitoring matter once clients outnumber what the founder can spot-check. |

### Wave 3 — after incorporation completes (25–100 clients)

| | Item | Cost | Why here |
|---|---|---|---|
| 9 | **A5 Billing reminder scheduler** | 1 session | Build the reminder scheduler, grace-period logic, and plan-state machine with manual payment trigger (no Razorpay). Reminder emails go out automatically; founder still confirms payment manually via SQL. Add Razorpay webhook in Wave 4 when manual confirmation exceeds 3 hours/month. |
| 10 | **A7 Signup provisioning (manual-trigger version)** | 1 session | Founder triggers provisioning via a simple admin page after manual payment confirmation. No Razorpay dependency. Full self-serve webhook version deferred to Wave 4. |
| 11 | **A1 WhatsApp channel (§5)** | 1 session | Blocked on P3, which trails incorporation. Pure addition to a proven pipeline. |

### Wave 4 — 40+ clients

| | Item | Cost | Why here |
|---|---|---|---|
| 12 | **A4 Phase 2 (KB-backed agent)** | 2 sessions | Needs a populated KB from Phase 1 and enough volume to justify it. Below ~40 clients the founder answering directly is *better* product — it is also market research. |
| 13 | **A5 + A7 Razorpay integration** | 1.5 sessions | Integrate Razorpay webhook, replace manual trigger with automatic provisioning on `payment.captured` event. Only after PVT LTD incorporation completes AND manual payment management takes >3 hours/month. |

**Item 13's gate is 50+ clients**, not 40 — it fires when manual payment overhead becomes real
friction (>3 hrs/month), whichever comes later than incorporation. §1 finding 2 `[DECIDED]`.

### Total

**~16 sessions across roughly six months**, with 1.5 sessions carrying a hard October 5 deadline
(Wave 0), 1.5 sessions in Wave 4 blocked on PVT LTD incorporation + Razorpay (item 13), and 1
session blocked on WhatsApp Business API approval (item 11, trails incorporation). Wave 3 items 9
and 10 are now unblocked — they use manual payment triggers, not Razorpay.

### What the sequence deliberately does not do

- **It does not build billing first**, despite billing being the most obviously "missing" thing.
  Building it before incorporation means building it twice and migrating live subscriptions between
  merchant accounts (§1 finding 2).
- **It does not build the support agent early.** At 3–25 clients, the founder answering support
  personally is better product and free market research. Automating it now would automate away the
  signal before it has been read.
- **It does not build A1 first**, despite it being the largest saving. The saving is real at 15+
  clients and near-zero at 3, and it depends on infrastructure (A0, the queue) that Wave 0 produces
  anyway.
- **It does front-load A6 against every instinct about client count.** A6 is not scaled by clients;
  it is scaled by a calendar date that has already been set by a cron that is already live.

### Interaction with the existing roadmap

`enterprise-strategy.md` §6's decided sequence (Phase 2 KPML dashboard → Enterprise block E4/E3/E2/E1)
and `tutorial-engine.md` §9's three sessions are **not** superseded by this document. Automation
work interleaves rather than replaces:

- **Wave 0 is 1.5 sessions and should be inserted immediately**, ahead of any Enterprise work,
  because of the October date.
- **A1 (Wave 2) and the KPML pilot are the same deadline.** Both are driven by the vendor wave.
- **A2 overlaps E2's blocking dependencies.** The B2CL threshold and the challan-number length were
  both `enterprise-strategy.md` §6 blockers, and both are exactly what A2 is built to catch. A2 is
  cheap insurance on the entire Enterprise compliance surface.
- **`tutorial-engine.md` T1–T3 and A4 are complementary and should not compete.** A tutorial that
  prevents a question is strictly better than a support agent that answers it, and
  `tutorial-engine.md` §1 already makes the data-quality argument. If sequencing forces a choice,
  **tutorials first.**

---

## 8. Cost Summary

All figures at **₹90/USD** (the convention `enterprise-strategy.md` §3.2 already uses). Model
pricing `[VERIFIED, 11 Sept 2026]`: **Opus 5 (`claude-opus-5`) $5.00/MTok in, $25.00/MTok out;
Haiku 4.5 (`claude-haiku-4-5`) $1.00/MTok in, $5.00/MTok out.** Batch API 50% off; prompt-cache
reads ~0.1× input, cache writes ~1.25×.

### 8.1 Infrastructure

| | 10 | 50 | 100 | 500 | 1,000 |
|---|---|---|---|---|---|
| Supabase | $25 (Pro) | $135 (Pro + compute) | $599 (Team) | ~$999 | ~$1,400 |
| Vercel Pro | $20 | $20 | $20 | $20 | $20 |
| Resend | $0 | $20 | $20 | $90 | $90 |
| Telegram | $0 | $0 | $0 | $0 | $0 |
| Storage + egress | ~₹500 | ~₹2,000 | ~₹5,000 | ~₹15,000 | ~₹25,000 |
| **Monthly (₹)** | **₹4,550** | **₹16,000** | **₹62,500** | **₹1,06,000** | **₹1,53,500** |

**Note (updated Sept 11 2026): §8.3 is the authoritative cost table — it includes Claude Max and
corrected infrastructure figures. §8.1 figures are pre-correction and will be reconciled in a
future pass. Use §8.3 for all planning.**

**Note on Razorpay (updated Sept 11 2026):** Razorpay fees (~2% of revenue) are excluded from this
table. Razorpay will not be integrated until 50+ clients. At that scale, 2% on ₹4.79L/month =
₹9,580/month — meaningful but manageable, and by then incorporation will have cleared the KYC
blocker.

**Why Supabase Team at 100 and not at 500.** Team is bought for the **contract**, not the load — 28-day
PITR and the backup guarantees a PVT LTD's CA will ask about under `enterprise-strategy.md` §4's
data-sovereignty promise. Expect it at the first Enterprise signature, likely around 10–25 clients,
earlier than pure load would require. The jump from ₹16,000 to ₹62,500 between 50 and 100 clients is
almost entirely this single line.

### 8.2 AI and per-automation running cost

| Automation | Model | 10 | 50 | 100 | 500 | 1,000 |
|---|---|---|---|---|---|---|
| A1 onboarding (₹62 × new clients/mo) | Opus + Haiku | ₹93 | ₹248 | ₹496 | ₹1,860 | ₹3,100 |
| A2 compliance (**flat**) | Haiku + Opus | ₹92 | ₹92 | ₹92 | ₹92 | ₹92 |
| A3 digest | Haiku | ₹27 | ₹27 | ₹30 | ₹50 | ₹50 |
| A4 support | Haiku + Opus | ₹52 | ₹207 | ₹345 | ₹1,553 | ₹2,933 |
| A5 billing | — | ₹0 | ₹0 | ₹0 | ₹0 | ₹0 |
| A6 filing covering note (₹28/tenant) | Opus | ₹280 | ₹1,400 | ₹2,800 | ₹14,000 | ₹28,000 |
| A6 with **Batch API** (50% off) | Opus | ₹140 | ₹700 | ₹1,400 | ₹7,000 | ₹14,000 |
| A7 GSTIN lookups | — | ₹3 | ₹8 | ₹16 | ₹60 | ₹100 |
| A8 health | — | ₹0 | ₹0 | ₹0 | ₹0 | ₹0 |
| WhatsApp `[UNVERIFIED]` | — | ₹50 | ₹250 | ₹500 | ₹3,000 | ₹6,000 |
| **AI + channels (with Batch)** | | **₹457** | **₹1,532** | **₹2,879** | **₹13,615** | **₹26,275** |
| Claude Max (development) | — | ₹9,000 | ₹9,000 | ₹9,000 | ₹9,000 | ₹18,000 |

Claude Max ($100/month = ₹9,000) is the primary development tool. It is the largest single cost at
3-10 clients (54% of total costs at 3 clients) and becomes negligible at scale (3.7% at 1,000
clients). Upgrade to $200/month only when $100 plan limits build velocity — estimated at 200+
clients.

### 8.3 Total, and what it means

| | 10 | 50 | 100 | 500 | 1,000 |
|---|---|---|---|---|---|
| Infrastructure | ₹2,850 | ₹17,850 | ₹62,610 | ₹1,14,910 | ₹1,61,000 |
| AI + automations | ₹800 | ₹3,000 | ₹6,000 | ₹23,000 | ₹43,000 |
| Claude Max | ₹9,000 | ₹9,000 | ₹9,000 | ₹18,000 | ₹18,000 |
| Founder hidden costs | ₹8,000 | ₹22,500 | ₹33,500 | ₹20,500 | ₹14,000 |
| PVT LTD compliance | ₹0 | ₹3,000 | ₹3,000 | ₹5,000 | ₹5,000 |
| **Total / month** | **₹20,650** | **₹55,350** | **₹1,14,110** | **₹1,81,410** | **₹2,41,000** |
| **Per client / month** | ₹2,065 | ₹1,107 | ₹1,141 | ₹363 | ₹241 |
| Revenue / month | ₹69,580 | ₹4,79,167 | ₹10,83,333 | ₹62,50,000 | ₹1,45,83,333 |
| **Gross margin** | **70.3%** | **88.4%** | **89.5%** | **97.1%** | **98.3%** |
| **Cost as % of revenue** | **29.7%** | **11.6%** | **10.5%** | **2.9%** | **1.7%** |

Setup fees (₹35,000 per new Pro client, ₹60,000 per Enterprise) are excluded from recurring margin
calculation but are real cash. At 8 new clients/month at 100-client scale, setup fees add
₹2,80,000/month in additional cash — the actual cash position is always better than the
recurring-only margin shows.

Three conclusions, stated plainly because each one should shut down a category of future debate:

1. **AI is 5.3% of run cost at 100 clients and 17.8% at 1,000.** It is never the constraint. Do not
   optimise a prompt to save money; optimise it for correctness.

2. **The largest cost at 10–100 clients is founder hidden costs, not infrastructure.** Travel, CA
   visits, and equipment together exceed Supabase at small scale. These costs invert as automation
   replaces site visits — hidden costs peak at 100 clients (₹33,500/month) then fall sharply at 500
   (₹20,500) and 1,000 (₹14,000). At 500+ clients, Supabase becomes the dominant line again. Plan
   accordingly: the first 100 clients require more founder presence than the numbers suggest.

3. **Cost per client falls 4.7× between 100 and 1,000 clients** (₹1,141 → ₹241). That is the actual
   scaling story. Infrastructure is strongly sublinear; hidden costs invert; AI stays flat. The
   result is 89.5% margin at 100 clients rising to 98.3% at 1,000.

### 8.4 Founder hours — the number that matters

| Task | 10 manual | 10 auto | 100 manual | 100 auto | 500 manual | 500 auto |
|---|---|---|---|---|---|---|
| Onboarding | 7 | 1 | 36 | 4 | 135 | 15 |
| Compliance | 4 | 2 | 4 | 2 | 4 | 2 |
| Dashboards / digest | 5 | 2.5 | 10 | 2.5 | 15 | 2.5 |
| Support | 2 | 0.5 | 20 | 4 | 100 | 20 |
| Billing / renewals | 1 | 0.3 | 6 | 1 | 30 | 4 |
| Filing packages | 0.5 | 0.2 | 6 | 1 | 30 | 4 |
| Provisioning | 1 | 0.2 | 5 | 0.5 | 20 | 2 |
| Incidents | 2 | 1 | 6 | 3 | 20 | 8 |
| **Automation maintenance** | — | **2** | — | **4** | — | **6** |
| **Total hrs/month** | **22.5** | **9.7** | **93** | **22** | **354** | **63.5** |
| **Saved** | | **12.8** | | **71** | | **290.5** |

Three honest observations:

- **Automation maintenance is a real new job.** It is in the table because leaving it out would make
  the numbers a lie. Budget 4 hours a month at 100 clients for keeping eight automations, six crons
  and a constants inventory current.
- **At 500 clients, 63 hours a month of ops is still most of a working half-month.** The brief's
  "no employees until 500+" is right at the edge, not comfortably inside it. The line item that
  breaks first is **support** (20 hrs) — which is the argument for A4 Phase 2 being a real
  investment rather than a nicety, and the signal that the first hire is a support person, not a
  developer.
- **The 100-client column is the proof of the thesis.** 93 hours down to 22 is the difference
  between a founder who ships product and a founder who runs a service desk.

---

## 9. What the Founder Still Does

Written honestly, because a plan that pretends otherwise fails at the moment it is trusted.

### Cannot be automated, ever

**Pricing and negotiation.** Every number in `enterprise-strategy.md` §7 came from judgment about
what a specific factory would pay. A5 sends the reminder; the founder decides whether a client who
pushes back gets a discount, an extension, or a no.

**Key relationships.** KPML is one conversation with one accounts head, and it is worth ₹3L/year
plus a vendor network. `kpml-network-plan.md` gates direct contact on a demo existing for a reason.
No automation touches this.

**The CA channel.** `enterprise-strategy.md` §3.5 §10 identifies CAs as the cheapest acquisition
channel available and gates it on **three clean months with one CA, measured**. That gate is a
relationship being earned. Automation can make the data right; only a person can make the CA trust
it.

**Novel bugs.** A8 catches what was predicted. By definition it cannot catch what was not — the
`todayIST()` off-by-one wrong at five call sites, the `set_tenant_id()` trigger silently rejecting
staff writes, `v_p2_stock_balance` 500-ing on a PostgREST filter for a column the view does not
expose. Every one was found by a human reading code with suspicion. **That remains the job.**

**Compliance judgment.** A2 says the law changed and points at `export.html:1377`. Deciding what it
means for Nexflow's schema, whether it affects one surface or four, and what the migration looks
like is founder work. **A2 never writes code, and should never be extended to.**

**The language gate.** `tutorial-engine.md` §8.5's read-aloud test — a real storekeeper, on a real
phone, on the real page — cannot be done by a session and cannot be compressed. It applies
identically to A4's Marathi KB and A1's review page. It is calendar time, not build time, and the
correct response to it slipping is to ship English-only.

**Anything with a signature, a credential, or a statutory filing.** `enterprise-strategy.md` §8
items 4 and 5, permanently. No automation in this document touches a GST portal, a DSC, an EVC OTP,
or an IRN. There is no client and no price for which this becomes yes.

### Requires judgment, even with automation running

**Red rows in an onboarding review.** A1 makes red rare and precise. It does not make them go away,
and by design it will not import until one is resolved.

**Low-confidence merges.** A duplicate adjudication the model flagged uncertain is a founder
decision, because merging two materials fuses two append-only ledgers with no clean undo.

**Escalated support.** By design, ~20% of questions. This number *should not* be driven to zero —
the questions that escape the KB are the ones that reveal product problems.

**Churn signals.** A3 reports that a client has not logged in for 16 days. It cannot tell whether
that is a holiday, a factory shutdown, or a client who has quietly stopped. That call is a phone
call.

**When an automation is wrong.** Every one has a degraded mode; noticing that a degraded mode has
become the normal mode is human work. A daily digest that has said "all good" for ninety consecutive
days deserves suspicion, not comfort.

### The new job automation creates

**Maintaining eight automations, six-plus crons, a constants inventory and a knowledge base.** ~4
hours a month at 100 clients (§8.4). Two specific standing rules, both modelled on
`tutorial-engine.md` §10.1's same-commit rule:

- **A session that hardcodes a statutory constant adds a row to `_ai/compliance-constants.json` in
  the same commit.**
- **A session that changes an Edge Function's response shape updates A8's synthetic test in the same
  commit.**

Both are enforceable for the same reason the tutorial rule is: the dependency is visible at the
point of the edit, and forgetting degrades the automation rather than breaking the product.

### What this adds up to

At 100 clients the founder does roughly 22 hours a month of operations, and every one of those hours
is judgment: a red row, an escalated question, a compliance fix, a pricing conversation, a novel
bug. **That is the correct outcome.** The objective was never zero hours — it was to make sure none
of the remaining hours are retyping.

---

## 10. Open Questions

Each needs a decision **before** the automation named. Flagged now so they are not discovered
mid-build.

### Blocking Wave 0

**Q1. What is the actual Edge Function execution ceiling, and what is per-tenant filing time?**
§3.3's queue architecture is right regardless, but the urgency depends on the real number.
**Action:** run the SQL in §3.3 immediately after the 5 October 2026 cron and record median and max
seconds per tenant. Compute `ceiling / median` and write it into this document.
**Decide before:** the A6 build starts. `[UNVERIFIED]`

**Q2. Does the founder Telegram channel stay a personal chat, or become a dedicated channel?**
A personal chat is simplest. A dedicated channel makes it possible to add a second person later
without re-plumbing, and separates ops noise from real messages.
**Recommendation:** a dedicated channel with the bot as admin. Same `FOUNDER_TELEGRAM_CHAT_ID`
secret either way; it costs nothing now and avoids a migration later.
**Decide before:** A0 ships.

### Blocking A6

**Q3. Is the filing package for every tenant, or Enterprise only?**
`enterprise-strategy.md` §3.2 says Enterprise only. The shipped code defaults it on for everyone
`[VERIFIED]`. They disagree and nobody has decided.
**Recommendation:** keep it on for everyone and update the Enterprise doc. ₹28/tenant/month is the
cheapest retention feature in the product and it makes every tenant's CA an advocate.
**Decide before:** the October run. It changes the cost table and the §8 projections.

**Q4. Batch API for the monthly package — when?**
Not latency-sensitive, 50% off, already recommended by `enterprise-strategy.md` §3.2 and never
implemented.
**Recommendation:** switch at 50 tenants. Below that, ₹700/month of saving is not worth the code
change; above it, the saving compounds and the queue architecture makes it natural.
**Decide before:** the book passes 50.

### Blocking A7

**Q5. Which GSTIN lookup provider?**
GSP versus commercial aggregator; ₹0.50–₹2 per call; reliability and terms vary.
**Action:** pick one, verify it returns trade name, address and state, and confirm the terms permit
storing the response.
**Decide before:** A7 starts. `[UNVERIFIED]`

**Q6. Filing package storage retention.**
Signed URLs expire in 7 days; the objects never do. At 1,000 tenants × 12 months that is 12,000
zips in `filing-packages`, growing forever.
**Recommendation:** retain 24 months, then delete, with the full export (`enterprise-strategy.md`
§3.4) as the permanent client-side answer. Deletion must be announced in the package README so no
client is surprised.
**Decide before:** A8's quota monitoring ships, so the policy exists before the alert fires.

### Blocking A4

**Q7. Is there a lint script for language-bundle completeness, and does it cover automations?**
`tutorial-engine.md` §10.3 specifies `_ai/regression/tutorial-lint.js` with `SUPPORTED_LANGS`
enumerated in exactly one place. Automation bundles need the same check.
**Recommendation:** one shared lint covering both, with a single `SUPPORTED_LANGS`. Two scripts with
two copies of that list is the exact failure ADR-3 exists to prevent.
**Decide before:** A4 Phase 2, or `tutorial-engine.md` T3 — whichever lands first owns it.

**Q8. Does the support agent ever answer a question about the client's own data?**
Today `agent-query`'s 28 read-only intents do that and the KB does not. A client asking "why is my
stock wrong?" is both a support question and a data question.
**Recommendation:** keep them separate. Support explains *the software*; the copilot answers *about
the data*. Merging them means a support conversation inheriting the daily quota and the Lite lockout
(§4.4 decision 1). The support agent may **link** to the copilot.
**Decide before:** A4 Phase 2 design freeze.

### Sequencing

**Q9. Does A1 ship before the KPML pilot signature, or during the pilot?**
`enterprise-strategy.md` §9 Q11 already flags the analogous tension for E1. Same shape here: A1 is
3–4 sessions and the vendor wave is the forcing function, but the wave follows the signature by
weeks.
**Recommendation:** before. Unlike E1, A1 is not optional to the pilot's success — the pilot *is*
twenty vendor onboardings, and doing those manually while running a pilot is the scenario this
document exists to prevent.
**Decide before:** Wave 2 starts.

**Q10. Voice notes — what accuracy bar, measured how?**
§5 defers them. The revisit needs a defined gate, not a vibe.
**Recommendation:** twenty real Marathi voice notes from a live factory floor, scored specifically on
**numeric** accuracy (quantities and rates). Below 98% on numbers, do not ship — a misheard material
name is caught at review; a misheard quantity may not be.
**Decide before:** any voice work is scheduled. `[UNVERIFIED]`

**Q11. Who owns the knowledge base's Marathi?**
`tutorial-engine.md` §10.5 assigns tutorial Marathi to the founder or a named native speaker. A4's
KB has the same requirement and a much higher update rate — every escalation is a candidate article.
**Recommendation:** English ships immediately on every KB article; Marathi batches weekly through the
§8.5 process. An article without reviewed Marathi answers in English rather than blocking.
**Decide before:** A4 Phase 2.

---

*Last updated: 11 September 2026. Design complete; no code written.*
*This is a living document. As it is built, move items from `[RECOMMENDED]` to `[DECIDED]`, close
open questions, record what actually shipped, and replace every `[UNVERIFIED]` with a measured
number — same convention as `enterprise-strategy.md` and `tutorial-engine.md`.*
*Load `CLAUDE.md` + this file to resume full automation context in a new session.*
