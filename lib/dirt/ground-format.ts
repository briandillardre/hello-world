/**
 * The wire/cache format for an existing-ground grid: "HTDG", a JSON header,
 * then Float32 elevations (little-endian, row 0 = south, NaN = no data).
 * Shared by /api/dirt/ground (encode) and the takeoff editor (decode).
 */
import type { GroundGrid } from './takeoff'

const MAGIC = [0x48, 0x54, 0x44, 0x47] // "HTDG"

export interface GroundHeader {
  zone: number
  epsg: number
  x0: number
  y0: number
  dx: number
  dy: number
  nx: number
  ny: number
  source: string
  resolutionM: number
  /** Share of nodes with data, 0–1. */
  coverage: number
  /** USGS products used, newest first. */
  tiles: string[]
  /** Part of the read failed (a tile or the mosaic didn't answer) — never cached; read again later. */
  partial?: boolean
}

export function encodeGround(h: GroundHeader, z: Float32Array): Uint8Array {
  const json = new TextEncoder().encode(JSON.stringify(h))
  const headLen = 8 + json.length
  const pad = (4 - (headLen % 4)) % 4
  const out = new Uint8Array(headLen + pad + z.length * 4)
  out.set(MAGIC, 0)
  new DataView(out.buffer).setUint32(4, json.length, true)
  out.set(json, 8)
  const dv = new DataView(out.buffer, headLen + pad)
  for (let i = 0; i < z.length; i++) dv.setFloat32(i * 4, z[i], true)
  return out
}

export function decodeGround(buf: ArrayBuffer): { header: GroundHeader; grid: GroundGrid } | null {
  const u = new Uint8Array(buf)
  if (u.length < 8 || MAGIC.some((m, i) => u[i] !== m)) return null
  const len = new DataView(buf).getUint32(4, true)
  if (8 + len > u.length) return null
  let header: GroundHeader
  try { header = JSON.parse(new TextDecoder().decode(u.subarray(8, 8 + len))) } catch { return null }
  const headLen = 8 + len
  const start = headLen + ((4 - (headLen % 4)) % 4)
  const n = header.nx * header.ny
  if (!(n > 0) || start + n * 4 > u.length) return null
  const z = new Float32Array(n)
  const dv = new DataView(buf, start)
  for (let i = 0; i < n; i++) z[i] = dv.getFloat32(i * 4, true)
  return {
    header,
    grid: {
      zone: header.zone, epsg: header.epsg, x0: header.x0, y0: header.y0, dx: header.dx, dy: header.dy,
      nx: header.nx, ny: header.ny, z, source: header.source, resolutionM: header.resolutionM,
    },
  }
}
