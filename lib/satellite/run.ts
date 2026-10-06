/**
 * Satellite site imagery — the cron's work for one site (server-only, service
 * role). A picture becomes an ordinary dated, PLACED `zone_imagery` photo
 * (source 'satellite'): the zone page's photo timeline and the map's
 * timeline-aware Site imagery layer pick it up exactly as they do a drone
 * shot. `satellite_scenes` records every scene looked at — the dedupe, and
 * what each picture cost us.
 *
 * Every runner takes `endBy`, the moment its work must be FINISHED (the route
 * sets it under the function's 300 s limit). A scene, an order or a download
 * is only started with its worst case still fitting before it — a run cut off
 * mid-scene is how a picture gets saved and never written down.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { boxPolygon, boxSize, ringBox, siteAoiBox, type Ring } from './geo'
import { captionFor, daysToCheck, groupByDay, sceneImageryId, sceneOpen, MAX_ATTEMPTS, SCENES_PER_DAY, type DoneRow, type SceneCandidate } from './scenes'
import { planetBilledKm2, sceneCostUsd, type Provider } from './pricing'
import { readSitePicture, searchSentinel2, siteCover, S2_SITE_CLOUD_MAX, S2_SITE_NODATA_MAX, type SitePicture } from './sentinel2'
import { downloadPicture, orderStatus, placeOrder, planetRefused, searchPlanet, siteClearPct, PLANET_SITE_CLEAR_MIN } from './planet'

const DAY_MS = 86_400_000
/** Sentinel-2: every run looks back this far, so a new site fills in its last two months over its first few runs. */
export const S2_WINDOW_DAYS = 60
/** Planet: only the last few days — every order is billed. */
export const PLANET_WINDOW_DAYS = 3
/** Per site per run: days looked at, pictures saved, Planet orders placed. */
export const MAX_DAYS_PER_SITE = 8
export const MAX_PICTURES_PER_SITE = 4
export const MAX_ORDERS_PER_SITE = 1
/**
 * Time a scene may take, worst case, and so the time that must be left
 * before `endBy` to start one: a Sentinel-2 scene is the site's cloud read
 * (25 s) + the picture window (40 s) + storage and two writes; a Planet day is
 * a site-clear estimate (15 s) and an order (20 s) + writes.
 */
export const SCENE_HEADROOM_MS = 75_000
/** A Planet collection: the order's status (15 s) + the download (60 s) + storage and writes. */
export const COLLECT_HEADROOM_MS = 85_000
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

/** Is there time to start a piece of work that can take `needMs`? */
const timeFor = (endBy: number, needMs: number) => Date.now() + needMs <= endBy

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

interface Saved { imageryId: string; storagePath: string | null }

/** Where a picture's file goes. Planet's licence forbids letting anyone
 *  download it: the PRIVATE `satellite` bucket, shown through the signed-in
 *  /api/satellite/image route. Sentinel-2 is free and open data: the public
 *  imagery bucket, like a drone shot. */
function pictureHome(svc: SupabaseClient, site: { id: string; companyId: string }, provider: Provider, imageryId: string) {
  if (provider === 'planet') {
    const path = `${site.companyId}/${site.id}/${imageryId}.png`
    return { bucket: 'satellite', path, storagePath: path as string | null, url: `/api/satellite/image/${imageryId}` }
  }
  const path = `${site.companyId}/imagery/${site.id}/sat-${imageryId}.png`
  return { bucket: 'field-photos', path, storagePath: null as string | null, url: svc.storage.from('field-photos').getPublicUrl(path).data.publicUrl }
}

/** This scene's picture, if a run already saved it (the id is the scene's own — sceneImageryId). */
async function findSaved(svc: SupabaseClient, site: { id: string; companyId: string }, provider: Provider, imageryId: string): Promise<Saved | null> {
  const { data, error } = await svc.from('zone_imagery').select('id, company_id, geofence_id, source').eq('id', imageryId).maybeSingle()
  if (error) throw new Error(`zone_imagery: ${error.message}`)
  if (!data) return null
  // The id is derived, so a row under it that is not this site's satellite
  // picture is a collision — never adopt it.
  if (data.company_id !== site.companyId || data.geofence_id !== site.id || data.source !== 'satellite') throw new Error('picture id already taken by another photo')
  return { imageryId, storagePath: pictureHome(svc, site, provider, imageryId).storagePath }
}

/**
 * Store a scene's picture and put it on the site's timeline + map — once.
 * The picture's id and file path are the scene's own (sceneImageryId), so a
 * second save of the same scene (a run killed before it wrote the scene
 * down, two runs collecting one order) lands on the first one instead of
 * adding a duplicate same-day picture.
 */
async function savePicture(svc: SupabaseClient, site: { id: string; companyId: string }, provider: Provider, sceneId: string, day: string, pic: SitePicture): Promise<Saved> {
  const imageryId = await sceneImageryId(site.id, provider, sceneId)
  const before = await findSaved(svc, site, provider, imageryId)
  if (before) return before
  const home = pictureHome(svc, site, provider, imageryId)
  // upsert: the path is this scene's alone — whatever a cut-off run left
  // there is this same picture.
  const up = await svc.storage.from(home.bucket).upload(home.path, pic.png, { contentType: 'image/png', upsert: true })
  if (up.error) throw new Error(`storage: ${up.error.message}`)
  const { error } = await svc.from('zone_imagery').insert({
    id: imageryId,
    company_id: site.companyId,
    geofence_id: site.id,
    url: home.url,
    taken_on: day,
    caption: captionFor(provider, day, pic.gsdM),
    source: 'satellite',
    created_by: null,
    bounds: pic.corners,
    kind: 'photo',
  })
  if (error) {
    // Another run saved this very scene a moment ago: theirs is ours.
    if (error.code === '23505') {
      const theirs = await findSaved(svc, site, provider, imageryId)
      if (theirs) return theirs
    }
    await svc.storage.from(home.bucket).remove([home.path])
    throw new Error(`zone_imagery: ${error.message}`)
  }
  return { imageryId, storagePath: home.storagePath }
}

const newer = (a: string | null, b: string | null) => (!a ? b : !b ? a : Date.parse(a) >= Date.parse(b) ? a : b)

/** Sentinel-2: the newest unsettled passes first, each judged on the site's own cloud before a picture is cut. */
export async function runSentinelSite(svc: SupabaseClient, site: Site, endBy: number): Promise<Tally> {
  const t = blank()
  const now = new Date()
  const from = new Date(now.getTime() - S2_WINDOW_DAYS * DAY_MS)
  const box = ringBox(site.ring)
  const cands = await searchSentinel2(box, from.toISOString(), now.toISOString(), AbortSignal.timeout(20_000))
  const days = groupByDay(cands, (box.minLng + box.maxLng) / 2)
  const done = await doneRows(svc, site.id, 'sentinel2', from)
  for (const day of daysToCheck(days, done, MAX_DAYS_PER_SITE)) {
    if (!timeFor(endBy, SCENE_HEADROOM_MS) || t.pictures >= MAX_PICTURES_PER_SITE) break
    t.looked++
    for (const scene of day.scenes.slice(0, SCENES_PER_DAY)) {
      if (!sceneOpen(scene.id, done)) continue
      // Each scene can take its full worst case — never start one that can't finish.
      if (!timeFor(endBy, SCENE_HEADROOM_MS)) return t
      const base: Omit<SceneRow, 'status' | 'attempts'> = {
        company_id: site.companyId, zone_id: site.id, provider: 'sentinel2', scene_id: scene.id,
        acquired_at: scene.acquiredAt, acquired_on: day.day, cloud_pct: round1(scene.cloudPct), zone_cloud_pct: null,
        gsd_m: scene.gsdM, billed_km2: 0, est_cost_usd: sceneCostUsd('sentinel2', 0),
      }
      const tries = (done.find((r) => r.sceneId === scene.id)?.attempts ?? 0) + 1
      try {
        // Saved by a run that was cut off before it wrote the scene down: write it down now.
        const already = await findSaved(svc, site, 'sentinel2', await sceneImageryId(site.id, 'sentinel2', scene.id))
        if (already) {
          await record(svc, { ...base, status: 'ingested', attempts: tries, imagery_id: already.imageryId })
          t.pictures++
          t.newest = newer(t.newest, scene.acquiredAt)
          break
        }
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
        const saved = await savePicture(svc, site, 'sentinel2', scene.id, day.day, pic)
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

/**
 * Planet: the last few days, one order per clear day, collected later by
 * collectPlanetOrders. Every order is BILLED, so it is written down as
 * `pending` before it is placed: a run killed mid-order leaves the day
 * settled (nothing orders it again), never an order nobody knows about.
 */
export async function runPlanetSite(svc: SupabaseClient, sub: SatSub, site: Site, endBy: number): Promise<Tally> {
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
    if (!timeFor(endBy, SCENE_HEADROOM_MS) || t.ordered >= MAX_ORDERS_PER_SITE) break
    t.looked++
    let chosen: SceneCandidate | null = null
    let bestClear = -1
    let outOfTime = false
    for (const scene of day.scenes.slice(0, SCENES_PER_DAY)) {
      if (!sceneOpen(scene.id, done)) continue
      if (!timeFor(endBy, SCENE_HEADROOM_MS)) { outOfTime = true; break }
      const clear = (await siteClearPct(scene.id, aoi, AbortSignal.timeout(15_000))) ?? scene.clearPct ?? 0
      if (clear >= PLANET_SITE_CLEAR_MIN) { chosen = scene; bestClear = clear; break }
      bestClear = Math.max(bestClear, clear)
    }
    // Ran out of time before every scene of the day was judged: leave the
    // day open for the next run rather than call it cloudy.
    if (outOfTime && !chosen) break
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
    // 1. Written down first (a failure here throws: no row, no order).
    const cost = { billed_km2: billed, est_cost_usd: sceneCostUsd('planet', billed) }
    await record(svc, { ...base, ...cost, status: 'pending', attempts: tries, order_id: null, detail: 'placing the order' })
    // 2. Placed.
    let orderId: string
    try {
      orderId = await placeOrder(chosen.id, aoi, `hammertrack ${site.id.slice(0, 8)} ${day.day}`, AbortSignal.timeout(20_000))
    } catch (e) {
      if (planetRefused(e)) {
        // Planet answered no: nothing was ordered or billed — the scene may be tried again.
        await record(svc, { ...base, status: 'failed', attempts: tries, order_id: null, detail: short(e) }).catch(() => {})
      } else {
        // No answer: the order may exist and be billed. The row stays pending
        // (the day settled — no run orders it again) and is given up later.
        await svc.from('satellite_scenes')
          .update({ detail: `order outcome unknown, not re-ordered: ${short(e)}`.slice(0, 280), updated_at: new Date().toISOString() })
          .eq('zone_id', site.id).eq('provider', 'planet').eq('scene_id', chosen.id)
      }
      t.failed++
      continue
    }
    // 3. The order id written down — the order is paid for, so try twice.
    let wrote = false
    for (let i = 0; i < 2 && !wrote; i++) {
      const { error } = await svc.from('satellite_scenes')
        .update({ order_id: orderId, detail: null, updated_at: new Date().toISOString() })
        .eq('zone_id', site.id).eq('provider', 'planet').eq('scene_id', chosen.id)
      wrote = !error
    }
    if (!wrote) console.error(`satellite: Planet order ${orderId} for site ${site.id} (${day.day}) was placed but its id could not be stored — collect it by hand`)
    t.ordered++
  }
  return t
}

/** Collect finished Planet orders (any site): download, store privately, put on the timeline. */
export async function collectPlanetOrders(svc: SupabaseClient, endBy: number, max = 25): Promise<{ collected: number; waiting: number; failed: number }> {
  const out = { collected: 0, waiting: 0, failed: 0 }
  // An order whose id never got written down (the run died between placing
  // it and recording it, or Planet's answer was lost) can't be collected; its
  // pending row keeps the day from being ordered twice until it ages out.
  const orphanCutoff = new Date(Date.now() - ORDER_GIVE_UP_MS).toISOString()
  await svc.from('satellite_scenes')
    .update({ status: 'failed', attempts: MAX_ATTEMPTS, detail: 'order outcome unknown after 3 days, never re-ordered', updated_at: new Date().toISOString() })
    .eq('provider', 'planet').eq('status', 'pending').is('order_id', null).lt('created_at', orphanCutoff)
  const { data, error } = await svc.from('satellite_scenes')
    .select('id, company_id, zone_id, scene_id, acquired_at, acquired_on, order_id, attempts, created_at')
    .eq('provider', 'planet').eq('status', 'pending')
    .order('created_at', { ascending: true }).limit(max)
  if (error) throw new Error(`satellite_scenes: ${error.message}`)
  for (const row of data ?? []) {
    if (!timeFor(endBy, COLLECT_HEADROOM_MS)) break
    const fail = async (detail: string, attempts = Number(row.attempts) || 1) => {
      await svc.from('satellite_scenes').update({ status: 'failed', attempts, detail: detail.slice(0, 280), updated_at: new Date().toISOString() }).eq('id', row.id)
      out.failed++
    }
    // A hiccup on our side (Planet slow to answer, a download cut short, a
    // storage or database error) leaves the order pending: it is paid for and
    // still there, and the next run asks again — the picture is saved under
    // the scene's own id, so asking again can never save it twice. Only
    // Planet saying it failed — or three days of waiting — gives up on it.
    const later = async (detail: string) => {
      await svc.from('satellite_scenes').update({ detail: detail.slice(0, 280), updated_at: new Date().toISOString() }).eq('id', row.id)
      out.waiting++
    }
    try {
      // Being placed right now, or placed and its id lost: nothing to ask
      // Planet about (the sweep above gives it up after three days).
      if (!row.order_id) { out.waiting++; continue }
      if (Date.now() - Date.parse(String(row.created_at)) > ORDER_GIVE_UP_MS) { await fail('order not done after 3 days', MAX_ATTEMPTS); continue }
      const site = { id: String(row.zone_id), companyId: String(row.company_id) }
      // Saved by a run that was cut off before it marked the order collected.
      let saved = await findSaved(svc, site, 'planet', await sceneImageryId(site.id, 'planet', String(row.scene_id)))
      let gsd: number | null = null
      if (!saved) {
        let st: Awaited<ReturnType<typeof orderStatus>>
        try {
          st = await orderStatus(String(row.order_id), AbortSignal.timeout(15_000))
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
        saved = await savePicture(svc, site, 'planet', String(row.scene_id), String(row.acquired_on), pic)
        gsd = pic.gsdM
      }
      const { error: upErr } = await svc.from('satellite_scenes').update({
        status: 'ingested', imagery_id: saved.imageryId, storage_path: saved.storagePath, detail: null,
        ...(gsd != null ? { gsd_m: gsd } : {}), updated_at: new Date().toISOString(),
      }).eq('id', row.id)
      // The picture is on the timeline; the next run finds it and marks the order.
      if (upErr) { out.waiting++; continue }
      const { data: sub } = await svc.from('zone_satellite').select('last_scene_at').eq('zone_id', row.zone_id).maybeSingle()
      const at = String(row.acquired_at)
      if (sub && (!sub.last_scene_at || Date.parse(at) > Date.parse(String(sub.last_scene_at)))) {
        await svc.from('zone_satellite').update({ last_scene_at: at }).eq('zone_id', row.zone_id)
      }
      out.collected++
    } catch (e) {
      await later(short(e)).catch(() => {})
    }
  }
  return out
}

function round1(v: number): number {
  return Math.round(v * 10) / 10
}
