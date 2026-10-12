import { h, icon, toast, modal, confirmDialog, badgeFor, fmtDate, esc } from '../ui.js';
import { api } from '../api.js';
import { navigate } from '../router.js';
import { getState, setState, applyTheme } from '../store.js';

const METHODS = [
  ['flashcards', 'Flashcards'], ['practice-questions', 'Practice questions'], ['reading', 'Reading & summaries'],
  ['video', 'Video'], ['teaching-others', 'Explaining to others'],
];
const DAYS = [[1, 'Mon'], [2, 'Tue'], [3, 'Wed'], [4, 'Thu'], [5, 'Fri'], [6, 'Sat'], [0, 'Sun']];

export async function renderSettings({ setMeta }) {
  const [{ profile }, { settings }] = await Promise.all([
    api.get('/api/profile'),
    api.get('/api/profile'),
  ]);
  const state = getState();
  setMeta({ title: 'Settings', subtitle: 'Profile, study preferences, appearance and account' });

  const tabs = [
    { id: 'profile', label: 'Study profile' },
    { id: 'account', label: 'Account' },
    { id: 'appearance', label: 'Appearance' },
    { id: 'data', label: 'Data & privacy' },
  ];
  let active = 'profile';
  const tabBar = h('div', { class: 'tabs' });
  const panel = h('div');

  function paintTabs() {
    tabBar.innerHTML = '';
    for (const t of tabs) tabBar.append(h('button', { class: 'tab', type: 'button', role: 'tab', 'aria-selected': active === t.id ? 'true' : 'false', text: t.label, onClick: () => { active = t.id; paintTabs(); paintPanel(); } }));
  }

  function paintPanel() {
    panel.innerHTML = '';
    if (active === 'profile') panel.append(profilePanel(profile));
    else if (active === 'account') panel.append(accountPanel(state.user));
    else if (active === 'appearance') panel.append(appearancePanel(settings));
    else panel.append(dataPanel());
  }

  paintTabs();
  paintPanel();
  return h('div', {}, [tabBar, panel]);
}

function profilePanel(profile) {
  const certs = getState().certs || [];
  const certSel = h('select', {}, [
    h('option', { value: '', text: 'Not set' }),
    ...certs.flatMap((g) => g.items.map((c) => h('option', { value: c.slug, text: `${c.name} — ${c.category}`, selected: c.slug === profile?.certSlug ? true : null }))),
  ]);
  const certName = h('input', { type: 'text', value: profile?.certName || '', placeholder: 'Certification name' });
  const examDate = h('input', { type: 'date', value: profile?.examDate || '' });
  const level = h('select', {}, ['beginner', 'intermediate', 'advanced'].map((l) => h('option', { value: l, text: l[0].toUpperCase() + l.slice(1), selected: l === profile?.knowledgeLevel ? true : null })));
  const minutes = h('input', { type: 'number', min: 10, max: 300, value: profile?.dailyMinutes ?? 45 });

  const methodChips = h('div', { class: 'chips' });
  const methods = new Set(profile?.studyMethods || []);
  for (const [v, l] of METHODS) {
    methodChips.append(h('button', { class: 'chip', type: 'button', 'aria-pressed': methods.has(v) ? 'true' : 'false', text: l, onClick: (e) => {
      const on = e.currentTarget.getAttribute('aria-pressed') === 'true';
      e.currentTarget.setAttribute('aria-pressed', on ? 'false' : 'true');
      if (on) methods.delete(v); else methods.add(v);
    } }));
  }
  const dayChips = h('div', { class: 'chips' });
  const days = new Set(profile?.preferredDays || []);
  for (const [v, l] of DAYS) {
    dayChips.append(h('button', { class: 'chip', type: 'button', 'aria-pressed': days.has(v) ? 'true' : 'false', text: l, onClick: (e) => {
      const on = e.currentTarget.getAttribute('aria-pressed') === 'true';
      e.currentTarget.setAttribute('aria-pressed', on ? 'false' : 'true');
      if (on) days.delete(v); else days.add(v);
    } }));
  }

  const save = h('button', { class: 'btn btn--primary', type: 'button', text: 'Save preferences', onClick: async () => {
    save.disabled = true;
    try {
      const r = await api.put('/api/profile', {
        certSlug: certSel.value || null,
        certName: certName.value,
        examDate: examDate.value || null,
        knowledgeLevel: level.value,
        dailyMinutes: Number(minutes.value),
        studyMethods: [...methods],
        preferredDays: [...days],
      });
      setState({ profile: r.profile });
      toast('Preferences saved. Your plan has been updated.', 'success');
    } catch (err) { toast(err.message, 'error'); }
    finally { save.disabled = false; }
  } });

  return h('div', { class: 'card card--pad-lg' }, [
    h('h2', { text: 'Study profile' }),
    h('p', { class: 'small muted', text: 'These settings drive your dashboard, study plan and pacing recommendations.' }),
    h('div', { class: 'field' }, [h('label', { text: 'Certification' }), certSel]),
    h('div', { class: 'field' }, [h('label', { text: 'Certification display name' }), certName]),
    h('div', { class: 'form-row' }, [
      h('div', { class: 'field' }, [h('label', { text: 'Target exam date (optional)' }), examDate]),
      h('div', { class: 'field' }, [h('label', { text: 'Current knowledge level' }), level]),
    ]),
    h('div', { class: 'field' }, [h('label', { text: 'Average study time per day (minutes)' }), minutes]),
    h('div', { class: 'field' }, [h('label', { text: 'Preferred study methods' }), methodChips]),
    h('div', { class: 'field' }, [h('label', { text: 'Available study days' }), dayChips]),
    save,
  ]);
}

function accountPanel(user) {
  const name = h('input', { type: 'text', value: user?.displayName || '' });
  const saveName = h('button', { class: 'btn', type: 'button', text: 'Update name', onClick: async () => {
    try {
      await api.put('/api/settings', {});
      await api.post('/api/onboarding', { displayName: name.value, certSlug: getState().profile?.certSlug, knowledgeLevel: getState().profile?.knowledgeLevel, dailyMinutes: getState().profile?.dailyMinutes, studyMethods: getState().profile?.studyMethods, preferredDays: getState().profile?.preferredDays, examDate: getState().profile?.examDate });
      setState({ user: { ...getState().user, displayName: name.value } });
      toast('Name updated.', 'success');
    } catch (err) { toast(err.message, 'error'); }
  } });

  const cur = h('input', { type: 'password', autocomplete: 'current-password' });
  const next = h('input', { type: 'password', autocomplete: 'new-password' });
  const changePw = h('button', { class: 'btn', type: 'button', text: 'Change password', onClick: async () => {
    try {
      await api.post('/api/auth/change-password', { currentPassword: cur.value, newPassword: next.value });
      toast('Password changed. Other sessions were signed out.', 'success');
      cur.value = ''; next.value = '';
    } catch (err) { toast(err.message, 'error'); }
  } });

  return h('div', { class: 'stack stack--lg' }, [
    h('div', { class: 'card card--pad-lg' }, [
      h('h2', { text: 'Account' }),
      h('div', { class: 'field' }, [h('label', { text: 'Email' }), h('input', { type: 'email', value: user?.email || '', disabled: true })]),
      h('div', { class: 'field' }, [h('label', { text: 'Display name' }), name]),
      saveName,
    ]),
    h('div', { class: 'card card--pad-lg' }, [
      h('h2', { text: 'Change password' }),
      h('div', { class: 'field' }, [h('label', { text: 'Current password' }), cur]),
      h('div', { class: 'field' }, [h('label', { text: 'New password' }), next, h('span', { class: 'field__hint', text: 'At least 8 characters. All other sessions will be signed out.' })]),
      changePw,
    ]),
    h('div', { class: 'card card--pad-lg' }, [
      h('h2', { text: 'Session' }),
      h('button', { class: 'btn', type: 'button', text: 'Sign out', onClick: async () => {
        await api.post('/api/auth/logout');
        setState({ user: null, profile: null, dashboard: null });
        toast('Signed out.', 'success');
        navigate('/login', { replace: true });
      } }),
    ]),
  ]);
}

function appearancePanel(settings) {
  const theme = h('select', {}, [
    ['system', 'Match system'], ['light', 'Light'], ['dark', 'Dark'],
  ].map(([v, l]) => h('option', { value: v, text: l, selected: v === settings?.theme ? true : null })));
  const reduced = h('input', { type: 'checkbox', checked: settings?.reducedMotion ? true : null });
  const reminders = h('input', { type: 'checkbox', checked: settings?.emailReminders ? true : null });
  const save = h('button', { class: 'btn btn--primary', type: 'button', text: 'Save appearance', onClick: async () => {
    try {
      const r = await api.put('/api/settings', { theme: theme.value, reducedMotion: reduced.checked, emailReminders: reminders.checked });
      setState({ settings: r.settings });
      applyTheme();
      toast('Appearance saved.', 'success');
    } catch (err) { toast(err.message, 'error'); }
  } });
  return h('div', { class: 'card card--pad-lg' }, [
    h('h2', { text: 'Appearance' }),
    h('div', { class: 'field' }, [h('label', { text: 'Theme' }), theme]),
    h('label', { class: 'checkbox mb-2' }, [reduced, h('span', { text: 'Reduce motion (disables card flips and transitions)' })]),
    h('label', { class: 'checkbox mb-2' }, [reminders, h('span', { text: 'Email study reminders (requires an email provider to be configured)' })]),
    save,
  ]);
}

function dataPanel() {
  return h('div', { class: 'stack stack--lg' }, [
    h('div', { class: 'card card--pad-lg' }, [
      h('h2', { text: 'Export your data' }),
      h('p', { class: 'small muted', text: 'Download a JSON file containing your profile, study sets, flashcards, review history, quizzes and attempts.' }),
      h('a', { class: 'btn', href: '/api/account/export', html: `${icon('download', 15)} Download data export` }),
    ]),
    h('div', { class: 'card card--pad-lg' }, [
      h('h2', { text: 'Delete account' }),
      h('p', { class: 'small muted', text: 'Deleting your account permanently removes your materials, study sets, flashcards, review history and quiz attempts. This cannot be undone.' }),
      h('button', { class: 'btn btn--danger', type: 'button', text: 'Delete my account', onClick: async () => {
        const ok = await confirmDialog({ title: 'Delete your account?', message: 'All of your study data will be permanently deleted. This cannot be undone.', confirmLabel: 'Continue', danger: true });
        if (!ok) return;
        const input = h('input', { type: 'text', placeholder: 'Type DELETE to confirm' });
        modal({
          title: 'Confirm account deletion',
          body: h('div', {}, [
            h('div', { class: 'alert alert--error' }, [h('span', { text: 'This is permanent. Export your data first if you want a copy.' })]),
            h('div', { class: 'field mt-2' }, [h('label', { text: 'Confirmation' }), input]),
          ]),
          actions: [{ label: 'Cancel' }, { label: 'Delete account', variant: 'danger', onClick: async () => {
            if (input.value !== 'DELETE') { toast('Type DELETE exactly to confirm.', 'error'); return false; }
            try {
              await api.del('/api/account', { confirm: 'DELETE' });
              setState({ user: null, profile: null, dashboard: null });
              toast('Your account has been deleted.', 'success');
              navigate('/', { replace: true });
            } catch (err) { toast(err.message, 'error'); return false; }
            return true;
          } }],
        });
      } }),
    ]),
    h('div', { class: 'card card--pad-lg' }, [
      h('h2', { text: 'AI data use' }),
      h('p', { class: 'small muted mb-0', text: 'When you request generation, the extracted text of the selected material is sent to the configured AI provider to produce study content. Reviewing existing flashcards never calls the AI provider. Uploaded files are stored privately and served only to your account.' }),
    ]),
  ]);
}
