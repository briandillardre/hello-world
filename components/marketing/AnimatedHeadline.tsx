'use client'

import { useEffect, useState } from 'react'

// Rotating "problem → solved" scenarios. Each reveals one word at a time,
// holds on screen, then cycles to the next example of what HammerTrack catches.
const SCENARIOS: { lead: string; punch: string }[] = [
  { lead: 'Your $80K excavator just left at 2 AM.', punch: 'You already got the text.' },
  { lead: 'A $1,200 tool kit walked off the site.', punch: 'You knew before it hit the gate.' },
  { lead: 'Your loader sat idle all afternoon.', punch: 'Now those hours are on the invoice.' },
  { lead: 'A truck drifted off the job site.', punch: 'You saw it the second it moved.' },
  { lead: 'Service was due on the skid steer.', punch: 'HammerTrack flagged it first.' },
]

const STEP = 0.14 // seconds between each word appearing
const HOLD = 3400 // ms the finished sentence stays before the next one

export function AnimatedHeadline() {
  const [i, setI] = useState(0)
  const s = SCENARIOS[i]
  const leadWords = s.lead.split(' ')
  const punchWords = s.punch.split(' ')
  const total = leadWords.length + punchWords.length

  useEffect(() => {
    const revealMs = total * STEP * 1000 + 500
    const t = setTimeout(() => setI((p) => (p + 1) % SCENARIOS.length), revealMs + HOLD)
    return () => clearTimeout(t)
  }, [i, total])

  let w = 0
  const word = (text: string, key: string, amber: boolean) => (
    <span
      key={key}
      className={`anim-word inline-block mr-[0.26em] ${amber ? 'text-amber' : ''}`}
      style={{ animationDelay: `${(w++) * STEP}s` }}
    >
      {text}
    </span>
  )

  return (
    <h1
      key={i}
      className="font-display font-black text-[2.6rem] sm:text-[3.9rem] leading-[1.0] tracking-tight mt-6 text-balance min-h-[3.2em] sm:min-h-[2.3em]"
    >
      {leadWords.map((t, k) => word(t, `l${k}`, false))}
      {punchWords.map((t, k) => word(t, `p${k}`, true))}
    </h1>
  )
}
