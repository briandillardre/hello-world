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
  ok('dayKey is local YYYY-MM-DD', dayKey(day) === '2026-11-06')
}

console.log(fail === 0 ? `brainball-mix: ${pass} assertions pass` : `${fail} FAILURES (${pass} passed)`)
process.exit(fail === 0 ? 0 : 1)
