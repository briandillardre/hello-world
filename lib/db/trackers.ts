/**
 * Trackers as first-class things (migration 092).
 *
 * A tracker is a box with an IMEI. At any moment it is either INSTALLED (an
 * active asset carries it as tracker_id) or IN THE DRAWER (the company's
 * registry knows it, no active asset wears it). `assets.tracker_id` stays the
 * single source of truth for "installed"; the drawer is derived from it, so
 * the two can never disagree.
 *
 * Every change goes through `changeTracker` below, which composes two
 * primitives — take a tracker OFF an asset, put a tracker ON an asset — and
 * writes a `tracker_moves` row with the exact history cut, so `undoMove` can
 * walk it back row-for-row for 30 days. Delete is soft for the same 30 days.
 *
 * Service-role writes, always company-scoped by the caller's company id.
 */
import type { AssetType } from '../types'
import { imeiLooksValid, modelFromImei, type DeviceModel } from '../devices'
import {
  RETENTION_DAYS,
  type TrackerLastSeen, type TrackerRow, type DeletedAssetRow, type MoveRow, type TrackersOverview,
  type Destination, type TrackerChange, type ChangeResult,
} from '../trackers-types'

export { RETENTION_DAYS }
export type { TrackerLastSeen, TrackerRow, DeletedAssetRow, MoveRow, TrackersOverview, Destination, TrackerChange, ChangeResult }

const isMock = !process.env.NEXT_PUBLIC_SUPABASE_URL ||
  process.env.NEXT_PUBLIC_SUPABASE_URL === 'https://your-project.supabase.co'

const MOCK_OVERVIEW: TrackersOverview = {
  installed: [
    { imei: '863452084048569', model: 'FMM00A', label: 'Chevy 1500', registered: true, asset: { id: 'a1', name: 'Chevy 1500 - Brian', type: 'vehicle' }, lastSeen: { timestamp: new Date(Date.now() - 4 * 60_000).toISOString(), lat: 34.85, lng: -82.4, speed: 0, battery: null }, unassignedSince: null, buffered: 0 },
    { imei: '869267077050677', model: 'TAT141', label: 'Takeuchi TB235', registered: true, asset: { id: 'a2', name: 'Takeuchi TB235', type: 'equipment' }, lastSeen: { timestamp: new Date(Date.now() - 50 * 60_000).toISOString(), lat: 34.7, lng: -82.6, speed: 0, battery: 100 }, unassignedSince: null, buffered: 0 },
  ],
  unassigned: [
    { imei: '860813075166517', model: 'FMM650', label: 'Tool trailer', registered: true, asset: null, lastSeen: null, unassignedSince: null, buffered: 0 },
    { imei: '863452084000200', model: 'FMM00A', label: null, registered: true, asset: null, lastSeen: { timestamp: new Date(Date.now() - 20 * 60_000).toISOString(), lat: 34.84, lng: -82.39, speed: 0, battery: null }, unassignedSince: new Date(Date.now() - 26 * 3_600_000).toISOString(), buffered: 14 },
  ],
  deletedAssets: [
    { id: 'a9', name: 'Old Ford F250 (sold)', type: 'vehicle', tracker_id: null, deleted_at: new Date(Date.now() - 3 * 86_400_000).toISOString(), purge_at: new Date(Date.now() + 27 * 86_400_000).toISOString() },
  ],
  moves: [],
}

function purgeAt(deletedAt: string): string {
  return new Date(Date.parse(deletedAt) + RETENTION_DAYS * 86_400_000).toISOString()
}

/* ────────────────────────────────────────────────────────────────────────── */
/* Read                                                                      */
/* ────────────────────────────────────────────────────────────────────────── */

export async function getTrackersOverview(companyId: string): Promise<TrackersOverview> {
  if (isMock) return MOCK_OVERVIEW
  const { createClient } = await import('../supabase-server')
  const db = createClient()

  type Reg = { imei: string; model: DeviceModel; label: string | null; unassigned_since: string | null }
  type Ast = { id: string; name: string; type: AssetType; tracker_id: string | null; active: boolean; deleted_at: string | null }

  const [regQ, astQ, movesQ] = await Promise.all([
    db.from('device_onboarding').select('imei, model, label, unassigned_since').eq('company_id', companyId),
    db.from('assets').select('id, name, type, tracker_id, active, deleted_at').eq('company_id', companyId),
    db.from('tracker_moves').select('*').eq('company_id', companyId).order('created_at', { ascending: false }).limit(25),
  ])
  const registry = (regQ.data ?? []) as Reg[]
  const assets = (astQ.data ?? []) as Ast[]

  const live = assets.filter((a) => a.active && !a.deleted_at)
  const byTracker = new Map<string, Ast>()
  for (const a of live) if (a.tracker_id) byTracker.set(a.tracker_id, a)
  const byId = new Map(assets.map((a) => [a.id, a]))

  // Installed: every active asset with a tracker — registered or not.
  const regByImei = new Map(registry.map((r) => [r.imei, r]))
  const installedAssets = live.filter((a) => a.tracker_id && !a.tracker_id.startsWith('phone-'))

  // Newest fix per installed asset, one query (same embed shape + ordering
  // caveat as getAssetsWithLocations).
  const lastByAsset = new Map<string, TrackerLastSeen>()
  if (installedAssets.length) {
    const { data } = await db
      .from('assets')
      .select('id, location:asset_locations(lat, lng, speed, battery, timestamp)')
      .in('id', installedAssets.map((a) => a.id))
      .order('timestamp', { ascending: false, referencedTable: 'asset_locations' })
      .limit(1, { referencedTable: 'asset_locations' })
    type Row = { id: string; location: TrackerLastSeen[] | TrackerLastSeen | null }
    for (const r of (data ?? []) as Row[]) {
      const fix = Array.isArray(r.location) ? r.location[0] : r.location
      if (fix) lastByAsset.set(r.id, fix)
    }
  }

  const installed: TrackerRow[] = installedAssets.map((a) => {
    const reg = regByImei.get(a.tracker_id!)
    return {
      imei: a.tracker_id!,
      model: reg?.model ?? modelFromImei(a.tracker_id!),
      label: reg?.label ?? null,
      registered: !!reg,
      asset: { id: a.id, name: a.name, type: a.type },
      lastSeen: lastByAsset.get(a.id) ?? null,
      unassignedSince: null,
      buffered: 0,
    }
  })

  // Drawer: registry rows no active asset wears. Beacons are tool tags with
  // their own page (/tags) and a different id format — not trackers here.
  const drawer = registry.filter((r) => r.model !== 'EYE_BEACON' && !byTracker.has(r.imei))
  const unassigned: TrackerRow[] = await Promise.all(drawer.map(async (r) => {
    const [lastQ, countQ] = await Promise.all([
      db.from('unassigned_locations').select('lat, lng, speed, battery, timestamp')
        .eq('company_id', companyId).eq('imei', r.imei).order('timestamp', { ascending: false }).limit(1).maybeSingle(),
      db.from('unassigned_locations').select('id', { count: 'exact', head: true })
        .eq('company_id', companyId).eq('imei', r.imei),
    ])
    return {
      imei: r.imei,
      model: r.model,
      label: r.label,
      registered: true,
      asset: null,
      lastSeen: (lastQ.data as TrackerLastSeen | null) ?? null,
      unassignedSince: r.unassigned_since,
      buffered: countQ.count ?? 0,
    }
  }))
  unassigned.sort((a, b) => (b.lastSeen?.timestamp ?? '').localeCompare(a.lastSeen?.timestamp ?? ''))

  const deletedAssets: DeletedAssetRow[] = assets
    .filter((a) => a.deleted_at)
    .sort((a, b) => b.deleted_at!.localeCompare(a.deleted_at!))
    .map((a) => ({ id: a.id, name: a.name, type: a.type, tracker_id: a.tracker_id, deleted_at: a.deleted_at!, purge_at: purgeAt(a.deleted_at!) }))

  const cutoff = Date.now() - RETENTION_DAYS * 86_400_000
  type RawMove = Omit<MoveRow, 'from_asset' | 'to_asset' | 'undoable'> & { from_asset_id: string | null; to_asset_id: string | null }
  const moves: MoveRow[] = ((movesQ.data ?? []) as RawMove[]).map((m) => {
    const f = m.from_asset_id ? byId.get(m.from_asset_id) : null
    const t = m.to_asset_id ? byId.get(m.to_asset_id) : null
    return {
      id: m.id, kind: m.kind, tracker_id: m.tracker_id, swap_at: m.swap_at,
      moved_locations: m.moved_locations, moved_buffered: m.moved_buffered,
      replacement_tracker_id: m.replacement_tracker_id, note: m.note,
      created_at: m.created_at, undone_at: m.undone_at,
      from_asset: f ? { id: f.id, name: f.name } : null,
      to_asset: t ? { id: t.id, name: t.name } : null,
      undoable: !m.undone_at && Date.parse(m.created_at) > cutoff,
    }
  })

  return { installed, unassigned, deletedAssets, moves }
}

/** What the asset page's Tracker sheet needs to offer choices: the drawer,
 *  and the trackers on OTHER assets (a take), plus trackerless assets. */
export async function getTrackerChoices(companyId: string, assetId: string): Promise<{
  drawer: { imei: string; model: DeviceModel | null; label: string | null; lastSeen: string | null; unassignedSince: string | null }[]
  onOthers: { imei: string; assetId: string; assetName: string }[]
  trackerless: { id: string; name: string; type: AssetType }[]
}> {
  const o = await getTrackersOverview(companyId)
  if (isMock) {
    return {
      drawer: o.unassigned.map((u) => ({ imei: u.imei, model: u.model, label: u.label, lastSeen: u.lastSeen?.timestamp ?? null, unassignedSince: u.unassignedSince })),
      onOthers: o.installed.filter((i) => i.asset && i.asset.id !== assetId).map((i) => ({ imei: i.imei, assetId: i.asset!.id, assetName: i.asset!.name })),
      trackerless: [],
    }
  }
  const { createClient } = await import('../supabase-server')
  const db = createClient()
  const { data } = await db.from('assets').select('id, name, type')
    .eq('company_id', companyId).eq('active', true).is('deleted_at', null).is('tracker_id', null).neq('id', assetId).order('name')
  return {
    drawer: o.unassigned.map((u) => ({ imei: u.imei, model: u.model, label: u.label, lastSeen: u.lastSeen?.timestamp ?? null, unassignedSince: u.unassignedSince })),
    onOthers: o.installed.filter((i) => i.asset && i.asset.id !== assetId).map((i) => ({ imei: i.imei, assetId: i.asset!.id, assetName: i.asset!.name })),
    trackerless: ((data ?? []) as { id: string; name: string; type: AssetType }[]),
  }
}

/* ────────────────────────────────────────────────────────────────────────── */
/* Write                                                                     */
/* ────────────────────────────────────────────────────────────────────────── */

type Db = Awaited<ReturnType<typeof import('../supabase-server').createServiceClient>>

const RESERVED_TRACKER_PREFIXES = ['sim-', 'phone-']

function trackerLooksValid(id: string): string | null {
  const clean = id.trim()
  if (!clean) return 'Enter the tracker ID.'
  if (clean.length > 64) return 'That ID is too long.'
  // phone-<uid> is a person's own phone share (lib/actions/tracker.ts); an
  // editor must not be able to point a vehicle at a coworker's phone.
  if (RESERVED_TRACKER_PREFIXES.some((p) => clean.toLowerCase().startsWith(p))) return 'That ID is reserved — enter the IMEI from the device label.'
  if (/^\d+$/.test(clean)) {
    const c = imeiLooksValid(clean)
    if (!c.ok) return c.reason ?? 'That IMEI does not look right.'
  }
  return null
}

/** Make sure the registry knows this IMEI (attach/detach both want a row to
 *  hang unassigned_since on). Never overwrites what is already there. */
async function ensureRegistered(db: Db, companyId: string, imei: string) {
  await db.from('device_onboarding')
    .upsert({ company_id: companyId, imei, model: modelFromImei(imei) ?? 'OTHER' }, { onConflict: 'company_id,imei', ignoreDuplicates: true })
}

async function loadAsset(db: Db, companyId: string, id: string) {
  const { data } = await db.from('assets').select('id, name, type, tracker_id, active, deleted_at')
    .eq('id', id).eq('company_id', companyId).maybeSingle()
  return data as { id: string; name: string; type: AssetType; tracker_id: string | null; active: boolean; deleted_at: string | null } | null
}

/** Resolve a destination to an asset id, creating it when asked. */
async function resolveDestination(db: Db, companyId: string, dest: Exclude<Destination, { mode: 'drawer' }>, mustBeTrackerless: boolean):
  Promise<{ id: string } | { error: string }> {
  if (dest.mode === 'asset') {
    const a = await loadAsset(db, companyId, dest.assetId)
    if (!a || !a.active || a.deleted_at) return { error: 'That vehicle is not in your active list.' }
    if (mustBeTrackerless && a.tracker_id) return { error: `"${a.name}" already has a tracker (…${a.tracker_id.slice(-4)}). Take that one off first, or pick a different vehicle.` }
    return { id: a.id }
  }
  const name = dest.name.trim().slice(0, 120)
  if (!name) return { error: 'Name the other vehicle.' }
  const { data, error } = await db.from('assets')
    .insert({ company_id: companyId, name, type: dest.type, active: true, metadata: { source: 'tracker-swap' }, tracker_id: null })
    .select('id').single()
  if (error || !data) return { error: 'Could not create the new vehicle.' }
  return { id: data.id }
}

/** Pull buffered drawer pings for `imei` since `sinceIso` onto `assetId`. */
async function drainBuffer(db: Db, companyId: string, imei: string, assetId: string, sinceIso: string): Promise<number> {
  const { data } = await db.from('unassigned_locations').select('*')
    .eq('company_id', companyId).eq('imei', imei).gte('timestamp', sinceIso).order('timestamp').limit(5000)
  const rows = (data ?? []) as Record<string, unknown>[]
  if (!rows.length) return 0
  const ins = rows.map((r) => ({
    asset_id: assetId, company_id: companyId,
    lat: r.lat, lng: r.lng, speed: r.speed, heading: r.heading, altitude: r.altitude, battery: r.battery,
    accuracy: null, timestamp: r.timestamp, ignition: r.ignition,
    // Marked so undo can find exactly these rows and push them back.
    raw: { ...((r.raw as Record<string, unknown>) ?? {}), _buffered: 1 },
  }))
  const { error } = await db.from('asset_locations').insert(ins)
  if (error) { console.error('drainBuffer insert failed:', error.message); return 0 }
  await db.from('unassigned_locations').delete().in('id', rows.map((r) => r.id as number))
  return rows.length
}

/** Undo of drainBuffer: rows that came from the buffer go back to it. */
async function refillBuffer(db: Db, companyId: string, imei: string, assetId: string, sinceIso: string): Promise<number> {
  const { data } = await db.from('asset_locations').select('*')
    .eq('asset_id', assetId).eq('company_id', companyId).gte('timestamp', sinceIso).eq('raw->>_buffered', '1').limit(5000)
  const rows = (data ?? []) as Record<string, unknown>[]
  if (!rows.length) return 0
  const back = rows.map((r) => {
    const raw = { ...((r.raw as Record<string, unknown>) ?? {}) }
    delete raw._buffered
    return { company_id: companyId, imei, lat: r.lat, lng: r.lng, speed: r.speed, heading: r.heading, altitude: r.altitude, battery: r.battery, ignition: r.ignition, timestamp: r.timestamp, raw }
  })
  const { error } = await db.from('unassigned_locations').insert(back)
  if (error) { console.error('refillBuffer insert failed:', error.message); return 0 }
  await db.from('asset_locations').delete().in('id', rows.map((r) => r.id as string))
  return rows.length
}

async function movePings(db: Db, companyId: string, fromAsset: string, toAsset: string, sinceIso: string, direction: 'gte' | 'lt'): Promise<number> {
  const q = db.from('asset_locations').update({ asset_id: toAsset }).eq('asset_id', fromAsset).eq('company_id', companyId)
  const { data } = await (direction === 'gte' ? q.gte('timestamp', sinceIso) : q.lt('timestamp', sinceIso)).select('id')
  return data?.length ?? 0
}

async function recordMove(db: Db, companyId: string, actorId: string | null, row: {
  kind: MoveRow['kind']; tracker_id: string; from_asset_id: string | null; to_asset_id: string | null
  swap_at: string; moved_locations?: number; moved_buffered?: number; replacement_tracker_id?: string | null; note?: string | null
}) {
  await db.from('tracker_moves').insert({ company_id: companyId, actor_id: actorId, moved_locations: 0, moved_buffered: 0, ...row })
}

/**
 * Take `imei` OFF `asset` (which must wear it). Where the pings from
 * `sinceIso` onward go depends on the destination:
 *   drawer  — they STAY on the asset (nobody else can claim them yet; if the
 *             tracker later lands on another asset from a time inside this
 *             window, that attach takes them then).
 *   asset   — they move to the destination asset, which also takes the tracker.
 */
async function takeOff(db: Db, companyId: string, actorId: string | null, asset: { id: string; name: string }, imei: string, sinceIso: string, dest: Destination, group: string | null):
  Promise<{ ok: true; toId: string | null; moved: number } | { ok: false; error: string }> {
  if (dest.mode === 'drawer') {
    await db.from('assets').update({ tracker_id: null }).eq('id', asset.id).eq('company_id', companyId)
    await ensureRegistered(db, companyId, imei)
    await db.from('device_onboarding').update({ unassigned_since: sinceIso, updated_at: new Date().toISOString() })
      .eq('company_id', companyId).eq('imei', imei)
    await recordMove(db, companyId, actorId, { kind: 'detach', tracker_id: imei, from_asset_id: asset.id, to_asset_id: null, swap_at: sinceIso, note: group })
    return { ok: true, toId: null, moved: 0 }
  }
  const r = await resolveDestination(db, companyId, dest, true)
  if ('error' in r) return { ok: false, error: r.error }
  await db.from('assets').update({ tracker_id: null }).eq('id', asset.id).eq('company_id', companyId)
  await db.from('assets').update({ tracker_id: imei }).eq('id', r.id).eq('company_id', companyId)
  const moved = await movePings(db, companyId, asset.id, r.id, sinceIso, 'gte')
  await ensureRegistered(db, companyId, imei)
  await db.from('device_onboarding').update({ unassigned_since: null, updated_at: new Date().toISOString() })
    .eq('company_id', companyId).eq('imei', imei)
  await recordMove(db, companyId, actorId, { kind: 'move', tracker_id: imei, from_asset_id: asset.id, to_asset_id: r.id, swap_at: sinceIso, moved_locations: moved, note: group })
  return { ok: true, toId: r.id, moved }
}

/**
 * Put `imei` ON `asset` (which must be trackerless). If another active asset
 * wears it, that is a TAKE: its pings from `sinceIso` come along. Buffered
 * drawer pings from `sinceIso` land here too.
 */
async function putOn(db: Db, companyId: string, actorId: string | null, asset: { id: string; name: string }, imei: string, sinceIso: string, group: string | null):
  Promise<{ ok: true; moved: number; buffered: number; takenFrom: string | null } | { ok: false; error: string }> {
  const { data: holder } = await db.from('assets').select('id, name')
    .eq('company_id', companyId).eq('tracker_id', imei).eq('active', true).is('deleted_at', null).neq('id', asset.id).maybeSingle()
  let moved = 0
  if (holder) {
    await db.from('assets').update({ tracker_id: null }).eq('id', holder.id).eq('company_id', companyId)
  }
  const { error } = await db.from('assets').update({ tracker_id: imei }).eq('id', asset.id).eq('company_id', companyId)
  if (error) {
    if (holder) await db.from('assets').update({ tracker_id: imei }).eq('id', holder.id).eq('company_id', companyId)
    // 23505 = a company we can't see already owns this IMEI (084).
    return { ok: false, error: error.code === '23505' ? `Tracker …${imei.slice(-4)} is registered to another account. Check the IMEI.` : 'Could not save the tracker.' }
  }
  if (holder) moved = await movePings(db, companyId, holder.id, asset.id, sinceIso, 'gte')
  const buffered = await drainBuffer(db, companyId, imei, asset.id, sinceIso)
  await ensureRegistered(db, companyId, imei)
  await db.from('device_onboarding').update({ unassigned_since: null, updated_at: new Date().toISOString() })
    .eq('company_id', companyId).eq('imei', imei)
  await recordMove(db, companyId, actorId, {
    kind: holder ? 'move' : 'attach', tracker_id: imei, from_asset_id: holder?.id ?? null, to_asset_id: asset.id,
    swap_at: sinceIso, moved_locations: moved, moved_buffered: buffered, note: group,
  })
  return { ok: true, moved, buffered, takenFrom: holder?.name ?? null }
}

export async function changeTracker(companyId: string, actorId: string | null, assetId: string, change: TrackerChange): Promise<ChangeResult> {
  if (isMock) return { ok: false, error: 'Demo mode — changes are not saved.' }
  const sinceMs = Date.parse(change.sinceIso)
  if (Number.isNaN(sinceMs)) return { ok: false, error: 'Pick the date and time it happened.' }
  if (sinceMs > Date.now() + 5 * 60_000) return { ok: false, error: 'That time is in the future.' }
  // One bounded UPDATE on the service connection; a multi-year cut is a
  // timeout, not a feature. 400 days covers any real swap.
  if (sinceMs < Date.now() - 400 * 86_400_000) return { ok: false, error: 'That is more than a year ago. Pick a date within the last 400 days.' }
  const sinceIso = new Date(sinceMs).toISOString()

  const { createServiceClient } = await import('../supabase-server')
  const db = createServiceClient()
  const asset = await loadAsset(db, companyId, assetId)
  if (!asset || asset.deleted_at) return { ok: false, error: 'Asset not found.' }

  switch (change.kind) {
    case 'attach': {
      if (asset.tracker_id) return { ok: false, error: `"${asset.name}" already has a tracker. Use Swap instead.` }
      const imei = change.imei.trim()
      const bad = trackerLooksValid(imei); if (bad) return { ok: false, error: bad }
      const r = await putOn(db, companyId, actorId, asset, imei, sinceIso, null)
      if (!r.ok) return r
      return { ok: true, goTo: asset.id, moved: r.moved, buffered: r.buffered }
    }
    case 'detach': {
      if (!asset.tracker_id) return { ok: false, error: 'There is no tracker on this asset.' }
      const r = await takeOff(db, companyId, actorId, asset, asset.tracker_id, sinceIso, { mode: 'drawer' }, null)
      if (!r.ok) return r
      return { ok: true, goTo: asset.id }
    }
    case 'move': {
      if (!asset.tracker_id) return { ok: false, error: 'There is no tracker on this asset.' }
      const r = await takeOff(db, companyId, actorId, asset, asset.tracker_id, sinceIso, change.to, null)
      if (!r.ok) return r
      return { ok: true, goTo: r.toId ?? asset.id, moved: r.moved }
    }
    case 'swap': {
      if (!asset.tracker_id) return { ok: false, error: 'There is no tracker on this asset to swap. Use Put a tracker on.' }
      const imei = change.imei.trim()
      const bad = trackerLooksValid(imei); if (bad) return { ok: false, error: bad }
      if (imei === asset.tracker_id) return { ok: false, error: 'That is the tracker already on this asset. Enter the one that went IN.' }
      // One group id ties the two halves so Undo reverses both together.
      const group = `group:${crypto.randomUUID()}`
      const off = await takeOff(db, companyId, actorId, asset, asset.tracker_id, sinceIso, change.oldTo, group)
      if (!off.ok) return off
      const on = await putOn(db, companyId, actorId, asset, imei, sinceIso, group)
      if (!on.ok) return { ok: false, error: `The old tracker was taken off, but the new one could not go on: ${on.error}` }
      return { ok: true, goTo: asset.id, moved: off.moved + on.moved, buffered: on.buffered }
    }
    case 'split_history': {
      if (!asset.tracker_id) return { ok: false, error: 'There is no tracker on this asset.' }
      const r = await resolveDestination(db, companyId, change.other, false)
      if ('error' in r) return { ok: false, error: r.error }
      const moved = await movePings(db, companyId, asset.id, r.id, sinceIso, 'lt')
      await recordMove(db, companyId, actorId, { kind: 'split_history', tracker_id: asset.tracker_id, from_asset_id: asset.id, to_asset_id: r.id, swap_at: sinceIso, moved_locations: moved })
      return { ok: true, goTo: r.id, moved }
    }
  }
}

/** Reverse one move (and its swap partner, if any), row for row. */
export async function undoMove(companyId: string, moveId: string): Promise<{ ok: boolean; error?: string; undone?: number }> {
  if (isMock) return { ok: false, error: 'Demo mode — changes are not saved.' }
  const { createServiceClient } = await import('../supabase-server')
  const db = createServiceClient()
  const { data: one } = await db.from('tracker_moves').select('*').eq('id', moveId).eq('company_id', companyId).maybeSingle()
  if (!one) return { ok: false, error: 'That change is no longer on record.' }
  if (one.undone_at) return { ok: false, error: 'Already undone.' }
  if (Date.parse(one.created_at) < Date.now() - RETENTION_DAYS * 86_400_000) return { ok: false, error: `Older than ${RETENTION_DAYS} days — the undo window has closed.` }

  // A swap is two rows sharing a group note; reverse newest-first.
  let batch = [one]
  if (typeof one.note === 'string' && one.note.startsWith('group:')) {
    const { data } = await db.from('tracker_moves').select('*').eq('company_id', companyId).eq('note', one.note).is('undone_at', null).order('created_at', { ascending: false })
    if (data?.length) batch = data
  }
  // Only the LATEST change to a tracker can be undone cleanly.
  for (const m of batch) {
    // Any later, still-standing change to this tracker outside this group
    // blocks the undo. NB: a plain `neq('note', x)` silently drops NULL-note
    // rows (SQL: NULL <> x is NULL), which is every non-swap move — so the
    // group exclusion has to be spelled as "null OR different".
    let q = db.from('tracker_moves').select('id').eq('company_id', companyId).eq('tracker_id', m.tracker_id)
      .is('undone_at', null).gt('created_at', m.created_at)
    if (typeof m.note === 'string' && m.note.startsWith('group:')) q = q.or(`note.is.null,note.neq.${m.note}`)
    const { data: later } = await q.limit(1)
    if (later?.length) return { ok: false, error: `Tracker …${m.tracker_id.slice(-4)} was changed again after this. Undo the newer change first.` }
  }

  let undone = 0
  for (const m of batch) {
    const from = m.from_asset_id ? await loadAsset(db, companyId, m.from_asset_id) : null
    const to = m.to_asset_id ? await loadAsset(db, companyId, m.to_asset_id) : null
    switch (m.kind as MoveRow['kind']) {
      case 'attach': {
        if (!to) break
        if (to.tracker_id === m.tracker_id) await db.from('assets').update({ tracker_id: null }).eq('id', to.id).eq('company_id', companyId)
        await refillBuffer(db, companyId, m.tracker_id, to.id, m.swap_at)
        await db.from('device_onboarding').update({ unassigned_since: m.swap_at }).eq('company_id', companyId).eq('imei', m.tracker_id)
        break
      }
      case 'detach': {
        if (!from) break
        if (from.tracker_id && from.tracker_id !== m.tracker_id) return { ok: false, error: `"${from.name}" now wears a different tracker. Take it off first.` }
        // Whatever reported from the drawer since the pull was really this asset.
        await drainBuffer(db, companyId, m.tracker_id, from.id, m.swap_at)
        await db.from('assets').update({ tracker_id: m.tracker_id }).eq('id', from.id).eq('company_id', companyId)
        await db.from('device_onboarding').update({ unassigned_since: null }).eq('company_id', companyId).eq('imei', m.tracker_id)
        break
      }
      case 'move': {
        if (!to) break
        if (from && from.tracker_id && from.tracker_id !== m.tracker_id) return { ok: false, error: `"${from.name}" now wears a different tracker. Take it off first.` }
        await refillBuffer(db, companyId, m.tracker_id, to.id, m.swap_at)
        if (from) await movePings(db, companyId, to.id, from.id, m.swap_at, 'gte')
        if (to.tracker_id === m.tracker_id) await db.from('assets').update({ tracker_id: null }).eq('id', to.id).eq('company_id', companyId)
        if (from) await db.from('assets').update({ tracker_id: m.tracker_id }).eq('id', from.id).eq('company_id', companyId)
        break
      }
      case 'split_history': {
        if (!from || !to) break
        await movePings(db, companyId, to.id, from.id, m.swap_at, 'lt')
        break
      }
    }
    await db.from('tracker_moves').update({ undone_at: new Date().toISOString() }).eq('id', m.id)
    undone++
  }
  return { ok: true, undone }
}

/* ────────────────────────────────────────────────────────────────────────── */
/* Soft delete                                                               */
/* ────────────────────────────────────────────────────────────────────────── */

export async function softDeleteAsset(companyId: string, assetId: string): Promise<{ ok: boolean; error?: string }> {
  if (isMock) return { ok: false, error: 'Demo mode — changes are not saved.' }
  const { createServiceClient } = await import('../supabase-server')
  const db = createServiceClient()
  const a = await loadAsset(db, companyId, assetId)
  if (!a) return { ok: false, error: 'Asset not found.' }
  // The tracker is released by going inactive (084 keys on active rows) and
  // parked in the drawer, so it can be put on the next machine right away.
  if (a.tracker_id && !a.tracker_id.startsWith('phone-')) {
    await ensureRegistered(db, companyId, a.tracker_id)
    await db.from('device_onboarding').update({ unassigned_since: new Date().toISOString() }).eq('company_id', companyId).eq('imei', a.tracker_id)
  }
  const { error } = await db.from('assets').update({ active: false, deleted_at: new Date().toISOString() }).eq('id', assetId).eq('company_id', companyId)
  if (error) return { ok: false, error: 'Could not delete the asset.' }
  return { ok: true }
}

export async function restoreAsset(companyId: string, assetId: string): Promise<{ ok: boolean; error?: string; trackerReleased?: boolean }> {
  if (isMock) return { ok: false, error: 'Demo mode — changes are not saved.' }
  const { createServiceClient } = await import('../supabase-server')
  const db = createServiceClient()
  const a = await loadAsset(db, companyId, assetId)
  if (!a || !a.deleted_at) return { ok: false, error: 'Nothing to restore.' }
  // If its tracker was put on something else meanwhile, come back without it.
  let trackerReleased = false
  let tracker = a.tracker_id
  if (tracker) {
    const { data: holder } = await db.from('assets').select('id').eq('company_id', companyId).eq('tracker_id', tracker).eq('active', true).neq('id', assetId).maybeSingle()
    if (holder) { tracker = null; trackerReleased = true }
  }
  const { error } = await db.from('assets').update({ active: true, deleted_at: null, tracker_id: tracker }).eq('id', assetId).eq('company_id', companyId)
  if (error) return { ok: false, error: error.code === '23505' ? 'Its tracker is now on another asset — restore without it from the Trackers page.' : 'Could not restore.' }
  if (tracker) await db.from('device_onboarding').update({ unassigned_since: null }).eq('company_id', companyId).eq('imei', tracker)
  return { ok: true, trackerReleased }
}
