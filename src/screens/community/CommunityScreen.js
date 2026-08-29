import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '../../theme/colors';
import { supabase } from '../../lib/supabase';
import ChannelsTab from './ChannelsTab';
import FeedTab from './FeedTab';

// Same layering-on-top-of-theme approach as the dashboards, so this
// screen matches them visually without touching theme/colors.js.
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
 * Reached from the second bottom-nav button on both AttendeeDashboard
 * and HostDashboard (both now navigate('Community')) — this screen is
 * shared by both roles rather than forked, since the only thing that
 * differs is which "Home" route the nav bar's Home button should
 * return to and whether the "+ New channel" action is available
 * (verified hosts only). Everything else — browsing, joining,
 * reacting — is identical for both roles.
 *
 * ⚠️ Needs a "Community" route registered in your navigator alongside
 * the existing screens — I don't have App.js/navigation config in this
 * project export, so this can't wire itself in.
 */
export default function CommunityScreen({ navigation, route }) {
  const [tab, setTab] = useState('channels'); // 'channels' | 'feed'
  const [profile, setProfile] = useState(null);
  const [verified, setVerified] = useState(false);

  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const { data: profileData } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', user.id)
        .single();
      setProfile(profileData);

      if (profileData?.role === 'host') {
        const { data: verification } = await supabase
          .from('host_verification_stats')
          .select('verified')
          .eq('host_id', user.id)
          .maybeSingle();
        setVerified(!!verification?.verified);
      }
    })();
  }, []);

  const isHost = profile?.role === 'host';
  // Falls back to whichever dashboard passed us here, so this screen
  // doesn't have to hardcode a role assumption if it's ever reached a
  // different way later.
  const homeRoute = route?.params?.fromRole === 'host' || isHost ? 'HostDashboard' : 'AttendeeDashboard';

  return (
    <View style={styles.container}>
      <View style={styles.topBar}>
        <Text style={styles.title}>Community</Text>
        {tab === 'channels' && isHost && verified && (
          <TouchableOpacity
            style={styles.newChannelBtn}
            onPress={() => navigation.navigate('CreateChannel')}
            activeOpacity={0.8}
          >
            <Ionicons name="add" size={18} color={palette.surface} />
            <Text style={styles.newChannelBtnText}>New channel</Text>
          </TouchableOpacity>
        )}
        {tab === 'feed' && (
          <TouchableOpacity
            style={styles.newChannelBtn}
            onPress={() => navigation.navigate('ComposePost')}
            activeOpacity={0.8}
          >
            <Ionicons name="add" size={18} color={palette.surface} />
            <Text style={styles.newChannelBtnText}>Add a post</Text>
          </TouchableOpacity>
        )}
      </View>

      <View style={styles.toggleRow}>
        <TouchableOpacity
          style={[styles.toggleBtn, tab === 'channels' && styles.toggleBtnActive]}
          onPress={() => setTab('channels')}
          activeOpacity={0.8}
        >
          <Text style={[styles.toggleText, tab === 'channels' && styles.toggleTextActive]}>Channels</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.toggleBtn, tab === 'feed' && styles.toggleBtnActive]}
          onPress={() => setTab('feed')}
          activeOpacity={0.8}
        >
          <Text style={[styles.toggleText, tab === 'feed' && styles.toggleTextActive]}>Feed</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.body}>
        {tab === 'channels' ? (
          <ChannelsTab navigation={navigation} isHost={isHost} isVerified={verified} />
        ) : (
          <FeedTab navigation={navigation} isHost={isHost} isVerified={verified} isPremium={!!profile?.is_premium} />
        )}
      </View>

      <View style={styles.bottomNav}>
        <TouchableOpacity style={styles.navItem} onPress={() => navigation.navigate(homeRoute)} activeOpacity={0.7}>
          <Ionicons name="home-outline" size={22} color={palette.neutralText} />
          <Text style={styles.navLabel}>Home</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.navItem} activeOpacity={0.7}>
          <Ionicons name="people-circle" size={22} color={palette.primary} />
          <Text style={styles.navLabelActive}>Community</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.navItem}
          onPress={() => navigation.navigate(isHost ? 'SubmissionsInbox' : 'SubmitFile')}
          activeOpacity={0.7}
        >
          <Ionicons name={isHost ? 'file-tray-full-outline' : 'folder-open-outline'} size={22} color={palette.neutralText} />
          <Text style={styles.navLabel}>{isHost ? 'Inbox' : 'Submissions'}</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.navItem} onPress={() => navigation.navigate('Profile')} activeOpacity={0.7}>
          <Ionicons name="person-circle-outline" size={22} color={palette.neutralText} />
          <Text style={styles.navLabel}>Profile</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: palette.canvas },

  topBar: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 20, paddingBottom: 8 },
  title: { fontSize: 23, fontWeight: '800', color: palette.ink, letterSpacing: -0.4 },
  newChannelBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: palette.primary, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 9 },
  newChannelBtnText: { color: palette.surface, fontWeight: '700', fontSize: 12.5 },

  toggleRow: { flexDirection: 'row', marginHorizontal: 20, backgroundColor: palette.line, borderRadius: 13, padding: 3, marginBottom: 12 },
  toggleBtn: { flex: 1, alignItems: 'center', paddingVertical: 9, borderRadius: 10 },
  toggleBtnActive: { backgroundColor: palette.surface },
  toggleText: { fontSize: 13.5, fontWeight: '700', color: palette.neutralText },
  toggleTextActive: { color: palette.ink },

  body: { flex: 1 },

  bottomNav: {
    flexDirection: 'row', backgroundColor: palette.surface,
    paddingTop: 12, paddingBottom: Platform.OS === 'ios' ? 26 : 12, paddingHorizontal: 20,
    borderTopWidth: 1, borderTopColor: palette.line,
    ...Platform.select({ ios: { shadowColor: '#000', shadowOffset: { width: 0, height: -3 }, shadowOpacity: 0.05, shadowRadius: 10 }, android: { elevation: 12 }, default: {} }),
  },
  navItem: { flex: 1, alignItems: 'center', gap: 4 },
  navLabel: { fontSize: 10.5, color: palette.neutralText, fontWeight: '600' },
  navLabelActive: { fontSize: 10.5, color: palette.primary, fontWeight: '800' },
});
