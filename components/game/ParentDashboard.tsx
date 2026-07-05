'use client'

// Brain Ball — Grown-ups dashboard: per-skill ability, age-normed bell-curve
// percentile, accuracy trends. Gated behind a grown-up math check.

import { useMemo, useState } from 'react'
import { ArrowLeft, TrendingDown, TrendingUp, Minus } from 'lucide-react'
import {
  ageLabel,
  expectedThetaForAge,
  ageInMonths,
  percentileForSkill,
  percentileLabel,
  recentAccuracy,
  trend,
} from '@/lib/game/adaptive'
import { SKILLS } from '@/lib/game/questions'
import type { KidProfile } from '@/lib/game/types'

export function ParentDashboard({ profiles, onBack }: { profiles: KidProfile[]; onBack: () => void }) {
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

  return (
    <div className="max-w-md mx-auto px-4 pb-10">
      <div className="flex items-center justify-between pt-4 pb-2">
        <BackButton onBack={onBack} />
        <h2 className="text-xl font-black text-slate-800">Progress Report</h2>
        <span className="w-10" />
      </div>

      {/* kid tabs */}
      <div className="flex gap-2 mb-4">
        {profiles.map((p) => (
          <button
            key={p.id}
            onClick={() => setKidId(p.id)}
            className={`flex-1 rounded-2xl border-2 px-3 py-2 font-extrabold flex items-center justify-center gap-2 ${
              p.id === kid.id ? 'bg-blue-600 text-white border-blue-700' : 'bg-white text-slate-600 border-slate-200'
            }`}
          >
            <span className="text-xl">{p.avatar}</span> {p.name}
          </button>
        ))}
      </div>

      {/* summary stats */}
      <div className="grid grid-cols-3 gap-2 mb-4">
        <Stat label="Age" value={ageLabel(kid.birthdate)} />
        <Stat label="Questions" value={String(totalAnswered)} />
        <Stat label="Recent accuracy" value={overallAcc === null ? '—' : `${Math.round(overallAcc * 100)}%`} />
      </div>

      {/* per-skill cards */}
      <div className="grid gap-3">
        {SKILLS.map((s) => {
          const st = kid.skills[s.id]
          const played = st.attempts > 0
          const calibrated = st.attempts >= 10
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
                      {calibrated ? `~${percentile}th percentile for age · ${percentileLabel(percentile)}` : `Calibrating… (${st.attempts}/10 answers)`}
                    </span>
                    {tr && (
                      <span className={`flex items-center gap-1 ${tr === 'up' ? 'text-green-600' : tr === 'down' ? 'text-orange-500' : 'text-slate-400'}`}>
                        {tr === 'up' ? <TrendingUp className="w-3.5 h-3.5" /> : tr === 'down' ? <TrendingDown className="w-3.5 h-3.5" /> : <Minus className="w-3.5 h-3.5" />}
                        {tr === 'up' ? 'improving' : tr === 'down' ? 'dipping' : 'steady'}
                      </span>
                    )}
                  </div>
                  {calibrated && <BellCurve z={z} percentile={percentile} kidName={kid.name} />}
                  <div className="mt-2">
                    <div className="flex justify-between text-[10px] font-bold text-slate-400 mb-0.5">
                      <span>Skill level {Math.round(st.theta)}/99</span>
                      <span>typical for age: {Math.round(expectedThetaForAge(months))}</span>
                    </div>
                    <div className="h-2 rounded-full bg-slate-100 overflow-hidden relative">
                      <div className="h-full rounded-full bg-gradient-to-r from-green-400 to-blue-500" style={{ width: `${st.theta}%` }} />
                      <div className="absolute top-0 bottom-0 w-0.5 bg-slate-500" style={{ left: `${expectedThetaForAge(months)}%` }} title="typical for age" />
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
        their exact age ({ageLabel(kid.birthdate)}). They&apos;re for encouragement and spotting trends — not a clinical assessment. Difficulty
        auto-adjusts every answer to keep kids around a 70–80% success rate: hard enough to learn, easy enough to stay fun.
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
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto" role="img" aria-label={`${kidName} is at the ${percentile}th percentile`}>
      <line x1={pad} y1={H - 12} x2={W - pad} y2={H - 12} stroke="#cbd5e1" strokeWidth="1.5" />
      <path d={fill} fill="#bfdbfe" opacity="0.7" />
      <path d={curve} fill="none" stroke="#3b82f6" strokeWidth="2" />
      {/* mean marker */}
      <line x1={xFor(0)} y1={yFor(0)} x2={xFor(0)} y2={H - 12} stroke="#94a3b8" strokeWidth="1" strokeDasharray="3 3" />
      <text x={xFor(0)} y={H - 2} textAnchor="middle" fontSize="8" fill="#94a3b8" fontWeight="700">
        typical for age
      </text>
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
        {kidName} · {percentile}th
      </text>
    </svg>
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
