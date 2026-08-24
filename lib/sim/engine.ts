import type { FlespiMessage } from '../flespi'

/**
 * Showroom simulator engine (Brian, Aug 23). Generates flespi-shaped
 * messages for a simulated company's fleet so the ordinary ingest pipeline
 * does everything else — alerts, zone sessions, tool pairing, stops.
 *
 * Deterministic: positions are a pure function of (asset, local day, minute),
 * so the cron can catch up any missed window and always writes the same
 * points it would have written live. No state beyond the route cache.
 *
 * The plan follows the company's CURRENT zones by kind:
 *   yard   → where trucks sleep and the day starts/ends
 *   site   → where machines/people work and trucks visit
 *   vendor → where haulers run for material
 * Move a zone in the app and the next run routes to the new spot.
 */

export interface SimZone {
  id: string
  name: string
  kind: string | null
  /** Outer ring, [lng, lat][]. */
  ring: [number, number][]
}

export interface SimAsset {
  id: string
  name: string
  type: 'vehicle' | 'equipment' | 'personnel' | 'tool'
  tracker_id: string
  metadata: Record<string, unknown>
}

/** Road geometry between two points; from the OSRM cache or a fallback. */
export type RouteProvider = (from: [number, number], to: [number, number]) => { coords: [number, number][]; meters: number }

// ── small deterministic helpers ──────────────────────────────────────────────

function hashStr(s: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
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

const R_M = 6_371_000
export function metersBetweenPts(a: [number, number], b: [number, number]): number {
  const dLat = ((b[1] - a[1]) * Math.PI) / 180
  const dLng = ((b[0] - a[0]) * Math.PI) / 180
  const la1 = (a[1] * Math.PI) / 180
  const la2 = (b[1] * Math.PI) / 180
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLng / 2) ** 2
  return 2 * R_M * Math.asin(Math.min(1, Math.sqrt(h)))
}
function bearing(a: [number, number], b: [number, number]): number {
  const la1 = (a[1] * Math.PI) / 180
  const la2 = (b[1] * Math.PI) / 180
  const dLng = ((b[0] - a[0]) * Math.PI) / 180
  const y = Math.sin(dLng) * Math.cos(la2)
  const x = Math.cos(la1) * Math.sin(la2) - Math.sin(la1) * Math.cos(la2) * Math.cos(dLng)
  return (Math.round((Math.atan2(y, x) * 180) / Math.PI) + 360) % 360
}

export function centroid(ring: [number, number][]): [number, number] {
  const pts = ring.length > 1 && ring[0][0] === ring[ring.length - 1][0] && ring[0][1] === ring[ring.length - 1][1]
    ? ring.slice(0, -1) : ring
  const s = pts.reduce((acc, p) => [acc[0] + p[0], acc[1] + p[1]], [0, 0])
  return [s[0] / pts.length, s[1] / pts.length]
}

/** Straight-line fallback when OSRM is unavailable: gently bowed + jittered
 *  so it at least doesn't read as a ruler line. */
export function fallbackRoute(from: [number, number], to: [number, number]): { coords: [number, number][]; meters: number } {
  const rng = mulberry32(hashStr(`${from[0].toFixed(4)}${to[1].toFixed(4)}`))
  const n = 14
  const coords: [number, number][] = []
  // Perpendicular bow, ~8% of the leg length.
  const px = -(to[1] - from[1]) * 0.16
  const py = (to[0] - from[0]) * 0.16
  const bowDir = rng() < 0.5 ? -1 : 1
  for (let i = 0; i <= n; i++) {
    const f = i / n
    const arc = Math.sin(f * Math.PI) * bowDir
    coords.push([
      from[0] + (to[0] - from[0]) * f + px * arc * 0.5 + (rng() - 0.5) * 0.0004,
      from[1] + (to[1] - from[1]) * f + py * arc * 0.5 + (rng() - 0.5) * 0.0004,
    ])
  }
  coords[0] = from
  coords[n] = to
  let meters = 0
  for (let i = 1; i < coords.length; i++) meters += metersBetweenPts(coords[i - 1], coords[i])
  return { coords, meters }
}

function pointAlong(coords: [number, number][], cum: number[], meters: number): [number, number] {
  const total = cum[cum.length - 1]
  const d = Math.max(0, Math.min(total, meters))
  for (let i = 0; i < cum.length - 1; i++) {
    if (d <= cum[i + 1]) {
      const seg = cum[i + 1] - cum[i]
      const f = seg > 0 ? (d - cum[i]) / seg : 0
      return [coords[i][0] + (coords[i + 1][0] - coords[i][0]) * f, coords[i][1] + (coords[i + 1][1] - coords[i][1]) * f]
    }
  }
  return coords[coords.length - 1]
}

// ── day plans ────────────────────────────────────────────────────────────────

type Seg =
  | { kind: 'off'; fromMin: number; toMin: number; at: [number, number] }
  | { kind: 'idle'; fromMin: number; toMin: number; at: [number, number] }
  | { kind: 'drive'; fromMin: number; toMin: number; coords: [number, number][]; cum: number[]; mph: number }
  | { kind: 'work'; fromMin: number; toMin: number; path: [number, number][]; mph: number }

const MIN = 60_000

/** Serpentine work passes inside a zone: skewed parallel lanes across a box
 *  inscribed around the centroid — the same recorded-GPS look as the demo. */
function workPasses(ring: [number, number][], seed: number): [number, number][] {
  const rng = mulberry32(seed)
  const c = centroid(ring)
  const lngs = ring.map((p) => p[0])
  const lats = ring.map((p) => p[1])
  const halfW = (Math.max(...lngs) - Math.min(...lngs)) * 0.28
  const halfH = (Math.max(...lats) - Math.min(...lats)) * 0.28
  const skew = (rng() - 0.5) * 0.6
  const lanes = 5
  const path: [number, number][] = []
  for (let i = 0; i < lanes; i++) {
    const fy = -1 + (2 * i) / (lanes - 1)
    const a: [number, number] = [c[0] - halfW + fy * skew * halfW * 0.4, c[1] + fy * halfH]
    const b: [number, number] = [c[0] + halfW + fy * skew * halfW * 0.4, c[1] + fy * halfH + skew * halfH * 0.3]
    if (i % 2 === 0) path.push(a, b)
    else path.push(b, a)
  }
  return path
}

function cumOf(coords: [number, number][]): number[] {
  const cum = [0]
  for (let i = 1; i < coords.length; i++) cum.push(cum[i - 1] + metersBetweenPts(coords[i - 1], coords[i]))
  return cum
}

/** Build one local day's schedule (minutes 0-1440) for an asset. */
function dayPlan(
  asset: SimAsset,
  zones: { yard: SimZone | null; sites: SimZone[]; vendors: SimZone[] },
  route: RouteProvider,
  dayKey: string,
  workday: boolean
): Seg[] {
  const rng = mulberry32(hashStr(asset.id + dayKey))
  const sim = (asset.metadata?.sim ?? {}) as Record<string, unknown>
  const { yard, sites, vendors } = zones
  const yardC = yard ? centroid(yard.ring) : sites[0] ? centroid(sites[0].ring) : ([-82.4, 34.85] as [number, number])

  const segs: Seg[] = []
  const off = (fromMin: number, toMin: number, at: [number, number]) => segs.push({ kind: 'off', fromMin, toMin, at })
  const idle = (fromMin: number, toMin: number, at: [number, number]) => segs.push({ kind: 'idle', fromMin, toMin, at })
  const drive = (fromMin: number, a: [number, number], b: [number, number], mph: number): number => {
    const r = route(a, b)
    const durMin = Math.max(3, (r.meters / 1609.34 / mph) * 60)
    segs.push({ kind: 'drive', fromMin, toMin: fromMin + durMin, coords: r.coords, cum: cumOf(r.coords), mph })
    return fromMin + durMin
  }

  if (asset.type === 'vehicle') {
    if (!workday || sites.length === 0) { off(0, 1440, yardC); return segs }
    const role = String(sim.role ?? 'rounds')
    const siteA = centroid(sites[hashStr(asset.id) % sites.length].ring)
    const siteB = centroid(sites[(hashStr(asset.id) + 1) % sites.length].ring)
    const vendorC = vendors[0] ? centroid(vendors[0].ring) : null
    let t = 6 * 60 + 40 + Math.floor(rng() * 45) // depart 6:40-7:25
    off(0, t, yardC)
    if (role === 'hauler' && vendorC) {
      // Material runs: yard → site, then site ↔ vendor round trips all day.
      t = drive(t, yardC, siteA, 34)
      const trips = 3 + Math.floor(rng() * 3)
      let at = siteA
      for (let i = 0; i < trips; i++) {
        idle(t, t + 12 + rng() * 10, at) // load-out
        t = segs[segs.length - 1].toMin
        const dest = at === siteA ? vendorC : siteA
        t = drive(t, at, dest, 36)
        at = dest
        if (t > 15 * 60 + 30) break
      }
      if (at !== siteA) { idle(t, t + 10, at); t = drive(segs[segs.length - 1].toMin, at, siteA, 36) }
      idle(t, t + 15, siteA)
      t = drive(segs[segs.length - 1].toMin, siteA, yardC, 32)
    } else {
      // Supervisor rounds: site A → (vendor some days) → site B → lunch →
      // back to A → yard.
      t = drive(t, yardC, siteA, 33)
      idle(t, t + 45 + rng() * 40, siteA)
      t = segs[segs.length - 1].toMin
      if (vendorC && rng() < 0.4) {
        t = drive(t, siteA, vendorC, 35)
        idle(t, t + 9 + rng() * 8, vendorC)
        t = drive(segs[segs.length - 1].toMin, vendorC, siteB, 35)
      } else {
        t = drive(t, siteA, siteB, 34)
      }
      idle(t, t + 50 + rng() * 45, siteB)
      t = segs[segs.length - 1].toMin
      // lunch: engine off wherever they are
      off(t, t + 30 + rng() * 15, siteB)
      t = segs[segs.length - 1].toMin
      t = drive(t, siteB, siteA, 34)
      idle(t, t + 60 + rng() * 50, siteA)
      t = segs[segs.length - 1].toMin
      t = drive(t, siteA, yardC, 32)
    }
    off(t, 1440, yardC)
    return segs
  }

  if (asset.type === 'equipment') {
    const site = sites.length ? sites[Number(sim.zoneIdx ?? 0) % sites.length] : null
    const at = site ? centroid(site.ring) : yardC
    if (!workday || !site) { off(0, 1440, at); return segs }
    const start = 7 * 60 + 10 + Math.floor(rng() * 30)
    const end = 15 * 60 + 20 + Math.floor(rng() * 40)
    off(0, start, at)
    let t = start
    const path = workPasses(site.ring, hashStr(asset.id + dayKey))
    while (t < end) {
      const workFor = 35 + rng() * 50
      segs.push({ kind: 'work', fromMin: t, toMin: Math.min(end, t + workFor), path, mph: 2.5 + rng() * 1.5 })
      t = Math.min(end, t + workFor)
      if (t >= end) break
      const idleFor = 8 + rng() * 18
      idle(t, Math.min(end, t + idleFor), at)
      t = Math.min(end, t + idleFor)
    }
    off(end, 1440, at)
    return segs
  }

  // personnel: phone-style pings on site through the working day.
  const site = sites.length ? sites[Number(sim.zoneIdx ?? 0) % sites.length] : null
  const at = site ? centroid(site.ring) : yardC
  if (!workday || !site) { off(0, 1440, at); return segs }
  const start = 6 * 60 + 55 + Math.floor(rng() * 25)
  const end = 15 * 60 + 25 + Math.floor(rng() * 30)
  off(0, start, at)
  segs.push({ kind: 'work', fromMin: start, toMin: end, path: workPasses(site.ring, hashStr(asset.id)), mph: 1 })
  off(end, 1440, at)
  return segs
}

// ── message generation ───────────────────────────────────────────────────────

function segAt(segs: Seg[], min: number): Seg | null {
  for (const s of segs) if (min >= s.fromMin && min < s.toMin) return s
  return null
}

function posIn(seg: Seg, min: number, rng: () => number): { p: [number, number]; mph: number; head: number | null } {
  if (seg.kind === 'off' || seg.kind === 'idle') return { p: seg.at, mph: 0, head: null }
  if (seg.kind === 'drive') {
    const f = (min - seg.fromMin) / (seg.toMin - seg.fromMin)
    const total = seg.cum[seg.cum.length - 1]
    const p = pointAlong(seg.coords, seg.cum, f * total)
    const p2 = pointAlong(seg.coords, seg.cum, Math.min(total, f * total + 60))
    return { p, mph: Math.max(5, seg.mph + (rng() - 0.5) * 10), head: bearing(p, p2) }
  }
  // work passes loop over their path
  const cum = cumOf(seg.path)
  const total = cum[cum.length - 1] || 1
  const metersIn = ((min - seg.fromMin) * 60 * seg.mph) / 2.23694
  const p = pointAlong(seg.path, cum, metersIn % total)
  return { p, mph: seg.mph + (rng() - 0.5), head: null }
}

/** Local-time parts for an epoch ms in the company's tz. */
function localParts(ms: number, tz: string): { dayKey: string; minute: number; weekday: number } {
  const d = new Date(ms)
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false, weekday: 'short',
  })
  const parts = Object.fromEntries(fmt.formatToParts(d).map((p) => [p.type, p.value]))
  const wd = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(String(parts.weekday))
  return {
    dayKey: `${parts.year}-${parts.month}-${parts.day}`,
    minute: (Number(parts.hour) % 24) * 60 + Number(parts.minute),
    weekday: wd,
  }
}

/**
 * All messages the fleet "sent" in (fromMs, toMs]. Tools never message —
 * they ride as BLE beacons in their carrier's messages, exactly like real
 * tags, so pairing/inheritance runs the production code path.
 */
export function simulateWindow(
  assets: SimAsset[],
  zonesIn: SimZone[],
  route: RouteProvider,
  fromMs: number,
  toMs: number,
  tz = 'America/New_York',
  workDays: number[] = [1, 2, 3, 4, 5, 6]
): FlespiMessage[] {
  const zones = {
    yard: zonesIn.find((z) => z.kind === 'yard') ?? null,
    sites: zonesIn.filter((z) => !z.kind || z.kind === 'site'),
    vendors: zonesIn.filter((z) => z.kind === 'vendor'),
  }
  const tools = assets.filter((a) => a.type === 'tool')
  const carriers = new Map<string, SimAsset[]>()
  for (const tool of tools) {
    const carrier = String((tool.metadata?.sim as Record<string, unknown> | undefined)?.carrier ?? '')
    if (carrier) carriers.set(carrier, [...(carriers.get(carrier) ?? []), tool])
  }

  const out: FlespiMessage[] = []
  const planCache = new Map<string, Seg[]>()

  for (const asset of assets) {
    if (asset.type === 'tool') continue
    const jrng = mulberry32(hashStr(asset.id + 'jitter'))
    let ms = fromMs
    let lastEmit = 0
    while (ms <= toMs) {
      const lp = localParts(ms, tz)
      const planKey = `${asset.id}|${lp.dayKey}`
      let plan = planCache.get(planKey)
      if (!plan) {
        plan = dayPlan(asset, zones, route, lp.dayKey, workDays.includes(lp.weekday))
        planCache.set(planKey, plan)
      }
      const seg = segAt(plan, lp.minute)
      // Cadence by state: driving 1 min · idling/working 2 min · off hourly.
      const cadence = !seg || seg.kind === 'off' ? 60 * MIN : seg.kind === 'drive' ? MIN : 2 * MIN
      if (ms - lastEmit >= cadence) {
        const { p, mph, head } = seg ? posIn(seg, lp.minute, jrng) : { p: [0, 0] as [number, number], mph: 0, head: null }
        if (seg) {
          const moving = mph >= 2
          const engineOn = seg.kind === 'drive' || seg.kind === 'idle' || (seg.kind === 'work' && asset.type === 'equipment')
          const msg: FlespiMessage = {
            ident: asset.tracker_id,
            timestamp: Math.floor(ms / 1000),
            'position.latitude': p[1] + (moving ? (jrng() - 0.5) * 0.00008 : 0),
            'position.longitude': p[0] + (moving ? (jrng() - 0.5) * 0.00008 : 0),
            'position.speed': Math.round((mph / 0.621371) * 10) / 10, // km/h on the wire, like Teltonika
            'movement.status': moving,
            'battery.level': 60 + Math.round(jrng() * 35),
          }
          if (head != null) msg['position.direction'] = head
          if (asset.type !== 'personnel') {
            // Phones don't report ignition; trackers do.
            msg['engine.ignition.status'] = engineOn
            msg['obd.engine.rpm'] = engineOn ? (moving ? 1400 + Math.round(mph * 22) : 750) : 0
            msg['obd.fuel.level'] = Math.max(8, 92 - Math.round((lp.minute / 1440) * 30))
          }
          // Tools aboard: beacons ride the carrier's messages while it's awake.
          const riding = carriers.get(asset.tracker_id)
          if (riding && engineOn) {
            msg['ble.beacons'] = riding.map((tool) => ({
              id: tool.tracker_id,
              rssi: -55 - Math.round(jrng() * 20),
              battery: 55 + Math.round(jrng() * 40),
            }))
          }
          out.push(msg)
        }
        lastEmit = ms
      }
      ms += MIN
    }
  }
  out.sort((a, b) => (a.timestamp ?? 0) - (b.timestamp ?? 0))
  return out
}
