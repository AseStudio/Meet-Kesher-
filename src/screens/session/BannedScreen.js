import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { palette, cardShadow } from '../../theme/palette';

export default function BannedScreen({ navigation, route }) {
  const session = route.params?.session;

  return (
    <View style={styles.container}>
      <View style={styles.iconWrap}>
        <Ionicons name="ban" size={44} color={palette.danger} />
      </View>
      <Text style={styles.title}>You've Been Banned</Text>
      <Text style={styles.subtitle}>
        The host has banned you from this and future sessions on Kesher.
      </Text>
      {session?.title && (
        <View style={styles.sessionBadge}>
          <Ionicons name="document-text-outline" size={13} color={palette.inkMuted} />
          <Text style={styles.sessionBadgeText}>{session.title}</Text>
        </View>
      )}
      <View style={styles.infoCard}>
        <Ionicons name="information-circle" size={18} color={palette.amber} />
        <Text style={styles.infoText}>
          If you believe this was a mistake, please contact the session host directly.
        </Text>
      </View>
      <TouchableOpacity
        style={styles.btn}
        onPress={() => navigation.navigate('AttendeeDashboard')}
        activeOpacity={0.85}
      >
        <Text style={styles.btnText}>Return to Dashboard</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: palette.canvas, alignItems: 'center', justifyContent: 'center', padding: 32 },
  iconWrap: { width: 96, height: 96, borderRadius: 48, backgroundColor: palette.dangerSoft, alignItems: 'center', justifyContent: 'center', marginBottom: 24 },
  title: { fontSize: 24, fontWeight: '800', color: palette.ink, textAlign: 'center', marginBottom: 10 },
  subtitle: { fontSize: 14.5, color: palette.inkMuted, textAlign: 'center', lineHeight: 21, marginBottom: 20 },
  sessionBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: palette.surface, paddingHorizontal: 16, paddingVertical: 9, borderRadius: 20, marginBottom: 20, ...cardShadow,
  },
  sessionBadgeText: { fontSize: 13, fontWeight: '600', color: palette.ink },
  infoCard: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 10,
    backgroundColor: palette.amberSoft, borderRadius: 14, padding: 16, marginBottom: 32, maxWidth: 360,
  },
  infoText: { flex: 1, fontSize: 13, color: palette.ink, lineHeight: 19 },
  btn: { backgroundColor: palette.primary, paddingVertical: 16, paddingHorizontal: 40, borderRadius: 14, ...cardShadow },
  btnText: { color: palette.surface, fontSize: 16, fontWeight: '700' },
});