# HammerTrack — Operating Plan: Today Through Exit

**Owner:** Brian Dillard · Greenville, SC
**Written:** July 8, 2026 · revised Sep 1, 2026 · Living document — update at every phase gate
**Thesis:** A working contractor built the asset tracker contractors actually wanted: half Tenna's price, theft alerts that text you at 2 AM, Bluetooth tool tracking included, QuickBooks integration built (production connect pending — docs/QBO-GO-LIVE.md). The product is ~90% built. **The next 24 months are a distribution business, not a software business.**

---

## 0. The Two Brutal Truths (read these first, every time)

1. **The product is no longer the bottleneck. Selling is.** From today forward, Brian's hours in the app should fall and hours in front of contractors should rise. Claude Code is the dev team; you are the sales team until a channel replaces you.
2. **Hardware logistics and support are what kill companies like this** — not competitors. A tracker that ships with a disconnected battery (we learned this the hard way with the FMM00A) or a confusing install becomes a churned customer and a bad referral. Every process below is designed around: *tracker works out of the box, customer sees their truck on the map in under 10 minutes.*

Everything else is detail.

---

## 1. Where We Are Today — Honest Inventory (Sep 1, 2026)

| Asset | Status |
|---|---|
| Product (map, trails, alerts, zones, costs, teams, reports, PM hub, insights, owner memo, MCP door, QBO plumbing) | v1 complete and then some · live on hammertrack.ai (Vercel, auto-migrations on deploy) |
| Live pipeline | ✅ Proven end-to-end: OBD → SIM → flespi → Supabase → map (T1-a in the Chevy since Jul 6, T1-b since Aug 4; 5 of 6 OBD units from order #1 online Aug 28) |
| Paying customers | **0** |
| Revenue | **$0** |
| Hardware stack | Decided, bought, coming onto the map: Teltonika FMM00A (trucks), TAT141 (equipment), FMM650 + CAN adapter (phase-2 iron), Eye Beacon BLE (tools). KORE order #1 (14 devices) paid Aug 5, arrived Aug 20–21; TAT141s / FMM650s / beacons still to bring up |
| SIMs | KORE SuperSIM on order #1 (APN `super`; no-cable FOTA onboarding proven Aug 26); Hologram remains on the two pilot units only |
| Marketing surface | /demo funnel, pricing page, ad copy drafted, cinematic hero, domain owned · the Google Ads account is **PAUSED** (advertiser verification not finished by the Aug 31 deadline) |
| Entity / books | ✅ HAMMERTRACK LLC formed Jul 2026, EIN issued Jul 14, Mercury live Aug 5, Stripe live (first charge Jul 31); bookkeeper not yet engaged |
| App | ✅ Android live in Google Play since Aug 21 (v1.2 built Sep 1, upload pending) · 🔴 iOS blocked on Apple's identity + LLC document request (Aug 31) |
| Founder time | Part-time, alongside a working construction business — S1 (part-time field sales & install) is the Sep 2026 answer, not yet hired |

**Unfair advantages:** (a) you ARE the customer — every feature was built from a real jobsite need; (b) 20 years of contractor and dealer relationships in the Upstate; (c) near-zero software payroll — Claude Code builds what competitors need a team for; (d) construction-business cash flow means you never *have* to raise.

**Beachhead correction:** the docs say Nashville — that was demo-data fiction. The real beachhead is **Upstate SC (Greenville–Spartanburg–Anderson), then the Charlotte and Atlanta corridors.** You sell where people already return your calls.

---

## 2. Pricing

**Pricing lives in docs/PRICING-TIERS.md** — machine $8 / tag $3; platform
fee $0 Track / $49 Operate / $199 Run (Run unpublished, "talk to us");
**Founding-25 = $6/machine + $3/tag with Operate included, 12-month price
lock, free 30-day pilot, hardware at cost.** This section is intentionally
not a second copy: the $8/$10/$1.50 grid, the $79 minimum and the $99-flat
Founding offer that used to live here are dead, and a stale copy is exactly
how /demo showed a wrong offer for 12 days. Any pricing change updates every
surface in CLAUDE.md's pricing sync rule in the same commit.

**Reference customer economics** (typical 8 machines + 12 tags — the same
customer docs/COST-SCALE-2026-07.md models):
- Revenue: **$84/mo founding · ~$113/mo list** (60% Operate blend) → roughly $1,000–1,350/yr
- Connectivity COGS: 8 SIMs on KORE SuperSIM at well under $2/mo each + the flespi share ≈ **under $20/mo**; tool tags cost $0/mo
- **Gross margin ≥ 70% on a 100% founder-priced cohort**, 81–83% at 100–500 customers
- Hardware is a pass-through at cost (OBD ~$86, equipment GPS ~$83, tag ~$20 — the typical kit is under $1,000), billed up front, so float is days, not months
- The wired CAN unit ($112 + $118 adapter) reads true engine hours, fuel burn and fault codes and supports a premium machine tier later — not priced publicly yet
- As the mix shifts to 40–80-asset fleets via dealers, the average account grows well past the typical figure without any list-price change

---

## 3. Phases: Today → Exit

### Phase 0 — Prove It On Yourself (July 2026) — *"Dogfood or die"* — ✅ EXIT GATE MET
Goal: **Dillard Construction fully live** — every truck, machine, and tool bag tracked; one real after-hours alert drill that texts your phone.

- [x] ~~Run migrations by hand in the Supabase SQL Editor~~ — superseded: auto-migrations run on every deploy (since early Aug)
- [x] Twilio — a **toll-free number** was bought Jul 30 instead of A2P 10DLC (no campaign fee). **Toll-free verification is still pending:** "in review" since Jul 30, no verdict email as of Sep 1 — check the Twilio console; SMS claims stay soft until it clears
- [x] hammertrack.ai on Vercel (Aug 5; hammertrackai.com 301s to it)
- [x] T1-b installed (reporting since Aug 4) · KORE order #1 — 5 OBD units, 6 TAT141, 3 CAN units + adapters, 10 beacons, 13 SuperSIMs — paid Aug 5, arrived Aug 20–21 · solar-accessory answer from Teltonika Americas still open
- [x] Live theft drill — real after-hours alerts fired in production Aug 4–5 (RAM 3500)
- [x] **HAMMERTRACK LLC** formed Jul 2026, EIN issued Jul 14, Mercury account live Aug 5, Stripe live (first charge Jul 31). QuickBooks Online for HammerTrack's own books still to open
- [ ] Bookkeeper (~$300/mo) — planned, not yet engaged. Clean books from month zero are worth 6–7 figures at exit — buyers pay for what they can verify.
- [x] The 25 contractors and 5 equipment dealers — docs/FOUNDING-25.md

**Exit gate:** ✅ met — own fleet live since July, alert drill passed Aug 4–5, LLC + bank running (books = Stripe + Mercury so far; bookkeeper pending).

### Phase 1 — Founding 25 (Aug–Oct 2026) — *"Sell with your boots on"*
Goal: **10–25 paying accounts, ~$1.5–2.5k MRR**, 3 written testimonials, 1 filmed case study.

> **Aug 28 2026 amendment — S1, the field sales & install hire (founder
> call).** DCG hours make founder-only selling the bottleneck, so the sales
> hire comes forward from Phase 3 — with the shape that keeps it from being
> the classic pre-pitch sales-hire mistake: ONE part-time **field sales &
> install** person, hired for their **rolodex** (equipment-dealer counter or
> sales guy, rental coordinator, retired super — someone Upstate contractors
> already return calls from), comp weighted to commission, demoing on the
> showroom company and closing with the DCG field-report one-pager. They
> demo AND do the first install on the spot — the offer's "first install
> done with you" becomes their job, which means **S1 absorbs H1**: the
> Aug '27 installer hire simply arrives early and earns its keep selling.
> Founder still does the first 3 demos (pitch calibration), writes the
> warm-intro list, and keeps the account-level tasks (Twilio verdict, QBO
> keys, showroom seed). **Comp:** $800/mo base (10–15 hrs/wk) +
> $200/activated account (first autopay month) + $1,000 bonus at 25
> activated — all-in ≈ $336/account at pace, richer than the model's ~$250
> CAC lever but it buys back founder hours; payback stays ~6 months at
> founder-pricing margin. **Kill rule** (same discipline as every hire):
> 60 days — fewer than 8 demos/month or 3 activated accounts → restructure
> to pure commission or part ways. **Cash:** ~+$2.4k/quarter pre-close
> burn; worst-case drawdown moves ~$8.5k → ~$11k. Still self-funding.

Selling motion (in order of expected yield):
1. **The 25-name list.** Personal demo on *your* live fleet, on your phone, at their yard. Close rate should be 40%+ with the Founding 25 offer.
2. **Local dealer pilots (2).** Give two Upstate dealers free tracking on their rental fleet. Rental theft/recovery is *their* pain — when it saves them once, they become your channel.
3. **Contractor Facebook groups + supply-house counters.** The theft-hook creative. Soft budget: $500/mo max in this phase — you're testing message, not scaling spend.

- [ ] Stripe billing live (card on file, autopay only — no invoicing culture, ever)
- [ ] Onboarding kit: pre-provisioned trackers, laminated 1-page install card, QR code → 3-minute video → "text this number if stuck"
- [ ] Case study #1 written + filmed on a phone (theft recovery or a utilization save)
- [ ] Tech E&O + cyber insurance quote (~$1.5–2.5k/yr) — dealers and bigger GCs will ask
- [ ] Trademark search + filing on "HammerTrack" (~$350 DIY / ~$1k with attorney)
- [ ] Weekly KPI sheet starts now (see §7)

**Exit gate:** 10+ accounts on autopay, <1 device DOA per 25 shipped, you can onboard an account in <1 hour of your time.

### Phase 2 — Repeatable Machine (Nov 2026 – Jun 2027) — *"Turn 3 channels into math"*
Goal: **100–130 accounts, $15–18k MRR (~$200k ARR run-rate)**, first hire made, Brian ≤15 hrs/wk on support.

- **Dealer referral program formalized:** $200 bounty or 10% year-one revenue share per closed account. Dealers are the scalable channel — their customers already trust them and already have theft losses.
- **Paid ads to $1.5–3k/mo** only after Founding-25 message data. Target CAC ≤ $600; at ~$104/mo account margin, payback < 6 months.
- **Insurance-agent channel experiment:** commercial P&C agents in the Upstate whose contractor clients eat theft losses. One lunch a month.
- [ ] **Grow S1's hours at ~30 accounts** (the installer/support role is absorbed into S1 — see §5), then **H2 (~90 accounts): full-time ops/install tech**. The job: trackers ship pre-provisioned, customers answered same-day, install videos maintained. This buys back your selling hours.
- [ ] Contract senior dev on retainer (5–10 hrs/wk, $2–4k/mo): code review, on-call for the 2 AM outage you can't take, IP assignment signed
- [ ] Churn dashboard: any device silent >48h triggers an internal ticket **before** the customer notices — this single loop is the churn killer
- [ ] Referral program for customers: 1 month free per referred account

**Exit gate:** 100+ accounts, monthly logo churn <2%, at least 30% of new accounts from dealers/referrals (not founder hustle), H2 owns installs + support.

### Phase 3 — Scale to $1M ARR (Jul 2027 – Dec 2028) — *"The channel is the company"*
Goal: **exit 2028 at 350–450 accounts, $65–80k MRR — crossing $1M ARR run-rate**, EBITDA ~25–35%, founder out of daily ops.

- Geographic spread along relationships: Upstate → Charlotte → Atlanta → Southeast
- [ ] **H2 grows into the Customer Success/Ops lead** — the *key* hire (fires at ~90 accounts, §5). Consider 2–5% profit interest with vesting; this is the person who lets the business run without you (and buyers will interview them).
- [ ] **H3 (~110 accounts): part-time admin/CS** — billing, onboarding paperwork, tier-1 answers
- [ ] **Dealer channel manager** — only if the dealer channel proves out (the operating model's aggressive-scenario fourth hire); replaces founder-selling entirely
- Product (Claude Code, in priority order): Stripe self-serve upgrades · CAN/J1939 on high-value machines (raises equipment price point to $12–15) · report exports/PDF · API for dealer systems · SOC2-lite security page
- **Never hire:** a full-time dev team, an office, a marketing agency.

**Exit gate:** $1M ARR run-rate, churn <1.5%/mo, no customer >5% of revenue, founder ≤10 hrs/wk, management (CS lead + channel manager) runs the week.

### Phase 4 — Exit Window (2029–2030)
See §6. You sell **after** four+ quarters of clean growth at $1M+ ARR — or you keep a 30%+ margin machine that pays you $400k+/yr to own. Both are wins; the plan makes both available.

---

## 4. Money: Costs, Cash Curve, Equity

### Fixed monthly (2026)
| Item | $/mo |
|---|---|
| Vercel + Supabase Pro + tools | ~$75 |
| flespi + misc telemetry | ~$50–150 (scales with devices) |
| Twilio SMS | ~$25 + usage |
| Bookkeeper | $300 |
| Insurance (annualized) | ~$180 |
| **Total burn floor** | **≈ $650/mo** — a rounding error on construction cash flow |

Measured reality (docs/COST-SCALE-2026-07.md): the software side actually
runs **~$130/mo** at zero customers (Vercel Pro, Supabase Pro, Workspace,
Twilio toll-free, domains, mailbox). The bookkeeper ($300) and insurance
(~$180) lines above are **planned, not yet engaged** — real burn today is the
~$130 plus SIMs (2 Hologram pilot + 13 KORE SuperSIM activating).

### Peak cash requirement (the real number)
**$45–70k total** from now through mid-2027, from Dillard Construction cash flow:
- Hardware inventory float: $20–30k (order 25–50 units ahead; annual-prepay customers finance the rest)
- Ads/marketing tests: $15–25k cumulative
- Legal, insurance, trademark, tools: $8–15k

**Equity requirement: zero.** No outside capital, no dilution — you own 100% at exit. The construction business is your seed round.
**The only re-open trigger:** a dealer channel generating POs faster than inventory float can cover (a good problem). Then compare: SBA line of credit vs. $150–250k angel note. Debt first — at these margins, dilution is the most expensive money available.

### P&L trajectory (base case — round numbers, update quarterly against actuals)
| Year | Exit accounts | Exit MRR | Cash revenue (yr) | Opex (yr) | Net |
|---|---|---|---|---|---|
| 2026 H2 | 15 | $2k | ~$20k (incl. hardware) | ~$35k | **−$15k** (investment) |
| **Actual, Sep 1 2026** | **0** | **$0** | $0 | ~$130/mo software + hardware order #1 ($1,818, Aug 5) | hardware order #1 installed; **0 paying customers — selling is the constraint** |
| 2027 | 130 | $18k | ~$260k (subs + hardware) | ~$230k | **≈ breakeven** |
| 2028 | 400 | $70k | ~$700k | ~$500k | **+$150–200k EBITDA** |
| 2029 | 600+ | $120k | ~$1.3M | ~$850k | **+$400–450k EBITDA (~32%)** |

Margins: software gross ~83% · blended (with hardware, support) settles at **70–75% gross, 25–35% EBITDA at scale** — squarely in the range buyers pay premium multiples for.

---

## 5. Team Plan (in order, with triggers — per docs/OPERATING-MODEL.md)

| # | Trigger | Role | Cost | Why |
|---|---|---|---|---|
| 0 | Now | Claude Code (dev) + Brian (first 3 demos, warm-intro list, account-level tasks) | API only; bookkeeper planned (~$300/mo) | The whole company |
| **S1** | **0 customers — Sep 2026** (founder call Aug 28: founder hours, not demand, are the constraint) | **PT field sales & install** — hired for the rolodex (dealer counter/sales guy, rental coordinator, retired super); demos on the showroom company, does the first install on the spot | $800/mo base + $200/activated account + $1k bonus at 25 (~$336/account at pace) | Buys back founder hours. **Kill rule:** 60 days — <8 demos/mo or <3 activated accounts → pure commission or out. **No hire recorded as of Sep 1** |
| H1 | ~~30 accts~~ | ~~PT installer/support~~ | — | **Absorbed by S1** — grow S1's hours at the 30-customer trigger instead of adding a second head |
| H2 | ~90 accts | **FT ops/install tech** (the key hire) | ~$5,200/mo + WC | Runs installs + support so the machine runs without Brian; buyers will interview this person |
| H3 | ~110 accts | PT admin/CS | ~$1,200/mo | Billing, onboarding paperwork, tier-1 answers |

Four people max before exit, plus a contract senior dev on retainer when review + 2 AM on-call needs a second set of hands (IP assignment signed). Headcount discipline **is** the margin, and the margin **is** the multiple.

---

## 6. The Sale: Buyers, Multiples, Scenarios

### Who buys a business like this
1. **Strategics** — Tenna, Samsara (SMB gap), EquipmentShare, GPS Insight/similar rollups, dealer-management software cos (DIS, e-Emphasys), or a large equipment dealer group building a service moat. They pay for: install base, the QuickBooks integration depth, per-site cost data, and a Southeast dealer channel. **Highest multiple.**
2. **PE / SaaS rollups** — vertical-SaaS aggregators hunting sticky SMB revenue with hardware attach. Pay on ARR × growth × churn.
3. **Micro-PE / marketplaces** (Quiet Light, FE International, SureSwift) — reliable exits at $1–5M enterprise value; faster, lower multiple.

### Multiple breakpoints (what the market actually pays for vertical SMB SaaS)
| ARR at sale | Profile | Multiple | Enterprise value |
|---|---|---|---|
| <$500k | any | 2.5–3.5× ARR | $1–1.7M |
| $1M+ | growth >40%, churn <2%/mo, founder-independent | **4–5.5× ARR** | $4–5.5M+ |
| $3M+ | vertical leadership + channel | 5.5–7× | $16–21M |
| any | strategic buyer needs your install base / integration | premium over all above | negotiated |

**The single biggest value lever is not revenue — it's the checklist in §8.** A $1.2M-ARR company with clean books, low churn, autopay revenue, and a manager running it sells for 5×. The same revenue with founder-everything and messy books sells for 3× — that's a **$2.4M difference for the same product.**

### Scenarios
| | ARR at sale | Timing | Multiple | **Proceeds (100% owned)** |
|---|---|---|---|---|
| Grind | $700k | 2029 | 3.6× | **~$2.5M** |
| **Base** | $1.4M | 2029–30 | 4.75× | **~$6.7M** |
| Stretch | $3M | 2030–31 | 6× | **~$18M** |
| Hold | — | — | — | **$400k+/yr distributions, forever** |

Even the grind case beats a decade of margins in construction. The base case is life-changing. And "hold" is a genuine strategy, not a consolation prize.

---

## 7. Weekly Scoreboard (one page, every Friday, no exceptions)

1. MRR + net new MRR
2. Accounts (new / churned / total) + churn %
3. **% of devices that reported in last 24h** (product truth serum — target >97%)
4. Alerts delivered (and SMS delivery rate)
5. CAC by channel (network / dealer / ads)
6. Hardware DOA rate per shipment
7. Support hours per account
8. Founder hours: selling vs. supporting vs. building (watch the mix shift)

---

## 8. Clean-Company Checklist (start now; buyers diligence every line)

- [ ] Separate LLC, bank, books from month zero — no commingling with Dillard Construction
- [ ] 100% of revenue on Stripe autopay; metrics exportable in one click
- [ ] All contractors/employees sign IP assignment
- [ ] Churn, cohort, and CAC data kept from the first customer
- [ ] No customer >5% of revenue
- [ ] Documented ops: onboarding runbook, support runbook, incident runbook (write them as you do the thing the second time)
- [ ] Founder-independence: by 2028, a buyer must believe the machine runs without Brian
- [ ] Security page + data processing terms (SOC2-lite) before dealer/enterprise deals

---

## 9. Risks — Named, With Mitigations

| Risk | Reality check | Mitigation |
|---|---|---|
| Hardware flakiness → churn | The #1 killer in this category | Pre-provision + test every unit; 48h-silent internal alert; spares in the truck; DOA rate on the weekly scoreboard |
| Founder time split (construction vs. HammerTrack) | Real and permanent until H2 — and it is already the binding constraint at 0 customers | Hard calendar split; S1 (Sep 2026) and H2 exist to buy time back; construction business = funding, not identity |
| Selling to contractors is slow, relationship-driven | Ads alone will NOT build this | Dealer channel is the actual growth engine; ads only feed the funnel |
| Tenna/Samsara cut prices downmarket | Possible at scale | Your moat is service + QBO depth + tool tracking + local trust, not just price |
| Single founder, single region | Buyers will flag it | CS lead with profit interest; documented ops; Southeast spread by 2028 |
| SMS/carrier compliance (toll-free verification) | Blocks the headline feature if it fails — "in review" since Jul 30, no verdict email as of Sep 1 | Check the Twilio console; keep SMS claims soft on / and /demo until it clears |

---

## 10. Master Action List — September 2026

**THIS WEEK**
1. **Sell.** Work docs/FOUNDING-25.md top to bottom — 5 texts Monday, 2 dealer counter asks Wednesday; demo on the showroom company and your live fleet, at their yard. The first five yeses are the references that sell the next twenty.
2. **Hire S1** — the part-time field sales & install person (§5; docs/OPERATING-MODEL.md). Due this month; nothing recorded yet.
3. **Finish order #1 bring-up** — 6 TAT141s, 3 FMM650s + CAN adapters, 10 Eye Beacons via the no-cable FOTA playbook (docs/DEVICE-ONBOARDING.md); last puck (Minor 4). Answer KORE's onboarding/training-call ask (unanswered since Aug 26) and settle the declined Aug 14 invoice on the Mercury vendor card.
4. **Close the store loop** — upload v1.2 in Play Console (or add the PLAY_SERVICE_ACCOUNT_JSON secret and never upload by hand again); re-upload the listing from store-assets/; send Apple the three documents (license front + back, ownership verification, LLC formation doc); confirm the package reads "registered" ahead of Google's Sep 30 developer-verification deadline.

**THIS MONTH**
5. **QuickBooks production connect** — docs/QBO-GO-LIVE.md (45 minutes, click-by-click); timesheet push and job-cost invoicing light up the moment it lands.
6. **Twilio verdict** — check the toll-free verification in the Twilio console (no email in 60 days); soften the SMS claims on / and /demo if it isn't approved.
7. **Resend inbound** — enable inbound email + `RESEND_INBOUND_SECRET` so the instant receipt chase goes live; map card last-4s on /receipts.
8. **Cost rates on the big iron** — $/hr and $/day per machine so the Burn Map, Idle $ rings and the owner memo tell the truth.
9. **Google Ads** — finish advertiser verification so the paused account can spend again (and only spend once the Founding-25 conversations say what to run).
10. Bookkeeper engaged; QuickBooks Online opened for HammerTrack's own books.

**THIS QUARTER (by Nov 30)**
11. 10+ paying accounts on autopay, 3 testimonials, 1 filmed case study
12. 2 dealer pilots live (Bennett first)
13. Weekly scoreboard habit locked in (§7)
14. First churn-save story (device silent → we called them first)
15. Apple enrollment cleared → TestFlight → iOS live

---

*Update this file at every phase gate. The plan is the map; the weekly scoreboard is the GPS.*
