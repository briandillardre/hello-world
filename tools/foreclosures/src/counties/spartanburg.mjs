// Spartanburg: two sources.
//  1. The county's DocumentCenter folder "Current Property to be Sold" (folder 114) –
//     a React widget, so it needs the browser. Holds the official sale list PDF.
//  2. Spartan Weekly's Master-in-Equity legal notices – plain HTML, one page per
//     property with the FULL Notice of Sale (deficiency language, TMS, legal
//     description, interest rate on the bid). Works without a browser.
// `list` merges both: the notice pages give every case advertised for the sale
// date; the DocumentCenter PDF (when readable) supplies sale numbers + cancellations.
import { COUNTIES, parseCaseNo } from '../config.mjs'
import { getText, htmlToText, log } from '../util.mjs'
import { parseNotice } from '../notice.mjs'
import { goto, download, dump } from '../browser.mjs'
import { pdfText } from '../pdf.mjs'

const BASE = 'https://www.spartanweeklyonline.com'

export async function spartanWeeklyNotices(saleDate, { maxPages = 12 } = {}) {
  const want = saleDate.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }) // "September 8, 2026"
  const seen = new Set(), rows = []
  for (let p = 1; p <= maxPages; p++) {
    const html = await getText(`${COUNTIES.spartanburg.notices}?page=${p}`)
    const links = [...html.matchAll(/href="(\/legal-notices\/[a-z0-9-]+)"/g)].map(m => m[1]).filter(h => !/master-and-equity|all-other|probate|^\/legal-notices\/?$/.test(h))
    const fresh = links.filter(l => !seen.has(l)); if (!fresh.length) break
    for (const l of fresh) {
      seen.add(l)
      const page = await getText(BASE + l)
      const text = htmlToText(page)
      const caseNo = parseCaseNo((text.match(/Case (?:Number|#)\s*:?\s*(\d{4}-CP-\d{2}-\d{5})/i) || [])[1])
      if (!caseNo) continue
      const n = parseNotice(text)
      const forThisSale = n.saleDate && n.saleDate.replace(/\s+/g, ' ').toLowerCase().includes(want.toLowerCase())
      if (!forThisSale) continue
      const titleAddr = (text.match(/Master In Equity\s+(\d[^\n]+?)\s+Case (?:Number|#)/i) || [])[1] || ''
      rows.push({ county: 'spartanburg', caseNo: caseNo.dashed, address: titleAddr || n.address,
        plaintiff: n.plaintiff, defendant: n.defendant, tms: n.tms, deficiency: n.deficiency, status: 'scheduled', saleDate: n.saleDate,
        notice: n, sources: { notice: BASE + l } })
    }
    // once a whole page is older than our sale, stop paging
    if (!fresh.some(l => rows.some(r => r.sources.notice.endsWith(l)))) { if (p > 2) break }
  }
  return rows
}

/** Official list PDF from the county DocumentCenter (browser). Returns { url, text } or null. */
export async function spartanburgListPdf(page, { dumpDir } = {}) {
  await goto(page, COUNTIES.spartanburg.docCenter, { waitFor: 'a[href*="/DocumentCenter/View/"]' })
  if (dumpDir) await dump(page, dumpDir, 'spartanburg-doccenter')
  const links = await page.$$eval('a[href*="/DocumentCenter/View/"]', as => as.map(a => ({ href: a.href, text: (a.textContent || '').trim() })))
  const cand = links.filter(l => /sale|list|property|sold|\d{4}/i.test(l.text) && !/deficien|cancell|result|terms|purchaser/i.test(l.text))
  const pick = cand[0] || links[0]
  if (!pick) return null
  const { buf } = await download(page, pick.href)
  const { text } = await pdfText(buf)
  return { url: pick.href, text }
}

/** Parse the county list PDF: lines like "12.  Plaintiff v. Defendant   26-1234 ... address" – layout varies, keep it loose. */
export function parseSpartanburgList(text) {
  const rows = []
  for (const m of text.matchAll(/(?:^|\n)\s*(\d{1,3})\.\s+(.+?)\s+v\.?\s+(.+?)\s{2,}(\d{2}-\d{4})\b([\s\S]*?)(?=\n\s*\d{1,3}\.\s|\s*$)/gi)) {
    const [, no, pl, df, short, tail] = m
    const addr = (tail.match(/\n\s*(\d+\s[^\n]+?,\s*(?:SC|South Carolina)\s*\d{5})/i) || [])[1] || ''
    rows.push({ saleNo: Number(no), plaintiff: pl.trim(), defendant: df.trim(), shortCase: short, address: addr.trim(), status: /cancel|withdraw/i.test(tail) ? 'cancelled' : 'scheduled' })
  }
  return rows
}

export async function listSpartanburg(saleDate, { page = null, dumpDir } = {}) {
  const rows = await spartanWeeklyNotices(saleDate)
  log(`spartanburg: ${rows.length} notices for ${saleDate.toDateString()} (Spartan Weekly)`)
  if (page) {
    try {
      const pdf = await spartanburgListPdf(page, { dumpDir })
      if (pdf?.text) {
        const official = parseSpartanburgList(pdf.text)
        for (const o of official) {
          const hit = rows.find(r => r.address && o.address && r.address.toLowerCase().startsWith(o.address.toLowerCase().slice(0, 12)))
            || rows.find(r => r.caseNo.endsWith(o.shortCase.replace('-', '-0')) || r.caseNo.slice(2, 4) + '-' + r.caseNo.slice(-4) === o.shortCase)
          if (hit) { hit.saleNo = o.saleNo; if (o.status === 'cancelled') hit.status = 'cancelled'; hit.sources.roster = pdf.url }
          else rows.push({ county: 'spartanburg', caseNo: '', shortCase: o.shortCase, saleNo: o.saleNo, plaintiff: o.plaintiff, defendant: o.defendant, address: o.address, status: o.status, deficiency: 'unknown', sources: { roster: pdf.url } })
        }
        log(`spartanburg: merged ${official.length} rows from the county list PDF`)
      }
    } catch (e) { log('spartanburg: county list PDF skipped –', e.message) }
  }
  return { rows, source: COUNTIES.spartanburg.notices }
}
