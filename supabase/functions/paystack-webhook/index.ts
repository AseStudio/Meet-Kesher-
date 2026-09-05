import { serve } from 'https://deno.land/std@0.190.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const PAYSTACK_SECRET_KEY = Deno.env.get('PAYSTACK_SECRET_KEY')!;

// Paystack signs webhooks with the SAME secret key used for API calls
// (no separate webhook-signing secret the way Stripe has one) — HMAC
// SHA-512 over the raw request body, hex-encoded, sent as
// x-paystack-signature. This is the entire trust boundary: anyone who
// can forge this signature could grant themselves a free subscription,
// so nothing below acts on the payload until this passes.
async function verifyPaystackSignature(rawBody: string, signature: string | null): Promise<boolean> {
  if (!signature) return false;
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(PAYSTACK_SECRET_KEY),
    { name: 'HMAC', hash: 'SHA-512' },
    false,
    ['sign']
  );
  const sigBuffer = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(rawBody));
  const computedHex = Array.from(new Uint8Array(sigBuffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
  return computedHex === signature;
}

serve(async (req) => {
  const rawBody = await req.text();
  const signature = req.headers.get('x-paystack-signature');

  const valid = await verifyPaystackSignature(rawBody, signature);
  if (!valid) {
    // Deliberately vague response — doesn't confirm or deny anything
    // about why verification failed, just refuses to process it.
    return new Response('Invalid signature', { status: 401 });
  }

  const event = JSON.parse(rawBody);
  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

  // charge.success covers both the very first payment on a new
  // subscription and Paystack's own subscription.create event overlaps
  // with it in practice — handling both keeps this idempotent rather
  // than depending on exactly one event type always firing first.
  if (event.event === 'charge.success' || event.event === 'subscription.create') {
    const userId = event.data.metadata?.user_id;
    const plan = event.data.metadata?.plan;
    const subscriptionCode = event.data.subscription_code || event.data.reference;

    if (userId && plan) {
      await admin.from('subscriptions').upsert(
        {
          user_id: userId,
          processor: 'paystack',
          processor_subscription_id: subscriptionCode,
          processor_customer_id: event.data.customer?.customer_code || null,
          plan,
          status: 'active',
          current_period_end: event.data.next_payment_date || null,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'processor_subscription_id' }
      );

      await admin.from('profiles').update({ plan }).eq('id', userId);
    }
  }

  if (event.event === 'subscription.disable' || event.event === 'subscription.not_renew') {
    const subscriptionCode = event.data.subscription_code;
    const { data: sub } = await admin
      .from('subscriptions')
      .select('user_id')
      .eq('processor_subscription_id', subscriptionCode)
      .maybeSingle();

    if (sub) {
      await admin
        .from('subscriptions')
        .update({ status: 'canceled', updated_at: new Date().toISOString() })
        .eq('processor_subscription_id', subscriptionCode);
      await admin.from('profiles').update({ plan: 'free' }).eq('id', sub.user_id);
    }
  }

  if (event.event === 'invoice.payment_failed') {
    const subscriptionCode = event.data.subscription?.subscription_code;
    if (subscriptionCode) {
      await admin
        .from('subscriptions')
        .update({ status: 'past_due', updated_at: new Date().toISOString() })
        .eq('processor_subscription_id', subscriptionCode);
      // Deliberately NOT downgrading profiles.plan here — a single
      // failed renewal shouldn't instantly cut someone off. Paystack
      // retries failed charges automatically; subscription.disable
      // (handled above) is what fires once retries are exhausted, and
      // that's the actual "downgrade to free" trigger.
    }
  }

  return new Response('ok', { status: 200 });
});
