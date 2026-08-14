import React, { useState, useEffect } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity,
  ScrollView, ActivityIndicator, TextInput, Modal, Platform, Alert
} from 'react-native';
import * as Linking from 'expo-linking';
import * as FileSystem from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '../../theme/colors';
import { supabase } from '../../lib/supabase';

// ─────────────────────────────────────────────────────────────────────
// PALETTE — same tokens/mapping as the other production-pass screens.
// ─────────────────────────────────────────────────────────────────────
const palette = {
  primary: colors.primary,
  primaryBright: colors.primaryLight,
  primaryDeep: colors.primaryDark,
  primarySoft: colors.background,
  ink: colors.text,
  inkMuted: colors.textLight,
  surface: colors.white,
  canvas: colors.background,
  line: colors.greyLight,
  success: colors.green,
  successSoft: '#E7FBF0',
  danger: colors.red,
  dangerSoft: '#FFE9E9',
  amber: colors.yellow,
  amberSoft: '#FFF3DE',
  neutralSoft: colors.greyLight,
  neutralText: colors.grey,
};

// File type → icon. Deliberately monochrome (icon well tint is always
// primarySoft/primary) rather than a different color per file type —
// with a scrollable list of many rows, a rainbow of icon colors reads
// as noisy where a consistent one reads as a system.
const FILE_ICONS = [
  { test: (t) => t.includes('image'), icon: 'image-outline' },
  { test: (t) => t.includes('pdf'), icon: 'document-outline' },
  { test: (t) => t.includes('video'), icon: 'videocam-outline' },
  { test: (t) => t.includes('audio'), icon: 'musical-notes-outline' },
  { test: (t) => t.includes('zip') || t.includes('rar'), icon: 'archive-outline' },
  { test: (t) => t.includes('word') || t.includes('document'), icon: 'document-text-outline' },
  { test: (t) => t.includes('sheet') || t.includes('excel'), icon: 'grid-outline' },
];
const getFileIconName = (type = '') => (FILE_ICONS.find(f => f.test(type))?.icon) || 'attach-outline';

export default function SubmissionsInbox({ navigation }) {
  const [submissions, setSubmissions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('all'); // all | unseen | seen | responded
  const [replyModal, setReplyModal] = useState(null); // submission object
  const [replyText, setReplyText] = useState('');
  const [sending, setSending] = useState(false);

  useEffect(() => { loadSubmissions(); }, []);

  const loadSubmissions = async () => {
    setLoading(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      // Get all sessions this host owns
      const { data: mySessions } = await supabase
        .from('sessions')
        .select('id, title')
        .eq('host_id', user.id);

      if (!mySessions?.length) {
        setSubmissions([]);
        return;
      }

      const sessionIds = mySessions.map(s => s.id);
      const sessionMap = {};
      mySessions.forEach(s => { sessionMap[s.id] = s; });

      const { data: subs } = await supabase
        .from('submissions')
        .select('*, profiles!submissions_sender_id_fkey(full_name)')
        .in('session_id', sessionIds)
        .order('created_at', { ascending: false });

      setSubmissions((subs || []).map(s => ({
        ...s,
        session_title: sessionMap[s.session_id]?.title || 'Session',
        sender_name: s.profiles?.full_name || 'Attendee',
      })));
    } catch (e) {
      console.log('Load submissions error:', e.message);
    } finally {
      setLoading(false);
    }
  };

  const markSeen = async (submission) => {
    if (submission.status !== 'unseen') return;
    try {
      await supabase
        .from('submissions')
        .update({ status: 'seen' })
        .eq('id', submission.id);
      setSubmissions(prev =>
        prev.map(s => s.id === submission.id ? { ...s, status: 'seen' } : s)
      );
    } catch (e) {}
  };

  const sendReply = async () => {
    if (!replyText.trim() || !replyModal) return;
    setSending(true);
    try {
      await supabase
        .from('submissions')
        .update({
          reply: replyText.trim(),
          status: 'responded',
          replied_at: new Date().toISOString(),
        })
        .eq('id', replyModal.id);

      setSubmissions(prev =>
        prev.map(s => s.id === replyModal.id
          ? { ...s, reply: replyText.trim(), status: 'responded' }
          : s
        )
      );
      setReplyModal(null);
      setReplyText('');
    } catch (e) {
      Alert.alert('Failed to send reply', e.message);
    } finally {
      setSending(false);
    }
  };

  const viewFile = (url) => {
    if (!url) return;
    Linking.openURL(url).catch(() =>
      Alert.alert('Could not open file', 'The link may be invalid.')
    );
  };

  const downloadFile = async (url, name) => {
    if (!url) return;

    if (Platform.OS === 'web') {
      // Anchor-tag download forces a save rather than a same-tab
      // navigation, which a plain window.open/Linking.openURL wouldn't —
      // web keeps its own path for that reason.
      const a = document.createElement('a');
      a.href = url;
      a.download = name || 'file';
      a.target = '_blank';
      a.click();
      return;
    }

    // Native has no "downloads folder" a URL can just drop into —
    // pull the file into the app's cache, then hand it to the system
    // share sheet so the host can save it wherever they want.
    try {
      const dest = `${FileSystem.cacheDirectory}${name || 'file'}`;
      const { uri } = await FileSystem.downloadAsync(url, dest);
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(uri);
      } else {
        Alert.alert('Downloaded', `Saved to ${uri}`);
      }
    } catch (e) {
      Alert.alert('Download failed', e.message);
    }
  };

  const getStatusStyle = (status) => {
    switch (status) {
      case 'unseen': return { bg: palette.primarySoft, text: palette.primary, label: 'New', dot: true };
      case 'seen': return { bg: palette.neutralSoft, text: palette.neutralText, label: 'Seen', dot: true };
      case 'responded': return { bg: palette.successSoft, text: palette.success, label: 'Replied', dot: false };
      default: return { bg: palette.neutralSoft, text: palette.neutralText, label: status, dot: true };
    }
  };

  const formatTime = (dateStr) => {
    const d = new Date(dateStr);
    const now = new Date();
    const diffMs = now - d;
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);
    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    return `${diffDays}d ago`;
  };

  const formatSize = (bytes) => {
    if (!bytes) return '';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const filtered = filter === 'all'
    ? submissions
    : submissions.filter(s => s.status === filter);

  const unseenCount = submissions.filter(s => s.status === 'unseen').length;

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn} activeOpacity={0.75}>
          <Ionicons name="arrow-back" size={19} color={palette.ink} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={styles.headerTitle}>Submissions Inbox</Text>
          <Text style={styles.headerSub}>{submissions.length} total</Text>
        </View>
        {unseenCount > 0 && (
          <View style={styles.unseenBadge}>
            <Text style={styles.unseenBadgeText}>{unseenCount} new</Text>
          </View>
        )}
      </View>

      {/* Filter tabs */}
      <View style={styles.filterRow}>
        {['all', 'unseen', 'seen', 'responded'].map(f => (
          <TouchableOpacity
            key={f}
            style={[styles.filterTab, filter === f && styles.filterTabActive]}
            onPress={() => setFilter(f)}
            activeOpacity={0.75}
          >
            <Text style={[styles.filterTabText, filter === f && styles.filterTabTextActive]}>
              {f.charAt(0).toUpperCase() + f.slice(1)}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {loading ? (
        <View style={styles.loadingWrap}>
          <ActivityIndicator color={palette.primary} size="large" />
        </View>
      ) : filtered.length === 0 ? (
        <View style={styles.emptyWrap}>
          <View style={styles.emptyIconWrap}>
            <Ionicons name="file-tray-outline" size={34} color={palette.neutralText} />
          </View>
          <Text style={styles.emptyTitle}>
            {filter === 'all' ? 'No submissions yet' : `No ${filter} submissions`}
          </Text>
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.list}>
          {filtered.map((sub) => {
            const statusStyle = getStatusStyle(sub.status);
            return (
              <TouchableOpacity
                key={sub.id}
                style={[styles.subCard, sub.status === 'unseen' && styles.subCardUnseen]}
                activeOpacity={0.85}
                onPress={() => markSeen(sub)}
              >
                {/* Top row */}
                <View style={styles.subCardTop}>
                  <View style={styles.subFileIconWrap}>
                    <Ionicons name={getFileIconName(sub.file_type)} size={19} color={palette.primary} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.subFileName} numberOfLines={1}>{sub.file_name}</Text>
                    <Text style={styles.subSender}>
                      from {sub.sender_name} · {sub.session_title}
                    </Text>
                  </View>
                  <View style={styles.subMeta}>
                    <View style={[styles.statusBadge, { backgroundColor: statusStyle.bg }]}>
                      {statusStyle.dot ? (
                        <View style={[styles.statusDot, { backgroundColor: statusStyle.text }]} />
                      ) : (
                        <Ionicons name="checkmark" size={10} color={statusStyle.text} />
                      )}
                      <Text style={[styles.statusText, { color: statusStyle.text }]}>{statusStyle.label}</Text>
                    </View>
                    <Text style={styles.subTime}>{formatTime(sub.created_at)}</Text>
                  </View>
                </View>

                {/* File size */}
                {sub.file_size && (
                  <Text style={styles.subSize}>{formatSize(sub.file_size)}</Text>
                )}

                {/* Reply bubble if exists */}
                {sub.reply && (
                  <View style={styles.replyBubble}>
                    <Text style={styles.replyLabel}>Your reply</Text>
                    <Text style={styles.replyText}>{sub.reply}</Text>
                  </View>
                )}

                {/* Actions */}
                <View style={styles.actionRow}>
                  {sub.file_url && (
                    <>
                      <TouchableOpacity
                        style={styles.actionBtn}
                        onPress={() => {
                          markSeen(sub);
                          viewFile(sub.file_url);
                        }}
                        activeOpacity={0.75}
                      >
                        <Ionicons name="eye-outline" size={13} color={palette.ink} />
                        <Text style={styles.actionBtnText}>View</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={styles.actionBtn}
                        onPress={() => {
                          markSeen(sub);
                          downloadFile(sub.file_url, sub.file_name);
                        }}
                        activeOpacity={0.75}
                      >
                        <Ionicons name="download-outline" size={13} color={palette.ink} />
                        <Text style={styles.actionBtnText}>Download</Text>
                      </TouchableOpacity>
                    </>
                  )}
                  <TouchableOpacity
                    style={[styles.actionBtn, styles.actionBtnPrimary]}
                    onPress={() => {
                      markSeen(sub);
                      setReplyModal(sub);
                      setReplyText(sub.reply || '');
                    }}
                    activeOpacity={0.75}
                  >
                    <Ionicons name={sub.reply ? 'create-outline' : 'chatbubble-outline'} size={13} color={palette.primary} />
                    <Text style={[styles.actionBtnText, { color: palette.primary }]}>
                      {sub.reply ? 'Edit Reply' : 'Reply'}
                    </Text>
                  </TouchableOpacity>
                </View>
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      )}

      {/* Reply Modal */}
      <Modal
        visible={replyModal !== null}
        transparent
        animationType="slide"
        onRequestClose={() => setReplyModal(null)}
      >
        <TouchableOpacity
          style={styles.modalOverlay}
          activeOpacity={1}
          onPress={() => setReplyModal(null)}
        >
          <View style={styles.replyPanel} onStartShouldSetResponder={() => true}>
            <View style={styles.replyPanelHeader}>
              <Ionicons name="chatbubble-outline" size={17} color={palette.primary} />
              <Text style={styles.replyPanelTitle}>Reply to Submission</Text>
            </View>
            <Text style={styles.replyPanelFile} numberOfLines={1}>
              {replyModal?.file_name}
            </Text>
            <Text style={styles.replyPanelFrom}>from {replyModal?.sender_name}</Text>
            <TextInput
              style={styles.replyInput}
              value={replyText}
              onChangeText={setReplyText}
              placeholder="Type your reply..."
              placeholderTextColor={palette.neutralText}
              multiline
              maxLength={500}
              autoFocus
            />
            <Text style={styles.charCount}>{replyText.length}/500</Text>
            <View style={styles.replyBtnRow}>
              <TouchableOpacity style={styles.cancelBtn} onPress={() => setReplyModal(null)} activeOpacity={0.8}>
                <Text style={styles.cancelBtnText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.sendBtn, (!replyText.trim() || sending) && styles.sendBtnDisabled]}
                onPress={sendReply}
                disabled={!replyText.trim() || sending}
                activeOpacity={0.85}
              >
                {sending
                  ? <ActivityIndicator color={palette.surface} size="small" />
                  : <Text style={styles.sendBtnText}>Send Reply</Text>
                }
              </TouchableOpacity>
            </View>
          </View>
        </TouchableOpacity>
      </Modal>
    </View>
  );
}

const cardShadow = Platform.select({
  ios: { shadowColor: '#2A1A6B', shadowOffset: { width: 0, height: 5 }, shadowOpacity: 0.07, shadowRadius: 12 },
  android: { elevation: 2 },
  default: { boxShadow: '0 5px 14px rgba(42,26,107,0.07)' },
});

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: palette.canvas },
  header: { flexDirection: 'row', alignItems: 'center', gap: 14, padding: 20, paddingTop: 50, backgroundColor: palette.surface, borderBottomWidth: 1, borderBottomColor: palette.line },
  backBtn: { width: 38, height: 38, borderRadius: 13, backgroundColor: palette.neutralSoft, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { fontSize: 19, fontWeight: '800', color: palette.ink, letterSpacing: -0.3 },
  headerSub: { fontSize: 12.5, color: palette.inkMuted, marginTop: 2, fontWeight: '500' },
  unseenBadge: { backgroundColor: palette.primary, paddingHorizontal: 11, paddingVertical: 5, borderRadius: 12 },
  unseenBadgeText: { color: palette.surface, fontSize: 11.5, fontWeight: '700' },

  filterRow: { flexDirection: 'row', backgroundColor: palette.surface, paddingHorizontal: 16, paddingVertical: 10, gap: 8, borderBottomWidth: 1, borderBottomColor: palette.line },
  filterTab: { paddingHorizontal: 14, paddingVertical: 7, borderRadius: 20, backgroundColor: palette.neutralSoft },
  filterTabActive: { backgroundColor: palette.primary },
  filterTabText: { fontSize: 12, fontWeight: '700', color: palette.neutralText },
  filterTabTextActive: { color: palette.surface },

  loadingWrap: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  emptyWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 },
  emptyIconWrap: { width: 68, height: 68, borderRadius: 34, backgroundColor: palette.neutralSoft, alignItems: 'center', justifyContent: 'center' },
  emptyTitle: { fontSize: 14.5, color: palette.inkMuted, fontWeight: '600' },

  list: { padding: 16, gap: 12 },
  subCard: { backgroundColor: palette.surface, borderRadius: 17, padding: 14, borderWidth: 1, borderColor: palette.line, gap: 9, ...cardShadow },
  subCardUnseen: { borderColor: palette.primary, borderWidth: 1.5 },
  subCardTop: { flexDirection: 'row', alignItems: 'flex-start', gap: 11 },
  subFileIconWrap: { width: 38, height: 38, borderRadius: 12, backgroundColor: palette.primarySoft, alignItems: 'center', justifyContent: 'center', marginTop: 1 },
  subFileName: { fontSize: 14, fontWeight: '700', color: palette.ink },
  subSender: { fontSize: 11, color: palette.inkMuted, marginTop: 2, fontWeight: '500' },
  subMeta: { alignItems: 'flex-end', gap: 5 },
  statusBadge: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8 },
  statusDot: { width: 5, height: 5, borderRadius: 2.5 },
  statusText: { fontSize: 10.5, fontWeight: '700' },
  subTime: { fontSize: 10, color: palette.neutralText, fontWeight: '500' },
  subSize: { fontSize: 11, color: palette.inkMuted, fontWeight: '500' },

  replyBubble: { backgroundColor: palette.primarySoft, borderRadius: 10, padding: 10, borderLeftWidth: 3, borderLeftColor: palette.primary },
  replyLabel: { fontSize: 10, fontWeight: '700', color: palette.primary, marginBottom: 3, letterSpacing: 0.2 },
  replyText: { fontSize: 12.5, color: palette.ink, fontWeight: '500' },

  actionRow: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  actionBtn: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 12, paddingVertical: 7, borderRadius: 9, backgroundColor: palette.neutralSoft },
  actionBtnPrimary: { backgroundColor: palette.primarySoft },
  actionBtnText: { fontSize: 12, fontWeight: '700', color: palette.ink },

  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  replyPanel: { backgroundColor: palette.surface, borderTopLeftRadius: 26, borderTopRightRadius: 26, padding: 24, gap: 10 },
  replyPanelHeader: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  replyPanelTitle: { fontSize: 17.5, fontWeight: '800', color: palette.ink, letterSpacing: -0.2 },
  replyPanelFile: { fontSize: 13, fontWeight: '700', color: palette.ink },
  replyPanelFrom: { fontSize: 12, color: palette.inkMuted, marginTop: -4, fontWeight: '500' },
  replyInput: { backgroundColor: palette.neutralSoft, borderRadius: 14, padding: 14, fontSize: 15, color: palette.ink, fontWeight: '500', minHeight: 100, textAlignVertical: 'top', outlineStyle: 'none' },
  charCount: { fontSize: 11, color: palette.neutralText, textAlign: 'right', fontWeight: '500' },
  replyBtnRow: { flexDirection: 'row', gap: 10, marginTop: 4 },
  cancelBtn: { flex: 1, paddingVertical: 14, borderRadius: 13, backgroundColor: palette.neutralSoft, alignItems: 'center' },
  cancelBtnText: { fontSize: 14.5, fontWeight: '700', color: palette.ink },
  sendBtn: { flex: 2, paddingVertical: 14, borderRadius: 13, backgroundColor: palette.primary, alignItems: 'center' },
  sendBtnDisabled: { opacity: 0.5 },
  sendBtnText: { fontSize: 14.5, fontWeight: '800', color: palette.surface },
});