import React, { useState, useEffect, useRef, useMemo } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity,
  ScrollView, Modal, Alert
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

const SPEAKER_SWITCH_DELAY = 600;
const VOLUME_THRESHOLD = 10;

export default function AttendeeSession({ navigation, route }) {
  const session = route.params?.session;
  const { scale, isTablet, isDesktop, width, height } = useResponsive();
  const isPortraitPhone = !isTablet && height > width;
  const styles = useAttendeeSessionStyles(scale);
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
          navigation.navigate('AttendeeDashboard');
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
      const { data: { user: me } } = await supabase.auth.getUser();
      const { data: profile } = await supabase
        .from('profiles').select('full_name').eq('id', me.id).single();

      currentUserRef.current = { id: me.id, name: profile?.full_name || 'Attendee' };

      // Small delay to ensure control channel is subscribed
      setTimeout(() => {
        controlChannelRef.current?.send({
          type: 'broadcast',
          event: 'user-identity',
          payload: {
            agoraUid: myUidRef.current,
            userId: me.id,
            name: profile?.full_name || 'Attendee',
            isHost: false,
          },
        });
        console.log('📡 Identity broadcast sent');
      }, 1500);
    } catch (e) {}
  };

  const leaveAgoraOnly = async () => {
    await agoraSessionRef.current?.leave();
    agoraSessionRef.current = null;
  };

  const leaveSession = async (forced = false) => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        await supabase
          .from('session_attendees')
          .update({ left_at: new Date().toISOString() })
          .eq('session_id', session?.id)
          .eq('user_id', user.id);
      }
      await leaveAgoraOnly();
    } catch (e) {}
    if (forced) Alert.alert('Session ended', 'The host has ended the session.');
    navigation.navigate('AttendeeDashboard');
  };

  const handleLeave = () => {
    Alert.alert('Leave this session?', undefined, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Leave',
        style: 'destructive',
        onPress: async () => {
          await leaveAgoraOnly();
          navigation.navigate('AttendeeDashboard');
        },
      },
    ]);
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

  // ─── DUPLICATED UIDS (attendee-strip double-attach guard) ───
  // This screen has its own attendeeStrip rendering every remote user's
  // VideoTile unconditionally — the same pattern that causes blank/white
  // video on the host's screen when a track is handed to two mounted
  // <VideoTile>s at once (Agora's track.play() doesn't clone a stream per
  // call). This file didn't get that guard the first time it was fixed —
  // it was only applied to SessionMain.js. Same three "elsewhere" cases,
  // from this attendee's point of view:
  // - Board mode: the pipStack always shows remoteUsers[0] (the host).
  // - Speaker view: mainRemoteUser is the big central tile, whenever
  // this attendee isn't the one currently speaking.
  // - Gallery view: EVERY remote user (host included) is shown at once.
  const duplicatedRemoteUids = boardMode
    ? new Set(remoteUsers.length > 0 ? [remoteUsers[0].uid] : [])
    : view === 'gallery'
      ? new Set(remoteUsers.map(u => u.uid))
      : new Set(!localOnMain && mainRemoteUser ? [mainRemoteUser.uid] : []);

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

  return (
    <View style={styles.container}>
      <NotificationToastStack toasts={toasts} onDismiss={dismissToast} />

      {/* Top Bar */}
      <View style={styles.topBar}>
        <View>
          <Text style={styles.sessionTitle}>{session?.title || 'Session'}</Text>
          <View style={styles.modeBadge}>
            <ModeIcon mode={session?.mode} size={11} color={colors.white} />
            <Text style={styles.modeBadgeText}>{session?.mode || 'Session'}</Text>
          </View>
          {isCoHost && (
            <View style={styles.coHostChip}>
              <Ionicons name="star" size={10} color="#FFC107" />
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

      {/* Call to Board */}
      {showCallToBoard && !calledToBoard && (
        <View style={styles.callToBoardCard}>
          <View style={styles.callToBoardIconWrap}>
            <Ionicons name="create-outline" size={22} color={colors.primary} />
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
        <View style={styles.atBoardBanner}>
          <View style={styles.atBoardTextRow}>
            <Ionicons name="create-outline" size={15} color={colors.white} />
            <Text style={styles.atBoardText}>You are at the board</Text>
          </View>
          <TouchableOpacity style={styles.finishBtn} onPress={finishAtBoard}>
            <Text style={styles.finishBtnText}>Finish</Text>
          </TouchableOpacity>
        </View>
      )}

      <View style={[styles.mainContent, isPortraitPhone && styles.mainContentPortrait]}>

        {/* ─── STRIP — host and other remote users ─── */}
        <View style={[styles.attendeeStrip, isPortraitPhone && styles.attendeeStripHorizontal]}>
          <ScrollView
            horizontal={isPortraitPhone}
            showsVerticalScrollIndicator={false}
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={isPortraitPhone ? styles.stripContentHorizontal : styles.stripContent}
          >
            {remoteUsers.map((user, i) => {
              // This user's track is already playing in the board PiP
              // stack, as the big speaker-view tile, or in the Gallery
              // grid — don't hand it to a second VideoTile here too. See
              // duplicatedRemoteUids comment above.
              const isDuplicated = duplicatedRemoteUids.has(user.uid);
              const isHostTile = i === 0;
              // This peer's real camera state, reported over 'media-state'
              // broadcasts — see remoteMediaState comment above.
              const isCameraOff = !!remoteMediaState[user.uid]?.cameraOff;
              return (
                <View key={user.uid} style={styles.stripCell}>
                  <View style={[
                    styles.stripVideoWrap,
                    activeSpeakerUid === user.uid && styles.stripVideoWrapActive,
                  ]}>
                    <VideoTile
                      track={isDuplicated ? null : user.videoTrack}
                      cameraOff={isDuplicated || isCameraOff}
                      initials={isHostTile ? 'H' : `U${i}`}
                      style={StyleSheet.absoluteFillObject}
                      initialsSize={15}
                    />
                    {/* Co-host badge — visible to everyone, not just other co-hosts */}
                    {coHostUids[user.uid] && (
                      <View style={styles.stripCoHostBadge}>
                        <Ionicons name="star" size={9} color="#3A2900" />
                      </View>
                    )}
                    {/* Badge when this peer is currently muted */}
                    {remoteMediaState[user.uid]?.muted && (
                      <View style={styles.stripMutedBadge}>
                        <Ionicons name="mic-off-outline" size={9} color={colors.white} />
                      </View>
                    )}
                    {/* Moderation menu — only for co-hosts, and never on the host's own tile */}
                    {isCoHost && !isHostTile && (
                      <TouchableOpacity
                        style={styles.stripDotBtn}
                        onPress={() => setShowModDropdown(user.uid)}
                      >
                        <Ionicons name="ellipsis-vertical" size={12} color={colors.white} />
                      </TouchableOpacity>
                    )}
                    {activeSpeakerUid === user.uid && (
                      <View style={[styles.speakingRing, { pointerEvents: 'none' }]} />
                    )}
                  </View>
                  <Text style={styles.stripName} numberOfLines={1}>
                    {isHostTile ? 'Host' : `User ${i}`}
                  </Text>
                </View>
              );
            })}
          </ScrollView>
        </View>

        {/* ─── MAIN VIEW ─── */}
        <View style={styles.speakerView}>
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
                      initialsSize={13}
                    />
                  </View>
                )}
                <View style={styles.stackPip}>
                  <VideoTile track={localVideoTrack} cameraOff={cameraOff} initials="You" label="You" style={{ flex: 1 }} initialsSize={13} mirror={true} />
                </View>
              </View>

              <View style={styles.boardWatchBadge}>
                <Ionicons
                  name={effectiveBoardCanEdit ? 'create-outline' : (calledToBoard && hostInterrupting ? 'pause-outline' : 'eye-outline')}
                  size={12}
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
            <ScrollView style={{ flex: 1 }} contentContainerStyle={styles.galleryGrid}>
              <View style={styles.galleryCell}>
                <VideoTile track={localVideoTrack} cameraOff={cameraOff} initials="You" label={iAmSpeaking ? 'You' : 'You'} style={{ flex: 1 }} initialsSize={20} mirror={true} />
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
                    initialsSize={20}
                  />
                  {coHostUids[user.uid] && (
                    <View style={styles.galleryCoHostBadge}>
                      <Ionicons name="star" size={10} color="#3A2900" />
                      <Text style={styles.galleryCoHostBadgeText}>Co-host</Text>
                    </View>
                  )}
                  {isCoHost && i !== 0 && (
                    <TouchableOpacity style={styles.galleryCellDots} onPress={() => setShowModDropdown(user.uid)}>
                      <Ionicons name="ellipsis-vertical" size={14} color={colors.white} />
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
                  initialsSize={40}
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
                  initialsSize={40}
                />
              ) : (
                <View style={styles.noVideoPlaceholder}>
                  <Ionicons name="hourglass-outline" size={34} color="rgba(255,255,255,0.4)" />
                  <Text style={styles.noVideoText}>{joined ? 'Waiting for host video...' : 'Connecting...'}</Text>
                </View>
              )}

              {/* PiP — show attendee's self-view when NOT on main */}
              {showPiP && (
                <View style={styles.pipContainer}>
                  <VideoTile track={localVideoTrack} cameraOff={cameraOff} initials="You" label="You" style={{ flex: 1 }} initialsSize={13} mirror={true} />
                </View>
              )}
            </>
          )}

          {/* Signal Badge */}
          {activeSignal && !boardMode && (
            <View style={styles.signalBadge}>
              <Ionicons name={SIGNAL_ICON[activeSignal] || 'hand-left-outline'} size={14} color={colors.white} />
              <Text style={styles.signalBadgeText}>Signal sent</Text>
              <TouchableOpacity onPress={() => sendSignal(activeSignal)}>
                <Ionicons name="close" size={16} color="rgba(255,255,255,0.7)" />
              </TouchableOpacity>
            </View>
          )}

          {/* View Toggle */}
          {!boardMode && (
            <View style={styles.viewToggle}>
              <TouchableOpacity style={[styles.viewBtn, view === 'speaker' && styles.viewBtnActive]} onPress={() => setView('speaker')}>
                <Text style={styles.viewBtnText}>Speaker</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.viewBtn, view === 'gallery' && styles.viewBtnActive]} onPress={() => setView('gallery')}>
                <Text style={styles.viewBtnText}>Gallery</Text>
              </TouchableOpacity>
            </View>
          )}
        </View>

        {/* Attendee Toolbar */}
        <ScrollView
          horizontal={isPortraitPhone}
          style={[styles.toolbarScroll, isPortraitPhone && styles.toolbarScrollHorizontal]}
          contentContainerStyle={isPortraitPhone ? styles.toolbarHorizontal : styles.toolbar}
          showsVerticalScrollIndicator={false}
          showsHorizontalScrollIndicator={false}
        >
          <TouchableOpacity style={[styles.toolBtn, muted && styles.toolBtnMuted]} onPress={toggleMic}>
            <Ionicons name={muted ? 'mic-off-outline' : 'mic-outline'} size={18} color={colors.white} />
            <Text style={styles.toolLabel}>{muted ? 'Unmute' : 'Mute'}</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.toolBtn, cameraOff && styles.toolBtnMuted]} onPress={toggleCamera}>
            <Ionicons name={cameraOff ? 'videocam-off-outline' : 'videocam-outline'} size={18} color={colors.white} />
            <Text style={styles.toolLabel}>{cameraOff ? 'Cam Off' : 'Cam On'}</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.toolBtn} onPress={() => setShowReactions(true)}>
            <Ionicons name="happy-outline" size={18} color={colors.white} />
            <Text style={styles.toolLabel}>React</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.toolBtn, activeSignal === 'hand' && styles.toolBtnActive]} onPress={() => sendSignal('hand')}>
            <Ionicons name={SIGNAL_ICON.hand} size={18} color={colors.white} />
            <Text style={styles.toolLabel}>Hand</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.toolBtn, activeSignal === 'correction' && styles.toolBtnRed]} onPress={() => sendSignal('correction')}>
            <Ionicons name={SIGNAL_ICON.correction} size={18} color={colors.white} />
            <Text style={styles.toolLabel}>Correct</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.toolBtn, activeSignal === 'speak' && styles.toolBtnActive]} onPress={() => sendSignal('speak')}>
            <Ionicons name={SIGNAL_ICON.speak} size={18} color={colors.white} />
            <Text style={styles.toolLabel}>Speak</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.toolBtn} onPress={openChat}>
            <Ionicons name="chatbubble-outline" size={18} color={colors.white} />
            <Text style={styles.toolLabel}>Chat</Text>
            {!!unreadCount && (
              <View style={styles.toolBadge}>
                <Text style={styles.toolBadgeText}>{unreadCount > 9 ? '9+' : unreadCount}</Text>
              </View>
            )}
          </TouchableOpacity>
          <TouchableOpacity style={styles.toolBtn} onPress={openPoll}>
            <Ionicons name="stats-chart-outline" size={18} color={colors.white} />
            <Text style={styles.toolLabel}>Poll</Text>
            {!!pollNotice && (
              <View style={styles.toolBadge}>
                <Text style={styles.toolBadgeText}>!</Text>
              </View>
            )}
          </TouchableOpacity>
          <TouchableOpacity style={[styles.toolBtn, styles.toolBtnEnd]} onPress={handleLeave}>
            <Ionicons name="exit-outline" size={18} color={colors.white} />
            <Text style={styles.toolLabel}>Leave</Text>
          </TouchableOpacity>
        </ScrollView>
      </View>

      {/* Reactions Modal */}
      <Modal visible={showReactions} transparent animationType="slide" onRequestClose={() => setShowReactions(false)}>
        <TouchableOpacity style={styles.reactionsOverlay} activeOpacity={1} onPress={() => setShowReactions(false)}>
          <View style={styles.reactionsPanel}>
            <Text style={styles.reactionsPanelTitle}>SIGNALS</Text>
            <View style={styles.signalsRow}>
              {signals.map(s => (
                <TouchableOpacity key={s.key} style={[styles.signalBtn, activeSignal === s.key && styles.signalBtnActive]} onPress={() => { sendSignal(s.key); setShowReactions(false); }}>
                  <Ionicons name={s.icon} size={22} color={colors.white} />
                  <Text style={styles.signalBtnLabel}>{s.label}</Text>
                </TouchableOpacity>
              ))}
            </View>
            <Text style={styles.reactionsPanelTitle}>REACTIONS</Text>
            <View style={styles.reactionsGrid}>
              {reactions.map((emoji, i) => (
                <TouchableOpacity key={i} style={styles.reactionBtn} onPress={() => sendReaction(emoji)}>
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
                <Ionicons name={item.icon} size={16} color={item.danger ? colors.red : colors.white} />
                <Text style={[styles.modDropdownText, item.danger && styles.modDropdownTextDanger]}>{item.label}</Text>
              </TouchableOpacity>
            ))}
            <TouchableOpacity style={styles.modDropdownClose} onPress={() => setShowModDropdown(null)}>
              <Text style={styles.modDropdownCloseText}>Close</Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </Modal>
    </View>
  );
}

function useAttendeeSessionStyles(scale) {
  return useMemo(() => StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0A0A1A' },
  topBar: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 12, paddingTop: 20, backgroundColor: '#0D0D2B' },
  sessionTitle: { fontSize: 15, fontWeight: '700', color: colors.white },
  modeBadge: { flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: 'rgba(255,255,255,0.12)', alignSelf: 'flex-start', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 10, marginTop: 3 },
  modeBadgeText: { color: colors.white, fontSize: 10, fontWeight: '600', textTransform: 'capitalize' },
  coHostChip: { flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: 'rgba(255,193,7,0.18)', borderWidth: 1, borderColor: 'rgba(255,193,7,0.6)', alignSelf: 'flex-start', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 10, marginTop: 5 },
  coHostChipText: { color: '#FFC107', fontSize: 10, fontWeight: '700' },
  topRight: { alignItems: 'flex-end', gap: 4 },
  recordingBadge: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: 'rgba(255,59,59,0.2)', paddingHorizontal: 7, paddingVertical: 3, borderRadius: 7 },
  recordingDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: colors.red },
  recordingText: { color: colors.red, fontSize: 10, fontWeight: '700' },
  liveIndicator: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: 'rgba(46,204,113,0.2)', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 7 },
  liveDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: colors.green },
  liveText: { color: colors.green, fontSize: 10, fontWeight: '700' },
  callToBoardCard: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#1E1E3F', margin: 10, borderRadius: 14, padding: 14, gap: 10, borderWidth: 1, borderColor: colors.primary },
  callToBoardIconWrap: { width: scale(40), height: scale(40), borderRadius: 12, backgroundColor: 'rgba(91,46,255,0.2)', alignItems: 'center', justifyContent: 'center' },
  callToBoardInfo: { flex: 1 },
  callToBoardTitle: { color: colors.white, fontWeight: '700', fontSize: 14 },
  callToBoardSubtitle: { color: 'rgba(255,255,255,0.5)', fontSize: 12, marginTop: 2 },
  callToBoardBtns: { gap: 6 },
  acceptBtn: { backgroundColor: colors.green, paddingHorizontal: 14, paddingVertical: 7, borderRadius: 8, alignItems: 'center' },
  acceptBtnText: { color: colors.white, fontWeight: '700', fontSize: 12 },
  declineBtn2: { borderWidth: 1, borderColor: 'rgba(255,255,255,0.2)', paddingHorizontal: 14, paddingVertical: 7, borderRadius: 8, alignItems: 'center' },
  declineBtn2Text: { color: 'rgba(255,255,255,0.6)', fontSize: 12 },
  atBoardBanner: { backgroundColor: 'rgba(91,46,255,0.3)', paddingVertical: 8, paddingHorizontal: 16, margin: 10, borderRadius: 10, borderWidth: 1, borderColor: colors.primary, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  atBoardTextRow: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  atBoardText: { color: colors.white, fontSize: 13, fontWeight: '600' },
  finishBtn: { backgroundColor: colors.white, paddingHorizontal: 12, paddingVertical: 5, borderRadius: 8 },
  finishBtnText: { color: colors.primary, fontSize: 12, fontWeight: '700' },
  mainContent: { flex: 1, flexDirection: 'row' },
  mainContentPortrait: { flexDirection: 'column' },

  // ── STRIP — compact for attendee screen ──
  attendeeStrip: { width: scale(80), backgroundColor: '#0D0D2B', paddingVertical: 6 },
  attendeeStripHorizontal: { width: '100%', height: scale(92), paddingVertical: 0, paddingHorizontal: 6 },
  stripContent: { alignItems: 'center', gap: 8, paddingBottom: 8 },
  stripContentHorizontal: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 8 },
  stripCell: { width: scale(68), alignItems: 'center', gap: 3 },
  stripVideoWrap: {
    width: scale(68), height: scale(54),
    borderRadius: 8,
    overflow: 'hidden',
    borderWidth: 1.5,
    borderColor: 'rgba(255,255,255,0.12)',
    position: 'relative',
    backgroundColor: '#1E1E3F',
  },
  stripVideoWrapActive: { borderColor: colors.green, borderWidth: 2 },
  speakingRing: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, borderRadius: 8, borderWidth: 2.5, borderColor: colors.green },
  stripCoHostBadge: {
    position: 'absolute', bottom: 4, right: 4,
    backgroundColor: 'rgba(255,193,7,0.9)',
    borderRadius: 8, paddingHorizontal: 4, paddingVertical: 2,
    zIndex: 20,
  },
  stripMutedBadge: {
    position: 'absolute', bottom: 4, left: 4,
    backgroundColor: 'rgba(255,59,59,0.85)',
    borderRadius: 8, paddingHorizontal: 4, paddingVertical: 2,
    zIndex: 20,
  },
  stripDotBtn: {
    position: 'absolute', top: 4, right: 4,
    backgroundColor: 'rgba(0,0,0,0.6)',
    borderRadius: 8, paddingHorizontal: 5, paddingVertical: 2,
    zIndex: 20,
  },
  stripName: { color: 'rgba(255,255,255,0.6)', fontSize: 9, textAlign: 'center' },

  speakerView: { flex: 1, backgroundColor: '#111128', position: 'relative' },
  noVideoPlaceholder: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 10 },
  noVideoText: { color: 'rgba(255,255,255,0.4)', fontSize: 14 },
  pipContainer: {
    position: 'absolute', bottom: 70, right: 14,
    width: scale(88), height: scale(116),
    borderRadius: 12, overflow: 'hidden',
    borderWidth: 2, borderColor: colors.primary,
  },
  boardViewFull: { flex: 1, position: 'relative', zIndex: 50 },
  pipStack: { position: 'absolute', top: 12, left: 12, zIndex: 60, gap: 6 },
  stackPip: { width: scale(88), height: scale(114), borderRadius: 12, overflow: 'hidden', borderWidth: 2, borderColor: colors.primary, backgroundColor: '#1E1E3F' },
  boardWatchBadge: { flexDirection: 'row', alignItems: 'center', gap: 6, position: 'absolute', top: 12, right: 12, backgroundColor: 'rgba(0,0,0,0.5)', paddingHorizontal: 10, paddingVertical: 6, borderRadius: 10 },
  boardWatchText: { color: colors.white, fontSize: 11, fontWeight: '600' },
  galleryGrid: { flexDirection: 'row', flexWrap: 'wrap', padding: 8, gap: 8, alignContent: 'flex-start' },
  galleryCell: { width: scale(170), height: scale(130), borderRadius: 12, overflow: 'hidden', backgroundColor: '#1E1E3F', position: 'relative' },
  galleryCellActive: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, borderRadius: 12, borderWidth: 2.5, borderColor: colors.green },
  galleryCellDots: { position: 'absolute', top: 8, right: 8, backgroundColor: 'rgba(0,0,0,0.55)', borderRadius: 10, paddingHorizontal: 7, paddingVertical: 4, zIndex: 10 },
  galleryCoHostBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    position: 'absolute', top: 8, left: 8,
    backgroundColor: 'rgba(255,193,7,0.9)',
    borderRadius: 10, paddingHorizontal: 8, paddingVertical: 3,
    zIndex: 10,
  },
  galleryCoHostBadgeText: { color: '#3A2900', fontSize: 10, fontWeight: '700' },
  viewToggle: { position: 'absolute', bottom: 14, alignSelf: 'center', flexDirection: 'row', backgroundColor: '#1E1E3F', borderRadius: 20, padding: 3, gap: 2, left: '20%' },
  viewBtn: { paddingHorizontal: 14, paddingVertical: 5, borderRadius: 14 },
  viewBtnActive: { backgroundColor: colors.primary },
  viewBtnText: { color: colors.white, fontSize: 11, fontWeight: '600' },
  signalBadge: { position: 'absolute', top: 12, alignSelf: 'center', flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: 'rgba(91,46,255,0.8)', paddingHorizontal: 14, paddingVertical: 7, borderRadius: 20, left: '10%' },
  signalBadgeText: { color: colors.white, fontSize: 12, fontWeight: '600' },
  toolbarScroll: { width: scale(62), backgroundColor: '#0D0D2B' },
  toolbarScrollHorizontal: { width: '100%', height: scale(80) },
  toolbar: { paddingVertical: 8, alignItems: 'center', gap: 4 },
  toolbarHorizontal: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 8 },
  toolBtn: { width: scale(50), height: scale(50), borderRadius: 10, backgroundColor: '#1E1E3F', alignItems: 'center', justifyContent: 'center', gap: 2 },
  toolBtnMuted: { backgroundColor: 'rgba(255,59,59,0.2)' },
  toolBtnActive: { backgroundColor: 'rgba(91,46,255,0.4)', borderWidth: 1, borderColor: colors.primary },
  toolBtnRed: { backgroundColor: 'rgba(255,59,59,0.3)' },
  toolBtnEnd: { backgroundColor: 'rgba(255,59,59,0.5)', marginTop: 8 },
  toolLabel: { fontSize: 7, color: 'rgba(255,255,255,0.5)', fontWeight: '600', textAlign: 'center' },
  toolBadge: {
    position: 'absolute',
    top: 2,
    right: 6,
    backgroundColor: colors.red,
    borderRadius: 9,
    minWidth: 16,
    height: 16,
    paddingHorizontal: 3,
    alignItems: 'center',
    justifyContent: 'center',
  },
  toolBadgeText: { color: colors.white, fontSize: 9, fontWeight: '700' },
  reactionsOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end' },
  reactionsPanel: { backgroundColor: '#1E1E3F', borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 24, gap: 14 },
  reactionsPanelTitle: { color: 'rgba(255,255,255,0.6)', fontSize: 11, fontWeight: '700', letterSpacing: 1 },
  signalsRow: { flexDirection: 'row', gap: 10 },
  signalBtn: { flex: 1, alignItems: 'center', gap: 6, padding: 12, backgroundColor: '#2E2E5F', borderRadius: 14, borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)' },
  signalBtnActive: { borderColor: colors.primary, backgroundColor: 'rgba(91,46,255,0.3)' },
  signalBtnLabel: { fontSize: 10, color: 'rgba(255,255,255,0.7)', textAlign: 'center', fontWeight: '600' },
  reactionsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, justifyContent: 'center' },
  reactionBtn: { width: scale(60), height: scale(60), borderRadius: 16, backgroundColor: '#2E2E5F', alignItems: 'center', justifyContent: 'center' },
  reactionEmoji: { fontSize: 30 },
  modOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'center', alignItems: 'center' },
  modDropdown: { backgroundColor: '#1E1E3F', borderRadius: 14, padding: 16, width: scale(250), maxWidth: '92%', borderWidth: 1, borderColor: 'rgba(255,193,7,0.4)' },
  modDropdownHeader: { color: '#FFC107', fontWeight: '700', fontSize: 14, paddingHorizontal: 10, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.08)' },
  modDropdownItem: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 11, paddingHorizontal: 10, borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.06)' },
  modDropdownText: { fontSize: 14, color: colors.white },
  modDropdownTextDanger: { color: colors.red },
  modDropdownClose: { paddingVertical: 10, alignItems: 'center' },
  modDropdownCloseText: { color: 'rgba(255,255,255,0.4)', fontSize: 12 },
  }), [scale]);
}