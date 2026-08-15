import React, { useEffect, useRef, useState } from 'react';
import { View, Text, Animated, StyleSheet, Easing } from 'react-native';
import LogoMark from './LogoMark';
import { colors } from '../theme/colors';

export default function EnteringSessionTransition({ message = 'Entering session' }) {
  const pulse = useRef(new Animated.Value(0)).current;
  const ring1 = useRef(new Animated.Value(0)).current;
  const ring2 = useRef(new Animated.Value(0)).current;
  const [dotCount, setDotCount] = useState(0);

  useEffect(() => {
    // Logo "breathing" — scale + opacity looping together. Calmer than a
    // spin, and reads more like "arriving somewhere" than "still loading".
    Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 1100, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0, duration: 1100, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
      ])
    ).start();

    // Two rings rippling outward from behind the logo, offset so a fresh
    // one starts as the other is fading — continuous motion rather than
    // a single repeating "blip".
    const makeRing = (anim, delay) => {
      Animated.loop(
        Animated.sequence([
          Animated.delay(delay),
          Animated.timing(anim, { toValue: 1, duration: 2200, easing: Easing.out(Easing.ease), useNativeDriver: true }),
          Animated.timing(anim, { toValue: 0, duration: 0, useNativeDriver: true }),
        ])
      ).start();
    };
    makeRing(ring1, 0);
    makeRing(ring2, 1100);

    // Simple "..." cycle under the message — plain JS interval rather
    // than fighting Animated to drive text content directly.
    const dotTimer = setInterval(() => setDotCount((c) => (c + 1) % 4), 400);
    return () => clearInterval(dotTimer);
  }, []);

  const scale = pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.12] });
  const opacity = pulse.interpolate({ inputRange: [0, 1], outputRange: [0.85, 1] });

  const ringStyle = (anim) => ({
    transform: [{ scale: anim.interpolate({ inputRange: [0, 1], outputRange: [1, 2.6] }) }],
    opacity: anim.interpolate({ inputRange: [0, 0.6, 1], outputRange: [0.45, 0.15, 0] }),
  });

  return (
    <View style={styles.container}>
      <View style={styles.circleTopLeft} />
      <View style={styles.circleBottomRight} />

      <View style={styles.center}>
        <Animated.View style={[styles.ring, ringStyle(ring1)]} />
        <Animated.View style={[styles.ring, ringStyle(ring2)]} />
        <Animated.View style={{ transform: [{ scale }], opacity }}>
          <LogoMark size={100} color={colors.white} />
        </Animated.View>
      </View>

      <View style={styles.textWrap}>
        <Text style={styles.message}>{message}{'.'.repeat(dotCount)}</Text>
        <Text style={styles.subtitle}>Getting everything ready for you</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center', gap: 32 },
  circleTopLeft: { position: 'absolute', width: 220, height: 220, borderRadius: 110, backgroundColor: colors.white, opacity: 0.06, top: -70, left: -70 },
  circleBottomRight: { position: 'absolute', width: 300, height: 300, borderRadius: 150, backgroundColor: colors.white, opacity: 0.05, bottom: -110, right: -90 },
  center: { alignItems: 'center', justifyContent: 'center', width: 200, height: 200 },
  ring: {
    position: 'absolute',
    width: 100,
    height: 100,
    borderRadius: 50,
    borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.7)',
  },
  textWrap: { alignItems: 'center', gap: 4 },
  message: { fontSize: 20, fontWeight: '700', color: colors.white, letterSpacing: 0.3, minWidth: 230, textAlign: 'center' },
  subtitle: { fontSize: 13, color: 'rgba(255,255,255,0.65)' },
});