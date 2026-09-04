import 'react-native-get-random-values'; // required so uuid works on RN — npm i react-native-get-random-values (already a dependency if you have WhiteboardCanvas.js)
import React, { useState, useEffect, useRef } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, TextInput, ScrollView, ActivityIndicator } from 'react-native';
import { v4 as uuidv4 } from 'uuid';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { colors } from '../../theme/colors';
import { supabase } from '../../lib/supabase';

/**
 * ChatPanel
 * ---------
 * Real in-session chat: message everyone at once, or DM a specific
 * person. Needs a `session_messages` table + RLS policies — see the SQL
 * at the bottom of this comment block, run once in the Supabase SQL
 * editor.
 *
 * Requires the caller to pass identity + a roster snapshot through
 * navigation, since that's already sitting in memory on both session
 * screens:
 *
 *   navigation.navigate('ChatPanel', {
 *     session,
 *     currentUser: hostUser,       // or currentUserRef.current on the attendee side
 *     isHost: true,                // or false
 *     roster: buildChatRoster(),   // { [userId]: { name, isHost } } snapshot — see SessionMain/AttendeeSession
 *     prefilledRecipient: null,    // optional { userId, name } to open straight into a DM
 *   })
 *
 * WHY A DEDICATED CHANNEL, NOT session-control:
 * The previous version reused session-control-${session.id} — the same
 * topic SessionMain/AttendeeSession already have open for the whole
 * session. Supabase's realtime client won't let a second, independent
 * subscription register new listeners on a topic that's already actively
 * joined elsewhere in the app; it throws, and since nothing was catching
 * that error, it took the entire app down (which is also why the host
 * looked like they'd left — their whole app had crashed, not just chat).
 * This screen now owns session-chat-${session.id} exclusively — nothing
 * else in the app ever touches this topic, so there's no conflict.
 *
 * WHO'S IN THE ROOM:
 * Since this screen can no longer share a live subscription with the
 * session screens, the roster is a point-in-time snapshot passed in via
 * navigation params (built from 'user-identity' broadcasts the parent
 * screen already collects) rather than something this screen tracks
 * live. If someone joins while chat is already open, they won't appear
 * until it's reopened — a small trade-off for not needing a second
 * subscription to a shared topic.
 *
 * DELIVERY:
 * Same shape as WhiteboardCanvas's strokes: broadcast for instant
 * delivery to whoever's currently connected + a parallel insert into
 * session_messages for history / late joiners / reconnects. DMs are
 * filtered client-side by sender/recipient id, backed by an RLS policy
 * that's the actual security boundary (see SQL below) — the client-side
 * filter alone would only be a UI nicety, not real privacy.
 *
 * --- SQL (run once) ---------------------------------------------------
 * create table if not exists session_messages (
 *   id uuid primary key default gen_random_uuid(),
 *   session_id uuid not null references sessions(id) on delete cascade,
 *   sender_id uuid not null references auth.users(id),
 *   sender_name text not null,
 *   recipient_id uuid references auth.users(id),
 *   recipient_name text,
 *   message text not null,
 *   created_at timestamptz not null default now()
 * );
 *
 * alter table session_messages enable row level security;
 *
 * create policy "select own or broadcast messages"
 *   on session_messages for select
 *   using (recipient_id is null or sender_id = auth.uid() or recipient_id = auth.uid());
 *
 * create policy "insert own messages"
 *   on session_messages for insert
 *   with check (sender_id = auth.uid());
 * ------------------------------------------------------------------------
 */

const getInitials = (name = '') => {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return '?';
};

const formatTime = (iso) => {
  try {
    return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  } catch {
    return '';
  }
};

export default function ChatPanel({ navigation, route }) {
  const { session, currentUser, isHost, prefilledRecipient, roster: rosterSnapshot } = route.params || {};
  const myId = currentUser?.id ?? null;
  const myName = currentUser?.name || (isHost ? 'Host' : 'Attendee');
  // Live roster updated via realtime subscription to roster channel
  const [roster, setRoster] = useState(rosterSnapshot || {});

  const [messages, setMessages] = useState([]);
  const [loadingHistory, setLoadingHistory] = useState(true);
  const [text, setText] = useState('');
  // 'Everyone' (sentinel string) | { userId, name } for a specific person
  const [selectedTo, setSelectedTo] = useState(prefilledRecipient || 'Everyone');
  const [showToDropdown, setShowToDropdown] = useState(false);

  const channelRef = useRef(null);
  const scrollRef = useRef(null);

  // ─── History — loaded once per session, RLS already scopes this to
  // broadcasts + my own DMs, the .filter below is just belt-and-braces ───
  useEffect(() => {
    if (!session?.id || !myId) return;
    let cancelled = false;

    (async () => {
      setLoadingHistory(true);
      const { data, error } = await supabase
        .from('session_messages')
        .select('*')
        .eq('session_id', session.id)
        .order('created_at', { ascending: true })
        .limit(200);
      if (cancelled) return;
      if (error) {
        console.warn('loadHistory error', error);
      } else {
        setMessages(
          (data || []).filter(
            (m) => !m.recipient_id || m.recipient_id === myId || m.sender_id === myId
          )
        );
      }
      setLoadingHistory(false);
    })();

    return () => { cancelled = true; };
  }, [session?.id, myId]);

  // ─── Realtime message delivery — this screen's OWN dedicated topic,
  // never shared with session-control (see file header) ───
  useEffect(() => {
    if (!session?.id || !myId) return;

    const ch = supabase.channel(`session-chat-${session.id}`);

    ch.on('broadcast', { event: 'chat-message' }, ({ payload }) => {
      if (payload.sender_id === myId) return; // already added locally in sendMessage
      const isForMe = !payload.recipient_id || payload.recipient_id === myId;
      if (!isForMe) return;
      setMessages((prev) => (prev.some((m) => m.id === payload.id) ? prev : [...prev, payload]));
    });

    ch.subscribe();
    channelRef.current = ch;

    // ─── Roster subscription — separate channel for live roster updates ───
    // The parent session screens should broadcast 'user-joined' / 'user-left' / 'roster-sync'
    // events to this channel whenever the participant list changes.
    const rosterCh = supabase.channel(`session-roster-${session.id}`);

    rosterCh.on('broadcast', { event: 'roster-sync' }, ({ payload }) => {
      // Full roster replacement (e.g., on initial connect or reconnect)
      setRoster(payload.roster || {});
    });

    rosterCh.on('broadcast', { event: 'user-joined' }, ({ payload }) => {
      // Add new user to roster
      setRoster((prev) => ({
        ...prev,
        [payload.userId]: { name: payload.name, isHost: payload.isHost || false },
      }));
    });

    rosterCh.on('broadcast', { event: 'user-left' }, ({ payload }) => {
      // Remove user from roster
      setRoster((prev) => {
        const next = { ...prev };
        delete next[payload.userId];
        return next;
      });
    });

    rosterCh.subscribe();

    return () => {
      supabase.removeChannel(ch);
      supabase.removeChannel(rosterCh);
    };
  }, [session?.id, myId]);

  // ─── Auto-scroll to newest message ───
  useEffect(() => {
    scrollRef.current?.scrollToEnd({ animated: true });
  }, [messages.length]);

  const sendMessage = async () => {
    const trimmed = text.trim();
    if (!trimmed || !myId) return;

    const isDirect = selectedTo !== 'Everyone';
    const message = {
      id: uuidv4(),
      session_id: session.id,
      sender_id: myId,
      sender_name: myName,
      recipient_id: isDirect ? selectedTo.userId : null,
      recipient_name: isDirect ? selectedTo.name : null,
      message: trimmed,
      created_at: new Date().toISOString(),
    };

    setMessages((prev) => [...prev, message]); // optimistic local add
    setText('');

    channelRef.current?.send({ type: 'broadcast', event: 'chat-message', payload: message });

    const { error } = await supabase.from('session_messages').insert({
      id: message.id,
      session_id: message.session_id,
      sender_id: message.sender_id,
      sender_name: message.sender_name,
      recipient_id: message.recipient_id,
      recipient_name: message.recipient_name,
      message: message.message,
    });
    if (error) console.warn('send message persist error', error);
  };

  const rosterEntries = Object.entries(roster).filter(([userId]) => userId !== myId);
  const onlineCount = Object.keys(roster).length;
  const toLabel = selectedTo === 'Everyone' ? 'Everyone' : selectedTo.name;

  return (
    <View style={styles.container}>

      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} activeOpacity={0.75}>
          <Ionicons name="arrow-back" size={20} color={colors.white} />
        </TouchableOpacity>
        <View style={styles.headerTitleRow}>
          <Ionicons name="chatbubble-outline" size={16} color={colors.white} />
          <Text style={styles.headerTitle}>Chat</Text>
        </View>
        <View style={styles.onlineCount}>
          <Text style={styles.onlineCountText}>{onlineCount} in session</Text>
        </View>
      </View>

      {/* Messages */}
      {loadingHistory ? (
        <View style={styles.centerFill}>
          <ActivityIndicator color={colors.primary} />
        </View>
      ) : (
        <ScrollView
          ref={scrollRef}
          style={styles.messageList}
          contentContainerStyle={styles.messageListContent}
          showsVerticalScrollIndicator={false}
        >
          {messages.length === 0 && (
            <View style={styles.emptyState}>
              <MaterialCommunityIcons name="hand-wave" size={20} color="rgba(255,255,255,0.4)" />
              <Text style={styles.emptyStateText}>No messages yet — say hi</Text>
            </View>
          )}
          {messages.map((msg) => {
            const mine = msg.sender_id === myId;
            return (
              <View key={msg.id} style={[styles.messageRow, mine && styles.messageRowMe]}>
                {!mine && (
                  <View style={styles.msgAvatar}>
                    <Text style={styles.msgAvatarText}>{getInitials(msg.sender_name)}</Text>
                  </View>
                )}
                <View style={[styles.messageBubble, mine && styles.messageBubbleMe]}>
                  {!mine && (
                    <Text style={styles.msgSender}>
                      {msg.sender_name}{roster[msg.sender_id]?.isHost ? ' (Host)' : ''}
                    </Text>
                  )}
                  {msg.recipient_id && (
                    <View style={styles.directedTag}>
                      <Text style={styles.directedTagText}>
                        → {mine ? msg.recipient_name : 'You'}
                      </Text>
                    </View>
                  )}
                  <Text style={[styles.msgText, mine && styles.msgTextMe]}>{msg.message}</Text>
                  <Text style={[styles.msgTime, mine && styles.msgTimeMe]}>{formatTime(msg.created_at)}</Text>
                </View>
                {mine && (
                  <View style={[styles.msgAvatar, styles.msgAvatarMe]}>
                    <Text style={styles.msgAvatarText}>{getInitials(myName)}</Text>
                  </View>
                )}
              </View>
            );
          })}
        </ScrollView>
      )}

      {/* Input */}
      <View style={styles.inputArea}>
        {/* To Selector */}
        <TouchableOpacity style={styles.toSelector} onPress={() => setShowToDropdown(!showToDropdown)} activeOpacity={0.75}>
          <Text style={styles.toLabel}>To:</Text>
          <Text style={styles.toValue}>{toLabel}</Text>
          <Ionicons name={showToDropdown ? 'chevron-up' : 'chevron-down'} size={12} color="rgba(255,255,255,0.4)" />
        </TouchableOpacity>

        {showToDropdown && (
          <View style={styles.toDropdown}>
            <TouchableOpacity
              style={[styles.toDropdownItem, selectedTo === 'Everyone' && styles.toDropdownItemActive]}
              onPress={() => { setSelectedTo('Everyone'); setShowToDropdown(false); }}
            >
              <Text style={[styles.toDropdownText, selectedTo === 'Everyone' && styles.toDropdownTextActive]}>Everyone</Text>
            </TouchableOpacity>
            {rosterEntries.length === 0 ? (
              <Text style={styles.toDropdownEmpty}>Nobody else here yet</Text>
            ) : (
              rosterEntries.map(([userId, info]) => {
                const active = selectedTo !== 'Everyone' && selectedTo.userId === userId;
                return (
                  <TouchableOpacity
                    key={userId}
                    style={[styles.toDropdownItem, active && styles.toDropdownItemActive]}
                    onPress={() => { setSelectedTo({ userId, name: info.name }); setShowToDropdown(false); }}
                  >
                    <Text style={[styles.toDropdownText, active && styles.toDropdownTextActive]}>
                      {info.name}{info.isHost ? ' (Host)' : ''}
                    </Text>
                  </TouchableOpacity>
                );
              })
            )}
          </View>
        )}

        <View style={styles.inputRow}>
          <TextInput
            style={styles.input}
            placeholder="Type a message..."
            placeholderTextColor={colors.grey}
            value={text}
            onChangeText={setText}
            onSubmitEditing={sendMessage}
          />
          <TouchableOpacity style={styles.sendBtn} onPress={sendMessage} activeOpacity={0.8}>
            <Ionicons name="send" size={17} color={colors.white} />
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0A0A1A' },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 16, paddingTop: 40, backgroundColor: '#0D0D2B' },
  headerTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  headerTitle: { fontSize: 17, fontWeight: '700', color: colors.white, letterSpacing: -0.2 },
  onlineCount: { backgroundColor: 'rgba(91,46,255,0.3)', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12 },
  onlineCountText: { color: colors.primaryLight, fontSize: 12, fontWeight: '600' },
  centerFill: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  messageList: { flex: 1 },
  messageListContent: { padding: 16, gap: 12 },
  emptyState: { paddingTop: 40, alignItems: 'center', gap: 8 },
  emptyStateText: { color: 'rgba(255,255,255,0.4)', fontSize: 13, fontWeight: '500' },
  messageRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 8 },
  messageRowMe: { justifyContent: 'flex-end' },
  msgAvatar: { width: 32, height: 32, borderRadius: 16, backgroundColor: '#1E1E3F', alignItems: 'center', justifyContent: 'center' },
  msgAvatarMe: { backgroundColor: colors.primary },
  msgAvatarText: { color: colors.white, fontSize: 11, fontWeight: '700' },
  messageBubble: { maxWidth: '70%', backgroundColor: '#1E1E3F', borderRadius: 16, borderBottomLeftRadius: 4, padding: 10, gap: 4 },
  messageBubbleMe: { backgroundColor: colors.primary, borderBottomLeftRadius: 16, borderBottomRightRadius: 4 },
  msgSender: { color: colors.primaryLight, fontSize: 12, fontWeight: '600' },
  directedTag: { backgroundColor: 'rgba(255,255,255,0.15)', paddingHorizontal: 8, paddingVertical: 2, borderRadius: 8, alignSelf: 'flex-start' },
  directedTagText: { color: colors.white, fontSize: 10, fontWeight: '600' },
  msgText: { color: colors.white, fontSize: 14, lineHeight: 20 },
  msgTextMe: { color: colors.white },
  msgTime: { color: 'rgba(255,255,255,0.4)', fontSize: 10, alignSelf: 'flex-end' },
  msgTimeMe: { color: 'rgba(255,255,255,0.6)' },
  inputArea: { backgroundColor: '#0D0D2B', padding: 12, borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.08)' },
  toSelector: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: '#1E1E3F', borderRadius: 10, paddingHorizontal: 12, paddingVertical: 6, alignSelf: 'flex-start', marginBottom: 8 },
  toLabel: { color: 'rgba(255,255,255,0.5)', fontSize: 12 },
  toValue: { color: colors.white, fontSize: 13, fontWeight: '600' },
  toDropdown: { backgroundColor: '#1E1E3F', borderRadius: 12, marginBottom: 8, overflow: 'hidden' },
  toDropdownItem: { paddingVertical: 10, paddingHorizontal: 14 },
  toDropdownItemActive: { backgroundColor: colors.primary },
  toDropdownText: { color: 'rgba(255,255,255,0.7)', fontSize: 14 },
  toDropdownTextActive: { color: colors.white, fontWeight: '600' },
  toDropdownEmpty: { color: 'rgba(255,255,255,0.4)', fontSize: 13, paddingVertical: 10, paddingHorizontal: 14 },
  inputRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  input: { flex: 1, backgroundColor: '#1E1E3F', borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, fontSize: 14, color: colors.white, outlineStyle: 'none' },
  sendBtn: { width: 44, height: 44, borderRadius: 12, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
});