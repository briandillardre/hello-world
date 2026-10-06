/**
 * Which placed site photo the map's Site imagery layer shows for each zone —
 * pure (harness: scripts/satellite-test.mjs); components/map/MapView.tsx
 * calls it on every timeline step.
 *
 * At any point on the timeline (Live = now) a zone shows its newest placed
 * photo taken on or before that day — a daily drone flier gets site playback
 * for free. One exception (Oct 6 review): a SATELLITE picture never displaces
 * a drone or site photo of the same zone taken within the 14 days before it.
 * A 10 m Sentinel frame is far coarser than a drone ortho, so it only takes
 * the zone over once it is more than two weeks newer than the sharper shot;
 * a drone shot always takes over from an older satellite picture.
 */

export const SAT_YIELD_DAYS = 14

export interface PlacedPhoto {
  id: string
  zoneId: string
  /** Capture day, YYYY-MM-DD. */
  takenOn: string
  /** zone_imagery.source === 'satellite'. */
  satellite?: boolean
}

const DAY_MS = 86_400_000
const utcDay = (d: string) => Date.parse(`${d}T00:00:00Z`)

/**
 * The ids of the photo each zone shows at `cutoffMs` (Infinity = Live),
 * sorted. `startMs(takenOn)` is the instant a shot starts standing for its
 * site (the map uses local midnight of the capture day). Within one kind, a
 * tie on the day goes to the later photo in `photos` order (the loader sorts
 * by day, then upload time).
 */
export function activeSitePhotoIds(photos: PlacedPhoto[], cutoffMs: number, startMs: (takenOn: string) => number): string[] {
  const byZone = new Map<string, { sat: PlacedPhoto | null; other: PlacedPhoto | null }>()
  for (const p of photos) {
    const at = startMs(p.takenOn)
    if (!Number.isFinite(at) || at > cutoffMs) continue
    const b = byZone.get(p.zoneId) ?? { sat: null, other: null }
    if (p.satellite) { if (!b.sat || p.takenOn >= b.sat.takenOn) b.sat = p }
    else if (!b.other || p.takenOn >= b.other.takenOn) b.other = p
    byZone.set(p.zoneId, b)
  }
  const out: string[] = []
  byZone.forEach(({ sat, other }) => {
    if (!sat || !other) { out.push((sat ?? other)!.id); return }
    // The sharper shot keeps the zone unless the satellite picture is more
    // than SAT_YIELD_DAYS newer (same day included: the drone wins).
    const newerBy = (utcDay(sat.takenOn) - utcDay(other.takenOn)) / DAY_MS
    out.push(newerBy > SAT_YIELD_DAYS ? sat.id : other.id)
  })
  return out.sort()
}
