/**
 * Worker ↔ machine pairing (beta) — the killer feature's engine.
 *
 * Two GPS streams already know who ran what: a worker's phone (Go Live) and
 * the machine both move together when they're the same seat. A worker is
 * "operating" a machine when both are moving within ~90 m for a sustained
 * run. Output is per-day segments with a confidence score; the foreman
 * confirm-grid comes later — this surfaces the evidence.
 *
 * Honest limits: needs the crew's phones tracking (Go Live) and dense pings.
 * Passengers pair with the same truck as the driver — the confirm step is
 * where a human splits that hair.
 */

export interface PairSegment {
  personId: string
  personName: string
  machineId: string
  machineName: string
  fromMs: number
  toMs: number
  minutes: number
  /** Fraction of the segment's minutes where the two actually moved together. */
  confidence: number
}

interface Row { asset_id: string; lat: number; lng: number; speed?: number | null; timestamp: string }
interface AssetLite { id: string; name: string; type: string }

const BIN_MS = 60_000
const NEAR_M = 90
const MAX_GAP_BINS = 3
const MIN_RUN_BINS = 8

export function pairOperators(rows: Row[], assets: AssetLite[]): PairSegment[] {
  const persons = assets.filter((a) => a.type === 'personnel')
  const machines = assets.filter((a) => a.type === 'vehicle' || a.type === 'equipment')
  if (!persons.length || !machines.length) return []

  // Per-asset per-minute bins: average position, any-movement flag.
  const bins = new Map<string, Map<number, { lat: number; lng: number; n: number; moving: boolean }>>()
  for (const r of rows) {
    const ms = Date.parse(r.timestamp)
    if (!Number.isFinite(ms)) continue
    const bin = Math.floor(ms / BIN_MS)
    let m = bins.get(r.asset_id)
    if (!m) bins.set(r.asset_id, (m = new Map()))
    const b = m.get(bin)
    const moving = (r.speed ?? 0) >= 2
    if (!b) m.set(bin, { lat: r.lat, lng: r.lng, n: 1, moving })
    else {
      b.lat = (b.lat * b.n + r.lat) / (b.n + 1)
      b.lng = (b.lng * b.n + r.lng) / (b.n + 1)
      b.n++
      b.moving = b.moving || moving
    }
  }

  // Every minute a person moves, find the nearest machine moving beside them.
  const together = new Map<string, number[]>() // "personId|machineId" -> bins
  for (const p of persons) {
    const pb = bins.get(p.id)
    if (!pb) continue
    for (const [bin, pv] of Array.from(pb.entries())) {
      if (!pv.moving) continue
      const kx = 111_320 * Math.cos((pv.lat * Math.PI) / 180)
      let best: { id: string; d: number } | null = null
      for (const mach of machines) {
        const mv = bins.get(mach.id)?.get(bin)
        if (!mv?.moving) continue
        const d = Math.hypot((mv.lng - pv.lng) * kx, (mv.lat - pv.lat) * 110_540)
        if (d <= NEAR_M && (!best || d < best.d)) best = { id: mach.id, d }
      }
      if (best) {
        const key = `${p.id}|${best.id}`
        let list = together.get(key)
        if (!list) together.set(key, (list = []))
        list.push(bin)
      }
    }
  }

  // Consecutive-ish bin runs become operator segments.
  const segments: PairSegment[] = []
  for (const [key, binList] of Array.from(together.entries())) {
    const [personId, machineId] = key.split('|')
    const person = persons.find((a) => a.id === personId)!
    const machine = machines.find((a) => a.id === machineId)!
    const sorted = binList.sort((a, b) => a - b)
    let start = sorted[0]
    let prev = sorted[0]
    let count = 1
    const flush = (endBin: number) => {
      const spanBins = endBin - start + 1
      if (count >= MIN_RUN_BINS) {
        segments.push({
          personId, personName: person.name, machineId, machineName: machine.name,
          fromMs: start * BIN_MS, toMs: (endBin + 1) * BIN_MS,
          minutes: spanBins,
          confidence: Math.min(1, count / spanBins),
        })
      }
    }
    for (let i = 1; i < sorted.length; i++) {
      if (sorted[i] - prev > MAX_GAP_BINS) {
        flush(prev)
        start = sorted[i]
        count = 0
      }
      prev = sorted[i]
      count++
    }
    flush(prev)
  }
  return segments.sort((a, b) => b.fromMs - a.fromMs)
}
