/**
 * Re-fit a design surface to what was really built — pure. The design's
 * finished grade says where the gutter lip SHOULD be; the rover says where it
 * IS. At each shot the difference (as-built − design) is known; between and
 * around the shots it is blended (inverse-distance) and faded out to nothing
 * `radiusM` away from the nearest shot, so the pavement meets the curb that
 * was poured and keeps the design's own slopes and crown in the middle.
 *
 * Only pavement-edge shots (lip, flowline) drive the re-fit by default — a
 * curb top is 6" above the pavement it bounds and a spot in the field is not
 * the design's surface.
 */

export interface Residual { x: number; y: number; dz: number }
export interface Correction { at: (x: number, y: number) => number; maxAbs: number; n: number }

/** Smoothstep fade: 1 at the shot, 0 at `radius`. */
const fade = (d: number, r: number) => { const t = Math.min(1, Math.max(0, d / r)); return 1 - t * t * (3 - 2 * t) }

export function correctionField(res: Residual[], radiusM: number): Correction {
  const R = Math.max(1, radiusM)
  const cell = R
  const bins = new Map<string, number[]>()
  const k = (i: number, j: number) => `${i},${j}`
  res.forEach((r, n) => {
    const key = k(Math.floor(r.x / cell), Math.floor(r.y / cell))
    const l = bins.get(key) ?? []
    l.push(n)
    bins.set(key, l)
  })
  const at = (x: number, y: number) => {
    const ci = Math.floor(x / cell), cj = Math.floor(y / cell)
    let ws = 0, wz = 0, dmin = Infinity
    for (let di = -1; di <= 1; di++) for (let dj = -1; dj <= 1; dj++) {
      for (const n of bins.get(k(ci + di, cj + dj)) ?? []) {
        const r = res[n]
        const d = Math.hypot(r.x - x, r.y - y)
        if (d > R) continue
        if (d < 1e-6) return r.dz
        const w = 1 / (d * d)
        ws += w; wz += w * r.dz
        if (d < dmin) dmin = d
      }
    }
    return ws ? (wz / ws) * fade(dmin, R) : 0
  }
  return { at, maxAbs: res.reduce((m, r) => Math.max(m, Math.abs(r.dz)), 0), n: res.length }
}

export interface RefitSummary { shotsUsed: number; meanFt: number; maxFt: number; highFt: number; lowFt: number; words: string }

const FT = 0.3048
export function refitSummary(res: Residual[]): RefitSummary {
  if (!res.length) return { shotsUsed: 0, meanFt: 0, maxFt: 0, highFt: 0, lowFt: 0, words: 'No pavement-edge shots fell on the design — nothing to re-fit.' }
  const ft = res.map((r) => r.dz / FT)
  const mean = ft.reduce((a, b) => a + b, 0) / ft.length
  const hi = Math.max(...ft), lo = Math.min(...ft)
  const maxAbs = Math.max(Math.abs(hi), Math.abs(lo))
  const inch = (v: number) => `${(Math.abs(v) * 12).toFixed(2)}"`
  const words = maxAbs < 0.25 / 12
    ? `The curb was built to the design within ¼" at every shot — the re-fit changes almost nothing.`
    : `The built curb is ${inch(mean)} ${mean >= 0 ? 'high' : 'low'} of the design on average (${inch(lo)} ${lo < 0 ? 'low' : 'high'} to ${inch(hi)} ${hi >= 0 ? 'high' : 'low'}); the pavement and stone are re-fit to meet it.`
  const r3 = (v: number) => Math.round(v * 1000) / 1000
  return { shotsUsed: res.length, meanFt: r3(mean), maxFt: r3(maxAbs), highFt: r3(hi), lowFt: r3(lo), words }
}
