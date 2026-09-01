# Cost Stack & Scaling — revised Jul 31 2026

*Supersedes the cost figures in UNIT-ECONOMICS.md for the vendor stack as it
actually exists after the Jul 30–31 account setup (Mercury, Stripe, Twilio
toll-free, Supabase Pro, Workspace — Plaid was declined Aug 1 at a $1,000/mo
quote and is not in the stack). Pricing model: PRICING-TIERS.md.
Hiring/P&L curve: OPERATING-MODEL.md — this doc is COGS + opex only.*

## Fixed monthly (platform — exists at zero customers)

| Item | Today | Notes |
|---|---|---|
| Vercel Pro | $20 | hosting + cron + auto-migrations |
| Supabase Pro | $25 | Postgres/PostGIS, auth, realtime, backups |
| Google Workspace | $7 | brian@hammertrack.ai (1 seat) |
| Twilio toll-free | $2.15 | + $0.008/SMS segment once TFV approves |
| Domains (4, amortized) | ~$11 | hammertrack.ai is $93/yr of it |
| UPS Store mailbox | ~$30 | public/support address — status unconfirmed as of Sep 1 (not verified opened) |
| QuickBooks Online (HT's own books) | ~$35 | when opened — keep separate from DCG |
| ntfy / CARTO / Photon / open-meteo / GIBS | $0 | free tiers doing real work |
| **Fixed total** | **~$130/mo** | pre-revenue burn, software side |

Stripe (2.9% + 30¢) and AI usage (Haiku dispatcher + the monthly Opus memo)
are usage-priced — near zero until customers exist, then they scale with
revenue below.

## Per-unit COGS (monthly)

| Unit | Pilot (Hologram/flespi free) | At scale (KORE pooled) |
|---|---|---|
| SIM-carrying machine (OBD / TAT / CAN) | ~$2.50 SIM + $0 flespi | well under $2/mo (confidential KORE quote) SIM + ~$0.50 flespi |
| Bluetooth tool tag | $0 | $0 |
| AI (Run tier only) | — | ~$0.50–2/customer (Haiku tokens) |
| AI owner memo (all tiers, Aug 27) | — | pennies/customer (one deep-model compose per company per month + on-demand refresh, 30-min floor) |

Hardware is a **pass-through at cost** (OBD ~$86, equipment GPS ~$85, tag
~$20) — no margin, no inventory risk beyond the PoC batch. The $6/mo floor
rule from PRICING-TIERS.md survives: worst-case machine COGS ~$3 → ≥50% unit
margin even at founder pricing.

## Scaling table

Average customer = 8 machines + 12 tags. Founding pricing $6/$3 → $84/customer.
List blend (60% Operate) → ~$113/customer.

| | Now (pilot) | 25 customers (Founding) | 100 customers | 500 customers |
|---|---|---|---|---|
| MRR | $0 | $2,100 | ~$11,000 | ~$56,000 |
| SIMs in field | ~15² | 200 | 800 | 4,000 |
| SIM + flespi COGS | ~$20² | ~$400 | ~$1,360 | ~$6,000 |
| Fixed infra | $130 | $130 | ~$300¹ | ~$900¹ |
| Stripe fees | $0 | ~$70 | ~$330 | ~$1,650 |
| AI usage (Haiku dispatcher + monthly Opus memo) | $0 | ~$30 | ~$150 | ~$700 |
| **Total cost** | **~$150** | **~$630** | **~$2,140** | **~$9,250** |
| **Gross margin** | — | **70%** | **81%** | **83%** |

¹ Supabase compute add-ons + Vercel usage grow with ingest volume (a moving
truck ≈ 1 fix/sec); assume one infra step-up per ~300 SIMs. The sampled_history
work (039) and the trail_daily rollups (077/078) are what keep read load flat
as history grows.

² Sep 1 2026: 2 Hologram pilot SIMs (~$2.50 each) + 13 KORE SuperSIMs from
order #1 activating in KORE One. KORE runs well under $2/SIM/mo, so the
blended SIM cost falls as the fleet shifts off Hologram; flespi is still on
the free tier at this device count.

## What changed vs the pre-launch estimates

- **SMS is toll-free, not 10DLC** — no $2–15/mo campaign fee; $2.15 + per-message.
- **Hardware truth**: OBD is $86 (not the $40–60 the old pricing page claimed —
  fixed Jul 31). At-cost pass-through only works if the quoted number is real.
- **Stripe fees are the third-largest cost at scale** — behind SIMs and infra.
  ACH/bank debit for annual plans later cuts this ~60%.
- **Measured, not modeled (first live charge, Jul 31):** $6.00 gross → $5.53
  net. That's **7.9% effective** — the 30¢ fixed fee dominates small charges.
  Effective rate is a function of invoice size, not headline rate:
  $6 invoice → 7.9% · $84 (typical founder customer) → 3.26% · $263 (Run
  tier) → 3.0%. Consequences: never bill per-asset as separate charges (one
  subscription invoice per customer, which is how it's built); a 1-machine
  customer at $6/mo is the worst case and argues for a small minimum or
  annual prepay; and the scaling table's fee line assumes the $84 average —
  a fleet of tiny customers would run ~2× that.
- **Margin floor holds**: even 100% founder-priced cohort clears 70% GM; the
  platform fee ($49/$199) at list is nearly pure margin on top.

## Levers, in order of impact at 500 customers

1. **KORE pooled SIM tier** (<$2 → <$1 as volume grows) — worth ~$3,400/mo
2. **Annual prepay on ACH** — cuts Stripe's ~3% to ~0.8% capped
3. **flespi commercial tier negotiation** at 1,000+ devices
4. Infra right-sizing — Supabase read replicas only when Reports traffic demands
