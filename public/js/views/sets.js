import {
  h, icon, esc, toast, modal, confirmDialog, promptDialog, emptyState, badgeFor,
  fmtDate, fmtRelative, plural, pct,
} from '../ui.js';
import { api, qs } from '../api.js';
import { navigate } from '../router.js';

const SORT_OPTIONS = [
  { value: 'recent', label: 'Recently updated' },
  { value: 'created', label: 'Newest first' },
  { value: 'title', label: 'Title (A–Z)' },
  { value: 'cards', label: 'Most cards' },
  { value: 'due', label: 'Most due' },
  { value: 'studied', label: 'Recently studied' },
];

export async function renderSets({ setMeta, query = {} }) {
  const state = { q: '', subject: '', topic: '', favorite: false, archived: false, sort: 'recent', offset: 0 };
  let facets = { subjects: [], topics: [] };
  try { facets = await api.get('/api/sets/facets'); } catch { /* ignore */ }

  const listWrap = h('div', { class: 'grid grid--auto' });
  const countLabel = h('span', { class: 'small muted' });
  const loadMore = h('button', { class: 'btn btn--block mt-2', type: 'button', text: 'Load more' });

  async function load(reset = true) {
    if (reset) state.offset = 0;
    listWrap.innerHTML = '';
    listWrap.append(...Array.from({ length: 3 }, () => h('div', { class: 'card' }, [
      h('div', { class: 'skeleton skeleton--text', style: 'width:70%' }),
      h('div', { class: 'skeleton skeleton--text', style: 'width:45%' }),
      h('div', { class: 'skeleton', style: 'height:36px' }),
    ])));
    try {
      const data = await api.get(`/api/sets${qs({ ...state, limit: 24 })}`);
      if (reset) listWrap.innerHTML = '';
      countLabel.textContent = data.total ? `${plural(data.total, 'study set')}` : '';
      for (const s of data.items) listWrap.append(setCard(s, load));
      loadMore.classList.toggle('hidden', data.offset + data.items.length >= data.total);
      if (!data.items.length && reset) {
        listWrap.innerHTML = '';
        listWrap.style.gridTemplateColumns = '1fr';
        listWrap.append(emptyState({
          icon: 'sets',
          title: state.q || state.subject || state.topic ? 'No study sets match those filters' : 'No study sets yet',
          message: state.q || state.subject || state.topic
            ? 'Try clearing the search or filters.'
            : 'Create a set manually, or upload a document and let Recall generate one for you.',
          action: h('div', { class: 'row', style: 'justify-content:center' }, [
            h('a', { class: 'btn btn--primary', href: '#/materials', text: 'Upload materials' }),
            h('button', { class: 'btn', type: 'button', text: 'New set', onClick: () => createSet(load) }),
          ]),
        }));
      } else {
        listWrap.style.gridTemplateColumns = '';
      }
    } catch (err) {
      listWrap.innerHTML = '';
      listWrap.append(h('div', { class: 'alert alert--error' }, [h('span', { text: err.message })]));
    }
  }

  // Toolbar
  const search = h('input', { type: 'search', placeholder: 'Search study sets…', 'aria-label': 'Search study sets' });
  let timer;
  search.addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(() => { state.q = search.value.trim(); load(); }, 280);
  });
  const subjectSel = h('select', { 'aria-label': 'Filter by subject' }, [
    h('option', { value: '', text: 'All subjects' }),
    ...facets.subjects.map((s) => h('option', { value: s, text: s })),
  ]);
  subjectSel.addEventListener('change', () => { state.subject = subjectSel.value; load(); });
  const topicSel = h('select', { 'aria-label': 'Filter by topic' }, [
    h('option', { value: '', text: 'All topics' }),
    ...facets.topics.map((s) => h('option', { value: s, text: s })),
  ]);
  topicSel.addEventListener('change', () => { state.topic = topicSel.value; load(); });
  const sortSel = h('select', { 'aria-label': 'Sort study sets' }, SORT_OPTIONS.map((o) => h('option', { value: o.value, text: o.label })));
  sortSel.addEventListener('change', () => { state.sort = sortSel.value; load(); });
  const favBtn = h('button', { class: 'btn', type: 'button', html: `${icon('star', 15)} Favorites`, onClick: (e) => {
    state.favorite = !state.favorite;
    e.currentTarget.classList.toggle('btn--primary', state.favorite);
    load();
  } });
  const archBtn = h('button', { class: 'btn', type: 'button', text: 'Archived', onClick: (e) => {
    state.archived = !state.archived;
    e.currentTarget.classList.toggle('btn--primary', state.archived);
    load();
  } });

  setMeta({
    title: 'My Study Sets',
    actions: [h('button', { class: 'btn btn--primary', type: 'button', html: `${icon('plus', 16)} New study set`, onClick: () => createSet(load) })],
  });

  const toolbar = h('div', { class: 'card mb-2' }, [
    h('div', { class: 'row row--wrap' }, [search, subjectSel, topicSel, sortSel, favBtn, archBtn]),
  ]);

  loadMore.addEventListener('click', () => { state.offset += 24; load(false); });

  setTimeout(() => load(), 0);

  return h('div', {}, [
    toolbar,
    h('div', { class: 'row row--between mb-1' }, [countLabel]),
    listWrap,
    loadMore,
  ]);
}

function setCard(s, reload) {
  return h('div', { class: 'card card--interactive' }, [
    h('div', { class: 'row row--between' }, [
      h('a', { class: 'strong truncate', href: `#/sets/${s.id}`, text: s.title, style: 'color:var(--text);text-decoration:none;flex:1' }),
      s.isFavorite ? h('span', { style: 'color:#eab308', html: icon('star', 15) }) : null,
    ]),
    h('p', { class: 'small muted clamp-2 mb-1', style: 'min-height:38px', text: s.description || 'No description.' }),
    h('div', { class: 'row row--wrap small mb-1' }, [
      h('span', { class: 'badge', text: plural(s.cardCount, 'card') }),
      s.dueCount ? h('span', { class: 'badge badge--accent', text: `${s.dueCount} due` }) : null,
      s.subject ? h('span', { class: 'badge', text: s.subject }) : null,
      s.archived ? h('span', { html: badgeFor('archived') }) : null,
    ]),
    h('div', { class: 'tiny muted mb-1', text: `Last studied ${s.lastStudiedAt ? fmtRelative(s.lastStudiedAt) : 'never'} · created ${fmtDate(s.createdAt)}` }),
    h('div', { class: 'row' }, [
      h('a', { class: 'btn btn--sm btn--primary', href: `#/study/${s.id}`, text: s.dueCount ? 'Review due' : 'Study' }),
      h('a', { class: 'btn btn--sm', href: `#/sets/${s.id}`, text: 'Open' }),
      h('button', { class: 'btn btn--sm btn--ghost btn--icon', type: 'button', 'aria-label': 'More actions', html: icon('settings', 15), onClick: () => setMenu(s, reload) }),
    ]),
  ]);
}

function setMenu(s, reload) {
  const item = (label, fn, danger) => h('button', {
    class: `btn btn--block ${danger ? 'btn--danger' : ''}`, type: 'button', text: label,
    style: 'justify-content:flex-start', onClick: async () => { await fn(); },
  });
  const body = h('div', { class: 'stack stack--sm' }, [
    item(s.isFavorite ? 'Remove from favorites' : 'Add to favorites', async () => {
      await api.put(`/api/sets/${s.id}`, { isFavorite: !s.isFavorite });
      toast('Updated.', 'success'); reload();
    }),
    item('Duplicate set', async () => {
      const r = await api.post(`/api/sets/${s.id}/duplicate`);
      toast(`Duplicated ${r.cardCount} cards.`, 'success'); reload();
    }),
    item('Rename / edit', async () => {
      const title = await promptDialog({ title: 'Rename study set', label: 'Title', value: s.title });
      if (title === null) return;
      const description = await promptDialog({ title: 'Description', label: 'Description (optional)', value: s.description || '', multiline: true });
      await api.put(`/api/sets/${s.id}`, { title, description });
      toast('Saved.', 'success'); reload();
    }),
    item(s.archived ? 'Restore from archive' : 'Archive set', async () => {
      await api.post(`/api/sets/${s.id}/archive`, { archived: !s.archived });
      toast(s.archived ? 'Restored.' : 'Archived.', 'success'); reload();
    }),
    item('Delete set', async () => {
      const ok = await confirmDialog({
        title: 'Delete study set?',
        message: `"${s.title}" and its ${s.cardCount} cards (including review history) will be permanently deleted. This cannot be undone.`,
        confirmLabel: 'Delete', danger: true,
      });
      if (!ok) return;
      await api.del(`/api/sets/${s.id}`);
      toast('Study set deleted.', 'success'); reload();
    }, true),
  ]);
  modal({ title: s.title, body, actions: [{ label: 'Close' }] });
}

async function createSet(reload) {
  const title = await promptDialog({ title: 'New study set', label: 'Title', placeholder: 'e.g. Network Security — Week 3', confirmLabel: 'Create' });
  if (!title) return;
  try {
    const { set } = await api.post('/api/sets', { title });
    toast('Study set created.', 'success');
    navigate(`/sets/${set.id}`);
  } catch (err) { toast(err.message, 'error'); }
}

// ---- Set detail -----------------------------------------------------------

export async function renderSetDetail({ params, setMeta }) {
  const setId = params.id;
  const { set } = await api.get(`/api/sets/${setId}`);
  const state = { q: '', offset: 0, limit: 50 };
  const selected = new Set();

  const cardsWrap = h('div', { class: 'stack stack--sm' });
  const totalLabel = h('span', { class: 'small muted' });
  const bulkBar = h('div', { class: 'card hidden' });

  setMeta({
    title: set.title,
    subtitle: `${plural(set.cardCount, 'card')} · ${set.dueCount} due · last studied ${set.lastStudiedAt ? fmtRelative(set.lastStudiedAt) : 'never'}`,
    actions: [
      h('a', { class: 'btn btn--primary', href: `#/study/${set.id}`, text: set.dueCount ? `Review ${set.dueCount} due` : 'Study set' }),
      h('button', { class: 'btn', type: 'button', html: `${icon('quiz', 15)} Quiz`, onClick: () => navigate(`/quiz/new?setId=${set.id}`) }),
      h('button', { class: 'btn', type: 'button', html: `${icon('plus', 15)} Add cards`, onClick: () => addCards(set.id, load) }),
    ],
  });

  const search = h('input', { type: 'search', placeholder: 'Search cards…', 'aria-label': 'Search cards' });
  let timer;
  search.addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(() => { state.q = search.value.trim(); state.offset = 0; load(); }, 260);
  });

  async function load() {
    cardsWrap.innerHTML = '';
    cardsWrap.append(h('div', { class: 'skeleton', style: 'height:64px' }), h('div', { class: 'skeleton', style: 'height:64px' }));
    try {
      const data = await api.get(`/api/sets/${set.id}/cards${qs({ ...state, limit: state.limit })}`);
      cardsWrap.innerHTML = '';
      totalLabel.textContent = `${data.total} cards`;
      if (!data.items.length) {
        cardsWrap.append(emptyState({
          icon: 'cards',
          title: state.q ? 'No cards match that search' : 'This set has no cards yet',
          message: state.q ? 'Try a different search term.' : 'Add cards manually, or generate them from an uploaded document.',
          action: h('button', { class: 'btn btn--primary', type: 'button', text: 'Add cards', onClick: () => addCards(set.id, load) }),
        }));
        return;
      }
      for (const c of data.items) cardsWrap.append(cardRow(c, load));
      if (data.offset + data.items.length < data.total) {
        cardsWrap.append(h('button', {
          class: 'btn btn--block', type: 'button', text: 'Load more cards',
          onClick: async (e) => {
            state.offset += state.limit;
            const more = await api.get(`/api/sets/${set.id}/cards${qs({ ...state })}`);
            e.currentTarget.remove();
            for (const c of more.items) cardsWrap.append(cardRow(c, load));
            if (more.offset + more.items.length < more.total) cardsWrap.append(e.currentTarget);
          },
        }));
      }
    } catch (err) {
      cardsWrap.innerHTML = '';
      cardsWrap.append(h('div', { class: 'alert alert--error' }, [h('span', { text: err.message })]));
    }
  }

  function updateBulkBar() {
    if (!selected.size) { bulkBar.classList.add('hidden'); return; }
    bulkBar.classList.remove('hidden');
    bulkBar.innerHTML = '';
    bulkBar.append(h('div', { class: 'row row--wrap' }, [
      h('span', { class: 'strong small', text: `${selected.size} selected` }),
      h('button', { class: 'btn btn--sm', type: 'button', text: 'Move to another set', onClick: () => bulkMove(load) }),
      h('button', { class: 'btn btn--sm', type: 'button', text: 'Set difficulty', onClick: () => bulkDifficulty(load) }),
      h('button', { class: 'btn btn--sm', type: 'button', text: 'Set topic', onClick: () => bulkTopic(load) }),
      h('button', { class: 'btn btn--sm btn--danger ml-auto', type: 'button', text: 'Delete selected', onClick: () => bulkDelete(load) }),
    ]));
  }

  function cardRow(c, reload) {
    const cb = h('input', { type: 'checkbox', 'aria-label': `Select card: ${c.front}` });
    cb.addEventListener('change', () => {
      if (cb.checked) selected.add(c.id); else selected.delete(c.id);
      updateBulkBar();
    });
    return h('div', { class: 'list-item', style: 'align-items:flex-start' }, [
      h('div', { style: 'padding-top:3px' }, [cb]),
      h('div', { class: 'list-item__main' }, [
        h('div', { class: 'strong small', text: c.front }),
        h('div', { class: 'small muted', style: 'white-space:pre-wrap', text: c.back }),
        c.example ? h('div', { class: 'tiny muted', text: `Example: ${c.example}` }) : null,
        h('div', { class: 'row row--wrap tiny muted mt-1' }, [
          c.topic ? h('span', { class: 'badge', text: c.topic }) : null,
          h('span', { class: 'badge', text: `Difficulty ${c.difficulty}/4` }),
          c.schedule ? h('span', { html: badgeFor(c.schedule.state) }) : null,
          c.schedule ? h('span', { text: `due ${fmtRelative(c.schedule.dueAt)} · ${c.schedule.reps} reviews${c.schedule.lapses ? ` · ${c.schedule.lapses} lapses` : ''}` }) : null,
        ]),
      ]),
      h('div', { class: 'stack stack--sm' }, [
        h('button', { class: 'btn btn--sm btn--ghost btn--icon', type: 'button', 'aria-label': 'Edit card', html: icon('edit', 15), onClick: () => editCard(c, reload) }),
        h('button', { class: 'btn btn--sm btn--ghost btn--icon', type: 'button', 'aria-label': 'Delete card', html: icon('trash', 15), onClick: async () => {
          const ok = await confirmDialog({ title: 'Delete card?', message: 'This card and its review history will be removed.', confirmLabel: 'Delete', danger: true });
          if (!ok) return;
          await api.del(`/api/cards/${c.id}`);
          toast('Card deleted.', 'success'); reload();
        } }),
      ]),
    ]);
  }

  async function bulkMove(reload) {
    const { items } = await api.get('/api/sets?limit=100');
    const sel = h('select', {}, items.filter((s) => s.id !== set.id).map((s) => h('option', { value: s.id, text: s.title })));
    modal({
      title: 'Move cards', body: h('div', { class: 'field' }, [h('label', { text: 'Destination study set' }), sel]),
      actions: [{ label: 'Cancel' }, { label: 'Move', variant: 'primary', onClick: async () => {
        await api.post('/api/cards/bulk', { action: 'move', ids: [...selected], targetSetId: sel.value });
        toast('Cards moved.', 'success'); selected.clear(); updateBulkBar(); reload();
      } }],
    });
  }
  async function bulkDifficulty(reload) {
    const sel = h('select', {}, [1, 2, 3, 4].map((n) => h('option', { value: n, text: `${n} — ${['Easy', 'Medium', 'Hard', 'Very hard'][n - 1]}` })));
    modal({
      title: 'Set difficulty', body: h('div', { class: 'field' }, [h('label', { text: 'Difficulty' }), sel]),
      actions: [{ label: 'Cancel' }, { label: 'Apply', variant: 'primary', onClick: async () => {
        await api.post('/api/cards/bulk', { action: 'difficulty', ids: [...selected], difficulty: Number(sel.value) });
        toast('Updated.', 'success'); selected.clear(); updateBulkBar(); reload();
      } }],
    });
  }
  async function bulkTopic(reload) {
    const input = h('input', { type: 'text', placeholder: 'e.g. Subnetting' });
    modal({
      title: 'Set topic', body: h('div', { class: 'field' }, [h('label', { text: 'Topic' }), input]),
      actions: [{ label: 'Cancel' }, { label: 'Apply', variant: 'primary', onClick: async () => {
        await api.post('/api/cards/bulk', { action: 'topic', ids: [...selected], topic: input.value.trim() });
        toast('Updated.', 'success'); selected.clear(); updateBulkBar(); reload();
      } }],
    });
  }
  async function bulkDelete(reload) {
    const ok = await confirmDialog({ title: `Delete ${selected.size} cards?`, message: 'These cards and their review history will be permanently deleted.', confirmLabel: 'Delete', danger: true });
    if (!ok) return;
    await api.post('/api/cards/bulk', { action: 'delete', ids: [...selected] });
    toast('Cards deleted.', 'success'); selected.clear(); updateBulkBar(); reload();
  }

  async function editCard(c, reload) {
    const front = h('textarea', { value: c.front });
    const back = h('textarea', { value: c.back });
    const example = h('input', { type: 'text', value: c.example || '' });
    const topic = h('input', { type: 'text', value: c.topic || '' });
    const diff = h('select', {}, [1, 2, 3, 4].map((n) => h('option', { value: n, text: String(n), selected: n === c.difficulty ? true : null })));
    modal({
      title: 'Edit card',
      body: h('div', {}, [
        h('div', { class: 'field' }, [h('label', { text: 'Front' }), front]),
        h('div', { class: 'field' }, [h('label', { text: 'Back' }), back]),
        h('div', { class: 'field' }, [h('label', { text: 'Example (optional)' }), example]),
        h('div', { class: 'form-row' }, [
          h('div', { class: 'field' }, [h('label', { text: 'Topic' }), topic]),
          h('div', { class: 'field' }, [h('label', { text: 'Difficulty' }), diff]),
        ]),
      ]),
      actions: [{ label: 'Cancel' }, { label: 'Save', variant: 'primary', onClick: async () => {
        await api.put(`/api/cards/${c.id}`, { front: front.value, back: back.value, example: example.value, topic: topic.value, difficulty: Number(diff.value) });
        toast('Card saved.', 'success'); reload();
      } }],
    });
  }

  await load();

  return h('div', {}, [
    h('div', { class: 'card mb-2' }, [
      h('div', { class: 'row row--between' }, [search, totalLabel]),
    ]),
    bulkBar,
    cardsWrap,
    h('div', { class: 'row mt-2' }, [
      h('a', { class: 'btn', href: '#/sets', html: `${icon('back', 15)} All study sets` }),
    ]),
  ]);
}

async function addCards(setId, reload) {
  const front = h('textarea', { placeholder: 'What is the question, term or concept?' });
  const back = h('textarea', { placeholder: 'What is the answer or explanation?' });
  const example = h('input', { type: 'text', placeholder: 'Optional example' });
  const topic = h('input', { type: 'text', placeholder: 'Optional topic' });
  const list = h('div', { class: 'stack stack--sm' });
  const queued = [];
  const renderQueue = () => {
    list.innerHTML = '';
    queued.forEach((c, i) => list.append(h('div', { class: 'list-item' }, [
      h('div', { class: 'list-item__main' }, [h('div', { class: 'small strong', text: c.front }), h('div', { class: 'tiny muted', text: c.back })]),
      h('button', { class: 'btn btn--sm btn--ghost', type: 'button', text: 'Remove', onClick: () => { queued.splice(i, 1); renderQueue(); } }),
    ])));
  };
  const addBtn = h('button', { class: 'btn', type: 'button', html: `${icon('plus', 15)} Add to queue`, onClick: () => {
    if (!front.value.trim() || !back.value.trim()) { toast('A card needs both a front and a back.', 'error'); return; }
    queued.push({ front: front.value.trim(), back: back.value.trim(), example: example.value.trim(), topic: topic.value.trim() });
    front.value = ''; back.value = ''; example.value = '';
    renderQueue();
  } });

  modal({
    title: 'Add flashcards',
    wide: true,
    body: h('div', {}, [
      h('div', { class: 'field' }, [h('label', { text: 'Front' }), front]),
      h('div', { class: 'field' }, [h('label', { text: 'Back' }), back]),
      h('div', { class: 'form-row' }, [
        h('div', { class: 'field' }, [h('label', { text: 'Example (optional)' }), example]),
        h('div', { class: 'field' }, [h('label', { text: 'Topic (optional)' }), topic]),
      ]),
      addBtn,
      queued.length ? h('div', { class: 'mt-2' }, [h('div', { class: 'small strong mb-1', text: `Queue (${queued.length})` }), list]) : null,
    ]),
    actions: [
      { label: 'Cancel' },
      { label: 'Save cards', variant: 'primary', onClick: async () => {
        const cards = [...queued];
        if (front.value.trim() && back.value.trim()) cards.push({ front: front.value.trim(), back: back.value.trim(), example: example.value.trim(), topic: topic.value.trim() });
        if (!cards.length) { toast('Add at least one card.', 'error'); return false; }
        try {
          const r = await api.post(`/api/sets/${setId}/cards`, { cards });
          toast(`${r.created} card${r.created === 1 ? '' : 's'} added.`, 'success');
          reload();
        } catch (err) { toast(err.message, 'error'); return false; }
        return true;
      } },
    ],
  });
  setTimeout(() => front.focus(), 40);
}
