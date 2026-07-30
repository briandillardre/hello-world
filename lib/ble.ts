/**
 * BLE tag identity — shared vocabulary between the phone scanner and the
 * flespi ingest route.
 *
 * The whole point of the scanner is that the ID you read off a tag has to be
 * the ID the TRACKER will later report, or the tool silently never matches.
 * Those two are not obviously the same string:
 *
 *   • Teltonika gateways report either a hardware MAC ("DC:0D:04:BB:00:3A")
 *     or an iBeacon identity ("FDA50693-…:2751:65C1").
 *   • iBeacon major/minor arrive from the gateway in HEX, while essentially
 *     every phone scanner app shows them in DECIMAL. 2751:65C1 is the same
 *     tag as 10065:26049, and pasting the wrong one produces a tool that
 *     never appears with no error anywhere.
 *
 * So the scanner offers both forms and says which is which. The ingest route
 * already matches case- and separator-insensitively across both, so either
 * registers correctly — the risk is only in the owner not knowing they're the
 * same tag and registering two.
 */

/** Normalize for comparison — same rule the ingest route uses. */
export function bareId(s: string): string {
  return s.replace(/[^0-9a-z]/gi, '').toLowerCase()
}

export interface ScannedTag {
  /** Hardware MAC / device id as the OS reports it. */
  mac: string | null
  /** iBeacon proximity UUID, if the tag advertises one. */
  uuid: string | null
  major: number | null
  minor: number | null
  /** Signal strength in dBm — closer to 0 is nearer. */
  rssi: number | null
  /** Advertised name, when present. */
  name: string | null
  /** First/last time this scan session saw it, epoch ms. */
  firstSeen: number
  lastSeen: number
}

/**
 * The string to paste into a tool asset's Tracker ID.
 * iBeacon identity wins when present because that's what survives a battery
 * change on tags that randomize their MAC; MAC is the fallback.
 */
export function trackerIdFor(t: ScannedTag): string {
  if (t.uuid && t.major != null && t.minor != null) return `${t.uuid}:${t.major}:${t.minor}`
  return t.mac ?? ''
}

/** The hex-major/minor twin of the same tag, for owners whose gateway config
 *  reports hex. Null when the tag isn't an iBeacon. */
export function trackerIdHexFor(t: ScannedTag): string | null {
  if (!t.uuid || t.major == null || t.minor == null) return null
  const hex = (n: number) => n.toString(16).toUpperCase().padStart(4, '0')
  return `${t.uuid}:${hex(t.major)}:${hex(t.minor)}`
}

/**
 * Very rough distance from RSSI. Deliberately bucketed rather than shown in
 * feet: BLE path loss is so noisy indoors and around metal that a decimal
 * number would be a lie. "In hand vs across the yard" is the honest
 * resolution, and it's what you actually need when walking a tag down.
 */
export function proximityLabel(rssi: number | null): string {
  if (rssi == null) return 'unknown'
  if (rssi >= -55) return 'right here'
  if (rssi >= -70) return 'close'
  if (rssi >= -85) return 'nearby'
  return 'far'
}

/** 0–1 signal bar fraction, for a meter. */
export function signalFraction(rssi: number | null): number {
  if (rssi == null) return 0
  return Math.max(0, Math.min(1, (rssi + 100) / 55))
}
