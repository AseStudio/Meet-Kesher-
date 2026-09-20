import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, ActivityIndicator, Platform, Linking } from 'react-native';
import Slider from '@react-native-community/slider';
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

// Packs sorted smallest-to-largest for display regardless of how
// they're ordered in constants.js — a predictable ascending price
// ladder reads better than an arbitrary order.
const SORTED_PACKS = [...MINUTE_PACKS].sort((a, b) => a.minutes - b.minutes);

function formatMinutesLabel(minutes) {
  if (minutes % 60 === 0) {
    const hours = minutes / 60;
    return `${hours} hour${hours === 1 ? '' : 's'}`;
  }
  return `${minutes} min`;
}

export default function StoreScreen({ navigation }) {
  const [balance, setBalance] = useState(null);
  const [loading, setLoading] = useState(true);
  const [sliderMinutes, setSliderMinutes] = useState(100);
  const [buyingId, setBuyingId] = useState(null); // packId, 'custom', or null

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

  const sliderPrice = (sliderMinutes * PARTICIPANT_MINUTE_RATE_CEDIS).toFixed(2);

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
        <Text style={styles.heroTitle}>Participant minutes</Text>
        <Text style={styles.heroSubtitle}>
          A separate balance from your hosting minutes — buy once, never expires.
        </Text>

        <View style={styles.explainerCard}>
          <Text style={styles.explainerTitle}>Hosting minutes vs. participant minutes</Text>
          <Text style={styles.explainerText}>
            <Text style={styles.explainerBold}>Hosting minutes</Text> control how long you can run a
            session as host, up to your plan's attendee cap — this is what your plan already includes
            every month.
          </Text>
          <Text style={[styles.explainerText, { marginTop: 8 }]}>
            <Text style={styles.explainerBold}>Participant minutes</Text> are the total minutes people
            actually spend in your sessions — a 20-minute session with 5 people uses 100 participant
            minutes. Buying them here tops up that separate balance permanently; it doesn't touch your
            plan or your hosting minutes at all.
          </Text>
        </View>

        <View style={styles.balanceCard}>
          <Ionicons name="flash" size={18} color={palette.primary} />
          <Text style={styles.balanceText}>{balance} participant minutes available</Text>
        </View>

        {/* ── Custom amount slider ── */}
        <View style={styles.sliderCard}>
          <Text style={styles.sliderLabel}>Choose your own amount</Text>
          <Text style={styles.sliderAmount}>{formatMinutesLabel(sliderMinutes)}</Text>
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
          <View style={styles.sliderFooter}>
            <Text style={styles.sliderPrice}>GHS {sliderPrice}</Text>
            <TouchableOpacity
              style={[styles.sliderBuyBtn, buyingId === 'custom' && { opacity: 0.6 }]}
              onPress={() => buy({ customMinutes: sliderMinutes }, 'custom')}
              disabled={buyingId !== null}
              activeOpacity={0.85}
            >
              {buyingId === 'custom' ? (
                <ActivityIndicator size="small" color={palette.surface} />
              ) : (
                <Text style={styles.sliderBuyBtnText}>Buy</Text>
              )}
            </TouchableOpacity>
          </View>
        </View>

        {/* ── Fixed packs ── */}
        <Text style={styles.packsHeading}>Or pick a pack</Text>
        <View style={styles.packsGrid}>
          {SORTED_PACKS.map((pack) => (
            <TouchableOpacity
              key={pack.id}
              style={[styles.packCard, buyingId === pack.id && { opacity: 0.6 }]}
              onPress={() => buy({ packId: pack.id }, pack.id)}
              disabled={buyingId !== null}
              activeOpacity={0.85}
            >
              {buyingId === pack.id ? (
                <ActivityIndicator size="small" color={palette.primary} />
              ) : (
                <>
                  <Text style={styles.packMinutes}>{formatMinutesLabel(pack.minutes)}</Text>
                  <Text style={styles.packPrice}>GHS {pack.priceCedis}</Text>
                </>
              )}
            </TouchableOpacity>
          ))}
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
    paddingHorizontal: 18, paddingTop: 14,
  },
  backBtn: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center' },
  scroll: { paddingHorizontal: 18, paddingBottom: 40 },

  heroTitle: { fontSize: 26, fontWeight: '800', color: palette.ink, letterSpacing: -0.5, marginTop: 6 },
  heroSubtitle: { fontSize: 13.5, color: palette.inkMuted, fontWeight: '500', marginTop: 6, marginBottom: 18, lineHeight: 19 },

  explainerCard: {
    backgroundColor: palette.primarySoft, borderRadius: 16, padding: 16, marginBottom: 16,
  },
  explainerTitle: { fontSize: 13.5, fontWeight: '800', color: palette.ink, marginBottom: 8 },
  explainerText: { fontSize: 12.5, color: palette.inkMuted, lineHeight: 18 },
  explainerBold: { fontWeight: '700', color: palette.ink },

  balanceCard: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: palette.surface, borderRadius: 14, padding: 14, marginBottom: 20, ...cardShadow,
  },
  balanceText: { fontSize: 14, fontWeight: '700', color: palette.ink },

  sliderCard: {
    backgroundColor: palette.surface, borderRadius: 18, padding: 18, marginBottom: 26, ...cardShadow,
  },
  sliderLabel: { fontSize: 12.5, fontWeight: '700', color: palette.inkMuted, marginBottom: 4 },
  sliderAmount: { fontSize: 24, fontWeight: '800', color: palette.ink, marginBottom: 4 },
  slider: { width: '100%', height: 36 },
  sliderFooter: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 6 },
  sliderPrice: { fontSize: 16, fontWeight: '800', color: palette.primaryDeep },
  sliderBuyBtn: {
    backgroundColor: palette.primary, paddingHorizontal: 24, paddingVertical: 10, borderRadius: 11,
    minWidth: 76, alignItems: 'center',
  },
  sliderBuyBtnText: { color: palette.surface, fontWeight: '700', fontSize: 13.5 },

  packsHeading: { fontSize: 15, fontWeight: '800', color: palette.ink, marginBottom: 12 },
  packsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 20 },
  packCard: {
    width: '31.5%', backgroundColor: palette.surface, borderRadius: 14, paddingVertical: 18,
    alignItems: 'center', justifyContent: 'center', gap: 4, ...cardShadow, minHeight: 78,
  },
  packMinutes: { fontSize: 13.5, fontWeight: '800', color: palette.ink },
  packPrice: { fontSize: 12, fontWeight: '600', color: palette.inkMuted },

  footNote: { fontSize: 11, color: palette.neutralText, fontWeight: '500', textAlign: 'center', marginTop: 4 },
});