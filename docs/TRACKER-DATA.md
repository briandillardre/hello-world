# T1 (OBD Truck Unit) — Data Reference & Reporting Design

What the T1 tracker (Teltonika FMM00A, OBD-II plug-in, Cat-M1) can report, how
often it reports in each state, and how much of that should be admin-editable
per asset. Written against the live pilot (T1-a in the Chevy 1500) and the
behavior observed Jul 6 2026.

**Where the data lands:** every field the device sends arrives at
`/api/ingest/flespi`. Position/speed/heading/battery go into dedicated
`asset_locations` columns; since Jul 7 2026 **everything else is persisted
verbatim in `asset_locations.raw`** (it was previously discarded), so all of
the catalog below is queryable:

```sql
select "timestamp", raw from asset_locations
where raw->>'source' = 'flespi' order by "timestamp" desc limit 3;
```

---

## 1. Full data catalog

Field names are flespi's normalized names (what you'll see in `raw`).
OBD-II values depend on what the vehicle's ECU serves — verify per truck in
Teltonika Configurator → Status → OBD (the Chevy 1500 list may differ from a
Ford or a work van).

### Position & GNSS
| Field | Meaning |
|---|---|
| `position.latitude` / `.longitude` | GPS fix (→ `lat`/`lng` columns) |
| `position.altitude` | meters |
| `position.speed` | km/h from GNSS (→ `speed`) |
| `position.direction` | heading 0-360° (→ `heading`) |
| `position.satellites`, `position.hdop`/`pdop` | fix quality |

### Motion & driving behavior (internal accelerometer)
| Field | Meaning |
|---|---|
| `movement.status` | moving / still (this is what wakes the device) |
| `x.acceleration` / `y` / `z` | raw axes (crash/eco calculations) |
| Green-driving events | harsh acceleration, harsh braking, harsh cornering |
| Crash detection | event + optional high-rate accelerometer trace |
| Towing detection | movement with ignition off — **the theft signal** |
| Excessive idling | ignition on, no movement for N minutes |
| Over-speeding | speed above configured limit |

### Power & tamper
| Field | Meaning |
|---|---|
| `external.powersource.voltage` | vehicle battery via OBD port (~12.6 V engine off, ~14 V running — cheap "engine running" proxy and a dead-battery early warning) |
| `battery.voltage` / `battery.level` | internal backup battery (→ `battery`) |
| Unplug event | device pulled from OBD port — **tamper alert**, fires on backup battery |
| `sleep.mode.status` | which sleep state it's in |
| Jamming detection | GSM jamming event |

### Engine / OBD-II PIDs (polled from the ECU)
| Field | Meaning | Notes |
|---|---|---|
| `engine.ignition.status` | ignition on/off | derived from voltage + RPM + accelerometer |
| `obd.rpm` / `can.engine.rpm` | engine RPM | idle vs working vs off |
| `obd.speed` | wheel speed per ECU | cross-check vs GNSS |
| `engine.coolant.temperature` | °C | overheat alerts |
| `engine.load.level` | % | utilization quality |
| `throttle.position` | % | |
| `fuel.level` | % | many pickups serve this; some don't |
| `engine.runtime` / run time since start | s | |
| `vehicle.mileage` / distance since DTC clear | | ECU-side distance |
| `engine.oil.temperature` | °C | vehicle-dependent |
| `intake.air.temperature`, MAF, MAP, barometric | | diagnostics |
| `vehicle.vin` | VIN | auto-fill the asset's Serial/VIN field |
| `faults.count` + DTC codes list | check-engine codes | maintenance gold |
| MIL status | check-engine lamp on/off | |

### Derived & trip
| Field | Meaning |
|---|---|
| `vehicle.mileage` (GNSS total odometer) | lifetime distance the tracker has seen |
| Trip odometer / trip start-stop events | per-trip distance |

### Connectivity & BLE
| Field | Meaning |
|---|---|
| `gsm.signal.level`, operator, cell id | connectivity diagnostics |
| `ble.beacons[]` (id/mac/rssi) | **BC021 tool tags** — feeds tool_associations (already wired) |
| BLE sensor values | Teltonika EYE-style temp/humidity sensors (future) |

> **Not available on T1:** J1939 heavy-equipment CAN (true engine hours on
> excavators etc.) — that's the Phase-2 CAN reader note in CLAUDE.md.

---

## 2. Reporting states & frequencies

The device runs two acquisition profiles (**On Moving** / **On Stop**) plus
sleep. A record is generated when ANY trigger fires: min-period elapsed,
min-distance driven, or min-angle turned. Events (crash, unplug, tow…) always
send immediately.

| State | What the device does | Typical default | Observed on T1-a (Jul 6) | Recommended setting |
|---|---|---|---|---|
| **Moving, ignition on** | full tracking | record: 30–60 s OR 100–200 m OR 10° turn; send every 60–120 s | records every 1–10 s during the drive | 60 s / 200 m / 15° — plenty for trucks, keeps data ~2–4 MB/mo |
| **Stopped, ignition on** (idling) | slow records, idling timer runs | record every 300 s | — | 300 s + idling event at 10 min (fuel waste report) |
| **Ignition off, parked** | On-Stop profile then sleep | record every 1 h | connected ~hourly (17:49, 18:47, 19:47…), 5-min sessions | keep 1 h keepalive |
| **Sleep (GPS sleep / deep sleep)** | GNSS off; modem per mode | enters after ~5–30 min still | yes — silent between check-ins | GPS Sleep (keeps BLE scanning for tool tags; deep sleep would stop seeing them) |
| **Woken by accelerometer, ignition off** | towing/movement alarm | immediate event + tracking | — | **ON — this is the 2 AM theft alert** |
| **Unplugged from OBD** | tamper event on backup battery | immediate | — | ON, alert to owner |
| **Crash / harsh driving** | immediate event | on | — | ON (crash), eco-driving optional |

**Data budget check (Hologram, pay-as-you-go):** a Codec 8E record with a
dozen IO elements ≈ 150 bytes + overhead. At the recommended profile, a truck
driving 3 h/day ≈ 180 records + hourly keepalives ≈ **2–4 MB/month** — inside
the ~$1–2/SIM/month expectation. The pilot's current every-few-seconds moving
rate is great for demos; at fleet scale it's ~10× that budget, which is the
main reason reporting profiles matter.

> Frequencies are set in Teltonika Configurator (System → Data Acquisition;
> Sleep; Accelerometer features). Current pilot values weren't recorded — read
> them off T1-b in the Configurator before installing it, and note them here.

---

## 3. Admin editability — design for the asset page

**Principle: admins pick intent, not Teltonika parameters.** Raw configurator
values (4 profiles × 6 numbers + sleep modes) are a support burden and a
foot-gun (a 1-second period = 10× the data bill). Expose named profiles.

### Phase 0 — read-only telemetry (build next)
On `/assets/[id]`, a **Live telemetry** card reading the newest
`asset_locations.raw`: ignition, vehicle battery voltage, RPM, coolant temp,
fuel level, DTC count (red if >0), GSM signal, last report age, plus reporting
state ("moving / parked / sleeping"). No editing — pure visibility. All data
for this is already being persisted as of today.

### Phase 1 — per-asset "Tracking profile" (admin-only dropdown)
Stored as `assets.metadata.tracking_profile`; visible to all, editable when
`profiles.role = 'admin'`:

| Profile | Moving | Parked | Sleep | Eco events | Est. data |
|---|---|---|---|---|---|
| **Standard** (default) | 60 s / 200 m | 1 h | GPS sleep | off | ~2–4 MB/mo |
| **High detail** | 15 s / 50 m | 30 min | GPS sleep | on | ~10–15 MB/mo |
| **Battery saver** | 5 min / 500 m | 6 h | deep sleep | off | <1 MB/mo |
| **Security watch** | 30 s | 15 min | none (online) | off | ~20 MB/mo — jobsite theft-watch mode, days not months |

Show the est. data cost next to the picker. Theft triggers (towing, unplug)
stay ON in every profile — not editable, they're the product.

### Phase 2 — closing the loop to the device
The dropdown is "desired state" until pushed to hardware. Options, in order of
effort: (a) apply manually in Configurator during install (fine at pilot
scale, ~10 trucks); (b) register devices in flespi's gateway (not just the
channel) and push SMS/GPRS commands via flespi API; (c) Teltonika FOTA WEB
bulk profiles. Build (b) when profile changes need to happen without touching
trucks. Until then the asset page shows profile + "applied: yes/manual".

### What stays fleet-level (NOT per asset)
- Work hours / work days (companies table — drives after-hours theft alerts)
- Geofences + alert rules (already per-rule)
- Webhook/token/channel plumbing (owner-only, not in the UI)
