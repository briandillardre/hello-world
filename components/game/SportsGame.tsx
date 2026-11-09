'use client'

/**
 * 🏀🏒 Brain Ball Arena — 3-on-3 Hoops and Hockey, Super Nintendo style.
 *
 * Brian, Nov 9: "Add in basketball and hockey option with shooting passing
 * etc. Needs to be more of a real game vs arcade game. Think super Nintendo."
 *
 * A question opens every possession: answer right and the Whalehogs get the
 * ball with a HOT HAND (a wider green zone on the shot meter); answer wrong
 * and the Robots get it and the kid plays live defense. Then it is a real
 * little game: the D-pad moves your player, A passes (switches player on
 * defense), hold B for the shot meter and let go in the green, B on defense
 * swipes for a steal / throws a check. Ten questions = one game.
 *
 * The world is the pure engine in lib/game/arena.ts (harness
 * scripts/arena-test.mjs). This file draws it into a 192×240 canvas scaled up
 * with no smoothing — real pixels — and keeps the same answer bookkeeping as
 * BallGame (theta, coins, streaks, bonuses, misses, the review queue).
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { Volume2, X } from 'lucide-react'
import { ADULT_THETA_CAP, nextDifficulty, pickMixSkill, updateTheta } from '@/lib/game/adaptive'
import { generateQuestion, skillDisplayName, SKILLS } from '@/lib/game/questions'
import { cancelSpeech, speak as speakText, warmVoices } from '@/lib/game/speech'
import {
  H, HOOP, NET_BOT, NET_HALF, NET_TOP, RINK, SWEET, W,
  meterValue, newArena, possessionCall, startPossession, step, sweetWidth,
  type Arena, type ArenaEvent, type Input, type Player, type Sport,
} from '@/lib/game/arena'
import { ROUND_LENGTH, type AnswerDelta } from './BallGame'
import type { KidProfile, MissedQuestion, Question, RoundResult, SkillId, SkillState } from '@/lib/game/types'

const AUTO_READ_DELAY_MS = 4000
const FAST_MS = 3500
const QUICK_MS = 6500
const STEP = 1 / 60
/** the camera's window onto the 192×240 world — it scrolls with the ball, like the real thing */
const VW = 144
const VH = 180

interface Props {
  profile: KidProfile
  sport: Sport
  skill: SkillId | 'mix'
  dailyDouble?: boolean
  coach?: { name: string; avatar: string }
  onAnswer: (delta: AnswerDelta) => void
  onComplete: (result: RoundResult) => void
  onQuit: () => void
}

type Phase = 'ask' | 'feedback' | 'play' | 'done'
interface Floater { x: number; y: number; text: string; life: number; color: string }

const TEAM = {
  0: { jersey: '#1d4ed8', trim: '#93c5fd', skin: '#f2c49b', hair: '#5b3a1e', shorts: '#1e3a8a' },
  1: { jersey: '#b91c1c', trim: '#fca5a5', skin: '#cbd5e1', hair: '#64748b', shorts: '#334155' },
} as const

function cloneSkills(skills: Record<SkillId, SkillState>): Record<SkillId, SkillState> {
  const out = {} as Record<SkillId, SkillState>
  for (const k of Object.keys(skills) as SkillId[]) out[k] = { ...skills[k] }
  return out
}

// ------------------------------------------------------------------ backgrounds
function px(ctx: CanvasRenderingContext2D, c: string, x: number, y: number, w = 1, h = 1) {
  ctx.fillStyle = c
  ctx.fillRect(Math.round(x), Math.round(y), w, h)
}

/** a pixel circle outline (midpoint) */
function ring(ctx: CanvasRenderingContext2D, c: string, cx: number, cy: number, r: number, from = 0, to = Math.PI * 2, dashed = false) {
  const n = Math.max(24, Math.round(r * 7))
  for (let i = 0; i <= n; i++) {
    const t = from + ((to - from) * i) / n
    if (dashed && i % 6 > 2) continue
    px(ctx, c, cx + Math.cos(t) * r, cy + Math.sin(t) * r)
  }
}

function drawCourt(ctx: CanvasRenderingContext2D) {
  // hardwood: planks with seams and grain
  for (let x = 0; x < W; x += 6) {
    const shade = (x / 6) % 2 ? '#d7a15c' : '#cf9853'
    px(ctx, shade, x, 0, 6, H)
    px(ctx, '#b98245', x, 0, 1, H)
  }
  let s = 7
  const r = () => ((s = (s * 16807) % 2147483647) / 2147483647)
  for (let i = 0; i < 260; i++) px(ctx, r() < 0.5 ? '#c58c4b' : '#dcab6b', r() * W, 14 + r() * H, 1 + Math.round(r() * 3), 1)
  for (let i = 0; i < 40; i++) px(ctx, '#a8733c', Math.floor(r() * 32) * 6, 14 + r() * H, 1, 5)
  // the paint
  px(ctx, '#2f5fb3', 76, 14, 40, 72)
  // lines
  const L = '#f8fafc'
  px(ctx, L, 4, 14, 184, 1) // baseline
  px(ctx, L, 4, 14, 1, 222); px(ctx, L, 187, 14, 1, 222)
  px(ctx, L, 76, 14, 1, 72); px(ctx, L, 115, 14, 1, 72); px(ctx, L, 76, 86, 40, 1)
  ring(ctx, L, 96, 86, 18, 0, Math.PI)
  ring(ctx, L, 96, 86, 18, Math.PI, Math.PI * 2, true)
  // the arc
  px(ctx, L, 24, 14, 1, 16); px(ctx, L, 167, 14, 1, 16)
  ring(ctx, L, HOOP.x, HOOP.y, 72, 0, Math.PI)
  // half court + centre circle (bottom edge)
  px(ctx, L, 4, 235, 184, 1)
  ring(ctx, L, 96, 236, 22, Math.PI, Math.PI * 2)
  // the team logo at centre
  ctx.globalAlpha = 0.18
  ctx.fillStyle = '#1d4ed8'
  ctx.font = 'bold 22px monospace'
  ctx.textAlign = 'center'
  ctx.fillText('WH', 96, 186)
  ctx.globalAlpha = 1
  // the rim's shadow on the floor
  ctx.globalAlpha = 0.25
  px(ctx, '#000', HOOP.x - 5, HOOP.y - 1, 10, 3)
  ctx.globalAlpha = 1
  // the crowd strip above the baseline
  px(ctx, '#1f2937', 0, 0, W, 14)
}

function drawRink(ctx: CanvasRenderingContext2D) {
  px(ctx, '#0f172a', 0, 0, W, H)
  // the ice: rounded rect
  const { x0, x1, y0, y1 } = RINK
  const rr = 16
  for (let y = y0; y < y1; y++) {
    let inset = 0
    const top = y - y0, bot = y1 - 1 - y
    const d = Math.min(top, bot)
    if (d < rr) inset = rr - Math.sqrt(rr * rr - (rr - d) * (rr - d))
    px(ctx, '#eaf2f8', x0 + inset, y, x1 - x0 - inset * 2, 1)
    // the boards: a yellow kick plate
    px(ctx, '#facc15', x0 + inset - 2, y, 2, 1)
    px(ctx, '#facc15', x1 - inset, y, 2, 1)
  }
  px(ctx, '#facc15', x0 + rr, y0 - 2, x1 - x0 - rr * 2, 2)
  px(ctx, '#facc15', x0 + rr, y1, x1 - x0 - rr * 2, 2)
  let s = 11
  const r = () => ((s = (s * 16807) % 2147483647) / 2147483647)
  for (let i = 0; i < 160; i++) px(ctx, '#d6e4ef', x0 + 4 + r() * (x1 - x0 - 8), y0 + 4 + r() * (y1 - y0 - 8), 1 + Math.round(r() * 4), 1)
  // centre red line, blue lines, goal lines
  px(ctx, '#dc2626', x0, 119, x1 - x0, 2)
  px(ctx, '#2563eb', x0, 80, x1 - x0, 3)
  px(ctx, '#2563eb', x0, 158, x1 - x0, 3)
  px(ctx, '#dc2626', x0 + 10, NET_TOP.y + 2, x1 - x0 - 20, 1)
  px(ctx, '#dc2626', x0 + 10, NET_BOT.y - 2, x1 - x0 - 20, 1)
  ring(ctx, '#2563eb', 96, 120, 18)
  px(ctx, '#2563eb', 95, 119, 3, 3)
  for (const [cx, cy] of [[52, 50], [140, 50], [52, 190], [140, 190]]) {
    ring(ctx, '#dc2626', cx, cy, 13)
    px(ctx, '#dc2626', cx - 1, cy - 1, 3, 3)
  }
  // creases
  for (const [net, dir] of [[NET_TOP, 1], [NET_BOT, -1]] as const) {
    for (let r2 = 1; r2 <= 11; r2++) ring(ctx, '#bfdbfe', net.x, net.y + dir * 2, r2, dir > 0 ? 0 : Math.PI, dir > 0 ? Math.PI : Math.PI * 2)
    ring(ctx, '#dc2626', net.x, net.y + dir * 2, 12, dir > 0 ? 0 : Math.PI, dir > 0 ? Math.PI : Math.PI * 2)
  }
  // nets: red frame + white mesh
  for (const [net, dir] of [[NET_TOP, -1], [NET_BOT, 1]] as const) {
    const y = dir < 0 ? net.y - 8 : net.y + 2
    for (let yy = 0; yy < 7; yy++) for (let xx = 0; xx < NET_HALF * 2; xx++) if ((xx + yy) % 2 === 0) px(ctx, '#f1f5f9', net.x - NET_HALF + xx, y + yy)
    px(ctx, '#dc2626', net.x - NET_HALF - 1, y - (dir < 0 ? 0 : 1), 1, 8)
    px(ctx, '#dc2626', net.x + NET_HALF, y - (dir < 0 ? 0 : 1), 1, 8)
    px(ctx, '#dc2626', net.x - NET_HALF - 1, dir < 0 ? y : y + 7, NET_HALF * 2 + 2, 1)
  }
  // ad boards text
  ctx.fillStyle = '#334155'
  ctx.font = 'bold 6px monospace'
  ctx.textAlign = 'center'
  ctx.fillText('WHALEHOGS ARENA', 96, 7)
}

// ------------------------------------------------------------------ sprites
function drawPlayer(ctx: CanvasRenderingContext2D, p: Player, sport: Sport, t: number, num: number) {
  const c = TEAM[p.team]
  const x = Math.round(p.x) - 3
  const y = Math.round(p.y) - 11
  const step2 = Math.floor(p.anim) % 2
  // shadow
  ctx.globalAlpha = 0.28
  px(ctx, '#000', x, y + 10, 7, 2)
  ctx.globalAlpha = 1
  if (p.goalie) {
    // a big goalie: pads, chest protector, mask
    px(ctx, '#f8fafc', x - 1, y + 7, 3, 4); px(ctx, '#f8fafc', x + 5, y + 7, 3, 4)
    px(ctx, c.jersey, x - 1, y + 3, 9, 5)
    px(ctx, c.trim, x - 1, y + 5, 9, 1)
    px(ctx, '#e5e7eb', x + 1, y, 5, 4)
    px(ctx, '#111827', x + 2, y + 1, 3, 2)
    px(ctx, '#7c2d12', x - 2, y + 9, 2, 2) // stick blade
    return
  }
  const robot = p.team === 1
  // legs (2-frame stride)
  const lx = step2 ? 1 : 0
  px(ctx, robot ? '#64748b' : c.skin, x + 1 + lx, y + 8, 2, 2)
  px(ctx, robot ? '#64748b' : c.skin, x + 4 - lx, y + 8, 2, 2)
  // shoes / skates
  if (sport === 'hockey') { px(ctx, '#111827', x + lx, y + 10, 3, 1); px(ctx, '#111827', x + 4 - lx, y + 10, 3, 1); px(ctx, '#cbd5e1', x + lx, y + 11, 3, 1); px(ctx, '#cbd5e1', x + 4 - lx, y + 11, 3, 1) }
  else { px(ctx, '#f8fafc', x + 1 + lx, y + 10, 2, 1); px(ctx, '#f8fafc', x + 4 - lx, y + 10, 2, 1) }
  // shorts / pants
  px(ctx, c.shorts, x + 1, y + 6, 5, 2)
  // jersey with number + trim
  px(ctx, c.jersey, x + 1, y + 3, 5, 4)
  px(ctx, c.trim, x + 1, y + 3, 5, 1)
  px(ctx, '#f8fafc', x + 3, y + 4, 1, 2)
  if (num > 1) px(ctx, '#f8fafc', x + 2, y + 4, 1, 1)
  // arms
  px(ctx, robot ? '#94a3b8' : c.skin, x, y + 4, 1, 2)
  px(ctx, robot ? '#94a3b8' : c.skin, x + 6, y + 4, 1, 2)
  // head
  if (sport === 'hockey') {
    px(ctx, c.jersey, x + 2, y, 3, 1)
    px(ctx, c.skin, x + 2, y + 1, 3, 2)
    px(ctx, '#111827', x + 2, y + 1, 3, 1) // visor
  } else {
    px(ctx, c.skin, x + 2, y, 3, 3)
    px(ctx, c.hair, x + 2, y, 3, 1)
  }
  if (robot) {
    px(ctx, '#22d3ee', x + 2, y + 1, 1, 1); px(ctx, '#22d3ee', x + 4, y + 1, 1, 1) // eyes
    px(ctx, '#94a3b8', x + 3, y - 2, 1, 2) // antenna
    if (Math.floor(t * 3 + p.x) % 2 === 0) px(ctx, '#ef4444', x + 3, y - 3, 1, 1)
  }
  if (sport === 'hockey') {
    // the stick: from the hands along the facing to the blade
    const hx = p.x + Math.cos(p.face) * 2, hy = p.y - 5 + Math.sin(p.face) * 2
    for (let i = 0; i < 7; i++) px(ctx, '#7c2d12', hx + Math.cos(p.face) * i, hy + Math.sin(p.face) * i + i * 0.5)
    px(ctx, '#111827', hx + Math.cos(p.face) * 7 - 1, hy + Math.sin(p.face) * 7 + 3, 3, 1)
  }
}

function drawText(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, color: string, size = 8) {
  ctx.font = `bold ${size}px monospace`
  ctx.textAlign = 'center'
  ctx.fillStyle = '#000'
  for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) ctx.fillText(text, Math.round(x) + dx, Math.round(y) + dy)
  ctx.fillStyle = color
  ctx.fillText(text, Math.round(x), Math.round(y))
}

// ------------------------------------------------------------------ the component
export function SportsGame({ profile, sport, skill, dailyDouble = false, coach, onAnswer, onComplete, onQuit }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const bgRef = useRef<HTMLCanvasElement | null>(null)
  const arenaRef = useRef<Arena>(newArena(sport, Math.floor(Math.random() * 1e9)))
  const inputRef = useRef({ dx: 0, dy: 0, b: false, a: false, bUp: false })
  const floatersRef = useRef<Floater[]>([])
  const cheerRef = useRef(0)
  const phaseRef = useRef<Phase>('ask')

  const [phase, setPhaseState] = useState<Phase>('ask')
  const setPhase = (p: Phase) => { phaseRef.current = p; setPhaseState(p) }
  const [question, setQuestion] = useState<Question | null>(null)
  const [qIndex, setQIndex] = useState(0)
  const [picked, setPicked] = useState<number | null>(null)
  const [score, setScore] = useState<[number, number]>([0, 0])
  const [clock, setClock] = useState(0)
  const [coins, setCoins] = useState(0)
  const [streak, setStreak] = useState(0)
  const [results, setResults] = useState<boolean[]>([])
  const [muted, setMuted] = useState(false)
  const [isBonus, setIsBonus] = useState(false)
  const [mode, setMode] = useState<'attack' | 'defend' | 'loose'>('attack')
  const [hot, setHot] = useState(false)

  const skillsRef = useRef<Record<SkillId, SkillState>>(cloneSkills(profile.skills))
  const startThetasRef = useRef<Record<SkillId, number>>(
    Object.fromEntries(Object.entries(profile.skills).map(([k, s]) => [k, s.theta])) as Record<SkillId, number>
  )
  const questionRef = useRef<Question | null>(null)
  const statsRef = useRef({ correct: 0, coins: 0, bestStreak: 0, answered: 0, speedBonuses: 0, readBonuses: 0, playSeconds: 0, streak: 0 })
  const missesRef = useRef<MissedQuestion[]>([])
  const qStartRef = useRef(0)
  const spokeRef = useRef(false)
  const autoReadTimerRef = useRef<number | null>(null)
  const timerRef = useRef<number | null>(null)
  const bonusIndexRef = useRef(2 + Math.floor(Math.random() * (ROUND_LENGTH - 2)))
  const bonusRef = useRef(false)
  const queueRef = useRef([...(profile.reviewQueue ?? [])])
  const audioRef = useRef<AudioContext | null>(null)
  const noiseRef = useRef<AudioBuffer | null>(null)
  const mutedRef = useRef(false)
  mutedRef.current = muted
  const lastSayRef = useRef(0)
  const doneRef = useRef(false)

  // ------------------------------------------------------------ audio: square waves + noise
  const ensureAudio = () => {
    if (!audioRef.current && typeof window !== 'undefined') {
      const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
      if (Ctx) {
        audioRef.current = new Ctx()
        const len = audioRef.current.sampleRate * 0.6
        const buf = audioRef.current.createBuffer(1, len, audioRef.current.sampleRate)
        const d = buf.getChannelData(0)
        for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1
        noiseRef.current = buf
      }
    }
    if (audioRef.current?.state === 'suspended') audioRef.current.resume().catch(() => {})
    return audioRef.current
  }
  const tone = useCallback((freq: number, start: number, dur: number, type: OscillatorType = 'square', gain = 0.05, slideTo?: number) => {
    const ctx = audioRef.current
    if (!ctx || mutedRef.current) return
    const o = ctx.createOscillator()
    const g = ctx.createGain()
    o.type = type
    o.frequency.setValueAtTime(freq, ctx.currentTime + start)
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, ctx.currentTime + start + dur)
    g.gain.setValueAtTime(0, ctx.currentTime + start)
    g.gain.linearRampToValueAtTime(gain, ctx.currentTime + start + 0.01)
    g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + start + dur)
    o.connect(g).connect(ctx.destination)
    o.start(ctx.currentTime + start)
    o.stop(ctx.currentTime + start + dur + 0.05)
  }, [])
  const noise = useCallback((start: number, dur: number, gain = 0.05, hp = 800) => {
    const ctx = audioRef.current
    if (!ctx || mutedRef.current || !noiseRef.current) return
    const s = ctx.createBufferSource()
    s.buffer = noiseRef.current
    const f = ctx.createBiquadFilter()
    f.type = 'bandpass'
    f.frequency.value = hp
    const g = ctx.createGain()
    g.gain.setValueAtTime(gain, ctx.currentTime + start)
    g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + start + dur)
    s.connect(f).connect(g).connect(ctx.destination)
    s.start(ctx.currentTime + start, 0, Math.min(0.6, dur + 0.05))
  }, [])
  const sfx = useCallback((kind: string) => {
    switch (kind) {
      case 'right': tone(523, 0, 0.08); tone(659, 0.08, 0.08); tone(784, 0.16, 0.08); tone(1047, 0.24, 0.18); break
      case 'wrong': tone(196, 0, 0.18, 'square', 0.04); tone(147, 0.16, 0.3, 'square', 0.04); break
      case 'pass': tone(880, 0, 0.05, 'square', 0.03); break
      case 'shot': tone(300, 0, 0.25, 'square', 0.03, 900); break
      case 'swish': noise(0, 0.25, 0.08, 3500); tone(1047, 0.05, 0.1); tone(1319, 0.15, 0.2); break
      case 'rim': tone(180, 0, 0.12, 'square', 0.06); tone(160, 0.06, 0.15, 'square', 0.05); break
      case 'cheer': noise(0, 0.6, 0.07, 1200); noise(0.3, 0.6, 0.06, 900); break
      case 'horn': tone(220, 0, 0.9, 'sawtooth', 0.05); tone(277, 0, 0.9, 'sawtooth', 0.04); tone(330, 0, 0.9, 'sawtooth', 0.035); break
      case 'whistle': tone(2600, 0, 0.12, 'sine', 0.05); tone(2400, 0.12, 0.25, 'sine', 0.05); break
      case 'buzzer': tone(130, 0, 0.8, 'sawtooth', 0.06); break
      case 'steal': tone(400, 0, 0.12, 'square', 0.04, 1200); break
      case 'thud': noise(0, 0.12, 0.09, 300); break
      case 'aww': tone(392, 0, 0.3, 'triangle', 0.05, 262); break
    }
  }, [tone, noise])

  const say = useCallback((text: string, excited = false, force = false) => {
    if (mutedRef.current) return
    const now = Date.now()
    if (!force && now - lastSayRef.current < 1600) return
    lastSayRef.current = now
    speakText(text, excited ? { excited: true } : { rate: 1.02 })
  }, [])

  // ------------------------------------------------------------ questions
  const nextQuestion = useCallback((index: number) => {
    let sk: SkillId
    let difficulty: number
    const review = skill === 'mix' && queueRef.current.length > 0 && Math.random() < 0.35 ? queueRef.current.shift() : undefined
    if (review) {
      sk = review.skill
      difficulty = Math.max(1, review.difficulty - 8)
    } else {
      sk = skill === 'mix' ? pickMixSkill(skillsRef.current, profile.isTester ? undefined : profile.birthdate) : skill
      difficulty = nextDifficulty(skillsRef.current[sk], index, statsRef.current.streak)
    }
    const q = generateQuestion(sk, difficulty, !!profile.isTester)
    questionRef.current = q
    setQuestion(q)
    setQIndex(index)
    setPicked(null)
    const bonus = index === bonusIndexRef.current
    bonusRef.current = bonus
    setIsBonus(bonus)
    setPhase('ask')
    qStartRef.current = Date.now()
    // a listening question has nothing on screen to read — it is said at once (no 📖 bonus);
    // the rest wait a quiet moment so readers can beat the voice
    spokeRef.current = !!q.listen
    if (autoReadTimerRef.current !== null) window.clearTimeout(autoReadTimerRef.current)
    autoReadTimerRef.current = window.setTimeout(() => {
      autoReadTimerRef.current = null
      if (questionRef.current !== q || phaseRef.current !== 'ask') return
      if (!q.listen && spokeRef.current) return
      spokeRef.current = true
      if (!mutedRef.current) speakText(bonus ? `Bonus question! Double coins! ${q.speech}` : q.speech, { rate: 0.97 })
    }, q.listen ? 450 : AUTO_READ_DELAY_MS)
  }, [skill, profile.birthdate, profile.isTester])

  const finish = useCallback(() => {
    if (doneRef.current) return
    doneRef.current = true
    setPhase('done')
    const stats = statsRef.current
    const a = arenaRef.current
    sfx('buzzer')
    const us = a.score[0], them = a.score[1]
    const name = sport === 'basketball' ? 'points' : 'goals'
    window.setTimeout(() => {
      if (!mutedRef.current) speakText(us > them ? `That's the game! The Whalehogs win, ${us} to ${them}!` : us === them ? `It's a tie, ${us} ${name} each!` : `The Robots win this one, ${them} to ${us}. Rematch!`, { excited: us > them })
    }, 700)
    const accuracy = stats.answered ? stats.correct / stats.answered : 0
    const stars: 1 | 2 | 3 = accuracy >= 0.9 ? 3 : accuracy >= 0.7 ? 2 : 1
    const chestBonus = stars === 3 ? 5 + Math.floor(Math.random() * 11) : 0
    if (stats.correct === stats.answered) stats.playSeconds += 15
    const deltas = coach ? [] : (Object.keys(skillsRef.current) as SkillId[])
      .filter((k) => Math.round(skillsRef.current[k].theta) !== Math.round(startThetasRef.current[k]))
      .map((k) => ({ skill: k, from: Math.round(startThetasRef.current[k]), to: Math.round(skillsRef.current[k].theta) }))
    timerRef.current = window.setTimeout(() => {
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
        playSecondsEarned: stats.playSeconds,
        arenaScore: { sport, us, them },
      })
    }, 2600)
  }, [coach, dailyDouble, onComplete, sfx, skill, sport])

  // the draw loop is set up once — it calls the latest of these through refs
  const finishRef = useRef(finish)
  finishRef.current = finish
  const nextQuestionRef = useRef(nextQuestion)
  nextQuestionRef.current = nextQuestion

  const answer = useCallback((i: number) => {
    const q = questionRef.current
    if (!q || phaseRef.current !== 'ask' || i < 0 || i >= q.choices.length) return
    ensureAudio()
    if (autoReadTimerRef.current !== null) { window.clearTimeout(autoReadTimerRef.current); autoReadTimerRef.current = null }
    cancelSpeech()
    const correct = i === q.answer
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
      stats.streak += 1
      stats.correct += 1
      stats.bestStreak = Math.max(stats.bestStreak, stats.streak)
      state.bestStreak = Math.max(state.bestStreak, stats.streak)
      const multiplier = (bonusRef.current ? 2 : 1) * (dailyDouble ? 2 : 1)
      coinsDelta = (2 + (stats.streak >= 5 ? 2 : stats.streak >= 3 ? 1 : 0)) * multiplier
      if (speedBoost > 0) { coinsDelta += speedBoost === 1 ? 2 : 1; stats.speedBonuses += 1 }
      if (!spokeRef.current) { coinsDelta += 2; stats.readBonuses += 1 }
      stats.playSeconds += 5 + (speedBoost > 0 ? 2 : 0)
      stats.coins += coinsDelta
      sfx('right')
    } else {
      stats.streak = 0
      missesRef.current.push({ skill: q.skill, prompt: q.prompt, speech: q.speech, visual: q.visual, picked: q.choices[i], answer: q.choices[q.answer], explain: q.explain })
      queueRef.current = [...queueRef.current, { skill: q.skill, difficulty: q.difficulty }].slice(-12)
      sfx('wrong')
    }
    setPicked(i)
    setStreak(stats.streak)
    setCoins(stats.coins)
    setResults((r) => [...r, correct])
    setPhase('feedback')
    onAnswer({ skill: q.skill, difficulty: q.difficulty, correct, coins: coinsDelta, xp: correct ? 1 : 0, newTheta, newBestStreak: state.bestStreak, ms: elapsed })

    // then tip-off: the possession the answer earned
    timerRef.current = window.setTimeout(() => {
      timerRef.current = null
      const a = arenaRef.current
      startPossession(a, correct, correct)
      inputRef.current = { dx: 0, dy: 0, b: false, a: false, bUp: false }
      setHot(correct)
      setMode(correct ? 'attack' : 'defend')
      sfx(sport === 'hockey' ? 'whistle' : 'thud')
      say(possessionCall(sport, correct, correct), correct, true)
      setPhase('play')
    }, correct ? 1100 : 2300)
  }, [dailyDouble, onAnswer, profile.isTester, say, sfx, sport])

  // ------------------------------------------------------------ the loop
  useEffect(() => {
    const canvas = canvasRef.current!
    const ctx = canvas.getContext('2d')!
    ctx.imageSmoothingEnabled = false
    // the whole world is drawn here, then the camera's window is copied to the screen
    const buf = document.createElement('canvas')
    buf.width = W; buf.height = H
    const wctx = buf.getContext('2d')!
    wctx.imageSmoothingEnabled = false
    const cam = { x: (W - VW) / 2, y: sport === 'basketball' ? 0 : (H - VH) / 2 }
    // the floor, drawn once
    const bg = document.createElement('canvas')
    bg.width = W; bg.height = H
    const bctx = bg.getContext('2d')!
    if (sport === 'basketball') drawCourt(bctx)
    else drawRink(bctx)
    bgRef.current = bg

    const a = arenaRef.current
    // a resting scene before tip-off: everyone in place
    startPossession(a, true, false)
    a.ball.holder = -1
    a.ball.x = W / 2; a.ball.y = sport === 'hockey' ? H / 2 : 140; a.ball.z = 0

    let raf = 0
    let last = performance.now()
    let acc = 0
    let clockShown = -1
    const frame = (now: number) => {
      raf = requestAnimationFrame(frame)
      const dt = Math.min(0.1, (now - last) / 1000)
      last = now
      const ph = phaseRef.current
      if (ph === 'play' && !doneRef.current) {
        acc += dt
        while (acc >= STEP) {
          acc -= STEP
          const inp = inputRef.current
          const input: Input = { dx: inp.dx, dy: inp.dy, a: inp.a, b: inp.b, bUp: inp.bUp }
          inp.a = false
          inp.bUp = false
          step(a, input, STEP)
          for (const e of a.events) onEvent(e)
          if (a.over && a.over.wait <= 0) {
            acc = 0
            const stats = statsRef.current
            if (stats.answered >= ROUND_LENGTH) finishRef.current()
            else nextQuestionRef.current(stats.answered)
            break
          }
        }
        const c = Math.max(0, Math.ceil(a.clock))
        if (c !== clockShown) { clockShown = c; setClock(c) }
        const m = a.ball.holder >= 0 ? (a.players[a.ball.holder].team === 0 ? 'attack' : 'defend') : 'loose'
        setMode((prev) => (prev === m ? prev : m))
      }
      draw(wctx, dt)
      // follow the ball (a little ahead of it toward the goal), never past the walls
      const b = a.ball
      const playing = phaseRef.current === 'play'
      const fx = playing ? b.x : W / 2
      const fy = playing ? b.y - b.z + (sport === 'basketball' ? -10 : b.vy * 0.15) : sport === 'basketball' ? 70 : H / 2
      const tx = Math.max(0, Math.min(W - VW, fx - VW / 2))
      const ty = Math.max(0, Math.min(H - VH, fy - VH / 2))
      const k = Math.min(1, dt * 5)
      cam.x += (tx - cam.x) * k
      cam.y += (ty - cam.y) * k
      ctx.drawImage(buf, Math.round(cam.x), Math.round(cam.y), VW, VH, 0, 0, VW, VH)
    }
    raf = requestAnimationFrame(frame)
    return () => cancelAnimationFrame(raf)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sport])

  function onEvent(e: ArenaEvent) {
    const fl = floatersRef.current
    const good = e.team === 0
    if (e.text) fl.push({ x: e.x, y: e.y, text: e.text, life: 1.3, color: good ? '#fde047' : '#f87171' })
    switch (e.kind) {
      case 'pass': sfx('pass'); break
      case 'perfect': sfx('shot'); break
      case 'score':
        setScore([...arenaRef.current.score] as [number, number])
        if (good) { sfx(sport === 'hockey' ? 'horn' : 'swish'); sfx('cheer'); cheerRef.current = 2.5 } else sfx('aww')
        break
      case 'rim': sfx('rim'); break
      case 'steal': case 'intercept': case 'check': sfx(good ? 'steal' : 'thud'); if (good) { sfx('cheer'); cheerRef.current = 1.5 } break
      case 'block': sfx('thud'); break
      case 'save': case 'freeze': sfx('thud'); break
      case 'shotclock': sfx('buzzer'); break
      case 'whistle': sfx('whistle'); break
      case 'post': sfx('rim'); break
    }
    if (e.say) say(e.say, good && (e.kind === 'score' || e.kind === 'steal' || e.kind === 'intercept' || e.kind === 'check'))
  }

  function draw(ctx: CanvasRenderingContext2D, dt: number) {
    const a = arenaRef.current
    const t = performance.now() / 1000
    ctx.drawImage(bgRef.current!, 0, 0)
    cheerRef.current = Math.max(0, cheerRef.current - dt)
    if (sport === 'basketball') {
      // the crowd: rows of heads, jumping when we score
      const cols = ['#fbbf24', '#f87171', '#60a5fa', '#a3e635', '#f472b6', '#e5e7eb', '#fb923c']
      for (let row = 0; row < 2; row++) for (let i = 0; i < 48; i++) {
        const jump = cheerRef.current > 0 && Math.sin(t * 14 + i * 1.7 + row) > 0 ? -2 : 0
        px(ctx, cols[(i * 5 + row * 3) % cols.length], i * 4 + row * 2, 3 + row * 5 + jump, 3, 3)
      }
      // backboard + pole
      px(ctx, '#f8fafc', HOOP.x - 12, 8, 24, 6)
      px(ctx, '#ef4444', HOOP.x - 4, 9, 8, 4)
      px(ctx, '#f8fafc', HOOP.x - 3, 10, 6, 2)
    }
    // bodies back to front, ball by depth
    const order = a.players.map((p, i) => ({ p, i })).sort((x, y) => x.p.y - y.p.y)
    const b = a.ball
    let ballDrawn = false
    const drawBall = () => {
      ctx.globalAlpha = 0.3
      px(ctx, '#000', b.x - 2, b.y, 4, 2)
      ctx.globalAlpha = 1
      if (sport === 'basketball') {
        const by = b.y - b.z - 2
        px(ctx, '#ea580c', b.x - 2, by - 1, 4, 4)
        px(ctx, '#ea580c', b.x - 1, by - 2, 2, 6)
        px(ctx, '#7c2d12', b.x - 2, by + 1, 4, 1)
        px(ctx, '#fdba74', b.x - 1, by - 1, 1, 1)
      } else {
        px(ctx, '#0f172a', b.x - 2, b.y - 1, 4, 2)
      }
    }
    for (const { p, i } of order) {
      if (!ballDrawn && b.y < p.y) { drawBall(); ballDrawn = true }
      drawPlayer(ctx, p, sport, t, (i % 3) + 1)
      // the kid's player: a blinking arrow
      if (i === a.user && phaseRef.current === 'play' && Math.floor(t * 4) % 2 === 0) {
        px(ctx, '#fde047', p.x - 2, p.y - 18, 5, 1)
        px(ctx, '#fde047', p.x - 1, p.y - 17, 3, 1)
        px(ctx, '#fde047', p.x, p.y - 16, 1, 1)
      }
    }
    if (!ballDrawn) drawBall()
    if (sport === 'basketball') {
      // the rim + net in front of a ball dropping through
      px(ctx, '#f97316', HOOP.x - 5, 18, 10, 1)
      px(ctx, '#f97316', HOOP.x - 5, 21, 10, 1)
      px(ctx, '#f97316', HOOP.x - 6, 19, 1, 2); px(ctx, '#f97316', HOOP.x + 5, 19, 1, 2)
      for (let k = 0; k < 5; k++) px(ctx, '#f8fafc', HOOP.x - 4 + k * 2, 22, 1, 4 - (k === 0 || k === 4 ? 1 : 0))
    }
    // the shot meter beside the shooter
    if (a.meter.charging) {
      const u = a.players[a.user]
      const mx = Math.round(u.x) + 7, my = Math.round(u.y) - 24
      px(ctx, '#000', mx - 1, my - 1, 5, 22)
      px(ctx, '#334155', mx, my, 3, 20)
      const sw = sweetWidth(a.hot)
      const gTop = my + Math.round((1 - (SWEET + sw / 2)) * 20)
      px(ctx, a.hot ? '#22c55e' : '#16a34a', mx, gTop, 3, Math.max(2, Math.round(sw * 20)))
      const m = meterValue(a.meter.t)
      px(ctx, '#fde047', mx - 1, my + Math.round((1 - m) * 20) - 1, 5, 2)
    }
    // floating words
    const fl = floatersRef.current
    for (const f of fl) {
      f.life -= dt
      f.y -= dt * 14
      ctx.globalAlpha = Math.max(0, Math.min(1, f.life * 2))
      drawText(ctx, f.text, f.x, f.y, f.color)
    }
    ctx.globalAlpha = 1
    floatersRef.current = fl.filter((f) => f.life > 0)
  }

  // ------------------------------------------------------------ start + cleanup
  useEffect(() => {
    if (coach) speakText(`Team Whalehogs! ${profile.name}, you answer and play. ${coach.name}, you're the coach — help with words, not fingers!`, { excited: true })
    nextQuestion(0)
    warmVoices()
    const onKey = (e: KeyboardEvent, down: boolean) => {
      const k = e.key.toLowerCase()
      const inp = inputRef.current
      const dirs: Record<string, [number, number]> = { arrowleft: [-1, 0], a: [-1, 0], arrowright: [1, 0], d: [1, 0], arrowup: [0, -1], w: [0, -1], arrowdown: [0, 1], s: [0, 1] }
      if (dirs[k]) {
        keys.current[k] = down
        let dx = 0, dy = 0
        for (const [kk, v] of Object.entries(keys.current)) if (v && dirs[kk]) { dx += dirs[kk][0]; dy += dirs[kk][1] }
        inp.dx = Math.sign(dx); inp.dy = Math.sign(dy)
        e.preventDefault()
      } else if (k === 'j' || k === 'z') { if (down && !e.repeat) inp.a = true; e.preventDefault() }
      else if (k === 'k' || k === 'x' || k === ' ') {
        if (down) inp.b = true
        else { inp.b = false; inp.bUp = true }
        e.preventDefault()
      }
    }
    const kd = (e: KeyboardEvent) => {
      if (phaseRef.current === 'play') onKey(e, true)
      else if (phaseRef.current === 'ask' && /^[1-4]$/.test(e.key)) answerRef.current(Number(e.key) - 1)
    }
    const ku = (e: KeyboardEvent) => onKey(e, false)
    window.addEventListener('keydown', kd)
    window.addEventListener('keyup', ku)
    return () => {
      window.removeEventListener('keydown', kd)
      window.removeEventListener('keyup', ku)
      if (autoReadTimerRef.current !== null) window.clearTimeout(autoReadTimerRef.current)
      if (timerRef.current !== null) window.clearTimeout(timerRef.current)
      cancelSpeech()
      audioRef.current?.close().catch(() => {})
      audioRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  const keys = useRef<Record<string, boolean>>({})
  const answerRef = useRef(answer)
  answerRef.current = answer

  // ------------------------------------------------------------ the screen: exactly 4:5, as big as fits
  const stageRef = useRef<HTMLDivElement>(null)
  const [stage, setStage] = useState({ w: 288, h: 360 })
  useEffect(() => {
    const el = stageRef.current
    if (!el) return
    const fit = () => {
      const cw = el.clientWidth - 16, ch = el.clientHeight - 8
      const w = Math.max(144, Math.floor(Math.min(cw, ch * (VW / VH))))
      setStage({ w, h: Math.floor(w * (VH / VW)) })
    }
    fit()
    const ro = new ResizeObserver(fit)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // ------------------------------------------------------------ the D-pad
  const padRef = useRef<HTMLDivElement>(null)
  const [padDir, setPadDir] = useState<[number, number]>([0, 0])
  const onPad = (e: React.PointerEvent) => {
    const r = padRef.current!.getBoundingClientRect()
    const x = e.clientX - (r.left + r.width / 2), y = e.clientY - (r.top + r.height / 2)
    const d = Math.hypot(x, y)
    let dx = 0, dy = 0
    if (d > r.width * 0.12) {
      // 8-way, like the real pad
      const ang = Math.round(Math.atan2(y, x) / (Math.PI / 4)) * (Math.PI / 4)
      dx = Math.round(Math.cos(ang)); dy = Math.round(Math.sin(ang))
    }
    inputRef.current.dx = dx; inputRef.current.dy = dy
    setPadDir((p) => (p[0] === dx && p[1] === dy ? p : [dx, dy]))
  }
  const padUp = () => { inputRef.current.dx = 0; inputRef.current.dy = 0; setPadDir([0, 0]) }
  const [aDown, setADown] = useState(false)
  const [bDown, setBDown] = useState(false)

  const skillMeta = question ? SKILLS.find((s) => s.id === question.skill) : null
  const sportName = sport === 'basketball' ? 'HOOPS' : 'HOCKEY'
  const aLabel = mode === 'attack' ? 'PASS' : 'SWITCH'
  const bLabel = mode === 'attack' ? 'SHOOT' : sport === 'hockey' ? 'CHECK' : 'STEAL'
  const choiceCols = question && question.choices.length === 2 ? 'grid-cols-2' : 'grid-cols-1'

  return (
    <div className="flex flex-col flex-1 min-h-0 bg-slate-950 select-none">
      {/* scoreboard */}
      <div className="flex items-center gap-2 px-2 pt-2 pb-1">
        <button onClick={() => { cancelSpeech(); onQuit() }} aria-label="Quit" className="w-9 h-9 rounded-lg bg-slate-800 text-slate-300 flex items-center justify-center active:scale-95">
          <X className="w-5 h-5" />
        </button>
        <div className="flex-1 grid grid-cols-[1fr_auto_1fr] items-center rounded-lg border-2 border-slate-700 bg-black px-2 py-1 font-mono">
          <div className="text-left">
            <span className="block text-[9px] font-bold text-sky-300 tracking-widest">WHALEHOGS</span>
            <span className="block text-2xl font-black text-yellow-300 leading-none tabular-nums">{score[0]}</span>
          </div>
          <div className="text-center px-2">
            <span className="block text-[9px] font-bold text-slate-400 tracking-widest">{sportName} · {Math.min(qIndex + 1, ROUND_LENGTH)}/{ROUND_LENGTH}</span>
            <span className={`block text-lg font-black leading-none tabular-nums ${phase === 'play' && clock <= 3 ? 'text-red-400' : 'text-orange-300'}`}>{phase === 'play' ? `:${String(clock).padStart(2, '0')}` : '—'}</span>
          </div>
          <div className="text-right">
            <span className="block text-[9px] font-bold text-red-300 tracking-widest">ROBOTS</span>
            <span className="block text-2xl font-black text-yellow-300 leading-none tabular-nums">{score[1]}</span>
          </div>
        </div>
        <div className="text-right font-mono">
          <span className="block text-[11px] font-black text-yellow-300">🪙{coins}</span>
          <span className="block text-[10px] font-bold text-orange-300">{streak >= 2 ? `🔥${streak}` : ''}</span>
        </div>
      </div>
      <div className="flex gap-1 px-3 pb-1">
        {Array.from({ length: ROUND_LENGTH }).map((_, i) => (
          <div key={i} className={`h-1.5 flex-1 rounded-full ${i < results.length ? (results[i] ? 'bg-green-400' : 'bg-red-400') : i === results.length ? 'bg-yellow-300' : 'bg-slate-700'}`} />
        ))}
      </div>

      {/* the arena */}
      <div ref={stageRef} className="relative flex-1 min-h-0 flex items-center justify-center px-2">
        <canvas
          ref={canvasRef}
          width={VW}
          height={VH}
          className="rounded-md border-4 border-slate-800 shadow-2xl"
          style={{ imageRendering: 'pixelated', width: stage.w, height: stage.h }}
        />
        {phase === 'play' && (
          <div className="pointer-events-none absolute top-2 left-1/2 -translate-x-1/2 rounded-md bg-black/70 px-2 py-0.5 font-mono text-[11px] font-black tracking-wider">
            {mode === 'attack' ? <span className="text-yellow-300">{hot ? '🔥 HOT HAND — ' : ''}YOUR BALL</span> : mode === 'defend' ? <span className="text-red-300">🛡️ DEFENSE — {bLabel} IT!</span> : <span className="text-sky-300">LOOSE {sport === 'hockey' ? 'PUCK' : 'BALL'}!</span>}
          </div>
        )}
        {(phase === 'ask' || phase === 'feedback') && question && (
          <div className="absolute inset-0 flex items-center justify-center p-3 bg-slate-950/55">
            <div className="w-full max-w-sm rounded-2xl border-4 border-slate-800 bg-white p-3 shadow-2xl relative">
              {skillMeta && (
                <span className="absolute -top-3 left-3 text-[10px] font-extrabold uppercase tracking-wide bg-blue-600 text-white rounded-full px-2 py-0.5">
                  {skillMeta.emoji} {skillDisplayName(skillMeta, !!profile.isTester)}
                </span>
              )}
              {isBonus && <span className="absolute -top-3 right-3 text-[10px] font-extrabold bg-gradient-to-r from-yellow-400 to-orange-500 text-white rounded-full px-2 py-0.5 animate-bounce">✨ BONUS 2×</span>}
              <p className="text-center text-[11px] font-black text-slate-400 uppercase tracking-wider mt-1">
                {sport === 'basketball' ? 'Right answer = your ball 🔥' : 'Right answer = you win the faceoff 🔥'}
              </p>
              <div className="flex items-center justify-center gap-2 mt-1">
                <p className="text-lg font-extrabold text-slate-800 leading-snug text-center">{question.prompt}</p>
                <button
                  onClick={() => { ensureAudio(); spokeRef.current = true; if (!mutedRef.current) speakText(question.speech, { rate: 0.97 }) }}
                  aria-label="Hear the question"
                  className="shrink-0 w-10 h-10 rounded-full bg-blue-500 text-white flex items-center justify-center shadow active:scale-95"
                >
                  <Volume2 className="w-5 h-5" />
                </button>
              </div>
              {question.visual && <p className="mt-1 text-center text-3xl leading-relaxed whitespace-pre-wrap break-words">{question.visual}</p>}
              <div className={`mt-3 grid ${choiceCols} gap-2`}>
                {question.choices.map((c, i) => {
                  const right = phase === 'feedback' && i === question.answer
                  const wrongPick = phase === 'feedback' && i === picked && i !== question.answer
                  return (
                    <button
                      key={i}
                      disabled={phase !== 'ask'}
                      onClick={() => answer(i)}
                      className={`rounded-xl border-b-4 px-3 py-3 text-xl font-black active:scale-95 active:border-b-2 transition-all ${
                        right ? 'bg-green-500 border-green-700 text-white scale-105' : wrongPick ? 'bg-red-500 border-red-700 text-white' : 'bg-slate-100 border-slate-300 text-slate-800'
                      }`}
                    >
                      {c}
                    </button>
                  )
                })}
              </div>
              {phase === 'feedback' && (
                <p className={`mt-2 text-center font-black ${picked === question.answer ? 'text-green-600' : 'text-orange-600'}`}>
                  {picked === question.answer ? (sport === 'basketball' ? '🏀 Your ball — hot hand!' : '🏒 You win the faceoff!') : `It's ${question.choices[question.answer]} — Robots ball, get on D!`}
                </p>
              )}
            </div>
          </div>
        )}
        {phase === 'done' && (
          <div className="absolute inset-0 flex items-center justify-center bg-slate-950/60">
            <div className="rounded-xl border-4 border-yellow-300 bg-black px-6 py-4 text-center font-mono">
              <p className="text-yellow-300 font-black text-xl">FINAL</p>
              <p className="text-white font-black text-3xl tabular-nums">{score[0]} – {score[1]}</p>
              <p className={`font-black ${score[0] > score[1] ? 'text-green-400' : score[0] === score[1] ? 'text-slate-300' : 'text-red-300'}`}>{score[0] > score[1] ? 'WHALEHOGS WIN!' : score[0] === score[1] ? 'TIE GAME' : 'ROBOTS WIN'}</p>
            </div>
          </div>
        )}
      </div>

      {/* the controller */}
      <div className="flex items-center justify-between px-4 pt-2 pb-2 bg-slate-900 border-t-2 border-slate-800">
        <div
          ref={padRef}
          className="relative w-32 h-32 touch-none"
          onPointerDown={(e) => { (e.target as Element).setPointerCapture?.(e.pointerId); ensureAudio(); onPad(e) }}
          onPointerMove={(e) => { if (e.buttons || e.pointerType === 'touch') onPad(e) }}
          onPointerUp={padUp}
          onPointerCancel={padUp}
          aria-label="Move"
        >
          <div className="absolute inset-0 rounded-full bg-slate-800/80" />
          <div className="absolute left-1/2 top-3 bottom-3 w-11 -translate-x-1/2 rounded-md bg-slate-600" />
          <div className="absolute top-1/2 left-3 right-3 h-11 -translate-y-1/2 rounded-md bg-slate-600" />
          <div className="absolute left-1/2 top-1/2 w-6 h-6 -translate-x-1/2 -translate-y-1/2 rounded-full bg-slate-700" />
          {padDir[1] < 0 && <div className="absolute left-1/2 top-3 w-11 h-10 -translate-x-1/2 rounded-md bg-slate-400/60" />}
          {padDir[1] > 0 && <div className="absolute left-1/2 bottom-3 w-11 h-10 -translate-x-1/2 rounded-md bg-slate-400/60" />}
          {padDir[0] < 0 && <div className="absolute top-1/2 left-3 h-11 w-10 -translate-y-1/2 rounded-md bg-slate-400/60" />}
          {padDir[0] > 0 && <div className="absolute top-1/2 right-3 h-11 w-10 -translate-y-1/2 rounded-md bg-slate-400/60" />}
        </div>
        <div className="flex flex-col items-center gap-1 font-mono">
          <button onClick={() => setMuted((m) => { if (!m) cancelSpeech(); return !m })} className="text-[10px] font-bold text-slate-500">{muted ? '🔇' : '🔊'}</button>
        </div>
        <div className="relative w-40 h-32">
          <button
            className={`absolute left-0 bottom-1 w-[72px] h-[72px] rounded-full border-b-4 font-black text-white touch-none ${aDown ? 'bg-red-700 border-red-900 translate-y-0.5' : 'bg-red-500 border-red-800'}`}
            onPointerDown={(e) => { e.preventDefault(); ensureAudio(); setADown(true); inputRef.current.a = true }}
            onPointerUp={() => setADown(false)}
            onPointerCancel={() => setADown(false)}
            onPointerLeave={() => setADown(false)}
          >
            <span className="block text-2xl leading-none">A</span>
            <span className="block text-[10px] leading-none">{aLabel}</span>
          </button>
          <button
            className={`absolute right-0 top-0 w-[84px] h-[84px] rounded-full border-b-4 font-black text-slate-900 touch-none ${bDown ? 'bg-yellow-500 border-yellow-700 translate-y-0.5' : 'bg-yellow-400 border-yellow-600'}`}
            onPointerDown={(e) => { e.preventDefault(); (e.target as Element).setPointerCapture?.(e.pointerId); ensureAudio(); setBDown(true); inputRef.current.b = true }}
            onPointerUp={() => { setBDown(false); inputRef.current.b = false; inputRef.current.bUp = true }}
            onPointerCancel={() => { setBDown(false); inputRef.current.b = false; inputRef.current.bUp = true }}
          >
            <span className="block text-3xl leading-none">B</span>
            <span className="block text-[10px] leading-none">{mode === 'attack' ? 'HOLD · ' : ''}{bLabel}</span>
          </button>
        </div>
      </div>
      <p className="bg-slate-900 pb-2 text-center text-[10px] font-bold text-slate-500 font-mono">
        {mode === 'attack' ? 'Hold B — let go in the GREEN to shoot · A to pass' : `Chase it down · B to ${bLabel.toLowerCase()} · A to switch players`}
      </p>
    </div>
  )
}
