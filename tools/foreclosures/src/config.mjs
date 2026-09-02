// County registry. Adding a county = one entry here + (if its sale list is not
// on the statewide court-roster site) a small adapter in ./counties/.
//
// code       – the 2-digit county code embedded in SC case numbers (2026-CP-23-00155 → 23)
// index      – host of the county's Public Index (statewide default; Greenville runs its own)
// roster     – where the Master-in-Equity sale roster lives ('sccourts' = the statewide
//              CMSWeb court-roster app; 'custom' = a county adapter in ./counties/)
// assessor   – how to pull the property card ('qpublic' with an app id, 'greenville', or null)

export const COUNTIES = {
  greenville: {
    name: 'Greenville', code: '23',
    index: 'https://www2.greenvillecounty.org/scjd/PublicIndex/',
    roster: 'custom',
    journal: 'https://mie.greenvillejournal.com/',   // Journal MIE site: sale list + notice + ORDER PDF per case
    assessor: { kind: 'greenville' },
    saleRule: 'first Monday 11:00 AM, Greenville County Courthouse (Tuesday when Monday is a holiday)',
  },
  pickens: {
    name: 'Pickens', code: '39',
    index: 'https://publicindex.sccourts.org/pickens/publicindex/',
    roster: 'custom',
    rosterPage: 'https://www.co.pickens.sc.us/departments/master_in_equity/sales_rosters.php',
    assessor: { kind: 'qpublic', appId: 927, layerId: 18058, pageId: 8075 },
    saleRule: 'first Monday 11:00 AM, Pickens County Courthouse',
  },
  spartanburg: {
    name: 'Spartanburg', code: '42',
    index: 'https://publicindex.sccourts.org/spartanburg/publicindex/',
    roster: 'custom',
    docCenter: 'https://www.spartanburgcounty.gov/DocumentCenter/Index/114',
    notices: 'https://www.spartanweeklyonline.com/legal-notices/master-and-equity',
    assessor: { kind: 'qpublic', app: 'SpartanburgCountySC' },
    saleRule: 'first Monday 11:00 AM, 180 Magnolia St 4th floor (Tuesday when Monday is a holiday)',
  },
  oconee: {
    name: 'Oconee', code: '37',
    index: 'https://publicindex.sccourts.org/oconee/publicindex/',
    roster: 'sccourts',
    rosterUrl: 'https://publicindex.sccourts.org/oconee/courtrosters/RosterSelection.aspx',
    assessor: { kind: 'qpublic', appId: 1030, layerId: 21692, pageId: 9256 },
    saleRule: 'first Monday 11:00 AM, Oconee County Courthouse (Walhalla)',
  },

  // ── Coastal counties (roster-only stubs; UNTESTED – enable one at a time) ──
  // These all run the statewide court-roster app, so `list` should work as-is.
  // Assessor lookups: Horry/Charleston/Beaufort run their own systems (null =
  // property card skipped, writeup uses the Notice of Sale only).
  horry:      { name: 'Horry',      code: '26', index: 'https://publicindex.sccourts.org/horry/publicindex/',      roster: 'sccourts', rosterUrl: 'https://publicindex.sccourts.org/horry/courtrosters/RosterSelection.aspx',      assessor: null, untested: true },
  georgetown: { name: 'Georgetown', code: '22', index: 'https://publicindex.sccourts.org/georgetown/publicindex/', roster: 'sccourts', rosterUrl: 'https://publicindex.sccourts.org/georgetown/courtrosters/RosterSelection.aspx', assessor: null, untested: true },
  charleston: { name: 'Charleston', code: '10', index: 'https://publicindex.sccourts.org/charleston/publicindex/', roster: 'sccourts', rosterUrl: 'https://jcmsweb.charlestoncounty.org/courtrosters/RosterSelection.aspx',          assessor: null, untested: true },
  berkeley:   { name: 'Berkeley',   code: '08', index: 'https://publicindex.sccourts.org/berkeley/publicindex/',   roster: 'sccourts', rosterUrl: 'https://publicindex.sccourts.org/berkeley/courtrosters/RosterSelection.aspx',   assessor: null, untested: true },
  dorchester: { name: 'Dorchester', code: '18', index: 'https://publicindex.sccourts.org/dorchester/publicindex/', roster: 'sccourts', rosterUrl: 'https://publicindex.sccourts.org/dorchester/courtrosters/RosterSelection.aspx', assessor: null, untested: true },
  beaufort:   { name: 'Beaufort',   code: '07', index: 'https://publicindex.sccourts.org/beaufort/publicindex/',   roster: 'sccourts', rosterUrl: 'https://publicindex.sccourts.org/beaufort/courtrosters/RosterSelection.aspx',   assessor: null, untested: true },
  colleton:   { name: 'Colleton',   code: '15', index: 'https://publicindex.sccourts.org/colleton/publicindex/',   roster: 'sccourts', rosterUrl: 'https://publicindex.sccourts.org/colleton/courtrosters/RosterSelection.aspx',   assessor: { kind: 'qpublic', appId: 1046, layerId: 23500, pageId: 9798 }, untested: true },
}

export const UPSTATE = ['greenville', 'pickens', 'spartanburg', 'oconee']
export const COASTAL = ['horry', 'georgetown', 'charleston', 'berkeley', 'dorchester', 'beaufort', 'colleton']

export const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36'

/** Normalise "2026-CP-23-00155" / "2026CP2300155" → { dashed, compact, year, county, seq } */
export function parseCaseNo(s) {
  const m = String(s || '').toUpperCase().replace(/\s+/g, '').match(/(\d{4})-?CP-?(\d{2})-?(\d{5})/)
  if (!m) return null
  return { dashed: `${m[1]}-CP-${m[2]}-${m[3]}`, compact: `${m[1]}CP${m[2]}${m[3]}`, year: m[1], county: m[2], seq: m[3] }
}

/** Next Master-in-Equity sale day: first Monday of the month, Tuesday if Monday is a federal holiday. */
export function nextSaleDate(from = new Date()) {
  const d = new Date(from.getFullYear(), from.getMonth(), 1)
  for (let tries = 0; tries < 3; tries++) {
    const first = new Date(d.getFullYear(), d.getMonth(), 1)
    const mon = new Date(first); mon.setDate(1 + ((8 - first.getDay()) % 7))
    const sale = isFederalHoliday(mon) ? new Date(mon.getFullYear(), mon.getMonth(), mon.getDate() + 1) : mon
    if (sale >= new Date(from.getFullYear(), from.getMonth(), from.getDate())) return sale
    d.setMonth(d.getMonth() + 1)
  }
  return d
}
function isFederalHoliday(d) {
  // Only the two that can land on a first Monday: Labor Day (Sept) and New Year's observed.
  if (d.getMonth() === 8 && d.getDay() === 1 && d.getDate() <= 7) return true
  if (d.getMonth() === 0 && d.getDate() === 1) return true
  return false
}
export const fmtDate = (d) => `${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}/${d.getFullYear()}`
