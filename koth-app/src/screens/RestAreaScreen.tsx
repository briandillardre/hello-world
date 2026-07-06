import React, { useState, useCallback } from 'react';
import {
  StyleSheet, View, Text, ScrollView, TouchableOpacity, Alert,
} from 'react-native';
import { useRoute, useNavigation, RouteProp } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useApp } from '../lib/AppContext';
import { RootStackParamList, GameId } from '../types';
import { GAMES_INFO } from '../data/mockData';
import { distanceBetween, CHECK_IN_RADIUS_KM } from '../lib/location';

type Nav = NativeStackNavigationProp<RootStackParamList>;
type Route = RouteProp<RootStackParamList, 'RestArea'>;

const TABS = ['Info', 'Games', 'Reviews'] as const;
type Tab = typeof TABS[number];

function Stars({ rating }: { rating: number }) {
  return (
    <Text>
      {[1, 2, 3, 4, 5].map(i => (
        <Text key={i} style={{ color: i <= Math.round(rating) ? '#f59e0b' : '#374151' }}>★</Text>
      ))}
    </Text>
  );
}

export default function RestAreaScreen() {
  const route = useRoute<Route>();
  const navigation = useNavigation<Nav>();
  const { restAreas, reviews, profile, userLocation, recordCheckIn } = useApp();
  const [activeTab, setActiveTab] = useState<Tab>('Info');
  const [checkedIn, setCheckedIn] = useState(false);

  const restArea = restAreas.find(r => r.id === route.params.restAreaId);
  if (!restArea) return null;

  const areaReviews = reviews.filter(r => r.restAreaId === restArea.id);
  const distanceKm = userLocation
    ? distanceBetween(userLocation.lat, userLocation.lng, restArea.lat, restArea.lng)
    : null;
  const distanceText = distanceKm != null
    ? distanceKm < 1 ? `${Math.round(distanceKm * 1000)}m away` : `${distanceKm.toFixed(1)}km away`
    : 'Location unknown';
  const canCheckIn = distanceKm != null && distanceKm <= CHECK_IN_RADIUS_KM;

  const handleCheckIn = useCallback(async () => {
    if (!profile) { Alert.alert('No profile', 'Set a username in My Kingdom first.'); return; }
    if (!canCheckIn) { Alert.alert('Too far', `You need to be within 500m. You are ${distanceText}.`); return; }
    await recordCheckIn({ restAreaId: restArea.id, timestamp: new Date().toISOString(), pointsEarned: 50 });
    setCheckedIn(true);
    Alert.alert('Checked in! 👑', '+50 points. Now go play some games.');
  }, [profile, canCheckIn, distanceText, restArea.id, recordCheckIn]);

  const myScore = profile?.scores
    .filter(s => s.restAreaId === restArea.id)
    .reduce((sum, s) => sum + s.score, 0) ?? 0;

  const isKing = restArea.king?.userId === profile?.id;

  return (
    <View style={styles.container}>
      {/* Hero */}
      <View style={styles.hero}>
        <View style={styles.heroLeft}>
          <Text style={styles.heroName}>{restArea.name}</Text>
          <Text style={styles.heroSub}>{restArea.highway} · {restArea.state} · {restArea.country}</Text>
          {restArea.king && (
            <Text style={styles.kingBadge}>
              👑 {isKing ? 'YOU ARE THE KING' : `@${restArea.king.username}`} · {restArea.king.score.toLocaleString()} pts
            </Text>
          )}
        </View>
        <TouchableOpacity
          style={[styles.checkInBtn, (checkedIn || isKing) && styles.checkInBtnDone, canCheckIn && !checkedIn && styles.checkInBtnReady]}
          onPress={handleCheckIn}
          disabled={checkedIn || isKing}
        >
          <Text style={styles.checkInBtnText}>{checkedIn || isKing ? '✓ In' : '📍 Check In'}</Text>
          <Text style={styles.checkInDist}>{distanceText}</Text>
        </TouchableOpacity>
      </View>

      {/* Tabs */}
      <View style={styles.tabs}>
        {TABS.map(t => (
          <TouchableOpacity key={t} style={[styles.tab, activeTab === t && styles.tabActive]} onPress={() => setActiveTab(t)}>
            <Text style={[styles.tabText, activeTab === t && styles.tabTextActive]}>{t}</Text>
          </TouchableOpacity>
        ))}
      </View>

      <ScrollView style={styles.content} contentContainerStyle={{ padding: 16, paddingBottom: 40 }}>
        {activeTab === 'Info' && (
          <>
            <View style={styles.card}>
              <Text style={styles.label}>FUN FACT</Text>
              <Text style={styles.funFact}>{restArea.funFact}</Text>
            </View>
            <View style={styles.card}>
              <Text style={styles.label}>AMENITIES</Text>
              <View style={styles.chips}>
                {restArea.amenities.map(a => (
                  <View key={a} style={styles.chip}><Text style={styles.chipText}>{a}</Text></View>
                ))}
              </View>
            </View>
            <View style={styles.card}>
              <Text style={styles.label}>RATINGS</Text>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 4 }}>
                <Stars rating={restArea.avgRating} />
                <Text style={{ color: '#94a3b8', fontSize: 13 }}>{restArea.avgRating.toFixed(1)} ({restArea.reviewCount} reviews)</Text>
              </View>
            </View>
            {myScore > 0 && (
              <View style={styles.card}>
                <Text style={styles.label}>MY SCORE HERE</Text>
                <Text style={{ color: '#a855f7', fontSize: 28, fontWeight: '800', marginTop: 4 }}>{myScore.toLocaleString()} pts</Text>
                {restArea.king && myScore < restArea.king.score && (
                  <Text style={{ color: '#64748b', fontSize: 12, marginTop: 4 }}>
                    {(restArea.king.score - myScore).toLocaleString()} pts behind the king
                  </Text>
                )}
              </View>
            )}
          </>
        )}

        {activeTab === 'Games' && (
          <>
            {!checkedIn && !isKing && (
              <View style={styles.lockBanner}>
                <Text style={styles.lockText}>📍 Check in first to play games{'\n'}(must be within 500m of this rest area)</Text>
              </View>
            )}
            {Object.values(GAMES_INFO).map(g => (
              <TouchableOpacity
                key={g.id}
                style={[styles.gameCard, { borderLeftColor: g.color }, (!checkedIn && !isKing) && styles.gameCardLocked]}
                onPress={() => {
                  if (!checkedIn && !isKing) { Alert.alert('Check in first', 'You need to be at this rest area.'); return; }
                  navigation.navigate('Game', { gameId: g.id as GameId, restAreaId: restArea.id });
                }}
              >
                <Text style={styles.gameEmoji}>{g.emoji}</Text>
                <View style={{ flex: 1 }}>
                  <Text style={styles.gameName}>{g.name}</Text>
                  <Text style={styles.gameTagline}>{g.tagline}</Text>
                </View>
                <Text style={{ color: g.color, fontSize: 20 }}>›</Text>
              </TouchableOpacity>
            ))}
          </>
        )}

        {activeTab === 'Reviews' && (
          <>
            <TouchableOpacity
              style={styles.writeReviewBtn}
              onPress={() => {
                if (!profile) { Alert.alert('No profile', 'Set a username in My Kingdom first.'); return; }
                navigation.navigate('AddReview', { restAreaId: restArea.id });
              }}
            >
              <Text style={styles.writeReviewText}>✍️ Write a Review</Text>
            </TouchableOpacity>
            {areaReviews.length === 0 && (
              <Text style={styles.emptyReviews}>No reviews yet. Be the first brave soul.</Text>
            )}
            {areaReviews.map(r => (
              <View key={r.id} style={styles.reviewCard}>
                <View style={styles.reviewHeader}>
                  <Text style={styles.reviewUser}>@{r.username}</Text>
                  {r.photoEmoji && <Text style={{ fontSize: 20 }}>{r.photoEmoji}</Text>}
                  <Stars rating={r.overallRating} />
                </View>
                <Text style={styles.reviewText}>{r.text}</Text>
                <View style={styles.reviewRatings}>
                  {(['cleanlinessRating', 'vendingRating', 'vibesRating'] as const).map((k, i) => (
                    <View key={k} style={styles.miniRating}>
                      <Text style={styles.miniRatingLabel}>{['🧼', '🍫', '✨'][i]}</Text>
                      <Text style={styles.miniRatingVal}>{r[k]}/5</Text>
                    </View>
                  ))}
                </View>
              </View>
            ))}
          </>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0f0f1e' },
  hero: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    padding: 16,
    backgroundColor: '#1e1e3a',
    borderBottomWidth: 1,
    borderBottomColor: '#2d2d5a',
    gap: 12,
  },
  heroLeft: { flex: 1, gap: 4 },
  heroName: { color: '#f1f5f9', fontSize: 18, fontWeight: '800' },
  heroSub: { color: '#64748b', fontSize: 12 },
  kingBadge: { color: '#f59e0b', fontSize: 12, fontWeight: '700', marginTop: 4 },
  checkInBtn: {
    backgroundColor: '#1a1a3e',
    borderRadius: 10,
    padding: 10,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#2d2d5a',
    minWidth: 90,
  },
  checkInBtnReady: { borderColor: '#22c55e', backgroundColor: '#052e16' },
  checkInBtnDone: { borderColor: '#7c3aed', backgroundColor: '#2e1065' },
  checkInBtnText: { color: '#f1f5f9', fontSize: 13, fontWeight: '700' },
  checkInDist: { color: '#64748b', fontSize: 10, marginTop: 2 },
  tabs: { flexDirection: 'row', backgroundColor: '#1e1e3a', borderBottomWidth: 1, borderBottomColor: '#2d2d5a' },
  tab: { flex: 1, paddingVertical: 12, alignItems: 'center' },
  tabActive: { borderBottomWidth: 2, borderBottomColor: '#7c3aed' },
  tabText: { color: '#64748b', fontSize: 13, fontWeight: '600' },
  tabTextActive: { color: '#a855f7' },
  content: { flex: 1 },
  card: { backgroundColor: '#1e1e3a', borderRadius: 12, padding: 14, marginBottom: 12, borderWidth: 1, borderColor: '#2d2d5a' },
  label: { color: '#64748b', fontSize: 10, fontWeight: '700', letterSpacing: 1, marginBottom: 6 },
  funFact: { color: '#94a3b8', fontSize: 14, lineHeight: 20 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 4 },
  chip: { backgroundColor: '#2d2d5a', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 4 },
  chipText: { color: '#94a3b8', fontSize: 11 },
  lockBanner: {
    backgroundColor: '#1c1c2e',
    borderRadius: 12,
    padding: 16,
    alignItems: 'center',
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#374151',
  },
  lockText: { color: '#64748b', fontSize: 13, textAlign: 'center', lineHeight: 20 },
  gameCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1e1e3a',
    borderRadius: 12,
    padding: 14,
    marginBottom: 10,
    borderLeftWidth: 4,
    gap: 12,
  },
  gameCardLocked: { opacity: 0.5 },
  gameEmoji: { fontSize: 28 },
  gameName: { color: '#f1f5f9', fontSize: 15, fontWeight: '700' },
  gameTagline: { color: '#64748b', fontSize: 12, marginTop: 2 },
  writeReviewBtn: {
    backgroundColor: '#7c3aed',
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
    marginBottom: 14,
  },
  writeReviewText: { color: 'white', fontWeight: '800', fontSize: 14 },
  emptyReviews: { color: '#4a5568', textAlign: 'center', marginTop: 24, fontSize: 14 },
  reviewCard: {
    backgroundColor: '#1e1e3a',
    borderRadius: 12,
    padding: 14,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: '#2d2d5a',
    gap: 8,
  },
  reviewHeader: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  reviewUser: { color: '#a855f7', fontSize: 13, fontWeight: '700', flex: 1 },
  reviewText: { color: '#94a3b8', fontSize: 13, lineHeight: 19 },
  reviewRatings: { flexDirection: 'row', gap: 12 },
  miniRating: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  miniRatingLabel: { fontSize: 14 },
  miniRatingVal: { color: '#64748b', fontSize: 12 },
});
