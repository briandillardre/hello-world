// Horry: the county's own "Principal Sales" page is an HTML table with the
// base judgment amount, deficiency Yes/No, a Land Records link (TMS) and direct
// Public Index image links for the Notice of Sale and the Judgment. Plain fetch.
// Upset-bid (day-30) sales live on a sibling page.
import { parseCaseNo } from '../config.mjs'
import { getText, htmlToText, parseMoney, log } from '../util.mjs'

export const HORRY_PRINCIPAL = 'https://www.horrycountysc.gov/departments/master-in-equity/principal-sales/'
export const HORRY_UPSET = 'https://www.horrycountysc.gov/departments/master-in-equity/upset-bid-sales/'

export function parseHorryTable(html) {
  const saleDate = (htmlToText(html).match(/Principal Sale\s*\n?\s*([A-Za-z]+,? [A-Za-z]+ \d{1,2},? \d{4})/i) || [])[1] || ''
  const table = html.slice(html.indexOf('<table'), html.indexOf('</table>') + 8)
  const rows = []
  for (const tr of table.match(/<tr[\s\S]*?<\/tr>/g) || []) {
    const tds = [...tr.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map(m => m[1])
    if (tds.length < 8) continue
    const txt = tds.map(c => htmlToText(c).replace(/\n/g, ' ').trim())
    const link = (c) => (c.match(/href="([^"]+)"/) || [])[1]?.replace(/&amp;/g, '&') || null
    const cn = parseCaseNo(txt[0]); if (!cn) continue
    const unit = (txt[0].match(/-\s*(.+)$/) || [])[1] || ''
    const land = link(tds[3]), notice = link(tds[4]), judgment = link(tds[5])
    rows.push({
      county: 'horry', caseNo: cn.dashed, unit, specialReferee: txt[1], address: txt[2], tms: (land && (land.match(/TMS=([A-Za-z0-9]+)/) || [])[1]) || '',
      plaintiff: '', defendant: '', lienType: txt[7], status: 'scheduled', saleDate,
      deficiency: /^y/i.test(txt[8]) ? 'demanded' : /^n/i.test(txt[8]) ? 'waived' : 'unknown',
      judgment: parseMoney(txt[6]) != null ? { totalDebt: parseMoney(txt[6]), asOfDate: '', extractedBy: 'county-list', source: HORRY_PRINCIPAL, sourceLabel: 'Base judgment amount on the Horry MIE principal-sales list' } : undefined,
      sources: { roster: HORRY_PRINCIPAL, landRecords: land, noticePdf: notice, orderPdf: judgment },
    })
  }
  return { saleDate, rows }
}

export async function listHorry(saleDate) {
  const html = await getText(HORRY_PRINCIPAL)
  const r = parseHorryTable(html)
  const want = saleDate.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }).toLowerCase()
  if (r.saleDate && !r.saleDate.toLowerCase().includes(want)) log(`horry: page shows sale "${r.saleDate}", you asked for ${want} – listing it anyway`)
  log(`horry: ${r.rows.length} rows (${r.saleDate})`)
  return { rows: r.rows, source: HORRY_PRINCIPAL }
}
