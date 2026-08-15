import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator } from 'react-native';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { colors } from '../../theme/colors';
import { supabase } from '../../lib/supabase';

const MODE_ICON_META = {
  classroom: { icon: 'school-outline', set: 'ion' },
  interview: { icon: 'briefcase-outline', set: 'ion' },
  meeting: { icon: 'people-outline', set: 'ion' },
  gettogether: { icon: 'party-popper', set: 'mci' },
};
const DEFAULT_MODE_ICON = { icon: 'calendar-outline', set: 'ion' };
function ModeIcon({ mode, size = 14, color }) {
  const meta = MODE_ICON_META[mode] || DEFAULT_MODE_ICON;
  const IconSet = meta.set === 'mci' ? MaterialCommunityIcons : Ionicons;
  return <IconSet name={meta.icon} size={size} color={color} />;
}

/**
 * Route params: { session } — the session object as known at the point
 * capacity was hit. This used to be entirely hardcoded (a fake "Advanced
 * UI/UX Workshop" / "Sarah Jenkins" / "50/50" card) and nothing ever
 * actually navigated here — max_attendees had no enforcement behind it
 * at all. Now reached for real from LobbyScreen.js's capacity check.
 *
 * "Join Waitlist" below is deliberately NOT wired to a real waitlist —
 * there's no waitlist table/backend anywhere in the app currently
 * (sessions.waitlist_enabled is a host-set flag with nothing reading
 * it). Rather than fake a confirmation the way the old screen did
 * (flipping local state, writing nothing to the database, "notifying"
 * no one), this is honest about that instead: it tells the person
 * clearly that a real waitlist isn't built yet. Say the word if you
 * want that built for real — it's a real feature (a table + a
 * promote-next-on-leave trigger), not a small addition to this screen.
 */
export default function SessionFull({ navigation, route }) {
  const session = route?.params?.session;
  const [loading, setLoading] = useState(true);
  const [hostName, setHostName] = useState(null);
  const [attendeeCount, setAttendeeCount] = useState(null);

  useEffect(() => {
    (async () => {
      if (!session?.id) {
        setLoading(false);
        return;
      }
      try {
        const [{ data: hostProfile }, { count }] = await Promise.all([
          session.host_id
            ? supabase.from('profiles').select('full_name').eq('id', session.host_id).maybeSingle()
            : Promise.resolve({ data: null }),
          supabase
            .from('session_attendees')
            .select('id', { count: 'exact', head: true })
            .eq('session_id', session.id)
            .is('left_at', null),
        ]);
        setHostName(hostProfile?.full_name || null);
        setAttendeeCount(count ?? null);
      } catch (e) {
        // Non-fatal — the screen still works with just what route.params gave it.
      } finally {
        setLoading(false);
      }
    })();
  }, [session?.id]);

  const cap = session?.max_attendees;
  const count = attendeeCount ?? cap; // best available number while loading, without ever showing 0/cap incorrectly

  return (
    <View style={styles.container}>
      <View style={styles.content}>
        <View style={styles.iconWrap}>
          <Ionicons name="people" size={40} color={colors.primary} />
        </View>
        <Text style={styles.title}>Session is Full</Text>
        <Text style={styles.subtitle}>This session has reached its attendee limit.</Text>

        {loading ? (
          <ActivityIndicator color={colors.primary} style={{ marginVertical: 8 }} />
        ) : (
          <View style={styles.infoCard}>
            <View style={styles.infoRow}>
              <Ionicons name="document-text-outline" size={15} color={colors.text} />
              <Text style={styles.infoRowText} numberOfLines={1}>{session?.title || 'Session'}</Text>
            </View>
            <View style={styles.infoRow}>
              <Ionicons name="people-outline" size={15} color={colors.text} />
              <Text style={styles.infoRowText}>{count != null && cap != null ? `${count}/${cap} attendees` : 'Full'}</Text>
            </View>
            <View style={styles.infoRow}>
              <ModeIcon mode={session?.mode} size={15} color={colors.text} />
              <Text style={styles.infoRowText} numberOfLines={1}>
                {(session?.mode || 'Session')}{hostName ? ` · ${hostName}` : ''}
              </Text>
            </View>
          </View>
        )}

        <View style={styles.waitlistNotice}>
          <Ionicons name="information-circle-outline" size={16} color={colors.textLight} />
          <Text style={styles.waitlistNoticeText}>
            Waitlists aren't available yet — check back with the host about a spot opening up.
          </Text>
        </View>

        <TouchableOpacity style={styles.backBtn} onPress={() => navigation.navigate('Welcome')} activeOpacity={0.8}>
          <Ionicons name="arrow-back" size={16} color={colors.primary} />
          <Text style={styles.backBtnText}>Go back</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background, alignItems: 'center', justifyContent: 'center', padding: 24 },
  content: { alignItems: 'center', gap: 14, width: '100%', maxWidth: 380 },
  iconWrap: { width: 76, height: 76, borderRadius: 38, backgroundColor: colors.greyLight, alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 24, fontWeight: '800', color: colors.text },
  subtitle: { fontSize: 14.5, color: colors.textLight, textAlign: 'center' },

  infoCard: { backgroundColor: colors.white, borderRadius: 16, padding: 16, width: '100%', gap: 10 },
  infoRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  infoRowText: { fontSize: 13.5, color: colors.text, fontWeight: '600', flexShrink: 1, textTransform: 'capitalize' },

  waitlistNotice: { flexDirection: 'row', gap: 8, backgroundColor: colors.greyLight, borderRadius: 12, padding: 12, width: '100%', alignItems: 'flex-start' },
  waitlistNoticeText: { flex: 1, fontSize: 12, color: colors.textLight, lineHeight: 17 },

  backBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 12 },
  backBtnText: { color: colors.primary, fontSize: 15, fontWeight: '700' },
});
