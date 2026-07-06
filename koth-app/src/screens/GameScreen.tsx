import React, { useCallback } from 'react';
import { View, StyleSheet, Alert } from 'react-native';
import { useRoute, useNavigation, RouteProp } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useApp } from '../lib/AppContext';
import { RootStackParamList } from '../types';
import TruckerTapGame from '../games/TruckerTapGame';
import GasGuesserGame from '../games/GasGuesserGame';
import BathroomBingo from '../games/BathroomBingo';

type Route = RouteProp<RootStackParamList, 'Game'>;
type Nav = NativeStackNavigationProp<RootStackParamList>;

export default function GameScreen() {
  const route = useRoute<Route>();
  const navigation = useNavigation<Nav>();
  const { profile, recordScore } = useApp();
  const { gameId, restAreaId } = route.params;

  const handleComplete = useCallback(
    async (score: number) => {
      if (profile) {
        await recordScore({
          id: `${Date.now()}`,
          userId: profile.id,
          username: profile.username,
          gameId,
          restAreaId,
          score,
          timestamp: new Date().toISOString(),
        });
      }
      Alert.alert('Score saved!', `+${score} points added to your total.`, [
        { text: 'Back to rest area', onPress: () => navigation.goBack() },
      ]);
    },
    [profile, recordScore, gameId, restAreaId, navigation],
  );

  return (
    <View style={styles.container}>
      {gameId === 'trucker-tap' && <TruckerTapGame onComplete={handleComplete} />}
      {gameId === 'gas-guesser' && <GasGuesserGame onComplete={handleComplete} />}
      {gameId === 'bathroom-bingo' && <BathroomBingo onComplete={handleComplete} />}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0f0f1e' },
});
