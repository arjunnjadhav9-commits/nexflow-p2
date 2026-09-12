---
name: kpml-network-sessions-21-22
description: Nexflow Sessions 21–22 — the KPML cross-tenant upgrade. p2_network_links scope and consent, the vendor consent panel, "view as principal", principal-side write access, and the real-vendor data migration. Read in full before any cross-tenant KPML work.
sources: [kpml-network-plan.md §9 Step 6 and §10.5, kpml-network-critique.md B12/N9/Q3/Q7, CLAUDE.md Sessions 9-11, md-audit-report.md]
last_updated: 11 September 2026
status: design complete — not yet built. Living document: update in place as it is built.
---

# Nexflow — KPML Network, Sessions 21–22

**Load order for a Session 21 or 22 session. Read in this order, in full:**

1. `_ai/CLAUDE.md` — especially "Shipped Sept 8, 2026 — Session 9" and "Shipped Sept 9, 2026 — Session 11"
2. `_ai/kpml-network-sessions-21-22.md` (this file)
3. `_ai/kpml-network-plan.md` §2 (the Type A guarantee), §8 (the data model), §10.5 (visibility isolation)
4. `_ai/kpml-network-critique.md` §Q3 and §Q7 — the reasoning behind every rule in §3 below

**Status: designed, not built.** Sessions 9–11 shipped the read-only principal dashboard. This file
covers what comes after the November meeting.

**Read §0 before planning from `kpml-network-plan.md`.** That file's §14 status table is dated 29
August and is wrong on eleven rows, including the one that matters most here.

---

## Tag convention

Inherited from `enterprise-strategy.md`, unchanged.

| Tag | Meaning |
|---|---|
| `[DECIDED]` | Decided. Build it as written. |
| `[RECOMMENDED]` | This document's recommendation. Needs founder sign-off. |
| `[VERIFIED]` | Checked against the live codebase, 11 Sept 2026. |
| `[UNVERIFIED]` | Needs a live check before code is written. Listed again in §9. |
| `[DECIDE BEFORE BUILDING]` | A human or commercial decision. Listed again in §9. |
| `[NEVER]` | Permanently out of scope. |

---

## 0. Corrections to `kpml-network-plan.md` — read first

### `[CORRECTION]` X1 — `p2_network_links` already exists

`kpml-network-plan.md` §14 says *"`p2_network_links` + scoped access path | Not built — Step 6"* and
§9 treats it as Step 6 work. **It was built on 8 September 2026 (Session 9)** `[VERIFIED —
CLAUDE.md]`, along with `get_principal_vendor_material()`, `principal-dashboard.html`, a real KPML
tenant and a real KPML login.

**What this changes.** Sessions 21–22 are not building the link table. They are **altering a table
that already carries live rows**, and the alteration is the part §14 says is already there.

### `[CORRECTION]` X2 — the shipped table lacks the columns both KPML files require

`kpml-network-plan.md` §9 Step 6 and §17, and `kpml-network-critique.md` B12, all specify a link
carrying *"explicit versioned scope + consent record + revocation timestamp — not just
active/inactive"*.

Shipped `[VERIFIED — CLAUDE.md lines 1957–1962]`:

```
principal_tenant_id, vendor_tenant_id, status (active/revoked), UNIQUE(principal, vendor)
```

No `scope`. No consent record. No revocation timestamp. No `granted_by`. §2 specifies the ALTER.

### `[CORRECTION]` X3 — the scoped access path, however, **is** built and is correct

This is the half `kpml-network-plan.md` is most worried about, and it is done.

`get_principal_vendor_material()` is `SECURITY DEFINER`, takes **no tenant-id parameter** (resolved
internally via `get_my_tenant_id()`), carries a scope-boundary comment in the function body, and
*"never returns vendor own stock (`owned_by IS NULL`), other principals' material, or any aggregate
spanning vendors"* `[VERIFIED — CLAUDE.md, Session 9]`.

That is precisely `kpml-network-plan.md` §10.5's architectural answer to failure mode 6 — *"enforce
scope in one parameterised access path that every principal-facing read goes through… then it
cannot be forgotten, because there is no other way to reach the data."*

**The consequence for Sessions 21–22 is a rule, not a nicety:** every new principal-facing read added
in these sessions goes through a `SECURITY DEFINER` RPC of the same shape, with the same
no-tenant-id-parameter discipline. **Do not add a second route.** Session 11 already added a second
one correctly (`get_principal_vendor_invoices`); make it three, not three plus an RLS policy.

### `[CORRECTION]` X4 — mother-factory pricing is contradicted across four files

`CLAUDE.md` lines 423–438 state principal pricing in settled form. `CLAUDE.md` line 2850 says
*"Mother-factory pricing: UNDEFINED."* `kpml-network-plan.md` says undefined in four places. And the
two live models differ by roughly 2× at 30 vendors:

| Model | Source | At 30 vendors |
|---|---|---|
| Sponsored seat, ₹12–18K **per vendor** | `kpml-network-plan.md` §12 | **₹6.1L – ₹8.4L** |
| Overage ₹5–7K **beyond 20** | `CLAUDE.md`, `enterprise-strategy.md` §7, `business-strategy.md` §2.1 | **₹3.0L – ₹3.7L** |

`[DECIDE BEFORE BUILDING]` — and before the meeting, not before the build. §9 Q1.

**Why it touches the build and not only the pitch:** `kpml-network-plan.md` §12 and §2 both say
*"price on active principal-side links, never on a tenant-level flag."* Under the sponsored-seat
model every active link is billable; under the overage model only links beyond the twentieth are.
The link table needs to carry enough to compute either — which it will, once §2's ALTER lands, since
`granted_at` plus `status` is sufficient for both.

---

## 1. Where the network actually is

| Piece | State |
|---|---|
| `p2_network_links` table | ✅ Built, Session 9 — minimal shape (X2) |
| `get_principal_vendor_material()` | ✅ Built, Session 9 — the scoped path, correct (X3) |
| `get_principal_vendor_invoices()` | ✅ Built, Session 11 — payment visibility |
| `principal-dashboard.html` | ✅ Built, Session 9; v2 with vendor list → detail, Session 11 |
| KPML tenant | ✅ `cc23eb60-329b-40ac-8d4a-0667c28546a5`, login `kpml@nexflowautomations.in` |
| Linked vendor | ⚠️ **Test tenant only** (`fe2b94fb-…`), 5 seeded GRN rows across all four s.143 bands |
| Real vendors linked | ❌ Not linked. Their KPML client rows have `is_job_work_principal = false`, so **past GRNs were never recorded with `owned_by` set** |
| Vendor consent panel | ❌ Not built, not in the build order |
| "View as principal" preview | ❌ Not built, not in the build order |
| Scope / consent / revocation on the link | ❌ Not built (X2) |
| Principal **write** access | ❌ Not built, not designed |
| Correction model for cross-tenant writes | ❌ Not built, not designed |

**The exposure position today is nil, and that is luck rather than design.** The only linked vendor
is the test tenant. It stops being luck the moment Session 9's own open item 3 is executed — *"SS
Engineering, Datta Prasad, Shivprasad need their KPML client rows updated to
`is_job_work_principal=true` and past GRNs re-recorded with `owned_by` set before the November demo
can show real vendor data"*.

**That data migration is the trigger for everything in this file.** Sequence the consent panel
before it, not after. See §7.

---

## 2. Session 21 — scope, consent and the vendor's side

### 2.1 The ALTER

```sql
-- 20261115_network_links_consent.sql
-- p2_network_links was created minimally in Session 9. This adds the scope and
-- consent record that kpml-network-plan.md §9 Step 6 and kpml-network-critique.md
-- B12 both specify, on a table that already carries live rows.

ALTER TABLE p2_network_links
  ADD COLUMN IF NOT EXISTS scope          text NOT NULL DEFAULT 'principal_material_v1'
    CHECK (scope = 'principal_material_v1'),
  ADD COLUMN IF NOT EXISTS consented_at   timestamptz,
  ADD COLUMN IF NOT EXISTS consented_by   uuid REFERENCES auth.users(id),
  ADD COLUMN IF NOT EXISTS consent_source text
    CHECK (consent_source IN ('vendor_panel','founder_manual','pilot_agreement')),
  ADD COLUMN IF NOT EXISTS revoked_at     timestamptz,
  ADD COLUMN IF NOT EXISTS revoked_by     uuid REFERENCES auth.users(id),
  ADD COLUMN IF NOT EXISTS revoke_reason  text;

-- Backfill the one existing row honestly. It was created by the founder, not consented to.
UPDATE p2_network_links
   SET consent_source = 'founder_manual'
 WHERE consent_source IS NULL;

CREATE INDEX IF NOT EXISTS p2_network_links_vendor_active_idx
  ON p2_network_links (vendor_tenant_id)
  WHERE status = 'active' AND revoked_at IS NULL;
```

**`scope` has a single permitted value and a CHECK that enforces it.** A free-text scope column is a
scope column that quietly widens. When a second scope genuinely exists, widening the CHECK is a
deliberate migration with a review. This is `bridge-agent.md` §8.3's reasoning for `p2_ca_grants`,
applied to the same problem.

**`revoked_at` is separate from `status`.** `status` says whether the link is live; `revoked_at` says
when and by whom it stopped being live, and it survives a re-grant. `status` alone is half an audit
trail — the same gap `bridge-agent.md` §8.3 flags on `granted_by` without `revoked_by`.

**Do not add `telegram_chat_id` to this table.** `kpml-network-plan.md` §17 is explicit: the link is
*"**not** a third home for `telegram_chat_id`."* Telegram routing resolves through the recipient
tenant's own `p2_tenant_settings`, always.

### 2.2 What the vendor consents to — the exact words

Rendered on the vendor's own screen, in their own language, generated **from the same filter that
governs the query** (§2.3). This is the text from `kpml-network-plan.md` §10.5 and
`kpml-network-critique.md` Q7, unchanged:

> **KPML can see:** material they sent you and its current quantity · what you consumed against
> their orders · scrap you declared on their material · challans between you and them · their
> finished goods you are holding · invoices you raised on them.
>
> **KPML cannot see:** your own materials or stock · material belonging to any other company ·
> **whether you work for anyone else at all** · your own sales, clients or prices · your suppliers ·
> your total production volume.

**The third exclusion is the one that matters and it must be stated explicitly.** A vendor serving
KPML and Godrej is not merely hiding Godrej's quantities — they are hiding **Godrej's existence**.

### 2.3 Generate the panel from the filter, never from prose `[DECIDED]`

If the visibility panel is hardcoded text and the scope is code, they will diverge, and the
divergence will be discovered by a customer.

**Implementation.** A single `SECURITY DEFINER` function
`get_network_scope_description(p_link_id uuid)` returns the structured list of what the scope
permits, derived from the same `scope` value the RPCs branch on. The panel renders that. Adding a
field to a principal-facing RPC without adding it to the scope description is then a visible
omission rather than a silent one.

### 2.4 "View as principal" — the strongest trust feature available `[DECIDED]`

Let the vendor see exactly what KPML sees, on demand.

**It is nearly free.** `get_principal_vendor_material()` and `get_principal_vendor_invoices()` both
resolve the caller internally via `get_my_tenant_id()`. A sibling pair —
`preview_as_principal_material(p_principal_client_id uuid)` and `preview_as_principal_invoices(...)`
— run the **identical query body** with the roles inverted: caller is the vendor, `owned_by` is
filtered to the named principal.

**Hard rule:** the preview functions must call the same SQL as the real ones. If they are written
twice they will drift, and a drifted preview is worse than none — it tells the vendor a
reassuring lie. `[RECOMMENDED]` extract the body into one `SECURITY DEFINER` helper that both call
with different resolved parties.

**Why this is worth a session slot rather than a backlog line.** It converts an abstract promise into
something checkable, and **it makes a leak self-reporting: the vendor notices before the principal
does.** In a district where a leak is a market-wide reputation event, that is the difference between
a bug and an ending.

### 2.5 Where these surfaces live

| Surface | Page | Gate |
|---|---|---|
| Consent panel — what KPML can and cannot see | `settings.html`, new "Network" tab | Owner only (inherited from the page) |
| Grant / revoke | same | Owner only |
| "View as principal" | same tab, a button per active link | Owner only |
| Active links list | same | Owner only |

**`settings.html` is owner-only** — it redirects every other role to `index.html` `[VERIFIED]`. That
is correct for consent: granting a competitor visibility into your stock is an owner decision, not a
supervisor one.

---

## 3. The six failure modes, and what defends each

`kpml-network-plan.md` §10.5 and `kpml-network-critique.md` Q3 both enumerate these. This table is
the build checklist — every new principal-facing surface in Sessions 21–22 is tested against all six
before it ships.

| # | Failure mode | Why it leaks | Defence |
|---|---|---|---|
| 1 | **Aggregate leak** | Any total spanning owners encodes the other principal's quantity. Sums leak because they look innocuous. | No principal-facing query may `SUM` across `owned_by`. Assert in the RPC, not in the caller. |
| 2 | **Existence leak** | A material list scoped to the *vendor* rather than to the *link* reveals materials KPML never sent. **Inference is disclosure.** | Every list starts from `owned_by = <principal>`, never from the vendor's master. |
| 3 | **Variance-denominator leak** | Variance computed against *total* consumption rather than the principal's pool directly encodes the other principal's volume. **The most likely leak in practice, because a denominator feels like a detail.** | Any ratio shown to a principal has a numerator *and a denominator* inside the scope. Write the denominator into the RPC. |
| 4 | **Alert leak** | Low-stock or capacity signals derived from the vendor's overall position. | Principal-facing alerts read `v_p2_stock_balance_by_owner` filtered to that principal, never `v_p2_stock_balance`. |
| 5 | **Scorecard leak** | Metrics computed across principals, or benchmarked revealingly. | No scorecard in Sessions 21–22. When one is asked for, it is per-principal or it is not built. |
| 6 | **RPC drift** | Scope lives in each function's select list; someone adds a column later and the filter is not extended. **This is the one that actually happens.** | X3's single-path discipline, plus §2.3's generated panel. A new column that is not in the scope description is a review failure. |

**The cost of a leak is not embarrassment.** If KPML learns a vendor works for Godrej, KPML may pull
work and the vendor may be in breach of a confidentiality term — caused by software they pay for. In
a district where every factory owner knows every other, that is a market-wide reputation event and
the end of the network story. **Unrecoverable.** Treat inter-principal isolation as the top product
risk, above security in the conventional sense.

---

## 4. Session 22 — principal-side write access

**Gated on the pilot being signed.** `kpml-network-plan.md` §16: *"After the pilot — full
principal-side write access."* Do not build this before there is a signature.

### 4.1 What "write access" means, exactly

The narrowest useful version, and the only one this document endorses for v1:

| KPML can | KPML cannot |
|---|---|
| Record a **dispatch of their own material** to a linked vendor, creating the vendor-side inbound GRN in the vendor's tenant with `owned_by = KPML` | Create, edit or delete any vendor master record — material, product, supplier, client, price |
| Attach the **principal's challan number and date**, which is what starts the s.143 clock correctly | Touch a vendor row they did not create |
| **Cancel a dispatch they created**, producing a reversal, never a delete | Cancel or amend anything the vendor created |
| Record a **receipt** against a vendor's return challan | See or affect any material where `owned_by != KPML` |

**Everything KPML writes is `owned_by = KPML` by construction.** That is not a filter applied at
write time; it is the only value the write RPC accepts.

### 4.2 The correction model must land before the first cross-tenant write `[DECIDED]`

`kpml-network-plan.md` §9 Step 6 and `kpml-network-critique.md` F17 both say this, and F17 says why:

> *"Once one bad dispatch has a counterparty GRN, a s.143 clock, a payment record and three
> notifications keyed off it, 'just cancel it' is not a one-table operation. Define the correction
> model — reversing entries linked to the original, both sides notified, the clock re-based —
> **before** there are cross-tenant writes, not after the first bad one."*

**The shape `[RECOMMENDED]`:**

- A correction is a **new linked row**, never an update or a delete. `p2_stock_transactions` is
  append-only and must stay so.
- The reversal carries `reference_id` pointing at the original, so the audit trail is complete in
  both directions.
- **Both sides are notified** through the existing `p2_notifications` → `notify` pipeline, with one
  new type. That pipeline has six documented silent-failure points and zero retries
  `[VERIFIED — codebase-audit.md §4.5]`, so a cross-tenant correction notification is exactly the
  case where a lost message matters — fix the retry gap or accept that the in-app bell is the real
  channel and Telegram is best-effort.
- **The s.143 clock re-bases** from the corrected `principal_challan_date`, computed at read time by
  `js/s143-clock.js`, which already does `clockStart = row.principal_challan_date ||
  row.transaction_date` `[VERIFIED — Session 8]`. Nothing stored needs to change; this falls out for
  free, and it is a good reason the read-time clock was the right call.

### 4.3 What is still `[NEVER]`

Unchanged from `kpml-network-plan.md` §10.5 and `enterprise-strategy.md` §8:

1. **Reading anything a vendor did not send them.** Scope is absolute; Enterprise creates no
   exception to it.
2. **SAP integration.** Bespoke work for one customer, in a system Nexflow does not control —
   `kpml-network-plan.md` §13's named trap. PO push is modelled on the SAP PO's *shape*, as a
   Nexflow-native feature, gated on a named request.
3. **`stock-share.html` or any tenant-level share token.** Cut permanently.
4. **Any aggregate spanning principals**, on any surface, ever.
5. **Deleting anything in a vendor's tenant.** Corrections are new rows.

---

## 5. Pricing hooks

Whichever model X4 resolves to, the link table after §2.1's ALTER supports both:

- **Sponsored seat:** bill on `count(*) WHERE status='active' AND revoked_at IS NULL` per principal.
- **Overage beyond 20:** `GREATEST(0, count(*) - 20)` on the same predicate.

`granted_at` / `consented_at` give the proration date either way. **Price on active principal-side
links, never on a tenant-level flag** — `kpml-network-plan.md` §2, because roles are per-relationship
and a binary tier breaks the first time a vendor sends something out for plating.

---

## 6. Example — the real KPML shape

Using the real identities, because the migration in §7 will use exactly these.

```
KPML  tenant cc23eb60-329b-40ac-8d4a-0667c28546a5   is_principal = true, is_job_worker = false

  p2_network_links
    ├─ vendor 5ab7fb07-…  S.S. Engineering        status active, scope principal_material_v1
    ├─ vendor 3b68db90-…  Datta Prasad Enterprises status active, scope principal_material_v1
    ├─ vendor 6fe0680a-…  Shivprasad Industries    status active, scope principal_material_v1
    └─ vendor fe2b94fb-…  test tenant              status active, consent_source founder_manual

  Each link resolves to exactly one filter:  owned_by = <KPML's row in that vendor's p2_clients>
```

**Note the indirection, and do not get it wrong.** `owned_by` on `p2_stock_transactions` and
`p2_dispatch_orders` is a FK to **`p2_clients(id)`** — the vendor's own client record for KPML — not
to `p2_tenants(id)` `[VERIFIED — CLAUDE.md, Step 2I]`. `p2_network_links.principal_tenant_id` is a
tenant id. The RPC resolves one to the other by finding the vendor's `p2_clients` row with
`is_job_work_principal = true` and `linked_tenant_id = <principal tenant>`.

`p2_clients.linked_tenant_id` exists for exactly this `[VERIFIED — CLAUDE.md, Step 2I]`. **It must
be populated on all three real vendors as part of §7's migration**, or the RPC has no join path and
returns empty — which looks identical to "this vendor holds none of your material."

---

## 7. The real-vendor data migration `[DECIDE BEFORE BUILDING]`

This is the prerequisite for the November demo, and `CLAUDE.md` Session 9 flags it correctly as *"a
data migration task, not a code task — discuss with each client before touching their records."*

**What has to be true for KPML to see real data:**

1. Each vendor's `p2_clients` row for KPML gets `is_job_work_principal = true` and
   `linked_tenant_id = cc23eb60-…`.
2. Past GRNs of KPML material get `owned_by` set to that client row's id. **This rewrites history on
   three live tenants.**
3. `principal_challan_no` / `principal_challan_date` get filled where known — which drives the s.143
   clock (`clockStart = principal_challan_date || transaction_date`). Where unknown, the clock falls
   back to the GRN date, which is **later** than the true start and therefore **understates
   exposure**. Say so on the dashboard rather than letting KPML read a reassuring number.
4. `separate_pool_deduction` is considered per vendor — `CLAUDE.md` Session 5 records it defaults to
   `false` (unified inventory, no pool attribution), and the ITC-04 working paper warns that Tables
   5A/5B/5C will be empty in that mode `[VERIFIED — Session 8]`.

**Sequencing rule `[DECIDED]`: the consent panel (§2) ships before step 1 of this migration.** A
vendor whose data becomes visible to their largest customer should have seen the panel that says
what is visible, before it is. Doing it the other way round is defensible technically and
indefensible in the conversation that follows.

**Per-client conversation, not a script.** Three owners, three calls. The honest framing is
`kpml-network-plan.md` §3's vendor-side pitch: *"your principal will ask you for these numbers
repeatedly, and today you cannot produce them. Be the vendor who answers in ten seconds and never
gets accused."* Not *"we are giving KPML visibility."*

---

## 8. Build sequence

### Session 21 — consent and the vendor's side (1 session)

| # | Step | Output |
|---|---|---|
| 1 | Migration `20261115_network_links_consent.sql` | §2.1. Test tenant first; the backfill sets the one live row to `founder_manual`. |
| 2 | `get_network_scope_description()` | §2.3. One function, structured output. |
| 3 | `settings.html` → new "Network" tab | Active links, the consent panel rendered from step 2, grant/revoke. Owner-only. |
| 4 | `preview_as_principal_material()` / `..._invoices()` | §2.4. **Same SQL body as the real RPCs**, roles inverted. |
| 5 | "View as principal" UI | Button per link; renders the preview through the same components `principal-dashboard.html` uses. |
| 6 | Six-failure-mode test pass | §3, every row, against a two-principal fixture on the test tenant. |

**Acceptance test for Session 21.** Create a second fake principal on the test tenant holding
different material. Open "View as principal" for principal A. **Principal B's existence must be
unreachable** — not in a count, not in a total, not in a material list, not in a challan-number gap.
If any surface reveals it, the session is not done.

### Session 22 — principal write access (1 session, gated on the pilot signature)

| # | Step | Output |
|---|---|---|
| 1 | The correction model | §4.2. **Before any write path.** |
| 2 | `principal_create_dispatch()` RPC | `SECURITY DEFINER`, `owned_by` fixed to the calling principal, writes the vendor-side GRN with `principal_challan_no`/`_date`. |
| 3 | `principal_cancel_dispatch()` RPC | Reversal row, never a delete. Linked via `reference_id`. |
| 4 | Principal dashboard write UI | Dispatch form on `principal-dashboard.html`, per vendor. |
| 5 | Cross-tenant notification | One new `p2_notifications` type, both sides. |
| 6 | Six-failure-mode test pass, again | Write paths leak differently from read paths. |

---

## 9. Open questions

**Q1. Which vendor pricing model?** `[DECIDE BEFORE BUILDING]` — X4.
Sponsored seat (₹12–18K/vendor, all vendors, ≈₹6.1–8.4L at 30) or overage (₹5–7K beyond 20,
≈₹3.0–3.7L at 30). The link table supports both after §2.1, so this does not block the build — but
it blocks the meeting, and the meeting is the point.
**Decide before:** the KPML meeting.

**Q2. Does the migration in §7 rewrite history, or start from a cutover date?** `[DECIDE BEFORE BUILDING]`
Setting `owned_by` on past GRNs changes what three live tenants' stock screens have always shown.
`[RECOMMENDED]` **cutover, not rewrite**: set `is_job_work_principal` and `linked_tenant_id` now,
attribute new GRNs from that date, and show KPML an honest *"records begin 1 November 2026"* line.
Rewriting history on a live tenant to make a demo look fuller is the one thing that can turn a
reference customer into a detractor.
**Decide before:** §7 step 2.

**Q3. What does KPML see for a vendor with `separate_pool_deduction = false`?** `[UNVERIFIED]`
That mode means no pool attribution on consumption, so the dashboard can show material received but
not material consumed against KPML's orders. The ITC-04 paper already warns about the empty tables.
**Resolve:** check each live vendor's setting, then decide whether the dashboard shows a gap or a
caveat.
**Decide before:** the November demo.

**Q4. Who at KPML sees what?** `[DECIDE BEFORE BUILDING]`
`kpml-network-critique.md` F13 raises this and it is still open: KPML has an accounts manager, a
storekeeper, a purchase head and a CA, and *"one account plus four people equals one shared
password, which is exactly how the audit trail — the entire product promise — dies."* KPML's tenant
uses the same `js/roles.js` roles as any tenant, so the mechanism exists; nobody has decided the
mapping.
**Decide before:** KPML staff are invited.

**Q5. Does revocation hide history from the principal?** `[RECOMMENDED: no]`
`kpml-network-plan.md` §10.5: *"revocation must not destroy history — the principal keeps their own
one-sided records and loses only live corroboration."* Under the current architecture KPML's view is
**entirely** derived from the vendor's tenant, so revocation currently removes everything. That is a
real divergence from the stated promise and it should be said plainly on the revoke dialog rather
than discovered.
**Decide before:** §2's revoke button ships.

---

*Last updated: 11 September 2026. Design complete; no code written.*
*Move `[RECOMMENDED]` to `[DECIDED]` as decisions are taken, and record the §7 migration's actual
scope the day it is agreed with each client.*
