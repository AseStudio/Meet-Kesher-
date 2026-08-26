import React, { useState, useEffect, useRef, useMemo } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, Alert,
  ScrollView, Modal, Platform
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '../../theme/colors';
import { supabase } from '../../lib/supabase';
import { createAgoraSession } from '../../services/agora/AgoraService';
import { AGORA_APP_ID } from '../../lib/constants';
import VideoTile from '../../components/VideoTile';
import WhiteboardCanvas from '../../components/WhiteboardCanvas'; // adjust path if these live elsewhere
import GraphBoardCanvas from '../../components/GraphboardCanvas';
import NotificationToastStack from '../../components/NotificationToast';
import { ModeIcon, SIGNAL_ICON, BOARD_TYPE_ICON } from '../../lib/iconMeta';
import { useResponsive } from '../../lib/responsive';

const REACTIONS = ['👍', '👏', '❤️', '😂', '🔥', '😮'];

// How long someone must be speaking before we switch to them (ms)
const SPEAKER_SWITCH_DELAY = 600;
// Volume threshold (0-100) — below this is considered silence
const VOLUME_THRESHOLD = 10;

// Toolbar now always docks along the bottom of the screen, in every
// orientation and at every size — see the sizing block right before the
// `tools` array below for how button size/spacing adapt to fit.
const TOOLBAR_MIN_BTN = 34;
const TOOLBAR_MAX_BTN = 54;
const TOOLBAR_H_PADDING = 20; // total horizontal inset the bar reserves

export default function SessionMain({ navigation, route }) {
  const session = route.params?.session;
  const { scale, isTablet, isDesktop, width, height } = useResponsive();
  const styles = useSessionMainStyles(scale);

  // Video states
  const [muted, setMuted] = useState(false);
  const [cameraOff, setCameraOff] = useState(false);
  const [localVideoTrack, setLocalVideoTrack] = useState(null);
  const [recording, setRecording] = useState(false);
  const [view, setView] = useState('speaker');
  const [remoteUsers, setRemoteUsers] = useState([]);
  const [activeSpeakerUid, setActiveSpeakerUid] = useState(null); // null = default (show host)
  const [myUid, setMyUid] = useState(null);
  const [joined, setJoined] = useState(false);
  const [sessionSeconds, setSessionSeconds] = useState(0);

  // Attendee strip visibility — visible on load (so there's something to
  // see/tap before anyone knows to move the mouse or touch the screen),
  // then auto-hides after a few seconds of no interaction, and comes back
  // on tap/hover.
  const [controlsVisible, setControlsVisible] = useState(true);
  const controlsHideTimerRef = useRef(null);
  const revealControls = () => {
    setControlsVisible(true);
    if (controlsHideTimerRef.current) clearTimeout(controlsHideTimerRef.current);
    controlsHideTimerRef.current = setTimeout(() => setControlsVisible(false), 3000);
  };
  useEffect(() => {
    // Starts the initial 3s countdown so the controls that are visible on
    // load actually hide on schedule — without this they'd stay visible
    // forever until the first tap/mouse-move, since setting the state to
    // true above doesn't by itself arm the hide timer.
    revealControls();
    return () => {
      if (controlsHideTimerRef.current) clearTimeout(controlsHideTimerRef.current);
    };
  }, []);
  // PCs/trackpads never fire onTouchStart — there's no finger touching
  // anything — so mouse movement is the desktop equivalent of a tap here,
  // same as hovering reveals controls on YouTube/Zoom on web. Spread this
  // alongside onTouchStart on the same elements; it's a no-op on native
  // (RN ignores the unrecognized prop there).
  const revealOnHoverProps = Platform.OS === 'web' ? { onMouseMove: revealControls } : {};

function getProfileKey(uplink = 0, downlink = 0) {
  const q = Math.max(uplink, downlink);
  if (q <= 1) return 'ultra';   // excellent → 1080p
  if (q <= 2) return 'high';    // good → 720p
  if (q <= 4) return 'medium';  // poor → 360p
  return 'low';                 // very bad → 180p
}

  // Board states — the actual drawing/graphing logic now lives inside
  // WhiteboardCanvas / GraphBoardCanvas. SessionMain just decides WHICH
  // board is showing and renders it as an overlay instead of navigating away.
  const [boardMode, setBoardMode] = useState(null); // null | 'whiteboard' | 'blackboard' | 'graph'
  const [showBoardPicker, setShowBoardPicker] = useState(false);
  // When set, the board picker is being shown to choose a type for a call
  // ("Call to Board" with no board open yet) rather than the host just
  // opening a board for themself via the toolbar. Cleared once resolved.
  const [boardPickerTargetUid, setBoardPickerTargetUid] = useState(null);
  // Agora uids of attendees currently granted edit access on the open board.
  // Populated from 'board-invite-response' (accepted) and cleared on
  // decline/finish/revoke/board close. This is what makes an "uncall"
  // button possible — without tracking it there's nothing to revoke.
  const [boardEditors, setBoardEditors] = useState({});
  // uid the host has called but who hasn't responded yet — the board does
  // NOT open for anyone (host included) until this resolves to an accept.
  // On decline, this just clears and nothing ever opened.
  const [pendingCallUid, setPendingCallUid] = useState(null);
  // Board type queued for the pending call. Only used to actually open the
  // board once the invite is accepted.
  const [pendingBoardType, setPendingBoardType] = useState(null);
  // True while the host is actively "interrupting" — temporarily taking
  // over edit rights from whoever's currently called to the board. Once a
  // call has been accepted, the host is normally in view-only mode (same
  // as any other non-called attendee) and must tap Interrupt to draw.
  const [hostInterrupting, setHostInterrupting] = useState(false);

  // The host's own identity, passed down to board components for
  // attribution (stroke authorship, cursor labels, etc). Adjust the
  // `name` fallback below to match wherever you actually store display names.
  const [hostUser, setHostUser] = useState(null);
  // Mirror of hostUser for use inside callbacks/handlers that were
  // registered once at mount (setupControlChannel, initAgora) — their
  // closures would otherwise only ever see hostUser as it was at mount
  // time (null), same reason uidToUserRef/boardModeRef/etc exist below.
  const hostUserRef = useRef(null);
  useEffect(() => { hostUserRef.current = hostUser; }, [hostUser]);

  // UI states
  const [showDropdown, setShowDropdown] = useState(null);
  const [showApproval, setShowApproval] = useState(false);
  // ─── CO-HOST STATE ───
  // uid -> { userId, name }, for attendees currently granted co-host
  // status. Co-hosts get a reduced slice of the host's moderation powers
  // (mute/camera-off request, call-to-board, uncall, remove from
  // session) — deliberately NOT ban, end-session, recording, or the
  // ability to make/revoke other co-hosts, since those are either
  // permanent/destructive or would let privilege chain uncontrollably.
  //
  // SECURITY MODEL: a co-host's client never performs the underlying
  // Supabase writes (session_attendees update, bans insert) or board
  // orchestration itself — it only broadcasts a REQUEST
  // ('cohost-action-request'), which only the HOST's client acts on,
  // and only after checking coHostsRef below to confirm the requester is
  // actually a co-host right now. This keeps a single source of truth
  // for privileged writes and board state (no two clients racing to both
  // open a board or write the same DB row), and means a co-host never
  // needs elevated RLS permissions of their own — the host's existing
  // permissions cover every relayed action. It is NOT a bulletproof
  // security boundary (a sufficiently malicious client could still spoof
  // a request with someone else's uid) — real enforcement would need a
  // server-side check (e.g. an Edge Function validating co-host status
  // against a table), which is out of scope here but worth flagging.
  const [coHosts, setCoHosts] = useState({});
  const coHostsRef = useRef({});
  useEffect(() => { coHostsRef.current = coHosts; }, [coHosts]);
  // Inline "Co-Host Manager" panel — lists every attendee with a
  // grant/revoke toggle. Replaces the old dead-end
  // navigation.navigate('CoHostManager') call to a screen that never
  // existed.
  const [showCoHostManager, setShowCoHostManager] = useState(false);
  // Inline reactions modal — previously this button navigated to a
  // separate ReactionsPanel screen with no way to broadcast anything.
  // Switched to the same inline-modal pattern AttendeeSession already
  // uses: quicker (no leaving the call just to tap an emoji), and lets
  // both sides share identical reaction-sending logic.
  const [showReactions, setShowReactions] = useState(false);
  // Fade in/out notifications — reactions from anyone, plus chat
  // notifications (see the session-messages-watch effect below).
  const [toasts, setToasts] = useState([]);
  // Unread chat count for the toolbar badge — reset the moment the host
  // taps into Chat, not when they've "finished reading".
  const [unreadCount, setUnreadCount] = useState(0);
  // Mirrors unreadCount's pattern for the Poll button — true from the
  // moment someone else launches a poll until the host actually opens
  // PollScreen. See the session-polls-watch effect below for how this
  // gets set without this file ever touching PollScreen's own realtime
  // topic (session-poll-${id}).
  const [pollNotice, setPollNotice] = useState(false);

  // Refs
  const agoraSessionRef = useRef(null);
  const myUidRef = useRef(null);
  const speakerSwitchTimeoutRef = useRef(null);
  const controlChannelRef = useRef(null);
  // True while ChatPanel / PollScreen is the currently-open screen. Set
  // right before navigating there (openChat/openPoll below), cleared
  // whenever this screen regains focus (meaning whatever was pushed on
  // top just closed — see the focus-listener effect below). Without
  // this, session-messages-watch / session-polls-watch (further down)
  // kept firing their toast + badge-increment even while the person was
  // ALREADY looking at the live message/poll inside that screen —
  // SessionMain never unmounts underneath a pushed screen, so those
  // watcher effects just kept running in the background regardless.
  const chatOpenRef = useRef(false);
  const pollOpenRef = useRef(false);
  useEffect(() => {
    const unsub = navigation.addListener('focus', () => {
      chatOpenRef.current = false;
      pollOpenRef.current = false;
    });
    return unsub;
  }, [navigation]);
  const [uidToUser, setUidToUser] = useState({});
  // Mirror uidToUser into a ref so realtime callbacks (set up once on mount)
  // always read the latest map instead of the stale one captured at mount time.
  const uidToUserRef = useRef({});
  useEffect(() => { uidToUserRef.current = uidToUser; }, [uidToUser]);
  // The 'board-invite-response' handler below is registered once, at mount,
  // inside setupControlChannel — its closure would otherwise always see
  // boardMode/pendingBoardType as they were at mount time (null). Mirror
  // them into refs so the handler can read current values.
  const boardModeRef = useRef(null);
  useEffect(() => { boardModeRef.current = boardMode; }, [boardMode]);
  const pendingBoardTypeRef = useRef(null);
  useEffect(() => { pendingBoardTypeRef.current = pendingBoardType; }, [pendingBoardType]);
  // Agora uid -> { muted, cameraOff }, reported by each attendee's own
  // client whenever their mic/camera state changes (self-toggled OR
  // because a host request just forced it). This is what lets the strip
  // show a muted badge and confirms a mute/camera-off request actually
  // landed on their end — we have no other way to know, since a host
  // can't read another client's local track state directly.
  //
  // IMPORTANT: this is also the ONLY source of truth the host has for
  // whether a given attendee's camera is actually on. Every place below
  // that renders a remote user's VideoTile now passes
  // attendeeMediaState[uid]?.cameraOff through as that tile's `cameraOff`
  // prop. Previously only the "already showing this track elsewhere"
  // dedup case set `cameraOff`, so a genuinely camera-off attendee (which
  // is the DEFAULT for attendees — see AttendeeSession.js) got handed a
  // real-but-disabled track with no `cameraOff` flag: a disabled track
  // emits no frames, VideoTile had no signal to fall back to the initials
  // avatar, and the tile just rendered blank. That's why an attendee
  // could be confirmed "in the session" (present in remoteUsers / chat
  // roster) while never actually appearing on the host's screen anywhere.
  const [attendeeMediaState, setAttendeeMediaState] = useState({});
  // uid -> { name, signal }, for attendees currently signaling the host
  // (raise hand / point of correction / want to speak). Populated from
  // 'attendee-signal' broadcasts — AttendeeSession.js's signal buttons
  // previously only ever set LOCAL state on the attendee's own screen
  // ("Signal sent"), with no broadcast at all, so the host never
  // actually learned about it. This is the host-side half of that fix.
  const [attendeeSignals, setAttendeeSignals] = useState({});

  // Session timer
  useEffect(() => {
    const timer = setInterval(() => setSessionSeconds(s => s + 1), 1000);
    return () => clearInterval(timer);
  }, []);

  // Heartbeat — server-side check-expired-lobbies watches for this going
  // stale to auto-end a live session whose host's app has disappeared
  // (closed, crashed, force-quit, lost network).
  useEffect(() => {
    if (!session?.id) return;
    const beat = () => {
      supabase.from('sessions').update({ last_seen_at: new Date().toISOString() }).eq('id', session.id);
    };
    beat();
    const interval = setInterval(beat, 15000);
    return () => clearInterval(interval);
  }, [session?.id]);

  // Report the HOST's own mic/camera state, same as AttendeeSession.js
  // already does for every attendee. This was missing entirely — nothing
  // here ever told attendees the host's real camera state, and
  // AttendeeSession.js had no listener for it either (see that file's
  // matching fix). Without this, attendees had zero way to distinguish
  // "host's camera is off" from "host's video just hasn't loaded yet",
  // and every remote VideoTile call on the attendee side either omitted
  // cameraOff entirely or derived it from unrelated layout logic.
  useEffect(() => {
    if (!joined) return;
    controlChannelRef.current?.send({
      type: 'broadcast',
      event: 'media-state',
      payload: { uid: myUidRef.current, muted, cameraOff },
    });
  }, [muted, cameraOff, joined]);

  useEffect(() => {
    initAgora();
    setupControlChannel();
    loadHostIdentity();
    return () => {
      if (speakerSwitchTimeoutRef.current) clearTimeout(speakerSwitchTimeoutRef.current);
      leaveAgora();
      if (controlChannelRef.current) supabase.removeChannel(controlChannelRef.current);
    };
  }, []);

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
        const myId = hostUserRef.current?.id;
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

  // Separate, uniquely-named subscription — same reasoning as
  // session-messages-watch just above: PollScreen.js owns
  // session-poll-${session.id} exclusively (its own realtime topic, per
  // that file's header comment), so this file never subscribes there
  // directly. Instead it watches postgres_changes on session_polls,
  // which is enough to toast + badge "a poll launched" without touching
  // PollScreen's topic at all.
  useEffect(() => {
    if (!session?.id) return;
    const ch = supabase
      .channel(`session-polls-watch-${session.id}`)
      .on('postgres_changes', {
        event: 'INSERT', schema: 'public', table: 'session_polls',
        filter: `session_id=eq.${session.id}`,
      }, (payload) => {
        const p = payload.new;
        if (p.created_by === hostUserRef.current?.id) return; // I launched it myself
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
      payload: { name: hostUserRef.current?.name || 'Host', emoji },
    });
  };

  // Sends the host's own identity over the control channel, but only once
  // everything it needs is actually available: the channel itself, the
  // Supabase user profile (hostUser), AND our assigned Agora uid. These
  // three become ready at unpredictable times relative to each other
  // (loadHostIdentity resolves whenever auth.getUser() does; the Agora
  // uid isn't known until client.join() finishes over the network) — so
  // this is called from BOTH loadHostIdentity and initAgora below, each
  // after a short settle delay. Whichever of the two finishes LAST is the
  // one that actually succeeds in sending; the earlier call just bails out
  // via the guard. This is what fixes the previous bug where the host's
  // identity broadcast always went out with `agoraUid: undefined` (it
  // fired unconditionally from inside loadHostIdentity alone, with no
  // guarantee the Agora join had completed yet).
  const broadcastHostIdentityIfReady = () => {
    if (!controlChannelRef.current || !hostUserRef.current || myUidRef.current == null) return;
    controlChannelRef.current.send({
      type: 'broadcast',
      event: 'user-identity',
      payload: {
        agoraUid: myUidRef.current,
        userId: hostUserRef.current.id,
        name: hostUserRef.current.name,
        isHost: true,
      },
    });
  };

  const loadHostIdentity = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        const identity = { id: user.id, name: user.user_metadata?.name || user.email || 'Host' };
        setHostUser(identity);
        hostUserRef.current = identity; // set synchronously too — don't wait on the effect above
        // Same 1500ms settle delay AttendeeSession.js uses before its own
        // identity broadcast, to give the control channel time to finish
        // subscribing. See broadcastHostIdentityIfReady's comment for why
        // this alone isn't sufficient and initAgora also calls it.
        setTimeout(broadcastHostIdentityIfReady, 1500);
      }
    } catch (e) {
      console.log('Could not load host identity:', e.message);
    }
  };

  const setupControlChannel = () => {
    if (!session?.id) return;
    const ch = supabase
      .channel(`session-control-${session.id}`)
      .on('broadcast', { event: 'user-identity' }, ({ payload }) => {
        // Map Agora UID → Supabase user info. Guard against an
        // agoraUid-less payload (shouldn't happen anymore now that the
        // host's own broadcast always includes it, but a stray/legacy
        // message here would otherwise pollute the map with a
        // uidToUser[undefined] entry).
        if (payload.agoraUid == null) return;
        setUidToUser(prev => ({
          ...prev,
          [payload.agoraUid]: { userId: payload.userId, name: payload.name, isHost: !!payload.isHost },
        }));
        console.log('👤 Identity received:', payload.name, payload.agoraUid);
      })
      // Tightened call-to-board loop: the attendee's screen replies with
      // accept/decline instead of the host just firing an alert() and
      // assuming it worked. Critically, the board itself is NOT opened for
      // anyone (including the host) until the call is accepted — decline
      // just tells the host and nothing ever shows up.
      .on('broadcast', { event: 'board-invite-response' }, ({ payload }) => {
        const name = uidToUserRef.current[payload.uid]?.name || 'The attendee';
        if (payload.accepted) {
          if (!boardModeRef.current) {
            openBoard(pendingBoardTypeRef.current || 'whiteboard');
          }
          setBoardEditors(prev => ({ ...prev, [payload.uid]: { name } }));
          setPendingCallUid(null);
          setPendingBoardType(null);
          Alert.alert('Board', `${name} joined the board.`);
        } else {
          setBoardEditors(prev => {
            const next = { ...prev };
            delete next[payload.uid];
            return next;
          });
          setPendingCallUid(null);
          setPendingBoardType(null);
          Alert.alert('Board', `Attendee "${name}" has declined your call.`);
        }
      })
      // Attendee voluntarily finished — same cleanup as a decline, no alert needed
      .on('broadcast', { event: 'board-finished' }, ({ payload }) => {
        setBoardEditors(prev => {
          const next = { ...prev };
          delete next[payload.uid];
          return next;
        });
        setHostInterrupting(false);
      })
      .on('broadcast', { event: 'media-state' }, ({ payload }) => {
        setAttendeeMediaState(prev => ({
          ...prev,
          [payload.uid]: { muted: !!payload.muted, cameraOff: !!payload.cameraOff },
        }));
      })
      // Raise hand / point of correction / want to speak — see
      // attendeeSignals state comment above for why this listener needed
      // to exist at all. A falsy payload.signal means the attendee (or
      // the host, via clearAttendeeSignal below) cleared it.
      .on('broadcast', { event: 'attendee-signal' }, ({ payload }) => {
        if (payload.signal) {
          setAttendeeSignals(prev => ({ ...prev, [payload.uid]: { name: payload.name, signal: payload.signal } }));
          const label = payload.signal === 'hand' ? 'raised their hand'
            : payload.signal === 'correction' ? 'has a point of correction'
            : 'wants to speak';
          const emoji = payload.signal === 'hand' ? '✋' : payload.signal === 'correction' ? '🔴' : '🗣️';
          pushToast(`${emoji} ${payload.name} ${label}`);
        } else {
          setAttendeeSignals(prev => {
            if (!prev[payload.uid]) return prev;
            const next = { ...prev };
            delete next[payload.uid];
            return next;
          });
        }
      })
      // A co-host's client sends requests here instead of performing
      // privileged actions itself — see the coHosts state comment for
      // why. handleCohostActionRequest is defined further down (it needs
      // requestMuteAttendee/startCallToBoard/etc, which are defined
      // later in this component) but by the time this listener actually
      // FIRES, the component has long since finished its render pass, so
      // the closure below always sees the real function.
      .on('broadcast', { event: 'cohost-action-request' }, ({ payload }) => {
        handleCohostActionRequest(payload);
      })
      // Reactions — broadcast on this same shared channel (not a new
      // subscription) since SessionMain and AttendeeSession are already
      // both listening here. Shows up to everyone, sender included.
      .on('broadcast', { event: 'reaction' }, ({ payload }) => {
        pushToast(`${payload.name} reacted ${payload.emoji}`);
      })
      .subscribe();
    controlChannelRef.current = ch;
  };

  // ─── VOLUME INDICATOR — determines who's on the main view ───
  const handleVolumeIndicator = (volumes) => {
    const speaking = volumes.filter(v => v.level > VOLUME_THRESHOLD);

    let newSpeakerUid = null; // null → default (show host/local)

    if (speaking.length === 1) {
      // Exactly one person speaking — show them
      newSpeakerUid = speaking[0].uid;
    }
    // Multiple or none speaking → newSpeakerUid stays null → host on main

    // Debounce: only switch after SPEAKER_SWITCH_DELAY ms of consistent speech
    if (speakerSwitchTimeoutRef.current) {
      clearTimeout(speakerSwitchTimeoutRef.current);
    }
    speakerSwitchTimeoutRef.current = setTimeout(() => {
      setActiveSpeakerUid(newSpeakerUid);
    }, SPEAKER_SWITCH_DELAY);
  };

 const initAgora = async () => {
  try {
    let currentProfile = 'ultra';

    const applyVideoProfile = async (key) => {
      if (currentProfile === key) return;
      currentProfile = key;
      await agoraSessionRef.current?.setVideoQuality(key);
      console.log('📹 Host video quality →', key);
    };

    const agoraSession = createAgoraSession({
      onUserPublished: (uid, mediaType) => {
        console.log('🎥 Host sees remote user:', uid, mediaType);
        setRemoteUsers(prev => {
          const videoTrack = agoraSession.getRemoteVideoRef(uid);
          const exists = prev.find(u => u.uid === uid);
          if (exists) return prev.map(u => (u.uid === uid ? { ...u, uid, videoTrack } : u));
          return [...prev, { uid, videoTrack }];
        });
      },
      onUserUnpublished: (uid, mediaType) => {
        if (mediaType === 'video') {
          setRemoteUsers(prev =>
            prev.map(u => (u.uid === uid ? { ...u, videoTrack: null } : u))
          );
        }
      },
      onUserLeft: (uid) => {
        console.log('User left:', uid);
        setRemoteUsers(prev => prev.filter(u => u.uid !== uid));
        setActiveSpeakerUid(prev => (prev === uid ? null : prev));
        clearAttendeeFromAllState(uid);
      },
      onVolumeIndicator: handleVolumeIndicator,
      onNetworkQuality: (stats) => {
        const key = getProfileKey(
          stats.uplinkNetworkQuality,
          stats.downlinkNetworkQuality
        );
        applyVideoProfile(key);
      },
    });
    agoraSessionRef.current = agoraSession;

    let token = null;
    if (session?.code) {
      try {
        const { data, error } = await supabase.functions.invoke('agora-token', {
          body: { channelName: session.code },
        });
        if (!error && data?.token) {
          token = data.token;
          console.log('✅ Host got token');
        }
      } catch (e) {
        console.log('Token fetch failed, joining without token');
      }
    }

    const assignedUid = await agoraSession.join(
      AGORA_APP_ID,
      session?.code || 'default',
      token,
      null
    );
    myUidRef.current = assignedUid;
    setMyUid(assignedUid);
    console.log('✅ Host joined. My Agora UID:', assignedUid);

    setLocalVideoTrack(agoraSession.getLocalVideoRef());

    // Host always starts live on both tracks (unlike attendees, which
    // wait for an explicit toggle) — so publish immediately based on
    // the initial muted/cameraOff state.
    if (!muted) await agoraSession.publishAudio();
    if (!cameraOff) await agoraSession.publishVideo();

    setJoined(true);
  } catch (err) {
    console.error('Agora init error:', err.message);
    Alert.alert('Connection Failed', 'Could not start the session. Check your internet.');
  }
};

  const leaveAgora = async () => {
    try {
      await agoraSessionRef.current?.leave();
    } catch (e) {
      console.log('Agora leave error (non-fatal):', e.message);
    }
    agoraSessionRef.current = null;
  };

  const toggleMic = async () => {
    try {
      await agoraSessionRef.current?.setAudioEnabled(muted);
      setMuted(!muted);
    } catch (e) { console.log('Mic error:', e.message); }
  };

  const toggleCamera = async () => {
    try {
      await agoraSessionRef.current?.setVideoEnabled(cameraOff);
      setCameraOff(prev => !prev);
    } catch (e) { console.log('Camera error:', e.message); }
  };

  // ─── BOARD CONTROL ───
  // WhiteboardCanvas / GraphBoardCanvas each manage their own realtime
  // channel and persistence internally. SessionMain's job is just to:
  //  1. track which board type is showing (or none)
  //  2. tell attendees, over the shared control channel, when a board
  //     opens/closes and what type it is, so their screens can mirror it
  //     instead of the host having to separately "call" everyone in.
  const openBoard = (type) => {
    setShowBoardPicker(false);
    setBoardMode(type);
    controlChannelRef.current?.send({
      type: 'broadcast', event: 'board-start', payload: { boardType: type },
    });
  };

  const closeBoard = () => {
    setBoardMode(null);
    setBoardEditors({});
    setPendingCallUid(null);
    setPendingBoardType(null);
    setBoardPickerTargetUid(null);
    setHostInterrupting(false);
    controlChannelRef.current?.send({
      type: 'broadcast', event: 'board-end', payload: {},
    });
  };

  // "Call to Board" — invites a specific attendee to join/draw on a board.
  // Unlike before, this no longer opens the board right away: the board
  // only appears (for the host, the called attendee, and everyone else)
  // once the attendee accepts. If they decline, nothing ever opens and the
  // host just gets notified.
  const callAttendeeToBoard = (targetUid, type) => {
    const resolvedType = type || boardMode || pendingBoardType || 'whiteboard';
    setPendingCallUid(targetUid);
    setPendingBoardType(resolvedType);
    controlChannelRef.current?.send({
      type: 'broadcast',
      event: 'call-to-board',
      payload: { uid: targetUid, boardType: resolvedType },
    });
  };

  // Entry point from the attendee dropdown. If a board type is already
  // established (board open, or a call already pending), just call the
  // attendee straight into it. Otherwise there's no type to call them to
  // yet, so ask the host to choose one first via the board picker.
  const startCallToBoard = (targetUid) => {
    const existingType = boardMode || pendingBoardType;
    if (existingType) {
      callAttendeeToBoard(targetUid, existingType);
    } else {
      setBoardPickerTargetUid(targetUid);
      setShowBoardPicker(true);
    }
  };

  // Board picker's three options funnel through here. If the picker was
  // opened to choose a type for a specific call, resolve that call with the
  // chosen type instead of just opening a self-serve board.
  const handleBoardPickerSelect = (type) => {
    setShowBoardPicker(false);
    if (boardPickerTargetUid) {
      const targetUid = boardPickerTargetUid;
      setBoardPickerTargetUid(null);
      callAttendeeToBoard(targetUid, type);
    } else {
      openBoard(type);
    }
  };

  // "Uncall" — revoke a specific attendee's edit access without ending the
  // board for everyone else. The attendee side listens for this exact
  // event/payload shape (see AttendeeSession.js's 'board-revoke' handler).
  const revokeFromBoard = (targetUid) => {
    setBoardEditors(prev => {
      const next = { ...prev };
      delete next[targetUid];
      return next;
    });
    controlChannelRef.current?.send({
      type: 'broadcast',
      event: 'board-revoke',
      payload: { uid: targetUid },
    });
  };

  // "Interrupt" — the host temporarily takes over editing from whoever is
  // currently called to the board. All currently-called attendees drop to
  // view-only while this is true; tapping the same button again
  // ("Uninterrupt") hands editing back to them and returns the host to
  // view-only.
  const toggleInterrupt = () => {
    const next = !hostInterrupting;
    setHostInterrupting(next);
    controlChannelRef.current?.send({
      type: 'broadcast',
      event: 'host-interrupt',
      payload: { interrupting: next },
    });
  };

  // "Mute" / "Turn off camera" — forceful, Zoom-style, but one-directional
  // on purpose. No client can reach into another client's local media
  // capture (that's just how WebRTC works), so this sends a request the
  // attendee's own client carries out on itself. Muting/hiding someone
  // only ever reduces their exposure, which is safe to force
  // unilaterally; turning someone's mic/camera ON without their action is
  // exactly what every major video app treats as a request the person has
  // to accept, never a forced flip — silently enabling someone's
  // camera/mic is a real privacy problem. No "unmute"/"turn camera on"
  // version exists here for that reason.
  const requestMuteAttendee = (targetUid) => {
    controlChannelRef.current?.send({
      type: 'broadcast',
      event: 'host-mute-request',
      payload: { uid: targetUid },
    });
  };

  const requestCameraOffAttendee = (targetUid) => {
    controlChannelRef.current?.send({
      type: 'broadcast',
      event: 'host-camera-off-request',
      payload: { uid: targetUid },
    });
  };

  // Factored out of the dropdown's inline action so BOTH the host's own
  // "Remove from Session" button and a relayed co-host request can call
  // the exact same logic — one code path for the actual privileged write,
  // no duplicated DB/broadcast logic to drift out of sync.
  const removeAttendeeFromSession = async (targetUid) => {
    const userInfo = uidToUserRef.current[targetUid];
    if (userInfo) {
      await supabase.from('session_attendees')
        .update({ left_at: new Date().toISOString() })
        .eq('session_id', session.id)
        .eq('user_id', userInfo.userId);

      controlChannelRef.current?.send({
        type: 'broadcast',
        event: 'user-kicked',
        payload: { userId: userInfo.userId },
      });
    }
    if (coHostsRef.current[targetUid]) {
      controlChannelRef.current?.send({ type: 'broadcast', event: 'co-host-revoked', payload: { uid: targetUid } });
    }
    setRemoteUsers(prev => prev.filter(u => u.uid !== targetUid));
    clearAttendeeFromAllState(targetUid);
  };

  // Shared cleanup whenever an attendee is no longer meaningfully present
  // — kicked, banned, or genuinely gone (Agora's 'user-left'). Without
  // this, stale co-host / board-editor / muted badges can hang around
  // pointing at a uid nobody will ever see again.
  const clearAttendeeFromAllState = (targetUid) => {
    setCoHosts(prev => {
      if (!prev[targetUid]) return prev;
      const next = { ...prev };
      delete next[targetUid];
      return next;
    });
    setBoardEditors(prev => {
      if (!prev[targetUid]) return prev;
      const next = { ...prev };
      delete next[targetUid];
      return next;
    });
    setAttendeeMediaState(prev => {
      if (!prev[targetUid]) return prev;
      const next = { ...prev };
      delete next[targetUid];
      return next;
    });
    setAttendeeSignals(prev => {
      if (!prev[targetUid]) return prev;
      const next = { ...prev };
      delete next[targetUid];
      return next;
    });
  };

  // Host "acknowledging"/dismissing a raised hand etc — clears it for
  // everyone (broadcast), not just locally, and tells the attendee's own
  // client to drop its "Signal sent" badge too so both sides agree it's
  // been addressed.
  const clearAttendeeSignal = (targetUid) => {
    setAttendeeSignals(prev => {
      const next = { ...prev };
      delete next[targetUid];
      return next;
    });
    controlChannelRef.current?.send({
      type: 'broadcast',
      event: 'host-clear-signal',
      payload: { uid: targetUid },
    });
  };

  // ─── CO-HOST GRANT / REVOKE — host-only, deliberately not relayable ───
  const grantCoHost = (targetUid) => {
    const info = uidToUserRef.current[targetUid];
    const name = info?.name || 'Attendee';
    setCoHosts(prev => ({ ...prev, [targetUid]: { userId: info?.userId, name } }));
    controlChannelRef.current?.send({
      type: 'broadcast',
      event: 'co-host-granted',
      payload: { uid: targetUid, name },
    });
  };

  const revokeCoHost = (targetUid) => {
    setCoHosts(prev => {
      const next = { ...prev };
      delete next[targetUid];
      return next;
    });
    controlChannelRef.current?.send({
      type: 'broadcast',
      event: 'co-host-revoked',
      payload: { uid: targetUid },
    });
  };

  // ─── CO-HOST ACTION RELAY ───
  // A co-host's client never performs these directly — see the coHosts
  // state comment above for why. This is the single dispatch point: any
  // 'cohost-action-request' broadcast lands here, gets checked against
  // coHostsRef (so only a currently-recognized co-host's requests are
  // honored), and — if valid — is executed using the exact same
  // functions the host's own UI calls.
  const handleCohostActionRequest = (payload) => {
    const { requesterUid, action, targetUid, extra } = payload;
    if (!coHostsRef.current[requesterUid]) {
      console.log('Ignored cohost-action-request from non-co-host uid:', requesterUid);
      return;
    }
    switch (action) {
      case 'mute':
        requestMuteAttendee(targetUid);
        break;
      case 'camera-off':
        requestCameraOffAttendee(targetUid);
        break;
      case 'call-to-board': {
        // NOT startCallToBoard(targetUid) — that function reads `boardMode`/
        // `pendingBoardType` as live React state, which would be frozen at
        // whatever they were at mount time (this listener is registered
        // once, inside setupControlChannel's mount-only effect). Reading
        // the refs instead — exactly what boardModeRef/pendingBoardTypeRef
        // already exist for — keeps this correct no matter how long the
        // session has been running.
        const existingType = boardModeRef.current || pendingBoardTypeRef.current;
        if (existingType) {
          callAttendeeToBoard(targetUid, existingType);
        } else {
          setBoardPickerTargetUid(targetUid);
          setShowBoardPicker(true);
        }
        break;
      }
      case 'uncall-from-board':
        revokeFromBoard(targetUid);
        break;
      case 'remove':
        removeAttendeeFromSession(targetUid);
        break;
      default:
        console.log('Unknown cohost action requested:', action);
    }
  };

  const endSession = () => {
    // Status update goes FIRST and is checked. This exact function has
    // regressed back to the "leaveAgora first, unguarded, no check" shape
    // twice now in different uploads — reordering so the actual state
    // change (ending the session for everyone) happens before the
    // best-effort Agora cleanup, and checking its result, is what stops a
    // flaky Agora disconnect from silently eating the whole handler again.
    const proceed = async () => {
      const { error } = await supabase.from('sessions').update({ status: 'ended' }).eq('id', session?.id);
      if (error) {
        if (Platform.OS === 'web') window.alert(`Could not end session: ${error.message}`);
        else Alert.alert('Could not end session', error.message);
        return;
      }
      await leaveAgora(); // internally try/caught now — can't block the line above
      navigation.navigate('EndSession', { session });
    };

    // react-native-web doesn't reliably render Alert.alert's button array —
    // the confirm UI never appears, so the destructive action (which only
    // ran from inside that button's onPress) silently never fired. Use the
    // browser's own confirm() on web instead; native keeps Alert.alert.
    if (Platform.OS === 'web') {
      if (window.confirm('End session for everyone?')) proceed();
    } else {
      Alert.alert('End session for everyone?', undefined, [
        { text: 'Cancel', style: 'cancel' },
        { text: 'End session', style: 'destructive', onPress: proceed },
      ]);
    }
  };

  const formatTime = (secs) => {
    const m = Math.floor(secs / 60).toString().padStart(2, '0');
    const s = (secs % 60).toString().padStart(2, '0');
    return `${m}:${s}`;
  };

  // ─── ACTIVE SPEAKER LOGIC ───
  // Is the local user (host) the sole active speaker?
  const iAmSpeaking = activeSpeakerUid !== null &&
    (activeSpeakerUid === myUid || activeSpeakerUid === 0);

  // Local is on main when: nobody / multiple speaking (default) OR host is sole speaker
  const localOnMain = activeSpeakerUid === null || iAmSpeaking;

  // Which remote user to show when a remote is the sole speaker
  const mainRemoteUser = !localOnMain
    ? remoteUsers.find(u => u.uid === activeSpeakerUid) || remoteUsers[0]
    : remoteUsers[0];

  // Show PiP only when local is NOT on main screen
  const showPiP = !localOnMain && joined;

  // ─── DUPLICATED UIDS (attendee-strip double-attach guard) ───
  // The attendee strip renders every remote user's VideoTile UNCONDITIONALLY,
  // regardless of whether those same tracks are ALSO being played elsewhere
  // on screen right now. Agora's track.play() doesn't clone a stream per
  // call — handing the same track to two mounted <VideoTile>s at once
  // causes one of them to go blank/white, since the second play() call
  // detaches/steals from the first.
  //
  // Three places a remote track can be "elsewhere":
  //   - Board mode: the single mainRemoteUser sits in the floating pipStack.
  //   - Speaker view: the single mainRemoteUser is the big central tile
  //     (only when the host isn't the one speaking).
  //   - Gallery view: EVERY remote user is shown at once in the grid — a
  //     single featuredUid couldn't express this, since it isn't one
  //     duplicate, it's all of them, simultaneously, for as long as
  //     Gallery is open. This was the gap in the previous version.
  // The strip nulls out the track for any uid in this set and falls back
  // to that cell's initials avatar instead.
  const duplicatedUids = boardMode
    ? new Set(mainRemoteUser ? [mainRemoteUser.uid] : [])
    : view === 'gallery'
      ? new Set(remoteUsers.map(u => u.uid))
      : new Set(!localOnMain && mainRemoteUser ? [mainRemoteUser.uid] : []);

  // ─── HOST BOARD PERMISSION ───
  // The host can draw normally when nobody has been called up (a board
  // opened via the toolbar with no active call). Once someone has been
  // called and accepted, the host drops to view-only just like every
  // other non-called attendee — until they tap Interrupt.
  const hostCanDraw = Object.keys(boardEditors).length === 0 || hostInterrupting;
  const callInProgress = Object.keys(boardEditors).length > 0;
  const pendingCallName = pendingCallUid != null ? (uidToUser[pendingCallUid]?.name || 'attendee') : null;

  // Snapshot roster for ChatPanel, built from identities we already know
  // about (ourself + uidToUser, populated from 'user-identity'
  // broadcasts). This is a point-in-time snapshot passed via navigation
  // params, not a live subscription — if someone joins while chat is
  // already open they won't appear until it's reopened. That small
  // staleness window is the trade-off for NOT giving ChatPanel its own
  // subscription to this same control channel, which is what crashed the
  // app last time (Supabase won't let a second, independent subscription
  // add listeners to a topic that's already actively joined elsewhere).
  const buildChatRoster = () => {
    const roster = {};
    if (hostUser) roster[hostUser.id] = { name: hostUser.name, isHost: true };
    Object.values(uidToUser).forEach((u) => {
      if (u.userId) roster[u.userId] = { name: u.name, isHost: false };
    });
    return roster;
  };

  const openChat = () => {
    setUnreadCount(0);
    chatOpenRef.current = true;
    navigation.navigate('ChatPanel', { session, currentUser: hostUser, isHost: true, roster: buildChatRoster() });
  };

  const openPoll = () => {
    setPollNotice(false);
    pollOpenRef.current = true;
    navigation.navigate('PollScreen', { session, currentUser: hostUser, isHost: true });
  };

  const tools = [
    { icon: muted ? 'mic-off-outline' : 'mic-outline', label: 'Mic', action: toggleMic, active: muted },
    { icon: cameraOff ? 'videocam-off-outline' : 'videocam-outline', label: 'Cam', action: toggleCamera, active: cameraOff },
    { icon: 'clipboard-outline', label: 'Agenda', action: () => navigation.navigate('AgendaPanel', { session }) },
    { icon: 'create-outline', label: 'Board', action: () => boardMode ? closeBoard() : setShowBoardPicker(true), active: !!boardMode },
    { icon: 'bar-chart-outline', label: 'Poll', action: openPoll, badge: pollNotice ? 1 : 0 },
    { icon: 'timer-outline', label: 'Timer', action: () => navigation.navigate('TimerScreen') },
    { icon: 'chatbubble-outline', label: 'Chat', action: openChat, badge: unreadCount },
    { icon: 'happy-outline', label: 'React', action: () => setShowReactions(true) },
    { icon: 'star-outline', label: 'Co-host', action: () => setShowCoHostManager(true), badge: Object.keys(coHosts).length },
    { icon: recording ? 'stop-circle' : 'radio-button-on', label: 'Record', action: () => setRecording(!recording), red: true },
    { icon: 'power-outline', label: 'End', action: endSession, end: true },
  ];

  // Button size shrinks to whatever fits ALL tools on one row with no
  // scrolling — driven purely by screen width and tool count, not
  // orientation. `justifyContent: 'space-between'` on the row (see
  // styles.toolbar) then does the orientation-dependent part for free:
  // whatever width is left over after N fixed-size buttons gets divided
  // into the gaps between them, so a wide landscape screen naturally
  // spreads the buttons out and a narrow portrait screen naturally pulls
  // them close — no separate gap calculation needed.
  const toolBtnSize = Math.round(
    Math.min(TOOLBAR_MAX_BTN, Math.max(TOOLBAR_MIN_BTN, ((width - TOOLBAR_H_PADDING) / tools.length) * 0.74))
  );
  // Below this size the label text just gets squished into an unreadable
  // smear — better to drop it and keep the icon legible.
  const toolShowLabel = toolBtnSize >= 44;
  const toolIconSize = Math.max(14, Math.round(toolBtnSize * 0.36));
  // Actual height of the bottom toolbar bar (buttons + their vertical
  // padding) — anything else anchored to the bottom edge (view toggle,
  // interrupt button, self-view PiP) needs to clear this so it doesn't
  // end up sitting under the toolbar the same way the strip/title did.
  const toolbarBarHeight = toolBtnSize + 16;

  return (
    <View style={styles.container}>
      <NotificationToastStack toasts={toasts} onDismiss={dismissToast} />

      {/* Top Bar */}
      {controlsVisible && (
      <View style={styles.topBar} {...revealOnHoverProps}>
        <View>
          <Text style={styles.sessionTitle}>{session?.title || 'Session'}</Text>
          <View style={styles.modeBadge}>
            <ModeIcon mode={session?.mode} size={11} color={colors.white} />
            <Text style={styles.modeBadgeText}>{session?.mode || 'Session'}</Text>
          </View>
        </View>
        <View style={styles.topRight}>
          {recording && (
            <View style={styles.recordingBadge}>
              <View style={styles.recordingDot} />
              <Text style={styles.recordingText}>RECORDING</Text>
            </View>
          )}
          <Text style={styles.timer}>{formatTime(sessionSeconds)}</Text>
          <View style={styles.liveIndicator}>
            <View style={styles.liveDot} />
            <Text style={styles.liveText}>LIVE</Text>
          </View>
        </View>
      </View>
      )}

      {/* Signals bar — raised hands / corrections / speak requests. Sits
          above mainContent so it's visible in board mode and video mode
          alike, not nested inside either branch. Tap a chip to dismiss it
          for everyone (see clearAttendeeSignal). */}
      {controlsVisible && Object.keys(attendeeSignals).length > 0 && (
        <View style={styles.signalsBar}>
          {Object.entries(attendeeSignals).map(([uid, info]) => (
            <TouchableOpacity key={uid} style={styles.signalChip} onPress={() => clearAttendeeSignal(uid)}>
              <Ionicons name={SIGNAL_ICON[info.signal] || 'megaphone-outline'} size={13} color={colors.white} />
              <Text style={styles.signalChipText} numberOfLines={1}>{info.name}</Text>
              <Ionicons name="close-outline" size={13} color="rgba(255,255,255,0.6)" />
            </TouchableOpacity>
          ))}
        </View>
      )}

      <View style={styles.mainContent}>

        {/* ─── ATTENDEE STRIP — video cells. Hidden by default; tapping
            anywhere in the video/board area (see the wrapper below) shows
            it for a few seconds. Touching the strip itself resets that
            timer so it doesn't vanish mid-interaction. ─── */}
        {controlsVisible && (
        <View style={styles.attendeeStrip} onTouchStart={revealControls} {...revealOnHoverProps}>
          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.stripContent}>
            {remoteUsers.map((user, i) => {
              // This user's track is already playing full-size (speaker
              // view), in the board PiP stack, or in the Gallery grid —
              // don't hand it to a second VideoTile here too. See
              // duplicatedUids comment above.
              const isDuplicated = duplicatedUids.has(user.uid);
              // This attendee's real camera state, reported over
              // 'media-state' broadcasts — see attendeeMediaState comment
              // above for why this has to be threaded through explicitly.
              const isCameraOff = !!attendeeMediaState[user.uid]?.cameraOff;
              return (
              <View key={user.uid} style={styles.stripCell}>
                {/* Video cell */}
                <View style={[
                  styles.stripVideoWrap,
                  activeSpeakerUid === user.uid && styles.stripVideoWrapActive,
                ]}>
                  {/* VideoTile fills absolutely — fixes video not rendering */}
                  <VideoTile
                    track={isDuplicated ? null : user.videoTrack}
                    cameraOff={isDuplicated || isCameraOff}
                    initials={`U${i + 1}`}
                    style={StyleSheet.absoluteFillObject}
                    initialsSize={16}
                  />
                  {/* Badge when this attendee currently has board edit access */}
                  {boardEditors[user.uid] && (
                    <View style={styles.stripEditingBadge}>
                      <Ionicons name="create" size={9} color={colors.white} />
                    </View>
                  )}
                  {/* Badge when this attendee is a co-host */}
                  {coHosts[user.uid] && (
                    <View style={styles.stripCoHostBadge}>
                      <Ionicons name="star" size={9} color="#3A2900" />
                    </View>
                  )}
                  {/* Badge when this attendee is currently muted */}
                  {attendeeMediaState[user.uid]?.muted && (
                    <View style={styles.stripMutedBadge}>
                      <Ionicons name="mic-off" size={9} color={colors.white} />
                    </View>
                  )}
                  {/* 3-dot menu */}
                  <TouchableOpacity
                    style={styles.stripDotBtn}
                    onPress={() => setShowDropdown(user.uid)}
                  >
                    <Text style={styles.stripDotText}>⋮</Text>
                  </TouchableOpacity>
                  {/* Speaking border */}
                  {activeSpeakerUid === user.uid && (
                    <View style={[styles.speakingRing, { pointerEvents: 'none' }]} />
                  )}
                </View>
                <Text style={styles.stripName} numberOfLines={1}>
                  User {i + 1}
                </Text>
              </View>
              );
            })}
          </ScrollView>
        </View>
        )}

        {/* ─── CENTER — Board OR Video ─── */}
        {boardMode ? (

          <View style={styles.boardMainArea} onTouchStart={revealControls} {...revealOnHoverProps}>
            {/* Waiting for an invited attendee to respond — board is open
                (host opened it directly or a previous call is active) but
                this particular invite hasn't resolved yet. */}
            {pendingCallName && (
              <View style={styles.pendingCallBar}>
                <Text style={styles.pendingCallText}>Waiting for {pendingCallName} to accept…</Text>
              </View>
            )}

            {boardMode === 'graph' ? (
              <GraphBoardCanvas
                session={session}
                currentUser={hostUser}
                isHost={true}
                canEdit={hostCanDraw}
                visible={true}
                mode="embedded"
                onRequestClose={closeBoard}
              />
            ) : (
              <WhiteboardCanvas
                session={session}
                currentUser={hostUser}
                isHost={true}
                canDraw={hostCanDraw}
                visible={true}
                mode="embedded"
                theme={boardMode === 'blackboard' ? 'blackboard' : 'whiteboard'}
                onRequestClose={closeBoard}
              />
            )}

            {/* PiP stack during board — sits above the board (zIndex 60 > board's 50) */}
            <View style={[styles.pipStack, { pointerEvents: 'none' }]}>
              {mainRemoteUser && (
                <View style={styles.stackPip}>
                  <VideoTile
                    track={mainRemoteUser.videoTrack}
                    cameraOff={!!attendeeMediaState[mainRemoteUser.uid]?.cameraOff}
                    initials={`U${remoteUsers.indexOf(mainRemoteUser) + 1}`}
                    label={`User ${remoteUsers.indexOf(mainRemoteUser) + 1}`}
                    style={{ flex: 1 }}
                    initialsSize={13}
                  />
                </View>
              )}
              <View style={styles.stackPip}>
                <VideoTile
                  track={localVideoTrack}
                  cameraOff={cameraOff}
                  initials="You"
                  label="You"
                  style={{ flex: 1 }}
                  initialsSize={13}
                  mirror={true}
                />
              </View>
            </View>

            {/* Who's currently editing — with a one-tap uncall */}
            {Object.keys(boardEditors).length > 0 && (
              <View style={[styles.boardEditorsBar, { pointerEvents: 'box-none' }]}>
                {Object.entries(boardEditors).map(([uid, info]) => (
                  <View key={uid} style={styles.boardEditorChip}>
                    <Ionicons name="create" size={11} color={colors.white} />
                    <Text style={styles.boardEditorChipText} numberOfLines={1}>{info.name}</Text>
                    <TouchableOpacity onPress={() => revokeFromBoard(uid)} style={styles.boardEditorRemoveBtn}>
                      <Text style={styles.boardEditorRemoveText}>Uncall</Text>
                    </TouchableOpacity>
                  </View>
                ))}
              </View>
            )}

            {/* Interrupt — only relevant once someone has actually been
                called up (otherwise the host is already the one drawing). */}
            {callInProgress && (
              <View style={[styles.interruptBar, { pointerEvents: 'box-none', bottom: toolbarBarHeight + 10 }]}>
                <TouchableOpacity
                  style={[styles.interruptBtn, hostInterrupting && styles.interruptBtnActive]}
                  onPress={toggleInterrupt}
                >
                  <Ionicons name={hostInterrupting ? 'pause-outline' : 'hand-left-outline'} size={13} color={colors.white} />
                  <Text style={styles.interruptBtnText}>
                    {hostInterrupting ? 'Uninterrupt' : 'Interrupt'}
                  </Text>
                </TouchableOpacity>
              </View>
            )}
          </View>

        ) : (

          // ─── VIDEO MODE ───
          <View style={styles.speakerView} onTouchStart={revealControls} {...revealOnHoverProps}>
            {view === 'gallery' ? (
              <ScrollView
                style={{ flex: 1 }}
                contentContainerStyle={[styles.galleryGrid, { paddingTop: 78, paddingBottom: toolbarBarHeight + 16 }]}
              >
                {/* Local */}
                <View style={styles.galleryCell}>
                  <VideoTile
                    track={localVideoTrack}
                    cameraOff={cameraOff}
                    initials="You"
                    label="You (Host)"
                    style={{ flex: 1 }}
                    initialsSize={22}
                    mirror={true}
                  />
                  {iAmSpeaking && <View style={[styles.galleryCellActive, { pointerEvents: 'none' }]} />}
                </View>
                {/* Remote attendees — Gallery view IS the "elsewhere" for
                    every remote user while it's open (see duplicatedUids
                    above): this grid stays the primary, full display, and
                    it's the attendee strip that defers to it, not the
                    other way around, so nothing changes here. */}
                {remoteUsers.map((user, i) => (
                  <View key={user.uid} style={styles.galleryCell}>
                    <VideoTile
                      track={user.videoTrack}
                      cameraOff={!!attendeeMediaState[user.uid]?.cameraOff}
                      initials={`U${i + 1}`}
                      label={`User ${i + 1}`}
                      style={{ flex: 1 }}
                      initialsSize={22}
                    />
                    {coHosts[user.uid] && (
                      <View style={styles.galleryCoHostBadge}>
                        <Ionicons name="star" size={10} color="#3A2900" />
                        <Text style={styles.galleryCoHostBadgeText}>Co-host</Text>
                      </View>
                    )}
                    <TouchableOpacity style={styles.galleryCellDots} onPress={() => setShowDropdown(user.uid)}>
                      <Text style={styles.galleryCellDotsText}>⋮</Text>
                    </TouchableOpacity>
                    {activeSpeakerUid === user.uid && (
                      <View style={[styles.galleryCellActive, { pointerEvents: 'none' }]} />
                    )}
                  </View>
                ))}
              </ScrollView>

            ) : (
              // ─── SPEAKER VIEW — active speaker logic ───
              <>
                {localOnMain ? (
                  // Host on main (default or host is sole speaker)
                  remoteUsers.length > 0 || joined ? (
                    <VideoTile
                      track={localVideoTrack}
                      cameraOff={cameraOff}
                      initials="You"
                      label="You (Host)"
                      style={{ flex: 1 }}
                      initialsSize={40}
                      mirror={true}
                    />
                  ) : (
                    <View style={styles.noVideoPlaceholder}>
                      <Ionicons name="people-outline" size={44} color="rgba(255,255,255,0.35)" />
                      <Text style={styles.noVideoText}>
                        {joined ? 'Waiting for attendees...' : 'Connecting...'}
                      </Text>
                    </View>
                  )
                ) : (
                  // Attendee is the sole speaker — show them on main
                  <VideoTile
                    track={mainRemoteUser?.videoTrack}
                    cameraOff={!!attendeeMediaState[mainRemoteUser?.uid]?.cameraOff}
                    initials={`U${remoteUsers.indexOf(mainRemoteUser) + 1}`}
                    label={`User ${remoteUsers.indexOf(mainRemoteUser) + 1}`}
                    style={{ flex: 1 }}
                    initialsSize={40}
                  />
                )}

                {/* PiP — host's self-view when NOT on main */}
                {showPiP && (
                  <View style={[styles.pipContainer, { bottom: toolbarBarHeight + 10 }]}>
                    <VideoTile
                      track={localVideoTrack}
                      cameraOff={cameraOff}
                      initials="You"
                      label="You"
                      style={{ flex: 1 }}
                      initialsSize={14}
                      mirror={true}
                    />
                  </View>
                )}
              </>
            )}

            {/* View Toggle */}
            {controlsVisible && (
            <View style={[styles.viewToggle, { bottom: toolbarBarHeight + 10 }]}>
              <TouchableOpacity style={[styles.viewBtn, view === 'speaker' && styles.viewBtnActive]} onPress={() => setView('speaker')}>
                <Text style={styles.viewBtnText}>Speaker</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.viewBtn, view === 'gallery' && styles.viewBtnActive]} onPress={() => setView('gallery')}>
                <Text style={styles.viewBtnText}>Gallery</Text>
              </TouchableOpacity>
            </View>
            )}
          </View>
        )}

        {/* Toolbar — always a bottom bar, never scrolls. Button size is
            computed above from screen width so the whole row always fits;
            `space-between` below turns the leftover width into gaps that
            grow in landscape and shrink in portrait automatically. Hidden
            until controlsVisible, same as the rest of the chrome. */}
        {controlsVisible && (
        <View style={styles.toolbarScroll} {...revealOnHoverProps}>
          <View style={styles.toolbar}>
            {tools.map((tool, i) => (
              <TouchableOpacity
                key={i}
                style={[
                  styles.toolBtn,
                  { width: toolBtnSize, height: toolBtnSize },
                  tool.active && styles.toolBtnActive,
                  tool.red && styles.toolBtnRed,
                  tool.end && styles.toolBtnEnd,
                ]}
                onPress={tool.action}
              >
                <Ionicons name={tool.icon} size={toolIconSize} color={colors.white} />
                {toolShowLabel && <Text style={styles.toolLabel}>{tool.label}</Text>}
                {!!tool.badge && (
                  <View style={styles.toolBadge}>
                    <Text style={styles.toolBadgeText}>{tool.badge > 9 ? '9+' : tool.badge}</Text>
                  </View>
                )}
              </TouchableOpacity>
            ))}
          </View>
        </View>
        )}
      </View>

      {/* Board Picker Modal */}
      <Modal visible={showBoardPicker} transparent animationType="fade" onRequestClose={() => { setShowBoardPicker(false); setBoardPickerTargetUid(null); }}>
        <TouchableOpacity style={styles.modalOverlay} activeOpacity={1} onPress={() => { setShowBoardPicker(false); setBoardPickerTargetUid(null); }}>
          <View style={styles.boardPickerPanel}>
            <Text style={styles.boardPickerTitle}>
              {boardPickerTargetUid
                ? `Choose a Board to Call ${uidToUser[boardPickerTargetUid]?.name || 'them'} To`
                : 'Choose a Board'}
            </Text>
            <TouchableOpacity style={styles.boardPickerOption} onPress={() => handleBoardPickerSelect('whiteboard')}>
              <Ionicons name={BOARD_TYPE_ICON.whiteboard} size={26} color={colors.white} />
              <View><Text style={styles.boardPickerName}>Whiteboard</Text><Text style={styles.boardPickerDesc}>Clean white canvas with color pens</Text></View>
            </TouchableOpacity>
            <TouchableOpacity style={styles.boardPickerOption} onPress={() => handleBoardPickerSelect('blackboard')}>
              <Ionicons name={BOARD_TYPE_ICON.blackboard} size={26} color={colors.white} />
              <View><Text style={styles.boardPickerName}>Blackboard</Text><Text style={styles.boardPickerDesc}>Classic chalkboard with chalk colors</Text></View>
            </TouchableOpacity>
            <TouchableOpacity style={styles.boardPickerOption} onPress={() => handleBoardPickerSelect('graph')}>
              <Ionicons name={BOARD_TYPE_ICON.graph} size={26} color={colors.white} />
              <View><Text style={styles.boardPickerName}>Graph Board</Text><Text style={styles.boardPickerDesc}>Plot equations, XY values and charts</Text></View>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </Modal>

      {/* Reactions Modal */}
      <Modal visible={showReactions} transparent animationType="slide" onRequestClose={() => setShowReactions(false)}>
        <TouchableOpacity style={styles.modalOverlay} activeOpacity={1} onPress={() => setShowReactions(false)}>
          <View style={styles.reactionsPanel}>
            <Text style={styles.reactionsPanelTitle}>REACTIONS</Text>
            <View style={styles.reactionsGrid}>
              {REACTIONS.map((emoji, i) => (
                <TouchableOpacity key={i} style={styles.reactionBtn} onPress={() => sendReaction(emoji)}>
                  <Text style={styles.reactionEmoji}>{emoji}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
        </TouchableOpacity>
      </Modal>

      {/* Co-Host Manager Modal — grant/revoke co-host per attendee, plus a
          short explanation of what the role actually grants. This
          replaces the old dead-end navigation.navigate('CoHostManager')
          call, which pointed at a screen that never existed. */}
      <Modal visible={showCoHostManager} transparent animationType="fade" onRequestClose={() => setShowCoHostManager(false)}>
        <TouchableOpacity style={styles.modalOverlay} activeOpacity={1} onPress={() => setShowCoHostManager(false)}>
          <TouchableOpacity activeOpacity={1} style={styles.coHostPanel} onPress={() => {}}>
            <View style={styles.coHostPanelTitleRow}>
              <Ionicons name="star" size={16} color="#FFC107" />
              <Text style={styles.coHostPanelTitle}>Co-Hosts</Text>
            </View>
            <Text style={styles.coHostPanelDesc}>
              Co-hosts can mute or camera-off an attendee, call someone to the board, and remove attendees from the session. They can't ban, end the session, control recording, or manage other co-hosts.
            </Text>
            {remoteUsers.length === 0 ? (
              <Text style={styles.coHostEmptyText}>No attendees in the session yet.</Text>
            ) : (
              <ScrollView style={styles.coHostList}>
                {remoteUsers.map((user, i) => {
                  const info = uidToUser[user.uid];
                  const isCo = !!coHosts[user.uid];
                  const displayName = info?.name || `User ${i + 1}`;
                  return (
                    <View key={user.uid} style={styles.coHostRow}>
                      <View style={styles.coHostRowLeft}>
                        <View style={styles.coHostAvatar}>
                          <Text style={styles.coHostAvatarText}>{displayName.slice(0, 2).toUpperCase()}</Text>
                        </View>
                        <Text style={styles.coHostRowName} numberOfLines={1}>{displayName}</Text>
                      </View>
                      <TouchableOpacity
                        style={[styles.coHostToggle, isCo && styles.coHostToggleActive]}
                        onPress={() => (isCo ? revokeCoHost(user.uid) : grantCoHost(user.uid))}
                      >
                        {isCo && <Ionicons name="checkmark" size={12} color={colors.white} />}
                        <Text style={[styles.coHostToggleText, isCo && styles.coHostToggleTextActive]}>
                          {isCo ? 'Co-host' : 'Make Co-host'}
                        </Text>
                      </TouchableOpacity>
                    </View>
                  );
                })}
              </ScrollView>
            )}
            <TouchableOpacity style={styles.coHostCloseBtn} onPress={() => setShowCoHostManager(false)}>
              <Text style={styles.coHostCloseBtnText}>Done</Text>
            </TouchableOpacity>
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>

      {/* Attendee Dropdown Modal */}
      <Modal visible={showDropdown !== null} transparent animationType="fade" onRequestClose={() => setShowDropdown(null)}>
        <TouchableOpacity style={styles.modalOverlay} activeOpacity={1} onPress={() => setShowDropdown(null)}>
          <View style={styles.dropdownModal}>
            <Text style={styles.dropdownHeader}>
              User {remoteUsers.findIndex(u => u.uid === showDropdown) + 1}
            </Text>
            {[
              { icon: 'mic-off-outline', label: 'Mute', color: colors.white, action: () => requestMuteAttendee(showDropdown) },
              { icon: 'videocam-off-outline', label: 'Turn off camera', color: colors.white, action: () => requestCameraOffAttendee(showDropdown) },
              coHosts[showDropdown]
                ? { icon: 'star', label: 'Revoke Co-host', color: colors.red, action: () => revokeCoHost(showDropdown) }
                : { icon: 'star-outline', label: 'Make Co-host', color: colors.white, action: () => grantCoHost(showDropdown) },
              boardEditors[showDropdown]
                ? { icon: 'arrow-down-circle-outline', label: 'Uncall from Board', color: colors.red, action: () => revokeFromBoard(showDropdown) }
                : pendingCallUid === showDropdown
                  ? { icon: 'hourglass-outline', label: 'Calling…', color: 'rgba(255,255,255,0.4)', action: () => {} }
                  : { icon: 'create-outline', label: 'Call to Board', color: colors.white, action: () => startCallToBoard(showDropdown) },
              { icon: 'chatbubble-outline', label: 'Direct Message', color: colors.white, action: () => {
                chatOpenRef.current = true;
                navigation.navigate('ChatPanel', {
                  session,
                  currentUser: hostUser,
                  isHost: true,
                  roster: buildChatRoster(),
                  prefilledRecipient: uidToUser[showDropdown]
                    ? { userId: uidToUser[showDropdown].userId, name: uidToUser[showDropdown].name }
                    : null,
                });
              } },
             { icon: 'person-remove-outline', label: 'Remove from Session', color: colors.red, action: () => {
  const userInfo = uidToUser[showDropdown];
  const targetUid = showDropdown;
  const msg = `Remove ${userInfo?.name || 'this user'} from the session?`;
  if (Platform.OS === 'web') {
    if (window.confirm(msg)) removeAttendeeFromSession(targetUid);
    return;
  }
  Alert.alert(
    msg,
    undefined,
    [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Remove', style: 'destructive', onPress: () => removeAttendeeFromSession(targetUid) },
    ]
  );
}},
              { icon: 'ban-outline', label: 'Ban', color: colors.red, action: () => {
  const userInfo = uidToUser[showDropdown];
  const targetUid = showDropdown;
  if (!userInfo) {
    if (Platform.OS === 'web') window.alert('Cannot identify this user yet. Try again in a moment.');
    else Alert.alert('Cannot ban user', 'Cannot identify this user yet. Try again in a moment.');
    return;
  }

  const doBan = async () => {
    try {
      const { data: { user: hostUserAuth } } = await supabase.auth.getUser();

      await supabase.from('bans').insert({
        host_id: hostUserAuth.id,
        banned_user_id: userInfo.userId,
        session_id: session.id,
        reason: 'Banned by host during session',
      });

      await supabase.from('session_attendees')
        .update({ left_at: new Date().toISOString() })
        .eq('session_id', session.id)
        .eq('user_id', userInfo.userId);

      controlChannelRef.current?.send({
        type: 'broadcast',
        event: 'user-banned',
        payload: { userId: userInfo.userId },
      });

      setRemoteUsers(prev => prev.filter(u => u.uid !== targetUid));
      clearAttendeeFromAllState(targetUid);
      if (coHosts[targetUid]) {
        controlChannelRef.current?.send({ type: 'broadcast', event: 'co-host-revoked', payload: { uid: targetUid } });
      }
      if (Platform.OS === 'web') window.alert(`${userInfo.name} has been banned.`);
      else Alert.alert('Banned', `${userInfo.name} has been banned.`);
    } catch (e) {
      if (Platform.OS === 'web') window.alert(`Failed to ban: ${e.message}`);
      else Alert.alert('Failed to ban', e.message);
    }
  };

  const msg = `Ban ${userInfo.name} from all your sessions?`;
  if (Platform.OS === 'web') {
    if (window.confirm(msg)) doBan();
    return;
  }
  Alert.alert(
    msg,
    undefined,
    [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Ban', style: 'destructive', onPress: doBan },
    ]
  );
}},
            ].map((item, i) => (
              <TouchableOpacity key={i} style={styles.dropdownItem} onPress={() => { item.action(); setShowDropdown(null); }}>
                <Ionicons name={item.icon} size={16} color={item.color} />
                <Text style={[styles.dropdownText, { color: item.color }]}>{item.label}</Text>
              </TouchableOpacity>
            ))}
            <TouchableOpacity style={styles.dropdownClose} onPress={() => setShowDropdown(null)}>
              <Ionicons name="close-outline" size={14} color="rgba(255,255,255,0.6)" />
              <Text style={styles.dropdownCloseText}>Close</Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </Modal>

      {/* Co-host Approval */}
      {showApproval && (
        <View style={styles.approvalCard}>
          <View style={styles.approvalLeft}>
            <View style={styles.approvalAvatar}><Text style={styles.approvalAvatarText}>QH</Text></View>
            <View>
              <Text style={styles.approvalTitle}>Co-host wants to mute someone</Text>
              <View style={styles.approvalTimer}><View style={styles.approvalTimerFill} /></View>
            </View>
          </View>
          <View style={styles.approvalButtons}>
            <TouchableOpacity style={styles.approveBtn} onPress={() => setShowApproval(false)}>
              <Ionicons name="checkmark" size={14} color={colors.white} />
              <Text style={styles.approveBtnText}>Approve</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.declineBtn} onPress={() => setShowApproval(false)}>
              <Ionicons name="close" size={14} color={colors.white} />
              <Text style={styles.declineBtnText}>Decline</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}
    </View>
  );
}

function useSessionMainStyles(scale) {
  return useMemo(() => StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0A0A1A', position: 'relative' },
  topBar: {
    position: 'absolute', top: 0, left: 0, right: 0, zIndex: 60,
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    padding: 12, paddingTop: 20, backgroundColor: 'rgba(13,13,43,0.68)',
  },
  sessionTitle: { fontSize: 15, fontWeight: '700', color: colors.white },
  modeBadge: { flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: 'rgba(255,255,255,0.12)', alignSelf: 'flex-start', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 10, marginTop: 3 },
  modeBadgeText: { color: colors.white, fontSize: 10, fontWeight: '600', textTransform: 'capitalize' },
  topRight: { alignItems: 'flex-end', gap: 4 },
  recordingBadge: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: 'rgba(255,59,59,0.2)', paddingHorizontal: 7, paddingVertical: 3, borderRadius: 7 },
  recordingDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: colors.red },
  recordingText: { color: colors.red, fontSize: 10, fontWeight: '700' },
  timer: { color: colors.white, fontSize: 17, fontWeight: '700' },
  liveIndicator: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: 'rgba(46,204,113,0.2)', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 7 },
  liveDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: colors.green },
  liveText: { color: colors.green, fontSize: 10, fontWeight: '700' },
  signalsBar: {
    position: 'absolute', top: 74, left: 0, right: 0, zIndex: 55,
    flexDirection: 'row', flexWrap: 'wrap', gap: 6,
    paddingHorizontal: 12, paddingVertical: 8, backgroundColor: 'rgba(18,18,58,0.68)',
  },
  signalChip: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: 'rgba(91,46,255,0.25)', borderWidth: 1, borderColor: 'rgba(91,46,255,0.5)', borderRadius: 14, paddingHorizontal: 10, paddingVertical: 5, maxWidth: 180 },
  signalChipText: { color: colors.white, fontSize: 11, fontWeight: '600', flexShrink: 1 },
  mainContent: { ...StyleSheet.absoluteFillObject, flexDirection: 'row' },

  // ── ATTENDEE STRIP ──
  // top/bottom inset so this rail starts below the floating topBar and
  // stops above the floating bottom toolbar instead of running underneath
  // either of them (same overlap issue as the toolbar, fixed the same way).
  attendeeStrip: {
    position: 'absolute', top: 78, bottom: scale(78), left: 0, zIndex: 40,
    width: scale(104), backgroundColor: 'rgba(13,13,43,0.55)', paddingVertical: 6,
  },
  stripContent: { alignItems: 'center', gap: 10, paddingBottom: 8 },
  stripCell: { width: scale(88), alignItems: 'center', gap: 3 },
  stripVideoWrap: {
    width: scale(88), height: scale(68),
    borderRadius: 10,
    overflow: 'hidden',
    borderWidth: 1.5,
    borderColor: 'rgba(255,255,255,0.12)',
    position: 'relative',
    backgroundColor: '#1E1E3F',
  },
  stripVideoWrapActive: { borderColor: colors.primary, borderWidth: 2 },
  speakingRing: {
    position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
    borderRadius: 10, borderWidth: 2.5, borderColor: colors.green,
  },
  stripDotBtn: {
    position: 'absolute', top: 4, right: 4,
    backgroundColor: 'rgba(0,0,0,0.6)',
    borderRadius: 8, paddingHorizontal: 5, paddingVertical: 1,
    zIndex: 20,
  },
  stripDotText: { color: colors.white, fontSize: 12, fontWeight: '700', letterSpacing: 0.5 },
  stripEditingBadge: {
    position: 'absolute', top: 4, left: 4,
    backgroundColor: 'rgba(91,46,255,0.85)',
    borderRadius: 8, paddingHorizontal: 4, paddingVertical: 1,
    zIndex: 20,
  },
  stripMutedBadge: {
    position: 'absolute', bottom: 4, left: 4,
    backgroundColor: 'rgba(255,59,59,0.85)',
    borderRadius: 8, paddingHorizontal: 4, paddingVertical: 1,
    zIndex: 20,
  },
  stripCoHostBadge: {
    position: 'absolute', bottom: 4, right: 4,
    backgroundColor: 'rgba(255,193,7,0.9)',
    borderRadius: 8, paddingHorizontal: 4, paddingVertical: 1,
    zIndex: 20,
  },
  galleryCoHostBadge: {
    position: 'absolute', top: 8, left: 8,
    flexDirection: 'row', alignItems: 'center', gap: 3,
    backgroundColor: 'rgba(255,193,7,0.9)',
    borderRadius: 10, paddingHorizontal: 8, paddingVertical: 3,
    zIndex: 10,
  },
  galleryCoHostBadgeText: { color: '#3A2900', fontSize: 10, fontWeight: '700' },
  stripName: { color: 'rgba(255,255,255,0.6)', fontSize: 9, textAlign: 'center', maxWidth: 86 },

  // ── VIDEO MODE ──
  speakerView: { flex: 1, backgroundColor: '#111128', position: 'relative' },
  noVideoPlaceholder: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 10 },
  noVideoText: { color: 'rgba(255,255,255,0.4)', fontSize: 14 },
  pipContainer: {
    position: 'absolute', bottom: 60, left: scale(112),
    width: scale(92), height: scale(122),
    borderRadius: 12, overflow: 'hidden',
    borderWidth: 2, borderColor: colors.primary,
  },
  viewToggle: { position: 'absolute', bottom: 14, flexDirection: 'row', backgroundColor: '#1E1E3F', borderRadius: 20, padding: 3, gap: 2, alignSelf: 'center' },
  viewBtn: { paddingHorizontal: 14, paddingVertical: 5, borderRadius: 14 },
  viewBtnActive: { backgroundColor: colors.primary },
  viewBtnText: { color: colors.white, fontSize: 11, fontWeight: '600' },

  // ── GALLERY ──
  galleryGrid: { flexDirection: 'row', flexWrap: 'wrap', padding: 8, gap: 8, alignContent: 'flex-start' },
  galleryCell: { width: scale(190), height: scale(140), borderRadius: 12, overflow: 'hidden', backgroundColor: '#1E1E3F', position: 'relative' },
  galleryCellDots: { position: 'absolute', top: 8, right: 8, backgroundColor: 'rgba(0,0,0,0.55)', borderRadius: 10, paddingHorizontal: 7, paddingVertical: 2, zIndex: 10 },
  galleryCellDotsText: { color: colors.white, fontSize: 15, fontWeight: '700', letterSpacing: 1 },
  galleryCellActive: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, borderRadius: 12, borderWidth: 2.5, borderColor: colors.green },

  // ── BOARD MODE ──
  // The actual board UI (toolbar, canvas, pages, etc.) now lives inside
  // WhiteboardCanvas / GraphBoardCanvas — this area just hosts it and
  // keeps the floating video PiP on top.
  boardMainArea: { flex: 1, position: 'relative', overflow: 'hidden' },
  pipStack: { position: 'absolute', top: 78, left: scale(112), zIndex: 60, gap: 6 },
  stackPip: { width: scale(90), height: scale(116), borderRadius: 12, overflow: 'hidden', borderWidth: 2, borderColor: colors.primary, backgroundColor: '#1E1E3F' },
  boardEditorsBar: { position: 'absolute', top: 78, right: scale(72), zIndex: 60, gap: 6, maxWidth: 200 },
  boardEditorChip: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: 'rgba(0,0,0,0.65)', borderRadius: 16, paddingLeft: 10, paddingRight: 6, paddingVertical: 5 },
  boardEditorChipText: { color: colors.white, fontSize: 11, fontWeight: '600', maxWidth: 90 },
  boardEditorRemoveBtn: { backgroundColor: 'rgba(255,59,59,0.8)', borderRadius: 10, paddingHorizontal: 8, paddingVertical: 3 },
  boardEditorRemoveText: { color: colors.white, fontSize: 10, fontWeight: '700' },
  pendingCallBar: { position: 'absolute', top: 78, alignSelf: 'center', zIndex: 61, backgroundColor: 'rgba(0,0,0,0.7)', paddingHorizontal: 14, paddingVertical: 8, borderRadius: 18 },
  pendingCallText: { color: colors.white, fontSize: 12, fontWeight: '600' },
  interruptBar: { position: 'absolute', bottom: 14, alignSelf: 'center', zIndex: 60 },
  interruptBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: 'rgba(0,0,0,0.72)', paddingHorizontal: 20, paddingVertical: 11, borderRadius: 24, borderWidth: 1.5, borderColor: colors.primary },
  interruptBtnActive: { backgroundColor: colors.primary },
  interruptBtnText: { color: colors.white, fontWeight: '700', fontSize: 13 },

  // ── TOOLBAR ──
  // Always a full-width bar docked to the bottom — no more vertical-rail
  // variant, so orientation only affects the gaps `toolbar` distributes
  // (via space-between), not which edge the bar lives on.
  toolbarScroll: {
    position: 'absolute', left: 0, right: 0, bottom: 0, zIndex: 40,
    paddingVertical: 8, backgroundColor: 'rgba(13,13,43,0.55)',
  },
  toolbar: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: TOOLBAR_H_PADDING / 2,
  },
  // width/height are set inline per-button from the computed toolBtnSize.
  toolBtn: { borderRadius: 10, backgroundColor: '#1E1E3F', alignItems: 'center', justifyContent: 'center', gap: 2 },
  toolBtnActive: { backgroundColor: 'rgba(91,46,255,0.4)', borderWidth: 1, borderColor: colors.primary },
  toolBtnRed: { backgroundColor: 'rgba(255,59,59,0.15)' },
  toolBtnEnd: { backgroundColor: 'rgba(255,59,59,0.5)', marginTop: 4 },
  toolLabel: { fontSize: scale(7), color: 'rgba(255,255,255,0.5)', fontWeight: '600', textAlign: 'center' },
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

  // ── MODALS ──
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'center', alignItems: 'center' },
  boardPickerPanel: { backgroundColor: '#1E1E3F', borderRadius: 20, padding: 20, width: scale(300), maxWidth: '92%', gap: 12, borderWidth: 1, borderColor: 'rgba(91,46,255,0.4)' },
  boardPickerTitle: { fontSize: 17, fontWeight: '800', color: colors.white, marginBottom: 4 },
  boardPickerOption: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: 'rgba(255,255,255,0.05)', borderRadius: 14, padding: 14, borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)' },
  boardPickerName: { fontSize: 15, fontWeight: '700', color: colors.white },
  boardPickerDesc: { fontSize: 12, color: 'rgba(255,255,255,0.5)', marginTop: 2 },
  reactionsPanel: { backgroundColor: '#1E1E3F', borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 24, gap: 14, position: 'absolute', bottom: 0, left: 0, right: 0 },
  reactionsPanelTitle: { color: 'rgba(255,255,255,0.6)', fontSize: 11, fontWeight: '700', letterSpacing: 1 },
  reactionsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, justifyContent: 'center' },
  reactionBtn: { width: scale(60), height: scale(60), borderRadius: 16, backgroundColor: '#2E2E5F', alignItems: 'center', justifyContent: 'center' },
  reactionEmoji: { fontSize: 30 },
  coHostPanel: { backgroundColor: '#1E1E3F', borderRadius: 20, padding: 20, width: scale(320), maxWidth: '92%', maxHeight: '75%', gap: 12, borderWidth: 1, borderColor: 'rgba(255,193,7,0.4)' },
  coHostPanelTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  coHostPanelTitle: { fontSize: 17, fontWeight: '800', color: colors.white },
  coHostPanelDesc: { fontSize: 12, color: 'rgba(255,255,255,0.55)', lineHeight: 17 },
  coHostEmptyText: { fontSize: 13, color: 'rgba(255,255,255,0.4)', textAlign: 'center', paddingVertical: 20 },
  coHostList: { maxHeight: 280 },
  coHostRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 9, borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.06)' },
  coHostRowLeft: { flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1, marginRight: 8 },
  coHostAvatar: { width: scale(30), height: scale(30), borderRadius: scale(15), backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
  coHostAvatarText: { color: colors.white, fontSize: 11, fontWeight: '700' },
  coHostRowName: { color: colors.white, fontSize: 13, fontWeight: '600', flexShrink: 1 },
  coHostToggle: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 12, paddingVertical: 7, borderRadius: 10, borderWidth: 1, borderColor: 'rgba(255,255,255,0.15)', backgroundColor: 'rgba(255,255,255,0.05)' },
  coHostToggleActive: { backgroundColor: 'rgba(255,193,7,0.9)', borderColor: 'rgba(255,193,7,0.9)' },
  coHostToggleText: { color: 'rgba(255,255,255,0.7)', fontSize: 11, fontWeight: '700' },
  coHostToggleTextActive: { color: '#3A2900' },
  coHostCloseBtn: { backgroundColor: 'rgba(255,255,255,0.08)', paddingVertical: 11, borderRadius: 12, alignItems: 'center', marginTop: 4 },
  coHostCloseBtnText: { color: colors.white, fontWeight: '700', fontSize: 13 },
  dropdownModal: { backgroundColor: '#1E1E3F', borderRadius: 14, padding: 16, width: scale(250), maxWidth: '92%', borderWidth: 1, borderColor: 'rgba(91,46,255,0.4)' },
  dropdownHeader: { color: colors.primaryLight, fontWeight: '700', fontSize: 14, paddingHorizontal: 10, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.08)' },
  dropdownItem: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 11, paddingHorizontal: 10, borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.06)' },
  dropdownText: { fontSize: 14 },
  dropdownClose: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4, paddingVertical: 10 },
  dropdownCloseText: { color: 'rgba(255,255,255,0.4)', fontSize: 12 },
  approvalCard: { position: 'absolute', top: 90, right: 72, backgroundColor: '#1E1E3F', borderRadius: 16, padding: 14, flexDirection: 'row', alignItems: 'center', gap: 12, maxWidth: 340, borderWidth: 1, borderColor: 'rgba(91,46,255,0.4)', elevation: 20 },
  approvalLeft: { flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1 },
  approvalAvatar: { width: scale(34), height: scale(34), borderRadius: scale(17), backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
  approvalAvatarText: { color: colors.white, fontWeight: '700', fontSize: 11 },
  approvalTitle: { color: colors.white, fontSize: 13, fontWeight: '600' },
  approvalTimer: { height: 3, backgroundColor: 'rgba(255,255,255,0.1)', borderRadius: 2, width: 100, marginTop: 5 },
  approvalTimerFill: { width: '70%', height: 3, backgroundColor: colors.primary, borderRadius: 2 },
  approvalButtons: { flexDirection: 'column', gap: 6 },
  approveBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5, backgroundColor: colors.green, paddingVertical: 7, paddingHorizontal: 12, borderRadius: 8 },
  approveBtnText: { color: colors.white, fontWeight: '700', fontSize: 12 },
  declineBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5, backgroundColor: colors.red, paddingVertical: 7, paddingHorizontal: 12, borderRadius: 8 },
  declineBtnText: { color: colors.white, fontWeight: '700', fontSize: 12 },
  }), [scale]);
}
