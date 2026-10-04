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

/** Apple's company identifier — iBeacon frames ride inside manufacturer-
 *  specific data under 0x004C (keyed as decimal by the BLE plugin). */
export const APPLE_COMPANY_ID = '76'

/** Eddystone's service (0xFEAA) as the plugin keys it, and Teltonika's company
 *  id (0x089A, keyed as decimal) — a factory EYE Beacon advertises one or both. */
export const EDDYSTONE_SERVICE = '0000feaa-0000-1000-8000-00805f9b34fb'
export const TELTONIKA_COMPANY_ID = '2202'

/** Does this advertisement look like a tool tag — an iBeacon frame, an
 *  Eddystone frame or Teltonika's own EYE data? Every phone, watch and earbud
 *  nearby advertises too, and counting them as "heard" kept a phone gateway
 *  on its fast window — a GPS fix every 20 s — in any town (truth-check,
 *  Oct 4). Trucks still hear every format; this only gates the phone. */
export function tagShaped(r: { manufacturerData?: Record<string, DataView>; serviceData?: Record<string, DataView>; uuids?: string[] }): boolean {
  const apple = r.manufacturerData?.[APPLE_COMPANY_ID]
  if (apple && parseIBeacon(apple)) return true
  if (r.manufacturerData?.[TELTONIKA_COMPANY_ID]) return true
  const eddystone = (k: string) => { const u = k.toLowerCase(); return u === EDDYSTONE_SERVICE || u === 'feaa' }
  if (r.serviceData && Object.keys(r.serviceData).some(eddystone)) return true
  return !!r.uuids?.some(eddystone)
}

/** Pull UUID / major / minor out of an iBeacon manufacturer-data payload.
 *  Layout after the company id: 02 15 <16-byte UUID> <major:2> <minor:2> <tx:1> */
export function parseIBeacon(view: DataView): { uuid: string; major: number; minor: number } | null {
  if (view.byteLength < 23) return null
  if (view.getUint8(0) !== 0x02 || view.getUint8(1) !== 0x15) return null
  const hex: string[] = []
  for (let i = 2; i < 18; i++) hex.push(view.getUint8(i).toString(16).padStart(2, '0'))
  const h = hex.join('')
  const uuid = `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`.toUpperCase()
  return { uuid, major: view.getUint16(18), minor: view.getUint16(20) }
}
