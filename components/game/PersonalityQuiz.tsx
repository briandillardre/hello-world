'use client'

// Brain Ball — "Who Am I?" quiz: 12 wholesome this-or-that picks → animal
// temperament reveal. Read aloud for pre-readers; result saved to the profile.

import { useState } from 'react'
import { Volume2 } from 'lucide-react'
import { QUIZ, scoreQuiz, TEMPERAMENTS, type PersonalityResult, type TemperamentId } from '@/lib/game/personality'
import { speak } from '@/lib/game/speech'
import { BackButton } from './BackButton'
import type { KidProfile } from '@/lib/game/types'

interface PersonalityQuizProps {
  kid: KidProfile
  onResult: (result: PersonalityResult) => void
  onExit: () => void
}

export function PersonalityQuiz({ kid, onResult, onExit }: PersonalityQuizProps) {
  const [step, setStep] = useState(-1) // -1 intro, 0..11 questions, 12 reveal
  const [picks, setPicks] = useState<TemperamentId[]>([])
  const [result, setResult] = useState<PersonalityResult | null>(null)

  const startQuiz = () => {
    setStep(0)
    speak(QUIZ[0].speech, { rate: 0.97 })
  }

  const choose = (type: TemperamentId) => {
    const next = [...picks, type]
    if (next.length >= QUIZ.length) {
      const r = scoreQuiz(next)
      setResult(r)
      setStep(QUIZ.length)
      onResult(r)
      const t = TEMPERAMENTS[r.primary]
      speak(`Wow! ${kid.name}, you are a ${t.title}!`, { rate: 0.97, pitch: 1.1 })
      return
    }
    setPicks(next)
    setStep(next.length)
    speak(QUIZ[next.length].speech, { rate: 0.97 })
  }

  // ---------------------------------------------------------------- intro
  if (step === -1) {
    return (
      <div className="max-w-md mx-auto px-6 pt-8 text-center">
        <BackButton onBack={onExit} />
        <div className="text-6xl mt-6 mb-3">🦁🦜🦉🐢</div>
        <h2 className="text-3xl font-black text-slate-800 mb-2">Who Am I?</h2>
        <p className="text-slate-500 font-semibold mb-6">
          {kid.name}, answer 12 fun questions and find out which animal you&apos;re most like! There are no wrong answers — just pick
          what sounds like YOU.
        </p>
        <button
          onClick={startQuiz}
          className="w-full rounded-2xl bg-gradient-to-b from-purple-400 to-purple-600 border-b-4 border-purple-800 text-white text-xl font-extrabold px-6 py-4 shadow-lg active:scale-95"
        >
          ▶️ Let&apos;s find out!
        </button>
        <p className="text-[11px] text-slate-400 mt-6">
          A friendly temperament check based on the classic four-temperaments framework — a conversation starter for grown-ups, not a
          test. Every question is a simple this-or-that about play and friends.
        </p>
      </div>
    )
  }

  // ---------------------------------------------------------------- reveal
  if (step >= QUIZ.length && result) {
    const t = TEMPERAMENTS[result.primary]
    const s = TEMPERAMENTS[result.secondary]
    return (
      <div className="max-w-md mx-auto px-6 pt-10 text-center pb-10">
        <div className="text-7xl mb-2 animate-bounce">{t.animal}</div>
        <p className="text-sm font-extrabold uppercase tracking-widest text-purple-500">{kid.name} is a…</p>
        <h2 className="text-4xl font-black text-slate-800 mb-3">{t.title}!</h2>
        <p className="text-slate-600 font-semibold mb-4">{t.summary}</p>
        <div className="rounded-2xl bg-white border-2 border-purple-200 shadow p-4 text-left mb-3">
          <p className="text-xs font-extrabold text-slate-400 uppercase tracking-wide mb-1">Super-strengths</p>
          <div className="flex flex-wrap gap-1.5">
            {t.strengths.map((x) => (
              <span key={x} className="text-xs font-bold bg-green-100 text-green-700 border border-green-300 rounded-full px-2 py-0.5">
                {x}
              </span>
            ))}
          </div>
        </div>
        <div className="rounded-2xl bg-white border-2 border-blue-200 shadow p-4 text-left mb-3">
          <p className="text-xs font-extrabold text-slate-400 uppercase tracking-wide mb-1">
            Also part {s.animal} {s.title}
          </p>
          <p className="text-xs text-slate-500 font-semibold">{s.summary}</p>
        </div>
        <p className="text-xs text-slate-500 italic mb-6">{t.verse}</p>
        <button
          onClick={onExit}
          className="w-full rounded-2xl bg-gradient-to-b from-green-400 to-green-600 border-b-4 border-green-700 text-white text-lg font-extrabold px-6 py-3.5 shadow-lg active:scale-95"
        >
          🏠 Done!
        </button>
        <p className="text-[11px] text-slate-400 mt-4">Grown-ups: the full breakdown with parenting & teaching tips is in the Progress Report.</p>
      </div>
    )
  }

  // ---------------------------------------------------------------- question
  const q = QUIZ[step]
  return (
    <div className="max-w-md mx-auto px-4 pt-4">
      <div className="flex items-center justify-between mb-4">
        <BackButton onBack={onExit} />
        <div className="flex gap-1">
          {QUIZ.map((_, i) => (
            <span key={i} className={`w-2 h-2 rounded-full ${i < step ? 'bg-purple-500' : i === step ? 'bg-purple-300 animate-pulse' : 'bg-slate-200'}`} />
          ))}
        </div>
        <span className="w-10" />
      </div>
      <div className="rounded-2xl bg-white border-2 border-purple-200 shadow-md px-4 py-3 text-center mb-5 relative">
        <div className="flex items-center justify-center gap-2">
          <p className="text-lg font-extrabold text-slate-800">{q.prompt}</p>
          <button
            onClick={() => speak(q.speech, { rate: 0.97 })}
            aria-label="Hear the question again"
            className="shrink-0 w-9 h-9 rounded-full bg-purple-500 text-white flex items-center justify-center shadow active:scale-95"
          >
            <Volume2 className="w-4 h-4" />
          </button>
        </div>
      </div>
      <div className="grid gap-4">
        {[q.a, q.b].map((opt, i) => (
          <button
            key={i}
            onClick={() => choose(opt.type)}
            className="rounded-3xl bg-white border-2 border-slate-200 shadow-lg p-5 flex items-center gap-4 text-left active:scale-95 transition-transform"
          >
            <span className="text-5xl">{opt.emoji}</span>
            <span className="text-xl font-extrabold text-slate-700">{opt.label}</span>
          </button>
        ))}
      </div>
      <p className="text-center text-xs text-slate-400 mt-5">No wrong answers — pick what sounds most like you!</p>
    </div>
  )
}
