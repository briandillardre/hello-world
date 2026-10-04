/**
 * Which existing-ground grid a takeoff needs — pure, so the editor (browser)
 * and the server ask for EXACTLY the same snapped grid and share one cache
 * entry (lib/dirt/ground.ts).
 */
import { nad83UtmEpsg, tmForward, utmParams, utmZone } from './tm'

/** Above this many nodes the grid steps to 2 m (then 4 m): ~8 MB at most. */
const MAX_NODES = 2_000_000
/** Largest site the reader accepts, degrees (~3.3 km). */
export const MAX_SPAN_DEG = 0.03

export interface LngLatBox { minLng: number; minLat: number; maxLng: number; maxLat: number }

export interface GridPlan {
  zone: number
  epsg: number
  dx: number
  x0: number
  y0: number
  nx: number
  ny: number
  key: string
}

/** The node grid for a lng/lat box: UTM, 1 m pixel centres, padded and snapped to 50 m so nearby requests share a cache entry. */
export function planGrid(b: LngLatBox): GridPlan {
  const zone = utmZone((b.minLng + b.maxLng) / 2)
  const tm = utmParams(zone)
  let minE = Infinity, minN = Infinity, maxE = -Infinity, maxN = -Infinity
  for (const lng of [b.minLng, (b.minLng + b.maxLng) / 2, b.maxLng]) {
    for (const lat of [b.minLat, (b.minLat + b.maxLat) / 2, b.maxLat]) {
      const [e, n] = tmForward(tm, lng, lat)
      minE = Math.min(minE, e); maxE = Math.max(maxE, e)
      minN = Math.min(minN, n); maxN = Math.max(maxN, n)
    }
  }
  const snap = 50
  const e0 = Math.floor((minE - 10) / snap) * snap
  const n0 = Math.floor((minN - 10) / snap) * snap
  const e1 = Math.ceil((maxE + 10) / snap) * snap
  const n1 = Math.ceil((maxN + 10) / snap) * snap
  let dx = 1
  while (((e1 - e0) / dx) * ((n1 - n0) / dx) > MAX_NODES && dx < 8) dx *= 2
  const nx = Math.round((e1 - e0) / dx)
  const ny = Math.round((n1 - n0) / dx)
  const x0 = e0 + dx / 2, y0 = n0 + dx / 2
  return { zone, epsg: nad83UtmEpsg(zone), dx, x0, y0, nx, ny, key: `${nad83UtmEpsg(zone)}/${e0}_${n0}_${nx}_${ny}_${dx}` }
}

/** The box a takeoff needs ground for: every traced point (and the site ring), padded 30 m. */
export function groundBoxFor(coords: [number, number][]): LngLatBox | null {
  let minLng = Infinity, minLat = Infinity, maxLng = -Infinity, maxLat = -Infinity
  for (const [lng, lat] of coords) {
    if (!Number.isFinite(lng) || !Number.isFinite(lat)) continue
    minLng = Math.min(minLng, lng); maxLng = Math.max(maxLng, lng)
    minLat = Math.min(minLat, lat); maxLat = Math.max(maxLat, lat)
  }
  if (!Number.isFinite(minLng)) return null
  const padLat = 30 / 111_320
  const padLng = 30 / (111_320 * Math.cos(((minLat + maxLat) / 2) * Math.PI / 180))
  return { minLng: minLng - padLng, minLat: minLat - padLat, maxLng: maxLng + padLng, maxLat: maxLat + padLat }
}

export function boxTooBig(b: LngLatBox): boolean {
  return b.maxLng - b.minLng > MAX_SPAN_DEG || b.maxLat - b.minLat > MAX_SPAN_DEG
}

/** A box grown by `m` metres on every side. */
export function growBox(b: LngLatBox, m: number): LngLatBox {
  const dLat = m / 111_320
  const dLng = m / (111_320 * Math.cos(((b.minLat + b.maxLat) / 2) * Math.PI / 180))
  return { minLng: b.minLng - dLng, minLat: b.minLat - dLat, maxLng: b.maxLng + dLng, maxLat: b.maxLat + dLat }
}

/** Is `a` entirely inside `b`? */
export function boxInside(a: LngLatBox, b: LngLatBox): boolean {
  return a.minLng >= b.minLng && a.minLat >= b.minLat && a.maxLng <= b.maxLng && a.maxLat <= b.maxLat
}

/** A well-formed lng/lat box from untrusted input, or null. */
export function parseBox(v: unknown): LngLatBox | null {
  if (!v || typeof v !== 'object') return null
  const o = v as Record<string, unknown>
  const b = { minLng: Number(o.minLng), minLat: Number(o.minLat), maxLng: Number(o.maxLng), maxLat: Number(o.maxLat) }
  if (![b.minLng, b.minLat, b.maxLng, b.maxLat].every(Number.isFinite)) return null
  if (b.minLng >= b.maxLng || b.minLat >= b.maxLat || b.minLng < -180 || b.maxLng > 180 || b.minLat < -85 || b.maxLat > 85) return null
  return b
}
