import React, { useState } from 'react';
import { StyleSheet, View, Text, FlatList, TouchableOpacity } from 'react-native';
import { useApp } from '../lib/AppContext';
import { GAMES_INFO } from '../data/mockData';
import { GameId } from '../types';

const MOCK_GLOBAL: Record<GameId, Array<{ rank: number; username: string; score: number; restArea: string }>> = {
  'trucker-tap': [
    { rank: 1, username: 'TokyoDrifter', score: 940, restArea: 'Ebina SA' },
    { rank: 2, username: 'MidnightRoller69', score: 820, restArea: 'Battle Mountain' },
    { rank: 3, username: 'Autobahn_Blitzen', score: 800, restArea: 'Grundbach' },
    { rank: 4, username: 'NashvilleNasty', score: 760, restArea: 'TN Welcome' },
    { rank: 5, username: 'DesertRat_TX', score: 700, restArea: 'Guadalupe Mtns' },
  ],
  'gas-guesser': [
    { rank: 1, username: 'GreenChileKing', score: 380, restArea: 'Painted Desert' },
    { rank: 2, username: 'FloridaManActual', score: 360, restArea: 'St. Augustine' },
    { rank: 3, username: 'SweetTeaSupreme', score: 340, restArea: 'Georgia Peach' },
    { rank: 4, username: 'TruckerPete', score: 300, restArea: 'Wyoming Winds' },
    { rank: 5, username: 'RouteNapoléon', score: 280, restArea: 'Aire de Ressons' },
  ],
  'bathroom-bingo': [
    { rank: 1, username: 'TokyoDrifter', score: 194, restArea: 'Ebina SA' },
    { rank: 2, username: 'TruckerPete', score: 170, restArea: 'Wyoming Winds' },
    { rank: 3, username: 'MidnightRoller69', score: 162, restArea: 'Battle Mountain' },
    { rank: 4, username: 'NashvilleNasty', score: 146, restArea: 'TN Welcome' },
    { rank: 5, username: 'FloridaManActual', score: 138, restArea: 'St. Augustine' },
  ],
};

const MEDAL: Record<number, string> = { 1: '🥇', 2: '🥈', 3: '🥉' };

export default function LeaderboardScreen() {
  const { profile, restAreas } = useApp();
  const [activeGame, setActiveGame] = useState<GameId>('trucker-tap');

  const crowns = restAreas.filter(r => r.king);

  return (
    <View style={styles.container}>
      <Text style={styles.screenTitle}>👑 Hall of Kings</Text>

      {/* Active crowns */}
      <Text style={styles.sectionTitle}>Current Kings</Text>
      <FlatList
        data={crowns}
        horizontal
        showsHorizontalScrollIndicator={false}
        keyExtractor={r => r.id}
        style={styles.crownScroll}
        contentContainerStyle={styles.crownScrollContent}
        renderItem={({ item }) => (
          <View style={styles.crownCard}>
            <Text style={styles.crownEmoji}>👑</Text>
            <Text style={styles.crownUser}>@{item.king!.username}</Text>
            <Text style={styles.crownPlace} numberOfLines={1}>{item.name}</Text>
            <Text style={styles.crownScore}>{item.king!.score.toLocaleString()}</Text>
          </View>
        )}
      />

      {/* Game selector */}
      <Text style={styles.sectionTitle}>Game Leaderboards</Text>
      <View style={styles.gameTabs}>
        {Object.values(GAMES_INFO).map(g => (
          <TouchableOpacity
            key={g.id}
            style={[styles.gameTab, activeGame === g.id && styles.gameTabActive, { borderColor: g.color }]}
            onPress={() => setActiveGame(g.id)}
          >
            <Text style={styles.gameTabEmoji}>{g.emoji}</Text>
            <Text style={[styles.gameTabName, activeGame === g.id && { color: g.color }]}>{g.name}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* Leaderboard */}
      <FlatList
        data={MOCK_GLOBAL[activeGame]}
        keyExtractor={item => item.username}
        renderItem={({ item }) => (
          <View style={[styles.row, profile?.username === item.username && styles.rowHighlight]}>
            <Text style={styles.rank}>{MEDAL[item.rank] ?? `#${item.rank}`}</Text>
            <View style={{ flex: 1 }}>
              <Text style={styles.rowUser}>
                @{item.username}
                {profile?.username === item.username ? ' (you)' : ''}
              </Text>
              <Text style={styles.rowPlace}>{item.restArea}</Text>
            </View>
            <Text style={styles.rowScore}>{item.score.toLocaleString()}</Text>
          </View>
        )}
        ItemSeparatorComponent={() => <View style={styles.sep} />}
        style={styles.list}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0f0f1e' },
  screenTitle: {
    color: '#f1f5f9',
    fontSize: 22,
    fontWeight: '800',
    padding: 16,
    paddingBottom: 8,
  },
  sectionTitle: {
    color: '#64748b',
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1,
    paddingHorizontal: 16,
    marginBottom: 8,
    marginTop: 8,
  },
  crownScroll: { maxHeight: 120 },
  crownScrollContent: { paddingHorizontal: 12, gap: 8 },
  crownCard: {
    backgroundColor: '#1e1e3a',
    borderRadius: 12,
    padding: 12,
    alignItems: 'center',
    width: 100,
    borderWidth: 1,
    borderColor: '#f59e0b44',
  },
  crownEmoji: { fontSize: 24 },
  crownUser: { color: '#f59e0b', fontSize: 11, fontWeight: '700', marginTop: 4 },
  crownPlace: { color: '#64748b', fontSize: 10, marginTop: 2, textAlign: 'center' },
  crownScore: { color: '#a855f7', fontSize: 13, fontWeight: '700', marginTop: 2 },
  gameTabs: { flexDirection: 'row', paddingHorizontal: 12, gap: 6, marginBottom: 8 },
  gameTab: {
    flex: 1,
    backgroundColor: '#1e1e3a',
    borderRadius: 10,
    padding: 8,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#2d2d5a',
  },
  gameTabActive: { backgroundColor: '#1a1a3e' },
  gameTabEmoji: { fontSize: 18 },
  gameTabName: { color: '#64748b', fontSize: 10, fontWeight: '600', marginTop: 2 },
  list: { flex: 1, paddingHorizontal: 12 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1e1e3a',
    borderRadius: 10,
    padding: 12,
    gap: 10,
  },
  rowHighlight: { borderWidth: 1, borderColor: '#7c3aed' },
  rank: { fontSize: 20, width: 32, textAlign: 'center' },
  rowUser: { color: '#f1f5f9', fontWeight: '600', fontSize: 14 },
  rowPlace: { color: '#64748b', fontSize: 11, marginTop: 2 },
  rowScore: { color: '#a855f7', fontSize: 18, fontWeight: '800' },
  sep: { height: 6 },
});
