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
}

export interface AnswerRecord {
  /** epoch ms */
  t: number
  skill: SkillId
  difficulty: number
  correct: boolean
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
