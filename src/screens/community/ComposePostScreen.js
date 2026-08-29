import React, { useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, TextInput,
  KeyboardAvoidingView, Platform, ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '../../theme/colors';
import { supabase } from '../../lib/supabase';
import { showAlert } from '../../lib/alert';

// Same tokens as the rest of the production-pass screens.
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

/**
 * The only place a `type: 'post'` row in feed_posts ever gets created —
 * anyone (host or attendee) can post an update here. Kept deliberately
 * simple for v1: body text only, no channel tagging, no attachments —
 * those are easy to layer on later without touching the post shape
 * FeedTab already renders everything else through.
 */
export default function ComposePostScreen({ navigation, route }) {
  const editingPost = route?.params?.post || null;
  const isEditing = !!editingPost;
  const [body, setBody] = useState(editingPost?.body || '');
  const [posting, setPosting] = useState(false);

  const remaining = MAX_LEN - body.length;
  const canPost = body.trim().length > 0 && remaining >= 0 && !posting;

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
        const { error } = await supabase.from('feed_posts').insert({
          author_id: user.id,
          type: 'post',
          body: body.trim(),
          status: 'published',
          published_at: new Date().toISOString(),
        });
        if (error) throw error;
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

      <View style={styles.body}>
        <TextInput
          style={styles.input}
          placeholder="What's happening?"
          placeholderTextColor={palette.neutralText}
          value={body}
          onChangeText={setBody}
          multiline
          autoFocus
          maxLength={MAX_LEN + 20 /* soft cap — real cap enforced by canPost so a paste over the limit doesn't just get silently truncated mid-word */}
        />
      </View>

      <View style={styles.footer}>
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
    flex: 1, fontSize: 17, color: palette.ink, fontWeight: '500',
    lineHeight: 24, textAlignVertical: 'top', outlineStyle: 'none',
  },

  footer: { paddingHorizontal: 18, paddingBottom: 18, alignItems: 'flex-end' },
  counter: { fontSize: 12, color: palette.neutralText, fontWeight: '600' },
  counterOver: { color: palette.danger },
});
