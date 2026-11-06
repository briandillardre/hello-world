// Brain Ball — 🏈 Game Day: the drive engine (pure).
//
// Brian (Nov 3): "This should help the boys understand rules of football -
// first downs, touchdowns, extra points etc." Then (Nov 6): "Needs to be
// interactive with the boys moving the ball or player trying not to be
// tackled. Same with having to tackle the other teams player. Fieldgoal
// needs to be a pull back and swing method something like golf games do."
//
// So Game Day is now TWO beats per play: the QUESTION earns the play (wrong
// answer = the play is blown up at the snap — sacked, intercepted, blocked),
// and then the kid RUNS it with their finger: steer the ball-carrier past
// the robot tacklers (yards = how far they really get), drag your own
// tackler to catch the Robots' runner on defense, and pull-back-and-release
// to swing a kick through the uprights. This module stays pure: the
// mini-games in BallGame.tsx hand it a PlayOutcome and it decides what that
// outcome MEANS on the field — downs, scores, turnovers, the defense stand.

export type PlayCall = 'run' | 'pass' | 'fg' | 'xp' | 'tackle'

/** what actually happened on the field — the mini-game's result */
export interface PlayOutcome {
  /** the question: wrong = the play never gets off the ground */
  correct: boolean
  /** run/pass: yards the carrier really gained before being tackled */
  yards?: number
  /** fg/xp: the swung kick went through the uprights */
  made?: boolean
  /** defense: your tackler caught the Robots' runner before he broke loose */
  tackled?: boolean
}

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
/** a completed pass is caught this far downfield — the head start a pass buys */
export const PASS_AIR_YARDS = 15
/** longest makeable kick (distance = 100 − ball + 17 for the end zone + holder) */
export const FG_MAX_KICK = 55
/** the Robots start a drive this far from your goal line */
export const DEF_START = 60
/** the Robots' runner breaks the stand open if he gains this many yards */
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
 * Resolve one play. The question earns the play (`outcome.correct`); the
 * mini-game says how it really went (`yards` / `made` / `tackled`).
 */
export function applyPlay(state: GameState, call: PlayCall, outcome: PlayOutcome): { next: GameState; events: FbEvent[] } {
  const events: FbEvent[] = []
  const s = { ...state }
  const { correct } = outcome

  if (s.phase === 'xp' || call === 'xp') {
    if (!correct) {
      events.push({ kind: 'xpMiss', text: '🦵 The kick is BLOCKED!', say: 'Oh no, the kick got blocked — still six points. We don’t say can’t!' })
    } else if (outcome.made) {
      s.us += 1
      events.push({ kind: 'xpGood', text: '🦵 Extra point is GOOD! +1', say: 'The kick is good! Seven points!', excited: true })
    } else {
      events.push({ kind: 'xpMiss', text: '🦵 The kick sails wide!', say: 'The kick missed — still six points. We don’t say can’t!' })
    }
    return { next: toDefense(s), events }
  }

  if (s.phase === 'defense' || call === 'tackle') {
    s.defPlays += 1
    if (correct && outcome.tackled) {
      s.defStops += 1
      s.oppBall = Math.min(DEF_START, s.oppBall + DEF_LOSS)
      events.push({ kind: 'defStop', text: '🛡️ TACKLE! Great stop!', say: s.defPlays === 1 ? 'Tackle! What a stop!' : undefined, excited: true })
    } else {
      s.oppBall -= DEF_GAIN
      events.push({
        kind: 'defGain',
        text: correct ? `🤖 He got away! +${DEF_GAIN} yards` : `🤖 He broke free! +${DEF_GAIN} yards`,
      })
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
    if (!correct) {
      events.push({ kind: 'fgMiss', text: '🦵 The kick is BLOCKED!', say: 'The kick got blocked — no points this time. The Robots get the ball.' })
    } else if (outcome.made) {
      s.us += 3
      events.push({ kind: 'fgGood', text: `🦵 ${kickDistance(s)}-yd FIELD GOAL! +3`, say: 'The field goal is GOOD! Three points!', excited: true })
    } else {
      events.push({ kind: 'fgMiss', text: '🦵 No good — wide!', say: 'The kick missed — no points this time. The Robots get the ball.' })
    }
    return { next: toDefense(s), events }
  }

  if (correct) {
    // the kid RAN this play — the yards are whatever they really got
    const gain = Math.max(0, Math.min(100 - s.ball, Math.round(outcome.yards ?? 0)))
    if (gain === 0) {
      events.push({ kind: 'tackledNoGain', text: '🤖 Tackled at the line — no gain!' })
    } else {
      s.ball += gain
      events.push({
        kind: 'gain',
        gain,
        text: gain >= 20 ? `💨 HUGE run! +${gain} yards` : call === 'pass' ? `🎯 Complete! +${gain} yards` : `🏃 +${gain} yards!`,
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
    }
  } else {
    if (call === 'pass') {
      events.push({ kind: 'intercepted', text: '🤖 INTERCEPTED!', say: 'Intercepted! The Robots caught it. We don’t say can’t — go play defense!' })
      return { next: toDefense(s), events }
    }
    events.push({ kind: 'tackledNoGain', text: '🤖 Sacked — no gain!' })
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
export function describeCall(call: PlayCall, s: GameState): { emoji: string; name: string; blurb: string } {
  switch (call) {
    case 'run':
      return { emoji: '🏃', name: 'Run', blurb: 'Answer right, then DODGE the tacklers — run as far as you can!' }
    case 'pass':
      return { emoji: '🎯', name: 'Pass', blurb: `Catch it ${PASS_AIR_YARDS} yards deep and run… but a wrong answer is INTERCEPTED!` }
    case 'fg':
      return { emoji: '🦵', name: 'Field Goal', blurb: `Pull back and swing — a ${kickDistance(s)}-yard kick for 3 points` }
    case 'xp':
      return { emoji: '🦵', name: 'Extra Point', blurb: 'Pull back and swing it through for 1 more point!' }
    case 'tackle':
      return { emoji: '🛡️', name: 'TACKLE!', blurb: 'Answer right, then chase him down with your finger!' }
  }
}
