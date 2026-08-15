import { useEffect } from 'react';
import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import Constants from 'expo-constants';
import { supabase } from './supabase';

/**
 * Registers this device for native push (APNs/FCM via Expo's push
 * service) and stores the resulting Expo push token in
 * `push_subscriptions`, so check-expired-lobbies can reach this host
 * later even with the app closed.
 *
 * Native implementation, sibling to usePushSubscription.web.js — same
 * './usePushSubscription' import in HostDashboard.js resolves here on
 * iOS/Android automatically.
 *
 * ASSUMPTION FLAGGED: usePushSubscription.web.js writes
 * { endpoint, p256dh, auth } rows (Web Push's shape). An Expo push
 * token isn't a Web Push subscription — it's a single opaque string
 * (e.g. "ExponentPushToken[...]") issued per device, with no keys to
 * split out. This reuses the `endpoint` column to hold that token
 * (matching upsert's onConflict: 'endpoint', so re-registering the
 * same device updates its row instead of duplicating it) and leaves
 * p256dh/auth null. If your `push_subscriptions` table has a NOT NULL
 * constraint on either column, you'll need a migration — e.g. a
 * separate `platform text` column and making p256dh/auth nullable —
 * before this insert will succeed.
 *
 * Also needs, in app.json/app.config.js:
 *   - a "projectId" under expo.extra.eas (read below via
 *     Constants.expoConfig) — required by getExpoPushTokenAsync
 *   - Android: a notification channel is set up below; iOS needs no
 *     extra config for local token registration, but a physical
 *     device (not the simulator) to actually receive a push
 */
export function usePushSubscription() {
  useEffect(() => {
    if (Platform.OS === 'web') return;

    let cancelled = false;

    (async () => {
      try {
        if (Platform.OS === 'android') {
          await Notifications.setNotificationChannelAsync('default', {
            name: 'default',
            importance: Notifications.AndroidImportance.DEFAULT,
          });
        }

        const { status: existingStatus } = await Notifications.getPermissionsAsync();
        let finalStatus = existingStatus;
        if (existingStatus !== 'granted') {
          const { status } = await Notifications.requestPermissionsAsync();
          finalStatus = status;
        }
        if (finalStatus !== 'granted' || cancelled) return;

        const projectId = Constants.expoConfig?.extra?.eas?.projectId;
        const { data: expoPushToken } = await Notifications.getExpoPushTokenAsync(
          projectId ? { projectId } : undefined
        );
        if (!expoPushToken || cancelled) return;

        const { data: { user } } = await supabase.auth.getUser();
        if (!user || cancelled) return;

        await supabase.from('push_subscriptions').upsert(
          {
            user_id: user.id,
            endpoint: expoPushToken, // see ASSUMPTION note above
            p256dh: null,
            auth: null,
            platform: Platform.OS,
          },
          { onConflict: 'endpoint' }
        );
      } catch (e) {
        console.log('Push subscription setup failed:', e.message);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);
}
