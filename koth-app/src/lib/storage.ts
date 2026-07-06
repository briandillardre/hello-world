import AsyncStorage from '@react-native-async-storage/async-storage';
import { UserProfile, GameScore, CheckIn, Review } from '../types';

const PROFILE_KEY = 'koth_profile_v2';
const REVIEWS_KEY = 'koth_reviews_v2';

export async function getProfile(): Promise<UserProfile | null> {
  try {
    const raw = await AsyncStorage.getItem(PROFILE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as UserProfile;
  } catch {
    return null;
  }
}

export async function saveProfile(profile: UserProfile): Promise<void> {
  await AsyncStorage.setItem(PROFILE_KEY, JSON.stringify(profile));
}

export async function createProfile(username: string): Promise<UserProfile> {
  const profile: UserProfile = {
    id: `local_${Date.now()}`,
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

export async function addScore(score: GameScore): Promise<UserProfile | null> {
  const profile = await getProfile();
  if (!profile) return null;
  profile.scores = [score, ...profile.scores].slice(0, 100);
  profile.totalScore += score.score;
  profile.gamesPlayed += 1;
  await saveProfile(profile);
  return profile;
}

export async function addCheckIn(checkIn: CheckIn): Promise<UserProfile | null> {
  const profile = await getProfile();
  if (!profile) return null;
  profile.checkIns = [checkIn, ...profile.checkIns];
  profile.totalScore += checkIn.pointsEarned;
  if (!profile.restAreasVisited.includes(checkIn.restAreaId)) {
    profile.restAreasVisited.push(checkIn.restAreaId);
  }
  await saveProfile(profile);
  return profile;
}

export async function getLocalReviews(): Promise<Review[]> {
  try {
    const raw = await AsyncStorage.getItem(REVIEWS_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as Review[];
  } catch {
    return [];
  }
}

export async function saveReview(review: Review): Promise<void> {
  const existing = await getLocalReviews();
  await AsyncStorage.setItem(REVIEWS_KEY, JSON.stringify([review, ...existing]));
}

export async function getRestAreaScore(userId: string, restAreaId: string): Promise<number> {
  const profile = await getProfile();
  if (!profile) return 0;
  const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;
  return profile.scores
    .filter(s => s.restAreaId === restAreaId && new Date(s.timestamp).getTime() > thirtyDaysAgo)
    .reduce((sum, s) => sum + s.score, 0);
}
