// Cmail — views: first-run access creation + login / 2FA
// Single-user ecosystem: the first visit creates the one account, then it is login-only.
import { api, state, errText } from '../api.js';
import { t, lang, setLang } from '../i18n.js';
import { h, clear, icon, toast, copyText, vibrate } from '../ui.js';
import { setTheme } from '../app.js';

// shared recovery copy-lines (used on the login page AND in the help view)
export function recoveryCopyLine(text) {
  const btn = h('button', { class: 'btn btn--sm btn--ghost', onclick: async () => { await copyText(text); toast(t('copied'), 'ok', 1500); } }, icon('copy'));
  return h('div', { class: 'copy-line' }, h('span', {}, text), btn);
}

export function stepRow(n, title, desc) {
  return h('div', { class: 'step-row' }, h('span', { class: 'step-row__num' }, String(n)),
    h('div', { class: 'step-row__body' }, h('h4', {}, title), h('p', {}, desc)));
}

// the account-recovery panel: how to get the username / reset the password from D1 Console
export function recoveryPanel({ open = false } = {}) {
  const body = h('div', { class: 'rec-body' });
  body.append(
    h('p', { class: 'small muted rec-lead' }, t('loginHelpSub')),
    stepRow(1, t('recStep1'), ''),
    recoveryCopyLine('SELECT username FROM users;'),
    stepRow(2, t('recStep3'), ''),
    recoveryCopyLine("UPDATE users SET password_hash = 'pbkdf2$100000$Y21haWwtcmVjb3Zlci1zYWx0MQ==$lvVylyVdxsS9Ji19drxw9ko72vDhlyHCDf5dSIC9Z/c=' WHERE role = 'admin';"),
    h('div', { class: 'rec-warn' }, icon('shield'), h('span', {}, t('recWarn'))),
  );
  return h('details', { class: `auth-help ${open ? 'is-open' : ''}`, open }, h('summary', {}, icon('help'), t('loginHelp')), body);
}

export function renderLogin(root) {
  // root IS the auth stage (route() already gave it .view--auth) — no extra
  // wrapper, or the double padding shoves the card off-center on desktop
  clear(root);
  // living aurora backdrop — the sign-in stage breathes with the accent color
  root.append(h('div', { class: 'auth-aurora', 'aria-hidden': 'true' }, h('i'), h('i'), h('i')));
  const wrap = h('div', { class: 'auth-wrap' });
  root.append(wrap);

  // header controls
  const ctrls = h('div', { class: 'auth-ctrls' },
    h('button', { class: 'glass-btn', title: t('theme'), onclick: () => setTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark') }, icon('sun')),
    h('button', { class: 'glass-btn', title: t('language'), onclick: () => { setLang(lang === 'fa' ? 'en' : 'fa'); clear(root); renderLogin(root); } }, icon('globe')),
  );
  root.append(ctrls);

  const logo = h('img', { class: 'auth-logo', src: 'assets/img/logo-dark.png', alt: 'Cmail' });
  wrap.append(logo);
  wrap.append(h('p', { class: 'auth-foot' }, t('tagline')));

  const firstRun = !state.setup?.admin_created;
  const withUsername = state.setup?.login_username !== false;
  let pending = null;
  let form = null;

  const card = h('div', { class: 'auth-card glass' });
  wrap.append(card);

  function field(label, type, name, value, autofocus) {
    const input = h('input', { class: 'input', type, name, value, autocomplete: type === 'password' ? (firstRun ? 'new-password' : 'current-password') : 'username', required: true });
    if (autofocus) setTimeout(() => input.focus(), 60);
    return h('div', { class: 'field' }, h('label', {}, label), input);
  }

  function shakeCard() {
    vibrate([12, 50, 12]);
    card.classList.remove('shake');
    void card.offsetWidth;
    card.classList.add('shake');
    setTimeout(() => card.classList.remove('shake'), 600);
  }

  function afterAuth() {
    location.hash = state.setup?.ready ? '#/mail' : '#/status';
  }

  function drawCreate() {
    clear(card);
    card.append(
      h('h2', { class: 'auth-title' }, t('createTitle')),
      h('p', { class: 'auth-sub' }, t('createSub')),
    );
    form = h('form', { class: 'auth-form' });
    if (withUsername) form.append(field(t('username'), 'text', 'username', '', true));
    form.append(field(t('password'), 'password', 'password', ''));
    form.append(field(t('confirmPassword'), 'password', 'confirm', ''));

    const submitBtn = h('button', { class: 'btn btn--primary', type: 'submit', style: { marginTop: '4px' } },
      icon('plus'), t('createAccess'));
    form.append(submitBtn);
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const fd = Object.fromEntries(new FormData(form).entries());
      if (fd.password !== fd.confirm) { toast(t('passwordMismatch'), 'err'); shakeCard(); return; }
      submitCreate(fd);
    });
    card.append(form);
    card.append(h('p', { class: 'auth-note' }, icon('shield'), t('createNote')));
  }

  function drawLogin() {
    clear(card);
    card.append(
      h('h2', { class: 'auth-title' }, t('loginTitle')),
      h('p', { class: 'auth-sub' }, withUsername ? t('loginSub') : t('loginSubPass')),
    );
    form = h('form', { class: 'auth-form' });
    if (withUsername) form.append(field(t('username'), 'text', 'username', '', true));
    form.append(field(t('password'), 'password', 'password', '', !withUsername));

    const submitBtn = h('button', { class: 'btn btn--primary', type: 'submit', style: { marginTop: '4px' } },
      icon('arrow'), t('login'));
    form.append(submitBtn);
    form.addEventListener('submit', (e) => { e.preventDefault(); submitLogin(Object.fromEntries(new FormData(form).entries())); });
    card.append(form);
    card.append(recoveryPanel());
  }

  async function submitCreate(fd) {
    const btn = form.querySelector('button[type=submit]');
    btn.disabled = true;
    try {
      const r = await api.post('/api/setup/admin', { username: (fd.username ?? '').trim(), password: fd.password });
      state.user = r.user;
      if (state.setup) state.setup.admin_created = true;
      toast(t('welcomeAccess'), 'ok', 2200);
      afterAuth();
    } catch (e) {
      toast(errText(e), 'err');
      shakeCard();
      btn.disabled = false;
    }
  }

  async function submitLogin(fd) {
    const btn = form.querySelector('button[type=submit]');
    btn.disabled = true;
    try {
      const r = await api.post('/api/auth/login', { username: (fd.username ?? '').trim(), password: fd.password });
      if (r.totp_required) { pending = r.pending; drawTotp(); return; }
      state.user = r.user;
      afterAuth();
    } catch (e) {
      toast(errText(e), 'err');
      shakeCard();
      btn.disabled = false;
    }
  }

  function drawTotp() {
    clear(card);
    card.append(
      h('h2', { class: 'auth-title' }, t('totpTitle')),
      h('p', { class: 'auth-sub' }, t('totpSub')),
    );
    const codeInput = h('input', { class: 'input mono', style: { textAlign: 'center', fontSize: '22px', letterSpacing: '8px' }, inputmode: 'numeric', maxlength: '8', placeholder: '——————' });
    const btn = h('button', { class: 'btn btn--primary', style: { width: '100%' } }, icon('shield'), t('verify'));
    const f = h('form', { class: 'auth-form' },
      h('div', { class: 'field' }, h('label', {}, t('totpTitle')), codeInput), btn);
    f.addEventListener('submit', async (e) => {
      e.preventDefault();
      btn.disabled = true;
      try {
        const r = await api.post('/api/auth/login/totp', { pending, code: codeInput.value.trim() });
        state.user = r.user;
        afterAuth();
      } catch (err) {
        toast(errText(err), 'err');
        shakeCard();
        btn.disabled = false;
      }
    });
    card.append(f);
    setTimeout(() => codeInput.focus(), 60);
  }

  if (firstRun) drawCreate(); else drawLogin();
}

export function dnsTable(rows) {
  return h('table', { class: 'dns-table' },
    h('thead', {}, h('tr', {}, h('th', {}, 'Type'), h('th', {}, 'Name'), h('th', {}, 'Value'), h('th', {}, 'Priority'))),
    h('tbody', {}, rows.map((r) => h('tr', {}, r.map((c) => h('td', {}, c))))));
}

export function copyLine(text) {
  const btn = h('button', { class: 'btn btn--sm btn--ghost', onclick: async () => { await copyText(text); toast(t('copied'), 'ok', 1500); } }, icon('copy'));
  return h('div', { class: 'copy-line' }, h('span', {}, text), btn);
}
