import AgoraRTC from 'agora-rtc-sdk-ng';

AgoraRTC.setLogLevel(4); // Silence logs in production

export const VIDEO_PROFILES = {
  ultra:  { width: 1920, height: 1080, frameRate: 30, bitrate: 3000 }, // 1080p
  high:   { width: 1280, height: 720,  frameRate: 24, bitrate: 1500 }, // 720p
  medium: { width: 640,  height: 360,  frameRate: 15, bitrate: 600  }, // 360p
  low:    { width: 320,  height: 180,  frameRate: 15, bitrate: 200  }, // 180p
};

export function createAgoraSession(handlers = {}) {
  let client = null;
  let localAudioTrack = null;
  let localVideoTrack = null;
  let audioPublished = false;
  let videoPublished = false;
  // uid -> Agora's remote user object (has .videoTrack/.audioTrack with .play(el))
  const remoteUsers = new Map();

  const createClient = () => AgoraRTC.createClient({ mode: 'rtc', codec: 'vp8' });

  // Split into two independent calls (instead of the old single
  // createMicrophoneAndCameraTracks) so a denied/slow mic permission
  // doesn't also null out an already-granted camera, or vice versa.
  //
  // WHY THESE ARE CALLED LAZILY FROM ensureAudioTrack/ensureVideoTrack
  // BELOW, NOT JUST ONCE FROM join():
  // getUserMedia only prompts once per permission per origin. If the
  // attendee ignores or dismisses that first prompt (or it's just slow),
  // this used to fail once at join() and localAudioTrack/localVideoTrack
  // stayed null forever — even after the attendee later granted the
  // permission from the browser's own UI. publishAudio()/publishVideo()
  // and setAudioEnabled/setVideoEnabled(true) now call ensureAudioTrack/
  // ensureVideoTrack instead of reading the closure variable directly, so
  // every retry (e.g. the attendee tapping the mic button again) makes a
  // fresh getUserMedia call — which resolves immediately with no prompt
  // if permission has since been granted, instead of being permanently
  // stuck on the first failure.
  const createAudioTrack = async () => {
    try {
      return await AgoraRTC.createMicrophoneAudioTrack({ echoCancellation: true, noiseSuppression: true });
    } catch (err) {
      console.error('Failed to create local audio track (mic permission?):', err.message);
      return null;
    }
  };
  const createVideoTrack = async () => {
    try {
      return await AgoraRTC.createCameraVideoTrack({ encoderConfig: '360p_7' });
    } catch (err) {
      console.error('Failed to create local video track (camera permission?):', err.message);
      return null;
    }
  };
  const ensureAudioTrack = async () => {
    if (!localAudioTrack) localAudioTrack = await createAudioTrack();
    return localAudioTrack;
  };
  const ensureVideoTrack = async () => {
    if (!localVideoTrack) localVideoTrack = await createVideoTrack();
    return localVideoTrack;
  };

  return {
    async join(appId, channel, token, uid) {
      client = createClient();

      client.on('user-published', async (user, mediaType) => {
        try {
          await client.subscribe(user, mediaType);
          remoteUsers.set(user.uid, user);
          if (mediaType === 'audio') user.audioTrack?.play();
          handlers.onUserPublished?.(user.uid, mediaType, user);
        } catch (err) {
          console.error('Subscribe error:', err);
        }
      });

      client.on('user-unpublished', (user, mediaType) => {
        handlers.onUserUnpublished?.(user.uid, mediaType);
      });

      client.on('user-left', (user) => {
        remoteUsers.delete(user.uid);
        handlers.onUserLeft?.(user.uid);
      });

      client.on('volume-indicator', (volumes) => {
        handlers.onVolumeIndicator?.(volumes);
      });

      client.on('network-quality', (stats) => {
        handlers.onNetworkQuality?.(stats);
      });

      const assignedUid = await client.join(appId, channel, token || null, uid ?? null);
      client.enableAudioVolumeIndicator();

      // Best-effort attempt at join time — if the attendee hasn't
      // answered the permission prompt yet (or denied it), these come
      // back null and publishAudio()/publishVideo() retry them lazily
      // later via ensureAudioTrack/ensureVideoTrack above. Run together
      // (not sequentially) so this isn't slower than the old combined call.
      [localAudioTrack, localVideoTrack] = await Promise.all([createAudioTrack(), createVideoTrack()]);
      // Start disabled — matches the original "never publish a track
      // you're about to immediately disable" fix. Callers publish
      // explicitly via publishAudio()/publishVideo().
      await localAudioTrack?.setEnabled(false);
      await localVideoTrack?.setEnabled(false);

      return assignedUid;
    },

    async publishAudio() {
      if (audioPublished) return;
      const track = await ensureAudioTrack();
      if (!track) return; // still no mic permission — next retry tries again
      await track.setEnabled(true);
      await client.publish([track]);
      audioPublished = true;
    },

    async publishVideo() {
      if (videoPublished) return;
      const track = await ensureVideoTrack();
      if (!track) return; // still no camera permission — next retry tries again
      await track.setEnabled(true);
      await client.publish([track]);
      videoPublished = true;
      try {
        await track.setEncoderConfiguration(VIDEO_PROFILES.ultra);
      } catch (e) {}
    },

    async setAudioEnabled(enabled) {
      // The original bug: this checked `!localAudioTrack` FIRST and bailed
      // before ever reaching the "not yet published, go create+publish"
      // branch below — so a denied/delayed mic permission at join() meant
      // every future "unmute" tap was a silent no-op forever, even after
      // the attendee later granted the permission. Checking the publish
      // branch first means an enable always retries track creation via
      // publishAudio() when we don't have a track yet.
      if (enabled && !audioPublished) return this.publishAudio();
      if (!localAudioTrack) return; // never got a track — nothing to toggle
      await localAudioTrack.setEnabled(enabled);
    },

    async setVideoEnabled(enabled) {
      if (enabled && !videoPublished) return this.publishVideo();
      if (!localVideoTrack) return;
      await localVideoTrack.setEnabled(enabled);
    },

    async setVideoQuality(profileKey) {
      if (!localVideoTrack || !VIDEO_PROFILES[profileKey]) return;
      try {
        await localVideoTrack.setEncoderConfiguration(VIDEO_PROFILES[profileKey]);
      } catch (e) {
        console.log('Could not set video profile:', e.message);
      }
    },

    async leave() {
      try {
        if (client) {
          await client.leave();
          client.removeAllListeners();
          client = null;
        }
        localAudioTrack?.close();
        localVideoTrack?.close();
        localAudioTrack = null;
        localVideoTrack = null;
        remoteUsers.clear();
        audioPublished = false;
        videoPublished = false;
      } catch (e) {}
    },

    // Opaque refs — VideoTile.web.js knows these are Agora web tracks
    // and calls track.play(domNode) with them.
    getLocalVideoRef() {
      return localVideoTrack;
    },
    getRemoteVideoRef(uid) {
      return remoteUsers.get(uid)?.videoTrack || null;
    },
  };
}
