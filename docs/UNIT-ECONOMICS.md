# HammerTrack Unit Economics & Scaling Gates

*Written Jul 11 2026, pricing verified against public vendor pages that day.
Purpose: know the cost floor and the breaking points BEFORE Founding 25 calls.
Internal doc — vendor names live here and in CLAUDE.md only, never user-facing.*

---

## The one-paragraph answer

**KORE quote landed Jul 13 (Felix — docs/HARDWARE-PRICING.md) and it beats
the worst case:** pooled 10–25 MB plans run **$0.70–$1.56/SIM/mo** vs the
$1.75 planning number, and hardware came in at $86 OBD / $83 battery unit /
$20 tags. At quoted SIM pricing, all-in COGS for a tracked machine is
**~$3.40/mo at Founding-25 scale, falling to ~$1.50 at 1,000 devices** — so a $6–8/tracked-asset price is
margin-positive from customer #1 and a $3 tier only works for BLE tool tags
(which have **zero recurring cost**). "100,000 devices tomorrow" physically
can't happen (install/shipping is the throttle), and every technical gate
below has a known fix that costs less than one month of the revenue that
triggers it. The two things to fix *before* the first paying customer are
cheap: map-tile licensing (~$25/mo) and the flespi Start plan (~$140/mo at
device #11).

---

> **Scope note:** this doc is per-device infrastructure COGS only. Email,
> insurance, CPA, marketing, and employees — the full P&L with hire triggers
> and the growth chart — live in **docs/OPERATING-MODEL.md**.

## 1 · Where every dollar goes (the full cost stack)

| Layer | Vendor | What we pay for | Scales with |
|---|---|---|---|
| Cellular data | Hologram (pilot) → KORE quoted Jul 13 (docs/HARDWARE-PRICING.md) | per-SIM/mo + data | # SIM devices |
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
- **KORE (quoted Jul 13, Felix)** — pooled 10 MB $0.70–1.20, 25 MB
  $0.81–1.56, 50 MB $1.08–2.04 per SIM/mo; SIM $1.50 one-time. New
  planning number: **$1.00/SIM/mo** (volume breaks still to ask).
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

> **Jul 13 update — KORE quote (docs/HARDWARE-PRICING.md):** SIM line drops
> to **~$1.00** at our 10–25 MB profile (flat quote; volume breaks TBD), so
> the bottom row becomes **≈ $3.35 / $2.12 / $1.45 / $1.15 / $1.10**. Gross
> margin at the $8 list rises to **~58% / 73% / 82% / 86%** across the same
> scale points — the SIM is still the biggest line, but the Kore
> negotiation already bought back 6–9 margin points.

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
$500 setup fee" — the anti-Tenna wedge). **Quoted (KORE, Jul 13):** OBD unit
$86, battery equipment unit $83, wired CAN equipment unit $112 + $118
adapter = $230, tags $20, SIM $1.50 one-time.

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

## 5 · Felix / Kore ask list — status after the Jul 13 quote

1. ~~Price structure at ~10 MB profile~~ ✅ **$0.70–1.56/SIM/mo pooled** (docs/HARDWARE-PRICING.md)
2. ~~Multi-IMSI fallback~~ ✅ two families quoted: SuperSIM (AT&T/T-Mo/Verizon) and Carrier+ (AT&T native + failover) — **still to confirm which column is which**
3. Volume breaks at 100 / 1,000 / 10,000 SIMs (quote reads flat)
4. **Zero-usage months** — dormant winter SIM cost + suspend/reactivate API
5. Pooled-overage policy, MOQ, shipping, lead times
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

## 7 · Map-data layers at scale — Jul 14 refresh

The weather/map stack grew a lot (clouds, storm tops, wind flow, watches,
RTMA temp/feels/wind, radar + rain totals, city lights, traffic, webcams,
stream gauges, PWS network). Key fact: **these cost per VIEWER, not per
asset** — a 500-truck account with 5 dispatchers costs the same in map data
as a 5-truck account with 5 users. The per-asset cost stack in §3 is
unchanged; this section is the per-user adder.

| Layer | Source | Cost today | At ~1,000 active users | Watch-out |
|---|---|---|---|---|
| Basemap (dark/streets) | CARTO free tiles | $0 | **Gate G2: MapTiler $25–95/mo** | CARTO free tier is goodwill, not a contract — G2 stands |
| Satellite | Esri World Imagery | $0 (attribution) | $0–$95/mo if rate-limited → MapTiler satellite | Watch for 429s in /api/monitor |
| Radar + rain totals | IEM (NEXRAD/MRMS) | $0 | $0 | Public service; browser-cached |
| Clouds + storm tops + city lights | NASA GIBS (CloudFront CDN) | $0 | $0 | No key, no quota published; 1 domain query/10 min/client |
| Wind flow | Unidata THREDDS | $0 | $0 (server caches 3 h per instance) | Academic courtesy; add a KV cache (~$10/mo) if instances multiply |
| Storm watches/warnings | SPC/NWS | $0 | $0 | 5-min server cache already in place |
| Temp / feels-like / wind speed | NOAA nowCOAST WMS | $0 | $0 | Gov service |
| **Traffic** | TomTom | $0 (2.5k tiles/day free) | **~$300–700/mo if default-on** | The ONLY layer with a real bill. Stays default-OFF; consider Pro-tier gating past ~200 DAU |
| Webcams | Windy (free key, proxied + cached) | $0 (500 req/day) | ~$0–20/mo | Server cache keeps us under quota |
| Reverse geocode / POI names | BigDataCloud + Photon | $0 | $0–$50/mo | Photon is courtesy — swap to self-hosted Nominatim if throttled |
| Weather stations | Ambient public network | $0 | $0 | — |

**Planning adder: ~$0.10–0.30 per active user per month at 1k users**, and
almost all of it is TomTom exposure. Everything else in the weather stack is
government/NASA/university data that scales free.

Actions (no new gates needed below ~1k users):
1. G2 (MapTiler key) unchanged — trigger at real traction, ~$25/mo entry.
2. TomTom is the one budget risk: it's default-off today; before any big
   user push, add a daily tile-count check (the diag workflow can carry it)
   and a hard per-day cap in the layer code if usage climbs.
3. Storage (asset_locations growth) remains the real scale item and is
   already gated in §4 (G3 at ~300 devices: retention/downsampling job).
