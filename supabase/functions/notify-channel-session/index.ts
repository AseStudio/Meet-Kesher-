// supabase/functions/notify-channel-session/index.ts
//
// Deploy: supabase functions deploy notify-channel-session
// Invoke from the client (see ChannelChatScreen.js) right after inserting
// the session row:
//
//   await supabase.functions.invoke('notify-channel-session', {
//     body: { sessionId: data.id, channelId, channelName }
//   });
//
// This runs server-side specifically so fanning out to potentially
// hundreds of channel members doesn't depend on a phone staying
// foregrounded through a long client-side loop — see the comment in
// ChannelChatScreen.js's startCommunitySession().
//
// ⚠️ ASSUMPTIONS FLAGGED:
//   - push_subscriptions.endpoint holds the Expo push token for native
//     rows (per the ASSUMPTION note in usePushSubscription.native.js) —
//     web-only rows (Web Push endpoint URLs) are filtered out below via
//     the `platform` column, since those need the VAPID/Web Push
//     protocol, not Expo's push API. If you want web push included too,
//     that's a second notification path, not a tweak to this one.
//   - Uses the Expo push API directly (https://exp.host/--/api/v2/push/send)
//     rather than the expo-server-sdk npm package, since Deno edge
//     functions can't use that package directly — this hand-rolls the
//     same HTTP call it makes internally.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';
const BATCH_SIZE = 100; // Expo's push API accepts up to 100 messages per request

Deno.serve(async (req) => {
  try {
    const { sessionId, channelId, channelName } = await req.json();
    if (!channelId) {
      return new Response(JSON.stringify({ error: 'channelId is required' }), { status: 400 });
    }

    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL'),
      // Service role key — required to read every member's push token,
      // which RLS would otherwise restrict to each user reading their own.
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
    );

    const { data: members, error: membersError } = await supabaseAdmin
      .from('channel_roles')
      .select('user_id')
      .eq('channel_id', channelId);
    if (membersError) throw membersError;

    const memberIds = (members || []).map((m) => m.user_id);
    if (memberIds.length === 0) {
      return new Response(JSON.stringify({ sent: 0 }), { status: 200 });
    }

    const { data: subscriptions, error: subsError } = await supabaseAdmin
      .from('push_subscriptions')
      .select('endpoint, user_id')
      .in('user_id', memberIds)
      .neq('platform', 'web'); // web rows use Web Push endpoints, not Expo tokens — filtered again below by endpoint shape as a belt-and-suspenders check

    if (subsError) throw subsError;

    const messages = (subscriptions || [])
      .filter((s) => s.endpoint?.startsWith('ExponentPushToken'))
      .map((s) => ({
        to: s.endpoint,
        sound: 'default',
        title: channelName ? `${channelName} is starting a session` : 'A session is starting',
        body: 'Tap to join now.',
        data: { sessionId, channelId },
      }));

    let sent = 0;
    for (let i = 0; i < messages.length; i += BATCH_SIZE) {
      const batch = messages.slice(i, i + BATCH_SIZE);
      const res = await fetch(EXPO_PUSH_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(batch),
      });
      if (res.ok) sent += batch.length;
    }

    return new Response(JSON.stringify({ sent }), { status: 200 });
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), { status: 500 });
  }
});
