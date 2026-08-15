// Requires: npx expo install react-native-agora
// Then a native build — this does NOT work in plain Expo Go.
// npx expo run:ios / npx expo run:android (or an EAS dev build).
//
// Verify event-handler names below against your installed version —
// react-native-agora's RtcEngineEventHandler surface has shifted
// slightly across 4.x minor releases (checked against 4.2–4.3 docs
// at the time this was written).
import {
  createAgoraRtcEngine,
  ChannelProfileType,
  ClientRoleType,
} from 'react-native-agora';

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
