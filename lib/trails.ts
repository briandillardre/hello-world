import type { AssetWithLocation, AssetType } from './types'
import { simplifyPoints } from './simplify'
import { DEMO_MAP_CENTER, MOCK_PATHS, DEMO_BOUNDS } from './mock-data'

/**
 * Equipment Trails + Timeline Playback data.
 *
 * Each asset gets a deterministic time-series "track" (a day of movement) so the
 * map can draw colored historical trails and replay them on a scrubber. In demo
 * mode these are synthesized with a seeded random walk anchored at the asset's
 * current position; with real data this module would read AssetLocation history.
 */

export interface TrackPoint {
  lng: number
  lat: number
  t: number // normalized 0..1 across the playback window
  /** True when there's a data gap before this point (device asleep / out of
   *  coverage). Interpolation must SNAP across it, not glide, and trails
   *  break the line here instead of drawing a chord across town. */
  gap?: boolean
  /** Reported speed at this fix (real history, or the demo's authored story
   *  speed) — feeds the Follow HUD and speed-colored trails. */
  mph?: number
}

export interface AssetTrack {
  assetId: string
  name: string
  type: AssetType
  color: string
  points: TrackPoint[]
}

// Vivid, high-contrast colors that read well on a dark map
export const TRAIL_PALETTE = [
  '#ff9e16', '#2dd4bf', '#a78bfa', '#f87171', '#34d399',
  '#60a5fa', '#fbbf24', '#f472b6', '#22d3ee', '#fb923c',
]

// Playback window spans a work day, 6:00 AM → 6:00 PM
export const PLAYBACK_START_HOUR = 6
export const PLAYBACK_END_HOUR = 18
export const PLAYBACK_WINDOW_SECONDS = (PLAYBACK_END_HOUR - PLAYBACK_START_HOUR) * 3600

export function clockLabel(t: number): string {
  const totalMin = PLAYBACK_START_HOUR * 60 + t * (PLAYBACK_END_HOUR - PLAYBACK_START_HOUR) * 60
  const h = Math.floor(totalMin / 60)
  const m = Math.floor(totalMin % 60)
  const ampm = h >= 12 ? 'PM' : 'AM'
  let hh = h % 12
  if (hh === 0) hh = 12
  return `${hh}:${m.toString().padStart(2, '0')} ${ampm}`
}

function mulberry32(seed: number) {
  return function () {
    seed |= 0
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// Demo movement: a smooth random wander anchored at the asset's live position
// (only assets WITHOUT an authored MOCK_PATHS loop — today that's people and
// tools). Small amplitudes: they move within a site, not across town.
// People and tools stay ON their site — the old amplitudes sent a foreman
// wandering half the stage, which read as noise on the new realistic map.
const AMP: Record<AssetType, number> = { vehicle: 0.012, equipment: 0.004, personnel: 0.0005, tool: 0.0003 }

// How busy each class is across a work day — scales the odds an asset is moving
// (vs. parked) at any moment. Tools mostly sit; trucks run all day. This is what
// gives the activity chart real texture instead of "everything always moving".
const DUTY: Record<AssetType, number> = { vehicle: 1, equipment: 0.72, personnel: 0.85, tool: 0.28 }

const N_POINTS = 96

// A jobsite's daily rhythm over the 6AM–6PM window (u = 0→1): quiet at open,
// ramp through mid-morning, a midday lull (lunch), busy afternoon, wind-down.
function daytimeActivity(u: number): number {
  const ramp = Math.min(1, u / 0.14)              // 6:00 → ~7:40 warm-up
  const taper = Math.min(1, (1 - u) / 0.12)       // ~4:35 → 6:00 wind-down
  const lunch = 1 - 0.55 * Math.exp(-((u - 0.46) ** 2) / (2 * 0.055 ** 2)) // ~11:30 dip
  return Math.max(0, ramp * taper * lunch)
}

// FNV-1a — tracks stay stable when the asset list reorders or grows
function hashId(id: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}

/** THE color for an asset, everywhere — trails, radar blips, follow picker.
 *  Deterministic from the id so every surface agrees. */
export function trailColor(id: string): string {
  return TRAIL_PALETTE[hashId(id) % TRAIL_PALETTE.length]
}

// How many times an asset traverses its authored loop across the demo day.
const PATH_LOOPS: Record<AssetType, number> = { vehicle: 2, equipment: 3, personnel: 2, tool: 1 }

type DemoPathPt = [number, number] | [number, number, number]

/** Chaikin corner-cutting on a CLOSED loop, pinning vertex 0 (the asset's
 *  live position must survive smoothing exactly). Two rounds turn coarse
 *  hand-authored waypoints into curved, recorded-looking GPS lines — the old
 *  right-angle loops read as CAD linework, not a fleet (Brian, Aug 23).
 *  The optional per-waypoint mph rides along on the smoothed points. */
function chaikinClosedKeepFirst(path: DemoPathPt[], iters = 2): DemoPathPt[] {
  const last = path[path.length - 1]
  let ring: DemoPathPt[] = last[0] === path[0][0] && last[1] === path[0][1] ? path.slice(0, -1) : path.slice()
  for (let k = 0; k < iters; k++) {
    const out: DemoPathPt[] = []
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i]
      const b = ring[(i + 1) % ring.length]
      out.push([a[0] * 0.75 + b[0] * 0.25, a[1] * 0.75 + b[1] * 0.25, a[2] ?? b[2]] as DemoPathPt)
      out.push([a[0] * 0.25 + b[0] * 0.75, a[1] * 0.25 + b[1] * 0.75, a[2] ?? b[2]] as DemoPathPt)
    }
    ring = out
  }
  // Re-close through the EXACT live-position vertex: first and last smoothed
  // points already hug it, so this adds no spike — just one true corner.
  return [path[0], ...ring, path[0]]
}

/** Point at distance d (wrapping) along a closed waypoint loop. Distances are
 *  in raw degrees — fine for a demo stage a couple of km across. */
function pathPointAt(path: DemoPathPt[], cum: number[], total: number, d: number): [number, number] {
  const dd = ((d % total) + total) % total
  for (let s = 0; s < cum.length - 1; s++) {
    if (dd <= cum[s + 1]) {
      const segLen = cum[s + 1] - cum[s]
      const f = segLen > 0 ? (dd - cum[s]) / segLen : 0
      return [path[s][0] + (path[s + 1][0] - path[s][0]) * f, path[s][1] + (path[s + 1][1] - path[s][1]) * f]
    }
  }
  return [path[path.length - 1][0], path[path.length - 1][1]]
}

/** Authored mph for the segment containing distance d (undefined = no hint). */
function pathMphAt(path: DemoPathPt[], cum: number[], total: number, d: number): number | undefined {
  const dd = ((d % total) + total) % total
  for (let s = 0; s < cum.length - 1; s++) {
    if (dd <= cum[s + 1]) return path[s][2]
  }
  return path[path.length - 1][2]
}

export function generateTracks(assets: AssetWithLocation[]): AssetTrack[] {
  return assets.map((a) => {
    const rng = mulberry32(hashId(a.id))
    const endLng = a.location?.lng ?? DEMO_MAP_CENTER[0]
    const endLat = a.location?.lat ?? DEMO_MAP_CENTER[1]
    const amp = AMP[a.type]
    const duty = DUTY[a.type]

    // Per-bucket moving/parked schedule (forward pass) with hysteresis so blocks
    // are contiguous — an asset drives for a stretch, parks for a stretch — and
    // biased by the jobsite's daily rhythm, so mornings/lunch/evenings go quiet.
    const active = new Array<boolean>(N_POINTS)
    let on = false
    for (let i = 0; i < N_POINTS; i++) {
      const p = daytimeActivity(i / (N_POINTS - 1)) * duty
      if (on) { if (rng() < 0.05 + (1 - p) * 0.13) on = false }
      else { if (rng() < 0.02 + p * 0.17) on = true }
      active[i] = on
    }

    // Assets with an authored path FOLLOW it (yard↔site circuits, on-site
    // serpentines) instead of random-walking — the walk sent demo trucks
    // across the river off-bridge (Brian, Aug 5). Walk backward from the live
    // position (path[0]), advancing along the loop only during active blocks.
    const authored = MOCK_PATHS[a.id]
    if (authored && authored.length >= 2) {
      // Round the corners so the trace reads as recorded GPS, then jitter
      // each active fix by a few meters (real receivers wobble in-lane).
      const path = chaikinClosedKeepFirst(authored as DemoPathPt[])
      const cum: number[] = [0]
      for (let s = 1; s < path.length; s++) {
        cum.push(cum[s - 1] + Math.hypot(path[s][0] - path[s - 1][0], path[s][1] - path[s - 1][1]))
      }
      const total = cum[cum.length - 1] || 1
      const activeCount = active.filter(Boolean).length
      const step = (total * PATH_LOOPS[a.type]) / Math.max(1, activeCount)
      const noise = a.type === 'vehicle' ? 0.00005 : 0.000025
      const pathPts: TrackPoint[] = new Array(N_POINTS)
      let d = 0 // distance along loop; 0 = live position (path[0])
      for (let i = N_POINTS - 1; i >= 0; i--) {
        const [plng, plat] = pathPointAt(path, cum, total, d)
        const mph = pathMphAt(path, cum, total, d)
        const moving = active[i] && i !== N_POINTS - 1
        pathPts[i] = {
          lng: moving ? plng + (rng() - 0.5) * noise : plng,
          lat: moving ? plat + (rng() - 0.5) * noise : plat,
          t: i / (N_POINTS - 1),
          // Authored story speed (± a little life) — feeds the HUD and the
          // speed-colored trails; parked buckets honestly read 0.
          mph: active[i] && mph != null ? Math.max(0, mph + (rng() - 0.5) * Math.min(6, mph)) : 0,
        }
        if (active[i]) d -= step
      }
      return {
        assetId: a.id,
        name: a.name,
        type: a.type,
        color: (a.metadata?.color as string | undefined) || TRAIL_PALETTE[hashId(a.id) % TRAIL_PALETTE.length],
        points: pathPts,
      }
    }

    // Smooth random walk backward from the live position: velocity has momentum
    // (gentle curves, not jagged steps) and is softly pulled back toward the
    // anchor. While PARKED the position is held exactly, so the asset reads as
    // "not moving" on the activity chart and its trail simply pauses.
    const pts: TrackPoint[] = new Array(N_POINTS)
    let lng = endLng
    let lat = endLat
    let vLng = 0
    let vLat = 0
    for (let i = N_POINTS - 1; i >= 0; i--) {
      pts[i] = { lng, lat, t: i / (N_POINTS - 1) }
      if (active[i]) {
        vLng = vLng * 0.82 + (rng() - 0.5) * amp * 0.45
        vLat = vLat * 0.82 + (rng() - 0.5) * amp * 0.45
        lng -= vLng
        lat -= vLat
        lng += (endLng - lng) * 0.02
        lat += (endLat - lat) * 0.02
        // Never wander off the demo stage (the black Property Boundary) —
        // pre-clamp walks sent people/tools across the river & across town.
        lng = Math.min(DEMO_BOUNDS.east, Math.max(DEMO_BOUNDS.west, lng))
        lat = Math.min(DEMO_BOUNDS.north, Math.max(DEMO_BOUNDS.south, lat))
      } else {
        vLng = 0
        vLat = 0
      }
    }

    return {
      assetId: a.id,
      name: a.name,
      type: a.type,
      color: (a.metadata?.color as string | undefined) || TRAIL_PALETTE[hashId(a.id) % TRAIL_PALETTE.length],
      points: pts,
    }
  })
}

/**
 * Union two row sets, de-duped on (asset, timestamp), oldest-first.
 *
 * The map holds two sources for any window: the snapshot shipped with the page
 * (capped and newest-biased) and the window's own /api/history fetch. Taking
 * only the fetch meant a range could visibly LOSE points the client already
 * had — the "30 days shows less than 7 days" class of bug. Merging makes the
 * rendered set monotonic: whatever a range showed, a wider range still shows.
 */
export function mergeHistoryRows<T extends { asset_id: string; timestamp: string }>(
  a: T[],
  b: T[]
): T[] {
  const seen = new Set<string>()
  const out: T[] = []
  for (const r of a) { const k = `${r.asset_id}|${r.timestamp}`; if (!seen.has(k)) { seen.add(k); out.push(r) } }
  for (const r of b) { const k = `${r.asset_id}|${r.timestamp}`; if (!seen.has(k)) { seen.add(k); out.push(r) } }
  out.sort((x, y) => x.timestamp.localeCompare(y.timestamp))
  return out
}

/**
 * Build tracks from REAL location history (see getLocationHistory). Points are
 * normalized fleet-wide across the fetched window (first→last timestamp) so
 * playback heads move in sync. Assets with no history get an empty track —
 * an honest "no movement recorded" rather than a fabricated walk.
 */
export function tracksFromHistory(
  assets: AssetWithLocation[],
  rows: { asset_id: string; lat: number; lng: number; speed?: number | null; timestamp: string }[],
  windowFromMs?: number,
  windowToMs?: number,
  toolRows?: { asset_id: string; lat: number; lng: number; speed?: number | null; timestamp: string }[]
): AssetTrack[] {
  const MAX_POINTS_PER_ASSET = 3000

  let minTs = Infinity
  let maxTs = -Infinity
  const byAsset = new Map<string, { lng: number; lat: number; ms: number; mph?: number }[]>()
  for (const r of rows) {
    const ms = new Date(r.timestamp).getTime()
    if (!Number.isFinite(ms)) continue
    if (ms < minTs) minTs = ms
    if (ms > maxTs) maxTs = ms
    let list = byAsset.get(r.asset_id)
    if (!list) byAsset.set(r.asset_id, (list = []))
    list.push({ lng: r.lng, lat: r.lat, ms, mph: typeof r.speed === 'number' ? r.speed : undefined })
  }
  // Tool paths come pre-synthesized from pairing episodes (synthesizeToolRows)
  // in their OWN bucket — they never widen the fleet window (they're clones
  // of carrier rows already counted above).
  const byTool = new Map<string, { lng: number; lat: number; ms: number; mph?: number }[]>()
  for (const r of toolRows ?? []) {
    const ms = new Date(r.timestamp).getTime()
    if (!Number.isFinite(ms)) continue
    let list = byTool.get(r.asset_id)
    if (!list) byTool.set(r.asset_id, (list = []))
    list.push({ lng: r.lng, lat: r.lat, ms, mph: typeof r.speed === 'number' ? r.speed : undefined })
  }
  // Explicit window (e.g. a local calendar day) wins over the data extent so
  // the scrubber axis runs midnight → midnight, not first-ping → last-ping.
  if (windowFromMs != null) minTs = windowFromMs
  const span = Math.max(1, (windowToMs ?? maxTs) - minTs) // avoid /0 on single ts

  const GAP_MS = 15 * 60_000

  // Tools have no GPS of their own — any asset_locations rows they carry are
  // seed/demo residue, and turning those into trails pinned Tool A/B to the
  // old Nashville demo site in every replay mode (Jul 14). Their replay path
  // comes ONLY from `toolRows` (the carrier's path during pairing episodes);
  // tools with no episodes in the window get no track at all.
  return assets.filter((a) => a.type !== 'tool' || (byTool.get(a.id)?.length ?? 0) > 0).map((a) => {
    let raw = ((a.type === 'tool' ? byTool.get(a.id) : byAsset.get(a.id)) ?? []).sort((x, y) => x.ms - y.ms)
    // No fixes in this window but the asset HAS a live position → pin it
    // there for the whole window. Without this, empty tracks fell through
    // positionAt's demo-center fallback and replay heads rendered parked
    // trucks in NASHVILLE (Bryson's vacationing Ram, Jul 21).
    if (raw.length === 0 && a.location) {
      raw = [{ lng: a.location.lng, lat: a.location.lat, ms: minTs, mph: 0 }]
    }
    // Curve-preserving thinning (DP) — the old every-Nth stride here was the
    // second half of the corner-cutting trails bug (server thinning was the
    // first). Straightaways compress, bends survive.
    const thinned = raw.length > MAX_POINTS_PER_ASSET ? simplifyPoints(raw, 10, MAX_POINTS_PER_ASSET) : raw
    const points: TrackPoint[] =
      thinned.length === 1
        ? [ // single fix: pin the head there across the whole playback window
            { lng: thinned[0].lng, lat: thinned[0].lat, t: 0 },
            { lng: thinned[0].lng, lat: thinned[0].lat, t: 1 },
          ]
        : thinned.map((p, i) => ({
            lng: p.lng,
            lat: p.lat,
            t: (p.ms - minTs) / span,
            gap: i > 0 && p.ms - thinned[i - 1].ms > GAP_MS ? true : undefined,
            mph: p.mph,
          }))

    return {
      assetId: a.id,
      name: a.name,
      type: a.type,
      color: (a.metadata?.color as string | undefined) || TRAIL_PALETTE[hashId(a.id) % TRAIL_PALETTE.length],
      points,
    }
  })
}

/** Epoch-ms window real tracks were normalized over (t=0 → from, t=1 → to). */
export interface TrackWindow {
  from: number
  to: number
}

/** Window spanned by real history rows, for truthful scrubber labels. */
export function historyWindow(rows: { timestamp: string }[]): TrackWindow | null {
  let from = Infinity
  let to = -Infinity
  for (const r of rows) {
    const ms = new Date(r.timestamp).getTime()
    if (!Number.isFinite(ms)) continue
    if (ms < from) from = ms
    if (ms > to) to = ms
  }
  return to > from ? { from, to } : null
}

/** Short tick label inside a real window: clock time for ≤36h spans, else date. */
/** "12A" / "7:30P" — the one-line clock (Brian, Aug 25: "12P etc"). */
function compactClock(d: Date, tz?: string): string {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: 'numeric', minute: '2-digit', hour12: true }).formatToParts(d)
  const h = parts.find((p) => p.type === 'hour')?.value ?? ''
  const m = parts.find((p) => p.type === 'minute')?.value ?? '00'
  const ap = (parts.find((p) => p.type === 'dayPeriod')?.value ?? 'AM').startsWith('A') ? 'A' : 'P'
  return m === '00' ? `${h}${ap}` : `${h}:${m}${ap}`
}

/** Compact single-line scrubber tick: hour scale shows "12A · 6A · 12P" with
 *  the FIRST tick carrying the date ("8/23"); a few days out ticks read
 *  "8/19 4P"; anything longer is "8/19" — month always visible as the span
 *  grows (Brian, Aug 25). */
export function compactTick(ms: number, spanMs: number, isFirst: boolean, tz?: string): string {
  const d = new Date(ms)
  const md = d.toLocaleDateString('en-US', { timeZone: tz, month: 'numeric', day: 'numeric' })
  if (spanMs <= 36 * 3_600_000) return isFirst ? md : compactClock(d, tz)
  if (spanMs <= 5 * 86_400_000) return `${md} ${compactClock(d, tz)}`
  return md
}

export function windowTickLabel(w: TrackWindow, f: number, tz?: string): string {
  return compactTick(w.from + f * (w.to - w.from), w.to - w.from, f === 0, tz)
}

/** Scrubber ticks, one ladder per horizon (Brian, Aug 25: "clean, sexy,
 *  easy to comprehend quickly on each time frame"):
 *    ≤36h   →  8/23 · 6A · 12P · 6P · 12A   (date anchors the left edge)
 *    ≤8.5d  →  8/18 · T 19 · W 20 · T 21 …  (weekday letter + day, at true
 *                                            local midnights)
 *    ≤70d   →  8/1 · 8/9 · 8/16 …           (even spread, month/day)
 *    longer →  Jan · Mar · May …            (true month boundaries; Jan
 *                                            carries the year)
 *  Positions are fractions of the window — render absolutely, not
 *  justify-between, so labels sit where their moment actually is. */
export function tickMarks(fromMs: number, toMs: number, tz?: string): { f: number; label: string }[] {
  const span = toMs - fromMs
  const DAY = 86_400_000
  const out: { f: number; label: string }[] = []
  const md = (ms: number) => new Date(ms).toLocaleDateString('en-US', { timeZone: tz, month: 'numeric', day: 'numeric' })
  if (span <= 36 * 3_600_000) {
    for (const f of [0, 0.25, 0.5, 0.75, 1]) out.push({ f, label: compactTick(fromMs + f * span, span, f === 0, tz) })
    return out
  }
  if (span <= 8.5 * DAY) {
    out.push({ f: 0, label: md(fromMs) })
    // Local midnights via an hourly walk — accurate to the hour, which at
    // this span is a fraction of a pixel.
    const dayOf = (ms: number) => new Date(ms).toLocaleDateString('en-US', { timeZone: tz, day: 'numeric', month: 'numeric' })
    let prev = dayOf(fromMs)
    for (let ms = fromMs + 3_600_000; ms < toMs; ms += 3_600_000) {
      const cur = dayOf(ms)
      if (cur !== prev) {
        prev = cur
        const f = (ms - fromMs) / span
        if (f > 0.05 && f < 0.96) {
          const d = new Date(ms)
          const w = d.toLocaleDateString('en-US', { timeZone: tz, weekday: 'narrow' })
          const dom = d.toLocaleDateString('en-US', { timeZone: tz, day: 'numeric' })
          out.push({ f, label: `${w} ${dom}` })
        }
      }
    }
    return out
  }
  if (span <= 70 * DAY) {
    for (const f of [0, 0.25, 0.5, 0.75, 1]) out.push({ f, label: md(fromMs + f * span) })
    return out
  }
  // Month boundaries (daily walk), thinned to ≤7 ticks; January names the year.
  const monthOf = (ms: number) => new Date(ms).toLocaleDateString('en-US', { timeZone: tz, month: 'numeric', year: 'numeric' })
  const bounds: { f: number; ms: number }[] = []
  let prevM = monthOf(fromMs)
  for (let ms = fromMs + DAY; ms < toMs; ms += DAY) {
    const cur = monthOf(ms)
    if (cur !== prevM) { prevM = cur; bounds.push({ f: (ms - fromMs) / span, ms }) }
  }
  out.push({ f: 0, label: md(fromMs) })
  const stride = Math.max(1, Math.ceil(bounds.length / 6))
  for (let i = 0; i < bounds.length; i += stride) {
    const b = bounds[i]
    if (b.f <= 0.05 || b.f >= 0.97) continue
    const d = new Date(b.ms)
    const mon = d.toLocaleDateString('en-US', { timeZone: tz, month: 'short' })
    const isJan = d.toLocaleDateString('en-US', { timeZone: tz, month: 'numeric' }) === '1'
    out.push({ f: b.f, label: isJan ? `${mon} ’${d.toLocaleDateString('en-US', { timeZone: tz, year: '2-digit' })}` : mon })
  }
  return out
}

// How movement over the window is drawn — user-selectable on any time range.
// '3d' = hex activity terrain: prisms extruded by time-spent-per-cell.
export type TrailMode = 'off' | 'trails' | 'heatmap' | '3d'

// ── Timeline ranges ──────────────────────────────────────────────────────────
export type TimeRange = 'live' | 'today' | 'yesterday' | '7d' | '30d' | 'ytd' | 'all' | 'custom'

export const RANGES: { key: TimeRange; label: string }[] = [
  { key: 'live', label: 'Live' },
  { key: 'today', label: 'Today' },
  { key: 'yesterday', label: 'Yesterday' },
  { key: '7d', label: '7 days' },
  { key: '30d', label: '30 days' },
  { key: 'ytd', label: 'YTD' },
  { key: 'all', label: 'All time' },
]

/** Number of days a replay range spans (used to map t → a date). */
export function rangeSpanDays(range: TimeRange): number {
  switch (range) {
    case 'today':
    case 'yesterday': return 1
    case '7d': return 7
    case '30d': return 30
    case 'ytd': {
      const now = new Date()
      const jan1 = new Date(now.getFullYear(), 0, 1)
      return Math.max(1, Math.round((now.getTime() - jan1.getTime()) / 86_400_000))
    }
    case 'all': return 365
    default: return 1
  }
}

/** Real-world seconds spanned by a range — used to make playback speed a true
 *  real-time multiplier (so a year can be replayed as fast as a day). */
export function rangeWindowSeconds(range: TimeRange): number {
  if (range === 'today' || range === 'yesterday') return PLAYBACK_WINDOW_SECONDS // 12h workday
  return rangeSpanDays(range) * 86_400
}

/** Round to a "nice" 1/2/5×10ⁿ multiplier so the speed menu reads clean. */
export const niceSpeed = (x: number) => {
  const p = Math.pow(10, Math.floor(Math.log10(Math.max(1, x))))
  const m = x / p
  return Math.max(1, (m >= 7.5 ? 10 : m >= 3.5 ? 5 : m >= 1.5 ? 2 : 1) * p)
}

/** Speeds derived from the ACTUAL window length: four options that sweep the
 *  whole window in ~2 min / 45 s / 15 s / 5 s of wall-clock time. YTD stops
 *  crawling minute-by-minute, custom ranges scale automatically, and "All
 *  time" adapts to however much history really exists. */
export function speedsForWindow(windowSeconds: number): number[] {
  // True real-time crawl speeds first — 1x/2x/4x wall-clock. They exist for
  // Follow mode: the camera moves at road speed, so tiles stream in ahead of
  // it instead of the map chasing a blur (Brian's follow-loading fix, Jul 12).
  const out: number[] = [1, 2, 4]
  const targets = [120, 45, 15, 5]
  for (const t of targets) {
    const v = niceSpeed(windowSeconds / t)
    if (!out.includes(v)) out.push(v)
  }
  return out
}

/** Default = the ~45-second full sweep. */
export function defaultSpeedForWindow(windowSeconds: number): number {
  // Default lands mid-slider (geometric middle of the log range) — the old
  // second-slowest preset parked the thumb near the left edge (Brian, Aug 6).
  const s = speedsForWindow(windowSeconds)
  return niceSpeed(Math.sqrt(s[0] * s[s.length - 1]))
}

/** Speed options scale with the range — long windows need much bigger multipliers. */
export function speedsForRange(range: TimeRange): number[] {
  switch (range) {
    case 'today':
    case 'yesterday': return [60, 300, 1000, 5000]
    case '7d': return [500, 2000, 10_000, 50_000]
    case '30d': return [2000, 10_000, 50_000, 200_000]
    case 'ytd':
    case 'all': return [10_000, 100_000, 500_000, 1_000_000]
    case 'custom': return [500, 2000, 10_000, 50_000]
    default: return [60, 300, 1000]
  }
}

/** Days spanned by a custom From/To window (epoch ms), clamped to >= 1. */
export function customSpanDays(fromMs: number, toMs: number): number {
  return Math.max(1, Math.round((toMs - fromMs) / 86_400_000))
}

/** Date/time at scrub position t within a custom From/To window. */
export function customScrubLabel(fromMs: number, toMs: number, t: number, tz?: string): string {
  // Day-of-week + date + time, dot-separated — "Tue · Aug 12 · 3:45 PM".
  // The year only appears when it isn't this year (clean > complete;
  // Brian, Aug 12: "time as well as date and day-of on the longer frames").
  const ms = fromMs + t * (toMs - fromMs)
  const d = new Date(ms)
  const sameYear = d.getFullYear() === new Date().getFullYear()
  const day = d.toLocaleDateString([], { timeZone: tz, weekday: 'short' })
  const date = d.toLocaleDateString([], { timeZone: tz, month: 'short', day: 'numeric', ...(sameYear ? {} : { year: 'numeric' }) })
  const time = d.toLocaleTimeString([], { timeZone: tz, hour: 'numeric', minute: '2-digit' })
  return `${day} · ${date} · ${time}`
}

/** Short tick label at scrub position t within a custom window. */
export function customTickLabel(fromMs: number, toMs: number, t: number, tz?: string): string {
  return compactTick(fromMs + t * (toMs - fromMs), toMs - fromMs, t === 0, tz)
}

export function defaultSpeed(range: TimeRange): number {
  const s = speedsForRange(range)
  return s[Math.min(1, s.length - 1)]
}

export function formatSpeed(n: number): string {
  if (n >= 1_000_000) return n / 1_000_000 + 'M×'
  if (n >= 1_000) return n / 1_000 + 'k×'
  return n + '×'
}

/** Full, human-readable date/time for the current scrub position. */
export function scrubLabel(range: TimeRange, t: number): string {
  if (range === 'live') return 'Live'
  if (range === 'today') return 'Today · ' + clockLabel(t)
  if (range === 'yesterday') return 'Yesterday · ' + clockLabel(t)
  const ms = Date.now() - (1 - t) * rangeSpanDays(range) * 86_400_000
  const d = new Date(ms)
  return d.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' }) +
    ' · ' + d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
}

/** Human label for the scrubber position within a range — compact, one
 *  line ("6A", "12P"), matching the real-window tick style. */
export function rangeLabel(range: TimeRange, t: number): string {
  if (range === 'live') return 'LIVE'
  if (range === 'today' || range === 'yesterday') {
    return clockLabel(t).replace(/(\d+):00 ([AP])M/, '$1$2').replace(/:(\d\d) ([AP])M/, ':$1$2')
  }
  const ms = Date.now() - (1 - t) * rangeSpanDays(range) * 86_400_000
  return new Date(ms).toLocaleDateString('en-US', { month: 'numeric', day: 'numeric' })
}

/** Interpolated [lng, lat] position at normalized time t. */
export function positionAt(track: AssetTrack, t: number): [number, number] {
  const pts = track.points
  if (pts.length === 0) return DEMO_MAP_CENTER
  if (t <= pts[0].t) return [pts[0].lng, pts[0].lat]
  if (t >= pts[pts.length - 1].t) return [pts[pts.length - 1].lng, pts[pts.length - 1].lat]

  // Interpolate by TIME, not array index. Real telemetry is wildly uneven
  // (1/sec driving, 1/hour asleep) — index-based lerp made the playback head
  // glide across town at 3 AM and pinned wrong clock times to positions.
  let lo = 0
  let hi = pts.length - 1
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1
    if (pts[mid].t <= t) lo = mid
    else hi = mid
  }
  const a = pts[lo]
  const b = pts[hi]
  // Across a data gap the asset's position is unknown — hold the last fix
  // (park it) instead of inventing a slow drift along the chord.
  if (b.gap) return [a.lng, a.lat]
  const span = b.t - a.t
  const frac = span > 0 ? (t - a.t) / span : 0
  return [a.lng + (b.lng - a.lng) * frac, a.lat + (b.lat - a.lat) * frac]
}

/** Trail split into segments at data gaps — no chords across sleep periods. */
export function trailSegmentsUpTo(track: AssetTrack, t: number): [number, number][][] {
  const segments: [number, number][][] = []
  let current: [number, number][] = []
  for (const p of track.points) {
    if (p.t > t) break
    if (p.gap && current.length) {
      segments.push(current)
      current = []
    }
    current.push([p.lng, p.lat])
  }
  // Head position (time-correct; snaps across gaps, so this never invents
  // a mid-gap coordinate).
  current.push(positionAt(track, t))
  segments.push(current)
  return segments.filter((seg) => seg.length >= 2)
}

/**
 * Like trailSegmentsUpTo, but split into AGE BANDS so the map can dim the
 * older stretch of a trail and keep the newest at full strength — the
 * command-wall look, everywhere (Brian, Aug 22: "older trail more dim").
 * Bands are fractions of the visible window [0, t]; adjacent bands share
 * their boundary point so the line never shows a seam, and gaps still
 * break lines instead of drawing chords across town.
 */
export function trailSegmentsBanded(
  track: AssetTrack,
  t: number,
  fades: number[] = [0.25, 0.45, 0.7, 1]
): { fade: number; segments: [number, number][][] }[] {
  const n = fades.length
  const bands = fades.map((fade) => ({ fade, segments: [] as [number, number][][], current: [] as [number, number][] }))
  const bandOf = (pt: number) => Math.min(n - 1, Math.max(0, Math.floor((t > 0 ? pt / t : 1) * n)))
  let prevBand: number | null = null
  for (const p of track.points) {
    if (p.t > t) break
    const b = bandOf(p.t)
    if (p.gap) {
      for (const bd of bands) { if (bd.current.length) { bd.segments.push(bd.current); bd.current = [] } }
      prevBand = null
    } else if (prevBand !== null && b !== prevBand) {
      // Band handoff: the older band's line ends AT this point, the newer
      // band's line starts here too — continuous ink, stepped opacity.
      bands[prevBand].current.push([p.lng, p.lat])
      bands[prevBand].segments.push(bands[prevBand].current)
      bands[prevBand].current = []
    }
    bands[b].current.push([p.lng, p.lat])
    prevBand = b
  }
  // Head position continues the LAST point's band — pushing it into the
  // newest band left a lone filtered point when the last fix landed in an
  // older band, visibly detaching the head from its trail while scrubbing
  // early in a long window (ship-check P2).
  if (prevBand !== null) bands[prevBand].current.push(positionAt(track, t))
  for (const bd of bands) { if (bd.current.length) bd.segments.push(bd.current) }
  return bands.map(({ fade, segments }) => ({ fade, segments: segments.filter((s) => s.length >= 2) }))
}

// ── Speed-colored trails (Brian, Aug 23) ────────────────────────────────────
// Same segment-building rules as the age bands (gaps break the line, class
// handoffs share the boundary point) but bucketed by SPEED instead of age.
// Eight classes on THE APP'S ramp (Brian, Aug 24: "more colors, match
// conventions") — the same quiet-blue → teal → amber → red scale the
// activity bar and heat legend use, sampled at each bucket's midpoint.
export const SPEED_CLASS_MPH = [5, 15, 25, 35, 45, 55, 65]
export const SPEED_CLASS_COLORS = ['#173f63', '#2dd4bf', '#72c287', '#a7b55e', '#dda733', '#ff9e16', '#fd8136', '#fb5d5d']
export const SPEED_CLASS_LABELS = ['under 5 mph', '5–15 mph', '15–25 mph', '25–35 mph', '35–45 mph', '45–55 mph', '55–65 mph', '65+ mph']

const EARTH_M = 6_371_000
function metersBetween(a: [number, number], b: [number, number]): number {
  const dLat = ((b[1] - a[1]) * Math.PI) / 180
  const dLng = ((b[0] - a[0]) * Math.PI) / 180
  const la1 = (a[1] * Math.PI) / 180
  const la2 = (b[1] * Math.PI) / 180
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLng / 2) ** 2
  return 2 * EARTH_M * Math.asin(Math.min(1, Math.sqrt(h)))
}

export function trailSegmentsSpeed(
  track: AssetTrack,
  t: number,
  windowSeconds: number
): { cls: number; segments: [number, number][][] }[] {
  const n = SPEED_CLASS_MPH.length + 1
  const buckets = Array.from({ length: n }, () => ({ segments: [] as [number, number][][], current: [] as [number, number][] }))
  const classOf = (mph: number) => {
    for (let i = 0; i < SPEED_CLASS_MPH.length; i++) if (mph < SPEED_CLASS_MPH[i]) return i
    return n - 1
  }
  let prev: TrackPoint | null = null
  let prevCls: number | null = null
  for (const p of track.points) {
    if (p.t > t) break
    if (p.gap || !prev) {
      for (const b of buckets) { if (b.current.length) { b.segments.push(b.current); b.current = [] } }
      prev = p
      prevCls = null
      continue
    }
    // Segment speed: the fix's reported mph when the tracker sent one;
    // otherwise derived from distance / elapsed (demo tracks + old rows).
    const dtSec = Math.max(1, (p.t - prev.t) * windowSeconds)
    const mph = p.mph ?? (metersBetween([prev.lng, prev.lat], [p.lng, p.lat]) / dtSec) * 2.23694
    const cls = classOf(mph)
    if (prevCls !== null && cls !== prevCls) {
      // Class handoff shares the boundary point — continuous ink, new color.
      buckets[prevCls].current.push([prev.lng, prev.lat])
      buckets[prevCls].segments.push(buckets[prevCls].current)
      buckets[prevCls].current = []
    }
    if (!buckets[cls].current.length) buckets[cls].current.push([prev.lng, prev.lat])
    buckets[cls].current.push([p.lng, p.lat])
    prev = p
    prevCls = cls
  }
  // Head leg attaches even when the newest fix ≤ t was a wake-up (gap) point
  // — prevCls is null there, so seed a crawl-class segment from that fix.
  // Without this, sleeping assets (every fix a gap) drew NO ink in Speed
  // mode and the head detached after any 15-min stop (ship-check P2).
  if (prev) {
    const cls = prevCls ?? 0
    if (!buckets[cls].current.length) buckets[cls].current.push([prev.lng, prev.lat])
    buckets[cls].current.push(positionAt(track, t))
  }
  for (const b of buckets) { if (b.current.length) b.segments.push(b.current) }
  return buckets.map((b, cls) => ({ cls, segments: b.segments.filter((s) => s.length >= 2) }))
}

/** Trail polyline coordinates from the start of the window up to time t. */
export function trailUpTo(track: AssetTrack, t: number): [number, number][] {
  const coords: [number, number][] = []
  for (const p of track.points) {
    if (p.t <= t) coords.push([p.lng, p.lat])
    else break
  }
  coords.push(positionAt(track, t))
  return coords
}
