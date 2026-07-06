import React, { createContext, useContext, useState, useEffect, useCallback, ReactNode } from 'react';
import { UserProfile, RestArea, Review, GameScore, CheckIn } from '../types';
import { MOCK_REST_AREAS, MOCK_REVIEWS } from '../data/mockData';
import * as storage from './storage';
import { requestLocationPermission, getCurrentLocation } from './location';

interface AppContextValue {
  profile: UserProfile | null;
  isLoadingProfile: boolean;
  userLocation: { lat: number; lng: number } | null;
  restAreas: RestArea[];
  reviews: Review[];
  createProfile: (username: string) => Promise<void>;
  recordScore: (score: GameScore) => Promise<void>;
  recordCheckIn: (checkIn: CheckIn) => Promise<void>;
  addReview: (review: Review) => Promise<void>;
  refreshLocation: () => Promise<void>;
}

const AppContext = createContext<AppContextValue | null>(null);

export function AppProvider({ children }: { children: ReactNode }) {
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [isLoadingProfile, setIsLoadingProfile] = useState(true);
  const [userLocation, setUserLocation] = useState<{ lat: number; lng: number } | null>(null);
  const [reviews, setReviews] = useState<Review[]>(MOCK_REVIEWS);

  useEffect(() => {
    storage.getProfile().then(p => {
      setProfile(p);
      setIsLoadingProfile(false);
    });
    storage.getLocalReviews().then(localReviews => {
      if (localReviews.length > 0) {
        setReviews(prev => [...localReviews, ...prev]);
      }
    });
    initLocation();
  }, []);

  async function initLocation() {
    const granted = await requestLocationPermission();
    if (granted) {
      const loc = await getCurrentLocation();
      if (loc) setUserLocation(loc);
    }
  }

  const refreshLocation = useCallback(async () => {
    const loc = await getCurrentLocation();
    if (loc) setUserLocation(loc);
  }, []);

  const createProfile = useCallback(async (username: string) => {
    const p = await storage.createProfile(username);
    setProfile(p);
  }, []);

  const recordScore = useCallback(async (score: GameScore) => {
    const updated = await storage.addScore(score);
    if (updated) setProfile(updated);
  }, []);

  const recordCheckIn = useCallback(async (checkIn: CheckIn) => {
    const updated = await storage.addCheckIn(checkIn);
    if (updated) setProfile(updated);
  }, []);

  const addReview = useCallback(async (review: Review) => {
    await storage.saveReview(review);
    setReviews(prev => [review, ...prev]);
  }, []);

  return (
    <AppContext.Provider
      value={{
        profile,
        isLoadingProfile,
        userLocation,
        restAreas: MOCK_REST_AREAS,
        reviews,
        createProfile,
        recordScore,
        recordCheckIn,
        addReview,
        refreshLocation,
      }}
    >
      {children}
    </AppContext.Provider>
  );
}

export function useApp(): AppContextValue {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useApp must be used inside AppProvider');
  return ctx;
}
