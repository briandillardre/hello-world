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

## Still to ask Felix (carried from docs/UNIT-ECONOMICS.md §5)

1. Which column is SuperSIM vs Carrier+ — and which does he recommend for
   rural Upstate SC job sites?
2. Volume breaks at 100 / 1,000 / 10,000 SIMs (quote shows flat pricing).
3. Dormant-SIM cost (equipment that sleeps all winter) + suspend/reactivate API.
4. Overage policy when a pooled SIM blows past its bucket.
5. MOQ, shipping, and lead times on the FMM00A / TAT141 / FMM650.
