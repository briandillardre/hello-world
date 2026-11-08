/**
 * An application for payment as paper: the PDF (the application page and the
 * continuation sheet, in the G702 / G703 layout) and an Excel workbook with
 * LIVE formulas in the same columns as DCG's PA tabs (G = D + E + F, % = G/C,
 * H = C − G, I = the retainage; the application page reads its sheet). Runs in
 * the browser; the numbers come from lib/jobs/payapp.ts — a sent application's
 * frozen ones. The forms are our own words: AIA's documents are copyrighted,
 * so this follows their layout, never their text.
 */
import { buildXlsx, type Cell, type Sheet } from '@/lib/xlsx'
import { lineMath, money, type AppView } from './payapp'

export interface DocInfo {
  companyName: string
  jobName: string
  jobNumber: string | null
  customer: string | null
  customerJobNo: string | null
  ownerName: string | null
  contractNo: string | null
  contractDate: string | null
  scope: string | null
  address: string | null
}

const fmtDay = (d: string | null) => {
  if (!d) return ''
  const t = Date.parse(`${d}T12:00:00Z`)
  return Number.isNaN(t) ? d : new Date(t).toLocaleDateString('en-US', { month: 'numeric', day: 'numeric', year: 'numeric', timeZone: 'UTC' })
}
const pct = (v: number) => `${v.toFixed(2)}%`
/** PDF text: the standard fonts have no U+2212 minus — it printed as a stray quote. */
const pdfSafe = (s: string) => s.replace(/\u2212/g, '-')
const pm = (v: number) => pdfSafe(money(v))

export function docName(info: DocInfo, app: AppView, ext: 'pdf' | 'xlsx'): string {
  return `${info.jobNumber ? `${info.jobNumber} ` : ''}${info.jobName.replace(/^\d{2}-\d{3}\s*/, '')} - Pay app ${app.appNo}.${ext}`.replace(/[\\/:*?"<>|]+/g, ' ').slice(0, 120)
}

/** The application (G702 layout) and the continuation sheet (G703 layout), letter landscape. */
export async function payAppPdf(info: DocInfo, app: AppView): Promise<Blob> {
  const { jsPDF } = await import('jspdf')
  const autoTable = (await import('jspdf-autotable')).default
  const doc = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'letter' })
  const W = doc.internal.pageSize.getWidth()
  const M = 36
  const t = app.totals
  const ink = (n = 20) => doc.setTextColor(n, n, n)

  // ── The application ──
  doc.setFont('helvetica', 'bold'); doc.setFontSize(15); ink()
  doc.text('APPLICATION AND CERTIFICATE FOR PAYMENT', M, M + 6)
  doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5); ink(90)
  doc.text(`Application ${app.appNo} · ${app.status === 'draft' ? 'DRAFT — not sent' : app.status.toUpperCase()}${app.release ? ' · FINAL — retainage released' : ''}`, M, M + 20)
  const left: [string, string][] = [
    ['To', info.customer ?? ''], ['From', info.companyName], ['Project', info.jobName], ['Address', info.address ?? ''], ['Owner', info.ownerName ?? ''],
    ['Contract for', info.scope ?? ''],
  ]
  const right: [string, string][] = [
    ['Application no.', String(app.appNo)], ['Application date', fmtDay(app.appDate)], ['Period to', fmtDay(app.periodTo)],
    ['Project no.', [info.jobNumber, info.customerJobNo ? `(${info.customerJobNo})` : null].filter(Boolean).join(' ')],
    ['Contract no.', info.contractNo ?? ''], ['Contract date', fmtDay(info.contractDate)], ['Invoice no.', app.invoiceNo ?? ''],
  ]
  let y = M + 40
  doc.setFontSize(9.5)
  const kv = (rows: [string, string][], x: number, w: number) => {
    let yy = y
    for (const [k, v] of rows) {
      doc.setFont('helvetica', 'bold'); ink(60); doc.text(k, x, yy)
      doc.setFont('helvetica', 'normal'); ink()
      const lines = doc.splitTextToSize(v || '—', w - 90) as string[]
      doc.text(lines.slice(0, 3), x + 90, yy)
      yy += 13 * Math.max(1, Math.min(3, lines.length))
    }
    return yy
  }
  const yl = kv(left, M, W / 2 - M)
  const yr = kv(right, W / 2 + 10, W / 2 - M - 10)
  y = Math.max(yl, yr) + 8

  const summary: [string, string, string][] = [
    ['1', 'Original contract sum', pm(t.originalSum)],
    ['2', 'Net change by change orders', pm(t.coNet)],
    ['3', 'Contract sum to date (1 + 2)', pm(t.contractToDate)],
    ['4', 'Total completed and stored to date (column G)', pm(t.completedStored)],
    ['5a', `Retainage on completed work${app.release ? ' (released)' : ` (${pct(app.retPct)}${app.lines.some((l) => l.retPct !== null) ? ', some lines their own %' : ''})`}`, pm(t.retWork)],
    ['5b', `Retainage on stored material${app.release ? ' (released)' : ` (${pct(app.storedRetPct)})`}`, pm(t.retStored)],
    ['5', 'Total retainage', pm(t.retTotal)],
    ['6', 'Total earned less retainage (4 - 5)', pm(t.earnedLessRet)],
    ['7', 'Less previous certificates for payment', pm(t.prevCerts)],
    ['8', 'CURRENT PAYMENT DUE (6 - 7)', pm(t.currentDue)],
    ['9', 'Balance to finish, including retainage (3 - 6)', pm(t.balanceToFinish)],
  ]
  autoTable(doc, {
    startY: y, margin: { left: M, right: W / 2 + 10 }, theme: 'grid',
    styles: { fontSize: 9.5, cellPadding: 3.5, textColor: 20, lineColor: 190 },
    columnStyles: { 0: { cellWidth: 26, halign: 'center' }, 2: { halign: 'right', cellWidth: 100 } },
    body: summary,
    didParseCell: (d) => { if (d.row.index === 9) d.cell.styles.fontStyle = 'bold' },
  })
  const leftEnd = (doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? y + 200
  autoTable(doc, {
    startY: y, margin: { left: W / 2 + 10, right: M }, theme: 'grid',
    styles: { fontSize: 9, cellPadding: 3.5, textColor: 20, lineColor: 190 },
    head: [['Change order summary', 'Additions', 'Deductions']],
    headStyles: { fillColor: [235, 238, 242], textColor: 20, fontStyle: 'bold' },
    columnStyles: { 1: { halign: 'right' }, 2: { halign: 'right' } },
    body: [
      ['Approved in previous months', pm(t.co.priorAdd), pm(t.co.priorDeduct)],
      ['Approved this month', pm(t.co.thisAdd), pm(t.co.thisDeduct)],
      ['Totals', pm(t.co.priorAdd + t.co.thisAdd), pm(t.co.priorDeduct + t.co.thisDeduct)],
      ['Net change by change orders', { content: pm(t.coNet), colSpan: 2, styles: { halign: 'right' } } as never],
    ],
  })
  const after = (doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? y + 200
  let yc = after + 22
  doc.setFontSize(8.5); ink(60)
  const cert = doc.splitTextToSize('Signed for the contractor: the work billed here was done as the contract requires; the subcontractors and suppliers on work we were paid for on earlier applications have been paid; and the payment due above is owed now.', W / 2 - M - 10) as string[]
  doc.text(cert, W / 2 + 10, yc)
  yc += cert.length * 11 + 18
  ink()
  doc.text(`${info.companyName}`, W / 2 + 10, yc)
  doc.line(W / 2 + 10, yc + 22, W - M - 150, yc + 22); doc.text('Signature and title', W / 2 + 10, yc + 33)
  doc.line(W - M - 130, yc + 22, W - M, yc + 22); doc.text('Date', W - M - 130, yc + 33)
  if (app.note) { doc.setFontSize(8.5); ink(60); doc.text(doc.splitTextToSize(pdfSafe(`Note: ${app.note}`), W / 2 - M - 10) as string[], M, leftEnd + 18) }

  // ── The continuation sheet ──
  doc.addPage()
  doc.setFont('helvetica', 'bold'); doc.setFontSize(13); ink()
  doc.text('CONTINUATION SHEET', M, M + 4)
  doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5); ink(90)
  doc.text(`${info.jobName} · Application ${app.appNo} · Period to ${fmtDay(app.periodTo)} · Retainage ${app.release ? 'released' : `${pct(app.retPct)} on work, ${pct(app.storedRetPct)} on stored material`}`, M, M + 18)
  const row = (l: AppView['lines'][number]) => {
    const m = lineMath(l, app.retPct, app.storedRetPct, app.release)
    return [l.itemNo, l.area ?? '', l.description, pm(l.scheduled), pm(l.prev), pm(l.thisPeriod), pm(l.stored), pm(m.total), `${m.pct.toFixed(1)}%`, pm(m.balance), pm(m.ret)]
  }
  const base = app.lines.filter((l) => !l.isCo).map(row)
  const cos = app.lines.filter((l) => l.isCo).map(row)
  const sum = (f: (l: AppView['lines'][number]) => number) => app.lines.reduce((a, l) => a + Math.round(f(l) * 100), 0) / 100
  const totalScheduled = sum((l) => l.scheduled)
  const body: unknown[][] = [...base]
  if (cos.length) body.push([{ content: 'CHANGE ORDERS', colSpan: 11, styles: { fontStyle: 'bold', fillColor: [245, 246, 248] } }], ...cos)
  autoTable(doc, {
    startY: M + 28, margin: { left: M, right: M }, theme: 'grid',
    styles: { fontSize: 7.8, cellPadding: 2.6, textColor: 20, lineColor: 190 },
    headStyles: { fillColor: [235, 238, 242], textColor: 20, fontStyle: 'bold', fontSize: 7.4 },
    head: [['A\nItem', 'Area', 'B\nDescription of work', 'C\nScheduled value', 'D\nFrom previous', 'E\nThis period', 'F\nStored now', 'G\nCompleted & stored', 'G ÷ C', 'H\nBalance to finish', 'I\nRetainage']],
    columnStyles: { 0: { cellWidth: 34 }, 1: { cellWidth: 52 }, 3: { halign: 'right' }, 4: { halign: 'right' }, 5: { halign: 'right' }, 6: { halign: 'right' }, 7: { halign: 'right' }, 8: { halign: 'right', cellWidth: 38 }, 9: { halign: 'right' }, 10: { halign: 'right' } },
    body: body as never,
    foot: [['', '', 'TOTALS', pm(totalScheduled), pm(sum((l) => l.prev)), pm(sum((l) => l.thisPeriod)), pm(sum((l) => l.stored)), pm(t.completedStored), totalScheduled ? `${((t.completedStored / totalScheduled) * 100).toFixed(1)}%` : '', pm(Math.round((totalScheduled - t.completedStored) * 100) / 100), pm(t.retTotal)]],
    footStyles: { fillColor: [235, 238, 242], textColor: 20, fontStyle: 'bold', halign: 'right' },
  })
  const pages = doc.getNumberOfPages()
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i); doc.setFontSize(7.5); ink(140)
    doc.text(`${info.companyName} · ${info.jobName} · Application ${app.appNo} · page ${i} of ${pages}`, M, doc.internal.pageSize.getHeight() - 18)
  }
  return doc.output('blob')
}

/**
 * The workbook: "G703" with live formulas per line (G = D + E + F, % = G/C,
 * H = C − G, I = retainage from the percents at the top), and "G702" reading
 * its totals. Change a number in Excel or Google Sheets and the rest follow.
 */
export function payAppXlsx(info: DocInfo, app: AppView): Uint8Array {
  const H0 = 6 // the header row of the line table (1-based)
  const rows: Cell[][] = [
    [{ s: 'CONTINUATION SHEET', bold: true }, null, `${info.jobName} · Application ${app.appNo} · Period to ${fmtDay(app.periodTo)}`],
    ['Retainage on work (%)', null, app.release ? 0 : app.retPct],
    ['Retainage on stored material (%)', null, app.release ? 0 : app.storedRetPct],
    ['Less previous certificates', null, app.totals.prevCerts],
    [],
    ['Item', 'Area', 'Description', 'Scheduled value', 'From previous', 'This period', 'Stored now', 'Completed & stored', 'G ÷ C', 'Balance to finish', 'Retainage', 'Line retainage %'].map((s) => ({ s, bold: true }) as Cell),
  ]
  const first = H0 + 1
  app.lines.forEach((l, i) => {
    const r = first + i
    const own = l.retPct !== null && !app.release
    rows.push([
      l.itemNo, l.area ?? '', l.description, l.scheduled, l.prev, l.thisPeriod, l.stored,
      { f: `E${r}+F${r}+G${r}` },
      { f: `IF(D${r}=0,0,H${r}/D${r})` },
      { f: `D${r}-H${r}` },
      { f: `ROUND((E${r}+F${r})*IF(L${r}="",$C$2,L${r})/100+G${r}*$C$3/100,2)` },
      own ? (l.retPct as number) : null,
    ])
  })
  const last = first + app.lines.length - 1
  const T = last + 1
  const S = (col: string) => ({ f: app.lines.length ? `SUM(${col}${first}:${col}${last})` : '0' })
  rows.push([{ s: 'TOTALS', bold: true }, null, null, S('D'), S('E'), S('F'), S('G'), S('H'), { f: `IF(D${T}=0,0,H${T}/D${T})` }, S('J'), S('K')])
  const g703: Sheet = { name: 'G703', rows, widths: [8, 12, 44, 15, 15, 15, 15, 17, 9, 16, 14, 14] }

  const co = (pred: (l: AppView['lines'][number]) => boolean) => {
    const idx = app.lines.map((l, i) => (pred(l) ? `G703!D${first + i}` : null)).filter(Boolean)
    return idx.length ? { f: idx.join('+') } : 0
  }
  const g702: Sheet = {
    name: 'G702',
    widths: [6, 52, 20],
    rows: [
      [{ s: 'APPLICATION AND CERTIFICATE FOR PAYMENT', bold: true }],
      ['To', info.customer ?? ''], ['From', info.companyName], ['Project', info.jobName], ['Owner', info.ownerName ?? ''],
      ['Application no.', app.appNo], ['Application date', fmtDay(app.appDate)], ['Period to', fmtDay(app.periodTo)],
      ['Project no.', [info.jobNumber, info.customerJobNo].filter(Boolean).join(' / ')], ['Contract no.', info.contractNo ?? ''], ['Contract for', info.scope ?? ''],
      [],
      ['1', 'Original contract sum', co((l) => !l.isCo)],
      ['2', 'Net change by change orders', co((l) => l.isCo)],
      ['3', 'Contract sum to date (1 + 2)', { f: 'C13+C14' }],
      ['4', 'Total completed and stored to date', { f: `G703!H${T}` }],
      ['5', 'Retainage', { f: `G703!K${T}` }],
      ['6', 'Total earned less retainage (4 − 5)', { f: 'C16-C17' }],
      ['7', 'Less previous certificates for payment', { f: 'G703!C4' }],
      ['8', 'Current payment due (6 − 7)', { f: 'C18-C19' }],
      ['9', 'Balance to finish, including retainage (3 − 6)', { f: 'C15-C18' }],
    ],
  }
  return buildXlsx([g702, g703])
}
