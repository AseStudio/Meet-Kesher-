import { useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity,
  ActivityIndicator, Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '../../theme/colors';
import { supabase } from '../../lib/supabase';
import LogoMark from '../../components/LogoMark';

// ─────────────────────────────────────────────────────────────────────
// Same tokens as SignUpScreen/LoginScreen — this screen is styled to
// read as a continuation of sign-up, not a separate detour.
// ─────────────────────────────────────────────────────────────────────
const palette = {
  primary: colors.primary,
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

// ─────────────────────────────────────────────────────────────────────
// Only ever reached one way: SplashScreen sends a signed-in user here
// when their profile has no role — which today only ever happens after
// Google sign-in/sign-up, since email/password sign-up always sets a
// role up front. Picking one here is what used to be missing entirely:
// SplashScreen used to just `navigation.replace('Splash')` on this
// exact condition, replaying the splash animation forever because
// nothing ever changed the condition that sent it back.
// ─────────────────────────────────────────────────────────────────────
export default function SelectRoleScreen({ navigation }) {
  const [role, setRole] = useState('host');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [checkingSession, setCheckingSession] = useState(true);

  useEffect(() => {
    let mounted = true;
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (!mounted) return;
      if (!user) {
        // No session at all — nothing to pick a role for.
        navigation.replace('Welcome');
        return;
      }
      setCheckingSession(false);
    });
    return () => { mounted = false; };
  }, []);

  const handleContinue = async () => {
    setError('');
    setLoading(true);
    try {
      const { data: { user }, error: userError } = await supabase.auth.getUser();
      if (userError || !user) throw userError || new Error('Session expired. Please sign in again.');

      // upsert, not insert — a profiles row may already exist for this
      // user (created with role left null) or may not exist at all,
      // depending on how the account was first created. Either way this
      // is the fix either way.
      const { error: upsertError } = await supabase
        .from('profiles')
        .upsert({
          id: user.id,
          email: user.email,
          full_name: user.user_metadata?.full_name || user.user_metadata?.name || null,
          role,
        });

      if (upsertError) throw upsertError;

      navigation.replace(role === 'host' ? 'HostDashboard' : 'AttendeeDashboard');
    } catch (err) {
      setError(err.message || 'Could not save your choice. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  if (checkingSession) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator color={palette.primary} size="large" />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.inner}>
        <View style={styles.logo}>
          <LogoMark size={72} color={palette.primary} />
        </View>

        <Text style={styles.title}>One quick thing</Text>
        <Text style={styles.subtitle}>How do you want to use Kesher? You can still do the other any time from your dashboard.</Text>

        {error ? (
          <View style={styles.errorCard}>
            <Ionicons name="alert-circle" size={16} color={palette.danger} />
            <Text style={styles.errorText}>{error}</Text>
          </View>
        ) : null}

        <View style={styles.roleRow}>
          <TouchableOpacity
            style={[styles.roleCard, role === 'host' && styles.roleCardActive]}
            onPress={() => setRole('host')}
            activeOpacity={0.8}
          >
            <View style={styles.roleRadio}>
              {role === 'host' && <View style={styles.roleRadioInner} />}
            </View>
            <View style={styles.roleIconWrap}>
              <Ionicons name="star" size={16} color={palette.primary} />
            </View>
            <View style={styles.roleTextWrap}>
              <Text style={styles.roleTitle}>Host</Text>
              <Text style={styles.roleDesc}>Create and manage{'\n'}sessions for others.</Text>
            </View>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.roleCard, role === 'attendee' && styles.roleCardActive]}
            onPress={() => setRole('attendee')}
            activeOpacity={0.8}
          >
            <View style={styles.roleRadio}>
              {role === 'attendee' && <View style={styles.roleRadioInner} />}
            </View>
            <View style={styles.roleIconWrap}>
              <Ionicons name="people-outline" size={16} color={palette.primary} />
            </View>
            <View style={styles.roleTextWrap}>
              <Text style={styles.roleTitle}>Attendee</Text>
              <Text style={styles.roleDesc}>Join sessions and{'\n'}participate.</Text>
            </View>
          </TouchableOpacity>
        </View>

        <TouchableOpacity
          style={[styles.primaryButton, loading && styles.primaryButtonDisabled]}
          onPress={handleContinue}
          disabled={loading}
          activeOpacity={0.85}
        >
          {loading
            ? <ActivityIndicator color={palette.surface} />
            : <Text style={styles.primaryButtonText}>Continue</Text>
          }
        </TouchableOpacity>
      </View>
    </View>
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
  container: { flex: 1, backgroundColor: palette.canvas, alignItems: 'center', justifyContent: 'center' },
  loadingContainer: { flex: 1, backgroundColor: palette.canvas, alignItems: 'center', justifyContent: 'center' },
  inner: { width: '100%', maxWidth: 420, padding: 28, alignItems: 'center' },
  logo: { marginBottom: 18 },
  title: { fontSize: 26, fontWeight: '800', color: palette.ink, letterSpacing: -0.5, textAlign: 'center' },
  subtitle: { fontSize: 13.5, color: palette.inkMuted, marginTop: 9, lineHeight: 19, fontWeight: '500', textAlign: 'center', marginBottom: 22 },
  errorCard: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: palette.dangerSoft, borderRadius: 12, padding: 12, marginBottom: 14, width: '100%' },
  errorText: { color: palette.danger, fontSize: 13, fontWeight: '600', flexShrink: 1 },
  roleRow: { flexDirection: 'row', gap: 12, width: '100%', marginBottom: 20 },
  roleCard: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8, padding: 12, borderRadius: 13, borderWidth: 1.5, borderColor: palette.line, backgroundColor: palette.surface, ...inputShadow },
  roleCardActive: { borderColor: palette.primary, backgroundColor: palette.primarySoft },
  roleRadio: { width: 18, height: 18, borderRadius: 9, borderWidth: 2, borderColor: palette.primary, alignItems: 'center', justifyContent: 'center' },
  roleRadioInner: { width: 8, height: 8, borderRadius: 4, backgroundColor: palette.primary },
  roleIconWrap: { width: 28, height: 28, borderRadius: 9, backgroundColor: palette.primarySoft, alignItems: 'center', justifyContent: 'center' },
  roleTextWrap: { flex: 1 },
  roleTitle: { fontSize: 13.5, fontWeight: '700', color: palette.ink },
  roleDesc: { fontSize: 10.5, color: palette.inkMuted, lineHeight: 15, marginTop: 1, fontWeight: '500' },
  primaryButton: { width: '100%', backgroundColor: palette.primary, paddingVertical: 17, borderRadius: 16, alignItems: 'center', ...buttonShadow },
  primaryButtonDisabled: { opacity: 0.5 },
  primaryButtonText: { color: palette.surface, fontSize: 16.5, fontWeight: '800', letterSpacing: -0.2 },
});
