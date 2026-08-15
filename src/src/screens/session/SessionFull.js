import React, { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Alert } from 'react-native';
import { colors } from '../../theme/colors';

export default function SessionFull({ navigation }) {
  const [joined, setJoined] = useState(false);

  return (
    <View style={styles.container}>
      <View style={styles.content}>
        <Text style={styles.illustration}>🚪</Text>
        <Text style={styles.title}>Session is Full</Text>
        <Text style={styles.subtitle}>This session has reached its attendee limit.</Text>
        <View style={styles.infoCard}>
          <Text style={styles.infoRow}>📋 Advanced UI/UX Workshop</Text>
          <Text style={styles.infoRow}>👥 50/50 attendees</Text>
          <Text style={styles.infoRow}>🏫 Classroom · Sarah Jenkins</Text>
        </View>
        {!joined ? (
          <>
            <TouchableOpacity style={styles.waitlistBtn} onPress={() => setJoined(true)}>
              <Text style={styles.waitlistBtnText}>📋 Join Waitlist</Text>
            </TouchableOpacity>
            <Text style={styles.waitlistNote}>You'll be notified when a spot opens up</Text>
          </>
        ) : (
          <View style={styles.joinedCard}>
            <Text style={styles.joinedIcon}>✅</Text>
            <Text style={styles.joinedTitle}>You're on the waitlist!</Text>
            <Text style={styles.joinedSubtitle}>We'll notify you as soon as a spot opens.</Text>
          </View>
        )}
        <TouchableOpacity style={styles.backBtn} onPress={() => navigation.navigate('Welcome')}>
          <Text style={styles.backBtnText}>← Go Back</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background, alignItems: 'center', justifyContent: 'center', padding: 24 },
  content: { alignItems: 'center', gap: 16, width: '100%' },
  illustration: { fontSize: 80 },
  title: { fontSize: 26, fontWeight: '800', color: colors.text },
  subtitle: { fontSize: 15, color: colors.textLight, textAlign: 'center' },
  infoCard: { backgroundColor: colors.white, borderRadius: 16, padding: 16, width: '100%', gap: 8, elevation: 2 },
  infoRow: { fontSize: 14, color: colors.text, fontWeight: '500' },
  waitlistBtn: { backgroundColor: colors.primary, paddingVertical: 16, paddingHorizontal: 32, borderRadius: 16, width: '100%', alignItems: 'center', elevation: 8 },
  waitlistBtnText: { color: colors.white, fontSize: 16, fontWeight: '700' },
  waitlistNote: { fontSize: 12, color: colors.textLight, textAlign: 'center' },
  joinedCard: { backgroundColor: '#E8FFE8', borderRadius: 16, padding: 20, width: '100%', alignItems: 'center', gap: 6 },
  joinedIcon: { fontSize: 36 },
  joinedTitle: { fontSize: 16, fontWeight: '700', color: colors.green },
  joinedSubtitle: { fontSize: 13, color: colors.textLight, textAlign: 'center' },
  backBtn: { paddingVertical: 12 },
  backBtnText: { color: colors.primary, fontSize: 15, fontWeight: '600' },
});