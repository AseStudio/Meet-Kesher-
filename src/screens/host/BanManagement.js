import React, { useState, useEffect } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity,
  ScrollView, ActivityIndicator, Alert, Platform
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '../../theme/colors';
import { supabase } from '../../lib/supabase';
import { showAlert } from '../../lib/alert';

// ─────────────────────────────────────────────────────────────────────
// PALETTE — same tokens/mapping as the other production-pass screens.
// ─────────────────────────────────────────────────────────────────────
const palette = {
  primary: colors.primary,
  primaryBright: colors.primaryLight,
  primaryDeep: colors.primaryDark,
  primarySoft: colors.background,
  ink: colors.text,
  inkMuted: colors.textLight,
  surface: colors.white,
  canvas: colors.background,
  line: colors.greyLight,
  success: colors.green,
  successSoft: '#E7FBF0',
  danger: colors.red,
  dangerSoft: '#FFE9E9',
  neutralSoft: colors.greyLight,
  neutralText: colors.grey,
};

export default function BanManagement({ navigation }) {
  const [bans, setBans] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => { loadBans(); }, []);

  const loadBans = async () => {
    setLoading(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const { data: bansData, error } = await supabase
        .from('bans')
        .select('*')
        .eq('host_id', user.id)
        .order('created_at', { ascending: false });

      if (error || !bansData?.length) {
        setBans([]);
        return;
      }

      // Fetch names of banned users
      const userIds = bansData.map(b => b.banned_user_id);
      const { data: profiles } = await supabase
        .from('profiles')
        .select('id, full_name')
        .in('id', userIds);

      const profileMap = {};
      profiles?.forEach(p => { profileMap[p.id] = p; });

      setBans(bansData.map(b => ({
        ...b,
        banned_name: profileMap[b.banned_user_id]?.full_name || 'Unknown User',
      })));
    } catch (e) {
      console.log('Load bans error:', e.message);
    } finally {
      setLoading(false);
    }
  };

  const liftBan = (ban) => {
    showAlert(
      'Lift ban',
      `Lift ban for ${ban.banned_name}? They will be able to join your sessions again.`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Lift ban', style: 'destructive', onPress: () => performLiftBan(ban) },
      ]
    );
  };

  const performLiftBan = async (ban) => {
    try {
      const { error } = await supabase
        .from('bans')
        .delete()
        .eq('id', ban.id);

      if (error) throw error;
      setBans(prev => prev.filter(b => b.id !== ban.id));
    } catch (e) {
      showAlert('Failed to lift ban', e.message);
    }
  };

  const getInitials = (name) =>
    (name || 'U').split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase();

  const formatDate = (dateStr) => {
    const d = new Date(dateStr);
    return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  };

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn} activeOpacity={0.75}>
          <Ionicons name="arrow-back" size={19} color={palette.ink} />
        </TouchableOpacity>
        <View>
          <Text style={styles.headerTitle}>Ban Management</Text>
          <Text style={styles.headerSub}>{bans.length} banned user{bans.length !== 1 ? 's' : ''}</Text>
        </View>
      </View>

      {loading ? (
        <View style={styles.loadingWrap}>
          <ActivityIndicator color={palette.primary} size="large" />
        </View>
      ) : bans.length === 0 ? (
        <View style={styles.emptyWrap}>
          <View style={styles.emptyIconWrap}>
            <Ionicons name="shield-checkmark-outline" size={34} color={palette.success} />
          </View>
          <Text style={styles.emptyTitle}>No Banned Users</Text>
          <Text style={styles.emptySub}>You haven't banned anyone from your sessions yet.</Text>
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.list}>
          {bans.map((ban) => (
            <View key={ban.id} style={styles.banCard}>
              <View style={styles.banLeft}>
                <View style={styles.avatar}>
                  <Text style={styles.avatarText}>{getInitials(ban.banned_name)}</Text>
                </View>
                <View style={styles.banInfo}>
                  <Text style={styles.banName}>{ban.banned_name}</Text>
                  <Text style={styles.banReason}>
                    {ban.reason || 'Banned by host'}
                  </Text>
                  <View style={styles.banDateRow}>
                    <Ionicons name="calendar-outline" size={11} color={palette.neutralText} />
                    <Text style={styles.banDate}>{formatDate(ban.created_at)}</Text>
                  </View>
                </View>
              </View>
              <TouchableOpacity
                style={styles.liftBtn}
                onPress={() => liftBan(ban)}
                activeOpacity={0.8}
              >
                <Ionicons name="lock-open-outline" size={13} color={palette.success} />
                <Text style={styles.liftBtnText}>Lift Ban</Text>
              </TouchableOpacity>
            </View>
          ))}
        </ScrollView>
      )}
    </View>
  );
}

const cardShadow = Platform.select({
  ios: { shadowColor: '#2A1A6B', shadowOffset: { width: 0, height: 5 }, shadowOpacity: 0.07, shadowRadius: 12 },
  android: { elevation: 2 },
  default: { boxShadow: '0 5px 14px rgba(42,26,107,0.07)' },
});

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: palette.canvas },
  header: { flexDirection: 'row', alignItems: 'center', gap: 14, padding: 20, paddingTop: 50, backgroundColor: palette.surface, borderBottomWidth: 1, borderBottomColor: palette.line },
  backBtn: { width: 38, height: 38, borderRadius: 13, backgroundColor: palette.neutralSoft, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { fontSize: 19, fontWeight: '800', color: palette.ink, letterSpacing: -0.3 },
  headerSub: { fontSize: 12.5, color: palette.inkMuted, marginTop: 2, fontWeight: '500' },

  loadingWrap: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  emptyWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 40, gap: 4 },
  emptyIconWrap: { width: 72, height: 72, borderRadius: 36, backgroundColor: palette.successSoft, alignItems: 'center', justifyContent: 'center', marginBottom: 14 },
  emptyTitle: { fontSize: 19, fontWeight: '800', color: palette.ink, marginBottom: 6, letterSpacing: -0.3 },
  emptySub: { fontSize: 13.5, color: palette.inkMuted, textAlign: 'center', fontWeight: '500', lineHeight: 19 },

  list: { padding: 16, gap: 12 },
  banCard: { flexDirection: 'row', alignItems: 'center', backgroundColor: palette.surface, borderRadius: 17, padding: 16, borderWidth: 1, borderColor: palette.line, ...cardShadow },
  banLeft: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 12 },
  avatar: { width: 44, height: 44, borderRadius: 22, backgroundColor: palette.dangerSoft, alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: palette.danger },
  avatarText: { fontSize: 14, fontWeight: '700', color: palette.danger },
  banInfo: { flex: 1, gap: 2 },
  banName: { fontSize: 15, fontWeight: '700', color: palette.ink },
  banReason: { fontSize: 12, color: palette.inkMuted, fontWeight: '500' },
  banDateRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 1 },
  banDate: { fontSize: 11, color: palette.neutralText, fontWeight: '500' },
  liftBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: palette.successSoft, paddingHorizontal: 14, paddingVertical: 9, borderRadius: 11, borderWidth: 1, borderColor: palette.success },
  liftBtnText: { color: palette.success, fontSize: 12.5, fontWeight: '700' },
});