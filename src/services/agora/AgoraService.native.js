// Requires: npx expo install react-native-agora
// Then a native build — this does NOT work in plain Expo Go.
// npx expo run:ios / npx expo run:android (or an EAS dev build).
//
// Verify event-handler names below against your installed version —
// react-native-agora's RtcEngineEventHandler surface has shifted
// slightly across 4.x minor releases (checked against 4.2–4.3 docs
// at the time this was written).
// react-native-agora is required lazily, inside join() below, instead of
// imported at the top of this file. Its compiled entry point
// (specs/NativeAgoraRtcNg.js) calls TurboModuleRegistry.getEnforcing()
// at MODULE SCOPE — which throws immediately, the instant the module is
// required, if the native AgoraRtcNg module isn't registered (a real gap
// in this library: the New Architecture path has no graceful fallback,
// unlike its NativeModules.X fallback for the old architecture, which is
// wrapped in a Proxy that only throws when actually used).
//
// Since App.js imports every screen eagerly for React Navigation —
// including SessionMain/AttendeeSession, which import this file — a
// static top-level import here meant that failure could crash the
// ENTIRE APP the instant the JS bundle loaded, before Splash even
// rendered, with nothing recoverable and nothing useful logged anywhere
// visible. Deferring the require() to inside join() means that failure
// (if it happens) now only surfaces when someone actually tries to
// start/join a session — recoverable, attributable to this screen, and
// (combined with the root-level ErrorBoundary in App.js) shown as a
// readable error instead of the app silently closing.
import { PermissionsAndroid, Platform } from 'react-native';

// CAMERA/RECORD_AUDIO are "dangerous" permissions on Android — declaring
// them in app.json's android.permissions gets them into the manifest,
// but the OS still won't grant them until the app asks at runtime.
// Agora's engine doesn't do this itself; joining without it means the
// engine initializes "successfully" but captures silence/black frames,
// which is a much more confusing failure than a clear permission denial.
async function ensureMediaPermissions() {
  if (Platform.OS !== 'android') return true;
  const granted = await PermissionsAndroid.requestMultiple([
    PermissionsAndroid.PERMISSIONS.CAMERA,
    PermissionsAndroid.PERMISSIONS.RECORD_AUDIO,
  ]);
  return (
    granted[PermissionsAndroid.PERMISSIONS.CAMERA] === PermissionsAndroid.RESULTS.GRANTED &&
    granted[PermissionsAndroid.PERMISSIONS.RECORD_AUDIO] === PermissionsAndroid.RESULTS.GRANTED
  );
}

export const VIDEO_PROFILES = {
  ultra:  { width: 1920, height: 1080, frameRate: 30, bitrate: 3000 },
  high:   { width: 1280, height: 720,  frameRate: 24, bitrate: 1500 },
  medium: { width: 640,  height: 360,  frameRate: 15, bitrate: 600  },
  low:    { width: 320,  height: 180,  frameRate: 15, bitrate: 200  },
};

export function createAgoraSession(handlers = {}) {
  let engine = null;
  let myUid = 0;
  let audioPublished = false;
  let videoPublished = false;
  const remoteUids = new Set();

  return {
    async join(appId, channel, token, uid) {
      const hasPermissions = await ensureMediaPermissions();
      if (!hasPermissions) {
        throw new Error('Camera and microphone permissions are required to join a session.');
      }

      // See the comment above the (now-removed) top-level import — this
      // is where react-native-agora actually gets loaded, deferred until
      // someone is actually joining a session rather than at app launch.
      const { createAgoraRtcEngine, ChannelProfileType, ClientRoleType } = require('react-native-agora');

      engine = createAgoraRtcEngine();
      engine.initialize({
        appId,
        channelProfile: ChannelProfileType.ChannelProfileCommunication,
      });

      // Local tracks are created but NOT enabled/published yet — mirrors
      // the web implementation's "never publish something you're about
      // to immediately disable" fix. enableLocalAudio/Video(false) here,
      // flipped on by publishAudio()/publishVideo() below.
      engine.enableAudio();
      engine.enableVideo();
      engine.enableLocalAudio(false);
      engine.enableLocalVideo(false);

      engine.registerEventHandler({
        onJoinChannelSuccess: (connection) => {
          myUid = connection?.localUid ?? uid ?? 0;
        },
        onUserJoined: (connection, remoteUid) => {
          remoteUids.add(remoteUid);
          // Native has no separate "audio published" vs "video published"
          // event the way the web SDK does — a joined remote user's
          // video renders as soon as <RtcSurfaceView canvas={{uid}} />
          // mounts for them. Report both so caller logic (which expects
          // per-mediaType callbacks from the web shape) still fires.
          handlers.onUserPublished?.(remoteUid, 'video', remoteUid);
          handlers.onUserPublished?.(remoteUid, 'audio', remoteUid);
        },
        onUserOffline: (connection, remoteUid) => {
          remoteUids.delete(remoteUid);
          handlers.onUserLeft?.(remoteUid);
        },
        onRemoteVideoStateChanged: (connection, remoteUid, state) => {
          // state 0 = stopped — closest native analogue to the web SDK's
          // 'user-unpublished' for video.
          if (state === 0) handlers.onUserUnpublished?.(remoteUid, 'video');
        },
        onAudioVolumeIndication: (connection, speakers) => {
          // Web SDK gives {uid, level}; native gives {uid, volume} —
          // normalize to {uid, level} so handleVolumeIndicator (shared
          // by both platforms, unchanged) doesn't need to know which
          // SDK is under it.
          const normalized = (speakers || []).map(s => ({ uid: s.uid, level: s.volume }));
          handlers.onVolumeIndicator?.(normalized);
        },
        onNetworkQuality: (connection, remoteUid, txQuality, rxQuality) => {
          handlers.onNetworkQuality?.({
            uplinkNetworkQuality: txQuality,
            downlinkNetworkQuality: rxQuality,
          });
        },
      });

      engine.joinChannel(token || '', channel, uid ?? 0, {
        clientRoleType: ClientRoleType.ClientRoleBroadcaster,
      });

      return myUid;
    },

    async publishAudio() {
      if (!engine || audioPublished) return;
      engine.enableLocalAudio(true);
      engine.muteLocalAudioStream(false);
      audioPublished = true;
    },

    async publishVideo() {
      if (!engine || videoPublished) return;
      engine.enableLocalVideo(true);
      engine.muteLocalVideoStream(false);
      videoPublished = true;
      this.setVideoQuality('ultra');
    },

    async setAudioEnabled(enabled) {
      if (!engine) return;
      if (enabled && !audioPublished) return this.publishAudio();
      engine.muteLocalAudioStream(!enabled);
    },

    async setVideoEnabled(enabled) {
      if (!engine) return;
      if (enabled && !videoPublished) return this.publishVideo();
      engine.muteLocalVideoStream(!enabled);
    },

    async setVideoQuality(profileKey) {
      if (!engine || !VIDEO_PROFILES[profileKey]) return;
      try {
        engine.setVideoEncoderConfiguration(VIDEO_PROFILES[profileKey]);
      } catch (e) {
        console.log('Could not set video profile:', e.message);
      }
    },

    // Not implemented on native. Real device screen capture needs a
    // foreground service + MediaProjection on Android and a broadcast
    // extension target on iOS — actual native-module/Xcode-project work,
    // not something this JS layer can add on its own. Always resolving
    // false (never throwing) lets SessionMain treat "not available here"
    // the same way it treats "person cancelled the share picker" on web —
    // though in practice SessionMain hides the Share button entirely on
    // native rather than calling this at all.
    async startScreenShare() {
      console.log('Screen share is not yet implemented on native — web only for now.');
      return false;
    },
    async stopScreenShare() {},

    async leave() {
      try {
        engine?.leaveChannel();
        engine?.unregisterEventHandler?.();
        engine?.release();
      } catch (e) {}
      engine = null;
      remoteUids.clear();
      audioPublished = false;
      videoPublished = false;
    },

    // Opaque refs — VideoTile.native.js knows these are plain Agora
    // uids and renders <RtcSurfaceView canvas={{ uid }} />, not a
    // track.play(el) call.
    getLocalVideoRef() {
      return 0; // Agora convention: uid 0 in canvas always means "local"
    },
    getRemoteVideoRef(uid) {
      return remoteUids.has(uid) ? uid : null;
    },
  };
}