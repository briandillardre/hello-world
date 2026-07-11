# HammerTrack Unit Economics & Scaling Gates

*Written Jul 11 2026, pricing verified against public vendor pages that day.
Purpose: know the cost floor and the breaking points BEFORE Founding 25 calls.
Internal doc — vendor names live here and in CLAUDE.md only, never user-facing.*

---

## The one-paragraph answer

**You are not blocked on Kore.** Hologram's current bills (~$1–2/SIM/mo on the
pilot) are the *worst case* — a Kore quote can only lower it. At worst-case SIM
pricing, all-in COGS for a tracked machine is **~$4/mo at Founding-25 scale,
falling to ~$2 at 1,000 devices** — so a $6–8/tracked-asset price is
margin-positive from customer #1 and a $3 tier only works for BLE tool tags
(which have **zero recurring cost**). "100,000 devices tomorrow" physically
can't happen (install/shipping is the throttle), and every technical gate
below has a known fix that costs less than one month of the revenue that
triggers it. The two things to fix *before* the first paying customer are
cheap: map-tile licensing (~$25/mo) and the flespi Start plan (~$140/mo at
device #11).

---

## 1 · Where every dollar goes (the full cost stack)

| Layer | Vendor | What we pay for | Scales with |
|---|---|---|---|
| Cellular data | Hologram today, Kore quote pending | per-SIM/mo + data | # SIM devices |
| Telemetry pipe | flespi | plan tier by device count | # devices |
| Database + auth | Supabase | compute instance, storage GB, egress | rows written + app traffic |
| App hosting + ingest | Vercel | function invocations, CPU-hrs, bandwidth | # devices (ingest) + # users (app) |
| Map tiles | CARTO free today → MapTiler | tile requests / sessions | # active *viewers*, not devices |
| SMS alerts | Twilio | ~$0.008/msg + carrier fees | alert volume (tiny) |
| Push alerts | ntfy | free | — |
| AI assistant | Anthropic | per query (fractions of a cent on Haiku) | usage (tiny) |
| Geocoding/POI/weather | Photon, BigDataCloud, Open-Meteo, NASA GIBS | free community tiers | # users (fine until thousands) |
| Hardware | Teltonika + BlueCharm | one-time per unit | # units shipped |

**Verified pricing (Jul 2026):**

- **flespi** — Free tier is dev-only (≈10 devices). **Start ≈ €130/mo includes
  1,000 devices**, then €2/mo per extra 100. Enterprise €1,000/mo, Ultimate
  €3,000/mo (SLA + high-load). Source: flespi.com/pricing + blog.
  → per-device cost: €0.13/mo at 1k, ~€0.03/mo at 10k. The pipe is never the
  problem — it's built for exactly this.
- **Supabase** — Pro $25/mo (includes $10 compute credit ≈ Micro instance).
  Compute upgrades: Small ~$15, Medium ~$60, Large ~$110, XL ~$210/mo.
  Storage $0.125/GB-mo over the included 8 GB. Egress 250 GB included, then
  $0.09/GB.
- **Vercel** — Pro $20/user/mo, includes 1M function invocations + 1,000
  GB-hrs. Overage: $0.60 per **million** invocations, $0.128/CPU-hr,
  $0.0106/GB-hr. No hard spend cap on Pro — set spend alerts.
- **Hologram (pilot actuals)** — ~$1–2/SIM/mo at our usage profile
  (~5–10 MB/mo per truck: Codec 8E records are ~100–150 bytes on the wire).
  Planning number: **$1.75 list / $1.10 negotiated**.
- **MapTiler** — Free tier is non-commercial. **Flex $25/mo** (+$0.10 per
  1,000 extra requests), Unlimited $295/mo.
- **CARTO free basemaps — ⚠ licensing gap.** The free tile endpoints we use
  today are not licensed for commercial production use (Enterprise license
  required). Fine for the pilot/demo; **switch the default basemap to MapTiler
  Flex ($25/mo) before the first paying customer.** One env var
  (`NEXT_PUBLIC_MAPTILER_KEY`) — the code already falls back the other way.
- **Twilio** — ~$0.0083/SMS + carrier surcharges once toll-free verification
  lands (post-EIN). At 10 alerts/customer/mo this rounds to zero.
- **Anthropic** — Haiku 4.5 $1/$5 per M tokens ≈ **$0.005 per assistant
  question**. Even 1,000 questions/customer/mo is $5.

## 2 · What one device actually generates (pilot-measured profile)

From T1-a in the Chevy (Codec 8E, active tracking while driving, hourly
heartbeat parked):

| Metric | Per active vehicle | Notes |
|---|---|---|
| Rows/day | ~2,000 (worst ~5,000) | ~1.5–3 h driving at seconds-level records |
| Cell data/mo | ~5–10 MB | binary protocol is tiny |
| DB growth/mo | **~60 MB** | row ≈ 1 KB on disk: UUID pk + 2 UUIDs + geom + 2 indexes + **`raw` JSONB (the fat — full tracker param dump)** |
| Equipment unit | ~10× lighter | 5-min intervals moving, sleeps parked |
| Tool tag | ~zero | no SIM, no rows — inherits gateway location |

Two levers when storage matters (~gate 2 below): stop storing `raw` after 30
days (strip to nulls), and downsample rows older than 90 days to 1/min. Both
are single SQL jobs; neither loses anything the UI shows today.

## 3 · Cost per SIM-asset per month, by scale

Fixed platform costs spread across the fleet + per-SIM cost. "Devices" =
SIM-carrying units (trucks + equipment); tool tags add revenue with ~$0 COGS.

**Monthly platform bills** (absolute $):

| | 100 devices | 250 | 1,000 | 10,000 | 100,000 |
|---|---|---|---|---|---|
| flespi | $140 | $140 | $140 | ~$340 (or Ent. $1,080) | Ultimate ~$3,240 |
| Supabase | $35 | $50 | $85 | $500 | — (moved off, see gate 5) |
| Telemetry DB at scale | — | — | — | — | ~$3,500 (Timescale/ClickHouse) |
| Vercel (app + ingest) | $20 | $30 | $60 | $150 + ingest VM $75 | ingest cluster ~$750 |
| Map tiles | $25 | $30 | $95 | $295 | self-host + CDN ~$750 |
| SMS / AI / misc | $15 | $30 | $60 | $300 | $2,000 |
| **Fixed subtotal** | **$235** | **$280** | **$440** | **~$1,700** | **~$10,200** |

**Per device · share of all-in COGS** (each cell: $/device/mo · % of total):

| | 100 devices | 250 | 1,000 | 10,000 | 100,000 |
|---|---|---|---|---|---|
| flespi | $1.40 · **34%** | $0.56 · 20% | $0.14 · 7% | $0.03 · 2% | $0.03 · 3% |
| Supabase / telemetry DB | $0.35 · 9% | $0.20 · 7% | $0.09 · 4% | $0.05 · 4% | $0.04 · 3% |
| Vercel + ingest | $0.20 · 5% | $0.12 · 4% | $0.06 · 3% | $0.02 · 2% | $0.01 · 1% |
| Map tiles | $0.25 · 6% | $0.12 · 4% | $0.10 · 5% | $0.03 · 2% | $0.01 · 1% |
| SMS / AI / misc | $0.15 · 4% | $0.12 · 4% | $0.06 · 3% | $0.03 · 2% | $0.02 · 2% |
| **SIM (cellular)** | $1.75 · **43%** | $1.75 · **61%** | $1.50 · **77%** | $1.20 · **88%** | $1.10 · **92%** |
| **COGS / device / mo** | **$4.10** | **$2.87** | **$1.94** | **$1.37** | **$1.20** |

**Is flespi a problem? No — it's a step-function, not a scaling cost.** The
$140 looks ugly at 100 devices (34% of COGS) only because you're prepaying
for 1,000 devices of headroom on day one. It never goes up until device
1,001, so it dilutes to 7% at 1,000 and ~2% beyond — the *best*-scaling line
on the sheet. At 100 devices, $140/mo ≈ the revenue from ~23 machines at $6:
one mid-size customer covers the entire pipe. (Replacing it with our own
TCP-parser service is possible — the normalizer already speaks Codec 8E —
but trading a $140 bill for an on-call ingest server + lost device console
is a bad trade below thousands of devices.)

**The line that actually owns your COGS is the SIM: 43% at 100 devices,
92% at 100k.** That's why the Kore negotiation is the only vendor
conversation that materially moves margin — every other line rounds to
noise at scale.

**Gross margin at price points** (SIM-carrying assets):

| Price | 100 | 250 | 1,000 | 10,000 |
|---|---|---|---|---|
| $3/mo | −37% | 4% | 35% | 54% |
| $6/mo | 32% | 52% | 68% | 77% |
| $8/mo | 49% | 64% | 76% | 83% |

**Read this table before pricing:** $3/asset is a *tool-tag* price, not a
tracker price. The pricing page's $3–8 range works if the tiers mean:
**$3/mo per BLE tool tag** (pure margin), **$6–8/mo per tracked machine**
(healthy from customer #1). Hardware passes through at cost ("you own it, no
$500 setup fee" — the anti-Tenna wedge): OBD unit ~$60–80, equipment unit
~$110–150 + solar, tags $20.

## 4 · "If I add 100,000 devices tomorrow, what breaks?" — the gates, in order

| Gate | When | What breaks | Fix | Cost |
|---|---|---|---|---|
| **G1** | **Device #11** (imminent) | flespi free tier caps out | Start plan | €130/mo |
| **G2** | Any paying customer | CARTO tile license (non-commercial) | set MapTiler key, flip default basemap | $25/mo |
| **G3** | ~300–2,000 devices | `asset_locations` unpartitioned, no retention → slow queries, storage climb | monthly partitions + strip `raw` >30d + downsample >90d (one migration + one cron) | a weekend |
| **G4** | ~2,000–5,000 devices | Vercel serverless ingest: DB connection churn under sustained webhook fire | tiny always-on ingest service (Fly/Railway) doing batched inserts; flespi just re-points the webhook URL | ~$50–100/mo |
| **G5** | ~20,000–50,000 devices | Postgres-for-telemetry economics (200M rows/day at 100k) | history → TimescaleDB or ClickHouse; Supabase stays for auth/app data | ~$2–5k/mo + ~a month of work |
| **G6** | thousands of users | free geocoding/weather APIs (Photon, BigDataCloud) are community services, no SLA | paid geocoding tier | ~$50–200/mo |

**Literal answer to the literal question:** if 100k devices lit up tomorrow,
flespi's Ultimate tier would absorb the pipe without blinking; Supabase would
start queueing then rejecting writes within hours (G3+G5 under fire); the
Vercel bill would spike but not fatally; the map would keep working. Nothing
is unrecoverable — but that's why G3 gets done at ~300 devices and G4 at
~2,000, long before they're emergencies. Operationally you can't onboard
faster than you can ship and install hardware, and that throttle is measured
in dozens per week, not thousands per day.

## 5 · What to get from Felix / Kore (the actual ask list)

1. Per-SIM monthly at 100 / 1,000 / 10,000 units — pooled Cat-M1, US + Canada.
2. Price structure: SIM/platform fee vs data, at a ~10 MB/device/mo profile.
3. **Zero-usage months** — equipment sleeps all winter; what does a dormant SIM cost?
4. Suspend/reactivate API (churned customers shouldn't burn SIM fees).
5. eUICC / multi-IMSI carrier fallback (dead zones on rural job sites).
6. Volume breaks and **contract minimums — do not sign a minimum before
   Founding 25 is full.** Month-to-month at 100 units even if it costs more.
7. Form factors: nano for the OBD units, and confirm the equipment unit's SIM spec.

Decision rule: Kore wins only if ≥25% under Hologram at the 1,000-unit tier
*without* a minimum commitment. Otherwise Hologram's per-line flexibility is
worth more than pennies right now.

## 6 · Verdict

- **Right:** don't quote prices you can't stand behind; know the floor first.
  This doc is the floor.
- **Wrong:** waiting on Kore. The floor is computable at worst-case (current
  Hologram) pricing today, and it already supports $6–8/machine + $3/tag with
  a 12-month founder price lock. A better SIM rate is pure upside — bank it,
  don't wait on it.
- **Before the first check clears:** G1 (flespi Start) and G2 (MapTiler key).
  ~$165/mo total. Everything else has a trigger tied to device count — revisit
  this doc at 300, 2,000, and 20,000 devices (gates G3/G4/G5).

*Cross-check: numbers verified via vendor pricing pages Jul 11 2026 (flespi
pricing page/blog; Supabase pricing; Vercel pricing/limits; MapTiler pricing;
CARTO basemaps docs). Hologram list pricing is quote-gated — planning numbers
here come from our actual pilot bills. Re-verify flespi Start inclusions
before signing anything.*
