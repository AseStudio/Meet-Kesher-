import { useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity,
  TextInput, ScrollView, KeyboardAvoidingView,
  Platform, ActivityIndicator, Image,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '../../theme/colors';
import { supabase } from '../../lib/supabase';
import { signInWithGoogle } from '../../lib/oauth';
import LogoMark from '../../components/LogoMark';

// ─────────────────────────────────────────────────────────────────────
// PALETTE — same tokens/mapping as the other production-pass screens
// (HostDashboard / AttendeeDashboard / CreateSession / Profile / Login).
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

export default function SignUpScreen({ navigation }) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [role, setRole] = useState('host');
  const [showPassword, setShowPassword] = useState(false);
  const [agreed, setAgreed] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [emailExists, setEmailExists] = useState(false);

  // Check if email already exists as user types
  const handleEmailChange = async (text) => {
    setEmail(text);
    setEmailExists(false);
    if (text.includes('@') && text.includes('.')) {
      const { data } = await supabase
        .from('profiles')
        .select('role')
        .eq('email', text.trim().toLowerCase())
        .maybeSingle();
      if (data) setEmailExists(true);
    }
  };

 const handleSignUp = async () => {
  setError('');

  if (!name.trim())
    return setError('Please enter your full name.');

  if (!email.trim())
    return setError('Please enter your email address.');

  if (password.length < 8)
    return setError('Password must be at least 8 characters.');

  if (password !== confirm)
    return setError('Passwords do not match.');

  if (!agreed)
    return setError(
      'Please agree to the Terms of Use and Privacy Policy.'
    );

  setLoading(true);

  try {
    console.log('CHECKING EXISTING USER...');

    const { data: existingUser, error: existingUserError } =
      await supabase
        .from('profiles')
        .select('role')
        .eq('email', email.trim().toLowerCase())
        .maybeSingle();

    console.log('EXISTING USER:', existingUser);
    console.log('EXISTING USER ERROR:', existingUserError);

    if (existingUser) {
      setError(
        `This email is already registered as a ${existingUser.role}. Please log in instead.`
      );
      return;
    }

    console.log('CREATING ACCOUNT...');

    const { data, error: signUpError } =
      await supabase.auth.signUp({
        email: email.trim().toLowerCase(),
        password,
        options: {
          data: {
            full_name: name.trim(),
            role,
            phone: phone.trim(),
          },
        },
      });

    console.log('SIGNUP DATA:', data);
    console.log('SIGNUP ERROR:', signUpError);

    if (signUpError) {
      throw signUpError;
    }

    navigation.navigate('VerifyEmail', {
      email: email.trim(),
      role,
    });

  } catch (err) {
    console.log('SIGNUP ERROR:', err);

    setError(
      err.message || 'Sign up failed. Please try again.'
    );
  } finally {
    setLoading(false);
  }
};

const [googleLoading, setGoogleLoading] = useState(false);

const handleGoogleSignUp = async () => {
  setError('');
  setGoogleLoading(true);
  try {
    const { error, cancelled } = await signInWithGoogle();
    if (error) throw error;
    if (cancelled) setGoogleLoading(false);
  } catch (err) {
    setError(err.message || 'Google sign-up failed.');
    setGoogleLoading(false);
  }
};

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>

        <TouchableOpacity style={styles.backButton} onPress={() => navigation.navigate('Welcome')} activeOpacity={0.7}>
           <Ionicons name="arrow-back" size={20} color={palette.ink} />
        </TouchableOpacity>

        <View style={styles.headerRow}>
          <View style={styles.headerTextWrap}>
            <Text style={styles.title}>Create your</Text>
            <Text style={styles.titlePurple}>account</Text>
            <Text style={styles.subtitle}>Join Kesher and start hosting{'\n'}or attending sessions.</Text>
          </View>
          <TouchableOpacity style={styles.photoButton} activeOpacity={0.75}>
            <Ionicons name="camera-outline" size={22} color={palette.primary} />
            <Text style={styles.photoLabel}>Add Photo</Text>
            <Text style={styles.photoOptional}>Optional</Text>
          </TouchableOpacity>
        </View>

        {error ? (
          <View style={styles.errorCard}>
            <Ionicons name="alert-circle" size={16} color={palette.danger} />
            <Text style={styles.errorText}>{error}</Text>
          </View>
        ) : null}

        <View style={styles.form}>

          {/* Full Name */}
          <Text style={styles.label}>Full Name <Text style={styles.required}>*</Text></Text>
          <View style={styles.inputRow}>
            <Ionicons name="person-outline" size={17} color={palette.neutralText} style={styles.inputIcon} />
            <TextInput
              style={styles.input}
              placeholder="Enter your full name"
              placeholderTextColor={palette.neutralText}
              value={name}
              onChangeText={setName}
            />
          </View>

          {/* Email */}
          <Text style={styles.label}>Email <Text style={styles.required}>*</Text></Text>
          <View style={[styles.inputRow, emailExists && styles.inputRowError]}>
            <Ionicons name="mail-outline" size={17} color={emailExists ? palette.danger : palette.neutralText} style={styles.inputIcon} />
            <TextInput
              style={styles.input}
              placeholder="Enter your email address"
              placeholderTextColor={palette.neutralText}
              value={email}
              onChangeText={handleEmailChange}
              keyboardType="email-address"
              autoCapitalize="none"
            />
          </View>
          {emailExists && (
            <Text style={styles.emailExistsText}>
              Already registered.{' '}
              <Text style={styles.loginLink} onPress={() => navigation.navigate('Login')}>
                Log in instead →
              </Text>
            </Text>
          )}

          {/* Phone */}
          <Text style={styles.label}>Phone (Optional)</Text>
          <View style={styles.inputRow}>
            <Ionicons name="call-outline" size={17} color={palette.neutralText} style={styles.inputIcon} />
            <TextInput
              style={styles.input}
              placeholder="Enter your phone number"
              placeholderTextColor={palette.neutralText}
              value={phone}
              onChangeText={setPhone}
              keyboardType="phone-pad"
            />
          </View>

          {/* Password */}
          <Text style={styles.label}>Password <Text style={styles.required}>*</Text></Text>
          <View style={styles.inputRow}>
            <Ionicons name="lock-closed-outline" size={17} color={palette.neutralText} style={styles.inputIcon} />
            <TextInput
              style={styles.input}
              placeholder="Create a strong password"
              placeholderTextColor={palette.neutralText}
              value={password}
              onChangeText={setPassword}
              secureTextEntry={!showPassword}
            />
            <TouchableOpacity onPress={() => setShowPassword(!showPassword)} activeOpacity={0.7}>
              <Ionicons name={showPassword ? 'eye-off-outline' : 'eye-outline'} size={18} color={palette.neutralText} />
            </TouchableOpacity>
          </View>
          <Text style={styles.hint}>Use at least 8 characters with letters, numbers & symbols.</Text>

          {/* Confirm Password */}
          <Text style={styles.label}>Confirm Password <Text style={styles.required}>*</Text></Text>
          <View style={styles.inputRow}>
            <Ionicons name="lock-closed-outline" size={17} color={palette.neutralText} style={styles.inputIcon} />
            <TextInput
              style={styles.input}
              placeholder="Confirm your password"
              placeholderTextColor={palette.neutralText}
              value={confirm}
              onChangeText={setConfirm}
              secureTextEntry={!showPassword}
            />
          </View>

          {/* Role */}
          <Text style={styles.label}>I want to join as a <Text style={styles.required}>*</Text></Text>
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

          {/* Terms */}
          <TouchableOpacity style={styles.termsRow} onPress={() => setAgreed(!agreed)} activeOpacity={0.75}>
            <View style={[styles.checkbox, agreed && styles.checkboxChecked]}>
              {agreed && <Ionicons name="checkmark" size={13} color={palette.surface} />}
            </View>
            <Text style={styles.termsText}>
              I agree to the <Text style={styles.link}>Terms of Use</Text> and{' '}
              <Text style={styles.link}>Privacy Policy</Text>.
            </Text>
          </TouchableOpacity>

          {/* Submit */}
          <TouchableOpacity
            style={[styles.primaryButton, (!agreed || loading || emailExists) && styles.primaryButtonDisabled]}
            onPress={handleSignUp}
            disabled={loading || !agreed || emailExists}
            activeOpacity={0.85}
          >
            {loading
              ? <ActivityIndicator color={palette.surface} />
              : <Text style={styles.primaryButtonText}>Create Account</Text>
            }
          </TouchableOpacity>

          <View style={styles.dividerRow}>
            <View style={styles.divider} />
            <Text style={styles.dividerText}>OR</Text>
            <View style={styles.divider} />
          </View>

         <TouchableOpacity
  style={[styles.googleButton, googleLoading && styles.primaryButtonDisabled]}
  onPress={handleGoogleSignUp}
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

          <TouchableOpacity onPress={() => navigation.navigate('Login')} activeOpacity={0.7}>
            <Text style={styles.loginText}>
              Already have an account? <Text style={styles.link}>Log In</Text>
            </Text>
          </TouchableOpacity>

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
  backButton: { width: 38, height: 38, borderRadius: 13, backgroundColor: palette.surface, alignItems: 'center', justifyContent: 'center', marginBottom: 18, ...inputShadow },
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 24, gap: 12 },
  headerTextWrap: { flex: 1 },
  title: { fontSize: 30, fontWeight: '800', color: palette.ink, letterSpacing: -0.5 },
  titlePurple: { fontSize: 30, fontWeight: '800', color: palette.primary, letterSpacing: -0.5 },
  subtitle: { fontSize: 13.5, color: palette.inkMuted, marginTop: 9, lineHeight: 19, fontWeight: '500' },
  photoButton: { alignItems: 'center', justifyContent: 'center', width: 90, height: 90, borderRadius: 45, borderWidth: 2, borderColor: palette.line, borderStyle: 'dashed', gap: 2 },
  photoLabel: { fontSize: 10.5, color: palette.primary, fontWeight: '700', marginTop: 2 },
  photoOptional: { fontSize: 9.5, color: palette.neutralText, backgroundColor: palette.line, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 8, marginTop: 2, fontWeight: '600' },
  errorCard: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: palette.dangerSoft, borderRadius: 12, padding: 12, marginBottom: 12 },
  errorText: { color: palette.danger, fontSize: 13, fontWeight: '600', flexShrink: 1 },
  form: { gap: 8 },
  label: { fontSize: 13, fontWeight: '700', color: palette.ink, marginTop: 8, letterSpacing: -0.1 },
  required: { color: palette.danger },
  inputRow: { flexDirection: 'row', alignItems: 'center', backgroundColor: palette.surface, borderRadius: 13, paddingHorizontal: 14, borderWidth: 1, borderColor: palette.line, height: 52, ...inputShadow },
  inputRowError: { borderColor: palette.danger },
  inputIcon: { marginRight: 9 },
  input: { flex: 1, fontSize: 15, color: palette.ink, fontWeight: '600', outlineStyle: 'none' },
  hint: { fontSize: 11.5, color: palette.inkMuted, marginTop: 3, fontWeight: '500' },
  emailExistsText: { fontSize: 12, color: palette.danger, marginTop: 3, fontWeight: '600' },
  loginLink: { color: palette.primary, fontWeight: '700' },
  roleRow: { flexDirection: 'row', gap: 12, marginTop: 4 },
  roleCard: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8, padding: 12, borderRadius: 13, borderWidth: 1.5, borderColor: palette.line, backgroundColor: palette.surface, ...inputShadow },
  roleCardActive: { borderColor: palette.primary, backgroundColor: palette.primarySoft },
  roleRadio: { width: 18, height: 18, borderRadius: 9, borderWidth: 2, borderColor: palette.primary, alignItems: 'center', justifyContent: 'center' },
  roleRadioInner: { width: 8, height: 8, borderRadius: 4, backgroundColor: palette.primary },
  roleIconWrap: { width: 28, height: 28, borderRadius: 9, backgroundColor: palette.primarySoft, alignItems: 'center', justifyContent: 'center' },
  roleTextWrap: { flex: 1 },
  roleTitle: { fontSize: 13.5, fontWeight: '700', color: palette.ink },
  roleDesc: { fontSize: 10.5, color: palette.inkMuted, lineHeight: 15, marginTop: 1, fontWeight: '500' },
  termsRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 8 },
  checkbox: { width: 20, height: 20, borderRadius: 6, borderWidth: 1.5, borderColor: palette.neutralText, alignItems: 'center', justifyContent: 'center' },
  checkboxChecked: { backgroundColor: palette.primary, borderColor: palette.primary },
  termsText: { flex: 1, fontSize: 12.5, color: palette.inkMuted, fontWeight: '500' },
  link: { color: palette.primary, fontWeight: '700' },
  primaryButton: { backgroundColor: palette.primary, paddingVertical: 17, borderRadius: 16, alignItems: 'center', marginTop: 8, ...buttonShadow },
  primaryButtonDisabled: { opacity: 0.5 },
  primaryButtonText: { color: palette.surface, fontSize: 16.5, fontWeight: '800', letterSpacing: -0.2 },
  dividerRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginVertical: 4 },
  divider: { flex: 1, height: 1, backgroundColor: palette.line },
  dividerText: { color: palette.neutralText, fontSize: 12, fontWeight: '700', letterSpacing: 0.5 },
  googleButton: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, paddingVertical: 15, borderRadius: 16, borderWidth: 1.5, borderColor: palette.line, backgroundColor: palette.surface },
  googleButtonText: { fontSize: 14.5, fontWeight: '700', color: palette.ink },
  loginText: { textAlign: 'center', fontSize: 13.5, color: palette.inkMuted, marginTop: 8, fontWeight: '500' },
  logoImage: {
    width: 140,
    height: 140,
    marginBottom: 20,
  },
});