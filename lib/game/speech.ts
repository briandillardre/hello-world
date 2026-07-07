// Brain Ball — shared speech helper. Picks the best English voice the device
// offers (enhanced/neural Siri & Google voices rank above robotic defaults).

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
  if (/samantha|ava|allison|nicky|joanna|aria|jenny/.test(name)) score += 4
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

export function speak(text: string, opts: { rate?: number; pitch?: number } = {}): void {
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
    const u = new SpeechSynthesisUtterance(text)
    // natural defaults — pitched-up speech is what makes TTS sound robotic
    u.rate = opts.rate ?? 1.0
    u.pitch = opts.pitch ?? 1.0
    if (cachedVoice) u.voice = cachedVoice
    window.speechSynthesis.speak(u)
  } catch {
    // speech unsupported — visual play still works
  }
}
