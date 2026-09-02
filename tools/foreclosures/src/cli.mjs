#!/usr/bin/env node
// SC foreclosure crawler.
//   node src/cli.mjs list   [--county greenville,pickens] [--date 09/08/2026] [--headed] [--dump]
//   node src/cli.mjs run    [same flags] [--no-ai] [--skip-index] [--skip-property] [--force] [--only 2026-CP-23-00155]
//   node src/cli.mjs report [--date ...]
//   --seed seeds/greenville-2026-09-08.json   use a hand-transcribed sale list instead of crawling it
// Output: out/<sale date>/<county>.json (resumable state), report.csv, report.md, docs/ (downloaded orders/notices).
import fs from 'node:fs'
import path from 'node:path'
import { COUNTIES, UPSTATE, nextSaleDate, fmtDate } from './config.mjs'
import { OUT, ensureDir, log, readJson, writeJson, slug } from './util.mjs'
import { browser, closeBrowser } from './browser.mjs'
import { listPickens } from './counties/pickens.mjs'
import { listSpartanburg } from './counties/spartanburg.mjs'
import { listGreenville, greenvilleOrderPdf, greenvillePropertyCard } from './counties/greenville.mjs'
import { listFromSccourtsRoster } from './counties/sccourts-roster.mjs'
import { harvestCase } from './publicindex.mjs'
import { extractJudgment } from './judgment.mjs'
import { parseNotice } from './notice.mjs'
import { qpublicCard } from './qpublic.mjs'
import { writeReport, writeup } from './report.mjs'
import { pdfText } from './pdf.mjs'

const args = process.argv.slice(2)
const cmd = args.find(a => !a.startsWith('--')) || 'run'
const flag = (n) => args.includes('--' + n)
const opt = (n, d) => { const i = args.indexOf('--' + n); return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : d }

const counties = (opt('county', UPSTATE.join(',')) || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean)
const saleDate = opt('date') ? new Date(opt('date')) : nextSaleDate()
const headed = flag('headed'), useAi = !flag('no-ai'), force = flag('force'), only = opt('only')
const dir = ensureDir(path.join(OUT, `${saleDate.getFullYear()}-${String(saleDate.getMonth() + 1).padStart(2, '0')}-${String(saleDate.getDate()).padStart(2, '0')}`))
const dumpDir = flag('dump') ? ensureDir(path.join(dir, 'dump')) : null
const docsDir = ensureDir(path.join(dir, 'docs'))
const stateFile = (c) => path.join(dir, `${c}.json`)

for (const c of counties) if (!COUNTIES[c]) { console.error(`unknown county "${c}". Known: ${Object.keys(COUNTIES).join(', ')}`); process.exit(2) }
log(`sale date ${fmtDate(saleDate)} · counties ${counties.join(', ')} · out ${dir}`)

const needsBrowser = (c) => c !== 'pickens' || cmd === 'run'
let page = null
async function getPage() { if (!page) { const ctx = await browser({ headed }); page = ctx.pages()[0] || await ctx.newPage() } return page }

async function list(c) {
  const cfg = COUNTIES[c]
  if (cfg.untested) log(`${c}: coastal stub – roster path untested, expect to iterate`)
  if (c === 'pickens') return listPickens(saleDate)
  if (c === 'spartanburg') return listSpartanburg(saleDate, { page: cmd === 'run' || flag('browser') ? await getPage() : null, dumpDir })
  if (c === 'greenville') return listGreenville(saleDate, { page: await getPage(), dumpDir })
  if (cfg.roster === 'sccourts') return listFromSccourtsRoster(c, cfg, saleDate, { page: await getPage(), dumpDir })
  throw new Error(`no list adapter for ${c}`)
}

function saveDoc(c, r, d) {
  const ext = /pdf/i.test(d.type) || d.buf.slice(0, 4).toString() === '%PDF' ? 'pdf' : /tiff/i.test(d.type) ? 'tif' : 'bin'
  const p = path.join(docsDir, `${c}-${slug(r.caseNo)}-${d.kind || 'doc'}.${ext}`)
  fs.writeFileSync(p, d.buf); return p
}

async function enrich(c, r) {
  const cfg = COUNTIES[c]
  r.docs = r.docs || []
  // 1. judgment document
  if (!flag('skip-index') && (force || !r.judgment || r.judgment.totalDebt == null)) {
    let doc = null
    try {
      if (c === 'greenville' && r.sources?.orderPdf) { const g = await greenvilleOrderPdf(await getPage(), r); if (g) { doc = { ...g, kind: 'order', type: 'application/pdf' } } }
    } catch (e) { log(`  ${r.caseNo}: journal order download failed – ${e.message}`) }
    if (!doc || flag('index')) {
      try {
        const h = await harvestCase(await getPage(), cfg, r.caseNo, { dumpDir, headed })
        r.index = { url: h.url, via: h.via, ...h.summary }
        for (const d of h.docs) {
          const file = saveDoc(c, r, d); r.docs.push({ kind: d.kind, date: d.date, description: d.description, url: d.url, file })
          if (d.kind === 'order' && !doc) doc = { ...d, label: d.description }
          if (d.kind === 'notice' && !r.notice?.deficiency) { const t = (await pdfText(d.buf)).text; if (t) r.notice = { ...(r.notice || {}), ...parseNotice(t), source: d.url } }
          if (d.kind === 'deficiency') r.deficiencyDoc = { date: d.date, description: d.description, url: d.url }
        }
        if (r.deficiencyDoc && r.deficiency === 'unknown') r.deficiency = /waiv/i.test(r.deficiencyDoc.description) ? 'waived' : 'demanded'
      } catch (e) { log(`  ${r.caseNo}: public index – ${e.message}`); r.index = { error: e.message } }
    }
    if (doc) {
      if (!r.docs.some(d => d.url === doc.url)) r.docs.push({ kind: 'order', url: doc.url, description: doc.label, file: saveDoc(c, r, { ...doc, kind: 'order' }) })
      r.judgment = await extractJudgment(doc, { caseNo: r.caseNo, useAi })
      log(`  ${r.caseNo}: owed ${r.judgment?.totalDebt ?? '?'} (${r.judgment?.extractedBy}) deficiency ${r.judgment?.deficiency}`)
    }
  }
  if (r.deficiency === 'unknown' || !r.deficiency) r.deficiency = r.judgment?.deficiency && r.judgment.deficiency !== 'unknown' ? r.judgment.deficiency : (r.notice?.deficiency || 'unknown')
  // 2. property card
  if (!flag('skip-property') && (force || !r.property)) {
    try {
      if (cfg.assessor?.kind === 'greenville') r.property = await greenvillePropertyCard(r.address)
      else if (cfg.assessor?.kind === 'qpublic') r.property = await qpublicCard(await getPage(), cfg, { tms: r.tms || r.notice?.tms, address: r.address }, { dumpDir })
      if (r.property) log(`  ${r.caseNo}: property card ok (${r.property.fmv || r.property.assessed || 'no value'})`)
    } catch (e) { log(`  ${r.caseNo}: property card – ${e.message}`) }
  }
  r.writeup = writeup(r, saleDate)
}

async function main() {
  const byCounty = {}
  if (cmd === 'list' || cmd === 'run') {
    for (const c of counties) {
      let state = readJson(stateFile(c), null)
      const seed = opt('seed') && readJson(opt('seed'), null)
      if (seed && seed.county === c && (!state || force)) { state = { ...seed, seeded: true, listedAt: new Date().toISOString() }; writeJson(stateFile(c), state); log(`${c}: seeded ${state.rows.length} rows from ${opt('seed')}`) }
      else if (!state || force || cmd === 'list') {
        try { const { rows, source } = await list(c); state = { county: c, saleDate: fmtDate(saleDate), source, rows, listedAt: new Date().toISOString() }; writeJson(stateFile(c), state) }
        catch (e) { log(`${c}: list failed – ${e.message}`); if (!state) continue }
      }
      log(`${c}: ${state.rows.length} cases (${state.rows.filter(r => r.status === 'scheduled').length} scheduled)`)
      byCounty[c] = state
    }
  }
  if (cmd === 'run') {
    for (const c of counties) {
      const state = byCounty[c]; if (!state) continue
      for (const r of state.rows) {
        if (only && r.caseNo !== only) continue
        if (r.status !== 'scheduled' && !flag('include-cancelled')) { r.writeup = writeup(r, saleDate); continue }
        log(`${c} ${r.saleNo ? '#' + r.saleNo : ''} ${r.caseNo} ${r.address}`)
        try { await enrich(c, r) } catch (e) { log(`  ${r.caseNo}: ${e.message}`) }
        writeJson(stateFile(c), state)
      }
    }
  }
  if (cmd === 'report' || cmd === 'run') {
    for (const c of counties) { const s = byCounty[c] || readJson(stateFile(c)); if (s) byCounty[c] = s }
    const rowsBy = Object.fromEntries(Object.entries(byCounty).map(([c, s]) => [c, s.rows]))
    const out = writeReport(dir, saleDate, rowsBy)
    log('report →', out.md); log('csv    →', out.csv)
  }
  if (cmd === 'list') for (const [c, s] of Object.entries(byCounty)) for (const r of s.rows) console.log([c, r.saleNo ?? '', r.caseNo, r.status, r.deficiency, r.address, r.tms || '', r.plaintiff].join(' | '))
}

main().catch(e => { console.error(e); process.exitCode = 1 }).finally(closeBrowser)
