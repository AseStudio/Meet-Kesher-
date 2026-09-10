import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Platform, Alert } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '../../theme/colors';
import { supabase } from '../../lib/supabase';

export default function TimerScreen({ navigation, route }) {
  const session = route.params?.session;
  const [hostMinutes, setHostMinutes] = useState(null);
  const [isPremium, setIsPremium] = useState(false);
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

        // Fetch premium status
        const { data: profile } = await supabase
          .from('profiles')
          .select('is_premium')
          .eq('id', user.id)
          .maybeSingle();
        setIsPremium(!!profile?.is_premium);

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

  // Countdown effect
  useEffect(() => {
    if (hostMinutes === null || hostMinutes === 0) return;

    const interval = setInterval(() => {
      setHostMinutes(prev => {
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
  }, [hostMinutes, notificationShown, isPremium]);

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

  const isLow = hostMinutes !== null && hostMinutes <= 5;

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
        {/* Hosting Minutes Display */}
        <View style={[styles.minutesRing, isLow && styles.minutesRingRed]}>
          <View style={styles.minutesInner}>
            <Text style={[styles.minutesDisplay, isLow && styles.minutesDisplayRed]}>
              {formatMinutes(hostMinutes)}
            </Text>
            <View style={styles.minutesSubtextRow}>
              <Text style={styles.minutesSubtext}>
                {hostMinutes === 0 ? 'No minutes left' : 'minutes remaining'}
              </Text>
            </View>
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
            {isPremium 
              ? 'You have unlimited session minutes as a Premium user.'
              : 'Free users get 30 minutes per month. Upgrade to Premium for unlimited sessions.'
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
  upgradeCard: { flexDirection: 'row', gap: 10, backgroundColor: colors.yellow + '1A', borderRadius: 14, padding: 14, width: '100%', borderWidth: 1, borderColor: colors.yellow + '40', alignItems: 'center' },
  upgradeText: { flex: 1, color: colors.yellow, fontSize: 14, fontWeight: '700' },
  infoCard: { flexDirection: 'row', gap: 11, backgroundColor: '#1E1E3F', borderRadius: 14, padding: 14, width: '100%', borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)', alignItems: 'flex-start' },
  infoText: { flex: 1, color: 'rgba(255,255,255,0.55)', fontSize: 12, lineHeight: 18, fontWeight: '500' },
  backToSessionBtn: { paddingVertical: 10 },
  backToSessionRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  backToSessionText: { color: 'rgba(255,255,255,0.5)', fontSize: 13.5, fontWeight: '500' },
  loadingText: { color: 'rgba(255,255,255,0.5)', fontSize: 16 },
});