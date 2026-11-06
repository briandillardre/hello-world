/**
 * 🏈 Game Day drive engine, asserted (run: node scripts/football-test.mjs).
 *
 * The engine decides what every play OUTCOME means on the field — the
 * question earns the play, the mini-game reports how it really went (yards
 * steered, kick swung, runner caught), and this module turns that into
 * downs, scores, turnovers and the defense stand. It teaches the boys real
 * football rules, so the rules here must BE the rules. Run after ANY change
 * to lib/game/football.ts.
 */
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const ts = require('typescript')
const src = readFileSync(new URL('../lib/game/football.ts', import.meta.url), 'utf8')
const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 } }).outputText
const fb = await import('data:text/javascript;base64,' + Buffer.from(js).toString('base64'))
const { newGame, applyPlay, availableCalls, downWords, spotWords, fgInRange, kickDistance, describeCall, PASS_AIR_YARDS, DEF_GAIN } = fb

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

// ---- the mini-game's yards ARE the play
{
  let s = newGame()
  let r = applyPlay(s, 'run', { correct: true, yards: 7 })
  ok('7-yard scramble → 2nd & 3', r.next.ball === 27 && r.next.down === 2 && downWords(r.next) === '2nd & 3')
  r = applyPlay(r.next, 'run', { correct: true, yards: 12 })
  ok('crossing the line resets downs', r.next.ball === 39 && r.next.down === 1 && r.next.lineToGain === 49 && kinds(r).includes('firstDown'))
  const big = applyPlay(newGame(), 'run', { correct: true, yards: 46 })
  ok('a long run reads HUGE', big.next.ball === 66 && big.events[0].text.includes('HUGE'))
  const stuffed = applyPlay(newGame(), 'run', { correct: true, yards: 0 })
  ok('tackled at the line uses a down, no yards', stuffed.next.ball === 20 && stuffed.next.down === 2 && kinds(stuffed) === 'tackledNoGain')
  const neg = applyPlay(newGame(), 'run', { correct: true, yards: -8 })
  ok('yards never go backward below the spot', neg.next.ball === 20)
  const over = applyPlay({ ...newGame(), ball: 95, lineToGain: 100 }, 'run', { correct: true, yards: 60 })
  ok('yards clamp at the goal line → TD', over.next.ball === 100 || over.next.phase === 'xp')
  // four stuffed plays = turnover on downs
  s = newGame()
  for (let i = 0; i < 3; i++) s = applyPlay(s, 'run', { correct: false }).next
  ok('three sacks → 4th down', s.down === 4 && s.ball === 20)
  r = applyPlay(s, 'run', { correct: false })
  ok('4th-down failure → turnover on downs → defense', kinds(r).includes('turnoverOnDowns') && r.next.phase === 'defense')
}

// ---- passing: reward and risk
{
  const r = applyPlay(newGame(), 'pass', { correct: true, yards: PASS_AIR_YARDS })
  ok('caught pass banks the air yards + a first down', r.next.ball === 35 && r.next.down === 1 && kinds(r).includes('firstDown'))
  const i = applyPlay(newGame(), 'pass', { correct: false })
  ok('wrong pass = interception → defense', kinds(i) === 'intercepted' && i.next.phase === 'defense')
  ok('interception does not change the score', i.next.us === 0 && i.next.them === 0)
}

// ---- touchdown + extra point (the swung kick decides)
{
  const s = { ...newGame(), ball: 90, lineToGain: 100 }
  const r = applyPlay(s, 'pass', { correct: true, yards: 25 })
  ok('TD = 6 points and the XP phase', r.next.us === 6 && r.next.phase === 'xp' && kinds(r).includes('touchdown'))
  ok('XP phase offers only the kick', availableCalls(r.next).join(',') === 'xp')
  const good = applyPlay(r.next, 'xp', { correct: true, made: true })
  ok('swung-true XP = 7 total, then defense', good.next.us === 7 && good.next.phase === 'defense')
  const wide = applyPlay(r.next, 'xp', { correct: true, made: false })
  ok('wide XP swing stays at 6', wide.next.us === 6 && wide.next.phase === 'defense' && wide.events[0].text.includes('wide'))
  const blocked = applyPlay(r.next, 'xp', { correct: false })
  ok('wrong answer = the XP is BLOCKED', blocked.next.us === 6 && blocked.events[0].text.includes('BLOCKED'))
}

// ---- field goals
{
  const out = { ...newGame(), ball: 61 }
  ok('56-yard kick is out of range', !fgInRange(out) && availableCalls(out).join(',') === 'run,pass')
  const edge = { ...newGame(), ball: 62 }
  ok('55-yard kick is the edge of range', fgInRange(edge) && kickDistance(edge) === 55 && availableCalls(edge).includes('fg'))
  const good = applyPlay(edge, 'fg', { correct: true, made: true })
  ok('made FG = +3, then defense', good.next.us === 3 && good.next.phase === 'defense' && kinds(good) === 'fgGood')
  const miss = applyPlay(edge, 'fg', { correct: true, made: false })
  ok('missed swing = 0, Robots ball', miss.next.us === 0 && miss.next.phase === 'defense' && kinds(miss) === 'fgMiss')
  const blocked = applyPlay(edge, 'fg', { correct: false })
  ok('wrong answer = FG blocked', blocked.next.us === 0 && blocked.events[0].text.includes('BLOCKED'))
}

// ---- the defense stand: the chase decides tackles
{
  const start = { ...newGame(), phase: 'defense', oppBall: 60, defPlays: 0, defStops: 0 }
  // two catches → punt, fresh drive, no points for them
  let r = applyPlay(start, 'tackle', { correct: true, tackled: true })
  ok('first tackle: stand continues', r.next.phase === 'defense' && r.next.defStops === 1)
  r = applyPlay(r.next, 'tackle', { correct: true, tackled: true })
  ok('two stops → they punt → your ball at the 20', kinds(r).includes('theyPunt') && kinds(r).includes('newDrive') && r.next.phase === 'offense' && r.next.ball === 20 && r.next.them === 0)
  // right answer but the runner escaped the chase = they gain anyway
  const escaped = applyPlay(start, 'tackle', { correct: true, tackled: false })
  ok('escaped runner gains 30 even on a right answer', escaped.next.oppBall === 60 - DEF_GAIN && kinds(escaped) === 'defGain')
  // one stop → they kick a field goal
  let one = applyPlay(start, 'tackle', { correct: true, tackled: true })
  one = applyPlay(one.next, 'tackle', { correct: false })
  ok('one stop → Robots field goal +3', kinds(one).includes('theyFG') && one.next.them === 3 && one.next.phase === 'offense')
  // zero stops → they march in for 7
  let zero = applyPlay(start, 'tackle', { correct: false })
  zero = applyPlay(zero.next, 'tackle', { correct: false })
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
    const d = describeCall(c, s)
    ok(`describeCall(${c})`, !!d.emoji && !!d.name && !!d.blurb)
  }
  ok('FG blurb names the kick distance', describeCall('fg', s).blurb.includes('47-yard'))
  ok('kick blurbs teach the swing', describeCall('xp', s).blurb.toLowerCase().includes('pull back'))
}

// ---- a full simulated game never corrupts state
{
  let s = newGame()
  let rand = 42
  const rnd = () => (rand = (rand * 1103515245 + 12345) % 2 ** 31) / 2 ** 31
  for (let i = 0; i < 500; i++) {
    const calls = availableCalls(s)
    const call = calls[Math.floor(rnd() * calls.length)]
    const correct = rnd() < 0.7
    const outcome = {
      correct,
      yards: Math.floor(rnd() * 110) - 5, // mini-games can report anything; the engine must clamp
      made: rnd() < 0.6,
      tackled: rnd() < 0.6,
    }
    s = applyPlay(s, call, outcome).next
    if (s.ball < 0 || s.ball > 100 || s.down < 1 || s.down > 4 || s.us < 0 || s.them < 0 || s.lineToGain > 100 || (s.phase === 'offense' && s.lineToGain <= s.ball)) {
      ok('fuzz: state stayed sane', false, JSON.stringify(s))
      break
    }
  }
  ok('500-play fuzz completed with sane state', true)
}

console.log(fail === 0 ? `football: ${pass} assertions pass` : `${fail} FAILURES (${pass} passed)`)
process.exit(fail === 0 ? 0 : 1)
