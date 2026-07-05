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
  let n: number
  if (d < 20) n = ri(1, 4)
  else if (d < 40) n = ri(3, 7)
  else if (d < 60) n = ri(5, 10)
  else if (d < 80) n = ri(8, 15)
  else {
    // skip counting: by 2s, 5s or 10s
    const step = pick([2, 5, 10] as const)
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
  const n = ri(2, 18)
  const { choices, answer } = makeChoices(n, numberDistractors(n, 2, 0, 20))
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
  // missing addend
  const total = ri(5, 10)
  const a = ri(1, total - 1)
  const missing = total - a
  const { choices, answer } = makeChoices(missing, numberDistractors(missing, 2, 0, 10))
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
]
const RHYMES: Array<{ target: string; match: string; misses: string[] }> = [
  { target: 'cat', match: 'hat', misses: ['dog', 'sun'] },
  { target: 'ball', match: 'wall', misses: ['tree', 'fish'] },
  { target: 'sun', match: 'run', misses: ['moon', 'hat'] },
  { target: 'pig', match: 'dig', misses: ['cow', 'net'] },
  { target: 'goat', match: 'boat', misses: ['duck', 'ring'] },
  { target: 'moon', match: 'spoon', misses: ['star', 'frog'] },
  { target: 'bug', match: 'rug', misses: ['ant', 'bee'] },
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
const SIGHT_1 = ['a', 'I', 'the', 'to', 'and', 'go', 'we', 'my', 'see', 'in', 'it', 'up']
const SIGHT_2 = ['he', 'she', 'was', 'are', 'you', 'they', 'said', 'have', 'like', 'this', 'for', 'play']
const SIGHT_3 = ['what', 'when', 'out', 'some', 'come', 'here', 'want', 'good', 'little', 'down', 'look', 'jump']
const CVC: Array<{ word: string; emoji: string; misses: string[] }> = [
  { word: 'cat', emoji: '🐱', misses: ['cot', 'cut'] },
  { word: 'dog', emoji: '🐶', misses: ['dig', 'dug'] },
  { word: 'sun', emoji: '☀️', misses: ['son', 'sin'] },
  { word: 'bug', emoji: '🐞', misses: ['big', 'bag'] },
  { word: 'hat', emoji: '🎩', misses: ['hot', 'hit'] },
  { word: 'pig', emoji: '🐷', misses: ['peg', 'pug'] },
  { word: 'bus', emoji: '🚌', misses: ['bas', 'bos'] },
  { word: 'map', emoji: '🗺️', misses: ['mop', 'mup'] },
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

const GENERATORS: Record<SkillId, (d: number) => Question> = {
  counting: genCounting,
  numbers: genNumbers,
  addition: genAddition,
  letters: genLetters,
  sounds: genSounds,
  shapes: genShapes,
  words: genWords,
}

export function generateQuestion(skill: SkillId, difficulty: number): Question {
  const d = Math.max(1, Math.min(99, Math.round(difficulty)))
  const q = GENERATORS[skill](d)
  // safety: guarantee a valid answer index even if a generator edge case slips
  if (q.answer < 0 || q.answer >= q.choices.length) {
    return GENERATORS[skill](d)
  }
  return q
}
