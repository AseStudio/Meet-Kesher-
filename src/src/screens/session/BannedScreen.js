import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { colors } from '../../theme/colors';

export default function BannedScreen({ navigation, route }) {
  const session = route.params?.session;

  return (
    <View style={styles.container}>
      <View style={styles.iconWrap}>
        <Text style={styles.icon}>🚫</Text>
      </View>
      <Text style={styles.title}>You've Been Banned</Text>
      <Text style={styles.subtitle}>
        The host has banned you from this and future sessions on Kesher.
      </Text>
      {session?.title && (
        <View style={styles.sessionBadge}>
          <Text style={styles.sessionBadgeText}>📋 {session.title}</Text>
        </View>
      )}
      <View style={styles.infoCard}>
        <Text style={styles.infoText}>
          If you believe this was a mistake, please contact the session host directly.
        </Text>
      </View>
      <TouchableOpacity
        style={styles.btn}
        onPress={() => navigation.navigate('AttendeeDashboard')}
      >
        <Text style={styles.btnText}>Return to Dashboard</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background, alignItems: 'center', justifyContent: 'center', padding: 32 },
  iconWrap: { width: 100, height: 100, borderRadius: 50, backgroundColor: '#FFE8E8', alignItems: 'center', justifyContent: 'center', marginBottom: 24 },
  icon: { fontSize: 48 },
  title: { fontSize: 26, fontWeight: '800', color: colors.text, textAlign: 'center', marginBottom: 12 },
  subtitle: { fontSize: 15, color: colors.textLight, textAlign: 'center', lineHeight: 22, marginBottom: 20 },
  sessionBadge: { backgroundColor: colors.greyLight, paddingHorizontal: 16, paddingVertical: 8, borderRadius: 20, marginBottom: 20 },
  sessionBadgeText: { fontSize: 13, fontWeight: '600', color: colors.text },
  infoCard: { backgroundColor: '#FFF8E1', borderRadius: 14, padding: 16, marginBottom: 32, borderWidth: 1, borderColor: '#FFE082' },
  infoText: { fontSize: 13, color: '#8B6914', textAlign: 'center', lineHeight: 20 },
  btn: { backgroundColor: colors.primary, paddingVertical: 16, paddingHorizontal: 40, borderRadius: 14 },
  btnText: { color: colors.white, fontSize: 16, fontWeight: '700' },
});