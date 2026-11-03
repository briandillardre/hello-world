// Brain Ball — question generators, banded by difficulty (1–99).
// Every generator returns distinct choices, a pre-reader-friendly spoken
// prompt, and a kid-friendly `explain` for the end-of-round miss review.

import type { Question, SkillId, SkillMeta } from './types'

export const SKILLS: SkillMeta[] = [
  { id: 'counting', name: 'Counting', emoji: '🐤', blurb: 'How many do you see?' },
  { id: 'numbers', name: 'Numbers', emoji: '🔢', blurb: 'Find, compare & order numbers' },
  { id: 'addition', name: 'Math', emoji: '➕', blurb: 'Adding & taking away' },
  { id: 'letters', name: 'Letters', emoji: '🔤', blurb: 'Big & little letters' },
  { id: 'sounds', name: 'Sounds', emoji: '👂', blurb: 'First sounds & rhymes' },
  { id: 'shapes', name: 'Shapes', emoji: '🔺', blurb: 'Shapes, colors & patterns' },
  { id: 'words', name: 'Words', emoji: '📖', blurb: 'Sight words & first reading' },
  { id: 'science', name: 'Science', emoji: '🔬', blurb: 'How the world works' },
]

const ri = (lo: number, hi: number) => lo + Math.floor(Math.random() * (hi - lo + 1))
const pick = <T,>(arr: readonly T[]): T => arr[Math.floor(Math.random() * arr.length)]

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

/** build choices from a correct value + distractor pool, return shuffled with answer index */
function makeChoices<T>(correct: T, distractors: T[], count = 3): { choices: string[]; answer: number } {
  const uniq = distractors.filter((d, i) => String(d) !== String(correct) && distractors.findIndex((x) => String(x) === String(d)) === i)
  const opts = shuffle([correct, ...shuffle(uniq).slice(0, count - 1)])
  return { choices: opts.map(String), answer: opts.findIndex((o) => String(o) === String(correct)) }
}

function numberDistractors(n: number, spread: number, min = 0, max = 99): number[] {
  const out = new Set<number>()
  let guard = 0
  while (out.size < 6 && guard++ < 60) {
    const d = n + (Math.random() < 0.5 ? -1 : 1) * ri(1, spread)
    if (d !== n && d >= min && d <= max) out.add(d)
  }
  return Array.from(out)
}

const COUNT_EMOJI = ['🐤', '🐞', '🍎', '🚗', '🐟', '⭐', '🎈', '🐸', '🦆', '🍓', '🚜', '⚽'] as const

// ---------------------------------------------------------------- counting
function genCounting(d: number): Question {
  const emoji = pick(COUNT_EMOJI)
  // variation: which group has MORE / FEWER?
  if (d >= 20 && d < 70 && Math.random() < 0.35) {
    const e1 = pick(COUNT_EMOJI)
    let e2 = pick(COUNT_EMOJI)
    while (e2 === e1) e2 = pick(COUNT_EMOJI)
    const a = ri(2, d < 45 ? 6 : 9)
    let b = ri(2, d < 45 ? 6 : 9)
    while (b === a) b = ri(2, d < 45 ? 6 : 9)
    const more = Math.random() < 0.5
    const winner = more ? (a > b ? e1 : e2) : a > b ? e2 : e1
    const opts = shuffle([e1, e2])
    return {
      skill: 'counting',
      difficulty: d,
      prompt: `Which group has ${more ? 'MORE' : 'FEWER'}?`,
      speech: `Look at both groups. Which one has ${more ? 'more' : 'fewer'}?`,
      visual: `${e1.repeat(a)}\n${e2.repeat(b)}`,
      choices: opts,
      answer: opts.indexOf(winner),
      explain: `Count them: ${a} on top and ${b} on the bottom — ${winner} has ${more ? 'more' : 'fewer'}.`,
    }
  }
  let n: number
  if (d < 20) n = ri(1, 4)
  else if (d < 40) n = ri(3, 7)
  else if (d < 60) n = ri(5, 10)
  else if (d < 80) n = ri(8, 15)
  else {
    // skip counting: by 2s, 5s, 10s — 3s and 4s at the very top
    const step = d >= 90 ? pick([3, 4, 5] as const) : pick([2, 5, 10] as const)
    const start = step * ri(1, 3)
    const seq = [start, start + step, start + step * 2]
    const next = start + step * 3
    const { choices, answer } = makeChoices(next, numberDistractors(next, step, 1))
    return {
      skill: 'counting',
      difficulty: d,
      prompt: `What number comes next? ${seq.join(', ')}, …`,
      speech: `What number comes next? ${seq.join(', ')}`,
      choices,
      answer,
      explain: `We're counting by ${step}s: ${seq.join(', ')}… so ${next} comes next!`,
    }
  }
  // rows of 5 so bigger counts are countable
  const items: string[] = []
  for (let i = 0; i < n; i++) items.push(emoji + ((i + 1) % 5 === 0 ? '\n' : ''))
  const { choices, answer } = makeChoices(n, numberDistractors(n, d < 40 ? 2 : 3, 1, 20))
  return {
    skill: 'counting',
    difficulty: d,
    prompt: 'How many do you see?',
    speech: 'Count them! How many do you see?',
    visual: items.join(' ').trimEnd(),
    choices,
    answer,
    explain: `Touch each one and count out loud, one at a time — there are ${n}!`,
  }
}

// ---------------------------------------------------------------- numbers
const NUMBER_WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen', 'twenty']
const sayNum = (n: number) => (n <= 20 ? NUMBER_WORDS[n] : String(n))

function genNumbers(d: number): Question {
  if (d < 25) {
    const n = ri(0, 9)
    const { choices, answer } = makeChoices(n, numberDistractors(n, 3, 0, 9))
    return {
      skill: 'numbers',
      difficulty: d,
      prompt: `Find the number ${sayNum(n)}`,
      speech: `Find the number ${sayNum(n)}`,
      choices,
      answer,
      explain: `This is what ${sayNum(n)} looks like: ${n}.`,
    }
  }
  if (d < 50) {
    const n = ri(10, 20)
    const { choices, answer } = makeChoices(n, numberDistractors(n, 4, 10, 20))
    return {
      skill: 'numbers',
      difficulty: d,
      prompt: `Find the number ${sayNum(n)}`,
      speech: `Find the number ${sayNum(n)}`,
      choices,
      answer,
      explain: `${sayNum(n)} is written ${n} — a ${Math.floor(n / 10)} and a ${n % 10} together.`,
    }
  }
  if (d < 70) {
    const bigger = Math.random() < 0.5
    const nums = new Set<number>()
    while (nums.size < 3) nums.add(ri(1, 20))
    const arr = Array.from(nums)
    const target = bigger ? Math.max(...arr) : Math.min(...arr)
    const choices = shuffle(arr.map(String))
    return {
      skill: 'numbers',
      difficulty: d,
      prompt: `Which number is the ${bigger ? 'BIGGEST' : 'SMALLEST'}?`,
      speech: `Which number is the ${bigger ? 'biggest' : 'smallest'}?`,
      choices,
      answer: choices.indexOf(String(target)),
      explain: `${target} is the ${bigger ? 'biggest — it means the most' : 'smallest — it means the least'} of ${arr.sort((a, b) => a - b).join(', ')}.`,
    }
  }
  if (d < 85) {
    const after = Math.random() < 0.5
    const n = ri(after ? 1 : 2, 19)
    const correct = after ? n + 1 : n - 1
    const { choices, answer } = makeChoices(correct, numberDistractors(correct, 2, 0, 20))
    return {
      skill: 'numbers',
      difficulty: d,
      prompt: `What comes right ${after ? 'AFTER' : 'BEFORE'} ${n}?`,
      speech: `What number comes right ${after ? 'after' : 'before'} ${sayNum(n)}?`,
      choices,
      answer,
      explain: `Count it out: ${after ? `${n}, then ${correct}` : `${correct}, then ${n}`} — ${correct} comes right ${after ? 'after' : 'before'} ${n}.`,
    }
  }
  const hi = d >= 93 ? 48 : 18
  const n = ri(2, hi)
  const { choices, answer } = makeChoices(n, numberDistractors(n, 2, 0, hi + 2))
  return {
    skill: 'numbers',
    difficulty: d,
    prompt: `What number is between ${n - 1} and ${n + 1}?`,
    speech: `What number is between ${sayNum(n - 1)} and ${sayNum(n + 1)}?`,
    choices,
    answer,
    explain: `Count: ${n - 1}, ${n}, ${n + 1} — so ${n} is in the middle.`,
  }
}

// ---------------------------------------------------------------- addition / math
const countUp = (a: number, b: number) => Array.from({ length: b }, (_, i) => a + i + 1).join(', ')

function genAddition(d: number): Question {
  if (d < 25) {
    const a = ri(1, 3)
    const b = ri(1, Math.min(2, 5 - a))
    const emoji = pick(COUNT_EMOJI)
    const { choices, answer } = makeChoices(a + b, numberDistractors(a + b, 2, 0, 6))
    return {
      skill: 'addition',
      difficulty: d,
      prompt: `${a} + ${b} = ?`,
      speech: `${sayNum(a)} plus ${sayNum(b)} equals what?`,
      visual: `${emoji.repeat(a)}  ➕  ${emoji.repeat(b)}`,
      choices,
      answer,
      explain: `Start at ${a} and count up ${b} more: ${countUp(a, b)} — that makes ${a + b}!`,
    }
  }
  if (d < 45) {
    const a = ri(1, 6)
    const b = ri(1, Math.min(6, 10 - a))
    const { choices, answer } = makeChoices(a + b, numberDistractors(a + b, 2, 0, 12))
    // variation: little word problems
    if (Math.random() < 0.4) {
      const things = pick([
        ['apples', '🍎'], ['toy cars', '🚗'], ['balloons', '🎈'], ['strawberries', '🍓'], ['ducks', '🦆'],
      ] as const)
      return {
        skill: 'addition',
        difficulty: d,
        prompt: `You have ${a} ${things[0]} and get ${b} more. How many now?`,
        speech: `You have ${sayNum(a)} ${things[0]}, and you get ${sayNum(b)} more. How many do you have now?`,
        visual: things[1],
        choices,
        answer,
        explain: `${a} ${things[0]} plus ${b} more: count up ${countUp(a, b)} — ${a + b}!`,
      }
    }
    return {
      skill: 'addition',
      difficulty: d,
      prompt: `${a} + ${b} = ?`,
      speech: `What is ${sayNum(a)} plus ${sayNum(b)}?`,
      choices,
      answer,
      explain: `Start at ${a} and count up ${b} more: ${countUp(a, b)} — that makes ${a + b}!`,
    }
  }
  if (d < 65) {
    const a = ri(2, 10)
    const b = ri(1, a - 1)
    const emoji = pick(COUNT_EMOJI)
    const { choices, answer } = makeChoices(a - b, numberDistractors(a - b, 2, 0, 10))
    return {
      skill: 'addition',
      difficulty: d,
      prompt: `${a} − ${b} = ?`,
      speech: `What is ${sayNum(a)} take away ${sayNum(b)}?`,
      visual: d < 55 ? emoji.repeat(a) : undefined,
      choices,
      answer,
      explain: `Start with ${a}, take ${b} away — count down and ${a - b} are left.`,
    }
  }
  if (d < 85) {
    const add = Math.random() < 0.6
    if (add) {
      const a = ri(5, 12)
      const b = ri(3, Math.min(9, 20 - a))
      const { choices, answer } = makeChoices(a + b, numberDistractors(a + b, 3, 0, 22))
      return {
        skill: 'addition',
        difficulty: d,
        prompt: `${a} + ${b} = ?`,
        speech: `What is ${sayNum(a)} plus ${sayNum(b)}?`,
        choices,
        answer,
        explain: `Start at ${a} and count up ${b} more: ${countUp(a, b)} — ${a + b}!`,
      }
    }
    const a = ri(8, 18)
    const b = ri(2, 7)
    const { choices, answer } = makeChoices(a - b, numberDistractors(a - b, 3, 0, 20))
    return {
      skill: 'addition',
      difficulty: d,
      prompt: `${a} − ${b} = ?`,
      speech: `What is ${sayNum(a)} minus ${sayNum(b)}?`,
      choices,
      answer,
      explain: `Start at ${a} and count down ${b}: you land on ${a - b}.`,
    }
  }
  if (d >= 93) {
    // top of the kid band: two-digit plus one-digit
    const a = ri(21, 89)
    const b = ri(3, 9)
    const { choices, answer } = makeChoices(a + b, numberDistractors(a + b, 4, 0, 99))
    return {
      skill: 'addition',
      difficulty: d,
      prompt: `${a} + ${b} = ?`,
      speech: `What is ${a} plus ${sayNum(b)}?`,
      choices,
      answer,
      explain: `Start at ${a} and count up ${b}: you land on ${a + b}.`,
    }
  }
  // missing addend
  const total = ri(5, 12)
  const a = ri(1, total - 1)
  const missing = total - a
  const { choices, answer } = makeChoices(missing, numberDistractors(missing, 2, 0, 12))
  return {
    skill: 'addition',
    difficulty: d,
    prompt: `${a} + ❓ = ${total}`,
    speech: `${sayNum(a)} plus what makes ${sayNum(total)}?`,
    choices,
    answer,
    explain: `Count up from ${a} to ${total}: ${countUp(a, missing)} — that's ${missing} more.`,
  }
}

// ---------------------------------------------------------------- letters
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'
const TRICKY_LOWER: Record<string, string[]> = { b: ['d', 'p'], d: ['b', 'q'], p: ['q', 'b'], q: ['p', 'g'], m: ['n', 'w'], n: ['m', 'h'], u: ['n', 'v'] }

function letterDistractors(c: string): string[] {
  const out = new Set<string>()
  while (out.size < 4) {
    const l = ALPHABET[ri(0, 25)]
    if (l !== c.toUpperCase()) out.add(l)
  }
  return Array.from(out)
}

function genLetters(d: number): Question {
  if (d < 25) {
    const c = ALPHABET[ri(0, 25)]
    const { choices, answer } = makeChoices(c, letterDistractors(c))
    return {
      skill: 'letters',
      difficulty: d,
      prompt: 'Find the CAPITAL letter:',
      speech: `Find the big capital letter ${c}`,
      choices,
      answer,
      explain: `This is the capital (big) letter ${c}. Capital letters start names — like the M in Marshall!`,
    }
  }
  if (d < 50) {
    const c = ALPHABET[ri(0, 25)].toLowerCase()
    // mix in the capital of the SAME letter so they must spot the case
    const pool = [c.toUpperCase(), ...(TRICKY_LOWER[c] ?? letterDistractors(c).map((l) => l.toLowerCase()))]
    const { choices, answer } = makeChoices(c, pool)
    return {
      skill: 'letters',
      difficulty: d,
      prompt: 'Find the little (lowercase) letter:',
      speech: `Find the little lowercase letter ${c} — not the big one!`,
      choices,
      answer,
      explain: `Little ${c} is the small one. Big ${c.toUpperCase()} and little ${c} are the same letter, just different sizes.`,
    }
  }
  if (d < 75) {
    const c = ALPHABET[ri(0, 25)]
    const { choices, answer } = makeChoices(c.toLowerCase(), letterDistractors(c).map((l) => l.toLowerCase()))
    return {
      skill: 'letters',
      difficulty: d,
      prompt: `Which is the little (lowercase) ${c}?`,
      speech: `Here is a big capital ${c} — which one is its little lowercase partner?`,
      visual: c,
      choices,
      answer,
      explain: `Capital ${c} and little ${c.toLowerCase()} are partners — the same letter in big and small.`,
    }
  }
  // variation at the top: vowels
  if (Math.random() < 0.35) {
    const v = pick(['A', 'E', 'I', 'O', 'U'])
    const { choices, answer } = makeChoices(v, shuffle('BCDFGHJKLMNPQRSTVWXYZ'.split('')).slice(0, 4))
    return {
      skill: 'letters',
      difficulty: d,
      prompt: 'Which one is a VOWEL?',
      speech: 'Which letter is a vowel? A, E, I, O and U are the vowels.',
      choices,
      answer,
      explain: `The vowels are A, E, I, O, U — ${v} is a vowel!`,
    }
  }
  const after = Math.random() < 0.5
  const i = ri(after ? 0 : 1, after ? 24 : 25)
  const c = ALPHABET[i]
  const correct = ALPHABET[after ? i + 1 : i - 1]
  const { choices, answer } = makeChoices(correct, letterDistractors(correct))
  return {
    skill: 'letters',
    difficulty: d,
    prompt: `What letter comes ${after ? 'AFTER' : 'BEFORE'} ${c}?`,
    speech: `In the alphabet, what letter comes right ${after ? 'after' : 'before'} ${c}?`,
    choices,
    answer,
    explain: `Sing it: …${after ? `${c}, ${correct}` : `${correct}, ${c}`}… — ${correct} comes right ${after ? 'after' : 'before'} ${c}.`,
  }
}

// ---------------------------------------------------------------- sounds (phonics)
const PHONICS: Array<{ word: string; emoji: string; first: string; last: string }> = [
  { word: 'sun', emoji: '☀️', first: 'S', last: 'N' },
  { word: 'ball', emoji: '⚽', first: 'B', last: 'L' },
  { word: 'cat', emoji: '🐱', first: 'C', last: 'T' },
  { word: 'dog', emoji: '🐶', first: 'D', last: 'G' },
  { word: 'moon', emoji: '🌙', first: 'M', last: 'N' },
  { word: 'fish', emoji: '🐟', first: 'F', last: 'H' },
  { word: 'apple', emoji: '🍎', first: 'A', last: 'E' },
  { word: 'tree', emoji: '🌳', first: 'T', last: 'E' },
  { word: 'hat', emoji: '🎩', first: 'H', last: 'T' },
  { word: 'pig', emoji: '🐷', first: 'P', last: 'G' },
  { word: 'kite', emoji: '🪁', first: 'K', last: 'E' },
  { word: 'lion', emoji: '🦁', first: 'L', last: 'N' },
  { word: 'goat', emoji: '🐐', first: 'G', last: 'T' },
  { word: 'zebra', emoji: '🦓', first: 'Z', last: 'A' },
  { word: 'egg', emoji: '🥚', first: 'E', last: 'G' },
  { word: 'van', emoji: '🚐', first: 'V', last: 'N' },
  { word: 'rain', emoji: '🌧️', first: 'R', last: 'N' },
  { word: 'wagon', emoji: '🛒', first: 'W', last: 'N' },
  { word: 'octopus', emoji: '🐙', first: 'O', last: 'S' },
  { word: 'ice', emoji: '🧊', first: 'I', last: 'E' },
  { word: 'umbrella', emoji: '☂️', first: 'U', last: 'A' },
  { word: 'yo-yo', emoji: '🪀', first: 'Y', last: 'O' },
  { word: 'queen', emoji: '👑', first: 'Q', last: 'N' },
  { word: 'nest', emoji: '🪺', first: 'N', last: 'T' },
  { word: 'jam', emoji: '🍓', first: 'J', last: 'M' },
  { word: 'xylophone', emoji: '🎵', first: 'X', last: 'E' },
]
const RHYMES: Array<{ target: string; match: string; misses: string[] }> = [
  { target: 'cat', match: 'hat', misses: ['dog', 'sun'] },
  { target: 'ball', match: 'wall', misses: ['tree', 'fish'] },
  { target: 'sun', match: 'run', misses: ['moon', 'hat'] },
  { target: 'pig', match: 'dig', misses: ['cow', 'net'] },
  { target: 'goat', match: 'boat', misses: ['duck', 'ring'] },
  { target: 'moon', match: 'spoon', misses: ['star', 'frog'] },
  { target: 'bug', match: 'rug', misses: ['ant', 'bee'] },
  { target: 'star', match: 'car', misses: ['moon', 'sky'] },
  { target: 'bed', match: 'red', misses: ['blue', 'nap'] },
  { target: 'tree', match: 'bee', misses: ['leaf', 'nut'] },
  { target: 'king', match: 'ring', misses: ['crown', 'hat'] },
  { target: 'mouse', match: 'house', misses: ['cheese', 'trap'] },
]

// consonant blends — Marshall's school reading check asked for "sc"/"sk"
// practice by name (scoot, school, scum, scrape, skill, skip, skin, skid),
// so those words are here verbatim, padded with the other common s-blends
const BLEND_WORDS: Array<{ blend: string; word: string }> = [
  { blend: 'sc', word: 'scoot' }, { blend: 'sc', word: 'school' }, { blend: 'sc', word: 'scum' }, { blend: 'sc', word: 'scrape' },
  { blend: 'sk', word: 'skill' }, { blend: 'sk', word: 'skip' }, { blend: 'sk', word: 'skin' }, { blend: 'sk', word: 'skid' },
  { blend: 'st', word: 'stop' }, { blend: 'st', word: 'star' },
  { blend: 'sl', word: 'slide' }, { blend: 'sl', word: 'sleep' },
  { blend: 'sn', word: 'snack' }, { blend: 'sn', word: 'snow' },
  { blend: 'sp', word: 'spin' }, { blend: 'sp', word: 'spot' },
  { blend: 'sw', word: 'swim' }, { blend: 'sw', word: 'swing' },
]
const BLENDS = ['sc', 'sk', 'st', 'sl', 'sn', 'sp', 'sw']

function genBlend(d: number): Question {
  const w = pick(BLEND_WORDS)
  if (Math.random() < 0.5) {
    // which two letters start the word — the sc/sk confusable is ALWAYS a choice
    const partner = w.blend === 'sc' ? 'sk' : w.blend === 'sk' ? 'sc' : pick(BLENDS.filter((b) => b !== w.blend))
    const third = pick(BLENDS.filter((b) => b !== w.blend && b !== partner))
    const opts = shuffle([w.blend, partner, third])
    return {
      skill: 'sounds',
      difficulty: d,
      prompt: `Which two letters start "${w.word}"?`,
      speech: `${w.word}. Which two letters does ${w.word} start with?`,
      choices: opts,
      answer: opts.indexOf(w.blend),
      explain: `Say it slowly — ${w.blend}, ${w.word}. "${w.word}" starts with ${w.blend.toUpperCase()}.`,
    }
  }
  const others = shuffle(BLEND_WORDS.filter((x) => x.blend !== w.blend)).slice(0, 2)
  const opts = shuffle([w, ...others])
  return {
    skill: 'sounds',
    difficulty: d,
    prompt: `Which word starts with "${w.blend}"?`,
    speech: `Which word starts with the letters ${w.blend.split('').join(', ')}?`,
    choices: opts.map((o) => o.word),
    answer: opts.indexOf(w),
    explain: `"${w.word}" starts with ${w.blend} — ${others.map((o) => `${o.word} starts with ${o.blend}`).join(' and ')}.`,
  }
}

// finish-the-rhyme couplets — the report's cadence & rhyming-poem tip
const POEMS: Array<{ line: string; answer: string; misses: [string, string] }> = [
  { line: 'The frog sat on a log, right next to a sleepy ___', answer: 'dog', misses: ['cat', 'fish'] },
  { line: 'I skip and I hop, then I spin like a ___', answer: 'top', misses: ['ball', 'kite'] },
  { line: 'The star shines so bright, all through the ___', answer: 'night', misses: ['day', 'rain'] },
  { line: 'The goat in the boat began to ___', answer: 'float', misses: ['sink', 'run'] },
  { line: 'The snail on the trail picked up the ___', answer: 'mail', misses: ['leaf', 'rock'] },
  { line: 'The bear on the chair had leaves in his ___', answer: 'hair', misses: ['paws', 'hat'] },
  { line: 'The whale with the tail blew wind in the ___', answer: 'sail', misses: ['water', 'sky'] },
  { line: 'The pig in a wig did a silly little ___', answer: 'jig', misses: ['nap', 'song'] },
]

function genPoem(d: number): Question {
  const p = pick(POEMS)
  const opts = shuffle([p.answer, ...p.misses])
  return {
    skill: 'sounds',
    difficulty: d,
    prompt: `Finish the rhyme: "${p.line}"`,
    speech: `Finish the rhyme! ${p.line.replace('___', 'what?')}`,
    choices: opts,
    answer: opts.indexOf(p.answer),
    explain: `"${p.answer}" keeps the rhyme going — read the line out loud and hear how it bounces!`,
  }
}

function genSounds(d: number): Question {
  if (d < 40) {
    const w = pick(PHONICS)
    const { choices, answer } = makeChoices(w.first, letterDistractors(w.first))
    return {
      skill: 'sounds',
      difficulty: d,
      prompt: `What letter does "${w.word}" start with?`,
      speech: `${w.word}. What letter does ${w.word} start with?`,
      visual: w.emoji,
      choices,
      answer,
      explain: `Say it slowly: ${w.first}-${w.first}-${w.word}. Hear it? ${w.word} starts with ${w.first}.`,
    }
  }
  if (d < 70) {
    const w = pick(PHONICS)
    const others = shuffle(PHONICS.filter((p) => p.first !== w.first)).slice(0, 2)
    const opts = shuffle([w, ...others])
    return {
      skill: 'sounds',
      difficulty: d,
      prompt: `Which one starts with the letter ${w.first}?`,
      speech: `Which picture starts with the letter ${w.first}?`,
      choices: opts.map((o) => `${o.emoji} ${o.word}`),
      answer: opts.indexOf(w),
      explain: `${w.word} starts with ${w.first} — say it slowly: ${w.first}-${w.first}-${w.word}.`,
    }
  }
  if (d < 78) {
    const r = pick(RHYMES)
    const opts = shuffle([r.match, ...r.misses])
    return {
      skill: 'sounds',
      difficulty: d,
      prompt: `Which word rhymes with "${r.target}"?`,
      speech: `Which word rhymes with ${r.target}?`,
      choices: opts,
      answer: opts.indexOf(r.match),
      explain: `${r.target} and ${r.match} rhyme — their endings sound the same. ${r.target}… ${r.match}!`,
    }
  }
  // top band: blends, finish-the-rhyme poems, and ending sounds
  const roll = Math.random()
  if (d >= 86 && roll < 0.35) return genPoem(d)
  if (roll < 0.7) return genBlend(d)
  const w = pick(PHONICS)
  const { choices, answer } = makeChoices(w.last, letterDistractors(w.last))
  return {
    skill: 'sounds',
    difficulty: d,
    prompt: `What letter does "${w.word}" END with?`,
    speech: `${w.word}. What letter is at the end of ${w.word}?`,
    visual: w.emoji,
    choices,
    answer,
    explain: `Say ${w.word} slowly and listen to the very end: it finishes with ${w.last}.`,
  }
}

// ---------------------------------------------------------------- shapes & patterns
const SHAPES = [
  { name: 'circle', emoji: '🟢', sides: 0 },
  { name: 'square', emoji: '🟦', sides: 4 },
  { name: 'triangle', emoji: '🔺', sides: 3 },
  { name: 'diamond', emoji: '🔷', sides: 4 },
  { name: 'star', emoji: '⭐', sides: 10 },
  { name: 'heart', emoji: '❤️', sides: 0 },
] as const
const COLOR_SHAPES = [
  { name: 'red heart', emoji: '❤️' },
  { name: 'blue square', emoji: '🟦' },
  { name: 'green circle', emoji: '🟢' },
  { name: 'orange circle', emoji: '🟠' },
  { name: 'purple heart', emoji: '💜' },
  { name: 'yellow star', emoji: '⭐' },
] as const

function genShapes(d: number): Question {
  // variation: odd one out (same shape in two colors + one different shape)
  if (d < 55 && Math.random() < 0.3) {
    const families = [
      { name: 'circle', members: ['🟢', '🔵', '🟠', '🟣'] },
      { name: 'square', members: ['🟦', '🟥', '🟨'] },
      { name: 'heart', members: ['❤️', '💜', '💙'] },
    ]
    const fam = pick(families)
    const other = pick(families.filter((f) => f.name !== fam.name))
    const pair = shuffle([...fam.members]).slice(0, 2)
    const odd = pick(other.members)
    const opts = shuffle([...pair, odd])
    return {
      skill: 'shapes',
      difficulty: d,
      prompt: 'Which one is a DIFFERENT shape?',
      speech: 'One of these is a different shape. Which one?',
      choices: opts,
      answer: opts.indexOf(odd),
      explain: `Two are ${fam.name}s (colors don't matter) — the ${other.name} is the different shape!`,
    }
  }
  if (d < 30) {
    const s = pick(SHAPES)
    const others = shuffle(SHAPES.filter((x) => x.name !== s.name)).slice(0, 2)
    const opts = shuffle([s, ...others])
    return {
      skill: 'shapes',
      difficulty: d,
      prompt: `Find the ${s.name}`,
      speech: `Find the ${s.name}`,
      choices: opts.map((o) => o.emoji),
      answer: opts.indexOf(s),
      explain: `${s.emoji} is the ${s.name}${s.sides >= 3 && s.sides <= 4 ? ` — it has ${s.sides} sides` : ''}.`,
    }
  }
  if (d < 55) {
    const s = pick(COLOR_SHAPES)
    const others = shuffle(COLOR_SHAPES.filter((x) => x.name !== s.name)).slice(0, 2)
    const opts = shuffle([s, ...others])
    return {
      skill: 'shapes',
      difficulty: d,
      prompt: `Find the ${s.name}`,
      speech: `Find the ${s.name}`,
      choices: opts.map((o) => o.emoji),
      answer: opts.indexOf(s),
      explain: `${s.emoji} is the ${s.name} — check both the color AND the shape.`,
    }
  }
  if (d < 80) {
    // AB pattern
    const [a, b] = shuffle([...SHAPES]).slice(0, 2)
    const seq = [a, b, a, b, a]
    const opts = shuffle([b, a, pick(SHAPES.filter((x) => x !== a && x !== b))])
    return {
      skill: 'shapes',
      difficulty: d,
      prompt: 'What comes next in the pattern?',
      speech: 'Look at the pattern. What comes next?',
      visual: seq.map((s) => s.emoji).join(' ') + ' ❓',
      choices: opts.map((o) => o.emoji),
      answer: opts.indexOf(b),
      explain: `The pattern takes turns: ${a.name}, ${b.name}, ${a.name}, ${b.name}… so after ${a.name} comes ${b.name}!`,
    }
  }
  if (Math.random() < 0.5) {
    // AAB pattern
    const [a, b] = shuffle([...SHAPES]).slice(0, 2)
    const seq = [a, a, b, a, a]
    const opts = shuffle([b, a, pick(SHAPES.filter((x) => x !== a && x !== b))])
    return {
      skill: 'shapes',
      difficulty: d,
      prompt: 'What comes next in the pattern?',
      speech: 'Look closely at the pattern. What comes next?',
      visual: seq.map((s) => s.emoji).join(' ') + ' ❓',
      choices: opts.map((o) => o.emoji),
      answer: opts.indexOf(b),
      explain: `This pattern goes two-then-one: ${a.name}, ${a.name}, ${b.name} — so after two ${a.name}s comes the ${b.name}.`,
    }
  }
  const withSides = SHAPES.filter((s) => s.sides === 3 || s.sides === 4)
  const s = pick(withSides)
  const others = shuffle(SHAPES.filter((x) => x.sides !== s.sides)).slice(0, 2)
  const opts = shuffle([s, ...others])
  return {
    skill: 'shapes',
    difficulty: d,
    prompt: `Which shape has ${s.sides} sides?`,
    speech: `Which shape has ${sayNum(s.sides)} sides?`,
    choices: opts.map((o) => `${o.emoji} ${o.name}`),
    answer: opts.indexOf(s),
    explain: `A ${s.name} has ${s.sides} straight sides — try counting them with your finger!`,
  }
}

// ---------------------------------------------------------------- sight words / first reading
const SIGHT_1 = ['a', 'I', 'the', 'to', 'and', 'go', 'we', 'my', 'see', 'in', 'it', 'up', 'me', 'at', 'am', 'is', 'can', 'you']
const SIGHT_2 = ['he', 'she', 'was', 'are', 'they', 'said', 'have', 'like', 'this', 'for', 'play', 'with', 'went', 'her', 'him', 'get', 'not', 'all']
const SIGHT_3 = ['what', 'when', 'out', 'some', 'come', 'here', 'want', 'good', 'little', 'down', 'look', 'jump', 'where', 'there', 'because', 'again', 'every', 'about']
const SIGHT_4 = ['before', 'together', 'around', 'another', 'thought', 'should', 'right', 'their', 'would', 'which', 'found', 'always', 'both', 'does', 'pretty', 'under', 'very', 'enough']
const CVC: Array<{ word: string; emoji: string; misses: string[] }> = [
  { word: 'cat', emoji: '🐱', misses: ['cot', 'cut'] },
  { word: 'dog', emoji: '🐶', misses: ['dig', 'dug'] },
  { word: 'sun', emoji: '☀️', misses: ['son', 'sin'] },
  { word: 'bug', emoji: '🐞', misses: ['big', 'bag'] },
  { word: 'hat', emoji: '🎩', misses: ['hot', 'hit'] },
  { word: 'pig', emoji: '🐷', misses: ['peg', 'pug'] },
  { word: 'bus', emoji: '🚌', misses: ['bas', 'bos'] },
  { word: 'map', emoji: '🗺️', misses: ['mop', 'mup'] },
  { word: 'bed', emoji: '🛏️', misses: ['bad', 'bud'] },
  { word: 'fox', emoji: '🦊', misses: ['fix', 'fax'] },
  { word: 'web', emoji: '🕸️', misses: ['wab', 'wib'] },
  { word: 'cup', emoji: '☕', misses: ['cap', 'cop'] },
  { word: 'frog', emoji: '🐸', misses: ['flog', 'frag'] },
  { word: 'crab', emoji: '🦀', misses: ['crib', 'crob'] },
  { word: 'star', emoji: '⭐', misses: ['stir', 'stor'] },
]

const spellOut = (w: string) => w.toUpperCase().split('').join('-')

// blend-word spelling reads: the right spelling vs its sc/sk (and similar)
// confusions — the exact practice Marshall's reading check asked for
const BLEND_READ: Array<{ word: string; emoji: string; misses: [string, string] }> = [
  { word: 'school', emoji: '🏫', misses: ['skool', 'shcool'] },
  { word: 'scoot', emoji: '🛴', misses: ['skoot', 'soot'] },
  { word: 'skip', emoji: '🤸', misses: ['scip', 'skep'] },
  { word: 'skid', emoji: '🛞', misses: ['scid', 'sked'] },
  { word: 'skin', emoji: '🖐️', misses: ['scin', 'sken'] },
  { word: 'skill', emoji: '🎯', misses: ['scill', 'skil'] },
  { word: 'scrape', emoji: '🩹', misses: ['skrape', 'scape'] },
  { word: 'snake', emoji: '🐍', misses: ['snack', 'sneak'] },
  { word: 'swing', emoji: '🛝', misses: ['sweng', 'sving'] },
  { word: 'storm', emoji: '⛈️', misses: ['strom', 'storn'] },
]

// story settings — the report's tip #1: name WHERE and WHEN a story happens
const STORY_SETTINGS: Array<{ story: string; ask: 'where' | 'when'; answer: string; misses: [string, string]; clue: string }> = [
  { story: 'Sam built a sandcastle while seagulls flew over the waves.', ask: 'where', answer: 'at the beach', misses: ['in the woods', 'at school'], clue: 'sandcastle, seagulls and waves' },
  { story: 'Mia zipped her coat as snowflakes landed on her sled.', ask: 'when', answer: 'in winter', misses: ['in summer', 'in spring'], clue: 'snowflakes and a sled' },
  { story: 'The owls hooted and the stars came out while Max brushed his teeth.', ask: 'when', answer: 'at night', misses: ['in the morning', 'at lunch'], clue: 'owls and stars' },
  { story: 'Leo picked a pumpkin and crunched through the fallen leaves.', ask: 'when', answer: 'in the fall', misses: ['in winter', 'in spring'], clue: 'pumpkins and fallen leaves' },
  { story: 'Ava fed the goats and gathered warm eggs from the hens.', ask: 'where', answer: 'on a farm', misses: ['at the mall', 'on the moon'], clue: 'goats and hens' },
  { story: 'Ben floated past clownfish and waved at a sea turtle.', ask: 'where', answer: 'under the sea', misses: ['in the desert', 'on a mountain'], clue: 'clownfish and a sea turtle' },
  { story: 'The campers roasted marshmallows while crickets chirped in the dark trees.', ask: 'where', answer: 'at a campsite', misses: ['at the library', 'in a pool'], clue: 'a campfire and crickets' },
  { story: 'Everyone went quiet as the lights dimmed and the curtain rose.', ask: 'where', answer: 'at a show', misses: ['on a bus', 'at the dentist'], clue: 'dimming lights and a curtain' },
  { story: 'Jack yawned, poured milk on his cereal, and watched the sun come up.', ask: 'when', answer: 'in the morning', misses: ['at midnight', 'at dinner'], clue: 'cereal and the sunrise' },
  { story: 'The astronauts bounced slowly past their flag in the gray dust.', ask: 'where', answer: 'on the moon', misses: ['at the beach', 'in a cave'], clue: 'astronauts bouncing in gray dust' },
  { story: 'Rosa hung her backpack on its hook and sat criss-cross on the rug for circle time.', ask: 'where', answer: 'at school', misses: ['at home', 'at the zoo'], clue: 'a backpack hook and circle time' },
  { story: 'The fireflies blinked over the yard as Dad lit the grill for burgers.', ask: 'when', answer: 'on a summer evening', misses: ['on a snowy day', 'early in the morning'], clue: 'fireflies and grilling' },
]

function genSetting(d: number): Question {
  const s = pick(STORY_SETTINGS)
  const opts = shuffle([s.answer, ...s.misses])
  const askLine = s.ask === 'where' ? 'WHERE does this story happen?' : 'WHEN does this story happen?'
  return {
    skill: 'words',
    difficulty: d,
    prompt: `${s.story} — ${askLine}`,
    speech: `Listen to this little story. ${s.story} ${s.ask === 'where' ? 'Where does this story happen?' : 'When does this story happen?'}`,
    choices: opts,
    answer: opts.indexOf(s.answer),
    explain: `The setting is where and when a story happens. The clues — ${s.clue} — tell you it happens ${s.answer}.`,
  }
}

function genBlendRead(d: number): Question {
  const c = pick(BLEND_READ)
  const opts = shuffle([c.word, ...c.misses])
  return {
    skill: 'words',
    difficulty: d,
    prompt: 'Which word is spelled right?',
    speech: `Which one spells ${c.word}?`,
    visual: c.emoji,
    choices: opts,
    answer: opts.indexOf(c.word),
    explain: `${spellOut(c.word)} spells "${c.word}" — watch the first two letters, they do the tricky work!`,
  }
}

function genWords(d: number): Question {
  if (d < 70) {
    const list = d < 28 ? SIGHT_1 : d < 46 ? SIGHT_2 : d < 60 ? SIGHT_3 : SIGHT_4
    const w = pick(list)
    const { choices, answer } = makeChoices(w, list.filter((x) => x !== w))
    return {
      skill: 'words',
      difficulty: d,
      prompt: `Find the word "${w}"`,
      speech: `Find the word: ${w}`,
      choices,
      answer,
      explain: `${spellOut(w)} spells "${w}" — it's a super-common word, you'll see it everywhere!`,
    }
  }
  // top bands for strong readers: blend spellings, then story settings
  if (d >= 90) return Math.random() < 0.6 ? genSetting(d) : genBlendRead(d)
  if (d >= 80) return Math.random() < 0.6 ? genBlendRead(d) : genCvcRead(d)
  return genCvcRead(d)
}

function genCvcRead(d: number): Question {
  const c = pick(CVC)
  const opts = shuffle([c.word, ...c.misses])
  return {
    skill: 'words',
    difficulty: d,
    prompt: 'Which word matches the picture?',
    speech: `Which word says ${c.word}?`,
    visual: c.emoji,
    choices: opts,
    answer: opts.indexOf(c.word),
    explain: `Sound it out: ${spellOut(c.word)} — "${c.word}"! The middle letter makes all the difference.`,
  }
}

// ---------------------------------------------------------------- science
// How the world works (Brian, Nov 2: "Make sure we have latest physics,
// quantum, ai, biology, medicine… I want my boys prepared for the world of
// the singularity that is coming"). Banded from age-4 senses-and-animals up
// to a kid-honest frontier: atoms, DNA, vaccines, AI that learns from
// examples, qubits that can be two ways at once. Every fact is real; the
// words are small.
const SCIENCE: Array<{ t: 1 | 2 | 3 | 4 | 5; q: string; a: string; m: [string, string]; why: string; pic?: string }> = [
  // t1 — senses, animals, weather (~age 4)
  { t: 1, q: 'What do you SEE with?', a: 'eyes', m: ['ears', 'feet'], why: 'Your eyes catch light and send pictures to your brain.', pic: '👀' },
  { t: 1, q: 'What do you HEAR with?', a: 'ears', m: ['nose', 'hands'], why: 'Your ears catch sounds — even tiny quiet ones.', pic: '👂' },
  { t: 1, q: 'Which one is ALIVE?', a: 'puppy', m: ['rock', 'truck'], why: 'Living things grow, eat and move on their own — a puppy does all three!', pic: '🐶' },
  { t: 1, q: 'Where does rain fall from?', a: 'clouds', m: ['trees', 'roads'], why: 'Clouds are made of tiny water drops — when they get heavy, down comes the rain.', pic: '🌧️' },
  { t: 1, q: 'Which animal has feathers?', a: 'bird', m: ['dog', 'fish'], why: 'Birds are the only animals with feathers — they help them fly and stay warm.', pic: '🐦' },
  { t: 1, q: 'What melts in the warm sun?', a: 'ice', m: ['rocks', 'spoons'], why: 'Warm sunshine turns ice back into water — that’s melting.', pic: '🧊' },
  { t: 1, q: 'What lights up the sky at NIGHT?', a: 'the Moon', m: ['the Sun', 'a lamp'], why: 'The Moon shines at night — the Sun lights up the day.', pic: '🌙' },
  { t: 1, q: 'What do plants grow from?', a: 'seeds', m: ['rocks', 'candy'], why: 'A tiny seed holds a whole baby plant inside, waiting for water and sun.', pic: '🌱' },
  { t: 1, q: 'Which one is HOT?', a: 'fire', m: ['ice', 'snow'], why: 'Fire is hot — never touch! Ice and snow are cold.', pic: '🔥' },
  { t: 1, q: 'What do cows give us?', a: 'milk', m: ['eggs', 'honey'], why: 'Cows make milk — hens lay the eggs and bees make the honey.', pic: '🐄' },
  { t: 1, q: 'Which one flies in the sky?', a: 'an airplane', m: ['a boat', 'a train'], why: 'Airplanes fly — boats float on water and trains stay on their tracks.', pic: '✈️' },
  { t: 1, q: 'What do you feel on a windy day?', a: 'air moving', m: ['the ground moving', 'rocks moving'], why: 'Wind is just air in a hurry!', pic: '💨' },
  // t2 — nature + first physics
  { t: 2, q: 'What do plants need to grow?', a: 'sun and water', m: ['candy and toys', 'blankets and shoes'], why: 'Plants drink water and use sunlight to make their own food.', pic: '🌻' },
  { t: 2, q: 'A magnet sticks to things made of…', a: 'metal', m: ['wood', 'paper'], why: 'Magnets pull on metal like steel — wood and paper don’t feel the pull at all.', pic: '🧲' },
  { t: 2, q: 'When ice warms up, it turns into…', a: 'water', m: ['smoke', 'sand'], why: 'Ice is frozen water — warm it up and it melts right back.', pic: '💧' },
  { t: 2, q: 'Why is the daytime bright?', a: 'the Sun', m: ['the Moon', 'flashlights'], why: 'Our Sun lights up the whole daytime sky.', pic: '☀️' },
  { t: 2, q: 'Which one SINKS in water?', a: 'a rock', m: ['a leaf', 'a beach ball'], why: 'Heavy-for-its-size things sink; light ones like leaves and beach balls float.', pic: '🪨' },
  { t: 2, q: 'A baby frog is called a…', a: 'tadpole', m: ['puppy', 'cub'], why: 'Tadpoles hatch in the water with tails — then they grow legs and become frogs!', pic: '🐸' },
  { t: 2, q: 'How many legs does a spider have?', a: '8', m: ['4', '100'], why: 'Spiders have 8 legs — insects like ants have 6. Count next time!', pic: '🕷️' },
  { t: 2, q: 'What covers MOST of planet Earth?', a: 'water', m: ['sand', 'grass'], why: 'Oceans cover most of the Earth — that’s why it looks blue from space.', pic: '🌍' },
  { t: 2, q: 'What comes right before thunder?', a: 'lightning', m: ['rainbows', 'snow'], why: 'Lightning makes the thunder — you see the flash first, then hear the boom.', pic: '⚡' },
  { t: 2, q: 'What do bees make?', a: 'honey', m: ['milk', 'cheese'], why: 'Bees collect nectar from flowers and turn it into honey in their hive.', pic: '🐝' },
  { t: 2, q: 'What makes a kite fly?', a: 'the wind', m: ['magic', 'music'], why: 'Moving air pushes the kite up — no wind, no kite!', pic: '🪁' },
  { t: 2, q: 'What makes a flashlight turn on?', a: 'batteries', m: ['water', 'sand'], why: 'Batteries store electricity and feed it to the little bulb.', pic: '🔦' },
  { t: 2, q: 'Lightning is a giant spark of…', a: 'electricity', m: ['water', 'glitter'], why: 'Lightning is electricity jumping from the clouds — the biggest spark there is!', pic: '⚡' },
  { t: 2, q: 'Storm clouds look…', a: 'tall and dark', m: ['thin and wispy', 'pink and tiny'], why: 'Big tall dark clouds mean a thunderstorm is building — time to head inside.', pic: '⛈️' },
  // t3 — the body, space, germs
  { t: 3, q: 'Which part of you pumps blood?', a: 'heart', m: ['brain', 'tummy'], why: 'Your heart is a pump — it pushes blood all around your body, every second.', pic: '❤️' },
  { t: 3, q: 'What do you breathe with?', a: 'lungs', m: ['heart', 'bones'], why: 'Your lungs fill with air like balloons and take the oxygen your body needs.', pic: '🫁' },
  { t: 3, q: 'What thinks and tells your body what to do?', a: 'brain', m: ['knees', 'hair'], why: 'Your brain is the boss — it thinks, remembers and runs your whole body.', pic: '🧠' },
  { t: 3, q: 'The Earth goes around the…', a: 'Sun', m: ['Moon', 'clouds'], why: 'Earth circles the Sun once a year — that trip is what a YEAR is!', pic: '☀️' },
  { t: 3, q: 'Why do we wash our hands?', a: 'to wash away germs', m: ['to get taller', 'to stay sleepy'], why: 'Germs are too tiny to see, but soap and water wash them away so you stay healthy.', pic: '🧼' },
  { t: 3, q: 'When water gets really hot, it becomes…', a: 'steam', m: ['ice', 'mud'], why: 'Boiling water turns into steam — the same water, floating as a gas!', pic: '♨️' },
  { t: 3, q: 'What goes around the Earth?', a: 'the Moon', m: ['the Sun', 'the stars'], why: 'The Moon circles the Earth about once a month — that’s why it changes shape in the sky.', pic: '🌙' },
  { t: 3, q: 'What holds your body up from the inside?', a: 'bones', m: ['water', 'air'], why: 'Your bones make a skeleton — a strong frame your muscles pull on.', pic: '🦴' },
  { t: 3, q: 'A caterpillar grows up to become a…', a: 'butterfly', m: ['bird', 'worm'], why: 'It wraps up in a chrysalis and transforms — that’s called metamorphosis!', pic: '🦋' },
  { t: 3, q: 'How do plants make their food?', a: 'from sunlight', m: ['from candy', 'from dirt only'], why: 'Leaves catch sunlight and use it to make food — no kitchen needed.', pic: '🍃' },
  { t: 3, q: 'Which is faster — light or sound?', a: 'light', m: ['sound', 'they tie'], why: 'Light wins every race — that’s why you SEE lightning before you HEAR the thunder.', pic: '⚡' },
  { t: 3, q: 'Doctors give you a shot called a vaccine to…', a: 'help you fight germs', m: ['make you sleepy', 'make you taller'], why: 'A vaccine shows your body a practice germ so it learns to win the real fight.', pic: '💉' },
  { t: 3, q: 'What part of a plane lifts it into the sky?', a: 'the wings', m: ['the wheels', 'the seats'], why: 'Air rushing over the wings pulls the plane UP — pilots call that lift.', pic: '✈️' },
  { t: 3, q: 'What spins to pull a small plane forward?', a: 'the propeller', m: ['the wings', 'the tail'], why: 'The propeller is a spinning fan that pulls the plane through the air — that pull is called thrust.', pic: '🛩️' },
  { t: 3, q: 'Electricity travels through wires in a loop called a…', a: 'circuit', m: ['circle dance', 'tunnel'], why: 'A circuit is the loop electricity runs around — break the loop and the light goes out.', pic: '🔌' },
  { t: 3, q: 'What does a light switch really do?', a: 'opens or closes the loop', m: ['makes new power', 'cools the room'], why: 'The switch connects or breaks the circuit — that’s the whole trick of on and off.', pic: '💡' },
  { t: 3, q: 'Where does wind come from?', a: 'warm and cool air swap', m: ['trees waving', 'cars driving'], why: 'The sun heats some air more than other air, and the moving swap is wind. Trees don’t make wind — wind moves the trees!', pic: '💨' },
  // t4 — atoms, DNA, AI, planets
  { t: 4, q: 'EVERYTHING is made of tiny pieces called…', a: 'atoms', m: ['crumbs', 'pixels'], why: 'Atoms are so small you can’t see them — but rocks, water, air and YOU are all made of them.', pic: '⚛️' },
  { t: 4, q: 'The instruction book inside your body is called…', a: 'DNA', m: ['WiFi', 'ABC'], why: 'DNA is a tiny code in every cell that says how to build YOU — eye color and all.', pic: '🧬' },
  { t: 4, q: 'Your body is built from trillions of tiny…', a: 'cells', m: ['bricks', 'buttons'], why: 'Cells are the tiny living blocks your whole body is made of.', pic: '🔬' },
  { t: 4, q: 'A robot’s "brain" is a…', a: 'computer', m: ['sandwich', 'balloon'], why: 'Robots follow instructions from a computer — people write and train those instructions.', pic: '🤖' },
  { t: 4, q: 'AI gets smart by studying lots of…', a: 'examples', m: ['naps', 'snacks'], why: 'AI learns from millions of examples — like you learning words by hearing them again and again.', pic: '🤖' },
  { t: 4, q: 'Gravity pulls everything…', a: 'down', m: ['up', 'sideways'], why: 'Gravity is the Earth pulling on you — it’s why dropped things always fall DOWN.', pic: '🍎' },
  { t: 4, q: 'The Sun is really a giant…', a: 'star', m: ['lamp', 'planet'], why: 'Our Sun is a star — it just looks huge because it’s the closest one.', pic: '☀️' },
  { t: 4, q: 'Messages zip around your brain through tiny cells called…', a: 'neurons', m: ['balloons', 'pebbles'], why: 'Billions of neurons pass messages at lightning speed — that’s thinking!', pic: '🧠' },
  { t: 4, q: 'Which planet is called the Red Planet?', a: 'Mars', m: ['Earth', 'Jupiter'], why: 'Mars looks red because its dirt is rusty — robots are driving around on it right now!', pic: '🔴' },
  { t: 4, q: 'Doctors see your bones with a special picture called…', a: 'an X-ray', m: ['a selfie', 'a painting'], why: 'X-rays pass through skin but not bone, so the picture shows your skeleton.', pic: '🩻' },
  { t: 4, q: 'Germs that make you sick are fought off by your…', a: 'immune system', m: ['shoes', 'hair'], why: 'Your immune system is your body’s army — it remembers germs and beats them faster next time.', pic: '🛡️' },
  { t: 4, q: 'What does a scientist do FIRST?', a: 'ask a question', m: ['give up', 'say it’s magic'], why: 'Science starts with a question, then a guess, then a TEST to see if the guess was right.', pic: '🔬' },
  { t: 4, q: 'The four forces on an airplane are lift, weight, thrust and…', a: 'drag', m: ['sparkle', 'bounce'], why: 'Drag is the air pushing back. Lift fights weight, thrust fights drag — balance them and you FLY.', pic: '✈️' },
  { t: 4, q: 'A pilot reads the altimeter to know the plane’s…', a: 'height', m: ['snacks', 'song'], why: 'The altimeter feels the air pressure to show how high the plane is flying.', pic: '🛩️' },
  { t: 4, q: 'Before every flight, a pilot ALWAYS checks the…', a: 'weather', m: ['movie times', 'snack bar'], why: 'Pilots study the wind and clouds before takeoff — the weather decides if it’s a good day to fly.', pic: '🧑‍✈️' },
  { t: 4, q: 'Rubbing a balloon on your hair makes…', a: 'static electricity', m: ['heat rays', 'glue'], why: 'Tiny electrons hop onto the balloon and make it cling — that little zap is static electricity.', pic: '🎈' },
  { t: 4, q: 'A thunderstorm is coming — the safest place is…', a: 'inside a building', m: ['under a tall tree', 'in the pool'], why: 'Lightning loves tall trees and water. Get inside and count the thunder until it passes.', pic: '⛈️' },
  // t5 — the frontier, kid-honest (quantum, AI, medicine, space)
  { t: 5, q: 'A quantum computer uses tiny things that can be two ways AT ONCE, called…', a: 'qubits', m: ['pixels', 'legos'], why: 'A normal computer bit is 1 OR 0. A qubit can be kind of BOTH until you look — that’s quantum!', pic: '⚛️' },
  { t: 5, q: 'Light acts like a wave AND a tiny…', a: 'particle', m: ['puddle', 'pancake'], why: 'Light is both at once — scientists call the particles photons. The tiny world plays by strange rules!', pic: '💡' },
  { t: 5, q: 'Scientists can fix broken DNA with an editing tool called…', a: 'CRISPR', m: ['scissors app', 'glue gun'], why: 'CRISPR works like find-and-replace for DNA — doctors already use it to fix some sicknesses.', pic: '🧬' },
  { t: 5, q: 'Medicine called antibiotics kills…', a: 'bacteria', m: ['viruses', 'robots'], why: 'Antibiotics only beat bacteria. Colds come from viruses, so rest and your immune system do that job.', pic: '💊' },
  { t: 5, q: 'On the Moon you could jump super high because gravity there is…', a: 'weaker', m: ['stronger', 'sideways'], why: 'The Moon is smaller than Earth, so it pulls less — astronauts bounce like kangaroos!', pic: '🌙' },
  { t: 5, q: 'The fastest thing in the whole universe is…', a: 'light', m: ['a rocket', 'a cheetah'], why: 'Nothing beats light — it could zoom around the Earth 7 times in ONE second.', pic: '🚀' },
  { t: 5, q: 'What sits in the middle of every atom?', a: 'the nucleus', m: ['a seed', 'air'], why: 'The nucleus is the atom’s tiny center, with electrons buzzing around it.', pic: '⚛️' },
  { t: 5, q: 'A computer that chats and writes learned how by reading tons of…', a: 'words and books', m: ['minds', 'fortune cookies'], why: 'Chatbot AIs studied mountains of writing to learn how words fit together. Smart helpers — but YOU still check their answers!', pic: '🤖' },
  { t: 5, q: 'The Sun makes its energy by squishing tiny atoms together — that’s called…', a: 'fusion', m: ['frying', 'mixing'], why: 'Fusion smashes hydrogen atoms into helium and lets out huge energy — scientists are building fusion machines on Earth too.', pic: '☀️' },
  { t: 5, q: 'Some vaccines now work by giving your cells a RECIPE to practice with, written in…', a: 'mRNA', m: ['crayon', 'binary'], why: 'mRNA is a tiny recipe card — your cells make one harmless germ piece, and your immune system trains on it.', pic: '💉' },
  { t: 5, q: 'Starlight from far away takes YEARS to reach us — so looking up is looking…', a: 'back in time', m: ['underwater', 'into mirrors'], why: 'Some stars you see tonight sent that light before you were born. Telescopes are time machines!', pic: '🌟' },
  { t: 5, q: 'When an AI practices something over and over to get better, that’s called…', a: 'training', m: ['napping', 'downloading luck'], why: 'AI gets good the same way you do — practice, mistakes, and trying again. We don’t say can’t!', pic: '🤖' },
  { t: 5, q: 'A wing makes lift by…', a: 'pushing air down', m: ['getting hot', 'flapping hard'], why: 'The wing bends the air downward, and the air pushes the wing up — Newton’s law, in the sky!', pic: '✈️' },
  { t: 5, q: 'Point the nose up TOO steeply and the air lets go of the wing — that’s a…', a: 'stall', m: ['turbo', 'bounce'], why: 'Tilt the wing too far and the smooth air peels away. Pilots lower the nose to catch the air again.', pic: '🛩️' },
  { t: 5, q: 'Planes take off INTO the wind because it…', a: 'gives extra lift', m: ['smells better', 'is quieter'], why: 'A headwind means more air flowing over the wings — the plane can lift off sooner and slower.', pic: '🛫' },
  { t: 5, q: 'Runway numbers like 22 tell pilots…', a: 'which way it points', m: ['how long it is', 'its price'], why: 'Runway 22 points about 220 degrees on the compass — pilots line it up with the wind.', pic: '🛫' },
  { t: 5, q: 'Volts are the PUSH of electricity — the flow is measured in…', a: 'amps', m: ['pounds', 'miles'], why: 'Volts push, amps flow — like water pressure and how much water is moving in the hose.', pic: '🔋' },
  { t: 5, q: 'Warm wet air crashing into cold air can build a…', a: 'thunderstorm', m: ['rainbow only', 'sandstorm'], why: 'The warm air rockets up over the cold and stacks those giant storm clouds miles high.', pic: '⛈️' },
]

function genScience(d: number): Question {
  const t = d < 25 ? 1 : d < 50 ? 2 : d < 75 ? 3 : d < 90 ? 4 : 5
  const f = pick(SCIENCE.filter((x) => x.t === t))
  const opts = shuffle([f.a, ...f.m])
  return {
    skill: 'science',
    difficulty: d,
    prompt: f.q,
    speech: f.q,
    visual: f.pic,
    choices: opts,
    answer: opts.indexOf(f.a),
    explain: f.why,
  }
}

// ================================================================ ADULT BANK
// Genuinely hard content for the grown-up tester profiles — same skill ids,
// entirely different generators: mental math, sequences, number sense,
// vocabulary, analogies, logic patterns, and spelling.

// ---- counting → number sequences
function genAdultSequences(d: number): Question {
  if (d < 40) {
    const step = ri(3, 9)
    const start = ri(4, 30)
    const seq = [start, start + step, start + step * 2, start + step * 3]
    const next = start + step * 4
    const { choices, answer } = makeChoices(next, numberDistractors(next, step, 1, 200))
    return {
      skill: 'counting', difficulty: d,
      prompt: `What comes next? ${seq.join(', ')}, …`,
      speech: 'What number comes next in the sequence?',
      choices, answer,
      explain: `The sequence adds ${step} each time: ${seq[3]} + ${step} = ${next}.`,
    }
  }
  if (d < 65) {
    const mult = pick([2, 3] as const)
    const start = ri(2, 5)
    const seq = [start, start * mult, start * mult ** 2]
    const next = start * mult ** 3
    const { choices, answer } = makeChoices(next, [next + start, next - start * 2, Math.round(next * 1.5), next + mult])
    return {
      skill: 'counting', difficulty: d,
      prompt: `What comes next? ${seq.join(', ')}, …`,
      speech: 'What number comes next in the sequence?',
      choices, answer,
      explain: `Each term is ×${mult}: ${seq[2]} × ${mult} = ${next}.`,
    }
  }
  if (d < 85) {
    const start = ri(1, 5)
    const seq = [start ** 2, (start + 1) ** 2, (start + 2) ** 2, (start + 3) ** 2]
    const next = (start + 4) ** 2
    const { choices, answer } = makeChoices(next, [next - 2, next + 2, next + start, (start + 4) * 2])
    return {
      skill: 'counting', difficulty: d,
      prompt: `What comes next? ${seq.join(', ')}, …`,
      speech: 'What number comes next in the sequence?',
      choices, answer,
      explain: `They're perfect squares: ${start + 4}² = ${next}.`,
    }
  }
  if (d >= 95 && Math.random() < 0.5) {
    // expert: primes
    const primes = [2, 3, 5, 7, 11, 13, 17, 19, 23, 29, 31]
    const start = ri(0, 5)
    const seq = primes.slice(start, start + 4)
    const next = primes[start + 4]
    const { choices, answer } = makeChoices(next, [next + 1, next - 1, next + 2])
    return {
      skill: 'counting', difficulty: d,
      prompt: `What comes next? ${seq.join(', ')}, …`,
      speech: 'What number comes next in the sequence?',
      choices, answer,
      explain: `They're prime numbers — the next prime after ${seq[3]} is ${next}.`,
    }
  }
  const a = ri(1, 4)
  const b = a + ri(1, 3)
  const seq = [a, b, a + b, a + 2 * b, 2 * a + 3 * b]
  const next = 3 * a + 5 * b
  const { choices, answer } = makeChoices(next, [next - a, next + a, next + b, 2 * a + 4 * b])
  return {
    skill: 'counting', difficulty: d,
    prompt: `What comes next? ${seq.join(', ')}, …`,
    speech: 'What number comes next in the sequence?',
    choices, answer,
    explain: `Fibonacci-style: each term is the sum of the previous two (${seq[3]} + ${seq[4]} = ${next}).`,
  }
}

// ---- numbers → number sense (compare, round, place value)
function genAdultNumbers(d: number): Question {
  if (d < 35) {
    const n = ri(3, 9) * 100 + ri(11, 89)
    const rounded = Math.round(n / 100) * 100
    const { choices, answer } = makeChoices(rounded, [rounded + 100, rounded - 100, Math.round(n / 10) * 10])
    return {
      skill: 'numbers', difficulty: d,
      prompt: `Round ${n.toLocaleString()} to the nearest hundred`,
      speech: 'Round the number to the nearest hundred.',
      choices, answer,
      explain: `The tens digit is ${Math.floor((n % 100) / 10)}, so ${n} rounds to ${rounded}.`,
    }
  }
  if (d < 60) {
    const n = ri(1000, 9999)
    const places = ['thousands', 'hundreds', 'tens', 'ones'] as const
    const pi = ri(0, 3)
    const digit = Number(String(n)[pi])
    const others = Array.from(new Set(String(n).split('').map(Number).filter((x) => x !== digit)))
    const { choices, answer } = makeChoices(digit, others.length >= 2 ? others : [(digit + 1) % 10, (digit + 3) % 10])
    return {
      skill: 'numbers', difficulty: d,
      prompt: `In ${n.toLocaleString()}, which digit is in the ${places[pi]} place?`,
      speech: `Which digit is in the ${places[pi]} place?`,
      choices, answer,
      explain: `Reading ${n.toLocaleString()} left to right: thousands, hundreds, tens, ones — the ${places[pi]} digit is ${digit}.`,
    }
  }
  // compare fraction / decimal / percent
  const trios: Array<{ opts: [string, string, string]; vals: [number, number, number] }> = [
    { opts: ['3/4', '0.7', '66%'], vals: [0.75, 0.7, 0.66] },
    { opts: ['2/5', '0.45', '39%'], vals: [0.4, 0.45, 0.39] },
    { opts: ['5/8', '0.6', '64%'], vals: [0.625, 0.6, 0.64] },
    { opts: ['1/3', '0.35', '30%'], vals: [1 / 3, 0.35, 0.3] },
    { opts: ['7/10', '0.68', '72%'], vals: [0.7, 0.68, 0.72] },
    { opts: ['4/5', '0.85', '78%'], vals: [0.8, 0.85, 0.78] },
  ]
  const t = pick(trios)
  const biggest = Math.random() < 0.5
  const target = biggest ? Math.max(...t.vals) : Math.min(...t.vals)
  const idx = t.vals.indexOf(target)
  return {
    skill: 'numbers', difficulty: d,
    prompt: `Which is ${biggest ? 'LARGEST' : 'SMALLEST'}?`,
    speech: `Which value is the ${biggest ? 'largest' : 'smallest'}?`,
    choices: [...t.opts],
    answer: idx,
    explain: `As decimals: ${t.opts.map((o, i) => `${o} = ${t.vals[i].toFixed(2)}`).join(', ')} — ${t.opts[idx]} is the ${biggest ? 'largest' : 'smallest'}.`,
  }
}

// ---- addition → mental math
function genAdultMath(d: number): Question {
  if (d < 25) {
    const a = ri(23, 78)
    const b = ri(14, 99 - a)
    const { choices, answer } = makeChoices(a + b, numberDistractors(a + b, 6, 10, 200))
    return { skill: 'addition', difficulty: d, prompt: `${a} + ${b} = ?`, speech: 'Add them up.', choices, answer, explain: `${a} + ${b}: add the tens (${Math.floor(a / 10) * 10}+${Math.floor(b / 10) * 10}), then the ones — ${a + b}.` }
  }
  if (d < 45) {
    const a = ri(6, 12)
    const b = ri(6, 12)
    const { choices, answer } = makeChoices(a * b, [a * b + a, a * b - b, a * (b + 1), (a - 1) * b])
    return { skill: 'addition', difficulty: d, prompt: `${a} × ${b} = ?`, speech: 'Multiply.', choices, answer, explain: `${a} × ${b} = ${a * b}.` }
  }
  if (d < 65) {
    if (Math.random() < 0.5) {
      const b = ri(6, 12)
      const q = ri(7, 15)
      const a = b * q
      const { choices, answer } = makeChoices(q, [q + 1, q - 1, q + 2])
      return { skill: 'addition', difficulty: d, prompt: `${a} ÷ ${b} = ?`, speech: 'Divide.', choices, answer, explain: `${b} × ${q} = ${a}, so ${a} ÷ ${b} = ${q}.` }
    }
    const a = ri(23, 89)
    const b = ri(3, 9)
    const { choices, answer } = makeChoices(a * b, [a * b + b, a * b - a, (a + 1) * b])
    return { skill: 'addition', difficulty: d, prompt: `${a} × ${b} = ?`, speech: 'Multiply.', choices, answer, explain: `${a} × ${b}: (${Math.floor(a / 10) * 10} × ${b}) + (${a % 10} × ${b}) = ${a * b}.` }
  }
  if (d < 85) {
    const pcts = [10, 15, 20, 25, 30, 40, 75] as const
    const p = pick(pcts)
    const base = ri(2, 12) * 20
    const val = (p / 100) * base
    const { choices, answer } = makeChoices(val, [val + base / 20, val - base / 20, val * 2, val / 2].map((x) => Math.round(x)))
    return {
      skill: 'addition', difficulty: d,
      prompt: `${p}% of ${base} = ?`,
      speech: `What is ${p} percent of ${base}?`,
      choices, answer,
      explain: `10% of ${base} is ${base / 10} — scale from there: ${p}% = ${val}.`,
    }
  }
  if (d >= 95) {
    // expert: three-step chains
    const a = ri(13, 24)
    const b = ri(6, 9)
    const c = ri(3, 6)
    const e = ri(17, 59)
    const val = a * b + c * 10 - e
    const { choices, answer } = makeChoices(val, numberDistractors(val, 8, 1, 500))
    return {
      skill: 'addition', difficulty: d,
      prompt: `(${a} × ${b}) + (${c} × 10) − ${e} = ?`,
      speech: 'Three steps — take your time.',
      choices, answer,
      explain: `${a} × ${b} = ${a * b}, plus ${c * 10} = ${a * b + c * 10}, minus ${e} = ${val}.`,
    }
  }
  const a = ri(12, 19)
  const b = ri(4, 8)
  const c = ri(11, 39)
  const val = a * b - c
  const { choices, answer } = makeChoices(val, numberDistractors(val, 6, 1, 400))
  return {
    skill: 'addition', difficulty: d,
    prompt: `(${a} × ${b}) − ${c} = ?`,
    speech: 'Work it out in two steps.',
    choices, answer,
    explain: `${a} × ${b} = ${a * b}, minus ${c} = ${val}.`,
  }
}

// ---- letters → vocabulary (synonyms)
const SYN_T1: Array<[string, string, string[]]> = [
  ['happy', 'glad', ['angry', 'tired']], ['big', 'large', ['thin', 'loud']], ['fast', 'quick', ['slow', 'heavy']],
  ['begin', 'start', ['finish', 'wait']], ['loud', 'noisy', ['quiet', 'bright']], ['easy', 'simple', ['hard', 'messy']],
  ['smart', 'clever', ['dull', 'lazy']], ['cold', 'chilly', ['warm', 'dry']], ['scared', 'afraid', ['brave', 'sleepy']],
]
const SYN_T2: Array<[string, string, string[]]> = [
  ['rapid', 'swift', ['sluggish', 'sturdy']], ['ancient', 'old', ['modern', 'fragile']], ['brave', 'courageous', ['timid', 'careless']],
  ['exhausted', 'tired', ['alert', 'furious']], ['enormous', 'huge', ['tiny', 'average']], ['furious', 'enraged', ['calm', 'joyful']],
  ['fragile', 'delicate', ['sturdy', 'flexible']], ['abundant', 'plentiful', ['scarce', 'ordinary']], ['reluctant', 'unwilling', ['eager', 'careless']],
  ['vivid', 'bright', ['dull', 'distant']], ['peculiar', 'strange', ['normal', 'pleasant']], ['diligent', 'hardworking', ['idle', 'clumsy']],
]
const SYN_T3: Array<[string, string, string[]]> = [
  ['candid', 'honest', ['deceitful', 'reserved']], ['prudent', 'cautious', ['reckless', 'generous']], ['obstinate', 'stubborn', ['flexible', 'gloomy']],
  ['lucid', 'clear', ['confusing', 'ornate']], ['frugal', 'thrifty', ['wasteful', 'wealthy']], ['gregarious', 'sociable', ['solitary', 'hostile']],
  ['ephemeral', 'fleeting', ['permanent', 'essential']], ['ubiquitous', 'everywhere', ['rare', 'hidden']],
  ['magnanimous', 'generous', ['petty', 'cautious']], ['taciturn', 'quiet', ['talkative', 'angry']], ['pragmatic', 'practical', ['idealistic', 'hostile']],
  ['ambivalent', 'torn', ['certain', 'hopeful']], ['tenacious', 'persistent', ['yielding', 'timid']], ['aloof', 'distant', ['friendly', 'nervous']],
  ['astute', 'shrewd', ['naive', 'generous']], ['verbose', 'wordy', ['concise', 'quiet']],
  ['perspicacious', 'insightful', ['oblivious', 'talkative']], ['laconic', 'terse', ['rambling', 'cheerful']],
  ['recalcitrant', 'defiant', ['obedient', 'joyful']], ['sycophant', 'flatterer', ['critic', 'leader']],
  ['esoteric', 'obscure', ['common', 'shallow']], ['intransigent', 'unyielding', ['flexible', 'gentle']],
]
function genAdultVocab(d: number): Question {
  const bank = d < 35 ? SYN_T1 : d < 70 ? SYN_T2 : SYN_T3
  const [word, syn, wrong] = pick(bank)
  const opts = shuffle([syn, ...wrong])
  return {
    skill: 'letters', difficulty: d,
    prompt: `Which means the same as "${word}"?`,
    speech: `Which word means the same as ${word}?`,
    choices: opts,
    answer: opts.indexOf(syn),
    explain: `"${word.charAt(0).toUpperCase() + word.slice(1)}" means ${syn}.`,
  }
}

// ---- sounds → analogies
const ANALOGIES: Array<{ tier: 1 | 2 | 3; a: string; b: string; c: string; d: string; misses: string[] }> = [
  { tier: 1, a: 'glove', b: 'hand', c: 'sock', d: 'foot', misses: ['shoe', 'leg'] },
  { tier: 1, a: 'puppy', b: 'dog', c: 'kitten', d: 'cat', misses: ['mouse', 'lion'] },
  { tier: 1, a: 'day', b: 'sun', c: 'night', d: 'moon', misses: ['star', 'cloud'] },
  { tier: 2, a: 'author', b: 'book', c: 'composer', d: 'symphony', misses: ['piano', 'singer'] },
  { tier: 2, a: 'sapling', b: 'tree', c: 'cub', d: 'bear', misses: ['den', 'wolf'] },
  { tier: 2, a: 'keyboard', b: 'type', c: 'brush', d: 'paint', misses: ['canvas', 'color'] },
  { tier: 3, a: 'drought', b: 'rain', c: 'famine', d: 'food', misses: ['hunger', 'harvest'] },
  { tier: 3, a: 'novice', b: 'experience', c: 'pauper', d: 'money', misses: ['work', 'poverty'] },
  { tier: 3, a: 'archipelago', b: 'islands', c: 'constellation', d: 'stars', misses: ['planets', 'sky'] },
  { tier: 1, a: 'bird', b: 'nest', c: 'bee', d: 'hive', misses: ['flower', 'honey'] },
  { tier: 1, a: 'hot', b: 'cold', c: 'up', d: 'down', misses: ['high', 'over'] },
  { tier: 2, a: 'sculptor', b: 'statue', c: 'baker', d: 'bread', misses: ['oven', 'flour'] },
  { tier: 2, a: 'library', b: 'books', c: 'orchard', d: 'trees', misses: ['fruit', 'farm'] },
  { tier: 3, a: 'ephemeral', b: 'permanent', c: 'ravenous', d: 'satiated', misses: ['hungry', 'eager'] },
  { tier: 3, a: 'oasis', b: 'desert', c: 'harbor', d: 'sea', misses: ['ship', 'storm'] },
]
function genAdultAnalogy(d: number): Question {
  const tier = d < 35 ? 1 : d < 70 ? 2 : 3
  const bank = ANALOGIES.filter((x) => x.tier === tier)
  const a = pick(bank)
  const opts = shuffle([a.d, ...a.misses])
  return {
    skill: 'sounds', difficulty: d,
    prompt: `${a.a} → ${a.b}, as ${a.c} → ?`,
    speech: `${a.a} is to ${a.b} as ${a.c} is to what?`,
    choices: opts,
    answer: opts.indexOf(a.d),
    explain: `A ${a.a} goes with ${a.b} the way a ${a.c} goes with ${a.d}.`,
  }
}

// ---- shapes → letter/number logic patterns
function genAdultLogic(d: number): Question {
  const A = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'
  if (d < 45) {
    const step = ri(1, 2)
    const start = ri(0, 25 - step * 4)
    const seq = [0, 1, 2, 3].map((i) => A[start + i * step])
    const next = A[start + 4 * step]
    const { choices, answer } = makeChoices(next, letterDistractors(next))
    return {
      skill: 'shapes', difficulty: d,
      prompt: `${seq.join(', ')}, …?`,
      speech: 'Which letter comes next in the pattern?',
      choices, answer,
      explain: `The letters step forward by ${step}: after ${seq[3]} comes ${next}.`,
    }
  }
  if (d < 75) {
    // growing skips: A, B, D, G, K (+1, +2, +3, +4)
    const start = ri(0, 10)
    const pos = [start, start + 1, start + 3, start + 6]
    const next = A[start + 10]
    const seq = pos.map((p) => A[p])
    const { choices, answer } = makeChoices(next, letterDistractors(next))
    return {
      skill: 'shapes', difficulty: d,
      prompt: `${seq.join(', ')}, …?`,
      speech: 'Which letter comes next in the pattern?',
      choices, answer,
      explain: `The skips grow by one each time (+1, +2, +3, +4): ${next}.`,
    }
  }
  // paired letter+number: B2, D4, F6 → H8
  const start = ri(0, 8)
  const step = ri(2, 3)
  const items = [0, 1, 2].map((i) => `${A[start + i * step]}${(i + 1) * step}`)
  const next = `${A[start + 3 * step]}${4 * step}`
  const wrongs = [`${A[start + 3 * step]}${3 * step}`, `${A[start + 2 * step]}${4 * step}`]
  const opts = shuffle([next, ...wrongs])
  return {
    skill: 'shapes', difficulty: d,
    prompt: `${items.join(', ')}, …?`,
    speech: 'What comes next in the pattern?',
    choices: opts,
    answer: opts.indexOf(next),
    explain: `Letters step by ${step} and numbers count up by ${step}: ${next}.`,
  }
}

// ---- words → spelling
const SPELL: Array<{ tier: 1 | 2 | 3; right: string; wrong: [string, string] }> = [
  { tier: 1, right: 'because', wrong: ['becuase', 'becase'] },
  { tier: 1, right: 'friend', wrong: ['freind', 'frend'] },
  { tier: 1, right: 'people', wrong: ['peaple', 'poeple'] },
  { tier: 2, right: 'separate', wrong: ['seperate', 'separete'] },
  { tier: 2, right: 'definitely', wrong: ['definately', 'definitly'] },
  { tier: 2, right: 'receive', wrong: ['recieve', 'receeve'] },
  { tier: 2, right: 'believe', wrong: ['beleive', 'believ'] },
  { tier: 3, right: 'necessary', wrong: ['neccessary', 'necessery'] },
  { tier: 3, right: 'occurrence', wrong: ['occurence', 'occurrance'] },
  { tier: 3, right: 'accommodate', wrong: ['accomodate', 'acommodate'] },
  { tier: 3, right: 'embarrass', wrong: ['embarass', 'embarras'] },
  { tier: 3, right: 'conscience', wrong: ['concience', 'consciense'] },
  { tier: 3, right: 'rhythm', wrong: ['rythm', 'rythym'] },
  { tier: 1, right: 'beautiful', wrong: ['beutiful', 'beautifull'] },
  { tier: 1, right: 'tomorrow', wrong: ['tommorow', 'tomorow'] },
  { tier: 2, right: 'privilege', wrong: ['priviledge', 'privelege'] },
  { tier: 2, right: 'calendar', wrong: ['calender', 'calandar'] },
  { tier: 2, right: 'restaurant', wrong: ['restaraunt', 'restuarant'] },
  { tier: 3, right: 'liaison', wrong: ['liason', 'liasion'] },
  { tier: 3, right: 'questionnaire', wrong: ['questionaire', 'questionnair'] },
  { tier: 3, right: 'maintenance', wrong: ['maintainance', 'maintenence'] },
]
function genAdultSpelling(d: number): Question {
  const tier = d < 35 ? 1 : d < 70 ? 2 : 3
  const s = pick(SPELL.filter((x) => x.tier === tier))
  const opts = shuffle([s.right, ...s.wrong])
  return {
    skill: 'words', difficulty: d,
    prompt: 'Which is spelled correctly?',
    speech: 'Which one is spelled correctly?',
    choices: opts,
    answer: opts.indexOf(s.right),
    explain: `The correct spelling is "${s.right}".`,
  }
}

// ---- science → modern science & frontier (physics, quantum, AI, bio, medicine)
const ADULT_SCI: Array<{ tier: 1 | 2 | 3; q: string; a: string; m: [string, string]; why: string }> = [
  { tier: 1, q: 'Antibiotics are effective against…', a: 'bacteria only', m: ['viruses only', 'both equally'], why: 'Antibiotics disrupt bacterial machinery; viruses hijack your own cells, so antivirals and vaccines handle those.' },
  { tier: 1, q: 'The fastest possible speed in the universe is the speed of…', a: 'light', m: ['sound', 'neutrinos'], why: 'Light in a vacuum (~186,000 mi/s) is the universal speed limit set by relativity.' },
  { tier: 1, q: 'DNA’s famous shape is a…', a: 'double helix', m: ['triple knot', 'flat ladder'], why: 'Two strands twist around each other — Watson, Crick and Franklin’s 1953 discovery.' },
  { tier: 1, q: 'The Sun produces energy by…', a: 'nuclear fusion', m: ['combustion', 'fission'], why: 'Hydrogen nuclei fuse into helium, converting mass to energy per E=mc².' },
  { tier: 1, q: 'Which organ consumes ~20% of your body’s energy?', a: 'the brain', m: ['the heart', 'the skin'], why: 'About a fifth of your calories feed roughly 86 billion neurons.' },
  { tier: 1, q: 'E = mc² says mass can be converted into…', a: 'energy', m: ['momentum', 'gravity'], why: 'A tiny amount of mass equals enormous energy — c² is a huge multiplier.' },
  { tier: 1, q: 'The four forces of flight are lift, weight, thrust and…', a: 'drag', m: ['torque', 'friction'], why: 'Straight-and-level flight is lift balancing weight while thrust balances drag.' },
  { tier: 1, q: 'Ohm’s law relates voltage, current and…', a: 'resistance', m: ['capacitance', 'frequency'], why: 'V = I × R — the push, the flow, and what resists it.' },
  { tier: 1, q: 'Clouds form when air cools to its…', a: 'dew point', m: ['boiling point', 'freezing core'], why: 'At the dew point the air is saturated, and water vapor condenses into droplets.' },
  { tier: 2, q: 'A qubit can be 0 and 1 at the same time — a state called…', a: 'superposition', m: ['interpolation', 'oscillation'], why: 'Until measured, a qubit holds a blend of both states — the source of quantum computing’s power.' },
  { tier: 2, q: 'Einstein called quantum entanglement…', a: 'spooky action at a distance', m: ['the hidden ladder', 'God’s dice'], why: 'Entangled particles show correlated results instantly at any distance — verified by the 2022 Nobel-winning experiments.' },
  { tier: 2, q: 'Neural networks are loosely modeled on…', a: 'brain neurons', m: ['ant colonies', 'circuit breakers'], why: 'Layers of simple units with weighted connections, tuned by training — a cartoon of real neurons.' },
  { tier: 2, q: 'mRNA vaccines work by giving your cells…', a: 'a protein recipe', m: ['antibodies', 'a weakened virus'], why: 'Your cells briefly manufacture one harmless viral protein; your immune system trains on it.' },
  { tier: 2, q: 'CRISPR is best described as…', a: 'a DNA editor', m: ['a cloning vat', 'an X-ray scope'], why: 'A guide RNA steers the Cas9 protein to a DNA address to cut or rewrite it — first approved therapies arrived in 2023.' },
  { tier: 2, q: 'Entropy in a closed system tends to…', a: 'increase', m: ['decrease', 'oscillate'], why: 'The second law of thermodynamics: disorder wins without energy input — why engines waste heat and ice melts.' },
  { tier: 2, q: 'Most of the universe’s matter appears to be…', a: 'dark matter', m: ['hydrogen', 'black holes'], why: 'Galaxies spin as if ~5× more mass is there than we can see; its identity is still unknown.' },
  { tier: 2, q: '"Training" vs "inference" in AI: inference is when the model…', a: 'answers questions', m: ['updates its weights', 'collects data'], why: 'Training adjusts billions of weights from examples; inference runs the frozen model to produce answers.' },
  { tier: 2, q: 'A wing stalls when it exceeds its critical…', a: 'angle of attack', m: ['airspeed', 'altitude'], why: 'A stall is about ANGLE, not speed — exceed the critical angle of attack and the airflow separates, at any airspeed.' },
  { tier: 2, q: 'Hot, high and humid (high density altitude) makes an airplane…', a: 'perform worse', m: ['perform better', 'use less runway'], why: 'Thin air means less lift and less engine power — longer takeoff rolls, the mountain-airport trap.' },
  { tier: 2, q: 'Pilots take off and land INTO the wind because it…', a: 'shortens the roll', m: ['cools the engine', 'saves fuel'], why: 'A headwind gives the wings airflow for free, so the plane flies at a lower ground speed — shorter rolls both ways.' },
  { tier: 2, q: 'A falling barometer usually means…', a: 'worsening weather', m: ['clearing skies', 'colder nights only'], why: 'Falling pressure marks an approaching low — clouds, wind and precipitation ride with it.' },
  { tier: 2, q: 'Household AC differs from a battery’s DC because AC…', a: 'reverses direction', m: ['has no voltage', 'is always safer'], why: 'Alternating current flips back and forth (60 times a second in the US); direct current flows one way.' },
  { tier: 3, q: 'The breakthrough architecture behind modern chatbots is the…', a: 'transformer', m: ['perceptron', 'decision tree'], why: '"Attention is All You Need" (2017): attention layers let models weigh every word against every other, at scale.' },
  { tier: 3, q: 'An AI "hallucination" is…', a: 'a confident false output', m: ['a training crash', 'an overheated GPU'], why: 'Language models predict plausible text, not verified truth — fluent and wrong is a failure mode to check for.' },
  { tier: 3, q: 'AlphaFold’s landmark achievement was predicting…', a: 'protein structures', m: ['earthquakes', 'stock prices'], why: 'It solved 50 years of protein-folding grand challenge — 2024 chemistry Nobel; now a standard biology tool.' },
  { tier: 3, q: 'The Higgs field is what gives fundamental particles…', a: 'mass', m: ['charge', 'spin'], why: 'Confirmed at CERN in 2012 — particles interacting with the field resist acceleration, which is mass.' },
  { tier: 3, q: 'Quantum tunneling lets particles…', a: 'slip through barriers', m: ['exceed light speed', 'duplicate themselves'], why: 'Wavefunctions leak through barriers particles "shouldn’t" have the energy to cross — it’s why the Sun fuses and flash memory works.' },
  { tier: 3, q: 'In 2022 fusion researchers at NIF first achieved…', a: 'ignition', m: ['a tokamak grid', 'cold fusion'], why: 'Ignition = more fusion energy out than the lasers put on the target. A milestone, not a power plant — the facility still drew far more wall power.' },
  { tier: 3, q: 'Telomeres are…', a: 'chromosome end-caps', m: ['immune cells', 'brain folds'], why: 'Protective caps that shorten with each cell division — one of the clocks of aging and a target of longevity research.' },
  { tier: 3, q: 'Cancer immunotherapy works by…', a: 'arming your immune system', m: ['heat instead of chemo', 'blocking cell division'], why: 'Checkpoint inhibitors and CAR-T cells remove the brakes or retarget T-cells against tumors — a Nobel-winning revolution in oncology.' },
  { tier: 3, q: 'Heisenberg’s uncertainty principle limits knowing…', a: 'position and momentum', m: ['mass and charge', 'time and temperature'], why: 'Sharpen one and you blur the other — not a measurement flaw, a property of nature.' },
  { tier: 3, q: 'LIGO detects black-hole mergers by measuring…', a: 'gravitational waves', m: ['radio bursts', 'neutrino showers'], why: 'Ripples in spacetime stretch its 4-km laser arms by less than a proton’s width — first heard in 2015.' },
  { tier: 3, q: 'A METAR is…', a: 'an airport weather report', m: ['a radio beacon', 'an engine gauge'], why: 'The coded hourly surface observation pilots read before every flight — wind, visibility, clouds, pressure.' },
  { tier: 3, q: 'Carburetor ice can form even on a 70°F day when…', a: 'humidity is high', m: ['fuel is cold', 'skies are clear'], why: 'Fuel vaporization chills the carburetor 20°C or more — moist air can ice the venturi in summer.' },
  { tier: 3, q: 'Wake turbulence behind a big jet is worst when it’s…', a: 'slow, heavy, clean', m: ['fast and light', 'descending empty'], why: 'Wingtip vortices are fiercest at high angle of attack — small planes stay at or above its path and land beyond its touchdown point.' },
  { tier: 3, q: 'A cold front typically brings…', a: 'short, violent storms', m: ['days of drizzle', 'steady warm rain'], why: 'A cold front shoves warm air up fast — brief intense weather, then clearing. Warm fronts bring the long gray drizzle.' },
  { tier: 3, q: 'A circuit breaker protects the wiring by…', a: 'opening on overload', m: ['boosting voltage', 'storing charge'], why: 'Too many amps overheat wires — the breaker opens the loop before the wiring does it the hard way.' },
  { tier: 3, q: 'Flying VFR means navigating by…', a: 'looking outside', m: ['instruments only', 'autopilot'], why: 'Visual Flight Rules: see and avoid, with minimums for visibility and cloud clearance. IFR is the instrument world.' },
]

function genAdultScience(d: number): Question {
  const tier = d < 35 ? 1 : d < 70 ? 2 : 3
  const f = pick(ADULT_SCI.filter((x) => x.tier === tier))
  const opts = shuffle([f.a, ...f.m])
  return {
    skill: 'science',
    difficulty: d,
    prompt: f.q,
    speech: f.q,
    choices: opts,
    answer: opts.indexOf(f.a),
    explain: f.why,
  }
}

const GENERATORS: Record<SkillId, (d: number) => Question> = {
  counting: genCounting,
  numbers: genNumbers,
  addition: genAddition,
  letters: genLetters,
  sounds: genSounds,
  shapes: genShapes,
  words: genWords,
  science: genScience,
}

const ADULT_GENERATORS: Record<SkillId, (d: number) => Question> = {
  counting: genAdultSequences,
  numbers: genAdultNumbers,
  addition: genAdultMath,
  letters: genAdultVocab,
  sounds: genAdultAnalogy,
  shapes: genAdultLogic,
  words: genAdultSpelling,
  science: genAdultScience,
}

/** adult display names for the same skill slots */
export const ADULT_SKILL_NAMES: Record<SkillId, string> = {
  counting: 'Sequences',
  numbers: 'Number sense',
  addition: 'Mental math',
  letters: 'Vocabulary',
  sounds: 'Analogies',
  shapes: 'Logic patterns',
  words: 'Spelling',
  science: 'Science & frontier',
}

/** one rule for kid-vs-adult skill labels (was copy-pasted at five call sites) */
export function skillDisplayName(meta: SkillMeta, adult: boolean): string {
  return adult ? ADULT_SKILL_NAMES[meta.id] : meta.name
}

export function generateQuestion(skill: SkillId, difficulty: number, adult = false): Question {
  const d = Math.max(1, Math.min(99, Math.round(difficulty)))
  const gen = adult ? ADULT_GENERATORS[skill] : GENERATORS[skill]
  const q = gen(d)
  // safety: guarantee a valid answer index even if a generator edge case slips
  if (q.answer < 0 || q.answer >= q.choices.length) {
    return gen(d)
  }
  return q
}
