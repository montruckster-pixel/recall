import {
  h, icon, toast, modal, confirmDialog, emptyState, badgeFor, fmtDate, fmtRelative, plural, esc,
} from '../ui.js';
import { api, qs } from '../api.js';
import { navigate } from '../router.js';

export async function renderMaterials({ setMeta }) {
  let meta = { acceptedExtensions: ['pdf', 'docx', 'pptx', 'txt', 'md'], maxUploadBytes: 15 * 1024 * 1024, ai: { configured: false } };
  try { meta = await api.get('/api/materials/meta'); } catch { /* ignore */ }

  const listWrap = h('div', { class: 'stack stack--sm' });
  const totalLabel = h('span', { class: 'small muted' });
  let offset = 0;

  setMeta({
    title: 'Upload Materials',
    subtitle: 'PDF, Word, PowerPoint, text and pasted notes',
    actions: [],
  });

  async function load(reset = true) {
    if (reset) offset = 0;
    listWrap.innerHTML = '';
    listWrap.append(h('div', { class: 'skeleton', style: 'height:72px' }), h('div', { class: 'skeleton', style: 'height:72px' }));
    try {
      const data = await api.get(`/api/materials${qs({ limit: 20, offset })}`);
      listWrap.innerHTML = '';
      totalLabel.textContent = data.total ? plural(data.total, 'material') : '';
      if (!data.items.length && reset) {
        listWrap.append(emptyState({
          icon: 'upload',
          title: 'No materials yet',
          message: 'Upload a PDF, Word document or slides, or paste your notes. Recall will extract the text so you can generate study content.',
        }));
        return;
      }
      for (const m of data.items) listWrap.append(materialRow(m, () => load(false)));
      if (data.offset + data.items.length < data.total) {
        listWrap.append(h('button', { class: 'btn btn--block', type: 'button', text: 'Load more', onClick: () => { offset += 20; load(false); } }));
      }
    } catch (err) {
      listWrap.innerHTML = '';
      listWrap.append(h('div', { class: 'alert alert--error' }, [h('span', { text: err.message })]));
    }
  }

  const uploadCard = uploadPanel(meta, () => load(true));

  setTimeout(() => load(), 0);

  return h('div', { class: 'stack stack--lg' }, [
    meta.ai.configured
      ? null
      : h('div', { class: 'alert alert--warning' }, [
          h('span', { html: icon('alert', 16) }),
          h('div', {}, [
            h('div', { class: 'strong', text: 'AI processing is not configured' }),
            h('div', { class: 'small', text: meta.ai.message }),
            h('div', { class: 'small mt-1', text: 'You can still upload materials and create flashcards manually. Set AI_PROVIDER and the matching API key to enable generation.' }),
          ]),
        ]),
    uploadCard,
    h('div', {}, [h('div', { class: 'row row--between mb-1' }, [h('h2', { class: 'mb-0', text: 'Your materials' }), totalLabel]), listWrap]),
  ]);
}

function materialRow(m, reload) {
  const statusHint = {
    uploaded: 'Waiting to extract',
    extracting: 'Extracting text…',
    extracted: 'Text extracted — ready to generate study content',
    processing: 'Generating study content…',
    ready: 'Study content generated',
    failed: 'Processing failed',
  }[m.status] || m.status;
  return h('div', { class: 'list-item', style: 'align-items:flex-start' }, [
    h('div', { style: 'padding-top:2px', html: icon('upload', 18) }),
    h('div', { class: 'list-item__main' }, [
      h('div', { class: 'row row--between' }, [
        h('a', { class: 'list-item__title', href: `#/materials/${m.id}`, text: m.title, style: 'color:var(--text);text-decoration:none' }),
        h('span', { html: badgeFor(m.status) }),
      ]),
      h('div', { class: 'tiny muted', text: `${statusHint} · ${m.charCount ? `${m.charCount.toLocaleString()} characters` : 'no text'} · ${fmtRelative(m.createdAt)}` }),
      m.error ? h('div', { class: 'tiny', style: 'color:var(--danger)', text: m.error }) : null,
      h('div', { class: 'row mt-1' }, [
        h('a', { class: 'btn btn--sm', href: `#/materials/${m.id}`, text: 'Open' }),
        m.status === 'failed' ? h('button', { class: 'btn btn--sm', type: 'button', text: 'Retry extraction', onClick: async (e) => {
          e.currentTarget.disabled = true;
          try { await api.post(`/api/materials/${m.id}/retry`); toast('Extraction retried.', 'success'); reload(); }
          catch (err) { toast(err.message, 'error'); e.currentTarget.disabled = false; }
        } }) : null,
      ]),
    ]),
    h('button', { class: 'btn btn--sm btn--ghost btn--icon', type: 'button', 'aria-label': 'Delete material', html: icon('trash', 15), onClick: async () => {
      const ok = await confirmDialog({ title: 'Delete material?', message: `"${m.title}" and its extracted text will be deleted. Study sets generated from it are kept.`, confirmLabel: 'Delete', danger: true });
      if (!ok) return;
      await api.del(`/api/materials/${m.id}`);
      toast('Material deleted.', 'success'); reload();
    } }),
  ]);
}

function uploadPanel(meta, onDone) {
  const fileInput = h('input', { type: 'file', class: 'hidden', accept: meta.acceptedExtensions.map((e) => `.${e}`).join(','), multiple: false });
  const titleInput = h('input', { type: 'text', placeholder: 'e.g. Network Security — Chapter 4' });
  const descInput = h('input', { type: 'text', placeholder: 'Optional description' });
  const subjectInput = h('input', { type: 'text', placeholder: 'Subject (optional)' });
  const topicInput = h('input', { type: 'text', placeholder: 'Topic (optional)' });
  const textArea = h('textarea', { placeholder: 'Or paste your notes here…', rows: 6 });
  const chosen = h('div', { class: 'small muted' });
  const progress = h('div', { class: 'hidden' });

  let file = null;
  const dropzone = h('div', { class: 'dropzone', role: 'button', tabindex: '0', 'aria-label': 'Choose a file to upload' }, [
    h('div', { class: 'dropzone__icon', html: icon('upload', 26) }),
    h('div', { class: 'strong', text: 'Drag and drop a file here' }),
    h('div', { class: 'small muted', text: `or click to browse · ${meta.acceptedExtensions.map((e) => e.toUpperCase()).join(', ')} · up to ${Math.round(meta.maxUploadBytes / 1024 / 1024)} MB` }),
  ]);
  const setFile = (f) => {
    file = f;
    chosen.textContent = f ? `Selected: ${f.name} (${(f.size / 1024).toFixed(0)} KB)` : '';
    if (f && !titleInput.value) titleInput.value = f.name.replace(/\.[^.]+$/, '');
  };
  dropzone.addEventListener('click', () => fileInput.click());
  dropzone.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fileInput.click(); } });
  dropzone.addEventListener('dragover', (e) => { e.preventDefault(); dropzone.classList.add('is-over'); });
  dropzone.addEventListener('dragleave', () => dropzone.classList.remove('is-over'));
  dropzone.addEventListener('drop', (e) => {
    e.preventDefault(); dropzone.classList.remove('is-over');
    if (e.dataTransfer.files?.length) setFile(e.dataTransfer.files[0]);
  });
  fileInput.addEventListener('change', () => { if (fileInput.files[0]) setFile(fileInput.files[0]); });

  const submit = h('button', { class: 'btn btn--primary', type: 'button', text: 'Upload and extract text', onClick: async () => {
    if (!titleInput.value.trim()) { toast('Give your material a title.', 'error'); return; }
    if (!file && !textArea.value.trim()) { toast('Attach a file or paste some text.', 'error'); return; }
    submit.disabled = true;
    submit.innerHTML = '<span class="spinner"></span> Uploading and extracting';
    progress.className = 'alert alert--info';
    progress.textContent = 'Uploading… then extracting text on the server.';
    try {
      const fd = new FormData();
      if (file) fd.append('file', file);
      fd.append('title', titleInput.value.trim());
      fd.append('description', descInput.value.trim());
      fd.append('subject', subjectInput.value.trim());
      fd.append('topic', topicInput.value.trim());
      if (!file) fd.append('text', textArea.value);
      const res = await api.post('/api/materials', fd);
      if (res.error) {
        progress.className = 'alert alert--error';
        progress.textContent = res.error;
      } else {
        progress.className = 'alert alert--success';
        progress.textContent = `Extracted ${res.material.charCount.toLocaleString()} characters via ${res.extraction?.method || 'extraction'}.`;
        setFile(null); fileInput.value = ''; textArea.value = ''; titleInput.value = ''; descInput.value = '';
        chosen.textContent = '';
        onDone();
      }
    } catch (err) {
      progress.className = 'alert alert--error';
      progress.textContent = err.message;
    } finally {
      submit.disabled = false;
      submit.textContent = 'Upload and extract text';
    }
  } });

  return h('div', { class: 'card card--pad-lg' }, [
    h('h2', { text: 'Add study material' }),
    h('p', { class: 'small muted', text: 'Upload a document or paste text. Extraction happens on the server; nothing is sent to the AI provider until you ask for generation.' }),
    dropzone,
    fileInput,
    chosen,
    h('div', { class: 'field mt-2' }, [h('label', { text: 'Title' }), titleInput]),
    h('div', { class: 'field' }, [h('label', { text: 'Description (optional)' }), descInput]),
    h('div', { class: 'form-row' }, [
      h('div', { class: 'field' }, [h('label', { text: 'Subject (optional)' }), subjectInput]),
      h('div', { class: 'field' }, [h('label', { text: 'Topic (optional)' }), topicInput]),
    ]),
    h('details', {}, [
      h('summary', { class: 'small strong', style: 'cursor:pointer', text: 'Or paste notes instead' }),
      h('div', { class: 'field mt-1' }, [h('label', { text: 'Pasted notes' }), textArea]),
    ]),
    h('div', { class: 'mt-2' }, [submit]),
    h('div', { class: 'mt-2' }, [progress]),
  ]);
}

// ---- Material detail ------------------------------------------------------

export async function renderMaterialDetail({ params, setMeta }) {
  const id = params.id;
  let data = await api.get(`/api/materials/${id}`);
  const previewWrap = h('div', { class: 'card' });
  const actionsWrap = h('div', { class: 'row row--wrap mb-2' });

  setMeta({
    title: data.material.title,
    subtitle: `${data.material.charCount.toLocaleString()} characters extracted`,
  });

  async function reload() {
    data = await api.get(`/api/materials/${id}`);
    paintPreview();
    paintActions();
  }

  function paintActions() {
    actionsWrap.innerHTML = '';
    const m = data.material;
    const canGenerate = m.status === 'extracted' || m.status === 'ready';
    actionsWrap.append(
      h('button', {
        class: 'btn btn--primary', type: 'button', html: `${icon('cards', 15)} Generate study content`, disabled: !canGenerate,
        onClick: () => generate(m.id, reload),
      }),
      h('a', { class: 'btn', href: `#/quiz/new?materialId=${m.id}`, html: `${icon('quiz', 15)} Build a quiz` }),
      h('a', { class: 'btn', href: `/api/materials/${m.id}/file`, html: `${icon('download', 15)} Download original` }),
      m.status === 'failed' ? h('button', { class: 'btn', type: 'button', text: 'Retry extraction', onClick: async () => {
        try { await api.post(`/api/materials/${m.id}/retry`); toast('Retried.', 'success'); reload(); } catch (e) { toast(e.message, 'error'); }
      } }) : null,
      h('button', { class: 'btn btn--danger ml-auto', type: 'button', text: 'Delete', onClick: async () => {
        const ok = await confirmDialog({ title: 'Delete material?', message: 'The material and its extracted text will be deleted.', confirmLabel: 'Delete', danger: true });
        if (!ok) return;
        await api.del(`/api/materials/${m.id}`);
        toast('Deleted.', 'success'); navigate('/materials');
      } }),
    );
  }

  let textOffset = 0;
  function paintPreview() {
    const m = data.material;
    previewWrap.innerHTML = '';
    previewWrap.append(h('div', { class: 'card__head' }, [
      h('h3', { class: 'mb-0', text: 'Extracted text preview' }),
      h('span', { class: 'spacer', html: badgeFor(m.status) }),
    ]));
    if (m.error) previewWrap.append(h('div', { class: 'alert alert--error mb-2' }, [h('span', { text: m.error })]));
    if (!m.text && !m.charCount) {
      previewWrap.append(h('p', { class: 'small muted mb-0', text: 'No text has been extracted yet.' }));
      return;
    }
    const pre = h('pre', { style: 'white-space:pre-wrap;font-family:var(--mono);font-size:.8rem;max-height:340px;overflow:auto;background:var(--surface-2);padding:14px;border-radius:8px;border:1px solid var(--border)', text: '' });
    const load = async (reset) => {
      if (reset) textOffset = 0;
      const chunk = await api.get(`/api/materials/${id}/text${qs({ offset: textOffset, limit: 8000 })}`);
      pre.textContent = reset ? chunk.text : pre.textContent + chunk.text;
      textOffset += chunk.text.length;
      moreBtn.classList.toggle('hidden', !chunk.hasMore);
    };
    const moreBtn = h('button', { class: 'btn btn--sm mt-1 hidden', type: 'button', text: 'Load more text', onClick: () => load(false) });
    previewWrap.append(pre, moreBtn);
    load(true);
    if (data.generation) {
      const g = data.generation;
      previewWrap.append(h('div', { class: 'alert alert--info mt-2' }, [
        h('div', {}, [
          h('div', { class: 'small strong', text: g.status === 'committed' ? 'Generated content saved' : 'Draft generated content available' }),
          h('div', { class: 'tiny', text: `Created ${fmtRelative(g.created_at)}` }),
          h('button', { class: 'btn btn--sm mt-1', type: 'button', text: 'Review generated content', onClick: () => openGeneration(m.id, reload) }),
        ]),
      ]));
    }
    if (data.studySets?.length) {
      previewWrap.append(h('div', { class: 'mt-2' }, [
        h('div', { class: 'small strong mb-1', text: 'Study sets from this material' }),
        ...data.studySets.map((s) => h('a', { class: 'list-item', href: `#/sets/${s.id}`, style: 'text-decoration:none' }, [
          h('span', { class: 'list-item__title', text: s.title }), h('span', { class: 'ml-auto', html: icon('next', 15) }),
        ])),
      ]));
    }
  }

  paintActions();
  paintPreview();

  return h('div', {}, [
    h('a', { class: 'btn btn--sm btn--ghost mb-2', href: '#/materials', html: `${icon('back', 15)} All materials` }),
    actionsWrap,
    previewWrap,
  ]);
}

async function generate(materialId, reload) {
  const body = h('div', {}, [
    h('p', { class: 'small muted', text: 'Recall will read the extracted text and propose flashcards, multiple-choice questions, short-answer questions, key terminology and a topic summary. Nothing is saved until you review it.' }),
    h('div', { class: 'alert alert--info' }, [h('span', { class: 'small', text: 'This uses one AI credit from your monthly allowance.' })]),
  ]);
  const m = modal({
    title: 'Generate study content',
    body,
    actions: [
      { label: 'Cancel' },
      { label: 'Generate', variant: 'primary', keepOpen: true, onClick: async () => {
        const btn = document.querySelector('#modal-region .modal__foot .btn--primary');
        if (btn) { btn.disabled = true; btn.innerHTML = '<span class="spinner"></span> Generating…'; }
        body.innerHTML = '';
        body.append(h('div', { class: 'stack' }, [
          h('div', { class: 'alert alert--info' }, [h('span', { class: 'spinner' }), h('span', { text: 'Reading your material and building study content. This can take up to a minute.' })]),
          h('div', { class: 'skeleton', style: 'height:60px' }), h('div', { class: 'skeleton', style: 'height:60px' }),
        ]));
        try {
          await api.post(`/api/materials/${materialId}/generate`, {});
          toast('Study content generated.', 'success');
          m.close();
          reload();
          openGeneration(materialId, reload);
        } catch (err) {
          body.innerHTML = '';
          body.append(h('div', { class: 'alert alert--error' }, [h('span', { text: err.message })]));
          if (btn) { btn.disabled = false; btn.textContent = 'Try again'; }
        }
      } },
    ],
  });
}

async function openGeneration(materialId, reload) {
  const data = await api.get(`/api/materials/${materialId}/generation`);
  let pkg = data.package;
  const body = h('div');
  const render = () => {
    body.innerHTML = '';
    body.append(
      pkg.summary ? h('div', { class: 'card mb-2' }, [h('h3', { text: 'Summary' }), h('p', { class: 'small mb-0', text: pkg.summary })]) : null,
      pkg.topics?.length ? h('div', { class: 'mb-2' }, [h('div', { class: 'small strong mb-1', text: 'Topics' }), h('div', { class: 'chips' }, pkg.topics.map((t) => h('span', { class: 'badge', text: t })))]) : null,
      editableList('Flashcards', pkg.flashcards, (i) => [
        { key: 'front', label: 'Front', multiline: true }, { key: 'back', label: 'Back', multiline: true },
      ], (items) => { pkg.flashcards = items; render(); }),
      editableList('Multiple choice', pkg.mcqs, () => [{ key: 'prompt', label: 'Question', multiline: true }], (items) => { pkg.mcqs = items; render(); }),
      editableList('Short answer', pkg.shortAnswers, () => [{ key: 'prompt', label: 'Question', multiline: true }, { key: 'answer', label: 'Model answer', multiline: true }], (items) => { pkg.shortAnswers = items; render(); }),
      pkg.keyTerms?.length ? h('div', { class: 'card mb-2' }, [
        h('h3', { text: `Key terminology (${pkg.keyTerms.length})` }),
        h('div', { class: 'stack stack--sm' }, pkg.keyTerms.map((t) => h('div', {}, [h('span', { class: 'small strong', text: t.term }), h('span', { class: 'small muted', text: ` — ${t.definition}` })]))),
      ]) : null,
    );
  };
  render();
  const m = modal({
    title: 'Review generated content',
    wide: true,
    body,
    actions: [
      { label: 'Discard', onClick: () => { /* draft stays; user can regenerate */ } },
      { label: 'Save to my library', variant: 'primary', keepOpen: true, onClick: async () => {
        const btn = document.querySelector('#modal-region .modal__foot .btn--primary');
        if (btn) { btn.disabled = true; btn.innerHTML = '<span class="spinner"></span> Saving'; }
        try {
          const r = await api.post(`/api/generations/${data.generation.id}/commit`, { package: pkg });
          toast(`Saved ${r.cardCount} flashcards and ${r.questionCount} questions.`, 'success');
          m.close();
          reload();
        } catch (err) {
          toast(err.message, 'error');
          if (btn) { btn.disabled = false; btn.textContent = 'Save to my library'; }
        }
      } },
    ],
  });
}

function editableList(title, items, fieldsFn, onChange) {
  if (!items?.length) return null;
  const wrap = h('div', { class: 'card mb-2' }, [h('h3', { text: `${title} (${items.length})` })]);
  items.forEach((item, i) => {
    const fields = fieldsFn(i);
    const editors = fields.map((f) => {
      const inp = f.multiline ? h('textarea', { value: item[f.key] || '' }) : h('input', { type: 'text', value: item[f.key] || '' });
      inp.addEventListener('change', () => { item[f.key] = inp.value; });
      return h('div', { class: 'field' }, [h('label', { class: 'tiny', text: f.label }), inp]);
    });
    const opts = item.options ? h('div', { class: 'tiny muted', text: `Options: ${item.options.join(' · ')} · correct: ${item.options[item.correctIndex] ?? item.correctAnswer ?? '—'}` }) : null;
    wrap.append(h('div', { style: 'border-top:1px solid var(--border);padding-top:10px;margin-top:10px' }, [
      h('div', { class: 'row row--between' }, [
        h('span', { class: 'tiny muted', text: `#${i + 1}${item.topic ? ` · ${item.topic}` : ''}` }),
        h('button', { class: 'btn btn--sm btn--ghost btn--icon', type: 'button', 'aria-label': 'Remove item', html: icon('trash', 14), onClick: () => {
          items.splice(i, 1); onChange(items);
        } }),
      ]),
      ...editors, opts,
    ]));
  });
  return wrap;
}
