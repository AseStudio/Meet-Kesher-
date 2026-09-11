import { serve } from 'https://deno.land/std@0.190.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const PAYSTACK_SECRET_KEY = Deno.env.get('PAYSTACK_SECRET_KEY')!;
const APP_URL = Deno.env.get('APP_URL') || 'https://meet-kesher.vercel.app';

// Paystack test-mode plan codes. Swap for the live-mode codes once
// business activation completes — same three tiers, this is the only
// place that needs to change, no other code touches these directly.
const PAYSTACK_PLANS: Record<string, string> = {
  pro: 'PLN_ajw7f04djybtyod',
  max: 'PLN_9aa748hvw8f5y2s',
  premium: 'PLN_hrbk2uosxz0c2x6',
};

// Filled in once Stripe Price IDs exist. Until then the Stripe branch
// below returns a clear "not configured" error instead of silently
// doing the wrong thing with an empty price id.
const STRIPE_PRICES: Record<string, string> = {
  pro: '',
  max: '',
  premium: '',
};

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// supabase-js's functions.invoke() decides how to parse the response body
// purely from the Content-Type header — application/json gets response.json(),
// anything else (including no header at all) falls back to response.text().
// Deno's Response constructor does NOT infer application/json from a JSON
// string body; a bare string defaults to text/plain. Every JSON response
// below must set this explicitly, or the client receives the raw JSON
// string instead of a parsed object (data.url on a string is undefined,
// which is exactly what was sending hosts to /undefined on checkout).
const jsonHeaders = { ...corsHeaders, 'Content-Type': 'application/json' };

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    // Runs as the calling user (not the service role) purely to verify
    // who's actually asking — nothing this function does write-wise
    // uses this client, the service-role client below does all real
    // writes, since regular users have no direct write access to
    // subscriptions at all.
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: req.headers.get('Authorization')! } } }
    );

    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) {
      return new Response(JSON.stringify({ error: 'Not authenticated' }), { status: 401, headers: jsonHeaders });
    }

    const { processor, plan } = await req.json();
    if (!['pro', 'max', 'premium'].includes(plan)) {
      return new Response(JSON.stringify({ error: 'Invalid plan' }), { status: 400, headers: jsonHeaders });
    }

    const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

    if (processor === 'paystack') {
      const planCode = PAYSTACK_PLANS[plan];
      const res = await fetch('https://api.paystack.co/transaction/initialize', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${PAYSTACK_SECRET_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          email: user.email,
          // Required by Paystack's API even when a plan is attached —
          // and per their own docs, "the amount used to create the plan
          // takes precedence when subscribing to a plan," so this value
          // is never what actually gets charged. It just has to clear
          // their minimum. That minimum is NGN 100, and amounts are in
          // kobo (1 Naira = 100 kobo) — so the real floor is 10,000, not
          // 100. Sending 100 (= ₦1) was the actual bug behind "Invalid
          // Amount Sent": it satisfied "amount is present" but not
          // "amount clears the minimum."
          amount: 10000,
          plan: planCode,
          callback_url: `${APP_URL}/app?upgrade=paystack&plan=${plan}`,
          metadata: { user_id: user.id, plan },
        }),
      });
      const data = await res.json();

      if (!data.status) {
        return new Response(JSON.stringify({ error: data.message || 'Could not start checkout' }), { status: 400, headers: jsonHeaders });
      }

      // Recorded as 'pending' immediately — the webhook flips this to
      // 'active' once Paystack actually confirms payment. Having this
      // row exist right away is what lets a "confirming your
      // payment..." screen have something concrete to poll against
      // the moment the user is redirected back.
      await admin.from('subscriptions').insert({
        user_id: user.id,
        processor: 'paystack',
        plan,
        status: 'pending',
        processor_subscription_id: data.data.reference,
      });

      return new Response(JSON.stringify({ url: data.data.authorization_url }), { headers: jsonHeaders });
    }

    if (processor === 'stripe') {
      const priceId = STRIPE_PRICES[plan];
      if (!priceId) {
        return new Response(JSON.stringify({ error: 'Stripe checkout isn\'t configured yet — send the Price IDs to finish wiring this up.' }), { status: 400, headers: jsonHeaders });
      }
      // TODO: real Stripe Checkout Session creation goes here once
      // STRIPE_PRICES above is filled in.
      return new Response(JSON.stringify({ error: 'Stripe checkout not yet implemented.' }), { status: 400, headers: jsonHeaders });
    }

    return new Response(JSON.stringify({ error: 'Unknown processor' }), { status: 400, headers: jsonHeaders });
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: jsonHeaders });
  }
});
