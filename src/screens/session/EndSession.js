import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, ActivityIndicator, Platform } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { colors } from '../../theme/colors';
import { supabase } from '../../lib/supabase';

// ─────────────────────────────────────────────────────────────────────
// PALETTE — same tokens/mapping as the other production-pass screens.
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
  success: colors.green,
  successSoft: '#E7FBF0',
  danger: colors.red,
  amber: colors.yellow,
  amberSoft: '#FFF3DE',
  neutralSoft: colors.greyLight,
  neutralText: colors.grey,
};

// Same mode → icon mapping used across CreateSession / the dashboards /
// Lobby / AttendeeSession.
const MODE_ICON_META = {
  classroom:   { icon: 'school-outline',    set: 'ion' },
  interview:   { icon: 'briefcase-outline', set: 'ion' },
  meeting:     { icon: 'people-outline',    set: 'ion' },
  gettogether: { icon: 'party-popper',      set: 'mci' },
};
const DEFAULT_MODE_ICON = { icon: 'calendar-outline', set: 'ion' };
function ModeIcon({ mode, size = 17, color = palette.primary }) {
  const meta = MODE_ICON_META[mode] || DEFAULT_MODE_ICON;
  const IconSet = meta.set === 'mci' ? MaterialCommunityIcons : Ionicons;
  return <IconSet name={meta.icon} size={size} color={color} />;
}

export default function EndSession({ navigation, route }) {
  const session = route.params?.session;
  const [attendees, setAttendees] = useState([]);
  const [duration, setDuration] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadSessionSummary();
  }, []);

  const loadSessionSummary = async () => {
    try {
      // Load attendees who were in session
      const { data: attendeeData } = await supabase
        .from('session_attendees')
        .select('*, profiles(full_name)')
        .eq('session_id', session?.id);

      setAttendees(attendeeData || []);

      // Calculate duration
      if (session?.created_at) {
        const start = new Date(session.created_at);
        const end = new Date();
        const diff = Math.floor((end - start) / 1000);
        const m = Math.floor(diff / 60);
        const s = diff % 60;
        setDuration(`${m} mins ${s} secs`);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const getInitials = (name) => {
    if (!name) return '?';
    return name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2);
  };

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color={palette.primary} />
        <Text style={styles.loadingText}>Loading summary...</Text>
      </View>
    );
  }

  const summaryRows = [
    { icon: 'clipboard-outline', label: 'Session', value: session?.title || 'Session' },
    { mode: true, label: 'Mode', value: session?.mode || 'N/A' },
    { icon: 'time-outline', label: 'Duration', value: duration || 'N/A' },
    { icon: 'people-outline', label: 'Attendees', value: `${attendees.length} present` },
    { icon: 'key-outline', label: 'Code', value: session?.code, accent: true },
  ];

  return (
    <View style={styles.container}>
      <ScrollView contentContainerStyle={styles.scroll}>

        <LinearGradient
          colors={[palette.primaryBright, palette.primary, palette.primaryDeep]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.iconWrap}
        >
          <Ionicons name="checkmark-circle" size={44} color={palette.surface} />
        </LinearGradient>
        <Text style={styles.title}>Session Complete!</Text>
        <Text style={styles.subtitle}>Great session. Here's your summary.</Text>

        {/* Summary Card */}
        <View style={styles.summaryCard}>
          {summaryRows.map((row, i) => (
            <View key={i} style={[styles.summaryRow, i === summaryRows.length - 1 && styles.summaryRowLast]}>
              <View style={styles.summaryIconWrap}>
                {row.mode ? <ModeIcon mode={session?.mode} size={16} /> : <Ionicons name={row.icon} size={16} color={palette.primary} />}
              </View>
              <Text style={styles.summaryLabel}>{row.label}</Text>
              <Text style={[styles.summaryValue, row.accent && { color: palette.primary }, row.mode && { textTransform: 'capitalize' }]} numberOfLines={1}>
                {row.value}
              </Text>
            </View>
          ))}
        </View>

        {/* Attendees */}
        {attendees.length > 0 && (
          <>
            <Text style={styles.sectionTitle}>Attendees Present</Text>
            <View style={styles.avatarRow}>
              {attendees.map((a, i) => (
                <View key={i} style={styles.avatarWrap}>
                  <View style={styles.avatar}>
                    <Text style={styles.avatarText}>
                      {getInitials(a.profiles?.full_name)}
                    </Text>
                  </View>
                  <Text style={styles.avatarName} numberOfLines={1}>
                    {a.profiles?.full_name?.split(' ')[0] || 'Guest'}
                  </Text>
                </View>
              ))}
            </View>
          </>
        )}

        {/* Action Buttons */}
        <View style={styles.buttonCol}>
          <TouchableOpacity
            style={styles.primaryBtn}
            onPress={() => navigation.navigate('SubmissionsInbox')}
            activeOpacity={0.85}
          >
            <Ionicons name="file-tray-full-outline" size={17} color={palette.surface} />
            <Text style={styles.primaryBtnText}>View Submissions</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.secondaryBtn}
            onPress={() => navigation.navigate('CreateSession')}
            activeOpacity={0.85}
          >
            <Ionicons name="add-circle-outline" size={17} color={palette.primary} />
            <Text style={styles.secondaryBtnText}>Start New Session</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.homeBtn}
            onPress={() => navigation.navigate('HostDashboard')}
            activeOpacity={0.85}
          >
            <Ionicons name="home-outline" size={17} color={palette.ink} />
            <Text style={styles.homeBtnText}>Back to Home</Text>
          </TouchableOpacity>
        </View>

      </ScrollView>
    </View>
  );
}

const cardShadow = Platform.select({
  ios: { shadowColor: '#2A1A6B', shadowOffset: { width: 0, height: 5 }, shadowOpacity: 0.07, shadowRadius: 12 },
  android: { elevation: 2 },
  default: { boxShadow: '0 5px 14px rgba(42,26,107,0.07)' },
});

const iconShadow = Platform.select({
  ios: { shadowColor: palette.primaryDeep, shadowOffset: { width: 0, height: 10 }, shadowOpacity: 0.3, shadowRadius: 20 },
  android: { elevation: 8 },
  default: { boxShadow: `0 10px 24px rgba(58,15,217,0.3)` },
});

const primaryShadow = Platform.select({
  ios: { shadowColor: palette.primaryDeep, shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.26, shadowRadius: 16 },
  android: { elevation: 8 },
  default: { boxShadow: `0 8px 20px rgba(58,15,217,0.26)` },
});

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: palette.canvas },
  loadingContainer: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, backgroundColor: palette.canvas },
  loadingText: { color: palette.inkMuted, fontSize: 14, fontWeight: '500' },
  scroll: { padding: 24, alignItems: 'center', paddingBottom: 50 },
  iconWrap: { width: 88, height: 88, borderRadius: 44, alignItems: 'center', justifyContent: 'center', marginBottom: 18, ...iconShadow },
  title: { fontSize: 26, fontWeight: '800', color: palette.ink, marginBottom: 7, letterSpacing: -0.4 },
  subtitle: { fontSize: 14, color: palette.inkMuted, marginBottom: 24, fontWeight: '500' },
  summaryCard: { width: '100%', backgroundColor: palette.surface, borderRadius: 20, paddingHorizontal: 16, paddingVertical: 4, marginBottom: 24, ...cardShadow },
  summaryRow: { flexDirection: 'row', alignItems: 'center', gap: 11, paddingVertical: 13, borderBottomWidth: 1, borderBottomColor: palette.line },
  summaryRowLast: { borderBottomWidth: 0 },
  summaryIconWrap: { width: 32, height: 32, borderRadius: 10, backgroundColor: palette.primarySoft, alignItems: 'center', justifyContent: 'center' },
  summaryLabel: { width: 82, fontSize: 12.5, color: palette.inkMuted, fontWeight: '600' },
  summaryValue: { flex: 1, fontSize: 14, fontWeight: '700', color: palette.ink },
  sectionTitle: { fontSize: 15, fontWeight: '800', color: palette.ink, alignSelf: 'flex-start', marginBottom: 12, letterSpacing: -0.2 },
  avatarRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, alignSelf: 'flex-start', marginBottom: 24 },
  avatarWrap: { alignItems: 'center', gap: 4 },
  avatar: { width: 48, height: 48, borderRadius: 24, backgroundColor: palette.primary, alignItems: 'center', justifyContent: 'center' },
  avatarText: { color: palette.surface, fontWeight: '700', fontSize: 13 },
  avatarName: { fontSize: 10, color: palette.inkMuted, maxWidth: 48, fontWeight: '500' },
  buttonCol: { width: '100%', gap: 12 },
  primaryBtn: { flexDirection: 'row', gap: 8, backgroundColor: palette.primary, paddingVertical: 16, borderRadius: 16, alignItems: 'center', justifyContent: 'center', ...primaryShadow },
  primaryBtnText: { color: palette.surface, fontSize: 15.5, fontWeight: '800', letterSpacing: -0.2 },
  secondaryBtn: { flexDirection: 'row', gap: 8, backgroundColor: palette.surface, paddingVertical: 16, borderRadius: 16, alignItems: 'center', justifyContent: 'center', borderWidth: 1.5, borderColor: palette.primary },
  secondaryBtnText: { color: palette.primary, fontSize: 15.5, fontWeight: '800' },
  homeBtn: { flexDirection: 'row', gap: 8, backgroundColor: palette.neutralSoft, paddingVertical: 16, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  homeBtnText: { color: palette.ink, fontSize: 15.5, fontWeight: '700' },
});