import React, { useState, useEffect, useCallback } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Platform } from 'react-native';
import NetInfo from '@react-native-community/netinfo';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '../theme/colors'; // adjust path if this file lives elsewhere

/**
 * OfflineGate
 * -----------
 * Requires: npx expo install @react-native-community/netinfo
 *
 * Wrap the WHOLE app in this once, at the root — typically in App.js,
 * around your NavigationContainer:
 *
 *   export default function App() {
 *     return (
 *       <OfflineGate>
 *         <NavigationContainer>
 *           ...your existing navigator, unchanged...
 *         </NavigationContainer>
 *       </OfflineGate>
 *     );
 *   }
 *
 * Every part of this app depends on a live connection — Supabase
 * realtime, Agora, board sync — there's no real "browse it offline"
 * mode. So instead of a banner sitting on top of a screen that's
 * quietly failing its fetch/websocket calls underneath, this blocks
 * interaction with the ENTIRE app the moment the device loses a working
 * connection, and lifts automatically the instant it's back — the same
 * shape as eFootball's "no internet" screen. Nothing behind it can be
 * tapped while it's showing, so a failed request never gets the chance
 * to happen in the first place, instead of surfacing later as something
 * that looks like a crash.
 *
 * This replaces adding a banner to every individual screen — mount it
 * once here and nothing else in the app needs to import or think about
 * connectivity at all.
 */

const REACHABILITY_URL = 'https://clients3.google.com/generate_204';

let configured = false;
function ensureConfigured() {
  if (configured) return;
  configured = true;
  // The reachability ping only makes sense on native. A plain fetch() to
  // a third-party domain from a browser tab is subject to CORS, and
  // clients3.google.com doesn't grant it — so on web the check silently
  // fails and reports "unreachable" no matter what, even with a
  // perfectly working connection (this app's own Supabase/Agora calls
  // keep succeeding the whole time this happens — that's the "everything
  // still works underneath" symptom, and it's also why tapping "Check
  // again" didn't help: it was re-running the exact same broken check).
  // Skip the custom probe on web entirely and lean on navigator.onLine
  // instead, which NetInfo's web build already uses as its baseline
  // signal and which isn't subject to CORS — it's a browser property,
  // not a network request.
  if (Platform.OS === 'web') return;
  NetInfo.configure({
    reachabilityUrl: REACHABILITY_URL,
    reachabilityTest: async (response) => response.status === 204,
    // NetInfo's addEventListener (below) already reacts instantly to real
    // OS-level changes — wifi/cellular dropped, airplane mode toggled —
    // no polling needed for that at all. These timeouts only tune the
    // SEPARATE background reachability re-test, which exists purely to
    // catch "connected to wifi but the wifi has no real internet";
    // isConnected alone stays true in that case. Checking that every
    // single second would mean a real network request 60x/minute for the
    // entire time the app is open, for a case event-driven detection
    // doesn't already cover — these keep it in the same "feels instant"
    // few-second range without that cost.
    reachabilityShortTimeout: 3 * 1000, // recheck this often while OFFLINE — catch reconnects fast
    reachabilityLongTimeout: 5 * 1000, // recheck this often while ONLINE — catch silent drops fast
    reachabilityRequestTimeout: 5 * 1000, // give up on a single check after this long
  });
}

/**
 * useNetworkStatus
 * -----------------
 * Exported on its own too, in case some screen wants the raw boolean for
 * something other than the gate (e.g. skipping a retry loop while
 * offline). Returns [isOnline, recheck] — recheck() forces an immediate
 * re-test instead of waiting for the next event or periodic interval.
 */
export function useNetworkStatus() {
  const [isOnline, setIsOnline] = useState(true);

  const recheck = useCallback(() => {
    NetInfo.fetch().then((state) => {
      setIsOnline(!!state.isConnected && state.isInternetReachable !== false);
    });
  }, []);

  useEffect(() => {
    ensureConfigured();

    const unsubscribe = NetInfo.addEventListener((state) => {
      // Treat unknown reachability (null) as online rather than offline —
      // it briefly reads null right after a change on some Android
      // devices, and blocking the whole app on every one of those would
      // be worse than the rare real case it'd catch.
      setIsOnline(!!state.isConnected && state.isInternetReachable !== false);
    });

    recheck(); // check once immediately instead of waiting for the first event/interval

    return () => unsubscribe();
  }, [recheck]);

  return [isOnline, recheck];
}

export default function OfflineGate({ children }) {
  const [isOnline, recheck] = useNetworkStatus();

  return (
    <View style={styles.root}>
      {children}
      {!isOnline && (
        <View style={styles.overlay}>
          <View style={styles.iconWrap}>
            <Ionicons name="cloud-offline-outline" size={38} color={colors.white} />
          </View>
          <Text style={styles.title}>You're offline</Text>
          <Text style={styles.subtitle}>
            This app needs an internet connection to work. Reconnect to Wi-Fi or mobile data to
            continue — this will disappear automatically once you're back online.
          </Text>
          <TouchableOpacity style={styles.retryBtn} onPress={recheck} activeOpacity={0.85}>
            <Ionicons name="refresh-outline" size={15} color={colors.white} />
            <Text style={styles.retryBtnText}>Check again</Text>
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(10, 10, 26, 0.97)',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
    zIndex: 9999,
    elevation: 9999,
  },
  iconWrap: {
    width: 76,
    height: 76,
    borderRadius: 38,
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.14)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 18,
  },
  title: { color: colors.white, fontSize: 20, fontWeight: '800', marginBottom: 8, letterSpacing: -0.3 },
  subtitle: {
    color: 'rgba(255,255,255,0.65)',
    fontSize: 13.5,
    textAlign: 'center',
    lineHeight: 20,
    marginBottom: 24,
    fontWeight: '500',
  },
  retryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    backgroundColor: colors.primary,
    paddingHorizontal: 22,
    paddingVertical: 12,
    borderRadius: 14,
  },
  retryBtnText: { color: colors.white, fontWeight: '700', fontSize: 14 },
});