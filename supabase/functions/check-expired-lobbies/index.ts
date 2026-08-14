// supabase/functions/check-expired-lobbies/index.ts
//
// Deploy with: supabase functions deploy check-expired-lobbies
// Secrets needed (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are injected
// automatically):
//   supabase secrets set VAPID_PUBLIC_KEY=BC82MBasUH3tkvmoKv8-1yA_bu1p2EXrjdndnK-Tk-_2JozwPT2aAtH9dryX5gSecb7QsvV7EAzADysFGnKGcs8
//   supabase secrets set VAPID_PRIVATE_KEY=oeMpceljxXJ2b4MAWrtDfMf-IeHRlsXAqbJjV543aBQ
//   supabase secrets set VAPID_SUBJECT=mailto:you@yourdomain.com
//
// Scheduled via the cron SQL snippet already provided (runs every minute).

import { createClient } from "npm:@supabase/supabase-js@2";
import webpush from "npm:web-push@3.6.7";

// Keep in sync with lib/constants.js / lib/useExpiredLobbyWatcher.js
const LOBBY_DURATION_SECONDS = 600; // TODO confirm against lib/constants.js
const GRACE_PERIOD_SECONDS = 300;
// No heartbeat from a live session's host in this long → assume their
// app is gone (closed, crashed, force-quit, lost network) and end it.
// Heartbeats fire every 15s from SessionMain, and last_seen_at is also
// stamped the instant a session goes live (see LobbyScreen.js/
// useExpiredLobbyWatcher.js) — this only needs to tolerate normal jitter
// plus this function's own up-to-60s cron interval, not the initial
// "Entering Session" transition gap.
const STALE_LIVE_SESSION_SECONDS = 50;

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const VAPID_PUBLIC_KEY = Deno.env.get("VAPID_PUBLIC_KEY")!;
const VAPID_PRIVATE_KEY = Deno.env.get("VAPID_PRIVATE_KEY")!;
const VAPID_SUBJECT = Deno.env.get("VAPID_SUBJECT") ?? "mailto:you@example.com";

webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);

Deno.serve(async (_req) => {
  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
  const now = Date.now();
  const results: Array<{ id: string; action: string; subscriberCount?: number }> = [];

  // ── Pass 1: scheduled sessions past their lobby window ──────────────
  const { data: scheduled, error: scheduledErr } = await supabase
    .from("sessions")
    .select("id, host_id, title, created_at, status, expiry_notified_at")
    .eq("status", "scheduled");

  if (scheduledErr) {
    return new Response(JSON.stringify({ error: scheduledErr.message }), { status: 500 });
  }

  for (const session of scheduled ?? []) {
    const createdMs = new Date(session.created_at).getTime();
    const secondsSinceCreated = (now - createdMs) / 1000;

    if (secondsSinceCreated >= LOBBY_DURATION_SECONDS + GRACE_PERIOD_SECONDS) {
      await supabase.from("sessions").update({ status: "cancelled" }).eq("id", session.id);
      results.push({ id: session.id, action: "cancelled" });
      continue;
    }

    if (secondsSinceCreated >= LOBBY_DURATION_SECONDS && !session.expiry_notified_at) {
      const { data: subs } = await supabase
        .from("push_subscriptions")
        .select("*")
        .eq("user_id", session.host_id);

      for (const sub of subs ?? []) {
        try {
          await webpush.sendNotification(
            { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
            JSON.stringify({
              title: "Lobby time is up",
              body: `"${session.title || "Your session"}" is ready — start it or cancel.`,
              tag: `session-expired-${session.id}`,
              url: "/",
            }),
          );
        } catch (err) {
          console.log("Push failed for subscription", sub.id, err.message);
          if (err.statusCode === 410) {
            await supabase.from("push_subscriptions").delete().eq("id", sub.id);
          }
        }
      }

      await supabase
        .from("sessions")
        .update({ expiry_notified_at: new Date().toISOString() })
        .eq("id", session.id);

      results.push({ id: session.id, action: "notified", subscriberCount: subs?.length ?? 0 });
    }
  }

  // ── Pass 2: live sessions whose host has gone stale ──────────────────
  const { data: live, error: liveErr } = await supabase
    .from("sessions")
    .select("id, last_seen_at")
    .eq("status", "live");

  if (liveErr) {
    return new Response(JSON.stringify({ error: liveErr.message, results }), { status: 500 });
  }

  for (const session of live ?? []) {
    const lastSeenMs = session.last_seen_at ? new Date(session.last_seen_at).getTime() : 0;
    const secondsSinceSeen = (now - lastSeenMs) / 1000;

    if (secondsSinceSeen >= STALE_LIVE_SESSION_SECONDS) {
      // 'ended', not 'cancelled' — AttendeeSession.js already listens
      // for status === 'ended' and correctly notifies + redirects
      // attendees out. It does NOT listen for 'cancelled' at all, which
      // would silently strand everyone still in the call.
      await supabase.from("sessions").update({ status: "ended" }).eq("id", session.id);
      results.push({ id: session.id, action: "auto-ended-stale-host" });
    }
  }

  return new Response(JSON.stringify({ checked: (scheduled?.length ?? 0) + (live?.length ?? 0), results }), {
    headers: { "Content-Type": "application/json" },
  });
});