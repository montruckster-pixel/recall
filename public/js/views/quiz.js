import {
  h, icon, toast, modal, emptyState, badgeFor, fmtDate, fmtRelative, fmtDuration, fmtClock, pct, plural, confirmDialog,
} from '../ui.js';
import { api, qs } from '../api.js';
import { navigate } from '../router.js';

// ---- Library --------------------------------------------------------------

export async function renderQuizLibrary({ setMeta }) {
  setMeta({
    title: 'Practice Exams',
    subtitle: 'Generated from your material — clearly not official exam questions',
    actions: [h('a', { class: 'btn btn--primary', href: '#/quiz/new', html: `${icon('plus', 16)} Build a quiz` })],
  });

  const listWrap = h('div', { class: 'stack stack--sm' });
  let offset = 0;
  async function load(reset = true) {
    if (reset) offset = 0;
    listWrap.innerHTML = '';
    listWrap.append(h('div', { class: 'skeleton', style: 'height:76px' }));
    try {
      const data = await api.get(`/api/quizzes${qs({ limit: 20, offset })}`);
      listWrap.innerHTML = '';
      if (!data.items.length && reset) {
        listWrap.append(emptyState({
          icon: 'quiz',
          title: 'No quizzes yet',
          message: 'Build a practice quiz from a study set or an uploaded document. You can also generate one when you process a material.',
          action: h('a', { class: 'btn btn--primary', href: '#/quiz/new', text: 'Build your first quiz' }),
        }));
        return;
      }
      for (const q of data.items) listWrap.append(quizRow(q));
      if (data.offset + data.items.length < data.total) {
        listWrap.append(h('button', { class: 'btn btn--block', type: 'button', text: 'Load more', onClick: () => { offset += 20; load(false); } }));
      }
    } catch (err) {
      listWrap.innerHTML = '';
      listWrap.append(h('div', { class: 'alert alert--error' }, [h('span', { text: err.message })]));
    }
  }
  setTimeout(() => load(), 0);

  return h('div', {}, [
    h('div', { class: 'alert alert--info mb-2' }, [
      h('span', { html: icon('alert', 16) }),
      h('span', { text: 'Practice questions are generated from your own materials or flashcards. They are not official certification exam questions.' }),
    ]),
    listWrap,
  ]);
}

function quizRow(q) {
  return h('div', { class: 'list-item', style: 'align-items:flex-start' }, [
    h('div', { class: 'list-item__main' }, [
      h('div', { class: 'row row--between' }, [
        h('span', { class: 'list-item__title', text: q.title }),
        h('span', { html: badgeFor(q.mode === 'exam' ? 'active' : 'review') }),
      ]),
      h('div', { class: 'tiny muted', text: `${plural(q.questionCount, 'question')}${q.timeLimitSec ? ` · ${Math.round(q.timeLimitSec / 60)} min limit` : ' · untimed'} · created ${fmtRelative(q.createdAt)}` }),
      q.attemptCount ? h('div', { class: 'tiny', text: `${q.attemptCount} attempt${q.attemptCount === 1 ? '' : 's'} · best score ${pct(q.bestScore)}` }) : h('div', { class: 'tiny muted', text: 'Not attempted yet' }),
      h('div', { class: 'row mt-1' }, [
        h('a', { class: 'btn btn--sm btn--primary', href: `#/quiz/${q.id}/take`, text: 'Start' }),
        h('a', { class: 'btn btn--sm', href: `#/quiz/${q.id}/take?review=1`, text: 'Review' }),
      ]),
    ]),
    h('button', { class: 'btn btn--sm btn--ghost btn--icon', type: 'button', 'aria-label': 'Delete quiz', html: icon('trash', 15), onClick: async () => {
      const ok = await confirmDialog({ title: 'Delete quiz?', message: `"${q.title}" and its attempts will be deleted.`, confirmLabel: 'Delete', danger: true });
      if (!ok) return;
      await api.del(`/api/quizzes/${q.id}`);
      toast('Quiz deleted.', 'success');
      navigate('/quiz', { replace: true });
    } }),
  ]);
}

// ---- Builder --------------------------------------------------------------

export async function renderQuizBuilder({ query, setMeta }) {
  setMeta({ title: 'Build a quiz', subtitle: 'Practice or timed exam mode' });

  const [setsData, materialsData, aiMeta] = await Promise.all([
    api.get('/api/sets?limit=100'),
    api.get('/api/materials?limit=100&status=extracted').catch(() => ({ items: [] })),
    api.get('/api/materials/meta').catch(() => ({ ai: { configured: false } })),
  ]);

  const cfg = {
    source: query.setId ? 'set' : (query.materialId ? 'material' : 'set'),
    setId: query.setId || setsData.items[0]?.id || '',
    materialId: query.materialId || materialsData.items[0]?.id || '',
    mode: query.mode === 'exam' ? 'exam' : 'practice',
    questionCount: 10,
    timeLimitMin: 15,
    difficulty: 'mixed',
    showExplanations: true,
    title: '',
  };

  const sourceCards = h('div', { class: 'stack stack--sm' });
  const setSel = h('select', {}, setsData.items.map((s) => h('option', { value: s.id, text: `${s.title} (${s.cardCount} cards)`, selected: s.id === cfg.setId ? true : null })));
  const matSel = h('select', {}, materialsData.items.length
    ? materialsData.items.map((m) => h('option', { value: m.id, text: m.title, selected: m.id === cfg.materialId ? true : null }))
    : [h('option', { value: '', text: 'No materials with extracted text' })]);
  setSel.addEventListener('change', () => { cfg.setId = setSel.value; });
  matSel.addEventListener('change', () => { cfg.materialId = matSel.value; });

  function paintSources() {
    sourceCards.innerHTML = '';
    const setRadio = radio('source', 'From a study set', 'set', cfg.source === 'set', (v) => { cfg.source = v; paintSources(); });
    const matRadio = radio('source', 'From an uploaded document', 'material', cfg.source === 'material', (v) => { cfg.source = v; paintSources(); });
    const manualRadio = radio('source', 'Manual questions', 'manual', cfg.source === 'manual', (v) => { cfg.source = v; paintSources(); });
    sourceCards.append(setRadio, h('div', { class: cfg.source === 'set' ? 'ml-3' : 'hidden', style: 'margin-left:26px' }, [setSel]));
    sourceCards.append(matRadio, h('div', { class: cfg.source === 'material' ? '' : 'hidden', style: 'margin-left:26px' }, [
      matSel,
      aiMeta.ai.configured ? null : h('div', { class: 'alert alert--warning mt-1' }, [h('span', { class: 'small', text: 'AI is not configured, so quizzes from documents are unavailable. Quizzes from study sets still work.' })]),
    ]));
    sourceCards.append(manualRadio, cfg.source === 'manual' ? h('div', { class: 'alert alert--info', style: 'margin-left:26px' }, [h('span', { class: 'small', text: 'Manual mode: add questions after creating the quiz, or use the set-based builder for automatic questions.' })]) : null);
  }

  function radio(name, label, value, checked, onChange) {
    const input = h('input', { type: 'radio', name, value, checked: checked ? true : null });
    input.addEventListener('change', () => onChange(value));
    return h('label', { class: 'checkbox mb-1' }, [input, h('span', { text: label })]);
  }

  const count = h('input', { type: 'number', min: 3, max: 50, value: cfg.questionCount });
  count.addEventListener('change', () => { cfg.questionCount = Math.max(3, Math.min(50, Number(count.value) || 10)); });
  const timeLimit = h('input', { type: 'number', min: 1, max: 180, value: cfg.timeLimitMin });
  timeLimit.addEventListener('change', () => { cfg.timeLimitMin = Math.max(1, Math.min(180, Number(timeLimit.value) || 15)); });
  const difficulty = h('select', {}, ['mixed', 'easy', 'medium', 'hard'].map((d) => h('option', { value: d, text: d[0].toUpperCase() + d.slice(1) })));
  difficulty.addEventListener('change', () => { cfg.difficulty = difficulty.value; });
  const title = h('input', { type: 'text', placeholder: 'Optional quiz title' });
  title.addEventListener('input', () => { cfg.title = title.value; });
  const showExp = h('input', { type: 'checkbox', checked: true });
  showExp.addEventListener('change', () => { cfg.showExplanations = showExp.checked; });
  const timed = h('input', { type: 'checkbox' });
  const timeWrap = h('div', { class: 'field hidden' }, [h('label', { text: 'Time limit (minutes)' }), timeLimit]);
  timed.addEventListener('change', () => {
    cfg.mode = timed.checked ? 'exam' : 'practice';
    timeWrap.classList.toggle('hidden', !timed.checked);
  });

  paintSources();

  const create = h('button', { class: 'btn btn--primary btn--lg', type: 'button', text: 'Create quiz', onClick: async () => {
    create.disabled = true;
    create.innerHTML = '<span class="spinner"></span> Building quiz';
    try {
      const payload = {
        source: cfg.source,
        setId: cfg.source === 'set' ? cfg.setId : undefined,
        materialId: cfg.source === 'material' ? cfg.materialId : undefined,
        mode: cfg.mode,
        questionCount: cfg.questionCount,
        timeLimitSec: cfg.mode === 'exam' ? cfg.timeLimitMin * 60 : null,
        difficulty: cfg.difficulty,
        showExplanations: cfg.showExplanations,
        title: cfg.title || undefined,
      };
      const { quiz } = await api.post('/api/quizzes', payload);
      toast(`Quiz created with ${quiz.questionCount} questions.`, 'success');
      navigate(`/quiz/${quiz.id}/take`);
    } catch (err) {
      toast(err.message, 'error');
      create.disabled = false;
      create.textContent = 'Create quiz';
    }
  } });

  return h('div', { class: 'grid grid--2' }, [
    h('div', { class: 'card card--pad-lg' }, [
      h('h2', { text: 'Question source' }),
      h('p', { class: 'small muted', text: 'Questions are grounded in the source you choose.' }),
      sourceCards,
    ]),
    h('div', { class: 'card card--pad-lg' }, [
      h('h2', { text: 'Quiz settings' }),
      h('div', { class: 'field' }, [h('label', { text: 'Title (optional)' }), title]),
      h('div', { class: 'form-row' }, [
        h('div', { class: 'field' }, [h('label', { text: 'Number of questions' }), count]),
        h('div', { class: 'field' }, [h('label', { text: 'Difficulty' }), difficulty]),
      ]),
      h('label', { class: 'checkbox mb-1' }, [timed, h('span', { text: 'Timed exam mode' })]),
      timeWrap,
      h('label', { class: 'checkbox mb-2' }, [showExp, h('span', { text: 'Show explanations after each question' })]),
      h('div', { class: 'alert alert--info mb-2' }, [h('span', { class: 'small', text: 'Timed exams count against your monthly practice-exam allowance. Progress is saved as you answer, so you can safely navigate away.' })]),
      create,
    ]),
  ]);
}

// ---- Taking ---------------------------------------------------------------

export async function renderQuizTake({ params, query, setMeta }) {
  const quizId = params.id;
  const reviewMode = query.review === '1';
  const { quiz, questions } = await api.get(`/api/quizzes/${quizId}${qs({ reveal: reviewMode ? 1 : 0 })}`);

  if (!questions.length) {
    return emptyState({ icon: 'quiz', title: 'This quiz has no questions', message: 'Rebuild it from a study set or document.', action: h('a', { class: 'btn btn--primary', href: '#/quiz/new', text: 'Build a quiz' }) });
  }

  if (reviewMode) return reviewView(quiz, questions, setMeta);

  const { attemptId, startedAt, timeLimitSec } = await api.post(`/api/quizzes/${quizId}/attempts`, {});
  const state = {
    answers: {},
    index: 0,
    submitted: false,
    startedAt: new Date(startedAt).getTime(),
    remaining: timeLimitSec || null,
  };

  setMeta({ title: quiz.title, subtitle: `${questions.length} questions${timeLimitSec ? ' · timed' : ''}` });

  const root = h('div', { class: 'study-shell' });
  const header = h('div', { class: 'study-bar' });
  const body = h('div');
  const footer = h('div', { class: 'row mt-2', style: 'justify-content:space-between' });
  root.append(header, body, footer);

  function paintHeader() {
    header.innerHTML = '';
    header.append(
      h('span', { class: 'small strong', text: `Question ${state.index + 1} of ${questions.length}` }),
      h('div', { class: 'progress' }, [h('span', { style: `width:${((state.index + 1) / questions.length * 100).toFixed(1)}%` })]),
      h('span', { class: 'tiny muted', text: `${Object.keys(state.answers).length} answered` }),
    );
    if (state.remaining !== null) {
      header.append(h('span', { class: `timer ${state.remaining < 60 ? 'timer--low' : ''}`, text: fmtClock(state.remaining) }));
    }
  }

  function paint() {
    paintHeader();
    const q = questions[state.index];
    body.innerHTML = '';
    const card = h('div', { class: 'card card--pad-lg' }, [
      h('div', { class: 'row row--between mb-2' }, [
        h('span', { class: 'badge', text: q.type === 'mcq' ? 'Multiple choice' : q.type === 'tf' ? 'True / false' : 'Short answer' }),
        q.topic ? h('span', { class: 'tiny muted', text: q.topic }) : null,
      ]),
      h('h2', { text: q.prompt }),
    ]);

    if (q.type === 'mcq' || q.type === 'tf') {
      const opts = h('div', { class: 'stack stack--sm mt-2' });
      for (const opt of q.options) {
        const selected = state.answers[q.id] === opt;
        const btn = h('button', {
          class: 'question-option', type: 'button', dataset: { selected: selected ? '1' : '0' },
          onClick: () => { state.answers[q.id] = opt; save(q.id, opt); paint(); },
        }, [h('span', { class: 'strong', text: opt })]);
        opts.append(btn);
      }
      card.append(opts);
    } else {
      const ta = h('textarea', { rows: 6, placeholder: 'Type your answer…', value: state.answers[q.id] || '' });
      let t;
      ta.addEventListener('input', () => {
        state.answers[q.id] = ta.value;
        clearTimeout(t);
        t = setTimeout(() => { save(q.id, ta.value); paintHeader(); }, 500);
      });
      card.append(h('div', { class: 'field mt-2' }, [h('label', { text: 'Your answer' }), ta,
        h('span', { class: 'field__hint', text: 'Short answers are graded by AI as an estimate. You can adjust the grade afterwards if needed.' })]));
      setTimeout(() => ta.focus(), 20);
    }
    body.append(card);

    footer.innerHTML = '';
    footer.append(
      h('button', { class: 'btn', type: 'button', html: `${icon('back', 15)} Previous`, disabled: state.index === 0, onClick: () => { state.index -= 1; paint(); } }),
      h('div', { class: 'row' }, [
        state.index < questions.length - 1
          ? h('button', { class: 'btn btn--primary', type: 'button', text: 'Next question', onClick: () => { state.index += 1; paint(); } })
          : null,
        h('button', { class: 'btn btn--primary', type: 'button', text: state.index < questions.length - 1 ? 'Submit now' : 'Submit quiz', onClick: () => confirmSubmit() }),
      ]),
    );
  }

  async function save(questionId, response) {
    try { await api.post(`/api/attempts/${attemptId}/answers`, { questionId, response }); } catch { /* retried on submit */ }
  }

  function confirmSubmit() {
    const unanswered = questions.length - Object.keys(state.answers).length;
    modal({
      title: 'Submit this quiz?',
      body: h('div', {}, [
        h('p', { text: unanswered > 0 ? `${unanswered} question${unanswered === 1 ? '' : 's'} still unanswered. You can still submit, but unanswered questions are marked incorrect.` : 'All questions answered.' }),
        h('p', { class: 'small muted mb-0', text: 'Short answers may be graded by AI, which is an estimate rather than a definitive mark.' }),
      ]),
      actions: [{ label: 'Keep working' }, { label: 'Submit', variant: 'primary', onClick: submit }],
    });
  }

  async function submit() {
    try {
      const result = await api.post(`/api/attempts/${attemptId}/submit`, {});
      state.submitted = true;
      toast(`Scored ${pct(result.score)} (${result.correctCount}/${result.total}).`, 'success');
      navigate(`/results/${attemptId}`);
    } catch (err) { toast(err.message, 'error'); }
  }

  // Timer
  let timer = null;
  if (timeLimitSec) {
    timer = setInterval(() => {
      state.remaining = Math.max(0, Math.round((state.startedAt + timeLimitSec * 1000 - Date.now()) / 1000));
      paintHeader();
      if (state.remaining <= 0) {
        clearInterval(timer);
        toast('Time is up — submitting your answers.', 'info');
        submit();
      }
    }, 1000);
  }
  const observer = new MutationObserver(() => {
    if (!document.body.contains(root)) { if (timer) clearInterval(timer); observer.disconnect(); }
  });
  observer.observe(document.body, { childList: true, subtree: true });

  paint();
  return root;
}

function reviewView(quiz, questions, setMeta) {
  setMeta({ title: quiz.title, subtitle: 'Review mode — answers revealed' });
  const wrap = h('div', { class: 'stack' });
  questions.forEach((q, i) => {
    wrap.append(h('div', { class: 'card' }, [
      h('div', { class: 'row row--between mb-1' }, [h('span', { class: 'badge', text: `#${i + 1} · ${q.type}` }), q.topic ? h('span', { class: 'tiny muted', text: q.topic }) : null]),
      h('h3', { text: q.prompt }),
      q.options?.length ? h('div', { class: 'stack stack--sm mb-1' }, q.options.map((o) => h('div', {
        class: 'question-option', dataset: { state: o === q.correctAnswer ? 'correct' : '0' },
      }, [h('span', { text: o })]))) : null,
      q.type === 'short' ? h('div', { class: 'alert alert--success' }, [h('span', { text: `Model answer: ${q.correctAnswer}` })]) : null,
      q.explanation ? h('p', { class: 'small muted mt-1 mb-0', text: q.explanation }) : null,
      q.misconception ? h('p', { class: 'small', style: 'color:var(--warning)', text: `Common misconception: ${q.misconception}` }) : null,
    ]));
  });
  return h('div', {}, [h('a', { class: 'btn btn--sm btn--ghost mb-2', href: '#/quiz', html: `${icon('back', 15)} All quizzes` }), wrap]);
}

// ---- Results --------------------------------------------------------------

export async function renderResults({ params, setMeta }) {
  const attemptId = params.attemptId;
  const [data, summary] = await Promise.all([
    api.get(`/api/attempts/${attemptId}`),
    api.get(`/api/attempts/${attemptId}/summary`),
  ]);
  const a = data.attempt;
  setMeta({ title: 'Quiz results', subtitle: `${pct(a.score)} · ${a.correctCount}/${a.total} correct` });

  const missed = data.questions.filter((q) => q.isCorrect === false);
  const needsSelfGrade = data.questions.filter((q) => q.type === 'short' && q.isCorrect === false && q.aiScore === null);

  const actions = h('div', { class: 'row row--wrap mb-2' }, [
    h('button', { class: 'btn btn--primary', type: 'button', text: 'Retry missed questions', disabled: !missed.length, onClick: async () => {
      try {
        const r = await api.post(`/api/attempts/${attemptId}/retry-incorrect`, {});
        toast(`Created a quiz with ${r.questionCount} questions.`, 'success');
        navigate(`/quiz/${r.quizId}/take`);
      } catch (err) { toast(err.message, 'error'); }
    } }),
    h('button', { class: 'btn', type: 'button', text: 'Turn missed into flashcards', disabled: !missed.length, onClick: async () => {
      try {
        const r = await api.post('/api/study/from-missed', { attemptId });
        toast(`Created ${r.created} flashcards.`, 'success');
        navigate(`/sets/${r.setId}`);
      } catch (err) { toast(err.message, 'error'); }
    } }),
    h('a', { class: 'btn', href: `#/quiz/${a.quizId}/take`, text: 'Retake full quiz' }),
    h('a', { class: 'btn', href: '#/quiz', text: 'All quizzes' }),
  ]);

  const wrap = h('div', { class: 'stack stack--lg' }, [
    actions,
    h('div', { class: 'grid grid--4' }, [
      stat('Score', pct(a.score), `${a.correctCount} of ${a.total}`),
      stat('Time taken', fmtDuration(a.timeSpentSec), `submitted ${fmtRelative(a.submittedAt)}`),
      stat('Missed', String(missed.length), missed.length ? 'review below' : 'nothing missed'),
      stat('Previous attempts', String(summary.previousScores.length), summary.previousScores.length ? `best ${pct(Math.max(...summary.previousScores.map((s) => s.score)))}` : 'first attempt'),
    ]),
    h('div', { class: 'card' }, [
      h('h3', { text: 'Performance by topic' }),
      summary.byTopic.length
        ? h('div', {}, summary.byTopic.map((t) => h('div', { class: 'bar-row' }, [
            h('span', { class: 'truncate', text: t.topic }),
            h('span', { class: 'bar-track' }, [h('span', { class: `bar-fill ${t.accuracy < 0.6 ? 'progress--warning' : ''}`, style: `width:${(t.accuracy * 100).toFixed(1)}%` })]),
            h('span', { class: 'tiny muted', text: pct(t.accuracy) }),
          ])))
        : h('p', { class: 'small muted mb-0', text: 'No topic data for this attempt.' }),
    ]),
    needsSelfGrade.length ? h('div', { class: 'alert alert--warning' }, [
      h('div', {}, [
        h('div', { class: 'strong', text: `${needsSelfGrade.length} short answer${needsSelfGrade.length === 1 ? '' : 's'} could not be auto-graded` }),
        h('div', { class: 'small', text: 'AI grading is unavailable, so mark these yourself using the model answer below.' }),
      ]),
    ]) : null,
    h('h3', { text: 'Question review' }),
    ...data.questions.map((q, i) => questionReview(q, i, attemptId, needsSelfGrade.includes(q))),
  ]);

  return wrap;
}

function stat(label, value, meta) {
  return h('div', { class: 'card' }, [h('div', { class: 'stat' }, [
    h('span', { class: 'stat__label', text: label }),
    h('span', { class: 'stat__value', text: value }),
    h('span', { class: 'stat__meta', text: meta }),
  ])]);
}

function questionReview(q, i, attemptId, selfGrade) {
  const correct = q.isCorrect;
  const card = h('div', { class: 'card' }, [
    h('div', { class: 'row row--between mb-1' }, [
      h('span', { class: `badge ${correct ? 'badge--success' : 'badge--danger'}`, text: correct ? 'Correct' : 'Incorrect' }),
      q.topic ? h('span', { class: 'tiny muted', text: q.topic }) : null,
    ]),
    h('h3', { text: q.prompt }),
  ]);
  if (q.options?.length) {
    card.append(h('div', { class: 'stack stack--sm' }, q.options.map((o) => {
      const isCorrect = o === q.correctAnswer;
      const isChosen = o === q.response;
      return h('div', { class: 'question-option', dataset: { state: isCorrect ? 'correct' : (isChosen ? 'wrong' : '0') } }, [
        h('span', { text: o }),
        isChosen ? h('span', { class: 'ml-auto tiny', text: 'your answer' }) : null,
      ]);
    })));
  } else {
    card.append(h('div', { class: 'stack stack--sm' }, [
      h('div', { class: 'small' }, [h('span', { class: 'muted', text: 'Your answer: ' }), h('span', { text: q.response || '(blank)' })]),
      h('div', { class: 'small' }, [h('span', { class: 'muted', text: 'Model answer: ' }), h('span', { text: q.correctAnswer })]),
    ]));
    if (selfGrade) {
      card.append(h('div', { class: 'row mt-2' }, [
        h('button', { class: 'btn btn--sm', type: 'button', text: 'Mark as correct', onClick: async (e) => {
          await api.post(`/api/attempts/${attemptId}/self-grade`, { questionId: q.id, correct: true });
          toast('Marked correct.', 'success'); e.currentTarget.closest('.card').querySelector('.badge').className = 'badge badge--success';
          e.currentTarget.closest('.card').querySelector('.badge').textContent = 'Correct';
        } }),
        h('button', { class: 'btn btn--sm', type: 'button', text: 'Keep incorrect', onClick: () => toast('Kept as incorrect.', 'info') }),
      ]));
    }
  }
  if (q.aiFeedback) card.append(h('p', { class: 'small mt-1', text: `AI feedback (estimate): ${q.aiFeedback}` }));
  if (q.explanation) card.append(h('p', { class: 'small muted mt-1 mb-0', text: q.explanation }));
  if (q.misconception) card.append(h('p', { class: 'small', style: 'color:var(--warning)', text: `Common misconception: ${q.misconception}` }));
  return card;
}
