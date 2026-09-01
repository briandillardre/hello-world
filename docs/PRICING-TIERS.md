# Pricing Tiers — Where and How to Split

*Jul 11 2026. Companion to docs/OPERATING-MODEL.md (P&L) and
docs/UNIT-ECONOMICS.md (COGS floors). Survives the EquipLens rebrand — this
is structure, not branding.*

## The three rules (from the COGS math)

1. **Never price a SIM-carrying asset below $6/mo.** Its COGS is $2–4
   depending on scale; $6 is the floor that keeps 50%+ gross margin at
   Founding-25 size. $8 is the list price; $6 is the founder discount.
2. **Tool tags are nearly pure margin ($3/mo, ~$0 COGS).** Use them to feel
   generous — big included-tag counts make the package look huge without
   costing anything.
3. **Software features cost ~nothing marginal — they split TIERS, not
   per-unit prices.** Field ops, QR maintenance, AI, QBO sync are the value
   ladder. Never meter them per use.

**And one competitive rule: unlimited users, every tier, forever.** Tenna
and Samsara nickel-and-dime seats. Every worker with a login is stickiness
we want (clock-ins, QR taps, logs) — charging for seats would tax our own
moat.

## Where to split: per-asset base + feature tiers (hybrid)

Pure per-asset (à la carte) is easy to start but leaves software value
unpriced. Pure tiers (bundles) create "am I over my cap?" anxiety. The
hybrid does both jobs:

| | **Track** | **Operate** ← most customers | **Run** |
|---|---|---|---|
| Who it's for | "Where's my stuff" | "Run my crews on it" | "Run the company on it" |
| Tracked machine | $8/mo | $8/mo | $8/mo |
| Tool tags | $3/mo | **25 included**, then $3 | **100 included**, then $2 |
| Platform fee | $0 | **$49/mo** | **$199/mo** |
| Live map, theft/after-hours alerts, zones | ✅ | ✅ | ✅ |
| Site log, trips, utilization reports | ✅ | ✅ | ✅ |
| Time clock + daily logs + QR maintenance | — | ✅ | ✅ |
| Maintenance schedules + service history | — | ✅ | ✅ |
| QuickBooks sync (invoices, expenses, receipts) | — | ✅ | ✅ |
| AI assistant + daily digest | — | — | ✅ |
| Worker↔machine hour attribution (when it ships) | — | — | ✅ |
| API / exports / priority support | — | — | ✅ |
| Users | Unlimited | Unlimited | Unlimited |

- Typical customer (8 machines, 12 tags): Track $100/mo · Operate $113/mo ·
  Run $263/mo. The platform fee is where software value gets paid without
  touching the per-asset optics that win the Tenna comparison ($8 vs their
  $15–25 + $500 setup).
- **The split point that matters: field ops lives in Operate, not Track.**
  Theft alerts get them in the door; the daily-log habit is what makes
  leaving unthinkable. Price the door low, the habit fairly.
- AI in Run only: it's the demo-magic tier, and its COGS (API tokens) is the
  one software cost that does scale with use.

## Founding 25 (the offer that fills the funnel)

- **$6/machine + $3/tag, Operate features included, no platform fee, 12-month price lock,
  hardware at cost, month-to-month, cancel anytime.**
- **Free 30-day pilot** to start — no credit card. We ship **5 loaner trackers**
  (returned or bought if you don't continue). Synced surfaces: splash + /demo
  final CTAs, /pricing FAQ.
- **First install done with you, in person or on the phone.**
- Positioning: "founder pricing — you're helping me build it, you keep the
  price. 12-month price lock on everything you enroll."
- Every Founding 25 asset still clears its COGS floor (rule 1) — this is
  margin-thin, not margin-negative. No exceptions below $6; discount with
  tags and platform-fee waivers instead of touching the SIM price.
- **Reservation mechanics (Aug 12 2026):** hardware is ordered in batches;
  a spot is held via /reserve (free) and a REFUNDABLE deposit collected
  when the batch is scheduled (Stripe Payment Link on the call) holds that
  spot's hardware. No deposit amount is published — set per kit at cost.
  Deposits are refundable until the kit ships; state a real ship window
  when collecting (FTC mail-order rule). Synced surfaces: /reserve,
  /pricing founding block, splash ladder microcopy.

## Upgrade mechanics (the flywheel in the product)

- Track → Operate: the /clock and /logs pages render for Track customers as
  locked previews ("Your crew's daily logs would be here"). The upgrade is a
  button, not a sales call.
- Grandfather nothing structurally: price locks apply to *rates*, never to
  which tier a feature lives in — otherwise every repackage grandfathers a
  support burden.
- Annual = 2 months free, charged up front — cash for the hardware float.

## What NOT to do

- No per-user pricing (kills the moat), no setup fees (the anti-Tenna
  wedge), no metered AI questions (feels like a taxi meter), no
  auto-downgrades (silent data loss = churn story).
- Don't publish Run's price on the public page yet — "talk to us" until the
  AI attribution feature ships and the demo sells it.
