import React, { useEffect, useRef } from 'react';
import { View, Text, Animated, StyleSheet, Easing } from 'react-native';
import { Circle, Path, Svg } from 'react-native-svg';
import { colors } from '../../theme/colors';
import { supabase } from '../../lib/supabase';
import { getLogoGeometry } from '../../components/logoGeometry';

const AnimatedPath   = Animated.createAnimatedComponent(Path);
const AnimatedCircle = Animated.createAnimatedComponent(Circle);

const { SIZE, DOTS, ARC_LEN, arcPath } = getLogoGeometry(160);

const DOT_MS = 280;
const ARC_MS = 700;

export default function SplashScreen({ navigation }) {
  const dotAnim = [
    useRef(new Animated.Value(0)).current,
    useRef(new Animated.Value(0)).current,
    useRef(new Animated.Value(0)).current,
    useRef(new Animated.Value(0)).current,
  ];
  const arcAnim = [
    useRef(new Animated.Value(ARC_LEN)).current,
    useRef(new Animated.Value(ARC_LEN)).current,
    useRef(new Animated.Value(ARC_LEN)).current,
    useRef(new Animated.Value(ARC_LEN)).current,
  ];
  const spinAnim     = useRef(new Animated.Value(0)).current;
  const textOpacity  = useRef(new Animated.Value(0)).current;
  const nameSlide    = useRef(new Animated.Value(-40)).current; // starts 40px left, slides to 0

  useEffect(() => {
    // Phase 1: build the logo — dot, arc, dot, arc... around the circle
    Animated.sequence([
      Animated.timing(dotAnim[0], { toValue: 1, duration: DOT_MS, useNativeDriver: false }),
      Animated.timing(arcAnim[0], { toValue: 0, duration: ARC_MS, useNativeDriver: false, easing: Easing.out(Easing.quad) }),
      Animated.timing(dotAnim[1], { toValue: 1, duration: DOT_MS, useNativeDriver: false }),
      Animated.timing(arcAnim[1], { toValue: 0, duration: ARC_MS, useNativeDriver: false, easing: Easing.out(Easing.quad) }),
      Animated.timing(dotAnim[2], { toValue: 1, duration: DOT_MS, useNativeDriver: false }),
      Animated.timing(arcAnim[2], { toValue: 0, duration: ARC_MS, useNativeDriver: false, easing: Easing.out(Easing.quad) }),
      Animated.timing(dotAnim[3], { toValue: 1, duration: DOT_MS, useNativeDriver: false }),
      Animated.timing(arcAnim[3], { toValue: 0, duration: ARC_MS, useNativeDriver: false, easing: Easing.out(Easing.quad) }),
    ]).start(() => {

      // Phase 2: the completed logo spins once
      Animated.timing(spinAnim, {
        toValue: 1,
        duration: 680,
        easing: Easing.inOut(Easing.cubic),
        useNativeDriver: true,
      }).start(() => {

        // Phase 3: "Kesher" slides in from the left + fades in, beneath the logo
        Animated.parallel([
          Animated.timing(nameSlide, {
            toValue: 0, duration: 450, useNativeDriver: false,
            easing: Easing.out(Easing.cubic),
          }),
          Animated.timing(textOpacity, {
            toValue: 1, duration: 450, useNativeDriver: false,
          }),
        ]).start(() => {
          setTimeout(routeBasedOnSession, 480);
        });
      });
    });
  }, []);

const routeBasedOnSession = async () => {
  try {
    const {
      data: { session },
    } = await supabase.auth.getSession();

    // No logged-in user
    if (!session?.user) {
      navigation.replace('Welcome');
      return;
    }

    // Logged in but email not verified
    if (!session.user.email_confirmed_at) {
      navigation.replace('VerifyEmail', {
        email: session.user.email,
        role: session.user.user_metadata?.role || null,
      });
      return;
    }

    // Get user's profile
    const { data: profile, error } = await supabase
      .from('profiles')
      .select('role')
      .eq('id', session.user.id)
      .maybeSingle();

    if (error) {
      console.error('Profile lookup failed:', error);
      navigation.replace('Splash');
      return;
    }

    // No role yet → Splash (role selection happens there)
    if (!profile?.role) {
      navigation.replace('Splash');
      return;
    }

    // Route based on role
    switch (profile.role) {
      case 'host':
        navigation.replace('HostDashboard');
        break;

      case 'attendee':
        navigation.replace('AttendeeDashboard');
        break;

      default:
        navigation.replace('Splash');
        break;
    }

  } catch (error) {
    console.error('Startup routing error:', error);
    navigation.replace('Welcome');
  }
};
  const spin = spinAnim.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] });

  return (
    <View style={styles.container}>
      <Animated.View style={{ transform: [{ rotate: spin }] }}>
        <Svg width={SIZE} height={SIZE}>
          {[0, 1, 2, 3].map(i => (
            <AnimatedPath
              key={`a${i}`}
              d={arcPath(i)}
              stroke={colors.primary}
              strokeWidth={3.5}
              strokeLinecap="round"
              fill="none"
              strokeDasharray={`${ARC_LEN}`}
              strokeDashoffset={arcAnim[i]}
            />
          ))}
          {DOTS.map((pos, i) => (
            <AnimatedCircle key={`d${i}`} cx={pos.x} cy={pos.y} r={10} fill={colors.primary} opacity={dotAnim[i]} />
          ))}
        </Svg>
      </Animated.View>

      <Animated.View
        style={[
          styles.nameRow,
          { opacity: textOpacity, transform: [{ translateX: nameSlide }] },
        ]}
      >
        <Text style={styles.nameKes}>Kes</Text>
        <Text style={styles.nameHer}>her</Text>
      </Animated.View>

      <Animated.Text style={[styles.tagline, { opacity: textOpacity }]}>
        Real-time sessions, connected.
      </Animated.Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F4F3FF', alignItems: 'center', justifyContent: 'center', gap: 22 },
  nameRow: { flexDirection: 'row', alignItems: 'baseline', marginTop: 4 },
  nameKes: { fontSize: 56, fontWeight: '900', color: '#0A0A1A', letterSpacing: -2 },
  nameHer: { fontSize: 56, fontWeight: '900', color: colors.primary, letterSpacing: -2 },
  tagline: { fontSize: 14, color: 'rgba(0,0,0,0.35)', letterSpacing: 0.5, fontWeight: '500' },
});