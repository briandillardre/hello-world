import React, { useState } from 'react';
import {
  StyleSheet, View, Text, TextInput, TouchableOpacity,
  ScrollView, Alert, KeyboardAvoidingView, Platform,
} from 'react-native';
import { useRoute, useNavigation, RouteProp } from '@react-navigation/native';
import { useApp } from '../lib/AppContext';
import { RootStackParamList } from '../types';

type Route = RouteProp<RootStackParamList, 'AddReview'>;

const VIBES = ['😍', '😊', '😐', '😬', '💀', '🤠', '🚛', '🏆', '🌵', '🌄', '🦅', '🐔'];

function StarPicker({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  return (
    <View style={styles.starRow}>
      <Text style={styles.starLabel}>{label}</Text>
      <View style={{ flexDirection: 'row', gap: 6 }}>
        {[1, 2, 3, 4, 5].map(i => (
          <TouchableOpacity key={i} onPress={() => onChange(i)}>
            <Text style={{ fontSize: 24, color: i <= value ? '#f59e0b' : '#374151' }}>★</Text>
          </TouchableOpacity>
        ))}
      </View>
    </View>
  );
}

export default function AddReviewScreen() {
  const route = useRoute<Route>();
  const navigation = useNavigation();
  const { profile, addReview, restAreas } = useApp();
  const [overall, setOverall] = useState(3);
  const [cleanliness, setCleanliness] = useState(3);
  const [vending, setVending] = useState(3);
  const [vibes, setVibes] = useState(3);
  const [text, setText] = useState('');
  const [selectedEmoji, setSelectedEmoji] = useState<string | undefined>(undefined);
  const [submitting, setSubmitting] = useState(false);

  const restArea = restAreas.find(r => r.id === route.params.restAreaId);

  const handleSubmit = async () => {
    if (!profile) return;
    if (text.trim().length < 10) {
      Alert.alert('Too short', 'Write at least 10 characters — give the people something.');
      return;
    }
    setSubmitting(true);
    await addReview({
      id: `rev_${Date.now()}`,
      restAreaId: route.params.restAreaId,
      userId: profile.id,
      username: profile.username,
      overallRating: overall,
      cleanlinessRating: cleanliness,
      vendingRating: vending,
      vibesRating: vibes,
      text: text.trim(),
      photoEmoji: selectedEmoji,
      upvotes: 0,
      timestamp: new Date().toISOString(),
    });
    setSubmitting(false);
    Alert.alert('Review posted! 🎉', 'Your wisdom lives on.', [
      { text: 'Done', onPress: () => navigation.goBack() },
    ]);
  };

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: '#0f0f1e' }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView contentContainerStyle={styles.content}>
        {restArea && <Text style={styles.restAreaName}>{restArea.name}</Text>}

        <StarPicker label="Overall" value={overall} onChange={setOverall} />
        <StarPicker label="Cleanliness 🧼" value={cleanliness} onChange={setCleanliness} />
        <StarPicker label="Vending 🍫" value={vending} onChange={setVending} />
        <StarPicker label="Vibes ✨" value={vibes} onChange={setVibes} />

        <Text style={styles.label}>YOUR REVIEW</Text>
        <TextInput
          style={styles.textInput}
          value={text}
          onChangeText={setText}
          multiline
          numberOfLines={4}
          placeholder="What did you witness here today?"
          placeholderTextColor="#4a5568"
          maxLength={280}
        />
        <Text style={styles.charCount}>{text.length}/280</Text>

        <Text style={styles.label}>VIBE PHOTO</Text>
        <View style={styles.emojiGrid}>
          {VIBES.map(e => (
            <TouchableOpacity
              key={e}
              style={[styles.emojiBtn, selectedEmoji === e && styles.emojiBtnSelected]}
              onPress={() => setSelectedEmoji(selectedEmoji === e ? undefined : e)}
            >
              <Text style={{ fontSize: 24 }}>{e}</Text>
            </TouchableOpacity>
          ))}
        </View>

        <TouchableOpacity
          style={[styles.submitBtn, submitting && { opacity: 0.6 }]}
          onPress={handleSubmit}
          disabled={submitting}
        >
          <Text style={styles.submitText}>{submitting ? 'Posting...' : 'Post Review →'}</Text>
        </TouchableOpacity>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  content: { padding: 16, gap: 12, paddingBottom: 40 },
  restAreaName: { color: '#64748b', fontSize: 13, fontWeight: '600', marginBottom: 4 },
  starRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: '#1e1e3a', borderRadius: 10, padding: 12 },
  starLabel: { color: '#94a3b8', fontSize: 14 },
  label: { color: '#64748b', fontSize: 10, fontWeight: '700', letterSpacing: 1, marginTop: 4 },
  textInput: {
    backgroundColor: '#1e1e3a', borderRadius: 12, padding: 14, color: '#f1f5f9',
    fontSize: 14, lineHeight: 20, minHeight: 100, textAlignVertical: 'top',
    borderWidth: 1, borderColor: '#2d2d5a',
  },
  charCount: { color: '#4a5568', fontSize: 11, textAlign: 'right', marginTop: -8 },
  emojiGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  emojiBtn: { backgroundColor: '#1e1e3a', borderRadius: 10, padding: 8, borderWidth: 1, borderColor: '#2d2d5a' },
  emojiBtnSelected: { borderColor: '#7c3aed', backgroundColor: '#2d1b5e' },
  submitBtn: { backgroundColor: '#7c3aed', borderRadius: 14, paddingVertical: 16, alignItems: 'center', marginTop: 8 },
  submitText: { color: 'white', fontWeight: '800', fontSize: 15 },
});
