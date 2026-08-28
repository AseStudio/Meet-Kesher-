import React, { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, TextInput, ScrollView, KeyboardAvoidingView, Platform, ActivityIndicator } from 'react-native';
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
  danger: colors.red,
  dangerSoft: '#FFE9E9',
  neutralSoft: colors.greyLight,
  neutralText: colors.grey,
};

export default function GuestJoinScreen({ navigation }) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleJoin = async () => {
    setError('');
    if (!name.trim()) return setError('Please enter your full name.');
    if (!code.trim() || code.length < 6) return setError('Please enter a valid 6-character session code.');
    if (!password.trim()) return setError('Please enter the session password.');

    setLoading(true);
    try {
      const { data: session, error: fetchError } = await supabase
        .from('sessions')
        .select('*')
        .eq('code', code.trim().toUpperCase())
        .single();

      if (fetchError || !session) {
        setError('Session not found. Check your code.');
        return;
      }

      if (session.password !== password.trim()) {
        setError('Incorrect password.');
        return;
      }

      if (session.status === 'ended') {
        setError('This session has already ended.');
        return;
      }

      if (session.status === 'cancelled') {
        setError('This session was cancelled by the host.');
        return;
      }

      // NOTE: guests aren't authenticated Supabase users, so there's no
      // user.id here to check against `bans` (which keys off
      // banned_user_id) the way AttendeeDashboard's flow does for signed-in
      // attendees. A banned host's attendee could still get back in via
      // this guest form. Flagging this rather than silently pretending
      // it's covered — if that matters, banning guests needs its own
      // identifier (device id, email match, etc.) since there's nothing
      // else to key on here.

      const guest = { name: name.trim(), email: email.trim() || null };

      // The ONLY thing that gets a guest into the live session is the
      // session's actual status — never the lobby countdown. If it's not
      // 'live' yet (even if the lobby timer has already hit 0 and is just
      // waiting on the host), guests go to their own waiting screen —
      // not the shared Lobby, which assumes a signed-in Supabase user
      // (host countdown/cancel controls, music, attendee list — none of
      // it applies to or works for a guest) and would otherwise send
      // them to a screen that quietly does nothing for them.
      if (session.status === 'live') {
        navigation.navigate('AttendeeSession', { session, guest });
      } else {
        navigation.navigate('GuestWaiting', { session, guest });
      }
    } catch (err) {
      setError(err.message || 'Failed to join session.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>

        {/* Header with back button */}
        <View style={styles.header}>
          <View style={styles.headerLeft}>
            <TouchableOpacity style={styles.backBtn} onPress={() => navigation.navigate('Welcome')} activeOpacity={0.75}>
              <Ionicons name="arrow-back" size={18} color={palette.primary} />
            </TouchableOpacity>
            <Text style={styles.headerLabel}>Join a Session</Text>
          </View>
          <View style={styles.illustration}>
            <Ionicons name="log-in-outline" size={30} color={palette.primary} />
          </View>
        </View>

        <Text style={styles.title}>Join as Guest</Text>
        <Text style={styles.subtitle}>Enter the details below to access the session.</Text>

        {/* Unlock Banner */}
        <View style={styles.banner}>
          <View style={styles.bannerIcon}>
            <Ionicons name="lock-open-outline" size={18} color={palette.primary} />
          </View>
          <View style={styles.bannerText}>
            <Text style={styles.bannerTitle}>Create a <Text style={styles.link}>free account</Text> to unlock</Text>
            <Text style={styles.bannerSubtitle}>chat, board access, file submissions and more.</Text>
          </View>
          <TouchableOpacity style={styles.bannerButton} onPress={() => navigation.navigate('SignUp')} activeOpacity={0.8}>
            <Text style={styles.bannerButtonText}>Create Account</Text>
            <Ionicons name="arrow-forward" size={12} color={palette.primary} />
          </TouchableOpacity>
        </View>

        {/* Error */}
        {error ? (
          <View style={styles.errorCard}>
            <Ionicons name="alert-circle" size={16} color={palette.danger} />
            <Text style={styles.errorText}>{error}</Text>
          </View>
        ) : null}

        {/* Form */}
        <View style={styles.form}>
          <Text style={styles.label}>Full Name <Text style={styles.required}>*</Text></Text>
          <View style={[styles.inputRow, !name && error && styles.inputError]}>
            <Ionicons name="person-outline" size={17} color={palette.neutralText} style={styles.inputIcon} />
            <TextInput style={styles.input} placeholder="Enter your full name" placeholderTextColor={palette.neutralText} value={name} onChangeText={setName} />
          </View>
          <Text style={styles.hint}>This will be visible to the host and other attendees.</Text>

          <Text style={styles.label}>Email (Optional)</Text>
          <View style={styles.inputRow}>
            <Ionicons name="mail-outline" size={17} color={palette.neutralText} style={styles.inputIcon} />
            <TextInput style={styles.input} placeholder="Enter your email address" placeholderTextColor={palette.neutralText} value={email} onChangeText={setEmail} keyboardType="email-address" autoCapitalize="none" />
          </View>
          <Text style={styles.hint}>We'll use this to help you register and keep your session history.</Text>

          <Text style={styles.label}>Join Code <Text style={styles.required}>*</Text></Text>
          <View style={styles.inputRow}>
            <Ionicons name="keypad-outline" size={17} color={palette.neutralText} style={styles.inputIcon} />
            <TextInput
              style={styles.input}
              placeholder="Enter 6-character code (e.g. MX9K2T)"
              placeholderTextColor={palette.neutralText}
              value={code}
              onChangeText={t => setCode(t.toUpperCase())}
              autoCapitalize="characters"
              maxLength={6}
            />
          </View>

          <Text style={styles.label}>Session Password <Text style={styles.required}>*</Text></Text>
          <View style={styles.inputRow}>
            <Ionicons name="lock-closed-outline" size={17} color={palette.neutralText} style={styles.inputIcon} />
            <TextInput style={styles.input} placeholder="Enter session password" placeholderTextColor={palette.neutralText} value={password} onChangeText={setPassword} secureTextEntry />
          </View>

          <TouchableOpacity
            style={[styles.primaryButton, loading && styles.primaryButtonDisabled]}
            onPress={handleJoin}
            disabled={loading}
            activeOpacity={0.85}
          >
            {loading ? (
              <ActivityIndicator color={palette.surface} />
            ) : (
              <>
                <Ionicons name="log-in-outline" size={17} color={palette.surface} />
                <Text style={styles.primaryButtonText}>Join as Guest</Text>
              </>
            )}
          </TouchableOpacity>

          <View style={styles.privacyRow}>
            <Ionicons name="shield-checkmark-outline" size={15} color={palette.neutralText} style={{ marginTop: 1 }} />
            <Text style={styles.privacyText}>Your name and email (if provided) will only be used for this session and won't be shared outside.</Text>
          </View>

          <Text style={styles.termsText}>By joining, you agree to our <Text style={styles.link}>Terms of Use</Text> and <Text style={styles.link}>Privacy Policy</Text>.</Text>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

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
  scroll: { padding: 24, paddingBottom: 50 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 },
  headerLeft: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  backBtn: { width: 36, height: 36, borderRadius: 12, backgroundColor: palette.surface, alignItems: 'center', justifyContent: 'center', ...inputShadow },
  headerLabel: { color: palette.primary, fontWeight: '700', fontSize: 13.5 },
  illustration: { width: 52, height: 52, borderRadius: 18, backgroundColor: palette.primarySoft, alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 30, fontWeight: '800', color: palette.ink, marginBottom: 6, letterSpacing: -0.5 },
  subtitle: { fontSize: 13.5, color: palette.inkMuted, marginBottom: 20, lineHeight: 19, fontWeight: '500' },
  banner: { flexDirection: 'row', alignItems: 'center', backgroundColor: palette.surface, borderRadius: 17, padding: 14, gap: 10, marginBottom: 16, borderWidth: 1, borderColor: palette.line, ...inputShadow },
  bannerIcon: { width: 40, height: 40, borderRadius: 13, backgroundColor: palette.primarySoft, alignItems: 'center', justifyContent: 'center' },
  bannerText: { flex: 1 },
  bannerTitle: { fontSize: 12.5, fontWeight: '700', color: palette.ink },
  bannerSubtitle: { fontSize: 11, color: palette.inkMuted, marginTop: 2, fontWeight: '500' },
  bannerButton: { flexDirection: 'row', alignItems: 'center', gap: 5, borderWidth: 1.5, borderColor: palette.primary, borderRadius: 11, paddingHorizontal: 11, paddingVertical: 7 },
  bannerButtonText: { color: palette.primary, fontSize: 11.5, fontWeight: '700' },
  errorCard: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: palette.dangerSoft, borderRadius: 12, padding: 12, marginBottom: 8 },
  errorText: { color: palette.danger, fontSize: 13, fontWeight: '600', flexShrink: 1 },
  form: { gap: 8 },
  label: { fontSize: 13, fontWeight: '700', color: palette.ink, marginTop: 8, letterSpacing: -0.1 },
  required: { color: palette.danger },
  inputRow: { flexDirection: 'row', alignItems: 'center', backgroundColor: palette.surface, borderRadius: 13, paddingHorizontal: 14, borderWidth: 1, borderColor: palette.line, height: 52, ...inputShadow },
  inputError: { borderColor: palette.danger },
  inputIcon: { marginRight: 9 },
  input: { flex: 1, fontSize: 15, color: palette.ink, fontWeight: '600', outlineStyle: 'none' },
  hint: { fontSize: 11.5, color: palette.inkMuted, fontWeight: '500' },
  primaryButton: { flexDirection: 'row', gap: 8, backgroundColor: palette.primary, paddingVertical: 17, borderRadius: 16, alignItems: 'center', justifyContent: 'center', marginTop: 8, ...buttonShadow },
  primaryButtonDisabled: { opacity: 0.7 },
  primaryButtonText: { color: palette.surface, fontSize: 16.5, fontWeight: '800', letterSpacing: -0.2 },
  privacyRow: { flexDirection: 'row', gap: 8, alignItems: 'flex-start', marginTop: 8 },
  privacyText: { flex: 1, fontSize: 12, color: palette.inkMuted, lineHeight: 17, fontWeight: '500' },
  termsText: { textAlign: 'center', fontSize: 12, color: palette.inkMuted, marginTop: 8, fontWeight: '500' },
  link: { color: palette.primary, fontWeight: '700' },
});