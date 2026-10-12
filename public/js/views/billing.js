import { h, icon, toast, esc } from '../ui.js';
import { api } from '../api.js';
import { navigate } from '../router.js';
import { setState } from '../store.js';

function authShell(title, subtitle, form, footer) {
  return h('div', { class: 'auth-shell' }, [
    h('div', { class: 'auth-card' }, [
      h('a', { class: 'row mb-2', href: '#/', style: 'text-decoration:none' }, [
        h('span', { class: 'sidebar__mark', html: 'R' }),
        h('span', { class: 'strong', text: 'Recall', style: 'color:var(--text)' }),
      ]),
      h('h1', { text: title }),
      subtitle ? h('p', { class: 'muted', text: subtitle }) : null,
      form,
      footer || null,
    ]),
  ]);
}

function field({ id, label, type = 'text', value = '', hint, autocomplete, required = true }) {
  return h('div', { class: 'field' }, [
    h('label', { for: id, text: label }),
    h('input', { id, name: id, type, value, autocomplete: autocomplete || 'off', required }),
    hint ? h('span', { class: 'field__hint', text: hint }) : null,
  ]);
}

function errorBox() {
  const box = h('div', { class: 'alert alert--error hidden' });
  return box;
}
function showError(box, message) {
  box.className = 'alert alert--error';
  box.innerHTML = '';
  box.append(h('span', { html: icon('alert', 16) }), h('span', { text: message }));
}

async function submitForm(form, box, button, fn) {
  box.className = 'alert alert--error hidden';
  button.disabled = true;
  const original = button.textContent;
  button.innerHTML = '<span class="spinner"></span> Please wait';
  try {
    await fn();
  } catch (err) {
    showError(box, err.message || 'Something went wrong.');
  } finally {
    button.disabled = false;
    button.textContent = original;
  }
}

export function renderLogin() {
  const err = errorBox();
  const btn = h('button', { class: 'btn btn--primary btn--block btn--lg', type: 'submit', text: 'Sign in' });
  const form = h('form', { novalidate: true }, [
    err,
    field({ id: 'email', label: 'Email', type: 'email', autocomplete: 'email' }),
    field({ id: 'password', label: 'Password', type: 'password', autocomplete: 'current-password' }),
    h('div', { class: 'row row--between mb-2' }, [
      h('a', { class: 'small', href: '#/forgot-password', text: 'Forgot password?' }),
    ]),
    btn,
  ]);
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    submitForm(form, err, btn, async () => {
      const email = form.email.value.trim();
      const password = form.password.value;
      const { user } = await api.post('/api/auth/login', { email, password });
      setState({ user });
      toast('Welcome back.', 'success');
      navigate(user.onboarded ? '/dashboard' : '/onboarding', { replace: true });
    });
  });
  return authShell('Sign in', 'Continue where you left off.', form, h('p', { class: 'small muted mt-2 mb-0' }, [
    'New to Recall? ', h('a', { href: '#/signup', text: 'Create a free account' }),
  ]));
}

export function renderSignup() {
  const err = errorBox();
  const btn = h('button', { class: 'btn btn--primary btn--block btn--lg', type: 'submit', text: 'Create free account' });
  const form = h('form', { novalidate: true }, [
    err,
    field({ id: 'displayName', label: 'Your name', type: 'text', autocomplete: 'name', required: false }),
    field({ id: 'email', label: 'Email', type: 'email', autocomplete: 'email' }),
    field({ id: 'password', label: 'Password', type: 'password', autocomplete: 'new-password', hint: 'At least 8 characters.' }),
    btn,
  ]);
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    submitForm(form, err, btn, async () => {
      const { user } = await api.post('/api/auth/signup', {
        displayName: form.displayName.value.trim(),
        email: form.email.value.trim(),
        password: form.password.value,
      });
      setState({ user });
      toast('Account created. Let\'s set up your study profile.', 'success');
      navigate('/onboarding', { replace: true });
    });
  });
  return authShell('Create your free account', 'No credit card required.', form, h('p', { class: 'small muted mt-2 mb-0' }, [
    'Already have an account? ', h('a', { href: '#/login', text: 'Sign in' }),
    h('br'),
    h('span', { class: 'tiny' }, [
      'By creating an account you agree to the ',
      h('a', { href: '#/terms', text: 'terms' }), ' and ', h('a', { href: '#/privacy', text: 'privacy policy' }), '.',
    ]),
  ]));
}

export function renderForgot() {
  const err = errorBox();
  const btn = h('button', { class: 'btn btn--primary btn--block btn--lg', type: 'submit', text: 'Send reset link' });
  const result = h('div', { class: 'hidden' });
  const notice = h('div', { class: 'hidden' });
  const form = h('form', { novalidate: true }, [
    err,
    result,
    field({ id: 'email', label: 'Email', type: 'email', autocomplete: 'email' }),
    btn,
  ]);

  // Warn up front when the server has no working mail provider, so nobody sits
  // waiting for an email that will never arrive.
  api.get('/api/auth/mail-status').then((status) => {
    if (!status || status.configured) return;
    notice.className = 'alert alert--warning';
    notice.innerHTML = '';
    notice.append(
      h('span', { html: icon('alert', 16) }),
      h('div', { class: 'stack stack--sm' }, [
        h('span', { text: 'Email delivery is not configured on this server.' }),
        status.message ? h('span', { class: 'tiny muted', text: status.message }) : null,
      ]),
    );
  }).catch(() => { /* non-fatal */ });

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    submitForm(form, err, btn, async () => {
      const data = await api.post('/api/auth/forgot-password', { email: form.email.value.trim() });
      result.className = 'alert alert--success';
      result.innerHTML = '';
      const rows = [h('span', { text: data.message })];
      if (data.devResetUrl) {
        rows.push(h('div', {}, [
          h('div', { class: 'tiny strong mt-1', text: 'Test link (this server is not delivering email):' }),
          h('a', { href: data.devResetUrl.replace(/^https?:\/\/[^/]+/, ''), text: 'Open reset link' }),
          h('div', { class: 'tiny muted', text: data.devNote }),
        ]));
      } else if (data.mailConfigured === false) {
        rows.push(h('div', { class: 'tiny muted', text: 'This server cannot deliver email yet, so no message was sent.' }));
      }
      result.append(h('div', { class: 'stack stack--sm' }, rows));
    });
  });

  return authShell('Reset your password', 'We will send a link to reset your password.', h('div', {}, [notice, form]), h('p', { class: 'small muted mt-2 mb-0' }, [
    h('a', { href: '#/login', text: 'Back to sign in' }),
  ]));
}

export function renderReset(token) {
  const err = errorBox();
  const btn = h('button', { class: 'btn btn--primary btn--block btn--lg', type: 'submit', text: 'Set new password' });
  const form = h('form', { novalidate: true }, [
    err,
    field({ id: 'password', label: 'New password', type: 'password', autocomplete: 'new-password', hint: 'At least 8 characters.' }),
    btn,
  ]);
  if (!token) {
    showError(err, 'This reset link is missing its token. Request a new link.');
  }
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    submitForm(form, err, btn, async () => {
      await api.post('/api/auth/reset-password', { token, password: form.password.value });
      toast('Password updated. Sign in with your new password.', 'success');
      navigate('/login', { replace: true });
    });
  });
  return authShell('Choose a new password', 'Your other sessions will be signed out.', form, h('p', { class: 'small muted mt-2 mb-0' }, [
    h('a', { href: '#/login', text: 'Back to sign in' }),
  ]));
}
