import { pointInPolygon } from './alerts-engine'

/**
 * Zone visit segmentation — who arrived, when they left, how long they stayed.
 * The zone page's accountability feed: "F-350 · arrived 6:58 AM · left 3:12 PM
 * · 8h 14m". Built from the same ping stream as trips/costs, so all three
 * views agree with each other (and with the invoices).
 */

export interface VisitPoint {
  asset_id: string
  lat: number
  lng: number
  timestamp: string
}

export interface Visit {
  assetId: string
  enterMs: number
  /** Null = still on site right now. */
  exitMs: number | null
  minutes: number
}

// A silence longer than this while inside closes the visit at the last fix —
// the device went dark (parked overnight / powered off), not "18h on site".
// Generous because engine-off trackers check in ~hourly.
const GAP_CLOSE_MS = 3 * 3_600_000
// Don't log drive-bys: a visit must last at least this long.
const MIN_VISIT_MS = 5 * 60_000

/** Segment one company's chronological pings into per-asset zone visits
 *  (newest first). `nowMs` bounds the "still on site" duration. */
export function segmentVisits(
  rows: VisitPoint[],
  ring: [number, number][],
  nowMs = Date.now()
): Visit[] {
  if (ring.length < 3) return []

  const byAsset = new Map<string, { ms: number; inside: boolean }[]>()
  for (const r of rows) {
    const ms = new Date(r.timestamp).getTime()
    if (!Number.isFinite(ms)) continue
    let list = byAsset.get(r.asset_id)
    if (!list) byAsset.set(r.asset_id, (list = []))
    list.push({ ms, inside: pointInPolygon([r.lng, r.lat], ring) })
  }

  const visits: Visit[] = []
  for (const [assetId, pts] of Array.from(byAsset.entries())) {
    pts.sort((a: { ms: number }, b: { ms: number }) => a.ms - b.ms)
    let enter: number | null = null
    let lastInside = 0
    for (const p of pts) {
      if (p.inside) {
        if (enter === null) {
          enter = p.ms
        } else if (p.ms - lastInside > GAP_CLOSE_MS) {
          // device went dark mid-visit — close the old one, start fresh
          if (lastInside - enter >= MIN_VISIT_MS) {
            visits.push({ assetId, enterMs: enter, exitMs: lastInside, minutes: Math.round((lastInside - enter) / 60_000) })
          }
          enter = p.ms
        }
        lastInside = p.ms
      } else if (enter !== null) {
        if (lastInside - enter >= MIN_VISIT_MS) {
          visits.push({ assetId, enterMs: enter, exitMs: lastInside, minutes: Math.round((lastInside - enter) / 60_000) })
        }
        enter = null
      }
    }
    if (enter !== null) {
      // Still inside at the end of the data. If the device has been silent for
      // ages, close honestly at the last fix; otherwise it's live-on-site.
      const stale = nowMs - lastInside > GAP_CLOSE_MS
      const end = stale ? lastInside : null
      const dur = (end ?? nowMs) - enter
      if (dur >= MIN_VISIT_MS) {
        visits.push({ assetId, enterMs: enter, exitMs: end, minutes: Math.round(dur / 60_000) })
      }
    }
  }
  return visits.sort((a, b) => b.enterMs - a.enterMs)
}
