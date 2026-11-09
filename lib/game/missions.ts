// Brain Ball — 🔨 real-world missions (pure).
//
// Brian, Nov 6 ("happiness and satisfaction in mind … whatever else we can
// add — add it"): the screen should point the boys OFF the screen. One
// mission a day — build something, help someone, go look at the real world —
// and a grown-up confirms it before the coins land. Missions echo the skills
// (machines → build, heart → help, space/rocks/maps → explore, business →
// money), so the questions and the real world teach the same thing.

import { ageInMonths } from './adaptive'
import type { KidProfile } from './types'

export interface Mission {
  id: string
  emoji: string
  /** short line on the card */
  title: string
  /** what the voice says, with the "how" */
  say: string
  /** 'little' = the 4-year-old, 'big' = 5½+, 'any' = both */
  for: 'little' | 'big' | 'any'
}

export const MISSION_COINS = 15

export const MISSIONS: Mission[] = [
  // 🔨 build (machines)
  { id: 'tower', emoji: '🏗️', title: 'Build a tower that holds a book', say: 'Build a tower out of blocks or cups that can hold up a book on top. Triangles and wide bottoms make it strong!', for: 'any' },
  { id: 'ramp', emoji: '🛝', title: 'Make a ramp and race two cars', say: 'Make a ramp with a book and a board. Race two toy cars down it. Which one wins? Try making the ramp steeper!', for: 'any' },
  { id: 'bridge', emoji: '🌉', title: 'Build a bridge between two chairs', say: 'Build a bridge between two chairs or two books that a toy car can drive across without falling.', for: 'big' },
  { id: 'lever', emoji: '⚖️', title: 'Lift something heavy with a lever', say: 'Use a ruler and a pencil as a seesaw to lift a cup. Move the pencil closer to the cup — is it easier?', for: 'big' },
  { id: 'pulley', emoji: '🪝', title: 'Make a bucket go up with a rope', say: 'With a grown-up, loop a rope over something and lift a little bucket by pulling down. That is a pulley!', for: 'big' },
  { id: 'fort', emoji: '🏰', title: 'Build a fort and give a tour', say: 'Build a fort with blankets and pillows. Then give a grown-up a tour of your fort!', for: 'any' },
  { id: 'boat', emoji: '⛵', title: 'Make a boat that floats', say: 'Make a little boat from foil or paper. Does it float? How many pennies can it carry before it sinks?', for: 'big' },
  { id: 'stack', emoji: '🧱', title: 'Stack 10 blocks without falling', say: 'Stack ten blocks into a tall tower without it falling down. Go slow and steady!', for: 'little' },
  // ❤️ help (heart)
  { id: 'helpdinner', emoji: '🍽️', title: 'Help set the table', say: 'Help set the table for dinner — plates, forks and napkins for everybody.', for: 'any' },
  { id: 'toys', emoji: '🧸', title: 'Clean up your toys — fast!', say: 'Clean up all your toys before a grown-up counts to one hundred. Ready, go!', for: 'any' },
  { id: 'thanks', emoji: '🙏', title: 'Thank someone and say why', say: 'Tell someone thank you, and tell them why. Like: thank you for making lunch, it was yummy!', for: 'any' },
  { id: 'kindbrother', emoji: '🤝', title: 'Do something kind for your brother', say: 'Do something kind for your brother without being asked. Share, help, or play his favorite game!', for: 'any' },
  { id: 'card', emoji: '💌', title: 'Make a card for someone you love', say: 'Draw a card for someone you love and give it to them today.', for: 'any' },
  { id: 'dog', emoji: '🐕', title: 'Help take care of a pet or plant', say: 'Help feed a pet or water a plant today. Taking care of living things is a big job!', for: 'any' },
  { id: 'laundry', emoji: '🧺', title: 'Help sort the laundry', say: 'Help sort the laundry — match the socks, and put everyone\'s clothes in the right pile.', for: 'any' },
  { id: 'teach', emoji: '🧑‍🏫', title: 'Teach your brother something new', say: 'Teach your brother something you know — a word, a trick, or a fact from Brain Ball. Teaching makes your brain stronger!', for: 'big' },
  { id: 'grateful3', emoji: '🌟', title: 'Tell 3 things you are thankful for', say: 'At dinner, tell everybody three things you are thankful for today.', for: 'any' },
  // 🔭 explore (space, rocks, maps, science)
  { id: 'moon', emoji: '🌙', title: 'Find the Moon and draw its shape', say: 'Look for the Moon today or tonight. What shape is it? Draw it!', for: 'any' },
  { id: 'rocks', emoji: '🪨', title: 'Find 3 different rocks', say: 'Go outside and find three rocks that look different. Which is smoothest? Which is heaviest?', for: 'any' },
  { id: 'bugs', emoji: '🐞', title: 'Find 3 bugs outside', say: 'Go bug hunting outside. Find three different bugs — but just look, don\'t squish!', for: 'any' },
  { id: 'clouds', emoji: '☁️', title: 'Look at the clouds — what shapes?', say: 'Lie down and look at the clouds. What shapes do you see? Are they puffy, flat, or stormy?', for: 'any' },
  { id: 'map', emoji: '🗺️', title: 'Draw a map of your room', say: 'Draw a map of your room from the top, like a bird would see it. Put an X where a treasure is hidden!', for: 'big' },
  { id: 'shadow', emoji: '☀️', title: 'Trace your shadow, then check later', say: 'Trace your shadow with chalk in the morning, then stand in the same spot later. Did your shadow move? The Earth is spinning!', for: 'big' },
  { id: 'sink', emoji: '🛁', title: 'Sink or float test in the bath', say: 'At bath time, guess if five toys will sink or float — then test them. Were your guesses right?', for: 'any' },
  { id: 'dig', emoji: '⛏️', title: 'Dig and look at the dirt layers', say: 'With a grown-up, dig a small hole. Is the top dirt darker? That is topsoil — plants love it!', for: 'big' },
  { id: 'seed', emoji: '🌱', title: 'Plant a seed', say: 'Plant a seed in a cup with dirt. Give it water and sun, and check it every day!', for: 'any' },
  { id: 'stars', emoji: '⭐', title: 'Count stars before bed', say: 'Look outside before bed and count the stars you can see. Can you find a really bright one?', for: 'any' },
  { id: 'machine', emoji: '🚜', title: 'Spot a working machine', say: 'Find a working machine today — a digger, a dump truck, a crane or a mower. What job is it doing?', for: 'any' },
  // 💰 money (business)
  { id: 'coins', emoji: '🪙', title: 'Sort coins and count them', say: 'Sort some coins into pennies, nickels, dimes and quarters. Which is worth the most?', for: 'big' },
  { id: 'store', emoji: '🏪', title: 'Play store with real prices', say: 'Play store! Put prices on toys, and let a grown-up buy something. Did you give the right change?', for: 'big' },
  { id: 'save', emoji: '🐷', title: 'Put a coin in your piggy bank', say: 'Put a coin in your piggy bank. Saving a little every day adds up!', for: 'little' },
  { id: 'need', emoji: '🛒', title: 'Find 3 needs and 3 wants at home', say: 'Find three things you need, like food or a coat, and three things you just want, like a toy.', for: 'big' },
  // 🧭 think (logic & truth)
  { id: 'robotsteps', emoji: '🤖', title: 'Be a robot — follow exact steps', say: 'Play robot! A grown-up gives you exact steps to make a sandwich, and you do EXACTLY what they say. Then switch!', for: 'big' },
  { id: 'question', emoji: '❓', title: 'Ask a grown-up a big WHY question', say: 'Ask a grown-up a big why question — like why is the sky blue — and find the answer together.', for: 'any' },
  { id: 'pattern', emoji: '🔴', title: 'Make a pattern with toys', say: 'Make a pattern with your toys — like red, blue, red, blue. Can a grown-up guess what comes next?', for: 'little' },
  { id: 'colors', emoji: '🎨', title: 'Find 5 things that are red', say: 'Walk around and find five things that are red. Then try blue!', for: 'little' },
  // 🏃 body & outside
  { id: 'run', emoji: '🏃', title: 'Race around the yard 3 times', say: 'Run around the yard three times. Can you beat your time on the second try?', for: 'any' },
  { id: 'catch', emoji: '🏈', title: 'Play catch — 10 in a row', say: 'Play catch with a grown-up or your brother. Can you get ten in a row without dropping it?', for: 'any' },
  { id: 'kick', emoji: '🦵', title: 'Kick a field goal outside', say: 'Kick a ball between two things in the yard — your own field goal! Back up a step after each make.', for: 'any' },
  { id: 'jump', emoji: '🐸', title: 'Jump like 5 different animals', say: 'Jump like a frog, hop like a bunny, waddle like a penguin, stomp like a dinosaur, and leap like a kangaroo!', for: 'little' },
  { id: 'read', emoji: '📚', title: 'Read a book to someone', say: 'Read a book to someone — your brother, a grown-up, or even a stuffed animal!', for: 'big' },
  { id: 'story', emoji: '📖', title: 'Pick a book for bedtime story', say: 'Pick a book for bedtime and ask questions about the story while you read it together.', for: 'little' },
]

/** local YYYY-MM-DD */
export function dayKey(d = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function hash(s: string): number {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

/** which missions fit this kid (grown-up testers get the "big" set) */
export function missionPool(kid: Pick<KidProfile, 'birthdate' | 'isTester'>, now = new Date()): Mission[] {
  const big = kid.isTester || ageInMonths(kid.birthdate, now) >= 66
  return MISSIONS.filter((m) => m.for === 'any' || m.for === (big ? 'big' : 'little'))
}

/** whole local days since 1970 (DST-proof: built from the calendar date) */
function dayNumber(d: Date): number {
  return Math.round(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 86_400_000)
}

/** the kid's own shuffled order of the pool (seeded by kid + pool size) */
function kidOrder(kidId: string, n: number): number[] {
  const order = Array.from({ length: n }, (_, i) => i)
  let seed = hash(`${kidId}:${n}`) || 1
  for (let i = n - 1; i > 0; i--) {
    seed = Math.imul(seed ^ (seed >>> 15), 2246822519) >>> 0
    const j = seed % (i + 1)
    ;[order[i], order[j]] = [order[j], order[i]]
  }
  return order
}

/**
 * Today's mission — the same all day for one kid, different order for each
 * brother. Each kid walks their OWN shuffled cycle one step a day, so the
 * same mission can never land two days running and every mission comes
 * round before any repeats (the old "bump if equal to yesterday's raw pick"
 * could still repeat when yesterday had been bumped — ship-check).
 */
export function missionFor(kid: Pick<KidProfile, 'id' | 'birthdate' | 'isTester'>, now = new Date()): Mission {
  const pool = missionPool(kid, now)
  const order = kidOrder(kid.id, pool.length)
  return pool[order[((dayNumber(now) % pool.length) + pool.length) % pool.length]]
}

/** big kid = 5½ and up (grown-up testers count as big) */
export function isBigKid(kid: Pick<KidProfile, 'birthdate' | 'isTester'>, now = new Date()): boolean {
  return !!kid.isTester || ageInMonths(kid.birthdate, now) >= 66
}

/** one item a day from `pool`, the same all day, each kid walking their own shuffled cycle (salted so cards don't move in lockstep) */
export function dailyPick<T>(kidId: string, salt: string, pool: T[], now = new Date()): T {
  const order = kidOrder(`${kidId}:${salt}`, pool.length)
  return pool[order[((dayNumber(now) % pool.length) + pool.length) % pool.length]]
}
