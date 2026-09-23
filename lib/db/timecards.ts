import type { SupabaseClient } from '@supabase/supabase-js'
import { pointInPolygon } from '@/lib/alerts-engine'
import { lookupCachedPlaces } from '@/lib/reverse-geocode'
import { formatPlace, placeKey, type PlaceParts } from '@/lib/place-label'
import { buildTimeCards, weekStartKey, type FlagPolicy, type PersonCard, type TimeCardEntry, type TimeCardGps } from '@/lib/timecards'
import { addDaysKey, isDayKey, zonedMidnightMs } from '@/lib/dates'
import { resolveClockPolicy } from '@/lib/clock-policy'
import type { Permissions } from '@/lib/permissions'

/**
 * Time cards — the loader. Reads time_entries for a window, joins the job
 * sites, asks the database for each shift's phone-fix stats (migration 120,
 * falling back to 103's function on an older database) and words the
 * clock-in / clock-out spots (zone → cached address). Pure math lives in
 * lib/timecards.ts; this file only fetches.
 *
 * Works with a session client (RLS = the caller's company) or the service
 * client scoped by `companyId` (MCP, crons).
 */
export interface TimeCardsResult {
  cards: PersonCard[]
  /** False when the 103/120 RPC is missing (pre-migration database) — cards carry no GPS numbers then. */
  verified: boolean
  /** True when the 120 function answered (arrive/leave/away/still reads exist). */
  integrity: boolean
}

interface EntryRow {
  id: string; user_id: string; person_name: string; category: string; project_geofence_id: string | null; plan: string | null
  clock_in_at: string; clock_out_at: string | null
  in_lat?: number | null; in_lng?: number | null; out_lat?: number | null; out_lng?: number | null
  break_minutes?: number | null; edited_by?: string | null; edited_at?: string | null; edit_note?: string | null
  original_in_at?: string | null; original_out_at?: string | null
  device_id?: string | null; out_device_id?: string | null; in_photo_path?: string | null; out_photo_path?: string | null
}

interface StatsV2 {
  entry_id: string; fixes: number; on_site: number; first_fix: string | null; last_fix: string | null
  first_on_site?: string | null; last_on_site?: string | null; spread_m?: number | null
  in_dist_m?: number | null; out_dist_m?: number | null; in_at_yard?: boolean | null; out_at_yard?: boolean | null
}

const isMock = !process.env.NEXT_PUBLIC_SUPABASE_URL ||
  process.env.NEXT_PUBLIC_SUPABASE_URL === 'https://your-project.supabase.co'

/** Signed read URLs last this long — a page view, not a share. */
const PHOTO_URL_SECS = 3600

export async function getTimeCards(db: SupabaseClient, opts: {
  companyId: string
  fromMs: number
  toMs: number
  tz: string
  /** Restrict to these people (a crew member sees only their own card). */
  userIds?: string[] | null
  nowMs?: number
  /** Skip minting signed photo URLs (the CSV, the AI tool). */
  withPhotos?: boolean
}): Promise<TimeCardsResult> {
  if (isMock) return { cards: [], verified: false, integrity: false }
  const nowMs = opts.nowMs ?? Date.now()

  let q = db.from('time_entries').select('*')
    .eq('company_id', opts.companyId)
    .gte('clock_in_at', new Date(opts.fromMs).toISOString())
    .lt('clock_in_at', new Date(opts.toMs).toISOString())
    .order('clock_in_at', { ascending: true })
    .limit(3000)
  if (opts.userIds?.length) q = q.in('user_id', opts.userIds)
  const [{ data, error }, policyRes] = await Promise.all([
    q,
    // The company's photo switches (120): a missing photo is only a finding
    // when one was required. Tolerant — an older database has no column.
    db.from('companies').select('clock_policy').eq('id', opts.companyId).maybeSingle(),
  ])
  if (error || !data?.length) return { cards: [], verified: !error, integrity: false }
  const rows = data as EntryRow[]
  const pol = resolveClockPolicy((policyRes.data as { clock_policy?: unknown } | null)?.clock_policy ?? null)
  const policy: FlagPolicy = { photoIn: pol.photoIn, photoOut: pol.photoOut }

  // Job sites: names for the rows + polygons to word the clock-in/out spots.
  const zoneIds = Array.from(new Set(rows.map((r) => r.project_geofence_id).filter((z): z is string => !!z)))
  const [zonesRes, allZonesRes] = await Promise.all([
    zoneIds.length ? db.from('geofences').select('id, name').in('id', zoneIds) : Promise.resolve({ data: [] as { id: string; name: string }[] }),
    db.from('geofences_json').select('id, name, kind, geometry').eq('company_id', opts.companyId).limit(500),
  ])
  const zoneName = new Map((zonesRes.data ?? []).map((z) => [z.id as string, z.name as string]))
  const polys = ((allZonesRes.data ?? []) as { id: string; name: string; kind: string | null; geometry: GeoJSON.Polygon | null }[])
    .filter((z) => z.kind !== 'boundary' && z.geometry?.type === 'Polygon' && Array.isArray(z.geometry.coordinates?.[0]))
    .map((z) => ({ name: z.name, ring: z.geometry!.coordinates[0] as [number, number][] }))

  // Phone-fix stats per entry: 120's function first (arrive / leave / away /
  // still), 103's when the database has not caught up, neither = unverified.
  const gps = new Map<string, TimeCardGps>()
  let verified = true
  let integrity = true
  for (let i = 0; i < rows.length; i += 200) {
    const ids = rows.slice(i, i + 200).map((r) => r.id)
    let { data: stats, error: rpcErr } = await db.rpc('timecard_gps_stats_v2', { p_entry_ids: ids })
    if (rpcErr) {
      integrity = false
      ;({ data: stats, error: rpcErr } = await db.rpc('timecard_gps_stats', { p_entry_ids: ids }))
    }
    if (rpcErr) { verified = false; break }
    for (const s of (stats ?? []) as StatsV2[]) {
      gps.set(s.entry_id, {
        fixes: Number(s.fixes) || 0, onSite: Number(s.on_site) || 0, firstFix: s.first_fix, lastFix: s.last_fix,
        ...(integrity ? {
          firstOnSite: s.first_on_site ?? null, lastOnSite: s.last_on_site ?? null,
          spreadM: s.spread_m == null ? null : Number(s.spread_m),
          inDistM: s.in_dist_m == null ? null : Number(s.in_dist_m),
          outDistM: s.out_dist_m == null ? null : Number(s.out_dist_m),
          inAtYard: s.in_at_yard ?? null, outAtYard: s.out_at_yard ?? null,
        } : {}),
      })
    }
  }

  // Where the clock-in / clock-out happened, in words: a zone we own first,
  // then a cached reverse geocode (no network on this path), else nothing.
  const pts: { lat: number; lng: number }[] = []
  for (const r of rows) {
    if (r.in_lat != null && r.in_lng != null) pts.push({ lat: r.in_lat, lng: r.in_lng })
    if (r.out_lat != null && r.out_lng != null) pts.push({ lat: r.out_lat, lng: r.out_lng })
  }
  const empty: Record<string, PlaceParts | null> = {}
  const cached: Record<string, PlaceParts | null> = pts.length
    ? await lookupCachedPlaces(Array.from(new Set(pts.map((p) => placeKey(p.lat, p.lng))))).catch(() => empty)
    : empty
  const wordsFor = (lat: number | null | undefined, lng: number | null | undefined): string | null => {
    if (lat == null || lng == null) return null
    const zone = polys.find((z) => pointInPolygon([lng, lat], z.ring))
    if (zone) return `at ${zone.name}`
    return formatPlace(cached[placeKey(lat, lng)]) // already "near …" / "in …"
  }

  // Names for editors.
  const editorIds = Array.from(new Set(rows.map((r) => r.edited_by).filter((x): x is string => !!x)))
  const editors = new Map<string, string>()
  if (editorIds.length) {
    const { data: people } = await db.from('profiles').select('id, name').in('id', editorIds)
    for (const p of people ?? []) editors.set(p.id as string, (p.name as string) || 'Someone')
  }

  // Clock-in / clock-out photos live in a PRIVATE bucket (120): the page
  // gets short-lived signed URLs, minted only for rows the caller could
  // read (RLS already filtered them). One batched call per page.
  const photoUrl = new Map<string, string>()
  if (opts.withPhotos) {
    const paths = Array.from(new Set(rows.flatMap((r) => [r.in_photo_path, r.out_photo_path]).filter((p): p is string => !!p)))
    if (paths.length) {
      try {
        const { createServiceClient } = await import('@/lib/supabase-server')
        const { data: signed } = await createServiceClient().storage.from('clock-photos').createSignedUrls(paths.slice(0, 600), PHOTO_URL_SECS)
        for (const s of signed ?? []) if (s.path && s.signedUrl && !s.error) photoUrl.set(s.path, s.signedUrl)
      } catch { /* no photos this render */ }
    }
  }

  const entries: TimeCardEntry[] = rows.map((r) => ({
    id: r.id,
    userId: r.user_id,
    personName: r.person_name || 'Crew',
    category: r.category,
    zoneId: r.project_geofence_id,
    zoneName: r.project_geofence_id ? zoneName.get(r.project_geofence_id) ?? null : null,
    plan: r.plan ?? '',
    inAt: r.clock_in_at,
    outAt: r.clock_out_at,
    breakMinutes: Number(r.break_minutes) || 0,
    inLat: r.in_lat ?? null, inLng: r.in_lng ?? null, outLat: r.out_lat ?? null, outLng: r.out_lng ?? null,
    inPlace: wordsFor(r.in_lat, r.in_lng),
    outPlace: wordsFor(r.out_lat, r.out_lng),
    edited: r.edited_at ? {
      by: r.edited_by ? editors.get(r.edited_by) ?? 'Someone' : null,
      at: r.edited_at,
      note: r.edit_note ?? null,
      originalIn: r.original_in_at ?? null,
      originalOut: r.original_out_at ?? null,
    } : null,
    gps: verified ? (gps.get(r.id) ?? { fixes: 0, onSite: 0, firstFix: null, lastFix: null }) : null,
    deviceId: r.device_id ?? null,
    outDeviceId: r.out_device_id ?? null,
    inPhoto: !!r.in_photo_path,
    outPhoto: !!r.out_photo_path,
    inPhotoUrl: r.in_photo_path ? photoUrl.get(r.in_photo_path) ?? null : null,
    outPhotoUrl: r.out_photo_path ? photoUrl.get(r.out_photo_path) ?? null : null,
  }))

  return { cards: buildTimeCards(entries, { tz: opts.tz, nowMs, policy }), verified, integrity }
}

// ── Shared by the page and the CSV export ───────────────────────────────────

/** Who sees whose card. Crew (Associate) see their own; Foreman and up see the
 *  crew's; the Team or Billing ability edits (payroll runs from here). */
export function timecardScope(perms: Permissions, userId: string | null): { seesAll: boolean; userIds: string[] | null; canEdit: boolean } {
  const seesAll = perms.canManageTeam || perms.canManageBilling || perms.role === 'admin' || perms.role === 'manager' || perms.role === 'foreman'
  return {
    seesAll,
    userIds: seesAll ? null : (userId ? [userId] : ['00000000-0000-0000-0000-000000000000']),
    canEdit: (perms.canManageTeam || perms.canManageBilling) && !perms.viewingAs,
  }
}

/** The Monday-to-Monday window containing `week` (any day key; bad or missing = this week). */
export function weekOf(week: string | null | undefined, tz: string): { monday: string; fromMs: number; toMs: number } {
  const anchor = isDayKey(week) ? zonedMidnightMs(week, tz) + 12 * 3_600_000 : Date.now()
  const monday = weekStartKey(anchor, tz)
  return { monday, fromMs: zonedMidnightMs(monday, tz), toMs: zonedMidnightMs(addDaysKey(monday, 7), tz) }
}
