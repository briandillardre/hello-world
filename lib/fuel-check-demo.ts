/**
 * Demo mode for /receipts/fuel: a plausible pilot three weeks in, built by
 * running the REAL checks (lib/fuel-check.ts) over synthetic evidence on the
 * demo stage (the Nashville grid, Blue Ridge Sitework's fictional fleet) —
 * so the public demo can only ever say what production would say. No real
 * names, cards, IMEIs or places: the stations are made-up points labelled
 * with public brand names, the cards are invented numbers.
 */
import {
  DEFAULT_SETTINGS, exceptionWrites, localToUtcMs, missingTelemetry, pilotMetrics, readStoredChecks, runFuelChecks, storedChecks,
  type CheckAsset, type CheckInput, type CheckKind, type FixRec, type GeoPrecision, type LatLng, type MetricException, type MetricTxn,
  type StopRec, type Verdict,
} from './fuel-check'
import { addDaysKey } from './dates'
import type { FuelSample } from './asset-stats'
import { MOCK_GEOFENCES } from './mock-data'
import type { FuelCardView, FuelExceptionView, FuelPilotView, FuelTxnView, FuelVehicleView } from './db/fuel-check'

const MIN = 60_000
const HOUR = 3_600_000
const ZONES = MOCK_GEOFENCES.map((g) => ({ id: g.id, name: g.name, kind: g.kind ?? 'site', ring: g.geometry.coordinates[0] as [number, number][] }))
const centre = (id: string): LatLng => {
  const ring = ZONES.find((z) => z.id === id)!.ring
  return { lat: ring.reduce((a, p) => a + p[1], 0) / ring.length, lng: ring.reduce((a, p) => a + p[0], 0) / ring.length }
}
const YARD = centre('fence-3')
const TOWER = centre('fence-1')

interface Station { point: LatLng; label: string; brand: string; precision: GeoPrecision }
const SHELL_CHARLOTTE: Station = { point: { lat: 36.1661, lng: -86.8001 }, label: 'Shell (Charlotte Ave)', brand: 'Shell', precision: 'exact' }
const SHELL_HWY70: Station = { point: { lat: 36.1712, lng: -86.8158 }, label: 'Shell (Hwy 70)', brand: 'Shell', precision: 'exact' }
const QT_WESTEND: Station = { point: { lat: 36.1544, lng: -86.8012 }, label: 'QuikTrip (West End Ave)', brand: 'QuikTrip', precision: 'exact' }
const PILOT_I40: Station = { point: { lat: 36.452, lng: -87.268 }, label: 'Pilot (I-24 exit 11)', brand: 'Pilot', precision: 'exact' }

const VEHICLES: (CheckAsset & { reportsFuel: boolean | null })[] = [
  { id: 'asset-6', name: 'RAM 3500 Dump', type: 'vehicle', hasTracker: true, tankGal: 32, fuelType: 'diesel', reportsFuelLevel: true, reportsIgnition: true, reportsFuel: true },
  { id: 'asset-10', name: 'Peterbilt 567 Tri-Axle', type: 'vehicle', hasTracker: true, tankGal: 150, fuelType: 'diesel', reportsFuelLevel: false, reportsIgnition: true, reportsFuel: false },
  { id: 'asset-1', name: 'Chevy 1500 — Owner', type: 'vehicle', hasTracker: true, tankGal: 26, fuelType: 'gas', reportsFuelLevel: true, reportsIgnition: true, reportsFuel: true },
  { id: 'asset-9', name: 'Takeuchi TB235 Mini-Ex', type: 'equipment', hasTracker: true, tankGal: null, fuelType: 'diesel', reportsFuelLevel: false, reportsIgnition: true, reportsFuel: false },
]
const V = (id: string) => VEHICLES.find((v) => v.id === id)!
const CARDS: Record<string, string | null> = { '0417': 'asset-6', '2290': 'asset-10', '7731': 'asset-1', '5512': null }

interface Spec {
  ago: number
  /** Minutes after local midnight; null = a bank line with no time. */
  at: number | null
  station: Station
  amount: number
  gallons?: number | null
  unitPrice?: number | null
  product?: 'diesel' | 'gas' | 'def' | null
  card: string
  /** The export's vehicle column picked a vehicle on the row itself. */
  rowAsset?: string
  /** Where the vehicle was: at the pump, at a point (before the purchase), or stopped elsewhere all day. */
  was: 'pump' | { at: LatLng; speed: number } | { stopsAt: LatLng[] }
  ran?: 'yes' | 'no'
  /** The gauge rose at the purchase (default: at the pump and it ran after). */
  filled?: boolean
  /** Which weekday it falls on: the routine never lands on a Sunday (the
   *  demo company works Mon–Sat); a few exceptions are pinned to one. */
  on?: 'workday' | 'saturday' | 'sunday'
  verdict?: Partial<Record<CheckKind, { v: Verdict; note: string; daysLater: number }>>
}

/** The card's holder, by role (the demo is public — no names), and their clock. */
const HOLDER: Record<string, { id: string; label: string } | undefined> = {
  '0417': { id: 'demo-driver-dump', label: 'Dump truck driver' },
  '2290': { id: 'demo-driver-tri', label: 'Tri-axle driver' },
}

/** Drive in at `fromPct`, stop, drive away at `toPct` (a vehicle's gauge reads on the move). */
function fillGauge(t: number, fromPct: number, toPct: number): FuelSample[] {
  const out: FuelSample[] = []
  let s = 3
  const jitter = () => { s = (s * 9301 + 49297) % 233280; return (s / 233280 - 0.5) * 10 }
  for (let m = t - 40 * MIN; m < t - 6 * MIN; m += 10_000) out.push({ ms: m, pct: Math.round(fromPct + jitter()), mph: 38 })
  for (let m = t + 8 * MIN; m < t + 50 * MIN; m += 10_000) out.push({ ms: m, pct: Math.round(toPct + jitter()), mph: 41 })
  return out
}

export function demoFuelPilot(todayKey: string, tz: string, nowMs = Date.now()): FuelPilotView {
  const settings = { ...DEFAULT_SETTINGS }
  const hours = { tz, workStart: '07:00', workEnd: '17:00', workDays: [1, 2, 3, 4, 5, 6] }
  const specs: Spec[] = []
  // The routine: the RAM fills on its fleet card two or three times a week at
  // 6–7 AM, the Peterbilt every four days, the owner's pickup on a bank card.
  for (let d = 2; d <= 40; d += 3) specs.push({ ago: d, at: 390 + (d % 4) * 9, station: d % 2 ? SHELL_CHARLOTTE : QT_WESTEND, amount: Math.round((21 + (d % 5)) * 3.49 * 100) / 100, gallons: 21 + (d % 5), unitPrice: 3.49, product: 'diesel', card: '0417', was: 'pump', ran: 'yes' })
  for (let d = 4; d <= 40; d += 4) specs.push({ ago: d, at: 410 + (d % 3) * 7, station: QT_WESTEND, amount: Math.round((96 + (d % 6) * 4) * 3.45 * 100) / 100, gallons: 96 + (d % 6) * 4, unitPrice: 3.45, product: 'diesel', card: '2290', was: 'pump', ran: 'yes' })
  for (let d = 6; d <= 40; d += 7) specs.push({ ago: d, at: null, station: SHELL_CHARLOTTE, amount: 58 + (d % 3) * 4.15, card: '7731', was: 'pump', ran: 'yes' })

  // The exceptions the first three weeks turned up.
  specs.push({ // the RAM's card used while the RAM sat on the Tower site — real
    ago: 12, at: 462, station: SHELL_CHARLOTTE, amount: 86.12, gallons: 24.6, unitPrice: 3.5, product: 'diesel', card: '0417',
    was: { at: TOWER, speed: 0 }, ran: 'yes',
    verdict: { asset_absent: { v: 'valid', note: 'Fuel went into a personal truck. Card reissued.', daysLater: 1 } },
  })
  specs.push({ // more diesel than a 150-gal tank holds — real
    ago: 9, at: 405, station: QT_WESTEND, amount: 627.9, gallons: 182, unitPrice: 3.45, product: 'diesel', card: '2290', was: 'pump', ran: 'yes',
    verdict: { gallons_exceed_tank: { v: 'valid', note: 'A second truck filled on the same card swipe.', daysLater: 2 } },
  })
  specs.push({ // the export had the station's billing address; the truck was at the Hwy 70 Shell — false alarm
    ago: 20, at: 401, station: SHELL_CHARLOTTE, amount: 80.27, gallons: 23, unitPrice: 3.49, product: 'diesel', card: '0417',
    was: { at: SHELL_HWY70.point, speed: 0 }, ran: 'yes', filled: true,
    verdict: { asset_absent: { v: 'false', note: 'Bought at the Shell on Hwy 70 — the export listed a different store.', daysLater: 1 } },
  })
  specs.push({ // jerry cans for the mini-ex — machines don't drive to the pump: false alarm
    ago: 16, at: null, station: QT_WESTEND, amount: 41.5, card: '5512', rowAsset: 'asset-9',
    was: { stopsAt: [centre('fence-2')] }, ran: 'yes',
    verdict: { asset_absent: { v: 'false', note: 'Jerry cans for the mini-ex.', daysLater: 3 } },
  })
  specs.push({ // Sunday afternoon on the dump truck's card — waiting on a verdict
    ago: 5, at: 14 * 60 + 15, station: QT_WESTEND, amount: 72.4, gallons: 20.7, unitPrice: 3.5, product: 'diesel', card: '0417', was: 'pump', ran: 'yes', on: 'sunday',
  })
  specs.push({ ago: 15, at: 16 * 60 + 50, station: PILOT_I40, amount: 94.18, card: '5512', was: 'pump', ran: 'yes' })
  specs.push({ // Saturday afternoon: bought, and the truck sat in the yard until Monday
    ago: 7, at: 15 * 60 + 10, station: QT_WESTEND, amount: 64.2, gallons: 18.3, unitPrice: 3.51, product: 'diesel', card: '0417',
    was: 'pump', ran: 'no', filled: false, on: 'saturday',
    verdict: { no_runtime_after: { v: 'unsure', note: 'Driver says it went in the mini-ex — checking the hours.', daysLater: 1 } },
  })
  specs.push({ ago: 1, at: 18 * 60 + 40, station: SHELL_CHARLOTTE, amount: 69.3, gallons: 19.8, unitPrice: 3.5, product: 'diesel', card: '0417', was: 'pump', ran: 'no', on: 'workday' })

  const weekday = (k: string) => new Date(k + 'T12:00:00Z').getUTCDay()
  const dayFor = (sp: Spec): string => {
    const d = addDaysKey(todayKey, -sp.ago)
    if (sp.on === 'sunday') return addDaysKey(d, -weekday(d))
    if (sp.on === 'saturday') return addDaysKey(d, -((weekday(d) + 1) % 7))
    return weekday(d) === 0 ? addDaysKey(d, -1) : d
  }
  const seen = new Set<string>()
  const txns: FuelTxnView[] = []
  const exceptions: FuelExceptionView[] = []
  specs.forEach((sp, i) => {
    const day = dayFor(sp)
    // Two routine fills of one card on one day read as a mistake — skip the second.
    const once = `${sp.card}|${day}`
    if (!sp.verdict && !sp.on && seen.has(once)) return
    seen.add(once)
    const atMs = sp.at != null ? localToUtcMs(day, sp.at, tz) : null
    const holder = HOLDER[sp.card]
    const clock = holder && atMs != null ? {
      usesClock: true,
      entries: [-1, 0, 1].map((k) => addDaysKey(day, k)).filter((d) => weekday(d) !== 0)
        .map((d) => ({ inMs: localToUtcMs(d, 6 * 60, tz), outMs: localToUtcMs(d, 16 * 60 + 30, tz) })),
    } : null
    const assetId = sp.rowAsset ?? CARDS[sp.card] ?? null
    const asset = assetId ? V(assetId) : null
    const t = atMs ?? localToUtcMs(day, 12 * 60, tz)
    const dayFrom = localToUtcMs(day, 0, tz)
    let near: { firstMs: number; lastMs: number; n: number; stillN: number; minM: number } | null = null
    let before: FixRec | null = null
    let stops: StopRec[] | null = null
    if (sp.was === 'pump') near = { firstMs: t - 6 * MIN, lastMs: t + 5 * MIN, n: 12, stillN: 9, minM: 18 + (i % 4) * 9 }
    else if ('at' in sp.was) before = { ...sp.was.at, ms: t - 3 * MIN, speed: sp.was.speed }
    else stops = sp.was.stopsAt.map((p) => ({ ...p, fromMs: dayFrom + 7 * HOUR, toMs: dayFrom + 15 * HOUR, n: 40, engineOff: true }))
    if (atMs == null && sp.was === 'pump') near = { firstMs: dayFrom + 9 * HOUR, lastMs: dayFrom + 9 * HOUR + 8 * MIN, n: 8, stillN: 6, minM: 22 }
    const filled = sp.filled ?? (sp.was === 'pump' && sp.ran !== 'no')
    const gauge = asset?.reportsFuelLevel && filled
      ? fillGauge(atMs ?? dayFrom + 9 * HOUR + 4 * MIN, 18, Math.min(96, 18 + ((sp.gallons ?? sp.amount / 3.2) / (asset.tankGal ?? 30)) * 100))
      : asset?.reportsFuelLevel ? fillGauge(t, 61, 60) : null
    const input: CheckInput = {
      txn: {
        id: `demo-fuel-${i}`, txnDate: day, txnAtMs: atMs, amount: sp.amount, gallons: sp.gallons ?? null, unitPrice: sp.unitPrice ?? null,
        product: sp.product ?? null, merchant: sp.station.label.toUpperCase(), brand: sp.station.brand,
        points: [sp.station.point], precision: sp.station.precision, placeLabel: sp.station.label, cardLast4: sp.card, cardholderUserId: holder?.id ?? null,
      },
      asset, assetVia: sp.rowAsset ? 'row' : 'card',
      presence: asset ? {
        fromMs: atMs != null ? atMs - 30 * MIN : dayFrom, toMs: atMs != null ? atMs + 30 * MIN : dayFrom + 24 * HOUR,
        near, stops, before, after: null, fixesInWindow: 30, others: near ? null : [], cardholderPhone: null,
      } : null,
      gauge,
      runtime: asset ? {
        fromMs: atMs ?? dayFrom, toMs: (atMs ?? dayFrom + 24 * HOUR) + settings.runtimeHours * HOUR,
        firstRunMs: sp.ran === 'no' ? null : t + 7 * MIN, lastFixMs: sp.ran === 'no' ? nowMs - 20 * MIN : t + 20 * HOUR,
      } : null,
      area: { zones: ZONES, places: [], dayPath: asset ? [YARD, TOWER] : [] },
      shift: clock,
      hours, settings, nowMs,
    }
    const results = runFuelChecks(input)
    const checkedAt = new Date(Math.min(nowMs, (atMs ?? dayFrom + 20 * HOUR) + 30 * HOUR)).toISOString()
    txns.push({
      id: input.txn.id, source: 'csv', txnDate: day, txnAtMs: atMs, merchant: input.txn.merchant,
      placeLabel: sp.station.label, precision: sp.station.precision, placedTried: true, amount: sp.amount,
      gallons: sp.gallons ?? Math.round((sp.amount / (sp.product === 'diesel' ? settings.dieselPrice : settings.gasPrice)) * 10) / 10,
      gallonsEstimated: sp.gallons == null, product: sp.product ?? null, cardLast4: sp.card, assetId, assetName: asset?.name ?? null,
      assetSource: assetId ? (sp.rowAsset ? 'row' : 'card') : null, vehicleText: sp.rowAsset ? 'TB235' : null, driverText: null,
      excluded: false, excludedReason: null, checks: readStoredChecks(storedChecks(results, checkedAt)), checkedAtMs: Date.parse(checkedAt),
    })
    for (const u of exceptionWrites(input.txn.id, 'mock-company-1', results, checkedAt).upserts) {
      const v = sp.verdict?.[u.kind]
      const firstSeen = Math.min(nowMs, (atMs ?? dayFrom + 20 * HOUR) + 10 * HOUR)
      exceptions.push({
        id: `${input.txn.id}-${u.kind}`, transactionId: input.txn.id, kind: u.kind, severity: u.severity, text: u.evidence.text,
        dollarsAtRisk: u.dollars_at_risk, missing: u.missing, computedAtMs: Date.parse(checkedAt), firstSeenAtMs: firstSeen, clearedAtMs: null,
        verdict: v?.v ?? null, verdictBy: v ? 'Office manager' : null, verdictAtMs: v ? Math.min(nowMs, firstSeen + v.daysLater * 24 * HOUR) : null, verdictNote: v?.note ?? null,
      })
    }
  })
  txns.sort((a, b) => (b.txnDate.localeCompare(a.txnDate)) || ((b.txnAtMs ?? 0) - (a.txnAtMs ?? 0)))
  exceptions.sort((a, b) => b.firstSeenAtMs - a.firstSeenAtMs)

  const startedOn = addDaysKey(todayKey, -21)
  const metricTxns: MetricTxn[] = txns.map((t) => ({ id: t.id, amount: t.amount, txnDate: t.txnDate, hasTime: t.txnAtMs != null, assetId: t.assetId, cardLast4: t.cardLast4, checks: t.checks }))
  const metricEx: MetricException[] = exceptions.map((e) => ({ transactionId: e.transactionId, kind: e.kind, dollarsAtRisk: e.dollarsAtRisk, verdict: e.verdict, clearedAt: null }))
  const spend = (l4: string) => txns.filter((t) => t.cardLast4 === l4)
  const cards: FuelCardView[] = Object.entries(CARDS).map(([l4, id]) => ({
    last4: l4, label: l4 === '5512' ? 'Crew lead card' : l4 === '7731' ? 'Owner card' : 'Fleet card', holder: HOLDER[l4]?.label ?? null, assetId: id, validFrom: id ? addDaysKey(todayKey, -60) : null,
    history: id ? [{ assetId: id, validFrom: addDaysKey(todayKey, -60) }] : [], purchases: spend(l4).length,
    dollars: Math.round(spend(l4).reduce((a, t) => a + t.amount, 0) * 100) / 100,
  })).sort((a, b) => b.dollars - a.dollars)
  const vehicles: FuelVehicleView[] = VEHICLES.map((v) => ({
    id: v.id, name: v.name, type: v.type, tankGal: v.tankGal, tankSource: v.tankGal ? 'specs' : null, fuelType: v.fuelType, reportsFuel: v.reportsFuel, hasTracker: true,
  }))
  return {
    ready: true,
    settings: { ...settings, startedOn, lastRunAtMs: nowMs - 6 * HOUR },
    txns,
    exceptions,
    cards,
    vehicles,
    metrics: pilotMetrics(metricTxns, metricEx, { startedOn, todayKey }),
    missing: missingTelemetry(metricTxns, VEHICLES),
    unplaced: 0,
    unchecked: 0,
  }
}
