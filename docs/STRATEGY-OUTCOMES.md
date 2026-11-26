# Outcomes, not software — the back office for trade businesses

Brian, Nov 25 2026, from the DCG operations session. This builds on
`docs/AI-RESILIENCE.md` (be the tool AI calls), `docs/GROWTH-PLATFORM.md`
(valuation, money rails) and `docs/PATH-TO-1B.md` (the staged plan). Where they
disagree, this is newer.

## The one fact

AI is making software and office work cheap. It is not making four things
cheap: **trust, accountability, proprietary data, and physical work.** Build on
those four and each better model makes HammerTrack better instead of replacing it.

## What to build

**An AI-run back office for owner-operated trade businesses ($2–50M revenue),
sold as outcomes.** The agents do ~90% of the work; a licensed human
(bookkeeper / fractional CFO) signs off and owns the result.

The outcomes we sell:
- Books closed by the 10th, ready for a CPA's review.
- AR over 60 days stays under 10%.
- Every bid priced from your own real costs and win history.
- Sellable in 18 months.

## Why it lasts

1. **Outcomes, not seats.** A better model from anyone plugs in underneath and
   raises our margin. Software sold per seat gets competed down to zero.
2. **Data no model has, across customers** (opt-in, never one customer's
   numbers shown to another): regional unit costs and winning bid prices,
   how fast each GC really pays, supplier price trends. It is worth more with
   every customer and becomes the pricing engine nobody else can copy.
3. **Embedded in their systems:** QuickBooks, the bank, payment tools, Procore,
   email, suppliers. Once we run payables, receivables and the close, leaving
   is painful.
4. **Trust and distribution.** "I ran a $3M sitework company on this." A
   startup can't buy that story.
5. **Accountability.** Someone signs the books, stands behind the price and
   talks to the surety. A human with AI stays ahead of pure software for years.

## What not to build

- Generic chatbots, "AI for documents", invoice reading or summaries **as the
  product.** The model companies give those away within a year. Inside
  HammerTrack they are plumbing that feeds the outcome (the invoice reader
  feeds the cost book, which feeds the bid).
- Horizontal tools for everyone. **One vertical first** (sitework and paving
  subs), then the neighbors that share the same back-office pain: HVAC,
  electrical, landscaping, trucking.

## Pricing (to test, not published)

- About **$2–6K a month** for the service — less than one bad hire.
- **Plus a success fee** tied to the result: cash collected faster, late fees
  avoided, or a share of the increase when the company sells.
- The tracking SaaS keeps its published price ("about half the price of Tenna,
  $0 setup"); the service is a separate offer, talk-to-us only. Nothing about
  it goes on the splash until a customer is paying for it (splash truth rule).

## The bigger play: a holding company

Owner-operated trade companies sell for about **2.5–4× earnings**, mostly
because the books are messy and everything runs through the owner — exactly
what this back office fixes. Buy them, run them on the shared back office, cut
overhead and clean the books; the same earnings as part of a larger, cleaner
platform are worth **5–7×**. Physical work won't be automated soon; the
overhead around it will be, and owning the businesses captures that gain
directly. The first test is Brian's own companies. Specific targets stay out of
this public repo.

## The path

| When | What | Proof it worked |
|---|---|---|
| Now → 12 months | DCG is the lab. Make the daily operator, the books audit, pricing from invoices and the owner dashboard work on real data. That is HammerTrack's product, proven. | DCG's books close on time from the app; bids priced from it; Brian checks the dashboard weekly |
| Months 6–18 | Offer it as a service to 3–5 Upstate subs Brian knows: one ops person plus agents, ~$3K a month each. | 3 paying, renewing after 90 days |
| Months 18–36 | If DCG is clean and sellable: sell it or step back and go full time on the platform. If owners keep asking "just run my back office": start the acquisitions. | A buyer's quality-of-earnings review passes; or a first acquisition closes |

## The 90-day test (decided Nov 26 2026)

Three independent reviews (market, where AI is headed, viability) agreed, and
Brian said go: **narrow, don't build.** Full write-up:
https://claude.ai/artifact/YasKii2LFjZtVY2C4dCASY

- **Offer:** books closed by the 10th, job cost / WIP, and bids priced from
  your own costs — $2,500–3,500/mo, sold by hand to sitework and paving subs
  doing $3–15M that Brian knows. Tracking comes free with it.
- **First 30 days:** QuickBooks pulling nightly; DCG closes November by
  Dec 10 from `/finance/close`; a contract bookkeeper lined up to sign;
  E&O + cyber insurance quoted; the repo private before the first client.
- **Continue (day 90, Feb 24 2027):** 10 owner conversations · 3 signed and
  paid (≥ $2K/mo, no free pilots) · DCG on time two months running ·
  ≤ 15 h delivery per client per month · one client would pay more for
  bid pricing.
- **Kill:** < 2 paying, > 25 h per client per month, or > 10 h of Brian's
  week. Then stop selling to outsiders, keep the app running DCG, and
  revisit only through the holdco path.
- **Rough 3-year value of each path** (viability review): tracking SaaS
  ~$0.3–0.7M · the outcome service ~$1–2M · 2–3 acquisitions on the shared
  back office ~$3–5M of added equity (only after DCG is clean; personal
  guarantees).
- **Biggest outside threat:** Intuit closing the books well enough inside
  QuickBooks. What lasts is the signature and the local relationship.

## What this changes in the build order

Already pointing this way: the cost book and estimates (147), job cost and WIP
(155), pay apps (154), money across jobs (#233), and — in progress now — pricing
from supplier invoices and bid history (165) and the owner dashboard.

Next, ranked by how directly they deliver a sold outcome:
1. **Pricing from your own costs and wins** (in progress, migration 165).
2. **Owner dashboard** — AR/AP aging, backlog, bid funnel, concentration, a
   valuation with the discounts a buyer takes (engine done: `lib/owner/dashboard.ts`).
3. **QuickBooks goes live** (docs/QBO-GO-LIVE.md) — nothing in the books
   outcome works without it. Board item 7 has been open since August.
4. **The close checklist + books audit** — a daily check of the ledger for
   miscodes (loans or asset sales booked as revenue, owner draws), with the
   human sign-off recorded.
5. **AP from supplier invoices → QuickBooks bills**, with statement
   reconciliation (late-fee and credit-hold alerts).
6. **GC pay-history scoring** from our own pay apps, then (opt-in) across
   customers.

Guardrail (from AI-RESILIENCE): never market "AI" as the difference — market
the outcome and the person who stands behind it.
