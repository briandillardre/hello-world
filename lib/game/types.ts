// Brain Ball — kids' adaptive learning game types

export type SkillId =
  | 'counting'
  | 'numbers'
  | 'addition'
  | 'letters'
  | 'sounds'
  | 'shapes'
  | 'words'

export interface SkillMeta {
  id: SkillId
  name: string
  emoji: string
  blurb: string
}

export interface Question {
  skill: SkillId
  /** difficulty of this specific question on the 1–99 scale */
  difficulty: number
  /** shown on screen (may contain emoji) */
  prompt: string
  /** read aloud via speech synthesis */
  speech: string
  /** big emoji/object row shown under the prompt (e.g. things to count) */
  visual?: string
  choices: string[]
  answer: number
  /** kid-friendly "here's why" for the end-of-round miss review */
  explain?: string
}

export interface MissedQuestion {
  skill: SkillId
  prompt: string
  visual?: string
  picked: string
  answer: string
  explain?: string
}

export interface AnswerRecord {
  /** epoch ms */
  t: number
  skill: SkillId
  difficulty: number
  correct: boolean
  /** time to answer, in ms */
  ms?: number
}

export interface SkillState {
  /** ability estimate, 1–99 */
  theta: number
  attempts: number
  correct: number
  bestStreak: number
}

export interface RoundResult {
  skill: SkillId | 'mix'
  total: number
  correct: number
  coinsEarned: number
  stars: 1 | 2 | 3
  bestStreak: number
  /** skill-level changes over this round (rounded start → end) */
  deltas?: Array<{ skill: SkillId; from: number; to: number }>
  /** questions missed this round, for the walk-through review */
  misses?: MissedQuestion[]
  /** random bonus coins from the 3-star mystery chest */
  chestBonus?: number
  /** this round paid double coins (first round of the day) */
  dailyDouble?: boolean
  /** daily-quest completion bonus granted with this round (set by the app shell) */
  questBonus?: number
  /** updated spaced-repetition queue after this round */
  reviewQueue?: ReviewItem[]
  /** count of ⚡ fast-answer bonuses earned this round */
  speedBonuses?: number
  /** count of 📖 answered-before-the-voice reading bonuses this round */
  readBonuses?: number
}

export interface ReviewItem {
  skill: SkillId
  difficulty: number
}

export interface KidProfile {
  id: string
  name: string
  /** ISO date */
  birthdate: string
  avatar: string
  coins: number
  xp: number
  stars: number
  ownedSkins: string[]
  activeSkin: string
  skills: Record<SkillId, SkillState>
  /** rolling answer log (capped) for trends */
  history: AnswerRecord[]
  roundsPlayed: number
  /** habit loop: local YYYY-MM-DD of last round, consecutive-day streak, rounds today */
  lastPlayedDay?: string
  dayStreak?: number
  roundsToday?: number
  /** day the daily quest reward was claimed */
  questClaimedDay?: string
  /** missed questions queued for spaced-repetition comebacks in Mix rounds */
  reviewQueue?: ReviewItem[]
  /** "Who Am I?" temperament quiz result + history (see lib/game/personality.ts) */
  personality?: import('./personality').PersonalityState
  /** grown-up test profile: separate scores, no age-norm percentiles */
  isTester?: boolean
}

export interface BallSkin {
  id: string
  name: string
  cost: number
  /** ball body gradient colors */
  colors: [string, string]
  /** optional emoji sticker drawn on the ball */
  emoji?: string
}
