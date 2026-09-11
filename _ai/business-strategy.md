---
name: business-strategy
description: Nexflow master financial and strategic plan — founder exit goal, pricing across all tiers, full cost structure at 3/10/50/100/500/1000 clients, revenue projections to exit, exit strategy and acquirer analysis, competitive moats, distribution, hiring, payment strategy. Read for any commercial, pricing or financial decision.
sources: [founder-decisions-sept-2026, enterprise-strategy.md, automation-strategy.md, tutorial-engine.md, CLAUDE.md, kpml-network-plan.md]
last_updated: 11 September 2026
status: living document — update in place, do not fork
---

# Nexflow — Business Strategy

**Load order for a commercial session:** `_ai/CLAUDE.md` → this file → `_ai/enterprise-strategy.md`
(pricing detail, segments) → `_ai/automation-strategy.md` (cost detail, founder hours).

This document covers everything about the business that is **not** product or technology. What it
costs, what it earns, what it is worth, who buys it, and what the founder is actually trying to
achieve. `enterprise-strategy.md` says what Nexflow sells. `automation-strategy.md` says what it
costs to run. `tutorial-engine.md` says how clients learn it. This document is the one that says
**why**, and it is the one to load before any conversation about price, hiring, funding or exit.

Every figure here is reconciled against the other four documents. Where a figure in the founder's
brief does not survive its own arithmetic, it is marked `[CORRECTION]` and the corrected number is
given. There are four of those and each one changes a decision.

## Tag convention

Inherited from `enterprise-strategy.md` and `automation-strategy.md`, unchanged.

| Tag | Meaning |
|---|---|
| `[DECIDED]` | The founder has decided this. Do not relitigate. |
| `[RECOMMENDED]` | This document's recommendation. Needs founder sign-off. |
| `[VERIFIED]` | Reconciled against a source document or arithmetic, 11 Sept 2026. Safe to build on. |
| `[UNVERIFIED]` | Needs an external check (CA, market data) before it is relied on. Listed again in §10. |
| `[CORRECTION]` | The brief states something its own arithmetic contradicts. Read the correction. |
| `[NEVER]` | Permanently out of scope. |

---

## 1. Founder's Goal

### The number

`[DECIDED]` **₹300 crore post-tax, from a single exit, 7–9 years from September 2026.**

`[DECIDED]` **Minimum acceptable: ₹150 crore post-tax.**

### Why this number and not a different one

The target is not an ego figure and it is not derived from a comparable. It is derived backwards
from an income requirement.

| | Target | Minimum |
|---|---|---|
| Post-tax capital | ₹300 Cr | ₹150 Cr |
| At 10% annual return | **₹30 Cr/year** | **₹15 Cr/year** |
| At a conservative 6% real withdrawal | ₹18 Cr/year | ₹9 Cr/year |

₹30 crore a year is enough to live anywhere in the world, at any standard, permanently, without
working. That is the entire specification. The capital number is whatever produces that income;
everything else in this document is in service of reaching it.

> `[VERIFIED]` **The goal is robust to a much lower return assumption, and this matters.** A 10%
> *withdrawal* rate is aggressive — long-run Indian equity returns are nominally higher, but a
> sustainable inflation-adjusted withdrawal is closer to 4–6%. At 6%, ₹300 Cr still yields ₹18
> Cr/year and even the ₹150 Cr minimum yields ₹9 Cr/year. Both clear the stated purpose with room.
> **Do not let the 10% assumption become load-bearing** — the plan does not need it, and building
> a target around a withdrawal rate that fails in a bad decade would be the one avoidable way to
> miss a goal that was otherwise met.

### The philosophy

MJ DeMarco's *Millionaire Fastlane*, applied literally:

1. **Build a scalable asset, not an income.** A consulting practice earns; a software business
   with 89%+ gross margin and no per-unit labour cost *compounds*. The distinction is the whole
   reason Nexflow is a product and not a services firm, and it is why §8's hiring plan keeps
   headcount near zero for as long as it is honest to do so.
2. **Exit when it peaks, do not milk it.** The exit is the event, not the dividend stream. A
   business held past its strategic peak is a job with a certificate of incorporation.
3. **Live on yield afterward.** The post-exit capital is never re-risked into another operating
   business.

The practical consequence, and it should govern every funding, pricing and partnership decision:
**anything that raises ARR but narrows the acquirer pool is a bad trade.** §5 makes this concrete.

### Timeline

`[DECIDED]` **7–9 years from September 2026 → an exit window of September 2033 to September 2035.**

> `[CORRECTION]` **The timeline and the revenue projections disagree by one to three years, and the
> projections are the more aggressive of the two.** §4's happy path reaches 2,500 clients and ₹37.5
> Cr ARR at end-2031 — five years and three months out, not seven to nine. At an 8× multiple that
> exit produces **₹234 Cr post-tax, which misses the ₹300 Cr target by 22%.** The target and the
> timeline are consistent with each other; it is the *exit year in the projection* that is wrong.
>
> **Resolution `[RECOMMENDED]`: do not exit in 2031.** The ₹300 Cr post-tax target lands at
> end-2032 at an 8× multiple (~3,200 clients, ₹48 Cr ARR), and lands comfortably anywhere in the
> stated 2033–2035 window even at a financial buyer's 6×. Full arithmetic in §5.3. Treat 2031 as
> the earliest point at which the *minimum acceptable* outcome is secured, and 2032–2034 as the
> window in which the actual target is reached. That framing also removes the pressure to accept a
> first offer.

---

## 2. Pricing

### 2.1 Current state — decided and live

All figures `[DECIDED]`. Reproduced from `CLAUDE.md` and `enterprise-strategy.md` §7 unchanged.

| Tier | Setup (one-time) | Annual | Year 1 total | Who |
|---|---|---|---|---|
| **Founder** | ₹20,000 | ₹44,000 | ₹64,000 | Clients 1–5 only. Rate locked 2 years. |
| **Standard Lite** | ₹20,000 | ₹56,000 | ₹76,000 | Client 6+. 250-material cap, single user, no agent. |
| **Standard Pro** | ₹35,000 | ₹1,00,000 | ₹1,35,000 | Client 6+. Current live rate. |
| **Enterprise** | ₹60,000 (₹35K Pro + ₹25K Bridge Agent) | ₹1,60,000 | ₹2,20,000 | PVT LTD, Segment 3. |
| **Principal (KPML)** | ₹1,25,000–1,50,000 | ₹2,50,000–3,00,000 | ₹3,75,000–4,50,000 | Segment 4. +₹5–7K/vendor beyond 20. |

**Included free on every plan, permanently:** one-click full export, AI HSN audit, CA Tally
integration (one CA per tenant). `enterprise-strategy.md` §7. These are not upsells and must never
become them — the export is the answer to the bus-factor objection and is worthless as a paid
feature; a wrong HSN is a filing error regardless of what the tenant pays.

### 2.2 The three live client positions

| Client | Position | Locked until |
|---|---|---|
| **SS Engineering** | Full Pro + agent, **free, permanently. Never changes.** `[DECIDED]` | Forever |
| **Datta Prasad Enterprises** | ₹1,35,000 Year 1 (₹35K setup + ₹1,00,000). Payment due 10 Sep 2026. | ~Sept 2030 |
| **Shivprasad Industries** | Pro at ₹1,00,000/yr, same 3-year lock `[UNVERIFIED]` | ~Sept 2030 |

Two flags on this table, both of which need closing before the next pricing conversation:

- `[UNVERIFIED]` **Shivprasad's Pro conversion is not recorded anywhere in `CLAUDE.md`.** Datta
  Prasad's is documented in detail — amount, date, lock terms, the exact `UPDATE` statement to run
  on payment. Shivprasad is still recorded as `plan = 'founder'`, onboarded 19 Aug 2026, with
  "products, materials, prices not yet fully loaded." The brief treats both as ₹1,00,000 Pro with a
  3-year lock. **Confirm what Shivprasad has actually agreed to and record it in `CLAUDE.md` in the
  same shape as Datta Prasad's entry**, before either is counted as recurring revenue.
- `[UNVERIFIED]` **"No cost increase for 3 years after Year 1" is ambiguous in the agreement.** It
  reads either as three years total (through Sept 2029) or Year 1 plus three (through Sept 2030).
  The difference is a full year of pricing headroom on two of the three founding clients. Pin the
  wording when the PVT LTD re-papering happens (`enterprise-strategy.md` §5 already schedules a
  contract rewrite — do it in that pass, not separately).

> **The honest read:** two of the three founding clients are locked at ₹1,00,000 until roughly 2030
> and the third pays nothing, ever. That is the correct price for the first three clients — they
> are the reference customers, the KPML proof, and the source of every compliance requirement in
> the product — but it means **there is zero pricing upside available from the existing book.** All
> pricing growth in §4 comes from clients who have not signed yet.

### 2.3 Pricing going forward `[DECIDED]`

| Tier | New rate | Was | Change |
|---|---|---|---|
| **Standard Pro** | **₹1,25,000 – ₹1,50,000/yr** | ₹1,00,000 | +25% to +50% |
| **Enterprise** | **₹1,60,000 – ₹2,00,000/yr** | ₹1,60,000 | 0% to +25% |
| **Principal (KPML)** | **₹2,50,000 – ₹3,00,000/yr** | unchanged | — |

The Enterprise floor of ₹1,60,000 is the price already decided in `enterprise-strategy.md` §7
(₹1,00,000 Pro + ₹60,000 add-on); the range extends it upward rather than replacing it. The
Principal band is unchanged from both `enterprise-strategy.md` §7 and `kpml-network-plan.md` §12.

**When to raise.** `[DECIDED]` After all four planned MD-file programmes are shipped and proven:

| Programme | Source | Status |
|---|---|---|
| Tutorial engine (T1–T3, Marathi) | `tutorial-engine.md` §9 | Designed, not built |
| Automation stack (A0–A8) | `automation-strategy.md` §7 | Designed, not built |
| Bridge Agent (E1) | `enterprise-strategy.md` §3.1 | Designed, blocked on incorporation |
| Monthly AI Filing Package (E2) | `enterprise-strategy.md` §3.2 | **Shipped** — Sessions 15–16 |

Three of four are unbuilt. **The price rise is therefore a 2027 event, not a 2026 one**, and any
client signed between now and then signs at ₹1,00,000–1,25,000. That is the correct trade: signing
a reference client cheaply is worth more right now than ₹25,000 of ARR.

### 2.4 Raising the price on an existing client `[DECIDED]`

Three rules, all of which bind together:

1. **90 days' written notice.** Never a renewal-date surprise.
2. **Never more than 20% in one step.**
3. **Always tied to specific new features the client has already received.** Not "costs have gone
   up." The sentence is *"you now have the filing package, the Marathi tutorials and the Tally
   bridge, none of which existed when you signed."*

> `[CORRECTION]` **Rules 2 and 3 collide with the new Pro rate, and the brief does not notice.**
> ₹1,00,000 → ₹1,25,000 is **+25%**, which breaks the 20% cap. The cap permits ₹1,20,000, not
> ₹1,25,000.
>
> This only binds on **existing, unlocked** clients — the new band is for new business, where the
> cap does not apply. But it means an existing ₹1,00,000 client cannot be moved to the new
> standard rate in one step. The compliant ladder:
>
> | Step | Rate | Increase | Earliest |
> |---|---|---|---|
> | Today | ₹1,00,000 | — | — |
> | Step 1 | ₹1,20,000 | +20.0% | 90 days after notice |
> | Step 2 | ₹1,44,000 | +20.0% | Next renewal |
> | Step 3 | ₹1,50,000 | +4.2% | Renewal after that |
>
> **Reaching ₹1,50,000 from ₹1,00,000 takes three annual steps.** Plan for it, and do not promise a
> client a 20% cap and then send a 25% invoice — that is the one action in this section that costs
> a reference customer.

### 2.5 What is never done on price `[NEVER]`

- **Never charge the CA.** `enterprise-strategy.md` §3.5 Q9, four reasons, unchanged. The moment
  there is an invoice attached, a recommendation becomes a sales pitch and the channel dies.
- **Never discount the Enterprise ₹25,000 Bridge Agent setup fee.** It is not margin; it buys the
  parallel-run month that prevents a corrupted set of statutory books.
- **Never bundle Enterprise into the Principal platform fee.** It carries a real support cost and
  bundling hides it.
- **Never price on a tenant-level flag.** Principal pricing is on active principal-side links —
  roles are per-relationship. `kpml-network-plan.md` §2.

---

## 3. Complete Cost Structure

All figures ₹/month at **₹90/USD**, the convention used throughout `enterprise-strategy.md` §3.2
and `automation-strategy.md` §8.

### 3.1 The decided totals

`[DECIDED]` These totals supersede `automation-strategy.md` §8.3, which predates the GitHub line
and a revised hidden-cost split.

| | **3** | **10** | **50** | **100** | **500** | **1,000** |
|---|---|---|---|---|---|---|
| **Total cost / month** | **₹16,750** | **₹21,050** | **₹52,750** | **₹1,11,510** | **₹1,85,810** | **₹2,45,400** |
| **Revenue / month** | ₹20,333 | ₹69,580 | ₹4,79,167 | ₹10,83,333 | ₹62,50,000 | ₹1,45,83,333 |
| **Gross margin** | **17.6%** | **69.7%** | **89.0%** | **89.7%** | **97.0%** | **98.3%** |
| Cost as % of revenue | 82.4% | 30.3% | 11.0% | 10.3% | 3.0% | 1.7% |
| Cost per client / month | ₹5,583 | ₹2,105 | ₹1,055 | ₹1,115 | ₹372 | ₹245 |
| Implied blended ARPU / yr | ₹81,333 | ₹83,496 | ₹1,15,000 | ₹1,30,000 | ₹1,50,000 | ₹1,75,000 |
| Annualised revenue | ₹2.44 L | ₹8.35 L | ₹57.5 L | ₹1.30 Cr | ₹7.5 Cr | ₹17.5 Cr |

`[VERIFIED]` Every margin recomputes exactly from its own row. The blended ARPU rises with the tier
mix — a book that is mostly Founder/Lite at 10 clients and mostly Pro/Enterprise/Principal at 1,000.

### 3.2 The full breakdown

Every column below sums exactly to the decided total. `[VERIFIED]`

| Category | 3 | 10 | 50 | 100 | 500 | 1,000 |
|---|---|---|---|---|---|---|
| **Infrastructure** | 2,650 | 2,850 | 17,850 | 62,610 | 1,14,910 | 1,61,000 |
| **Development** | 9,000 | 9,400 | 9,400 | 9,400 | 22,400 | 22,400 |
| **AI running costs** | 250 | 800 | 3,000 | 6,000 | 23,000 | 43,000 |
| **Founder hidden costs** | 4,850 | 8,000 | 19,500 | 30,500 | 20,500 | 14,000 |
| **PVT LTD compliance** | 0 | 0 | 3,000 | 3,000 | 5,000 | 5,000 |
| **Payment processing** | 0 | 0 | 0 | 0 | 0 | 0 |
| **Total** | **16,750** | **21,050** | **52,750** | **1,11,510** | **1,85,810** | **2,45,400** |

#### Infrastructure

`[VERIFIED]` Reconciles line-for-line against `automation-strategy.md` §8.1's dollar figures at
₹90/USD.

| | 3 | 10 | 50 | 100 | 500 | 1,000 |
|---|---|---|---|---|---|---|
| Supabase | 2,250 <br>(Pro $25) | 2,250 <br>(Pro $25) | 12,150 <br>(Pro+compute $135) | 53,910 <br>(**Team $599**) | 89,910 <br>($999) | 1,26,000 <br>($1,400) |
| Vercel | 0 (Hobby) | 0 (Hobby) | 1,800 (Pro $20) | 1,800 | 1,800 | 1,800 |
| Resend | 0 (free) | 0 (free) | 1,800 ($20) | 1,800 ($20) | 8,100 ($90) | 8,100 ($90) |
| Telegram | 0 | 0 | 0 | 0 | 0 | 0 |
| Storage + egress | 300 | 500 | 2,000 | 5,000 | 15,000 | 25,000 |
| Domain | 100 | 100 | 100 | 100 | 100 | 100 |
| **Total** | **2,650** | **2,850** | **17,850** | **62,610** | **1,14,910** | **1,61,000** |

> **The single most important line in this table is Supabase Team at 100 clients.** It is a
> ₹41,760/month step — on its own it is 75% of the entire cost increase between 50 and 100 clients.
> And per `automation-strategy.md` §8.1 it is bought **for the contract, not the load**: 28-day PITR
> and the backup guarantees a PVT LTD's CA will ask about under the §4 data-sovereignty promise.
> That means it lands at the **first Enterprise signature — plausibly 10–25 clients, not 100.** See
> §3.4 for what that does to the margin curve.

#### Development

| | 3 | 10 | 50 | 100 | 500 | 1,000 |
|---|---|---|---|---|---|---|
| Claude Max | 9,000 <br>($100) | 9,000 | 9,000 | 9,000 | **18,000** <br>($200) | 18,000 |
| GitHub + dev tooling | 0 (free tier) | 400 | 400 | 400 | 1,900 | 1,900 |
| Code-signing cert (amortised) | 0 | 0 | 0 | 0 | 2,500 | 2,500 |
| **Total** | **9,000** | **9,400** | **9,400** | **9,400** | **22,400** | **22,400** |

**Claude Max is the development team.** It is the single largest cost line at 3 clients — 54% of
total run cost — and 7.3% at 1,000. `automation-strategy.md` §8.2 puts the $100 → $200 upgrade at
200+ clients, which is why the step lands between the 100 and 500 columns.

> **Note on the code-signing certificate.** It shows at ₹0 below 500 clients in this reconstruction,
> but E1 (Bridge Agent) is scheduled for 2027–28 — roughly the 50–100 client range — and it cannot
> ship without an OV/EV certificate (`enterprise-strategy.md` §9 Q5, ₹15,000–35,000/year). Adding
> ₹2,500/month at the 100-client column moves the total to ₹1,14,010 and the margin from 89.7% to
> **89.5%**. Immaterial, but record it rather than discovering it.

#### AI running costs

| | 3 | 10 | 50 | 100 | 500 | 1,000 |
|---|---|---|---|---|---|---|
| Modelled bottom-up (`automation-strategy.md` §8.2, with Batch API) | ~150 | 457 | 1,532 | 2,879 | 13,615 | 26,275 |
| **Budgeted (this table)** | **250** | **800** | **3,000** | **6,000** | **23,000** | **43,000** |
| Headroom | 1.7× | 1.8× | 2.0× | 2.1× | 1.7× | 1.6× |

Covers the Anthropic API across every automation (A1 onboarding, A2 compliance, A3 digest, A4
support, A6 filing covering notes, plus the existing `agent-query` copilot and `suggest_hsn`) and
the WhatsApp Business API channel. The budget carries roughly 2× headroom over the modelled figure
deliberately.

**AI is never the constraint.** At 1,000 clients every model call in the product totals ₹43,000
against ₹1.46 crore of monthly revenue — **2.9% of revenue, 17.5% of cost.** At 100 clients it is
0.55% of revenue. `enterprise-strategy.md` §7 and `automation-strategy.md` §8.3 reach the same
conclusion independently: **never optimise a prompt to save money. Optimise it for correctness.**

#### Founder hidden costs

The category the brief is right to insist on, because it is invisible in every SaaS cost model and
it is the largest line at 10–100 clients.

| | 3 | 10 | 50 | 100 | 500 | 1,000 |
|---|---|---|---|---|---|---|
| Travel, site visits, stays | 2,000 | 4,000 | 12,000 | **20,000** | 10,000 | 4,000 |
| CA / CS fees (own compliance) | 1,500 | 2,000 | 4,000 | 6,000 | 6,000 | 5,000 |
| Phone, internet, connectivity | 850 | 1,000 | 1,500 | 2,000 | 2,000 | 2,000 |
| Equipment (amortised) | 500 | 1,000 | 2,000 | 2,500 | 2,500 | 3,000 |
| **Total** | **4,850** | **8,000** | **19,500** | **30,500** | **20,500** | **14,000** |

> **These costs invert, and that inversion is the whole automation thesis expressed in rupees.**
> Hidden costs peak at 100 clients (₹30,500/month) and then *fall* — to ₹20,500 at 500 and ₹14,000
> at 1,000. The driver is travel: at 100 clients the founder is still physically onboarding and
> training people; by 500 the tutorial engine (`tutorial-engine.md`) and A1 onboarding ingestion
> (`automation-strategy.md` §4.1) have replaced the site visit. **The first 100 clients require far
> more founder presence than the per-client cost suggests.** Plan for it and do not be surprised by
> it.

#### PVT LTD compliance

₹0 until incorporation. ₹3,000/month (₹36,000/yr) at 50–100 clients — ROC annual filings (AOC-4,
MGT-7), statutory audit, DIR-3 KYC, a CS retainer. ₹5,000/month (₹60,000/yr) at 500+.

Worth stating plainly, because it is the exact obligation set `enterprise-strategy.md` §8 item 1
promises to **never** build software for: Nexflow outsources its own ROC compliance to a CS while
telling clients it will never touch theirs. That is consistent, and it is a good sentence in a sales
meeting — *"I have exactly the same obligations you do, and I outsource them the same way."*

#### Payment processing

**₹0 at every scale point in this table**, and that is a deliberate accounting choice, not an
oversight. Razorpay is not integrated (§9), and when it is, its ~2% fee is a **revenue deduction,
not an operating cost** — `automation-strategy.md` §8.1 excludes it from the cost table for the same
reason. Treating it as a cost line would double-count it against margin.

### 3.3 Setup fees are not in any of the above

`[DECIDED]` Setup fees are **one-time cash, excluded from the recurring margin calculation.**

| Tier | Setup fee |
|---|---|
| Standard Pro | ₹35,000 |
| Enterprise | ₹60,000 (₹35,000 Pro + ₹25,000 Bridge Agent) |
| Principal | ₹1,25,000 – ₹1,50,000 |

At 8 new Pro clients/month at 100-client scale that is **₹2,80,000/month of additional cash** —
more than 2.5× the entire monthly cost base. `automation-strategy.md` §8.3 makes the same point.

**The actual cash position is always materially better than the recurring-only margin shows**, and
it is best precisely when growth is fastest. Two consequences:

1. **Growth is self-funding.** Setup fees from new clients cover the cost of serving them many times
   over, which is the structural reason §10 Q2 (funding) has a default answer of "no."
2. **Never model runway off recurring margin alone during a growth phase.** It understates cash by
   a factor of three.

### 3.4 Where the margin thresholds actually sit

`[DECIDED]` **The 90% margin threshold and the 10% cost threshold are crossed at approximately 65
clients.** These are the same crossing stated two ways — cost below 10% of revenue *is* margin above
90% — and they should never be quoted as two separate milestones.

`[VERIFIED]` The arithmetic, on the cost curve as tabulated in §3.2:

| Clients | Blended ARPU | Revenue/mo | Cost/mo | Cost % | Margin |
|---|---|---|---|---|---|
| 50 | ₹1,15,000 | ₹4,79,167 | ₹52,750 | 11.0% | 89.0% |
| 60 | ~₹1,18,000 | ~₹5,90,000 | ~₹58,900 | 10.0% | **90.0%** |
| **65** | ~₹1,19,500 | ~₹6,47,300 | ~₹60,800 | 9.4% | **90.6%** |
| 100 | ₹1,30,000 | ₹10,83,333 | ₹1,11,510 | 10.3% | **89.7%** ← dips back |
| 150 | ~₹1,31,900 | ~₹16,48,400 | ~₹1,16,400 | 7.1% | 92.9% |
| 500 | ₹1,50,000 | ₹62,50,000 | ₹1,85,810 | 3.0% | 97.0% |

> **The margin curve is not monotonic, and pretending otherwise will produce a wrong forecast.** It
> crosses 90% around 60–65 clients, **dips back under to 89.7% at ~100 when the Supabase Team
> upgrade lands**, and recovers permanently above 90% by roughly 110–120 clients. The dip is a
> single ₹41,760/month line item, not a deterioration in the business.

**Sensitivity, and it is the one that matters `[RECOMMENDED]`:** if Supabase Team is bought at the
first Enterprise signature as `automation-strategy.md` §8.1 expects — 10–25 clients, for the
contract rather than the load — **the 90% crossing moves right, to roughly 105 clients.** The
business is not worse; the threshold simply arrives 40 clients later.

**Plan against the later number.** A forecast built on a 90% margin at 65 clients that actually
arrives at 105 is a forecast that misses by 40 clients at exactly the moment the founder is deciding
whether to hire. Use ~65 as the best case and ~105 as the planning case, and resolve it the month
the Team upgrade is actually bought.

### 3.5 Three conclusions about cost

1. **The 3-client column is the only one where this business looks bad, and it is not real.** 17.6%
   margin at ₹16,750 of cost against ₹20,333 of revenue is a build phase, not an operating result.
   ₹9,000 of that ₹16,750 is Claude Max — the tool building the product that the other five columns
   are sold on. **This is capex mislabelled as opex.** Accept it and move on. See the warning in
   §3.6.
2. **Cost per client falls 4.5× between 100 and 1,000 clients** (₹1,115 → ₹245). That is the actual
   scaling story: infrastructure strongly sublinear, hidden costs inverting, AI flat, development
   stepping once.
3. **Nothing in this cost structure can produce a cash crisis.** Fixed costs are ₹21,050/month at 10
   clients. Even a catastrophic revenue outcome leaves the business solvent on one paying Pro
   client. §4.3 develops this — it is the single most important structural fact about the downside.

### 3.6 One warning about the 3-client column `[CORRECTION]`

The ₹20,333/month revenue figure annualises to **₹2,44,000** — which requires two Pro subscriptions
at ₹1,00,000 **plus a third subscription at ₹44,000.**

**SS Engineering is free, permanently.** `[DECIDED, CLAUDE.md]` If the three clients in that column
are the three live tenants, the actual recurring revenue is **₹2,00,000/year = ₹16,667/month**, and
the real position is:

| | Brief's figure | Actual, if the 3rd client is SS Engineering |
|---|---|---|
| Revenue/month | ₹20,333 | **₹16,667** |
| Cost/month | ₹16,750 | ₹16,750 |
| Margin | 17.6% | **−0.5%** |

**At today's three live clients, Nexflow is at break-even on recurring revenue, not 17.6% margin.**

This is not alarming — it is a three-client build phase funded by setup fees (Datta Prasad's
₹35,000 alone covers two months of total run cost), and the margin curve above is what matters. But
**the 17.6% figure requires a fourth paying relationship or a founder-tier client in the third
slot**, and the document should not claim a margin the client list does not produce. Correct the
column when the fourth client signs, or relabel it "3 paying clients."

---

## 4. Revenue Projections

### 4.1 Happy path `[RECOMMENDED]`

Assumes KPML closes and the CA flywheel starts turning in 2027.

| Year end | Clients | Blended ARPU | ARR | Growth |
|---|---|---|---|---|
| **2026** | 10 | ₹84,000 | **₹8.4 L** | — |
| **2027** | 100 | ₹1,30,000 | **₹1.3 Cr** | 10.0× |
| **2028** | 300 | ₹1,40,000 | **₹4.2 Cr** | 3.2× |
| **2029** | 700 | ₹1,50,000 | **₹10.5 Cr** | 2.5× |
| **2030** | 1,500 | ₹1,50,000 | **₹22.5 Cr** | 2.1× |
| **2031** | 2,500 | ₹1,50,000 | **₹37.5 Cr** | 1.7× |

`[VERIFIED]` Every ARR recomputes from its own client count and ARPU. Growth decelerates smoothly
from 10× to 1.7×, which is the correct shape — the 10× is 10 → 100 clients, arithmetically easy and
commercially the hardest thing in this document.

**Exit at end-2031: ₹37.5 Cr ARR × 8–10× = ₹300–375 Cr pre-tax = ₹234–292 Cr post-tax.** See §1 and
§5.3 — this **misses the ₹300 Cr target** and is the reason the exit should be 2032 or later.

> **Note on the ARPU plateau.** The projection holds blended ARPU flat at ₹1,50,000 from 2029
> onward, while §3.1's cost table shows ₹1,75,000 at 1,000 clients. The projection is the more
> conservative and **every exit calculation in §5 uses ₹1,50,000.** If the ₹1,75,000 mix
> materialises instead, 2030's ARR is ₹26.25 Cr rather than ₹22.5 Cr and every exit number improves
> by ~17%. Treat ₹1,50,000 as the plan and ₹1,75,000 as upside. `[RECOMMENDED]` — do not mix the
> two in one calculation.

### 4.2 Worst case `[RECOMMENDED]`

Assumes KPML is slow to close and the CA flywheel is delayed 18 months.

| Year end | Clients | Blended ARPU | ARR |
|---|---|---|---|
| **2026** | 5 | ~₹80,000 | ₹4.0 L |
| **2028** | 50 | ₹1,15,000 | ₹57.5 L |
| **2030** | 200 | ₹1,35,000 | ₹2.7 Cr |
| **2032** | 800 | ₹1,50,000 | ₹12.0 Cr |
| **2033** | 1,500 | ₹1,50,000 | **₹22.5 Cr** |

> `[CORRECTION]` **The worst case does not clear the ₹150 Cr minimum, and the brief's own arithmetic
> says so.** The brief states *"exit at 7x = ₹157.5 Cr post-tax — still above ₹150 Cr minimum
> acceptable."* **₹22.5 Cr × 7 = ₹157.5 Cr is the pre-tax figure.** After tax at 22% it is **₹122.8
> Cr — 18% below the minimum.**
>
> `[VERIFIED]` What would actually be required to clear ₹150 Cr post-tax from the worst case:
>
> | Route | Clients | ARR | Multiple | Pre-tax | Post-tax @22% |
> |---|---|---|---|---|---|
> | As stated | 1,500 | ₹22.5 Cr | 7× | ₹157.5 Cr | **₹122.8 Cr** ✗ |
> | Higher multiple | 1,500 | ₹22.5 Cr | **8.5×** | ₹191.3 Cr | **₹149.2 Cr** ✓ |
> | More clients, one more year | **1,850** | ₹27.75 Cr | 7× | ₹194.3 Cr | **₹151.5 Cr** ✓ |
>
> **The worst case needs either an 8.5× multiple or ~1,850 clients — not 1,500 at 7×.** Neither is
> unreasonable: 8.5× is well inside the strategic-acquirer band in §5.2, and 1,850 clients by 2034
> is one additional year of the same slow growth. But the plan must be written against the real
> number. **Do not carry "₹157.5 Cr post-tax" into any decision.**

### 4.3 Why the worst case is survivable

This is the most important structural fact in the document and it deserves stating on its own.

**At 10 clients, total fixed costs are ₹21,050/month — ₹2.53 lakh/year.** One Standard Pro
subscription at ₹1,25,000 plus one setup fee at ₹35,000 covers nearly two-thirds of a full year of
running the entire business.

Consequences:

- **There is no cash burn problem, at any point, in any scenario in this document.** The worst case
  is slower, not fatal. It never produces a month where the business cannot pay for itself.
- **There is therefore no forced-funding event**, which is what preserves the acquirer pool (§5.4).
- **There is no forced-exit event.** A founder who can wait can decline a bad offer, and the ability
  to decline is worth more in the final negotiation than a year of ARR growth.
- **The downside is time, not money.** The real cost of the worst case is that the exit lands in
  2034 instead of 2032 — inside the stated 7–9 year window either way.

> **The corollary, stated because it is easy to forget:** the thing that can actually kill this
> business is not cost and not slow growth. It is a **reputation event** — one CA whose client filed
> wrong numbers from a Nexflow package, in a district where every factory owner knows every other
> one. `enterprise-strategy.md` §3.5 §10 calls this unrecoverable and gates the CA channel on three
> measured clean months for exactly this reason. **Protect the data quality, and the financial
> downside takes care of itself.**

---

## 5. Exit Strategy

### 5.1 Target

`[DECIDED]` **₹300 Cr post-tax in 7–9 years. Minimum acceptable ₹150 Cr post-tax.**

Two structural routes:

| Route | Clients | ARR @ ₹1.5 L | Multiple | Buyer |
|---|---|---|---|---|
| **A — strategic** | ~2,000–2,500 | ₹30–37.5 Cr | **8–10×** | Tally, ClearTax, a bank, Zoho |
| **B — financial** | ~3,000+ | ₹45 Cr+ | **6–7×** | PE roll-up, a larger ERP vendor |

Route A is worth roughly 35% more per client and is the one every decision in §5.4 optimises for.

### 5.2 Strategic acquirers, and why each would pay a premium

Listed in ascending order of what they would pay.

**1. Zoho — buying a product gap.** `[RECOMMENDED]`
Zoho Books and Zoho Inventory have no manufacturing job-work module and no regional-language
onboarding. Nexflow is a bolt-on to a distribution machine they already own. Lowest strategic
premium of the four, because Zoho's default is to build rather than buy and they can afford to.

**2. ClearTax / Defmacro — buying a CA referral network.** `[RECOMMENDED]`
Their business *is* the CA relationship. Nexflow arrives with a CA channel already accreting (§7), a
filing-package infrastructure that produces GSTR-1/2B/ITC-04 deliverables from source data, and
MSME clients they do not currently reach at the factory-floor layer. They would be buying
distribution plus the upstream data capture they structurally lack.

**3. Tally Solutions — buying distribution and defence.** `[RECOMMENDED]`
The most obvious acquirer and the most strategically motivated. Nexflow sits **upstream** of Tally
(`enterprise-strategy.md` §1), captures the transaction at the moment it happens, and feeds Tally
one-way. Tally would be buying: a CA distribution channel, an MSME client base already inside their
ecosystem, the job-work/ownership dimension their inventory module has never had, and — the part
that actually moves the price — **the elimination of the one product category that could become a
front-end in front of them.** Defensive acquisitions price above financial ones.

**4. A large Indian bank — HDFC, ICICI, Kotak — buying underwriting data.** `[RECOMMENDED]`
**This is the highest-value acquirer and the only one whose valuation is not anchored to ARR at
all.**

The argument, which should be made exactly this way:

> Real-time inventory, dispatch, GRN, invoice and payment data from 2,000+ MSME factories is a
> better credit underwriting signal than any loan application form, because it is **observed rather
> than reported.** A factory's GRN cadence, dispatch volume, invoice ageing and 43B(h) payment
> behaviour describe its actual trading position continuously — not once a year, self-declared, in
> a format the borrower controls.

MSME lending in India is constrained by exactly this: the inability to verify what a small
manufacturer actually does. Nexflow observes it as a by-product of work the factory does anyway.

**Why a bank might pay 15–20×+ ARR.** They are not buying ₹37.5 Cr of subscription revenue. They are
buying a reduction in the default rate across a multi-thousand-crore MSME book. If the data improves
underwriting on even a small fraction of that portfolio, the acquisition pays for itself
independently of whether a single subscription renews. **Your data is worth more to them than your
revenue is.** At 15×, the ₹300 Cr post-tax target needs only ~1,700 clients (§5.3) — reachable in
the happy path by 2030.

> `[UNVERIFIED]` **Do not build toward the bank outcome.** It is the highest-value branch and the
> least controllable — it depends on a bank's strategy at a moment years away, not on anything
> Nexflow does. Build the business that Tally would want to buy (which is the same business), and
> treat the bank as upside that arrives or does not. Every §5.4 action serves both.

> `[NEVER]` **And an absolute constraint that this section does not override:** none of this means
> selling, sharing or monetising client data before an exit. `enterprise-strategy.md` §3.5's data
> isolation guarantees, `kpml-network-plan.md` §10.5's scoped access rule, and the consent language
> shown to every tenant are permanent. The asset being described is *the aggregate data
> infrastructure a buyer inherits under a change of control*, with whatever consent that then
> requires — **not a data business Nexflow runs in the meantime.** Anyone who reads this section as
> licence to monetise client data has misread it, and doing so would destroy the CA channel, the
> KPML relationship and the acquisition simultaneously.

### 5.3 Tax structure and what the exit actually has to be

`[DECIDED]` **PVT LTD share sale. Long-term capital gains, holding period >24 months for unlisted
shares. Planning assumption: 20–23% effective.**

`[VERIFIED]` Grossing the target up:

| Effective tax | Pre-tax needed for ₹300 Cr | Pre-tax needed for ₹150 Cr |
|---|---|---|
| 20% | ₹375.0 Cr | ₹187.5 Cr |
| **22% (planning case)** | **₹384.6 Cr** | **₹192.3 Cr** |
| 23% | ₹389.6 Cr | ₹194.8 Cr |

**Plan against ₹385–390 Cr pre-tax for the target and ₹192–195 Cr pre-tax for the minimum.**

What that requires, at ₹1,50,000 blended ARPU: `[VERIFIED]`

| Multiple | ARR needed | Clients needed | Plausible in |
|---|---|---|---|
| **8×** (financial / conservative strategic) | ₹48.1 Cr | **~3,200** | 2032 happy path |
| **10×** (strategic) | ₹38.5 Cr | **~2,570** | late 2031 / 2032 |
| **15×** (strategic premium — bank) | ₹25.7 Cr | **~1,710** | 2030 |

> `[UNVERIFIED]` **The 20–23% tax assumption is conservative, possibly by a wide margin, and this
> should be checked with a CA rather than carried forward on faith.** The 20%-with-indexation regime
> for unlisted shares was replaced in 2024 by a flat 12.5% without indexation; with surcharge and
> cess that is roughly **15% effective**, not 22%. At 15%, ₹300 Cr post-tax needs only **₹353 Cr
> pre-tax** — about ₹32 Cr less than the planning case.
>
> **Keep planning at 20–23% anyway.** Tax law in 2032–2035 is unknowable, planning against the
> higher rate builds in real headroom, and an exit that over-delivers by ₹32 Cr is not a problem.
> But **confirm the current regime with a CA before the exit is structured** — it affects the
> holding-period test, the second-director shareholding decision (`enterprise-strategy.md` §9 Q13),
> and whether any ESOP is worth creating. Getting this wrong at the point of sale is expensive in a
> way that getting it wrong now is not.

### 5.4 Scenario reconciliation — the table to actually plan from

`[VERIFIED]` All figures at ₹1,50,000 blended ARPU, 22% effective tax.

| Scenario | Exit | Yrs from Sep 2026 | Clients | ARR | × | Pre-tax | **Post-tax** | Verdict |
|---|---|---|---|---|---|---|---|---|
| Happy, as projected | 2031 | 5.3 | 2,500 | ₹37.5 Cr | 8 | ₹300 Cr | **₹234 Cr** | Clears minimum, misses target |
| Happy, as projected | 2031 | 5.3 | 2,500 | ₹37.5 Cr | 10 | ₹375 Cr | **₹292 Cr** | Marginal miss |
| **Happy, +1 year** | **2032** | **6.3** | **3,200** | **₹48 Cr** | **8** | **₹384 Cr** | **₹300 Cr** | **Hits target exactly** |
| Happy, to timeline | 2033 | 7.3 | ~4,500 | ₹67.5 Cr | 6 | ₹405 Cr | **₹316 Cr** | Clears at financial-buyer multiple |
| Happy, to timeline | 2033 | 7.3 | ~4,500 | ₹67.5 Cr | 8 | ₹540 Cr | **₹421 Cr** | Clears comfortably |
| Worst, as stated | 2033 | 7.3 | 1,500 | ₹22.5 Cr | 7 | ₹157.5 Cr | **₹123 Cr** | **Misses minimum** |
| Worst, higher × | 2033 | 7.3 | 1,500 | ₹22.5 Cr | 8.5 | ₹191 Cr | **₹149 Cr** | Hits minimum |
| Worst, +1 year | 2034 | 8.3 | 1,850 | ₹27.75 Cr | 7 | ₹194 Cr | **₹152 Cr** | Clears minimum |

**Three readings of this table:**

1. **The target is a 2032–2033 event, not a 2031 one.** Every row that clears ₹300 Cr post-tax is
   2032 or later. The single highest-leverage decision available is **not taking the 2031 exit.**
2. **Holding to the stated 7–9 year window makes the target robust.** By 2033 the happy path clears
   ₹300 Cr even at a financial buyer's 6×. That is a much safer plan than needing a 10× strategic
   multiple in 2031.
3. **The worst case is one year or one turn of multiple away from its floor**, not far from it. It
   needs 8.5× or ~1,850 clients. Both are achievable; neither is automatic.

### 5.5 How to position for a strategic exit `[DECIDED]`

Four rules. Each one is a constraint on decisions taken years before the exit, which is why they
belong in this document and not in a later one.

**1. Never accept funding that restricts the acquirer pool.**
Strategic investment from any of the four acquirers in §5.2 — or from a competitor of one — removes
the others from the table and caps the multiple. A Tally-adjacent investor makes an ICICI
acquisition awkward; a bank investor makes Tally's defensive motive disappear. §4.3 establishes
there is no cash need, so there is no forced trade here. **The default answer on funding is no, and
it should stay no until someone can name which acquirer it removes and why that is worth it.**
(§10 Q2 is the open version of this.)

**2. Keep the data architecture clean and exportable — it already is.**
The one-click full export (`enterprise-strategy.md` §3.4) was built as an answer to the bus-factor
objection. It is also **due-diligence readiness built years early.** An acquirer's technical DD
asks exactly what that feature already produces: every table as CSV, a documented schema, a
manifest with per-file hashes, the whole transaction history as portable XML. Nothing here needs
building — it needs **not breaking.** Every future schema decision should preserve it.

**3. Build the CA channel explicitly as a distribution asset.**
**Acquirers pay for distribution, not for features.** A CA channel with 50 active referrers is worth
more in a negotiation than any single product capability, because it is the thing the acquirer
cannot replicate with engineering. This reframes §7: the CA integration is free to the CA
(`enterprise-strategy.md` §3.5 Q9) not only because charging would kill the referral, but because
**the channel itself is the asset being built.** Instrument it — count active referrers, count
referred clients, count clean filing months per CA. A channel you cannot measure is a channel you
cannot sell.

**4. Protect the gross margin above all other financial metrics.**
**95%+ gross margin at scale is the single largest valuation driver** and the thing that separates
an 8× from a 4×. Concretely, this forbids three categories of decision that all look reasonable in
isolation:
- **Never take on per-client human labour** that scales linearly. This is the real reason §8 keeps
  support out of headcount for as long as it can be defended.
- **Never accept a bespoke customer-specific build**, however large the cheque. `kpml-network-plan.md`
  §13 and `enterprise-strategy.md` §8 item 7 already forbid it on product grounds; it is equally
  forbidden on valuation grounds, because bespoke revenue is valued as services, at a fraction of
  the multiple.
- **Never let support become the cost centre.** `enterprise-strategy.md` §7's Enterprise cap of 25
  clients until support load is measured is a margin-protection rule, not a capacity rule.

---

## 6. Competitive Moats

Ranked by strength, with the date each becomes fully built. Weakest-but-live sits above
strongest-but-unbuilt in practical terms today — read the status column as carefully as the rank.

### 1. CA distribution channel — **strongest, building now**

**What it is.** Every CA who receives a clean monthly filing package becomes a sales channel at
zero marginal cost. A factory owner asks their CA before buying software; a CA whose month is three
hours shorter per client recommends it to every client they have.

**The arithmetic.** ~50 active CA referrers ≈ 1,000 clients — **without a sales team.**

**Why it is a moat and not just a channel.** It is available *only* to a vendor who feeds Tally, and
structurally unavailable to one who competes with it (`enterprise-strategy.md` §1, reason 3). A
competitor cannot buy their way in; they have to earn it one clean filing month at a time, and the
gate is measured in months.

**Fully active: 2027–2028.** Gate: `enterprise-strategy.md` §3.5 §10 — three consecutive clean
months with one CA, measured, before offering it to a second.

> `[CORRECTION]` **The 50-referrer figure assumes ~20 clients per CA, which is close to 100%
> conversion of a CA's entire manufacturing book.** `enterprise-strategy.md` §3.5 §10 puts a MIDC CA
> firm at 15–30 manufacturing clients. At a realistic 50% conversion — 10 clients per CA — **1,000
> clients needs ~100 active referrers, not 50.** Plan for 100. It does not change the strategy; it
> doubles the relationship-building work, which is founder time and therefore the scarce resource
> (§8).

### 2. Principal network model (KPML) — **highest leverage per relationship**

**What it is.** One principal relationship brings 20–50 vendor clients, introduced by the principal
rather than sold to individually. KPML mandates adoption; Nexflow never makes the vendor pitch.

**The arithmetic.** 10 principals = 200–500 clients. Each vendor is a separate tenant on their own
Pro subscription, plus the principal's own ₹2.5–3 L platform fee.

**Why it compounds.** As Nexflow makes a principal's reconciliation cleaner, that principal can
manage more vendors with the same headcount — so **every new vendor they add is automatically a warm
Nexflow prospect they introduce.** `CLAUDE.md` "Vendor network revenue model."

**First proven: 2027.** Dependencies: Phase 2 principal dashboard (shipped, Sessions 9 and 11), the
November 2026 KPML meeting, and PVT LTD incorporation — KPML is a PVT LTD and cannot contract with
a proprietorship (`enterprise-strategy.md` §5).

### 3. Opus filing package with judgment — **live now, and the only moat currently in the field**

**What it is.** The CA receives a document that **names specific invoice numbers and flags specific
errors** — not a summary, not a dashboard. `claude-opus-5` reads the month's real rows and writes a
covering note a chartered accountant acts on.

**Why no competitor produces this.** Two reasons, both structural: it requires holding the
transactions at source (Tally receives them after the fact), and it requires being willing to run a
frontier model per tenant per month on data most vendors never see.

**The proof that it works, and it is unusually concrete.** `[VERIFIED, CLAUDE.md Session 16]` On
Datta Prasad's August data, unprompted, Opus identified: 78 dispatch challans with zero sales
invoices (naming challan range 1103–1177, a parallel series, and 4 missing numbers individually),
15 GRN lines at 0% GST against identical 18% goods (naming all 12 invoice numbers), 1 orphan GRN
with no supplier or invoice, 623 unaudited materials, and 50 dispatched items with no HSN. **None
were Nexflow bugs.** That is the output a CA switches vendor to keep.

**Switching cost.** A client who leaves loses their CA's automated package — and the CA notices
first.

**Status: SHIPPED** — Sessions 15 and 16, 9–10 September 2026.

> **This moat has an October deadline attached and it is the most urgent item in this document.**
> `automation-strategy.md` §1 finding 3 `[VERIFIED]`: `filing-package/index.ts` processes tenants
> **strictly sequentially** in one Edge Function invocation, and somewhere between ~20 and ~60
> tenants the run is killed mid-loop. Tenants after the cutoff get **nothing — no package, no
> failure row, no `error_reason`, and therefore nothing any monitor can detect.**
>
> The first real multi-tenant production run is **5 October 2026**, with `filing_package_enabled`
> defaulting to `true`. **A moat that silently stops delivering for half the book is not a moat —
> it is the reputation event §4.3 identifies as the one thing that can actually kill this
> business**, arriving through the channel that is supposed to be the primary distribution asset.
> A0 + A6 (`automation-strategy.md` Wave 0, ~1.5 sessions) is the fix and it is the highest-priority
> commercial work in this document.

### 4. Tutorial engine in Marathi — **uncontested, unbuilt**

**What it is.** The only manufacturing ERP that teaches itself to a storekeeper in Marathi. The
acceptance test: *a storekeeper with no software experience, on a ₹8,000 Android phone, records a
**correct** GRN on the first attempt — without training, without the manual, without phoning anyone*
(`tutorial-engine.md` §1).

**Why it is commercially load-bearing, not a nicety.** Three reasons:
- **It eliminates onboarding and training cost** — founder time, the binding constraint (§8, §3.2's
  hidden-cost inversion).
- **It answers the objection that kills floor-level software adoption:** *"my people won't use it."*
- **It is a data-quality feature**, and data quality is what moat #3 is built on. The Datta Prasad
  findings above were data-entry problems a guided first entry would have prevented.

**Zero competitors are building this for the MIDC segment.** Tally requires training. Busy requires
training. Both assume an accountant is driving. Nexflow's user is a storekeeper at a gate.

**Built: 2027.** Three sessions (T1–T3), plus calendar time for the read-aloud gate — Marathi is
authored and voiced by a native speaker in the MIDC context, never machine-translated
(`tutorial-engine.md` ADR-12). **That gate is calendar time, not build time, and it cannot be
compressed.**

### 5. Bridge Agent — **strongest lock-in, latest arrival**

**What it is.** Nexflow vouchers land in the client's own TallyPrime automatically. The ten days a
month an accountant spends retyping challans and invoices become zero.

**Why switching becomes practically impossible.** After six months of running, the client's
statutory books have been populated by Nexflow continuously. Leaving means going back to manual
entry *and* reconciling what was already imported. The lock-in is not contractual — it is that the
alternative is visibly worse every single month.

**Built: 2027–2028.** Blocked on PVT LTD incorporation → code-signing certificate. Without a signed
installer SmartScreen blocks every install and E1 is undeployable
(`enterprise-strategy.md` §6, blocker 4). Also blocked on the GRN duplicate-invoice guard
(`CLAUDE.md` Known Open Items #1) — with the agent running, a duplicated supplier invoice becomes
**two Purchase vouchers in a real company's statutory books.**

### 6. MSME data infrastructure — **not a moat yet; the acquisition thesis**

**What it is.** Real-time inventory, dispatch, GRN, invoice and payment data from 1,000+ factories.

**Why it is listed last.** It defends nothing today. It is not a reason a client stays or a
competitor loses. It is **the asset that makes §5.2's bank acquirer pay a multiple unrelated to
ARR** — valuable to an acquirer, invisible to a customer.

**Fully valuable: 2029+**, and only at scale. Below ~1,000 factories it is a dataset; above it, it
is an underwriting signal.

Subject without exception to the `[NEVER]` constraint in §5.2: this is an asset a buyer inherits
under change of control, not a business Nexflow runs.

---

## 7. Distribution Strategy

**The objective: 1,000+ clients with no sales team.** Two channels, one sequence, no cold calling.

### 7.1 CA channel — primary

**The market.** `[UNVERIFIED]` ~3.5 lakh practising CAs in India. Order-of-magnitude only — it
matters solely as evidence the addressable channel is not a constraint. The constraint is
relationships, not headcount.

**The trigger, stated precisely because the timing depends on it:**

> A CA receives **three clean monthly filing packages.** On the next client who complains about
> their month-end process, the CA says *"the one I get from Nexflow takes me twenty minutes."*

That is the entire mechanism. It is not a referral programme, there is no commission, and there must
never be one (§2.5).

**Timeline.**

| Milestone | Date | Depends on |
|---|---|---|
| First 3 clean packages delivered | Oct–Dec 2026 | The 5 Oct 2026 cron running correctly |
| **First CA referrals** | **March 2027** | Above, + one CA relationship earned |
| **Channel self-sustaining** | **March 2028** | ~15–25 active referrers compounding |

> **There are two CA channels with different timelines, and conflating them will produce a wrong
> forecast.** `[VERIFIED]`
>
> | | **Filing-package channel** | **Tally-integration channel** |
> |---|---|---|
> | What the CA gets | A monthly zip: GSTR-1 reference workbook, purchase register, ITC-04, Opus covering note | Vouchers landing directly in their own TallyPrime |
> | Status | **Live since Sept 2026** | Not built |
> | Blocked on | Nothing — running now | Incorporation → E1 → 1 month stable → CA agent build |
> | Earliest scale | **Feb–Mar 2027** | **~Aug 2027** |
>
> **The March 2027 referral date is achievable via the filing package and only via the filing
> package.** The Bridge Agent path cannot deliver three clean CA months before roughly August 2027.
>
> This makes A6 (filing package supervision) a **direct distribution dependency**, not an
> operational nicety. If the October, November and December runs are not clean, the first referral
> does not happen in March 2027 and the entire §4 happy path slips a year at its steepest segment
> (10 → 100 clients). **A6 is the cheapest ₹1.3 Cr of 2027 ARR available.**

**First action `[RECOMMENDED]`, unchanged from `enterprise-strategy.md` §9 Q16:** offer the CA Tally
integration free to all three existing clients' CAs immediately. It is the fastest route to the
first CA relationship and therefore to the three-clean-months gate.

### 7.2 Principal network — secondary

| Milestone | Target |
|---|---|
| KPML: 20 vendors | 2027 |
| Second principal signed | 2028 |
| Each principal brings | 20–50 vendors |
| 10 principals | **200–500 clients** |

Pilot terms unchanged (`enterprise-strategy.md` §7, `kpml-network-plan.md` §12): **5 vendors, 90
days, ₹75,000, fully credited against the annual fee.**

> **The dependency nobody should discover late:** `automation-strategy.md` §4.1 — twenty vendors
> onboarding together at 3–6 founder-hours each is **60–120 hours in the same window the founder is
> running the pilot.** It cannot be done manually, and the pilot's credibility depends on it being
> done well. **A1 (onboarding ingestion, 3–4 sessions) must ship before the KPML vendor wave, not
> during it.** `automation-strategy.md` §10 Q9 reaches the same conclusion.

### 7.3 Geographic expansion

Sequence `[DECIDED]`. Each phase is entered only when the previous one is self-sustaining.

| Phase | When | Where | Why this order |
|---|---|---|---|
| **1** | Now | **Satara, Karad, Sangli** | Home ground. Every live client, KPML, and the founder's own network. |
| **2** | 2027 | **Pune, Nashik, Kolhapur** | Same state, same language, same CA ecosystem, no new content. |
| **3** | 2028 | **Gujarat** (Surat, Rajkot) | Textile + engineering job work. The `owned_by` job-work model transfers exactly. Needs Hindi/Gujarati. |
| **4** | 2029 | **Punjab, Delhi NCR** | Engineering goods. Hindi already built by then. |
| **5** | 2030+ | **Tamil Nadu** (Chennai) | Auto components. Largest market, most competition, needs Tamil. Last deliberately. |

**The logic:** expand along the axis where the *product* does not change. Phase 2 needs nothing new.
Phase 3 needs one language. Phase 5 needs a language and a market where incumbents are strongest —
which is why it is last, not first, despite being the largest opportunity.

### 7.4 Language expansion `[DECIDED]`

| Language | When | Cost |
|---|---|---|
| **Marathi** | T1–T3, 2027 | Built into the tutorial engine |
| **Hindi** | When the first North India client signs | One session — same engine, add keys |
| **Gujarati** | When Gujarat expansion starts | One session |
| **Tamil** | Phase 5 only | One session |

**Never build a language speculatively. Build on the first client's demand.**

This is affordable only because both the tutorial engine and the automation layer were designed for
it: `tutorial-engine.md` ADR-3 and `automation-strategy.md` §3.2 both specify language-agnostic
bundles resolved by one function that never names a language. **Adding Hindi means adding keys and
one migration — zero lines of engine code.** That architectural decision, made before any client
asked, is what makes §7.3's phases 3–5 cost one session each instead of a rewrite.

The hard gate, which applies to every language and cannot be compressed: **a language ships only
after a native speaker in the relevant industrial context has written the strings and read them
aloud** (`tutorial-engine.md` ADR-12, §8.5). **Wrong Marathi is worse than English**, because the
user cannot tell it is wrong until they have acted on it. If the gate slips, ship English-only —
that is a working product, not a failure.

---

## 8. Hiring Strategy

`[DECIDED]` **Solo until 300–500 clients.**

### 8.1 First hire — commission-heavy sales, ~300 clients

| | |
|---|---|
| **Profile** | Existing MSME manufacturing relationships across 2–3 districts. Not technical. |
| **Compensation** | Small base + **15–20% of first-year revenue** on every client they close |
| **Scope** | Relationship development only. Not support. Not onboarding. Not technical. |

**Why commission-heavy.** At ₹1.4 L first-year subscription + ₹35,000 setup ≈ ₹1.75 L per close,
15–20% is ₹26,000–35,000 per client. The structure is deliberately **margin-safe**: it converts a
fixed cost into a variable one, which protects the gross margin that §5.4 rule 4 identifies as the
primary valuation driver. A salaried salesperson at 300 clients would be a fixed cost against
uncertain output; this is not.

**Why relationships and not cold calling.** This hire extends §7.1 and §7.2 — walking into CA offices
and principal companies where the founder cannot be. Cold calling MIDC factories is explicitly the
alternative the CA channel exists to avoid (`enterprise-strategy.md` §3.5 §10).

### 8.2 Second hire — compliance specialist, ~500 clients

| | |
|---|---|
| **Profile** | Part-time CA or GST consultant. **Not a full-time employee.** |
| **Scope** | Tracks CBIC notifications, reads GST circulars, tells the founder what must change in the software |
| **Explicitly not** | Writing code. Ever. |

This is the human half of A2 (`automation-strategy.md` §4.2). A2 detects that the law changed and
points at the constant; **deciding what it means for the schema remains founder work, and A2 never
writes code.** The specialist sits between those two — domain judgment, not engineering.

**The business case is measured, not hypothetical.** `automation-strategy.md` §1 finding 4
`[VERIFIED]`: the B2CL threshold was wrong in production for **twenty-two months** — ₹2,50,000
instead of the ₹1,00,000 set by Notification 12/2024 effective 1 Nov 2024. It was caught by a CA
conversation on 9 September 2026, not by any process, at a client count of three, with an attentive
founder. At 500 clients a twenty-two-month compliance error is not a code fix; it is the reputation
event of §4.3.

### 8.3 Support is never a hire `[DECIDED]` — and this is a bet, not a fact

The position: support volume is absorbed by A4 Phase 2 (`automation-strategy.md` §4.4) before it
would ever justify a person.

> `[CORRECTION]` **`automation-strategy.md` §8.4 explicitly disagrees, and the disagreement should
> be recorded rather than smoothed over.** Its own hours table says: at 500 clients, automated ops is
> 63.5 hrs/month — *"still most of a working half-month"* — and **support is the largest single line
> at 20 hrs.** It concludes verbatim: *"the signal that the first hire is a support person, not a
> developer."*
>
> **The two documents cannot both be right.** "Support is never a hire" is a bet that A4 Phase 2
> outperforms `automation-strategy.md`'s own estimate by a wide margin.
>
> `[RECOMMENDED]` **Make it a measured bet with a named trigger rather than an assumption:**
>
> > **If founder support hours exceed 25/month in any three consecutive months after A4 Phase 2 has
> > shipped, the support hire happens before the sales hire — regardless of client count.**
>
> This costs nothing to adopt and it converts a hidden contradiction between two planning documents
> into one number to watch. The sales hire at ~300 clients is the right *default*; it is the wrong
> decision if support is already consuming the founder's week, because a salesperson adding clients
> to an overloaded support function makes the problem worse.

### 8.4 Development is never a hire `[DECIDED]`

**Claude Max + Claude Code is the development team.** One person directing AI ships faster than a
three-person team building manually.

This is not aspirational — it is the assumption the entire cost structure rests on. Development
appears in §3.2 as **₹9,000/month rising to ₹18,000** at 500+ clients. A single junior developer at
₹50,000/month would be **2.4× the entire cost base at 10 clients** and would move the 1,000-client
margin from 98.3% to roughly 97.9% — while removing the thing that makes the margin possible.

The evidence is the shipped record: Sessions 6 through 16 (5–10 September 2026) delivered the
security and RLS overhaul, the physical stock count screen, the ITC-04 working paper, the KPML
principal dashboard v1 and v2, the HSN audit tool, the one-click full export, and both parts of the
Monthly AI Filing Package — **eleven sessions in six days.**

### 8.5 What headcount looks like at each stage

| Clients | Team | Founder's job |
|---|---|---|
| 3–300 | **1** (founder) | Everything |
| 300–500 | **2** (+ commission sales) | Product, key relationships, compliance judgment |
| 500–1,000 | **3** (+ part-time compliance) | Product, strategy, exit preparation |
| 1,000+ | **3–4** | Whatever the acquisition process requires |

**Three to four people at ₹17.5 Cr ARR.** That ratio is the business, and protecting it is §5.4
rule 4 in practice.

---

## 9. Razorpay and Payment Strategy

### 9.1 Current process `[DECIDED]`

Manual bank transfer, confirmed by the founder.

```
client pays → sends screenshot → founder verifies against the bank statement
            → UPDATE p2_tenant_settings SET plan='pro' WHERE tenant_id='...';
```

`[VERIFIED]` This is literally what `CLAUDE.md` records for Datta Prasad, including the exact
statement and the instruction to flip `plan` **only** on confirmed payment, leaving `agent_tier`
untouched.

**Under 5 minutes per payment.** At 3–10 clients this is not a problem worth solving.

### 9.2 When to integrate Razorpay `[DECIDED]`

**All three conditions, not any one:**

1. **PVT LTD incorporation complete.** Razorpay KYC binds to a legal entity — PAN, bank account,
   business proof, all of which change at incorporation.
2. **Manual payment overhead exceeds 3 hours/month.**
3. **50+ clients.**

`automation-strategy.md` §1 finding 2 and §7 Wave 4 item 13 record this as decided and split A5
accordingly: the reminder scheduler, grace-period logic and plan-state machine are built in Wave 3
**without** Razorpay (a manual trigger replaces the webhook); only the `payment.captured` webhook
waits.

### 9.3 The real reason to defer — and the reason not to use

> `[CORRECTION]` **The brief's stated justification is arithmetically backwards, and it argues for
> the opposite of the decision it is supporting.**
>
> The brief says: *"At 50 clients, 2% Razorpay on ₹4.79 L/month = ₹9,580/month. At that revenue
> level this is 2% of costs — manageable. At 10 clients it would be 29% of costs — wrong time."*
>
> `[VERIFIED]` What the numbers actually are:
>
> | | 10 clients | 50 clients |
> |---|---|---|
> | Revenue/month | ₹69,580 | ₹4,79,167 |
> | Razorpay @ 2% | **₹1,392** | **₹9,580** |
> | As % of revenue | **2.0%** | **2.0%** |
> | As % of the cost base | **6.6%** | **18.2%** |
>
> A percentage-of-revenue fee is **constant at 2% of revenue by definition.** As a share of the cost
> base it does not fall as the book grows — it **rises**, from 6.6% to 18.2%, because revenue grows
> faster than costs. The "29% of costs at 10 clients" figure does not reconcile to 2% of ₹69,580
> under any reading, and the ₹9,580 at 50 clients is 2% of *revenue*, not of costs.
>
> **The fee-ratio argument therefore supports integrating earlier, not later — which is not the
> decision that should be made.**

**The decision to defer is correct. Use these three reasons instead:** `[RECOMMENDED]`

1. **KYC binds to the legal entity.** Building against the proprietorship means doing the
   integration twice **and migrating live subscriptions between two merchant accounts** — the worst
   kind of rework, on the one system where a mistake takes money from a customer.
   (`automation-strategy.md` §4.5.)
2. **Manual confirmation is under 5 minutes per payment.** At 10 clients that is well under an hour
   a month. There is nothing to automate yet.
3. **Setup fees are collected manually regardless**, so manual confirmation is one consistent
   process rather than two parallel ones.

**At ₹1,392/month, the fee at 10 clients was never the obstacle. The entity was.**

### 9.4 How Razorpay is accounted for

**A revenue deduction, never an operating cost.** It does not appear in §3.2's cost table
(`automation-strategy.md` §8.1 excludes it identically). At 50 clients it reduces net revenue from
₹4,79,167 to ₹4,69,587/month — moving the effective margin from 89.0% to **88.8%.** Immaterial, and
immaterial is the correct verdict: **this decision is about entity sequencing, not economics.**

---

## 10. Open Questions

Each needs a decision **before** the milestone named. Flagged now so they are not discovered late.

### Blocking — immediate

**Q1. When exactly does PVT LTD incorporation start?** `[DECIDED in principle, undated]`
It blocks, simultaneously: the WhatsApp Business API (A1's distribution channel), the code-signing
certificate (E1 Bridge Agent), Razorpay KYC (§9), the KPML pilot signature (KPML is a PVT LTD and
cannot contract with a proprietorship), and every Segment 3 sale.
`enterprise-strategy.md` §5: ~1 month to contracting-ready, ~2 months to fully migrated. Working
backwards from a **November 2026 KPML meeting and a December 2026 pilot signature, the last safe
start is early October** — and starting in September removes the risk entirely.
**This is the single most blocking non-technical item in any Nexflow document, and it has no owner
and no date.**
**Decide before:** end of September 2026.

**Q1a. The three live clients signed with the proprietorship.** Novation or assignment letters are
needed for all three, and Datta Prasad's ₹1,35,000 will have been paid to the proprietorship. **Do
not let the new entity invoice against an old entity's agreement.** Do this in the same pass as the
§2.2 rate-lock wording clarification and `enterprise-strategy.md` §5's contract rewrite — one legal
exercise, not three.
**Decide before:** the first invoice is raised by the new entity.

### Blocking — funding and structure

**Q2. Will funding be considered at all? If so, at what ARR and what equity?**
§4.3 establishes there is no cash requirement in any scenario in this document, and §5.4 rule 1
establishes that the wrong investor caps the exit multiple by removing acquirers.
**Recommendation: no, by default.** Revisit only if a specific opportunity requires capital that
setup-fee cash cannot fund — and even then, the test is *"which of the four acquirers in §5.2 does
this remove, and is that worth it?"* If nobody can answer that question, the answer is no.
**Decide before:** any investor conversation, not during one.

**Q3. Who is the second director, and what do they hold?**
Carried forward unresolved from `enterprise-strategy.md` §9 Q13. It is on the SPICe+ Part B form, so
it cannot be deferred past incorporation. It interacts with §5.3's capital-gains treatment and with
any future ESOP. **It should not be decided in the week before the KPML meeting.**
**Decide before:** SPICe+ Part B is filed.

### Blocking — hiring

**Q4. What is the sales hire trigger — a client count, or monthly hours spent selling?**
§8.1 says ~300 clients. §8.3 shows that a client count alone is the wrong trigger if support has
already broken first.
**Recommendation `[RECOMMENDED]`: make it a two-sided trigger with hours as the tie-breaker.**
- Sales hire fires at **300 clients OR 30 founder-hours/month on sales, whichever comes first.**
- **But** the §8.3 support trigger (25 hrs/month over three consecutive months post-A4-Phase-2)
  **pre-empts it.** If support has broken, the support hire goes first regardless of client count.
- **Instrument founder hours from now**, not from 300 clients. `automation-strategy.md` §8.4's table
  is an estimate; the trigger needs a measurement.
**Decide before:** 200 clients, so the measurement exists before the decision.

### Blocking — geography

**Q5. Gujarat or Punjab as the second state after Maharashtra?**
§7.3 sequences Gujarat (2028) before Punjab (2029).
**Recommendation `[RECOMMENDED]`: Gujarat, and the reason is the job-work model, not market size.**
Surat and Rajkot's textile and engineering clusters run the same principal/job-worker structure the
entire `owned_by` model, s.143 clock and ITC-04 surface were built for — so the product transfers
with **zero new logic**, only a language. Punjab's engineering-goods segment is a better language fit
(Hindi, which arrives first) but a weaker product fit. **Product fit beats language fit**, because
language is one session and a product gap is a rebuild.
**Revisit if:** the first Hindi-speaking client arrives inbound from Punjab or NCR before Gujarat
expansion starts. An inbound client beats a planned market, every time.
**Decide before:** Phase 2 (Maharashtra) is self-sustaining, ~mid-2027.

### Blocking — the numbers in this document

**Q6. Confirm the exit tax treatment with a CA.** §5.3. The 20–23% planning assumption may be ~7
points too conservative under the current unlisted-share LTCG regime, worth ~₹32 Cr of headroom.
It affects the holding-period test and the Q3 shareholding decision.
**Decide before:** any shareholding is issued to a second director — the holding-period clock starts
then. `[UNVERIFIED]`

**Q7. Confirm Shivprasad's actual commercial terms** and record them in `CLAUDE.md` in the same shape
as Datta Prasad's entry. §2.2. Until then, one third of the current book's assumed recurring revenue
is unverified.
**Decide before:** the next revenue figure is quoted to anyone.

**Q8. Correct or relabel the 3-client column.** §3.6. As written it assumes ₹2,44,000/year from three
clients, one of whom is free forever. Either the fourth client signs and it becomes true, or it
should read "3 paying clients."
**Decide before:** this document is used for any planning that depends on the current margin.

---

## 11. Summary — The Ten Numbers That Matter

| # | Number | Source |
|---|---|---|
| 1 | **₹300 Cr post-tax** — the target; ₹150 Cr the floor | §1 `[DECIDED]` |
| 2 | **₹385–390 Cr pre-tax** — what ₹300 Cr post-tax actually requires | §5.3 `[VERIFIED]` |
| 3 | **~3,200 clients at 8×, ~2,570 at 10×, ~1,710 at 15×** | §5.3 `[VERIFIED]` |
| 4 | **2032, not 2031** — the earliest exit that hits the target | §5.4 `[CORRECTION]` |
| 5 | **₹21,050/month** — total fixed cost at 10 clients. No scenario burns cash. | §3.1 `[DECIDED]` |
| 6 | **~65 clients** — 90% margin crossing (**~105** if Supabase Team is bought early) | §3.4 `[VERIFIED]` |
| 7 | **₹2,80,000/month** — setup-fee cash at 100 clients. Growth is self-funding. | §3.3 `[VERIFIED]` |
| 8 | **~100 CA referrers** for 1,000 clients — not 50 | §6 moat 1 `[CORRECTION]` |
| 9 | **5 October 2026** — first multi-tenant filing run. Silent failure mode. Unsupervised. | §6 moat 3 `[VERIFIED]` |
| 10 | **3–4 people at ₹17.5 Cr ARR** — the ratio that is the whole business | §8.5 `[DECIDED]` |

### The four corrections, collected

A future session should not have to re-derive these.

1. **§4.2 — The worst case misses the ₹150 Cr floor.** ₹157.5 Cr is pre-tax; post-tax it is ₹123 Cr.
   Needs 8.5× or ~1,850 clients.
2. **§2.4 — ₹1,00,000 → ₹1,25,000 is +25% and breaks the 20% cap.** Three annual steps to ₹1,50,000
   on an existing unlocked client.
3. **§9.3 — The Razorpay fee-ratio argument is backwards.** The fee is 2% of revenue at every scale;
   as a share of costs it rises, not falls. The decision to defer is right; the reason is the legal
   entity.
4. **§8.3 — "Support is never a hire" contradicts `automation-strategy.md` §8.4**, which concludes
   the first hire should be support. Resolve with the measured 25-hrs/month trigger.

Two further items that are not corrections but need closing: **§3.6** (the 3-client column assumes
revenue the client list does not produce) and **§6 moat 1** (the referrer count is 2× the brief's
figure).

---

*Last updated: 11 September 2026.*
*This is a living document. Update it in place as decisions are made — move items from
`[RECOMMENDED]` to `[DECIDED]`, close open questions, replace every `[UNVERIFIED]` with a confirmed
figure, and re-run §3 and §5's arithmetic whenever a price or a cost changes.*
*Load `CLAUDE.md` + this file for full commercial context. Add `enterprise-strategy.md` for pricing
and segment detail, `automation-strategy.md` for cost and founder-hour detail.*
