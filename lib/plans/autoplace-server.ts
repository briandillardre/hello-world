/**
 * Line a site's plan sheets up on the map by themselves — server only, called
 * from lib/actions/plans.ts after the person's edit + plans checks.
 *
 *  1. LINK the sheets to each other (lib/plans/match.ts): an overall plan and
 *     its enlarged quadrants, road sheets across a matchline. A link is a
 *     page-to-page similarity measured from the corners both draw.
 *  2. GROUND: a sheet nobody has placed is matched to the building footprints
 *     (and parcel lines) around the site, and placed only when that is sure.
 *  3. SPREAD: every placed sheet carries its linked sheets with it, so a
 *     quadrant lands where its overall says — exactly, not "same paper".
 *
 * Who wins when two answers disagree — the stronger evidence:
 *   3  state plane grid · the person's own placement · an exact same-plot carry
 *   2  buildings
 *   x−½ a link from a sheet placed at strength x
 *   0  "check it" copies (the old same-paper guess)
 * A placement is only ever replaced by a stronger one.
 */

import {
  cornersFrom, matchCorners, sheetMatchSure, groundMatchSure, sheetRatios, COMMON_FPI, cornersFor, similarityOf,
  compose, invert, type Similarity, type Corners4, type LngLat,
} from './match'
import { groundAround } from './ground-features'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Svc = any

interface V {
  id: string
  setId: string | null
  sheetId: string
  imageId: string | null
  W: number
  H: number
  fpi: number | null
  placement: Record<string, unknown> | null
  corners: ReturnType<typeof cornersFrom>
  bounds: Corners4 | null
  q: number
  T: Similarity | null
}

interface Link { a: string; b: string; t: Similarity; n: number; rmsFt: number | null }

export interface AutoPlaceResult {
  links: number
  byBuildings: number
  bySheets: number
  unplaced: number
  ground: { buildings: number; parcels: number } | null
  placedIds: string[]
}

const GOOD = (b: unknown): b is Corners4 =>
  Array.isArray(b) && b.length === 4 && b.every((p) => Array.isArray(p) && p.length === 2 && p.every((x) => typeof x === 'number' && Number.isFinite(x)))

function quality(p: Record<string, unknown> | null, placed: boolean): number {
  if (!placed) return -1
  const src = p?.source
  if (!src || src === 'grid' || src === 'manual') return 3
  if (src === 'carried') return p?.check ? 0 : 3
  if (src === 'buildings') return 2
  if (src === 'sheet') return typeof p?.q === 'number' ? (p.q as number) : 1
  return 1
}

function fpiOf(r: Record<string, unknown>): number | null {
  const f = Number(r.feet_per_inch)
  if (Number.isFinite(f) && f > 0) return f
  const checks = Array.isArray(r.scale_checks) ? r.scale_checks as { key?: string; feetPerInch?: number }[] : []
  for (const k of ['stated', 'bar', 'dims', 'grid']) {
    const c = checks.find((x) => x?.key === k && typeof x.feetPerInch === 'number' && x.feetPerInch > 0)
    if (c) return c.feetPerInch!
  }
  return null
}

function onSite(c: Corners4, origin: LngLat): boolean {
  const kx = 111_320 * Math.cos((origin[1] * Math.PI) / 180), ky = 110_574
  const cx = (c[0][0] + c[2][0]) / 2, cy = (c[0][1] + c[2][1]) / 2
  const d = Math.hypot((cx - origin[0]) * kx, (cy - origin[1]) * ky)
  const diag = Math.hypot((c[2][0] - c[0][0]) * kx, (c[2][1] - c[0][1]) * ky)
  return d < 2000 && diag > 10 && diag < 5000
}

/**
 * Link, match and spread for one site. `focusSetIds` = the sets just filed
 * (their sheets are linked and ground-matched); the rest of the site's
 * sheets take part as anchors. `forceRoot` = a version the person just placed
 * (it spreads to its linked sheets even over weaker placements).
 */
export async function autoPlaceSite(svc: Svc, companyId: string, zoneId: string, opts: { focusSetIds?: string[]; deadlineMs?: number; ground?: boolean } = {}): Promise<AutoPlaceResult> {
  const deadline = Date.now() + (opts.deadlineMs ?? 40_000)
  const res: AutoPlaceResult = { links: 0, byBuildings: 0, bySheets: 0, unplaced: 0, ground: null, placedIds: [] }

  const { data: z } = await svc.from('geofences_json').select('geometry').eq('id', zoneId).maybeSingle()
  const ring = ((z?.geometry as { coordinates?: LngLat[][] } | null)?.coordinates?.[0] ?? []) as LngLat[]
  if (ring.length < 3) return res
  const origin: LngLat = [ring.reduce((t, p) => t + p[0], 0) / ring.length, ring.reduce((t, p) => t + p[1], 0) / ring.length]

  const { data: sheets } = await svc.from('plan_sheets').select('id').eq('geofence_id', zoneId).eq('company_id', companyId).is('deleted_at', null).limit(400)
  const sheetIds = (sheets ?? []).map((s: { id: string }) => s.id)
  if (!sheetIds.length) return res
  const { data: rows } = await svc.from('plan_versions')
    .select('id, set_id, sheet_id, image_id, page_w, page_h, feet_per_inch, scale_checks, placement, features')
    .in('sheet_id', sheetIds).eq('company_id', companyId).is('deleted_at', null).not('features', 'is', null).limit(120)
  const focus = new Set(opts.focusSetIds ?? [])
  const list = (rows ?? []) as Record<string, unknown>[]
  if (!list.length) return res
  const imgIds = list.map((r) => r.image_id).filter((x): x is string => typeof x === 'string')
  const { data: imgs } = imgIds.length ? await svc.from('zone_imagery').select('id, bounds').in('id', imgIds).eq('company_id', companyId) : { data: [] }
  const boundsOf = new Map<string, Corners4 | null>(((imgs ?? []) as { id: string; bounds: unknown }[]).map((i) => [i.id, GOOD(i.bounds) ? i.bounds : null]))

  const vs: V[] = list.map((r) => {
    const imageId = (r.image_id as string | null) ?? null
    const bounds = imageId ? boundsOf.get(imageId) ?? null : null
    const W = Number(r.page_w) || 0, H = Number(r.page_h) || 0
    const placement = (r.placement && typeof r.placement === 'object') ? r.placement as Record<string, unknown> : null
    return {
      id: r.id as string, setId: (r.set_id as string | null) ?? null, sheetId: r.sheet_id as string, imageId, W, H, fpi: fpiOf(r),
      placement, corners: cornersFrom(r.features), bounds, q: quality(placement, !!bounds),
      T: bounds && W > 0 && H > 0 ? similarityOf(bounds, origin, W, H) : null,
    }
  }).filter((v) => v.W > 0 && v.H > 0 && v.imageId)
  const byId = new Map(vs.map((v) => [v.id, v]))

  // 1. Links (existing ones are kept; new pairs are measured).
  const { data: lrows } = await svc.from('plan_links').select('a_version, b_version, s, th, tx, ty, n, rms_ft').eq('company_id', companyId)
    .in('a_version', vs.map((v) => v.id))
  const links: Link[] = ((lrows ?? []) as Record<string, number | string>[])
    .filter((l) => byId.has(l.a_version as string) && byId.has(l.b_version as string))
    .map((l) => ({ a: l.a_version as string, b: l.b_version as string, t: { s: +l.s, th: +l.th, tx: +l.tx, ty: +l.ty }, n: +l.n, rmsFt: l.rms_ft == null ? null : +l.rms_ft }))
  const linked = new Set(links.flatMap((l) => [`${l.a}|${l.b}`, `${l.b}|${l.a}`]))
  const fresh: Link[] = []
  const big = vs.filter((v) => v.corners.length >= 12)
  outer: for (let i = 0; i < big.length; i++) {
    for (let j = i + 1; j < big.length; j++) {
      if (Date.now() > deadline - 15_000) break outer
      const A = big[i], B = big[j]
      if (A.sheetId === B.sheetId) continue // revisions of one sheet carry already
      if (focus.size && !(A.setId && focus.has(A.setId)) && !(B.setId && focus.has(B.setId))) continue
      if (linked.has(`${A.id}|${B.id}`)) continue
      const m = matchCorners(A.corners, B.corners, { scales: sheetRatios(A.fpi, B.fpi), tol: 1.2, scaleSlack: A.fpi && B.fpi ? 0.01 : 0.03 })
      const ftPerB = (B.fpi ?? (A.fpi && m ? A.fpi / m.s : 0)) / 72
      if (!m || !ftPerB || !sheetMatchSure(m, ftPerB, Math.hypot(B.W, B.H))) continue
      const l: Link = { a: A.id, b: B.id, t: { s: m.s, th: m.th, tx: m.tx, ty: m.ty }, n: m.n, rmsFt: Math.round(m.rms * ftPerB * 100) / 100 }
      fresh.push(l); links.push(l); linked.add(`${A.id}|${B.id}`); linked.add(`${B.id}|${A.id}`)
    }
  }
  if (fresh.length) {
    await svc.from('plan_links').upsert(fresh.map((l) => ({
      company_id: companyId, a_version: l.a, b_version: l.b, s: l.t.s, th: l.t.th, tx: l.t.tx, ty: l.t.ty, n: l.n, rms_ft: l.rmsFt,
    })), { onConflict: 'a_version,b_version' })
    res.links = fresh.length
  }

  // 3. Spread (run before and after the ground so a placed sheet saves the ground calls).
  const changed = new Map<string, { bounds: Corners4; placement: Record<string, unknown> }>()
  const spread = () => {
    for (let round = 0; round < 40; round++) {
      let moved = false
      for (const l of links) {
        for (const [from, to, t] of [[l.a, l.b, invert(l.t)], [l.b, l.a, l.t]] as [string, string, Similarity][]) {
          const X = byId.get(from), Y = byId.get(to)
          if (!X?.T || !Y || X.q < 1.5) continue // a "check it" copy never spreads
          const q = X.q - 0.5
          if (q <= Y.q) continue
          const T = compose(X.T, t) // Y page → X page → ground
          const c = cornersFor(T, origin, Y.W, Y.H)
          if (!onSite(c, origin)) continue
          Y.T = T; Y.q = q; Y.bounds = c
          Y.placement = { source: 'sheet', from: X.id, q, n: l.n, errorFt: l.rmsFt ?? undefined, check: q < 2 }
          changed.set(Y.id, { bounds: c, placement: Y.placement })
          moved = true
        }
      }
      if (!moved) break
    }
  }
  spread()

  // 2. Ground, for focus sheets nothing stronger has placed.
  if (opts.ground !== false) {
    const want = vs.filter((v) => v.q < 2 && v.corners.length >= 20 && (!focus.size || (v.setId && focus.has(v.setId))))
      .sort((a, b) => b.corners.length - a.corners.length)
    if (want.length) {
      const g = await groundAround(`${companyId}:${zoneId}`, ring, origin)
      if (g) {
        res.ground = { buildings: g.buildings, parcels: g.parcels }
        let tries = 0
        for (const v of want) {
          if (v.q >= 2 || Date.now() > deadline - 3_000 || tries >= 8) continue
          tries++
          const mPerPt = (f: number) => (f * 0.3048) / 72
          const scales = v.fpi ? [mPerPt(v.fpi), mPerPt(v.fpi) / 2, mPerPt(v.fpi) * 2] : COMMON_FPI.map(mPerPt)
          const m = matchCorners(v.corners, g.corners, { scales, tol: 2.5, scaleSlack: 0.04 })
          const diagM = Math.hypot(v.W, v.H) * (m ? m.s : 0)
          if (!m || !groundMatchSure(m, diagM)) continue
          const T: Similarity = { s: m.s, th: m.th, tx: m.tx, ty: m.ty }
          const c = cornersFor(T, origin, v.W, v.H)
          if (!onSite(c, origin)) continue
          const errorFt = Math.round(m.rms * 3.2808 * 10) / 10
          v.T = T; v.q = 2; v.bounds = c
          v.placement = { source: 'buildings', n: m.n, errorFt, check: errorFt > 3, what: `${m.n} building corners` }
          changed.set(v.id, { bounds: c, placement: v.placement })
          res.byBuildings++
          spread()
        }
      }
    }
  }

  // Write what moved.
  for (const [id, ch] of Array.from(changed.entries())) {
    const v = byId.get(id)!
    const { error } = await svc.from('zone_imagery').update({ bounds: ch.bounds }).eq('id', v.imageId).eq('company_id', companyId)
    if (error) continue
    await svc.from('plan_versions').update({ placement: ch.placement }).eq('id', id).eq('company_id', companyId)
    if (ch.placement.source === 'sheet') res.bySheets++
    res.placedIds.push(id)
  }
  if (res.placedIds.length) {
    try {
      const { remeasureVersion } = await import('@/lib/takeoff-server')
      for (const id of res.placedIds.slice(0, 60)) await remeasureVersion(svc, companyId, id)
    } catch { /* no marks yet */ }
  }
  res.unplaced = vs.filter((v) => !v.bounds && (!focus.size || (v.setId && focus.has(v.setId)))).length
  return res
}
