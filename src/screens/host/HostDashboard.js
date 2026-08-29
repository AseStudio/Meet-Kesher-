import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, TextInput, ActivityIndicator, Platform, Alert } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { colors } from '../../theme/colors';
import { supabase } from '../../lib/supabase';
import SessionExpiredModal from '../../components/SessionExpiredModal';
import { useExpiredLobbyWatcher } from '../../lib/useExpiredLobbyWatcher';
import { usePushSubscription } from '../../lib/usePushSubscription';
import { useJoinSessionByCode } from '../../lib/useJoinSessionByCode';
import { getSessionJoinLink } from '../../lib/links';
import { showAlert } from '../../lib/alert';

// ─────────────────────────────────────────────────────────────────────
// PALETTE — layered on top of theme/colors.js rather than editing it
// blindly (that file's real values weren't available while building
// this). colors.primary is assumed to be the same purple used across
// the session screens (~#5B2EFF). If your real theme differs, this is
// the one object to swap — every color below flows from it. Kept
// identical to AttendeeDashboard.js's palette so both screens read as
// one product, not two.
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
const DEFAULT_MODE_META = { icon: 'calendar-outline', set: 'ion', color: palette.primary, soft: palette.primarySoft };

function ModeIcon({ mode, size = 18 }) {
  const meta = MODE_META[mode] || DEFAULT_MODE_META;
  const IconSet = meta.set === 'mci' ? MaterialCommunityIcons : Ionicons;
  return <IconSet name={meta.icon} size={size} color={meta.color} />;
}

export default function HostDashboard({ navigation }) {

  const [profile, setProfile] = useState(null);
  const [upcoming, setUpcoming] = useState([]);
  const [recent, setRecent] = useState([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const { code, setCode, password, setPassword, joinError, joinLoading, handleJoin } = useJoinSessionByCode(navigation);

  // Session-expiry watch (lobby timer ran out, host hasn't started or
  // cancelled yet) now lives in one shared hook instead of being
  // duplicated per screen. This is also what fires the browser
  // notification and the 5-minute grace-period auto-cancel. Lobby.js
  // should use this SAME hook once it's updated, so a host sitting
  // inside their own lobby gets the identical Start/Cancel prompt
  // instead of the old version that only ever checked while parked here
  // on HostDashboard.
  const {
    expiredSession,
    visible: showExpiredModal,
    starting: expiredStarting,
    cancelling: expiredCancelling,
    graceSecondsLeft,
    graceTimeFormatted,
    startNow: startExpiredNow,
    cancelNow: cancelExpiredSession,
  } = useExpiredLobbyWatcher(upcoming);

  // Subscribes this browser to Web Push (asks for Notification
  // permission, registers the service worker) so check-expired-lobbies
  // can reach this host even with every tab closed.
  usePushSubscription();

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();

      const { data: profileData } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', user.id)
        .single();
      setProfile(profileData);

      const { data: sessions } = await supabase
        .from('sessions')
        .select('*')
        .eq('host_id', user.id)
        .order('created_at', { ascending: false });

      const upcomingSessions = (sessions || []).filter(s => s.status !== 'ended' && s.status !== 'cancelled');
      const recentSessions = (sessions || []).filter(s => s.status === 'ended').slice(0, 3);

      setUpcoming(upcomingSessions);
      setRecent(recentSessions);

      const { count } = await supabase
        .from('submissions')
        .select('*', { count: 'exact' })
        .eq('status', 'unseen')
        .in('session_id', (sessions || []).map(s => s.id));

      setUnreadCount(count || 0);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const copyCode = async (code) => {
    await Clipboard.setStringAsync(code || '');
    showAlert('Copied', `Code "${code}" copied!`);
  };

  const copyJoinLink = async (code) => {
    await Clipboard.setStringAsync(getSessionJoinLink(code));
    showAlert('Copied', 'Join link copied!');
  };

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color={palette.primary} />
        <Text style={styles.loadingText}>Loading your dashboard...</Text>
      </View>
    );
  }

  const getGreeting = () => {
    const hour = new Date().getHours();
    if (hour < 12) return 'Good morning,';
    if (hour < 17) return 'Good afternoon,';
    return 'Good evening,';
  };

  const getInitials = (name) => {
    if (!name) return 'U';
    return name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2);
  };

  return (
    <View style={styles.container}>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>

        <View style={styles.topBar}>
          <View style={styles.topBarLeft}>
            <View style={styles.greetingRow}>
              <Text style={styles.greeting}>{getGreeting()}</Text>
              <MaterialCommunityIcons name="hand-wave" size={16} color={palette.amber} style={styles.waveIcon} />
            </View>
            <Text style={styles.name}>{profile?.full_name || 'Host'}</Text>
            <Text style={styles.role}>Host Dashboard</Text>
          </View>
          <TouchableOpacity onPress={() => navigation.navigate('Profile')} activeOpacity={0.8}>
            <View style={styles.avatarContainer}>
              <View style={styles.avatar}>
                <Text style={styles.avatarText}>{getInitials(profile?.full_name)}</Text>
              </View>
              <View style={styles.onlineDot} />
            </View>
          </TouchableOpacity>
        </View>

        <TouchableOpacity activeOpacity={0.88} onPress={() => navigation.navigate('CreateSession')}>
          <LinearGradient
            colors={[palette.primaryBright, palette.primary, palette.primaryDeep]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={styles.newSessionBanner}
          >
            <View style={styles.newSessionIcon}>
              <Ionicons name="add" size={26} color={palette.primary} />
            </View>
            <View style={styles.newSessionText}>
              <Text style={styles.newSessionTitle}>New Session</Text>
              <Text style={styles.newSessionSubtitle}>Create a new online session</Text>
            </View>
            <View style={styles.newSessionArrow}>
              <Ionicons name="chevron-forward" size={18} color={palette.surface} />
            </View>
          </LinearGradient>
        </TouchableOpacity>

        {/* Join a Session — cross-entry point so a Host account can also
            attend someone else's session, same flow an Attendee account
            uses. */}
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

        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <View style={styles.sectionHeaderLeft}>
              <Ionicons name="calendar-outline" size={16} color={palette.ink} />
              <Text style={styles.sectionTitle}>Upcoming Sessions</Text>
            </View>
            <TouchableOpacity>
              <Text style={styles.viewAll}>View all</Text>
            </TouchableOpacity>
          </View>
          {upcoming.length === 0 ? (
            <View style={styles.emptyState}>
              <Ionicons name="rocket-outline" size={26} color={palette.neutralText} />
              <Text style={styles.emptyStateText}>No upcoming sessions. Create one!</Text>
            </View>
          ) : (
          upcoming.slice(0, 3).map((session, i) => (
              <View key={session.id} style={[styles.sessionCard, i === Math.min(upcoming.length, 3) - 1 && styles.rowNoBorder]}>
                <TouchableOpacity
                  style={styles.sessionCardMain}
                  activeOpacity={0.7}
                  onPress={() => navigation.navigate('Lobby', { session })}
                >
                  <View style={[styles.sessionModeIcon, { backgroundColor: (MODE_META[session.mode] || DEFAULT_MODE_META).soft }]}>
                    <ModeIcon mode={session.mode} size={19} />
                  </View>
                  <View style={styles.sessionInfo}>
                    <Text style={styles.sessionCardTitle} numberOfLines={1}>{session.title}</Text>
                    <Text style={styles.sessionTime}>Code {session.code} · {(MODE_META[session.mode]?.label) || session.mode}</Text>
                  </View>
                  {session.status === 'live' && (
                    <View style={styles.liveBadge}>
                      <View style={styles.liveDot} />
                      <Text style={styles.liveBadgeText}>Live</Text>
                    </View>
                  )}
                  <Ionicons name="chevron-forward" size={16} color={palette.neutralText} />
                </TouchableOpacity>

                <View style={styles.sessionCardCopyRow}>
                  <TouchableOpacity style={styles.sessionCopyBtn} onPress={() => copyCode(session.code)} activeOpacity={0.7}>
                    <Ionicons name="copy-outline" size={13} color={palette.primary} />
                    <Text style={styles.sessionCopyText}>Code</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.sessionCopyBtn} onPress={() => copyJoinLink(session.code)} activeOpacity={0.7}>
                    <Ionicons name="link-outline" size={13} color={palette.primary} />
                    <Text style={styles.sessionCopyText}>Link</Text>
                  </TouchableOpacity>
                </View>
              </View>
            ))
          )}
        </View>

        <View style={styles.bottomRow}>
          <View style={[styles.card, styles.cardLeft]}>
            <View style={styles.cardHeader}>
              <View style={styles.sectionHeaderLeft}>
                <Ionicons name="time-outline" size={14} color={palette.ink} />
                <Text style={styles.cardTitle}>Recent Sessions</Text>
              </View>
              <TouchableOpacity><Text style={styles.viewAllSmall}>View all</Text></TouchableOpacity>
            </View>
            {recent.length === 0 ? (
              <Text style={styles.emptyStateTextSmall}>No sessions yet</Text>
            ) : (
              recent.map(s => (
                <View key={s.id} style={styles.recentRow}>
                  <View style={[styles.recentIcon, { backgroundColor: (MODE_META[s.mode] || DEFAULT_MODE_META).soft }]}>
                    <ModeIcon mode={s.mode} size={14} />
                  </View>
                  <View style={styles.recentInfo}>
                    <Text style={styles.recentTitle} numberOfLines={1}>{s.title}</Text>
                  </View>
                  <View style={styles.noRecordBadge}>
                    <Text style={styles.noRecordText}>Ended</Text>
                  </View>
                </View>
              ))
            )}
          </View>

          <TouchableOpacity style={[styles.card, styles.cardRight]} onPress={() => navigation.navigate('SubmissionsInbox')} activeOpacity={0.85}>
            <View style={styles.sectionHeaderLeft}>
              <Ionicons name="file-tray-full-outline" size={14} color={palette.ink} />
              <Text style={styles.cardTitle}>Submissions</Text>
            </View>
            <View style={styles.inboxCenter}>
              <View style={styles.inboxIconWrap}>
                <Ionicons name="document-text-outline" size={30} color={palette.primary} />
                {unreadCount > 0 && (
                  <View style={styles.inboxBadge}>
                    <Text style={styles.inboxBadgeText}>{unreadCount}</Text>
                  </View>
                )}
              </View>
              <Text style={styles.inboxCount}>{unreadCount} unread</Text>
              <Text style={styles.inboxSub}>New file uploads{'\n'}from attendees</Text>
              <View style={styles.inboxButton}>
                <Text style={styles.inboxButtonText}>Open Inbox</Text>
              </View>
            </View>
          </TouchableOpacity>
        </View>

        <TouchableOpacity style={styles.banRow} onPress={() => navigation.navigate('BanManagement')} activeOpacity={0.8}>
          <View style={styles.banIconWrap}>
            <Ionicons name="shield-checkmark-outline" size={19} color={palette.danger} />
          </View>
          <View style={styles.banTextWrap}>
            <Text style={styles.banTitle}>Ban Management</Text>
            <Text style={styles.banSub}>Manage blocked attendees</Text>
          </View>
          <Ionicons name="chevron-forward" size={18} color={palette.neutralText} />
        </TouchableOpacity>

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
        <TouchableOpacity style={styles.navItem} onPress={() => navigation.navigate('SubmissionsInbox')} activeOpacity={0.7}>
          <Ionicons name="file-tray-full-outline" size={22} color={palette.neutralText} />
          <Text style={styles.navLabel}>Inbox</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.navItem} onPress={() => navigation.navigate('Profile')} activeOpacity={0.7}>
          <Ionicons name="person-circle-outline" size={22} color={palette.neutralText} />
          <Text style={styles.navLabel}>Profile</Text>
        </TouchableOpacity>
      </View>

      <SessionExpiredModal
        visible={showExpiredModal}
        sessionTitle={expiredSession?.title}
        onStart={() => startExpiredNow(navigation)}
        onCancel={() => cancelExpiredSession(loadData)}
        starting={expiredStarting}
        cancelling={expiredCancelling}
        graceSecondsLeft={graceSecondsLeft}
        graceTimeFormatted={graceTimeFormatted}
      />
    </View>
  );
}

const cardShadow = Platform.select({
  ios: { shadowColor: '#2A1A6B', shadowOffset: { width: 0, height: 6 }, shadowOpacity: 0.08, shadowRadius: 14 },
  android: { elevation: 3 },
  default: { boxShadow: '0 6px 18px rgba(42,26,107,0.08)' },
});

const bannerShadow = Platform.select({
  ios: { shadowColor: palette.primaryDeep, shadowOffset: { width: 0, height: 10 }, shadowOpacity: 0.28, shadowRadius: 20 },
  android: { elevation: 10 },
  default: { boxShadow: `0 10px 26px rgba(62,31,184,0.28)` },
});

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: palette.canvas },
  loadingContainer: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: palette.canvas, gap: 12 },
  loadingText: { color: palette.inkMuted, fontSize: 14, fontWeight: '500' },
  scroll: { padding: 20, paddingBottom: 108 },

  // ── Top bar ──
  topBar: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 22 },
  topBarLeft: { flex: 1, paddingRight: 12 },
  greetingRow: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  greeting: { fontSize: 13.5, color: palette.inkMuted, fontWeight: '600' },
  waveIcon: { marginTop: -1 },
  name: { fontSize: 25, fontWeight: '800', color: palette.ink, letterSpacing: -0.4, marginTop: 1 },
  role: { fontSize: 12.5, color: palette.inkMuted, marginTop: 2, fontWeight: '500' },
  avatarContainer: { position: 'relative' },
  avatar: { width: 52, height: 52, borderRadius: 26, backgroundColor: palette.primary, alignItems: 'center', justifyContent: 'center' },
  avatarText: { color: palette.surface, fontWeight: '700', fontSize: 16 },
  onlineDot: { position: 'absolute', bottom: 2, right: 2, width: 12, height: 12, borderRadius: 6, backgroundColor: palette.success, borderWidth: 2, borderColor: palette.surface },

  // ── New session banner ──
  newSessionBanner: { borderRadius: 22, padding: 20, flexDirection: 'row', alignItems: 'center', marginBottom: 22, ...bannerShadow },
  newSessionIcon: { width: 46, height: 46, borderRadius: 14, backgroundColor: palette.surface, alignItems: 'center', justifyContent: 'center', marginRight: 14 },
  newSessionText: { flex: 1 },
  newSessionTitle: { fontSize: 19, fontWeight: '800', color: palette.surface, letterSpacing: -0.3 },
  newSessionSubtitle: { fontSize: 12.5, color: 'rgba(255,255,255,0.82)', marginTop: 3, fontWeight: '500' },
  newSessionArrow: { width: 34, height: 34, borderRadius: 17, backgroundColor: 'rgba(255,255,255,0.2)', alignItems: 'center', justifyContent: 'center' },

  // ── Join card ──
  joinCard: { borderRadius: 22, padding: 20, marginBottom: 22, gap: 12, ...bannerShadow },
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
  sectionHeaderLeft: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  sectionTitle: { fontSize: 15.5, fontWeight: '800', color: palette.ink, letterSpacing: -0.2 },
  viewAll: { color: palette.primary, fontSize: 12.5, fontWeight: '700' },
  viewAllSmall: { color: palette.primary, fontSize: 11, fontWeight: '700' },
  emptyState: { paddingVertical: 24, alignItems: 'center', gap: 8 },
  emptyStateText: { color: palette.neutralText, fontSize: 13, fontWeight: '500' },
  emptyStateTextSmall: { color: palette.neutralText, fontSize: 12, fontWeight: '500', paddingVertical: 10 },

  // ── Upcoming session cards ──
  sessionCard: { paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: palette.line },
  rowNoBorder: { borderBottomWidth: 0 },
  sessionCardMain: { flexDirection: 'row', alignItems: 'center', gap: 11 },
  sessionModeIcon: { width: 40, height: 40, borderRadius: 13, alignItems: 'center', justifyContent: 'center' },
  sessionInfo: { flex: 1 },
  sessionCardTitle: { fontSize: 14, fontWeight: '700', color: palette.ink },
  sessionTime: { fontSize: 11.5, color: palette.inkMuted, marginTop: 2, fontWeight: '600' },
  liveBadge: { flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: palette.liveSoft, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8 },
  liveDot: { width: 5, height: 5, borderRadius: 2.5, backgroundColor: palette.live },
  liveBadgeText: { color: palette.live, fontSize: 10.5, fontWeight: '700' },
  sessionCardCopyRow: { flexDirection: 'row', gap: 8, marginTop: 9, marginLeft: 51 },
  sessionCopyBtn: { flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: palette.primarySoft, paddingHorizontal: 11, paddingVertical: 6, borderRadius: 9 },
  sessionCopyText: { fontSize: 11, fontWeight: '700', color: palette.primary },

  // ── Bottom row (recent + inbox) ──
  bottomRow: { flexDirection: 'row', gap: 12, marginBottom: 16 },
  card: { backgroundColor: palette.surface, borderRadius: 20, padding: 15, ...cardShadow },
  cardLeft: { flex: 1.6 },
  cardRight: { flex: 1, alignItems: 'center' },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 },
  cardTitle: { fontSize: 12.5, fontWeight: '800', color: palette.ink },
  recentRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 8, gap: 9 },
  recentIcon: { width: 30, height: 30, borderRadius: 9, alignItems: 'center', justifyContent: 'center' },
  recentInfo: { flex: 1 },
  recentTitle: { fontSize: 12, fontWeight: '600', color: palette.ink },
  noRecordBadge: { backgroundColor: palette.neutralSoft, paddingHorizontal: 7, paddingVertical: 3, borderRadius: 7 },
  noRecordText: { color: palette.neutralText, fontSize: 10, fontWeight: '700' },
  inboxCenter: { alignItems: 'center', paddingVertical: 6 },
  inboxIconWrap: { position: 'relative', marginBottom: 8, marginTop: 4 },
  inboxBadge: { position: 'absolute', top: -6, right: -10, backgroundColor: palette.danger, borderRadius: 10, minWidth: 20, height: 20, paddingHorizontal: 4, alignItems: 'center', justifyContent: 'center' },
  inboxBadgeText: { color: palette.surface, fontSize: 10, fontWeight: '700' },
  inboxCount: { fontSize: 16, fontWeight: '800', color: palette.ink },
  inboxSub: { fontSize: 11, color: palette.inkMuted, textAlign: 'center', marginTop: 4, lineHeight: 15, fontWeight: '500' },
  inboxButton: { marginTop: 10, borderRadius: 10, paddingHorizontal: 13, paddingVertical: 7, backgroundColor: palette.primarySoft },
  inboxButtonText: { color: palette.primary, fontSize: 11.5, fontWeight: '700' },

  // ── Ban row ──
  banRow: { backgroundColor: palette.surface, borderRadius: 16, padding: 15, flexDirection: 'row', alignItems: 'center', gap: 12, ...cardShadow },
  banIconWrap: { width: 38, height: 38, borderRadius: 12, backgroundColor: palette.dangerSoft, alignItems: 'center', justifyContent: 'center' },
  banTextWrap: { flex: 1 },
  banTitle: { fontSize: 14, fontWeight: '700', color: palette.ink },
  banSub: { fontSize: 11.5, color: palette.inkMuted, marginTop: 1, fontWeight: '500' },

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