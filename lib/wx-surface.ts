/**
 * Surface-weather shading (Temperature · Feels like · Wind speed) drawn from
 * NWS surface observations — pure half (no I/O), shared by the tile route.
 *
 * Why this exists (Oct 10 2026): the layers used nowCOAST's RTMA WMS
 * (`air_temperature`, `apparent_air_temperature`, `wind_speed`). NOAA removed
 * every surface-analysis layer from nowCOAST — GetMap answers
 * `LayerNotDefined` — and the NWS ArcGIS NDFD_temp service is frozen at
 * Aug 2025 (its time dimension ends 2025-08-28). The live keyless source that
 * is left is the NWS surface-observation service (≈2,000 METAR/mesonet
 * stations over North America, refreshed hourly). We interpolate those
 * stations onto a grid (inverse-distance) and colour our own tiles.
 *
 * Honesty: the service only holds the CURRENT observations — there is no
 * history, so these layers are live-only and hide during replays.
 */

export type SurfaceKind = 'temp' | 'feels' | 'wind'
export const SURFACE_KINDS: readonly SurfaceKind[] = ['temp', 'feels', 'wind']

export interface Station {
  lat: number
  lng: number
  /** °F */
  t: number
  /** dew point °F, NaN when unsent */
  td: number
  /** sustained wind, mph, NaN when unsent */
  w: number
}

/** Heat index / wind chill (NWS formulas), else the air temperature. */
export function feelsLikeF(t: number, td: number, wMph: number): number {
  if (t <= 50 && Number.isFinite(wMph) && wMph >= 3) {
    const v = Math.pow(wMph, 0.16)
    return 35.74 + 0.6215 * t - 35.75 * v + 0.4275 * t * v
  }
  if (t >= 80 && Number.isFinite(td)) {
    // RH from dew point (Magnus), then the Rothfusz regression.
    const c = (t - 32) * 5 / 9, dc = (td - 32) * 5 / 9
    const rh = Math.max(0, Math.min(100, 100 * Math.exp((17.625 * dc) / (243.04 + dc)) / Math.exp((17.625 * c) / (243.04 + c))))
    const hi = -42.379 + 2.04901523 * t + 10.14333127 * rh - 0.22475541 * t * rh - 0.00683783 * t * t
      - 0.05481717 * rh * rh + 0.00122874 * t * t * rh + 0.00085282 * t * rh * rh - 0.00000199 * t * t * rh * rh
    return Math.max(t, hi)
  }
  return t
}

export function stationValue(s: Station, kind: SurfaceKind): number {
  if (kind === 'temp') return s.t
  if (kind === 'wind') return s.w
  return feelsLikeF(s.t, s.td, s.w)
}

/** Colour stops — value → [r,g,b]. Shared with the map legend. */
export const SURFACE_RAMPS: Record<SurfaceKind, Array<[number, [number, number, number]]>> = {
  temp: [
    [-10, [145, 60, 200]], [10, [70, 90, 220]], [32, [80, 170, 240]], [45, [90, 210, 180]],
    [60, [120, 210, 90]], [72, [240, 225, 70]], [85, [245, 150, 40]], [95, [225, 50, 40]], [110, [150, 20, 60]],
  ],
  feels: [] as Array<[number, [number, number, number]]>,
  wind: [
    [0, [70, 110, 200]], [5, [70, 170, 210]], [10, [90, 200, 120]], [15, [230, 220, 70]],
    [25, [245, 140, 40]], [35, [220, 40, 50]], [50, [170, 40, 170]],
  ],
}
SURFACE_RAMPS.feels = SURFACE_RAMPS.temp

/** Legend: CSS gradient + end labels for one kind. */
export function surfaceLegend(kind: SurfaceKind): { gradient: string; lo: string; hi: string; ticks: number[] } {
  const r = SURFACE_RAMPS[kind]
  const lo = r[0][0], hi = r[r.length - 1][0]
  const stops = r.map(([v, c]) => `rgb(${c.join(',')}) ${(((v - lo) / (hi - lo)) * 100).toFixed(1)}%`)
  return { gradient: `linear-gradient(90deg,${stops.join(',')})`, lo: String(lo), hi: String(hi), ticks: r.map(([v]) => v) }
}

export function rampColor(kind: SurfaceKind, v: number): [number, number, number] {
  const r = SURFACE_RAMPS[kind]
  if (v <= r[0][0]) return r[0][1]
  for (let i = 1; i < r.length; i++) {
    if (v <= r[i][0]) {
      const [v0, c0] = r[i - 1], [v1, c1] = r[i]
      const f = (v - v0) / (v1 - v0)
      return [c0[0] + (c1[0] - c0[0]) * f, c0[1] + (c1[1] - c0[1]) * f, c0[2] + (c1[2] - c0[2]) * f].map(Math.round) as [number, number, number]
    }
  }
  return r[r.length - 1][1]
}

/** Grid the stations once per refresh: GRID_DEG cells, IDW (power 2) over
 *  stations within SEARCH_DEG; a cell with no station that close is NaN
 *  (drawn transparent — no invented weather over open ocean). */
export const GRID = { west: -170, east: -50, south: 15, north: 72, deg: 0.25 }
const SEARCH_DEG = 1.5

export interface SurfaceGrid { w: number; h: number; values: Record<SurfaceKind, Float32Array> }

export function buildGrid(stations: Station[]): SurfaceGrid {
  const w = Math.round((GRID.east - GRID.west) / GRID.deg) + 1
  const h = Math.round((GRID.north - GRID.south) / GRID.deg) + 1
  // 1° buckets for the neighbour search.
  const buckets = new Map<number, Station[]>()
  const bk = (x: number, y: number) => x * 1000 + y
  for (const s of stations) {
    const k = bk(Math.floor(s.lng), Math.floor(s.lat))
    const b = buckets.get(k)
    if (b) b.push(s); else buckets.set(k, [s])
  }
  const values = {} as Record<SurfaceKind, Float32Array>
  for (const k of SURFACE_KINDS) values[k] = new Float32Array(w * h).fill(NaN)
  const vals = stations.map((s) => SURFACE_KINDS.map((k) => stationValue(s, k)))
  const idx = new Map(stations.map((s, i) => [s, i]))
  const r = Math.ceil(SEARCH_DEG)
  for (let j = 0; j < h; j++) {
    const lat = GRID.south + j * GRID.deg
    const cosLat = Math.cos((lat * Math.PI) / 180)
    for (let i = 0; i < w; i++) {
      const lng = GRID.west + i * GRID.deg
      const num = [0, 0, 0], den = [0, 0, 0]
      let near = false
      const bx = Math.floor(lng), by = Math.floor(lat)
      for (let dx = -r; dx <= r; dx++) for (let dy = -r; dy <= r; dy++) {
        const b = buckets.get(bk(bx + dx, by + dy))
        if (!b) continue
        for (const s of b) {
          const ex = (s.lng - lng) * cosLat, ey = s.lat - lat
          const d2 = ex * ex + ey * ey
          if (d2 > SEARCH_DEG * SEARCH_DEG) continue
          near = true
          const wt = 1 / Math.max(d2, 1e-4)
          const sv = vals[idx.get(s)!]
          for (let q = 0; q < 3; q++) {
            if (Number.isFinite(sv[q])) { num[q] += wt * sv[q]; den[q] += wt }
          }
        }
      }
      if (!near) continue
      for (let q = 0; q < 3; q++) if (den[q] > 0) values[SURFACE_KINDS[q]][j * w + i] = num[q] / den[q]
    }
  }
  return { w, h, values }
}

function sample(g: SurfaceGrid, kind: SurfaceKind, lng: number, lat: number): number {
  const fx = (lng - GRID.west) / GRID.deg, fy = (lat - GRID.south) / GRID.deg
  if (fx < 0 || fy < 0 || fx > g.w - 1 || fy > g.h - 1) return NaN
  const x0 = Math.floor(fx), y0 = Math.floor(fy)
  const x1 = Math.min(x0 + 1, g.w - 1), y1 = Math.min(y0 + 1, g.h - 1)
  const a = g.values[kind]
  const v00 = a[y0 * g.w + x0], v10 = a[y0 * g.w + x1], v01 = a[y1 * g.w + x0], v11 = a[y1 * g.w + x1]
  if (!(Number.isFinite(v00) && Number.isFinite(v10) && Number.isFinite(v01) && Number.isFinite(v11))) {
    // Coast/edge: nearest defined corner rather than a hole in the shading.
    const c = [v00, v10, v01, v11].filter(Number.isFinite)
    return c.length >= 2 ? c.reduce((s, v) => s + v, 0) / c.length : NaN
  }
  const tx = fx - x0, ty = fy - y0
  return (v00 * (1 - tx) + v10 * tx) * (1 - ty) + (v01 * (1 - tx) + v11 * tx) * ty
}

/** RGBA pixels for one 256-px web-mercator tile. */
export function renderTile(g: SurfaceGrid, kind: SurfaceKind, z: number, x: number, y: number, size = 256): Uint8Array {
  const out = new Uint8Array(size * size * 4)
  const n = Math.pow(2, z)
  for (let py = 0; py < size; py++) {
    const my = (y + (py + 0.5) / size) / n
    const lat = (Math.atan(Math.sinh(Math.PI * (1 - 2 * my))) * 180) / Math.PI
    for (let px = 0; px < size; px++) {
      const lng = ((x + (px + 0.5) / size) / n) * 360 - 180
      const v = sample(g, kind, lng, lat)
      if (!Number.isFinite(v)) continue
      const [r, gg, b] = rampColor(kind, v)
      const o = (py * size + px) * 4
      out[o] = r; out[o + 1] = gg; out[o + 2] = b; out[o + 3] = 255
    }
  }
  return out
}
