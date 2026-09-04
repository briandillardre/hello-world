// Charleston: the Master's running auction list is a plain HTML page
// (Word-exported table). Columns: Date of Sale + short case no, Plaintiff,
// Defendant, TMS & Address, Judgment $, Lien, Attorney, area. FINAL sales are
// Tuesdays 11:00 at the PSB council chambers; re-open (day-30) sales are
// Thursdays at 100 Broad St. Bidders must register by noon the Monday before.
import { parseMoney, getText, htmlToText, log } from '../util.mjs'

export const CHS_LIST = 'https://www.charlestoncounty.org/foreclosure/runninglist.html'

export function parseCharlestonList(html) {
  const rows = []
  let section = ''
  for (const tr of html.match(/<tr[\s\S]*?<\/tr>/g) || []) {
    const cells = [...tr.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map(m => htmlToText(m[1]).replace(/\n/g, ' ').replace(/ /g, ' ').replace(/\s+/g, ' ').trim())
    if (!cells.length) continue
    if (cells.filter(Boolean).length === 1 && /SALES/i.test(cells[0])) { section = cells[0]; continue }
    const m = cells[0].match(/(\d{1,2})-(\d{1,2})-(\d{2})\s+(\d{2})-(\d{5})/)
    if (!m) continue
    const saleDate = `${m[1]}/${m[2]}/20${m[3]}`
    const caseNo = `20${m[4]}-CP-10-${m[5]}`
    const tmsAddr = cells[3] || ''
    const tms = [...tmsAddr.matchAll(/\b(\d{10})\b/g)].map(x => x[1])
    const address = tmsAddr.replace(/\b\d{10}\b/g, '').replace(/\s+/g, ' ').trim()
    rows.push({
      county: 'charleston', caseNo, shortCase: `${m[4]}-${m[5]}`, saleDate, section, status: 'scheduled',
      plaintiff: cells[1], defendant: cells[2], tms: tms.join(', '), address: address + (cells[7] ? `, ${cells[7]}` : ''), area: cells[7] || '',
      lien: cells[5], attorney: cells[6],
      deficiency: /open/i.test(section) ? 'demanded' : 'unknown',   // the list itself doesn't say; OPEN SALES = day-30 re-bids
      judgment: parseMoney(cells[4]) != null ? { totalDebt: parseMoney(cells[4]), asOfDate: '', extractedBy: 'county-list', source: CHS_LIST, sourceLabel: "Judgment column on the Charleston Master's auction list" } : undefined,
      sources: { roster: CHS_LIST },
    })
  }
  return rows
}

export async function listCharleston(saleDate) {
  const rows = parseCharlestonList(await getText(CHS_LIST))
  const want = `${saleDate.getMonth() + 1}/${saleDate.getDate()}/${saleDate.getFullYear()}`
  const mine = rows.filter(r => r.saleDate === want)
  log(`charleston: ${rows.length} rows on the running list, ${mine.length} dated ${want}` + (mine.length ? '' : ` (dates present: ${[...new Set(rows.map(r => r.saleDate))].join(', ')})`))
  return { rows: mine.length ? mine : rows, source: CHS_LIST }
}
