import React, { useRef, useEffect } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { colors } from '../theme/colors';

export default function VideoTile({
  track,
  style,
  label,
  initials = '?',
  cameraOff = false,
  initialsSize = 18,
  mirror = false,
}) {
  const containerRef = useRef(null);

  useEffect(() => {
    if (!track || cameraOff) return;

    // Guards against the unmount race: if this effect's cleanup runs
    // before the rAF callback below fires, `cancelled` flips true and
    // we skip calling track.play() on a container that's on its way out.
    // This is what stops an old tile's synchronous track.stop() from
    // landing right after a new tile's play() and leaving a dead,
    // blank Agora <video> element sitting in the DOM.
    let cancelled = false;
    let rafId = null;

    const attach = () => {
      if (cancelled) return;
      const el = containerRef.current;
      if (!el) return;

      try {
        // For web: Agora's track.play() needs a non-static positioning
        // context to size its injected <video> correctly. But this must
        // NOT clobber an intentional `position: absolute` (e.g. the
        // attendee strip and gallery tiles pass StyleSheet.absoluteFillObject
        // so the tile stretches to fill a small fixed-size parent). Forcing
        // 'relative' unconditionally used to collapse the container to
        // ~0 size, since `right`/`bottom` insets only stretch an element
        // under `absolute`, not `relative`.
        if (el.style) {
          const current =
            (window.getComputedStyle && window.getComputedStyle(el).position) ||
            el.style.position;
          if (!current || current === 'static') {
            el.style.position = 'relative';
          }
        }

        track.play(el, { mirror: !!mirror, fit: 'cover' });
      } catch (e) {
        console.log('VideoTile play error:', e.message);
      }
    };

    // rAF (rather than an arbitrary setTimeout) waits for the container
    // to actually be laid out/painted before we hand it to Agora, while
    // staying cancellable synchronously on unmount.
    rafId = requestAnimationFrame(attach);

    return () => {
      cancelled = true;
      if (rafId != null) cancelAnimationFrame(rafId);
      try {
        if (track) track.stop();
      } catch (e) {}
    };
  }, [track, cameraOff, mirror]);

  return (
    <View ref={containerRef} style={[styles.container, style]}>
      {(cameraOff || !track) && (
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