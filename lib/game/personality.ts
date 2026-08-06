// Brain Ball — "Who Am I?" temperament quiz for kids.
//
// Based on the classic four-temperaments framework long used in Christian
// parenting and education literature (e.g. Littauer's "Personality Plus"),
// presented as friendly animals. Every question is a wholesome, observable
// this-or-that about play, helping, and friends — nothing probing, nothing
// hidden. Results are framed as God-given strengths plus areas to grow in,
// each anchored to a Scripture verse. This is a conversation starter for
// parents and teachers, not a clinical instrument.

export type TemperamentId = 'lion' | 'parrot' | 'owl' | 'turtle'

export interface Temperament {
  id: TemperamentId
  animal: string
  title: string
  classic: string
  summary: string
  strengths: string[]
  growsIn: string[]
  parentTips: string[]
  teacherTip: string
  verse: string
}

export const TEMPERAMENTS: Record<TemperamentId, Temperament> = {
  lion: {
    id: 'lion',
    animal: '🦁',
    title: 'Brave Lion',
    classic: 'Choleric',
    summary: 'A born leader — determined, confident, and quick to act. Lions love a challenge and want to be in charge of the mission.',
    strengths: ['Natural leader', 'Determined — does not quit', 'Makes decisions fast', 'Sticks up for others'],
    growsIn: ['Patience and taking turns', 'Using gentle words', 'Letting others go first'],
    parentTips: [
      'Give real jobs with real authority ("you are in charge of feeding the dog").',
      'Channel the drive into serving others — leadership as helping, not bossing.',
      'Praise self-control as strength: "It took a strong kid to wait your turn."',
    ],
    teacherTip: 'Give Lions responsibility early (line leader, materials captain) — they act out when they have nothing to lead.',
    verse: '"Better a patient person than a warrior, one with self-control than one who takes a city." — Proverbs 16:32',
  },
  parrot: {
    id: 'parrot',
    animal: '🦜',
    title: 'Joyful Parrot',
    classic: 'Sanguine',
    summary: 'The sunshine of the room — playful, talkative, and full of stories. Parrots make friends everywhere and turn everything into fun.',
    strengths: ['Joyful and funny', 'Makes friends instantly', 'Big imagination', 'Encourages everyone'],
    growsIn: ['Finishing what they start', 'Listening without interrupting', 'Quiet focus time'],
    parentTips: [
      'Give them an audience — let them retell the story at dinner.',
      'Make chores a game or a song; fun is their fuel.',
      'Practice short "listening missions" and celebrate them loudly.',
    ],
    teacherTip: 'Seat Parrots where participation is easy and legal — they learn by talking. Give speaking roles before asking for silence.',
    verse: '"A joyful heart is good medicine." — Proverbs 17:22',
  },
  owl: {
    id: 'owl',
    animal: '🦉',
    title: 'Thoughtful Owl',
    classic: 'Melancholic',
    summary: 'A careful thinker with a big heart — Owls notice details, love order, and want things done right. Deep feelers and deep thinkers.',
    strengths: ['Careful and precise', 'Remembers everything', 'Creative and artistic', 'Notices how others feel'],
    growsIn: ['Rolling with changes', 'Bouncing back from mistakes', 'Calling "good enough" done'],
    parentTips: [
      'Give a heads-up before plans change — surprises are hard on Owls.',
      'Celebrate effort over perfection; model laughing at your own mistakes.',
      'Ask for their ideas — Owls often think more than they say.',
    ],
    teacherTip: 'Owls wilt under public correction. Correct quietly, praise their careful work specifically, and give warning before transitions.',
    verse: '"The heart of the discerning acquires knowledge, for the ears of the wise seek it out." — Proverbs 18:15',
  },
  turtle: {
    id: 'turtle',
    animal: '🐢',
    title: 'Peaceful Turtle',
    classic: 'Phlegmatic',
    summary: 'Steady, kind, and easy to be with — Turtles keep the peace, share without a fight, and are loyal friends for life.',
    strengths: ['Calm in the storm', 'Kind and patient', 'Great sharer', 'Loyal friend'],
    growsIn: ['Speaking up for themselves', 'Trying brand-new things', 'Moving with hustle when needed'],
    parentTips: [
      'Invite their voice: "You pick tonight — and your pick counts."',
      'Nudge gently into new things; go with them the first time.',
      'Do not mistake quiet for not caring — Turtles feel deeply, softly.',
    ],
    teacherTip: 'Turtles will not raise their hand even when they know it. Draw them out one-on-one and give them time to answer.',
    verse: '"Blessed are the peacemakers, for they will be called children of God." — Matthew 5:9',
  },
}

export interface QuizOption {
  emoji: string
  label: string
  speech: string
  type: TemperamentId
}

export interface QuizQuestion {
  prompt: string
  speech: string
  a: QuizOption
  b: QuizOption
}

// 12 forced-choice pairs; every temperament appears in exactly 6 options.
export const QUIZ: QuizQuestion[] = [
  {
    prompt: 'At a birthday party, you like to…',
    speech: 'At a birthday party, do you run and play with everyone, or play with one best friend?',
    a: { emoji: '🎉', label: 'Play with EVERYONE', speech: 'play with everyone', type: 'parrot' },
    b: { emoji: '🧸', label: 'Play with one best friend', speech: 'play with one best friend', type: 'turtle' },
  },
  {
    prompt: 'When you build a block tower, you want it…',
    speech: 'When you build a block tower, do you want it super tall as fast as you can, or neat and just right?',
    a: { emoji: '🏗️', label: 'SUPER tall, super fast', speech: 'super tall super fast', type: 'lion' },
    b: { emoji: '📐', label: 'Neat and just right', speech: 'neat and just right', type: 'owl' },
  },
  {
    prompt: 'Your toys are usually…',
    speech: 'Are your toys usually everywhere because you are so busy playing, or lined up nice and neat?',
    a: { emoji: '🌪️', label: 'Everywhere — busy playing!', speech: 'everywhere because you are busy playing', type: 'parrot' },
    b: { emoji: '📚', label: 'Lined up nice and neat', speech: 'lined up nice and neat', type: 'owl' },
  },
  {
    prompt: 'When a game is really hard, you…',
    speech: 'When a game is really hard, do you keep trying until you win, or stay calm and take a break?',
    a: { emoji: '💪', label: 'Keep trying till I WIN', speech: 'keep trying until you win', type: 'lion' },
    b: { emoji: '😌', label: 'Stay calm, take a break', speech: 'stay calm and take a break', type: 'turtle' },
  },
  {
    prompt: 'With your friends, you love to…',
    speech: 'With your friends, do you love telling funny stories, or picking the game and leading it?',
    a: { emoji: '🤪', label: 'Tell funny stories', speech: 'tell funny stories', type: 'parrot' },
    b: { emoji: '🚩', label: 'Pick the game & lead it', speech: 'pick the game and lead it', type: 'lion' },
  },
  {
    prompt: 'At bedtime, you like things…',
    speech: 'At bedtime, do you like everything the same way every night, or is any cozy way just fine?',
    a: { emoji: '🌙', label: 'The SAME way every night', speech: 'the same way every night', type: 'owl' },
    b: { emoji: '🛏️', label: 'Any cozy way is fine', speech: 'any cozy way is fine', type: 'turtle' },
  },
  {
    prompt: 'A new kid comes to the playground. You…',
    speech: 'A new kid comes to the playground. Do you run right up and say hi, or smile and wave first?',
    a: { emoji: '👋', label: 'Run up and say HI!', speech: 'run right up and say hi', type: 'parrot' },
    b: { emoji: '🙂', label: 'Smile and wave first', speech: 'smile and wave first', type: 'turtle' },
  },
  {
    prompt: 'When you help with a job, you like to…',
    speech: 'When you help with a job, do you like being in charge of it, or making it careful and perfect?',
    a: { emoji: '👑', label: 'Be IN CHARGE of it', speech: 'be in charge of it', type: 'lion' },
    b: { emoji: '✨', label: 'Make it careful & perfect', speech: 'make it careful and perfect', type: 'owl' },
  },
  {
    prompt: 'Your drawing gets a big smudge on it. You…',
    speech: 'Your drawing gets a big smudge on it. Do you turn the smudge into something silly, or start over to make it right?',
    a: { emoji: '😂', label: 'Make the smudge silly!', speech: 'turn the smudge into something silly', type: 'parrot' },
    b: { emoji: '🎨', label: 'Start over, make it right', speech: 'start over to make it right', type: 'owl' },
  },
  {
    prompt: 'On a team, you want to be…',
    speech: 'On a team, do you want to be the captain, or the kind helper?',
    a: { emoji: '⭐', label: 'The CAPTAIN', speech: 'the captain', type: 'lion' },
    b: { emoji: '🤝', label: 'The kind helper', speech: 'the kind helper', type: 'turtle' },
  },
  {
    prompt: 'At show-and-tell, you would…',
    speech: 'At show and tell, would you make everybody laugh, or go first in line?',
    a: { emoji: '🎭', label: 'Make everybody laugh', speech: 'make everybody laugh', type: 'parrot' },
    b: { emoji: '🥇', label: 'Go FIRST in line', speech: 'go first in line', type: 'lion' },
  },
  {
    prompt: 'On a rainy day inside, you would rather…',
    speech: 'On a rainy day inside, would you rather sort and organize your treasures, or snuggle up and watch quietly?',
    a: { emoji: '🗂️', label: 'Sort my treasures', speech: 'sort and organize your treasures', type: 'owl' },
    b: { emoji: '🛋️', label: 'Snuggle and watch quietly', speech: 'snuggle up and watch quietly', type: 'turtle' },
  },
]

export interface PersonalityResult {
  takenAt: number
  scores: Record<TemperamentId, number>
  primary: TemperamentId
  secondary: TemperamentId
}

export interface PersonalityState {
  current: PersonalityResult
  history: PersonalityResult[]
}

export function scoreQuiz(picks: TemperamentId[]): PersonalityResult {
  const scores: Record<TemperamentId, number> = { lion: 0, parrot: 0, owl: 0, turtle: 0 }
  picks.forEach((t) => (scores[t] += 1))
  const ranked = (Object.keys(scores) as TemperamentId[]).sort((a, b) => scores[b] - scores[a])
  return { takenAt: Date.now(), scores, primary: ranked[0], secondary: ranked[1] }
}

/** suggest a retake every ~90 days — kids grow fast */
export const RETAKE_DAYS = 90

export function retakeDue(state: PersonalityState | undefined): boolean {
  if (!state) return true
  return Date.now() - state.current.takenAt > RETAKE_DAYS * 24 * 60 * 60 * 1000
}
