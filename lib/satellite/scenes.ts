/**
 * Satellite site imagery — which pictures to take, pure (harness:
 * scripts/satellite-test.mjs). Parses what the two catalogs answer, groups
 * candidate scenes by the day they show, and decides what a run should look
 * at next. The network halves live in sentinel2.ts and planet.ts.
 */
import { epsgOf, localSolarDate } from './geo'
import type { Provider } from './pricing'

export interface SceneCandidate {
  provider: Provider
  /** Catalog id (Sentinel-2 product id / PlanetScope item id). */
  id: string
  /** ISO time of the acquisition. */
  acquiredAt: string
  /** Cloud cover of the whole scene / tile, 0–100. */
  cloudPct: number
  /** Ground sample distance, metres. */
  gsdM: number
  /** Sentinel-2: grid of the tile (EPSG) and the two COGs read. */
  epsg?: number
  visualHref?: string
  sclHref?: string
  /** Share of the tile with no data, 0–100 (Sentinel-2). */
  nodataPct?: number
  /** PlanetScope: clear share of the whole scene, 0–100. */
  clearPct?: number
  /** Tile / satellite label, for the record. */
  label?: string
}

/**
 * The only places a Sentinel-2 picture is read from: Element 84's public
 * Earth Search buckets on AWS. A catalog answer pointing anywhere else is
 * dropped — the cron must never fetch a URL a third party chose.
 */
const S2_HREF = /^https:\/\/(?:e84-earth-search-sentinel-data|sentinel-cogs)\.s3\.us-west-2\.amazonaws\.com\/[A-Za-z0-9_./-]+\.tif$/
const S2_ID = /^[A-Za-z0-9_]{10,80}$/
const PLANET_ID = /^[A-Za-z0-9_]{8,64}$/

const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : NaN)
const isoOk = (v: unknown): v is string => typeof v === 'string' && Number.isFinite(Date.parse(v))

function safeHref(v: unknown): string | undefined {
  return typeof v === 'string' && S2_HREF.test(v) && !v.includes('..') ? v : undefined
}

/** Earth Search (STAC) → Sentinel-2 candidates. Items without a readable picture and scene classes are dropped. */
export function parseStacSearch(json: unknown): SceneCandidate[] {
  const feats = (json as { features?: unknown[] } | null)?.features
  if (!Array.isArray(feats)) return []
  const out: SceneCandidate[] = []
  for (const f of feats) {
    const item = f as { id?: unknown; properties?: Record<string, unknown>; assets?: Record<string, { href?: unknown; gsd?: unknown }> }
    const p = item?.properties ?? {}
    const id = typeof item?.id === 'string' && S2_ID.test(item.id) ? item.id : null
    const visualHref = safeHref(item?.assets?.visual?.href)
    const sclHref = safeHref(item?.assets?.scl?.href)
    const epsg = epsgOf(p['proj:epsg']) ?? epsgOf(p['proj:code'])
    const cloud = num(p['eo:cloud_cover'])
    if (!id || !visualHref || !sclHref || !epsg || !isoOk(p.datetime) || !Number.isFinite(cloud)) continue
    const nodata = num(p['s2:nodata_pixel_percentage'])
    const gsd = num(item.assets?.visual?.gsd)
    out.push({
      provider: 'sentinel2',
      id,
      acquiredAt: p.datetime,
      cloudPct: Math.min(100, Math.max(0, cloud)),
      gsdM: Number.isFinite(gsd) && gsd > 0 ? gsd : 10,
      epsg,
      visualHref,
      sclHref,
      nodataPct: Number.isFinite(nodata) ? nodata : 0,
      label: typeof p['grid:code'] === 'string' ? String(p['grid:code']).slice(0, 40) : undefined,
    })
  }
  return out
}

/** Planet Data API quick-search → PlanetScope candidates (standard quality, with a scene clear share). */
export function parsePlanetSearch(json: unknown): SceneCandidate[] {
  const feats = (json as { features?: unknown[] } | null)?.features
  if (!Array.isArray(feats)) return []
  const out: SceneCandidate[] = []
  for (const f of feats) {
    const item = f as { id?: unknown; properties?: Record<string, unknown> }
    const p = item?.properties ?? {}
    const id = typeof item?.id === 'string' && PLANET_ID.test(item.id) ? item.id : null
    if (!id || !isoOk(p.acquired)) continue
    if (p.quality_category !== undefined && p.quality_category !== 'standard') continue
    const cloud = num(p.cloud_cover)            // 0–1 on PSScene
    const clear = num(p.clear_percent)          // 0–100
    const gsd = num(p.pixel_resolution) || num(p.gsd)
    out.push({
      provider: 'planet',
      id,
      acquiredAt: p.acquired,
      cloudPct: Number.isFinite(cloud) ? Math.min(100, Math.max(0, cloud * 100)) : Number.isFinite(clear) ? 100 - clear : 100,
      clearPct: Number.isFinite(clear) ? clear : undefined,
      gsdM: Number.isFinite(gsd) && gsd > 0 ? gsd : 3,
      label: typeof p.satellite_id === 'string' ? p.satellite_id.slice(0, 40) : undefined,
    })
  }
  return out
}

/** A scene's rank inside one day: least cloud, then most data, then newest. */
function better(a: SceneCandidate, b: SceneCandidate): number {
  const clearA = a.clearPct ?? 100 - a.cloudPct, clearB = b.clearPct ?? 100 - b.cloudPct
  return (clearB - clearA) || ((a.nodataPct ?? 0) - (b.nodataPct ?? 0)) || b.acquiredAt.localeCompare(a.acquiredAt) || a.id.localeCompare(b.id)
}

export interface SceneDay {
  /** The site's calendar day (YYYY-MM-DD). */
  day: string
  /** Every scene of that day, best first. Two Sentinel-2 tiles of one pass are the same photograph cut twice. */
  scenes: SceneCandidate[]
}

/** Candidates grouped by the day they show at the site, newest day first, each day's scenes best first. */
export function groupByDay(cands: SceneCandidate[], lng: number): SceneDay[] {
  const byDay = new Map<string, SceneCandidate[]>()
  for (const c of cands) {
    const day = localSolarDate(c.acquiredAt, lng)
    if (!day) continue
    const list = byDay.get(day) ?? []
    if (!list.some((x) => x.id === c.id)) list.push(c)
    byDay.set(day, list)
  }
  return Array.from(byDay.entries())
    .map(([day, scenes]) => ({ day, scenes: scenes.sort(better) }))
    .sort((a, b) => b.day.localeCompare(a.day))
}

/** What the record already says about one scene: its day, status and how often it was tried. */
export interface DoneRow { day: string; sceneId: string; status: string; attempts: number }

/** A picture that failed this many times is given up on. */
export const MAX_ATTEMPTS = 3
/** Scenes of one day a run will try, best first (two Sentinel-2 tiles of a pass; a few PlanetScope passes). */
export const SCENES_PER_DAY = 3

/**
 * Is a day done with? Yes once a picture was taken, the site was found under
 * cloud, or a Planet order for it is out (`pending`) — or when every scene
 * the run would try is spent: outside the picture, or failed too often. A
 * failure with tries left keeps the day open for the next run.
 */
export function daySettled(day: SceneDay, rows: DoneRow[]): boolean {
  const mine = rows.filter((r) => r.day === day.day)
  if (mine.some((r) => r.status === 'ingested' || r.status === 'cloudy' || r.status === 'pending')) return true
  const tried = day.scenes.slice(0, SCENES_PER_DAY)
  return tried.length > 0 && tried.every((s) => {
    const r = mine.find((x) => x.sceneId === s.id)
    return !!r && (r.status === 'nodata' || (r.status === 'failed' && r.attempts >= MAX_ATTEMPTS))
  })
}

/** May a run (re)try this scene? Not once it settled or failed too often. */
export function sceneOpen(sceneId: string, rows: DoneRow[]): boolean {
  const r = rows.find((x) => x.sceneId === sceneId)
  return !r || (r.status === 'failed' && r.attempts < MAX_ATTEMPTS)
}

/**
 * The days this run should look at, newest first — today's pass before the
 * backfill, so the live map shows the newest clear view as soon as there is
 * one and the older weeks fill in over the next runs.
 */
export function daysToCheck(days: SceneDay[], done: DoneRow[], max: number): SceneDay[] {
  return days.filter((d) => !daySettled(d, done)).slice(0, Math.max(0, max))
}

/** The caption a satellite shot carries on the timeline: source · date · resolution · attribution. */
export function captionFor(provider: Provider, day: string, gsdM: number): string {
  const d = new Date(`${day}T12:00:00Z`)
  const when = d.toLocaleDateString('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric', year: 'numeric' })
  const year = day.slice(0, 4)
  const res = `${Math.round(gsdM)} m`
  return provider === 'planet'
    ? `PlanetScope · ${when} · ${res} · © ${year} Planet Labs PBC`
    : `Sentinel-2 · ${when} · ${res} · Contains modified Copernicus Sentinel data ${year}`
}
