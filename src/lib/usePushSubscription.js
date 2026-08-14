import { useEffect } from 'react';
import { Platform } from 'react-native';
import { supabase } from './supabase';

// Safe to expose client-side — this is the PUBLIC VAPID key. Never put
// the private one here.
const VAPID_PUBLIC_KEY = 'BC82MBasUH3tkvmoKv8-1yA_bu1p2EXrjdndnK-Tk-_2JozwPT2aAtH9dryX5gSecb7QsvV7EAzADysFGnKGcs8';

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = atob(base64);
  return Uint8Array.from([...rawData].map((c) => c.charCodeAt(0)));
}

/**
 * Registers the service worker and subscribes this browser to Web Push,
 * storing the subscription in `push_subscriptions` so
 * check-expired-lobbies can reach this host later even if every tab is
 * closed by the time a lobby expires.
 *
 * Web-only by design (guarded via Platform.OS) — this is unrelated to
 * native push (APNs/FCM via expo-notifications), which is a separate
 * system you'd wire up separately if/when you ship native builds.
 *
 * Call once, on mount, from a screen a signed-in host reliably visits —
 * HostDashboard is a good fit.
 */
export function usePushSubscription() {
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    if (typeof window === 'undefined' || !('serviceWorker' in navigator) || !('PushManager' in window)) return;

    let cancelled = false;

    (async () => {
      try {
        const registration = await navigator.serviceWorker.register('/service-worker.js');

        const permission = await Notification.requestPermission();
        if (permission !== 'granted' || cancelled) return;

        let subscription = await registration.pushManager.getSubscription();
        if (!subscription) {
          subscription = await registration.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
          });
        }

        const { data: { user } } = await supabase.auth.getUser();
        if (!user || cancelled) return;

        const json = subscription.toJSON();
        await supabase.from('push_subscriptions').upsert(
          {
            user_id: user.id,
            endpoint: json.endpoint,
            p256dh: json.keys.p256dh,
            auth: json.keys.auth,
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