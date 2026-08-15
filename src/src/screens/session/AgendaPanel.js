import React, { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, TextInput, ScrollView } from 'react-native';
import { colors } from '../../theme/colors';

const initialItems = [
  { id: 1, title: 'Introduction & Setup', duration: '05 mins', done: true },
  { id: 2, title: 'Interactive UI Critique', duration: '20 mins', done: true },
  { id: 3, title: 'Group Discussion', duration: '15 mins', done: false },
  { id: 4, title: 'Q&A Session', duration: '10 mins', done: false },
  { id: 5, title: 'Wrap Up', duration: '05 mins', done: false },
];

export default function AgendaPanel({ navigation }) {
  const [items, setItems] = useState(initialItems);
  const [newTitle, setNewTitle] = useState('');
  const [newDuration, setNewDuration] = useState('');
  const [isHost] = useState(true);

  const toggleDone = (id) => {
    setItems(items.map(item => item.id === id ? { ...item, done: !item.done } : item));
  };

  const addItem = () => {
    if (!newTitle.trim()) return;
    setItems([...items, { id: Date.now(), title: newTitle, duration: newDuration || '10 mins', done: false }]);
    setNewTitle('');
    setNewDuration('');
  };

  const completed = items.filter(i => i.done).length;
  const progress = (completed / items.length) * 100;

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <Text style={styles.backText}>←</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>📋 Agenda</Text>
        <View style={{ width: 24 }} />
      </View>

      <ScrollView contentContainerStyle={styles.scroll}>

        {/* Progress */}
        <View style={styles.progressCard}>
          <View style={styles.progressHeader}>
            <Text style={styles.progressTitle}>Session Progress</Text>
            <Text style={styles.progressCount}>{completed}/{items.length} items</Text>
          </View>
          <View style={styles.progressBar}>
            <View style={[styles.progressFill, { width: `${progress}%` }]} />
          </View>
          <Text style={styles.progressPercent}>{Math.round(progress)}% complete</Text>
        </View>

        {/* Agenda Items */}
        <Text style={styles.sectionTitle}>Agenda Items</Text>
        {items.map((item, i) => (
          <TouchableOpacity
            key={item.id}
            style={[styles.agendaItem, item.done && styles.agendaItemDone]}
            onPress={() => isHost && toggleDone(item.id)}
          >
            <View style={[styles.checkbox, item.done && styles.checkboxDone]}>
              {item.done && <Text style={styles.checkmark}>✓</Text>}
            </View>
            <View style={styles.itemInfo}>
              <Text style={[styles.itemTitle, item.done && styles.itemTitleDone]}>{item.title}</Text>
              <Text style={styles.itemDuration}>⏱ {item.duration}</Text>
            </View>
            <View style={[styles.itemNumber, item.done && styles.itemNumberDone]}>
              <Text style={styles.itemNumberText}>{i + 1}</Text>
            </View>
          </TouchableOpacity>
        ))}

        {/* Add Item (Host only) */}
        {isHost && (
          <View style={styles.addCard}>
            <Text style={styles.addTitle}>+ Add Agenda Item</Text>
            <TextInput
              style={styles.addInput}
              placeholder="Item title..."
              placeholderTextColor="rgba(255,255,255,0.3)"
              value={newTitle}
              onChangeText={setNewTitle}
            />
            <TextInput
              style={styles.addInput}
              placeholder="Duration (e.g. 10 mins)"
              placeholderTextColor="rgba(255,255,255,0.3)"
              value={newDuration}
              onChangeText={setNewDuration}
            />
            <TouchableOpacity style={styles.addBtn} onPress={addItem}>
              <Text style={styles.addBtnText}>Add Item</Text>
            </TouchableOpacity>
          </View>
        )}

      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0A0A1A' },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 16, paddingTop: 40, backgroundColor: '#0D0D2B' },
  backText: { fontSize: 24, color: colors.white },
  headerTitle: { fontSize: 18, fontWeight: '700', color: colors.white },
  scroll: { padding: 20, gap: 12 },
  progressCard: { backgroundColor: '#1E1E3F', borderRadius: 16, padding: 16, gap: 8 },
  progressHeader: { flexDirection: 'row', justifyContent: 'space-between' },
  progressTitle: { color: colors.white, fontWeight: '700', fontSize: 14 },
  progressCount: { color: colors.primaryLight, fontWeight: '600', fontSize: 14 },
  progressBar: { height: 8, backgroundColor: 'rgba(255,255,255,0.1)', borderRadius: 4 },
  progressFill: { height: 8, backgroundColor: colors.primary, borderRadius: 4 },
  progressPercent: { color: 'rgba(255,255,255,0.5)', fontSize: 12 },
  sectionTitle: { fontSize: 16, fontWeight: '700', color: colors.white },
  agendaItem: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#1E1E3F', borderRadius: 14, padding: 14, gap: 12, borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)' },
  agendaItemDone: { opacity: 0.6, borderColor: colors.green },
  checkbox: { width: 24, height: 24, borderRadius: 6, borderWidth: 2, borderColor: 'rgba(255,255,255,0.3)', alignItems: 'center', justifyContent: 'center' },
  checkboxDone: { backgroundColor: colors.green, borderColor: colors.green },
  checkmark: { color: colors.white, fontSize: 13, fontWeight: '700' },
  itemInfo: { flex: 1 },
  itemTitle: { color: colors.white, fontWeight: '600', fontSize: 14 },
  itemTitleDone: { textDecorationLine: 'line-through', color: 'rgba(255,255,255,0.4)' },
  itemDuration: { color: 'rgba(255,255,255,0.4)', fontSize: 12, marginTop: 3 },
  itemNumber: { width: 28, height: 28, borderRadius: 14, backgroundColor: 'rgba(91,46,255,0.3)', alignItems: 'center', justifyContent: 'center' },
  itemNumberDone: { backgroundColor: 'rgba(46,204,113,0.3)' },
  itemNumberText: { color: colors.white, fontSize: 12, fontWeight: '700' },
  addCard: { backgroundColor: '#1E1E3F', borderRadius: 16, padding: 16, gap: 10, borderWidth: 1, borderColor: 'rgba(91,46,255,0.3)', borderStyle: 'dashed' },
  addTitle: { color: colors.primaryLight, fontWeight: '700', fontSize: 14 },
  addInput: { backgroundColor: 'rgba(255,255,255,0.05)', borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, fontSize: 14, color: colors.white, borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)', outlineStyle: 'none' },
  addBtn: { backgroundColor: colors.primary, paddingVertical: 12, borderRadius: 10, alignItems: 'center' },
  addBtnText: { color: colors.white, fontWeight: '700', fontSize: 14 },
});