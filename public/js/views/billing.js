import { h, icon, toast, modal, confirmDialog, badgeFor, fmtDate, pct, esc } from '../ui.js';
import { api } from '../api.js';
import { navigate } from '../router.js';
import { getState, setState } from '../store.js';

export async function renderBilling({ query = {}, setMeta }) {
  let data = await api.get('/api/billing');
  const { config, entitlements } = data;

  // Returning from Stripe checkout: verify server-side.
  if (query.session_id) {
    try {
      await api.get(`/api/billing/confirm?session_id=${encodeURIComponent(query.session_id)}`);
      toast('Payment confirmed — your plan is now active.', 'success');
      data = await api.get('/api/billing');
      setState({ entitlements: data.entitlements });
    } catch (err) {
      toast(`We could not confirm that checkout: ${err.message}`, 'error');
    }
  }
  if (query.status === 'cancelled') toast('Checkout cancelled — no charge was made.', 'info');

  setMeta({ title: 'Subscription & Billing', subtitle: config.configured ? `Billing via Stripe (${config.mode === 'payment_link' ? 'payment link' : 'checkout'})` : 'Billing not configured yet' });

  const wrap = h('div', { class: 'stack stack--lg' });
  wrap.append(currentPlanCard(data.entitlements));
  wrap.append(usageCard(data.entitlements));
  if (!config.configured) wrap.append(setupCard(config));
  wrap.append(plansCard(config, data.entitlements, async () => {
    data = await api.get('/api/billing');
    setState({ entitlements: data.entitlements });
    navigate('/billing', { replace: true });
  }));
  if (data.events?.length) wrap.append(eventsCard(data.events));
  return wrap;
}

function currentPlanCard(ent) {
  const sub = ent.subscription;
  return h('div', { class: 'card card--pad-lg' }, [
    h('div', { class: 'row row--between' }, [
      h('div', {}, [
        h('div', { class: 'tiny muted', text: 'Current plan' }),
        h('h2', { class: 'mb-0', text: ent.plan.name }),
      ]),
      h('span', { html: badgeFor(sub?.status || 'active') }),
    ]),
    h('div', { class: 'kv mt-2' }, [
      h('dt', { text: 'Billing interval' }), h('dd', { text: sub?.interval === 'annual' ? 'Annual' : sub?.interval === 'monthly' ? 'Monthly' : '—' }),
      h('dt', { text: 'Renews / ends' }), h('dd', { text: sub?.currentPeriodEnd ? fmtDate(sub.currentPeriodEnd) : '—' }),
      h('dt', { text: 'Cancellation' }), h('dd', { text: sub?.cancelAtPeriodEnd ? 'Cancels at period end' : 'Renews automatically' }),
    ]),
    ent.planId === 'free' ? h('p', { class: 'small muted mt-2 mb-0', text: 'You are on the free plan. Upgrade any time — your existing study data is kept.' }) : null,
    h('div', { class: 'row row--wrap mt-2' }, [
      sub?.stripeCustomerId ? h('button', { class: 'btn', type: 'button', text: 'Open billing portal', onClick: async (e) => {
        e.currentTarget.disabled = true;
        try {
          const r = await api.post('/api/billing/portal', {});
          window.location.href = r.url;
        } catch (err) { toast(err.message, 'error'); e.currentTarget.disabled = false; }
      } }) : null,
      ent.planId === 'plus' && !sub?.cancelAtPeriodEnd ? h('button', { class: 'btn btn--danger', type: 'button', text: 'Cancel subscription', onClick: async () => {
        const ok = await confirmDialog({
          title: 'Cancel subscription?',
          message: 'You will keep Plus access until the end of the period you already paid for. After that your account returns to the free plan and your study data is kept.',
          confirmLabel: 'Cancel subscription', danger: true,
        });
        if (!ok) return;
        try {
          const r = await api.post('/api/billing/cancel', {});
          setState({ entitlements: r.entitlements });
          toast('Subscription set to cancel at period end.', 'success');
          navigate('/billing', { replace: true });
        } catch (err) { toast(err.message, 'error'); }
      } }) : null,
      ent.planId === 'plus' && sub?.cancelAtPeriodEnd ? h('button', { class: 'btn btn--primary', type: 'button', text: 'Resume subscription', onClick: async () => {
        try {
          const r = await api.post('/api/billing/resume', {});
          setState({ entitlements: r.entitlements });
          toast('Subscription resumed.', 'success');
          navigate('/billing', { replace: true });
        } catch (err) { toast(err.message, 'error'); }
      } }) : null,
    ]),
  ]);
}

function usageCard(ent) {
  const rows = [
    ['Workspaces', ent.usage.workspaces, ent.limits.maxWorkspaces],
    ['Study sets', ent.usage.studySets, ent.limits.maxStudySets],
    ['Flashcards', ent.usage.flashcards, ent.limits.maxFlashcards],
    ['AI credits this month', ent.usage.aiCredits, ent.limits.aiCreditsPerMonth],
    ['Practice exams this month', ent.usage.practiceExams, ent.limits.practiceExamsPerMonth],
  ];
  return h('div', { class: 'card card--pad-lg' }, [
    h('h2', { text: 'Plan usage' }),
    h('p', { class: 'small muted', text: 'Limits are enforced on the server, not just in the interface.' }),
    ...rows.map(([label, used, limit]) => {
      const unlimited = limit === Infinity || limit === null;
      const p = unlimited ? 0 : Math.min(1, used / limit);
      return h('div', { class: 'mb-2' }, [
        h('div', { class: 'row row--between small' }, [
          h('span', { class: 'muted', text: label }),
          h('span', { text: unlimited ? `${used} / unlimited` : `${used} / ${limit}` }),
        ]),
        h('div', { class: 'progress mt-1' }, [h('span', { class: p >= 1 ? 'progress--warning' : '', style: `width:${(p * 100).toFixed(1)}%` })]),
      ]);
    }),
    ent.limits.advancedAnalytics ? null : h('p', { class: 'tiny muted mb-0', text: 'Advanced analytics and weak-topic analysis are not included in the free plan.' }),
  ]);
}

function setupCard(config) {
  return h('div', { class: 'card card--pad-lg' }, [
    h('h2', { text: 'Billing is not configured yet' }),
    h('p', { class: 'small muted', text: config.message }),
    h('div', { class: 'stack stack--sm' }, [
      h('div', { class: 'small strong', text: 'Option A — Stripe Payment Links (recommended to start)' }),
      h('pre', { style: 'background:var(--surface-2);padding:12px;border-radius:8px;border:1px solid var(--border);overflow:auto', text: 'STRIPE_PAYMENT_LINK_MONTHLY=https://buy.stripe.com/...\nSTRIPE_PAYMENT_LINK_ANNUAL=https://buy.stripe.com/...\nSTRIPE_WEBHOOK_SECRET=whsec_...\nAPP_BASE_URL=https://your-domain.example' }),
      h('div', { class: 'small muted', text: 'Create the links in Stripe, then add these environment variables. Recall appends your account id to each link so the purchase can be attributed, and activates Plus from the signature-verified webhook.' }),
      h('div', { class: 'small strong mt-1', text: 'Option B — Stripe Checkout with price IDs' }),
      h('pre', { style: 'background:var(--surface-2);padding:12px;border-radius:8px;border:1px solid var(--border);overflow:auto', text: 'STRIPE_SECRET_KEY=sk_live_...\nSTRIPE_PRICE_PLUS_MONTHLY=price_...\nSTRIPE_PRICE_PLUS_ANNUAL=price_...\nSTRIPE_WEBHOOK_SECRET=whsec_...' }),
      h('div', { class: 'small muted', text: 'Point a Stripe webhook at POST /api/billing/webhook for checkout.session.completed, customer.subscription.* and invoice.* events.' }),
    ]),
    h('p', { class: 'tiny muted mt-2 mb-0', text: 'Premium access is only ever granted server-side from a verified Stripe event or a Checkout Session re-fetched with your secret key. The client can never grant itself access.' }),
  ]);
}

function plansCard(config, ent, onChange) {
  let interval = 'monthly';
  const card = h('div', { class: 'card card--pad-lg' }, [h('h2', { text: 'Choose a plan' })]);
  const toggle = h('div', { class: 'pill-nav mb-2' }, [
    h('button', { class: 'chip', type: 'button', 'aria-pressed': 'true', text: 'Monthly', onClick: (e) => { interval = 'monthly'; syncToggle(e); paint(); } }),
    h('button', { class: 'chip', type: 'button', 'aria-pressed': 'false', text: 'Annual (save ~33%)', onClick: (e) => { interval = 'annual'; syncToggle(e); paint(); } }),
  ]);
  function syncToggle(e) {
    for (const b of toggle.querySelectorAll('.chip')) b.setAttribute('aria-pressed', 'false');
    e.currentTarget.setAttribute('aria-pressed', 'true');
  }
  const grid = h('div', { class: 'grid grid--2' });
  function paint() {
    grid.innerHTML = '';
    const plus = config.plans.plus;
    const free = config.plans.free;
    const price = interval === 'annual' ? plus.priceAnnual / 12 : plus.priceMonthly;
    const isPlus = ent.planId === 'plus';

    grid.append(h('div', { class: 'price-card' }, [
      h('h3', { text: free.name }),
      h('div', { class: 'price-amount', text: '$0' }),
      h('p', { class: 'tiny muted', text: 'forever' }),
      h('ul', { class: 'price-list' }, free.features.map((f) => h('li', {}, [h('span', { html: icon('check', 15) }), h('span', { text: f })]))),
      h('div', { class: 'mt-3' }, [h('button', { class: 'btn btn--block', type: 'button', text: isPlus ? 'Downgrade to Free' : 'Current plan', disabled: !isPlus, onClick: () => cancelToFree() })]),
    ]));

    grid.append(h('div', { class: 'price-card price-card--featured' }, [
      h('div', { class: 'row row--between' }, [h('h3', { class: 'mb-0', text: plus.name }), h('span', { class: 'badge badge--accent', text: 'Most popular' })]),
      h('div', { class: 'mt-1' }, [
        h('span', { class: 'price-amount', text: `$${price.toFixed(2)}` }),
        h('span', { class: 'muted', text: ' / month' }),
      ]),
      h('p', { class: 'tiny muted', text: interval === 'annual' ? `Billed annually at $${plus.priceAnnual.toFixed(2)} per year` : 'Billed monthly' }),
      h('ul', { class: 'price-list' }, plus.features.map((f) => h('li', {}, [h('span', { html: icon('check', 15) }), h('span', { text: f })]))),
      h('div', { class: 'mt-3' }, [h('button', {
        class: 'btn btn--primary btn--block', type: 'button',
        text: isPlus ? 'Current plan' : 'Upgrade to Plus', disabled: isPlus,
        onClick: () => upgrade(interval, onChange),
      })]),
      config.annualNote ? h('p', { class: 'tiny muted mt-1', text: config.annualNote }) : null,
    ]));
  }

  async function upgrade(iv, done) {
    try {
      const r = await api.post('/api/billing/checkout', { interval: iv });
      if (r.url) {
        window.location.href = r.url;
      }
    } catch (err) {
      if (err.code === 'billing_not_configured' || err.status === 503) {
        toast(err.message, 'error');
        if (config.mode === 'none') {
          const ok = await confirmDialog({
            title: 'Billing is not configured',
            message: 'Stripe is not set up yet. Do you want to open the setup instructions? No charge can be made until Stripe is configured.',
            confirmLabel: 'Show setup',
          });
          if (ok) modal({ title: 'Stripe setup', body: setupCard(config), actions: [{ label: 'Close' }] });
        }
      } else {
        toast(err.message, 'error');
      }
    }
  }

  async function cancelToFree() {
    const ok = await confirmDialog({ title: 'Downgrade to Free?', message: 'Your plan will end at the end of the current period. Study data is kept.', confirmLabel: 'Downgrade', danger: true });
    if (!ok) return;
    try {
      const r = await api.post('/api/billing/cancel', {});
      setState({ entitlements: r.entitlements });
      toast('Downgrade scheduled for the end of the period.', 'success');
      onChange();
    } catch (err) { toast(err.message, 'error'); }
  }

  paint();
  card.append(toggle, grid);
  if (config.mode === 'none') {
    card.append(h('div', { class: 'mt-2' }, [
      h('button', { class: 'btn btn--sm', type: 'button', text: 'Developer: activate Plus locally', onClick: async () => {
        try {
          const r = await api.post('/api/billing/dev-activate', { plan: 'plus', interval: 'monthly' });
          setState({ entitlements: r.entitlements });
          toast('Development plan activated (no payment). Not available in production.', 'info');
          onChange();
        } catch (err) { toast(err.message, 'error'); }
      } }),
      h('span', { class: 'tiny muted ml-1', text: 'Only works when RECALL_ALLOW_DEV_UPGRADE=1.' }),
    ]));
  }
  return card;
}

function eventsCard(events) {
  return h('div', { class: 'card card--pad-lg' }, [
    h('h2', { text: 'Billing history' }),
    h('div', { class: 'table-wrap' }, [
      h('table', {}, [
        h('thead', {}, [h('tr', {}, [h('th', { text: 'Event' }), h('th', { text: 'Date' })])]),
        h('tbody', {}, events.map((e) => h('tr', {}, [
          h('td', { text: e.type }),
          h('td', { text: fmtDate(e.created_at) }),
        ]))),
      ]),
    ]),
  ]);
}
