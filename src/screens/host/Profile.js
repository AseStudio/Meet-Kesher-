import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, Switch, Platform, TextInput, Image, ActivityIndicator } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { colors } from '../../theme/colors';
import { supabase } from '../../lib/supabase';
import { showAlert } from '../../lib/alert';
import { sanitizeUsernameInput, isValidUsername } from '../../lib/username';

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
  const [usage, setUsage] = useState(null);
  const [loading, setLoading] = useState(true);
  const [sessionCount, setSessionCount] = useState(0);
  const [editingUsername, setEditingUsername] = useState(false);
  const [usernameInput, setUsernameInput] = useState('');
  const [savingUsername, setSavingUsername] = useState(false);
  const [usernameError, setUsernameError] = useState('');
  const [uploadingAvatar, setUploadingAvatar] = useState(false);

  // Apply theme to palette
  const themePalette = darkMode
    ? {
        primary: colors.primary,
        primaryBright: colors.primaryLight,
        primaryDeep: colors.primaryDark,
        primarySoft: colors.background,
        ink: colors.white,
        inkMuted: 'rgba(255,255,255,0.6)',
        surface: '#1A1A2E',
        canvas: '#0A0A1A',
        line: '#2D2D44',
        success: colors.green,
        successSoft: '#2E8B57',
        danger: colors.red,
        dangerSoft: '#FF6B6B',
        amber: colors.yellow,
        amberSoft: '#FFA500',
        premium: '#7C3AED',
        premiumSoft: '#4C1D95',
        neutralSoft: '#3A3A5A',
        neutralText: 'rgba(255,255,255,0.5)',
      }
    : {
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

  useEffect(() => {
    loadProfile();
    requestImagePermissions();
  }, []);

  // Realtime subscription for session count updates
  useEffect(() => {
    if (!profile?.id) return;

    const channel = supabase
      .channel(`profile-session-count-${profile.id}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'session_attendees',
          filter: `user_id=eq.${profile.id}`,
        },
        () => {
          refreshSessionCount();
        }
      )
      .subscribe();

    return () => supabase.removeChannel(channel);
  }, [profile?.id]);

  // Request image picker permissions
  const requestImagePermissions = async () => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      console.warn('Image picker permission not granted');
    }
  };

  const refreshSessionCount = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const { count } = await supabase
        .from('session_attendees')
        .select('*', { count: 'exact' })
        .eq('user_id', user.id);

      setSessionCount(count || 0);
    } catch (e) {
      console.error('Error refreshing session count:', e);
    }
  };

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

      // ensure_current_period() creates this month's row on first
      // touch if it doesn't exist yet — a user who hasn't hosted or
      // attended anything this month still gets a correct starting
      // balance shown here, not a blank/missing state.
      const { data: usageRow } = await supabase.rpc('get_my_usage');
      setUsage(usageRow);

      await refreshSessionCount();
    } catch (e) {
      console.error('Profile load error:', e);
    } finally {
      setLoading(false);
    }
  };

  // Profile picture upload
  const handleAvatarPress = async () => {
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsEditing: true,
        aspect: [1, 1],
        quality: 0.8,
      });

      if (!result.canceled && result.assets && result.assets.length > 0) {
        await uploadAvatar(result.assets[0]);
      }
    } catch (e) {
      showAlert('Error', 'Failed to pick image: ' + e.message);
    }
  };

  const uploadAvatar = async (imageAsset) => {
    try {
      setUploadingAvatar(true);
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('No user');

      const fileName = `${user.id}-${Date.now()}.jpg`;
      const { data: uploadData, error: uploadError } = await supabase.storage
        .from('avatars')
        .upload(fileName, imageAsset);

      if (uploadError) throw uploadError;

      // Get public URL
      const { data: urlData } = supabase.storage
        .from('avatars')
        .getPublicUrl(fileName);

      // Update profile with avatar URL
      const { error: updateError } = await supabase
        .from('profiles')
        .update({ avatar_url: urlData.publicUrl })
        .eq('id', user.id);

      if (updateError) throw updateError;

      // Update local state
      setProfile((prev) => ({ ...prev, avatar_url: urlData.publicUrl }));
      showAlert('Success', 'Profile picture updated!');
    } catch (e) {
      showAlert('Error', 'Failed to upload avatar: ' + e.message);
    } finally {
      setUploadingAvatar(false);
    }
  };

  const getInitials = (name) =>
    (name || 'U').split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase();

  const startEditingUsername = () => {
    setUsernameInput(profile?.username || '');
    setUsernameError('');
    setEditingUsername(true);
  };

  // Anyone whose account predates the username feature has none yet —
  // this is that backfill path. Deliberately not a blocking gate like
  // SelectRoleScreen: mentions/notifications degrade gracefully without
  // one (falls back to full name), so there's no reason to interrupt
  // someone's session just to force this right now.
  const saveUsername = async () => {
    const clean = sanitizeUsernameInput(usernameInput);
    if (!isValidUsername(clean)) {
      setUsernameError('3-20 characters: lowercase letters, numbers, underscores.');
      return;
    }
    setSavingUsername(true);
    setUsernameError('');
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Session expired.');

      const { data: existing } = await supabase
        .from('profiles')
        .select('id')
        .eq('username', clean)
        .neq('id', user.id)
        .maybeSingle();
      if (existing) {
        setUsernameError('That username is taken.');
        setSavingUsername(false);
        return;
      }

      const { error } = await supabase.from('profiles').update({ username: clean }).eq('id', user.id);
      if (error) throw error;

      setProfile((prev) => ({ ...prev, username: clean }));
      setEditingUsername(false);
    } catch (e) {
      setUsernameError(e.message || 'Could not save username.');
    } finally {
      setSavingUsername(false);
    }
  };

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
    { icon: 'document-text-outline', label: 'Terms & Privacy Policy', arrow: true, onPress: () => navigation.navigate('TermsAndPrivacy') },
  ];

  return (
    <View style={styles.container}>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>

        {/* Profile Header */}
        <LinearGradient
          colors={[themePalette.primaryBright, themePalette.primary, themePalette.primaryDeep]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.profileHeader}
        >
          <TouchableOpacity style={styles.backButton} onPress={() => navigation.goBack()} activeOpacity={0.75}>
            <Ionicons name="arrow-back" size={20} color={themePalette.surface} />
          </TouchableOpacity>

          <TouchableOpacity onPress={handleAvatarPress} disabled={uploadingAvatar} activeOpacity={0.75} style={styles.avatar}>
            {profile?.avatar_url ? (
              <Image source={{ uri: profile.avatar_url }} style={styles.avatarImage} />
            ) : (
              <Text style={styles.avatarText}>{getInitials(profile?.full_name)}</Text>
            )}
            {uploadingAvatar && (
              <View style={styles.avatarOverlay}>
                <ActivityIndicator color={themePalette.surface} />
              </View>
            )}
          </TouchableOpacity>

          <Text style={styles.name}>{profile?.full_name || 'User'}</Text>
          <Text style={styles.email}>{profile?.email || ''}</Text>

          {editingUsername ? (
            <View style={styles.usernameEditRow}>
              <Text style={styles.usernameAt}>@</Text>
              <TextInput
                style={styles.usernameEditInput}
                value={usernameInput}
                onChangeText={(t) => setUsernameInput(sanitizeUsernameInput(t))}
                placeholder="username"
                placeholderTextColor={darkMode ? 'rgba(255,255,255,0.6)' : 'rgba(0,0,0,0.4)'}
                autoCapitalize="none"
                autoCorrect={false}
                autoFocus
              />
              <TouchableOpacity onPress={saveUsername} disabled={savingUsername} activeOpacity={0.8} style={styles.usernameSaveBtn}>
                <Ionicons name="checkmark" size={16} color={themePalette.primary} />
              </TouchableOpacity>
              <TouchableOpacity onPress={() => setEditingUsername(false)} activeOpacity={0.8} style={styles.usernameCancelBtn}>
                <Ionicons name="close" size={16} color={themePalette.surface} />
              </TouchableOpacity>
            </View>
          ) : (
            <TouchableOpacity onPress={startEditingUsername} activeOpacity={0.75} style={styles.usernameDisplayRow}>
              <Text style={styles.usernameDisplayText}>
                {profile?.username ? `@${profile.username}` : 'Set a username'}
              </Text>
              <Ionicons name="pencil" size={11} color={darkMode ? 'rgba(255,255,255,0.75)' : 'rgba(0,0,0,0.5)'} />
            </TouchableOpacity>
          )}
          {usernameError ? <Text style={styles.usernameErrorText}>{usernameError}</Text> : null}

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
            <View style={[styles.subIconWrap, profile?.plan && profile.plan !== 'free' && styles.subIconWrapPremium]}>
              <Ionicons
                name={profile?.plan && profile.plan !== 'free' ? 'sparkles' : 'pricetag-outline'}
                size={19}
                color={profile?.plan && profile.plan !== 'free' ? themePalette.premium : themePalette.primary}
              />
            </View>
            <View style={styles.subTextWrap}>
              <Text style={styles.subPlan}>
                {{ free: 'Free Plan', pro: 'Pro Plan', max: 'Max Plan', premium: 'Premium Plan' }[profile?.plan] || 'Free Plan'}
              </Text>
              <Text style={styles.subDesc}>
                {profile?.plan && profile.plan !== 'free' ? 'No ads in your feed — thanks for supporting Kesher' : 'Ads in your feed'}
              </Text>
            </View>
          </View>
          {(!profile?.plan || profile.plan === 'free') && (
            <TouchableOpacity
              style={styles.upgradeBtn}
              activeOpacity={0.85}
              onPress={() => showAlert('Kesher Premium', 'Paid plans are coming soon.')}
            >
              <Text style={styles.upgradeBtnText}>Upgrade</Text>
              <Ionicons name="sparkles" size={13} color={themePalette.surface} />
            </TouchableOpacity>
          )}
        </View>

        {/* Minutes left this month */}
        {usage && (
          <View style={styles.usageCard}>
            <View style={styles.usageRow}>
              <Ionicons name="videocam-outline" size={16} color={themePalette.primary} />
              <Text style={styles.usageLabel}>Hosting minutes left</Text>
              <Text style={styles.usageValue}>{usage.host_minutes_balance}</Text>
            </View>
            {profile?.plan && profile.plan !== 'free' && (
              <View style={styles.usageRow}>
                <Ionicons name="radio-button-on" size={14} color={themePalette.premium} />
                <Text style={styles.usageLabel}>Recording minutes left</Text>
                <Text style={styles.usageValue}>{usage.recording_minutes_balance}</Text>
              </View>
            )}
            <Text style={styles.usageNote}>
              {profile?.plan && profile.plan !== 'free'
                ? 'Unused minutes roll over to next month.'
                : 'Resets to a fresh 30 minutes on the 1st of each month.'}
            </Text>
          </View>
        )}

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
                <Ionicons name={row.icon} size={17} color={themePalette.primary} />
              </View>
              <Text style={styles.settingLabel}>{row.label}</Text>

              {row.toggle && (
                <Switch
                  value={row.value}
                  onValueChange={row.onChange}
                  trackColor={{ true: themePalette.primary }}
                  thumbColor={themePalette.surface}
                />
              )}
              {row.arrow && <Ionicons name="chevron-forward" size={17} color={themePalette.neutralText} />}
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
          <Ionicons name="log-out-outline" size={17} color={themePalette.danger} />
          <Text style={styles.logoutText}>Log Out</Text>
        </TouchableOpacity>

        <Text style={styles.version}>Kesher v1.0.0 — {profile?.role}</Text>
      </ScrollView>
    </View>
  );
}

const cardShadow = Platform.select({
  ios: { shadowColor: darkMode ? '#000' : '#2A1A6B', shadowOffset: { width: 0, height: 6 }, shadowOpacity: 0.08, shadowRadius: 14 },
  android: { elevation: 3 },
  default: { boxShadow: darkMode ? '0 6px 18px rgba(0,0,0,0.18)' : '0 6px 18px rgba(42,26,107,0.08)' },
});

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: themePalette.canvas },
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
    backgroundColor: darkMode ? 'rgba(255,255,255,0.18)' : 'rgba(255,255,255,0.18)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatar: {
    width: 88,
    height: 88,
    borderRadius: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 3,
    borderColor: darkMode ? 'rgba(255,255,255,0.85)' : 'rgba(255,255,255,0.85)',
    overflow: 'hidden',
  },
  avatarImage: { width: '100%', height: '100%', borderRadius: 44 },
  avatarText: { color: themePalette.surface, fontSize: 28, fontWeight: '800' },
  avatarOverlay: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.4)', alignItems: 'center', justifyContent: 'center' },
  name: { fontSize: 21, fontWeight: '800', color: themePalette.surface, letterSpacing: -0.3, marginTop: 2 },
  email: { fontSize: 12.5, color: darkMode ? 'rgba(255,255,255,0.78)' : 'rgba(0,0,0,0.5)', fontWeight: '500' },
  usernameDisplayRow: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 4 },
  usernameDisplayText: { fontSize: 12, color: darkMode ? 'rgba(255,255,255,0.85)' : 'rgba(0,0,0,0.5)', fontWeight: '600' },
  usernameEditRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 6, backgroundColor: darkMode ? 'rgba(255,255,255,0.16)' : 'rgba(0,0,0,0.08)', borderRadius: 10, paddingHorizontal: 10, paddingVertical: 4 },
  usernameAt: { fontSize: 12.5, color: darkMode ? 'rgba(255,255,255,0.7)' : 'rgba(0,0,0,0.4)', fontWeight: '700' },
  usernameEditInput: { fontSize: 12.5, color: themePalette.ink, fontWeight: '600', minWidth: 90, paddingVertical: 2, outlineStyle: 'none' },
  usernameSaveBtn: { width: 22, height: 22, borderRadius: 11, backgroundColor: darkMode ? 'rgba(255,255,255,0.9)' : themePalette.surface, alignItems: 'center', justifyContent: 'center', marginLeft: 2 },
  usernameCancelBtn: { width: 22, height: 22, borderRadius: 11, backgroundColor: darkMode ? 'rgba(255,255,255,0.2)' : themePalette.line, alignItems: 'center', justifyContent: 'center' },
  usernameErrorText: { fontSize: 10.5, color: themePalette.danger, fontWeight: '600', marginTop: 4 },
  roleBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: darkMode ? 'rgba(255,255,255,0.18)' : 'rgba(0,0,0,0.08)',
    paddingHorizontal: 13, paddingVertical: 5, borderRadius: 20, marginTop: 2,
  },
  roleBadgeText: { color: themePalette.surface, fontWeight: '700', fontSize: 12.5 },

  // ── Stats ──
  statsRow: {
    flexDirection: 'row',
    backgroundColor: themePalette.surface,
    marginHorizontal: 20,
    marginTop: -22,
    borderRadius: 18,
    paddingVertical: 16,
    ...cardShadow,
  },
  statCard: { flex: 1, alignItems: 'center', gap: 4 },
  statDivider: { width: 1, backgroundColor: themePalette.line, marginVertical: 4 },
  statValue: { fontSize: 26, fontWeight: '800', color: themePalette.primary, letterSpacing: -0.5 },
  statValueSmall: { fontSize: 15, fontWeight: '800', color: themePalette.primary, marginTop: 5 },
  statLabel: { fontSize: 10.5, color: themePalette.inkMuted, textAlign: 'center', fontWeight: '600', lineHeight: 13 },

  // ── Subscription ──
  subscriptionCard: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: themePalette.surface, marginHorizontal: 20, marginTop: 16,
    borderRadius: 17, padding: 16, ...cardShadow,
  },
  subLeft: { flexDirection: 'row', alignItems: 'center', gap: 12, flex: 1 },
  subIconWrap: { width: 42, height: 42, borderRadius: 13, backgroundColor: themePalette.primarySoft, alignItems: 'center', justifyContent: 'center' },
  subIconWrapPremium: { backgroundColor: themePalette.premiumSoft },
  subTextWrap: { flex: 1 },
  subPlan: { fontSize: 14.5, fontWeight: '700', color: themePalette.ink },
  subDesc: { fontSize: 11.5, color: themePalette.inkMuted, marginTop: 2, fontWeight: '500' },

  // ── Usage ──
  usageCard: {
    backgroundColor: themePalette.surface, marginHorizontal: 20, marginTop: 10,
    borderRadius: 17, padding: 16, gap: 10, ...cardShadow,
  },
  usageRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  usageLabel: { flex: 1, fontSize: 12.5, color: themePalette.inkMuted, fontWeight: '600' },
  usageValue: { fontSize: 14, color: themePalette.ink, fontWeight: '800' },
  usageNote: { fontSize: 11, color: themePalette.neutralText, fontWeight: '500', marginTop: 2 },
  upgradeBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: themePalette.primary, paddingHorizontal: 14, paddingVertical: 9, borderRadius: 11 },
  upgradeBtnText: { color: themePalette.surface, fontWeight: '700', fontSize: 12.5 },

  // ── Settings ──
  settingsCard: {
    backgroundColor: themePalette.surface, marginHorizontal: 20, marginTop: 16,
    borderRadius: 17, overflow: 'hidden', ...cardShadow,
  },
  settingRow: { flexDirection: 'row', alignItems: 'center', padding: 15, gap: 12 },
  settingRowBorder: { borderBottomWidth: 1, borderBottomColor: themePalette.line },
  settingIconWrap: { width: 34, height: 34, borderRadius: 10, backgroundColor: themePalette.primarySoft, alignItems: 'center', justifyContent: 'center' },
  settingLabel: { flex: 1, fontSize: 14, color: themePalette.ink, fontWeight: '600' },

  // ── Logout / version ──
  logoutBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    marginHorizontal: 20, marginTop: 16,
    backgroundColor: themePalette.dangerSoft, paddingVertical: 15, borderRadius: 16,
  },
  logoutText: { color: themePalette.danger, fontSize: 15, fontWeight: '800' },
  version: { textAlign: 'center', color: themePalette.neutralText, fontSize: 11.5, fontWeight: '500', marginTop: 18, marginBottom: 30 },
});