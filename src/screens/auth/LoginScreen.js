import React, { useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity,
  TextInput, KeyboardAvoidingView, Platform,
  ActivityIndicator
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '../../theme/colors';
import { supabase } from '../../lib/supabase';
import { signInWithGoogle } from '../../lib/oauth';
import LogoMark from '../../components/LogoMark';

// ─────────────────────────────────────────────────────────────────────
// PALETTE — same tokens/mapping as the other production-pass screens
// (HostDashboard / AttendeeDashboard / CreateSession / Profile).
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
  danger: colors.red,
  dangerSoft: '#FFE9E9',
  neutralText: colors.grey,
};

export default function LoginScreen({ navigation }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [error, setError] = useState('');

  const handleLogin = async () => {
    setError('');
    if (!email.trim()) return setError('Please enter your email address.');
    if (!password) return setError('Please enter your password.');

    setLoading(true);
    try {
      const { data, error: loginError } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      });

      if (loginError) throw loginError;

      const { data: profile } = await supabase
        .from('profiles')
        .select('role')
        .eq('id', data.user.id)
        .single();

      if (profile?.role === 'host') {
        navigation.navigate('HostDashboard');
      } else {
        navigation.navigate('AttendeeDashboard');
      }

    } catch (err) {
      setError(err.message || 'Login failed. Please check your credentials.');
    } finally {
      setLoading(false);
    }
  };

  const handleForgotPassword = async () => {
    if (!email.trim()) return setError('Enter your email first, then tap Forgot Password.');
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(email.trim());
      if (error) throw error;
      setError('');
    } catch (err) {
      setError(err.message);
    }
  };

  const handleGoogleSignIn = async () => {
    setError('');
    setGoogleLoading(true);
    try {
      const { error, cancelled } = await signInWithGoogle();
      if (error) throw error;
      if (cancelled) {
        setGoogleLoading(false);
        return;
      }
      // Only needed on native — there, signInWithGoogle() opens an
      // in-app browser sheet rather than navigating the page, so this
      // app is still mounted afterward and has to navigate itself. On
      // web, signInWithOAuth() already triggers a real window.location
      // redirect to Google as a side effect of the call above; JS
      // doesn't halt the instant that's kicked off, so calling
      // navigate() here raced that redirect — Splash would flash and
      // start its animation for a moment before the real navigation to
      // Google's account picker cut it off. The web case doesn't need
      // this at all: the page is already on its way to reloading fresh
      // once Google redirects back to /app.
      if (Platform.OS !== 'web') {
        navigation.replace('Splash');
      }
    } catch (err) {
      setError(err.message || 'Google sign-in failed.');
      setGoogleLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <View style={styles.inner}>

        <View style={styles.logoContainer}>
          <LinearGradient
            colors={[palette.primaryBright, palette.primary, palette.primaryDeep]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={styles.logoBox}
          >
            <LogoMark size={42} color={palette.surface} />
          </LinearGradient>
          <Text style={styles.title}>Welcome back</Text>
          <Text style={styles.subtitle}>Log in to access your sessions on Kesher.</Text>
        </View>

        {error ? (
          <View style={styles.errorCard}>
            <Ionicons name="alert-circle" size={16} color={palette.danger} />
            <Text style={styles.errorText}>{error}</Text>
          </View>
        ) : null}

        <View style={styles.form}>
          <Text style={styles.label}>Email</Text>
          <View style={styles.inputRow}>
            <Ionicons name="mail-outline" size={17} color={palette.neutralText} style={styles.inputIcon} />
            <TextInput
              style={styles.input}
              placeholder="Enter your email"
              placeholderTextColor={palette.neutralText}
              value={email}
              onChangeText={setEmail}
              keyboardType="email-address"
              autoCapitalize="none"
            />
          </View>

          <Text style={styles.label}>Password</Text>
          <View style={styles.inputRow}>
            <Ionicons name="lock-closed-outline" size={17} color={palette.neutralText} style={styles.inputIcon} />
            <TextInput
              style={styles.input}
              placeholder="Enter your password"
              placeholderTextColor={palette.neutralText}
              value={password}
              onChangeText={setPassword}
              secureTextEntry={!showPassword}
            />
            <TouchableOpacity onPress={() => setShowPassword(!showPassword)} activeOpacity={0.7}>
              <Ionicons name={showPassword ? 'eye-off-outline' : 'eye-outline'} size={18} color={palette.neutralText} />
            </TouchableOpacity>
          </View>

          <TouchableOpacity style={styles.forgotRow} onPress={handleForgotPassword} activeOpacity={0.7}>
            <Text style={styles.forgotText}>Forgot Password?</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.primaryButton, loading && styles.primaryButtonDisabled]}
            onPress={handleLogin}
            disabled={loading}
            activeOpacity={0.85}
          >
            {loading
              ? <ActivityIndicator color={palette.surface} />
              : <Text style={styles.primaryButtonText}>Log In</Text>
            }
          </TouchableOpacity>

          <View style={styles.dividerRow}>
            <View style={styles.divider} />
            <Text style={styles.dividerText}>OR</Text>
            <View style={styles.divider} />
          </View>

          <TouchableOpacity
            style={[styles.googleButton, googleLoading && styles.primaryButtonDisabled]}
            onPress={handleGoogleSignIn}
            disabled={googleLoading}
            activeOpacity={0.8}
          >
            {googleLoading
              ? <ActivityIndicator color={palette.ink} />
              : (
                <>
                  <Ionicons name="logo-google" size={18} color="#4285F4" />
                  <Text style={styles.googleButtonText}>Continue with Google</Text>
                </>
              )
            }
          </TouchableOpacity>

          <TouchableOpacity onPress={() => navigation.navigate('SignUp')} activeOpacity={0.7}>
            <Text style={styles.signupText}>Don't have an account? <Text style={styles.link}>Sign Up</Text></Text>
          </TouchableOpacity>
        </View>
      </View>
    </KeyboardAvoidingView>
  );
}

const logoShadow = Platform.select({
  ios: { shadowColor: palette.primaryDeep, shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.32, shadowRadius: 16 },
  android: { elevation: 8 },
  default: { boxShadow: `0 8px 20px rgba(58,15,217,0.3)` },
});

const inputShadow = Platform.select({
  ios: { shadowColor: '#2A1A6B', shadowOffset: { width: 0, height: 3 }, shadowOpacity: 0.05, shadowRadius: 8 },
  android: { elevation: 1 },
  default: { boxShadow: '0 3px 8px rgba(42,26,107,0.05)' },
});

const buttonShadow = Platform.select({
  ios: { shadowColor: palette.primaryDeep, shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.26, shadowRadius: 16 },
  android: { elevation: 8 },
  default: { boxShadow: `0 8px 20px rgba(58,15,217,0.26)` },
});

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: palette.canvas },
  inner: { flex: 1, padding: 24, justifyContent: 'center' },
  logoContainer: { alignItems: 'center', marginBottom: 30 },
  logoBox: { width: 80, height: 80, borderRadius: 24, alignItems: 'center', justifyContent: 'center', marginBottom: 18, ...logoShadow },
  title: { fontSize: 27, fontWeight: '800', color: palette.ink, marginBottom: 7, letterSpacing: -0.4 },
  subtitle: { fontSize: 13.5, color: palette.inkMuted, textAlign: 'center', fontWeight: '500', lineHeight: 19 },
  errorCard: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: palette.dangerSoft, borderRadius: 12, padding: 12, marginBottom: 12 },
  errorText: { color: palette.danger, fontSize: 13, fontWeight: '600', flexShrink: 1 },
  form: { gap: 10 },
  label: { fontSize: 13, fontWeight: '700', color: palette.ink, letterSpacing: -0.1 },
  inputRow: { flexDirection: 'row', alignItems: 'center', backgroundColor: palette.surface, borderRadius: 13, paddingHorizontal: 14, borderWidth: 1, borderColor: palette.line, height: 52, ...inputShadow },
  inputIcon: { marginRight: 9 },
  input: { flex: 1, fontSize: 15, color: palette.ink, fontWeight: '600', outlineStyle: 'none' },
  forgotRow: { alignItems: 'flex-end' },
  forgotText: { color: palette.primary, fontSize: 12.5, fontWeight: '700' },
  primaryButton: { backgroundColor: palette.primary, paddingVertical: 17, borderRadius: 16, alignItems: 'center', marginTop: 4, ...buttonShadow },
  primaryButtonDisabled: { opacity: 0.7 },
  primaryButtonText: { color: palette.surface, fontSize: 16.5, fontWeight: '800', letterSpacing: -0.2 },
  dividerRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginVertical: 2 },
  divider: { flex: 1, height: 1, backgroundColor: palette.line },
  dividerText: { color: palette.neutralText, fontSize: 12, fontWeight: '700', letterSpacing: 0.5 },
  googleButton: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, paddingVertical: 15, borderRadius: 16, borderWidth: 1.5, borderColor: palette.line, backgroundColor: palette.surface },
  googleButtonText: { fontSize: 14.5, fontWeight: '700', color: palette.ink },
  signupText: { textAlign: 'center', fontSize: 13.5, color: palette.inkMuted, fontWeight: '500', marginTop: 4 },
  link: { color: palette.primary, fontWeight: '700' },
});