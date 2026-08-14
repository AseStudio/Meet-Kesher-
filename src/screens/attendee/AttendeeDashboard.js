import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, TextInput, ActivityIndicator, Platform } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { colors } from '../../theme/colors';
import { supabase } from '../../lib/supabase';

// ─────────────────────────────────────────────────────────────────────
// PALETTE — layered on top of theme/colors.js rather than editing it
// blindly (that file's real values weren't available while building
// this). colors.primary is assumed to be the same purple used across
// the session screens (~#5B2EFF). If your real theme differs, this is
// the one object to swap — every color below flows from it.
// ─────────────────────────────────────────────────────────────────────
const palette = {
  primary: colors.primary,
  primaryBright: colors.primaryLight,
  primaryDeep: colors.primaryDark,
  primarySoft: colors.background,
  primarySoftBorder: colors.greyLight,
  ink: colors.text,
  inkMuted: colors.textLight,
  surface: colors.white,
  canvas: colors.background,
  line: colors.greyLight,
  success: colors.green,
  successSoft: '#E7FBF0',
  danger: colors.red,
  dangerSoft: '#FFE9E9',
  live: colors.red,
  liveSoft: '#FFE9E9',
  amber: colors.yellow,
  amberSoft: '#FFF3DE',
  neutralSoft: colors.greyLight,
  neutralText: colors.grey,
};

// Mode → icon + color. Deliberately drawn ONLY from tokens that already
// exist in theme/colors.js (primary / green / yellow / red) rather than
// inventing new hues — a blue/teal/pink set would look brighter in
// isolation but wouldn't actually belong to this brand's palette.
const MODE_META = {
  classroom:   { icon: 'school-outline',    set: 'ion', color: palette.primary, soft: palette.primarySoft, label: 'Classroom' },
  interview:   { icon: 'briefcase-outline', set: 'ion', color: palette.amber,   soft: palette.amberSoft,   label: 'Interview' },
  meeting:     { icon: 'people-outline',    set: 'ion', color: palette.success, soft: palette.successSoft, label: 'Meeting' },
  gettogether: { icon: 'party-popper',      set: 'mci', color: palette.danger,  soft: palette.dangerSoft,  label: 'Get-together' },
};
const DEFAULT_MODE_META = { icon: 'calendar-outline', set: 'ion', color: palette.primary, soft: palette.primarySoft, label: 'Session' };

function ModeIcon({ mode, size = 18 }) {
  const meta = MODE_META[mode] || DEFAULT_MODE_META;
  const IconSet = meta.set === 'mci' ? MaterialCommunityIcons : Ionicons;
  return <IconSet name={meta.icon} size={size} color={meta.color} />;
}

const STATUS_META = {
  ended:     { label: 'Completed', color: palette.success, soft: palette.successSoft },
  live:      { label: 'Live',      color: palette.live,    soft: palette.liveSoft },
  cancelled: { label: 'Cancelled', color: palette.neutralText, soft: palette.neutralSoft },
  scheduled: { label: 'Upcoming',  color: palette.primary, soft: palette.primarySoft },
};

const SUB_STATUS_META = {
  unseen:    { label: 'Unseen',    color: palette.surface, bg: palette.primary },
  seen:      { label: 'Seen',      color: palette.inkMuted, bg: palette.neutralSoft },
  responded: { label: 'Responded', color: palette.success,  bg: palette.successSoft },
};

export default function AttendeeDashboard({ navigation }) {
  const [profile, setProfile] = useState(null);
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [joinError, setJoinError] = useState('');
  const [joinLoading, setJoinLoading] = useState(false);
  const [attendedSessions, setAttendedSessions] = useState([]);
  const [submissions, setSubmissions] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => { loadData(); }, []);

  const loadData = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const { data: prof } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', user.id)
        .single();
      setProfile(prof);

      const { data: sessions } = await supabase
        .from('session_attendees')
        .select('*, sessions(title, mode, status, code, created_at)')
        .eq('user_id', user.id)
        .order('joined_at', { ascending: false })
        .limit(5);
      setAttendedSessions(sessions || []);

      const { data: subs } = await supabase
        .from('submissions')
        .select('*')
        .eq('sender_id', user.id)
        .order('created_at', { ascending: false })
        .limit(5);
      setSubmissions(subs || []);

    } catch (e) { console.log('loadData error:', e.message); }
    finally { setLoading(false); }
  };

  const handleJoin = async () => {
    setJoinError('');
    if (!code.trim() || code.length < 6) return setJoinError('Enter a valid 6-character code.');
    if (!password.trim()) return setJoinError('Enter the session password.');

    setJoinLoading(true);
    try {
      const { data: session, error } = await supabase
        .from('sessions')
        .select('*')
        .eq('code', code.trim().toUpperCase())
        .single();

      if (error || !session) {
        setJoinError('Session not found. Check your code.');
        setJoinLoading(false);
        return;
      }

      if (session.password !== password.trim()) {
        setJoinError('Incorrect password.');
        setJoinLoading(false);
        return;
      }

      if (session.status === 'ended') {
        setJoinError('This session has already ended.');
        setJoinLoading(false);
        return;
      }

      if (session.status === 'cancelled') {
        setJoinError('This session was cancelled by the host.');
        setJoinLoading(false);
        return;
      }

      const { data: { user } } = await supabase.auth.getUser();

      // Check ban BEFORE adding them as an attendee
      if (user) {
        const { data: ban } = await supabase
          .from('bans')
          .select('id')
          .eq('host_id', session.host_id)
          .eq('banned_user_id', user.id)
          .maybeSingle();

        if (ban) {
          setJoinError('You have been banned from this host\'s sessions.');
          setJoinLoading(false);
          return;
        }

        const { data: existing } = await supabase
          .from('session_attendees')
          .select('id')
          .eq('session_id', session.id)
          .eq('user_id', user.id)
          .maybeSingle();

        if (!existing) {
          await supabase.from('session_attendees').insert({
            session_id: session.id,
            user_id: user.id,
          });
        }
      }

      if (session.status === 'live') {
        navigation.navigate('AttendeeSession', { session });
      } else {
        navigation.navigate('Lobby', { session, attendee: true });
      }

    } catch (err) {
      setJoinError(err.message || 'Failed to join session.');
    } finally {
      setJoinLoading(false);
    }
  };

  const getGreeting = () => {
    const h = new Date().getHours();
    if (h < 12) return 'Good morning';
    if (h < 17) return 'Good afternoon';
    return 'Good evening';
  };

  const getInitials = (name) => (name || 'U').split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase();

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color={palette.primary} />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>

        {/* Top Bar */}
        <View style={styles.topBar}>
          <View style={styles.topBarLeft}>
            <View style={styles.greetingRow}>
              <Text style={styles.greeting}>{getGreeting()}, {profile?.full_name?.split(' ')[0] || 'there'}</Text>
              <MaterialCommunityIcons name="hand-wave" size={20} color={palette.amber} style={styles.waveIcon} />
            </View>
            <Text style={styles.subtitle}>Welcome back to Kesher</Text>
          </View>
          <TouchableOpacity onPress={() => navigation.navigate('Profile')} activeOpacity={0.8}>
            <View style={styles.avatarWrap}>
              <View style={styles.avatar}>
                <Text style={styles.avatarText}>{getInitials(profile?.full_name)}</Text>
              </View>
              <View style={styles.onlineDot} />
            </View>
          </TouchableOpacity>
        </View>

        {/* Join Card */}
        <LinearGradient
          colors={[palette.primaryBright, palette.primary, palette.primaryDeep]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.joinCard}
        >
          <View style={styles.joinHeaderRow}>
            <View style={styles.joinIconBadge}>
              <Ionicons name="log-in-outline" size={18} color={palette.surface} />
            </View>
            <Text style={styles.joinTitle}>Join a Session</Text>
          </View>

          <View style={styles.joinInputWrap}>
            <Ionicons name="keypad-outline" size={17} color="rgba(255,255,255,0.75)" style={styles.joinInputIcon} />
            <TextInput
              style={styles.joinInput}
              placeholder="6-character code"
              placeholderTextColor="rgba(255,255,255,0.6)"
              value={code}
              onChangeText={t => setCode(t.toUpperCase())}
              maxLength={6}
              autoCapitalize="characters"
            />
          </View>
          <View style={styles.joinInputWrap}>
            <Ionicons name="lock-closed-outline" size={17} color="rgba(255,255,255,0.75)" style={styles.joinInputIcon} />
            <TextInput
              style={styles.joinInput}
              placeholder="Session password"
              placeholderTextColor="rgba(255,255,255,0.6)"
              value={password}
              onChangeText={setPassword}
              secureTextEntry
            />
          </View>

          {joinError ? (
            <View style={styles.joinErrorRow}>
              <Ionicons name="alert-circle" size={15} color="#FFD7DE" />
              <Text style={styles.joinError}>{joinError}</Text>
            </View>
          ) : null}

          <TouchableOpacity
            style={[styles.joinButton, joinLoading && styles.joinButtonDisabled]}
            onPress={handleJoin}
            disabled={joinLoading}
            activeOpacity={0.85}
          >
            {joinLoading ? (
              <ActivityIndicator color={palette.primary} />
            ) : (
              <>
                <Text style={styles.joinButtonText}>Join Now</Text>
                <Ionicons name="arrow-forward" size={17} color={palette.primary} />
              </>
            )}
          </TouchableOpacity>
        </LinearGradient>

        {/* My Sessions */}
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>My Sessions</Text>
          </View>
          {attendedSessions.length === 0 ? (
            <View style={styles.emptyState}>
              <Ionicons name="calendar-clear-outline" size={26} color={palette.neutralText} />
              <Text style={styles.emptyStateText}>No sessions joined yet — join one above!</Text>
            </View>
          ) : (
            attendedSessions.map((item, i) => {
              const status = STATUS_META[item.sessions?.status] || STATUS_META.scheduled;
              const modeMeta = MODE_META[item.sessions?.mode] || DEFAULT_MODE_META;
              return (
                <View key={item.id || i} style={[styles.sessionCard, i === attendedSessions.length - 1 && styles.rowNoBorder]}>
                  <View style={[styles.sessionModeIcon, { backgroundColor: modeMeta.soft }]}>
                    <ModeIcon mode={item.sessions?.mode} size={19} />
                  </View>
                  <View style={styles.sessionInfo}>
                    <Text style={styles.sessionCardTitle} numberOfLines={1}>{item.sessions?.title || 'Session'}</Text>
                    <Text style={styles.sessionMeta}>Code {item.sessions?.code || 'N/A'}</Text>
                  </View>
                  <View style={[styles.statusBadge, { backgroundColor: status.soft }]}>
                    <View style={[styles.statusDot, { backgroundColor: status.color }]} />
                    <Text style={[styles.statusText, { color: status.color }]}>{status.label}</Text>
                  </View>
                </View>
              );
            })
          )}
        </View>

        {/* Submissions */}
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>My Submissions</Text>
          </View>
          {submissions.length === 0 ? (
            <View style={styles.emptyState}>
              <Ionicons name="document-outline" size={26} color={palette.neutralText} />
              <Text style={styles.emptyStateText}>No submissions yet.</Text>
            </View>
          ) : (
            submissions.map((sub, i) => {
              const subMeta = SUB_STATUS_META[sub.status] || SUB_STATUS_META.seen;
              return (
                <View key={sub.id || i} style={[styles.submissionRow, i === submissions.length - 1 && styles.rowNoBorder]}>
                  <View style={styles.submissionIconWrap}>
                    <Ionicons name="document-text-outline" size={17} color={palette.primary} />
                  </View>
                  <Text style={styles.submissionName} numberOfLines={1}>{sub.file_name || 'File'}</Text>
                  <View style={[styles.subBadge, { backgroundColor: subMeta.bg }]}>
                    <Text style={[styles.subBadgeText, { color: subMeta.color }]}>{subMeta.label}</Text>
                  </View>
                </View>
              );
            })
          )}
        </View>

      </ScrollView>

      <View style={styles.bottomNav}>
        <TouchableOpacity style={styles.navItem} activeOpacity={0.7}>
          <Ionicons name="home" size={22} color={palette.primary} />
          <Text style={styles.navLabelActive}>Home</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.navItem} onPress={() => navigation.navigate('Community')} activeOpacity={0.7}>
          <Ionicons name="people-circle-outline" size={22} color={palette.neutralText} />
          <Text style={styles.navLabel}>Community</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.navItem} onPress={() => navigation.navigate('SubmitFile')} activeOpacity={0.7}>
          <Ionicons name="folder-open-outline" size={22} color={palette.neutralText} />
          <Text style={styles.navLabel}>Submissions</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.navItem} onPress={() => navigation.navigate('Profile')} activeOpacity={0.7}>
          <Ionicons name="person-circle-outline" size={22} color={palette.neutralText} />
          <Text style={styles.navLabel}>Profile</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const cardShadow = Platform.select({
  ios: { shadowColor: '#2A1A6B', shadowOffset: { width: 0, height: 6 }, shadowOpacity: 0.08, shadowRadius: 14 },
  android: { elevation: 3 },
  default: { boxShadow: '0 6px 18px rgba(42,26,107,0.08)' },
});

const joinShadow = Platform.select({
  ios: { shadowColor: palette.primaryDeep, shadowOffset: { width: 0, height: 10 }, shadowOpacity: 0.28, shadowRadius: 20 },
  android: { elevation: 10 },
  default: { boxShadow: `0 10px 26px rgba(62,31,184,0.28)` },
});

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: palette.canvas },
  loadingContainer: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: palette.canvas },
  scroll: { padding: 20, paddingBottom: 108 },

  // ── Top bar ──
  topBar: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 22 },
  topBarLeft: { flex: 1, paddingRight: 12 },
  greetingRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  greeting: { fontSize: 23, fontWeight: '800', color: palette.ink, letterSpacing: -0.4 },
  waveIcon: { marginTop: -2 },
  subtitle: { fontSize: 13.5, color: palette.inkMuted, marginTop: 3, fontWeight: '500' },
  avatarWrap: { position: 'relative' },
  avatar: { width: 48, height: 48, borderRadius: 24, backgroundColor: palette.primary, alignItems: 'center', justifyContent: 'center' },
  avatarText: { fontSize: 16, fontWeight: '700', color: palette.surface },
  onlineDot: { position: 'absolute', bottom: 1, right: 1, width: 12, height: 12, borderRadius: 6, backgroundColor: palette.success, borderWidth: 2, borderColor: palette.canvas },

  // ── Join card ──
  joinCard: { borderRadius: 22, padding: 20, marginBottom: 22, gap: 12, ...joinShadow },
  joinHeaderRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 2 },
  joinIconBadge: { width: 30, height: 30, borderRadius: 10, backgroundColor: 'rgba(255,255,255,0.18)', alignItems: 'center', justifyContent: 'center' },
  joinTitle: { fontSize: 18, fontWeight: '800', color: palette.surface, letterSpacing: -0.2 },
  joinInputWrap: { flexDirection: 'row', alignItems: 'center', backgroundColor: 'rgba(255,255,255,0.16)', borderRadius: 13, borderWidth: 1, borderColor: 'rgba(255,255,255,0.28)', paddingHorizontal: 14 },
  joinInputIcon: { marginRight: 8 },
  joinInput: { flex: 1, paddingVertical: 13, fontSize: 15, color: palette.surface, fontWeight: '600', outlineStyle: 'none' },
  joinErrorRow: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: 'rgba(255,255,255,0.14)', borderRadius: 10, paddingHorizontal: 10, paddingVertical: 7 },
  joinError: { color: '#FFE4E9', fontSize: 12, fontWeight: '600', flexShrink: 1 },
  joinButton: { flexDirection: 'row', gap: 8, backgroundColor: palette.surface, borderRadius: 13, paddingVertical: 14, alignItems: 'center', justifyContent: 'center', marginTop: 2 },
  joinButtonDisabled: { opacity: 0.7 },
  joinButtonText: { color: palette.primary, fontSize: 15.5, fontWeight: '800' },

  // ── Sections ──
  section: { backgroundColor: palette.surface, borderRadius: 20, padding: 18, marginBottom: 16, ...cardShadow },
  sectionHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 },
  sectionTitle: { fontSize: 15.5, fontWeight: '800', color: palette.ink, letterSpacing: -0.2 },
  emptyState: { paddingVertical: 26, alignItems: 'center', gap: 8 },
  emptyStateText: { color: palette.neutralText, fontSize: 13, fontWeight: '500', textAlign: 'center' },

  // ── Session rows ──
  sessionCard: { flexDirection: 'row', alignItems: 'center', paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: palette.line, gap: 12 },
  rowNoBorder: { borderBottomWidth: 0, paddingBottom: 2 },
  sessionModeIcon: { width: 42, height: 42, borderRadius: 13, alignItems: 'center', justifyContent: 'center' },
  sessionInfo: { flex: 1 },
  sessionCardTitle: { fontSize: 14, fontWeight: '700', color: palette.ink },
  sessionMeta: { fontSize: 11.5, color: palette.inkMuted, marginTop: 2, fontWeight: '600', letterSpacing: 0.2 },
  statusBadge: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 9, paddingVertical: 5, borderRadius: 9 },
  statusDot: { width: 6, height: 6, borderRadius: 3 },
  statusText: { fontSize: 11, fontWeight: '700' },

  // ── Submissions ──
  submissionRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 11, borderBottomWidth: 1, borderBottomColor: palette.line, gap: 11 },
  submissionIconWrap: { width: 34, height: 34, borderRadius: 10, backgroundColor: palette.primarySoft, alignItems: 'center', justifyContent: 'center' },
  submissionName: { flex: 1, fontSize: 13.5, fontWeight: '700', color: palette.ink },
  subBadge: { paddingHorizontal: 9, paddingVertical: 5, borderRadius: 9 },
  subBadgeText: { fontSize: 10.5, fontWeight: '700' },

  // ── Bottom nav ──
  bottomNav: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    backgroundColor: palette.surface, flexDirection: 'row',
    paddingTop: 12, paddingBottom: Platform.OS === 'ios' ? 26 : 12, paddingHorizontal: 20,
    borderTopWidth: 1, borderTopColor: palette.line,
    ...Platform.select({ ios: { shadowColor: '#000', shadowOffset: { width: 0, height: -3 }, shadowOpacity: 0.05, shadowRadius: 10 }, android: { elevation: 12 }, default: {} }),
  },
  navItem: { flex: 1, alignItems: 'center', gap: 4 },
  navLabel: { fontSize: 10.5, color: palette.neutralText, fontWeight: '600' },
  navLabelActive: { fontSize: 10.5, color: palette.primary, fontWeight: '800' },
});