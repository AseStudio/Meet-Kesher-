import React, { useState, useEffect, useRef } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity,
  ScrollView, ActivityIndicator,
} from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import * as Linking from 'expo-linking';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '../../theme/colors';
import { supabase } from '../../lib/supabase';
import { showAlert } from '../../lib/alert';

/**
 * DocumentExchangePanel — interview mode only (see lib/sessionModes.js).
 *
 * Reuses the EXISTING `submissions` table and 'submissions' storage
 * bucket (already powering SubmitFile.js / SubmissionsInbox.js /
 * AttendeeDashboard.js) rather than introducing a second, parallel
 * table for the same concept. What's new here:
 *   - The host can upload too (that flow was attendee-to-host only —
 *     see submissions_bidirectional_rls.sql for the RLS change this
 *     needs).
 *   - A live, in-session, realtime view of the shared thread, instead
 *     of the async dashboard/inbox flow those other screens use.
 *
 * Called the same way as ChatPanel.js / PollScreen.js:
 *   navigation.navigate('DocumentExchangePanel', {
 *     session,
 *     currentUser,   // hostUser on the host side, currentUserRef.current on attendee side
 *     isHost,
 *   })
 *
 * DEDICATED CHANNEL: same reasoning as ChatPanel.js/PollScreen.js — a
 * second independent subscription can't be added to session-control
 * (held open by SessionMain/AttendeeSession for the whole session), so
 * this owns `session-documents-${session.id}` exclusively.
 *
 * NOTE: sender_name is NOT a real column on `submissions` (SubmitFile.js
 * never sets it; SubmissionsInbox.js gets names via a profiles join) —
 * this deliberately doesn't insert or rely on one, using the isHost
 * flag + "You" vs the other role's label instead, which is sufficient
 * for a 2-person interview thread.
 */
export default function DocumentExchangePanel({ navigation, route }) {
  const { session, currentUser, isHost = false } = route.params || {};
  const myId = currentUser?.id ?? null;

  const [documents, setDocuments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedFile, setSelectedFile] = useState(null);
  const [uploading, setUploading] = useState(false);
  const channelRef = useRef(null);

  useEffect(() => {
    if (!session?.id) return;
    loadDocuments();

    channelRef.current = supabase
      .channel(`session-documents-${session.id}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'submissions', filter: `session_id=eq.${session.id}` },
        (payload) => {
          setDocuments((prev) => (prev.some((d) => d.id === payload.new.id) ? prev : [...prev, payload.new]));
        }
      )
      .subscribe();

    return () => {
      if (channelRef.current) supabase.removeChannel(channelRef.current);
    };
  }, [session?.id]);

  const loadDocuments = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from('submissions')
      .select('*')
      .eq('session_id', session.id)
      .order('created_at', { ascending: true });
    if (error) {
      console.warn('loadDocuments error', error);
    } else {
      setDocuments(data || []);
    }
    setLoading(false);
  };

  // Same fetch()+blob() approach as SubmitFile.js — expo-document-picker
  // hands back a local file:// URI on native and a blob: URI on web,
  // and this turns either into the Blob supabase-js storage upload()
  // actually needs, rather than passing the raw picker asset straight
  // through (which is a real object, not binary data, and silently
  // fails or errors — the exact bug this app's avatar-upload flow had
  // before it was fixed the same way).
  const pickFile = async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: '*/*',
        copyToCacheDirectory: true,
        multiple: false,
      });
      if (result.canceled) return;

      const asset = result.assets?.[0];
      if (!asset) return;

      if (asset.size && asset.size > 20 * 1024 * 1024) {
        showAlert('File too large', 'Maximum size is 20MB.');
        return;
      }

      setSelectedFile(asset);
    } catch (e) {
      showAlert('Could not open file picker', e.message);
    }
  };

  const uploadFile = async () => {
    if (!selectedFile || !myId) return;

    setUploading(true);
    try {
      const timestamp = Date.now();
      const fileName = selectedFile.name;
      const filePath = `${session.id}/${myId}/${timestamp}_${fileName}`;
      const contentType = selectedFile.mimeType || 'application/octet-stream';

      const fileResponse = await fetch(selectedFile.uri);
      const fileBlob = await fileResponse.blob();

      const { error: uploadError } = await supabase.storage
        .from('submissions')
        .upload(filePath, fileBlob, { contentType, upsert: false });
      if (uploadError) throw uploadError;

      const { data: { publicUrl } } = supabase.storage.from('submissions').getPublicUrl(filePath);

      const { data: inserted, error: dbError } = await supabase
        .from('submissions')
        .insert({
          session_id: session.id,
          sender_id: myId,
          file_name: fileName,
          file_url: publicUrl,
          file_type: contentType,
          file_size: selectedFile.size,
          status: 'unseen',
        })
        .select()
        .single();
      if (dbError) throw dbError;

      // Add it locally right away rather than waiting on the realtime
      // round trip — the INSERT listener's de-dupe check (by id) means
      // this won't double up when that event does arrive.
      if (inserted) {
        setDocuments((prev) => (prev.some((d) => d.id === inserted.id) ? prev : [...prev, inserted]));
      }
      setSelectedFile(null);
    } catch (e) {
      showAlert('Upload failed', e.message);
    } finally {
      setUploading(false);
    }
  };

  const getFileIcon = (type = '') => {
    if (type.includes('image')) return 'image-outline';
    if (type.includes('pdf')) return 'document-text-outline';
    if (type.includes('video')) return 'videocam-outline';
    if (type.includes('audio')) return 'musical-notes-outline';
    if (type.includes('zip') || type.includes('rar')) return 'archive-outline';
    if (type.includes('word') || type.includes('document')) return 'document-outline';
    if (type.includes('sheet') || type.includes('excel')) return 'grid-outline';
    return 'attach-outline';
  };

  const formatSize = (bytes) => {
    if (!bytes) return '';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const openDocument = (url) => {
    Linking.openURL(url).catch(() => showAlert('Could not open file', 'The link may be invalid.'));
  };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <Ionicons name="chevron-back" size={26} color={colors.white} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Documents</Text>
        <View style={{ width: 26 }} />
      </View>

      {loading ? (
        <View style={styles.centerFill}>
          <ActivityIndicator color={colors.primary} />
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.scroll}>
          {documents.length === 0 ? (
            <View style={styles.emptyState}>
              <Ionicons name="document-attach-outline" size={40} color="rgba(255,255,255,0.3)" />
              <Text style={styles.emptyText}>No documents shared yet.</Text>
            </View>
          ) : (
            documents.map((doc) => {
              const mine = doc.sender_id === myId;
              return (
                <View key={doc.id} style={[styles.docCard, mine && styles.docCardMine]}>
                  <View style={styles.docIconWrap}>
                    <Ionicons name={getFileIcon(doc.file_type)} size={20} color={colors.white} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.docSender}>{mine ? 'You' : (isHost ? 'Applicant' : 'Host')}</Text>
                    <Text style={styles.docName} numberOfLines={1}>{doc.file_name}</Text>
                    <Text style={styles.docMeta}>{formatSize(doc.file_size)}</Text>
                  </View>
                  <TouchableOpacity onPress={() => openDocument(doc.file_url)} style={styles.viewBtn}>
                    <Text style={styles.viewBtnText}>View</Text>
                  </TouchableOpacity>
                </View>
              );
            })
          )}
        </ScrollView>
      )}

      <View style={styles.composer}>
        {selectedFile ? (
          <View style={styles.selectedRow}>
            <Ionicons name={getFileIcon(selectedFile.mimeType)} size={18} color={colors.white} />
            <Text style={styles.selectedName} numberOfLines={1}>{selectedFile.name}</Text>
            <TouchableOpacity onPress={() => setSelectedFile(null)}>
              <Ionicons name="close" size={18} color="rgba(255,255,255,0.6)" />
            </TouchableOpacity>
          </View>
        ) : null}
        <View style={styles.composerRow}>
          <TouchableOpacity style={styles.pickBtn} onPress={pickFile} disabled={uploading}>
            <Ionicons name="attach-outline" size={20} color={colors.white} />
            <Text style={styles.pickBtnText}>Choose File</Text>
          </TouchableOpacity>
          {selectedFile && (
            <TouchableOpacity style={styles.sendBtn} onPress={uploadFile} disabled={uploading}>
              {uploading ? <ActivityIndicator size="small" color={colors.white} /> : <Ionicons name="send" size={18} color={colors.white} />}
            </TouchableOpacity>
          )}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0A0A1A' },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 16, paddingTop: 40, backgroundColor: '#0D0D2B' },
  headerTitle: { fontSize: 18, fontWeight: '700', color: colors.white },
  centerFill: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  scroll: { padding: 16, gap: 10 },

  emptyState: { alignItems: 'center', justifyContent: 'center', paddingTop: 80, gap: 12 },
  emptyText: { color: 'rgba(255,255,255,0.5)', fontSize: 14, textAlign: 'center' },

  docCard: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: '#1E1E3F', borderRadius: 14, padding: 12, borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)' },
  docCardMine: { borderColor: 'rgba(91,46,255,0.4)', backgroundColor: 'rgba(91,46,255,0.12)' },
  docIconWrap: { width: 36, height: 36, borderRadius: 10, backgroundColor: 'rgba(255,255,255,0.08)', alignItems: 'center', justifyContent: 'center' },
  docSender: { fontSize: 11, fontWeight: '700', color: colors.primaryLight },
  docName: { fontSize: 14, fontWeight: '600', color: colors.white, marginTop: 2 },
  docMeta: { fontSize: 11, color: 'rgba(255,255,255,0.45)', marginTop: 2 },
  viewBtn: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 10, borderWidth: 1, borderColor: 'rgba(255,255,255,0.2)' },
  viewBtnText: { fontSize: 12, fontWeight: '600', color: colors.white },

  composer: { padding: 14, paddingBottom: 24, backgroundColor: '#0D0D2B', borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.08)', gap: 10 },
  selectedRow: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: 'rgba(255,255,255,0.08)', borderRadius: 10, padding: 10 },
  selectedName: { flex: 1, color: colors.white, fontSize: 13 },
  composerRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  pickBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: 'rgba(255,255,255,0.08)', borderRadius: 12, paddingVertical: 12, borderWidth: 1, borderColor: 'rgba(255,255,255,0.15)', borderStyle: 'dashed' },
  pickBtnText: { color: colors.white, fontSize: 14, fontWeight: '600' },
  sendBtn: { width: 44, height: 44, borderRadius: 22, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
});
