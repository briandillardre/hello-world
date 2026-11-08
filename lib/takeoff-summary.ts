/**
 * A site's takeoff, summed (migration 146) — the bid's quantity page, the
 * spreadsheet export, the private CSV link and the memo's facts all read
 * this. Server only; every query is pinned to the company explicitly, so it
 * is safe on the service client (the caller checks who may see the site).
 */
import { currentOf, revLabel } from '@/lib/plans/room'
import { versionFromRow } from '@/lib/db/plans'
import type { Measure, Unit } from '@/lib/plans/measure'
import { allRows } from '@/lib/db/paged'

type Db = ReturnType<typeof import('@/lib/supabase-server')['createServiceClient']>

export interface TakeoffRow {
  itemId: string
  code: string
  name: string
  measure: Measure
  unit: Unit
  section: string | null
  color: string
  qty: number
  wastePct: number
  qtyWithWaste: number
  marks: number
  check: number
  suggested: number
  /** null unless prices were asked for (and the caller may see them). */
  unitPrice: number | null
  bySheet: { sheetId: string; number: string; qty: number }[]
}

export interface TakeoffSheet { sheetId: string; number: string; title: string | null; rev: string | null; versionId: string; issuedOn: string; marks: number }

export interface TakeoffSummary {
  zoneName: string
  rows: TakeoffRow[]
  sheets: TakeoffSheet[]
  /** Marks flagged for a look / waiting to be accepted, across the site. */
  check: number
  suggested: number
}

export async function buildTakeoff(db: Db, companyId: string, zoneId: string, withPrices = false): Promise<TakeoffSummary | null> {
  const { data: zone } = await db.from('geofences').select('id, name').eq('id', zoneId).eq('company_id', companyId).maybeSingle()
  if (!zone) return null
  const { data: sheets } = await db.from('plan_sheets').select('id, number, title, current_version_id, voided_at')
    .eq('geofence_id', zoneId).eq('company_id', companyId).is('deleted_at', null).is('voided_at', null).limit(2000)
  const sheetIds = (sheets ?? []).map((s) => String(s.id))
  const versions: ReturnType<typeof versionFromRow>[] = []
  for (let i = 0; i < sheetIds.length; i += 150) {
    const { data } = await db.from('plan_versions').select('id, sheet_id, rev, issued_on, created_at')
      .in('sheet_id', sheetIds.slice(i, i + 150)).eq('company_id', companyId).is('deleted_at', null).limit(5000)
    for (const r of data ?? []) versions.push(versionFromRow(r as Record<string, unknown>))
  }
  const cur: TakeoffSheet[] = []
  for (const s of sheets ?? []) {
    const c = currentOf({ pinnedVersionId: (s.current_version_id as string | null) ?? null }, versions.filter((v) => v.sheetId === s.id))
    if (c) cur.push({ sheetId: String(s.id), number: String(s.number), title: (s.title as string | null) ?? null, rev: c.rev, versionId: c.id, issuedOn: c.issuedOn, marks: 0 })
  }
  const marks: { item_id: string | null; qty: number | null; status: string; version_id: string }[] = []
  const vids = cur.map((c) => c.versionId)
  for (let i = 0; i < vids.length; i += 150) {
    const chunk = vids.slice(i, i + 150)
    // Paged: one .limit() is cut to the API's ~1,000-row cap and the totals came up short (ship-check, Nov 8).
    const { rows } = await allRows((from, to) => db.from('plan_marks').select('id, item_id, qty, status, version_id')
      .in('version_id', chunk).eq('company_id', companyId).is('deleted_at', null).order('id').range(from, to))
    for (const r of rows) marks.push(r as typeof marks[number])
  }
  const itemIds = Array.from(new Set(marks.map((m) => m.item_id).filter((x): x is string => !!x)))
  const { data: items } = itemIds.length
    ? await db.from('takeoff_items').select(`id, code, name, measure, unit, section, color, waste_pct, sort${withPrices ? ', unit_price' : ''}`).in('id', itemIds).eq('company_id', companyId).is('deleted_at', null) // a deleted item's marks lose their item (the delete says so)
    : { data: [] as Record<string, unknown>[] }
  const byVersion = new Map(cur.map((c) => [c.versionId, c]))
  const rows = new Map<string, TakeoffRow & { sort: number }>()
  for (const it of (items ?? []) as Record<string, unknown>[]) {
    rows.set(String(it.id), {
      itemId: String(it.id), code: String(it.code), name: String(it.name), measure: it.measure as Measure, unit: it.unit as Unit,
      section: (it.section as string | null) ?? null, color: String(it.color ?? '#ff9e16'), qty: 0, wastePct: Number(it.waste_pct ?? 0), qtyWithWaste: 0,
      marks: 0, check: 0, suggested: 0, unitPrice: withPrices && it.unit_price !== null && it.unit_price !== undefined ? Number(it.unit_price) : null,
      bySheet: [], sort: Number(it.sort ?? 0),
    })
  }
  let check = 0, suggested = 0
  for (const m of marks) {
    const sh = byVersion.get(m.version_id)
    if (sh) sh.marks++
    if (m.status === 'suggested') { suggested++; const r = m.item_id ? rows.get(m.item_id) : undefined; if (r) r.suggested++; continue }
    if (m.status === 'check') check++
    const r = m.item_id ? rows.get(m.item_id) : undefined
    if (!r || !sh) continue
    r.qty += m.qty ?? 0
    r.marks++
    if (m.status === 'check') r.check++
    const bs = r.bySheet.find((b) => b.sheetId === sh.sheetId)
    if (bs) bs.qty += m.qty ?? 0
    else r.bySheet.push({ sheetId: sh.sheetId, number: sh.number, qty: m.qty ?? 0 })
  }
  const r3 = (v: number) => Math.round(v * 1000) / 1000
  const out = Array.from(rows.values())
    .filter((r) => r.marks > 0 || r.suggested > 0)
    .map(({ sort: _s, ...r }) => ({ ...r, qty: r3(r.qty), qtyWithWaste: r3(r.qty * (1 + r.wastePct / 100)), bySheet: r.bySheet.map((b) => ({ ...b, qty: r3(b.qty) })), _s }))
    .sort((a, b) => (a.section ?? '~').localeCompare(b.section ?? '~') || a._s - b._s || a.code.localeCompare(b.code))
    .map(({ _s, ...r }) => (void _s, r))
  return { zoneName: String(zone.name), rows: out, sheets: cur.sort((a, b) => a.number.localeCompare(b.number, undefined, { numeric: true })), check, suggested }
}

/** "C-101 Rev 2" for a summary's sheet. */
export const sheetRevWords = (s: TakeoffSheet) => `${s.number} ${revLabel(s.rev)}`
