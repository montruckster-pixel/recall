import { h, icon, toast, esc, initials } from './ui.js';
import { api, ApiError } from './api.js';
import { route, setNotFound, startRouter, navigate, currentRoute } from './router.js';
import { getState, setState, applyTheme, subscribe } from './store.js';

import { renderLanding, renderPricing, renderLegal } from './views/public.js';
import { renderLogin, renderSignup, renderForgot, renderReset } from './views/auth.js';
import { renderOnboarding } from './views/onboarding.js';
import { renderDashboard } from './views/dashboard.js';
import { renderSets, renderSetDetail } from './views/sets.js';
import { renderStudy } from './views/study.js';
import { renderMaterials, renderMaterialDetail } from './views/materials.js';
import { renderQuizLibrary, renderQuizBuilder, renderQuizTake, renderResults } from './views/quiz.js';
import { renderPlanner } from './views/planner.js';
import { renderAnalytics } from './views/analytics.js';
import { renderSettings } from './views/settings.js';
import { renderBilling } from './views/billing.js';

const root = document.getElementById('app');
const AUTH_ROUTES = new Set(['/dashboard', '/sets', '/study', '/materials', '/quiz', '/planner', '/analytics', '/settings', '/billing', '/onboarding']);

// ---- Shell ----------------------------------------------------------------
let shell = null;

const NAV = [
  { section: 'Study' },
  { id: 'dashboard', label: 'Dashboard', icon: 'dashboard', path: '/dashboard' },
  { id: 'sets', label: 'My Study Sets', icon: 'sets', path: '/sets' },
  { id: 'study', label: 'Flashcards', icon: 'cards', path: '/study', badge: 'due' },
  { id: 'quiz', label: 'Practice Exams', icon: 'quiz', path: '/quiz' },
  { section: 'Plan' },
  { id: 'planner', label: 'Study Planner', icon: 'planner', path: '/planner' },
  { id: 'analytics', label: 'Progress Analytics', icon: 'analytics', path: '/analytics' },
  { section: 'Library' },
  { id: 'materials', label: 'Upload Materials', icon: 'upload', path: '/materials' },
  { section: 'Account' },
  { id: 'settings', label: 'Settings', icon: 'settings', path: '/settings' },
  { id: 'billing', label: 'Subscription & Billing', icon: 'billing', path: '/billing' },
];

function buildShell() {
  const nav = h('div', { class: 'sidebar__nav' });
  const planChip = h('div', { class: 'plan-chip' });
  const scrim = h('div', { class: 'scrim hidden', onClick: () => toggleSidebar(false) });
  const sidebar = h('aside', { class: 'sidebar', id: 'sidebar' }, [
    h('a', { class: 'sidebar__brand', href: '#/dashboard', style: 'text-decoration:none' }, [
      h('span', { class: 'sidebar__mark', html: 'R' }), h('span', { text: 'Recall' }),
    ]),
    nav,
    h('div', { class: 'sidebar__foot' }, planChip),
  ]);
  const topbarTitle = h('h1', { text: 'Dashboard' });
  const topbarSub = h('div', { class: 'topbar__sub' });
  const topbarActions = h('div', { class: 'topbar__actions' });
  const menuBtn = h('button', { class: 'btn btn--ghost btn--icon menu-btn', type: 'button', 'aria-label': 'Open navigation', html: icon('menu', 20), onClick: () => toggleSidebar(true) });
  const topbar = h('header', { class: 'topbar' }, [
    menuBtn,
    h('div', {}, [topbarTitle, topbarSub]),
    topbarActions,
  ]);
  const content = h('main', { class: 'content', id: 'main' });
  const main = h('div', { class: 'main' }, [topbar, content]);
  const shellNode = h('div', { class: 'shell' }, [sidebar, main]);
  root.innerHTML = '';
  root.append(scrim, shellNode);

  shell = { nav, planChip, topbarTitle, topbarSub, topbarActions, content, sidebar, scrim };
  paintNav();
  return shell;
}

function toggleSidebar(open) {
  shell?.sidebar.classList.toggle('is-open', open);
  shell?.scrim.classList.toggle('hidden', !open);
}

function paintNav() {
  const state = getState();
  const active = currentRoute().path;
  shell.nav.innerHTML = '';
  for (const item of NAV) {
    if (item.section) { shell.nav.append(h('div', { class: 'sidebar__group', text: item.section })); continue; }
    const isActive = active === item.path || active.startsWith(`${item.path}/`);
    const badge = item.badge === 'due' ? (state.dashboard?.dueCards || 0) : 0;
    shell.nav.append(h('a', {
      class: 'nav-item', href: `#${item.path}`, 'aria-current': isActive ? 'page' : null,
      onClick: () => toggleSidebar(false),
    }, [
      h('span', { html: icon(item.icon, 17) }),
      h('span', { text: item.label }),
      badge > 0 ? h('span', { class: 'nav-badge', text: String(badge > 99 ? '99+' : badge) }) : null,
    ]));
  }

  const ent = state.entitlements;
  const planName = ent?.plan?.name || 'Free';
  shell.planChip.innerHTML = '';
  shell.planChip.append(
    h('div', {}, [
      h('div', { class: 'tiny muted', text: 'Current plan' }),
      h('strong', { text: planName }),
    ]),
    planName === 'Recall Plus'
      ? h('button', { class: 'btn btn--sm', type: 'button', text: 'Manage', onClick: () => navigate('/billing') })
      : h('button', { class: 'btn btn--sm btn--primary', type: 'button', text: 'Upgrade', onClick: () => navigate('/billing') }),
  );
}

function setMeta({ title, subtitle, actions = [] }) {
  shell.topbarTitle.textContent = title;
  shell.topbarSub.textContent = subtitle || '';
  shell.topbarActions.innerHTML = '';
  for (const a of actions) shell.topbarActions.append(a);
}

/** Standard authenticated view mount with loading + error handling. */
async function mount(viewFn, meta) {
  if (!getState().user) { navigate('/login', { replace: true }); return; }
  if (!shell) buildShell();
  paintNav();
  setMeta(meta || { title: '' });
  const holder = h('div', {}, [loadingBlock()]);
  shell.content.innerHTML = '';
  shell.content.append(holder);
  try {
    const node = await viewFn({ setMeta, refresh: () => mount(viewFn, meta) });
    holder.innerHTML = '';
    if (node) holder.append(node);
    holder.animate?.([{ opacity: 0 }, { opacity: 1 }], { duration: 200 });
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) {
      setState({ user: null });
      navigate('/login', { replace: true });
      return;
    }
    holder.innerHTML = '';
    holder.append(h('div', { class: 'card' }, [
      h('div', { class: 'alert alert--error' }, [h('span', { html: icon('alert', 16) }), h('span', { text: err.message || 'Could not load this page.' })]),
      h('button', { class: 'btn mt-2', type: 'button', text: 'Retry', onClick: () => mount(viewFn, meta) }),
    ]));
  }
}

function loadingBlock() {
  return h('div', { class: 'grid grid--3' }, Array.from({ length: 3 }, () => h('div', { class: 'card' }, [
    h('div', { class: 'skeleton skeleton--text', style: 'width:60%' }),
    h('div', { class: 'skeleton', style: 'height:70px' }),
  ])));
}

// ---- Public rendering -----------------------------------------------------
function renderPublic(node) {
  root.innerHTML = '';
  root.append(node);
  shell = null;
  document.getElementById('modal-region').hidden = true;
}

/**
 * The SPA is hash-routed, but links arriving from outside the app (password
 * reset emails, shared URLs) are usually path-based. Normalise those to hash
 * routes before the first render so they resolve instead of showing the
 * landing page.
 */
function normalizeDeepLink() {
  if (window.location.hash) return;
  const { pathname, search } = window.location;
  if (!pathname || pathname === '/' || /\.[A-Za-z0-9]+$/.test(pathname)) return;
  window.history.replaceState(null, '', `/#${pathname}${search}`);
}

// ---- Session bootstrap ----------------------------------------------------
async function bootstrap() {
  normalizeDeepLink();
  try {
    const { user } = await api.get('/api/auth/me');
    setState({ user });
  } catch {
    setState({ user: null });
  }
  const state = getState();
  if (state.user) {
    try {
      const [profile, certs, plans] = await Promise.all([
        api.get('/api/profile'),
        api.get('/api/certifications'),
        api.get('/api/billing/plans'),
      ]);
      setState({
        profile: profile.profile,
        settings: profile.settings,
        certs: certs.categories,
        plans: plans.config.plans,
      });
      applyTheme();
    } catch { /* non-fatal */ }
  } else {
    try {
      const plans = await api.get('/api/billing/plans');
      setState({ plans: plans.config.plans });
    } catch { /* non-fatal */ }
  }
  registerRoutes();
  startRouter();
  subscribe(() => { if (shell) paintNav(); });
}

function requireAuthOrRedirect(fn) {
  return (...args) => {
    if (!getState().user) { navigate('/login', { replace: true }); return; }
    return fn(...args);
  };
}

function registerRoutes() {
  route('/', () => {
    if (getState().user) { navigate('/dashboard', { replace: true }); return; }
    renderPublic(renderLanding());
  });
  route('/pricing', () => renderPublic(renderPricing()));
  route('/privacy', () => renderPublic(renderLegal('privacy')));
  route('/terms', () => renderPublic(renderLegal('terms')));

  route('/login', () => {
    if (getState().user) { navigate('/dashboard', { replace: true }); return; }
    renderPublic(renderLogin());
  });
  route('/signup', () => {
    if (getState().user) { navigate('/dashboard', { replace: true }); return; }
    renderPublic(renderSignup());
  });
  route('/forgot-password', () => renderPublic(renderForgot()));
  route('/reset-password', ({ query }) => renderPublic(renderReset(query.token)));

  route('/onboarding', () => {
    if (!getState().user) { navigate('/login', { replace: true }); return; }
    // Async: certifications may need to be fetched first.
    renderOnboarding().then(renderPublic).catch((err) => {
      renderPublic(h('div', { class: 'auth-shell' }, [h('div', { class: 'auth-card' }, [
        h('h1', { text: 'Could not load onboarding' }),
        h('p', { text: err.message || 'Please try again.' }),
        h('a', { class: 'btn btn--primary', href: '#/dashboard', text: 'Go to dashboard' }),
      ])]));
    });
  });

  route('/dashboard', requireAuthOrRedirect(() => mount(renderDashboard, { title: 'Dashboard' })));
  route('/sets', requireAuthOrRedirect(() => mount(renderSets, { title: 'My Study Sets' })));
  route('/sets/:id', requireAuthOrRedirect((ctx) => mount((opts) => renderSetDetail({ ...ctx, ...opts }), { title: 'Study set' })));
  route('/study', requireAuthOrRedirect((ctx) => mount((opts) => renderStudy({ ...ctx, ...opts }), { title: 'Flashcard review' })));
  route('/study/:setId', requireAuthOrRedirect((ctx) => mount((opts) => renderStudy({ ...ctx, ...opts }), { title: 'Flashcard review' })));
  route('/materials', requireAuthOrRedirect(() => mount(renderMaterials, { title: 'Upload Materials' })));
  route('/materials/:id', requireAuthOrRedirect((ctx) => mount((opts) => renderMaterialDetail({ ...ctx, ...opts }), { title: 'Material' })));
  route('/quiz', requireAuthOrRedirect(() => mount(renderQuizLibrary, { title: 'Practice Exams' })));
  route('/quiz/new', requireAuthOrRedirect((ctx) => mount((opts) => renderQuizBuilder({ ...ctx, ...opts }), { title: 'Build a quiz' })));
  route('/quiz/:id/take', requireAuthOrRedirect((ctx) => mount((opts) => renderQuizTake({ ...ctx, ...opts }), { title: 'Practice' })));
  route('/quiz/:id', requireAuthOrRedirect((ctx) => mount((opts) => renderQuizLibrary({ ...ctx, ...opts }), { title: 'Practice Exams' })));
  route('/results/:attemptId', requireAuthOrRedirect((ctx) => mount((opts) => renderResults({ ...ctx, ...opts }), { title: 'Results' })));
  route('/planner', requireAuthOrRedirect(() => mount(renderPlanner, { title: 'Study Planner' })));
  route('/analytics', requireAuthOrRedirect(() => mount(renderAnalytics, { title: 'Progress Analytics' })));
  route('/settings', requireAuthOrRedirect(() => mount(renderSettings, { title: 'Settings' })));
  route('/billing', requireAuthOrRedirect((ctx) => mount((opts) => renderBilling({ ...ctx, ...opts }), { title: 'Subscription & Billing' })));

  setNotFound(() => {
    renderPublic(h('div', { class: 'public' }, [
      h('section', { class: 'section', style: 'text-align:center' }, [
        h('h1', { text: 'Page not found' }),
        h('p', { class: 'lead', text: `We could not find ${esc(currentRoute().path)}.` }),
        h('a', { class: 'btn btn--primary', href: getState().user ? '#/dashboard' : '#/', text: getState().user ? 'Back to dashboard' : 'Back home' }),
      ]),
    ]));
  });
}

bootstrap();

export { mount, setMeta };
