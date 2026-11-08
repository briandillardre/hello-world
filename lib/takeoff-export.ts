/**
 * The takeoff as a spreadsheet — pure (lib/xlsx.ts writes it).
 *
 * Every row carries the item CODE, which never changes, so an estimate tab
 * that looks quantities up by code (XLOOKUP / VLOOKUP) keeps pointing at the
 * right row when items are added or re-sorted. Quantities flow out only;
 * prices come in through the cost book, never back from a sheet. Dollar
 * columns appear only when the person (or the link) may see costs.
 */
import type { Sheet, Cell } from './xlsx'
import type { TakeoffSummary } from './takeoff-summary'

export interface SnapshotLike { name: string; createdAt: string; data: { items: { code: string; name: string; unit: string; qty: number }[] } }

const H = (s: string): Cell => ({ s, bold: true })

export function takeoffWorkbook(t: TakeoffSummary, opts: { costs: boolean; snapshot?: SnapshotLike | null; memo?: string | null }): Sheet[] {
  const sheets: Sheet[] = []
  const head = ['Code', 'Item', 'Section', 'Unit', 'Qty', 'Waste %', 'Qty with waste'].map(H)
  if (opts.costs) head.push(H('Unit price'), H('Total'))
  const rows: Cell[][] = [head]
  t.rows.forEach((r, i) => {
    const n = i + 2
    const row: Cell[] = [r.code, r.name, r.section ?? '', r.unit, r.qty, r.wastePct, { f: `E${n}*(1+F${n}/100)`, v: r.qtyWithWaste }]
    if (opts.costs) row.push(r.unitPrice, { f: `IF(H${n}="","",G${n}*H${n})` })
    rows.push(row)
  })
  if (opts.costs && t.rows.length) rows.push(['', 'Total', '', '', null, null, null, null, { f: `SUM(I2:I${t.rows.length + 1})` }])
  sheets.push({ name: 'Summary', rows, widths: opts.costs ? [12, 40, 16, 7, 12, 9, 14, 12, 14] : [12, 40, 16, 7, 12, 9, 14] })

  const bySheet: Cell[][] = [['Sheet', 'Rev', 'Code', 'Item', 'Unit', 'Qty'].map(H)]
  const revOf = new Map(t.sheets.map((s) => [s.sheetId, s.rev]))
  for (const r of t.rows) for (const b of r.bySheet) bySheet.push([b.number, revOf.get(b.sheetId) ?? '', r.code, r.name, r.unit, b.qty])
  sheets.push({ name: 'By sheet', rows: bySheet, widths: [10, 6, 12, 40, 7, 12] })

  if (opts.snapshot) {
    const snap = new Map(opts.snapshot.data.items.map((i) => [i.code, i]))
    const now = new Map(t.rows.map((r) => [r.code, r]))
    const codes = Array.from(new Set([...Array.from(snap.keys()), ...Array.from(now.keys())])).sort()
    const head2 = ['Code', 'Item', 'Unit', opts.snapshot.name, 'Now', 'Δ qty'].map(H)
    if (opts.costs) head2.push(H('Unit price'), H('Δ $'))
    const rr: Cell[][] = [head2]
    codes.forEach((code, i) => {
      const n = i + 2
      const a = snap.get(code), b = now.get(code)
      const row: Cell[] = [code, b?.name ?? a?.name ?? '', b?.unit ?? a?.unit ?? '', a?.qty ?? 0, b?.qty ?? 0, { f: `E${n}-D${n}` }]
      if (opts.costs) row.push(b?.unitPrice ?? null, { f: `IF(G${n}="","",F${n}*G${n})` })
      rr.push(row)
    })
    sheets.push({ name: 'By revision', rows: rr, widths: [12, 40, 7, 16, 12, 12, 12, 14] })
  }

  const sheetList: Cell[][] = [['Sheet', 'Title', 'Rev', 'Issued', 'Marks'].map(H)]
  for (const s of t.sheets) sheetList.push([s.number, s.title ?? '', s.rev ?? '', s.issuedOn, s.marks])
  sheets.push({ name: 'Sheets', rows: sheetList, widths: [10, 40, 6, 12, 8] })

  if (opts.memo) sheets.push({ name: 'Memo', rows: opts.memo.split('\n').map((l) => [l]), widths: [120] })
  return sheets
}

/** The private link's CSV: one row per item, stable code first. */
export function takeoffCsvRows(t: TakeoffSummary, costs: boolean): (string | number | null)[][] {
  const head = ['code', 'item', 'section', 'unit', 'qty', 'waste_pct', 'qty_with_waste']
  if (costs) head.push('unit_price', 'total')
  const rows: (string | number | null)[][] = [head]
  for (const r of t.rows) {
    const row: (string | number | null)[] = [r.code, r.name, r.section ?? '', r.unit, r.qty, r.wastePct, r.qtyWithWaste]
    if (costs) row.push(r.unitPrice, r.unitPrice === null ? null : Math.round(r.qtyWithWaste * r.unitPrice * 100) / 100)
    rows.push(row)
  }
  return rows
}
