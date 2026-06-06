import React, { useState, useRef, useCallback, useEffect } from 'react';
import { StyleSheet, View, Text, TouchableOpacity, Animated, Alert } from 'react-native';
import * as Haptics from 'expo-haptics';
import { useApp } from '../lib/AppContext';
import { GameScore } from '../types';

interface Props {
  restAreaId: string;
  onComplete: (score: number) => void;
}

const GAME_DURATION = 10;

export default function TruckerTapGame({ restAreaId, onComplete }: Props) {
  const { profile } = useApp();
  const [phase, setPhase] = useState<'ready' | 'playing' | 'done'>('ready');
  const [taps, setTaps] = useState(0);
  const [timeLeft, setTimeLeft] = useState(GAME_DURATION);
  const scaleAnim = useRef(new Animated.Value(1)).current;
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const startGame = useCallback(() => {
    setPhase('playing');
    setTaps(0);
    setTimeLeft(GAME_DURATION);
    timerRef.current = setInterval(() => {
      setTimeLeft(prev => {
        if (prev <= 1) {
          clearInterval(timerRef.current!);
          setPhase('done');
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
  }, []);

  useEffect(() => () => { if (timerRef.current) clearInterval(timerRef.current); }, []);

  const handleTap = useCallback(() => {
    if (phase !== 'playing') return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setTaps(t => t + 1);
    Animated.sequence([
      Animated.timing(scaleAnim, { toValue: 0.9, duration: 50, useNativeDriver: true }),
      Animated.timing(scaleAnim, { toValue: 1.0, duration: 50, useNativeDriver: true }),
    ]).start();
  }, [phase, scaleAnim]);

  const finalScore = Math.round(taps * 10);

  const grade = taps >= 80 ? '🔥 LEGENDARY' : taps >= 60 ? '💪 BEAST' : taps >= 40 ? '👌 SOLID' : taps >= 20 ? '😅 WARMING UP' : '🐌 GRANDMA SPEED';

  if (phase === 'ready') {
    return (
      <View style={styles.container}>
        <Text style={styles.emoji}>🚛</Text>
        <Text style={styles.title}>Trucker Tap</Text>
        <Text style={styles.subtitle}>
          Tap as fast as you can for {GAME_DURATION} seconds.{'\n'}Each tap = one lane change.{'\n'}Don't get flattened by a semi.
        </Text>
        <TouchableOpacity style={styles.startBtn} onPress={startGame}>
          <Text style={styles.startBtnText}>FLOOR IT →</Text>
        </TouchableOpacity>
      </View>
    );
  }

  if (phase === 'playing') {
    const urgentColor = timeLeft <= 3 ? '#ef4444' : timeLeft <= 5 ? '#f59e0b' : '#7c3aed';
    return (
      <View style={styles.container}>
        <View style={[styles.timerRing, { borderColor: urgentColor }]}>
          <Text style={[styles.timerNum, { color: urgentColor }]}>{timeLeft}</Text>
        </View>
        <Text style={styles.tapCount}>{taps}</Text>
        <Text style={styles.tapLabel}>lane changes</Text>
        <Animated.View style={{ transform: [{ scale: scaleAnim }] }}>
          <TouchableOpacity style={styles.tapBtn} onPress={handleTap} activeOpacity={0.7}>
            <Text style={styles.tapBtnText}>🚛</Text>
            <Text style={styles.tapBtnSub}>TAP!</Text>
          </TouchableOpacity>
        </Animated.View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Text style={styles.doneEmoji}>{taps >= 60 ? '🏆' : '🎯'}</Text>
      <Text style={styles.doneGrade}>{grade}</Text>
      <Text style={styles.doneTaps}>{taps} taps</Text>
      <Text style={styles.doneScore}>+{finalScore} points</Text>
      <Text style={styles.doneContext}>
        {taps >= 60 ? 'That\'s professional trucker speed!' :
         taps >= 40 ? 'Not bad for a civilian.' :
         taps >= 20 ? 'Did you drive here in a minivan?' :
         'Sir this is a rest stop, not a nap station.'}
      </Text>
      <TouchableOpacity style={styles.submitBtn} onPress={() => onComplete(finalScore)}>
        <Text style={styles.submitText}>Bank {finalScore} pts →</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, gap: 20 },
  emoji: { fontSize: 64 },
  title: { color: '#f1f5f9', fontSize: 28, fontWeight: '800' },
  subtitle: { color: '#94a3b8', fontSize: 16, textAlign: 'center', lineHeight: 24 },
  startBtn: {
    backgroundColor: '#f59e0b',
    borderRadius: 14,
    paddingVertical: 16,
    paddingHorizontal: 40,
    marginTop: 8,
  },
  startBtnText: { color: '#1a1a2e', fontWeight: '900', fontSize: 18, letterSpacing: 1 },
  timerRing: {
    width: 80,
    height: 80,
    borderRadius: 40,
    borderWidth: 4,
    alignItems: 'center',
    justifyContent: 'center',
  },
  timerNum: { fontSize: 32, fontWeight: '900' },
  tapCount: { color: '#f1f5f9', fontSize: 72, fontWeight: '900', lineHeight: 80 },
  tapLabel: { color: '#64748b', fontSize: 14, marginTop: -12 },
  tapBtn: {
    width: 180,
    height: 180,
    borderRadius: 90,
    backgroundColor: '#7c3aed',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#7c3aed',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.8,
    shadowRadius: 20,
    elevation: 12,
  },
  tapBtnText: { fontSize: 56 },
  tapBtnSub: { color: 'white', fontWeight: '900', fontSize: 20, letterSpacing: 2, marginTop: -4 },
  doneEmoji: { fontSize: 72 },
  doneGrade: { color: '#f59e0b', fontSize: 22, fontWeight: '800' },
  doneTaps: { color: '#f1f5f9', fontSize: 48, fontWeight: '900' },
  doneScore: { color: '#22c55e', fontSize: 24, fontWeight: '700' },
  doneContext: { color: '#64748b', fontSize: 14, textAlign: 'center' },
  submitBtn: {
    backgroundColor: '#7c3aed',
    borderRadius: 14,
    paddingVertical: 16,
    paddingHorizontal: 40,
  },
  submitText: { color: 'white', fontWeight: '800', fontSize: 16 },
});
