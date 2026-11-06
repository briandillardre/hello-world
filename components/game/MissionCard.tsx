'use client'

// Brain Ball — 🔨 today's real-world mission card (home screen).
// The kid hears the mission, goes and DOES it, then a grown-up confirms with
// the same kind of math gate the report uses — the coins only land when an
// adult says it really happened.

import { useMemo, useState } from 'react'
import { Volume2 } from 'lucide-react'
import { dayKey, MISSION_COINS, missionFor, type Mission } from '@/lib/game/missions'
import { speak } from '@/lib/game/speech'
import type { KidProfile } from '@/lib/game/types'

export function MissionCard({ kid, onConfirm }: { kid: KidProfile; onConfirm: (m: Mission) => void }) {
  const mission = useMemo(() => missionFor(kid), [kid])
  const doneToday = kid.missionDoneDay === dayKey()
  const [asking, setAsking] = useState(false)
  const [input, setInput] = useState('')
  const [shake, setShake] = useState(false)
  const gate = useMemo(() => {
    const a = 3 + Math.floor(Math.random() * 6)
    const b = 3 + Math.floor(Math.random() * 6)
    return { a, b, answer: a * b }
    // a fresh problem each time the gate opens
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [asking])

  if (doneToday) {
    return (
      <div className="rounded-2xl bg-emerald-50 border-2 border-emerald-300 shadow p-3 mb-3 flex items-center gap-3">
        <span className="text-3xl">✅</span>
        <div className="flex-1">
          <p className="text-[11px] font-black uppercase tracking-widest text-emerald-600">Mission complete!</p>
          <p className="text-sm font-extrabold text-slate-700 leading-tight">{mission.title}</p>
          <p className="text-[11px] font-semibold text-emerald-700">
            +{MISSION_COINS} 🪙 · {kid.missionsDone ?? 1} real-world mission{(kid.missionsDone ?? 1) === 1 ? '' : 's'} done · new one tomorrow
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="rounded-2xl bg-gradient-to-br from-amber-50 to-orange-100 border-2 border-amber-300 shadow p-3 mb-3">
      <div className="flex items-center gap-3">
        <span className="text-4xl leading-none">{mission.emoji}</span>
        <div className="flex-1 min-w-0">
          <p className="text-[11px] font-black uppercase tracking-widest text-amber-700">🔨 Today&apos;s real-world mission</p>
          <p className="text-base font-black text-slate-800 leading-tight">{mission.title}</p>
        </div>
        <button
          onClick={() => speak(mission.say, { rate: 0.97 })}
          aria-label="Hear the mission"
          className="shrink-0 w-10 h-10 rounded-full bg-amber-500 text-white flex items-center justify-center shadow active:scale-95"
        >
          <Volume2 className="w-5 h-5" />
        </button>
      </div>
      {!asking ? (
        <button
          onClick={() => {
            setAsking(true)
            setInput('')
            speak('Great job! Go get a grown-up to check it.', { excited: true })
          }}
          className="mt-3 w-full rounded-xl bg-gradient-to-b from-orange-400 to-orange-600 border-b-4 border-orange-700 text-white font-black py-2.5 active:scale-95 active:border-b-2"
        >
          ✋ I did it! <span className="text-xs font-semibold opacity-90">(+{MISSION_COINS} 🪙)</span>
        </button>
      ) : (
        <form
          onSubmit={(e) => {
            e.preventDefault()
            if (parseInt(input, 10) === gate.answer) {
              setAsking(false)
              onConfirm(mission)
              speak(`Mission complete! ${MISSION_COINS} coins! Whalehogs get it done!`, { excited: true })
            } else {
              setInput('')
              setShake(true)
              window.setTimeout(() => setShake(false), 400)
            }
          }}
          className={`mt-3 rounded-xl bg-white border-2 border-amber-200 p-2.5 ${shake ? 'animate-pulse' : ''}`}
        >
          <p className="text-xs font-extrabold text-slate-600 mb-2 text-center">
            🔒 Grown-up: did they really do it? Then solve {gate.a} × {gate.b}
          </p>
          <div className="flex gap-2">
            <input
              type="number"
              inputMode="numeric"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              aria-label="Grown-up answer"
              className="flex-1 min-w-0 rounded-lg border-2 border-slate-300 px-3 py-2 text-center text-lg font-bold"
              autoFocus
            />
            <button type="submit" className="rounded-lg bg-emerald-600 text-white font-extrabold px-4 active:scale-95">
              Yes, done!
            </button>
            <button type="button" onClick={() => setAsking(false)} className="rounded-lg bg-slate-100 text-slate-500 font-bold px-3 active:scale-95">
              Not yet
            </button>
          </div>
        </form>
      )}
    </div>
  )
}
