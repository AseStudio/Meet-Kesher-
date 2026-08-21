import React, { useState, useEffect, useCallback } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity,
  FlatList, ActivityIndicator, Alert
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '../../theme/colors';
import { supabase } from '../../lib/supabase';
import { showAlert } from '../../lib/alert';

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

/**
 * Route params: { channelId, channelName }
 *
 * Only reachable from ChannelChatScreen's header for the supervisor —
 * the actual permission check lives in channel_roles_update_by_supervisor
 * (RLS), so this screen doesn't need its own guard beyond not being
 * linked to for non-supervisors.
 */
export default function ChannelRolesScreen({ navigation, route }) {
  const { channelId, channelName } = route.params;
  const [loading, setLoading] = useState(true);
  const [members, setMembers] = useState([]);
  const [updatingId, setUpdatingId] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      // profiles(name/email) join assumes those columns exist on your
      // profiles table (referenced elsewhere in the app, e.g.
      // Profile.js) — swap the select list if your columns differ.
      const { data, error } = await supabase
        .from('channel_roles')
        .select('user_id, role, joined_at, profiles(full_name, email)')
        .eq('channel_id', channelId)
        .order('role', { ascending: true }); // supervisor, then assistant_supervisor, then member (alphabetical happens to work here)
      if (error) throw error;
      setMembers(data || []);
    } catch (e) {
      showAlert('Could not load members', e.message);
    } finally {
      setLoading(false);
    }
  }, [channelId]);

  useEffect(() => { load(); }, [load]);

  const setRole = async (userId, role) => {
    setUpdatingId(userId);
    const { error } = await supabase
      .from('channel_roles')
      .update({ role })
      .eq('channel_id', channelId)
      .eq('user_id', userId);
    setUpdatingId(null);
    if (error) {
      showAlert('Could not update role', error.message);
      return;
    }
    setMembers((prev) => prev.map((m) => (m.user_id === userId ? { ...m, role } : m)));
  };

  const renderItem = ({ item }) => {
    const name = item.profiles?.full_name || item.profiles?.email || 'Member';
    const isSupervisor = item.role === 'supervisor';
    const isAssistant = item.role === 'assistant_supervisor';

    return (
      <View style={styles.row}>
        <View style={styles.avatar}>
          <Text style={styles.avatarText}>{name.charAt(0).toUpperCase()}</Text>
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.name} numberOfLines={1}>{name}</Text>
          <Text style={styles.roleLabel}>
            {isSupervisor ? 'Supervisor' : isAssistant ? 'Assistant supervisor' : 'Member'}
          </Text>
        </View>

        {!isSupervisor && (
          updatingId === item.user_id ? (
            <ActivityIndicator color={palette.primary} />
          ) : (
            <TouchableOpacity
              style={isAssistant ? styles.demoteBtn : styles.promoteBtn}
              onPress={() => setRole(item.user_id, isAssistant ? 'member' : 'assistant_supervisor')}
              activeOpacity={0.8}
            >
              <Text style={isAssistant ? styles.demoteBtnText : styles.promoteBtnText}>
                {isAssistant ? 'Remove as assistant' : 'Make assistant'}
              </Text>
            </TouchableOpacity>
          )
        )}
      </View>
    );
  };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={22} color={palette.ink} />
        </TouchableOpacity>
        <Text style={styles.headerTitle} numberOfLines={1}>{channelName} · Roles</Text>
        <View style={{ width: 22 }} />
      </View>

      <Text style={styles.helperText}>
        Assistant supervisors can post in the channel chat alongside you. Everyone else can only react.
      </Text>

      {loading ? (
        <ActivityIndicator style={{ marginTop: 40 }} color={palette.primary} />
      ) : (
        <FlatList
          data={members}
          keyExtractor={(item) => item.user_id}
          renderItem={renderItem}
          contentContainerStyle={styles.listContent}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: palette.canvas },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 20, paddingBottom: 8 },
  backBtn: { padding: 2 },
  headerTitle: { flex: 1, textAlign: 'center', fontSize: 15.5, fontWeight: '800', color: palette.ink, marginHorizontal: 10 },
  helperText: { fontSize: 12, color: palette.inkMuted, paddingHorizontal: 20, marginBottom: 14, lineHeight: 17 },

  listContent: { paddingHorizontal: 20, paddingBottom: 20 },
  row: { flexDirection: 'row', alignItems: 'center', backgroundColor: palette.surface, borderRadius: 14, padding: 12, marginBottom: 8, gap: 12 },
  avatar: { width: 36, height: 36, borderRadius: 18, backgroundColor: palette.primarySoft, alignItems: 'center', justifyContent: 'center' },
  avatarText: { fontSize: 14, fontWeight: '700', color: palette.primary },
  name: { fontSize: 13.5, fontWeight: '700', color: palette.ink },
  roleLabel: { fontSize: 11.5, color: palette.neutralText, marginTop: 2, fontWeight: '600' },

  promoteBtn: { backgroundColor: palette.primarySoft, borderRadius: 10, paddingHorizontal: 11, paddingVertical: 8 },
  promoteBtnText: { color: palette.primary, fontWeight: '700', fontSize: 11.5 },
  demoteBtn: { backgroundColor: palette.line, borderRadius: 10, paddingHorizontal: 11, paddingVertical: 8 },
  demoteBtnText: { color: palette.neutralText, fontWeight: '700', fontSize: 11.5 },
});
