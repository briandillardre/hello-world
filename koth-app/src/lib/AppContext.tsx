import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { UserProfile, GameScore, Review } from '../types';
import { UserLocation, getCurrentLocation, requestLocationPermission } from './location';
import {
  getProfile,
  createProfile as createProfileInStorage,
  addScore,
  addCheckIn,
  getLocalReviews,
  saveReview,
} from './storage';
import { MOCK_REST_AREAS, MOCK_REVIEWS } from '../data/mockData';
import type { RestArea, CheckIn } from '../types';

interface AppContextValue {
  profile: UserProfile | null;
  userLocation: UserLocation | null;
  restAreas: RestArea[];
  reviews: Review[];
  isLoadingProfile: boolean;
  createProfile: (username: string) => Promise<void>;
  recordScore: (score: GameScore, restAreaId: string) => Promise<void>;
  recordCheckIn: (checkIn: CheckIn) => Promise<void>;
  addReview: (review: Review) => Promise<void>;
  refreshLocation: () => Promise<void>;
}

const AppContext = createContext<AppContextValue | null>(null);

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [userLocation, setUserLocation] = useState<UserLocation | null>(null);
  const [reviews, setReviews] = useState<Review[]>([...MOCK_REVIEWS]);
  const [isLoadingProfile, setIsLoadingProfile] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const stored = await getProfile();
        setProfile(stored);
      } finally {
        setIsLoadingProfile(false);
      }
    })();
    (async () => {
      const local = await getLocalReviews();
      if (local.length > 0) setReviews([...local, ...MOCK_REVIEWS]);
    })();
    initLocation();
  }, []);

  async function initLocation() {
    try {
      const granted = await requestLocationPermission();
      if (granted) {
        const loc = await getCurrentLocation();
        setUserLocation(loc);
      }
    } catch {
      // Location is optional — the app still works without it.
    }
  }

  const refreshLocation = useCallback(async () => {
    const loc = await getCurrentLocation();
    setUserLocation(loc);
  }, []);

  const createProfile = useCallback(async (username: string) => {
    const p = await createProfileInStorage(username);
    setProfile(p);
  }, []);

  const recordScore = useCallback(
    async (score: GameScore, restAreaId: string) => {
      if (!profile) return;
      const updated = await addScore(profile, score, restAreaId);
      setProfile(updated);
    },
    [profile],
  );

  const recordCheckIn = useCallback(
    async (checkIn: CheckIn) => {
      if (!profile) return;
      const updated = await addCheckIn(profile, checkIn);
      setProfile(updated);
    },
    [profile],
  );

  const addReviewFn = useCallback(async (review: Review) => {
    await saveReview(review);
    setReviews(prev => [review, ...prev]);
  }, []);

  return (
    <AppContext.Provider
      value={{
        profile,
        userLocation,
        restAreas: MOCK_REST_AREAS,
        reviews,
        isLoadingProfile,
        createProfile,
        recordScore,
        recordCheckIn,
        addReview: addReviewFn,
        refreshLocation,
      }}
    >
      {children}
    </AppContext.Provider>
  );
}

export function useApp() {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useApp must be used within AppProvider');
  return ctx;
}
