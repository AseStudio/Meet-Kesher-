import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { colors } from '../../theme/colors';

const boards = [
  { id: 'whiteboard', label: 'Whiteboard', emoji: '⬜', desc: 'Clean white canvas for drawing and writing' },
  { id: 'blackboard', label: 'Blackboard', emoji: '🟫', desc: 'Classic chalkboard feel with chalk brushes' },
  { id: 'graphboard', label: 'Graph Board', emoji: '📊', desc: 'Plot functions and build data charts' },
];

export default function BoardSelector({ navigation }) {
  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <Text style={styles.backText}>←</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>🖊️ Select Board</Text>
        <View style={{ width: 24 }} />
      </View>

      <View style={styles.content}>
        <Text style={styles.subtitle}>Choose a board to open for your session</Text>
        {boards.map(board => (
          <TouchableOpacity
            key={board.id}
            style={styles.boardCard}
            onPress={() => navigation.navigate(
              board.id === 'whiteboard' ? 'Whiteboard' :
              board.id === 'blackboard' ? 'Blackboard' : 'GraphBoard'
            )}
          >
            <Text style={styles.boardEmoji}>{board.emoji}</Text>
            <View style={styles.boardInfo}>
              <Text style={styles.boardLabel}>{board.label}</Text>
              <Text style={styles.boardDesc}>{board.desc}</Text>
            </View>
            <Text style={styles.boardArrow}>›</Text>
          </TouchableOpacity>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0A0A1A' },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 16, paddingTop: 40, backgroundColor: '#0D0D2B' },
  backText: { fontSize: 24, color: colors.white },
  headerTitle: { fontSize: 18, fontWeight: '700', color: colors.white },
  content: { padding: 24, gap: 14 },
  subtitle: { color: 'rgba(255,255,255,0.5)', fontSize: 14, marginBottom: 8 },
  boardCard: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#1E1E3F', borderRadius: 16, padding: 18, gap: 14, borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)' },
  boardEmoji: { fontSize: 36 },
  boardInfo: { flex: 1 },
  boardLabel: { fontSize: 17, fontWeight: '700', color: colors.white },
  boardDesc: { fontSize: 13, color: 'rgba(255,255,255,0.5)', marginTop: 4 },
  boardArrow: { color: 'rgba(255,255,255,0.4)', fontSize: 24 },
});