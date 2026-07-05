// Brain Ball — localStorage persistence, seeded with Marshall & Lincoln.

import { START_THETA } from './adaptive'
import type { BallSkin, KidProfile, SkillId, SkillState } from './types'

const STORAGE_KEY = 'hammertrack-brainball-v1'
const HISTORY_CAP = 500

export const BALL_SKINS: BallSkin[] = [
  { id: 'classic', name: 'Classic', cost: 0, colors: ['#fb923c', '#ea580c'] },
  { id: 'soccer', name: 'Soccer Ball', cost: 40, colors: ['#f8fafc', '#cbd5e1'], emoji: '⚽' },
  { id: 'basketball', name: 'B-Ball', cost: 60, colors: ['#fdba74', '#c2410c'], emoji: '🏀' },
  { id: 'earth', name: 'Planet Earth', cost: 90, colors: ['#7dd3fc', '#0369a1'], emoji: '🌍' },
  { id: 'cookie', name: 'Cookie', cost: 130, colors: ['#fcd34d', '#b45309'], emoji: '🍪' },
  { id: 'disco', name: 'Disco Ball', cost: 180, colors: ['#e9d5ff', '#7c3aed'], emoji: '🪩' },
  { id: 'whalehog', name: 'Whalehog', cost: 200, colors: ['#7dd3fc', '#f472b6'], emoji: '🐋' },
  { id: 'monster', name: 'Monster Eye', cost: 240, colors: ['#86efac', '#15803d'], emoji: '👁️' },
  { id: 'dragon', name: 'Dragon Egg', cost: 320, colors: ['#fca5a5', '#b91c1c'], emoji: '🐉' },
  { id: 'rainbow', name: 'Rainbow', cost: 420, colors: ['#f0abfc', '#4f46e5'], emoji: '🌈' },
  { id: 'rocket', name: 'Rocket', cost: 550, colors: ['#94a3b8', '#1e293b'], emoji: '🚀' },
]

const SKILL_IDS: SkillId[] = ['counting', 'numbers', 'addition', 'letters', 'sounds', 'shapes', 'words']

function freshSkillState(): SkillState {
  return { theta: START_THETA, attempts: 0, correct: 0, bestStreak: 0 }
}

function freshSkills(): Record<SkillId, SkillState> {
  return SKILL_IDS.reduce((acc, id) => {
    acc[id] = freshSkillState()
    return acc
  }, {} as Record<SkillId, SkillState>)
}

function makeKid(id: string, name: string, birthdate: string, avatar: string): KidProfile {
  return {
    id,
    name,
    birthdate,
    avatar,
    coins: 0,
    xp: 0,
    stars: 0,
    ownedSkins: ['classic'],
    activeSkin: 'classic',
    skills: freshSkills(),
    history: [],
    roundsPlayed: 0,
  }
}

export function defaultProfiles(): KidProfile[] {
  return [
    makeKid('marshall', 'Marshall', '2020-09-15', '🦖'),
    makeKid('lincoln', 'Lincoln', '2022-02-10', '🦁'),
  ]
}

export function loadProfiles(): KidProfile[] {
  if (typeof window === 'undefined') return defaultProfiles()
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return defaultProfiles()
    const parsed = JSON.parse(raw) as { profiles: KidProfile[] }
    if (!Array.isArray(parsed.profiles) || parsed.profiles.length === 0) return defaultProfiles()
    // merge any newly-added skills into stored profiles
    return parsed.profiles.map((p) => ({
      ...p,
      skills: { ...freshSkills(), ...p.skills },
      ownedSkins: p.ownedSkins?.length ? p.ownedSkins : ['classic'],
    }))
  } catch {
    return defaultProfiles()
  }
}

export function saveProfiles(profiles: KidProfile[]): void {
  if (typeof window === 'undefined') return
  try {
    const trimmed = profiles.map((p) => ({ ...p, history: p.history.slice(-HISTORY_CAP) }))
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ profiles: trimmed }))
  } catch {
    // storage full / private mode — play on without persistence
  }
}
