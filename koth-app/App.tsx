import 'react-native-url-polyfill/auto';
import React from 'react';
import { StatusBar } from 'expo-status-bar';
import { NavigationContainer } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { AppProvider } from './src/lib/AppContext';
import MapScreen from './src/screens/MapScreen';
import RestAreaScreen from './src/screens/RestAreaScreen';
import GameScreen from './src/screens/GameScreen';
import LeaderboardScreen from './src/screens/LeaderboardScreen';
import ProfileScreen from './src/screens/ProfileScreen';
import AddReviewScreen from './src/screens/AddReviewScreen';
import { RootStackParamList, TabParamList } from './src/types';

const Stack = createNativeStackNavigator<RootStackParamList>();
const Tab = createBottomTabNavigator<TabParamList>();

const THEME = {
  dark: true,
  colors: {
    primary: '#7c3aed',
    background: '#0f0f1e',
    card: '#1e1e3a',
    text: '#f1f5f9',
    border: '#2d2d5a',
    notification: '#7c3aed',
  },
};

function TabNavigator() {
  return (
    <Tab.Navigator
      screenOptions={{
        headerShown: false,
        tabBarStyle: {
          backgroundColor: '#1e1e3a',
          borderTopColor: '#2d2d5a',
          paddingBottom: 8,
          height: 64,
        },
        tabBarActiveTintColor: '#a855f7',
        tabBarInactiveTintColor: '#4a5568',
        tabBarLabelStyle: { fontSize: 11, fontWeight: '600' },
      }}
    >
      <Tab.Screen
        name="Map"
        component={MapScreen}
        options={{
          tabBarLabel: 'Map',
          tabBarIcon: ({ focused }) => (
            <Text style={{ fontSize: 22 }}>{focused ? '🗺️' : '🗺'}</Text>
          ),
        }}
      />
      <Tab.Screen
        name="Leaderboard"
        component={LeaderboardScreen}
        options={{
          tabBarLabel: 'Hall of Kings',
          tabBarIcon: ({ focused }) => (
            <Text style={{ fontSize: 22 }}>{focused ? '👑' : '🏅'}</Text>
          ),
        }}
      />
      <Tab.Screen
        name="Profile"
        component={ProfileScreen}
        options={{
          tabBarLabel: 'My Kingdom',
          tabBarIcon: ({ focused }) => (
            <Text style={{ fontSize: 22 }}>{focused ? '🧑‍🤴' : '👤'}</Text>
          ),
        }}
      />
    </Tab.Navigator>
  );
}

interface ErrorBoundaryState {
  error: Error | null;
}

class ErrorBoundary extends React.Component<{ children: React.ReactNode }, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  render() {
    if (this.state.error) {
      return (
        <View style={errorStyles.container}>
          <Text style={errorStyles.emoji}>🚧</Text>
          <Text style={errorStyles.title}>Wrong exit!</Text>
          <Text style={errorStyles.message}>
            Something went sideways: {this.state.error.message}
          </Text>
          <TouchableOpacity
            style={errorStyles.button}
            onPress={() => this.setState({ error: null })}
          >
            <Text style={errorStyles.buttonText}>Back on the Road →</Text>
          </TouchableOpacity>
        </View>
      );
    }
    return this.props.children;
  }
}

const errorStyles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0f0f1e',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
    gap: 12,
  },
  emoji: { fontSize: 56 },
  title: { color: '#f1f5f9', fontSize: 22, fontWeight: '800' },
  message: { color: '#94a3b8', fontSize: 14, textAlign: 'center', lineHeight: 20 },
  button: {
    backgroundColor: '#7c3aed',
    borderRadius: 12,
    paddingVertical: 14,
    paddingHorizontal: 32,
    marginTop: 8,
  },
  buttonText: { color: 'white', fontWeight: '700', fontSize: 15 },
});

export default function App() {
  return (
    <SafeAreaProvider>
      <ErrorBoundary>
        <AppProvider>
          <NavigationContainer theme={THEME}>
            <StatusBar style="light" />
            <Stack.Navigator
              screenOptions={{
                headerStyle: { backgroundColor: '#1e1e3a' },
                headerTintColor: '#f1f5f9',
                headerTitleStyle: { fontWeight: '700' },
                contentStyle: { backgroundColor: '#0f0f1e' },
              }}
            >
              <Stack.Screen name="Main" component={TabNavigator} options={{ headerShown: false }} />
              <Stack.Screen
                name="RestArea"
                component={RestAreaScreen}
                options={{ title: 'Rest Stop', headerBackTitle: 'Map' }}
              />
              <Stack.Screen
                name="Game"
                component={GameScreen}
                options={({ route }) => ({
                  title: route.params.gameId === 'trucker-tap'
                    ? '🚛 Trucker Tap'
                    : route.params.gameId === 'gas-guesser'
                    ? '⛽ Gas Guessr'
                    : '🚽 Bathroom Bingo',
                  headerBackTitle: 'Back',
                })}
              />
              <Stack.Screen
                name="AddReview"
                component={AddReviewScreen}
                options={{ title: '✍️ Write a Review', headerBackTitle: 'Back' }}
              />
            </Stack.Navigator>
          </NavigationContainer>
        </AppProvider>
      </ErrorBoundary>
    </SafeAreaProvider>
  );
}
