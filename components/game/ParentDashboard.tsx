'use client'

// Brain Ball — Grown-ups dashboard: per-skill ability, age-normed bell-curve
// percentile, accuracy trends. Gated behind a grown-up math check.

import { useMemo, useState } from 'react'
import { ArrowLeft, TrendingDown, TrendingUp, Minus } from 'lucide-react'
import {
  ageLabel,
  BENCHMARKS,
  expectedThetaForAge,
  ageInMonths,
  percentileForSkill,
  percentileLabel,
  percentileVsBenchmark,
  recentAccuracy,
  trend,
} from '@/lib/game/adaptive'
import { RETAKE_DAYS, retakeDue, TEMPERAMENTS } from '@/lib/game/personality'
import { SKILLS } from '@/lib/game/questions'
import type { KidProfile } from '@/lib/game/types'
import { AccountSync } from './AccountSync'

/** 1 → "1st", 2 → "2nd", 11 → "11th", 22 → "22nd" */
function ord(n: number): string {
  const v = n % 100
  if (v >= 11 && v <= 13) return `${n}th`
  return `${n}${['th', 'st', 'nd', 'rd'][n % 10] ?? 'th'}`
}

export function ParentDashboard({
  profiles,
  onBack,
  onRestore,
}: {
  profiles: KidProfile[]
  onBack: () => void
  onRestore?: (profiles: KidProfile[]) => void
}) {
  const [unlocked, setUnlocked] = useState(false)
  const gate = useMemo(() => {
    const a = 3 + Math.floor(Math.random() * 6)
    const b = 3 + Math.floor(Math.random() * 6)
    return { a, b, answer: a * b }
  }, [])
  const [gateInput, setGateInput] = useState('')
  const [kidId, setKidId] = useState(profiles[0]?.id ?? '')

  const kid = profiles.find((p) => p.id === kidId) ?? profiles[0]

  if (!unlocked) {
    return (
      <div className="max-w-md mx-auto px-6 pt-10">
        <BackButton onBack={onBack} />
        <div className="rounded-3xl bg-white border-2 border-slate-200 shadow-lg p-6 text-center mt-6">
          <div className="text-4xl mb-2">🔒</div>
          <h2 className="text-xl font-black text-slate-800 mb-1">Grown-ups only</h2>
          <p className="text-sm text-slate-500 mb-4">
            Solve to enter: what is {gate.a} × {gate.b}?
          </p>
          <form
            onSubmit={(e) => {
              e.preventDefault()
              if (parseInt(gateInput, 10) === gate.answer) setUnlocked(true)
              else setGateInput('')
            }}
            className="flex gap-2 justify-center"
          >
            <input
              type="number"
              inputMode="numeric"
              value={gateInput}
              onChange={(e) => setGateInput(e.target.value)}
              className="w-24 rounded-xl border-2 border-slate-300 px-3 py-2 text-center text-lg font-bold"
              autoFocus
            />
            <button type="submit" className="rounded-xl bg-blue-600 text-white font-extrabold px-5 py-2 active:scale-95">
              Enter
            </button>
          </form>
        </div>
      </div>
    )
  }

  if (!kid) return null
  const overallAcc = recentAccuracy(kid.history, null, 100)
  const totalAnswered = kid.history.length
  const months = ageInMonths(kid.birthdate)

  // strongest / focus skill among those with enough signal (kids only —
  // age-norm percentiles don't apply to grown-up testers)
  const ranked = kid.isTester
    ? []
    : SKILLS.filter((s) => kid.skills[s.id].attempts >= 3)
        .map((s) => ({ meta: s, pct: percentileForSkill(kid.skills[s.id].theta, kid.birthdate).percentile }))
        .sort((a, b) => b.pct - a.pct)
  const strongest = ranked[0]
  const focus = ranked.length > 1 ? ranked[ranked.length - 1] : undefined

  return (
    <div className="max-w-md mx-auto px-4 pb-10">
      <div className="flex items-center justify-between pt-4 pb-2">
        <BackButton onBack={onBack} />
        <h2 className="text-xl font-black text-slate-800">Progress Report</h2>
        <span className="w-10" />
      </div>

      {/* kid tabs */}
      <div className="flex gap-2 mb-4 flex-wrap">
        {profiles.map((p) => (
          <button
            key={p.id}
            onClick={() => setKidId(p.id)}
            className={`flex-1 min-w-[40%] rounded-2xl border-2 px-2 py-2 font-extrabold text-sm flex items-center justify-center gap-1.5 ${
              p.id === kid.id ? 'bg-blue-600 text-white border-blue-700' : 'bg-white text-slate-600 border-slate-200'
            }`}
          >
            <span className="text-lg">{p.avatar}</span> {p.name}
            {p.isTester && <span className="text-[9px] font-bold opacity-60">TEST</span>}
          </button>
        ))}
      </div>

      {kid.isTester && (
        <div className="rounded-2xl bg-slate-50 border-2 border-slate-200 p-3 mb-4 text-xs font-semibold text-slate-500">
          🧪 Grown-up tester profile — scores are fully separate from the kids. Age-based percentiles, bell curves, and benchmarks are
          hidden (kindergarten norms don&apos;t apply to adults); skill levels and accuracy still track normally.
        </div>
      )}

      {/* parent account & sync */}
      <AccountSync profiles={profiles} onRestore={(p) => onRestore?.(p)} />

      {/* summary stats */}
      <div className="grid grid-cols-3 gap-2 mb-4">
        <Stat label="Age" value={kid.isTester ? 'Adult' : ageLabel(kid.birthdate)} />
        <Stat label="Questions" value={String(totalAnswered)} />
        <Stat label="Recent accuracy" value={overallAcc === null ? '—' : `${Math.round(overallAcc * 100)}%`} />
      </div>

      {/* strengths & focus */}
      {strongest && (
        <div className="rounded-2xl bg-white border-2 border-slate-200 shadow p-4 mb-4">
          <p className="text-xs font-extrabold text-slate-400 uppercase tracking-wide mb-2">At a glance</p>
          <p className="text-sm font-bold text-green-700">
            💪 Excelling: {strongest.meta.emoji} {strongest.meta.name} — ~{ord(strongest.pct)} percentile for age
          </p>
          {focus && (
            <p className="text-sm font-bold text-orange-600 mt-1">
              🌱 Focus next: {focus.meta.emoji} {focus.meta.name} — ~{ord(focus.pct)} percentile. Try a {focus.meta.name} round today; Mix
              rounds are already steering extra questions there automatically.
            </p>
          )}
        </div>
      )}

      {/* personality */}
      <PersonalityCard kid={kid} />

      {/* per-skill cards */}
      <div className="grid gap-3">
        {SKILLS.map((s) => {
          const st = kid.skills[s.id]
          const played = st.attempts > 0
          const calibrated = st.attempts >= 3
          const firm = st.attempts >= 10
          const { percentile, z } = percentileForSkill(st.theta, kid.birthdate)
          const acc = recentAccuracy(kid.history, s.id, 20)
          const tr = trend(kid.history, s.id)
          return (
            <div key={s.id} className="rounded-2xl bg-white border-2 border-slate-200 shadow p-4">
              <div className="flex items-center justify-between mb-1">
                <span className="font-extrabold text-slate-800">
                  {s.emoji} {s.name}
                </span>
                {played ? (
                  <span className="text-xs font-bold text-slate-500">
                    {st.correct}/{st.attempts} correct{acc !== null ? ` · last 20: ${Math.round(acc * 100)}%` : ''}
                  </span>
                ) : (
                  <span className="text-xs font-bold text-slate-400">Not played yet</span>
                )}
              </div>
              {played && (
                <>
                  <div className="flex items-center justify-between text-xs font-bold mb-2">
                    <span className="text-blue-600">
                      {kid.isTester
                        ? 'Tester — no age comparison'
                        : calibrated
                        ? `~${ord(percentile)} percentile for age · ${percentileLabel(percentile)}${firm ? '' : ' · early estimate'}`
                        : `Warming up… (${st.attempts}/3 answers to first estimate)`}
                    </span>
                    {tr && (
                      <span className={`flex items-center gap-1 ${tr === 'up' ? 'text-green-600' : tr === 'down' ? 'text-orange-500' : 'text-slate-400'}`}>
                        {tr === 'up' ? <TrendingUp className="w-3.5 h-3.5" /> : tr === 'down' ? <TrendingDown className="w-3.5 h-3.5" /> : <Minus className="w-3.5 h-3.5" />}
                        {tr === 'up' ? 'improving' : tr === 'down' ? 'dipping' : 'steady'}
                      </span>
                    )}
                  </div>
                  {calibrated && !kid.isTester && (
                    <>
                      <BellCurve z={z} percentile={percentile} kidName={kid.name} />
                      <div className="flex gap-1.5 mt-1 flex-wrap">
                        {BENCHMARKS.map((b) => (
                          <span key={b.key} className="text-[10px] font-extrabold bg-slate-100 text-slate-600 border border-slate-200 rounded-full px-2 py-0.5">
                            {b.flag} vs {b.label}: ~{ord(percentileVsBenchmark(st.theta, kid.birthdate, b.z))}
                          </span>
                        ))}
                      </div>
                    </>
                  )}
                  <div className="mt-2">
                    <div className="flex justify-between text-[10px] font-bold text-slate-400 mb-0.5">
                      <span>Skill level {Math.round(st.theta)}/99</span>
                      {!kid.isTester && <span>typical for age: {Math.round(expectedThetaForAge(months))}</span>}
                    </div>
                    <div className="h-2 rounded-full bg-slate-100 overflow-hidden relative">
                      <div className="h-full rounded-full bg-gradient-to-r from-green-400 to-blue-500" style={{ width: `${st.theta}%` }} />
                      {!kid.isTester && (
                        <div className="absolute top-0 bottom-0 w-0.5 bg-slate-500" style={{ left: `${expectedThetaForAge(months)}%` }} title="typical for age" />
                      )}
                    </div>
                  </div>
                </>
              )}
            </div>
          )
        })}
      </div>

      <p className="text-[11px] text-slate-400 mt-4 leading-relaxed">
        Percentiles are in-game estimates comparing {kid.name}&apos;s adaptive skill level to typical pre-K → kindergarten expectations for
        their exact age ({ageLabel(kid.birthdate)}). The US / Tennessee / Global markers are modeled from published kindergarten-readiness
        distributions — context for framing, not live national data, and not a clinical assessment. Difficulty auto-adjusts every answer to
        keep kids around a 70–80% success rate: hard enough to learn, easy enough to stay fun.
      </p>
      <p className="text-center text-xs font-extrabold text-blue-500 mt-3">Go Whalehogs 🐋🐗 — we don&apos;t say can&apos;t!</p>
    </div>
  )
}

// ---------------------------------------------------------------- bell curve

function BellCurve({ z, percentile, kidName }: { z: number; percentile: number; kidName: string }) {
  const W = 300
  const H = 90
  const pad = 8
  const zClamped = Math.max(-3, Math.min(3, z))
  const xFor = (zz: number) => pad + ((zz + 3) / 6) * (W - pad * 2)
  const yFor = (zz: number) => H - 12 - Math.exp((-zz * zz) / 2) * (H - 24)

  const steps = 60
  let curve = `M ${xFor(-3)} ${yFor(-3)}`
  let fill = `M ${xFor(-3)} ${H - 12}`
  for (let i = 0; i <= steps; i++) {
    const zz = -3 + (i / steps) * 6
    curve += ` L ${xFor(zz).toFixed(1)} ${yFor(zz).toFixed(1)}`
    if (zz <= zClamped) fill += ` L ${xFor(zz).toFixed(1)} ${yFor(zz).toFixed(1)}`
  }
  fill += ` L ${xFor(zClamped).toFixed(1)} ${H - 12} Z`
  const mx = xFor(zClamped)

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto" role="img" aria-label={`${kidName} is at the ${ord(percentile)} percentile`}>
      <line x1={pad} y1={H - 12} x2={W - pad} y2={H - 12} stroke="#cbd5e1" strokeWidth="1.5" />
      <path d={fill} fill="#bfdbfe" opacity="0.7" />
      <path d={curve} fill="none" stroke="#3b82f6" strokeWidth="2" />
      {/* benchmark markers: US mean (center), TN & Global offsets */}
      {BENCHMARKS.map((b) => (
        <g key={b.key}>
          <line x1={xFor(b.z)} y1={yFor(b.z)} x2={xFor(b.z)} y2={H - 12} stroke="#94a3b8" strokeWidth="1" strokeDasharray="3 3" />
          <text x={xFor(b.z)} y={b.key === 'us' ? H - 2 : yFor(b.z) - 3} textAnchor="middle" fontSize="7.5" fill="#94a3b8" fontWeight="700">
            {b.key === 'us' ? '🇺🇸 US typical for age' : b.flag}
          </text>
        </g>
      ))}
      {/* kid marker */}
      <line x1={mx} y1={Math.min(yFor(zClamped), yFor(0)) - 6} x2={mx} y2={H - 12} stroke="#f97316" strokeWidth="2.5" strokeLinecap="round" />
      <circle cx={mx} cy={Math.min(yFor(zClamped), yFor(0)) - 10} r="3.5" fill="#f97316" />
      <text
        x={Math.max(30, Math.min(W - 30, mx))}
        y={Math.min(yFor(zClamped), yFor(0)) - 18}
        textAnchor="middle"
        fontSize="10"
        fill="#ea580c"
        fontWeight="800"
      >
        {kidName} · {ord(percentile)}
      </text>
    </svg>
  )
}

// ---------------------------------------------------------------- personality

function PersonalityCard({ kid }: { kid: KidProfile }) {
  const p = kid.personality
  if (!p) {
    return (
      <div className="rounded-2xl bg-white border-2 border-purple-200 shadow p-4 mb-4">
        <p className="text-xs font-extrabold text-slate-400 uppercase tracking-wide mb-1">Personality — 🦁🦜🦉🐢 Who Am I?</p>
        <p className="text-sm text-slate-500 font-semibold">
          {kid.name} hasn&apos;t taken the Who Am I? quiz yet. It&apos;s 12 this-or-that questions about play and friends (four classic
          temperaments as friendly animals) and gives you parenting & teaching tips matched to their wiring.
        </p>
      </div>
    )
  }
  const t = TEMPERAMENTS[p.current.primary]
  const s = TEMPERAMENTS[p.current.secondary]
  const due = retakeDue(p)
  const taken = new Date(p.current.takenAt)
  const total = Object.values(p.current.scores).reduce((a, b) => a + b, 0) || 1
  return (
    <div className="rounded-2xl bg-white border-2 border-purple-200 shadow p-4 mb-4">
      <div className="flex items-center justify-between mb-1">
        <p className="text-xs font-extrabold text-slate-400 uppercase tracking-wide">Personality</p>
        <span className="text-[10px] font-bold text-slate-400">
          taken {taken.toLocaleDateString()} {due && <span className="text-purple-600">· update due (every ~{RETAKE_DAYS} days)</span>}
        </span>
      </div>
      <p className="text-lg font-black text-slate-800">
        {t.animal} {t.title} <span className="text-xs font-bold text-slate-400">({t.classic})</span>
        <span className="text-sm font-bold text-slate-500"> · part {s.animal} {s.title}</span>
      </p>
      <div className="flex gap-1 my-2">
        {(Object.keys(TEMPERAMENTS) as Array<keyof typeof TEMPERAMENTS>).map((k) => (
          <div key={k} className="flex-1 text-center">
            <div className="h-2 rounded-full bg-slate-100 overflow-hidden">
              <div className="h-full rounded-full bg-purple-400" style={{ width: `${(p.current.scores[k] / total) * 100 * 2}%` }} />
            </div>
            <span className="text-[10px] font-bold text-slate-400">{TEMPERAMENTS[k].animal} {p.current.scores[k]}</span>
          </div>
        ))}
      </div>
      <p className="text-xs text-slate-500 font-semibold mb-2">{t.summary}</p>
      <p className="text-xs font-extrabold text-green-700 mb-1">For parents:</p>
      <ul className="text-xs text-slate-500 font-semibold list-disc pl-4 space-y-0.5 mb-2">
        {t.parentTips.map((tip) => (
          <li key={tip}>{tip}</li>
        ))}
      </ul>
      <p className="text-xs font-extrabold text-blue-700 mb-1">For teachers:</p>
      <p className="text-xs text-slate-500 font-semibold mb-2">{t.teacherTip}</p>
      <p className="text-[11px] text-slate-400 italic">{t.verse}</p>
      {p.history.length > 1 && (
        <p className="text-[10px] text-slate-400 mt-2">
          History: {p.history.map((h) => `${TEMPERAMENTS[h.primary].animal} ${new Date(h.takenAt).toLocaleDateString()}`).join(' → ')}
        </p>
      )}
    </div>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl bg-white border-2 border-slate-200 shadow p-3 text-center">
      <div className="text-sm font-black text-slate-800 leading-tight">{value}</div>
      <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wide mt-0.5">{label}</div>
    </div>
  )
}

function BackButton({ onBack }: { onBack: () => void }) {
  return (
    <button onClick={onBack} aria-label="Back" className="w-10 h-10 rounded-full bg-white border-2 border-slate-200 shadow flex items-center justify-center active:scale-95">
      <ArrowLeft className="w-5 h-5 text-slate-500" />
    </button>
  )
}
