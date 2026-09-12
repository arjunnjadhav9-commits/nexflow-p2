---
name: codebase-audit
description: "HISTORICAL AUDIT — 4 September 2026. Statuses superseded by CLAUDE.md's Shipped entries. Read for the still-open items list ONLY. Do NOT act on the priority fix list — ~60% of items are already fixed in Sessions 1-17."
sources: [codebase-analysis]
last_updated: Sept 2026
---

# Nexflow P2 — Full Codebase Audit

**Audit date:** 4 September 2026
**Scope:** 27 root `.html` files, 11 files in `js/`, 10 Edge Functions in `supabase/functions/`, 51 migrations in `supabase/migrations/`, 1 Vercel function in `api/`, `sql/`, `css/nexflow-design.css`.
**Ground truth for intent:** `_ai/CLAUDE.md` (1610 lines, read in full).
**Live tenants affected by everything below:** S.S. Engineering, Datta Prasad Enterprises, Shivprasad Industries — all three are KPML job workers under s.143.

> **Audit date: Sept 3 2026. Resolution status as of Sept 4 2026.**
> Sessions 1–4 addressed the majority of findings. Status per category:
>
> FIXED: RLS not enabled on p2_stock_transactions and 15 other tables.
> FIXED: set_tenant_id() trigger using auth.uid() (blocked all staff writes across 10 tables).
> FIXED: All 13 tables with auth.uid() write policies — now get_my_tenant_id().
> FIXED: handle-new-user unauthenticated privilege escalation endpoint — deleted.
> FIXED: grn.html lines 662/728 tenant ID bug for staff roles.
> FIXED: Challan number burning on draft saves (dispatch.html).
> FIXED: production-issue.html number burning on failed confirm.
> FIXED: Payment modal field order, balance due display, over-payment guard, Marathi.
> FIXED: Accountant role missing dashboard permission.
> FIXED: 7 dead agent command references in manual.html.
> FIXED: v_p2_wip_balance and v_p2_invoice_payment_status cross-tenant view leaks.
> FIXED: Datta Prasad invoice rate trap — warning banner + checkbox guard.
> FIXED: dispatch.html fail-open stock check → fail-closed.
> FIXED: grn-history.html filtering out principal GRNs.
> FIXED: p2_user_roles SELECT policy — widened to get_my_tenant_id(), three redundant
>   policies dropped.
>
> STILL OPEN:
> - Return dispatch pool bug: dispatch.html's confirm_dispatch_transaction call never
>   passes p_owned_by for any movement type, so it always defaults to NULL. Deducts from
>   own stock instead of principal's pool on returns. CRITICAL — fix before merge.
> - v_p2_stock_balance: definition not in repo (UNVERIFIED status from original audit
>   remains — confirm via SQL Editor if needed).
> - p2_tenants: no policy for staff write access to their own tenant row (DELETE/UPDATE
>   still owner-only via auth.uid() — intentional for tenants, flagged only).
> - scanner.html: GRNs always own-stock only — no Material Owner selector.
>   Deliberate design decision documented in CLAUDE.md.
> - Per-material pool override (Type E BOM): not built — deferred until client requests.

## Tag legend

| Tag | Meaning |
|---|---|
| `[BUG]` | Confirmed defect affecting live clients today |
| `[SECURITY]` | Potential security or data-leak issue |
| `[COMPLIANCE]` | GST/legal compliance gap |
| `[UX]` | Usability issue that increases error risk |
| `[DEBT]` | Technical debt, not urgent |
| `[FIXED]` | Confirmed fixed, kept for audit trail |
| `[UNVERIFIED]` | Cannot confirm from repo files — needs a live DB/deployment check |

## Method note — what this audit could NOT see

Four things are not in the repo and are therefore marked `[UNVERIFIED]` throughout:

1. **The initial schema.** There is no `CREATE TABLE` for `p2_stock_transactions`, `p2_raw_materials`, `p2_products`, `p2_suppliers`, `p2_clients`, `p2_tenant_settings`, `p2_tenants`, `p2_user_roles`, `p2_material_prices`, `p2_product_prices`, `p2_product_bom`, `p2_client_po_numbers`, or `p2_agent_logs` anywhere in `supabase/migrations/`. Column types, NOT NULL, FK and index state for those tables are inferred from usage.
2. **`v_p2_stock_balance`.** The view definition exists nowhere in the repo. Everything about it is taken from `_ai/CLAUDE.md`.
3. **`get_next_challan_number` (live 3-arg version) and `cancel_challan`.** `sql/get_next_challan_number.sql` is explicitly documented as a stale 1-arg copy with the wrong signature (`supabase/migrations/20260822_challan_next_override.sql:23-26`). `cancel_challan` has no source file at all.
4. **Which Edge Functions are actually deployed.** `supabase/functions/` contains files; deployment state is not knowable from here.

---

# Part 1 — Authentication and tenant isolation

## 1.1 Tenant ID resolution

The correct pattern is `user.user_metadata?.tenant_id || user.id`. It appears 55 times across the codebase. The following sites use raw `user.id` as a tenant ID instead.

### `[BUG]` `[SECURITY]` grn.html — GRN submission writes the wrong tenant_id — **Critical**

- **`grn.html:662`** — `const tid = user.id;` inside the `#grnForm` submit handler
- **`grn.html:728`** — `const tid = user.id;` inside the "Add Supplier" handler

`grn.html:335` already resolves `tenantId = user.user_metadata?.tenant_id || user.id` correctly at init, and `loadRecentGRN()` (`grn.html:768`) and `loadReconciliation()` (`grn.html:844`) use it. The two write paths ignore it and re-derive `user.id`.

- **Consequence if not fixed:** A storekeeper — the exact role whose entire job is GRN entry — either has every GRN insert rejected by the `staff_tenant_access` RLS `WITH CHECK`, or (if RLS on `p2_stock_transactions` is disabled, see §6.1) writes orphan rows under their own auth uid that the owner can never see. Received stock silently does not exist. Same for suppliers they add.
- **Fix:** Replace both `const tid = user.id` with the module-level `tenantId` already resolved at `grn.html:335`.

### `[DEBT]` `[SECURITY]` settings.html — 22 sites use `user.id` as tenant_id — **Medium**

`settings.html` mixes both patterns. 22 sites use the correct `user.user_metadata?.tenant_id || user.id`; the following 22 use raw `user.id`:

| Line | Operation |
|---|---|
| 1421 | `p2_tenant_settings` update — `.eq('tenant_id', user.id)` |
| 1606, 1620 | challan sequence read/update |
| 1923 | suppliers list select |
| 1958 | supplier insert |
| 2063 | clients list select |
| 2102 | client insert |
| 2218, 2279 | client update / delete |
| 2295, 2300 | staff roles + pending invites select |
| 2330, 2340 | staff row rendering + invite metadata JSON |
| 2385 | `/api/invite-staff` body: `tenant_id: user.id, inviter_id: user.id` |
| 2441 | materials select for adjustment |
| 2467 | **stock adjustment insert** |
| 2488 | recent adjustments select |
| 2951 | material price history select |
| 3010 | material price insert |
| 3036 | product price insert |
| 3045, 3046 | products select for price history |
| 3225 | materials select |

- **Consequence if not fixed:** Latent, not live. `settings.html` hard-redirects any non-owner at `settings.html:3288` (`if (role !== 'owner') window.location.href = 'index.html'`), and for an owner `user.id === tenant_id`. The moment settings is ever opened to a supervisor — or any of these handlers is copy-pasted into a page that isn't owner-only — 22 write paths silently target the wrong tenant. The invite payload at 2385 is the riskiest: it hard-codes the assumption that only an owner can invite.
- **Fix:** Resolve `tenantId` once at page init into a module-level variable and use it everywhere, matching the pattern already used at 22 other sites in the same file.

### `[BUG]` challan.html — client autofill upserts under `user.id` — **Medium**

- **`challan.html:701`** — `p2_clients.upsert({ tenant_id: user.id, ... })`
- **`challan.html:707`** — `p2_client_po_numbers.upsert({ tenant_id: user.id, ... })`

`challan.html:377` resolves the tenant correctly for the page's own load queries; only these two best-effort autofill writes use `user.id`.

- **Consequence:** A supervisor editing client details on a challan writes an orphan `p2_clients` row (or has it rejected). The next dispatch's client autocomplete does not learn the client. Silent — both calls swallow errors into `console.error`.
- **Fix:** Use the `tenantId` already in scope from `challan.html:377`.

### `[BUG]` js/navbar.js — plan chip queries the wrong table with the wrong key — **Low**

- **`js/navbar.js:278`** — `.from('p2_tenants').select('plan').eq('id', user.id).single()`

Two defects in one line: `user.id` is not the tenant for staff, and `plan` is documented in `_ai/CLAUDE.md` as living on `p2_tenant_settings`, not `p2_tenants`. This is the only reader of `p2_tenants.plan` in the entire codebase. The whole block is wrapped in `catch(_){}` at line 285, so any failure is invisible.

- **Consequence:** The plan chip in the navbar is silently blank (for staff certainly; for everyone if the column does not exist). If the column does exist, it is a second source of truth for plan that can drift from `p2_tenant_settings.plan`, which drives all actual gating.
- **Fix:** Read `plan` from `p2_tenant_settings` keyed on the resolved `tenantId`, and drop `p2_tenants.plan` if it exists.

### `[FIXED]` Correct pattern confirmed at

`js/supabase-client.js:24` (`checkAuth`), `js/supabase-client.js:157` (`checkAuthAndTenant`), `js/notifications.js:17` and `:47`, `js/agent-chat.js:17` and `:60`, `js/navbar.js:518` and `:483`, `grn.html:335`, `challan.html:377`, `index.html:517/594/808`, `receive.html:444/604`, `invoices.html:587`, `all-dispatch-history.html`, `export.html:626`, and 22 sites in `settings.html`.

## 1.2 RLS belt-and-suspenders — queries relying on RLS alone

Counted `.from('p2_*')` / `.from('v_p2_*')` calls against `.eq('tenant_id', …)` per file. Note that this only matters if RLS is actually enabled — see §6.1, where it is confirmed that it is not on at least one table.

| File | Queries | With explicit `tenant_id` | Gap |
|---|---|---|---|
| `rm-dispatch.html` | 17 | 7 | **10** |
| `dispatch.html` | 19 | 9 | **10** |
| `settings.html` | 55 | 42 | 13 |
| `onboarding.html` | 16 | 9 | 7 |
| `challan.html` | 7 | 2 | 5 |
| `products.html` | 12 | 9 | 3 |
| `index.html` | 6 | 4 | 2 |
| `invoices.html` | 12 | 10 | 2 |
| `production-issue.html` | 14 | 12 | 2 |
| `grn.html` | 6 | 4 | 2 |
| `js/navbar.js` | 5 | 3 | 2 |
| `dispatch-history.html`, `issue-history.html`, `rm-dispatch-history.html` | 3 each | 2 each | 1 each |
| `scanner.html` | 4 | 3 | 1 |
| `all-dispatch-history.html`, `export.html`, `js/notifications.js`, `js/supabase-client.js` | — | — | 1 each |
| `ca-report.html`, `reports.html`, `grn-history.html`, `gstr2b-reconcile.html`, `receive.html`, `admin-agent.html`, `js/utils.js`, `js/agent-chat.js` | — | — | **0 — clean** |

### `[SECURITY]` Highest-value unfiltered sites — **Medium**

| Location | Query | Note |
|---|---|---|
| `index.html:716-722` | `p2_stock_transactions` material history — `.eq('raw_material_id', …)` only | **Also missing `.is('owned_by', null)`** — see §3.4 |
| `index.html:441-443` | `p2_raw_materials` min-stock update — `.eq('id', materialId)` only | Write path |
| `challan.html:667-673` | `p2_dispatch_orders` client-info update — `.eq('id', dispatchOrderId)` only | Write path |
| `challan.html:618-624` | `p2_dispatch_orders` note/footer update — `.eq('id', …)` only | Write path |
| `challan.html:385-386` | `p2_dispatch_items` select — `.eq('dispatch_order_id', …)` only | |
| `dispatch.html:1000-1003` | `p2_product_bom` in the pre-confirm stock check — `.eq('product_id', …)` only | Note the *second* BOM fetch at `dispatch.html:1132` **does** filter tenant — the two disagree |
| `dispatch.html:1098-1101` | `p2_dispatch_items` **delete** — `.eq('dispatch_order_id', …)` only | Destructive |
| `rm-dispatch.html:1057-1060`, `rm-dispatch.html:1173-1176` | `p2_dispatch_items` **delete** — no tenant filter, **and the result is never destructured or checked** | Destructive + silent |
| `products.html:730-737` | `p2_products` reactivate update — `.eq('id', …)` only | |

- **Consequence:** With RLS confirmed disabled on `p2_stock_transactions` and unverified on ~12 other tables, these are not belt-and-suspenders gaps — they are the only line of defence, and it is missing. Even with RLS working they are the pattern that turns a future RLS regression into silent cross-tenant writes.
- **Fix:** Add `.eq('tenant_id', tenantId)` to every one; make it a review rule for new queries.

## 1.3 Service role exposure — client-side

### `[FIXED]` No service role key in any client-side file

Searched all `.html` and `js/*.js` for `service_role`, `SUPABASE_SERVICE_ROLE_KEY`, `SB_SECRET_KEY`, and `eyJ…role":"service_role`. **Zero hits.** The only key in client code is the anon key at `js/supabase-client.js:2`, which is correct and intended to be public.

Service keys are referenced only inside Edge Functions (`SB_SECRET_KEY` in agent-query / notify / telegram-webhook / receive-dispatch / invoice-view / invite-staff; `SUPABASE_SERVICE_ROLE_KEY` in check-low-stock / confirm-dispatch / get-user-email / handle-new-user) and in `api/invite-staff.js` via `process.env`.

## 1.4 Auth redirect — pages rendering before auth is confirmed

Every authenticated page calls `await checkAuth()` before loading data. Verified call sites: `admin-agent.html:497`, `admin-backup.html:264`, `all-dispatch-history.html:300`, `ca-report.html:307`, `challan.html:938`, `dispatch-history.html:306`, `dispatch.html:553`, `export.html:2414`, `grn-history.html:243`, `grn.html:322`, `gstr2b-reconcile.html:336`, `index.html:880`, `invoices.html:575`, `issue-history.html:306`, `manual.html:813`, `onboarding.html:1649`, `production-issue.html:891`, `products.html:362`, `reports.html:396`, `rm-dispatch-history.html:306`, `rm-dispatch.html:564`, `scanner.html:335`, `settings.html:3284`.

Public-by-design (no auth, correct): `login.html`, `accept-invite.html`, `error.html`, `receive.html`, `invoice.html`.

### `[DEBT]` `checkAuth()` failure is not fail-closed — **Low**

`js/supabase-client.js:14-64` returns `false` only when `getUser()` returns no user. If the `p2_tenant_settings` fetch at line 30 throws (network blip), the function throws out of `checkAuth()` — every caller wraps it in `try/catch` that shows an error state, so the page does not render data. Acceptable. But note `checkAuth()` defaults the plan to `'founder'` at line 37 when the settings row is missing, which means a genuinely-Lite tenant with a broken settings row gets Pro features.

- **Fix:** Default to `'lite'` (least privilege) rather than `'founder'`, or hard-fail.

## 1.5 RLS policies using `auth.uid()` instead of `get_my_tenant_id()`

Full inventory of every policy in `supabase/migrations/`:

| Policy | Table | Predicate | Verdict |
|---|---|---|---|
| `tenant_own` | `p2_invoices` (`20260730_create_invoices_table.sql:47-48`) | `tenant_id = auth.uid()` | `[DEBT]` **Low** — an additive `staff_tenant_access` policy using `get_my_tenant_id()` also exists on this table (`20260803_staff_rls_fix.sql:49-51`), and permissive policies OR together, so staff are not blocked. Still worth dropping for clarity. |
| `tenant_own` | `p2_pending_invites` (`20260803_pending_invites_and_role_fixes.sql:78-79`) | `tenant_id = auth.uid()` | Same — `staff_tenant_access` also present. Owner-only route anyway. Fine. |
| `p2_user_roles_delete_policy` | `p2_user_roles` (`20260803_pending_invites_and_role_fixes.sql:39-40`) | `tenant_id = auth.uid() AND user_id <> tenant_id` | **Intentional and correct** — owner-only staff removal. |
| `p2_user_roles_select_own_row` | `p2_user_roles` (`20260803_p2_user_roles_select_own_row.sql:19`) | `user_id = auth.uid()` | **Correct** — this is a user-scoped, not tenant-scoped, policy. Recursion-safe. |
| `admin_read_all_tenant_settings` | `p2_tenant_settings` (`20260722_admin_read_all_agent_logs.sql:14`) | `auth.uid() = 'fe2b94fb-…'` | `[SECURITY]` **Medium** — hard-coded test-tenant superuser backdoor that can read **every tenant's settings** (including `telegram_chat_id`, bank details, GSTIN). Fine while that account is the developer's, but it is a permanent unaudited cross-tenant read grant living in production. See §6.1. |
| `tenant_own` | `p2_payment_receipts` (`20260828_payment_ledger.sql:22-23`) | `tenant_id = auth.uid()` | `[FIXED]` — dropped and replaced with three `get_my_tenant_id()` policies in `20260901_fix_payment_receipts_rls.sql:30-40`. |

All other policies (`p2_notifications`, `p2_cancelled_challans`, `p2_supplier_advances`, `p2_wip_transactions`, and the 15 `staff_tenant_access` policies) correctly use `get_my_tenant_id()`.

### `[BUG]` `get_my_tenant_id()` is non-deterministic for multi-tenant staff — **Low**

`20260803_staff_rls_fix.sql:22` — `SELECT tenant_id FROM p2_user_roles WHERE user_id = auth.uid() LIMIT 1` with no `ORDER BY`.

- **Consequence:** A user invited into two tenants (a shared accountant, the likeliest case) gets an arbitrary, plan-unstable tenant. Their RLS scope can flip between requests.
- **Fix:** Either add a deterministic `ORDER BY created_at` plus a unique constraint on `(user_id)`, or resolve from the JWT's `user_metadata.tenant_id` first — which is what every client-side path already does.

### `[BUG]` `get_my_tenant_id()` returns NULL for owners with no `p2_tenants` row — **Medium** `[UNVERIFIED]`

`20260803_staff_rls_fix.sql:16-24` requires a `p2_tenants` row keyed on `auth.uid()`, falling back to `p2_user_roles`. `_ai/CLAUDE.md` (Shipped Aug 17) documents that owners who signed up before the Aug 3 trigger fix had no `p2_tenants` row — `onboarding.html`'s `saveCompanyAndPlan()` now upserts one. Any owner still missing that row gets `get_my_tenant_id() = NULL`, which fails every `staff_tenant_access` policy.

- **Fix:** Run `SELECT id FROM p2_tenants` against the three live tenant UUIDs and confirm all three rows exist.

---

# Part 2 — Role and permission system

`js/roles.js` (26 lines) is the whole system:

```
owner:       dashboard grn issue dispatch rm_dispatch dispatch_history products reports invoices scanner settings agent
supervisor:  dashboard grn issue dispatch rm_dispatch dispatch_history products reports invoices scanner       agent
storekeeper: dashboard grn                                                                     scanner
operator:    dashboard     issue dispatch rm_dispatch dispatch_history products reports
accountant:                                                            reports        invoices
staff:       dashboard grn                                                                     scanner   (legacy)
```

`canAccess()` (`js/roles.js:19-22`) defaults an unknown role to `storekeeper` — correct least-privilege behaviour.

## 2.1 Pages with no permission check on load

| Page | Gate present | Assessment |
|---|---|---|
| `index.html` | `checkAuth()` only (`index.html:880-891`) — **no `canAccess(role, 'dashboard')`** | `[BUG]` **Medium** — see §2.4 |
| `challan.html` | `checkAuth()` only (`challan.html:938`) | `[SECURITY]` **Medium** — any role including `accountant` and `storekeeper` can open `challan.html?id=<uuid>`, view the full challan, **enter edit mode, rewrite client name/address/PO/vehicle, and edit the challan note/footer** (`challan.html:667-694`, `challan.html:618-630`). Storekeeper and accountant have no dispatch permission at all. |
| `manual.html` | `checkAuth()` only (`manual.html:813`) | Correct — documentation, all roles. |
| `admin-agent.html` / `admin-backup.html` | `checkAuth()` + hard-coded `user.id !== OWNER_ID` (`admin-agent.html:508`, `admin-backup.html:275`) | Correct for a developer-only tool. `[DEBT]` — a hard-coded UUID in client JS is brittle. |
| `onboarding.html` | `checkAuth()` + `user.id !== OWNER_ID` (`onboarding.html:1657`) | Correct. |
| `accept-invite.html`, `login.html`, `error.html`, `receive.html`, `invoice.html` | none | Correct — public pages. |

Every other page calls `canAccess()` correctly.

- **Fix for `challan.html`:** Add `if (!canAccess(role, 'dispatch_history')) redirect` and gate the Edit Client / Edit Text buttons on `owner`/`supervisor`.

## 2.2 Role gaps

### `[BUG]` accountant has no `dashboard` permission but lands on the dashboard — **Medium**

`js/roles.js:6` — `accountant: ['reports','invoices']`. `login.html:284` and `:296` both redirect to `index.html` unconditionally after sign-in. `index.html` does not call `canAccess()`, so the page renders. The navbar (`js/navbar.js:38-41`) filters `NAV_LINKS` through `canAccess()`, so the accountant sees a navbar with **only Reports and Invoices** while standing on a Dashboard that has no link back to it.

- **Consequence:** Every accountant login lands on a page they officially cannot access, with a nav that denies its existence. If `index.html` is ever "fixed" to enforce `canAccess()`, accountants get an infinite redirect loop (`index.html` → `index.html?denied=1`).
- **Fix:** Add `'dashboard'` to the accountant role in `js/roles.js:6`, then add the `canAccess` gate to `index.html:883`. Do both in the same change or the loop happens.

### `[SECURITY]` operator can download the full GST export — **High**

`export.html:2422-2426` gates on `canAccess(role, 'reports')`. `operator` has `reports`. The Aug 17 bug scan added this gate specifically to stop "storekeeper/operator could download full GST export" (per `_ai/CLAUDE.md`), but chose a bucket the operator already holds. Only storekeeper is actually blocked.

The same applies to `ca-report.html:310` and `reports.html:399`.

Table 12 / Table 13 / 43B(h) / GSTR-1 Workbook inside `export.html` are correctly restricted to `TABLE13_ROLES = ['owner','accountant','supervisor']` (`export.html:2439-2450`). It is the main 17-column Tally/Zoho export, the Purchase Register and the GST Summary sheet (ITC, output tax, net payable) that the operator can pull.

- **Consequence:** A shop-floor operator can export the tenant's complete purchase ledger with supplier GSTINs, rates, invoice numbers and computed tax position.
- **Fix:** Introduce a distinct `ca_export` permission granted to owner/accountant/supervisor and gate `export.html` on it; leave `reports.html`/`ca-report.html` on `reports` if operator visibility there is intended.

### `[SECURITY]` operator can generate tax invoices — **High**

`all-dispatch-history.html` gates the page on `canAccess(role, 'dispatch_history')` (`all-dispatch-history.html:304`) — which operator holds. The "Generate Invoice" affordance inside the Detail modal is gated only on `canInvoice`, which is a **plan** check (`all-dispatch-history.html:316-328`, `plan === 'pro' || 'founder'`), never a role check. Server-side, `verifyCallerTenant` (`supabase/functions/agent-query/index.ts:227-251`) checks tenant identity but **not role**.

Meanwhile `invoices.html` is gated on `canAccess(role, 'invoices')`, which operator does **not** hold.

- **Consequence:** An operator can mint a legally-formatted tax invoice with a sequence number, but cannot open the page that lists invoices. The invoice they create is invisible to them and they cannot correct it. Any authenticated user of the tenant can also do this by POSTing `{action:'confirm_generate_invoice'}` directly to `agent-query`.
- **Fix:** Add a role check to the `confirm_generate_invoice` / `confirm_consolidated_invoice` / `resend_invoice` handlers in `agent-query` (call `get_my_role` and require owner/supervisor/accountant), and gate the button on role as well as plan.

### `[SECURITY]` operator can cancel and amend confirmed challans — **High**

`all-dispatch-history.html:473` renders the row-level **Cancel** button, and `all-dispatch-history.html:562-567` renders **Cancel Challan** and **Amend** in the Detail modal, with **no role condition at all**. Only the "Delete Permanently" button is gated (`all-dispatch-history.html:475`, `:575` — `currentRole === 'owner'`).

Same pattern in `dispatch-history.html:612`, `issue-history.html:610`, `rm-dispatch-history.html` (row Cancel ungated; hard-delete gated at `:619`/`:717`).

`cancel_challan` reverses stock. Its source is not in the repo, so whether it does its own server-side role check is `[UNVERIFIED]` — `hard_delete_dispatch` explicitly does (`20260825_hard_delete_dispatch.sql:68`), which suggests `cancel_challan` does not.

- **Consequence:** An operator can reverse a confirmed dispatch's stock deduction and amend a challan's contents after issue. Both are financial and Rule-56 record-keeping actions.
- **Fix:** Gate Cancel and Amend on `['owner','supervisor']` on all four history pages, and add the same `v_is_owner`-style check inside `cancel_challan`.

### `[UX]` storekeeper cannot see dispatch history — **Low**

`storekeeper: ['dashboard','grn','scanner']`. A storekeeper who receives a delivery via the QR flow on `receive.html` and creates a GRN has no way to see the dispatch history or open a challan for reference. Deliberate least-privilege, but worth confirming with the clients.

### `[UX]` accountant cannot see GRN or dispatch history — **Medium**

The accountant's job is reconciliation, and `gstr2b-reconcile.html` (owner + accountant only, checked directly in `init()`) reconciles GRN rows they cannot inspect. They can read the aggregate export but not the underlying `grn-history.html` (gated on `grn`) or `all-dispatch-history.html` (gated on `dispatch_history`).

- **Fix:** Consider read-only `grn` and `dispatch_history` for accountant, paired with role-gating the write buttons on those pages (which is needed anyway per the two findings above).

### `[DEBT]` `products` permission grants BOM editing to operator — **Medium**

`operator` has `products`. `products.html` gates only on `canAccess(role,'products')` (`products.html:366`) — there is no per-action role check anywhere in the file. An operator can add/edit/deactivate products and edit BOM lines. A BOM change silently changes the stock consumption of every future production issue and product dispatch.

- **Fix:** Gate the BOM editor and product add/edit/deactivate on `['owner','supervisor']`.

## 2.3 UI elements not gated by role

| Element | Location | Visible to | Should be |
|---|---|---|---|
| Cancel Challan (row + Detail modal) | `all-dispatch-history.html:473`, `:562-564`; `dispatch-history.html:612`; `issue-history.html:610`; `rm-dispatch-history.html` | owner, supervisor, operator | owner, supervisor |
| Amend Challan | `all-dispatch-history.html:565-568` | owner, supervisor, operator | owner, supervisor |
| Generate Invoice | `all-dispatch-history.html:632` | owner, supervisor, operator (plan-gated only) | owner, supervisor, accountant |
| **Cancel Invoice** | `invoices.html:930-936` — `currentRole !== 'accountant'` | owner, **supervisor** | owner only |
| Record Payment | `invoices.html:907-908` — `canRecordPayment` (plan only) | owner, supervisor, accountant | probably correct |
| Edit Client / Edit Text on a printed challan | `challan.html:198-204` | **every role** — page has no `canAccess` | owner, supervisor |
| CA/Tally export + GST Summary | `export.html` | owner, supervisor, operator, accountant | owner, supervisor, accountant |
| BOM editor, product add/edit/deactivate | `products.html` | owner, supervisor, operator | owner, supervisor |
| Delete Permanently | `all-dispatch-history.html:475`, `:575` | owner only | `[FIXED]` correct |
| GRN Reconciliation modal | `grn.html:329-331` — `role === 'owner' \|\| 'supervisor'` | correct | `[FIXED]` |
| Stock Adjustment | `settings.html:222`, `:921` — `.owner-only` inside an owner-only page | owner only | `[FIXED]` correct — the audit brief's example does not reproduce |
| WIP Close | `production-issue.html:2032` — `['owner','supervisor']` | correct | `[FIXED]` |

### `[SECURITY]` Cancel Invoice is visible to supervisor and leaves no audit trail — **High**

`invoices.html:855-874` (`cancelInvoice`) flips `p2_invoices.status` to `'cancelled'` on a `confirm()` alone. No reason is captured, no actor, no timestamp, no audit row. Challans got `p2_cancelled_challans` for exactly this reason (Rule 56(7), `20260901_cancelled_challan_log.sql`); invoices did not.

Note also that `'cancelled'` is not in the documented status set (`_ai/CLAUDE.md` says `'draft' | 'sent'`) and there is no `CHECK` constraint on `p2_invoices.status` (`20260730_create_invoices_table.sql:38`) to catch a typo.

- **Consequence:** Any supervisor can cancel a tax invoice with no record of who did it or why. The invoice number stays consumed, so the series shows a "missing" invoice with no explanation to a GST officer.
- **Fix:** Owner-only; add a `p2_cancelled_invoices` audit row (or `cancelled_at`/`cancelled_by`/`cancel_reason` columns) written in the same transaction; add a `CHECK` on `status`.

## 2.4 The accountant role — full reachability audit

| Surface | Reachable? | Correct? |
|---|---|---|
| `index.html` (Dashboard) | **Yes** — page has no gate; nav link hidden | **No** — permission missing (§2.2) |
| `reports.html` | Yes | Yes |
| `ca-report.html` | Yes (`reports`) | Yes |
| `export.html` — Tally/Zoho export | Yes (`reports`) | Yes |
| `export.html` — Table 12/13, 43B(h), GSTR-1 Workbook | Yes (`TABLE13_ROLES`) | Yes |
| `gstr2b-reconcile.html` | Yes (direct owner/accountant check in `init()`) | Yes |
| `invoices.html` — list, Detail, receipts | Yes | Yes |
| `invoices.html` — Record Payment | Yes (plan-gated only) | Yes |
| `invoices.html` — New Consolidated Invoice | **No** — hidden at `invoices.html:583-585` | **Questionable** — an accountant raising consolidated invoices is a normal workflow |
| `invoices.html` — Cancel Invoice | No (`invoices.html:931`) | Yes |
| `invoices.html` — Supplier Advances tab | **Yes** — no role condition anywhere on that tab | Probably intended, but undocumented and unreviewed |
| `all-dispatch-history.html`, `grn-history.html`, `issue-history.html` | **No** | **Gap** — see §2.2 |
| `challan.html` | **Yes** — no gate; can also **edit** the challan | **No** — §2.1 |
| `manual.html` | Yes | Yes |
| Agent FAB | **No** — `canAccess(role,'agent')` false | Yes |
| `settings.html`, `grn.html`, `dispatch.html`, `rm-dispatch.html`, `production-issue.html`, `products.html`, `scanner.html` | No | Yes |

**Beyond the known dashboard gap, three findings:** (1) accountant can open and edit any challan by URL; (2) accountant cannot reach GRN/dispatch history, which reconciliation needs; (3) accountant has unreviewed access to the Supplier Advances write path.

## 2.5 The agent FAB

### `[FIXED]` Correctly gated on every page

`js/agent-chat.js:13-38` resolves its own role independently of the page's `checkAuth()` and returns early unless `canAccess(role, 'agent')` — which is `owner` and `supervisor` only (`js/roles.js:2-3`). It then does a **fresh** `p2_tenant_settings.plan` fetch (`js/agent-chat.js:29-35`), not `getPlan()`/localStorage, and hides for anything other than `pro`/`founder`. The whole block is wrapped so any error returns early (fail-closed). The `window._nexflowAgentChatDone` guard prevents double-render.

`js/agent-chat.js:60` resolves tenant correctly for supervisors, and `getAuthHeader()` (`js/agent-chat.js:70-73`) sends the real session JWT.

Verified `<script src="js/agent-chat.js">` on: `index.html`, `grn.html`, `dispatch.html`, `rm-dispatch.html`, `production-issue.html`, `products.html`, `reports.html`, `export.html`, `invoices.html`, and the history pages. The gate is inside the script, so inclusion is safe everywhere.

---

# Part 3 — Data integrity and financial accuracy

## 3.1 Payment modal — end-to-end audit (`invoices.html`)

### `[UX]` Field order is Gross-first — **High** — *still present*

`invoices.html:407-426`:

| Line | Field |
|---|---|
| 409-410 | **Gross Amount (₹)** — the only required field |
| 413-414 | TDS Deducted (₹) |
| 417-418 | Other Deductions (₹) |
| 423-425 | Net Amount — **read-only display**, `#rpNetAmount` |

- **Consequence:** A job worker sees the **net** figure credited to their bank. This form makes them compute `gross = net + TDS + deductions` in their head before they can type anything. Every arithmetic slip becomes a wrong receivables balance, a wrong 43B(h) figure and a wrong overdue calculation.
- **Fix:** Make Net the typed field and Gross the derived display, or add a "I know the net amount" toggle that reverses the calculation direction.

### `[BUG]` No balance-due display — **High** — *still present*

`invoices.html:388` (`#recordPaymentInvoiceLine`) is populated at `invoices.html:1181-1182` with only `${inv.invoice_number} — ${inv.client_name}`. The invoice total, the amount already received, and the outstanding balance are **never shown**, even though `allInvoices` and `receiptsByInvoice` (populated at `invoices.html:640`) both hold them at that moment.

- **Consequence:** The user records a payment with no idea what is owed. Partial payments are recorded blind.
- **Fix:** Render `Invoice total ₹X · Received ₹Y · **Balance due ₹Z**` into `#recordPaymentInvoiceLine`, and pre-fill Gross/Net with the outstanding balance.

### `[BUG]` No guard against recording more than the invoice total — **High** — *still present*

`invoices.html:1224-1229` is the entire validation:

```
if (!grossAmount || grossAmount <= 0)            → block
if (!paymentDate)                                 → block
if (tdsAmount + otherDeductions >= grossAmount)   → block
```

Nothing compares against `inv.amount_total` or the sum of existing receipts. There is no DB constraint either — `20260828_payment_ledger.sql:2-17` has `CHECK (gross_amount > 0)` and nothing else.

- **Consequence:** ₹5,00,000 can be recorded against a ₹50,000 invoice. `v_p2_invoice_payment_status` then reports `paid`, the 43B(h) report understates receivables, and the overdue notification stops firing. Nothing in the UI flags it.
- **Fix:** Warn (and require an explicit override) when `net_amount > balance_due`; add a trigger-based guard on `p2_payment_receipts` if you want it enforced.

### `[BUG]` 0 of 8 labels have Marathi — **Medium** — *still present*

Every label in `invoices.html:385-443` lacks `data-en`/`data-mr`:

| Line | String |
|---|---|
| 387 | "Record Payment" (title) |
| 393 | Payment Date |
| 397 | Payment Mode |
| 409 | Gross Amount (₹) |
| 413 | TDS Deducted (₹) |
| 417 | Other Deductions (₹) |
| 424 | Net Amount |
| 429 | Reference No |
| 434 | Notes |
| 439 | Save Payment (button) |
| 440 | Cancel (button) |

**0/8 labels, 0/1 title, 0/2 buttons, 0/6 mode options — 0/17 strings total.** The Record Advance Payment modal immediately below it (`invoices.html:460+`) **does** carry `data-en`/`data-mr` on every field, so the pattern was available and simply not applied here. The five validation toasts at `invoices.html:1224-1229` are also English-only, unlike the rest of the file which uses `t(en, mr)`.

- **Consequence:** The single most financially consequential form in the product is English-only for a Marathi-first user base.
- **Fix:** Add `data-en`/`data-mr` to all 17 strings; wrap the five toasts in `t()`.

### `[UX]` Additional payment-modal findings

- **`[UX]` Medium** — `invoices.html:1227-1229`: `tdsAmount + otherDeductions >= grossAmount` blocks a full write-off (`payment_mode: 'adjustment'`, net ₹0), which is a legitimate entry.
- **`[UX]` Medium** — At 390px the three amount inputs are `flex:1` siblings in one row (`invoices.html:407`), giving each ~100px with a two-to-three-line wrapped label above it. `.nx-modal` in this file (`invoices.html:34-40`) sets no `max-height`/`overflow-y`, so a tall modal on a short viewport clips its Save button off-screen — see §5.4.
- **`[DEBT]` Low** — `invoices.html:1252-1264`: recording a payment on a Draft invoice flips `status` to `'sent'`. That invoice then appears in `export.html`'s GST summaries (which filter `status='sent'`) despite never having been sent to the client. Defensible, but the flag now means two different things.
- **`[FIXED]`** Double-submit is guarded (`invoices.html:1231-1233`, `finally` at `:1274-1277`). `net_amount` is correctly omitted from the insert payload (generated column).

## 3.2 Invoice rate fields

### `[COMPLIANCE]` `[BUG]` No warning when a rate is pre-filled from `p2_product_prices` — **Critical**

`all-dispatch-history.html:824-850` pre-fills every line's rate:

- product / bom_issue dispatches → `p2_product_prices.price`, latest by `effective_date` (`all-dispatch-history.html:829-841`)
- raw_material dispatches → `p2_material_prices.price_per_unit`, latest by `effective_date` (`all-dispatch-history.html:842-850`)

The rate then lands in a plain `<input type="number">` at `all-dispatch-history.html:878-880` with **no provenance label, no source badge, no warning banner, and no indication that the value came from a price table rather than being entered for this invoice**.

`_ai/CLAUDE.md` states unambiguously: *"Datta Prasad p2_product_prices has 97 records loaded from KPML SAP PO rates. These are KPML purchase rates, NOT Datta Prasad job work charges. Do not use these for invoice generation until correct rates are loaded."* Those 97 records are exactly what this modal pre-fills.

- **Consequence:** The moment anyone at Datta Prasad clicks Generate Invoice on a KPML dispatch, the modal silently pre-fills KPML's own SAP purchase rates and the default action is to accept them. The result is a tax invoice billing the full product value instead of the SAC-9988 job charge — the precise GSTR-1 filing error `_ai/CLAUDE.md` warns about. This is one click away, today, on a live tenant.
- **Fix:** Show the source next to each pre-filled rate ("from Product Prices, effective 17 Aug 2026") and, when `movement_purpose` is any job-work value, suppress the pre-fill entirely and require manual entry.

### `[BUG]` `[COMPLIANCE]` A blank rate silently becomes ₹0 — **High**

Three independent places turn a missing rate into zero with no error:

1. `all-dispatch-history.html:865` — `rate: key ? (priceById.get(key) ?? '') : ''` — an item with no price row gets a **blank** input (intentional per `_ai/CLAUDE.md`: "blank (not zero) if no price row, since a human is reviewing this one").
2. `all-dispatch-history.html:916` — `rate: Number(input.value) || 0` — that blank (and any non-numeric text) becomes **0** on submit. No validation runs.
3. `supabase/functions/agent-query/index.ts:2238-2241` — the server rejects only `!Number.isFinite(rate) || rate < 0`. **Zero passes.** And `agent-query/index.ts:2363` — `const rate = Number(rateById.get(it.id)) || 0` — an item entirely **absent** from `item_rates` also gets 0, with no check that every dispatch item has a rate.

- **Consequence:** A ₹0 line item on a persisted, publicly-served tax invoice. The invoice PDF, `amount_total`, GSTR-1 Table 12 and the 43B(h) receivables report are all wrong, and nothing warns anyone.
- **Fix:** Block submission client-side when any rate is blank or 0; server-side, require `item_rates.length === items.length`, every `dispatch_item_id` matched, and every rate `> 0` (with an explicit `allow_zero_rate` flag if free replacements are a real case).

### `[UX]` No total preview before generating — **Medium**

The Generate Invoice modal (`all-dispatch-history.html:244-284`) shows Description / Qty / Unit / Rate per line but **no line amount, no subtotal, no GST, no total**. The owner clicks "Generate Invoice" without ever seeing what the invoice is worth. The generated invoice is then immediately opened in a new tab (`all-dispatch-history.html:939`) — after it is already persisted with a consumed sequence number.

- **Fix:** Compute and display subtotal / GST / total live as rates are typed, using the same `buildInvoiceTotals` rounding logic.

### `[COMPLIANCE]` The job-work invoice block is client-side only — **High**

`all-dispatch-history.html:625` disables the Generate Invoice button with a tooltip when `movement_purpose !== 'sale'` — correct per `_ai/CLAUDE.md` ("must be DISABLED (not hidden)"). But `confirmGenerateInvoice` in `agent-query` **selects `movement_purpose` (`index.ts:2246`) and uses it only to derive `doc_category`** via `deriveDocCategory()` (`index.ts:2385`). There is no server-side rejection.

- **Consequence:** A direct POST — or any future caller, or a stale cached page — can raise a tax invoice on a `job_work_return` challan. A wrong job-work invoice is a GSTR-1 filing error on a live KPML relationship.
- **Fix:** In `confirmGenerateInvoice` and `confirmConsolidatedInvoice`, reject with a clear error when `movement_purpose` is not `'sale'` or `'direct_supply_from_jobworker'`.

## 3.3 Double-billing guards

### `[FIXED]` Single-mode duplicate guard works

Two layers:
- **DB:** `CREATE UNIQUE INDEX p2_invoices_dispatch_order_id_idx ON p2_invoices (dispatch_order_id)` (`20260730_create_invoices_table.sql:54-55`). Postgres does not enforce uniqueness across NULLs, so consolidated rows are correctly exempt.
- **App:** `agent-query/index.ts:2276-2285` — `.eq('dispatch_order_id', …).maybeSingle()` → "Invoice already generated for this dispatch".

### `[FIXED]` Cross-mode guards work in both directions

- single → consolidated: `agent-query/index.ts:2291-2311` uses jsonb containment (`.filter('items','cs', …challan_number)`) against consolidated rows (`dispatch_order_id IS NULL`).
- consolidated → single: `agent-query/index.ts:2521-2537` (preview) and `:2665-2683` (confirm) query single-mode invoices by `dispatch_order_id IN (…)`.
- consolidated → consolidated: `20260817_invoice_consolidated_dedup_index.sql` partial unique index, plus the app check at `agent-query/index.ts:2517`.

### `[BUG]` The cross-mode guard is skipped when `challan_number` is NULL — **Medium**

`agent-query/index.ts:2291` — the consolidated check is wrapped in `if (order.challan_number)`. A confirmed dispatch with a NULL challan number bypasses it entirely.

- **Consequence:** Such a dispatch can be billed twice — once inside a consolidated invoice, once as a single.
- **Fix:** When `challan_number` is NULL, fall back to matching `dispatch_order_ids @> [dispatch_order_id]` on consolidated rows (the array is already stored, `20260730_create_invoices_table.sql:36`).

### `[DEBT]` The app-layer duplicate check is a TOCTOU race — **Low**

`agent-query/index.ts:2276-2285` reads, then `:2396-2418` inserts, in two separate statements. Two concurrent clicks both pass the read. The unique index catches the second, but the user sees a raw Postgres error string surfaced through `showInvoiceModalError` (`all-dispatch-history.html:944`) rather than "Invoice already generated". The button *is* disabled during the call (`all-dispatch-history.html:911-912`), so this needs two tabs or two users.

- **Fix:** Map SQLSTATE `23505` on `p2_invoices_dispatch_order_id_idx` to the friendly message.

### `[SECURITY]` No role check on any invoice write handler — **High**

Covered in §2.2. `verifyCallerTenant` (`agent-query/index.ts:227-251`) verifies *which tenant* but never *which role*.

## 3.4 Stock balance accuracy — `v_p2_stock_balance`

`[UNVERIFIED]` — the view definition is in no file in this repo. Everything below is from `_ai/CLAUDE.md`'s description plus the 20 call sites.

### `[COMPLIANCE]` `[BUG]` The view hard-filters `owned_by IS NULL` — **Critical (as a business problem)**

Per `_ai/CLAUDE.md`: *"v_p2_stock_balance already filters owned_by IS NULL in its JOIN condition… The view does NOT expose owned_by as an output column."*

Consumers: `index.html:533`, `check-low-stock/index.ts:368`, `agent-query/index.ts:272`, `js/notifications.js:50`, `dispatch.html:1208` and `:1450`, `rm-dispatch.html:605` and `:1368`, `production-issue.html:958`, `scanner.html`. **Every single stock number the product displays is own-stock-only.**

The real situation is worse than "principal stock is invisible". There is no inbound path that ever sets `owned_by` to non-NULL (§6.5), so KPML's material sitting in all three factories today is recorded as `owned_by = NULL` — i.e. **the app currently reports the principal's material as the tenant's own stock**. The balance is not blank; it is confidently wrong in the legally dangerous direction.

- **Consequence:** Stock valuation in `ca-report.html`, the CA export, low-stock alerts and the dashboard all treat free-issue material as owned inventory. For a Type B job worker that overstates assets and misrepresents the s.143 position.
- **Fix:** This is Step 2's remaining work, not a patch. Minimum viable step: add an `owned_by` pool selector to `grn.html` and expose `owned_by` as a view output column with a pool filter, so at least new receipts are attributed.

### Edge-case analysis

| Case | Handled? |
|---|---|
| **Own vs principal stock** | `[BUG]` No. Hard-filtered, not selectable. |
| **WIP open/close** | `[BUG]` **Medium.** `confirm_bom_issue` writes negative consumption rows to `p2_stock_transactions` *and* a positive `p2_wip_transactions` row (`20260825_wip_state.sql:135-165`). Material correctly leaves stock. But `close_wip` inserts only a negative WIP row — nothing is ever written back to any stock ledger. A closed batch simply vanishes. `v_p2_stock_balance` and `v_p2_wip_balance` are two disconnected ledgers with no reconciliation surface anywhere. |
| **Negative stock** | `[BUG]` **Medium.** Both consumption RPCs do a locked, aggregated, pool-scoped sufficiency check (`20260901_fix_insufficient_stock_message.sql:94-123`, `20260825_wip_state.sql:106-122`) — those cannot go negative. But `settings.html:2453-2470` writes an arbitrary signed `adjustment` row with **no floor check**, and `hard_delete_dispatch` writes reversal `adjustment` rows (`20260825_hard_delete_dispatch.sql:177-191`). A negative balance is reachable and the view will happily return it. Nothing in the UI flags a negative balance as an error. |
| **Stock adjustments** | Correct in principle — `adjustment` rows are signed deltas summed like everything else, and opening stock is `adjustment` + `notes='Opening Stock'`. But `settings.html:2467` writes `owned_by` NULL always (no pool option) and `tenant_id: user.id`. |
| **`is_active`** | `[BUG]` **Medium.** The view has no `is_active` column, so deactivated materials with a `min_stock_level` keep appearing. `check-low-stock/index.ts:367-371` filters only `.not('min_stock_level','is',null)` — **no `is_active` intersection**, unlike `agent-query`'s `buildContext` which does filter. A deactivated material below minimum generates a daily Telegram low-stock alert forever. |
| **History vs balance disagreement** | `[BUG]` **Medium.** `index.html:716-722` fetches material transaction history with **no `owned_by` filter** while the balance above it excludes principal rows. Once `owned_by` is populated, the history and the balance on the same screen will disagree with no explanation. |

## 3.5 GRN duplicate prevention

### `[FIXED]` Double-submit is guarded

`grn.html:636-638` — `if (submitButton.disabled) return; submitButton.disabled = true;`, re-enabled in `finally` (`grn.html:709-711`). The comment correctly explains why: `get_next_grn_number` hands out a fresh valid number on every call rather than erroring, so without the guard a double-click creates two GRNs and double-counts every material.

### `[BUG]` No guard against the same supplier invoice being entered twice — **High**

`invoice_no` is mandatory per row (`grn.html:652`) but there is **no uniqueness check of any kind** on `(tenant_id, supplier_id, invoice_no)` — not in the DB, not in the app. The Month-End Reconciliation modal (`grn.html:781-800`) groups by supplier and shows invoice numbers with a red dash for missing ones, but never flags a duplicate.

- **Consequence:** The same supplier invoice entered on two days double-counts the stock **and** double-claims the ITC. `gstr2b-reconcile.html` groups GRN rows by `(supplier_gstin + normalised invoice_no)` before matching (`_ai/CLAUDE.md`), so it **sums** the duplicates and reports an "Amount Mismatch" against GSTR-2B rather than a duplicate — the operator will most likely conclude the supplier filed wrong.
- **Fix:** On GRN submit, warn (with an override) if `(supplier_id, normalised invoice_no)` already exists for that tenant; add a "duplicate invoice number" bucket to the reconciliation modal.

### `[DEBT]` The receive.html duplicate check is a `LIKE` on free text — **Medium**

`receive.html:448-457` — `.ilike('notes', '%dispatch_token:' + dispatchToken + '%')`.

- **Consequence:** Unindexed full scan of `p2_stock_transactions`; breaks the instant anyone edits a notes field; and it is a check-then-insert with no constraint behind it, so two simultaneous taps still create two GRNs.
- **Fix:** Store `dispatch_token` in a real column on `p2_stock_transactions` with a partial unique index.

## 3.6 Challan sequence — can the current code create gaps or duplicates?

**Yes, routinely.** `getNextChallanNumber()` (`js/utils.js:176-211`) permanently consumes a number the moment it is called, and it is called *before* the write that would use it.

### `[COMPLIANCE]` `[BUG]` dispatch.html burns a challan number on every save — **High**

`dispatch.html:1048` — `const rawChallan = await getNextChallanNumber(...)` sits inside `handleSaveWorkflow()`, which handles **both** `'draft'` and `'confirmed'`. The order-update branch at `dispatch.html:1077-1081` then overwrites the existing draft's `challan_number` with the new one.

Normal user flow → guaranteed gap:
1. Save Draft → number 1001 consumed, order written with 1001.
2. Re-open the draft, add a line, Save Draft again → **1002 consumed**, order updated to 1002. 1001 is gone.
3. Confirm → **1003 consumed**, order updated to 1003. 1002 is gone.

One dispatch, three numbers, two permanent gaps. Every abandoned draft burns one too.

### `[COMPLIANCE]` `[BUG]` Every failed confirm burns a number — **High**

- `rm-dispatch.html:1134` — number drawn, then insert + `confirm_dispatch_transaction`. Any failure (insufficient stock, network) → gap. `saveDraft()` (`rm-dispatch.html:1022`) correctly does **not** draw a number, so RM drafts are clean.
- `production-issue.html:1541` — number drawn at 1541, then `confirm_bom_issue` at 1563. If the RPC raises `DUPLICATE_ISSUE` and the user clicks **Cancel** on the confirm dialog (`production-issue.html:1573-1577`), the function returns with the number already burned. `INSUFFICIENT_STOCK` does the same.

- **Consequence:** Gaps in the delivery-challan series. `export.html`'s Table 13 gap detector (`export.html:1394-1417`) is doing its job correctly and will report them — the tenant then has to explain missing challan numbers to a GST officer with no record of what happened to them. This is the report flagging a defect in the app, not in the tenant's process.
- **Fix:** Draw the challan number **inside** the same transaction that persists the confirmed order (both `confirm_dispatch_transaction` and `confirm_bom_issue` already accept `p_challan_number` and both already have a fallback generator — move the allocation server-side and pass NULL from the client). For drafts, do not allocate at all until confirm. Where a number is unavoidably wasted, log it to a `p2_skipped_challans` audit table so Table 13 can explain the gap.

### `[COMPLIANCE]` `[UNVERIFIED]` Duplicates under concurrency — **High, needs verification**

The live `get_next_challan_number(p_tenant_id, p_type, p_mode)` source is not in the repo. `20260822_challan_next_override.sql:2` documents its logic as `GREATEST(MAX(existing)+1, floor)`.

If that `MAX` is over `p2_dispatch_orders.challan_number` and is read without a row lock, then because the number is written to the table only *after* the RPC returns, **two users confirming within the same window both read the same MAX and receive the same challan number**. Two different challans, one number — worse than a gap.

The stale reference copy at `sql/get_next_challan_number.sql:15-18` uses `UPDATE … RETURNING`, which *is* atomic — but that file is explicitly documented as having the wrong signature and not being what is deployed.

`consume_challan_override()` (`20260822_challan_next_override.sql:35-49`) is correctly serialised with `SELECT … FOR UPDATE` before the clearing `UPDATE`.

- **Fix:** Run `SELECT prosrc FROM pg_proc WHERE proname='get_next_challan_number'` and confirm the counter is either `UPDATE … RETURNING` or a `SELECT … FOR UPDATE` on the settings row. If it is a bare `MAX()`, this is Critical.

## 3.7 Invoice sequence — `get_next_invoice_number`

`20260730_create_invoices_table.sql:61-71`, IST fix applied in `20260901_fix_invoice_number_ist.sql`.

### `[FIXED]` Duplicates are prevented

`SELECT invoice_sequence + 1 INTO v_seq … FOR UPDATE` followed by the `UPDATE` inside one plpgsql body = one transaction, so the row lock spans both statements. Concurrent callers serialise. **No duplicates.**

### `[COMPLIANCE]` `[BUG]` Gaps on any post-allocation failure — **High**

Same structural flaw as challans, one step milder. `agent-query/index.ts:2389-2395` calls the RPC over PostgREST — that commits the sequence bump in its own transaction. The `p2_invoices` insert at `:2396` is a **separate** HTTP request and transaction. Any failure between them (unique-index race, network drop, `client_id` FK violation, Edge Function timeout) leaves the number permanently consumed with no invoice.

Cancelled invoices (§2.3) do the same thing: the number is consumed and the invoice is soft-cancelled, but no cancelled-invoice register exists to explain the hole.

- **Consequence:** Rule 46(b) requires a consecutive serial number series. Gaps with no documented reason are a filing problem.
- **Fix:** Move allocation and insert into one `SECURITY DEFINER` RPC that does both, or log skipped numbers to an audit table.

### `[BUG]` NULL `invoice_sequence` bricks invoicing permanently — **Medium**

`20260730_create_invoices_table.sql:65-70` — if `invoice_sequence` is NULL, `NULL + 1` is NULL; the `UPDATE` writes NULL back; `lpad(NULL,3,'0')` makes the whole concatenation NULL. If **no settings row exists**, the `SELECT` matches nothing, `v_seq` stays NULL, the `UPDATE` affects zero rows, and the function returns NULL. Either way `agent-query/index.ts:2391` reports "Could not generate invoice number" with no diagnostic, and the tenant can never invoice.

Contrast `get_next_challan_number` (`sql/get_next_challan_number.sql:21-27`), which explicitly inserts a settings row when none exists.

- **Fix:** `COALESCE(invoice_sequence, 0) + 1` plus an insert-if-missing branch, mirroring the challan RPC.

### Format check

`INV-YYYYMM-NNN` = 14 characters — within the Rule 46 16-character cap. The counter never resets per month (correct, and `export.html:1367-1373`'s `invoiceSeriesKey()` explicitly accounts for it). Beyond 999 invoices the number becomes 15 characters; still fine.

---

# Part 4 — Edge Functions and server-side logic

Inventory: `agent-query` (2985 lines), `check-low-stock` (576), `confirm-dispatch` (311), `receive-dispatch` (154), `invite-staff` (193), `notify` (143), `telegram-webhook` (102), `invoice-view` (100), `handle-new-user` (84), `get-user-email` (58). Plus `api/invite-staff.js` (190) on Vercel.

`supabase/config.toml` sets `verify_jwt = false` for: `check-low-stock`, `receive-dispatch`, `invoice-view`, `notify`, `telegram-webhook`. Everything else defaults to `verify_jwt = true` — note that Supabase's gateway accepts the **public anon key** as a valid JWT, so `verify_jwt = true` is not an authorisation control on its own.

## 4.1 `[SECURITY]` handle-new-user — unauthenticated privilege escalation into any tenant — **Critical** `[UNVERIFIED: deployment]`

`supabase/functions/handle-new-user/index.ts:30-52`:

```
const payload = await req.json();
const { record } = payload;
if (record && record.id) {
  const userMetadata = record.raw_user_meta_data || {};
  if (userMetadata.tenant_id) {
    await supabaseAdmin.from("p2_user_roles").insert({
      user_id: record.id, tenant_id: userMetadata.tenant_id,
      role: userMetadata.role || "staff", invited_by: userMetadata.invited_by });
```

The function takes a **client-supplied JSON body**, trusts it is an auth webhook, and inserts an arbitrary `(user_id, tenant_id, role)` row using the **service role key**. There is no webhook-secret check, no signature verification, no `tenant_id` ownership check, no role whitelist. `verify_jwt` defaults to true, which the publicly-embedded anon key satisfies.

Attack: POST `{"record":{"id":"<attacker's own auth uid>","raw_user_meta_data":{"tenant_id":"5ab7fb07-2557-42e7-8a8a-5d9fd59048ac","role":"owner"}}}`. `get_my_tenant_id()` (`20260803_staff_rls_fix.sql:22`) then resolves the attacker to S.S. Engineering, and every `staff_tenant_access` policy grants them full read/write. `fetchUserRole` returns `owner`, unlocking `settings.html`.

**This function is redundant.** A DB trigger function `public.handle_new_user()` does the same job correctly and is the documented live path (`20260803_pending_invites_and_role_fixes.sql:44-59`; `supabase/functions/invite-staff/index.ts:83` refers to "the on_auth_user_created trigger").

- **Consequence:** Full cross-tenant takeover of any live client from an unauthenticated internet request, if the function is deployed.
- **Fix:** Run `supabase functions list`. If `handle-new-user` is listed, **delete the deployment today** and then delete the directory. If it is not deployed, delete the directory anyway so it cannot be redeployed by accident.

## 4.2 `[SECURITY]` get-user-email — cross-tenant email disclosure — **High**

`supabase/functions/get-user-email/index.ts:27-36` verifies that the caller is *some* logged-in user, then calls `supabaseAdmin.auth.admin.getUserById(user_id)` for **any** `user_id` in the body. There is no check that the target user belongs to the caller's tenant.

- **Consequence:** Any authenticated Nexflow user can resolve any other user's email address by UUID.
- **Mitigating:** `20260803_pending_invites_and_role_fixes.sql:28-35` added an `email` column to `p2_user_roles` and notes it "lets settings.html read email directly instead of calling get-user-email, which itself calls the broken admin.getUserById()" — the function may be both broken in this region and unused. `[UNVERIFIED]`
- **Fix:** Confirm no caller remains, then delete the deployment. If it must stay, verify the target's `p2_user_roles.tenant_id` equals the caller's resolved tenant first.

Also `supabase/functions/get-user-email/index.ts:23` — `req.headers.get("Authorization")!` non-null assertion throws a TypeError when the header is absent, returned as a 400 with a JS internals message.

## 4.3 `[SECURITY]` check-low-stock — unauthenticated all-tenant fan-out — **High**

`verify_jwt = false` (`supabase/config.toml`) and **zero auth logic in the function**. Anyone who knows the URL can POST to it.

- Default body → sends the morning digest to **every tenant with a `telegram_chat_id`**.
- `{"mode":"gstr2b_nudge"}` → messages every agent-enabled tenant.
- `{"mode":"payment_overdue_digest"}` → messages every tenant with overdue invoices.
- `{"mode":"payment_overdue_notify"}` → **writes rows into `p2_notifications` for every tenant** and fans them out.

- **Consequence:** An unauthenticated attacker can spam every paying client's Telegram at will, flood their notification bells, and exhaust the Telegram rate limit so real alerts stop arriving. No cost to them, high reputational cost to Nexflow.
- **Fix:** Require a shared secret header (`x-nexflow-cron-secret`) compared against an Edge Function secret, and add it to cron jobids 2, 3 and 8.

Same reasoning applies, at lower severity, to `notify` (§4.5) and `telegram-webhook` (§4.7).

## 4.4 `[BUG]` check-low-stock — HTML injection breaks the digest — **Medium**

`supabase/functions/check-low-stock/index.ts:63-70` sends with `parse_mode: 'HTML'`. Company names, material names and client names are interpolated raw at `:449`, `:498`, `:518-521`, `:532`, `:185-188`.

- **Consequence:** A material named `Nut & Bolt <M8>` (entirely plausible in a MIDC factory) produces malformed HTML; Telegram rejects the whole message with a 400 and **the entire morning digest silently does not arrive**. `sendTelegramMessage` logs and returns `false`; nobody sees it.
- **Fix:** Escape `&`, `<`, `>` before interpolation, or drop `parse_mode` entirely (the `notify` function already sends plain text — `notify/index.ts:60`).

## 4.5 The notify pipeline — where it fails silently

Pipeline: `js/notifications.js` insert → fire-and-forget POST → `notify` Edge Function → Telegram → status flip.

### `[BUG]` Six silent-failure points, zero retries — **High**

| # | Location | Failure |
|---|---|---|
| 1 | `js/notifications.js:25` | `if (error \|\| !data) return;` — a failed insert is swallowed entirely. Not even a `console.error`. |
| 2 | `js/notifications.js:31` | `.catch(() => {})` on the notify POST — a network failure leaves the row `'queued'` forever. |
| 3 | `js/notifications.js:13` (call sites `dispatch.html:1170`, `production-issue.html:1615`, `rm-dispatch.html:1229`) | Called **without `await`**. If the user navigates away or the tab closes in the same tick, the POST never leaves the browser. Row stuck at `'queued'`. |
| 4 | `notify/index.ts:112-115` | No `telegram_chat_id` → `status='failed'`, `error_reason='no_telegram_chat_id'`. Nothing surfaces this to the owner. |
| 5 | `notify/index.ts:118-121` | **Quiet hours mark the notification `'failed'` and drop it.** It is never delivered later. |
| 6 | `notify/index.ts:125-137` | One Telegram attempt. Any failure → `status='failed'`. **No retry anywhere in the system.** |

**If Telegram is down:** every notification in that window is marked `'failed'` with the API's description in `error_reason` and is never retried. No sweeper job re-processes `'failed'` or stale `'queued'` rows. The in-app bell (`js/navbar.js:391-419`) reads all rows regardless of `status`, so the notification *is* visible in-app — Telegram delivery is simply lost.

- **Fix:** (a) Quiet hours should **defer**, not fail — introduce a `deferred` status or a `deliver_after` timestamp and have a cron sweep it. (b) Add a retry sweeper (cron, every 15 min: re-POST rows where `status IN ('queued','failed')`, `created_at > now() - 24h`, and `error_reason` is transient, with an attempt counter). (c) At minimum, log the insert error at `js/notifications.js:25`.

### `[SECURITY]` notify is an unauthenticated write endpoint — **Low**

`verify_jwt = false`, no auth. `notify/index.ts:97` limits damage to rows already in `'queued'` state, so the worst case is re-triggering a legitimate message to its own tenant. But the response distinguishes `{skipped:true}` from `{delivered:false, reason:'no_telegram_chat_id'}` (`notify/index.ts:98` vs `:114`), which is a validity oracle for guessed notification UUIDs. Negligible against a v4 UUID space; worth closing with the shared-secret fix from §4.3.

## 4.6 check-low-stock after the Sept 3 fix — remaining issues

| Requirement | Status |
|---|---|
| Insert into `p2_notifications` for low stock | `[FIXED]` — `check-low-stock/index.ts:453-472`, one combined row per tenant per run, capped at 20 items with "…and N more" |
| Send direct Telegram for digest content | `[FIXED]` — `check-low-stock/index.ts:490-536` |
| Respect quiet hours | `[BUG]` **Medium — partial.** Low stock goes through `notify` and *is* quiet-hours-aware. The **digest** (`:536`), `gstr2b_nudge` (`:120`) and `payment_overdue_digest` (`:194`) all call `sendTelegramMessage` directly and **ignore quiet hours entirely**. A tenant with quiet hours 22:00–08:00 still receives the 08:00 digest — which is fine — but any manual or rescheduled invocation ignores their setting. |
| Skip tenants with no `telegram_chat_id` | `[BUG]` **Low — partial.** Correct in the main digest (`:361-364`), `gstr2b_nudge` (`:118`) and `payment_overdue_digest` (`:166`). **Not** in `sendPaymentOverdueNotify` (`:219-238`), which selects only `id` from `p2_tenants` and creates notifications for every tenant. Those all end up `status='failed'`, `error_reason='no_telegram_chat_id'`. Arguably intended (the bell still works) but it fills the notifications table with failed rows. |

### Additional check-low-stock findings

- **`[BUG]` Medium** — `:367-371`: no `is_active` intersection on the stock query, so deactivated materials alert forever (§3.4).
- **`[BUG]` Low** — `:387-390`: "yesterday's GRNs" uses `new Date().toISOString()` (UTC), not IST. Correct at the 02:30 UTC cron time, off by one for any manual invocation before 05:30 IST. `_ai/CLAUDE.md`'s `todayIST()` gotcha applies here and the helper was only added to `agent-query`.
- **`[DEBT]` Low** — no CORS headers and no OPTIONS handler anywhere in this function. Cron-only today, so harmless, but inconsistent with every sibling.
- **`[DEBT]` Low** — `:103-107`, `:151-156`, `:224-229`, `:565-574` return raw `error.message` from Postgres in the response body.
- **`[DEBT]` Medium** — `sendPaymentOverdueDigest` and `sendPaymentOverdueNotify` both loop **every tenant** with a per-tenant query, and `sendPaymentOverdueNotify` adds a per-invoice dedup query on top. This is O(tenants × invoices) round-trips in a 400ms CPU budget. Fine at 5 tenants; it will time out well before the 70-vendor KPML network.

## 4.7 telegram-webhook

### `[SECURITY]` No Telegram secret-token validation — **Medium**

`supabase/functions/telegram-webhook/index.ts:45-57` accepts any POST body shaped like a Telegram Update. Telegram's `setWebhook` supports a `secret_token` parameter delivered as `X-Telegram-Bot-Api-Secret-Token`; it is not checked.

- **Consequence:** Anyone can forge an Update. To actually hijack a tenant's alerts they need a valid `telegram_bind_token` UUID, which is a real barrier — but see below.
- **Fix:** Set `secret_token` on `setWebhook` and compare it in the function.

### `[SECURITY]` Bind tokens never expire — **Medium**

`settings.html` generates `crypto.randomUUID()`, upserts it to `p2_tenant_settings.telegram_bind_token`, and polls for 2 minutes. The token is cleared only on a successful bind (`telegram-webhook/index.ts:83`) or on Disconnect. **There is no server-side expiry and nothing clears it when the 2-minute poll times out.**

- **Consequence:** A stale bind token lives in the DB indefinitely. The `t.me/nexflow_alerts_bot4?start=<uuid>` link is shown on screen — anyone who sees it in a screenshot, a shared screen or a support session can bind their own Telegram chat at any point in the future and receive all of that tenant's stock, dispatch and payment alerts.
- **Fix:** Add `telegram_bind_token_expires_at`, set it to `now() + 10 minutes`, and check it in the webhook. Clear the token client-side when the poll gives up.

## 4.8 invite-staff (Vercel) — ownership-check verification

### `[FIXED]` The cross-tenant invite exploit is correctly and completely closed

`api/invite-staff.js:52-69`:

```
const { data: { user } } = await supabaseAdmin.auth.getUser(token);
if (userError || !user) → 401
if (!tenant_id || !inviter_id || inviter_id !== tenant_id || user.id !== tenant_id) → 403
```

The critical clause is `user.id !== tenant_id` — tied to the identity proven by the token, not to two client-supplied body fields compared against each other. `user.id === tenant_id` is true only for an owner. **Correct and complete.**

### `[SECURITY]` The role whitelist was applied to the wrong file — **Medium**

`_ai/CLAUDE.md` (Shipped Aug 17): *"invite-staff: role field whitelisted against known roles before DB insert."* That whitelist exists at `supabase/functions/invite-staff/index.ts:71-77` and explicitly **excludes `owner`**:

```
const validRoles = Object.keys(ROLE_LABELS).filter((r) => r !== "owner");
if (!validRoles.includes(role)) → 400
```

But `settings.html:2381` posts to **`/api/invite-staff`** — the Vercel function — and `api/invite-staff.js` has **no role validation at all**. `role` flows straight into `generateLink`'s `options.data` (`api/invite-staff.js:94`), into `auth.users.raw_user_meta_data`, and from there into `p2_user_roles` via the `handle_new_user()` trigger (`20260803_pending_invites_and_role_fixes.sql:52`), which only does `COALESCE(…, 'staff')`.

Worse, `settings.html:605` offers **`<option value="owner">Owner (Full access)</option>`** in the invite dropdown — the exact value the (dead) Edge Function refuses.

- **Consequence:** Contained to the inviting owner's own tenant, so not an escalation across tenants. But an owner can mint a second full `owner` — who can then invite more owners, remove staff, and change every setting — and an arbitrary garbage role string silently lands in `p2_user_roles` (or violates its `CHECK` constraint mid-signup, leaving a created auth user with no role row who silently defaults to `storekeeper` via `js/auth.js:19`).
- **Fix:** Port the whitelist from `supabase/functions/invite-staff/index.ts:71-77` into `api/invite-staff.js`, and delete `supabase/functions/invite-staff/` so there is one implementation.

### Other invite-staff findings

- **`[DEBT]` Low** — `api/invite-staff.js:109-112`: a second `if (linkResult.error)` block, unreachable because `:99-107` already returned.
- **`[DEBT]` Low** — `api/invite-staff.js:188`: returns raw `error.message` on any unhandled exception.
- **`[DEBT]` Low** — No rate limiting. An owner (or a stolen owner session) can drive unlimited Resend sends from the Nexflow sending domain.
- **`[FIXED]`** CORS is correctly locked to `https://nexflowautomations.in` (`api/invite-staff.js:3`, `:17`) — the only function in the codebase that does not use `*`.
- **`[FIXED]`** `escapeHtml` applied to `companyName` and `roleLabel` in the email body (`:149-150`). Note the plain-text `subject` at `:168` uses the **unescaped** `companyName` — harmless for a subject line.

## 4.9 confirm-dispatch — dead and broken

### `[DEBT]` `[BUG]` Delete this function — **Medium**

- **Zero callers.** `grep -rn "confirm-dispatch"` across all `.html` and `.js` returns nothing.
- **Unreachable from a browser anyway** — no CORS headers and no OPTIONS handler anywhere in `supabase/functions/confirm-dispatch/index.ts`.
- **Broken if it were called** — `:141-143` selects `product_id, quantity` from `p2_dispatch_items`. The column is **`qty_dispatched`** (`_ai/CLAUDE.md`, and every other consumer). `item.quantity` is `undefined`, so `bomRow.qty_per_unit * item.quantity` is `NaN` at `:180`, `NaN < consumption.qty` is `false`, and the sufficiency check at `:199-226` **passes unconditionally**. It would then write `NaN` consumption rows.
- **Pool-blind** — the stock check at `:200-204` has no `owned_by` filter, so it would consume principal stock.
- Auth itself is correct (`:87-123`, JWT + tenant match) — that part was the Aug 17 fix.

- **Fix:** `supabase functions delete confirm-dispatch` and remove the directory.

## 4.10 Input validation, error handling, service-role necessity, CORS/JWT — summary

| Function | Input validation | Structured errors | Needs service role? | CORS | JWT verified |
|---|---|---|---|---|---|
| `agent-query` | **Good** — `verifyCallerTenant` on every path (`:2876`), rate bounds (`:2238`), required-field checks | Good — `respond({status:'error', error})`. `[DEBT]`: raw Supabase `error.message` leaked at `:2303`, `:2337`, `:2354`, `:2392`, `:2425` | Yes — cross-tenant `confirm_receive_grn`, Anthropic calls, `get_next_invoice_number` grant | `*` | Yes, manually |
| `check-low-stock` | `[BUG]` **None** — `mode` unvalidated, no auth at all | Partial — raw `error.message` in 500s | Yes (all-tenant) | **None** | **No** — §4.3 |
| `notify` | Good — UUID regex (`:82`) | Good — always 200 with a reason | Yes | Yes | No (by design) |
| `telegram-webhook` | Good — UUID regex (`:60`), shape checks (`:55`) | Always 200 (correct for Telegram) | Yes | Yes | No — needs `secret_token`, §4.7 |
| `receive-dispatch` | **Good** — UUID regex (`:33`), `status !== 'confirmed'` → 404 (`:50`) | Good — `not_found`/`server_error`, never leaks | Yes — public token lookup | Yes | No (by design) |
| `invoice-view` | **Good** — UUID regex (`:39`); strips `tenant_id` and `created_at` from the response (`:79`) | Good | Yes | Yes | No (by design) |
| `invite-staff` (Edge) | Good — email regex, role whitelist | Good | Yes | `*` | Yes |
| `confirm-dispatch` | Partial | Partial | Would be **No** — a user JWT + RLS would suffice | **None** | Yes |
| `get-user-email` | `[SECURITY]` **No tenant scoping** (`:33`); `!` assertion (`:23`) | Poor — raw `error.message`, always 400 | **No** — `p2_user_roles.email` exists since Aug 3 | Yes | Yes (identity only) |
| `handle-new-user` | `[SECURITY]` **None** — trusts the body entirely | Poor | **No** — the DB trigger already does this | Yes | Effectively no (anon key passes) |

---

# Part 5 — Frontend code quality and consistency

## 5.1 console.log in production

Only **two** `console.log` statements exist in client-side code — this area is in good shape.

| Location | Statement | Verdict |
|---|---|---|
| `js/auth.js:15` | `console.log('fetchUserRole: get_my_role result', { data, error })` | `[DEBT]` **Low** — fires on every page load for every non-owner user, printing their resolved role and any RPC error. Remove before a client demo. |
| `settings.html:3372` | `console.log('settings.html plan check:', tenantPlan)` | `[DEBT]` **Low** — remove. |

`api/invite-staff.js:127`, `:175`, `:180`, `:187` are server-side Vercel logs — keep.

`console.error` / `console.warn` counts are high (`settings.html` 35, `invoices.html` / `grn.html` / `dispatch.html` 10 each, and so on) but all are legitimate error paths, most paired with a user-facing `toast()`. Not flagged.

## 5.2 Dead code

### `[BUG]` manual.html documents 7 deleted agent intents — **High**

`_ai/CLAUDE.md` records that the Aug 31 agent redesign deleted all 7 write intents. The user manual still teaches all of them, in both languages:

| Line | Command taught | Intent |
|---|---|---|
| 414 | `"Challan 4325 KPML la pathav"` | `send_challan` — **deleted** |
| 415 | `"CA la July cha export pathav"` | `send_tally_export` — **deleted** |
| 416 | `"KPML la invoice pathav"` | `send_invoice` — **deleted** |
| 427 | `"copper aala 50 kg"` | `create_grn` — **deleted** |
| 428 | `"KS4 motor 5 issue karo"` | `create_production_issue` — **deleted** |
| 429 | `"Panel 5 dispatch karo"` | `create_product_dispatch` — **deleted** |
| 430 | `"MS Sheet 50 kg dispatch karo"` | `create_rm_dispatch` — **deleted** |
| 562 | Settings/Agent tab prose referencing `send_tally_export` | **deleted** |

(The known-issues list said "three references to send_challan". The real count is 7 dead commands plus one prose reference.)

- **Consequence:** A live client reads the manual, types "copper aala 50 kg", and the agent returns `unknown intent` — burning one of their 30 daily interactions. The manual is the artefact clients are pointed at when they need help.
- **Fix:** Delete rows 414-416 and 427-430; rewrite line 562; add one line stating the Copilot is read-only.

### `[DEBT]` js/lang.js is entirely dead — **Low**

`js/lang.js` (32 lines) is referenced by **no HTML file** (`grep -rn "lang.js" *.html` → zero hits). Every page defines its own local `applyLang()` instead (`challan.html:924`, `index.html:824`, `invoices.html:511`, `dispatch-history.html:284`, `grn.html:304`, `manual.html:732`, `production-issue.html:714`, `settings.html`, and so on). `js/navbar.js:298`/`:319` calls `window.applyLang` with a fallback inline implementation.

It would also fail if loaded: `js/lang.js:3` uses `export function`, which is a syntax error in a classic `<script>` tag, and `js/lang.js:25` calls `langToggle.addEventListener` with no null check.

- **Fix:** Delete the file, or make it the real shared implementation and remove the eight per-page copies.

### `[DEBT]` Other dead code

- `supabase/functions/confirm-dispatch/` — zero callers, broken (§4.9).
- `supabase/functions/handle-new-user/` — superseded by the DB trigger, dangerous (§4.1).
- `supabase/functions/invite-staff/` — superseded by `api/invite-staff.js`; the two have diverged (§4.8).
- `supabase/functions/get-user-email/` — probably superseded by `p2_user_roles.email` (§4.2). `[UNVERIFIED]`
- `sql/get_next_challan_number.sql` — documented as stale with the wrong signature. Actively misleading; it is the only visible source for a function that generates GST-relevant numbers.
- `supabase/migrations/20260527_dispatch_tables.sql` — `_ai/CLAUDE.md` marks it STALE.
- `supabase/migrations/20260807_confirm_bom_issue_stock_check.sql` (v1) and `20260825_confirm_bom_issue_pool_aware.sql` — superseded by `20260825_confirm_bom_issue_2h_pool_consumption.sql` and then `20260825_wip_state.sql`. Four overlapping versions of `confirm_bom_issue` in the migrations folder, with the overload hazard documented at `20260825_wip_state.sql:8-13`.
- `js/notifications.js:10` and `:37` — comments referencing the deleted `check-low-stock-instant` (harmless, noted in `_ai/CLAUDE.md`).
- `api/invite-staff.js:109-112` — unreachable branch.

## 5.3 Inconsistent patterns

| Concern | Variants | Impact |
|---|---|---|
| **Language toggle** | 8+ per-page `applyLang()` copies + a dead `js/lang.js` + an inline fallback in `js/navbar.js:319-327` | `[DEBT]` **Medium** — a page that forgets `window.applyLang = applyLang` silently gets the navbar's cruder fallback (which does not handle `<option>` or `title` attributes) |
| **Dynamic-content translation** | `t(en, mr)` helper (`production-issue.html` 84 uses, `rm-dispatch.html` 53, `dispatch-history.html` 44, `issue-history.html` 43) vs inline `lang === 'mr' ? … : …` ternaries (`grn.html`, `products.html`, `index.html`) vs nothing at all (`all-dispatch-history.html`, `export.html`) | `[DEBT]` **Medium** |
| **Modal CSS** | `.nx-modal` is **not** in `css/nexflow-design.css` (only the entrance animation is, at `:719-735`). Each page re-declares it: `invoices.html:27-40`, `all-dispatch-history.html:21-31`, `settings.html:105-120` (as `.nx-modal-lg`, the only one with `max-height`), plus fully inline styles in `challan.html:952`, `grn.html:261` | `[DEBT]` **High** — this is exactly how the `max-height` bug in §5.4 happened: two of the copies have it, most do not |
| **User feedback** | `toast()` from `js/utils.js` (most pages) vs `alert()` (`dispatch.html:1041`, `invoices.html:872`, `production-issue.html` duplicate-issue confirm) vs `showStatus()` (`settings.html`) vs `showError()`/`#successMessage` banners (`dispatch.html`, `rm-dispatch.html`) vs inline `#…Error` divs (`all-dispatch-history.html:891`) | `[DEBT]` **Medium** — five feedback idioms; `alert()` is not translated and blocks the page |
| **Supabase client** | `window.supabase` (most) vs a local `supabaseClient` const (`products.html`) vs the bare global `supabaseClient` (`js/supabase-client.js:4`) | `[DEBT]` **Low** |
| **Date formatting** | `toISOString().split('T')[0]` (UTC, ~15 sites) vs `toLocaleDateString('en-IN')` vs `fmtDDMMYYYY()` (`export.html`) vs `todayIST()` (agent-query only) | `[BUG]` **Medium** — the UTC/IST split is the same class of bug the Sept 2 `todayIST()` fix closed in `agent-query`; the browser is usually in IST so it mostly works, and fails for anyone travelling or with a mis-set device clock |
| **Tenant resolution** | The correct pattern (55 sites) vs raw `user.id` (§1.1) | `[BUG]` see §1.1 |
| **Plan gating** | Fresh `p2_tenant_settings` fetch (`invoices.html:594`, `all-dispatch-history.html:316`, `js/agent-chat.js:29`, `challan.html:527`) vs `isPro()`/localStorage (`settings.html:2370`) | `[BUG]` **Low** — `settings.html:2370`'s `isPro()` guard on staff invites reads a possibly-stale localStorage value, the exact hazard `_ai/CLAUDE.md` warns about |

## 5.4 Mobile responsiveness at 390px

The shared stylesheet handles the common cases well: `.nx-table-wrap { overflow-x: auto }` (`css/nexflow-design.css:500-503`), `.nx-table { min-width: 420px }` at ≤480px (`:861`) and `380px` at ≤380px (`:902`), `.nx-btn { min-height: 44px }` at ≤480px (`:866`), full-width toasts (`:891-893`), and a full-width notification panel below 480px (`js/navbar.js:190`). The findings below are what falls outside it.

### `[UX]` `[BUG]` Tall modals clip their action buttons off-screen — **High**

`.nx-modal` sets no `max-height` and no `overflow-y` in `invoices.html:34-40`, `all-dispatch-history.html:26-31`, or any of the history pages. The overlay is `position: fixed; inset: 0; display: flex; align-items: center`, so a modal taller than the viewport is **vertically centred with both ends clipped and no scroll**.

Only two modals in the codebase are safe: `grn.html:261` (`max-height:85vh; overflow-y:auto`) and `settings.html:117` (`max-height: 90vh`).

Affected, worst first:
1. **Generate Invoice modal** (`all-dispatch-history.html:244-284`) — the items table grows one row per line item. A 6+ item dispatch pushes the "Generate Invoice" / "Cancel" buttons at `:281-282` below the fold. **The user physically cannot submit.**
2. **Record Payment modal** (`invoices.html:385-443`) — ~490px of content. Fits portrait on a 390×844 phone; clips in landscape and on smaller phones.
3. **New Consolidated Invoice preview** (`invoices.html`) — same variable-height problem.
4. **Hard Delete modal** (`all-dispatch-history.html:229-238`) and **Amend modal** (`:223`).

- **Fix:** One line in the shared stylesheet: `.nx-modal { max-height: 90vh; overflow-y: auto; }`, then delete the six per-page copies.

### `[UX]` Three amount inputs in one row — **Medium**

`invoices.html:407` — Gross / TDS / Other Deductions as `flex:1` siblings. At 390px minus 20px overlay padding minus 28px×2 modal padding minus 2×12px gaps ≈ **100px per field**, with a 2-3 line wrapped label above each. The same pattern is at `invoices.html:390` (Date + Mode) and in the Record Advance modal.

- **Fix:** `flex-wrap: wrap` with `min-width: 140px` on each group, or stack below 480px.

### `[UX]` onboarding.html preview tables crush — **Medium**

`onboarding.html:439`, `:487`, `:539`, `:603` are `<table class="ob-preview-table">` with **no `.nx-table-wrap`** and `width: 100%` with no `min-width` (`onboarding.html:151`). Unlike `.nx-table`, these compress instead of scrolling. A 5-6 column material-import preview at 390px is unreadable, and `body { overflow-x: hidden }` (`css/nexflow-design.css:76`) means anything that does overflow is silently clipped rather than scrollable.

- **Fix:** Wrap each in `.nx-table-wrap` and give `.ob-preview-table` a `min-width`.

### `[UX]` challan.html is not usable at 390px — **Medium, arguably by design**

`challan.html:237` (`.ch-outer`) and its items table (`:289`) have no `.nx-table-wrap`; the layout targets A4. `checkMobileDevice()` and `handlePrint()` (`challan.html:724-728`) detect mobile and swap the Print button for a "use a desktop" message, so the mobile case was thought about — but the challan itself still renders squeezed rather than scrollable.

- **Fix:** Wrap `.ch-outer` in a horizontal-scroll container with a fixed `min-width: 700px` for screen media only, leaving print unchanged.

### `[UX]` invoices.html nested receipts table — **Low**

`invoices.html:710` renders a 5-column receipts table inside a `<td colspan="8">` of the main table. Base CSS gives it `min-width: 420px` at ≤480px, widening the parent row and forcing horizontal scroll on the whole table to read a receipt breakdown.

- **Fix:** Render receipts as stacked key/value rows below 480px.

### `[UX]` Untappable targets — **Low**

- `all-dispatch-history.html:878-880` — the rate input is a fixed `width:100px` in a 4-column table inside an already-cramped modal.
- `settings.html:934-936` — the `−` / `+` adjustment-sign buttons (`.adj-sign-btn`) have no explicit minimum size and are not covered by the `.nx-btn` 44px rule.
- `css/nexflow-design.css:862` — `.nx-table th { font-size: 9px }` at ≤480px is below the practical legibility floor for a factory-floor phone in daylight.

### `[BUG]` CSS syntax error kills `.amend-badge` — **Low**

`all-dispatch-history.html:24-25` — an `.amend-badge{…}` rule has been pasted **inside** the `.nx-modal-overlay` declaration block, and the block's own `padding: 20px` now trails after it on the same line:

```
.nx-modal-overlay {
    position: fixed; inset: 0; background: rgba(0,0,0,0.65);
    z-index: 500; display: flex; align-items: center; justify-content: center;
/* amend-badge */
.amend-badge{display:inline-block;…;margin-left:6px;} padding: 20px;
}
```

The parser consumes `.amend-badge{…}` as one invalid declaration and discards it. **`.amend-badge` is never defined**, so the amber "Amended" badge renders as unstyled text.

- **Fix:** Move the `.amend-badge` rule outside the block.

## 5.5 Language toggle coverage

Method: counted `data-en=` attributes and `t(` helper calls per file; then, for the highest-value pages, counted translated vs total `<label>`, `<button>` and `<th>` elements.

### Pages with zero translation

| Page | Verdict |
|---|---|
| `export.html` | **Deliberate** per `_ai/CLAUDE.md` — CA-facing column names stay English |
| `gstr2b-reconcile.html` | **Deliberate** — same precedent |
| `ca-report.html` | Probably fine — CA-facing |
| `invoice.html` | Probably fine — a legal document |
| **`all-dispatch-history.html`** | **`[UX]` High** — hosts the Generate Invoice flow |
| **`login.html`** | **`[UX]` Medium** — the first screen every user sees |
| **`onboarding.html`** | **`[UX]` Medium** — the entire setup wizard |
| **`accept-invite.html`** | **`[UX]` Medium** — the staff member's first screen |
| **`receive.html`** | **`[UX]` Medium** — used by a storekeeper at a factory gate on a phone |
| `admin-agent.html`, `admin-backup.html` | Fine — developer tools |

### Per-page counts, ranked by financial consequence

| Rank | Surface | Labels | Buttons | Table headers | `t()` calls | Assessment |
|---|---|---|---|---|---|---|
| **1** | **Payment modal** (`invoices.html:385-443`) | **0/8** | **0/2** | n/a | 0 | **`[UX]` High** — plus title and 6 mode options untranslated, plus 5 English-only validation toasts. **0/17 strings.** |
| **2** | **Generate Invoice modal** (`all-dispatch-history.html:244-284`) | 0/10 (page-wide) | 0/23 (page-wide) | 0/14 | 0 | **`[UX]` High** — rate entry, GST-type selector and the e-invoicing warning banner are all English-only |
| 3 | `invoices.html` overall | 5/21 | 8/18 | 11/29 | 12 | `[UX]` **Medium** — 16 labels, 10 buttons, 18 headers missing |
| 4 | `dispatch.html` | 9/13 | 5/18 | 9/14 | 0 | `[UX]` **Medium** — 13 buttons untranslated on a core daily page; no `t()` helper at all, so all rendered rows are English |
| 5 | `grn.html` | **7/7** | 4/7 | 12/14 | 0 | `[UX]` **Low** — labels complete; no `t()` for dynamic rows |
| 6 | `settings.html` | 43/47 | 42/51 | 46/55 | 7 | `[UX]` **Low** — best-covered page |
| — | `export.html` | 0/6 | 0/12 | 0/41 | 0 | Deliberate |

Pages with good dynamic coverage via `t()`: `production-issue.html` (84 calls), `rm-dispatch.html` (53), `dispatch-history.html` (44), `rm-dispatch-history.html` (44), `issue-history.html` (43), `scanner.html` (20), `grn-history.html` (13), `invoices.html` (12).

## 5.6 Loading states and double-submit risk

### `[FIXED]` Guarded write paths

`grn.html:636-638` (GRN submit), `dispatch.html:980-984` (both draft and confirm), `rm-dispatch.html:1028` / `:1128`, `production-issue.html` (confirm issue), `invoices.html:1231-1233` (record payment) and `:1160-1171` (consolidated), `all-dispatch-history.html:911-912` (generate invoice), `products.html:796-797` (add product), `accept-invite.html` (password form), Cancel Challan across the four history pages, `onboarding.html` import guards.

### `[BUG]` Unguarded write paths

| Location | Operation | Risk |
|---|---|---|
| `settings.html:2453-2480` | **Stock adjustment insert** | **Medium** — no `disabled` flag, no loading state. A double-tap on a slow connection writes the adjustment twice, silently doubling the correction. This is a direct stock-quantity write with no idempotency and no downstream check. |
| `settings.html` — 27 write calls, 10 `disabled` guards | supplier add, client add/edit/delete, price inserts, sequence updates | **Medium** — most are idempotent updates, but the price inserts (`:3010`, `:3036`) append a history row each time, so a double-tap creates two identical price records on the same `effective_date` and the "latest by effective_date" resolution becomes order-dependent |
| `products.html:843-864` | Edit-product save | **Low** — idempotent update |
| `products.html:902-915` | Deactivate product | **Low** — idempotent |
| `challan.html:988` | Save client info | **Low** — has a `disabled` guard at `:660`, but the two autofill upserts at `:700`/`:706` are fire-and-forget |
| `index.html:439-443` | Min-stock inline edit | **Low** — the input is disabled at `:437` |

### `[UX]` Missing loading indicators

`all-dispatch-history.html:829-850` — the two price-table fetches during Generate Invoice show nothing; on a slow connection the rate column simply appears blank and the user starts typing over values that are about to be overwritten by the arriving pre-fill (the staleness guard at `:854` protects against the *wrong order's* data, not against this).

`invoices.html:640` — `loadReceiptsForInvoices()` runs after `loadInvoices()` with no indicator; payment-status badges pop in after the table has already rendered.

## 5.7 Error states — queries with no error handling

Counted destructures of the form `const { data: x } = await …` (no `error`), excluding `auth.getUser()`/`getSession()`:

| File | Count | Notable |
|---|---|---|
| `dispatch.html` | 5 | `:1000` BOM, `:1009` stock, `:1018` material name, `:1207` stock balance, `:1315` PO numbers |
| `all-dispatch-history.html` | 5 | `:316` settings/plan, `:600` existing invoice, `:829`/`:842` price tables |
| `settings.html` | 5 | |
| `onboarding.html` | 4 | |
| `production-issue.html`, `index.html`, `ca-report.html` | 3 each | |
| `js/supabase-client.js` | 2 | `:30` settings (plan), `:45` tenants (is_demo) |
| 9 other files | 1 each | |

### `[BUG]` The dangerous ones

**`dispatch.html:1000-1017` — the pre-confirm stock check fails open.** Three unchecked queries in a row:

```
const { data: bomList } = await …p2_product_bom…        // no error check
const { data: txData }  = await …p2_stock_transactions… // no error check
const { data: matData } = await …p2_raw_materials…      // no error check
```

If the BOM fetch fails, `bomList` is null, the inner loop never runs, `insufficientItems` stays empty, and **the dispatch proceeds as if stock were sufficient**. If the stock fetch fails, `currentStock` computes as 0 and the user gets a false "Stock not sufficient" `alert()` (`dispatch.html:1041`) with no indication it was a network error. The server-side check in `confirm_dispatch_transaction` is the real backstop, so this is a bad-UX/false-signal bug rather than a stock-corruption one — but the user is shown a confident wrong answer either way.

**`rm-dispatch.html:1057-1060` and `:1173-1176` — unchecked `.delete()`.** The delete-then-reinsert of `p2_dispatch_items` never destructures a result. A failed delete followed by a successful insert **duplicates every line item on the challan** — visible on the printed challan, in the invoice line items, and in the consumption math.

**`all-dispatch-history.html:829-850` — unchecked price fetches.** A failure yields blank rates, which `:916` converts to ₹0 (§3.2).

**`js/supabase-client.js:30-38` — unchecked settings fetch.** Any failure defaults `plan` to `'founder'`, granting Pro features to a Lite tenant.

`index.html:533-535` (dashboard stock) and `:715-724` (material history) *do* check `error`. Not flagged.

- **Fix:** Destructure and check `error` on all of the above; at minimum add a `toast()` so a network failure is visible.

---

# Part 6 — Schema and migration audit

51 migration files. The **initial schema is not in the repo** — 13 core tables have no `CREATE TABLE` anywhere in `supabase/migrations/`. Everything below about those tables is `[UNVERIFIED]` unless a later migration touches it.

## 6.1 RLS completeness

### `[SECURITY]` `[BUG]` RLS is NOT ENABLED on `p2_stock_transactions` — **Critical**

This is stated as fact in the project's own most recent migration, `supabase/migrations/20260902_create_supplier_advances.sql:44-49`:

> *"Confirmed live: p2_stock_transactions has a CREATE POLICY ("staff_tenant_access", 20260803_staff_rls_fix.sql) but RLS was never actually enabled on that table (no ENABLE ROW LEVEL SECURITY was ever run for it), so the policy was silently inert and every tenant's GRN rows were readable through this view."*

The Sept 2 fix worked around the symptom **inside one view** by adding explicit `get_my_tenant_id()` filters. **The table itself was never fixed.**

`p2_stock_transactions` is the complete financial ledger: every GRN with quantity, `rate`, `supplier_id`, `supplier_name`, `invoice_no`, `purchase_type`, `grn_no`, plus every consumption and adjustment row.

- **Consequence:** Any authenticated user of any tenant — including a demo account, a storekeeper, or anyone who signs up (`enable_signup = true` in `supabase/config.toml`) — can read and write every other tenant's complete purchase and consumption history with the public anon key. That is S.S. Engineering's, Datta Prasad's and Shivprasad's supplier lists, purchase rates and volumes, mutually exposed, and exposed to any new signup. It also means every §1.2 "missing `.eq('tenant_id')`" finding is a live cross-tenant query, not a theoretical one.
- **Fix (today, one statement):** `ALTER TABLE p2_stock_transactions ENABLE ROW LEVEL SECURITY;` — the `staff_tenant_access` policy already exists and covers all commands. Verify the three live tenants can still read their own rows immediately afterwards.

### `[SECURITY]` 13 tables received a policy but no `ENABLE ROW LEVEL SECURITY` — **Critical** `[UNVERIFIED]`

`20260803_staff_rls_fix.sql:29-87` creates `staff_tenant_access` on 15 tables. It never runs `ENABLE ROW LEVEL SECURITY` on any of them. Nine tables get an explicit `ENABLE` elsewhere in the migrations; these do not:

| Table | `ENABLE` in migrations? | Policy? |
|---|---|---|
| `p2_stock_transactions` | **No** — confirmed disabled live | Yes |
| `p2_agent_logs` | **No** | Yes |
| `p2_client_po_numbers` | **No** | Yes |
| `p2_clients` | **No** | Yes |
| `p2_material_prices` | **No** | Yes |
| `p2_product_bom` | **No** | Yes |
| `p2_product_prices` | **No** | Yes |
| `p2_products` | **No** | Yes |
| `p2_raw_materials` | **No** | Yes |
| `p2_suppliers` | **No** | Yes |
| `p2_tenant_settings` | **No** | Yes (+ the admin backdoor) |
| `p2_tenants` | **No** | **No policy at all** |
| `p2_user_roles` | **No** | SELECT-own + DELETE only |

Some of these may have had RLS enabled at table-creation time via the Supabase dashboard (that DDL is not in the repo). But `p2_stock_transactions` was in the same migration and is confirmed disabled, so the null hypothesis is that **none of the 15 were enabled**.

`p2_tenant_settings` is the highest-value of the remainder: it holds `telegram_chat_id`, `telegram_bind_token`, `gstin`, `bank_name`, `bank_account`, `bank_ifsc`, `ca_email`, `plan`, and the challan/invoice sequences.

- **Fix — run this first, before anything else in this report:**
  ```sql
  SELECT c.relname, c.relrowsecurity, c.relforcerowsecurity
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND c.relname LIKE 'p2_%' AND c.relkind = 'r'
  ORDER BY c.relrowsecurity, c.relname;
  ```
  Enable RLS on every row where `relrowsecurity = false`. Then re-test each live tenant.

### `[SECURITY]` `[BUG]` Three views bypass RLS entirely — **Critical**

Postgres views run underlying-table access checks with the **view owner's** privileges unless `security_invoker = true`. On Supabase the owner is `postgres`. Supabase's default privileges also `GRANT SELECT` on new public views to `anon` and `authenticated`.

| View | `security_invoker`? | Internal tenant filter? | Verdict |
|---|---|---|---|
| `v_p2_invoice_payment_status` (`20260828_payment_ledger.sql:32-57`, rebuilt `20260901_payment_status_invoice_date.sql:14-39`) | **No** | **No** | `[SECURITY]` **Critical** |
| `v_p2_wip_balance` (`20260825_wip_state.sql:46-50`) | **No** | **No** | `[SECURITY]` **High** |
| `v_p2_stock_balance` | unknown — not in repo | unknown | `[UNVERIFIED]` **Critical if the same** |
| `v_p2_supplier_advance_balance` (`20260902_create_supplier_advances.sql:50-82`) | **Yes** | **Yes, in all 4 subqueries** | `[FIXED]` — see §6.6 |

`v_p2_invoice_payment_status` exposes, for **every tenant in the database**: `invoice_number`, `client_name`, `amount_total`, `invoice_date`, `total_received`, `balance_due`, `payment_status`. Its own migration says it is "read server-side only", but that is a convention, not a control — any browser holding the public anon key and a valid session can run `supabase.from('v_p2_invoice_payment_status').select('*')`.

This is exactly the class of bug the Sept 2 supplier-advance audit found and fixed **in one view only**. The two siblings created the same way were not revisited.

- **Consequence:** Complete cross-tenant disclosure of every client's revenue, customer list and receivables position.
- **Fix:** `DROP` and recreate both views `WITH (security_invoker = true)` **and** add explicit `WHERE tenant_id = get_my_tenant_id()` — the supplier-advance migration's own comment (`:42-49`) documents that `security_invoker` alone was insufficient here. Then check `v_p2_stock_balance` the same way: `SELECT definition, reloptions FROM pg_views v JOIN pg_class c ON c.relname = v.viewname WHERE viewname LIKE 'v_p2_%'`.

### RLS command coverage on tables that do have RLS enabled

DELETE is intentionally absent on financial tables and is **not** flagged below, per the brief.

| Table | RLS | SELECT | INSERT | UPDATE | Notes |
|---|---|---|---|---|---|
| `p2_dispatch_orders` | ✅ `20260527:48` | ✅ | ✅ | ✅ | Plus `staff_tenant_access` FOR ALL |
| `p2_dispatch_items` | ✅ `20260527:49` | ✅ | ✅ | ✅ | Plus DELETE (`:84`) and `staff_tenant_access` |
| `p2_invoices` | ✅ `20260730:42` | ✅ | ✅ | ✅ | `tenant_own` (auth.uid) + `staff_tenant_access` (get_my_tenant_id) |
| `p2_pending_invites` | ✅ `20260803:73` | ✅ | ✅ | ✅ | |
| `p2_wip_transactions` | ✅ `20260825:35` | ✅ | ✅ | ✅ | Single FOR ALL |
| `p2_payment_receipts` | ✅ `20260828:20` | ✅ | ✅ | ✅ | `[FIXED]` via `20260901_fix_payment_receipts_rls.sql` |
| `p2_notifications` | ✅ `20260831:27` | ✅ | ✅ | ✅ | Model implementation |
| `p2_cancelled_challans` | ✅ `20260901:14` | ✅ | ✅ | — | UPDATE intentionally absent (immutable audit) |
| `p2_supplier_advances` | ✅ `20260902:16` | ✅ | ✅ | ✅ | |
| **`p2_tenants`** | **`[SECURITY]` no ENABLE, no policy at all** | — | — | — | **High** — `get_my_tenant_id()` reads it (`20260803:18`), `js/supabase-client.js:45` reads `is_demo`, `check-low-stock` enumerates it |

### `[SECURITY]` Hard-coded admin backdoor policy — **Medium**

`20260722_admin_read_all_agent_logs.sql:12-14` — `CREATE POLICY "admin_read_all_tenant_settings" ON p2_tenant_settings … USING (auth.uid() = 'fe2b94fb-9668-405f-9c62-5f54b32f8c7a')`. That UUID is the test tenant, i.e. the developer's own account. It grants unrestricted read of every tenant's settings including bank details and Telegram chat IDs.

- **Consequence:** A permanent, unlogged cross-tenant read grant tied to a single credential. If that account is ever compromised or the UUID is ever reused, every client's banking and messaging config is exposed.
- **Fix:** Acceptable as a deliberate operator tool, but scope it to the columns `admin-agent.html` actually needs, and document it in `_ai/CLAUDE.md`.

## 6.2 Foreign key integrity

### Columns referencing another table with no FK constraint

| Column | Should reference | Evidence | Severity |
|---|---|---|---|
| `p2_invoices.tenant_id` | `p2_tenants(id)` | `20260730_create_invoices_table.sql:21` — `tenant_id uuid NOT NULL` with no `REFERENCES` | `[DEBT]` **Medium** |
| `p2_pending_invites.tenant_id` | `p2_tenants(id)` | `20260803_pending_invites_and_role_fixes.sql:65` | `[DEBT]` **Low** |
| `p2_pending_invites.invited_by_tenant_id` | `p2_tenants(id)` | `:68` | `[DEBT]` **Low** |
| `p2_stock_transactions.reference_id` | `p2_dispatch_orders(id)` | Polymorphic by design (dispatch or challan) — an FK would break it | `[DEBT]` **Low**, accept |
| `p2_wip_transactions.reference_id` | `p2_dispatch_orders(id)` | `20260825_wip_state.sql:29` — nullable, deliberately unconstrained | `[DEBT]` **Low**, accept |
| `p2_stock_transactions.held_by` | `p2_clients(id)` | `_ai/CLAUDE.md` says `owned_by` got an FK in Step 2I; `held_by` is not mentioned | `[UNVERIFIED]` **Low** |
| `p2_dispatch_orders.created_by` | `auth.users(id)` | Written as `tenantId` (`dispatch.html:1047`, `rm-dispatch.html:1043`), i.e. **the tenant, not the user** — so it records nothing useful about who created the dispatch | `[BUG]` **Medium** — there is no per-user audit on any dispatch |
| `p2_stock_transactions.supplier_id`, `.raw_material_id`, `p2_products.*`, `p2_product_bom.*` | — | Initial DDL not in repo | `[UNVERIFIED]` |

### FKs with no explicit cascade/restrict rule

**Every FK in the repo omits `ON DELETE` / `ON UPDATE`**, defaulting to `NO ACTION`:

`p2_wip_transactions.tenant_id` → `p2_tenants(id)`, `.product_id` → `p2_products(id)`, `.owned_by` → `p2_clients(id)` (`20260825_wip_state.sql:25-27`); `p2_dispatch_orders.product_id` → `p2_products(id)` (`:18`); `p2_payment_receipts.tenant_id` → `p2_tenants(id)`, `.invoice_id` → `p2_invoices(id)` (`20260828_payment_ledger.sql:4-5`); `p2_notifications.tenant_id` → `p2_tenants(id)` (`20260831_notifications.sql:16`); `p2_supplier_advances.tenant_id` → `p2_tenants(id)`, `.supplier_id` → `p2_suppliers(id)` (`20260902:7-8`); `p2_invoices.dispatch_order_id` → `p2_dispatch_orders(id)`, `.client_id` → `p2_clients(id)` (`20260730:23-24`).

- **Assessment:** `[DEBT]` **Low, and arguably correct.** `NO ACTION` on financial records is the safe default and matches `_ai/CLAUDE.md`'s "deleting raw materials orphans BOM foreign keys — update/deactivate, don't delete". Two are worth making explicit:
  - `p2_payment_receipts.invoice_id` → **`ON DELETE RESTRICT`**, so an invoice with receipts can never be deleted even by a service-role script.
  - `p2_invoices.dispatch_order_id` → note that `hard_delete_dispatch` deletes dispatch orders; the `NO ACTION` FK will correctly block deleting an invoiced dispatch, but the error surfaces to the user as a raw constraint violation. Worth catching explicitly in the RPC's reason list.

## 6.3 Missing indexes

Indexes that exist (from `supabase/migrations/`): `p2_dispatch_orders(tenant_id)`, `p2_dispatch_orders(status)`, `p2_dispatch_orders(dispatch_token)` unique, `p2_dispatch_items(dispatch_order_id)`, `p2_dispatch_items(tenant_id)`, `p2_invoices(dispatch_order_id)` unique, `p2_invoices(invoice_token)` unique, `p2_invoices` consolidated dedup partial unique, `p2_pending_invites(tenant_id, lower(email))` partial unique, `p2_payment_receipts(tenant_id)`, `p2_payment_receipts(invoice_id)`, `p2_notifications(tenant_id, created_at DESC)`, `p2_notifications(tenant_id, read_at) WHERE read_at IS NULL`, `p2_cancelled_challans(tenant_id, cancelled_at)`, `p2_supplier_advances(tenant_id, supplier_id)`.

### `[DEBT]` Missing, ranked by query volume — **Medium** `[UNVERIFIED — initial DDL not in repo]`

| Table.column(s) | Why it matters | Query sites |
|---|---|---|
| **`p2_stock_transactions(tenant_id, transaction_type, transaction_date)`** | **The single hottest path in the product** and the largest table. No index of any kind appears in any migration. | `grn.html:766-770`, `grn.html:842-846`, `grn-history.html:289`, `ca-report.html:373` (`select('*')` for the whole tenant!), `export.html:697`/`:785`/`:794`/`:1172`/`:1258`, `reports.html:268`/`:289`/`:302`/`:345`, `gstr2b-reconcile.html:593`, `check-low-stock/index.ts:392`/`:404`, `index.html:716`, plus `v_p2_stock_balance` and `v_p2_supplier_advance_balance` |
| `p2_stock_transactions(tenant_id, raw_material_id)` | The sufficiency check in both consumption RPCs does `SELECT quantity … WHERE tenant_id AND raw_material_id … FOR UPDATE` (`20260901_fix_insufficient_stock_message.sql:101-110`, `20260825_wip_state.sql:110-118`). Without an index this is a **full scan under a row lock** on every dispatch. | Both RPCs, `dispatch.html:1009` |
| `p2_stock_transactions(tenant_id, supplier_id)` | Supplier history, `v_p2_supplier_advance_balance`'s GRN side | `20260902:74-81`, agent `supplier_history` intent |
| `p2_stock_transactions(tenant_id, invoice_no)` | GSTR-2B matching, GRN reconciliation | `gstr2b-reconcile.html`, `grn.html:842` |
| **`p2_invoices(tenant_id, invoice_date)`** | No `tenant_id` index at all on this table | `invoices.html:625-628`, `export.html` Sheet 2 / Table 12 / 43B(h) |
| `p2_dispatch_orders(tenant_id, dispatch_date)` | Table 13 scans a full financial year | `export.html:1433`, all four history pages |
| `p2_dispatch_orders(tenant_id, dispatch_type)` | Each of the three dispatch pages filters on it | `rm-dispatch.html:866-869`, `dispatch.html:647`, `production-issue.html` |
| `p2_wip_transactions(tenant_id, product_id)` | No index at all on this table | `v_p2_wip_balance`, `close_wip` |
| `p2_clients(tenant_id, name)` | `confirmGenerateInvoice` matches the client by name string | `agent-query/index.ts:2262-2266` |
| `p2_material_prices(tenant_id, raw_material_id, effective_date DESC)` and `p2_product_prices(tenant_id, product_id, effective_date DESC)` | "Latest by effective_date" is fetched on every invoice generation and every CA valuation | `all-dispatch-history.html:829-850`, `ca-report.html`, `export.html` |
| `p2_raw_materials(tenant_id, is_active)`, `p2_products(tenant_id, is_active)`, `p2_suppliers(tenant_id, is_active)` | Every dropdown on every page | ~20 sites |

- **Consequence:** Not visible at Datta Prasad's current volume. At 264 materials × daily GRNs over a year, `ca-report.html:373`'s unbounded `select('*')` on `p2_stock_transactions` and the `FOR UPDATE` full scan in the dispatch RPCs will become the first hard performance wall — and the RPC one takes a lock while it does it, so it will manifest as dispatches timing out under concurrent use.
- **Fix:** Add `(tenant_id, transaction_type, transaction_date)` and `(tenant_id, raw_material_id)` on `p2_stock_transactions` and `(tenant_id, invoice_date)` on `p2_invoices` now; do the rest as a batch.

## 6.4 The challan number length issue

### `[COMPLIANCE]` `CHAL-YYYYMMDD-NNNN` is 18 characters — **Medium**, latent

**Where it is generated:** `supabase/migrations/20260817_secure_confirm_dispatch_transaction.sql:80` and, in the current live version, `supabase/migrations/20260901_fix_insufficient_stock_message.sql:82`:

```sql
v_challan_number := 'CHAL-' || TO_CHAR(NOW(), 'YYYYMMDD') || '-' || LPAD(v_seq::TEXT, 4, '0');
```

`CHAL-` (5) + `YYYYMMDD` (8) + `-` (1) + `NNNN` (4) = **18 characters**. Rule 46(b) / Rule 55(1) cap a document serial number at 16.

**Where it is stored:** `p2_dispatch_orders.challan_number TEXT` — `supabase/migrations/20260527_dispatch_tables.sql:12`. **No length constraint, no format check, no `CHECK (length(challan_number) <= 16)`.** Nothing in the database prevents it.

**Is it reachable today?** Only via the fallback branch. All three UI paths pass an explicit `p_challan_number` from `getNextChallanNumber()` (`dispatch.html:1048`, `rm-dispatch.html:1134`, `production-issue.html:1541`), which returns a bare number like `"1001"` or `"RM-1001"`. The `CHAL-` branch fires only when `p_challan_number` is NULL or empty — which the dead `confirm-dispatch` Edge Function does (§4.9), and which any future caller could.

**Historical rows exist.** Ten places strip the prefix for display: `all-dispatch-history.html:452`, `:512`, `:566`, `:643`, `:963`, `:1029`; `dispatch-history.html:421`, `:587`, `:658`; `challan.html:450`. Nobody writes ten strippers for a format that never occurred.

### What ITC-04 and Table 13 actually report

**The stored 18-character value, not the stripped display value.**

- `export.html:1433` — `.select('challan_number, status, dispatch_date, movement_purpose')`, used raw.
- `export.html:1447` — same from `p2_cancelled_challans`.
- `export.html:1505`, `:1511` — passed straight into `challanSeriesKey()`.
- The GSTR-1 Excel Workbook's `doc` sheet calls `computeTable13Buckets()`, the same function.

The stripping regex `/^CHAL-\d{8}-/` appears **only** in on-screen display code, never in an export path.

### `[BUG]` And worse — `CHAL-` rows are silently excluded from gap detection

`export.html:1377` — `challanSeriesKey()` matches `/^(\D*)(\d+)$/`, which requires *all* non-digits followed by *all* digits. `"CHAL-20260904-0012"` has digits in the middle, so the regex fails, the function returns `null`, and `export.html:1505`/`:1511` filter the row out (`.filter(k => k !== null)`).

- **Consequence:** Any tenant with legacy `CHAL-` challans is (a) issuing 18-character serial numbers that exceed the Rule 55 cap, and (b) **invisible to the Table 13 gap detector** — the tool built specifically to catch numbering problems silently skips exactly the rows that have one.
- **Fix:** Shorten the fallback to `CH-YYMMDD-NNNN` (14 chars) in `20260901_fix_insufficient_stock_message.sql:82`; add `CHECK (length(challan_number) <= 16)` to `p2_dispatch_orders`; extend `challanSeriesKey()` to handle an embedded date segment so historical rows are counted. Run `SELECT count(*), max(length(challan_number)) FROM p2_dispatch_orders WHERE challan_number LIKE 'CHAL-%'` per live tenant first to size the exposure.

## 6.5 The `owned_by` column

### Where it exists

| Table | Present? | Type / FK | Evidence |
|---|---|---|---|
| `p2_stock_transactions` | **Yes** | `uuid NULL` → `p2_clients(id)` per `_ai/CLAUDE.md` (Step 2I) | `20260825_wip_state.sql:135-138` inserts it; `20260825_hard_delete_dispatch.sql:177-190` groups by it |
| `p2_dispatch_orders` | **Yes** | `uuid NULL` → `p2_clients(id)` | `20260825_wip_state.sql:126-128` |
| `p2_wip_transactions` | **Yes** | `owned_by uuid NULL REFERENCES p2_clients(id)` — **explicit in the migration** | `20260825_wip_state.sql:27` |
| **`p2_dispatch_items`** | **No** | — | Zero occurrences in any migration or client query |

**Correction to the audit brief:** `owned_by` is on the dispatch **header** (`p2_dispatch_orders`), not on `p2_dispatch_items`. That is the correct design — a dispatch moves one pool's material — and is consistent with how `confirm_bom_issue` and `confirm_dispatch_transaction` write it.

### `[FIXED]` It is a UUID FK, not a boolean

Directly verifiable for `p2_wip_transactions` (`20260825_wip_state.sql:27`). For the other two, indirect but conclusive: `20260825_confirm_bom_issue_2h_pool_consumption.sql:38` declares `p_owned_by uuid DEFAULT NULL`, `:65` resolves the label via `SELECT … FROM p2_clients WHERE id = p_owned_by AND tenant_id = p_tenant_id`, and `production-issue.html:2043` passes `r.owned_by` as a quoted UUID string. `_ai/CLAUDE.md` records the FK being added in Step 2I.

- **`[DEBT]` Low** — confirm the FK actually exists on all three:
  ```sql
  SELECT conrelid::regclass, conname, pg_get_constraintdef(oid)
  FROM pg_constraint WHERE contype='f' AND pg_get_constraintdef(oid) LIKE '%p2_clients%';
  ```

### `[BUG]` `[COMPLIANCE]` The inbound path is genuinely absent — **Critical (as a business problem)**

Exhaustively verified:

- **No UI.** `grn.html`'s row model (`grn.html:659-670`) has `material_id`, `quantity`, `rate`, `supplier_id`, `supplier_name`, `transaction_date`, `invoice_no`, `purchase_type`, `grn_no`. There is no pool/owner field in the form, in `addGRNRow()`, or in the payload. `settings.html`'s stock adjustment (`settings.html:2465-2468`) likewise writes no `owned_by`.
- **No RPC.** `owned_by` appears **zero times** in `supabase/functions/agent-query/index.ts` (the file that contains `confirm_receive_grn`), and zero times in `20260721_confirm_agent_grn.sql` or `20260725_confirm_agent_grn_multi.sql`.
- **No insert path.** Every `owned_by` write in the codebase is on the **outbound** side — `confirm_bom_issue` and `confirm_dispatch_transaction` consumption rows and dispatch headers, and `hard_delete_dispatch` reversals.
- **Reads exist but only as a filter.** 20 client-side sites use `.is('owned_by', null)` to *exclude* pooled stock; only `production-issue.html:958` can select a pool, and only for consumption.

**Consequence.** This is the load-bearing gap in the whole product. The three live clients are Type B job workers holding KPML's material right now. There is no way to record that material arriving. So it is recorded — via `grn.html` — as `owned_by = NULL`, i.e. **the job worker's own purchased stock**. The system can consume from a pool it can never fill. Every downstream number inherits the error: stock valuation, CA report closing stock, the Tally/Zoho export, low-stock minimums, and the ITC position on material the tenant never bought.

- **Fix:** This is Step 2's remaining work, in order: (1) add a pool selector to `grn.html` writing `owned_by`; (2) expose `owned_by` on `v_p2_stock_balance` with a pool filter; (3) surface pool balances on `index.html`; (4) exclude pooled GRNs from the ITC columns of the CA export.

## 6.6 `v_p2_supplier_advance_balance`

### `[FIXED]` Both required conditions are met

`supabase/migrations/20260902_create_supplier_advances.sql:50-82`:

- `WITH (security_invoker = true)` — line 51. ✅
- Explicit `WHERE tenant_id = get_my_tenant_id()` in **all four** subqueries: line 60 (advances UNION side), line 66 (GRN UNION side), line 71 (`adv` aggregate), line 80 (`grn` aggregate). ✅
- Also fan-out safe — both sides are pre-aggregated before the join (`:68-82`), not a raw cross join. ✅
- Also `owned_by IS NULL` on the GRN side (`:65`, `:79`), correctly excluding principal-owned material from advance drawdown. ✅

The comment at `:42-49` documents exactly why both were needed. **This is the model the other three views should be brought up to** (§6.1).

### `[BUG]` But the balance arithmetic is wrong — **High**

`:74-81` computes `total_drawn = SUM(quantity * rate)` over **every GRN that tenant has ever recorded from that supplier**, with no date bound and no link to any specific advance.

```sql
SELECT tenant_id, supplier_id, SUM(quantity * rate) AS total_drawn
FROM p2_stock_transactions
WHERE transaction_type = 'grn' AND rate IS NOT NULL AND owned_by IS NULL
  AND tenant_id = get_my_tenant_id()
GROUP BY tenant_id, supplier_id;
```

- **Consequence:** Record a ₹2,00,000 advance to a supplier the tenant has bought ₹18,00,000 from over two years, and the balance immediately reads **−₹16,00,000** — rendered red in the UI (`invoices.html:1346`) as if the tenant were massively overdrawn. The number is meaningless unless the tenant's *entire* purchase history from that supplier was prepaid. Datta Prasad, the client who asked for this feature, has 28 suppliers with existing GRN history.
- **Fix:** Bound `total_drawn` to GRNs dated on or after the earliest unsettled advance (`transaction_date >= MIN(payment_date)`), or — better — add an explicit `p2_supplier_advance_allocations` link table so each GRN draws down a named advance.

### `[DEBT]` No `payment_date` sanity bound — **Low**

`:9` — `payment_date date NOT NULL` with no `CHECK (payment_date <= CURRENT_DATE)`. A fat-fingered year is silently accepted.

## 6.7 Notification system

### `[FIXED]` The CHECK constraint lists exactly the three documented types

`supabase/migrations/20260831_notifications.sql:17`:

```sql
type text NOT NULL CHECK (type IN ('challan_dispatched', 'payment_overdue', 'low_stock'))
```

### `[FIXED]` No out-of-constraint type is inserted anywhere

Exhaustive check of every `p2_notifications` insert and every `sendNotification()` call:

| Call site | Type | Valid? |
|---|---|---|
| `dispatch.html:1170` | `'challan_dispatched'` | ✅ |
| `production-issue.html:1615` | `'challan_dispatched'` | ✅ |
| `rm-dispatch.html:1229` | `'challan_dispatched'` | ✅ |
| `js/notifications.js:62-63` (`checkAndNotifyLowStock`) | `'low_stock'` | ✅ |
| `check-low-stock/index.ts:457` | `'low_stock'` | ✅ |
| `check-low-stock/index.ts:271` | `'payment_overdue'` | ✅ |

`js/notifications.js:13` takes `type` as a caller-supplied parameter with no validation, and swallows the resulting constraint violation at `:25` (`if (error || !data) return;`) — so a future typo would fail completely silently.

- **`[DEBT]` Low fix:** Add a `VALID_NOTIFICATION_TYPES` array in `js/notifications.js` and reject unknown types with a `console.error`.

### `[FIXED]` Related schema is correct

- RLS via `get_my_tenant_id()`, three command-scoped policies, no DELETE (`:37-45`) — the model implementation.
- No auto-stamp trigger; `tenant_id` always passed explicitly — correct, and the reasoning in `:29-33` is sound (a trigger would clobber service-role inserts with NULL).
- Both indexes present (`:47-51`).
- `status` CHECK covers `queued`/`sent`/`failed` (`:21`) — and all three are used.
- Realtime enabled via `20260831_notifications_realtime.sql`.

### `[DEBT]` No `deferred` status for quiet hours — **Medium**

`notify/index.ts:118-121` writes `status='failed', error_reason='quiet_hours'` for a notification that is not failed — it is postponed and then dropped. The three-value CHECK has no room for a correct value. See §4.5.

---

# Part 7 — Known issues verification

| # | Issue (Skill Floor Report, Sept 3 2026) | Status | Exact location |
|---|---|---|---|
| 1 | `grn.html` lines 662 and 728 use `user.id` as tenant ID | **Still present** | `grn.html:662` and `grn.html:728` — both still `const tid = user.id;`. The correct value is already in scope as `tenantId` (resolved at `grn.html:335`) and is used at `:768` and `:844`. |
| 2 | Challan send deleted — no email/WhatsApp path on `challan.html` | **Still present** | `challan.html` has exactly five buttons: `lang-toggle` (`:195`), `editTextBtn` (`:198`), `editClientBtn` (`:203`), `printBtn` (`:206`), `qrToggleBtn` (`:210`), `downloadExcel()` (`:214`). No email, no WhatsApp, and no PDF download either (`js/challan-pdf.js` is loaded only by `receive.html`). |
| 3 | Accountant role missing dashboard permission in `js/roles.js` | **Still present** | `js/roles.js:6` — `accountant: ['reports','invoices']`. Compounded by `index.html:880-891` having no `canAccess()` gate and `login.html:284`/`:296` always redirecting there. Both must be fixed together or accountants hit a redirect loop. See §2.2. |
| 4 | Payment modal field order — Gross first instead of Net first | **Still present** | `invoices.html:409-410` (Gross, the typed field) precedes `:413` (TDS), `:417` (Other), `:423-425` (Net, read-only display). |
| 5 | Payment modal — no balance-due display | **Still present** | `invoices.html:388` (`#recordPaymentInvoiceLine`), populated at `:1181-1182` with only invoice number and client name. Invoice total, received-to-date and balance are all available in `allInvoices` / `receiptsByInvoice` at that moment and none are shown. |
| 6 | Payment modal — no guard against recording more than the invoice total | **Still present** | `invoices.html:1224-1229` — three checks (gross > 0, date present, deductions < gross). No comparison against `inv.amount_total` or the receipt sum. No DB constraint either (`20260828_payment_ledger.sql:2-17`). |
| 7 | Payment modal — 0/8 Marathi labels | **Still present** | `invoices.html:393, 397, 409, 413, 417, 424, 429, 434` — 8 labels, zero with `data-en`/`data-mr`. Also untranslated: the title (`:387`), both buttons (`:439-440`), all 6 payment-mode options (`:398-404`), and 5 validation toasts (`:1224-1229`). **0/17 strings.** The Record Advance modal directly below (`:460+`) is fully translated. |
| 8 | Principal pool inbound path — no GRN path for `owned_by` non-null material | **Still present** | No UI (`grn.html` row model at `:659-670` has no owner field), no RPC (`owned_by` appears zero times in `supabase/functions/agent-query/index.ts` and in both `confirm_agent_grn*` migrations), no insert path anywhere. Every `owned_by` write in the codebase is outbound. See §6.5. |
| 9 | `v_p2_stock_balance` — hardcoded `owned_by IS NULL` makes principal stock invisible | **Still present** | View definition is not in the repo (`[UNVERIFIED]` at source level), but `_ai/CLAUDE.md` states the filter is baked into the JOIN and that `owned_by` is not an output column. Confirmed by behaviour: all 20 consumers, including `check-low-stock/index.ts:368` and `js/notifications.js:50`, treat it as own-stock-only. |
| 10 | `manual.html` — three references to the deleted `send_challan` feature | **Still present — and worse than reported** | Not three references to one feature but **7 deleted intents documented as working commands**: `manual.html:414` (`send_challan`), `:415` (`send_tally_export`), `:416` (`send_invoice`), `:427` (`create_grn`), `:428` (`create_production_issue`), `:429` (`create_product_dispatch`), `:430` (`create_rm_dispatch`), plus prose at `:562`. All in both languages. |
| 11 | `index.html` — zero occurrences of `owned_by` (dashboard blind to principal stock) | **Still present** | Confirmed: zero occurrences in `index.html`. The dashboard reads `v_p2_stock_balance` (`:533`), which bakes in the filter, so it is blind by construction. Additionally `index.html:716-722` fetches per-material transaction history with **no `owned_by` filter at all**, so once pools are populated the history and the balance on the same screen will disagree. |
| 12 | `p2_clients.gstin` never rendered on the challan (Rule 55 compliance gap) | **Still present** | `challan.html` contains exactly one `gstin` reference — `:438`, `settings.gstin`, the **tenant's own** GSTIN. `p2_clients.gstin` is never fetched or rendered. Broader Rule 55(1) gap: the items table (`:292-295`) is Sr No / Description / Quantity / Unit (+ conditional PO) with **no HSN and no taxable value**, and there are no Rule 55(2) copy markings (no "Original for Consignee" / "Duplicate for Transporter" / "Triplicate for Consignor" anywhere in `challan.html` or `js/challan-pdf.js`). `_ai/CLAUDE.md` records this being explicitly dropped from the Sept 2 scope by request — it remains open. |
| 13 | Challan number 18 characters — exceeds the Rule 55 16-character limit | **Still present (latent)** | Generated at `20260901_fix_insufficient_stock_message.sql:82` (and previously `20260817_secure_confirm_dispatch_transaction.sql:80`). Stored in `p2_dispatch_orders.challan_number TEXT` with **no length constraint** (`20260527_dispatch_tables.sql:12`). Not reachable from the three UI paths today (all pass an explicit number), but reachable from the fallback branch, and ten display-stripping sites indicate historical rows exist. **The ITC-04 / Table 13 exports report the stored 18-character value** (`export.html:1433`, `:1447`) — the `/^CHAL-\d{8}-/` stripper appears only in on-screen code. New finding: `challanSeriesKey()` (`export.html:1377`) cannot parse the format at all, so `CHAL-` rows are **silently excluded from gap detection**. See §6.4. |
| 14 | `is_exempt_tooling` nulls the s.143 deadline, making exempt tooling invisible instead of flagged | **Still present** | `20260825_s143_clock_population.sql:34-36` and `:41-43` — `WHEN NEW.is_exempt_tooling THEN NULL`. Broader than reported: **nothing anywhere in the frontend reads `s143_clock_start`, `s143_clock_deadline`, `s143_extension_until` or `is_exempt_tooling`** — zero occurrences across all `.html` and `.js`. There is no UI to set the flag and no breach-detection surface, so exempt tooling is not "invisible relative to other purposes"; the entire s.143 clock is write-only. |

**Score: 0 of 14 fixed. 14 still present, 3 worse than reported (#10, #11, #13).**

---

# Priority fix list

Ranked by: (1) live client impact today, (2) financial accuracy risk, (3) compliance risk, (4) security risk.

## Do today — before the next build session

| # | Finding | Tags | Sev | Location | Why now |
|---|---|---|---|---|---|
| 1 | **RLS never enabled on `p2_stock_transactions`** | `[SECURITY]` | Critical | `20260803_staff_rls_fix.sql:77` (policy created, never enabled); confirmed live at `20260902_create_supplier_advances.sql:44-49` | Three paying clients' complete purchase ledgers — suppliers, rates, volumes, invoice numbers — mutually readable and writable, and readable by any new signup. One `ALTER TABLE` fixes it. |
| 2 | **Audit RLS on all 15 tables from the same migration** | `[SECURITY]` | Critical | `20260803_staff_rls_fix.sql:29-87` — no `ENABLE` for any of the 15; `p2_tenants` has no policy at all | If `p2_stock_transactions` was missed, assume the other 12 were too. `p2_tenant_settings` holds bank details, GSTIN and Telegram chat IDs. Query in §6.1. |
| 3 | **`v_p2_invoice_payment_status` and `v_p2_wip_balance` bypass RLS** | `[SECURITY]` | Critical | `20260901_payment_status_invoice_date.sql:14`, `20260825_wip_state.sql:46` — neither has `security_invoker`, neither has an internal tenant filter | Any logged-in user can read every tenant's invoice numbers, client names, amounts and receivables. Same bug class the Sept 2 audit fixed in one view and did not carry across. Also verify `v_p2_stock_balance`. |
| 4 | **`handle-new-user` Edge Function — unauthenticated privilege escalation** | `[SECURITY]` | Critical | `supabase/functions/handle-new-user/index.ts:30-52` | An unauthenticated POST grants the caller `owner` on any tenant. The function is redundant — the `handle_new_user()` DB trigger does the job. Check `supabase functions list`; if deployed, delete the deployment today. |
| 5 | **GRN writes the wrong tenant_id** | `[BUG]` `[SECURITY]` | Critical | `grn.html:662`, `grn.html:728` | Storekeepers — the role whose job is GRN — cannot record received stock. Two-line fix; `tenantId` is already in scope from `:335`. |

## This week — financial accuracy

| # | Finding | Tags | Sev | Location |
|---|---|---|---|---|
| 6 | **Invoice rate silently pre-filled from `p2_product_prices` with no warning** — Datta Prasad's 97 KPML SAP PO rates are one click from becoming a tax invoice | `[COMPLIANCE]` `[BUG]` | Critical | `all-dispatch-history.html:824-850`, `:865`, `:878-880` |
| 7 | **Blank rate becomes ₹0 on a persisted tax invoice** — three independent places, no validation on either side | `[BUG]` `[COMPLIANCE]` | High | `all-dispatch-history.html:916`; `agent-query/index.ts:2238-2241`, `:2363` |
| 8 | **Payment modal: no balance due, no over-payment guard, Gross-first, 0/17 Marathi** | `[BUG]` `[UX]` | High | `invoices.html:385-443`, `:1177-1194`, `:1224-1229` |
| 9 | **`v_p2_supplier_advance_balance.total_drawn` sums every GRN ever** — a new advance instantly reads as massively overdrawn | `[BUG]` | High | `20260902_create_supplier_advances.sql:74-81` |
| 10 | **`dispatch.html` burns a challan number on every save** — one dispatch consumes three numbers, leaves two permanent gaps | `[COMPLIANCE]` `[BUG]` | High | `dispatch.html:1048` inside `handleSaveWorkflow()`, order-update branch at `:1077-1081` |
| 11 | **Every failed confirm burns a challan number** | `[COMPLIANCE]` `[BUG]` | High | `rm-dispatch.html:1134`; `production-issue.html:1541` with the Cancel path at `:1573-1577` |
| 12 | **`get_next_challan_number` may produce duplicates under concurrency** — `[UNVERIFIED]`, needs `pg_proc` inspection | `[COMPLIANCE]` `[BUG]` | High | Live source unavailable; `20260822_challan_next_override.sql:2` documents `GREATEST(MAX+1, floor)`; stale copy at `sql/get_next_challan_number.sql` |
| 13 | **No duplicate-invoice guard on GRN** — same supplier invoice entered twice double-counts stock and double-claims ITC, and GSTR-2B reconciliation reports it as a supplier amount mismatch | `[BUG]` `[COMPLIANCE]` | High | `grn.html:627-712`; reconciliation modal at `:781-800` |
| 14 | **Invoice sequence gaps on any post-allocation failure** | `[COMPLIANCE]` `[BUG]` | High | `20260730_create_invoices_table.sql:61-71`; `agent-query/index.ts:2389-2418` |
| 15 | **`rm-dispatch.html` unchecked `.delete()` duplicates challan line items** | `[BUG]` | High | `rm-dispatch.html:1057-1060`, `:1173-1176` |

## This week — compliance and role security

| # | Finding | Tags | Sev | Location |
|---|---|---|---|---|
| 16 | **Job-work invoice block is client-side only** — the server derives `doc_category` from `movement_purpose` but never refuses | `[COMPLIANCE]` | High | `agent-query/index.ts:2246`, `:2385`; UI-only block at `all-dispatch-history.html:625` |
| 17 | **Principal pool inbound path absent** — KPML material recorded as the job worker's own stock on all three live tenants | `[COMPLIANCE]` `[BUG]` | Critical (business) | No UI, no RPC, no insert path — §6.5 |
| 18 | **Operator can cancel and amend confirmed challans** — reverses stock, no role check anywhere | `[SECURITY]` | High | `all-dispatch-history.html:473`, `:562-567`; `dispatch-history.html:612`; `issue-history.html:610`; `rm-dispatch-history.html` |
| 19 | **Operator can generate tax invoices** — plan-gated only, and `verifyCallerTenant` checks tenant but not role | `[SECURITY]` | High | `all-dispatch-history.html:316-328`, `:632`; `agent-query/index.ts:227-251` |
| 20 | **Operator can download the full GST export** — the Aug 17 gate chose `reports`, which operator holds | `[SECURITY]` | High | `export.html:2422-2426` |
| 21 | **Supervisor can cancel a tax invoice, no audit trail, no `status` CHECK** | `[SECURITY]` `[COMPLIANCE]` | High | `invoices.html:855-874`, `:931`; `20260730_create_invoices_table.sql:38` |
| 22 | **Any role can open AND edit any challan by URL** — no `canAccess()` on the page | `[SECURITY]` | Medium | `challan.html:938`; edit handlers at `:667-694` and `:618-630` |
| 23 | **`check-low-stock` is an unauthenticated all-tenant Telegram fan-out** | `[SECURITY]` | High | `supabase/config.toml` (`verify_jwt = false`) + no auth in `check-low-stock/index.ts` |
| 24 | **Rule 55 challan gaps: no consignee GSTIN, no HSN, no taxable value, no copy markings** | `[COMPLIANCE]` | Medium | `challan.html:438` (own GSTIN only), `:292-295` (item columns) |
| 25 | **18-character `CHAL-` numbers exported raw, and invisible to gap detection** | `[COMPLIANCE]` `[BUG]` | Medium | `20260901_fix_insufficient_stock_message.sql:82`; `20260527_dispatch_tables.sql:12` (no length CHECK); `export.html:1377`, `:1433` |
| 26 | **Accountant dashboard permission — fix `roles.js` and `index.html` together** | `[BUG]` | Medium | `js/roles.js:6` + `index.html:880-891` |
| 27 | **`manual.html` teaches 7 deleted agent commands to live clients** | `[BUG]` | Medium | `manual.html:414-416`, `:427-430`, `:562` |
| 28 | **Notification pipeline: 6 silent-failure points, zero retries, quiet hours drops messages** | `[BUG]` | High | `js/notifications.js:25`, `:31`; `notify/index.ts:112-121`, `:125-137`; call sites `dispatch.html:1170`, `production-issue.html:1615`, `rm-dispatch.html:1229` |
| 29 | **`get-user-email` returns any user's email to any authenticated caller** | `[SECURITY]` | High | `supabase/functions/get-user-email/index.ts:33-36` |
| 30 | **`api/invite-staff.js` has no role whitelist** — the Aug 17 fix landed in the superseded Edge Function; the UI offers `owner` | `[SECURITY]` | Medium | `api/invite-staff.js:94` vs `supabase/functions/invite-staff/index.ts:71-77`; `settings.html:605` |
| 31 | **Telegram bind tokens never expire, webhook has no secret token** | `[SECURITY]` | Medium | `telegram-webhook/index.ts:45-83`; `settings.html` Connect flow |
| 32 | **Tall modals clip their submit button off-screen at 390px** | `[UX]` `[BUG]` | High | `.nx-modal` with no `max-height`: `invoices.html:34-40`, `all-dispatch-history.html:26-31` — worst on the Generate Invoice modal |
| 33 | **`dispatch.html` pre-confirm stock check fails open on a query error** | `[BUG]` | Medium | `dispatch.html:1000`, `:1009`, `:1018` |
| 34 | **Low-stock alerts fire forever on deactivated materials** | `[BUG]` | Medium | `check-low-stock/index.ts:367-371` — no `is_active` intersection |
| 35 | **Telegram HTML injection kills the whole morning digest** | `[BUG]` | Medium | `check-low-stock/index.ts:63-70` with raw interpolation at `:449`, `:498`, `:518-521` |

## Cleanup — do alongside the above

- Delete `supabase/functions/confirm-dispatch/` (dead, no CORS, queries the non-existent column `p2_dispatch_items.quantity`, would pass every stock check as `NaN`).
- Delete `supabase/functions/handle-new-user/` and `supabase/functions/invite-staff/` after #4 and #30.
- Delete `js/lang.js` (referenced by no page; would be a syntax error if it were).
- Delete `sql/get_next_challan_number.sql` after resolving #12, or replace it with the real live source.
- Remove `console.log` at `js/auth.js:15` and `settings.html:3372`.
- Fix the CSS syntax error at `all-dispatch-history.html:24-25` (`.amend-badge` is currently undefined).
- Remove the dead `if (linkResult.error)` branch at `api/invite-staff.js:109-112`.
- Add `.eq('tenant_id', tenantId)` to the 10 unfiltered queries in `rm-dispatch.html` and `dispatch.html` (§1.2).
- Add the three highest-value missing indexes: `p2_stock_transactions(tenant_id, transaction_type, transaction_date)`, `p2_stock_transactions(tenant_id, raw_material_id)`, `p2_invoices(tenant_id, invoice_date)`.
- Move `.nx-modal` into `css/nexflow-design.css` with `max-height: 90vh; overflow-y: auto` and delete the six per-page copies (fixes #32 permanently).
