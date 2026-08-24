import { Platform } from 'react-native';
import * as WebBrowser from 'expo-web-browser';
import * as Linking from 'expo-linking';
import { supabase } from './supabase';

// Lets the in-app browser sheet opened below hand control back to this
// app once Supabase redirects to our deep link. Safe to call on web
// too (no-op there) — see https://docs.expo.dev/versions/latest/sdk/webbrowser/
WebBrowser.maybeCompleteAuthSession();

// Native has no window.location.origin to redirect back to. Linking
// .createURL builds a deep link from whatever "scheme" is set in
// app.json/app.config.js (e.g. "scheme": "kesher") — nothing here
// hardcodes it. That same URL (e.g. kesher://auth/callback) needs to
// be added to Supabase's dashboard under Authentication > URL
// Configuration > Redirect URLs, or the OAuth redirect will be rejected.
const NATIVE_REDIRECT_URL = Linking.createURL('auth/callback');

/**
 * Cross-platform Google sign-in via Supabase OAuth. Same signature on
 * both platforms — screens don't need their own Platform.OS branch.
 *
 * Web: unchanged behavior — full-page redirect through Supabase, then
 * back to window.location.origin, where detectSessionInUrl (see
 * lib/supabase.js) picks the session up automatically.
 *
 * Native: opens the OAuth flow in an in-app browser sheet
 * (expo-web-browser) instead of navigating the whole app away, and
 * when Supabase redirects to NATIVE_REDIRECT_URL, exchanges the
 * returned ?code= for a session by hand — there's no browser history
 * or URL bar for anything to auto-detect.
 *
 * Returns { error } — on user cancellation returns { error: null,
 * cancelled: true } so callers can silently stop a spinner instead of
 * showing "sign-in failed".
 */
export async function signInWithGoogle() {
  if (Platform.OS === 'web') {
    // Used to redirect to window.location.origin (bare "/"). That's fine
    // as long as "/" serves the Expo app — but it now serves the static
    // marketing landing.html instead (see vercel.json), which has no
    // Supabase client running on it at all. detectSessionInUrl (see
    // lib/supabase.js) only fires once the Expo bundle actually loads, so
    // a redirect back to "/" left the session tokens sitting unused in
    // the URL and dropped the user on the landing page instead of into
    // the app. Redirecting to "/app" instead lands on the real bundle.
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: `${window.location.origin}/app` },
    });
    return { error };
  }

  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: {
      redirectTo: NATIVE_REDIRECT_URL,
      skipBrowserRedirect: true, // we drive the browser ourselves below
    },
  });
  if (error) return { error };
  if (!data?.url) return { error: new Error('No OAuth URL returned by Supabase.') };

  const result = await WebBrowser.openAuthSessionAsync(data.url, NATIVE_REDIRECT_URL);

  if (result.type !== 'success' || !result.url) {
    // Sheet dismissed / user backed out — not a real failure.
    return { error: null, cancelled: true };
  }

  const { queryParams } = Linking.parse(result.url);

  if (queryParams?.error) {
    return { error: new Error(queryParams.error_description || queryParams.error) };
  }

  if (queryParams?.code) {
    const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(queryParams.code);
    return { error: exchangeError };
  }

  // Fallback in case Supabase ever hands back an implicit-flow redirect
  // (tokens in the URL fragment) instead of a PKCE ?code=. Linking.parse
  // doesn't expose the fragment as queryParams, so pull it manually.
  const hashPart = result.url.split('#')[1];
  const hashParams = hashPart ? Object.fromEntries(new URLSearchParams(hashPart)) : {};
  if (hashParams.access_token && hashParams.refresh_token) {
    const { error: setError } = await supabase.auth.setSession({
      access_token: hashParams.access_token,
      refresh_token: hashParams.refresh_token,
    });
    return { error: setError };
  }

  return { error: new Error('Could not complete sign-in — no code or tokens in the redirect.') };
}
