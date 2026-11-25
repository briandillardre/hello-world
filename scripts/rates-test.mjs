// node scripts/rates-test.mjs — unit rates from bids (lib/pricing/rates.ts,
// migration 165). Run it after ANY change to rates.ts: these become bid prices.
// Every figure here is made up.
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const ts = require('typescript')
const transpile = (path, map = {}) => {
  let js = ts.transpileModule(readFileSync(new URL(path, import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 } }).outputText
  for (const [k, v] of Object.entries(map)) js = js.split(`'${k}'`).join(`'${v}'`)
  return 'data:text/javascript;base64,' + Buffer.from(js).toString('base64')
}
const iconsUrl = transpile('../lib/asset-icons.ts')
const bulkUrl = transpile('../lib/bulk-import.ts', { './asset-icons': iconsUrl })
const R = await import(transpile('../lib/pricing/rates.ts', { '../bulk-import': bulkUrl }))
const E = await import(transpile('../lib/estimate/engine.ts'))

let pass = 0, fail = 0
const ok = (c, msg) => { if (c) pass++; else { fail++; console.log('FAIL', msg) } }
const eq = (a, b, msg) => ok(JSON.stringify(a) === JSON.stringify(b), `${msg}: got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`)
const near = (a, b, tol, msg) => ok(a !== null && a !== undefined && Math.abs(a - b) <= tol, `${msg}: got ${a}, want ${b} ± ${tol}`)

// ── keys ──
eq(R.itemKey(null, 'ABC Stone Base', 'SY'), 'abc-stone-base|SY', 'words → slug + unit')
eq(R.itemKey(null, '  abc   stone, base!! ', 'sy'), 'abc-stone-base|SY', 'case, punctuation and whitespace runs fold')
eq(R.itemKey('P-HD', 'Heavy duty asphalt', 'SY'), '#p-hd|SY', 'a code wins over the words')
eq(R.itemKey('', 'Heavy duty asphalt', 'SY'), 'heavy-duty-asphalt|SY', 'an empty code is no code')
ok(R.itemKey(null, 'Surge stone', 'TON') !== R.itemKey(null, 'Surge stone', 'CY'), 'the unit is part of the key')
eq(R.itemKey(null, '15" RCP', 'LF'), R.itemKey(null, '15 in RCP', 'lf'), 'an inch mark reads as "in"')
eq(R.normUnit('Tons'), 'TON', 'Tons → TON')
eq(R.normUnit('sq yd'), 'SY', 'sq yd → SY')
eq(R.normUnit('S.Y.'), 'SY', 'S.Y. → SY')
eq(R.normUnit('Acres'), 'AC', 'Acres → AC')

// ── from an estimate: the markups spread evenly ──
{
  const S = E.DEFAULT_SETTINGS
  const ctx = {
    materials: [{ id: 'm1', name: 'ABC', unit: 'TON', tonsPerCy: 2, wastePct: 0 }],
    prices: [{ id: 'p1', placeId: 'q1', materialId: 'm1', price: 20, unit: 'TON', basis: 'delivered', minCharge: null, fuelPct: null, quotedOn: '2026-01-01' }],
    sources: [{ id: 'q1', name: 'Quarry', kind: 'quarry' }], distances: new Map(), settings: { ...S, crews: [{ key: 'grade', name: 'Grade', ratePerHr: 300 }] }, shop: null,
  }
  const L = (o) => ({ id: o.id, section: 'Paving', code: o.code ?? null, name: o.name, unit: o.unit, qty: o.qty, depthIn: o.depthIn ?? null, materialId: o.materialId ?? null, placeId: null, wastePct: null, crewKey: o.crewKey ?? null, perDay: o.perDay ?? null, subUnit: o.subUnit ?? null, lowboyTrips: null, note: null })
  const lines = [
    L({ id: 'a', name: 'Stone base', unit: 'SY', qty: 1000, depthIn: 8, materialId: 'm1', crewKey: 'grade', perDay: 500 }),
    L({ id: 'b', name: 'Curb & gutter', unit: 'LF', qty: 400, subUnit: 18.5 }),
    L({ id: 'c', name: 'Nothing yet', unit: 'LF', qty: 0, subUnit: 5 }),
    L({ id: 'd', name: 'Mobilization', unit: 'LS', qty: 1, subUnit: 4000 }),
    L({ id: 'e', code: 'P-HD', name: 'Heavy duty — top 3″', unit: 'SY', qty: 500, subUnit: 9 }),
    L({ id: 'f', code: 'P-HD', name: 'Heavy duty — base 8″', unit: 'SY', qty: 500, subUnit: 6 }),
    L({ id: 'g', name: 'Unpriced', unit: 'EA', qty: 3 }),
  ]
  const costs = lines.map((line) => E.lineCost(line, ctx))
  const mk = { overheadPct: 10, contingencyPct: 3, profitPct: 12, bondPct: 1.5, taxPct: 6 }
  const t = E.totals(lines.map((line, i) => ({ line, cost: costs[i] })), mk)
  const f = R.fromEstimate({ lines, costs, totals: t })
  eq(f.length, 4, 'zero-qty and zero-cost lines skipped, layers fold into one item')
  const sum = f.reduce((s, x) => s + x.unitPrice * x.qty, 0)
  near(sum, t.bid, 1, 'Σ unit price × qty = the bid total')
  const sumCost = f.reduce((s, x) => s + x.unitCost * x.qty, 0)
  near(sumCost, t.direct, 1, 'Σ unit cost × qty = the direct cost')
  const ph = f.find((x) => x.itemKey === '#p-hd|SY')
  near(ph?.unitCost, 15, 1e-6, 'two layers of one item add per unit (9 + 6)')
  eq(ph?.itemName, 'Heavy duty', 'the layer tail leaves the name')
  const cg = f.find((x) => x.itemName === 'Curb & gutter')
  near(cg?.unitCost, 18.5, 1e-6, 'unit cost = line cost ÷ qty')
  near(cg?.unitPrice, 18.5 * (t.bid / t.direct), 1e-3, 'unit price = unit cost × bid/direct')
  const none = R.fromEstimate({ lines, costs, totals: { bid: 0, direct: t.direct } })
  near(none.find((x) => x.itemName === 'Curb & gutter')?.unitPrice, 18.5, 1e-6, 'no bid total (no margins) → priced at cost')
}

// ── folding lines that share a key ──
{
  const L = (o) => ({ id: o.id, section: o.section ?? 'Paving', code: o.code ?? null, name: o.name, unit: o.unit ?? 'SY', qty: o.qty, depthIn: null, materialId: null, placeId: null, wastePct: null, crewKey: null, perDay: null, subUnit: null, lowboyTrips: null, note: null })
  const C = (total) => ({ total, unitCost: null, warnings: [] })
  const T = { bid: 0, direct: 0 }
  // Layers of one item whose areas were rounded differently still add per unit over the item's area.
  const layered = R.fromEstimate({ lines: [L({ id: 'a', code: 'P-HD', name: 'Heavy duty — top 3″', qty: 1000 }), L({ id: 'b', code: 'P-HD', name: 'Heavy duty — base 8″', qty: 998 })], costs: [C(9000), C(5988)], totals: T })
  eq(layered.length, 1, 'two layers → one item')
  near(layered[0].unitCost, 15, 1e-6, 'layers add per unit even when the areas differ a little (9 + 6)')
  eq(layered[0].qty, 1000, '…over the item’s area, never the sum of the layers’ areas')
  // The same item in two sections: quantities and costs add — even if the two quantities happen to match.
  const twice = R.fromEstimate({ lines: [L({ id: 'a', name: 'Curb & gutter', unit: 'LF', qty: 400, section: 'Phase 1' }), L({ id: 'b', name: 'Curb & gutter', unit: 'LF', qty: 400, section: 'Phase 2' })], costs: [C(8000), C(7200)], totals: T })
  eq(twice[0].qty, 800, 'same item in two sections with equal quantities → the quantities add (not one 400 LF line at 37/LF)')
  near(twice[0].unitCost, 19, 1e-6, '…and the unit cost is the blend (15,200 ÷ 800)')
  // A layered item in two sections: each section's layers add per unit, the sections add up.
  const twoSec = R.fromEstimate({ lines: [
    L({ id: 'a', code: 'P-HD', name: 'Heavy duty — top 3″', qty: 500, section: 'Lot A' }), L({ id: 'b', code: 'P-HD', name: 'Heavy duty — base 8″', qty: 500, section: 'Lot A' }),
    L({ id: 'c', code: 'P-HD', name: 'Heavy duty — top 3″', qty: 300, section: 'Lot B' }), L({ id: 'd', code: 'P-HD', name: 'Heavy duty — base 8″', qty: 300, section: 'Lot B' }),
  ], costs: [C(4500), C(3000), C(2700), C(1800)], totals: T })
  eq(twoSec[0].qty, 800, 'a layered item in two sections → its two areas add')
  near(twoSec[0].unitCost, 15, 1e-6, '…at 9 + 6 per unit')
}

// ── freezing a bid: once, at Sent ──
eq(R.freezeStep('sent', 0), 'freeze', 'Sent with nothing frozen → freeze')
eq(R.freezeStep('won', 0), 'freeze', 'straight to Won with nothing frozen → freeze (first freeze)')
eq(R.freezeStep('won', 12), 'outcome', 'Sent → Won → only the result, never re-priced from today’s book')
eq(R.freezeStep('lost', 12), 'outcome', 'Sent → Lost → only the result and the low level')
eq(R.freezeStep('sent', 12), 'outcome', 'Won → back to Sent → only the result')
eq(R.freezeStep('draft', 12), 'drop', 'back to Draft → removed')
eq(R.freezeStep('sent', 12, { resend: true }), 'freeze', 'a revised bid → frozen again')
{
  const frozen = [{ id: 'a', unitPrice: 12, qty: 1000 }, { id: 'b', unitPrice: 20, qty: 400 }, { id: 'c', unitPrice: 5000, qty: 1 }]
  eq(R.frozenBidTotal(frozen), 25000, 'our bid = Σ stored unit price × qty')
  const lost = R.outcomeRows(frozen, 'lost', 22500)
  eq(lost.map((r) => r.result), ['lost', 'lost', 'lost'], 'every line marked lost')
  eq(lost.map((r) => r.lowUnitPrice), [10.8, 18, 4500], 'low level = stored price × low ÷ our stored total')
  eq(R.outcomeRows(frozen, 'lost', null).map((r) => r.lowUnitPrice), [null, null, null], 'lost with no low total → no low level')
  eq(R.outcomeRows(frozen, 'won', 22500).map((r) => [r.result, r.lowUnitPrice]), [['won', null], ['won', null], ['won', null]], 'won → no low level')
  eq(R.outcomeRows(frozen, 'sent', null)[0].result, 'pending', 'sent → pending')
}

// ── the low bidder, spread evenly ──
near(R.lowUnitFromTotal(20, 1_000_000, 900_000), 18, 1e-9, 'low 10% under → unit 10% under')
eq(R.lowUnitFromTotal(20, 1_000_000, null), null, 'no low bid → null')
eq(R.lowUnitFromTotal(20, 0, 900_000), null, 'no bid total → null')

// ── bands ──
const row = (o) => ({ bidOn: o.d, jobName: o.j ?? 'Job', customer: null, itemKey: o.k ?? 'abc|SY', itemName: o.n ?? 'ABC', unit: 'SY', qty: 100, unitPrice: o.p, unitCost: o.c ?? null, result: o.r, lowUnitPrice: o.low ?? null })
const hist = [
  row({ d: '2025-01-10', p: 10, r: 'won', c: 8 }),
  row({ d: '2025-02-10', p: 11, r: 'won' }),
  row({ d: '2025-03-10', p: 12, r: 'won', c: 9 }),
  row({ d: '2025-04-10', p: 13, r: 'won' }),
  row({ d: '2025-05-10', p: 14, r: 'lost', low: 12.5 }),
  row({ d: '2025-06-10', p: 15, r: 'lost', low: 13.5 }),
  row({ d: '2025-07-10', p: 16, r: 'lost' }),
  row({ d: '2025-08-10', p: 12.5, r: 'pending' }),
]
const [b] = R.rateBands(hist)
eq(b.count, 8, 'band counts every bid')
eq([b.won.n, b.lost.n, b.pending], [4, 3, 1], 'won / lost / pending')
near(b.won.p25, 10.75, 1e-9, 'won p25 (interpolated)')
near(b.won.median, 11.5, 1e-9, 'won median')
near(b.won.p75, 12.25, 1e-9, 'won p75')
eq(b.won.last, 13, 'last win = the newest won price')
near(b.lost.median, 15, 1e-9, 'lost median')
near(b.lost.lowMedian, 13, 1e-9, 'low-bid median from the low unit prices')
eq(b.latestCost, 9, 'latest cost = the newest row with a cost')
eq(R.percentile([5], 0.75), 5, 'one value is every percentile')
eq(R.percentile([], 0.5), null, 'no values, no percentile')
eq(R.rateBands([...hist, row({ d: '2025-01-01', k: 'x|TON', n: 'X', p: 30, r: 'won' })]).length, 2, 'one band per item key')

// ── suggest ──
{
  const s = R.suggest({ cost: 8.5, targetMarginPct: 15, band: null })
  near(s.price, 10, 1e-9, '8.50 at 15% margin = 10.00 (margin on price, not markup)')
  eq(s.marginPct, 15, 'the margin it makes')
  const hi = R.suggest({ cost: 11, targetMarginPct: 15, band: b })
  near(hi.atMargin, 12.94, 1e-9, 'cost 11 at 15% = 12.94')
  near(hi.price, 12.25, 1e-9, 'above the won p75 → offer the p75')
  ok(hi.why.some((w) => /75th percentile/.test(w)), 'says why: above 3 of 4 wins')
  const under = R.suggest({ cost: 12.5, targetMarginPct: 15, band: b })
  near(under.price, 12.5, 1e-9, 'p75 under cost → hold at cost, never below')
  ok(under.underCost && under.why.some((w) => /under cost/.test(w)), 'and says "under cost" out loud')
  const lowP = R.suggest({ cost: 7, targetMarginPct: 10, band: b })
  near(lowP.price, 7.78, 1e-9, 'under the wins → keeps the margin price')
  ok(lowP.why.some((w) => /room/.test(w)), 'and notes the room up to the median win')
  const noCost = R.suggest({ cost: null, targetMarginPct: 15, band: b })
  near(noCost.price, 11.5, 1e-9, 'no cost → the median win, said so')
  eq(R.suggest({ cost: null, targetMarginPct: 15, band: null }).price, null, 'no cost, no wins → nothing')
  near(R.suggest({ cost: 9, targetMarginPct: 250, band: null }).price, 90, 1e-9, 'margin clamps at 90%')
}

// ── win chance ──
{
  const w = R.winChance(hist, 13)
  eq([w.won, w.n, w.decided], [4, 4, 7], 'at 13: four decided at or under, all won')
  near(w.p, 1, 1e-9, '…a share of 100%')
  ok(w.lo > 0.45 && w.lo < 0.55 && w.hi === 1, `…but Wilson says 4 of 4 is ~49%–100% (got ${w.lo.toFixed(3)}–${w.hi})`)
  const w2 = R.winChance(hist, 15)
  eq([w2.won, w2.n], [4, 6], 'at 15: 4 of 6 decided were won')
  ok(w2.lo < w2.p && w2.p < w2.hi, 'the share sits inside its interval')
  eq(R.winChance(hist.slice(0, 3), 20), null, 'under four decided bids → null')
  eq(R.winChance(hist, 5), null, 'nothing decided at or under the price → null')
  const wi = R.wilson(0, 10)
  ok(wi.lo === 0 && wi.hi > 0.25 && wi.hi < 0.32, `0 of 10 → 0–~31% (got ${wi.hi.toFixed(3)})`)
}

// ── pasted bid sheets ──
{
  const paste = [
    'Bid Date\tProject\tGC\tItem #\tDescription\tU/M\tQuantity\tUnit Price\tW/L\tLow Bid Unit',
    '3/4/2025\tMaple St Grading\tAcme Builders\t\tABC Stone Base 8"\tsq yd\t1,200\t$12.40\tW\t',
    '2025-05-01\tRiver Rd\tBeta GC\t\tABC Stone Base 8"\tSY\t800\t13.10\tL\t$12.20',
    '05/09/25\tRiver Rd\tBeta GC\tC-1\tCurb & Gutter\tLF\t400\t18.50\tAwarded\t',
    '6/1/2025\tOak Park\t\t\t#57 stone\tTons\t\t$31\t\t',
    '7/1/2025\tOak Park\t\t\tSilt fence\tLF\t100\tabc\tW\t',
    '13/45/2025\tBad date\t\t\tSeeding\tAC\t2\t1800\tlost\t',
    '8/1/2025\tOak Park\t\t\tSeeding\tAC\t2\t1800\tmaybe\t',
    '\t\t\t\t\t\t\t\t\t',
  ].join('\n')
  const p = R.parseBidPaste(paste)
  eq(p.rows.length, 4, 'four good rows')
  eq(p.problems.map((x) => x.row), [6, 7, 8], 'bad price, bad date, bad result → problems by row number')
  eq(p.rows.map((r) => r.result), ['won', 'lost', 'won', 'pending'], 'W / L / Awarded / blank')
  eq(p.rows[0].bidOn, '2025-03-04', 'm/d/yyyy date')
  eq(p.rows[2].bidOn, '2025-05-09', 'mm/dd/yy date')
  eq(p.rows[0].unit, 'SY', 'sq yd → SY')
  eq(p.rows[0].qty, 1200, 'quantity with a thousands comma')
  eq(p.rows[1].lowUnitPrice, 12.2, 'low bid unit read')
  eq(p.rows[0].itemKey, p.rows[1].itemKey, 'the same item on two jobs shares a key')
  eq(p.rows[2].itemKey, '#c-1|LF', 'a code column keys the row')
  eq(p.rows[3].qty, null, 'blank quantity stays blank')
  eq(p.rows[0].customer, 'Acme Builders', 'GC → customer')
  const csv = R.parseBidPaste('date,job,item,unit,price,result\n2025-01-02,"Smith, Inc lot","Mass excavation",CY,"$4.25",lost')
  eq([csv.rows.length, csv.rows[0]?.jobName, csv.rows[0]?.unitPrice], [1, 'Smith, Inc lot', 4.25], 'CSV with quoted commas')
  const noHead = R.parseBidPaste('2025-01-02\tJob\tStone\tTON\t30')
  ok(noHead.rows.length === 0 && /first row must name/.test(noHead.problems[0]?.why ?? ''), 'no header row → one clear problem')
  const cap = R.parseBidPaste('item,unit,price,date\n' + Array.from({ length: 12 }, () => 'x,EA,1,2025-01-01').join('\n'), { maxRows: 10 })
  eq(cap.rows.length, 10, 'row cap holds')
  eq(R.bidRowSig(p.rows[0]), R.bidRowSig({ ...p.rows[0], jobName: 'MAPLE ST GRADING' }), 'duplicate signature ignores job-name case')
}

// ── words ──
eq(R.bandWords(b), 'Won 4 · $10.75–$12.25/SY · lost 3 at median $15.00', 'history hint in words')

console.log(`rates: ${pass} passed, ${fail} failed`)
if (fail) process.exit(1)
