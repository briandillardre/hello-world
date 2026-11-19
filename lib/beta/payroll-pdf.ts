/**
 * The certified payroll as paper — the WH-347 layout (the U.S. Department of
 * Labor's public form: payroll page + statement of compliance). Runs in the
 * browser on the lines lib/beta/payroll.ts built. Deductions and net pay are
 * left for the payroll company; the page says so.
 */
import type { PayrollLine } from './payroll'
import { weekEnding } from './payroll'

export interface PayrollDocInfo { companyName: string; jobName: string; jobNumber: string | null; contractNo: string | null; payrollNo: number; weekStart: string; final: boolean; decision: string | null }

const fmt = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString('en-US', { month: 'numeric', day: 'numeric', year: 'numeric', timeZone: 'UTC' })
const m2 = (n: number | null) => (n === null ? '' : n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }))
const h = (n: number) => (n ? String(n) : '')

export async function payrollPdf(info: PayrollDocInfo, lines: PayrollLine[]): Promise<Blob> {
  const { jsPDF } = await import('jspdf')
  const autoTable = (await import('jspdf-autotable')).default
  const doc = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'legal' })
  const W = doc.internal.pageSize.getWidth()
  const M = 30
  doc.setFont('helvetica', 'bold'); doc.setFontSize(13)
  doc.text('PAYROLL — WH-347 layout', M, M + 4)
  doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5)
  const days = Array.from({ length: 7 }, (_, i) => new Date(Date.parse(`${info.weekStart}T12:00:00Z`) + i * 86_400_000))
  const head1: [string, string][] = [
    ['Contractor or subcontractor', info.companyName], ['Payroll no.', `${info.payrollNo}${info.final ? ' (FINAL)' : ''}`],
    ['For week ending', fmt(weekEnding(info.weekStart))], ['Project and location', `${info.jobName}${info.jobNumber ? ` (${info.jobNumber})` : ''}`],
    ['Project or contract no.', info.contractNo ?? ''], ['Wage decision', info.decision ?? ''],
  ]
  let y = M + 20
  head1.forEach(([k, v], i) => {
    const x = M + (i % 3) * ((W - 2 * M) / 3)
    if (i % 3 === 0 && i) y += 22
    doc.setFont('helvetica', 'bold'); doc.text(k, x, y)
    doc.setFont('helvetica', 'normal'); doc.text(String(v).slice(0, 70), x, y + 10)
  })
  const dayHead = days.map((d) => `${['S', 'M', 'T', 'W', 'T', 'F', 'S'][d.getUTCDay()]}\n${d.getUTCMonth() + 1}/${d.getUTCDate()}`)
  const body: string[][] = []
  for (const l of lines) {
    body.push([`${l.name}${l.idLast4 ? `\nxxx-xx-${l.idLast4}` : ''}`, '', l.classification ?? '(not set)', 'S', ...l.days.map((d) => h(d[0])), h(l.st), m2(l.rateSt), m2(l.grossProject), m2(l.grossAll), '', '', '', '', ''])
    body.push(['', '', '', 'O', ...l.days.map((d) => h(d[1])), h(l.ot), m2(l.rateOt), '', '', '', '', '', '', ''])
  }
  autoTable(doc, {
    startY: y + 24,
    margin: { left: M, right: M },
    head: [['(1) Name, ID', '(2) Exempt.', '(3) Work classification', 'OT/ST', ...dayHead, '(5) Total hours', '(6) Rate of pay', '(7) Gross — this project', 'Gross — all work', 'FICA', 'Withholding', 'Other', 'Total deductions', '(9) Net wages']],
    body,
    styles: { fontSize: 7, cellPadding: 2, valign: 'middle', lineColor: [160, 160, 160], lineWidth: 0.4 },
    headStyles: { fillColor: [235, 235, 235], textColor: 20, fontStyle: 'bold', fontSize: 6.5 },
    theme: 'grid',
  })
  const after = (doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? y + 200
  doc.setFontSize(7.5)
  doc.text('Hours are from GPS-verified time cards. Deductions and net wages are completed by payroll before signing. Fringe paid in cash is included in the rate of pay; fringe paid to plans is listed on the statement of compliance.', M, Math.min(after + 14, doc.internal.pageSize.getHeight() - 20), { maxWidth: W - 2 * M })

  // ── Statement of compliance ──
  doc.addPage('letter', 'portrait')
  const W2 = doc.internal.pageSize.getWidth()
  doc.setFont('helvetica', 'bold'); doc.setFontSize(12)
  doc.text('STATEMENT OF COMPLIANCE', M, M + 10)
  doc.setFont('helvetica', 'normal'); doc.setFontSize(9.5)
  const plan = lines.filter((l) => l.fringePlan > 0)
  const para = [
    'Date: ____________________',
    'I, ______________________________ (name of signatory), ______________________ (title), do hereby state:',
    `(1) That I pay or supervise the payment of the persons employed by ${info.companyName} on ${info.jobName}; that during the payroll period commencing on ${fmt(info.weekStart)} and ending on ${fmt(weekEnding(info.weekStart))}, all persons employed on said project have been paid the full weekly wages earned, that no rebates have been or will be made either directly or indirectly to or on behalf of said contractor from the full weekly wages earned by any person, and that no deductions have been made either directly or indirectly from the full wages earned by any person, other than permissible deductions as defined in 29 CFR Part 3.`,
    '(2) That any payrolls otherwise under this contract required to be submitted for the above period are correct and complete; that the wage rates for laborers or mechanics contained therein are not less than the applicable wage rates contained in any wage determination incorporated into the contract; that the classifications set forth therein for each laborer or mechanic conform with the work he or she performed.',
    '(3) That any apprentices employed in the above period are duly registered in a bona fide apprenticeship program registered with a State apprenticeship agency recognized by the Office of Apprenticeship, United States Department of Labor, or if no such recognized agency exists in a State, are registered with the Office of Apprenticeship.',
    '(4) That:',
    `   (a) Where fringe benefits are paid to approved plans, funds, or programs — ${plan.length ? `payments of fringe benefits as listed in the contract have been or will be made to appropriate programs for the benefit of such employees, except as noted in section 4(c) below. (${plan.map((l) => `${l.name}: $${l.fringePlan.toFixed(2)}/hr`).join('; ')})` : '[ ] check if applicable'}`,
    '   (b) Where fringe benefits are paid in cash — each laborer or mechanic listed in the above referenced payroll has been paid, as indicated on the payroll, an amount not less than the sum of the applicable basic hourly wage rate plus the amount of the required fringe benefits as listed in the contract, except as noted in section 4(c) below.',
    '   (c) Exceptions: ______________________________________________________________',
    'Remarks: ________________________________________________________________________',
    '',
    'Name and title: ______________________________     Signature: ______________________________',
    '',
    'The willful falsification of any of the above statements may subject the contractor or subcontractor to civil or criminal prosecution. See Section 1001 of Title 18 and Section 231 of Title 31 of the United States Code.',
  ]
  let yy = M + 32
  for (const p of para) {
    const wrapped = doc.splitTextToSize(p, W2 - 2 * M) as string[]
    doc.text(wrapped, M, yy)
    yy += wrapped.length * 12 + 6
  }
  return doc.output('blob')
}
