import React, { useState, useEffect, useCallback } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, TextInput,
  FlatList, KeyboardAvoidingView, Platform, ActivityIndicator,
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
  danger: colors.red,
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

export default function PostCommentsScreen({ navigation, route }) {
  const post = route?.params?.post;
  const [comments, setComments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [body, setBody] = useState('');
  const [sending, setSending] = useState(false);
  const [userId, setUserId] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      setUserId(user?.id || null);

      const { data, error } = await supabase
        .from('feed_post_comments')
        .select('*, profiles(full_name)')
        .eq('post_id', post.id)
        .order('created_at', { ascending: true });
      if (error) throw error;
      setComments(data || []);
    } catch (e) {
      showAlert('Could not load comments', e.message);
    } finally {
      setLoading(false);
    }
  }, [post?.id]);

  useEffect(() => { if (post?.id) load(); }, [load, post?.id]);

  const send = async () => {
    const trimmed = body.trim();
    if (!trimmed || sending || !userId) return;
    setSending(true);
    try {
      const { data, error } = await supabase
        .from('feed_post_comments')
        .insert({ post_id: post.id, author_id: userId, body: trimmed })
        .select('*, profiles(full_name)')
        .single();
      if (error) throw error;
      setComments((prev) => [...prev, data]);
      setBody('');
    } catch (e) {
      showAlert('Could not post comment', e.message);
    } finally {
      setSending(false);
    }
  };

  const deleteComment = (comment) => {
    showAlert('Delete this comment?', 'This can\'t be undone.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          setComments((prev) => prev.filter((c) => c.id !== comment.id));
          const { error } = await supabase.from('feed_post_comments').delete().eq('id', comment.id);
          if (error) {
            showAlert('Could not delete', error.message);
            load();
          }
        },
      },
    ]);
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={Platform.OS === 'ios' ? 60 : 0}
    >
      <View style={styles.grabberWrap}>
        <View style={styles.grabber} />
      </View>

      <View style={styles.topRow}>
        <TouchableOpacity onPress={() => navigation.goBack()} activeOpacity={0.7} style={styles.cancelBtn}>
          <Text style={styles.cancelText}>Close</Text>
        </TouchableOpacity>
        <Text style={styles.title}>Comments</Text>
        <View style={{ width: 50 }} />
      </View>

      {post?.body ? (
        <Text style={styles.postPreview} numberOfLines={2}>{post.body}</Text>
      ) : null}

      {loading ? (
        <ActivityIndicator style={{ marginTop: 30 }} color={palette.primary} />
      ) : (
        <FlatList
          data={comments}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.list}
          renderItem={({ item }) => {
            const isOwn = item.author_id === userId;
            return (
              <View style={styles.commentRow}>
                <View style={styles.avatar}>
                  <Text style={styles.avatarText}>{getInitials(item.profiles?.full_name)}</Text>
                </View>
                <View style={styles.commentBubble}>
                  <View style={styles.commentHeaderRow}>
                    <Text style={styles.commentAuthor}>{item.profiles?.full_name || 'Someone'}</Text>
                    <Text style={styles.commentTime}>{timeAgo(item.created_at)}</Text>
                    {isOwn && (
                      <TouchableOpacity onPress={() => deleteComment(item)} activeOpacity={0.7} style={styles.deleteBtn}>
                        <Ionicons name="trash-outline" size={13} color={palette.neutralText} />
                      </TouchableOpacity>
                    )}
                  </View>
                  <Text style={styles.commentBody}>{item.body}</Text>
                </View>
              </View>
            );
          }}
          ListEmptyComponent={
            <View style={styles.emptyState}>
              <Text style={styles.emptyStateText}>No comments yet — be the first to say something.</Text>
            </View>
          }
        />
      )}

      <View style={styles.inputRow}>
        <TextInput
          style={styles.input}
          placeholder="Write a comment…"
          placeholderTextColor={palette.neutralText}
          value={body}
          onChangeText={setBody}
          multiline
          maxLength={300}
        />
        <TouchableOpacity
          style={[styles.sendBtn, (!body.trim() || sending) && styles.sendBtnDisabled]}
          onPress={send}
          disabled={!body.trim() || sending}
          activeOpacity={0.85}
        >
          {sending
            ? <ActivityIndicator size="small" color={palette.surface} />
            : <Ionicons name="arrow-up" size={18} color={palette.surface} />
          }
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: palette.canvas },
  grabberWrap: { alignItems: 'center', paddingTop: 10 },
  grabber: { width: 38, height: 4, borderRadius: 2, backgroundColor: palette.line },

  topRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingTop: 14, paddingBottom: 8,
  },
  cancelBtn: { paddingVertical: 6, width: 50 },
  cancelText: { fontSize: 14.5, color: palette.inkMuted, fontWeight: '600' },
  title: { fontSize: 15.5, fontWeight: '800', color: palette.ink },

  postPreview: {
    fontSize: 12.5, color: palette.inkMuted, paddingHorizontal: 18, paddingBottom: 10,
    fontStyle: 'italic',
  },

  list: { paddingHorizontal: 16, paddingBottom: 12, flexGrow: 1 },
  commentRow: { flexDirection: 'row', gap: 10, marginBottom: 14 },
  avatar: { width: 30, height: 30, borderRadius: 15, backgroundColor: palette.primarySoft, alignItems: 'center', justifyContent: 'center' },
  avatarText: { fontSize: 11.5, fontWeight: '800', color: palette.primary },
  commentBubble: { flex: 1, backgroundColor: palette.surface, borderRadius: 14, padding: 11 },
  commentHeaderRow: { flexDirection: 'row', alignItems: 'center', gap: 7, marginBottom: 3 },
  commentAuthor: { fontSize: 12.5, fontWeight: '700', color: palette.ink },
  commentTime: { fontSize: 11, color: palette.neutralText, fontWeight: '500' },
  deleteBtn: { marginLeft: 'auto', padding: 2 },
  commentBody: { fontSize: 13.5, color: palette.ink, lineHeight: 19 },

  emptyState: { paddingTop: 40, alignItems: 'center' },
  emptyStateText: { color: palette.neutralText, fontSize: 13, textAlign: 'center', paddingHorizontal: 30 },

  inputRow: {
    flexDirection: 'row', alignItems: 'flex-end', gap: 10,
    paddingHorizontal: 16, paddingVertical: 12,
    borderTopWidth: 1, borderTopColor: palette.line, backgroundColor: palette.surface,
  },
  input: {
    flex: 1, fontSize: 14, color: palette.ink, maxHeight: 90,
    backgroundColor: palette.canvas, borderRadius: 14, paddingHorizontal: 14, paddingVertical: 10,
    outlineStyle: 'none',
  },
  sendBtn: { width: 36, height: 36, borderRadius: 18, backgroundColor: palette.primary, alignItems: 'center', justifyContent: 'center' },
  sendBtnDisabled: { opacity: 0.4 },
});
