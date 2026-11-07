/**
 * The plan room's reads (migration 143). RLS decides the company and hides
 * deleted rows; the caller's own NEW-dot rows (plan_seen, service role only)
 * are read on the server for the signed-in person alone.
 */
import {
  currentOf, isNewFor, newestFirst,
  type RoomSet, type RoomSheet, type RoomVersion, type PlanSetKind,
} from '@/lib/plans/room'

const isMock = !process.env.NEXT_PUBLIC_SUPABASE_URL ||
  process.env.NEXT_PUBLIC_SUPABASE_URL === 'https://your-project.supabase.co'

type Corner = [number, number]
export type Corners = [Corner, Corner, Corner, Corner]

export interface PlanImage {
  id: string
  url: string
  bounds: Corners | null
  mapActive: boolean
}

export interface PlanFile { id: string; setId: string; name: string; pages: number | null; bytes: number | null }

export interface PlanSetRow extends RoomSet {
  files: PlanFile[]
  /** Versions this set issued (live ones). */
  versionCount: number
}

export interface PlanSheetRow extends RoomSheet {
  /** Newest first. */
  versions: RoomVersion[]
  currentId: string | null
  isNew: boolean
}

export interface PlanRoomData {
  available: boolean
  /** The read failed for a reason other than the tables not existing yet. */
  failed?: boolean
  sets: PlanSetRow[]
  sheets: PlanSheetRow[]
  images: Record<string, PlanImage>
  me: string | null
}

const EMPTY: PlanRoomData = { available: false, sets: [], sheets: [], images: {}, me: null }

function validCorners(b: unknown): b is Corners {
  return Array.isArray(b) && b.length === 4 && b.every((c) =>
    Array.isArray(c) && c.length === 2 && Number.isFinite(c[0]) && Number.isFinite(c[1]) &&
    Math.abs(c[0]) <= 180 && Math.abs(c[1]) <= 90)
}

export function chunks<T>(xs: T[], n: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < xs.length; i += n) out.push(xs.slice(i, i + n))
  return out
}

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)

export function versionFromRow(r: Record<string, unknown>): RoomVersion {
  const ink = Array.isArray(r.ink_box) && r.ink_box.length === 4 && r.ink_box.every((x) => typeof x === 'number') ? r.ink_box as number[] : null
  const crop = r.crop && typeof r.crop === 'object' ? r.crop as RoomVersion['crop'] : null
  return {
    id: String(r.id),
    sheetId: String(r.sheet_id),
    setId: (r.set_id as string | null) ?? null,
    fileId: (r.file_id as string | null) ?? null,
    imageId: (r.image_id as string | null) ?? null,
    page: num(r.page),
    rev: (r.rev as string | null) ?? null,
    issuedOn: String(r.issued_on ?? ''),
    createdAt: String(r.created_at ?? ''),
    createdBy: (r.created_by as string | null) ?? null,
    signature: (r.signature as string | null) ?? null,
    pageW: num(r.page_w),
    pageH: num(r.page_h),
    inkBox: ink,
    feetPerInch: num(r.feet_per_inch),
    scaleText: (r.scale_text as string | null) ?? null,
    placement: r.placement && typeof r.placement === 'object' ? r.placement as RoomVersion['placement'] : null,
    crop,
    scaleChecks: Array.isArray(r.scale_checks) ? (r.scale_checks as RoomVersion['scaleChecks']) : null,
  }
}

export const VERSION_COLS = 'id, sheet_id, set_id, file_id, image_id, page, rev, issued_on, created_at, created_by, signature, page_w, page_h, ink_box, feet_per_inch, scale_text, placement, crop, scale_checks'

export function sheetFromRow(r: Record<string, unknown>): RoomSheet {
  return {
    id: String(r.id),
    number: String(r.number ?? ''),
    numberKey: String(r.number_key ?? ''),
    title: (r.title as string | null) ?? null,
    discipline: (r.discipline as string | null) ?? null,
    pinnedVersionId: (r.current_version_id as string | null) ?? null,
    voidedAt: (r.voided_at as string | null) ?? null,
    createdAt: String(r.created_at ?? ''),
  }
}

/** One site's plan room: sets (newest first), sheets with every live
 *  version, the pictures those versions point at, and my NEW dots. */
export async function getPlanRoom(zoneId: string, me: string | null): Promise<PlanRoomData> {
  if (isMock || !/^[0-9a-f-]{36}$/i.test(zoneId)) return EMPTY
  try {
    const { createClient, createServiceClient } = await import('@/lib/supabase-server')
    const db = createClient()
    const [setsQ, filesQ, sheetsQ, imgsQ] = await Promise.all([
      db.from('plan_sets').select('id, name, kind, issued_on, created_at').eq('geofence_id', zoneId)
        .order('issued_on', { ascending: false }).order('created_at', { ascending: false }).limit(500),
      db.from('plan_files').select('id, set_id, name, pages, bytes').eq('geofence_id', zoneId).limit(1000),
      db.from('plan_sheets').select('id, number, number_key, title, discipline, current_version_id, voided_at, created_at')
        .eq('geofence_id', zoneId).limit(2000),
      db.from('zone_imagery').select('id, url, bounds, map_active').eq('geofence_id', zoneId).eq('kind', 'plan').limit(5000),
    ])
    if (setsQ.error || sheetsQ.error) {
      // Pre-143 (no table) is "not available"; anything else is a failed read
      // — never a reason to show the old Scaled plans card, whose radio would
      // clear every sheet's map flag.
      const e = setsQ.error ?? sheetsQ.error
      const missing = e?.code === '42P01' || e?.code === 'PGRST205' || /does not exist|could not find the table/i.test(e?.message ?? '')
      return missing ? EMPTY : { ...EMPTY, failed: true }
    }
    const sheetIds = (sheetsQ.data ?? []).map((r) => String(r.id))
    const versions: RoomVersion[] = []
    const seen = new Map<string, string>()
    const svc = me ? createServiceClient() : null
    for (const ids of chunks(sheetIds, 150)) {
      const [vq, sq] = await Promise.all([
        db.from('plan_versions').select(VERSION_COLS).in('sheet_id', ids).limit(5000),
        svc ? svc.from('plan_seen').select('sheet_id, version_id').eq('user_id', me!).in('sheet_id', ids) : Promise.resolve({ data: [], error: null }),
      ])
      if (vq.error) return EMPTY
      for (const r of vq.data ?? []) versions.push(versionFromRow(r as Record<string, unknown>))
      for (const r of (sq.data ?? []) as { sheet_id: string; version_id: string }[]) seen.set(String(r.sheet_id), String(r.version_id))
    }
    const bySheet = new Map<string, RoomVersion[]>()
    for (const v of versions) {
      if (!bySheet.has(v.sheetId)) bySheet.set(v.sheetId, [])
      bySheet.get(v.sheetId)!.push(v)
    }
    const sheets: PlanSheetRow[] = (sheetsQ.data ?? []).map((r) => {
      const s = sheetFromRow(r as Record<string, unknown>)
      const vs = (bySheet.get(s.id) ?? []).sort(newestFirst)
      const cur = currentOf(s, vs)
      return { ...s, versions: vs, currentId: cur?.id ?? null, isNew: isNewFor(me, cur, seen.get(s.id)) }
    })
    const files = (filesQ.data ?? []).map((r) => ({
      id: String(r.id), setId: String(r.set_id), name: String(r.name ?? ''),
      pages: num(r.pages), bytes: num(r.bytes),
    }))
    const perSet = new Map<string, number>()
    for (const v of versions) if (v.setId) perSet.set(v.setId, (perSet.get(v.setId) ?? 0) + 1)
    const sets: PlanSetRow[] = (setsQ.data ?? []).map((r) => ({
      id: String(r.id), name: String(r.name ?? ''), kind: (r.kind as PlanSetKind) ?? 'other',
      issuedOn: String(r.issued_on ?? ''), createdAt: String(r.created_at ?? ''),
      files: files.filter((f) => f.setId === r.id),
      versionCount: perSet.get(String(r.id)) ?? 0,
    }))
    const images: Record<string, PlanImage> = {}
    for (const r of imgsQ.data ?? []) {
      images[String(r.id)] = { id: String(r.id), url: String(r.url), bounds: validCorners(r.bounds) ? r.bounds : null, mapActive: r.map_active === true }
    }
    return { available: true, sets, sheets, images, me }
  } catch {
    return EMPTY
  }
}

export interface PlanSiteRow {
  zoneId: string
  name: string
  kind: string | null
  sheets: number
  sets: number
  newest: { name: string; kind: string; issuedOn: string } | null
  /** Newest upload anywhere in the site's plan room (ISO). */
  activityAt: string | null
  newCount: number
}

/** Every site with a plan room, newest activity first (/plans). */
export async function getPlanSites(me: string | null): Promise<PlanSiteRow[]> {
  if (isMock) return []
  try {
    const { createClient, createServiceClient } = await import('@/lib/supabase-server')
    const db = createClient()
    const [setsQ, sheetsQ, versQ] = await Promise.all([
      db.from('plan_sets').select('id, geofence_id, name, kind, issued_on, created_at').limit(5000),
      db.from('plan_sheets').select('id, geofence_id, current_version_id').limit(10000),
      db.from('plan_versions').select('id, sheet_id, issued_on, created_at, created_by').limit(20000),
    ])
    if (setsQ.error || sheetsQ.error) return []
    const zoneIds = Array.from(new Set([...(setsQ.data ?? []), ...(sheetsQ.data ?? [])].map((r) => String(r.geofence_id))))
    if (!zoneIds.length) return []
    const { data: zones } = await db.from('geofences').select('id, name, kind').in('id', zoneIds.slice(0, 300))
    const zoneName = new Map((zones ?? []).map((z) => [String(z.id), { name: String(z.name ?? 'Site'), kind: (z.kind as string | null) ?? null }]))
    const vBySheet = new Map<string, RoomVersion[]>()
    for (const r of versQ.data ?? []) {
      const v = versionFromRow(r as Record<string, unknown>)
      if (!vBySheet.has(v.sheetId)) vBySheet.set(v.sheetId, [])
      vBySheet.get(v.sheetId)!.push(v)
    }
    let seen = new Map<string, string>()
    if (me) {
      try {
        const { data } = await createServiceClient().from('plan_seen').select('sheet_id, version_id').eq('user_id', me).limit(20000)
        seen = new Map((data ?? []).map((r) => [String(r.sheet_id), String(r.version_id)]))
      } catch { /* dots only */ }
    }
    const out = new Map<string, PlanSiteRow>()
    const row = (zoneId: string): PlanSiteRow => {
      let r = out.get(zoneId)
      if (!r) {
        const z = zoneName.get(zoneId)
        r = { zoneId, name: z?.name ?? 'Site', kind: z?.kind ?? null, sheets: 0, sets: 0, newest: null, activityAt: null, newCount: 0 }
        out.set(zoneId, r)
      }
      return r
    }
    const later = (a: string | null, b: string | null) => (!a ? b : !b ? a : a > b ? a : b)
    for (const s of setsQ.data ?? []) {
      const r = row(String(s.geofence_id))
      r.sets++
      const cand = { name: String(s.name ?? ''), kind: String(s.kind ?? 'other'), issuedOn: String(s.issued_on ?? '') }
      if (!r.newest || cand.issuedOn > r.newest.issuedOn) r.newest = cand
      r.activityAt = later(r.activityAt, String(s.created_at ?? ''))
    }
    for (const s of sheetsQ.data ?? []) {
      const r = row(String(s.geofence_id))
      r.sheets++
      const vs = vBySheet.get(String(s.id)) ?? []
      for (const v of vs) r.activityAt = later(r.activityAt, v.createdAt)
      const cur = currentOf({ pinnedVersionId: (s.current_version_id as string | null) ?? null }, vs)
      if (isNewFor(me, cur, seen.get(String(s.id)))) r.newCount++
    }
    return Array.from(out.values())
      .filter((r) => zoneName.has(r.zoneId))
      .sort((a, b) => (b.activityAt ?? '').localeCompare(a.activityAt ?? '') || a.name.localeCompare(b.name))
  } catch {
    return []
  }
}
