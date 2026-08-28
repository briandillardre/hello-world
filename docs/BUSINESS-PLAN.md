# HammerTrack — Operating Plan: Today Through Exit

**Owner:** Brian Dillard · Greenville, SC
**Written:** July 8, 2026 · Living document — update at every phase gate
**Thesis:** A working contractor built the asset tracker contractors actually wanted: half Tenna's price, theft alerts that text you at 2 AM, Bluetooth tool tracking included, QuickBooks native. The product is ~90% built. **The next 24 months are a distribution business, not a software business.**

---

## 0. The Two Brutal Truths (read these first, every time)

1. **The product is no longer the bottleneck. Selling is.** From today forward, Brian's hours in the app should fall and hours in front of contractors should rise. Claude Code is the dev team; you are the sales team until a channel replaces you.
2. **Hardware logistics and support are what kill companies like this** — not competitors. A tracker that ships with a disconnected battery (we learned this the hard way with the FMM00A) or a confusing install becomes a churned customer and a bad referral. Every process below is designed around: *tracker works out of the box, customer sees their truck on the map in under 10 minutes.*

Everything else is detail.

---

## 1. Where We Are Today — Honest Inventory (Jul 8, 2026)

| Asset | Status |
|---|---|
| Product (map, trails, alerts, zones, costs, teams, reports, QBO plumbing) | ~90% of v1 · live on Vercel |
| Live pipeline | ✅ Proven end-to-end: OBD → Hologram → flespi → Supabase → map (T1-a in the Chevy since Jul 6) |
| Paying customers | **0** |
| Revenue | **$0** |
| Hardware stack | Decided & tested: Teltonika FMM003/FMM00A (trucks), TAT141 (equipment), BlueCharm BC021 (tools), Hologram SIMs |
| Marketing surface | /demo funnel, pricing page, ad copy drafted, cinematic hero, domain owned |
| Entity / books | ❌ Not separated from Dillard Construction — fix this month |
| Founder time | Part-time, alongside a working construction business |

**Unfair advantages:** (a) you ARE the customer — every feature was built from a real jobsite need; (b) 20 years of contractor and dealer relationships in the Upstate; (c) near-zero software payroll — Claude Code builds what competitors need a team for; (d) construction-business cash flow means you never *have* to raise.

**Beachhead correction:** the docs say Nashville — that was demo-data fiction. The real beachhead is **Upstate SC (Greenville–Spartanburg–Anderson), then the Charlotte and Atlanta corridors.** You sell where people already return your calls.

---

## 2. Pricing (lock this in now)

Per-asset, per-month. Simple enough to quote from a truck cab.

| Asset type | Price/mo | Their cost at Tenna |
|---|---|---|
| Vehicle (OBD plug-in) | **$8** | $15–25 + setup |
| Equipment (GPS unit) | **$10** | $15–25 + setup |
| Small tool (BLE tag) | **$1.50** | not offered / add-on |
| Personnel (app, later) | $4 | — |

- **Account minimum $79/mo.** A 3-asset hobbyist costs the same support as a 40-asset GC. Don't take accounts below the minimum.
- **Hardware:** starter kits at cost + ~20% (e.g., "10-truck kit $749") **or** $0-down at +$3/asset/mo on a 24-month term. Offer both; push $0-down — it converts better and the term protects churn.
- **Annual prepay = 2 months free.** This is your hardware-inventory financing, from customers instead of a bank.
- **Founding 25 program (now–Oct):** flat **$99/mo** for up to 25 assets, price locked 2 years, in exchange for a testimonial, a case study, and a monthly 15-minute call. These 25 accounts are worth more than their revenue — they're your references and your churn lab.

**Reference customer economics** (typical 20-asset GC: 8 trucks, 5 machines, 7 tools)
*(updated Jul 13 with the KORE quote — docs/HARDWARE-PRICING.md):*
- Revenue: $64 + $50 + $10.50 ≈ **$125/mo → $1,500/yr**
- Connectivity COGS: 13 cellular devices × ~$1.00 (KORE pooled 10–25 MB) + flespi share ≈ **$15/mo**
- **Software gross margin ≈ 88%** · Hardware kit **$1,265 quoted** (8×$86 OBD + 5×$83 battery units + 7×$20 tags + SIMs), sold ~$1,495 or amortized
- **Premium equipment tier now priced:** wired CAN unit ($112 + $118 adapter = $230/machine) reads true engine hours, fuel burn, and fault codes — supports a **$12–15/mo** machine tier and utilization-grade billing (see docs/PRICING-TIERS.md)
- As the mix shifts to 40–80-asset fleets via dealers, average account grows to **$180–240/mo**

---

## 3. Phases: Today → Exit

### Phase 0 — Prove It On Yourself (July 2026) — *"Dogfood or die"*
Goal: **Dillard Construction fully live** — every truck, machine, and tool bag tracked; one real after-hours alert drill that texts your phone.

- [ ] Run migrations 009 + 010 in Supabase; run cleanup script
- [ ] Twilio account + **start A2P 10DLC registration now** (US carrier approval takes 1–3 weeks; theft-alert SMS is your headline feature — this is on the critical path)
- [ ] Point hammertrackai.com at Vercel
- [ ] Install T1-b in truck #2; order 2× TAT141 + solar accessory answer from Teltonika Americas; order 10× BC021 tags
- [ ] Live theft drill: move a truck at 9 PM, screenshot the SMS — that screenshot is your best ad creative, forever
- [ ] **Form HammerTrack LLC** (SC), EIN, dedicated bank account + card, QuickBooks Online for HammerTrack itself (dogfood the QBO integration on your own books)
- [ ] Bookkeeper from day one (~$300/mo). Clean books from month zero are worth 6–7 figures at exit — buyers pay for what they can verify.
- [ ] Write down the 25 contractors and 5 equipment dealers you know by first name. That list is Phase 1.

**Exit gate:** your own fleet live 2+ weeks, alert drill passed, LLC + bank + books running.

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
- [ ] **Hire #1 (~75–100 accounts): part-time support/onboarding** — $18–30k/yr. Their whole job: trackers ship pre-provisioned, customers answered same-day, install videos maintained. This purchase buys back your selling hours.
- [ ] Contract senior dev on retainer (5–10 hrs/wk, $2–4k/mo): code review, on-call for the 2 AM outage you can't take, IP assignment signed
- [ ] Churn dashboard: any device silent >48h triggers an internal ticket **before** the customer notices — this single loop is the churn killer
- [ ] Referral program for customers: 1 month free per referred account

**Exit gate:** 100+ accounts, monthly logo churn <2%, at least 30% of new accounts from dealers/referrals (not founder hustle), Hire #1 owns support.

### Phase 3 — Scale to $1M ARR (Jul 2027 – Dec 2028) — *"The channel is the company"*
Goal: **exit 2028 at 350–450 accounts, $65–80k MRR — crossing $1M ARR run-rate**, EBITDA ~25–35%, founder out of daily ops.

- Geographic spread along relationships: Upstate → Charlotte → Atlanta → Southeast
- [ ] **Hire #2 (~200 accounts): full-time Customer Success/Ops lead** — your first *key* hire. Consider 2–5% profit interest with vesting; this is the person who lets the business run without you (and buyers will interview them).
- [ ] **Hire #3 (~250–300 accounts): dealer channel manager** ($50–60k base + commission) — replaces founder-selling entirely
- [ ] Support hire #2 as needed (1 support head per ~250 accounts)
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
| 2027 | 130 | $18k | ~$260k (subs + hardware) | ~$230k | **≈ breakeven** |
| 2028 | 400 | $70k | ~$700k | ~$500k | **+$150–200k EBITDA** |
| 2029 | 600+ | $120k | ~$1.3M | ~$850k | **+$400–450k EBITDA (~32%)** |

Margins: software gross ~83% · blended (with hardware, support) settles at **70–75% gross, 25–35% EBITDA at scale** — squarely in the range buyers pay premium multiples for.

---

## 5. Team Plan (in order, with triggers)

| # | Trigger | Role | Cost | Why |
|---|---|---|---|---|
| 0 | Now | Claude Code (dev) + Brian (sales) + bookkeeper | ~$300/mo + API | The whole company |
| 1 | ~75–100 accts | PT support/onboarding | $18–30k | Buys back founder selling hours |
| 1b | ~100 accts | Contract sr. dev retainer | $2–4k/mo | Review + on-call; IP assignment signed |
| 2 | ~200 accts | **CS/Ops lead (key hire)** | $55–70k + 2–5% profit interest | Runs the machine; de-risks founder dependency for buyers |
| 3 | ~250–300 accts | Dealer channel manager | $50–60k + comm | Replaces founder-selling |
| 4 | ~450+ accts | Support #2 | $40k | 1 per ~250 accounts |

Five people max before exit. Headcount discipline **is** the margin, and the margin **is** the multiple.

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
| Founder time split (construction vs. HammerTrack) | Real and permanent until Hire #2 | Hard calendar split; hires #1–2 exist to buy time back; construction business = funding, not identity |
| Selling to contractors is slow, relationship-driven | Ads alone will NOT build this | Dealer channel is the actual growth engine; ads only feed the funnel |
| Tenna/Samsara cut prices downmarket | Possible at scale | Your moat is service + QBO depth + tool tracking + local trust, not just price |
| Single founder, single region | Buyers will flag it | CS lead with profit interest; documented ops; Southeast spread by 2028 |
| SMS/carrier compliance (A2P 10DLC) | Blocks the headline feature if ignored | Register now (Phase 0 critical path) |

---

## 10. Master Action List — This Week / This Month / This Quarter

**THIS WEEK**
1. Migrations 009 + 010 + cleanup script (Supabase)
2. Twilio + begin A2P 10DLC registration ← *critical path*
3. Domain → Vercel
4. Install T1-b · order TAT141s + 10 BC021 tags · press Teltonika on solar
5. LLC + EIN + bank + bookkeeper engaged
6. Write the 25-contractor / 5-dealer list

**THIS MONTH**
7. Full Dillard fleet live + theft-drill screenshot
8. Stripe billing + Founding 25 offer page
9. First 5 Founding accounts closed from the list
10. Onboarding kit v1 (pre-provisioned + install card + video)
11. Insurance quotes + trademark filing

**THIS QUARTER (by Oct 31)**
12. 10–25 paying accounts, 3 testimonials, 1 filmed case study
13. 2 dealer pilots live
14. Weekly scoreboard habit locked in
15. First churn-save story (device silent → we called them first)

---

*Update this file at every phase gate. The plan is the map; the weekly scoreboard is the GPS.*
