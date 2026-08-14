import AgoraRTC from 'agora-rtc-sdk-ng';

export const AGORA_APP_ID = 'c585bcd3c1c940a29e8f1e904b873ba1';

AgoraRTC.setLogLevel(4); // Silence logs in production

export const createClient = () =>
  AgoraRTC.createClient({ mode: 'rtc', codec: 'vp8' });

export const createLocalTracks = async (cameraOn = true, micOn = true) => {
  try {
    const tracks = await AgoraRTC.createMicrophoneAndCameraTracks(
      { echoCancellation: true, noiseSuppression: true },
      { encoderConfig: '360p_7' }
    );
    if (!micOn) tracks[0].setEnabled(false);
    if (!cameraOn) tracks[1].setEnabled(false);
    return tracks;
  } catch (err) {
    console.error('Failed to create local tracks:', err);
    return [null, null];
  }
};