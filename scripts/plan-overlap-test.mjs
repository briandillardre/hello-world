/**
 * Harness for lib/plans/overlap.ts — a run two linked sheets both carry is
 * counted once.
 *
 *   node scripts/plan-overlap-test.mjs
 *
 * Two road sheets at 1" = 40' that overlap by 100 ft at a matchline, and an
 * overall at 1" = 80' with a quadrant enlarged at 1" = 20'. Run it after ANY
 * change to lib/plans/overlap.ts.
 */
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const ts = require('typescript')
const url = (rel, deps = {}) => {
  let s = readFileSync(new URL(rel, import.meta.url), 'utf8')
  for (const [k, v] of Object.entries(deps)) s = s.replaceAll(`from '${k}'`, `from '${v}'`)
  return 'data:text/javascript;base64,' + Buffer.from(ts.transpileModule(s, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 } }).outputText).toString('base64')
}
const matchUrl = url('../lib/plans/match.ts')
const O = await import(url('../lib/plans/overlap.ts', { './match': matchUrl }))
const M = await import(matchUrl)

let pass = 0, fail = 0
const ok = (c, msg) => { if (c) pass++; else { fail++; console.log('FAIL', msg) } }
const near = (a, b, tol, msg) => ok(Math.abs(a - b) <= tol, `${msg}: ${a} vs ${b}`)

const W = 2592, H = 1728 // 36 × 24 in
// A sheet: ground feet (x east, y north) → page points (y up) by fpi + offset; → UV (v from top).
const sheet = (id, order, fpi, offFt, marks) => {
  const k = 72 / fpi
  const page = ([x, y]) => [(x - offFt[0]) * k, (y - offFt[1]) * k]
  const uv = (p) => { const q = page(p); return [q[0] / W, 1 - q[1] / H] }
  return {
    s: { versionId: id, order, W, H, ftPerPt: fpi / 72, marks: marks.map((m) => ({ ...m, pts: m.pts.map(uv), holes: m.holes?.map((h) => h.map(uv)) })) },
    // ground ft → page pts similarity
    t: { s: k, th: 0, tx: -offFt[0] * k, ty: -offFt[1] * k },
  }
}
// link a → b = b.page ∘ ground ∘ a.page⁻¹
const link = (A, B) => ({ a: A.s.versionId, b: B.s.versionId, t: M.compose(B.t, M.invert(A.t)) })

// ── 1. Road sheets meeting at a matchline: curb drawn on both through a 100 ft overlap ──
{
  // A covers x 0..1296 ft (36 in × 40 = 1440 ft wide page), B starts at x = 1100.
  const curbA = { id: 'a1', itemId: 'curb', kind: 'line', pts: [[100, 300], [1200, 300]], qty: 1100 }
  const curbB = { id: 'b1', itemId: 'curb', kind: 'line', pts: [[1100, 300], [2300, 300]], qty: 1200 }
  const pipeB = { id: 'b2', itemId: 'pipe', kind: 'line', pts: [[1100, 500], [2000, 500]], qty: 900 }
  const pipeA = { id: 'a2', itemId: 'pipe', kind: 'line', pts: [[100, 520], [1200, 520]], qty: 1100 } // 20 ft off: a different run
  const A = sheet('A', 'C-201', 40, [0, 0], [curbA, pipeA]), B = sheet('B', 'C-202', 40, [1100, 0], [curbB, pipeB])
  const d = O.overlapDeductions([A.s, B.s], [link(A, B)])
  const curb = d.find((x) => x.itemId === 'curb')
  ok(!!curb, 'curb overlap found')
  near(curb?.qty ?? 0, 100, 2, 'curb counted once over the 100 ft overlap')
  ok(curb?.from === 'B', 'the later sheet gives up the shared part')
  ok(!d.some((x) => x.itemId === 'pipe'), 'a parallel run 20 ft away is not the same run')
  // Link stored the other way round gives the same answer.
  const d2 = O.overlapDeductions([A.s, B.s], [link(B, A)])
  near(d2.find((x) => x.itemId === 'curb')?.qty ?? 0, 100, 2, 'link direction does not matter')
}

// ── 2. Overall (1"=80') and an enlarged quadrant (1"=20'): paving area drawn on both ──
{
  const pave = (id, qty) => ({ id, itemId: 'pave', kind: 'area', pts: [[200, 200], [600, 200], [600, 500], [200, 500]], qty })
  const overall = sheet('OV', 'C-100', 80, [0, 0], [pave('o1', 120000), { id: 'o2', itemId: 'mh', kind: 'count', pts: [[400, 350]], qty: 1 }])
  // the quadrant covers x 0..720, y 0..480 ft: the paving sticks out of it (y > 480)
  const quad = sheet('Q1', 'C-101', 20, [0, 0], [
    { id: 'q1', itemId: 'pave', kind: 'area', pts: [[200, 200], [600, 200], [600, 480], [200, 480]], qty: 112000 },
    { id: 'q2', itemId: 'mh', kind: 'count', pts: [[400.5, 350.4]], qty: 1 },
  ])
  const d = O.overlapDeductions([overall.s, quad.s], [link(overall, quad)])
  const pv = d.find((x) => x.itemId === 'pave')
  near(pv?.qty ?? 0, 112000, 2500, 'the quadrant’s paving is inside the overall’s — counted once')
  near(d.find((x) => x.itemId === 'mh')?.qty ?? 0, 1, 0, 'the same manhole on both sheets counts once')
}

// ── 3. Nothing linked, nothing taken; a mark never gives up more than itself ──
{
  const A = sheet('A', 'C-1', 40, [0, 0], [{ id: 'x', itemId: 'curb', kind: 'line', pts: [[0, 100], [500, 100]], qty: 500 }])
  const B = sheet('B', 'C-2', 40, [0, 0], [{ id: 'y', itemId: 'curb', kind: 'line', pts: [[0, 100], [500, 100]], qty: 500 }])
  const C = sheet('C', 'C-3', 40, [0, 0], [{ id: 'z', itemId: 'curb', kind: 'line', pts: [[0, 100], [500, 100]], qty: 500 }])
  ok(O.overlapDeductions([A.s, B.s], []).length === 0, 'no link, no deduction')
  const d = O.overlapDeductions([A.s, B.s, C.s], [link(A, B), link(A, C), link(B, C)])
  const fromC = d.filter((x) => x.from === 'C').reduce((t, x) => t + x.qty, 0)
  ok(fromC <= 500.001, `a mark never gives up more than all of itself (${fromC})`)
  const total = 1500 - d.reduce((t, x) => t + x.qty, 0)
  near(total, 500, 1, 'three sheets drawing the same run count it once')
}

console.log(`\nplan-overlap: ${pass} passed, ${fail} failed`)
if (fail) process.exit(1)
