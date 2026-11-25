// node scripts/invoice-test.mjs — supplier invoices (lib/pricing/invoice.ts).
// Run it after ANY change there: these numbers become the cost book's prices
// and the job's material cost.
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const ts = require('typescript')
const src = readFileSync(new URL('../lib/pricing/invoice.ts', import.meta.url), 'utf8')
const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 } }).outputText
const I = await import('data:text/javascript;base64,' + Buffer.from(js).toString('base64'))

let pass = 0, fail = 0
const ok = (c, msg) => { if (c) pass++; else { fail++; console.log('FAIL', msg) } }
const eq = (a, b, msg) => ok(JSON.stringify(a) === JSON.stringify(b), `${msg}: got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`)
const near = (a, b, tol, msg) => ok(a !== null && Math.abs(a - b) <= tol, `${msg}: got ${a}, want ${b} ± ${tol}`)
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`

// ── units ──
eq(I.normUnit('TN'), 'TON', 'TN → TON')
eq(I.normUnit('Tons'), 'TON', 'Tons → TON')
eq(I.normUnit('t'), 'TON', 'T → TON')
eq(I.normUnit('YD3'), 'CY', 'YD3 → CY')
eq(I.normUnit('C.Y.'), 'CY', 'C.Y. → CY')
eq(I.normUnit('cu yd'), 'CY', 'cu yd → CY')
eq(I.normUnit('FT'), 'LF', 'FT → LF')
eq(I.normUnit('each'), 'EA', 'EACH → EA')
eq(I.normUnit('LD'), 'LOAD', 'LD → LOAD')
eq(I.normUnit('SQ YD'), 'SY', 'SQ YD → SY')
eq(I.normUnit('gal'), null, 'an unknown unit is null, never guessed')
eq(I.normUnit(''), null, 'blank unit is null')

// ── numbers and days ──
eq(I.readNumber('$1,234.50'), 1234.5, 'printed money')
eq(I.readNumber('(12.00)'), -12, 'parentheses are a credit')
eq(I.readNumber('abc'), null, 'words are not numbers')
eq(I.readDay('11/03/2026'), '2026-11-03', 'M/D/YYYY')
eq(I.readDay('2/30/26'), null, 'Feb 30 is not a day')
eq(I.readDay('2026-11-03'), '2026-11-03', 'ISO')
eq(I.dueFrom('2026-10-15', 30), '2026-11-14', 'Net 30')
eq(I.dueFrom('2026-10-15', null), '2026-11-14', 'no terms = Net 30')

// ── cleanDraft ──
const raw = {
  vendorName: '  Piedmont   Aggregates LLC ', invoiceNo: 'INV-88812', invoiceOn: '10/15/2026', termsDays: 15,
  freight: '$412.50', fuel: 61.875, tax: '0', total: '3,568.13', delivered: 'yes',
  placeId: 'not-a-uuid', zoneId: id(9).toUpperCase(),
  lines: [
    { description: '#57 STONE', qty: '22.44', unit: 'TN', unitPrice: '$24.75', amount: '555.39', ticket: 'T-1001', materialId: 'x' },
    { description: 'ABC/CRUSHER RUN', qty: 104.5, unit: 'TONS', unitPrice: 24.0, amount: 2508 },
    {},
    { description: 'x'.repeat(400), qty: 1e12 },
  ],
}
const d = I.cleanDraft(raw)
eq(d.vendorName, 'Piedmont Aggregates LLC', 'vendor squeezed')
eq(d.invoiceOn, '2026-10-15', 'date to ISO')
eq(d.dueOn, '2026-10-30', 'terms set the due date')
eq(d.freight, 412.5, 'freight to cents')
eq(d.fuel, 61.88, 'fuel rounded to the cent')
eq(d.delivered, false, 'only a real true is delivered')
eq(d.placeId, null, 'a bad id is dropped')
eq(d.zoneId, id(9), 'ids lower-cased')
eq(d.lines.length, 3, 'empty line dropped')
eq(d.lines[0].materialId, null, 'bad material id dropped')
eq(d.lines[0].unit, 'TON', 'unit normalized')
eq(d.lines[2].description.length, 200, 'description bounded')
eq(d.lines[2].qty, null, 'absurd qty dropped')
eq(I.cleanDraft({ lines: Array.from({ length: 300 }, () => ({ description: 'a', qty: 1 })) }).lines.length, 200, '≤ 200 lines')
eq(I.cleanDraft(null).lines, [], 'nothing → empty draft')

// ── unit costs ──
const D = {
  ...I.blankDraft(), vendorName: 'Q', invoiceOn: '2026-10-15', freight: 300, fuel: 60, tax: 50, placeId: id(1),
  lines: [
    { description: '#57 stone', materialId: id(11), qty: 40, unit: 'TON', unitPrice: 25, amount: 1000, ticket: null },
    { description: 'ABC stone', materialId: id(12), qty: 100, unit: 'TON', unitPrice: 20, amount: 2000, ticket: null },
  ],
}
D.total = 3000 + 300 + 60 + 50
eq(I.materialSubtotal(D), 3000, 'subtotal')
eq(I.pickupUnitCost(D.lines[0]), 25, 'pickup = printed unit price')
near(I.paidUnitCost(D.lines[0], D), (1000 + 360 / 3) / 40, 1e-4, '#57 all-in: its third of freight + fuel')
near(I.paidUnitCost(D.lines[1], D), (2000 + 240) / 100, 1e-4, 'ABC all-in: its two thirds')
eq(I.paidUnitCost({ ...D.lines[0], qty: 0 }, D), null, 'no qty, no unit cost')
eq(I.pickupUnitCost({ description: '', materialId: null, qty: 10, unit: 'TON', unitPrice: null, amount: 215, ticket: null }), 21.5, 'pickup from amount ÷ qty')

// ── checks ──
eq(I.invoiceChecks(D), [], 'a clean invoice has no warnings')
const short = I.invoiceChecks({ ...D, total: D.total + 25 })
ok(short.some((c) => /short/.test(c.text)), 'lines that don’t reach the total are named')
ok(!I.invoiceChecks({ ...D, total: D.total + 0.9 }).length, 'within $1 is fine')
const bad = I.invoiceChecks({ ...D, lines: [{ ...D.lines[0], amount: 1100 }, D.lines[1]], total: 3510 })
ok(bad.some((c) => c.line === 1 && /40 × \$25\.00/.test(c.text)), 'qty × price ≠ amount is named on its line')
ok(I.invoiceChecks({ ...D, lines: [{ ...D.lines[0], qty: -2 }, D.lines[1]] }).some((c) => /negative/.test(c.text)), 'negative qty warned')
ok(I.invoiceChecks({ ...D, invoiceOn: null }).some((c) => /No invoice date/.test(c.text)), 'missing date warned')
ok(!I.invoiceChecks({ ...D, lines: [{ ...D.lines[0], qty: 22.44, unitPrice: 24.75, amount: 555.39 }, D.lines[1]], total: null }).length, 'cent rounding on the extension is not a warning')

// ── matching ──
const mats = [
  { id: id(11), name: '#57 stone' }, { id: id(12), name: 'ABC stone' }, { id: id(13), name: '#67 stone' },
  { id: id(14), name: 'Surge stone' }, { id: id(15), name: 'Asphalt surface S9.5' }, { id: id(16), name: 'Asphalt intermediate I19' },
  { id: id(17), name: 'Rip rap Class B' }, { id: id(18), name: 'Select fill' }, { id: id(19), name: 'Concrete 3000 psi' },
  { id: id(20), name: 'Screenings' }, { id: id(21), name: 'Asphalt base B25' },
]
const mm = (s) => I.matchMaterial(s, mats)?.id ?? null
eq(mm('#57 STONE'), id(11), '#57 STONE → #57 stone')
eq(mm('NO. 57 WASHED STONE'), id(11), 'NO. 57 WASHED STONE → #57 stone')
eq(mm('57 stone'), id(11), '57 stone → #57 stone')
eq(mm('#67 STONE'), id(13), '#67 is not #57')
eq(mm('SURGE STONE'), id(14), 'SURGE STONE')
eq(mm('ABC/CRUSHER RUN'), id(12), 'ABC/CRUSHER RUN → ABC stone')
eq(mm('Crusher Run'), id(12), 'Crusher Run → ABC stone')
eq(mm('GRADED AGGREGATE BASE'), id(12), 'GAB → ABC stone')
eq(mm('S9.5B SURFACE'), id(15), 'S9.5B SURFACE → surface mix')
eq(mm('SF9.5A HMA'), id(15), 'SF9.5A HMA → surface mix')
eq(mm('I19.0C INTERMEDIATE'), id(16), 'I19.0C → intermediate')
eq(mm('B25.0B'), id(21), 'B25.0B → asphalt base, not ABC')
eq(mm('RIP-RAP CL B'), id(17), 'RIP-RAP → rip rap')
eq(mm('FILL DIRT'), id(18), 'FILL DIRT → select fill')
eq(mm('3000 PSI READY MIX'), id(19), '3000 PSI ready mix → concrete')
eq(mm('4000 PSI READY MIX'), null, '4000 psi is not the 3000 psi mix')
eq(mm('STONE DUST'), id(20), 'stone dust → screenings')
eq(mm('FUEL SURCHARGE'), null, 'a fee matches nothing')
eq(mm('DELIVERY CHARGE'), null, 'freight matches nothing')

const srcs = [{ id: id(1), name: 'Piedmont Aggregates — Plant 3' }, { id: id(2), name: 'Blue Ridge Asphalt Plant' }, { id: id(3), name: 'Palmetto Ready Mix' }]
eq(I.matchVendor('PIEDMONT AGGREGATES LLC - PLANT 3', srcs)?.id, id(1), 'vendor with LLC and dash')
eq(I.matchVendor('Blue Ridge Asphalt Co.', srcs)?.id, id(2), 'vendor contained in the place name')
eq(I.matchVendor('Palmetto Ready-Mix, Inc.', srcs)?.id, id(3), 'hyphen and Inc')
eq(I.matchVendor('Carolina Sand Co', srcs), null, 'an unknown vendor is unmatched')
{
  const twins = [{ id: id(31), name: 'Vulcan Materials — Pelham' }, { id: id(32), name: 'Vulcan Materials — Anderson' }, ...srcs]
  eq(I.matchVendor('Vulcan Materials Company', twins), null, 'two plants of one vendor scoring alike → no prefill (a tie)')
  eq(I.matchVendor('Vulcan Materials — Pelham', twins)?.id, id(31), 'the plant named outright still matches')
  eq(I.matchVendor('Piedmont Aggregates Plant 3', [...srcs, { id: id(33), name: 'Piedmont Aggregates Plant 3' }]), null, 'two sources with the same name → a tie, no prefill')
  ok(I.VENDOR_TIE === 0.05, 'the tie margin is 0.05')
}

// ── the reader's reply never chooses ids ──
{
  const fromModel = I.cleanDraft({ vendorName: 'Q', placeId: id(1), zoneId: id(2), lines: [{ description: '#57', qty: 1, unit: 'TON', unitPrice: 30, materialId: id(3) }] }, { fromModel: true })
  eq([fromModel.placeId, fromModel.zoneId, fromModel.lines[0].materialId], [null, null, null], 'fromModel drops the source, the site and every material id')
  eq(fromModel.lines[0].unitPrice, 30, '…and keeps the numbers')
  const typed = I.cleanDraft({ vendorName: 'Q', placeId: id(1), zoneId: id(2), lines: [{ description: '#57', qty: 1, materialId: id(3) }] })
  eq([typed.placeId, typed.zoneId, typed.lines[0].materialId], [id(1), id(2), id(3)], 'a typed / reviewed draft keeps its picked ids')
}

// ── prices from the invoice ──
const P = I.pricesFromInvoice(D, mats)
eq(P.length, 2, 'one price per material')
eq(P[0].price, 25, 'freight separate → the material price')
eq(P[0].basis, 'pickup', 'freight separate → pickup basis')
eq(P[0].fuelPct, null, 'freight billed separately → the fuel rides on the freight by default (no fuel % on the stone)')
eq(P[0].quotedOn, '2026-10-15', 'dated by the invoice')
ok(/^Invoice · freight billed \$2\.50\/TON · fuel on freight \$0\.50\/TON$/.test(P[0].note), 'note names the freight and its fuel per unit: ' + P[0].note)
eq(I.fuelDefault(D), 'freight', 'fuel default with separate freight = freight')
eq(I.fuelDefault({ freight: null }), 'material', 'fuel default with no freight = material')
{
  const Pm = I.pricesFromInvoice(D, mats, { fuelOn: 'material' })
  eq(Pm[0].fuelPct, 2, 'the review flips it to material → fuel % of the material')
  ok(/^Invoice · freight billed \$2\.50\/TON$/.test(Pm[0].note), 'and the note no longer names fuel on freight: ' + Pm[0].note)
  eq(Pm[0].price, P[0].price, 'the material price is the same either way')
  const noFreight = I.pricesFromInvoice({ ...D, freight: 0 }, mats)
  eq(noFreight[0].fuelPct, 2, 'no separate freight → fuel defaults onto the material')
  eq(I.pricesFromInvoice({ ...D, freight: 0 }, mats, { fuelOn: 'bogus' })[0].fuelPct, 2, 'an unknown fuelOn falls back to the default')
}
const twoTickets = { ...D, freight: 0, fuel: 0, delivered: true, invoiceNo: '9001', lines: [
  { description: '#57', materialId: id(11), qty: 10, unit: 'TON', unitPrice: 30, amount: 300, ticket: '1' },
  { description: '#57', materialId: id(11), qty: 30, unit: 'TON', unitPrice: 26, amount: 780, ticket: '2' },
  { description: 'unmatched', materialId: null, qty: 5, unit: 'TON', unitPrice: 10, amount: 50, ticket: null },
] }
const P2 = I.pricesFromInvoice(twoTickets, mats)
eq(P2.length, 1, 'tickets of one material fold into one price; unmatched lines write nothing')
eq(P2[0].price, 27, 'quantity-weighted: (300 + 780) / 40')
eq(P2[0].basis, 'delivered', 'no freight + delivered on the paper → delivered')
eq(P2[0].fuelPct, null, 'no fuel, no fuel %')
eq(P2[0].note, 'Invoice 9001', 'note names the invoice')
eq(I.pricesFromInvoice({ ...D, placeId: null }, mats), [], 'no source, no prices')
eq(I.pricesFromInvoice({ ...D, invoiceOn: null }, mats), [], 'no date, no prices')
eq(I.pricesFromInvoice({ ...D, lines: [{ ...D.lines[0], unit: null }] }, mats), [], 'no unit, no price')

// ── AP aging ──
const today = '2026-11-25'
const inv = [
  { id: 'a', total: 1000, paidAmount: null, paidOn: null, dueOn: '2026-11-30', invoiceOn: '2026-10-31' },
  { id: 'b', total: 2000, paidAmount: null, paidOn: null, dueOn: '2026-10-16', invoiceOn: '2026-09-16' },
  { id: 'c', total: 500, paidAmount: 500, paidOn: '2026-11-01', dueOn: '2026-09-01', invoiceOn: '2026-08-01' },
  { id: 'd', total: 800, paidAmount: 300, paidOn: '2026-11-01', dueOn: '2026-07-01', invoiceOn: '2026-06-01' },
  { id: 'e', total: 100, paidAmount: null, paidOn: null, dueOn: null, invoiceOn: null },
  { id: 'f', total: 400, paidAmount: null, paidOn: null, dueOn: '2026-11-25', invoiceOn: '2026-10-26' },
]
const A = I.apAging(inv, today)
eq(A.buckets.current, 1500, 'current: due in 5 days, due today, no date')
eq(A.buckets.d31_60, 2000, '40 days late → 31–60')
eq(A.buckets.d90p, 500, 'part-paid 147 days late → 90+, only what is owed')
eq(A.open, 4000, 'open total skips the paid one')
eq(A.openCount, 5, 'open count')
eq(A.pastDue, 2500, 'past due')
eq(A.dueThisWeek, 1400, 'due within 7 days')
eq(I.daysLate(inv[1], today), 40, 'days late')
eq(I.daysLate({ dueOn: null, invoiceOn: '2026-11-20' }, today), -25, 'no due date = Net 30 from the invoice date')

eq(I.invoiceRef(id(5), 'INV-88812'), 'INV-88812', 'reference = the invoice number')
eq(I.invoiceRef(id(5), null), 'INV-00000000', 'no number → a short id')

console.log(`${pass} passed, ${fail} failed`)
if (fail) process.exit(1)
