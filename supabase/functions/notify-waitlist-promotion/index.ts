// supabase/functions/notify-waitlist-promotion/index.ts
//
// Deploy: supabase functions deploy notify-waitlist-promotion
// Called from promote_from_waitlist() in 004_waitlist.sql via pg_net,
// right after someone is moved from session_waitlist into
// session_attendees — same reasoning as notify-channel-session: this
// needs to reach someone whose app may not be open, so it has to be a
// real push, not something that only fires if a screen happens to be
// mounted and listening.
//
// Same assumptions as notify-channel-session/index.ts: push_subscriptions
// .endpoint holds an Expo push token for native rows, filtered to
// non-web rows, sent via Expo's push HTTP API directly.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';

Deno.serve(async (req) => {
  try {
    const { userId, sessionId } = await req.json();
    if (!userId || !sessionId) {
      return new Response(JSON.stringify({ error: 'userId and sessionId are required' }), { status: 400 });
    }

    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL'),
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
    );

    const [{ data: session }, { data: subscriptions, error: subsError }] = await Promise.all([
      supabaseAdmin.from('sessions').select('title').eq('id', sessionId).maybeSingle(),
      supabaseAdmin
        .from('push_subscriptions')
        .select('endpoint')
        .eq('user_id', userId)
        .neq('platform', 'web'),
    ]);
    if (subsError) throw subsError;

    const messages = (subscriptions || [])
      .filter((s) => s.endpoint?.startsWith('ExponentPushToken'))
      .map((s) => ({
        to: s.endpoint,
        sound: 'default',
        title: 'A spot opened up!',
        body: session?.title ? `You're in — "${session.title}" has room for you now.` : "You're in — join now.",
        data: { sessionId },
      }));

    if (messages.length === 0) {
      return new Response(JSON.stringify({ sent: 0 }), { status: 200 });
    }

    const res = await fetch(EXPO_PUSH_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(messages),
    });

    return new Response(JSON.stringify({ sent: res.ok ? messages.length : 0 }), { status: 200 });
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), { status: 500 });
  }
});
