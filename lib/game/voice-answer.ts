// Brain Ball — answering OUT LOUD (Brian, Oct 29: "Can we add audible
// responses from them as well to the game?"). The kid taps the mic, says the
// answer, and the ball rolls to the matching bubble. This module is the pure
// half: spoken transcript → choice index, honest about ambiguity (two choices
// that sound the same → null, never a guess).

const STOP = new Set(['a', 'an', 'the', 'at', 'in', 'on', 'of', 'to', 'is', 'it', 'and'])

/** what a recognizer gives back when a kid SAYS a letter's name */
const LETTER_SOUNDS: Record<string, string[]> = {
  a: ['a', 'ay', 'hey', 'eh'],
  b: ['b', 'bee', 'be'],
  c: ['c', 'see', 'sea', 'si'],
  d: ['d', 'dee', 'de'],
  e: ['e', 'ee'],
  f: ['f', 'ef', 'eff'],
  g: ['g', 'gee', 'ji'],
  h: ['h', 'aitch', 'aich'],
  i: ['i', 'eye', 'aye'],
  j: ['j', 'jay', 'jai'],
  k: ['k', 'kay', 'ok'],
  l: ['l', 'el', 'elle', 'ell'],
  m: ['m', 'em'],
  n: ['n', 'en'],
  o: ['o', 'oh', 'owe'],
  p: ['p', 'pee', 'pea'],
  q: ['q', 'cue', 'queue', 'kyu'],
  r: ['r', 'are', 'arr'],
  s: ['s', 'ess', 'es'],
  t: ['t', 'tee', 'tea'],
  u: ['u', 'you', 'yu'],
  v: ['v', 'vee', 've'],
  w: ['w', 'double you', 'double u', 'dub'],
  x: ['x', 'ex', 'eks'],
  y: ['y', 'why', 'wai'],
  z: ['z', 'zee', 'zed'],
}

const ONES: Record<string, number> = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9,
  ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16,
  seventeen: 17, eighteen: 18, nineteen: 19,
}
// recognizer homophones for a digit said ALONE ("to" mid-sentence is a word, not a 2)
const ONES_LOOSE: Record<string, number> = { won: 1, to: 2, too: 2, for: 4, fore: 4, ate: 8 }
const TENS: Record<string, number> = { twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90 }

/** lowercase, strip everything but letters/digits/spaces (emoji included), collapse */
export function normalizeSpoken(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/** parse the FIRST number said in the tokens ("twenty one" → 21, "7" → 7);
 *  digit homophones ("to", "for") count only when they're the whole answer */
export function spokenNumber(tokens: string[]): number | null {
  for (let i = 0; i < tokens.length; i++) {
    const tk = tokens[i]
    if (/^\d+$/.test(tk)) return Number(tk)
    if (tk in TENS) {
      const next = tokens[i + 1]
      return TENS[tk] + (next && next in ONES && ONES[next] < 10 ? ONES[next] : 0)
    }
    if (tk in ONES) return ONES[tk]
  }
  if (tokens.length === 1 && tokens[0] in ONES_LOOSE) return ONES_LOOSE[tokens[0]]
  return null
}

/** a question is voice-answerable only when EVERY choice has sayable text
 *  (a row of emoji groups can't be matched by a transcript) */
export function voiceable(choices: string[]): boolean {
  return choices.length > 0 && choices.every((c) => normalizeSpoken(c).length > 0)
}

function letterTokenMatches(letter: string, token: string): boolean {
  const alts = LETTER_SOUNDS[letter]
  return !!alts && alts.includes(token)
}

/** did the kid spell a 2-letter blend out loud? ("s c" / "ess see" → "sc") */
function spelledBlend(cand: string, tokens: string[]): boolean {
  if (cand.length !== 2) return false
  for (let i = 0; i + 1 < tokens.length; i++) {
    if (letterTokenMatches(cand[0], tokens[i]) && letterTokenMatches(cand[1], tokens[i + 1])) return true
  }
  return false
}

/**
 * Match a spoken transcript to one choice. Returns the index, or null when
 * nothing matches or more than one choice matches equally well — a tie means
 * "tap the one you mean", never a coin flip.
 */
export function matchSpoken(transcript: string, choices: string[]): number | null {
  const t = normalizeSpoken(transcript)
  if (!t) return null
  const tokens = t.split(' ')
  const saidNumber = spokenNumber(tokens)

  const scores = choices.map((raw) => {
    const cand = normalizeSpoken(raw)
    if (!cand) return 0
    // exact phrase
    if (t === cand) return 100
    // the whole choice phrase appears in what was said
    if ((' ' + t + ' ').indexOf(' ' + cand + ' ') >= 0) return 90
    const candTokens = cand.split(' ')
    // all content words of the choice were said ("the beach" → "at the beach")
    const content = candTokens.filter((w) => !STOP.has(w))
    if (content.length > 0 && content.every((w) => tokens.indexOf(w) >= 0)) return 80
    // a single letter, said by name ("why" → Y)
    if (cand.length === 1 && /[a-z]/.test(cand) && tokens.some((tk) => letterTokenMatches(cand, tk))) return 70
    // a number, said in words ("twenty one" → 21)
    if (/^\d+$/.test(cand) && saidNumber !== null && saidNumber === Number(cand)) return 70
    // a two-letter blend, spelled out ("ess see" → sc)
    if (spelledBlend(cand, tokens)) return 70
    return 0
  })

  let best = 0
  for (const s of scores) best = Math.max(best, s)
  if (best === 0) return null
  const winners: number[] = []
  scores.forEach((s, i) => {
    if (s === best) winners.push(i)
  })
  if (winners.length !== 1) return null // ambiguous out loud (e.g. "b" vs "B")
  return winners[0]
}
