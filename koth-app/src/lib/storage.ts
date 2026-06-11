import AsyncStorage from '@react-native-async-storage/async-storage';
import { UserProfile, GameScore, Review, CheckIn } from '../types';

const KEYS = {
  PROFILE: 'koth_profile',
  REVIEWS: 'koth_reviews',
};

export async function getProfile(): Promise<UserProfile | null> {
  try {
    const raw = await AsyncStorage.getItem(KEYS.PROFILE);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export async function saveProfile(profile: UserProfile): Promise<void> {
  await AsyncStorage.setItem(KEYS.PROFILE, JSON.stringify(profile));
}

export async function createProfile(username: string): Promise<UserProfile> {
  const profile: UserProfile = {
    id: `user_${Date.now()}`,
    username,
    totalScore: 0,
    crownCount: 0,
    gamesPlayed: 0,
    restAreasVisited: [],
    joinDate: new Date().toISOString(),
    scores: [],
    checkIns: [],
  };
  await saveProfile(profile);
  return profile;
}

export async function addScore(
  profile: UserProfile,
  score: GameScore,
  restAreaId: string,
): Promise<UserProfile> {
  const updated: UserProfile = {
    ...profile,
    totalScore: profile.totalScore + score.score,
    gamesPlayed: profile.gamesPlayed + 1,
    scores: [score, ...profile.scores].slice(0, 100),
    restAreasVisited: profile.restAreasVisited.includes(restAreaId)
      ? profile.restAreasVisited
      : [...profile.restAreasVisited, restAreaId],
  };
  await saveProfile(updated);
  return updated;
}

export async function addCheckIn(profile: UserProfile, checkIn: CheckIn): Promise<UserProfile> {
  const updated: UserProfile = {
    ...profile,
    checkIns: [checkIn, ...profile.checkIns].slice(0, 200),
    restAreasVisited: profile.restAreasVisited.includes(checkIn.restAreaId)
      ? profile.restAreasVisited
      : [...profile.restAreasVisited, checkIn.restAreaId],
  };
  await saveProfile(updated);
  return updated;
}

export async function getLocalReviews(): Promise<Review[]> {
  try {
    const raw = await AsyncStorage.getItem(KEYS.REVIEWS);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export async function saveReview(review: Review): Promise<void> {
  const existing = await getLocalReviews();
  await AsyncStorage.setItem(KEYS.REVIEWS, JSON.stringify([review, ...existing]));
}

export function getRestAreaScore(profile: UserProfile, restAreaId: string): number {
  const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
  return profile.scores
    .filter(s => s.restAreaId === restAreaId && new Date(s.timestamp).getTime() > cutoff)
    .reduce((sum, s) => sum + s.score, 0);
}
