# Setting up your trackers — the customer how-to

*Written Sep 9 2026 for a second company going live from a box of devices,
with no one from HammerTrack in the room. Plain language on purpose: this is
the page we send an owner, and the same words the in-app guides use
(Help → Truck unit · Battery GPS unit · Tool tags). Staff note: "truck unit"
= FMM00A, "battery GPS unit" = TAT141, "tool tag" = Eye Beacon; model numbers
stay out of the customer's view.*

---

## The one idea

**Trackers first, machines second.** Every box is added to the app as a
tracker by scanning its label, then put on a machine with one more tap. You
never type a serial number into a truck's form, and you never have to decide
what a box is for before you scan it.

```
Trackers  →  Add trackers  (scan the label)  →  Put on a machine
```

That is the whole setup, for every kind of device. Where to find it:
**More → Trackers** on the phone, **Setup → Trackers** on a computer, or tap
your company name at the top of the map.

Do **one unit first**, watch it appear on the map, then do the rest.

---

## Truck unit — plugs into the OBD port (about 5 minutes)

**What it is:** a small box that plugs into the diagnostic port every truck
has. It reports the truck's position every few seconds while driving and
hears any tool tags nearby.

1. **Add the tracker.** Trackers → **Add trackers** → point the camera at the
   barcode on the unit's label (the 15-digit IMEI), or type it. It lands in
   the **Unassigned drawer**. Scanning a whole box of units now is fine.
2. **Plug it in.** The OBD port is under the dash on the driver's side,
   usually just left of the steering column. Push the unit in until it seats.
   No tools, no wiring, nothing to pair.
3. **Start the truck.** The unit's light comes on while it finds the network.
4. **Put it on the truck.** Back on Trackers, tap **Put on a machine** on
   that unit's row. Pick a truck you already added, or name a new one right
   there. Change the type, map icon and rates later from the truck's page.

**What to expect**

- Ignition on = live. The first dot usually shows within a few minutes of
  the first drive.
- Engine off = asleep. It checks in about once an hour so it never drains
  the truck's battery. An hour of silence from a parked truck is normal.
- Nothing for several hours *while the truck is being driven*: email
  support@hammertrack.ai with the last four digits of the IMEI.
- Anything the unit reported while it sat in the drawer comes along when
  you put it on the truck, so plug-in-first or assign-first both work.

---

## Battery GPS unit — machines, trailers, anything without a port (about 10 minutes)

**What it is:** a sealed, battery-powered GPS box for equipment. No wiring.
Reports on a schedule instead of second-by-second, so the battery lasts.

1. **Add the tracker.** Trackers → **Add trackers** → scan or type the
   15-digit IMEI on the label.
2. **Turn it on. This is the step everyone misses.** Open the case; there is
   a small ON/OFF switch inside. Flip it to ON and close the case. Watch the
   light: solid for a moment, then a **blink every 5 seconds**. That blink
   means it is alive. No blink = still off. The battery ships connected, so
   the switch is the only thing between you and a working unit.
3. **Mount it** with a view of the sky: top of the cab, the dash, a
   battery-box lid, high on the frame, the trailer tongue. Not under a steel
   plate. Out of the pressure-washer line and out of easy sight. Screws,
   heavy zip ties or the adhesive pad. Rain and mud are fine.
4. **Put it on the machine.** Trackers → **Put on a machine** on the unit's
   row. Pick an existing machine or name a new one.

**What to expect**

- First position within about an hour outdoors. After that: often while
  moving, rarely while parked.
- A unit that never shows up almost always has the switch still OFF. Check
  that before anything else.
- Machines that live outside and move daily use more battery. Ask about the
  solar cap or wiring the unit to the machine's 12 V.

---

## Tool tag — small tools, attachments, trailers (about 2 minutes)

**What it is:** a coin-sized Bluetooth beacon. No GPS, no SIM, no charging.
Your truck and machine units **hear** it within about 100 feet, and the tag's
location becomes that truck's location. That is why the truck units go in
first: no truck nearby, no report.

Good for: a trailer that follows a truck, an attachment that rides in the
bed, a generator or compressor that gets loaded and unloaded. Not for a
machine that sits alone on a site for weeks; give that one a battery GPS
unit.

1. **Add the tag.** Trackers → **Add trackers** → type the **12-character
   code** printed on the tag (letters and numbers, like `7CD9F408B572`;
   colons or spaces don't matter). It lands in the drawer as a tool tag.
2. **Stick it on.** Zip tie, screw or adhesive pad, anywhere on the tool.
   There is no antenna to aim. Nothing to switch on, no app, no PIN; it is
   already broadcasting.
3. **Put it on the tool.** Trackers → **Put on a machine** on the tag's row
   and name the tool ("Load Trail dump trailer", "Plate compactor").

**What to expect**

- The drawer row says **heard by** and which truck as soon as any of your
  units picks the tag up. Silent tag? Park a tracked truck next to it and
  give it a minute.
- The battery lasts years. When one dies you will see it stop being heard
  while the truck beside it keeps reporting. Swap the tag and put the new
  code on the tool with **Reassign tracker**.

---

## Moving a box to another machine

Don't edit the Tracker ID on a machine's page; that would hand one truck's
history to another. Open the machine → **Reassign tracker** and pick what
happened (put on, swap, take out, move, renamed onto a new machine), with the
time it happened. History is cut at that moment so each machine keeps its
own. Every change shows on Trackers → **Recent changes** with **Undo** for
30 days. Deleting a machine is also a 30-day thing: Trackers → **Recently
deleted** brings it back whole.

---

## If it isn't working

| You see | Do this |
|---|---|
| Truck unit never appears | Truck driven since plugging in? Wait for the first drive. Then re-seat the unit; some trucks' ports are recessed. |
| Battery unit never appears | Open the case: is the switch ON and the light blinking every 5 s? Then carry it outdoors for an hour. |
| Tool tag "not heard by a truck yet" | Park a truck with a unit within 100 ft for a minute. Check the code you typed against the tag. |
| "Already on a machine" when adding | It was scanned before; the row says which machine. Nothing to redo. |
| "Registered to another account" | The number belongs to a different company's box. Check the label against what you were shipped and email support. |
| Truck shows the wrong history after a swap | Trackers → Recent changes → Undo, then redo it with the right time. |

Support: support@hammertrack.ai. Send the last four digits of the tracker
and the machine's name; that is all we need.

---

## Staff: what runs underneath

- `registerTrackerAction` (`lib/actions/trackers.ts`) parses the label
  (`parseTrackerId` in `lib/devices.ts`: 15-digit + Luhn = IMEI, model from
  the TAC; 12 hex = tool-tag MAC) and upserts `device_onboarding`. Already
  worn → says which machine, no phantom drawer row.
- `putOnAction` creates the asset if named new (`metadata.source =
  trackers-put-on`, type from the model's default) then runs the same
  `changeTracker` attach the machine page uses, "as of now" — buffered
  drawer pings and back-dated pings from the previous holder come along
  (092/097). Every step is a `tracker_moves` row with Undo.
- Tool tags: ingest matches the bare MAC (factory-mode tags report as
  `00000000-0000-0000-0000-<MAC>`); the drawer's "heard by" is the newest
  `asset_locations.raw.ble.beacons` hit in 24 h.
- The camera reads any barcode the label carries (`components/trackers/
  Scanner.tsx`, native BarcodeDetector; typed fallback everywhere).
- Vendor side (SIM activation, config push) is ours before the box ships:
  `docs/DEVICE-ONBOARDING.md`. A customer never sees it.
