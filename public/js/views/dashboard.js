import { h, icon, esc, pct, fmtDate, fmtRelative, fmtDuration, plural, badgeFor, emptyState, toast } from '../ui.js';
import { api } from '../api.js';
import { navigate } from '../router.js';
import { getState, setState } from '../store.js';

export async function renderDashboard({ setMeta }) {
  const data = await api.get('/api/dashboard');
  setState({ dashboard: data, entitlements: data.plan });
  setMeta({
    title: greeting(data),
    subtitle: data.profile?.certName ? `${data.profile.certName}${data.exam?.daysLeft >= 0 ? ` · ${data.exam.daysLeft} days to exam` : ''}` : 'Your study system',
  });

  if (!data.onboarding.onboarded) {
    return emptyState({
      icon: 'dashboard',
      title: 'Finish setting up your study profile',
      message: 'Answer a few questions so Recall can build your study plan.',
      action: h('a', { class: 'btn btn--primary', href: '#/onboarding', text: 'Continue setup' }),
    });
  }

  const wrap = h('div', { class: 'stack stack--lg' });

  // First-use guidance
  if (!data.onboarding.hasMaterials && !data.onboarding.hasCards) {
    wrap.append(firstUseCard(data));
  }

  // Top row: progress + exam
  wrap.append(h('div', { class: 'grid grid--4' }, [
    statCard('Cards reviewed today', String(data.today.progress.cardsReviewed), `goal ${data.today.progress.goalCards}`),
    statCard('Questions answered', String(data.today.progress.questionsAnswered), data.today.progress.accuracy !== null ? `${pct(data.today.progress.accuracy)} correct` : 'no answers yet'),
    statCard('Study time today', fmtDuration(data.today.progress.studySeconds), `goal ${data.today.progress.goalMinutes}m`),
    statCard('Due for review', String(data.dueCards), data.streak.current > 0 ? `${data.streak.current}-day streak` : 'start a streak today', true),
  ]));

  // Daily goal progress
  wrap.append(h('div', { class: 'card' }, [
    h('div', { class: 'row row--between mb-1' }, [
      h('h3', { class: 'mb-0', text: 'Daily progress' }),
      h('span', { class: 'small muted', text: `${pct(data.today.progress.cardsPercent)} of card goal · ${pct(data.today.progress.minutesPercent)} of time goal` }),
    ]),
    progressRow('Cards', data.today.progress.cardsReviewed, data.today.progress.goalCards, 'cards'),
    progressRow('Study time', Math.round(data.today.progress.studySeconds / 60), data.today.progress.goalMinutes, 'min'),
  ]));

  // Today's plan + continue
  wrap.append(h('div', { class: 'grid grid--2' }, [
    todayPlanCard(data),
    h('div', { class: 'stack' }, [
      continueCard(data),
      data.exam ? examCard(data.exam) : h('div', { class: 'card' }, [
        h('h3', { text: 'Upcoming exam' }),
        h('p', { class: 'small muted', text: 'Add a target exam date to see a countdown and pacing recommendations.' }),
        h('button', { class: 'btn btn--sm', type: 'button', text: 'Add exam date', onClick: () => navigate('/settings') }),
      ]),
    ]),
  ]));

  // Areas to improve + recent activity
  wrap.append(h('div', { class: 'grid grid--2' }, [
    improveCard(data),
    recentCard(data),
  ]));

  return wrap;
}

function greeting(data) {
  const hour = new Date().getHours();
  const name = (getState().user?.displayName || '').split(' ')[0];
  const part = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
  return name ? `${part}, ${name}` : part;
}

function statCard(label, value, meta, accent = false) {
  return h('div', { class: 'card' }, [
    h('div', { class: `stat ${accent ? 'stat--accent' : ''}` }, [
      h('span', { class: 'stat__label', text: label }),
      h('span', { class: 'stat__value', text: value }),
      h('span', { class: 'stat__meta', text: meta }),
    ]),
  ]);
}

function progressRow(label, value, goal, unit) {
  const p = goal ? Math.min(1, value / goal) : 0;
  return h('div', { class: 'mb-2' }, [
    h('div', { class: 'row row--between small' }, [
      h('span', { class: 'muted', text: label }),
      h('span', { text: `${value} / ${goal} ${unit}` }),
    ]),
    h('div', { class: 'progress mt-1' }, [h('span', { style: `width:${(p * 100).toFixed(1)}%` })]),
  ]);
}

function todayPlanCard(data) {
  const tasks = data.today.tasks || [];
  const card = h('div', { class: 'card' }, [
    h('div', { class: 'card__head' }, [
      h('h3', { class: 'mb-0', text: "Today's study plan" }),
      h('span', { class: 'badge badge--accent spacer', text: 'Adaptive' }),
    ]),
  ]);
  if (!tasks.length) {
    card.append(emptyState({
      icon: 'planner',
      title: 'Nothing scheduled today',
      message: 'That may be a rest day, or there is nothing due. You can always study ahead.',
      action: h('a', { class: 'btn btn--sm', href: '#/study', text: 'Study anyway' }),
    }));
    return card;
  }
  for (const t of tasks) {
    const done = t.status === 'done';
    card.append(h('div', { class: 'list-item' }, [
      h('button', {
        class: 'btn btn--ghost btn--icon', type: 'button', 'aria-label': done ? 'Mark as not done' : 'Mark as done',
        html: icon('check', 16), style: done ? 'color:var(--success)' : 'color:var(--muted)',
        onClick: async (e) => {
          e.currentTarget.disabled = true;
          try {
            await api.put(`/api/planner/tasks/${t.id}`, { status: done ? 'pending' : 'done' });
            const refreshed = await api.get('/api/dashboard');
            setState({ dashboard: refreshed });
            navigate('/dashboard', { replace: true });
          } catch (err) { toast(err.message, 'error'); e.currentTarget.disabled = false; }
        },
      }),
      h('div', { class: 'list-item__main' }, [
        h('div', { class: 'list-item__title', style: done ? 'text-decoration:line-through;opacity:.6' : '', text: t.title }),
        h('div', { class: 'tiny muted', text: `${t.estMinutes} min${t.detail ? ` · ${t.detail}` : ''}` }),
      ]),
      h('span', { html: badgeFor(t.status) }),
      taskAction(t),
    ]));
  }
  return card;
}

function taskAction(t) {
  if (t.status === 'done') return null;
  if (t.type === 'review') return h('a', { class: 'btn btn--sm btn--primary', href: '#/study', text: 'Start' });
  if (t.type === 'quiz') return h('a', { class: 'btn btn--sm btn--primary', href: `#/quiz/new${t.refSetId ? `?setId=${t.refSetId}` : ''}`, text: 'Start' });
  if (t.refSetId) return h('a', { class: 'btn btn--sm', href: `#/study/${t.refSetId}`, text: 'Study' });
  if (t.type === 'new') return h('a', { class: 'btn btn--sm', href: '#/materials', text: 'Add' });
  return null;
}

function continueCard(data) {
  const c = data.continue;
  const card = h('div', { class: 'card' }, [h('h3', { text: 'Continue studying' })]);
  if (!c) {
    card.append(h('p', { class: 'small muted mb-2', text: 'Nothing in progress yet. Create a study set or start a review session.' }));
    card.append(h('a', { class: 'btn btn--primary btn--sm', href: '#/sets', text: 'Go to study sets' }));
    return card;
  }
  if (c.kind === 'attempt') {
    card.append(h('div', { class: 'row row--between' }, [
      h('div', {}, [h('div', { class: 'strong', text: c.title }), h('div', { class: 'tiny muted', text: 'Practice attempt in progress' })]),
      h('a', { class: 'btn btn--primary btn--sm', href: `#/quiz/${c.quizId}/take`, text: 'Resume' }),
    ]));
  } else if (c.kind === 'review') {
    card.append(h('div', { class: 'row row--between' }, [
      h('div', {}, [h('div', { class: 'strong', text: c.title }), h('div', { class: 'tiny muted', text: 'Spaced repetition queue' })]),
      h('a', { class: 'btn btn--primary btn--sm', href: '#/study', text: 'Review' }),
    ]));
  } else {
    card.append(h('div', { class: 'row row--between' }, [
      h('div', {}, [h('div', { class: 'strong', text: c.title }), h('div', { class: 'tiny muted', text: `${plural(c.cardCount, 'card')} · last studied ${fmtRelative(c.lastStudiedAt)}` })]),
      h('a', { class: 'btn btn--primary btn--sm', href: `#/study/${c.setId}`, text: 'Continue' }),
    ]));
  }
  return card;
}

function examCard(exam) {
  const days = exam.daysLeft;
  return h('div', { class: 'card' }, [
    h('div', { class: 'row row--between' }, [
      h('h3', { class: 'mb-0', text: 'Upcoming exam' }),
      h('span', { class: `badge ${exam.readinessLabel === 'On track' ? 'badge--success' : exam.readinessLabel === 'Getting there' ? 'badge--warning' : 'badge--danger'}`, text: exam.readinessLabel }),
    ]),
    h('div', { class: 'row mt-1' }, [
      h('span', { class: 'stat__value', text: days >= 0 ? String(days) : '—' }),
      h('span', { class: 'muted small', text: days >= 0 ? `days until ${fmtDate(exam.examDate)}` : `exam date passed (${fmtDate(exam.examDate)})` }),
    ]),
    h('div', { class: 'mt-2' }, [
      h('div', { class: 'row row--between small' }, [h('span', { class: 'muted', text: 'Estimated readiness' }), h('span', { text: pct(exam.readiness) })]),
      h('div', { class: 'progress mt-1' }, [h('span', { class: exam.readiness >= 0.5 ? 'progress--success' : 'progress--warning', style: `width:${(exam.readiness * 100).toFixed(1)}%` })]),
    ]),
    h('div', { class: 'kv mt-2' }, [
      h('dt', { text: 'Cards studied' }), h('dd', { text: `${exam.studiedCards} / ${exam.totalCards}` }),
      h('dt', { text: 'Recent quiz average' }), h('dd', { text: exam.components.quizAverage === null ? '—' : pct(exam.components.quizAverage) }),
      h('dt', { text: 'Recommended per day' }), h('dd', { text: exam.recommendedPerDay ? `${exam.recommendedPerDay} cards` : '—' }),
    ]),
    h('p', { class: 'tiny muted mt-2 mb-0', text: exam.note }),
  ]);
}

function improveCard(data) {
  const card = h('div', { class: 'card' }, [h('h3', { text: 'Areas to improve' })]);
  const rows = data.areasToImprove || [];
  if (!rows.length) {
    card.append(h('p', { class: 'small muted mb-0', text: 'Not enough quiz data yet. Answer at least four questions in a topic and Recall will surface weak areas here.' }));
    return card;
  }
  for (const r of rows) {
    card.append(h('div', { class: 'bar-row' }, [
      h('span', { class: 'truncate', title: r.topic, text: r.topic }),
      h('span', { class: 'bar-track' }, [h('span', { class: `bar-fill ${r.accuracy < 0.6 ? 'progress--warning' : ''}`, style: `width:${(r.accuracy * 100).toFixed(1)}%` })]),
      h('span', { class: 'tiny muted', text: pct(r.accuracy) }),
    ]));
  }
  card.append(h('a', { class: 'btn btn--sm mt-1', href: '#/analytics', text: 'See full analytics' }));
  return card;
}

function recentCard(data) {
  const card = h('div', { class: 'card' }, [h('h3', { text: 'Recent activity' })]);
  const items = data.recentActivity || [];
  if (!items.length) {
    card.append(h('p', { class: 'small muted mb-0', text: 'Your uploads, quizzes and study sets will appear here.' }));
    return card;
  }
  for (const it of items.slice(0, 7)) {
    card.append(h('div', { class: 'row small', style: 'padding:6px 0;border-bottom:1px solid var(--border)' }, [
      h('span', { html: icon(iconFor(it.type), 15) }),
      h('span', { class: 'truncate', style: 'flex:1', text: it.title }),
      it.type === 'attempt' ? h('span', { class: 'badge', text: `${it.score !== null ? pct(it.score) : '—'}` }) : null,
      it.type === 'material' ? h('span', { html: badgeFor(it.status) }) : null,
      h('span', { class: 'tiny muted', text: fmtRelative(it.at) }),
    ]));
  }
  return card;
}

function iconFor(type) {
  return { material: 'upload', set: 'sets', attempt: 'quiz', reviews: 'cards' }[type] || 'cards';
}

function firstUseCard(data) {
  const steps = [
    { done: data.onboarding.hasMaterials, label: 'Upload your first study material', href: '#/materials', cta: 'Upload' },
    { done: data.onboarding.hasSets, label: 'Create or generate a study set', href: '#/sets', cta: 'Go to sets' },
    { done: data.onboarding.hasCards, label: 'Add flashcards to review', href: '#/sets', cta: 'Add cards' },
    { done: data.onboarding.hasReviews, label: 'Complete your first review session', href: '#/study', cta: 'Study' },
  ];
  return h('div', { class: 'card card--pad-lg' }, [
    h('h3', { text: 'Welcome to Recall — here is how to start' }),
    h('p', { class: 'small muted', text: 'Four steps and you will have a working study system built from your own materials.' }),
    h('div', { class: 'stack stack--sm mt-1' }, steps.map((s, i) => h('div', { class: 'row' }, [
      h('span', { class: 'step-num', style: s.done ? 'background:var(--success-soft);color:var(--success)' : '', text: s.done ? '✓' : String(i + 1) }),
      h('span', { style: `flex:1;${s.done ? 'opacity:.6;text-decoration:line-through' : ''}`, text: s.label }),
      s.done ? h('span', { class: 'badge badge--success', text: 'Done' }) : h('a', { class: 'btn btn--sm', href: s.href, text: s.cta }),
    ]))),
  ]);
}
