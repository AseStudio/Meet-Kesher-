import React, { useState, useEffect, useRef } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity,
  ScrollView, ActivityIndicator, Alert
} from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import * as Linking from 'expo-linking';
import { colors } from '../../theme/colors';
import { supabase } from '../../lib/supabase';

export default function SubmitFile({ navigation, route }) {
  const passedSession = route.params?.session;

  const [sessions, setSessions] = useState([]);
  const [selectedSession, setSelectedSession] = useState(passedSession || null);
  const [selectedFile, setSelectedFile] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [submissions, setSubmissions] = useState([]);
  const [loadingSubs, setLoadingSubs] = useState(true);
  const [uploadSuccess, setUploadSuccess] = useState(false);

  useEffect(() => {
    loadMySessions();
    loadMySubmissions();
  }, []);

  const loadMySessions = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const { data } = await supabase
        .from('session_attendees')
        .select('*, sessions(id, title, code, status)')
        .eq('user_id', user.id)
        .order('joined_at', { ascending: false })
        .limit(10);

      const liveSessions = data
        ?.filter(s => s.sessions?.status !== 'ended')
        .map(s => s.sessions)
        .filter(Boolean) || [];

      setSessions(liveSessions);
      if (!selectedSession && liveSessions.length > 0) {
        setSelectedSession(liveSessions[0]);
      }
    } catch (e) {}
  };

  const loadMySubmissions = async () => {
    setLoadingSubs(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const { data } = await supabase
        .from('submissions')
        .select('*, sessions(title)')
        .eq('sender_id', user.id)
        .order('created_at', { ascending: false })
        .limit(20);

      setSubmissions(data || []);
    } catch (e) {} finally {
      setLoadingSubs(false);
    }
  };

  // expo-document-picker works on web (wraps a hidden <input type=file>)
  // as well as native, so this is one code path for both — the old
  // web-only branch is gone, not just extended.
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
        Alert.alert('File too large', 'Maximum size is 20MB.');
        return;
      }

      setSelectedFile(asset); // { uri, name, size, mimeType }
      setUploadSuccess(false);
    } catch (e) {
      Alert.alert('Could not open file picker', e.message);
    }
  };

  const uploadFile = async () => {
    if (!selectedFile || !selectedSession) {
      Alert.alert('Missing info', !selectedFile ? 'Please select a file.' : 'Please select a session.');
      return;
    }

    setUploading(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      const timestamp = Date.now();
      const fileName = selectedFile.name;
      const filePath = `${selectedSession.id}/${user.id}/${timestamp}_${fileName}`;
      const contentType = selectedFile.mimeType || 'application/octet-stream';

      // expo-document-picker's asset.uri is a local file:// URI on
      // native and a blob: URI on web — fetch()+blob() turns either
      // into the Blob supabase-js storage upload() expects, so this is
      // one path for both platforms instead of two.
      const fileResponse = await fetch(selectedFile.uri);
      const fileBlob = await fileResponse.blob();

      // Upload to Supabase Storage
      const { data: uploadData, error: uploadError } = await supabase.storage
        .from('submissions')
        .upload(filePath, fileBlob, {
          contentType,
          upsert: false,
        });

      if (uploadError) throw uploadError;

      // Get public URL
      const { data: { publicUrl } } = supabase.storage
        .from('submissions')
        .getPublicUrl(filePath);

      // Insert submission record
      const { error: dbError } = await supabase.from('submissions').insert({
        session_id: selectedSession.id,
        sender_id: user.id,
        file_name: fileName,
        file_url: publicUrl,
        file_type: contentType,
        file_size: selectedFile.size,
        status: 'unseen',
      });

      if (dbError) throw dbError;

      setUploadSuccess(true);
      setSelectedFile(null);
      loadMySubmissions();

    } catch (e) {
      Alert.alert('Upload failed', e.message);
    } finally {
      setUploading(false);
    }
  };

  const getFileIcon = (type = '') => {
    if (type.includes('image')) return '🖼️';
    if (type.includes('pdf')) return '📄';
    if (type.includes('video')) return '🎬';
    if (type.includes('audio')) return '🎵';
    if (type.includes('zip') || type.includes('rar')) return '🗜️';
    if (type.includes('word') || type.includes('document')) return '📝';
    if (type.includes('sheet') || type.includes('excel')) return '📊';
    return '📎';
  };

  const getStatusStyle = (status) => {
    switch (status) {
      case 'unseen': return { bg: '#F0ECFF', text: colors.primary, label: '● Unseen' };
      case 'seen': return { bg: colors.greyLight, text: colors.grey, label: '● Seen' };
      case 'responded': return { bg: '#E8FFE8', text: colors.green, label: '✓ Responded' };
      default: return { bg: colors.greyLight, text: colors.grey, label: status };
    }
  };

  const formatSize = (bytes) => {
    if (!bytes) return '';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
          <Text style={styles.backIcon}>←</Text>
        </TouchableOpacity>
        <View>
          <Text style={styles.headerTitle}>Submit a File</Text>
          <Text style={styles.headerSub}>Send files to your session host</Text>
        </View>
      </View>

      <ScrollView contentContainerStyle={styles.scroll}>

        {/* Session Selector */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>📋 Select Session</Text>
          {sessions.length === 0 ? (
            <Text style={styles.noSessionText}>No active sessions. Join a session first.</Text>
          ) : (
            sessions.map(s => (
              <TouchableOpacity
                key={s.id}
                style={[styles.sessionOption, selectedSession?.id === s.id && styles.sessionOptionActive]}
                onPress={() => setSelectedSession(s)}
              >
                <View style={[styles.sessionOptionDot, selectedSession?.id === s.id && styles.sessionOptionDotActive]} />
                <View style={{ flex: 1 }}>
                  <Text style={[styles.sessionOptionTitle, selectedSession?.id === s.id && styles.sessionOptionTitleActive]}>
                    {s.title}
                  </Text>
                  <Text style={styles.sessionOptionCode}>Code: {s.code}</Text>
                </View>
              </TouchableOpacity>
            ))
          )}
        </View>

        {/* File Picker */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>📎 Choose File</Text>
          <Text style={styles.cardSub}>Max 20MB — any file type accepted</Text>

          {uploadSuccess ? (
            <View style={styles.successBanner}>
              <Text style={styles.successIcon}>✅</Text>
              <Text style={styles.successText}>File submitted successfully!</Text>
            </View>
          ) : selectedFile ? (
            <View style={styles.selectedFileCard}>
              <Text style={styles.selectedFileIcon}>{getFileIcon(selectedFile.mimeType)}</Text>
              <View style={{ flex: 1 }}>
                <Text style={styles.selectedFileName} numberOfLines={1}>{selectedFile.name}</Text>
                <Text style={styles.selectedFileSize}>{formatSize(selectedFile.size)}</Text>
              </View>
              <TouchableOpacity onPress={() => setSelectedFile(null)} style={styles.removeFileBtn}>
                <Text style={styles.removeFileBtnText}>✕</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <TouchableOpacity style={styles.pickBtn} onPress={pickFile}>
              <Text style={styles.pickBtnIcon}>📂</Text>
              <Text style={styles.pickBtnText}>Browse Files</Text>
            </TouchableOpacity>
          )}

          {selectedFile && !uploadSuccess && (
            <TouchableOpacity
              style={[styles.uploadBtn, uploading && styles.uploadBtnDisabled]}
              onPress={uploadFile}
              disabled={uploading}
            >
              {uploading ? (
                <ActivityIndicator color={colors.white} />
              ) : (
                <Text style={styles.uploadBtnText}>🚀 Submit File</Text>
              )}
            </TouchableOpacity>
          )}
        </View>

        {/* My Submissions */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>📬 My Submissions</Text>
          {loadingSubs ? (
            <ActivityIndicator color={colors.primary} style={{ marginVertical: 16 }} />
          ) : submissions.length === 0 ? (
            <Text style={styles.noSessionText}>No submissions yet.</Text>
          ) : (
            submissions.map((sub, i) => {
              const statusStyle = getStatusStyle(sub.status);
              return (
                <View key={sub.id || i} style={styles.submissionRow}>
                  <Text style={styles.submissionIcon}>{getFileIcon(sub.file_type)}</Text>
                  <View style={styles.submissionInfo}>
                    <Text style={styles.submissionName} numberOfLines={1}>{sub.file_name}</Text>
                    <Text style={styles.submissionSession} numberOfLines={1}>
                      {sub.sessions?.title || 'Session'}
                    </Text>
                    {sub.reply && (
                      <View style={styles.replyBubble}>
                        <Text style={styles.replyLabel}>Host replied:</Text>
                        <Text style={styles.replyText}>{sub.reply}</Text>
                      </View>
                    )}
                  </View>
                  <View style={{ alignItems: 'flex-end', gap: 4 }}>
                    <View style={[styles.statusBadge, { backgroundColor: statusStyle.bg }]}>
                      <Text style={[styles.statusBadgeText, { color: statusStyle.text }]}>
                        {statusStyle.label}
                      </Text>
                    </View>
                    {sub.file_url && (
                      <TouchableOpacity
                        onPress={() =>
                          Linking.openURL(sub.file_url).catch(() =>
                            Alert.alert('Could not open file', 'The link may be invalid.')
                          )
                        }
                      >
                        <Text style={styles.viewLink}>View ↗</Text>
                      </TouchableOpacity>
                    )}
                  </View>
                </View>
              );
            })
          )}
        </View>

      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  header: { flexDirection: 'row', alignItems: 'center', gap: 14, padding: 20, paddingTop: 50, backgroundColor: colors.white, borderBottomWidth: 1, borderBottomColor: colors.greyLight },
  backBtn: { width: 38, height: 38, borderRadius: 19, backgroundColor: colors.greyLight, alignItems: 'center', justifyContent: 'center' },
  backIcon: { fontSize: 18, color: colors.text },
  headerTitle: { fontSize: 20, fontWeight: '800', color: colors.text },
  headerSub: { fontSize: 13, color: colors.textLight, marginTop: 2 },
  scroll: { padding: 16, gap: 14, paddingBottom: 40 },
  card: { backgroundColor: colors.white, borderRadius: 18, padding: 18, elevation: 2, gap: 10 },
  cardTitle: { fontSize: 16, fontWeight: '700', color: colors.text },
  cardSub: { fontSize: 12, color: colors.textLight, marginTop: -6 },
  noSessionText: { fontSize: 13, color: colors.textLight, textAlign: 'center', paddingVertical: 8 },
  sessionOption: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 12, borderRadius: 12, borderWidth: 1.5, borderColor: colors.greyLight },
  sessionOptionActive: { borderColor: colors.primary, backgroundColor: '#F0ECFF' },
  sessionOptionDot: { width: 16, height: 16, borderRadius: 8, borderWidth: 2, borderColor: colors.greyLight },
  sessionOptionDotActive: { borderColor: colors.primary, backgroundColor: colors.primary },
  sessionOptionTitle: { fontSize: 14, fontWeight: '600', color: colors.text },
  sessionOptionTitleActive: { color: colors.primary },
  sessionOptionCode: { fontSize: 11, color: colors.textLight, marginTop: 2 },
  successBanner: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: '#E8FFE8', borderRadius: 12, padding: 14, borderWidth: 1, borderColor: colors.green },
  successIcon: { fontSize: 22 },
  successText: { fontSize: 14, fontWeight: '600', color: colors.green },
  selectedFileCard: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: colors.greyLight, borderRadius: 12, padding: 12 },
  selectedFileIcon: { fontSize: 28 },
  selectedFileName: { fontSize: 14, fontWeight: '600', color: colors.text },
  selectedFileSize: { fontSize: 11, color: colors.textLight, marginTop: 2 },
  removeFileBtn: { width: 28, height: 28, borderRadius: 14, backgroundColor: 'rgba(0,0,0,0.1)', alignItems: 'center', justifyContent: 'center' },
  removeFileBtnText: { fontSize: 13, color: colors.grey },
  pickBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, backgroundColor: colors.greyLight, borderRadius: 14, paddingVertical: 18, borderWidth: 2, borderColor: colors.greyLight, borderStyle: 'dashed' },
  pickBtnIcon: { fontSize: 24 },
  pickBtnText: { fontSize: 15, fontWeight: '600', color: colors.text },
  uploadBtn: { backgroundColor: colors.primary, borderRadius: 12, paddingVertical: 14, alignItems: 'center', marginTop: 4 },
  uploadBtnDisabled: { opacity: 0.6 },
  uploadBtnText: { color: colors.white, fontSize: 15, fontWeight: '700' },
  submissionRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: colors.greyLight },
  submissionIcon: { fontSize: 24, marginTop: 2 },
  submissionInfo: { flex: 1, gap: 2 },
  submissionName: { fontSize: 13, fontWeight: '600', color: colors.text },
  submissionSession: { fontSize: 11, color: colors.textLight },
  replyBubble: { backgroundColor: '#F0F8FF', borderRadius: 8, padding: 8, marginTop: 4, borderLeftWidth: 3, borderLeftColor: colors.primary },
  replyLabel: { fontSize: 10, fontWeight: '700', color: colors.primary, marginBottom: 2 },
  replyText: { fontSize: 12, color: colors.text },
  statusBadge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8 },
  statusBadgeText: { fontSize: 11, fontWeight: '600' },
  viewLink: { fontSize: 12, color: colors.primary, fontWeight: '600' },
});