# HammerTrack Operating Model — Jul 2026 → Dec 2028

*Written Jul 11 2026. Companion to docs/UNIT-ECONOMICS.md (which covers
per-device infrastructure COGS). This adds everything that doc deliberately
left out: software subscriptions, insurance, professional fees, marketing,
and — the jumps on the chart — employees. Interactive chart artifact published
alongside; same formulas, three growth scenarios.*

## Base-case assumptions (change these, everything recomputes)

- **ARPU: $84 founding / $113 list** — 8 tracked machines + 12 tool tags.
  Founding = 8 × $6 + 12 × $3 = $84; list = 8 × $8 + 12 × $3 plus the
  platform fee blended at 60% Operate ≈ $113 (same numbers as
  COST-SCALE-2026-07.md). The quarterly table below was run at $92, roughly
  the midpoint — the /model page recomputes live. Hardware passes through at
  cost (not in the P&L; see float note).
- **Customer adds/mo:** 1 (Aug–Dec 2026, Founding 25) → 3 (2027 H1) → 4
  (2027 H2) → 6 (2028 H1, dealer channel live) → 8 (2028 H2).
  Ends 2028 at **131 customers ≈ $12.1k MRR ($145k ARR)**.
  **Actuals:** Aug 2026 produced 0 adds — 0 paying customers on Sep 1 2026,
  hardware order #1 installed, selling is the constraint. S1 is due this
  month and no hire is recorded as of Sep 1.
- **COGS** per docs/UNIT-ECONOMICS.md: $1.75/SIM + the fixed-stack tiers
  (flespi from device 11, Supabase/Vercel/tile steps).
- **Software & office:** $120/mo base (Google Workspace, QuickBooks, Twilio,
  domains, misc SaaS) + $1.50/customer.
- **Insurance:** GL + E&O/cyber from first paying customer ≈ $175/mo,
  scaling ~2% of MRR above $2k; workers comp $150–200/mo once field staff.
- **Professional:** CPA/bookkeeping + legal budget $250/mo → $400/mo past
  $5k MRR.
- **Marketing:** $300/mo (Q4 2026) → $750/mo (2027) → $1,500/mo (2028).
- **Founder pay: $0 through 2028** (Dillard Construction remains the
  paycheck). The model breaks if Brian needs a draw — that's a 2029 line.

## Hire rules (the step-jumps)

| Hire | Trigger | Cost/mo (loaded) | Fires (base case) |
|---|---|---|---|
| **S1 — PT field sales & install** (contractor; founder call Aug 28 2026, ahead of trigger) | 0 customers — founder hours are the binding constraint, not demand | $800 base + $200/activated account + $1k bonus @ 25 | **Sep 2026** @ 0 customers |
| **H1 — PT installer/support** (contractor) | 30 customers — installs + tier-1 texts outgrow nights/weekends | $1,800 + $150 WC | ~~Aug 2027~~ **absorbed by S1** — grow S1's hours at the 30-customer trigger instead of a second hire |
| **H2 — FT ops/install tech** (replaces H1) | 90 customers | $5,200 + $200 WC | **Jul 2028** @ 91 customers, $8.4k MRR |
| **H3 — PT admin/CS** | 110 customers | $1,200 | **Oct 2028** @ 115 customers, $10.6k MRR |

Rule of thumb encoded here: a hire lands when its loaded cost ≤ ~60% of the
MRR added since the last hire — each jump knocks the P&L back to roughly
breakeven and growth pays it off within 2–3 quarters. That's the sawtooth
you'll see on the chart.

**S1 is the one deliberate exception to the trigger rule** (Aug 28 2026,
founder call): it fires at zero customers because the constraint it relieves
is founder hours, not demand — Brian runs DCG full-time and founder-only
selling made him the bottleneck. Its risk controls replace the trigger: a
commission-weighted comp (~$336 all-in per activated account at pace, ~6-mo
payback at founder-pricing margin), a 60-day kill rule (<8 demos/mo or <3
activated accounts → pure commission or out), and the role absorbing H1 so
the headcount plan nets zero extra people. Pre-close cash impact ~$2.4k/qtr;
worst-case cumulative drawdown moves ~$8.5k → ~$11k — still under two
excavator payments, still self-funding.

## The quarterly picture (base case, end-of-quarter month)

| Quarter | Customers | MRR | COGS | Opex | Total cost | Net/mo | Cum. cash |
|---|---|---|---|---|---|---|---|
| 2026 Q3 | 2 | $184 | $258 | $548 | $806 | −$622 | −$1,616 |
| 2026 Q4 | 5 | $460 | $301 | $853 | $1,153 | −$693 | −$3,925 |
| 2027 Q1 | 14 | $1,288 | $428 | $1,316 | $1,744 | −$456 | −$5,981 |
| 2027 Q2 | 23 | $2,116 | $556 | $1,332 | $1,888 | +$229 | −$5,978 |
| 2027 Q3 | 35 | $3,220 | $751 | $3,322 | $4,073 | −$852 | −$7,479 |
| 2027 Q4 | 47 | $4,324 | $921 | $3,362 | $4,283 | +$42 | −$8,249 |
| 2028 Q1 | 65 | $5,980 | $1,240 | $4,322 | $5,563 | +$418 | −$8,057 |
| 2028 Q2 | 83 | $7,636 | $1,495 | $4,382 | $5,878 | +$1,759 | −$4,123 |
| 2028 Q3 | 107 | $9,844 | $1,905 | $7,912 | $9,818 | +$27 | −$5,691 |
| 2028 Q4 | 131 | $12,052 | $2,245 | $9,193 | $11,438 | +$615 | −$5,636 |

## What the numbers say

1. **This bootstraps.** Max cumulative drawdown is **~$8.5k** (Q4 2027) —
   less than one excavator payment. No outside money required at base-case
   growth, because each hire waits for its trigger.
2. **First breakeven month: May 2027 at ~20 customers.** After that the P&L
   oscillates around zero on purpose — every surplus gets spent on the next
   hire or more ads. Profit is a choice you defer while growth is working.
3. **The sawtooth is the plan, not a problem.** The jumps are S1 (Sep '26 —
   the Aug '27 H1 step is absorbed into it: S1's hours grow at the
   30-customer trigger instead of a second head) and H2 (Jul '28); each
   erases the margin for ~2 quarters. If a jump doesn't recover within 3
   quarters, growth stalled — freeze hiring, fix acquisition.
4. **Watch two dials, ignore the rest:** customer adds/mo (the only real
   growth lever) and churn (assumed ~0 here — Founding 25 lock-ins make that
   nearly true for 12 months; revisit mid-2027).
5. **Cash vs P&L:** hardware float (~$700/customer kit) is billed to the
   customer up front at cost, so float is days, not months. If you ever
   subsidize hardware to close deals, add $700 × adds/mo to the drawdown.
6. **Upside levers not in the model:** $150 paid installs, yard/maintenance
   module upsells, dealer rev-share instead of ad spend, EquipLens pricing
   reset. Conservative on purpose.

## Scenarios (in the chart artifact)

- **Conservative (0.5× adds):** 66 customers end-2028, $6.1k MRR — H2 never
  fires, drawdown similar (~$9k), just slower. Still self-funding.
- **Base (1×):** table above.
- **Aggressive (1.75× adds):** ~229 customers end-2028, $21k MRR — H2 pulls
  into early 2028, H3 mid-2028, and a fourth hire (sales) enters the frame;
  drawdown ~$10-12k. Growth costs almost nothing extra because COGS is 80%
  SIM.

*Revisit at each phase gate (per CLAUDE.md) and refresh actuals monthly once
Founding 25 billing starts.*

## Cash-injection lever (added Aug 13 2026, on the /model page)

Owner ask: "an option to add cash to make this quicker." Injected capital
deploys as EXTRA ad spend capped at $2,000/mo (ad inventory + install
capacity are real limits), buying customers at a $250 CAC — deliberately
worse than the model's own implied ~$215. Hires keep their customer-count
triggers; they arrive earlier but never outrun revenue. Base-case results:
$10k in → breakeven Dec 2026, $15.7k MRR / 171 customers end 2028, cash
balance never below +$1.4k. $25k → $21.3k MRR / 231. $50k → $30.5k MRR /
331 and ~$118k of operating cash ON TOP of the injection returned by end
2028. The lever is strong because a $250 customer pays back in ~4 months
at 60-80% gross margin, then compounds for the rest of the horizon.

## Pricing levers (added Aug 13 2026, on the /model page)

Three sliders, pure arithmetic, NO invented demand elasticity (that
judgment stays human; the cushion is $12/machine is still under half of
Tenna list + $500 setup): price/machine ($6–12), Operate platform-fee
attach rate (0–60% of customers × $49/mo), one-time install fee ($0–200
per new customer). Reference combos, base growth: $10/machine + 30%
Operate + $150 install with $50k injected → breakeven Aug 2026, $40.6k
MRR end 2028, ~$318k operating cash on top of the injection. Same levers
with $0 injected → breakeven Feb 2027, $16.1k MRR, +$55.8k cash.
Founder-lock on the first 25 not modeled (rounding-level).
