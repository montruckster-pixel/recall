/** App state store with a tiny pub/sub. */

const state = {
  user: null,
  profile: null,
  settings: { theme: 'system', reducedMotion: false },
  entitlements: null,
  dashboard: null,
  certs: null,
  route: null,
};

const listeners = new Set();

export function getState() { return state; }

export function setState(patch) {
  Object.assign(state, patch);
  for (const fn of listeners) fn(state);
}

export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function applyTheme() {
  const pref = state.settings?.theme || 'system';
  const dark = pref === 'dark'
    || (pref === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  if (state.settings?.reducedMotion) document.documentElement.dataset.motion = 'reduced';
  else delete document.documentElement.dataset.motion;
}

window.matchMedia?.('(prefers-color-scheme: dark)').addEventListener?.('change', () => {
  if ((state.settings?.theme || 'system') === 'system') applyTheme();
});
