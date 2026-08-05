# Hardware & Connectivity Pricing — KORE Quote (Felix)

*Received Jul 13 2026 from Felix @ KORE ("Proposal for Dillard Construction").
KORE's footer marks this pricing **confidential** — internal doc only, never
user-facing, never in marketing. Vendor/model names live here + CLAUDE.md only.*

## Hardware (quoted)

| Device | Role | Price |
|---|---|---|
| Teltonika FMM00A OBD-II tracker | Trucks (T1) — plug-in | **$86.00** |
| Teltonika FMM650 wired tracker | Heavy equipment, CAN-capable | **$112.00** |
| Teltonika CAN adapter (for FMM650) | J1939 CAN reading on machines | **$118.00** |
| Teltonika TAT141 battery asset tracker | Equipment (T2) — no wiring | **$83.00** |
| Teltonika BLE beacon | Tool tags (T3) | **$20.00** |
| SIM card (one-time) | — | **$1.50** |

## Pooled data plans (per SIM per month)

Two plan families quoted — **confirm with Felix which column is which**:
*SuperSIM* (multi-carrier: AT&T, T-Mobile, Verizon) vs *Carrier+* (AT&T
native bootstrap, multi-carrier failover).

| Pool size | Column A | Column B |
|---|---|---|
| 10 MB | $0.70 | $1.20 |
| 25 MB | $0.81 | $1.56 |
| 50 MB | $1.08 | $2.04 |
| 1 GB | $5.00 | $5.16 |

**Our usage profile (pilot actuals):** ~5–10 MB/mo per truck (Codec 8E
records are ~100–150 bytes). The 10 MB pool fits; 25 MB is the safety pick.
**Planning number: ~$1.00/SIM/mo** (was $1.75 pre-quote).

## Per-configuration COGS

| Config | Hardware | One-time | Monthly data |
|---|---|---|---|
| Truck (OBD) | $86.00 | +$1.50 SIM | ~$0.70–1.56 |
| Equipment — battery (TAT141) | $83.00 | +$1.50 SIM | ~$0.70–1.20 (checks in less) |
| Equipment — wired + CAN (FMM650) | $112 + $118 = **$230** | +$1.50 SIM + install labor | ~$0.81–1.56 |
| Tool tag (BLE) | $20.00 | — | $0 (inherits gateway) |

**Kit math:** 10-truck kit ≈ **$875** hardware ($86×10 + SIMs). Reference
20-asset GC (8 trucks, 5 machines on TAT141, 7 tags) ≈ **$1,265** — right on
the plan's $1,275 estimate, now quoted instead of guessed.

## What the FMM650 + CAN adapter unlocks (Phase 2, now priced)

Datasheet highlights: 8–32 V input, J1939 FMS CAN (true engine hours, fuel,
fault codes) + J1708 fuel + K-Line tachograph, RS232/RS485 for external
sensors, dual-SIM/eSIM, 550 mAh backup battery, switchable CAN terminators.
**$230/machine hardware turns "GPS dot" into "billable utilization meter"** —
this is the premium-equipment-tier device ($12–15/mo pricing, see
docs/PRICING-TIERS.md).

TAT141 (from datasheet): IP68, periodic + scheduler reporting, accelerometer
wake, recovery mode, lost-BLE-sensor scenario — confirms it as the
no-wiring equipment default. (Solar accessory question to Teltonika still open.)

## ORDER #1 — signed + PAID $1,818 (Aug 5 2026, DocuSign; in fulfillment)

| Item | Part # | Unit | Qty |
|---|---|---|---|
| FMM00A | FMM00A1KUS01 (NS 201139) | $86 | 5 |
| TAT141 | TAT141BKBP01 (NS 201140) | $83 | 6 |
| FMM650 | FMM650Y3US01 (NS 201141) | $112 | 2 |
| ALL-CAN300 | ALC300RUVS01 (NS 201142) | $118 | 2 |
| Eye Beacon | BTSID17RM402 (NS 201144) | $20 | 10 |
| SuperSIM (triple-punch 2FF/3FF/4FF) | — | — | 13 |

Hardware subtotal $1,588; invoice total $1,818 paid by card via KORE's
Stripe/SuiteSync link. Connectivity agreement still pending in KORE's
system. **Matt Ferrans confirmed pre-configuration before shipping**
(SIMs enabled + tested, connectivity verified, plug-and-play) — send
KORE the flespi config profile. ⚠ These are SuperSIMs, NOT Hologram:
APN/config for the 13 new units differs from T1-a/b — get exact
settings from Matt before boxes arrive.

## White-label (Billy Stalder, Teltonika — Aug 4 2026)

200-unit MOQ · first run +2–3 wks lead, then ~4 wks · the gray
regulatory print on the device top must remain unchanged (changing it =
recertification ≈ $10k + months). Options sheet attached to his email.
Revisit at Founding-25 volume.

## Still to ask (Felix back Aug 10; Matt runs point meanwhile)

1. Which column is SuperSIM vs Carrier+ — and which does he recommend for
   rural Upstate SC job sites?
2. Volume breaks at 100 / 1,000 / 10,000 SIMs (quote shows flat pricing).
3. Dormant-SIM cost (equipment that sleeps all winter) + suspend/reactivate API.
4. Overage policy when a pooled SIM blows past its bucket.
5. MOQ, shipping, and lead times on the FMM00A / TAT141 / FMM650.
6. Answers still owed from Brian's Aug 5 email: ordering API/EDI for the
   Stripe auto-order flow, drop-ship with HammerTrack packing slip, SIM
   billing start trigger, ALL-CAN300 per-machine coverage list, TAT141
   12/24V harness part # + pricing, OBD extenders + zip ties in-box,
   mounting accessories, RMA/warranty terms + DOA cross-ship.
