/**
 * Hardware onboarding knowledge base.
 *
 * Written Aug 28 2026 from the evening it took to bring up KORE order #1
 * (Brian: "this process should be much simpler..."). Every fact here was a
 * dead device first. The point of the file is that the NEXT person — a
 * Founding-25 customer, or Brian six months from now — is told the gotcha at
 * the moment it would bite instead of finding it in a PDF afterwards.
 *
 * The through-line of that evening: every distinct failure looked identical
 * from the outside. An unactivated SIM, a SIM in the wrong deck of a stacked
 * holder, an un-flipped TAT141 switch, swapped antennas, and a beacon still
 * broadcasting Eddystone ALL present as "the device doesn't show up." So each
 * step below carries the symptom it produces when skipped — that's what turns
 * a checklist into a diagnosis.
 *
 * Pure data + pure functions. No DB, no network — safe to import anywhere.
 */

export type DeviceModel = 'FMM00A' | 'TAT141' | 'FMM650' | 'EYE_BEACON' | 'OTHER'

/** Manual step: something a human does in the physical world or a vendor
 *  console, which we cannot observe from our own servers. */
export interface PrepStep {
  key: string
  label: string
  /** What to actually do. */
  detail: string
  /** What you'll see if this step is skipped. The diagnostic half. */
  ifSkipped?: string
  /** Marks the steps that actually cost us time — rendered as warnings. */
  gotcha?: boolean
}

export interface ModelSpec {
  model: DeviceModel
  /** What it says on the box. */
  name: string
  /** One line: what this thing is for. */
  role: string
  /** Default asset type when registering it. */
  assetType: 'vehicle' | 'equipment' | 'tool'
  /** SIM form factor — differs across models in the SAME order, which is a
   *  trap when you punch a triple-punch card down to the wrong size. */
  sim: string | null
  power: string
  /** Realistic time to first contact, so a quiet device isn't misread. */
  firstContact: string
  /** Does it scan BLE beacons (i.e. can tools inherit its location)? */
  gateway: boolean
  /** Beacons reportable per record, when it is a gateway. */
  beaconCap: number | null
  prep: PrepStep[]
}

/** Steps every cellular device shares: the vendor consoles we can't see into.
 *  These are the two that stopped the Aug 28 batch cold. */
const SIM_STEPS: PrepStep[] = [
  {
    key: 'sim_active',
    label: 'SIM activated with the data APN feature',
    detail:
      'KORE One → Subscriptions → the ICCID → Activate. Super SIM 25MB US Pooled + SMS Pay Per Use, and CHECK "Super SIM Standard APNs".',
    ifSkipped:
      'Device powers up and blinks normally forever, and never appears anywhere. Twelve units sat dark for hours on Aug 28 for exactly this.',
    gotcha: true,
  },
  {
    key: 'config_queued',
    label: 'Config task queued in FOTA for THIS IMEI',
    detail:
      'FOTA WEB → Devices → tick the IMEI → Create task → Upload configuration → pick the file matching this model AND its firmware.',
    ifSkipped:
      'Device connects to the network but never reaches our server — it has no APN or destination until it pulls the config.',
  },
]

/** Logging which SIM went into which device, at the moment of insertion.
 *  Skipped once, and reconciling 14 units means power-cycling them one at a
 *  time to see which subscription lights up. */
const PAIR_STEP: PrepStep = {
  key: 'paired',
  label: 'ICCID logged against this IMEI',
  detail:
    'Photograph the SIM card next to the device label before it goes in. The packing slip lists IMEIs, the cards carry ICCIDs, and nothing links them afterwards.',
  ifSkipped: 'You can still finish the install — you just cannot tell later which subscription belongs to which device.',
}

export const MODELS: Record<DeviceModel, ModelSpec> = {
  FMM00A: {
    model: 'FMM00A',
    name: 'Teltonika FMM003 / FMM00A',
    role: 'OBD-II plug-in for light-duty trucks. Doubles as the BLE gateway that tools ride on.',
    assetType: 'vehicle',
    sim: 'mini-SIM (2FF)',
    power: 'OBD-II port. Internal battery is BACKUP only — it will not come up on a bench.',
    firstContact: 'Minutes once plugged into a live OBD port; config applies on the next FOTA sync (up to 12 h, usually overnight).',
    gateway: true,
    beaconCap: 100,
    prep: [
      {
        key: 'battery',
        label: 'Internal battery plugged in',
        detail: 'Ships DISCONNECTED. Open the case, click the battery connector home, close the case fully — the case IS the OBD plug housing and it will not power up open.',
        ifSkipped: 'Unit runs off the port but loses the theft-detection window the moment power is cut.',
        gotcha: true,
      },
      { key: 'sim_in', label: 'Mini-SIM (2FF) inserted', detail: 'Largest of the three punches. Do not break it down to micro or nano — that is one-way.' },
      PAIR_STEP,
      ...SIM_STEPS,
      {
        key: 'installed',
        label: 'Plugged into the vehicle OBD port',
        detail: 'Light-duty only. A Class-8 dash is 9-pin Deutsch J1939 — an OBD-II plug will not physically fit a Peterbilt or an International.',
        ifSkipped: 'Stays Inactive in FOTA indefinitely. There is no bench path for this model.',
      },
    ],
  },

  TAT141: {
    model: 'TAT141',
    name: 'Teltonika TAT141',
    role: 'Battery asset tracker for equipment with no power to tap. NOT a tool-tag gateway.',
    assetType: 'equipment',
    sim: 'micro-SIM (3FF)',
    power: 'Internal battery, shipped CONNECTED — with a physical ON/OFF switch shipped OFF.',
    firstContact: 'Boots and registers immediately when switched on. Then sleeps: 28,800 s (8 h) default interval when stationary.',
    gateway: false,
    beaconCap: null,
    prep: [
      { key: 'sim_in', label: 'Micro-SIM (3FF) inserted', detail: 'A different punch than the FMM00A and FMM650 in the same order. Cut corner leads.' },
      PAIR_STEP,
      {
        key: 'switch_on',
        label: 'Internal ON/OFF switch flipped to ON',
        detail: 'Quick Manual v1.8 p.4 step 3. The battery ships connected, so the switch is the ONLY thing standing between you and a live device. Confirm the status LED: solid = self-test, blink every 5 s = working with the modem on, dark = off.',
        ifSkipped: 'Six units read Inactive in FOTA for hours on Aug 28. Nothing else was wrong with any of them.',
        gotcha: true,
      },
      ...SIM_STEPS,
      { key: 'installed', label: 'Mounted on the machine', detail: 'At real reporting rates the battery alone will not last — wire to 12/24 V aux where the machine has it.' },
    ],
  },

  FMM650: {
    model: 'FMM650',
    name: 'Teltonika FMM650 (+ ALL-CAN300)',
    role: 'Wired professional tracker. Native J1939/CAN for true engine hours, fuel and faults — and the gateway that makes a tool trailer work.',
    assetType: 'equipment',
    sim: 'mini-SIM (2FF)',
    power: 'Wired 8–32 V. The 550 mAh cell is backup, not a power source.',
    firstContact: 'Registers within minutes of 12 V, and syncs FOTA on power-up — so queue the config BEFORE first power.',
    gateway: true,
    beaconCap: 25,
    prep: [
      {
        key: 'dummy_out',
        label: 'Blank dummy card removed from the SIM holder',
        detail: 'A plain white card ships in the holder. It is not a SIM and not a pre-installed subscription — pull it.',
        ifSkipped: 'Mistaken for a pre-provisioned SIM, which throws off your whole SIM count.',
      },
      {
        key: 'sim_in',
        label: 'Mini-SIM (2FF) in slot 1 — the LOWER deck',
        detail: 'Stacked dual-deck holder: slot 1 sits closer to the PCB, slot 2 is above it. Insert with the battery DISCONNECTED (manual: "external voltage and internal battery disconnected"), then connect the battery.',
        ifSkipped: 'A card in slot 2 registers on nothing while looking perfectly seated. Inserting with power live can damage the card outright.',
        gotcha: true,
      },
      PAIR_STEP,
      {
        key: 'antennas',
        label: 'Both external antennas on the right ports',
        detail: 'The SQUARE ceramic puck is GNSS; the LONG FLAT strip is cellular. Port labels are on the case faces, not the connector edge — and a label printed on an antenna cable names the ANTENNA, not the socket it happens to be plugged into. Finger-tight plus a nip, never pliers.',
        ifSkipped: 'Swapped antennas give you a unit that either cannot see satellites or cannot reach the network — and both read as "the config did not work".',
        gotcha: true,
      },
      ...SIM_STEPS,
      {
        key: 'installed',
        label: 'Wired to 8–32 V (and CAN, if fitted)',
        detail: 'Easiest bench source is any truck\'s accessory socket. Run the engine while you test: the alternator\'s ~14 V clears the 13,200 mV ignition threshold, so you verify ignition detection and active tracking in the same trip.',
        ifSkipped: 'Will not self-provision on a bench — there is no internal power path to bring it up.',
      },
    ],
  },

  EYE_BEACON: {
    model: 'EYE_BEACON',
    name: 'Teltonika EYE Beacon (BTSID1)',
    role: 'BLE tag for tools. No GPS — it inherits the location of whatever gateway hears it.',
    assetType: 'tool',
    sim: null,
    power: 'Coin cell, always on. May ship in Hibernate — woken with a magnet.',
    firstContact: 'Appears the first time a gateway with beacon scanning is powered near it.',
    gateway: false,
    beaconCap: null,
    prep: [
      {
        key: 'ibeacon',
        label: 'Packet type switched from Eddystone to iBeacon',
        detail: 'EYE app → connect (default PIN 123456) → Basic settings → Packet settings → iBeacon.',
        ifSkipped: 'Ships defaulted to EDDYSTONE. Our tool assets are keyed on the iBeacon UUID:MAJOR:MINOR identity, so a tag left on the default can never match one — no matter how correct everything else is.',
        gotcha: true,
      },
      {
        key: 'identity',
        label: 'UUID / Major set, and a unique Minor assigned',
        detail: 'EYE app → Advanced settings. Fields are HEX; our asset Tracker IDs are decimal. Keep one shared UUID + Major across the fleet so the Minor alone identifies the tool.',
        ifSkipped: 'Factory UUID is all zeros and shared across every tag, leaving uniqueness resting entirely on random Major/Minor values.',
      },
      {
        key: 'marked',
        label: 'Minor written on the physical tag',
        detail: 'Paint pen or label. The app\'s device name carries the FACTORY suffix and will not follow the Minor you assign.',
        ifSkipped: 'Ten identical tags, and no way to tell which tool a map dot belongs to.',
      },
    ],
  },

  OTHER: {
    model: 'OTHER',
    name: 'Other tracker',
    role: 'Anything not in the KORE catalogue.',
    assetType: 'equipment',
    sim: null,
    power: 'Per manufacturer.',
    firstContact: 'Unknown.',
    gateway: false,
    beaconCap: null,
    prep: [PAIR_STEP, ...SIM_STEPS, { key: 'installed', label: 'Installed and powered', detail: 'Per manufacturer instructions.' }],
  },
}

export const MODEL_ORDER: DeviceModel[] = ['FMM00A', 'TAT141', 'FMM650', 'EYE_BEACON', 'OTHER']

/** Teltonika encodes the radio in the third letter of the model name, and
 *  getting it wrong means a device that cannot use the SIM plan you bought.
 *  FMB = 2G (sunset), FMC = LTE Cat 1, FMM = Cat M1/NB-IoT, FMU = 3G (EOL). */
export function radioNote(model: DeviceModel): string | null {
  if (model === 'FMM00A' || model === 'TAT141' || model === 'FMM650') return 'Cat M1 / NB-IoT'
  return null
}

/**
 * Guess the model from an IMEI using the TAC (first 8 digits — the Type
 * Allocation Code, which is per-model by definition). Seeded from order #1 so
 * scanning a label auto-selects the right checklist; unknown prefixes just
 * return null and the user picks. Deliberately not clever: a wrong guess here
 * would hand someone the wrong gotchas, which is worse than no guess.
 */
const TAC_HINTS: [string, DeviceModel][] = [
  ['86081307', 'FMM650'],
  ['86345208', 'FMM00A'],
  ['86249408', 'FMM00A'],
  ['86926707', 'TAT141'],
]
export function modelFromImei(imei: string): DeviceModel | null {
  const digits = imei.replace(/\D/g, '')
  if (digits.length < 8) return null
  return TAC_HINTS.find(([tac]) => digits.startsWith(tac))?.[1] ?? null
}

/** IMEIs are 15 digits and carry a Luhn check digit — catching a typo here
 *  saves someone hunting a "dead" device that is really a bad Tracker ID. */
export function imeiLooksValid(imei: string): { ok: boolean; reason?: string } {
  const d = imei.replace(/\D/g, '')
  if (!d) return { ok: false, reason: 'Enter the 15-digit IMEI from the device label.' }
  if (d.length !== 15) return { ok: false, reason: `That is ${d.length} digits — an IMEI is 15.` }
  let sum = 0
  for (let i = 0; i < 15; i++) {
    let n = Number(d[i])
    if (i % 2 === 1) { n *= 2; if (n > 9) n -= 9 }
    sum += n
  }
  if (sum % 10 !== 0) return { ok: false, reason: 'Checksum fails — one digit is likely mistyped.' }
  return { ok: true }
}

/** Live signals we can read from our OWN data — no vendor console needed.
 *  This is the half of the checklist that ticks itself. */
export interface LiveSignals {
  /** An asset exists in this company with the device's IMEI as tracker_id. */
  registered: boolean
  /** Has the device ever reached our ingest? */
  everReported: boolean
  /** Minutes since the last report, when it has reported. */
  ageMin: number | null
  /** Does the latest report carry a GNSS fix? */
  hasFix: boolean
  /** Beacons in the latest report — proves BLE scanning is live on a gateway. */
  beacons: number
  assetId: string | null
  assetName: string | null
}

export type StageState = 'done' | 'waiting' | 'blocked'

export interface Stage {
  key: string
  label: string
  state: StageState
  note: string
}

/**
 * The end-to-end pipeline, as stages, with the reason each one is stuck.
 * Ordered so the FIRST non-done stage is the thing actually blocking you —
 * which is the whole point: on Aug 28 the answer was always "an earlier stage
 * than the one you were staring at".
 */
export function pipeline(
  spec: ModelSpec,
  steps: Record<string, string | null | undefined>,
  live: LiveSignals,
): Stage[] {
  const manualDone = (k: string) => !!steps[k]
  const physical = spec.prep.filter((p) => !SIM_STEPS.some((s) => s.key === p.key))
  const physicalLeft = physical.filter((p) => !manualDone(p.key))

  const out: Stage[] = [
    {
      key: 'prep',
      label: 'Device prepared',
      state: physicalLeft.length === 0 ? 'done' : 'blocked',
      note: physicalLeft.length === 0
        ? 'Every physical step checked off.'
        : `Waiting on: ${physicalLeft.map((p) => p.label.toLowerCase()).join(', ')}.`,
    },
  ]

  if (spec.sim) {
    out.push({
      key: 'sim',
      label: 'SIM active',
      state: manualDone('sim_active') ? 'done' : 'blocked',
      note: manualDone('sim_active')
        ? 'Activated with the data APN feature.'
        : 'Not activated in KORE — the device cannot open a data session, so nothing downstream can happen.',
    })
    out.push({
      key: 'config',
      label: 'Config queued',
      state: manualDone('config_queued') ? 'done' : 'blocked',
      note: manualDone('config_queued')
        ? 'Task waiting in FOTA; it applies on the device\'s next sync.'
        : 'No config task queued — the device has no server to report to.',
    })
  }

  out.push({
    key: 'registered',
    label: 'Registered in HammerTrack',
    state: live.registered ? 'done' : 'blocked',
    note: live.registered
      ? `Linked to ${live.assetName}.`
      : 'No asset carries this IMEI as its Tracker ID. Reports from an unknown device are dropped, so register it before it comes online.',
  })

  out.push({
    key: 'reporting',
    label: 'Reaching our server',
    state: live.everReported ? 'done' : 'waiting',
    note: live.everReported
      ? live.ageMin != null && live.ageMin < 180
        ? `Last report ${live.ageMin} min ago.`
        : `Last report ${live.ageMin} min ago — quiet, which may be normal for this model.`
      : `Nothing received yet. ${spec.firstContact}`,
  })

  out.push({
    key: 'fix',
    label: 'GPS fix',
    state: live.hasFix ? 'done' : live.everReported ? 'waiting' : 'blocked',
    note: live.hasFix
      ? 'Reporting real coordinates — it is on the map.'
      : live.everReported
        ? 'Reporting, but no position yet. Needs sky view; a first fix can take several minutes.'
        : 'Nothing to fix until it reports.',
  })

  if (spec.gateway) {
    out.push({
      key: 'ble',
      label: 'Hearing tool tags',
      state: live.beacons > 0 ? 'done' : 'waiting',
      note: live.beacons > 0
        ? `${live.beacons} tag${live.beacons === 1 ? '' : 's'} in the latest report.`
        : `No beacons in the latest report. Normal if no tags are nearby — but if tags ARE aboard, beacon scanning is off in the config. Reports up to ${spec.beaconCap} tags per record.`,
    })
  }

  return out
}

/** One-line answer to "what do I do next?" — the first stage that isn't done. */
export function nextAction(stages: Stage[]): string {
  const stuck = stages.find((s) => s.state !== 'done')
  return stuck ? stuck.note : 'Fully online. Nothing left to do.'
}

/**
 * How a tracker id should read at a glance on the map sheet.
 *
 * Brian, Sep 3: "I want to be able to see the last four ... when I click an
 * asset." The last four digits are how the hardware is actually identified in
 * the field — the KORE/FOTA/flespi consoles all list devices by IMEI, and the
 * unit in your hand has it printed on the label. Showing the whole 15 digits
 * in a sheet header is unreadable; the last four is what you compare against.
 *
 * Not every tracker is an IMEI, though — phone shares are `phone-<uuid>` and
 * BLE tags carry short hex ids — so the label names what it is rather than
 * blindly slicing four characters off a UUID.
 */
export function shortTracker(
  trackerId: string | null | undefined,
): { kind: 'imei' | 'phone' | 'tag'; label: string; short: string; full: string } | null {
  const full = (trackerId ?? '').trim()
  if (!full) return null
  if (/^phone-/i.test(full)) return { kind: 'phone', label: 'Phone', short: 'this phone', full }
  if (/^\d{15}$/.test(full)) return { kind: 'imei', label: 'IMEI', short: `····${full.slice(-4)}`, full }
  // Short enough to read whole (bt-042, obd-001, a beacon Minor) — show it all.
  if (full.length <= 10) return { kind: 'tag', label: 'Tag', short: full, full }
  return { kind: 'tag', label: 'Tag', short: `····${full.slice(-4)}`, full }
}
