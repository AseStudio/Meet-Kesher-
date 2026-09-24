import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Platform, Alert } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { getPlan } from '../../lib/constants';
import { colors } from '../../theme/colors';
import { supabase } from '../../lib/supabase';

export default function TimerScreen({ navigation, route }) {
  const session = route.params?.session;
  // Which pool this session actually bills against — set once at
  // creation (CreateSession.js) and stored on sessions.minute_source;
  // see SessionMain.js's periodic tick, which bills whichever this is.
  const activeSource = session?.minute_source === 'participant' ? 'participant' : 'host';
  const [hostMinutes, setHostMinutes] = useState(null);
  const [participantMinutes, setParticipantMinutes] = useState(null);
  const [isPremium, setIsPremium] = useState(false);
  const [plan, setPlan] = useState('free');
  const [loading, setLoading] = useState(true);
  const [showUpgrade, setShowUpgrade] = useState(false);
  const [notificationShown, setNotificationShown] = useState({ five: false, zero: false });

  // Fetch host's usage and premium status
  useEffect(() => {
    const loadData = async () => {
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) {
          navigation.goBack();
          return;
        }

        // Fetch plan (is_premium is a DB column nothing ever writes
        // after checkout — the webhook only updates profiles.plan — so
        // it's always false/null; derive "premium" from plan instead,
        // same as CommunityScreen/CreateSession).
        const { data: profile } = await supabase
          .from('profiles')
          .select('plan, participant_minutes_balance')
          .eq('id', user.id)
          .maybeSingle();
        setIsPremium(!!profile?.plan && profile.plan !== 'free');
        setPlan(profile?.plan || 'free');
        setParticipantMinutes(Math.max(0, profile?.participant_minutes_balance ?? 0));

        // Fetch hosting minutes balance
        const { data: usageRow } = await supabase.rpc('get_my_usage');
        if (usageRow && usageRow.host_minutes_balance !== null) {
          setHostMinutes(Math.max(0, usageRow.host_minutes_balance));
        } else {
          setHostMinutes(0);
        }
      } catch (e) {
        console.error('Error loading host minutes:', e);
        if (Platform.OS === 'web') {
          window.alert('Error: Could not load hosting minutes.');
        } else {
          Alert.alert('Error', 'Could not load hosting minutes.');
        }
      } finally {
        setLoading(false);
      }
    };
    loadData();
  }, []);

  // Countdown effect — counts down whichever pool this session is
  // actually billing against (activeSource), same as SessionMain.js's
  // real billing tick. The other pool is still displayed (fetched
  // above) but doesn't tick locally here, since this session isn't
  // spending it.
  useEffect(() => {
    const activeMinutes = activeSource === 'participant' ? participantMinutes : hostMinutes;
    if (activeMinutes === null || activeMinutes === 0) return;

    const interval = setInterval(() => {
      const setActive = activeSource === 'participant' ? setParticipantMinutes : setHostMinutes;
      setActive(prev => {
        if (prev === null) return null;
        const newMinutes = Math.max(0, prev - 1);
        
        // Show notification at 5 minutes
        if (newMinutes === 5 && !notificationShown.five) {
          setNotificationShown(prev => ({ ...prev, five: true }));
          if (Platform.OS === 'web') {
            window.alert('5 session minutes remaining\n\nupgrade to Premium for extended session minutes');
          } else {
            Alert.alert('5 session minutes remaining', 'upgrade to Premium for extended session minutes');
          }
          if (!isPremium) {
            setShowUpgrade(true);
          }
        }
        
        // Show notification and end session at 0 minutes
        if (newMinutes === 0 && !notificationShown.zero) {
          setNotificationShown(prev => ({ ...prev, zero: true }));
          if (Platform.OS === 'web') {
            window.alert('You have exhausted your session minutes');
          } else {
            Alert.alert('Session Ended', 'You have exhausted your session minutes');
          }
          // End the session
          endSession();
        }
        
        return newMinutes;
      });
    }, 60000); // Update every minute

    return () => clearInterval(interval);
  }, [hostMinutes, participantMinutes, activeSource, notificationShown, isPremium]);

  const endSession = async () => {
    if (!session?.id) {
      navigation.goBack();
      return;
    }

    try {
      // Update session status to ended
      await supabase
        .from('sessions')
        .update({ status: 'ended', ended_at: new Date().toISOString() })
        .eq('id', session.id);

      // Navigate back to end session screen
      navigation.navigate('EndSession', { session, recordingPath: null });
    } catch (e) {
      console.error('Error ending session:', e);
      if (Platform.OS === 'web') {
        window.alert(`Could not end session: ${e.message}`);
      } else {
        Alert.alert('Could not end session', e.message);
      }
      navigation.goBack();
    }
  };

  const formatMinutes = (mins) => {
    if (mins === null) return '--';
    return mins.toString();
  };

  const isLow = (activeSource === 'participant' ? participantMinutes : hostMinutes) !== null
    && (activeSource === 'participant' ? participantMinutes : hostMinutes) <= 5;

  if (loading) {
    return (
      <View style={styles.container}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => navigation.goBack()} activeOpacity={0.75}>
            <Ionicons name="arrow-back" size={20} color={colors.white} />
          </TouchableOpacity>
          <View style={styles.headerTitleRow}>
            <Ionicons name="timer-outline" size={16} color={colors.white} />
            <Text style={styles.headerTitle}>Session Minutes</Text>
          </View>
          <View style={{ width: 20 }} />
        </View>
        <View style={styles.content}>
          <Text style={styles.loadingText}>Loading...</Text>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} activeOpacity={0.75}>
          <Ionicons name="arrow-back" size={20} color={colors.white} />
        </TouchableOpacity>
        <View style={styles.headerTitleRow}>
          <Ionicons name="timer-outline" size={16} color={colors.white} />
          <Text style={styles.headerTitle}>Session Minutes</Text>
        </View>
        <View style={{ width: 20 }} />
      </View>

      <View style={styles.content}>
        {/* Active pool's ring — whichever this session is actually
            billing against (activeSource). */}
        <View style={[styles.minutesRing, isLow && styles.minutesRingRed]}>
          <View style={styles.minutesInner}>
            <Text style={[styles.minutesDisplay, isLow && styles.minutesDisplayRed]}>
              {formatMinutes(activeSource === 'participant' ? participantMinutes : hostMinutes)}
            </Text>
            <View style={styles.minutesSubtextRow}>
              <Text style={styles.minutesSubtext}>
                {(activeSource === 'participant' ? participantMinutes : hostMinutes) === 0 ? 'No minutes left' : 'minutes remaining'}
              </Text>
            </View>
          </View>
        </View>

        {/* Both pools, side by side — the active one (the one this
            session is actually consuming) is highlighted so it's clear
            at a glance which balance is ticking down. */}
        <View style={styles.poolRow}>
          <View style={[styles.poolCard, activeSource === 'host' && styles.poolCardActive]}>
            {activeSource === 'host' && (
              <View style={styles.poolBadge}><Text style={styles.poolBadgeText}>IN USE</Text></View>
            )}
            <Ionicons name="person-outline" size={16} color={activeSource === 'host' ? colors.white : 'rgba(255,255,255,0.5)'} />
            <Text style={[styles.poolValue, activeSource === 'host' && styles.poolValueActive]}>{formatMinutes(hostMinutes)}</Text>
            <Text style={styles.poolLabel}>Hosting Minutes</Text>
          </View>
          <View style={[styles.poolCard, activeSource === 'participant' && styles.poolCardActive]}>
            {activeSource === 'participant' && (
              <View style={styles.poolBadge}><Text style={styles.poolBadgeText}>IN USE</Text></View>
            )}
            <Ionicons name="people-circle-outline" size={16} color={activeSource === 'participant' ? colors.white : 'rgba(255,255,255,0.5)'} />
            <Text style={[styles.poolValue, activeSource === 'participant' && styles.poolValueActive]}>{formatMinutes(participantMinutes)}</Text>
            <Text style={styles.poolLabel}>Participant Minutes</Text>
          </View>
        </View>

        {/* Upgrade prompt for non-premium users (shown after 5 minute notification) */}
        {!isPremium && showUpgrade && (
          <View style={styles.upgradeCard}>
            <Ionicons name="sparkles" size={18} color={colors.yellow} />
            <Text style={styles.upgradeText}>Upgrade to Premium for extended session minutes</Text>
          </View>
        )}

        {/* Info card */}
        <View style={styles.infoCard}>
          <Ionicons name="information-circle-outline" size={17} color="rgba(255,255,255,0.6)" />
          <Text style={styles.infoText}>
            {activeSource === 'participant'
              ? 'This session is billing against your purchased participant-minute balance, not your plan\u2019s hosting minutes.'
              : (isPremium 
                ? `You're on the ${getPlan(plan).name} plan — ${getPlan(plan).hostMinutes} hosting minutes per session.`
                : 'Free hosts get 30 minutes per session. Upgrade for more hosting time.')
            }
          </Text>
        </View>

        <TouchableOpacity style={styles.backToSessionBtn} onPress={() => navigation.goBack()} activeOpacity={0.75}>
          <View style={styles.backToSessionRow}>
            <Ionicons name="arrow-back" size={13} color="rgba(255,255,255,0.5)" />
            <Text style={styles.backToSessionText}>Back to Session</Text>
          </View>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0A0A1A' },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 16, paddingTop: 40, backgroundColor: '#0D0D2B' },
  headerTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  headerTitle: { fontSize: 17, fontWeight: '700', color: colors.white, letterSpacing: -0.2 },
  content: { flex: 1, padding: 24, alignItems: 'center', gap: 20 },
  minutesRing: { width: 220, height: 220, borderRadius: 110, borderWidth: 8, borderColor: colors.primary, alignItems: 'center', justifyContent: 'center', backgroundColor: '#1E1E3F', overflow: 'hidden', position: 'relative' },
  minutesRingRed: { borderColor: colors.red },
  minutesInner: { alignItems: 'center', zIndex: 2 },
  minutesDisplay: { fontSize: 72, fontWeight: '800', color: colors.white, fontVariant: ['tabular-nums'] },
  minutesDisplayRed: { color: colors.red },
  minutesSubtextRow: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 5 },
  minutesSubtext: { color: 'rgba(255,255,255,0.55)', fontSize: 14, fontWeight: '600' },
  poolRow: { flexDirection: 'row', gap: 12, width: '100%' },
  poolCard: { flex: 1, backgroundColor: '#1E1E3F', borderRadius: 14, padding: 14, alignItems: 'center', gap: 4, borderWidth: 1.5, borderColor: 'rgba(255,255,255,0.08)', position: 'relative' },
  poolCardActive: { borderColor: colors.primary, backgroundColor: colors.primary + '33' },
  poolBadge: { position: 'absolute', top: -8, alignSelf: 'center', backgroundColor: colors.primary, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 2 },
  poolBadgeText: { color: colors.white, fontSize: 9, fontWeight: '800', letterSpacing: 0.3 },
  poolValue: { fontSize: 22, fontWeight: '800', color: 'rgba(255,255,255,0.6)', fontVariant: ['tabular-nums'], marginTop: 4 },
  poolValueActive: { color: colors.white },
  poolLabel: { fontSize: 10.5, fontWeight: '600', color: 'rgba(255,255,255,0.5)', textAlign: 'center' },
  upgradeCard: { flexDirection: 'row', gap: 10, backgroundColor: colors.yellow + '1A', borderRadius: 14, padding: 14, width: '100%', borderWidth: 1, borderColor: colors.yellow + '40', alignItems: 'center' },
  upgradeText: { flex: 1, color: colors.yellow, fontSize: 14, fontWeight: '700' },
  infoCard: { flexDirection: 'row', gap: 11, backgroundColor: '#1E1E3F', borderRadius: 14, padding: 14, width: '100%', borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)', alignItems: 'flex-start' },
  infoText: { flex: 1, color: 'rgba(255,255,255,0.55)', fontSize: 12, lineHeight: 18, fontWeight: '500' },
  backToSessionBtn: { paddingVertical: 10 },
  backToSessionRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  backToSessionText: { color: 'rgba(255,255,255,0.5)', fontSize: 13.5, fontWeight: '500' },
  loadingText: { color: 'rgba(255,255,255,0.5)', fontSize: 16 },
});