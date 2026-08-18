'use client'

import { useState, useRef, useEffect } from 'react'
import { usePathname } from 'next/navigation'
import { Sparkles, X, Send, HardHat, Mic, Volume2, VolumeX, Search, SquarePen } from 'lucide-react'
import { SUGGESTED_QUESTIONS } from '@/lib/assistant'

interface Msg { role: 'user' | 'assistant'; text: string; at?: string }

// A "meaningful chat" = the latest burst of conversation. A gap this long
// between turns starts a new session; older turns hide behind "Show earlier"
// instead of scrolling in as stale context (Brian, Aug 10).
const SESSION_GAP_MS = 3 * 3_600_000
const VISIBLE_CAP = 14
const CUTOFF_KEY = 'ht_ai_cutoff'

/** Index where the visible thread starts: the newest session, capped. */
function sessionStart(msgs: Msg[]): number {
  let start = 0
  for (let i = 1; i < msgs.length; i++) {
    const prev = msgs[i - 1].at ? Date.parse(msgs[i - 1].at!) : NaN
    const cur = msgs[i].at ? Date.parse(msgs[i].at!) : NaN
    if (Number.isFinite(prev) && Number.isFinite(cur) && cur - prev > SESSION_GAP_MS) start = i
  }
  return Math.max(start, msgs.length - VISIBLE_CAP)
}

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
  const [showEarlier, setShowEarlier] = useState(false)
  // Keyword search over the WHOLE stored history (server-side).
  const [searchOpen, setSearchOpen] = useState(false)
  const [searchQ, setSearchQ] = useState('')
  const [searchResults, setSearchResults] = useState<Msg[] | null>(null)
  const [searching, setSearching] = useState(false)
  const cutoffRef = useRef<string | null>(null)
  if (typeof window !== 'undefined' && cutoffRef.current === null) {
    try { cutoffRef.current = localStorage.getItem(CUTOFF_KEY) || '' } catch { cutoffRef.current = '' }
  }
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

  // Edit dialogs announce themselves (ht:dialog from DialogContent). The
  // launcher sits ABOVE the dialog z-index and was floating over edit forms,
  // covering fields — get out of the way while any dialog is open.
  const [dialogDepth, setDialogDepth] = useState(0)
  useEffect(() => {
    const onDialog = (e: Event) => {
      const isOpen = !!(e as CustomEvent).detail?.open
      setDialogDepth((d) => Math.max(0, d + (isOpen ? 1 : -1)))
    }
    window.addEventListener('ht:dialog', onDialog)
    return () => window.removeEventListener('ht:dialog', onDialog)
  }, [])

  // The BottomNav "More" drawer announces itself the same way (ht:drawer) —
  // hide the launcher while it's up so it never covers the Sign out button.
  const [drawerOpen, setDrawerOpen] = useState(false)
  useEffect(() => {
    const onDrawer = (e: Event) => setDrawerOpen(!!(e as CustomEvent).detail?.open)
    window.addEventListener('ht:drawer', onDrawer)
    return () => window.removeEventListener('ht:drawer', onDrawer)
  }, [])

  // First open: pull the persisted thread so the conversation survives
  // reloads and devices (empty when history isn't set up — same UX as before).
  useEffect(() => {
    if (!open || historyLoaded.current) return
    historyLoaded.current = true
    const since = cutoffRef.current
    fetch(`/api/assistant${since ? `?since=${encodeURIComponent(since)}` : ''}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (Array.isArray(j?.messages) && j.messages.length) {
          setMsgs((m) => (m.length ? m : j.messages))
        }
      })
      .catch(() => { /* stateless is fine */ })
  }, [open])

  const newChat = () => {
    const now = new Date().toISOString()
    cutoffRef.current = now
    try { localStorage.setItem(CUTOFF_KEY, now) } catch { /* private mode */ }
    setMsgs([])
    setShowEarlier(false)
    setSearchOpen(false)
    setSearchResults(null)
  }

  const runSearch = async (q: string) => {
    const needle = q.trim()
    if (!needle) { setSearchResults(null); return }
    setSearching(true)
    try {
      const r = await fetch(`/api/assistant?q=${encodeURIComponent(needle)}`)
      const j = r.ok ? await r.json() : null
      setSearchResults(Array.isArray(j?.results) ? j.results : [])
    } catch {
      setSearchResults([])
    } finally {
      setSearching(false)
    }
  }

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
        // sinceTs: after "New chat" the model's context starts fresh too.
        body: JSON.stringify({ question, sinceTs: cutoffRef.current || undefined }),
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
      {/* Floating launcher (hidden on the map — it lives in the banner there —
          and while any edit dialog is open, so it never covers a form) */}
      {!open && !hideLauncher && dialogDepth === 0 && !drawerOpen && (
        <button
          onClick={() => setOpen(true)}
          className={`fixed ${launcherPos} z-[60] print:hidden flex items-center gap-2 rounded-full bg-amber text-[#1a1100] font-display font-bold px-4 py-3 shadow-glow-amber hover:brightness-110 transition`}
          aria-label="Ask HammerTrack AI"
        >
          <Sparkles className="h-5 w-5" /> Ask
        </button>
      )}

      {/* Chat panel */}
      {open && (
        <div className="fixed z-[60] print:hidden inset-x-0 bottom-0 md:inset-auto md:bottom-6 md:right-6 md:w-[380px] h-[70vh] md:h-[560px] flex flex-col rounded-t-2xl md:rounded-2xl bg-navy-950/95 backdrop-blur border border-navy-700 shadow-panel overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 border-b border-navy-800">
            <span className="flex items-center gap-2 font-display font-bold text-ink">
              <span className="grid place-items-center w-6 h-6 rounded-md bg-amber/20"><Sparkles className="h-3.5 w-3.5 text-amber" /></span>
              HammerTrack AI
            </span>
            <div className="flex items-center gap-1">
              <button
                onClick={() => { setSearchOpen((s) => !s); setSearchQ(''); setSearchResults(null) }}
                title="Find in chat history"
                className={'grid place-items-center w-8 h-8 rounded-lg transition ' + (searchOpen ? 'bg-amber/20 text-amber' : 'text-faint hover:text-ink')}
              >
                <Search className="h-4 w-4" />
              </button>
              <button
                onClick={newChat}
                title="New chat — start fresh (history stays searchable)"
                className="grid place-items-center w-8 h-8 rounded-lg text-faint hover:text-ink transition"
              >
                <SquarePen className="h-4 w-4" />
              </button>
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

          {searchOpen && (
            <div className="px-3 py-2 border-b border-navy-800 flex items-center gap-2">
              <input
                value={searchQ}
                onChange={(e) => setSearchQ(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') runSearch(searchQ) }}
                placeholder="Find in chat history… (Enter)"
                autoFocus
                className="flex-1 bg-navy-900 border border-navy-700 rounded-lg px-3 py-1.5 text-[13px] text-ink placeholder:text-faint outline-none focus:border-amber/50"
              />
              <button onClick={() => runSearch(searchQ)} className="text-xs font-semibold text-amber">Find</button>
            </div>
          )}

          <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
            {/* Search results replace the thread while active. */}
            {searchOpen && searchResults !== null ? (
              <>
                <p className="font-mono text-[10px] uppercase tracking-wide text-faint">
                  {searching ? 'Searching…' : `${searchResults.length} match${searchResults.length === 1 ? '' : 'es'} · newest first`}
                </p>
                {searchResults.map((m, i) => (
                  <div key={i} className="rounded-xl border border-navy-800 bg-navy-900 px-3 py-2">
                    <p className="font-mono text-[9.5px] text-faint mb-0.5">
                      {m.role === 'user' ? 'You' : 'HammerTrack AI'}
                      {m.at ? ` · ${new Date(m.at).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}` : ''}
                    </p>
                    <p className="text-[12.5px] text-muted whitespace-pre-line line-clamp-4">{m.text}</p>
                  </div>
                ))}
                {!searching && searchResults.length === 0 && (
                  <p className="text-[12.5px] text-faint text-center mt-4">Nothing matches &ldquo;{searchQ}&rdquo;.</p>
                )}
              </>
            ) : (
            <>
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

            {/* Only the latest session shows by default — old context stays a
                tap away instead of scrolling in as noise. */}
            {(() => {
              const start = showEarlier ? 0 : sessionStart(msgs)
              return (
                <>
                  {start > 0 && (
                    <button
                      onClick={() => setShowEarlier(true)}
                      className="w-full rounded-lg border border-dashed border-navy-700 py-1.5 text-[11.5px] font-semibold text-faint hover:text-ink transition"
                    >
                      Show earlier · {start} message{start === 1 ? '' : 's'}
                    </button>
                  )}
                  {msgs.slice(start).map((m, i) => (
                    <div key={start + i} className={m.role === 'user' ? 'flex justify-end' : 'flex justify-start'}>
                      <div className={
                        'max-w-[85%] rounded-2xl px-3.5 py-2 text-[13.5px] whitespace-pre-line ' +
                        (m.role === 'user' ? 'bg-amber text-[#1a1100] font-medium rounded-br-sm' : 'bg-navy-900 border border-navy-800 text-ink rounded-bl-sm')
                      }>
                        {m.text}
                      </div>
                    </div>
                  ))}
                </>
              )
            })()}
            </>
            )}

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
