import fs from 'node:fs'
import path from 'node:path'
import { money, parseMoney, ensureDir } from './util.mjs'
import { COUNTIES } from './config.mjs'

const daysBetween = (a, b) => Math.round((b - a) / 86400000)

/** Estimated payoff on sale day = judgment total + per diem × days since the as-of date. */
export function estimateOnSaleDay(j, saleDate) {
  if (!j || j.totalDebt == null) return null
  const asOf = j.asOfDate ? new Date(j.asOfDate) : null
  if (!asOf || isNaN(asOf) || !j.perDiem || !saleDate) return j.totalDebt
  const d = daysBetween(asOf, saleDate)
  return d > 0 ? j.totalDebt + j.perDiem * d : j.totalDebt
}

export function writeup(r, saleDate) {
  const p = r.property || {}, j = r.judgment || {}, n = r.notice || {}
  const bits = []
  const kind = p.landUse || p.buildingType || (n.legalDescription && /vacant/i.test(n.legalDescription) ? 'vacant lot per legal description' : '')
  const size = [p.acreage && !/^0(\.0+)?$/.test(p.acreage) ? `${p.acreage} ac` : '', p.sqft ? `${p.sqft} sf` : '', p.yearBuilt ? `built ${p.yearBuilt}` : '', p.beds ? `${p.beds} bd` : '', p.baths ? `${p.baths} ba` : ''].filter(Boolean).join(', ')
  bits.push(`${r.address || '(address not on roster)'}${kind ? ' — ' + kind : ''}${size ? ' — ' + size : ''}${p.subdivision ? ` (${p.subdivision})` : ''}.`)
  if (p.owner) bits.push(`Record owner ${p.owner}${p.approxMatch ? ` (card is for ${p.siteAddress} — unit letter not on file, verify)` : ''}.`)
  if (p.lastSalePrice || p.deedDate || p.lastSaleDate) bits.push(`Last transfer ${p.deedDate || p.lastSaleDate || ''}${p.lastSalePrice ? ' for ' + p.lastSalePrice : ''}.`)
  const fmv = parseMoney(p.fmv)
  if (fmv) bits.push(`County FMV ${money(fmv)}.`)
  const est = estimateOnSaleDay(j, saleDate)
  if (j.totalDebt != null) {
    bits.push(`Judgment ${money(j.totalDebt)}${j.asOfDate ? ' as of ' + j.asOfDate : ''}${j.perDiem ? ` + ${money(j.perDiem)}/day` : ''}${est && est !== j.totalDebt ? ` ≈ ${money(est)} on sale day` : ''}${j.interestRate ? ` (${j.interestRate})` : ''}.`)
    if (fmv) { const ratio = est / fmv; bits.push(ratio < 0.7 ? `Debt is ${(ratio * 100).toFixed(0)}% of FMV — real equity, expect third-party bidding.` : ratio < 1 ? `Debt is ${(ratio * 100).toFixed(0)}% of FMV — thin margin.` : `Debt exceeds FMV (${(ratio * 100).toFixed(0)}%) — plaintiff will likely take it back.`) }
  } else bits.push('Judgment amount not extracted yet' + (j.needsOcr ? ' (scanned PDF; open it)' : r.index?.error ? ` (index: ${r.index.error})` : r.index ? ' (no order/judgment image on the docket)' : ' (court index not crawled yet — run on your PC)') + '.')
  const def = r.deficiency || j.deficiency || n.deficiency || 'unknown'
  if (def === 'conflicting') bits.push(`DEFICIENCY LANGUAGE CONFLICTS in the notice (says both waived and open 30 days) — ask plaintiff's counsel: ${(n.deficiencyQuotes || []).join(' | ')}`)
  else bits.push(def === 'demanded' ? `DEFICIENCY DEMANDED — bidding stays open 30 days${r.reopenDate || n.reopenDate ? ' (reopens ' + (r.reopenDate || n.reopenDate) + ')' : ''}; the bank can be outbid on day 30.` : def === 'waived' ? 'Deficiency waived — sale is final on the day.' : 'Deficiency status not found — check the notice.')
  if (n.seniorLien || j.seniorLiens) bits.push(`SOLD SUBJECT TO: ${n.seniorLien || j.seniorLiens}`)
  if (n.usaRedemption) bits.push('USA right of redemption applies (federal lien).')
  const dep = ({ five: '5', ten: '10' })[String(n.depositPct || '').toLowerCase()] || n.depositPct || '5'
  if (n.bidInterestRate) bits.push(`Interest on bid ${n.bidInterestRate} until compliance; ${dep}% deposit day of sale.`)
  if (j.notes) bits.push(j.notes)
  if (r.status !== 'scheduled') bits.push(`STATUS: ${r.status.toUpperCase()}.`)
  return bits.join(' ')
}

const csvEsc = (v) => { const s = v == null ? '' : String(v); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s }
export function writeReport(dir, saleDate, byCounty) {
  ensureDir(dir)
  const cols = ['county', 'saleNo', 'caseNo', 'status', 'address', 'tms', 'plaintiff', 'defendant', 'deficiency', 'judgmentTotal', 'asOf', 'perDiem', 'estOnSaleDay', 'interestRate', 'fmv', 'acreage', 'yearBuilt', 'sqft', 'landUse', 'owner', 'lastSale', 'orderDoc', 'notice', 'index', 'propertyCard', 'writeup']
  const lines = [cols.join(',')], md = [`# Master-in-Equity sales — ${saleDate.toDateString()}`, '']
  for (const [county, rows] of Object.entries(byCounty)) {
    const cfg = COUNTIES[county]
    md.push(`## ${cfg.name} County (${rows.length} on the list)`, '', `_${cfg.saleRule || ''}_`, '')
    for (const r of rows) {
      const j = r.judgment || {}, p = r.property || {}
      const est = estimateOnSaleDay(j, saleDate)
      const w = writeup(r, saleDate); r.writeup = w
      lines.push([county, r.saleNo, r.caseNo, r.status, r.address, r.tms, r.plaintiff, r.defendant, r.deficiency || j.deficiency || r.notice?.deficiency, j.totalDebt, j.asOfDate, j.perDiem, est, j.interestRate, p.fmv, p.acreage, p.yearBuilt, p.sqft, p.landUse, p.owner, [p.deedDate || p.lastSaleDate, p.lastSalePrice].filter(Boolean).join(' '), j.source || r.sources?.orderPdf, r.sources?.notice || r.sources?.advert, r.index?.url, p.source, w].map(csvEsc).join(','))
      const strike = r.status !== 'scheduled' ? '~~' : ''
      md.push(`### ${strike}${r.saleNo ? '#' + r.saleNo + ' · ' : ''}${r.caseNo} — ${r.address || '(no address)'}${strike}`, '')
      md.push(`- **${r.plaintiff || '?'}** v. ${r.defendant || '?'}${r.tms ? ` · TMS ${r.tms}` : ''}`)
      md.push(`- **Owed:** ${j.totalDebt != null ? money(j.totalDebt) + (j.asOfDate ? ' as of ' + j.asOfDate : '') + (est && est !== j.totalDebt ? ' → ~' + money(est) + ' sale day' : '') : '_not extracted_'} · **Deficiency:** ${(r.deficiency || j.deficiency || r.notice?.deficiency || 'unknown').toUpperCase()}`)
      md.push(`- ${w}`)
      const links = [j.source && `[order](${j.source})`, r.sources?.notice && `[notice](${r.sources.notice})`, r.sources?.advert && `[journal](${r.sources.advert})`, r.index?.url && `[docket](${r.index.url})`, p.source && `[property card](${p.source})`].filter(Boolean)
      if (links.length) md.push(`- ${links.join(' · ')}`)
      md.push('')
    }
  }
  fs.writeFileSync(path.join(dir, 'report.csv'), lines.join('\n'))
  fs.writeFileSync(path.join(dir, 'report.md'), md.join('\n'))
  return { csv: path.join(dir, 'report.csv'), md: path.join(dir, 'report.md') }
}
