import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { RtcSurfaceView } from 'react-native-agora';
import { colors } from '../theme/colors';

// Native counterpart to VideoTile.web.js. Same prop shape — `track` is
// deliberately kept as the prop name (not `uid`) so call sites in
// SessionMain.js/AttendeeSession.js don't need to change when they're
// switched over from raw Agora state to AgoraService's
// getLocalVideoRef()/getRemoteVideoRef(), which return a track object on
// web and a plain numeric uid here. `track` on native is that uid
// (0 = local, per Agora's convention) or null/undefined for "no video yet".
export default function VideoTile({
  track: uid,
  style,
  label,
  initials = '?',
  cameraOff = false,
  initialsSize = 18,
  mirror = false,
}) {
  const hasVideo = uid !== null && uid !== undefined && !cameraOff;

  return (
    <View style={[styles.container, style]}>
      {hasVideo ? (
        <RtcSurfaceView
          style={StyleSheet.absoluteFill}
          canvas={{ uid, mirrorMode: mirror ? 1 : 0 }}
        />
      ) : (
        <View style={[StyleSheet.absoluteFill, styles.fallback]}>
          <View style={styles.initialsCircle}>
            <Text style={[styles.initialsText, { fontSize: initialsSize }]}>
              {initials}
            </Text>
          </View>
        </View>
      )}
      {label ? (
        <View style={styles.labelWrap}>
          <Text style={styles.labelText} numberOfLines={1}>{label}</Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    overflow: 'hidden',
    position: 'relative',
    backgroundColor: '#1A1A3A',
  },
  fallback: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#1E1E3F',
  },
  initialsCircle: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  initialsText: {
    color: colors.white,
    fontWeight: '700',
  },
  labelWrap: {
    position: 'absolute',
    bottom: 6,
    left: 6,
    right: 6,
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.55)',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
  },
  labelText: {
    color: colors.white,
    fontSize: 10,
    fontWeight: '600',
  },
});
