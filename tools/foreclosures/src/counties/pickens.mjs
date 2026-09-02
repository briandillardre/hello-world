// Pickens: the Master-in-Equity posts a monthly PDF roster on the county site
// (revize CMS). Plain fetch works. Columns: CASE NO | CAPTION | DESCRIPTION
// (street address) | TMS | NOTES (CANCELLED / DEFICIENCY DEMANDED …).
import { COUNTIES } from '../config.mjs'
import { getText, getBuffer, log } from '../util.mjs'
import { pdfText } from '../pdf.mjs'

const MONTHS = ['JANUARY','FEBRUARY','MARCH','APRIL','MAY','JUNE','JULY','AUGUST','SEPTEMBER','OCTOBER','NOVEMBER','DECEMBER']

export async function pickensRosterUrl(saleDate) {
  const html = await getText(COUNTIES.pickens.rosterPage)
  const hrefs = [...html.matchAll(/href="([^"]+\.pdf)(\?[^"]*)?"/gi)].map(m => m[1])
  const month = MONTHS[saleDate.getMonth()], year = String(saleDate.getFullYear())
  // "SEPTEMBER 2026 8.31.2026.pdf" – skip RESULTS / DEFICIENCY files (those are post-sale)
  const pick = hrefs.filter(h => h.toUpperCase().includes(month) && h.includes(year) && !/RESULT|DEFICIENCY/i.test(h))
  if (!pick.length) return null
  // revize serves document-center files from its CDN path, not the page's folder
  return `https://cms5.revize.com/revize/pickenscountysc/${encodeURIComponent(pick[0]).replace(/%2F/g, '/')}`
}

export function parsePickensRoster(text) {
  const saleDate = (text.match(/^\s*([A-Z]+ \d{1,2}, \d{4})/m) || [])[1] || ''
  const reopen = (text.match(/BIDDING WILL REOPEN\s+ON\s+([A-Z]+ \d{1,2}, \d{4})/i) || [])[1] || ''
  const body = text.slice(text.indexOf('CASE NO'))
  const parts = body.split(/\n\s*(?=\d{1,2}\.\s+\d{4}-CP-\d{2}-\d{5})/)
  const rows = []
  for (const p of parts) {
    const m = p.match(/^(\d{1,2})\.\s+(\d{4}-CP-\d{2}-\d{5})\s+([\s\S]*)$/)
    if (!m) continue
    const rest = m[3].replace(/[ \t]+/g, ' ')
    const tmsM = rest.match(/\b(\d{4}-\d{2}-\d{2}-\d{4})\b/)
    const beforeTms = tmsM ? rest.slice(0, tmsM.index) : rest
    const notes = tmsM ? rest.slice(tmsM.index + tmsM[0].length).replace(/\s+/g, ' ').trim() : ''
    // address = the tail of the pre-TMS block starting at the first line that begins with a street number
    const lines = beforeTms.split('\n').map(s => s.trim()).filter(Boolean)
    let addrStart = lines.findIndex((l, i) => i > 0 && /^\d+\s/.test(l))
    if (addrStart < 0) addrStart = lines.length
    const caption = lines.slice(0, addrStart).join(' ').replace(/\s+/g, ' ').trim()
    const address = lines.slice(addrStart).join(' ').replace(/\s+/g, ' ').replace(/\s,/g, ',').trim()
    const [plaintiff, defendant] = caption.split(/\s+V\.?\s+(?=[A-Z])/)
    rows.push({
      county: 'pickens', saleNo: Number(m[1]), caseNo: m[2], caption, plaintiff: plaintiff || '', defendant: defendant || '',
      address, tms: tmsM ? tmsM[1] : '', notes,
      status: /CANCEL|WITHDRAWN|POSTPONE/i.test(notes) ? 'cancelled' : 'scheduled',
      deficiency: /DEFICIENCY\s+DEMANDED/i.test(notes) ? 'demanded' : 'unknown',
    })
  }
  return { saleDate, reopenDate: reopen, rows }
}

export async function listPickens(saleDate) {
  const url = await pickensRosterUrl(saleDate)
  if (!url) { log('pickens: no roster PDF posted yet for', saleDate.toDateString()); return { rows: [], source: null } }
  log('pickens roster', url)
  const { text } = await pdfText(await getBuffer(url))
  const r = parsePickensRoster(text)
  r.rows.forEach(x => { x.sources = { roster: url }; x.saleDate = r.saleDate; x.reopenDate = r.reopenDate })
  return { rows: r.rows, source: url }
}
