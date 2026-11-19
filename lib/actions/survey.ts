'use server'

/**
 * Site survey writes (migration 163). Members hold SELECT only; every write
 * runs on the service client after the session checks — Beta open, edit
 * ability, Foreman and up, the dirt takeoff add-on (versions and drone checks
 * live on its takeoffs and flights). Deleting a version is Manager+.
 */
import { revalidatePath } from 'next/cache'
import { getMyPermissions } from '@/lib/permissions-server'
import { isProspect, rankOf, RANK } from '@/lib/permissions'
import { getCurrentCompanyId } from '@/lib/db/company'
import { dirtAddonActive } from '@/lib/db/dirt'
import { keyRateLimited } from '@/lib/rate-limit'
import { parseShots } from '@/lib/survey/shots'
import { checkShots, type CheckResults } from '@/lib/survey/check'
import { buildLegend, type LegendSheet } from '@/lib/dirt/versions'
import type { DirtDesign, DirtResults } from '@/lib/dirt/takeoff'

import { toolByKey } from '@/lib/beta/tools'

const isMock = !process.env.NEXT_PUBLIC_SUPABASE_URL ||
  process.env.NEXT_PUBLIC_SUPABASE_URL === 'https://your-project.supabase.co'
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const DAY = /^\d{4}-\d{2}-\d{2}$/

type Res<T = Record<never, never>> = ({ ok: true } & T) | { ok: false; error: string }

async function writer(opts: { manager?: boolean } = {}) {
  if (isMock) return { ok: false as const, error: 'Demo mode — sign in to use the site survey.' }
  const perms = await getMyPermissions()
  if (perms.viewingAs) return { ok: false as const, error: 'You’re previewing another login — exit the preview to change this.' }
  if (isProspect(perms) || !perms.features.includes('beta')) return { ok: false as const, error: 'Beta isn’t open for your login.' }
  if (!perms.canEdit || rankOf(perms) < (opts.manager ? RANK.manager : RANK.foreman)) return { ok: false as const, error: opts.manager ? 'Managers and up do that.' : 'Foreman and up do that.' }
  // the page's own gate (Foreman+ with Plans) — a narrowed view-levels table holds for a direct call too
  if (!toolByKey('survey').canOpen(perms, false)) return { ok: false as const, error: 'The site survey isn’t open for your login.' }
  const companyId = await getCurrentCompanyId()
  const { createClient, createServiceClient } = await import('@/lib/supabase-server')
  const { data: { user } } = await createClient().auth.getUser()
  if (!user || !companyId) return { ok: false as const, error: 'Sign in first.' }
  if (!(await dirtAddonActive(companyId))) return { ok: false as const, error: 'The site survey rides the dirt takeoff add-on — ask us to turn it on for your company.' }
  return { ok: true as const, companyId, userId: user.id, svc: createServiceClient(), rank: rankOf(perms) }
}

/** Per company per day — a loop can't fill the disk (each version copies a design of up to 3 MB and a picture). */
const DAILY_VERSIONS = 200
const DAILY_SHOT_SETS = 100
async function dailyCount(svc: Svc, table: 'dirt_takeoff_versions' | 'survey_shots', companyId: string): Promise<number> {
  const { count } = await svc.from(table).select('id', { count: 'exact', head: true }).eq('company_id', companyId).gte('created_at', new Date(Date.now() - 86_400_000).toISOString())
  return count ?? 0
}
type Svc = ReturnType<typeof import('@/lib/supabase-server').createServiceClient>

async function companySite(svc: Svc, companyId: string, zoneId: unknown): Promise<{ id: string; ring: [number, number][] } | null> {
  if (typeof zoneId !== 'string' || !UUID.test(zoneId)) return null
  const { data } = await svc.from('geofences_json').select('id, owner_id, kind, geometry').eq('id', zoneId).eq('company_id', companyId).maybeSingle()
  if (!data || data.owner_id || data.kind === 'boundary' || data.kind === 'vendor') return null
  const ring = ((data.geometry as { coordinates?: [number, number][][] } | null)?.coordinates?.[0] ?? []) as [number, number][]
  return { id: String(data.id), ring }
}

/** The plan sheets a takeoff was traced from, as number + revision — for the legend. */
async function sheetsOf(svc: Svc, companyId: string, design: DirtDesign): Promise<LegendSheet[]> {
  const raw = [...(Array.isArray(design.sheets) ? design.sheets : []), ...(design.features ?? []).map((f) => f.src)]
  const ids = Array.from(new Set(raw.filter((s): s is string => typeof s === 'string' && UUID.test(s)))).slice(0, 200)
  if (!ids.length) return []
  const { data: vs } = await svc.from('plan_versions').select('sheet_id, rev, issued_on').in('image_id', ids).eq('company_id', companyId).is('deleted_at', null).limit(400)
  if (!vs?.length) return []
  const { data: sh } = await svc.from('plan_sheets').select('id, number').in('id', Array.from(new Set(vs.map((v) => String(v.sheet_id))))).eq('company_id', companyId)
  const num = new Map((sh ?? []).map((s) => [String(s.id), String(s.number ?? 'Sheet')]))
  const seen = new Set<string>()
  const out: LegendSheet[] = []
  for (const v of vs) {
    const k = `${v.sheet_id}|${v.rev}`
    if (seen.has(k)) continue
    seen.add(k)
    out.push({ number: num.get(String(v.sheet_id)) ?? 'Sheet', rev: (v.rev as string | null) ?? null, issuedOn: (v.issued_on as string | null) ?? null })
  }
  return out.sort((a, b) => a.number.localeCompare(b.number))
}

// ── Takeoff versions ────────────────────────────────────────────────────────

/** Freeze the takeoff as it stands now: design, numbers, legend, and a copy of its cut/fill picture. */
export async function saveTakeoffVersionAction(raw: { takeoffId?: unknown; label?: unknown; note?: unknown }): Promise<Res<{ id: string; versionNo: number }>> {
  const w = await writer()
  if (!w.ok) return w
  const { companyId, userId, svc } = w
  if (typeof raw?.takeoffId !== 'string' || !UUID.test(raw.takeoffId)) return { ok: false, error: 'That takeoff wasn’t found.' }
  const { data: t } = await svc.from('dirt_takeoffs').select('id, name, geofence_id, design, results, heat_path, heat_corners, computed_at')
    .eq('id', raw.takeoffId).eq('company_id', companyId).is('deleted_at', null).maybeSingle()
  if (!t?.geofence_id || !(await companySite(svc, companyId, t.geofence_id))) return { ok: false, error: 'That takeoff wasn’t found.' }
  if (!t.results) return { ok: false, error: 'Save the takeoff (so the server runs it) before freezing a version.' }
  if (keyRateLimited(userId, 'takeoff-version', 6)) return { ok: false, error: 'That’s a lot of versions in a minute — wait a moment.' }
  if ((await dailyCount(svc, 'dirt_takeoff_versions', companyId)) >= DAILY_VERSIONS) return { ok: false, error: 'That’s the most versions a company can freeze in a day.' }
  const { data: last } = await svc.from('dirt_takeoff_versions').select('version_no, created_at, deleted_at').eq('takeoff_id', t.id).order('version_no', { ascending: false }).limit(1)
  // nothing changed since the last live version = nothing to freeze
  const prev = last?.[0]
  if (prev && !prev.deleted_at && t.computed_at && Date.parse(String(t.computed_at)) <= Date.parse(String(prev.created_at))) {
    return { ok: false, error: `Nothing changed since version ${prev.version_no} — save the takeoff with its changes first.` }
  }
  const versionNo = (Number(last?.[0]?.version_no) || 0) + 1
  const label = (typeof raw.label === 'string' && raw.label.trim() ? raw.label.trim() : `Version ${versionNo}`).slice(0, 120)
  const note = typeof raw.note === 'string' ? raw.note.trim().slice(0, 2000) || null : null
  const design = t.design as DirtDesign
  const legend = buildLegend(design, t.results as DirtResults, await sheetsOf(svc, companyId, design))
  // the version keeps its own copy of the picture — the takeoff's is replaced on the next save
  let heatPath: string | null = null
  if (typeof t.heat_path === 'string' && Array.isArray(t.heat_corners)) {
    const dest = `${companyId}/${t.id}/version-${versionNo}-${Date.now()}.png`
    const { error } = await svc.storage.from('dirt').copy(t.heat_path, dest)
    if (!error) heatPath = dest
  }
  const { data: ins, error } = await svc.from('dirt_takeoff_versions').insert({
    company_id: companyId, takeoff_id: t.id, geofence_id: t.geofence_id, version_no: versionNo, label, note,
    design, results: t.results, legend, heat_path: heatPath, heat_corners: heatPath ? t.heat_corners : null, created_by: userId,
  }).select('id').single()
  if (error || !ins) {
    if (heatPath) await svc.storage.from('dirt').remove([heatPath])
    return { ok: false, error: error?.code === '23505' ? 'Someone saved a version at the same moment — try again.' : 'Couldn’t save the version — try again.' }
  }
  revalidatePath('/beta/survey')
  return { ok: true, id: String(ins.id), versionNo }
}

export async function deleteTakeoffVersionAction(raw: { id?: unknown }): Promise<Res> {
  const w = await writer({ manager: true })
  if (!w.ok) return w
  if (typeof raw?.id !== 'string' || !UUID.test(raw.id)) return { ok: false, error: 'That version wasn’t found.' }
  const { data } = await w.svc.from('dirt_takeoff_versions').select('id, heat_path').eq('id', raw.id).eq('company_id', w.companyId).is('deleted_at', null).maybeSingle()
  if (!data) return { ok: false, error: 'That version wasn’t found.' }
  await w.svc.from('dirt_takeoff_versions').update({ deleted_at: new Date().toISOString(), heat_path: null }).eq('id', raw.id)
  if (data.heat_path) await w.svc.storage.from('dirt').remove([String(data.heat_path)])
  revalidatePath('/beta/survey')
  return { ok: true }
}

// ── Rover shots ─────────────────────────────────────────────────────────────

const metres = (a: [number, number], b: [number, number]) => {
  const k = Math.cos(((a[1] + b[1]) / 2) * Math.PI / 180)
  return Math.hypot((a[0] - b[0]) * 111_320 * k, (a[1] - b[1]) * 110_574)
}

export async function fileShotsAction(raw: { zoneId?: unknown; name?: unknown; takenOn?: unknown; source?: unknown; text?: unknown }): Promise<Res<{ id: string; count: number; problems: string[] }>> {
  const w = await writer()
  if (!w.ok) return w
  const site = await companySite(w.svc, w.companyId, raw?.zoneId)
  if (!site || site.ring.length < 3) return { ok: false, error: 'Pick the site.' }
  if ((await dailyCount(w.svc, 'survey_shots', w.companyId)) >= DAILY_SHOT_SETS) return { ok: false, error: 'That’s the most shot sets a company can file in a day.' }
  if (typeof raw.text !== 'string' || raw.text.length > 2_000_000) return { ok: false, error: 'Paste the shots (up to 5,000).' }
  if (keyRateLimited(w.userId, 'survey-shots', 30)) return { ok: false, error: 'That’s a lot in a minute — wait a moment.' }
  const p = parseShots(raw.text)
  if (!p.shots.length) return { ok: false, error: p.problems[0] ?? 'No shots could be read.' }
  // shots must be ON this site (within 1 km of its middle) — a wrong grid lands them in the next county
  const c: [number, number] = [site.ring.reduce((a, q) => a + q[0], 0) / site.ring.length, site.ring.reduce((a, q) => a + q[1], 0) / site.ring.length]
  const far = p.shots.filter((s) => metres([s.lng, s.lat], c) > 1000).length
  if (far > p.shots.length / 2) return { ok: false, error: 'Most of these shots are over a kilometre from the site — check the coordinate system (SC State Plane feet, or lat / lng).' }
  const shots = p.shots.filter((s) => metres([s.lng, s.lat], c) <= 1000)
  if (far) p.problems.push(`${far} shots more than a kilometre from the site were left out.`)
  const takenOn = typeof raw.takenOn === 'string' && DAY.test(raw.takenOn) ? raw.takenOn : new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' })
  const source = ['rover', 'total_station', 'level', 'other'].includes(String(raw.source)) ? String(raw.source) : 'rover'
  const name = (typeof raw.name === 'string' && raw.name.trim() ? raw.name.trim() : `Shots ${takenOn}`).slice(0, 120)
  const { data, error } = await w.svc.from('survey_shots').insert({
    company_id: w.companyId, geofence_id: site.id, name, taken_on: takenOn, source, coords: p.coords ?? 'sc_ft', points: shots, created_by: w.userId,
  }).select('id').single()
  if (error || !data) return { ok: false, error: 'Couldn’t file the shots — try again.' }
  revalidatePath('/beta/survey')
  return { ok: true, id: String(data.id), count: shots.length, problems: p.problems }
}

export async function deleteShotsAction(raw: { id?: unknown }): Promise<Res> {
  const w = await writer()
  if (!w.ok) return w
  if (typeof raw?.id !== 'string' || !UUID.test(raw.id)) return { ok: false, error: 'Not found.' }
  const { data: own } = await w.svc.from('survey_shots').select('created_by').eq('id', raw.id).eq('company_id', w.companyId).is('deleted_at', null).maybeSingle()
  if (!own) return { ok: false, error: 'Not found.' }
  if (own.created_by !== w.userId && w.rank < RANK.manager) return { ok: false, error: 'Only whoever filed these shots, or a Manager, removes them.' }
  await w.svc.from('survey_shots').update({ deleted_at: new Date().toISOString() }).eq('id', raw.id).eq('company_id', w.companyId)
  await w.svc.from('survey_checks').update({ deleted_at: new Date().toISOString() }).eq('shots_id', raw.id).eq('company_id', w.companyId)
  revalidatePath('/beta/survey')
  return { ok: true }
}

// ── Drone vs rover ──────────────────────────────────────────────────────────

/** Read the flight's surface under every shot and file the comparison. */
export async function runSurveyCheckAction(raw: { shotsId?: unknown; surfaceId?: unknown }): Promise<Res<{ id: string; results: CheckResults }>> {
  const w = await writer()
  if (!w.ok) return w
  if (typeof raw?.shotsId !== 'string' || !UUID.test(raw.shotsId) || typeof raw.surfaceId !== 'string' || !UUID.test(raw.surfaceId)) return { ok: false, error: 'Pick the shots and the flight.' }
  if (keyRateLimited(w.userId, 'survey-check', 6)) return { ok: false, error: 'That’s a lot of checks in a minute — wait a moment.' }
  const { data: sh } = await w.svc.from('survey_shots').select('id, geofence_id, points').eq('id', raw.shotsId).eq('company_id', w.companyId).is('deleted_at', null).maybeSingle()
  if (!sh) return { ok: false, error: 'Those shots weren’t found.' }
  const { data: s } = await w.svc.from('dirt_surfaces').select('id, geofence_id, path, info, status')
    .eq('id', raw.surfaceId).eq('company_id', w.companyId).eq('geofence_id', sh.geofence_id).is('deleted_at', null).maybeSingle()
  if (!s || s.status !== 'ready' || !s.info) return { ok: false, error: 'That flight isn’t ready on this site — upload it on the site’s stockpiles page.' }
  const { cleanShots } = await import('@/lib/survey/shots')
  const shots = cleanShots(sh.points)
  if (!shots.length) return { ok: false, error: 'No shots in that set.' }
  const { makeFrame, toFrame } = await import('@/lib/dirt/tm')
  const cLng = shots.reduce((a, p) => a + p.lng, 0) / shots.length, cLat = shots.reduce((a, p) => a + p.lat, 0) / shots.length
  const frame = makeFrame(cLng, cLat)
  const xy = shots.map((p) => toFrame(frame, p.lng, p.lat))
  const pad = 5
  const x0 = Math.min(...xy.map((p) => p[0])) - pad, x1 = Math.max(...xy.map((p) => p[0])) + pad
  const y0 = Math.min(...xy.map((p) => p[1])) - pad, y1 = Math.max(...xy.map((p) => p[1])) + pad
  if (x1 - x0 > 3000 || y1 - y0 > 3000) return { ok: false, error: 'The shots spread over more than 3 km — split them by area.' }
  const ring = [x0, y0, x1, y0, x1, y1, x0, y1]
  let results: CheckResults
  try {
    const { data: signed } = await w.svc.storage.from('dirt').createSignedUrl(String(s.path), 300)
    if (!signed?.signedUrl) return { ok: false, error: 'The flight’s file is missing — upload it again.' }
    const { openDsm, dsmSurface } = await import('@/lib/dirt/dsm')
    const signal = AbortSignal.timeout(45_000)
    const tiff = await openDsm(signed.signedUrl, signal)
    const top = await dsmSurface(tiff, s.info as import('@/lib/dirt/dsm').DsmInfo, frame, ring, signal)
    const FT = 0.3048
    results = checkShots(shots, (lng, lat) => { const [x, y] = toFrame(frame, lng, lat); const z = top.surface.zAt(x, y); return Number.isFinite(z) ? z / FT : null }, new Date())
  } catch (err) {
    const m = err instanceof Error ? err.message : ''
    return { ok: false, error: m === 'outside' ? 'The flight doesn’t cover these shots.' : m === 'too-big' ? 'The shots cover too much ground to read at once — split them.' : 'Couldn’t read the flight — try again.' }
  }
  await w.svc.from('survey_checks').update({ deleted_at: new Date().toISOString() }).eq('shots_id', sh.id).eq('surface_id', s.id).is('deleted_at', null)
  const { data: ins, error } = await w.svc.from('survey_checks').insert({ company_id: w.companyId, geofence_id: sh.geofence_id, shots_id: sh.id, surface_id: s.id, results, created_by: w.userId }).select('id').single()
  if (error || !ins) return { ok: false, error: 'Couldn’t save the check — try again.' }
  revalidatePath('/beta/survey')
  return { ok: true, id: String(ins.id), results }
}

/** A takeoff's saved design, for building the as-built files on the device (read under RLS). */
export async function readTakeoffDesignAction(raw: { takeoffId?: unknown }): Promise<Res<{ design: DirtDesign; name: string; zoneId: string }>> {
  if (isMock) return { ok: false, error: 'Demo mode.' }
  const perms = await getMyPermissions()
  if (perms.viewingAs) return { ok: false, error: 'You’re previewing another login — exit the preview to build files.' }
  if (isProspect(perms) || !perms.features.includes('beta') || !toolByKey('survey').canOpen(perms, false)) return { ok: false, error: 'The site survey isn’t open for your login.' }
  if (typeof raw?.takeoffId !== 'string' || !UUID.test(raw.takeoffId)) return { ok: false, error: 'That takeoff wasn’t found.' }
  const { createClient } = await import('@/lib/supabase-server')
  const { data } = await createClient().from('dirt_takeoffs').select('design, name, geofence_id').eq('id', raw.takeoffId).is('deleted_at', null).maybeSingle()
  if (!data?.geofence_id) return { ok: false, error: 'That takeoff wasn’t found.' }
  return { ok: true, design: data.design as DirtDesign, name: String(data.name), zoneId: String(data.geofence_id) }
}
