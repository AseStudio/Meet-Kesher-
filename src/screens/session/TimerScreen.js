import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, TextInput, Alert } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '../../theme/colors';
import { showAlert } from '../../lib/alert';

export default function TimerScreen({ navigation }) {
  const [minutes, setMinutes] = useState('10');
  const [seconds, setSeconds] = useState('00');
  const [totalSeconds, setTotalSeconds] = useState(0);
  // Was missing entirely — progress below referenced `initialTotal` with
  // no state/variable behind it anywhere in the file, which throws a
  // ReferenceError on every render (this screen couldn't mount at all).
  // Needs to be separate from totalSeconds specifically because
  // totalSeconds counts DOWN every second — the progress ring's "% of
  // time remaining" math needs the ORIGINAL duration to stay fixed as
  // the denominator, not shrink alongside the numerator.
  const [initialTotal, setInitialTotal] = useState(0);
  const [running, setRunning] = useState(false);
  const [started, setStarted] = useState(false);

  useEffect(() => {
    let interval = null;
    if (running && totalSeconds > 0) {
      interval = setInterval(() => {
        setTotalSeconds(s => s - 1);
      }, 1000);
    } else if (totalSeconds === 0 && started) {
      setRunning(false);
    }
    return () => clearInterval(interval);
  }, [running, totalSeconds]);

  const displayMins = Math.floor(totalSeconds / 60).toString().padStart(2, '0');
  const displaySecs = (totalSeconds % 60).toString().padStart(2, '0');
  const progress = started && initialTotal > 0 ? (totalSeconds / initialTotal) * 100 : 100;
  const isLow = totalSeconds <= 30 && started;

 const handleStart = () => {
  const m = parseInt(minutes) || 0;
  const s = parseInt(seconds) || 0;
  const total = (m * 60) + s;
  if (total <= 0) {
    showAlert('Invalid Time', 'Please enter a time greater than 0.');
    return;
  }
  setTotalSeconds(total);
  setInitialTotal(total);
  setStarted(true);
  setRunning(true);
};
  const handleReset = () => {
    setRunning(false);
    setStarted(false);
    setTotalSeconds(0);
    setInitialTotal(0);
  };

  const presets = [
    { label: '1 min', mins: 1, secs: 0 },
    { label: '5 mins', mins: 5, secs: 0 },
    { label: '10 mins', mins: 10, secs: 0 },
    { label: '15 mins', mins: 15, secs: 0 },
    { label: '30 mins', mins: 30, secs: 0 },
  ];

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} activeOpacity={0.75}>
          <Ionicons name="arrow-back" size={20} color={colors.white} />
        </TouchableOpacity>
        <View style={styles.headerTitleRow}>
          <Ionicons name="timer-outline" size={16} color={colors.white} />
          <Text style={styles.headerTitle}>Session Timer</Text>
        </View>
        <View style={{ width: 20 }} />
      </View>

      <View style={styles.content}>
        {/* Timer Display */}
        <View style={[styles.timerRing, isLow && styles.timerRingRed]}>
          <View style={styles.timerInner}>
            {started ? (
              <>
                <Text style={[styles.timerDisplay, isLow && styles.timerDisplayRed]}>
                  {displayMins}:{displaySecs}
                </Text>
                <View style={styles.timerSubtextRow}>
                  {totalSeconds === 0 && <Ionicons name="alarm-outline" size={12} color="rgba(255,255,255,0.6)" />}
                  <Text style={styles.timerSubtext}>
                    {totalSeconds === 0 ? "Time's up!" : running ? 'Running...' : 'Paused'}
                  </Text>
                </View>
              </>
            ) : (
              <>
                <Text style={styles.timerDisplay}>--:--</Text>
                <Text style={styles.timerSubtext}>Set your timer</Text>
              </>
            )}
          </View>
          {/* Progress Ring Indicator */}
          <View style={[styles.progressArc, { width: `${progress}%` }]} />
        </View>

        {/* Presets */}
        {!started && (
          <>
            <Text style={styles.sectionLabel}>Quick Presets</Text>
            <View style={styles.presetRow}>
              {presets.map(p => (
                <TouchableOpacity
                  key={p.label}
                  style={styles.presetBtn}
                onPress={() => {
  setMinutes(p.mins.toString());
  setSeconds(p.secs.toString().padStart(2, '0'));
}} >
                  <Text style={styles.presetBtnText}>{p.label}</Text>
                </TouchableOpacity>
              ))}
            </View>

            <Text style={styles.sectionLabel}>Custom Time</Text>
            <View style={styles.inputRow}>
              <View style={styles.timeInputWrap}>
                <TextInput
                  style={styles.timeInput}
                  value={minutes}
                  onChangeText={setMinutes}
                  keyboardType="number-pad"
                  maxLength={2}
                  placeholder="00"
                  placeholderTextColor="rgba(255,255,255,0.3)"
                />
                <Text style={styles.timeInputLabel}>min</Text>
              </View>
              <Text style={styles.timeSeparator}>:</Text>
              <View style={styles.timeInputWrap}>
                <TextInput
                  style={styles.timeInput}
                  value={seconds}
                  onChangeText={setSeconds}
                  keyboardType="number-pad"
                  maxLength={2}
                  placeholder="00"
                  placeholderTextColor="rgba(255,255,255,0.3)"
                />
                <Text style={styles.timeInputLabel}>sec</Text>
              </View>
            </View>
          </>
        )}

        {/* Visibility note */}
        <View style={styles.infoCard}>
          <Ionicons name="eye-outline" size={17} color="rgba(255,255,255,0.6)" />
          <Text style={styles.infoText}>Timer is visible to all attendees at the top of their screen. Last 30 seconds turns red.</Text>
        </View>

        {/* Controls */}
        <View style={styles.controlRow}>
          {!started ? (
            <TouchableOpacity style={styles.startBtn} onPress={handleStart} activeOpacity={0.85}>
              <Ionicons name="play" size={16} color={colors.white} />
              <Text style={styles.startBtnText}>Start Timer</Text>
            </TouchableOpacity>
          ) : (
            <>
              <TouchableOpacity
                style={[styles.controlBtn, running ? styles.pauseBtn : styles.resumeBtn]}
                onPress={() => setRunning(!running)}
                activeOpacity={0.85}
              >
                <Ionicons name={running ? 'pause' : 'play'} size={15} color={colors.white} />
                <Text style={styles.controlBtnText}>{running ? 'Pause' : 'Resume'}</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.controlBtn, styles.resetBtn]} onPress={handleReset} activeOpacity={0.85}>
                <Ionicons name="refresh-outline" size={15} color={colors.white} />
                <Text style={styles.controlBtnText}>Reset</Text>
              </TouchableOpacity>
            </>
          )}
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
  timerRing: { width: 220, height: 220, borderRadius: 110, borderWidth: 8, borderColor: colors.primary, alignItems: 'center', justifyContent: 'center', backgroundColor: '#1E1E3F', overflow: 'hidden', position: 'relative' },
  timerRingRed: { borderColor: colors.red },
  timerInner: { alignItems: 'center', zIndex: 2 },
  timerDisplay: { fontSize: 54, fontWeight: '800', color: colors.white, fontVariant: ['tabular-nums'], letterSpacing: -1 },
  timerDisplayRed: { color: colors.red },
  timerSubtextRow: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 5 },
  timerSubtext: { color: 'rgba(255,255,255,0.55)', fontSize: 13, fontWeight: '600' },
  progressArc: { position: 'absolute', bottom: 0, left: 0, height: 6, backgroundColor: colors.primary },
  sectionLabel: { fontSize: 13.5, fontWeight: '700', color: 'rgba(255,255,255,0.7)', alignSelf: 'flex-start', letterSpacing: -0.1 },
  presetRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, justifyContent: 'flex-start', width: '100%' },
  presetBtn: { backgroundColor: '#1E1E3F', paddingHorizontal: 16, paddingVertical: 10, borderRadius: 12, borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)' },
  presetBtnText: { color: colors.white, fontWeight: '600', fontSize: 13 },
  inputRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  timeInputWrap: { alignItems: 'center', gap: 4 },
  timeInput: { width: 80, height: 64, backgroundColor: '#1E1E3F', borderRadius: 14, textAlign: 'center', fontSize: 28, fontWeight: '700', color: colors.white, borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)', outlineStyle: 'none' },
  timeInputLabel: { color: 'rgba(255,255,255,0.5)', fontSize: 12, fontWeight: '600' },
  timeSeparator: { color: colors.white, fontSize: 36, fontWeight: '700', marginBottom: 20 },
  infoCard: { flexDirection: 'row', gap: 11, backgroundColor: '#1E1E3F', borderRadius: 14, padding: 14, width: '100%', borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)', alignItems: 'flex-start' },
  infoText: { flex: 1, color: 'rgba(255,255,255,0.55)', fontSize: 12, lineHeight: 18, fontWeight: '500' },
  controlRow: { flexDirection: 'row', gap: 12, width: '100%' },
  startBtn: { flex: 1, flexDirection: 'row', gap: 8, backgroundColor: colors.primary, paddingVertical: 16, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  startBtnText: { color: colors.white, fontSize: 15.5, fontWeight: '800' },
  controlBtn: { flex: 1, flexDirection: 'row', gap: 7, paddingVertical: 16, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  pauseBtn: { backgroundColor: colors.yellow + 'AA' },
  resumeBtn: { backgroundColor: colors.green + 'AA' },
  resetBtn: { backgroundColor: '#1E1E3F', borderWidth: 1, borderColor: 'rgba(255,255,255,0.2)' },
  controlBtnText: { color: colors.white, fontSize: 14.5, fontWeight: '700' },
  backToSessionBtn: { paddingVertical: 10 },
  backToSessionRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  backToSessionText: { color: 'rgba(255,255,255,0.5)', fontSize: 13.5, fontWeight: '500' },
});