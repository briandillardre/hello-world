'use client'

import { useState, useRef, useEffect } from 'react'
import { usePathname } from 'next/navigation'
import { Sparkles, X, Send, HardHat, Mic, Volume2, VolumeX } from 'lucide-react'
import { SUGGESTED_QUESTIONS } from '@/lib/assistant'

interface Msg { role: 'user' | 'assistant'; text: string }

// Minimal typings for the vendor-prefixed Web Speech API (same shape as MapSearch).
type SpeechRecognitionLike = {
  lang: string
  interimResults: boolean
  maxAlternatives: number
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null
  onend: (() => void) | null
  onerror: (() => void) | null
  start: () => void
  stop: () => void
}

function getSpeechCtor(): (new () => SpeechRecognitionLike) | null {
  if (typeof window === 'undefined') return null
  const w = window as unknown as Record<string, unknown>
  return (w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null) as (new () => SpeechRecognitionLike) | null
}

export function AssistantWidget() {
  const [open, setOpen] = useState(false)
  const [msgs, setMsgs] = useState<Msg[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [listening, setListening] = useState(false)
  // Conversation mode: answers are spoken aloud, and when the voice finishes
  // the mic reopens — ask, listen, ask again, hands never touch the phone.
  const [voiceMode, setVoiceMode] = useState(false)
  const voiceModeRef = useRef(false)
  voiceModeRef.current = voiceMode
  const scrollRef = useRef<HTMLDivElement>(null)
  const recRef = useRef<SpeechRecognitionLike | null>(null)
  const historyLoaded = useRef(false)
  const voiceOk = !!getSpeechCtor()
  // The map + command pages host their own "Ask" button (banner / header), so the
  // floating launcher is hidden there to keep those screens clean.
  const pathname = usePathname()
  const hideLauncher = pathname === '/map' || pathname === '/command'
  const launcherPos = 'bottom-[84px] right-4 md:bottom-6 md:right-6'

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })
  }, [msgs, loading])

  // Allow other UI (e.g. the map top-banner "Ask" button) to open the assistant.
  useEffect(() => {
    const openIt = () => setOpen(true)
    window.addEventListener('ht:ask', openIt)
    return () => window.removeEventListener('ht:ask', openIt)
  }, [])

  // First open: pull the persisted thread so the conversation survives
  // reloads and devices (empty when history isn't set up — same UX as before).
  useEffect(() => {
    if (!open || historyLoaded.current) return
    historyLoaded.current = true
    fetch('/api/assistant')
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (Array.isArray(j?.messages) && j.messages.length) {
          setMsgs((m) => (m.length ? m : j.messages))
        }
      })
      .catch(() => { /* stateless is fine */ })
  }, [open])

  // Speak an answer, then (in conversation mode) reopen the mic when done.
  const speak = (text: string) => {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) return
    window.speechSynthesis.cancel()
    const u = new SpeechSynthesisUtterance(text)
    u.rate = 1.06
    u.onend = () => { if (voiceModeRef.current) startVoice() }
    window.speechSynthesis.speak(u)
  }

  async function ask(q: string) {
    const question = q.trim()
    if (!question || loading) return
    recRef.current?.stop()
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
      const answer = data.answer ?? "I couldn't work that one out."
      setMsgs((m) => [...m, { role: 'assistant', text: answer }])
      if (voiceModeRef.current) speak(answer)
    } catch {
      setMsgs((m) => [...m, { role: 'assistant', text: "I couldn't reach the fleet just now — try again in a sec." }])
    } finally {
      setLoading(false)
    }
  }

  const toggleVoiceMode = () => {
    const next = !voiceMode
    setVoiceMode(next)
    voiceModeRef.current = next
    if (next) startVoice()
    else {
      recRef.current?.stop()
      if ('speechSynthesis' in window) window.speechSynthesis.cancel()
    }
  }

  const startVoice = () => {
    const Ctor = getSpeechCtor()
    if (!Ctor || listening) return
    const rec = new Ctor()
    recRef.current = rec
    rec.lang = 'en-US'
    rec.interimResults = true
    rec.maxAlternatives = 1
    rec.onresult = (e) => {
      const results = Array.from(e.results as ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }>)
      const text = results.map((r) => r[0].transcript).join(' ').trim()
      setInput(text)
      // Final phrase → hands-free ask.
      if (results.some((r) => r.isFinal) && text) ask(text)
    }
    rec.onend = () => setListening(false)
    rec.onerror = () => setListening(false)
    setListening(true)
    rec.start()
  }

  return (
    <>
      {/* Floating launcher (hidden on the map — it lives in the banner there) */}
      {!open && !hideLauncher && (
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
            <div className="flex items-center gap-1">
              {voiceOk && (
                <button
                  onClick={toggleVoiceMode}
                  title={voiceMode ? 'Leave conversation mode' : 'Conversation mode — it talks back'}
                  className={
                    'grid place-items-center w-8 h-8 rounded-lg transition ' +
                    (voiceMode ? 'bg-teal/20 text-teal' : 'text-faint hover:text-ink')
                  }
                >
                  {voiceMode ? <Volume2 className="h-4.5 w-4.5" /> : <VolumeX className="h-4.5 w-4.5" />}
                </button>
              )}
              <button onClick={() => { setOpen(false); recRef.current?.stop(); if ('speechSynthesis' in window) window.speechSynthesis.cancel() }} className="text-faint hover:text-ink"><X className="h-5 w-5" /></button>
            </div>
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
              placeholder={listening ? 'Listening…' : 'Ask about your fleet…'}
              className="flex-1 bg-navy-900 border border-navy-700 rounded-full px-4 py-2.5 text-sm text-ink placeholder:text-faint outline-none focus:border-amber/50"
            />
            {voiceOk && (
              <button
                onClick={startVoice}
                title="Ask by voice"
                className={
                  'grid place-items-center w-10 h-10 rounded-full border transition flex-none ' +
                  (listening ? 'bg-alert/20 border-alert text-alert animate-pulse' : 'bg-navy-900 border-navy-700 text-faint hover:text-ink')
                }
              >
                <Mic className="h-4 w-4" />
              </button>
            )}
            <button onClick={() => ask(input)} disabled={!input.trim() || loading} className="grid place-items-center w-10 h-10 rounded-full bg-amber text-[#1a1100] disabled:opacity-40 hover:brightness-110 transition flex-none">
              <Send className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}
    </>
  )
}
