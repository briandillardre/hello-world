import React, { useState } from 'react';
import {
  StyleSheet,
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  Alert,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { useApp } from '../lib/AppContext';
import { GAMES_INFO } from '../data/mockData';

export default function ProfileScreen() {
  const { profile, createProfile, restAreas } = useApp();
  const [inputName, setInputName] = useState('');

  if (!profile) {
    return (
      <KeyboardAvoidingView
        style={styles.setupContainer}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <Text style={styles.setupEmoji}>👑</Text>
        <Text style={styles.setupTitle}>Claim Your Name</Text>
        <Text style={styles.setupSub}>
          Pick a username to start claiming thrones at rest areas worldwide.
        </Text>
        <TextInput
          style={styles.nameInput}
          placeholder="TruckerKing69..."
          placeholderTextColor="#4a5568"
          value={inputName}
          onChangeText={setInputName}
          maxLength={20}
          autoCapitalize="none"
          autoCorrect={false}
        />
        <TouchableOpacity
          style={[styles.claimBtn, !inputName.trim() && styles.claimBtnDisabled]}
          onPress={() => {
            if (!inputName.trim()) return;
            createProfile(inputName.trim()).catch(() =>
              Alert.alert('Error', 'Failed to create profile'),
            );
          }}
          disabled={!inputName.trim()}
        >
          <Text style={styles.claimBtnText}>Seize the Crown →</Text>
        </TouchableOpacity>
        <Text style={styles.setupDisclaimer}>
          Stored locally. No account needed.{'\n'}
          Multiplayer leaderboards coming soon.
        </Text>
      </KeyboardAvoidingView>
    );
  }

  const recentScores = profile.scores.slice(0, 10);
  const visitedAreas = restAreas.filter(r => profile.restAreasVisited.includes(r.id));
  const myKingdoms = restAreas.filter(r => r.king?.userId === profile.id);

  const gameBreakdown = Object.values(GAMES_INFO).map(g => {
    const gamePlays = profile.scores.filter(s => s.gameId === g.id);
    const best = gamePlays.length ? Math.max(...gamePlays.map(s => s.score)) : 0;
    return { ...g, plays: gamePlays.length, best };
  });

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      {/* Header */}
      <View style={styles.header}>
        <View style={styles.avatarCircle}>
          <Text style={styles.avatarText}>{profile.username[0].toUpperCase()}</Text>
        </View>
        <View>
          <Text style={styles.username}>@{profile.username}</Text>
          <Text style={styles.joinDate}>
            Royalty since {new Date(profile.joinDate).toLocaleDateString()}
          </Text>
        </View>
      </View>

      {/* Stats grid */}
      <View style={styles.statsGrid}>
        {[
          { label: 'Total Score', value: profile.totalScore.toLocaleString(), emoji: '🏅' },
          { label: 'Games Played', value: profile.gamesPlayed.toString(), emoji: '🎮' },
          { label: 'Stops Visited', value: visitedAreas.length.toString(), emoji: '📍' },
          { label: 'Crowns Held', value: myKingdoms.length.toString(), emoji: '👑' },
        ].map(stat => (
          <View key={stat.label} style={styles.statCard}>
            <Text style={styles.statEmoji}>{stat.emoji}</Text>
            <Text style={styles.statValue}>{stat.value}</Text>
            <Text style={styles.statLabel}>{stat.label}</Text>
          </View>
        ))}
      </View>

      {/* My kingdoms */}
      {myKingdoms.length > 0 && (
        <>
          <Text style={styles.sectionTitle}>👑 My Kingdoms</Text>
          {myKingdoms.map(ra => (
            <View key={ra.id} style={styles.kingdomCard}>
              <Text style={styles.kingdomEmoji}>👑</Text>
              <View style={{ flex: 1 }}>
                <Text style={styles.kingdomName}>{ra.name}</Text>
                <Text style={styles.kingdomHighway}>{ra.highway} · {ra.state}</Text>
              </View>
              <Text style={styles.kingdomScore}>{ra.king!.score.toLocaleString()}</Text>
            </View>
          ))}
        </>
      )}

      {/* Game stats */}
      <Text style={styles.sectionTitle}>🎮 Game Stats</Text>
      {gameBreakdown.map(g => (
        <View key={g.id} style={[styles.gameStatCard, { borderLeftColor: g.color }]}>
          <Text style={styles.gameStatEmoji}>{g.emoji}</Text>
          <View style={{ flex: 1 }}>
            <Text style={styles.gameStatName}>{g.name}</Text>
            <Text style={styles.gameStatSub}>{g.plays} games played</Text>
          </View>
          <View style={styles.gameStatRight}>
            <Text style={styles.gameStatBestLabel}>Best</Text>
            <Text style={[styles.gameStatBest, { color: g.color }]}>{g.best}</Text>
          </View>
        </View>
      ))}

      {/* Recent scores */}
      {recentScores.length > 0 && (
        <>
          <Text style={styles.sectionTitle}>Recent Games</Text>
          {recentScores.map((s, i) => (
            <View key={s.id ?? i} style={styles.scoreRow}>
              <Text style={styles.scoreGameEmoji}>{GAMES_INFO[s.gameId]?.emoji ?? '🎮'}</Text>
              <View style={{ flex: 1 }}>
                <Text style={styles.scoreGame}>{GAMES_INFO[s.gameId]?.name ?? s.gameId}</Text>
                <Text style={styles.scoreTimestamp}>
                  {new Date(s.timestamp).toLocaleDateString()}
                </Text>
              </View>
              <Text style={styles.scoreValue}>+{s.score}</Text>
            </View>
          ))}
        </>
      )}

      {recentScores.length === 0 && (
        <View style={styles.emptyState}>
          <Text style={styles.emptyEmoji}>🛣️</Text>
          <Text style={styles.emptyText}>Get on the road!{'\n'}Check in at a rest area to start playing.</Text>
        </View>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0f0f1e' },
  content: { padding: 16, paddingBottom: 40 },
  setupContainer: { flex: 1, backgroundColor: '#0f0f1e', alignItems: 'center', justifyContent: 'center', padding: 24, gap: 16 },
  setupEmoji: { fontSize: 72 },
  setupTitle: { color: '#f1f5f9', fontSize: 28, fontWeight: '800' },
  setupSub: { color: '#94a3b8', fontSize: 15, textAlign: 'center', lineHeight: 22 },
  nameInput: {
    backgroundColor: '#1e1e3a',
    borderRadius: 12,
    padding: 16,
    color: '#f1f5f9',
    fontSize: 18,
    fontWeight: '600',
    width: '100%',
    borderWidth: 1,
    borderColor: '#4a4a8a',
    textAlign: 'center',
  },
  claimBtn: {
    backgroundColor: '#7c3aed',
    borderRadius: 14,
    paddingVertical: 16,
    paddingHorizontal: 40,
    width: '100%',
    alignItems: 'center',
  },
  claimBtnDisabled: { backgroundColor: '#2d2d5a' },
  claimBtnText: { color: 'white', fontWeight: '800', fontSize: 16 },
  setupDisclaimer: { color: '#4a5568', fontSize: 12, textAlign: 'center' },
  header: { flexDirection: 'row', alignItems: 'center', gap: 14, marginBottom: 20 },
  avatarCircle: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: '#7c3aed',
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: { color: 'white', fontSize: 26, fontWeight: '800' },
  username: { color: '#f1f5f9', fontSize: 20, fontWeight: '800' },
  joinDate: { color: '#64748b', fontSize: 12, marginTop: 2 },
  statsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 20 },
  statCard: {
    flex: 1,
    minWidth: '45%',
    backgroundColor: '#1e1e3a',
    borderRadius: 12,
    padding: 14,
    alignItems: 'center',
    gap: 4,
    borderWidth: 1,
    borderColor: '#2d2d5a',
  },
  statEmoji: { fontSize: 24 },
  statValue: { color: '#f1f5f9', fontSize: 22, fontWeight: '800' },
  statLabel: { color: '#64748b', fontSize: 11 },
  sectionTitle: { color: '#64748b', fontSize: 11, fontWeight: '700', letterSpacing: 1, marginBottom: 8, marginTop: 4 },
  kingdomCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1e1e3a',
    borderRadius: 10,
    padding: 12,
    marginBottom: 8,
    gap: 10,
    borderWidth: 1,
    borderColor: '#f59e0b44',
  },
  kingdomEmoji: { fontSize: 24 },
  kingdomName: { color: '#f1f5f9', fontSize: 14, fontWeight: '600' },
  kingdomHighway: { color: '#64748b', fontSize: 12, marginTop: 2 },
  kingdomScore: { color: '#f59e0b', fontSize: 16, fontWeight: '700' },
  gameStatCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1e1e3a',
    borderRadius: 10,
    padding: 12,
    marginBottom: 8,
    gap: 10,
    borderLeftWidth: 3,
  },
  gameStatEmoji: { fontSize: 22 },
  gameStatName: { color: '#f1f5f9', fontSize: 14, fontWeight: '600' },
  gameStatSub: { color: '#64748b', fontSize: 12, marginTop: 1 },
  gameStatRight: { alignItems: 'center' },
  gameStatBestLabel: { color: '#64748b', fontSize: 10 },
  gameStatBest: { fontSize: 20, fontWeight: '800' },
  scoreRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1e1e3a',
    borderRadius: 10,
    padding: 10,
    marginBottom: 6,
    gap: 10,
  },
  scoreGameEmoji: { fontSize: 20 },
  scoreGame: { color: '#f1f5f9', fontSize: 13, fontWeight: '600' },
  scoreTimestamp: { color: '#64748b', fontSize: 11, marginTop: 1 },
  scoreValue: { color: '#22c55e', fontSize: 16, fontWeight: '700' },
  emptyState: { alignItems: 'center', paddingTop: 40, gap: 12 },
  emptyEmoji: { fontSize: 48 },
  emptyText: { color: '#64748b', fontSize: 14, textAlign: 'center', lineHeight: 22 },
});
