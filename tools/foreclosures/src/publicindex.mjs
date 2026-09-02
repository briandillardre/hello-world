// SC Judicial Public Index (publicindex.sccourts.org/<county>/publicindex/ – the
// same ASP.NET app Greenville hosts at www2.greenvillecounty.org/scjd/PublicIndex/).
// Gives the docket ("Actions") for a case and, where the county images its
// filings, a PIImageDisplay.aspx link per entry – that's where the Order of
// Foreclosure and Sale, the Form 4 judgment, the Notice of Sale and any
// deficiency-related orders live. Browser only: the site drops scripted clients.
import { parseCaseNo } from './config.mjs'
import { htmlToText, log } from './util.mjs'
import { goto, acceptDisclaimer, dump, download } from './browser.mjs'

const DOC_PATTERNS = {
  order:      /(?:judgment|judgement|decree|order)[^|\n]{0,60}(?:foreclos|sale)|foreclos[^|\n]{0,40}(?:judgment|order|decree)|form\s*4|judgment (?:in a civil case|filed|entered)/i,
  notOrder:   /reschedul|continu|amend|confirm|withdraw|cancel|postpon|vacat|supplemental|report of sale|deficiency/i,
  notice:     /notice of (?:master'?s? )?sale|notice of foreclosure sale|master'?s? sale/i,
  deficiency: /deficien/i,
  report:     /report of sale|master'?s? report|order confirming|bid/i,
}

async function onCasePage(page, caseNo) {
  const t = htmlToText(await page.content())
  return t.includes(caseNo.dashed) && /action|filed|date/i.test(t) && !/no records|not found|invalid/i.test(t.slice(0, 2000))
}

/** Land on the CaseDetails page for a case. Tries the direct URL first, then the search form. */
export async function openCase(page, cfg, caseNoStr, { dumpDir, headed } = {}) {
  const cn = parseCaseNo(caseNoStr); if (!cn) throw new Error('bad case number ' + caseNoStr)
  const agency = `${cfg.code}002` // Common Pleas
  await goto(page, cfg.index); await acceptDisclaimer(page)
  const direct = `${cfg.index}CaseDetails.aspx?County=${cfg.code}&CourtAgency=${agency}&Casenum=${cn.compact}&CaseType=V`
  await goto(page, direct); await acceptDisclaimer(page)
  if (await onCasePage(page, cn)) return { url: page.url(), via: 'direct' }

  // Fallback: the search form. Field ids vary a little per deployment – find by name.
  await goto(page, cfg.index); await acceptDisclaimer(page)
  const box = page.locator('input[id*="CaseNumber" i], input[id*="txtCase" i], input[name*="CaseNumber" i]').first()
  if (!(await box.count())) { if (dumpDir) await dump(page, dumpDir, `index-${cn.dashed}-nosearch`); throw new Error('public index: no case-number search box found (run --dump)') }
  await box.fill(cn.dashed)
  const captcha = page.locator('img[src*="captcha" i], input[id*="captcha" i], iframe[src*="recaptcha"]')
  if (await captcha.count()) {
    if (!headed) throw new Error('public index wants a captcha – rerun with --headed and solve it once; the profile keeps the session')
    log('  captcha on the public index – solve it in the browser window (waiting up to 3 min)')
    await page.waitForFunction(() => !document.querySelector('img[src*="captcha" i]') || location.href.includes('CaseDetails') || document.body.innerText.includes('Case Number'), null, { timeout: 180000 }).catch(() => {})
  }
  await Promise.all([page.waitForLoadState('domcontentloaded'), box.press('Enter')])
  await page.waitForTimeout(1500)
  const link = page.locator(`a:has-text("${cn.dashed}")`).first()
  if (await link.count()) { await link.click(); await page.waitForLoadState('domcontentloaded'); await page.waitForTimeout(1200) }
  if (dumpDir) await dump(page, dumpDir, `index-${cn.dashed}`)
  if (!(await onCasePage(page, cn))) throw new Error(`public index: could not open ${cn.dashed}`)
  return { url: page.url(), via: 'search' }
}

/** Docket rows with any document-image links. */
export async function readDocket(page) {
  const rows = await page.$$eval('table tr', trs => trs.map(tr => {
    const cells = [...tr.querySelectorAll('td')].map(td => td.textContent.replace(/\s+/g, ' ').trim())
    const a = tr.querySelector('a[href*="PIImageDisplay"], a[href*="doctype="], a[href*="Image"]')
    return { cells, href: a ? a.href : null }
  }).filter(r => r.cells.length >= 2))
  const docket = []
  for (const r of rows) {
    const date = r.cells.find(c => /^\d{1,2}\/\d{1,2}\/\d{4}$/.test(c)) || ''
    const desc = r.cells.filter(c => c && c !== date).sort((a, b) => b.length - a.length)[0] || ''
    if (!date && !r.href) continue
    docket.push({ date, description: desc, href: r.href })
  }
  return docket
}

export function classifyDocket(docket) {
  const pick = (re) => docket.filter(d => re.test(d.description))
  return {
    orders: pick(DOC_PATTERNS.order).filter(d => !DOC_PATTERNS.notOrder.test(d.description)).sort((a, b) => (/foreclos.{0,30}sale|judgment/i.test(b.description) ? 1 : 0) - (/foreclos.{0,30}sale|judgment/i.test(a.description) ? 1 : 0)), notices: pick(DOC_PATTERNS.notice), deficiency: pick(DOC_PATTERNS.deficiency), reports: pick(DOC_PATTERNS.report),
    hasImages: docket.some(d => d.href), judgmentDate: pick(DOC_PATTERNS.order).map(d => d.date).filter(Boolean).pop() || '',
  }
}

/** Open the case, read the docket, download the most useful images. Returns { url, docket, docs:[{kind,date,description,url,buf,type}] } */
export async function harvestCase(page, cfg, caseNo, { dumpDir, headed, maxDocs = 4 } = {}) {
  const opened = await openCase(page, cfg, caseNo, { dumpDir, headed })
  const docket = await readDocket(page)
  const c = classifyDocket(docket)
  const wanted = []
  for (const d of c.orders) if (d.href) { wanted.push({ kind: 'order', ...d }); break }   // best-ranked judgment/order first (rescheduling orders excluded)
  for (const d of [...c.notices].reverse()) if (d.href) { wanted.push({ kind: 'notice', ...d }); break }
  for (const d of c.deficiency) if (d.href && !wanted.some(w => w.href === d.href)) wanted.push({ kind: 'deficiency', ...d })
  const docs = []
  for (const w of wanted.slice(0, maxDocs)) {
    try { const { buf, type } = await download(page, w.href); docs.push({ ...w, url: w.href, buf, type }) }
    catch (e) { log(`  doc download failed (${w.description}):`, e.message) }
  }
  return { url: opened.url, via: opened.via, docket, summary: { entries: docket.length, hasImages: c.hasImages, judgmentDate: c.judgmentDate, deficiencyEntries: c.deficiency.map(d => `${d.date} ${d.description}`) }, docs }
}
