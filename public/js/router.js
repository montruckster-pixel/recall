/** Hash-based router with path params and query parsing. */

const routes = [];
let notFoundHandler = null;
let current = { path: '', params: {}, query: {} };

export function route(pattern, handler) {
  const keys = [];
  const regex = new RegExp('^' + pattern.replace(/:[A-Za-z0-9_]+/g, (m) => { keys.push(m.slice(1)); return '([^/]+)'; }) + '$');
  routes.push({ pattern, regex, keys, handler });
}

export function setNotFound(handler) { notFoundHandler = handler; }

export function parseHash() {
  const raw = window.location.hash.replace(/^#/, '') || '/';
  const [pathPart, queryPart] = raw.split('?');
  const query = Object.fromEntries(new URLSearchParams(queryPart || ''));
  const path = pathPart.replace(/\/+$/, '') || '/';
  return { path, query };
}

export function navigate(to, { replace = false } = {}) {
  const target = `#${to.startsWith('/') ? to : `/${to}`}`;
  if (replace) window.history.replaceState(null, '', target);
  else window.location.hash = target;
  if (replace) handleRoute();
}

export function currentRoute() { return current; }

export function handleRoute() {
  const { path, query } = parseHash();
  for (const r of routes) {
    const m = path.match(r.regex);
    if (m) {
      const params = {};
      r.keys.forEach((k, i) => { params[k] = decodeURIComponent(m[i + 1]); });
      current = { path, params, query };
      r.handler({ params, query, path });
      return;
    }
  }
  current = { path, params: {}, query };
  notFoundHandler?.({ path, query });
}

export function startRouter() {
  window.addEventListener('hashchange', handleRoute);
  handleRoute();
}

export function linkTo(path) { return `#${path}`; }
