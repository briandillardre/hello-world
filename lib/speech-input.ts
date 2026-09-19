import { isNativeApp } from './native'

/**
 * Talking to the app — one door for the Ask AI mic and the map search mic.
 *
 * Brian, Sep 19: "Talk to ai verbally button not working either." In a
 * browser the Web Speech API does the work. Inside the Android shell it is a
 * LIE: `webkitSpeechRecognition` exists on the window, so the mic button
 * showed, but the WebView has no recognition service behind it — `start()`
 * fails straight into `onerror`, the button blinked red for a frame and
 * nothing happened. Nobody could tell that from a broken button.
 *
 * So the door is decided here, once, honestly:
 *   • 'web'    — the browser's own recognizer (Chrome, Edge, Safari).
 *   • 'native' — the shell carries @capacitor-community/speech-recognition
 *                (v1.5.2+): Android's SpeechRecognizer through the bridge.
 *   • 'update' — the shell, but a build from before the plugin. The button
 *                stays, and a tap SAYS what is missing instead of blinking.
 *   • 'none'   — a browser with no recognizer at all: hide the mic.
 */

export type SpeechDoor = 'web' | 'native' | 'update' | 'none'

export const SPEECH_UPDATE_HINT = 'Talking to the app needs the app update — update HammerTrack in Google Play when it shows up. Typing works now.'

export interface SpeechHandlers {
  /** Live transcript while the person is still talking. */
  onPartial: (text: string) => void
  /** The phrase, once the recognizer has settled on it. */
  onFinal: (text: string) => void
  /** Listening stopped — with or without a final phrase. Always last. */
  onEnd: () => void
  /** Something a person can act on (permission, network). */
  onError: (message: string) => void
}

export interface SpeechSession { stop: () => void }

// ── Web Speech API (vendor-prefixed) ──────────────────────────────────────
type WebRecognition = {
  lang: string
  interimResults: boolean
  maxAlternatives: number
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null
  onend: (() => void) | null
  onerror: ((e: { error?: string }) => void) | null
  start: () => void
  stop: () => void
  abort?: () => void
}

function webCtor(): (new () => WebRecognition) | null {
  if (typeof window === 'undefined') return null
  const w = window as unknown as Record<string, unknown>
  return (w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null) as (new () => WebRecognition) | null
}

// ── The native plugin, reached through the global bridge (no build-time
// dependency, exactly like NativePush / native-photos) ─────────────────────
interface NativeSpeech {
  available(): Promise<{ available: boolean }>
  checkPermissions(): Promise<{ speechRecognition: string }>
  requestPermissions(): Promise<{ speechRecognition: string }>
  start(o: { language?: string; maxResults?: number; partialResults?: boolean; popup?: boolean }): Promise<unknown>
  stop(): Promise<void>
  addListener(ev: 'partialResults', cb: (d: { matches?: string[] }) => void): Promise<{ remove: () => Promise<void> }>
  addListener(ev: 'listeningState', cb: (d: { status?: string }) => void): Promise<{ remove: () => Promise<void> }>
}

function nativePlugin(): NativeSpeech | null {
  if (typeof window === 'undefined') return null
  const cap = (window as unknown as { Capacitor?: { isNativePlatform?: () => boolean; Plugins?: Record<string, unknown> } }).Capacitor
  if (!cap?.isNativePlatform?.()) return null
  const p = cap.Plugins?.SpeechRecognition as NativeSpeech | undefined
  return p && typeof p.start === 'function' ? p : null
}

export function speechDoor(): SpeechDoor {
  if (typeof window === 'undefined') return 'none'
  if (isNativeApp()) return nativePlugin() ? 'native' : 'update'
  return webCtor() ? 'web' : 'none'
}

const WEB_ERRORS: Record<string, string | null> = {
  'not-allowed': 'The microphone is blocked for this site — allow it in your browser’s site settings.',
  'service-not-allowed': 'The microphone is blocked for this site — allow it in your browser’s site settings.',
  'audio-capture': 'No microphone found on this device.',
  network: 'Voice needs a network connection.',
  // Silence and "didn’t catch that" are not errors anyone can act on.
  'no-speech': null,
  aborted: null,
}

/**
 * Start listening. Returns null when this device has no door at all (the
 * caller has already shown the reason via speechDoor()). Handlers fire in
 * order partial* → final? → end; onError may fire before end.
 */
export function startSpeech(h: SpeechHandlers, lang = 'en-US'): SpeechSession | null {
  const door = speechDoor()
  if (door === 'web') return startWeb(h, lang)
  if (door === 'native') return startNative(h, lang)
  return null
}

function startWeb(h: SpeechHandlers, lang: string): SpeechSession | null {
  const Ctor = webCtor()
  if (!Ctor) return null
  const rec = new Ctor()
  rec.lang = lang
  rec.interimResults = true
  rec.maxAlternatives = 1
  let ended = false
  let last = ''
  let gotFinal = false
  rec.onresult = (e) => {
    const results = Array.from(e.results as ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }>)
    const text = results.map((r) => r[0]?.transcript ?? '').join(' ').trim()
    if (!text) return
    last = text
    h.onPartial(text)
    if (results.some((r) => r.isFinal) && !gotFinal) { gotFinal = true; h.onFinal(text) }
  }
  rec.onerror = (e) => {
    const msg = WEB_ERRORS[e?.error ?? '']
    if (msg) h.onError(msg)
    else if (msg === undefined && e?.error) h.onError('Voice input failed — try again.')
  }
  rec.onend = () => {
    if (ended) return
    ended = true
    // Chrome sometimes ends without ever flagging a result final: the last
    // thing heard IS the phrase.
    if (!gotFinal && last) { gotFinal = true; h.onFinal(last) }
    h.onEnd()
  }
  try { rec.start() } catch { h.onError('Voice input failed to start — try again.'); h.onEnd(); return null }
  return { stop: () => { try { rec.stop() } catch { /* already stopped */ } } }
}

/**
 * Android's recognizer, through the plugin. The event order the plugin gives
 * us: `partialResults` while speaking, `listeningState: stopped` at the end of
 * speech, then one more `partialResults` carrying the FINAL matches ~½ s
 * later. Errors after start (silence timeout, no match) reject a call that
 * has already resolved, so they never reach us — a watchdog ends the session
 * honestly instead of leaving "Listening…" on the screen forever.
 */
function startNative(h: SpeechHandlers, lang: string): SpeechSession | null {
  const p = nativePlugin()
  if (!p) return null
  let ended = false
  let stopped = false
  let last = ''
  const handles: { remove: () => Promise<void> }[] = []
  let finalTimer: ReturnType<typeof setTimeout> | null = null
  let watchdog: ReturnType<typeof setTimeout> | null = null

  const cleanup = () => {
    if (finalTimer) clearTimeout(finalTimer)
    if (watchdog) clearTimeout(watchdog)
    for (const hd of handles) void hd.remove().catch(() => undefined)
    handles.length = 0
  }
  const finish = () => {
    if (ended) return
    ended = true
    cleanup()
    // The recognizer may still be recording (a watchdog end, a long silence
    // Android has not called yet) — never leave a live microphone behind.
    void p.stop().catch(() => undefined)
    if (last) h.onFinal(last)
    h.onEnd()
  }
  // Once the recognizer has said it stopped, the FINAL result is one event
  // away (~½ s) — so a partial that arrives after the stop is that result,
  // and the session ends right behind it. Before the stop, a partial only
  // resets the safety net. (Ship-check: the first cut re-armed 8 s on the
  // final partial too, so every hands-free ask fired eight seconds late.)
  const armFinal = (afterStop: boolean) => {
    if (finalTimer) clearTimeout(finalTimer)
    finalTimer = setTimeout(finish, afterStop ? 400 : 8000)
  }
  // Nothing heard at all: the recognizer's own silence timeout rejects a
  // call we no longer hold, so this is what ends the session. Pushed back by
  // every partial — a long question is not a timeout.
  const armWatchdog = () => {
    if (watchdog) clearTimeout(watchdog)
    watchdog = setTimeout(finish, 12_000)
  }

  ;(async () => {
    try {
      const { available } = await p.available()
      if (!available) { h.onError('This phone has no speech recognizer installed.'); finish(); return }
      let perm = await p.checkPermissions()
      if (perm.speechRecognition !== 'granted') perm = await p.requestPermissions()
      if (perm.speechRecognition !== 'granted') {
        h.onError('The microphone is off for HammerTrack — allow it in Settings → Apps → HammerTrack → Permissions.')
        finish()
        return
      }
      if (ended) return
      handles.push(await p.addListener('partialResults', (d) => {
        const t = (d?.matches?.[0] ?? '').trim()
        if (!t || ended) return
        last = t
        h.onPartial(t)
        if (stopped) armFinal(true)
        else { armFinal(false); armWatchdog() }
      }))
      handles.push(await p.addListener('listeningState', (d) => {
        if (d?.status === 'stopped') { stopped = true; armFinal(true) }
      }))
      await p.start({ language: lang, maxResults: 3, partialResults: true, popup: false })
      armWatchdog()
    } catch (err) {
      const m = err instanceof Error ? err.message : String(err ?? '')
      if (/permission/i.test(m)) h.onError('The microphone is off for HammerTrack — allow it in Settings → Apps → HammerTrack → Permissions.')
      else if (/busy/i.test(m)) h.onError('The recognizer is busy — try again in a second.')
      else if (/network/i.test(m)) h.onError('Voice needs a network connection.')
      else if (m && !/no match|no speech/i.test(m)) h.onError('Voice input failed — try again.')
      finish()
    }
  })()

  return {
    stop: () => {
      stopped = true
      void p.stop().catch(() => undefined)
      armFinal(true)
    },
  }
}
