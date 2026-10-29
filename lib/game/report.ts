// Brain Ball — the daily parent email report (server-side, pure).
//
// Brian (Oct 29): "Make sure it sends reports max 1 daily if marshall or
// Lincoln played to my email. I want benchmarks and where they stack similar
// to what we got from school." The AMIRA parent report is the model: one row
// per skill, "scored better than X% of kids his age", benchmark context, and
// honest caveats. Built from the cloud-synced profiles by
// /api/cron/brainball-report; max one email per local day, only on days a
// kid actually played.

import {
  ageLabel,
  BENCHMARKS,
  CALIBRATION_MIN,
  FIRM_MIN,
  percentileForSkill,
  percentileVsBenchmark,
  trend,
} from './adaptive'
import { SKILLS } from './questions'
import { TEMPERAMENTS } from './personality'
import type { KidProfile } from './types'

/** local copy of lib/email's escapeHtml — keeps this module pure/standalone for the harness */
function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string))
}

export interface SkillRow {
  id: string
  name: string
  emoji: string
  /** rounded 1–99 ability */
  level: number
  attempts: number
  /** percentile vs US age norm (the headline number) */
  percentile: number
  sc: number
  global: number
  trend: 'up' | 'down' | 'flat' | null
  /** under FIRM_MIN attempts — label the estimate as early */
  early: boolean
}

export interface KidReport {
  name: string
  avatar: string
  age: string
  /** answers inside the report window */
  answered: number
  correct: number
  accuracy: number
  bestStreak: number
  skills: SkillRow[]
  /** mean percentile across calibrated skills (null until something calibrates) */
  overallPct: number | null
  strongest?: string
  focus?: string
  assessment?: KidProfile['assessment']
  /** the narrated writeup: where they are and what's known vs peers, in plain English */
  story: string
}

/** build one report per NON-TESTER kid who answered ≥1 question in the window */
export function buildDailyReports(profiles: KidProfile[], sinceMs: number, now = new Date()): KidReport[] {
  const out: KidReport[] = []
  for (const p of profiles) {
    if (!p || p.isTester || !p.birthdate || !Array.isArray(p.history) || !p.skills) continue
    const cutoff = now.getTime() + 60_000
    const windowAnswers = p.history.filter((h) => h && typeof h.t === 'number' && h.t >= sinceMs && h.t <= cutoff)
    if (windowAnswers.length === 0) continue
    const correct = windowAnswers.filter((a) => a.correct).length
    let bestStreak = 0
    let run = 0
    for (const a of windowAnswers) {
      run = a.correct ? run + 1 : 0
      bestStreak = Math.max(bestStreak, run)
    }
    const skills: SkillRow[] = []
    for (const meta of SKILLS) {
      const st = p.skills[meta.id]
      if (!st || typeof st.theta !== 'number' || st.attempts < CALIBRATION_MIN) continue
      skills.push({
        id: meta.id,
        name: meta.name,
        emoji: meta.emoji,
        level: Math.round(st.theta),
        attempts: st.attempts,
        percentile: percentileForSkill(st.theta, p.birthdate).percentile,
        sc: percentileVsBenchmark(st.theta, p.birthdate, BENCHMARKS[1].z),
        global: percentileVsBenchmark(st.theta, p.birthdate, BENCHMARKS[2].z),
        trend: trend(p.history, meta.id),
        early: st.attempts < FIRM_MIN,
      })
    }
    skills.sort((a, b) => b.percentile - a.percentile)
    const overallPct = skills.length > 0 ? Math.round(skills.reduce((a, s) => a + s.percentile, 0) / skills.length) : null
    const base = {
      name: p.name,
      avatar: p.avatar,
      age: ageLabel(p.birthdate, now),
      answered: windowAnswers.length,
      correct,
      accuracy: Math.round((correct / windowAnswers.length) * 100),
      bestStreak,
      skills,
      overallPct,
      strongest: skills.length > 0 ? skills[0].name : undefined,
      focus: skills.length > 1 ? skills[skills.length - 1].name : undefined,
      assessment: p.assessment,
    }
    const temperament = p.personality?.current?.primary ? TEMPERAMENTS[p.personality.current.primary] : undefined
    out.push({ ...base, story: buildNarrative(base, temperament ? `the ${temperament.title} ${temperament.animal}` : undefined) })
  }
  return out
}

const ord = (n: number) => {
  const s = ['th', 'st', 'nd', 'rd']
  const v = n % 100
  return `${n}${s[(v - 20) % 10] ?? s[v] ?? s[0]}`
}
const listWords = (xs: string[]) => (xs.length <= 1 ? xs.join('') : xs.length === 2 ? `${xs[0]} and ${xs[1]}` : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`)

/**
 * The narrated writeup (Brian, Oct 29: "narrated writeup of where they are
 * and what is known about them vs peers"). Deterministic prose composed from
 * the same facts as the standings rows — no model call, so it always arrives
 * and never says anything the numbers don't. Written name-first (no assumed
 * pronouns) and honest about confidence.
 */
export function buildNarrative(r: Omit<KidReport, 'story'>, personalityTitle?: string): string {
  const name = r.name
  const parts: string[] = []
  const strong = r.skills.filter((s) => s.percentile >= 75)
  const onTrack = r.skills.filter((s) => s.percentile >= 40 && s.percentile < 75)
  const building = r.skills.filter((s) => s.percentile < 40)

  // 1 — where they stand, headline first
  if (r.overallPct === null) {
    parts.push(`${name} (${r.age}) is still calibrating — a few more rounds and the peer standings firm up.`)
  } else if (r.overallPct >= 85) {
    parts.push(`${name} (${r.age}) is playing well ahead of the curve — taken together, the skill standings average out around the ${ord(r.overallPct)} percentile of kids the same age nationally.`)
  } else if (r.overallPct >= 60) {
    parts.push(`${name} (${r.age}) is ahead of the curve overall — the skill standings average out around the ${ord(r.overallPct)} percentile of kids the same age nationally.`)
  } else if (r.overallPct >= 40) {
    parts.push(`${name} (${r.age}) is right on track overall — the skill standings average out around the ${ord(r.overallPct)} percentile of kids the same age nationally.`)
  } else {
    parts.push(`${name} (${r.age}) is still building the basics — around the ${ord(r.overallPct)} percentile overall, which is exactly where plenty of kids this age start; the game is already serving easier questions to build wins.`)
  }

  // 2 — strengths, with numbers
  if (strong.length > 0) {
    parts.push(`The clear strength is ${listWords(strong.map((s) => `${s.name} (${ord(s.percentile)})`))} — genuinely ahead of same-age peers.`)
  } else if (onTrack.length > 0) {
    parts.push(`${listWords(onTrack.map((s) => s.name))} ${onTrack.length === 1 ? 'is' : 'are'} tracking right with same-age peers.`)
  }

  // 3 — the school check, when it corroborates
  if (r.assessment) {
    parts.push(`That squares with the ${r.assessment.title.toLowerCase()} from ${r.assessment.date} (${r.assessment.summary.replace(/\.$/, '')}).`)
  }

  // 4 — the growth lane
  if (building.length > 0 && strong.length > 0) {
    parts.push(
      `The gap to work is ${listWords(building.map((s) => `${s.name} (${ord(s.percentile)})`))} — trailing the reading-side strengths is normal for a strong early reader, and Mix rounds already steer extra questions there.`
    )
  } else if (building.length > 0) {
    parts.push(`${listWords(building.map((s) => `${s.name} (${ord(s.percentile)})`))} ${building.length === 1 ? 'is' : 'are'} the practice lane right now — Mix rounds already steer extra questions there.`)
  }

  // 5 — movement
  const up = r.skills.filter((s) => s.trend === 'up').map((s) => s.name)
  const down = r.skills.filter((s) => s.trend === 'down').map((s) => s.name)
  if (up.length > 0 || down.length > 0) {
    const bits: string[] = []
    if (up.length > 0) bits.push(`${listWords(up)} ${up.length === 1 ? 'is' : 'are'} improving`)
    if (down.length > 0) bits.push(`${listWords(down)} ${down.length === 1 ? 'has' : 'have'} slipped lately`)
    parts.push(`Movement: ${bits.join('; ')}.`)
  }

  // 6 — what's known (confidence), in plain words
  const totalAttempts = r.skills.reduce((a, s) => a + s.attempts, 0)
  const early = r.skills.filter((s) => s.early).map((s) => s.name)
  if (r.skills.length > 0) {
    parts.push(
      `Confidence: these standings rest on ${totalAttempts} scored answers across ${r.skills.length} skills${
        early.length > 0 ? `; ${listWords(early)} ${early.length === 1 ? 'is' : 'are'} still an early read` : ' — a solid base'
      }. They're modeled estimates against typical age expectations, not a school test.`
    )
  }

  // 7 — personality, if the quiz was taken
  if (personalityTitle) {
    parts.push(`The Who Am I? quiz reads ${name} as ${personalityTitle} — worth keeping in mind for how practice lands best.`)
  }

  return parts.join(' ')
}

const TREND_WORD = { up: '▲ improving', down: '▼ slipping', flat: '— steady' } as const

function skillRowHtml(s: SkillRow): string {
  const pct = Math.max(1, Math.min(99, s.percentile))
  return `
    <tr>
      <td style="padding:10px 0;border-top:1px solid #e6edf3;vertical-align:top">
        <div style="font-size:14px;font-weight:700;color:#1e293b">${s.emoji} ${escapeHtml(s.name)}${s.early ? ' <span style="font-size:10px;color:#94a3b8;font-weight:600">(early estimate)</span>' : ''}</div>
        <div style="margin:6px 0 4px;height:8px;border-radius:999px;background:#eef2f7;max-width:360px">
          <div style="height:8px;border-radius:999px;background:linear-gradient(90deg,#4ade80,#3b82f6);width:${pct}%"></div>
        </div>
        <div style="font-size:12px;color:#475569;font-weight:600">Scored better than <b>${pct}%</b> of kids their age</div>
        <div style="font-size:11px;color:#94a3b8">🇺🇸 US ${pct}% · 🌴 SC ${s.sc}% · 🌍 Global ${s.global}%${s.trend ? ` · ${TREND_WORD[s.trend]}` : ''}</div>
      </td>
    </tr>`
}

function kidHtml(r: KidReport): string {
  const name = escapeHtml(r.name)
  return `
  <div style="max-width:520px;margin:0 auto 16px;background:#ffffff;border:1px solid #dbe4ec;border-radius:14px;padding:22px">
    <h2 style="margin:0 0 2px;font-size:18px;color:#0f172a">${r.avatar} ${name} <span style="font-size:12px;color:#94a3b8;font-weight:600">· ${escapeHtml(r.age)}</span></h2>
    <p style="margin:0 0 12px;font-size:13px;color:#475569;font-weight:600">
      Today: ${r.answered} questions · ${r.accuracy}% right${r.bestStreak >= 3 ? ` · 🔥 best streak ${r.bestStreak}` : ''}
      ${r.overallPct !== null ? `<br>Overall: scored better than <b>~${r.overallPct}%</b> of kids their age (across ${r.skills.length} skills)` : ''}
    </p>
    <p style="margin:0 0 12px;padding:10px 12px;background:#f8fafc;border:1px solid #e2e8f0;border-left:3px solid #3b82f6;border-radius:10px;font-size:13px;line-height:1.65;color:#334155">${escapeHtml(r.story)}</p>
    ${
      r.assessment
        ? `<p style="margin:0 0 12px;padding:8px 10px;background:#f0fdf4;border:1px solid #bbf7d0;border-radius:10px;font-size:12px;color:#166534;font-weight:600">🏫 ${escapeHtml(r.assessment.title)} (${escapeHtml(r.assessment.date)}): ${escapeHtml(r.assessment.summary)}</p>`
        : ''
    }
    ${
      r.skills.length > 0
        ? `<table role="presentation" width="100%" style="border-collapse:collapse">${r.skills.map(skillRowHtml).join('')}</table>`
        : `<p style="font-size:12px;color:#94a3b8">Benchmarks appear after a few questions in each skill.</p>`
    }
    ${
      r.strongest && r.focus
        ? `<p style="margin:12px 0 0;font-size:12px;color:#475569;font-weight:600">💪 Strongest: ${escapeHtml(r.strongest)} &nbsp;·&nbsp; 🌱 Worth practicing: ${escapeHtml(r.focus)} (Mix rounds already steer extra questions there)</p>`
        : ''
    }
  </div>`
}

/** the email — AMIRA-style per-skill standings, one card per kid who played */
export function renderReportEmail(reports: KidReport[], now: Date, tz: string): { subject: string; html: string } {
  const dateLabel = new Intl.DateTimeFormat('en-US', { timeZone: tz, month: 'short', day: 'numeric' }).format(now)
  const names = reports.map((r) => r.name).join(' & ')
  const subject = `🧠 Brain Ball — ${names} played today (${dateLabel})`
  const html = `
  <div style="background:#eef4f9;padding:28px 14px;font-family:system-ui,-apple-system,Segoe UI,sans-serif">
    <div style="max-width:520px;margin:0 auto 14px;text-align:center">
      <p style="margin:0;font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:#64748b;font-weight:700">🐋🐗 Whalehogs daily report · ${dateLabel}</p>
    </div>
    ${reports.map(kidHtml).join('')}
    <div style="max-width:520px;margin:0 auto;text-align:center">
      <a href="https://hammertrack.ai/play" style="display:inline-block;margin:4px 0 12px;background:#2563eb;color:#fff;font-weight:700;font-size:13px;padding:10px 18px;border-radius:10px;text-decoration:none">Open the full Grown-ups report</a>
      <p style="margin:0;font-size:11px;line-height:1.6;color:#94a3b8">
        Percentiles are in-game estimates vs modeled age expectations (US / South Carolina / Global context) — encouragement and
        direction, not a clinical assessment. You get at most one of these a day, and only on days somebody played.
      </p>
    </div>
  </div>`
  return { subject, html }
}
