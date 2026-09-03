import React, { useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, TextInput,
  KeyboardAvoidingView, Platform, ActivityIndicator, ScrollView, Image,
} from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import { Video } from 'expo-av';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '../../theme/colors';
import { supabase } from '../../lib/supabase';
import { showAlert } from '../../lib/alert';

const palette = {
  primary: colors.primary,
  primaryDeep: colors.primaryDark,
  primarySoft: colors.background,
  ink: colors.text,
  inkMuted: colors.textLight,
  surface: colors.white,
  canvas: colors.background,
  line: colors.greyLight,
  danger: colors.red,
  neutralText: colors.grey,
};

const MAX_LEN = 500;
const MAX_IMAGES = 6;
const MAX_IMAGE_BYTES = 8 * 1024 * 1024; // 8MB per photo
const MAX_VIDEO_BYTES = 50 * 1024 * 1024; // 50MB
const MAX_VIDEO_SECONDS = 30;

/**
 * Three post shapes, one composer: text-only, text + photo(s), or
 * text + a single video — photos and video are mutually exclusive,
 * same as Facebook, since mixing them in one post doesn't map cleanly
 * onto a single feed card. Picking one clears the other.
 *
 * Editing an existing post only ever touches the body text — the media
 * picker is hidden in edit mode. Letting someone swap out photos/video
 * on a post that's already live means diffing old vs new attachments,
 * partial uploads, orphaned storage files if it fails halfway — real
 * complexity for a v1 that doesn't need it yet. Delete and repost is
 * the escape hatch until that's worth building.
 */
export default function ComposePostScreen({ navigation, route }) {
  const editingPost = route?.params?.post || null;
  const isEditing = !!editingPost;
  const [body, setBody] = useState(editingPost?.body || '');
  const [images, setImages] = useState([]); // [{ uri, name, size, mimeType }]
  const [video, setVideo] = useState(null); // { uri, name, size, mimeType }
  const [pendingVideo, setPendingVideo] = useState(null); // candidate awaiting duration check
  const [checkingVideo, setCheckingVideo] = useState(false);
  const [posting, setPosting] = useState(false);

  const remaining = MAX_LEN - body.length;
  const hasMedia = images.length > 0 || !!video;
  const canPost = (body.trim().length > 0 || hasMedia) && remaining >= 0 && !posting && !checkingVideo;

  const pickImages = async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: 'image/*',
        copyToCacheDirectory: true,
        multiple: true,
      });
      if (result.canceled) return;

      const assets = result.assets || [];
      const tooBig = assets.filter((a) => a.size && a.size > MAX_IMAGE_BYTES);
      if (tooBig.length > 0) {
        showAlert('Some photos are too large', 'Each photo must be under 8MB.');
      }
      const valid = assets.filter((a) => !a.size || a.size <= MAX_IMAGE_BYTES);

      setVideo(null); // photos and video are mutually exclusive
      setImages((prev) => [...prev, ...valid].slice(0, MAX_IMAGES));
    } catch (e) {
      showAlert('Could not open photo picker', e.message);
    }
  };

  const pickVideo = async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: 'video/*',
        copyToCacheDirectory: true,
        multiple: false,
      });
      if (result.canceled) return;

      const asset = result.assets?.[0];
      if (!asset) return;
      if (asset.size && asset.size > MAX_VIDEO_BYTES) {
        showAlert('Video too large', 'Maximum size is 50MB.');
        return;
      }

      // expo-document-picker doesn't hand back duration — only a real
      // player knows that, so a hidden, invisible <Video> below briefly
      // loads the file just to read status.durationMillis, then
      // discards itself. checkingVideo covers that brief window so the
      // Video/Photo buttons don't look like they silently did nothing.
      setImages([]); // photos and video are mutually exclusive
      setCheckingVideo(true);
      setPendingVideo(asset);
    } catch (e) {
      showAlert('Could not open video picker', e.message);
    }
  };

  const handleVideoProbeLoad = (status) => {
    setCheckingVideo(false);
    const durationSeconds = (status.durationMillis || 0) / 1000;
    if (durationSeconds > MAX_VIDEO_SECONDS) {
      showAlert('Video too long', `Videos must be ${MAX_VIDEO_SECONDS} seconds or shorter.`);
      setPendingVideo(null);
      return;
    }
    setVideo(pendingVideo);
    setPendingVideo(null);
  };

  const handleVideoProbeError = () => {
    setCheckingVideo(false);
    setPendingVideo(null);
    showAlert('Could not read video', 'Please try a different file.');
  };

  const removeImage = (idx) => setImages((prev) => prev.filter((_, i) => i !== idx));

  // asset.uri is a local file:// URI on native, a blob: URI on web —
  // same fetch()+blob() trick SubmitFile.js already relies on turns
  // either into what supabase-js storage upload() expects.
  const uploadAsset = async (asset, userId) => {
    const timestamp = Date.now();
    const rand = Math.round(Math.random() * 1e6);
    const path = `${userId}/${timestamp}_${rand}_${asset.name}`;
    const contentType = asset.mimeType || 'application/octet-stream';

    const fileResponse = await fetch(asset.uri);
    const fileBlob = await fileResponse.blob();

    const { error: uploadError } = await supabase.storage
      .from('feed-media')
      .upload(path, fileBlob, { contentType, upsert: false });
    if (uploadError) throw uploadError;

    const { data: { publicUrl } } = supabase.storage.from('feed-media').getPublicUrl(path);
    return publicUrl;
  };

  const handlePost = async () => {
    if (!canPost) return;
    setPosting(true);
    try {
      const { data: { user }, error: userError } = await supabase.auth.getUser();
      if (userError || !user) throw userError || new Error('Session expired. Please sign in again.');

      if (isEditing) {
        const { error } = await supabase
          .from('feed_posts')
          .update({ body: body.trim() })
          .eq('id', editingPost.id)
          .eq('author_id', user.id);
        if (error) throw error;
      } else {
        const mediaType = video ? 'video' : images.length > 0 ? 'image' : null;

        const { data: newPost, error } = await supabase
          .from('feed_posts')
          .insert({
            author_id: user.id,
            type: 'post',
            body: body.trim(),
            status: 'published',
            published_at: new Date().toISOString(),
            media_type: mediaType,
          })
          .select()
          .single();
        if (error) throw error;

        if (mediaType === 'video') {
          const url = await uploadAsset(video, user.id);
          const { error: mediaError } = await supabase
            .from('feed_post_media')
            .insert({ post_id: newPost.id, url, position: 0 });
          if (mediaError) throw mediaError;
        } else if (mediaType === 'image') {
          const urls = await Promise.all(images.map((img) => uploadAsset(img, user.id)));
          const rows = urls.map((url, i) => ({ post_id: newPost.id, url, position: i }));
          const { error: mediaError } = await supabase.from('feed_post_media').insert(rows);
          if (mediaError) throw mediaError;
        }
      }

      navigation.goBack();
    } catch (err) {
      showAlert(isEditing ? 'Could not save changes' : 'Could not post', err.message || 'Please try again.');
    } finally {
      setPosting(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <View style={styles.grabberWrap}>
        <View style={styles.grabber} />
      </View>

      <View style={styles.topRow}>
        <TouchableOpacity onPress={() => navigation.goBack()} activeOpacity={0.7} style={styles.cancelBtn}>
          <Text style={styles.cancelText}>Cancel</Text>
        </TouchableOpacity>
        <Text style={styles.title}>{isEditing ? 'Edit Post' : 'Add a Post'}</Text>
        <TouchableOpacity
          onPress={handlePost}
          disabled={!canPost}
          activeOpacity={0.85}
          style={[styles.postBtn, !canPost && styles.postBtnDisabled]}
        >
          {posting
            ? <ActivityIndicator size="small" color={palette.surface} />
            : <Text style={styles.postBtnText}>{isEditing ? 'Save' : 'Post'}</Text>
          }
        </TouchableOpacity>
      </View>

      <ScrollView style={styles.body} keyboardShouldPersistTaps="handled">
        <TextInput
          style={styles.input}
          placeholder="What's happening?"
          placeholderTextColor={palette.neutralText}
          value={body}
          onChangeText={setBody}
          multiline
          autoFocus={!isEditing}
          maxLength={MAX_LEN + 20 /* soft cap — real cap enforced by canPost so a paste over the limit doesn't just get silently truncated mid-word */}
        />

        {images.length > 0 && (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.mediaRow}>
            {images.map((img, i) => (
              <View key={img.uri + i} style={styles.imageThumbWrap}>
                <Image source={{ uri: img.uri }} style={styles.imageThumb} />
                <TouchableOpacity style={styles.removeMediaBtn} onPress={() => removeImage(i)} activeOpacity={0.8}>
                  <Ionicons name="close" size={13} color={palette.surface} />
                </TouchableOpacity>
              </View>
            ))}
          </ScrollView>
        )}

        {checkingVideo && (
          <View style={styles.videoCard}>
            <ActivityIndicator size="small" color={palette.primary} />
            <Text style={[styles.videoName, { marginLeft: 10 }]}>Checking video length…</Text>
          </View>
        )}

        {video && (
          <View style={styles.videoCard}>
            <View style={styles.videoIconWrap}>
              <Ionicons name="videocam" size={20} color={palette.primary} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.videoName} numberOfLines={1}>{video.name}</Text>
              {video.size ? <Text style={styles.videoSize}>{Math.round(video.size / (1024 * 1024))}MB</Text> : null}
            </View>
            <TouchableOpacity style={styles.removeVideoBtn} onPress={() => setVideo(null)} activeOpacity={0.7}>
              <Ionicons name="close" size={16} color={palette.neutralText} />
            </TouchableOpacity>
          </View>
        )}

        {isEditing && editingPost?.media_type && (
          <Text style={styles.editMediaNote}>
            {editingPost.media_type === 'video' ? 'This post\'s video' : 'This post\'s photos'} can't be changed — delete and repost if you need to swap it out.
          </Text>
        )}
      </ScrollView>

      {pendingVideo && (
        <Video
          source={{ uri: pendingVideo.uri }}
          style={styles.hiddenProbe}
          onLoad={handleVideoProbeLoad}
          onError={handleVideoProbeError}
        />
      )}

      <View style={styles.footer}>
        {!isEditing && (
          <View style={styles.mediaButtons}>
            <TouchableOpacity style={styles.mediaBtn} onPress={pickImages} activeOpacity={0.7} disabled={!!video}>
              <Ionicons name="image-outline" size={19} color={video ? palette.line : palette.primary} />
              <Text style={[styles.mediaBtnText, video && { color: palette.line }]}>Photo</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.mediaBtn} onPress={pickVideo} activeOpacity={0.7} disabled={images.length > 0}>
              <Ionicons name="videocam-outline" size={19} color={images.length > 0 ? palette.line : palette.primary} />
              <Text style={[styles.mediaBtnText, images.length > 0 && { color: palette.line }]}>Video</Text>
            </TouchableOpacity>
          </View>
        )}
        <Text style={[styles.counter, remaining < 0 && styles.counterOver]}>
          {remaining}
        </Text>
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
    paddingHorizontal: 16, paddingTop: 14, paddingBottom: 10,
  },
  cancelBtn: { paddingVertical: 6, paddingRight: 8 },
  cancelText: { fontSize: 14.5, color: palette.inkMuted, fontWeight: '600' },
  title: { fontSize: 15.5, fontWeight: '800', color: palette.ink },
  postBtn: { backgroundColor: palette.primary, borderRadius: 20, paddingHorizontal: 18, paddingVertical: 8, minWidth: 64, alignItems: 'center' },
  postBtnDisabled: { opacity: 0.4 },
  postBtnText: { color: palette.surface, fontWeight: '800', fontSize: 13.5 },

  body: { flex: 1, paddingHorizontal: 18, paddingTop: 6 },
  input: {
    fontSize: 17, color: palette.ink, fontWeight: '500',
    lineHeight: 24, textAlignVertical: 'top', outlineStyle: 'none',
    minHeight: 100,
  },

  mediaRow: { marginTop: 12 },
  imageThumbWrap: { marginRight: 10 },
  imageThumb: { width: 84, height: 84, borderRadius: 12, backgroundColor: palette.line },
  removeMediaBtn: {
    position: 'absolute', top: -6, right: -6,
    width: 22, height: 22, borderRadius: 11,
    backgroundColor: 'rgba(0,0,0,0.55)', alignItems: 'center', justifyContent: 'center',
  },

  videoCard: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: palette.primarySoft, borderRadius: 14, padding: 12, marginTop: 12,
  },
  videoIconWrap: { width: 36, height: 36, borderRadius: 10, backgroundColor: palette.surface, alignItems: 'center', justifyContent: 'center' },
  videoName: { fontSize: 13.5, fontWeight: '700', color: palette.ink },
  videoSize: { fontSize: 11.5, color: palette.inkMuted, marginTop: 2 },
  removeVideoBtn: { width: 26, height: 26, borderRadius: 13, alignItems: 'center', justifyContent: 'center' },

  editMediaNote: { fontSize: 12, color: palette.neutralText, marginTop: 12, fontStyle: 'italic' },

  hiddenProbe: { position: 'absolute', width: 1, height: 1, opacity: 0, top: -9999 },

  footer: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 18, paddingBottom: 18, paddingTop: 8,
  },
  mediaButtons: { flexDirection: 'row', gap: 18 },
  mediaBtn: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  mediaBtnText: { fontSize: 13, fontWeight: '700', color: palette.primary },
  counter: { fontSize: 12, color: palette.neutralText, fontWeight: '600' },
  counterOver: { color: palette.danger },
});
