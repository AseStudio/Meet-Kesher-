import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '../../theme/colors';
import { palette, cardShadow } from '../../theme/palette';
import { getModeColor, getModeSoft } from '../../lib/iconMeta';

// Where a guest (no account, no dashboard to go "back" to) lands once
// they're no longer in a live session — the session ended, the host
// removed them, or they tapped Leave themselves. See leaveSession() and
// the 'user-kicked' handler in AttendeeSession.js: both used to send
// EVERYONE to 'AttendeeDashboard' unconditionally, which doesn't exist
// for a guest since they never signed in. This is the guest-safe landing
// spot instead, with the two ways forward a guest actually has: make an
// account, or join another session the same way they joined this one.
const COPY = {
  ended: {
    icon: 'checkmark-done-circle-outline',
    title: 'Session Ended',
    subtitle: 'The host has ended this session. Thanks for joining!',
  },
  cancelled: {
    icon: 'close-circle-outline',
    title: 'Session Cancelled',
    subtitle: 'The host cancelled this session before it started.',
  },
  kicked: {
    icon: 'exit-outline',
    title: "You've Left the Session",
    subtitle: 'The host removed you from this session.',
  },
  left: {
    icon: 'exit-outline',
    title: "You've Left the Session",
    subtitle: 'Come back any time with a new session code.',
  },
};

export default function SessionEndedGuestScreen({ navigation, route }) {
  const session = route.params?.session;
  const reason = route.params?.reason || 'ended';
  const { icon, title, subtitle } = COPY[reason] || COPY.ended;
  // Same fix as LobbyScreen/EndSession: this was hard-coded to
  // palette.primary (fixed purple) instead of the session's mode
  // color, so the theming from the lobby dropped the moment a guest
  // landed here on session end/cancel/kick/leave. Drive it off the
  // session's mode like everywhere else in the live-session flow.
  const modeColor = getModeColor(session?.mode);
  const modeSoft = getModeSoft(session?.mode);

  return (
    <View style={styles.container}>
      <View style={[styles.iconWrap, { backgroundColor: modeSoft }]}>
        <Ionicons name={icon} size={48} color={modeColor} />
      </View>
      <Text style={styles.title}>{title}</Text>
      <Text style={styles.subtitle}>{subtitle}</Text>
      {session?.title && (
        <View style={styles.sessionBadge}>
          <Ionicons name="document-text-outline" size={13} color={palette.inkMuted} />
          <Text style={styles.sessionBadgeText}>{session.title}</Text>
        </View>
      )}

      <View style={styles.actions}>
        <TouchableOpacity style={[styles.primaryBtn, { backgroundColor: modeColor }]} onPress={() => navigation.navigate('SignUp')} activeOpacity={0.85}>
          <Text style={styles.primaryBtnText}>Create Account</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.secondaryBtn, { borderColor: modeColor }]} onPress={() => navigation.navigate('GuestJoin')} activeOpacity={0.85}>
          <Text style={[styles.secondaryBtnText, { color: modeColor }]}>Join a Session as Guest</Text>
        </TouchableOpacity>
      </View>

      <Text style={styles.hint}>
        Creating an account keeps your session history, unlocks chat, board access, and file
        submissions — no more re-entering a code and password every time.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: palette.canvas, alignItems: 'center', justifyContent: 'center', padding: 32 },
  iconWrap: { width: 100, height: 100, borderRadius: 50, backgroundColor: palette.primarySoft, alignItems: 'center', justifyContent: 'center', marginBottom: 24 },
  title: { fontSize: 26, fontWeight: '800', color: palette.ink, textAlign: 'center', marginBottom: 12 },
  subtitle: { fontSize: 15, color: palette.inkMuted, textAlign: 'center', lineHeight: 22, marginBottom: 20 },
  sessionBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: palette.surface, paddingHorizontal: 16, paddingVertical: 9, borderRadius: 20, marginBottom: 28, ...cardShadow,
  },
  sessionBadgeText: { fontSize: 13, fontWeight: '600', color: palette.ink },
  actions: { width: '100%', maxWidth: 340, gap: 12 },
  primaryBtn: { backgroundColor: palette.primary, paddingVertical: 16, borderRadius: 14, alignItems: 'center', ...cardShadow },
  primaryBtnText: { color: palette.surface, fontSize: 16, fontWeight: '700' },
  secondaryBtn: { backgroundColor: 'transparent', paddingVertical: 16, borderRadius: 14, alignItems: 'center', borderWidth: 1.5, borderColor: palette.primary },
  secondaryBtnText: { color: palette.primary, fontSize: 16, fontWeight: '700' },
  hint: { fontSize: 12, color: palette.inkMuted, textAlign: 'center', lineHeight: 18, marginTop: 24, maxWidth: 320 },
});