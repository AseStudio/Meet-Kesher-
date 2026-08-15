import { useState, useEffect, useCallback, useRef } from 'react';
import { Alert } from 'react-native';
import { supabase } from './supabase';
import { LOBBY_DURATION_SECONDS } from './constants';

// How long the host has, after the lobby timer hits 0, before an
// unattended session gets auto-cancelled. Matches the countdown
// SessionExpiredModal displays ("Auto-cancels in …"), AND must match
// GRACE_PERIOD_SECONDS in supabase/functions/check-expired-lobbies —
// keep the two in sync if you ever change this.
const GRACE_PERIOD_SECONDS = 300; // 5 minutes

/**
 * Watches a host's own "scheduled" sessions for one whose lobby countdown
 * has run out without the host explicitly starting or cancelling it, and
 * exposes everything SessionExpiredModal needs (including the live
 * mm:ss grace countdown), plus the actual start/cancel actions.
 *
 * Meant to be mounted once per screen that needs it — HostDashboard.js
 * now, and Lobby.js too once it's shared, so a host sitting IN their own
 * lobby gets the identical Start/Cancel prompt instead of being silently
 * auto-entered when their own countdown hits 0.
 *
 * IMPORTANT: nothing in here ever moves an ATTENDEE into a session. The
 * only thing that can flip a session to 'live' is startNow(), which is
 * only ever wired to a host-facing button. Attendees must gate purely on
 * the session's actual `status`, never on a local timer.
 *
 * NOTE ON NOTIFICATIONS: this hook does NOT send a browser Notification
 * itself (an earlier version did). That job now belongs entirely to the
 * check-expired-lobbies Edge Function + service worker, which reach the
 * host even with every tab closed — a client-side Notification call here
 * too would double-fire whenever a tab happens to be open. This hook's
 * job is just the in-app modal (instant, while a tab IS open) and a
 * client-side auto-cancel as a fast path — the Edge Function is the
 * authoritative one that guarantees the auto-cancel actually happens even
 * if no tab was ever open when the grace period elapsed.
 */
export function useExpiredLobbyWatcher(sessions) {
  const [expiredSession, setExpiredSession] = useState(null);
  const [visible, setVisible] = useState(false);
  const [starting, setStarting] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [graceSecondsLeft, setGraceSecondsLeft] = useState(null);
  const autoCancellingRef = useRef(false);
  // Ids this hook instance has already started/cancelled/auto-cancelled.
  // `sessions` (the caller's list) only updates once THEIR OWN refetch —
  // e.g. HostDashboard's loadData() — actually resolves, which lags a
  // network round-trip behind the update we just made. Checking this set
  // FIRST, before trusting the prop's `status` field, is what stops the
  // just-cancelled session from being re-detected as still-expired and
  // reopening the modal in a tight loop the instant it's dismissed.
  const resolvedIdsRef = useRef(new Set());

  const check = useCallback(() => {
    const now = Date.now();

    if (visible) {
      // Already showing one — tick its grace countdown down (and
      // auto-cancel if the host truly never responds) instead of
      // scanning for a different expired session to replace it with.
      if (!expiredSession) return;
      const created = new Date(expiredSession.created_at).getTime();
      const secondsSinceExpiry = (now - created) / 1000 - LOBBY_DURATION_SECONDS;
      const left = Math.max(0, Math.ceil(GRACE_PERIOD_SECONDS - secondsSinceExpiry));
      setGraceSecondsLeft(left);

      if (left <= 0 && !autoCancellingRef.current) {
        autoCancellingRef.current = true;
        resolvedIdsRef.current.add(expiredSession.id);
        supabase
          .from('sessions')
          .update({ status: 'cancelled' })
          .eq('id', expiredSession.id)
          .then(({ error }) => {
            if (error) console.log('Auto-cancel failed:', error.message);
            setVisible(false);
            setExpiredSession(null);
            autoCancellingRef.current = false;
          });
      }
      return;
    }

    const found = (sessions || []).find(s => {
      if (resolvedIdsRef.current.has(s.id)) return false;
      if (s.status !== 'scheduled') return false;
      const created = new Date(s.created_at).getTime();
      return (now - created) / 1000 >= LOBBY_DURATION_SECONDS;
    });
    if (found) {
      setExpiredSession(found);
      setVisible(true);
      setGraceSecondsLeft(GRACE_PERIOD_SECONDS);
    }
  }, [sessions, visible, expiredSession]);

  useEffect(() => {
    check();
    // 1s ticks once a grace countdown is actually showing (so the modal's
    // mm:ss reads smoothly); 15s otherwise, just watching for a session
    // to expire in the first place.
    const intervalMs = visible ? 1000 : 15000;
    const interval = setInterval(check, intervalMs);
    return () => clearInterval(interval);
  }, [check, visible]);

  const graceTimeFormatted = graceSecondsLeft != null
    ? `${Math.floor(graceSecondsLeft / 60).toString().padStart(2, '0')}:${(graceSecondsLeft % 60).toString().padStart(2, '0')}`
    : null;

  const startNow = useCallback(async (navigation) => {
    if (!expiredSession) return;
    setStarting(true);
    resolvedIdsRef.current.add(expiredSession.id);
    try {
      const { error } = await supabase
        .from('sessions')
        .update({ status: 'live', last_seen_at: new Date().toISOString() })
        .eq('id', expiredSession.id);
      if (error) throw error;
      setVisible(false);
      navigation.navigate('SessionMain', { session: { ...expiredSession, status: 'live' } });
    } catch (e) {
      Alert.alert('Could not start session', e.message);
    } finally {
      setStarting(false);
    }
  }, [expiredSession]);

  const cancelNow = useCallback(async (onDone) => {
    if (!expiredSession) return;
    setCancelling(true);
    resolvedIdsRef.current.add(expiredSession.id);
    try {
      const { error } = await supabase
        .from('sessions')
        .update({ status: 'cancelled' })
        .eq('id', expiredSession.id);
      if (error) throw error;
      setVisible(false);
      setExpiredSession(null);
      onDone?.();
    } catch (e) {
      Alert.alert('Could not cancel session', e.message);
    } finally {
      setCancelling(false);
    }
  }, [expiredSession]);

  return {
    expiredSession, visible, starting, cancelling,
    graceSecondsLeft, graceTimeFormatted,
    startNow, cancelNow,
  };
}