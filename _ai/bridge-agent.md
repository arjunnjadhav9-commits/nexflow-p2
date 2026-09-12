---
name: bridge-agent
description: Nexflow Bridge Agent (Enterprise E1) — the Windows agent that pushes confirmed Nexflow documents into the client's own TallyPrime. Transport, voucher XML contract, REMOTEID scheme, schema, security model, retry and failure analysis, installer, code signing, CA profile. Read in full before writing any Bridge Agent code.
sources: [enterprise-strategy.md §3.1 and §3.5, CLAUDE.md, codebase-audit.md, kpml-network-plan.md, js/full-export.js, tally-xml-gateway-research-sept-2026, microsoft-smartscreen-docs-2026, dotnet-release-schedule-2026]
last_updated: 11 September 2026
status: design complete — not yet built. Living document: update in place as it is built.
---

# Nexflow — Bridge Agent (E1)

**Load order for any Bridge Agent session. Read in this order, in full:**

1. `_ai/CLAUDE.md`
2. `_ai/bridge-agent.md` (this file)
3. `_ai/enterprise-strategy.md` §3.1 (and §3.5 before Session 19)
4. `js/full-export.js` — the existing Tally XML output. The Bridge Agent's voucher bodies
   must match it field for field. The one deliberate divergence is `REMOTEID`, and §6
   specifies exactly what changes and why.

**Status: designed, not built.** Nothing in this document exists in the codebase. Every codebase
fact was verified against the working tree on 11 September 2026. Every external technical fact
was verified against a primary or near-primary source on the same date and is cited in §2.

**What this document is for.** A future Claude Code session must be able to build Sessions 18
and 19 from this file without asking a design question. Where a decision could not be made from
here — because it needs a physical TallyPrime in front of a human — it is tagged
`[UNVERIFIED]`, listed again in §19, and given an exact procedure for resolving it.

---

## Tag convention

Inherited from `enterprise-strategy.md`, unchanged, plus one addition.

| Tag | Meaning |
|---|---|
| `[DECIDED]` | Decided. Build it as written. Do not relitigate. |
| `[RECOMMENDED]` | This document's recommendation. Needs founder sign-off before build. |
| `[VERIFIED]` | Confirmed against a primary source or the live working tree, 11 Sept 2026. |
| `[UNVERIFIED]` | Needs a live check before code is written. Every instance is repeated in §19. |
| `[CORRECTION]` | An existing Nexflow document or the founder brief states something the research contradicts. Read the correction before planning around the older text. |
| `[NEVER]` | Permanently out of scope. |

---

## 0. Corrections to existing documents — read these first

Five things in the current documentation set are wrong or incomplete. A session that plans from
those documents without reading this section will build the wrong thing.

### `[CORRECTION]` C1 — EV code-signing certificates no longer bypass SmartScreen

`CLAUDE.md` Known Open Items #4 and `enterprise-strategy.md` §6 blocker 4 both assume that a
signed installer removes the SmartScreen warning, and §9 Q5 frames the choice as "OV or EV" with
EV implicitly the faster route.

**Microsoft removed immediate SmartScreen reputation for EV certificates in 2024.** The current
official documentation is unambiguous: *"EV certificates no longer bypass SmartScreen. … Paying a
premium for EV solely to avoid SmartScreen warnings is no longer justified."* An EV-signed binary
and an OV-signed binary now build file-hash and publisher reputation identically, over weeks and
hundreds of clean installs. `[VERIFIED — Microsoft Learn, "SmartScreen reputation for Windows app
developers", updated 2026]`

Three consequences, all of which change the plan:

- **Buy OV, not EV.** Roughly ₹20,000/yr instead of ₹30,000–₹45,000/yr, for identical SmartScreen
  behaviour. EV remains worth considering only if a Segment 3 procurement checklist demands it —
  which is a commercial question, not a technical one. See §13.4.
- **The certificate is no longer a hard gate on the first install.** A signed-but-new binary still
  shows a warning. The certificate changes the dialog from *"Windows protected your PC — unknown
  publisher"* to *"unrecognised app — Nexflow Automations Private Limited"*, which is the
  difference that matters in a factory owner's office, and it lets reputation accumulate across
  versions. It does not remove the click.
- **The install procedure must therefore assume one SmartScreen click**, and the installer's own
  documentation and the founder's install script must tell the owner that in advance. An install
  that surprises the owner with a scary dialog is a support call and a trust event; one that was
  predicted in the previous sentence is neither.

**Azure Artifact Signing (formerly Trusted Signing) is not available to Nexflow.** It is $9.99/mo,
needs no hardware token, and would otherwise be ideal — but Public Trust organisation validation
requires (a) a minimum of three years of verifiable operating history and (b) the organisation to
be in one of a listed set of countries. **India is not on that list, and a company incorporated in
late 2026 has zero years of history.** `[VERIFIED — Microsoft Q&A / Artifact Signing FAQ,
Sept 2026]` Do not plan around it. Re-check in 2029.

### `[CORRECTION]` C2 — A confirmed dispatch must NOT produce a Sales voucher

The founder brief for this document says the agent reads *"confirmed Nexflow events (dispatches,
GRNs, invoices)"* and lists *"Dispatch confirmed in Nexflow → Sales voucher in Tally (Sales +
Stock deduction)."*

**That mapping is wrong and would corrupt a live client's statutory books on day one.** Three
independent reasons:

1. **It double-counts.** A dispatch and the invoice raised against it are the same economic
   supply. Posting both produces two Sales vouchers for one supply — doubling that month's
   outward tax liability in the client's own books.
2. **It defeats the job-work guard for free.** `SALE_INVOICEABLE_PURPOSES` in
   `agent-query/index.ts` (Session 6, P0) already restricts invoice generation to `sale` and
   `direct_supply_from_jobworker`. Syncing *from `p2_invoices`* inherits that guard at zero cost.
   Syncing from `p2_dispatch_orders` would push `job_work_return`, `scrap_return`,
   `unused_material_return` and `capital_goods_issue` challans into Tally as taxable sales. For
   all three live tenants — every one of them a KPML job worker — that is the single most
   expensive possible bug in the product.
3. **A delivery challan is not an accounting event.** Under Rule 55 it is a non-supply movement
   with no taxable value anywhere in GSTR-1; it appears only as a document count in Table 13
   (`kpml-network-plan.md` §10.6). Tally has nothing to record for it.

`enterprise-strategy.md` §3.1's own source table is already correct — it maps `p2_invoices` to
Sales and says explicitly *"Do not 'optimise' it into a dispatch-driven sync."* This document
follows `enterprise-strategy.md` §3.1, not the brief. See §4.

### `[CORRECTION]` C3 — "Stock deduction" is not part of any Bridge Agent voucher

The brief also says the Sales voucher carries a stock deduction. It does not, and this is a
locked boundary rather than a simplification: **the Bridge Agent posts accounting vouchers only,
never inventory.** `enterprise-strategy.md` §3.1 Limitations and §3.5 Q4 both state it, and §3.5
gives the reason — an item voucher requires every Nexflow stock item to exist as a master in
Tally, which means duplicating a 264-material list (Datta Prasad) into an accounting system that
has no business holding it and rebuilding it every time a material is added.

Nexflow remains the inventory system of record. The consequence — that the CA cannot build GSTR-1
Table 12 from Tally — is handled, not ignored: Nexflow supplies the `hsn` sheet directly in the
Monthly Filing Package, computed from real quantities and UQCs that only Nexflow holds. Say this
to the CA at setup (§14.3).

### `[CORRECTION]` C4 — "Bidirectional sync" is narrowed to a configuration echo

The brief lists *"Syncs bidirectionally where needed (e.g. ledger names from Tally into
Nexflow)."* `enterprise-strategy.md` §8 item 2 makes bidirectional Tally→Nexflow sync a permanent
`[NEVER]`.

These are reconcilable, and the reconciliation is precise rather than a compromise. **No Tally
*data* ever enters a Nexflow table.** What `enterprise-strategy.md` §3.1 already
contemplates is that the client's own chart-of-accounts *names* must end up in
`p2_tally_targets.ledger_map`, because the agent refuses to invent ledgers. Reading that list from Tally to populate a picker is configuration, not data.
The carve-out is bounded in §3 D6 and it has hard edges: read-only, human-initiated, name-only,
never scheduled, and nothing persisted except the values the owner explicitly picked.

Anything broader — vouchers, balances, stock, masters beyond names — stays `[NEVER]`.

### `[CORRECTION]` C5 — `js/full-export.js`'s REMOTEID is not merely "a placeholder"

`CLAUDE.md:2162` and `js/full-export.js:256-266` both describe the current `buildRemoteId()` as a
placeholder that the Bridge Agent will replace. That is true but understates the consequence, and
the README wording shipped to clients understates it further.

The two schemes produce **different strings for the same document**, so Tally cannot match them.
A client who ran "Export All Data" and imported `vouchers-FY2026-27.xml` into Tally, and who later
installs the Bridge Agent, gets **a second copy of every voucher in that financial year** unless
something stops it. The README's current advice ("treat this as a one-time historical import") is
guidance the client may not follow and cannot verify.

This document fixes it properly rather than warning about it. §6.5 specifies a **legacy adoption
path**: the agent computes both the canonical and the legacy id, the pre-flight scan looks for
both, and a document already in Tally under its legacy id is *adopted* — future syncs address it
by the legacy id, permanently, recorded as `remote_id_source = 'adopted_legacy'`. The client gets
zero duplicates and does not have to have understood a README.

---

## 1. Executive Summary

### 1.1 What it is

A small Windows application installed on the PC that runs TallyPrime — at the **client's factory**
for the factory profile, at the **CA's own office** for the CA profile. It watches a
Nexflow-managed queue, posts finished vouchers into Tally over Tally's local XML gateway, and
writes back the result of each post.

**One-way only: Nexflow → Tally. Nexflow is the source of truth.** `[DECIDED —
enterprise-strategy.md §3.1]`

It replaces the ten days a month a ₹25,000/month accountant spends retyping challans and invoices
that already exist, correctly, in Nexflow.

### 1.2 Why it is the most important technical moat

Every other Nexflow moat is a reason to buy. This one is a reason not to leave.

After six months of running, the client's **statutory books have been populated by Nexflow
continuously**. Leaving means resuming manual entry *and* reconciling what was already imported —
and, in the CA-profile case, it means the client asking their CA to remove Nexflow from the CA's
own TallyPrime, across every other client the CA also runs it for. No factory owner makes that
call to their CA over a subscription renewal.

The lock-in is not contractual and must never be made contractual (`enterprise-strategy.md` §4 —
the export stays unconditional, on every plan, forever). It is that **the alternative is visibly
worse every single month**, and the person who would have to execute the switch is not the
customer.

That is also why the correctness bar here is higher than anywhere else in the product. A moat
built on writing into someone's statutory books is a liability the first time it writes a wrong
number. `business-strategy.md` §6 moat 3 already names the shape of the risk: in a district where
every factory owner knows every other, one bad month is a market-wide reputation event and it is
unrecoverable.

### 1.3 The architecture in one paragraph

The **Edge Function builds and renders the complete Tally XML server-side** at the moment a
document becomes eligible, stores it on a `p2_tally_sync_log` row with a permanent `REMOTEID`, and
hands it to the agent on request. The **agent contains zero business logic** — it polls over
HTTPS, asserts the voucher balances to zero, POSTs the bytes to `http://127.0.0.1:9000`, parses
Tally's result envelope, and reports back. It holds exactly one secret, encrypted with DPAPI, and
talks to exactly one hostname besides localhost. Everything that decides *what* goes into a
client's books lives in TypeScript, in one place, versioned with the rest of the product; the
Windows binary is a pipe.

### 1.4 What it costs

| | |
|---|---|
| Build — Session 18 (factory profile) | 3–4 weeks, plus a one-machine field pilot |
| Build — Session 19 (CA profile) | 1–1.5 weeks, gated on Session 18 stable for one month |
| OV code-signing certificate | ~₹20,000/yr (Sectigo via an Indian reseller, incl. HSM token) |
| Support, per Enterprise client per year | 4–8 founder-hours (`enterprise-strategy.md` §7) |
| Marginal compute | ~₹0. The queue is rows; the agent polls. |

**Support is 85% of the cost of this feature and compute is 0.4%** (`enterprise-strategy.md` §7).
Every design decision below that looks over-engineered is buying founder hours. None of them is
buying tokens.

---

## 2. Research Findings

Every external fact this design rests on, what was searched, what was found, and what was decided
because of it. Searched 11 September 2026.

### 2.1 Tally's integration surface

**Searched:** *"Tally Prime integration API HTTP XML port 9000 developer documentation"*,
*"TallyPrime acts as Both server client Advanced Configuration port 9000"*.

**Found.** `[VERIFIED]`

- TallyPrime exposes **no REST or GraphQL API**. It accepts XML over HTTP on a configurable port,
  default **9000**, and it is synchronous — there are no webhooks and no callbacks.
- Enabled at **F1 (Help) → Settings → Connectivity → Client/Server configuration → "TallyPrime
  acts as: Both"** (or *Server*), port 9000. Older builds and Tally.ERP 9 expose the equivalent
  under **F12 → Advanced Configuration**, and `tally.ini` carries `ServerPort=9000`.
- **Tally must be running and the target company must be loaded** for the port to answer.
- ODBC exists but is **read-only, cannot join across companies, and was formally deprecated from
  TallyPrime 4.0**. TDL runs inside Tally and its syntax breaks between releases.
- Tally.NET remote access **blocks data import**, so there is no cloud-to-Tally write path of any
  kind.

**Decided.** HTTP XML gateway as the only transport (§3 D1). No ODBC — it cannot write. No TDL —
*"Keep as little logic in TDL as possible. TDL syntax breaks between Tally versions; external
services remain stable across updates"* is the consensus of every practitioner source found, and a
TDL plugin would make Nexflow's support surface a function of the client's Tally build number.

### 2.2 The XML contract

**Searched:** *"Tally Prime sales voucher XML format example"*, *"TallyPrime purchase voucher XML
import GST CGST SGST IGST"*, *"Tally XML ISDEEMEDPOSITIVE AMOUNT negative debit positive credit"*,
*"Tally XML import errors and fixes"*, *"Tally voucher type numbering method Automatic vs Manual
XML import"*.

**Found.** `[VERIFIED]` unless marked otherwise.

| Finding | Consequence |
|---|---|
| **Sign convention:** debits are `ISDEEMEDPOSITIVE=Yes` with a **negative** `AMOUNT`; credits are `ISDEEMEDPOSITIVE=No` with a **positive** `AMOUNT`. All `AMOUNT` values in a voucher must sum to **exactly zero**. | Matches `enterprise-strategy.md` §3.1 and `js/full-export.js` exactly. No change needed. §5.2. |
| **An out-of-balance voucher still imports.** Tally accepts it, flags it internally, and it does not appear in financial statements. | The most damaging available silent failure. Assert `sum(AMOUNT) == 0` to the paisa **twice** — server-side at enqueue and again in the agent before POST. §10.1. |
| **Date format is `YYYYMMDD`**, no separators. A date outside the company's financial year is rejected with *"Date is out of financial year range."* | §5.7, and a specific failure class (§10.3). |
| **`SVCURRENTCOMPANY` must match the loaded company name exactly.** A mismatch produces *"Import completed"* with an empty Day Book — **no error at the HTTP layer, no error in the response.** | This is the single most dangerous thing about the protocol. Company-list probe before every cycle (§11.1), and `CREATED + ALTERED >= 1` is part of the success test (§5.9). |
| **`VCHTYPE` is case-sensitive** — `"Purchase"`, not `"purchase"`. | §5.7. |
| **Ledger names must match exactly**, including spacing and punctuation, or *"Ledger Name 'X' does not exist!"*. Trailing spaces from copy-paste into Tally are a documented real-world cause. | Party-ledger creation is automated; every other ledger is mapped by a human from a **list read out of Tally**, never typed. §3 D6, §13.3. |
| **Voucher numbering method matters.** If a voucher type's numbering is *Automatic*, Tally may override the `VOUCHERNUMBER` in the XML, and *"voucher number is the only check point for Tally when you are importing"* — so duplicates follow. The documented fix is numbering **Manual** with *Prevent Duplicates = Yes*. | Installer must verify this on the Sales and Purchase voucher types and refuse to proceed if it is wrong. §13.3. Nexflow's invoice numbers are legally significant (`INV-YYYYMM-NNN`); an auto-numbered Tally would silently renumber them and break every reconciliation. |
| **Tally emits illegal XML entities and Windows-1252 bytes in nominally UTF-8 output**, and `₹` / curly quotes become literal `?` on the wire. | We only *read* Tally output on the probe and the pre-flight. Parse responses **tolerantly** (decode latin-1, regex-extract the counters) rather than with a strict XML parser. §5.9. Never put `₹` in a narration. |
| **Import failures are logged to `Tally.imp`** in the Tally installation folder, and the documented support procedure for at least one live competing product is *"open the IMP file in Notepad and search for `Error: 1`."* | The agent captures the verbatim `LINEERROR` from the response into `last_error` so the owner never touches `Tally.imp`. §16 item 4. |
| Two response shapes circulate: `<IMPORTRESULT>` with `CREATED/ALTERED/LASTVCHID/LASTMID/COMBINED/IGNORED/ERRORS`, and a bare `<RESPONSE>` with `CREATED/ALTERED/DELETED/LASTVCHID/ERRORS/IGNORED`. `[VERIFIED — both appear in Tally's own documentation]` | Parse by tag name anywhere in the body, not by path. §5.9. |
| **`REMOTEID` + F12 → "Overwrite Vouchers during import (where voucher Remote GUID matches)"** is Tally's own idempotency mechanism. Sources disagree on the exact polarity of the setting. `[UNVERIFIED — §19 Q2]` | Nexflow's own `UNIQUE` constraint is the **primary** idempotency guard; Tally's REMOTEID matching is the secondary. The design is correct whichever way the setting behaves. §11. |
| **A voucher imported into a *different* company than it was exported from is overridden regardless of the setting.** | A REMOTEID landing in the wrong company can overwrite another client's voucher. This is the CA profile's worst case and it gets three independent guards. §14.4. |

**Envelope shape.** `IMPORTDATA` / `REQUESTDESC` / `REQUESTDATA` with `<REPORTNAME>Vouchers</REPORTNAME>`
for vouchers and `<REPORTNAME>All Masters</REPORTNAME>` for ledgers, as already implemented in
`js/full-export.js:317-336`. Confirmed against Tally's own sample XML page.

### 2.3 Tally ERP 9 vs TallyPrime

**Searched:** *"Tally ERP 9 vs TallyPrime XML voucher import format differences GST tags"*.

**Found.** The XML voucher envelope and the ledger-entry shape are **compatible across both** —
practitioner converters advertise one output format for TallyPrime and ERP 9. The differences are
in the product, not the protocol: ERP 9 handles one GSTIN per company, has no in-product GSTR-2B
reconciliation, and **no longer receives statutory updates**.

**Decided.** `enterprise-strategy.md` §3.1's "TallyPrime only" stands `[DECIDED]`, but with a
corrected reason. It is not that ERP 9 cannot parse the XML — it very likely can. It is that ERP 9
is a statutorily stale product, and Nexflow cannot underwrite the correctness of data landing in
books whose GST engine stopped being updated. §3 D2 states the support policy and what the agent
does when it detects ERP 9.

### 2.4 Windows runtime and packaging

**Searched:** *"Windows system tray background app Electron vs Node.js SEA pkg memory footprint
auto-update"*, *"Node.js single executable applications production guide"*, *".NET 10 LTS support
schedule"*, *"Inno Setup vs NSIS Node.js Windows installer per-user no admin"*, *"Inno Setup
PrivilegesRequired lowest silent install enterprise deployment"*.

**Found.** `[VERIFIED]`

- **Electron idles at roughly 250 MB RSS**; a comparable plain Node process is ~75 MB; a .NET
  tray app is ~25–35 MB.
- **Node.js SEA is stable since Node 22** and works by injecting an esbuild bundle as a resource
  section into a copy of the Node binary via `postject`. Baseline Windows binary ~50 MB.
  **Native modules (`.node`) cannot be embedded in the SEA blob** — they must ship as separate
  files loaded through `createRequire`.
- **.NET 8 and .NET 9 both reach end of support on 10 November 2026** — two months from today.
  **.NET 10 is LTS, shipped 11 November 2025, supported to 14 November 2028.**
- **Inno Setup `PrivilegesRequired=lowest`** gives a genuine per-user install with no elevation
  prompt, and per-user registry areas are writable from the script. `/VERYSILENT
  /SUPPRESSMSGBOXES` plus custom `/PARAM=` switches cover unattended enterprise rollout.
  NSIS's main advantage is its `electron-builder` integration, which is irrelevant if Electron is
  not used.
- **Node 17+ resolves `localhost` to IPv6 `::1` first.** Tally binds IPv4. A Node agent
  connecting to `http://localhost:9000` therefore gets `ECONNREFUSED` **while Tally is running and
  healthy** unless it uses `127.0.0.1` explicitly or sets `dns.setDefaultResultOrder('ipv4first')`.

**Decided.** §3 D4 — .NET 10 LTS, self-contained, single-file, WinForms tray. Inno Setup, per-user.
The full comparison and the rejected alternatives are in D4; the `localhost` finding applies
regardless of runtime and is stated as a hard rule in §3 D1.

### 2.5 Credential storage

**Searched:** *"Windows DPAPI Node.js credential storage ProtectedData CurrentUser"*, *"what is
DPAPI storing secrets on Windows in practice"*.

**Found.** `[VERIFIED]`

- **`DataProtectionScope.CurrentUser` is the correct default** for a per-user desktop app.
  `LocalMachine` is decryptable by *any* process on the PC and is documented as a decision people
  regret; it is only appropriate for a single-purpose service machine.
- **`optionalEntropy` is not a second key.** Embedding it in the binary adds no security. Its
  correct use is *purpose separation* — a fixed byte string like `"AppName:Purpose:v1"` so
  ciphertext written for one purpose cannot be accidentally accepted for another.
- **DPAPI does not store anything.** The application owns the file. Per-user paths only —
  `%LOCALAPPDATA%\Vendor\App\` — never the install directory, never a network share.
- **Known recovery scenarios:** an administrative password reset, profile recreation, or a service
  account change can all render existing ciphertext undecryptable. The prescribed pattern is to
  catch the cryptographic exception and **route to a credential re-entry flow**, never to crash.
- **Threat model.** DPAPI protects against a config file leaking by email, backup, git or being
  carried to another PC, and against other *users* on the same machine. It does **not** protect
  against code running as the same user, an administrator, or malware in the user's context.
- **Windows Credential Manager** is the better store for username+password pairs and caps at
  roughly 20 entries per app; **DPAPI is the better fit for tokens and structured config**, which
  is what the agent holds.

**Decided.** §7.4 — DPAPI `CurrentUser` with a versioned purpose entropy, file at
`%LOCALAPPDATA%\Nexflow\Bridge\credentials.dat`, decryption failure routed to re-pairing. Not
Credential Manager: the secret is an opaque token, not a credential pair, and the ~20-entry cap is
a needless ceiling for the CA profile.

### 2.6 Code signing

**Searched:** *"code signing certificate EV vs OV Windows SmartScreen reputation India private
limited"*, *"Azure Trusted Signing eligibility 3 years organization validation India"*, *"OV code
signing new company India hardware token cloud HSM"*.

**Found.** `[VERIFIED]` — see §0 C1 for the headline. Additionally:

- Since **1 June 2023**, all code-signing private keys — OV as well as EV — must be generated and
  held in an **HSM or FIPS-140-2 Level 2 USB token**. There is no software-key OV certificate any
  more. Options are a shipped physical token or a CA-hosted cloud HSM signing service.
- **Sectigo OV is roughly $220–$280/yr** through resellers; DigiCert OV lists around $439.
  Indian resellers quote in INR with a GST invoice and assist with token setup and drivers.
- OV organisation validation for an Indian PVT LTD uses the MCA/government registration record
  plus a verifiable phone listing; **it does not require years of trading history** — unlike Azure
  Artifact Signing.
- Microsoft's own recommendations that do apply to us: **sign every release**, **use a consistent
  signing identity** (rotating the certificate resets publisher reputation), **do not modify files
  after signing**, and **release to a small audience first to build reputation before a wide
  release**.

**Decided.** §13.4 — OV from Sectigo through an Indian reseller with cloud HSM signing, ordered the
week incorporation completes. Reputation is built deliberately: the founder's machine, then the
test tenant, then Datta Prasad, then wider — which the staged-rollout mechanism in §12.4 supports
for its own reasons anyway.

### 2.7 What existing Tally integrations do, and what users complain about

**Searched:** *"Tally connector sync software India complaints duplicate entries data mismatch"*,
*"Tally sync third party integration ledger not found"*, *"Suvit review Tally limitations"*,
*"Tally Prime reconciliation automation XML ODBC connector"*, plus the published support
documentation of two live Indian products.

**Found.** `[VERIFIED]` — the specifics are in §16, because they are design requirements rather
than background. In summary, the recurring, documented complaints are: a human must press a
button for every sync; there is no idempotency key so re-running duplicates; company-name
mismatch fails silently; the user is told to read `Tally.imp` in Notepad; a renamed ledger breaks
the sync with no recovery path; and Tally's own two-way synchronisation duplicates data whenever
the same transaction is edited in two places.

---

## 3. Architecture Decisions

### D1 — Transport: HTTP POST to `http://127.0.0.1:9000`. `[DECIDED]`

**Decision.** The agent POSTs the complete XML envelope to Tally's local XML gateway, with
`Content-Type: text/xml; charset=utf-8` and a 30-second timeout, and parses the response body.

**Never `localhost`, always the literal `127.0.0.1`.** This is not style. Tally binds IPv4; modern
runtimes resolve `localhost` to `::1` first; the resulting `ECONNREFUSED` is indistinguishable
from "Tally is closed" and would send the agent into a 24-hour amber state on a perfectly healthy
machine. The host is configurable for the hosted-Tally VM case (§14.2) but the default is the
literal IPv4 loopback and the configuration field validates that it is a literal address, not a
name.

**Why not an XML file drop into a watched folder.** Tally does not watch folders. A file drop
requires a human to run Gateway of Tally → Import → Vouchers, and — decisively — **it returns no
machine-readable result**. The outcome is only discoverable by reading `Tally.imp`, which is
exactly the support experience §16 exists to avoid. A file drop is not an integration; it is a
manual import with extra steps.

**Why not TDL.** TDL syntax breaks between Tally releases, a TDL plugin must be installed into the
client's Tally (which needs the client's Tally partner, a third party in the support loop), and it
would make Nexflow's correctness a function of the client's build number. `[NEVER]`

**Fallback when Tally's HTTP server is off.** There is no automated fallback, and pretending
otherwise would be worse than admitting it. The behaviour is:

1. The pre-flight probe detects the refused connection and distinguishes it from a timeout.
2. The tray goes amber with a count: *"14 documents waiting — TallyPrime is not running, or its
   connectivity setting is off."*
3. The agent window shows a one-screen, illustrated instruction: *F1 (Help) → Settings →
   Connectivity → TallyPrime acts as: **Both** → Port 9000*, with a **"Test again"** button.
4. The agent additionally writes the pending envelopes to
   `%LOCALAPPDATA%\Nexflow\Bridge\manual-import\pending-YYYY-MM-DD.xml` **as a recovery artefact
   only**, and the window offers *"Save a file my accountant can import by hand."* Nothing is
   marked `sent` by this path. If the owner imports that file manually, the pre-flight scan on the
   next successful connection finds the vouchers by their `REMOTEID` and reconciles the rows to
   `sent` with `remote_id_source` unchanged — because the REMOTEID is in the file, a manual import
   and an agent import are the same import. This is the one place the REMOTEID scheme buys
   something no competitor has.

### D2 — Tally version support `[DECIDED]`

| Version | Supported | Behaviour |
|---|---|---|
| **TallyPrime 3.0 and later** | ✅ Supported | Full support. The target. |
| TallyPrime 1.x / 2.x | ⚠️ Best effort | Agent warns at install, syncs, does not refuse. |
| **Tally.ERP 9** | ❌ **Not supported** | Agent detects it at pre-flight and **refuses to sync**, with a plain-English reason. |
| Tally in **educational mode** | ❌ Refuses | Educational mode restricts voucher dates; posting into it produces garbage. Detected at pre-flight. `[UNVERIFIED — probe response shape, §19 Q3]` |

The ERP 9 refusal is a deliberate product decision, not a technical limitation (§2.3). The message
says so honestly: *"This company is running Tally.ERP 9, which no longer receives GST statutory
updates. Nexflow will not write into it. Upgrade to TallyPrime, or use the Monthly Filing Package
instead."* Note the second half — the client is not left with nothing.

### D3 — The XML is rendered **server-side**, not by the agent. `[DECIDED]` — keystone decision

**Decision.** `supabase/functions/tally-bridge` builds the payload *and renders the complete XML
envelope string* at enqueue time, stores it in `p2_tally_sync_log.xml`, and hands it to the agent
as opaque bytes. **The agent contains no ledger logic, no GST logic, no grouping logic and no
template.**

This is the decision that everything else in the document depends on, and it reverses the sketch
in `enterprise-strategy.md` §3.1's diagram (*"agent builds XML"*). Five reasons:

1. **One implementation of the voucher builder, forever.** The Bridge Agent's output must be
   identical to `js/full-export.js`'s, which is the version a CA has already seen and verified.
   `kpml-network-plan.md` §17 names "repeated implementation" as a known, recurring failure
   pattern in this codebase — three invoice-button implementations, the
   `READ_ONLY_INTENTS`/`READ_ONLY_TEXT_INTENTS` double-update hazard. A voucher builder in a
   Windows binary and a second one in a browser script is the same hazard, with a client's
   statutory books as the blast radius.
2. **An agent upgrade cannot change what lands in a client's books.** If the agent renders, then
   v1.4 and v1.7 can produce different XML from the same data, and a client running an old version
   is posting different accounting entries from one running the new one. With server-side
   rendering the agent version is invisible to the output, which collapses an entire class of
   support question.
3. **`payload_hash` becomes meaningful.** The schema already carries a hash to detect source drift
   after send. If the agent renders, two agent versions produce two hashes for one document and
   the drift detector fires on every upgrade. Rendered server-side, the hash is authoritative.
4. **It is the mechanism §3.5's data-isolation guarantee already requires.** Guarantee 3 says
   *"build the payload once, server-side, at enqueue time — the agent renders XML from a payload
   it cannot widen."* Rendering fully server-side is that guarantee taken one step further: the
   agent cannot widen the payload because it never sees a payload, only a finished document.
5. **It makes the runtime choice a transport choice.** Once the agent has no business logic, the
   language it is written in stops being a correctness question and becomes a Windows-integration
   question — which is what D4 then answers on its merits rather than on familiarity.

**What the agent still validates.** Rendering server-side does not mean trusting blindly. Before
every POST the agent independently:

- parses the envelope it is about to send and asserts `sum(AMOUNT) == 0` to the paisa;
- asserts the `SVCURRENTCOMPANY` in the envelope equals the company it has configured for that
  target and that that company is currently loaded in Tally;
- asserts the `REMOTEID` matches the `remote_id` on the queue row;
- refuses and marks `invalid_payload` if any of those fail, without posting.

Defence in depth on a document entering statutory books is cheap and the checks need no business
knowledge.

**The ledger map is applied at render time.** Consequence: when an owner edits `ledger_map`, every
`pending` / `failed` row for that target is re-rendered and its `payload_hash` recomputed. `sent`
rows are immutable history and are never re-rendered. §9.3.

### D4 — Runtime: .NET 10 LTS, self-contained single-file WinForms tray app `[DECIDED]`

| Concern | Decision |
|---|---|
| Runtime | **.NET 10 (LTS, supported to 14 Nov 2028)**, `win-x64`, `--self-contained`, `PublishSingleFile=true`, `EnableCompressionInSingleFile=false` |
| UI | WinForms `NotifyIcon` tray + one small status window. No web view, no browser engine. |
| Auto-start | `HKCU\Software\Microsoft\Windows\CurrentVersion\Run` — per-user, no admin |
| Installer | **Inno Setup**, one `.exe`, `PrivilegesRequired=lowest` |
| Credentials | **DPAPI `CurrentUser`**, built into the framework — no native module, no sidecar |
| Auto-update | Self-managed: manifest → download → Authenticode verify → atomic swap → restart |
| Binary size | ~65–75 MB single file. Installer ~30 MB compressed. |
| Idle RAM | ~25–35 MB |
| Sidecar files | **Zero.** One signed `.exe` is the entire application. |

**Why not Electron.** It solves tray, window and auto-update in one toolchain and it is JavaScript,
which is the rest of the product. It loses on the two things that actually matter here:

- **250 MB idle RSS, on the machine that also runs Tally.** MIDC factory PCs are commonly 4–8 GB
  machines already running TallyPrime (200–500 MB) and a browser with Nexflow open (500 MB–1.5 GB).
  A quarter of a gigabyte for a queue processor is a visible cost the client will attribute to us,
  and Chromium's idle figure is a floor, not an average.
- **A Chromium instance on a client's accounting PC, maintained by a solo founder, is a standing
  liability.** The renderer would only ever load local, agent-authored HTML, which shrinks the
  real attack surface a great deal — but it does not shrink the *sentence* the founder has to say
  to a PVT LTD's IT contractor, and it makes the monthly security-update treadmill a compliance
  vendor's problem rather than a convenience.

A 90–150 MB installer carrying a browser engine to render a queue count is the wrong shape for
this artefact.

**Why not Node.js SEA (`pkg` is superseded).** Genuinely close, and it keeps the language uniform.
It loses on one structural fact: **SEA cannot embed native modules**, and this agent needs three
things Node cannot do alone — DPAPI, a tray icon, and Windows toast notifications. Each becomes a
sidecar file (`@primno/dpapi`'s `.node`, a tray helper binary, and either another native module or
a PowerShell shell-out). That produces:

- **three or four files to sign** instead of one, each an independent SmartScreen/AV reputation
  surface;
- **an atomic self-replace that is no longer atomic** — the updater must swap a set of files
  consistently, and a half-applied update on a factory PC with no IT staff is exactly the failure
  the support model cannot absorb;
- and the PowerShell alternative for DPAPI must be **ruled out entirely**: a signed background
  binary spawning `powershell.exe -EncodedCommand` is a textbook malware heuristic and would
  poison the certificate's reputation with endpoint-protection vendors.

Node SEA would also be a **four-step build** (esbuild → sea-config → postject → signtool) against
.NET's two (`dotnet publish` → signtool).

**Why not a Windows Service.** Already settled in `enterprise-strategy.md` §3.1 and the reasoning
holds: Tally only runs in an interactive logged-in session, so a `LocalSystem` service at 3 a.m.
cannot reach a Tally that is not running either. It buys nothing, needs admin rights to install on
a PC nobody administers, gives the owner no visible status, and cannot be restarted by a human
without `services.msc`.

**The wart, stated honestly.** .NET is a second language in a JavaScript codebase. This is
acceptable *only because of D3* — the agent holds roughly 800–1,200 lines of transport code with
no business logic, which will barely change after v1. If D3 is ever reversed, this decision must
be reopened with it. Second wart: single-file self-contained .NET extracts native libraries to a
temp directory on first run, which is itself a mild AV heuristic;
`EnableCompressionInSingleFile=false` and a valid signature mitigate it, and it is a known,
bounded issue rather than a surprise.

### D5 — Sync is **document-driven**, from `p2_invoices` and GRN groups only `[DECIDED]`

Full mapping in §4. The decision here is the negative one: **nothing is ever driven off
`p2_dispatch_orders`.** See §0 C2 for why. This is load-bearing and must not be optimised away.

### D6 — Tally reads are permitted for exactly four purposes `[DECIDED]`

The agent may issue `Export` requests to Tally for:

1. **Company list** — `<REPORTNAME>List of Companies</REPORTNAME>`. Which companies are loaded.
   Runs at the start of every cycle. `[UNVERIFIED — exact report name, §19 Q1]`
2. **Version and mode probe** — product name, release, licence/educational mode.
3. **Pre-flight duplicate scan** — a voucher export for one (company, period), used to detect
   human-typed duplicates and to reconcile REMOTEIDs. §11.
4. **Ledger name list** — `<REPORTNAME>List of Ledgers</REPORTNAME>`, **human-initiated only**,
   to populate the mapping picker. This is C4's narrow carve-out and it has hard bounds:
   - read-only, never on a schedule, only while the owner has the mapping screen open;
   - **names and parent groups only** — no balances, no addresses, no GSTINs, no transactions;
   - restricted to the parent groups a mapping can legally target: `Sundry Debtors`,
     `Sundry Creditors`, `Duties & Taxes`, `Sales Accounts`, `Purchase Accounts`,
     `Indirect Incomes`, `Indirect Expenses`;
   - **nothing is persisted to any Nexflow table except the specific values the owner picked**,
     which land in `p2_tally_targets.ledger_map` — a configuration field that already exists;
   - the list is held in agent memory for the duration of the screen and discarded.

**Everything else is `[NEVER]`.** No voucher data, no balances, no stock, no masters beyond the
above, no Day Book, nothing written to a Nexflow table. §18.

### D7 — Auth: one dedicated agent token against one Edge Function `[DECIDED]`

**Not the service role key.** A service-role key on a factory PC is a cross-tenant compromise
waiting for one stolen laptop. Non-negotiable.

**Not a per-tenant user JWT.** Supabase access tokens expire in 3600 s (`config.toml`
`jwt_expiry = 3600`), so the agent would have to hold a refresh token — which is
password-equivalent and long-lived — and it would bind the agent's life to one human's account,
which staff turnover deletes.

**Decision.** At pairing the server mints a random 32-byte secret, renders it as
`nxfa_<43-char base64url>`, returns it **once**, and stores only `sha256(token)` in
`p2_tally_targets.agent_token_hash`. The agent sends it as `Authorization: Bearer nxfa_…` to
**one** Edge Function, `tally-bridge` (`verify_jwt = false`), which hashes the presented token,
resolves it to exactly one target row — and, for the CA profile, to that CA's set of active grants
— and performs everything internally with `SB_SECRET_KEY`.

**The agent never holds a Supabase key of any kind. Not the service role key, not the anon key.**
It holds one opaque bearer token that is meaningless anywhere except at one function.

This is the direct application of `kpml-network-plan.md` §10.5's answer to RPC drift — *scope
cannot be forgotten if there is no other route* — and of `enterprise-strategy.md` §3.5's
guarantee 2. §7 has the full model, including what a stolen token can and cannot do.

### D8 — Credentials at rest: DPAPI `CurrentUser` `[DECIDED]`

Specified in §7.4. Summary: `ProtectedData.Protect(secret, entropy, DataProtectionScope.CurrentUser)`
with a versioned purpose entropy, written to `%LOCALAPPDATA%\Nexflow\Bridge\credentials.dat`, with
decryption failure routed to a re-pairing prompt and never to a crash.

### D9 — Update channel: Supabase Storage, staged per target `[DECIDED]`

**Not GitHub Releases.** Two reasons. First, it adds a second external hostname the agent must
reach, which breaks the one-line answer to *"what does this thing talk to"* (§7.6) and the
egress-firewall story a PVT LTD's IT contractor will ask for. Second, and more important, GitHub
Releases has no notion of *who* may take an update — and the ability to **pin one client to a
known-good version while a fix ships to everyone else** is the single most valuable support lever
this feature can have. That is a column on `p2_tally_targets`, and it only works if the update
check goes through Nexflow. §12.

### D10 — Installer: Inno Setup, per-user, no admin `[DECIDED]`

Specified in §13. Inno over NSIS because its Pascal scripting makes the first-run wizard and the
live Tally probe possible **inside the installer**, and because NSIS's decisive advantage is its
`electron-builder` integration, which D4 makes irrelevant.

---

## 4. Event → Voucher Mapping

The complete map. Nothing not in this table is ever posted.

| Nexflow source | Trigger | Filter | Tally voucher | `ACTION` | Doc code |
|---|---|---|---|---|---|
| `p2_invoices` | `status` flips `draft → sent` | — | **Sales** | `Create` | `SAL` |
| `p2_invoices` | any field of a `sent` invoice changes | — | **Sales** | `Alter` | `SAL` |
| `p2_invoices` | `status` flips to `cancelled` | period **after** `filed_through` | **Sales** + `<ISCANCELLED>Yes</ISCANCELLED>` | `Alter` | `SAL` |
| `p2_invoices` | `status` flips to `cancelled` | period **on or before** `filed_through` | **nothing** — row goes `blocked_period` | — | — |
| `p2_stock_transactions` | GRN confirmed | `transaction_type='grn'` **AND `owned_by IS NULL`**, grouped by `(supplier_id, normaliseInvoiceNo(invoice_no))` | **Purchase** | `Create` / `Alter` | `PUR` |
| `p2_clients` / `p2_suppliers` | first voucher referencing an unmapped party | — | **Ledger master** under `Sundry Debtors` / `Sundry Creditors` | `Create` | — |
| Credit notes *(Session 20, not built)* | note issued | — | **Credit Note** | `Create` | `CRN` |
| Debit notes *(Session 20, not built)* | note issued | — | **Debit Note** | `Create` | `DRN` |
| `p2_dispatch_orders` | — | — | **NOTHING, EVER** | — | — |
| `p2_payment_receipts` | — | — | deferred to v2 — §19 Q6 | — | — |
| `p2_supplier_advances` | — | — | deferred to v2 — §19 Q6 | — | — |

### 4.1 Two hard invariants

Inherited verbatim from `enterprise-strategy.md` §3.1. Violating either corrupts a real company's
statutory books.

**1. A GRN row with `owned_by IS NOT NULL` must NEVER become a Purchase voucher.**

Principal-owned free-issue material under s.143 has no supplier invoice, no purchase and no ITC.
Pushing it to Tally inflates purchases and claims input credit that does not exist. All three live
tenants are KPML job workers, so this is not a hypothetical.

Enforce it in **three** places, and add a regression test:

- in the query (`.is('owned_by', null)`);
- in the builder, as an assertion over the rows it received — `js/full-export.js:221-223` already
  does exactly this, throwing on `leaked.length`; copy that pattern;
- in `tally-bridge`'s enqueue path, as a final guard before the row is written.

**2. A job-work dispatch must never become a Sales voucher.**

Enforced for free by sourcing from `p2_invoices` rather than `p2_dispatch_orders` —
`SALE_INVOICEABLE_PURPOSES` already gates invoice creation to `sale` and
`direct_supply_from_jobworker`. §0 C2. Do not reopen it.

### 4.2 GRN grouping

One supplier invoice can span several `p2_stock_transactions` rows (a multi-material delivery).
**One supplier invoice becomes exactly one Purchase voucher.** Group by
`(supplier_id, normaliseInvoiceNo(invoice_no))` before building, where

```js
normaliseInvoiceNo = (s) => String(s || '').replace(/[\s\-\/]/g, '').toUpperCase()
```

byte-identical to `gstr2b-reconcile.html:299`, `grn.html`, and `js/full-export.js:73-75`. If this
function ever diverges between the Bridge Agent and GSTR-2B reconciliation, the two will disagree
about what counts as the same invoice and the reconciliation will silently stop matching vouchers
Nexflow itself posted.

Rows with no `supplier_id` or a blank `invoice_no` are **skipped, not guessed** — they go to
`status='skipped'` with `last_error = 'GRN rows have no supplier or no invoice number'`, and they
show on the Tally Sync panel so the owner can fix the GRN. Datta Prasad's August data contained
exactly one such orphan row (`CLAUDE.md`, Session 16 follow-up), so this path will fire on real
data in the first month.

### 4.3 Multi-rate purchase groups

One supplier invoice can mix materials taxed at different rates. **Emit one Purchase ledger and
one tax-ledger set per distinct `gst_rate` present**, not one pair for the whole voucher.
`js/full-export.js:398-419` already implements this; the server-side builder inherits it
unchanged. `enterprise-strategy.md` §3.1's example shows a single pair only because its example
invoice is single-rate.

### 4.4 The dependency on the GRN duplicate-invoice guard

`CLAUDE.md` Known Open Items #1 lists this as **blocking E1**, and it is correct to.

Today, a supplier invoice entered twice double-counts stock and double-claims ITC inside Nexflow.
With the Bridge Agent running it becomes **two Purchase vouchers in the client's real statutory
books** — except that it does not, and understanding why matters for scheduling.

Under §4.2, a duplicate entry of the same `(supplier_id, normalised invoice_no)` groups into the
**same** voucher and therefore produces the **same REMOTEID** (§6.2). Tally alters the existing
voucher in place rather than creating a second one. What lands in Tally is one voucher carrying
**double the correct amount** — which is worse than two vouchers, because two vouchers are visible
in the Day Book and one wrong amount is not.

**So the guard is still blocking, and for a sharper reason than the one recorded.** The Session 12
UI warning (`grn.html`, `checkDuplicateInvoice()`) is live and is the right guard. The DB backstop
partial unique index described in `CLAUDE.md` Known Open Items #1 —

```sql
UNIQUE (tenant_id, supplier_id, upper(regexp_replace(invoice_no,'[\s\-/]','','g')), raw_material_id)
  WHERE transaction_type = 'grn' AND invoice_no IS NOT NULL
```

— **must be applied before the first real Bridge Agent deployment**, because `scanner.html`'s
independent `confirmGRN()` path still has no duplicate check at all (`CLAUDE.md`, Session 12).

---

## 5. Voucher Format Specification

Every field, with worked examples using Datta Prasad Enterprises' real identity.

**Reference data used throughout §5.**

| | |
|---|---|
| Tenant | Datta Prasad Enterprises, `tenant_id = 3b68db90-a07c-491e-8913-c829ca969620` |
| Own GSTIN | `27CVZPS9110H1ZS` `[VERIFIED — CLAUDE.md]` |
| Own state | Maharashtra (GSTIN state code 27) |
| Tally company | `DATTA PRASAD ENTERPRISES` — **the exact `SVCURRENTCOMPANY` is per-install configuration and must never be inferred from `company_name`** (§14.4) |
| Client | KPML Pumps Pvt Ltd, GSTIN `27AAACK1234M1Z5` `[UNVERIFIED — illustrative only, carried over from enterprise-strategy.md §3.1. The real value is `p2_clients.gstin` and must be read from the row, never hardcoded. Confirmed as a deployment step in §17.5, not a §19 design question.]` |
| Job charge SAC | `998898` `[VERIFIED — CLAUDE.md: "Datta Prasad already uses SAC 998898 on all products correctly"]` |
| Invoice format | `INV-YYYYMM-NNN` |

### 5.1 The envelope

Identical to `js/full-export.js:317-336`, with one addition: the Bridge Agent posts **one voucher
per envelope**, not many.

**Why one per envelope, when `js/full-export.js` batches.** The full export produces a file for a
human to import once; a partial failure is acceptable because a human reads the result. The Bridge
Agent needs per-document status. `IMPORTRESULT` returns **aggregate** counters — `CREATED=8,
ERRORS=2` tells you nothing about *which* two, and `LINEERROR` does not reliably identify the
voucher. A batch would make every failure ambiguous and every retry a decision about which of
eight documents to re-send. One voucher per envelope costs one HTTP round trip per document on a
loopback interface, which is free, and makes every result unambiguous.

```xml
<ENVELOPE>
 <HEADER>
  <TALLYREQUEST>Import Data</TALLYREQUEST>
 </HEADER>
 <BODY>
  <IMPORTDATA>
   <REQUESTDESC>
    <REPORTNAME>Vouchers</REPORTNAME>
    <STATICVARIABLES>
     <SVCURRENTCOMPANY>DATTA PRASAD ENTERPRISES</SVCURRENTCOMPANY>
    </STATICVARIABLES>
   </REQUESTDESC>
   <REQUESTDATA>
    <TALLYMESSAGE xmlns:UDF="TallyUDF">
     <!-- exactly one VOUCHER -->
    </TALLYMESSAGE>
   </REQUESTDATA>
  </IMPORTDATA>
 </BODY>
</ENVELOPE>
```

`<REPORTNAME>All Masters</REPORTNAME>` replaces `Vouchers` for the party-ledger envelope (§5.6).

### 5.2 Sign convention — the rule everything else depends on

`[VERIFIED — Tally developer reference: "IsDeemedPositive … set to Yes if the amount should be
Debited and No if the amount should be credited"; and practitioner consensus: "All Credits will
have a positive amount and ISDEEMEDPOSITIVE of NO. Debits will be negative, and ISDEEMEDPOSITIVE
of YES."]`

| Accounting effect | `ISDEEMEDPOSITIVE` | `AMOUNT` sign |
|---|---|---|
| **Debit** | `Yes` | **negative** |
| **Credit** | `No` | **positive** |

**`sum(AMOUNT)` over every `ALLLEDGERENTRIES.LIST` in a voucher must be exactly `0.00`.**

Tally will accept an out-of-balance voucher, mark it internally, and **exclude it from the
financial statements** — silently. This is the highest-consequence silent failure in the protocol.
Asserted twice: server-side at render (§9.3) and in the agent before POST (§3 D3).

`js/full-export.js:270-273`'s `isBalanced()` uses a `< 0.01` tolerance. **The server-side builder
must keep that tolerance and must additionally push the residual into the round-off ledger rather
than tolerating it** — a voucher that is within a paisa of balanced is a voucher whose round-off
was computed wrong, and shipping it quietly re-creates the same silent failure one order of
magnitude smaller.

### 5.3 Sales voucher — worked example

Datta Prasad raises job-charge invoice `INV-202608-014` on KPML Pumps Pvt Ltd, 31 August 2026.
Taxable ₹1,00,000.00, intrastate, CGST 9% + SGST 9%, total ₹1,18,000.00, round off ₹0.00.

Source row: `p2_invoices` with `id = 9f2c41ab-7d53-4e08-b1c6-2a5f9e30d7c4`, `status = 'sent'`,
`gst_type = 'cgst_sgst'`, `invoice_date = '2026-08-31'`, `doc_category = 'services'`.

```xml
<TALLYMESSAGE xmlns:UDF="TallyUDF">
 <VOUCHER REMOTEID="NXF-3b68db90-SAL-1976b1814d62919b"
          VCHTYPE="Sales" ACTION="Create"
          OBJVIEW="Accounting Voucher View">
  <DATE>20260831</DATE>
  <EFFECTIVEDATE>20260831</EFFECTIVEDATE>
  <VOUCHERTYPENAME>Sales</VOUCHERTYPENAME>
  <VOUCHERNUMBER>INV-202608-014</VOUCHERNUMBER>
  <REFERENCE>INV-202608-014</REFERENCE>
  <REFERENCEDATE>20260831</REFERENCEDATE>
  <PARTYLEDGERNAME>KPML Pumps Pvt Ltd</PARTYLEDGERNAME>
  <PARTYNAME>KPML Pumps Pvt Ltd</PARTYNAME>
  <PARTYGSTIN>27AAACK1234M1Z5</PARTYGSTIN>
  <PLACEOFSUPPLY>Maharashtra</PLACEOFSUPPLY>
  <STATENAME>Maharashtra</STATENAME>
  <COUNTRYOFRESIDENCE>India</COUNTRYOFRESIDENCE>
  <GSTREGISTRATIONTYPE>Regular</GSTREGISTRATIONTYPE>
  <PERSISTEDVIEW>Accounting Voucher View</PERSISTEDVIEW>
  <NARRATION>Nexflow INV-202608-014 | src:NXF-3b68db90-SAL-1976b1814d62919b</NARRATION>

  <!-- Dr party : ISDEEMEDPOSITIVE Yes, AMOUNT negative -->
  <ALLLEDGERENTRIES.LIST>
   <LEDGERNAME>KPML Pumps Pvt Ltd</LEDGERNAME>
   <ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE>
   <ISPARTYLEDGER>Yes</ISPARTYLEDGER>
   <AMOUNT>-118000.00</AMOUNT>
  </ALLLEDGERENTRIES.LIST>

  <!-- Cr taxable value -->
  <ALLLEDGERENTRIES.LIST>
   <LEDGERNAME>Job Work Charges @ 18%</LEDGERNAME>
   <ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE>
   <AMOUNT>100000.00</AMOUNT>
  </ALLLEDGERENTRIES.LIST>

  <!-- Cr output tax -->
  <ALLLEDGERENTRIES.LIST>
   <LEDGERNAME>Output CGST</LEDGERNAME>
   <ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE>
   <AMOUNT>9000.00</AMOUNT>
  </ALLLEDGERENTRIES.LIST>
  <ALLLEDGERENTRIES.LIST>
   <LEDGERNAME>Output SGST</LEDGERNAME>
   <ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE>
   <AMOUNT>9000.00</AMOUNT>
  </ALLLEDGERENTRIES.LIST>

  <!-- Round off : emitted ONLY when p2_invoices.round_off != 0 -->
 </VOUCHER>
</TALLYMESSAGE>
```

`-118000.00 + 100000.00 + 9000.00 + 9000.00 = 0.00`. ✅

**Interstate variant.** `gst_type = 'igst'` replaces the two half-tax entries with one
`Output IGST` at the full amount, and `PLACEOFSUPPLY` becomes the state derived from the
**client's** GSTIN via `gstinStateName()` (`js/full-export.js:77-80`) rather than the tenant's own
state. `js/full-export.js:366` already encodes this: `placeOfSupply = (gst_type === 'igst' ?
gstinStateName(client_gstin) : '') || 'Maharashtra'`.

> `[CORRECTION]` **The `|| 'Maharashtra'` fallback in `js/full-export.js:366` and the hardcoded
> `stateName: 'Maharashtra'` at `:367` are wrong for any tenant outside Maharashtra.** They are
> harmless today because all four tenants are Maharashtra, and `full-export.js` is a one-shot
> export. The Bridge Agent writes continuously into statutory books, so it must derive the
> tenant's own state from `p2_tenant_settings.gstin`'s first two characters via the same
> `GST_STATE_CODES` map, and fail the row rather than default. Fix it in the shared builder, and
> fix `full-export.js` in the same change so the two cannot diverge.

**Ledger selection for the taxable line.** From `p2_tally_targets.ledger_map`, keyed by
`p2_invoices.doc_category`:

| `doc_category` | `ledger_map` key | Datta Prasad's value |
|---|---|---|
| `services` | `sales_taxable` | `Job Work Charges @ 18%` |
| `goods` | `sales_goods` | `Sales @ 18%` |

`deriveDocCategory()` in `agent-query/index.ts` already sets `doc_category` to `services` when
every covered order is job-work/`bom_issue` and `goods` otherwise (`CLAUDE.md`, Shipped Sept 2
2026). The Bridge Agent reads the stored value; it never re-derives it.

**Cancellation.** `ACTION="Alter"`, same `REMOTEID`, plus `<ISCANCELLED>Yes</ISCANCELLED>`. A
cancelled voucher in Tally retains its number — which is correct, and is what Rule 56(7) and
GSTR-1 Table 13 both expect. `[UNVERIFIED — the exact cancellation tag, §19 Q4]`

### 5.4 Purchase voucher — worked example

Datta Prasad receives supplier invoice `TSL/2608/0142` from Tata Steel on 14 August 2026, recorded
as three `p2_stock_transactions` GRN rows sharing one `grn_no`. Two materials at 18%
(₹60,000 + ₹25,000) and one at 12% (₹15,000). Intrastate. `owned_by IS NULL` on all three.

Group key: `c81e4a6d-9f02-4b77-8e13-6d40ab92f7e5|TSL26080142`
(`supplier_id` + `|` + `normaliseInvoiceNo('TSL/2608/0142')`).

| Rate | Taxable | CGST 1/2 | SGST 1/2 | Line total |
|---|---|---|---|---|
| 18% | 85,000.00 | 7,650.00 | 7,650.00 | 1,00,300.00 |
| 12% | 15,000.00 | 900.00 | 900.00 | 16,800.00 |
| | **1,00,000.00** | **8,550.00** | **8,550.00** | **1,17,100.00** |

```xml
<TALLYMESSAGE xmlns:UDF="TallyUDF">
 <VOUCHER REMOTEID="NXF-3b68db90-PUR-318cde6503753add"
          VCHTYPE="Purchase" ACTION="Create"
          OBJVIEW="Accounting Voucher View">
  <DATE>20260814</DATE>
  <EFFECTIVEDATE>20260814</EFFECTIVEDATE>
  <VOUCHERTYPENAME>Purchase</VOUCHERTYPENAME>
  <VOUCHERNUMBER>TSL/2608/0142</VOUCHERNUMBER>
  <REFERENCE>TSL/2608/0142</REFERENCE>
  <REFERENCEDATE>20260814</REFERENCEDATE>
  <PARTYLEDGERNAME>Tata Steel Limited</PARTYLEDGERNAME>
  <PARTYNAME>Tata Steel Limited</PARTYNAME>
  <PARTYGSTIN>27AAACT2803M1ZG</PARTYGSTIN>
  <PLACEOFSUPPLY>Maharashtra</PLACEOFSUPPLY>
  <STATENAME>Maharashtra</STATENAME>
  <COUNTRYOFRESIDENCE>India</COUNTRYOFRESIDENCE>
  <GSTREGISTRATIONTYPE>Regular</GSTREGISTRATIONTYPE>
  <PERSISTEDVIEW>Accounting Voucher View</PERSISTEDVIEW>
  <NARRATION>Nexflow GRN TSL/2608/0142 | src:NXF-3b68db90-PUR-318cde6503753add</NARRATION>

  <!-- Dr purchase, one pair per distinct GST rate present -->
  <ALLLEDGERENTRIES.LIST>
   <LEDGERNAME>Purchase @ 18%</LEDGERNAME>
   <ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE>
   <AMOUNT>-85000.00</AMOUNT>
  </ALLLEDGERENTRIES.LIST>
  <ALLLEDGERENTRIES.LIST>
   <LEDGERNAME>Input CGST</LEDGERNAME>
   <ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE>
   <AMOUNT>-7650.00</AMOUNT>
  </ALLLEDGERENTRIES.LIST>
  <ALLLEDGERENTRIES.LIST>
   <LEDGERNAME>Input SGST</LEDGERNAME>
   <ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE>
   <AMOUNT>-7650.00</AMOUNT>
  </ALLLEDGERENTRIES.LIST>

  <ALLLEDGERENTRIES.LIST>
   <LEDGERNAME>Purchase @ 12%</LEDGERNAME>
   <ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE>
   <AMOUNT>-15000.00</AMOUNT>
  </ALLLEDGERENTRIES.LIST>
  <ALLLEDGERENTRIES.LIST>
   <LEDGERNAME>Input CGST</LEDGERNAME>
   <ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE>
   <AMOUNT>-900.00</AMOUNT>
  </ALLLEDGERENTRIES.LIST>
  <ALLLEDGERENTRIES.LIST>
   <LEDGERNAME>Input SGST</LEDGERNAME>
   <ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE>
   <AMOUNT>-900.00</AMOUNT>
  </ALLLEDGERENTRIES.LIST>

  <!-- Cr supplier -->
  <ALLLEDGERENTRIES.LIST>
   <LEDGERNAME>Tata Steel Limited</LEDGERNAME>
   <ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE>
   <ISPARTYLEDGER>Yes</ISPARTYLEDGER>
   <AMOUNT>117100.00</AMOUNT>
  </ALLLEDGERENTRIES.LIST>
 </VOUCHER>
</TALLYMESSAGE>
```

`-85000 - 7650 - 7650 - 15000 - 900 - 900 + 117100 = 0.00`. ✅

**Notes, all inherited from `js/full-export.js:376-435`:**

- **Purchase ledger names are rate-derived**, `` `Purchase @ ${rate}%` ``, not taken from
  `ledger_map`. `ledger_map.purchase` exists as a *default* for the single-rate case and as the
  fallback when `gst_rate` is null on the material. A client whose chart of accounts names them
  differently maps each rate explicitly — the mapping UI enumerates the distinct rates actually
  present in that tenant's materials and asks for one ledger per rate (§13.3).
- **Taxable value is `quantity × rate`** from the GRN row. There is no amount column on
  `p2_stock_transactions` (`CLAUDE.md`, GSTR-2B section). The `rate` column is the GRN-specific
  paid rate, **not** the valuation rate from `p2_material_prices`.
- **The GST rate comes from `p2_raw_materials.gst_rate`**, per material, and a null rate means 0%.
  Datta Prasad has 15 GRN lines recorded at 0% against identical 18% goods (`CLAUDE.md`, Session 16
  follow-up). Those will post as 0% purchases with no ITC — **correctly reflecting what Nexflow
  holds, which is wrong data.** The Bridge Agent must not silently "fix" it. It emits an
  `important` ops alert (§15.13) naming the invoice numbers, because a 0%-rate purchase against
  18% goods is exactly the kind of error the Opus covering note already catches monthly and it now
  has a second, earlier detector.
- **Interstate** (`purchase_type = 'interstate'`) replaces the two half-tax entries with a single
  `Input IGST` at the full rate, per rate group.
- **`DATE` is the earliest `transaction_date` in the group.** `js/full-export.js:421` does this.
  It is the right choice: a multi-day delivery under one invoice is one purchase, dated when it
  started.

### 5.5 Credit and Debit notes — handler present, source absent `[DECIDED]`

Nexflow has no credit/debit note feature (`CLAUDE.md` Backlog; `enterprise-strategy.md` §9 Q10
flags it as the one backlog item with an Enterprise dependency).

**Build the handler anyway, in Session 18, with the source table absent.** The envelope, the
`ACTION`/`VCHTYPE` mapping, the doc codes `CRN`/`DRN`, the REMOTEID derivation and the sync-log
`doc_type` CHECK constraint all ship in v1. When Session 20 adds the feature, the Bridge Agent
lights up with a query change and no new design.

| | Credit Note | Debit Note |
|---|---|---|
| `VCHTYPE` / `VOUCHERTYPENAME` | `Credit Note` | `Debit Note` |
| Party ledger under | `Sundry Debtors` | `Sundry Creditors` |
| Party side | **Credit** (`ISDEEMEDPOSITIVE=No`, positive) | **Debit** (`Yes`, negative) |
| Contra ledger | `ledger_map.sales_taxable` / `sales_goods` | rate-derived `Purchase @ n%` |
| Tax ledgers | `Output CGST/SGST/IGST` | `Input CGST/SGST/IGST` |
| Signs | exactly reversed from the Sales voucher | exactly reversed from the Purchase voucher |

A note must carry `<REFERENCE>` pointing at the original document number — that is what makes it
reportable in GSTR-1 `cdnr`. Do not omit it.

### 5.6 Party ledger creation

The agent creates **party ledgers only**. It never creates or alters a sales, purchase, tax,
round-off or any other ledger. `[DECIDED — enterprise-strategy.md §3.1; §9 Q6 recommends keeping
it strict and this document agrees]` Guessing at a CA's chart of accounts is how you corrupt
somebody's books, and the damage is not visible until the trial balance is wrong.

```xml
<ENVELOPE>
 <HEADER><TALLYREQUEST>Import Data</TALLYREQUEST></HEADER>
 <BODY><IMPORTDATA>
  <REQUESTDESC>
   <REPORTNAME>All Masters</REPORTNAME>
   <STATICVARIABLES>
    <SVCURRENTCOMPANY>DATTA PRASAD ENTERPRISES</SVCURRENTCOMPANY>
   </STATICVARIABLES>
  </REQUESTDESC>
  <REQUESTDATA>
   <TALLYMESSAGE xmlns:UDF="TallyUDF">
    <LEDGER NAME="KPML Pumps Pvt Ltd" ACTION="Create">
     <NAME>KPML Pumps Pvt Ltd</NAME>
     <PARENT>Sundry Debtors</PARENT>
     <ISBILLWISEON>Yes</ISBILLWISEON>
     <PARTYGSTIN>27AAACK1234M1Z5</PARTYGSTIN>
     <GSTREGISTRATIONTYPE>Regular</GSTREGISTRATIONTYPE>
     <COUNTRYNAME>India</COUNTRYNAME>
     <LEDSTATENAME>Maharashtra</LEDSTATENAME>
    </LEDGER>
   </TALLYMESSAGE>
  </REQUESTDATA>
 </IMPORTDATA></BODY>
</ENVELOPE>
```

`PARENT` is `ledger_map.debtors_parent` for a client and `ledger_map.creditors_parent` for a
supplier — configurable because CAs commonly use sub-groups like `Sundry Debtors - Local`.

**Ordering.** A party ledger must exist before the voucher that references it, or the voucher fails
with *"Ledger Name 'X' does not exist!"*. The agent therefore posts the ledger envelope **first**,
in the same cycle, and only posts the voucher if the ledger envelope succeeded. Both are recorded
on the same sync-log row (`party_ledger_created_at`), so the ledger is attempted once per party per
target and never again.

**`ACTION="Create"` on an existing ledger.** Tally treats it as a no-op or an alter depending on
build. **Do not rely on either.** The agent asks Tally for the ledger list first (§3 D6 purpose 4,
which this makes a fifth, automated purpose — bounded identically: names only, no persistence) and
skips the create if the name is already present. `[UNVERIFIED — §19 Q5]`

### 5.7 Field reference

| Tag | Value | Rule |
|---|---|---|
| `REMOTEID` | §6 | Attribute on `<VOUCHER>`. Permanent, never regenerated. |
| `VCHTYPE` | `Sales` \| `Purchase` \| `Credit Note` \| `Debit Note` | **Case-sensitive.** Must match a voucher type that exists in the company. |
| `ACTION` | `Create` \| `Alter` | `Alter` on any re-send of a document already `sent`. |
| `OBJVIEW` | `Accounting Voucher View` | Fixed. Never `Invoice Voucher View` — that view expects inventory. |
| `DATE`, `EFFECTIVEDATE`, `REFERENCEDATE` | `YYYYMMDD` | No separators. `ymd()` in `js/full-export.js:98-100`. All three equal. |
| `VOUCHERNUMBER` | `p2_invoices.invoice_number`, or the supplier's `invoice_no` verbatim | Never normalised. The normalisation is for **grouping and matching only**; the document number that reaches Tally is the one printed on the paper. |
| `REFERENCE` | same as `VOUCHERNUMBER` | |
| `PARTYLEDGERNAME`, `PARTYNAME` | `p2_invoices.client_name` (frozen snapshot) / `p2_suppliers.name` | Must equal the party ledger name exactly. |
| `PARTYGSTIN` | `p2_invoices.client_gstin` / `p2_suppliers.gstin` | Empty string if absent — never `null`, never omitted. |
| `PLACEOFSUPPLY` | tenant's own state, **except** IGST → the counterparty's state from their GSTIN | See the §5.3 correction. |
| `STATENAME` | tenant's own state, derived from `p2_tenant_settings.gstin[0:2]` | **Not hardcoded.** See the §5.3 correction. |
| `COUNTRYOFRESIDENCE` | `India` | Fixed. |
| `GSTREGISTRATIONTYPE` | `Regular` | Fixed for v1. A composition or unregistered counterparty is out of scope until a client has one. |
| `PERSISTEDVIEW` | `Accounting Voucher View` | |
| `NARRATION` | `Nexflow <docno> \| src:<REMOTEID>` | See §5.7.1. |
| `AMOUNT` | `toFixed(2)`, sign per §5.2 | Plain decimal. No thousands separators, no currency symbol, no `₹`. |
| `LEDGERNAME` | from `ledger_map`, or rate-derived for purchases | Never invented. |
| `ISPARTYLEDGER` | `Yes` on the party entry only | Omitted elsewhere. |

#### 5.7.1 Narration

**Format:** `Nexflow <document number> | src:<REMOTEID>`

Three rules:

1. **The `src:` fragment is mandatory and is a recovery mechanism, not decoration.** If a client's
   Tally is restored from a backup that predates the REMOTEID index, or if the F12 overwrite
   setting turns out to behave differently than expected (§19 Q2), the narration is the only
   remaining way to identify a Nexflow-originated voucher from inside Tally. A CA can search the
   Day Book for `src:NXF-` and see exactly what Nexflow put there.
2. **ASCII only.** Tally mangles `₹`, curly quotes and other non-Windows-1252 characters into
   literal `?` on the wire, unrecoverably `[VERIFIED]`. Strip to ASCII and XML-escape with the
   same `xmlEscape()` as `js/full-export.js:94-96`.
3. **Never put client-identifying commentary in it beyond the document number.** For the CA
   profile this is the difference between a narration and a leak (§14.5).

`js/full-export.js:368` currently emits `` `Nexflow ${invoice_number} | src:${remoteId}` `` — the
same shape. `enterprise-strategy.md` §3.1's example additionally lists the covered challan numbers
(`| challans 1041,1042 |`). **Drop that.** On a consolidated invoice it is unbounded, and a
narration is not a place to put a list.

### 5.8 Parity with `js/full-export.js`

The Bridge Agent's voucher **body** must be byte-identical to what `js/full-export.js` produces
for the same document, except for `REMOTEID` and the two corrections noted in §5.3. This matters
because the full export is the artefact a CA has already seen, and because §4 of
`enterprise-strategy.md` promises clients the export is *loadable into the Tally they already own*
— a promise that is only true if the two agree.

**Enforce it mechanically.** The shared builder lives in
`supabase/functions/_shared/tally-voucher.ts` and is the only implementation. `js/full-export.js`
is refactored in Session 18 to call the *same logic*, shipped as a browser-loadable file generated
from the same source — or, if that proves impractical without a build step (this codebase has
none), then a **regression test compares their output** on a fixed fixture set and fails the
session if they diverge. The test is not optional; it is the thing that keeps the promise true.

**Divergences that are deliberate and must be preserved:**

| | `js/full-export.js` | Bridge Agent |
|---|---|---|
| `REMOTEID` | FNV-1a, `nexflow-…` | SHA-256, `NXF-…` (§6) |
| Vouchers per envelope | many | **one** (§5.1) |
| Scope | current FY, one shot | one document, continuously |
| Unbalanced voucher | skipped, counted in README | **never enqueued**; row goes `invalid_payload` |
| `STATENAME` | hardcoded `Maharashtra` | derived from tenant GSTIN — **fix both** |

### 5.9 Parsing the response

**Success is `ERRORS == 0` AND `(CREATED + ALTERED) >= 1`. Nothing else.**

- **HTTP 200 is not success.** Tally returns 200 on failure too.
- **`IGNORED > 0` is a failure** for our purposes — the voucher did not land.
- **`CREATED + ALTERED == 0` with `ERRORS == 0` is a failure**, and it is the specific signature
  of an `SVCURRENTCOMPANY` mismatch. It gets its own failure class and its own message (§10.3).

**Parse tolerantly.** Two response shapes circulate and Tally's output is not reliably
well-formed UTF-8 `[VERIFIED]`. Decode the body as latin-1, then extract each counter by a
case-insensitive regex on its tag name anywhere in the body:

```
CREATED, ALTERED, DELETED, LASTVCHID, LASTMID, COMBINED, IGNORED, ERRORS, LINEERROR
```

A missing counter is treated as `0`; a missing `ERRORS` tag with no `CREATED`/`ALTERED` is a
parse failure, classified `transient`. **Never fail a voucher because an XML parser rejected
Tally's own output.**

`LINEERROR`, when present, is stored **verbatim and untruncated** in `last_error`. It is the only
diagnostic a client will ever have, and the temptation to tidy it must be resisted — the panel
shows a plain-English line *above* it, never *instead of* it (§10.5).

Store `LASTVCHID` in `tally_vch_id`. It is the handle a CA can use to find the voucher.

---

## 6. REMOTEID — the idempotency key

`CLAUDE.md:2162` explicitly flags that `js/full-export.js` uses a placeholder. This section
specifies the permanent scheme.

### 6.1 Requirements

| Requirement | Why |
|---|---|
| **Unique per voucher per tenant** | A collision overwrites a real voucher with a different one. In the CA profile, across tenants. |
| **Stable** | The same document must always produce the same id, so a re-sync alters rather than duplicates. |
| **Deterministic** | Derivable from data already on the row. Never stored as the source of truth, never random, never sequence-allocated. A stored random id is lost with the row and cannot be recomputed during recovery. |
| **Survives corrections** | Changing an invoice's date, amount or client must not change its id — it is the same document. |
| **Survives a Nexflow-side restore** | Recomputable from a CSV export of `p2_invoices`, with no Nexflow service running. |
| **ASCII, no spaces, bounded length** | It is an XML attribute value Tally indexes. |

### 6.2 The formula `[DECIDED]`

```
REMOTEID = "NXF-" + tenant8 + "-" + doc + "-" + sk16
```

| Part | Definition | Length |
|---|---|---|
| `NXF-` | Literal namespace prefix, uppercase. Makes a Nexflow voucher greppable inside Tally. | 4 |
| `tenant8` | First 8 characters of `tenant_id`, **lowercase, hyphens removed** | 8 |
| `doc` | `SAL` \| `PUR` \| `CRN` \| `DRN` — fixed three-letter document class, uppercase | 3 |
| `sk16` | First **16 hex characters** (64 bits) of `SHA-256(canonical_source_string)`, lowercase | 16 |
| separators | three literal `-` | 3 |
| | **Total** | **33** |

**The canonical source string, exactly:**

```
nexflow.tally.v1|<tenant_id>|<doc>|<source_key>
```

- `<tenant_id>` — the **full** UUID, lowercase, **with** hyphens
- `<doc>` — the same three-letter code as above, uppercase
- `<source_key>` — per document class:

| Doc | `source_key` |
|---|---|
| `SAL` | `p2_invoices.id`, lowercase UUID with hyphens |
| `CRN` / `DRN` | the credit/debit-note row's `id`, lowercase UUID with hyphens |
| `PUR` | `<supplier_id lowercase UUID with hyphens>` + `\|` + `normaliseInvoiceNo(invoice_no)` |

`|` is a literal pipe. No spaces anywhere. Hash the **UTF-8 bytes**.

```ts
// supabase/functions/_shared/tally-remoteid.ts — the ONLY implementation.
export type TallyDocCode = 'SAL' | 'PUR' | 'CRN' | 'DRN'

export async function buildRemoteId(
  tenantId: string, doc: TallyDocCode, sourceKey: string
): Promise<string> {
  const canonical = `nexflow.tally.v1|${tenantId.toLowerCase()}|${doc}|${sourceKey}`
  const bytes = new TextEncoder().encode(canonical)
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  const hex = [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('')
  const tenant8 = tenantId.toLowerCase().replace(/-/g, '').slice(0, 8)
  return `NXF-${tenant8}-${doc}-${hex.slice(0, 16)}`
}
```

### 6.3 Worked examples — verifiable

Computed 11 September 2026. A future session can reproduce these with
`node -e "console.log(require('crypto').createHash('sha256').update(S).digest('hex'))"`.

**Sales — Datta Prasad, invoice `INV-202608-014`**

```
canonical : nexflow.tally.v1|3b68db90-a07c-491e-8913-c829ca969620|SAL|9f2c41ab-7d53-4e08-b1c6-2a5f9e30d7c4
sha256    : 1976b1814d62919b29b4c39e71705c499d214b5cf9a8bf6e30aff6762cd78a5f
REMOTEID  : NXF-3b68db90-SAL-1976b1814d62919b
```

**Purchase — Datta Prasad, Tata Steel invoice `TSL/2608/0142`**

```
canonical : nexflow.tally.v1|3b68db90-a07c-491e-8913-c829ca969620|PUR|c81e4a6d-9f02-4b77-8e13-6d40ab92f7e5|TSL26080142
sha256    : 318cde6503753addf754f80b542eeb85333c8a290197db52098d161b3cf6f89a
REMOTEID  : NXF-3b68db90-PUR-318cde6503753add
```

**Credit note — Datta Prasad, note id `5d7e1f80-3c94-41a2-9b6e-08f27c15ae33`**

```
REMOTEID  : NXF-3b68db90-CRN-66b2f31f2a689f04
```

### 6.4 Design rationale — every clause justified

**Why SHA-256 and not FNV-1a (which `js/full-export.js` uses).**
FNV-1a-32 has a 32-bit output. The birthday bound is `√(2 · 2³² · ln2) ≈ 77,000` — a 50% chance of
at least one collision at ~77,000 documents in one namespace. A ten-year-old PVT LTD with 200
invoices and 300 purchase vouchers a month reaches 60,000 documents. **That is not a theoretical
risk; it is a scheduled one.** A collision means one voucher silently overwrites a different
voucher in a statutory book. SHA-256 truncated to 64 bits gives a birthday bound of ~5 × 10⁹,
which is unreachable for the life of the product.

FNV-1a was the right call in `full-export.js` — `crypto.subtle` is async and the export's
synchronous loop would have needed restructuring (the file says so at `:256-266`). The Edge
Function is already async, so the constraint does not exist server-side.

**Why the full `tenant_id` is inside the hash as well as in the prefix.**
`tenant8` is only 32 bits of the tenant UUID, so two tenants can share it. Including the full
UUID in the hashed string means even a prefix collision yields different ids. This matters
enormously in the CA profile, where one agent posts many tenants' vouchers from one machine, and
where Tally overrides a matching voucher **across companies regardless of the F12 setting**
`[VERIFIED, §2.2]`. A cross-tenant REMOTEID collision there would overwrite one client's voucher
with another client's — the single worst outcome the product can produce. Belt and braces.

**Why `nexflow.tally.v1` is in the string.**
It versions the derivation. If the scheme ever must change, `v2` produces different ids and the
migration becomes an explicit, adoptable event (§6.5) rather than a silent duplication.

**Why lowercase hex and a lowercase tenant prefix.**
Tally's matching semantics on REMOTEID case are unverified. Normalising to one case removes the
question entirely and makes the id stable across any casing accident in a restore or a CSV round
trip.

**Why the date is not in the source key.**
An owner correcting an invoice date must produce an `Alter`, not a second voucher. Same for the
amount, the client, the ledger map, and every other mutable field. **The source key contains only
document identity, never document content.**

**Why the purchase key is `(supplier_id, normalised invoice_no)` and not the GRN row ids.**
Adding a material line to an existing GRN changes the row set but not the supplier invoice. If
the key included row ids, adding a line would mint a new REMOTEID and create a second Purchase
voucher for one supplier invoice. Keying on the invoice's identity means adding a line re-renders
the **same** REMOTEID with a larger amount, Tally alters in place, and the books are right.

**Why not `p2_stock_transactions.grn_no`.**
A GRN number is a Nexflow-side batch identifier. One supplier invoice can legitimately span two
GRN batches (a split delivery entered on two days), which must still be one Purchase voucher;
and `scanner.html` allocates its own GRN numbers on an independent path. The supplier invoice is
the accounting document; the GRN number is not.

**Why 16 hex characters and not 32 or the full digest.**
64 bits is enough (above), and shorter ids are easier for a human to compare on a support call.
Tally's REMOTEID length limit is not documented; its own remote GUIDs are ~40 characters, so 33
is comfortably inside anything plausible. `[UNVERIFIED — §19 Q7]`

### 6.5 The legacy adoption path — fixing the `full-export.js` overlap

This is C5's remedy and it must be built in Session 18, not deferred.

**The legacy id, for reference**, from `js/full-export.js:246-267`:

```
nexflow-<tenant_id first 8, hyphens KEPT>-<inv|pur>-<fnv1a32(source_key) first 8>
```

For the two examples above:

```
NXF-3b68db90-SAL-1976b1814d62919b   ← canonical
nexflow-3b68db90-inv-243654fe       ← legacy, same invoice

NXF-3b68db90-PUR-318cde6503753add   ← canonical
nexflow-3b68db90-pur-05da44fa       ← legacy, same purchase
```

Note the legacy doc codes are `inv` / `pur`, not `SAL` / `PUR`, and the legacy prefix keeps the
tenant UUID's hyphens where the canonical form strips them. Both differences are deliberate in
the canonical scheme — they make a legacy id and a canonical id impossible to confuse, by eye or
by regex.

**The mechanism.**

1. At enqueue, `tally-bridge` computes **both** ids and stores them: `remote_id` (canonical) and
   `legacy_remote_id`.
2. The pre-flight scan for a (company, period) — §11.2 — reads back the vouchers already in Tally
   for that date range and collects every REMOTEID present.
3. For each pending row, three cases:
   - **Canonical id already present** → the document is already in Tally under our scheme. Set
     `status='sent'`, `remote_id_source='canonical'`. No post.
   - **Legacy id present, canonical absent** → the client imported `vouchers-FY….xml` by hand.
     **Adopt it.** Set `remote_id_source='adopted_legacy'`; every future post for this row uses
     `legacy_remote_id` as the `REMOTEID`, permanently. Re-render the XML with the legacy id and
     `ACTION="Alter"`. **Zero duplicates. The client never had to read a README.**
   - **Neither present** → normal `Create`.
4. `remote_id_source` is **immutable once set.** A row that adopted a legacy id keeps it for the
   life of the document. Switching back would mint a duplicate — which is the entire problem.

**Also detect the third case: a voucher with the same `VOUCHERNUMBER` and no Nexflow REMOTEID at
all.** That is a human-typed duplicate, not a legacy import. It goes to `status='conflict'` and is
never overwritten — §11.3.

### 6.6 Hard rules

1. **`remote_id` is written once at enqueue and is never recomputed.** It is stored on the row so
   that a later change to the derivation code cannot silently re-address an existing voucher. The
   formula's determinism is for *recovery*, not for *runtime*.
2. **There is exactly one implementation**, `supabase/functions/_shared/tally-remoteid.ts`. The
   agent never computes a REMOTEID; it reads one.
3. **Never regenerate on retry, on re-render, on a ledger-map change, or on an agent upgrade.**
4. **`js/full-export.js` is not changed to use the canonical scheme.** Leave it on FNV-1a. The
   adoption path makes that harmless, and changing it would orphan every export already delivered
   to a client. **Update its README wording instead** to say the Bridge Agent will recognise and
   adopt these vouchers rather than duplicating them — the current warning is now false and a
   false warning is worse than none.

---

## 7. Credential and Security Model

### 7.1 Threat model

What the design is defending against, in order of likelihood.

| Threat | Defence |
|---|---|
| **The factory PC is stolen, or an ex-employee keeps a copy** | DPAPI ties the ciphertext to that Windows user on that machine. One-click revoke in Settings invalidates the token server-side regardless. §7.5. |
| **The config file is emailed to the founder for troubleshooting** | Secrets are DPAPI-encrypted; the file is useless off the machine. Non-secret config (host, port, company name) is deliberately left in plaintext so troubleshooting stays possible. |
| **Another *user* on the same shared PC reads the config** | DPAPI `CurrentUser`, not `LocalMachine`. |
| **Malware running as the same Windows user** | **Not defended.** DPAPI cannot defend this and no client-side store can. The mitigation is blast radius: §7.5 shows a stolen token reaches almost nothing. |
| **Port 9000 reachable from the LAN or internet** | The agent never asks for a port-forward and never binds a listener. §7.6. The installer actively warns if Tally's gateway is bound to `0.0.0.0`. |
| **A CA's agent reaching a client that did not consent** | One scoped access path, grant-resolved server-side. §14.5. |
| **A compromised update channel** | Authenticode verification of the downloaded binary plus a SHA-256 match against the manifest, before the swap. §12.3. |

### 7.2 Pairing

The agent must never hold the tenant's password, and no human ever types a token.

1. **Owner** opens Settings → Tally Sync → *"Connect a Bridge Agent"*.
2. Server generates an 8-character pairing code from an unambiguous alphabet
   (`ABCDEFGHJKLMNPQRSTUVWXYZ23456789` — no `I`, `O`, `0`, `1`), stores
   `pairing_code_hash` and `pairing_code_expires_at = now() + 15 minutes`, single use.
   This mirrors the existing `telegram_bind_token` + `telegram_bind_token_expires_at` pattern —
   including the expiry, which was a Session 6 fix to that flow and must not be re-omitted here.
3. **Agent** first-run wizard asks for the code.
4. Agent POSTs `{ mode: 'pair', code, machine_name, agent_version, os_version }` to `tally-bridge`.
5. Server validates, mints a 32-byte random token → `nxfa_<base64url>`, stores **only**
   `sha256(token)` in `p2_tally_targets.agent_token_hash`, clears the pairing code, and returns
   the token **once**.
6. Agent DPAPI-encrypts it and writes `credentials.dat`. The plaintext never touches disk and is
   never logged.

**One `factory` target per tenant, enforced by `UNIQUE (tenant_id, target)`.** Two accountants'
PCs both running an agent against the same company would race and double-post; the pairing flow
prevents it by construction — a second pairing on an already-paired target **rotates** the token
and invalidates the first, with an explicit *"This will disconnect the agent on `DESKTOP-XYZ`"*
confirmation naming the existing machine.

### 7.3 The agent token

| Property | Value |
|---|---|
| Format | `nxfa_` + 43 characters base64url (32 random bytes) |
| Stored server-side as | `sha256(token)` hex. **The plaintext is never stored and cannot be recovered.** |
| Scope | One `p2_tally_targets` row. For `target='ca'`, that row plus its active `p2_ca_grants`. |
| Expiry | None. Revocation is explicit, not time-based — a background agent that silently stops at 90 days is a support incident disguised as a security feature. |
| Rotation | One click in Settings. Rotating invalidates the old token immediately. |
| Transport | `Authorization: Bearer nxfa_…`, HTTPS only, to exactly one Edge Function. |

**What the token can do.** Only what `tally-bridge` implements: claim queued rows for its own
target, report a result on a row it claimed, update its own heartbeat and version, read its own
`ledger_map` and `company_name`, and — CA profile only — list the grants that name it.

**What the token cannot do.** Read `p2_stock_transactions`, `p2_raw_materials`, `p2_products`,
`p2_product_bom`, `p2_material_prices`, `p2_clients`, `p2_suppliers`, stock balances, WIP, s.143
clocks, challan internals, or **any other tenant's anything**. It cannot write to any business
table. It cannot create, modify or read a user. It is not a Supabase credential and presenting it
anywhere else in Supabase does nothing.

### 7.4 Credential storage on Windows

```
%LOCALAPPDATA%\Nexflow\Bridge\
    credentials.dat      DPAPI ciphertext. The agent token, and nothing else.
    config.json          PLAINTEXT, deliberately. host, port, company_name,
                         target_id, poll_interval, log_level, last_known_version.
    journal\             append-only JSONL post journal (§10.6)
    logs\                rolling text logs, 14 days, secrets never logged
    manual-import\       recovery XML (§3 D1)
```

```csharp
// Protect
byte[] entropy = Encoding.UTF8.GetBytes("NexflowBridge:AgentToken:v1");
byte[] blob = ProtectedData.Protect(
    Encoding.UTF8.GetBytes(token), entropy, DataProtectionScope.CurrentUser);
File.WriteAllBytes(credentialsPath, blob);
```

Five rules, each from a specific research finding (§2.5):

1. **`CurrentUser`, never `LocalMachine`.** `LocalMachine` is decryptable by *any* process on the
   PC. A factory PC is often shared.
2. **The entropy is purpose separation, not a key.** `"NexflowBridge:AgentToken:v1"` is a constant
   in the binary and is not secret. Its job is to make ciphertext written for one purpose
   unusable for another, and to version the format.
3. **Per-user path only.** Never the install directory (which may be `Program Files` and
   world-readable), never a network share, never `%TEMP%`.
4. **Decryption failure is a re-pair prompt, never a crash and never a silent stop.** A Windows
   password reset by an administrator, a recreated profile, or a restored machine image all
   legitimately break DPAPI ciphertext. On `CryptographicException` the agent: sets the tray to
   red, shows *"This machine's security keys changed, so the saved connection can no longer be
   read. Enter a new pairing code from Settings → Tally Sync."*, and **does not** delete the
   queue — nothing was lost, only the ability to authenticate.
5. **Never log a decrypted value.** Log lines that would contain the token log
   `nxfa_…<last 4>` only.

**Non-secret config stays plaintext on purpose.** A founder debugging a client's install over
WhatsApp needs to be able to say *"open config.json and read me the company name."* Encrypting
configuration that is not secret buys nothing and costs a support call.

### 7.5 If the token is compromised

**Detection.** `p2_tally_targets.last_seen_at`, `last_seen_machine` and `last_seen_ip` are updated
every poll. A poll from a machine name the owner does not recognise is visible on the Tally Sync
panel: *"Last seen: DESKTOP-7F2K1 · 11 Sep 2026 14:02"*.

**Response — one click, immediate.**

1. Settings → Tally Sync → **Disconnect agent**. Sets `enabled = false` and
   `agent_token_hash = NULL`. Every subsequent request with that token gets `401`. There is no
   cache and no grace period.
2. Nothing in Tally is touched. Vouchers already posted are the client's own books.
3. Queued rows stay `pending`. A new pairing resumes exactly where the old agent stopped.

**Blast radius, stated plainly so it can be said in a sales meeting.** An attacker holding a
factory agent token can read the **finished Tally XML for that one tenant's queued and recent
sales and purchase vouchers** — document numbers, party names and GSTINs, dates, taxable values
and tax splits. That is information the counterparties on those documents already hold. They
cannot read stock, costs, margins, BOM, production, job-work internals, any other tenant, or any
user account; and they cannot write anything into Nexflow.

**Why that is the right ceiling.** The alternative — the agent holding a service-role key or a
refresh token — would make the same stolen laptop a full cross-tenant compromise. The whole point
of D7 is that the worst case is bounded and describable.

### 7.6 What the Bridge Agent sends outside the factory

**Exactly one external destination.**

| Destination | Protocol | What |
|---|---|---|
| `https://<project-ref>.supabase.co` | HTTPS 443, outbound only | Poll, claim, report, heartbeat, update manifest and binary download (Supabase Storage is on the same host). |
| `http://127.0.0.1:9000` | Loopback only, never leaves the machine | Tally. |

**And nothing else. No telemetry host. No analytics. No crash reporter. No CDN. No Nexflow-owned
server of any kind other than the Supabase project the client's own data already lives in.**

- **The agent opens no listening port.** It is outbound-only. It cannot be reached from the LAN or
  the internet.
- **Port 9000 is never exposed and no client is ever asked to port-forward it.** The Tally XML
  gateway is entirely unauthenticated — anyone who can reach it can read and rewrite the company's
  books. `[NEVER]` This is a permanent rule, not a default.
- **Nothing read from Tally is transmitted.** The company list, the version probe, the pre-flight
  scan and the ledger list are processed in memory on the factory PC. What leaves is a **count and
  a status**, never voucher content. The one exception is the pre-flight conflict report, which
  sends **voucher numbers and amounts for the conflicting documents only** — the client's own
  documents, needed to show the owner what the conflict is.
- The agent can run behind an egress firewall that allows exactly one hostname. Say that to a
  PVT LTD's IT contractor; they will ask.

### 7.7 The plain-English promise, for the factory owner's screen

> **What the Nexflow Bridge does:** it takes the sales invoices and purchase entries you have
> already made in Nexflow and writes them into your own TallyPrime, on this computer.
>
> **What it never does:** it never reads your Tally data into Nexflow. It never deletes anything in
> Tally. It never touches a month your CA has already filed. It never opens your computer to the
> internet. It talks to exactly two places — Nexflow, and the Tally running on this machine.
>
> **You can switch it off at any time**, from Settings, and everything already in your Tally stays
> yours.

---

## 8. Schema

Four objects. All `p2_`-prefixed. All with RLS explicitly **enabled in the same migration that
creates the policy** — the codebase-audit's single largest finding was fifteen tables that got a
policy and never got `ENABLE ROW LEVEL SECURITY`, and that mistake must not be repeated here.

### 8.1 `p2_tally_targets`

One row per (tenant, profile). The agent's identity, configuration and heartbeat.

```sql
CREATE TABLE p2_tally_targets (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                 uuid NOT NULL,
  target                    text NOT NULL CHECK (target IN ('factory','ca')),

  -- Tally connection
  company_name              text NOT NULL,          -- exact SVCURRENTCOMPANY. Human-confirmed. Never inferred.
  tally_host                text NOT NULL DEFAULT '127.0.0.1',
  tally_port                int  NOT NULL DEFAULT 9000,

  -- Chart-of-accounts mapping (§8.1.1)
  ledger_map                jsonb NOT NULL DEFAULT '{}'::jsonb,

  -- Operating state
  enabled                   boolean NOT NULL DEFAULT true,
  mode                      text NOT NULL DEFAULT 'preview'
                              CHECK (mode IN ('preview','live','paused')),
  filed_through             date,                   -- period lock: never write on or before this
  poll_interval_seconds     int NOT NULL DEFAULT 60
                              CHECK (poll_interval_seconds BETWEEN 30 AND 300),

  -- Auth (§7)
  agent_token_hash          text,                   -- sha256 hex. NULL = revoked / never paired.
  pairing_code_hash         text,
  pairing_code_expires_at   timestamptz,

  -- Heartbeat and telemetry (§10.4)
  last_seen_at              timestamptz,
  last_seen_machine         text,
  last_seen_ip              inet,
  agent_version             text,
  tally_product             text,                   -- 'TallyPrime' | 'Tally.ERP 9'
  tally_release             text,
  tally_is_educational      boolean,
  last_probe_at             timestamptz,
  last_probe_error          text,

  -- Update channel (§12.4)
  target_version            text,                   -- NULL = track latest. Set to pin a client.

  created_at                timestamptz NOT NULL DEFAULT now(),
  updated_at                timestamptz NOT NULL DEFAULT now(),

  UNIQUE (tenant_id, target)
);
```

`UNIQUE (tenant_id, target)` is the constraint that makes "two agents against one company"
structurally impossible (§7.2).

**`mode` is the parallel-run switch and it defaults to `preview`, not `live`.** A freshly paired
agent **builds and displays** the vouchers it would post and posts nothing until a human flips it.
Defaulting to `live` would mean an install with a wrong ledger map writes into a real company's
books before anyone has looked. §14.6.

#### 8.1.1 `ledger_map`

```json
{
  "sales_taxable":     "Job Work Charges @ 18%",
  "sales_goods":       "Sales @ 18%",
  "purchase":          "Purchase @ 18%",
  "purchase_by_rate":  { "0": "Purchase - Exempt", "5": "Purchase @ 5%",
                         "12": "Purchase @ 12%", "18": "Purchase @ 18%",
                         "28": "Purchase @ 28%" },
  "output_cgst":       "Output CGST",
  "output_sgst":       "Output SGST",
  "output_igst":       "Output IGST",
  "input_cgst":        "Input CGST",
  "input_sgst":        "Input SGST",
  "input_igst":        "Input IGST",
  "round_off":         "Round Off",
  "debtors_parent":    "Sundry Debtors",
  "creditors_parent":  "Sundry Creditors"
}
```

`purchase_by_rate` is new relative to `enterprise-strategy.md` §3.1's sketch and it is required:
`js/full-export.js` derives purchase ledger names as `` `Purchase @ ${rate}%` ``, which is a
*guess* at the client's chart of accounts. A CA who named them `Purchases - Local 18%` would get
*"Ledger does not exist"* on every voucher. The map is populated at install from a picker
listing the ledgers actually in Tally, for exactly the rates actually present in that tenant's
`p2_raw_materials`. `purchase` remains the fallback for a material with a null `gst_rate`.

**A render fails closed if a key it needs is absent or empty.** Row goes `failed` with
`failure_class='permanent'` and `last_error='Ledger mapping missing: purchase_by_rate.12'`. It
never guesses, and it never silently omits the line — omitting a tax line produces a balanced
voucher with a wrong tax figure, which is the worst possible failure mode.

### 8.2 `p2_tally_sync_log`

One row per (target, document). The queue, the audit trail and the reconciliation record.

```sql
CREATE TABLE p2_tally_sync_log (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           uuid NOT NULL,
  target              text NOT NULL CHECK (target IN ('factory','ca')),
  target_id           uuid NOT NULL REFERENCES p2_tally_targets(id) ON DELETE CASCADE,

  -- What document this is
  doc_type            text NOT NULL
                        CHECK (doc_type IN ('sales','purchase','credit_note','debit_note')),
  source_table        text NOT NULL,     -- 'p2_invoices' | 'p2_stock_transactions'
  source_key          text NOT NULL,     -- invoice uuid, or 'supplier_id|NORMALISEDINVNO'
  doc_number          text,              -- INV-202608-014 / TSL/2608/0142 — for the UI and the CA
  doc_date            date NOT NULL,
  period              text NOT NULL,     -- 'YYYY-MM' of doc_date. Period locking and reporting.
  amount_total        numeric(14,2),     -- party-side absolute value. Drift detection (§14.7).

  -- Identity in Tally
  remote_id           text NOT NULL,
  legacy_remote_id    text,              -- js/full-export.js-format id for the same doc (§6.5)
  remote_id_source    text NOT NULL DEFAULT 'canonical'
                        CHECK (remote_id_source IN ('canonical','adopted_legacy')),
  company_name        text NOT NULL,     -- exact SVCURRENTCOMPANY used, frozen at enqueue
  tally_vch_id        text,              -- LASTVCHID from the import result

  -- The rendered document (§3 D3)
  xml                 text,              -- complete envelope. NULL once status='sent' + 90 days.
  payload_hash        text,              -- sha256 of xml. Detects source drift after send.
  party_ledger_created_at timestamptz,   -- party ledger confirmed present in this company

  -- Queue state
  status              text NOT NULL DEFAULT 'pending'
                        CHECK (status IN ('pending','sent','failed','skipped',
                                          'conflict','blocked_period','invalid_payload','dead')),
  failure_class       text CHECK (failure_class IN
                        ('environmental','transient','permanent','conflict')),
  attempts            int NOT NULL DEFAULT 0,
  next_attempt_at     timestamptz,       -- backoff as a column, not a computation
  claimed_at          timestamptz,       -- FOR UPDATE SKIP LOCKED claim, reclaimed after 10 min
  claimed_by          text,              -- machine name, for the CA profile's multi-company case
  last_error          text,              -- verbatim LINEERROR. Never truncated.
  last_attempt_at     timestamptz,
  sent_at             timestamptz,

  -- Verification (§14.7)
  verified_at         timestamptz,
  drift_amount        numeric(14,2),
  drift_reason        text,

  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),

  UNIQUE (tenant_id, target, source_table, source_key)
);
```

**`UNIQUE (tenant_id, target, source_table, source_key)` is the primary idempotency guard.** A
document can be queued exactly once per target. The agent can crash, restart, be reinstalled, or
run twice — no double-post is reachable through this table. Tally's own REMOTEID matching is the
*secondary* guard, which is the right ordering given that the F12 setting's exact behaviour is
`[UNVERIFIED]` (§19 Q2).

**Why a log table and not a `tally_synced boolean` column**, restated from
`enterprise-strategy.md` §3.1 because it will be proposed again: a boolean cannot express
*attempted, failed, retry 3, last error was "Ledger does not exist"*; the GRN source is a **group**
of rows with no single row a boolean would be correct on; and adding write paths to
`p2_stock_transactions` — the largest and most heavily-flagged table in the audit — for bookkeeping
metadata is the wrong trade.

**`xml` is nulled 90 days after `sent`**, by the same cron that runs verification (§14.7). The row
stays forever; the rendered document does not need to. This keeps the table from growing without
bound on a tenant doing 500 documents a month, and a `sent` document's content is recoverable from
its source rows anyway.

**Statuses, exhaustively:**

| Status | Meaning | Retryable |
|---|---|---|
| `pending` | Queued, not yet accepted by Tally | yes |
| `sent` | `ERRORS=0` and `CREATED+ALTERED>=1`. Confirmed in Tally. | no |
| `failed` | Attempted, not landed. See `failure_class`. | per class |
| `skipped` | Structurally unsendable — no supplier, no invoice number | no, until the source is fixed |
| `conflict` | A human-typed voucher with the same number exists. **Never overwritten.** | no, needs a decision |
| `blocked_period` | `doc_date` falls on or before `filed_through` | no, permanently |
| `invalid_payload` | Failed a pre-post assertion (unbalanced, wrong company, id mismatch) | no, it is a Nexflow bug — alerts the founder |
| `dead` | `attempts >= 5` on a non-environmental class | no, needs a human |

### 8.3 `p2_ca_grants`

Per-(tenant, CA) consent. Session 19. Specified here so the Session 18 schema migration can
create it and leave it empty rather than requiring a second migration against live tenants.

```sql
CREATE TABLE p2_ca_grants (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid NOT NULL,
  ca_email       text NOT NULL,
  ca_name        text NOT NULL,          -- shown on the tenant's consent screen
  company_name   text NOT NULL,          -- exact Tally company name in the CA's install
  scope          text NOT NULL DEFAULT 'gst_documents_v1'
                   CHECK (scope = 'gst_documents_v1'),
  filed_through  date,                   -- per-client period lock, set by the CA or the owner
  granted_at     timestamptz NOT NULL DEFAULT now(),
  granted_by     uuid NOT NULL REFERENCES auth.users(id),
  revoked_at     timestamptz,
  revoked_by     uuid REFERENCES auth.users(id),
  created_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, ca_email)
);
```

Notes on the columns that differ from `enterprise-strategy.md` §3.5's sketch:

- **`ca_name`** — the consent screen must name a person, not an email address. *"Grant access to
  ca@example.com"* is not informed consent; *"Grant access to Deshpande & Associates"* is.
- **`filed_through` is per grant, not only per target.** A CA has twenty clients on twenty
  different filing schedules. A single lock on the CA's target row would be wrong for nineteen of
  them. The effective lock for a document is
  `GREATEST(target.filed_through, grant.filed_through)`, nulls treated as `-infinity`.
- **`scope` has a single permitted value and a CHECK that enforces it.** A `scope` column with a
  free-text value is a scope column that quietly widens. When a second scope genuinely exists,
  widening the CHECK is a deliberate migration with a review.
- **`revoked_by`** — revocation is an event with an actor. `granted_by` without `revoked_by` is
  half an audit trail.

**Revocation is immediate and does not delete anything already in the CA's Tally.** That data is
the client's own books. This must be said on the revoke confirmation dialog, because an owner who
believes revoking will pull their data out of their CA's Tally will be surprised later.

### 8.4 RLS

Modelled on `p2_notifications`, which the audit calls the reference implementation.

```sql
ALTER TABLE p2_tally_targets  ENABLE ROW LEVEL SECURITY;
ALTER TABLE p2_tally_sync_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE p2_ca_grants      ENABLE ROW LEVEL SECURITY;

-- Three command-scoped policies per table: SELECT, INSERT, UPDATE. NO DELETE.
-- get_my_tenant_id(), NEVER auth.uid() — the auth.uid() pattern is the known-broken one
-- that silently blocks every non-owner staff role (CLAUDE.md, RLS Fixes, Sessions 1-2).

CREATE POLICY p2_tally_targets_select ON p2_tally_targets
  FOR SELECT USING (tenant_id = get_my_tenant_id());
CREATE POLICY p2_tally_targets_insert ON p2_tally_targets
  FOR INSERT WITH CHECK (tenant_id = get_my_tenant_id());
CREATE POLICY p2_tally_targets_update ON p2_tally_targets
  FOR UPDATE USING (tenant_id = get_my_tenant_id())
              WITH CHECK (tenant_id = get_my_tenant_id());
-- …the same three shapes for p2_tally_sync_log and p2_ca_grants.
```

**No DELETE policy on any of the three.** The sync log is an audit trail of what was written into
a statutory book; grants are a consent record. Both are append-and-amend, never erase. A target
row is disabled (`enabled=false`), never deleted. The `ON DELETE CASCADE` on
`p2_tally_sync_log.target_id` exists only so a founder-initiated service-role cleanup of a test
target does not orphan rows; it is unreachable from any client path.

**`agent_token_hash`, `pairing_code_hash` and `last_seen_ip` must never reach the browser.** The
Settings panel reads through a view or an explicit column list, not `select('*')`. A hash is not a
secret, but publishing it invites an offline attack on a 32-byte token for no benefit, and the IP
is not the owner's business to see for a machine they may not administer.

**The agent reads none of these tables directly.** It has no Supabase credential (§3 D7). Every
read and write it performs goes through `tally-bridge` with the service role. RLS here governs the
*browser*, which is the only other reader.

### 8.5 Indexes

```sql
-- The claim query. The hottest path: one per agent per poll interval, forever.
CREATE INDEX p2_tally_sync_log_claim_idx
  ON p2_tally_sync_log (target_id, status, next_attempt_at)
  WHERE status IN ('pending','failed');

-- The Settings panel: most recent first, per tenant.
CREATE INDEX p2_tally_sync_log_tenant_recent_idx
  ON p2_tally_sync_log (tenant_id, created_at DESC);

-- Verification and the monthly clean-month computation (§14.7).
CREATE INDEX p2_tally_sync_log_period_idx
  ON p2_tally_sync_log (target_id, period, status);

-- Pre-flight REMOTEID reconciliation looks both ids up.
CREATE INDEX p2_tally_sync_log_remote_idx ON p2_tally_sync_log (remote_id);
CREATE INDEX p2_tally_sync_log_legacy_idx ON p2_tally_sync_log (legacy_remote_id)
  WHERE legacy_remote_id IS NOT NULL;

-- Token lookup on every single agent request.
CREATE UNIQUE INDEX p2_tally_targets_token_idx ON p2_tally_targets (agent_token_hash)
  WHERE agent_token_hash IS NOT NULL;

-- CA grant resolution.
CREATE INDEX p2_ca_grants_ca_active_idx ON p2_ca_grants (ca_email)
  WHERE revoked_at IS NULL;
```

The partial unique index on `agent_token_hash` does double duty: it makes token lookup an index
scan, and it makes a token collision a database error rather than an ambiguous match.

### 8.6 Migration order

One migration file, applied **via the Supabase SQL Editor, never `supabase db push`** — the
standing rule in this project, because `db push` replays old migrations.

```
20261101_bridge_agent.sql
  1. CREATE TABLE p2_tally_targets
  2. CREATE TABLE p2_tally_sync_log
  3. CREATE TABLE p2_ca_grants
  4. ALTER TABLE … ENABLE ROW LEVEL SECURITY   (all three — in this file, not later)
  5. CREATE POLICY ×9
  6. CREATE INDEX ×7
  7. GRANT SELECT, INSERT, UPDATE ON … TO authenticated
     REVOKE ALL ON … FROM anon

  -- Two existing CHECK constraints must be widened in the same file:
  8. p2_ops_alerts.source       + 'bridge'              -- §10.4. A0's enum has no Bridge value.
  9. p2_notifications.type      + 'tally_sync_failed'   -- §10.5. Owner-facing Telegram + bell.
     Both are DROP CONSTRAINT / ADD CONSTRAINT. Neither has a default to change.
     p2_notifications.type currently allows ('challan_dispatched','payment_overdue',
     'low_stock','filing_package_ready').
```

**One prerequisite migration, separate and earlier** (§4.4, §17.3 step 1): the GRN
duplicate-invoice partial unique index from `CLAUDE.md` Known Open Items #1. It is not part of
this file because it touches a live, heavily-used table and must be applied and observed on its
own.

Apply to the **test tenant first**, run `node _ai/regression/snapshot.js`, and diff against the
most recent prior snapshot — **not** `baseline-pre-2H.json`, per the standing instruction in
`CLAUDE.md`. The migration adds only new objects and touches no existing table, so the diff must
be empty; a non-empty diff means something else was wrong before this session started.

---

## 9. The Edge Function: `tally-bridge`

`supabase/functions/tally-bridge/index.ts`, `verify_jwt = false`, all DB access via
`SB_SECRET_KEY`. **The single access path.** There is no second route to this data.

### 9.1 Request shape

Every request: `POST`, `Authorization: Bearer nxfa_…`, JSON body with a `mode`.

| Mode | Called by | Does |
|---|---|---|
| `pair` | agent, first run | Exchanges a pairing code for a token. **The only mode that does not require a token.** |
| `poll` | agent, every 30–300 s | Heartbeat + config + claim up to N rows. The main loop. |
| `report` | agent, after each POST to Tally | Records the result of one row. |
| `preflight` | agent, before the first sync of any (company, period) | Submits the REMOTEIDs and voucher numbers found in Tally; server reconciles. |
| `probe` | agent, on start and every cycle | Reports Tally product, release, educational mode, loaded companies. |
| `ledgers` | agent, mapping screen only | Submits the ledger name list for the picker. Not persisted. |
| `update-check` | agent, on start and every 6 h | Returns the manifest for this target's channel. |

Modes called from the **browser** (`settings.html`) do not go here — they are ordinary
RLS-governed table reads and writes by the logged-in owner, plus one `body.action` handler on
`agent-query` for generating a pairing code, following the established pattern of the other six
`body.action` handlers and reusing `verifyCallerTenant`.

### 9.2 `poll` — the main loop

```
POST /tally-bridge  { mode: 'poll', agent_version, machine_name,
                      companies_loaded: ["DATTA PRASAD ENTERPRISES", ...],
                      tally: { product, release, educational } }

1. token → sha256 → p2_tally_targets. 401 if no match or agent_token_hash IS NULL.
2. Update last_seen_at / last_seen_machine / last_seen_ip / agent_version / tally_*.
3. If enabled = false  → { work: [], reason: 'disabled' }
   If mode  = 'paused' → { work: [], reason: 'paused' }
   If mode  = 'preview'→ return the rows WITHOUT marking them claimed, flagged preview: true
4. If the target's company_name is not in companies_loaded
      → { work: [], reason: 'company_not_loaded', company_name }
5. Claim, with FOR UPDATE SKIP LOCKED:
      SELECT * FROM p2_tally_sync_log
       WHERE target_id = :t
         AND status IN ('pending','failed')
         AND attempts < 5
         AND (next_attempt_at IS NULL OR next_attempt_at <= now())
         AND (claimed_at IS NULL OR claimed_at < now() - interval '10 minutes')
         AND period > COALESCE(:effective_filed_through_period, '0000-00')
       ORDER BY doc_date ASC, created_at ASC
       LIMIT 25
       FOR UPDATE SKIP LOCKED;
   …then set claimed_at = now(), claimed_by = :machine_name.
6. Return { work: [ { id, remote_id, company_name, xml, doc_number, doc_type } ], config: {...} }
```

`FOR UPDATE SKIP LOCKED` is the same row-locking discipline `confirm_bom_issue` already uses for
stock sufficiency and `p2_job_queue` (A6) uses for filing packages. It makes two overlapping polls
— a slow cycle plus a manual "Sync now" — incapable of claiming the same row.

**`ORDER BY doc_date ASC`, not `created_at`.** Vouchers should enter a client's books in document
order. A backfill that posts September before August is technically harmless but looks wrong in a
Day Book, and a CA who sees it loses confidence in the whole thing.

**A claim expires after 10 minutes** and is silently reclaimed. An agent that crashes mid-batch
holds no row hostage. Because the post itself is idempotent by REMOTEID, a reclaim that
double-posts alters in place rather than duplicating.

### 9.3 Enqueue and render

Enqueue is triggered from the same places the document becomes real:

| Document | Enqueued by |
|---|---|
| Sales | `agent-query`'s `confirmGenerateInvoice` / `confirmConsolidatedInvoice` / `resendInvoice`, immediately after `status` flips to `sent`. Fire-and-forget. |
| Sales (cancel) | `invoices.html`'s `cancelInvoice()`, after the status flip. |
| Purchase | `grn.html`'s `submitGrnTransactions()` and `scanner.html`'s `confirmGRN()`, after the insert. |
| **Sweeper** | A cron every 15 min catches anything the fire-and-forget calls missed. |

**The sweeper is not optional.** `codebase-audit.md` §4.5 documents six silent-failure points and
zero retries in the existing fire-and-forget notification pipeline; the same failure shape here
means a client's invoice quietly never reaches their books. The sweeper query is a left join from
eligible source documents to `p2_tally_sync_log` on `(source_table, source_key)`, enqueueing
anything missing. It is the mechanism that makes "did every document get queued" answerable rather
than assumed — the same reasoning A6 applies to the filing package's un-enqueued-tenant blind spot.

**Render happens at enqueue**, producing `xml`, `payload_hash` and `remote_id`. Render fails
closed:

| Render check | On failure |
|---|---|
| Every needed `ledger_map` key present and non-empty | `failed`, `permanent`, names the missing key |
| `sum(AMOUNT) == 0` within ₹0.01, residual pushed to round-off | `invalid_payload` + **`critical` ops alert** — this is a Nexflow bug, not a client problem |
| Tenant GSTIN present and its state code resolves | `failed`, `permanent`, *"Set your GSTIN in Settings → Company Details"* |
| `owned_by IS NULL` on every GRN row in the group | **throw** — never enqueue. §4.1 invariant 1. |
| `doc_date > filed_through` | `blocked_period`, no alert, shown on the panel |

**Re-render** runs for all `pending` / `failed` rows on a target when `ledger_map` or
`company_name` changes. `sent` rows are never re-rendered.

### 9.4 `report`

```
POST /tally-bridge  { mode: 'report', id, outcome: {
                        http_status, created, altered, ignored, errors,
                        last_vch_id, line_error, elapsed_ms, posted_at } }
```

Server classifies (§10.3), sets `status`, `failure_class`, `attempts`, `next_attempt_at`,
`last_error`, `tally_vch_id`, `sent_at`, and clears `claimed_at`. Always returns HTTP 200 — the
agent is fire-and-forget on this call and must never have a business outcome depend on the
report's own success (§10.6 covers the case where it fails).

**Classification is server-side, not agent-side.** The agent reports facts (counters, the verbatim
`LINEERROR`, the HTTP status); the server decides what they mean. This keeps the retry policy
changeable without shipping a new binary — which, at 25 installs the founder does not control, is
the difference between a one-line fix and a support campaign.

---

## 10. Queue, Retry and Error Handling

### 10.1 The agent loop

```
every poll_interval (default 60s, configurable 30-300):

  1. probe Tally        → product, release, educational, companies loaded
                          connection refused → ENVIRONMENTAL, tray amber, no attempt consumed
  2. POST poll          → config + up to 25 claimed rows (or preview rows)
                          network failure → hold, retry next interval, tray amber
  3. for each row:
       a. assert sum(AMOUNT) == 0            → fail → report invalid_payload, do not post
       b. assert SVCURRENTCOMPANY == configured company AND it is loaded
       c. assert REMOTEID in xml == row.remote_id
       d. ensure party ledger exists (§5.6)  → fail → report, skip the voucher
       e. append to the local journal (§10.6)
       f. POST xml to 127.0.0.1:9000, 30s timeout
       g. parse tolerantly (§5.9)
       h. POST report                        → on failure, leave the journal line unacked
       i. mark the journal line acked
  4. replay any unacked journal lines older than 60s (§10.6)
  5. update tray state
```

Batch size 25 keeps one cycle bounded regardless of backlog size. A 2,000-document first sync
takes 80 cycles — about 80 minutes at the default interval — and never blocks a single cycle for
long enough to look hung. The first-sync case gets a progress bar in the agent window rather than
a larger batch.

### 10.2 The four failure classes

Reproduced from `enterprise-strategy.md` §3.1 with the additions this design needs.

| Class | Examples | `attempts++` | Backoff | Alert |
|---|---|---|---|---|
| **Environmental** | connection refused, Tally closed, company not loaded, network timeout, Supabase unreachable | **No** | fixed, one poll interval | only after **24 h** with a non-empty queue, rate-limited to one per 24 h per tenant |
| **Transient** | Tally busy, mid-backup, HTTP 5xx, unparseable response, claim expired mid-post | Yes | 1 m → 5 m → 15 m → 1 h → 6 h | at `attempts = 5` (`dead`) |
| **Permanent** | `LINEERROR: Ledger 'X' does not exist`, date out of financial year, `VCHTYPE` not found, educational mode, ERP 9 | Yes, **straight to 5** | none | immediately |
| **Conflict** | pre-flight found a human-typed voucher with the same number and no Nexflow REMOTEID | n/a → `conflict` | none | immediately |

**Environmental failures must not consume retry attempts.** Tally being closed overnight is the
normal state of the world for roughly sixteen hours a day, not an error. A design that burns five
attempts every night is useless by morning. This is stated in `enterprise-strategy.md` §3.1 and it
is the single most important line in the retry policy.

**`next_attempt_at` is a column, not a computation.** Backoff expressed as
`created_at + f(attempts)` inside the claim query means changing the policy is a query change on a
hot path and the current wait is invisible to the UI. Stored, the panel can say *"next attempt in
14 minutes."*

### 10.3 Classification rules

Applied server-side in `report`, in order; first match wins.

```
http_status is null / ECONNREFUSED / ETIMEDOUT / DNS failure   → environmental
http_status >= 500                                             → transient
response unparseable (no ERRORS, no CREATED, no ALTERED)        → transient
errors == 0 && (created + altered) == 0                         → permanent, reason 'company_mismatch'
errors > 0 && LINEERROR contains 'does not exist'               → permanent, reason 'ledger_missing'
errors > 0 && LINEERROR contains 'financial year'               → permanent, reason 'date_out_of_fy'
errors > 0 && LINEERROR contains 'educational'                  → permanent, reason 'educational_mode'
errors > 0                                                      → permanent, reason 'tally_rejected'
ignored > 0                                                     → permanent, reason 'ignored'
otherwise                                                       → sent
```

`company_mismatch` earns its own reason because it is the protocol's signature silent failure
(§2.2): HTTP 200, `ERRORS=0`, and nothing in the Day Book. Classifying it as generic success would
mean marking documents `sent` that are not in any company's books — a lie in an audit trail, and
one that would be discovered by a CA in filing week.

**`LINEERROR` matching is substring, case-insensitive, and is a *hint* only.** The verbatim text
is always stored. If a Tally release changes its wording, the row falls through to
`tally_rejected`, which is still permanent and still surfaces the real message — the classifier
degrades to "less specific", never to "wrong".

### 10.4 Heartbeat and the crashed-agent problem

A crashed or uninstalled agent looks identical to a quiet month: no errors, no failures, nothing
in the queue moving. `last_seen_at` is what distinguishes them.

- Every `poll` updates `last_seen_at`, even a poll that claims nothing.
- **Stale > 48 h** → the Tally Sync panel shows *"The Bridge Agent on `DESKTOP-7F2K1` has not
  checked in since 9 Sep. Open Nexflow Bridge from the Start menu, or restart the computer."*
- **Stale > 48 h with a non-empty queue** → `important` ops alert to the founder (A0), deduped on
  `(source='bridge', dedupe_key=target_id)` for 24 h.

> **A0 schema change required.** `p2_ops_alerts.source` has a CHECK constraint listing
> `('compliance','digest','filing','health','onboarding','support','billing')`
> (`automation-strategy.md` §3.1). **`'bridge'` is not in it**, and neither is the `OpsSource`
> union in `_shared/ops.ts`. Session 18 must widen both — one `DROP CONSTRAINT` /
> `ADD CONSTRAINT` migration plus one union member. Do not reuse `'filing'` for Bridge alerts:
> A6's filing-package supervision already dedupes on that source, and sharing it would let a
> Bridge alert suppress a filing alert, or the reverse, on a colliding dedupe key.

The heartbeat is also how the founder answers *"is it running?"* without asking the client to open
Task Manager — a question §16 identifies as the most common support call in this product category.

### 10.5 What the owner sees

**Two surfaces, split by who can actually reach them.** `[VERIFIED]` `settings.html` is
**owner-only** — it redirects every other role to `index.html` (`CLAUDE.md`, Session 14). An
accountant therefore cannot open a settings tab at all, and the accountant is the person who most
needs to read a sync error. A single tab would put the error list behind a gate that excludes its
main reader.

**Surface 1 — `settings.html` → new "Tally Sync" tab. Owner only** (inherited from the page).
Configuration and control:

| Section | Content |
|---|---|
| **Status** | Green / amber / red. Agent machine name, version, last seen, Tally product and release, current mode (`preview` / `live` / `paused`). |
| **Connect / Disconnect** | Generates a pairing code (§7.2); revokes the token (§7.5). |
| **Ledger mapping** | The `ledger_map` editor. §8.1.1. |
| **Company** | The configured `SVCURRENTCOMPANY`, changeable from a live probe list. §15.5. |
| **Period lock** | `filed_through` date picker, with an explicit *"Nexflow will never write into this month or any earlier month again."* |
| **Preview / Go live** | The parallel-run switch. §14.6. |
| **Share with my CA** | `p2_ca_grants` consent flow. Session 19, §14.3. |

**Surface 2 — `export.html` → new "Tally Sync" card. Owner, supervisor and accountant**
(`TABLE13_ROLES`, the gate every other CA-facing tool on that page already uses). **Read-only plus
Retry**, and it is where the CA-facing work happens — the same reasoning that put
`gstr2b-reconcile.html` behind a link on `export.html` rather than in Settings: CA and accounting
tools stay together.

| Section | Content |
|---|---|
| **Status line** | The same green/amber/red summary, read-only. |
| **Queue** | Counts by status. *"14 waiting · 2 need attention · 1,204 sent this year."* |
| **Needs attention** | One row per `failed` / `conflict` / `skipped` / `blocked_period`: document number, date, amount, a **plain-English line**, the verbatim `LINEERROR` below it in monospace, attempts, next attempt, and a **Retry** button. Grouped by cause, not by document (§15.8). |
| **Compare with Tally** | The parallel-run reconciliation. §14.6. |
| **Conflict resolution** | The three choices in §11.3. |

A `ledger_missing` row's **Fix mapping** button is owner-only and shows an accountant
*"Ask the owner to update the ledger mapping in Settings"* instead — the same role-aware
dead-end-link handling the HSN Audit's Action column already uses (`CLAUDE.md`, Session 14).

**The plain-English line is above the raw error, never instead of it.** The audit flags "never
surface a raw Postgres or HTTP error to the client" as a repeated habit — but a CA *needs* the
verbatim Tally message, and hiding it would send them to `Tally.imp`, which is the thing §16
item 4 exists to prevent. Both, in that order.

Worked example, the most common permanent failure:

> ⚠ **INV-202608-014 · 31 Aug 2026 · ₹1,18,000.00**
> Tally has no ledger named **"Output CGST"**. Ask your accountant for the exact name as it
> appears in Tally, then update it in **Ledger mapping** below.
> `LINEERROR: Ledger 'Output CGST' does not exist!`
> Attempt 5 of 5 · [ Fix mapping ] [ Retry ]

**Telegram.** Reuses the existing `p2_notifications` → `notify` pipeline, with one new type
`tally_sync_failed` added to the CHECK constraint. **Deliberately sparse**: one notification when
a row first reaches `dead`, and one when Tally has been unreachable for 24 h with a non-empty
queue. Nothing else. `codebase-audit.md` §4.5 documents six silent-failure points and zero retries
in that pipeline; adding a chatty producer to it would guarantee the owner mutes the channel, and
a muted channel is worse than no channel.

### 10.6 The local journal — and the "succeeded in Tally, failed to log" case

**The agent keeps no durable local queue. Supabase is the queue.** A second source of truth would
need its own reconciliation, and the reconciliation of two queues is a harder problem than the one
being solved.

But there is a real gap between step (f) and step (h) in §10.1: the voucher lands in Tally, and
then the report to Supabase fails. Without something, that document is `pending` forever in
Nexflow and present in Tally.

**The journal closes it.** Append-only JSONL at
`%LOCALAPPDATA%\Nexflow\Bridge\journal\YYYY-MM-DD.jsonl`, one line per post:

```json
{"row_id":"…","remote_id":"NXF-3b68db90-SAL-1976b1814d62919b","company":"DATTA PRASAD ENTERPRISES",
 "posted_at":"2026-09-11T09:14:22+05:30","created":1,"altered":0,"errors":0,"ignored":0,
 "last_vch_id":"119","acked":false}
```

- The line is appended and **flushed** *before* the POST to Tally, then updated with the result.
- `acked` flips to `true` only when `report` returns 200.
- Every cycle replays unacked lines older than 60 seconds.
- **If the journal itself is lost** — disk failure, a machine reimage — the document is retried
  normally. Because the REMOTEID is stable, Tally **alters the existing voucher in place**. The
  amount does not change, no duplicate appears, and the row reaches `sent`. The journal is an
  optimisation that avoids an unnecessary re-post; the REMOTEID is what makes losing it safe.
- Journal files older than 30 days are deleted.

### 10.7 When the internet is down

Nothing syncs, by design, and this is acceptable for a specific reason: **the documents being
synced were created in Nexflow, which needs the internet.** If the factory is offline, no new
invoices or GRNs are being created either. The queue does not grow while it cannot drain.

Behaviour: tray amber, *"Waiting for internet"*, no attempts consumed (`environmental`), and
whatever batch the agent already claimed is held in memory and posted the moment connectivity
returns. Claims expire after 10 minutes server-side and are simply re-claimed. A one-hour outage
is invisible; a one-day outage produces one Telegram message at the 24-hour mark.

---

## 11. Pre-flight and Idempotency

Three layers. All three are required, and the ordering matters: Nexflow's constraint is the
primary guard precisely because Tally's behaviour has an `[UNVERIFIED]` in it.

### 11.1 Layer 1 — the company probe (every cycle)

Before claiming any work, the agent asks Tally which companies are loaded and posts the list with
`poll`. The server returns work **only** for a company in that list.

This is the defence against the protocol's signature silent failure (§2.2). Without it, a company
renamed in Tally produces `HTTP 200 / ERRORS=0 / nothing in the Day Book` for every document, and
the sync log fills with `sent` rows describing vouchers that exist nowhere. With it, the agent
claims nothing and the panel says *"Company 'DATTA PRASAD ENTERPRISES' is not open in Tally."*

The probe also carries product, release and educational-mode flags, which gate §3 D2.

### 11.2 Layer 2 — the pre-flight scan (first sync of each company+period)

Before the **first** document of any (company, `period`) is posted, the agent exports the vouchers
already present in Tally for that month and posts back, for each: voucher number, voucher type,
date, party name, absolute amount, and `REMOTEID` if any.

The server reconciles against `p2_tally_sync_log` for that (target, period) and resolves each
pending row into one of four outcomes (§6.5 plus the conflict case):

| Found in Tally | Outcome |
|---|---|
| Canonical `remote_id` | `sent`. Already there. No post. |
| `legacy_remote_id` | **Adopt** — `remote_id_source='adopted_legacy'`, re-render with the legacy id, `ACTION="Alter"`. |
| Same `VOUCHERNUMBER`, no Nexflow REMOTEID | **`conflict`.** Never posted, never overwritten. §11.3. |
| Nothing | Normal `Create`. |

**This runs once per (company, period), not per document**, and the result is recorded so it is
not repeated. It re-runs when a period's `filed_through` moves or when the panel's *"Re-check this
month"* is pressed.

### 11.3 Layer 3 — conflicts are surfaced, never resolved automatically

A voucher in Tally with the same number and no Nexflow REMOTEID is **a human typed it**. This is
the failure mode that would burn a CA relationship (`enterprise-strategy.md` §3.5 Q7), so it gets
the most defensive handling in the document:

- Row goes `conflict`. **Never overwritten. Never posted. No retry.**
- `important` ops alert to the founder, immediately.
- Panel shows both sides: *"Tally already has a Sales voucher numbered `INV-202608-014` dated
  31 Aug 2026 for ₹1,18,000.00, entered by hand. Nexflow has not written anything for this
  invoice."*
- Three explicit buttons, and a human must pick one:
  - **"The Tally one is correct — mark it done"** → `sent`, `tally_vch_id` from the scan, nothing
    posted. Nexflow stops caring about this document.
  - **"Replace it with Nexflow's"** → posts with `ACTION="Alter"` **and the human-typed voucher's
    own identity**, after a second confirmation naming the amount on both sides. This is the only
    path in the entire product that overwrites something a human typed, and it exists because
    without it the only remedy is the CA deleting a voucher by hand.
  - **"Skip this one permanently"** → `skipped`.
- **The social contract is what actually prevents this**, and it is written into the setup
  conversation and the CA consent form: *from the day the integration goes live, nobody types
  that client's sales and purchase vouchers by hand.* The technical guard is necessary; the
  agreement is what makes it rare.

### 11.4 Layer 4 — the F12 overwrite setting

Tally's own mechanism: a voucher carrying a `REMOTEID` is matched on re-import when
**F12 → Configure → "Overwrite Vouchers during import (where voucher Remote GUID matches)"** is
enabled.

**The installer verifies this setting and refuses to proceed if it is off.** `[UNVERIFIED —
whether the setting is readable over the XML gateway, or whether the installer must instruct the
human to check it, §19 Q2]` If it is not machine-readable, the first-run wizard shows the exact
menu path with a screenshot and a *"I have turned this on"* checkbox — worse, but honest, and
still better than discovering it through duplicates in month two.

**The design does not depend on it.** With the setting off, a re-post creates a duplicate — but a
re-post only happens if Nexflow's `UNIQUE (tenant_id, target, source_table, source_key)` was
bypassed, which it cannot be. The setting is the second lock on a door that already has a first
one.

### 11.5 The period lock

**Nexflow never writes into a month on or before `filed_through`.** `[NEVER —
enterprise-strategy.md §8 item 9]`

- Enforced in the **claim query** (`period > effective_filed_through_period`), so a locked
  document is never even handed to the agent.
- Enforced again at **render**, so a document whose date is corrected backwards into a filed month
  goes `blocked_period` rather than being rendered.
- **Effective lock** = `GREATEST(target.filed_through, grant.filed_through)` for the CA profile,
  nulls treated as `-infinity`.
- `blocked_period` rows are shown on the panel with a specific explanation: *"This month has been
  filed. Your CA must pass a correcting entry in the current month instead."* That is correct
  accounting practice, not a limitation.

A filed month is a legal record. Altering it silently after filing creates a mismatch between the
client's books and their return that surfaces at assessment — which is the client's problem, not
ours, caused by our software.

---

## 12. Auto-Update

**Required from v1.** `enterprise-strategy.md` §3.1: *"A solo developer cannot support forty
factories on six agent versions."* An agent that cannot update itself is a fleet of permanent
one-off support obligations.

### 12.1 The check

On start, and every 6 hours. `POST /tally-bridge { mode: 'update-check', current_version }`.
Server returns the manifest for that target's channel:

```json
{
  "version": "1.4.2",
  "url": "https://<ref>.supabase.co/storage/v1/object/public/bridge-releases/NexflowBridge-1.4.2.exe",
  "sha256": "…64 hex…",
  "size_bytes": 71303168,
  "min_supported_version": "1.2.0",
  "published_at": "2026-11-14T06:00:00Z",
  "release_notes_en": "Fixes a rare case where a purchase voucher with three GST rates…"
}
```

**The check goes through `tally-bridge`, not straight to a static manifest file**, and that is the
whole point of D9 — the server decides *which* version this target is offered, from
`p2_tally_targets.target_version`.

### 12.2 Applying it

1. Download to `%LOCALAPPDATA%\Nexflow\Bridge\update\NexflowBridge-<v>.exe.part`.
2. **Verify SHA-256** against the manifest. Mismatch → discard, `important` ops alert, no retry
   this cycle.
3. **Verify the Authenticode signature and the publisher common name** via `WinVerifyTrust`.
   The CN must equal the expected `Nexflow Automations Private Limited`. A validly signed binary
   from anyone else is rejected. *"An unsigned auto-updater is a remote-code-execution
   vulnerability waiting to happen"* — and one that verifies only a hash it fetched from the same
   channel as the binary is barely better.
4. Rename `.part` → `.exe`, finish the current cycle, then: copy the running exe to
   `NexflowBridge.exe.bak`, replace it, relaunch, exit.
5. On next start the new version reports itself in `poll`, which is what confirms the update
   actually applied.

**No separate release-signing key.** Authenticode verification of the binary with a publisher
check is strictly stronger than a detached signature over a manifest, and it needs no second
private key — which matters because the code-signing key lives on an HSM token that cannot be
scripted into an unattended build.

### 12.3 Rollback

- `NexflowBridge.exe.bak` is kept until the new version has completed **three successful poll
  cycles**.
- If the new version fails to complete a cycle **three consecutive starts** — tracked in
  `config.json`, which the old binary also reads — the updater restores `.bak`, pins
  `config.json.rollback_from = "1.4.2"`, and reports it on the next `poll`.
- The server, seeing a rollback report, sets `target_version` to the last known good version for
  that target so the same broken update is not offered again, and raises a `critical` ops alert.
- **A rollback is never silent.** A client running a version behind the fleet must be visible to
  the founder, or the fleet is not a fleet.

### 12.4 Staged rollout

`p2_tally_targets.target_version`:

- `NULL` → track latest. The default.
- `'1.4.1'` → pinned. This target is offered 1.4.1 and nothing newer.

Release procedure, which is also the SmartScreen reputation-building procedure (§2.6):

1. Publish, pin everyone, unpin **the founder's own machine**. Run a day.
2. Unpin the **test tenant**. Run a day.
3. Unpin **one** real client — Datta Prasad, who has the most data and the most exercise of the
   multi-rate purchase path. Run three days.
4. Unpin the rest.

`min_supported_version` in the manifest is the escape hatch: a version below it is told to update
and **stops claiming work** until it does. Reserve it for a correctness bug that writes wrong
numbers. It is the only mechanism that can stop a bad version from continuing to write into
clients' books, and using it for anything less devalues it.

### 12.5 Hosting

Supabase Storage bucket `bridge-releases`, **public read** (the binary is signed, its integrity
does not depend on the channel being secret), service-role write. Same project, same hostname as
everything else the agent talks to (§7.6).

Retain the last **six** versions. Deleting a version a pinned client is running would brick that
client's next reinstall.

---

## 13. Installer

### 13.1 Framework — Inno Setup `[DECIDED]`

| Requirement | How Inno satisfies it |
|---|---|
| Per-user, no admin | `PrivilegesRequired=lowest`. Real per-user install; per-user registry writable from the script. |
| Auto-start | One `[Registry]` entry under `HKCU\…\Run`. No admin, no Task Scheduler. |
| First-run wizard **inside the installer** | Pascal scripting can HTTP-probe Tally during setup and populate a company dropdown from the live response. NSIS can be made to do this; Inno does it readably. |
| Silent enterprise install | `/VERYSILENT /SUPPRESSMSGBOXES` plus custom `/PAIRCODE=` and `/COMPANY=` switches. §13.5. |
| Signing | `SignTool` directive signs the installer; the payload exe is signed before packaging. |
| Uninstall | Standard entry. Removes binary and registry; **leaves `%LOCALAPPDATA%\Nexflow\Bridge\` intact** so logs and the journal survive for diagnosis, and offers to delete them. |

NSIS's decisive advantage over Inno is its `electron-builder` integration (D4 makes that
irrelevant) and MSI output, which nothing here needs.

### 13.2 What the installer does

```
Nexflow-Bridge-Setup-1.0.0.exe
  ├─ PrivilegesRequired=lowest          → no UAC prompt, no admin
  ├─ DefaultDirName={localappdata}\Programs\Nexflow Bridge
  ├─ [Files]    NexflowBridge.exe (signed)
  ├─ [Registry] HKCU\…\Run\NexflowBridge = "<path>\NexflowBridge.exe" --startup
  ├─ [Icons]    Start Menu → Nexflow Bridge
  ├─ [Run]      launch after install, tray only
  └─ Wizard pages (§13.3)
```

**`HKCU\…\Run`, not Task Scheduler.** Both work per-user without admin. The Run key wins on one
criterion that matters at 3 a.m.: the founder can verify it over the phone with
`reg query "HKCU\Software\Microsoft\Windows\CurrentVersion\Run"`, which an owner can read aloud.
A scheduled task needs `schtasks /query /tn` and a name nobody remembers. Trade-off, named: the
Run key fires at logon only, so an update needs the agent to restart itself — which §12.2 does
anyway.

### 13.3 The first-run wizard — six pages

Every page must be completable by a factory owner with no IT support, in Marathi or English.

**1 — Welcome.** What this does, in three sentences. *"Nexflow will write your invoices and
purchase entries into the TallyPrime on this computer. It will never read your Tally data, and it
will never delete anything."*

**2 — Pairing code.** Eight characters from Settings → Tally Sync. Live validation. On success,
shows the company name from Nexflow so the owner can confirm they paired the right tenant.
Failure messages are specific: expired, already used, not found — never *"invalid code"*.

**3 — Tally connection.** Host (`127.0.0.1`, locked unless *Advanced* is expanded), port (9000).
**Test connection** runs the probe and reports one of:

| Result | Message |
|---|---|
| OK | ✅ *"Connected to TallyPrime 5.0. 2 companies open."* |
| Refused | ❌ *"TallyPrime is not running, or its connectivity setting is off."* + the exact menu path + **Test again** |
| ERP 9 | ❌ *"This is Tally.ERP 9. Nexflow will not write into it."* (§3 D2) + the Filing Package alternative |
| Educational | ❌ *"TallyPrime is in Educational mode. Vouchers cannot be dated correctly."* |

**Cannot be skipped.** An install that completes without ever reaching Tally is an install that
will silently do nothing and produce a support call in a fortnight.

**4 — Company selection.** A **dropdown populated from the live probe** — never a text field. This
single choice removes the protocol's worst failure mode (§2.2) at the moment it is cheapest to
prevent. If the intended company is not loaded, the page says so and offers **Refresh** rather
than letting the owner type a name.

**5 — Tally configuration check.** Three settings the sync depends on, each verified where
possible and instructed where not:

| Setting | Why |
|---|---|
| F12 → Overwrite Vouchers during import (Remote GUID match) = **Yes** | Idempotency. §11.4. |
| Sales and Purchase voucher type numbering = **Manual**, Prevent Duplicates = **Yes** | Otherwise Tally may renumber our legally-significant invoice numbers, and duplicates follow. §2.2. |
| Company books-beginning date covers the periods to be synced | Otherwise every voucher fails *"date out of financial year range"*. |

`[UNVERIFIED — which of these are readable over the gateway, §19 Q2/Q8]` Anything not readable
gets the exact menu path, a screenshot, and an explicit checkbox.

**6 — Ledger mapping.** The `ledger_map` editor, every field a **dropdown populated from Tally's
ledger list** (§3 D6 purpose 4), filtered to the legal parent group for that slot. Purchase ledgers
are requested **per GST rate actually present in this tenant's materials** — the wizard asks the
server which rates those are and shows exactly that many rows, not a fixed five.

**Nothing is typed. Every ledger name comes from Tally itself.** *"Ledger does not exist"* is the
most common permanent failure in this product category (§16 item 5), and it is caused almost
entirely by humans typing names — including trailing spaces from copy-paste, a documented
real-world cause `[VERIFIED]`. A picker eliminates the class.

**Finish** leaves the agent in `preview` mode (§8.1). It has **not** started writing.

### 13.4 Code signing `[DECIDED]`

**OV, not EV.** §0 C1 — EV no longer buys SmartScreen behaviour, and the premium is ₹10,000–₹25,000
a year for nothing. Revisit only if a specific Segment 3 procurement checklist names EV.

| | |
|---|---|
| Type | **OV code signing** |
| CA | **Sectigo**, through an Indian reseller quoting INR with a GST invoice |
| Cost | ~$220–$280/yr ≈ **₹20,000–₹25,000/yr** including the token or cloud-HSM service |
| Key storage | **HSM or FIPS-140-2 L2 USB token — mandatory since 1 June 2023 for OV as well as EV.** Prefer **cloud HSM signing**: a physical token means the build only works at one desk, and a lost token means re-issuance. |
| Validation | MCA/government company registration record, a verifiable phone listing, an authorised signatory. **No trading-history requirement** — unlike Azure Artifact Signing. |
| Lead time | 3–10 business days after incorporation documents exist |
| Prerequisite | **PVT LTD incorporation.** `enterprise-strategy.md` §5. Order the certificate the week it completes. |
| Term | Buy **3 years** if offered. Rotating the certificate resets publisher reputation `[VERIFIED — Microsoft]`, and reputation is the thing being accumulated. |

**Expect a SmartScreen warning on the first installs regardless.** Plan for it (§12.4's staged
rollout is also the reputation ramp), tell the owner before they click, and never describe a
signed installer as "no warnings".

**Sign the payload exe and the installer separately**, and never modify a file after signing — a
post-signing edit breaks the signature.

### 13.5 Silent install — the KPML case

Twenty vendors at once (`enterprise-strategy.md` §3.5, `business-strategy.md` §7.2). A manual
six-page wizard twenty times is a day the founder does not have during a pilot.

```
Nexflow-Bridge-Setup-1.0.0.exe /VERYSILENT /SUPPRESSMSGBOXES /NORESTART ^
  /PAIRCODE=K7M2XQ4P /COMPANY="SHREE GANESH ENGINEERING WORKS" /LOG="C:\temp\nxfb.log"
```

- `/PAIRCODE` — pairs non-interactively. Codes are minted in bulk from Settings and expire in
  15 minutes, so the batch must run promptly. That is deliberate: a long-lived bulk pairing code
  is a bearer credential sitting in a deployment script.
- `/COMPANY` — skips page 4. Validated against the live probe anyway; a mismatch **fails the
  install** rather than proceeding, and writes the reason to `/LOG`.
- **Ledger mapping cannot be supplied on the command line** and the install completes without it.
  The target stays in `preview` and the panel shows *"Ledger mapping required."* A chart of
  accounts is per-company and guessing at twenty of them is exactly the mistake this design
  refuses to make.
- Every silent install lands in `preview`. **No unattended install ever starts writing into books.**

---

## 14. The CA Profile — Session 19

One install on the CA's own PC, serving many tenants, writing into many Tally companies. This is
`enterprise-strategy.md` §3.5, and it is *"the highest-leverage item in that document that nobody
has asked for yet."*

**Same binary. Same protocol. Same installer. Different profile.** One `target` column and a scope
filter.

### 14.1 What differs

| | Factory (`target='factory'`) | CA (`target='ca'`) |
|---|---|---|
| Installed on | Factory owner's Tally PC | **CA's own PC**, or their hosted-Tally VM |
| Tenants served | 1 | **N** — every client who consented |
| Tally companies | 1 | **N**, one per tenant |
| Data scope | sales, purchase, CDN | **identical** — sales, purchase, CDN. Nothing else, ever. |
| Auth | one tenant-scoped token | one **CA-scoped** token resolving to a set of grants |
| Consent | the tenant owns their own machine | **the tenant, explicitly, per CA — and revocable** |
| Period lock | `target.filed_through` | `GREATEST(target, grant)` per client |
| Inventory | never | never |

**The CA profile is a superset of accounts and a subset of data. That asymmetry is the whole
design.**

### 14.2 Where the agent runs

| Option | Verdict |
|---|---|
| Agent on the **CA's PC**, outbound HTTPS, POST to `127.0.0.1:9000` | ✅ **This is the design.** No inbound rule, no exposed port, no VPN. |
| Agent inside the CA's **hosted-Tally Windows VM** | ✅ Works identically. Set `tally_host` to the VM's own loopback. Still a Windows machine with Tally on it. |
| Cloud → CA's Tally over the internet | ❌ **Impossible.** No public API; Tally.NET blocks import. `[VERIFIED]` |
| Port-forward 9000 from the CA's router | ❌ **Never propose this.** The gateway is unauthenticated — anyone reaching it can read and rewrite every client's books. `[NEVER]` |
| Agent on the **factory's** PC writing to the CA's Tally | ❌ Same objection, and the factory has no reason to reach the CA's LAN. |

### 14.3 The consent flow

1. **Owner** opens Settings → Tally Sync → *"Share with my CA"*, enters the CA's name and email,
   and the **exact Tally company name** as it appears in the CA's install (the CA supplies it —
   CAs name companies things like `ACME ENGG (2024-25)`; it is never inferred from Nexflow's
   `company_name`).
2. The consent screen shows, in the owner's language, exactly `enterprise-strategy.md` §3.5's
   wording:

   > **Your CA receives:** your sales invoices · your purchase bills · your credit and debit notes
   > — document number, date, the other party's name and GSTIN, taxable value, and the GST split.
   >
   > **Your CA does not receive:** your stock levels · what you consumed · your BOM or recipes ·
   > your job work or any principal's material · your material costs or margins · your production
   > volumes · anything belonging to any other Nexflow customer.

3. **"View what your CA receives"** — a screen listing the actual documents and fields, **generated
   from the same payload builder that feeds the queue.** This is the direct analogue of
   `kpml-network-plan.md` §10.5's "view as principal" preview, and its purpose is the same: the
   prose and the enforcement cannot drift apart, because the prose is rendered from the
   enforcement. A leak becomes self-reporting.
4. Row written to `p2_ca_grants`. The CA's agent picks it up on its next `poll`.
5. **The CA accepts a short usage undertaking at install** — one screen, recorded with the
   install: they will keep the machine under their control, will not export the data elsewhere,
   and will stop hand-typing these clients' sales and purchase vouchers (§11.3's social contract).
   `enterprise-strategy.md` §9 Q9's recommendation, implemented: the tenant grants in-app, the CA
   accepts at install, both recorded.
6. **Revocation** is one click, immediate, and does not delete anything already in the CA's Tally
   — stated on the dialog.

### 14.4 Routing to the right Tally company

This is the CA profile's highest-risk mechanic, because **a voucher imported into a different
company than intended is overridden regardless of the F12 setting** `[VERIFIED, §2.2]`. Getting it
wrong means one client's voucher overwriting another's.

Four guards, all required:

1. **`company_name` is per grant, human-confirmed, supplied by the CA.** Never inferred, never
   derived from the tenant's Nexflow company name.
2. **The server never returns a payload whose `SVCURRENTCOMPANY` differs from the grant's
   `company_name`.** It is frozen onto the sync-log row at enqueue (`p2_tally_sync_log.company_name`).
3. **The agent asserts the envelope's `SVCURRENTCOMPANY` equals the company it is about to target,
   and that that company is in the loaded list**, before every POST (§3 D3). A mismatch is
   `invalid_payload` and a `critical` ops alert — it would mean a server bug.
4. **The REMOTEID carries the full tenant UUID inside the hash** (§6.4), so even a routing mistake
   that got past 1–3 could not produce an id collision with another client's voucher. It would
   produce a visibly foreign voucher in the wrong company — bad, but detectable and reversible,
   rather than a silent overwrite.

The agent's cycle iterates **companies**, not rows: for each loaded company that matches an active
grant, claim that grant's work, post it, move on. A company that is configured but not loaded
raises the specific error *"Company 'ACME ENGG PVT LTD' is not open in Tally"* and its work stays
`pending`.

### 14.5 Data isolation — the five guarantees

`enterprise-strategy.md` §3.5, enforced in this order.

1. **Consent is per (tenant, CA), explicit, revocable.** `p2_ca_grants`, §8.3.
2. **One scoped access path.** Every CA-agent read goes through `tally-bridge`, which resolves the
   token to the active grant set and returns only `p2_tally_sync_log` rows for those tenants with
   `target='ca'`. **There is no second route.** This is the architectural answer to
   `kpml-network-plan.md` §10.5's failure mode 6 (*RPC drift — the one that actually happens*):
   scope cannot be forgotten if there is no other way to reach the data.
3. **The queue carries only the finished document.** Because D3 renders server-side, the agent
   receives an XML string containing exactly what a voucher contains — party, GSTIN, state,
   document number, date, taxable value, tax split. **It cannot widen the payload because it never
   sees a payload.** No stock, no consumption, no BOM, no WIP, no job-work internals, no principal
   pool ownership, no s.143 clocks, no challan internals, no material costs, no margins, no
   supplier lists beyond the party on the invoice.
4. **No aggregates spanning tenants.** The agent window shows a **per-client** queue and per-client
   errors. It never shows a total across clients — a cross-client total tells CA staff something
   about client A derived from client B. Same failure mode as `kpml-network-plan.md` §10.5's
   aggregate leak; same rule. This constrains the UI, and the constraint must survive the first
   request for a "dashboard".
5. **"View what your CA receives."** §14.3 step 3.

**Additionally, narrations must carry nothing client-identifying beyond the document number**
(§5.7.1). A CA's staff member reading a Day Book should learn nothing about the client's business
that the invoice itself does not say.

### 14.6 The parallel-run month

**The first month after any install runs in `preview` mode.** `p2_tally_targets.mode` defaults to
`'preview'` (§8.1) and a human must flip it.

In `preview`:

- The agent polls, probes, runs pre-flight, and receives the rendered vouchers.
- **It posts nothing.**
- The agent window and the Nexflow panel both show the full list of vouchers that *would* be
  posted: number, date, party, ledger lines, amounts.
- The CA (or the owner's accountant) continues entering vouchers by hand, as they always have.
- At month end the two are compared. Nexflow's Tally Sync panel has a **"Compare with Tally"**
  action that runs a pre-flight-style scan over the month and shows three columns: in Nexflow
  only, in Tally only, in both with a different amount.

**Go live only when the CA says they agree.** The ₹25,000 Bridge Agent setup fee
(`enterprise-strategy.md` §7) is not margin — *"it buys the parallel-run month that prevents the
expensive failure. Do not discount it to close a deal."*

Flipping to `live` sets `filed_through` to the last day of the last filed month in the same
action, so going live cannot retroactively write into a month the CA already filed.

### 14.7 The three-clean-months gate — measured, not asserted

`enterprise-strategy.md` §3.5 §10:

> **Do not offer the CA integration to a second CA until one CA has filed three consecutive months
> from Nexflow-pushed data with zero corrections attributable to Nexflow.**

A gate stated in prose is a gate that gets argued about. Here is what "clean" means, computed.

**A (target, period) is CLEAN when all five hold, evaluated on the 12th of the following month
(the day after the GSTR-1 deadline):**

| # | Condition | Query |
|---|---|---|
| 1 | Every row for that period reached `sent` | `count(*) FILTER (WHERE status <> 'sent') = 0` |
| 2 | Every row reached `sent` **before the 11th** | `max(sent_at) < <11th> 00:00 IST` |
| 3 | Zero `conflict` rows, ever, for that period | `count(*) FILTER (WHERE status = 'conflict') = 0` |
| 4 | Zero `invalid_payload` rows | `count(*) FILTER (WHERE status = 'invalid_payload') = 0` — these are always Nexflow bugs |
| 5 | **Zero drift** — Tally still holds the amount Nexflow posted, for every row | `count(*) FILTER (WHERE drift_amount IS NOT NULL AND drift_amount <> 0) = 0` |

**Condition 5 is the one that actually measures the gate**, and it is the reason
`p2_tally_sync_log` carries `amount_total`, `verified_at` and `drift_amount`.

**How drift is measured.** On the 12th, the agent runs a **verification scan**: a voucher export
over the previous month, matched by REMOTEID, comparing the party-side absolute amount in Tally
against `amount_total` on the row. Any difference means **a human changed a voucher Nexflow
posted** — which is exactly "a correction attributable to Nexflow", observed rather than reported.
`verified_at` is stamped on every matched row; `drift_amount` and `drift_reason` on any that
differ. A row Nexflow posted that has **vanished** from Tally is drift too, recorded as
`drift_reason='missing_in_tally'`.

This is the same read the pre-flight scan performs, at a different time and for a different
purpose, so it costs no new mechanism.

**Nuance that must not be lost.** A `ledger_missing` failure is a *configuration* error, not a
Nexflow correctness error — but it still makes the month **not clean**, because the CA
experienced a broken month regardless of whose fault it was. Track the two separately:
`clean_month` (the gate) and `nexflow_attributable` (`invalid_payload` + drift), which is what
tells the founder whether the product or the setup is the problem.

**The gate is three consecutive clean months for ONE CA, then scale.** Not three months across
three CAs. `business-strategy.md` §7.1 puts the earliest Tally-integration-channel scale at
roughly August 2027 for exactly this reason, and the March 2027 first-referral target is reachable
through the **filing package** channel and only through it. Do not let this gate become the thing
that slips the referral date — they are different channels with different clocks.

---

## 15. Failure Mode Analysis

Every way this can fail, what the system does, what the **owner** sees, and what the **founder**
sees on the A0 ops channel.

**Dependency:** this section assumes `automation-strategy.md` §3.1 (A0 — the founder ops channel,
`opsAlert()` / `p2_ops_alerts` / `FOUNDER_TELEGRAM_CHAT_ID`) exists. A0 is Wave 0, due before
5 October 2026; E1 is 2027. If for any reason A0 has not shipped when E1 starts, **build A0
first** — every founder-facing line below is otherwise dead code, and a Bridge Agent whose
failures are invisible to the founder is worse than no Bridge Agent.

Severity vocabulary is A0's: `critical` bypasses quiet hours, `important` and `monitor` do not.

### 15.1 Summary table

| # | Failure | System does | Owner sees | Founder sees (A0) |
|---|---|---|---|---|
| 1 | **Tally rejects: ledger does not exist** | `failed` / `permanent`, attempts→5, no retry | Amber row, plain-English line + verbatim `LINEERROR` + **Fix mapping** button | `important`, deduped 24 h per (target, ledger name) |
| 2 | **Tally rejects: voucher type not found** | `failed` / `permanent` | *"TallyPrime has no voucher type named 'Purchase' in this company."* | `important` |
| 3 | **Tally rejects: date out of financial year** | `failed` / `permanent` | *"This voucher is dated 14 Aug 2026. TallyPrime's books for this company begin 1 Apr 2027."* | `important` |
| 4 | **Tally is closed** | `environmental`. **No attempt consumed.** Status stays `pending`. | Tray amber: *"14 documents waiting — TallyPrime is not running."* | **Nothing** until 24 h continuous with a non-empty queue → `monitor`, one per 24 h |
| 5 | **Internet down** | `environmental`. Claimed batch held in memory. Claims expire server-side and re-issue. | Tray amber: *"Waiting for internet."* | Nothing. Heartbeat gap → §15.6's path at 48 h |
| 6 | **Supabase down** | Identical to 5. Agent cannot poll; Tally is untouched. | Same as 5 | A8 (codebase health) already watches Supabase. No Bridge-specific alert. |
| 7 | **Windows restarts for an update** | Agent dies. `HKCU\…\Run` restarts it at next logon. Claims expire in 10 min; journal replays unacked lines. | Nothing, if the owner logs back in | Nothing, unless nobody logs in for 48 h → §15.6 |
| 8 | **Agent process crashes** | Same as 7, minus the restart — see §15.6 | Tray icon disappears | `important` at 48 h stale heartbeat with a non-empty queue |
| 9 | **A voucher is posted twice** | Cannot happen through Nexflow (`UNIQUE` on source_key). If it does, Tally alters in place by REMOTEID. | Nothing — nothing went wrong | Nothing |
| 10 | **Owner uninstalls TallyPrime** | Identical to 4, permanently. Queue grows. | Amber, then the 24 h message | `monitor` at 24 h, `important` at 7 days with a growing queue |
| 11 | **Tally company renamed or moved** | Company probe stops matching → **zero work claimed**. Nothing posted. | Red: *"Company 'DATTA PRASAD ENTERPRISES' is not open in TallyPrime."* + **Change company** | `important`, deduped 24 h. §15.5. |
| 12 | **Posted to Tally, report to Supabase fails** | Journal line unacked → replayed next cycle. If the journal is also lost, the row is retried and Tally alters in place. | Nothing | Nothing, unless replay fails 5× → `important` |
| 13 | **DPAPI ciphertext unreadable** | Agent stops, does not delete the queue | Red: *"This machine's security keys changed. Enter a new pairing code."* | `important` — the founder should call before the owner does |
| 14 | **Token revoked while the agent runs** | Every request → 401. Agent stops claiming. | Red: *"This agent has been disconnected in Settings."* | Nothing — the owner did it on purpose |
| 15 | **Two agents on one target** | Structurally prevented (`UNIQUE (tenant_id,target)`); a second pairing rotates the token and 401s the first | Named confirmation before rotation | `monitor` on any token rotation |
| 16 | **Antivirus quarantines the agent** | Process dies, cannot restart | Tray gone. Heartbeat stale. | `important` at 48 h. §15.7. |
| 17 | **Ledger renamed in Tally after mapping** | Every voucher → `ledger_missing` (#1) | The #1 row, one per document | `important` once, then deduped. §15.8. |
| 18 | **Invoice cancelled in a filed month** | `blocked_period`. Nothing posted. | *"This month has been filed. Your CA must pass a correcting entry in the current month."* | Nothing — correct behaviour |
| 19 | **Tally company restored from an old backup** | Pre-flight finds our REMOTEIDs missing → re-posts as `Create` | Brief burst of activity | `monitor` if >20 rows revert in one scan. §15.9. |
| 20 | **Unbalanced voucher rendered** | `invalid_payload`. **Never posted.** | *"Nexflow could not build this voucher correctly. Support has been notified."* | **`critical`** — this is always a Nexflow bug |
| 21 | **Payload/company mismatch at the agent** | `invalid_payload`, not posted | Same as 20 | **`critical`** — a server bug, and in the CA profile a near-miss on cross-client write |
| 22 | **Update breaks the agent** | Three failed starts → auto-rollback to `.bak`, `target_version` pinned | Nothing, if rollback succeeds | **`critical`** on any rollback |
| 23 | **GRN has no supplier or no invoice number** | `skipped`, never guessed | *"This GRN has no supplier invoice number. Add it in GRN history."* | `monitor`, weekly digest |
| 24 | **Duplicate supplier invoice entered twice** | Same group → same REMOTEID → **one voucher at double the amount** | Nothing from the Bridge | **`important`** — §15.10. The real fix is upstream. |
| 25 | **Clock skew on the factory PC** | Dates come from the DB, not the PC. Only `posted_at` in the journal is affected. | Nothing | Nothing. §15.11. |
| 26 | **Disk full on the factory PC** | Journal append fails → agent refuses to post (fail-closed) | Red: *"Not enough disk space to record what has been sent."* | `important` |

### 15.2 Tally rejects the voucher — the two common cases

**Ledger does not exist.** The most common permanent failure in this product category `[VERIFIED,
§2.7]`. It has a specific remedy and the panel must give it rather than a generic error:

> ⚠ **INV-202608-014 · 31 Aug 2026 · ₹1,18,000.00**
> TallyPrime has no ledger named **"Output CGST"** in this company. Ask your accountant for the
> exact name as it appears in Tally — including spacing — then update it in **Ledger mapping**.
> `LINEERROR: Ledger 'Output CGST' does not exist!`
> [ Fix mapping ] [ Retry ]

**Fix mapping** opens the `ledger_map` editor with that slot focused and the picker already
populated from Tally's live ledger list. Fixing it re-renders **every** `failed` row on that
target (§9.3), so one fix clears a month of failures in one action. That property is what makes
this a two-minute support call instead of a twenty-minute one.

**Voucher type not found.** Rarer, and it means the company genuinely has no `Sales` or `Purchase`
voucher type under that name — usually because the CA renamed it or uses a custom type. Message
names the exact `VCHTYPE` and notes it is case-sensitive. **v1 does not make `VCHTYPE`
configurable.** A custom voucher type is a legitimate request but it interacts with GST reporting
inside Tally in ways this design has not verified; build it when a real CA asks, not before.

### 15.3 Tally is closed — the normal state of the world

Roughly sixteen hours a day. Connection to `127.0.0.1:9000` is refused.

- `environmental`. **No attempt consumed. No alert. Status stays `pending`.**
- Tray amber with a count. Hovering shows *"14 documents waiting — TallyPrime is not running."*
- **Only after 24 continuous hours unreachable AND a non-empty queue** does the agent raise one
  in-app `p2_notifications` row and one Telegram message:

  > Tally has not been reachable since 4 Sep. 14 documents are waiting to sync. Open TallyPrime
  > and load "DATTA PRASAD ENTERPRISES".

- **Rate-limited to one per 24 hours per tenant.** The notification pipeline has zero retries and
  six documented silent-failure points (`codebase-audit.md` §4.5); adding a chatty producer to it
  would train the owner to mute it, which is the actual failure mode.

Distinguish **refused** (nothing listening — Tally closed, or connectivity setting off) from
**timeout** (something listening but not answering — Tally busy or mid-backup). Refused is
`environmental`; timeout is `transient`. Conflating them either burns attempts overnight or hides
a genuinely stuck Tally.

### 15.4 The agent crashes, or Windows restarts

Three mechanisms, in order:

1. **`HKCU\…\Run` restarts it at the next logon.** On a factory PC that is usually the next
   morning.
2. **Claims expire after 10 minutes** server-side, so a crash mid-batch holds nothing hostage.
3. **The journal replays** any post whose report never landed (§10.6).

**The gap this leaves, named honestly:** if the machine is restarted and **nobody logs in**, the
agent does not run. A Run-key app requires an interactive session. That is also true of Tally, so
nothing is syncing anyway — but the *heartbeat* goes stale, and at 48 hours with a non-empty queue
the founder gets an `important` alert and the panel tells the owner. This is the correct trade
(§13.2): a service would run without a login and still have no Tally to talk to.

### 15.5 The Tally company is renamed or moved

The company probe (§11.1) stops matching. **Zero work is claimed. Nothing is posted.**

This is the design's most important defensive property, because the alternative is the protocol's
signature silent failure: a mismatched `SVCURRENTCOMPANY` returns `HTTP 200 / ERRORS=0` with an
empty Day Book `[VERIFIED]`. Without the probe, a rename would fill the sync log with `sent` rows
describing vouchers that exist nowhere, and it would be discovered by the CA in filing week.

Owner sees red, with the exact mismatch:

> ❌ **Nexflow cannot find the company "DATTA PRASAD ENTERPRISES" in TallyPrime.**
> TallyPrime currently has open: *Datta Prasad Enterprises (2026-27)*.
> If you renamed the company, update it here. **Nothing has been written to the wrong place.**
> [ Change company ]

**Change company** re-runs the probe and offers the loaded list as a dropdown. Changing it
re-renders every `pending`/`failed` row with the new `SVCURRENTCOMPANY` and **re-runs the
pre-flight scan** for every period touched, because the new company may already contain those
vouchers — or may be a different company entirely.

**A moved data directory** with the same company name is invisible to us and needs nothing: Tally
resolves the path, we address the name.

### 15.6 A crashed or uninstalled agent looks like a quiet month

Both produce: no errors, no failures, nothing moving. `last_seen_at` is the only difference and it
is why the heartbeat updates on **every** poll, including polls that claim nothing.

| Staleness | Action |
|---|---|
| > 48 h | Panel: *"The Bridge Agent on DESKTOP-7F2K1 has not checked in since 9 Sep."* |
| > 48 h **and** queue non-empty | `important` ops alert, deduped 24 h |
| > 14 days | `important`, escalated wording — treat as uninstalled and call the client |

### 15.7 Antivirus quarantines the agent

Realistic for a new, low-reputation, self-extracting single-file binary (§3 D4's second wart).

- The process dies and cannot restart. Indistinguishable from #8 at first.
- Heartbeat goes stale → the 48 h path.
- **Mitigations, in order of effectiveness:** sign every release with a consistent identity;
  publish the SHA-256 of every release on the Nexflow site so an IT contractor can verify;
  `EnableCompressionInSingleFile=false` to reduce the self-extract heuristic; and submit false
  positives to the AV vendor, which is a founder task and belongs in the support runbook.
- The install documentation names the exact install path so an exclusion can be added:
  `%LOCALAPPDATA%\Programs\Nexflow Bridge\`.

### 15.8 A ledger is renamed in Tally after mapping

Every subsequent voucher fails `ledger_missing` (#1). Correct behaviour — the agent must not guess
at a replacement — but the volume is the problem: a month of documents each producing an alert.

- **Dedupe the ops alert on (target_id, ledger_name)** for 24 h. One alert, not two hundred.
- **The panel groups by cause**, not by document: *"47 documents are waiting because TallyPrime
  has no ledger named 'Output CGST'."* with one **Fix mapping** button.
- After the fix, every affected row re-renders and retries automatically.

The grouping is the difference between a panel that helps and a panel that is a wall of red.

### 15.9 A Tally company is restored from an old backup

The pre-flight scan finds our REMOTEIDs missing for a period we believe is `sent`.

**The agent must not silently re-post a month.** It does this instead:

- Detects the reversion: > 20 rows previously `sent` are now absent from Tally in one scan.
- **Pauses the target** (`mode='paused'`) and raises a `monitor` alert.
- Panel: *"TallyPrime no longer contains 84 vouchers Nexflow previously wrote, dated 1–31 Aug 2026.
  This usually means the company was restored from a backup. Nexflow has paused. Press Re-sync to
  write them again."*
- On **Re-sync**, the affected rows go back to `pending` and post as `Create`.

Pausing rather than auto-repairing is deliberate: a mass disappearance might equally be a wrong
company selected, a data corruption, or a deliberate deletion by the CA. Writing 84 vouchers into
a company on a guess is not recoverable; asking is.

### 15.10 The same supplier invoice entered twice

Covered in §4.4 and repeated here because it is the failure this feature is **blocked on**.

Two GRN entries of `TSL/2608/0142` group into one voucher (§4.2) with one REMOTEID (§6.2). Tally
alters in place. Result: **one Purchase voucher at double the correct amount** — visually
indistinguishable from a correct voucher in the Day Book.

- The Bridge Agent cannot detect it. Nexflow's own data says the purchase was that size.
- The **upstream guard is the fix**: `grn.html`'s live UI warning (Session 12) plus the DB backstop
  partial unique index (`CLAUDE.md` Known Open Items #1), which **must be applied before the first
  real deployment** because `scanner.html`'s GRN path still has no duplicate check.
- **Secondary detection, which this design adds:** at enqueue, compare `amount_total` against the
  previously `sent` amount for the same `source_key`. A **re-render whose amount grew by more than
  40%** raises an `important` ops alert naming the invoice number before the post goes out. It is
  a heuristic, it will occasionally fire on a legitimate added line, and that is the correct
  trade — a false alert costs a glance; a doubled purchase costs an ITC claim.

### 15.11 Clock skew

**Every date in every voucher comes from the database**, never the factory PC's clock: `DATE` from
`invoice_date` / `transaction_date`, `period` computed server-side in IST.

The PC's clock affects only `posted_at` in the local journal and the update-check interval.
Neither can produce a wrong voucher.

This is worth stating because `CLAUDE.md` documents a whole class of IST/UTC off-by-one bugs
(`todayIST()`, five call sites, fixed Sept 2 2026). **The Bridge Agent is immune to that class by
construction, and it must stay immune — no date may ever be derived from the agent's clock.**

### 15.12 Nexflow renders something invalid

`invalid_payload` — unbalanced, wrong company, REMOTEID mismatch.

- **Never posted.** The agent refuses before the POST.
- **`critical` ops alert, every time, no dedupe.** These are always Nexflow bugs, never client
  problems, and they mean the builder produced something that would have corrupted a statutory
  book.
- Owner sees: *"Nexflow could not build this voucher correctly. Support has been notified and will
  contact you. Nothing was written to TallyPrime."* — which is true, complete, and does not ask
  the client to do anything.

### 15.13 Data-quality signals the Bridge Agent surfaces

The agent sees every document at the moment it becomes accounting. That makes it a second,
**earlier** detector for the things the monthly Opus covering note already catches — and earlier
is the whole value, because a wrong number caught on the 3rd is fixable before filing.

| Signal | Severity | Why |
|---|---|---|
| A purchase at 0% GST for a material whose peers are at 18% | `important`, batched weekly | Datta Prasad had 15 such lines in August. §5.4. |
| A GRN group with no supplier or no invoice number | `monitor`, weekly | One orphan in Datta Prasad's August data. |
| A tenant with `filing_package_enabled` and a Bridge target whose queue has been non-empty for >7 days | `important` | The filing package and the books are diverging. |
| Any `sent` row whose Tally amount later drifts | `monitor` | A human edited a Nexflow voucher. Also the clean-month input (§14.7). |

**These are alerts, never corrections.** The Bridge Agent reports what Nexflow holds. It never
edits a source row, and it never "fixes" a rate on the way past. If it did, Nexflow's ledger and
the client's books would disagree and nobody would know which was right.

---

## 16. What Competitors Get Wrong

From §2.7's research, including the published support documentation of two live Indian products.
Each item is a design requirement, not an observation.

### 1. A human has to press a button

The most common shape in this category. One live product's own help page describes the workflow as
*"use the **Send transaction to Tally** button after selecting appropriate ledgers"*, with Tally
open and the company loaded. Another is a desktop app the accountant drives by hand.

**That is not automation; it is a faster form of typing.** The whole value proposition — *"the ten
days of typing disappear"* — requires that nobody presses anything.

> **Nexflow:** the agent polls on a timer and posts unattended. The only buttons a human ever
> presses are **Retry** on a failed document and **Go live** at the end of the parallel-run month.

### 2. No idempotency key, so re-running duplicates

Practitioner guidance for Tally imports is explicit: *"Voucher number is the only check point for
Tally when you are importing any data from XML"*, and the recommended workaround is to set the
voucher type's numbering to **Manual** with *Prevent Duplicates*. That is a **Tally
configuration** standing in for something the integration should own.

Tally's own two-way synchronisation has the same problem from the other direction: duplicates
occur *"when the same transaction is modified in different locations before synchronisation."*

> **Nexflow:** three independent layers — a `UNIQUE` constraint in Postgres so a document is
> queued once, a permanent SHA-256 `REMOTEID` so Tally alters rather than duplicates, and a
> pre-flight scan so a voucher already present is never re-posted. §11. And because Nexflow is
> **one-way**, the two-writer problem that duplicates Tally's own sync does not exist at all.

### 3. Silent failure on a company-name mismatch

*"Import completed"* with an empty Day Book. No error at the HTTP layer, no error in the response.
The user's next signal is their CA, in filing week.

> **Nexflow:** a company-list probe **before every cycle** (§11.1), and `CREATED + ALTERED >= 1`
> as part of the success test (§5.9). A mismatch claims zero work and says so in plain English
> (§15.5). It is structurally impossible for Nexflow to mark a document `sent` that did not land.

### 4. The user is told to read a log file in Notepad

One live product's documented troubleshooting procedure: *"check the IMP file in Tally's
application folder, search for `Error: 1` using Notepad, identify the specific error message, then
correct the issue and resend."*

A factory owner in MIDC will not do this. Their accountant might, once.

> **Nexflow:** the verbatim `LINEERROR` is captured from the response and stored on the row. The
> panel shows a plain-English sentence with the specific remedy **above** the raw message, and a
> button that goes to the thing that needs fixing. **The owner never opens `Tally.imp`.** (Keeping
> the raw message visible is not a compromise — the CA needs it, and hiding it would send them
> back to the log file.)

### 5. A renamed or altered ledger breaks the sync with no recovery path

Tally's own synchronisation FAQ names *"ledger names being altered or deleted"* as a standard
cause of failure. Third-party connectors typically surface it as a per-transaction error with no
bulk remedy, and some respond by **creating** the missing ledger — which quietly corrupts the CA's
chart of accounts, and is not visible until the trial balance is wrong.

> **Nexflow:** the agent creates **party ledgers only** and never invents a sales, purchase, tax or
> round-off ledger (§5.6). A mapped ledger that disappears produces one grouped, deduped error —
> *"47 documents are waiting because TallyPrime has no ledger named 'Output CGST'"* — with one
> **Fix mapping** button that re-renders and retries all 47. §15.8.

### 6. Names are typed, not picked

Every failure in items 3 and 5 traces back to a human typing a name that must match exactly.
Trailing spaces from copy-paste into Tally are a documented real-world cause of *"Ledger does not
exist"*.

> **Nexflow:** **nothing is typed.** The company comes from a dropdown populated by a live probe;
> every ledger comes from a dropdown populated by Tally's own ledger list, filtered to the legal
> parent group for that slot. §13.3. This eliminates the class rather than handling it.

### 7. Accuracy is asserted, never measured

Reviews of these products land on *"review is still required"* and *"proper configuration
matters"* — true, and an admission that nothing in the product tells you whether last month was
right.

> **Nexflow:** a monthly **verification scan** compares what Tally holds against what Nexflow
> posted, per voucher, by REMOTEID, and records the difference (§14.7). "Was last month clean" is a
> query, not an opinion. It is also the gate on offering the integration to a second CA — a claim
> nobody in this category can make because nobody else measures it.

**The pattern across all seven:** these products treat Tally import as a *file format problem*.
It is an *operational reliability problem*, and every one of the seven is a consequence of
solving the wrong one.

---

## 17. Build Sequence

### 17.1 What can be built before the code-signing certificate

**Everything except the signed installer.** The certificate is a distribution gate, not a
development one, and `enterprise-strategy.md` §6 lists it as blocking E1 — which is true of
*deployment to a client*, not of the build.

Buildable, tested and demonstrable with **zero** certificate:

- The whole `tally-bridge` Edge Function and every mode.
- The schema, RLS, indexes, migration.
- The shared voucher builder and REMOTEID module, with the `full-export.js` parity test.
- The Settings → Tally Sync panel, end to end.
- The entire agent: tray, wizard, poll loop, journal, pre-flight, update mechanism.
- The Inno Setup installer itself — **unsigned**. It installs and runs; Windows shows
  *"Windows protected your PC"* and the user clicks **More info → Run anyway** once per machine.
- A complete live demo against a real TallyPrime on the founder's own machine.

**Not possible without it:** installing on a client's machine without an alarming dialog, and
building publisher reputation (which only accumulates on a consistent signing identity, so it
cannot start early with a throwaway certificate).

**Do the whole build unsigned, then sign.** Signing is two lines in the Inno script and a
`signtool` invocation. Waiting for incorporation to start writing code would be the most expensive
possible sequencing mistake — incorporation is ~1 month to contracting-ready and the E1 build is
3–4 weeks. Run them in parallel.

### 17.2 The minimum viable demo

The KPML meeting and every Segment 3 sales conversation need a demo, not a deployment. What is
needed:

- The founder's Windows laptop with TallyPrime installed (the free educational build is **not**
  sufficient — it restricts voucher dates; buy one licence, it is a business expense against a
  ₹2.2 lakh Year-1 product).
- A scratch Tally company named `NEXFLOW DEMO FACTORY` with the ledgers from §8.1.1 pre-created.
- The test tenant (`fe2b94fb-…`), paired, in `live` mode.
- The unsigned agent running in the tray.

**The demo, ninety seconds:** raise an invoice in Nexflow on the laptop. Switch to Tally. Open the
Day Book. The voucher is there, with the right ledgers, the right GST split, and a narration
saying `src:NXF-…`. Say nothing while it happens.

That is the entire pitch for Segment 3, and it works with no certificate, no incorporation and no
client.

### 17.3 Session 18 — the factory profile

Roughly 3–4 weeks. Order matters: the build is sequenced so a working demo exists at step 7 and
everything after it is hardening.

| # | Step | Output |
|---|---|---|
| 1 | **Prerequisite: GRN duplicate-invoice DB backstop** | `CLAUDE.md` Known Open Items #1's partial unique index, applied to all four tenants. §4.4. |
| 2 | Migration `20261101_bridge_agent.sql` | Three tables, RLS enabled, 9 policies, 7 indexes. Test tenant first, regression snapshot diffed. §8.6. |
| 3 | `_shared/tally-remoteid.ts` + tests | §6. Test vectors are the three worked examples in §6.3. |
| 4 | `_shared/tally-voucher.ts` + parity test | §5. The parity test against `js/full-export.js` **is the acceptance criterion for this step.** §5.8. |
| 5 | `tally-bridge` Edge Function | All seven modes. §9. |
| 6 | Enqueue hooks + the 15-minute sweeper | §9.3. The sweeper is not optional. |
| 7 | **Agent v0.1: poll → post → report** | No tray, no wizard, hardcoded config. **First end-to-end voucher into a real Tally.** Demo-capable. |
| 8 | Agent: probe, pre-flight, legacy adoption | §11, §6.5. |
| 9 | Agent: tray, status window, journal | §10.1, §10.6. |
| 10 | Agent: pairing + DPAPI | §7.2, §7.4. |
| 11 | Agent: auto-update + rollback | §12. |
| 12 | Inno Setup installer + six-page wizard | §13. **Unsigned** at this stage. |
| 13 | Settings → Tally Sync panel | §10.5. |
| 14 | A0 ops alerts wired for every §15 case | §15. |
| 15 | Failure-mode test pass | §20's checklist, every row, on a scratch company. |
| 16 | **Field pilot: one machine, 30 days** | Founder's own machine, then one client in `preview`. |

**Steps 1–4 must not be reordered.** The REMOTEID and the voucher builder are what everything else
addresses; getting them wrong after documents are in a client's books is not correctable by a code
change.

### 17.4 Session 19 — the CA profile

Gated on: **Session 18 stable for one month on at least one real client.**
`enterprise-strategy.md` §6's dependency graph — *E1 Bridge Agent (factory) — 1 month stable → §3.5
CA Agent* — and it is a real gate, not a formality. The CA profile multiplies the blast radius of
every Session 18 bug by the number of that CA's clients.

Roughly 1–1.5 weeks, because the binary, the protocol and the installer are unchanged.

| # | Step |
|---|---|
| 1 | `p2_ca_grants` is already created (§8.3). Add the consent UI in Settings. §14.3. |
| 2 | `tally-bridge`: resolve a `target='ca'` token to the active grant set. The **single scoped access path**. §14.5 guarantee 2. |
| 3 | Agent: iterate companies rather than rows; per-company claim, post, pre-flight. §14.4. |
| 4 | Agent UI: **per-client** queues and errors. **No cross-client totals, ever.** §14.5 guarantee 4. |
| 5 | "View what your CA receives" screen, generated from the payload builder. §14.3 step 3. |
| 6 | CA usage undertaking at install, recorded. §14.3 step 5. |
| 7 | Per-grant `filed_through`; effective lock = `GREATEST(target, grant)`. §11.5. |
| 8 | Verification scan + clean-month computation. §14.7. |
| 9 | **Parallel-run month with one CA**, then the three-clean-months gate before a second CA. |

### 17.5 First real client deployment checklist

Run in order. Do not skip a step because the client seems keen.

**Before the visit**

- [ ] PVT LTD incorporated; OV certificate issued; installer signed.
- [ ] GRN duplicate-invoice index applied to this tenant.
- [ ] `p2_tenant_settings.gstin` present and its state code resolves (§5.3 correction).
- [ ] Every `p2_clients.gstin` and `p2_suppliers.gstin` that will appear in the first month's
      documents is filled. A missing GSTIN is not fatal but it is a voucher a CA has to touch.
- [ ] The client's **CA is in the room, or has agreed to the ledger mapping in writing.** The
      chart of accounts is the CA's, not the owner's.
- [ ] Confirm the client is on **TallyPrime**, not ERP 9 (§3 D2).
- [ ] Ask which months are already filed. That becomes `filed_through`.

**At the machine**

- [ ] TallyPrime running, target company loaded, **not** educational mode.
- [ ] F1 → Settings → Connectivity → acts as **Both**, port 9000.
- [ ] F12 → Overwrite Vouchers during import (Remote GUID match) = **Yes**.
- [ ] Sales and Purchase voucher numbering = **Manual**, Prevent Duplicates = **Yes**.
- [ ] Company books-beginning date covers the intended period.
- [ ] **Take a Tally backup before installing. Written into the runbook, not optional.**
- [ ] Install (expect one SmartScreen click — warn them first, §0 C1).
- [ ] Pair, probe, pick the company from the dropdown, map every ledger from the picker.
- [ ] Set `filed_through`.
- [ ] Confirm the target is in **`preview`**.

**Parallel-run month**

- [ ] Week 1: check the preview list against what the accountant typed. Differences now are
      mapping errors, and this is the cheap time to find them.
- [ ] Week 4: run **Compare with Tally**. Reconcile every difference before going live.
- [ ] **The CA signs off**, in writing, that the preview matches their entries.
- [ ] Flip to `live`. Confirm `filed_through` moved to the last filed month.

**Month 1 live**

- [ ] Day 3: check the queue is draining.
- [ ] Day 11: every document for the month is `sent`.
- [ ] Day 12: verification scan. **Zero drift is the target**; any drift is a conversation with
      the CA about what they changed and why.
- [ ] Record whether the month was clean (§14.7). That counter is the gate on the second CA.

### 17.6 Where E1 sits in the wider roadmap

Unchanged from `enterprise-strategy.md` §6: **E4 → E3 → E2 → E1**. E4 and E3 shipped (Sessions 13
and 14); E2 shipped (Sessions 15 and 16). E1 is last and is the long pole.

`CLAUDE.md`'s "What to build next" places Session E1 at **item 16, gated on 40+ clients**, after
A0/A6 and the KPML meeting. Two notes for whoever schedules it:

- **A0 and A6 come first and have a hard October 2026 deadline.** Nothing in this document
  displaces them. A6 is a *distribution* dependency (`business-strategy.md` §7.1); E1 is not.
- **The 40-client gate and the Segment 3 sale are in tension, and the founder should decide
  explicitly rather than by default.** E1 is what closes PVT LTD job-worker conversions
  (`enterprise-strategy.md` §6), and Segment 3 is where the ₹2.2 lakh Year-1 price lives. If a PVT
  LTD prospect appears at 12 clients, the gate is a scheduling convention, not a law — but it does
  cap Enterprise at 25 installs until support is measured (`enterprise-strategy.md` §7), and that
  cap is a real constraint on founder hours, which is the binding resource.

---

## 18. Explicitly Out of Scope `[NEVER]`

Inherited from `enterprise-strategy.md` §3.1 and §8, restated here because this is the document a
Bridge Agent session will read.

1. **Reading Tally data into any Nexflow table.** Reads are permitted only for the four purposes in
   §3 D6, and **nothing read is ever persisted** except the ledger names the owner explicitly
   picked into `ledger_map`. One-way means one-way.
2. **Stock items, inventory vouchers, godowns, batches, cost centres.** §0 C3.
3. **Journal, contra, payroll, TDS, depreciation, bank reconciliation.**
4. **Opening balances or migration of historical data.** The client's ten years stay where they
   are.
5. **Creating or altering any non-party master.** Party ledgers only, forever. §5.6.
6. **Writing into a period on or before `filed_through`.** §11.5.
7. **Deleting anything in Tally, ever, under any circumstance.** There is no delete path in the
   code. A correction is a new voucher or a REMOTEID-keyed alteration.
8. **Exposing port 9000** to the LAN or the internet, or asking a client to port-forward it. §7.6.
9. **Any read-back from a CA's Tally into Nexflow**, beyond the probe and the pre-flight scan.
10. **Any other client's data**, in the CA profile. Structurally impossible by design, not merely
    prohibited. §14.5.
11. **Filing.** The CA files, from Tally, with their own DSC, exactly as they always have.
    `CLAUDE.md`'s GST Scope is permanently locked.
12. **A CA-side dashboard, multi-client reporting, practice management or billing.** Not until
    `enterprise-strategy.md` §9 Q8 is answered and a named CA asks. §14.5 guarantee 4 forbids the
    cross-client aggregate such a dashboard would be built on.
13. **Dispatch-driven sync.** §0 C2. This one will be proposed again; it is wrong every time.

---

## 19. Open Questions

Everything this design could not resolve without a physical TallyPrime, ordered by when it blocks.

### Blocking the voucher builder — resolve in Session 18 step 4

**Q1. The exact company-list export request.** §3 D6 purpose 1 assumes
`<REPORTNAME>List of Companies</REPORTNAME>` under `TALLYREQUEST=Export`. Sources give slightly
different spellings.
**Resolve:** send each candidate to a live TallyPrime with two companies loaded and keep the one
that returns both names. Record the exact working envelope in this document.

**Q2. The F12 "Overwrite Vouchers during import (Remote GUID match)" setting.** Two things are
unknown: its exact polarity (sources contradict each other on whether enabling it overwrites or
duplicates), and whether it is **readable over the XML gateway** so the installer can verify it
rather than instruct.
**Resolve:** on a scratch company, post the same REMOTEID twice with the setting on, then off, and
observe. Then attempt to read it via a configuration export.
**Note:** the design is correct either way (§11.4). This determines the installer's wizard page 5
only — verify versus instruct.

**Q3. The educational-mode probe response.** §3 D2 refuses to sync into educational mode, which
requires detecting it.
**Resolve:** run the version probe against an educational TallyPrime and record the exact
distinguishing field.

**Q4. The voucher cancellation tag.** §5.3 assumes `ACTION="Alter"` + `<ISCANCELLED>Yes</ISCANCELLED>`.
**Resolve:** cancel a voucher by hand in Tally, export it, and mirror the file field for field.
This is the same procedure `enterprise-strategy.md` §3.1 prescribes for the whole envelope and it
is **not optional**: *"create a scratch company, enter one Sales and one Purchase voucher by hand,
then export them. That file is the specification."*

**Q5. `ACTION="Create"` on an existing ledger.** Whether it is a no-op, an alter, or an error
varies by build (§5.6).
**Resolve:** test on a scratch company. The design already reads the ledger list first and skips,
so this only determines whether that read is a safety net or a requirement.

**Q6. `ALLLEDGERENTRIES.LIST` versus `LEDGERENTRIES.LIST`.** Tally's own sample XML uses the
latter; `js/full-export.js` and `enterprise-strategy.md` §3.1 use the former. Both appear in the
wild and both are accepted in practice, but a CA-visible voucher must be built the way **Tally
itself** builds one.
**Resolve:** the hand-entered-and-exported voucher from Q4 settles it. **Whichever it uses, use
that, and change `js/full-export.js` to match in the same session.**

**Q7. REMOTEID maximum length.** §6.2 produces 33 characters. Tally's own remote GUIDs are ~40, so
33 is almost certainly safe, but the limit is undocumented.
**Resolve:** post a voucher with a 33-character REMOTEID, re-export it, and confirm the value came
back whole.

### Blocking the installer — resolve in Session 18 step 12

**Q8. Which Tally settings are machine-readable?** Wizard page 5 (§13.3) wants to verify three
settings. Any that cannot be read become instructions with a checkbox.
**Resolve:** attempt a configuration export for each. Record which worked.

**Q9. Does the ledger-list export include the parent group?** §13.3's pickers filter each slot by
legal parent group. If the parent is not returned, the picker shows an unfiltered list — usable,
but worse.
**Resolve:** export the ledger list and inspect.

### Commercial and sequencing

**Q10. OV or EV, given C1?** `[RECOMMENDED: OV]`. EV buys nothing for SmartScreen since 2024 and
costs ₹10,000–₹25,000/yr more. The only argument for EV is a Segment 3 procurement checklist that
names it.
**Decide before:** ordering the certificate. Ask the first PVT LTD prospect whether their vendor
onboarding mentions code signing at all. It almost certainly does not.

**Q11. Physical HSM token or cloud HSM signing?** `[RECOMMENDED: cloud HSM]`. A physical token
means the build only works at one desk and a lost token means re-issuance; cloud HSM signs from
anywhere and integrates with an unattended build.
**Decide before:** ordering. Confirm the Indian reseller actually offers it.

**Q12. Does the factory agent ever push receipts and payments?**
`enterprise-strategy.md` §9 Q7, unchanged. `p2_payment_receipts` and `p2_supplier_advances` are
complete enough to post as Receipt and Payment vouchers, but doing so takes Nexflow from "GST
documents" into "sub-ledger", which edges toward §8 item 3.
`[RECOMMENDED: never on the CA profile; on the factory profile only if a client asks by name.]`
**Decide before:** E1 v2. Not v1.

**Q13. Is `VCHTYPE` ever configurable?** §15.2 defers it. A CA using a custom voucher type
(`Sales - Job Work`) would need it, and it interacts with GST reporting inside Tally in ways this
design has not verified.
**Decide before:** the second CA. Build only on a named request.

**Q14. What is the support model at 25 installs?** `enterprise-strategy.md` §9 Q14, unchanged and
still open. The estimate is 4–8 founder-hours per client per year; at 25 clients that is 100–200
hours.
**Action, and this document makes it possible:** the heartbeat, `agent_version`, failure classes
and the verification scan are all instrumented from v1. **After ten installs, replace the estimate
with the measured number** and write it into `enterprise-strategy.md` §7. The 25-install cap should
be lifted or lowered on data, not on optimism.

---

## 20. Acceptance Tests

The Bridge Agent is done when every one of these passes on a scratch TallyPrime company. Run the
whole list before the first client install, and again before any release that touches the builder.

### 20.1 Voucher correctness

1. A single-rate intrastate Sales voucher lands with the exact ledgers, amounts and GST split of
   §5.3, and the Day Book shows it balanced.
2. An interstate Sales voucher produces one IGST line and a `PLACEOFSUPPLY` derived from the
   client's GSTIN, not the tenant's.
3. A multi-rate Purchase voucher (§5.4) produces one purchase + tax set **per rate**, and balances.
4. An invoice with a non-zero `round_off` emits the round-off line and still sums to `0.00`.
5. A voucher whose ledger map is missing one key is **never posted** and reports `ledger_missing`
   naming the key.
6. The parity test: for a fixed fixture set, `_shared/tally-voucher.ts` and `js/full-export.js`
   produce byte-identical voucher bodies apart from `REMOTEID`.

### 20.2 The two hard invariants

7. A GRN row with `owned_by IS NOT NULL` **never** produces a Purchase voucher — asserted at the
   query, the builder and the enqueue guard. Deliberately plant one and confirm all three fire.
8. A `job_work_return` dispatch produces **nothing**. So does every other
   non-`SALE_INVOICEABLE_PURPOSES` movement.

### 20.3 Idempotency

9. Posting the same document twice alters in place. The Day Book shows **one** voucher.
10. A document already in Tally under its **legacy** `nexflow-…` id is **adopted**, not duplicated
    (§6.5). Verify with a real `vouchers-FY….xml` from "Export All Data".
11. A human-typed voucher with the same number and no Nexflow REMOTEID produces `conflict`, is
    **never** overwritten, and offers the three choices in §11.3.
12. Killing the agent mid-batch and restarting produces no duplicate and no lost document.

### 20.4 Failure handling

13. Close Tally: status stays `pending`, **`attempts` does not increase**, tray goes amber, no
    alert before 24 h.
14. Rename the Tally company: **zero** work is claimed, nothing is posted, the panel names both
    the expected and the loaded company.
15. Delete a mapped ledger: every affected row fails `permanent`, the panel groups them into **one**
    message, and fixing the mapping re-renders and retries all of them.
16. Unplug the network mid-cycle: the claimed batch is held, claims expire server-side, nothing is
    lost or duplicated.
17. Kill the agent between the Tally POST and the report: the journal replays and the row reaches
    `sent` exactly once.
18. Hand-craft an unbalanced payload server-side: the agent **refuses to post**, the row is
    `invalid_payload`, and a `critical` ops alert fires.
19. Set `filed_through` to cover a pending document: it goes `blocked_period` and is never claimed.

### 20.5 Security

20. The agent's on-disk state contains **no plaintext token** — inspect `credentials.dat` and
    `config.json` by hand.
21. Copy `credentials.dat` to a second machine: it cannot be decrypted.
22. Revoke the token in Settings: the next request is `401` and the agent stops claiming
    immediately.
23. Present the agent token to any Supabase endpoint other than `tally-bridge`: nothing happens.
24. Network-capture a full cycle: the only destinations are the Supabase project host and
    `127.0.0.1`. **No other host appears.**
25. `netstat` while the agent runs: **no listening socket**.

### 20.6 CA profile (Session 19)

26. A CA agent with two grants posts each tenant's vouchers into that tenant's own company, and
    the agent asserts the company before every post.
27. Revoking a grant stops new work for that tenant **immediately** and touches nothing already in
    Tally.
28. The agent UI shows **no** cross-client total anywhere. Read every screen.
29. "View what your CA receives" is rendered from the same payload builder that feeds the queue —
    change a field in the builder and confirm the screen changes with it.
30. A per-grant `filed_through` earlier than the target's is the one that binds.

### 20.7 Install and update

31. Silent install with `/PAIRCODE` and `/COMPANY` pairs, validates the company against a live
    probe, and lands in **`preview`**.
32. A silent install with a wrong `/COMPANY` **fails** and writes the reason to the log.
33. An update downloads, verifies SHA-256 **and** the Authenticode publisher, swaps atomically and
    restarts.
34. A deliberately broken update rolls back after three failed starts, pins `target_version`, and
    raises a `critical` alert.
35. A version below `min_supported_version` stops claiming work and says why.

---

*Last updated: 11 September 2026.*
*This is a living document. Update it in place as it is built — move `[RECOMMENDED]` to
`[DECIDED]`, close `[UNVERIFIED]` items with what the live Tally actually returned, and record
what was built. The §19 answers in particular must be written back here the day they are found,
because the next session will otherwise re-derive them from the same ambiguous sources.*
