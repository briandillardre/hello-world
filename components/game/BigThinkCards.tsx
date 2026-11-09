'use client'

// Brain Ball — 💭 Big Think + 🚀 Big Project cards (home screen).
// The other half of Hassabis's split: no right answers here. The kid picks,
// then TALKS it through with a grown-up (Big Think), or does a real step of a
// multi-day project (Big Project). Coins land only behind the grown-up gate,
// the same math check the mission card uses.

import { useMemo, useState } from 'react'
import { Volume2 } from 'lucide-react'
import { dayKey } from '@/lib/game/missions'
import {
  currentProject, PROJECT_FINISH_COINS, PROJECT_STEP_COINS, THINK_COINS, THINK_KIND_WORDS, thinkFor,
  type Project, type Think,
} from '@/lib/game/bigthink'
import { speak } from '@/lib/game/speech'
import type { KidProfile } from '@/lib/game/types'

function GrownUpGate({ prompt, onPass, onCancel, ok }: { prompt: string; onPass: () => void; onCancel: () => void; ok: string }) {
  const [input, setInput] = useState('')
  const [shake, setShake] = useState(false)
  const gate = useMemo(() => {
    const a = 3 + Math.floor(Math.random() * 6)
    const b = 3 + Math.floor(Math.random() * 6)
    return { a, b, answer: a * b }
  }, [])
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        if (parseInt(input, 10) === gate.answer) onPass()
        else {
          setInput('')
          setShake(true)
          window.setTimeout(() => setShake(false), 400)
        }
      }}
      className={`mt-3 rounded-xl bg-white border-2 border-slate-200 p-2.5 ${shake ? 'animate-pulse' : ''}`}
    >
      <p className="text-xs font-extrabold text-slate-600 mb-2 text-center">🔒 Grown-up: {prompt} Then solve {gate.a} × {gate.b}</p>
      <div className="flex gap-2">
        <input type="number" inputMode="numeric" value={input} onChange={(e) => setInput(e.target.value)} aria-label="Grown-up answer"
          className="flex-1 min-w-0 rounded-lg border-2 border-slate-300 px-3 py-2 text-center text-lg font-bold" autoFocus />
        <button type="submit" className="rounded-lg bg-emerald-600 text-white font-extrabold px-4 active:scale-95">{ok}</button>
        <button type="button" onClick={onCancel} className="rounded-lg bg-slate-100 text-slate-500 font-bold px-3 active:scale-95">Not yet</button>
      </div>
    </form>
  )
}

export function BigThinkCard({ kid, onDone }: { kid: KidProfile; onDone: (t: Think, pick: string) => void }) {
  const think = useMemo(() => thinkFor(kid), [kid])
  const doneToday = kid.thinkDoneDay === dayKey()
  const [pick, setPick] = useState<string | null>(null)
  const [asking, setAsking] = useState(false)

  if (doneToday) {
    return (
      <div className="rounded-2xl bg-sky-50 border-2 border-sky-300 shadow p-3 mb-3 flex items-center gap-3">
        <span className="text-3xl">💭</span>
        <div className="flex-1">
          <p className="text-[11px] font-black uppercase tracking-widest text-sky-600">Big Think done!</p>
          <p className="text-sm font-extrabold text-slate-700 leading-tight">{think.ask}</p>
          <p className="text-[11px] font-semibold text-sky-700">+{THINK_COINS} 🪙 · {kid.thinksDone ?? 1} talked through · a new one tomorrow</p>
        </div>
      </div>
    )
  }
  return (
    <div className="rounded-2xl bg-gradient-to-br from-sky-50 to-indigo-100 border-2 border-indigo-300 shadow p-3 mb-3">
      <div className="flex items-center gap-3">
        <span className="text-4xl leading-none">{think.emoji}</span>
        <div className="flex-1 min-w-0">
          <p className="text-[11px] font-black uppercase tracking-widest text-indigo-700">💭 Big Think · {THINK_KIND_WORDS[think.kind]}</p>
          <p className="text-[15px] font-black text-slate-800 leading-tight">{think.ask}</p>
        </div>
        <button onClick={() => speak(`${think.ask} ${think.options.join('? Or ')}?`, { rate: 0.97 })} aria-label="Hear the question"
          className="shrink-0 w-10 h-10 rounded-full bg-indigo-500 text-white flex items-center justify-center shadow active:scale-95">
          <Volume2 className="w-5 h-5" />
        </button>
      </div>
      {!pick ? (
        <div className={`mt-3 grid gap-2 ${think.options.length === 3 ? 'grid-cols-3' : 'grid-cols-2'}`}>
          {think.options.map((o) => (
            <button key={o} onClick={() => { setPick(o); speak(`${o}! There is no one right answer. Now tell a grown-up why you picked that. ${think.why}`, { rate: 0.97 }) }}
              className="rounded-xl bg-white border-2 border-indigo-200 border-b-4 px-2 py-2.5 text-sm font-black text-slate-700 active:scale-95">
              {o}
            </button>
          ))}
        </div>
      ) : (
        <div className="mt-3">
          <p className="text-sm font-bold text-indigo-900">You picked <span className="font-black">{pick}</span>. No one right answer here!</p>
          <p className="text-sm font-semibold text-slate-700 mt-1">🗣️ Now tell a grown-up: {think.why}</p>
          {!asking ? (
            <div className="mt-2 flex gap-2">
              <button onClick={() => setAsking(true)} className="flex-1 rounded-xl bg-gradient-to-b from-indigo-500 to-indigo-700 border-b-4 border-indigo-800 text-white font-black py-2.5 active:scale-95 active:border-b-2">
                We talked about it! <span className="text-xs font-semibold opacity-90">(+{THINK_COINS} 🪙)</span>
              </button>
              <button onClick={() => setPick(null)} className="rounded-xl bg-white border-2 border-slate-200 text-slate-500 font-bold px-3 active:scale-95">Change</button>
            </div>
          ) : (
            <GrownUpGate prompt="did they tell you WHY?" ok="Yes!" onCancel={() => setAsking(false)} onPass={() => {
              setAsking(false)
              onDone(think, pick)
              speak(`Big thinker! ${THINK_COINS} coins!`, { excited: true })
            }} />
          )}
        </div>
      )}
    </div>
  )
}

export function BigProjectCard({ kid, onStep }: { kid: KidProfile; onStep: (p: Project) => void }) {
  const project = useMemo(() => currentProject(kid), [kid])
  const st = kid.project && kid.project.id === project.id ? kid.project : { id: project.id, step: 0, lastDay: '' }
  const doneToday = kid.project?.lastDay === dayKey()
  const [asking, setAsking] = useState(false)
  const step = project.steps[Math.min(st.step, project.steps.length - 1)]
  const last = st.step === project.steps.length - 1

  return (
    <div className="rounded-2xl bg-gradient-to-br from-emerald-50 to-teal-100 border-2 border-teal-300 shadow p-3 mb-3">
      <div className="flex items-center gap-3">
        <span className="text-4xl leading-none">{project.emoji}</span>
        <div className="flex-1 min-w-0">
          <p className="text-[11px] font-black uppercase tracking-widest text-teal-700">🚀 Big Project · {project.title}</p>
          {doneToday ? (
            <p className="text-sm font-extrabold text-slate-700 leading-tight">✅ Step done today! Next step tomorrow.</p>
          ) : (
            <p className="text-[15px] font-black text-slate-800 leading-tight">Step {st.step + 1}: {step.title}</p>
          )}
        </div>
        {!doneToday && (
          <button onClick={() => speak(step.say, { rate: 0.97 })} aria-label="Hear this step"
            className="shrink-0 w-10 h-10 rounded-full bg-teal-500 text-white flex items-center justify-center shadow active:scale-95">
            <Volume2 className="w-5 h-5" />
          </button>
        )}
      </div>
      <div className="mt-2 flex gap-1">
        {project.steps.map((_, i) => (
          <div key={i} className={`h-2 flex-1 rounded-full ${i < st.step ? 'bg-teal-500' : i === st.step && !doneToday ? 'bg-amber-400' : 'bg-teal-100'}`} />
        ))}
      </div>
      <p className="mt-1 text-[10px] font-bold text-teal-700">Builds: {project.builds}</p>
      {!doneToday && (!asking ? (
        <button onClick={() => { setAsking(true); speak('Go get a grown-up to check it!', { excited: true }) }}
          className="mt-2 w-full rounded-xl bg-gradient-to-b from-teal-500 to-teal-700 border-b-4 border-teal-800 text-white font-black py-2.5 active:scale-95 active:border-b-2">
          ✋ We did this step! <span className="text-xs font-semibold opacity-90">(+{PROJECT_STEP_COINS}{last ? ` +${PROJECT_FINISH_COINS} finish` : ''} 🪙)</span>
        </button>
      ) : (
        <GrownUpGate prompt="did they really do this step?" ok="Done!" onCancel={() => setAsking(false)} onPass={() => {
          setAsking(false)
          onStep(project)
          speak(last ? `Project complete! ${project.title}! ${PROJECT_STEP_COINS + PROJECT_FINISH_COINS} coins! Whalehogs finish what they start!` : `Step done! ${PROJECT_STEP_COINS} coins!`, { excited: true })
        }} />
      ))}
    </div>
  )
}
