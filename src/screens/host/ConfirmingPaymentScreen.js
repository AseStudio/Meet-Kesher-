import React, { useEffect, useState, useRef } from 'react';
import { View, Text, StyleSheet, ActivityIndicator, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '../../theme/colors';
import { supabase } from '../../lib/supabase';

const palette = {
  primary: colors.primary,
  primarySoft: colors.background,
  ink: colors.text,
  inkMuted: colors.textLight,
  surface: colors.white,
  canvas: colors.background,
  success: colors.green,
};

// The actual plan upgrade never happens the instant Paystack redirects
// back here — it happens when the webhook fires, which is usually fast
// (seconds) but never instant. Trusting the redirect alone and assuming
// success immediately would be exactly the insecure shortcut the whole
// webhook setup exists to avoid. So this screen exists purely to poll
// profiles.plan for real, until it actually changes.
const POLL_INTERVAL_MS = 2000;
const MAX_ATTEMPTS = 30; // ~60 seconds before giving up and saying so

export default function ConfirmingPaymentScreen({ navigation, route }) {
  const targetPlan = route.params?.plan || null;
  const [status, setStatus] = useState('confirming'); // 'confirming' | 'success' | 'timeout'
  const attemptsRef = useRef(0);
  const pollRef = useRef(null);
  // Paystack's redirect is a real full-page reload, so by the time this
  // screen mounts the entire in-memory navigation stack is gone — there's
  // no "came from HostDashboard vs AttendeeDashboard" context left to fall
  // back on. Upgrade is reachable from both (Profile, CreateSession,
  // Community, and an in-session upsell), so the role has to be looked up
  // fresh here rather than assumed, or an attendee landing on this screen
  // would get reset into a host dashboard they can't actually use.
  const roleRef = useRef(null);

  useEffect(() => {
    const poll = async () => {
      attemptsRef.current += 1;
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return;

        const { data: profile } = await supabase
          .from('profiles').select('plan, role').eq('id', user.id).maybeSingle();
        roleRef.current = profile?.role || roleRef.current;

        // Accept any real upgrade away from free as success, not only an
        // exact match to targetPlan — if the webhook and this screen
        // ever disagree on the exact tier for some edge-case reason,
        // still confirming that *a* paid plan landed matters more than
        // being pedantic about which one.
        if (profile?.plan && profile.plan !== 'free') {
          setStatus('success');
          clearInterval(pollRef.current);
          return;
        }
      } catch (e) {
        // Transient errors just get retried on the next tick — no need
        // to surface a network hiccup as a payment failure.
      }

      if (attemptsRef.current >= MAX_ATTEMPTS) {
        setStatus('timeout');
        clearInterval(pollRef.current);
      }
    };

    poll(); // check immediately, don't wait a full interval for the first attempt
    pollRef.current = setInterval(poll, POLL_INTERVAL_MS);
    return () => clearInterval(pollRef.current);
  }, []);

  const goToProfile = () => {
    // Rebuild the stack as [Dashboard, Profile] rather than resetting to
    // Profile alone — a bare [Profile] stack leaves nothing for back
    // navigation (hardware/browser back, or an in-app back arrow) to land
    // on. Defaults to HostDashboard if the role lookup above never
    // resolved (e.g. every poll attempt hit a transient error) — hosts are
    // still the more common path into checkout, and either dashboard beats
    // a dead-end back button.
    const dashboardRoute = roleRef.current === 'attendee' ? 'AttendeeDashboard' : 'HostDashboard';
    navigation.reset({ index: 1, routes: [{ name: dashboardRoute }, { name: 'Profile' }] });
  };

  return (
    <View style={styles.container}>
      {status === 'confirming' && (
        <>
          <ActivityIndicator size="large" color={palette.primary} />
          <Text style={styles.title}>Confirming your payment…</Text>
          <Text style={styles.subtitle}>This usually takes just a few seconds.</Text>
        </>
      )}

      {status === 'success' && (
        <>
          <View style={styles.successIconWrap}>
            <Ionicons name="checkmark" size={36} color={palette.surface} />
          </View>
          <Text style={styles.title}>
            {targetPlan ? `You're on ${targetPlan[0].toUpperCase()}${targetPlan.slice(1)}!` : "You're upgraded!"}
          </Text>
          <Text style={styles.subtitle}>Thanks for supporting Kesher.</Text>
          <TouchableOpacity style={styles.btn} onPress={goToProfile} activeOpacity={0.85}>
            <Text style={styles.btnText}>Continue</Text>
          </TouchableOpacity>
        </>
      )}

      {status === 'timeout' && (
        <>
          <Ionicons name="time-outline" size={36} color={palette.inkMuted} />
          <Text style={styles.title}>Still processing</Text>
          <Text style={styles.subtitle}>
            Your payment may have gone through — this is just taking longer than usual to confirm.
            We'll update your plan automatically once it's done; no need to pay again.
          </Text>
          <TouchableOpacity style={styles.btn} onPress={goToProfile} activeOpacity={0.85}>
            <Text style={styles.btnText}>Continue to Kesher</Text>
          </TouchableOpacity>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: palette.canvas, alignItems: 'center', justifyContent: 'center', padding: 32, gap: 12 },
  title: { fontSize: 20, fontWeight: '800', color: palette.ink, textAlign: 'center', marginTop: 8 },
  subtitle: { fontSize: 14, color: palette.inkMuted, textAlign: 'center', lineHeight: 20, maxWidth: 320 },
  successIconWrap: { width: 64, height: 64, borderRadius: 32, backgroundColor: palette.success, alignItems: 'center', justifyContent: 'center' },
  btn: { backgroundColor: palette.primary, paddingHorizontal: 28, paddingVertical: 14, borderRadius: 14, marginTop: 12 },
  btnText: { color: palette.surface, fontSize: 15, fontWeight: '800' },
});
