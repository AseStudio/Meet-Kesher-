import React, { useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, TextInput,
  KeyboardAvoidingView, Platform, ActivityIndicator, ScrollView, Image,
} from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import { Video } from 'expo-av';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '../../lib/supabase';
import { showAlert } from '../../lib/alert';

// Vibrant Purple + White palette
const palette = {
  primary:       '#7C3AED',   // vibrant violet
  primaryDeep:   '#5B21B6',   // deep purple
  primarySoft:   '#F5F3FF',   // very light purple
  primarySoft2:  '#EDE9FE',   // slightly stronger soft purple
  ink:           '#1E1B4B',   // deep indigo-black
  inkMuted:      '#6B7280',
  surface:       '#FFFFFF',
  canvas:        '#FAFAFF',   // almost white with a tiny purple tint
  line:          '#E9E5FF',
  danger:        '#EF4444',
  neutralText:   '#9CA3AF',
};

const MAX_LEN = 500;
const MAX_IMAGES = 6;
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const MAX_VIDEO_BYTES = 50 * 1024 * 1024;
const MAX_VIDEO_SECONDS = 30;

export default function ComposePostScreen({ navigation, route }) {
  const editingPost = route?.params?.post || null;
  const isEditing = !!editingPost;
  const [body, setBody] = useState(editingPost?.body || '');
  const [images, setImages] = useState([]);
  const [video, setVideo] = useState(null);
  const [pendingVideo, setPendingVideo] = useState(null);
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

      setVideo(null);
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

      setImages([]);
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
      {/* Grabber */}
      <View style={styles.grabberWrap}>
        <View style={styles.grabber} />
      </View>

      {/* Header */}
      <View style={styles.topRow}>
        <TouchableOpacity onPress={() => navigation.goBack()} activeOpacity={0.7} style={styles.cancelBtn}>
          <Text style={styles.cancelText}>Cancel</Text>
        </TouchableOpacity>

        <Text style={styles.title}>{isEditing ? 'Edit Post' : 'Create Post'}</Text>

        <TouchableOpacity
          onPress={handlePost}
          disabled={!canPost}
          activeOpacity={0.85}
          style={[styles.postBtn, !canPost && styles.postBtnDisabled]}
        >
          {posting ? (
            <ActivityIndicator size="small" color="#FFFFFF" />
          ) : (
            <Text style={styles.postBtnText}>{isEditing ? 'Save' : 'Post'}</Text>
          )}
        </TouchableOpacity>
      </View>

      <ScrollView style={styles.body} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
        <TextInput
          style={styles.input}
          placeholder="What's on your mind?"
          placeholderTextColor={palette.neutralText}
          value={body}
          onChangeText={setBody}
          multiline
          autoFocus={!isEditing}
          maxLength={MAX_LEN + 20}
        />

        {/* Image previews */}
        {images.length > 0 && (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.mediaRow}>
            {images.map((img, i) => (
              <View key={img.uri + i} style={styles.imageThumbWrap}>
                <Image source={{ uri: img.uri }} style={styles.imageThumb} />
                <TouchableOpacity style={styles.removeMediaBtn} onPress={() => removeImage(i)} activeOpacity={0.8}>
                  <Ionicons name="close" size={13} color="#FFFFFF" />
                </TouchableOpacity>
              </View>
            ))}
          </ScrollView>
        )}

        {/* Checking video */}
        {checkingVideo && (
          <View style={styles.videoCard}>
            <ActivityIndicator size="small" color={palette.primary} />
            <Text style={[styles.videoName, { marginLeft: 10 }]}>Checking video length…</Text>
          </View>
        )}

        {/* Selected video */}
        {video && (
          <View style={styles.videoCard}>
            <View style={styles.videoIconWrap}>
              <Ionicons name="videocam" size={20} color={palette.primary} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.videoName} numberOfLines={1}>{video.name}</Text>
              {video.size ? (
                <Text style={styles.videoSize}>{Math.round(video.size / (1024 * 1024))}MB</Text>
              ) : null}
            </View>
            <TouchableOpacity style={styles.removeVideoBtn} onPress={() => setVideo(null)} activeOpacity={0.7}>
              <Ionicons name="close" size={16} color={palette.inkMuted} />
            </TouchableOpacity>
          </View>
        )}

        {isEditing && editingPost?.media_type && (
          <Text style={styles.editMediaNote}>
            {editingPost.media_type === 'video'
              ? "This post's video can't be changed — delete and repost if you need to swap it."
              : "This post's photos can't be changed — delete and repost if you need to swap them."}
          </Text>
        )}
      </ScrollView>

      {/* Hidden video probe */}
      {pendingVideo && (
        <Video
          source={{ uri: pendingVideo.uri }}
          style={styles.hiddenProbe}
          onLoad={handleVideoProbeLoad}
          onError={handleVideoProbeError}
        />
      )}

      {/* Footer */}
      <View style={styles.footer}>
        {!isEditing && (
          <View style={styles.mediaButtons}>
            <TouchableOpacity
              style={styles.mediaBtn}
              onPress={pickImages}
              activeOpacity={0.7}
              disabled={!!video}
            >
              <Ionicons
                name="image-outline"
                size={20}
                color={video ? palette.line : palette.primary}
              />
              <Text style={[styles.mediaBtnText, video && { color: palette.line }]}>
                Photo
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.mediaBtn}
              onPress={pickVideo}
              activeOpacity={0.7}
              disabled={images.length > 0}
            >
              <Ionicons
                name="videocam-outline"
                size={20}
                color={images.length > 0 ? palette.line : palette.primary}
              />
              <Text style={[styles.mediaBtnText, images.length > 0 && { color: palette.line }]}>
                Video
              </Text>
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
  container: {
    flex: 1,
    backgroundColor: palette.canvas,
  },
  grabberWrap: {
    alignItems: 'center',
    paddingTop: 12,
  },
  grabber: {
    width: 40,
    height: 5,
    borderRadius: 3,
    backgroundColor: palette.primarySoft2,
  },

  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 18,
    paddingTop: 14,
    paddingBottom: 12,
  },
  cancelBtn: {
    paddingVertical: 6,
    paddingRight: 8,
  },
  cancelText: {
    fontSize: 15,
    color: palette.inkMuted,
    fontWeight: '600',
  },
  title: {
    fontSize: 17,
    fontWeight: '800',
    color: palette.ink,
    letterSpacing: -0.3,
  },
  postBtn: {
    backgroundColor: palette.primary,
    borderRadius: 24,
    paddingHorizontal: 20,
    paddingVertical: 9,
    minWidth: 72,
    alignItems: 'center',
    shadowColor: palette.primary,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 8,
    elevation: 4,
  },
  postBtnDisabled: {
    opacity: 0.38,
    shadowOpacity: 0,
    elevation: 0,
  },
  postBtnText: {
    color: '#FFFFFF',
    fontWeight: '800',
    fontSize: 14,
  },

  body: {
    flex: 1,
    paddingHorizontal: 20,
    paddingTop: 8,
  },
  input: {
    fontSize: 18,
    color: palette.ink,
    fontWeight: '500',
    lineHeight: 26,
    textAlignVertical: 'top',
    minHeight: 110,
  },

  mediaRow: {
    marginTop: 16,
  },
  imageThumbWrap: {
    marginRight: 12,
  },
  imageThumb: {
    width: 92,
    height: 92,
    borderRadius: 16,
    backgroundColor: palette.line,
  },
  removeMediaBtn: {
    position: 'absolute',
    top: -7,
    right: -7,
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: 'rgba(0,0,0,0.6)',
    alignItems: 'center',
    justifyContent: 'center',
  },

  videoCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: palette.primarySoft,
    borderRadius: 16,
    padding: 14,
    marginTop: 16,
    borderWidth: 1,
    borderColor: palette.primarySoft2,
  },
  videoIconWrap: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: palette.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  videoName: {
    fontSize: 14,
    fontWeight: '700',
    color: palette.ink,
  },
  videoSize: {
    fontSize: 12,
    color: palette.inkMuted,
    marginTop: 2,
  },
  removeVideoBtn: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },

  editMediaNote: {
    fontSize: 13,
    color: palette.neutralText,
    marginTop: 16,
    fontStyle: 'italic',
    lineHeight: 18,
  },

  hiddenProbe: {
    position: 'absolute',
    width: 1,
    height: 1,
    opacity: 0,
    top: -9999,
  },

  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingBottom: 22,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: palette.line,
  },
  mediaButtons: {
    flexDirection: 'row',
    gap: 22,
  },
  mediaBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  mediaBtnText: {
    fontSize: 14,
    fontWeight: '700',
    color: palette.primary,
  },
  counter: {
    fontSize: 13,
    color: palette.neutralText,
    fontWeight: '600',
  },
  counterOver: {
    color: palette.danger,
  },
});