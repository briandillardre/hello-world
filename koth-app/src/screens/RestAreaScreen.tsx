import React, { useState, useCallback } from 'react';
import {
  StyleSheet,
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  Alert,
  FlatList,
} from 'react-native';
import { useRoute, useNavigation, RouteProp } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useApp } from '../lib/AppContext';
import { isNearRestArea, CHECK_IN_RADIUS_KM, distanceBetween } from '../lib/location';
import { getRestAreaScore } from '../lib/storage';
import { RootStackParamList, GameId, CheckIn } from '../types';
import { GAMES_INFO } from '../data/mockData';

type RouteT = RouteProp<RootStackParamList, 'RestArea'>;
type Nav = NativeStackNavigationProp<RootStackParamList>;

function StarRow({ label, value }: { label: string; value: number }) {
  return (
    <View style={styles.starRow}>
      <Text style={styles.starLabel}>{label}</Text>
      <Text style={styles.stars}>{'⭐'.repeat(value)}{'☆'.repeat(5 - value)}</Text>
    </View>
  );
}

export default function RestAreaScreen() {
  const route = useRoute<RouteT>();
  const navigation = useNavigation<Nav>();
  const { restAreas, userLocation, profile, recordCheckIn, reviews } = useApp();
  const [activeTab, setActiveTab] = useState<'info' | 'reviews' | 'games'>('info');
  const [checkedIn, setCheckedIn] = useState(false);

  const restArea = restAreas.find(r => r.id === route.params.restAreaId);
  if (!restArea) return null;

  const areaReviews = reviews.filter(r => r.restAreaId === restArea.id);

  const distKm = userLocation
    ? distanceBetween(userLocation.lat, userLocation.lng, restArea.lat, restArea.lng)
    : null;
  const isNear = userLocation ? isNearRestArea(userLocation, restArea) : false;
  const myScore = profile ? getRestAreaScore(profile, restArea.id) : 0;

  const handleCheckIn = useCallback(async () => {
    if (!isNear) {
      Alert.alert(
        'Too Far Away',
        `You need to be within ${CHECK_IN_RADIUS_KM * 1000}m to check in. You're ${distKm ? (distKm * 1000).toFixed(0) : '?'}m away.`,
      );
      return;
    }
    if (!profile) {
      Alert.alert('No Profile', 'Set up a username in the Profile tab first!');
      return;
    }
    const checkIn: CheckIn = {
      restAreaId: restArea.id,
      timestamp: new Date().toISOString(),
      pointsEarned: 50,
    };
    await recordCheckIn(checkIn);
    setCheckedIn(true);
    Alert.alert('Checked In! 🎉', `+50 points for visiting ${restArea.name}!`);
  }, [isNear, profile, restArea, distKm, recordCheckIn]);

  const handlePlayGame = useCallback(
    (gameId: GameId) => {
      if (!isNear && !checkedIn) {
        Alert.alert(
          'You Have to Actually Be There',
          "No cheating! Drive to this rest area to play games. (Or hit Check In if you're there.)",
        );
        return;
      }
      navigation.navigate('Game', { gameId, restAreaId: restArea.id });
    },
    [isNear, checkedIn, navigation, restArea.id],
  );

  return (
    <View style={styles.container}>
      {/* Hero */}
      <View style={styles.hero}>
        <View style={styles.heroContent}>
          <Text style={styles.emoji}>{restArea.king ? '👑' : '🚻'}</Text>
          <View style={{ flex: 1 }}>
            <Text style={styles.name}>{restArea.name}</Text>
            <Text style={styles.highway}>
              {restArea.highway} {restArea.direction} · {restArea.state}, {restArea.country}
            </Text>
            {restArea.king && (
              <Text style={styles.kingTag}>
                👑 King: @{restArea.king.username} — {restArea.king.score.toLocaleString()} pts
              </Text>
            )}
          </View>
        </View>

        {/* Check-in button */}
        <TouchableOpacity
          style={[styles.checkInBtn, isNear && styles.checkInBtnActive, checkedIn && styles.checkInBtnDone]}
          onPress={checkedIn ? undefined : handleCheckIn}
        >
          <Text style={styles.checkInText}>
            {checkedIn
              ? '✅ Checked In! (+50 pts)'
              : isNear
              ? '📍 Check In Here'
              : distKm !== null
              ? `🛣 ${distKm < 1 ? (distKm * 1000).toFixed(0) + 'm away' : distKm.toFixed(1) + 'km away'}`
              : '📍 Check In'}
          </Text>
        </TouchableOpacity>
      </View>

      {/* Tabs */}
      <View style={styles.tabs}>
        {(['info', 'games', 'reviews'] as const).map(tab => (
          <TouchableOpacity
            key={tab}
            style={[styles.tab, activeTab === tab && styles.tabActive]}
            onPress={() => setActiveTab(tab)}
          >
            <Text style={[styles.tabText, activeTab === tab && styles.tabTextActive]}>
              {tab === 'info' ? 'Info' : tab === 'games' ? '🎮 Games' : `💬 Reviews (${areaReviews.length})`}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      <ScrollView style={styles.content} contentContainerStyle={styles.contentPad}>
        {activeTab === 'info' && (
          <>
            {/* Fun fact */}
            <View style={styles.funFactCard}>
              <Text style={styles.funFactLabel}>🎭 Fun Fact</Text>
              <Text style={styles.funFactText}>{restArea.funFact}</Text>
            </View>

            {/* Amenities */}
            <Text style={styles.sectionTitle}>Amenities</Text>
            <View style={styles.amenityRow}>
              {restArea.amenities.map(a => (
                <View key={a} style={styles.amenityChip}>
                  <Text style={styles.amenityText}>{a}</Text>
                </View>
              ))}
            </View>

            {/* Ratings */}
            <Text style={styles.sectionTitle}>Ratings</Text>
            <View style={styles.ratingCard}>
              <Text style={styles.ratingOverall}>{restArea.avgRating.toFixed(1)} / 5</Text>
              <Text style={styles.ratingCount}>from {restArea.reviewCount} reviews</Text>
              {restArea.topReview && (
                <Text style={styles.topReview}>"{restArea.topReview}"</Text>
              )}
            </View>

            {/* My score */}
            {profile && (
              <View style={styles.myScoreCard}>
                <Text style={styles.myScoreLabel}>Your Score Here (30-day)</Text>
                <Text style={styles.myScore}>{myScore.toLocaleString()} pts</Text>
                {restArea.king && restArea.king.userId !== profile.id && (
                  <Text style={styles.myScoreGap}>
                    {(restArea.king.score - myScore).toLocaleString()} pts behind the king
                  </Text>
                )}
              </View>
            )}
          </>
        )}

        {activeTab === 'games' && (
          <>
            <Text style={styles.gamesHint}>
              {isNear || checkedIn
                ? '🟢 You\'re here — all games unlocked!'
                : '🔒 Drive to this rest area to unlock games'}
            </Text>
            {Object.values(GAMES_INFO).map(game => (
              <TouchableOpacity
                key={game.id}
                style={[styles.gameCard, { borderColor: game.color }]}
                onPress={() => handlePlayGame(game.id)}
              >
                <Text style={styles.gameEmoji}>{game.emoji}</Text>
                <View style={{ flex: 1 }}>
                  <Text style={styles.gameName}>{game.name}</Text>
                  <Text style={styles.gameTagline}>{game.tagline}</Text>
                  <Text style={styles.gameDesc}>{game.description}</Text>
                </View>
                <Text style={styles.gameArrow}>▶</Text>
              </TouchableOpacity>
            ))}
            <TouchableOpacity
              style={styles.addReviewBtn}
              onPress={() => navigation.navigate('AddReview', { restAreaId: restArea.id })}
            >
              <Text style={styles.addReviewText}>📝 Leave a Review</Text>
            </TouchableOpacity>
          </>
        )}

        {activeTab === 'reviews' && (
          <>
            <TouchableOpacity
              style={styles.addReviewBtn}
              onPress={() => navigation.navigate('AddReview', { restAreaId: restArea.id })}
            >
              <Text style={styles.addReviewText}>✍️ Add Your Review</Text>
            </TouchableOpacity>
            {areaReviews.length === 0 && (
              <Text style={styles.emptyReviews}>No reviews yet. Be the first!</Text>
            )}
            {areaReviews.map(r => (
              <View key={r.id} style={styles.reviewCard}>
                <View style={styles.reviewHeader}>
                  <Text style={styles.reviewUser}>@{r.username}</Text>
                  {r.photoEmoji && <Text style={{ fontSize: 20 }}>{r.photoEmoji}</Text>}
                  <Text style={styles.reviewRating}>{'⭐'.repeat(r.overallRating)}</Text>
                </View>
                <Text style={styles.reviewText}>{r.text}</Text>
                <View style={styles.reviewFooter}>
                  <StarRow label="🧹" value={r.cleanlinessRating} />
                  <StarRow label="🍫" value={r.vendingRating} />
                  <StarRow label="✨" value={r.vibesRating} />
                  <Text style={styles.upvotes}>👍 {r.upvotes}</Text>
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
    backgroundColor: '#1e1e3a',
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#2d2d5a',
  },
  heroContent: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, marginBottom: 12 },
  emoji: { fontSize: 36 },
  name: { color: '#f1f5f9', fontSize: 18, fontWeight: '700' },
  highway: { color: '#94a3b8', fontSize: 13, marginTop: 2 },
  kingTag: { color: '#f59e0b', fontSize: 13, marginTop: 4, fontWeight: '600' },
  checkInBtn: {
    backgroundColor: '#2d2d5a',
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#4a4a8a',
  },
  checkInBtnActive: { backgroundColor: '#7c3aed', borderColor: '#a855f7' },
  checkInBtnDone: { backgroundColor: '#166534', borderColor: '#22c55e' },
  checkInText: { color: '#e2e8f0', fontWeight: '700', fontSize: 14 },
  tabs: { flexDirection: 'row', backgroundColor: '#1e1e3a', borderBottomWidth: 1, borderBottomColor: '#2d2d5a' },
  tab: { flex: 1, paddingVertical: 12, alignItems: 'center' },
  tabActive: { borderBottomWidth: 2, borderBottomColor: '#7c3aed' },
  tabText: { color: '#64748b', fontSize: 13, fontWeight: '500' },
  tabTextActive: { color: '#a855f7', fontWeight: '700' },
  content: { flex: 1 },
  contentPad: { padding: 16, paddingBottom: 40 },
  funFactCard: {
    backgroundColor: '#1e1e3a',
    borderRadius: 10,
    padding: 14,
    marginBottom: 16,
    borderLeftWidth: 3,
    borderLeftColor: '#f59e0b',
  },
  funFactLabel: { color: '#f59e0b', fontSize: 12, fontWeight: '700', marginBottom: 4 },
  funFactText: { color: '#cbd5e1', fontSize: 14, lineHeight: 20 },
  sectionTitle: { color: '#94a3b8', fontSize: 12, fontWeight: '700', letterSpacing: 1, marginBottom: 8, marginTop: 4 },
  amenityRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 16 },
  amenityChip: {
    backgroundColor: '#2d2d5a',
    borderRadius: 20,
    paddingHorizontal: 12,
    paddingVertical: 5,
  },
  amenityText: { color: '#cbd5e1', fontSize: 12 },
  ratingCard: {
    backgroundColor: '#1e1e3a',
    borderRadius: 10,
    padding: 14,
    marginBottom: 16,
    alignItems: 'center',
  },
  ratingOverall: { color: '#f59e0b', fontSize: 36, fontWeight: '800' },
  ratingCount: { color: '#64748b', fontSize: 12, marginTop: 2 },
  topReview: { color: '#94a3b8', fontSize: 13, fontStyle: 'italic', marginTop: 10, textAlign: 'center' },
  myScoreCard: {
    backgroundColor: '#1e1e3a',
    borderRadius: 10,
    padding: 14,
    borderWidth: 1,
    borderColor: '#4a4a8a',
    alignItems: 'center',
  },
  myScoreLabel: { color: '#94a3b8', fontSize: 12, marginBottom: 4 },
  myScore: { color: '#7c3aed', fontSize: 28, fontWeight: '800' },
  myScoreGap: { color: '#ef4444', fontSize: 12, marginTop: 4 },
  gamesHint: {
    color: '#94a3b8',
    fontSize: 13,
    textAlign: 'center',
    marginBottom: 16,
    backgroundColor: '#1e1e3a',
    borderRadius: 8,
    padding: 10,
  },
  gameCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1e1e3a',
    borderRadius: 12,
    padding: 14,
    marginBottom: 12,
    gap: 12,
    borderWidth: 1,
  },
  gameEmoji: { fontSize: 32 },
  gameName: { color: '#f1f5f9', fontSize: 16, fontWeight: '700' },
  gameTagline: { color: '#94a3b8', fontSize: 12, marginTop: 2 },
  gameDesc: { color: '#64748b', fontSize: 11, marginTop: 4 },
  gameArrow: { color: '#7c3aed', fontSize: 18 },
  addReviewBtn: {
    backgroundColor: '#1e1e3a',
    borderRadius: 10,
    padding: 14,
    alignItems: 'center',
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#4a4a8a',
  },
  addReviewText: { color: '#a855f7', fontWeight: '600', fontSize: 14 },
  emptyReviews: { color: '#64748b', textAlign: 'center', marginTop: 24, fontSize: 14 },
  reviewCard: {
    backgroundColor: '#1e1e3a',
    borderRadius: 10,
    padding: 14,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#2d2d5a',
  },
  reviewHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 },
  reviewUser: { color: '#a855f7', fontWeight: '700', fontSize: 13, flex: 1 },
  reviewRating: { fontSize: 12 },
  reviewText: { color: '#cbd5e1', fontSize: 14, lineHeight: 20, marginBottom: 8 },
  reviewFooter: { flexDirection: 'row', alignItems: 'center', gap: 10, flexWrap: 'wrap' },
  starRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  starLabel: { fontSize: 12 },
  stars: { fontSize: 10 },
  upvotes: { color: '#64748b', fontSize: 12, marginLeft: 'auto' },
});
