import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, TextInput,
  FlatList, ActivityIndicator, Alert, KeyboardAvoidingView, Platform
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '../../theme/colors';
import { supabase } from '../../lib/supabase';
import { generateSessionCode, generateSessionPassword } from '../../lib/sessionCodes';

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
 * Posting is gated in the UI by `myRole` (fetched below), but the real
 * enforcement is the channel_messages_insert RLS policy in the
 * migration — an attendee can't post here even by hitting the API
 * directly, this UI gate is just so they don't see a composer they
 * can't use.
 */
export default function ChannelChatScreen({ navigation, route }) {
  const { channelId, channelName } = route.params;
  const [messages, setMessages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [myRole, setMyRole] = useState(null); // 'supervisor' | 'assistant_supervisor' | 'member'
  const [myReactions, setMyReactions] = useState({}); // message_id -> reaction
  const [userId, setUserId] = useState(null);
  const [startingSession, setStartingSession] = useState(false);
  const listRef = useRef(null);

  const canPost = myRole === 'supervisor' || myRole === 'assistant_supervisor';
  const isSupervisor = myRole === 'supervisor';

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      setUserId(user.id);

      const { data: roleRow } = await supabase
        .from('channel_roles')
        .select('role')
        .eq('channel_id', channelId)
        .eq('user_id', user.id)
        .maybeSingle();
      setMyRole(roleRow?.role ?? null);

      const { data: messageRows, error } = await supabase
        .from('channel_messages')
        .select('id, body, attachment_url, created_at, author_id')
        .eq('channel_id', channelId)
        .order('created_at', { ascending: true })
        .limit(200);
      if (error) throw error;
      setMessages(messageRows || []);

      const { data: reactionRows } = await supabase
        .from('channel_message_reactions')
        .select('message_id, reaction')
        .eq('user_id', user.id);
      const map = {};
      (reactionRows || []).forEach((r) => { map[r.message_id] = r.reaction; });
      setMyReactions(map);
    } catch (e) {
      Alert.alert('Could not load channel', e.message);
    } finally {
      setLoading(false);
    }
  }, [channelId]);

  useEffect(() => { load(); }, [load]);

  // Realtime — new messages from the supervisor/assistant show up live
  // for everyone in the channel without a manual refresh.
  useEffect(() => {
    const sub = supabase
      .channel(`channel_messages:${channelId}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'channel_messages', filter: `channel_id=eq.${channelId}` },
        (payload) => {
          setMessages((prev) => [...prev, payload.new]);
        }
      )
      .subscribe();

    return () => { supabase.removeChannel(sub); };
  }, [channelId]);

  const send = async () => {
    if (!draft.trim() || sending) return;
    setSending(true);
    const body = draft.trim();
    setDraft('');
    const { error } = await supabase.from('channel_messages').insert({
      channel_id: channelId,
      author_id: userId,
      body,
    });
    setSending(false);
    if (error) Alert.alert('Could not send', error.message);
  };

  const toggleReaction = async (messageId) => {
    const already = myReactions[messageId];
    setMyReactions((prev) => {
      const next = { ...prev };
      already ? delete next[messageId] : (next[messageId] = 'like');
      return next;
    });
    if (already) {
      await supabase.from('channel_message_reactions').delete().eq('message_id', messageId).eq('user_id', userId);
    } else {
      await supabase.from('channel_message_reactions').upsert({ message_id: messageId, user_id: userId, reaction: 'like' });
    }
  };

  // Starts a session pre-linked to this channel. Fan-out to notify every
  // channel member is deliberately NOT done here as a client-side loop —
  // looping over potentially hundreds of members and calling the push
  // API per-row from a phone is slow and unreliable if the app
  // backgrounds mid-loop. That notification step belongs in a Supabase
  // Edge Function (or a DB trigger on sessions.insert where channel_id
  // is not null) that fans out server-side. This just creates the
  // session and hands off to your existing session-start flow.
  const startCommunitySession = async () => {
    setStartingSession(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();

      // sessions.mode/code/password are all NOT NULL in the real schema —
      // 'meeting' is a sensible default mode for a community session;
      // code/password are generated here since this bypasses the normal
      // CreateSession.js flow that would otherwise set them. Retries once
      // on a code collision (23505 = unique_violation) in case sessions.code
      // has a uniqueness constraint the schema dump didn't show.
      let data, error;
      for (let attempt = 0; attempt < 3; attempt++) {
        ({ data, error } = await supabase
          .from('sessions')
          .insert({
            host_id: user.id,
            channel_id: channelId,
            title: `${channelName} session`,
            mode: 'meeting',
            code: generateSessionCode(),
            password: generateSessionPassword(),
            status: 'scheduled',
          })
          .select()
          .single());
        if (!error || error.code !== '23505') break;
      }
      if (error) throw error;

      // Fire-and-forget — fan-out happens server-side (see
      // supabase/functions/notify-channel-session), so this doesn't
      // block navigation on however long push delivery takes.
      supabase.functions.invoke('notify-channel-session', {
        body: { sessionId: data.id, channelId, channelName },
      }).catch(() => {});

      navigation.navigate('Lobby', { session: data });
    } catch (e) {
      Alert.alert('Could not start session', e.message);
    } finally {
      setStartingSession(false);
    }
  };

  const renderMessage = ({ item }) => {
    const reacted = !!myReactions[item.id];
    return (
      <View style={styles.messageRow}>
        <View style={styles.messageBubble}>
          <Text style={styles.messageBody}>{item.body}</Text>
        </View>
        <TouchableOpacity style={styles.reactionBtn} onPress={() => toggleReaction(item.id)} activeOpacity={0.7}>
          <Ionicons name={reacted ? 'heart' : 'heart-outline'} size={15} color={reacted ? palette.primary : palette.neutralText} />
        </TouchableOpacity>
      </View>
    );
  };

  return (
    <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={22} color={palette.ink} />
        </TouchableOpacity>
        <Text style={styles.headerTitle} numberOfLines={1}>{channelName}</Text>
        {isSupervisor ? (
          <TouchableOpacity onPress={() => navigation.navigate('ChannelRoles', { channelId, channelName })} style={styles.backBtn}>
            <Ionicons name="people-outline" size={20} color={palette.ink} />
          </TouchableOpacity>
        ) : (
          <View style={{ width: 22 }} />
        )}
      </View>

      {isSupervisor && (
        <TouchableOpacity style={styles.startSessionBtn} onPress={startCommunitySession} disabled={startingSession} activeOpacity={0.85}>
          {startingSession ? (
            <ActivityIndicator color={palette.surface} />
          ) : (
            <>
              <Ionicons name="videocam" size={16} color={palette.surface} />
              <Text style={styles.startSessionBtnText}>Start a session with {channelName}</Text>
            </>
          )}
        </TouchableOpacity>
      )}

      {loading ? (
        <ActivityIndicator style={{ marginTop: 40 }} color={palette.primary} />
      ) : (
        <FlatList
          ref={listRef}
          data={messages}
          keyExtractor={(item) => item.id}
          renderItem={renderMessage}
          contentContainerStyle={styles.listContent}
          onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: false })}
          ListEmptyComponent={
            <View style={styles.emptyState}>
              <Text style={styles.emptyStateText}>
                {canPost ? 'Post the first note, assignment, or update.' : 'Nothing posted here yet.'}
              </Text>
            </View>
          }
        />
      )}

      {canPost ? (
        <View style={styles.composer}>
          <TextInput
            style={styles.composerInput}
            placeholder="Share a note, assignment, or update..."
            placeholderTextColor={palette.neutralText}
            value={draft}
            onChangeText={setDraft}
            multiline
          />
          <TouchableOpacity style={styles.sendBtn} onPress={send} disabled={sending || !draft.trim()} activeOpacity={0.8}>
            <Ionicons name="send" size={18} color={palette.surface} />
          </TouchableOpacity>
        </View>
      ) : (
        <View style={styles.reactOnlyNotice}>
          <Text style={styles.reactOnlyNoticeText}>Only the channel's supervisor and assistants can post here — you can react to what they share.</Text>
        </View>
      )}
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: palette.canvas },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 20, paddingBottom: 8 },
  backBtn: { padding: 2 },
  headerTitle: { flex: 1, textAlign: 'center', fontSize: 16, fontWeight: '800', color: palette.ink, marginHorizontal: 10 },

  startSessionBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: palette.primary, marginHorizontal: 20, borderRadius: 13, paddingVertical: 12, marginBottom: 10,
  },
  startSessionBtnText: { color: palette.surface, fontWeight: '700', fontSize: 13.5 },

  listContent: { paddingHorizontal: 20, paddingBottom: 16, flexGrow: 1 },
  messageRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 8, marginBottom: 10 },
  messageBubble: { backgroundColor: palette.surface, borderRadius: 14, borderTopLeftRadius: 4, padding: 12, maxWidth: '82%' },
  messageBody: { fontSize: 14, color: palette.ink, lineHeight: 20 },
  reactionBtn: { padding: 4 },

  emptyState: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingTop: 60 },
  emptyStateText: { color: palette.neutralText, fontSize: 13, textAlign: 'center', paddingHorizontal: 30 },

  composer: {
    flexDirection: 'row', alignItems: 'flex-end', gap: 10, padding: 16,
    borderTopWidth: 1, borderTopColor: palette.line, backgroundColor: palette.surface,
  },
  composerInput: {
    flex: 1, backgroundColor: palette.canvas, borderRadius: 14, paddingHorizontal: 14, paddingVertical: 10,
    fontSize: 14, color: palette.ink, maxHeight: 100, outlineStyle: 'none',
  },
  sendBtn: { backgroundColor: palette.primary, width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },

  reactOnlyNotice: { padding: 16, borderTopWidth: 1, borderTopColor: palette.line, backgroundColor: palette.surface },
  reactOnlyNoticeText: { fontSize: 12, color: palette.inkMuted, textAlign: 'center' },
});
