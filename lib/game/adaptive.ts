// Brain Ball — adaptive difficulty engine + age-normed percentile estimates.
//
// Ability (theta) and question difficulty share a 1–99 scale per skill.
// An Elo/IRT-style update moves theta after every answer, and the next
// question is drawn near theta so kids sit in the ~70–80% success zone
// (hard enough to learn, easy enough to stay fun).

import type { AnswerRecord, KidProfile, SkillId, SkillState } from './types'

export const START_THETA = 30

/** logistic expected P(correct) given ability vs difficulty */
export function pCorrect(theta: number, difficulty: number): number {
  return 1 / (1 + Math.pow(10, (difficulty - theta) / 20))
}

/**
 * Update ability after an answer; faster K while calibrating a new kid.
 * speedBoost (0..1) makes FAST correct answers count extra — fluency is
 * stronger evidence of mastery than a slow, effortful right answer. Slow
 * answers are never penalized.
 */
export function updateTheta(state: SkillState, difficulty: number, correct: boolean, speedBoost = 0, cap = 99): number {
  let K = state.attempts < 10 ? 14 : state.attempts < 25 ? 8 : 5
  if (correct && speedBoost > 0) K *= 1 + 0.35 * speedBoost
  const p = pCorrect(state.theta, difficulty)
  const next = state.theta + K * ((correct ? 1 : 0) - p)
  return Math.max(1, Math.min(cap, next))
}

/** adults can keep climbing past the kid scale so top performers separate */
export const ADULT_THETA_CAP = 120

/** answers per skill before the first percentile/curve appears */
export const CALIBRATION_MIN = 3
/** answers per skill before an estimate stops being labeled "early" */
export const FIRM_MIN = 10
/** ceiling of the adult adjusted score (ability + accuracy + speed) */
export const ADULT_SCORE_MAX = 130

/**
 * Pick the next question difficulty. Slightly above ability (stretch), an
 * occasional easy "confidence" question, and a hot-streak bonus so a run of
 * right answers visibly cranks the challenge up within the round.
 */
export function nextDifficulty(state: SkillState, questionIndex: number, streak = 0): number {
  if (questionIndex > 0 && questionIndex % 5 === 4 && streak < 3) {
    return Math.max(1, state.theta - 15) // confidence builder
  }
  const heat = Math.min(14, streak * 3.5) // 4-in-a-row ≈ +14 harder
  const offset = -4 + Math.random() * 12 + heat
  return Math.max(1, Math.min(99, state.theta + offset))
}

/**
 * Weighted skill pick for "Mix it up" rounds. Auto-customizes to the kid:
 * favors least-practiced skills AND skills where they sit below age
 * expectations, so play time flows toward the gaps.
 */
export function pickMixSkill(skills: Record<SkillId, SkillState>, birthdate?: string): SkillId {
  const ids = Object.keys(skills) as SkillId[]
  const weights = ids.map((id) => {
    let w = 1 / (1 + skills[id].attempts / 10)
    if (birthdate && skills[id].attempts >= 3) {
      const { percentile } = percentileForSkill(skills[id].theta, birthdate)
      w *= 1 + Math.max(0, 60 - percentile) / 60 // up to 2× weight for lagging skills
    }
    return w
  })
  const total = weights.reduce((a, b) => a + b, 0)
  let r = Math.random() * total
  for (let i = 0; i < ids.length; i++) {
    r -= weights[i]
    if (r <= 0) return ids[i]
  }
  return ids[ids.length - 1]
}

// ---------------------------------------------------------------- age norms

export function ageInMonths(birthdate: string, now = new Date()): number {
  const b = new Date(birthdate + 'T00:00:00')
  let months = (now.getFullYear() - b.getFullYear()) * 12 + (now.getMonth() - b.getMonth())
  if (now.getDate() < b.getDate()) months -= 1
  return Math.max(0, months)
}

export function ageLabel(birthdate: string, now = new Date()): string {
  const m = ageInMonths(birthdate, now)
  return `${Math.floor(m / 12)} yrs ${m % 12} mo`
}

/**
 * Expected ability by age: rough pre-K → kindergarten trajectory.
 * ~48 mo (age 4) ≈ 30, ~60 mo (age 5) ≈ 50, ~72 mo (age 6) ≈ 70.
 * These are heuristic anchors for framing, not clinical norms.
 */
export function expectedThetaForAge(months: number): number {
  const mean = 30 + ((months - 48) * 40) / 24
  return Math.max(5, Math.min(95, mean))
}

export const NORM_SD = 15

/** standard normal CDF (Zelen & Severo approximation) */
export function normalCdf(z: number): number {
  const t = 1 / (1 + 0.2316419 * Math.abs(z))
  const dNorm = 0.3989423 * Math.exp((-z * z) / 2)
  let p = dNorm * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))))
  if (z > 0) p = 1 - p
  return p
}

/** percentile (1–99) of a kid's ability vs same-age peers */
export function percentileForSkill(theta: number, birthdate: string): { percentile: number; z: number } {
  const mean = expectedThetaForAge(ageInMonths(birthdate))
  const z = (theta - mean) / NORM_SD
  const percentile = Math.max(1, Math.min(99, Math.round(normalCdf(z) * 100)))
  return { percentile, z }
}

/**
 * Peer-group benchmarks, expressed as z-offsets from the US-national age
 * norm. Modeled from published kindergarten-readiness distributions (TN
 * readiness rates run slightly below national; global early-childhood
 * composites slightly below that) — estimates for context, not live data.
 */
export const BENCHMARKS = [
  { key: 'us', label: 'US national', flag: '🇺🇸', z: 0 },
  { key: 'tn', label: 'Tennessee', flag: '🎸', z: -0.08 },
  { key: 'global', label: 'Global', flag: '🌍', z: -0.18 },
] as const

/** percentile vs a specific benchmark group (z-offset from the US norm) */
export function percentileVsBenchmark(theta: number, birthdate: string, benchmarkZ: number): number {
  const { z } = percentileForSkill(theta, birthdate)
  return Math.max(1, Math.min(99, Math.round(normalCdf(z - benchmarkZ) * 100)))
}

/**
 * Adult norms for the tester profiles: typical adults ace early-learning
 * content but lose points to speed/attention slips, so the modeled adult
 * mean sits at theta 85 (SD 10). Scores are presented IQ-style
 * (mean 100, SD 15). A kindergarten quiz can't measure real adult IQ —
 * this is honest-fun framing until adult question banks exist.
 */
export const ADULT_NORM = { mean: 85, sd: 10 }

export const ADULT_BENCHMARKS = [
  { key: 'hs', label: 'Adults (HS diploma)', flag: '🎓', z: 0 },
  { key: 'college', label: 'Adults (college grad)', flag: '🏛️', z: 0.3 },
] as const

/** percentile + z of a tester vs adult norms (optionally vs a benchmark group) */
export function percentileForAdult(theta: number, benchmarkZ = 0): { percentile: number; z: number } {
  const z = (theta - ADULT_NORM.mean) / ADULT_NORM.sd
  const percentile = Math.max(1, Math.min(99, Math.round(normalCdf(z - benchmarkZ) * 100)))
  return { percentile, z }
}

/** IQ-style score (mean 100, SD 15), clamped to a sane display range */
export function iqStyleScore(theta: number): number {
  const z = (theta - ADULT_NORM.mean) / ADULT_NORM.sd
  return Math.max(55, Math.min(155, Math.round(100 + 15 * z)))
}

/**
 * Adjusted adult skill score: ability estimate refined by the two signals a
 * saturated rating throws away — recent accuracy vs the ~75% adaptive target,
 * and response speed vs an 8s reference. This is what separates "100% correct
 * at 3.7s" from "75% correct at 11s" when both pinned the ability ceiling.
 */
export function adultAdjustedScore(theta: number, recentAcc: number | null, medianSec: number | null): number {
  let score = theta
  if (recentAcc !== null) score += (recentAcc - 0.75) * 30 // ±7.5 around the adaptive target
  if (medianSec !== null) score += Math.max(-0.5, Math.min(0.75, (8 - medianSec) / 8)) * 12
  return Math.max(1, Math.min(ADULT_SCORE_MAX, score))
}

/**
 * Consistency (0–100): how steady the last-20 answers were. 100 = no
 * correct/incorrect flip-flopping; low values = streaky, attention-driven
 * performance even when overall accuracy looks fine.
 */
export function consistencyScore(history: AnswerRecord[], n = 20): number | null {
  const recent = history.slice(-n)
  if (recent.length < 6) return null
  let flips = 0
  for (let i = 1; i < recent.length; i++) if (recent[i].correct !== recent[i - 1].correct) flips++
  return Math.round(100 - (flips / (recent.length - 1)) * 100)
}

export function percentileLabel(p: number): string {
  if (p >= 90) return 'Way ahead 🚀'
  if (p >= 75) return 'Ahead of the curve ⭐'
  if (p >= 40) return 'Right on track 👍'
  if (p >= 20) return 'Building skills 🌱'
  return 'Warming up 💪'
}

// ---------------------------------------------------------------- trends

/** accuracy over the last n answers for a skill (or all skills) */
export function recentAccuracy(history: AnswerRecord[], skill: SkillId | null, n = 20): number | null {
  const relevant = skill ? history.filter((h) => h.skill === skill) : history
  if (relevant.length === 0) return null
  const recent = relevant.slice(-n)
  return recent.filter((r) => r.correct).length / recent.length
}

/** compare recent window vs the one before it: 'up' | 'down' | 'flat' | null */
export function trend(history: AnswerRecord[], skill: SkillId, n = 15): 'up' | 'down' | 'flat' | null {
  const relevant = history.filter((h) => h.skill === skill)
  if (relevant.length < n * 2) return null
  const recent = relevant.slice(-n)
  const prior = relevant.slice(-n * 2, -n)
  const rAcc = recent.filter((r) => r.correct).length / n
  const pAcc = prior.filter((r) => r.correct).length / n
  if (rAcc - pAcc > 0.08) return 'up'
  if (pAcc - rAcc > 0.08) return 'down'
  return 'flat'
}

export function brainLevel(profile: KidProfile): { level: number; progress: number } {
  const level = Math.floor(profile.xp / 25) + 1
  const progress = (profile.xp % 25) / 25
  return { level, progress }
}
