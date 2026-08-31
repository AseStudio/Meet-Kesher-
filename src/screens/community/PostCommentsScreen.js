import React, { useState, useEffect, useCallback, useMemo } from 'react';
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
  // { rootId, mentionHandle? } — rootId is always a top-level comment's
  // id, even when replying to a reply, since threading only goes one
  // level deep. mentionHandle is set only in the reply-to-a-reply case,
  // where it becomes an @handle prefix rather than a deeper visual
  // thread — always a username when the target has one, since two
  // people can share a full name but never a username. Falls back to
  // full name only for accounts that predate the username feature and
  // haven't set one yet; that's a display nicety, not the actual
  // notify-the-right-person logic, which always keys off the real
  // author_id regardless of what the mention text says.
  const [replyingTo, setReplyingTo] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      setUserId(user?.id || null);

      const { data, error } = await supabase
        .from('feed_post_comments')
        .select('*, profiles(full_name, username)')
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

  // Group into top-level comments + a flat reply list per root, once
  // per comments change rather than on every render.
  const threads = useMemo(() => {
    const roots = comments.filter((c) => !c.parent_comment_id);
    const repliesByRoot = {};
    comments.forEach((c) => {
      if (c.parent_comment_id) {
        (repliesByRoot[c.parent_comment_id] = repliesByRoot[c.parent_comment_id] || []).push(c);
      }
    });
    return roots.map((root) => ({ root, replies: repliesByRoot[root.id] || [] }));
  }, [comments]);

  const startReply = (comment, isReply) => {
    setReplyingTo({
      rootId: isReply ? comment.parent_comment_id : comment.id,
      mentionHandle: isReply ? (comment.profiles?.username || comment.profiles?.full_name || 'someone') : null,
    });
  };

  const send = async () => {
    const trimmed = body.trim();
    if (!trimmed || sending || !userId) return;
    setSending(true);
    try {
      const finalBody = replyingTo?.mentionHandle ? `@${replyingTo.mentionHandle} ${trimmed}` : trimmed;
      const { data, error } = await supabase
        .from('feed_post_comments')
        .insert({
          post_id: post.id,
          author_id: userId,
          body: finalBody,
          parent_comment_id: replyingTo?.rootId || null,
        })
        .select('*, profiles(full_name, username)')
        .single();
      if (error) throw error;
      setComments((prev) => [...prev, data]);
      setBody('');
      setReplyingTo(null);
    } catch (e) {
      showAlert('Could not post comment', e.message);
    } finally {
      setSending(false);
    }
  };

  const deleteComment = (comment) => {
    showAlert(
      'Delete this comment?',
      comment.parent_comment_id ? 'This can\'t be undone.' : 'This will also delete its replies. This can\'t be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            setComments((prev) => prev.filter((c) => c.id !== comment.id && c.parent_comment_id !== comment.id));
            const { error } = await supabase.from('feed_post_comments').delete().eq('id', comment.id);
            if (error) {
              showAlert('Could not delete', error.message);
              load();
            }
          },
        },
      ]
    );
  };

  const renderComment = (item, isReply) => {
    const isOwn = item.author_id === userId;
    return (
      <View key={item.id} style={[styles.commentRow, isReply && styles.replyRow]}>
        <View style={[styles.avatar, isReply && styles.avatarSmall]}>
          <Text style={[styles.avatarText, isReply && { fontSize: 10 }]}>{getInitials(item.profiles?.full_name)}</Text>
        </View>
        <View style={styles.commentBubble}>
          <View style={styles.commentHeaderRow}>
            <Text style={styles.commentAuthor}>{item.profiles?.full_name || 'Someone'}</Text>
            {item.profiles?.username && <Text style={styles.commentHandle}>@{item.profiles.username}</Text>}
            <Text style={styles.commentTime}>{timeAgo(item.created_at)}</Text>
            {isOwn && (
              <TouchableOpacity onPress={() => deleteComment(item)} activeOpacity={0.7} style={styles.deleteBtn}>
                <Ionicons name="trash-outline" size={13} color={palette.neutralText} />
              </TouchableOpacity>
            )}
          </View>
          <Text style={styles.commentBody}>{item.body}</Text>
          <TouchableOpacity onPress={() => startReply(item, isReply)} activeOpacity={0.7}>
            <Text style={styles.replyBtnText}>Reply</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
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
          data={threads}
          keyExtractor={(item) => item.root.id}
          contentContainerStyle={styles.list}
          renderItem={({ item }) => (
            <View>
              {renderComment(item.root, false)}
              {item.replies.map((reply) => renderComment(reply, true))}
            </View>
          )}
          ListEmptyComponent={
            <View style={styles.emptyState}>
              <Text style={styles.emptyStateText}>No comments yet — be the first to say something.</Text>
            </View>
          }
        />
      )}

      {replyingTo && (
        <View style={styles.replyingBar}>
          <Text style={styles.replyingText}>
            {replyingTo.mentionHandle ? `Replying to @${replyingTo.mentionHandle}` : 'Replying to comment'}
          </Text>
          <TouchableOpacity onPress={() => setReplyingTo(null)} activeOpacity={0.7}>
            <Ionicons name="close" size={16} color={palette.neutralText} />
          </TouchableOpacity>
        </View>
      )}

      <View style={styles.inputRow}>
        <TextInput
          style={styles.input}
          placeholder={replyingTo ? 'Write a reply…' : 'Write a comment…'}
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
  replyRow: { marginLeft: 30, marginTop: -4 },
  avatar: { width: 30, height: 30, borderRadius: 15, backgroundColor: palette.primarySoft, alignItems: 'center', justifyContent: 'center' },
  avatarSmall: { width: 24, height: 24, borderRadius: 12 },
  avatarText: { fontSize: 11.5, fontWeight: '800', color: palette.primary },
  commentBubble: { flex: 1, backgroundColor: palette.surface, borderRadius: 14, padding: 11 },
  commentHeaderRow: { flexDirection: 'row', alignItems: 'center', gap: 7, marginBottom: 3 },
  commentAuthor: { fontSize: 12.5, fontWeight: '700', color: palette.ink },
  commentHandle: { fontSize: 11.5, color: palette.neutralText, fontWeight: '500' },
  commentTime: { fontSize: 11, color: palette.neutralText, fontWeight: '500' },
  deleteBtn: { marginLeft: 'auto', padding: 2 },
  commentBody: { fontSize: 13.5, color: palette.ink, lineHeight: 19 },
  replyBtnText: { fontSize: 11.5, fontWeight: '700', color: palette.neutralText, marginTop: 6 },

  emptyState: { paddingTop: 40, alignItems: 'center' },
  emptyStateText: { color: palette.neutralText, fontSize: 13, textAlign: 'center', paddingHorizontal: 30 },

  replyingBar: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingVertical: 8, backgroundColor: palette.primarySoft,
  },
  replyingText: { fontSize: 12, color: palette.primary, fontWeight: '600' },

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
