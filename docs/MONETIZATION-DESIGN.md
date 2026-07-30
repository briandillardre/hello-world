# Monetization Architecture — Jul 31 2026

*The complete payment system, thought through end to end: hardware, tiers,
annual, upgrades. Companion to PRICING-TIERS.md (tier contents), 
COST-SCALE-2026-07.md (COGS + measured fees), UNIT-ECONOMICS.md.
Stripe is live as of Jul 31 (verified with a real charge).*

## How the competition makes money (and what we take from each)

| Model | How it bills | What contractors hate | What we take |
|---|---|---|---|
| **Tenna** | Hardware sale + SaaS $15–25/asset + $500+ implementation, sales-led | Setup fee, sales calls to buy, per-seat charges | The anti-position: $0 setup, self-serve, unlimited users |
| **Samsara / Motive** | "Free" hardware, 3–5 yr contract, $25–40/asset — hardware amortized invisibly | The contract. Leaving means walking away from paid-for hardware | Their lesson in reverse: **transparent unbundling is the wedge.** "Hardware at cost, yours to keep, month-to-month" is only credible because they do the opposite |
| **Linxup / Bouncie** | Cheap tracker ~$30 + $20–25/mo per tracker all-in | Feels consumer; no job costing, no crews, dies at 10+ assets | Their simplicity: one number a contractor can hold in their head |
| **EquipmentShare T3** | Bundled into rental/fleet services | Only works if you rent from them | Nothing — different business |

**Positioning sentence:** Samsara hides hardware in the contract; Tenna charges
you to start; we sell software cheap, hardware at cost, and you can leave —
which is why you won't.

## The SKU map (everything a customer can ever be charged for)

Two recurring unit prices, three platform fees, three hardware items, one
discount mechanic. Nothing else — every future idea must fight its way onto
this list, not get added "just for now."

### Recurring (monthly, one subscription invoice per customer)
| SKU | List | Founding 25 | Stripe object |
|---|---|---|---|
| Tracked machine | $8/mo | $6/mo | `STRIPE_PRICE_MACHINE` (live) |
| Tool tag | $3/mo ($2 in Run) | $3/mo | `STRIPE_PRICE_TAG` (live) |
| Operate platform | $49/mo | waived | price to create at first list-price customer |
| Run platform | $199/mo | n/a | price to create when AI attribution ships |

One invoice per customer is a fee decision, not just aesthetics: measured
Jul 31, a $6 standalone charge pays 7.9% in fees; the same $6 as a line on an
$84 invoice pays 3.3%.

### One-time (hardware, separate invoice — never on the subscription)
| SKU | Price | Why separate |
|---|---|---|
| OBD tracker (trucks) | at cost, ~$86 | Tangible goods are sales-taxable in SC where SaaS may not be — mixing them on one invoice contaminates the tax treatment of the subscription. Separate invoice, physical-goods tax category. |
| Equipment GPS | at cost, ~$85 | same |
| Tool tag (BLE) | at cost, ~$20 | same |

Hardware price = the KORE invoice, updated when KORE's pricing changes.
"At cost" is audited honesty: publish the number, keep the supplier invoice.

### The annual mechanic
**Annual = 2 months free (16.7% off), charged up front, ACH-preferred.**
- Card fees ~3% become ACH ~0.8% capped — on a $904 annual Operate customer
  that's ~$20/yr saved on fees alone, on top of the cash-flow gain.
- Cash up front funds the hardware float (we buy trackers from KORE before
  customers' subscriptions have paid them back).
- 12 months of committed revenue without a Samsara-style contract: they
  prepaid, they weren't locked. Refund policy: pro-rata on request, no fight.
  The promise stays "cancel anytime" — annual is a discount, not handcuffs.
- Implementation: yearly twins of each recurring price (`_YR` variants at
  10× monthly). Stripe checkout's interval selector or a toggle on our side.
- **Do not offer annual on Founding 25.** Founder pricing is already the
  discount; stacking annual under it double-discounts the thinnest-margin
  cohort. Annual arrives with list pricing.

## Hardware purchase flow (the answer to "how are tracker purchases handled")

**Phase 1 — now, zero build:** Stripe Invoice from the dashboard. Customer
tells us counts (or we spec them on the sales call), we send one hardware
invoice (card or ACH), order ships when it's paid. At Founding-25 volume this
is minutes per customer and it keeps hardware entirely out of the
subscription plumbing.

**Phase 2 — self-serve, when checkout volume justifies it:** an in-app
hardware order page (quantity pickers → one-time Stripe Checkout with the
three hardware prices + shipping). Build trigger: the first week where
manual invoices feel like a chore, not before.

**The billing promise that closes deals: the subscription clock starts when
the tracker reports, not when it ships.** Hardware invoice today,
subscription starts the day the unit first appears on their map. Costs us
days of float, kills the "paying for a box in transit" objection, and it's
one `billing_cycle_anchor`/trial setting at subscribe time.

**What we deliberately do NOT do (yet): hardware financing/amortization**
("$4/machine/mo extra for 24 months"). It's Samsara's model, it reintroduces
the contract-shaped thing we position against, it makes us a lender with
collections risk, and at 8 machines the upfront is ~$700 — real but not
deal-breaking for a business buying $80k excavators. Revisit only if pilots
die specifically on upfront hardware cash, and then as a clearly-priced
financing line, never "free hardware."

## Where AI and financials live (tier logic, not add-ons)

**No à-la-carte add-ons.** Add-on menus are how Tenna quotes get confusing
and how ARPU gets negotiated downward one checkbox at a time. Features have
one home each:

- **Track ($0 platform):** the theft-and-location product. Complete on its
  own — it's the door.
- **Operate ($49):** everything that touches MONEY AND CREWS — time clock,
  daily logs, QR checks, maintenance, QuickBooks sync, receipts. The habit
  tier: once payroll hours and job costs flow through it, leaving means
  changing how the company runs. This is where "financials" live, and it's
  deliberately the most-popular tier.
- **Run ($199):** everything that answers QUESTIONS — AI assistant, daily
  digest, worker↔machine attribution, API/exports, priority support. AI is
  Run's headline because it's demo-magic AND the one feature with real
  marginal COGS (tokens), so it sits behind the biggest fee. Metering AI
  per-question is banned (taxi-meter feel); the $199 IS the meter.

Rule from PRICING-TIERS.md that stays load-bearing: price locks protect
*rates*, never feature placement. We can move features between tiers for new
customers without breaking anyone's grandfathered price.

## The upgrade flywheel (built to encourage more $$, honestly)

1. **Pilot high, land where they land:** the 30-day pilot runs with OPERATE
   features on. Downgrading to Track after tasting daily logs is a felt
   loss — loss aversion does the selling, not a rep.
2. **Locked previews, not hidden features:** Track customers see /clock,
   /logs, /receipts as real pages with their real data shape and a single
   "This is Operate" unlock button (self-serve tier change through Stripe).
   Upgrade is a button, never a call.
3. **Quantity growth is automatic revenue:** every machine added in-app
   should nudge the subscription quantity. Near-term: the app prompts the
   admin ("9 machines on the map, 8 on the plan — update?") with one click
   into the portal. Later: automated monthly true-up. Never silently bill.
4. **Tags feel free, tags spread:** included-tag counts (25 in Operate, 100
   in Run) cost ~nothing and make tiers feel generous; every tagged tool
   deepens the map habit.
5. **Annual at the right moments:** after month 3 paid, at machine-count
   growth, at fiscal year end. One banner, dismissible, never a nag loop.
6. **Founding 25 → list:** founders keep $6/$3 on enrolled assets forever
   (the promise). New assets beyond the founding count join at list rate —
   growth converges everyone toward list without ever breaking a promise.

## Users: how many, what kinds (kept deliberately boring)

**Billing answer: users are free, unlimited, at every tier, forever.** The
billable units are machines and tags — never people. This is the loudest
anti-Tenna/Samsara line we have, and it's also self-interested: every worker
with a login generates clock-ins, QR checks, and logs, which is the data the
Operate habit is made of. Charging per seat would tax our own moat.

**Crew phones are free too.** A person clocking in on /track appears on the
map without being a billed asset — their phone costs us nothing (no SIM, no
flespi), and a map with people on it sells the next tier better than any
demo. If a company wants dedicated personnel GPS hardware, THAT device bills
as a machine; the phone never does.

**Four roles, contractor words, no custom-role builder:**

| Role | Who it is | Can | Can't |
|---|---|---|---|
| **Owner** (admin) | Brian's counterpart | everything + billing + team | — |
| **Office** (manager) | PM / bookkeeper | edit assets & zones, costs, reports, QBO | billing, team |
| **Foreman** | field lead | crew clock, daily logs, QR checks, map | costs, editing setup |
| **Crew** (viewer) | everyone else | clock in/out, see the map | everything else |

These map 1:1 onto the roles already enforced in lib/permissions.ts —
the work here is display language, not schema. Custom roles and per-feature
toggles stay out until a customer with 50+ people demands them; every
role-builder we don't ship is a support surface we don't carry.

## Tax posture (so billing doesn't create a liability)

- Hardware: tangible personal property, plainly taxable in SC → hardware
  products get the physical-goods tax category, Stripe Tax on for those.
- SaaS in SC: **unresolved question — get a CPA answer before the first
  list-price invoice.** SC has historically taxed "communications services"
  broadly; if SaaS is taxable, flip Stripe Tax on for the subscription
  prices too (it's a toggle; the SaaS-business category is already set).
- Selling out of state stays simple until economic nexus (~$100k/state) —
  a 500-customer problem, noted in COST-SCALE.

## Build order (payments work only, in sequence)

1. **Now (no code):** three one-time hardware products in Stripe dashboard;
   first hardware invoices sent manually. Confirm SC SaaS tax with CPA.
2. **First list-price customer:** Operate platform price + annual (`_YR`)
   price twins; tier picker in Settings→Billing (checkout already handles
   multiple line items).
3. **First Track customer:** feature gating + locked-preview pages keyed off
   `plan` (the column already updates via webhook).
4. **~10 customers:** quantity-drift nudge ("9 on map, 8 on plan").
5. **When AI attribution ships:** Run price goes live + public on /pricing.
6. **~25+ customers:** self-serve hardware ordering page; automated true-up.
