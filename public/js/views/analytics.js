import {
  h, icon, toast, lineChart, barChart, heatmap, topicBars, emptyState, pct, fmtDuration, plural, esc,
} from '../ui.js';
import { api, qs } from '../api.js';
import { navigate } from '../router.js';

export async function renderAnalytics({ setMeta }) {
  let range = 30;
  let data = await api.get(`/api/analytics${qs({ days: range })}`);

  setMeta({
    title: 'Progress Analytics',
    subtitle: `Last ${range} days`,
    actions: [
      h('select', { 'aria-label': 'Time range', onChange: async (e) => {
        range = Number(e.target.value);
        data = await api.get(`/api/analytics${qs({ days: range })}`);
        setMeta({ title: 'Progress Analytics', subtitle: `Last ${range} days` });
        paint();
      } }, [7, 30, 90, 180].map((d) => h('option', { value: d, text: `Last ${d} days`, selected: d === range ? true : null }))),
      h('a', { class: 'btn', href: '#/planner', text: 'Open planner' }),
    ],
  });

  const wrap = h('div', { class: 'stack stack--lg' });

  function paint() {
    wrap.innerHTML = '';
    const t = data.totals;
    const hasData = t.cardsReviewed || t.questionsAnswered;

    wrap.append(h('div', { class: 'grid grid--4' }, [
      stat('Study time', fmtDuration(t.studySeconds), `${t.studyMinutes} minutes total`),
      stat('Cards reviewed', String(t.cardsReviewed), data.reviewAccuracy.total ? `${pct(data.reviewAccuracy.accuracy)} recall accuracy` : 'no reviews yet'),
      stat('Questions answered', String(t.questionsAnswered), t.quizAccuracy !== null ? `${pct(t.quizAccuracy)} correct` : 'no quiz data'),
      stat('Consistency', pct(data.consistency.rate), `${data.consistency.daysStudied} of ${data.consistency.days} days · ${data.streak.current}-day streak`, true),
    ]));

    if (!hasData) {
      wrap.append(emptyState({
        icon: 'analytics',
        title: 'No study data in this period',
        message: 'Review some flashcards or take a practice quiz and your progress will appear here.',
        action: h('div', { class: 'row', style: 'justify-content:center' }, [
          h('a', { class: 'btn btn--primary', href: '#/study', text: 'Start reviewing' }),
          h('a', { class: 'btn', href: '#/quiz/new', text: 'Build a quiz' }),
        ]),
      }));
      return;
    }

    wrap.append(h('div', { class: 'grid grid--2' }, [
      h('div', { class: 'card' }, [
        h('div', { class: 'card__head' }, [h('h3', { class: 'mb-0', text: 'Study minutes over time' })]),
        h('div', { class: 'chart-wrap', html: lineChart({
          series: data.activity.map((d) => d.minutes),
          labels: data.activity.map((d) => d.date.slice(5)),
          yFormat: (v) => `${Math.round(v)}m`,
        }) }),
      ]),
      h('div', { class: 'card' }, [
        h('div', { class: 'card__head' }, [h('h3', { class: 'mb-0', text: 'Cards reviewed' })]),
        h('div', { class: 'chart-wrap', html: barChart({
          series: data.activity.map((d) => d.cardsReviewed),
          labels: data.activity.map((d) => d.date.slice(5)),
        }) }),
      ]),
    ]));

    wrap.append(h('div', { class: 'grid grid--2' }, [
      h('div', { class: 'card' }, [
        h('h3', { text: 'Quiz scores over time' }),
        data.quizzes.length
          ? h('div', { class: 'chart-wrap', html: lineChart({
              series: data.quizzes.map((q) => Math.round(q.score * 100)),
              labels: data.quizzes.map((q, i) => `#${i + 1}`),
              yFormat: (v) => `${Math.round(v)}%`,
              color: 'var(--success)',
            }) })
          : h('p', { class: 'small muted mb-0', text: 'No submitted quizzes yet.' }),
        data.improvement ? h('p', { class: 'small mt-1', text: data.improvement.delta === null
          ? 'Not enough attempts to compare yet.'
          : `Average score ${data.improvement.delta >= 0 ? 'improved' : 'declined'} by ${Math.abs(data.improvement.delta * 100).toFixed(0)} points compared with your previous five attempts.` }) : null,
      ]),
      h('div', { class: 'card' }, [
        h('h3', { text: 'Review backlog' }),
        h('div', { class: 'kv' }, [
          h('dt', { text: 'Due now' }), h('dd', { text: String(data.backlog.due) }),
          h('dt', { text: 'In learning / relearning' }), h('dd', { text: String(data.backlog.overdueLearning) }),
          h('dt', { text: 'Total cards' }), h('dd', { text: String(data.backlog.totalCards) }),
          h('dt', { text: 'New cards not yet studied' }), h('dd', { text: String(data.schedule.byState.new) }),
        ]),
        h('div', { class: 'mt-2' }, [
          h('div', { class: 'small muted mb-1', text: 'Study consistency' }),
          heatmap(data.activity),
          h('div', { class: 'tiny muted mt-1', text: 'Each square is one day; darker means more activity.' }),
        ]),
      ]),
    ]));

    if (data.advanced) {
      wrap.append(h('div', { class: 'grid grid--2' }, [
        h('div', { class: 'card' }, [
          h('h3', { text: 'Performance by topic' }),
          data.topics?.length ? h('div', { html: topicBars(data.topics) }) : h('p', { class: 'small muted mb-0', text: 'Not enough topic data yet.' }),
        ]),
        h('div', { class: 'card' }, [
          h('h3', { text: 'Frequently missed concepts' }),
          data.frequentlyMissed?.length
            ? h('div', { class: 'stack stack--sm' }, data.frequentlyMissed.map((f) => h('div', { class: 'row row--between small' }, [
                h('span', { class: 'truncate', text: f.topic }),
                h('span', { class: 'badge badge--danger', text: `${f.missed} missed of ${f.total}` }),
              ])))
            : h('p', { class: 'small muted mb-0', text: 'No missed questions recorded yet.' }),
        ]),
      ]));

      wrap.append(h('div', { class: 'card' }, [
        h('div', { class: 'card__head' }, [
          h('h3', { class: 'mb-0', text: 'Insights' }),
          h('button', { class: 'btn btn--sm spacer', type: 'button', html: `${icon('cards', 14)} Generate AI insights`, onClick: async (e) => {
            e.currentTarget.disabled = true;
            e.currentTarget.innerHTML = '<span class="spinner"></span> Thinking';
            try {
              const r = await api.post('/api/analytics/insights', {});
              renderInsights(r.insights);
            } catch (err) { toast(err.message, 'error'); }
            finally { e.currentTarget.disabled = false; e.currentTarget.innerHTML = `${icon('cards', 14)} Generate AI insights`; }
          } }),
        ]),
        h('div', { class: 'stack stack--sm' }, data.insights.map((s) => h('div', { class: 'alert alert--info' }, [h('span', { text: s })]))),
      ]));
    } else {
      wrap.append(h('div', { class: 'card', style: 'text-align:center' }, [
        h('h3', { text: 'Advanced analytics are part of Recall Plus' }),
        h('p', { class: 'small muted', text: data.upgradeHint }),
        h('a', { class: 'btn btn--primary', href: '#/billing', text: 'See Recall Plus' }),
      ]));
    }

    wrap.append(h('p', { class: 'tiny muted', text: data.minimumSampleNote }));
  }

  function renderInsights(insights) {
    const container = wrap.querySelector('.card:last-of-type .stack');
    if (!container) return;
    container.innerHTML = '';
    for (const s of insights) container.append(h('div', { class: 'alert alert--info' }, [h('span', { text: s })]));
  }

  function stat(label, value, meta, accent = false) {
    return h('div', { class: 'card' }, [h('div', { class: `stat ${accent ? 'stat--accent' : ''}` }, [
      h('span', { class: 'stat__label', text: label }),
      h('span', { class: 'stat__value', text: value }),
      h('span', { class: 'stat__meta', text: meta }),
    ])]);
  }

  paint();
  return wrap;
}
