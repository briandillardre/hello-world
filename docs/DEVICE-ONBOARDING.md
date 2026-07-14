# Device Onboarding — Quick Checklists

*Internal doc (vendor names OK here; never user-facing). Written Jul 14 2026
from the exact steps that worked on T1-a/T1-b and the first two FeasyBeacon
pucks. Times are realistic once you've done one.*

---

## BLE tool puck — ~5 minutes each

**You need:** the puck, your phone with the FeasyBeacon app, the HammerTrack
Assets page open.

1. **Pick the next Minor number.** We use one shared UUID + Major, and the
   Minor is the tool's identity. Taken so far: `1` (Tool A), `2` (TOOL B).
   Next puck = `3`, then `4`, etc. Keep a simple list going.
2. **Configure the puck** in the FeasyBeacon app (connect → PIN `000000`):
   - Slot 1 = iBeacon with:
     - UUID: `FDA50693-A4E2-4FB1-AFCF-C6EB07647825` (factory default — leave it)
     - Major: `10065` (factory default — leave it)
     - **Minor: the next number** (this is the only field you change)
   - **Disable every other slot** (URL slot, second iBeacon slot). TLM can
     stay on. Save.
3. **Create the asset** in HammerTrack: Assets → Add Asset
   - Type: **Tool**
   - Tracker ID: `FDA50693-A4E2-4FB1-AFCF-C6EB07647825:10065:<Minor>`
     (decimal Minor, exactly this format)
   - Pick a color so its dot/trail is recognizable.
4. **Verify (within ~1 report cycle):** drop the puck in any live truck.
   Assets page shows a "with <truck>" chip on the tool, the truck shows
   "🔧 N aboard", and the map badge count goes up. Engine off = trucks
   check in ~hourly, so either start the truck or wait for the next check-in.

**Gotchas**
- Minor collisions = two tools with the same identity. Never reuse a number.
- The tracker ID must be the DECIMAL Minor (`…:10065:3`), matching what the
  FeasyBeacon app shows — the ingest also tolerates hex, but stay consistent.
- Later hardening (batch job, not per-puck): change the `000000` PIN.

---

## OBD truck unit (T1 / FMM00A) — ~15 minutes

**You need:** the unit, an activated SIM, the truck, Hologram (or KORE)
dashboard, flespi Toolbox open.

1. **Connect the internal battery** — units ship with it UNPLUGGED. Open the
   case, click the battery plug in, close the case fully (it won't power on
   open).
2. **Activate the SIM** in the Hologram dashboard (Devices → Activate SIM,
   pilot plan). Note the SIM number so you can find it for SMS later.
   *(KORE SIMs when we switch: Felix's team activates; same idea.)*
3. **Insert SIM, plug into the OBD port.** Ignition on for a few minutes so
   it wakes and registers.
4. **Configure via SMS** from the SIM's page in the Hologram dashboard
   (Send SMS). Every command starts with **two leading spaces** (empty
   login/password):
   - APN: `  setparam 2001:hologram`
   - Server: `  setparam 2004:ch1401177.flespi.gw;2005:24397;2006:0`
   - Beacons + records: `  setparam 113:1;800:2;1115:1;134:1;136:1`
   The device replies "New value …" — check the SIM's message log (Events)
   for the confirmation. USB + Teltonika Configurator works too, but SMS is
   the preferred path (no cables, works after install).
5. **Watch it appear in flespi** Toolbox on channel `1401177` — ident = the
   unit's 15-digit IMEI. First messages usually arrive within a minute of a
   drive-off or ignition cycle.
6. **Create the asset** in HammerTrack: Assets → Add Asset
   - Type: **Vehicle**
   - Tracker ID: the **full 15-digit IMEI** (from the device label)
   - Make/model/color as desired (VIN typeahead fills details).
7. **Verify:** /diag shows the asset with a fresh location and (once a puck
   rides along) a teal `ble` count; the dot is on the map at the truck's
   real spot.

**Gotchas**
- No traffic for an hour with the engine off is NORMAL (sleep + hourly
  check-in). Judge health by ignition-on behavior.
- SMS appears to "do nothing"? Check the Hologram Events log for the reply —
  both pilot units confirmed there, minutes later.
- The webhook/channel side is DONE (channel 1401177 → webhook #16402 →
  /api/ingest/flespi). New units need zero server work — just the steps above.

---

## Equipment battery unit (T2 / TAT141) — when they arrive

Same shape as OBD minus the OBD port: battery in, SIM in, SMS config with the
same server params, magnet/bolt mount, asset type **Equipment**, tracker ID =
IMEI. At 5-min moving reports, battery alone won't last — wire to aux 12/24V
where the machine has it (no solar accessory exists per KORE Jul 13).
