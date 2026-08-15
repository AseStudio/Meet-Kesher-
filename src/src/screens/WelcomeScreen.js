import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Dimensions } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { colors } from '../theme/colors';
import LogoMark from '../components/LogoMark';
const { width } = Dimensions.get('window');

export default function WelcomeScreen({ navigation }) {
  return (
    <View style={styles.container}>
      <LinearGradient colors={['#F4F3FF', '#E8E7FF']} style={styles.background} />
      <View style={styles.circleTopRight} />
      <View style={styles.circleBottomLeft} />

      <View style={styles.logoContainer}>
       <LogoMark size={110} color={colors.primary} />
        <View style={styles.appNameRow}>
          <Text style={[styles.appName, styles.appNameDark]}>Kes</Text>
          <Text style={[styles.appName, styles.appNamePurple]}>her</Text>
        </View>
        <Text style={styles.tagline}>Host. Attend. Collaborate. Connect.{'\n'}All in one place.</Text>
      </View>

      <View style={styles.buttonContainer}>
        <TouchableOpacity
          style={styles.primaryButton}
          onPress={() => navigation.navigate('SignUp')}
        >
          <Text style={styles.primaryButtonText}>Get Started →</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.secondaryButton}
          onPress={() => navigation.navigate('Login')}
        >
          <Text style={styles.secondaryButtonText}>Log In</Text>
        </TouchableOpacity>

        <View style={styles.dividerRow}>
          <View style={styles.divider} />
          <Text style={styles.dividerText}>OR</Text>
          <View style={styles.divider} />
        </View>

        <TouchableOpacity onPress={() => navigation.navigate('GuestJoin')}>
          <Text style={styles.guestText}>Join as Guest →</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background, alignItems: 'center', justifyContent: 'space-between', paddingBottom: 50 },
  background: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0 },
  circleTopRight: { position: 'absolute', width: 200, height: 200, borderRadius: 100, backgroundColor: colors.primaryLight, opacity: 0.15, top: -50, right: -50 },
  circleBottomLeft: { position: 'absolute', width: 300, height: 300, borderRadius: 150, backgroundColor: colors.primary, opacity: 0.08, bottom: -100, left: -100 },
  logoContainer: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 4 },
  appName: { fontSize: 42, fontWeight: '800', marginBottom: 12, marginTop: 16 },
  appNameDark: { color: colors.text },
  appNamePurple: { color: colors.primary },
  appNameRow: { flexDirection: 'row', alignItems: 'baseline' },
  tagline: { fontSize: 16, color: colors.textLight, textAlign: 'center', lineHeight: 24 },
  buttonContainer: { width: '100%', paddingHorizontal: 24, alignItems: 'center', gap: 12 },
  primaryButton: { width: '100%', backgroundColor: colors.primary, paddingVertical: 18, borderRadius: 16, alignItems: 'center', elevation: 8 },
  primaryButtonText: { color: colors.white, fontSize: 17, fontWeight: '700' },
  secondaryButton: { width: '100%', backgroundColor: 'transparent', paddingVertical: 18, borderRadius: 16, alignItems: 'center', borderWidth: 1.5, borderColor: colors.primary },
  secondaryButtonText: { color: colors.primary, fontSize: 17, fontWeight: '600' },
  dividerRow: { flexDirection: 'row', alignItems: 'center', width: '100%', gap: 12, marginVertical: 4 },
  divider: { flex: 1, height: 1, backgroundColor: colors.greyLight },
  dividerText: { color: colors.grey, fontSize: 13, fontWeight: '500' },
  guestText: { color: colors.primary, fontSize: 15, fontWeight: '600' },
});