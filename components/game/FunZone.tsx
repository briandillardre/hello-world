'use client'

// Brain Ball — 🎮 Fun Zone: pure free-play, no questions. The ball follows the
// kid's finger and gobbles everything on screen, hole.io style, against a
// countdown of PLAY TIME EARNED BY CORRECT ANSWERS. When the clock hits zero,
// the only way to get more is to go score in a round — the learning loop IS
// the arcade's coin slot.

import { useEffect, useRef, useState } from 'react'
import { X } from 'lucide-react'
import { BALL_SKINS } from '@/lib/game/storage'
import type { KidProfile } from '@/lib/game/types'

interface FunZoneProps {
  profile: KidProfile
  /** persist the remaining bank (called periodically + on exit) */
  onSpend: (remainingSeconds: number) => void
  onExit: () => void
}

interface Snack {
  x: number
  y: number
  r: number
  emoji: string
  golden: boolean
  /** 1→0 pop after being eaten */
  pop: number
  bobSeed: number
}

interface Crumb {
  x: number
  y: number
  vx: number
  vy: number
  size: number
  color: string
}

interface Floater {
  x: number
  y: number
  text: string
  life: number
  color: string
}

const SNACKS = ['🍎', '🍪', '🍓', '🧁', '🍉', '🍩', '🍌', '🥨', '🍇', '🫐'] as const
const GOLDEN = '⭐'
const SNACK_COUNT = 12

export function FunZone({ profile, onSpend, onExit }: FunZoneProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const wrapRef = useRef<HTMLDivElement>(null)
  const [score, setScore] = useState(0)
  const [secondsLeft, setSecondsLeft] = useState(Math.max(0, Math.floor(profile.playSeconds ?? 0)))
  const [over, setOver] = useState((profile.playSeconds ?? 0) < 1)

  const football = (profile.gameMode ?? 'ball') === 'football'
  const activeSkin = BALL_SKINS.find((s) => s.id === profile.activeSkin) ?? BALL_SKINS[0]

  const world = useRef({
    w: 360,
    h: 480,
    ball: { x: 180, y: 300, r: 26, rot: 0, sx: 1, sy: 1, target: null as { x: number; y: number } | null },
    snacks: [] as Snack[],
    crumbs: [] as Crumb[],
    floaters: [] as Floater[],
    eating: 0,
    score: 0,
    grow: 0,
    t: 0,
  })
  const startRef = useRef({ at: Date.now(), bank: Math.max(0, Math.floor(profile.playSeconds ?? 0)) })
  const remainingRef = useRef(startRef.current.bank)
  const overRef = useRef(over)
  overRef.current = over
  const audioRef = useRef<AudioContext | null>(null)
  const onSpendRef = useRef(onSpend)
  onSpendRef.current = onSpend

  const tone = (freq: number, start: number, dur: number, type: OscillatorType = 'sine', gain = 0.1) => {
    const ctx = audioRef.current
    if (!ctx) return
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
  }

  // persist the remaining bank every few seconds and once on the way out
  useEffect(() => {
    const iv = window.setInterval(() => onSpendRef.current(remainingRef.current), 5000)
    return () => {
      window.clearInterval(iv)
      onSpendRef.current(remainingRef.current)
    }
  }, [])

  // the 1 Hz clock (display + game-over), separate from the render loop
  useEffect(() => {
    if (over) return
    const iv = window.setInterval(() => {
      const left = Math.max(0, startRef.current.bank - Math.floor((Date.now() - startRef.current.at) / 1000))
      remainingRef.current = left
      setSecondsLeft(left)
      if (left <= 0) {
        setOver(true)
        onSpendRef.current(0)
      }
    }, 250)
    return () => window.clearInterval(iv)
  }, [over])

  // ------------------------------------------------------------- render loop
  useEffect(() => {
    const canvas = canvasRef.current
    const wrap = wrapRef.current
    if (!canvas || !wrap) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const w = world.current

    const spawnSnack = (): Snack => {
      const golden = Math.random() < 0.12
      return {
        x: 20 + Math.random() * (w.w - 40),
        y: w.h * 0.12 + Math.random() * (w.h * 0.78),
        r: golden ? 17 : 14,
        emoji: golden ? GOLDEN : SNACKS[Math.floor(Math.random() * SNACKS.length)],
        golden,
        pop: 0,
        bobSeed: Math.random() * 6,
      }
    }

    const resize = () => {
      const rect = wrap.getBoundingClientRect()
      const dpr = Math.min(window.devicePixelRatio || 1, 2)
      const sx = rect.width / w.w
      const sy = rect.height / w.h
      w.w = rect.width
      w.h = rect.height
      canvas.width = rect.width * dpr
      canvas.height = rect.height * dpr
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      if (sx !== 1 || sy !== 1) {
        w.ball.x *= sx
        w.ball.y *= sy
        w.snacks.forEach((s) => {
          s.x *= sx
          s.y *= sy
        })
      }
    }
    resize()
    const ro = new ResizeObserver(resize)
    ro.observe(wrap)

    w.ball.x = w.w / 2
    w.ball.y = w.h / 2
    while (w.snacks.length < SNACK_COUNT) w.snacks.push(spawnSnack())

    // finger steering: press anywhere, the ball chases the finger
    const toWorld = (e: PointerEvent) => {
      const rect = canvas.getBoundingClientRect()
      return { x: ((e.clientX - rect.left) / rect.width) * w.w, y: ((e.clientY - rect.top) / rect.height) * w.h }
    }
    let steering = false
    const onDown = (e: PointerEvent) => {
      if (!audioRef.current && typeof window !== 'undefined') {
        const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
        if (Ctx) audioRef.current = new Ctx()
      }
      audioRef.current?.resume().catch(() => {})
      steering = true
      w.ball.target = toWorld(e)
    }
    const onMove = (e: PointerEvent) => {
      if (steering) w.ball.target = toWorld(e)
    }
    const onUp = () => {
      steering = false
    }
    canvas.addEventListener('pointerdown', onDown)
    canvas.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)

    let raf = 0
    const draw = () => {
      w.t += 1
      const { ball } = w
      const baseR = Math.min(w.w, w.h) * 0.065
      const targetR = Math.min(baseR * (1 + w.grow * 0.04), baseR * 1.9)
      ball.r += (targetR - ball.r) * 0.08

      // chase the finger (paused at game over)
      if (ball.target && !overRef.current) {
        const dx = ball.target.x - ball.x
        const dy = ball.target.y - ball.y
        const dist = Math.hypot(dx, dy)
        if (dist > 3) {
          const step = Math.min(dist * 0.16, 9)
          ball.x += (dx / dist) * step
          ball.y += (dy / dist) * step
          ball.rot += step / ball.r
        }
      }
      ball.x = Math.max(ball.r * 0.6, Math.min(w.w - ball.r * 0.6, ball.x))
      ball.y = Math.max(ball.r * 0.6, Math.min(w.h - ball.r * 0.6, ball.y))

      // ---------- background
      if (football) {
        const zoneH = w.h * 0.1
        const fieldH = w.h - zoneH
        for (let i = 0; i < 8; i++) {
          ctx.fillStyle = i % 2 === 0 ? '#16a34a' : '#15803d'
          ctx.fillRect(-20, zoneH + (fieldH * i) / 8, w.w + 40, fieldH / 8 + 1)
        }
        ctx.strokeStyle = 'rgba(255,255,255,0.55)'
        ctx.lineWidth = 2
        for (let i = 0; i <= 8; i++) {
          const y = zoneH + (fieldH * i) / 8
          ctx.beginPath()
          ctx.moveTo(-20, y)
          ctx.lineTo(w.w + 20, y)
          ctx.stroke()
        }
        ctx.fillStyle = '#1d4ed8'
        ctx.fillRect(-20, -20, w.w + 40, zoneH + 20)
        ctx.fillStyle = 'rgba(255,255,255,0.9)'
        ctx.font = `900 ${Math.round(zoneH * 0.45)}px system-ui`
        ctx.textAlign = 'center'
        ctx.textBaseline = 'middle'
        ctx.fillText('SNACK BOWL', w.w / 2, zoneH * 0.42)
      } else {
        const sky = ctx.createLinearGradient(0, 0, 0, w.h)
        sky.addColorStop(0, '#bfe6ff')
        sky.addColorStop(0.45, '#dff2ff')
        sky.addColorStop(0.46, '#bbe98d')
        sky.addColorStop(1, '#8fd15f')
        ctx.fillStyle = sky
        ctx.fillRect(-20, -20, w.w + 40, w.h + 40)
        ctx.fillStyle = 'rgba(255, 220, 100, 0.9)'
        ctx.beginPath()
        ctx.arc(w.w * 0.88, w.h * 0.07, 20, 0, Math.PI * 2)
        ctx.fill()
      }

      // ---------- snacks
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      for (let i = 0; i < w.snacks.length; i++) {
        const s = w.snacks[i]
        if (s.pop > 0) {
          s.pop = Math.max(0, s.pop - 0.08)
          if (s.pop === 0) w.snacks[i] = spawnSnack()
          continue
        }
        // eat check
        if (!overRef.current && Math.hypot(ball.x - s.x, ball.y - s.y) < ball.r * 0.95 + s.r * 0.4) {
          s.pop = 1
          w.eating = 1
          w.grow += 1
          const pts = s.golden ? 5 : 1
          w.score += pts
          setScore(w.score)
          ball.sy = 0.78
          ball.sx = 1.2
          const combo = 1 + Math.min(w.grow, 20) * 0.02
          tone(392 * combo, 0, 0.06, 'sine', 0.08)
          tone(262 * combo, 0.07, 0.1, 'sine', 0.09)
          if (s.golden) {
            tone(784, 0.1, 0.12, 'triangle', 0.1)
            tone(1047, 0.22, 0.25, 'triangle', 0.09)
            w.floaters.push({ x: s.x, y: s.y - 16, text: '⭐ +5!', life: 1.1, color: '#ca8a04' })
          }
          for (let k = 0; k < 8; k++) {
            const ang = (k / 8) * Math.PI * 2
            w.crumbs.push({
              x: s.x + Math.cos(ang) * s.r * 0.5,
              y: s.y + Math.sin(ang) * s.r * 0.5,
              vx: Math.cos(ang) * 2,
              vy: Math.sin(ang) * 2,
              size: 3 + Math.random() * 5,
              color: s.golden ? '#fde047' : '#fecaca',
            })
          }
          continue
        }
        const bob = Math.sin(w.t * 0.04 + s.bobSeed) * 3
        ctx.font = `${s.r * 2}px system-ui`
        ctx.fillText(s.emoji, s.x, s.y + bob)
      }

      // ---------- crumbs into the mouth
      w.crumbs = w.crumbs.filter((c) => {
        const dx = ball.x - c.x
        const dy = ball.y - ball.r * 0.2 - c.y
        const dist = Math.hypot(dx, dy)
        if (dist < ball.r * 0.5) {
          ball.sy = 0.8
          ball.sx = 1.18
          return false
        }
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
        return true
      })
      w.eating = w.crumbs.length > 0 ? 1 : Math.max(0, w.eating - 0.06)

      // ---------- ball / football (simplified from BallGame, same face)
      ctx.save()
      ctx.translate(ball.x, ball.y)
      ctx.fillStyle = 'rgba(0,0,0,0.15)'
      ctx.beginPath()
      ctx.ellipse(0, ball.r * 0.95, ball.r * 0.8, ball.r * 0.22, 0, 0, Math.PI * 2)
      ctx.fill()
      ball.sx += (1 - ball.sx) * 0.18
      ball.sy += (1 - ball.sy) * 0.18
      ctx.scale(ball.sx, ball.sy)
      if (football) {
        ctx.save()
        ctx.rotate(Math.sin(ball.rot * 1.4) * 0.1)
        const fg = ctx.createRadialGradient(-ball.r * 0.3, -ball.r * 0.3, ball.r * 0.15, 0, 0, ball.r * 1.2)
        fg.addColorStop(0, '#b45309')
        fg.addColorStop(1, '#7c2d12')
        ctx.fillStyle = fg
        ctx.beginPath()
        ctx.ellipse(0, 0, ball.r * 1.16, ball.r * 0.86, 0, 0, Math.PI * 2)
        ctx.fill()
        ctx.strokeStyle = '#fef3c7'
        ctx.lineWidth = Math.max(2, ball.r * 0.08)
        ctx.beginPath()
        ctx.moveTo(-ball.r * 0.42, -ball.r * 0.52)
        ctx.lineTo(ball.r * 0.42, -ball.r * 0.52)
        ctx.stroke()
        ctx.restore()
      } else {
        const bodyGrad = ctx.createRadialGradient(-ball.r * 0.3, -ball.r * 0.3, ball.r * 0.15, 0, 0, ball.r)
        bodyGrad.addColorStop(0, activeSkin.colors[0])
        bodyGrad.addColorStop(1, activeSkin.colors[1])
        ctx.fillStyle = bodyGrad
        ctx.beginPath()
        ctx.arc(0, 0, ball.r, 0, Math.PI * 2)
        ctx.fill()
        if (activeSkin.emoji) {
          ctx.save()
          ctx.rotate(ball.rot)
          ctx.font = `${Math.round(ball.r * 0.9)}px system-ui`
          ctx.textAlign = 'center'
          ctx.textBaseline = 'middle'
          ctx.fillText(activeSkin.emoji, 0, 0)
          ctx.restore()
        }
      }
      // face
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
        ctx.fillStyle = '#7f1d1d'
        ctx.beginPath()
        ctx.ellipse(0, ball.r * 0.32, ball.r * 0.34, ball.r * 0.4 * w.eating, 0, 0, Math.PI * 2)
        ctx.fill()
      } else {
        ctx.strokeStyle = '#1e293b'
        ctx.lineWidth = Math.max(2, ball.r * 0.07)
        ctx.lineCap = 'round'
        ctx.beginPath()
        ctx.arc(0, ball.r * 0.15, ball.r * 0.32, 0.15, Math.PI - 0.15)
        ctx.stroke()
      }
      ctx.restore()

      // ---------- floaters
      w.floaters = w.floaters.filter((f) => f.life > 0)
      w.floaters.forEach((f) => {
        f.y -= 0.8
        f.life -= 0.02
        ctx.globalAlpha = Math.max(0, Math.min(1, f.life))
        ctx.font = '800 20px system-ui'
        ctx.textAlign = 'center'
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
      canvas.removeEventListener('pointerdown', onDown)
      canvas.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const mmss = `${Math.floor(secondsLeft / 60)}:${String(secondsLeft % 60).padStart(2, '0')}`
  const pct = startRef.current.bank > 0 ? (secondsLeft / startRef.current.bank) * 100 : 0

  return (
    <div className="flex flex-col flex-1 min-h-0 max-w-lg mx-auto w-full">
      <div className="flex items-center justify-between px-3 py-2">
        <button
          onClick={onExit}
          aria-label="Leave the Fun Zone"
          className="w-9 h-9 rounded-full bg-white/80 border border-slate-200 flex items-center justify-center text-slate-500 active:scale-95"
        >
          <X className="w-5 h-5" />
        </button>
        <span className="text-sm font-black text-slate-700">🎮 Fun Zone</span>
        <span className="text-sm font-extrabold text-purple-600 bg-purple-100 border border-purple-300 rounded-full px-2 py-0.5">😋 {score}</span>
      </div>

      {/* play-time clock */}
      <div className="mx-3 mb-2 rounded-2xl bg-white shadow-md border-2 border-purple-200 px-4 py-2">
        <div className="flex justify-between text-xs font-extrabold text-slate-600">
          <span>⏱ Play time left</span>
          <span className={secondsLeft <= 10 ? 'text-red-500 animate-pulse' : ''}>{mmss}</span>
        </div>
        <div className="h-2 rounded-full bg-slate-100 overflow-hidden mt-1">
          <div
            className={`h-full rounded-full transition-all ${secondsLeft <= 10 ? 'bg-red-400' : 'bg-gradient-to-r from-purple-400 to-blue-500'}`}
            style={{ width: `${Math.max(0, pct)}%` }}
          />
        </div>
      </div>

      <div ref={wrapRef} className="relative flex-1 min-h-[320px] mx-3 mb-3 rounded-2xl overflow-hidden shadow-inner border-2 border-purple-200">
        <canvas ref={canvasRef} className="absolute inset-0 w-full h-full touch-none" />
        {over && (
          <div className="absolute inset-0 bg-slate-900/60 flex items-center justify-center p-6">
            <div className="rounded-3xl bg-white p-6 text-center max-w-xs w-full">
              <div className="text-4xl mb-2">⏱</div>
              <h3 className="text-xl font-black text-slate-800 mb-1">Time&apos;s up!</h3>
              <p className="text-sm text-slate-500 font-semibold mb-1">You gobbled {score} snacks! 😋</p>
              <p className="text-sm text-slate-600 font-bold mb-4">Right answers earn more play time — 5 seconds each!</p>
              <button
                onClick={onExit}
                className="w-full rounded-2xl bg-gradient-to-b from-green-400 to-green-600 border-b-4 border-green-700 text-white font-extrabold px-4 py-3 active:scale-95"
              >
                🧠 Earn more play time
              </button>
            </div>
          </div>
        )}
      </div>

      <p className="px-4 pb-3 text-center text-xs text-slate-400">Hold and drag — {football ? 'the football' : 'the ball'} chases your finger and eats everything!</p>
    </div>
  )
}
