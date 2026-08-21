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
  success: colors.green,
  successSoft: '#E7FBF0',
  amber: colors.yellow,
  amberSoft: '#FFF3DE',
};

export default function FeedTab({ isHost, isVerified }) {
  const [loading, setLoading] = useState(true);
  const [drafts, setDrafts] = useState([]); // this user's own achievement drafts awaiting a decision
  const [posts, setPosts] = useState([]); // published feed
  const [userId, setUserId] = useState(null);
  const [myReactions, setMyReactions] = useState(new Set());

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      setUserId(user.id);

      const { data: draftRows } = await supabase
        .from('feed_posts')
        .select('*')
        .eq('author_id', user.id)
        .eq('status', 'draft')
        .order('created_at', { ascending: false });
      setDrafts(draftRows || []);

      const { data: publishedRows, error } = await supabase
        .from('feed_posts')
        .select('*, channels(name)')
        .eq('status', 'published')
        .order('created_at', { ascending: false })
        .limit(50);
      if (error) throw error;
      setPosts(publishedRows || []);

      const { data: reactionRows } = await supabase
        .from('feed_post_reactions')
        .select('post_id')
        .eq('user_id', user.id);
      setMyReactions(new Set((reactionRows || []).map((r) => r.post_id)));
    } catch (e) {
      showAlert('Could not load feed', e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  // "Show it off" / "Dismiss" — the only two states an achievement
  // draft can move to, per the update policy in the migration
  // (feed_posts_update_own_draft only allows draft -> published/dismissed).
  const decideDraft = async (post, decision) => {
    setDrafts((prev) => prev.filter((d) => d.id !== post.id));
    const { error } = await supabase
      .from('feed_posts')
      .update({ status: decision, published_at: decision === 'published' ? new Date().toISOString() : null })
      .eq('id', post.id);
    if (error) {
      showAlert('Could not update', error.message);
      load();
      return;
    }
    if (decision === 'published') load();
  };

  const toggleReaction = async (postId) => {
    if (!userId) return;
    const already = myReactions.has(postId);
    setMyReactions((prev) => {
      const next = new Set(prev);
      already ? next.delete(postId) : next.add(postId);
      return next;
    });
    if (already) {
      await supabase.from('feed_post_reactions').delete().eq('post_id', postId).eq('user_id', userId);
    } else {
      await supabase.from('feed_post_reactions').insert({ post_id: postId, user_id: userId, reaction: 'like' });
    }
  };

  return (
    <View style={styles.container}>
      {loading ? (
        <ActivityIndicator style={{ marginTop: 40 }} color={palette.primary} />
      ) : (
        <FlatList
          data={posts}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.listContent}
          ListHeaderComponent={
            drafts.length > 0 ? (
              <View style={{ marginBottom: 14 }}>
                {drafts.map((d) => (
                  <View key={d.id} style={styles.draftCard}>
                    <View style={styles.draftIconWrap}>
                      <Ionicons name="trophy" size={18} color={palette.amber} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.draftTitle}>New achievement</Text>
                      <Text style={styles.draftBody}>{d.body}</Text>
                      <View style={styles.draftActions}>
                        <TouchableOpacity style={styles.showOffBtn} onPress={() => decideDraft(d, 'published')} activeOpacity={0.85}>
                          <Text style={styles.showOffBtnText}>Show it off</Text>
                        </TouchableOpacity>
                        <TouchableOpacity style={styles.dismissBtn} onPress={() => decideDraft(d, 'dismissed')} activeOpacity={0.85}>
                          <Text style={styles.dismissBtnText}>Dismiss</Text>
                        </TouchableOpacity>
                      </View>
                    </View>
                  </View>
                ))}
              </View>
            ) : null
          }
          renderItem={({ item }) => {
            const reacted = myReactions.has(item.id);
            const isAd = item.type === 'advertisement';
            return (
              <View style={styles.postCard}>
                <View style={styles.postHeader}>
                  <View style={[styles.postIconWrap, isAd ? styles.postIconAd : styles.postIconAchievement]}>
                    <Ionicons name={isAd ? 'megaphone' : 'trophy'} size={16} color={isAd ? palette.primary : palette.amber} />
                  </View>
                  <Text style={styles.postKind}>{isAd ? 'Advertisement' : 'Achievement'}</Text>
                  {item.channels?.name && <Text style={styles.postChannel}>· {item.channels.name}</Text>}
                </View>
                <Text style={styles.postBody}>{item.body}</Text>
                <TouchableOpacity style={styles.reactionRow} onPress={() => toggleReaction(item.id)} activeOpacity={0.7}>
                  <Ionicons name={reacted ? 'heart' : 'heart-outline'} size={18} color={reacted ? palette.primary : palette.neutralText} />
                  <Text style={[styles.reactionText, reacted && { color: palette.primary }]}>{reacted ? 'Liked' : 'Like'}</Text>
                </TouchableOpacity>
              </View>
            );
          }}
          ListEmptyComponent={
            <View style={styles.emptyState}>
              <Text style={styles.emptyStateText}>Nothing in the feed yet — achievements and channel updates will show up here.</Text>
            </View>
          }
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  listContent: { paddingHorizontal: 20, paddingBottom: 20 },

  draftCard: {
    flexDirection: 'row', gap: 12, backgroundColor: palette.amberSoft,
    borderRadius: 16, padding: 14, marginBottom: 10, alignItems: 'flex-start',
  },
  draftIconWrap: { width: 34, height: 34, borderRadius: 10, backgroundColor: palette.surface, alignItems: 'center', justifyContent: 'center' },
  draftTitle: { fontSize: 13, fontWeight: '800', color: palette.ink },
  draftBody: { fontSize: 12.5, color: palette.inkMuted, marginTop: 3, lineHeight: 17 },
  draftActions: { flexDirection: 'row', gap: 8, marginTop: 10 },
  showOffBtn: { backgroundColor: palette.primary, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 7 },
  showOffBtnText: { color: palette.surface, fontWeight: '700', fontSize: 12 },
  dismissBtn: { backgroundColor: palette.surface, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 7 },
  dismissBtnText: { color: palette.neutralText, fontWeight: '700', fontSize: 12 },

  postCard: { backgroundColor: palette.surface, borderRadius: 16, padding: 14, marginBottom: 10 },
  postHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 },
  postIconWrap: { width: 28, height: 28, borderRadius: 9, alignItems: 'center', justifyContent: 'center' },
  postIconAchievement: { backgroundColor: palette.amberSoft },
  postIconAd: { backgroundColor: palette.primarySoft },
  postKind: { fontSize: 11.5, fontWeight: '700', color: palette.inkMuted },
  postChannel: { fontSize: 11.5, color: palette.neutralText, fontWeight: '600' },
  postBody: { fontSize: 14, color: palette.ink, lineHeight: 20 },
  reactionRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 10 },
  reactionText: { fontSize: 12.5, color: palette.neutralText, fontWeight: '600' },

  emptyState: { paddingVertical: 50, alignItems: 'center' },
  emptyStateText: { color: palette.neutralText, fontSize: 13, textAlign: 'center', paddingHorizontal: 30 },
});
