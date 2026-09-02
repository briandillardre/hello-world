// Property card from qPublic (Schneider Geospatial) – Pickens, Spartanburg,
// Oconee and most other SC counties. Cloudflare-fronted → browser. Searches by
// parcel/TMS when we have one (exact), else by street address. Scrapes every
// label/value pair on the card so nothing is lost, then maps the common ones.
import { goto, dump } from './browser.mjs'
import { htmlToText, log } from './util.mjs'

function searchUrl(cfg) {
  const a = cfg.assessor
  return a.app ? `https://qpublic.schneidercorp.com/Application.aspx?App=${a.app}&Layer=Parcels&PageType=Search`
               : `https://qpublic.schneidercorp.com/Application.aspx?AppID=${a.appId}&LayerID=${a.layerId}&PageTypeID=2&PageID=${a.pageId}`
}

async function agreeTerms(page) {
  const b = page.locator('a:has-text("Agree"), button:has-text("Agree"), a:has-text("Accept"), button:has-text("Accept")').first()
  if (await b.count()) { await b.click().catch(() => {}); await page.waitForTimeout(800) }
}

export async function qpublicCard(page, cfg, { tms, address }, { dumpDir } = {}) {
  await goto(page, searchUrl(cfg)); await agreeTerms(page)
  const tries = []
  if (tms) tries.push({ kind: 'parcel', q: tms.replace(/[^0-9A-Za-z.]/g, ''), sel: 'input[id*="Parcel" i], input[placeholder*="Parcel" i], input[id*="PIN" i]' })
  if (tms) tries.push({ kind: 'parcel-dashed', q: tms, sel: 'input[id*="Parcel" i], input[placeholder*="Parcel" i]' })
  if (address) tries.push({ kind: 'address', q: String(address).replace(/,.*$/, '').replace(/\b(?:Dr|Rd|St|Ln|Ct|Ave|Way|Hwy|Blvd|Cir|Pl|Trl)\.?$/i, '').trim(), sel: 'input[id*="Address" i], input[placeholder*="Address" i]' })
  for (const t of tries) {
    const box = page.locator(t.sel).first()
    if (!(await box.count())) continue
    await box.fill(''); await box.fill(t.q); await box.press('Enter')
    await page.waitForLoadState('networkidle').catch(() => {}); await page.waitForTimeout(1500)
    // results grid → first parcel link; a direct hit already lands on the card
    const link = page.locator('table a[href*="KeyValue="], a[href*="PageTypeID=4"], a[href*="PageType=Report"]').first()
    if (await link.count()) { await link.click().catch(() => {}); await page.waitForLoadState('networkidle').catch(() => {}); await page.waitForTimeout(1200) }
    const text = htmlToText(await page.content())
    if (/Legal Description|Year Built|Deed Book|Sale Price|Total (?:Market|Appraised) Value/i.test(text) && !/no results|0 results|did not match|no records/i.test(text.slice(0, 5000))) {
      if (dumpDir) await dump(page, dumpDir, `qpublic-${(tms || address).replace(/[^a-z0-9]+/gi, '-')}`)
      return { ...scrapeCard(text), source: page.url(), matchedBy: t.kind }
    }
  }
  if (dumpDir) await dump(page, dumpDir, `qpublic-miss-${(tms || address).replace(/[^a-z0-9]+/gi, '-')}`)
  log(`  qpublic: no card for ${tms || address}`)
  return null
}

const KEYS = {
  owner: /^(?:Owner(?: Name)?|Owner\(s\)|Current Owner)$/i, parcel: /^(?:Parcel (?:Number|ID|No\.?)|PIN|Tax Map(?: Number)?|TMS)$/i, address: /^(?:(?:Property|Site|Situs|Location) Address|Location)$/i,
  legal: /^(?:Legal Description|Description)$/i, acreage: /^(?:Acres|Acreage|Total Acres|Deeded Acres|Calculated Acreage)$/i, landUse: /^(?:Land Use(?: Code)?|Property Class|Class(?:ification)?|Use Code)$/i,
  yearBuilt: /^(?:Year Built|Actual Year Built|Yr Built)$/i, sqft: /^(?:Heated (?:Sq(?:uare)? ?F(?:ee)?t|Area)|Living Area|Total (?:Sq(?:uare)? ?F(?:ee)?t|Living Area)|Finished Area|Sq(?:uare)? ?F(?:ee)?t)$/i,
  beds: /^(?:Bedrooms?|Beds?)$/i, baths: /^(?:(?:Full )?Bath(?:room)?s?|Baths?)$/i, stories: /^(?:Stories|Story Height)$/i, buildingType: /^(?:Building Type|Style|Structure Type|Improvement Type)$/i,
  fmv: /^(?:Total (?:Market|Appraised) Value|Market Value|Appraised Value|Total Value|Fair Market Value)$/i, assessed: /^(?:Total Assessed Value|Assessed Value)$/i,
  lastSaleDate: /^(?:Sale Date|Last Sale Date|Deed Date)$/i, lastSalePrice: /^(?:Sale Price|Last Sale Price|Consideration)$/i, taxDistrict: /^(?:Tax District|District)$/i, subdivision: /^(?:Subdivision|Neighborhood)$/i,
}
export function scrapeCard(text) {
  const lines = text.split('\n').map(s => s.trim()).filter(Boolean)
  const pairs = {}
  for (let i = 0; i < lines.length - 1; i++) {
    const l = lines[i].replace(/:$/, '')
    if (l.length > 40 || /^\d/.test(l)) continue
    const v = lines[i + 1]
    if (v.length > 200) continue
    if (!(l in pairs)) pairs[l] = v
  }
  const out = { fields: pairs }
  for (const [k, re] of Object.entries(KEYS)) { const hit = Object.keys(pairs).find(p => re.test(p)); if (hit) out[k] = pairs[hit] }
  return out
}
