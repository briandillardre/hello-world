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
import { useRoute, useNavigation, RouteProp } from '@react-navigation/native';
import { useApp } from '../lib/AppContext';
import { RootStackParamList, Review } from '../types';

type RouteT = RouteProp<RootStackParamList, 'AddReview'>;

const EMOJIS = ['🚛', '💩', '🧻', '⛽', '🤠', '💨', '🦟', '🎸', '🍕', '🛞', '🪠', '🌵'];

function StarPicker({ value, onChange, label }: { value: number; onChange: (v: number) => void; label: string }) {
  return (
    <View style={styles.starPickerRow}>
      <Text style={styles.starPickerLabel}>{label}</Text>
      <View style={styles.starPickerStars}>
        {[1, 2, 3, 4, 5].map(n => (
          <TouchableOpacity key={n} onPress={() => onChange(n)}>
            <Text style={{ fontSize: 24 }}>{n <= value ? '⭐' : '☆'}</Text>
          </TouchableOpacity>
        ))}
      </View>
    </View>
  );
}

export default function AddReviewScreen() {
  const route = useRoute<RouteT>();
  const navigation = useNavigation();
  const { restAreas, profile, addReview } = useApp();
  const restArea = restAreas.find(r => r.id === route.params.restAreaId);

  const [overall, setOverall] = useState(3);
  const [cleanliness, setCleanliness] = useState(3);
  const [vending, setVending] = useState(3);
  const [vibes, setVibes] = useState(3);
  const [text, setText] = useState('');
  const [selectedEmoji, setSelectedEmoji] = useState<string | null>(null);

  if (!restArea) return null;

  const handleSubmit = async () => {
    if (!profile) {
      Alert.alert('No Profile', 'Set up a username in the Profile tab first!');
      return;
    }
    if (text.trim().length < 10) {
      Alert.alert('Too Short', 'Give us at least 10 characters. You have opinions. Share them.');
      return;
    }
    const review: Review = {
      id: `review_${Date.now()}`,
      restAreaId: restArea.id,
      userId: profile.id,
      username: profile.username,
      overallRating: overall,
      cleanlinessRating: cleanliness,
      vendingRating: vending,
      vibesRating: vibes,
      text: text.trim(),
      photoEmoji: selectedEmoji ?? undefined,
      upvotes: 0,
      timestamp: new Date().toISOString(),
    };
    await addReview(review);
    Alert.alert('Review Posted! 🎉', 'Your hot take has been immortalized.', [
      { text: 'OK', onPress: () => navigation.goBack() },
    ]);
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.title}>Review {restArea.name}</Text>
        <Text style={styles.subtitle}>Be honest. Be funny. Both preferred.</Text>

        <StarPicker label="Overall" value={overall} onChange={setOverall} />
        <StarPicker label="🧹 Cleanliness" value={cleanliness} onChange={setCleanliness} />
        <StarPicker label="🍫 Vending" value={vending} onChange={setVending} />
        <StarPicker label="✨ Vibes" value={vibes} onChange={setVibes} />

        <Text style={styles.sectionLabel}>Your Hot Take</Text>
        <TextInput
          style={styles.textInput}
          placeholder="Tell the people what they need to know..."
          placeholderTextColor="#4a5568"
          value={text}
          onChangeText={setText}
          multiline
          numberOfLines={4}
          maxLength={280}
        />
        <Text style={styles.charCount}>{text.length}/280</Text>

        <Text style={styles.sectionLabel}>Pick a Vibe Emoji</Text>
        <View style={styles.emojiRow}>
          {EMOJIS.map(e => (
            <TouchableOpacity
              key={e}
              style={[styles.emojiBtn, selectedEmoji === e && styles.emojiBtnSelected]}
              onPress={() => setSelectedEmoji(selectedEmoji === e ? null : e)}
            >
              <Text style={{ fontSize: 24 }}>{e}</Text>
            </TouchableOpacity>
          ))}
        </View>

        <TouchableOpacity style={styles.submitBtn} onPress={handleSubmit}>
          <Text style={styles.submitText}>Post Review →</Text>
        </TouchableOpacity>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0f0f1e' },
  content: { padding: 16, paddingBottom: 40, gap: 16 },
  title: { color: '#f1f5f9', fontSize: 20, fontWeight: '800' },
  subtitle: { color: '#64748b', fontSize: 13, marginTop: -8 },
  starPickerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#1e1e3a',
    borderRadius: 10,
    padding: 12,
  },
  starPickerLabel: { color: '#94a3b8', fontSize: 14, fontWeight: '500' },
  starPickerStars: { flexDirection: 'row', gap: 2 },
  sectionLabel: { color: '#64748b', fontSize: 11, fontWeight: '700', letterSpacing: 1 },
  textInput: {
    backgroundColor: '#1e1e3a',
    borderRadius: 12,
    padding: 14,
    color: '#f1f5f9',
    fontSize: 15,
    minHeight: 100,
    textAlignVertical: 'top',
    borderWidth: 1,
    borderColor: '#2d2d5a',
  },
  charCount: { color: '#4a5568', fontSize: 11, textAlign: 'right', marginTop: -8 },
  emojiRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  emojiBtn: {
    width: 48,
    height: 48,
    borderRadius: 10,
    backgroundColor: '#1e1e3a',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#2d2d5a',
  },
  emojiBtnSelected: { backgroundColor: '#2d1b5e', borderColor: '#7c3aed' },
  submitBtn: {
    backgroundColor: '#7c3aed',
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: 'center',
    marginTop: 8,
  },
  submitText: { color: 'white', fontWeight: '800', fontSize: 16 },
});
