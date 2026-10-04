/**
 * The cut/fill picture drawn over the map: one RGBA raster across the grading
 * limits, positioned by its four corners (a MapLibre image source).
 *
 * Diverging, classed: CUT is red, FILL is blue, "no change" (within 0.1 ft) a
 * faint neutral gray. Each arm is five steps, light = shallow → dark = deep,
 * matched step-for-step in OKLCH lightness so neither side reads heavier;
 * both arms pass the ordinal checks (monotone L, ΔL ≥ 0.06, end contrast) on
 * the app's navy surface. Band width snaps to 0.25 / 0.5 / 1 / 2 / 5 / 10 ft
 * so the site's deepest cut or fill lands in the last band.
 *
 * Pure (canvas-free): the caller turns `rgba` into an image. Harness:
 * scripts/dirt-test.mjs.
 */
import { boxCorners, type TakeoffContext } from './takeoff'
import type { Box, Poly } from './geom'

export const FILL_STEPS = ['#b7d3f6', '#86b6ef', '#5598e7', '#2a78d6', '#1c5cab']
export const CUT_STEPS = ['#f6c2bb', '#ec998f', '#e06f64', '#ca453d', '#a1302b']
export const NEUTRAL = '#d9d8d3'
/** |difference| under this (feet) reads as no change. */
export const FLAT_FT = 0.1
const BAND_CHOICES = [0.25, 0.5, 1, 2, 5, 10]

export interface HeatRaster {
  width: number
  height: number
  /** Row 0 = north. */
  rgba: Uint8ClampedArray
  /** [lng, lat] TL, TR, BR, BL. */
  corners: [number, number][]
  /** Width of one colour band, feet. */
  bandFt: number
  maxCutFt: number
  maxFillFt: number
}

const hexRgb = (h: string): [number, number, number] => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16)) as [number, number, number]
const FILL_RGB = FILL_STEPS.map(hexRgb)
const CUT_RGB = CUT_STEPS.map(hexRgb)
const NEUTRAL_RGB = hexRgb(NEUTRAL)

/** The smallest band width that fits `maxFt` into five bands. */
export function bandFor(maxFt: number): number {
  for (const b of BAND_CHOICES) if (maxFt <= b * 5) return b
  return BAND_CHOICES[BAND_CHOICES.length - 1]
}

/** Legend rows for a band width: [label, hex] from shallow to deep. */
export function legendRows(bandFt: number): { fill: [string, string][]; cut: [string, string][] } {
  const label = (k: number) => {
    const lo = k * bandFt, hi = (k + 1) * bandFt
    const f = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(n < 1 ? 2 : 1).replace(/0$/, ''))
    return k === 4 ? `${f(lo)}+ ft` : `${f(lo)}–${f(hi)} ft`
  }
  return {
    fill: FILL_STEPS.map((hx, k) => [label(k), hx]),
    cut: CUT_STEPS.map((hx, k) => [label(k), hx]),
  }
}

/** Fill a label raster with the index of the top-most ring covering each pixel centre. */
function rasterize(rings: Poly[], out: Int16Array, w: number, h: number, box: Box, cell: number): void {
  const xs: number[] = []
  rings.forEach((r, idx) => {
    for (let row = 0; row < h; row++) {
      const y = box.y1 - (row + 0.5) * cell
      xs.length = 0
      for (let i = 0; i < r.length; i += 2) {
        const j = (i + 2) % r.length
        const y1 = r[i + 1], y2 = r[j + 1]
        if ((y1 > y) !== (y2 > y)) xs.push(r[i] + ((y - y1) * (r[j] - r[i])) / (y2 - y1))
      }
      if (xs.length < 2) continue
      xs.sort((a, b) => a - b)
      for (let k = 0; k + 1 < xs.length; k += 2) {
        const c0 = Math.max(0, Math.ceil((xs[k] - box.x0) / cell - 0.5))
        const c1 = Math.min(w - 1, Math.floor((xs[k + 1] - box.x0) / cell - 0.5))
        for (let c = c0; c <= c1; c++) out[row * w + c] = idx
      }
    }
  })
}

export function heatRaster(ctx: TakeoffContext, opts: { maxPx?: number; minCellM?: number } = {}): HeatRaster | null {
  const box = ctx.domain
  if (!box || !ctx.eg || !ctx.fg) return null
  const maxPx = opts.maxPx ?? 1200
  const minCell = opts.minCellM ?? 0.25
  const bw = box.x1 - box.x0, bh = box.y1 - box.y0
  const cell = Math.max(minCell, Math.max(bw, bh) / maxPx)
  const w = Math.max(1, Math.ceil(bw / cell)), h = Math.max(1, Math.ceil(bh / cell))
  const n = w * h
  const lab = (rings: Poly[]) => {
    const a = new Int16Array(n).fill(-1)
    rasterize(rings, a, w, h, box, cell)
    return a
  }
  const inB = lab(ctx.boundary.map(a => a.ring))
  const demo = lab(ctx.demo.map(a => a.ring))
  const top = lab(ctx.topsoil.map(a => a.ring))
  const red = lab(ctx.reduce.map(a => a.ring))
  const pad = lab(ctx.platforms.map(a => a.ring))

  const dFt = new Float32Array(n).fill(NaN)
  let maxCut = 0, maxFill = 0
  for (let row = 0; row < h; row++) {
    const y = box.y1 - (row + 0.5) * cell
    for (let col = 0; col < w; col++) {
      const i = row * w + col
      if (inB[i] < 0) continue
      const x = box.x0 + (col + 0.5) * cell
      const e0 = ctx.eg.zAt(x, y)
      if (!Number.isFinite(e0)) continue
      const eg = e0 - (demo[i] >= 0 ? ctx.demo[demo[i]].t : 0) - (top[i] >= 0 ? ctx.topsoil[top[i]].t : 0)
      let sg: number
      if (pad[i] >= 0) sg = ctx.platforms[pad[i]].z
      else {
        const f = ctx.fg.zAt(x, y)
        if (!Number.isFinite(f)) continue
        sg = f - (red[i] >= 0 ? ctx.reduce[red[i]].t : 0)
      }
      const d = (sg - eg) / 0.3048
      dFt[i] = d
      if (d > maxFill) maxFill = d
      if (-d > maxCut) maxCut = -d
    }
  }

  const bandFt = bandFor(Math.max(maxCut, maxFill))
  const rgba = new Uint8ClampedArray(n * 4)
  for (let i = 0; i < n; i++) {
    const d = dFt[i]
    if (!Number.isFinite(d)) continue
    const o = i * 4
    const a = Math.abs(d)
    let rgb: [number, number, number], alpha: number
    if (a < FLAT_FT) { rgb = NEUTRAL_RGB; alpha = 90 }
    else {
      const k = Math.min(4, Math.floor(a / bandFt))
      rgb = d > 0 ? FILL_RGB[k] : CUT_RGB[k]
      alpha = 190
    }
    rgba[o] = rgb[0]; rgba[o + 1] = rgb[1]; rgba[o + 2] = rgb[2]; rgba[o + 3] = alpha
  }
  const raster: Box = { x0: box.x0, y0: box.y1 - h * cell, x1: box.x0 + w * cell, y1: box.y1 }
  return {
    width: w,
    height: h,
    rgba,
    corners: boxCorners(ctx.frame, raster),
    bandFt,
    maxCutFt: Math.round(maxCut * 100) / 100,
    maxFillFt: Math.round(maxFill * 100) / 100,
  }
}
