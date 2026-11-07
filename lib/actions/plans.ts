'use server'

/**
 * The plan room's writes (migration 143). Members hold SELECT only on the
 * plan tables, so every write here runs on the service client AFTER the edit
 * check and an explicit company check on every row it touches — the 138
 * pattern. The original PDFs go straight from the device to the private
 * 'plans' bucket through a one-time signed upload URL (Vercel's request cap
 * never sees them) and come back only as short signed links.
 */

import { revalidatePath } from 'next/cache'
import { requireEditOrThrow, getMyPermissions } from '@/lib/permissions-server'
import { getCurrentCompanyId } from '@/lib/db/company'
import {
  cleanNumber, numberKey, currentOf, newestFirst, disciplineOf, SET_KINDS,
  type RoomVersion, type PlanSetKind,
} from '@/lib/plans/room'
import { carryRule } from '@/lib/plans/fingerprint'
import { cleanCrop } from '@/lib/plans/crop'
import { versionFromRow, VERSION_COLS } from '@/lib/db/plans'

const isMock = !process.env.NEXT_PUBLIC_SUPABASE_URL ||
  process.env.NEXT_PUBLIC_SUPABASE_URL === 'https://your-project.supabase.co'

const UUID = /^[0-9a-f-]{36}$/i
const DAY = /^\d{4}-\d{2}-\d{2}$/
// 'use server' forbids exporting consts; the uploader mirrors this.
const PDF_MAX_BYTES = 50 * 1024 * 1024

type Res<T = object> = ({ ok: true } & T) | { ok: false; error: string }

const clip = (s: unknown, n: number): string => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, n)
const realDay = (d: string) => DAY.test(d) && !Number.isNaN(Date.parse(`${d}T00:00:00Z`)) && d >= '1980-01-01' && d <= '2100-12-31'

async function writer() {
  await requireEditOrThrow()
  const companyId = await getCurrentCompanyId()
  const { createClient, createServiceClient } = await import('@/lib/supabase-server')
  const { data: { user } } = await createClient().auth.getUser()
  return { companyId, userId: user?.id ?? null, svc: createServiceClient() }
}
type Svc = Awaited<ReturnType<typeof writer>>['svc']

function refresh(zoneId: string) {
  revalidatePath(`/plans/${zoneId}`)
  revalidatePath('/plans')
  revalidatePath(`/zones/${zoneId}`)
  revalidatePath('/map')
}

/** A site zone of the caller's company that can hold plans. */
async function ownZone(svc: Svc, companyId: string, zoneId: string): Promise<boolean> {
  if (!UUID.test(zoneId)) return false
  const { data } = await svc.from('geofences').select('id, kind').eq('id', zoneId).eq('company_id', companyId).maybeSingle()
  return !!data && data.kind !== 'boundary' && data.kind !== 'vendor'
}

async function ownSet(svc: Svc, companyId: string, setId: string) {
  if (!UUID.test(setId)) return null
  const { data } = await svc.from('plan_sets').select('id, geofence_id, kind, issued_on')
    .eq('id', setId).eq('company_id', companyId).is('deleted_at', null).maybeSingle()
  return data as { id: string; geofence_id: string; kind: PlanSetKind; issued_on: string } | null
}

async function ownSheet(svc: Svc, companyId: string, sheetId: string) {
  if (!UUID.test(sheetId)) return null
  const { data } = await svc.from('plan_sheets').select('id, geofence_id, current_version_id, number')
    .eq('id', sheetId).eq('company_id', companyId).is('deleted_at', null).maybeSingle()
  return data as { id: string; geofence_id: string; current_version_id: string | null; number: string } | null
}

/** Does a placement land on (or beside) the site? Its centre within 2 km of
 *  the zone's ring — a misread grid must never fly a sheet across the state. */
async function nearZone(svc: Svc, zoneId: string, b: [number, number][]): Promise<boolean> {
  const { data } = await svc.from('geofences_json').select('geometry').eq('id', zoneId).maybeSingle()
  const ring = (data?.geometry as { coordinates?: [number, number][][] } | null)?.coordinates?.[0]
  if (!ring?.length) return false
  const cx = (b[0][0] + b[2][0]) / 2, cy = (b[0][1] + b[2][1]) / 2
  const zx = ring.reduce((t, p) => t + p[0], 0) / ring.length, zy = ring.reduce((t, p) => t + p[1], 0) / ring.length
  const m = Math.hypot((cx - zx) * 111_320 * Math.cos((zy * Math.PI) / 180), (cy - zy) * 110_574)
  return m < 2000
}

async function liveVersions(svc: Svc, sheetId: string): Promise<RoomVersion[]> {
  const { data } = await svc.from('plan_versions').select(VERSION_COLS).eq('sheet_id', sheetId).is('deleted_at', null).limit(500)
  return (data ?? []).map((r) => versionFromRow(r as Record<string, unknown>)).sort(newestFirst)
}

/**
 * After the sheet's versions changed: the map shows the CURRENT version.
 * If any version of this sheet was on the map, the flag moves to the current
 * one's picture (when it is placed) and leaves every other picture.
 */
async function followCurrentOnMap(svc: Svc, companyId: string, sheetId: string, pinned: string | null) {
  const vs = await liveVersions(svc, sheetId)
  const imgIds = vs.map((v) => v.imageId).filter((x): x is string => !!x)
  if (!imgIds.length) return
  const { data: imgs } = await svc.from('zone_imagery').select('id, bounds, map_active').in('id', imgIds).eq('company_id', companyId)
  const wasOn = (imgs ?? []).some((i) => i.map_active)
  if (!wasOn) return
  const cur = currentOf({ pinnedVersionId: pinned }, vs)
  const curImg = (imgs ?? []).find((i) => i.id === cur?.imageId)
  const others = imgIds.filter((id) => id !== curImg?.id)
  if (others.length) await svc.from('zone_imagery').update({ map_active: false }).in('id', others).eq('company_id', companyId)
  if (curImg && curImg.bounds && !curImg.map_active) {
    await svc.from('zone_imagery').update({ map_active: true }).eq('id', curImg.id).eq('company_id', companyId)
  }
}

// ── Sets ────────────────────────────────────────────────────────────────────

export async function createPlanSetAction(input: { zoneId: string; name: string; kind: string; issuedOn: string }): Promise<Res<{ setId: string }>> {
  if (isMock) return { ok: false, error: 'Demo mode' }
  const { companyId, userId, svc } = await writer()
  const name = clip(input.name, 120)
  const kind = SET_KINDS.some((k) => k.key === input.kind) ? input.kind : 'other'
  if (!name) return { ok: false, error: 'Name the set (Bid set, Addendum 1…).' }
  if (!realDay(input.issuedOn)) return { ok: false, error: 'Pick the date the set was issued.' }
  if (!(await ownZone(svc, companyId, input.zoneId))) return { ok: false, error: 'That site isn’t yours.' }
  const { data, error } = await svc.from('plan_sets')
    .insert({ company_id: companyId, geofence_id: input.zoneId, name, kind, issued_on: input.issuedOn, created_by: userId })
    .select('id').single()
  if (error || !data) return { ok: false, error: 'Couldn’t start the set — try again.' }
  refresh(input.zoneId)
  return { ok: true, setId: String(data.id) }
}

export async function updatePlanSetAction(setId: string, patch: { name?: string; kind?: string; issuedOn?: string }): Promise<Res> {
  if (isMock) return { ok: false, error: 'Demo mode' }
  const { companyId, svc } = await writer()
  const set = await ownSet(svc, companyId, setId)
  if (!set) return { ok: false, error: 'Set not found' }
  const upd: Record<string, string> = {}
  if (patch.name !== undefined) {
    const n = clip(patch.name, 120)
    if (!n) return { ok: false, error: 'A set needs a name.' }
    upd.name = n
  }
  if (patch.kind !== undefined && SET_KINDS.some((k) => k.key === patch.kind)) upd.kind = patch.kind
  if (patch.issuedOn !== undefined) {
    if (!realDay(patch.issuedOn)) return { ok: false, error: 'Pick a real date.' }
    upd.issued_on = patch.issuedOn
  }
  if (!Object.keys(upd).length) return { ok: true }
  const { error } = await svc.from('plan_sets').update(upd).eq('id', setId).eq('company_id', companyId)
  if (error) return { ok: false, error: 'Couldn’t save — try again.' }
  // A set's date is its versions' date.
  if (upd.issued_on) {
    await svc.from('plan_versions').update({ issued_on: upd.issued_on }).eq('set_id', setId).eq('company_id', companyId)
    const { data: vs } = await svc.from('plan_versions').select('sheet_id').eq('set_id', setId).is('deleted_at', null)
    for (const sid of Array.from(new Set((vs ?? []).map((v) => String(v.sheet_id))))) {
      const sh = await ownSheet(svc, companyId, sid)
      if (sh) await followCurrentOnMap(svc, companyId, sid, sh.current_version_id)
    }
  }
  refresh(set.geofence_id)
  return { ok: true }
}

/** Delete a whole set: its versions leave every sheet (a sheet left with no
 *  version goes too) and its PDFs leave storage. */
export async function deletePlanSetAction(setId: string): Promise<Res> {
  if (isMock) return { ok: false, error: 'Demo mode' }
  const { companyId, svc } = await writer()
  const set = await ownSet(svc, companyId, setId)
  if (!set) return { ok: false, error: 'Set not found' }
  const now = new Date().toISOString()
  const { data: vs } = await svc.from('plan_versions').select('id, sheet_id, image_id').eq('set_id', setId).is('deleted_at', null)
  const sheetIds = Array.from(new Set((vs ?? []).map((v) => String(v.sheet_id))))
  const imgIds = (vs ?? []).map((v) => v.image_id).filter((x): x is string => !!x)
  // Which of these sheets had a version on the map — the flag follows to
  // whatever is current once this set's versions are gone.
  const { data: onMap } = imgIds.length
    ? await svc.from('zone_imagery').select('id').in('id', imgIds).eq('map_active', true)
    : { data: [] as { id: string }[] }
  const wasOnMap = new Set((vs ?? []).filter((v) => (onMap ?? []).some((i) => i.id === v.image_id)).map((v) => String(v.sheet_id)))
  await svc.from('plan_versions').update({ deleted_at: now }).eq('set_id', setId).eq('company_id', companyId)
  if (imgIds.length) await svc.from('zone_imagery').update({ map_active: false }).in('id', imgIds).eq('company_id', companyId)
  for (const sid of sheetIds) {
    const left = await liveVersions(svc, sid)
    if (!left.length) {
      await svc.from('plan_sheets').update({ deleted_at: now, current_version_id: null }).eq('id', sid).eq('company_id', companyId)
      continue
    }
    const sh = await ownSheet(svc, companyId, sid)
    let pin = sh?.current_version_id ?? null
    if (pin && !left.some((v) => v.id === pin)) {
      pin = null
      await svc.from('plan_sheets').update({ current_version_id: null }).eq('id', sid).eq('company_id', companyId)
    }
    if (wasOnMap.has(sid)) {
      const cur = currentOf({ pinnedVersionId: pin }, left)
      if (cur?.imageId) {
        const { data: img } = await svc.from('zone_imagery').select('bounds').eq('id', cur.imageId).maybeSingle()
        if (img?.bounds) await svc.from('zone_imagery').update({ map_active: true }).eq('id', cur.imageId).eq('company_id', companyId)
      }
    }
  }
  await svc.from('plan_sheets').update({ voided_at: null, voided_by_set: null }).eq('voided_by_set', setId).eq('company_id', companyId)
  const { data: files } = await svc.from('plan_files').select('path').eq('set_id', setId).eq('company_id', companyId)
  const paths = (files ?? []).map((f) => String(f.path)).filter((p) => p.startsWith(`${companyId}/`))
  if (paths.length) await svc.storage.from('plans').remove(paths)
  await svc.from('plan_files').update({ deleted_at: now }).eq('set_id', setId).eq('company_id', companyId)
  await svc.from('plan_sets').update({ deleted_at: now }).eq('id', setId).eq('company_id', companyId)
  refresh(set.geofence_id)
  return { ok: true }
}

// ── Original PDFs ───────────────────────────────────────────────────────────

/** Step 1: a one-time signed upload URL into the private 'plans' bucket. */
export async function startPlanFileUploadAction(input: { setId: string; name: string; size: number }): Promise<Res<{ path: string; token: string }>> {
  if (isMock) return { ok: false, error: 'Demo mode' }
  const { companyId, svc } = await writer()
  const set = await ownSet(svc, companyId, input.setId)
  if (!set) return { ok: false, error: 'Set not found' }
  if (!input.size || input.size > PDF_MAX_BYTES) return { ok: false, error: 'That PDF is over 50 MB — split it, or upload the sheets as pictures.' }
  const path = `${companyId}/${set.id}/${crypto.randomUUID()}.pdf`
  const { data, error } = await svc.storage.from('plans').createSignedUploadUrl(path)
  if (error || !data) return { ok: false, error: 'Couldn’t start the upload — try again.' }
  return { ok: true, path: data.path, token: data.token }
}

/** Step 2: the PDF landed — check it and file it under the set. */
export async function finishPlanFileUploadAction(input: { setId: string; path: string; name: string; pages: number }): Promise<Res<{ fileId: string }>> {
  if (isMock) return { ok: false, error: 'Demo mode' }
  const { companyId, userId, svc } = await writer()
  const set = await ownSet(svc, companyId, input.setId)
  if (!set) return { ok: false, error: 'Set not found' }
  const prefix = `${companyId}/${set.id}/`
  const fname = input.path.startsWith(prefix) ? input.path.slice(prefix.length) : ''
  if (!/^[0-9a-f-]{36}\.pdf$/i.test(fname)) return { ok: false, error: 'Bad upload path' }
  const { data: objs } = await svc.storage.from('plans').list(prefix.slice(0, -1), { search: fname })
  const obj = objs?.find((o) => o.name === fname)
  if (!obj) return { ok: false, error: 'The PDF didn’t finish uploading — try again.' }
  const meta = (obj.metadata ?? {}) as { size?: number; mimetype?: string }
  if ((meta.size ?? 0) > PDF_MAX_BYTES || (meta.mimetype && meta.mimetype !== 'application/pdf')) {
    await svc.storage.from('plans').remove([input.path])
    return { ok: false, error: 'That file isn’t a PDF under 50 MB.' }
  }
  const pages = Number.isInteger(input.pages) && input.pages >= 1 && input.pages <= 2000 ? input.pages : null
  const { data, error } = await svc.from('plan_files').insert({
    company_id: companyId, set_id: set.id, geofence_id: set.geofence_id,
    name: clip(input.name, 200) || 'plans.pdf', path: input.path, bytes: meta.size ?? null, pages, created_by: userId,
  }).select('id').single()
  if (error || !data) return { ok: false, error: 'Couldn’t file the PDF — try again.' }
  return { ok: true, fileId: String(data.id) }
}

/** A short signed link to a sheet's original PDF, for the viewer. Anyone who
 *  may open the plan room may read it; the row read runs under RLS. */
export async function planPdfLinkAction(fileId: string): Promise<Res<{ url: string }>> {
  if (isMock) return { ok: false, error: 'Demo mode' }
  if (!UUID.test(fileId)) return { ok: false, error: 'Bad file' }
  const perms = await getMyPermissions()
  if (!perms.features.includes('plans')) return { ok: false, error: 'Plans aren’t open for your login.' }
  const { createClient, createServiceClient } = await import('@/lib/supabase-server')
  const { data: f } = await createClient().from('plan_files').select('path').eq('id', fileId).maybeSingle()
  if (!f?.path) return { ok: false, error: 'That PDF is gone.' }
  const { data: s } = await createServiceClient().storage.from('plans').createSignedUrl(String(f.path), 600)
  if (!s?.signedUrl) return { ok: false, error: 'Couldn’t open the PDF — try again.' }
  return { ok: true, url: s.signedUrl }
}

// ── Versions ────────────────────────────────────────────────────────────────

export interface AddVersionInput {
  setId: string
  fileId: string | null
  page: number | null
  /** The page's picture, already filed as zone_imagery kind 'plan'. */
  imageId: string
  number: string
  title: string | null
  rev: string | null
  signature: string | null
  pageW: number | null
  pageH: number | null
  inkBox: number[] | null
  feetPerInch: number | null
  scaleText: string | null
  titleRead: Record<string, unknown> | null
  /** The page's scale evidence (lib/plans/scale.ts ScaleCheck[]). */
  scaleChecks?: { key: string; feetPerInch: number; detail: string }[] | null
  /** Where its state plane coordinates put it (lib/plans/gridfit.ts). */
  grid?: { bounds: [number, number][]; worstFt: number; n: number; what: string; assumedUp: boolean } | null
  /** The drawing area to show on the map (lib/plans/crop.ts). */
  crop?: { x0: number; y0: number; x1: number; y1: number; on?: boolean } | null
}

const SCALE_KEYS = new Set(['stated', 'bar', 'dims', 'grid'])
function cleanChecks(x: unknown): { key: string; feetPerInch: number; detail: string }[] | null {
  if (!Array.isArray(x)) return null
  const out = x.slice(0, 6).flatMap((c) => {
    if (!c || typeof c !== 'object') return []
    const { key, feetPerInch, detail } = c as Record<string, unknown>
    if (typeof key !== 'string' || !SCALE_KEYS.has(key)) return []
    if (typeof feetPerInch !== 'number' || !(feetPerInch > 0 && feetPerInch <= 2000)) return []
    return [{ key, feetPerInch: Math.round(feetPerInch * 100) / 100, detail: String(detail ?? '').slice(0, 80) }]
  })
  return out.length ? out : null
}
const goodCorners = (b: unknown): b is [number, number][] => Array.isArray(b) && b.length === 4 && b.every((c) =>
  Array.isArray(c) && c.length === 2 && Number.isFinite(c[0]) && Number.isFinite(c[1]) && Math.abs(c[0]) <= 180 && Math.abs(c[1]) <= 90)
/** Grid ticks this close place a sheet with no clicks; worse ones are left to a person. */
const GRID_PLACE_FT = 3

/**
 * File one page of a set as a version of its sheet (making the sheet when the
 * number is new). When the new version is the newest, it is current: the pin
 * (if any, on an older version) lets go, the sheet takes the new title, the
 * old placement carries over when it is the same plot, and the map follows.
 */
export async function addPlanVersionAction(input: AddVersionInput): Promise<Res<{
  versionId: string; sheetId: string; carried: 'exact' | 'check' | 'none'; isCurrent: boolean; placed: boolean
}>> {
  if (isMock) return { ok: false, error: 'Demo mode' }
  const { companyId, userId, svc } = await writer()
  const set = await ownSet(svc, companyId, input.setId)
  if (!set) return { ok: false, error: 'Set not found' }
  const zoneId = set.geofence_id
  const number = cleanNumber(input.number ?? '')
  if (!number) return { ok: false, error: 'Give the sheet a number (C-101).' }
  if (input.fileId) {
    if (!UUID.test(input.fileId)) return { ok: false, error: 'Bad file' }
    const { data: f } = await svc.from('plan_files').select('id').eq('id', input.fileId).eq('set_id', set.id).eq('company_id', companyId).maybeSingle()
    if (!f) return { ok: false, error: 'Bad file' }
  }
  if (!UUID.test(input.imageId)) return { ok: false, error: 'Bad picture' }
  const { data: img } = await svc.from('zone_imagery').select('id, bounds')
    .eq('id', input.imageId).eq('company_id', companyId).eq('geofence_id', zoneId).eq('kind', 'plan').maybeSingle()
  if (!img) return { ok: false, error: 'Bad picture' }
  const { data: used } = await svc.from('plan_versions').select('id').eq('image_id', input.imageId).is('deleted_at', null).limit(1)
  if (used?.length) return { ok: false, error: 'That picture already belongs to a sheet.' }

  const key = numberKey(number)
  const title = clip(input.title, 200) || null
  let { data: sheet } = await svc.from('plan_sheets').select('id, current_version_id, voided_at')
    .eq('geofence_id', zoneId).eq('number_key', key).is('deleted_at', null).maybeSingle()
  if (!sheet) {
    const ins = await svc.from('plan_sheets').insert({
      company_id: companyId, geofence_id: zoneId, number, number_key: key, title, discipline: disciplineOf(number),
    }).select('id, current_version_id, voided_at').single()
    if (ins.error) {
      // Two pages of one upload racing for the same new number.
      const again = await svc.from('plan_sheets').select('id, current_version_id, voided_at')
        .eq('geofence_id', zoneId).eq('number_key', key).is('deleted_at', null).maybeSingle()
      sheet = again.data
    } else sheet = ins.data
  }
  if (!sheet) return { ok: false, error: 'Couldn’t file that sheet — try again.' }

  const before = await liveVersions(svc, sheet.id)
  const prevCurrent = currentOf({ pinnedVersionId: sheet.current_version_id }, before)
  const rev = clip(input.rev, 8) || null
  const fin = (v: unknown, lo: number, hi: number) => (typeof v === 'number' && Number.isFinite(v) && v > lo && v <= hi ? v : null)
  const ink = Array.isArray(input.inkBox) && input.inkBox.length === 4 && input.inkBox.every((x) => typeof x === 'number' && Number.isFinite(x)) ? input.inkBox : null
  const titleRead = input.titleRead && typeof input.titleRead === 'object' && JSON.stringify(input.titleRead).length < 2000 ? input.titleRead : null
  const row = {
    company_id: companyId, sheet_id: sheet.id, set_id: set.id, file_id: input.fileId, image_id: input.imageId,
    page: Number.isInteger(input.page) && input.page! >= 1 && input.page! <= 2000 ? input.page : null,
    rev, issued_on: set.issued_on,
    signature: typeof input.signature === 'string' && /^[0-9a-f]{16,128}$/.test(input.signature) ? input.signature : null,
    page_w: fin(input.pageW, 0, 20000), page_h: fin(input.pageH, 0, 20000), ink_box: ink,
    feet_per_inch: fin(input.feetPerInch, 0, 2000), scale_text: clip(input.scaleText, 40) || null,
    title_read: titleRead, scale_checks: cleanChecks(input.scaleChecks), crop: cleanCrop(input.crop), created_by: userId,
  }
  const { data: ver, error: verErr } = await svc.from('plan_versions').insert(row).select(VERSION_COLS).single()
  if (verErr || !ver) return { ok: false, error: 'Couldn’t file that version — try again.' }
  const v = versionFromRow(ver as Record<string, unknown>)
  const all = [...before, v].sort(newestFirst)

  // Newest wins: a pin on an OLDER version lets go when a newer one lands.
  let pin = sheet.current_version_id
  if (pin && all[0].id === v.id) pin = null
  const current = currentOf({ pinnedVersionId: pin }, all)
  const isCurrent = current?.id === v.id
  const sheetPatch: Record<string, unknown> = {}
  if (pin !== sheet.current_version_id) sheetPatch.current_version_id = pin
  if (sheet.voided_at) { sheetPatch.voided_at = null; sheetPatch.voided_by_set = null }
  if (isCurrent && title) sheetPatch.title = title
  if (Object.keys(sheetPatch).length) await svc.from('plan_sheets').update(sheetPatch).eq('id', sheet.id).eq('company_id', companyId)

  // Placement, strongest evidence first: the sheet's own state plane
  // coordinates, then the nearest placed version of the same plot.
  let carried: 'exact' | 'check' | 'none' = 'none'
  let placed = !!img.bounds
  const g = input.grid
  if (!placed && g && goodCorners(g.bounds) && typeof g.worstFt === 'number' && g.worstFt >= 0 && g.worstFt <= GRID_PLACE_FT &&
      await nearZone(svc, zoneId, g.bounds)) {
    await svc.from('zone_imagery').update({ bounds: g.bounds }).eq('id', input.imageId).eq('company_id', companyId)
    await svc.from('plan_versions').update({ placement: {
      source: 'grid', errorFt: g.worstFt, n: Math.min(500, Math.max(0, Math.round(g.n))), what: clip(g.what, 40), assumedUp: !!g.assumedUp,
    } }).eq('id', v.id)
    placed = true
  }
  if (!placed) {
    const candidates = [prevCurrent, ...before].filter((x): x is RoomVersion => !!x && !!x.imageId)
    for (const c of candidates) {
      const rule = carryRule(c, v)
      if (rule === 'none') continue
      const { data: ci } = await svc.from('zone_imagery').select('bounds').eq('id', c.imageId!).eq('company_id', companyId).maybeSingle()
      if (!ci?.bounds) continue
      await svc.from('zone_imagery').update({ bounds: ci.bounds }).eq('id', input.imageId).eq('company_id', companyId)
      await svc.from('plan_versions').update({ placement: { source: 'carried', from: c.id, check: rule === 'check' } }).eq('id', v.id)
      carried = rule
      placed = true
      break
    }
  }
  if (isCurrent) await followCurrentOnMap(svc, companyId, sheet.id, pin)
  refresh(zoneId)
  return { ok: true, versionId: v.id, sheetId: sheet.id, carried, isCurrent, placed }
}

/** Pin a version as current (null = the newest one again). */
export async function setSheetPinAction(sheetId: string, versionId: string | null): Promise<Res> {
  if (isMock) return { ok: false, error: 'Demo mode' }
  const { companyId, svc } = await writer()
  const sheet = await ownSheet(svc, companyId, sheetId)
  if (!sheet) return { ok: false, error: 'Sheet not found' }
  const vs = await liveVersions(svc, sheetId)
  if (versionId !== null && !vs.some((v) => v.id === versionId)) return { ok: false, error: 'Version not found' }
  // Pinning the newest is the same as no pin.
  const pin = versionId && vs[0]?.id !== versionId ? versionId : null
  const { error } = await svc.from('plan_sheets').update({ current_version_id: pin }).eq('id', sheetId).eq('company_id', companyId)
  if (error) return { ok: false, error: 'Couldn’t save — try again.' }
  await followCurrentOnMap(svc, companyId, sheetId, pin)
  refresh(sheet.geofence_id)
  return { ok: true }
}

/** Rename a sheet (its number or title). A number another sheet on this
 *  site already uses is refused — merge by re-uploading under that number. */
export async function updatePlanSheetAction(sheetId: string, patch: { number?: string; title?: string }): Promise<Res> {
  if (isMock) return { ok: false, error: 'Demo mode' }
  const { companyId, svc } = await writer()
  const sheet = await ownSheet(svc, companyId, sheetId)
  if (!sheet) return { ok: false, error: 'Sheet not found' }
  const upd: Record<string, unknown> = {}
  if (patch.number !== undefined) {
    const n = cleanNumber(patch.number)
    if (!n) return { ok: false, error: 'Sheet numbers are letters and numbers, like C-101.' }
    const key = numberKey(n)
    const { data: clash } = await svc.from('plan_sheets').select('id').eq('geofence_id', sheet.geofence_id)
      .eq('number_key', key).is('deleted_at', null).neq('id', sheetId).limit(1)
    if (clash?.length) return { ok: false, error: `${n} is already a sheet on this site.` }
    Object.assign(upd, { number: n, number_key: key, discipline: disciplineOf(n) })
  }
  if (patch.title !== undefined) upd.title = clip(patch.title, 200) || null
  if (!Object.keys(upd).length) return { ok: true }
  const { error } = await svc.from('plan_sheets').update(upd).eq('id', sheetId).eq('company_id', companyId)
  if (error) return { ok: false, error: 'Couldn’t save — try again.' }
  refresh(sheet.geofence_id)
  return { ok: true }
}

/** Remove one version (an upload mistake). The last version takes its sheet with it. */
export async function deletePlanVersionAction(versionId: string): Promise<Res> {
  if (isMock) return { ok: false, error: 'Demo mode' }
  const { companyId, svc } = await writer()
  if (!UUID.test(versionId)) return { ok: false, error: 'Bad version' }
  const { data: v } = await svc.from('plan_versions').select('id, sheet_id, image_id').eq('id', versionId).eq('company_id', companyId).is('deleted_at', null).maybeSingle()
  if (!v) return { ok: false, error: 'Version not found' }
  const sheet = await ownSheet(svc, companyId, String(v.sheet_id))
  if (!sheet) return { ok: false, error: 'Sheet not found' }
  let wasOnMap = false
  if (v.image_id) {
    const { data: img } = await svc.from('zone_imagery').select('map_active').eq('id', v.image_id).maybeSingle()
    wasOnMap = !!img?.map_active
    await svc.from('zone_imagery').update({ map_active: false }).eq('id', v.image_id).eq('company_id', companyId)
  }
  const now = new Date().toISOString()
  await svc.from('plan_versions').update({ deleted_at: now }).eq('id', versionId).eq('company_id', companyId)
  const left = await liveVersions(svc, sheet.id)
  if (!left.length) {
    await svc.from('plan_sheets').update({ deleted_at: now, current_version_id: null }).eq('id', sheet.id).eq('company_id', companyId)
  } else {
    const pin = sheet.current_version_id === versionId ? null : sheet.current_version_id
    if (pin !== sheet.current_version_id) await svc.from('plan_sheets').update({ current_version_id: null }).eq('id', sheet.id).eq('company_id', companyId)
    if (wasOnMap) {
      const cur = currentOf({ pinnedVersionId: pin }, left)
      if (cur?.imageId) {
        const { data: img } = await svc.from('zone_imagery').select('bounds').eq('id', cur.imageId).maybeSingle()
        if (img?.bounds) await svc.from('zone_imagery').update({ map_active: true }).eq('id', cur.imageId).eq('company_id', companyId)
      }
    }
  }
  refresh(sheet.geofence_id)
  return { ok: true }
}

/** Show (or hide) a sheet's CURRENT version on the live map. Any number of
 *  sheets per site — grading and utilities side by side. */
export async function setSheetOnMapAction(sheetId: string, on: boolean): Promise<Res> {
  if (isMock) return { ok: false, error: 'Demo mode' }
  const { companyId, svc } = await writer()
  const sheet = await ownSheet(svc, companyId, sheetId)
  if (!sheet) return { ok: false, error: 'Sheet not found' }
  const vs = await liveVersions(svc, sheetId)
  const imgIds = vs.map((v) => v.imageId).filter((x): x is string => !!x)
  if (imgIds.length) await svc.from('zone_imagery').update({ map_active: false }).in('id', imgIds).eq('company_id', companyId)
  if (on) {
    const cur = currentOf({ pinnedVersionId: sheet.current_version_id }, vs)
    if (!cur?.imageId) return { ok: false, error: 'This sheet has no picture to show.' }
    const { data: img } = await svc.from('zone_imagery').select('bounds').eq('id', cur.imageId).eq('company_id', companyId).maybeSingle()
    if (!img?.bounds) return { ok: false, error: 'Place it on the map first.' }
    await svc.from('zone_imagery').update({ map_active: true }).eq('id', cur.imageId).eq('company_id', companyId)
  }
  refresh(sheet.geofence_id)
  return { ok: true }
}

/** Record how a version got onto the map (after the place tool saved its corners). */
export async function notePlacementAction(versionId: string, source: 'manual' | 'copied', fromVersionId?: string | null): Promise<Res> {
  if (isMock) return { ok: false, error: 'Demo mode' }
  const { companyId, svc } = await writer()
  if (!UUID.test(versionId) || (fromVersionId && !UUID.test(fromVersionId))) return { ok: false, error: 'Bad version' }
  const placement = source === 'copied' ? { source: 'carried', from: fromVersionId ?? null, check: true } : { source: 'manual' }
  const { error } = await svc.from('plan_versions').update({ placement }).eq('id', versionId).eq('company_id', companyId)
  if (error) return { ok: false, error: 'Couldn’t save — try again.' }
  return { ok: true }
}

/** Copy one placed version's corners onto other versions on the same site
 *  (an upload's new sheets share the first one's placement, as before). */
export async function copyPlacementAction(fromVersionId: string, toVersionIds: string[]): Promise<Res<{ copied: number }>> {
  if (isMock) return { ok: false, error: 'Demo mode' }
  const { companyId, svc } = await writer()
  if (!UUID.test(fromVersionId) || !Array.isArray(toVersionIds) || toVersionIds.length > 500 || !toVersionIds.every((x) => UUID.test(x))) return { ok: false, error: 'Bad version' }
  const { data: from } = await svc.from('plan_versions').select('id, image_id, sheet_id').eq('id', fromVersionId).eq('company_id', companyId).maybeSingle()
  if (!from?.image_id) return { ok: false, error: 'Nothing to copy from' }
  const { data: src } = await svc.from('zone_imagery').select('bounds, geofence_id').eq('id', from.image_id).eq('company_id', companyId).maybeSingle()
  if (!src?.bounds) return { ok: false, error: 'Place that sheet first.' }
  const { data: targets } = await svc.from('plan_versions').select('id, image_id').in('id', toVersionIds).eq('company_id', companyId).is('deleted_at', null)
  let copied = 0
  for (const t of targets ?? []) {
    if (!t.image_id) continue
    const { error } = await svc.from('zone_imagery').update({ bounds: src.bounds })
      .eq('id', t.image_id).eq('company_id', companyId).eq('geofence_id', src.geofence_id)
    if (error) continue
    await svc.from('plan_versions').update({ placement: { source: 'carried', from: fromVersionId, check: true } }).eq('id', t.id)
    copied++
  }
  refresh(String(src.geofence_id))
  return { ok: true, copied }
}

/** A full re-issue left these sheets out and the person said void them. */
export async function voidPlanSheetsAction(setId: string, sheetIds: string[]): Promise<Res> {
  if (isMock) return { ok: false, error: 'Demo mode' }
  const { companyId, svc } = await writer()
  const set = await ownSet(svc, companyId, setId)
  if (!set) return { ok: false, error: 'Set not found' }
  if (!Array.isArray(sheetIds) || sheetIds.length > 500 || !sheetIds.every((x) => UUID.test(x))) return { ok: false, error: 'Bad sheets' }
  if (!sheetIds.length) return { ok: true }
  await svc.from('plan_sheets').update({ voided_at: new Date().toISOString(), voided_by_set: set.id })
    .in('id', sheetIds).eq('company_id', companyId).eq('geofence_id', set.geofence_id)
  // A void sheet leaves the map.
  for (const sid of sheetIds) {
    const vs = await liveVersions(svc, sid)
    const imgIds = vs.map((v) => v.imageId).filter((x): x is string => !!x)
    if (imgIds.length) await svc.from('zone_imagery').update({ map_active: false }).in('id', imgIds).eq('company_id', companyId)
  }
  refresh(set.geofence_id)
  return { ok: true }
}

/** Un-void a sheet. */
export async function unvoidPlanSheetAction(sheetId: string): Promise<Res> {
  if (isMock) return { ok: false, error: 'Demo mode' }
  const { companyId, svc } = await writer()
  const sheet = await ownSheet(svc, companyId, sheetId)
  if (!sheet) return { ok: false, error: 'Sheet not found' }
  await svc.from('plan_sheets').update({ voided_at: null, voided_by_set: null }).eq('id', sheetId).eq('company_id', companyId)
  refresh(sheet.geofence_id)
  return { ok: true }
}

/** The person opened this version — their NEW dot for the sheet clears. Any
 *  login that can open the plan room (no edit needed); a preview never
 *  writes. */
export async function markPlanSeenAction(sheetId: string, versionId: string): Promise<Res> {
  if (isMock) return { ok: true }
  if (!UUID.test(sheetId) || !UUID.test(versionId)) return { ok: false, error: 'Bad sheet' }
  const perms = await getMyPermissions()
  if (perms.viewingAs || !perms.features.includes('plans')) return { ok: true }
  const { createClient, createServiceClient } = await import('@/lib/supabase-server')
  const db = createClient()
  const { data: { user } } = await db.auth.getUser()
  if (!user) return { ok: false, error: 'Signed out' }
  // RLS read = it is this company's live version of this sheet.
  const { data: v } = await db.from('plan_versions').select('id').eq('id', versionId).eq('sheet_id', sheetId).maybeSingle()
  if (!v) return { ok: false, error: 'Version not found' }
  await createServiceClient().from('plan_seen').upsert({ user_id: user.id, sheet_id: sheetId, version_id: versionId, seen_at: new Date().toISOString() })
  return { ok: true }
}

/** Set (or switch off) the part of a version that shows on the map. */
export async function setVersionCropAction(versionId: string, crop: { x0: number; y0: number; x1: number; y1: number; on?: boolean } | null): Promise<Res> {
  if (isMock) return { ok: false, error: 'Demo mode' }
  const { companyId, svc } = await writer()
  if (!UUID.test(versionId)) return { ok: false, error: 'Bad version' }
  const { data: v } = await svc.from('plan_versions').select('id, sheet_id').eq('id', versionId).eq('company_id', companyId).is('deleted_at', null).maybeSingle()
  if (!v) return { ok: false, error: 'Version not found' }
  const c = crop === null ? null : cleanCrop(crop)
  if (crop !== null && !c) return { ok: false, error: 'That crop is too small — keep at least a tenth of the sheet each way.' }
  const { error } = await svc.from('plan_versions').update({ crop: c }).eq('id', versionId).eq('company_id', companyId)
  if (error) return { ok: false, error: 'Couldn’t save — try again.' }
  const sheet = await ownSheet(svc, companyId, String(v.sheet_id))
  if (sheet) refresh(sheet.geofence_id)
  return { ok: true }
}
