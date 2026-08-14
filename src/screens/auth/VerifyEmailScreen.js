import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Platform,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '../../theme/colors';
import { supabase } from '../../lib/supabase';

// ─────────────────────────────────────────────────────────────────────
// PALETTE — same tokens/mapping as the other production-pass screens.
// ─────────────────────────────────────────────────────────────────────
const palette = {
  primary: colors.primary,
  primaryBright: colors.primaryLight,
  primaryDeep: colors.primaryDark,
  primarySoft: colors.background,
  ink: colors.text,
  inkMuted: colors.textLight,
  surface: colors.white,
  canvas: colors.background,
  line: colors.greyLight,
  success: colors.green,
  successSoft: '#E7FBF0',
  danger: colors.red,
  dangerSoft: '#FFE9E9',
  neutralText: colors.grey,
};

export default function VerifyEmailScreen({ navigation, route }) {
  const email = route.params?.email || '';

  const [resent, setResent] = useState(false);
  const [error, setError] = useState('');

  const goToDashboard = (user) => {
    const role = user?.user_metadata?.role || 'attendee';

    navigation.reset({
      index: 0,
      routes: [
        {
          name:
            role === 'host'
              ? 'HostDashboard'
              : 'AttendeeDashboard',
        },
      ],
    });
  };

   const signOutAndReturn = async () => {
    await supabase.auth.signOut();
    navigation.navigate('Welcome');
  };


useEffect(() => {
  const interval = setInterval(async () => {
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user) return;

      if (user?.email_confirmed_at) {
        clearInterval(interval);

        await supabase
          .from('profiles')
          .update({
            email_verified: true,
          })
          .eq('id', user.id);

        goToDashboard(user);
      }
    } catch (err) {
      console.log(err);
    }
  }, 3000);

  return () => clearInterval(interval);
}, []);

const resendEmail = async () => {
  if (!email) {
    setError('Email address unavailable.');
    return;
  }

  setError('');

  try {
    const { error } = await supabase.auth.resend({
      type: 'signup',
      email,
    });

    if (error) throw error;

    setResent(true);

    setTimeout(() => {
      setResent(false);
    }, 5000);
  } catch (err) {
    setError(err.message);
  }
};


  return (
    <View style={styles.container}>
      <View style={styles.content}>
        <LinearGradient
          colors={[palette.primaryBright, palette.primary, palette.primaryDeep]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.iconWrap}
        >
          <Ionicons name="mail-outline" size={42} color={palette.surface} />
        </LinearGradient>

        <Text style={styles.title}>Verify your Kesher account</Text>

        <Text style={styles.subtitle}>
          A verification link has been sent to:
        </Text>

        <View style={styles.emailBadge}>
          <Text style={styles.emailText}>{email}</Text>
        </View>

        <Text style={styles.instructions}>
         Open the email and click the verification link.

This screen will automatically continue once your email is verified.
        </Text>

        {error ? (
          <View style={styles.errorCard}>
            <Ionicons name="alert-circle" size={15} color={palette.danger} />
            <Text style={styles.errorText}>{error}</Text>
          </View>
        ) : null}

        {resent ? (
          <View style={styles.successCard}>
            <Ionicons name="checkmark-circle" size={15} color={palette.success} />
            <Text style={styles.successText}>
              Verification email resent!
            </Text>
          </View>
        ) : null}

      

        <TouchableOpacity
          style={styles.resendBtn}
          onPress={resendEmail}
          activeOpacity={0.7}
        >
          <Text style={styles.resendBtnText}>
            Didn't get it? Resend email
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.backBtn}
          onPress={signOutAndReturn}
          activeOpacity={0.7}
        >
          <View style={styles.backBtnRow}>
            <Ionicons name="arrow-back" size={13} color={palette.inkMuted} />
            <Text style={styles.backBtnText}>
              Back to Sign Up
            </Text>
          </View>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const iconShadow = Platform.select({
  ios: { shadowColor: palette.primaryDeep, shadowOffset: { width: 0, height: 10 }, shadowOpacity: 0.3, shadowRadius: 20 },
  android: { elevation: 8 },
  default: { boxShadow: `0 10px 24px rgba(58,15,217,0.3)` },
});

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: palette.canvas,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  content: {
    alignItems: 'center',
    gap: 16,
    width: '100%',
    maxWidth: 400,
  },
  iconWrap: {
    width: 100,
    height: 100,
    borderRadius: 50,
    alignItems: 'center',
    justifyContent: 'center',
    ...iconShadow,
  },
  title: {
    fontSize: 26,
    fontWeight: '800',
    color: palette.ink,
    textAlign: 'center',
    letterSpacing: -0.4,
  },
  subtitle: {
    fontSize: 14.5,
    color: palette.inkMuted,
    textAlign: 'center',
    fontWeight: '500',
  },
  emailBadge: {
    backgroundColor: palette.surface,
    borderRadius: 13,
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: palette.line,
  },
  emailText: {
    fontSize: 15,
    fontWeight: '700',
    color: palette.primary,
  },
  instructions: {
    fontSize: 13.5,
    color: palette.inkMuted,
    textAlign: 'center',
    lineHeight: 21,
    fontWeight: '500',
  },
  errorCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
    backgroundColor: palette.dangerSoft,
    borderRadius: 12,
    padding: 12,
    width: '100%',
  },
  errorText: {
    color: palette.danger,
    fontSize: 13,
    fontWeight: '600',
    textAlign: 'center',
  },
  successCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
    backgroundColor: palette.successSoft,
    borderRadius: 12,
    padding: 12,
    width: '100%',
  },
  successText: {
    color: palette.success,
    fontSize: 13,
    fontWeight: '600',
    textAlign: 'center',
  },
  resendBtn: {
    paddingVertical: 10,
  },
  resendBtnText: {
    color: palette.primary,
    fontSize: 14,
    fontWeight: '700',
  },
  backBtn: {
    paddingVertical: 10,
  },
  backBtnRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  backBtnText: {
    color: palette.inkMuted,
    fontSize: 13.5,
    fontWeight: '500',
  },
})