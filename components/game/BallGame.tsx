'use client'

// Brain Ball — the rolling-ball answer game (hole.io-style: eat the right
// answer bubble and grow). Canvas render loop + DOM question banner.

import { useCallback, useEffect, useRef, useState } from 'react'
import { Volume2, X } from 'lucide-react'
import { nextDifficulty, pickMixSkill, updateTheta } from '@/lib/game/adaptive'
import { generateQuestion, SKILLS } from '@/lib/game/questions'
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
}

interface BallGameProps {
  profile: KidProfile
  skill: SkillId | 'mix'
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
  wrongFlash: number
  isCorrect: boolean
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

type Phase = 'idle' | 'rolling' | 'celebrate' | 'reveal' | 'done'

const CONFETTI = ['#f97316', '#22c55e', '#3b82f6', '#eab308', '#ec4899', '#a855f7']
const PRAISE = ['Great job!', 'You got it!', 'Awesome!', 'Super smart!', 'Nice one!', 'Wow!', 'Go Whalehogs!', 'Whalehog smart!']
const ENCOURAGE = ['Good try!', 'Almost!', 'Keep going!', "You'll get it!", "We don't say can't!", 'Whalehogs never quit!']

function clone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v))
}

export function BallGame({ profile, skill, onAnswer, onComplete, onQuit }: BallGameProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const wrapRef = useRef<HTMLDivElement>(null)

  const [question, setQuestion] = useState<Question | null>(null)
  const [qIndex, setQIndex] = useState(0)
  const [coins, setCoins] = useState(0)
  const [streak, setStreak] = useState(0)
  const [results, setResults] = useState<boolean[]>([])
  const [muted, setMuted] = useState(false)

  // mutable game world (never triggers React renders)
  const world = useRef({
    w: 360,
    h: 480,
    ball: { x: 180, y: 380, r: 30, rot: 0, target: null as { x: number; y: number } | null },
    bubbles: [] as Bubble[],
    particles: [] as Particle[],
    floaters: [] as Floater[],
    phase: 'idle' as Phase,
    grow: 0,
    streak: 0,
    tappedIndex: -1,
    t: 0,
  })
  const skillsRef = useRef<Record<SkillId, SkillState>>(clone(profile.skills))
  const startThetasRef = useRef<Record<SkillId, number>>(
    Object.fromEntries(Object.entries(profile.skills).map(([k, s]) => [k, s.theta])) as Record<SkillId, number>
  )
  const questionRef = useRef<Question | null>(null)
  const statsRef = useRef({ correct: 0, coins: 0, bestStreak: 0, answered: 0 })
  const missesRef = useRef<MissedQuestion[]>([])
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

  const playCorrect = useCallback(() => {
    tone(523, 0, 0.15, 'triangle')
    tone(659, 0.1, 0.15, 'triangle')
    tone(784, 0.2, 0.3, 'triangle')
  }, [tone])
  const playWrong = useCallback(() => {
    tone(220, 0, 0.25, 'sine', 0.08)
    tone(185, 0.12, 0.3, 'sine', 0.08)
  }, [tone])

  const speak = useCallback((text: string) => {
    if (mutedRef.current) return
    speakText(text, { rate: 0.92, pitch: 1.1 })
  }, [])

  // ------------------------------------------------------------- questions
  const layoutBubbles = useCallback((q: Question) => {
    const w = world.current
    const r = Math.min(w.w, w.h) * 0.135
    const xs = [0.2, 0.5, 0.8]
    const ys = [0.3, 0.24, 0.3]
    w.bubbles = q.choices.map((text, i) => ({
      x: w.w * xs[i % 3],
      y: w.h * ys[i % 3],
      r,
      text,
      eaten: false,
      wrongFlash: 0,
      isCorrect: i === q.answer,
    }))
  }, [])

  const nextQuestion = useCallback(
    (index: number) => {
      const sk: SkillId = skill === 'mix' ? pickMixSkill(skillsRef.current) : skill
      const state = skillsRef.current[sk]
      const q = generateQuestion(sk, nextDifficulty(state, index, world.current.streak))
      questionRef.current = q
      setQuestion(q)
      setQIndex(index)
      layoutBubbles(q)
      world.current.phase = 'idle'
      world.current.tappedIndex = -1
      speak(q.speech)
    },
    [skill, layoutBubbles, speak]
  )

  // start round
  useEffect(() => {
    nextQuestion(0)
    // preload voices (some browsers populate the list async)
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) window.speechSynthesis.getVoices()
    return () => {
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
      const state = skillsRef.current[q.skill]
      const newTheta = updateTheta(state, q.difficulty, correct)
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
        coinsDelta = 2 + (w.streak >= 5 ? 2 : w.streak >= 3 ? 1 : 0)
        stats.coins += coinsDelta
        w.grow += 1
        w.phase = 'celebrate'
        const b = w.bubbles[bubbleIndex]
        b.eaten = true
        for (let i = 0; i < 26; i++) {
          w.particles.push({
            x: b.x,
            y: b.y,
            vx: (Math.random() - 0.5) * 9,
            vy: (Math.random() - 0.7) * 9,
            life: 1,
            color: CONFETTI[i % CONFETTI.length],
            size: 3 + Math.random() * 4,
          })
        }
        w.floaters.push({ x: b.x, y: b.y - b.r, text: `+${coinsDelta} 🪙`, life: 1, color: '#eab308' })
        w.floaters.push({
          x: w.w / 2,
          y: w.h * 0.55,
          text: PRAISE[Math.floor(Math.random() * PRAISE.length)],
          life: 1.4,
          color: '#16a34a',
        })
        playCorrect()
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
      onAnswer({ skill: q.skill, difficulty: q.difficulty, correct, coins: coinsDelta, xp: correct ? 1 : 0, newTheta })

      const idx = stats.answered
      window.setTimeout(() => {
        w.ball.target = { x: w.w / 2, y: w.h * 0.78 }
        if (idx >= ROUND_LENGTH) {
          w.phase = 'done'
          const accuracy = stats.correct / ROUND_LENGTH
          const stars: 1 | 2 | 3 = accuracy >= 0.9 ? 3 : accuracy >= 0.7 ? 2 : 1
          const deltas = (Object.keys(skillsRef.current) as SkillId[])
            .filter((k) => Math.round(skillsRef.current[k].theta) !== Math.round(startThetasRef.current[k]))
            .map((k) => ({ skill: k, from: Math.round(startThetasRef.current[k]), to: Math.round(skillsRef.current[k].theta) }))
          onComplete({
            skill,
            total: ROUND_LENGTH,
            correct: stats.correct,
            coinsEarned: stats.coins + stars * 5,
            stars,
            bestStreak: stats.bestStreak,
            deltas,
            misses: missesRef.current,
          })
        } else {
          nextQuestion(idx)
        }
      }, correct ? 900 : 1700)
    },
    [onAnswer, onComplete, nextQuestion, playCorrect, playWrong, skill]
  )

  // ------------------------------------------------------------- input
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const onPointer = (e: PointerEvent) => {
      ensureAudio()
      audioRef.current?.resume().catch(() => {})
      const w = world.current
      if (w.phase !== 'idle') return
      const rect = canvas.getBoundingClientRect()
      const x = ((e.clientX - rect.left) / rect.width) * w.w
      const y = ((e.clientY - rect.top) / rect.height) * w.h
      for (let i = 0; i < w.bubbles.length; i++) {
        const b = w.bubbles[i]
        const dist = Math.hypot(x - b.x, y - b.y)
        if (dist <= b.r * 1.15) {
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
        w.bubbles.forEach((b, i) => {
          b.x = w.w * [0.2, 0.5, 0.8][i % 3]
          b.y = w.h * [0.3, 0.24, 0.3][i % 3]
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
      const baseR = Math.min(w.w, w.h) * 0.075
      const targetR = Math.min(baseR * (1 + w.grow * 0.07), baseR * 1.8)
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

      // ---------- background
      const sky = ctx.createLinearGradient(0, 0, 0, w.h)
      sky.addColorStop(0, '#bfe6ff')
      sky.addColorStop(0.55, '#dff2ff')
      sky.addColorStop(0.56, '#bbe98d')
      sky.addColorStop(1, '#8fd15f')
      ctx.fillStyle = sky
      ctx.fillRect(0, 0, w.w, w.h)
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
        if (b.eaten) return
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

      // ---------- ball
      ctx.save()
      ctx.translate(ball.x, ball.y)
      // shadow
      ctx.fillStyle = 'rgba(0,0,0,0.15)'
      ctx.beginPath()
      ctx.ellipse(0, ball.r * 0.95, ball.r * 0.8, ball.r * 0.22, 0, 0, Math.PI * 2)
      ctx.fill()
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
      ctx.strokeStyle = '#1e293b'
      ctx.lineWidth = Math.max(2, ball.r * 0.07)
      ctx.lineCap = 'round'
      ctx.beginPath()
      if (happy) ctx.arc(0, ball.r * 0.15, ball.r * 0.32, 0.15, Math.PI - 0.15)
      else ctx.arc(0, ball.r * 0.22, ball.r * 0.24, 0.3, Math.PI - 0.3)
      ctx.stroke()
      ctx.restore()

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
            {skillMeta.emoji} {skillMeta.name}
          </span>
        )}
        {question && (
          <span className="absolute -top-2.5 right-3 text-[10px] font-extrabold bg-purple-500 text-white rounded-full px-2 py-0.5">
            ⚡ Level {question.difficulty}
          </span>
        )}
        <div className="flex items-center justify-center gap-2">
          <p className="text-lg font-extrabold text-slate-800 leading-snug">{question?.prompt}</p>
          <button
            onClick={() => {
              ensureAudio()
              if (question) speak(question.speech)
            }}
            aria-label="Hear the question again"
            className="shrink-0 w-10 h-10 rounded-full bg-blue-500 text-white flex items-center justify-center shadow active:scale-95"
          >
            <Volume2 className="w-5 h-5" />
          </button>
        </div>
        {question?.visual && (
          <p className="mt-1 text-3xl leading-relaxed whitespace-pre-wrap break-words">{question.visual}</p>
        )}
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
