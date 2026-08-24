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

  const createLocalTracks = async () => {
    try {
      const tracks = await AgoraRTC.createMicrophoneAndCameraTracks(
        { echoCancellation: true, noiseSuppression: true },
        { encoderConfig: '360p_7' }
      );
      return tracks; // [audioTrack, videoTrack]
    } catch (err) {
      console.error('Failed to create local tracks:', err);
      return [null, null];
    }
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

      const [audioTrack, videoTrack] = await createLocalTracks();
      localAudioTrack = audioTrack;
      localVideoTrack = videoTrack;
      // Start disabled — matches the original "never publish a track
      // you're about to immediately disable" fix. Callers publish
      // explicitly via publishAudio()/publishVideo().
      await audioTrack?.setEnabled(false);
      await videoTrack?.setEnabled(false);

      return assignedUid;
    },

    async publishAudio() {
      if (!localAudioTrack || audioPublished) return;
      await localAudioTrack.setEnabled(true);
      await client.publish([localAudioTrack]);
      audioPublished = true;
    },

    async publishVideo() {
      if (!localVideoTrack || videoPublished) return;
      await localVideoTrack.setEnabled(true);
      await client.publish([localVideoTrack]);
      videoPublished = true;
      try {
        await localVideoTrack.setEncoderConfiguration(VIDEO_PROFILES.ultra);
      } catch (e) {}
    },

    async setAudioEnabled(enabled) {
      if (!localAudioTrack) return;
      if (enabled && !audioPublished) return this.publishAudio();
      await localAudioTrack.setEnabled(enabled);
    },

    async setVideoEnabled(enabled) {
      if (!localVideoTrack) return;
      if (enabled && !videoPublished) return this.publishVideo();
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
