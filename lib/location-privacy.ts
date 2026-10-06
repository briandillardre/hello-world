import type { SupabaseClient } from '@supabase/supabase-js'
import { beaconCandidates, toolMatcher, type BeaconNumbering, type BeaconSighting } from './ble-sightings'
import {
  ANON_INSERT_GAP_MS, ANON_KEEP_MS, PRIVACY_EDGE_MAX_M, anonFold, anonSightingRank, placeTag, privacyZonesFromRows, ringsNear, workZonesFromRows,
  type AnonFoldDecision, type PrivacyZoneHit, type PrivacyZoneSet, type TagPlacement,
} from './location-policy'
import { assetVisibility, visibilityRank, normalizeRole, RANK, MASTER_RANK } from './permissions'

/**
 * The database half of location privacy (migrations 132 + 133): who is on
 * the clock, which zones are private, which assets are in recovery, and the
 * anonymous tag sightings a phone files when its own fix is not kept. The
 * rule itself is lib/location-policy.ts (pure, harnessed). Server-only:
 * every read here runs as the service role, after the caller's own checks.
 * docs/LOCATION-PRIVACY.md.
 */

/** A privacy-zone read failed — a passive path must answer "try again"
 *  rather than keep a point that may sit inside one. */
export class PrivacyCheckFailed extends Error {}

/** "No such column/table" — a database that has not run 132 yet. */
function notMigrated(e: { code?: string; message?: string } | null): boolean {
  if (!e) return false
  return e.code === '42703' || e.code === '42P01' || e.code === 'PGRST204' || e.code === 'PGRST205'
    || /does not exist|could not find/i.test(e.message ?? '')
}

const ZONE_TTL_MS = 30_000
const NO_ZONES: PrivacyZoneSet = { zones: [], work: [] }
const zoneCache = new Map<string, { at: number; set: PrivacyZoneSet }>()

type ZoneRow = { id: string; name?: string | null; kind?: string | null; privacy_zone?: boolean | null; geometry?: unknown; owner_id?: string | null }

/**
 * The company's privacy zones as the server sees them — all of them, a
 * personal one included (drawn "only me" so nobody else sees the outline of,
 * say, someone's home, it still protects every phone) — with, for a personal
 * one, its maker and the maker's ladder rank (a tag placed there is read at
 * no lower level), and the sites and yards that overlap any of them or sit
 * within reach of its edge (150 m): a fix inside a site or yard is kept —
 * crews work there, time cards check it.
 * Cached 30 s per server instance, so a newly marked zone takes effect
 * within half a minute. A failed zone read THROWS (PrivacyCheckFailed); a
 * database without 132 has none. A failed owner or site read keeps the safe
 * side (owner-only; no site exemption) and is not cached.
 */
export async function loadPrivacyZones(db: SupabaseClient, companyId: string): Promise<PrivacyZoneSet> {
  const hit = zoneCache.get(companyId)
  if (hit && Date.now() - hit.at < ZONE_TTL_MS) return hit.set
  const { data, error } = await db.from('geofences_json')
    .select('id, name, kind, privacy_zone, geometry, owner_id')
    .eq('company_id', companyId).eq('privacy_zone', true)
    .limit(200)
  if (error) {
    if (notMigrated(error)) return NO_ZONES
    throw new PrivacyCheckFailed(error.message)
  }
  const zones = privacyZonesFromRows((data ?? []) as ZoneRow[])
  if (!zones.length) {
    zoneCache.set(companyId, { at: Date.now(), set: NO_ZONES })
    return NO_ZONES
  }
  let complete = true
  const owners = Array.from(new Set(zones.map((z) => z.ownerId).filter((x): x is string => !!x)))
  if (owners.length) {
    const { data: people, error: pErr } = await db.from('profiles').select('id, role').in('id', owners)
    if (pErr) complete = false
    const rank = new Map((people ?? []).map((p) => [p.id as string, p.id === companyId ? MASTER_RANK : RANK[normalizeRole(p.role as string | null, 'associate')]]))
    // A maker no longer on record can hide nothing less than owner-only.
    for (const z of zones) if (z.ownerId) z.ownerRank = rank.get(z.ownerId) ?? MASTER_RANK
  }
  const { data: workRows, error: wErr } = await db.from('geofences_json')
    .select('id, kind, geometry')
    .eq('company_id', companyId).in('kind', ['site', 'yard'])
    .limit(2000)
  if (wErr) complete = false
  const work = workZonesFromRows((workRows ?? []) as ZoneRow[]).filter((w) => zones.some((z) => ringsNear(z.ring, w.ring, PRIVACY_EDGE_MAX_M)))
  const set: PrivacyZoneSet = { zones, work }
  if (complete) zoneCache.set(companyId, { at: Date.now(), set })
  return set
}

/** Drop this instance's cached zones after a change (the zone page's switch). */
export function forgetPrivacyZones(companyId: string): void {
  zoneCache.delete(companyId)
}

/** On the clock right now = an open time entry (the same test the shift
 *  recorder's route uses). A failed read reads as OFF the clock — the safe
 *  side: nothing of the person is kept, their tags still land roughly. */
export async function isOnShift(db: SupabaseClient, companyId: string, userId: string): Promise<boolean> {
  const { data, error } = await db.from('time_entries').select('id')
    .eq('company_id', companyId).eq('user_id', userId).is('clock_out_at', null)
    .limit(1).maybeSingle()
  return !error && !!data
}

/** Assets in recovery right now (started, not stopped, not run out). A
 *  failed read = none: their tags land on the rough grid, the safe side. */
export async function activeRecoveryIds(db: SupabaseClient, companyId: string): Promise<Set<string>> {
  const { data, error } = await db.from('asset_recovery').select('asset_id')
    .eq('company_id', companyId).is('ended_at', null).gt('expires_at', new Date().toISOString())
    .limit(500)
  if (error) return new Set()
  return new Set((data ?? []).map((r) => r.asset_id as string))
}

/**
 * Tags heard by a phone whose own fix is NOT kept (off the clock, or inside
 * a privacy zone): matched to the company's tools exactly like custody, then
 * filed in `tool_sightings` at their placement — a ~250 m cell, the 250 m
 * cell of a privacy zone's centre, or a recovery's exact spot
 * (lib/location-policy `placeTag`). The row names no phone and no person,
 * and custody (tool_associations, pairing_log) is never touched. Its level
 * (`anonSightingRank`): the reporting phone's own 111 level, raised to the
 * tag's custody holder's, to a personal zone's maker's, and to Admins for a
 * recovery's exact spot. Never throws — sightings are additive.
 */
export async function recordAnonymousSightings(
  db: SupabaseClient,
  companyId: string,
  beacons: BeaconSighting[],
  fix: { lat: number; lng: number; timestamp: string },
  ctx: { privacyZone: PrivacyZoneHit | null; recovery: ReadonlySet<string>; visibleRank: number },
  opts: { reportedAs?: BeaconNumbering } = {},
): Promise<{ matched: number; placed: number }> {
  let matched = 0
  let placed = 0
  try {
    const findTool = await toolMatcher(db, companyId)
    if (!findTool) return { matched, placed }
    const toolIds = new Set<string>()
    for (const b of beacons) {
      if (!b?.id) continue
      const id = findTool(beaconCandidates(b.id, opts.reportedAs ?? 'hex'))
      if (id) toolIds.add(id)
    }
    matched = toolIds.size
    if (!matched) return { matched, placed }
    const atMs = Date.parse(fix.timestamp)
    const holders = await holderRanks(db, Array.from(toolIds))
    let trimmed = false
    for (const toolId of Array.from(toolIds)) {
      const placement = placeTag(fix, { privacyZone: ctx.privacyZone, inRecovery: ctx.recovery.has(toolId) })
      const rank = anonSightingRank({ reporter: ctx.visibleRank, holder: holders.get(toolId) ?? null, atMs, placement, zone: ctx.privacyZone })
      const done = await foldSighting(db, companyId, toolId, placement, atMs, rank)
      if (done === 'insert' && !trimmed) {
        trimmed = true
        // 30 days and gone: trimmed whenever a new row lands (indexed range).
        await db.from('tool_sightings').delete()
          .eq('company_id', companyId).lt('last_seen', new Date(Date.now() - ANON_KEEP_MS).toISOString())
      }
      if (done !== 'skip') placed++
    }
  } catch { /* additive — the caller's report still succeeds */ }
  return { matched, placed }
}

/** Each tag's custody holder's visibility rank (111) and when it last heard
 *  the tag — a hidden truck's tag stays hidden (lib/location-policy `anonRank`). */
async function holderRanks(db: SupabaseClient, toolIds: string[]): Promise<Map<string, { rank: number; seenMs: number }>> {
  const out = new Map<string, { rank: number; seenMs: number }>()
  const { data: holds } = await db.from('tool_associations').select('tool_asset_id, gateway_asset_id, last_seen').in('tool_asset_id', toolIds)
  if (!holds?.length) return out
  const gwIds = Array.from(new Set(holds.map((h) => h.gateway_asset_id as string)))
  const { data: gws } = await db.from('assets').select('id, metadata').in('id', gwIds)
  const gwRank = new Map((gws ?? []).map((g) => [g.id as string, visibilityRank(assetVisibility(g.metadata))]))
  for (const h of holds) {
    const rank = gwRank.get(h.gateway_asset_id as string)
    // A holder that is gone (deleted) can hide nothing — and an unreadable
    // one is treated as hidden from everyone below the owner.
    out.set(h.tool_asset_id as string, { rank: rank ?? (gws ? 0 : 4), seenMs: Date.parse(h.last_seen as string) })
  }
  return out
}

/**
 * One tool, one placement → the fold (lib/location-policy `anonFold`):
 * against the tool's newest row at the SAME level and reason, with the
 * tool's newest row of any kind for the one-new-row-per-2-minutes cap.
 * Updates are compare-and-set on last_seen: two reports racing never walk
 * it back, and the loser changes nothing.
 */
async function foldSighting(db: SupabaseClient, companyId: string, toolId: string, p: TagPlacement, atMs: number, rank: number): Promise<AnonFoldDecision> {
  if (!Number.isFinite(atMs)) return 'skip'
  const iso = new Date(atMs).toISOString()
  const [lastRes, recentRes] = await Promise.all([
    db.from('tool_sightings')
      .select('id, lat, lng, reason, first_seen, last_seen, place_since, heard_n, visible_rank')
      .eq('company_id', companyId).eq('tool_asset_id', toolId)
      .eq('reason', p.reason).eq('visible_rank', rank)
      .order('last_seen', { ascending: false }).limit(1).maybeSingle(),
    db.from('tool_sightings')
      .select('first_seen')
      .eq('company_id', companyId).eq('tool_asset_id', toolId)
      .gt('first_seen', new Date(atMs - ANON_INSERT_GAP_MS).toISOString())
      .order('first_seen', { ascending: false }).limit(1).maybeSingle(),
  ])
  if (lastRes.error || recentRes.error) return 'skip'
  const last = lastRes.data
  const decision = anonFold(
    last ? {
      lat: Number(last.lat), lng: Number(last.lng), reason: String(last.reason), rank: Number(last.visible_rank) || 0,
      lastSeenMs: Date.parse(String(last.last_seen)),
      firstSeenMs: Date.parse(String(last.first_seen)),
      placeSinceMs: last.place_since ? Date.parse(String(last.place_since)) : null,
    } : null,
    { ...p, atMs, rank },
    { lastInsertMs: recentRes.data ? Date.parse(String(recentRes.data.first_seen)) : null },
  )
  const heard = (Number(last?.heard_n) || 1) + 1
  if (decision === 'extend' && last) {
    const { error } = await db.from('tool_sightings').update({ last_seen: iso, heard_n: heard })
      .eq('id', last.id).lt('last_seen', iso)
    if (error) return 'skip'
  } else if (decision === 'move' && last) {
    // Still on the move: the row follows the tag — one row per run, not one per cell.
    const { error } = await db.from('tool_sightings')
      .update({ lat: p.lat, lng: p.lng, precision_m: p.precisionM, last_seen: iso, place_since: iso, heard_n: heard })
      .eq('id', last.id).lt('last_seen', iso)
    if (error) return 'skip'
  } else if (decision === 'insert') {
    const { error: insErr } = await db.from('tool_sightings').insert({
      company_id: companyId, tool_asset_id: toolId, lat: p.lat, lng: p.lng,
      precision_m: p.precisionM, reason: p.reason, first_seen: iso, last_seen: iso, visible_rank: rank,
    })
    if (insErr) return 'skip'
  }
  return decision
}
