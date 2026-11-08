/**
 * Takeoff helpers that run on the server with the service client (migration
 * 144) — shared by the takeoff actions and the plan room's filing action. Not
 * a server-action module: nothing here is callable from a browser.
 */
import { checksFor, measuringFeet, markQty, kindFor, type ItemLike, type MarkGeom, type MarkKind } from '@/lib/plans/measure'
import type { Corners4 } from '@/lib/plans/north'

type Svc = ReturnType<typeof import('@/lib/supabase-server')['createServiceClient']>

export interface VersionScale { feet: { w: number; h: number } | null; blocked: string | null }

/** How a version measures: its sheet in ground feet, or why it cannot. */
export async function versionScale(svc: Svc, companyId: string, versionId: string): Promise<VersionScale & { sheetId: string | null }> {
  const { data: v } = await svc.from('plan_versions')
    .select('id, sheet_id, image_id, file_id, page_w, page_h, feet_per_inch, scale_text, scale_checks, placement')
    .eq('id', versionId).eq('company_id', companyId).is('deleted_at', null).maybeSingle()
  if (!v) return { feet: null, blocked: 'Version not found', sheetId: null }
  let bounds: Corners4 | null = null
  if (v.image_id) {
    const { data: img } = await svc.from('zone_imagery').select('bounds').eq('id', v.image_id).maybeSingle()
    if (Array.isArray(img?.bounds) && img!.bounds.length === 4) bounds = img!.bounds as Corners4
  }
  const checks = checksFor({
    scaleChecks: Array.isArray(v.scale_checks) ? v.scale_checks as { key: string; feetPerInch: number; detail: string }[] : null,
    feetPerInch: (v.feet_per_inch as number | null) ?? null, scaleText: (v.scale_text as string | null) ?? null,
    pageW: (v.page_w as number | null) ?? null, placement: (v.placement as { source?: string } | null) ?? null,
    fileId: (v.file_id as string | null) ?? null,
  }, bounds)
  const m = measuringFeet({ fileId: (v.file_id as string | null) ?? null, pageW: (v.page_w as number | null) ?? null, pageH: (v.page_h as number | null) ?? null }, checks, bounds)
  return { ...m, sheetId: String(v.sheet_id) }
}

/** Re-measure every live mark on a version (after its scale changed). */
export async function remeasureVersion(svc: Svc, companyId: string, versionId: string): Promise<void> {
  const sc = await versionScale(svc, companyId, versionId)
  const { data: marks } = await svc.from('plan_marks').select('id, kind, geom, item_id').eq('version_id', versionId).eq('company_id', companyId).is('deleted_at', null).limit(5000)
  const itemIds = Array.from(new Set((marks ?? []).map((m) => m.item_id).filter((x): x is string => !!x)))
  const items = await itemsById(svc, companyId, itemIds)
  for (const m of marks ?? []) {
    const it = m.item_id ? items.get(String(m.item_id)) : undefined
    const qty = it && sc.feet ? markQty(it, m.kind as MarkKind, m.geom as MarkGeom, sc.feet) : null
    await svc.from('plan_marks').update({ qty, updated_at: new Date().toISOString() }).eq('id', m.id)
  }
}

export async function itemsById(svc: Svc, companyId: string, ids: string[]): Promise<Map<string, ItemLike & { id: string }>> {
  if (!ids.length) return new Map()
  const { data } = await svc.from('takeoff_items').select('id, measure, unit, depth_in, tons_per_cy').in('id', ids).eq('company_id', companyId)
  return new Map((data ?? []).map((r) => [String(r.id), { id: String(r.id), measure: r.measure, unit: r.unit, depth_in: r.depth_in, tons_per_cy: r.tons_per_cy } as ItemLike & { id: string }]))
}

/**
 * A new revision on the same paper takes the marks of the version it
 * replaces — the engineer re-plotted with the same origin, so the shapes
 * land on the same things. When the drawing changed, every carried mark is
 * flagged for a look; nothing silently stands.
 */
export async function carryMarks(svc: Svc, companyId: string, fromVersionId: string, toVersionId: string, drawingChanged: boolean, userId: string | null): Promise<number> {
  const { data: marks } = await svc.from('plan_marks').select('id, sheet_id, item_id, kind, geom, label, status')
    .eq('version_id', fromVersionId).eq('company_id', companyId).is('deleted_at', null).neq('status', 'suggested').limit(5000)
  if (!marks?.length) return 0
  const sc = await versionScale(svc, companyId, toVersionId)
  const items = await itemsById(svc, companyId, Array.from(new Set(marks.map((m) => m.item_id).filter((x): x is string => !!x))))
  const rows = marks.map((m) => {
    const it = m.item_id ? items.get(String(m.item_id)) : undefined
    return {
      company_id: companyId, sheet_id: m.sheet_id, version_id: toVersionId, item_id: m.item_id, kind: m.kind, geom: m.geom,
      qty: it && sc.feet ? markQty(it, m.kind as MarkKind, m.geom as MarkGeom, sc.feet) : null,
      status: drawingChanged || m.status === 'check' ? 'check' : 'ok', label: m.label, carried_from: m.id, created_by: userId,
    }
  })
  const { error } = await svc.from('plan_marks').insert(rows)
  return error ? 0 : rows.length
}

export { kindFor }
