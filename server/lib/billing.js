/**
 * Subscription & billing.
 *
 * Supports three modes, chosen by which environment variables are present:
 *   1. "payment_link" — Stripe Payment Links (the easiest to configure; append
 *      `client_reference_id` so a completed purchase can be attributed to a user).
 *   2. "checkout"     — server-created Stripe Checkout Sessions from price IDs.
 *   3. "none"         — billing not configured; the UI shows a clear setup state.
 *
 * Premium access is only ever granted server-side, and only from:
 *   - a signature-verified Stripe webhook, or
 *   - a Checkout Session re-fetched from Stripe with the secret key (success redirect).
 * The client can never assert that a payment succeeded.
 */
import { get, run, nowIso, all } from './db.js';
import { id, HttpError } from './util.js';

export const PLANS = {
  free: {
    id: 'free',
    name: 'Free',
    priceMonthly: 0,
    priceAnnual: 0,
    tagline: 'Everything you need to start studying.',
    limits: {
      maxWorkspaces: 1,
      maxStudySets: 5,
      maxFlashcards: 300,
      aiCreditsPerMonth: 5,
      practiceExamsPerMonth: 3,
      advancedAnalytics: false,
    },
    features: [
      '1 certification workspace',
      'Up to 5 study sets and 300 flashcards',
      '5 AI document-processing credits / month',
      'Flashcard review with spaced repetition',
      '3 practice exams / month',
      'Basic progress tracking',
    ],
  },
  plus: {
    id: 'plus',
    name: 'Recall Plus',
    priceMonthly: 12.99,
    priceAnnual: 103.92, // $8.66/mo billed annually
    tagline: 'For serious exam preparation.',
    limits: {
      maxWorkspaces: 10,
      maxStudySets: 250,
      maxFlashcards: 20000,
      aiCreditsPerMonth: 120,
      practiceExamsPerMonth: 200,
      advancedAnalytics: true,
    },
    features: [
      'Up to 10 certification workspaces',
      '250 study sets and 20,000 flashcards',
      '120 AI document-processing credits / month',
      'Unlimited practice exams',
      'Advanced analytics & weak-topic analysis',
      'Personalized study planning',
      'Priority AI processing',
    ],
  },
};

export function stripeKey() { return process.env.STRIPE_SECRET_KEY || ''; }

export function billingConfig() {
  const hasKey = Boolean(stripeKey());
  const monthlyLink = process.env.STRIPE_PAYMENT_LINK_MONTHLY || '';
  const annualLink = process.env.STRIPE_PAYMENT_LINK_ANNUAL || '';
  const monthlyPrice = process.env.STRIPE_PRICE_PLUS_MONTHLY || '';
  const annualPrice = process.env.STRIPE_PRICE_PLUS_ANNUAL || '';

  let mode = 'none';
  if (monthlyLink || annualLink) mode = 'payment_link';
  else if (hasKey && (monthlyPrice || annualPrice)) mode = 'checkout';

  return {
    mode,
    configured: mode !== 'none',
    webhookConfigured: Boolean(process.env.STRIPE_WEBHOOK_SECRET),
    portalAvailable: hasKey,
    links: { monthly: monthlyLink, annual: annualLink },
    prices: { monthly: monthlyPrice, annual: annualPrice },
    message: mode === 'none'
      ? 'Billing is not configured yet. Add STRIPE_PAYMENT_LINK_MONTHLY / STRIPE_PAYMENT_LINK_ANNUAL (or a Stripe secret key with price IDs) to enable upgrades. You can keep using the free plan in the meantime.'
      : 'Billing is configured.',
  };
}

/** The user's effective plan + limits + live usage. */
export function entitlementsFor(userId) {
  const sub = get('SELECT * FROM subscriptions WHERE user_id = ?', [userId]);
  const active = sub && ['active', 'trialing'].includes(sub.status)
    && (!sub.current_period_end || new Date(sub.current_period_end).getTime() > Date.now() - 864e5);
  const planId = active && sub.plan === 'plus' ? 'plus' : 'free';
  const plan = PLANS[planId];

  const workspaces = get('SELECT COUNT(*) AS n FROM workspaces WHERE user_id = ?', [userId])?.n || 0;
  const sets = get('SELECT COUNT(*) AS n FROM study_sets WHERE user_id = ? AND archived = 0', [userId])?.n || 0;
  const cards = get('SELECT COUNT(*) AS n FROM flashcards WHERE user_id = ? AND archived = 0', [userId])?.n || 0;
  const month = new Date().toISOString().slice(0, 7);
  const aiUsed = get('SELECT COALESCE(SUM(units),0) AS n FROM ai_usage WHERE user_id = ? AND month = ?', [userId, month])?.n || 0;
  const exams = get(
    `SELECT COUNT(*) AS n FROM quizzes WHERE user_id = ? AND mode = 'exam' AND created_at >= ?`,
    [userId, `${month}-01`],
  )?.n || 0;

  return {
    planId,
    plan: { id: plan.id, name: plan.name },
    subscription: sub ? {
      status: sub.status,
      plan: sub.plan,
      interval: sub.billing_interval,
      currentPeriodEnd: sub.current_period_end,
      cancelAtPeriodEnd: Boolean(sub.cancel_at_period_end),
      stripeCustomerId: sub.stripe_customer_id || null,
    } : null,
    limits: plan.limits,
    usage: {
      workspaces, studySets: sets, flashcards: cards,
      aiCredits: aiUsed, practiceExams: exams,
    },
  };
}

const LIMIT_MESSAGES = {
  maxWorkspaces: 'You have reached the workspace limit for your plan. Upgrade to Recall Plus to add more certification workspaces.',
  maxStudySets: 'You have reached the study-set limit for your plan. Upgrade to Recall Plus for more study sets.',
  maxFlashcards: 'You have reached the flashcard limit for your plan. Upgrade to Recall Plus for more flashcards.',
  aiCreditsPerMonth: 'You have used all of this month\'s AI credits. They reset next month, or upgrade to Recall Plus for a much larger allowance.',
  practiceExamsPerMonth: 'You have reached this month\'s practice-exam limit. Upgrade to Recall Plus for unlimited practice exams.',
};

/** Throws a 402 with an upgrade hint when a limit is exceeded. */
export function assertWithinLimit(userId, key, increment = 1) {
  const ent = entitlementsFor(userId);
  const limit = ent.limits[key];
  if (limit === undefined || limit === Infinity || limit === null) return ent;
  const used = ent.usage[usageKeyFor(key)] || 0;
  if (used + increment > limit) {
    throw new HttpError(402, LIMIT_MESSAGES[key] || 'Plan limit reached.', 'plan_limit', { limit, used, key });
  }
  return ent;
}

function usageKeyFor(key) {
  return {
    maxWorkspaces: 'workspaces',
    maxStudySets: 'studySets',
    maxFlashcards: 'flashcards',
    aiCreditsPerMonth: 'aiCredits',
    practiceExamsPerMonth: 'practiceExams',
  }[key];
}

export function requiresAdvancedAnalytics(userId) {
  return entitlementsFor(userId).limits.advancedAnalytics === true;
}

// ---- Plan changes (server-side only) --------------------------------------

export function setPlan(userId, { plan, interval, status = 'active', customerId = null, subscriptionId = null, currentPeriodEnd = null, cancelAtPeriodEnd = false }) {
  const existing = get('SELECT id FROM subscriptions WHERE user_id = ?', [userId]);
  const ts = nowIso();
  if (existing) {
    run(
      `UPDATE subscriptions SET plan=?, billing_interval=?, status=?, stripe_customer_id=COALESCE(?, stripe_customer_id),
        stripe_subscription_id=COALESCE(?, stripe_subscription_id), current_period_end=?, cancel_at_period_end=?, updated_at=?
       WHERE user_id=?`,
      [plan, interval, status, customerId, subscriptionId, currentPeriodEnd, cancelAtPeriodEnd ? 1 : 0, ts, userId],
    );
  } else {
    run(
      `INSERT INTO subscriptions (id, user_id, plan, billing_interval, status, stripe_customer_id, stripe_subscription_id, current_period_end, cancel_at_period_end, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [id('sub_'), userId, plan, interval, status, customerId, subscriptionId, currentPeriodEnd, cancelAtPeriodEnd ? 1 : 0, ts, ts],
    );
  }
  return get('SELECT * FROM subscriptions WHERE user_id = ?', [userId]);
}

export function recordBillingEvent({ eventId, userId, type, payload }) {
  const existing = get('SELECT id FROM billing_events WHERE event_id = ?', [eventId]);
  if (existing) return false; // idempotent
  run(
    'INSERT INTO billing_events (id, event_id, user_id, provider, type, payload, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [id('bev_'), eventId, userId || null, 'stripe', type, JSON.stringify(payload).slice(0, 20000), nowIso()],
  );
  return true;
}

export function recentBillingEvents(userId, limit = 20) {
  return all('SELECT id, type, created_at FROM billing_events WHERE user_id = ? ORDER BY created_at DESC LIMIT ?', [userId, limit]);
}
