import React, { useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity,
  TextInput, ScrollView, Switch, ActivityIndicator, Platform
} from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { colors } from '../../theme/colors';
import { supabase } from '../../lib/supabase';
import { MAX_ATTENDEES_CAP } from '../../lib/constants';

// ─────────────────────────────────────────────────────────────────────
// PALETTE — same tokens/mapping as HostDashboard.js / AttendeeDashboard.js
// so this screen reads as part of the same product, not a one-off.
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
  dangerSoft: '#FFE9E9',
  amber: colors.yellow,
  amberSoft: '#FFF3DE',
  neutralSoft: colors.greyLight,
  neutralText: colors.grey,
};

const modes = [
  { id: 'classroom', label: 'Classroom', icon: 'school-outline', set: 'ion', color: palette.primary, soft: palette.primarySoft, desc: 'Lectures, presentations & assignments.' },
  { id: 'interview', label: 'Interview', icon: 'briefcase-outline', set: 'ion', color: palette.amber, soft: palette.amberSoft, desc: 'One-on-one structured evaluations.' },
  { id: 'meeting', label: 'Meeting', icon: 'people-outline', set: 'ion', color: palette.success, soft: palette.successSoft, desc: 'Collaborative team discussions.' },
  { id: 'gettogether', label: 'Get Together', icon: 'party-popper', set: 'mci', color: palette.danger, soft: palette.dangerSoft, desc: 'Casual, social, and unstructured.' },
];

function ModeIcon({ icon, set, size = 20, color }) {
  const IconSet = set === 'mci' ? MaterialCommunityIcons : Ionicons;
  return <IconSet name={icon} size={size} color={color} />;
}

const generateCode = () => {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
};

export default function CreateSession({ navigation }) {
  const [title, setTitle] = useState('');
  const [selectedMode, setSelectedMode] = useState('classroom');
  const [maxAttendees, setMaxAttendees] = useState(MAX_ATTENDEES_CAP);
  const [waitlist, setWaitlist] = useState(true);
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [cameraOn, setCameraOn] = useState(false);
  const [micOn, setMicOn] = useState(true);
  const [allowGuests, setAllowGuests] = useState(true);
  const [lobbyMusic, setLobbyMusic] = useState(true);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [sessionCode] = useState(generateCode());
  // Purely local UI feedback for the copy buttons below — 'link' | 'code'
  // | null. Was previously missing entirely (the buttons had no onPress
  // at all), so nothing was actually being copied. This doesn't touch
  // session creation in any way.
  const [copiedField, setCopiedField] = useState(null);

  const copyToClipboard = async (text, field) => {
    await Clipboard.setStringAsync(text || '');
    setCopiedField(field);
    setTimeout(() => setCopiedField((cur) => (cur === field ? null : cur)), 1600);
  };

 const createSession = async () => {
  setError('');
  if (!title.trim()) return setError('Please enter a session title.');
  if (!password.trim()) return setError('Please set a session password.');

  setLoading(true);
  try {
    const { data: { user } } = await supabase.auth.getUser();

    const { data, error: insertError } = await supabase
      .from('sessions')
      .insert({
        host_id: user.id,
        title: title.trim(),
        mode: selectedMode,
        max_attendees: maxAttendees,
        waitlist_enabled: waitlist,
        password: password.trim(),
        code: sessionCode,
        status: 'scheduled',
        default_camera_on: cameraOn,
        default_mic_on: micOn,
        allow_guests: allowGuests,
        lobby_music: lobbyMusic,
      })
      .select()
      .single();

    if (insertError) throw insertError;
    navigation.navigate('Lobby', { session: data });
  } catch (err) {
    setError(err.message || 'Failed to create session.');
  } finally {
    setLoading(false);
  }
};

  const advancedSettings = [
    { icon: 'videocam-outline', label: 'Default Camera On', value: cameraOn, onChange: setCameraOn },
    { icon: 'mic-outline', label: 'Default Mic On', value: micOn, onChange: setMicOn },
    { icon: 'people-outline', label: 'Allow Guest Users', value: allowGuests, onChange: setAllowGuests },
    { icon: 'musical-notes-outline', label: 'Lobby Music', value: lobbyMusic, onChange: setLobbyMusic },
  ];

  return (
    <View style={styles.container}>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>

        <View style={styles.header}>
          <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn} activeOpacity={0.7}>
            <Ionicons name="arrow-back" size={20} color={palette.ink} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Create New Session</Text>
          <TouchableOpacity onPress={() => { setTitle(''); setSelectedMode('classroom'); setPassword(''); }}>
            <Text style={styles.clearText}>Clear</Text>
          </TouchableOpacity>
        </View>

        {error ? (
          <View style={styles.errorCard}>
            <Ionicons name="alert-circle" size={16} color={palette.danger} />
            <Text style={styles.errorText}>{error}</Text>
          </View>
        ) : null}

        <Text style={styles.label}>Session Title</Text>
        <TextInput
          style={styles.titleInput}
          placeholder="Enter a catchy session title..."
          placeholderTextColor={palette.neutralText}
          value={title}
          onChangeText={setTitle}
        />

        <Text style={styles.label}>Mode Selector</Text>
        <View style={styles.modeGrid}>
          {modes.map(mode => {
            const active = selectedMode === mode.id;
            return (
              <TouchableOpacity
                key={mode.id}
                style={[styles.modeCard, active && { borderColor: mode.color, backgroundColor: mode.soft }]}
                onPress={() => setSelectedMode(mode.id)}
                activeOpacity={0.8}
              >
                <View style={[styles.modeIconWrap, { backgroundColor: active ? palette.surface : mode.soft }]}>
                  <ModeIcon icon={mode.icon} set={mode.set} size={19} color={mode.color} />
                </View>
                <View style={styles.modeTextWrap}>
                  <Text style={[styles.modeLabel, active && { color: mode.color }]}>{mode.label}</Text>
                  <Text style={styles.modeDesc}>{mode.desc}</Text>
                </View>
              </TouchableOpacity>
            );
          })}
        </View>

        <View style={styles.attendeeRow}>
          <Text style={styles.label}>Max Attendees</Text>
          <View style={styles.counterRow}>
            <TouchableOpacity style={styles.counterBtn} onPress={() => setMaxAttendees(Math.max(1, maxAttendees - 1))} activeOpacity={0.7}>
              <Ionicons name="remove" size={16} color={palette.ink} />
            </TouchableOpacity>
            <Text style={styles.counterValue}>{maxAttendees}</Text>
            <TouchableOpacity
              style={[styles.counterBtn, maxAttendees >= MAX_ATTENDEES_CAP && styles.counterBtnDisabled]}
              onPress={() => setMaxAttendees(Math.min(MAX_ATTENDEES_CAP, maxAttendees + 1))}
              activeOpacity={0.7}
              disabled={maxAttendees >= MAX_ATTENDEES_CAP}
            >
              <Ionicons name="add" size={16} color={maxAttendees >= MAX_ATTENDEES_CAP ? palette.inkMuted : palette.ink} />
            </TouchableOpacity>
          </View>
          <View style={styles.waitlistRow}>
            <Text style={styles.waitlistLabel}>Waitlist</Text>
            <Switch value={waitlist} onValueChange={setWaitlist} trackColor={{ true: palette.primary }} thumbColor={palette.surface} />
          </View>
        </View>
        {maxAttendees >= MAX_ATTENDEES_CAP && (
          <Text style={styles.capNote}>{MAX_ATTENDEES_CAP} is the current limit while we scale up capacity.</Text>
        )}

        <Text style={styles.label}>Session Password</Text>
        <View style={styles.inputRow}>
          <Ionicons name="lock-closed-outline" size={17} color={palette.neutralText} style={styles.inputIcon} />
          <TextInput
            style={styles.input}
            placeholder="Set a session password"
            placeholderTextColor={palette.neutralText}
            value={password}
            onChangeText={setPassword}
            secureTextEntry={!showPassword}
          />
          <TouchableOpacity onPress={() => setShowPassword(!showPassword)} activeOpacity={0.7}>
            <Ionicons name={showPassword ? 'eye-off-outline' : 'eye-outline'} size={18} color={palette.neutralText} />
          </TouchableOpacity>
        </View>

        <View style={styles.linkCard}>
          <View style={styles.linkRow}>
            <View style={styles.linkIconWrap}>
              <Ionicons name="link-outline" size={15} color={palette.primary} />
            </View>
            <Text style={styles.linkText} numberOfLines={1}>kesher.app/join/{sessionCode.toLowerCase()}</Text>
            <TouchableOpacity
              style={[styles.copyBtn, copiedField === 'link' && styles.copyBtnDone]}
              onPress={() => copyToClipboard(`kesher.app/join/${sessionCode.toLowerCase()}`, 'link')}
              activeOpacity={0.75}
            >
              <Ionicons name={copiedField === 'link' ? 'checkmark' : 'copy-outline'} size={13} color={copiedField === 'link' ? palette.success : palette.primary} />
              <Text style={[styles.copyText, copiedField === 'link' && { color: palette.success }]}>{copiedField === 'link' ? 'Copied' : 'Copy'}</Text>
            </TouchableOpacity>
          </View>
          <View style={styles.linkDivider} />
          <View style={styles.linkRow}>
            <View style={styles.linkIconWrap}>
              <Ionicons name="key-outline" size={15} color={palette.primary} />
            </View>
            <Text style={styles.linkText}>Code: {sessionCode}</Text>
            <TouchableOpacity
              style={[styles.copyBtn, copiedField === 'code' && styles.copyBtnDone]}
              onPress={() => copyToClipboard(sessionCode, 'code')}
              activeOpacity={0.75}
            >
              <Ionicons name={copiedField === 'code' ? 'checkmark' : 'copy-outline'} size={13} color={copiedField === 'code' ? palette.success : palette.primary} />
              <Text style={[styles.copyText, copiedField === 'code' && { color: palette.success }]}>{copiedField === 'code' ? 'Copied' : 'Copy'}</Text>
            </TouchableOpacity>
          </View>
        </View>

        <TouchableOpacity style={styles.advancedHeader} onPress={() => setShowAdvanced(!showAdvanced)} activeOpacity={0.8}>
          <Ionicons name="options-outline" size={18} color={palette.ink} />
          <Text style={styles.advancedTitle}>Advanced Settings</Text>
          <Ionicons name={showAdvanced ? 'chevron-up' : 'chevron-down'} size={16} color={palette.neutralText} />
        </TouchableOpacity>

        {showAdvanced && (
          <View style={styles.advancedPanel}>
            {advancedSettings.map((setting, i) => (
              <View key={i} style={[styles.settingRow, i === advancedSettings.length - 1 && styles.settingRowLast]}>
                <View style={styles.settingIconWrap}>
                  <Ionicons name={setting.icon} size={16} color={palette.primary} />
                </View>
                <Text style={styles.settingLabel}>{setting.label}</Text>
                <Switch value={setting.value} onValueChange={setting.onChange} trackColor={{ true: palette.primary }} thumbColor={palette.surface} />
              </View>
            ))}
          </View>
        )}

        <View style={styles.buttonRow}>
          <TouchableOpacity
            style={[styles.scheduleButton, loading && styles.btnDisabled]}
            onPress={() => createSession()}
            disabled={loading}
            activeOpacity={0.8}
          >
            {loading ? (
              <ActivityIndicator color={palette.primary} />
            ) : (
              <>
                <Ionicons name="calendar-outline" size={16} color={palette.primary} />
                <Text style={styles.scheduleButtonText}>Schedule</Text>
              </>
            )}
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.launchButton, loading && styles.btnDisabled]}
            onPress={() => createSession()}
            disabled={loading}
            activeOpacity={0.85}
          >
            {loading ? (
              <ActivityIndicator color={palette.surface} />
            ) : (
              <>
                <Text style={styles.launchButtonText}>Create & Go</Text>
                <Ionicons name="rocket" size={16} color={palette.surface} />
              </>
            )}
          </TouchableOpacity>
        </View>

      </ScrollView>
    </View>
  );
}

const cardShadow = Platform.select({
  ios: { shadowColor: '#2A1A6B', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.06, shadowRadius: 10 },
  android: { elevation: 2 },
  default: { boxShadow: '0 4px 12px rgba(42,26,107,0.06)' },
});

const launchShadow = Platform.select({
  ios: { shadowColor: palette.primaryDeep, shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.26, shadowRadius: 16 },
  android: { elevation: 8 },
  default: { boxShadow: `0 8px 20px rgba(58,15,217,0.26)` },
});

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: palette.canvas },
  scroll: { padding: 20, paddingBottom: 50 },

  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 18 },
  backBtn: { width: 36, height: 36, borderRadius: 12, backgroundColor: palette.surface, alignItems: 'center', justifyContent: 'center', ...cardShadow },
  headerTitle: { fontSize: 17, fontWeight: '800', color: palette.ink, letterSpacing: -0.2 },
  clearText: { fontSize: 13, color: palette.neutralText, fontWeight: '700' },

  errorCard: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: palette.dangerSoft, borderRadius: 12, padding: 12, marginBottom: 14 },
  errorText: { color: palette.danger, fontSize: 13, fontWeight: '600', flexShrink: 1 },

  label: { fontSize: 13, fontWeight: '700', color: palette.ink, marginBottom: 8, marginTop: 14, letterSpacing: -0.1 },
  titleInput: { backgroundColor: palette.surface, borderRadius: 13, paddingHorizontal: 16, paddingVertical: 14, fontSize: 15, color: palette.ink, fontWeight: '600', borderWidth: 1, borderColor: palette.line, outlineStyle: 'none', ...cardShadow },

  modeGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  modeCard: { width: '47%', flexDirection: 'row', alignItems: 'center', gap: 10, padding: 12, borderRadius: 15, borderWidth: 1.5, borderColor: palette.line, backgroundColor: palette.surface, ...cardShadow },
  modeIconWrap: { width: 36, height: 36, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
  modeTextWrap: { flex: 1 },
  modeLabel: { fontSize: 13.5, fontWeight: '700', color: palette.ink },
  modeDesc: { fontSize: 10.5, color: palette.inkMuted, lineHeight: 14, marginTop: 2, fontWeight: '500' },

  attendeeRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 14 },
  counterRow: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: palette.surface, borderRadius: 13, paddingHorizontal: 12, paddingVertical: 8, borderWidth: 1, borderColor: palette.line, ...cardShadow },
  counterBtn: { width: 28, height: 28, borderRadius: 9, backgroundColor: palette.neutralSoft, alignItems: 'center', justifyContent: 'center' },
  counterBtnDisabled: { opacity: 0.5 },
  capNote: { fontSize: 11, color: palette.inkMuted, marginTop: 6, textAlign: 'right' },
  counterValue: { fontSize: 16, fontWeight: '800', color: palette.ink, minWidth: 30, textAlign: 'center' },
  waitlistRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  waitlistLabel: { fontSize: 13, fontWeight: '700', color: palette.ink },

  inputRow: { flexDirection: 'row', alignItems: 'center', backgroundColor: palette.surface, borderRadius: 13, paddingHorizontal: 14, borderWidth: 1, borderColor: palette.line, height: 52, ...cardShadow },
  inputIcon: { marginRight: 10 },
  input: { flex: 1, fontSize: 15, color: palette.ink, fontWeight: '600', outlineStyle: 'none' },

  linkCard: { backgroundColor: palette.surface, borderRadius: 15, paddingHorizontal: 14, paddingVertical: 4, borderWidth: 1, borderColor: palette.line, marginTop: 14, ...cardShadow },
  linkRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 12 },
  linkDivider: { height: 1, backgroundColor: palette.line },
  linkIconWrap: { width: 28, height: 28, borderRadius: 9, backgroundColor: palette.primarySoft, alignItems: 'center', justifyContent: 'center' },
  linkText: { flex: 1, fontSize: 13, color: palette.ink, fontWeight: '600' },
  copyBtn: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 11, paddingVertical: 7, borderRadius: 10, borderWidth: 1, borderColor: palette.primary },
  copyBtnDone: { borderColor: palette.success, backgroundColor: palette.successSoft },
  copyText: { color: palette.primary, fontSize: 11.5, fontWeight: '700' },

  advancedHeader: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 18, padding: 14, backgroundColor: palette.surface, borderRadius: 15, borderWidth: 1, borderColor: palette.line, ...cardShadow },
  advancedTitle: { flex: 1, fontSize: 14.5, fontWeight: '700', color: palette.ink, letterSpacing: -0.1 },
  advancedPanel: { backgroundColor: palette.surface, borderRadius: 15, paddingHorizontal: 14, borderWidth: 1, borderColor: palette.line, marginTop: 2, ...cardShadow },
  settingRow: { flexDirection: 'row', alignItems: 'center', gap: 11, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: palette.line },
  settingRowLast: { borderBottomWidth: 0 },
  settingIconWrap: { width: 30, height: 30, borderRadius: 9, backgroundColor: palette.primarySoft, alignItems: 'center', justifyContent: 'center' },
  settingLabel: { flex: 1, fontSize: 13.5, fontWeight: '600', color: palette.ink },

  buttonRow: { flexDirection: 'row', gap: 12, marginTop: 26 },
  scheduleButton: { flex: 1, flexDirection: 'row', gap: 7, backgroundColor: palette.surface, paddingVertical: 15, borderRadius: 16, alignItems: 'center', justifyContent: 'center', borderWidth: 1.5, borderColor: palette.primary },
  scheduleButtonText: { color: palette.primary, fontSize: 14.5, fontWeight: '800' },
  launchButton: { flex: 1, flexDirection: 'row', gap: 7, backgroundColor: palette.primary, paddingVertical: 15, borderRadius: 16, alignItems: 'center', justifyContent: 'center', ...launchShadow },
  launchButtonText: { color: palette.surface, fontSize: 14.5, fontWeight: '800' },
  btnDisabled: { opacity: 0.6 },
});