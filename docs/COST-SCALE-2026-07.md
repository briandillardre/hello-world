# Cost Stack & Scaling — revised Jul 31 2026

*Supersedes the cost figures in UNIT-ECONOMICS.md for the vendor stack as it
actually exists after the Jul 30–31 account setup (Mercury, Stripe, Twilio
toll-free, Plaid, Supabase Pro, Workspace). Pricing model: PRICING-TIERS.md.
Hiring/P&L curve: OPERATING-MODEL.md — this doc is COGS + opex only.*

## Fixed monthly (platform — exists at zero customers)

| Item | Today | Notes |
|---|---|---|
| Vercel Pro | $20 | hosting + cron + auto-migrations |
| Supabase Pro | $25 | Postgres/PostGIS, auth, realtime, backups |
| Google Workspace | $7 | brian@hammertrack.ai (1 seat) |
| Twilio toll-free | $2.15 | + $0.008/SMS segment once TFV approves |
| Domains (4, amortized) | ~$11 | hammertrack.ai is $93/yr of it |
| UPS Store mailbox | ~$30 | public/support address (this week) |
| QuickBooks Online (HT's own books) | ~$35 | when opened — keep separate from DCG |
| ntfy / CARTO / Photon / open-meteo / GIBS | $0 | free tiers doing real work |
| **Fixed total** | **~$130/mo** | pre-revenue burn, software side |

Stripe (2.9% + 30¢) and Plaid (~$0.30/linked account) are usage-priced — zero
until customers exist, then they scale with revenue below.

## Per-unit COGS (monthly)

| Unit | Pilot (Hologram/flespi free) | At scale (KORE pooled) |
|---|---|---|
| SIM-carrying machine (OBD / TAT / CAN) | ~$2.50 SIM + $0 flespi | $0.70–1.56 SIM + ~$0.50 flespi |
| Bluetooth tool tag | $0 | $0 |
| AI (Run tier only) | — | ~$0.50–2/customer (Haiku tokens) |

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
| SIMs in field | 2 | 200 | 800 | 4,000 |
| SIM + flespi COGS | $5 | ~$400 | ~$1,360 | ~$6,000 |
| Fixed infra | $130 | $130 | ~$300¹ | ~$900¹ |
| Stripe fees | $0 | ~$70 | ~$330 | ~$1,650 |
| Plaid + AI usage | $0 | ~$30 | ~$150 | ~$700 |
| **Total cost** | **$135** | **~$630** | **~$2,140** | **~$9,250** |
| **Gross margin** | — | **70%** | **81%** | **83%** |

¹ Supabase compute add-ons + Vercel usage grow with ingest volume (a moving
truck ≈ 1 fix/sec); assume one infra step-up per ~300 SIMs. The sampled_history
work (039) is what keeps read load flat as history grows.

## What changed vs the pre-launch estimates

- **SMS is toll-free, not 10DLC** — no $2–15/mo campaign fee; $2.15 + per-message.
- **Hardware truth**: OBD is $86 (not the $40–60 the old pricing page claimed —
  fixed Jul 31). At-cost pass-through only works if the quoted number is real.
- **Stripe fees are the third-largest cost at scale** — behind SIMs and infra.
  ACH/bank debit for annual plans later cuts this ~60%.
- **Margin floor holds**: even 100% founder-priced cohort clears 70% GM; the
  platform fee ($49/$199) at list is nearly pure margin on top.

## Levers, in order of impact at 500 customers

1. **KORE pooled SIM tier** ($1.56 → $0.70 as volume grows) — worth ~$3,400/mo
2. **Annual prepay on ACH** — cuts Stripe's ~3% to ~0.8% capped
3. **flespi commercial tier negotiation** at 1,000+ devices
4. Infra right-sizing — Supabase read replicas only when Reports traffic demands
