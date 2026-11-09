/**
 * 🏀🏒 Brain Ball Arena, asserted (run: node scripts/arena-test.mjs).
 * Plays thousands of possessions of both sports through the pure engine with
 * scripted "kids" and checks the game stays a GAME: every possession ends,
 * scores only move by legal amounts, nobody leaves the floor, nothing goes
 * NaN, a perfect release beats a bad one, the hot hand helps, defense matters,
 * and a kid who just answers right and plays sensibly usually wins.
 * Run after ANY change to lib/game/arena.ts.
 */
import { importTs } from './lib/ts-import.mjs'

const A = await importTs('../lib/game/arena.ts', import.meta.url)
const { newArena, startPossession, step, NO_INPUT, meterValue, releaseGrade, makeChance, HOOP, NET_TOP, W, H, SWEET, METER_PERIOD } = A

let pass = 0
let fail = 0
const ok = (name, cond, extra = '') => { if (cond) { pass++; return } fail++; console.log('✗', name, extra) }
const DT = 1 / 60
let kseed = 1
const krand = () => { kseed = (kseed * 1103515245 + 12345) % 2147483648; return kseed / 2147483648 }

// a scripted kid: on offense walks at the basket/net and shoots with a chosen release; on defense chases and swipes
function kid(a, style) {
  const b = a.ball
  const u = a.players[a.user]
  const mine = b.holder === a.user
  if (mine) {
    const goal = a.sport === 'basketball' ? HOOP : NET_TOP
    const d = Math.hypot(goal.x - u.x, goal.y - u.y)
    const near = a.sport === 'basketball' ? style.shootFrom : 70
    if (d > near) return { dx: (goal.x - u.x) / d, dy: (goal.y - u.y) / d, a: false, b: false, bUp: false }
    // hold B until the meter reaches the target value, then let go
    if (!a.meter.charging) return { ...NO_INPUT, b: true }
    const m = meterValue(a.meter.t)
    const rising = (a.meter.t / METER_PERIOD) % 2 < 1
    if (rising && m >= style.release) return { ...NO_INPUT, bUp: true }
    return { ...NO_INPUT, b: true }
  }
  if (style.defend && b.holder >= 0 && a.players[b.holder].team === 1) {
    const h = a.players[b.holder]
    const d = Math.hypot(h.x - u.x, h.y - u.y) || 1
    const swipe = d < 10 && a.stealCd <= 0 && krand() < 0.08
    return { dx: (h.x - u.x) / d, dy: (h.y - u.y) / d, a: false, b: false, bUp: swipe }
  }
  if (b.holder < 0) {
    const d = Math.hypot(b.x - u.x, b.y - u.y) || 1
    return { dx: (b.x - u.x) / d, dy: (b.y - u.y) / d, a: false, b: false, bUp: false }
  }
  return NO_INPUT
}

function play(sport, n, { ours, hot, style, seed = 7 }) {
  kseed = seed
  const a = newArena(sport, seed)
  let maxT = 0, bad = 0, outOfBounds = 0, illegal = 0
  const reasons = {}
  for (let k = 0; k < n; k++) {
    startPossession(a, typeof ours === 'function' ? ours(k) : ours, hot)
    const before = [...a.score]
    let t = 0
    while (!(a.over && a.over.wait <= 0)) {
      step(a, style ? kid(a, style) : NO_INPUT, DT)
      t += DT
      for (const p of a.players) {
        if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) bad++
        if (p.x < 0 || p.x > W || p.y < 0 || p.y > H) outOfBounds++
      }
      if (!Number.isFinite(a.ball.x) || !Number.isFinite(a.ball.y)) bad++
      if (t > 40) { if (process.env.DBG) console.log('STUCK', sport, 'clock', a.clock.toFixed(1), 'holder', a.ball.holder, 'user', a.user, 'flight', JSON.stringify(a.ball.flight), 'ball', a.ball.x.toFixed(0), a.ball.y.toFixed(0), a.ball.z.toFixed(1), 'meter', JSON.stringify(a.meter), 'over', JSON.stringify(a.over), 't', a.t.toFixed(1)); break }
    }
    maxT = Math.max(maxT, t)
    reasons[a.over?.reason ?? 'stuck'] = (reasons[a.over?.reason ?? 'stuck'] ?? 0) + 1
    const d0 = a.score[0] - before[0], d1 = a.score[1] - before[1]
    const legal = sport === 'basketball' ? [0, 2, 3] : [0, 1]
    if (!legal.includes(d0) || !legal.includes(d1) || (d0 && d1)) illegal++
  }
  return { a, maxT, bad, outOfBounds, illegal, reasons }
}

// ---- the meter
ok('meter ping-pongs 0→1→0', meterValue(0) === 0 && Math.abs(meterValue(METER_PERIOD) - 1) < 1e-9 && Math.abs(meterValue(METER_PERIOD * 2)) < 1e-9)
ok('release grades', releaseGrade(SWEET, false) === 'perfect' && releaseGrade(0.2, false) === 'bad' && releaseGrade(SWEET + 0.08, true) === 'perfect' && releaseGrade(SWEET + 0.08, false) !== 'perfect')
ok('make chance: perfect > good > bad, layup > three, hot helps, contest hurts', makeChance(50, 'perfect', 30, false, false) > makeChance(50, 'good', 30, false, false) && makeChance(50, 'good', 30, false, false) > makeChance(50, 'bad', 30, false, false)
  && makeChance(15, 'good', 30, false, false) > makeChance(80, 'good', 30, false, false) && makeChance(50, 'good', 30, true, false) > makeChance(50, 'good', 30, false, false) && makeChance(50, 'good', 5, false, false) < makeChance(50, 'good', 30, false, false))

for (const sport of ['basketball', 'hockey']) {
  // ---- every possession ends, legally, on the floor
  const robots = play(sport, 400, { ours: false, hot: false, style: null })
  ok(`${sport}: every Robots possession ends`, !robots.reasons.stuck, JSON.stringify(robots.reasons))
  ok(`${sport}: nothing NaN, nobody off the floor`, robots.bad === 0 && robots.outOfBounds === 0, `${robots.bad}/${robots.outOfBounds}`)
  ok(`${sport}: scores only move legally`, robots.illegal === 0, String(robots.illegal))
  ok(`${sport}: no possession runs forever`, robots.maxT < 26, robots.maxT.toFixed(1))

  const perfect = play(sport, 400, { ours: true, hot: true, style: { shootFrom: 40, release: SWEET - 0.03, defend: true } })
  const sloppy = play(sport, 400, { ours: true, hot: false, style: { shootFrom: 40, release: 0.25, defend: true } })
  ok(`${sport}: our possessions end too`, !perfect.reasons.stuck && !sloppy.reasons.stuck, JSON.stringify(perfect.reasons) + JSON.stringify(sloppy.reasons))
  ok(`${sport}: none of ours runs forever either`, perfect.maxT < 26 && sloppy.maxT < 26, `${perfect.maxT.toFixed(1)}/${sloppy.maxT.toFixed(1)}`)
  ok(`${sport}: our scoring is legal`, perfect.illegal === 0 && sloppy.illegal === 0)
  const pp = perfect.a.score[0] / 400, sp = sloppy.a.score[0] / 400
  ok(`${sport}: a good release + hot hand scores more than a sloppy one`, pp > sp * 1.3, `${pp.toFixed(2)} vs ${sp.toFixed(2)}`)
  ok(`${sport}: a good shooter actually scores`, sport === 'basketball' ? pp > 0.9 : pp > 0.25, pp.toFixed(2))

  // ---- defense matters: a kid who chases and swipes gives up less than one who stands still
  const still = play(sport, 400, { ours: false, hot: false, style: null, seed: 11 })
  const active = play(sport, 400, { ours: false, hot: false, style: { shootFrom: 40, release: SWEET, defend: true }, seed: 11 })
  const ps = still.a.score[1] / 400, pa = active.a.score[1] / 400
  ok(`${sport}: playing defense gives up less`, pa < ps, `${pa.toFixed(2)} vs ${ps.toFixed(2)}`)
  ok(`${sport}: the Robots are beatable (not a wall, not a pushover)`, sport === 'basketball' ? ps > 0.3 && ps < 1.4 : ps > 0.05 && ps < 0.6, ps.toFixed(2))

  // ---- a whole kid-like game: 7 of 10 right, decent shooting, some defense — usually a win
  let wins = 0, games = 60
  for (let g = 0; g < games; g++) {
    const r = play(sport, 10, { ours: (k) => (k * 7 + g) % 10 < 7, hot: true, style: { shootFrom: 45, release: SWEET - 0.05, defend: true }, seed: 100 + g })
    if (r.a.score[0] > r.a.score[1]) wins++
  }
  ok(`${sport}: a kid who knows 7 of 10 usually wins`, wins / games > 0.6, `${wins}/${games}`)
}


// ---- review pass (Nov 9): a hockey shot taken at the horn gets to reach the net
{
  const a = newArena('hockey', 5)
  startPossession(a, true, true)
  const u = a.players[0]
  u.x = 96; u.y = 70; u.face = -Math.PI / 2
  a.ball.holder = 0
  a.clock = 0.05
  step(a, { ...NO_INPUT, b: true }, DT)
  step(a, { ...NO_INPUT, bUp: true }, DT)
  let cutWhileSliding = false
  for (let i = 0; i < 120 && !a.over; i++) { step(a, NO_INPUT, DT); if (a.over && a.over.reason === 'whistle' && a.ball.shot) cutWhileSliding = true }
  ok('a shot at the horn is never whistled dead while it slides', !cutWhileSliding && !!a.over && a.over.reason !== 'whistle' || (a.over?.reason === 'whistle' && !a.ball.shot), a.over?.reason)
}

// ---- determinism: same seed, same game
{
  const run = () => { const r = play('hockey', 30, { ours: (k) => k % 2 === 0, hot: true, style: { shootFrom: 40, release: SWEET, defend: true }, seed: 42 }); return r.a.score.join('-') }
  ok('same seed, same game', run() === run())
}

console.log(fail === 0 ? `arena: ${pass} assertions pass` : `${fail} FAILURES (${pass} passed)`)
process.exit(fail === 0 ? 0 : 1)
