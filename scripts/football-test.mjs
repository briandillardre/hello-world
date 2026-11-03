/**
 * 🏈 Game Day drive engine, asserted (run: node scripts/football-test.mjs).
 *
 * The engine decides what every answer MEANS on the field — downs, the
 * first-down line, scores, turnovers, the defense stand — and it teaches the
 * boys real football rules, so the rules here must BE the rules. Run after
 * ANY change to lib/game/football.ts.
 */
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const ts = require('typescript')
const src = readFileSync(new URL('../lib/game/football.ts', import.meta.url), 'utf8')
const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 } }).outputText
const fb = await import('data:text/javascript;base64,' + Buffer.from(js).toString('base64'))
const { newGame, applyPlay, availableCalls, downWords, spotWords, fgInRange, kickDistance, describeCall } = fb

let pass = 0
let fail = 0
const ok = (name, cond, extra = '') => {
  if (cond) { pass++; return }
  fail++
  console.log('✗', name, extra)
}
const kinds = (r) => r.events.map((e) => e.kind).join(',')

// ---- opening state
{
  const s = newGame()
  ok('kickoff: 1st & 10 at your 20', s.ball === 20 && s.down === 1 && s.lineToGain === 30 && downWords(s) === '1st & 10')
  ok('opening calls: run + pass, no FG from your 20', availableCalls(s).join(',') === 'run,pass')
  ok('spot words', spotWords(s) === 'your 20' && spotWords({ ...s, ball: 50 }) === 'midfield' && spotWords({ ...s, ball: 65 }) === "the Robots' 35")
}

// ---- downs & the first-down line
{
  let s = newGame()
  let r = applyPlay(s, 'run', true, 0)
  ok('correct run gains 7 → 2nd & 3', r.next.ball === 27 && r.next.down === 2 && downWords(r.next) === '2nd & 3')
  r = applyPlay(r.next, 'run', true, 0)
  ok('crossing the line resets downs', r.next.ball === 34 && r.next.down === 1 && r.next.lineToGain === 44 && kinds(r).includes('firstDown'))
  // four straight stuffed runs = turnover on downs
  s = newGame()
  for (let i = 0; i < 3; i++) s = applyPlay(s, 'run', false, 0).next
  ok('three wrong runs → 4th down', s.down === 4 && s.ball === 20)
  r = applyPlay(s, 'run', false, 0)
  ok('4th-down failure → turnover on downs → defense', kinds(r).includes('turnoverOnDowns') && r.next.phase === 'defense')
}

// ---- hot streak blocking
{
  const r = applyPlay(newGame(), 'run', true, 3)
  ok('streak run gains 10 behind hot blockers', r.next.ball === 30 && r.events[0].text.includes('block'))
  const p = applyPlay(newGame(), 'pass', true, 3)
  ok('streak pass gains 20', p.next.ball === 40)
}

// ---- passing: reward and risk
{
  const r = applyPlay(newGame(), 'pass', true, 0)
  ok('completed pass +15 and a first down', r.next.ball === 35 && r.next.down === 1 && kinds(r).includes('firstDown'))
  const i = applyPlay(newGame(), 'pass', false, 0)
  ok('wrong pass = interception → defense', kinds(i) === 'intercepted' && i.next.phase === 'defense')
  ok('interception does not change the score', i.next.us === 0 && i.next.them === 0)
}

// ---- touchdown + extra point
{
  let s = { ...newGame(), ball: 90, lineToGain: 100 }
  let r = applyPlay(s, 'pass', true, 0)
  ok('TD = 6 points and the XP phase', r.next.us === 6 && r.next.phase === 'xp' && kinds(r).includes('touchdown'))
  ok('XP phase offers only the kick', availableCalls(r.next).join(',') === 'xp')
  const good = applyPlay(r.next, 'xp', true, 0)
  ok('good XP = 7 total, then defense', good.next.us === 7 && good.next.phase === 'defense')
  const miss = applyPlay(r.next, 'xp', false, 0)
  ok('missed XP stays at 6, still defense', miss.next.us === 6 && miss.next.phase === 'defense')
}

// ---- field goals
{
  const out = { ...newGame(), ball: 61 }
  ok('56-yard kick is out of range', !fgInRange(out) && availableCalls(out).join(',') === 'run,pass')
  const edge = { ...newGame(), ball: 62 }
  ok('55-yard kick is the edge of range', fgInRange(edge) && kickDistance(edge) === 55 && availableCalls(edge).includes('fg'))
  const good = applyPlay(edge, 'fg', true, 0)
  ok('made FG = +3, then defense', good.next.us === 3 && good.next.phase === 'defense' && kinds(good) === 'fgGood')
  const miss = applyPlay(edge, 'fg', false, 0)
  ok('missed FG = 0, Robots ball', miss.next.us === 0 && miss.next.phase === 'defense')
}

// ---- the defense stand: punt / their FG / their TD
{
  const start = { ...newGame(), phase: 'defense', oppBall: 60, defPlays: 0, defStops: 0 }
  // two tackles → punt, fresh drive, no points for them
  let r = applyPlay(start, 'tackle', true, 0)
  ok('first tackle: stand continues', r.next.phase === 'defense' && r.next.defStops === 1)
  r = applyPlay(r.next, 'tackle', true, 0)
  ok('two stops → they punt → your ball at the 20', kinds(r).includes('theyPunt') && kinds(r).includes('newDrive') && r.next.phase === 'offense' && r.next.ball === 20 && r.next.them === 0)
  // one stop → they kick a field goal
  let one = applyPlay(start, 'tackle', true, 0)
  one = applyPlay(one.next, 'tackle', false, 0)
  ok('one stop → Robots field goal +3', kinds(one).includes('theyFG') && one.next.them === 3 && one.next.phase === 'offense')
  // zero stops → they march in for 7
  let zero = applyPlay(start, 'tackle', false, 0)
  zero = applyPlay(zero.next, 'tackle', false, 0)
  ok('two misses → Robots touchdown +7', kinds(zero).includes('theyTD') && zero.next.them === 7 && zero.next.phase === 'offense')
  ok('drive counter advanced after the stand', zero.next.drives === 2 && zero.next.down === 1 && zero.next.lineToGain === 30)
}

// ---- goal-to-go wording
{
  const s = { ...newGame(), ball: 93, lineToGain: 100 }
  ok('inside the 10 reads "& Goal"', downWords(s) === '1st & Goal')
}

// ---- describeCall copy exists for every call
{
  const s = { ...newGame(), ball: 70 }
  for (const c of ['run', 'pass', 'fg', 'xp', 'tackle']) {
    const d = describeCall(c, s, 0)
    ok(`describeCall(${c})`, !!d.emoji && !!d.name && !!d.blurb)
  }
  ok('FG blurb names the kick distance', describeCall('fg', s, 0).blurb.includes('47-yard'))
}

// ---- a full simulated game never corrupts state
{
  let s = newGame()
  let rand = 42
  const rnd = () => (rand = (rand * 1103515245 + 12345) % 2 ** 31) / 2 ** 31
  for (let i = 0; i < 500; i++) {
    const calls = availableCalls(s)
    const call = calls[Math.floor(rnd() * calls.length)]
    s = applyPlay(s, call, rnd() < 0.7, Math.floor(rnd() * 6)).next
    if (s.ball < 0 || s.ball > 100 || s.down < 1 || s.down > 4 || s.us < 0 || s.them < 0 || s.lineToGain > 100 || (s.phase === 'offense' && s.lineToGain <= s.ball)) {
      ok('fuzz: state stayed sane', false, JSON.stringify(s))
      break
    }
  }
  ok('500-play fuzz completed with sane state', true)
}

console.log(fail === 0 ? `football: ${pass} assertions pass` : `${fail} FAILURES (${pass} passed)`)
process.exit(fail === 0 ? 0 : 1)
