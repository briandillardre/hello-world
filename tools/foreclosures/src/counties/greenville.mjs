// Greenville: the Greenville Journal runs the Master-in-Equity site
// (mie.greenvillejournal.com, WordPress + WPAdverts). Each case is an "advert"
// with the Notice of Sale text, the sale date, and – the prize – the ORDER OF
// FORECLOSURE AND SALE / Form 4 PDF uploaded under order_judgment/. The site
// sits behind SiteGround's bot check, so it goes through the browser.
// Property card: county Real Property search (plain fetch, no bot wall).
import { COUNTIES, parseCaseNo } from '../config.mjs'
import { htmlToText, log, get, getText } from '../util.mjs'
import { goto, download, dump } from '../browser.mjs'
import { parseNotice } from '../notice.mjs'

const BASE = COUNTIES.greenville.journal

async function collectAdvertLinks(page, { dumpDir, maxPages = 15 } = {}) {
  const links = new Set()
  let url = BASE
  for (let i = 0; i < maxPages && url; i++) {
    await goto(page, url, { waitFor: 'a[href*="/advert/"]' })
    if (dumpDir && i === 0) await dump(page, dumpDir, 'greenville-journal-home')
    const found = await page.$$eval('a[href*="/advert/"]', as => as.map(a => a.href))
    found.forEach(h => links.add(h.split('#')[0].replace(/\/$/, '') + '/'))
    const next = await page.$eval('a.next, .pagination a[rel=next], a:has-text("Next")', a => a.href).catch(() => null)
    url = next && next !== url ? next : null
  }
  return [...links]
}

export async function readAdvert(page, url, { dumpDir } = {}) {
  await goto(page, url)
  const html = await page.content()
  const text = htmlToText(html)
  const caseNo = parseCaseNo((url.match(/advert\/(\d{4}-cp-\d{2}-\d{5})/i) || [])[1] || (text.match(/\d{4}-CP-\d{2}-\d{5}/) || [])[0])
  const pdfs = [...new Set([...html.matchAll(/href="([^"]+\.pdf)"/gi)].map(m => m[1]))]
  const orderPdf = pdfs.find(p => /order|judgment|judgement|decree|form/i.test(p)) || null
  const noticePdf = pdfs.find(p => /notice/i.test(p)) || null
  const n = parseNotice(text)
  // WPAdverts renders a label/value list; harvest anything that looks like one.
  const field = (label) => (text.match(new RegExp(label + '\\s*:?\\s*\\n?\\s*([^\\n]{1,160})', 'i')) || [])[1]?.trim() || ''
  const row = {
    county: 'greenville', caseNo: caseNo?.dashed || '', address: field('(?:Property )?Address') || n.address,
    plaintiff: field('Plaintiff') || n.plaintiff, defendant: field('Defendant') || n.defendant,
    attorney: field('Attorney'), lawFirm: field('Law Firm'), saleNo: Number((field('(?:Sale ?#|Sale No\\.?)').match(/\d+/) || [0])[0]) || null,
    saleDate: field('Sale Date') || n.saleDate, tms: field('TMS') || n.tms,
    deficiency: /demanded|^\s*yes\b/i.test(field('Deficiency')) ? 'demanded' : /waived|^\s*no\b/i.test(field('Deficiency')) ? 'waived' : n.deficiency,
    status: /withdrawn|cancel/i.test(field('Status') + ' ' + field('Comments')) ? 'withdrawn' : 'scheduled',
    notice: n, sources: { advert: url, orderPdf, noticePdf },
  }
  if (dumpDir) await dump(page, dumpDir, 'greenville-advert-' + (row.caseNo || 'x'))
  return row
}

export async function listGreenville(saleDate, { page, dumpDir } = {}) {
  const want = saleDate.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }).toLowerCase()
  const wantNum = `${saleDate.getMonth() + 1}/${saleDate.getDate()}/${saleDate.getFullYear()}`
  const links = await collectAdvertLinks(page, { dumpDir })
  log(`greenville: ${links.length} case pages on the Journal MIE site`)
  const rows = []
  for (const l of links) {
    try {
      const r = await readAdvert(page, l)
      const sd = (r.saleDate || '').toLowerCase().replace(/\s+/g, ' ')
      if (sd && !(sd.includes(want) || sd.includes(wantNum) || sd.includes(wantNum.replace(/\b(\d)\//g, '0$1/')))) continue
      rows.push(r)
    } catch (e) { log('greenville advert failed', l, e.message) }
  }
  rows.sort((a, b) => (a.saleNo || 999) - (b.saleNo || 999))
  return { rows, source: BASE }
}

/** Download the Order of Foreclosure / Form 4 the Journal attached to the case. */
export async function greenvilleOrderPdf(page, row) {
  if (!row.sources?.orderPdf) return null
  const { buf } = await download(page, row.sources.orderPdf)
  return { buf, url: row.sources.orderPdf, label: 'Order of Foreclosure and Sale (Greenville Journal MIE upload)' }
}

// ── Property card: greenvillecounty.org Real Property search (ASP.NET WebForms) ──
const RP = 'https://www.greenvillecounty.org/appsAS400/RealProperty/'
function hiddenFields(html) {
  const f = {}
  for (const m of html.matchAll(/<input[^>]+type="hidden"[^>]*>/g)) { const n = (m[0].match(/name="([^"]+)"/) || [])[1]; const v = (m[0].match(/value="([^"]*)"/) || [])[1] || ''; if (n) f[n] = v }
  return f
}
export async function greenvillePropertyCard(address) {
  const CITY = '(?:Greenville|Simpsonville|Greer|Taylors|Mauldin|Travelers Rest|Fountain Inn|Piedmont|Marietta|Pelzer|Easley)'
  const SUFFIX = '(?:Rd|Road|Dr|Drive|St|Street|Ln|Lane|Ct|Court|Ave|Avenue|Way|Hwy|Highway|Blvd|Cir|Circle|Pl|Place|Trl|Trail|Pkwy|Ter|Terrace|Loop|Run|Path)'
  let raw = String(address).replace(/\./g, '').replace(/^(\d+[A-Za-z]?)\s*(?:and|&)\s*\d+[A-Za-z]?\s+/i, '$1 ')
  raw = raw.replace(/,.*$/, '')                                                        // drop ", SC 29601"
  raw = raw.replace(new RegExp('\\s+' + CITY + '(?:\\s+(?:SC|South Carolina)\\b.*)?$', 'i'), '')  // drop a TRAILING city only – "2100 Easley Bridge Rd" keeps its city-named street
  raw = raw.trim()
  const first = await getText(RP + 'Default.aspx')
  const f = hiddenFields(first)
  const year = (first.match(/ddl_TaxYears[\s\S]*?<option selected="selected" value="(\d{4})"/) || first.match(/ddl_TaxYears[\s\S]*?<option[^>]*value="(\d{4})"/) || [])[1]
  const numRaw = (raw.match(/^[\dA-Za-z-]+/) || [''])[0]
  const num = numRaw.replace(/[^0-9a-z]/gi, '')                 // "9-A" → "9A"
  const name = raw.slice(numRaw.length).trim()
  const nameNoDir = name.replace(/^(?:N|S|E|W|North|South|East|West)\.?\s+/i, '')
  const nameNoSuffix = nameNoDir.replace(/\s+(?:Dr|Drive|Rd|Road|St|Street|Ln|Lane|Ct|Court|Ave|Avenue|Way|Hwy|Highway|Blvd|Cir|Circle|Pl|Place|Trl|Trail)\.?$/i, '')
  const candidates = [...new Set([raw, `${num} ${name}`, `${num} ${nameNoDir}`, `${num} ${nameNoSuffix}`, name, nameNoDir, nameNoSuffix].map(s => s.trim()).filter(Boolean))]
  const search = async (street) => {
    const body = new URLSearchParams({ ...f, 'ctl00$body$ddl_TaxYears': year || String(new Date().getFullYear()), 'ctl00$body$txt_Name': '', 'ctl00$body$txt_Street': street, 'ctl00$body$txt_MapNumber': '', 'ctl00$body$txt_Subdivision': '', 'ctl00$body$txt_SheetNumber': '', '__EVENTTARGET': 'ctl00$body$btn_Search_ByStreet', '__EVENTARGUMENT': '' })
    const res = await (await get(RP + 'Default.aspx', { method: 'POST', body, headers: { 'content-type': 'application/x-www-form-urlencoded', referer: RP + 'Default.aspx' } })).text()
    // one chunk per result row: split on <tr, keep chunks that carry a Details link
    // map numbers can start with a letter (P… mobile homes, M… condos); cells = [links, mapNo, owner, address, lot, district]
    return res.split(/<tr\b/i).map(ch => ({ ch, m: ch.match(/Details\.aspx\?MapNumber=([A-Z0-9]+)&(?:amp;)?TaxYear=(\d+)/) })).filter(x => x.m)
      .map(({ ch, m }) => { const cells = [...ch.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map(c => htmlToText(c[1]).replace(/\n/g, ' ').trim()); return { mapNo: m[1], taxYear: m[2], owner: cells[2] || '', siteAddress: cells[3] || '', text: cells.join(' | ') } })
  }
  let hit = null
  for (const c of candidates) {
    const rows = await search(c)
    if (!rows.length) continue
    const norm = (a) => a.replace(/[^0-9a-z]/gi, '').toUpperCase()
    const byNum = rows.find(r => norm((r.siteAddress.match(/^[\dA-Za-z-]+/) || [''])[0]) === num.toUpperCase() && (!nameNoSuffix || norm(r.siteAddress).includes(norm(nameNoSuffix).slice(0, 6))))
    if (byNum) { hit = byNum; hit.matches = rows.length; break }
    // "39B" not found → accept "39" on the same street (unit letters are often dropped on the card)
    const digits = num.replace(/\D/g, '')
    const byDigits = digits && rows.find(r => (r.siteAddress.match(/^\d+/) || [''])[0] === digits && norm(r.siteAddress).includes(norm(nameNoSuffix).slice(0, 6)))
    if (byDigits) { hit = byDigits; hit.matches = rows.length; hit.approx = true; break }
  }
  if (!hit) return null
  const mapNo = hit.mapNo, taxYear = hit.taxYear, hits = [null, mapNo, taxYear]
  const detail = htmlToText(await getText(`${RP}Details.aspx?MapNumber=${mapNo}&TaxYear=${taxYear}`))
  const v = (label) => { const val = ((detail.match(new RegExp(label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*\\n?\\s*([^\\n]+)', 'i')) || [])[1] || '').trim(); return /^[A-Za-z][A-Za-z /#()-]{1,30}:$/.test(val) ? '' : val }  // empty field → next label bleeds in; drop it
  return {
    source: `${RP}Details.aspx?MapNumber=${mapNo}&TaxYear=${taxYear}`, parcel: mapNo, matches: hit.matches || 1, resultRow: hit.text.slice(0, 160), approxMatch: !!hit.approx, siteAddress: hit.siteAddress,
    owner: v('Owner(s):'), previousOwner: v('Previous Owner:'), mailing: v('Mailing Address:'),
    acreage: v('Acreage:'), lot: v('Description:'), subdivision: v('Subdivision:'), deedBookPage: v('Deed Book-Page:'), deedDate: v('Deed Date:'),
    lastSalePrice: v('Sale Price:'), platBookPage: v('Plat Book-Page:'), assessmentClass: v('Assessment Class:'), homestead: v('Homestead Code:'), landUse: v('Land Use:'),
    fmv: v('Fair Market Value:'), taxableValue: v('Taxable Market Value:'), taxes: v('Taxes:'),
  }
}
