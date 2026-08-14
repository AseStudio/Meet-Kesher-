import React, { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, Alert } from 'react-native';
import { colors } from '../../theme/colors';

const attendeeList = [
  { id: 1, name: 'Alice Morgan', avatar: 'AM' },
  { id: 2, name: 'Ben Carter', avatar: 'BC' },
  { id: 3, name: 'Baizin Ahmed', avatar: 'BA' },
  { id: 4, name: 'Marcus Lee', avatar: 'ML' },
  { id: 5, name: 'Liam Foster', avatar: 'LF' },
];

export default function CoHostManager({ navigation }) {
  const [coHosts, setCoHosts] = useState([
    { id: 1, name: 'Alice Morgan', avatar: 'AM', order: 1 },
  ]);

  const appoint = (attendee) => {
    if (coHosts.find(c => c.id === attendee.id)) {
      Alert.alert('Already Co-host', `${attendee.name} is already a co-host.`);
      return;
    }
    setCoHosts([...coHosts, { ...attendee, order: coHosts.length + 1 }]);
  };

  const remove = (id) => {
    setCoHosts(coHosts.filter(c => c.id !== id).map((c, i) => ({ ...c, order: i + 1 })));
  };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <Text style={styles.backText}>←</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>⭐ Co-host Manager</Text>
        <View style={{ width: 24 }} />
      </View>

      <ScrollView contentContainerStyle={styles.scroll}>

        {/* Current Co-hosts */}
        <Text style={styles.sectionTitle}>Current Co-hosts</Text>
        <Text style={styles.sectionSubtitle}>Succession order — first takes over if host disconnects</Text>

        {coHosts.length === 0 ? (
          <View style={styles.emptyCard}>
            <Text style={styles.emptyIcon}>⭐</Text>
            <Text style={styles.emptyText}>No co-hosts appointed yet</Text>
          </View>
        ) : (
          coHosts.map(c => (
            <View key={c.id} style={styles.coHostCard}>
              <View style={styles.orderBadge}>
                <Text style={styles.orderText}>{c.order}</Text>
              </View>
              <View style={styles.coHostAvatar}>
                <Text style={styles.coHostAvatarText}>{c.avatar}</Text>
              </View>
              <View style={styles.coHostInfo}>
                <Text style={styles.coHostName}>{c.name}</Text>
                <Text style={styles.coHostRole}>
                  {c.order === 1 ? '🥇 First in succession' : `${c.order === 2 ? '🥈' : '🥉'} ${c.order === 2 ? 'Second' : 'Third'} in succession`}
                </Text>
              </View>
              <TouchableOpacity style={styles.removeBtn} onPress={() => remove(c.id)}>
                <Text style={styles.removeBtnText}>Remove</Text>
              </TouchableOpacity>
            </View>
          ))
        )}

        {/* Appoint New */}
        <Text style={styles.sectionTitle}>Appoint Co-host</Text>
        <Text style={styles.sectionSubtitle}>Select an attendee to promote</Text>

        {attendeeList.map(a => {
          const isAlready = coHosts.find(c => c.id === a.id);
          return (
            <View key={a.id} style={styles.attendeeRow}>
              <View style={styles.attendeeAvatar}>
                <Text style={styles.attendeeAvatarText}>{a.avatar}</Text>
              </View>
              <Text style={styles.attendeeName}>{a.name}</Text>
              {isAlready ? (
                <View style={styles.alreadyBadge}>
                  <Text style={styles.alreadyText}>⭐ Co-host</Text>
                </View>
              ) : (
                <TouchableOpacity style={styles.appointBtn} onPress={() => appoint(a)}>
                  <Text style={styles.appointBtnText}>Appoint ⭐</Text>
                </TouchableOpacity>
              )}
            </View>
          );
        })}

        {/* Approval Info */}
        <View style={styles.infoCard}>
          <Text style={styles.infoIcon}>ℹ️</Text>
          <Text style={styles.infoText}>Co-hosts can take most host actions but every action requires your approval. You have 90 seconds to respond before a request is auto-declined.</Text>
        </View>

      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0A0A1A' },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 16, paddingTop: 40, backgroundColor: '#0D0D2B' },
  backText: { fontSize: 24, color: colors.white },
  headerTitle: { fontSize: 18, fontWeight: '700', color: colors.white },
  scroll: { padding: 20, gap: 12 },
  sectionTitle: { fontSize: 16, fontWeight: '700', color: colors.white, marginTop: 8 },
  sectionSubtitle: { fontSize: 12, color: 'rgba(255,255,255,0.4)' },
  emptyCard: { backgroundColor: '#1E1E3F', borderRadius: 14, padding: 24, alignItems: 'center', gap: 8 },
  emptyIcon: { fontSize: 32 },
  emptyText: { color: 'rgba(255,255,255,0.5)', fontSize: 14 },
  coHostCard: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#1E1E3F', borderRadius: 14, padding: 14, gap: 12, borderWidth: 1, borderColor: 'rgba(91,46,255,0.3)' },
  orderBadge: { width: 28, height: 28, borderRadius: 14, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
  orderText: { color: colors.white, fontWeight: '700', fontSize: 13 },
  coHostAvatar: { width: 42, height: 42, borderRadius: 21, backgroundColor: colors.primaryDark, alignItems: 'center', justifyContent: 'center' },
  coHostAvatarText: { color: colors.white, fontWeight: '700' },
  coHostInfo: { flex: 1 },
  coHostName: { color: colors.white, fontWeight: '700', fontSize: 14 },
  coHostRole: { color: 'rgba(255,255,255,0.5)', fontSize: 12, marginTop: 2 },
  removeBtn: { borderWidth: 1, borderColor: colors.red, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 8 },
  removeBtnText: { color: colors.red, fontSize: 12, fontWeight: '600' },
  attendeeRow: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#1E1E3F', borderRadius: 12, padding: 12, gap: 12 },
  attendeeAvatar: { width: 40, height: 40, borderRadius: 20, backgroundColor: '#2E2E5F', alignItems: 'center', justifyContent: 'center' },
  attendeeAvatarText: { color: colors.white, fontWeight: '700', fontSize: 12 },
  attendeeName: { flex: 1, color: colors.white, fontSize: 14, fontWeight: '600' },
  alreadyBadge: { backgroundColor: 'rgba(91,46,255,0.2)', paddingHorizontal: 10, paddingVertical: 5, borderRadius: 8 },
  alreadyText: { color: colors.primaryLight, fontSize: 12, fontWeight: '600' },
  appointBtn: { backgroundColor: colors.primary, paddingHorizontal: 12, paddingVertical: 7, borderRadius: 8 },
  appointBtnText: { color: colors.white, fontSize: 12, fontWeight: '700' },
  infoCard: { flexDirection: 'row', gap: 10, backgroundColor: '#1E1E3F', borderRadius: 14, padding: 14, borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)' },
  infoIcon: { fontSize: 18 },
  infoText: { flex: 1, color: 'rgba(255,255,255,0.5)', fontSize: 12, lineHeight: 18 },
});