/**
 * Brain Ball daily parent report, asserted (run: node scripts/brainball-report-test.mjs).
 *
 * The report builder decides whose kids get an email and what standings it
 * claims, so this guards: window filtering (who "played today"), tester
 * exclusion, calibration gating, percentile/benchmark sanity, streak math,
 * and HTML escaping of kid names. Run it after ANY change to
 * lib/game/report.ts or the norms in lib/game/adaptive.ts.
 */
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const ts = require('typescript')

const transpile = (rel) => {
  const src = readFileSync(new URL(rel, import.meta.url), 'utf8')
  return ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 } }).outputText
}
const toDataUrl = (js) => 'data:text/javascript;base64,' + Buffer.from(js).toString('base64')

const adaptiveUrl = toDataUrl(transpile('../lib/game/adaptive.ts'))
const questionsUrl = toDataUrl(transpile('../lib/game/questions.ts'))
const personalityUrl = toDataUrl(transpile('../lib/game/personality.ts'))
const reportJs = transpile('../lib/game/report.ts')
  .replace("'./adaptive'", JSON.stringify(adaptiveUrl))
  .replace("'./questions'", JSON.stringify(questionsUrl))
  .replace("'./personality'", JSON.stringify(personalityUrl))
const { buildDailyReports, renderReportEmail } = await import(toDataUrl(reportJs))

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

const NOW = new Date('2026-10-29T23:30:00Z') // 7:30 PM ET
const T0 = NOW.getTime()
const SKILL_IDS = ['counting', 'numbers', 'addition', 'letters', 'sounds', 'shapes', 'words']
const skills = (over = {}) =>
  Object.fromEntries(SKILL_IDS.map((id) => [id, { theta: 30, attempts: 0, correct: 0, bestStreak: 0, ...(over[id] ?? {}) }]))

const kid = (over = {}) => ({
  id: 'kid',
  name: 'Testkid',
  birthdate: '2020-09-01',
  avatar: '🦖',
  coins: 0,
  xp: 0,
  stars: 0,
  ownedSkins: ['classic'],
  activeSkin: 'classic',
  skills: skills(),
  history: [],
  roundsPlayed: 0,
  ...over,
})

const answers = (n, { skill = 'words', correctPattern = () => true, startMs = T0 - 3600_000 } = {}) =>
  Array.from({ length: n }, (_, i) => ({ t: startMs + i * 10_000, skill, difficulty: 50, correct: correctPattern(i), ms: 4000 }))

// ---- window filtering: who "played today"
{
  const played = kid({ history: answers(10) })
  const idle = kid({ id: 'idle', name: 'Idle', history: answers(10, { startMs: T0 - 3 * 86400_000 }) })
  const tester = kid({ id: 't', name: 'Grownup', isTester: true, history: answers(10) })
  const reports = buildDailyReports([played, idle, tester], T0 - 86400_000, NOW)
  ok('only the kid who played in the window reports', reports.length === 1 && reports[0].name === 'Testkid')
  ok('answered count = window answers', reports[0].answered === 10)
}

// ---- accuracy + best streak inside the window only
{
  const h = [...answers(5, { correctPattern: () => true, startMs: T0 - 10 * 86400_000 }), ...answers(6, { correctPattern: (i) => i !== 2 })]
  const r = buildDailyReports([kid({ history: h })], T0 - 86400_000, NOW)[0]
  ok('accuracy from the window only', r.answered === 6 && r.correct === 5 && r.accuracy === 83, `got ${r.answered}/${r.correct}/${r.accuracy}`)
  ok('best streak from the window only', r.bestStreak === 3, `got ${r.bestStreak}`)
}

// ---- calibration gating + early flag + ordering + overall
{
  const k = kid({
    history: answers(3),
    skills: skills({
      words: { theta: 92, attempts: 25, correct: 20, bestStreak: 5 },
      letters: { theta: 90, attempts: 5, correct: 4, bestStreak: 3 },
      counting: { theta: 30, attempts: 2, correct: 1, bestStreak: 1 }, // under CALIBRATION_MIN
    }),
  })
  const r = buildDailyReports([k], T0 - 86400_000, NOW)[0]
  ok('uncalibrated skills stay out', r.skills.every((s) => s.id !== 'counting') && r.skills.length === 2, `got ${r.skills.map((s) => s.id)}`)
  ok('early flag under FIRM_MIN', r.skills.find((s) => s.id === 'letters')?.early === true && r.skills.find((s) => s.id === 'words')?.early === false)
  ok('sorted by percentile desc', r.skills[0].percentile >= r.skills[1].percentile)
  ok('overall = mean of skill percentiles', r.overallPct === Math.round((r.skills[0].percentile + r.skills[1].percentile) / 2))
  ok('strongest/focus named', r.strongest === r.skills[0].name && r.focus === r.skills[1].name)
}

// ---- percentile + benchmark sanity (theta 92 at age ~6 is a top reader)
{
  const k = kid({ history: answers(3), skills: skills({ words: { theta: 92, attempts: 25, correct: 20, bestStreak: 5 } }) })
  const s = buildDailyReports([k], T0 - 86400_000, NOW)[0].skills[0]
  ok('theta 92 at ~6 yrs reads as a high percentile', s.percentile >= 85, `got ${s.percentile}`)
  ok('SC ≥ US, Global ≥ SC (lower benchmark means higher standing)', s.sc >= s.percentile && s.global >= s.sc, `${s.percentile}/${s.sc}/${s.global}`)
  ok('percentiles clamp to 1..99', [s.percentile, s.sc, s.global].every((p) => p >= 1 && p <= 99))
}

// ---- email rendering: subject, standings line, assessment card, escaping
{
  const evil = kid({
    name: '<img src=x onerror=alert(1)>',
    history: answers(5),
    skills: skills({ words: { theta: 92, attempts: 25, correct: 20, bestStreak: 5 } }),
    assessment: { date: 'Oct 2026', title: 'School reading check', summary: 'Top marks & <b>bold</b>', focus: [] },
  })
  const reports = buildDailyReports([evil], T0 - 86400_000, NOW)
  const { subject, html } = renderReportEmail(reports, NOW, 'America/New_York')
  ok('subject carries the name and date', subject.includes('Brain Ball') && subject.includes('Oct 29'))
  ok('kid name is HTML-escaped', !html.includes('<img src=x') && html.includes('&lt;img'))
  ok('assessment summary is HTML-escaped', !html.includes('<b>bold</b>') && html.includes('&lt;b&gt;bold&lt;/b&gt;'))
  ok('AMIRA-style standings line present', html.includes('Scored better than'))
  ok('school assessment card included', html.includes('School reading check'))
  ok('honest caveat present', html.includes('not a clinical assessment'))
}

// ---- the narrated writeup: standing, strengths, gaps, confidence, personality
{
  const k = kid({
    name: 'Marshall',
    history: answers(10),
    skills: skills({
      words: { theta: 93, attempts: 40, correct: 34, bestStreak: 7 },
      letters: { theta: 90, attempts: 30, correct: 26, bestStreak: 6 },
      addition: { theta: 40, attempts: 20, correct: 12, bestStreak: 3 },
      shapes: { theta: 50, attempts: 4, correct: 3, bestStreak: 2 },
    }),
    assessment: { date: 'Oct 2026', title: 'School reading check', summary: 'Better than 99% in all six reading areas.', focus: [] },
    personality: { current: { primary: 'lion', scores: {}, takenAt: 0 }, history: [] },
  })
  const r = buildDailyReports([k], T0 - 86400_000, NOW)[0]
  ok('story exists and names the kid', typeof r.story === 'string' && r.story.includes('Marshall'))
  ok('story names the strengths with ordinals', r.story.includes('Words') && /\d+(st|nd|rd|th)/.test(r.story))
  ok('story cites the school check', r.story.includes('school reading check'))
  ok('story states its confidence base', r.story.includes('scored answers') && r.story.includes('not a school test'))
  ok('story carries the personality read', /Who Am I\?/.test(r.story))
  ok('story flags the growth lane', r.story.includes('Mix rounds'))
  const { html } = renderReportEmail([r], NOW, 'America/New_York')
  ok('story paragraph lands in the email', html.includes('scored answers'))
  // no personality + no assessment → sentences absent, prose still coherent
  const plain = buildDailyReports([kid({ name: 'Lincoln', history: answers(6), skills: skills({ counting: { theta: 38, attempts: 20, correct: 14, bestStreak: 4 } }) })], T0 - 86400_000, NOW)[0]
  ok('story skips what it does not know', !plain.story.includes('Who Am I?') && !plain.story.includes('school reading check') && plain.story.includes('Lincoln'))
}

// ---- nobody played → no reports → caller sends nothing
{
  const reports = buildDailyReports([kid({ history: [] })], T0 - 86400_000, NOW)
  ok('empty history yields no report', reports.length === 0)
}

// ---- malformed cloud rows don't throw
{
  const reports = buildDailyReports([null, {}, kid({ history: [{ bogus: true }, null, ...answers(2)] })], T0 - 86400_000, NOW)
  ok('malformed profiles/answers are skipped, valid ones counted', reports.length === 1 && reports[0].answered === 2)
}

console.log(fail === 0 ? `brainball-report: ${pass} assertions pass` : `${fail} FAILURES (${pass} passed)`)
process.exit(fail === 0 ? 0 : 1)
