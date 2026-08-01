# The Growth Platform — fintech, lending, valuation, AI advisory

*Aug 1 2026. Brian's directive: "one place for construction companies, service
companies etc to be able to GROW, MANAGE, and SELL — with AI guidance on what
levers to pull next (hires, equipment, office, staff, geographic reach)."
This supersedes the system-map note that financing was "deliberately never" —
lending is now ON the roadmap, gated and partner-first.*

## Why we can do this and Ramp/banks can't

Every fintech underwrites blind: they see bank balances and a P&L. We see the
**operational truth** — machine utilization, hours by job, idle %, job
margins, crew productivity, weather losses, receivables via QBO. A lender
would kill for this data; an advisor can't give "buy vs rent" advice without
it. The tracking product isn't the business — it's the **data moat the
financial layer sits on.** (Same playbook: Toast → Toast Capital, Shopify →
Shopify Capital, Square → Square Loans. All started as ops tools.)

## The four layers (build order)

### 1. CHARTS & BENCHMARKS — "manage" (build first, ~near-term)
- Growth dashboard: revenue/margin trend (QBO), fleet utilization trend,
  cost-per-job, revenue-per-crew-member, equipment ROI (purchase price →
  billed hours — we have both fields already).
- **Benchmarking vs industry**: QBO's benchmarking API + trade peers ("your
  equipment idle % is 34% — top-quartile paving companies run 19%").
- Already 60% built: reports, scorecard, cost tracker, AI digests. This layer
  is packaging + QBO pulls, not new infrastructure.
- Gate: none. Start when Tier 1 PM money loop ships.

### 2. RAMP-STYLE SPEND — "manage" (the fintech wedge)
- **HammerTrack Card** (Stripe Issuing or Lithic; Mercury IO covers our own
  spend, this is for CUSTOMERS): per-job spend limits, category locks
  (fuel/materials only), instant auth webhook = receipt chase with ZERO email
  setup, auto job-coding at the terminal.
- Revenue: interchange (~1.5–2.5% of spend flows back to us). A 10-truck GC
  spends $50k+/mo on cards → $750–1,250/mo revenue from ONE customer, dwarfing
  their SaaS fee.
- The Aug 2026 receipt-chase (email forwarding) is the v0 proving demand; the
  card is v1 that makes it native.
- Gates: Mercury live, Stripe live, ~25 paying companies (issuing programs
  need volume + KYC ops), sponsor-bank diligence.

### 3. LENDING — "grow" (partner-first, NEVER balance-sheet-first)
- **Equipment financing referrals** first: customer eyes a $180k excavator;
  we package the data room (utilization proof, job pipeline, QBO financials)
  and route to partner lenders for a referral fee (1–2% of funded amount).
  Zero capital, zero licensing, immediate.
- **Working-capital advances** later (Shopify Capital model): advance against
  receivables/QBO history, repaid as a % of receipts — via a capital partner
  (bank/fund) with us as the data + origination layer.
- Our underwriting edge: "this excavator billed 1,400 hrs at $95/hr last 12
  months" is better collateral analysis than any bank runs.
- Gates: layers 1–2 live, real customer base, capital partner signed, legal
  review (state lending/broker licensing varies — SC first).

### 4. VALUATION & EXIT — "sell" (the emotional hook, cheap to start)
- **Live company valuation card**: SDE/EBITDA multiples by trade + fleet
  asset value (AI value-estimate per asset already built) + revenue quality
  (recurring vs one-off, customer concentration from QBO). "Your company is
  worth ~$2.1M today. Here's the number in 3 years if utilization hits 75%."
- **Exit-readiness score**: clean books (receipt match rate!), documented
  processes (daily logs), customer concentration, owner-dependence (does
  revenue move when Brian's truck doesn't?).
- **Data room generator**: one click → the closeout-binder engine builds a
  buyer package: audited utilization, job history, margins, fleet condition.
- Owners check a number that goes UP weekly = retention no feature matches.
- Gates: needs 12+ months of customer data to be honest. Ship the card early
  with wide confidence bands; tighten as data accrues.

### 5. INSURANCE ARM — "protect" (one day, if it makes sense — Brian, Aug 1)
- The data case is the strongest of all five layers: theft alerts + geofenced
  overnight storage + recovery rate + engine hours + driving behavior +
  maintenance compliance is EXACTLY what an equipment (inland marine) and
  commercial-auto underwriter prices on — and we can prove it per customer.
- Path, strictly in order: (a) **discount referrals** — "HammerTrack-tracked
  fleet" gets negotiated rates with a partner carrier/broker, we take a
  referral fee (this doubles as a sales hook: the subscription part-pays for
  itself in premium savings); (b) **embedded agency** — quotes inside the app
  via an embedded-insurance partner (e.g. the Pie/Next/bolttech pattern),
  commission revenue, requires a P&C producer license (SC first — licensing
  an LLC + one producer is cheap and bounded); (c) **MGA with underwriting
  authority** — our loss data prices the risk, a carrier holds it. Years out.
- NEVER carry risk on our own balance sheet — same rule as lending.
- Claims edge nobody else has: a theft claim ships with the replay link,
  geofence log, and recovery timeline attached. Faster claims = happier
  customers = carrier loves us.
- Gates: 12+ months of fleet loss/recovery data, meaningful customer count,
  partner-first; revisit at Founding-25 full.

## THE AI ADVISOR — the thread through all five ("what lever next")
Grounded in telemetry + QBO + benchmarks, proactive not reactive:
- **Hire**: "Crews averaged 54 hrs/wk for 6 weeks and you declined 2 jobs —
  a 4th crew pays for itself at your current close rate."
- **Equipment**: "You rented a mini-ex 41 days this year ($18k). Buying at
  ~$62k with your utilization = 14-month payback. 3 lender offers ready."
- **Office/yard**: "Drive-time to jobs is up 22% — a yard 15 mi north saves
  $3.1k/mo in windshield time." (We literally have the geodata.)
- **Geography**: "4 of your last 10 leads were in Spartanburg — jobs there
  ran 8% higher margin."
- **Sell/scale**: "Your multiple improves 0.8x if owner-attributed revenue
  drops below 30% — here's the delegation plan."
- **Protect**: "Your zero-theft year + geofenced yard qualifies you for the
  partner rate — renewing at your current premium leaves $4.2k on the table."
- v0 exists (Ask-AI + digests + anomaly agenda). Each layer above adds levers
  it can pull. The advisor is WHY the platform retains — the levers are why
  it expands.

## Sequencing & the honest gates
1 (charts/benchmarks) → 4-lite (valuation card, wide bands) → 2 (card) →
3 (referral lending) → 5a (insurance discount referrals) → 3b (capital
advances) → 5b (embedded agency) → 4-full (exit suite) → 5c (MGA, maybe).
Nothing here starts before: PM Tier 1 shipped, Founding-25 filling, Mercury +
Stripe live. Fintech kills startups through compliance shortcuts — partner
structures only, no balance-sheet risk, no licensing gambles.

## Positioning line (for the deck)
Tenna tracks machines. Procore manages projects. QuickBooks counts money.
**HammerTrack grows the company** — and it's the only one that knows what the
machines, the jobs, AND the money are doing at once.
