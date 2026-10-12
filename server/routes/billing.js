import express from 'express';
import { get, run, nowIso } from '../lib/db.js';
import { asyncHandler, bad, notFound, unauthorized, HttpError } from '../lib/util.js';
import {
  PLANS, billingConfig, entitlementsFor, setPlan, recordBillingEvent, recentBillingEvents, stripeKey,
} from '../lib/billing.js';

const router = express.Router();

async function stripeClient() {
  const key = stripeKey();
  if (!key) throw new HttpError(503, 'Stripe is not configured. Set STRIPE_SECRET_KEY.', 'stripe_not_configured');
  const { default: Stripe } = await import('stripe');
  return new Stripe(key, { apiVersion: '2024-12-18.acacia' });
}

function publicConfig() {
  const cfg = billingConfig();
  return {
    ...cfg,
    // Never leak secrets — only whether things are configured.
    plans: {
      free: { id: 'free', name: PLANS.free.name, priceMonthly: 0, priceAnnual: 0, features: PLANS.free.features, limits: PLANS.free.limits, tagline: PLANS.free.tagline },
      plus: { id: 'plus', name: PLANS.plus.name, priceMonthly: PLANS.plus.priceMonthly, priceAnnual: PLANS.plus.priceAnnual, features: PLANS.plus.features, limits: PLANS.plus.limits, tagline: PLANS.plus.tagline },
    },
    annualNote: 'Annual billing charges $103.92 once per year (equivalent to $8.66/month), billed at checkout.',
  };
}

router.get('/billing', asyncHandler(async (req, res) => {
  res.json({
    config: publicConfig(),
    entitlements: entitlementsFor(req.user.id),
    events: recentBillingEvents(req.user.id, 10),
  });
}));

/** Public pricing data (no auth) for the pricing page. */
router.get('/billing/plans', asyncHandler(async (_req, res) => {
  res.json({ config: publicConfig() });
}));

/**
 * Begin an upgrade. In payment-link mode we return the link with the user's id
 * attached so the completed purchase can be attributed. In checkout mode we
 * create a hosted Checkout Session server-side.
 */
router.post('/billing/checkout', asyncHandler(async (req, res) => {
  const interval = req.body?.interval === 'annual' ? 'annual' : 'monthly';
  const cfg = billingConfig();
  const userId = req.user.id;

  if (cfg.mode === 'payment_link') {
    const base = cfg.links[interval] || cfg.links.monthly;
    if (!base) throw new HttpError(503, `No Stripe payment link is configured for ${interval} billing.`, 'link_missing');
    const url = new URL(base);
    url.searchParams.set('client_reference_id', userId);
    if (req.user.email) url.searchParams.set('prefilled_email', req.user.email);
    // A hint for the webhook when the Payment Link has no metadata configured.
    url.searchParams.set('utm_source', 'recall');
    return res.json({ mode: 'payment_link', url: url.toString(), interval });
  }

  if (cfg.mode === 'checkout') {
    const priceId = interval === 'annual' ? cfg.prices.annual : cfg.prices.monthly;
    if (!priceId) throw new HttpError(503, `No Stripe price is configured for ${interval} billing.`, 'price_missing');
    const stripe = await stripeClient();
    const base = process.env.APP_BASE_URL || `${req.protocol}://${req.get('host')}`;
    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      line_items: [{ price: priceId, quantity: 1 }],
      client_reference_id: userId,
      customer_email: req.user.email,
      metadata: { userId, interval },
      subscription_data: { metadata: { userId, interval } },
      success_url: `${base}/billing?session_id={CHECKOUT_SESSION_ID}&status=success`,
      cancel_url: `${base}/pricing?status=cancelled`,
      allow_promotion_codes: true,
    });
    return res.json({ mode: 'checkout', url: session.url, interval });
  }

  throw new HttpError(503, cfg.message, 'billing_not_configured');
}));

/**
 * Confirm a completed purchase from the success redirect. The session is
 * re-fetched from Stripe with the secret key, so a client cannot fake success.
 */
router.get('/billing/confirm', asyncHandler(async (req, res) => {
  const sessionId = req.query.session_id;
  if (!sessionId) throw bad('A session_id is required.', 'session_required');
  if (!stripeKey()) throw new HttpError(503, 'Stripe is not configured.', 'stripe_not_configured');
  const stripe = await stripeClient();
  const session = await stripe.checkout.sessions.retrieve(sessionId, { expand: ['subscription'] });
  const userId = session.client_reference_id || session.metadata?.userId;
  if (!userId || userId !== req.user.id) {
    throw unauthorized('That checkout session does not belong to this account.', 'session_mismatch');
  }
  if (session.payment_status !== 'paid' && session.status !== 'complete') {
    throw bad('That checkout session is not paid yet.', 'not_paid');
  }
  const sub = session.subscription;
  const interval = session.metadata?.interval || inferInterval(session);
  setPlan(userId, {
    plan: 'plus',
    interval,
    status: 'active',
    customerId: typeof session.customer === 'string' ? session.customer : session.customer?.id,
    subscriptionId: typeof sub === 'string' ? sub : sub?.id,
    currentPeriodEnd: sub?.current_period_end ? new Date(sub.current_period_end * 1000).toISOString() : null,
  });
  recordBillingEvent({ eventId: `confirm_${session.id}`, userId, type: 'checkout.confirmed', payload: { sessionId: session.id } });
  res.json({ ok: true, entitlements: entitlementsFor(userId) });
}));

function inferInterval(session) {
  // Payment Links do not always carry metadata; fall back to the amount paid.
  const amount = session.amount_total || 0;
  return amount >= 5000 ? 'annual' : 'monthly';
}

/**
 * Stripe webhook — signature-verified, idempotent, authoritative.
 * Mounted WITHOUT authentication (Stripe is the caller) in server/index.js.
 */
export const webhookHandler = asyncHandler(async (req, res) => {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  const key = stripeKey();
  if (!secret || !key) {
    return res.status(503).json({ error: 'Webhooks are not configured (STRIPE_WEBHOOK_SECRET / STRIPE_SECRET_KEY).' });
  }
  const { default: Stripe } = await import('stripe');
  const stripe = new Stripe(key, { apiVersion: '2024-12-18.acacia' });
  let event;
  try {
    event = stripe.webhooks.constructEvent(req.body, req.headers['stripe-signature'], secret);
  } catch (err) {
    return res.status(400).json({ error: `Webhook signature verification failed: ${err.message}` });
  }

  const fresh = recordBillingEvent({ eventId: event.id, userId: null, type: event.type, payload: event.data?.object || {} });
  if (!fresh) return res.json({ received: true, duplicate: true });

  const obj = event.data?.object || {};
  try {
    if (event.type === 'checkout.session.completed') {
      const userId = obj.client_reference_id || obj.metadata?.userId;
      if (userId) {
        const interval = obj.metadata?.interval || inferInterval(obj);
        setPlan(userId, {
          plan: 'plus', interval, status: 'active',
          customerId: typeof obj.customer === 'string' ? obj.customer : obj.customer?.id,
          subscriptionId: typeof obj.subscription === 'string' ? obj.subscription : obj.subscription?.id,
        });
        run('UPDATE billing_events SET user_id = ? WHERE event_id = ?', [userId, event.id]);
      }
    } else if (event.type.startsWith('customer.subscription.')) {
      const userId = obj.metadata?.userId || findByCustomer(obj.customer);
      if (userId) {
        const status = obj.status === 'active' || obj.status === 'trialing' ? obj.status
          : (obj.status === 'past_due' ? 'past_due' : 'canceled');
        setPlan(userId, {
          plan: obj.status === 'active' || obj.status === 'trialing' ? 'plus' : 'free',
          interval: obj.items?.data?.[0]?.price?.recurring?.interval === 'year' ? 'annual' : 'monthly',
          status,
          customerId: typeof obj.customer === 'string' ? obj.customer : obj.customer?.id,
          subscriptionId: obj.id,
          currentPeriodEnd: obj.current_period_end ? new Date(obj.current_period_end * 1000).toISOString() : null,
          cancelAtPeriodEnd: Boolean(obj.cancel_at_period_end),
        });
        run('UPDATE billing_events SET user_id = ? WHERE event_id = ?', [userId, event.id]);
      }
    } else if (event.type === 'invoice.payment_failed') {
      const userId = findByCustomer(obj.customer);
      if (userId) {
        run('UPDATE subscriptions SET status = ?, updated_at = ? WHERE user_id = ?', ['past_due', nowIso(), userId]);
        run('UPDATE billing_events SET user_id = ? WHERE event_id = ?', [userId, event.id]);
      }
    } else if (event.type === 'invoice.paid') {
      const userId = findByCustomer(obj.customer);
      if (userId) {
        run('UPDATE subscriptions SET status = ?, updated_at = ? WHERE user_id = ?', ['active', nowIso(), userId]);
        run('UPDATE billing_events SET user_id = ? WHERE event_id = ?', [userId, event.id]);
      }
    }
  } catch (err) {
    console.error('[Recall] webhook handling error', err);
    // Return 200 so Stripe does not retry a handler bug indefinitely; the event
    // is recorded and can be replayed.
  }
  res.json({ received: true });
});

function findByCustomer(customerId) {
  if (!customerId) return null;
  const id = typeof customerId === 'string' ? customerId : customerId.id;
  return get('SELECT user_id FROM subscriptions WHERE stripe_customer_id = ?', [id])?.user_id || null;
}

/** Stripe-hosted billing portal. */
router.post('/billing/portal', asyncHandler(async (req, res) => {
  const sub = get('SELECT * FROM subscriptions WHERE user_id = ?', [req.user.id]);
  if (!stripeKey()) throw new HttpError(503, 'Stripe is not configured, so the billing portal is unavailable.', 'stripe_not_configured');
  if (!sub?.stripe_customer_id) throw bad('No Stripe customer is linked to your account yet.', 'no_customer');
  const stripe = await stripeClient();
  const base = process.env.APP_BASE_URL || `${req.protocol}://${req.get('host')}`;
  const portal = await stripe.billingPortal.sessions.create({
    customer: sub.stripe_customer_id,
    return_url: `${base}/billing`,
  });
  res.json({ url: portal.url });
}));

/** Cancel at period end (keeps access until the paid period ends). */
router.post('/billing/cancel', asyncHandler(async (req, res) => {
  const userId = req.user.id;
  const sub = get('SELECT * FROM subscriptions WHERE user_id = ?', [userId]);
  if (!sub) throw notFound('No subscription found.');
  if (sub.stripe_subscription_id && stripeKey()) {
    const stripe = await stripeClient();
    await stripe.subscriptions.update(sub.stripe_subscription_id, { cancel_at_period_end: true });
  }
  run('UPDATE subscriptions SET cancel_at_period_end = 1, updated_at = ? WHERE user_id = ?', [nowIso(), userId]);
  res.json({ entitlements: entitlementsFor(userId) });
}));

router.post('/billing/resume', asyncHandler(async (req, res) => {
  const userId = req.user.id;
  const sub = get('SELECT * FROM subscriptions WHERE user_id = ?', [userId]);
  if (!sub) throw notFound('No subscription found.');
  if (sub.stripe_subscription_id && stripeKey()) {
    const stripe = await stripeClient();
    await stripe.subscriptions.update(sub.stripe_subscription_id, { cancel_at_period_end: false });
  }
  run('UPDATE subscriptions SET cancel_at_period_end = 0, updated_at = ? WHERE user_id = ?', [nowIso(), userId]);
  res.json({ entitlements: entitlementsFor(userId) });
}));

/**
 * Development-only plan toggle. Disabled unless RECALL_ALLOW_DEV_UPGRADE=1.
 * This exists so the paid features can be exercised locally before Stripe is
 * wired up; it is never a substitute for a verified payment in production.
 */
router.post('/billing/dev-activate', asyncHandler(async (req, res) => {
  if (process.env.RECALL_ALLOW_DEV_UPGRADE !== '1') {
    throw new HttpError(403, 'Dev activation is disabled. Configure Stripe or set RECALL_ALLOW_DEV_UPGRADE=1 for local testing.', 'dev_disabled');
  }
  const plan = req.body?.plan === 'free' ? 'free' : 'plus';
  setPlan(req.user.id, {
    plan,
    interval: plan === 'free' ? null : (req.body?.interval === 'annual' ? 'annual' : 'monthly'),
    status: plan === 'free' ? 'canceled' : 'active',
    currentPeriodEnd: plan === 'free' ? null : new Date(Date.now() + 30 * 864e5).toISOString(),
  });
  res.json({ entitlements: entitlementsFor(req.user.id), devMode: true });
}));

export default router;
