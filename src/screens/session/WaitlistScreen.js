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
  danger: colors.red,
  dangerSoft: '#FFE9E9',
};

function timeAgo(iso) {
  if (!iso) return '';
  const secs = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (secs < 60) return 'just now';
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  return `${hrs}h ago`;
}

/**
 * Route params: { session }
 *
 * Host-only visibility into session_waitlist — reached from the
 * "N waiting" badge in LobbyScreen's Host Controls. RLS
 * (session_waitlist_select) already restricts this table's rows to
 * "your own row, or a session you host", so a non-host landing here
 * would just see an empty list rather than anyone else's data.
 *
 * "Let in now" deliberately does NOT bypass the capacity trigger from
 * 003_session_capacity.sql — it makes the exact same insert an
 * auto-promotion would, so if the session is still genuinely full,
 * this fails with a clear message instead of silently overriding the
 * cap. That's intentional: the cap exists for cost control, and a
 * per-person "let my friend skip the line" override would defeat that
 * the same as raising the cap would. Removing someone first (here or
 * in SessionMain's controls) is what actually opens a spot — this
 * button is for the case where a spot is open but auto-promotion
 * hasn't caught up yet (a brief race window), not a queue-skip.
 */
export default function WaitlistScreen({ navigation, route }) {
  const session = route?.params?.session;
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState([]);
  const [busyId, setBusyId] = useState(null);

  const load = useCallback(async () => {
    if (!session?.id) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('session_waitlist')
        .select('id, user_id, joined_at, profiles(full_name)')
        .eq('session_id', session.id)
        .order('joined_at', { ascending: true });
      if (error) throw error;
      setRows(data || []);
    } catch (e) {
      showAlert('Could not load waitlist', e.message);
    } finally {
      setLoading(false);
    }
  }, [session?.id]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (!session?.id) return;
    const ch = supabase
      .channel(`waitlist-screen-${session.id}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'session_waitlist', filter: `session_id=eq.${session.id}` },
        () => load()
      )
      .subscribe();
    return () => supabase.removeChannel(ch);
  }, [session?.id, load]);

  const letInNow = async (row) => {
    setBusyId(row.id);
    const { error: insertError } = await supabase
      .from('session_attendees')
      .insert({ session_id: session.id, user_id: row.user_id });

    if (insertError) {
      setBusyId(null);
      if (insertError.message?.toLowerCase().includes('full')) {
        showAlert('Still full', 'There\'s no open spot right now — remove an attendee first, or wait for one to leave.');
      } else {
        showAlert('Could not add attendee', insertError.message);
      }
      return;
    }

    await supabase.from('session_waitlist').delete().eq('id', row.id);
    setBusyId(null);
  };

  const removeFromWaitlist = async (row) => {
    setBusyId(row.id);
    const { error } = await supabase.from('session_waitlist').delete().eq('id', row.id);
    setBusyId(null);
    if (error) showAlert('Could not remove', error.message);
  };

  const renderItem = ({ item, index }) => {
    const name = item.profiles?.full_name || 'Someone';
    const busy = busyId === item.id;
    return (
      <View style={styles.row}>
        <View style={styles.positionChip}>
          <Text style={styles.positionChipText}>{index + 1}</Text>
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.name} numberOfLines={1}>{name}</Text>
          <Text style={styles.joinedAt}>Waiting {timeAgo(item.joined_at)}</Text>
        </View>
        {busy ? (
          <ActivityIndicator color={palette.primary} />
        ) : (
          <View style={styles.actions}>
            <TouchableOpacity style={styles.letInBtn} onPress={() => letInNow(item)} activeOpacity={0.8}>
              <Text style={styles.letInBtnText}>Let in</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.removeBtn} onPress={() => removeFromWaitlist(item)} activeOpacity={0.8}>
              <Ionicons name="close" size={15} color={palette.danger} />
            </TouchableOpacity>
          </View>
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
        <Text style={styles.headerTitle}>Waitlist</Text>
        <View style={{ width: 22 }} />
      </View>

      {loading ? (
        <ActivityIndicator style={{ marginTop: 40 }} color={palette.primary} />
      ) : (
        <FlatList
          data={rows}
          keyExtractor={(item) => item.id}
          renderItem={renderItem}
          contentContainerStyle={styles.listContent}
          ListEmptyComponent={
            <View style={styles.emptyState}>
              <Ionicons name="hourglass-outline" size={28} color={palette.neutralText} />
              <Text style={styles.emptyStateText}>No one's waiting right now.</Text>
            </View>
          }
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: palette.canvas },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 20, paddingBottom: 8 },
  backBtn: { padding: 2 },
  headerTitle: { fontSize: 17, fontWeight: '800', color: palette.ink },

  listContent: { paddingHorizontal: 20, paddingBottom: 20 },
  row: { flexDirection: 'row', alignItems: 'center', backgroundColor: palette.surface, borderRadius: 14, padding: 12, marginBottom: 8, gap: 12 },
  positionChip: { width: 30, height: 30, borderRadius: 10, backgroundColor: palette.primarySoft, alignItems: 'center', justifyContent: 'center' },
  positionChipText: { fontSize: 13, fontWeight: '800', color: palette.primary },
  name: { fontSize: 13.5, fontWeight: '700', color: palette.ink },
  joinedAt: { fontSize: 11.5, color: palette.neutralText, marginTop: 2, fontWeight: '600' },

  actions: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  letInBtn: { backgroundColor: palette.primary, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8 },
  letInBtnText: { color: palette.surface, fontWeight: '700', fontSize: 12 },
  removeBtn: { width: 30, height: 30, borderRadius: 10, backgroundColor: palette.dangerSoft, alignItems: 'center', justifyContent: 'center' },

  emptyState: { alignItems: 'center', gap: 10, paddingTop: 60 },
  emptyStateText: { color: palette.neutralText, fontSize: 13, textAlign: 'center' },
});
