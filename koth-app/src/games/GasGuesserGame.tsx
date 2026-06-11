import React, { useState, useCallback } from 'react';
import { StyleSheet, View, Text, TouchableOpacity } from 'react-native';
import Slider from '@react-native-community/slider';
import * as Haptics from 'expo-haptics';

interface Props {
  onComplete: (score: number) => void;
}

const GAS_ROUNDS = [
  { state: 'California', city: 'Los Angeles', brand: 'Shell', actual: 4.89, note: 'LA never misses a chance to charge more.' },
  { state: 'Tennessee', city: 'Nashville', brand: 'Pilot', actual: 3.19, note: 'Tennessee: God\'s country and cheap gas.' },
  { state: 'Hawaii', city: 'Honolulu', brand: 'Chevron', actual: 5.49, note: 'It\'s an island. They shipped the gas by boat.' },
  { state: 'Texas', city: 'Houston', brand: 'Exxon', actual: 2.99, note: 'Texas has oil. Texas charges less for it. Wild.' },
  { state: 'New York', city: 'Manhattan', brand: 'BP', actual: 5.19, note: 'The taxi driver ahead of you bought it all anyway.' },
  { state: 'Wyoming', city: 'Casper', brand: 'Maverick', actual: 3.09, note: 'Middle of nowhere. Surprisingly decent price.' },
  { state: 'Germany', city: 'Munich', brand: 'ARAL', actual: 6.80, note: 'Converted from €/liter. You\'re welcome.' },
  { state: 'Nevada', city: 'Las Vegas', brand: 'Terrible Herbst', actual: 4.29, note: 'The casinos own this too.' },
];

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export default function GasGuesserGame({ onComplete }: Props) {
  const [rounds] = useState(() => shuffle(GAS_ROUNDS).slice(0, 4));
  const [roundIndex, setRoundIndex] = useState(0);
  const [guess, setGuess] = useState(3.50);
  const [revealed, setRevealed] = useState(false);
  const [roundScores, setRoundScores] = useState<number[]>([]);
  const [phase, setPhase] = useState<'ready' | 'playing' | 'done'>('ready');

  const round = rounds[roundIndex];

  const handleReveal = useCallback(() => {
    if (revealed) return;
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    const diff = Math.abs(guess - round.actual);
    const pts = Math.max(0, Math.round(100 - diff * 80));
    setRoundScores(prev => [...prev, pts]);
    setRevealed(true);
  }, [revealed, guess, round]);

  const handleNext = useCallback(() => {
    if (roundIndex < rounds.length - 1) {
      setRoundIndex(i => i + 1);
      setGuess(3.50);
      setRevealed(false);
    } else {
      setPhase('done');
    }
  }, [roundIndex, rounds.length]);

  const totalScore = roundScores.reduce((a, b) => a + b, 0);

  if (phase === 'ready') {
    return (
      <View style={styles.container}>
        <Text style={styles.heroEmoji}>⛽</Text>
        <Text style={styles.title}>Gas Guessr</Text>
        <Text style={styles.subtitle}>
          We show you a gas station.{'\n'}You guess the price per gallon.{'\n'}4 rounds. Closest = most points.
        </Text>
        <TouchableOpacity style={styles.startBtn} onPress={() => setPhase('playing')}>
          <Text style={styles.startBtnText}>Start Pumping →</Text>
        </TouchableOpacity>
      </View>
    );
  }

  if (phase === 'done') {
    const avg = roundScores.length ? totalScore / roundScores.length : 0;
    const verdict =
      avg >= 80 ? '🧠 Gas Station Genius' :
      avg >= 60 ? '📊 Solid Road Economist' :
      avg >= 40 ? '🤷 Average American' :
      '😭 You clearly don\'t pump your own gas';

    return (
      <View style={styles.container}>
        <Text style={styles.heroEmoji}>🏆</Text>
        <Text style={styles.verdict}>{verdict}</Text>
        <View style={styles.roundBreakdown}>
          {roundScores.map((s, i) => (
            <View key={i} style={styles.roundRow}>
              <Text style={styles.roundLabel}>Round {i + 1}</Text>
              <Text style={[styles.roundPts, { color: s >= 80 ? '#22c55e' : s >= 50 ? '#f59e0b' : '#ef4444' }]}>
                +{s}
              </Text>
            </View>
          ))}
        </View>
        <Text style={styles.totalScore}>Total: {totalScore} pts</Text>
        <TouchableOpacity style={styles.submitBtn} onPress={() => onComplete(totalScore)}>
          <Text style={styles.submitText}>Bank {totalScore} pts →</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const diff = Math.abs(guess - round.actual);
  const revealedPts = revealed ? Math.max(0, Math.round(100 - diff * 80)) : null;

  return (
    <View style={styles.container}>
      <Text style={styles.roundCounter}>Round {roundIndex + 1} / {rounds.length}</Text>
      <View style={styles.stationCard}>
        <Text style={styles.stationBrand}>{round.brand}</Text>
        <Text style={styles.stationLocation}>📍 {round.city}, {round.state}</Text>
        {revealed && <Text style={styles.stationNote}>{round.note}</Text>}
      </View>

      <View style={styles.sliderSection}>
        <Text style={styles.guessLabel}>Your guess:</Text>
        <Text style={styles.guessValue}>${guess.toFixed(2)}/gal</Text>
        <Slider
          key={roundIndex}
          style={styles.slider}
          minimumValue={2.00}
          maximumValue={7.00}
          step={0.01}
          value={3.50}
          onValueChange={setGuess}
          minimumTrackTintColor="#7c3aed"
          maximumTrackTintColor="#2d2d5a"
          thumbTintColor="#a855f7"
          disabled={revealed}
        />
        <View style={styles.sliderLabels}>
          <Text style={styles.sliderMin}>$2.00</Text>
          <Text style={styles.sliderMax}>$7.00</Text>
        </View>
      </View>

      {revealed ? (
        <View style={styles.revealBox}>
          <Text style={styles.actualLabel}>Actual Price</Text>
          <Text style={styles.actualPrice}>${round.actual.toFixed(2)}</Text>
          <Text style={[styles.diffText, { color: diff < 0.20 ? '#22c55e' : diff < 0.50 ? '#f59e0b' : '#ef4444' }]}>
            {diff < 0.01 ? '🎯 EXACT!' : `Off by $${diff.toFixed(2)}`}
          </Text>
          <Text style={styles.revealedPts}>+{revealedPts} pts</Text>
          <TouchableOpacity style={styles.nextBtn} onPress={handleNext}>
            <Text style={styles.nextBtnText}>
              {roundIndex < rounds.length - 1 ? 'Next Round →' : 'See Results →'}
            </Text>
          </TouchableOpacity>
        </View>
      ) : (
        <TouchableOpacity style={styles.revealBtn} onPress={handleReveal}>
          <Text style={styles.revealBtnText}>Lock In ${guess.toFixed(2)} →</Text>
        </TouchableOpacity>
      )}

      <View style={styles.scoreRow}>
        {roundScores.map((s, i) => (
          <View key={i} style={[styles.scoreDot, { backgroundColor: s >= 80 ? '#22c55e' : s >= 50 ? '#f59e0b' : '#ef4444' }]}>
            <Text style={styles.scoreDotText}>{s}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, gap: 16 },
  heroEmoji: { fontSize: 64 },
  title: { color: '#f1f5f9', fontSize: 28, fontWeight: '800' },
  subtitle: { color: '#94a3b8', fontSize: 15, textAlign: 'center', lineHeight: 22 },
  startBtn: { backgroundColor: '#3b82f6', borderRadius: 14, paddingVertical: 16, paddingHorizontal: 40 },
  startBtnText: { color: 'white', fontWeight: '800', fontSize: 16 },
  roundCounter: { color: '#64748b', fontSize: 13, fontWeight: '600' },
  stationCard: {
    backgroundColor: '#1e1e3a',
    borderRadius: 14,
    padding: 20,
    width: '100%',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#3b82f6',
  },
  stationBrand: { color: '#f1f5f9', fontSize: 24, fontWeight: '800', marginBottom: 4 },
  stationLocation: { color: '#94a3b8', fontSize: 15 },
  stationNote: { color: '#64748b', fontSize: 12, marginTop: 8, textAlign: 'center', fontStyle: 'italic' },
  sliderSection: { width: '100%', alignItems: 'center' },
  guessLabel: { color: '#94a3b8', fontSize: 13 },
  guessValue: { color: '#f1f5f9', fontSize: 36, fontWeight: '900', marginBottom: 4 },
  slider: { width: '100%', height: 40 },
  sliderLabels: { flexDirection: 'row', justifyContent: 'space-between', width: '100%', marginTop: -8 },
  sliderMin: { color: '#64748b', fontSize: 11 },
  sliderMax: { color: '#64748b', fontSize: 11 },
  revealBtn: { backgroundColor: '#3b82f6', borderRadius: 14, paddingVertical: 14, paddingHorizontal: 32, width: '100%', alignItems: 'center' },
  revealBtnText: { color: 'white', fontWeight: '800', fontSize: 15 },
  revealBox: { backgroundColor: '#1e1e3a', borderRadius: 14, padding: 20, width: '100%', alignItems: 'center', gap: 6, borderWidth: 1, borderColor: '#22c55e' },
  actualLabel: { color: '#94a3b8', fontSize: 12 },
  actualPrice: { color: '#22c55e', fontSize: 36, fontWeight: '900' },
  diffText: { fontSize: 16, fontWeight: '700' },
  revealedPts: { color: '#a855f7', fontSize: 22, fontWeight: '800' },
  nextBtn: { backgroundColor: '#7c3aed', borderRadius: 10, paddingVertical: 10, paddingHorizontal: 28, marginTop: 4 },
  nextBtnText: { color: 'white', fontWeight: '700', fontSize: 14 },
  scoreRow: { flexDirection: 'row', gap: 10, marginTop: 4 },
  scoreDot: { borderRadius: 20, width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  scoreDotText: { color: '#1a1a2e', fontWeight: '900', fontSize: 12 },
  verdict: { color: '#f59e0b', fontSize: 20, fontWeight: '800', textAlign: 'center' },
  roundBreakdown: { backgroundColor: '#1e1e3a', borderRadius: 12, padding: 16, width: '100%', gap: 8 },
  roundRow: { flexDirection: 'row', justifyContent: 'space-between' },
  roundLabel: { color: '#94a3b8', fontSize: 14 },
  roundPts: { fontSize: 14, fontWeight: '700' },
  totalScore: { color: '#f1f5f9', fontSize: 28, fontWeight: '900' },
  submitBtn: { backgroundColor: '#3b82f6', borderRadius: 14, paddingVertical: 14, paddingHorizontal: 40 },
  submitText: { color: 'white', fontWeight: '800', fontSize: 15 },
});
