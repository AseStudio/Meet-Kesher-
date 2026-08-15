import React, { useState, useRef } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, Modal } from 'react-native';
import { colors } from '../../theme/colors';
import { Animated } from 'react-native';

const reactions = ['👍', '👏', '❤️', '😂', '🔥', '😮'];
const signals = [
  { icon: '✋', label: 'Raise Hand', color: colors.yellow },
  { icon: '🔴', label: 'Point of Correction', color: colors.red },
  { icon: '💬', label: 'Want to Speak', color: colors.primary },
];

const signalQueue = [
  { id: 1, name: 'Alice', avatar: 'AL', signal: '✋', label: 'Raised Hand', time: '2 mins ago' },
  { id: 2, name: 'Ben', avatar: 'BE', signal: '🔴', label: 'Point of Correction', time: '1 min ago' },
  { id: 3, name: 'Liam', avatar: 'LI', signal: '💬', label: 'Wants to Speak', time: 'Just now' },
];

export default function ReactionsPanel({ navigation }) {
  const [activeSignal, setActiveSignal] = useState(null);
  const [floatingReactions, setFloatingReactions] = useState([]);

 const sendReaction = (emoji) => {
  const id = Date.now();
  const anim = new Animated.Value(0);

  setFloatingReactions(prev => [
    ...prev,
    { id, emoji, anim },
  ]);

  Animated.timing(anim, {
    toValue: 1,
    duration: 1800,
    useNativeDriver: true,
  }).start(() => {
    setFloatingReactions(prev =>
      prev.filter(r => r.id !== id)
    );
  });
};

  return (
    <View style={styles.container}>

      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <Text style={styles.backText}>←</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Reactions & Signals</Text>
        <View style={{ width: 24 }} />
      </View>

      <ScrollView contentContainerStyle={styles.scroll}>

        {/* Floating Reactions Preview */}
       {floatingReactions.map(r => (
  <Animated.Text
    key={r.id}
    style={[
      styles.floatingEmoji,
      {
        transform: [
          {
            translateY: r.anim.interpolate({
              inputRange: [0, 1],
              outputRange: [20, -80],
            }),
          },
        ],
        opacity: r.anim.interpolate({
          inputRange: [0, 1],
          outputRange: [1, 0],
        }),
      },
    ]}
  >
    {r.emoji}
  </Animated.Text>
))}

        {/* Signals */}
        <Text style={styles.sectionTitle}>📢 Signals</Text>
        <Text style={styles.sectionSubtitle}>Persist until dismissed by host</Text>
        <View style={styles.signalRow}>
          {signals.map((s, i) => (
            <TouchableOpacity
              key={i}
              style={[styles.signalBtn, activeSignal === i && { borderColor: s.color, backgroundColor: s.color + '22' }]}
              onPress={() => setActiveSignal(activeSignal === i ? null : i)}
            >
              <Text style={styles.signalIcon}>{s.icon}</Text>
              <Text style={[styles.signalLabel, activeSignal === i && { color: s.color }]}>{s.label}</Text>
              {activeSignal === i && <View style={[styles.activeDot, { backgroundColor: s.color }]} />}
            </TouchableOpacity>
          ))}
        </View>

        {/* Reactions */}
        <Text style={styles.sectionTitle}>😊 Reactions</Text>
        <Text style={styles.sectionSubtitle}>Float up the screen for 3 seconds</Text>
      
           <View style={styles.reactionGrid}>
  {reactions.map((emoji, i) => (
    <TouchableOpacity
      key={i}
      activeOpacity={0.8}
      style={styles.reactionBtn}
      onPress={() => sendReaction(emoji)}
    >
      <Text style={styles.reactionEmoji}>
        {emoji}
      </Text>
    </TouchableOpacity>
  ))}
</View>

        {/* Signals Tray (Host View) */}
        <View style={styles.trayCard}>
          <View style={styles.trayHeader}>
            <Text style={styles.trayTitle}>📥 Signals Tray</Text>
            <View style={styles.trayBadge}>
              <Text style={styles.trayBadgeText}>{signalQueue.length}</Text>
            </View>
          </View>
          <Text style={styles.traySubtitle}>Host view — call on attendees in order</Text>
          {signalQueue.map(item => (
            <View key={item.id} style={styles.trayRow}>
              <View style={styles.trayAvatar}>
                <Text style={styles.trayAvatarText}>{item.avatar}</Text>
              </View>
              <View style={styles.trayInfo}>
                <Text style={styles.trayName}>{item.name}</Text>
                <Text style={styles.traySignal}>{item.signal} {item.label}</Text>
                <Text style={styles.trayTime}>{item.time}</Text>
              </View>
              <TouchableOpacity style={styles.callOnBtn}>
                <Text style={styles.callOnText}>Call On</Text>
              </TouchableOpacity>
            </View>
          ))}
        </View>

      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0A0A1A' },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 16, paddingTop: 40, backgroundColor: '#0D0D2B' },
  backText: { fontSize: 24, color: colors.white },
  headerTitle: { fontSize: 18, fontWeight: '700', color: colors.white },
  scroll: { padding: 20, gap: 16 },
  previewArea: { height: 120, backgroundColor: '#1E1E3F', borderRadius: 16, alignItems: 'center', justifyContent: 'center', marginBottom: 8, overflow: 'hidden', position: 'relative' },
  floatingEmoji: { position: 'absolute', fontSize: 32, bottom: 10, left: '45%' },
  previewHint: { color: 'rgba(255,255,255,0.3)', fontSize: 12, textAlign: 'center' },
  sectionTitle: { fontSize: 16, fontWeight: '700', color: colors.white },
  sectionSubtitle: { fontSize: 12, color: 'rgba(255,255,255,0.4)', marginTop: -10 },
  signalRow: { flexDirection: 'row', gap: 10 },
signalBtn: {
  flex: 1,
  alignItems: 'center',
  justifyContent: 'center',
  gap: 8,
  paddingVertical: 18,
  backgroundColor: '#1E1E3F',
  borderRadius: 16,
  borderWidth: 1.5,
  borderColor: 'rgba(255,255,255,0.08)',
},
  signalIcon: { fontSize: 28 },
  signalLabel: { fontSize: 11, color: 'rgba(255,255,255,0.7)', textAlign: 'center', fontWeight: '600' },
  activeDot: { width: 8, height: 8, borderRadius: 4, position: 'absolute', top: 8, right: 8 },
  reactionGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  reactionEmoji: { fontSize: 36 },
  reactionBtn: {
  width: 72,
  height: 72,
  borderRadius: 20,
  backgroundColor: '#1E1E3F',
  alignItems: 'center',
  justifyContent: 'center',
  borderWidth: 1,
  borderColor: 'rgba(255,255,255,0.08)',
},
  trayCard: { backgroundColor: '#1E1E3F', borderRadius: 16, padding: 16, gap: 12 },
  trayHeader: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  trayTitle: { fontSize: 16, fontWeight: '700', color: colors.white },
  trayBadge: { backgroundColor: colors.primary, width: 24, height: 24, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  trayBadgeText: { color: colors.white, fontSize: 12, fontWeight: '700' },
  traySubtitle: { fontSize: 12, color: 'rgba(255,255,255,0.4)', marginTop: -8 },
 trayRow: {
  flexDirection: 'row',
  alignItems: 'center',
  gap: 12,
  paddingVertical: 12,
  borderTopWidth: 1,
  borderTopColor: 'rgba(255,255,255,0.06)',
},
 trayAvatar: {
  width: 42,
  height: 42,
  borderRadius: 21,
},
trayAvatarText: { color: colors.white, fontWeight: '700', fontSize: 12 },
  trayInfo: { flex: 1 },
  trayName: { color: colors.white, fontWeight: '700', fontSize: 14 },
  traySignal: { color: 'rgba(255,255,255,0.6)', fontSize: 12, marginTop: 2 },
  trayTime: { color: 'rgba(255,255,255,0.3)', fontSize: 11, marginTop: 2 },
  callOnBtn: { backgroundColor: colors.primary, paddingHorizontal: 14, paddingVertical: 8, borderRadius: 10 },
  callOnText: { color: colors.white, fontWeight: '700', fontSize: 13 },
  transform: [{ scale: 1.02 }]
});