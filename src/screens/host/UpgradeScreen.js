import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, ActivityIndicator, Platform, Linking } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '../../theme/colors';
import { supabase } from '../../lib/supabase';
import { showAlert } from '../../lib/alert';

const palette = {
  primary: colors.primary,
  primaryDeep: colors.primaryDark,
  primarySoft: colors.background,
  ink: colors.text,
  inkMuted: colors.textLight,
  surface: colors.white,
  canvas: colors.background,
  line: colors.greyLight,
  neutralText: colors.grey,
  premium: '#7C3AED',
};

// Same table established earlier — kept in one place so this screen and
// any future usage-display work never drift out of sync with the SQL
// (plan_host_minutes / plan_recording_minutes functions) that actually
// enforces these numbers server-side.
const PLANS = [
  { key: 'free', name: 'Free', price: '$0', hostMinutes: 30, recordingMinutes: 0, maxAttendees: 20, attendCap: '3 sessions/mo' },
  { key: 'pro', name: 'Pro', price: '$4.99/mo', hostMinutes: 90, recordingMinutes: 30, maxAttendees: 30, attendCap: '5 sessions/mo' },
  { key: 'max', name: 'Max', price: '$8.99/mo', hostMinutes: 180, recordingMinutes: 60, maxAttendees: 40, attendCap: '10 sessions/mo' },
  { key: 'premium', name: 'Premium', price: '$15.99/mo', hostMinutes: 540, recordingMinutes: 180, maxAttendees: 50, attendCap: '20 sessions/mo' },
];

export default function UpgradeScreen({ navigation }) {
  const [currentPlan, setCurrentPlan] = useState('free');
  const [loading, setLoading] = useState(true);
  const [checkingOutPlan, setCheckingOutPlan] = useState(null);

  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { setLoading(false); return; }
      const { data } = await supabase.from('profiles').select('plan').eq('id', user.id).maybeSingle();
      setCurrentPlan(data?.plan || 'free');
      setLoading(false);
    })();
  }, []);

  const startCheckout = async (plan) => {
    setCheckingOutPlan(plan);
    try {
      const { data, error } = await supabase.functions.invoke('create-checkout', {
        body: { processor: 'paystack', plan },
      });

      if (error) {
        // supabase-js doesn't parse the response body into `data` when
        // the function returns a non-2xx status — the real message the
        // function sent back has to be pulled out of error.context (the
        // raw Response) by hand instead.
        let message = error.message;
        try {
          const body = await error.context.json();
          if (body?.error) message = body.error;
        } catch (e) {}
        throw new Error(message);
      }
      if (data?.error) throw new Error(data.error);

      if (Platform.OS === 'web') {
        window.open(data.url, '_blank');
      } else {
        await Linking.openURL(data.url);
      }
    } catch (e) {
      showAlert('Could not start checkout', e.message || 'Please try again.');
    } finally {
      setCheckingOutPlan(null);
    }
  };

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color={palette.primary} />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.topRow}>
        <TouchableOpacity onPress={() => navigation.goBack()} activeOpacity={0.7} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={20} color={palette.ink} />
        </TouchableOpacity>
        <Text style={styles.title}>Plans</Text>
        <View style={{ width: 32 }} />
      </View>

      <ScrollView contentContainerStyle={styles.scroll}>
        {PLANS.map((p) => {
          const isCurrent = currentPlan === p.key;
          const isFree = p.key === 'free';
          return (
            <View key={p.key} style={[styles.card, isCurrent && styles.cardCurrent]}>
              <View style={styles.cardHeader}>
                <View>
                  <Text style={styles.planName}>{p.name}</Text>
                  <Text style={styles.planPrice}>{p.price}</Text>
                </View>
                {isCurrent && (
                  <View style={styles.currentBadge}>
                    <Text style={styles.currentBadgeText}>Current plan</Text>
                  </View>
                )}
              </View>

              <View style={styles.featureList}>
                <FeatureRow icon="videocam-outline" text={`${p.hostMinutes} hosting minutes/mo`} />
                <FeatureRow
                  icon="radio-button-on"
                  text={p.recordingMinutes > 0 ? `${p.recordingMinutes} recording minutes/mo` : 'No recording'}
                  muted={p.recordingMinutes === 0}
                />
                <FeatureRow icon="people-outline" text={`${p.maxAttendees} attendees per session`} />
                <FeatureRow icon="calendar-outline" text={`Attend: ${p.attendCap}`} />
                <FeatureRow icon={isFree ? 'megaphone-outline' : 'checkmark-circle'} text={isFree ? 'Ads in your feed' : 'No ads in your feed'} highlight={!isFree} />
                {!isFree && <FeatureRow icon="repeat-outline" text="Unused minutes roll over monthly" highlight />}
              </View>

              {!isFree && !isCurrent && (
                <TouchableOpacity
                  style={styles.upgradeBtn}
                  onPress={() => startCheckout(p.key)}
                  disabled={checkingOutPlan !== null}
                  activeOpacity={0.85}
                >
                  {checkingOutPlan === p.key
                    ? <ActivityIndicator color={palette.surface} />
                    : (
                      <>
                        <Text style={styles.upgradeBtnText}>Upgrade to {p.name}</Text>
                        <Ionicons name="arrow-forward" size={15} color={palette.surface} />
                      </>
                    )
                  }
                </TouchableOpacity>
              )}
            </View>
          );
        })}

        <Text style={styles.footNote}>
          Payments processed by Paystack. Plans renew monthly and can be changed at any time.
        </Text>
      </ScrollView>
    </View>
  );
}

function FeatureRow({ icon, text, muted, highlight }) {
  return (
    <View style={styles.featureRow}>
      <Ionicons name={icon} size={15} color={highlight ? palette.premium : muted ? palette.neutralText : palette.primary} />
      <Text style={[styles.featureText, muted && styles.featureTextMuted, highlight && styles.featureTextHighlight]}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: palette.canvas },
  loadingContainer: { flex: 1, backgroundColor: palette.canvas, alignItems: 'center', justifyContent: 'center' },
  topRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingTop: 54, paddingBottom: 14,
  },
  backBtn: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 17, fontWeight: '800', color: palette.ink },

  scroll: { paddingHorizontal: 16, paddingBottom: 30, gap: 14 },
  card: { backgroundColor: palette.surface, borderRadius: 18, padding: 18, borderWidth: 1.5, borderColor: palette.line },
  cardCurrent: { borderColor: palette.primary },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 14 },
  planName: { fontSize: 19, fontWeight: '800', color: palette.ink },
  planPrice: { fontSize: 14, color: palette.inkMuted, fontWeight: '600', marginTop: 2 },
  currentBadge: { backgroundColor: palette.primarySoft, borderRadius: 10, paddingHorizontal: 10, paddingVertical: 5 },
  currentBadgeText: { fontSize: 11, fontWeight: '700', color: palette.primary },

  featureList: { gap: 9, marginBottom: 6 },
  featureRow: { flexDirection: 'row', alignItems: 'center', gap: 9 },
  featureText: { fontSize: 13.5, color: palette.ink, fontWeight: '500' },
  featureTextMuted: { color: palette.neutralText },
  featureTextHighlight: { color: palette.premium, fontWeight: '700' },

  upgradeBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: palette.primary, borderRadius: 13, paddingVertical: 14, marginTop: 12,
  },
  upgradeBtnText: { color: palette.surface, fontSize: 14.5, fontWeight: '800' },

  footNote: { fontSize: 11.5, color: palette.neutralText, textAlign: 'center', marginTop: 6, paddingHorizontal: 10, lineHeight: 16 },
});
