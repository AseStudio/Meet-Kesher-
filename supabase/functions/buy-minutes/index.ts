import { serve } from 'https://deno.land/std@0.190.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const PAYSTACK_SECRET_KEY = Deno.env.get('PAYSTACK_SECRET_KEY')!;

// Mirrors MINUTE_PACKS in src/lib/constants.js — keep both in sync by
// hand. This is the one that actually matters: the client sends a
// packId or a minutes count, never a price, and everything charged
// comes from here, never from anything the client sent.
const MINUTE_PACKS: Record<string, { minutes: number; priceCedis: number }> = {
  pm_60: { minutes: 60, priceCedis: 13 },
  pm_120: { minutes: 120, priceCedis: 25 },
  pm_300: { minutes: 300, priceCedis: 62 },
  pm_600: { minutes: 600, priceCedis: 121 },
  pm_1200: { minutes: 1200, priceCedis: 245 },
  pm_6000: { minutes: 6000, priceCedis: 1230 },
};

const RATE_CEDIS_PER_MINUTE = 0.22;
const SLIDER_MIN_MINUTES = 10;
const SLIDER_MAX_MINUTES = 2000;

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};
const jsonHeaders = { ...corsHeaders, 'Content-Type': 'application/json' };

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: req.headers.get('Authorization')! } } }
    );

    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) {
      return new Response(JSON.stringify({ error: 'Not authenticated' }), { status: 401, headers: jsonHeaders });
    }

    const { packId, customMinutes } = await req.json();

    let minutes: number;
    let priceCedis: number;

    if (packId) {
      const pack = MINUTE_PACKS[packId];
      if (!pack) {
        return new Response(JSON.stringify({ error: 'Unknown pack' }), { status: 400, headers: jsonHeaders });
      }
      minutes = pack.minutes;
      priceCedis = pack.priceCedis;
    } else if (typeof customMinutes === 'number') {
      if (customMinutes < SLIDER_MIN_MINUTES || customMinutes > SLIDER_MAX_MINUTES) {
        return new Response(JSON.stringify({ error: `Minutes must be between ${SLIDER_MIN_MINUTES} and ${SLIDER_MAX_MINUTES}` }), { status: 400, headers: jsonHeaders });
      }
      minutes = Math.round(customMinutes);
      // Rounded to the nearest pesewa (2dp) before converting to the
      // integer subunit Paystack expects below — avoids a fractional
      // pesewa amount from something like 37 * 0.22.
      priceCedis = Math.round(minutes * RATE_CEDIS_PER_MINUTE * 100) / 100;
    } else {
      return new Response(JSON.stringify({ error: 'Provide either packId or customMinutes' }), { status: 400, headers: jsonHeaders });
    }

    const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

    const amountPesewas = Math.round(priceCedis * 100);

    const res = await fetch('https://api.paystack.co/transaction/initialize', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${PAYSTACK_SECRET_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        email: user.email,
        amount: amountPesewas,
        currency: 'GHS',
        // Always a single charge, never recurring — no plan attached,
        // so both channels are fine here (see create-checkout for why
        // Mobile Money is restricted to one-time charges only).
        channels: ['card', 'mobile_money'],
        metadata: { user_id: user.id, minutes, kind: 'participant_minutes' },
      }),
    });
    const data = await res.json();

    if (!data.status) {
      return new Response(JSON.stringify({ error: data.message || 'Could not start checkout' }), { status: 400, headers: jsonHeaders });
    }

    // Logged here as 'pending', flipped to 'completed' by the webhook
    // once Paystack confirms payment — same pattern as `subscriptions`,
    // kept in its own table since this isn't a subscription at all and
    // never touches profiles.plan.
    await admin.from('minute_purchases').insert({
      user_id: user.id,
      minutes,
      amount_pesewas: amountPesewas,
      currency: 'GHS',
      processor: 'paystack',
      processor_reference: data.data.reference,
      status: 'pending',
    });

    return new Response(JSON.stringify({ url: data.data.authorization_url }), { headers: jsonHeaders });
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: jsonHeaders });
  }
});