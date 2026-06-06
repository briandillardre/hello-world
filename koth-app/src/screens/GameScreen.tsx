import React, { useCallback } from 'react';
import { StyleSheet, View } from 'react-native';
import { useRoute, useNavigation, RouteProp } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useApp } from '../lib/AppContext';
import { RootStackParamList, GameScore } from '../types';
import TruckerTapGame from '../games/TruckerTapGame';
import GasGuesserGame from '../games/GasGuesserGame';
import BathroomBingo from '../games/BathroomBingo';

type RouteT = RouteProp<RootStackParamList, 'Game'>;
type Nav = NativeStackNavigationProp<RootStackParamList>;

export default function GameScreen() {
  const route = useRoute<RouteT>();
  const navigation = useNavigation<Nav>();
  const { profile, recordScore } = useApp();
  const { gameId, restAreaId } = route.params;

  const handleComplete = useCallback(
    async (score: number) => {
      if (profile) {
        const gameScore: GameScore = {
          id: `score_${Date.now()}`,
          userId: profile.id,
          username: profile.username,
          gameId,
          restAreaId,
          score,
          timestamp: new Date().toISOString(),
        };
        await recordScore(gameScore, restAreaId);
      }
      navigation.goBack();
    },
    [profile, gameId, restAreaId, recordScore, navigation],
  );

  return (
    <View style={styles.container}>
      {gameId === 'trucker-tap' && (
        <TruckerTapGame restAreaId={restAreaId} onComplete={handleComplete} />
      )}
      {gameId === 'gas-guesser' && (
        <GasGuesserGame onComplete={handleComplete} />
      )}
      {gameId === 'bathroom-bingo' && (
        <BathroomBingo onComplete={handleComplete} />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0f0f1e' },
});
