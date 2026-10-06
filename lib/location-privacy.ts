import type { SupabaseClient } from '@supabase/supabase-js'
import { beaconCandidates, toolMatcher, type BeaconNumbering, type BeaconSighting } from './ble-sightings'
import {
  ANON_KEEP_MS, anonFold, anonRank, placeTag, privacyZonesFromRows,
  type PrivacyZoneHit, type PrivacyZoneShape, type TagPlacement,
} from './location-policy'
import { assetVisibility, visibilityRank } from './permissions'

/**
 * The database half of location privacy (migration 132): who is on the
 * clock, which zones are private, which assets are in recovery, and the
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
const zoneCache = new Map<string, { at: number; zones: PrivacyZoneShape[] }>()

/**
 * The company's privacy zones as the server sees them — all of them, a
 * personal one included (drawn "only me" so nobody else sees the outline of,
 * say, someone's home, it still protects every phone). Cached 30 s per
 * server instance, so a newly marked zone takes effect within half a minute.
 * A failed read THROWS (PrivacyCheckFailed); a database without 132 has none.
 */
export async function loadPrivacyZones(db: SupabaseClient, companyId: string): Promise<PrivacyZoneShape[]> {
  const hit = zoneCache.get(companyId)
  if (hit && Date.now() - hit.at < ZONE_TTL_MS) return hit.zones
  const { data, error } = await db.from('geofences_json')
    .select('id, name, kind, privacy_zone, geometry')
    .eq('company_id', companyId).eq('privacy_zone', true)
    .limit(200)
  if (error) {
    if (notMigrated(error)) return []
    throw new PrivacyCheckFailed(error.message)
  }
  const zones = privacyZonesFromRows((data ?? []) as { id: string; name?: string | null; kind?: string | null; privacy_zone?: boolean | null; geometry?: unknown }[])
  zoneCache.set(companyId, { at: Date.now(), zones })
  return zones
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
 * filed in `tool_sightings` at their placement — a ~250 m cell, the privacy
 * zone's centre, or a recovery's exact spot (lib/location-policy `placeTag`).
 * The row names no phone and no person, and custody (tool_associations,
 * pairing_log) is never touched. `visibleRank` is the reporting phone's own
 * 111 level (lib/location-policy `reporterRank`): what the owner's hidden
 * phone heard stays owner-only. Never throws — sightings are additive.
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
      const done = await foldSighting(db, companyId, toolId, placement, atMs, anonRank(ctx.visibleRank, holders.get(toolId) ?? null, atMs))
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

async function foldSighting(db: SupabaseClient, companyId: string, toolId: string, p: TagPlacement, atMs: number, rank: number): Promise<'extend' | 'insert' | 'skip'> {
  if (!Number.isFinite(atMs)) return 'skip'
  const iso = new Date(atMs).toISOString()
  const { data: last, error } = await db.from('tool_sightings')
    .select('id, lat, lng, reason, last_seen, heard_n, visible_rank')
    .eq('tool_asset_id', toolId)
    .order('last_seen', { ascending: false }).limit(1).maybeSingle()
  if (error) return 'skip'
  const decision = anonFold(
    last ? { lat: Number(last.lat), lng: Number(last.lng), reason: String(last.reason), lastSeenMs: Date.parse(String(last.last_seen)), rank: Number(last.visible_rank) || 0 } : null,
    { ...p, atMs, rank },
  )
  if (decision === 'extend' && last) {
    // `.lt` = compare-and-set: two reports racing never walk last_seen back.
    await db.from('tool_sightings').update({ last_seen: iso, heard_n: (Number(last.heard_n) || 1) + 1 })
      .eq('id', last.id).lt('last_seen', iso)
  } else if (decision === 'insert') {
    const { error: insErr } = await db.from('tool_sightings').insert({
      company_id: companyId, tool_asset_id: toolId, lat: p.lat, lng: p.lng,
      precision_m: p.precisionM, reason: p.reason, first_seen: iso, last_seen: iso, visible_rank: rank,
    })
    if (insErr) return 'skip'
  }
  return decision
}
