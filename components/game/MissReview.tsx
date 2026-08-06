'use client'

// Brain Ball — guided replay of missed questions, one at a time, fully
// read aloud: hear the question, tap until you find the right answer,
// then hear WHY it's right. +1 coin per question fixed.

import { useEffect, useState } from 'react'
import { Volume2 } from 'lucide-react'
import { speak } from '@/lib/game/speech'
import type { MissedQuestion } from '@/lib/game/types'

interface MissReviewProps {
  misses: MissedQuestion[]
  kidName: string
  onDone: (fixedCount: number) => void
}

export function MissReview({ misses, kidName, onDone }: MissReviewProps) {
  const [index, setIndex] = useState(0)
  const [solved, setSolved] = useState(false)
  const [wrongPick, setWrongPick] = useState<string | null>(null)
  const [fixed, setFixed] = useState(0)
  // stable per-question order for the two choices (answer + what they picked)
  const [order, setOrder] = useState(() => (Math.random() < 0.5 ? [0, 1] : [1, 0]))

  const m = misses[index]
  const pair = [m.answer, m.picked]
  const choices = order.map((i) => pair[i])

  // read each question aloud as it appears
  useEffect(() => {
    const t = window.setTimeout(() => speak(`Let's try this one again. ${m.prompt}`, { rate: 0.95 }), 400)
    return () => window.clearTimeout(t)
  }, [index, m.prompt])

  const pick = (choice: string) => {
    if (solved) return
    if (choice === m.answer) {
      setSolved(true)
      setFixed((f) => f + 1)
      speak(`Yes! ${m.answer} is right. ${m.explain ?? ''}`, { rate: 0.95 })
    } else {
      setWrongPick(choice)
      speak('Not that one — try again!', { rate: 0.95 })
    }
  }

  const next = () => {
    if (index + 1 >= misses.length) {
      onDone(fixed)
      return
    }
    // reset synchronously so the next question never flashes "solved" styling
    setSolved(false)
    setWrongPick(null)
    setOrder(Math.random() < 0.5 ? [0, 1] : [1, 0])
    setIndex(index + 1)
  }

  return (
    <div className="max-w-md mx-auto px-4 pt-6 pb-10">
      <div className="text-center mb-4">
        <span className="text-xs font-extrabold uppercase tracking-widest bg-orange-500 text-white rounded-full px-3 py-1">
          🔁 Fix the tricky ones · {index + 1} of {misses.length}
        </span>
      </div>

      <div className="rounded-2xl bg-white border-2 border-orange-200 shadow-md px-4 py-4 text-center mb-4">
        <div className="flex items-center justify-center gap-2">
          <p className="text-xl font-extrabold text-slate-800">{m.prompt}</p>
          <button
            onClick={() => speak(m.prompt, { rate: 0.95 })}
            aria-label="Hear the question"
            className="shrink-0 w-10 h-10 rounded-full bg-orange-500 text-white flex items-center justify-center shadow active:scale-95"
          >
            <Volume2 className="w-5 h-5" />
          </button>
        </div>
        {m.visual && <p className="mt-2 text-4xl leading-relaxed whitespace-pre-wrap break-words">{m.visual}</p>}
      </div>

      <div className="grid gap-3 mb-4">
        {choices.map((c) => {
          const isAnswer = c === m.answer
          const wasWrong = wrongPick === c
          return (
            <button
              key={c}
              onClick={() => pick(c)}
              disabled={solved && !isAnswer}
              className={`rounded-3xl border-2 shadow-lg px-5 py-5 text-2xl font-extrabold active:scale-95 transition-all ${
                solved && isAnswer
                  ? 'bg-green-100 border-green-500 text-green-700 scale-105'
                  : wasWrong
                  ? 'bg-red-50 border-red-300 text-red-400'
                  : 'bg-white border-slate-200 text-slate-700'
              }`}
            >
              {c}
              {solved && isAnswer && ' ✓'}
            </button>
          )
        })}
      </div>

      {solved && (
        <div className="rounded-2xl bg-green-50 border-2 border-green-300 p-4 mb-4">
          <p className="text-sm font-extrabold text-green-700 mb-1">🎉 Now you got it! +1 🪙</p>
          {m.explain && (
            <div className="flex items-start gap-2">
              <p className="text-sm font-semibold text-slate-600 flex-1">{m.explain}</p>
              <button
                onClick={() => speak(m.explain!, { rate: 0.95 })}
                aria-label="Hear why"
                className="shrink-0 w-8 h-8 rounded-full bg-green-500 text-white text-xs flex items-center justify-center active:scale-90"
              >
                <Volume2 className="w-4 h-4" />
              </button>
            </div>
          )}
        </div>
      )}

      {solved ? (
        <button
          onClick={next}
          className="w-full rounded-2xl bg-gradient-to-b from-green-400 to-green-600 border-b-4 border-green-700 text-white text-xl font-extrabold px-6 py-4 shadow-lg active:scale-95"
        >
          {index + 1 >= misses.length ? `🏆 All fixed, ${kidName}!` : 'Next one ▶'}
        </button>
      ) : (
        <button onClick={() => onDone(fixed)} className="w-full text-center text-xs font-bold text-slate-400 underline py-2">
          Skip for now
        </button>
      )}
    </div>
  )
}
