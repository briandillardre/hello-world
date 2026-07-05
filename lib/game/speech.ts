// Brain Ball — shared speech helper. Picks the best English voice the device
// offers (enhanced/neural Siri & Google voices rank above robotic defaults).

let cachedVoice: SpeechSynthesisVoice | null = null
let listening = false

function rankVoice(v: SpeechSynthesisVoice): number {
  if (!v.lang.toLowerCase().startsWith('en')) return -1
  const name = v.name.toLowerCase()
  let score = v.lang.toLowerCase().startsWith('en-us') ? 1 : 0.5
  if (/neural|natural|premium|enhanced/.test(name)) score += 8
  if (/google us english/.test(name)) score += 6
  if (/samantha|karen|daniel|ava|allison|nicky/.test(name)) score += 4
  if (/siri/.test(name)) score += 3
  if (v.localService) score += 0.25 // no network stall mid-question
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
    u.rate = opts.rate ?? 0.95
    u.pitch = opts.pitch ?? 1.05
    if (cachedVoice) u.voice = cachedVoice
    window.speechSynthesis.speak(u)
  } catch {
    // speech unsupported — visual play still works
  }
}
