/**
 * AgoraService — shared contract
 * -------------------------------
 * SessionMain.js and AttendeeSession.js import AgoraService from
 * './AgoraService' (no extension). Metro/Expo picks
 * AgoraService.web.js on web and AgoraService.native.js on
 * iOS/Android automatically — neither screen file needs to know
 * which one is active.
 *
 * This file is documentation only (not imported anywhere). Both
 * platform implementations must expose the same shape below.
 *
 * WHY AN OBJECT WITH createSession(), NOT LOOSE FUNCTIONS:
 * The web SDK is track-based and stateful per-client. Wrapping a full
 * session's worth of state (client/engine handle, local tracks,
 * published flags) in one object mirrors what SessionMain/AttendeeSession
 * already do with their refs, and gives native a natural place to hold
 * its engine instance without module-level singletons (which would break
 * if two screens ever mounted a session concurrently, e.g. during a nav
 * transition).
 *
 * -----------------------------------------------------------------
 * createAgoraSession(handlers) -> session
 *
 * handlers: {
 *   onUserPublished(uid, mediaType, remoteRef),  // mediaType: 'audio' | 'video'
 *   onUserUnpublished(uid, mediaType),
 *   onUserLeft(uid),
 *   onVolumeIndicator(volumes),                  // same shape as web SDK gives today
 *   onNetworkQuality(stats),                     // { uplinkNetworkQuality, downlinkNetworkQuality }
 * }
 *
 * session methods (all async unless noted):
 *   join(appId, channel, token, uid) -> assignedUid
 *   publishAudio()                     // enable + publish local mic track
 *   publishVideo()                     // enable + publish local camera track
 *   setAudioEnabled(bool)               // mute/unmute WITHOUT unpublishing
 *   setVideoEnabled(bool)
 *   setVideoQuality(profileKey)         // 'ultra' | 'high' | 'medium' | 'low' — see VIDEO_PROFILES
 *   leave()                             // leave channel + release all local tracks/engine
 *   getLocalVideoRef() -> ref            // opaque; pass straight into <VideoTile videoRef={...} />
 *   getRemoteVideoRef(uid) -> ref        // opaque; pass into <VideoTile videoRef={...} />
 *
 * IMPORTANT SEMANTIC THIS PRESERVES FROM AttendeeSession.js:
 * initAgora() there deliberately does NOT publish a track it's about to
 * immediately disable (see the big comment above the original
 * createLocalTracks call — publishing then instantly disabling raced the
 * host's subscribe and silently dropped video/audio). So:
 *   - join() creates local tracks/engine but does NOT auto-publish
 *   - publishAudio()/publishVideo() are the ONLY way a track goes live,
 *     called explicitly by toggleMic/toggleCamera on first enable
 *   - session.join() callers that want to start live (SessionMain, which
 *     always publishes both immediately) call publishAudio()+publishVideo()
 *     right after join() resolves
 *
 * remoteRef / getLocalVideoRef / getRemoteVideoRef are intentionally
 * OPAQUE (not "a track" or "a DOM node") because web hands VideoTile a
 * track object with .play(el), while native hands it a uid that
 * <RtcSurfaceView canvas={{ uid }} /> renders directly — VideoTile.js
 * (via its .web.js/.native.js split) is the only place that needs to
 * know which one it got.
 */
export {};
