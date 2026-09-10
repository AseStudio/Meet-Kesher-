import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, ActivityIndicator, Platform, Linking } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '../../theme/colors';
import { supabase } from '../../lib/supabase';
import { showAlert } from '../../lib/alert';
import { PLANS } from '../../lib/constants';

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
  premiumSoft: '#F1E8FE',
  premiumDeep: '#4C1D95',
};

const cardShadow = Platform.select({
  ios: { shadowColor: '#2A1A6B', shadowOffset: { width: 0, height: 6 }, shadowOpacity: 0.08, shadowRadius: 14 },
  android: { elevation: 3 },
  default: { boxShadow: '0 6px 18px rgba(42,26,107,0.08)' },
});

const premiumShadow = Platform.select({
  ios: { shadowColor: palette.premiumDeep, shadowOffset: { width: 0, height: 10 }, shadowOpacity: 0.3, shadowRadius: 20 },
  android: { elevation: 8 },
  default: { boxShadow: '0 10px 26px rgba(76,29,149,0.3)' },
});

// Plan pricing/limits now live in src/lib/constants.js — this screen and
// CreateSession both import the same table so they can never drift out of
// sync with the SQL (plan_host_minutes / plan_recording_minutes functions)
// that enforces the minute numbers server-side.

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

    // window.open only reliably counts as "user-initiated" when it runs
    // synchronously inside the tap handler. Open the tab right now, before
    // the await, and redirect that already-open tab once the real checkout
    // URL comes back — otherwise Chrome silently hands back a blank tab.
    let checkoutTab = null;
    if (Platform.OS === 'web') {
      checkoutTab = window.open('', '_blank');
    }

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
        if (checkoutTab) {
          checkoutTab.location.href = data.url;
        } else {
          // The synchronous open() above got blocked anyway (e.g. popup
          // blocker set to "always ask") — fall back to a direct attempt.
          window.open(data.url, '_blank');
        }
      } else {
        await Linking.openURL(data.url);
      }
    } catch (e) {
      if (checkoutTab) checkoutTab.close();
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
        <View style={{ width: 32 }} />
      </View>

      <ScrollView contentContainerStyle={styles.scroll}>
        <Text style={styles.heroTitle}>Choose your plan</Text>
        <Text style={styles.heroSubtitle}>More minutes, more room, no ads — upgrade any time.</Text>

        {PLANS.map((p) => {
          const isCurrent = currentPlan === p.key;
          const isFree = p.key === 'free';
          const isPremium = p.key === 'premium';

          const featureRows = (
            <>
              <FeatureRow dark={isPremium} icon="videocam-outline" text={`${p.hostMinutes} hosting minutes/mo`} />
              <FeatureRow
                dark={isPremium}
                icon="radio-button-on"
                text={p.recordingMinutes > 0 ? `${p.recordingMinutes} recording minutes/mo` : 'No recording'}
                muted={p.recordingMinutes === 0}
              />
              <FeatureRow dark={isPremium} icon="people-outline" text={`${p.maxAttendees} attendees per session`} />
              <FeatureRow dark={isPremium} icon="calendar-outline" text={`Attend: ${p.attendCap}`} />
              <FeatureRow dark={isPremium} icon={isFree ? 'megaphone-outline' : 'checkmark-circle'} text={isFree ? 'Ads in your feed' : 'No ads in your feed'} highlight={!isFree && !isPremium} />
              {!isFree && <FeatureRow dark={isPremium} icon="repeat-outline" text="Unused minutes roll over monthly" highlight={!isPremium} />}
            </>
          );

          // Premium gets the full gradient "flagship" treatment — every
          // other tier shares one plain card shell, differentiated only
          // by a border accent and (for Max) a POPULAR ribbon. Reusing
          // one shell for three tiers instead of writing four bespoke
          // layouts keeps this maintainable if the tiers ever change.
          if (isPremium) {
            return (
              <View key={p.key} style={[styles.premiumWrap, premiumShadow]}>
                {isCurrent && (
                  <View style={styles.currentBadgePremium}>
                    <Text style={styles.currentBadgePremiumText}>Current plan</Text>
                  </View>
                )}
                <LinearGradient
                  colors={[palette.premium, palette.premiumDeep]}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 1 }}
                  style={styles.premiumCard}
                >
                  <View style={styles.premiumHeaderRow}>
                    <Ionicons name="sparkles" size={18} color="rgba(255,255,255,0.9)" />
                    <Text style={styles.premiumTagline}>{p.tagline}</Text>
                  </View>
                  <Text style={styles.premiumName}>{p.name}</Text>
                  <View style={styles.priceRow}>
                    <Text style={styles.premiumPrice}>{p.price}</Text>
                    <Text style={styles.premiumPriceSuffix}>/mo</Text>
                  </View>

                  <View style={styles.featureList}>{featureRows}</View>

                  {!isCurrent && (
                    <TouchableOpacity
                      style={styles.premiumBtn}
                      onPress={() => startCheckout(p.key)}
                      disabled={checkingOutPlan !== null}
                      activeOpacity={0.85}
                    >
                      {checkingOutPlan === p.key
                        ? <ActivityIndicator color={palette.premiumDeep} />
                        : (
                          <>
                            <Text style={styles.premiumBtnText}>Upgrade to Premium</Text>
                            <Ionicons name="arrow-forward" size={15} color={palette.premiumDeep} />
                          </>
                        )
                      }
                    </TouchableOpacity>
                  )}
                </LinearGradient>
              </View>
            );
          }

          return (
            <View key={p.key} style={[styles.card, cardShadow, isCurrent && styles.cardCurrent, p.badge && styles.cardBadged]}>
              {p.badge && !isCurrent && (
                <View style={styles.popularRibbon}>
                  <Text style={styles.popularRibbonText}>{p.badge}</Text>
                </View>
              )}
              <View style={styles.cardHeader}>
                <View>
                  <Text style={styles.planTagline}>{p.tagline}</Text>
                  <Text style={styles.planName}>{p.name}</Text>
                  <View style={styles.priceRow}>
                    <Text style={styles.planPrice}>{p.price}</Text>
                    {!isFree && <Text style={styles.planPriceSuffix}>/mo</Text>}
                  </View>
                </View>
                {isCurrent && (
                  <View style={styles.currentBadge}>
                    <Text style={styles.currentBadgeText}>Current</Text>
                  </View>
                )}
              </View>

              <View style={styles.featureList}>{featureRows}</View>

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

        <View style={styles.footNoteRow}>
          <Ionicons name="shield-checkmark-outline" size={13} color={palette.neutralText} />
          <Text style={styles.footNote}>Payments processed by Paystack. Plans renew monthly and can be changed any time.</Text>
        </View>
      </ScrollView>
    </View>
  );
}

function FeatureRow({ icon, text, muted, highlight, dark }) {
  const color = dark
    ? 'rgba(255,255,255,0.95)'
    : highlight ? palette.premium : muted ? palette.neutralText : palette.primary;
  return (
    <View style={styles.featureRow}>
      <View style={[styles.featureIconWrap, dark && styles.featureIconWrapDark]}>
        <Ionicons name={icon} size={13} color={color} />
      </View>
      <Text style={[
        styles.featureText,
        dark && styles.featureTextDark,
        muted && !dark && styles.featureTextMuted,
        highlight && !dark && styles.featureTextHighlight,
      ]}>
        {text}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: palette.canvas },
  loadingContainer: { flex: 1, backgroundColor: palette.canvas, alignItems: 'center', justifyContent: 'center' },
  topRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingTop: 54, paddingBottom: 4,
  },
  backBtn: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center' },

  scroll: { paddingHorizontal: 18, paddingBottom: 36 },
  heroTitle: { fontSize: 26, fontWeight: '800', color: palette.ink, letterSpacing: -0.5, marginTop: 6 },
  heroSubtitle: { fontSize: 13.5, color: palette.inkMuted, fontWeight: '500', marginTop: 6, marginBottom: 22, lineHeight: 19 },

  card: { backgroundColor: palette.surface, borderRadius: 20, padding: 20, borderWidth: 1.5, borderColor: palette.line, marginBottom: 14 },
  cardCurrent: { borderColor: palette.primary },
  cardBadged: { borderColor: palette.primary, borderWidth: 1.5 },
  popularRibbon: { position: 'absolute', top: -1, right: 18, backgroundColor: palette.primary, paddingHorizontal: 12, paddingVertical: 5, borderBottomLeftRadius: 10, borderBottomRightRadius: 10 },
  popularRibbonText: { color: palette.surface, fontSize: 10, fontWeight: '800', letterSpacing: 0.5 },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 },
  planTagline: { fontSize: 11.5, color: palette.neutralText, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 3 },
  planName: { fontSize: 21, fontWeight: '800', color: palette.ink, letterSpacing: -0.3 },
  priceRow: { flexDirection: 'row', alignItems: 'flex-end', marginTop: 4, gap: 3 },
  planPrice: { fontSize: 26, fontWeight: '800', color: palette.ink, letterSpacing: -0.5 },
  planPriceSuffix: { fontSize: 13, color: palette.inkMuted, fontWeight: '600', marginBottom: 3 },
  currentBadge: { backgroundColor: palette.primarySoft, borderRadius: 10, paddingHorizontal: 10, paddingVertical: 5 },
  currentBadgeText: { fontSize: 11, fontWeight: '700', color: palette.primary },

  featureList: { gap: 11, marginBottom: 6 },
  featureRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  featureIconWrap: { width: 22, height: 22, borderRadius: 7, backgroundColor: palette.primarySoft, alignItems: 'center', justifyContent: 'center' },
  featureIconWrapDark: { backgroundColor: 'rgba(255,255,255,0.16)' },
  featureText: { fontSize: 13.5, color: palette.ink, fontWeight: '500' },
  featureTextDark: { color: 'rgba(255,255,255,0.95)' },
  featureTextMuted: { color: palette.neutralText },
  featureTextHighlight: { color: palette.premium, fontWeight: '700' },

  upgradeBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: palette.primary, borderRadius: 14, paddingVertical: 15, marginTop: 14,
  },
  upgradeBtnText: { color: palette.surface, fontSize: 14.5, fontWeight: '800' },

  // ── Premium — the one flagship-treatment card ──
  premiumWrap: { borderRadius: 22, marginBottom: 14 },
  premiumCard: { borderRadius: 22, padding: 20 },
  premiumHeaderRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 10 },
  premiumTagline: { fontSize: 11.5, color: 'rgba(255,255,255,0.85)', fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.4 },
  premiumName: { fontSize: 22, fontWeight: '800', color: palette.surface, letterSpacing: -0.3 },
  premiumPrice: { fontSize: 28, fontWeight: '800', color: palette.surface, letterSpacing: -0.5 },
  premiumPriceSuffix: { fontSize: 13.5, color: 'rgba(255,255,255,0.8)', fontWeight: '600', marginBottom: 4 },
  currentBadgePremium: { position: 'absolute', top: 14, right: 14, zIndex: 5, backgroundColor: 'rgba(255,255,255,0.2)', borderRadius: 10, paddingHorizontal: 10, paddingVertical: 5 },
  currentBadgePremiumText: { fontSize: 11, fontWeight: '700', color: palette.surface },
  premiumBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: palette.surface, borderRadius: 14, paddingVertical: 15, marginTop: 14,
  },
  premiumBtnText: { color: palette.premiumDeep, fontSize: 14.5, fontWeight: '800' },

  footNoteRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 6, marginTop: 8, paddingHorizontal: 6 },
  footNote: { flex: 1, fontSize: 11.5, color: palette.neutralText, fontWeight: '500', lineHeight: 16 },
});
