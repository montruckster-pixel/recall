import { h, icon, toast, modal, confirmDialog, emptyState, badgeFor, fmtDate, plural, pct } from '../ui.js';
import { api } from '../api.js';
import { navigate } from '../router.js';

export async function renderPlanner({ setMeta }) {
  let data = await api.get('/api/planner?days=14');
  setMeta({
    title: 'Study Planner',
    subtitle: data.examDate ? `Exam ${fmtDate(data.examDate)}` : 'No exam date set',
    actions: [
      h('button', { class: 'btn', type: 'button', html: `${icon('shuffle', 15)} Regenerate plan`, onClick: async () => {
        try { data = await api.post('/api/planner/regenerate', { days: 14 }); paint(); toast('Plan regenerated.', 'success'); }
        catch (err) { toast(err.message, 'error'); }
      } }),
      h('button', { class: 'btn btn--primary', type: 'button', html: `${icon('plus', 15)} Add session`, onClick: () => addSession(paint) }),
    ],
  });

  const wrap = h('div');
  const daysWrap = h('div', { class: 'stack stack--sm' });

  function paint() {
    wrap.innerHTML = '';
    wrap.append(
      h('div', { class: 'alert alert--info mb-2' }, [
        h('span', { html: icon('alert', 16) }),
        h('span', { text: data.note }),
      ]),
      daysWrap,
    );
    daysWrap.innerHTML = '';
    for (const day of data.days) {
      daysWrap.append(dayCard(day, paint));
    }
  }

  function dayCard(day, reload) {
    const isToday = day.date === new Date().toISOString().slice(0, 10);
    const total = day.tasks.length;
    const done = day.tasks.filter((t) => t.status === 'done').length;
    const card = h('div', { class: 'card' }, [
      h('div', { class: 'row row--between' }, [
        h('div', { class: 'row' }, [
          h('span', { class: 'strong', text: fmtDate(`${day.date}T00:00:00Z`, { weekday: 'short', year: undefined }) }),
          isToday ? h('span', { class: 'badge badge--accent', text: 'Today' }) : null,
          !day.available ? h('span', { class: 'badge', text: 'Rest day' }) : null,
        ]),
        h('span', { class: 'tiny muted', text: day.available ? `${done}/${total} done · ${day.goalMinutes}m goal` : 'Not a study day' }),
      ]),
    ]);
    if (!day.available) return card;
    if (!total) {
      card.append(h('div', { class: 'small muted mt-1', text: 'Nothing scheduled. Add a session or regenerate the plan.' }));
      return card;
    }
    for (const t of day.tasks) {
      card.append(h('div', { class: 'list-item mt-1' }, [
        h('button', {
          class: 'btn btn--ghost btn--icon', type: 'button', 'aria-label': 'Toggle complete',
          html: icon('check', 16), style: t.status === 'done' ? 'color:var(--success)' : 'color:var(--muted)',
          onClick: async () => {
            await api.put(`/api/planner/tasks/${t.id}`, { status: t.status === 'done' ? 'pending' : 'done' });
            await refresh(); reload();
          },
        }),
        h('div', { class: 'list-item__main' }, [
          h('div', { class: 'list-item__title', style: t.status === 'done' ? 'text-decoration:line-through;opacity:.6' : '', text: t.title }),
          h('div', { class: 'tiny muted', text: `${t.estMinutes} min${t.detail ? ` · ${t.detail}` : ''}` }),
        ]),
        h('span', { html: badgeFor(t.status) }),
        h('div', { class: 'row' }, [
          h('button', { class: 'btn btn--sm btn--ghost btn--icon', type: 'button', 'aria-label': 'Reschedule', html: icon('planner', 14), onClick: () => reschedule(t, reload) }),
          h('button', { class: 'btn btn--sm btn--ghost btn--icon', type: 'button', 'aria-label': 'Delete session', html: icon('trash', 14), onClick: async () => {
            const ok = await confirmDialog({ title: 'Remove session?', message: `"${t.title}" will be removed from your plan.`, confirmLabel: 'Remove', danger: true });
            if (!ok) return;
            await api.del(`/api/planner/tasks/${t.id}`);
            await refresh(); reload();
          } }),
        ]),
      ]));
    }
    return card;
  }

  async function refresh() { data = await api.get('/api/planner?days=14'); }

  paint();
  return wrap;
}

async function reschedule(task, reload) {
  const input = h('input', { type: 'date', value: task.date });
  modal({
    title: 'Reschedule session',
    body: h('div', { class: 'field' }, [h('label', { text: 'New date' }), input]),
    actions: [{ label: 'Cancel' }, { label: 'Move', variant: 'primary', onClick: async () => {
      await api.put(`/api/planner/tasks/${task.id}`, { date: input.value, status: 'pending' });
      toast('Session moved.', 'success');
      await reload();
    } }],
  });
}

async function addSession(reload) {
  const title = h('input', { type: 'text', placeholder: 'e.g. Review chapter 5' });
  const date = h('input', { type: 'date', value: new Date().toISOString().slice(0, 10) });
  const minutes = h('input', { type: 'number', min: 5, max: 240, value: 20 });
  const type = h('select', {}, [
    ['custom', 'Custom'], ['review', 'Flashcard review'], ['quiz', 'Practice quiz'], ['read', 'Reading'], ['weak', 'Weak topic'],
  ].map(([v, l]) => h('option', { value: v, text: l })));
  modal({
    title: 'Add a study session',
    body: h('div', {}, [
      h('div', { class: 'field' }, [h('label', { text: 'Title' }), title]),
      h('div', { class: 'form-row' }, [
        h('div', { class: 'field' }, [h('label', { text: 'Date' }), date]),
        h('div', { class: 'field' }, [h('label', { text: 'Minutes' }), minutes]),
      ]),
      h('div', { class: 'field' }, [h('label', { text: 'Type' }), type]),
    ]),
    actions: [{ label: 'Cancel' }, { label: 'Add', variant: 'primary', onClick: async () => {
      if (!title.value.trim()) { toast('Give the session a title.', 'error'); return false; }
      await api.post('/api/planner/tasks', { title: title.value.trim(), date: date.value, estMinutes: Number(minutes.value), type: type.value });
      toast('Session added.', 'success');
      await reload();
      return true;
    } }],
  });
}
