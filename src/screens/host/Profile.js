import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, Switch, Platform } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '../../theme/colors';
import { supabase } from '../../lib/supabase';
import { showAlert } from '../../lib/alert';

// ─────────────────────────────────────────────────────────────────────
// PALETTE — same tokens/mapping as the other production-pass screens
// (HostDashboard / AttendeeDashboard / CreateSession) so this reads as
// part of the same product.
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
  amber: colors.yellow,
  amberSoft: '#FFF3DE',
  premium: '#7C3AED',
  premiumSoft: '#F1E8FE',
  neutralSoft: colors.greyLight,
  neutralText: colors.grey,
};

const MEMBER_SINCE_FORMAT = (iso) => {
  try {
    return new Date(iso).toLocaleDateString(undefined, { month: 'short', year: 'numeric' });
  } catch {
    return null;
  }
};

export default function Profile({ navigation }) {
  const [darkMode, setDarkMode] = useState(false);
  const [notifications, setNotifications] = useState(true);
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [sessionCount, setSessionCount] = useState(0);

  useEffect(() => {
    loadProfile();
  }, []);

  const loadProfile = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const { data: prof } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', user.id)
        .single();

      setProfile(prof);

      const { count } = await supabase
        .from('session_attendees')
        .select('*', { count: 'exact' })
        .eq('user_id', user.id);

      setSessionCount(count || 0);
    } catch (e) {
      console.error('Profile load error:', e);
    } finally {
      setLoading(false);
    }
  };

  const getInitials = (name) =>
    (name || 'U').split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase();

  // Existing "Sessions Joined" count, plus a "Member Since" stat computed
  // from profile.created_at if that column exists on your profiles table
  // (select('*') above already pulls it if so — no new query). Purely
  // additive: if the field isn't there, memberSince stays null and only
  // the original single stat renders, same as before.
  const memberSince = MEMBER_SINCE_FORMAT(profile?.created_at);

  const settingsRows = [
    { icon: 'notifications-outline', label: 'Notifications', toggle: true, value: notifications, onChange: setNotifications },
    { icon: 'videocam-outline', label: 'Audio & Video Defaults', arrow: true },
    { icon: 'moon-outline', label: 'Theme', toggle: true, value: darkMode, onChange: setDarkMode },
    { icon: 'lock-closed-outline', label: 'Privacy & Security', arrow: true },
    { icon: 'card-outline', label: 'Subscription & Billing', arrow: true },
    { icon: 'shield-checkmark-outline', label: 'Ban Management', arrow: true, onPress: () => navigation.navigate('BanManagement') },
    { icon: 'help-circle-outline', label: 'Help & Support', arrow: true },
    { icon: 'document-text-outline', label: 'Terms & Privacy Policy', arrow: true },
  ];

  return (
    <View style={styles.container}>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>

        {/* Profile Header */}
        <LinearGradient
          colors={[palette.primaryBright, palette.primary, palette.primaryDeep]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.profileHeader}
        >
          <TouchableOpacity style={styles.backButton} onPress={() => navigation.goBack()} activeOpacity={0.75}>
            <Ionicons name="arrow-back" size={20} color={palette.surface} />
          </TouchableOpacity>

          <View style={styles.avatar}>
            <Text style={styles.avatarText}>{getInitials(profile?.full_name)}</Text>
          </View>

          <Text style={styles.name}>{profile?.full_name || 'User'}</Text>
          <Text style={styles.email}>{profile?.email || ''}</Text>

          <View style={styles.roleBadge}>
            <Ionicons name="star" size={12} color="#FFD873" />
            <Text style={styles.roleBadgeText}>{profile?.role === 'host' ? 'Host' : 'Attendee'}</Text>
          </View>
        </LinearGradient>

        {/* Stats Card */}
        <View style={styles.statsRow}>
          <View style={styles.statCard}>
            <Text style={styles.statValue}>{sessionCount}</Text>
            <Text style={styles.statLabel}>Sessions{'\n'}Joined</Text>
          </View>
          {memberSince && (
            <>
              <View style={styles.statDivider} />
              <View style={styles.statCard}>
                <Text style={styles.statValueSmall}>{memberSince}</Text>
                <Text style={styles.statLabel}>Member{'\n'}Since</Text>
              </View>
            </>
          )}
        </View>

        {/* Subscription */}
        <View style={styles.subscriptionCard}>
          <View style={styles.subLeft}>
            <View style={[styles.subIconWrap, profile?.is_premium && styles.subIconWrapPremium]}>
              <Ionicons
                name={profile?.is_premium ? 'sparkles' : 'pricetag-outline'}
                size={19}
                color={profile?.is_premium ? palette.premium : palette.primary}
              />
            </View>
            <View style={styles.subTextWrap}>
              <Text style={styles.subPlan}>{profile?.is_premium ? 'Premium Plan' : 'Free Plan'}</Text>
              <Text style={styles.subDesc}>
                {profile?.is_premium ? 'No ads in your feed — thanks for supporting Kesher' : 'Ads in your feed'}
              </Text>
            </View>
          </View>
          {!profile?.is_premium && (
            <TouchableOpacity
              style={styles.upgradeBtn}
              activeOpacity={0.85}
              onPress={() => showAlert('Kesher Premium', 'Premium subscriptions are coming soon.')}
            >
              <Text style={styles.upgradeBtnText}>Upgrade</Text>
              <Ionicons name="sparkles" size={13} color={palette.surface} />
            </TouchableOpacity>
          )}
        </View>

        {/* Settings */}
        <View style={styles.settingsCard}>
          {settingsRows.map((row, i) => (
            <TouchableOpacity
              key={i}
              style={[styles.settingRow, i < settingsRows.length - 1 && styles.settingRowBorder]}
              onPress={row.onPress}
              activeOpacity={row.onPress ? 0.7 : 1}
            >
              <View style={styles.settingIconWrap}>
                <Ionicons name={row.icon} size={17} color={palette.primary} />
              </View>
              <Text style={styles.settingLabel}>{row.label}</Text>

              {row.toggle && (
                <Switch
                  value={row.value}
                  onValueChange={row.onChange}
                  trackColor={{ true: palette.primary }}
                  thumbColor={palette.surface}
                />
              )}
              {row.arrow && <Ionicons name="chevron-forward" size={17} color={palette.neutralText} />}
            </TouchableOpacity>
          ))}
        </View>

        <TouchableOpacity
          style={styles.logoutBtn}
          activeOpacity={0.85}
          onPress={async () => {
            await supabase.auth.signOut();
            navigation.reset({
              index: 0,
              routes: [{ name: 'Splash' }],
            });
          }}
        >
          <Ionicons name="log-out-outline" size={17} color={palette.danger} />
          <Text style={styles.logoutText}>Log Out</Text>
        </TouchableOpacity>

        <Text style={styles.version}>Kesher v1.0.0 — {profile?.role}</Text>
      </ScrollView>
    </View>
  );
}

const cardShadow = Platform.select({
  ios: { shadowColor: '#2A1A6B', shadowOffset: { width: 0, height: 6 }, shadowOpacity: 0.08, shadowRadius: 14 },
  android: { elevation: 3 },
  default: { boxShadow: '0 6px 18px rgba(42,26,107,0.08)' },
});

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: palette.canvas },
  scroll: { paddingBottom: 50 },

  // ── Header ──
  profileHeader: {
    paddingTop: 60,
    paddingBottom: 34,
    alignItems: 'center',
    gap: 7,
    borderBottomLeftRadius: 28,
    borderBottomRightRadius: 28,
  },
  backButton: {
    position: 'absolute',
    top: 58,
    left: 20,
    zIndex: 10,
    width: 38,
    height: 38,
    borderRadius: 13,
    backgroundColor: 'rgba(255,255,255,0.18)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatar: {
    width: 88,
    height: 88,
    borderRadius: 44,
    backgroundColor: 'rgba(255,255,255,0.2)',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 3,
    borderColor: 'rgba(255,255,255,0.85)',
  },
  avatarText: { color: palette.surface, fontSize: 28, fontWeight: '800' },
  name: { fontSize: 21, fontWeight: '800', color: palette.surface, letterSpacing: -0.3, marginTop: 2 },
  email: { fontSize: 12.5, color: 'rgba(255,255,255,0.78)', fontWeight: '500' },
  roleBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: 'rgba(255,255,255,0.18)',
    paddingHorizontal: 13, paddingVertical: 5, borderRadius: 20, marginTop: 2,
  },
  roleBadgeText: { color: palette.surface, fontWeight: '700', fontSize: 12.5 },

  // ── Stats ──
  statsRow: {
    flexDirection: 'row',
    backgroundColor: palette.surface,
    marginHorizontal: 20,
    marginTop: -22,
    borderRadius: 18,
    paddingVertical: 16,
    ...cardShadow,
  },
  statCard: { flex: 1, alignItems: 'center', gap: 4 },
  statDivider: { width: 1, backgroundColor: palette.line, marginVertical: 4 },
  statValue: { fontSize: 26, fontWeight: '800', color: palette.primary, letterSpacing: -0.5 },
  statValueSmall: { fontSize: 15, fontWeight: '800', color: palette.primary, marginTop: 5 },
  statLabel: { fontSize: 10.5, color: palette.inkMuted, textAlign: 'center', fontWeight: '600', lineHeight: 13 },

  // ── Subscription ──
  subscriptionCard: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: palette.surface, marginHorizontal: 20, marginTop: 16,
    borderRadius: 17, padding: 16, ...cardShadow,
  },
  subLeft: { flexDirection: 'row', alignItems: 'center', gap: 12, flex: 1 },
  subIconWrap: { width: 42, height: 42, borderRadius: 13, backgroundColor: palette.primarySoft, alignItems: 'center', justifyContent: 'center' },
  subIconWrapPremium: { backgroundColor: palette.premiumSoft },
  subTextWrap: { flex: 1 },
  subPlan: { fontSize: 14.5, fontWeight: '700', color: palette.ink },
  subDesc: { fontSize: 11.5, color: palette.inkMuted, marginTop: 2, fontWeight: '500' },
  upgradeBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: palette.primary, paddingHorizontal: 14, paddingVertical: 9, borderRadius: 11 },
  upgradeBtnText: { color: palette.surface, fontWeight: '700', fontSize: 12.5 },

  // ── Settings ──
  settingsCard: {
    backgroundColor: palette.surface, marginHorizontal: 20, marginTop: 16,
    borderRadius: 17, overflow: 'hidden', ...cardShadow,
  },
  settingRow: { flexDirection: 'row', alignItems: 'center', padding: 15, gap: 12 },
  settingRowBorder: { borderBottomWidth: 1, borderBottomColor: palette.line },
  settingIconWrap: { width: 34, height: 34, borderRadius: 10, backgroundColor: palette.primarySoft, alignItems: 'center', justifyContent: 'center' },
  settingLabel: { flex: 1, fontSize: 14, color: palette.ink, fontWeight: '600' },

  // ── Logout / version ──
  logoutBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    marginHorizontal: 20, marginTop: 16,
    backgroundColor: palette.dangerSoft, paddingVertical: 15, borderRadius: 16,
  },
  logoutText: { color: palette.danger, fontSize: 15, fontWeight: '800' },
  version: { textAlign: 'center', color: palette.neutralText, fontSize: 11.5, fontWeight: '500', marginTop: 18, marginBottom: 30 },
});