/** UI kit: DOM helpers, icons, formatting, toasts, modals, charts. */

export function h(tag, attrs = {}, children = []) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'html') el.innerHTML = v;
    else if (k === 'text') el.textContent = v;
    // DOM event props (onClick, onChange, …) map to lowercase event names.
    else if (/^on[A-Z]/.test(k) && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (v === true) el.setAttribute(k, '');
    else el.setAttribute(k, String(v));
  }
  for (const c of [].concat(children)) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

export function fromHtml(htmlString) {
  const t = document.createElement('template');
  t.innerHTML = htmlString.trim();
  return t.content;
}

export function frag(...nodes) {
  const f = document.createDocumentFragment();
  for (const n of nodes.flat()) {
    if (n === null || n === undefined || n === false) continue;
    f.append(n instanceof Node ? n : document.createTextNode(String(n)));
  }
  return f;
}

export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// ---- Icons (inline SVG, no external requests) -----------------------------
const ICONS = {
  dashboard: '<path d="M3 13h8V3H3v10Zm0 8h8v-6H3v6Zm10 0h8V11h-8v10Zm0-18v6h8V3h-8Z"/>',
  sets: '<path d="M4 5a2 2 0 0 1 2-2h4l2 2h6a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V5Z"/>',
  cards: '<path d="M6 3h9a2 2 0 0 1 2 2v12H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Zm11 2h2a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H8"/>',
  quiz: '<path d="M9 3h6a2 2 0 0 1 2 2v14l-5-3-5 3V5a2 2 0 0 1 2-2Z"/>',
  planner: '<path d="M7 2v3M17 2v3M3 8h18M5 5h14a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2Z"/>',
  analytics: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
  upload: '<path d="M12 16V4m0 0L7 9m5-5 5 5M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2"/>',
  settings: '<path d="M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-2.9 1.2V21a2 2 0 1 1-4 0v-.1A1.7 1.7 0 0 0 7 19.4a1.7 1.7 0 0 0-1.9.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0-1.2-2.9H1a2 2 0 1 1 0-4h.1A1.7 1.7 0 0 0 2.6 7a1.7 1.7 0 0 0-.3-1.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.9.3H7a1.7 1.7 0 0 0 1-1.5V1a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.9-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.9V7a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z"/>',
  billing: '<path d="M2 6h20v12H2zM2 10h20"/>',
  check: '<path d="m4 12 5 5L20 6"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
  trash: '<path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14"/>',
  edit: '<path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/>',
  star: '<path d="m12 2 3.1 6.3 6.9 1-5 4.9 1.2 6.8L12 17.8 5.8 21l1.2-6.8-5-4.9 6.9-1L12 2Z"/>',
  back: '<path d="M15 18l-6-6 6-6"/>',
  next: '<path d="M9 18l6-6-6-6"/>',
  shuffle: '<path d="M16 3h5v5M4 20 21 3M21 16v5h-5M15 15l6 6M4 4l5 5"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  alert: '<path d="M12 9v4m0 4h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z"/>',
  close: '<path d="M18 6 6 18M6 6l12 12"/>',
  play: '<path d="M6 4l14 8-14 8V4Z"/>',
  menu: '<path d="M3 6h18M3 12h18M3 18h18"/>',
  download: '<path d="M12 3v12m0 0 5-5m-5 5-5-5M4 21h16"/>',
};

export function icon(name, size = 18) {
  return `<svg class="icon" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none"
    stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"
    aria-hidden="true">${ICONS[name] || ''}</svg>`;
}

// ---- Formatting -----------------------------------------------------------
export function fmtDate(iso, opts = {}) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric', ...opts });
}
export function fmtDateTime(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}
export function fmtRelative(iso) {
  if (!iso) return '—';
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.round(diff / 60000);
  if (Math.abs(mins) < 1) return 'just now';
  if (Math.abs(mins) < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (Math.abs(hrs) < 24) return `${hrs}h ago`;
  const days = Math.round(hrs / 24);
  if (Math.abs(days) < 30) return `${days}d ago`;
  return fmtDate(iso);
}
export function fmtDuration(seconds) {
  const s = Math.max(0, Math.round(seconds || 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h) return `${h}h ${m}m`;
  if (m) return `${m}m`;
  return `${s}s`;
}
export function fmtClock(seconds) {
  const s = Math.max(0, Math.round(seconds || 0));
  const m = Math.floor(s / 60);
  const sec = s % 60;
  const h = Math.floor(m / 60);
  if (h) return `${h}:${String(m % 60).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
  return `${m}:${String(sec).padStart(2, '0')}`;
}
export function pct(n, digits = 0) {
  if (n === null || n === undefined || Number.isNaN(n)) return '—';
  return `${(n * 100).toFixed(digits)}%`;
}
export function plural(n, one, many) {
  return `${n} ${n === 1 ? one : (many || `${one}s`)}`;
}
export function dueLabel(iso) {
  if (!iso) return '—';
  const ms = new Date(iso).getTime() - Date.now();
  if (ms <= 0) return 'due now';
  const mins = ms / 60000;
  if (mins < 60) return `in ${Math.round(mins)}m`;
  const hrs = mins / 60;
  if (hrs < 24) return `in ${Math.round(hrs)}h`;
  const days = hrs / 24;
  if (days < 30) return `in ${Math.round(days)}d`;
  const months = days / 30.4;
  if (months < 12) return `in ${months.toFixed(1)}mo`;
  return `in ${(days / 365).toFixed(1)}y`;
}
export function initials(name = '') {
  return name.trim().split(/\s+/).slice(0, 2).map((p) => p[0]?.toUpperCase() || '').join('') || 'U';
}

// ---- Toasts ---------------------------------------------------------------
export function toast(message, kind = 'info', timeout = 4200) {
  const region = document.getElementById('toast-region');
  const node = h('div', { class: `toast toast--${kind}`, role: 'status' }, [
    h('span', { html: icon(kind === 'error' ? 'alert' : 'check', 16) }),
    h('span', { text: message }),
  ]);
  region.append(node);
  setTimeout(() => {
    node.style.transition = 'opacity 200ms, transform 200ms';
    node.style.opacity = '0';
    node.style.transform = 'translateX(20px)';
    setTimeout(() => node.remove(), 220);
  }, timeout);
}

// ---- Modal ----------------------------------------------------------------
export function modal({ title, body, actions = [], wide = false, onClose }) {
  const region = document.getElementById('modal-region');
  const close = () => {
    region.hidden = true;
    region.innerHTML = '';
    document.removeEventListener('keydown', onKey);
    onClose?.();
  };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  const foot = actions.length ? h('div', { class: 'modal__foot' }, actions.map((a) => h('button', {
    class: `btn ${a.variant === 'primary' ? 'btn--primary' : a.variant === 'danger' ? 'btn--danger' : ''}`,
    type: 'button',
    onClick: async () => {
      if (a.onClick) {
        const result = await a.onClick();
        if (result === false) return;
      }
      if (a.keepOpen !== true) close();
    },
  }, a.label))) : null;

  const node = h('div', { class: `modal ${wide ? 'modal--wide' : ''}`, role: 'dialog', 'aria-modal': 'true', 'aria-label': title }, [
    h('div', { class: 'modal__head' }, [
      h('h2', { text: title }),
      h('button', { class: 'btn btn--ghost btn--icon ml-auto', type: 'button', 'aria-label': 'Close', html: icon('close', 18), onClick: close }),
    ]),
    h('div', { class: 'modal__body' }, [body instanceof Node ? body : fromHtml(String(body))]),
    foot,
  ]);
  region.innerHTML = '';
  region.append(node);
  region.hidden = false;
  document.addEventListener('keydown', onKey);
  const first = node.querySelector('input, textarea, select, button');
  first?.focus();
  return { close, node };
}

export function confirmDialog({ title, message, confirmLabel = 'Confirm', danger = false }) {
  return new Promise((resolve) => {
    modal({
      title,
      body: h('p', { text: message }),
      actions: [
        { label: 'Cancel', onClick: () => resolve(false) },
        { label: confirmLabel, variant: danger ? 'danger' : 'primary', onClick: () => resolve(true) },
      ],
      onClose: () => resolve(false),
    });
  });
}

export function promptDialog({ title, label, value = '', placeholder = '', confirmLabel = 'Save', multiline = false }) {
  return new Promise((resolve) => {
    const input = multiline
      ? h('textarea', { placeholder, value })
      : h('input', { type: 'text', placeholder, value });
    const body = h('div', {}, [h('div', { class: 'field' }, [h('label', { text: label }), input])]);
    modal({
      title,
      body,
      actions: [
        { label: 'Cancel', onClick: () => resolve(null) },
        { label: confirmLabel, variant: 'primary', onClick: () => resolve(input.value.trim()) },
      ],
      onClose: () => resolve(null),
    });
    setTimeout(() => input.focus(), 30);
  });
}

// ---- Loading / empty / error ---------------------------------------------
export function skeleton(lines = 3, card = false) {
  if (card) return h('div', { class: 'skeleton skeleton--card' });
  return h('div', {}, Array.from({ length: lines }, (_, i) => h('div', {
    class: 'skeleton skeleton--text',
    style: `width:${[92, 78, 60][i % 3]}%`,
  })));
}

export function emptyState({ icon: ic = 'cards', title, message, action }) {
  return h('div', { class: 'empty' }, [
    h('div', { class: 'empty__icon', html: icon(ic, 30) }),
    h('h3', { text: title }),
    h('p', { text: message }),
    action || null,
  ]);
}

export function errorState(message, onRetry) {
  return h('div', { class: 'alert alert--error' }, [
    h('span', { html: icon('alert', 16) }),
    h('div', { class: 'stack stack--sm' }, [
      h('span', { text: message }),
      onRetry ? h('button', { class: 'btn btn--sm', type: 'button', text: 'Try again', onClick: onRetry }) : null,
    ]),
  ]);
}

export function badgeFor(status) {
  const map = {
    uploaded: ['badge--info', 'Uploaded'],
    extracting: ['badge--warning', 'Extracting'],
    extracted: ['badge--info', 'Extracted'],
    processing: ['badge--warning', 'Processing'],
    generating: ['badge--warning', 'Generating'],
    ready: ['badge--success', 'Ready'],
    failed: ['badge--danger', 'Failed'],
    draft: ['badge--warning', 'Draft'],
    committed: ['badge--success', 'Saved'],
    pending: ['badge--info', 'To do'],
    done: ['badge--success', 'Done'],
    skipped: ['badge', 'Skipped'],
    missed: ['badge--danger', 'Missed'],
    rescheduled: ['badge--warning', 'Moved'],
    open: ['badge', 'Open'],
    rest: ['badge', 'Rest day'],
    complete: ['badge--success', 'Complete'],
    new: ['badge--info', 'New'],
    learning: ['badge--warning', 'Learning'],
    review: ['badge--success', 'Review'],
    relearning: ['badge--warning', 'Relearning'],
    active: ['badge--success', 'Active'],
    past_due: ['badge--danger', 'Past due'],
    canceled: ['badge', 'Canceled'],
    trialing: ['badge--info', 'Trial'],
  };
  const [cls, label] = map[status] || ['badge', status || '—'];
  return `<span class="badge ${cls}">${esc(label)}</span>`;
}

// ---- Charts (dependency-free SVG) ----------------------------------------
export function lineChart({ series = [], labels = [], height = 170, color = 'var(--accent)', fill = true, yFormat = (v) => v }) {
  const w = 640;
  const hgt = height;
  const pad = { l: 40, r: 12, t: 12, b: 22 };
  const max = Math.max(1, ...series);
  const n = series.length;
  const x = (i) => pad.l + (n <= 1 ? 0 : (i * (w - pad.l - pad.r)) / (n - 1));
  const y = (v) => pad.t + (1 - v / max) * (hgt - pad.t - pad.b);
  const pts = series.map((v, i) => [x(i), y(v)]);
  const line = pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ');
  const area = `${line} L${x(n - 1).toFixed(1)},${y(0)} L${x(0).toFixed(1)},${y(0)} Z`;
  const gridLines = [0, 0.5, 1].map((f) => {
    const yy = pad.t + f * (hgt - pad.t - pad.b);
    return `<line x1="${pad.l}" y1="${yy}" x2="${w - pad.r}" y2="${yy}" stroke="var(--border)" stroke-width="1"/>
      <text x="${pad.l - 6}" y="${yy + 4}" text-anchor="end" font-size="10" fill="var(--muted)">${esc(yFormat(max * (1 - f)))}</text>`;
  }).join('');
  const labelEls = labels.map((l, i) => (i % Math.ceil(n / 6) === 0
    ? `<text x="${x(i)}" y="${hgt - 6}" text-anchor="middle" font-size="10" fill="var(--muted)">${esc(l)}</text>` : '')).join('');
  const dots = pts.map((p) => `<circle cx="${p[0].toFixed(1)}" cy="${p[1].toFixed(1)}" r="2.6" fill="${color}"/>`).join('');
  return `<svg class="chart" viewBox="0 0 ${w} ${hgt}" preserveAspectRatio="none" role="img" aria-label="Line chart">
    ${gridLines}
    ${fill ? `<path d="${area}" fill="${color}" opacity="0.10"/>` : ''}
    <path d="${line}" fill="none" stroke="${color}" stroke-width="2.2" stroke-linejoin="round" stroke-linecap="round"/>
    ${dots}${labelEls}
  </svg>`;
}

export function barChart({ series = [], labels = [], height = 170, color = 'var(--accent)' }) {
  const w = 640; const hgt = height;
  const pad = { l: 40, r: 12, t: 12, b: 22 };
  const max = Math.max(1, ...series);
  const n = series.length || 1;
  const bw = (w - pad.l - pad.r) / n;
  const bars = series.map((v, i) => {
    const bh = (v / max) * (hgt - pad.t - pad.b);
    const x = pad.l + i * bw + bw * 0.15;
    const yy = hgt - pad.b - bh;
    return `<rect x="${x.toFixed(1)}" y="${yy.toFixed(1)}" width="${(bw * 0.7).toFixed(1)}" height="${Math.max(0, bh).toFixed(1)}" rx="3" fill="${color}" opacity="0.85"/>`;
  }).join('');
  const gridLines = [0, 0.5, 1].map((f) => {
    const yy = pad.t + f * (hgt - pad.t - pad.b);
    return `<line x1="${pad.l}" y1="${yy}" x2="${w - pad.r}" y2="${yy}" stroke="var(--border)"/><text x="${pad.l - 6}" y="${yy + 4}" text-anchor="end" font-size="10" fill="var(--muted)">${Math.round(max * (1 - f))}</text>`;
  }).join('');
  const labelEls = labels.map((l, i) => (i % Math.ceil(n / 8) === 0
    ? `<text x="${(pad.l + i * bw + bw / 2).toFixed(1)}" y="${hgt - 6}" text-anchor="middle" font-size="10" fill="var(--muted)">${esc(l)}</text>` : '')).join('');
  return `<svg class="chart" viewBox="0 0 ${w} ${hgt}" preserveAspectRatio="none" role="img" aria-label="Bar chart">${gridLines}${bars}${labelEls}</svg>`;
}

export function heatmap(days = []) {
  const max = Math.max(1, ...days.map((d) => d.cardsReviewed + d.questionsAnswered));
  const cells = days.map((d) => {
    const v = (d.cardsReviewed + d.questionsAnswered) / max;
    const level = v === 0 ? 0 : v < 0.25 ? 1 : v < 0.5 ? 2 : v < 0.75 ? 3 : 4;
    const colors = ['color-mix(in srgb, var(--text) 7%, transparent)', 'color-mix(in srgb, var(--accent) 25%, transparent)', 'color-mix(in srgb, var(--accent) 45%, transparent)', 'color-mix(in srgb, var(--accent) 70%, transparent)', 'var(--accent)'];
    return `<span title="${esc(d.date)}: ${d.cardsReviewed} cards, ${d.questionsAnswered} questions" style="background:${colors[level]}"></span>`;
  }).join('');
  return `<div class="heat" role="img" aria-label="Study consistency heatmap">${cells}</div>`;
}

export function topicBars(rows = [], { color = 'var(--accent)' } = {}) {
  if (!rows.length) return '';
  return rows.map((r) => `
    <div class="bar-row">
      <span class="truncate" title="${esc(r.topic)}">${esc(r.topic)}</span>
      <span class="bar-track"><span class="bar-fill" style="width:${(r.accuracy * 100).toFixed(1)}%;background:${color}"></span></span>
      <span class="tiny muted">${pct(r.accuracy)}</span>
    </div>`).join('');
}

/** Simple render helper that swaps a container's children with a fade. */
export function swap(container, node) {
  container.innerHTML = '';
  container.append(node);
  container.animate?.([{ opacity: 0, transform: 'translateY(6px)' }, { opacity: 1, transform: 'none' }], { duration: 220, easing: 'cubic-bezier(.4,0,.2,1)' });
}
