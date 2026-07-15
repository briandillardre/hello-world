/**
 * Full-swarm satellite propagation — off the main thread.
 *
 * ~11,500 SGP4 propagations every few seconds would jank the map, so this
 * worker owns the whole catalog: it receives TLEs once, propagates on a
 * timer (or when the timeline scrubs — simOffset shifts "now"), and posts a
 * transferable Float32Array of [lon, lat, altKm] triplets back.
 */
import { twoline2satrec, propagate, gstime, eciToGeodetic, degreesLong, degreesLat, type SatRec } from 'satellite.js'

let recs: SatRec[] = []
/** simTime − wallTime in ms; 0 = live. Set during timeline replay. */
let simOffset = 0
let timer: ReturnType<typeof setInterval> | null = null

function tick() {
  if (!recs.length) return
  const now = new Date(Date.now() + simOffset)
  const gmst = gstime(now)
  const out = new Float32Array(recs.length * 3)
  let n = 0
  for (const rec of recs) {
    const pv = propagate(rec, now)
    const pos = pv?.position
    if (!pos || typeof pos === 'boolean') continue
    const gd = eciToGeodetic(pos, gmst)
    if (!Number.isFinite(gd.height) || gd.height <= 0) continue
    out[n * 3] = degreesLong(gd.longitude)
    out[n * 3 + 1] = degreesLat(gd.latitude)
    out[n * 3 + 2] = gd.height
    n++
  }
  ;(self as unknown as Worker).postMessage({ pos: out, n }, [out.buffer])
}

self.onmessage = (e: MessageEvent<{ tles?: { l1: string; l2: string }[]; simOffset?: number | null }>) => {
  const d = e.data
  if (d.tles) {
    recs = []
    for (const t of d.tles) {
      try {
        const rec = twoline2satrec(t.l1, t.l2)
        if (rec) recs.push(rec)
      } catch { /* malformed element set — skip */ }
    }
    if (timer) clearInterval(timer)
    tick()
    timer = setInterval(tick, 4000)
  }
  if (d.simOffset !== undefined) {
    const next = d.simOffset ?? 0
    if (Math.abs(next - simOffset) > 500) {
      simOffset = next
      tick()
    } else {
      simOffset = next
    }
  }
}
