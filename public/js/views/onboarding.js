import { h, icon, toast, esc, emptyState } from '../ui.js';
import { api } from '../api.js';
import { navigate } from '../router.js';
import { getState, setState } from '../store.js';

const LEVELS = [
  { value: 'beginner', label: 'Just starting out', hint: 'New to the subject matter.' },
  { value: 'intermediate', label: 'Some experience', hint: 'I know the basics and need structure.' },
  { value: 'advanced', label: 'Fairly confident', hint: 'I need targeted gap-filling.' },
];
const METHODS = [
  { value: 'flashcards', label: 'Flashcards' },
  { value: 'practice-questions', label: 'Practice questions' },
  { value: 'reading', label: 'Reading & summaries' },
  { value: 'video', label: 'Video' },
  { value: 'teaching-others', label: 'Explaining to others' },
];
const DAYS = [
  { value: 1, label: 'Mon' }, { value: 2, label: 'Tue' }, { value: 3, label: 'Wed' },
  { value: 4, label: 'Thu' }, { value: 5, label: 'Fri' }, { value: 6, label: 'Sat' }, { value: 0, label: 'Sun' },
];

export async function renderOnboarding() {
  const state = getState();
  const user = state.user;
  // Certifications are fetched on entry when they were not loaded during
  // bootstrap (for example when arriving straight from sign-up).
  if (!state.certs?.length) {
    try {
      const { categories } = await api.get('/api/certifications');
      setState({ certs: categories });
    } catch { /* the grid shows an explanatory empty message */ }
  }
  state.certs = getState().certs;
  const answers = {
    displayName: user?.displayName || '',
    certSlug: '',
    certName: '',
    examDate: '',
    knowledgeLevel: 'beginner',
    dailyMinutes: 45,
    studyMethods: ['flashcards', 'practice-questions'],
    preferredDays: [1, 2, 3, 4, 5],
  };
  let step = 0;
  const TOTAL = 4;

  const body = h('div');
  const stepper = h('div', { class: 'stepper' });
  const title = h('h2', { class: 'mb-1' });
  const sub = h('p', { class: 'muted' });
  const backBtn = h('button', { class: 'btn', type: 'button', text: 'Back', onClick: () => { step -= 1; paint(); } });
  const nextBtn = h('button', { class: 'btn btn--primary', type: 'button' });

  function paintStepper() {
    stepper.innerHTML = '';
    for (let i = 0; i < TOTAL; i += 1) stepper.append(h('span', { dataset: { active: i <= step ? '1' : '0' } }));
  }

  function paint() {
    paintStepper();
    backBtn.style.visibility = step === 0 ? 'hidden' : 'visible';
    nextBtn.textContent = step === TOTAL - 1 ? 'Build my dashboard' : 'Continue';
    body.innerHTML = '';

    if (step === 0) {
      title.textContent = 'What should we call you?';
      sub.textContent = 'This is just for your dashboard. You can change it later.';
      body.append(h('div', { class: 'field' }, [
        h('label', { for: 'ob-name', text: 'Preferred display name' }),
        h('input', { id: 'ob-name', type: 'text', value: answers.displayName, placeholder: 'e.g. Alex', maxlength: 80 }),
      ]));
    } else if (step === 1) {
      title.textContent = 'Which certification are you preparing for?';
      sub.textContent = 'This creates your first certification workspace. You can add more later.';
      const search = h('input', { type: 'search', placeholder: 'Search certifications…', 'aria-label': 'Search certifications' });
      const grid = h('div', { class: 'cert-grid mt-1' });
      const certs = state.certs || [];
      const renderList = (filter = '') => {
        grid.innerHTML = '';
        const q = filter.toLowerCase();
        let shown = 0;
        for (const group of certs) {
          const items = group.items.filter((c) => !q || c.name.toLowerCase().includes(q) || c.category.toLowerCase().includes(q));
          if (!items.length) continue;
          grid.append(h('div', { class: 'small strong muted', style: 'grid-column:1/-1;margin-top:6px', text: group.category }));
          for (const c of items) {
            shown += 1;
            grid.append(h('button', {
              class: 'cert-option', type: 'button', 'aria-pressed': answers.certSlug === c.slug ? 'true' : 'false',
              onClick: (e) => {
                answers.certSlug = c.slug;
                answers.certName = c.slug === 'custom' ? '' : c.name;
                for (const b of grid.querySelectorAll('.cert-option')) b.setAttribute('aria-pressed', 'false');
                e.currentTarget.setAttribute('aria-pressed', 'true');
                customWrap.classList.toggle('hidden', c.slug !== 'custom');
                if (c.slug !== 'custom') { const inp = customWrap.querySelector('input'); if (inp) inp.value = ''; }
              },
            }, [h('div', { class: 'strong', text: c.name }), h('div', { class: 'tiny muted clamp-2', text: c.description || '' })]));
          }
        }
        if (!shown) grid.append(h('div', { class: 'muted small', style: 'grid-column:1/-1', text: 'No certifications match that search. Choose “Other / Custom certification”.' }));
      };
      search.addEventListener('input', () => renderList(search.value));
      const customInput = h('input', { type: 'text', placeholder: 'e.g. Salesforce Certified Administrator', value: answers.certName, maxlength: 120 });
      customInput.addEventListener('input', () => { answers.certName = customInput.value; });
      const customWrap = h('div', { class: 'field mt-1 hidden' }, [
        h('label', { text: 'Name your certification' }), customInput,
      ]);
      body.append(search, grid, customWrap);
      renderList();
    } else if (step === 2) {
      title.textContent = 'When is your exam, and how much time do you have?';
      sub.textContent = 'The exam date is optional, but it lets Recall pace your plan.';
      const dateInput = h('input', { id: 'ob-date', type: 'date', value: answers.examDate, min: new Date().toISOString().slice(0, 10) });
      dateInput.addEventListener('change', () => { answers.examDate = dateInput.value; });
      const range = h('input', { type: 'range', min: 10, max: 240, step: 5, value: answers.dailyMinutes, 'aria-label': 'Minutes per day' });
      const rangeOut = h('span', { class: 'strong', text: `${answers.dailyMinutes} min/day` });
      range.addEventListener('input', () => { answers.dailyMinutes = Number(range.value); rangeOut.textContent = `${answers.dailyMinutes} min/day`; });
      body.append(
        h('div', { class: 'field' }, [h('label', { for: 'ob-date', text: 'Target exam date (optional)' }), dateInput]),
        h('div', { class: 'field' }, [h('label', { text: 'Average study time per day' }), range, h('div', { class: 'row' }, [rangeOut, h('span', { class: 'tiny muted', text: '— you can change this any time' })])]),
      );
    } else {
      title.textContent = 'How do you like to study?';
      sub.textContent = 'Recall will weight your plan toward these methods.';
      const levelWrap = h('div', { class: 'stack stack--sm mb-2' });
      for (const l of LEVELS) {
        levelWrap.append(h('button', {
          class: 'cert-option', type: 'button', 'aria-pressed': answers.knowledgeLevel === l.value ? 'true' : 'false',
          onClick: (e) => {
            answers.knowledgeLevel = l.value;
            for (const b of levelWrap.querySelectorAll('.cert-option')) b.setAttribute('aria-pressed', 'false');
            e.currentTarget.setAttribute('aria-pressed', 'true');
          },
        }, [h('div', { class: 'strong', text: l.label }), h('div', { class: 'tiny muted', text: l.hint })]));
      }
      const methodChips = h('div', { class: 'chips' });
      for (const m of METHODS) {
        methodChips.append(h('button', {
          class: 'chip', type: 'button', 'aria-pressed': answers.studyMethods.includes(m.value) ? 'true' : 'false',
          onClick: (e) => {
            const on = e.currentTarget.getAttribute('aria-pressed') === 'true';
            e.currentTarget.setAttribute('aria-pressed', on ? 'false' : 'true');
            answers.studyMethods = on ? answers.studyMethods.filter((x) => x !== m.value) : [...answers.studyMethods, m.value];
          },
        }, m.label));
      }
      const dayChips = h('div', { class: 'chips' });
      for (const d of DAYS) {
        dayChips.append(h('button', {
          class: 'chip', type: 'button', 'aria-pressed': answers.preferredDays.includes(d.value) ? 'true' : 'false',
          onClick: (e) => {
            const on = e.currentTarget.getAttribute('aria-pressed') === 'true';
            e.currentTarget.setAttribute('aria-pressed', on ? 'false' : 'true');
            answers.preferredDays = on ? answers.preferredDays.filter((x) => x !== d.value) : [...answers.preferredDays, d.value];
          },
        }, d.label));
      }
      body.append(
        h('div', { class: 'field' }, [h('label', { text: 'Current knowledge level' }), levelWrap]),
        h('div', { class: 'field' }, [h('label', { text: 'Preferred study methods' }), methodChips]),
        h('div', { class: 'field' }, [h('label', { text: 'Which days can you study?' }), dayChips, h('span', { class: 'field__hint', text: 'Your plan only schedules sessions on these days.' })]),
      );
    }
  }

  nextBtn.addEventListener('click', async () => {
    if (step === 1) {
      if (!answers.certSlug) { toast('Choose the certification you are preparing for.', 'error'); return; }
      if (answers.certSlug === 'custom' && !answers.certName.trim()) { toast('Name your certification, or pick one from the list.', 'error'); return; }
    }
    if (step < TOTAL - 1) { step += 1; paint(); return; }
    if (!answers.studyMethods.length) { toast('Pick at least one study method.', 'error'); return; }
    if (!answers.preferredDays.length) { toast('Pick at least one study day.', 'error'); return; }
    nextBtn.disabled = true;
    nextBtn.innerHTML = '<span class="spinner"></span> Building your dashboard';
    try {
      const data = await api.post('/api/onboarding', answers);
      setState({ user: data.user, profile: data.profile });
      toast('Your study system is ready.', 'success');
      navigate('/dashboard', { replace: true });
    } catch (err) {
      toast(err.message || 'Could not save your profile.', 'error');
    } finally {
      nextBtn.disabled = false;
      nextBtn.textContent = 'Build my dashboard';
    }
  });

  paint();
  return h('div', { class: 'onboard-shell' }, [
    h('div', { class: 'onboard-card' }, [
      h('div', { class: 'row mb-2' }, [
        h('span', { class: 'sidebar__mark', html: 'R' }),
        h('span', { class: 'strong', text: 'Recall' }),
        h('span', { class: 'badge ml-auto', text: `Step ${step + 1} of ${TOTAL}` }),
      ]),
      stepper, title, sub, body,
      h('div', { class: 'row mt-3', style: 'justify-content:space-between' }, [backBtn, nextBtn]),
      h('p', { class: 'tiny muted mt-2 mb-0', text: 'Recall builds your first study plan from these answers. You can change everything later in Settings.' }),
    ]),
  ]);
}
