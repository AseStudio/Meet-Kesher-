import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Modal, ActivityIndicator } from 'react-native';
import { colors } from '../theme/colors';

export default function SessionExpiredModal({
  visible,
  sessionTitle,
  onStart,
  onCancel,
  starting = false,
  cancelling = false,
  graceSecondsLeft = null,
  graceTimeFormatted = null,
}) {
  const busy = starting || cancelling;
  const showCountdown = graceSecondsLeft !== null && graceSecondsLeft > 0;

  return (
    <Modal visible={visible} transparent animationType="fade">
      {/* No onPress on the overlay — host must make an explicit choice */}
      <View style={styles.overlay}>
        <View style={styles.card}>
          <Text style={styles.icon}>⏰</Text>
          <Text style={styles.title}>Time's Up!</Text>

          <Text style={styles.message}>
            The lobby timer for{sessionTitle ? ` "${sessionTitle}"` : ' your session'} has ended.
            Start the session now, or cancel it for everyone.
          </Text>

          {/* 5-minute grace countdown */}
          {showCountdown && (
            <View style={styles.countdownBox}>
              <Text style={styles.countdownLabel}>Auto-cancels in</Text>
              <Text style={styles.countdownTime}>{graceTimeFormatted}</Text>
            </View>
          )}

          {graceSecondsLeft === 0 && (
            <Text style={styles.autoCancelNote}>Cancelling session…</Text>
          )}

          <TouchableOpacity
            style={[styles.startBtn, busy && styles.btnDisabled]}
            onPress={onStart}
            disabled={busy}
          >
            {starting
              ? <ActivityIndicator color={colors.white} />
              : <Text style={styles.startBtnText}>🚀 Start Session Now</Text>
            }
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.cancelBtn, busy && styles.btnDisabled]}
            onPress={onCancel}
            disabled={busy}
          >
            {cancelling
              ? <ActivityIndicator color={colors.red} />
              : <Text style={styles.cancelBtnText}>Cancel Session</Text>
            }
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.55)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  card: {
    backgroundColor: colors.white,
    borderRadius: 20,
    padding: 26,
    width: '100%',
    maxWidth: 380,
    alignItems: 'center',
    gap: 10,
    elevation: 20,
  },
  icon: { fontSize: 44 },
  title: { fontSize: 21, fontWeight: '800', color: colors.text },
  message: {
    fontSize: 13,
    color: colors.textLight,
    textAlign: 'center',
    lineHeight: 19,
    marginBottom: 4,
  },
  countdownBox: {
    backgroundColor: '#FFF5F5',
    borderWidth: 1.5,
    borderColor: '#FFB3B3',
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: 20,
    alignItems: 'center',
    marginBottom: 6,
    width: '100%',
  },
  countdownLabel: {
    fontSize: 12,
    color: colors.red,
    fontWeight: '600',
    marginBottom: 2,
  },
  countdownTime: {
    fontSize: 28,
    fontWeight: '800',
    color: colors.red,
    fontVariant: ['tabular-nums'],
  },
  autoCancelNote: {
    fontSize: 13,
    color: colors.red,
    fontWeight: '600',
    marginBottom: 4,
  },
  startBtn: {
    backgroundColor: colors.primary,
    paddingVertical: 15,
    borderRadius: 14,
    alignItems: 'center',
    width: '100%',
  },
  startBtnText: { color: colors.white, fontSize: 15, fontWeight: '700' },
  cancelBtn: {
    paddingVertical: 13,
    borderRadius: 14,
    alignItems: 'center',
    width: '100%',
    borderWidth: 1.5,
    borderColor: '#FFB3B3',
    backgroundColor: '#FFF5F5',
  },
  cancelBtnText: { color: colors.red, fontSize: 14, fontWeight: '700' },
  btnDisabled: { opacity: 0.6 },
});