/**
 * Geometry-aware track thinning (Douglas–Peucker, iterative).
 *
 * Uniform stride thinning ("every Nth point") is what made long-range trails
 * cut corners across the interstate — it drops curve points and keeps
 * redundant straight-line ones with equal indifference. DP keeps every point
 * that shapes the path and discards only points that sit on the line between
 * their neighbors, so a highway sweep survives with 10–20× fewer rows and
 * zero visible change.
 */

interface RowLike {
  asset_id: string
  lat: number
  lng: number
  timestamp: string
}

/** Perpendicular distance (meters, equirectangular approx — fine at track scale). */
function perpMeters(p: RowLike, a: RowLike, b: RowLike): number {
  const kx = 111_320 * Math.cos(((a.lat + b.lat) / 2) * (Math.PI / 180))
  const ky = 110_540
  const ax = a.lng * kx, ay = a.lat * ky
  const bx = b.lng * kx, by = b.lat * ky
  const px = p.lng * kx, py = p.lat * ky
  const dx = bx - ax, dy = by - ay
  const len2 = dx * dx + dy * dy
  if (len2 === 0) return Math.hypot(px - ax, py - ay)
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2))
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy))
}

/** Douglas–Peucker on one chronological track. Iterative — no stack overflow
 *  on 40k-point days. Returns kept indices in order. */
function dpKeep(track: RowLike[], toleranceM: number): boolean[] {
  const n = track.length
  const keep = new Array<boolean>(n).fill(false)
  if (n <= 2) return keep.fill(true)
  keep[0] = keep[n - 1] = true
  const stack: [number, number][] = [[0, n - 1]]
  while (stack.length) {
    const [s, e] = stack.pop()!
    if (e - s < 2) continue
    let maxD = -1
    let maxI = -1
    for (let i = s + 1; i < e; i++) {
      const d = perpMeters(track[i], track[s], track[e])
      if (d > maxD) { maxD = d; maxI = i }
    }
    if (maxD > toleranceM) {
      keep[maxI] = true
      stack.push([s, maxI], [maxI, e])
    }
  }
  return keep
}

/**
 * Simplify a mixed-asset row set: group per asset, sort chronologically,
 * DP-simplify each track, then re-merge sorted by time. `hardCap` guards the
 * payload — if simplification alone isn't enough (it almost always is), the
 * tolerance doubles until it fits, which degrades gracefully instead of
 * chopping uniformly.
 */
export function simplifyHistoryRows<T extends RowLike>(rows: T[], toleranceM = 12, hardCap = 20_000): T[] {
  if (rows.length <= 2) return rows
  const byAsset = new Map<string, T[]>()
  for (const r of rows) {
    let list = byAsset.get(r.asset_id)
    if (!list) byAsset.set(r.asset_id, (list = []))
    list.push(r)
  }
  let tol = toleranceM
  for (let attempt = 0; attempt < 6; attempt++) {
    const out: T[] = []
    for (const track of Array.from(byAsset.values())) {
      track.sort((a, b) => a.timestamp.localeCompare(b.timestamp))
      const keep = dpKeep(track, tol)
      for (let i = 0; i < track.length; i++) if (keep[i]) out.push(track[i])
    }
    if (out.length <= hardCap) {
      return out.sort((a, b) => a.timestamp.localeCompare(b.timestamp))
    }
    tol *= 2
  }
  // Pathological fallback — should be unreachable.
  const stride = Math.max(1, Math.ceil(rows.length / hardCap))
  return rows.filter((_, i) => i % stride === 0 || i === rows.length - 1)
}
