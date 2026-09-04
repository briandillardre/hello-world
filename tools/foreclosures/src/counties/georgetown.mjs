// Georgetown: monthly list posted to the county DocumentCenter as a PDF or an
// Excel file ("August-2026-foreclosure-sales"). Columns: case (short), plaintiff,
// defendant, TMS, address (Gtown/MI/Pawleys abbreviations), date of compliance,
// interest rate, deficiency Yes/No, cancellation note. Sales are first Monday at NOON.
import * as XLSX from 'xlsx'
import { getText, getBuffer, get, log } from '../util.mjs'
import { pdfText } from '../pdf.mjs'

const PAGE = 'https://www.gtcountysc.gov/223/Foreclosure-Sales'
const MONTHS = ['january','february','march','april','may','june','july','august','september','october','november','december']

const fullCase = (s) => { const m = String(s).match(/(\d{4})-0*(\d{1,5})/); return m ? `${m[1]}-CP-22-${m[2].padStart(5, '0')}` : String(s).trim() }
const expandTown = (a) => a.replace(/\bGtown\b/i, 'Georgetown, SC').replace(/\bMI\b/, 'Murrells Inlet, SC').replace(/\bPawleys\b/i, 'Pawleys Island, SC').replace(/\bHway\b/i, 'Hemingway, SC').replace(/\bAndrews\b(?!, SC)/i, 'Andrews, SC')

export async function georgetownDocForMonth(saleDate) {
  const html = await getText(PAGE)
  const ids = [...new Set([...html.matchAll(/DocumentCenter\/View\/(\d+)/g)].map(m => Number(m[1])))].sort((a, b) => b - a).slice(0, 12)
  const month = MONTHS[saleDate.getMonth()], year = String(saleDate.getFullYear())
  const named = []
  for (const id of ids) {
    // GET (HEAD is refused) and drop the body – the redirect target carries the document's title
    const r = await get(`https://www.gtcountysc.gov/DocumentCenter/View/${id}`).catch(() => null)
    if (!r) continue
    try { await r.body?.cancel() } catch {}
    const name = decodeURIComponent(r.url.split('/').pop().split('?')[0]).toLowerCase()
    named.push({ id, name, type: r.headers.get('content-type') || '' })
  }
  const exact = named.find(n => n.name.includes(month) && n.name.includes(year))
  const monthOnly = named.find(n => n.name.includes(month))   // the office has posted "September-2027" for a 2026 sale
  const pick = exact || monthOnly
  if (pick && !exact) log(`georgetown: using "${pick.name}" – month matches, year in the file name does not`)
  return pick ? { url: `https://www.gtcountysc.gov/DocumentCenter/View/${pick.id}`, name: pick.name, type: pick.type } : null
}

function rowsFromCells(cellRows) {
  const rows = []
  for (const c of cellRows) {
    const cells = c.map(x => String(x ?? '').trim())
    const i = cells.findIndex(x => /^\d{4}-\d{2,5}$/.test(x)); if (i < 0) continue
    const [cs, pl, df, tms, addr, comp, rate, def, , note] = cells.slice(i)
    rows.push({ county: 'georgetown', caseNo: fullCase(cs), shortCase: cs, plaintiff: pl, defendant: df, tms, address: expandTown(addr || ''), compliance: comp, bidInterestRate: rate,
      deficiency: /^y/i.test(def) ? 'demanded' : /^n/i.test(def) ? 'waived' : 'unknown', notes: note || '', status: /cancel|withdraw|postpon/i.test(note || '') ? 'cancelled' : 'scheduled', sources: {} })
  }
  return rows
}

export function parseGeorgetownPdf(text) {
  // pdf text is one field per line; chunk at each short case number
  const lines = text.split('\n').map(s => s.trim()).filter(Boolean)
  const out = []
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^(\d{4}-\d{2,5})(?:\s+(.+))?$/)
    if (!m) continue
    const f = m[2] ? [m[1], m[2], ...lines.slice(i + 1, i + 8)] : lines.slice(i, i + 9)
    // deficiency and rate sometimes share a line: "11.02% No"
    const flat = f.join('\n').replace(/(\d+(?:\.\d+)?%|in Note)\s+(Yes|No)\b/i, '$1\n$2').split('\n')
    out.push(flat)
  }
  return rowsFromCells(out)
}

export async function listGeorgetown(saleDate) {
  const doc = await georgetownDocForMonth(saleDate)
  if (!doc) { log('georgetown: no list posted yet for', saleDate.toDateString()); return { rows: [], source: PAGE } }
  const buf = await getBuffer(doc.url)
  let rows
  if (/pdf/i.test(doc.type) || buf.slice(0, 4).toString() === '%PDF') rows = parseGeorgetownPdf((await pdfText(buf)).text)
  else { const wb = XLSX.read(buf, { type: 'buffer' }); rows = rowsFromCells(XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: '' })) }
  rows.forEach(r => { r.sources.roster = doc.url })
  log(`georgetown: ${rows.length} rows from ${doc.name}`)
  return { rows, source: doc.url }
}
