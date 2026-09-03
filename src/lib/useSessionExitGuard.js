import { useEffect, useRef } from 'react';
import { Platform } from 'react-native';
import { supabase, SUPABASE_URL, SUPABASE_ANON_KEY } from './supabase';

// Web only: this is specifically about closing a *browser tab* (mobile
// Safari/Chrome, iOS/Android in-browser, or desktop) — the installed
// native apps aren't "tabs" and already clean up normally on unmount.
//
// A normal supabase-js call can't be trusted here: once a tab starts
// closing, the browser is free to kill any in-flight request the instant
// the unload event handler returns. `navigator.sendBeacon` survives that,
// but it can't carry the `Authorization` header our RLS policies need, so
// instead this fires a raw `fetch` straight at the PostgREST endpoint with
// `keepalive: true`, which is explicitly designed to let a short request
// like this finish even after the page has begun unloading.
function keepaliveUpdate(table, match, patch, token) {
  if (!token) return;
  const qs = Object.entries(match)
    .map(([col, val]) => `${col}=eq.${encodeURIComponent(val)}`)
    .join('&');
  try {
    fetch(`${SUPABASE_URL}/rest/v1/${table}?${qs}`, {
      method: 'PATCH',
      keepalive: true,
      headers: {
        'Content-Type': 'application/json',
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${token}`,
        Prefer: 'return=minimal',
      },
      body: JSON.stringify(patch),
    }).catch(() => {});
  } catch (e) {
    // Nothing we can do from a closing tab — best effort only.
  }
}

/**
 * Makes sure a session doesn't keep living as an empty shell just because
 * someone closed the tab instead of tapping End/Leave.
 *
 *   role: 'host'     -> ends the session itself (sessions.status = 'ended')
 *   role: 'attendee' -> marks this attendee's row as left (left_at = now)
 *
 * `getUserId` is a function (not a plain value) because the attendee's id
 * is often only known a moment after mount — reading it lazily at exit
 * time means we don't miss it if the tab closes early.
 */
export function useSessionExitGuard({ role, sessionId, getUserId, enabled = true }) {
  const tokenRef = useRef(null);

  // Keep a live copy of the access token, since the exit handlers below
  // can't themselves await an async supabase.auth call once the tab is
  // already on its way out.
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    let mounted = true;

    supabase.auth.getSession().then(({ data }) => {
      if (mounted) tokenRef.current = data?.session?.access_token || null;
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_event, newSession) => {
      tokenRef.current = newSession?.access_token || null;
    });

    return () => {
      mounted = false;
      sub?.subscription?.unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (Platform.OS !== 'web' || !enabled || !sessionId) return;

    const fireExit = () => {
      const token = tokenRef.current;
      if (role === 'host') {
        keepaliveUpdate('sessions', { id: sessionId }, { status: 'ended', ended_at: new Date().toISOString() }, token);
      } else {
        const uid = getUserId ? getUserId() : null;
        if (!uid) return;
        keepaliveUpdate(
          'session_attendees',
          { session_id: sessionId, user_id: uid },
          { left_at: new Date().toISOString() },
          token
        );
      }
    };

    // `pagehide` is the reliable "the page is actually going away" signal
    // across desktop and mobile browsers — including iOS Safari, where
    // `beforeunload` is unreliable and often silently ignored. It fires on
    // tab close, refresh, and navigating away. `beforeunload` is kept as a
    // second, redundant listener purely for older desktop browsers that
    // still rely on it; whichever fires first wins, the other is harmless.
    window.addEventListener('pagehide', fireExit);
    window.addEventListener('beforeunload', fireExit);

    return () => {
      window.removeEventListener('pagehide', fireExit);
      window.removeEventListener('beforeunload', fireExit);
    };
  }, [role, sessionId, enabled, getUserId]);
}
