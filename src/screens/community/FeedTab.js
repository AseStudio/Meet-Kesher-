import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity,
  FlatList, ActivityIndicator, RefreshControl, ScrollView, Image, Dimensions,
} from 'react-native';
import { Video, ResizeMode } from 'expo-av';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '../../theme/colors';
import { supabase } from '../../lib/supabase';
import { showAlert } from '../../lib/alert';

const SCREEN_WIDTH = Dimensions.get('window').width;

const palette = {
  primary: colors.primary,
  primarySoft: colors.background,
  ink: colors.text,
  inkMuted: colors.textLight,
  surface: colors.white,
  canvas: colors.background,
  line: colors.greyLight,
  neutralText: colors.grey,
  success: colors.green,
  successSoft: '#E7FBF0',
  amber: colors.yellow,
  amberSoft: '#FFF3DE',
  premium: '#7C3AED',
  premiumSoft: '#F1E8FE',
  danger: colors.red,
};

// Note: the actual auto-hide threshold lives in the report_feed_post()
// Postgres function now, not here — keep the two in sync if you change
// it (currently 3, hardcoded in that function's SQL).

// ─────────────────────────────────────────────────────────────────────
// One shared visual shape for every kind of thing that can show up in
// the feed — a real post, an achievement, a sponsored row, or a
// premium-upsell card. They differ only in icon/label/accent and
// whether a reaction row / author row makes sense; the card shell
// underneath (postCard/postHeader) is identical for all of them.
// ─────────────────────────────────────────────────────────────────────
const KIND_META = {
  post:            { label: 'Post',        icon: 'chatbubble-ellipses-outline', iconColor: palette.primary,  iconBg: palette.primarySoft },
  achievement:     { label: 'Achievement', icon: 'trophy',                      iconColor: palette.amber,    iconBg: palette.amberSoft },
  advertisement:   { label: 'Sponsored',   icon: 'megaphone',                   iconColor: palette.primary,  iconBg: palette.primarySoft },
  ad_slot:         { label: 'Sponsored',   icon: 'megaphone',                   iconColor: palette.primary,  iconBg: palette.primarySoft },
  premium_upsell:  { label: 'Kesher Premium', icon: 'sparkles',                 iconColor: palette.premium,  iconBg: palette.premiumSoft },
};

// Placeholder ad copy — stands in until a real ad network (AdSense on
// web, AdMob on native) is wired in. Rotated so the same line doesn't
// show up every time an ad slot lands.
const PLACEHOLDER_ADS = [
  'Ads help keep Kesher free for everyone. Go Premium to skip them.',
  'This spot is reserved for a sponsor — nothing here yet.',
  'Your ad could go here. Sponsored slots coming soon.',
];

// Real posts get grouped into randomly-sized windows (4-6 posts), and
// exactly one promo card (ad or premium upsell) is dropped at a random
// position inside each window. That guarantees a promo shows up
// regularly without ever being predictable — same spot every time is
// what makes an ad annoying, not the ad itself.
const MIN_WINDOW = 4;
const MAX_WINDOW = 6;

function classify(post) {
  if (post.type === 'advertisement') return 'advertisement';
  if (post.type === 'achievement') return 'achievement';
  return 'post';
}

function buildDisplayFeed(posts, isPremium) {
  const real = posts.map((p) => ({ ...p, _kind: classify(p) }));

  // Premium: exactly what's actually there, nothing injected.
  if (isPremium || real.length < MIN_WINDOW) return real;

  const result = [];
  let i = 0;
  let windowIndex = 0;

  while (i < real.length) {
    const windowSize = MIN_WINDOW + Math.floor(Math.random() * (MAX_WINDOW - MIN_WINDOW + 1));
    const slice = real.slice(i, i + windowSize);

    // Don't bundle a promo card onto a lone leftover post at the very
    // end of the feed — one real post next to an ad reads as mostly ad.
    const shouldInsert = slice.length >= 2;
    // Never open the whole feed on a promo card — position 0 of window 0
    // is reserved for real content.
    const minIndex = windowIndex === 0 ? 1 : 0;
    const insertAt = shouldInsert
      ? minIndex + Math.floor(Math.random() * (slice.length - minIndex))
      : -1;

    slice.forEach((item, idx) => {
      if (idx === insertAt) {
        const kind = Math.random() < 0.65 ? 'ad_slot' : 'premium_upsell';
        result.push({
          id: `promo-${i}-${idx}`,
          _kind: kind,
          _promo: true,
          body: kind === 'ad_slot' ? PLACEHOLDER_ADS[Math.floor(Math.random() * PLACEHOLDER_ADS.length)] : null,
        });
      }
      result.push(item);
    });

    i += windowSize;
    windowIndex += 1;
  }

  return result;
}

// ~15% of the feed is reserved for lower-interaction posts getting a
// boost — otherwise the same handful of top posts would dominate every
// refresh forever and nothing new ever gets seen, the classic
// rich-get-richer feed problem. Ranking only ever runs once per load()
// (baked into `posts`' order, not recomputed from live like/comment
// counts) — see the comment on the load() call below for why: without
// that, liking a post mid-scroll would reshuffle the whole feed under
// someone's thumb.
const DISCOVERY_RATIO = 0.15;

function rankPosts(posts, reactionCounts, commentCounts) {
  if (posts.length < 4) return posts; // too few to meaningfully rank/mix

  const scored = posts.map((p) => ({
    post: p,
    score: (reactionCounts[p.id] || 0) + (commentCounts[p.id] || 0),
  }));
  const byScore = [...scored].sort((a, b) => b.score - a.score);

  const discoveryCount = Math.max(1, Math.round(posts.length * DISCOVERY_RATIO));
  // Pull discovery picks from the bottom half specifically — genuinely
  // quieter posts, not near-top ones — so this is actually giving
  // low-interaction posts a shot, not just reshuffling the leaders.
  const bottomHalf = byScore.slice(Math.floor(byScore.length / 2));
  const shuffledBottom = [...bottomHalf].sort(() => Math.random() - 0.5);
  const discoveryPicks = shuffledBottom.slice(0, discoveryCount);
  const discoveryIds = new Set(discoveryPicks.map((d) => d.post.id));

  const rest = byScore.filter((s) => !discoveryIds.has(s.post.id)).map((s) => s.post);

  // Weave discovery picks into random spots among the ranked list
  // instead of tacking them onto the end — that's what keeps a refresh
  // from feeling like "the same top posts, plus some randoms at the
  // bottom every time."
  const result = [...rest];
  discoveryPicks.forEach(({ post }) => {
    const insertAt = Math.floor(Math.random() * (result.length + 1));
    result.splice(insertAt, 0, post);
  });

  return result;
}

// A <Video> component starts fetching its source the moment it mounts,
// whether or not anyone actually wants to watch — costly when it's just
// scrolled into view in a feed. This defers that entirely: show a
// tappable placeholder first, only mount the real player (and let its
// network fetch actually begin) once someone taps it. Defined at module
// level, not inside FeedTab's renderItem, so it keeps a stable
// component identity across re-renders — an inline component redefined
// every render would remount on every parent re-render and forget
// `tapped` each time.
function LazyVideoCard({ uri, style }) {
  const [tapped, setTapped] = useState(false);

  if (!tapped) {
    return (
      <TouchableOpacity style={[style, styles.videoPlaceholder]} onPress={() => setTapped(true)} activeOpacity={0.85}>
        <Ionicons name="play-circle" size={46} color="rgba(255,255,255,0.92)" />
      </TouchableOpacity>
    );
  }

  return (
    <Video
      source={{ uri }}
      style={style}
      useNativeControls
      resizeMode={ResizeMode.CONTAIN}
      shouldPlay
    />
  );
}

function getInitials(name) {
  return (name || 'U').split(' ').map((n) => n[0]).join('').slice(0, 2).toUpperCase();
}

// Short relative time — "just now" / "14m" / "3h" / "5d" / falls back
// to a plain date past a week so old posts don't show a meaningless
// "34d".
function timeAgo(iso) {
  if (!iso) return '';
  const diffMs = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d`;
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export default function FeedTab({ navigation, isHost, isVerified, isPremium }) {
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [drafts, setDrafts] = useState([]); // this user's own achievement drafts awaiting a decision
  const [posts, setPosts] = useState([]); // published feed
  const [userId, setUserId] = useState(null);
  const [myReactions, setMyReactions] = useState(new Set());
  const [reactionCounts, setReactionCounts] = useState({});
  const [commentCounts, setCommentCounts] = useState({});

  const load = useCallback(async (isRefresh) => {
    isRefresh ? setRefreshing(true) : setLoading(true);
    try {
      // getSession() reads the already-established session from local
      // storage — no network round trip. getUser() (the old version)
      // makes an actual server call to re-validate the JWT every single
      // time this ran, which is unnecessary here: being on this screen
      // at all already implies a valid session exists.
      const { data: { session } } = await supabase.auth.getSession();
      const user = session?.user;
      if (!user) return;
      setUserId(user.id);

      // Drafts and published posts don't depend on each other — only on
      // user.id, which we already have — so there's no reason to wait
      // for one before starting the other.
      const [{ data: draftRows }, { data: publishedRows, error }] = await Promise.all([
        supabase
          .from('feed_posts')
          .select('*')
          .eq('author_id', user.id)
          .eq('status', 'draft')
          .order('created_at', { ascending: false }),
        supabase
          .from('feed_posts')
          .select('*, channels(name), profiles(full_name), feed_post_media(id, url, position)')
          .eq('status', 'published')
          .order('created_at', { ascending: false })
          .limit(50),
      ]);
      if (error) throw error;
      setDrafts(draftRows || []);

      // feed_post_media comes back unordered from the embed — sort by
      // position client-side rather than fighting PostgREST's embedded-
      // resource ordering syntax for something this small.
      const sorted = (publishedRows || []).map((p) => ({
        ...p,
        feed_post_media: (p.feed_post_media || []).slice().sort((a, b) => a.position - b.position),
      }));

      const postIds = sorted.map((p) => p.id);
      let counts = {};
      let mine = new Set();
      let cCounts = {};

      if (postIds.length > 0) {
        // Same reasoning — reactions and comments only depend on
        // postIds, not on each other, so fetch both at once instead of
        // one after the other.
        const [{ data: reactionRows }, { data: commentRows }] = await Promise.all([
          supabase.from('feed_post_reactions').select('post_id, user_id').in('post_id', postIds),
          supabase.from('feed_post_comments').select('post_id').in('post_id', postIds),
        ]);
        (reactionRows || []).forEach((r) => {
          counts[r.post_id] = (counts[r.post_id] || 0) + 1;
          if (r.user_id === user.id) mine.add(r.post_id);
        });
        (commentRows || []).forEach((c) => {
          cCounts[c.post_id] = (cCounts[c.post_id] || 0) + 1;
        });
      }

      // Ranking happens exactly once here, baked into the order `posts`
      // is set in — deliberately NOT recomputed reactively off the live
      // reactionCounts/commentCounts state below. If it were, liking or
      // commenting on a post mid-scroll would reshuffle the whole feed
      // under someone's thumb. This only reshuffles on an actual
      // load/refresh, matching "ranked, but only when refreshed."
      setPosts(rankPosts(sorted, counts, cCounts));
      setReactionCounts(counts);
      setMyReactions(mine);
      setCommentCounts(cCounts);
    } catch (e) {
      showAlert('Could not load feed', e.message);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  // Covers both the initial mount AND every time this tab regains focus
  // (e.g. returning from PostCommentsScreen after adding a comment) —
  // React Navigation's 'focus' event fires on first mount too, so a
  // separate mount-only effect calling load() would just double-fetch.
  useEffect(() => {
    const unsub = navigation.addListener('focus', () => load(false));
    return unsub;
  }, [navigation, load]);

  // Re-mixed only when the underlying posts actually change (a fresh
  // load or pull-to-refresh) — not on every render, so toggling a like
  // doesn't reshuffle ad positions under someone's thumb.
  const displayFeed = useMemo(() => buildDisplayFeed(posts, isPremium), [posts, isPremium]);

  // "Show it off" / "Dismiss" — the only two states an achievement
  // draft can move to, per the update policy in the migration
  // (feed_posts_update_own_draft only allows draft -> published/dismissed).
  const decideDraft = async (post, decision) => {
    setDrafts((prev) => prev.filter((d) => d.id !== post.id));
    const { error } = await supabase
      .from('feed_posts')
      .update({ status: decision, published_at: decision === 'published' ? new Date().toISOString() : null })
      .eq('id', post.id);
    if (error) {
      showAlert('Could not update', error.message);
      load(false);
      return;
    }
    if (decision === 'published') load(false);
  };

  const toggleReaction = async (postId) => {
    if (!userId) return;
    const already = myReactions.has(postId);
    setMyReactions((prev) => {
      const next = new Set(prev);
      already ? next.delete(postId) : next.add(postId);
      return next;
    });
    setReactionCounts((prev) => ({
      ...prev,
      [postId]: Math.max(0, (prev[postId] || 0) + (already ? -1 : 1)),
    }));
    const { error } = already
      ? await supabase.from('feed_post_reactions').delete().eq('post_id', postId).eq('user_id', userId)
      : await supabase.from('feed_post_reactions').insert({ post_id: postId, user_id: userId, reaction: 'like' });

    if (error) {
      // Roll back the optimistic update — same pattern as
      // deletePost/decideDraft/reportPost elsewhere in this file.
      setMyReactions((prev) => {
        const next = new Set(prev);
        already ? next.add(postId) : next.delete(postId);
        return next;
      });
      setReactionCounts((prev) => ({
        ...prev,
        [postId]: Math.max(0, (prev[postId] || 0) + (already ? 1 : -1)),
      }));
      showAlert('Could not update', error.message);
    }
  };

  const deletePost = (post) => {
    showAlert('Delete this post?', 'This can\'t be undone.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          setPosts((prev) => prev.filter((p) => p.id !== post.id));
          const { error } = await supabase.from('feed_posts').delete().eq('id', post.id);
          if (error) {
            showAlert('Could not delete', error.message);
            load(false);
          }
        },
      },
    ]);
  };

  const reportPost = (post) => {
    showAlert('Report this post?', 'This is only for spam, abuse, or content that breaks the rules.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Report',
        style: 'destructive',
        onPress: async () => {
          if (!userId) return;
          // The threshold-check-and-hide logic now lives entirely in the
          // report_feed_post() DB function (SECURITY DEFINER) — this
          // client never touches feed_posts.status directly anymore.
          // That closes the gap the previous version had: any signed-in
          // user could otherwise call the same REST endpoint this used
          // and flip status to 'flagged' on someone else's post without
          // ever going through the report count at all.
          const { error } = await supabase.rpc('report_feed_post', { p_post_id: post.id });
          if (error) {
            showAlert('Could not report', error.message);
            return;
          }
          showAlert('Reported', 'Thanks — our team will take a look.');
          // If this report just pushed the post over the threshold, the
          // function already flagged it server-side — load() will pick
          // that up naturally next time (it only ever fetches
          // status = 'published'), but there's no local signal telling
          // us that happened right now, so just refresh to be sure this
          // person doesn't keep seeing a post they just reported.
          load(false);
        },
      },
    ]);
  };

  return (
    <View style={styles.container}>
      {loading ? (
        <ActivityIndicator style={{ marginTop: 40 }} color={palette.primary} />
      ) : (
        <FlatList
          data={displayFeed}
          keyExtractor={(item) => String(item.id)}
          contentContainerStyle={styles.listContent}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={() => load(true)} tintColor={palette.primary} colors={[palette.primary]} />
          }
          ListHeaderComponent={
            drafts.length > 0 ? (
              <View style={{ marginBottom: 14 }}>
                {drafts.map((d) => (
                  <View key={d.id} style={styles.draftCard}>
                    <View style={styles.draftIconWrap}>
                      <Ionicons name="trophy" size={18} color={palette.amber} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.draftTitle}>New achievement</Text>
                      <Text style={styles.draftBody}>{d.body}</Text>
                      <View style={styles.draftActions}>
                        <TouchableOpacity style={styles.showOffBtn} onPress={() => decideDraft(d, 'published')} activeOpacity={0.85}>
                          <Text style={styles.showOffBtnText}>Show it off</Text>
                        </TouchableOpacity>
                        <TouchableOpacity style={styles.dismissBtn} onPress={() => decideDraft(d, 'dismissed')} activeOpacity={0.85}>
                          <Text style={styles.dismissBtnText}>Dismiss</Text>
                        </TouchableOpacity>
                      </View>
                    </View>
                  </View>
                ))}
              </View>
            ) : null
          }
          renderItem={({ item }) => {
            const meta = KIND_META[item._kind] || KIND_META.post;
            const isPromo = !!item._promo;
            const isOwnable = item._kind === 'post' || item._kind === 'achievement';
            const isOwn = isOwnable && item.author_id === userId;
            const reacted = !isPromo && myReactions.has(item.id);
            const count = reactionCounts[item.id] || 0;

            if (item._kind === 'premium_upsell') {
              return (
                <View style={[styles.postCard, styles.upsellCard]}>
                  <View style={styles.postHeader}>
                    <View style={[styles.postIconWrap, { backgroundColor: meta.iconBg }]}>
                      <Ionicons name={meta.icon} size={16} color={meta.iconColor} />
                    </View>
                    <Text style={styles.postKind}>{meta.label}</Text>
                  </View>
                  <Text style={styles.postBody}>
                    Enjoying Kesher? Go Premium for an ad-free feed — with more benefits on the way.
                  </Text>
                  <TouchableOpacity
                    style={styles.upgradeBtn}
                    activeOpacity={0.85}
                    onPress={() => navigation.navigate('Profile')}
                  >
                    <Text style={styles.upgradeBtnText}>Go Premium</Text>
                    <Ionicons name="sparkles" size={13} color={palette.surface} />
                  </TouchableOpacity>
                </View>
              );
            }

            return (
              <View style={styles.postCard}>
                <View style={styles.postHeader}>
                  <View style={[styles.postIconWrap, { backgroundColor: meta.iconBg }]}>
                    <Ionicons name={meta.icon} size={16} color={meta.iconColor} />
                  </View>
                  <Text style={styles.postKind}>{meta.label}</Text>
                  {item.channels?.name && <Text style={styles.postChannel}>· {item.channels.name}</Text>}

                  {isOwnable && (
                    <View style={styles.headerActions}>
                      {isOwn ? (
                        <>
                          <TouchableOpacity
                            style={styles.headerActionBtn}
                            onPress={() => navigation.navigate('ComposePost', { post: item })}
                            activeOpacity={0.7}
                          >
                            <Ionicons name="pencil-outline" size={15} color={palette.neutralText} />
                          </TouchableOpacity>
                          <TouchableOpacity style={styles.headerActionBtn} onPress={() => deletePost(item)} activeOpacity={0.7}>
                            <Ionicons name="trash-outline" size={15} color={palette.danger} />
                          </TouchableOpacity>
                        </>
                      ) : (
                        <TouchableOpacity style={styles.headerActionBtn} onPress={() => reportPost(item)} activeOpacity={0.7}>
                          <Ionicons name="flag-outline" size={15} color={palette.neutralText} />
                        </TouchableOpacity>
                      )}
                    </View>
                  )}
                </View>

                {isOwnable && (
                  <View style={styles.authorRow}>
                    <View style={styles.authorAvatar}>
                      <Text style={styles.authorAvatarText}>{getInitials(item.profiles?.full_name)}</Text>
                    </View>
                    <Text style={styles.authorName}>{item.profiles?.full_name || 'Someone'}</Text>
                    <Text style={styles.authorDot}>·</Text>
                    <Text style={styles.authorTime}>{timeAgo(item.published_at || item.created_at)}</Text>
                  </View>
                )}

                {item.body ? <Text style={styles.postBody}>{item.body}</Text> : null}

                {item.media_type === 'image' && item.feed_post_media?.length > 0 && (
                  item.feed_post_media.length === 1 ? (
                    <Image source={{ uri: item.feed_post_media[0].url }} style={styles.singleImage} resizeMode="cover" />
                  ) : (
                    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.mediaScrollRow}>
                      {item.feed_post_media.map((m) => (
                        <Image key={m.id} source={{ uri: m.url }} style={styles.multiImage} resizeMode="cover" />
                      ))}
                    </ScrollView>
                  )
                )}

                {item.media_type === 'video' && item.feed_post_media?.[0]?.url && (
                  <LazyVideoCard uri={item.feed_post_media[0].url} style={styles.postVideo} />
                )}

                {!isPromo && (
                  <View style={styles.actionsRow}>
                    <TouchableOpacity style={styles.reactionRow} onPress={() => toggleReaction(item.id)} activeOpacity={0.7}>
                      <Ionicons name={reacted ? 'heart' : 'heart-outline'} size={18} color={reacted ? palette.primary : palette.neutralText} />
                      <Text style={[styles.reactionText, reacted && { color: palette.primary }]}>
                        {count > 0 ? `${count} ${count === 1 ? 'like' : 'likes'}` : 'Like'}
                      </Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={styles.reactionRow}
                      onPress={() => navigation.navigate('PostComments', { post: item })}
                      activeOpacity={0.7}
                    >
                      <Ionicons name="chatbubble-outline" size={16} color={palette.neutralText} />
                      <Text style={styles.reactionText}>
                        {(commentCounts[item.id] || 0) > 0 ? `${commentCounts[item.id]} comment${commentCounts[item.id] === 1 ? '' : 's'}` : 'Comment'}
                      </Text>
                    </TouchableOpacity>
                  </View>
                )}
              </View>
            );
          }}
          ListEmptyComponent={
            <View style={styles.emptyState}>
              <Text style={styles.emptyStateText}>Nothing in the feed yet — be the first to post something.</Text>
            </View>
          }
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  listContent: { paddingHorizontal: 20, paddingBottom: 20 },

  draftCard: {
    flexDirection: 'row', gap: 12, backgroundColor: palette.amberSoft,
    borderRadius: 16, padding: 14, marginBottom: 10, alignItems: 'flex-start',
  },
  draftIconWrap: { width: 34, height: 34, borderRadius: 10, backgroundColor: palette.surface, alignItems: 'center', justifyContent: 'center' },
  draftTitle: { fontSize: 13, fontWeight: '800', color: palette.ink },
  draftBody: { fontSize: 12.5, color: palette.inkMuted, marginTop: 3, lineHeight: 17 },
  draftActions: { flexDirection: 'row', gap: 8, marginTop: 10 },
  showOffBtn: { backgroundColor: palette.primary, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 7 },
  showOffBtnText: { color: palette.surface, fontWeight: '700', fontSize: 12 },
  dismissBtn: { backgroundColor: palette.surface, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 7 },
  dismissBtnText: { color: palette.neutralText, fontWeight: '700', fontSize: 12 },

  postCard: { backgroundColor: palette.surface, borderRadius: 16, padding: 14, marginBottom: 10 },
  postHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 },
  postIconWrap: { width: 28, height: 28, borderRadius: 9, alignItems: 'center', justifyContent: 'center' },
  postKind: { fontSize: 11.5, fontWeight: '700', color: palette.inkMuted },
  postChannel: { fontSize: 11.5, color: palette.neutralText, fontWeight: '600' },
  headerActions: { flexDirection: 'row', gap: 4, marginLeft: 'auto' },
  headerActionBtn: { width: 26, height: 26, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },

  authorRow: { flexDirection: 'row', alignItems: 'center', gap: 7, marginBottom: 8 },
  authorAvatar: { width: 22, height: 22, borderRadius: 11, backgroundColor: palette.primarySoft, alignItems: 'center', justifyContent: 'center' },
  authorAvatarText: { fontSize: 9.5, fontWeight: '800', color: palette.primary },
  authorName: { fontSize: 12.5, fontWeight: '700', color: palette.ink },
  authorDot: { fontSize: 12.5, color: palette.neutralText },
  authorTime: { fontSize: 12, color: palette.neutralText, fontWeight: '500' },

  postBody: { fontSize: 14, color: palette.ink, lineHeight: 20 },
  singleImage: { width: '100%', aspectRatio: 1.3, borderRadius: 12, marginTop: 10, backgroundColor: palette.line },
  mediaScrollRow: { marginTop: 10 },
  multiImage: { width: SCREEN_WIDTH * 0.55, aspectRatio: 1, borderRadius: 12, marginRight: 8, backgroundColor: palette.line },
  postVideo: { width: '100%', aspectRatio: 16 / 9, borderRadius: 12, marginTop: 10, backgroundColor: '#000' },
  videoPlaceholder: { alignItems: 'center', justifyContent: 'center' },
  actionsRow: { flexDirection: 'row', alignItems: 'center', gap: 18, marginTop: 10 },
  reactionRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  reactionText: { fontSize: 12.5, color: palette.neutralText, fontWeight: '600' },

  upsellCard: { borderWidth: 1.5, borderColor: palette.premiumSoft, backgroundColor: palette.premiumSoft },
  upgradeBtn: { flexDirection: 'row', alignSelf: 'flex-start', alignItems: 'center', gap: 6, backgroundColor: palette.premium, paddingHorizontal: 14, paddingVertical: 9, borderRadius: 11, marginTop: 10 },
  upgradeBtnText: { color: palette.surface, fontWeight: '700', fontSize: 12.5 },

  emptyState: { paddingVertical: 50, alignItems: 'center' },
  emptyStateText: { color: palette.neutralText, fontSize: 13, textAlign: 'center', paddingHorizontal: 30 },
});
