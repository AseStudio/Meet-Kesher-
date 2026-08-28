import React, { useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, Animated, Easing } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '../../theme/colors';
import { supabase } from '../../lib/supabase';
import { ModeIcon } from '../../lib/iconMeta';
import EnteringSessionTransition from '../../components/EnteringSessionTransition';

// Same deliberate hold LobbyScreen uses before swapping into the live
// session — 3s on both, so the hand-off feels identical whether you're
// the host, a signed-in attendee, or a guest.
const ENTER_SESSION_DELAY_MS = 3000;

// ─────────────────────────────────────────────────────────────────────
// The guest twin of LobbyScreen.
//
// LobbyScreen assumes a signed-in Supabase user throughout — initLobby
// opens with `if (!user) return`, and it inserts into session_attendees
// keyed on `user.id`, which a guest simply doesn't have. Rather than
// bolt guest-handling onto that (host countdown, cancel/expire grace
// period, music picker, attendee list — none of which a guest needs or
// can use), guests get their own screen: it does exactly one thing,
// wait for the session to go live, then hand off into AttendeeSession.
//
// route.params: { session, guest }
// ─────────────────────────────────────────────────────────────────────
export default function GuestWaitingScreen({ navigation, route }) {
  const session = route.params?.session;
  const guest = route.params?.guest || null;

  const [entering, setEntering] = useState(false);
  const enteringRef = useRef(false);
  const pulse = useRef(new Animated.Value(0)).current;
  const mountedRef = useRef(true);
  const enteringTimeoutRef = useRef(null);

  useEffect(() => {
    mountedRef.current = true;

    Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 1200, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0, duration: 1200, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
      ])
    ).start();

    // Catches the case where the session already went live/was cancelled
    // in the moment between GuestJoinScreen fetching it and this screen's
    // realtime listener actually subscribing — the listener below only
    // sees changes that happen after it's live.
    const checkNow = async () => {
      if (!session?.id) return;
      const { data } = await supabase.from('sessions').select('*').eq('id', session.id).single();
      if (!mountedRef.current || !data) return;
      if (data.status === 'live') goLive(data);
      else if (data.status === 'cancelled') goCancelled();
    };
    checkNow();

    const channel = session?.id
      ? supabase
          .channel(`guest-waiting-${session.id}-${Date.now()}`)
          .on(
            'postgres_changes',
            { event: 'UPDATE', schema: 'public', table: 'sessions', filter: `id=eq.${session.id}` },
            (payload) => {
              if (payload.new.status === 'live') goLive(payload.new);
              else if (payload.new.status === 'cancelled') goCancelled();
            }
          )
          .subscribe()
      : null;

    return () => {
      mountedRef.current = false;
      if (channel) supabase.removeChannel(channel);
      if (enteringTimeoutRef.current) clearTimeout(enteringTimeoutRef.current);
    };
  }, []);

  const goLive = (liveSession) => {
    if (enteringRef.current) return;
    enteringRef.current = true;
    setEntering(true);
    enteringTimeoutRef.current = setTimeout(() => {
      navigation.replace('AttendeeSession', { session: liveSession, guest });
    }, ENTER_SESSION_DELAY_MS);
  };

  const goCancelled = () => {
    if (enteringRef.current) return;
    enteringRef.current = true;
    navigation.replace('SessionEndedGuest', { session, reason: 'cancelled' });
  };

  if (entering) {
    return <EnteringSessionTransition message="Entering session" />;
  }

  const pulseScale = pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.12] });
  const pulseOpacity = pulse.interpolate({ inputRange: [0, 1], outputRange: [0.5, 0.15] });

  return (
    <View style={styles.container}>
      <View style={styles.iconWrap}>
        <Animated.View style={[styles.pulseRing, { transform: [{ scale: pulseScale }], opacity: pulseOpacity }]} />
        <Ionicons name="hourglass-outline" size={40} color={colors.primary} />
      </View>

      <Text style={styles.title}>Waiting for the Host</Text>
      <Text style={styles.subtitle}>
        This meeting hasn't started yet. You'll be dropped straight in the moment the host starts it — no need to
        refresh or do anything else.
      </Text>

      {session?.title ? (
        <View style={styles.sessionCard}>
          <View style={styles.sessionCardTop}>
            <ModeIcon mode={session?.mode} size={13} color={colors.primary} />
            <Text style={styles.sessionMode}>{session?.mode || 'Session'}</Text>
          </View>
          <Text style={styles.sessionTitle}>{session.title}</Text>
          {guest?.name ? <Text style={styles.sessionGuest}>Joining as {guest.name}</Text> : null}
        </View>
      ) : null}

      <View style={styles.statusRow}>
        <View style={styles.statusDot} />
        <Text style={styles.statusText}>In the lobby — still waiting for the host</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background, alignItems: 'center', justifyContent: 'center', padding: 32 },
  iconWrap: {
    width: 92, height: 92, borderRadius: 46,
    backgroundColor: colors.greyLight,
    alignItems: 'center', justifyContent: 'center',
    marginBottom: 24,
  },
  pulseRing: {
    position: 'absolute',
    width: 92, height: 92, borderRadius: 46,
    backgroundColor: colors.primary,
  },
  title: { fontSize: 24, fontWeight: '800', color: colors.text, textAlign: 'center', marginBottom: 10 },
  subtitle: { fontSize: 14.5, color: colors.textLight, textAlign: 'center', lineHeight: 21, maxWidth: 340, marginBottom: 24 },
  sessionCard: {
    width: '100%', maxWidth: 340,
    backgroundColor: colors.white,
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: colors.greyLight,
    marginBottom: 20,
  },
  sessionCardTop: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 6 },
  sessionMode: { fontSize: 11, fontWeight: '700', color: colors.primary, textTransform: 'capitalize' },
  sessionTitle: { fontSize: 16, fontWeight: '800', color: colors.text },
  sessionGuest: { fontSize: 12.5, color: colors.textLight, marginTop: 4, fontWeight: '500' },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  statusDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.primary },
  statusText: { fontSize: 12.5, color: colors.textLight, fontWeight: '600' },
});
