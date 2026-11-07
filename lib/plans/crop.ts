/**
 * Cropping a sheet to its drawing for the map — pure.
 *
 * On the aerial only the DRAWING belongs: the border, the title block and the
 * revision table hide, so the plan sits cleanly on the ground (the doc:
 * "Crop to the drawing. The crop comes from the border linework, and you can
 * adjust it."). The crop is a box on the page as u, v fractions (0..1, v
 * down from the top edge — the picture's own frame).
 */

import type { PdfLine } from '../dirt/pdf-vectors'

export interface Crop { x0: number; y0: number; x1: number; y1: number; on?: boolean }

/**
 * The drawing area from the linework (viewed space, y up): the box the strokes
 * fill (the border), cut short at the title block's long dividing line — a
 * vertical one down the right side, or a horizontal one across the bottom —
 * and pulled in a hair so the border line itself goes. null when nothing
 * reads like a sheet (a scan, a cover with a picture).
 */
export function autoCrop(strokes: PdfLine[], page: { width: number; height: number }): Crop | null {
  const W = page.width, H = page.height
  if (!(W > 0 && H > 0)) return null
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
  let titleX = Infinity, titleY = -Infinity
  for (const l of strokes) {
    for (let i = 0; i + 1 < l.pts.length; i += 2) {
      const x = Math.min(W, Math.max(0, l.pts[i])), y = Math.min(H, Math.max(0, l.pts[i + 1]))
      if (x < x0) x0 = x
      if (x > x1) x1 = x
      if (y < y0) y0 = y
      if (y > y1) y1 = y
      if (i + 3 >= l.pts.length) continue
      const ax = l.pts[i], ay = l.pts[i + 1], bx = l.pts[i + 2], by = l.pts[i + 3]
      // A long vertical in the right part of the sheet: the title strip's edge.
      if (Math.abs(ax - bx) < 1 && Math.abs(ay - by) > 0.6 * H && ax > 0.62 * W && ax < 0.97 * W) titleX = Math.min(titleX, ax)
      // A long horizontal near the bottom: a bottom title strip's top edge.
      if (Math.abs(ay - by) < 1 && Math.abs(ax - bx) > 0.6 * W && ay > 0.03 * H && ay < 0.3 * H) titleY = Math.max(titleY, ay)
    }
  }
  if (!Number.isFinite(x0) || x1 - x0 < 0.3 * W || y1 - y0 < 0.3 * H) return null
  // A divider found inside the border trims that side; one only a hair inside
  // the border is the border's own double line, not a title block.
  if (Number.isFinite(titleX) && titleX < x1 - 0.04 * W) x1 = titleX
  if (Number.isFinite(titleY) && titleY > y0 + 0.04 * H) y0 = titleY
  const pad = 0.004 * Math.max(W, H)
  x0 += pad; x1 -= pad; y0 += pad; y1 -= pad
  if (x1 - x0 < 0.3 * W || y1 - y0 < 0.3 * H) return null
  const r = (v: number) => Math.round(v * 10000) / 10000
  return { x0: r(x0 / W), y0: r(1 - y1 / H), x1: r(x1 / W), y1: r(1 - y0 / H), on: true }
}

/** A crop the database will take: four fractions in order, at least 10 % each way. */
export function cleanCrop(c: unknown): Crop | null {
  if (!c || typeof c !== 'object') return null
  const { x0, y0, x1, y1, on } = c as Record<string, unknown>
  const ok = [x0, y0, x1, y1].every((v) => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 1)
  if (!ok) return null
  const a = x0 as number, b = y0 as number, cc = x1 as number, d = y1 as number
  if (cc - a < 0.1 || d - b < 0.1) return null
  const r = (v: number) => Math.round(v * 10000) / 10000
  return { x0: r(a), y0: r(b), x1: r(cc), y1: r(d), on: on !== false }
}

type LngLat = [number, number]
const merc = ([lng, lat]: LngLat): [number, number] => [
  (lng + 180) / 360,
  (1 - Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360)) / Math.PI) / 2,
]
const unmerc = (x: number, y: number): LngLat => [
  x * 360 - 180,
  (360 / Math.PI) * Math.atan(Math.exp((1 - 2 * y) * Math.PI)) - 90,
]

/**
 * The ground corners of a cropped part of a placed picture — the same two
 * triangles MapLibre draws the whole picture with (TL·TR·BL, BL·TR·BR, in Web
 * Mercator), so the cropped picture lands exactly where that part of the
 * whole one did.
 */
export function subCorners(c: [LngLat, LngLat, LngLat, LngLat], crop: Crop): [LngLat, LngLat, LngLat, LngLat] {
  const [tl, tr, br, bl] = c.map(merc)
  const at = (u: number, v: number): LngLat => {
    if (u + v <= 1) return unmerc(tl[0] + u * (tr[0] - tl[0]) + v * (bl[0] - tl[0]), tl[1] + u * (tr[1] - tl[1]) + v * (bl[1] - tl[1]))
    const s = 1 - u, t = 1 - v
    return unmerc(br[0] + s * (bl[0] - br[0]) + t * (tr[0] - br[0]), br[1] + s * (bl[1] - br[1]) + t * (tr[1] - br[1]))
  }
  return [at(crop.x0, crop.y0), at(crop.x1, crop.y0), at(crop.x1, crop.y1), at(crop.x0, crop.y1)]
}

export interface PlanFrame { id: string; sheetId?: string; issuedOn?: string; current?: boolean; held?: boolean; createdAt?: string }

/**
 * Which plan pictures the map shows. Live (and a replay of today or later):
 * each sheet's CURRENT version. A replay at an earlier day D: each sheet's
 * version issued last on or before D — the doc's "the map follows time" — and
 * before the sheet's first issue its earliest version, as plans always showed
 * before the plan room. A revision held back behind a pinned one is never
 * drawn: held means not for use. A sheet the person hid is gone; a version
 * they picked replaces the automatic one. Pictures that are not plan-room
 * versions (pre-143) always show. Same-day versions: the current one, else
 * the one filed last.
 */
export function planFrameIds(frames: PlanFrame[], day: string | null, hidden: Set<string>, picked: Map<string, string>, today: string | null = null): Set<string> {
  const out = new Set<string>()
  const bySheet = new Map<string, PlanFrame[]>()
  for (const f of frames) {
    if (!f.sheetId) { out.add(f.id); continue }
    if (!bySheet.has(f.sheetId)) bySheet.set(f.sheetId, [])
    bySheet.get(f.sheetId)!.push(f)
  }
  const later = (a: PlanFrame, b: PlanFrame) =>
    (a.issuedOn ?? '') > (b.issuedOn ?? '') ||
    ((a.issuedOn ?? '') === (b.issuedOn ?? '') && (a.current ? !b.current : !b.current && (a.createdAt ?? '') > (b.createdAt ?? '')))
  bySheet.forEach((all, sheetId) => {
    if (hidden.has(sheetId)) return
    const pick = picked.get(sheetId)
    if (pick && all.some((f) => f.id === pick)) { out.add(pick); return }
    const fs = all.filter((f) => !f.held)
    if (day === null || (today !== null && day >= today)) {
      const cur = fs.find((f) => f.current)
      if (cur) out.add(cur.id)
      return
    }
    let best: PlanFrame | null = null
    let first: PlanFrame | null = null
    for (const f of fs) {
      if (!f.issuedOn) continue
      // The earliest day; on that day the same one the replay would show.
      if (!first || f.issuedOn < first.issuedOn! || (f.issuedOn === first.issuedOn && later(f, first))) first = f
      if (f.issuedOn > day) continue
      if (!best || later(f, best)) best = f
    }
    const show = best ?? first
    if (show) out.add(show.id)
  })
  return out
}
