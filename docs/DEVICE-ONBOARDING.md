# Device Onboarding — Quick Checklists

*Internal doc (vendor names OK here; never user-facing). Written Jul 14 2026
from the exact steps that worked on T1-a/T1-b and the first two FeasyBeacon
pucks. Times are realistic once you've done one.*

---

## App side is now ONE SCAN — or one paste (Aug 28)

**Assets → Scan trackers** (`/assets/scan`): point the phone at the IMEI
barcode on the Teltonika box (or type the 15 digits), pick Truck/Machine,
done — the asset exists with a placeholder name and its dot appears on the
map at the device's first report. Rename + icon + rates later on the edit
form. Re-scanning a box is harmless (it answers "already added").

**Assets → Bulk add** (`/assets/import`) is the other door: paste a fleet
list straight out of Excel/Sheets (or upload a CSV). Column headings are
matched by name so the sheet's own layout is fine, type + map icon are
inferred from each machine's name, and IMEIs are Luhn-checked and
duplicate-checked against the existing fleet before anything is written.
Use it for a whole existing fleet — an insurance schedule, an equipment
list, another system's export — and scan for boxes actually in hand.
Everything
below this line is the VENDOR side (SIM activation + config push) — that's
where the remaining per-device minutes live, and the Aug 28 supply plan
(buffer stock + Hologram-first SIMs + KORE pre-config on order #2) is how
they shrink.

---

## BLE tool puck — ~5 minutes each

**You need:** the puck, your phone with the FeasyBeacon app, the HammerTrack
Assets page open.

1. **Pick the next Minor number.** We use one shared UUID + Major, and the
   Minor is the tool's identity. Taken so far: `1` (Tool A), `2` (TOOL B);
   `3`–`5` reserved for the Aug 4 batch (2 large pucks = 3 & 4, small = 5).
   Next new puck = `6`. Keep this list current.
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
   - Server: `  setparam 2004:<channel-host>;2005:<port>;2006:0   (host + port from the flespi channel page)`
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

*(For the KORE/SuperSIM batch, the SMS path above does NOT apply — use the
FOTA WEB flow below with a TAT141 template config instead.)*

---

## KORE SuperSIM batch (Aug 2026 order) — the NO-CABLE playbook

*Proven end-to-end on the first FMM00A (IMEI …048569) Aug 26 2026: SIM
activated ~1:45 AM, config task queued ~2:45 AM, device picked it up on its
own FOTA sync at 07:38 and connected. Nothing was plugged into a computer.
The Hologram sections above are for the two July pilot units only.*

**The three facts that make this batch different from the pilots:**
- APN is **`super`** — printed right on the SuperSIM card ("SET DEVICE APN
  TO: super"). Not `hologram`.
- All order-#1 devices came **pre-registered in FOTA WEB**
  (fota.teltonika.lt, login brian@hammertrack.ai, 2FA) — config is pushed
  over the air from there. No USB, no Configurator-to-device connection.
- KORE One's Send SMS diagnostic **does not work for SuperSIM**
  ("Subscription service type is not supported"). SuperSIM SMS commands are
  API-only (SMSCommand resource; sender shows as 000, retries 24 h). Don't
  burn time hunting a console SMS button.

**Per-device checklist (~10 min, from a desk):**

1. **Activate the SIM** — connect-app.korewireless.com → Subscriptions →
   find the ICCID (matches the card) → Activate:
   - Data plan: **Super SIM 25MB US Pooled** (revisit sizing once real
     usage data exists) · SMS plan: Pay Per Use
   - Feature: **CHECK "Super SIM Standard APNs"** (enables the `super` APN;
     KORE One Connect Service is mandatory/grayed)
   - Skip Rules → Confirm. State flips to Active.
2. **Config file** (once per model+firmware, then reused): Teltonika
   Configurator OFFLINE — pick the template matching the device's firmware
   shown in FOTA (FW 04.01.00 → "Configuration 13.0.0.0" template; do NOT
   use a newer template than the firmware):
   - **GPRS:** APN `super`, no user/pass · Domain `<channel-host>` (flespi channel page),
     Port `24397`, TCP, TLS None · leave FOTA WEB block ENABLED
     (fm.teltonika.lt:5000 — that's the management lifeline)
   - **System:** Data Protocol = Codec 8 Extended
   - **Bluetooth:** BT Radio = Enable (hidden) — never "visible"
   - **Bluetooth 4.0:** Non Stop Scan = Enable
   - **Beacon List:** Beacon Detection = All (EYE panel stays Disabled)
   - Never set a Security keyword. Save to file
     (`hammertrack-<model>-fw<ver>.cfg`).
3. **Push via FOTA WEB** — Files → Upload the .cfg (one time), then
   Devices → tick the ONE target IMEI → Create task → task type
   **"Upload configuration"** → pick the file from the dropdown.
   GOTCHA: the dialog's "From file" tab is a CSV-of-devices selector, not
   the config upload — stay on "Selected".
4. **Wait — or force it.** The device syncs FOTA on power-up and every
   720 min. GOTCHAS learned the hard way:
   - A 10-second OBD unplug does NOT reboot it — the internal battery
     rides through (same mechanism as theft detection).
   - Ignition-on does NOT trigger a FOTA sync either.
   - So: install it and let the timer work (overnight queue → applied by
     morning), or truly power it down (battery would have to be
     disconnected) to force a boot sync.
5. **Verify:** FOTA row shows the .cfg name in Configuration + fresh
   "Seen at" → flespi Toolbox channel 1401177 shows the IMEI → create the
   asset in HammerTrack (Vehicle/Equipment, Tracker ID = full IMEI). The
   webhook side needs zero work — any IMEI on the channel flows through.

**SIM card ↔ device pairing tip:** log which ICCID went into which IMEI at
insertion time (photo of card next to device label works) — the packing
slip lists IMEIs, the cards carry ICCIDs, and matching them after the fact
is guesswork.

---

### Per-model physical gotchas (Aug 28 2026 — learned the hard way on order #1)

Every model in order #1 powers up differently. Getting this wrong produces
a device that looks like a config or SIM failure and isn't.

| Model | SIM size | Ships how | To power it on |
|---|---|---|---|
| FMM00A | mini (2FF) | **battery DISCONNECTED**, no switch | plug the battery in, close the case fully, then OBD port |
| TAT141 | **micro (3FF)** | **battery CONNECTED, switch OFF** | **flip the internal ON/OFF switch to ON** |
| FMM650 | mini (2FF) | cover loose, screws bagged, battery unplugged | SIM first, then battery, then 8–32 V through the harness |

**TAT141 — the switch is the whole trick.** Six units read Inactive in FOTA
for hours because the covers went back on without it being flipped. Quick
Manual v1.8 p.4 step 3: "Flip the switch to ON." Confirm with the status
LED (p.11): solid = self-test, **blink every 5 s = working, modem on**,
dark = asleep or off. Default stationary reporting is **28,800 s (8 h)**,
so a switched-on unit on a shelf is *supposed* to go quiet after its first
check-in — judge by FOTA, not by chatter.

**FMM650 — four things:**
- Cover ships loose with the screws bagged, so there is nothing to pry.
  4 screws, counterclockwise, on the bottom.
- **A blank white dummy card sits in the SIM holder.** It is not a SIM and
  not a pre-installed subscription — pull it. The holder is a **stacked
  dual-deck**: slot 1 is the LOWER deck, closer to the PCB, and that is the
  one the config uses. A card in slot 2 registers on nothing.
- **Insert the SIM with the battery disconnected** (manual: "external
  voltage and internal battery disconnected"), then connect the battery.
  Backwards risks a damaged or undetected card.
- **External antennas, and they are not interchangeable.** The **square**
  ceramic puck is GNSS; the **long flat strip** is cellular. Port labels are
  on the case faces, not the connector edge — antenna cables may carry their
  own "GSM" label, which identifies the *antenna*, not the socket it is in.
  Finger-tight plus a nip; never pliers.
- It is wired-only for provisioning: the 550 mAh cell is backup, not a power
  source, so it will not self-configure on a bench without 12 V. Easiest
  source is any truck's accessory socket — and if the engine is running, the
  alternator's ~14 V clears the 13,200 mV ignition threshold, so you verify
  ignition detection and active tracking in the same test.

**"Pending" in the FOTA queue is normal.** A task can only apply when the
device checks in, so every never-connected unit sits Pending by design.
Queue the config BEFORE first power-up — the device syncs FOTA on boot, and
that is the fast path (otherwise you wait out the 720-minute timer).

**BLE Eye Beacons default to Eddystone, not iBeacon.** Our tool convention
is iBeacon `UUID:MAJOR:MINOR`, so each beacon must be switched to iBeacon in
the Teltonika EYE app (default PIN `123456`, Advanced settings) before its
tool asset will ever match. They may also ship in Hibernate mode — woken
with a magnet.

---

## One unit stays dark while its siblings came up

*Aug 28 2026: five of six OBD units went Online in FOTA within minutes of
being plugged in and cycled; …4585 stayed Inactive / Pending with no
firmware reported (= FOTA had never spoken to it) — **and then came up on
its own a few hours later, with nothing done to it.***

**So: give it the timer before you touch it.** A device syncs FOTA on
power-up and every 720 minutes. A unit that didn't get a clean power cycle
(the FMM00A's internal battery rides through a short unplug) simply waits
out that window. Check the cheap things below, then let it sit overnight —
tearing into hardware on hour two is how you break a working unit.

Same batch, same config, same trucks — so the cause is device-specific, not
setup. Rule out the per-model power-up gotchas above FIRST (a TAT141 with
its switch off looks exactly like this), then work it in this order; the
swap test is the one that actually splits the problem.

0. **Is there a SIM in it at all?** Order #1 shipped **14 devices and 13
   SuperSIMs** (docs/HARDWARE-PRICING.md) — one unit is SIM-less by
   arithmetic, and with no ICCID↔IMEI log the odd one out is whichever
   device nobody got to. Pop the tray before anything else; it's a 30-second
   check that beats every step below.
1. **The SIM's APN feature.** KORE One → the ICCID paired with that IMEI →
   confirm the subscription is **Active** AND that **"Super SIM Standard
   APNs" is checked**. A SIM activated without that feature attaches to the
   carrier and is then refused on the `super` APN — the device looks alive
   from the truck and never reaches FOTA. Easiest single-device miss in the
   whole activation flow.
2. **Session history on that ICCID.** Zero data sessions EVER → SIM or
   network side (step 1, or seating, or coverage). Sessions present but FOTA
   still Inactive → it's reaching the network but not our server; recheck
   the device's APN/domain config.
3. **Swap test — 2 minutes, definitive.** Move the dark unit into a truck
   whose device is Online, and that Online device into the dark unit's
   truck.
   - Dark unit comes up in the good truck → the original truck's **OBD port
     has no power**. Check that fuse (frequently shared with the accessory /
     cigarette-lighter circuit) before blaming the device.
   - Dark unit stays dark AND the known-good unit works in that truck →
     it's the device or its SIM. **Now swap just the SIMs between the two
     devices** — that splits device-vs-SIM in one more move.
4. **Physical seating.** The SuperSIM triple-punch can pop loose in the
   tray (2FF frame separating from the 3FF); reseat and confirm
   orientation. Then confirm the FMM00A case is fully clicked shut — the
   case IS the OBD plug housing, so a partly-open case means the pins never
   seat. While it's open, confirm the internal battery plug is connected
   (ships disconnected — see the per-model table above).
5. **Coverage.** Cat-M1 inside a steel shop building is a real failure
   mode. Drive it out and cycle the ignition before condemning anything.

If it survives all five, it's a warranty/RMA conversation with Teltonika
via KORE (Matt Ferrans), not more field time.
