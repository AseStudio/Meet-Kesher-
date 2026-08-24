import React, { useEffect, useRef } from 'react';
import { View, Text, Animated, StyleSheet, Easing } from 'react-native';
import LogoMark from './LogoMark';
import { colors } from '../theme/colors';

export default function TransitionScreen({ message = 'Loading...' }) {
  const spinAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.loop(
      Animated.timing(spinAnim, {
        toValue: 1,
        duration: 1300,
        easing: Easing.linear,
        useNativeDriver: true,
      })
    ).start();
  }, []);

  const spin = spinAnim.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] });

  return (
    <View style={styles.container}>
      <Animated.View style={{ transform: [{ rotate: spin }] }}>
        <LogoMark size={90} color={colors.primary} />
      </Animated.View>
      <Text style={styles.message}>{message}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  // Was a hardcoded '#F4F3FF' — that's exactly colors.background, so
  // this now actually tracks the real theme instead of a copy of it.
  container: { flex: 1, backgroundColor: colors.background, alignItems: 'center', justifyContent: 'center', gap: 20 },
  message: { fontSize: 14, color: colors.textLight, fontWeight: '600', letterSpacing: -0.1 },
});