/**
 * 🏀🏒 Brain Ball Arena — pure engine for the 3-on-3 sports modes.
 *
 * Brian, Nov 9: "Add in basketball and hockey option with shooting passing
 * etc. Needs to be more of a real game vs arcade game. Think super Nintendo."
 *
 * Each question is a possession (hoops) or a faceoff (hockey). A right answer
 * gives the Whalehogs the ball WITH a hot hand (a wider sweet spot on the
 * shot meter); a wrong one gives it to the Robots and the kid plays live
 * defense. Then it is a real little game: dribble or skate with the D-pad,
 * A passes, hold B for the shot meter and let go in the green, B on defense
 * swipes / checks. Teammates and Robots run plays on their own.
 *
 * Everything is in low-res "SNES pixels" (W×H) — the page draws it 1:1 into
 * a 192×240 canvas scaled up with no smoothing. `step()` mutates the arena
 * (fixed time step from the page), pushes events the page turns into sound,
 * announcer lines and score bugs, and sets `over` when the possession ends.
 * Deterministic for a seed: `scripts/arena-test.mjs` (run it after ANY
 * change here) plays thousands of possessions to keep it fair and finite.
 */

export type Sport = 'basketball' | 'hockey'
export const W = 192
export const H = 240

export interface Player {
  team: 0 | 1
  x: number
  y: number
  vx: number
  vy: number
  /** facing, radians (0 = right, -π/2 = up the screen) */
  face: number
  goalie: boolean
  /** a reach / a missed check: frozen this long */
  stun: number
  /** stride counter for the 2-frame walk / skate animation */
  anim: number
  /** off-ball spot this player drifts toward */
  spotX: number
  spotY: number
  /** the opponent this player guards on defense */
  mark: number
}

export interface Flight {
  kind: 'shot' | 'pass'
  t: number
  dur: number
  sx: number
  sy: number
  tx: number
  ty: number
  peak: number
  /** shots: decided at release */
  make?: boolean
  points?: number
  /** passes: the receiver */
  to?: number
  team: 0 | 1
  /** passes: opponents that already had their one try at it */
  tried?: number[]
}

export interface Ball {
  /** index of the player holding it, -1 = loose or in the air */
  holder: number
  x: number
  y: number
  z: number
  vx: number
  vy: number
  vz: number
  flight: Flight | null
  /** nobody from this team may pick it up for `noPickT` (a fresh pass/shot) */
  noPickTeam: 0 | 1 | -1
  noPickT: number
  /** hockey: a puck that is a SHOT (not a dribbler) until it slows down */
  shot?: { grade: 'perfect' | 'good' | 'bad'; team: 0 | 1 }
}

export type EventKind =
  | 'score' | 'miss' | 'swish' | 'rim' | 'steal' | 'stealMiss' | 'block' | 'save' | 'freeze'
  | 'pass' | 'intercept' | 'rebound' | 'turnover' | 'shotclock' | 'whistle' | 'check' | 'post' | 'perfect'

export interface ArenaEvent {
  kind: EventKind
  team: 0 | 1
  points?: number
  /** short words for the floating text */
  text: string
  /** announcer line, when it deserves one */
  say?: string
  x: number
  y: number
}

export interface Arena {
  sport: Sport
  players: Player[]
  ball: Ball
  /** which team started with it (hoops: the only team that can score this trip) */
  offense: 0 | 1
  /** seconds left on the shot clock (hoops) / in the shift (hockey) */
  clock: number
  score: [number, number]
  /** the player the kid controls */
  user: number
  /** a wider sweet spot — the reward for the right answer */
  hot: boolean
  meter: { charging: boolean; t: number }
  /** possession over: why, and a short pause before the page moves on */
  over: null | { reason: string; scored: 0 | 1 | -1; wait: number }
  events: ArenaEvent[]
  t: number
  seed: number
  /** robot decisions get a moment of thought, not a frame */
  aiT: number
  stealCd: number
  /** seconds this possession has run — a hard cap keeps every question's play short */
  age: number
}

export interface Input {
  /** D-pad, each -1..1 */
  dx: number
  dy: number
  /** A tapped this step (pass / switch player on defense) */
  a: boolean
  /** B is held (shot meter) */
  b: boolean
  /** B was released this step (shoot) / tapped on defense (steal / check) */
  bUp: boolean
}

export const NO_INPUT: Input = { dx: 0, dy: 0, a: false, b: false, bUp: false }

// ---------------------------------------------------------------- geometry
/** hoops: the rim (both teams shoot at it — half court) */
export const HOOP = { x: 96, y: 30 }
export const THREE_R = 72
/** hockey: the Whalehogs attack the top net, the Robots the bottom one */
export const NET_TOP = { x: 96, y: 20 }
export const NET_BOT = { x: 96, y: 220 }
export const NET_HALF = 13
export const RINK = { x0: 8, x1: 184, y0: 10, y1: 230 }
export const COURT = { x0: 6, x1: 186, y0: 14, y1: 236 }

/** no single question's play runs longer than this */
export const MAX_POSSESSION = 22

/** hoops: the meter's green zone — centre and width (hot hand widens it) */
export const SWEET = 0.8
export const sweetWidth = (hot: boolean) => (hot ? 0.2 : 0.11)
/** one trip up and back takes this long */
export const METER_PERIOD = 1.1
export function meterValue(t: number): number {
  const p = (t / METER_PERIOD) % 2
  return p <= 1 ? p : 2 - p
}
/** 'perfect' in the green, 'good' near it, 'bad' otherwise */
export function releaseGrade(m: number, hot: boolean): 'perfect' | 'good' | 'bad' {
  const d = Math.abs(m - SWEET)
  const w = sweetWidth(hot) / 2
  return d <= w ? 'perfect' : d <= w * 2.2 ? 'good' : 'bad'
}

const dist = (ax: number, ay: number, bx: number, by: number) => Math.hypot(ax - bx, ay - by)
const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v)

function rand(a: Arena): number {
  // mulberry32 — deterministic per arena
  let t = (a.seed = (a.seed + 0x6d2b79f5) | 0)
  t = Math.imul(t ^ (t >>> 15), t | 1)
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}

function mkPlayer(team: 0 | 1, x: number, y: number, goalie = false): Player {
  return { team, x, y, vx: 0, vy: 0, face: team === 0 ? -Math.PI / 2 : Math.PI / 2, goalie, stun: 0, anim: 0, spotX: x, spotY: y, mark: -1 }
}

export function newArena(sport: Sport, seed = 1): Arena {
  const players: Player[] = []
  // indices: 0..2 Whalehogs skaters, 3..5 Robots skaters, (hockey) 6 our goalie, 7 their goalie
  for (let i = 0; i < 3; i++) players.push(mkPlayer(0, 50 + i * 46, 160))
  for (let i = 0; i < 3; i++) players.push(mkPlayer(1, 50 + i * 46, 80))
  if (sport === 'hockey') {
    players.push(mkPlayer(0, NET_BOT.x, NET_BOT.y - 8, true))
    players.push(mkPlayer(1, NET_TOP.x, NET_TOP.y + 8, true))
  }
  for (let i = 0; i < 3; i++) {
    players[i].mark = 3 + i
    players[3 + i].mark = i
  }
  return {
    sport, players,
    ball: { holder: -1, x: W / 2, y: H / 2, z: 0, vx: 0, vy: 0, vz: 0, flight: null, noPickTeam: -1, noPickT: 0 },
    offense: 0, clock: 0, score: [0, 0], user: 0, hot: false,
    meter: { charging: false, t: 0 }, over: null, events: [], t: 0, seed: seed | 0 || 1, aiT: 0, stealCd: 0, age: 0,
  }
}

const skaters = (a: Arena, team: 0 | 1) => a.players.map((p, i) => ({ p, i })).filter((o) => o.p.team === team && !o.p.goalie)

/** Start a possession (hoops) / a faceoff (hockey). `ours` = the right answer. */
export function startPossession(a: Arena, ours: boolean, hot: boolean): void {
  const off: 0 | 1 = ours ? 0 : 1
  a.offense = off
  a.hot = ours && hot
  a.over = null
  a.events = []
  a.meter = { charging: false, t: 0 }
  a.stealCd = 0
  a.age = 0
  a.aiT = 0.6
  const b = a.ball
  b.flight = null
  b.z = 0
  b.vx = b.vy = b.vz = 0
  b.noPickTeam = -1
  b.noPickT = 0
  for (const p of a.players) {
    p.vx = p.vy = 0
    p.stun = 0
  }
  if (a.sport === 'basketball') {
    a.clock = ours ? 14 : 12
    // offense: point at the top of the arc, two wings; defense sagging toward the rim
    const spots = [[96, 196], [36, 120], [156, 120]]
    const offIdx = off === 0 ? [0, 1, 2] : [3, 4, 5]
    const defIdx = off === 0 ? [3, 4, 5] : [0, 1, 2]
    offIdx.forEach((pi, k) => {
      const p = a.players[pi]
      p.x = spots[k][0]; p.y = spots[k][1]; p.spotX = p.x; p.spotY = p.y
      p.face = -Math.PI / 2
      p.mark = defIdx[k]
    })
    defIdx.forEach((pi, k) => {
      const p = a.players[pi]
      const m = a.players[offIdx[k]]
      p.mark = offIdx[k]
      const g = guardSpot(m.x, m.y, HOOP.x, HOOP.y, 16)
      p.x = g.x; p.y = g.y
      p.face = Math.PI / 2
    })
    b.holder = offIdx[0]
    // the kid starts on the ball — or on the man guarding it
    a.user = 0
  } else {
    a.clock = 16
    // faceoff at centre: centres at the dot, wingers wide, goalies home
    const c = { x: W / 2, y: H / 2 }
    const ourSpots = [[c.x, c.y + 7], [c.x - 48, c.y + 20], [c.x + 48, c.y + 20]]
    const theirSpots = [[c.x, c.y - 7], [c.x - 48, c.y - 20], [c.x + 48, c.y - 20]]
    for (let k = 0; k < 3; k++) {
      const u = a.players[k], r = a.players[3 + k]
      u.x = ourSpots[k][0]; u.y = ourSpots[k][1]; u.face = -Math.PI / 2
      r.x = theirSpots[k][0]; r.y = theirSpots[k][1]; r.face = Math.PI / 2
      u.mark = 3 + k; r.mark = k
    }
    const g0 = a.players[6], g1 = a.players[7]
    g0.x = NET_BOT.x; g0.y = NET_BOT.y - 8
    g1.x = NET_TOP.x; g1.y = NET_TOP.y + 8
    // the faceoff winner draws it back to a winger
    b.holder = ours ? 0 : 3
    a.user = 0
  }
  placeOnHolder(a)
}

function guardSpot(mx: number, my: number, gx: number, gy: number, off: number) {
  const d = dist(mx, my, gx, gy) || 1
  return { x: mx + ((gx - mx) / d) * off, y: my + ((gy - my) / d) * off }
}

function placeOnHolder(a: Arena) {
  const b = a.ball
  if (b.holder < 0) return
  const p = a.players[b.holder]
  const reach = a.sport === 'hockey' ? 7 : 5
  b.x = p.x + Math.cos(p.face) * reach
  b.y = p.y + Math.sin(p.face) * reach + (a.sport === 'basketball' ? 2 : 3)
  b.z = a.sport === 'basketball' ? 3 + Math.abs(Math.sin(a.t * 9)) * 4 : 0
}

function emit(a: Arena, e: ArenaEvent) {
  a.events.push(e)
}

function endPossession(a: Arena, reason: string, scored: 0 | 1 | -1, wait = 1.4) {
  if (a.over) return
  a.over = { reason, scored, wait }
  a.meter.charging = false
}

// ---------------------------------------------------------------- movement
const SPEED = { basketball: { user: 62, ai: 50, robot: 47 }, hockey: { user: 86, ai: 74, robot: 70 } }

function steer(a: Arena, p: Player, tx: number, ty: number, speed: number, dt: number) {
  const dx = tx - p.x, dy = ty - p.y
  const d = Math.hypot(dx, dy)
  const want = d < 2 ? 0 : speed * Math.min(1, d / 14)
  const ux = d ? dx / d : 0, uy = d ? dy / d : 0
  drive(a, p, ux * want, uy * want, dt)
}

/** hoops: you go where you point; hockey: you glide — acceleration + friction */
function drive(a: Arena, p: Player, wantVx: number, wantVy: number, dt: number) {
  if (a.sport === 'basketball') {
    const k = Math.min(1, dt * 14)
    p.vx += (wantVx - p.vx) * k
    p.vy += (wantVy - p.vy) * k
  } else {
    const k = Math.min(1, dt * 3.2)
    p.vx += (wantVx - p.vx) * k
    p.vy += (wantVy - p.vy) * k
  }
  if (Math.hypot(wantVx, wantVy) > 4) p.face = Math.atan2(wantVy, wantVx)
}

function integrate(a: Arena, p: Player, dt: number) {
  p.x += p.vx * dt
  p.y += p.vy * dt
  const sp = Math.hypot(p.vx, p.vy)
  p.anim += sp * dt * 0.25
  if (a.sport === 'basketball') {
    p.x = clamp(p.x, COURT.x0, COURT.x1)
    p.y = clamp(p.y, COURT.y0 + 4, COURT.y1)
    // nobody stands under the backboard
    if (p.y < HOOP.y + 4 && Math.abs(p.x - HOOP.x) < 12) p.y = HOOP.y + 4
  } else {
    if (p.goalie) return
    if (p.x < RINK.x0 + 3) { p.x = RINK.x0 + 3; p.vx = Math.abs(p.vx) * 0.3 }
    if (p.x > RINK.x1 - 3) { p.x = RINK.x1 - 3; p.vx = -Math.abs(p.vx) * 0.3 }
    if (p.y < RINK.y0 + 4) { p.y = RINK.y0 + 4; p.vy = Math.abs(p.vy) * 0.3 }
    if (p.y > RINK.y1 - 4) { p.y = RINK.y1 - 4; p.vy = -Math.abs(p.vy) * 0.3 }
  }
}

/** no two bodies in one spot — a soft push apart */
function separate(a: Arena) {
  const ps = a.players
  for (let i = 0; i < ps.length; i++) for (let j = i + 1; j < ps.length; j++) {
    const p = ps[i], q = ps[j]
    if (p.goalie || q.goalie) continue
    const d = dist(p.x, p.y, q.x, q.y)
    if (d > 0 && d < 7) {
      const push = (7 - d) / 2
      const ux = (p.x - q.x) / d, uy = (p.y - q.y) / d
      p.x += ux * push; p.y += uy * push
      q.x -= ux * push; q.y -= uy * push
    }
  }
}

// ---------------------------------------------------------------- actions
/** the teammate the passer is looking at (or the most open one) */
export function passTarget(a: Arena, from: number, dx = 0, dy = 0): number {
  const p = a.players[from]
  const aimX = dx || dy ? dx : Math.cos(p.face), aimY = dx || dy ? dy : Math.sin(p.face)
  let best = -1, bestS = -Infinity
  for (const { p: q, i } of skaters(a, p.team)) {
    if (i === from) continue
    const d = dist(p.x, p.y, q.x, q.y) || 1
    const dot = ((q.x - p.x) * aimX + (q.y - p.y) * aimY) / d
    const open = Math.min(...a.players.filter((o) => o.team !== p.team && !o.goalie).map((o) => dist(o.x, o.y, q.x, q.y)))
    const s = dot * 2 + open / 30 - d / 200
    if (s > bestS) { bestS = s; best = i }
  }
  return best
}

function doPass(a: Arena, from: number, to: number) {
  const b = a.ball
  const p = a.players[from], q = a.players[to]
  // lead the receiver a touch
  const tx = q.x + q.vx * 0.2, ty = q.y + q.vy * 0.2
  const d = dist(b.x, b.y, tx, ty)
  const speed = a.sport === 'hockey' ? 190 : 170
  b.holder = -1
  b.shot = undefined
  b.flight = { kind: 'pass', t: 0, dur: Math.max(0.15, d / speed), sx: b.x, sy: b.y, tx, ty, peak: a.sport === 'hockey' ? 0 : 6 + d * 0.05, to, team: p.team, tried: [] }
  b.noPickTeam = p.team
  b.noPickT = 0.12
  p.face = Math.atan2(ty - p.y, tx - p.x)
  emit(a, { kind: 'pass', team: p.team, text: '', x: p.x, y: p.y })
}

/** hoops make probability — distance, the release, the closest hand, the hot hand */
export function makeChance(d: number, grade: 'perfect' | 'good' | 'bad', contest: number, hot: boolean, robot: boolean): number {
  let base = d < 22 ? 0.78 : d < THREE_R ? 0.55 : d < 105 ? 0.4 : 0.12
  if (grade === 'perfect') base += 0.3
  else if (grade === 'bad') base -= 0.32
  if (contest < 10) base -= 0.22
  else if (contest < 16) base -= 0.1
  if (hot) base += 0.07
  if (robot) base *= 0.65
  return clamp(base, 0.04, 0.95)
}

function shoot(a: Arena, shooter: number, grade: 'perfect' | 'good' | 'bad', aimDx = 0) {
  const b = a.ball
  const p = a.players[shooter]
  const robot = p.team === 1
  const contest = Math.min(...a.players.filter((o) => o.team !== p.team && !o.goalie).map((o) => dist(o.x, o.y, p.x, p.y)))
  if (grade === 'perfect' && !robot) emit(a, { kind: 'perfect', team: 0, text: 'PERFECT!', x: p.x, y: p.y - 12 })
  b.holder = -1
  b.noPickTeam = p.team
  b.noPickT = 0.25
  if (a.sport === 'basketball') {
    const d = dist(p.x, p.y, HOOP.x, HOOP.y)
    // a hand right in the face can swat it
    if (contest < 9 && rand(a) < (robot ? 0.22 : 0.12)) {
      const blocker = a.players.find((o) => o.team !== p.team && !o.goalie && dist(o.x, o.y, p.x, p.y) === contest)
      b.vx = (rand(a) - 0.5) * 80; b.vy = 40 + rand(a) * 30; b.vz = 30; b.z = 12
      emit(a, { kind: 'block', team: blocker ? blocker.team : (robot ? 0 : 1), text: 'BLOCKED!', say: robot ? 'Blocked by the Whalehogs!' : 'Blocked!', x: p.x, y: p.y - 10 })
      return
    }
    const make = rand(a) < makeChance(d, grade, contest, a.hot && !robot, robot)
    const points = d >= THREE_R ? 3 : 2
    b.flight = { kind: 'shot', t: 0, dur: 0.55 + d / 260, sx: b.x, sy: b.y, tx: HOOP.x, ty: HOOP.y, peak: 26 + d * 0.22, make, points, team: p.team }
    p.face = Math.atan2(HOOP.y - p.y, HOOP.x - p.x)
  } else {
    // hockey: the puck slides at the net; the goalie gets a say when it arrives
    const net = robot ? NET_BOT : NET_TOP
    const g = a.players[robot ? 6 : 7]
    // aim away from the goalie unless the kid steered it
    const side = aimDx !== 0 ? Math.sign(aimDx) : g.x > net.x ? -1 : 1
    const tx = net.x + side * (NET_HALF - 3) * (grade === 'bad' ? 1.6 : 1)
    const ty = net.y
    const speed = (grade === 'perfect' ? 260 : grade === 'good' ? 210 : 160) * (robot ? 0.8 : 1)
    const d = dist(b.x, b.y, tx, ty) || 1
    b.vx = ((tx - b.x) / d) * speed
    b.vy = ((ty - b.y) / d) * speed
    b.z = 0
    b.shot = { grade, team: p.team }
    p.face = Math.atan2(ty - p.y, tx - p.x)
  }
}

// ---------------------------------------------------------------- the step
export function step(a: Arena, input: Input, dt: number): void {
  a.events = []
  a.t += dt
  if (a.over) {
    a.over.wait -= dt
    // the ball keeps rolling for the celebration
    stepLoose(a, dt, true)
    for (const p of a.players) { p.vx *= 0.9; p.vy *= 0.9; integrate(a, p, dt) }
    return
  }
  a.clock -= dt
  a.age += dt
  a.stealCd = Math.max(0, a.stealCd - dt)
  const b = a.ball
  b.noPickT = Math.max(0, b.noPickT - dt)

  // who the kid steers: the ball carrier on our side, else the nearest Whalehog to the ball
  if (b.holder >= 0 && a.players[b.holder].team === 0) a.user = b.holder
  else {
    const near = nearestOf(a, 0, b.x, b.y)
    if (near >= 0 && near !== a.user && dist(a.players[near].x, a.players[near].y, b.x, b.y) + 22 < dist(a.players[a.user].x, a.players[a.user].y, b.x, b.y)) a.user = near
    if (input.a) a.user = near >= 0 ? near : a.user
  }

  // ---- the kid's player
  const u = a.players[a.user]
  u.stun = Math.max(0, u.stun - dt)
  const mag = Math.hypot(input.dx, input.dy)
  const sp = SPEED[a.sport].user * (a.hot ? 1.06 : 1)
  if (u.stun > 0) drive(a, u, 0, 0, dt)
  else if (a.meter.charging && a.sport === 'basketball') drive(a, u, 0, 0, dt) // set your feet to shoot
  else drive(a, u, mag ? (input.dx / mag) * sp : 0, mag ? (input.dy / mag) * sp : 0, dt)

  if (b.holder === a.user) {
    if (input.a) {
      const to = passTarget(a, a.user, input.dx, input.dy)
      if (to >= 0) doPass(a, a.user, to)
    } else if (input.b) {
      a.meter.charging = true
      a.meter.t += dt
    } else if (input.bUp || (a.meter.charging && !input.b)) {
      if (a.meter.charging) {
        const grade = releaseGrade(meterValue(a.meter.t), a.hot)
        a.meter = { charging: false, t: 0 }
        shoot(a, a.user, grade, input.dx)
      }
    }
  } else {
    a.meter = { charging: false, t: 0 }
    if (input.bUp && b.holder >= 0 && a.players[b.holder].team === 1 && a.stealCd <= 0) {
      const h = a.players[b.holder]
      a.stealCd = 0.7
      if (dist(u.x, u.y, h.x, h.y) < (a.sport === 'hockey' ? 13 : 12)) {
        const chance = a.sport === 'hockey' ? 0.55 : 0.36
        if (rand(a) < chance) {
          if (a.sport === 'hockey') {
            // a check knocks it loose
            b.holder = -1
            b.vx = (b.x - u.x) * 6 + (rand(a) - 0.5) * 40
            b.vy = (b.y - u.y) * 6 + (rand(a) - 0.5) * 40
            h.stun = 0.7
            emit(a, { kind: 'check', team: 0, text: 'BIG CHECK!', say: 'What a check!', x: h.x, y: h.y - 10 })
          } else {
            b.holder = a.user
            emit(a, { kind: 'steal', team: 0, text: 'STEAL!', say: 'Stolen by the Whalehogs!', x: u.x, y: u.y - 10 })
            endPossession(a, 'steal', -1, 1.2)
          }
        } else {
          u.stun = 0.35
          emit(a, { kind: 'stealMiss', team: 0, text: 'reach!', x: u.x, y: u.y - 10 })
        }
      }
    }
  }

  // ---- everyone else
  a.aiT -= dt
  const think = a.aiT <= 0
  if (think) a.aiT = 0.25 + rand(a) * 0.2
  for (let i = 0; i < a.players.length; i++) {
    if (i === a.user) continue
    const p = a.players[i]
    p.stun = Math.max(0, p.stun - dt)
    if (p.stun > 0) { drive(a, p, 0, 0, dt); continue }
    if (p.goalie) { goalieAI(a, p, dt); continue }
    if (b.holder === i) carrierAI(a, i, dt, think)
    else offBallAI(a, i, dt)
  }
  for (const p of a.players) integrate(a, p, dt)
  separate(a)

  // ---- the ball
  if (b.holder >= 0) placeOnHolder(a)
  else if (b.flight) stepFlight(a, dt)
  else stepLoose(a, dt, false)

  // AI pressure on the kid's ball (gentle — this is a kids' game)
  if (b.holder >= 0 && a.players[b.holder].team === 0 && !a.over) {
    const h = a.players[b.holder]
    for (const { p } of skaters(a, 1)) {
      if (dist(p.x, p.y, h.x, h.y) < 9 && rand(a) < dt * (a.sport === 'hockey' ? 0.2 : 0.04)) {
        if (a.sport === 'hockey') {
          b.holder = -1
          b.vx = (rand(a) - 0.5) * 70; b.vy = (rand(a) - 0.5) * 70
          h.stun = 0.5
          emit(a, { kind: 'check', team: 1, text: 'Checked!', x: h.x, y: h.y - 10 })
        } else {
          b.holder = a.players.indexOf(p)
          emit(a, { kind: 'steal', team: 1, text: 'Stolen!', say: 'The Robots stole it!', x: h.x, y: h.y - 10 })
          endPossession(a, 'stolen', -1, 1.3)
        }
        break
      }
    }
  }

  // ---- clocks
  if (!a.over && a.age > MAX_POSSESSION && !b.flight && !b.shot) {
    emit(a, { kind: 'whistle', team: a.offense, text: 'WHISTLE!', x: W / 2, y: H / 2 })
    endPossession(a, 'whistle', -1, 1)
    return
  }
  if (!a.over && a.clock <= 0) {
    if (a.sport === 'basketball' && b.flight?.kind === 'shot') return // the shot beat the buzzer
    if (a.sport === 'hockey' && b.shot) return // a shot still sliding at the net gets its chance
    if (a.sport === 'basketball') {
      emit(a, { kind: 'shotclock', team: a.offense, text: 'SHOT CLOCK!', say: a.offense === 0 ? 'Shot clock! Shoot faster next time!' : 'Shot clock violation on the Robots!', x: W / 2, y: H / 2 })
      endPossession(a, 'shotclock', -1)
    } else {
      emit(a, { kind: 'whistle', team: 0, text: 'LINE CHANGE!', x: W / 2, y: H / 2 })
      endPossession(a, 'whistle', -1, 1)
    }
  }
}

function nearestOf(a: Arena, team: 0 | 1, x: number, y: number): number {
  let best = -1, bd = Infinity
  a.players.forEach((p, i) => {
    if (p.team !== team || p.goalie) return
    const d = dist(p.x, p.y, x, y)
    if (d < bd) { bd = d; best = i }
  })
  return best
}

function carrierAI(a: Arena, i: number, dt: number, think: boolean) {
  const p = a.players[i]
  const robot = p.team === 1
  const sp = robot ? SPEED[a.sport].robot : SPEED[a.sport].ai
  if (a.sport === 'basketball') {
    const d = dist(p.x, p.y, HOOP.x, HOOP.y)
    const contest = Math.min(...a.players.filter((o) => o.team !== p.team).map((o) => dist(o.x, o.y, p.x, p.y)))
    if (think) {
      const late = a.clock < 3.5
      if ((d < 80 && contest > 14 && rand(a) < 0.45) || (d < 26 && rand(a) < 0.7) || late) {
        const r = rand(a)
        shoot(a, i, r < 0.3 ? 'perfect' : r < 0.75 ? 'good' : 'bad')
        return
      }
      if (contest < 10 && rand(a) < 0.35) {
        const to = passTarget(a, i)
        if (to >= 0) { doPass(a, i, to); return }
      }
    }
    // drive at the rim with a little wiggle
    const wig = Math.sin(a.t * 2 + i) * 22
    steer(a, p, HOOP.x + wig, HOOP.y + 20, sp, dt)
  } else {
    const net = robot ? NET_BOT : NET_TOP
    const d = dist(p.x, p.y, net.x, net.y)
    if (think) {
      if ((d < 78 && rand(a) < 0.5) || a.clock < 2) {
        const r = rand(a)
        shoot(a, i, r < 0.2 ? 'perfect' : r < 0.7 ? 'good' : 'bad')
        return
      }
      const press = Math.min(...a.players.filter((o) => o.team !== p.team && !o.goalie).map((o) => dist(o.x, o.y, p.x, p.y)))
      if (press < 12 && rand(a) < 0.35) {
        const to = passTarget(a, i)
        if (to >= 0) { doPass(a, i, to); return }
      }
    }
    steer(a, p, net.x + Math.sin(a.t * 1.3 + i) * 30, net.y + (robot ? -40 : 40), sp, dt)
  }
}

function offBallAI(a: Arena, i: number, dt: number) {
  const p = a.players[i]
  const b = a.ball
  const robot = p.team === 1
  const sp = robot ? SPEED[a.sport].robot : SPEED[a.sport].ai
  const holderTeam = b.holder >= 0 ? a.players[b.holder].team : -1
  // a loose ball: the nearest two on each team go get it
  if (b.holder < 0 && !b.flight) {
    const mine = skaters(a, p.team).map((o) => ({ i: o.i, d: dist(o.p.x, o.p.y, b.x, b.y) })).sort((x, y) => x.d - y.d)
    if (mine.slice(0, 2).some((o) => o.i === i)) { steer(a, p, b.x, b.y, sp * 1.05, dt); return }
  }
  if (b.flight?.kind === 'pass' && b.flight.to === i) { steer(a, p, b.flight.tx, b.flight.ty, sp, dt); return }
  const attacking = holderTeam === p.team || (holderTeam === -1 && b.flight?.team === p.team)
  if (attacking) {
    // get open: drift around a spot
    if (a.sport === 'basketball') {
      const k = i % 3
      const spots = [[96, 150], [40, 104], [152, 104]]
      const s = spots[k]
      steer(a, p, s[0] + Math.sin(a.t * 0.9 + i) * 26, s[1] + Math.cos(a.t * 0.7 + i) * 18, sp * 0.8, dt)
    } else {
      const up = p.team === 0 ? -1 : 1
      const carrier = b.holder >= 0 ? a.players[b.holder] : null
      const lane = (i % 3) - 1
      const tx = W / 2 + lane * 52
      const ty = (carrier ? carrier.y : H / 2) + up * 26
      steer(a, p, tx, clamp(ty, RINK.y0 + 30, RINK.y1 - 30), sp * 0.9, dt)
    }
  } else {
    // defend: man to man, between your man and the basket / your net
    const m = a.players[p.mark]
    if (!m) return
    const goal = a.sport === 'basketball' ? HOOP : p.team === 0 ? NET_BOT : NET_TOP
    const g = guardSpot(m.x, m.y, goal.x, goal.y, b.holder === p.mark ? 9 : 16)
    steer(a, p, g.x, g.y, sp, dt)
  }
}

function goalieAI(a: Arena, g: Player, dt: number) {
  const net = g.team === 0 ? NET_BOT : NET_TOP
  const b = a.ball
  const tx = clamp(b.x, net.x - NET_HALF + 3, net.x + NET_HALF - 3)
  const speed = g.team === 0 ? 62 : 52
  const dx = tx - g.x
  g.x += clamp(dx, -speed * dt, speed * dt)
  g.y = net.y + (g.team === 0 ? -8 : 8)
  g.face = g.team === 0 ? -Math.PI / 2 : Math.PI / 2
  g.anim += Math.abs(dx) * dt * 0.3
}

function stepFlight(a: Arena, dt: number) {
  const b = a.ball
  const f = b.flight!
  f.t += dt
  const k = Math.min(1, f.t / f.dur)
  b.x = f.sx + (f.tx - f.sx) * k
  b.y = f.sy + (f.ty - f.sy) * k
  b.z = 4 * f.peak * k * (1 - k) + (f.kind === 'shot' ? 10 * k : 0)
  if (f.kind === 'pass') {
    // a defender in the lane gets ONE try at it
    for (let i = 0; i < a.players.length; i++) {
      const p = a.players[i]
      if (p.team === f.team || p.goalie || f.tried!.includes(i)) continue
      if (dist(p.x, p.y, b.x, b.y) < 7 && b.z < 12) {
        f.tried!.push(i)
        if (rand(a) < (p.team === 0 ? 0.5 : 0.3)) {
          b.flight = null
          b.holder = i
          emit(a, { kind: 'intercept', team: p.team, text: 'PICKED OFF!', say: p.team === 0 ? 'Intercepted by the Whalehogs!' : 'Picked off by the Robots!', x: p.x, y: p.y - 10 })
          if (a.sport === 'basketball') endPossession(a, 'intercept', -1, 1.3)
          return
        }
      }
    }
    if (k >= 1) {
      b.flight = null
      const r = a.players[f.to!]
      if (dist(r.x, r.y, b.x, b.y) < 12) b.holder = f.to!
      else { b.vx = (f.tx - f.sx) / f.dur * 0.4; b.vy = (f.ty - f.sy) / f.dur * 0.4; b.z = 0 }
    }
    return
  }
  // a shot arrives at the rim
  if (k >= 1) {
    b.flight = null
    const team = f.team
    if (f.make) {
      a.score[team] += f.points!
      const three = f.points === 3
      const words = team === 0
        ? three ? ['From DOWNTOWN!', 'Three pointer!'] : ['Bucket!', 'He scores!', 'Nothing but net!']
        : ['Robots score.', 'The Robots hit one.']
      emit(a, { kind: 'score', team, points: f.points, text: `+${f.points}`, say: words[Math.floor(rand(a) * words.length)], x: HOOP.x, y: HOOP.y + 10 })
      b.x = HOOP.x; b.y = HOOP.y + 4; b.z = 14; b.vx = 0; b.vy = 18; b.vz = -10
      endPossession(a, 'score', team, 1.6)
    } else {
      // off the rim — a live rebound
      const ang = Math.PI * (0.15 + rand(a) * 0.7)
      const sp = 50 + rand(a) * 45
      b.x = HOOP.x; b.y = HOOP.y + 3; b.z = 16
      b.vx = Math.cos(ang) * sp * (rand(a) < 0.5 ? 1 : -1)
      b.vy = Math.sin(ang) * sp
      b.vz = 30
      b.noPickTeam = -1
      b.noPickT = 0.3
      emit(a, { kind: 'rim', team, text: 'CLANK!', x: HOOP.x, y: HOOP.y + 6 })
    }
  }
}

function stepLoose(a: Arena, dt: number, celebrating: boolean) {
  const b = a.ball
  if (b.holder >= 0 || b.flight) return
  b.x += b.vx * dt
  b.y += b.vy * dt
  if (a.sport === 'basketball') {
    b.vz -= 160 * dt
    b.z += b.vz * dt
    if (b.z <= 0) { b.z = 0; b.vz = Math.abs(b.vz) > 25 ? -b.vz * 0.5 : 0 }
    const fr = Math.pow(0.35, dt)
    b.vx *= fr; b.vy *= fr
    if (b.x < COURT.x0 || b.x > COURT.x1) { b.vx = -b.vx; b.x = clamp(b.x, COURT.x0, COURT.x1) }
    if (b.y < COURT.y0 + 6 || b.y > COURT.y1) { b.vy = -b.vy; b.y = clamp(b.y, COURT.y0 + 6, COURT.y1) }
  } else {
    stepPuck(a, dt)
  }
  if (celebrating) return
  // pick it up
  if (b.z < 10) {
    for (let i = 0; i < a.players.length; i++) {
      const p = a.players[i]
      if (p.goalie || p.stun > 0) continue
      if (b.noPickT > 0 && p.team === b.noPickTeam) continue
      if (dist(p.x, p.y, b.x, b.y) < 8) {
        b.holder = i
        b.vx = b.vy = b.vz = 0
        b.shot = undefined
        const reb = a.sport === 'basketball'
        if (reb) {
          emit(a, { kind: 'rebound', team: p.team, text: 'REBOUND!', say: p.team === a.offense ? 'Offensive rebound!' : undefined, x: p.x, y: p.y - 10 })
          if (p.team !== a.offense) endPossession(a, 'rebound', -1, 1.1)
          else a.clock = Math.max(a.clock, 4)
        }
        break
      }
    }
  }
}

function stepPuck(a: Arena, dt: number) {
  const b = a.ball
  const fr = Math.pow(0.55, dt)
  b.vx *= fr; b.vy *= fr
  if (Math.hypot(b.vx, b.vy) < 25) b.shot = undefined
  // the boards
  if (b.x < RINK.x0 + 2) { b.x = RINK.x0 + 2; b.vx = Math.abs(b.vx) * 0.8 }
  if (b.x > RINK.x1 - 2) { b.x = RINK.x1 - 2; b.vx = -Math.abs(b.vx) * 0.8 }
  // the goal lines: a goal, a save, or off the end boards
  for (const [net, team, goalie] of [[NET_TOP, 0, 7], [NET_BOT, 1, 6]] as const) {
    const crossing = team === 0 ? b.y <= net.y + 2 && b.vy < 0 : b.y >= net.y - 2 && b.vy > 0
    if (!crossing) continue
    const inside = Math.abs(b.x - net.x) <= NET_HALF
    if (inside) {
      const g = a.players[goalie]
      const reach = Math.abs(g.x - b.x) < 8
      const grade = b.shot?.grade ?? 'good'
      let save = reach ? 0.7 : 0.2
      if (grade === 'perfect') save -= 0.35
      if (grade === 'bad') save += 0.2
      if (team === 0 && a.hot) save -= 0.1
      if (team === 1) save += 0.12 // our goalie is good
      if (b.shot === undefined) save += 0.25 // a dribbler, not a shot
      if (rand(a) < clamp(save, 0.05, 0.95)) {
        // freeze it or kick it out
        if (rand(a) < 0.35) {
          b.vx = 0; b.vy = 0
          b.x = g.x; b.y = g.y + (team === 0 ? 4 : -4)
          emit(a, { kind: 'freeze', team: team === 0 ? 1 : 0, text: 'SAVE!', say: team === 0 ? 'Great save by the Robot goalie.' : 'What a save!', x: g.x, y: g.y })
          endPossession(a, 'freeze', -1, 1.2)
        } else {
          b.vy = -b.vy * 0.6
          b.vx = (rand(a) - 0.5) * 120
          b.y = net.y + (team === 0 ? 5 : -5)
          emit(a, { kind: 'save', team: team === 0 ? 1 : 0, text: 'SAVE!', say: team === 1 ? 'Kicked away!' : undefined, x: g.x, y: g.y })
        }
        b.shot = undefined
        return
      }
      a.score[team] += 1
      b.vx = 0; b.vy = 0; b.y = net.y + (team === 0 ? -4 : 4)
      emit(a, { kind: 'score', team, points: 1, text: 'GOAL!', say: team === 0 ? 'GOAL! He shoots, he scores!' : 'The Robots score.', x: net.x, y: net.y })
      endPossession(a, 'score', team, 1.8)
      return
    }
    // wide: a post if close, else off the end boards
    if (Math.abs(Math.abs(b.x - net.x) - NET_HALF) < 3 && b.shot) {
      emit(a, { kind: 'post', team, text: 'PING! Post!', say: 'Off the post!', x: b.x, y: b.y })
      b.shot = undefined
    }
  }
  if (b.y < RINK.y0 + 2) { b.y = RINK.y0 + 2; b.vy = Math.abs(b.vy) * 0.8; b.shot = undefined }
  if (b.y > RINK.y1 - 2) { b.y = RINK.y1 - 2; b.vy = -Math.abs(b.vy) * 0.8; b.shot = undefined }
}

/** announcer line when a possession starts */
export function possessionCall(sport: Sport, ours: boolean, hot: boolean, rnd = Math.random()): string {
  if (sport === 'basketball') {
    if (ours) return hot ? (rnd < 0.5 ? 'Whalehogs ball — and he is HEATING UP!' : 'Your ball! Hot hand — let it fly!') : 'Whalehogs ball!'
    return rnd < 0.5 ? 'Robots ball — play defense! Press B to steal!' : 'Get back on D! Swipe at the ball with B!'
  }
  if (ours) return hot ? 'Whalehogs win the faceoff — hot stick!' : 'Whalehogs win the draw!'
  return rnd < 0.5 ? 'Robots win the faceoff — check them with B!' : 'Robots have it — go get the puck!'
}
