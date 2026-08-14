import React, { useState } from 'react';
import {
  View, Text, StyleSheet, TextInput, TouchableOpacity,
  Alert, ActivityIndicator, Switch
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '../../theme/colors';
import { supabase } from '../../lib/supabase';

const palette = {
  primary: colors.primary,
  primarySoft: colors.background,
  ink: colors.text,
  inkMuted: colors.textLight,
  surface: colors.white,
  canvas: colors.background,
  line: colors.greyLight,
  neutralText: colors.grey,
};

export default function CreateChannelScreen({ navigation }) {
  const [name, setName] = useState('');
  const [topic, setTopic] = useState('');
  const [description, setDescription] = useState('');
  const [isPublic, setIsPublic] = useState(true);
  const [saving, setSaving] = useState(false);

  const create = async () => {
    if (!name.trim()) {
      Alert.alert('Name required', 'Give your channel a name.');
      return;
    }
    setSaving(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      // channels_insert RLS policy re-checks host_verification_stats.verified
      // server-side regardless of what the UI already gated on — this call
      // fails cleanly with a permission error if that ever drifts out of sync.
      const { data, error } = await supabase
        .from('channels')
        .insert({
          host_id: user.id,
          name: name.trim(),
          topic: topic.trim() || null,
          description: description.trim() || null,
          is_public: isPublic,
        })
        .select()
        .single();

      if (error) throw error;

      navigation.replace('ChannelChat', { channelId: data.id, channelName: data.name });
    } catch (e) {
      Alert.alert('Could not create channel', e.message);
      setSaving(false);
    }
  };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={22} color={palette.ink} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>New channel</Text>
        <View style={{ width: 22 }} />
      </View>

      <View style={styles.form}>
        <Text style={styles.label}>Name</Text>
        <TextInput
          style={styles.input}
          placeholder="e.g. HVAC Systems 101"
          placeholderTextColor={palette.neutralText}
          value={name}
          onChangeText={setName}
          maxLength={60}
        />

        <Text style={styles.label}>Topic</Text>
        <TextInput
          style={styles.input}
          placeholder="What's this channel about, in a few words?"
          placeholderTextColor={palette.neutralText}
          value={topic}
          onChangeText={setTopic}
          maxLength={80}
        />

        <Text style={styles.label}>Description</Text>
        <TextInput
          style={[styles.input, styles.textArea]}
          placeholder="Tell people what to expect — what you'll post, who this is for."
          placeholderTextColor={palette.neutralText}
          value={description}
          onChangeText={setDescription}
          multiline
          numberOfLines={4}
          maxLength={400}
        />

        <View style={styles.switchRow}>
          <View style={{ flex: 1 }}>
            <Text style={styles.label}>Public</Text>
            <Text style={styles.helperText}>Anyone can find and join. Turn off for invite-only.</Text>
          </View>
          <Switch
            value={isPublic}
            onValueChange={setIsPublic}
            trackColor={{ false: palette.line, true: palette.primary }}
          />
        </View>

        <TouchableOpacity style={styles.createBtn} onPress={create} disabled={saving} activeOpacity={0.85}>
          {saving ? <ActivityIndicator color={palette.surface} /> : <Text style={styles.createBtnText}>Create channel</Text>}
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: palette.canvas },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 20, paddingBottom: 8 },
  backBtn: { padding: 2 },
  headerTitle: { fontSize: 17, fontWeight: '800', color: palette.ink },

  form: { padding: 20 },
  label: { fontSize: 13, fontWeight: '700', color: palette.ink, marginBottom: 6, marginTop: 14 },
  helperText: { fontSize: 11.5, color: palette.inkMuted, marginTop: 2 },
  input: {
    backgroundColor: palette.surface, borderRadius: 12, borderWidth: 1, borderColor: palette.line,
    paddingHorizontal: 14, paddingVertical: 12, fontSize: 14, color: palette.ink, outlineStyle: 'none',
  },
  textArea: { minHeight: 90, textAlignVertical: 'top' },

  switchRow: { flexDirection: 'row', alignItems: 'center', marginTop: 18, gap: 12 },

  createBtn: { backgroundColor: palette.primary, borderRadius: 14, paddingVertical: 15, alignItems: 'center', marginTop: 26 },
  createBtnText: { color: palette.surface, fontWeight: '800', fontSize: 15 },
});
