'use client'

// Brain Ball — the rolling-ball answer game (hole.io-style: eat the right
// answer bubble and grow). Canvas render loop + DOM question banner.

import { useCallback, useEffect, useRef, useState } from 'react'
import { Mic, Volume2, X } from 'lucide-react'
import { ADULT_THETA_CAP, nextDifficulty, pickMixSkill, updateTheta } from '@/lib/game/adaptive'
import { generateQuestion, skillDisplayName, SKILLS } from '@/lib/game/questions'
import { cancelSpeech, speak as speakText, warmVoices } from '@/lib/game/speech'
import { matchSpoken, voiceable } from '@/lib/game/voice-answer'
import {
  applyPlay,
  availableCalls,
  describeCall,
  downWords,
  kickDistance,
  newGame,
  PASS_AIR_YARDS,
  spotWords,
  type GameState,
  type PlayCall,
  type PlayOutcome,
} from '@/lib/game/football'
import { SPEECH_UPDATE_HINT, speechDoor, startSpeech, type SpeechDoor, type SpeechSession } from '@/lib/speech-input'
import { BALL_SKINS } from '@/lib/game/storage'
import type { KidProfile, MissedQuestion, Question, RoundResult, SkillId, SkillState } from '@/lib/game/types'

export const ROUND_LENGTH = 10

export interface AnswerDelta {
  skill: SkillId
  difficulty: number
  correct: boolean
  coins: number
  xp: number
  newTheta: number
  /** best streak recorded for this skill so far this round (persisted per answer) */
  newBestStreak: number
  /** time to answer, ms */
  ms: number
}

/** quiet window before a question auto-reads — readers can beat the voice */
const AUTO_READ_DELAY_MS = 4000
/** answer speed thresholds for the ⚡ bonus */
const FAST_MS = 3500
const QUICK_MS = 6500

interface BallGameProps {
  profile: KidProfile
  skill: SkillId | 'mix'
  /** first round of the day pays double coins */
  dailyDouble?: boolean
  /** 🏈 football mode: same questions & rewards, rendered as a drive downfield */
  football?: boolean
  /** 🏈 Game Day: full rules — call the play, downs, kicks, defense, a scoreboard */
  gameday?: boolean
  onAnswer: (delta: AnswerDelta) => void
  onComplete: (result: RoundResult) => void
  onQuit: () => void
}

interface Bubble {
  x: number
  y: number
  r: number
  text: string
  eaten: boolean
  /** 1→0 pop animation after being eaten */
  pop: number
  /** being vacuumed into the ball (board-clear after a correct answer) */
  sucked: boolean
  wrongFlash: number
  isCorrect: boolean
}

interface Ring {
  x: number
  y: number
  r: number
  life: number
  color: string
}

/** bubble debris that gets sucked into the ball (hole.io gulp) */
interface Crumb {
  x: number
  y: number
  vx: number
  vy: number
  size: number
  color: string
}

interface Particle {
  x: number
  y: number
  vx: number
  vy: number
  life: number
  color: string
  size: number
}

interface Floater {
  x: number
  y: number
  text: string
  life: number
  color: string
}

type Phase = 'idle' | 'rolling' | 'celebrate' | 'reveal' | 'redeem' | 'mini' | 'done'

// 🏈 Game Day mini-games — the kid RUNS the play after earning it:
// carry = drag to steer the ball-carrier past the robot tacklers,
// chase = drag your tackler to catch the Robots' runner,
// kick = pull back and release, golf-swing style.
type Mini =
  | {
      kind: 'carry'
      call: 'run' | 'pass'
      /** scrimmage when the play started (yards gained measure from here) */
      startBall: number
      /** pass only: frames left in the throw animation before the catch */
      throwT: number
      finger: { x: number; y: number } | null
      /** the pointer steering right now — a resting palm can't hijack */
      pid?: number
      bots: Array<{ x: number; y: number; vx: number; vy: number }>
      /** bots speed up over time so every play ends */
      heat: number
      age: number
    }
  | {
      kind: 'chase'
      /** the Robots' runner the kid has to catch */
      runner: { x: number; y: number; tx: number }
      startOpp: number
      finger: { x: number; y: number } | null
      pid?: number
      jukeT: number
      age: number
    }
  | {
      kind: 'kick'
      /** yards this kick needs to reach the posts */
      need: number
      tee: { x: number; y: number }
      drag: null | { x0: number; y0: number; x: number; y: number; pid: number }
      flight: null | { t: number; dur: number; endX: number; endY: number; arc: number; good: boolean }
      age: number
    }

const CONFETTI = ['#f97316', '#22c55e', '#3b82f6', '#eab308', '#ec4899', '#a855f7']
const PRAISE = ['Great job!', 'You got it!', 'Awesome!', 'Super smart!', 'Nice one!', 'Wow!', 'Go Whalehogs!', 'Whalehog smart!']
const FOOTBALL_PRAISE = ['First down!', 'Great run!', 'Big gain!', 'What a play!', 'He could go all the way!', 'Go Whalehogs!']
const ENCOURAGE = ['Good try!', 'Almost!', 'Keep going!', "You'll get it!", "We don't say can't!", 'Whalehogs never quit!']

/** football drives start at your own 20-yard line */
const DRIVE_START = 20

/** round-local copy of skill states (one level deep is all SkillState needs) */
function cloneSkills(skills: Record<SkillId, SkillState>): Record<SkillId, SkillState> {
  return Object.fromEntries(Object.entries(skills).map(([k, s]) => [k, { ...s }])) as Record<SkillId, SkillState>
}

/** 🏈 ONE field mapping shared by the field drawing and the mini-games —
 *  the end zone is clamped so it stays readable on short phone canvases */
function fieldGeom(w: { w: number; h: number }) {
  const zoneH = Math.max(44, Math.min(84, w.h * 0.12))
  const trackTop = zoneH + 10
  const trackBot = w.h - 16
  const spotY = (v: number) => trackBot - (trackBot - trackTop) * Math.max(0, Math.min(1, v / 100))
  /** defense: the Robots' runner's spot, oppBall yards from YOUR goal (60 = far) */
  const oppY = (v: number) => trackTop + (trackBot - trackTop) * (1 - Math.max(0, Math.min(60, v)) / 60)
  return { zoneH, trackTop, trackBot, spotY, oppY, pxPerYd: (trackBot - trackTop) / 100 }
}

/** a plain football (no face) — the teed/kicked ball in the swing mini-game */
function drawPigskin(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, rot: number) {
  ctx.save()
  ctx.translate(x, y)
  ctx.rotate(rot)
  ctx.fillStyle = '#92400e'
  ctx.beginPath()
  ctx.ellipse(0, 0, r * 1.45, r, 0, 0, Math.PI * 2)
  ctx.fill()
  ctx.strokeStyle = '#451a03'
  ctx.lineWidth = Math.max(1.5, r * 0.12)
  ctx.stroke()
  ctx.strokeStyle = '#fef3c7'
  ctx.lineWidth = Math.max(1.5, r * 0.16)
  ctx.beginPath()
  ctx.moveTo(-r * 0.6, 0)
  ctx.lineTo(r * 0.6, 0)
  ctx.stroke()
  ctx.restore()
}

export function BallGame({ profile, skill, dailyDouble = false, football = false, gameday = false, onAnswer, onComplete, onQuit }: BallGameProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const wrapRef = useRef<HTMLDivElement>(null)

  const [question, setQuestion] = useState<Question | null>(null)
  const [qIndex, setQIndex] = useState(0)
  const [coins, setCoins] = useState(0)
  const [streak, setStreak] = useState(0)
  const [results, setResults] = useState<boolean[]>([])
  const [muted, setMuted] = useState(false)
  const [isBonus, setIsBonus] = useState(false)
  const [yards, setYards] = useState(DRIVE_START)
  const [tds, setTds] = useState(0)
  // 🏈 Game Day: the drive state (ref = truth for the loop, state = UI mirror)
  // and the play-call picker that sits between questions
  const driveRef = useRef<GameState>(newGame())
  const [drive, setDrive] = useState<GameState>(driveRef.current)
  const [picking, setPicking] = useState(gameday)
  const pendingCallRef = useRef<PlayCall>('run')
  /** UI mirror of world.mini — swaps the banner to "run the play" copy */
  const [miniOn, setMiniOn] = useState(false)
  // answering out loud: the mic door is decided once (browser vs native vs
  // needs-the-app-update), the session lives in a ref
  const [micDoor, setMicDoor] = useState<SpeechDoor>('none')
  const [listening, setListening] = useState(false)
  const micSessionRef = useRef<SpeechSession | null>(null)
  useEffect(() => setMicDoor(speechDoor()), [])
  // the mini-games live in the draw loop; these refs carry fresh closures in
  const startMiniRef = useRef<(call: PlayCall) => void>(() => {})
  const finishPlayRef = useRef<(o: PlayOutcome) => void>(() => {})

  // mutable game world (never triggers React renders)
  const world = useRef({
    w: 360,
    h: 480,
    ball: { x: 180, y: 380, r: 30, rot: 0, sx: 1, sy: 1, target: null as { x: number; y: number } | null },
    bubbles: [] as Bubble[],
    particles: [] as Particle[],
    floaters: [] as Floater[],
    rings: [] as Ring[],
    crumbs: [] as Crumb[],
    eating: 0,
    phase: 'idle' as Phase,
    grow: 0,
    streak: 0,
    shake: 0,
    tappedIndex: -1,
    t: 0,
    /** football mode: current yard line (TD at 100, drive resets to 20) */
    yards: DRIVE_START,
    /** 1→0 end-zone flash after a touchdown */
    tdFlash: 0,
    /** Game Day: the interactive play in progress (drag-to-run / chase / swing-kick) */
    mini: null as Mini | null,
  })
  const skillsRef = useRef<Record<SkillId, SkillState>>(cloneSkills(profile.skills))
  const startThetasRef = useRef<Record<SkillId, number>>(
    Object.fromEntries(Object.entries(profile.skills).map(([k, s]) => [k, s.theta])) as Record<SkillId, number>
  )
  const questionRef = useRef<Question | null>(null)
  const statsRef = useRef({ correct: 0, coins: 0, bestStreak: 0, answered: 0, speedBonuses: 0, readBonuses: 0, touchdowns: 0, playSeconds: 0 })
  const missesRef = useRef<MissedQuestion[]>([])
  const qStartRef = useRef(0)
  const spokeRef = useRef(false)
  const autoReadTimerRef = useRef<number | null>(null)
  // variable-reward bonus question (never the first two)
  const bonusIndexRef = useRef(2 + Math.floor(Math.random() * (ROUND_LENGTH - 2)))
  const bonusRef = useRef(false)
  // spaced repetition of past misses, consumed during Mix rounds
  const queueRef = useRef([...(profile.reviewQueue ?? [])])
  const advanceTimerRef = useRef<number | null>(null)
  // sky gradient rebuilt only on resize, not 60x/second
  const skyCacheRef = useRef<{ grad: CanvasGradient | null }>({ grad: null })
  const audioRef = useRef<AudioContext | null>(null)
  const mutedRef = useRef(false)
  mutedRef.current = muted

  const activeSkin = BALL_SKINS.find((s) => s.id === profile.activeSkin) ?? BALL_SKINS[0]

  // ------------------------------------------------------------- audio
  const ensureAudio = () => {
    if (!audioRef.current && typeof window !== 'undefined') {
      const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
      if (Ctx) audioRef.current = new Ctx()
    }
    return audioRef.current
  }

  const tone = useCallback((freq: number, start: number, dur: number, type: OscillatorType = 'sine', gain = 0.12) => {
    const ctx = audioRef.current
    if (!ctx || mutedRef.current) return
    const o = ctx.createOscillator()
    const g = ctx.createGain()
    o.type = type
    o.frequency.value = freq
    g.gain.setValueAtTime(0, ctx.currentTime + start)
    g.gain.linearRampToValueAtTime(gain, ctx.currentTime + start + 0.02)
    g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + start + dur)
    o.connect(g).connect(ctx.destination)
    o.start(ctx.currentTime + start)
    o.stop(ctx.currentTime + start + dur + 0.05)
  }, [])

  // combo ladder: every streak step raises the arpeggio's pitch — the round
  // literally sounds like it's heating up
  const playCorrect = useCallback(
    (streak = 0) => {
      const m = 1 + Math.min(streak, 8) * 0.06
      tone(523 * m, 0, 0.15, 'triangle')
      tone(659 * m, 0.1, 0.15, 'triangle')
      tone(784 * m, 0.2, 0.3, 'triangle')
      if (streak >= 3) tone(1047 * m, 0.3, 0.35, 'triangle', 0.1)
      if (streak >= 5) tone(1319 * m, 0.42, 0.4, 'sine', 0.08)
    },
    [tone]
  )
  const playWrong = useCallback(() => {
    tone(220, 0, 0.25, 'sine', 0.08)
    tone(185, 0.12, 0.3, 'sine', 0.08)
  }, [tone])
  const playGulp = useCallback(() => {
    tone(392, 0.15, 0.1, 'sine', 0.1)
    tone(294, 0.24, 0.1, 'sine', 0.12)
    tone(196, 0.33, 0.18, 'sine', 0.12)
  }, [tone])
  /** short "nom" per vacuumed bubble */
  const playNom = useCallback(() => {
    tone(392, 0, 0.06, 'sine', 0.08)
    tone(262, 0.07, 0.1, 'sine', 0.09)
  }, [tone])
  /** stadium fanfare for a touchdown */
  const playTouchdown = useCallback(() => {
    tone(392, 0, 0.12, 'triangle')
    tone(523, 0.12, 0.12, 'triangle')
    tone(659, 0.24, 0.12, 'triangle')
    tone(784, 0.36, 0.4, 'triangle', 0.14)
    tone(1047, 0.52, 0.5, 'sine', 0.1)
  }, [tone])

  /** after the right answer is eaten, vacuum the rest of the board in too */
  const suckRemaining = useCallback(() => {
    window.setTimeout(() => {
      world.current.bubbles.forEach((b) => {
        if (!b.eaten) b.sucked = true
      })
    }, 350)
  }, [])

  /** bubble → crumbs that spiral into the ball's mouth */
  const spawnEat = useCallback((b: Bubble) => {
    const w = world.current
    b.eaten = true
    b.pop = 1
    w.eating = 1
    const colors = ['#ffffff', '#dbeafe', '#bfdbfe', '#93c5fd']
    for (let i = 0; i < 14; i++) {
      const ang = (i / 14) * Math.PI * 2
      w.crumbs.push({
        x: b.x + Math.cos(ang) * b.r * 0.6,
        y: b.y + Math.sin(ang) * b.r * 0.6,
        vx: Math.cos(ang) * 2.5,
        vy: Math.sin(ang) * 2.5,
        size: 4 + Math.random() * 7,
        color: colors[i % colors.length],
      })
    }
  }, [])

  const speak = useCallback((text: string, excited = false) => {
    if (mutedRef.current) return
    speakText(text, excited ? { excited: true } : { rate: 0.97 })
  }, [])

  // ------------------------------------------------------------- questions
  /** shared geometry for initial layout AND resize — one source of truth */
  const positionBubbles = useCallback(() => {
    const w = world.current
    const r = Math.min(w.w, w.h) * 0.135
    const two = w.bubbles.length === 2
    const xs = two ? [0.3, 0.7] : [0.2, 0.5, 0.8]
    const ys = two ? [0.27, 0.27] : [0.3, 0.24, 0.3]
    w.bubbles.forEach((b, i) => {
      b.x = w.w * xs[i % xs.length]
      b.y = w.h * ys[i % ys.length]
      b.r = r
    })
  }, [])

  const layoutBubbles = useCallback(
    (q: Question) => {
      const w = world.current
      w.bubbles = q.choices.map((text, i) => ({
        x: 0,
        y: 0,
        r: 0,
        text,
        eaten: false,
        pop: 0,
        sucked: false,
        wrongFlash: 0,
        isCorrect: i === q.answer,
      }))
      positionBubbles()
    },
    [positionBubbles]
  )

  const nextQuestion = useCallback(
    (index: number) => {
      let sk: SkillId
      let difficulty: number
      // comeback question: re-visit a past miss (slightly easier) in Mix rounds
      const review = skill === 'mix' && queueRef.current.length > 0 && Math.random() < 0.35 ? queueRef.current.shift() : undefined
      if (review) {
        sk = review.skill
        difficulty = Math.max(1, review.difficulty - 8)
      } else {
        // testers get no age-percentile weighting — norms don't apply to adults
        sk = skill === 'mix' ? pickMixSkill(skillsRef.current, profile.isTester ? undefined : profile.birthdate) : skill
        difficulty = nextDifficulty(skillsRef.current[sk], index, world.current.streak)
      }
      // a mic left listening across questions would answer the wrong one
      micSessionRef.current?.stop()
      const q = generateQuestion(sk, difficulty, !!profile.isTester)
      questionRef.current = q
      setQuestion(q)
      setQIndex(index)
      layoutBubbles(q)
      const bonus = index === bonusIndexRef.current
      bonusRef.current = bonus
      setIsBonus(bonus)
      world.current.phase = 'idle'
      world.current.tappedIndex = -1
      // quiet reading window: auto-read only after a pause, so readers can
      // beat the voice for a 📖 bonus (pre-readers still hear every question)
      qStartRef.current = Date.now()
      spokeRef.current = false
      if (autoReadTimerRef.current !== null) window.clearTimeout(autoReadTimerRef.current)
      autoReadTimerRef.current = window.setTimeout(() => {
        autoReadTimerRef.current = null
        // skip if the kid already asked for the voice — restarting a
        // half-finished narration sounded like a stutter
        if (questionRef.current === q && world.current.phase === 'idle' && !spokeRef.current) {
          spokeRef.current = true
          speak(bonus ? `Bonus question! Double coins! ${q.speech}` : q.speech)
        }
      }, AUTO_READ_DELAY_MS)
    },
    [skill, layoutBubbles, speak, profile.birthdate, profile.isTester]
  )

  /** roll to a bubble programmatically — the voice path into the same answer flow a tap takes */
  const pickBubble = useCallback((i: number) => {
    const w = world.current
    if (w.phase !== 'idle') return
    const b = w.bubbles[i]
    if (!b || b.eaten) return
    w.phase = 'rolling'
    w.tappedIndex = i
    w.ball.target = { x: b.x, y: b.y }
  }, [])

  const onMic = useCallback(() => {
    if (micDoor === 'update') {
      // the installed app predates the speech plugin — say so instead of blinking
      world.current.floaters.push({ x: world.current.w / 2, y: world.current.h * 0.55, text: '🎤 Needs the app update', life: 1.6, color: '#64748b' })
      speak(SPEECH_UPDATE_HINT)
      return
    }
    if (listening) {
      micSessionRef.current?.stop()
      return
    }
    // never transcribe our own narration
    if (autoReadTimerRef.current !== null) {
      window.clearTimeout(autoReadTimerRef.current)
      autoReadTimerRef.current = null
    }
    cancelSpeech()
    setListening(true)
    micSessionRef.current = startSpeech({
      onPartial: () => {},
      onFinal: (text) => {
        const q = questionRef.current
        const w = world.current
        if (!q || w.phase !== 'idle') return
        const idx = matchSpoken(text, q.choices)
        if (idx !== null) {
          w.floaters.push({ x: w.w / 2, y: w.h * 0.62, text: `🎤 “${text.slice(0, 24)}”`, life: 1.2, color: '#2563eb' })
          pickBubble(idx)
        } else {
          w.floaters.push({ x: w.w / 2, y: w.h * 0.55, text: '🎤 Say the answer again?', life: 1.4, color: '#64748b' })
        }
      },
      onEnd: () => {
        micSessionRef.current = null
        setListening(false)
      },
      onError: (m) => {
        world.current.floaters.push({ x: world.current.w / 2, y: world.current.h * 0.55, text: `🎤 ${m.slice(0, 48)}`, life: 1.8, color: '#64748b' })
      },
    })
    if (!micSessionRef.current) setListening(false)
  }, [micDoor, listening, pickBubble, speak])

  /** Game Day: the play was called — now the question IS the play */
  const callPlay = useCallback(
    (call: PlayCall) => {
      pendingCallRef.current = call
      setPicking(false)
      nextQuestion(statsRef.current.answered)
    },
    [nextQuestion]
  )

  // start round — Game Day opens on the play-call sheet instead of a question
  useEffect(() => {
    if (gameday) setPicking(true)
    else nextQuestion(0)
    warmVoices()
    return () => {
      micSessionRef.current?.stop()
      // stop everything scheduled — a pending advance firing after quit would
      // yank the user to the summary screen out of nowhere
      if (autoReadTimerRef.current !== null) window.clearTimeout(autoReadTimerRef.current)
      if (advanceTimerRef.current !== null) window.clearTimeout(advanceTimerRef.current)
      cancelSpeech()
      // iOS caps live AudioContexts (~4) — leaking one per round kills sound
      audioRef.current?.close().catch(() => {})
      audioRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ------------------------------------------------------------- answer resolution
  /** 🏈 Game Day: paint + speak what the engine said the play MEANT on the field */
  const applyFieldEvents = (res: ReturnType<typeof applyPlay>) => {
    const w = world.current
    const stats = statsRef.current
    driveRef.current = res.next
    setDrive(res.next)
    let fy = w.h * 0.4
    let said = false
    for (const ev of res.events) {
      w.floaters.push({ x: w.w / 2, y: fy, text: ev.text, life: ev.kind === 'touchdown' ? 2 : 1.5, color: ev.excited ? '#16a34a' : ev.kind.startsWith('they') || ev.kind === 'intercepted' || ev.kind === 'defGain' ? '#dc2626' : '#92400e' })
      fy -= 26
      if (ev.say && !said) {
        said = true
        speak(ev.say, !!ev.excited)
      }
      if (ev.kind === 'touchdown') {
        stats.touchdowns += 1
        setTds(stats.touchdowns)
        w.tdFlash = 1
        w.shake = 18
        for (let i = 0; i < 60; i++) {
          w.particles.push({ x: w.w / 2, y: w.h * 0.16, vx: (Math.random() - 0.5) * 14, vy: (Math.random() - 0.3) * 11, life: 1.1, color: CONFETTI[i % CONFETTI.length], size: 4 + Math.random() * 7 })
        }
        playTouchdown()
      }
      if (ev.kind === 'firstDown') {
        tone(659, 0, 0.12, 'triangle', 0.1)
        tone(880, 0.12, 0.25, 'triangle', 0.1)
      }
      if (ev.kind === 'fgGood' || ev.kind === 'xpGood') playTouchdown()
      if (ev.kind === 'theyTD') {
        w.shake = 10
        tone(220, 0, 0.3, 'sawtooth', 0.06)
        tone(185, 0.25, 0.4, 'sawtooth', 0.06)
      }
    }
    // mirror for the classic drive marker (0..100 ball spot drives the track)
    w.yards = res.next.phase === 'defense' ? w.yards : res.next.ball
    setYards(w.yards)
  }

  const resolveAnswer = useCallback(
    (bubbleIndex: number) => {
      const q = questionRef.current
      if (!q) return
      const w = world.current
      const correct = bubbleIndex === q.answer
      const elapsed = Date.now() - qStartRef.current
      const speedBoost = elapsed <= FAST_MS ? 1 : elapsed <= QUICK_MS ? 0.5 : 0
      const state = skillsRef.current[q.skill]
      const newTheta = updateTheta(state, q.difficulty, correct, speedBoost, profile.isTester ? ADULT_THETA_CAP : 99)
      state.theta = newTheta
      state.attempts += 1
      if (correct) state.correct += 1

      const stats = statsRef.current
      stats.answered += 1
      let coinsDelta = 0
      if (correct) {
        w.streak += 1
        stats.correct += 1
        stats.bestStreak = Math.max(stats.bestStreak, w.streak)
        state.bestStreak = Math.max(state.bestStreak, w.streak)
        const multiplier = (bonusRef.current ? 2 : 1) * (dailyDouble ? 2 : 1)
        coinsDelta = (2 + (w.streak >= 5 ? 2 : w.streak >= 3 ? 1 : 0)) * multiplier
        // ⚡ speed + 📖 read-it-myself bonuses (flat, outside the multipliers)
        if (speedBoost > 0) {
          const speedCoins = speedBoost === 1 ? 2 : 1
          coinsDelta += speedCoins
          stats.speedBonuses += 1
          w.floaters.push({ x: w.w * 0.25, y: w.h * 0.48, text: `⚡ Fast! +${speedCoins}`, life: 1.2, color: '#f59e0b' })
        }
        if (!spokeRef.current) {
          coinsDelta += 2
          stats.readBonuses += 1
          w.floaters.push({ x: w.w * 0.75, y: w.h * 0.48, text: '📖 Read it! +2', life: 1.2, color: '#3b82f6' })
        }
        // 🎮 earned play time: every correct answer banks Fun Zone seconds
        // (speed answers bank extra) — the better you score, the more you play
        stats.playSeconds += 5 + (speedBoost > 0 ? 2 : 0)
        stats.coins += coinsDelta
        w.grow += 1
        w.phase = 'celebrate'
        w.shake = bonusRef.current ? 14 : 8 + Math.min(w.streak, 6)
        const b = w.bubbles[bubbleIndex]
        spawnEat(b)
        playGulp()
        suckRemaining() // then hoover up the rest of the board
        const burst = 34 + Math.min(w.streak, 6) * 6 + (bonusRef.current ? 20 : 0)
        for (let i = 0; i < burst; i++) {
          w.particles.push({
            x: b.x,
            y: b.y,
            vx: (Math.random() - 0.5) * 12,
            vy: (Math.random() - 0.75) * 12,
            life: 1,
            color: CONFETTI[i % CONFETTI.length],
            size: 4 + Math.random() * 6,
          })
        }
        w.rings.push({ x: b.x, y: b.y, r: b.r * 0.5, life: 1, color: bonusRef.current ? '#eab308' : '#22c55e' })
        w.floaters.push({ x: b.x, y: b.y - b.r, text: `+${coinsDelta} 🪙${multiplier > 1 ? ` ×${multiplier}!` : ''}`, life: 1.2, color: '#eab308' })
        // Game Day's engine events say exactly what happened — a random
        // "First down!" over a tackle undoes the teaching (ship-check), so
        // gameday only keeps the honest streak shout
        const praise = football ? FOOTBALL_PRAISE : PRAISE
        if (!gameday) {
          w.floaters.push({
            x: w.w / 2,
            y: w.h * 0.55,
            text: w.streak >= 5 ? `🔥 ${w.streak} IN A ROW!` : praise[Math.floor(Math.random() * praise.length)],
            life: 1.4,
            color: '#16a34a',
          })
        } else if (w.streak >= 5) {
          w.floaters.push({ x: w.w / 2, y: w.h * 0.55, text: `🔥 ${w.streak} IN A ROW!`, life: 1.4, color: '#16a34a' })
        }
        if (football && !gameday) {
          // every right answer gains yards; hot streaks run farther
          const gain = w.streak >= 3 ? 15 : 10
          w.yards += gain
          w.floaters.push({ x: w.w / 2, y: w.h * 0.42, text: `🏈 +${gain} yards!`, life: 1.3, color: '#92400e' })
          if (w.yards >= 100) {
            // TOUCHDOWN — celebrate big, then start a fresh drive from the 20
            stats.touchdowns += 1
            w.yards = DRIVE_START
            w.tdFlash = 1
            w.shake = 18
            for (let i = 0; i < 60; i++) {
              w.particles.push({
                x: w.w / 2,
                y: w.h * 0.16,
                vx: (Math.random() - 0.5) * 14,
                vy: (Math.random() - 0.3) * 11,
                life: 1.1,
                color: CONFETTI[i % CONFETTI.length],
                size: 4 + Math.random() * 7,
              })
            }
            w.rings.push({ x: w.w / 2, y: w.h * 0.16, r: 20, life: 1, color: '#eab308' })
            w.floaters.push({ x: w.w / 2, y: w.h * 0.3, text: '🏈 TOUCHDOWN!!!', life: 2, color: '#ca8a04' })
            playTouchdown()
            speak('TOUCHDOWN!', true)
            setTds(stats.touchdowns)
          }
          setYards(w.yards)
        }
        playCorrect(w.streak)
        setStreak(w.streak)
        setCoins(stats.coins)
      } else {
        w.streak = 0
        w.phase = 'reveal'
        w.bubbles[bubbleIndex].wrongFlash = 1
        missesRef.current.push({
          skill: q.skill,
          prompt: q.prompt,
          visual: q.visual,
          picked: q.choices[bubbleIndex],
          answer: q.choices[q.answer],
          explain: q.explain,
        })
        // queue this miss for a comeback question in a future Mix round
        queueRef.current = [...queueRef.current, { skill: q.skill, difficulty: q.difficulty }].slice(-12)
        w.floaters.push({
          x: w.w / 2,
          y: w.h * 0.55,
          text: ENCOURAGE[Math.floor(Math.random() * ENCOURAGE.length)],
          life: 1.4,
          color: '#f97316',
        })
        playWrong()
        setStreak(0)
      }
      if (gameday) {
        if (correct) {
          // the question EARNED the play — after the gulp, the kid RUNS it
          // with their finger (dodge / chase / swing the kick)
          if (advanceTimerRef.current !== null) window.clearTimeout(advanceTimerRef.current)
          advanceTimerRef.current = window.setTimeout(() => {
            advanceTimerRef.current = null
            startMiniRef.current(pendingCallRef.current)
          }, 950)
        } else {
          // a wrong answer blows the play up at the snap — no mini-game
          const res = applyPlay(driveRef.current, pendingCallRef.current, { correct: false })
          applyFieldEvents(res)
          scheduleAdvance(3200)
        }
      } else {
        scheduleAdvance(correct ? 1350 : 3200)
      }
      setResults((r) => [...r, correct])
      onAnswer({
        skill: q.skill,
        difficulty: q.difficulty,
        correct,
        coins: coinsDelta,
        xp: correct ? 1 : 0,
        newTheta,
        newBestStreak: state.bestStreak,
        ms: elapsed,
      })
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [onAnswer, nextQuestion, playCorrect, playWrong, playTouchdown, skill, dailyDouble, football, gameday]
  )

  const scheduleAdvance = useCallback(
    (delay: number) => {
      if (advanceTimerRef.current !== null) window.clearTimeout(advanceTimerRef.current)
      advanceTimerRef.current = window.setTimeout(() => {
        advanceTimerRef.current = null
        const w = world.current
        const stats = statsRef.current
        w.ball.target = { x: w.w / 2, y: w.h * 0.78 }
        const idx = stats.answered
        // a touchdown on the last question still earns its extra-point try —
        // the XP kick is untimed in real football too (one extra question max)
        const extendForXp = gameday && driveRef.current.phase === 'xp' && idx < ROUND_LENGTH + 1
        if (idx >= ROUND_LENGTH && !extendForXp) {
          w.phase = 'done'
          const accuracy = stats.correct / stats.answered
          const stars: 1 | 2 | 3 = accuracy >= 0.9 ? 3 : accuracy >= 0.7 ? 2 : 1
          const chestBonus = stars === 3 ? 5 + Math.floor(Math.random() * 11) : 0
          if (stats.correct === stats.answered) stats.playSeconds += 15 // perfect round: extra Fun Zone time
          const deltas = (Object.keys(skillsRef.current) as SkillId[])
            .filter((k) => Math.round(skillsRef.current[k].theta) !== Math.round(startThetasRef.current[k]))
            .map((k) => ({ skill: k, from: Math.round(startThetasRef.current[k]), to: Math.round(skillsRef.current[k].theta) }))
          onComplete({
            skill,
            total: stats.answered,
            correct: stats.correct,
            coinsEarned: stats.coins + stars * 5 + chestBonus,
            stars,
            bestStreak: stats.bestStreak,
            deltas,
            misses: missesRef.current,
            chestBonus,
            dailyDouble,
            reviewQueue: queueRef.current,
            speedBonuses: stats.speedBonuses,
            readBonuses: stats.readBonuses,
            touchdowns: stats.touchdowns,
            playSecondsEarned: stats.playSeconds,
            ...(gameday ? { footballScore: { us: driveRef.current.us, them: driveRef.current.them } } : {}),
          })
        } else if (gameday) {
          setPicking(true) // call the next play first; the question follows the call
        } else {
          nextQuestion(idx)
        }
      }, delay)
    },
    [onComplete, nextQuestion, skill, dailyDouble, gameday]
  )

  // ------------------------------------------------------------- 🏈 the live play
  // The kid RUNS the play they earned: drag to dodge, drag to chase, or
  // pull-back-and-release to swing a kick. Assigned every render so the draw
  // loop always calls a fresh closure.
  startMiniRef.current = (call: PlayCall) => {
    const w = world.current
    const s = driveRef.current
    const g = fieldGeom(w)
    const u = Math.min(w.w, w.h)
    w.bubbles = []
    w.crumbs = []
    w.ball.target = null
    w.phase = 'mini'
    if (call === 'fg' || call === 'xp') {
      const tee = { x: w.w / 2, y: w.h * 0.72 }
      w.mini = { kind: 'kick', need: call === 'xp' ? 33 : kickDistance(s), tee, drag: null, flight: null, age: 0 }
      // the smiley stands beside the tee as the kicker
      w.ball.x = Math.min(w.w - w.ball.r, tee.x + u * 0.13)
      w.ball.y = tee.y + u * 0.015
      speak('Pull the ball back, then let go to kick!')
    } else if (call === 'tackle') {
      const startY = g.oppY(s.oppBall)
      w.mini = { kind: 'chase', runner: { x: w.w / 2, y: startY, tx: w.w / 2 }, startOpp: s.oppBall, finger: null, jukeT: 20, age: 0 }
      w.ball.x = w.w * 0.3
      w.ball.y = Math.min(g.trackBot - u * 0.05, startY + (g.trackBot - startY) * 0.45)
      speak('Here he comes! Drag your ball and tackle the runner!')
    } else {
      const carryStart = call === 'pass' ? Math.min(100, s.ball + PASS_AIR_YARDS) : s.ball
      const startY = g.spotY(carryStart)
      const goalY = g.spotY(100)
      w.ball.x = w.w / 2
      w.ball.y = call === 'pass' ? g.spotY(s.ball) : startY
      // tacklers wait between the carrier and the end zone — never right on
      // top of him (goal-line snaps get a cleared pocket)
      const bots: Array<{ x: number; y: number; vx: number; vy: number }> = []
      for (let i = 0; i < 4; i++) {
        const f = 0.3 + (i * 0.55) / 3
        const y = Math.max(goalY - u * 0.02, Math.min(startY - u * 0.18, startY + (goalY - startY) * f))
        let x = w.w * (0.15 + Math.random() * 0.7)
        // goal-to-go snaps squeeze every bot onto the goal line (ship-check
        // P1: a four-bot wall right on top of the carrier) — when a bot can't
        // get vertical room, it lines up OFF to the side instead
        if (Math.hypot(x - w.w / 2, y - startY) < u * 0.2) {
          x = w.w / 2 + (i % 2 === 0 ? -1 : 1) * (u * 0.26 + Math.random() * u * 0.12)
          x = Math.max(w.w * 0.08, Math.min(w.w * 0.92, x))
        }
        bots.push({ x, y, vx: 0, vy: 0 })
      }
      w.mini = { kind: 'carry', call, startBall: s.ball, throwT: call === 'pass' ? 36 : 0, finger: null, bots, heat: 0, age: 0 }
      speak(call === 'pass' ? 'Caught it! Now drag your ball and dodge the tacklers!' : 'Hand-off! Drag your ball — dodge the tacklers!')
    }
    setMiniOn(true)
  }

  finishPlayRef.current = (outcome: PlayOutcome) => {
    const w = world.current
    if (w.phase !== 'mini') return
    w.mini = null
    w.phase = 'celebrate'
    setMiniOn(false)
    const res = applyPlay(driveRef.current, pendingCallRef.current, outcome)
    applyFieldEvents(res)
    scheduleAdvance(res.events.some((e) => e.kind === 'touchdown') ? 2400 : 2000)
  }

  // ------------------------------------------------------------- input
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const toWorld = (e: PointerEvent) => {
      const rect = canvas.getBoundingClientRect()
      const w = world.current
      return { x: ((e.clientX - rect.left) / rect.width) * w.w, y: ((e.clientY - rect.top) / rect.height) * w.h }
    }
    const onPointer = (e: PointerEvent) => {
      ensureAudio()
      audioRef.current?.resume().catch(() => {})
      const w = world.current
      // 🏈 live play: the finger steers (or pulls back the kick)
      if (w.phase === 'mini' && w.mini) {
        try {
          canvas.setPointerCapture(e.pointerId)
        } catch {}
        const p = toWorld(e)
        if (w.mini.kind === 'kick') {
          // one finger owns the swing — a second touch can't reset the pull
          if (!w.mini.flight && !w.mini.drag) w.mini.drag = { x0: p.x, y0: p.y, x: p.x, y: p.y, pid: e.pointerId }
        } else {
          if (w.mini.pid === undefined) w.mini.pid = e.pointerId
          if (w.mini.pid === e.pointerId) w.mini.finger = p
        }
        return
      }
      if (w.phase !== 'idle' && w.phase !== 'reveal') return
      const { x, y } = toWorld(e)
      for (let i = 0; i < w.bubbles.length; i++) {
        const b = w.bubbles[i]
        const dist = Math.hypot(x - b.x, y - b.y)
        if (dist <= b.r * 1.15) {
          if (w.phase === 'reveal') {
            // after a miss, let them roll to the revealed answer — closes the
            // loop with a small win (no points, pure mastery)
            if (!b.isCorrect || b.eaten) return
            if (advanceTimerRef.current !== null) window.clearTimeout(advanceTimerRef.current)
            w.phase = 'redeem'
            w.tappedIndex = i
            w.ball.target = { x: b.x, y: b.y }
            return
          }
          w.phase = 'rolling'
          w.tappedIndex = i
          w.ball.target = { x: b.x, y: b.y }
          return
        }
      }
    }
    const onMove = (e: PointerEvent) => {
      const w = world.current
      if (w.phase !== 'mini' || !w.mini) return
      if (e.pointerType === 'mouse' && e.buttons === 0) return
      const p = toWorld(e)
      if (w.mini.kind === 'kick') {
        if (w.mini.drag && w.mini.drag.pid === e.pointerId) {
          w.mini.drag.x = p.x
          w.mini.drag.y = p.y
        }
      } else if (w.mini.pid === e.pointerId) {
        w.mini.finger = p
      }
    }
    const onCancel = (e: PointerEvent) => {
      // an OS-stolen gesture (notification swipe, palm rejection) DROPS the
      // pull — it must never launch a kick the kid didn't release
      const w = world.current
      if (w.phase !== 'mini' || !w.mini) return
      if (w.mini.kind === 'kick') {
        if (w.mini.drag?.pid === e.pointerId) w.mini.drag = null
      } else if (w.mini.pid === e.pointerId) {
        w.mini.pid = undefined
      }
    }
    const onUp = (e: PointerEvent) => {
      const w = world.current
      if (w.phase !== 'mini' || !w.mini) return
      if (w.mini.kind !== 'kick' && w.mini.pid === e.pointerId) {
        w.mini.pid = undefined // the carrier keeps running to the last spot; the next touch re-grabs
        return
      }
      const k = w.mini
      if (k.kind !== 'kick' || k.flight) return
      const d = k.drag
      if (!d || d.pid !== e.pointerId) return
      // the swing: pull back (down), let go — power from the pull length,
      // aim from the pull direction, exactly like a golf-game drive
      k.drag = null
      const px = d.x - d.x0
      const py = d.y - d.y0
      const len = Math.hypot(px, py)
      if (len < w.h * 0.05 || py < len * 0.35) {
        w.floaters.push({ x: w.w / 2, y: w.h * 0.5, text: '👆 Pull the ball DOWN, then let go!', life: 1.4, color: '#f8fafc' })
        return
      }
      const power = Math.min(1, len / (w.h * 0.34))
      // rounded exactly like the on-screen readout — the green arrow and the
      // scoring must never disagree (ship-check)
      const kickYd = Math.round(power * 65)
      const g = fieldGeom(w)
      const postY = g.zoneH * 0.5
      const slope = -px / py // launch = the pull, mirrored
      const frac = Math.min(1, kickYd / k.need)
      const endY = k.tee.y - (k.tee.y - postY) * frac
      const endX = k.tee.x + slope * (k.tee.y - endY)
      const good = kickYd >= k.need && Math.abs(endX - w.w / 2) <= w.w * 0.17
      k.flight = { t: 0, dur: 52, endX, endY, arc: Math.min(w.w, w.h) * (0.22 + power * 0.25), good }
      tone(300, 0, 0.09, 'triangle', 0.12) // the thump off the tee
    }
    canvas.addEventListener('pointerdown', onPointer)
    canvas.addEventListener('pointermove', onMove)
    canvas.addEventListener('pointerup', onUp)
    canvas.addEventListener('pointercancel', onCancel)
    return () => {
      canvas.removeEventListener('pointerdown', onPointer)
      canvas.removeEventListener('pointermove', onMove)
      canvas.removeEventListener('pointerup', onUp)
      canvas.removeEventListener('pointercancel', onCancel)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ------------------------------------------------------------- render loop
  useEffect(() => {
    const canvas = canvasRef.current
    const wrap = wrapRef.current
    if (!canvas || !wrap) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const resize = () => {
      const rect = wrap.getBoundingClientRect()
      const dpr = Math.min(window.devicePixelRatio || 1, 2)
      const w = world.current
      const prevW = w.w
      const prevH = w.h
      w.w = rect.width
      w.h = rect.height
      canvas.width = rect.width * dpr
      canvas.height = rect.height * dpr
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      // keep positions proportional on resize
      const sx = w.w / prevW
      const sy = w.h / prevH
      if (sx !== 1 || sy !== 1) {
        w.ball.x *= sx
        w.ball.y *= sy
        positionBubbles()
        // a rotation/keyboard resize mid-play rescales the live play too —
        // otherwise the tee, tacklers and flight sit at the old canvas's pixels
        const m = w.mini
        if (m) {
          if (m.kind === 'carry') {
            for (const b of m.bots) {
              b.x *= sx
              b.y *= sy
            }
          } else if (m.kind === 'chase') {
            m.runner.x *= sx
            m.runner.y *= sy
            m.runner.tx *= sx
          } else {
            m.tee.x *= sx
            m.tee.y *= sy
            if (m.drag) {
              m.drag.x0 *= sx
              m.drag.y0 *= sy
              m.drag.x *= sx
              m.drag.y *= sy
            }
            if (m.flight) {
              m.flight.endX *= sx
              m.flight.endY *= sy
              m.flight.arc *= sy
            }
          }
          if (m.kind !== 'kick' && m.finger) {
            m.finger.x *= sx
            m.finger.y *= sy
          }
        }
      }
      skyCacheRef.current.grad = null // gradient is sized to the canvas
    }
    resize()
    const ro = new ResizeObserver(resize)
    ro.observe(wrap)

    // initial ball placement
    const w0 = world.current
    w0.ball.x = w0.w / 2
    w0.ball.y = w0.h * 0.78

    let raf = 0
    const draw = () => {
      const w = world.current
      w.t += 1
      const { ball } = w
      const baseR = Math.min(w.w, w.h) * 0.07
      const targetR = Math.min(baseR * (1 + w.grow * 0.16), baseR * 2.3)
      ball.r += (targetR - ball.r) * 0.1

      // move ball toward target
      if (ball.target) {
        const dx = ball.target.x - ball.x
        const dy = ball.target.y - ball.y
        const dist = Math.hypot(dx, dy)
        const step = Math.max(dist * 0.14, 2)
        if (dist < 2) {
          ball.x = ball.target.x
          ball.y = ball.target.y
          if (w.phase === 'rolling') {
            const idx = w.tappedIndex
            ball.target = null
            w.phase = 'celebrate' // temporarily; resolveAnswer sets real phase
            resolveAnswer(idx)
          } else if (w.phase === 'redeem') {
            const b = w.bubbles[w.tappedIndex]
            ball.target = null
            spawnEat(b)
            playGulp()
            suckRemaining()
            w.shake = 6
            for (let i = 0; i < 20; i++) {
              w.particles.push({
                x: b.x, y: b.y,
                vx: (Math.random() - 0.5) * 8, vy: (Math.random() - 0.75) * 8,
                life: 1, color: CONFETTI[i % CONFETTI.length], size: 3 + Math.random() * 5,
              })
            }
            w.floaters.push({ x: w.w / 2, y: w.h * 0.55, text: 'Now you got it! 🎉', life: 1.3, color: '#16a34a' })
            playCorrect(0)
            w.phase = 'celebrate'
            scheduleAdvance(800)
          } else {
            ball.target = null
          }
        } else {
          ball.x += (dx / dist) * step
          ball.y += (dy / dist) * step
          ball.rot += step / ball.r
          // streak flame trail
          if (w.streak >= 3) {
            w.particles.push({
              x: ball.x - (dx / dist) * ball.r,
              y: ball.y - (dy / dist) * ball.r,
              vx: (Math.random() - 0.5) * 1.5,
              vy: (Math.random() - 0.5) * 1.5,
              life: 0.6,
              color: Math.random() < 0.5 ? '#f97316' : '#eab308',
              size: 3 + Math.random() * 3,
            })
          }
        }
      }

      // ---------- screen shake (decaying random offset on correct answers)
      ctx.save()
      if (w.shake > 0.5) {
        ctx.translate((Math.random() - 0.5) * w.shake, (Math.random() - 0.5) * w.shake)
        w.shake *= 0.86
      } else {
        w.shake = 0
      }

      // ---------- background
      if (football) {
        // stadium field: striped turf, yard lines, end zone up top — every
        // glyph scales off the canvas so phones read right
        const g = fieldGeom(w)
        const { zoneH, trackTop, trackBot, spotY } = g
        const u = Math.min(w.w, w.h)
        const fieldH = w.h - zoneH
        const stripes = 8
        for (let i = 0; i < stripes; i++) {
          ctx.fillStyle = i % 2 === 0 ? '#16a34a' : '#15803d'
          ctx.fillRect(-20, zoneH + (fieldH * i) / stripes, w.w + 40, fieldH / stripes + 1)
        }
        ctx.strokeStyle = 'rgba(255,255,255,0.7)'
        ctx.lineWidth = 2
        for (let i = 0; i <= stripes; i++) {
          const y = zoneH + (fieldH * i) / stripes
          ctx.beginPath()
          ctx.moveTo(-20, y)
          ctx.lineTo(w.w + 20, y)
          ctx.stroke()
        }
        // end zone — flashes gold after a touchdown
        if (w.tdFlash > 0) w.tdFlash = Math.max(0, w.tdFlash - 0.012)
        const flashOn = w.tdFlash > 0 && Math.sin(w.t * 0.4) > 0
        const gd = gameday ? driveRef.current : null
        const mini = gameday && w.phase === 'mini' ? w.mini : null
        ctx.fillStyle = flashOn ? '#eab308' : '#1d4ed8'
        ctx.fillRect(-20, -20, w.w + 40, zoneH + 20)
        ctx.fillStyle = 'rgba(255,255,255,0.92)'
        ctx.font = `900 ${Math.round(Math.min(zoneH * 0.42, w.w * 0.075))}px system-ui`
        ctx.textAlign = 'center'
        ctx.textBaseline = 'middle'
        ctx.fillText(w.tdFlash > 0 ? '🏈 TOUCHDOWN!' : gd ? `🐋🐗 ${gd.us} — ${gd.them} 🤖` : 'WHALEHOGS', w.w / 2, zoneH * 0.45)
        if (gd) {
          // goalposts in the end zone — field goals and extra points aim here
          const gx = w.w / 2
          const gw = w.w * 0.17
          ctx.strokeStyle = '#fde047'
          ctx.lineWidth = Math.max(4, u * 0.013)
          ctx.beginPath()
          ctx.moveTo(gx - gw, zoneH * 0.92)
          ctx.lineTo(gx + gw, zoneH * 0.92)
          ctx.moveTo(gx - gw, zoneH * 0.92)
          ctx.lineTo(gx - gw, zoneH * 0.2)
          ctx.moveTo(gx + gw, zoneH * 0.92)
          ctx.lineTo(gx + gw, zoneH * 0.2)
          ctx.stroke()
        }
        if (gd && gd.phase !== 'defense' && (!mini || mini.kind === 'carry')) {
          // TV grammar: blue line = where the ball is, yellow line = first down
          const scrimY = spotY(gd.ball)
          ctx.strokeStyle = 'rgba(59,130,246,0.8)'
          ctx.lineWidth = 3
          ctx.beginPath()
          ctx.moveTo(-20, scrimY)
          ctx.lineTo(w.w + 20, scrimY)
          ctx.stroke()
          if (gd.phase === 'offense' && gd.lineToGain < 100) {
            const lineY = spotY(gd.lineToGain)
            ctx.strokeStyle = 'rgba(250,204,21,0.9)'
            ctx.lineWidth = 4
            ctx.beginPath()
            ctx.moveTo(-20, lineY)
            ctx.lineTo(w.w + 20, lineY)
            ctx.stroke()
            if (!mini) {
              // the defense waits at the line (the live play draws real chasers)
              ctx.font = `${Math.round(Math.max(16, u * 0.055))}px system-ui`
              ctx.fillText('🤖', w.w * 0.3, lineY - u * 0.03)
              ctx.fillText('🤖', w.w * 0.7, lineY - u * 0.03)
            }
          }
        }
        if (gd && gd.phase === 'defense' && !mini) {
          // the Robots' runner waits to charge YOUR goal line (the bottom)
          const ry = g.oppY(gd.oppBall)
          const pulse = 1 + Math.sin(w.t * 0.15) * 0.12
          ctx.strokeStyle = 'rgba(220,38,38,0.8)'
          ctx.lineWidth = 3
          ctx.beginPath()
          ctx.arc(w.w / 2, ry, u * 0.05 * pulse, 0, Math.PI * 2)
          ctx.stroke()
          ctx.font = `${Math.round(Math.max(22, u * 0.07))}px system-ui`
          ctx.fillText('🤖', w.w / 2, ry)
          ctx.font = `800 ${Math.round(Math.max(12, u * 0.035))}px system-ui`
          ctx.fillStyle = 'rgba(255,255,255,0.95)'
          ctx.fillText(`${gd.oppBall} yds from your goal!`, w.w / 2, ry + u * 0.08)
        }
        if (!mini) {
          // drive marker: the ball climbs the left sideline toward the end zone
          ctx.fillStyle = 'rgba(255,255,255,0.92)'
          ctx.strokeStyle = 'rgba(255,255,255,0.45)'
          ctx.lineWidth = 3
          ctx.beginPath()
          ctx.moveTo(14, trackTop)
          ctx.lineTo(14, trackBot)
          ctx.stroke()
          ctx.font = `${Math.round(Math.max(16, u * 0.045))}px system-ui`
          ctx.fillText('🏈', 14, spotY(gd && gd.phase === 'defense' ? 0 : w.yards))
        }

        // ---------- 🏈 the live play: the kid runs what they earned
        if (mini) {
          mini.age++
          const botR = u * 0.048
          const hintFont = `800 ${Math.round(Math.max(15, u * 0.042))}px system-ui`
          if (mini.kind === 'carry') {
            const goalY = spotY(100)
            const scrimY = spotY(mini.startBall)
            if (mini.throwT > 0) {
              // the pass hangs in the air on its way to the catch point
              mini.throwT--
              const catchY = spotY(Math.min(100, mini.startBall + PASS_AIR_YARDS))
              const p = 1 - mini.throwT / 36
              ball.x = w.w / 2
              ball.y = scrimY + (catchY - scrimY) * p - Math.sin(p * Math.PI) * u * 0.16
              if (mini.throwT === 0) {
                ball.y = catchY
                w.floaters.push({ x: w.w / 2, y: catchY - u * 0.08, text: '🙌 CAUGHT!', life: 0.9, color: '#ffffff' })
              }
            } else {
              // steer the carrier toward the finger
              if (mini.finger) {
                const dx = mini.finger.x - ball.x
                const dy = mini.finger.y - ball.y
                const dist = Math.hypot(dx, dy)
                if (dist > 2) {
                  const step = Math.min(dist, Math.max(3.4, u * 0.0105))
                  ball.x += (dx / dist) * step
                  ball.y += (dy / dist) * step
                  ball.rot += step / ball.r
                }
              }
              ball.x = Math.max(ball.r * 0.8, Math.min(w.w - ball.r * 0.8, ball.x))
              ball.y = Math.max(goalY, Math.min(trackBot, ball.y))
              // tacklers hunt with momentum — they overshoot a good juke —
              // and heat up over time so every play ends; the grace beat
              // gives little fingers time to grab on
              const live = mini.age > 85 || mini.finger !== null
              if (live) mini.heat = Math.min(1.8, mini.heat + 0.0022)
              for (const b of mini.bots) {
                if (live) {
                  const dx = ball.x - b.x
                  const dy = ball.y - b.y
                  const dist = Math.hypot(dx, dy) || 1
                  const acc = (0.13 + mini.heat * 0.12) * (u / 500)
                  b.vx += (dx / dist) * acc
                  b.vy += (dy / dist) * acc
                  const cap = (1.8 + mini.heat * 1.5) * (u / 500)
                  const v = Math.hypot(b.vx, b.vy)
                  if (v > cap) {
                    b.vx = (b.vx / v) * cap
                    b.vy = (b.vy / v) * cap
                  }
                  b.x += b.vx
                  b.y += b.vy
                }
                ctx.font = `${Math.round(botR * 1.8)}px system-ui`
                ctx.textAlign = 'center'
                ctx.fillText('🤖', b.x, b.y)
              }
              const yards = Math.floor((scrimY - ball.y) / g.pxPerYd)
              if (ball.y <= goalY + 1) {
                finishPlayRef.current({ correct: true, yards: 100 - mini.startBall })
              } else if (live && mini.age > 30 && mini.bots.some((b) => Math.hypot(b.x - ball.x, b.y - ball.y) < ball.r * 0.8 + botR * 0.65)) {
                w.shake = 8
                finishPlayRef.current({ correct: true, yards: Math.max(0, yards) })
              } else if (mini.finger && yards > 0) {
                // live yardage readout while he runs
                ctx.font = `900 ${Math.round(Math.max(14, u * 0.04))}px system-ui`
                ctx.fillStyle = 'rgba(255,255,255,0.9)'
                ctx.fillText(`+${yards} yd`, Math.min(w.w - u * 0.08, ball.x + ball.r + u * 0.07), ball.y)
              }
              if (!mini.finger) {
                ctx.font = hintFont
                ctx.fillStyle = 'rgba(255,255,255,0.95)'
                ctx.fillText('👆 Drag to run — dodge the 🤖!', w.w / 2, Math.min(trackBot - u * 0.03, ball.y + ball.r + u * 0.08))
              }
            }
          } else if (mini.kind === 'chase') {
            // the Robots' runner breaks loose at the dashed line — catch him first
            const escY = Math.min(trackBot, g.oppY(mini.startOpp - 30))
            ctx.strokeStyle = 'rgba(220,38,38,0.85)'
            ctx.lineWidth = 3
            ctx.setLineDash([10, 8])
            ctx.beginPath()
            ctx.moveTo(-20, escY)
            ctx.lineTo(w.w + 20, escY)
            ctx.stroke()
            ctx.setLineDash([])
            const r = mini.runner
            if (mini.age > 70) {
              mini.jukeT--
              if (mini.jukeT <= 0) {
                mini.jukeT = 28 + Math.floor(Math.random() * 40)
                r.tx = w.w * (0.14 + Math.random() * 0.72)
              }
              const spd = Math.max(2.6, u * 0.008)
              r.y += spd * 0.74
              r.x += Math.max(-spd, Math.min(spd, (r.tx - r.x) * 0.07))
            }
            if (mini.finger) {
              const dx = mini.finger.x - ball.x
              const dy = mini.finger.y - ball.y
              const dist = Math.hypot(dx, dy)
              if (dist > 2) {
                const step = Math.min(dist, Math.max(3.4, u * 0.0105))
                ball.x += (dx / dist) * step
                ball.y += (dy / dist) * step
                ball.rot += step / ball.r
              }
            }
            ball.x = Math.max(ball.r * 0.8, Math.min(w.w - ball.r * 0.8, ball.x))
            ball.y = Math.max(trackTop, Math.min(trackBot, ball.y))
            const pulse = 1 + Math.sin(w.t * 0.15) * 0.12
            ctx.strokeStyle = 'rgba(220,38,38,0.8)'
            ctx.lineWidth = 3
            ctx.beginPath()
            ctx.arc(r.x, r.y, botR * 1.2 * pulse, 0, Math.PI * 2)
            ctx.stroke()
            ctx.font = `${Math.round(botR * 2)}px system-ui`
            ctx.textAlign = 'center'
            ctx.fillText('🤖', r.x, r.y)
            if (Math.hypot(r.x - ball.x, r.y - ball.y) < ball.r * 0.85 + botR * 0.8) {
              w.shake = 9
              finishPlayRef.current({ correct: true, tackled: true })
            } else if (r.y >= escY) {
              finishPlayRef.current({ correct: true, tackled: false })
            } else if (!mini.finger) {
              ctx.font = hintFont
              ctx.fillStyle = 'rgba(255,255,255,0.95)'
              ctx.fillText('👆 Drag your ball — CATCH him!', w.w / 2, Math.min(trackBot - u * 0.03, ball.y + ball.r + u * 0.08))
            }
          } else {
            // ⛳-style kick: pull back, let go
            const k = mini
            if (k.flight) {
              const f = k.flight
              f.t++
              const p = f.t / f.dur
              if (p >= 1) {
                for (let i = 0; i < (f.good ? 26 : 10); i++) {
                  w.particles.push({ x: f.endX, y: f.endY, vx: (Math.random() - 0.5) * 8, vy: (Math.random() - 0.4) * 7, life: 0.9, color: f.good ? '#fde047' : '#94a3b8', size: 3 + Math.random() * 5 })
                }
                finishPlayRef.current({ correct: true, made: f.good })
              } else {
                const x = k.tee.x + (f.endX - k.tee.x) * p
                const y = k.tee.y + (f.endY - k.tee.y) * p - Math.sin(p * Math.PI) * f.arc
                drawPigskin(ctx, x, y, u * 0.032, p * 9)
              }
            } else {
              drawPigskin(ctx, k.tee.x, k.tee.y, u * 0.04, -0.5)
              if (k.drag) {
                const d = k.drag
                const px = d.x - d.x0
                const py = d.y - d.y0
                const len = Math.hypot(px, py)
                const power = Math.min(1, len / (w.h * 0.34))
                const kickYd = Math.round(power * 65)
                const enough = kickYd >= k.need && py > len * 0.35
                if (len > 10 && py > 0) {
                  // the aim arrow mirrors the pull — like lining up a putt
                  const ax = k.tee.x - (px / len) * power * w.h * 0.3
                  const ay = k.tee.y - (py / len) * power * w.h * 0.3
                  ctx.strokeStyle = enough ? 'rgba(74,222,128,0.95)' : 'rgba(251,191,36,0.95)'
                  ctx.lineWidth = Math.max(4, u * 0.012)
                  ctx.setLineDash([8, 7])
                  ctx.beginPath()
                  ctx.moveTo(k.tee.x, k.tee.y)
                  ctx.lineTo(ax, ay)
                  ctx.stroke()
                  ctx.setLineDash([])
                  ctx.fillStyle = enough ? '#4ade80' : '#fbbf24'
                  ctx.beginPath()
                  ctx.arc(ax, ay, Math.max(5, u * 0.014), 0, Math.PI * 2)
                  ctx.fill()
                  ctx.font = `900 ${Math.round(Math.max(15, u * 0.045))}px system-ui`
                  ctx.textAlign = 'center'
                  ctx.fillText(`${kickYd} yds`, k.tee.x, k.tee.y + u * 0.1)
                }
              } else {
                ctx.font = hintFont
                ctx.fillStyle = 'rgba(255,255,255,0.95)'
                ctx.textAlign = 'center'
                ctx.fillText('👆 Pull the ball back… let go to KICK!', w.w / 2, k.tee.y + u * 0.12)
                ctx.font = `800 ${Math.round(Math.max(12, u * 0.034))}px system-ui`
                ctx.fillText(`${k.need} yards to the posts`, w.w / 2, k.tee.y + u * 0.12 + Math.max(16, u * 0.05))
              }
            }
          }
        }
      } else {
        if (!skyCacheRef.current.grad) {
          const sky = ctx.createLinearGradient(0, 0, 0, w.h)
          sky.addColorStop(0, '#bfe6ff')
          sky.addColorStop(0.55, '#dff2ff')
          sky.addColorStop(0.56, '#bbe98d')
          sky.addColorStop(1, '#8fd15f')
          skyCacheRef.current.grad = sky
        }
        ctx.fillStyle = skyCacheRef.current.grad
        ctx.fillRect(-20, -20, w.w + 40, w.h + 40)
        // sun
        ctx.fillStyle = 'rgba(255, 220, 100, 0.9)'
        ctx.beginPath()
        ctx.arc(w.w * 0.88, w.h * 0.08, 22, 0, Math.PI * 2)
        ctx.fill()
        // drifting clouds
        ctx.fillStyle = 'rgba(255,255,255,0.8)'
        for (let i = 0; i < 3; i++) {
          const cx = ((w.t * (0.2 + i * 0.08) + i * 200) % (w.w + 120)) - 60
          const cy = w.h * (0.07 + i * 0.05)
          ctx.beginPath()
          ctx.arc(cx, cy, 14, 0, Math.PI * 2)
          ctx.arc(cx + 16, cy + 4, 11, 0, Math.PI * 2)
          ctx.arc(cx - 16, cy + 4, 11, 0, Math.PI * 2)
          ctx.fill()
        }
      }

      // ---------- bubbles
      w.bubbles.forEach((b, i) => {
        // vacuum: sucked bubbles spiral into the ball, shrinking as they go
        if (b.sucked && !b.eaten) {
          const dx = ball.x - b.x
          const dy = ball.y - ball.r * 0.2 - b.y
          const dist = Math.hypot(dx, dy) || 1
          const pull = Math.max(7, dist * 0.17)
          b.x += (dx / dist) * pull - dy * 0.02
          b.y += (dy / dist) * pull + dx * 0.02
          b.r = Math.max(6, b.r * 0.955)
          w.eating = 1
          if (dist < ball.r * 0.9) {
            b.eaten = true
            ball.sy = 0.78
            ball.sx = 1.2
            w.grow += 0.4 // clearing the board makes you bigger too
            for (let k = 0; k < 6; k++) {
              w.particles.push({
                x: b.x, y: b.y,
                vx: (Math.random() - 0.5) * 6, vy: (Math.random() - 0.8) * 6,
                life: 0.8, color: '#dbeafe', size: 3 + Math.random() * 4,
              })
            }
            playNom()
            return
          }
        }
        if (b.eaten) {
          // pop: scale up + fade out
          if (b.pop > 0) {
            b.pop = Math.max(0, b.pop - 0.07)
            ctx.save()
            ctx.globalAlpha = b.pop
            ctx.translate(b.x, b.y)
            const s = 1 + (1 - b.pop) * 0.7
            ctx.strokeStyle = '#22c55e'
            ctx.lineWidth = 4
            ctx.beginPath()
            ctx.arc(0, 0, b.r * s, 0, Math.PI * 2)
            ctx.stroke()
            ctx.restore()
            ctx.globalAlpha = 1
          }
          return
        }
        const bob = Math.sin(w.t * 0.03 + i * 2.1) * 5
        const y = b.y + bob
        let shake = 0
        if (b.wrongFlash > 0) {
          b.wrongFlash = Math.max(0, b.wrongFlash - 0.02)
          shake = Math.sin(w.t * 0.9) * 5 * b.wrongFlash
        }
        const revealCorrect = w.phase === 'reveal' && b.isCorrect
        const pulse = revealCorrect ? 1 + Math.sin(w.t * 0.15) * 0.06 : 1

        ctx.save()
        ctx.translate(b.x + shake, y)
        ctx.scale(pulse, pulse)
        // bubble body
        const grad = ctx.createRadialGradient(-b.r * 0.3, -b.r * 0.3, b.r * 0.1, 0, 0, b.r)
        if (b.wrongFlash > 0) {
          grad.addColorStop(0, '#fecaca')
          grad.addColorStop(1, '#ef4444')
        } else if (revealCorrect) {
          grad.addColorStop(0, '#bbf7d0')
          grad.addColorStop(1, '#22c55e')
        } else {
          grad.addColorStop(0, '#ffffff')
          grad.addColorStop(1, '#dbeafe')
        }
        ctx.fillStyle = grad
        ctx.strokeStyle = revealCorrect ? '#15803d' : b.wrongFlash > 0 ? '#b91c1c' : '#93c5fd'
        ctx.lineWidth = 3
        ctx.beginPath()
        ctx.arc(0, 0, b.r, 0, Math.PI * 2)
        ctx.fill()
        ctx.stroke()
        // shine
        ctx.fillStyle = 'rgba(255,255,255,0.7)'
        ctx.beginPath()
        ctx.ellipse(-b.r * 0.35, -b.r * 0.4, b.r * 0.2, b.r * 0.12, -0.6, 0, Math.PI * 2)
        ctx.fill()
        // text (wrap "emoji word" pairs onto two lines)
        ctx.fillStyle = '#1e293b'
        ctx.textAlign = 'center'
        ctx.textBaseline = 'middle'
        const parts = b.text.includes(' ') ? b.text.split(' ') : [b.text]
        // emoji-led pairs ("🐱 cat") keep the big-picture layout; plain words don't
        const emojiTop = parts.length > 1 && parts[0].charCodeAt(0) > 255
        if (emojiTop) {
          const top = parts[0]
          const bottom = parts.slice(1).join(' ')
          ctx.font = `${Math.round(b.r * 0.62)}px system-ui`
          ctx.fillText(top, 0, -b.r * 0.28)
          const size = Math.min(b.r * 0.42, (b.r * 1.6) / Math.max(bottom.length * 0.55, 1))
          ctx.font = `700 ${Math.round(size)}px system-ui`
          ctx.fillText(bottom, 0, b.r * 0.36)
        } else if (parts.length > 1) {
          // plain multi-word choice (e.g. "at the beach"): two lines, split at
          // the point that balances CHARACTERS (a word-count split put three
          // words on one line and shrank the font past legible)
          let l1 = parts[0]
          let l2 = parts.slice(1).join(' ')
          let best = Math.max(l1.length, l2.length)
          for (let cut = 2; cut < parts.length; cut++) {
            const a = parts.slice(0, cut).join(' ')
            const b = parts.slice(cut).join(' ')
            if (Math.max(a.length, b.length) < best) {
              best = Math.max(a.length, b.length)
              l1 = a
              l2 = b
            }
          }
          const longest = best
          const size = Math.min(b.r * 0.45, (b.r * 1.7) / Math.max(longest * 0.55, 1))
          ctx.font = `800 ${Math.round(size)}px system-ui`
          ctx.fillText(l1, 0, -b.r * 0.24)
          ctx.fillText(l2, 0, b.r * 0.24)
        } else {
          const txt = parts[0]
          const size = Math.min(b.r * 0.85, (b.r * 1.7) / Math.max(txt.length * 0.58, 1))
          ctx.font = `800 ${Math.round(size)}px system-ui`
          ctx.fillText(txt, 0, 0)
        }
        ctx.restore()
      })

      // ---------- crumbs spiral into the ball (the "eat")
      w.crumbs = w.crumbs.filter((c) => {
        const dx = ball.x - c.x
        const dy = ball.y - ball.r * 0.2 - c.y
        const dist = Math.hypot(dx, dy)
        if (dist < ball.r * 0.5) {
          // gulp! squash the ball as each crumb lands
          ball.sy = 0.78
          ball.sx = 1.2
          return false
        }
        // accelerate toward the mouth with a little spiral
        c.vx += (dx / dist) * 1.6 - dy * 0.004
        c.vy += (dy / dist) * 1.6 + dx * 0.004
        c.vx *= 0.88
        c.vy *= 0.88
        c.x += c.vx
        c.y += c.vy
        ctx.fillStyle = c.color
        ctx.beginPath()
        ctx.arc(c.x, c.y, c.size, 0, Math.PI * 2)
        ctx.fill()
        ctx.strokeStyle = '#93c5fd'
        ctx.lineWidth = 1
        ctx.stroke()
        return true
      })
      w.eating = w.crumbs.length > 0 ? 1 : Math.max(0, w.eating - 0.06)

      // ---------- ball
      ctx.save()
      ctx.translate(ball.x, ball.y)
      // shadow
      ctx.fillStyle = 'rgba(0,0,0,0.15)'
      ctx.beginPath()
      ctx.ellipse(0, ball.r * 0.95, ball.r * 0.8, ball.r * 0.22, 0, 0, Math.PI * 2)
      ctx.fill()
      // squash & stretch eases back after each gulp
      ball.sx += (1 - ball.sx) * 0.18
      ball.sy += (1 - ball.sy) * 0.18
      ctx.scale(ball.sx, ball.sy)
      if (football) {
        // the football: brown pointed ellipse with laces, wobbling as it runs
        ctx.save()
        ctx.rotate(Math.sin(ball.rot * 1.4) * 0.1)
        const fg = ctx.createRadialGradient(-ball.r * 0.3, -ball.r * 0.3, ball.r * 0.15, 0, 0, ball.r * 1.2)
        fg.addColorStop(0, '#b45309')
        fg.addColorStop(1, '#7c2d12')
        ctx.fillStyle = fg
        ctx.beginPath()
        ctx.ellipse(0, 0, ball.r * 1.16, ball.r * 0.86, 0, 0, Math.PI * 2)
        ctx.fill()
        ctx.strokeStyle = '#451a03'
        ctx.lineWidth = Math.max(2, ball.r * 0.06)
        ctx.stroke()
        // tip stripes + laces
        ctx.strokeStyle = '#fef3c7'
        ctx.lineWidth = Math.max(2, ball.r * 0.08)
        ctx.beginPath()
        ctx.moveTo(-ball.r * 0.8, -ball.r * 0.32)
        ctx.quadraticCurveTo(-ball.r * 0.96, 0, -ball.r * 0.8, ball.r * 0.32)
        ctx.stroke()
        ctx.beginPath()
        ctx.moveTo(ball.r * 0.8, -ball.r * 0.32)
        ctx.quadraticCurveTo(ball.r * 0.96, 0, ball.r * 0.8, ball.r * 0.32)
        ctx.stroke()
        ctx.beginPath()
        ctx.moveTo(-ball.r * 0.42, -ball.r * 0.52)
        ctx.lineTo(ball.r * 0.42, -ball.r * 0.52)
        ctx.stroke()
        for (let i = 0; i < 4; i++) {
          const lx = -ball.r * 0.3 + i * ball.r * 0.2
          ctx.beginPath()
          ctx.moveTo(lx, -ball.r * 0.62)
          ctx.lineTo(lx, -ball.r * 0.42)
          ctx.stroke()
        }
        ctx.restore()
      } else {
        // body
        const bodyGrad = ctx.createRadialGradient(-ball.r * 0.3, -ball.r * 0.3, ball.r * 0.15, 0, 0, ball.r)
        bodyGrad.addColorStop(0, activeSkin.colors[0])
        bodyGrad.addColorStop(1, activeSkin.colors[1])
        ctx.fillStyle = bodyGrad
        ctx.beginPath()
        ctx.arc(0, 0, ball.r, 0, Math.PI * 2)
        ctx.fill()
        // rolling stripe
        ctx.save()
        ctx.rotate(ball.rot)
        ctx.strokeStyle = 'rgba(255,255,255,0.45)'
        ctx.lineWidth = ball.r * 0.18
        ctx.beginPath()
        ctx.arc(0, 0, ball.r * 0.62, 0.3, 1.6)
        ctx.stroke()
        ctx.beginPath()
        ctx.arc(0, 0, ball.r * 0.62, Math.PI + 0.3, Math.PI + 1.6)
        ctx.stroke()
        if (activeSkin.emoji) {
          ctx.font = `${Math.round(ball.r * 0.9)}px system-ui`
          ctx.textAlign = 'center'
          ctx.textBaseline = 'middle'
          ctx.fillText(activeSkin.emoji, 0, 0)
        }
        ctx.restore()
      }
      // face (always upright)
      const happy = w.phase === 'celebrate'
      const eyeY = -ball.r * 0.18
      ctx.fillStyle = '#fff'
      ctx.beginPath()
      ctx.arc(-ball.r * 0.3, eyeY, ball.r * 0.16, 0, Math.PI * 2)
      ctx.arc(ball.r * 0.3, eyeY, ball.r * 0.16, 0, Math.PI * 2)
      ctx.fill()
      ctx.fillStyle = '#1e293b'
      ctx.beginPath()
      ctx.arc(-ball.r * 0.3, eyeY, ball.r * 0.07, 0, Math.PI * 2)
      ctx.arc(ball.r * 0.3, eyeY, ball.r * 0.07, 0, Math.PI * 2)
      ctx.fill()
      if (w.eating > 0.25) {
        // wide-open chomping mouth while crumbs fly in
        ctx.fillStyle = '#7f1d1d'
        ctx.beginPath()
        ctx.ellipse(0, ball.r * 0.32, ball.r * 0.34, ball.r * 0.4 * w.eating, 0, 0, Math.PI * 2)
        ctx.fill()
        ctx.fillStyle = '#fca5a5'
        ctx.beginPath()
        ctx.ellipse(0, ball.r * 0.45, ball.r * 0.18, ball.r * 0.14 * w.eating, 0, 0, Math.PI * 2)
        ctx.fill()
      } else {
        ctx.strokeStyle = '#1e293b'
        ctx.lineWidth = Math.max(2, ball.r * 0.07)
        ctx.lineCap = 'round'
        ctx.beginPath()
        if (happy) ctx.arc(0, ball.r * 0.15, ball.r * 0.32, 0.15, Math.PI - 0.15)
        else ctx.arc(0, ball.r * 0.22, ball.r * 0.24, 0.3, Math.PI - 0.3)
        ctx.stroke()
      }
      // streak status gear: shades at 4+, crown at 7+
      if (w.streak >= 4) {
        ctx.fillStyle = '#1e293b'
        const gw = ball.r * 0.42
        ctx.beginPath()
        ctx.roundRect(-ball.r * 0.3 - gw / 2, eyeY - gw * 0.35, gw, gw * 0.7, gw * 0.2)
        ctx.roundRect(ball.r * 0.3 - gw / 2, eyeY - gw * 0.35, gw, gw * 0.7, gw * 0.2)
        ctx.fill()
        ctx.strokeStyle = '#1e293b'
        ctx.lineWidth = Math.max(2, ball.r * 0.06)
        ctx.beginPath()
        ctx.moveTo(-ball.r * 0.3 + gw / 2, eyeY)
        ctx.lineTo(ball.r * 0.3 - gw / 2, eyeY)
        ctx.stroke()
      }
      if (w.streak >= 7) {
        ctx.fillStyle = '#fbbf24'
        ctx.strokeStyle = '#d97706'
        ctx.lineWidth = 2
        const cw = ball.r * 0.9
        const cy = -ball.r * 1.05
        ctx.beginPath()
        ctx.moveTo(-cw / 2, cy)
        ctx.lineTo(-cw / 2, cy - cw * 0.35)
        ctx.lineTo(-cw / 4, cy - cw * 0.15)
        ctx.lineTo(0, cy - cw * 0.45)
        ctx.lineTo(cw / 4, cy - cw * 0.15)
        ctx.lineTo(cw / 2, cy - cw * 0.35)
        ctx.lineTo(cw / 2, cy)
        ctx.closePath()
        ctx.fill()
        ctx.stroke()
      }
      ctx.restore()

      // ---------- shockwave rings
      w.rings = w.rings.filter((r) => r.life > 0)
      w.rings.forEach((r) => {
        r.r += 5
        r.life -= 0.04
        ctx.globalAlpha = Math.max(0, r.life) * 0.7
        ctx.strokeStyle = r.color
        ctx.lineWidth = 5 * r.life
        ctx.beginPath()
        ctx.arc(r.x, r.y, r.r, 0, Math.PI * 2)
        ctx.stroke()
      })
      ctx.globalAlpha = 1

      // ---------- particles
      w.particles = w.particles.filter((p) => p.life > 0)
      w.particles.forEach((p) => {
        p.x += p.vx
        p.y += p.vy
        p.vy += 0.18
        p.life -= 0.022
        ctx.globalAlpha = Math.max(0, p.life)
        ctx.fillStyle = p.color
        ctx.fillRect(p.x, p.y, p.size, p.size)
      })
      ctx.globalAlpha = 1

      // ---------- floaters
      w.floaters = w.floaters.filter((f) => f.life > 0)
      w.floaters.forEach((f) => {
        f.y -= 0.8
        f.life -= 0.016
        ctx.globalAlpha = Math.max(0, Math.min(1, f.life))
        ctx.font = `800 ${Math.round(Math.max(17, Math.min(26, w.w * 0.058)))}px system-ui`
        ctx.textAlign = 'center'
        ctx.textBaseline = 'middle'
        ctx.strokeStyle = 'rgba(255,255,255,0.9)'
        ctx.lineWidth = 5
        ctx.strokeText(f.text, f.x, f.y)
        ctx.fillStyle = f.color
        ctx.fillText(f.text, f.x, f.y)
      })
      ctx.globalAlpha = 1
      ctx.restore() // close screen-shake transform

      raf = requestAnimationFrame(draw)
    }
    raf = requestAnimationFrame(draw)
    return () => {
      cancelAnimationFrame(raf)
      ro.disconnect()
    }
  }, [activeSkin, football, gameday, resolveAnswer])

  // ------------------------------------------------------------- UI
  const skillMeta = question ? SKILLS.find((s) => s.id === question.skill) : null

  return (
    <div className="flex flex-col flex-1 min-h-0 max-w-lg mx-auto w-full">
      {/* HUD */}
      <div className="flex items-center justify-between px-3 py-2">
        <button
          onClick={onQuit}
          aria-label="Exit round"
          className="w-9 h-9 rounded-full bg-white/80 border border-slate-200 flex items-center justify-center text-slate-500 active:scale-95"
        >
          <X className="w-5 h-5" />
        </button>
        <div className="flex gap-1.5" aria-label="Round progress">
          {/* the XP kick is an 11th answer — the dots row grows with it */}
          {Array.from({ length: Math.max(ROUND_LENGTH, results.length, qIndex + 1) }).map((_, i) => (
            <span
              key={i}
              className={`w-2.5 h-2.5 rounded-full transition-colors ${
                i < results.length ? (results[i] ? 'bg-green-500' : 'bg-orange-400') : i === qIndex ? 'bg-blue-500 animate-pulse' : 'bg-slate-300'
              }`}
            />
          ))}
        </div>
        <div className="flex items-center gap-2">
          {football && (
            <span className="text-[10px] font-extrabold text-amber-100 bg-green-700 border border-green-800 rounded-full px-2 py-0.5 whitespace-nowrap">
              {gameday
                ? drive.phase === 'offense'
                  ? `🏈 ${downWords(drive)}`
                  : drive.phase === 'xp'
                  ? '🦵 XP kick'
                  : '🛡️ DEFENSE'
                : `🏈 ${yards} yd${tds > 0 ? ` · TD×${tds}` : ''}`}
            </span>
          )}
          {dailyDouble && <span className="text-[10px] font-extrabold text-orange-600 bg-orange-100 border border-orange-300 rounded-full px-2 py-0.5">🌅 2×</span>}
          {streak >= 3 && <span className="text-sm font-extrabold text-orange-500">🔥{streak}</span>}
          <span className="text-sm font-extrabold text-yellow-600 bg-yellow-100 border border-yellow-300 rounded-full px-2 py-0.5">
            🪙 {coins}
          </span>
        </div>
      </div>

      {/* Question banner */}
      <div className="mx-3 mb-2 rounded-2xl bg-white shadow-md border-2 border-blue-200 px-4 py-3 text-center relative">
        {skillMeta && (
          <span className="absolute -top-2.5 left-3 text-[10px] font-extrabold uppercase tracking-wide bg-blue-500 text-white rounded-full px-2 py-0.5">
            {skillMeta.emoji} {skillDisplayName(skillMeta, !!profile.isTester)}
          </span>
        )}
        {question && !(gameday && picking) && (
          <span className="absolute -top-2.5 right-3 text-[10px] font-extrabold bg-purple-500 text-white rounded-full px-2 py-0.5">
            ⚡ Level {question.difficulty}
          </span>
        )}
        {isBonus && !(gameday && picking) && (
          <span className="absolute -bottom-2.5 left-1/2 -translate-x-1/2 text-[11px] font-extrabold bg-gradient-to-r from-yellow-400 to-orange-500 text-white rounded-full px-3 py-0.5 animate-bounce shadow">
            ✨ BONUS — 2× coins!
          </span>
        )}
        <div className="flex items-center justify-center gap-2">
          <p className="text-lg font-extrabold text-slate-800 leading-snug">{gameday && picking ? '📣 Call your play!' : miniOn ? '🏈 RUN THE PLAY!' : question?.prompt}</p>
          <button
            onClick={() => {
              ensureAudio()
              // the stale question must not read over the play call OR the live play
              if (gameday && (picking || miniOn)) return
              spokeRef.current = true // asked for the voice — no reading bonus
              if (question) speak(question.speech)
            }}
            aria-label="Hear the question"
            className="shrink-0 w-10 h-10 rounded-full bg-blue-500 text-white flex items-center justify-center shadow active:scale-95"
          >
            <Volume2 className="w-5 h-5" />
          </button>
          {micDoor !== 'none' && question && voiceable(question.choices) && !(gameday && (picking || miniOn)) && (
            <button
              onClick={onMic}
              aria-label={listening ? 'Stop listening' : 'Say your answer'}
              className={`shrink-0 w-10 h-10 rounded-full flex items-center justify-center shadow active:scale-95 ${
                listening ? 'bg-red-500 text-white animate-pulse' : micDoor === 'update' ? 'bg-slate-200 text-slate-400' : 'bg-green-500 text-white'
              }`}
            >
              <Mic className="w-5 h-5" />
            </button>
          )}
        </div>
        {question?.visual && !(gameday && (picking || miniOn)) && (
          <p className="mt-1 text-3xl leading-relaxed whitespace-pre-wrap break-words">{question.visual}</p>
        )}
        {/* ⚡ speed window: answer while the bar still glows for bonus coins */}
        <div className={`mt-2 flex items-center gap-1.5 ${gameday && (picking || miniOn) ? 'invisible' : ''}`}>
          <span className="text-[10px]">⚡</span>
          <div className="flex-1 h-1.5 rounded-full bg-slate-100 overflow-hidden">
            {/* keyed on picking too — gameday's first question otherwise reuses
                the bar that started draining while the play-call sheet was up */}
            <div key={`${qIndex}-${picking ? 'pick' : 'q'}`} className="h-full rounded-full bg-gradient-to-r from-yellow-400 to-orange-500" style={{ animation: `bb-speedbar ${QUICK_MS}ms linear forwards` }} />
          </div>
        </div>
        <style>{`@keyframes bb-speedbar { from { width: 100% } to { width: 0% } }`}</style>
      </div>

      {/* Game canvas */}
      <div ref={wrapRef} className="relative flex-1 min-h-[320px] mx-3 mb-3 rounded-2xl overflow-hidden shadow-inner border-2 border-green-200">
        <canvas ref={canvasRef} className="absolute inset-0 w-full h-full touch-none" />
        {gameday && picking && (
          <div className="absolute inset-0 z-10 bg-slate-900/50 flex items-end justify-center p-2 pb-3 overflow-y-auto">
            <div className="w-full max-w-sm rounded-3xl bg-white p-3 shadow-2xl">
              <p className="text-center text-sm font-black text-slate-800">
                {drive.phase === 'offense'
                  ? `${downWords(drive)} · ball on ${spotWords(drive)}`
                  : drive.phase === 'xp'
                  ? '🏈 TOUCHDOWN — now the extra point!'
                  : '🤖 The Robots have the ball!'}
              </p>
              <p className="text-center text-[11px] font-bold text-slate-400 mb-3">
                {drive.phase === 'offense'
                  ? drive.down === 4
                    ? '⚠️ 4th down — make it, kick it, or the Robots take over!'
                    : 'Pick a play — then answer the question to run it!'
                  : drive.phase === 'xp'
                  ? 'Answer right to kick it through for 1 more point'
                  : 'Answer right to TACKLE the runner!'}
              </p>
              <div className="grid gap-2">
                {availableCalls(drive).map((c) => {
                  const d = describeCall(c, drive)
                  return (
                    <button
                      key={c}
                      onClick={() => callPlay(c)}
                      className={`w-full rounded-2xl border-b-4 px-4 py-3 text-left active:scale-95 active:border-b-2 transition-all ${
                        c === 'tackle' || c === 'xp' || (c === 'fg' && drive.down === 4)
                          ? 'bg-gradient-to-b from-amber-400 to-orange-500 border-orange-700 text-white'
                          : 'bg-gradient-to-b from-green-500 to-green-700 border-green-800 text-white'
                      }`}
                    >
                      <span className="block text-base font-black">
                        {d.emoji} {d.name}
                      </span>
                      <span className="block text-[11px] font-semibold opacity-90">{d.blurb}</span>
                    </button>
                  )
                })}
              </div>
            </div>
          </div>
        )}
      </div>

      <div className="px-4 pb-3 flex items-center justify-between text-xs text-slate-400">
        <span>
          {gameday
            ? miniOn
              ? '👆 Drag on the field — YOU are running the play!'
              : 'Call it, answer it, then RUN it with your finger!'
            : football
            ? 'Tap the answer — run it downfield for yards!'
            : 'Tap the answer — the ball rolls over and eats it!'}
        </span>
        <button
          onClick={() =>
            setMuted((m) => {
              if (!m) cancelSpeech() // silence an in-flight voice immediately
              return !m
            })
          }
          className="font-bold text-slate-500 underline"
        >
          {muted ? '🔇 Sound off' : '🔊 Sound on'}
        </button>
      </div>
    </div>
  )
}
