# Fleet Telematics & Data Capability — DCG reference + product opportunity

*Jul 15 2026. Verified per-machine research (4 parallel research passes) on the
Dillard Construction fleet: what data each machine offers, which connector, and
how to get it. Internal — informs both the KORE hardware order and the
HammerTrack roadmap.*

## The strategic finding: two lanes to machine data

**API lane (free, no hardware).** Most major construction OEMs expose engine
hours / fuel / idle / location / fault codes over the standard
**ISO 15143-3 (AEMP 2.0)** telematics API. HammerTrack can pull those feeds
directly — flespi already ships an AEMP parser. Confirmed API support:
- **Komatsu** (My Komatsu / KOMTRAX) — ISO 15143-3 certified
- **Link-Belt** (RemoteCARE via ORBCOMM) — ISO 15143-3
- **New Holland / CNH** (FleetForce) — AEMP 2.0
- **Bomag** (Telematic) — ISO 15143-3
- **Caterpillar** (VisionLink / Product Link) — Cat AEMP API — *covers the Weiler P385A (Cat dealer product)*
- **Wirtgen Group** (Hamm WITOS) — AEMP, *only if a "WITOS Ready" TCU is fitted*

**CAN lane (hardware).** No-API machines get a Teltonika **FMM650 + ALL-CAN300**
J1939 tap: Sany, Sakai, LeeBoy, and the US trucks (International, Peterbilt,
Ford F-650). Light pickups use the **FMM00A** OBD-II plug-in.

## Per-machine verdict (powered machines)

| Machine | Setup | Note |
|---|---|---|
| Komatsu D51PXi-22 dozer | **API + TAT141** | KOMTRAX, ISO 15143-3 |
| Link-Belt 130X2 excavator | **API** | RemoteCARE free + built-in theft geofence |
| New Holland E160 excavator | **API + TAT141** | FleetForce, AEMP 2.0 |
| Bomag BW213 D-5 roller | **API + TAT141** | Telematic, ISO 15143-3 (or CAN if no sub) |
| Weiler P385A paver | **API + TAT141** | Cat VisionLink AEMP |
| Hamm HD12VV roller | **API if WITOS-equipped**, else TAT141 | plain HD12VV = non-intelligent |
| Sany PQ190 grader | **FMM650 + CAN** | Cummins J1939; verify older vs PQ190III |
| Sakai SW990 roller | **FMM650 + CAN** | Deutz J1939; AEMP unclear |
| LeeBoy 8500C paver | **FMM650 + CAN** | no LeeBoy telematics (Guardian = Astec, not LeeBoy) |
| LeeBoy 420 roller | **FMM650 + CAN** | Kubota Tier-4; verify bus |
| Ford F-650 (Cat C7) | **FMM650 + CAN — partial** | full data on Cat proprietary CDL (unreadable); pre-DEF; bench-verify |
| International LF627 day cab | **FMM650 + CAN** | clean MaxxForce J1939 |
| Peterbilt 567 tri-axle dump (2015) | **FMM650 + CAN** | PACCAR MX-13 12.9L, clean J1939. Bought Aug 4 2026 at STA auction, $37,065 all-in, VIN 1NPCXPEX8FD247526, 341k mi, Allison auto, ECU report on file. Replaces the 579 (being sold — archive its asset, don't delete; move its tracker via Reassign Tracker). Class-8 dash port is 9-pin Deutsch J1939, NOT OBD-II — an FMM00A won't plug in; FMM650 + ALL-CAN300 (or 9-pin harness) is the right fit. |
| Bomag BMP8500 trench roller | **TAT141** | 19 hp Kubota mechanical — no CAN |
| LeeBoy 300B roller (2004) | **TAT141** | Vanguard gas — no CAN |
| Multiquip AR13HA roller ×2 | **TAT141 / BLE** | Honda gas — no ECU |
| Tundra / Chevy 2500 / Ram 3500 | **FMM00A** | OBD-II plug-in, full data (GM also has OnStar data API) |

## Order impact

CAN-kit count drops **14 → ~7** (only no-API machines). ~$1,600 less hardware,
and the API machines give richer data (full OEM fault sets) than a basic tap.
Recommended **hybrid**: order CAN kits for the 7 no-API machines + FMM00A
pickups + TAT141 (trailers, mechanical machines, and live-theft insurance on the
5 API machines) now; build the ISO 15143-3 ingestion in parallel.

## Product opportunity — BUILT (Jul 15 2026, task #92)

The **ISO 15143-3 / AEMP 2.0 ingestion connector** now ships: a mixed-fleet
contractor with Komatsu + Cat + CNH + Bomag machines sees them all in
HammerTrack with zero hardware — the premium aggregation feature enterprise
platforms (Tenna) charge for. Komatsu (KOMTRAX) + Link-Belt (RemoteCARE) are the
first two feeds; the same connector serves Cat/CNH/Bomag/Wirtgen. Setup +
architecture: **`docs/OEM-TELEMATICS.md`**. To go live, Brian requests ISO
15143-3 API access from Komatsu (My Komatsu) and the Link-Belt dealer (RemoteCARE
via ORBCOMM), then drops the Fleet URL + credentials into an `oem_connections`
row. Caveat unchanged: OEM feeds are lower-frequency, so real-time theft still
needs a live tracker — pair API-pull with a TAT141 on high-value machines.

## Bench-verify before promising billing-grade hours
Sany (older vs PQ190III) · F-650 Cat C7 (partial J1939, no DEF) · Hamm (WITOS
fitted?) · LeeBoy 8500C/420 (electronic Kubota?) · Peterbilt (SmartLinq VIN) ·
and check existing dealer logins (KOMTRAX/RemoteCARE/FleetForce/VisionLink) —
much of this data may already be live today.
