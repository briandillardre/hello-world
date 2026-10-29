// Brain Ball — shared speech helper. Picks the best English voice the device
// offers (enhanced/neural Siri & Google voices rank above robotic defaults)
// and speaks sentence-by-sentence: each sentence gets its own utterance with a
// tiny pitch drift, so long lines don't flatten into one monotone run — the
// single biggest "robot voice" tell in every engine we tested.

let cachedVoice: SpeechSynthesisVoice | null = null
let listening = false

// macOS/iOS novelty voices that sound like a haunted robot — never pick these
const NOVELTY =
  /albert|bad news|bahh|bells|boing|bubbles|cellos|deranged|good news|jester|organ|superstar|trinoids|whisper|wobble|zarvox|fred|junior|kathy|ralph|grandma|grandpa|rocko|shelley|sandy|eddy|flo|reed/

function rankVoice(v: SpeechSynthesisVoice): number {
  if (!v.lang.toLowerCase().startsWith('en')) return -1
  const name = v.name.toLowerCase()
  if (NOVELTY.test(name)) return -0.5 // better than nothing, worse than anything
  let score = v.lang.toLowerCase().startsWith('en-us') ? 1 : 0.5
  if (/neural|natural|premium|enhanced/.test(name)) score += 8
  if (/google us english/.test(name)) score += 7 // Chrome's network voice — far better than local defaults
  // network-served voices (localService false) are near-universally the good ones:
  // Chrome's Google voices, Edge's "Online (Natural)" set, Android's network TTS
  if (v.localService === false) score += 3
  if (/samantha|ava|allison|nicky|joanna|aria|jenny|emma|michelle/.test(name)) score += 4
  if (/karen|daniel|moira|tessa/.test(name)) score += 2
  if (/siri/.test(name)) score += 3
  return score
}

function pickVoice(): SpeechSynthesisVoice | null {
  const voices = window.speechSynthesis.getVoices()
  if (voices.length === 0) return null
  let best: SpeechSynthesisVoice | null = null
  let bestScore = -1
  for (const v of voices) {
    const s = rankVoice(v)
    if (s > bestScore) {
      best = v
      bestScore = s
    }
  }
  return bestScore >= 0 ? best : null
}

/** stop any in-flight narration (mute toggles, screen exits) */
export function cancelSpeech(): void {
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) return
  try {
    window.speechSynthesis.cancel()
  } catch {
    // ignore — speech unsupported
  }
}

/** some browsers populate the voice list async; poke it early */
export function warmVoices(): void {
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) return
  try {
    window.speechSynthesis.getVoices()
  } catch {
    // ignore
  }
}

/** split narration into sentence-sized utterances so prosody resets naturally.
 *  Quoted words and spelled-out letters stay glued to their sentence. */
export function splitSentences(text: string): string[] {
  // no lookbehind — it throws at parse time on older iOS Safari
  const matches = text.match(/[^.!?…]+[.!?…]+["”’)]?|[^.!?…]+$/g)
  if (!matches) return [text]
  const out: string[] = []
  for (const m of matches) {
    const t = m.trim()
    if (t.length > 0) out.push(t)
  }
  return out.length > 0 ? out : [text]
}

export function speak(text: string, opts: { rate?: number; pitch?: number; excited?: boolean } = {}): void {
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) return
  try {
    if (!listening) {
      listening = true
      // voices often populate async; refresh our pick when they arrive
      window.speechSynthesis.addEventListener?.('voiceschanged', () => {
        cachedVoice = pickVoice()
      })
    }
    if (!cachedVoice) cachedVoice = pickVoice()
    window.speechSynthesis.cancel()
    const baseRate = opts.rate ?? (opts.excited ? 1.04 : 1.0)
    const basePitch = opts.pitch ?? (opts.excited ? 1.12 : 1.0)
    const sentences = splitSentences(text)
    sentences.forEach((s, i) => {
      const u = new SpeechSynthesisUtterance(s)
      // natural defaults — pitched-up speech is what makes TTS sound robotic;
      // a hair of per-sentence drift keeps multi-sentence lines from flattening
      const drift = sentences.length > 1 ? Math.sin(i * 1.7) * 0.04 : 0
      u.rate = baseRate
      u.pitch = Math.max(0.5, Math.min(2, basePitch + drift + (/[!]$/.test(s) ? 0.06 : 0)))
      if (cachedVoice) u.voice = cachedVoice
      window.speechSynthesis.speak(u)
    })
  } catch {
    // speech unsupported — visual play still works
  }
}
