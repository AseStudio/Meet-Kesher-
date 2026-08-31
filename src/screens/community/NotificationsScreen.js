import React, { useState, useEffect, useCallback } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity,
  FlatList, ActivityIndicator, RefreshControl,
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

function getInitials(name) {
  return (name || 'U').split(' ').map((n) => n[0]).join('').slice(0, 2).toUpperCase();
}

function timeAgo(iso) {
  if (!iso) return '';
  const diffMs = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  return `${days}d`;
}

// The recipient of every row here was decided entirely server-side, by
// the notify_on_comment_reply() trigger walking the real
// parent_comment_id -> author_id chain — never by matching on a
// display name, which is exactly what makes this safe from the
// "two people named Alex" mixup a name-based approach would risk.
export default function NotificationsScreen({ navigation }) {
  const [notifications, setNotifications] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async (isRefresh) => {
    isRefresh ? setRefreshing(true) : setLoading(true);
    try {
      const { data, error } = await supabase
        .from('notifications')
        .select('*, actor:actor_id(full_name, username)')
        .order('created_at', { ascending: false })
        .limit(50);
      if (error) throw error;
      setNotifications(data || []);
    } catch (e) {
      showAlert('Could not load notifications', e.message);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { load(false); }, [load]);

  const openNotification = async (n) => {
    if (!n.read) {
      setNotifications((prev) => prev.map((x) => (x.id === n.id ? { ...x, read: true } : x)));
      supabase.from('notifications').update({ read: true }).eq('id', n.id).then();
    }
    if (n.post_id) {
      navigation.navigate('PostComments', { post: { id: n.post_id } });
    }
  };

  return (
    <View style={styles.container}>
      <View style={styles.topRow}>
        <TouchableOpacity onPress={() => navigation.goBack()} activeOpacity={0.7} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={20} color={palette.ink} />
        </TouchableOpacity>
        <Text style={styles.title}>Notifications</Text>
        <View style={{ width: 32 }} />
      </View>

      {loading ? (
        <ActivityIndicator style={{ marginTop: 40 }} color={palette.primary} />
      ) : (
        <FlatList
          data={notifications}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.list}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => load(true)} tintColor={palette.primary} />}
          renderItem={({ item }) => (
            <TouchableOpacity
              style={[styles.row, !item.read && styles.rowUnread]}
              onPress={() => openNotification(item)}
              activeOpacity={0.75}
            >
              <View style={styles.avatar}>
                <Text style={styles.avatarText}>{getInitials(item.actor?.full_name)}</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.rowText}>
                  <Text style={styles.rowActor}>{item.actor?.username ? `@${item.actor.username}` : (item.actor?.full_name || 'Someone')}</Text>
                  {' replied to your comment'}
                </Text>
                {item.body_preview ? <Text style={styles.rowPreview} numberOfLines={1}>{item.body_preview}</Text> : null}
                <Text style={styles.rowTime}>{timeAgo(item.created_at)}</Text>
              </View>
              {!item.read && <View style={styles.unreadDot} />}
            </TouchableOpacity>
          )}
          ListEmptyComponent={
            <View style={styles.emptyState}>
              <Ionicons name="notifications-outline" size={30} color={palette.line} />
              <Text style={styles.emptyStateText}>No notifications yet.</Text>
            </View>
          }
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: palette.canvas },
  topRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingTop: 54, paddingBottom: 14,
  },
  backBtn: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 17, fontWeight: '800', color: palette.ink },

  list: { paddingHorizontal: 16, paddingBottom: 20 },
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, backgroundColor: palette.surface, borderRadius: 14, padding: 12, marginBottom: 8 },
  rowUnread: { backgroundColor: palette.primarySoft },
  avatar: { width: 36, height: 36, borderRadius: 18, backgroundColor: palette.surface, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: palette.line },
  avatarText: { fontSize: 12.5, fontWeight: '800', color: palette.primary },
  rowText: { fontSize: 13.5, color: palette.ink, lineHeight: 19 },
  rowActor: { fontWeight: '800' },
  rowPreview: { fontSize: 12, color: palette.inkMuted, marginTop: 2, fontStyle: 'italic' },
  rowTime: { fontSize: 11, color: palette.neutralText, fontWeight: '500', marginTop: 4 },
  unreadDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: palette.primary, marginTop: 4 },

  emptyState: { paddingTop: 60, alignItems: 'center', gap: 10 },
  emptyStateText: { color: palette.neutralText, fontSize: 13, fontWeight: '500' },
});
