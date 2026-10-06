/**
 * Driver safety scores in demo mode (no env vars): plausible vehicle-days for
 * the demo fleet in lib/mock-data.ts, scored by the REAL math
 * (lib/driving-score.ts) — only the rows are invented. Deterministic (no RNG)
 * so the page is the same on every refresh and the store screenshots can
 * show it.
 *
 * Three road vehicles, three stories: the owner's pickup (clean, its
 * accelerometer on), the dump truck (accelerometer not on yet — harsh events
 * "not measured", a few GPS estimates for coaching, speeding at a site with a
 * 10 mph limit, a loose plug once), and the tri-axle that is worth a
 * conversation (hard stops, 75+ mph runs, a late Sunday run). Machines are
 * never scored. The demo is a public surface: no real names, trackers,
 * plates or people — "Crew lead" and "Operator" are the mock roster's labels.
 */
import { MOCK_ASSETS, MOCK_GEOFENCES, MOCK_PATHS, type MockPathPoint } from './mock-data'
import {
  byMonth, driverTotals, ENGINE_VERSION, eventWords, scoreTotals, sumDaily, vehicleClassOf,
  type DailyRow, type DrivingEvent, type EventKind, type Severity,
} from './driving-score'
import { addDaysKey, zonedMidnightMs } from './dates'
import { pointInPolygon } from './alerts-engine'
import type { SafetyDriver, SafetyEvent, SafetyMonth, SafetyOpts, SafetyReport, SafetyVehicle } from './db/driving'

export const DEMO_DRIVERS = [
  { id: 'demo-crew-lead', name: 'Crew lead' },
  { id: 'demo-operator', name: 'Operator' },
]

interface Persona {
  assetId: string
  /** Weekday miles / moving hours; Saturday is `sat` of a weekday. */
  miles: number
  hours: number
  sat: number
  accel: boolean
  /** Confirmed accelerometer events per 1,000 miles (or GPS estimates when the accelerometer is off). */
  brake: number
  brakeSevereShare: number
  launch: number
  corner: number
  /** Share of moving time in severe speeding (75/80+ runs) and over a site's limit. */
  maxSev: number
  /** An ordinary day's top speed (mph) — interstate at the posted 70 is not speeding. */
  top: number
  siteMod: number
  siteHeavy: number
  obd: number
  driver: string | null
}

const PERSONAS: Persona[] = [
  { assetId: 'asset-1', miles: 72, hours: 2.2, sat: 0.5, accel: true, brake: 0.8, brakeSevereShare: 0, launch: 0.4, corner: 0.5, maxSev: 0, top: 66, siteMod: 0, siteHeavy: 0, obd: 0.95, driver: null },
  { assetId: 'asset-6', miles: 48, hours: 1.9, sat: 0.4, accel: false, brake: 2.2, brakeSevereShare: 0.2, launch: 1.2, corner: 0, maxSev: 0, top: 57, siteMod: 0.012, siteHeavy: 0.002, obd: 0.6, driver: 'demo-operator' },
  { assetId: 'asset-10', miles: 64, hours: 2.1, sat: 0, accel: true, brake: 4.5, brakeSevereShare: 0.35, launch: 3, corner: 1.2, maxSev: 0.014, top: 66, siteMod: 0.004, siteHeavy: 0.002, obd: 0, driver: 'demo-crew-lead' },
]

const hash = (s: string) => { let h = 2166136261; for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619); return (h >>> 0) / 4294967296 }
const weekday = (key: string) => new Date(`${key}T12:00:00Z`).getUTCDay()
const pt = (p: MockPathPoint) => ({ lng: p[0], lat: p[1], mph: p[2] ?? 30 })

/** The demo's sites and yards (never the property boundary): harsh events
 *  and top-speed runs happen on the road between them, site speeding inside
 *  the one site with a posted limit (Maple St Grading, 10 mph). */
const ZONE_RINGS = MOCK_GEOFENCES
  .filter((z) => (z as { kind?: string }).kind !== 'boundary' && z.geometry?.type === 'Polygon')
  .map((z) => z.geometry.coordinates[0] as [number, number][])
const offSite = (q: { lng: number; lat: number }) => !ZONE_RINGS.some((r) => pointInPolygon([q.lng, q.lat], r))
const SITE_RING = (MOCK_GEOFENCES.find((z) => z.id === 'fence-2')?.geometry.coordinates[0] ?? []) as [number, number][]
const SITE_SPOT = SITE_RING.length
  ? { lng: SITE_RING.reduce((s, c) => s + c[0], 0) / SITE_RING.length, lat: SITE_RING.reduce((s, c) => s + c[1], 0) / SITE_RING.length, mph: 17 }
  : { lng: -86.7904, lat: 36.1612, mph: 17 }

type DemoRow = DailyRow & { asset_id: string }
type DemoEvent = DrivingEvent & { assetId: string; id: string }

/** Rows + events for [fromKey, toKey]. */
export function demoDriving(fromKey: string, toKey: string, tz: string): { rows: DemoRow[]; events: DemoEvent[] } {
  const rows: DemoRow[] = []
  const events: DemoEvent[] = []
  for (const p of PERSONAS) {
    const asset = MOCK_ASSETS.find((a) => a.id === p.assetId)
    const vclass = vehicleClassOf((asset?.metadata ?? null) as Record<string, unknown> | null)
    const path = (MOCK_PATHS[p.assetId] ?? []).map(pt)
    // The demo stage is compact: the shared artery runs through the sites,
    // so "the road" is the stretch of each route outside every zone.
    const roadAll = path.filter(offSite)
    const road = roadAll.length ? roadAll : path.length ? path : [{ lng: -86.7876, lat: 36.162, mph: 30 }]
    const fastest = road.reduce((m, q) => (q.mph > m.mph ? q : m), road[0])
    const acc: Record<string, number> = {}
    let n = 0
    for (let k = fromKey; k <= toKey; k = addDaysKey(k, 1)) {
      const dow = weekday(k)
      const j = hash(`${p.assetId}|${k}`)
      const lateSunday = p.assetId === 'asset-10' && dow === 0 && k >= addDaysKey(toKey, -13)
      const f = dow === 0 ? (lateSunday ? 0.8 : 0) : dow === 6 ? p.sat : 1
      // Parked days still check in hourly — the tracker is alive, uptime counts them.
      const miles = f ? Math.round(p.miles * f * (0.8 + 0.4 * j) * 10) / 10 : 0
      const movingS = f ? Math.round(p.hours * f * (0.85 + 0.3 * j) * 3600) : 0
      const nightS = lateSunday ? Math.round(movingS * 0.7) : 0
      const row: DemoRow = {
        asset_id: p.assetId, day: k, tz, vclass, miles, moving_s: movingS, engine_s: Math.round(movingS * 1.6), night_s: nightS,
        evening_s: lateSunday ? Math.round(movingS * 0.1) : 0, max_mph: f ? Math.round(p.top + j * 5) : 0,
        limit_miles: Math.round(miles * (p.siteMod + p.siteHeavy > 0 ? 0.06 : 0.02) * 100) / 100,
        zone_mod_s: Math.round(movingS * p.siteMod * (0.5 + j)), zone_heavy_s: Math.round(movingS * p.siteHeavy * (0.5 + j)),
        zone_sev_s: 0, max_sev_s: Math.round(movingS * p.maxSev * (0.5 + j)), zone_speed_n: 0, max_speed_n: 0,
        brake_mod: 0, brake_sev: 0, accel_mod: 0, accel_sev: 0, corner_mod: 0, corner_sev: 0,
        unconfirmed_n: 0, brake_est: 0, accel_est: 0, crashes: 0,
        fixes: Math.round(movingS / 3.5) + 24, obd_s: Math.round(movingS * p.obd), dense_s: Math.round(movingS * (p.accel ? 0.8 : 0.16)),
        gap_s: p.assetId === 'asset-6' && n % 9 === 4 ? 540 : 0, longest_gap_s: p.assetId === 'asset-6' && n % 9 === 4 ? 540 : 0,
        power_lost: p.assetId === 'asset-6' && k === addDaysKey(toKey, -11) ? 1 : 0, unplug_n: 0, jamming_n: 0, towing_n: 0,
        rejects_n: p.assetId === 'asset-10' && n % 47 === 3 ? 1 : 0, accel_on: p.accel, accel_seen: p.accel, drivers: {}, version: ENGINE_VERSION,
      }
      if (p.driver && movingS) {
        row.drivers[p.driver] = { s: movingS, mi: miles, ss: movingS, smi: miles, ns: nightS, zm: row.zone_mod_s, zh: row.zone_heavy_s, zs: row.max_sev_s }
      }
      const day0 = zonedMidnightMs(k, tz)
      const emit = (kind: EventKind, rate: number, severeShare = 0) => {
        if (!miles) return
        acc[kind] = (acc[kind] ?? 0) + (rate * miles) / 1000
        while (acc[kind] >= 1) {
          acc[kind] -= 1
          const i = events.length
          const site = kind === 'zone_speeding'
          const spot = site ? SITE_SPOT : road[(i * 7 + n) % road.length]
          const severe = hash(`${k}|${kind}|${i}`) < severeShare
          const at = day0 + (7.5 + 9 * hash(`${p.assetId}|${k}|${kind}|${i}`)) * 3_600_000
          const source = p.accel && !site ? 'device' : 'gps'
          const t = { harsh_brake: 0.32, harsh_accel: 0.28, harsh_corner: 0.35, crash: 1.5, max_speed: 0, zone_speeding: 0 }[kind] * (vclass === 'heavy' ? 0.68 : 1)
          const g = Math.round(t * (severe ? 1.6 : 1.12) * 100) / 100
          const sev: Severity = site ? (severe ? 'heavy' : 'moderate') : severe ? 'severe' : 'moderate'
          const zone = site ? MOCK_GEOFENCES.find((z) => z.id === 'fence-2') : undefined
          events.push({
            id: `demo-${p.assetId}-${k}-${kind}-${i}`, assetId: p.assetId, at: Math.round(at), kind, severity: sev, source,
            confirmed: source === 'device' ? hash(`${k}|${i}|c`) > 0.08 : null,
            value: site ? (severe ? 22 : 17) : g, speedMph: site ? (severe ? 22 : 17) : Math.round(Math.max(18, spot.mph + 4)),
            lat: spot.lat, lng: spot.lng, durationS: site ? (severe ? 66 : 74) : null,
            zoneId: zone?.id ?? null, limitMph: site ? 10 : null, personId: p.driver,
          })
          const e = events[events.length - 1]
          if (site) row.zone_speed_n++
          else if (source === 'gps') { if (kind === 'harsh_brake') row.brake_est++; else if (kind === 'harsh_accel') row.accel_est++ }
          else if (!e.confirmed) row.unconfirmed_n++
          else {
            const key = `${kind === 'harsh_brake' ? 'brake' : kind === 'harsh_accel' ? 'accel' : 'corner'}_${severe ? 'sev' : 'mod'}` as 'brake_mod'
            row[key]++
          }
        }
      }
      emit('harsh_brake', p.brake, p.brakeSevereShare)
      emit('harsh_accel', p.launch, 0.15)
      if (p.accel) emit('harsh_corner', p.corner, 0.1)
      if (p.siteMod + p.siteHeavy > 0) emit('zone_speeding', 3, 0.2)
      if (row.max_sev_s >= 20 && miles) {
        // A held run past the line (75 mph for this heavy truck): the day's top speed is that run's peak.
        row.max_mph = Math.max(row.max_mph, 76 + Math.round(hash(`${k}|top|${p.assetId}`) * 6))
        events.push({
          id: `demo-${p.assetId}-${k}-max`, assetId: p.assetId, at: Math.round(day0 + 15.2 * 3_600_000), kind: 'max_speed', severity: 'severe', source: 'gps',
          confirmed: null, value: row.max_mph, speedMph: row.max_mph, lat: fastest.lat, lng: fastest.lng, durationS: row.max_sev_s, personId: p.driver,
        })
        row.max_speed_n++
      }
      rows.push(row)
      n++
    }
  }
  return { rows, events }
}

/** The whole report in demo mode, from the same summing and scoring as live. */
export function demoSafety(opts: SafetyOpts & { days: number; fromKey: string; toKey: string; priorFrom: string }): SafetyReport {
  const { rows, events } = demoDriving(opts.withPrior ? opts.priorFrom : opts.fromKey, opts.toKey, opts.tz)
  const visible = new Set(opts.assets.map((a) => a.id))
  const personas = PERSONAS.filter((p) => visible.has(p.assetId))
  const mine = rows.filter((r) => visible.has(r.asset_id))
  const cur = mine.filter((r) => r.day >= opts.fromKey)
  const prior = mine.filter((r) => r.day < opts.fromKey)
  const fromMs = zonedMidnightMs(opts.fromKey, opts.tz)
  const curEvents = events.filter((e) => e.at >= fromMs && visible.has(e.assetId))
  const assetOf = (id: string) => MOCK_ASSETS.find((a) => a.id === id)

  const fleetTotals = sumDaily(cur, opts.days * Math.max(1, personas.length))
  const fleet = scoreTotals(fleetTotals)
  const fleetMean = fleet.credible ? fleet.raw : null
  const priorFleet = opts.withPrior ? scoreTotals(sumDaily(prior)) : null

  const vehicles: SafetyVehicle[] = personas.map((p) => {
    const a = assetOf(p.assetId)!
    const meta = (a.metadata ?? {}) as Record<string, unknown>
    const t = sumDaily(cur.filter((r) => r.asset_id === p.assetId), opts.days)
    const score = scoreTotals(t, { fleetMean })
    const before = opts.withPrior ? scoreTotals(sumDaily(prior.filter((r) => r.asset_id === p.assetId)), { fleetMean }) : null
    return {
      assetId: a.id, name: a.name, type: a.type, trackerKind: 'obd', vehicleClass: vehicleClassOf(meta), score, totals: t,
      trend: score.credible && before?.credible && score.score != null && before.score != null ? score.score - before.score : null,
      ident: { year: meta.year != null ? String(meta.year) : null, make: (meta.make as string) ?? null, model: (meta.model as string) ?? null, plate: null, vin: null },
    }
  })
  vehicles.sort((a, b) => (a.score.credible === b.score.credible ? (a.score.score ?? 0) - (b.score.score ?? 0) : a.score.credible ? -1 : 1))

  const drivers: SafetyDriver[] = opts.drivers === 'none' ? [] : DEMO_DRIVERS.map((d) => {
    const t = driverTotals(cur, curEvents, d.id)
    return { personId: d.id, name: d.name, score: scoreTotals(t, { fleetMean }), rodeMiles: t.rodeMiles, isSelf: false }
  }).filter((d) => d.score.miles > 0)

  const months: SafetyMonth[] = opts.withMonths
    ? Array.from(byMonth(cur).entries()).sort(([a], [b]) => a.localeCompare(b)).map(([month, list]) => {
        const t = sumDaily(list)
        return { month, totals: t, score: scoreTotals(t), vehicles: new Set(list.filter((r) => r.moving_s > 0).map((r) => r.asset_id)).size }
      })
    : []

  const limit = Math.max(0, Math.min(200, opts.eventLimit ?? 0))
  const zones = MOCK_GEOFENCES.filter((g) => g.kind !== 'boundary')
  const evs: SafetyEvent[] = curEvents
    .filter((e) => !opts.eventsFor || e.assetId === opts.eventsFor)
    .sort((a, b) => b.at - a.at).slice(0, limit)
    .map((e) => {
      const zone = zones.find((z) => pointInPolygon([e.lng, e.lat], z.geometry.coordinates[0] as [number, number][]))
      const zoneName = e.zoneId ? MOCK_GEOFENCES.find((z) => z.id === e.zoneId)?.name ?? null : null
      return {
        id: e.id, assetId: e.assetId, assetName: assetOf(e.assetId)?.name ?? 'Vehicle', at: e.at, kind: e.kind, severity: e.severity, source: e.source,
        confirmed: e.confirmed ?? null, value: e.value, speedMph: e.speedMph, durationS: e.durationS ?? null, limitMph: e.limitMph ?? null, zoneName,
        place: zone ? `at ${zone.name}` : 'on the haul road', lat: e.lat, lng: e.lng,
        personName: opts.drivers === 'none' ? null : DEMO_DRIVERS.find((d) => d.id === e.personId)?.name ?? null,
        words: eventWords(e, zoneName),
      }
    })

  return {
    ready: true, demo: true, days: opts.days, fromKey: opts.fromKey, toKey: opts.toKey,
    firstDay: mine.length ? mine.reduce((m, r) => (r.day < m ? r.day : m), mine[0].day) : null,
    fleet, fleetTotals,
    fleetTrend: fleet.credible && priorFleet?.credible && fleet.score != null && priorFleet.score != null ? fleet.score - priorFleet.score : null,
    vehicles, drivers, events: evs, months, builtAt: new Date().toISOString(),
  }
}
