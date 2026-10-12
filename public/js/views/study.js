import { h, icon, toast, emptyState, fmtDuration, plural, pct, esc } from '../ui.js';
import { api, qs } from '../api.js';
import { navigate } from '../router.js';
import { setState } from '../store.js';

const RATINGS = [
  { value: 1, key: '1', label: 'Again', hint: 'Forgot it', cls: 'danger' },
  { value: 2, key: '2', label: 'Hard', hint: 'Struggled', cls: 'warning' },
  { value: 3, key: '3', label: 'Good', hint: 'Recalled it', cls: 'success' },
  { value: 4, key: '4', label: 'Easy', hint: 'Too easy', cls: 'accent' },
];

export async function renderStudy({ params, query, setMeta }) {
  const setId = params.setId || query.setId || null;
  const queue = await api.get(`/api/study/queue${qs({ setId, limit: 60 })}`);

  if (!queue.items.length) {
    setMeta({ title: 'Flashcard review', subtitle: 'Nothing due right now' });
    return emptyState({
      icon: 'check',
      title: queue.dueTotal === 0 ? 'You are all caught up' : 'No cards due in this set',
      message: queue.dueTotal === 0
        ? 'Nothing is due for review. You can study ahead by picking a set, or add new material.'
        : 'This set has no cards due right now.',
      action: h('div', { class: 'row', style: 'justify-content:center' }, [
        h('a', { class: 'btn btn--primary', href: '#/sets', text: 'Browse study sets' }),
        h('a', { class: 'btn', href: '#/materials', text: 'Upload materials' }),
      ]),
    });
  }

  const session = {
    cards: queue.items.map((c) => ({ ...c })),
    index: 0,
    flipped: false,
    ratings: [],
    startedAt: Date.now(),
    cardShownAt: Date.now(),
    finished: false,
    shuffle: false,
  };

  setMeta({
    title: setId ? `Studying: ${queue.items[0].setTitle}` : 'Flashcard review',
    subtitle: `${queue.dueTotal} cards due`,
    actions: [
      h('button', { class: 'btn btn--sm', type: 'button', html: `${icon('shuffle', 15)} Shuffle`, onClick: () => {
        session.cards = shuffleArray(session.cards);
        session.index = 0; session.flipped = false; paint();
        toast('Queue shuffled.', 'info');
      } }),
      h('a', { class: 'btn btn--sm', href: '#/dashboard', text: 'Exit' }),
    ],
  });

  const root = h('div', { class: 'study-shell' });
  const bar = h('div', { class: 'study-bar' });
  const scene = h('div', { class: 'flip-scene' });
  const controls = h('div', { class: 'mt-2' });
  const shortcuts = h('div', { class: 'row row--between tiny muted mt-2' }, [
    h('span', { html: `<kbd>Space</kbd> reveal · <kbd>1</kbd>–<kbd>4</kbd> rate · <kbd>←</kbd> previous` }),
    h('span', { text: 'Reviews are saved instantly.' }),
  ]);

  root.append(bar, scene, controls, shortcuts);

  function current() { return session.cards[session.index]; }

  function paint() {
    if (session.finished) return paintSummary();
    const c = current();
    if (!c) return paintSummary();

    // progress bar
    bar.innerHTML = '';
    const done = session.index;
    bar.append(
      h('span', { class: 'small strong', text: `${session.index + 1} / ${session.cards.length}` }),
      h('div', { class: 'progress' }, [h('span', { style: `width:${((done) / session.cards.length * 100).toFixed(1)}%` })]),
      h('span', { class: 'tiny muted', text: c.setTitle }),
    );

    // card
    scene.innerHTML = '';
    const face = (side) => h('div', { class: `flip-face ${side === 'back' ? 'flip-face--back' : ''}` }, [
      h('div', { class: 'flip-face__label', text: side === 'front' ? 'Question' : 'Answer' }),
      h('div', { class: 'flip-face__text', text: side === 'front' ? c.front : c.back }),
      side === 'front' && c.topic ? h('div', { class: 'tiny muted', style: 'position:absolute;bottom:16px', text: c.topic }) : null,
      side === 'back' && c.example ? h('div', { class: 'tiny', style: 'position:absolute;bottom:16px;left:22px;right:22px', text: `Example: ${c.example}` }) : null,
      side === 'back' && c.sourceRef ? h('div', { class: 'tiny muted', style: 'position:absolute;top:16px;right:22px', text: 'source' }) : null,
    ]);
    const flip = h('div', { class: `flip-card ${session.flipped ? 'is-flipped' : ''}`, role: 'button', tabindex: '0', 'aria-label': 'Reveal answer' }, [
      face('front'), face('back'),
    ]);
    flip.addEventListener('click', () => { session.flipped = !session.flipped; flip.classList.toggle('is-flipped', session.flipped); paintControls(); });
    flip.addEventListener('keydown', (e) => {
      if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); session.flipped = !session.flipped; flip.classList.toggle('is-flipped', session.flipped); paintControls(); }
    });
    scene.append(flip);

    paintControls();
    session.cardShownAt = Date.now();
  }

  function paintControls() {
    controls.innerHTML = '';
    if (!session.flipped) {
      controls.append(h('button', { class: 'btn btn--primary btn--block btn--lg', type: 'button', text: 'Show answer', onClick: () => { session.flipped = true; paint(); } }));
      return;
    }
    const row = h('div', { class: 'rating-row' });
    for (const r of RATINGS) {
      row.append(h('button', {
        class: 'rating-btn', type: 'button', dataset: { rating: String(r.value) },
        onClick: () => rate(r.value),
      }, [
        h('strong', { text: r.label }),
        h('small', { text: r.hint }),
        h('small', { html: `<kbd>${r.key}</kbd>` }),
      ]));
    }
    controls.append(row);
    controls.append(h('div', { class: 'row row--between mt-2' }, [
      h('button', { class: 'btn btn--sm btn--ghost', type: 'button', html: `${icon('back', 15)} Previous`, disabled: session.index === 0, onClick: () => { if (session.index > 0) { session.index -= 1; session.flipped = false; paint(); } } }),
      h('button', { class: 'btn btn--sm btn--ghost', type: 'button', text: 'Skip', onClick: () => { session.index += 1; session.flipped = false; paint(); } }),
    ]));
  }

  async function rate(rating) {
    const c = current();
    const elapsedMs = Date.now() - session.cardShownAt;
    session.ratings.push({ cardId: c.id, rating, elapsedMs });
    // Optimistic advance.
    session.index += 1;
    session.flipped = false;
    paint();
    try {
      const res = await api.post('/api/study/review', { cardId: c.id, rating, elapsedMs });
      if (res.remaining !== undefined) {
        const dash = await api.get('/api/dashboard').catch(() => null);
        if (dash) setState({ dashboard: dash });
      }
    } catch (err) {
      toast(`Could not save that review: ${err.message}`, 'error');
    }
  }

  async function paintSummary() {
    session.finished = true;
    const seconds = Math.round((Date.now() - session.startedAt) / 1000);
    const counts = { 1: 0, 2: 0, 3: 0, 4: 0 };
    for (const r of session.ratings) counts[r.rating] += 1;
    const reviewed = session.ratings.length;
    const good = counts[3] + counts[4];

    bar.innerHTML = '';
    scene.innerHTML = '';
    controls.innerHTML = '';
    shortcuts.classList.add('hidden');

    let result = null;
    try {
      result = await api.post('/api/study/session/complete', {
        cardsReviewed: reviewed, studySeconds: seconds, setId,
      });
      const dash = await api.get('/api/dashboard').catch(() => null);
      if (dash) setState({ dashboard: dash });
    } catch { /* summary still renders */ }

    scene.append(h('div', { class: 'card card--pad-lg', style: 'text-align:center' }, [
      h('div', { style: 'font-size:2rem', html: icon('check', 34) }),
      h('h2', { text: 'Session complete' }),
      h('p', { class: 'muted', text: reviewed ? `You reviewed ${plural(reviewed, 'card')} in ${fmtDuration(seconds)}.` : 'No cards were rated in this session.' }),
      h('div', { class: 'grid grid--4 mt-2' }, [
        summaryStat('Again', counts[1]),
        summaryStat('Hard', counts[2]),
        summaryStat('Good', counts[3]),
        summaryStat('Easy', counts[4]),
      ]),
      reviewed ? h('p', { class: 'small mt-2', text: `Recall rate this session: ${pct(good / reviewed)}` }) : null,
      result ? h('p', { class: 'small muted', text: `Today: ${result.today.cardsReviewed} cards reviewed · ${fmtDuration(result.today.studySeconds)} studied · ${result.remainingDue} still due` }) : null,
      h('div', { class: 'row mt-3', style: 'justify-content:center' }, [
        h('a', { class: 'btn btn--primary', href: '#/dashboard', text: 'Back to dashboard' }),
        result?.remainingDue > 0 ? h('button', { class: 'btn', type: 'button', text: `Review ${result.remainingDue} more`, onClick: () => navigate(setId ? `/study/${setId}` : '/study', { replace: true }) }) : null,
        h('a', { class: 'btn', href: '#/analytics', text: 'See progress' }),
      ]),
    ]));
  }

  function summaryStat(label, n) {
    return h('div', { class: 'card' }, [h('div', { class: 'stat' }, [
      h('span', { class: 'stat__label', text: label }),
      h('span', { class: 'stat__value', text: String(n) }),
    ])]);
  }

  // Keyboard shortcuts
  function onKey(e) {
    if (session.finished) return;
    if (e.target.matches('input, textarea, select')) return;
    if (e.key === ' ' || e.key === 'Enter') {
      e.preventDefault();
      if (!session.flipped) { session.flipped = true; paint(); }
      return;
    }
    if (session.flipped && ['1', '2', '3', '4'].includes(e.key)) {
      e.preventDefault();
      rate(Number(e.key));
      return;
    }
    if (e.key === 'ArrowLeft' && session.index > 0) { session.index -= 1; session.flipped = false; paint(); }
    if (e.key === 'ArrowRight') { session.index += 1; session.flipped = false; paint(); }
  }
  document.addEventListener('keydown', onKey);
  // Clean up when navigating away.
  const observer = new MutationObserver(() => {
    if (!document.body.contains(root)) { document.removeEventListener('keydown', onKey); observer.disconnect(); }
  });
  observer.observe(document.body, { childList: true, subtree: true });

  paint();
  return root;
}

function shuffleArray(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
