// Brain Ball — 🏈 Game Day: the drive engine (pure).
//
// Brian (Nov 3): "add an option to play the current game OR play a passing
// game OR a tackling, blocking, running, or Fieldgoal game … This should help
// the boys understand rules of football - first downs, touchdowns, extra
// points etc."
//
// Game Day is real football, kid-sized: you CALL THE PLAY before every
// question — Run (safe), Pass (big but intercept-able), Field Goal (3 when in
// range) — against real downs and a first-down line. Touchdowns are 6 plus an
// extra-point kick; every change of possession flips you onto DEFENSE for a
// two-play stand where tackles decide whether the Robots punt, kick a field
// goal, or score. Blocking is the run game's muscle ("great block springs him
// loose") and what happens to bad kicks. The questions stay the learning
// engine; this module only decides what each answer means on the field.

export type PlayCall = 'run' | 'pass' | 'fg' | 'xp' | 'tackle'

export interface GameState {
  phase: 'offense' | 'xp' | 'defense'
  /** your ball spot, 0–100 (100 = the Robots' goal line) */
  ball: number
  down: 1 | 2 | 3 | 4
  /** absolute spot that earns a fresh set of downs (100 = goal to go) */
  lineToGain: number
  us: number
  them: number
  /** defense: yards the Robots still need to reach YOUR goal line */
  oppBall: number
  defPlays: number
  defStops: number
  drives: number
}

export interface FbEvent {
  kind:
    | 'gain'
    | 'firstDown'
    | 'touchdown'
    | 'xpGood'
    | 'xpMiss'
    | 'fgGood'
    | 'fgMiss'
    | 'tackledNoGain'
    | 'intercepted'
    | 'turnoverOnDowns'
    | 'defStop'
    | 'defGain'
    | 'theyTD'
    | 'theyFG'
    | 'theyPunt'
    | 'newDrive'
  /** short floater text for the canvas */
  text: string
  /** spoken line (only the teaching moments carry one) */
  say?: string
  excited?: boolean
  gain?: number
}

export const KICKOFF_SPOT = 20
export const RUN_GAIN = 7
export const RUN_HOT = 10
export const PASS_GAIN = 15
export const PASS_HOT = 20
/** longest makeable kick (distance = 100 − ball + 17 for the end zone + holder) */
export const FG_MAX_KICK = 55
/** the Robots start a drive this far from your goal line */
export const DEF_START = 60
export const DEF_GAIN = 30
export const DEF_LOSS = 2
export const STAND_PLAYS = 2

export function newGame(): GameState {
  return {
    phase: 'offense',
    ball: KICKOFF_SPOT,
    down: 1,
    lineToGain: KICKOFF_SPOT + 10,
    us: 0,
    them: 0,
    oppBall: DEF_START,
    defPlays: 0,
    defStops: 0,
    drives: 1,
  }
}

export function kickDistance(s: GameState): number {
  return 100 - s.ball + 17
}

export function fgInRange(s: GameState): boolean {
  return kickDistance(s) <= FG_MAX_KICK
}

export function availableCalls(s: GameState): PlayCall[] {
  if (s.phase === 'xp') return ['xp']
  if (s.phase === 'defense') return ['tackle']
  return fgInRange(s) ? ['run', 'pass', 'fg'] : ['run', 'pass']
}

const ordDown = ['', '1st', '2nd', '3rd', '4th'] as const

/** "1st & 10", "3rd & 2", "2nd & Goal" */
export function downWords(s: GameState): string {
  const toGain = s.lineToGain - s.ball
  const goal = s.lineToGain >= 100
  return `${ordDown[s.down]} & ${goal ? 'Goal' : Math.max(1, toGain)}`
}

/** "your 35" / "midfield" / "the Robots' 40" — how announcers say the spot */
export function spotWords(s: GameState): string {
  if (s.ball === 50) return 'midfield'
  return s.ball < 50 ? `your ${s.ball}` : `the Robots' ${100 - s.ball}`
}

function freshDrive(s: GameState, events: FbEvent[]): GameState {
  events.push({ kind: 'newDrive', text: '🏈 Your ball at the 20!' })
  return {
    ...s,
    phase: 'offense',
    ball: KICKOFF_SPOT,
    down: 1,
    lineToGain: KICKOFF_SPOT + 10,
    oppBall: DEF_START,
    defPlays: 0,
    defStops: 0,
    drives: s.drives + 1,
  }
}

/** every change of possession sends you to defense for a two-play stand */
function toDefense(s: GameState): GameState {
  return { ...s, phase: 'defense', oppBall: DEF_START, defPlays: 0, defStops: 0 }
}

/**
 * Resolve one play. `correct` is whether the question was answered right —
 * the player EXECUTES the play they called by being right.
 */
export function applyPlay(state: GameState, call: PlayCall, correct: boolean, streak = 0): { next: GameState; events: FbEvent[] } {
  const events: FbEvent[] = []
  const s = { ...state }

  if (s.phase === 'xp' || call === 'xp') {
    if (correct) {
      s.us += 1
      events.push({ kind: 'xpGood', text: '🦵 Extra point is GOOD! +1', say: 'The kick is good! Seven points!', excited: true })
    } else {
      events.push({ kind: 'xpMiss', text: '🦵 The kick is BLOCKED!', say: 'Oh no, the kick got blocked — still six points. We don’t say can’t!' })
    }
    return { next: toDefense(s), events }
  }

  if (s.phase === 'defense' || call === 'tackle') {
    s.defPlays += 1
    if (correct) {
      s.defStops += 1
      s.oppBall = Math.min(DEF_START, s.oppBall + DEF_LOSS)
      events.push({ kind: 'defStop', text: '🛡️ TACKLE! Great stop!', say: s.defPlays === 1 ? 'Tackle! What a stop!' : undefined, excited: true })
    } else {
      s.oppBall -= DEF_GAIN
      events.push({ kind: 'defGain', text: `🤖 They gained ${DEF_GAIN} yards!` })
    }
    if (s.oppBall <= 0) {
      s.them += 7
      events.push({ kind: 'theyTD', text: '🤖 Robots TOUCHDOWN +7', say: 'The Robots scored a touchdown. Get it back, Whalehogs!' })
      return { next: freshDrive(s, events), events }
    }
    if (s.defPlays >= STAND_PLAYS) {
      if (s.defStops >= STAND_PLAYS) {
        events.push({ kind: 'theyPunt', text: '🛡️ They have to PUNT!', say: 'You stopped them — they have to punt. Your ball!', excited: true })
      } else {
        s.them += 3
        events.push({ kind: 'theyFG', text: '🤖 Robots field goal +3', say: 'They got close and kicked a field goal — three points for the Robots.' })
      }
      return { next: freshDrive(s, events), events }
    }
    return { next: s, events }
  }

  // ---------------- offense
  if (call === 'fg') {
    if (correct) {
      s.us += 3
      events.push({ kind: 'fgGood', text: `🦵 ${kickDistance(s)}-yd FIELD GOAL! +3`, say: 'The field goal is GOOD! Three points!', excited: true })
    } else {
      events.push({ kind: 'fgMiss', text: '🦵 WIDE LEFT — no good!', say: 'The kick missed — no points this time. The Robots get the ball.' })
    }
    return { next: toDefense(s), events }
  }

  if (correct) {
    const hot = streak >= 3
    const gain = call === 'pass' ? (hot ? PASS_HOT : PASS_GAIN) : hot ? RUN_HOT : RUN_GAIN
    s.ball = Math.min(100, s.ball + gain)
    events.push({
      kind: 'gain',
      gain,
      text:
        call === 'pass'
          ? `🎯 Complete! +${gain} yards`
          : hot
          ? `💪 HUGE block! He’s loose! +${gain}`
          : `🏃 Great block! +${gain} yards`,
    })
    if (s.ball >= 100) {
      s.us += 6
      s.phase = 'xp'
      events.push({ kind: 'touchdown', text: '🏈 TOUCHDOWN! +6', say: 'TOUCHDOWN! Six points! Now kick the extra point!', excited: true })
      return { next: s, events }
    }
    if (s.ball >= s.lineToGain) {
      s.down = 1
      s.lineToGain = Math.min(100, s.ball + 10)
      events.push({ kind: 'firstDown', text: '🟨 FIRST DOWN!', say: 'First down! Four fresh tries!', excited: true })
      return { next: s, events }
    }
  } else {
    if (call === 'pass') {
      events.push({ kind: 'intercepted', text: '🤖 INTERCEPTED!', say: 'Intercepted! The Robots caught it. We don’t say can’t — go play defense!' })
      return { next: toDefense(s), events }
    }
    events.push({ kind: 'tackledNoGain', text: '🤖 Tackled — no gain!' })
  }

  // the play used a down
  if (s.down >= 4) {
    events.push({ kind: 'turnoverOnDowns', text: '🔁 Turnover on downs!', say: 'Four downs used — turnover! The Robots get the ball.' })
    return { next: toDefense(s), events }
  }
  s.down = (s.down + 1) as GameState['down']
  return { next: s, events }
}

/** play-call button copy — what each play IS, in kid words */
export function describeCall(call: PlayCall, s: GameState, streak = 0): { emoji: string; name: string; blurb: string } {
  const hot = streak >= 3
  switch (call) {
    case 'run':
      return { emoji: '🏃', name: 'Run', blurb: hot ? `Blockers are fired up — +${RUN_HOT} yards!` : `Safe behind the blockers — +${RUN_GAIN} yards` }
    case 'pass':
      return { emoji: '🎯', name: 'Pass', blurb: `+${hot ? PASS_HOT : PASS_GAIN} yards… but a miss can be INTERCEPTED!` }
    case 'fg':
      return { emoji: '🦵', name: 'Field Goal', blurb: `A ${kickDistance(s)}-yard kick for 3 points` }
    case 'xp':
      return { emoji: '🦵', name: 'Extra Point', blurb: 'Kick it through for 1 more point!' }
    case 'tackle':
      return { emoji: '🛡️', name: 'TACKLE!', blurb: 'Stop the Robots’ runner!' }
  }
}
