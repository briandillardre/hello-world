/**
 * 🎲 Brain Ball Mix + generators + missions, asserted
 * (run: node scripts/brainball-mix-test.mjs).
 *
 * Guards: (1) Mix keeps reading & math at about half of every round even
 * when eight brand-new subjects sit at zero attempts; (2) every skill's kid
 * AND adult generator returns a valid question at every difficulty; (3) the
 * daily real-world mission is stable within a day, differs between the
 * brothers, never repeats two days running and fits the kid's age.
 * Run after ANY change to adaptive.ts (pickMixSkill), questions.ts or missions.ts.
 */
import { importTs } from './lib/ts-import.mjs'

const { pickMixSkill, MIX_SHARE } = await importTs('../lib/game/adaptive.ts', import.meta.url)
const { SKILLS, generateQuestion } = await importTs('../lib/game/questions.ts', import.meta.url)
const { missionFor, missionPool, dayKey, MISSIONS } = await importTs('../lib/game/missions.ts', import.meta.url)
const BT = await importTs('../lib/game/bigthink.ts', import.meta.url)

let pass = 0
let fail = 0
const ok = (name, cond, extra = '') => {
  if (cond) {
    pass++
    return
  }
  fail++
  console.log('✗', name, extra)
}

// ---- Mix shares: a Marshall-shaped profile (lots of core practice, new subjects untouched)
{
  const skills = {}
  for (const s of SKILLS) skills[s.id] = { theta: 70, attempts: s.group === 'core' ? 120 : s.id === 'science' ? 30 : 0, correct: 0, bestStreak: 0 }
  const counts = {}
  const N = 30000
  for (let i = 0; i < N; i++) {
    const id = pickMixSkill(skills, '2020-09-15')
    counts[id] = (counts[id] ?? 0) + 1
  }
  const share = (g) => SKILLS.filter((s) => s.group === g).reduce((a, s) => a + (counts[s.id] ?? 0), 0) / N
  ok('core keeps ~half of Mix', Math.abs(share('core') - MIX_SHARE.core) < 0.03, share('core').toFixed(3))
  ok('world gets its share', Math.abs(share('world') - MIX_SHARE.world) < 0.03, share('world').toFixed(3))
  ok('life gets its share', Math.abs(share('life') - MIX_SHARE.life) < 0.03, share('life').toFixed(3))
  ok('every skill appears in Mix', SKILLS.every((s) => (counts[s.id] ?? 0) > 0), JSON.stringify(counts))
  ok('within world, untouched subjects outdraw practiced science', (counts.history ?? 0) > (counts.science ?? 0))
}

// ---- every generator, kid + adult, every difficulty band
{
  let bad = 0
  for (const s of SKILLS) {
    for (const adult of [false, true]) {
      for (let d = 1; d <= 99; d += 2) {
        for (let k = 0; k < 4; k++) {
          const q = generateQuestion(s.id, d, adult)
          const distinct = new Set(q.choices.map(String)).size === q.choices.length
          if (q.skill !== s.id || q.answer < 0 || q.answer >= q.choices.length || !distinct || !q.prompt || !q.speech) {
            bad++
            if (bad < 4) console.log('  bad question', s.id, adult ? 'adult' : 'kid', d, JSON.stringify(q).slice(0, 200))
          }
        }
      }
    }
  }
  ok(`${SKILLS.length} skills × kid/adult × all difficulties generate valid questions`, bad === 0, `${bad} bad`)
  ok('17 skills in three groups', SKILLS.length === 17 && new Set(SKILLS.map((s) => s.group)).size === 3)
  // listening questions say themselves (the screen can't carry the target)
  let listened = 0
  for (let i = 0; i < 400; i++) if (generateQuestion('letters', 1 + (i % 49), false).listen) listened++
  ok('lowercase/capital letter-by-name questions are flagged listen', listened > 0)
}

// ---- real-world missions
{
  const marshall = { id: 'marshall', birthdate: '2020-09-15' }
  const lincoln = { id: 'lincoln', birthdate: '2022-02-10' }
  const day = new Date(2026, 10, 6, 9)
  const later = new Date(2026, 10, 6, 20)
  ok('mission stable all day', missionFor(marshall, day).id === missionFor(marshall, later).id)
  let repeats = 0
  let differ = 0
  for (let i = 0; i < 120; i++) {
    const d = new Date(2026, 0, 1 + i, 12)
    const y = new Date(2026, 0, i, 12)
    if (missionFor(marshall, d).id === missionFor(marshall, y).id) repeats++
    if (missionFor(marshall, d).id !== missionFor(lincoln, d).id) differ++
  }
  ok('never the same mission two days running', repeats === 0, `${repeats} repeats`)
  ok('brothers usually get different missions', differ > 100, `${differ}/120`)
  ok('4-year-old never gets a big-kid mission', missionPool(lincoln, day).every((m) => m.for !== 'big'))
  ok('6-year-old never gets a little-kid mission', missionPool(marshall, day).every((m) => m.for !== 'little'))
  ok('mission ids unique', new Set(MISSIONS.map((m) => m.id)).size === MISSIONS.length)
  // a full cycle shows every mission once before any repeat
  const n = missionPool(marshall, day).length
  const seen = new Set()
  for (let i = 0; i < n; i++) seen.add(missionFor(marshall, new Date(2026, 11, 1 + i, 12)).id)
  ok('one cycle covers every mission exactly once', seen.size === n, `${seen.size}/${n}`)
  // 2 years of days: never back-to-back, including across DST changes
  let backToBack = 0
  for (let i = 1; i < 730; i++) if (missionFor(lincoln, new Date(2026, 0, 1 + i, 12)).id === missionFor(lincoln, new Date(2026, 0, i, 12)).id) backToBack++
  ok('two years without a back-to-back repeat', backToBack === 0, `${backToBack}`)
  ok('dayKey is local YYYY-MM-DD', dayKey(day) === '2026-11-06')
}

// ---- 💭 Big Think + 🚀 Big Projects (Nov 9 — Hassabis: people skills, projects, entrepreneurship, creativity, judgment)
{
  const big = { id: 'marshall', birthdate: '2020-03-01' }
  const little = { id: 'lincoln', birthdate: '2022-06-01' }
  const now = new Date(2026, 10, 9, 12)
  ok('every Big Think has 2–4 choices and a WHY', BT.THINKS.every((t) => t.options.length >= 2 && t.options.length <= 4 && t.why.length > 5))
  ok('Big Think ids unique', new Set(BT.THINKS.map((t) => t.id)).size === BT.THINKS.length)
  const kinds = new Set(BT.THINKS.map((t) => t.kind))
  ok('all four think kinds are present', ['judgment', 'people', 'create', 'business'].every((k) => kinds.has(k)))
  for (const kid of [big, little]) {
    const pool = BT.thinkPool(kid, now)
    ok(`${kid.id}: every kind in their pool`, ['judgment', 'people', 'create', 'business'].every((k) => pool.some((t) => t.kind === k)) || kid === little, pool.map((t) => t.kind).join())
    const a = BT.thinkFor(kid, now), b = BT.thinkFor(kid, new Date(2026, 10, 9, 20))
    ok(`${kid.id}: same Big Think all day`, a.id === b.id)
    const seen = new Set()
    for (let d = 0; d < pool.length; d++) seen.add(BT.thinkFor(kid, new Date(2026, 10, 9 + d, 12)).id)
    ok(`${kid.id}: every Big Think comes round before a repeat`, seen.size === pool.length, `${seen.size}/${pool.length}`)
  }
  ok('little kids get people + create + judgment', ['people', 'create', 'judgment'].every((k) => BT.thinkPool(little, now).some((t) => t.kind === k)))
  ok('project ids unique, 4–5 steps', new Set(BT.PROJECTS.map((p) => p.id)).size === BT.PROJECTS.length && BT.PROJECTS.every((p) => p.steps.length >= 4 && p.steps.length <= 5))
  ok('a business project exists for the big kid', BT.projectPool(big, now).some((p) => /business/.test(p.builds)))
  // walk a project to the end: one step a day, the finish pays the bonus, the next project starts fresh
  let kid = { ...big, project: undefined, projectsDone: [] }
  const first = BT.currentProject(kid, now)
  let coins = 0, finishedOn = -1
  for (let d = 0; d < 12; d++) {
    const day = `2026-11-${String(10 + d).padStart(2, '0')}`
    const r = BT.advanceProject(kid, day, now)
    ok(`day ${d}: a step can be taken`, !!r)
    const again = BT.advanceProject({ ...kid, project: r.project, projectsDone: r.projectsDone }, day, now)
    if (d === 0) ok('one step a day — a second confirm the same day pays nothing', again === null)
    coins += r.coins
    kid = { ...kid, project: r.project, projectsDone: r.projectsDone }
    if (r.finished) { finishedOn = d; break }
  }
  ok('the first project finishes after its steps', finishedOn === first.steps.length - 1, String(finishedOn))
  ok('steps + finish bonus paid', coins === first.steps.length * BT.PROJECT_STEP_COINS + BT.PROJECT_FINISH_COINS, String(coins))
  const next = BT.currentProject(kid, now)
  ok('the next project is a different one', next.id !== first.id && kid.projectsDone.includes(first.id))
  ok('finishing does not open the next project the same day', BT.advanceProject(kid, kid.project.lastDay, now) === null)
}

console.log(fail === 0 ? `brainball-mix: ${pass} assertions pass` : `${fail} FAILURES (${pass} passed)`)
process.exit(fail === 0 ? 0 : 1)
