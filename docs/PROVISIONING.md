# Provisioning Playbook — Customer #N Hardware Day

The zero-touch story: hardware arrives pre-configured, the customer creates
assets, plugs units in, and everything walks onto the map on first report.
This checklist is what makes that true. Work it top to bottom for every
hardware batch — customer #2 and beyond, and our own reorders.

## The one rule that prevents 90% of "it's not working" calls

> **Create the asset (with the tracker's FULL IMEI as its Tracker ID) BEFORE
> the unit powers on.** Ingest drops reports from unknown tracker_ids — a
> device that reports before its asset exists looks dead even though the
> pipeline is fine. The asset row uses the full 15-digit IMEI
> (e.g. `868996068800000`), not the suffix.

## Phase 0 — Before the order ships (our side)

- [ ] Supply KORE the flespi config profile so devices arrive pre-configured
      (Matt confirmed KORE pre-configures: SIMs enabled + tested, connectivity
      verified, plug-and-play):
  - Server: `ch1401177.flespi.gw:24397` (TCP)
  - Protocol: **Codec 8 Extended**
  - APN: per SIM — see the SuperSIM caveat below
- [ ] **SuperSIM APN caveat:** KORE SuperSIM settings are NOT the same as
      Hologram (`hologram`, no user/pass, roaming on — that's the pilot
      config only). Confirm the SuperSIM APN/config with KORE (Matt) BEFORE
      configuring or shipping units on SuperSIMs. A wrong APN looks exactly
      like a dead device.
- [ ] Record each unit in the batch sheet: unit name (T-convention), full
      IMEI, SIM ICCID, target customer.
      Naming: **T1 = OBD truck unit, T2 = equipment unit, T3 = tool tag.**
      Model numbers stay out of customer-facing dashboards and marketing.

## Phase 1 — One-unit pipeline test FIRST

Never install a whole batch blind. Prove one unit end-to-end, then the rest
is repetition:

- [ ] Create a test asset with the first unit's full IMEI.
- [ ] Power the unit (bench or one truck) and watch the chain:
      device → carrier → flespi channel traffic → webhook delivery →
      asset's location updates on the map.
- [ ] No flespi traffic at all? Check SIM state and APN before blaming the
      device. Traffic in flespi but nothing on the map? Check the webhook
      (topic must be `flespi/message/gw/channels/<id>/+` — a literal
      `.../message` suffix silently matches nothing — and verify the Enabled
      toggle actually saved) and that the asset's tracker_id is the full IMEI.
- [ ] Only after the first unit is live on the map: proceed with the batch.

## Phase 2 — Truck units (OBD, T1)

- [ ] Assets created with IMEIs (see the one rule).
- [ ] **FMM00A gotcha: the internal battery ships DISCONNECTED.** Open the
      case, click the battery plug in, close the case fully — the case is the
      OBD plug housing and won't power the unit while open.
- [ ] Plug into the OBD2 port. Drive or idle the engine to force an active
      report.
- [ ] Know the sleep behavior before declaring a unit dead: engine off =
      device sleeps and checks in roughly hourly; ignition on = active
      tracking (reports every few seconds when moving). **Zero traffic for an
      hour with the engine off is normal, not a fault.**

## Phase 3 — Equipment units (GPS, T2)

- [ ] Assets created with IMEIs first.
- [ ] **Power reality:** at active tracking rates the battery alone is NOT
      sufficient for equipment that works daily. For machines left outside,
      plan the solar accessory; on machines with 12V/24V aux power, wire the
      unit in. Battery-only is fine for slow check-in duty (yard storage,
      trailers), not for utilization tracking.
- [ ] Mount high and sky-facing where practical (GPS + cellular both suffer
      inside engine bays).

## Phase 4 — Tool tags (BLE, T3)

- [ ] Create each tool as an asset with the tag's beacon ID.
- [ ] Tools have no GPS — they inherit the location of whichever truck or
      machine (BLE gateway) last saw them. Confirm the gateway units (trucks'
      OBD devices) are live BEFORE expecting tools on the map.
- [ ] Walk-test: carry a tagged tool to a live truck, confirm the tool's
      location snaps to the truck.

## Phase 5 — Direct-API integrations (no HammerTrack hardware)

For customers pushing their own data (existing dongles, phone apps,
third-party trackers):

- [ ] Their credential is the **per-company API key** — Settings → Tracker
      API Key (admins only). Sent as the `x-api-key` header to
      `POST /api/ingest/obd2` (vehicles) or `POST /api/ingest/location`
      (GPS/BLE relays). Every push is scoped to that company's assets — a
      tracker_id belonging to another company 404s.
- [ ] Same one rule applies: the asset with the matching tracker_id must
      exist before the first POST.
- [ ] Key compromised or employee left? Admins rotate it from the same
      Settings card — the old key dies instantly; update integrations with
      the new one. Shipped HammerTrack trackers ride the flespi pipeline and
      are unaffected by rotation.
- [ ] Never hand out the platform `INGEST_API_KEY` or any Supabase key to a
      customer. Ever.

## RMA / swapping a failed unit

- [ ] Don't delete the asset. Edit the asset and replace its Tracker ID with
      the replacement unit's full IMEI. **Location history stays** — it's
      keyed to the asset, not the tracker.
- [ ] Update the batch sheet (old IMEI → RMA, new IMEI → asset).
- [ ] The old unit's SIM gets deactivated with the carrier once the swap is
      confirmed reporting.

## Handoff done when

- Every unit in the batch has reported at least once on the customer's map.
- The customer has seen one asset move (drive a truck around the block).
- Alert phone is set (Settings → Company) so the 2 AM theft text has
  somewhere to go.
