/**
 * Satellite site imagery — the cron's work for one site (server-only, service
 * role). A picture becomes an ordinary dated, PLACED `zone_imagery` photo
 * (source 'satellite'): the zone page's photo timeline and the map's
 * timeline-aware Site imagery layer pick it up exactly as they do a drone
 * shot. `satellite_scenes` records every scene looked at — the dedupe, and
 * what each picture cost us.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { boxPolygon, boxSize, ringBox, siteAoiBox, type Ring } from './geo'
import { captionFor, daysToCheck, groupByDay, sceneOpen, MAX_ATTEMPTS, SCENES_PER_DAY, type DoneRow, type SceneCandidate } from './scenes'
import { planetBilledKm2, sceneCostUsd, type Provider } from './pricing'
import { readSitePicture, searchSentinel2, siteCover, S2_SITE_CLOUD_MAX, S2_SITE_NODATA_MAX, type SitePicture } from './sentinel2'
import { downloadPicture, orderStatus, placeOrder, searchPlanet, siteClearPct, PLANET_SITE_CLEAR_MIN } from './planet'

const DAY_MS = 86_400_000
/** Sentinel-2: every run looks back this far, so a new site fills in its last two months over its first few runs. */
export const S2_WINDOW_DAYS = 60
/** Planet: only the last few days — every order is billed. */
export const PLANET_WINDOW_DAYS = 3
/** Per site per run: days looked at, pictures saved, Planet orders placed. */
export const MAX_DAYS_PER_SITE = 8
export const MAX_PICTURES_PER_SITE = 4
export const MAX_ORDERS_PER_SITE = 1
/** A picture with more of it empty than this is not worth keeping. */
const MAX_EMPTY_PCT = 30
/** A Planet order still not done after this is given up on. */
const ORDER_GIVE_UP_MS = 3 * DAY_MS

export interface SatSub {
  zone_id: string
  company_id: string
  provider: Provider
  enabled_at: string
  last_scene_at: string | null
}

export interface Site { id: string; companyId: string; ring: Ring }

export interface Tally { looked: number; pictures: number; cloudy: number; nodata: number; failed: number; ordered: number; newest: string | null }

const blank = (): Tally => ({ looked: 0, pictures: 0, cloudy: 0, nodata: 0, failed: 0, ordered: 0, newest: null })

const short = (e: unknown) => (e instanceof Error ? e.message : String(e)).slice(0, 280)

interface SceneRow {
  company_id: string
  zone_id: string
  provider: Provider
  scene_id: string
  acquired_at: string
  acquired_on: string
  cloud_pct: number | null
  zone_cloud_pct: number | null
  gsd_m: number | null
  billed_km2: number
  est_cost_usd: number
  imagery_id?: string | null
  status: 'ingested' | 'cloudy' | 'nodata' | 'pending' | 'failed'
  order_id?: string | null
  storage_path?: string | null
  attempts: number
  detail?: string | null
}

async function record(svc: SupabaseClient, row: SceneRow): Promise<void> {
  const { error } = await svc.from('satellite_scenes')
    .upsert({ ...row, updated_at: new Date().toISOString() }, { onConflict: 'zone_id,provider,scene_id' })
  if (error) throw new Error(`satellite_scenes: ${error.message}`)
}

async function doneRows(svc: SupabaseClient, zoneId: string, provider: Provider, from: Date): Promise<DoneRow[]> {
  const since = new Date(from.getTime() - DAY_MS).toISOString().slice(0, 10)
  const { data, error } = await svc.from('satellite_scenes')
    .select('scene_id, acquired_on, status, attempts')
    .eq('zone_id', zoneId).eq('provider', provider).gte('acquired_on', since)
    .limit(1000)
  if (error) throw new Error(`satellite_scenes: ${error.message}`)
  return (data ?? []).map((r) => ({ day: String(r.acquired_on), sceneId: String(r.scene_id), status: String(r.status), attempts: Number(r.attempts) || 0 }))
}

/**
 * Store a picture and put it on the site's timeline + map. Sentinel-2 is free
 * and open data: the public imagery bucket, like a drone shot. Planet's
 * licence forbids letting anyone download it: the private `satellite` bucket,
 * shown through the signed-in /api/satellite/image route.
 */
async function savePicture(svc: SupabaseClient, site: { id: string; companyId: string }, provider: Provider, day: string, pic: SitePicture): Promise<{ imageryId: string; storagePath: string | null }> {
  const imageryId = crypto.randomUUID()
  let url: string
  let storagePath: string | null = null
  let bucket: string
  let path: string
  if (provider === 'planet') {
    bucket = 'satellite'
    path = `${site.companyId}/${site.id}/${imageryId}.png`
    storagePath = path
    url = `/api/satellite/image/${imageryId}`
  } else {
    bucket = 'field-photos'
    path = `${site.companyId}/imagery/${site.id}/sat-${imageryId}.png`
    url = svc.storage.from(bucket).getPublicUrl(path).data.publicUrl
  }
  const up = await svc.storage.from(bucket).upload(path, pic.png, { contentType: 'image/png', upsert: false })
  if (up.error) throw new Error(`storage: ${up.error.message}`)
  const { error } = await svc.from('zone_imagery').insert({
    id: imageryId,
    company_id: site.companyId,
    geofence_id: site.id,
    url,
    taken_on: day,
    caption: captionFor(provider, day, pic.gsdM),
    source: 'satellite',
    created_by: null,
    bounds: pic.corners,
    kind: 'photo',
  })
  if (error) {
    await svc.storage.from(bucket).remove([path])
    throw new Error(`zone_imagery: ${error.message}`)
  }
  return { imageryId, storagePath }
}

const newer = (a: string | null, b: string | null) => (!a ? b : !b ? a : Date.parse(a) >= Date.parse(b) ? a : b)

/** Sentinel-2: the newest unsettled passes first, each judged on the site's own cloud before a picture is cut. */
export async function runSentinelSite(svc: SupabaseClient, site: Site, deadline: number): Promise<Tally> {
  const t = blank()
  const now = new Date()
  const from = new Date(now.getTime() - S2_WINDOW_DAYS * DAY_MS)
  const box = ringBox(site.ring)
  const cands = await searchSentinel2(box, from.toISOString(), now.toISOString(), AbortSignal.timeout(20_000))
  const days = groupByDay(cands, (box.minLng + box.maxLng) / 2)
  const done = await doneRows(svc, site.id, 'sentinel2', from)
  for (const day of daysToCheck(days, done, MAX_DAYS_PER_SITE)) {
    if (Date.now() > deadline || t.pictures >= MAX_PICTURES_PER_SITE) break
    t.looked++
    for (const scene of day.scenes.slice(0, SCENES_PER_DAY)) {
      if (!sceneOpen(scene.id, done)) continue
      const base: Omit<SceneRow, 'status' | 'attempts'> = {
        company_id: site.companyId, zone_id: site.id, provider: 'sentinel2', scene_id: scene.id,
        acquired_at: scene.acquiredAt, acquired_on: day.day, cloud_pct: round1(scene.cloudPct), zone_cloud_pct: null,
        gsd_m: scene.gsdM, billed_km2: 0, est_cost_usd: sceneCostUsd('sentinel2', 0),
      }
      const tries = (done.find((r) => r.sceneId === scene.id)?.attempts ?? 0) + 1
      try {
        const cover = await siteCover(scene, site.ring, AbortSignal.timeout(25_000))
        if (cover.nodataPct > S2_SITE_NODATA_MAX) {
          // This tile cuts the site off; the other tile of the same pass may have it whole.
          await record(svc, { ...base, status: 'nodata', attempts: tries, detail: `site ${Math.round(cover.nodataPct)}% outside the picture` })
          t.nodata++
          continue
        }
        base.zone_cloud_pct = round1(cover.cloudyPct)
        if (cover.cloudyPct > S2_SITE_CLOUD_MAX) {
          // Both tiles of a pass are one photograph: cloudy here is cloudy there.
          await record(svc, { ...base, status: 'cloudy', attempts: tries })
          t.cloudy++
          break
        }
        const pic = await readSitePicture(scene, site.ring, AbortSignal.timeout(40_000))
        if (pic.emptyPct > MAX_EMPTY_PCT) {
          await record(svc, { ...base, status: 'nodata', attempts: tries, detail: `picture ${Math.round(pic.emptyPct)}% empty` })
          t.nodata++
          continue
        }
        const saved = await savePicture(svc, site, 'sentinel2', day.day, pic)
        await record(svc, { ...base, status: 'ingested', attempts: tries, imagery_id: saved.imageryId })
        t.pictures++
        t.newest = newer(t.newest, scene.acquiredAt)
        break
      } catch (e) {
        await record(svc, { ...base, status: 'failed', attempts: tries, detail: short(e) }).catch(() => {})
        t.failed++
      }
    }
  }
  return t
}

/** Planet: the last few days, one order per clear day, collected later by collectPlanetOrders. */
export async function runPlanetSite(svc: SupabaseClient, sub: SatSub, site: Site, deadline: number): Promise<Tally> {
  const t = blank()
  const now = Date.now()
  const enabled = Date.parse(sub.enabled_at)
  const from = new Date(Math.max(now - PLANET_WINDOW_DAYS * DAY_MS, (Number.isFinite(enabled) ? enabled : now) - DAY_MS))
  const marginBox = siteAoiBox(site.ring)
  const aoi = boxPolygon(marginBox)
  const billed = planetBilledKm2(boxSize(marginBox).km2)
  const cands = await searchPlanet(aoi, from.toISOString(), new Date(now).toISOString(), AbortSignal.timeout(20_000))
  const box = ringBox(site.ring)
  const days = groupByDay(cands, (box.minLng + box.maxLng) / 2)
  const done = await doneRows(svc, site.id, 'planet', from)
  for (const day of daysToCheck(days, done, PLANET_WINDOW_DAYS)) {
    if (Date.now() > deadline || t.ordered >= MAX_ORDERS_PER_SITE) break
    t.looked++
    let chosen: SceneCandidate | null = null
    let bestClear = -1
    for (const scene of day.scenes.slice(0, SCENES_PER_DAY)) {
      if (!sceneOpen(scene.id, done)) continue
      const clear = (await siteClearPct(scene.id, aoi, AbortSignal.timeout(15_000))) ?? scene.clearPct ?? 0
      if (clear >= PLANET_SITE_CLEAR_MIN) { chosen = scene; bestClear = clear; break }
      bestClear = Math.max(bestClear, clear)
    }
    const lead = chosen ?? day.scenes[0]
    if (!lead) continue
    const tries = (done.find((r) => r.sceneId === lead.id)?.attempts ?? 0) + 1
    const base: Omit<SceneRow, 'status' | 'attempts'> = {
      company_id: site.companyId, zone_id: site.id, provider: 'planet', scene_id: lead.id,
      acquired_at: lead.acquiredAt, acquired_on: day.day, cloud_pct: round1(lead.cloudPct),
      zone_cloud_pct: bestClear >= 0 ? round1(100 - bestClear) : null, gsd_m: lead.gsdM,
      billed_km2: 0, est_cost_usd: 0,
    }
    if (!chosen) {
      await record(svc, { ...base, status: 'cloudy', attempts: tries })
      t.cloudy++
      continue
    }
    try {
      const orderId = await placeOrder(chosen.id, aoi, `hammertrack ${site.id.slice(0, 8)} ${day.day}`, AbortSignal.timeout(20_000))
      await record(svc, { ...base, status: 'pending', attempts: tries, order_id: orderId, billed_km2: billed, est_cost_usd: sceneCostUsd('planet', billed) })
      t.ordered++
    } catch (e) {
      await record(svc, { ...base, status: 'failed', attempts: tries, detail: short(e) }).catch(() => {})
      t.failed++
    }
  }
  return t
}

/** Collect finished Planet orders (any site): download, store privately, put on the timeline. */
export async function collectPlanetOrders(svc: SupabaseClient, deadline: number, max = 25): Promise<{ collected: number; waiting: number; failed: number }> {
  const out = { collected: 0, waiting: 0, failed: 0 }
  const { data, error } = await svc.from('satellite_scenes')
    .select('id, company_id, zone_id, scene_id, acquired_at, acquired_on, order_id, attempts, created_at')
    .eq('provider', 'planet').eq('status', 'pending')
    .order('created_at', { ascending: true }).limit(max)
  if (error) throw new Error(`satellite_scenes: ${error.message}`)
  for (const row of data ?? []) {
    if (Date.now() > deadline) break
    const fail = async (detail: string, attempts = Number(row.attempts) || 1) => {
      await svc.from('satellite_scenes').update({ status: 'failed', attempts, detail: detail.slice(0, 280), updated_at: new Date().toISOString() }).eq('id', row.id)
      out.failed++
    }
    // A hiccup on our side (Planet slow to answer, a download cut short) leaves
    // the order pending: it is paid for and still there, and the next run asks
    // again for fresh links. Only Planet saying it failed — or three days of
    // waiting — gives up on it.
    const later = async (detail: string) => {
      await svc.from('satellite_scenes').update({ detail: detail.slice(0, 280), updated_at: new Date().toISOString() }).eq('id', row.id)
      out.waiting++
    }
    try {
      if (Date.now() - Date.parse(String(row.created_at)) > ORDER_GIVE_UP_MS) { await fail('order not done after 3 days', MAX_ATTEMPTS); continue }
      let st: Awaited<ReturnType<typeof orderStatus>>
      try {
        st = await orderStatus(String(row.order_id ?? ''), AbortSignal.timeout(15_000))
      } catch (e) {
        await later(short(e))
        continue
      }
      if (st.state === 'queued' || st.state === 'running') { out.waiting++; continue }
      if (!st.location) { await fail(`order ${st.state} with no picture`); continue }
      let pic: SitePicture
      try {
        pic = await downloadPicture(st.location, AbortSignal.timeout(60_000))
      } catch (e) {
        await later(short(e))
        continue
      }
      const saved = await savePicture(svc, { id: String(row.zone_id), companyId: String(row.company_id) }, 'planet', String(row.acquired_on), pic)
      await svc.from('satellite_scenes').update({
        status: 'ingested', imagery_id: saved.imageryId, storage_path: saved.storagePath, gsd_m: pic.gsdM, updated_at: new Date().toISOString(),
      }).eq('id', row.id)
      const { data: sub } = await svc.from('zone_satellite').select('last_scene_at').eq('zone_id', row.zone_id).maybeSingle()
      const at = String(row.acquired_at)
      if (sub && (!sub.last_scene_at || Date.parse(at) > Date.parse(String(sub.last_scene_at)))) {
        await svc.from('zone_satellite').update({ last_scene_at: at }).eq('zone_id', row.zone_id)
      }
      out.collected++
    } catch (e) {
      await fail(short(e)).catch(() => {})
    }
  }
  return out
}

function round1(v: number): number {
  return Math.round(v * 10) / 10
}
