// Generic Master-in-Equity sale roster from the statewide CMSWeb court-roster app
// (publicindex.sccourts.org/<county>/courtrosters/RosterSelection.aspx – same app
// Greenville and Charleston host on their own domains). Needs the browser: the
// page is ASP.NET postbacks and the state site blocks non-browser clients.
// Flow: pick agency "<County> Master in Equity" → roster type "Master's Sales"
// → begin date → Refresh → click the roster for our sale date → read the table.
import { htmlToText, log } from '../util.mjs'
import { goto, acceptDisclaimer, dump } from '../browser.mjs'
import { parseCaseNo, fmtDate } from '../config.mjs'

export async function listFromSccourtsRoster(county, cfg, saleDate, { page, dumpDir } = {}) {
  await goto(page, cfg.rosterUrl)
  await acceptDisclaimer(page)
  const agencySel = 'select[id$="DropDownListAgencies"]'
  const typeSel = 'select[id$="DropDownListRosterType"]'
  const agencies = await page.$$eval(agencySel + ' option', os => os.map(o => ({ v: o.value, t: o.textContent.trim() })))
  const mie = agencies.find(a => /master/i.test(a.t))
  if (!mie) throw new Error(`${county}: no Master-in-Equity agency in roster dropdown (${agencies.map(a => a.t).join(' | ')})`)
  await page.selectOption(agencySel, mie.v); await page.waitForLoadState('networkidle').catch(() => {}); await page.waitForTimeout(800)
  const types = await page.$$eval(typeSel + ' option', os => os.map(o => ({ v: o.value, t: o.textContent.trim() })))
  const sales = types.find(t => /master'?s? sales?$/i.test(t.t)) || types.find(t => /sale/i.test(t.t) && !/deficien/i.test(t.t))
  if (!sales) throw new Error(`${county}: no sales roster type (${types.map(t => t.t).join(' | ')})`)
  await page.selectOption(typeSel, sales.v); await page.waitForLoadState('networkidle').catch(() => {}); await page.waitForTimeout(800)
  const dateBox = page.locator('input[id$="TextBoxBeginDate"]')
  if (await dateBox.count()) { await dateBox.fill(fmtDate(saleDate)); }
  const refresh = page.locator('input[type=submit][value="Refresh"], input[id$="ButtonRefreshHeader"]')
  if (await refresh.count()) { await refresh.first().click(); await page.waitForLoadState('networkidle').catch(() => {}); await page.waitForTimeout(1000) }
  if (dumpDir) await dump(page, dumpDir, `${county}-roster-select`)
  // roster links are usually rendered as a list of dates
  const want = fmtDate(saleDate)
  const links = await page.$$eval('a', as => as.map(a => ({ href: a.href, text: (a.textContent || '').trim() })))
  const hit = links.find(l => l.text.includes(want) || l.href.includes(want)) || links.find(l => /roster|sale/i.test(l.href) && /\d{1,2}\/\d{1,2}\/\d{4}/.test(l.text))
  if (hit) { await page.goto(hit.href, { waitUntil: 'domcontentloaded' }); await page.waitForTimeout(1000) }
  if (dumpDir) await dump(page, dumpDir, `${county}-roster`)
  const text = htmlToText(await page.content())
  const rows = []
  // rows look like: "1  2026-CP-37-00123  PLAINTIFF vs DEFENDANT  ... address ..." – keep it loose, one row per case number
  const chunks = text.split(/\n(?=\s*\d{0,3}\s*\d{4}-CP-\d{2}-\d{5})/)
  for (const c of chunks) {
    const cn = parseCaseNo((c.match(/\d{4}-CP-\d{2}-\d{5}/) || [])[0]); if (!cn) continue
    const flat = c.replace(/\s+/g, ' ').trim()
    const cap = flat.match(/\d{4}-CP-\d{2}-\d{5}\s+(.+?)\s+(?:vs?\.?|v\.)\s+(.+?)(?=\s{2,}|\s\d+\s[A-Z]|$)/i)
    const addr = (flat.match(/\b(\d{1,6}\s+[A-Za-z0-9 .'-]+?,?\s*[A-Za-z .]+,?\s*(?:SC|South Carolina)\s*\d{5})\b/) || [])[1] || ''
    rows.push({ county, caseNo: cn.dashed, plaintiff: cap?.[1]?.trim() || '', defendant: cap?.[2]?.trim() || '', address: addr, status: /withdrawn|cancel/i.test(flat) ? 'withdrawn' : 'scheduled', deficiency: /deficiency demanded|def\.? demanded/i.test(flat) ? 'demanded' : /deficiency waived|def\.? waived/i.test(flat) ? 'waived' : 'unknown', raw: flat.slice(0, 400), sources: { roster: page.url() } })
  }
  log(`${county}: ${rows.length} roster rows`)
  if (!rows.length) log(`${county}: nothing parsed – run with --dump and send me out/<date>/dump/${county}-roster.html`)
  return { rows, source: page.url() }
}
