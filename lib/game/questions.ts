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
  if (d < 85) {
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

function genWords(d: number): Question {
  if (d < 75) {
    const list = d < 30 ? SIGHT_1 : d < 55 ? SIGHT_2 : SIGHT_3
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

const GENERATORS: Record<SkillId, (d: number) => Question> = {
  counting: genCounting,
  numbers: genNumbers,
  addition: genAddition,
  letters: genLetters,
  sounds: genSounds,
  shapes: genShapes,
  words: genWords,
}

const ADULT_GENERATORS: Record<SkillId, (d: number) => Question> = {
  counting: genAdultSequences,
  numbers: genAdultNumbers,
  addition: genAdultMath,
  letters: genAdultVocab,
  sounds: genAdultAnalogy,
  shapes: genAdultLogic,
  words: genAdultSpelling,
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
