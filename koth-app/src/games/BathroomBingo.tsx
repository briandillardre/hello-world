import React, { useState, useCallback } from 'react';
import { StyleSheet, View, Text, TouchableOpacity, ScrollView } from 'react-native';
import * as Haptics from 'expo-haptics';

interface Props {
  onComplete: (score: number) => void;
}

const BINGO_ITEMS = [
  '🧼 Out of soap', '🚿 Broken hand dryer', '🕳️ Gap in stall door', '💧 Mystery puddle',
  '📱 Phone left behind', '🪥 Someone\'s toothbrush', '🦟 Bug on ceiling', '✍️ Stall philosophy',
  '🔩 Missing stall door lock', '🧻 Empty TP roll still mounted', '🏛️ Ancient air freshener',
  '⚠️ "Wet Floor" sign (dry floor)', '🎵 Awkward radio choices', '🪞 Cracked mirror',
  '💡 One light out', '🚫 "Out of Order" sign', '🌡️ Temperature extreme', '👣 Footprint on seat',
  '🗑️ Overflowing trash', '📢 Very loud flush', '🪟 Window that doesn\'t close',
  '🤔 Vague mystery smell', '🐛 Insect friend', '🎨 Artistic stall graffiti',
];

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function checkBingo(checked: Set<number>, size: number): boolean {
  for (let row = 0; row < size; row++) {
    if ([...Array(size)].every((_, col) => checked.has(row * size + col))) return true;
  }
  for (let col = 0; col < size; col++) {
    if ([...Array(size)].every((_, row) => checked.has(row * size + col))) return true;
  }
  if ([...Array(size)].every((_, i) => checked.has(i * size + i))) return true;
  if ([...Array(size)].every((_, i) => checked.has(i * size + (size - 1 - i)))) return true;
  return false;
}

export default function BathroomBingo({ onComplete }: Props) {
  const GRID = 4;
  const [items] = useState(() => shuffle(BINGO_ITEMS).slice(0, GRID * GRID));
  const [checked, setChecked] = useState<Set<number>>(new Set());
  const [hasBingo, setHasBingo] = useState(false);
  const [phase, setPhase] = useState<'ready' | 'playing' | 'done'>('ready');

  const toggleItem = useCallback((idx: number) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setChecked(prev => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx);
      else next.add(idx);
      if (!hasBingo && checkBingo(next, GRID)) {
        setHasBingo(true);
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      }
      return next;
    });
  }, [hasBingo]);

  const handleSubmit = useCallback(() => {
    const baseScore = checked.size * 8;
    const bingoBonus = hasBingo ? 50 : 0;
    onComplete(baseScore + bingoBonus);
  }, [checked.size, hasBingo, onComplete]);

  const baseScore = checked.size * 8;
  const totalScore = baseScore + (hasBingo ? 50 : 0);

  if (phase === 'ready') {
    return (
      <View style={styles.container}>
        <Text style={styles.heroEmoji}>🚽</Text>
        <Text style={styles.title}>Bathroom Bingo</Text>
        <Text style={styles.subtitle}>
          Head into the bathroom.{'\n'}Check off everything you actually see.{'\n'}Get a BINGO = 50 bonus points.
        </Text>
        <View style={styles.ruleBox}>
          <Text style={styles.ruleTitle}>Rules</Text>
          <Text style={styles.rule}>✅ Each item found = 8 pts</Text>
          <Text style={styles.rule}>🎯 Bingo (row/col/diagonal) = +50 pts</Text>
          <Text style={styles.rule}>🤥 No lying. The bathroom gods are watching.</Text>
        </View>
        <TouchableOpacity style={styles.startBtn} onPress={() => setPhase('playing')}>
          <Text style={styles.startBtnText}>Enter the Throne Room →</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={styles.gameContainer}>
      {hasBingo && (
        <View style={styles.bingoBanner}>
          <Text style={styles.bingoText}>🎉 BINGO! +50 BONUS!</Text>
        </View>
      )}

      <View style={styles.scoreBar}>
        <Text style={styles.scoreBarText}>Found: {checked.size}/{items.length}</Text>
        <Text style={styles.scoreBarPts}>{totalScore} pts</Text>
      </View>

      <ScrollView contentContainerStyle={styles.grid}>
        {items.map((item, idx) => (
          <TouchableOpacity
            key={idx}
            style={[styles.cell, checked.has(idx) && styles.cellChecked]}
            onPress={() => toggleItem(idx)}
          >
            <Text style={styles.cellEmoji}>{item.split(' ')[0]}</Text>
            <Text style={[styles.cellText, checked.has(idx) && styles.cellTextChecked]}>
              {item.split(' ').slice(1).join(' ')}
            </Text>
            {checked.has(idx) && <Text style={styles.checkmark}>✓</Text>}
          </TouchableOpacity>
        ))}
      </ScrollView>

      <TouchableOpacity style={styles.submitBtn} onPress={handleSubmit}>
        <Text style={styles.submitText}>
          I Survived — Bank {totalScore} pts →
        </Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, gap: 16 },
  heroEmoji: { fontSize: 64 },
  title: { color: '#f1f5f9', fontSize: 28, fontWeight: '800' },
  subtitle: { color: '#94a3b8', fontSize: 15, textAlign: 'center', lineHeight: 22 },
  ruleBox: {
    backgroundColor: '#1e1e3a',
    borderRadius: 12,
    padding: 16,
    width: '100%',
    gap: 6,
    borderWidth: 1,
    borderColor: '#8b5cf6',
  },
  ruleTitle: { color: '#a855f7', fontWeight: '700', fontSize: 13, marginBottom: 2 },
  rule: { color: '#94a3b8', fontSize: 13 },
  startBtn: {
    backgroundColor: '#8b5cf6',
    borderRadius: 14,
    paddingVertical: 16,
    paddingHorizontal: 32,
    width: '100%',
    alignItems: 'center',
  },
  startBtnText: { color: 'white', fontWeight: '800', fontSize: 15 },
  gameContainer: { flex: 1, backgroundColor: '#0f0f1e' },
  bingoBanner: {
    backgroundColor: '#f59e0b',
    padding: 10,
    alignItems: 'center',
  },
  bingoText: { color: '#1a1a2e', fontWeight: '900', fontSize: 18, letterSpacing: 2 },
  scoreBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 12,
    backgroundColor: '#1e1e3a',
    borderBottomWidth: 1,
    borderBottomColor: '#2d2d5a',
  },
  scoreBarText: { color: '#94a3b8', fontSize: 14, fontWeight: '600' },
  scoreBarPts: { color: '#a855f7', fontSize: 18, fontWeight: '800' },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    padding: 8,
    gap: 4,
    justifyContent: 'center',
  },
  cell: {
    width: '23%',
    aspectRatio: 0.9,
    backgroundColor: '#1e1e3a',
    borderRadius: 8,
    padding: 6,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#2d2d5a',
    position: 'relative',
  },
  cellChecked: {
    backgroundColor: '#2d1b5e',
    borderColor: '#8b5cf6',
  },
  cellEmoji: { fontSize: 18, marginBottom: 2 },
  cellText: { color: '#64748b', fontSize: 9, textAlign: 'center', lineHeight: 12 },
  cellTextChecked: { color: '#c4b5fd' },
  checkmark: {
    position: 'absolute',
    top: 2,
    right: 4,
    color: '#22c55e',
    fontSize: 12,
    fontWeight: '900',
  },
  submitBtn: {
    backgroundColor: '#8b5cf6',
    margin: 12,
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: 'center',
  },
  submitText: { color: 'white', fontWeight: '800', fontSize: 14 },
});
