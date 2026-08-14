import React, { useState, useEffect, useRef } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity,
  ScrollView, ActivityIndicator, Platform, Alert
} from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { colors } from '../../theme/colors';
import { supabase } from '../../lib/supabase';
import { LOBBY_DURATION_SECONDS } from '../../lib/constants';
import { getSessionJoinLink } from '../../lib/links';
import SessionExpiredModal from '../../components/SessionExpiredModal';
import EnteringSessionTransition from '../../components/EnteringSessionTransition';

// ─────────────────────────────────────────────────────────────────────
// PALETTE — same tokens/mapping as the other production-pass screens
// (HostDashboard / AttendeeDashboard / CreateSession / Profile / Login
// / SignUp / SubmissionsInbox / BanManagement / GuestJoin).
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
  neutralSoft: colors.greyLight,
  neutralText: colors.grey,
};

// Same mode → icon mapping used on CreateSession / the dashboards /
// AttendeeSession, so a session's mode badge looks identical everywhere
// it shows up across the app.
const MODE_ICON_META = {
  classroom:   { icon: 'school-outline',    set: 'ion' },
  interview:   { icon: 'briefcase-outline', set: 'ion' },
  meeting:     { icon: 'people-outline',    set: 'ion' },
  gettogether: { icon: 'party-popper',      set: 'mci' },
};
const DEFAULT_MODE_ICON = { icon: 'calendar-outline', set: 'ion' };
function ModeIcon({ mode, size = 13, color = palette.surface }) {
  const meta = MODE_ICON_META[mode] || DEFAULT_MODE_ICON;
  const IconSet = meta.set === 'mci' ? MaterialCommunityIcons : Ionicons;
  return <IconSet name={meta.icon} size={size} color={color} />;
}

const MUSIC_TRACKS = [
  { id: 1, name: 'Calm Lounge', icon: 'piano', set: 'mci', url: 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-1.mp3' },
  { id: 2, name: 'Easy Jazz', icon: 'saxophone', set: 'mci', url: 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-2.mp3' },
  { id: 3, name: 'Soft Ambient', icon: 'water-outline', set: 'ion', url: 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-3.mp3' },
  { id: 4, name: 'Upbeat Piano', icon: 'musical-notes-outline', set: 'ion', url: 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-4.mp3' },
];
function TrackIcon({ track, size = 16, color = palette.ink }) {
  const IconSet = track.set === 'mci' ? MaterialCommunityIcons : Ionicons;
  return <IconSet name={track.icon} size={size} color={color} />;
}

const GRACE_PERIOD_SECONDS = 5 * 60; // 5 minutes
// Deliberate hold on the entering-session transition before actually
// swapping screens, regardless of how fast the session was actually
// ready — see enterSessionWithTransition below.
const ENTER_SESSION_DELAY_MS = 10000;

const getSharedSeconds = (createdAt) => {
  if (!createdAt) return LOBBY_DURATION_SECONDS;
  const start = new Date(createdAt).getTime();
  const elapsed = Math.floor((Date.now() - start) / 1000);
  return Math.max(0, LOBBY_DURATION_SECONDS - elapsed);
};

export default function LobbyScreen({ navigation, route }) {
  const session = route.params?.session;

  const [seconds, setSeconds] = useState(() => getSharedSeconds(session?.created_at));
  const [isHost, setIsHost] = useState(false);
  const [attendees, setAttendees] = useState([]);
  const [starting, setStarting] = useState(false);
  const [showMusicPanel, setShowMusicPanel] = useState(false);
  const [playingTrackId, setPlayingTrackId] = useState(null);

  // Expiry + cancel handling
  const [showExpiredModal, setShowExpiredModal] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [wasCancelled, setWasCancelled] = useState(false);
  const [graceSecondsLeft, setGraceSecondsLeft] = useState(null); // null = not in grace period

  // True while we're holding on the entering-session transition screen,
  // waiting out ENTER_SESSION_DELAY_MS before actually navigating into
  // SessionMain/AttendeeSession. See enterSessionWithTransition.
  const [entering, setEntering] = useState(false);

  // Purely local UI feedback for the copy buttons — 'code' | 'link' |
  // null. The copy itself uses expo-clipboard now (cross-platform),
  // this just swaps the intrusive browser alert() for the same inline
  // "Copied" state CreateSession's copy buttons use.
  const [copiedField, setCopiedField] = useState(null);

  const isHostRef = useRef(false);
  const expiredModalShownRef = useRef(false);
  const sessionStartedRef = useRef(false);
  const audioRef = useRef(null);
  const timerRef = useRef(null);
  const enteringTimeoutRef = useRef(null);

  useEffect(() => {
    initLobby();
    startTimer();
    // setupSessionListener/setupWaitlistListener each return a cleanup
    // function (supabase.removeChannel). Previously these were called
    // but their cleanups were thrown away, so every mount left its two
    // realtime channels subscribed forever — a growing pile of orphaned
    // listeners across any back-and-forth navigation, each one firing
    // again (duplicate navigations, duplicate "session cancelled"
    // alerts) once enough had built up. Capturing and calling them here
    // is the actual fix.
    const cleanupSessionListener = setupSessionListener();
    const cleanupWaitlistListener = setupWaitlistListener();
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      if (enteringTimeoutRef.current) clearTimeout(enteringTimeoutRef.current);
      stopMusic();
      cleanupSessionListener?.();
      cleanupWaitlistListener?.();
    };
  }, []);

  // Show expired modal + start 5-minute grace when timer hits 0
  useEffect(() => {
    if (
      seconds === 0 &&
      isHostRef.current &&
      !expiredModalShownRef.current &&
      !wasCancelled &&
      !sessionStartedRef.current
    ) {
      expiredModalShownRef.current = true;
      setShowExpiredModal(true);
      setGraceSecondsLeft(GRACE_PERIOD_SECONDS);
    }
  }, [seconds, wasCancelled]);

  // 5-minute grace countdown → auto-cancel
  useEffect(() => {
    if (graceSecondsLeft === null) return;

    if (graceSecondsLeft <= 0) {
      cancelSession();
      return;
    }

    const timer = setTimeout(() => {
      setGraceSecondsLeft((prev) => (prev !== null ? prev - 1 : null));
    }, 1000);

    return () => clearTimeout(timer);
  }, [graceSecondsLeft]);

  const startTimer = () => {
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = setInterval(() => {
      setSeconds((prev) => {
        if (prev <= 1) {
          clearInterval(timerRef.current);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
  };

  // Every path that discovers "the session is actually live now" — the
  // realtime listener below, and the on-mount stale-session fallback in
  // initLobby — funnels through here instead of navigating immediately.
  // This holds on the purple entering-session screen for a flat
  // ENTER_SESSION_DELAY_MS regardless of how fast things actually became
  // ready (deliberate, not a real loading wait), then navigates. Host
  // and attendee get identical behavior since both call this same
  // function.
  const enterSessionWithTransition = (targetSession, goToHostScreen) => {
    setEntering(true);
    if (enteringTimeoutRef.current) clearTimeout(enteringTimeoutRef.current);
    enteringTimeoutRef.current = setTimeout(() => {
      navigation.navigate(goToHostScreen ? 'SessionMain' : 'AttendeeSession', { session: targetSession });
    }, ENTER_SESSION_DELAY_MS);
  };

  const initLobby = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const host = user.id === session?.host_id;
      setIsHost(host);
      isHostRef.current = host;

      if (!host && session?.id) {
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

      await loadAttendees();

      // The `session` we were handed can be stale — it may have been
      // fetched moments (or screens) before this mounted, e.g. from a
      // list that isn't refetched right before navigating. The realtime
      // listener below only reacts to status changes that happen AFTER
      // it subscribes, so if the host already started or cancelled in
      // that gap, there's no future event left to catch it — this
      // screen would just sit showing a stale/frozen countdown forever.
      // One fresh check on mount closes that gap; realtime still handles
      // everything that happens while this stays mounted.
      if (session?.id) {
        const { data: freshSession } = await supabase
          .from('sessions')
          .select('*')
          .eq('id', session.id)
          .single();

        if (freshSession?.status === 'live') {
          sessionStartedRef.current = true;
          if (timerRef.current) clearInterval(timerRef.current);
          stopMusic();
          enterSessionWithTransition(freshSession, user.id === freshSession.host_id);
          return;
        }

        if (freshSession?.status === 'cancelled' && user.id !== freshSession.host_id) {
          setWasCancelled(true);
        }
      }
    } catch (e) {
      console.log('initLobby error:', e.message);
    }
  };

  const loadAttendees = async () => {
    if (!session?.id) return;
    try {
      const { data } = await supabase
        .from('session_attendees')
        .select('*, profiles(full_name)')
        .eq('session_id', session.id)
        .is('left_at', null);
      setAttendees(data || []);
    } catch (e) {}
  };

  const setupWaitlistListener = () => {
    if (!session?.id) return;
    const ch = supabase
      .channel(`waitlist-${session.id}-${Date.now()}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'session_attendees',
          filter: `session_id=eq.${session.id}`,
        },
        () => loadAttendees()
      )
      .subscribe();
    return () => supabase.removeChannel(ch);
  };

  const setupSessionListener = () => {
    if (!session?.id) return;
    const ch = supabase
      .channel(`lobby-session-${session.id}-${Date.now()}`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'sessions',
          filter: `id=eq.${session.id}`,
        },
        async (payload) => {
          if (payload.new.status === 'live') {
            sessionStartedRef.current = true;
            setGraceSecondsLeft(null);
            if (timerRef.current) clearInterval(timerRef.current);
            stopMusic();
            const { data: { user } } = await supabase.auth.getUser();
            enterSessionWithTransition(payload.new, user?.id === payload.new.host_id);
          }
          if (payload.new.status === 'cancelled') {
            stopMusic();
            setGraceSecondsLeft(null);
            const { data: { user } } = await supabase.auth.getUser();
            if (user?.id !== payload.new.host_id) {
              Alert.alert('Session cancelled', 'The host cancelled this session.');
              navigation.navigate('AttendeeDashboard');
            }
          }
        }
      )
      .subscribe();
    return () => supabase.removeChannel(ch);
  };

  const startSession = async () => {
    if (!isHostRef.current) return;
    if (starting) return;
    setStarting(true);
    sessionStartedRef.current = true;
    setGraceSecondsLeft(null); // stop grace timer
    if (timerRef.current) clearInterval(timerRef.current);
    stopMusic();
    try {
      const { error } = await supabase
        .from('sessions')
        // last_seen_at stamped right here, at the moment of going live —
        // not left purely to SessionMain's own heartbeat once it mounts.
        // There's a real gap before that first heartbeat (the "Entering
        // Session" transition alone holds for 10s) — without a fresh
        // timestamp set here, check-expired-lobbies' stale-live-session
        // check could catch a session that JUST started before the host's
        // client ever gets a chance to prove it's actually there.
        .update({ status: 'live', last_seen_at: new Date().toISOString() })
        .eq('id', session.id);
      if (error) throw error;
      setShowExpiredModal(false);
      // Navigation happens via the realtime listener (which now goes
      // through enterSessionWithTransition too, same as everyone else)
    } catch (err) {
      Alert.alert('Could not start session', err.message);
      setStarting(false);
      sessionStartedRef.current = false;
      setGraceSecondsLeft(GRACE_PERIOD_SECONDS); // restart grace if start failed
    }
  };

  const cancelSession = async () => {
    if (!isHostRef.current) return;
    if (cancelling) return;
    setCancelling(true);
    setGraceSecondsLeft(null); // stop grace timer
    stopMusic();
    try {
      const { error } = await supabase
        .from('sessions')
        .update({ status: 'cancelled' })
        .eq('id', session.id);
      if (error) throw error;
      setShowExpiredModal(false);
      setWasCancelled(true);
    } catch (err) {
      Alert.alert('Could not cancel session', err.message);
    } finally {
      setCancelling(false);
    }
  };

  // Music
  const playTrack = async (track) => {
    await stopMusic();
    try {
      if (Platform.OS === 'web') {
        const audio = new window.Audio(track.url);
        audio.loop = true;
        audio.volume = 0.4;
        audio.play().catch((e) => console.log('Audio blocked:', e.message));
        audioRef.current = audio;
        setPlayingTrackId(track.id);
      } else {
        const { Audio } = require('expo-av');
        await Audio.setAudioModeAsync({ playsInSilentModeIOS: true });
        const { sound } = await Audio.Sound.createAsync(
          { uri: track.url },
          { shouldPlay: true, isLooping: true, volume: 0.4 }
        );
        audioRef.current = sound;
        setPlayingTrackId(track.id);
      }
    } catch (e) {
      console.log('Music error:', e.message);
    }
  };

  const stopMusic = async () => {
    try {
      if (Platform.OS === 'web') {
        if (audioRef.current) {
          audioRef.current.pause();
          audioRef.current.src = '';
          audioRef.current = null;
        }
      } else {
        if (audioRef.current?.stopAsync) {
          await audioRef.current.stopAsync();
          await audioRef.current.unloadAsync();
          audioRef.current = null;
        }
      }
    } catch (e) {}
    setPlayingTrackId(null);
  };

  const copyToClipboard = async (text, field) => {
    await Clipboard.setStringAsync(text || '');
    setCopiedField(field);
    setTimeout(() => setCopiedField((cur) => (cur === field ? null : cur)), 1600);
  };

  const mins = Math.floor(seconds / 60).toString().padStart(2, '0');
  const secs = (seconds % 60).toString().padStart(2, '0');
  const getInitials = (name) =>
    (name || 'G')
      .split(' ')
      .map((n) => n[0])
      .join('')
      .slice(0, 2)
      .toUpperCase();
  const currentTrack = MUSIC_TRACKS.find((t) => t.id === playingTrackId);

  const formatGraceTime = (secs) => {
    if (secs === null) return null;
    const m = Math.floor(secs / 60).toString().padStart(2, '0');
    const s = (secs % 60).toString().padStart(2, '0');
    return `${m}:${s}`;
  };

  // Holding on the entering-session transition — takes priority over
  // everything else below since it's the most time-sensitive state.
  if (entering) {
    return <EnteringSessionTransition />;
  }

  // Host cancelled — terminal state
  if (wasCancelled) {
    return (
      <View style={styles.cancelledContainer}>
        <View style={styles.cancelledIconWrap}>
          <Ionicons name="close-circle-outline" size={40} color={palette.danger} />
        </View>
        <Text style={styles.cancelledTitle}>Session Cancelled</Text>
        <Text style={styles.cancelledSubtitle}>
          "{session?.title}" has been cancelled. Attendees in the lobby have been notified.
        </Text>
        <TouchableOpacity
          style={styles.cancelledBtn}
          onPress={() => navigation.navigate('HostDashboard')}
          activeOpacity={0.85}
        >
          <Text style={styles.cancelledBtnText}>Back to Dashboard</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <ScrollView contentContainerStyle={styles.scroll}>
        {/* Header */}
        <View style={styles.header}>
          <View style={{ flex: 1 }}>
            <Text style={styles.sessionTitle}>{session?.title || 'Loading...'}</Text>
            <View style={styles.modeBadge}>
              <ModeIcon mode={session?.mode} size={12} color={palette.surface} />
              <Text style={styles.modeBadgeText}>{session?.mode}</Text>
            </View>
          </View>
          <View style={styles.codeArea}>
            <View style={styles.codeBadge}>
              <Text style={styles.codeLabel}>Code</Text>
              <Text style={styles.codeValue}>{session?.code}</Text>
            </View>
            <TouchableOpacity
              style={[styles.copyBtn, copiedField === 'code' && styles.copyBtnDone]}
              onPress={() => copyToClipboard(session?.code || '', 'code')}
              activeOpacity={0.75}
            >
              <Ionicons name={copiedField === 'code' ? 'checkmark' : 'copy-outline'} size={15} color={copiedField === 'code' ? palette.success : palette.primary} />
              <Text style={[styles.copyBtnText, copiedField === 'code' && { color: palette.success }]}>{copiedField === 'code' ? 'Copied' : 'Copy'}</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.copyBtn, copiedField === 'link' && styles.copyBtnDone]}
              onPress={() => copyToClipboard(getSessionJoinLink(session?.code), 'link')}
              activeOpacity={0.75}
            >
              <Ionicons name={copiedField === 'link' ? 'checkmark' : 'link-outline'} size={15} color={copiedField === 'link' ? palette.success : palette.primary} />
              <Text style={[styles.copyBtnText, copiedField === 'link' && { color: palette.success }]}>{copiedField === 'link' ? 'Copied' : 'Link'}</Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* Timer */}
        <View
          style={[
            styles.timerCard,
            seconds === 0 && styles.timerCardGreen,
            seconds <= 30 && seconds > 0 && styles.timerCardRed,
          ]}
        >
          <View style={{ flex: 1 }}>
            <View style={styles.timerLabelRow}>
              {seconds === 0 && isHost && <Ionicons name="alarm-outline" size={14} color={palette.danger} />}
              <Text style={styles.timerLabel}>
                {seconds === 0
                  ? isHost
                    ? 'Decide: start now or cancel'
                    : 'Waiting for host to start...'
                  : isHost
                    ? 'You can start anytime — or wait for the timer'
                    : 'Waiting for host to start...'}
              </Text>
            </View>
            {seconds > 0 && (
              <Text style={styles.timerNote}>
                Everyone sees the same timer — synced to session creation time
              </Text>
            )}
          </View>
          <Text
            style={[
              styles.timerCountdown,
              seconds === 0 && styles.timerGreenText,
              seconds <= 30 && seconds > 0 && styles.timerRedText,
            ]}
          >
            {mins}:{secs}
          </Text>
        </View>

        {/* Waiting card for attendees */}
        {!isHost && (
          <View style={styles.waitingCard}>
            <ActivityIndicator size="small" color={palette.primary} />
            <View style={{ flex: 1 }}>
              <Text style={styles.waitingTitle}>Waiting for host...</Text>
              <View style={styles.waitingNoteRow}>
                <Text style={styles.waitingNote}>You'll move in automatically when the session begins</Text>
                <Ionicons name="rocket-outline" size={13} color={palette.primary} />
              </View>
            </View>
          </View>
        )}

        {/* Two columns */}
        <View style={styles.twoCol}>
          {/* Attendee list */}
          <View style={styles.colCard}>
            <View style={styles.colTopRow}>
              <Text style={styles.colHeader}>IN LOBBY</Text>
              <View style={styles.countBadge}>
                <Text style={styles.countBadgeText}>{attendees.length}</Text>
              </View>
              <View style={styles.livePill}>
                <View style={styles.livePillDot} />
                <Text style={styles.livePillText}>LIVE</Text>
              </View>
            </View>

            {attendees.length === 0 ? (
              <Text style={styles.emptyNote}>No one here yet...</Text>
            ) : (
              attendees.slice(0, 8).map((a, i) => (
                <View key={a.id || i} style={styles.attendeeRow}>
                  <View style={styles.attendeeAvatar}>
                    <Text style={styles.attendeeAvatarText}>
                      {getInitials(a.profiles?.full_name || a.guest_name)}
                    </Text>
                  </View>
                  <Text style={styles.attendeeName} numberOfLines={1}>
                    {a.profiles?.full_name || a.guest_name || 'Guest'}
                  </Text>
                  <View style={styles.readyDot} />
                </View>
              ))
            )}

            {attendees.length > 8 && (
              <Text style={styles.moreText}>+{attendees.length - 8} more</Text>
            )}

            {!isHost && (
              <TouchableOpacity
                style={styles.submitBtn}
                onPress={() => navigation.navigate('SubmitFile')}
                activeOpacity={0.85}
              >
                <Ionicons name="attach-outline" size={15} color={palette.surface} />
                <Text style={styles.submitText}>Submit a File</Text>
              </TouchableOpacity>
            )}
          </View>

          {/* Host controls */}
          {isHost && (
            <View style={styles.colCard}>
              <Text style={styles.colHeader}>HOST CONTROLS</Text>

              <View style={styles.capacityCard}>
                <View style={styles.capacityRow}>
                  <Text style={styles.capacityLabel}>Attendees</Text>
                  <Text style={styles.capacityValue}>
                    {attendees.length} / {session?.max_attendees || 50}
                  </Text>
                </View>
                <View style={styles.capacityBar}>
                  <View
                    style={[
                      styles.capacityFill,
                      {
                        width: `${Math.min(
                          100,
                          (attendees.length / (session?.max_attendees || 50)) * 100
                        )}%`,
                      },
                    ]}
                  />
                </View>
              </View>

              <TouchableOpacity
                style={styles.musicToggle}
                onPress={() => setShowMusicPanel(!showMusicPanel)}
                activeOpacity={0.8}
              >
                <Ionicons name={playingTrackId ? 'volume-high-outline' : 'musical-notes-outline'} size={16} color={palette.primary} />
                <Text style={styles.musicLabel}>
                  {currentTrack ? currentTrack.name : 'Lobby Music'}
                </Text>
                <Ionicons name={showMusicPanel ? 'chevron-up' : 'chevron-down'} size={14} color={palette.neutralText} />
              </TouchableOpacity>

              {showMusicPanel && (
                <View style={styles.musicList}>
                  {MUSIC_TRACKS.map((track) => (
                    <TouchableOpacity
                      key={track.id}
                      style={[
                        styles.trackRow,
                        playingTrackId === track.id && styles.trackRowActive,
                      ]}
                      onPress={() =>
                        playingTrackId === track.id ? stopMusic() : playTrack(track)
                      }
                      activeOpacity={0.8}
                    >
                      <TrackIcon track={track} size={16} color={playingTrackId === track.id ? palette.primary : palette.ink} />
                      <Text
                        style={[
                          styles.trackName,
                          playingTrackId === track.id && styles.trackNameActive,
                        ]}
                      >
                        {track.name}
                      </Text>
                      <Ionicons name={playingTrackId === track.id ? 'stop-circle-outline' : 'play-circle-outline'} size={18} color={playingTrackId === track.id ? palette.primary : palette.neutralText} />
                    </TouchableOpacity>
                  ))}
                  {playingTrackId && (
                    <TouchableOpacity style={styles.stopBtn} onPress={stopMusic} activeOpacity={0.8}>
                      <Ionicons name="volume-mute-outline" size={14} color={palette.danger} />
                      <Text style={styles.stopBtnText}>Stop Music</Text>
                    </TouchableOpacity>
                  )}
                </View>
              )}

              <TouchableOpacity
                style={styles.earlyCancelLink}
                onPress={() => {
                  Alert.alert(
                    'Cancel this session before it starts?',
                    undefined,
                    [
                      { text: 'No', style: 'cancel' },
                      { text: 'Cancel session', style: 'destructive', onPress: cancelSession },
                    ]
                  );
                }}
              >
                <Text style={styles.earlyCancelText}>Cancel this session</Text>
              </TouchableOpacity>
            </View>
          )}
        </View>

        {/* Start button */}
        {isHost && (
          <TouchableOpacity
            style={[styles.startBtn, starting && styles.startBtnDisabled]}
            onPress={startSession}
            disabled={starting}
            activeOpacity={0.85}
          >
            {starting ? (
              <ActivityIndicator color={palette.surface} />
            ) : (
              <>
                <Ionicons name="rocket-outline" size={18} color={palette.surface} />
                <Text style={styles.startBtnText}>Start Session for Everyone</Text>
              </>
            )}
          </TouchableOpacity>
        )}
      </ScrollView>

      <SessionExpiredModal
        visible={showExpiredModal}
        sessionTitle={session?.title}
        onStart={startSession}
        onCancel={cancelSession}
        starting={starting}
        cancelling={cancelling}
        graceSecondsLeft={graceSecondsLeft}
        graceTimeFormatted={formatGraceTime(graceSecondsLeft)}
      />
    </View>
  );
}

const cardShadow = Platform.select({
  ios: { shadowColor: '#2A1A6B', shadowOffset: { width: 0, height: 5 }, shadowOpacity: 0.07, shadowRadius: 12 },
  android: { elevation: 2 },
  default: { boxShadow: '0 5px 14px rgba(42,26,107,0.07)' },
});

const buttonShadow = Platform.select({
  ios: { shadowColor: palette.primaryDeep, shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.26, shadowRadius: 16 },
  android: { elevation: 8 },
  default: { boxShadow: `0 8px 20px rgba(58,15,217,0.26)` },
});

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: palette.canvas },
  scroll: { padding: 20, paddingBottom: 50, gap: 14 },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: 12,
  },
  sessionTitle: { fontSize: 21, fontWeight: '800', color: palette.ink, flexShrink: 1, letterSpacing: -0.4 },
  modeBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    backgroundColor: palette.primary,
    alignSelf: 'flex-start',
    paddingHorizontal: 11,
    paddingVertical: 5,
    borderRadius: 20,
    marginTop: 7,
  },
  modeBadgeText: { color: palette.surface, fontSize: 11.5, fontWeight: '700', textTransform: 'capitalize' },
  codeArea: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  codeBadge: {
    backgroundColor: palette.surface,
    borderRadius: 13,
    padding: 10,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: palette.line,
    minWidth: 80,
    ...cardShadow,
  },
  codeLabel: { fontSize: 10, color: palette.inkMuted, fontWeight: '700' },
  codeValue: {
    fontSize: 18,
    fontWeight: '800',
    color: palette.primary,
    letterSpacing: 2,
  },
  copyBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: palette.surface,
    borderRadius: 11,
    paddingHorizontal: 10,
    paddingVertical: 9,
    borderWidth: 1,
    borderColor: palette.line,
    ...cardShadow,
  },
  copyBtnDone: { borderColor: palette.success, backgroundColor: palette.successSoft },
  copyBtnText: { fontSize: 11, fontWeight: '700', color: palette.primary },
  timerCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: palette.surface,
    borderRadius: 17,
    padding: 16,
    borderWidth: 1,
    borderColor: palette.line,
    ...cardShadow,
  },
  timerCardGreen: { borderColor: palette.success, backgroundColor: palette.successSoft },
  timerCardRed: { borderColor: palette.danger, backgroundColor: palette.dangerSoft },
  timerLabelRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  timerLabel: { fontSize: 13.5, fontWeight: '700', color: palette.ink, flexShrink: 1 },
  timerNote: { fontSize: 11, color: palette.inkMuted, marginTop: 4, fontWeight: '500' },
  timerCountdown: {
    fontSize: 38,
    fontWeight: '800',
    color: palette.primary,
    fontVariant: ['tabular-nums'],
    letterSpacing: -1,
  },
  timerGreenText: { color: palette.success },
  timerRedText: { color: palette.danger },
  waitingCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: palette.primarySoft,
    borderRadius: 15,
    padding: 14,
    borderWidth: 1,
    borderColor: palette.primary,
  },
  waitingTitle: { fontSize: 13.5, fontWeight: '700', color: palette.primary },
  waitingNoteRow: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 2, flexWrap: 'wrap' },
  waitingNote: { fontSize: 11.5, color: palette.inkMuted, fontWeight: '500' },
  twoCol: { flexDirection: 'row', gap: 12 },
  colCard: {
    flex: 1,
    backgroundColor: palette.surface,
    borderRadius: 17,
    padding: 14,
    gap: 10,
    ...cardShadow,
  },
  colTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 4,
  },
  colHeader: {
    fontSize: 10.5,
    fontWeight: '800',
    color: palette.inkMuted,
    letterSpacing: 0.6,
    flex: 1,
  },
  countBadge: {
    backgroundColor: palette.primary,
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
  },
  countBadgeText: { color: palette.surface, fontSize: 11, fontWeight: '700' },
  livePill: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: palette.successSoft,
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 6,
  },
  livePillDot: { width: 5, height: 5, borderRadius: 2.5, backgroundColor: palette.success },
  livePillText: { color: palette.success, fontSize: 9, fontWeight: '700' },
  emptyNote: {
    color: palette.neutralText,
    fontSize: 13,
    textAlign: 'center',
    paddingVertical: 10,
    fontWeight: '500',
  },
  attendeeRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  attendeeAvatar: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: palette.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  attendeeAvatarText: { color: palette.surface, fontSize: 11, fontWeight: '700' },
  attendeeName: { flex: 1, fontSize: 13, color: palette.ink, fontWeight: '600' },
  readyDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: palette.success },
  moreText: { fontSize: 12, color: palette.inkMuted, textAlign: 'center', fontWeight: '500' },
  submitBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: palette.primary,
    borderRadius: 11,
    paddingVertical: 10,
  },
  submitText: { color: palette.surface, fontSize: 13, fontWeight: '700' },
  capacityCard: {
    backgroundColor: palette.neutralSoft,
    borderRadius: 12,
    padding: 10,
    gap: 6,
  },
  capacityRow: { flexDirection: 'row', justifyContent: 'space-between' },
  capacityLabel: { fontSize: 12, color: palette.inkMuted, fontWeight: '600' },
  capacityValue: { fontSize: 13, fontWeight: '800', color: palette.ink },
  capacityBar: {
    height: 6,
    backgroundColor: 'rgba(0,0,0,0.08)',
    borderRadius: 3,
    overflow: 'hidden',
  },
  capacityFill: { height: 6, backgroundColor: palette.primary, borderRadius: 3 },
  musicToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: palette.neutralSoft,
    borderRadius: 11,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  musicLabel: { flex: 1, fontSize: 13, fontWeight: '600', color: palette.ink },
  musicList: { gap: 6 },
  trackRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    padding: 10,
    borderRadius: 11,
    backgroundColor: palette.neutralSoft,
  },
  trackRowActive: {
    backgroundColor: palette.primarySoft,
    borderWidth: 1.5,
    borderColor: palette.primary,
  },
  trackName: { flex: 1, fontSize: 13, fontWeight: '600', color: palette.ink },
  trackNameActive: { color: palette.primary },
  stopBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 8 },
  stopBtnText: { color: palette.danger, fontWeight: '700', fontSize: 12.5 },
  earlyCancelLink: { alignItems: 'center', paddingVertical: 6, marginTop: 2 },
  earlyCancelText: {
    color: palette.inkMuted,
    fontSize: 12,
    fontWeight: '600',
    textDecorationLine: 'underline',
  },
  startBtn: {
    flexDirection: 'row', gap: 8,
    backgroundColor: palette.primary,
    paddingVertical: 17,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    ...buttonShadow,
  },
  startBtnDisabled: { opacity: 0.6 },
  startBtnText: { color: palette.surface, fontSize: 16, fontWeight: '800', letterSpacing: -0.2 },
  cancelledContainer: {
    flex: 1,
    backgroundColor: palette.canvas,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32,
    gap: 6,
  },
  cancelledIconWrap: { width: 76, height: 76, borderRadius: 38, backgroundColor: palette.dangerSoft, alignItems: 'center', justifyContent: 'center', marginBottom: 10 },
  cancelledTitle: { fontSize: 22, fontWeight: '800', color: palette.ink, letterSpacing: -0.3 },
  cancelledSubtitle: {
    fontSize: 13.5,
    color: palette.inkMuted,
    textAlign: 'center',
    lineHeight: 19,
    fontWeight: '500',
  },
  cancelledBtn: {
    backgroundColor: palette.primary,
    paddingVertical: 14,
    paddingHorizontal: 32,
    borderRadius: 14,
    marginTop: 10,
  },
  cancelledBtnText: { color: palette.surface, fontSize: 15, fontWeight: '700' },
});