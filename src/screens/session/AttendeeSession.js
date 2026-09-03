import React, { useState, useEffect, useRef, useMemo } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity,
  ScrollView, Modal, Alert, Platform, SafeAreaView
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '../../theme/colors';
import { supabase } from '../../lib/supabase';
import { createAgoraSession } from '../../services/agora/AgoraService';
import { AGORA_APP_ID } from '../../lib/constants';
import VideoTile from '../../components/VideoTile';
import WhiteboardCanvas from '../../components/WhiteboardCanvas';
import GraphBoardCanvas from '../../components/GraphboardCanvas'; // note: file is "Graphboard" not "GraphBoard"
import NotificationToastStack from '../../components/NotificationToast';
import { ModeIcon, SIGNAL_ICON } from '../../lib/iconMeta';
import { useResponsive } from '../../lib/responsive';
import { useSessionExitGuard } from '../../lib/useSessionExitGuard';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

const SPEAKER_SWITCH_DELAY = 600;
const VOLUME_THRESHOLD = 10;

// Toolbar always docks along the bottom now (see SessionMain.js for the
// host-side twin of this) — button size is computed from screen width so
// all 9 buttons fit one row with no scrolling, ever.
const TOOL_COUNT = 9; // Mute, Cam, React, Hand, Correct, Speak, Chat, Poll, Leave
const TOOLBAR_MIN_BTN = 34;
const TOOLBAR_MAX_BTN = 54;
const TOOLBAR_H_PADDING = 20;

export default function AttendeeSession({ navigation, route }) {
  const session = route.params?.session;
  // Present only for someone who joined via GuestJoinScreen without an
  // account — {name, email}. Used below so a guest never gets routed to
  // 'AttendeeDashboard', which doesn't exist for them.
  const guest = route.params?.guest || null;
  const isGuest = !!guest;
  const { scale, isTablet, isDesktop, isSmall, width, height } = useResponsive();
  const insets = useSafeAreaInsets();
  const isPortraitPhone = !isTablet && height > width;
  const styles = useAttendeeSessionStyles(scale, isSmall, width, height);

  // If the attendee closes the browser tab instead of tapping Leave, this
  // registers the leave immediately instead of leaving a stale row that
  // makes it look like they're still in session.
  useSessionExitGuard({
    role: 'attendee',
    sessionId: session?.id,
    getUserId: () => currentUserRef.current?.id || null,
  });

  // Improved toolbar calculation with safe area support
  const safeHorizontalPadding = TOOLBAR_H_PADDING + insets.left + insets.right;
  const availableWidth = width - safeHorizontalPadding;
  const baseToolSize = Math.max(TOOLBAR_MIN_BTN, (availableWidth / TOOL_COUNT) * 0.74);
  const toolBtnSize = Math.round(
    Math.min(TOOLBAR_MAX_BTN, isSmall ? Math.max(TOOLBAR_MIN_BTN, baseToolSize * 0.85) : baseToolSize)
  );
  const toolShowLabel = toolBtnSize >= (isSmall ? 36 : 44);
  const toolIconSize = Math.max(14, Math.round(toolBtnSize * (isSmall ? 0.4 : 0.36)));
  const toolbarBarHeight = toolBtnSize + 16 + insets.bottom;

  // In-session chrome visibility — visible on load, then auto-hides after
  // a few seconds of no interaction, same as the host screen.
  const [controlsVisible, setControlsVisible] = useState(true);
  const controlsHideTimerRef = useRef(null);
  const revealControls = () => {
    setControlsVisible(true);
    if (controlsHideTimerRef.current) clearTimeout(controlsHideTimerRef.current);
    controlsHideTimerRef.current = setTimeout(() => setControlsVisible(false), 3000);
  };
  useEffect(() => {
    // Arms the initial 3s countdown — without this, controls that start
    // visible would never hide until the first tap/mouse-move.
    revealControls();
    return () => {
      if (controlsHideTimerRef.current) clearTimeout(controlsHideTimerRef.current);
    };
  }, []);
  // PCs/trackpads never fire onTouchStart — mouse movement is the desktop
  // equivalent of a tap here. No-op on native.
  const revealOnHoverProps = Platform.OS === 'web' ? { onMouseMove: revealControls } : {};

  // Host-configured defaults from CreateSession — falls back to the
  // previous hardcoded behavior (muted, camera off) if this session
  // predates these columns or they were never set.
  const startWithMicOn = session?.default_mic_on ?? false;
  const startWithCameraOn = session?.default_camera_on ?? false;

  const [muted, setMuted] = useState(!startWithMicOn);
  const [cameraOff, setCameraOff] = useState(!startWithCameraOn);
  const [localVideoTrack, setLocalVideoTrack] = useState(null);
  const [view, setView] = useState('speaker');
  const [showReactions, setShowReactions] = useState(false);
  const [activeSignal, setActiveSignal] = useState(null);
  const [calledToBoard, setCalledToBoard] = useState(false);
  const [showCallToBoard, setShowCallToBoard] = useState(false);
  const [pendingBoardType, setPendingBoardType] = useState(null);
  const [remoteUsers, setRemoteUsers] = useState([]);
  const [joined, setJoined] = useState(false);
  const [boardMode, setBoardMode] = useState(null);
  const [canEdit, setCanEdit] = useState(false);
  // True while the host is "interrupting" — temporarily taking edit control
  // back from whoever is currently called to the board. While this is true,
  // even an attendee who was accepted (canEdit=true) is forced view-only.
  const [hostInterrupting, setHostInterrupting] = useState(false);
  const [hostRecording, setHostRecording] = useState(false);
  const [activeSpeakerUid, setActiveSpeakerUid] = useState(null);
  const [myUid, setMyUid] = useState(null);
  // Identities of everyone else in the session (host + other attendees),
  // built from 'user-identity' broadcasts — this screen previously only
  // ever SENT its own identity, never listened for anyone else's, so it
  // had no way to know who else was actually here. ChatPanel's roster
  // needs this to let an attendee DM a specific person by name.
  const [otherUsers, setOtherUsers] = useState({});
  // uid -> { muted, cameraOff }, for EVERY remote peer this attendee can
  // see — the host included. Populated from 'media-state' broadcasts,
  // same event SessionMain.js already listens for from attendees; this
  // file just never listened for it itself, and the host never sent one
  // about itself either (see SessionMain's matching fix). Without this,
  // every remote VideoTile call below had no way to tell "camera is
  // genuinely off" apart from "track hasn't arrived yet" — some omitted
  // cameraOff entirely, so a disabled-but-still-attached track rendered
  // as a black area instead of falling back to the initials avatar.
  const [remoteMediaState, setRemoteMediaState] = useState({});
  // ─── CO-HOST STATE (attendee side) ───
  // Whether THIS attendee currently has co-host status — drives whether
  // the moderation 3-dot menu appears on other attendees' tiles, and the
  // "⭐ Co-Host" chip in the top bar.
  const [isCoHost, setIsCoHost] = useState(false);
  // uid -> { name }, for every OTHER attendee currently known to be a
  // co-host (broadcast to everyone, not just the host) — purely for
  // showing the same "⭐" badge everyone else sees, so it's obvious who's
  // helping moderate.
  const [coHostUids, setCoHostUids] = useState({});
  // 3-dot moderation menu for co-hosts — same pattern as the host's own
  // showDropdown, but only ever rendered when isCoHost is true, and with
  // a smaller action set (see the modal below).
  const [showModDropdown, setShowModDropdown] = useState(null);
  // Fade in/out notifications — reactions from anyone, chat
  // notifications (see the session-messages-watch effect below), and
  // host mute/camera-off notices (previously a separate, non-animated
  // single-message system — consolidated into this one for consistency,
  // and because the fade actually matters for those too).
  const [toasts, setToasts] = useState([]);
  // Unread chat count for the toolbar badge — reset the moment this
  // attendee taps into Chat, not when they've "finished reading".
  const [unreadCount, setUnreadCount] = useState(0);
  // Same pattern as unreadCount, for the (previously nonexistent) Poll
  // button — see the session-polls-watch effect below.
  const [pollNotice, setPollNotice] = useState(false);

  const agoraSessionRef = useRef(null);
  const myUidRef = useRef(null);
  const speakerSwitchTimeoutRef = useRef(null);
  const controlChannelRef = useRef(null);
  const currentUserRef = useRef({ id: null, name: 'Attendee' });
  // Same fix as SessionMain.js — see that file's matching comment. This
  // screen stays mounted underneath ChatPanel/PollScreen too, so without
  // these refs the watcher effects further down kept toasting/badging
  // for messages and polls the attendee was already looking at live.
  const chatOpenRef = useRef(false);
  const pollOpenRef = useRef(false);
  useEffect(() => {
    const unsub = navigation.addListener('focus', () => {
      chatOpenRef.current = false;
      pollOpenRef.current = false;
    });
    return unsub;
  }, [navigation]);
  // Whether this attendee's audio/video track has EVER actually been
  // handed to client.publish() yet. Starts false for whichever media
  // starts muted/camera-off (see the publish logic in initAgora below —
  // this is the core of the fix: we don't publish-then-immediately-
  // disable anymore, we just never publish until it's actually turned
  // on). toggleMic/toggleCamera check this to know whether they're doing
  // a first-ever publish or just flipping enabled on an already-live one.
  
  // The 'board-start' handler below is registered once, inside the
  // session?.id effect — its closure would otherwise always see
  // calledToBoard as it was when that effect last subscribed (stale,
  // effectively always false). Mirror it into a ref so the handler can
  // tell whether THIS client is the one currently called up when a
  // board-start broadcast arrives.
  const calledToBoardRef = useRef(false);
  useEffect(() => { calledToBoardRef.current = calledToBoard; }, [calledToBoard]);

  // Report our own mic/camera state to the host whenever it changes —
  // self-toggled or force-changed by a host request, same effect either
  // way. Without this the host has no way to know a mute request
  // actually landed, or that an attendee unmuted themselves afterward.
  useEffect(() => {
    if (!joined) return;
    controlChannelRef.current?.send({
      type: 'broadcast',
      event: 'media-state',
      payload: { uid: myUidRef.current, muted, cameraOff },
    });
  }, [muted, cameraOff, joined]);

  // These emoji ARE functional data, not decorative UI — each one is the
  // literal payload broadcast on 'reaction' (see sendReaction below) and
  // rendered verbatim in toasts on both this screen and SessionMain.js
  // ("Name reacted 👍"). Swapping these for icon components would change
  // what's actually transmitted, so they're deliberately left as-is.
  const reactions = ['👍', '👏', '❤️', '😂', '🔥', '😮'];
  const signals = [
    { icon: SIGNAL_ICON.hand, label: 'Raise Hand', key: 'hand' },
    { icon: SIGNAL_ICON.correction, label: 'Point of Correction', key: 'correction' },
    { icon: SIGNAL_ICON.speak, label: 'Want to Speak', key: 'speak' },
  ];

  useEffect(() => {
    initAgora();
    return () => {
      if (speakerSwitchTimeoutRef.current) clearTimeout(speakerSwitchTimeoutRef.current);
      leaveAgoraOnly();
    };
  }, []);

  useEffect(() => {
    if (!session?.id) return;

    const controlCh = supabase
      .channel(`session-control-${session.id}`)
      .on('broadcast', { event: 'board-start' }, ({ payload }) => {
        setBoardMode(payload.boardType);
        // Don't blindly reset canEdit — when the host accepts our call to
        // the board, openBoard() on their side fires this same event right
        // after our own acceptCallToBoard() already set canEdit(true)
        // locally. Without this check, that broadcast bounces back a
        // moment later and wipes canEdit back to false: the board opens,
        // but the attendee who was just called can't actually draw on it.
        // Only reset canEdit for attendees who are NOT the one currently
        // called up.
        setCanEdit(prev => (calledToBoardRef.current ? prev : false));
      })
      .on('broadcast', { event: 'board-end' }, () => {
        setBoardMode(null);
        setCanEdit(false);
        setCalledToBoard(false);
        setHostInterrupting(false);
      })
      .on('broadcast', { event: 'call-to-board' }, ({ payload }) => {
        // Only the attendee actually being called sees the prompt
        if (payload.uid !== myUidRef.current) return;
        setPendingBoardType(payload.boardType);
        setShowCallToBoard(true);
      })
      .on('broadcast', { event: 'board-revoke' }, ({ payload }) => {
        // Host "uncalled" this attendee — revoke edit access, board stays visible view-only
        if (payload.uid !== myUidRef.current) return;
        setCalledToBoard(false);
        setCanEdit(false);
        setHostInterrupting(false);
        setShowCallToBoard(false);
      })
      // Host tapped Interrupt/Uninterrupt — applies to whoever is currently
      // called to the board, so any attendee that's calledToBoard just
      // mirrors this flag rather than checking a specific uid.
      .on('broadcast', { event: 'host-interrupt' }, ({ payload }) => {
        setHostInterrupting(!!payload.interrupting);
      })
      .on('broadcast', { event: 'user-banned' }, ({ payload }) => {
        if (payload.userId === currentUserRef.current?.id) {
          leaveAgoraOnly();
          navigation.navigate('BannedScreen', { session });
        }
      })
      .on('broadcast', { event: 'user-kicked' }, ({ payload }) => {
        if (payload.userId === currentUserRef.current?.id) {
          leaveAgoraOnly();
          Alert.alert('Removed', 'You have been removed from this session.');
          // Same guest-safe routing as leaveSession() below — a guest has
          // no 'AttendeeDashboard' to land on.
          if (isGuest) navigation.replace('SessionEndedGuest', { session, reason: 'kicked' });
          else navigation.navigate('AttendeeDashboard');
        }
      })
      .on('broadcast', { event: 'user-identity' }, ({ payload }) => {
        // Everyone (host included, as of this update) broadcasts their own
        // identity once shortly after joining. Accumulate whoever we've
        // heard from so ChatPanel has real people to list, not just "Host"
        // / generic labels. This only captures identities broadcast AFTER
        // this listener is registered — someone who joined and announced
        // themselves well before us won't show up unless something else
        // prompts a re-broadcast, which is a known, minor gap for later.
        if (payload.userId && payload.userId !== currentUserRef.current?.id) {
          setOtherUsers((prev) => ({
            ...prev,
            [payload.userId]: { name: payload.name, isHost: !!payload.isHost },
          }));
        }
      })
      .on('broadcast', { event: 'host-mute-request' }, ({ payload }) => {
        if (payload.uid !== myUidRef.current) return;
        forceMute();
        pushToast('🔇 Host muted your mic');
      })
      .on('broadcast', { event: 'host-camera-off-request' }, ({ payload }) => {
        if (payload.uid !== myUidRef.current) return;
        forceCameraOff();
        pushToast('📷 Host turned off your camera');
      })
      .on('broadcast', { event: 'media-state' }, ({ payload }) => {
        setRemoteMediaState(prev => ({
          ...prev,
          [payload.uid]: { muted: !!payload.muted, cameraOff: !!payload.cameraOff },
        }));
      })
      .on('broadcast', { event: 'co-host-granted' }, ({ payload }) => {
        setCoHostUids(prev => ({ ...prev, [payload.uid]: { name: payload.name } }));
        if (payload.uid === myUidRef.current) {
          setIsCoHost(true);
          pushToast('⭐ You are now a co-host');
        }
      })
      .on('broadcast', { event: 'co-host-revoked' }, ({ payload }) => {
        setCoHostUids(prev => {
          if (!prev[payload.uid]) return prev;
          const next = { ...prev };
          delete next[payload.uid];
          return next;
        });
        if (payload.uid === myUidRef.current) {
          setIsCoHost(false);
          setShowModDropdown(null);
          pushToast('Co-host status removed');
        }
      })
      // Host dismissed our signal (tapped the chip in the signals bar).
      // Clears the "Signal sent" badge on our end too, so both sides
      // agree it's been addressed instead of it silently going stale.
      .on('broadcast', { event: 'host-clear-signal' }, ({ payload }) => {
        if (payload.uid !== myUidRef.current) return;
        setActiveSignal(null);
        pushToast('Host addressed your signal');
      })
      // Reactions — broadcast on this same shared channel (not a new
      // subscription) since SessionMain and AttendeeSession are already
      // both listening here. Shows up to everyone, sender included.
      .on('broadcast', { event: 'reaction' }, ({ payload }) => {
        pushToast(`${payload.name} reacted ${payload.emoji}`);
      })
      .subscribe();
    controlChannelRef.current = controlCh;

    const sessionCh = supabase
      .channel(`session-end-${session.id}`)
      .on('postgres_changes', {
        event: 'UPDATE', schema: 'public',
        table: 'sessions', filter: `id=eq.${session.id}`
      }, (payload) => {
        if (payload.new.status === 'ended') leaveSession(true);
      })
      .subscribe();

    return () => {
      supabase.removeChannel(controlCh);
      supabase.removeChannel(sessionCh);
    };
  }, [session?.id]);

  // Separate, uniquely-named subscription (NOT session-chat-${session.id},
  // which ChatPanel already owns exclusively — see that file's header
  // comment for why a second independent subscription to the SAME topic
  // is exactly what crashed the app before). Different topic name means
  // no conflict at all, even though both are ultimately watching the same
  // session_messages table. This is purely for the unread badge + the
  // "someone messaged everyone / sent you a message" toast — it never
  // touches message delivery itself, ChatPanel still owns that entirely.
  useEffect(() => {
    if (!session?.id) return;
    const ch = supabase
      .channel(`session-messages-watch-${session.id}`)
      .on('postgres_changes', {
        event: 'INSERT', schema: 'public', table: 'session_messages',
        filter: `session_id=eq.${session.id}`,
      }, (payload) => {
        const msg = payload.new;
        const myId = currentUserRef.current?.id;
        if (!myId || msg.sender_id === myId) return; // my own message
        if (chatOpenRef.current) return; // already visible live inside ChatPanel — no redundant toast/badge
        // DMs to someone else shouldn't reach us at all — the RLS policy
        // on session_messages already enforces that server-side — but
        // check anyway rather than trusting that alone.
        if (msg.recipient_id && msg.recipient_id !== myId) return;
        pushToast(msg.recipient_id ? `${msg.sender_name} sent you a message` : `${msg.sender_name} messaged everyone`);
        setUnreadCount(c => c + 1);
      })
      .subscribe();
    return () => supabase.removeChannel(ch);
  }, [session?.id]);

  const pushToast = (text) => {
    setToasts(prev => [...prev, { id: `${Date.now()}-${Math.random()}`, text }]);
  };
  const dismissToast = (id) => setToasts(prev => prev.filter(t => t.id !== id));

  // Same pattern as session-messages-watch just above — a separate,
  // uniquely-named subscription so this file never touches PollScreen's
  // own realtime topic (session-poll-${id}). Just enough to toast + badge.
  useEffect(() => {
    if (!session?.id) return;
    const ch = supabase
      .channel(`session-polls-watch-${session.id}`)
      .on('postgres_changes', {
        event: 'INSERT', schema: 'public', table: 'session_polls',
        filter: `session_id=eq.${session.id}`,
      }, (payload) => {
        const p = payload.new;
        if (p.created_by === currentUserRef.current?.id) return; // I launched it myself
        if (pollOpenRef.current) return; // already visible live inside PollScreen — no redundant toast/badge
        pushToast(`📊 New poll: ${p.question}`);
        setPollNotice(true);
      })
      .subscribe();
    return () => supabase.removeChannel(ch);
  }, [session?.id]);

  const sendReaction = (emoji) => {
    setShowReactions(false);
    controlChannelRef.current?.send({
      type: 'broadcast',
      event: 'reaction',
      payload: { name: currentUserRef.current?.name || 'Attendee', emoji },
    });
  };

  // Raise hand / point of correction / want to speak — this REPLACES the
  // old plain setActiveSignal(...) calls the toolbar buttons used to call
  // directly. Those only ever set local state; the host never received
  // anything at all, so "Signal sent" was showing on the attendee's own
  // screen while genuinely sending nothing. Tapping the same signal again
  // clears it, same toggle behavior as before — just with an actual
  // broadcast now on both the set AND the clear.
  const sendSignal = (signal) => {
    const next = activeSignal === signal ? null : signal;
    setActiveSignal(next);
    controlChannelRef.current?.send({
      type: 'broadcast',
      event: 'attendee-signal',
      payload: { uid: myUidRef.current, name: currentUserRef.current?.name || 'Attendee', signal: next },
    });
  };

  // A co-host never performs moderation actions directly — it sends a
  // request that only the HOST's client (SessionMain.js) acts on, after
  // confirming this attendee is currently a recognized co-host. See
  // SessionMain's coHosts state comment for the full reasoning: this
  // keeps one client (the host's) as the sole place privileged Supabase
  // writes and board orchestration happen, so a co-host never needs
  // elevated database permissions of their own.
  const sendCohostRequest = (action, targetUid) => {
    controlChannelRef.current?.send({
      type: 'broadcast',
      event: 'cohost-action-request',
      payload: { requesterUid: myUidRef.current, action, targetUid },
    });
    setShowModDropdown(null);
  };

  // ─── VOLUME INDICATOR ───
  const handleVolumeIndicator = (volumes) => {
    const speaking = volumes.filter(v => v.level > VOLUME_THRESHOLD);
    let newSpeakerUid = null;

    if (speaking.length === 1) {
      newSpeakerUid = speaking[0].uid;
    }
    // Multiple / none → null → default (show host/remote)

    if (speakerSwitchTimeoutRef.current) clearTimeout(speakerSwitchTimeoutRef.current);
    speakerSwitchTimeoutRef.current = setTimeout(() => {
      setActiveSpeakerUid(newSpeakerUid);
    }, SPEAKER_SWITCH_DELAY);
  };

  const initAgora = async () => {
    try {
      const agoraSession = createAgoraSession({
        onUserPublished: (uid, mediaType) => {
          console.log('🎥 Attendee sees remote user:', uid, mediaType);
          if (mediaType === 'video') {
            setRemoteUsers(prev => {
              const videoTrack = agoraSession.getRemoteVideoRef(uid);
              const exists = prev.find(u => u.uid === uid);
              if (exists) return prev.map(u => (u.uid === uid ? { ...u, uid, videoTrack } : u));
              return [...prev, { uid, videoTrack }];
            });
            setActiveSpeakerUid(prev => prev || uid);
          }
        },
        onUserUnpublished: (uid, mediaType) => {
          if (mediaType === 'video') {
            setRemoteUsers(prev =>
              prev.map(u => (u.uid === uid ? { ...u, videoTrack: null } : u))
            );
          }
        },
        onUserLeft: (uid) => {
          setRemoteUsers(prev => prev.filter(u => u.uid !== uid));
          setActiveSpeakerUid(prev => (prev === uid ? null : prev));
          setCoHostUids(prev => {
            if (!prev[uid]) return prev;
            const next = { ...prev };
            delete next[uid];
            return next;
          });
          setRemoteMediaState(prev => {
            if (!prev[uid]) return prev;
            const next = { ...prev };
            delete next[uid];
            return next;
          });
        },
        onVolumeIndicator: handleVolumeIndicator,
      });
      agoraSessionRef.current = agoraSession;

      // Token
      let token = null;
      if (session?.code) {
        try {
          const { data, error } = await supabase.functions.invoke('agora-token', {
            body: { channelName: session.code },
          });
          if (!error && data?.token) {
            token = data.token;
            console.log('✅ Attendee got token');
          }
        } catch (e) {
          console.log('Token fetch failed, joining without token');
        }
      }

      const assignedUid = await agoraSession.join(AGORA_APP_ID, session?.code || 'default', token, null);

      myUidRef.current = assignedUid;
      setMyUid(assignedUid);
      console.log('✅ Attendee joined. My Agora UID:', assignedUid);

      setLocalVideoTrack(agoraSession.getLocalVideoRef());

      // Same fix as before, now enforced by AgoraService itself: join()
      // creates local tracks but leaves them disabled/unpublished.
      // Whichever of mic/camera should start ON gets explicitly
      // published here; whichever starts off stays untouched until the
      // attendee taps to enable it in toggleMic/toggleCamera. This is
      // what avoids racing the host's subscribe handler with an
      // immediate unpublish (see the long comment that used to live
      // here — same underlying bug, now structurally prevented by
      // AgoraService never auto-publishing on join).
      if (startWithMicOn) await agoraSession.publishAudio();
      if (startWithCameraOn) await agoraSession.publishVideo();

      setJoined(true);
    } catch (err) {
      console.error('Agora error:', err.message);
      Alert.alert('Connection Error', 'Could not join the session.');
    }

    // Broadcast identity so host can map our Agora UID to our profile
    try {
      // Guests were never handled here before — supabase.auth.getUser()
      // returns no user for them (no real Supabase session at all), so
      // `.eq('id', me.id)` would throw the instant it ran, silently
      // swallowed by the catch below. That meant the host never
      // received an identity broadcast for a guest at all — no name,
      // no isGuest flag, nothing. Handling both branches explicitly here
      // is what finally lets the host's side know a participant is a
      // guest, which the minute-penalty tracking below depends on.
      let identityId = null;
      let identityName = 'Attendee';
      if (!isGuest) {
        const { data: { user: me } } = await supabase.auth.getUser();
        const { data: profile } = await supabase
          .from('profiles').select('full_name').eq('id', me.id).single();
        identityId = me.id;
        identityName = profile?.full_name || 'Attendee';
      } else {
        identityName = guest?.name || 'Guest';
      }

      currentUserRef.current = { id: identityId, name: identityName };

      // Small delay to ensure control channel is subscribed
      setTimeout(() => {
        controlChannelRef.current?.send({
          type: 'broadcast',
          event: 'user-identity',
          payload: {
            agoraUid: myUidRef.current,
            userId: identityId,
            name: identityName,
            isHost: false,
            isGuest,
          },
        });
        console.log('📡 Identity broadcast sent');
      }, 1500);
    } catch (e) {}
  };

  const leaveAgoraOnly = async () => {
    try {
      await agoraSessionRef.current?.leave();
    } catch (e) {
      console.log('Agora leave error (non-fatal):', e.message);
    }
    agoraSessionRef.current = null;
  };

 const leaveSession = async (forced = false) => {
  console.log('🚪 Leaving session:', session?.id);

  try {
    // Get the current user
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();

    if (userError) {
      console.warn('Could not get current user:', userError.message);
    }

    // Mark attendee as having left
    if (user && session?.id) {
      const { error: updateError } = await supabase
        .from('session_attendees')
        .update({ left_at: new Date().toISOString() })
        .eq('session_id', session.id)
        .eq('user_id', user.id);

      if (updateError) {
        console.error('❌ Failed to update left_at:', updateError);
      } else {
        console.log('✅ left_at updated');
      }
    }

    // Leave Agora
    try {
      await leaveAgoraOnly();
      console.log('✅ Left Agora');
    } catch (agoraError) {
      console.error('❌ Agora leave error:', agoraError);
    }

  } catch (error) {
    console.error('❌ Leave session error:', error);
  } finally {
    // ALWAYS leave the session screen
    if (forced) {
      if (Platform.OS === 'web') window.alert('Session ended: the host has ended the session.');
      else Alert.alert('Session ended', 'The host has ended the session.');
    }

    // A guest never has an 'AttendeeDashboard' to go back to — they never
    // signed in, so that screen either 404s or crashes trying to load
    // account data that doesn't exist. Route them to the guest-safe
    // landing screen instead, with the two things a guest can actually do
    // next: make an account, or join another session as a guest again.
    if (isGuest) {
      navigation.replace('SessionEndedGuest', { session, reason: forced ? 'ended' : 'left' });
    } else {
      navigation.replace('AttendeeDashboard');
    }
  }
};

 // react-native-web doesn't reliably render Alert.alert's button array — the
 // confirm UI never appears, so tapping Leave looked like it did nothing
 // (the actual leaveSession(false) call only ever lived inside that button's
 // onPress). Use the browser's own confirm() on web instead; native keeps
 // Alert.alert. See SessionMain.js's endSession for the matching host-side fix.
 const handleLeave = () => {
  if (Platform.OS === 'web') {
    if (window.confirm('Leave this session? Are you sure you want to leave?')) leaveSession(false);
    return;
  }
  Alert.alert(
    'Leave this session?',
    'Are you sure you want to leave?',
    [
      {
        text: 'Cancel',
        style: 'cancel',
      },
      {
        text: 'Leave',
        style: 'destructive',
        onPress: () => leaveSession(false),
      },
    ]
  );
};

  const toggleMic = async () => {
    try {
      // setAudioEnabled(true) on a not-yet-published track publishes it
      // for the first time — this is the same "publish only what should
      // actually be live, never publish-then-instantly-disable" fix as
      // initAgora, now handled inside AgoraService itself.
      await agoraSessionRef.current?.setAudioEnabled(muted);
      setMuted(!muted);
    } catch (e) {}
  };

  const toggleCamera = async () => {
    try {
      await agoraSessionRef.current?.setVideoEnabled(cameraOff);
      setCameraOff(prev => !prev);
    } catch (e) {}
  };

  // Explicit "force to true" — not a toggle like toggleMic/toggleCamera
  // above. A host-mute-request always means "be muted", regardless of
  // current state; toggling would UNmute someone who happened to already
  // be muted, which is the opposite of the intent. Safe to call whether
  // or not the track has ever been published — disabling an unpublished
  // track is a harmless no-op.
  const forceMute = async () => {
    try {
      await agoraSessionRef.current?.setAudioEnabled(false);
      setMuted(true);
    } catch (e) {}
  };

  const forceCameraOff = async () => {
    try {
      await agoraSessionRef.current?.setVideoEnabled(false);
      setCameraOff(true);
    } catch (e) {}
  };

  // ─── CALL-TO-BOARD ACCEPT / DECLINE ───
  const acceptCallToBoard = () => {
    setCalledToBoard(true);
    setShowCallToBoard(false);
    setCanEdit(true);
    controlChannelRef.current?.send({
      type: 'broadcast',
      event: 'board-invite-response',
      payload: { uid: myUidRef.current, accepted: true },
    });
  };

  const declineCallToBoard = () => {
    setShowCallToBoard(false);
    setPendingBoardType(null);
    controlChannelRef.current?.send({
      type: 'broadcast',
      event: 'board-invite-response',
      payload: { uid: myUidRef.current, accepted: false },
    });
  };

  const finishAtBoard = () => {
    setCalledToBoard(false);
    setCanEdit(false);
    controlChannelRef.current?.send({
      type: 'broadcast',
      event: 'board-finished',
      payload: { uid: myUidRef.current },
    });
  };

  const boardLabel = pendingBoardType === 'blackboard'
    ? 'blackboard'
    : pendingBoardType === 'graph'
      ? 'graph board'
      : 'whiteboard';

  // ─── ACTIVE SPEAKER LOGIC (same as SessionMain) ───
  const iAmSpeaking = activeSpeakerUid !== null &&
    (activeSpeakerUid === myUid || activeSpeakerUid === 0);

  // Local on main when: I'm the sole speaker
  const localOnMain = iAmSpeaking;

  // Default remote (host) to show when local is NOT on main
  const mainRemoteUser = remoteUsers.find(u => u.uid === activeSpeakerUid) || remoteUsers[0];

  // PiP only when local is NOT on main
  const showPiP = !localOnMain && joined;

  // The attendee's real, moment-to-moment edit permission: they need both
  // an accepted call (canEdit) AND the host to not currently be
  // interrupting. This is what actually gets passed to the board.
  const effectiveBoardCanEdit = canEdit && !hostInterrupting;

  const openChat = () => {
    setUnreadCount(0);
    chatOpenRef.current = true;
    navigation.navigate('ChatPanel', {
      session,
      currentUser: currentUserRef.current,
      isHost: false,
      roster: {
        ...otherUsers,
        ...(currentUserRef.current?.id
          ? { [currentUserRef.current.id]: { name: currentUserRef.current.name, isHost: false } }
          : {}),
      },
    });
  };

  const openPoll = () => {
    setPollNotice(false);
    pollOpenRef.current = true;
    navigation.navigate('PollScreen', { session, currentUser: currentUserRef.current, isHost: false });
  };

  // Calculate adaptive dimensions for different screen sizes
  const callToBoardLeftRight = isSmall ? Math.max(scale(8), insets.left + 4) : 10;
  const atBoardBannerLeftRight = isSmall ? Math.max(scale(8), insets.left + 4) : 10;
  const galleryCellWidth = isSmall ? Math.min(scale(150), width * 0.4) : scale(170);
  const galleryCellHeight = isSmall ? Math.min(scale(110), height * 0.2) : scale(130);
  const pipContainerWidth = isSmall ? Math.min(scale(76), width * 0.18) : scale(88);
  const pipContainerHeight = isSmall ? Math.min(scale(98), height * 0.18) : scale(116);
  const stackPipWidth = isSmall ? Math.min(scale(76), width * 0.18) : scale(88);
  const stackPipHeight = isSmall ? Math.min(scale(94), height * 0.16) : scale(114);
  const reactionBtnSize = isSmall ? Math.min(scale(52), width * 0.12) : scale(60);
  const modDropdownWidth = isSmall ? Math.min(scale(230), width * 0.88) : scale(250);

  return (
    <SafeAreaView style={[styles.container, { paddingTop: insets.top }]}>
      <NotificationToastStack toasts={toasts} onDismiss={dismissToast} />

      {/* Top Bar */}
      {controlsVisible && (
      <View style={[styles.topBar, { 
        paddingTop: Math.max(insets.top + 8, 20),
        paddingLeft: Math.max(insets.left + 8, 12),
        paddingRight: Math.max(insets.right + 8, 12)
      }]} {...revealOnHoverProps}>
        <View>
          <Text style={styles.sessionTitle}>{session?.title || 'Session'}</Text>
          <View style={styles.modeBadge}>
            <ModeIcon mode={session?.mode} size={scale(11)} color={colors.white} />
            <Text style={styles.modeBadgeText}>{session?.mode || 'Session'}</Text>
          </View>
          {isCoHost && (
            <View style={styles.coHostChip}>
              <Ionicons name="star" size={scale(10)} color="#FFC107" />
              <Text style={styles.coHostChipText}>Co-Host</Text>
            </View>
          )}
        </View>
        <View style={styles.topRight}>
          {hostRecording && (
            <View style={styles.recordingBadge}>
              <View style={styles.recordingDot} />
              <Text style={styles.recordingText}>RECORDING</Text>
            </View>
          )}
          <View style={styles.liveIndicator}>
            <View style={styles.liveDot} />
            <Text style={styles.liveText}>LIVE</Text>
          </View>
        </View>
      </View>
      )}

      {/* Call to Board */}
      {showCallToBoard && !calledToBoard && (
        <View style={[styles.callToBoardCard, { 
          left: callToBoardLeftRight, 
          right: callToBoardLeftRight
        }]}>
          <View style={styles.callToBoardIconWrap}>
            <Ionicons name="create-outline" size={scale(22)} color={colors.primary} />
          </View>
          <View style={styles.callToBoardInfo}>
            <Text style={styles.callToBoardTitle}>Host has called you to the {boardLabel}!</Text>
            <Text style={styles.callToBoardSubtitle}>You'll be able to draw and write.</Text>
          </View>
          <View style={styles.callToBoardBtns}>
            <TouchableOpacity style={styles.acceptBtn} onPress={acceptCallToBoard}>
              <Text style={styles.acceptBtnText}>Accept</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.declineBtn2} onPress={declineCallToBoard}>
              <Text style={styles.declineBtn2Text}>Decline</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

      {calledToBoard && (
        <View style={[styles.atBoardBanner, { 
          left: atBoardBannerLeftRight,
          right: atBoardBannerLeftRight
        }]}>
          <View style={styles.atBoardTextRow}>
            <Ionicons name="create-outline" size={scale(15)} color={colors.white} />
            <Text style={styles.atBoardText}>You are at the board</Text>
          </View>
          <TouchableOpacity style={styles.finishBtn} onPress={finishAtBoard}>
            <Text style={styles.finishBtnText}>Finish</Text>
          </TouchableOpacity>
        </View>
      )}

      <View style={[styles.mainContent, isPortraitPhone && styles.mainContentPortrait]}>

        {/* ─── MAIN VIEW ─── */}
        <View style={styles.speakerView} onTouchStart={revealControls} {...revealOnHoverProps}>
          {boardMode ? (
            // Embedded board — same shared components the host uses.
            // View-only until the host calls this attendee up and they accept.
            <View style={styles.boardViewFull}>
              {boardMode === 'graph' ? (
                <GraphBoardCanvas
                  session={session}
                  currentUser={currentUserRef.current}
                  isHost={false}
                  canEdit={effectiveBoardCanEdit}
                  visible={true}
                  mode="embedded" /* unconfirmed — only "fullscreen" seen so far, check GraphboardCanvas.js */
                  onRequestClose={() => {}} /* attendees shouldn't be able to close the board; only board-end does */
                />
              ) : (
                <WhiteboardCanvas
                  session={session}
                  currentUser={currentUserRef.current}
                  isHost={false}
                  canDraw={effectiveBoardCanEdit}
                  visible={true}
                  mode="embedded" /* unconfirmed — only "fullscreen" seen so far, check WhiteboardCanvas.js */
                  theme={boardMode}
                  onRequestClose={() => {}} /* attendees shouldn't be able to close the board; only board-end does */
                />
              )}

              <View style={[styles.pipStack, { pointerEvents: 'none', zIndex: 60 }]}>
                {remoteUsers.length > 0 && (
                  <View style={styles.stackPip}>
                    <VideoTile
                      track={remoteUsers[0]?.videoTrack}
                      cameraOff={!!remoteMediaState[remoteUsers[0]?.uid]?.cameraOff}
                      initials="Host"
                      label="Host"
                      style={{ flex: 1 }}
                      initialsSize={scale(13)}
                    />
                  </View>
                )}
                <View style={styles.stackPip}>
                  <VideoTile track={localVideoTrack} cameraOff={cameraOff} initials="You" label="You" style={{ flex: 1 }} initialsSize={scale(13)} mirror={true} />
                </View>
              </View>

              <View style={styles.boardWatchBadge}>
                <Ionicons
                  name={effectiveBoardCanEdit ? 'create-outline' : (calledToBoard && hostInterrupting ? 'pause-outline' : 'eye-outline')}
                  size={scale(12)}
                  color={colors.white}
                />
                <Text style={styles.boardWatchText}>
                  {effectiveBoardCanEdit
                    ? 'You can draw'
                    : calledToBoard && hostInterrupting
                    ? 'Host is correcting — one moment'
                    : 'Board View'}
                </Text>
              </View>
            </View>

          ) : view === 'gallery' ? (
            <ScrollView
              style={{ flex: 1 }}
              contentContainerStyle={[styles.galleryGrid, { 
                paddingTop: 78 + (insets.top > 0 ? insets.top - 10 : 0),
                paddingBottom: toolbarBarHeight + scale(16) 
              }]}
            >
              <View style={styles.galleryCell}>
                <VideoTile track={localVideoTrack} cameraOff={cameraOff} initials="You" label={iAmSpeaking ? 'You' : 'You'} style={{ flex: 1 }} initialsSize={scale(20)} mirror={true} />
                {iAmSpeaking && <View style={[styles.galleryCellActive, { pointerEvents: 'none' }]} />}
              </View>
              {remoteUsers.map((user, i) => (
                <View key={user.uid} style={styles.galleryCell}>
                  <VideoTile
                    track={user.videoTrack}
                    cameraOff={!!remoteMediaState[user.uid]?.cameraOff}
                    initials={i === 0 ? 'H' : `U${i}`}
                    label={i === 0 ? 'Host' : `User ${i}`}
                    style={{ flex: 1 }}
                    initialsSize={scale(20)}
                  />
                  {coHostUids[user.uid] && (
                    <View style={styles.galleryCoHostBadge}>
                      <Ionicons name="star" size={scale(10)} color="#3A2900" />
                      <Text style={styles.galleryCoHostBadgeText}>Co-host</Text>
                    </View>
                  )}
                  {isCoHost && i !== 0 && (
                    <TouchableOpacity style={styles.galleryCellDots} onPress={() => setShowModDropdown(user.uid)}>
                      <Ionicons name="ellipsis-vertical" size={scale(14)} color={colors.white} />
                    </TouchableOpacity>
                  )}
                  {activeSpeakerUid === user.uid && <View style={[styles.galleryCellActive, { pointerEvents: 'none' }]} />}
                </View>
              ))}
            </ScrollView>

          ) : (
            // ─── SPEAKER VIEW — active speaker logic ───
            <>
              {localOnMain ? (
                // Attendee is speaking — show them on main
                <VideoTile
                  track={localVideoTrack}
                  cameraOff={cameraOff}
                  initials="You"
                  label="You (Speaking)"
                  style={{ flex: 1 }}
                  initialsSize={scale(40)}
                  mirror={true}
                />
              ) : mainRemoteUser ? (
                // Show active remote (host or another user)
                <VideoTile
                  track={mainRemoteUser.videoTrack}
                  cameraOff={!!remoteMediaState[mainRemoteUser.uid]?.cameraOff}
                  initials={remoteUsers.indexOf(mainRemoteUser) === 0 ? 'Host' : `U${remoteUsers.indexOf(mainRemoteUser)}`}
                  label={remoteUsers.indexOf(mainRemoteUser) === 0 ? 'Host' : `User ${remoteUsers.indexOf(mainRemoteUser)}`}
                  style={{ flex: 1 }}
                  initialsSize={scale(40)}
                />
              ) : (
                <View style={styles.noVideoPlaceholder}>
                  <Ionicons name="hourglass-outline" size={scale(34)} color="rgba(255,255,255,0.4)" />
                  <Text style={styles.noVideoText}>{joined ? 'Waiting for host video...' : 'Connecting...'}</Text>
                </View>
              )}

              {/* PiP — show attendee's self-view when NOT on main */}
              {showPiP && (
                <View style={[styles.pipContainer, { 
                  bottom: toolbarBarHeight + scale(10),
                  width: pipContainerWidth,
                  height: pipContainerHeight,
                  right: isSmall ? scale(50) : scale(74)
                }]}>
                  <VideoTile track={localVideoTrack} cameraOff={cameraOff} initials="You" label="You" style={{ flex: 1 }} initialsSize={scale(13)} mirror={true} />
                </View>
              )}
            </>
          )}

          {/* Signal Badge */}
          {activeSignal && !boardMode && (
            <View style={[styles.signalBadge, { 
              top: scale(78) + (insets.top > 0 ? insets.top - scale(10) : 0)
            }]}>
              <Ionicons name={SIGNAL_ICON[activeSignal] || 'hand-left-outline'} size={scale(14)} color={colors.white} />
              <Text style={styles.signalBadgeText}>Signal sent</Text>
              <TouchableOpacity onPress={() => sendSignal(activeSignal)}>
                <Ionicons name="close" size={scale(16)} color="rgba(255,255,255,0.7)" />
              </TouchableOpacity>
            </View>
          )}

          {/* View Toggle */}
          {!boardMode && controlsVisible && (
            <View style={[styles.viewToggle, { bottom: toolbarBarHeight + scale(10) }]}>
              <TouchableOpacity style={[styles.viewBtn, view === 'speaker' && styles.viewBtnActive]} onPress={() => setView('speaker')}>
                <Text style={styles.viewBtnText}>Speaker</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.viewBtn, view === 'gallery' && styles.viewBtnActive]} onPress={() => setView('gallery')}>
                <Text style={styles.viewBtnText}>Gallery</Text>
              </TouchableOpacity>
            </View>
          )}
        </View>

        {/* Attendee Toolbar — always a bottom bar (see toolBtnSize above
            for how it shrinks to fit all 9 buttons with no scrolling).
            Hidden until controlsVisible, same as the rest of the chrome. */}
        {controlsVisible && (
        <View style={styles.toolbarScroll} {...revealOnHoverProps}>
          <View style={styles.toolbar}>
            <TouchableOpacity style={[styles.toolBtn, { width: toolBtnSize, height: toolBtnSize }, muted && styles.toolBtnMuted]} onPress={toggleMic}>
              <Ionicons name={muted ? 'mic-off-outline' : 'mic-outline'} size={toolIconSize} color={colors.white} />
              {toolShowLabel && <Text style={styles.toolLabel}>{muted ? 'Unmute' : 'Mute'}</Text>}
            </TouchableOpacity>
            <TouchableOpacity style={[styles.toolBtn, { width: toolBtnSize, height: toolBtnSize }, cameraOff && styles.toolBtnMuted]} onPress={toggleCamera}>
              <Ionicons name={cameraOff ? 'videocam-off-outline' : 'videocam-outline'} size={toolIconSize} color={colors.white} />
              {toolShowLabel && <Text style={styles.toolLabel}>{cameraOff ? 'Cam Off' : 'Cam On'}</Text>}
            </TouchableOpacity>
            <TouchableOpacity style={[styles.toolBtn, { width: toolBtnSize, height: toolBtnSize }]} onPress={() => setShowReactions(true)}>
              <Ionicons name="happy-outline" size={toolIconSize} color={colors.white} />
              {toolShowLabel && <Text style={styles.toolLabel}>React</Text>}
            </TouchableOpacity>
            <TouchableOpacity style={[styles.toolBtn, { width: toolBtnSize, height: toolBtnSize }, activeSignal === 'hand' && styles.toolBtnActive]} onPress={() => sendSignal('hand')}>
              <Ionicons name={SIGNAL_ICON.hand} size={toolIconSize} color={colors.white} />
              {toolShowLabel && <Text style={styles.toolLabel}>Hand</Text>}
            </TouchableOpacity>
            <TouchableOpacity style={[styles.toolBtn, { width: toolBtnSize, height: toolBtnSize }, activeSignal === 'correction' && styles.toolBtnRed]} onPress={() => sendSignal('correction')}>
              <Ionicons name={SIGNAL_ICON.correction} size={toolIconSize} color={colors.white} />
              {toolShowLabel && <Text style={styles.toolLabel}>Correct</Text>}
            </TouchableOpacity>
            <TouchableOpacity style={[styles.toolBtn, { width: toolBtnSize, height: toolBtnSize }, activeSignal === 'speak' && styles.toolBtnActive]} onPress={() => sendSignal('speak')}>
              <Ionicons name={SIGNAL_ICON.speak} size={toolIconSize} color={colors.white} />
              {toolShowLabel && <Text style={styles.toolLabel}>Speak</Text>}
            </TouchableOpacity>
            <TouchableOpacity style={[styles.toolBtn, { width: toolBtnSize, height: toolBtnSize }]} onPress={openChat}>
              <Ionicons name="chatbubble-outline" size={toolIconSize} color={colors.white} />
              {toolShowLabel && <Text style={styles.toolLabel}>Chat</Text>}
              {!!unreadCount && (
                <View style={styles.toolBadge}>
                  <Text style={styles.toolBadgeText}>{unreadCount > 9 ? '9+' : unreadCount}</Text>
                </View>
              )}
            </TouchableOpacity>
            <TouchableOpacity style={[styles.toolBtn, { width: toolBtnSize, height: toolBtnSize }]} onPress={openPoll}>
              <Ionicons name="stats-chart-outline" size={toolIconSize} color={colors.white} />
              {toolShowLabel && <Text style={styles.toolLabel}>Poll</Text>}
              {!!pollNotice && (
                <View style={styles.toolBadge}>
                  <Text style={styles.toolBadgeText}>!</Text>
                </View>
              )}
            </TouchableOpacity>
            <TouchableOpacity style={[styles.toolBtn, { width: toolBtnSize, height: toolBtnSize }, styles.toolBtnEnd]} onPress={handleLeave}>
              <Ionicons name="exit-outline" size={toolIconSize} color={colors.white} />
              {toolShowLabel && <Text style={styles.toolLabel}>Leave</Text>}
            </TouchableOpacity>
          </View>
        </View>
        )}
      </View>

      {/* Reactions Modal */}
      <Modal visible={showReactions} transparent animationType="slide" onRequestClose={() => setShowReactions(false)}>
        <TouchableOpacity style={styles.reactionsOverlay} activeOpacity={1} onPress={() => setShowReactions(false)}>
          <View style={styles.reactionsPanel}>
            <Text style={styles.reactionsPanelTitle}>SIGNALS</Text>
            <View style={styles.signalsRow}>
              {signals.map(s => (
                <TouchableOpacity key={s.key} style={[styles.signalBtn, activeSignal === s.key && styles.signalBtnActive]} onPress={() => { sendSignal(s.key); setShowReactions(false); }}>
                  <Ionicons name={s.icon} size={scale(22)} color={colors.white} />
                  <Text style={styles.signalBtnLabel}>{s.label}</Text>
                </TouchableOpacity>
              ))}
            </View>
            <Text style={styles.reactionsPanelTitle}>REACTIONS</Text>
            <View style={styles.reactionsGrid}>
              {reactions.map((emoji, i) => (
                <TouchableOpacity key={i} style={[styles.reactionBtn, { 
                  width: reactionBtnSize, 
                  height: reactionBtnSize 
                }]} onPress={() => sendReaction(emoji)}>
                  <Text style={styles.reactionEmoji}>{emoji}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
        </TouchableOpacity>
      </Modal>

      {/* Co-host moderation menu — only ever opened when isCoHost is true
          (the 3-dot button that triggers this doesn't render otherwise).
          Every action here is a REQUEST to the host, not a direct action
          — see sendCohostRequest's comment above. */}
      <Modal visible={showModDropdown !== null} transparent animationType="fade" onRequestClose={() => setShowModDropdown(null)}>
        <TouchableOpacity style={styles.modOverlay} activeOpacity={1} onPress={() => setShowModDropdown(null)}>
          <View style={styles.modDropdown}>
            <Text style={styles.modDropdownHeader}>Moderate attendee</Text>
            {[
              { icon: 'mic-off-outline', label: 'Mute', action: () => sendCohostRequest('mute', showModDropdown) },
              { icon: 'videocam-off-outline', label: 'Turn off camera', action: () => sendCohostRequest('camera-off', showModDropdown) },
              { icon: 'create-outline', label: 'Call to Board', action: () => sendCohostRequest('call-to-board', showModDropdown) },
              { icon: 'remove-circle-outline', label: 'Uncall from Board', action: () => sendCohostRequest('uncall-from-board', showModDropdown) },
              { icon: 'exit-outline', label: 'Remove from Session', danger: true, action: () => sendCohostRequest('remove', showModDropdown) },
            ].map((item, i) => (
              <TouchableOpacity key={i} style={styles.modDropdownItem} onPress={item.action}>
                <Ionicons name={item.icon} size={scale(16)} color={item.danger ? colors.red : colors.white} />
                <Text style={[styles.modDropdownText, item.danger && styles.modDropdownTextDanger]}>{item.label}</Text>
              </TouchableOpacity>
            ))}
            <TouchableOpacity style={styles.modDropdownClose} onPress={() => setShowModDropdown(null)}>
              <Text style={styles.modDropdownCloseText}>Close</Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </Modal>
    </SafeAreaView>
  );
}

function useAttendeeSessionStyles(scale, isSmall, width, height) {
  return useMemo(() => StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0A0A1A', position: 'relative' },
  topBar: {
    position: 'absolute', top: 0, left: 0, right: 0, zIndex: 60,
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    padding: scale(12), paddingTop: scale(20), backgroundColor: 'rgba(13,13,43,0.68)',
  },
  sessionTitle: { fontSize: scale(15), fontWeight: '700', color: colors.white },
  modeBadge: { flexDirection: 'row', alignItems: 'center', gap: scale(5), backgroundColor: 'rgba(255,255,255,0.12)', alignSelf: 'flex-start', paddingHorizontal: scale(8), paddingVertical: scale(3), borderRadius: scale(10), marginTop: scale(3) },
  modeBadgeText: { color: colors.white, fontSize: scale(10), fontWeight: '600', textTransform: 'capitalize' },
  coHostChip: { flexDirection: 'row', alignItems: 'center', gap: scale(5), backgroundColor: 'rgba(255,193,7,0.18)', borderWidth: scale(1), borderColor: 'rgba(255,193,7,0.6)', alignSelf: 'flex-start', paddingHorizontal: scale(8), paddingVertical: scale(3), borderRadius: scale(10), marginTop: scale(5) },
  coHostChipText: { color: '#FFC107', fontSize: scale(10), fontWeight: '700' },
  topRight: { alignItems: 'flex-end', gap: scale(4) },
  recordingBadge: { flexDirection: 'row', alignItems: 'center', gap: scale(4), backgroundColor: 'rgba(255,59,59,0.2)', paddingHorizontal: scale(7), paddingVertical: scale(3), borderRadius: scale(7) },
  recordingDot: { width: scale(7), height: scale(7), borderRadius: scale(4), backgroundColor: colors.red },
  recordingText: { color: colors.red, fontSize: scale(10), fontWeight: '700' },
  liveIndicator: { flexDirection: 'row', alignItems: 'center', gap: scale(4), backgroundColor: 'rgba(46,204,113,0.2)', paddingHorizontal: scale(8), paddingVertical: scale(3), borderRadius: scale(7) },
  liveDot: { width: scale(7), height: scale(7), borderRadius: scale(4), backgroundColor: colors.green },
  liveText: { color: colors.green, fontSize: scale(10), fontWeight: '700' },
  callToBoardCard: { position: 'absolute', top: scale(78), left: scale(10), right: scale(10), zIndex: 58, flexDirection: 'row', alignItems: 'center', backgroundColor: '#1E1E3F', borderRadius: scale(14), padding: scale(14), gap: scale(10), borderWidth: scale(1), borderColor: colors.primary },
  callToBoardIconWrap: { width: scale(40), height: scale(40), borderRadius: scale(12), backgroundColor: 'rgba(91,46,255,0.2)', alignItems: 'center', justifyContent: 'center' },
  callToBoardInfo: { flex: 1 },
  callToBoardTitle: { color: colors.white, fontWeight: '700', fontSize: scale(14) },
  callToBoardSubtitle: { color: 'rgba(255,255,255,0.5)', fontSize: scale(12), marginTop: scale(2) },
  callToBoardBtns: { gap: scale(6) },
  acceptBtn: { backgroundColor: colors.green, paddingHorizontal: scale(14), paddingVertical: scale(7), borderRadius: scale(8), alignItems: 'center' },
  acceptBtnText: { color: colors.white, fontWeight: '700', fontSize: scale(12) },
  declineBtn2: { borderWidth: scale(1), borderColor: 'rgba(255,255,255,0.2)', paddingHorizontal: scale(14), paddingVertical: scale(7), borderRadius: scale(8), alignItems: 'center' },
  declineBtn2Text: { color: 'rgba(255,255,255,0.6)', fontSize: scale(12) },
  atBoardBanner: { position: 'absolute', top: scale(78), left: scale(10), right: scale(10), zIndex: 58, backgroundColor: 'rgba(91,46,255,0.85)', paddingVertical: scale(8), paddingHorizontal: scale(16), borderRadius: scale(10), borderWidth: scale(1), borderColor: colors.primary, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  atBoardTextRow: { flexDirection: 'row', alignItems: 'center', gap: scale(7) },
  atBoardText: { color: colors.white, fontSize: scale(13), fontWeight: '600' },
  finishBtn: { backgroundColor: colors.white, paddingHorizontal: scale(12), paddingVertical: scale(5), borderRadius: scale(8) },
  finishBtnText: { color: colors.primary, fontSize: scale(12), fontWeight: '700' },
  mainContent: { ...StyleSheet.absoluteFillObject },
  mainContentPortrait: {}, // orientation now only affects the toolbar overlays below, not layout flow

  speakerView: { flex: 1, backgroundColor: '#111128', position: 'relative' },
  noVideoPlaceholder: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: scale(10) },
  noVideoText: { color: 'rgba(255,255,255,0.4)', fontSize: scale(14) },
  pipContainer: {
    position: 'absolute', bottom: scale(70), right: scale(74),
    width: scale(88), height: scale(116),
    borderRadius: scale(12), overflow: 'hidden',
    borderWidth: scale(2), borderColor: colors.primary,
  },
  boardViewFull: { flex: 1, position: 'relative', zIndex: 50 },
  pipStack: { position: 'absolute', top: scale(78), left: scale(92), zIndex: 60, gap: scale(6) },
  stackPip: { width: scale(88), height: scale(114), borderRadius: scale(12), overflow: 'hidden', borderWidth: scale(2), borderColor: colors.primary, backgroundColor: '#1E1E3F' },
  boardWatchBadge: { flexDirection: 'row', alignItems: 'center', gap: scale(6), position: 'absolute', top: scale(78), right: scale(74), zIndex: 60, backgroundColor: 'rgba(0,0,0,0.5)', paddingHorizontal: scale(10), paddingVertical: scale(6), borderRadius: scale(10) },
  boardWatchText: { color: colors.white, fontSize: scale(11), fontWeight: '600' },
  galleryGrid: { flexDirection: 'row', flexWrap: 'wrap', padding: scale(8), gap: scale(8), alignContent: 'flex-start' },
  galleryCell: { 
    width: isSmall ? Math.min(scale(150), width * 0.4) : scale(170), 
    height: isSmall ? Math.min(scale(110), height * 0.2) : scale(130), 
    borderRadius: scale(12), overflow: 'hidden', backgroundColor: '#1E1E3F', position: 'relative' 
  },
  galleryCellActive: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, borderRadius: scale(12), borderWidth: scale(2.5), borderColor: colors.green },
  galleryCellDots: { position: 'absolute', top: scale(8), right: scale(8), backgroundColor: 'rgba(0,0,0,0.55)', borderRadius: scale(10), paddingHorizontal: scale(7), paddingVertical: scale(4), zIndex: 10 },
  galleryCoHostBadge: {
    flexDirection: 'row', alignItems: 'center', gap: scale(4),
    position: 'absolute', top: scale(8), left: scale(8),
    backgroundColor: 'rgba(255,193,7,0.9)',
    borderRadius: scale(10), paddingHorizontal: scale(8), paddingVertical: scale(3),
    zIndex: 10,
  },
  galleryCoHostBadgeText: { color: '#3A2900', fontSize: scale(10), fontWeight: '700' },
  viewToggle: { position: 'absolute', bottom: scale(14), alignSelf: 'center', flexDirection: 'row', backgroundColor: '#1E1E3F', borderRadius: scale(20), padding: scale(3), gap: scale(2) },
  viewBtn: { paddingHorizontal: scale(14), paddingVertical: scale(5), borderRadius: scale(14) },
  viewBtnActive: { backgroundColor: colors.primary },
  viewBtnText: { color: colors.white, fontSize: scale(11), fontWeight: '600' },
  signalBadge: { position: 'absolute', top: scale(78), alignSelf: 'center', zIndex: 59, flexDirection: 'row', alignItems: 'center', gap: scale(8), backgroundColor: 'rgba(91,46,255,0.8)', paddingHorizontal: scale(14), paddingVertical: scale(7), borderRadius: scale(20) },
  signalBadgeText: { color: colors.white, fontSize: scale(12), fontWeight: '600' },
  // Always a full-width bottom bar now — see toolBtnSize in the component
  // for how button size (and therefore the bar's own height) adapts.
  toolbarScroll: {
    position: 'absolute', left: 0, right: 0, bottom: 0, zIndex: 40,
    paddingVertical: scale(8), backgroundColor: 'rgba(13,13,43,0.55)',
    paddingBottom: insets.bottom > 0 ? insets.bottom + scale(8) : scale(8),
  },
  toolbar: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: TOOLBAR_H_PADDING / 2,
  },
  toolBtn: { borderRadius: scale(10), backgroundColor: '#1E1E3F', alignItems: 'center', justifyContent: 'center', gap: scale(2) },
  toolBtnMuted: { backgroundColor: 'rgba(255,59,59,0.2)' },
  toolBtnActive: { backgroundColor: 'rgba(91,46,255,0.4)', borderWidth: scale(1), borderColor: colors.primary },
  toolBtnRed: { backgroundColor: 'rgba(255,59,59,0.3)' },
  // marginLeft (not marginTop) now that the toolbar is always a row —
  // still reads as "set apart from the rest" via the small extra gap.
  toolBtnEnd: { backgroundColor: 'rgba(255,59,59,0.5)', marginLeft: scale(8) },
  toolLabel: { fontSize: scale(7), color: 'rgba(255,255,255,0.5)', fontWeight: '600', textAlign: 'center' },
  toolBadge: {
    position: 'absolute',
    top: scale(2),
    right: scale(6),
    backgroundColor: colors.red,
    borderRadius: scale(9),
    minWidth: scale(16),
    height: scale(16),
    paddingHorizontal: scale(3),
    alignItems: 'center',
    justifyContent: 'center',
  },
  toolBadgeText: { color: colors.white, fontSize: scale(9), fontWeight: '700' },
  reactionsOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end' },
  reactionsPanel: { backgroundColor: '#1E1E3F', borderTopLeftRadius: scale(24), borderTopRightRadius: scale(24), padding: scale(24), gap: scale(14) },
  reactionsPanelTitle: { color: 'rgba(255,255,255,0.6)', fontSize: scale(11), fontWeight: '700', letterSpacing: 1 },
  signalsRow: { flexDirection: 'row', gap: scale(10) },
  signalBtn: { flex: 1, alignItems: 'center', gap: scale(6), padding: scale(12), backgroundColor: '#2E2E5F', borderRadius: scale(14), borderWidth: scale(1), borderColor: 'rgba(255,255,255,0.1)' },
  signalBtnActive: { borderColor: colors.primary, backgroundColor: 'rgba(91,46,255,0.3)' },
  signalBtnLabel: { fontSize: scale(10), color: 'rgba(255,255,255,0.7)', textAlign: 'center', fontWeight: '600' },
  reactionsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: scale(12), justifyContent: 'center' },
  reactionBtn: { 
    width: isSmall ? Math.min(scale(52), width * 0.12) : scale(60), 
    height: isSmall ? Math.min(scale(52), width * 0.12) : scale(60), 
    borderRadius: scale(16), backgroundColor: '#2E2E5F', alignItems: 'center', justifyContent: 'center' 
  },
  reactionEmoji: { fontSize: isSmall ? scale(24) : scale(30) },
  modOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'center', alignItems: 'center' },
  modDropdown: { 
    backgroundColor: '#1E1E3F', 
    borderRadius: scale(14), 
    padding: scale(16), 
    width: isSmall ? Math.min(scale(230), width * 0.88) : scale(250), 
    maxWidth: '92%', 
    borderWidth: scale(1), 
    borderColor: 'rgba(255,193,7,0.4)' 
  },
  modDropdownHeader: { color: '#FFC107', fontWeight: '700', fontSize: scale(14), paddingHorizontal: scale(10), paddingVertical: scale(10), borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.08)' },
  modDropdownItem: { flexDirection: 'row', alignItems: 'center', gap: scale(10), paddingVertical: scale(11), paddingHorizontal: scale(10), borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.06)' },
  modDropdownText: { fontSize: scale(14), color: colors.white },
  modDropdownTextDanger: { color: colors.red },
  modDropdownClose: { paddingVertical: scale(10), alignItems: 'center' },
  modDropdownCloseText: { color: 'rgba(255,255,255,0.4)', fontSize: scale(12) },
  }), [scale, isSmall, width, height]);
}