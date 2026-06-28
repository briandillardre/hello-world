'use client'

import { useState, useRef, useEffect } from 'react'
import { usePathname } from 'next/navigation'
import { Sparkles, X, Send, HardHat } from 'lucide-react'
import { SUGGESTED_QUESTIONS } from '@/lib/assistant'

interface Msg { role: 'user' | 'assistant'; text: string }

export function AssistantWidget() {
  const [open, setOpen] = useState(false)
  const [msgs, setMsgs] = useState<Msg[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)
  // Pages with the timeline bar at the bottom need the launcher lifted above it
  const pathname = usePathname()
  const overTimeline = pathname === '/map' || pathname === '/command'
  // Sit above the timeline bar — tall enough to clear it in replay mode too
  const launcherPos = overTimeline
    ? 'bottom-[212px] right-3 md:bottom-[160px] md:right-6'
    : 'bottom-[84px] right-4 md:bottom-6 md:right-6'

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })
  }, [msgs, loading])

  async function ask(q: string) {
    const question = q.trim()
    if (!question || loading) return
    setMsgs((m) => [...m, { role: 'user', text: question }])
    setInput('')
    setLoading(true)
    try {
      const res = await fetch('/api/assistant', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ question }),
      })
      const data = await res.json()
      setMsgs((m) => [...m, { role: 'assistant', text: data.answer ?? "I couldn't work that one out." }])
    } catch {
      setMsgs((m) => [...m, { role: 'assistant', text: "I couldn't reach the fleet just now — try again in a sec." }])
    } finally {
      setLoading(false)
    }
  }

  return (
    <>
      {/* Floating launcher */}
      {!open && (
        <button
          onClick={() => setOpen(true)}
          className={`fixed ${launcherPos} z-[60] flex items-center gap-2 rounded-full bg-amber text-[#1a1100] font-display font-bold px-4 py-3 shadow-glow-amber hover:brightness-110 transition`}
          aria-label="Ask HammerTrack AI"
        >
          <Sparkles className="h-5 w-5" /> Ask
        </button>
      )}

      {/* Chat panel */}
      {open && (
        <div className="fixed z-[60] inset-x-0 bottom-0 md:inset-auto md:bottom-6 md:right-6 md:w-[380px] h-[70vh] md:h-[560px] flex flex-col rounded-t-2xl md:rounded-2xl bg-navy-950/95 backdrop-blur border border-navy-700 shadow-panel overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 border-b border-navy-800">
            <span className="flex items-center gap-2 font-display font-bold text-ink">
              <span className="grid place-items-center w-6 h-6 rounded-md bg-amber/20"><Sparkles className="h-3.5 w-3.5 text-amber" /></span>
              HammerTrack AI
            </span>
            <button onClick={() => setOpen(false)} className="text-faint hover:text-ink"><X className="h-5 w-5" /></button>
          </div>

          <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
            {msgs.length === 0 && (
              <div className="text-center mt-6">
                <HardHat className="h-9 w-9 text-amber mx-auto mb-2" />
                <p className="text-sm text-muted">Ask about your fleet, sites, crews, and costs.</p>
                <div className="mt-4 flex flex-col gap-2">
                  {SUGGESTED_QUESTIONS.map((q) => (
                    <button key={q} onClick={() => ask(q)} className="text-left text-[13px] rounded-lg border border-navy-700 bg-navy-900 px-3 py-2 text-muted hover:text-ink hover:border-amber/40 transition">
                      {q}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {msgs.map((m, i) => (
              <div key={i} className={m.role === 'user' ? 'flex justify-end' : 'flex justify-start'}>
                <div className={
                  'max-w-[85%] rounded-2xl px-3.5 py-2 text-[13.5px] whitespace-pre-line ' +
                  (m.role === 'user' ? 'bg-amber text-[#1a1100] font-medium rounded-br-sm' : 'bg-navy-900 border border-navy-800 text-ink rounded-bl-sm')
                }>
                  {m.text}
                </div>
              </div>
            ))}

            {loading && (
              <div className="flex justify-start">
                <div className="bg-navy-900 border border-navy-800 rounded-2xl rounded-bl-sm px-4 py-3">
                  <span className="flex gap-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-faint animate-bounce" style={{ animationDelay: '0ms' }} />
                    <span className="w-1.5 h-1.5 rounded-full bg-faint animate-bounce" style={{ animationDelay: '150ms' }} />
                    <span className="w-1.5 h-1.5 rounded-full bg-faint animate-bounce" style={{ animationDelay: '300ms' }} />
                  </span>
                </div>
              </div>
            )}
          </div>

          <div className="p-3 border-t border-navy-800 flex items-center gap-2">
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') ask(input) }}
              placeholder="Ask about your fleet…"
              className="flex-1 bg-navy-900 border border-navy-700 rounded-full px-4 py-2.5 text-sm text-ink placeholder:text-faint outline-none focus:border-amber/50"
            />
            <button onClick={() => ask(input)} disabled={!input.trim() || loading} className="grid place-items-center w-10 h-10 rounded-full bg-amber text-[#1a1100] disabled:opacity-40 hover:brightness-110 transition">
              <Send className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}
    </>
  )
}
