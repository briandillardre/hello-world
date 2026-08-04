/**
 * Fleet scorecard — the "who's actually using the company truck" math.
 *
 * Turns raw GPS rows into per-vehicle daily rhythm (first move, first
 * on-site, last move), work split (active/idle/miles), after-hours use, and
 * a classified stop mix (fuel, food, stores, residences…). Pure functions;
 * the page decides presentation. Times are computed in the COMPANY's
 * timezone — a 7:02 AM first-move must mean 7:02 on the wall clock at the
 * yard, not UTC (Vercel renders in UTC; same trap as the site log, Jul 14).
 */

import { pointInPolygon } from './alerts-engine'
import { segmentStops, type PoiKind } from './poi'

export interface ScoreRow {
  lat: number
  lng: number
  speed: number | null
  ignition?: boolean | null
  timestamp: string
}

export interface DayRhythm {
  /** YYYY-MM-DD in company tz. */
  day: string
  firstMoveMin: number | null   // minutes since local midnight
  firstOnSiteMin: number | null
  lastMoveMin: number | null
  activeMin: number
  idleMin: number
  miles: number
  afterHoursMiles: number
  afterHoursMovingMin: number
  workday: boolean
}

export interface StopMix {
  kind: PoiKind
  count: number
  minutes: number
  /** Minutes of this kind that fell INSIDE working hours — the accountability
   *  lens: lunch is normal, 90 min at a store mid-shift is a conversation. */
  workMinutes: number
  /** Longest single example, for the tooltip/story. */
  topName: string
  topMinutes: number
}

export interface VehicleScore {
  assetId: string
  name: string
  daysActive: number
  daysInRange: number
  /** Medians across active days, minutes since local midnight. */
  medFirstMove: number | null
  medFirstOnSite: number | null
  medLastMove: number | null
  activeHrs: number
  idleHrs: number
  idlePct: number
  miles: number
  afterHoursMiles: number
  afterHoursHrs: number
  weekendMiles: number
  days: DayRhythm[]
  stops: StopMix[]
  /** Time present per company zone (drives usage billing — see Accounting). */
  siteHours: { id: string; name: string; hours: number }[]
  /** Vendor-zone runs (TEC, Gossett, Northern Tool…) — work errands, never
   *  job time. Deterministic names; feeds the procurement-waste read. */
  vendorRuns?: { id: string; name: string; visits: number; minutes: number }[]
  /** Raw non-zone stops still needing a name (page classifies top N). */
  pendingStops: { lat: number; lng: number; minutes: number; fromMs: number; inWorkHours: boolean }[]
  /** Driver-safety read from the speed stream (Samsara-lane, no dashcam).
   *  null/absent = not enough driving in range to grade honestly. */
  safety?: {
    score: number
    grade: 'A' | 'B' | 'C' | 'D' | 'F'
    maxMph: number
    /** Shares of MOVING time, 0–1. */
    over70Pct: number
    over80Pct: number
    /** Moving minutes between 10 PM and 4 AM local. */
    nightMin: number
  } | null
}

/** Zone ring with identity, so site time can be attributed BY zone. */
export interface ScoreRing { id: string; name: string; ring: [number, number][] }

const MOVING_MPH = 2

interface LocalTime { day: string; minutes: number; weekday: number }

/** Wall-clock parts of an instant in a tz, without a date library. */
function localParts(ms: number, tz: string): LocalTime {
  const d = new Date(ms)
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false, weekday: 'short',
  })
  const parts = Object.fromEntries(fmt.formatToParts(d).map((p) => [p.type, p.value]))
  const weekdays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
  return {
    day: `${parts.year}-${parts.month}-${parts.day}`,
    minutes: Number(parts.hour === '24' ? 0 : parts.hour) * 60 + Number(parts.minute),
    weekday: weekdays.indexOf(String(parts.weekday).slice(0, 3)),
  }
}

const toMin = (hhmm: string): number => {
  const [h, m] = hhmm.split(':').map(Number)
  return (h || 0) * 60 + (m || 0)
}

function median(xs: number[]): number | null {
  if (!xs.length) return null
  const s = [...xs].sort((a, b) => a - b)
  return s[Math.floor(s.length / 2)]
}

const kx = (lat: number) => 111_320 * Math.cos((lat * Math.PI) / 180)
function metersBetween(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  return Math.hypot((b.lng - a.lng) * kx(a.lat), (b.lat - a.lat) * 110_540)
}

/**
 * Score one vehicle's rows over the range.
 * rows must be chronological; rings are the company's zone polygons.
 */
export function scoreVehicle(
  assetId: string,
  name: string,
  rows: ScoreRow[],
  rings: ScoreRing[],
  opts: { tz: string; workStart: string; workEnd: string; workDays: number[]; fromMs: number; toMs: number; vendorRings?: ScoreRing[] }
): VehicleScore {
  const vendorRings = opts.vendorRings ?? []
  const ws = toMin(opts.workStart)
  const we = toMin(opts.workEnd)
  const isWorkday = (weekday: number) => opts.workDays.includes(weekday)
  const inWork = (lt: LocalTime) => isWorkday(lt.weekday) && lt.minutes >= ws && lt.minutes < we

  const pts = rows
    .map((r) => ({ ...r, ms: Date.parse(r.timestamp) }))
    .filter((p) => Number.isFinite(p.ms))
    .sort((a, b) => a.ms - b.ms)

  const byDay = new Map<string, DayRhythm>()
  const dayOf = (lt: LocalTime): DayRhythm => {
    let d = byDay.get(lt.day)
    if (!d) {
      d = { day: lt.day, firstMoveMin: null, firstOnSiteMin: null, lastMoveMin: null,
            activeMin: 0, idleMin: 0, miles: 0, afterHoursMiles: 0, afterHoursMovingMin: 0,
            workday: isWorkday(lt.weekday) }
      byDay.set(lt.day, d)
    }
    return d
  }

  const siteMin = new Map<string, number>()
  // Safety accumulators — shares of moving time, not ping counts, so a
  // fast-reporting tracker doesn't look "more dangerous" than a slow one.
  let movingMin = 0, over70Min = 0, over80Min = 0, nightMovingMin = 0, maxMph = 0
  let prev: (ScoreRow & { ms: number }) | null = null
  for (const p of pts) {
    const lt = localParts(p.ms, opts.tz)
    const d = dayOf(lt)
    const moving = (p.speed ?? 0) >= MOVING_MPH
    // Engine time when the tracker says so; movement is the fallback for
    // devices without ignition (matches the ignition-aware idle fix).
    const engineOn = p.ignition === true || (p.ignition == null && moving)
    const inRing = rings.find((r) => pointInPolygon([p.lng, p.lat], r.ring))

    if (moving) {
      if (d.firstMoveMin == null) d.firstMoveMin = lt.minutes
      d.lastMoveMin = lt.minutes
    }
    if (d.firstOnSiteMin == null && inRing) d.firstOnSiteMin = lt.minutes

    if (prev) {
      // Credit the elapsed interval to the CURRENT point's day/bucket; cap
      // gaps so an overnight check-in hole doesn't become 9 "active" hours.
      const gapMin = Math.min((p.ms - prev.ms) / 60_000, 30)
      if (gapMin > 0) {
        if (engineOn && moving) d.activeMin += gapMin
        else if (engineOn) d.idleMin += gapMin
        if (moving) {
          movingMin += gapMin
          const mph = p.speed ?? 0
          if (mph > maxMph && mph < 120) maxMph = mph // >120 on a work truck = GPS glitch
          if (mph >= 70) over70Min += gapMin
          if (mph >= 80) over80Min += gapMin
          if (lt.minutes >= 22 * 60 || lt.minutes < 4 * 60) nightMovingMin += gapMin
        }
        if (inRing) siteMin.set(inRing.id, (siteMin.get(inRing.id) ?? 0) + gapMin)
        const stepMiles = metersBetween(prev, p) / 1609.34
        if (stepMiles < 5) { // teleports (GPS glitch/tunnel) don't count
          d.miles += stepMiles
          if (!inWork(lt)) {
            d.afterHoursMiles += stepMiles
            if (moving) d.afterHoursMovingMin += gapMin
          }
        }
      }
    }
    prev = p
  }

  const days = Array.from(byDay.values()).sort((a, b) => a.day.localeCompare(b.day))
  const activeDays = days.filter((d) => (d.firstMoveMin != null))

  // Stops → mix (zone stops classify free as 'site'; the page geocodes the
  // longest non-zone stops and folds the rest into 'other').
  const raw = segmentStops(rows, opts.toMs, 500)
  const pendingStops: VehicleScore['pendingStops'] = []
  let siteCount = 0, siteStopMin = 0, siteWorkMin = 0
  let topSite = { name: '', minutes: 0 }
  // Vendor stops classify DETERMINISTICALLY from the drawn zone — no geocode
  // guessing, and they never reach pendingStops.
  const vendorAgg = new Map<string, { id: string; name: string; visits: number; minutes: number }>()
  let vendCount = 0, vendMin = 0, vendWorkMin = 0
  let topVend = { name: '', minutes: 0 }
  for (const s of raw) {
    const lt = localParts(s.fromMs, opts.tz)
    const inside = rings.find((r) => pointInPolygon([s.lng, s.lat], r.ring))
    if (inside) {
      siteCount++; siteStopMin += s.minutes
      if (inWork(lt)) siteWorkMin += s.minutes
      if (s.minutes > topSite.minutes) topSite = { name: inside.name, minutes: s.minutes }
      continue
    }
    const vend = vendorRings.find((r) => pointInPolygon([s.lng, s.lat], r.ring))
    if (vend) {
      const v = vendorAgg.get(vend.id) ?? { id: vend.id, name: vend.name, visits: 0, minutes: 0 }
      v.visits++; v.minutes += s.minutes
      vendorAgg.set(vend.id, v)
      vendCount++; vendMin += s.minutes
      if (inWork(lt)) vendWorkMin += s.minutes
      if (s.minutes > topVend.minutes) topVend = { name: vend.name, minutes: s.minutes }
      continue
    }
    pendingStops.push({ lat: s.lat, lng: s.lng, minutes: s.minutes, fromMs: s.fromMs, inWorkHours: inWork(lt) })
  }
  const stops: StopMix[] = [
    ...(siteCount
      ? [{ kind: 'site' as PoiKind, count: siteCount, minutes: siteStopMin, workMinutes: siteWorkMin, topName: topSite.name || 'your job sites', topMinutes: topSite.minutes }]
      : []),
    ...(vendCount
      ? [{ kind: 'supplier' as PoiKind, count: vendCount, minutes: vendMin, workMinutes: vendWorkMin, topName: topVend.name, topMinutes: topVend.minutes }]
      : []),
  ]

  const activeMin = days.reduce((s, d) => s + d.activeMin, 0)
  const idleMin = days.reduce((s, d) => s + d.idleMin, 0)
  const daysInRange = Math.max(1, Math.round((opts.toMs - opts.fromMs) / 86_400_000))

  return {
    assetId, name,
    daysActive: activeDays.length,
    daysInRange,
    medFirstMove: median(activeDays.map((d) => d.firstMoveMin!).filter((x) => x != null)),
    medFirstOnSite: median(activeDays.map((d) => d.firstOnSiteMin!).filter((x): x is number => x != null)),
    medLastMove: median(activeDays.map((d) => d.lastMoveMin!).filter((x): x is number => x != null)),
    activeHrs: Math.round(activeMin / 6) / 10,
    idleHrs: Math.round(idleMin / 6) / 10,
    idlePct: activeMin + idleMin > 0 ? Math.round((idleMin / (activeMin + idleMin)) * 100) : 0,
    miles: Math.round(days.reduce((s, d) => s + d.miles, 0)),
    afterHoursMiles: Math.round(days.reduce((s, d) => s + d.afterHoursMiles, 0)),
    afterHoursHrs: Math.round(days.reduce((s, d) => s + d.afterHoursMovingMin, 0) / 6) / 10,
    weekendMiles: Math.round(days.filter((d) => !d.workday).reduce((s, d) => s + d.miles, 0)),
    days, stops,
    siteHours: rings
      .filter((r) => (siteMin.get(r.id) ?? 0) >= 3)
      .map((r) => ({ id: r.id, name: r.name, hours: Math.round(((siteMin.get(r.id) ?? 0) / 60) * 10) / 10 }))
      .sort((a, b) => b.hours - a.hours),
    vendorRuns: Array.from(vendorAgg.values()).sort((a, b) => b.minutes - a.minutes),
    pendingStops,
    safety: (() => {
      // Under half an hour of driving, a grade is noise — show nothing.
      if (movingMin < 30) return null
      const over70Pct = over70Min / movingMin
      const over80Pct = over80Min / movingMin
      const nightShare = nightMovingMin / movingMin
      // Explainable deductions, worst-first: sustained 80+ hurts most, then
      // 70+ share, a top-speed spike, then night exposure. Clamped 0–100.
      const score = Math.max(0, Math.min(100, Math.round(
        100
        - Math.min(45, over80Pct * 300)
        - Math.min(25, over70Pct * 100)
        - (maxMph > 85 ? Math.min(15, (maxMph - 85) * 1.5) : 0)
        - Math.min(15, nightShare * 60)
      )))
      const grade = score >= 90 ? 'A' : score >= 80 ? 'B' : score >= 70 ? 'C' : score >= 60 ? 'D' : 'F'
      return {
        score, grade: grade as 'A' | 'B' | 'C' | 'D' | 'F',
        maxMph: Math.round(maxMph),
        over70Pct: Math.round(over70Pct * 1000) / 1000,
        over80Pct: Math.round(over80Pct * 1000) / 1000,
        nightMin: Math.round(nightMovingMin),
      }
    })(),
  }
}

/** Fold classified stops into the mix (page calls after geocoding top N). */
export function foldStops(
  score: VehicleScore,
  classified: { kind: PoiKind; name: string; minutes: number; inWorkHours: boolean }[],
  unclassified: { minutes: number; inWorkHours: boolean }[]
): StopMix[] {
  const mix = new Map<PoiKind, StopMix>()
  for (const s of score.stops) mix.set(s.kind, { ...s })
  const add = (kind: PoiKind, name: string, minutes: number, inWork: boolean) => {
    const m = mix.get(kind) ?? { kind, count: 0, minutes: 0, workMinutes: 0, topName: name, topMinutes: 0 }
    m.count++
    m.minutes += minutes
    if (inWork) m.workMinutes += minutes
    if (minutes > m.topMinutes) { m.topMinutes = minutes; m.topName = name }
    mix.set(kind, m)
  }
  for (const c of classified) add(c.kind, c.name, c.minutes, c.inWorkHours)
  for (const u of unclassified) add('other', 'Stop', u.minutes, u.inWorkHours)
  // Fixed presentation order — identity by position + label, never hue alone.
  const ORDER: PoiKind[] = ['site', 'supplier', 'fuel', 'food', 'store', 'service', 'dealer', 'government', 'residence', 'other']
  return ORDER.map((k) => mix.get(k)).filter((x): x is StopMix => !!x && x.minutes > 0)
}

/** "7:02a" from minutes-since-midnight. */
export function fmtClock(min: number | null): string {
  if (min == null) return '—'
  const h24 = Math.floor(min / 60)
  const m = Math.round(min % 60)
  const h = h24 % 12 === 0 ? 12 : h24 % 12
  return `${h}:${String(m).padStart(2, '0')}${h24 < 12 ? 'a' : 'p'}`
}
