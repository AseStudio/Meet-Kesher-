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

  // Screen share state. `cameraWasPublished`/`cameraWasEnabled` capture
  // exactly how the camera track looked the instant sharing started, so
  // stopping restores it faithfully — if the camera was off before
  // sharing, it comes back off, not on.
  let screenVideoTrack = null;
  let screenAudioTrack = null; // only set if the person shared a tab "with audio"
  let sharingScreen = false;
  let cameraWasPublished = false;
  let cameraWasEnabled = false;

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

    async startScreenShare() {
      if (sharingScreen) return true; // already sharing — no-op success
      let tracks;
      try {
        // 'auto' lets the browser's own share picker decide whether tab
        // audio is offered (only tab-sharing supports it; whole-screen/
        // window sharing never does) — this can resolve to either a lone
        // video track or [video, audio], hence the array-or-not handling
        // below.
        tracks = await AgoraRTC.createScreenVideoTrack({ encoderConfig: '1080p_1' }, 'auto');
      } catch (err) {
        // The most common case by far is the person just closing the OS
        // share picker instead of choosing something — NotAllowedError.
        // That's a cancellation, not a real error, so it's swallowed here
        // and reported as "didn't start" rather than surfaced as a crash.
        console.log('Screen share not started (picker cancelled or denied):', err.message);
        return false;
      }
      [screenVideoTrack, screenAudioTrack] = Array.isArray(tracks) ? tracks : [tracks, null];

      // Fires when the person uses the browser/OS's OWN "Stop sharing"
      // control (the little bar Chrome shows), not our button — this is
      // the only way we find out sharing ended in that case.
      screenVideoTrack.on('track-ended', async () => {
        if (!sharingScreen) return; // already handled via our own stopScreenShare()
        await this.stopScreenShare();
        handlers.onScreenShareEnded?.();
      });

      cameraWasPublished = videoPublished;
      cameraWasEnabled = !!localVideoTrack?.enabled;

      if (cameraWasPublished && localVideoTrack) {
        try { await client.unpublish(localVideoTrack); } catch (e) {}
      }
      const toPublish = screenAudioTrack ? [screenVideoTrack, screenAudioTrack] : [screenVideoTrack];
      await client.publish(toPublish);
      sharingScreen = true;
      return true;
    },

    async stopScreenShare() {
      if (!sharingScreen) return;
      try { await client?.unpublish(screenAudioTrack ? [screenVideoTrack, screenAudioTrack] : [screenVideoTrack]); } catch (e) {}
      screenVideoTrack?.close();
      screenAudioTrack?.close();
      screenVideoTrack = null;
      screenAudioTrack = null;
      sharingScreen = false;

      // Restore the camera to exactly how it looked before sharing
      // started, rather than always turning it back on.
      if (cameraWasPublished && localVideoTrack) {
        await localVideoTrack.setEnabled(cameraWasEnabled);
        try {
          await client.publish([localVideoTrack]);
          videoPublished = true;
        } catch (e) {}
      }
    },

    async leave() {
      try {
        if (sharingScreen) {
          screenVideoTrack?.close();
          screenAudioTrack?.close();
          screenVideoTrack = null;
          screenAudioTrack = null;
          sharingScreen = false;
        }
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
    // and calls track.play(domNode) with them. While sharing, this
    // returns the screen track instead of the camera track — callers
    // just re-read it after start/stopScreenShare() resolves rather than
    // tracking two separate refs (see contract doc).
    getLocalVideoRef() {
      return sharingScreen ? screenVideoTrack : localVideoTrack;
    },
    getRemoteVideoRef(uid) {
      return remoteUsers.get(uid)?.videoTrack || null;
    },
  };
}
