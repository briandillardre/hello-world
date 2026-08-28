# Teltonika Devices — Buying Reference

*Internal doc. Written Aug 28 2026 for the order #2 decision. Everything here
was pulled from teltonika-gps.com / wiki.teltonika-gps.com and the official
datasheet PDFs linked below; anything I could NOT confirm from a real source is
marked **UNVERIFIED** rather than guessed. No KORE pricing here — that's
confidential and lives in `docs/HARDWARE-PRICING.md`.*

Our stack constraint, for context on every recommendation below: device →
flespi channel 1401177 (TCP, **Codec 8 Extended**) → `/api/ingest/flespi`. Any
Teltonika FMx/TAT/ATx that speaks Codec 8E over TCP drops into the existing
pipeline with zero server work.

---

## 1. Reading a model number

Teltonika doesn't publish a decoder page, but the pattern is consistent across
their catalog and their own wiki uses `FMX` as a wildcard for the modem letter
(e.g. the ADAS page says "FMX125 & FMX225", "FMX6"), which is the giveaway:
**letter 3 = the radio, digits = the hardware body.**

### Letters 1–2 — the family

| Prefix | Family | What it is |
|---|---|---|
| `FM` | Fleet Management | Powered vehicle/machine trackers (the main line) |
| `FT` | Fleet Telematics | Newer-generation replacements for the FM line (FTC/FTM 880/920/960 series) |
| `TAT` | Teltonika Asset Tracker | Battery-powered, non-powered assets |
| `ATC`/`ATM` | Asset Tracker | New (2026) rechargeable mini asset trackers |
| `TFT`/`TST` | E-mobility | Scooters, e-bikes, forklifts |
| `TMT`/`GH` | Personal/man-down | Lone-worker, panic-button |
| `EYE` | BLE accessory | Beacons and sensors (no cellular) |
| `LV-CAN200` / `ALL-CAN300` / `ECAN02` | CAN adapters | Not trackers — they feed CAN data to an FM device |

### Letter 3 — the radio (the one that matters)

| Letter | Network | Evidence |
|---|---|---|
| `FMB…` | 2G GSM/GPRS only | FMB120: "GNSS/GSM/Bluetooth tracker" ([wiki](https://wiki.teltonika-gps.com/view/FMB120)) |
| `FMC…` | 4G LTE **Cat 1** (2G fallback) | FMC130: "Advanced LTE terminal" ([wiki](https://wiki.teltonika-gps.com/view/FMC130)) |
| `FMM…` | 4G LTE **Cat M1 / NB-IoT** (2G fallback) | FMM130: "Advanced CAT M1/GSM/GNSS/BLE terminal" ([wiki](https://wiki.teltonika-gps.com/view/FMM130)) |
| `FMU…` | 3G UMTS — **legacy, mostly EOL** | FMU126 is listed EOL ([wiki](https://wiki.teltonika-gps.com/view/FMU126)) |
| `FMT…` | Small waterproof body, not a radio code | FMT100: "Special and small waterproof GNSS tracker" ([wiki](https://wiki.teltonika-gps.com/view/FMT100)) |
| `FMP…` | Cigarette-lighter plug body | FMP100 ([wiki](https://wiki.teltonika-gps.com/view/FMP100)) |
| `FTC…` / `FTM…` | Same rule on the new line: **C = Cat 1, M = Cat M1** | FTC921: "4G LTE Cat 1 vehicle GPS tracker" ([wiki](https://wiki.teltonika-gps.com/view/FTC921)) |

So `FMC130` and `FMM130` are the same hardware with different modems, and
`FMM00A` = Cat M1 version of the `00A` OBD body. Same for `FMC650` / `FMM650`.

**For us: always the `M` letter.** Cat M1 is what the KORE SuperSIM plan and
our coverage assumptions are built on, and it's the low-power option. Never buy
`FMB` (2G is being shut down) and only buy `FMC` if we specifically need Cat 1
bandwidth — which, for telemetry, we don't. The one place Cat 1 matters is
**camera add-ons** (see §3).

### The digits — the body/feature class

Not a strict code, but reliable in practice:

- `00x` / `0xA` — OBD-II plug-in (FMB001/003, FMM00A). Plug & play, no wiring.
- `1xx` — the workhorse wired terminals (110/120/125/130/150). `125` = RS232/RS485,
  `130`/`150` = CAN-capable variants, `1xx` are internal-antenna.
- `2xx` — same class but **IP67 waterproof, external antennas** (202/225/230/240/250).
- `6xx` — professional/CAN flagship (650): dual CAN, RS232 ×2, RS485, tachograph.
- `8xx` / `9xx` — "fast & easy" and "basic" small trackers (800/880/900/920/965).
- Trailing `A` (00A, 13A, 80A) — a hardware revision of the same body.

---

## 2. Capability matrix

Rows are the families worth considering. **Bold** = we already own it.

| Device | Power | Network | BLE — how it scans | CAN / J1939 | Camera | Battery life | Use for |
|---|---|---|---|---|---|---|---|
| **FMM00A** | OBD-II port (10–30 V), 115 mAh backup | Cat M1 | **Full beacon list, Detect All (max 100/record)** | Reads OBD-II K-Line + CAN via the port; not J1939 | No | n/a (vehicle power) | Light-duty trucks, plug & go |
| FMM003 | OBD-II port | Cat M1 | Full beacon list | OBD-II | No | n/a | Same as 00A, older rev |
| FMM130 | Wired 10–30 V | Cat M1 | Full beacon list | Via LV-CAN200 / ALL-CAN300 adapter | No | n/a | Wired trucks, hidden install |
| FMM125 | Wired, RS232/RS485 | Cat M1 | Full beacon list | Via adapter | UNVERIFIED for FMM; **FMC125 is a listed DualCam/DashCam host** | n/a | Serial peripherals |
| FMM230 / FMC230 | Wired, **IP67**, external antennas | Cat M1 / Cat 1 | Full beacon list | Via adapter | FMC225 hosts DualCam/DashCam | n/a | Outdoor/exposed mounts |
| **FMM650** | Wired 8–32 V, 550 mAh backup | Cat M1/NB-IoT | **Full beacon list, Detect All — but max 25 beacons per record** | **Native**: FMS CAN (J1939), J1708 fuel, dual CAN with switchable terminators | **Yes** — 2× RS232; ADAS explicitly supports "FMX6"; DSM + DualCam simultaneously on FMC650 | n/a | Heavy equipment with CAN |
| **TAT141** | **Internal 2200 mAh Li-SOCl2, non-rechargeable, no solar** | Cat M1 / NB2 (2G fallback) | **NOT a beacon scanner. 4 MAC-addressed sensor slots (AVL "BLE 1–4"); EYE Beacons supported in recovery mode only** | No | No | No published figure (see §3) | Battery equipment, trailers — GPS only |
| TAT240 | Internal 2200 mAh Li-SOCl2 | **Cat 1** | Same 4-slot limitation as TAT141 | No | No | No published figure | Same as TAT141 + magnetic tamper detection |
| TAT100 / TAT140 | Internal battery | 2G / Cat M1 | Sensor-slot model | No | No | No published figure | Older/cheaper asset trackers |
| ATM700 / ATC700 | **Rechargeable 1000 mAh Li-Po**, USB-C, power-bank support | Cat M1 (ATM) / Cat 1 (ATC) | **No BLE at all** — not in the datasheet | No | No | Short (rechargeable) | Workforce, short-term asset tags. Not for us |
| **EYE Beacon (BTSID1)** | Coin cell | BLE only | It IS the beacon | — | — | Vendor claim, unverified | Tool tags |
| ALL-CAN300 / LV-CAN200 | — | — | — | Adapter that gives an FM device J1939/CAN | — | — | Bolt-on CAN for 1xx/2xx bodies |

Sources: [FMM00A datasheet v1.8](https://wiki.teltonika-gps.com/images/3/3d/FMM00A_Datasheet_V1.8.pdf) ·
[FMM650 datasheet](https://wiki.teltonika-gps.com/images/7/77/DS-FMM650.pdf) ·
[TAT141 datasheet v2.3](https://wiki.teltonika-gps.com/images/4/4f/DS-TAT141.pdf) ·
[TAT240 datasheet](https://wiki.teltonika-gps.com/images/c/c7/DS-TAT240.pdf) ·
[ATM700 datasheet](https://wiki.teltonika-gps.com/images/b/b4/DS-ATM700.pdf) ·
[ATC700 datasheet](https://wiki.teltonika-gps.com/images/a/ad/DS-ATC700.pdf) ·
[FMM00A Beacon List](https://wiki.teltonika-gps.com/view/FMM00A_Beacon_List) ·
[FMM650 Beacon List](https://wiki.teltonika-gps.com/view/FMM650_Beacon_List) ·
[TAT141 Bluetooth settings](https://wiki.teltonika-gps.com/view/TAT141_Bluetooth_settings) ·
[TAT141 AVL ID List](https://wiki.teltonika-gps.com/view/TAT141_AVL_ID_List)

### The BLE distinction, spelled out

This is the single most important line in the doc for our product, because
tool tracking is the differentiator.

There are **two completely different BLE features** in Teltonika's catalog and
they are easy to confuse:

1. **Beacon scanning ("Beacon List")** — an FMx-family feature. `Beacon
   Detection = All` makes the device report *every* beacon it hears, no
   pre-configuration. This is what our onboarding config sets (`Beacon
   Detection = All`, Non Stop Scan = Enable) and it's what makes "drop a puck
   in any truck and it just shows up" work. Caps differ by model: **FMM00A =
   100 beacons per record; FMM650 = 25 per record.**
2. **Sensor slots** — a fixed, small number of BLE peripherals identified by
   MAC address, each mapped to an I/O field (temp/humidity/magnet/movement).
   You must type in each MAC. **This is all the TAT141 has.**

The FMM650's 25-per-record cap is worth planning around: a tool trailer with
40 tags on one FMM650 will not report all 40 in a single record. UNVERIFIED
whether it rotates across records or truncates — worth a bench test before we
sell a "one gateway, whole trailer" story on a 650.

---

## 3. The open questions, answered

**Which trackers take a camera, and do FMM00A or FMM650?**

- DualCam and DashCam connect over **RS232** and the wiki names exactly three
  hosts: **FMC125, FMC225, FMC650**
  ([DualCam](https://wiki.teltonika-gps.com/view/Teltonika_DualCam),
  [DashCam](https://wiki.teltonika-gps.com/view/Teltonika_DashCam)).
- **ADAS** supports the `FMX6` generation (the 650 body, either modem letter)
  for full image/video; **FMX125 and FMX225 get ADAS IO data only — no image or
  video requests** ([ADAS](https://wiki.teltonika-gps.com/view/Teltonika_ADAS)).
  Camera serial-number gotcha there too: `9B` serials are built for
  FMX125/225, `9C` for FMX6 — order the right one.
- **FMC650 can run two cameras at once** (DSM on one RS232, DualCam/DashCam on
  the other).
- **FMM00A: no.** No serial port, no camera support anywhere in its datasheet.
- **FMM650: has the 2× RS232 hardware and is covered by the ADAS "FMX6"
  language, but the DualCam/DashCam pages name only FMC650.** Treat FMM650 +
  DualCam as **UNVERIFIED — ask Billy/Matt before buying.** My read: video over
  Cat M1 is a bandwidth problem, which is likely exactly why Teltonika lists
  the Cat 1 `FMC` variants as the camera hosts. **If we want cameras, we
  should expect to buy FMC650 (Cat 1), not FMM650.**

**Does the TAT141 really cap at ~4 BLE devices?**

**Yes — confirmed.** Its AVL ID list exposes exactly `BLE 1`, `BLE 2`, `BLE 3`,
`BLE 4` sensor channels
([TAT141 AVL ID List](https://wiki.teltonika-gps.com/view/TAT141_AVL_ID_List)),
and the configurator's BLE Feature setting offers only **None** or **Sensors**,
with each sensor entered by MAC address
([TAT141 Bluetooth settings](https://wiki.teltonika-gps.com/view/TAT141_Bluetooth_settings)).
The datasheet's supported-peripherals line is explicit: "EYE Sensors, EYE
Beacons **(recovery mode only)**, Universal Bluetooth LE sensors support."

**There is no general beacon-scanning / "detect all" mode on the TAT141.** It
is a GPS asset tracker, not a tool gateway. Same story on the TAT240. Do not
plan any tool-inheritance feature around TAT units.

**Does the FMM650 have the full FMx beacon list with "detect all"?**

**Yes.** [FMM650 Beacon List](https://wiki.teltonika-gps.com/view/FMM650_Beacon_List):
Beacon Detection = Disabled / **All** / Configured, with Simple (auto-parse
iBeacon + Eddystone) and Advanced modes, On-Change or Periodic records. The
one caveat is the **25-beacons-per-record** cap noted above, vs 100 on the
FMM00A.

**Is there a ~10-year-battery Teltonika with BLE beacon reading? Does "ATM774" exist?**

**No, and no.**

- **"ATM774" does not exist in Teltonika's catalog.** The Autonomous Trackers
  list is TAT100, TAT140, TAT141, TAT240, GH5200, ATC700, ATM700
  ([Autonomous Trackers](https://wiki.teltonika-gps.com/view/Autonomous_Trackers)),
  and it does not appear in the full nomenclature/EAN table either
  ([Nomenclature](https://wiki.teltonika-gps.com/view/Nomenclature,_classification,_identification_codes)).
  Closest real name is **ATM700**, which is nothing like the remembered spec:
  1000 mAh **rechargeable** Li-Po, USB-C, **no BLE of any kind**, aimed at
  workforce/pet tracking. Either the model number is misremembered or it's
  another vendor's product.
- **No Teltonika datasheet I could find publishes a battery-life figure at
  all.** TAT141 and TAT240 both list only the cell (2200 mAh 2S Li-SOCl2,
  7.2 V, non-rechargeable). Any "up to N years" number you see is marketing-page
  or reseller copy at an unstated report rate, and it assumes something like
  one report a day with GNSS barely fixing. Our own field note stands: at 5-min
  moving reports the TAT141 battery is not enough, and **there is no solar
  accessory** (KORE, Jul 13).
- So: **the "10-year battery + reads beacons" device does not exist in this
  catalog.** Those are contradictory requirements — beacon scanning means the
  BLE radio is awake, which is what kills the battery. If we want inside-the-
  trailer beacon scanning, it has to be on 12 V.

**Best device per situation:**

| Situation | Buy | Why |
|---|---|---|
| Heavy equipment **with** CAN/J1939 | **FMM650 + ALL-CAN300** (what we own) | Native FMS CAN, true engine hours/fuel/faults, and it's a full beacon gateway |
| Heavy equipment **without** CAN, has 12/24 V aux | FMM130 or **FMM230 (IP67)** wired to aux | Machine power solves the battery problem; full beacon scanning comes free |
| Heavy equipment, no power, low duty | **TAT141** (what we own) | GPS + theft only. Accept that it's not a tool gateway |
| **Enclosed tool trailer** | **FMM230 / FMC230 (IP67) or FMM130 wired to the trailer's 12 V**, mounted inside | Needs Detect-All beacon scanning, which only the FMx line has, which means wired power. This is the gap TAT141 cannot fill |
| Light-duty trucks | **FMM00A** (what we own) | 5-minute install, 100-beacon Detect All, OBD engine data |
| Attachments, light towers, low-use assets | TAT141 on a slow scheduler (a few reports/day) | Cheapest honest answer. Nothing in the catalog does 10-year BLE |
| Dashcam / driver-safety upsell | **FMC650 + DualCam/DSM**, or FMC125/FMC225 | Camera support is a Cat 1 (`FMC`) story — see above |

---

## 4. Recommendations for order #2

What we already own covers trucks (FMM00A), CAN machines (FMM650+ALL-CAN300),
dumb battery assets (TAT141), and tool tags (EYE Beacons). Two real gaps:

**1. The tool-trailer / yard gateway — the biggest gap.** Today a tool only
appears on the map when it's riding in a truck or next to a 650. An enclosed
trailer or a conex at the yard has no gateway, so tools go dark the moment
they're stored. Fix: **a wired IP67 FMx (FMM230, or FMM130 in a box) mounted
inside the trailer, on trailer 12 V, Beacon Detection = All.** That single SKU
turns "find my tool" from a truck-only feature into a real inventory. Buy 2–3
to prove it. **Do not try to solve this with more TAT141s** — they physically
cannot scan beacons.

**2. Non-CAN heavy equipment with aux power.** FMM650 is overkill (and priced
like it) for a machine with no J1939 to read, and TAT141 is a battery
compromise. **FMM130 or FMM230 wired to aux 12/24 V** is the right middle rung
and we don't own one. It also doubles as a jobsite beacon gateway.

**Worth ordering one of, to evaluate:**

- **FMC650 + DualCam** if Brian wants the driver-safety/video upsell — but only
  after confirming with KORE/Teltonika whether FMM650 (Cat M1) can host a
  camera at all. Cameras look like a Cat 1 product line, and switching modem
  letters means a different SIM plan.

**Do not buy:**

- Anything `FMB` (2G sunset) or `FMU` (3G, EOL).
- **ATM700 / ATC700** — no BLE, rechargeable-only. Wrong for construction.
- More TAT141s expecting them to read tool tags.

**Before order #2 goes in — confirm with Matt/Billy:**

1. FMM650 + DualCam/DashCam: supported or Cat 1 only?
2. FMM650's 25-beacons-per-record cap — does it rotate across records, or do
   beacons 26+ never report?
3. TAT141 realistic battery life at our actual schedule (2×/day) — get a number
   in writing, since the datasheet has none.
4. Repeat the pre-configuration ask (flespi profile pre-loaded) — they missed
   it on order #1.
