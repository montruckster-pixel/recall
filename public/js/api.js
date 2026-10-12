/** Thin API client. All requests are same-origin, cookie-authenticated. */

export class ApiError extends Error {
  constructor(status, message, code, meta) {
    super(message);
    this.status = status;
    this.code = code;
    this.meta = meta;
  }
}

async function request(method, path, body, opts = {}) {
  const init = { method, headers: {}, credentials: 'same-origin' };
  if (body instanceof FormData) {
    init.body = body;
  } else if (body !== undefined) {
    init.headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(body);
  }
  let res;
  try {
    res = await fetch(path, init);
  } catch (err) {
    throw new ApiError(0, 'Network error — check your connection and try again.', 'network');
  }
  if (opts.raw) return res;
  let data = null;
  const text = await res.text();
  if (text) { try { data = JSON.parse(text); } catch { data = { error: text }; } }
  if (!res.ok) {
    throw new ApiError(res.status, data?.error || `Request failed (${res.status})`, data?.code, data?.meta);
  }
  return data;
}

export const api = {
  get: (p) => request('GET', p),
  post: (p, b) => request('POST', p, b),
  put: (p, b) => request('PUT', p, b),
  del: (p, b) => request('DELETE', p, b),
  raw: (p) => request('GET', p, undefined, { raw: true }),
};

/** Query-string helper that omits empty values. */
export function qs(params = {}) {
  const usp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== '') usp.set(k, String(v));
  }
  const s = usp.toString();
  return s ? `?${s}` : '';
}
