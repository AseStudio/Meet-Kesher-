import React, { useState, useEffect, useCallback } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, TextInput,
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
  success: colors.green,
};

export default function ChannelsTab({ navigation, isHost, isVerified }) {
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [channels, setChannels] = useState([]);
  const [myChannelIds, setMyChannelIds] = useState(new Set());
  const [userId, setUserId] = useState(null);

  const loadChannels = useCallback(async (search) => {
    setLoading(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      setUserId(user?.id ?? null);

      let request = supabase
        .from('channels')
        .select('id, name, topic, description, member_count, trending_score, host_id')
        .eq('is_public', true)
        .order('trending_score', { ascending: false })
        .limit(50);

      if (search) {
        // ilike across name + topic — simpler and more forgiving than a
        // tsvector match for a short "type to filter" search box. Fine
        // at this table size; if the channels table gets large, swap
        // this for a proper full-text query against the GIN index the
        // migration created, or add a pg_trgm index for ilike.
        request = request.or(`name.ilike.%${search}%,topic.ilike.%${search}%`);
      }

      const { data, error } = await request;
      if (error) throw error;
      setChannels(data || []);

      if (user) {
        const { data: memberships } = await supabase
          .from('channel_roles')
          .select('channel_id')
          .eq('user_id', user.id);
        setMyChannelIds(new Set((memberships || []).map((m) => m.channel_id)));
      }
    } catch (e) {
      showAlert('Could not load channels', e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadChannels('');
  }, [loadChannels]);

  const joinChannel = async (channelId) => {
    if (!userId) return;
    // Optimistic — RLS (channel_roles_insert_self) is the real guard;
    // this just avoids a round-trip before the button visibly updates.
    setMyChannelIds((prev) => new Set(prev).add(channelId));
    const { error } = await supabase
      .from('channel_roles')
      .insert({ channel_id: channelId, user_id: userId, role: 'member' });
    if (error) {
      setMyChannelIds((prev) => {
        const next = new Set(prev);
        next.delete(channelId);
        return next;
      });
      showAlert('Could not join channel', error.message);
    }
  };

  const renderItem = ({ item }) => {
    const joined = myChannelIds.has(item.id);
    return (
      <TouchableOpacity
        style={styles.card}
        activeOpacity={0.85}
        onPress={() => {
          if (joined) {
            navigation.navigate('ChannelChat', { channelId: item.id, channelName: item.name });
          } else {
            joinChannel(item.id);
          }
        }}
      >
        <View style={styles.cardIcon}>
          <Ionicons name="people" size={20} color={palette.primary} />
        </View>
        <View style={styles.cardBody}>
          <Text style={styles.cardTitle} numberOfLines={1}>{item.name}</Text>
          {!!item.topic && <Text style={styles.cardTopic} numberOfLines={1}>{item.topic}</Text>}
          <Text style={styles.cardMeta}>{item.member_count} member{item.member_count === 1 ? '' : 's'}</Text>
        </View>
        {joined ? (
          <View style={styles.joinedPill}>
            <Text style={styles.joinedPillText}>Open</Text>
          </View>
        ) : (
          <TouchableOpacity style={styles.joinBtn} onPress={() => joinChannel(item.id)} activeOpacity={0.8}>
            <Text style={styles.joinBtnText}>Join</Text>
          </TouchableOpacity>
        )}
      </TouchableOpacity>
    );
  };

  return (
    <View style={styles.container}>
      <View style={styles.searchRow}>
        <Ionicons name="search" size={16} color={palette.neutralText} style={{ marginRight: 8 }} />
        <TextInput
          style={styles.searchInput}
          placeholder="Search channels by topic..."
          placeholderTextColor={palette.neutralText}
          value={query}
          onChangeText={setQuery}
          onSubmitEditing={() => loadChannels(query)}
          returnKeyType="search"
        />
      </View>

      {isHost && !isVerified && (
        <View style={styles.verifyNotice}>
          <Ionicons name="information-circle-outline" size={16} color={palette.inkMuted} />
          <Text style={styles.verifyNoticeText}>
            Creating a channel needs 100+ session joins in the last 30 days. Keep hosting — this unlocks automatically.
          </Text>
        </View>
      )}

      {loading ? (
        <ActivityIndicator style={{ marginTop: 40 }} color={palette.primary} />
      ) : (
        <FlatList
          data={channels}
          keyExtractor={(item) => item.id}
          renderItem={renderItem}
          contentContainerStyle={styles.listContent}
          ListEmptyComponent={
            <View style={styles.emptyState}>
              <Text style={styles.emptyStateText}>
                {query ? 'No channels match that search.' : 'No channels yet — be the first to find one worth joining.'}
              </Text>
            </View>
          }
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  searchRow: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: palette.surface,
    borderRadius: 13, borderWidth: 1, borderColor: palette.line,
    marginHorizontal: 20, paddingHorizontal: 14, marginBottom: 14,
  },
  searchInput: { flex: 1, paddingVertical: 12, fontSize: 14, color: palette.ink, outlineStyle: 'none' },

  verifyNotice: {
    flexDirection: 'row', gap: 8, backgroundColor: palette.primarySoft,
    marginHorizontal: 20, borderRadius: 12, padding: 12, marginBottom: 14, alignItems: 'flex-start',
  },
  verifyNoticeText: { flex: 1, fontSize: 12, color: palette.inkMuted, lineHeight: 17 },

  listContent: { paddingHorizontal: 20, paddingBottom: 20 },
  card: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: palette.surface,
    borderRadius: 16, padding: 14, marginBottom: 10, gap: 12,
  },
  cardIcon: { width: 40, height: 40, borderRadius: 12, backgroundColor: palette.primarySoft, alignItems: 'center', justifyContent: 'center' },
  cardBody: { flex: 1 },
  cardTitle: { fontSize: 14.5, fontWeight: '700', color: palette.ink },
  cardTopic: { fontSize: 12, color: palette.inkMuted, marginTop: 2 },
  cardMeta: { fontSize: 11, color: palette.neutralText, marginTop: 3, fontWeight: '600' },

  joinBtn: { backgroundColor: palette.primary, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 8 },
  joinBtnText: { color: palette.surface, fontWeight: '700', fontSize: 12.5 },
  joinedPill: { backgroundColor: palette.primarySoft, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 8 },
  joinedPillText: { color: palette.primary, fontWeight: '700', fontSize: 12.5 },

  emptyState: { paddingVertical: 50, alignItems: 'center' },
  emptyStateText: { color: palette.neutralText, fontSize: 13, textAlign: 'center', paddingHorizontal: 30 },
});
