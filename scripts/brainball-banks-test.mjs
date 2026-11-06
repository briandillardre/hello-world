/**
 * 📚 Brain Ball fact banks, asserted (run: node scripts/brainball-banks-test.mjs [file…]).
 *
 * Every knowledge skill's facts live in lib/game/banks/<skill>.ts as
 * `KID: KidFact[]` + `ADULT: AdultFact[]`. The bubbles are ~50 px on a
 * phone, so answers must stay SHORT, choices must be distinct, and every
 * tier must hold enough facts that a kid doesn't see repeats every round.
 * Run after ANY change to a bank. With no args it checks every bank.
 */
import { readFileSync, readdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import { basename, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const ts = require('typescript')
const dir = fileURLToPath(new URL('../lib/game/banks/', import.meta.url))
const files = process.argv.slice(2).length
  ? process.argv.slice(2)
  : readdirSync(dir).filter((f) => f.endsWith('.ts') && f !== 'types.ts' && f !== 'index.ts').map((f) => join(dir, f))

/** longest choice the bubble fitter keeps legible (2 lines of ~10 chars) */
const MAX_ANSWER = 20
const MIN_PER_KID_TIER = 7
const MIN_PER_ADULT_TIER = 5

let pass = 0
let fail = 0
const bad = (file, msg) => {
  fail++
  console.log(`✗ ${basename(file)}: ${msg}`)
}

for (const file of files) {
  const src = readFileSync(file, 'utf8').replace(/^import type .*$/gm, '')
  const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 } }).outputText
  const mod = await import('data:text/javascript;base64,' + Buffer.from(js).toString('base64'))
  const { KID, ADULT } = mod
  if (!Array.isArray(KID) || !Array.isArray(ADULT)) {
    bad(file, 'must export KID and ADULT arrays')
    continue
  }
  const seen = new Set()
  const check = (f, label) => {
    const choices = [f.a, ...(f.m ?? [])]
    if (!f.q || !f.a || !Array.isArray(f.m) || f.m.length !== 2 || !f.why) return bad(file, `${label}: missing q/a/m[2]/why — ${f.q}`)
    if (new Set(choices.map((c) => c.toLowerCase().trim())).size !== 3) return bad(file, `${label}: duplicate choices — ${f.q}`)
    for (const c of choices) if (c.length > MAX_ANSWER) return bad(file, `${label}: choice "${c}" is ${c.length} chars (max ${MAX_ANSWER}) — ${f.q}`)
    if (/_{2,}/.test(f.q)) return bad(file, `${label}: "___" blank reads badly aloud — ${f.q}`)
    if (seen.has(f.q)) return bad(file, `${label}: duplicate question — ${f.q}`)
    seen.add(f.q)
    pass++
  }
  KID.forEach((f, i) => {
    if (![1, 2, 3, 4, 5].includes(f.t)) return bad(file, `KID[${i}] bad tier ${f.t}`)
    check(f, `KID[${i}] t${f.t}`)
  })
  ADULT.forEach((f, i) => {
    if (![1, 2, 3].includes(f.tier)) return bad(file, `ADULT[${i}] bad tier ${f.tier}`)
    check(f, `ADULT[${i}] tier${f.tier}`)
  })
  for (const t of [1, 2, 3, 4, 5]) {
    const n = KID.filter((f) => f.t === t).length
    if (n < MIN_PER_KID_TIER) bad(file, `kid tier ${t} has ${n} facts (min ${MIN_PER_KID_TIER})`)
  }
  for (const t of [1, 2, 3]) {
    const n = ADULT.filter((f) => f.tier === t).length
    if (n < MIN_PER_ADULT_TIER) bad(file, `adult tier ${t} has ${n} facts (min ${MIN_PER_ADULT_TIER})`)
  }
  console.log(`  ${basename(file)}: ${KID.length} kid · ${ADULT.length} adult`)
}

console.log(fail === 0 ? `banks: ${pass} facts pass` : `${fail} FAILURES (${pass} passed)`)
process.exit(fail === 0 ? 0 : 1)
