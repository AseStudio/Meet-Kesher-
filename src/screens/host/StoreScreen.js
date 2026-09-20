import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, ActivityIndicator, Platform, Linking, useWindowDimensions } from 'react-native';
import Slider from '@react-native-community/slider';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '../../theme/colors';
import { supabase } from '../../lib/supabase';
import { showAlert } from '../../lib/alert';
import {
  MINUTE_PACKS,
  PARTICIPANT_MINUTE_RATE_CEDIS,
  PARTICIPANT_MINUTE_SLIDER_MIN,
  PARTICIPANT_MINUTE_SLIDER_MAX,
  PARTICIPANT_MINUTE_SLIDER_STEP,
} from '../../lib/constants';

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
};

const cardShadow = Platform.select({
  ios: { shadowColor: '#2A1A6B', shadowOffset: { width: 0, height: 6 }, shadowOpacity: 0.08, shadowRadius: 14 },
  android: { elevation: 3 },
  default: { boxShadow: '0 6px 18px rgba(42,26,107,0.08)' },
});

// Smallest-to-largest regardless of declaration order in constants.js —
// a predictable ascending ladder, matching the reference design.
const SORTED_PACKS = [...MINUTE_PACKS].sort((a, b) => a.minutes - b.minutes);

function formatHours(minutes) {
  const hours = minutes / 60;
  return `≈ ${hours} hour${hours === 1 ? '' : 's'}`;
}

function formatDuration(minutes) {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${h}h ${m}m`;
}

export default function StoreScreen({ navigation }) {
  const [balance, setBalance] = useState(0);
  const [loading, setLoading] = useState(true);
  const [buyingId, setBuyingId] = useState(null);
  const [sliderMinutes, setSliderMinutes] = useState(100);
  const { width } = useWindowDimensions();
  const wide = width >= 700;

  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { setLoading(false); return; }
      const { data } = await supabase.from('profiles').select('participant_minutes_balance').eq('id', user.id).maybeSingle();
      setBalance(data?.participant_minutes_balance ?? 0);
      setLoading(false);
    })();
  }, []);

  const buy = async (body, id) => {
    setBuyingId(id);

    // Same "open the tab before the await" trick as UpgradeScreen —
    // window.open only counts as user-initiated inside the synchronous
    // tap handler, so the tab has to already be open before we know
    // the real checkout URL.
    let checkoutTab = null;
    if (Platform.OS === 'web') {
      checkoutTab = window.open('', '_blank');
    }

    try {
      const { data, error } = await supabase.functions.invoke('buy-minutes', { body });

      if (error) {
        let message = error.message;
        try {
          const errBody = await error.context.json();
          if (errBody?.error) message = errBody.error;
        } catch (e) {}
        throw new Error(message);
      }
      if (data?.error) throw new Error(data.error);

      if (Platform.OS === 'web') {
        if (checkoutTab) {
          checkoutTab.location.href = data.url;
        } else {
          window.open(data.url, '_blank');
        }
      } else {
        await Linking.openURL(data.url);
      }
    } catch (e) {
      if (checkoutTab) checkoutTab.close();
      showAlert('Could not start checkout', e.message || 'Please try again.');
    } finally {
      setBuyingId(null);
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
        <TouchableOpacity onPress={() => navigation.goBack()} activeOpacity={0.7} style={styles.backRow}>
          <Ionicons name="chevron-back" size={20} color={palette.ink} />
          <Text style={styles.backText}>Back</Text>
        </TouchableOpacity>
        <Text style={styles.topTitle}>Participant Minutes</Text>
        <View style={{ width: 60 }} />
      </View>

      <ScrollView contentContainerStyle={styles.scroll}>

        {/* ── Hero intro ── */}
        <View style={styles.heroRow}>
          <View style={styles.heroIconBadge}>
            <Ionicons name="people" size={26} color={palette.primary} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.heroTitle}>Participant Minutes</Text>
            <Text style={styles.heroSubtitle}>Use Participant Minutes when joining and participating in meetings.</Text>
          </View>
        </View>

        {/* ── Balance card ── */}
        <LinearGradient
          colors={['#EFEAFE', '#E4DBFC']}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.balanceCard}
        >
          <View style={styles.balanceHeaderRow}>
            <View style={styles.balanceIconCircle}>
              <Ionicons name="time" size={16} color={palette.surface} />
            </View>
            <Text style={styles.balanceLabel}>Your Participant Balance</Text>
          </View>
          <Text style={styles.balanceNumber}>{balance.toLocaleString()}</Text>
          <Text style={styles.balanceSub}>Participant Minutes</Text>
          <View style={styles.balanceApproxRow}>
            <Ionicons name="time-outline" size={13} color={palette.primaryDeep} />
            <Text style={styles.balanceApproxText}>≈ {formatDuration(balance)} of participation</Text>
          </View>

          <View style={styles.balanceDecoration} pointerEvents="none">
            <Ionicons name="people-circle" size={68} color="rgba(91,46,255,0.14)" />
            <Ionicons name="time" size={30} color="rgba(91,46,255,0.22)" style={styles.balanceDecorationClock} />
          </View>
        </LinearGradient>

        {/* ── Custom amount slider ── */}
        <View style={styles.sliderCard}>
          <Text style={styles.sliderLabel}>Or choose your own amount</Text>
          <View style={styles.sliderTopRow}>
            <Text style={styles.sliderAmount}>{sliderMinutes.toLocaleString()} min</Text>
            <Text style={styles.sliderHours}>≈ {formatDuration(sliderMinutes)}</Text>
          </View>
          <Slider
            style={styles.slider}
            minimumValue={PARTICIPANT_MINUTE_SLIDER_MIN}
            maximumValue={PARTICIPANT_MINUTE_SLIDER_MAX}
            step={PARTICIPANT_MINUTE_SLIDER_STEP}
            value={sliderMinutes}
            onValueChange={setSliderMinutes}
            minimumTrackTintColor={palette.primary}
            maximumTrackTintColor={palette.line}
            thumbTintColor={palette.primary}
          />
          <View style={styles.packBottomRow}>
            <Text style={styles.packPrice}>GH¢{(sliderMinutes * PARTICIPANT_MINUTE_RATE_CEDIS).toFixed(2)}</Text>
            <TouchableOpacity
              style={[styles.buyNowBtn, buyingId === 'custom' && { opacity: 0.6 }]}
              onPress={() => buy({ customMinutes: sliderMinutes }, 'custom')}
              disabled={buyingId !== null}
              activeOpacity={0.85}
            >
              {buyingId === 'custom'
                ? <ActivityIndicator size="small" color={palette.surface} />
                : <Text style={styles.buyNowText}>Buy Now</Text>
              }
            </TouchableOpacity>
          </View>
        </View>

        {/* ── Packs ── */}
        <Text style={styles.sectionTitle}>Choose a minute pack</Text>
        <View style={styles.packsGrid}>
          {SORTED_PACKS.map((pack) => (
            <View
              key={pack.id}
              style={[
                wide ? styles.packCardWide : styles.packCardNarrow,
                pack.badge && styles.packCardHighlighted,
              ]}
            >
              {pack.badge && (
                <View style={[styles.badgePill, pack.badge === 'POPULAR' && styles.badgePillPrimary]}>
                  <Text style={[styles.badgeText, pack.badge === 'POPULAR' && styles.badgeTextPrimary]}>{pack.badge}</Text>
                </View>
              )}
              <View style={styles.packTopRow}>
                <View style={styles.packIconCircle}>
                  <Ionicons name="time-outline" size={16} color={palette.primary} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.packMinutesLabel}>
                    <Text style={styles.packMinutesNum}>{pack.minutes.toLocaleString()}</Text> Participant Minutes
                  </Text>
                  <Text style={styles.packHoursLabel}>{formatHours(pack.minutes)}</Text>
                </View>
              </View>
              <View style={styles.packBottomRow}>
                <Text style={styles.packPrice}>GH¢{pack.priceCedis.toLocaleString()}</Text>
                <TouchableOpacity
                  style={[styles.buyNowBtn, buyingId === pack.id && { opacity: 0.6 }]}
                  onPress={() => buy({ packId: pack.id }, pack.id)}
                  disabled={buyingId !== null}
                  activeOpacity={0.85}
                >
                  {buyingId === pack.id
                    ? <ActivityIndicator size="small" color={palette.surface} />
                    : <Text style={styles.buyNowText}>Buy Now</Text>
                  }
                </TouchableOpacity>
              </View>
            </View>
          ))}
        </View>

        {/* ── Rate banner ── */}
        <View style={styles.rateBanner}>
          <Ionicons name="cash-outline" size={17} color={palette.primaryDeep} />
          <View>
            <Text style={styles.rateBannerText}>
              1 Participant Minute = <Text style={styles.rateBannerBold}>GH¢{PARTICIPANT_MINUTE_RATE_CEDIS}</Text>
            </Text>
            <Text style={styles.rateBannerSub}>(approximate rate)</Text>
          </View>
        </View>

        {/* ── How it works ── */}
        <View style={styles.howCard}>
          <Text style={styles.howTitle}>How Participant Minutes Work</Text>
          <View style={[styles.howRow, wide && styles.howRowWide]}>
            <View style={[styles.howCol, wide && styles.howColWide]}>
              <Ionicons name="people-outline" size={19} color={palette.primary} />
              <Text style={styles.howColTitle}>It's based on participation</Text>
              <Text style={styles.howColText}>Participant Minutes are calculated by multiplying the meeting duration by the number of participants.</Text>
            </View>
            <View style={[styles.howCol, wide && styles.howColWide]}>
              <Ionicons name="calculator-outline" size={19} color={palette.primary} />
              <Text style={styles.howColTitle}>Example</Text>
              <Text style={styles.howColText}>30 min meeting × 5 participants{'\n'}= 150 Participant Minutes</Text>
            </View>
            <View style={[styles.howCol, wide && styles.howColWide]}>
              <Ionicons name="information-circle-outline" size={19} color={palette.primary} />
              <Text style={styles.howColTitle}>Not the same as Hosting Minutes</Text>
              <Text style={styles.howColText}>Hosting Minutes determine how long you can host a session. They are not deducted from your Participant Minute balance.</Text>
            </View>
          </View>
        </View>

        {/* ── Bottom info bar ── */}
        <View style={styles.infoBar}>
          <Ionicons name="information-circle" size={16} color={palette.primaryDeep} />
          <Text style={styles.infoBarText}>Participant Minutes are used based on participation in meetings.</Text>
        </View>

        <Text style={styles.footNote}>Payments processed by Paystack — card or Mobile Money.</Text>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: palette.canvas },
  loadingContainer: { flex: 1, backgroundColor: palette.canvas, alignItems: 'center', justifyContent: 'center' },
  topRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 18, paddingTop: 14, paddingBottom: 6,
  },
  backRow: { flexDirection: 'row', alignItems: 'center', width: 70 },
  backText: { fontSize: 15, fontWeight: '700', color: palette.ink, marginLeft: 2 },
  topTitle: { fontSize: 16, fontWeight: '800', color: palette.ink },
  scroll: { paddingHorizontal: 18, paddingBottom: 40 },

  // ── Hero ──
  heroRow: { flexDirection: 'row', gap: 14, alignItems: 'flex-start', marginTop: 14, marginBottom: 20 },
  heroIconBadge: {
    width: 52, height: 52, borderRadius: 15, backgroundColor: palette.primarySoft,
    alignItems: 'center', justifyContent: 'center',
  },
  heroTitle: { fontSize: 21, fontWeight: '800', color: palette.ink, letterSpacing: -0.3, marginBottom: 4 },
  heroSubtitle: { fontSize: 13, color: palette.inkMuted, fontWeight: '500', lineHeight: 18 },

  // ── Balance card ──
  balanceCard: { borderRadius: 20, padding: 20, marginBottom: 26, overflow: 'hidden' },
  balanceHeaderRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 12 },
  balanceIconCircle: {
    width: 26, height: 26, borderRadius: 13, backgroundColor: palette.primary,
    alignItems: 'center', justifyContent: 'center',
  },
  balanceLabel: { fontSize: 13, fontWeight: '700', color: palette.ink },
  balanceNumber: { fontSize: 40, fontWeight: '800', color: palette.primaryDeep, letterSpacing: -1 },
  balanceSub: { fontSize: 14, fontWeight: '600', color: palette.inkMuted, marginTop: 2, marginBottom: 10 },
  balanceApproxRow: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  balanceApproxText: { fontSize: 12.5, fontWeight: '600', color: palette.primaryDeep },
  balanceDecoration: {
    position: 'absolute', right: 14, bottom: 14, alignItems: 'center', justifyContent: 'center',
  },
  balanceDecorationClock: { position: 'absolute', right: -6, bottom: -4 },

  // ── Custom slider ──
  sliderCard: {
    backgroundColor: palette.surface, borderRadius: 18, padding: 18, marginBottom: 22,
    borderWidth: 1, borderColor: palette.line, ...cardShadow,
  },
  sliderLabel: { fontSize: 13, fontWeight: '700', color: palette.inkMuted, marginBottom: 10 },
  sliderTopRow: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 2 },
  sliderAmount: { fontSize: 22, fontWeight: '800', color: palette.ink },
  sliderHours: { fontSize: 12.5, fontWeight: '600', color: palette.primaryDeep },
  slider: { width: '100%', height: 36, marginBottom: 4 },

  // ── Packs ──
  sectionTitle: { fontSize: 17, fontWeight: '800', color: palette.ink, marginBottom: 12 },
  packsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginBottom: 22 },
  packCardNarrow: {
    width: '48%', backgroundColor: palette.surface, borderRadius: 16, padding: 14,
    borderWidth: 1.5, borderColor: palette.line, ...cardShadow,
  },
  packCardWide: {
    width: '48.5%', backgroundColor: palette.surface, borderRadius: 16, padding: 16,
    borderWidth: 1.5, borderColor: palette.line, ...cardShadow,
  },
  packCardHighlighted: { borderColor: palette.primary },
  badgePill: {
    position: 'absolute', top: -10, right: 12, backgroundColor: palette.primarySoft,
    paddingHorizontal: 9, paddingVertical: 3, borderRadius: 20,
  },
  badgePillPrimary: { backgroundColor: palette.primary },
  badgeText: { fontSize: 9.5, fontWeight: '800', color: palette.primaryDeep, letterSpacing: 0.3 },
  badgeTextPrimary: { color: palette.surface },
  packTopRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 9, marginBottom: 14 },
  packIconCircle: {
    width: 30, height: 30, borderRadius: 15, backgroundColor: palette.primarySoft,
    alignItems: 'center', justifyContent: 'center', marginTop: 1,
  },
  packMinutesLabel: { fontSize: 12.5, fontWeight: '700', color: palette.ink, lineHeight: 17 },
  packMinutesNum: { fontSize: 14.5, fontWeight: '800' },
  packHoursLabel: { fontSize: 11.5, color: palette.inkMuted, fontWeight: '500', marginTop: 2 },
  packBottomRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  packPrice: { fontSize: 17, fontWeight: '800', color: palette.primaryDeep },
  buyNowBtn: {
    backgroundColor: palette.primary, paddingHorizontal: 16, paddingVertical: 8, borderRadius: 10,
    minWidth: 74, alignItems: 'center',
  },
  buyNowText: { color: palette.surface, fontWeight: '700', fontSize: 12.5 },

  // ── Rate banner ──
  rateBanner: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: palette.primarySoft, borderRadius: 14, padding: 14, marginBottom: 22,
  },
  rateBannerText: { fontSize: 13, fontWeight: '700', color: palette.ink },
  rateBannerBold: { color: palette.primaryDeep, fontWeight: '800' },
  rateBannerSub: { fontSize: 11, color: palette.inkMuted, fontWeight: '500', marginTop: 1 },

  // ── How it works ──
  howCard: {
    backgroundColor: palette.surface, borderRadius: 18, padding: 18, marginBottom: 16,
    borderWidth: 1, borderColor: palette.line,
  },
  howTitle: { fontSize: 15.5, fontWeight: '800', color: palette.ink, marginBottom: 16 },
  howRow: { gap: 18 },
  howRowWide: { flexDirection: 'row' },
  howCol: { gap: 6 },
  howColWide: { flex: 1 },
  howColTitle: { fontSize: 13, fontWeight: '700', color: palette.ink, marginTop: 2 },
  howColText: { fontSize: 12, color: palette.inkMuted, fontWeight: '500', lineHeight: 17 },

  // ── Bottom info bar ──
  infoBar: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: palette.primarySoft, borderRadius: 12, padding: 12, marginBottom: 14,
  },
  infoBarText: { flex: 1, fontSize: 11.5, color: palette.primaryDeep, fontWeight: '600' },

  footNote: { fontSize: 11, color: palette.neutralText, fontWeight: '500', textAlign: 'center', marginTop: 2 },
});