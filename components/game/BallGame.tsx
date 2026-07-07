'use client'

// Brain Ball — the rolling-ball answer game (hole.io-style: eat the right
// answer bubble and grow). Canvas render loop + DOM question banner.

import { useCallback, useEffect, useRef, useState } from 'react'
import { Volume2, X } from 'lucide-react'
import { ADULT_THETA_CAP, nextDifficulty, pickMixSkill, updateTheta } from '@/lib/game/adaptive'
import { ADULT_SKILL_NAMES, generateQuestion, SKILLS } from '@/lib/game/questions'
import { speak as speakText } from '@/lib/game/speech'
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

type Phase = 'idle' | 'rolling' | 'celebrate' | 'reveal' | 'redeem' | 'done'

const CONFETTI = ['#f97316', '#22c55e', '#3b82f6', '#eab308', '#ec4899', '#a855f7']
const PRAISE = ['Great job!', 'You got it!', 'Awesome!', 'Super smart!', 'Nice one!', 'Wow!', 'Go Whalehogs!', 'Whalehog smart!']
const ENCOURAGE = ['Good try!', 'Almost!', 'Keep going!', "You'll get it!", "We don't say can't!", 'Whalehogs never quit!']

function clone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v))
}

export function BallGame({ profile, skill, dailyDouble = false, onAnswer, onComplete, onQuit }: BallGameProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const wrapRef = useRef<HTMLDivElement>(null)

  const [question, setQuestion] = useState<Question | null>(null)
  const [qIndex, setQIndex] = useState(0)
  const [coins, setCoins] = useState(0)
  const [streak, setStreak] = useState(0)
  const [results, setResults] = useState<boolean[]>([])
  const [muted, setMuted] = useState(false)
  const [isBonus, setIsBonus] = useState(false)

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
  })
  const skillsRef = useRef<Record<SkillId, SkillState>>(clone(profile.skills))
  const startThetasRef = useRef<Record<SkillId, number>>(
    Object.fromEntries(Object.entries(profile.skills).map(([k, s]) => [k, s.theta])) as Record<SkillId, number>
  )
  const questionRef = useRef<Question | null>(null)
  const statsRef = useRef({ correct: 0, coins: 0, bestStreak: 0, answered: 0, speedBonuses: 0, readBonuses: 0 })
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

  const speak = useCallback((text: string) => {
    if (mutedRef.current) return
    speakText(text, { rate: 0.97 })
  }, [])

  // ------------------------------------------------------------- questions
  const layoutBubbles = useCallback((q: Question) => {
    const w = world.current
    const r = Math.min(w.w, w.h) * 0.135
    const two = q.choices.length === 2
    const xs = two ? [0.3, 0.7] : [0.2, 0.5, 0.8]
    const ys = two ? [0.27, 0.27] : [0.3, 0.24, 0.3]
    w.bubbles = q.choices.map((text, i) => ({
      x: w.w * xs[i % 3],
      y: w.h * ys[i % 3],
      r,
      text,
      eaten: false,
      pop: 0,
      wrongFlash: 0,
      isCorrect: i === q.answer,
    }))
  }, [])

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
        if (questionRef.current === q && world.current.phase === 'idle') {
          spokeRef.current = true
          speak(bonus ? `Bonus question! Double coins! ${q.speech}` : q.speech)
        }
      }, AUTO_READ_DELAY_MS)
    },
    [skill, layoutBubbles, speak, profile.birthdate, profile.isTester]
  )

  // start round
  useEffect(() => {
    nextQuestion(0)
    // preload voices (some browsers populate the list async)
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) window.speechSynthesis.getVoices()
    return () => {
      if (autoReadTimerRef.current !== null) window.clearTimeout(autoReadTimerRef.current)
      if (typeof window !== 'undefined' && 'speechSynthesis' in window) window.speechSynthesis.cancel()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ------------------------------------------------------------- answer resolution
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
        stats.coins += coinsDelta
        w.grow += 1
        w.phase = 'celebrate'
        w.shake = bonusRef.current ? 14 : 8 + Math.min(w.streak, 6)
        const b = w.bubbles[bubbleIndex]
        spawnEat(b)
        playGulp()
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
        w.floaters.push({
          x: w.w / 2,
          y: w.h * 0.55,
          text: w.streak >= 5 ? `🔥 ${w.streak} IN A ROW!` : PRAISE[Math.floor(Math.random() * PRAISE.length)],
          life: 1.4,
          color: '#16a34a',
        })
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
      setResults((r) => [...r, correct])
      onAnswer({ skill: q.skill, difficulty: q.difficulty, correct, coins: coinsDelta, xp: correct ? 1 : 0, newTheta, ms: elapsed })

      scheduleAdvance(correct ? 900 : 3200)
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [onAnswer, nextQuestion, playCorrect, playWrong, skill, dailyDouble]
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
        if (idx >= ROUND_LENGTH) {
          w.phase = 'done'
          const accuracy = stats.correct / ROUND_LENGTH
          const stars: 1 | 2 | 3 = accuracy >= 0.9 ? 3 : accuracy >= 0.7 ? 2 : 1
          const chestBonus = stars === 3 ? 5 + Math.floor(Math.random() * 11) : 0
          const deltas = (Object.keys(skillsRef.current) as SkillId[])
            .filter((k) => Math.round(skillsRef.current[k].theta) !== Math.round(startThetasRef.current[k]))
            .map((k) => ({ skill: k, from: Math.round(startThetasRef.current[k]), to: Math.round(skillsRef.current[k].theta) }))
          onComplete({
            skill,
            total: ROUND_LENGTH,
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
          })
        } else {
          nextQuestion(idx)
        }
      }, delay)
    },
    [onComplete, nextQuestion, skill, dailyDouble]
  )

  // ------------------------------------------------------------- input
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const onPointer = (e: PointerEvent) => {
      ensureAudio()
      audioRef.current?.resume().catch(() => {})
      const w = world.current
      if (w.phase !== 'idle' && w.phase !== 'reveal') return
      const rect = canvas.getBoundingClientRect()
      const x = ((e.clientX - rect.left) / rect.width) * w.w
      const y = ((e.clientY - rect.top) / rect.height) * w.h
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
    canvas.addEventListener('pointerdown', onPointer)
    return () => canvas.removeEventListener('pointerdown', onPointer)
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
        const r = Math.min(w.w, w.h) * 0.135
        const two = w.bubbles.length === 2
        const xs = two ? [0.3, 0.7] : [0.2, 0.5, 0.8]
        const ys = two ? [0.27, 0.27] : [0.3, 0.24, 0.3]
        w.bubbles.forEach((b, i) => {
          b.x = w.w * xs[i % xs.length]
          b.y = w.h * ys[i % ys.length]
          b.r = r
        })
      }
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
      const sky = ctx.createLinearGradient(0, 0, 0, w.h)
      sky.addColorStop(0, '#bfe6ff')
      sky.addColorStop(0.55, '#dff2ff')
      sky.addColorStop(0.56, '#bbe98d')
      sky.addColorStop(1, '#8fd15f')
      ctx.fillStyle = sky
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

      // ---------- bubbles
      w.bubbles.forEach((b, i) => {
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
        if (parts.length > 1) {
          const top = parts[0]
          const bottom = parts.slice(1).join(' ')
          ctx.font = `${Math.round(b.r * 0.62)}px system-ui`
          ctx.fillText(top, 0, -b.r * 0.28)
          const size = Math.min(b.r * 0.42, (b.r * 1.6) / Math.max(bottom.length * 0.55, 1))
          ctx.font = `700 ${Math.round(size)}px system-ui`
          ctx.fillText(bottom, 0, b.r * 0.36)
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
        ctx.font = '800 22px system-ui'
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
  }, [activeSkin, resolveAnswer])

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
          {Array.from({ length: ROUND_LENGTH }).map((_, i) => (
            <span
              key={i}
              className={`w-2.5 h-2.5 rounded-full transition-colors ${
                i < results.length ? (results[i] ? 'bg-green-500' : 'bg-orange-400') : i === qIndex ? 'bg-blue-500 animate-pulse' : 'bg-slate-300'
              }`}
            />
          ))}
        </div>
        <div className="flex items-center gap-2">
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
            {skillMeta.emoji} {profile.isTester ? ADULT_SKILL_NAMES[skillMeta.id] : skillMeta.name}
          </span>
        )}
        {question && (
          <span className="absolute -top-2.5 right-3 text-[10px] font-extrabold bg-purple-500 text-white rounded-full px-2 py-0.5">
            ⚡ Level {question.difficulty}
          </span>
        )}
        {isBonus && (
          <span className="absolute -bottom-2.5 left-1/2 -translate-x-1/2 text-[11px] font-extrabold bg-gradient-to-r from-yellow-400 to-orange-500 text-white rounded-full px-3 py-0.5 animate-bounce shadow">
            ✨ BONUS — 2× coins!
          </span>
        )}
        <div className="flex items-center justify-center gap-2">
          <p className="text-lg font-extrabold text-slate-800 leading-snug">{question?.prompt}</p>
          <button
            onClick={() => {
              ensureAudio()
              spokeRef.current = true // asked for the voice — no reading bonus
              if (question) speak(question.speech)
            }}
            aria-label="Hear the question"
            className="shrink-0 w-10 h-10 rounded-full bg-blue-500 text-white flex items-center justify-center shadow active:scale-95"
          >
            <Volume2 className="w-5 h-5" />
          </button>
        </div>
        {question?.visual && (
          <p className="mt-1 text-3xl leading-relaxed whitespace-pre-wrap break-words">{question.visual}</p>
        )}
        {/* ⚡ speed window: answer while the bar still glows for bonus coins */}
        <div className="mt-2 flex items-center gap-1.5">
          <span className="text-[10px]">⚡</span>
          <div className="flex-1 h-1.5 rounded-full bg-slate-100 overflow-hidden">
            <div key={qIndex} className="h-full rounded-full bg-gradient-to-r from-yellow-400 to-orange-500" style={{ animation: `bb-speedbar ${QUICK_MS}ms linear forwards` }} />
          </div>
        </div>
        <style>{`@keyframes bb-speedbar { from { width: 100% } to { width: 0% } }`}</style>
      </div>

      {/* Game canvas */}
      <div ref={wrapRef} className="relative flex-1 min-h-[320px] mx-3 mb-3 rounded-2xl overflow-hidden shadow-inner border-2 border-green-200">
        <canvas ref={canvasRef} className="absolute inset-0 w-full h-full touch-none" />
      </div>

      <div className="px-4 pb-3 flex items-center justify-between text-xs text-slate-400">
        <span>Tap the answer — the ball rolls over and eats it!</span>
        <button onClick={() => setMuted((m) => !m)} className="font-bold text-slate-500 underline">
          {muted ? '🔇 Sound off' : '🔊 Sound on'}
        </button>
      </div>
    </div>
  )
}
